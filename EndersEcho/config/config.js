const path = require('path');
const messages = require('./messages');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'ENDERSECHO_TOKEN',
    'ENDERSECHO_CLIENT_ID',
    'ENDERSECHO_GUILD_ID',
    'ENDERSECHO_ALLOWED_CHANNEL_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    console.error('Sprawdź plik EndersEcho/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.ENDERSECHO_TOKEN,
    clientId: process.env.ENDERSECHO_CLIENT_ID,
    guildId: process.env.ENDERSECHO_GUILD_ID,
    allowedChannelId: process.env.ENDERSECHO_ALLOWED_CHANNEL_ID,
    
    // Konfiguracja rankingu
    ranking: {
        file: path.join(__dirname, '../data/ranking.json'),
        playersPerPage: 10,
        paginationTimeout: 600000 // 10 minut
    },
    
    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),
        languages: 'pol+eng',
        charWhitelist: '0123456789KMBTQS7.Best:Total ',
        charWhitelistWords: 'BestTotalbesttotal: ',
        threshold: 200
    },
    
    // Konfiguracja obrazów
    images: {
        supportedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.bmp'],
        processedSuffix: '_processed.png',
        checkSuffix: '_check.png'
    },
    
    // Konfiguracja wyników
    scoring: {
        units: {
            'K': 1000,
            'M': 1000000,
            'B': 1000000000,
            'T': 1000000000000,
            'Q': 1000000000000000,
            'S': 1000000000000000000
        },
        medals: ['🥇', '🥈', '🥉']
    },
    
    // Konfiguracja ról TOP
    topRoles: {
        top1: '1392875142383931462',
        top2: '1392877265284763740',
        top3: '1392877372486713434'
    },
    
    messages
};