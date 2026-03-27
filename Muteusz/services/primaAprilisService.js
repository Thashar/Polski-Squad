const fs = require('fs').promises;
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const DATA_FILE = path.join(__dirname, '../data/prima_aprilis_roles.json');

const BUTTON_CUSTOM_ID = 'prima_aprilis_nie_klikac_button';
const BUTTON_LABEL = 'NIE KLIKAĆ POD ŻADNYM POZOREM';

const PASSWORD_ROTATION_MS = 5 * 60 * 1000; // 5 minut

class PrimaAprilisService {
    constructor(config) {
        this.config = config;
        this.data = {};
        this.currentPassword = null;
        this.passwordTimer = null;
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
                logger.info(`🔑 PrimaAprilis: aktualne hasło: "${this.currentPassword}" (zmiana za ${Math.round((PASSWORD_ROTATION_MS - elapsed) / 1000)}s)`);
                return;
            }
        }
        // Brak hasła lub wygasłe - wybierz nowe
        await this._pickNewPassword();
    }

    _getPasswords() {
        return this.config.primaAprilis.passwords.filter(p => p && p.trim() !== '');
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
        logger.info(`🔑 PrimaAprilis: hasło zmienione na "${this.currentPassword}"`);
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
                if (this.isMessageCurrent(existing)) {
                    logger.info('ℹ️ PrimaAprilis: wiadomość z przyciskiem już istnieje i jest aktualna, pomijam.');
                    return;
                }
                await existing.edit({ components: [row] });
                logger.success('✅ PrimaAprilis: zaktualizowano istniejącą wiadomość z przyciskiem');
                return;
            }

            await channel.send({ components: [row] });
            logger.success('✅ PrimaAprilis: wysłano wiadomość z przyciskiem');
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy setupie wiadomości:', error.message);
        }
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
