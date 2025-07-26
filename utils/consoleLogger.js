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
    'StalkerLME': colors.red,
    'Muteusz': colors.magenta,
    'EndersEcho': colors.yellow,
    'Kontroler': colors.blue,
    'Konklawe': colors.white,
    'MAIN': colors.bright + colors.green
};

const botEmojis = {
    'Rekruter': '🎯',
    'Szkolenia': '🎓',
    'StalkerLME': '⚔️',
    'Muteusz': '🤖',
    'EndersEcho': '🏆',
    'Kontroler': '🎯',
    'Konklawe': '⛪',
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

// Konfiguracja logowania do pliku
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'bots.log');

// Ładowanie .env na początku
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Konfiguracja Discord webhook
const WEBHOOK_URL = process.env.DISCORD_LOG_WEBHOOK_URL;
const WEBHOOK_ENABLED = !!WEBHOOK_URL;

// Upewnij się, że katalog logs istnieje
function ensureLogDirectory() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

// Funkcja do zapisywania do pliku (bez kolorów)
function writeToLogFile(botName, message, level = 'info') {
    try {
        ensureLogDirectory();
        
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
        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
    } catch (error) {
        // Jeśli nie można zapisać do pliku, nie przerywamy aplikacji
        console.error('Błąd zapisu do pliku log:', error.message);
    }
}

// Funkcja do wysyłania logów przez Discord webhook
function sendToDiscordWebhook(botName, message, level = 'info') {
    if (!WEBHOOK_ENABLED) return;
    
    try {
        const timestamp = getTimestamp();
        const emoji = botEmojis[botName] || '🤖';
        
        let color = 0x00ff00; // Zielony domyślnie
        switch (level.toLowerCase()) {
            case 'error':
                color = 0xff0000; // Czerwony
                break;
            case 'warn':
                color = 0xffff00; // Żółty
                break;
            case 'success':
                color = 0x00ff00; // Zielony
                break;
            case 'info':
            default:
                color = 0x0099ff; // Niebieski
                break;
        }
        
        const webhookData = {
            embeds: [{
                title: `${emoji} ${botName.toUpperCase()}`,
                description: message,
                color: color,
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Level: ${level.toUpperCase()}`
                }
            }]
        };
        
        const data = JSON.stringify(webhookData);
        const url = new URL(WEBHOOK_URL);
        
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
            // Webhook wysłany pomyślnie (nie logujemy tego aby uniknąć nieskończonej pętli)
        });
        
        req.on('error', (error) => {
            // Nie logujemy błędów webhook aby uniknąć nieskończonej pętli
        });
        
        req.write(data);
        req.end();
        
    } catch (error) {
        // Jeśli nie można wysłać webhook, nie przerywamy aplikacji
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
    
    const separator = colors.gray + '─'.repeat(80) + colors.reset;
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
    
    log(message) {
        console.log(formatMessage(this.botName, message, 'info'));
        writeToLogFile(this.botName, message, 'info');
        sendToDiscordWebhook(this.botName, message, 'info');
    }
    
    error(message) {
        console.error(formatMessage(this.botName, message, 'error'));
        writeToLogFile(this.botName, message, 'error');
        sendToDiscordWebhook(this.botName, message, 'error');
    }
    
    warn(message) {
        console.warn(formatMessage(this.botName, message, 'warn'));
        writeToLogFile(this.botName, message, 'warn');
        sendToDiscordWebhook(this.botName, message, 'warn');
    }
    
    success(message) {
        console.log(formatMessage(this.botName, message, 'success'));
        writeToLogFile(this.botName, message, 'success');
        sendToDiscordWebhook(this.botName, message, 'success');
    }
    
    info(message) {
        console.info(formatMessage(this.botName, message, 'info'));
        writeToLogFile(this.botName, message, 'info');
        sendToDiscordWebhook(this.botName, message, 'info');
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
}

module.exports = {
    ConsoleLogger,
    createBotLogger,
    setupGlobalLogging,
    resetLoggerState,
    colors,
    formatMessage
};