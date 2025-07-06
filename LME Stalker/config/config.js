const path = require('path');

// POPRAWKA: Użyj __dirname (katalog config/) + poziom wyżej
// __dirname w config/config.js wskazuje na katalog config/
// Więc jeden poziom wyżej to katalog "LME Stalker"
const BOT_ROOT_DIR = path.resolve(__dirname, '..');

// DODATKOWA ZABEZPIECZENIE: Sprawdź czy jesteśmy w odpowiednim katalogu
const expectedBotName = 'LME Stalker';
if (!BOT_ROOT_DIR.endsWith(expectedBotName)) {
    console.warn(`⚠️ Uwaga: Katalog bota nie kończy się na "${expectedBotName}"`);
    console.warn(`📁 Aktualny katalog: ${BOT_ROOT_DIR}`);
}

// Ładuj .env z katalogu bota (absolutna ścieżka)
const envPath = path.join(BOT_ROOT_DIR, '.env');
require('dotenv').config({ 
    path: envPath,
    debug: true
});

/**
 * Funkcja do konwersji względnych ścieżek na absolutne względem katalogu bota
 */
function resolveFilePath(filePath, fallbackPath) {
    if (!filePath) return fallbackPath;
    
    // Jeśli ścieżka jest już absolutna, zwróć ją
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    
    // Konwertuj względną ścieżkę na absolutną względem katalogu bota
    return path.resolve(BOT_ROOT_DIR, filePath);
}

const config = {
    // Discord Bot Token
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    
    // Ścieżki do plików bazy danych - ZAWSZE absolutne względem katalogu bota
    DATABASE_FILE: resolveFilePath(
        process.env.DATABASE_FILE, 
        path.join(BOT_ROOT_DIR, 'data', 'punishments.json')
    ),
    WEEKLY_REMOVAL_FILE: resolveFilePath(
        process.env.WEEKLY_REMOVAL_FILE, 
        path.join(BOT_ROOT_DIR, 'data', 'weekly_removal.json')
    ),
    
    // Role uprawnione do korzystania z komend
    ALLOWED_PUNISH_ROLES: process.env.ALLOWED_PUNISH_ROLES ? 
        process.env.ALLOWED_PUNISH_ROLES.split(',').map(role => role.trim()) : [],
    
    // Rola karania dla użytkowników z 3+ punktami
    PUNISHMENT_ROLE_ID: process.env.PUNISHMENT_ROLE_ID,
    
    // Role docelowe
    TARGET_ROLES: {
        '0': process.env.TARGET_ROLE_0,
        '1': process.env.TARGET_ROLE_1,
        '2': process.env.TARGET_ROLE_2,
        'main': process.env.TARGET_ROLE_MAIN
    },
    
    // Nazwy wyświetlane ról
    ROLE_DISPLAY_NAMES: {
        '0': '🎮PolskiSquad⁰🎮',
        '1': '⚡PolskiSquad¹⚡',
        '2': '💥PolskiSquad²💥',
        'main': '🔥Polski Squad🔥'
    },
    
    // Kanały ostrzeżeń
    WARNING_CHANNELS: {
        [process.env.TARGET_ROLE_0]: process.env.WARNING_CHANNEL_0,
        [process.env.TARGET_ROLE_1]: process.env.WARNING_CHANNEL_1,
        [process.env.TARGET_ROLE_2]: process.env.WARNING_CHANNEL_2,
        [process.env.TARGET_ROLE_MAIN]: process.env.WARNING_CHANNEL_MAIN
    },
    
    // Polski alfabet dla OCR
    POLISH_ALPHABET: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźżAĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ0123456789.,;:!?-()[]{}/" ',
    
    // Katalog główny bota (absolutna ścieżka)
    BOT_ROOT_DIR: BOT_ROOT_DIR,
    
    // Katalog data/ (absolutna ścieżka)
    DATA_DIR: path.join(BOT_ROOT_DIR, 'data')
};

