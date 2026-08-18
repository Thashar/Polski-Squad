const fs = require('fs');
const path = require('path');
const https = require('https');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Kolory tekstu
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // Kolory tła
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m'
};

const botColors = {
    'Rekruter': colors.cyan,
    'Szkolenia': colors.green,
    'Stalker': colors.red,
    'Muteusz': colors.magenta,
    'EndersEcho': colors.yellow,
    'Kontroler': colors.blue,
    'Konklawe': colors.white,
    'BackupManager': colors.cyan,
    'BackupScheduler': colors.cyan,
    'ManualBackup': colors.cyan,
    'MAIN': colors.bright + colors.green
};

const botEmojis = {
    'Rekruter': '🎯',
    'Szkolenia': '🎓',
    'Stalker': '⚔️',
    'Muteusz': '🤖',
    'EndersEcho': '🏆',
    'Kontroler': '🎯',
    'Konklawe': '⛪',
    'BackupManager': '💾',
    'BackupScheduler': '⏰',
    'ManualBackup': '📦',
    'MAIN': '🚀'
};

function getTimestamp() {
    const now = new Date();
    return now.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// Zmienna globalna do śledzenia ostatniego bota
let lastBotName = null;
let lastWebhookBotName = null;

// Konfiguracja logowania do pliku
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_MAX_AGE_DAYS = 30;

// Generuj nazwę pliku logu na podstawie daty (bots-YYYY-MM-DD.log)
function getLogFilePath() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return path.join(LOG_DIR, `bots-${year}-${month}-${day}.log`);
}

// Usuwanie logów starszych niż LOG_MAX_AGE_DAYS
function cleanupOldLogs() {
    try {
        if (!fs.existsSync(LOG_DIR)) return;

        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const maxAge = LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

        for (const file of files) {
            // Obsługuj zarówno nowy format (bots-YYYY-MM-DD.log) jak i stary (bots.log)
            if (!file.startsWith('bots') || !file.endsWith('.log')) continue;

            const filePath = path.join(LOG_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                // Ignoruj błędy pojedynczych plików
            }
        }
    } catch (error) {
        // Nie przerywaj aplikacji przy błędach czyszczenia
    }
}

// Wyczyść stare logi przy starcie
cleanupOldLogs();

// Planuj czyszczenie co 24h
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// Ładowanie .env na początku
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Konfiguracja Discord webhook
const WEBHOOK_URL = process.env.DISCORD_LOG_WEBHOOK_URL;
const WEBHOOK_URL_BACKUP = process.env.DISCORD_LOG_WEBHOOK_URL_BACKUP || WEBHOOK_URL; // Fallback do głównego jeśli nie ustawiony
const WEBHOOK_ENABLED = !!WEBHOOK_URL;
// Boty które mają własny webhook — pomijamy je w głównym kanale logów
const BOTS_WITH_OWN_WEBHOOK = new Set(
    process.env.ENDERSECHO_LOG_WEBHOOK_URL ? ['EndersEcho'] : []
);

// Kolejka webhook'ów i rate limiting
const webhookQueue = [];
let isProcessingQueue = false;
const WEBHOOK_DELAY = 1000; // 1 sekunda między żądaniami (rate limit Discorda)
const WEBHOOK_MAX_CHARS = 1900;  // limit treści wiadomości Discorda to 2000 — zostawiamy zapas
const WEBHOOK_MAX_QUEUE = 500;   // powyżej tego porzucamy najstarsze wpisy zamiast rosnąć bez końca

let pominieteLogi = 0;
let ostatnieOstrzezenie = 0;

