const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

class MemberNotificationService {
    constructor(config) {
        this.config = config;
        this.client = null;
    }

    /**
     * Inicjalizuje serwis powiadomień
     * @param {Client} client - Klient Discord
     */
    initialize(client) {
        this.client = client;
        
        if (this.config.memberNotifications.enabled) {
            logger.info('Serwis powiadomień o członkach został zainicjalizowany');
        }
    }

    /**
     * Obsługuje dołączenie nowego członka
     * @param {GuildMember} member - Nowy członek serwera
     */
    async handleMemberJoin(member) {
        if (!this.config.memberNotifications.enabled) return;

        try {
            const channel = this.client.channels.cache.get(this.config.memberNotifications.channelId);
            if (!channel) {
                logger.error(`Nie znaleziono kanału powiadomień: ${this.config.memberNotifications.channelId}`);
                return;
            }

            const joinMessage = `${member} jest w drodze na serwer ${this.config.memberNotifications.emojis.join}`;
            
            await channel.send(joinMessage);
            logger.info(`📥 Powiadomienie o dołączeniu: ${member.user.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd wysyłania powiadomienia o dołączeniu: ${error.message}`);
        }
    }

    /**
     * Obsługuje opuszczenie serwera przez członka
     * @param {GuildMember} member - Członek który opuścił serwer
     */
    async handleMemberLeave(member) {
        if (!this.config.memberNotifications.enabled) return;

        try {
            const channel = this.client.channels.cache.get(this.config.memberNotifications.channelId);
            if (!channel) {
                logger.error(`Nie znaleziono kanału powiadomień: ${this.config.memberNotifications.channelId}`);
                return;
            }

            // Użyj nick lub username w pogrubieniu (bez pinga)
            const displayName = member.nickname || member.user.username;
            const leaveMessage = `**${displayName}** odszedł ${this.config.memberNotifications.emojis.leave} Będziemy tęsknić...`;
            
            await channel.send(leaveMessage);
            logger.info(`📤 Powiadomienie o opuszczeniu: ${member.user.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd wysyłania powiadomienia o opuszczeniu: ${error.message}`);
        }
    }
}

module.exports = MemberNotificationService;