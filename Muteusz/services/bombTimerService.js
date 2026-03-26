const fs = require('fs').promises;
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/bomb_timer.json');

const BTN = {
    ADD_TIME: 'bomb_add_time',
    STOP: 'bomb_stop',
    RESUME: 'bomb_resume',
    RESET_PASSWORD: 'bomb_reset_password',
};

const DEFAULT_STATE = {
    timerMessageId: null,
    running: false,
    paused: false,
    timeRemaining: 0,
    requiredClicks: 0,
    defuseClicks: [],
    defused: false,
    exploded: false,
};

class BombTimerService {
    constructor(config) {
        this.config = config;
        this.state = { ...DEFAULT_STATE };
        this.timerInterval = null;
        this.client = null;
        this.ticking = false;
    }

    async initialize(client) {
        this.client = client;
        await this.loadState();

        if (this.state.running && !this.state.paused && !this.state.defused && !this.state.exploded) {
            logger.info(`🕐 BombTimer: wznawianie timera - ${this.formatTime(this.state.timeRemaining)} pozostało`);
            this.startInterval();
        }

        if (this.state.timerMessageId) {
            await this.updateTimerMessage();
        }

        logger.info('✅ BombTimerService zainicjalizowany');
    }

    async loadState() {
        try {
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            this.state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        } catch {
            this.state = { ...DEFAULT_STATE };
            await this.saveState();
        }
    }

    async saveState() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    }

    formatTime(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    }

    parseTimeInput(input) {
        const parts = input.trim().split(':').map(Number);
        if (parts.some(isNaN)) return null;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 1) return parts[0];
        return null;
    }

    buildControlRows() {
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(BTN.ADD_TIME).setLabel('Dodaj czas').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(BTN.STOP).setLabel('Zatrzymaj').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(BTN.RESUME).setLabel('Wznów').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(BTN.RESET_PASSWORD).setLabel('Resetuj hasło').setStyle(ButtonStyle.Secondary).setEmoji('🔑'),
        );
        return [row1];
    }

    getRemainingClicks() {
        return Math.max(0, this.state.requiredClicks - this.state.defuseClicks.length);
    }

    getTimerMessageData() {
        const timeStr = this.formatTime(this.state.timeRemaining);

        if (this.state.defused) {
            return {
                content: `# ⏱️ ${timeStr}\n\n⏱️ Czas na zegarze bomby został wstrzymany!`,
                components: []
            };
        }

        if (this.state.exploded) {
            return {
                content: `# ⏱️ ${timeStr}\n\n💥 Bomba wybuchła!`,
                components: []
            };
        }

        const remaining = this.getRemainingClicks();
        return {
            content: `# ⏱️ ${timeStr}\n\n👥 ${remaining} osób musi nacisnąć przycisk, żeby rozbroić 💣 bombę.`,
            components: []
        };
    }

    async getTimerChannel() {
        return await this.client.channels.fetch(this.config.bombTimer.timerChannelId);
    }

    async getOrCreateTimerMessage() {
        const channel = await this.getTimerChannel();

        if (this.state.timerMessageId) {
            try {
                return await channel.messages.fetch(this.state.timerMessageId);
            } catch {
                this.state.timerMessageId = null;
            }
        }

        const data = this.getTimerMessageData();
        const msg = await channel.send(data);
        this.state.timerMessageId = msg.id;
        await this.saveState();
        return msg;
    }

    async updateTimerMessage() {
        try {
            const msg = await this.getOrCreateTimerMessage();
            const data = this.getTimerMessageData();
            await msg.edit(data);
        } catch (error) {
            if (!error.message?.includes('rate limit') && !error.message?.includes('Missing')) {
                logger.error('❌ BombTimer: błąd aktualizacji wiadomości timera:', error.message);
            }
        }
    }

    async setupControlMessage(client) {
        const channelId = this.config.bombTimer.controlChannelId;
        if (!channelId) return;

        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) return;

            const components = this.buildControlRows();
            const messages = await channel.messages.fetch({ limit: 50 });
            const existing = messages.find(msg =>
                msg.author.id === client.user.id &&
                msg.components?.length > 0 &&
                msg.components[0]?.components?.[0]?.customId === BTN.ADD_TIME
            );

            if (existing) {
                await existing.edit({ components });
                logger.info('ℹ️ BombTimer: zaktualizowano panel kontrolny');
                return;
            }

            await channel.send({ components });
            logger.success('✅ BombTimer: wysłano panel kontrolny');
        } catch (error) {
            logger.error('❌ BombTimer: błąd setupu panelu kontrolnego:', error.message);
        }
    }

    startInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(async () => {
            await this.tick();
        }, 1000);
    }

    stopInterval() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    async tick() {
        if (this.ticking) return;
        this.ticking = true;
        try {
            if (this.state.timeRemaining <= 0) {
                this.stopInterval();
                this.state.running = false;
                this.state.exploded = true;
                await this.saveState();
                this.updateTimerMessage().catch(() => {});
                return;
            }

            this.state.timeRemaining--;
            await this.saveState();
            this.updateTimerMessage().catch(() => {});
        } finally {
            this.ticking = false;
        }
    }

    async addTimeAndStart(seconds, requiredClicks) {
        this.stopInterval();
        this.state.timeRemaining = (this.state.timeRemaining || 0) + seconds;
        this.state.requiredClicks = requiredClicks;
        this.state.running = true;
        this.state.paused = false;
        this.state.defused = false;
        this.state.exploded = false;
        await this.saveState();
        await this.updateTimerMessage();
        this.startInterval();
    }

    async startFresh(totalSeconds, requiredClicks) {
        this.stopInterval();
        this.state.timeRemaining = totalSeconds;
        this.state.requiredClicks = requiredClicks;
        this.state.defuseClicks = [];
        this.state.running = true;
        this.state.paused = false;
        this.state.defused = false;
        this.state.exploded = false;
        await this.saveState();
        await this.updateTimerMessage();
        this.startInterval();
    }

    async pause() {
        if (!this.state.running || this.state.paused) return;
        this.stopInterval();
        this.state.paused = true;
        await this.saveState();
        await this.updateTimerMessage();
    }

    async resume() {
        if (!this.state.running || !this.state.paused || this.state.defused || this.state.exploded) return;
        this.state.paused = false;
        await this.saveState();
        this.startInterval();
    }

    async registerDefuseClick(userId) {
        if (!this.state.running || this.state.defused || this.state.exploded) return;

        this.state.defuseClicks.push({ userId, timestamp: new Date().toISOString() });
        await this.saveState();

        if (this.state.defuseClicks.length >= this.state.requiredClicks) {
            this.stopInterval();
            this.state.defused = true;
            this.state.running = false;
            this.state.defuseClicks = [];
            await this.saveState();
        }

        await this.updateTimerMessage();
    }

    getButtonIds() {
        return BTN;
    }

    isMyButton(customId) {
        return Object.values(BTN).includes(customId);
    }

    cleanup() {
        this.stopInterval();
    }
}

module.exports = BombTimerService;