// Upewnij się, że katalog logs istnieje.
// Sprawdzenie robimy RAZ — dawniej `existsSync` leciało przy każdej linii logu,
// czyli setki razy na minutę, mimo że katalog nie znika w trakcie pracy bota.
let katalogGotowy = false;
function ensureLogDirectory() {
    if (katalogGotowy) return;
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    katalogGotowy = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strumień pliku logu (zamiast appendFileSync przy każdej linii)
//
// `appendFileSync` jest SYNCHRONICZNY — blokował cały proces, czyli wszystkie 9 botów,
// na każdy pojedynczy wpis. Strumień otwierany jest raz i buforuje zapisy w tle.
// Trzymamy referencję do dnia, bo plik ma dzienną rotację (bots-YYYY-MM-DD.log).
// ─────────────────────────────────────────────────────────────────────────────
let logStream = null;
let logStreamPath = null;

function getLogStream() {
    const sciezka = getLogFilePath();

    if (logStream && logStreamPath === sciezka) return logStream;

    // Zmienił się dzień (albo pierwszy zapis) — zamknij poprzedni plik i otwórz nowy
    if (logStream) {
        try { logStream.end(); } catch { /* nieistotne przy rotacji */ }
    }

    ensureLogDirectory();
    logStream = fs.createWriteStream(sciezka, { flags: 'a' });
    logStream.on('error', (err) => {
        console.error('Błąd strumienia pliku log:', err.message);
        logStream = null;
        logStreamPath = null;
    });
    logStreamPath = sciezka;
    return logStream;
}

/**
 * Domyka plik logu przy zamykaniu procesu, żeby nie zgubić ostatnich linii.
 */
function closeLogStream() {
    if (!logStream) return;
    try { logStream.end(); } catch { /* zamykamy proces, błąd nieistotny */ }
    logStream = null;
    logStreamPath = null;
}

process.once('exit', closeLogStream);

// Funkcja do zapisywania do pliku (bez kolorów)
function writeToLogFile(botName, message, level = 'info') {
    try {
        const timestamp = getTimestamp();
        const emoji = botEmojis[botName] || '🤖';
        
        let levelEmoji = '•';
        switch (level.toLowerCase()) {
            case 'error':
                levelEmoji = '❌';
                break;
            case 'warn':
                levelEmoji = '⚠️';
                break;
            case 'success':
                levelEmoji = '✅';
                break;
            case 'info':
            default:
                levelEmoji = '•';
                break;
        }
        
        const logEntry = `[${timestamp}] ${emoji} ${botName.toUpperCase()} ${levelEmoji} ${message}\n`;
        getLogStream().write(logEntry);
    } catch (error) {
        // Jeśli nie można zapisać do pliku, nie przerywamy aplikacji
        console.error('Błąd zapisu do pliku log:', error.message);
    }
}

/**
 * Przetwarza kolejkę webhooków, ŁĄCZĄC wpisy w paczki.
 *
 * ⚠️ Wcześniej każdy log szedł osobnym żądaniem z sekundową przerwą, czyli sztywne
 * 60 wpisów/minutę. Dziewięć botów potrafi generować więcej — a kolejka nie miała
 * limitu, więc zaległość rosła bez końca i zjadała pamięć aż do crashu.
 *
 * Teraz jedno żądanie zabiera tyle linii, ile zmieści się w limicie 2000 znaków
 * Discorda, co podnosi realną przepustowość kilkunastokrotnie przy tej samej
 * liczbie żądań (rate limit Discorda dotyczy żądań, nie treści).
 */
async function processWebhookQueue() {
    if (isProcessingQueue || webhookQueue.length === 0) return;

    isProcessingQueue = true;

    while (webhookQueue.length > 0) {
        // Zbierz kolejne wpisy tego samego webhooka, aż do limitu znaków
        const { webhookUrl } = webhookQueue[0];
        const linie = [];
        let dlugosc = 0;

        while (webhookQueue.length > 0 && webhookQueue[0].webhookUrl === webhookUrl) {
            const tresc = webhookQueue[0].data.content;
            // +1 na znak nowej linii; pojedynczy wpis dłuższy niż limit i tak musi przejść sam
            if (linie.length > 0 && dlugosc + tresc.length + 1 > WEBHOOK_MAX_CHARS) break;
            webhookQueue.shift();
            linie.push(tresc);
            dlugosc += tresc.length + 1;
        }

        // Dołóż informację o porzuconych wpisach — trafia do najbliższej paczki,
        // więc dociera nawet gdy kolejka jest wciąż przepełniona
        const teraz = Date.now();
        if (pominieteLogi > 0 && teraz - ostatnieOstrzezenie > 60000) {
            ostatnieOstrzezenie = teraz;
            // Na POCZĄTEK paczki — treść jest przycinana do WEBHOOK_MAX_CHARS,
            // więc linia dołożona na końcu zostałaby obcięta razem z nadmiarem
            linie.unshift(`⚠️ Kolejka webhooka przepełniona — pominięto ${pominieteLogi} wpisów (plik logu jest kompletny)`);
            pominieteLogi = 0;
        }

        try {
            await sendWebhookRequest({ content: linie.join(String.fromCharCode(10)).slice(0, WEBHOOK_MAX_CHARS) }, webhookUrl);
            // Odstęp między żądaniami — chroni przed rate limitem Discorda
            await new Promise(resolve => setTimeout(resolve, WEBHOOK_DELAY));
        } catch (error) {
            // Kontynuuj mimo błędów
        }
    }

    isProcessingQueue = false;
}

// Funkcja do wysyłania pojedynczego webhook'a
const WEBHOOK_MAX_RETRIES = 3; // po tylu próbach 429 odpuszczamy — plik logu i tak ma komplet

function sendWebhookRequest(webhookData, webhookUrl, proba = 0) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ content: webhookData.content, flags: 4 });
        const url = new URL(webhookUrl);

        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            // ⚠️ Treść odpowiedzi MUSI zostać skonsumowana. Bez tego Node nie zwalnia
            // gniazda do puli agenta, a bufor odpowiedzi zostaje w pamięci — przy jednym
            // żądaniu na sekundę przez całą dobę to dziesiątki tysięcy wiszyących gniazd.
            res.resume();

            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else if (res.statusCode === 429) {
                if (proba >= WEBHOOK_MAX_RETRIES) {
                    reject(new Error('Webhook rate limit — wyczerpano próby'));
                    return;
                }
                // Rate limit — czekamy tyle, ile każe Discord (albo 5 s, gdy nie podał)
                const retryAfter = Number(res.headers['retry-after']);
                const czekaj = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 30000)
                    : 5000;
                setTimeout(() => {
                    sendWebhookRequest(webhookData, webhookUrl, proba + 1).then(resolve).catch(reject);
                }, czekaj);
            } else {
                reject(new Error(`Webhook error status: ${res.statusCode}`));
            }
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

