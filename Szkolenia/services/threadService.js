const { createBotLogger } = require('../../utils/consoleLogger');
const ReminderStorageService = require('./reminderStorageService');

const logger = createBotLogger('Szkolenia');
const reminderStorage = new ReminderStorageService();
/**
 * Serwis zarządzania wątkami szkoleniowymi.
 * -------------------------------------------------
 * • sprawdzanie aktywności wątków
 * • automatyczne archiwizowanie i usuwanie
 * • wysyłanie przypomnień o nieaktywności
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Sprawdzenie i zarządzanie wszystkimi wątkami
 * @param {Client} client - Klient Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 * @param {boolean} isInitialCheck - Czy to sprawdzenie przy starcie bota
 */
async function checkThreads(client, state, config, isInitialCheck = false) {
    try {
        const guild = client.guilds.cache.first();
        const channel = await guild.channels.fetch(config.channels.training);
        
        if (!channel.isTextBased() || !channel.threads) return;

        const now = Date.now();
        const archiveThreshold = config.timing.threadArchiveDays * 24 * 60 * 60 * 1000;
        const lockThreshold = config.timing.threadLockDays * 24 * 60 * 60 * 1000; // Zmieniono: deleteThreshold -> lockThreshold
        const reminderThreshold = config.timing.threadReminderDays * 24 * 60 * 60 * 1000;

        let allThreads;
        
        if (isInitialCheck) {
            // Przy starcie sprawdź wszystkie wątki (aktywne i zarchiwizowane)
            const activeThreads = await channel.threads.fetchActive();
            const archivedThreads = await channel.threads.fetchArchived();
            
            // Połącz aktywne i zarchiwizowane wątki
            allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);
            
        } else {
            // Przy normalnym sprawdzaniu TAKŻE zarchiwizowane wątki (dla przypomnień)
            const activeThreads = await channel.threads.fetchActive();
            const archivedThreads = await channel.threads.fetchArchived();
            
            // Połącz aktywne i zarchiwizowane wątki
            allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);
            
        }
        
        // Wyczyść nieistniejące wątki z danych przypomień
        await reminderStorage.cleanupOrphanedReminders(state.lastReminderMap, allThreads);
        
        for (const [id, thread] of allThreads) {
            try {
                await processThread(thread, guild, state, config, now, {
                    archiveThreshold,
                    lockThreshold, // Poprawka: deleteThreshold -> lockThreshold
                    reminderThreshold
                }, isInitialCheck);
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania wątku ${thread.name}:`, error);
            }
        }
        
    } catch (error) {
        logger.error('❌ Błąd podczas sprawdzania wątków:', error);
    }
}

/**
 * Przetwarzanie pojedynczego wątku
 * @param {ThreadChannel} thread - Wątek do przetworzenia
 * @param {Guild} guild - Serwer Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 * @param {number} now - Aktualny timestamp
 * @param {Object} thresholds - Progi czasowe
 * @param {boolean} isInitialCheck - Czy to sprawdzenie przy starcie bota
 */
async function processThread(thread, guild, state, config, now, thresholds, isInitialCheck = false) {
    const { lockThreshold, reminderThreshold } = thresholds;

    // Pobierz ostatnią wiadomość w wątku
    const lastMessage = await thread.messages.fetch({ limit: 1 }).then(msgs => msgs.first());
    const lastMessageTime = lastMessage ? lastMessage.createdTimestamp : thread.createdTimestamp;
    const inactiveTime = now - lastMessageTime;

    // Bezpieczeństwo: zamknij wątki nieaktywne > 14 dni od ostatniej wiadomości
    // KRYTYCZNE: Sprawdź PRZED sprawdzeniem threadOwner - zapobiega problemowi ze zmianą nicku
    if (inactiveTime > lockThreshold) {
        await lockThread(thread, state, config);
        return;
    }

    // Sprawdź dane przypomnienia
    const threadData = state.lastReminderMap.get(thread.id);

    // Jeśli przypomnienie było wysłane - sprawdź czy zamknąć (7 dni po przypomnieniu bez odpowiedzi)
    if (threadData && threadData.reminderSent) {
        if (lastMessageTime > threadData.lastReminder + 5000) {
            // Użytkownik pisał po przypomnieniu - zresetuj cykl nieaktywności
            await reminderStorage.resetReminderStatus(state.lastReminderMap, thread.id, lastMessageTime);
        } else {
            // Brak aktywności użytkownika po przypomnieniu
            const timeSinceReminder = now - threadData.lastReminder;
            if (timeSinceReminder > reminderThreshold) {
                // 7 dni po przypomnieniu bez odpowiedzi - zamknij wątek
                await lockThread(thread, state, config);
                return;
            }
        }
    }

    // Przy sprawdzeniu startowym - nie wysyłaj przypomnień, tylko zamykaj
    if (isInitialCheck) return;

    // Sprawdź czy to wątek z naszego systemu (nazwa = nick użytkownika)
    const threadOwner = guild.members.cache.find(member =>
        (member.displayName === thread.name) || (member.user.username === thread.name)
    );
    if (!threadOwner) return;

    // KRYTYCZNE: Nie wysyłaj przypomnienia jeśli wątek jest zamknięty
    if (thread.locked) {
        await reminderStorage.removeReminder(state.lastReminderMap, thread.id);
        return;
    }

    // Wyślij przypomnienie po 7 dniach nieaktywności (jeśli jeszcze nie wysłano)
    const reminderAlreadySent = threadData && threadData.reminderSent;

    if (inactiveTime > reminderThreshold && !reminderAlreadySent) {
        const lastReminderTime = threadData ? threadData.lastReminder : 0;
        const timeSinceLastReminder = lastReminderTime ? (now - lastReminderTime) : Infinity;

        if (timeSinceLastReminder > reminderThreshold) {
            await sendInactivityReminder(thread, threadOwner, state, config, now);
        }
    }
}

/**
 * Wysłanie przypomnienia o nieaktywności
 * @param {ThreadChannel} thread - Wątek
 * @param {GuildMember} threadOwner - Właściciel wątku
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 * @param {number} now - Aktualny timestamp
 */
async function sendInactivityReminder(thread, threadOwner, state, config, now) {
    try {
        // Jeśli wątek jest zarchiwizowany, odarchiwizuj go aby móc wysłać wiadomość
        if (thread.archived) {
            await thread.setArchived(false, 'Odarchiwizowanie w celu wysłania przypomnienia');
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('lock_thread')
                    .setLabel('Zamknij szkolenie')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('keep_open')
                    .setLabel('Jeszcze nie zamykaj')
                    .setStyle(ButtonStyle.Secondary)
            );

        await thread.send({
            content: config.messages.inactiveReminder(threadOwner.id),
            components: [row]
        });

        // Zaktualizuj czas ostatniego przypomnienia i oznacz jako wysłane
        await reminderStorage.setReminder(state.lastReminderMap, thread.id, now);
        await reminderStorage.markReminderSent(state.lastReminderMap, thread.id);
        logger.info(`💬 Wysłano przypomnienie: ${thread.name}`);
        
    } catch (error) {
        logger.error(`❌ Błąd podczas wysyłania przypomnienia do wątku ${thread.name}:`, error);
    }
}

/**
 * Zamknięcie wątku (zamiast usunięcia)
 * @param {ThreadChannel} thread - Wątek do zamknięcia
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function lockThread(thread, state, config) {
    try {
        // Jeśli wątek jest zarchiwizowany, odarchiwizuj go aby móc wysłać wiadomość i zamknąć
        if (thread.archived) {
            await thread.setArchived(false, 'Odarchiwizowanie w celu zamknięcia wątku');
        }
        
        await thread.send(config.messages.threadLocked);
        await thread.setLocked(true, `Wątek nieaktywny przez ${config.timing.threadLockDays} dni - automatycznie zamknięty`);
        await thread.setArchived(true, 'Zamknięcie wątku po okresie nieaktywności');
        
        // Usuń dane przypomnienia po zamknięciu
        await reminderStorage.removeReminder(state.lastReminderMap, thread.id);
        logger.info(`🔒 Zamknięto wątek: ${thread.name}`);
    } catch (error) {
        logger.error(`❌ Błąd podczas zamykania wątku ${thread.name}:`, error);
    }
}

/**
 * Archiwizowanie wątku
 * @param {ThreadChannel} thread - Wątek do archiwizowania
 * @param {Object} config - Konfiguracja aplikacji
 */
async function archiveThread(thread, config) {
    await thread.setArchived(true, `Wątek nieaktywny przez ${config.timing.threadArchiveDays} dni`);
    logger.info(`📦 Zarchiwizowano wątek: ${thread.name}`);
}


module.exports = {
    checkThreads,
    reminderStorage
};