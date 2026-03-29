const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const DATA_FILE = path.join(__dirname, '../data/prima_aprilis_roles.json');

const BUTTON_CUSTOM_ID = 'prima_aprilis_nie_klikac_button';
const BUTTON_LABEL = 'NIE KLIKAĆ POD ŻADNYM POZOREM';
const PASSWORD_ROTATE_BTN_ID = 'prima_password_rotate';

const PASSWORD_ROTATION_MS = 5 * 60 * 1000; // 5 minut

const PASSWORD_CHANNEL_ID = '1486955310139707452';

class PrimaAprilisService {
    constructor(config) {
        this.config = config;
        this.data = {};
        this.currentPassword = null;
        this.passwordTimer = null;
        this.client = null;
        this._processingUsers = new Set(); // ochrona przed podwójnym kliknięciem
        this._saveQueue = Promise.resolve(); // kolejka zapisów - zapobiega wyścigowi na pliku
    }

    async initialize() {
        try {
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            this.data = JSON.parse(raw);
        } catch {
            this.data = {};
        }

        // Wczytaj lub wybierz hasło startowe
        await this._initPassword();

        const passwordCount = this._getPasswords().length;
        logger.info(`🔑 PrimaAprilis: załadowano ${passwordCount} haseł`);

        const trapped = Object.keys(this.data).filter(k => k !== '_passwordState').length;
        if (trapped > 0) {
            logger.info(`🔒 PrimaAprilis: ${trapped} użytkownik(ów) nadal uwięzionych po restarcie`);
        }

        this._startPasswordTimer();
        logger.info('✅ PrimaAprilisService zainicjalizowany');
    }

    async _initPassword() {
        const state = this.data._passwordState;
        if (state?.current && state?.changedAt) {
            const elapsed = Date.now() - new Date(state.changedAt).getTime();
            if (elapsed < PASSWORD_ROTATION_MS) {
                // Hasło jest nadal aktualne - użyj go
                this.currentPassword = state.current;
                return;
            }
        }
        // Brak hasła lub wygasłe - wybierz nowe
        await this._pickNewPassword();
    }

    _getPasswords() {
        try {
            const envPath = path.join(__dirname, '../.env');
            logger.info(`🔍 PrimaAprilis: czytam hasła z ${envPath}`);
            const content = fsSync.readFileSync(envPath, 'utf8');
            const lines = content.split(/\r?\n/);
            logger.info(`🔍 PrimaAprilis: plik ma ${lines.length} linii`);
            const passwords = [];
            for (const line of lines) {
                const match = line.match(/^HASLO\d+=(.+)$/);
                if (match) passwords.push(match[1].trim());
            }
            logger.info(`🔍 PrimaAprilis: znaleziono ${passwords.length} haseł w pliku`);
            return passwords.filter(Boolean);
        } catch (err) {
            logger.error(`❌ PrimaAprilis: błąd czytania pliku .env: ${err.message}`);
            return Array.from({ length: 50 }, (_, i) => process.env[`HASLO${i + 1}`]).filter(Boolean);
        }
    }

    async _pickNewPassword() {
        const passwords = this._getPasswords();
        if (passwords.length === 0) {
            logger.warn('⚠️ PrimaAprilis: brak haseł w konfiguracji');
            this.currentPassword = null;
            return;
        }
        const available = passwords.filter(p => p !== this.currentPassword);
        const pool = available.length > 0 ? available : passwords;
        this.currentPassword = pool[Math.floor(Math.random() * pool.length)];
        this.data._passwordState = {
            current: this.currentPassword,
            changedAt: new Date().toISOString()
        };
        await this.saveData();
        await this._updatePasswordMessage();
    }

    _startPasswordTimer() {
        if (this.passwordTimer) clearInterval(this.passwordTimer);
        this.passwordTimer = setInterval(async () => {
            await this._pickNewPassword();
        }, PASSWORD_ROTATION_MS);
    }

    async rotatePassword() {
        await this._pickNewPassword();
        // Zresetuj timer od zera po ręcznej rotacji
        this._startPasswordTimer();
    }

    /**
     * Sprawdza wpisane hasło przez uwięzionego użytkownika.
     * Jeśli poprawne - zwalnia go i rotuje hasło.
     * @param {GuildMember} member
     * @param {string} input
     * @returns {boolean} true jeśli hasło poprawne
     */
    async tryPassword(member, input) {
        if (!this.isTrapped(member.id)) return false;
        if (!member.roles.cache.has('1486506395057524887')) return false;
        if (!this.currentPassword) return false;
        const normalize = s => s.trim().toLowerCase().replace(/_/g, ' ');
        if (normalize(input) !== normalize(this.currentPassword)) return false;

        await this.freeUser(member);
        await this.rotatePassword();
        return true;
    }

