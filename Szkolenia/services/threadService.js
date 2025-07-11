const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');
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
 */
async function checkThreads(client, state, config) {
    try {
        const guild = client.guilds.cache.first();
        const channel = await guild.channels.fetch(config.channels.training);
        
        if (!channel.isTextBased() || !channel.threads) return;

        const now = Date.now();
        const archiveThreshold = config.timing.threadArchiveDays * 24 * 60 * 60 * 1000;
        const deleteThreshold = config.timing.threadDeleteDays * 24 * 60 * 60 * 1000;
        const reminderThreshold = config.timing.inactiveReminderHours * 60 * 60 * 1000;

        const threads = await channel.threads.fetchActive();
        
        for (const [id, thread] of threads.threads) {
            try {
                await processThread(thread, guild, state, config, now, {
                    archiveThreshold,
                    deleteThreshold,
                    reminderThreshold
                });
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
 */
async function processThread(thread, guild, state, config, now, thresholds) {
    const { archiveThreshold, deleteThreshold, reminderThreshold } = thresholds;
    
    // Pobierz ostatnią wiadomość w wątku
    const lastMessage = await thread.messages.fetch({ limit: 1 }).then(msgs => msgs.first());
    const lastMessageTime = lastMessage ? lastMessage.createdTimestamp : thread.createdTimestamp;
    const inactiveTime = now - lastMessageTime;

    // Sprawdź czy to wątek z naszego systemu (nazwa = nick użytkownika)
    const threadOwner = guild.members.cache.find(member => 
        (member.displayName === thread.name) || (member.user.username === thread.name)
    );

    if (!threadOwner) return; // Pomiń wątki, które nie należą do naszego systemu

    // Sprawdź czas ostatniego przypomnienia
    const lastReminder = state.lastReminderMap.get(thread.id) || thread.createdTimestamp;
    const timeSinceLastReminder = now - lastReminder;

    // Wyślij przypomnienie jeśli minęło odpowiednio dużo czasu
    if (inactiveTime > reminderThreshold && timeSinceLastReminder > reminderThreshold) {
        await sendInactivityReminder(thread, threadOwner, state, config, now);
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

    // Zaktualizuj czas ostatniego przypomnienia
    state.lastReminderMap.set(thread.id, now);
    logger.info(`💬 Wysłano przypomnienie dla wątku: ${thread.name}`);
}

/**
 * Usunięcie wątku
 * @param {ThreadChannel} thread - Wątek do usunięcia
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function deleteThread(thread, state, config) {
    state.lastReminderMap.delete(thread.id);
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
    checkThreads
};