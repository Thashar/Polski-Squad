const { createLogEmbed } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
class LogService {
    constructor(config) {
        this.config = config;
        this.client = null;
    }

    /**
     * Inicjalizuje serwis logowania
     * @param {Client} client - Klient Discord
     */
    initialize(client) {
        this.client = client;
        logger.info('Serwis logowania został zainicjalizowany');
    }

    /**
     * Loguje wiadomość do konsoli i kanału
     * @param {string} type - Typ wiadomości (info, warn, error, success)
     * @param {string} message - Wiadomość do zalogowania
     * @param {Object} interaction - Interakcja Discord (opcjonalnie)
     */
    async logMessage(type, message, interaction = null) {
        // Zawsze loguj do konsoli jeśli włączone
        if (this.config.logging.enableConsoleLogging) {
            if (type === 'error') {
                logger.error(message);
            } else if (type === 'warn') {
                logger.warn(message);
            } else {
                logger.info(message);
            }
        }
        
        // Loguj do kanału jeśli włączone
        if (this.config.logging.enableChannelLogging && this.config.logging.logChannelId && this.client) {
            try {
                const logChannel = this.client.channels.cache.get(this.config.logging.logChannelId);
                if (logChannel) {
                    const embed = createLogEmbed(type, message, interaction);
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (error) {
                const errorMessage = error?.message || 'Nieznany błąd';
                logger.error('Błąd podczas logowania do kanału:', errorMessage);
            }
        }
    }

    /**
     * Loguje wydarzenie usunięcia roli
     * @param {Array} removedRoles - Usunięte role
     * @param {GuildMember} member - Członek serwera
     * @param {string} reason - Przyczyna usunięcia ról
     */
    async logRoleRemoval(removedRoles, member, reason) {
        if (!this.config.logging.enableChannelLogging || !this.config.logging.logChannelId || !this.client) return;
        
        try {
            const logChannel = this.client.channels.cache.get(this.config.logging.logChannelId);
            if (logChannel) {
                const { EmbedBuilder } = require('discord.js');
                
                const embed = new EmbedBuilder()
                    .setTitle('🔄 Automatyczne usunięcie i zapisanie ról')
                    .setDescription(`Automatycznie usunięto powiązane role i zapisano je do przywrócenia.`)
                    .addFields([
                        { name: '👤 Użytkownik', value: `${member.user.tag} (${member.user.id})`, inline: true },
                        { name: '🏠 Serwer', value: member.guild.name, inline: true },
                        { name: '📝 Przyczyna', value: reason, inline: false },
                        { name: '🗑️ Usunięte i zapisane role', value: removedRoles.map(role => `<@&${role.id}>`).join(', '), inline: false }
                    ])
                    .setColor(0xFFA500)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();

                await logChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            const errorMessage = error?.message || 'Nieznany błąd';
            logger.error(`Błąd logowania usunięcia ról: ${errorMessage}`);
        }
    }

    /**
     * Loguje wydarzenie przywrócenia roli
     * @param {Array} restoredRoles - Przywrócone role
     * @param {GuildMember} member - Członek serwera
     * @param {string} reason - Przyczyna przywrócenia ról
     */
    async logRoleRestoration(restoredRoles, member, reason) {
        if (!this.config.logging.enableChannelLogging || !this.config.logging.logChannelId || !this.client) return;
        
        try {
            const logChannel = this.client.channels.cache.get(this.config.logging.logChannelId);
            if (logChannel) {
                const { EmbedBuilder } = require('discord.js');
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Automatyczne przywrócenie ról')
                    .setDescription(`Automatycznie przywrócono wcześniej zapisane role.`)
                    .addFields([
                        { name: '👤 Użytkownik', value: `${member.user.tag} (${member.user.id})`, inline: true },
                        { name: '🏠 Serwer', value: member.guild.name, inline: true },
                        { name: '📝 Przyczyna', value: reason, inline: false },
                        { name: '✅ Przywrócone role', value: restoredRoles.map(role => `<@&${role.id}>`).join(', '), inline: false }
                    ])
                    .setColor(0x00FF00)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();

                await logChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            const errorMessage = error?.message || 'Nieznany błąd';
            logger.error(`Błąd logowania przywrócenia ról: ${errorMessage}`);
        }
    }
}

module.exports = LogService;