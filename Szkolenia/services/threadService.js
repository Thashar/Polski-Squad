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
        const deleteThreshold = config.timing.threadDeleteDays * 24 * 60 * 60 * 1000;
        const reminderThreshold = config.timing.inactiveReminderHours * 60 * 60 * 1000;

        let allThreads;
        
        if (isInitialCheck) {
            // Przy starcie sprawdź wszystkie wątki (aktywne i zarchiwizowane)
            const activeThreads = await channel.threads.fetchActive();
            const archivedThreads = await channel.threads.fetchArchived();
            
            // Połącz aktywne i zarchiwizowane wątki
            allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);
            
            logger.info(`🔍 Sprawdzanie ${allThreads.size} wątków przy starcie bota (aktywne: ${activeThreads.threads.size}, zarchiwizowane: ${archivedThreads.threads.size})...`);
        } else {
            // Przy normalnym sprawdzaniu TAKŻE zarchiwizowane wątki (dla przypomnień)
            const activeThreads = await channel.threads.fetchActive();
            const archivedThreads = await channel.threads.fetchArchived();
            
            // Połącz aktywne i zarchiwizowane wątki
            allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);
            
            logger.info(`🔄 Sprawdzanie ${allThreads.size} wątków (aktywne: ${activeThreads.threads.size}, zarchiwizowane: ${archivedThreads.threads.size})...`);
        }
        
        // Wyczyść nieistniejące wątki z danych przypomień
        await reminderStorage.cleanupOrphanedReminders(state.lastReminderMap, allThreads);
        
        for (const [id, thread] of allThreads) {
            try {
                await processThread(thread, guild, state, config, now, {
                    archiveThreshold,
                    deleteThreshold,
                    reminderThreshold
                }, isInitialCheck);
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania wątku ${thread.name}:`, error);
            }
        }
        
        if (isInitialCheck) {
            logger.info('✅ Sprawdzenie wątków przy starcie zakończone');
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
    const { archiveThreshold, deleteThreshold, reminderThreshold } = thresholds;
    
    // Pobierz ostatnią wiadomość w wątku
    const lastMessage = await thread.messages.fetch({ limit: 1 }).then(msgs => msgs.first());
    const lastMessageTime = lastMessage ? lastMessage.createdTimestamp : thread.createdTimestamp;
    const inactiveTime = now - lastMessageTime;

    // Przy sprawdzeniu startowym - usuń wszystkie wątki starsze niż 7 dni
    if (isInitialCheck && inactiveTime > deleteThreshold) {
        await deleteThread(thread, state, config);
        return;
    }

    // Sprawdź czy to wątek z naszego systemu (nazwa = nick użytkownika)
    const threadOwner = guild.members.cache.find(member => 
        (member.displayName === thread.name) || (member.user.username === thread.name)
    );

    if (!threadOwner) return; // Pomiń wątki, które nie należą do naszego systemu

    // Sprawdź czas ostatniego przypomnienia (tylko przy normalnym sprawdzaniu)
    if (!isInitialCheck) {
        const threadData = state.lastReminderMap.get(thread.id);
        let lastReminder;
        let threadCreatedTime;
        
        if (threadData) {
            lastReminder = threadData.lastReminder;
            threadCreatedTime = threadData.threadCreated;
        }
        
        // Fallback - jeśli nie mamy zapisanych danych, użyj timestamp z Discord
        if (!threadCreatedTime) {
            threadCreatedTime = thread.createdTimestamp;
            logger.warn(`⚠️ Brak zapisanej daty utworzenia dla wątku ${thread.name}, używam Discord timestamp`);
        }
        
        if (!lastReminder) {
            lastReminder = threadCreatedTime;
        }
        
        const timeSinceLastReminder = now - lastReminder;
        const threadAge = now - threadCreatedTime;

        // Debug informacje
        logger.info(`🔍 Wątek ${thread.name}:`);
        logger.info(`   📅 Wiek wątku: ${Math.round(threadAge / (1000 * 60 * 60))}h`);
        logger.info(`   💤 Nieaktywny od: ${Math.round(inactiveTime / (1000 * 60 * 60))}h`);
        logger.info(`   🔔 Od ostatniego przypomnienia: ${Math.round(timeSinceLastReminder / (1000 * 60 * 60))}h`);
        logger.info(`   🚨 Próg przypomnienia: ${Math.round(reminderThreshold / (1000 * 60 * 60))}h`);

        // Wyślij przypomnienie jeśli minęło odpowiednio dużo czasu
        if (inactiveTime > reminderThreshold && timeSinceLastReminder > reminderThreshold) {
            logger.info(`✅ Wysyłanie przypomnienia dla wątku ${thread.name}`);
            await sendInactivityReminder(thread, threadOwner, state, config, now);
        } else {
            logger.info(`❌ Przypomnienie nie wysłane - warunki nie spełnione`);
        }
    }

    // Standardowe archiwizowanie i usuwanie (dla bardzo starych wątków)
    if (inactiveTime > deleteThreshold) {
        await deleteThread(thread, state, config);
    } else if (inactiveTime > archiveThreshold && !thread.archived) {
        await archiveThread(thread, config);
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
            logger.info(`📂 Odarchiwizowano wątek ${thread.name} w celu wysłania przypomnienia`);
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('lock_thread')
                    .setLabel('Zamknij wątek')
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

        // Zaktualizuj czas ostatniego przypomnienia (nie zmieniaj daty utworzenia)
        await reminderStorage.setReminder(state.lastReminderMap, thread.id, now);
        logger.info(`💬 Wysłano przypomnienie dla wątku: ${thread.name}`);
        
    } catch (error) {
        logger.error(`❌ Błąd podczas wysyłania przypomnienia do wątku ${thread.name}:`, error);
    }
}

/**
 * Usunięcie wątku
 * @param {ThreadChannel} thread - Wątek do usunięcia
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function deleteThread(thread, state, config) {
    await reminderStorage.removeReminder(state.lastReminderMap, thread.id);
    await thread.delete(`Wątek nieaktywny przez ${config.timing.threadDeleteDays} dni`);
    logger.info(`🗑️ Usunięto wątek: ${thread.name}`);
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