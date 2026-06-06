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
        
        // No initialization needed

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
            logger.info(`📥 Powiadomienie o dołączeniu: ${member.user.username}`);
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

            // Pobierz nick serwerowy i nazwę Discord
            const discordName = member.user.username;
            const nickname = member.nickname;

            // Link do profilu z nickiem Discord jako etykieta
            const displayName = nickname && nickname !== discordName ? nickname : discordName;
            const profileLink = `[${displayName}](https://discord.com/users/${member.user.id})`;
            const leaveMessage = `${profileLink} odszedł ${this.config.memberNotifications.emojis.leave} Będziemy tęsknić...`;

            await channel.send(leaveMessage);
            logger.info(`📤 Powiadomienie o opuszczeniu: ${member.user.username}${nickname ? ` (nick: ${nickname})` : ''}`);
        } catch (error) {
            logger.error(`❌ Błąd wysyłania powiadomienia o opuszczeniu: ${error.message}`);
        }
    }
}

module.exports = MemberNotificationService;