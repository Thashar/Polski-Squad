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
    console.log('\n' + '🤖'.repeat(20));
    console.log('🤖 BOT KONTROLER JEST GOTOWY! 🤖');
    console.log('🤖'.repeat(20));
    console.log(`📋 Zalogowany jako: ${client.user.tag}`);
    console.log(`🌐 Serwery: ${client.guilds.cache.size}`);
    console.log(`👥 Użytkownicy: ${client.users.cache.size}`);
    console.log('─'.repeat(50));
    console.log('📡 MONITOROWANE KANAŁY:');

    Object.entries(config.channels).forEach(([key, channelConfig], index) => {
        console.log(`${index + 1}. Kanał ${channelConfig.name}: ${channelConfig.targetChannelId}`);
        console.log(`   🏆 Rola: ${channelConfig.requiredRoleId}`);
        console.log(`   📊 Min wynik: ${channelConfig.minimumScore}`);
        console.log(`   📈 Zakres: ${channelConfig.scoreRange[0]}-${channelConfig.scoreRange[1]} (krok: ${channelConfig.scoreStep})`);
        console.log(`   🔍 Drugie wystąpienie: ${channelConfig.requireSecondOccurrence ? 'TAK' : 'NIE'}`);
        console.log(`   🖼️ Preprocessing: ${channelConfig.name === 'Daily' ? 'BIAŁY TEKST NA SZARYM TLE' : 'BIAŁO-CZARNY'}`);
        console.log(`   ⚠️ Pomija pierwsze ${channelConfig.skipLines} linii`);
        if (channelConfig.name === 'Daily') {
            console.log(`   🎯 DAILY: Wyjątek "sg" -> "9"`);
        }
    });

    console.log('─'.repeat(50));
    console.log('🚫 BLOKOWANIE UŻYTKOWNIKÓW:');
    console.log(`   ID roli blokującej: ${config.blockedRole}`);
    console.log(`   Blokowane kanały: Daily (${config.channels.daily.targetChannelId}) i CX (${config.channels.cx.targetChannelId})`);
    console.log('─'.repeat(50));
    console.log('✅ Bot jest gotowy do analizy obrazów!');
    console.log('📷 Wrzuć obraz na monitorowany kanał aby rozpocząć analizę');
    console.log('🔄 Różne metody preprocessingu dla różnych kanałów');
    console.log('🎯 Optymalizacja: podobieństwo nicku z wielopoziomowym progiem');
    console.log('🔤 Normalizacja s/S: testowane warianty 5 i 8');
    console.log('🎯 NOWY: Wyjątek "sg" -> "9" dla kanału Daily');
    console.log('⚠️ INTELIGENTNE WYKLUCZENIE: CX pomija 1 linię, Daily pomija 3 linie');
    console.log('🔢 POPRAWKA: Wyciąganie tylko cyfr z rozpoznanego tekstu');
    console.log('🚫 NOWA FUNKCJA: Blokowanie użytkowników z rolą karną');
    console.log('─'.repeat(50) + '\n');
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