// Funkcja do wysyłania logów przez Discord webhook (dodaje do kolejki)
function sendToDiscordWebhook(botName, message, level = 'info') {
    if (!WEBHOOK_ENABLED) return;
    // Bot ma własny dedykowany webhook — nie logujemy do głównego kanału
    if (BOTS_WITH_OWN_WEBHOOK.has(botName)) return;

    try {
        const timestamp = getTimestamp();
        const emoji = botEmojis[botName] || '🤖';

        let levelEmoji = '•';
        switch (level.toLowerCase()) {
            case 'error':
                levelEmoji = '❌';
                break;
            case 'warn':
                levelEmoji = '⚠️';
                break;
            case 'success':
                levelEmoji = '✅';
                break;
            case 'info':
            default:
                levelEmoji = '•';
                break;
        }

        // Wybierz odpowiedni webhook URL
        const isBackupBot = botName === 'BackupManager' || botName === 'BackupScheduler' || botName === 'ManualBackup';

        // Słowa kluczowe dla szczegółów operacji backupu (pomijane na webhook)
        const backupDetailKeywords = [
            'Rozpoczynam backup',
            'backup wszystkich botów',
            'Backup bota:',
            'Utworzono archiwum',
            'Przesłano',
            'Usunięto stary backup',
            'Usunięto lokalny plik',
            'Backup zakończony',
            'manualny backup',
            'wywołany przez',
            'Manualny backup zakończony',
            'Sukces:',
            'Błędy:'
        ];

        // Sprawdź czy to szczegół operacji backupu (do pominięcia)
        const isBackupDetail = isBackupBot && backupDetailKeywords.some(keyword =>
            message.toLowerCase().includes(keyword.toLowerCase())
        );

        // Nie wysyłaj szczegółów backupów na webhook - tylko startupowe logi i błędy
        // Podsumowanie jest wysyłane bezpośrednio z backupManager.js
        if (isBackupDetail) {
            return; // Pomiń wysyłanie na webhook
        }

        // Użyj zawsze głównego webhooka dla logów startupowych i błędów
        const webhookUrl = WEBHOOK_URL;

        // Sprawdź czy to nowy bot (inny niż poprzedni w webhook)
        const isNewWebhookBot = lastWebhookBotName !== botName;

        // Zaktualizuj ostatni bot dla webhook
        lastWebhookBotName = botName;

        let webhookMessage;
        if (isNewWebhookBot) {
            // Nowy bot - dodaj separator
            const separator = '────────────────────────────────────────';
            webhookMessage = `${separator}\n[${timestamp}] ${emoji} **${botName.toUpperCase()}** ${levelEmoji} ${message}`;
        } else {
            // Ten sam bot - tylko wiadomość
            webhookMessage = `[${timestamp}] ${emoji} **${botName.toUpperCase()}** ${levelEmoji} ${message}`;
        }

        const webhookData = {
            content: webhookMessage
        };

        // Dodaj do kolejki zamiast wysyłać od razu (razem z webhookUrl)
        webhookQueue.push({ data: webhookData, webhookUrl });

        // Twardy limit kolejki — gdy logi napływają szybciej, niż webhook je wysyła,
        // porzucamy NAJSTARSZE wpisy zamiast puchnąć w nieskończoność. Bez tego
        // zaległość rosła trwale i kończyła się wyczerpaniem pamięci.
        if (webhookQueue.length > WEBHOOK_MAX_QUEUE) {
            const porzucone = webhookQueue.length - WEBHOOK_MAX_QUEUE;
            webhookQueue.splice(0, porzucone);
            pominieteLogi += porzucone;

            // Samego ostrzeżenia NIE wkładamy do kolejki — kolejne przepełnienie
            // usuwa wpisy z jej początku, więc zostałoby porzucone razem z resztą.
            // Zamiast tego licznik `pominieteLogi` jest doklejany do najbliższej
            // wysyłanej paczki (patrz processWebhookQueue).
        }

        // Uruchom przetwarzanie kolejki
        setImmediate(processWebhookQueue);

    } catch (error) {
        // Jeśli nie można dodać do kolejki, nie przerywamy aplikacji
    }
}

