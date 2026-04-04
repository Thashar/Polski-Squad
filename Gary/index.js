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
cron.schedule('45 18 * * 3', async () => {
    try {
        logger.info('📅 ========================================');
        logger.info('📅 Starting weekly Lunar Mine analysis...');
        logger.info('📅 ========================================');

        const threadId = '1441152540581564508';
        const guildIds = [42578, 202226, 125634, 11616];

        logger.info(`📅 Configuration:`);
        logger.info(`📅 - Thread ID: ${threadId}`);
        logger.info(`📅 - Guild IDs: ${guildIds.join(', ')}`);
        logger.info(`📅 - Client ready: ${client.isReady()}`);
        logger.info(`📅 - Client user: ${client.user?.tag || 'Not logged in'}`);

        // Fetch the thread
        logger.info(`📅 Attempting to fetch thread ${threadId}...`);
        const thread = await client.channels.fetch(threadId);

        if (!thread) {
            logger.error(`📅 ❌ Could not find thread ${threadId}`);
            logger.error('📅 Possible reasons:');
            logger.error('📅 - Thread ID is incorrect');
            logger.error('📅 - Bot does not have access to the thread');
            logger.error('📅 - Thread has been deleted or archived');
            await logService.logError(new Error(`Thread ${threadId} not found`), 'weekly Lunar Mine cron');
            return;
        }

        logger.info(`📅 ✅ Thread found: ${thread.name} (ID: ${thread.id})`);
        logger.info(`📅 Thread type: ${thread.type}`);
        logger.info(`📅 Thread parent: ${thread.parent?.name || 'No parent'}`);

        // Try to join the thread if not already a member
        try {
            if (thread.joinable) {
                logger.info('📅 Attempting to join thread...');
                await thread.join();
                logger.info('📅 ✅ Successfully joined thread');
            }
        } catch (joinError) {
            logger.warn(`📅 Could not join thread: ${joinError.message}`);
        }

        // Check permissions
        const permissions = thread.permissionsFor(client.user);
        logger.info(`📅 Checking bot permissions in thread...`);
        logger.info(`📅 Permissions object: ${permissions ? 'exists' : 'null'}`);

        if (!permissions) {
            logger.warn('📅 ⚠️ Could not get permissions, attempting to continue anyway...');
        } else {
            const hasSend = permissions.has('SendMessages');
            const hasManage = permissions.has('ManageMessages');
            const hasRead = permissions.has('ReadMessageHistory');

            logger.info(`📅 - Send Messages: ${hasSend}`);
            logger.info(`📅 - Manage Messages: ${hasManage}`);
            logger.info(`📅 - Read Message History: ${hasRead}`);
            logger.info(`📅 - All permissions bitfield: ${permissions.bitfield}`);

            // Try to test actual permissions by attempting operations
            if (!hasSend || !hasManage || !hasRead) {
                logger.warn('📅 ⚠️ Permission check failed, attempting test message...');

                try {
                    // Try sending a test message
                    const testMsg = await thread.send('📅 Testing permissions...');
                    await testMsg.delete();
                    logger.info('📅 ✅ Successfully sent and deleted test message - permissions are OK!');
                } catch (testError) {
                    logger.error(`📅 ❌ Failed to send test message: ${testError.message}`);
                    logger.error('📅 Bot does not have required permissions in thread');
                    await logService.logError(new Error(`Insufficient permissions: ${testError.message}`), 'weekly Lunar Mine cron');
                    return;
                }
            }
        }

        // Delete all messages in the thread (bulk delete)
        logger.info('📅 🗑️ Clearing thread messages...');
        let deletedTotal = 0;
        let deleted;
        do {
            const messages = await thread.messages.fetch({ limit: 100 });
            if (messages.size === 0) break;

            // Filter messages younger than 14 days (Discord limitation)
            const deletable = messages.filter(msg =>
                Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
            );

            if (deletable.size > 0) {
                deleted = await thread.bulkDelete(deletable, true);
                deletedTotal += deleted.size;
                logger.info(`📅 🗑️ Deleted ${deleted.size} messages (total: ${deletedTotal})`);
            } else {
                // For older messages, delete one by one
                for (const [, msg] of messages) {
                    try {
                        await msg.delete();
                        deletedTotal++;
                    } catch (e) {
                        logger.warn(`📅 Could not delete old message: ${e.message}`);
                    }
                }
                break;
            }
        } while (deleted && deleted.size >= 2);

        logger.info(`📅 ✅ Thread cleared, deleted ${deletedTotal} messages`);
        logger.info('📅 Running scheduled analysis...');

        // Run the scheduled Lunar Mine analysis
        await interactionHandler.runScheduledLunarMine(thread, guildIds);

        logger.info('📅 ========================================');
        logger.info('📅 ✅ Weekly Lunar Mine analysis completed');
        logger.info('📅 ========================================');
        await logService.logInfo('📅 Weekly Lunar Mine analysis completed');

    } catch (error) {
        logger.error('📅 ========================================');
        logger.error('📅 ❌ Error during weekly Lunar Mine analysis');
        logger.error('📅 ========================================');
        logger.error('📅 Error type:', error.name);
        logger.error('📅 Error message:', error.message);
        logger.error('📅 Error stack:', error.stack);
        logger.error('📅 ========================================');
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