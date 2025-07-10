const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'STALKER_LME_DISCORD_TOKEN',
    'STALKER_LME_MODERATOR_ROLE_1',
    'STALKER_LME_MODERATOR_ROLE_2',
    'STALKER_LME_MODERATOR_ROLE_3',
    'STALKER_LME_MODERATOR_ROLE_4',
    'STALKER_LME_PUNISHMENT_ROLE_ID',
    'STALKER_LME_TARGET_ROLE_0',
    'STALKER_LME_TARGET_ROLE_1',
    'STALKER_LME_TARGET_ROLE_2',
    'STALKER_LME_TARGET_ROLE_MAIN',
    'STALKER_LME_WARNING_CHANNEL_0',
    'STALKER_LME_WARNING_CHANNEL_1',
    'STALKER_LME_WARNING_CHANNEL_2',
    'STALKER_LME_WARNING_CHANNEL_MAIN'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    console.error('Sprawdź plik StalkerLME/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.STALKER_LME_DISCORD_TOKEN,
    
    // Pliki bazy danych
    database: {
        punishments: './StalkerLME/data/punishments.json',
        weeklyRemoval: './StalkerLME/data/weekly_removal.json'
    },
    
    // Strefa czasowa i deadline
    timezone: 'Europe/Warsaw',
    bossDeadline: {
        hour: 17,
        minute: 50
    },
    
    // Role uprawnione do karania
    allowedPunishRoles: [
        process.env.STALKER_LME_MODERATOR_ROLE_1,
        process.env.STALKER_LME_MODERATOR_ROLE_2,
        process.env.STALKER_LME_MODERATOR_ROLE_3,
        process.env.STALKER_LME_MODERATOR_ROLE_4
    ],
    
    // Rola dla użytkowników z 3+ punktami
    punishmentRoleId: process.env.STALKER_LME_PUNISHMENT_ROLE_ID,
    
    // Role docelowe dla różnych squadów
    targetRoles: {
        '0': process.env.STALKER_LME_TARGET_ROLE_0,
        '1': process.env.STALKER_LME_TARGET_ROLE_1,
        '2': process.env.STALKER_LME_TARGET_ROLE_2,
        'main': process.env.STALKER_LME_TARGET_ROLE_MAIN
    },
    
    // Nazwy wyświetlane ról
    roleDisplayNames: {
        '0': '🎮PolskiSquad⁰🎮',
        '1': '⚡PolskiSquad¹⚡',
        '2': '💥PolskiSquad²💥',
        'main': '🔥Polski Squad🔥'
    },
    
    // Kanały ostrzeżeń dla poszczególnych ról
    warningChannels: {
        [process.env.STALKER_LME_TARGET_ROLE_0]: process.env.STALKER_LME_WARNING_CHANNEL_0,
        [process.env.STALKER_LME_TARGET_ROLE_1]: process.env.STALKER_LME_WARNING_CHANNEL_1,
        [process.env.STALKER_LME_TARGET_ROLE_2]: process.env.STALKER_LME_WARNING_CHANNEL_2,
        [process.env.STALKER_LME_TARGET_ROLE_MAIN]: process.env.STALKER_LME_WARNING_CHANNEL_MAIN
    },
    
    // Konfiguracja OCR
    ocr: {
        // Polski alfabet dla OCR whitelist (oryginalny)
        polishAlphabet: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźżAĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ0123456789.,;:!?-()[]{}/" ',
        
        // Ustawienia przetwarzania obrazu (oryginalne)
        imageProcessing: {
            whiteThreshold: 200,
            contrast: 2.0,
            brightness: 20
        }
    },
    
    // Limity punktów
    pointLimits: {
        punishmentRole: 3,
        lotteryBan: 5
    }
};