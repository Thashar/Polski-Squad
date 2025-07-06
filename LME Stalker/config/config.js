require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
    // Discord Bot Token
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    
    // Ścieżki do plików bazy danych
    DATABASE_FILE: process.env.DATABASE_FILE || './data/punishments.json',
    WEEKLY_REMOVAL_FILE: process.env.WEEKLY_REMOVAL_FILE || './data/weekly_removal.json',
    
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
    POLISH_ALPHABET: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźżAĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ0123456789.,;:!?-()[]{}/" '
};

// Walidacja konfiguracji
if (!config.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN nie jest ustawiony w pliku .env');
    process.exit(1);
}

if (!config.PUNISHMENT_ROLE_ID) {
    console.error('❌ PUNISHMENT_ROLE_ID nie jest ustawiony w pliku .env');
    process.exit(1);
}

if (config.ALLOWED_PUNISH_ROLES.length === 0) {
    console.error('❌ ALLOWED_PUNISH_ROLES nie są ustawione w pliku .env');
    process.exit(1);
}

module.exports = config;
