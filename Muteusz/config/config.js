const path = require('path');
const messages = require('./messages');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'MUTEUSZ_TOKEN',
    'MUTEUSZ_CLIENT_ID',
    'MUTEUSZ_GUILD_ID',
    'MUTEUSZ_TARGET_CHANNEL_ID',
    'MUTEUSZ_LOG_CHANNEL_ID',
    'MUTEUSZ_TRIGGER_ROLE_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    console.error('Sprawdź plik Muteusz/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
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
    
    roleManagement: {
        triggerRoleId: process.env.MUTEUSZ_TRIGGER_ROLE_ID
    },
    
    roles: {
        requiredPermission: 'ManageRoles',
        enableQuickMode: true,
        maxRemovalsPerBatch: 10,
        delayBetweenRemovals: 1000
    },
    
    logging: {
        enableConsoleLogging: true,
        enableChannelLogging: true,
        logChannelId: process.env.MUTEUSZ_LOG_CHANNEL_ID
    },
    
    messages
};