const { Client, GatewayIntentBits, Events } = require('discord.js');

const config = require('./config/config');
const { logWithTimestamp } = require('./utils/helpers');

// Importuj serwisy
const RoleManagementService = require('./services/roleManagementService');
const MediaService = require('./services/mediaService');
const LogService = require('./services/logService');
const SpecialRolesService = require('./services/specialRolesService');

// Importuj handlery
const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const MemberHandler = require('./handlers/memberHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

// Tworzenie klienta Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Inicjalizacja serwisów
const specialRolesService = new SpecialRolesService(config);
const roleManagementService = new RoleManagementService(config, specialRolesService);
const mediaService = new MediaService(config);
const logService = new LogService(config);

// Inicjalizacja handlerów
const interactionHandler = new InteractionHandler(config, roleManagementService, logService, specialRolesService);
const messageHandler = new MessageHandler(config, mediaService, logService);
const memberHandler = new MemberHandler(config, roleManagementService, logService);

// Obiekt zawierający wszystkie współdzielone stany
const sharedState = {
    client,
    config,
    specialRolesService,
    roleManagementService,
    mediaService,
    logService,
    interactionHandler,
    messageHandler,
    memberHandler
};

// ==================== EVENTY BOTA ====================

client.once(Events.ClientReady, async () => {
    await logService.logMessage('success', `Bot ${client.user.tag} jest online!`);
    
    // Inicjalizuj serwisy
    logService.initialize(client);
    await mediaService.initialize();
    
    // Zarejestruj komendy slash
    await interactionHandler.registerSlashCommands(client);
    
    await logService.logMessage('info', 'Bot gotowy do pracy - obsługuje pliki do 100 MB i automatyczne zarządzanie rolami z przywracaniem!');
});

// Obsługa wiadomości
client.on(Events.MessageCreate, async (message) => {
    await messageHandler.handleMessage(message, client);
});

// Obsługa zmian członków serwera
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    await memberHandler.handleGuildMemberUpdate(oldMember, newMember);
});

// Obsługa interakcji
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await interactionHandler.handleInteraction(interaction);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.', 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.' 
                });
            }
        } catch (replyError) {
            logger.error('❌ Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

// ==================== OBSŁUGA BŁĘDÓW ====================

// Obsługa błędów klienta
client.on('error', error => {
    logService.logMessage('error', `Błąd klienta Discord: ${error.message}`);
});

client.on('warn', warning => {
    logService.logMessage('warn', `Ostrzeżenie Discord: ${warning}`);
});

// Obsługa błędów procesów
process.on('unhandledRejection', async (error) => {
    await logService.logMessage('error', `Nieobsłużony błąd: ${error.message}`);
});

process.on('uncaughtException', async (error) => {
    await logService.logMessage('error', `Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
});

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
    await logService.logMessage('info', 'Zamykanie bota...');
    
    if (config.media.autoCleanup) {
        await mediaService.cleanupAllCache();
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await logService.logMessage('info', 'Otrzymano sygnał SIGTERM, zamykam bota...');
    
    try {
        if (config.media.autoCleanup) {
            await mediaService.cleanupAllCache();
        }
        
        client.destroy();
        logWithTimestamp('Bot został pomyślnie zamknięty', 'info');
        process.exit(0);
    } catch (error) {
        logWithTimestamp(`Błąd podczas zamykania bota: ${error.message}`, 'error');
        process.exit(1);
    }
});

// ==================== FUNKCJE ZARZĄDZANIA BOTEM ====================

/**
 * Uruchamia bota
 */
async function startBot() {
    try {
        if (!config.token) {
            throw new Error('MUTEUSZ_TOKEN nie jest ustawiony w zmiennych środowiskowych');
        }
        
        
        await client.login(config.token);
        return client;
    } catch (error) {
        logWithTimestamp(`Błąd uruchamiania bota: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Zatrzymuje bota
 */
async function stopBot() {
    try {
        logWithTimestamp('Zatrzymywanie bota Muteusz...', 'info');
        
        if (config.media.autoCleanup) {
            await mediaService.cleanupAllCache();
        }
        
        await client.destroy();
        logWithTimestamp('Bot został zatrzymany', 'info');
    } catch (error) {
        logWithTimestamp(`Błąd zatrzymywania bota: ${error.message}`, 'error');
        throw error;
    }
}

// Eksportuj funkcje do zarządzania botem
module.exports = {
    client,
    startBot,
    stopBot,
    sharedState,
    
    // Dla kompatybilności z głównym launcherem
    start: startBot,
    stop: stopBot
};

// Jeśli plik jest uruchamiany bezpośrednio, wystartuj bota
if (require.main === module) {
    startBot().catch(error => {
        logger.error('❌ Błąd uruchamiania bota:', error.message);
        process.exit(1);
    });
}