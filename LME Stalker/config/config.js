const path = require('path');

// Znajdź katalog główny bota używając __dirname (katalog config/) + level wyżej
const BOT_ROOT_DIR = path.dirname(__dirname);

// Ładuj .env z katalogu bota
require('dotenv').config({ 
    path: path.join(BOT_ROOT_DIR, '.env'),
    debug: true
});

const config = {
    // Discord Bot Token
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    
    // Ścieżki do plików bazy danych - ZAWSZE w folderze data/
    DATABASE_FILE: process.env.DATABASE_FILE || path.join(BOT_ROOT_DIR, 'data', 'punishments.json'),
    WEEKLY_REMOVAL_FILE: process.env.WEEKLY_REMOVAL_FILE || path.join(BOT_ROOT_DIR, 'data', 'weekly_removal.json'),
    
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
    
    // Katalog główny bota
    BOT_ROOT_DIR: BOT_ROOT_DIR,
    
    // Katalog data/ (dla wygody)
    DATA_DIR: path.join(BOT_ROOT_DIR, 'data')
};

// Walidacja konfiguracji z lepszymi komunikatami błędów
console.log(`📁 Katalog bota LME Stalker: ${BOT_ROOT_DIR}`);
console.log(`📄 Ładuję plik .env z: ${path.join(BOT_ROOT_DIR, '.env')}`);
console.log(`📊 Katalog data/: ${config.DATA_DIR}`);
console.log(`💾 Plik punishments.json: ${config.DATABASE_FILE}`);
console.log(`🗓️ Plik weekly_removal.json: ${config.WEEKLY_REMOVAL_FILE}`);

if (!config.DISCORD_TOKEN) {
    console.error(`❌ DISCORD_TOKEN nie jest ustawiony w pliku .env`);
    console.error(`📍 Sprawdź plik: ${path.join(BOT_ROOT_DIR, '.env')}`);
    process.exit(1);
}

if (!config.PUNISHMENT_ROLE_ID) {
    console.error(`❌ PUNISHMENT_ROLE_ID nie jest ustawiony w pliku .env`);
    console.error(`📍 Sprawdź plik: ${path.join(BOT_ROOT_DIR, '.env')}`);
    console.error(`🔧 Przykład: PUNISHMENT_ROLE_ID=1230903957241467012`);
    process.exit(1);
}

if (config.ALLOWED_PUNISH_ROLES.length === 0) {
    console.error(`❌ ALLOWED_PUNISH_ROLES nie są ustawione w pliku .env`);
    console.error(`📍 Sprawdź plik: ${path.join(BOT_ROOT_DIR, '.env')}`);
    console.error(`🔧 Przykład: ALLOWED_PUNISH_ROLES=role1,role2,role3`);
    process.exit(1);
}

// Sprawdź czy wszystkie wymagane role są ustawione
const requiredRoles = ['TARGET_ROLE_0', 'TARGET_ROLE_1', 'TARGET_ROLE_2', 'TARGET_ROLE_MAIN'];
for (const roleKey of requiredRoles) {
    if (!process.env[roleKey]) {
        console.error(`❌ ${roleKey} nie jest ustawiony w pliku .env`);
        console.error(`📍 Sprawdź plik: ${path.join(BOT_ROOT_DIR, '.env')}`);
    }
}

// Sprawdź czy wszystkie kanały ostrzeżeń są ustawione
const requiredChannels = ['WARNING_CHANNEL_0', 'WARNING_CHANNEL_1', 'WARNING_CHANNEL_2', 'WARNING_CHANNEL_MAIN'];
for (const channelKey of requiredChannels) {
    if (!process.env[channelKey]) {
        console.error(`❌ ${channelKey} nie jest ustawiony w pliku .env`);
        console.error(`📍 Sprawdź plik: ${path.join(BOT_ROOT_DIR, '.env')}`);
    }
}

console.log('✅ Konfiguracja załadowana pomyślnie');

module.exports = config;
