const path = require('path');
const messages = require('./messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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
    channels: {
        recruitment: process.env.RECRUITMENT_CHANNEL,
        clan0: process.env.CLAN0_CHANNEL,
        clan1: process.env.CLAN1_CHANNEL,
        clan2: process.env.CLAN2_CHANNEL,
        mainClan: process.env.MAIN_CLAN_CHANNEL,
        welcome: process.env.WELCOME_CHANNEL
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
        channelId: '1170323972173340744',
        emojis: {
            join: '<:PepeBizensik:1278014731113857037>',
            leave: '<:PepeRIP:1267576534252916849>'
        }
    },
    
    // Konfiguracja OCR
    ocr: {
        tempDir: path.join(__dirname, '../temp'),
        
        // Zapisywanie przetworzonych obrazów
        saveProcessedImages: true,
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
