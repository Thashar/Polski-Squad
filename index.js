// Import system logowania
const { createBotLogger, setupGlobalLogging } = require('./utils/consoleLogger');

// Import botów
const rekruterBot = require('./Rekruter/index');
const szkoleniaBot = require('./Szkolenia/index');
const stalkerLMEBot = require('./StalkerLME/index');
const muteuszBot = require('./Muteusz/index');
const endersEchoBot = require('./EndersEcho/index');
const KontrolerBot = require('./Kontroler/index');
const konklaweBot = require('./Konklawe/index');

/**
 * Konfiguracja botów z ich właściwościami TEST
 */
const botConfigs = [
    {
        name: 'Rekruter Bot',
        loggerName: 'Rekruter',
        emoji: '🎯',
        instance: rekruterBot,
        hasSpecialHandling: true // Bot Rekruter ma dodatkową logikę dla login()
    },
    {
        name: 'Szkolenia Bot',
        loggerName: 'Szkolenia',
        emoji: '🎓',
        instance: szkoleniaBot
    },
    {
        name: 'Stalker LME Bot',
        loggerName: 'StalkerLME',
        emoji: '⚔️',
        instance: stalkerLMEBot
    },
    {
        name: 'Muteusz Bot',
        loggerName: 'Muteusz',
        emoji: '🤖',
        instance: muteuszBot
    },
    {
        name: 'EndersEcho Bot',
        loggerName: 'EndersEcho',
        emoji: '🏆',
        instance: endersEchoBot
    },
    {
        name: 'Kontroler Bot',
        loggerName: 'Kontroler',
        emoji: '🎯',
        instance: KontrolerBot
    },
    {
        name: 'Konklawe Bot',
        loggerName: 'Konklawe',
        emoji: '⛪',
        instance: konklaweBot
    }
];

/**
 * Uruchamia pojedynczy bot z obsługą błędów
 * @param {Object} config - Konfiguracja bota
 */
async function startBot(config) {
    const { name, loggerName, emoji, instance, hasSpecialHandling } = config;
    
    try {
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
 * Uruchamia wszystkie boty sekwencyjnie
 */
async function startAllBots() {
    setupGlobalLogging();
    
    for (const botConfig of botConfigs) {
        await startBot(botConfig);
    }
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