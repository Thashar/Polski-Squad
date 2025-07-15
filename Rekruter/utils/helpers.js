const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeDeleteMessage(message) {
    try {
        await message.delete();
        logger.info(`[MESSAGE] ✅ Usunięto wiadomość od ${message.author.username}`);
    } catch (error) {
        logger.error(`[MESSAGE] ❌ Nie udało się usunąć wiadomości od ${message.author.username}`);
    }
}

async function updateUserEphemeralReply(userId, content, components = [], userEphemeralReplies) {
    const userReply = userEphemeralReplies.get(userId);
    if (!userReply) {
        logger.info(`[BOT] Brak ephemeral reply dla użytkownika ${userId}`);
        return;
    }

    try {
        await userReply.editReply({
            content: content,
            components: components,
            ephemeral: true
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
