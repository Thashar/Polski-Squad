const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads, reminderStorage } = require('./services/threadService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

let lastReminderMap = new Map();

const sharedState = {
    lastReminderMap,
    client,
    config
};

client.once(Events.ClientReady, async () => {
    logger.info(`Bot zalogowany jako ${client.user.tag}`);
    logger.info(`Aktywny na ${client.guilds.cache.size} serwerach`);
    
    client.guilds.cache.forEach(guild => {
        logger.info(`- ${guild.name} (${guild.id})`);
    });
    
    // Załaduj dane przypomień z pliku
    try {
        lastReminderMap = await reminderStorage.loadReminders();
        sharedState.lastReminderMap = lastReminderMap;
    } catch (error) {
        logger.error('❌ Błąd ładowania danych przypomień:', error.message);
    }
    
    logger.success('✅ Szkolenia gotowy - wątki szkoleniowe, automatyczne przypomnienia');
    await checkThreads(client, sharedState, config, true);

    // Uruchom automatyczne sprawdzanie wątków - codziennie o 18:00
    const cronExpression = `${config.timing.checkMinute} ${config.timing.checkHour} * * *`;
    cron.schedule(cronExpression, () => {
        logger.info(`🕐 Rozpoczynam zaplanowane sprawdzanie wątków (${config.timing.checkHour}:${config.timing.checkMinute.toString().padStart(2, '0')})`);
        checkThreads(client, sharedState, config);
    }, {
        timezone: "Europe/Warsaw"
    });

    logger.info(`📅 Zaplanowano sprawdzanie wątków: codziennie o ${config.timing.checkHour}:${config.timing.checkMinute.toString().padStart(2, '0')} (strefa: Europe/Warsaw)`);

});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await handleInteraction(interaction, sharedState, config);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.', 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.' 
                });
            }
        } catch (replyError) {
            logger.error('❌ Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await handleReactionAdd(reaction, user, sharedState, config);
});

client.on(Events.MessageCreate, async (message) => {
    try {
        // Sprawdź czy to wątek w kanale szkoleniowym
        if (!message.channel.isThread()) return;
        if (message.channel.parentId !== config.channels.training) return;

        // Sprawdź czy to bot
        if (message.author.bot) return;

        // Pobierz właściciela wątku z thread.ownerId (ustawiane automatycznie przez Discord)
        let threadOwnerId = message.channel.ownerId;

        // Jeśli brak ownerId, spróbuj znaleźć właściciela po nazwie wątku w cache
        if (!threadOwnerId) {
            logger.warn(`⚠️ Wątek nie ma ownerId, szukam po nazwie: ${message.channel.name}`);

            const threadName = message.channel.name;
            const guild = message.guild;

            // Szukaj w cache (bez fetchowania!)
            const threadOwner = guild.members.cache.find(member =>
                member.displayName === threadName || member.user.username === threadName
            );

            if (!threadOwner) {
                logger.warn(`⚠️ Nie znaleziono właściciela wątku w cache: ${threadName}`);
                return;
            }

            threadOwnerId = threadOwner.id;
            logger.info(`✅ Znaleziono właściciela w cache: ${threadOwner.displayName} (${threadOwnerId})`);
        }

        // Sprawdź czy to właściciel wątku pisze
        if (message.author.id !== threadOwnerId) return;

        logger.info(`👤 Wiadomość od właściciela wątku: ${message.author.tag}`);

        // Sprawdź czy to pierwsza wiadomość właściciela w tym wątku
        // Pobierz ostatnie 100 wiadomości z wątku
        const messages = await message.channel.messages.fetch({ limit: 100 });

        // Policz wiadomości właściciela (nie licząc wiadomości bota)
        const ownerMessagesCount = messages.filter(msg =>
            msg.author.id === threadOwnerId && !msg.author.bot
        ).size;

        logger.info(`📊 Liczba wiadomości właściciela: ${ownerMessagesCount}`);

        // Jeśli to pierwsza wiadomość właściciela - wyślij ping do ról klanowych
        if (ownerMessagesCount === 1) {
            await message.channel.send(
                config.messages.ownerNeedsHelp(threadOwnerId, config.roles.clan)
            );

            logger.info(`📢 Wysłano ping do ról klanowych w wątku: ${message.channel.name}`);
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi wiadomości w wątku:', error);
    }
});

client.on('error', error => {
    logger.error(`Błąd klienta Discord: ${error.message}`);
});

process.on('unhandledRejection', error => {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
});

process.on('uncaughtException', error => {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
});

module.exports = {
    client,
    start: () => {
        return client.login(config.token);
    },
    stop: () => {
        return client.destroy();
    }
};