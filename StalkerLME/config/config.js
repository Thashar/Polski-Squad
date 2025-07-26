const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'STALKER_LME_DISCORD_TOKEN',
    'STALKER_LME_MODERATOR_ROLE_1',
    'STALKER_LME_MODERATOR_ROLE_2',
    'STALKER_LME_MODERATOR_ROLE_3',
    'STALKER_LME_MODERATOR_ROLE_4',
    'STALKER_LME_PUNISHMENT_ROLE_ID',
    'STALKER_LME_LOTTERY_BAN_ROLE_ID',
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
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik StalkerLME/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
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
    
    // Rola dla użytkowników z 2+ punktami
    punishmentRoleId: process.env.STALKER_LME_PUNISHMENT_ROLE_ID,
    
    // Rola dla użytkowników z 3+ punktami (zakaz loterii)
    lotteryBanRoleId: process.env.STALKER_LME_LOTTERY_BAN_ROLE_ID,
    
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
        punishmentRole: 2,
        lotteryBan: 3
    },
    
    // Mapowanie ról do zamiany
    roleSwapping: {
        // Przy 3 punktach: zabierz punishmentRoleId, nadaj lotteryBanRoleId
        removeRoleId: '1230903957241467012',
        addRoleId: '1392812250263195718'
    },
    
    // Konfiguracja systemu urlopów
    vacations: {
        // Kanał gdzie będzie wyświetlana stała wiadomość z przyciskiem
        vacationChannelId: process.env.STALKER_LME_VACATION_CHANNEL_ID || '1269726207633522740',
        // Rola nadawana użytkownikom do składania wniosku
        vacationRequestRoleId: '1397677852966522920',
        // Czas po którym użytkownik może złożyć kolejny wniosek (w godzinach)
        cooldownHours: 6
    }
};