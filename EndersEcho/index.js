const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const OCRService = require('./services/ocrService');
const RankingService = require('./services/rankingService');
const LogService = require('./services/logService');
const RoleService = require('./services/roleService');
const InteractionHandler = require('./handlers/interactionHandlers');

// Inicjalizacja klienta Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Inicjalizacja serwisów
const ocrService = new OCRService(config);
const rankingService = new RankingService(config);
const logService = new LogService(config);
const roleService = new RoleService(config);
const interactionHandler = new InteractionHandler(config, ocrService, rankingService, logService, roleService);

/**
 * Inicjalizuje bota EndersEcho
 */
async function initializeBot() {
    try {
        console.log(`Bot zalogowany jako ${client.user.tag}!`);
        
        // Rejestracja slash commands
        await interactionHandler.registerSlashCommands(client);
        
        console.log('Dostępne komendy:');
        console.log('- /update - aktualizuje wynik na podstawie załączonego obrazu');
        console.log('- /ranking - pokazuje prywatny ranking graczy z paginacją');
        console.log(`Dozwolony kanał: ${config.allowedChannelId}`);
        
    } catch (error) {
        console.error('Błąd podczas inicjalizacji bota EndersEcho:', error);
    }
}

// Event handlers
client.once('ready', initializeBot);

client.on('interactionCreate', async (interaction) => {
    try {
        await interactionHandler.handleInteraction(interaction);
    } catch (error) {
        console.error('Błąd podczas obsługi interakcji:', error);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
                content: '❌ Wystąpił błąd podczas przetwarzania komendy.', 
                ephemeral: true 
            });
        }
    }
});

client.on('error', console.error);

/**
 * Startuje bota EndersEcho
 */
async function startBot() {
    try {
        await client.login(config.token);
        return client;
    } catch (error) {
        console.error('Błąd podczas logowania bota EndersEcho:', error);
        throw error;
    }
}

/**
 * Zatrzymuje bota EndersEcho
 */
async function stopBot() {
    try {
        if (client.readyAt) {
            await client.destroy();
            console.log('Bot EndersEcho został zatrzymany');
        }
    } catch (error) {
        console.error('Błąd podczas zatrzymywania bota EndersEcho:', error);
    }
}

// Export dla głównego launcher
module.exports = {
    name: 'EndersEcho',
    start: startBot,
    stop: stopBot,
    client
};

// Uruchomienie jako standalone (jeśli uruchamiany bezpośrednio)
if (require.main === module) {
    startBot().catch(console.error);
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Otrzymano sygnał SIGINT, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('Otrzymano sygnał SIGTERM, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });
}