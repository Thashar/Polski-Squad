const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

const config = require('./config/config');
// const { logWithTimestamp } = require('./utils/helpers'); // Usunięto, używaj createBotLogger
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

// Mapa do śledzenia ostatnich przypomnień (będzie załadowana z pliku)
let lastReminderMap = new Map();

// Obiekt zawierający wszystkie współdzielone stany
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
        logger.info('✅ Dane przypomień zostały pomyślnie załadowane');
    } catch (error) {
        logger.error('❌ Błąd ładowania danych przypomień:', error.message);
    }
    
    logger.info('Bot Szkolenia jest gotowy do pracy!');
    
    // Uruchom automatyczne sprawdzanie wątków
    const intervalMs = config.timing.checkIntervalMinutes * 60 * 1000;
    setInterval(() => {
        checkThreads(client, sharedState, config);
    }, intervalMs);
    
    logger.info(`Automatyczne sprawdzanie wątków uruchomione (co ${config.timing.checkIntervalMinutes} minut)`);
});

// Obsługa przycisków
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

// Obsługa reakcji do zakładania wątku
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await handleReactionAdd(reaction, user, sharedState, config);
});

// Obsługa błędów
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

// Eksportuj funkcje do zarządzania botem
module.exports = {
    client,
    start: () => {
        return client.login(config.token);
    },
    stop: () => {
        return client.destroy();
    }
};