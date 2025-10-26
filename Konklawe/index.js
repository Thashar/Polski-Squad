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
const NicknameManager = require('../utils/nicknameManagerService');

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
let dataService, gameService, timerService, rankingService, commandService, nicknameManager;
let interactionHandler, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    dataService = new DataService();
    gameService = new GameService(config, dataService);
    timerService = new TimerService(config, gameService);
    rankingService = new RankingService(config, gameService);
    commandService = new CommandService(config);
    
    // Inicjalizacja centralnego systemu zarządzania nickami
    nicknameManager = new NicknameManager();
    await nicknameManager.initialize();
    
    // Ustawienie klienta w timerService
    timerService.setClient(client);
    
    // Inicjalizacja handlerów z nickname manager
    interactionHandler = new InteractionHandler(config, gameService, rankingService, timerService, nicknameManager);
    messageHandler = new MessageHandler(config, gameService, rankingService, timerService);
    
    // Inicjalizacja danych gry
    gameService.initializeGameData();
}

/**
 * Obsługuje zdarzenie ready
 */
async function onReady() {
    logger.success('✅ Konklawe gotowy - gra w hasła, błogosławienia JP2');
    await commandService.registerSlashCommands();

    try {
        const commandChannel = await client.channels.fetch(config.channels.command);
        const triggerChannel = await client.channels.fetch(config.channels.trigger);

        // Sprawdź czy hasło powinno być automatycznie przywrócone
        if (gameService.trigger === null && gameService.triggerClearedTimestamp) {
            const timeSinceCleared = gameService.getPolishTime() - gameService.triggerClearedTimestamp;
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

        if (triggerChannel && triggerChannel.isTextBased()) {
            // Sprawdź ostatnią wiadomość - wyślij tylko jeśli nie jest wiadomością o haśle
            const lastMessages = await triggerChannel.messages.fetch({ limit: 1 });
            const lastMessage = lastMessages.first();

            const shouldSendPasswordMessage = !lastMessage ||
                !lastMessage.content.startsWith('🔑 Aktualne hasło:');

            if (shouldSendPasswordMessage) {
                await triggerChannel.send(`🔑 Aktualne hasło: ${gameService.trigger}`);
                logger.info(`📤 Wysłano wiadomość o aktualnym haśle: ${gameService.trigger}`);
            } else {
                logger.info(`⏭️ Pominięto wysyłanie wiadomości - ostatnia wiadomość to już info o haśle`);
            }
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
    await messageHandler.handleMessage(message, interactionHandler);
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
        await initializeServices();
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