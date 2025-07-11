const { Client, GatewayIntentBits, Events } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { logWithTimestamp, delay } = require('./utils/helpers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');

const DatabaseService = require('./services/databaseService');
const OCRService = require('./services/ocrService');
const PunishmentService = require('./services/punishmentService');
const ReminderService = require('./services/reminderService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
logger.info('Inicjalizacja bota Stalker LME...');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// Inicjalizacja serwisów
const databaseService = new DatabaseService(config);
const ocrService = new OCRService(config);
const punishmentService = new PunishmentService(config, databaseService);
const reminderService = new ReminderService(config);

// Obiekt zawierający wszystkie współdzielone stany
const sharedState = {
    client,
    config,
    databaseService,
    ocrService,
    punishmentService,
    reminderService
};

client.once(Events.ClientReady, async () => {
    logWithTimestamp(`Bot zalogowany jako ${client.user.tag}`, 'info');
    logWithTimestamp(`Aktywny na ${client.guilds.cache.size} serwerach`, 'info');
    
    client.guilds.cache.forEach(guild => {
        logWithTimestamp(`- ${guild.name} (${guild.id})`, 'info');
    });
    
    // Inicjalizacja serwisów
    await databaseService.initializeDatabase();
    await ocrService.initializeOCR();
    
    // Rejestracja komend slash
    await registerSlashCommands(client);
    
    // Uruchomienie zadania cron dla czyszczenia punktów (poniedziałek o północy)
    cron.schedule('0 0 * * 1', async () => {
        logWithTimestamp('Rozpoczynam tygodniowe czyszczenie punktów karnych...', 'info');
        
        for (const guild of client.guilds.cache.values()) {
            try {
                await punishmentService.cleanupAllUsers(guild);
                logWithTimestamp(`Wyczyszczono punkty dla serwera: ${guild.name}`, 'info');
            } catch (error) {
                logWithTimestamp(`Błąd czyszczenia punktów dla serwera ${guild.name}: ${error.message}`, 'error');
            }
        }
    }, {
        timezone: config.timezone
    });
    
    // Uruchomienie zadania cron dla czyszczenia plików tymczasowych (codziennie o 02:00)
    cron.schedule('0 2 * * *', async () => {
        logWithTimestamp('Rozpoczynam czyszczenie plików tymczasowych...', 'info');
        await ocrService.cleanupTempFiles();
    }, {
        timezone: config.timezone
    });
    
    // Uruchomienie zadania cron dla odświeżania cache'u członków (co godzinę)
    cron.schedule('0 * * * *', async () => {
        logWithTimestamp('Rozpoczynam odświeżanie cache\'u członków...', 'info');
        await refreshMemberCache();
    }, {
        timezone: config.timezone
    });
    
    // Początkowe odświeżenie cache'u członków
    await refreshMemberCache();
    
    logWithTimestamp('Bot Stalker LME jest gotowy do pracy!', 'info');
});

// Obsługa interakcji
client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction, sharedState, config);
});

// Obsługa błędów
client.on('error', error => {
    // Ignoruj błędy WebSocket 520 - są tymczasowe
    if (error.message && error.message.includes('520')) {
        logWithTimestamp('Tymczasowy błąd WebSocket 520 - automatyczne ponowne połączenie', 'warn');
        return;
    }
    
    logWithTimestamp(`Błąd klienta Discord: ${error.message}`, 'error');
});

client.on('warn', warning => {
    logWithTimestamp(`Ostrzeżenie Discord: ${warning}`, 'warn');
});

// Obsługa błędów procesów
process.on('unhandledRejection', error => {
    // Ignoruj błędy WebSocket 520 - są tymczasowe
    if (error.message && error.message.includes('520')) {
        logWithTimestamp('Tymczasowy błąd WebSocket 520 - ignoruję', 'warn');
        return;
    }
    
    logWithTimestamp(`Nieobsłużone odrzucenie Promise: ${error.message}`, 'error');
    logger.error(error);
});

process.on('uncaughtException', error => {
    logWithTimestamp(`Nieobsłużony wyjątek: ${error.message}`, 'error');
    logger.error(error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    logWithTimestamp('Otrzymano sygnał SIGINT, zamykam bota...', 'info');
    
    try {
        await client.destroy();
        logWithTimestamp('Bot został pomyślnie zamknięty', 'info');
        process.exit(0);
    } catch (error) {
        logWithTimestamp(`Błąd podczas zamykania bota: ${error.message}`, 'error');
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    logWithTimestamp('Otrzymano sygnał SIGTERM, zamykam bota...', 'info');
    
    try {
        await client.destroy();
        logWithTimestamp('Bot został pomyślnie zamknięty', 'info');
        process.exit(0);
    } catch (error) {
        logWithTimestamp(`Błąd podczas zamykania bota: ${error.message}`, 'error');
        process.exit(1);
    }
});

// Funkcja do odświeżania cache'u członków
async function refreshMemberCache() {
    try {
        logger.info('\n👥 ==================== ODŚWIEŻANIE CACHE\'U CZŁONKÓW ====================');
        
        let totalMembers = 0;
        let guildsProcessed = 0;
        
        for (const guild of client.guilds.cache.values()) {
            try {
                logger.info(`🏰 Przetwarzanie serwera: ${guild.name} (${guild.id})`);
                
                // Odśwież cache dla wszystkich członków serwera
                const members = await guild.members.fetch();
                
                logger.info(`👥 Załadowano ${members.size} członków dla serwera ${guild.name}`);
                totalMembers += members.size;
                guildsProcessed++;
                
                // Sprawdź ile członków ma role target
                let targetRoleMembers = 0;
                for (const roleId of Object.values(config.targetRoles)) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        targetRoleMembers += role.members.size;
                        logger.info(`🎭 Rola ${role.name}: ${role.members.size} członków`);
                    }
                }
                
                logger.info(`✅ Serwer ${guild.name}: ${members.size} członków, ${targetRoleMembers} z rolami target`);
                
            } catch (error) {
                logger.error(`❌ Błąd odświeżania cache'u dla serwera ${guild.name}: ${error.message}`);
            }
        }
        
        logger.info('\n📊 PODSUMOWANIE ODŚWIEŻANIA CACHE\'U:');
        logger.info(`🏰 Serwerów przetworzonych: ${guildsProcessed}`);
        logger.info(`👥 Łączna liczba członków: ${totalMembers}`);
        logger.info('✅ Odświeżanie cache\'u zakończone pomyślnie');
        
    } catch (error) {
        logger.error('\n💥 ==================== BŁĄD ODŚWIEŻANIA CACHE\'U ====================');
        logger.error('❌ Błąd odświeżania cache\'u członków:', error);
    }
}

// Funkcje do zarządzania botem
async function startBot() {
    try {
        if (!config.token) {
            throw new Error('STALKER_LME_TOKEN nie jest ustawiony w zmiennych środowiskowych');
        }
        
        logWithTimestamp('Uruchamianie bota Stalker LME...', 'info');
        await client.login(config.token);
        return client;
    } catch (error) {
        logWithTimestamp(`Błąd uruchamiania bota: ${error.message}`, 'error');
        throw error;
    }
}

async function stopBot() {
    try {
        logWithTimestamp('Zatrzymywanie bota Stalker LME...', 'info');
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
    refreshMemberCache,
    
    // Dla kompatybilności z głównym launcherem
    start: startBot,
    stop: stopBot
};