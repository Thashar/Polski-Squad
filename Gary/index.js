const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const config = require('./config/config');
const GarrytoolsService = require('./services/garrytoolsService');
const ClanService = require('./services/clanService');
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
let garrytoolsService, clanService, logService, interactionHandler;

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
        
        // Initial clan data fetch
        await clanService.fetchClanData();
        
        logger.info('Available commands:');
        logger.info('- /lunarmine - analyzes 4 guilds during Lunar Mine Expedition');
        logger.info('- /search - analyzes single guild with fixed guild substitution');
        logger.info('- /refresh - refreshes guild ranking data');
        logger.info('- /proxy-test - tests configured proxies (Admin only)');
        logger.info('- /proxy-stats - shows proxy statistics (Admin only)');
        logger.info(`Allowed channel: ${config.allowedChannelId}`);
        logger.info(`Log channel: ${config.logChannelId}`);
        
        // Log successful initialization
        await logService.logInfo('🚀 Gary Bot initialized successfully');
        
        logger.info('✅ Gary gotowy - Lunar Mine Expedition Analysis, OCR recognition, Proxy support');
        
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
        logger.info('📦 Initializing Gary services...');
        
        // Initialize services
        garrytoolsService = new GarrytoolsService(config, logger);
        logger.info('✅ GarrytoolsService initialized');
        
        clanService = new ClanService(config, logger);
        logger.info('✅ ClanService initialized');
        
        
        logService = new LogService(config, logger);
        logger.info('✅ LogService initialized');
        
        interactionHandler = new InteractionHandler(config, garrytoolsService, clanService, logService, logger);
        logger.info('✅ InteractionHandler initialized');
        
        logger.info('🎉 All Gary services initialized successfully');
        
        logger.info('🔑 Attempting to login with Discord token...');
        
        // Add timeout to prevent hanging
        const loginPromise = client.login(config.token);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Login timeout after 30 seconds')), 30000)
        );
        
        await Promise.race([loginPromise, timeoutPromise]);
        logger.info('✅ Successfully logged in to Discord');
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