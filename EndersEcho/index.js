const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const OCRService = require('./services/ocrService');
const RankingService = require('./services/rankingService');
const LogService = require('./services/logService');
const RoleService = require('./services/roleService');
const InteractionHandler = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Inicjalizacja klienta Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Inicjalizacja serwisów
const ocrService = new OCRService(config);
const rankingService = new RankingService(config);
const logService = new LogService(config);
const roleService = new RoleService(config, rankingService);
const interactionHandler = new InteractionHandler(config, ocrService, rankingService, logService, roleService);

/**
 * Inicjalizuje bota EndersEcho
 */
async function initializeBot() {
    try {
        logger.success('✅ EndersEcho gotowy - ranking z OCR, TOP role');
        
        // Inicjalizuj OCR service
        await ocrService.initialize();
        
        // Rejestracja slash commands
        await interactionHandler.registerSlashCommands(client);
        
    } catch (error) {
        logger.error('Błąd podczas inicjalizacji bota EndersEcho:', error);
    }
}

// Event handlers
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
            // Jeśli nie można odpowiedzieć (np. timeout), loguj tylko błąd
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

// Export dla głównego launcher
module.exports = {
    name: 'EndersEcho',
    start: startBot,
    stop: stopBot,
    client
};

// Uruchomienie jako standalone (jeśli uruchamiany bezpośrednio)
if (require.main === module) {
    startBot().catch(error => logger.error('Błąd uruchomienia bota:', error));
    
    // Graceful shutdown
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