const { Client, GatewayIntentBits, Events } = require('discord.js');

const config = require('./config/config');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

// Importuj serwisy
const MediaService = require('./services/mediaService');
const LogService = require('./services/logService');
const SpecialRolesService = require('./services/specialRolesService');
const RoleManagementService = require('./services/roleManagementService');
const RoleKickingService = require('./services/roleKickingService');

// Importuj handlery
const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const MemberHandler = require('./handlers/memberHandlers');

// Tworzenie klienta Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration
    ]
});

// Inicjalizacja serwisów
const specialRolesService = new SpecialRolesService(config);
const roleManagementService = new RoleManagementService(config, specialRolesService);
const mediaService = new MediaService(config);
const logService = new LogService(config);
const roleKickingService = new RoleKickingService(config);

// Inicjalizacja handlerów
const messageHandler = new MessageHandler(config, mediaService, logService);
const interactionHandler = new InteractionHandler(config, logService, specialRolesService, messageHandler, roleKickingService);
const memberHandler = new MemberHandler(config, logService, specialRolesService, roleManagementService);

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
    await roleKickingService.initialize(client);
    
    // Zarejestruj komendy slash
    await interactionHandler.registerSlashCommands(client);
    
    await logService.logMessage('info', 'Bot gotowy do pracy - obsługuje pliki do 100 MB i automatyczne zarządzanie rolami z przywracaniem!');
});

// Obsługa wiadomości
client.on(Events.MessageCreate, async (message) => {
    await messageHandler.handleMessage(message, client);
});

// Obsługa usuniętych wiadomości
client.on(Events.MessageDelete, async (message) => {
    await mediaService.handleDeletedMessage(message, client);
});

// Obsługa edytowanych wiadomości
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    await mediaService.handleEditedMessage(oldMessage, newMessage, client);
});

// Obsługa zmian członków serwera
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    // Obsługa ról ekskluzywnych
    await memberHandler.handleGuildMemberUpdate(oldMember, newMember);
    
    // Sprawdź zmianę statusu premium (boost)
    const oldPremium = oldMember.premiumSince;
    const newPremium = newMember.premiumSince;
    
    // Jeśli użytkownik stracił boost
    if (oldPremium && !newPremium) {
        logger.info(`🔻 ${newMember.user.tag} stracił boost serwera`);
        await memberHandler.handleBoostLoss(newMember);
    }
    
    // Jeśli użytkownik otrzymał boost
    if (!oldPremium && newPremium) {
        logger.info(`🔺 ${newMember.user.tag} otrzymał boost serwera`);
        await memberHandler.handleBoostGain(newMember);
    }
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
    if (logService && logService.logMessage) {
        logService.logMessage('error', `Błąd klienta Discord: ${error.message}`);
    } else {
        logger.error(`Błąd klienta Discord: ${error.message}`);
    }
});

client.on('warn', warning => {
    if (logService && logService.logMessage) {
        logService.logMessage('warn', `Ostrzeżenie Discord: ${warning}`);
    } else {
        logger.warn(`Ostrzeżenie Discord: ${warning}`);
    }
});

// Obsługa błędów procesów
process.on('unhandledRejection', async (error) => {
    if (logService && logService.logMessage) {
        await logService.logMessage('error', `Nieobsłużony błąd: ${error.message}`);
    } else {
        logger.error(`Nieobsłużony błąd: ${error.message}`);
    }
});

process.on('uncaughtException', async (error) => {
    if (logService && logService.logMessage) {
        await logService.logMessage('error', `Nieobsłużony wyjątek: ${error.message}`);
    } else {
        logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    }
    process.exit(1);
});

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
    if (logService && logService.logMessage) {
        await logService.logMessage('info', 'Zamykanie bota...');
    } else {
        logger.info('Zamykanie bota...');
    }
    
    if (config.media.autoCleanup && mediaService) {
        await mediaService.cleanupAllCache();
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (logService && logService.logMessage) {
        await logService.logMessage('info', 'Otrzymano sygnał SIGTERM, zamykam bota...');
    } else {
        logger.info('Otrzymano sygnał SIGTERM, zamykam bota...');
    }
    
    try {
        if (config.media.autoCleanup && mediaService) {
            await mediaService.cleanupAllCache();
        }
        
        client.destroy();
        logger.info('Bot został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota: ${error.message}`);
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
        logger.error(`Błąd uruchamiania bota: ${error.message}`);
        throw error;
    }
}

/**
 * Zatrzymuje bota
 */
async function stopBot() {
    try {
        logger.info('Zatrzymywanie bota Muteusz...');
        
        if (config.media.autoCleanup) {
            await mediaService.cleanupAllCache();
        }
        
        // Wyczyść oczekujące logi zmian ról
        if (roleChangeLogService) {
            roleChangeLogService.cleanup();
        }
        
        await client.destroy();
        logger.info('Bot został zatrzymany');
    } catch (error) {
        logger.error(`Błąd zatrzymywania bota: ${error.message}`);
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