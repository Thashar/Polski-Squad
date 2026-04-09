const path = require('path');
const allMessages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('EndersEcho');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja podstawowych zmiennych
const requiredEnvVars = ['ENDERSECHO_TOKEN', 'ENDERSECHO_CLIENT_ID'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    process.exit(1);
}

/**
 * Parsuje konfigurację serwerów z env vars.
 * Format: ENDERSECHO_GUILD_N_ID, ENDERSECHO_GUILD_N_CHANNEL, ENDERSECHO_GUILD_N_LANG,
 *         ENDERSECHO_GUILD_N_TOP1_ROLE, ...
 * Role TOP i język są opcjonalne (domyślnie lang=pol).
 */
function parseGuildsConfig() {
    const guilds = [];
    let i = 1;

    while (process.env[`ENDERSECHO_GUILD_${i}_ID`]) {
        const guildId = process.env[`ENDERSECHO_GUILD_${i}_ID`];
        const channelId = process.env[`ENDERSECHO_GUILD_${i}_CHANNEL`];

        if (!channelId) {
            logger.error(`❌ Brak ENDERSECHO_GUILD_${i}_CHANNEL dla serwera ${guildId}`);
            process.exit(1);
        }

        // Język interfejsu — domyślnie pol
        const rawLang = (process.env[`ENDERSECHO_GUILD_${i}_LANG`] || 'pol').toLowerCase();
        const lang = allMessages[rawLang] ? rawLang : 'pol';
        if (rawLang !== lang) {
            logger.warn(`⚠️ Nieznany język "${rawLang}" dla serwera ${guildId} — używam "pol"`);
        }

        // Role TOP są w pełni opcjonalne
        const top1 = process.env[`ENDERSECHO_GUILD_${i}_TOP1_ROLE`];
        const top2 = process.env[`ENDERSECHO_GUILD_${i}_TOP2_ROLE`];
        const top3 = process.env[`ENDERSECHO_GUILD_${i}_TOP3_ROLE`];
        const top4to10 = process.env[`ENDERSECHO_GUILD_${i}_TOP4TO10_ROLE`];
        const top11to30 = process.env[`ENDERSECHO_GUILD_${i}_TOP11TO30_ROLE`];

        const topRolesRaw = { top1, top2, top3, top4to10, top11to30 };
        const topRoles = Object.fromEntries(
            Object.entries(topRolesRaw).filter(([, v]) => v)
        );

        guilds.push({
            id: guildId,
            allowedChannelId: channelId,
            lang,
            // null jeśli żadna rola nie skonfigurowana — roleService pomija wtedy aktualizację
            topRoles: Object.keys(topRoles).length > 0 ? topRoles : null
        });

        i++;
    }

    return guilds;
}

const guilds = parseGuildsConfig();

if (guilds.length === 0) {
    logger.error('❌ Brak konfiguracji serwerów. Ustaw ENDERSECHO_GUILD_1_ID i ENDERSECHO_GUILD_1_CHANNEL w pliku .env');
    process.exit(1);
}

logger.info(`📋 Załadowano konfigurację dla ${guilds.length} serwer(ów)`);

module.exports = {
    token: process.env.ENDERSECHO_TOKEN,
    clientId: process.env.ENDERSECHO_CLIENT_ID,

    // Lista skonfigurowanych serwerów
    guilds,

    /**
     * Zwraca konfigurację serwera po guildId lub null
     * @param {string} guildId
     */
    getGuildConfig(guildId) {
        return guilds.find(g => g.id === guildId) || null;
    },

    /**
     * Zwraca zestaw komunikatów dla danego serwera (pol lub eng).
     * Fallback: pol.
     * @param {string} guildId
     * @returns {Object}
     */
    getMessages(guildId) {
        const guildConfig = guilds.find(g => g.id === guildId);
        const lang = guildConfig?.lang || 'pol';
        return allMessages[lang] || allMessages['pol'];
    },

    // Domyślne wiadomości (pol) — do użytku wewnętrznego / fallback
    messages: allMessages['pol'],

    // Konfiguracja rankingu
    ranking: {
        dataDir: path.join(__dirname, '../data'),
        legacyFile: path.join(__dirname, '../data/ranking.json'),
        playersPerPage: 20,
        paginationTimeout: 3600000 // 1 godzina
    },

    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),
        languages: 'pol+eng',
        charWhitelist: '0123456789KMBTQi7.Best:Total ',
        charWhitelistWords: 'BestTotalbesttotal: ',
        threshold: 200,

        // AI OCR (opcjonalne)
        useAI: process.env.USE_ENDERSECHO_AI_OCR === 'true',

        // Zapisywanie przetworzonych obrazów
        saveProcessedImages: false,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,

        // Szczegółowe logowanie OCR
        detailedLogging: {
            enabled: false,
            logImageProcessing: true,
            logTextExtraction: true,
            logScoreAnalysis: true,
            logBossNameExtraction: true
        }
    },

    // Konfiguracja obrazów
    images: {
        supportedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.bmp'],
        processedSuffix: '_processed.png',
        checkSuffix: '_check.png',
        maxSize: 25 * 1024 * 1024 // 25MB
    },

    // Konfiguracja wyników
    scoring: {
        units: {
            'K': 1000,
            'M': 1000000,
            'B': 1000000000,
            'T': 1000000000000,
            'Q': 1000000000000000,
            'QI': 1000000000000000000
        },
        medals: ['🥇', '🥈', '🥉']
    },
};
