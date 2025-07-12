const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

const config = require('./config/config');
const { logWithTimestamp } = require('./utils/helpers');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads } = require('./services/threadService');
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

// Mapa do śledzenia ostatnich przypomnień
const lastReminderMap = new Map();

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
    await handleInteraction(interaction, sharedState, config);
});

// Obsługa reakcji do zakładania wątku
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await handleReactionAdd(reaction, user, sharedState, config);
});

// Obsługa błędów
client.on('error', error => {
    logWithTimestamp(`Błąd klienta Discord: ${error.message}`, 'error');
});

process.on('unhandledRejection', error => {
    logWithTimestamp(`Nieobsłużone odrzucenie Promise: ${error.message}`, 'error');
});

process.on('uncaughtException', error => {
    logWithTimestamp(`Nieobsłużony wyjątek: ${error.message}`, 'error');
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