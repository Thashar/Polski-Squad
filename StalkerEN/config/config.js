const path = require('path');
const fs = require('fs');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerEN');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Validate required environment variables (only bot token now)
const requiredEnvVars = [
    'STALKER_EN_DISCORD_TOKEN'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Missing environment variables:', missingVars.join(', '));
    logger.error('Check the StalkerEN/.env file and ensure all required variables are set.');
    process.exit(1);
}

// Load server configurations from servers.json
let serversConfig = {};
const serversConfigPath = path.join(__dirname, 'servers.json');

try {
    if (fs.existsSync(serversConfigPath)) {
        const rawData = fs.readFileSync(serversConfigPath, 'utf8');
        serversConfig = JSON.parse(rawData);
        // Remove comments from config
        delete serversConfig._comment;
        logger.info(`✅ Loaded configuration for ${Object.keys(serversConfig).length} server(s)`);
    } else {
        logger.warn('⚠️ servers.json not found. Bot will not work until you create this file.');
        logger.warn('See servers.json.example for reference.');
    }
} catch (error) {
    logger.error('❌ Error loading servers.json:', error.message);
    process.exit(1);
}

/**
 * Get configuration for a specific server
 * @param {string} guildId - Discord Guild ID
 * @returns {object|null} Server configuration or null if not found
 */
function getServerConfig(guildId) {
    const config = serversConfig[guildId];

    if (!config) {
        return null;
    }

    // Check if server is enabled
    if (config.enabled === false) {
        logger.warn(`⚠️ Server ${guildId} is disabled in configuration`);
        return null;
    }

    return config;
}

/**
 * Check if a server is configured
 * @param {string} guildId - Discord Guild ID
 * @returns {boolean}
 */
function isServerConfigured(guildId) {
    return getServerConfig(guildId) !== null;
}

/**
 * Get all configured server IDs
 * @returns {string[]} Array of guild IDs
 */
function getConfiguredServers() {
    return Object.keys(serversConfig).filter(guildId => {
        const config = serversConfig[guildId];
        return config && config.enabled !== false;
    });
}

module.exports = {
    token: process.env.STALKER_EN_DISCORD_TOKEN,

    // Database files
    database: {
        punishments: './StalkerEN/data/punishments.json',
        weeklyRemoval: './StalkerEN/data/weekly_removal.json'
    },

    // Timezone and deadline (global settings)
    timezone: 'Europe/Warsaw',
    bossDeadline: {
        hour: 17,
        minute: 50
    },

    // OCR Configuration (global settings)
    ocr: {
        // English alphabet for OCR whitelist
        alphabet: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-()[]{}/" ',

        // Image processing settings
        imageProcessing: {
            whiteThreshold: 200,
            contrast: 2.0,
            brightness: 20,
            gamma: 3.0,
            median: 2,
            blur: 0.8,
            upscale: 3.0
        },

        // Processed images configuration
        saveProcessedImages: true,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,
        tempDir: './StalkerEN/temp',

        // Detailed OCR logging
        detailedLogging: {
            enabled: false,  // Disabled by default
            logSimilarityCalculations: true,
            logLineAnalysis: true,
            logNickMatching: true,
            logEndAnalysis: true,
            similarityThreshold: 0.3  // Log only similarities above this threshold
        }
    },

    // Point limits (global settings)
    pointLimits: {
        punishmentRole: 2,
        lotteryBan: 3
    },

    // Vacation system configuration (global settings)
    vacations: {
        cooldownHours: 6
    },

    // Multi-server configuration functions
    getServerConfig,
    isServerConfigured,
    getConfiguredServers,
    serversConfig
};
