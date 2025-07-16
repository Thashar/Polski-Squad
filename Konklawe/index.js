const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import konfiguracji
const config = require('./config/config');

// Import serwisów
const DataService = require('./services/dataService');
const GameService = require('./services/gameService');
const TimerService = require('./services/timerService');
const RankingService = require('./services/rankingService');
const CommandService = require('./services/commandService');

// Import handlerów
const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

// Klient Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// Inicjalizacja serwisów
let dataService, gameService, timerService, rankingService, commandService;
let interactionHandler, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
function initializeServices() {
    dataService = new DataService();
    gameService = new GameService(config, dataService);
    timerService = new TimerService(config, gameService);
    rankingService = new RankingService(config, gameService);
    commandService = new CommandService(config);
    
    // Ustawienie klienta w timerService
    timerService.setClient(client);
    
    // Inicjalizacja handlerów
    interactionHandler = new InteractionHandler(config, gameService, rankingService, timerService);
    messageHandler = new MessageHandler(config, gameService, rankingService, timerService);
    
    // Inicjalizacja danych gry
    gameService.initializeGameData();
}

/**
 * Obsługuje zdarzenie ready
 */
async function onReady() {
    logger.info(`🚀 Zalogowano jako ${client.user.tag}`);
    await commandService.registerSlashCommands();

    try {
        const triggerChannel = await client.channels.fetch(config.channels.trigger);
        if (triggerChannel && triggerChannel.isTextBased()) {
            const messages = await triggerChannel.messages.fetch({ limit: 100 });
            await triggerChannel.bulkDelete(messages, true);
            logger.info('🧹 Wyczyszczono kanał przed startem bota.');
        }
    } catch (error) {
        logger.error(`❌ Błąd podczas czyszczenia kanału ${config.channels.trigger}:`, error);
    }

    try {
        const commandChannel = await client.channels.fetch(config.channels.command);
        const triggerChannel = await client.channels.fetch(config.channels.trigger);

        // Sprawdź czy hasło powinno być automatycznie przywrócone
        if (gameService.trigger === null && gameService.triggerClearedTimestamp) {
            const timeSinceCleared = new Date() - gameService.triggerClearedTimestamp;
            if (timeSinceCleared >= gameService.AUTO_RESET_TIME) {
                gameService.resetToDefaultPassword();

                try {
                    const guild = client.guilds.cache.first();
                    if (guild) {
                        await timerService.removeRoleFromAllMembers(guild, config.roles.papal);
                    }
                } catch (error) {
                    logger.error('❌ Błąd podczas usuwania ról papieskich:', error);
                }

                logger.info(`✅ Automatycznie przywrócono hasło "${config.messages.defaultPassword}" przy starcie bota`);
            }
        }

        // Jeśli nadal brak triggera, ustaw domyślny
        if (!gameService.trigger) {
            gameService.resetToDefaultPassword();
            
            try {
                const guild = client.guilds.cache.first();
                if (guild) {
                    await timerService.removeRoleFromAllMembers(guild, config.roles.papal);
                }
            } catch (error) {
                logger.error('❌ Błąd podczas usuwania ról papieskich:', error);
            }
        }

        // Wysyłanie powiadomień o stanie
        if (commandChannel && commandChannel.isTextBased()) {
            if (gameService.trigger.toLowerCase() === config.messages.defaultPassword.toLowerCase()) {
                await commandChannel.send('✅ Konklawe zostało uruchomione.');
                await commandChannel.send(`Napisz **"${config.messages.defaultPassword}"** by rozpocząć grę.`);
            } else {
                await triggerChannel.send('✅ Konklawe zostało uruchomione.');
                await triggerChannel.send('⚠️ Poprzednio ustawione hasło nie zostało odgadnięte i jest wciąż aktualne!');
            }
        }

        if (triggerChannel && triggerChannel.isTextBased()) {
            await triggerChannel.send(`🔑 Aktualne hasło: ${gameService.trigger}`);
            logger.info(`🔑 Automatycznie ustawiono hasło: ${gameService.trigger}`);
        }

        // Ustawienie odpowiednich timerów
        if (gameService.trigger === null) {
            await timerService.setAutoResetTimer();
        } else {
            // Przywróć timery przypominania po restarcie z opóźnieniem
            setTimeout(async () => {
                await timerService.restoreRemindersAfterRestart();
            }, 2000); // 2 sekundy opóźnienia aby guild i kanały były gotowe
        }

    } catch (error) {
        logger.error('❌ Błąd podczas uruchamiania bota:', error);
    }
}

/**
 * Obsługuje interakcje
 * @param {Interaction} interaction - Interakcja Discord
 */
async function onInteraction(interaction) {
    try {
        if (interaction.isButton()) {
            await interactionHandler.handleButtonInteraction(interaction);
        } else if (interaction.isChatInputCommand()) {
            await interactionHandler.handleSlashCommand(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await interactionHandler.handleSelectMenuInteraction(interaction);
        }
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
}

/**
 * Obsługuje wiadomości
 * @param {Message} message - Wiadomość Discord
 */
async function onMessage(message) {
    await messageHandler.handleMessage(message);
}

/**
 * Konfiguruje event handlery
 */
function setupEventHandlers() {
    client.once('ready', onReady);
    client.on('interactionCreate', onInteraction);
    client.on('messageCreate', onMessage);
}

/**
 * Uruchamia bota
 */
async function start() {
    try {
        initializeServices();
        setupEventHandlers();
        await client.login(config.token);
    } catch (error) {
        logger.error('❌ Błąd podczas uruchamiania bota:', error);
        process.exit(1);
    }
}

// Eksport dla użycia w main index.js
module.exports = {
    start
};

// Uruchomienie jeśli plik jest wywoływany bezpośrednio
if (require.main === module) {
    start();
}