// DIAGNOSTYKA ŚCIEŻEK
console.log('\n🔍 ==================== DIAGNOSTYKA ŚCIEŻEK ====================');
console.log(`📁 Working Directory: ${process.cwd()}`);
console.log(`📁 Config __dirname: ${__dirname}`);
console.log(`📁 Katalog bota (BOT_ROOT_DIR): ${config.BOT_ROOT_DIR}`);
console.log(`📄 Plik .env: ${envPath}`);
console.log(`📊 Katalog data/: ${config.DATA_DIR}`);
console.log(`💾 Plik punishments.json: ${config.DATABASE_FILE}`);
console.log(`🗓️ Plik weekly_removal.json: ${config.WEEKLY_REMOVAL_FILE}`);

// Sprawdź czy ścieżki są absolutne
const pathsToCheck = [
    { name: 'BOT_ROOT_DIR', path: config.BOT_ROOT_DIR },
    { name: 'DATA_DIR', path: config.DATA_DIR },
    { name: 'DATABASE_FILE', path: config.DATABASE_FILE },
    { name: 'WEEKLY_REMOVAL_FILE', path: config.WEEKLY_REMOVAL_FILE }
];

for (const { name, path: checkPath } of pathsToCheck) {
    if (!path.isAbsolute(checkPath)) {
        console.error(`❌ ${name} nie jest absolutną ścieżką: ${checkPath}`);
    } else {
        console.log(`✅ ${name}: ${checkPath}`);
    }
}

// Walidacja zmiennych środowiskowych
if (!config.DISCORD_TOKEN) {
    console.error(`❌ DISCORD_TOKEN nie jest ustawiony w pliku .env`);
    console.error(`📍 Sprawdź plik: ${envPath}`);
    process.exit(1);
}

if (!config.PUNISHMENT_ROLE_ID) {
    console.error(`❌ PUNISHMENT_ROLE_ID nie jest ustawiony w pliku .env`);
    console.error(`📍 Sprawdź plik: ${envPath}`);
    console.error(`🔧 Przykład: PUNISHMENT_ROLE_ID=1230903957241467012`);
    process.exit(1);
}

if (config.ALLOWED_PUNISH_ROLES.length === 0) {
    console.error(`❌ ALLOWED_PUNISH_ROLES nie są ustawione w pliku .env`);
    console.error(`📍 Sprawdź plik: ${envPath}`);
    console.error(`🔧 Przykład: ALLOWED_PUNISH_ROLES=role1,role2,role3`);
    process.exit(1);
}

// Sprawdź czy wszystkie wymagane role są ustawione
const requiredRoles = ['TARGET_ROLE_0', 'TARGET_ROLE_1', 'TARGET_ROLE_2', 'TARGET_ROLE_MAIN'];
let missingRoles = [];
for (const roleKey of requiredRoles) {
    if (!process.env[roleKey]) {
        missingRoles.push(roleKey);
    }
}

if (missingRoles.length > 0) {
    console.error(`❌ Brakujące role w pliku .env: ${missingRoles.join(', ')}`);
    console.error(`📍 Sprawdź plik: ${envPath}`);
}

// Sprawdź czy wszystkie kanały ostrzeżeń są ustawione
const requiredChannels = ['WARNING_CHANNEL_0', 'WARNING_CHANNEL_1', 'WARNING_CHANNEL_2', 'WARNING_CHANNEL_MAIN'];
let missingChannels = [];
for (const channelKey of requiredChannels) {
    if (!process.env[channelKey]) {
        missingChannels.push(channelKey);
    }
}

if (missingChannels.length > 0) {
    console.error(`❌ Brakujące kanały w pliku .env: ${missingChannels.join(', ')}`);
    console.error(`📍 Sprawdź plik: ${envPath}`);
}

console.log('✅ Konfiguracja załadowana pomyślnie');

module.exports = config;
