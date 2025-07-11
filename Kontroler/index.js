const { Client, GatewayIntentBits } = require('discord.js');
const { logWithTimestamp } = require('./utils/helpers');

// Import konfiguracji
const config = require('./config/config');

// Import serwisów
const OCRService = require('./services/ocrService');
const AnalysisService = require('./services/analysisService');
const RoleService = require('./services/roleService');
const MessageService = require('./services/messageService');

// Import handlerów
const MessageHandler = require('./handlers/messageHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

// Klient Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Inicjalizacja serwisów
let ocrService, analysisService, roleService, messageService, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
function initializeServices() {
    ocrService = new OCRService(config);
    analysisService = new AnalysisService(config, ocrService);
    roleService = new RoleService(config);
    messageService = new MessageService(config);
    messageHandler = new MessageHandler(
        config,
        ocrService,
        analysisService,
        roleService,
        messageService
    );

    logWithTimestamp('Wszystkie serwisy zostały zainicjalizowane', 'success');
}

/**
 * Handler dla zdarzenia ready
 */
function onReady() {
    logger.info('\n' + '🤖'.repeat(20));
    logger.info('🤖 BOT KONTROLER JEST GOTOWY! 🤖');
    logger.info('🤖'.repeat(20));
    logger.info(`📋 Zalogowany jako: ${client.user.tag}`);
    logger.info(`🌐 Serwery: ${client.guilds.cache.size}`);
    logger.info(`👥 Użytkownicy: ${client.users.cache.size}`);
    logger.info('─'.repeat(50));
    logger.info('📡 MONITOROWANE KANAŁY:');

    Object.entries(config.channels).forEach(([key, channelConfig], index) => {
        logger.info(`${index + 1}. Kanał ${channelConfig.name}: ${channelConfig.targetChannelId}`);
        logger.info(`   🏆 Rola: ${channelConfig.requiredRoleId}`);
        logger.info(`   📊 Min wynik: ${channelConfig.minimumScore}`);
        logger.info(`   📈 Zakres: ${channelConfig.scoreRange[0]}-${channelConfig.scoreRange[1]} (krok: ${channelConfig.scoreStep})`);
        logger.info(`   🔍 Drugie wystąpienie: ${channelConfig.requireSecondOccurrence ? 'TAK' : 'NIE'}`);
        logger.info(`   🖼️ Preprocessing: ${channelConfig.name === 'Daily' ? 'BIAŁY TEKST NA SZARYM TLE' : 'BIAŁO-CZARNY'}`);
        logger.info(`   ⚠️ Pomija pierwsze ${channelConfig.skipLines} linii`);
        if (channelConfig.name === 'Daily') {
            logger.info(`   🎯 DAILY: Wyjątek "sg" -> "9"`);
        }
    });

    logger.info('─'.repeat(50));
    logger.info('🚫 BLOKOWANIE UŻYTKOWNIKÓW:');
    logger.info(`   ID roli blokującej: ${config.blockedRole}`);
    logger.info(`   Blokowane kanały: Daily (${config.channels.daily.targetChannelId}) i CX (${config.channels.cx.targetChannelId})`);
    logger.info('─'.repeat(50));
    logger.info('✅ Bot jest gotowy do analizy obrazów!');
    logger.info('📷 Wrzuć obraz na monitorowany kanał aby rozpocząć analizę');
    logger.info('🔄 Różne metody preprocessingu dla różnych kanałów');
    logger.info('🎯 Optymalizacja: podobieństwo nicku z wielopoziomowym progiem');
    logger.info('🔤 Normalizacja s/S: testowane warianty 5 i 8');
    logger.info('🎯 NOWY: Wyjątek "sg" -> "9" dla kanału Daily');
    logger.info('⚠️ INTELIGENTNE WYKLUCZENIE: CX pomija 1 linię, Daily pomija 3 linie');
    logger.info('🔢 POPRAWKA: Wyciąganie tylko cyfr z rozpoznanego tekstu');
    logger.info('🚫 NOWA FUNKCJA: Blokowanie użytkowników z rolą karną');
    logger.info('─'.repeat(50) + '\n');
}

/**
 * Handler dla błędów klienta
 * @param {Error} error - Błąd
 */
function onError(error) {
    logWithTimestamp(`Błąd klienta Discord: ${error.message}`, 'error');
}

/**
 * Handler dla nieobsłużonych Promise rejections
 * @param {Error} error - Błąd
 */
function onUnhandledRejection(error) {
    logWithTimestamp(`Nieobsłużone odrzucenie Promise: ${error.message}`, 'error');
}

/**
 * Handler dla nieobsłużonych wyjątków
 * @param {Error} error - Błąd
 */
function onUncaughtException(error) {
    logWithTimestamp(`Nieobsłużony wyjątek: ${error.message}`, 'error');
    process.exit(1);
}

/**
 * Handler dla sygnałów zamykania
 * @param {string} signal - Sygnał
 */
function onShutdown(signal) {
    logWithTimestamp(`Otrzymano sygnał ${signal}. Zamykanie bota...`, 'warn');
    client.destroy();
    process.exit(0);
}

/**
 * Konfiguruje event handlery
 */
function setupEventHandlers() {
    client.once('ready', onReady);
    client.on('messageCreate', (message) => messageHandler.handleMessage(message));
    client.on('error', onError);

    // Obsługa zamykania
    process.on('unhandledRejection', onUnhandledRejection);
    process.on('uncaughtException', onUncaughtException);
    process.on('SIGINT', () => onShutdown('SIGINT'));
    process.on('SIGTERM', () => onShutdown('SIGTERM'));
}

/**
 * Uruchamia bota
 */
async function start() {
    try {
        logWithTimestamp('Uruchamianie bota Kontroler...', 'info');
        initializeServices();
        setupEventHandlers();
        await client.login(config.token);
    } catch (error) {
        logWithTimestamp(`Błąd podczas logowania: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Eksport dla użycia w main index.js
module.exports = {
    start
};

// Uruchomienie jeśli plik jest wywoływany bezpośrednio
if (require.main === module) {
    start();
}