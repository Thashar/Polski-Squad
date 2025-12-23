const { Client, GatewayIntentBits, Partials } = require('discord.js');

const config = require('./config/config');

const DataService = require('./services/dataService');
const GameService = require('./services/gameService');
const TimerService = require('./services/timerService');
const RankingService = require('./services/rankingService');
const CommandService = require('./services/commandService');
const PasswordEmbedService = require('./services/passwordEmbedService');
const ScheduledHintsService = require('./services/scheduledHintsService');
const JudgmentService = require('./services/judgmentService');
const DetailedLogger = require('./services/detailedLogger');
const MessageCleanupService = require('./services/messageCleanupService');

const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const { createBotLogger } = require('../utils/consoleLogger');
const NicknameManager = require('../utils/nicknameManagerService');

const logger = createBotLogger('Konklawe');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

let dataService, gameService, timerService, rankingService, commandService, nicknameManager, passwordEmbedService, scheduledHintsService, judgmentService, detailedLogger, messageCleanupService;
let interactionHandler, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    dataService = new DataService();

    // Najpierw utwórz serwisy podstawowe
    gameService = new GameService(config, dataService);
    timerService = new TimerService(config, gameService);
    // RankingService będzie zainicjalizowany później z detailedLogger
    rankingService = null;
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

    // Inicjalizacja DetailedLogger (przed JudgmentService i RankingService)
    detailedLogger = new DetailedLogger(client, config);
    await detailedLogger.initialize();

    // Inicjalizacja RankingService z detailedLogger
    rankingService = new RankingService(config, gameService, detailedLogger);

    // Inicjalizacja JudgmentService
    judgmentService = new JudgmentService(config, detailedLogger);

    // Inicjalizacja MessageCleanupService
    messageCleanupService = new MessageCleanupService(client, logger, config.dataDir);

    // Inicjalizacja handlerów z wszystkimi serwisami
    interactionHandler = new InteractionHandler(config, gameService, rankingService, timerService, nicknameManager, passwordEmbedService, scheduledHintsService, judgmentService, detailedLogger, messageCleanupService);
    interactionHandler.setClient(client); // Ustaw klienta dla cleanup funkcji
    messageHandler = new MessageHandler(config, gameService, rankingService, timerService, passwordEmbedService, scheduledHintsService);

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

    // Przywróć nicki dla wygasłych klątw (efektów które wygasły podczas offline bota)
    try {
        const result = await nicknameManager.restoreExpiredEffects(client);
        if (result.restored > 0) {
            logger.info(`✅ Przywrócono ${result.restored} nicków po restarcie bota`);
        }
    } catch (error) {
        logger.error('❌ Błąd przywracania wygasłych efektów:', error);
    }

    // Zainicjalizuj MessageCleanupService (usuwa przeterminowane i przywraca timery)
    try {
        await messageCleanupService.initialize();
    } catch (error) {
        logger.error('❌ Błąd inicjalizacji MessageCleanupService:', error);
    }

    // Odtwórz timery dla AKTYWNYCH klątw (które jeszcze trwają)
    try {
        const guild = client.guilds.cache.first();
        if (guild && interactionHandler) {
            const timersRestored = await interactionHandler.restoreActiveTimers(guild);
            if (timersRestored > 0) {
                logger.info(`✅ Odtworzono ${timersRestored} timerów dla aktywnych klątw`);
            }
        }
    } catch (error) {
        logger.error('❌ Błąd odtwarzania timerów klątw:', error);
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

            }
        }

        // Inicjalizacja embeda na kanale trigger
        if (triggerChannel && triggerChannel.isTextBased()) {
            await passwordEmbedService.initializeEmbed();
            logger.info('✅ Zainicjalizowano embed statusu hasła');
        }

        // Inicjalizacja embeda Sądu Bożego
        judgmentService.setClient(client);
        await judgmentService.initializeJudgmentEmbed();
        logger.info('✅ Zainicjalizowano embed Sądu Bożego');

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
            const { MessageFlags } = require('discord.js');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.',
                    flags: MessageFlags.Ephemeral
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

module.exports = {
    start
};

if (require.main === module) {
    start();
}