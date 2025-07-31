const path = require('path');
const messages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'MUTEUSZ_TOKEN',
    'MUTEUSZ_CLIENT_ID',
    'MUTEUSZ_GUILD_ID',
    'MUTEUSZ_TARGET_CHANNEL_ID',
    'MUTEUSZ_LOG_CHANNEL_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik Muteusz/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

// Role do usunięcia zostały przeniesione do data/special_roles.json
// Nie używamy już ENV do definicji ról specjalnych

module.exports = {
    token: process.env.MUTEUSZ_TOKEN,
    clientId: process.env.MUTEUSZ_CLIENT_ID,
    guildId: process.env.MUTEUSZ_GUILD_ID,
    
    // Pliki bazy danych
    database: {
        removedRoles: './Muteusz/data/removed_roles.json'
    },
    
    media: {
        targetChannelId: process.env.MUTEUSZ_TARGET_CHANNEL_ID,
        cacheDir: './Muteusz/temp/media_cache',
        autoCleanup: true,
        cacheLifetime: 86400000, // 24 godziny
        maxCacheSize: 2147483648, // 2GB
        maxFileSize: 104857600, // 100MB
        supportedExtensions: [
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
            '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'
        ]
    },
    
    
    roles: {
        requiredPermission: 'ManageRoles',
        maxRemovalsPerBatch: 10,
        delayBetweenRemovals: 1000
    },
    
    clean: {
        requiredPermission: 'ModerateMembers',
        maxMessages: 100,
        maxMinutes: 1000
    },
    
    mute: {
        requiredPermission: 'ModerateMembers',
        muteRoleId: '1204442133818249270',
        maxTimeMinutes: 10080 // 7 dni
    },
    
    moderation: {
        kick: {
            requiredPermission: 'KickMembers'
        },
        ban: {
            requiredPermission: 'BanMembers',
            defaultDeleteDays: 1
        },
        unban: {
            requiredPermission: 'BanMembers'
        },
        warn: {
            requiredPermission: 'ModerateMembers'
        }
    },
    
    warnings: {
        maxPerPage: 10,
        dataFile: './Muteusz/data/warnings.json'
    },
    
    autoModeration: {
        enabled: true,
        violationWindow: 15, // okno czasowe w minutach
        violationsBeforeWarn: 3, // ilość wyzwisk przed warnem
        warningsBeforeMute: 3, // ilość warnów przed mute
        muteTime: 60, // czas mute w minutach
        exemptRoles: [], // role zwolnione z auto-moderacji
        exemptChannels: [], // kanały zwolnione z auto-moderacji
        logChannel: null, // kanał do logowania auto-moderacji
        deleteMessages: true, // czy usuwać wiadomości z wyzwiskami
        notifyUser: true // czy powiadamiać użytkownika o naruszeniach
    },
    
    logging: {
        enableConsoleLogging: true,
        enableChannelLogging: false,
        logChannelId: process.env.MUTEUSZ_LOG_CHANNEL_ID
    },
    
    // Konfiguracja kickowania użytkowników bez ról (współpraca z Rekruterem)
    roleKicking: {
        enabled: true,
        checkInterval: '0 */2 * * *', // Co 2 godziny
        rekruterDataPath: '../Rekruter/data/user_monitoring.json'
    },
    
    messages
};