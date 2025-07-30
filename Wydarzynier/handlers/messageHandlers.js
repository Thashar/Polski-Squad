const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

/**
 * Obsługa aktualizacji wiadomości (np. dodania reakcji)
 * @param {Message} oldMessage - Stara wiadomość
 * @param {Message} newMessage - Nowa wiadomość
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleMessageUpdate(oldMessage, newMessage, sharedState) {
    try {
        // Sprawdź czy to wiadomość lobby
        const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(newMessage.id);
        if (!lobby) return;

        // Sprawdź czy kanał się zgadza
        if (newMessage.channel.id !== sharedState.config.channels.party) return;

        // Sprawdź wszystkie reakcje na wiadomości
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

/**
 * Obsługa nowych wiadomości (funkcja wyłączona)
 * @param {Message} message - Nowa wiadomość
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleMessageCreate(message, sharedState) {
    // Funkcja wyłączona - nie filtrujemy już pingów
    return;
}

module.exports = {
    handleMessageUpdate,
    handleMessageCreate
};