    saveData() {
        this._saveQueue = this._saveQueue.then(() =>
            fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8')
        );
        return this._saveQueue;
    }

    buildButtonRow() {
        const button = new ButtonBuilder()
            .setCustomId(BUTTON_CUSTOM_ID)
            .setLabel(BUTTON_LABEL)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🛑');

        return new ActionRowBuilder().addComponents(button);
    }

    isMessageCurrent(message) {
        if (!message.components || message.components.length === 0) return false;
        const row = message.components[0];
        if (!row.components || row.components.length === 0) return false;
        const btn = row.components[0];
        return btn.customId === BUTTON_CUSTOM_ID && btn.label === BUTTON_LABEL;
    }

    async setupButtonMessage(client) {
        const channelId = this.config.primaAprilis.channelId;
        if (!channelId) {
            logger.warn('⚠️ PrimaAprilis: brak channelId w konfiguracji');
            return;
        }

        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                logger.warn('⚠️ PrimaAprilis: nie znaleziono kanału');
                return;
            }

            const row = this.buildButtonRow();
            const messages = await channel.messages.fetch({ limit: 50 });
            const existing = messages.find(msg =>
                msg.author.id === client.user.id &&
                msg.components?.length > 0 &&
                msg.components[0]?.components?.[0]?.customId === BUTTON_CUSTOM_ID
            );

            if (existing) {
                this._buttonMessage = existing;
                if (this.isMessageCurrent(existing)) {
                    logger.info('ℹ️ PrimaAprilis: wiadomość z przyciskiem już istnieje i jest aktualna, pomijam.');
                    return;
                }
                await existing.edit({ components: [row] });
                logger.success('✅ PrimaAprilis: zaktualizowano istniejącą wiadomość z przyciskiem');
                return;
            }

