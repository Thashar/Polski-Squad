const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

async function handleMessageUpdate(oldMessage, newMessage, sharedState) {
    try {
        const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(newMessage.id);
        if (!lobby) return;

        if (newMessage.channel.id !== sharedState.config.channels.party) return;

        const allowedEmoji = sharedState.config.emoji.ticket;

        for (const [emojiId, reaction] of newMessage.reactions.cache) {
            if (reaction.emoji.toString() !== allowedEmoji) {
                try {
                    await reaction.remove();
                    logger.info(`🚫 Usunięto nieprawidłową reakcję: ${reaction.emoji.toString()} z wiadomości lobby podczas aktualizacji`);
                } catch (error) {
                    logger.error('❌ Błąd podczas usuwania reakcji:', error);
                }
            }
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi aktualizacji wiadomości:', error);
    }
}

module.exports = {
    handleMessageUpdate,
};
