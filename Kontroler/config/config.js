const path = require('path');
const messages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'KONTROLER_TOKEN',
    'KONTROLER_CLIENT_ID',
    'KONTROLER_GUILD_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik Kontroler/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.KONTROLER_TOKEN,
    clientId: process.env.KONTROLER_CLIENT_ID,
    guildId: process.env.KONTROLER_GUILD_ID,

    // Rola blokująca udział w loteriach
    blockedRole: '1392812250263195718',
    
    // Kanały do monitorowania
    channels: {
        cx: {
            targetChannelId: '1305607184037449738',
            requiredRoleId: '1298594615619751966',
            minimumScore: 1500,
            scoreRange: [0, 2800],
            scoreStep: 100,
            requireSecondOccurrence: false,
            name: 'CX',
            skipLines: 1,
            // Nowa konfiguracja dla roli specjalnej
            specialRole: {
                roleId: '1421502672112058589',
                threshold: 2800
            }
        },
        daily: {
            targetChannelId: '1297828299006808124',
            requiredRoleId: '1297834373499977769',
            minimumScore: 910,
            scoreRange: [0, 1050],
            scoreStep: 10,
            requireSecondOccurrence: true,
            name: 'Daily',
            skipLines: 3
        }
    },
    
    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),
        saveProcessedImages: true,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,
        languages: 'pol+eng',
        charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄąĆćĘęŁłŃńÓóŚśŹźŻż .,:-_[](){}',
        pagesegMode: 'AUTO',
        ocrEngineMode: 'LSTM_ONLY',
        whiteThreshold: 200,
        gamma: 2.0,
        luminanceThresholds: {
            white: 200,
            black: 120
        },
        
        // Szczegółowe logowanie OCR
        detailedLogging: {
            enabled: false,  // Domyślnie wyłączone
            logImageProcessing: true,
            logTextExtraction: true,
            logNickDetection: true,
            logScoreValidation: true,
            logCharacterNormalization: true
        }
    },
    
    // Konfiguracja plików
    files: {
        maxSize: 8 * 1024 * 1024, // 8MB
        supportedTypes: ['image/']
    },
    
    // Konfiguracja podobieństwa nicków
    similarity: {
        threshold: 0.4,
        lowThreshold: 0.3
    },
    
    // Zamienniki znaków dla OCR
    charReplacements: {
        'o': '0', 'O': '0',
        'z': '2', 'Z': '2',
        'l': '1', 'I': '1', 'i': '1',
        'B': '8',
        'g': '9', 'G': '6'
    },
    
    // Konfiguracja systemu loterii
    lottery: {
        dataFile: path.join(__dirname, '../data/lottery_history.json'),
        
        // Definicje klanów (na podstawie Stalker bot)
        clans: {
            'server': {
                name: 'Cały Serwer',
                roleId: null, // null oznacza brak ograniczenia do konkretnego klanu
                displayName: '🌍 Cały Serwer 🌍'
            },
            'main': {
                name: 'Polski Squad',
                roleId: process.env.STALKER_LME_TARGET_ROLE_MAIN || '1170351983092383814',
                displayName: '🔥Polski Squad🔥'
            },
            '0': {
                name: 'PolskiSquad⁰',
                roleId: process.env.STALKER_LME_TARGET_ROLE_0 || '1170351932735193179',
                displayName: '🎮PolskiSquad⁰🎮'
            },
            '1': {
                name: 'PolskiSquad¹',
                roleId: process.env.STALKER_LME_TARGET_ROLE_1 || '1170351955560927262',
                displayName: '⚡PolskiSquad¹⚡'
            },
            '2': {
                name: 'PolskiSquad²',
                roleId: process.env.STALKER_LME_TARGET_ROLE_2 || '1170351976075210752',
                displayName: '💥PolskiSquad²💥'
            }
        },
        
        // Dozwolone dni tygodnia
        allowedDays: ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'],
        dayMap: {
            'poniedziałek': 1,
            'wtorek': 2,
            'środa': 3,
            'czwartek': 4,
            'piątek': 5,
            'sobota': 6,
            'niedziela': 0
        }
    },
    
    messages
};