const path = require('path');
const fs = require('fs');
const messages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Odczyt lokalnego .env bezpośrednio - process.env.ROBOT jest współdzielony między botami
const localEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));

const requiredEnvVars = [
    'DISCORD_TOKEN',
    'RECRUITMENT_CHANNEL',
    'CLAN0_CHANNEL',
    'CLAN1_CHANNEL',
    'CLAN2_CHANNEL',
    'MAIN_CLAN_CHANNEL',
    'WELCOME_CHANNEL',
    'NOT_POLISH_ROLE',
    'VERIFIED_ROLE',
    'CLAN0_ROLE',
    'CLAN1_ROLE',
    'CLAN2_ROLE',
    'MAIN_CLAN_ROLE',
    'RECRUIT_0_ROLE',
    'RECRUIT_1_ROLE',
    'RECRUIT_2_ROLE',
    'RECRUIT_MAIN_ROLE',
    'LEADER_ROLE',
    'VICE_LEADER_ROLE',
    'VICE_LEADER_MAIN_ROLE'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik .env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    token: process.env.DISCORD_TOKEN,

    // Przekazywanie wiadomości z priv na kanał (robot2)
    robot2Users: localEnv.ROBOT ? localEnv.ROBOT.split(',').map(id => id.trim()) : [],
    notificationForwardChannel: process.env.ROBOT2_FORWARD_CHANNEL || '1486848827997818900',
    mentionRoleId: process.env.ROBOT2_MENTION_ROLE || '1486506395057524887',
    robot2ActivationChannel: process.env.ROBOT2_ACTIVATION_CHANNEL || '1486510519119773818',

    channels: {
        recruitment: process.env.RECRUITMENT_CHANNEL,
        clan0: process.env.CLAN0_CHANNEL,
        clan1: process.env.CLAN1_CHANNEL,
        clan2: process.env.CLAN2_CHANNEL,
        mainClan: process.env.MAIN_CLAN_CHANNEL,
        welcome: process.env.WELCOME_CHANNEL,
        // Kanał z przyciskiem „Chcę dołączyć do klanu" dla osób już obecnych na serwerze
        joinClan: process.env.REKRUTER_JOIN_CLAN_CHANNEL || '1209283124765265970',
        main: process.env.REKRUTER_MAIN_CHANNEL || '1170323972173340744',
        boost: process.env.REKRUTER_BOOST_BONUS_CHANNEL || '1384597663378440363',
        // Archiwum rozmów rekrutacyjnych AI - pełny zapis wraz ze zdjęciami.
        // Bez tej zmiennej archiwum jest wyłączone. Kanał widzi komplet danych
        // kandydata, więc trzymaj go poza zasięgiem zwykłych użytkowników.
        interviewLog: process.env.REKRUTER_INTERVIEW_LOG_CHANNEL || null
    },
    roles: {
        notPolish: process.env.NOT_POLISH_ROLE,
        verified: process.env.VERIFIED_ROLE,
        clan0: process.env.CLAN0_ROLE,
        clan1: process.env.CLAN1_ROLE,
        clan2: process.env.CLAN2_ROLE,
        mainClan: process.env.MAIN_CLAN_ROLE,
        leader: process.env.LEADER_ROLE,
        viceLeader: process.env.VICE_LEADER_ROLE,
        viceLeaderMain: process.env.VICE_LEADER_MAIN_ROLE
    },
    // Role rekrutacyjne - nadawane podczas rekrutacji
    recruitRoles: {
        recruit0: process.env.RECRUIT_0_ROLE,
        recruit1: process.env.RECRUIT_1_ROLE,
        recruit2: process.env.RECRUIT_2_ROLE,
        recruitMain: process.env.RECRUIT_MAIN_ROLE
    },

    // Konfiguracja monitorowania użytkowników bez ról
    roleMonitoring: {
        enabled: true,
        checkInterval: '0 */6 * * *', // Co 6 godzin
        warning24Hours: 24 * 60 * 60 * 1000, // 24 godziny w ms
        dataFile: './Rekruter/data/user_monitoring.json',
        waitingRoomChannel: process.env.WAITING_ROOM_CHANNEL || 'poczekalnia'
    },

    // Konfiguracja powiadomień o wejściach/wyjściach
    memberNotifications: {
        enabled: true,
        channelId: process.env.REKRUTER_MAIN_CHANNEL || '1170323972173340744',
        emojis: {
            join: '<:PepeBizensik:1278014731113857037>',
            leave: '<:PepeRIP:1267576534252916849>'
        }
    },

    // Rozmowa rekrutacyjna prowadzona przez AI zamiast ankiety z przyciskami.
    // Wyłączona domyślnie - bez tej zmiennej bot działa dokładnie jak dotąd.
    aiInterview: {
        enabled: process.env.REKRUTER_AI_INTERVIEW === 'true',
        // Google Gemini - ten sam provider co OCR; osobna zmienna, bo rozmowa może
        // potrzebować mocniejszego modelu niż odczyt zrzutów ekranu
        model: process.env.REKRUTER_GOOGLE_AI_INTERVIEW_MODEL || 'gemini-2.5-flash-lite',
        // Bezpiecznik przed rozmową bez końca (jedna tura = jedna wiadomość kandydata)
        maxTurns: parseInt(process.env.REKRUTER_AI_INTERVIEW_MAX_TURNS || '40', 10),
        // Ile wpisów historii trafia do kontekstu modelu
        historyLimit: parseInt(process.env.REKRUTER_AI_INTERVIEW_HISTORY || '30', 10)
    },

    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),

        // AI OCR - Google Gemini zamiast Tesseract
        useAI: process.env.USE_AI_OCR === 'true',

        // Klucz wspólny dla OCR i rozmowy rekrutacyjnej; `GOOGLE_AI_API_KEY` jako
        // wspólny fallback, tak jak w llmAdapter
        googleAiApiKey: process.env.REKRUTER_GOOGLE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY || null,
        googleAiModel: process.env.REKRUTER_GOOGLE_AI_MODEL || 'gemini-2.5-flash-lite',

        // Zapisywanie przetworzonych obrazów
        saveProcessedImages: false,
        processedDir: path.join(__dirname, '../../processed_ocr'),
        maxProcessedFiles: 400,

        // Szczegółowe logowanie OCR
        detailedLogging: {
            enabled: false,  // Domyślnie wyłączone
            logImageProcessing: true,
            logTextExtraction: true,
            logQualificationAnalysis: true,
            logNicknameExtraction: true,
            logPreprocessing: true
        }
    },

    messages
};
