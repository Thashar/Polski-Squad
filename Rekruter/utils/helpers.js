const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kasuje wiadomość, opcjonalnie po odczekaniu.
 *
 * ⚠️ `opoznienieMs` istnieje z powodu „duchów" w kliencie Discorda: gdy bot skasuje
 * wiadomość w tej samej chwili, w której powstała, klient autora potrafi zostawić ją
 * na ekranie. Na serwerze jej już nie ma (po odświeżeniu aplikacji znika), ale autor
 * widzi ją i nie jest w stanie usunąć. Chwila przerwy daje klientowi czas na
 * potwierdzenie wysyłki, zanim przyjdzie zdarzenie usunięcia.
 */
async function safeDeleteMessage(message, opoznienieMs = 0) {
    if (opoznienieMs > 0) await delay(opoznienieMs);

    const kanal = message.channel?.name ? `#${message.channel.name}` : message.channel?.id;

    try {
        await message.delete();
        logger.info(`[MESSAGE] ✅ Usunięto wiadomość od ${message.author.username} (${kanal})`);
    } catch (error) {
        // Kod błędu bardzo pomaga w diagnozie: 50013 = brak uprawnień, 10008 = wiadomość już nie istnieje
        logger.error(`[MESSAGE] ❌ Nie udało się usunąć wiadomości od ${message.author.username} (${kanal}): ${error.message} [kod ${error.code ?? 'brak'}]`);
    }
}

async function updateUserEphemeralReply(userId, content, components = [], userEphemeralReplies, files = []) {
    const userReply = userEphemeralReplies.get(userId);
    if (!userReply) {
        logger.info(`[BOT] Brak ephemeral reply dla użytkownika ${userId}`);
        return;
    }

    try {
        // Widoczność ustalono przy pierwszej odpowiedzi - editReply flagi nie przyjmuje
        await userReply.editReply({
            content: content,
            components: components,
            files: files
        });
        logger.info(`[BOT] ✅ Zaktualizowano ephemeral reply dla użytkownika ${userId}`);
    } catch (error) {
        logger.error(`[BOT] ❌ Błąd podczas aktualizacji ephemeral reply:`, error);
    }
}

module.exports = {
    delay,
    safeDeleteMessage,
    updateUserEphemeralReply
};
