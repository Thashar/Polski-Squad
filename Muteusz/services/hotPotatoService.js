const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const MAIN_START_SECONDS = 3600;   // 01:00:00
const POTATO_START_SECONDS = 180;  // 00:03:00
const POTATO_PASS_BONUS = 10;      // sekund dodawanych przy przekazaniu
const UPDATE_INTERVAL_MS = 10000;  // 10 sekund

function formatTime(seconds) {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

class HotPotatoService {
    constructor(config) {
        this.mainChannelId  = config.hotPotato.mainChannelId;
        this.potatoChannelId = config.hotPotato.potatoChannelId;
        this.roleId = config.hotPotato.roleId;

        this.mainMessageId   = null;
        this.potatoMessageId = null;

        this.mainTimeRemaining   = MAIN_START_SECONDS;
        this.potatoTimeRemaining = POTATO_START_SECONDS;

        this.mainRunning   = false;
        this.potatoRunning = false;
        this.currentHolderId = null;
        this.won = false;

        this.client = null;
        this._mainInterval   = null;
        this._potatoInterval = null;
    }

    // ─── Inicjalizacja ──────────────────────────────────────────────────────

    async initialize(client) {
        this.client = client;
        const mainChannel = await client.channels.fetch(this.mainChannelId).catch(() => null);
        if (!mainChannel) {
            logger.error('❌ HotPotato: nie znaleziono głównego kanału');
            return;
        }

        const messages = await mainChannel.messages.fetch({ limit: 20 }).catch(() => null);
        const existing  = messages?.find(m =>
            m.author.id === client.user.id && m.content?.startsWith('# ⏱️')
        );

        if (existing) {
            this.mainMessageId = existing.id;
            // Po restarcie resetujemy stan — gracze muszą zacząć od nowa
            this.mainTimeRemaining = MAIN_START_SECONDS;
            await existing.edit(this._buildMainData()).catch(() => {});
            logger.info('✅ HotPotato: znaleziono istniejącą wiadomość, stan zresetowany');
        } else {
            const msg = await mainChannel.send(this._buildMainData());
            this.mainMessageId = msg.id;
            logger.info('✅ HotPotato: wysłano główną wiadomość timera');
        }
    }

    // ─── Budowanie wiadomości ───────────────────────────────────────────────

    _buildMainData() {
        const data = { content: `# ⏱️ ${formatTime(this.mainTimeRemaining)}`, components: [] };
        if (!this.mainRunning && !this.won) {
            data.components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('hotpotato_start')
                        .setLabel('Rozpocznij zadanie')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🚀')
                )
            ];
        }
        return data;
    }

    _buildPotatoData() {
        return {
            content: [
                `# 💣 ${formatTime(this.potatoTimeRemaining)}`,
                ``,
                `<@${this.currentHolderId}> trzymasz bombę!`,
                `Przekaż ją kolejnej osobie zanim wybuchnie!`
            ].join('\n'),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('hotpotato_pass')
                        .setLabel('Przekaż bombę')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🥔')
                )
            ]
        };
    }

    // ─── Obsługa przycisków ─────────────────────────────────────────────────

    isMyButton(customId) {
        return customId === 'hotpotato_start' || customId === 'hotpotato_pass';
    }

    async handleButtonClick(interaction) {
        if (interaction.customId === 'hotpotato_start') {
            await this._handleStart(interaction);
        } else if (interaction.customId === 'hotpotato_pass') {
            await this._handlePass(interaction);
        }
    }

    async _handleStart(interaction) {
        if (this.mainRunning || this.won) {
            await interaction.reply({ content: 'Gra już trwa!', ephemeral: true });
            return;
        }
        await interaction.deferUpdate();
        this.mainRunning = true;
        await this._updateMainMessage();
        await this._startPotato();
        this._startIntervals();
        logger.info('🚀 HotPotato: gra rozpoczęta');
    }

    async _handlePass(interaction) {
        if (!this.potatoRunning) {
            await interaction.reply({ content: 'Gra nie jest aktywna.', ephemeral: true });
            return;
        }
        if (interaction.user.id !== this.currentHolderId) {
            await interaction.reply({ content: 'Nie trzymasz bomby!', ephemeral: true });
            return;
        }
        await interaction.deferUpdate();
        this.potatoTimeRemaining = Math.min(
            this.potatoTimeRemaining + POTATO_PASS_BONUS,
            POTATO_START_SECONDS
        );
        await this._pickNewHolder();
        await this._updatePotatoMessage();
    }

    // ─── Logika gry ─────────────────────────────────────────────────────────

    async _startPotato() {
        this.potatoTimeRemaining = POTATO_START_SECONDS;
        this.potatoRunning = true;
        await this._pickNewHolder();
        const channel = await this.client.channels.fetch(this.potatoChannelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.send(this._buildPotatoData());
        this.potatoMessageId = msg.id;
    }

    async _pickNewHolder() {
        try {
            const channel = await this.client.channels.fetch(this.potatoChannelId);
            const role = await channel.guild.roles.fetch(this.roleId);
            let candidates = [...role.members.values()];
            if (candidates.length > 1) {
                candidates = candidates.filter(m => m.id !== this.currentHolderId);
            }
            this.currentHolderId = candidates[Math.floor(Math.random() * candidates.length)].id;
        } catch (err) {
            logger.error('❌ HotPotato: błąd losowania użytkownika:', err.message);
        }
    }

    _startIntervals() {
        this._mainInterval = setInterval(async () => {
            if (!this.mainRunning) return;
            this.mainTimeRemaining = Math.max(0, this.mainTimeRemaining - 10);
            await this._updateMainMessage();
            if (this.mainTimeRemaining <= 0) await this._onWin();
        }, UPDATE_INTERVAL_MS);

        this._potatoInterval = setInterval(async () => {
            if (!this.potatoRunning) return;
            this.potatoTimeRemaining = Math.max(0, this.potatoTimeRemaining - 10);
            if (this.potatoTimeRemaining > 0) await this._updatePotatoMessage();
        }, UPDATE_INTERVAL_MS);
    }

    _stopIntervals() {
        if (this._mainInterval)   { clearInterval(this._mainInterval);   this._mainInterval   = null; }
        if (this._potatoInterval) { clearInterval(this._potatoInterval); this._potatoInterval = null; }
    }

    async _onWin() {
        this._stopIntervals();
        this.mainRunning   = false;
        this.potatoRunning = false;
        this.won = true;
        this.mainTimeRemaining = 0;

        await this._updateMainMessage();

        const mainChannel = await this.client.channels.fetch(this.mainChannelId).catch(() => null);
        if (mainChannel) await mainChannel.send('## 🎉 Wygrałeś!');

        await this._stopPotatoMessage();
        logger.success('🏆 HotPotato: Wygrałeś!');
    }

    // ─── Aktualizacje wiadomości ────────────────────────────────────────────

    async _updateMainMessage() {
        try {
            const channel = await this.client.channels.fetch(this.mainChannelId);
            const msg = await channel.messages.fetch(this.mainMessageId);
            await msg.edit(this._buildMainData());
        } catch (err) {
            logger.error('❌ HotPotato: błąd aktualizacji głównego timera:', err.message);
        }
    }

    async _updatePotatoMessage() {
        try {
            const channel = await this.client.channels.fetch(this.potatoChannelId);
            const msg = await channel.messages.fetch(this.potatoMessageId);
            await msg.edit(this._buildPotatoData());
        } catch (err) {
            logger.error('❌ HotPotato: błąd aktualizacji timera bomby:', err.message);
        }
    }

    async _stopPotatoMessage() {
        try {
            const channel = await this.client.channels.fetch(this.potatoChannelId);
            const msg = await channel.messages.fetch(this.potatoMessageId);
            await msg.edit({
                content: `# 💣 ${formatTime(this.potatoTimeRemaining)}\n\nBomba została rozbrojona!`,
                components: []
            });
        } catch (err) {
            logger.error('❌ HotPotato: błąd zatrzymania bomby:', err.message);
        }
    }

    // ─── Akcje z panelu ─────────────────────────────────────────────────────

    async reset() {
        this._stopIntervals();
        this.mainTimeRemaining   = MAIN_START_SECONDS;
        this.potatoTimeRemaining = POTATO_START_SECONDS;
        this.mainRunning   = false;
        this.potatoRunning = false;
        this.currentHolderId = null;
        this.won = false;

        await this._updateMainMessage();

        if (this.potatoMessageId) {
            try {
                const channel = await this.client.channels.fetch(this.potatoChannelId);
                const msg = await channel.messages.fetch(this.potatoMessageId).catch(() => null);
                if (msg) await msg.delete();
            } catch (_) {}
            this.potatoMessageId = null;
        }
        logger.info('🔄 HotPotato: gra zresetowana');
    }

    async minusFiveMinutes() {
        this.mainTimeRemaining = Math.max(0, this.mainTimeRemaining - 300);
        if (this.mainTimeRemaining <= 0 && this.mainRunning) {
            await this._onWin();
        } else {
            await this._updateMainMessage();
        }
        logger.info(`⏬ HotPotato: odejmiono 5 minut (pozostało: ${formatTime(this.mainTimeRemaining)})`);
    }
}

module.exports = HotPotatoService;
