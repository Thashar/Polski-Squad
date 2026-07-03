const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const config = require('./config/config');
const GarrytoolsService = require('./services/garrytoolsService');
const ClanService = require('./services/clanAjaxService');
const PlayerService = require('./services/playerService');
const EndersEchoService = require('./services/endersEchoService');
const LogService = require('./services/logService');
const ClanHistoryService = require('./services/clanHistoryService');
const InteractionHandler = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Gary');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let garrytoolsService, clanService, playerService, endersEchoService, logService, clanHistoryService, interactionHandler;

/**
 * Initialize the Gary bot
 */
async function initializeBot() {
    try {
        // Set client for log service
        logService.setClient(client);
        
        // Register slash commands
        await interactionHandler.registerSlashCommands(client);
        
        // Log successful initialization
        await logService.logInfo('🚀 Gary Bot initialized successfully');
        
        logger.info('✅ Gary gotowy - Lunar Mine Expedition Analysis, API integration, Proxy support');
        
    } catch (error) {
        logger.error('Error during Gary bot initialization:', error);
        await logService.logError(error, 'bot initialization');
    }
}

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
    }, {
        timezone: "Europe/Warsaw"
    });
}

// Set up pagination cleanup
cron.schedule('*/10 * * * *', () => {
    interactionHandler.cleanup();
}, {
    timezone: "Europe/Warsaw"
});

// Weekly clan history snapshot - every Wednesday at 18:50 Poland time (5 min after Lunar Mine)
// Fetches fresh TOP500 clan data and saves a persistent weekly snapshot
cron.schedule('50 18 * * 3', async () => {
    try {
        logger.info('📸 Saving weekly clan history snapshot...');
        await clanService.fetchClanData();
        const clans = clanService.getClanData();
        if (clans.length > 0) {
            clanHistoryService.saveSnapshot(clans);
            logger.info(`📸 ✅ Clan history snapshot saved: ${clans.length} clans`);
            await logService.logInfo(`📸 Weekly clan history snapshot saved (${clans.length} clans, ${clanHistoryService.getSnapshotCount()} total)`);
        } else {
            logger.warn('📸 ⚠️ Clan data empty — snapshot not saved');
        }
    } catch (error) {
        logger.error('📸 ❌ Error saving clan history snapshot:', error.message);
        await logService.logError(error, 'clan history snapshot cron');
    }
}, {
    timezone: "Europe/Warsaw"
});

// Weekly Lunar Mine analysis - every Wednesday at 18:45 Poland time
// Thread ID: 1441152540581564508
// Guild IDs: 42578, 202226, 125634, 11616
// Captcha na garrytools.com nie jest już rozwiązywana automatycznie - cron tylko wysyła na kanał
// admina prośbę o ręczne ID (przycisk -> modal). Czyszczenie wątku, pobranie danych i publikacja
// wyników odbywa się dopiero po podaniu ID przez interactionHandler.processLmeManualSnapshot.
cron.schedule('45 18 * * 3', async () => {
    try {
        logger.info('📅 Weekly Lunar Mine: requesting manual Group ID from admin...');

        let targetChannel = null;
        if (config.adminCaptchaChannelId) {
            try {
                targetChannel = await client.channels.fetch(config.adminCaptchaChannelId);
            } catch (fetchError) {
                logger.warn(`📅 ⚠️ Could not fetch admin captcha channel (${config.adminCaptchaChannelId}): ${fetchError.message}`);
            }
        }

        if (!targetChannel) {
            targetChannel = await client.channels.fetch('1441152540581564508').catch(() => null);
        }

        if (!targetChannel) {
            logger.error('📅 ❌ Could not find any channel to post the manual ID request');
            await logService.logError(new Error('No channel available for manual LME ID request'), 'weekly Lunar Mine cron');
            return;
        }

        await interactionHandler.sendLmeManualIdRequest(targetChannel);

        logger.info('📅 ✅ Manual ID request sent, waiting for admin to submit Group ID');
        await logService.logInfo('📅 Weekly Lunar Mine: czekam na ręczne podanie ID przez admina');

    } catch (error) {
        logger.error('📅 ❌ Error during weekly Lunar Mine cron:', error.message);
        await logService.logError(error, 'weekly Lunar Mine cron job');
    }
}, {
    timezone: "Europe/Warsaw"
});

/**
 * Start the Gary bot
 */
async function startBot() {
    try {
        // Initialize services
        const ProxyService = require('./services/proxyService');
        const proxyService = new ProxyService(config, logger);

        try {
            garrytoolsService = new GarrytoolsService(config, logger);
        } catch (error) {
            logger.error('❌ GarrytoolsService failed to initialize:', error.message);
            throw error;
        }

        try {
            clanService = new ClanService(config, logger);
        } catch (error) {
            logger.error('❌ ClanService failed to initialize:', error.message);
            throw error;
        }

        try {
            playerService = new PlayerService(config, logger);
        } catch (error) {
            logger.error('❌ PlayerService failed to initialize:', error.message);
            throw error;
        }

        try {
            endersEchoService = new EndersEchoService(config, logger);
        } catch (error) {
            logger.error('❌ EndersEchoService failed to initialize:', error.message);
            throw error;
        }

        try {
            logService = new LogService(config, logger);
        } catch (error) {
            logger.error('❌ LogService failed to initialize:', error.message);
            throw error;
        }

        try {
            clanHistoryService = new ClanHistoryService(logger);
        } catch (error) {
            logger.error('❌ ClanHistoryService failed to initialize:', error.message);
            throw error;
        }

        try {
            interactionHandler = new InteractionHandler(config, garrytoolsService, clanService, playerService, endersEchoService, logService, clanHistoryService, logger);
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