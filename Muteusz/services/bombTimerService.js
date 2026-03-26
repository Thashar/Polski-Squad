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
        this.timerInterval = null;   // odliczanie - czysty setInterval bez Discord API
        this.displayRunning = false; // flaga sterująca pętlą wyświetlania
        this.displayGeneration = 0;  // numer generacji - stara pętla wykrywa że ma się zatrzymać
        this.client = null;
        this.lastFileSave = 0;
        this.cachedTimerChannel = null;
        this.cachedTimerMessage = null;
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
        if (!this.cachedTimerChannel) {
            this.cachedTimerChannel = await this.client.channels.fetch(this.config.bombTimer.timerChannelId);
        }
        return this.cachedTimerChannel;
    }

    async getOrCreateTimerMessage() {
        if (this.cachedTimerMessage) {
            return this.cachedTimerMessage;
        }

        const channel = await this.getTimerChannel();

        if (this.state.timerMessageId) {
            try {
                const msg = await channel.messages.fetch(this.state.timerMessageId);
                this.cachedTimerMessage = msg;
                return msg;
            } catch {
                this.state.timerMessageId = null;
                this.cachedTimerMessage = null;
            }
        }

        const data = this.getTimerMessageData();
        const msg = await channel.send(data);
        this.state.timerMessageId = msg.id;
        this.cachedTimerMessage = msg;
        await this.saveState();
        return msg;
    }

    // Jedyne miejsce gdzie edytujemy wiadomość - używane zarówno przez pętlę jak i bezpośrednio
    async updateTimerMessage() {
        try {
            const msg = await this.getOrCreateTimerMessage();
            const data = this.getTimerMessageData();
            await msg.edit(data);
        } catch (error) {
            if (error.code === 10008) {
                this.cachedTimerMessage = null;
            }
            if (error.code !== 10008 && !error.message?.includes('rate limit') && !error.message?.includes('Missing')) {
                logger.error('❌ BombTimer: błąd aktualizacji wiadomości timera:', error.message);
            }
        }
    }

    // Pętla wyświetlania - awaits każdy edit przed następnym (brak równoległych requestów)
    // Generacja zapobiega wyścigowi: stara pętla widzi nową generację i się zatrzymuje
    startDisplayLoop() {
        this.displayGeneration++;
        this.displayRunning = true;
        this._displayLoop(this.displayGeneration);
    }

    stopDisplayLoop() {
        this.displayRunning = false;
    }

    async _displayLoop(generation) {
        while (this.displayRunning && this.displayGeneration === generation) {
            const start = Date.now();
            await this.updateTimerMessage();
            const elapsed = Date.now() - start;
            if (elapsed > 2000) {
                logger.warn(`⚠️ BombTimer: msg.edit() trwał ${elapsed}ms`);
            }
            // Celuj w ~1 update na 2 sekundy (bezpieczny margines dla rate limitu Discord)
            const waitTime = Math.max(200, 2000 - elapsed);
            if (this.displayRunning && this.displayGeneration === generation) {
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    }

    // Odliczanie - czysty setInterval, zero Discord API w środku
    startInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (this.state.timeRemaining <= 0) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
                this.state.running = false;
                this.state.exploded = true;
                this.saveState().catch(() => {});
                this.stopDisplayLoop();
                this.updateTimerMessage().catch(() => {});
                return;
            }

            this.state.timeRemaining--;

            const now = Date.now();
            if (now - this.lastFileSave >= 5000) {
                this.lastFileSave = now;
                this.saveState().catch(() => {});
            }
        }, 1000);

        this.startDisplayLoop();
    }

    stopInterval() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.stopDisplayLoop();
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

    async addTimeAndStart(seconds, requiredClicks) {
        this.stopInterval();
        this.state.timeRemaining = (this.state.timeRemaining || 0) + seconds;
        this.state.requiredClicks = requiredClicks;
        this.state.running = true;
        this.state.paused = false;
        this.state.defused = false;
        this.state.exploded = false;
        await this.saveState();
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
            await this.updateTimerMessage();
        }
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
