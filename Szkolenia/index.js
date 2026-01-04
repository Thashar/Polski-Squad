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
let pingedThreads = new Set(); // Śledzenie wątków które już dostały ping po pierwszej wiadomości właściciela

const sharedState = {
    lastReminderMap,
    pingedThreads,
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

        // Sprawdź czy wątek już dostał ping
        if (sharedState.pingedThreads.has(message.channel.id)) return;

        // Sprawdź czy to bot
        if (message.author.bot) return;

        // Pobierz właściciela wątku (osoba której nick jest nazwą wątku)
        const threadName = message.channel.name;
        const guild = message.guild;

        // Znajdź właściciela wątku - szukaj po displayName
        const members = await guild.members.fetch();
        const threadOwner = members.find(member =>
            (member.displayName === threadName || member.user.username === threadName)
        );

        // Jeśli nie znaleziono właściciela, pomiń
        if (!threadOwner) {
            logger.warn(`⚠️ Nie znaleziono właściciela wątku: ${threadName}`);
            return;
        }

        // Sprawdź czy to właściciel wątku pisze
        if (message.author.id !== threadOwner.id) return;

        // To pierwsza wiadomość od właściciela - wyślij ping do ról klanowych
        await message.channel.send(
            config.messages.ownerNeedsHelp(threadOwner.id, config.roles.clan)
        );

        // Oznacz wątek jako już zpingowany
        sharedState.pingedThreads.add(message.channel.id);

        logger.info(`📢 Wysłano ping do ról klanowych w wątku: ${threadName}`);

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