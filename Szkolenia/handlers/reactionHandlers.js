const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');
/**
 * Obsługa reakcji do zakładania wątków szkoleniowych.
 * -------------------------------------------------
 * • reakcja N_SSS do tworzenia wątku pomocy
 * • sprawdzanie uprawnień użytkownika
 * • tworzenie lub odnajdywanie istniejącego wątku
 */

/**
 * Obsługa dodania reakcji
 * @param {MessageReaction} reaction - Reakcja Discord
 * @param {User} user - Użytkownik który dodał reakcję
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function handleReactionAdd(reaction, user, state, config) {
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        // Sprawdź czy to właściwy kanał
        if (reaction.message.channel.id !== config.channels.training) return;
        
        // Sprawdź czy to właściwa reakcja
        if (reaction.emoji.name !== config.reaction.name) return;

        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        
        // Sprawdź czy użytkownik ma uprawnienia
        const hasRole = member.roles.cache.some(role => 
            config.roles.authorized.includes(role.id)
        );
        if (!hasRole) return;

        const channel = reaction.message.channel;
        const targetUser = reaction.message.author;
        const targetMember = await guild.members.fetch(targetUser.id);
        const threadName = targetMember.displayName || targetUser.username;

        // Sprawdź czy wątek już istnieje
        const existingThread = channel.threads.cache.find(thread => 
            thread.name === threadName
        );

        if (existingThread) {
            await existingThread.send(
                config.messages.threadExists(targetUser.id, user.id, config.roles.ping)
            );
        } else {
            // Utwórz nowy wątek
            const thread = await channel.threads.create({
                name: threadName,
                startMessage: reaction.message,
            });

            await thread.send(
                config.messages.threadCreated(user.id, config.roles.ping, targetUser.id)
            );

            // Inicjalizuj czas utworzenia wątku w mapie
            state.lastReminderMap.set(thread.id, Date.now());
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi reakcji:', error);
    }
}

module.exports = {
    handleReactionAdd
};