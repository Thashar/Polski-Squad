const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import konfiguracji
const config = require('./config/config');

// Import serwisów
const DataService = require('./services/dataService');
const GameService = require('./services/gameService');
const TimerService = require('./services/timerService');
const RankingService = require('./services/rankingService');
const CommandService = require('./services/commandService');
const PasswordEmbedService = require('./services/passwordEmbedService');
const ScheduledHintsService = require('./services/scheduledHintsService');

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
let dataService, gameService, timerService, rankingService, commandService, nicknameManager, passwordEmbedService, scheduledHintsService;
let interactionHandler, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    dataService = new DataService();

    // Najpierw utwórz serwisy podstawowe
    gameService = new GameService(config, dataService);
    timerService = new TimerService(config, gameService);
    rankingService = new RankingService(config, gameService);
    commandService = new CommandService(config);

    // Utwórz scheduledHintsService (wymaga gameService, timerService, passwordEmbedService)
    // passwordEmbedService będzie ustawiony później
    scheduledHintsService = new ScheduledHintsService(config, gameService, timerService, null);

    // Utwórz passwordEmbedService z scheduledHintsService
    passwordEmbedService = new PasswordEmbedService(config, gameService, scheduledHintsService);

    // Ustaw passwordEmbedService w scheduledHintsService
    scheduledHintsService.passwordEmbedService = passwordEmbedService;

    // Inicjalizacja centralnego systemu zarządzania nickami
    nicknameManager = new NicknameManager();
    await nicknameManager.initialize();

    // Ustawienie klienta w serwisach
    timerService.setClient(client);
    passwordEmbedService.setClient(client);
    scheduledHintsService.setClient(client);
    timerService.setPasswordEmbedService(passwordEmbedService);

    // Ustaw scheduledHintsService w gameService
    gameService.setScheduledHintsService(scheduledHintsService);

    // Inicjalizacja handlerów z wszystkimi serwisami
    interactionHandler = new InteractionHandler(config, gameService, rankingService, timerService, nicknameManager, passwordEmbedService, scheduledHintsService);
    messageHandler = new MessageHandler(config, gameService, rankingService, timerService, passwordEmbedService);

    // Inicjalizacja danych gry
    gameService.initializeGameData();

    // Sprawdź przegapione podpowiedzi przy starcie
    await scheduledHintsService.checkMissedHints();
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

            }
        }

        // Inicjalizacja embeda na kanale trigger
        if (triggerChannel && triggerChannel.isTextBased()) {
            await passwordEmbedService.initializeEmbed();
            logger.info('✅ Zainicjalizowano embed statusu hasła');
        }

        // Ustawienie odpowiednich timerów
        if (gameService.trigger === null) {
            // Brak hasła - ustaw timery od początku
            await timerService.setAutoResetTimer();

            // Znajdź papieża i ustaw timer przypomnienia
            try {
                const guild = client.guilds.cache.first();
                if (guild) {
                    await guild.members.fetch();
                    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(config.roles.papal));
                    if (membersWithRole.size > 0) {
                        const papalMember = membersWithRole.first();
                        await timerService.setReminderTimer(papalMember.user.id);
                        logger.info(`⏰ Ustawiono timer przypomnienia dla papieża ${papalMember.user.tag}`);
                    }
                }
            } catch (error) {
                logger.error('❌ Błąd podczas ustawiania timera przypomnienia:', error);
            }
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
        } else if (interaction.isModalSubmit()) {
            await interactionHandler.handleModalSubmit(interaction);
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