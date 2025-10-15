const { Client, GatewayIntentBits, Events } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { delay } = require('./utils/helpers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');

const DatabaseService = require('./services/databaseService');
const OCRService = require('./services/ocrService');
const PunishmentService = require('./services/punishmentService');
const ReminderService = require('./services/reminderService');
const VacationService = require('./services/vacationService');
const SurvivorService = require('./services/survivorService');
const MessageCleanupService = require('./services/messageCleanupService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

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
const vacationService = new VacationService(config, logger);
const survivorService = new SurvivorService(config, logger);
const messageCleanupService = new MessageCleanupService(config, logger);
const PhaseService = require('./services/phaseService');
const phaseService = new PhaseService(config, databaseService, ocrService, client);

// Obiekt zawierający wszystkie współdzielone stany
// Ustaw globalny dostęp do klienta dla messageCleanupService
global.stalkerLMEClient = client;

// Dodaj serwisy do klienta dla łatwego dostępu w handlerach
client.messageCleanupService = messageCleanupService;
client.databaseService = databaseService;

const sharedState = {
    client,
    config,
    databaseService,
    ocrService,
    punishmentService,
    reminderService,
    vacationService,
    survivorService,
    messageCleanupService,
    phaseService
};

client.once(Events.ClientReady, async () => {
    logger.success('✅ StalkerLME gotowy - kary za bossów (OCR), urlopy');

    // Inicjalizacja serwisów
    await databaseService.initializeDatabase();
    await ocrService.initializeOCR();
    await messageCleanupService.init();

    // Rejestracja komend slash
    await registerSlashCommands(client);
    
    // Sprawdź i upewnij się, że wiadomość o urlopach jest ostatnia na kanale
    for (const guild of client.guilds.cache.values()) {
        try {
            await vacationService.ensureVacationMessageIsLast(guild);
        } catch (error) {
            logger.error(`❌ Błąd sprawdzania wiadomości o urlopach dla serwera ${guild.name}: ${error.message}`);
        }
    }
    
    // Uruchomienie zadania cron dla czyszczenia punktów (poniedziałek o północy)
    cron.schedule('0 0 * * 1', async () => {
        logger.info('Rozpoczynam tygodniowe czyszczenie punktów karnych...');
        
        for (const guild of client.guilds.cache.values()) {
            try {
                await punishmentService.cleanupAllUsers(guild);
                logger.info(`Wyczyszczono punkty dla serwera: ${guild.name}`);
            } catch (error) {
                logger.error(`Błąd czyszczenia punktów dla serwera ${guild.name}: ${error.message}`);
            }
        }
    }, {
        timezone: config.timezone
    });
    
    // Uruchomienie zadania cron dla czyszczenia plików tymczasowych (codziennie o 02:00)
    cron.schedule('0 2 * * *', async () => {
        logger.info('Rozpoczynam czyszczenie plików tymczasowych...');
        await ocrService.cleanupTempFiles();
    }, {
        timezone: config.timezone
    });
    
    // Usunięto automatyczne odświeżanie cache'u członków - teraz odbywa się przed użyciem komend
    
});

// Obsługa interakcji
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await handleInteraction(interaction, sharedState, config);
    } catch (error) {
        logger.error(`❌ Błąd podczas obsługi interakcji: ${error.message}`);
        
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
            logger.error(`❌ Nie można odpowiedzieć na interakcję (prawdopodobnie timeout): ${replyError.message}`);
        }
    }
});