function formatMessage(botName, message, level = 'info') {
    const timestamp = getTimestamp();
    const emoji = botEmojis[botName] || '🤖';
    const color = botColors[botName] || colors.white;
    
    let levelColor = colors.white;
    let levelEmoji = '•';
    
    switch (level.toLowerCase()) {
        case 'error':
            levelColor = colors.red;
            levelEmoji = '❌';
            break;
        case 'warn':
            levelColor = colors.yellow;
            levelEmoji = '⚠️';
            break;
        case 'success':
            levelColor = colors.green;
            levelEmoji = '✅';
            break;
        case 'info':
        default:
            levelColor = colors.cyan;
            levelEmoji = '•';
            break;
    }
    
    const separator = colors.gray + '─'.repeat(40) + colors.reset;
    const header = `${color}${colors.bright}${emoji} ${botName.toUpperCase()}${colors.reset}`;
    const timeStamp = `${colors.gray}[${timestamp}]${colors.reset}`;
    const levelIndicator = `${levelColor}${levelEmoji}${colors.reset}`;
    
    // Sprawdź czy to nowy bot (inny niż poprzedni)
    const isNewBot = lastBotName !== botName;
    
    // Zaktualizuj ostatni bot
    lastBotName = botName;
    
    if (isNewBot) {
        // Nowy bot - dodaj separator tylko na górze
        return `${separator}\n${header} ${timeStamp} ${levelIndicator} ${message}`;
    } else {
        // Ten sam bot - tylko wiadomość bez separatorów
        return `${header} ${timeStamp} ${levelIndicator} ${message}`;
    }
}

class ConsoleLogger {
    constructor(botName) {
        this.botName = botName;
    }
    
    log(...args) {
        const message = this._formatArgs(args);
        console.log(formatMessage(this.botName, message, 'info'));
        writeToLogFile(this.botName, message, 'info');
        sendToDiscordWebhook(this.botName, message, 'info');
    }

    error(...args) {
        const message = this._formatArgs(args);
        console.error(formatMessage(this.botName, message, 'error'));
        writeToLogFile(this.botName, message, 'error');
        sendToDiscordWebhook(this.botName, message, 'error');
    }

    warn(...args) {
        const message = this._formatArgs(args);
        console.warn(formatMessage(this.botName, message, 'warn'));
        writeToLogFile(this.botName, message, 'warn');
        sendToDiscordWebhook(this.botName, message, 'warn');
    }

    success(...args) {
        const message = this._formatArgs(args);
        console.log(formatMessage(this.botName, message, 'success'));
        writeToLogFile(this.botName, message, 'success');
        sendToDiscordWebhook(this.botName, message, 'success');
    }

    info(...args) {
        const message = this._formatArgs(args);
        console.info(formatMessage(this.botName, message, 'info'));
        writeToLogFile(this.botName, message, 'info');
        sendToDiscordWebhook(this.botName, message, 'info');
    }

    _formatArgs(args) {
        return args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack}`;
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }
}

// Globalne zastąpienie console.log dla wszystkich botów
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
};

function createBotLogger(botName) {
    return new ConsoleLogger(botName);
}

function setupGlobalLogging() {
    // Reset stanu na początku sesji
    lastBotName = null;
    // Można tutaj dodać globalne interceptory jeśli potrzebne
}

function resetLoggerState() {
    lastBotName = null;
    lastWebhookBotName = null;
}

module.exports = {
    ConsoleLogger,
    createBotLogger,
    setupGlobalLogging,
    resetLoggerState,
    closeLogStream,
    colors,
    formatMessage
};