// Ukryj dotenv warnings i deprecation warnings
process.env.DOTENV_NO_MESSAGE = 'true';
process.noDeprecation = true;

const { createBotLogger, setupGlobalLogging } = require('./utils/consoleLogger');
const { scheduler } = require('./backup-scheduler');
const GitAutoFix = require('./utils/gitAutoFix');

const logger = createBotLogger('Launcher');

// Globalny monitor ENOSPC — przechwytuje wszystkie fs.writeFile i wysyła alert na webhook
(function patchWriteFile() {
    const fs = require('fs');
    const original = fs.promises.writeFile;
    const sentPaths = new Set(); // dedup — jeden alert per plik per sesję

    fs.promises.writeFile = async function(filePath, data, options) {
        try {
            return await original.call(this, filePath, data, options);
        } catch (err) {
            if (err.code === 'ENOSPC' && !sentPaths.has(String(filePath))) {
                sentPaths.add(String(filePath));
                const shortPath = String(filePath).replace('/home/container/', '');
                logger.error(`[ENOSPC] ❌ Uszkodzony plik: ${shortPath}`);
                const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL;
                if (webhookUrl) {
                    const body = JSON.stringify({
                        embeds: [{
                            title: '🚨 ENOSPC — plik uszkodzony (zapisany jako pusty)',
                            description: `Brak miejsca na dysku podczas zapisu.\n\n📄 **Plik:** \`${shortPath}\`\n⏰ **Czas:** ${new Date().toLocaleString('pl-PL')}`,
                            color: 0xFF0000,
                            footer: { text: 'Sprawdź i przywróć plik z backupu' }
                        }]
                    });
                    try {
                        const { request } = require('https');
                        const u = new URL(webhookUrl);
                        const req = request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
                        req.write(body);
                        req.end();
                    } catch {}
                }
            }
            throw err;
        }
    };
}());

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

// Diagnostyka systemu plików przy starcie
async function runFsDiagnostics() {
    const { execSync } = require('child_process');
    const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' }).trim(); } catch { return null; } };
    const log = (msg) => logger.info(msg);

    // --- Dysk i inody ---
    const dfRaw = run('df -h /home/container 2>/dev/null || df -h .');
    const diRaw = run('df -i /home/container 2>/dev/null || df -i .');
    let diskLine = '?', inodeLine = '?';
    if (dfRaw) {
        const p = dfRaw.split('\n').pop().trim().split(/\s+/);
        diskLine = `${p[2]} / ${p[1]} użyte  (${p[4]} zapełniony, ${p[3]} wolne)`;
    }
    if (diRaw) {
        const p = diRaw.split('\n').pop().trim().split(/\s+/);
        inodeLine = `${Number(p[2]).toLocaleString('pl')} / ${Number(p[1]).toLocaleString('pl')} użyte  (${p[4]})`;
    }

    // --- Rozmiary katalogów (top 5) ---
    const watched = [
        '/home/container/node_modules', '/home/container/.git', '/home/container/.npm',
        '/home/container/logs', '/home/container/processed_ocr', '/home/container/backups',
        '/home/container/Rekruter', '/home/container/Szkolenia', '/home/container/Stalker',
        '/home/container/Muteusz', '/home/container/EndersEcho', '/home/container/Kontroler',
        '/home/container/Konklawe', '/home/container/Wydarzynier', '/home/container/Gary',
    ];
    const duRaw = run(`du -s ${watched.join(' ')} 2>/dev/null`);
    const duHuman = run(`du -sh ${watched.join(' ')} 2>/dev/null`);
    let topDirs = [];
    if (duRaw && duHuman) {
        const sizes = duRaw.split('\n').map(l => { const p = l.trim().split(/\s+/); return { kb: parseInt(p[0]) || 0, path: p[1] }; });
        const human = duHuman.split('\n').map(l => l.trim().split(/\s+/)[0]);
        topDirs = sizes.map((s, i) => ({ ...s, human: human[i] || '?' }))
            .sort((a, b) => b.kb - a.kb).slice(0, 5)
            .map(s => `  ${s.human.padStart(7)}  ${s.path.replace('/home/container/', '')}`);
    }

    // --- Foldery z największą liczbą plików (top 5) ---
    const fcRaw = run('find /home/container -maxdepth 4 -not -path "*/node_modules/*" -not -path "*/.git/*" -type d 2>/dev/null | while read d; do c=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l); [ "$c" -gt 5 ] && echo "$c $d"; done | sort -rn | head -5');
    const topFiles = fcRaw ? fcRaw.split('\n').map(l => {
        const p = l.trim().split(/\s+/);
        return `  ${p[0].padStart(5)} plików  ${p[1].replace('/home/container/', '')}`;
    }) : [];

    log('💽 Dysk:   ' + diskLine);
    log('🗂️  Inody:  ' + inodeLine);
    log('📦 Top 5 katalogów wg rozmiaru:');
    (topDirs.length ? topDirs : ['  (brak danych)']).forEach(l => log(l));
    log('📁 Top 5 katalogów wg liczby plików:');
    (topFiles.length ? topFiles : ['  (brak danych)']).forEach(l => log(l));
}

// Monitor dysku — cykliczne sprawdzanie zapełnienia hosta
function startDiskMonitor() {
    const WARN_THRESHOLD  = 90; // % — ostrzeżenie
    const CRIT_THRESHOLD  = 95; // % — krytyczne
    const CHECK_INTERVAL  = 60 * 60 * 1000; // co 1h
    const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL;

    const sendAlert = (percent, avail, used, total, level) => {
        if (!webhookUrl) return;
        const isWarn = level === 'warn';
        const body = JSON.stringify({
            embeds: [{
                title: isWarn ? '⚠️ Dysk hosta — wysokie zapełnienie' : '🚨 Dysk hosta — stan krytyczny!',
                description: `Zapełnienie dysku fizycznego serwera przekroczyło próg.\n\n💽 **Zajęte:** ${used} / ${total} (${percent}%)\n📂 **Wolne:** ${avail}`,
                color: isWarn ? 0xFFA500 : 0xFF0000,
                footer: { text: isWarn ? `Próg ostrzeżenia: ${WARN_THRESHOLD}%` : `Próg krytyczny: ${CRIT_THRESHOLD}% — ryzyko ENOSPC!` },
                timestamp: new Date().toISOString()
            }]
        });
        try {
            const { request } = require('https');
            const u = new URL(webhookUrl);
            const req = request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
            req.write(body);
            req.end();
        } catch {}
    };

    const check = () => {
        try {
            const { execSync } = require('child_process');
            const raw = execSync('df -h /home/container 2>/dev/null || df -h .', { encoding: 'utf8' }).trim();
            const p = raw.split('\n').pop().trim().split(/\s+/);
            const percent = parseInt(p[4]);
            const [used, total, avail] = [p[2], p[1], p[3]];
            if (percent >= CRIT_THRESHOLD) {
                logger.error(`[DISK] 🚨 Dysk hosta krytyczny: ${percent}% (${used}/${total}, wolne: ${avail})`);
                sendAlert(percent, avail, used, total, 'crit');
            } else if (percent >= WARN_THRESHOLD) {
                logger.warn(`[DISK] ⚠️ Dysk hosta wysoki: ${percent}% (${used}/${total}, wolne: ${avail})`);
                sendAlert(percent, avail, used, total, 'warn');
            }
        } catch {}
    };

    setInterval(check, CHECK_INTERVAL);
    check(); // sprawdź też od razu przy starcie
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
    startDiskMonitor();
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