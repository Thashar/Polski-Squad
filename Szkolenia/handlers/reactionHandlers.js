const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');

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

        // Sprawdzanie uprawnień do otwierania wątku
        const hasAuthorizedRole = config.roles.authorized.some(roleId => member.roles.cache.has(roleId));
        const hasClanRole = config.roles.clan.some(roleId => member.roles.cache.has(roleId));
        const targetUser = reaction.message.author;
        const isOwnPost = user.id === targetUser.id;

        // Logika uprawnień:
        // 1. Admin/moderator/specjalne role → mogą otworzyć wątek każdemu
        // 2. Użytkownik z rolą klanową + to jego własny post → może otworzyć wątek sobie
        if (!hasAuthorizedRole && !(hasClanRole && isOwnPost)) {
            logger.info(`⛔ ${member.displayName} nie ma uprawnień do otworzenia wątku`);
            return;
        }

        const channel = reaction.message.channel;
        const targetMember = await guild.members.fetch(targetUser.id);
        const threadName = targetMember.displayName || targetUser.username;

        // Sprawdź czy wątek już istnieje (szukaj także w zarchiwizowanych)
        let existingThread = channel.threads.cache.find(thread => 
            thread.name === threadName
        );
        
        // Jeśli nie znaleziono w aktywnych, sprawdź zarchiwizowane
        if (!existingThread) {
            const archivedThreads = await channel.threads.fetchArchived();
            existingThread = archivedThreads.threads.find(thread => 
                thread.name === threadName
            );
        }

        if (existingThread) {
            // Sprawdź czy wątek jest już otwarty (nie zarchiwizowany i nie zablokowany)
            if (!existingThread.archived && !existingThread.locked) {
                // Wątek jest wciąż otwarty - wyślij krótki komunikat
                await existingThread.send(
                    config.messages.threadAlreadyOpen(targetUser.id)
                );
                logger.info(`📌 Wątek ${existingThread.name} jest wciąż otwarty - wysłano powiadomienie`);
                return;
            }

            // WAŻNE: Kolejność operacji ma znaczenie!
            // 1. Najpierw odarchiwizuj (archived: false)
            // 2. Potem odblokuj (locked: false)
            // Discord API wymaga aby wątek locked był archived, więc nie można odblokować przed odarchiwizowaniem

            // Jeśli wątek jest zarchiwizowany, odarchiwizować
            if (existingThread.archived) {
                try {
                    await existingThread.setArchived(false, 'Ponowne otwarcie wątku');
                    logger.info(`📂 Odarchiwizowano wątek: ${existingThread.name}`);
                } catch (error) {
                    logger.error(`❌ Nie można odarchivizować wątku ${existingThread.name}:`, error);
                }
            }

            // Jeśli wątek jest zamknięty, odblokować go
            if (existingThread.locked) {
                try {
                    await existingThread.setLocked(false, 'Odblokowanie wątku na prośbę użytkownika');
                    logger.info(`🔓 Odblokowano wątek: ${existingThread.name}`);
                } catch (error) {
                    logger.error(`❌ Nie można odblokować wątku ${existingThread.name}:`, error);
                }
            }

            await existingThread.send(
                config.messages.threadCreated(user.id, config.roles.ping, targetUser.id)
            );

            // Zapisz właściciela wątku i zresetuj status przypomnienia oraz flagę pingu o pomoc
            const reopenNow = Date.now();
            await reminderStorage.setReminder(state.lastReminderMap, existingThread.id, reopenNow, null, targetUser.id);
            await reminderStorage.resetHelpPing(state.lastReminderMap, existingThread.id);
            await reminderStorage.resetReminderStatus(state.lastReminderMap, existingThread.id);
        } else {
            // Utwórz nowy wątek
            const thread = await channel.threads.create({
                name: threadName,
                startMessage: reaction.message,
            });

            await thread.send(
                config.messages.threadCreated(user.id, config.roles.ping, targetUser.id)
            );

            // Inicjalizuj czas utworzenia wątku w mapie (z właścicielem i wyzerowaną flagą pingu o pomoc)
            const now = Date.now();
            await reminderStorage.setReminder(state.lastReminderMap, thread.id, now, now, targetUser.id);
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi reakcji:', error);
    }
}

module.exports = {
    handleReactionAdd
};