            this._buttonMessage = await channel.send({ components: [row] });
            logger.success('✅ PrimaAprilis: wysłano wiadomość z przyciskiem');
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy setupie wiadomości:', error.message);
        }
    }

    async disableTrapButton() {
        if (!this._buttonMessage) return;
        try {
            const disabledBtn = new ButtonBuilder()
                .setCustomId(BUTTON_CUSTOM_ID)
                .setLabel(BUTTON_LABEL)
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🛑')
                .setDisabled(true);
            await this._buttonMessage.edit({ components: [new ActionRowBuilder().addComponents(disabledBtn)] });
            logger.info('🔒 PrimaAprilis: przycisk dezaktywowany');
        } catch (err) {
            logger.error('❌ PrimaAprilis: błąd dezaktywacji przycisku:', err.message);
        }
    }

    async freeAllTrapped(guild) {
        const entries = Object.entries(this.data)
            .filter(([key]) => key !== '_passwordState')
            .sort(([, a], [, b]) => new Date(a.savedAt) - new Date(b.savedAt));

        if (entries.length === 0) return;
        logger.info(`🔓 PrimaAprilis: zwalnianie wszystkich ${entries.length} uwięzionych użytkowników...`);

        for (const [userId] of entries) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await this.freeUser(member);
                } else {
                    // Użytkownik opuścił serwer — wyczyść dane
                    delete this.data[userId];
                    await this.saveData();
                }
            } catch (err) {
                logger.error(`❌ PrimaAprilis: błąd zwalniania ${userId}:`, err.message);
            }
        }
        logger.info('✅ PrimaAprilis: wszyscy użytkownicy zwolnieni');
    }

    async trapUser(member) {
        const userId = member.id;

        // Ochrona przed race condition: ten sam użytkownik klikający dwa razy zanim cache się zaktualizuje
        if (this._processingUsers.has(userId)) return;
        if (this.data[userId]) return; // już uwięziony

        this._processingUsers.add(userId);
        try {
            const prisonRoleId = this.config.primaAprilis.prisonRoleId;

            const rolesToSave = member.roles.cache
                .filter(r => r.id !== member.guild.id && r.id !== prisonRoleId)
                .map(r => r.id);

            this.data[userId] = {
                roles: rolesToSave,
                savedAt: new Date().toISOString()
            };
            await this.saveData();

            // Jeden request PATCH: usuń wszystkie role i nadaj rolę więźnia jednocześnie
            const newRoles = [prisonRoleId];
            try {
                await member.roles.set(newRoles);
            } catch (err) {
                logger.error(`❌ Nie można ustawić ról dla ${member.user.tag}: ${err.message}`);
            }

            logger.info(`🔒 PrimaAprilis: złapano ${member.user.tag} - zapisano ${rolesToSave.length} ról`);
        } finally {
            this._processingUsers.delete(userId);
        }
    }

    async freeUser(member) {
        const userId = member.id;
        const prisonRoleId = this.config.primaAprilis.prisonRoleId;

        if (!this.data[userId]) return false;

        const savedRoles = this.data[userId].roles;

        // Jeden request PATCH: usuń rolę więźnia i przywróć wszystkie role jednocześnie
        try {
            await member.roles.set(savedRoles);
        } catch (err) {
            logger.warn(`⚠️ Nie można przywrócić ról dla ${member.user.tag}: ${err.message}`);
        }

        delete this.data[userId];
        await this.saveData();

        logger.info(`🔓 PrimaAprilis: uwolniono ${member.user.tag} - przywrócono ${savedRoles.length} ról`);
        return true;
    }

    isTrapped(userId) {
        return !!this.data[userId];
    }

    /**
     * Wywołaj gdy uwięziony użytkownik wraca na serwer — nadaje mu z powrotem rolę więźnia.
     * @param {GuildMember} member
     */
    async handleMemberRejoin(member) {
        const userId = member.id;
        if (!this.data[userId]) return;

        const prisonRoleId = this.config.primaAprilis.prisonRoleId;
        try {
            await member.roles.add(prisonRoleId);
            logger.info(`🔒 PrimaAprilis: ${member.user.tag} wrócił na serwer - przywrócono rolę gracza`);
        } catch (err) {
            logger.error(`❌ PrimaAprilis: nie można nadać roli gracza po powrocie ${member.user.tag}: ${err.message}`);
        }
    }

    async setupPasswordMessage(client) {
        this.client = client;

        try {
            const channel = await client.channels.fetch(PASSWORD_CHANNEL_ID);
            const messages = await channel.messages.fetch({ limit: 50 });

            // Szukaj istniejącej wiadomości bota z hasłem
            const savedMsgId = this.data._passwordMessageId;
            let existing = savedMsgId
                ? messages.find(m => m.id === savedMsgId && m.author.id === client.user.id)
                : null;

            if (existing) {
                await existing.edit(this._buildPasswordContent());
                this.data._passwordMessageId = existing.id;
                logger.info('✅ PrimaAprilis: zaktualizowano istniejącą wiadomość z hasłem');
            } else {
                const msg = await channel.send(this._buildPasswordContent());
                this.data._passwordMessageId = msg.id;
                logger.info('✅ PrimaAprilis: wysłano wiadomość z hasłem');
            }

            await this.saveData();
        } catch (err) {
            logger.error('❌ PrimaAprilis: błąd setupu wiadomości z hasłem:', err.message);
        }
    }

    _buildPasswordContent() {
        const pwd = this.currentPassword ?? '(brak)';
        const normalized = pwd.replace(/_/g, ' ');
        const display = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
        const rotateBtn = new ButtonBuilder()
            .setCustomId(PASSWORD_ROTATE_BTN_ID)
            .setLabel('Resetuj hasło')
            .setStyle(ButtonStyle.Danger);
        return {
            content: display,
            components: [new ActionRowBuilder().addComponents(rotateBtn)]
        };
    }

    getPasswordRotateBtnId() {
        return PASSWORD_ROTATE_BTN_ID;
    }

    async _updatePasswordMessage() {
        if (!this.client || !this.data._passwordMessageId) return;
        try {
            const channel = await this.client.channels.fetch(PASSWORD_CHANNEL_ID);
            const msg = await channel.messages.fetch(this.data._passwordMessageId);
            await msg.edit(this._buildPasswordContent());
        } catch (err) {
            logger.warn('⚠️ PrimaAprilis: nie można zaktualizować wiadomości z hasłem:', err.message);
        }
    }

    getButtonCustomId() {
        return BUTTON_CUSTOM_ID;
    }

    cleanup() {
        if (this.passwordTimer) {
            clearInterval(this.passwordTimer);
            this.passwordTimer = null;
        }
    }
}

module.exports = PrimaAprilisService;
