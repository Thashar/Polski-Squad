const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Gary');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Validate required environment variables
const requiredEnvVars = [
    'GARY_TOKEN',
    'GARY_CLIENT_ID',
    'GARY_ALLOWED_CHANNEL_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Missing environment variables:', missingVars.join(', '));
    logger.error('Check the Gary/.env file and ensure all required variables are set.');
    process.exit(1);
}

module.exports = {
    token: process.env.GARY_TOKEN,
    clientId: process.env.GARY_CLIENT_ID,
    allowedChannelIds: process.env.GARY_ALLOWED_CHANNEL_ID ? 
        process.env.GARY_ALLOWED_CHANNEL_ID.split(',').map(id => id.trim()) : 
        [],
    
    // Lunar Mine Settings
    lunarMineSettings: {
        autoRefresh: true,
        refreshInterval: 24,
        maxGuildsPerAnalysis: 4,
        defaultFixedGuilds: [10256, 12554, 20145],
        connectionTimeout: 20000,
        maxRetries: 3
    },

    // Guild ID to Clan Name mapping (from Stalker config)
    guildNames: {
        42578: '🔥Polski Squad🔥',      // Main clan
        202226: '⚡PolskiSquad¹⚡',      // Squad 1
        125634: '💥PolskiSquad²💥',     // Squad 2
        11616: '🎮PolskiSquad⁰🎮'       // Squad 0
    },
    
    // Search Settings
    searchSettings: {
        fixedGuilds: [10256, 12554, 20145],
        enableSingleGuildAnalysis: true,
        maxResultsPerGuild: 30
    },
    
    // Guild Search Settings
    guildSearchSettings: {
        exactMatchWeight: 1.0,
        startsWithWeight: 0.9,
        containsWeight: 0.8,
        reverseContainsWeight: 0.7,
        fuzzyThreshold: 0.6,
        maxSearchResults: 10
    },
    
    // Bot Settings
    botSettings: {
        enablePagination: true,
        paginationTimeout: 3600000, // 1 hour (was 600000 = 10 minutes)
        membersPerPage: 20,
        maxEmbedFields: 25,
        delayBetweenClans: 1500
    },
    
    // Debug Settings
    debugSettings: {
        enableHttpLogging: true,
        logFormData: true,
        logResponseHeaders: true,
        verboseErrors: true
    },
    
    // Authorized roles for admin commands (beyond server administrators)
    authorizedRoles: process.env.GARY_ADMIN_ROLES ? 
        process.env.GARY_ADMIN_ROLES.split(',').map(id => id.trim()) : 
        [],
    
    // Proxy Settings (Webshare API integration)
    proxy: {
        enabled: process.env.GARY_PROXY_ENABLED === 'true',
        strategy: process.env.GARY_PROXY_STRATEGY || 'random', // 'round-robin' or 'random'
        retryAttempts: parseInt(process.env.GARY_PROXY_RETRY_ATTEMPTS) || 10,
        // Webshare API endpoint for auto-updating proxy list
        webshareUrl: process.env.GARY_WEBSHARE_URL || '',
        // Fallback manual proxy list (used if webshare fails)
        proxyList: process.env.GARY_PROXY_LIST ? process.env.GARY_PROXY_LIST.split(',').map(p => p.trim()) : [],
        // Auto-refresh settings
        autoRefresh: true,
        refreshOnStartup: true
    }
};