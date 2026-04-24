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

        // Tag serwera w globalnym rankingu (opcjonalny, np. "🔥 PS" lub "⚔️ CS")
        const tag = process.env[`ENDERSECHO_GUILD_${i}_TAG`] || null;
        const icon = process.env[`ENDERSECHO_GUILD_${i}_ICON`] || null;

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
            tag,
            icon,
            // null jeśli żadna rola nie skonfigurowana — roleService pomija wtedy aktualizację
            topRoles: Object.keys(topRoles).length > 0 ? topRoles : null
        });

        i++;
    }

    return guilds;
}

const guilds = parseGuildsConfig();

if (guilds.length === 0) {
    logger.warn('⚠️ Brak serwerów w .env — bot będzie działał tylko przez guild_configs.json (nowe serwery z /configure)');
}

if (guilds.length > 0) {
    logger.info(`📋 Załadowano ${guilds.length} serwer(ów) z .env`);
}

// Referencja do guildConfigService — ustawiana przez index.js po inicjalizacji
let _guildConfigService = null;

module.exports = {
    token: process.env.ENDERSECHO_TOKEN,
    clientId: process.env.ENDERSECHO_CLIENT_ID,
    infoUserId: process.env.ENDERSECHO_INFO_USER_ID || null,
    blockOcrUserIds: (process.env.ENDERSECHO_BLOCK_OCR_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
    logWebhookUrl: process.env.ENDERSECHO_LOG_WEBHOOK_URL || null,
    invalidReportChannelId: process.env.ENDERSECHO_INVALID_REPORT_CHANNEL_ID || null,
    appApiKey: process.env.ENDERSECHO_API_KEY || process.env.BOT_API_KEY || null,

    // Lista serwerów z .env (fallback gdy guildConfigService niedostępny)
    guilds,

    /**
     * Wstrzykuje referencję do GuildConfigService po jego inicjalizacji.
     * Wywoływane z index.js po guildConfigService.load().
     * @param {GuildConfigService} svc
     */
    setGuildConfigService(svc) {
        _guildConfigService = svc;
    },

    /**
     * Zwraca wszystkie skonfigurowane serwery (JSON + .env fallback).
     * JSON ma priorytet — .env serwery trafiają do JSON przy imporcie.
     * @returns {Array}
     */
    getAllGuilds() {
        if (_guildConfigService) {
            return _guildConfigService.getAllConfiguredGuilds();
        }
        return guilds;
    },

    /**
     * Zwraca konfigurację serwera po guildId.
     * Priorytet: guildConfigService (JSON) → .env guilds.
     * @param {string} guildId
     * @returns {Object|null}
     */
    getGuildConfig(guildId) {
        if (_guildConfigService) {
            const dynCfg = _guildConfigService.getConfig(guildId);
            if (dynCfg && dynCfg.configured) {
                return {
                    id: guildId,
                    allowedChannelId: dynCfg.allowedChannelId,
                    invalidReportChannelId: dynCfg.invalidReportChannelId || null,
                    lang: dynCfg.lang || 'eng',
                    tag: dynCfg.tag || null,
                    icon: dynCfg.icon || null,
                    topRoles: dynCfg.topRoles || null,
                    globalTop3Notifications: dynCfg.globalTop3Notifications !== false,
                };
            }
        }
        return guilds.find(g => g.id === guildId) || null;
    },

    /**
     * Zwraca zestaw komunikatów dla danego serwera (pol lub eng).
     * Priorytet: JSON lang → .env lang → eng (default dla nowych serwerów).
     * @param {string} guildId
     * @returns {Object}
     */
    getMessages(guildId) {
        let lang = 'eng';
        if (_guildConfigService) {
            const dynCfg = _guildConfigService.getConfig(guildId);
            if (dynCfg?.lang) {
                lang = dynCfg.lang;
            } else {
                const envGuild = guilds.find(g => g.id === guildId);
                if (envGuild?.lang) lang = envGuild.lang;
            }
        } else {
            const guildConfig = guilds.find(g => g.id === guildId);
            lang = guildConfig?.lang || 'pol';
        }
        return allMessages[lang] || allMessages['eng'];
    },

    // Domyślne wiadomości (eng) — fallback dla nowych/nieznanym serwerów
    messages: allMessages['eng'],

    // Konfiguracja rankingu
    ranking: {
        dataDir: path.join(__dirname, '../data'),
        legacyFile: path.join(__dirname, '../data/ranking.json'),
        playersPerPage: 10,
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
            'QI': 1000000000000000000,
            'SX': 1000000000000000000000
        },
        medals: ['🥇', '🥈', '🥉']
    },
};
