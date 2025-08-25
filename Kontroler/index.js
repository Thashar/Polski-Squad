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
        messageService,
        lotteryService
    );

    logger.success('Wszystkie serwisy zostały zainicjalizowane');
}

/**
 * Handler dla zdarzenia ready
 */
function onReady() {
    const channelCount = Object.keys(config.channels).length;
    const clanCount = Object.keys(config.lottery.clans).length;
    logger.success(`✅ Kontroler gotowy - OCR (${channelCount} kanały), Loterie (${clanCount} klany)`);
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