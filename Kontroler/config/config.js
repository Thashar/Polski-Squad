const path = require('path');
const fs = require('fs');
const messages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Odczyt lokalnego .env bezpośrednio - process.env.ROBOT jest współdzielony między botami
const localEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'KONTROLER_TOKEN',
    'KONTROLER_CLIENT_ID',
    'KONTROLER_GUILD_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik Kontroler/.env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.KONTROLER_TOKEN,
    clientId: process.env.KONTROLER_CLIENT_ID,
    guildId: process.env.KONTROLER_GUILD_ID,

    // Przekazywanie wiadomości z priv na kanał (robot1)
    robot1Users: localEnv.ROBOT ? localEnv.ROBOT.split(',').map(id => id.trim()) : [],
    notificationForwardChannel: process.env.ROBOT1_FORWARD_CHANNEL || '1486848827997818900',
    mentionRoleId: process.env.ROBOT1_MENTION_ROLE || '1486506395057524887',
    robot1ActivationChannel: process.env.ROBOT1_ACTIVATION_CHANNEL || '1486510519119773818',

    // Rola blokująca udział w loteriach
    blockedRole: process.env.KONTROLER_BLOCKED_ROLE || '1392812250263195718',
    
    // Kanały do monitorowania
    channels: {
        cx: {
            targetChannelId: '1305607184037449738',
            requiredRoleId: '1298594615619751966',
            minimumScore: 1500,
            scoreRange: [0, 2800],
            scoreStep: 100,
            requireSecondOccurrence: false,
            name: 'CX',
            skipLines: 1,
            // Nowa konfiguracja dla roli specjalnej
            specialRole: {
                roleId: '1421502672112058589',
                threshold: 2700
            }
        },
        daily: {
            targetChannelId: '1297828299006808124',
            requiredRoleId: '1297834373499977769',
            minimumScore: 910,
            scoreRange: [0, 1050],
            scoreStep: 10,
            requireSecondOccurrence: true,
            name: 'Daily',
            skipLines: 3
        }
    },
    
    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),
        saveProcessedImages: false,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,
        languages: 'pol+eng',
        charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄąĆćĘęŁłŃńÓóŚśŹźŻż .,:-_[](){}',
        pagesegMode: 'AUTO',
        ocrEngineMode: 'LSTM_ONLY',
        whiteThreshold: 200,
        gamma: 2.0,
        luminanceThresholds: {
            white: 200,
            black: 120
        },
        
        // Szczegółowe logowanie OCR
        detailedLogging: {
            enabled: false,  // Domyślnie wyłączone
            logImageProcessing: true,
            logTextExtraction: true,
            logNickDetection: true,
            logScoreValidation: true,
            logCharacterNormalization: true
        }
    },
    
    // Konfiguracja plików
    files: {
        maxSize: 8 * 1024 * 1024, // 8MB
        supportedTypes: ['image/']
    },
    
    // Konfiguracja podobieństwa nicków
    similarity: {
        threshold: 0.4,
        lowThreshold: 0.3
    },
    
    // Zamienniki znaków dla OCR
    charReplacements: {
        'o': '0', 'O': '0',
        'z': '2', 'Z': '2',
        'l': '1', 'I': '1', 'i': '1',
        'B': '8',
        'g': '9', 'G': '6'
    },
    
    // Konfiguracja systemu loterii
    lottery: {
        dataFile: path.join(__dirname, '../data/lottery_history.json'),
        
        // Definicje klanów (na podstawie Stalker bot)
        clans: {
            'server': {
                name: 'Cały Serwer',
                roleId: null, // null oznacza brak ograniczenia do konkretnego klanu
                displayName: '🌍 Cały Serwer 🌍'
            },
            'main': {
                name: 'Polski Squad',
                roleId: process.env.STALKER_LME_TARGET_ROLE_MAIN || '1170351983092383814',
                displayName: '🔥Polski Squad🔥'
            },
            '0': {
                name: 'PolskiSquad⁰',
                roleId: process.env.STALKER_LME_TARGET_ROLE_0 || '1170351932735193179',
                displayName: '🎮PolskiSquad⁰🎮'
            },
            '1': {
                name: 'PolskiSquad¹',
                roleId: process.env.STALKER_LME_TARGET_ROLE_1 || '1170351955560927262',
                displayName: '⚡PolskiSquad¹⚡'
            },
            '2': {
                name: 'PolskiSquad²',
                roleId: process.env.STALKER_LME_TARGET_ROLE_2 || '1170351976075210752',
                displayName: '💥PolskiSquad²💥'
            }
        },
        
        // Dozwolone dni tygodnia
        allowedDays: ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'],
        dayMap: {
            'poniedziałek': 1,
            'wtorek': 2,
            'środa': 3,
            'czwartek': 4,
            'piątek': 5,
            'sobota': 6,
            'niedziela': 0
        }
    },

    // Konfiguracja systemu MVP tygodnia (najlepszy tekst za reakcje KEKW)
    mvp: {
        // Kanał, na którym publikowana jest ankieta i ogłoszenie zwycięzcy
        pollChannelId: '1514700582609358974',
        // Rola przyznawana zwycięzcy na tydzień (do kolejnego rozstrzygnięcia)
        roleId: '1514704005719134389',
        // Emoji reakcji, które jest liczone (KEKW) - dopasowanie po ID
        kekwEmojiId: '1219657372713226382',
        // Reakcje do głosowania w ankiecie (1 na każdego kandydata)
        voteEmojis: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'],
        // Ile dni wstecz skanować wiadomości
        scanDays: 7,
        // Bazowa liczba różnych autorów w zestawieniu (przy remisie na granicy wchodzą wszyscy remisujący)
        targetAuthors: 3,
        // Twardy limit kandydatów (= liczba dostępnych emoji do głosowania)
        maxCandidates: 10,
        // Czas trwania głosowania (24h)
        votingDurationMs: 24 * 60 * 60 * 1000,
        // Harmonogram (czas polski Europe/Warsaw): czwartek (4) o 22:05
        scheduleWeekday: 4,
        scheduleHour: 20,
        scheduleMinute: 20,
        // Kanały WYKLUCZONE ze skanowania (kanał ankiety jest wykluczany automatycznie).
        excludedChannels: [
            '1272432690284462110',
            '1263240344871370804',
            '1173653205557719140',
            '1190323209837498528',
            '1227161073019523072',
            '1261286979824259072',
            '1262791964710146170',
            '1514700582609358974'
        ],

        // Aprobata MVP — aktualny MVP tygodnia (posiadacz roli), stawiając reakcję KEKW
        // pod cudzym postem, odpala LOSOWY efekt "stempla aprobaty".
        // Zasada: jeden post = jeden efekt (dedup po messageId). Pomija kanał ankiety,
        // kanały wykluczone, posty botów oraz własne posty MVP.
        approval: {
            enabled: true,
            // Czas trwania korony 👑 w nicku docenionego autora (1h)
            crownDurationMs: 60 * 60 * 1000,
            crownPrefix: '👑',
            // Szansa na "szczęśliwy traf" (jackpot — wszystkie efekty naraz + embed). Sprawdzany jako pierwszy ⇒ ~1% absolutnie
            jackpotChance: 0.01,
            // Jackpot nadaje wypowiedzi "dziką kartę" — dodatkowy, gwarantowany tekst w najbliższej ankiecie MVP tygodnia
            wildcardOnJackpot: true,
            // Szanse efektów (pojedynczy los, progi skumulowane): jackpot ~1% → textreply ~9% → korona ~60% → pieczęć ~30% (reszta)
            // Szansa na prostą odpowiedź tekstową ze "znakiem jakości" (~9%)
            textReplyChance: 0.09,
            // Szansa na koronę 👑 w nicku na 1h (~60%)
            crownChance: 0.60,
            // Emoji "pieczęci" dodawane pod docenionym postem (pieczęć = reszta puli, ~60%)
            // Customowe emoji serwerowe KEKW — format <a:nazwa:id> (animowane) / <:nazwa:id> (statyczne)
            stampEmojis: [
                '<a:z_Kekw7:1481671554843803648>',
                '<:z_kekw2:1516549160419983440>',
                '<a:z_kekw3:1516549577652834509>',
                '<a:z_kekw4:1516549522682286261>',
                '<:z_kekw5:1516549233623171154>',
                '<a:z_kekw6:1481769242260148366>',
                '<a:z_kekw8:1516550205884076212>'
            ],
            // Limit zapamiętanych docenionych wiadomości (dedup; trim najstarszych)
            maxApprovedMemory: 1000
        }
    },

    messages
};