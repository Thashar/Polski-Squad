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
    }
    
    error(message) {
        console.error(formatMessage(this.botName, message, 'error'));
    }
    
    warn(message) {
        console.warn(formatMessage(this.botName, message, 'warn'));
    }
    
    success(message) {
        console.log(formatMessage(this.botName, message, 'success'));
    }
    
    info(message) {
        console.info(formatMessage(this.botName, message, 'info'));
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