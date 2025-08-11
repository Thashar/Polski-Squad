const { Client, GatewayIntentBits } = require('discord.js');
// const { logWithTimestamp } = require('./utils/helpers'); // Usunięto, używaj createBotLogger

// Import konfiguracji
const config = require('./config/config');

// Import serwisów
const OCRService = require('./services/ocrService');
const AnalysisService = require('./services/analysisService');
const RoleService = require('./services/roleService');
const MessageService = require('./services/messageService');
const LotteryService = require('./services/lotteryService');

// Import handlerów
const MessageHandler = require('./handlers/messageHandlers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

// Klient Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Inicjalizacja serwisów
let ocrService, analysisService, roleService, messageService, messageHandler, lotteryService;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    ocrService = new OCRService(config);
    await ocrService.ensureDirectories();
    analysisService = new AnalysisService(config, ocrService);
    roleService = new RoleService(config);
    messageService = new MessageService(config);
    lotteryService = new LotteryService(config);
    messageHandler = new MessageHandler(
        config,
        ocrService,
        analysisService,
        roleService,
        messageService
    );

    logger.success('Wszystkie serwisy zostały zainicjalizowane');
}

/**
 * Handler dla zdarzenia ready
 */
function onReady() {
    logger.info('BOT KONTROLER JEST GOTOWY!');
    logger.info(`📋 Zalogowany jako: ${client.user.tag}`);
    logger.info(`🌐 Serwery: ${client.guilds.cache.size}`);
    logger.info(`👥 Użytkownicy: ${client.users.cache.size}`);
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
    logger.info('─'.repeat(50));
    logger.info('🎰 SYSTEM LOTERII:');
    logger.info(`   Dostępne klany: ${Object.keys(config.lottery.clans).length}`);
    Object.entries(config.lottery.clans).forEach(([key, clan]) => {
        logger.info(`   ${key}: ${clan.displayName} (${clan.roleId})`);
    });
    logger.info('   Komendy: /lottery, /lottery-remove, /lottery-list, /reroll');
    logger.info('   Automatyczne losowania z harmonogramem cron');
    logger.info('─'.repeat(50) + '\n');
}

/**
 * Handler dla błędów klienta
 * @param {Error} error - Błąd
 */
function onError(error) {
    logger.error(`Błąd klienta Discord: ${error.message}`);
}

/**
 * Handler dla nieobsłużonych Promise rejections
 * @param {Error} error - Błąd
 */
function onUnhandledRejection(error) {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
}

/**
 * Handler dla nieobsłużonych wyjątków
 * @param {Error} error - Błąd
 */
function onUncaughtException(error) {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
}

/**
 * Handler dla sygnałów zamykania
 * @param {string} signal - Sygnał
 */
function onShutdown(signal) {
    logger.warn(`Otrzymano sygnał ${signal}. Zamykanie bota...`);
    
    // Zatrzymaj serwis loterii
    if (lotteryService) {
        lotteryService.stop();
    }
    
    client.destroy();
    process.exit(0);
}

/**
 * Konfiguruje event handlery
 */
function setupEventHandlers() {
    client.once('ready', async () => {
        await onReady();
        // Inicjalizuj serwis loterii z klientem Discord
        await lotteryService.initialize(client);
        await registerSlashCommands(client, config);
    });
    client.on('messageCreate', (message) => messageHandler.handleMessage(message));
    client.on('interactionCreate', (interaction) => handleInteraction(interaction, config, lotteryService));
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
        await initializeServices();
        setupEventHandlers();
        await client.login(config.token);
    } catch (error) {
        logger.error(`Błąd podczas logowania: ${error.message}`);
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