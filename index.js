// Import system logowania
const { createBotLogger, setupGlobalLogging } = require('./utils/consoleLogger');

/**
 * Konfiguracja botów z ich właściwościami
 */
const botConfigs = [
    {
        name: 'Rekruter Bot',
        loggerName: 'Rekruter',
        emoji: '🎯',
        path: './Rekruter/index',
        hasSpecialHandling: true // Bot Rekruter ma dodatkową logikę dla login()
    },
    {
        name: 'Szkolenia Bot',
        loggerName: 'Szkolenia',
        emoji: '🎓',
        path: './Szkolenia/index'
    },
    {
        name: 'Stalker LME Bot',
        loggerName: 'StalkerLME',
        emoji: '⚔️',
        path: './StalkerLME/index'
    },
    {
        name: 'Muteusz Bot',
        loggerName: 'Muteusz',
        emoji: '🤖',
        path: './Muteusz/index'
    },
    {
        name: 'EndersEcho Bot',
        loggerName: 'EndersEcho',
        emoji: '🏆',
        path: './EndersEcho/index'
    },
    {
        name: 'Kontroler Bot',
        loggerName: 'Kontroler',
        emoji: '🎯',
        path: './Kontroler/index'
    },
    {
        name: 'Konklawe Bot',
        loggerName: 'Konklawe',
        emoji: '⛪',
        path: './Konklawe/index'
    }
];

/**
 * Uruchamia pojedynczy bot z obsługą błędów
 * @param {Object} config - Konfiguracja bota
 */
async function startBot(config) {
    const { name, loggerName, emoji, path, hasSpecialHandling } = config;
    
    try {
        // Dynamiczny import bota tylko gdy jest potrzebny
        const instance = require(path);
        
        if (typeof instance.start === 'function') {
            // Bot ma metodę start()
            await instance.start();
        } else if (hasSpecialHandling && typeof instance.login === 'function') {
            // Specjalne traktowanie dla bota z metodą login()
            await instance.login();
        } else {
            // Bot uruchamia się automatycznie po zaimportowaniu
            // Brak akcji - bot już się uruchomił podczas importu
        }
    } catch (error) {
        const logger = createBotLogger(loggerName);
        logger.error(`Błąd uruchomienia ${name}: ${error.message}`);
    }
}

/**
 * Wczytuje konfigurację botów z pliku
 */
function loadBotConfig() {
    try {
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('./bot-config.json', 'utf8'));
        
        // Sprawdź czy uruchamiamy w trybie lokalnym (argument --local)
        const isLocal = process.argv.includes('--local');
        const environment = isLocal ? 'development' : 'production';
        
        return config[environment] || [];
    } catch (error) {
        console.error('❌ Błąd wczytywania konfiguracji botów:', error.message);
        console.log('🔄 Używam domyślnej konfiguracji (wszystkie boty)');
        return ['rekruter', 'szkolenia', 'stalker', 'muteusz', 'endersecho', 'kontroler', 'konklawe'];
    }
}

/**
 * Uruchamia wybrane boty na podstawie konfiguracji
 */
async function startAllBots() {
    setupGlobalLogging();
    
    const enabledBotNames = loadBotConfig();
    const isLocal = process.argv.includes('--local');
    const environment = isLocal ? 'development' : 'production';
    
    console.log(`🚀 Uruchamianie botów w trybie: ${environment}`);
    console.log(`📋 Wybrane boty: ${enabledBotNames.join(', ')}`);
    
    const botsToStart = botConfigs.filter(bot => 
        enabledBotNames.includes(bot.loggerName.toLowerCase())
    );
    
    if (botsToStart.length === 0) {
        console.log('⚠️  Brak botów do uruchomienia!');
        return;
    }
    
    for (const botConfig of botsToStart) {
        await startBot(botConfig);
    }
    
    console.log(`✅ Uruchomiono ${botsToStart.length} botów`);
}

/**
 * Obsługa zamykania aplikacji
 */
function setupShutdownHandlers() {
    const shutdown = (signal) => {
        console.log(`\n🛑 Otrzymano sygnał ${signal}. Zamykanie botów...`);
        process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    process.on('uncaughtException', (error) => {
        console.error('❌ Nieobsłużony wyjątek:', error);
        process.exit(1);
    });
    
    process.on('unhandledRejection', (error) => {
        console.error('❌ Nieobsłużone odrzucenie Promise:', error);
    });
}

// Główna funkcja uruchamiająca
async function main() {
    setupShutdownHandlers();
    await startAllBots();
}

// Uruchomienie aplikacji
main().catch((error) => {
    console.error('❌ Krytyczny błąd uruchomienia:', error);
    process.exit(1);
});