// Obsługa wiadomości (dla usuwania roli urlopowej po napisaniu wniosku + Phase 1 images)
client.on(Events.MessageCreate, async (message) => {
    // Ignoruj wiadomości od botów
    if (message.author.bot) return;

    logger.info(`[MESSAGE DEBUG] Otrzymano wiadomość od ${message.author.tag}, channelId: ${message.channelId}, attachments: ${message.attachments.size}`);

    try {
        await vacationService.handleVacationMessage(message);
    } catch (error) {
        logger.error(`❌ Błąd podczas obsługi wiadomości urlopowej: ${error.message}`);
    }

    // Obsługa wiadomości z zdjęciami dla Phase 1
    try {
        const session = phaseService.getSessionByUserId(message.author.id);

        if (session && session.stage === 'awaiting_images' && session.channelId === message.channelId) {
            // Sprawdź czy wiadomość ma załączniki (zdjęcia)
            const imageAttachments = message.attachments.filter(att => att.contentType?.startsWith('image/'));

            if (imageAttachments.size > 0) {
                logger.info(`[PHASE1] 📸 Otrzymano ${imageAttachments.size} zdjęć od ${message.author.tag}`);

                const attachmentsArray = Array.from(imageAttachments.values());

                // KROK 1: Zapisz wszystkie zdjęcia na dysk
                logger.info('[PHASE1] 💾 Zapisywanie zdjęć na dysk...');
                const downloadedFiles = [];

                for (let i = 0; i < attachmentsArray.length; i++) {
                    try {
                        const filepath = await phaseService.downloadImage(
                            attachmentsArray[i].url,
                            session.sessionId,
                            session.downloadedFiles.length + i
                        );
                        downloadedFiles.push({
                            filepath,
                            originalAttachment: attachmentsArray[i]
                        });
                    } catch (error) {
                        logger.error(`[PHASE1] ❌ Błąd pobierania zdjęcia ${i + 1}:`, error);
                    }
                }

                session.downloadedFiles.push(...downloadedFiles.map(f => f.filepath));
                logger.info(`[PHASE1] ✅ Zapisano ${downloadedFiles.length} zdjęć na dysk`);

                // KROK 2: Usuń wiadomość ze zdjęciami z kanału
                try {
                    await message.delete();
                    logger.info('[PHASE1] 🗑️ Usunięto wiadomość ze zdjęciami z kanału');
                } catch (deleteError) {
                    logger.error('[PHASE1] ❌ Błąd usuwania wiadomości:', deleteError);
                }

                // KROK 3: Przetwarzaj zdjęcia z dysku
                const results = await phaseService.processImagesFromDisk(
                    session.sessionId,
                    downloadedFiles,
                    message.guild,
                    message.member,
                    session.publicInteraction
                );

                // Pokaż potwierdzenie przetworzenia w publicznej wiadomości
                const processedCount = results.length;
                const totalImages = session.processedImages.length;

                const confirmation = phaseService.createProcessedImagesEmbed(processedCount, totalImages, session.phase);

                session.stage = 'confirming_complete';
                phaseService.refreshSessionTimeout(session.sessionId);

                if (session.publicInteraction) {
                    await session.publicInteraction.editReply({
                        embeds: [confirmation.embed],
                        components: [confirmation.row]
                    });
                }
            }
        }
    } catch (error) {
        logger.error(`[PHASE1] ❌ Błąd podczas obsługi wiadomości Phase 1: ${error.message}`);
    }

    // Obsługa przesyłania plików dla /wyniki
    try {
        const { wynikiAwaitingFiles, wynikiAttachments } = require('./handlers/interactionHandlers');
        const awaitKey = `${message.author.id}_${message.channelId}`;

        logger.info(`[WYNIKI DEBUG] Sprawdzam czy oczekuję na pliki: ${wynikiAwaitingFiles.has(awaitKey)}, awaitKey: ${awaitKey}`);

        if (wynikiAwaitingFiles.has(awaitKey)) {
            const awaitData = wynikiAwaitingFiles.get(awaitKey);
            logger.info(`[WYNIKI DEBUG] Znaleziono oczekiwanie na pliki, załączników: ${message.attachments.size}`);

            // Sprawdź czy to odpowiedź "nie" lub "skip"
            const messageContent = message.content.toLowerCase().trim();
            if (messageContent === 'nie' || messageContent === 'skip' || messageContent === 'n' || messageContent === 'no') {
                wynikiAwaitingFiles.delete(awaitKey);

                // Usuń wiadomość użytkownika
                try {
                    await message.delete();
                } catch (e) {}

                // Kontynuuj normalny przepływ /wyniki bez załączników
                const { handleWynikiContinue } = require('./handlers/interactionHandlers');
                await handleWynikiContinue(message.author.id, message.channelId, message.guild, sharedState);
                return;
            }

            // Sprawdź czy są załączniki
            if (message.attachments.size > 0) {
                logger.info(`[WYNIKI] 📎 Otrzymano ${message.attachments.size} załączników od ${message.author.tag}`);

                // Ogranicz do 10 załączników
                const attachmentsArray = Array.from(message.attachments.values()).slice(0, 10);

                // Zapisz załączniki
                const attachmentObjects = attachmentsArray.map(att => ({
                    url: att.url,
                    name: att.name,
                    contentType: att.contentType
                }));

                wynikiAttachments.set(awaitKey, attachmentObjects);
                wynikiAwaitingFiles.delete(awaitKey);

                // Usuń wiadomość użytkownika z załącznikami
                try {
                    await message.delete();
                } catch (e) {}

                logger.info(`[WYNIKI] ✅ Zapisano ${attachmentObjects.length} załączników`);

                // Kontynuuj normalny przepływ /wyniki z załącznikami
                logger.info(`[WYNIKI DEBUG] Wywołuję handleWynikiContinue...`);
                const { handleWynikiContinue } = require('./handlers/interactionHandlers');
                await handleWynikiContinue(message.author.id, message.channelId, message.guild, sharedState);
                logger.info(`[WYNIKI DEBUG] handleWynikiContinue zakończony`);
            }
        }
    } catch (error) {
        logger.error(`[WYNIKI] ❌ Błąd podczas obsługi załączników: ${error.message}`);
        logger.error(`[WYNIKI] ❌ Stack trace:`, error.stack);
    }
});

