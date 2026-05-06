// Ukryj dotenv warnings i deprecation warnings
process.env.DOTENV_NO_MESSAGE = 'true';
process.noDeprecation = true;

const { createBotLogger, setupGlobalLogging } = require('./utils/consoleLogger');
const { scheduler } = require('./backup-scheduler');
const GitAutoFix = require('./utils/gitAutoFix');

const logger = createBotLogger('Launcher');

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
        name: 'Stalker Bot',
        loggerName: 'Stalker',
        emoji: '⚔️',
        path: './Stalker/index'
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
    },
    {
        name: 'Wydarzynier Bot',
        loggerName: 'Wydarzynier',
        emoji: '🎉',
        path: './Wydarzynier/index'
    },
    {
        name: 'Gary Bot',
        loggerName: 'Gary',
        emoji: '🎮',
        path: './Gary/index'
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
        logger.error('❌ Błąd wczytywania konfiguracji botów:', error.message);
        logger.info('🔄 Używam domyślnej konfiguracji (wszystkie boty)');
        return ['rekruter', 'szkolenia', 'stalker', 'muteusz', 'endersecho', 'kontroler', 'konklawe', 'wydarzynier', 'gary'];
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

    logger.info(`🚀 ${environment}: ${enabledBotNames.join(', ')}`);

    const botsToStart = botConfigs.filter(bot =>
        enabledBotNames.includes(bot.loggerName.toLowerCase())
    );

    if (botsToStart.length === 0) {
        logger.warn('⚠️  Brak botów do uruchomienia!');
        return;
    }

    for (const botConfig of botsToStart) {
        await startBot(botConfig);
    }
}

/**
 * Obsługa zamykania aplikacji
 */
function setupShutdownHandlers() {
    const shutdown = (signal) => {
        logger.warn(`\n🛑 Otrzymano sygnał ${signal}. Zamykanie botów...`);
        process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    process.on('uncaughtException', (error) => {
        logger.error('❌ Nieobsłużony wyjątek:', error);
        process.exit(1);
    });
    
    process.on('unhandledRejection', (error) => {
        logger.error('❌ Nieobsłużone odrzucenie Promise:', error);
    });
}

// Diagnostyka systemu plików (tymczasowa - do usunięcia po diagnozie)
async function runFsDiagnostics() {
    const { execSync } = require('child_process');
    logger.info('🔍 === DIAGNOSTYKA SYSTEMU PLIKÓW ===');
    try {
        logger.info('📊 df -i (inody):');
        logger.info(execSync('df -i /home/container 2>/dev/null || df -i .', { encoding: 'utf8' }).trim());
    } catch (e) { logger.info('df -i error: ' + e.message); }
    try {
        logger.info('💾 df -h (miejsce):');
        logger.info(execSync('df -h /home/container 2>/dev/null || df -h .', { encoding: 'utf8' }).trim());
    } catch (e) { logger.info('df -h error: ' + e.message); }
    try {
        logger.info('📁 Liczba plików per katalog (top 15):');
        const out = execSync(
            'find /home/container -maxdepth 3 -not -path "*/node_modules/*" -type d 2>/dev/null | head -50 | while read d; do c=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l); [ "$c" -gt 10 ] && echo "$c $d"; done | sort -rn | head -15',
            { encoding: 'utf8', shell: '/bin/bash' }
        ).trim();
        logger.info(out || '(brak wyników)');
    } catch (e) { logger.info('find error: ' + e.message); }
    try {
        logger.info('📦 node_modules łącznie plików:');
        logger.info(execSync('find /home/container/node_modules -type f 2>/dev/null | wc -l', { encoding: 'utf8' }).trim());
    } catch (e) { logger.info('node_modules count error: ' + e.message); }
    try {
        logger.info('🗜️ Pliki ZIP:');
        logger.info(execSync('find /home/container -maxdepth 3 -name "*.zip" -ls 2>/dev/null || echo "brak"', { encoding: 'utf8' }).trim());
    } catch (e) { logger.info('zip find error: ' + e.message); }
    logger.info('🔍 === KONIEC DIAGNOSTYKI ===');
}

// Główna funkcja uruchamiająca
async function main() {
    await runFsDiagnostics();

    // Git auto-fix (jeśli włączony w .env)
    if (process.env.AUTO_GIT_FIX === 'true') {
        logger.info('🔧 AUTO_GIT_FIX włączony - sprawdzam repozytorium git...');
        const gitAutoFix = new GitAutoFix(logger);
        await gitAutoFix.autoFix();
        logger.info('');
    }

    setupShutdownHandlers();
    await startAllBots();

    // Uruchom scheduler backupów (tylko w produkcji)
    if (!process.argv.includes('--local')) {
        scheduler.start();
    } else {
        logger.info('ℹ️  Scheduler backupów wyłączony w trybie lokalnym');
    }
}

// Uruchomienie aplikacji
main().catch((error) => {
    logger.error('❌ Krytyczny błąd uruchomienia:', error);
    process.exit(1);
});