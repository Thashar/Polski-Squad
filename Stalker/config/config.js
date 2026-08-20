const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'STALKER_LME_DISCORD_TOKEN',
    'STALKER_LME_MODERATOR_ROLE_1',
    'STALKER_LME_MODERATOR_ROLE_2',
    'STALKER_LME_MODERATOR_ROLE_3',
    'STALKER_LME_MODERATOR_ROLE_4',
    'STALKER_LME_PUNISHMENT_ROLE_ID',
    'STALKER_LME_LOTTERY_BAN_ROLE_ID',
    'STALKER_LME_TARGET_ROLE_0',
    'STALKER_LME_TARGET_ROLE_1',
    'STALKER_LME_TARGET_ROLE_2',
    'STALKER_LME_TARGET_ROLE_MAIN',
    'STALKER_LME_WARNING_CHANNEL_0',
    'STALKER_LME_WARNING_CHANNEL_1',
    'STALKER_LME_WARNING_CHANNEL_2',
    'STALKER_LME_WARNING_CHANNEL_MAIN',
    'STALKER_LME_CONFIRMATION_CHANNEL_0',
    'STALKER_LME_CONFIRMATION_CHANNEL_1',
    'STALKER_LME_CONFIRMATION_CHANNEL_2',
    'STALKER_LME_CONFIRMATION_CHANNEL_MAIN'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik Stalker/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.STALKER_LME_DISCORD_TOKEN,
    
    // Pliki bazy danych
    database: {
        punishments: './Stalker/data/punishments.json',
        weeklyRemoval: './Stalker/data/weekly_removal.json',
        reminderConfirmations: './Stalker/data/reminder_confirmations.json',
        activeReminderDMs: './Stalker/data/active_reminder_dms.json',
        reminderStatusTracking: './Stalker/data/reminder_status_tracking.json'
    },
    
    // Strefa czasowa i deadline
    timezone: 'Europe/Warsaw',
    bossDeadline: {
        hour: 17,
        minute: 50
    },

    // Boss CX - okno powiadomień RemindCX: od wtorku 18:00 do środy 17:45 (czas polski)
    cxBoss: {
        // true = bez limitów (wyłącza okno czasowe i jednorazowość) - tylko do testów
        unlimited: false,
        windowStartDay: 2,      // wtorek (0=niedziela)
        windowStartHour: 18,
        windowStartMinute: 0,
        deadline: {
            hour: 17,
            minute: 45
        }
    },
    
    // Role uprawnione do karania
    allowedPunishRoles: [
        process.env.STALKER_LME_MODERATOR_ROLE_1,
        process.env.STALKER_LME_MODERATOR_ROLE_2,
        process.env.STALKER_LME_MODERATOR_ROLE_3,
        process.env.STALKER_LME_MODERATOR_ROLE_4
    ],
    
    // Rola dla użytkowników z 2+ punktami
    punishmentRoleId: process.env.STALKER_LME_PUNISHMENT_ROLE_ID,
    
    // Rola dla użytkowników z 3+ punktami (zakaz loterii)
    lotteryBanRoleId: process.env.STALKER_LME_LOTTERY_BAN_ROLE_ID,
    
    // Role docelowe dla różnych squadów
    targetRoles: {
        '0': process.env.STALKER_LME_TARGET_ROLE_0,
        '1': process.env.STALKER_LME_TARGET_ROLE_1,
        '2': process.env.STALKER_LME_TARGET_ROLE_2,
        'main': process.env.STALKER_LME_TARGET_ROLE_MAIN
    },
    
    // Nazwy wyświetlane ról
    roleDisplayNames: {
        '0': '🎮PolskiSquad⁰🎮',
        '1': '⚡PolskiSquad¹⚡',
        '2': '💥PolskiSquad²💥',
        'main': '🔥Polski Squad🔥'
    },

    // Gary guildIds dla mapowania klanów PS → dane ze snapshota Gary (opcjonalne)
    garyGuildIds: {
        '0':    process.env.STALKER_LME_GARY_GUILD_ID_0    ? parseInt(process.env.STALKER_LME_GARY_GUILD_ID_0)    : null,
        '1':    process.env.STALKER_LME_GARY_GUILD_ID_1    ? parseInt(process.env.STALKER_LME_GARY_GUILD_ID_1)    : null,
        '2':    process.env.STALKER_LME_GARY_GUILD_ID_2    ? parseInt(process.env.STALKER_LME_GARY_GUILD_ID_2)    : null,
        'main': process.env.STALKER_LME_GARY_GUILD_ID_MAIN ? parseInt(process.env.STALKER_LME_GARY_GUILD_ID_MAIN) : null,
    },
    
    // Kanały ostrzeżeń dla poszczególnych ról
    warningChannels: {
        [process.env.STALKER_LME_TARGET_ROLE_0]: process.env.STALKER_LME_WARNING_CHANNEL_0,
        [process.env.STALKER_LME_TARGET_ROLE_1]: process.env.STALKER_LME_WARNING_CHANNEL_1,
        [process.env.STALKER_LME_TARGET_ROLE_2]: process.env.STALKER_LME_WARNING_CHANNEL_2,
        [process.env.STALKER_LME_TARGET_ROLE_MAIN]: process.env.STALKER_LME_WARNING_CHANNEL_MAIN
    },

    // Kanały potwierdzenia odbioru przypomnień dla poszczególnych ról
    confirmationChannels: {
        [process.env.STALKER_LME_TARGET_ROLE_0]: process.env.STALKER_LME_CONFIRMATION_CHANNEL_0,
        [process.env.STALKER_LME_TARGET_ROLE_1]: process.env.STALKER_LME_CONFIRMATION_CHANNEL_1,
        [process.env.STALKER_LME_TARGET_ROLE_2]: process.env.STALKER_LME_CONFIRMATION_CHANNEL_2,
        [process.env.STALKER_LME_TARGET_ROLE_MAIN]: process.env.STALKER_LME_CONFIRMATION_CHANNEL_MAIN
    },
    
    // Konfiguracja OCR
    ocr: {
        // AI OCR (opcjonalne) - Google Gemini
        useAI: process.env.USE_STALKER_AI_OCR === 'true',
        googleAiApiKey: process.env.STALKER_GOOGLE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY || null,
        googleAiModel: process.env.STALKER_GOOGLE_AI_MODEL || 'gemini-2.5-flash-lite',
        captchaAiModel: process.env.STALKER_CAPTCHA_AI_MODEL || process.env.STALKER_GOOGLE_AI_MODEL || 'gemini-2.5-flash-lite',

        // Polski alfabet dla OCR whitelist (oryginalny)
        polishAlphabet: 'aąbcćdeęfghijklłmnńoópqrsśtuvwxyzźżAĄBCĆDEĘFGHIJKLŁMNŃOÓPQRSŚTUVWXYZŹŻ0123456789.,;:!?-()[]{}/" ',

        // Ustawienia przetwarzania obrazu (ulepszone)
        imageProcessing: {
            whiteThreshold: 200,
            contrast: 2.0,
            brightness: 20,
            gamma: 3.0,
            median: 2,
            blur: 0.8,
            upscale: 3.0
        },
        
        // Konfiguracja zapisywania przetworzonych obrazów
        // Ochrona pamięci: screeny trzymane są w RAM przez czas trwania sesji
        maxConcurrentSessions: 5,   // ile sesji OCR może trwać naraz (globalnie)
        maxImagesPerSession: 25,    // ile zdjęć przyjmiemy w jednej sesji
        saveProcessedImages: false,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,
        tempDir: './Stalker/temp',
        
        // Szczegółowe logowanie OCR
        detailedLogging: {
            enabled: false,  // Domyślnie wyłączone
            logSimilarityCalculations: true,
            logLineAnalysis: true,
            logNickMatching: true,
            logEndAnalysis: true,
            similarityThreshold: 0.3  // Loguj tylko podobieństwa powyżej tego progu
        }
    },
    
    // Limity punktów
    pointLimits: {
        punishmentRole: 2,
        lotteryBan: 3
    },
    
    // Mapowanie ról do zamiany
    roleSwapping: {
        // Przy 3 punktach: zabierz punishmentRoleId, nadaj lotteryBanRoleId
        removeRoleId: '1230903957241467012',
        addRoleId: '1392812250263195718'
    },
    
    // Konfiguracja systemu urlopów
    vacations: {
        // Kanał gdzie będzie wyświetlana stała wiadomość z przyciskiem
        vacationChannelId: process.env.STALKER_LME_VACATION_CHANNEL_ID || '1269726207633522740',
        // Rola nadawana użytkownikom do składania wniosku
        vacationRequestRoleId: '1397677852966522920',
        // Czas po którym użytkownik może złożyć kolejny wniosek (w godzinach)
        cooldownHours: 6
    },

    // Kanał panelu OCR (aktywne sesje)
    queueChannelId: '1437122516974829679',

    // Kanał skanowania ekwipunku (Core Stock)
    equipmentChannelId: '1491801320602992690',

    // News Relay - monitorowanie kanału z postami z innego serwera (AI streszczenie → kanały WARNING klanów)
    newsRelay: {
        // Kanał, na który przychodzą posty z innego serwera (webhook/follow/bot). Brak = funkcja wyłączona
        sourceChannelId: process.env.STALKER_LME_NEWS_CHANNEL_ID || null
    },

    // Calc Boost - headless Chromium dołączający do puli obliczeniowej kalkulatora sio-tools
    computeBoost: {
        url: process.env.STALKER_LME_CALC_BOOST_URL || 'https://sio-tools.exp0.dev/',
        // Wartość klucza localStorage `computePool` na stronie
        poolId: process.env.STALKER_LME_CALC_BOOST_POOL || 'POLSKA GUROM',
        // Backend puli (socket.io) - używany wyłącznie do testu łączności przed startem przeglądarki
        apiUrl: process.env.STALKER_LME_CALC_BOOST_API || 'https://sio-api.exp0.dev',
        // Domyślny czas trwania boosta (komenda /calc-boost)
        durationMs: (parseInt(process.env.STALKER_LME_CALC_BOOST_SECONDS, 10) || 900) * 1000,
        // Twardy limit - bezpiecznik przed trzymaniem przeglądarki w nieskończoność
        maxDurationMs: 30 * 60 * 1000,
        // Górny limit wątków (klucz `multithread`). null = tyle, ile rdzeni ma serwer (maksimum suwaka)
        maxThreads: parseInt(process.env.STALKER_LME_CALC_BOOST_THREADS, 10) || null,
        // Ścieżka do binarki Chromium/Chrome. Brak = serwis szuka w typowych lokalizacjach
        chromiumPath: process.env.STALKER_LME_CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || null
    },

    // Pula proxy - system przepisany z Garego (ten sam, z którego korzysta /rivals).
    // Używany przez /calc-boost: IP hostingu jest zablokowane przez Cloudflare przed API puli,
    // więc przeglądarka wychodzi przez cudzy adres.
    proxy: {
        // Domyślnie WŁĄCZONE - wyłącz jawnie wpisując "false". Brak listy proxy i tak
        // sprowadza się do połączenia bezpośredniego, więc nic to nie psuje
        enabled: process.env.STALKER_LME_PROXY_ENABLED !== 'false',
        // 'random' (domyślnie) albo 'round-robin' - jak w Garym
        strategy: process.env.STALKER_LME_PROXY_STRATEGY || 'random',
        // Ile proxy spróbować, zanim boost przejdzie na połączenie bezpośrednie
        retryAttempts: parseInt(process.env.STALKER_LME_PROXY_RETRY_ATTEMPTS, 10) || 3,
        // Plik z listą proxy - ten sam co u Garego (katalog główny, poza gitem)
        proxyFilePath: process.env.STALKER_LME_PROXY_FILE || process.env.GARY_PROXY_FILE || path.join(__dirname, '../../proxy.txt'),
        // Webshare API jako zapas, gdy pliku nie ma
        webshareUrl: process.env.STALKER_LME_WEBSHARE_URL || process.env.GARY_WEBSHARE_URL || '',
        // Ręczna lista z .env (zapas ostatniej szansy)
        proxyList: process.env.STALKER_LME_PROXY_LIST
            ? process.env.STALKER_LME_PROXY_LIST.split(',').map(p => p.trim()).filter(Boolean)
            : [],
        refreshOnStartup: true
    }
};