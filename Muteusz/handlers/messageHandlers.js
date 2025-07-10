const { logWithTimestamp } = require('../utils/helpers');

class MessageHandler {
    constructor(config, mediaService, logService) {
        this.config = config;
        this.mediaService = mediaService;
        this.logService = logService;
    }

    /**
     * Obsługuje wiadomości
     * @param {Message} message - Wiadomość Discord
     * @param {Client} client - Klient Discord
     */
    async handleMessage(message, client) {
        // Ignoruj wiadomości botów i wiadomości z kanału docelowego
        if (message.author.bot || message.channel.id === this.config.media.targetChannelId) {
            return;
        }
        
        // Sprawdź czy wiadomość ma załączniki
        if (message.attachments.size > 0) {
            await this.mediaService.repostMedia(message, client);
        }
    }
}

module.exports = MessageHandler;