const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/bomb_timer.json');

const BTN = {
    ADD_TIME: 'bomb_add_time',
    STOP: 'bomb_stop',
    RESUME: 'bomb_resume',
    START_GAME: 'bomb_start_game',
    STOP_GAME: 'bomb_stop_game',
    RESUME_GAME: 'bomb_resume_game',
    END_GAME: 'bomb_end_game',
    RESET_PASSWORD: 'bomb_reset_password',
    SHUFFLE_ORDER: 'bomb_shuffle_order',
    RESET_ORDER: 'bomb_reset_order',
    RESET_REACTION_PUZZLE: 'bomb_reset_reaction_puzzle',
    RESET_EMPTY_PUZZLE: 'bomb_reset_empty_puzzle',
    RESET_ECHO_PUZZLE: 'bomb_reset_echo_puzzle',
    RESET_HOTPOTATO: 'bomb_reset_hotpotato',
    HOTPOTATO_MINUS5: 'bomb_hotpotato_minus5',
    SNAPSHOT_BOOSTER: 'bomb_snapshot_booster',
    BOOSTER_BACK: 'bomb_booster_back',
};

const DEFAULT_STATE = {
    timerMessageId: null,
    running: false,
    paused: false,
    timeRemaining: 0,
    requiredClicks: 0,
    defuseClicks: [],
    requiredReactions: 0,      // 0 = tryb kliknięć, >0 = tryb reakcji
    currentReactionCount: 0,   // aktualny licznik reakcji (bez bota)
    requiredChatters: 0,       // 0 = tryb bez czatu, >0 = tryb czatu
    chatters: [],              // lista unikalnych userID którzy napisali
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
        this.displayTargetMs = 1000; // aktualny cel interwału (adaptuje się do szybkości Discord)
        this.client = null;
        this.lastFileSave = 0;
        this.cachedTimerChannel = null;
        this.cachedTimerMessage = null;
        this.controlPanelMessage = null;       // referencja do wiadomości panelu kontrolnego
        this.gameCountdownService = null;      // ustawiane z zewnątrz po inicjalizacji
        this.boosterSnapshotService = null;    // ustawiane z zewnątrz po inicjalizacji
    }

    async initialize(client) {
        this.client = client;
        await this.loadState();

        if (this.state.running && !this.state.paused && !this.state.defused && !this.state.exploded) {
            logger.info(`🕐 BombTimer: wznawianie timera - ${this.formatTime(this.state.timeRemaining)} pozostało`);
            this.startInterval();
        }

        if (this.state.timerMessageId) {
            // Przy restarcie w trybie reakcji - odczytaj aktualną liczbę reakcji z wiadomości
            if (this.state.requiredReactions > 0 && this.state.running) {
                await this._syncReactionCount();
            }
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
        const gcRunning = this.gameCountdownService?.running ?? false;
        const gcStarted = !!(this.gameCountdownService?.timerMessageId);

        // Przycisk 1: "Wystartuj grę" gdy gra nie trwa, "Zakończ grę" (czerwony) gdy trwa lub jest zatrzymana
        const startEndBtn = gcStarted
            ? new ButtonBuilder().setCustomId(BTN.END_GAME).setLabel('Zakończ grę').setStyle(ButtonStyle.Danger).setEmoji('🏁')
            : new ButtonBuilder().setCustomId(BTN.START_GAME).setLabel('Wystartuj grę').setStyle(ButtonStyle.Success).setEmoji('🎮');

        // Przycisk 2: zawsze widoczny — szary gdy gra nie trwa, czerwony gdy trwa
        let stopResumeBtn;
        if (!gcStarted) {
            // Gra nie uruchomiona → szary, nieaktywny
            stopResumeBtn = new ButtonBuilder().setCustomId(BTN.STOP_GAME).setLabel('Zatrzymaj grę').setStyle(ButtonStyle.Secondary).setEmoji('⏸️').setDisabled(true);
        } else if (gcRunning) {
            // Gra trwa → czerwony "Zatrzymaj grę"
            stopResumeBtn = new ButtonBuilder().setCustomId(BTN.STOP_GAME).setLabel('Zatrzymaj grę').setStyle(ButtonStyle.Danger).setEmoji('⏸️');
        } else {
            // Gra zatrzymana → zielony "Wznów grę"
            stopResumeBtn = new ButtonBuilder().setCustomId(BTN.RESUME_GAME).setLabel('Wznów grę').setStyle(ButtonStyle.Success).setEmoji('▶️');
        }

        const row1 = new ActionRowBuilder().addComponents(
            startEndBtn,
            stopResumeBtn,
            new ButtonBuilder().setCustomId(BTN.RESET_PASSWORD).setLabel('Resetuj hasło').setStyle(ButtonStyle.Secondary).setEmoji('🔑'),
        );

        // Rząd 2: toggle Usuń/Przywróć uprawnienia Boosterów
        const snapshotExists = this.boosterSnapshotService?.hasSnapshot() ?? false;
        const boosterBtn = snapshotExists
            ? new ButtonBuilder().setCustomId(BTN.BOOSTER_BACK).setLabel('Przywróć uprawnienia Boosterów').setStyle(ButtonStyle.Success).setEmoji('🔓')
            : new ButtonBuilder().setCustomId(BTN.SNAPSHOT_BOOSTER).setLabel('Usuń uprawnienia Boosterów').setStyle(ButtonStyle.Danger).setEmoji('🔒');

        // Przycisk stop/resume bomby — toggle w zależności od stanu
        let bombStopResumeBtn;
        const bombInactive = !this.state.running || this.state.defused || this.state.exploded;
        const bombPaused = this.state.running && this.state.paused;
        if (bombInactive) {
            bombStopResumeBtn = new ButtonBuilder().setCustomId(BTN.STOP).setLabel('Zatrzymaj').setStyle(ButtonStyle.Secondary).setEmoji('⏸️').setDisabled(true);
        } else if (bombPaused) {
            bombStopResumeBtn = new ButtonBuilder().setCustomId(BTN.RESUME).setLabel('Wznów').setStyle(ButtonStyle.Success).setEmoji('▶️');
        } else {
            bombStopResumeBtn = new ButtonBuilder().setCustomId(BTN.STOP).setLabel('Zatrzymaj').setStyle(ButtonStyle.Danger).setEmoji('⏸️');
        }

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(BTN.ADD_TIME).setLabel('Wystartuj bombę').setStyle(ButtonStyle.Success).setEmoji('⏱️'),
            bombStopResumeBtn,
            boosterBtn,
        );
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(BTN.SHUFFLE_ORDER).setLabel('Pomieszaj przyciski').setStyle(ButtonStyle.Primary).setEmoji('🔀'),
            new ButtonBuilder().setCustomId(BTN.RESET_ORDER).setLabel('Ułóż od 1 do 40').setStyle(ButtonStyle.Secondary).setEmoji('🔢'),
        );
        const row4 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(BTN.RESET_REACTION_PUZZLE).setLabel('Resetuj kucharza').setStyle(ButtonStyle.Danger).setEmoji('👩🏻‍🍳'),
            new ButtonBuilder().setCustomId(BTN.RESET_EMPTY_PUZZLE).setLabel('Resetuj EMPTY').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(BTN.RESET_ECHO_PUZZLE).setLabel('Resetuj Echo').setStyle(ButtonStyle.Danger).setEmoji('🔊'),
        );
        const row5 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(BTN.RESET_HOTPOTATO).setLabel('Resetuj gorący kartofel').setStyle(ButtonStyle.Danger).setEmoji('🥔'),
            new ButtonBuilder().setCustomId(BTN.HOTPOTATO_MINUS5).setLabel('Odejmij 5 min kartoflu').setStyle(ButtonStyle.Primary).setEmoji('⏬'),
        );
        return [row1, row2, row3, row4, row5];
    }

    getRemainingClicks() {
        return Math.max(0, this.state.requiredClicks - this.state.defuseClicks.length);
    }

    getTimerMessageData() {
        const timeStr = this.formatTime(this.state.timeRemaining);
        const isLow = this.state.timeRemaining < 60;
        const sideEmoji = isLow ? '<a:PepePoar:1280067288397250570>' : '<a:PepeAlarmMan:1341086085089857619>';

        if (this.state.defused) {
            return {
                content: `# ⏱️ ${timeStr}\n\nCzas na zegarze bomby został wstrzymany! <a:PepeSweat:1278017088153190502>`,
                components: []
            };
        }

        if (this.state.exploded) {
            return {
                content: `# ⏱️ ${timeStr}\n\n💥 Bomba wybuchła!`,
                components: []
            };
        }

        if (this.state.requiredChatters > 0) {
            const remaining = Math.max(0, this.state.requiredChatters - this.state.chatters.length);
            return {
                content: `## Bomba niedługo wybuchnie <a:X_Uwaga:1297531538186965003>\n# ${sideEmoji} ${timeStr} ${sideEmoji}\n\n${remaining} osób musi jeszcze napisać na tym czacie 💬`,
                components: []
            };
        }

        if (this.state.requiredReactions > 0) {
            const remaining = Math.max(0, this.state.requiredReactions - this.state.currentReactionCount);
            return {
                content: `## Bomba niedługo wybuchnie <a:X_Uwaga:1297531538186965003>\n# ${sideEmoji} ${timeStr} ${sideEmoji}\n\n${remaining} reakcji do zatrzymania licznika 💣`,
                components: []
            };
        }

        const remaining = this.getRemainingClicks();
        return {
            content: `## Bomba niedługo wybuchnie <a:X_Uwaga:1297531538186965003>\n# ${sideEmoji} ${timeStr} ${sideEmoji}\n\n👥 ${remaining} osób musi nacisnąć przycisk, żeby rozbroić 💣 bombę.`,
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

            const waitTime = Math.max(5000, 5000 - elapsed);
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
                this._triggerBombChaos();
                this.stopDisplayLoop();
                this.updateTimerMessage().catch(() => {});
                this.refreshControlPanel().catch(() => {});
                this._clearAllReactions().catch(() => {});
                if (this.state.requiredChatters > 0) this._lockAndCleanChannel().catch(() => {});
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
                msg.components[0]?.components?.some(c => c.customId?.startsWith('bomb_'))
            );

            if (existing) {
                await existing.edit({ components });
                this.controlPanelMessage = existing;
                logger.info('ℹ️ BombTimer: zaktualizowano panel kontrolny');
                return;
            }

            this.controlPanelMessage = await channel.send({ components });
            logger.success('✅ BombTimer: wysłano panel kontrolny');
        } catch (error) {
            logger.error('❌ BombTimer: błąd setupu panelu kontrolnego:', error.message);
        }
    }

    async refreshControlPanel() {
        if (!this.controlPanelMessage) return;
        try {
            await this.controlPanelMessage.edit({ components: this.buildControlRows() });
        } catch (err) {
            logger.error('❌ BombTimer: błąd odświeżania panelu kontrolnego:', err.message);
        }
    }

    async addTimeAndStart(seconds, requiredClicks, requiredReactions = 0, requiredChatters = 0) {
        this.stopInterval();
        this.state.timeRemaining = (this.state.timeRemaining || 0) + seconds;
        this.state.requiredClicks = requiredClicks;
        this.state.requiredReactions = requiredReactions;
        this.state.currentReactionCount = 0;
        this.state.requiredChatters = requiredChatters;
        this.state.chatters = [];
        this.state.defuseClicks = [];
        this.state.running = true;
        this.state.paused = false;
        this.state.defused = false;
        this.state.exploded = false;
        await this.saveState();
        this.startInterval();

        if (requiredReactions > 0) {
            this._addInitialReaction().catch(() => {});
        }
        if (requiredChatters > 0) {
            this._unlockChannel().catch(() => {});
        }
    }

    async _unlockChannel() {
        try {
            const channel = await this.getTimerChannel();
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: true,
            });
            logger.info('🔓 BombTimer: odblokowano kanał do pisania');
        } catch (error) {
            logger.error('❌ BombTimer: błąd odblokowywania kanału:', error.message);
        }
    }

    async _lockAndCleanChannel() {
        try {
            const channel = await this.getTimerChannel();

            // Zablokuj kanał
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: false,
            });
            logger.info('🔒 BombTimer: zablokowano kanał');

            // Usuń wszystkie wiadomości oprócz licznika
            let fetched;
            do {
                fetched = await channel.messages.fetch({ limit: 100 });
                const toDelete = fetched.filter(m => m.id !== this.state.timerMessageId);
                if (toDelete.size === 0) break;

                // bulkDelete działa tylko dla wiadomości < 14 dni
                const bulk = toDelete.filter(m => Date.now() - m.createdTimestamp < 12 * 24 * 60 * 60 * 1000);
                const old = toDelete.filter(m => Date.now() - m.createdTimestamp >= 12 * 24 * 60 * 60 * 1000);

                if (bulk.size > 1) await channel.bulkDelete(bulk);
                else if (bulk.size === 1) await bulk.first().delete().catch(() => {});
                for (const m of old.values()) await m.delete().catch(() => {});
            } while (fetched.size >= 2);

            logger.info('🧹 BombTimer: wyczyszczono kanał z wiadomości');
        } catch (error) {
            logger.error('❌ BombTimer: błąd blokowania/czyszczenia kanału:', error.message);
        }
    }

    async handleMessageCreate(message) {
        if (message.author.bot) return;
        if (!this.state.running || this.state.paused || this.state.defused || this.state.exploded) return;
        if (this.state.requiredChatters === 0) return;
        if (message.channel.id !== this.config.bombTimer.timerChannelId) return;

        if (this.state.chatters.includes(message.author.id)) return;

        this.state.chatters.push(message.author.id);
        await this.saveState();
        await this.updateTimerMessage();

        if (this.state.chatters.length >= this.state.requiredChatters) {
            this.stopInterval();
            this.state.defused = true;
            this.state.running = false;
            await this.saveState();
            await this.updateTimerMessage();
            this.refreshControlPanel().catch(() => {});
            this._lockAndCleanChannel().catch(() => {});
        }
    }

    async _addInitialReaction() {
        try {
            await new Promise(r => setTimeout(r, 600));
            const msg = await this.getOrCreateTimerMessage();
            await msg.react('🛠️');
        } catch (error) {
            logger.warn('⚠️ BombTimer: nie można dodać reakcji 🛠️:', error.message);
        }
    }

    async _syncReactionCount() {
        try {
            const channel = await this.getTimerChannel();
            const msg = await channel.messages.fetch(this.state.timerMessageId);
            this.cachedTimerMessage = msg;
            let total = 0;
            for (const r of msg.reactions.cache.values()) {
                const users = await r.users.fetch();
                total += users.filter(u => !u.bot).size;
            }
            this.state.currentReactionCount = total;
            logger.info(`🛠️ BombTimer: odczytano ${this.state.currentReactionCount} reakcji po restarcie`);
        } catch (error) {
            logger.warn('⚠️ BombTimer: nie można zsynchronizować licznika reakcji:', error.message);
        }
    }

    async handleReactionAdd(reaction, user) {
        if (user.bot) return;
        if (!this.state.running || this.state.defused || this.state.exploded) return;
        if (this.state.requiredReactions === 0) return;
        if (reaction.message.id !== this.state.timerMessageId) return;
        if (user.bot) return; // podwójne zabezpieczenie

        this.state.currentReactionCount++;
        await this.saveState();

        if (this.state.currentReactionCount >= this.state.requiredReactions) {
            this.stopInterval();
            this.state.defused = true;
            this.state.running = false;
            await this.saveState();
            await this.updateTimerMessage();
            this.refreshControlPanel().catch(() => {});
            this._clearAllReactions().catch(() => {});
            return;
        }
    }

    async handleReactionRemove(reaction, user) {
        if (user.bot) return;
        if (!this.state.running || this.state.defused || this.state.exploded) return;
        if (this.state.requiredReactions === 0) return;
        if (reaction.message.id !== this.state.timerMessageId) return;
        if (user.bot) return; // podwójne zabezpieczenie

        this.state.currentReactionCount = Math.max(0, this.state.currentReactionCount - 1);
        await this.saveState();
        await this.updateTimerMessage();
    }

    async pause() {
        if (!this.state.running || this.state.paused) return;
        this.stopInterval();
        this.state.paused = true;
        await this.saveState();
        await this.updateTimerMessage();
        this.refreshControlPanel().catch(() => {});
    }

    async resume() {
        if (!this.state.running || !this.state.paused || this.state.defused || this.state.exploded) return;
        this.state.paused = false;
        await this.saveState();
        this.startInterval();
        this.refreshControlPanel().catch(() => {});
    }

    async registerDefuseClick(userId) {
        if (!this.state.running || this.state.defused || this.state.exploded) return;
        if (this.state.requiredReactions > 0) return; // w trybie reakcji kliknięcia nie liczą

        this.state.defuseClicks.push({ userId, timestamp: new Date().toISOString() });
        await this.saveState();

        if (this.state.defuseClicks.length >= this.state.requiredClicks) {
            this.stopInterval();
            this.state.defused = true;
            this.state.running = false;
            this.state.defuseClicks = [];
            await this.saveState();
            await this.updateTimerMessage();
            this.refreshControlPanel().catch(() => {});
            this._clearAllReactions().catch(() => {});
        }
    }

    async _clearAllReactions() {
        try {
            const msg = await this.getOrCreateTimerMessage();
            await msg.reactions.removeAll();
        } catch (error) {
            logger.warn('⚠️ BombTimer: nie można usunąć reakcji po wybuchu:', error.message);
        }
    }

    getButtonIds() {
        return BTN;
    }

    isMyButton(customId) {
        return Object.values(BTN).includes(customId);
    }

    _triggerBombChaos() {
        try {
            const chaosFile = path.join(__dirname, '../../shared_data/bomb_chaos_state.json');
            const state = {
                active: true,
                expiresAt: Date.now() + 60 * 60 * 1000, // 1 godzina
            };
            fsSync.writeFileSync(chaosFile, JSON.stringify(state, null, 2), 'utf8');
            logger.info('💥 BombTimer: zapisano stan chaosu bombowego dla Konklawe (1h)');
        } catch (err) {
            logger.error('❌ BombTimer: błąd zapisu stanu chaosu:', err.message);
        }
    }

    cleanup() {
        this.stopInterval();
    }
}

module.exports = BombTimerService;
