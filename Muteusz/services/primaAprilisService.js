const fs = require('fs').promises;
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const DATA_FILE = path.join(__dirname, '../data/prima_aprilis_roles.json');

// Identyfikator przycisku - używany do wyszukiwania istniejącej wiadomości
const BUTTON_CUSTOM_ID = 'prima_aprilis_nie_klikac_button';
const BUTTON_LABEL = 'NIE KLIKAĆ POD ŻADNYM POZOREM';

class PrimaAprilisService {
    constructor(config) {
        this.config = config;
        this.data = {};
    }

    async initialize() {
        try {
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            this.data = JSON.parse(raw);
            const trapped = Object.keys(this.data).length;
            if (trapped > 0) {
                logger.info(`🔒 PrimaAprilis: ${trapped} użytkownik(ów) nadal uwięzionych po restarcie`);
            }
        } catch {
            this.data = {};
            await this.saveData();
        }
        logger.info('✅ PrimaAprilisService zainicjalizowany');
    }

    async saveData() {
        await fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    }

    /**
     * Buduje wiersz z przyciskiem "NIE KLIKAĆ"
     */
    buildButtonRow() {
        const button = new ButtonBuilder()
            .setCustomId(BUTTON_CUSTOM_ID)
            .setLabel(BUTTON_LABEL)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🛑');

        return new ActionRowBuilder().addComponents(button);
    }

    /**
     * Sprawdza czy istniejąca wiadomość bota pasuje do oczekiwanej
     * (czy ma przycisk z właściwym customId i label)
     */
    isMessageCurrent(message) {
        if (!message.components || message.components.length === 0) return false;
        const row = message.components[0];
        if (!row.components || row.components.length === 0) return false;
        const btn = row.components[0];
        return btn.customId === BUTTON_CUSTOM_ID && btn.label === BUTTON_LABEL;
    }

    /**
     * Wysyła lub aktualizuje wiadomość z przyciskiem na kanale prima aprilis.
     * Przy starcie sprawdza czy wiadomość już istnieje - jeśli tak i jest aktualna, pomija.
     * Jeśli istnieje ale się zmieniła, aktualizuje. Jeśli nie istnieje, tworzy nową.
     */
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

            // Szukaj istniejącej wiadomości bota z przyciskiem prima aprilis
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
                // Wiadomość istnieje ale treść się zmieniła - zaktualizuj
                await existing.edit({ components: [row] });
                logger.success('✅ PrimaAprilis: zaktualizowano istniejącą wiadomość z przyciskiem');
                return;
            }

            // Brak wiadomości - stwórz nową
            await channel.send({ components: [row] });
            logger.success('✅ PrimaAprilis: wysłano wiadomość z przyciskiem');
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy setupie wiadomości:', error.message);
        }
    }

    /**
     * Zapisuje role użytkownika, odbiera je i nadaje rolę więźnia.
     * @param {GuildMember} member
     */
    async trapUser(member) {
        const userId = member.id;
        const prisonRoleId = this.config.primaAprilis.prisonRoleId;

        // Pobierz wszystkie role oprócz @everyone i roli więźnia
        const rolesToSave = member.roles.cache
            .filter(r => r.id !== member.guild.id && r.id !== prisonRoleId)
            .map(r => r.id);

        // Zapisz role do pliku
        this.data[userId] = {
            roles: rolesToSave,
            savedAt: new Date().toISOString()
        };
        await this.saveData();

        // Usuń wszystkie zapisane role
        for (const roleId of rolesToSave) {
            try {
                await member.roles.remove(roleId);
            } catch (err) {
                logger.warn(`⚠️ Nie można usunąć roli ${roleId} od ${member.user.tag}: ${err.message}`);
            }
        }

        // Nadaj rolę więźnia
        try {
            await member.roles.add(prisonRoleId);
        } catch (err) {
            logger.error(`❌ Nie można nadać roli więźnia ${member.user.tag}: ${err.message}`);
        }

        logger.info(`🔒 PrimaAprilis: złapano ${member.user.tag} - zapisano ${rolesToSave.length} ról`);
    }

    /**
     * Przywraca zapisane role użytkownika i usuwa rolę więźnia.
     * @param {GuildMember} member
     * @returns {boolean} true jeśli użytkownik był uwięziony
     */
    async freeUser(member) {
        const userId = member.id;
        const prisonRoleId = this.config.primaAprilis.prisonRoleId;

        if (!this.data[userId]) return false;

        const savedRoles = this.data[userId].roles;

        // Usuń rolę więźnia
        try {
            await member.roles.remove(prisonRoleId);
        } catch (err) {
            logger.warn(`⚠️ Nie można usunąć roli więźnia od ${member.user.tag}: ${err.message}`);
        }

        // Przywróć wszystkie zapisane role
        for (const roleId of savedRoles) {
            try {
                await member.roles.add(roleId);
            } catch (err) {
                logger.warn(`⚠️ Nie można przywrócić roli ${roleId} dla ${member.user.tag}: ${err.message}`);
            }
        }

        delete this.data[userId];
        await this.saveData();

        logger.info(`🔓 PrimaAprilis: uwolniono ${member.user.tag} - przywrócono ${savedRoles.length} ról`);
        return true;
    }

    /**
     * Sprawdza czy użytkownik jest aktualnie uwięziony
     */
    isTrapped(userId) {
        return !!this.data[userId];
    }

    getButtonCustomId() {
        return BUTTON_CUSTOM_ID;
    }
}

module.exports = PrimaAprilisService;
