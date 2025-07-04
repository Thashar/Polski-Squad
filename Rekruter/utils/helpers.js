function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeDeleteMessage(message) {
    try {
        await message.delete();
        console.log(`[MESSAGE] ✅ Usunięto wiadomość od ${message.author.username}`);
    } catch (error) {
        console.log(`[MESSAGE] ❌ Nie udało się usunąć wiadomości od ${message.author.username}`);
    }
}

async function updateUserEphemeralReply(userId, content, components = [], userEphemeralReplies) {
    const userReply = userEphemeralReplies.get(userId);
    if (!userReply) {
        console.log(`[BOT] Brak ephemeral reply dla użytkownika ${userId}`);
        return;
    }

    try {
        await userReply.editReply({
            content: content,
            components: components,
            ephemeral: true
        });
        console.log(`[BOT] ✅ Zaktualizowano ephemeral reply dla użytkownika ${userId}`);
    } catch (error) {
        console.error(`[BOT] ❌ Błąd podczas aktualizacji ephemeral reply:`, error);
    }
}

module.exports = {
    delay,
    safeDeleteMessage,
    updateUserEphemeralReply
};
