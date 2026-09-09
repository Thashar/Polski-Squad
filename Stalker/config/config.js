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

    // Dodatkowe role uprawnione do korzystania z kodów Habby (poza rolami klanowymi)
    // Lista ID rozdzielona przecinkami, np. "123,456"
    giftcodeExtraRoles: (process.env.STALKER_LME_GIFTCODE_EXTRA_ROLE || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean),

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

    // ===================================================================
    //  LISTA KLANÓW - automatyczne wiadomości na kanale z przyciskiem
    //  „Chcę dołączyć do klanu"
    // ===================================================================

    clanList: {
        // ⚠️ To ten SAM kanał, na którym Rekruter trzyma przycisk „Chcę dołączyć do klanu"
        // (`REKRUTER_JOIN_CLAN_CHANNEL`). Stalker ma własną zmienną, bo boty nie współdzielą
        // configu. Brak zmiennej = funkcja wyłączona.
        //
        // ⚠️ Rekruter przy starcie szuka WYŁĄCZNIE swojej wiadomości z przyciskiem
        // (`zadbajOPrzyciskDolaczenia` w Rekruter/index.js) i nie kasuje cudzych, więc
        // wiadomości Stalkera są na tym kanale bezpieczne.
        channelId: process.env.STALKER_LME_CLAN_LIST_CHANNEL || null,

        // Emoji wypełniające wcięcie przed „╰┈➤".
        // Discord zjada zwykłe spacje na początku linii, a emoji serwera zostaje.
        indentEmoji: '<:ZZ_Pusto:1209494954762829866>',

        // Ile razy powtórzyć emoji wcięcia. ⚠️ Dwie RÓŻNE głębokości, bo dodatkowe wymagania
        // i blok Lider/Vice stoją na innych poziomach zagnieżdżenia — jedna wspólna wartość
        // wyrównałaby je do siebie i lista przestałaby się czytać jak drzewko.
        indentRequirements: 1,   // dodatkowe wiersze (progi, uwagi o awansie)
        indentMembers: 3,        // Lider / Vice

        // Emoji doklejane ZA wartością punktów 1 Fazy LME. Pusty ciąg = sama liczba
        pointsEmoji: '<:M_Medal:1209754405373747260>',

        // Kreska zamykająca każdą wiadomość.
        //
        // ⚠️ Discord SKLEJA kolejne wiadomości tego samego autora w jeden blok — bez awatara
        // i nagłówka między nimi — więc cztery posty o klanach czytały się jak jedna ściana
        // tekstu. Zwykły markdown nie pomoże: `---` nie renderuje się w wiadomościach jako
        // linia pozioma, więc kreskę rysujemy znakami Unicode.
        //
        // Pusty ciąg wyłącza separator.
        separator: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',

        // Nagłówek wiadomości budujemy jako `${emoji}**${name}**${emoji} 🆔 ${gameId}`.
        //
        // ⚠️ Emoji trzymamy ODDZIELNIE od nazwy, choć `roleDisplayNames` wyżej ma je sklejone
        // („🔥Polski Squad🔥"). Powód: w nagłówku pogrubiona jest sama nazwa, a emoji zostają
        // poza pogrubieniem — z jednego stringa nie da się tego odtworzyć bez zgadywania,
        // gdzie kończy się emoji.
        //
        // `gameId` to ID klanu w grze; te same wartości są w Rekruterze i Garym.
        clans: {
            'main': { emoji: '🔥', name: 'Polski Squad',  gameId: 42578  },
            '2':    { emoji: '💥', name: 'PolskiSquad²',  gameId: 202226 },
            '1':    { emoji: '⚡', name: 'PolskiSquad¹',  gameId: 125634 },
            '0':    { emoji: '🎮', name: 'PolskiSquad⁰',  gameId: 11616  }
        },

        // Kolejność wiadomości na kanale - od najmocniejszego klanu w dół
        order: ['main', '2', '1', '0']
    },

    // Role kierownicze - do automatycznego składu Lider/Vice w liście klanów.
    //
    // ⚠️ Trzy z nich to te SAME zmienne, których używa Rekruter (`LEADER_ROLE`,
    // `VICE_LEADER_ROLE`, `VICE_LEADER_MAIN_ROLE`) - nie dubluj ich pod nową nazwą,
    // bo rozjadą się przy pierwszej zmianie roli na serwerze.
    //
    // Rozpoznawanie: main bierze rolę admina i vice-main WPROST, natomiast w akademiach
    // rola Lidera/Vice jest WSPÓLNA dla wszystkich trzech, więc klan wskazuje dopiero
    // przecięcie z rolą klanową (`targetRoles`).
    leadershipRoles: {
        adminMain:     process.env.STALKER_LME_ADMIN_ROLE || null,
        viceMain:      process.env.VICE_LEADER_MAIN_ROLE  || null,
        leaderAcademy: process.env.LEADER_ROLE            || null,
        viceAcademy:   process.env.VICE_LEADER_ROLE       || null
    }
};

// Wszystkie role uprawnione do kodów Habby: role klanowe + dodatkowe z .env
module.exports.giftcodeRoleIds = [
    ...Object.values(module.exports.targetRoles),
    ...module.exports.giftcodeExtraRoles
].filter(Boolean);