// Obsługa błędów
client.on('error', error => {
    // Ignoruj błędy WebSocket 520 - są tymczasowe
    if (error.message && error.message.includes('520')) {
        logger.warn('Tymczasowy błąd WebSocket 520 - automatyczne ponowne połączenie');
        return;
    }
    
    logger.error(`Błąd klienta Discord: ${error.message}`);
});

client.on('warn', warning => {
    logger.warn(`Ostrzeżenie Discord: ${warning}`);
});

// Obsługa błędów procesów
process.on('unhandledRejection', error => {
    // Ignoruj błędy WebSocket 520 - są tymczasowe
    if (error.message && error.message.includes('520')) {
        logger.warn('Tymczasowy błąd WebSocket 520 - ignoruję');
        return;
    }
    
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
    logger.error(error);
});

process.on('uncaughtException', error => {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    logger.error(error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Otrzymano sygnał SIGINT, zamykam bota...');
    
    try {
        await client.destroy();
        logger.info('Bot został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota: ${error.message}`);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    logger.info('Otrzymano sygnał SIGTERM, zamykam bota...');
    
    try {
        await client.destroy();
        logger.info('Bot został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota: ${error.message}`);
        process.exit(1);
    }
});

// Funkcja do odświeżania cache'u członków
async function refreshMemberCache() {
    try {
        logger.info('Odświeżanie cache\'u członków');
        
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
        
        logger.info('Podsumowanie odświeżania cache\'u:');
        logger.info(`🏰 Serwerów przetworzonych: ${guildsProcessed}`);
        logger.info(`👥 Łączna liczba członków: ${totalMembers}`);
        logger.info('✅ Odświeżanie cache\'u zakończone pomyślnie');
        
    } catch (error) {
        logger.error('Błąd odświeżania cache\'u');
        logger.error('❌ Błąd odświeżania cache\'u członków:', error);
    }
}

// Funkcje do zarządzania botem
async function startBot() {
    try {
        if (!config.token) {
            throw new Error('STALKER_LME_TOKEN nie jest ustawiony w zmiennych środowiskowych');
        }
        
        await client.login(config.token);
        return client;
    } catch (error) {
        logger.error(`Błąd uruchamiania bota: ${error.message}`);
        throw error;
    }
}

async function stopBot() {
    try {
        logger.info('Zatrzymywanie bota Stalker LME...');

        // Zatrzymaj serwis automatycznego usuwania wiadomości
        messageCleanupService.stop();

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
    refreshMemberCache,
    
    // Dla kompatybilności z głównym launcherem
    start: startBot,
    stop: stopBot
};