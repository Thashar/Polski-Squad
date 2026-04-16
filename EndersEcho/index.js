const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const OCRService = require('./services/ocrService');
const AIOCRService = require('./services/aiOcrService');
const RankingService = require('./services/rankingService');
const LogService = require('./services/logService');
const RoleService = require('./services/roleService');
const NotificationService = require('./services/notificationService');
const InteractionHandler = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const ocrService = new OCRService(config);
const aiOcrService = new AIOCRService(config);
const rankingService = new RankingService(config);
const logService = new LogService(config);
const roleService = new RoleService(config, rankingService);
const notificationService = new NotificationService(config);
const interactionHandler = new InteractionHandler(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService);

/**
 * Inicjalizuje bota EndersEcho
 */
async function initializeBot() {
    try {
        const guildCount = config.guilds.length;
        logger.success(`✅ EndersEcho gotowy - ranking z OCR, TOP role, ${guildCount} serwer(ów)`);

        // Inicjalizuj OCR service
        await ocrService.initialize();

        // Rejestracja slash commands dla wszystkich serwerów
        await interactionHandler.registerSlashCommands(client);

        // Eksportuj aktualny globalny ranking do shared_data przy starcie.
        // Bez push do API — dane się nie zmieniły od ostatniego zapisu,
        // więc unikamy zbędnego ruchu przy każdym restarcie.
        try {
            await rankingService.saveSharedRanking({ pushToApi: false });
        } catch (e) {
            logger.warn('Nie można wyeksportować rankingu do shared_data przy starcie:', e.message);
        }

    } catch (error) {
        logger.error('Błąd podczas inicjalizacji bota EndersEcho:', error);
    }
}

client.once('ready', initializeBot);

client.on('interactionCreate', async (interaction) => {
    try {
        await interactionHandler.handleInteraction(interaction);
    } catch (error) {
        logger.error('Błąd podczas obsługi interakcji:', error);

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.',
                    flags: ['Ephemeral']
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.'
                });
            }
        } catch (replyError) {
            logger.error('Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

client.on('error', error => {
    logger.error('Błąd klienta Discord:', error);
});

/**
 * Startuje bota EndersEcho
 */
async function startBot() {
    try {
        await client.login(config.token);
        return client;
    } catch (error) {
        logger.error('Błąd podczas logowania bota EndersEcho:', error);
        throw error;
    }
}

/**
 * Zatrzymuje bota EndersEcho
 */
async function stopBot() {
    try {
        if (client.readyAt) {
            await client.destroy();
            logger.info('Bot EndersEcho został zatrzymany');
        }
    } catch (error) {
        logger.error('Błąd podczas zatrzymywania bota EndersEcho:', error);
    }
}

module.exports = {
    name: 'EndersEcho',
    start: startBot,
    stop: stopBot,
    client
};

if (require.main === module) {
    startBot().catch(error => logger.error('Błąd uruchomienia bota:', error));

    process.on('SIGINT', async () => {
        logger.info('Otrzymano sygnał SIGINT, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Otrzymano sygnał SIGTERM, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });
}
