const { createBotLogger } = require('../../utils/consoleLogger');
const { daysToMilliseconds } = require('../utils/helpers');
const ReminderStorageService = require('./reminderStorageService');

const logger = createBotLogger('Szkolenia');
const reminderStorage = new ReminderStorageService();

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function checkThreads(client, state, config, isInitialCheck = false) {
    try {
        const guild = client.guilds.cache.first();
        const channel = await guild.channels.fetch(config.channels.training);

        if (!channel.isTextBased() || !channel.threads) return;

        const now = Date.now();
        const lockThreshold = daysToMilliseconds(config.timing.threadLockDays);
        const reminderThreshold = daysToMilliseconds(config.timing.threadReminderDays);

        const activeThreads = await channel.threads.fetchActive();
        const archivedThreads = await channel.threads.fetchArchived();
        const allThreads = new Map([...activeThreads.threads, ...archivedThreads.threads]);

        await reminderStorage.cleanupOrphanedReminders(state.lastReminderMap, allThreads);

        for (const [id, thread] of allThreads) {
            try {
                await processThread(thread, guild, state, config, now, {
                    lockThreshold,
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

async function processThread(thread, guild, state, config, now, thresholds, isInitialCheck = false) {
    const { lockThreshold, reminderThreshold } = thresholds;

    const lastMessage = await thread.messages.fetch({ limit: 1 }).then(msgs => msgs.first());
    const lastMessageTime = lastMessage ? lastMessage.createdTimestamp : thread.createdTimestamp;
    const inactiveTime = now - lastMessageTime;

    if (inactiveTime > lockThreshold) {
        await lockThread(thread, state, config);
        return;
    }

    const threadData = state.lastReminderMap.get(thread.id);

    if (threadData && threadData.reminderSent) {
        if (lastMessageTime > threadData.lastReminder + 5000) {
            await reminderStorage.resetReminderStatus(state.lastReminderMap, thread.id, lastMessageTime);
        } else {
            const timeSinceReminder = now - threadData.lastReminder;
            if (timeSinceReminder > reminderThreshold) {
                await lockThread(thread, state, config);
                return;
            }
        }
    }

    if (isInitialCheck) return;

    const threadOwner = guild.members.cache.find(member =>
        (member.displayName === thread.name) || (member.user.username === thread.name)
    );
    if (!threadOwner) return;

    if (thread.locked) {
        await reminderStorage.removeReminder(state.lastReminderMap, thread.id);
        return;
    }

    const reminderAlreadySent = threadData && threadData.reminderSent;

    if (inactiveTime > reminderThreshold && !reminderAlreadySent) {
        const lastReminderTime = threadData ? threadData.lastReminder : 0;
        const timeSinceLastReminder = lastReminderTime ? (now - lastReminderTime) : Infinity;

        if (timeSinceLastReminder > reminderThreshold) {
            await sendInactivityReminder(thread, threadOwner, state, config, now);
        }
    }
}

async function sendInactivityReminder(thread, threadOwner, state, config, now) {
    try {
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

        await reminderStorage.setReminder(state.lastReminderMap, thread.id, now);
        await reminderStorage.markReminderSent(state.lastReminderMap, thread.id);
        logger.info(`💬 Wysłano przypomnienie: ${thread.name}`);

    } catch (error) {
        logger.error(`❌ Błąd podczas wysyłania przypomnienia do wątku ${thread.name}:`, error);
    }
}

async function lockThread(thread, state, config) {
    try {
        if (thread.archived) {
            await thread.setArchived(false, 'Odarchiwizowanie w celu zamknięcia wątku');
        }

        await thread.send(config.messages.threadLocked);
        await thread.setLocked(true, `Wątek nieaktywny przez ${config.timing.threadLockDays} dni - automatycznie zamknięty`);
        await thread.setArchived(true, 'Zamknięcie wątku po okresie nieaktywności');

        await reminderStorage.removeReminder(state.lastReminderMap, thread.id);
        logger.info(`🔒 Zamknięto wątek: ${thread.name}`);
    } catch (error) {
        logger.error(`❌ Błąd podczas zamykania wątku ${thread.name}:`, error);
    }
}


module.exports = {
    checkThreads,
    reminderStorage
};
