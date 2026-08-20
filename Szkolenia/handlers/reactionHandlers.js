const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage, znajdzWatekUzytkownika, otworzWatek } = require('../services/threadService');

const logger = createBotLogger('Szkolenia');
/**
 * Obsługa reakcji do zakładania wątków szkoleniowych.
 * -------------------------------------------------
 * • reakcja N_SSS do tworzenia wątku pomocy
 * • sprawdzanie uprawnień użytkownika
 * • tworzenie lub odnajdywanie istniejącego wątku
 */

/**
 * Wysyła regułkę szkoleniową do wątku.
 *
 * ⚠️ Osobna funkcja z własnym logiem, bo to JEDYNA treść, po której użytkownik poznaje,
 * co ma zrobić. Gdy wysyłka padała wewnątrz ogólnego `catch`, w logu zostawał tylko
 * „Błąd podczas obsługi reakcji", a na Discordzie — pusty wątek.
 */
async function wyslijRegulke(watek, config, klikajacyId, wlascicielId) {
    try {
        await watek.send(config.messages.threadCreated(klikajacyId, config.roles.ping, wlascicielId));
        return true;
    } catch (error) {
        logger.error(`❌ Nie udało się wysłać regułki do wątku ${watek.name}: ${error.message}`);
        return false;
    }
}

/**
 * Dopasowuje nazwę wątku do aktualnego nicku właściciela.
 * Wątek odnaleziony po `ownerId` albo po wiadomości startowej może nosić stary nick.
 */
async function wyrownajNazweWatku(watek, threadName) {
    if (watek.name === threadName) return;

    try {
        await watek.setName(threadName, 'Aktualizacja nazwy wątku po zmianie nicku właściciela');
        logger.info(`✏️ Zmieniono nazwę wątku na aktualny nick: ${threadName}`);
    } catch (error) {
        logger.warn(`⚠️ Nie udało się zmienić nazwy wątku ${watek.name}: ${error.message}`);
    }
}

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

        // Szukanie istniejącego wątku: wiadomość startowa → zapisany ownerId → aktywne → archiwum.
        // ⚠️ Samo dopasowanie po nazwie nie wystarcza: nazwa to nick z chwili założenia wątku,
        // a wątek zarchiwizowany poza pierwszą stroną wyników jest niewidoczny bez stronicowania.
        // Oba przypadki kończyły się założeniem DRUGIEGO wątku dla tej samej osoby.
        const existingThread = await znajdzWatekUzytkownika(channel, {
            message: reaction.message,
            ownerId: targetUser.id,
            threadName,
            reminderMap: state.lastReminderMap
        });

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

            // Odarchiwizowanie i odblokowanie jednym żądaniem; bez tego nie ma po co pisać
            if (!await otworzWatek(existingThread)) {
                logger.error(`❌ Nie otwarto wątku ${existingThread.name} - regułka nie została wysłana`);
                return;
            }

            await wyrownajNazweWatku(existingThread, threadName);
            await wyslijRegulke(existingThread, config, user.id, targetUser.id);

            // Zapisz właściciela wątku i zresetuj status przypomnienia oraz flagę pingu o pomoc
            const reopenNow = Date.now();
            await reminderStorage.setReminder(state.lastReminderMap, existingThread.id, reopenNow, null, targetUser.id);
            await reminderStorage.resetHelpPing(state.lastReminderMap, existingThread.id);
            await reminderStorage.resetReminderStatus(state.lastReminderMap, existingThread.id);
            return;
        }

        // Utwórz nowy wątek
        const thread = await channel.threads.create({
            name: threadName,
            startMessage: reaction.message,
        });

        await wyslijRegulke(thread, config, user.id, targetUser.id);

        // Inicjalizuj czas utworzenia wątku w mapie (z właścicielem i wyzerowaną flagą pingu o pomoc)
        const now = Date.now();
        await reminderStorage.setReminder(state.lastReminderMap, thread.id, now, now, targetUser.id);

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi reakcji:', error);
    }
}

module.exports = {
    handleReactionAdd
};
