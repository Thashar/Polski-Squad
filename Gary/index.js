const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const config = require('./config/config');
const GarrytoolsService = require('./services/garrytoolsService');
const ClanService = require('./services/clanAjaxService');
const PlayerService = require('./services/playerService');
const EndersEchoService = require('./services/endersEchoService');
const LogService = require('./services/logService');
const InteractionHandler = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Gary');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Services will be initialized in startBot function
let garrytoolsService, clanService, playerService, endersEchoService, logService, interactionHandler;

/**
 * Initialize the Gary bot
 */
async function initializeBot() {
    try {
        logger.info(`Bot logged in as ${client.user.tag}!`);
        logger.info('🎯 Gary Bot - Survivor.io Lunar Mine Expedition Analysis');
        logger.info('🔗 Connected to Garrytools API (garrytools.com)');
        logger.info('✨ Translated to English with Polski Squad architecture');
        logger.info('🔧 Enhanced with logging and .env configuration');
        
        // Set client for log service
        logService.setClient(client);
        
        // Register slash commands
        await interactionHandler.registerSlashCommands(client);
        
        // Startup data fetching disabled - use /refresh command to load data
        logger.info('⏭️ Skipping initial data fetch to reduce API calls during startup');
        logger.info('💡 Use /refresh command to load guild, player, and EndersEcho data');
        
        
        // Log successful initialization
        await logService.logInfo('🚀 Gary Bot initialized successfully');
        
        logger.info('✅ Gary gotowy - Lunar Mine Expedition Analysis, API integration, Proxy support');
        
    } catch (error) {
        logger.error('Error during Gary bot initialization:', error);
        await logService.logError(error, 'bot initialization');
    }
}

// Event handlers
client.once('ready', initializeBot);

client.on('interactionCreate', async (interaction) => {
    try {
        await interactionHandler.handleInteraction(interaction);
    } catch (error) {
        logger.error('Error handling interaction:', error);
        await logService.logError(error, 'interaction handling');
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ An error occurred while processing the command.', 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ An error occurred while processing the command.' 
                });
            }
        } catch (replyError) {
            logger.error('Cannot reply to interaction (probably timeout):', replyError.message);
        }
    }
});

client.on('error', error => {
    logger.error('Discord client error:', error);
    logService.logError(error, 'Discord client');
});

// Set up automatic clan data refresh
if (config.lunarMineSettings?.autoRefresh) {
    const interval = config.lunarMineSettings.refreshInterval || 6;
    cron.schedule(`0 */${interval} * * *`, async () => {
        logger.info('🔄 Automatic data refresh...');
        await clanService.fetchClanData();
        await logService.logInfo('📊 Clan data automatically refreshed');
    });
}

// Set up pagination cleanup
cron.schedule('*/10 * * * *', () => {
    interactionHandler.cleanup();
});

/**
 * Start the Gary bot
 */
async function startBot() {
    try {
        // Initialize services with error handling
        logger.info('🔧 Initializing services...');

        // Initialize ProxyService first (singleton pattern)
        const ProxyService = require('./services/proxyService');
        const proxyService = new ProxyService(config, logger);
        logger.info('✅ ProxyService initialized (singleton)');

        try {
            garrytoolsService = new GarrytoolsService(config, logger);
            logger.info('✅ GarrytoolsService initialized');
        } catch (error) {
            logger.error('❌ GarrytoolsService failed to initialize:', error.message);
            throw error;
        }

        try {
            clanService = new ClanService(config, logger);
            logger.info('✅ ClanService initialized');
        } catch (error) {
            logger.error('❌ ClanService failed to initialize:', error.message);
            throw error;
        }

        try {
            playerService = new PlayerService(config, logger);
            logger.info('✅ PlayerService initialized');
        } catch (error) {
            logger.error('❌ PlayerService failed to initialize:', error.message);
            throw error;
        }

        try {
            endersEchoService = new EndersEchoService(config, logger);
            logger.info('✅ EndersEchoService initialized');
        } catch (error) {
            logger.error('❌ EndersEchoService failed to initialize:', error.message);
            throw error;
        }
        
        try {
            logService = new LogService(config, logger);
            logger.info('✅ LogService initialized');
        } catch (error) {
            logger.error('❌ LogService failed to initialize:', error.message);
            throw error;
        }
        
        try {
            interactionHandler = new InteractionHandler(config, garrytoolsService, clanService, playerService, endersEchoService, logService, logger);
            logger.info('✅ InteractionHandler initialized');
        } catch (error) {
            logger.error('❌ InteractionHandler failed to initialize:', error.message);
            throw error;
        }
        
        // Add timeout to prevent hanging
        const loginPromise = client.login(config.token);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Login timeout after 30 seconds')), 30000)
        );
        
        await Promise.race([loginPromise, timeoutPromise]);
        return client;
    } catch (error) {
        logger.error('Error during Gary bot startup:', error);
        if (logService) {
            await logService.logError(error, 'bot startup');
        }
        throw error;
    }
}

/**
 * Stop the Gary bot
 */
async function stopBot() {
    try {
        logger.info('Stopping Gary bot...');
        await logService.logInfo('🛑 Gary Bot shutting down');
        client.destroy();
        logger.info('Gary bot stopped successfully');
    } catch (error) {
        logger.error('Error stopping Gary bot:', error);
        throw error;
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal, shutting down gracefully...');
    await stopBot();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal, shutting down gracefully...');
    await stopBot();
    process.exit(0);
});

// Export for main launcher
module.exports = {
    start: startBot,  // Alias for main launcher
    startBot,
    stopBot,
    client
};

// If this file is run directly, start the bot
if (require.main === module) {
    startBot().catch(error => {
        logger.error('Failed to start Gary bot:', error);
        process.exit(1);
    });
}