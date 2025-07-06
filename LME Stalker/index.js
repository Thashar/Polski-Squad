const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const { setupWeeklyRemoval } = require('./database/weeklyRemoval');
const { readDatabase, showDatabaseStats } = require('./database/database');

// Inicjalizacja bota
console.log('🤖 Inicjalizacja bota Discord...');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// Ładowanie eventów
const readyEvent = require('./events/ready');
const interactionCreateEvent = require('./events/interactionCreate');

// Rejestracja eventów
client.once('ready', readyEvent);
client.on('interactionCreate', interactionCreateEvent);

// Uruchamianie bota
console.log('\n🚀 Uruchamianie bota...');
client.login(config.DISCORD_TOKEN).then(() => {
    console.log('✅ Token zaakceptowany, łączenie z Discord...');
}).catch(error => {
    console.error('❌ Błąd podczas logowania:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 ==================== ZAMYKANIE BOTA ====================');
    console.log('📅 Czas zamknięcia:', new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));
    
    try {
        await showDatabaseStats();
        console.log('✅ Ostateczne statystyki wyświetlone');
    } catch (error) {
        console.error('❌ Błąd podczas wyświetlania statystyk:', error);
    }
    
    console.log('🤖 Rozłączanie bota...');
    client.destroy();
    
    console.log('👋 Bot wyłączony pomyślnie');
    process.exit(0);
});

// Obsługa błędów
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 ==================== NIEOBSŁUŻONY BŁĄD ====================');
    console.error('🎯 Unhandled Rejection at:', promise);
    console.error('❌ Reason:', reason);
    console.error('📅 Czas:', new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));
});

process.on('uncaughtException', (error) => {
    console.error('\n💥 ==================== NIEOBSŁUŻONY WYJĄTEK ====================');
    console.error('❌ Uncaught Exception:', error);
    console.error('🔍 Stack trace:', error.stack);
    console.error('📅 Czas:', new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));
});

module.exports = client;
