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
        emoji: '🎯',
        instance: rekruterBot,
        hasSpecialHandling: true // Bot Rekruter ma dodatkową logikę dla login()
    },
    {
        name: 'Szkolenia Bot',
        emoji: '🎓',
        instance: szkoleniaBot
    },
    {
        name: 'Stalker LME Bot',
        emoji: '⚔️',
        instance: stalkerLMEBot
    },
    {
        name: 'Muteusz Bot',
        emoji: '🤖',
        instance: muteuszBot
    },
    {
        name: 'EndersEcho Bot',
        emoji: '🏆',
        instance: endersEchoBot
    },
    {
        name: 'Kontroler Bot',
        emoji: '🎯',
        instance: KontrolerBot
    },
    {
        name: 'Konklawe Bot',
        emoji: '⛪',
        instance: konklaweBot
    }
];

/**
 * Uruchamia pojedynczy bot z obsługą błędów
 * @param {Object} config - Konfiguracja bota
 */
async function startBot(config) {
    const { name, emoji, instance, hasSpecialHandling } = config;
    
    console.log(`${emoji} Uruchamianie ${name}...`);
    
    try {
        if (typeof instance.start === 'function') {
            // Bot ma metodę start()
            await instance.start();
            console.log(`✅ ${name} został uruchomiony`);
        } else if (hasSpecialHandling && typeof instance.login === 'function') {
            // Specjalne traktowanie dla bota z metodą login()
            await instance.login();
            console.log(`✅ ${name} został uruchomiony`);
        } else {
            // Bot uruchamia się automatycznie po zaimportowaniu
            console.log(`✅ ${name} został uruchomiony automatycznie`);
        }
    } catch (error) {
        console.error(`❌ Błąd uruchomienia ${name}:`, error);
    }
}

/**
 * Uruchamia wszystkie boty sekwencyjnie
 */
async function startAllBots() {
    console.log('🚀 Uruchamianie botów...\n');
    
    for (const botConfig of botConfigs) {
        await startBot(botConfig);
    }
    
    console.log('\n🎉 Proces uruchamiania botów zakończony!');
    console.log('📊 Uruchomiono botów:', botConfigs.length);
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