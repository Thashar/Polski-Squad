const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    updateUserEphemeralReply
};
