const { Client, GatewayIntentBits, Events, MessageFlags, ChannelType } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { delay } = require('./utils/helpers');
const { handleInteraction, registerSlashCommands, sendGhostPing, stopGhostPing } = require('./handlers/interactionHandlers');

const DatabaseService = require('./services/databaseService');
const OCRService = require('./services/ocrService');
const PunishmentService = require('./services/punishmentService');
const ReminderService = require('./services/reminderService');
const ReminderUsageService = require('./services/reminderUsageService');
const ReminderStatusTrackingService = require('./services/reminderStatusTrackingService');
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
const reminderUsageService = new ReminderUsageService(config);
const reminderStatusTrackingService = new ReminderStatusTrackingService(config);
const vacationService = new VacationService(config, logger);
const survivorService = new SurvivorService(config, logger);
const messageCleanupService = new MessageCleanupService(config, logger);
const PhaseService = require('./services/phaseService');
const phaseService = new PhaseService(config, databaseService, ocrService, client);

// Połącz serwisy - daj ocrService dostęp do reminderService i punishmentService
ocrService.setServices(reminderService, punishmentService);

// Obiekt zawierający wszystkie współdzielone stany
// Ustaw globalny dostęp do klienta dla messageCleanupService i reminderStatusTrackingService
global.stalkerLMEClient = client;
global.stalkerClient = client; // Alias dla reminderStatusTrackingService

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
    reminderUsageService,
    reminderStatusTrackingService,
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
    ocrService.setClient(client); // Ustaw klienta dla systemu kolejkowania OCR
    await messageCleanupService.init();
    await reminderUsageService.loadUsageData();

    // Rejestracja komend slash
    await registerSlashCommands(client);

    // Inicjalizacja wyświetlania kolejki OCR
    try {
        await ocrService.initializeQueueDisplay(client);
    } catch (error) {
        logger.error(`❌ Błąd inicjalizacji wyświetlania kolejki OCR: ${error.message}`);
    }

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

    // Uruchomienie zadania cron dla czyszczenia starych danych przypomnień (codziennie o 03:00)
    cron.schedule('0 3 * * *', async () => {
        logger.info('Rozpoczynam czyszczenie starych danych przypomnień...');
        await reminderUsageService.cleanupOldData();
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
                    flags: MessageFlags.Ephemeral
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

    // ============ OBSŁUGA WIADOMOŚCI DM OD UŻYTKOWNIKÓW Z AKTYWNYMI SESJAMI PRZYPOMNIENIA ============
    if (message.channel.type === ChannelType.DM) {
        try {
            const userId = message.author.id;

            // Sprawdź czy użytkownik ma aktywną sesję przypomnienia
            if (reminderService.hasActiveReminderDM(userId)) {
                const sessionData = reminderService.getActiveReminderDM(userId);

                logger.info(`[REMINDER-DM] 📩 Użytkownik ${message.author.tag} napisał na DM zamiast kliknąć przycisk`);

                // Pobierz guild i kanał potwierdzenia
                const guild = await client.guilds.fetch(sessionData.guildId);
                const confirmationChannel = await guild.channels.fetch(sessionData.confirmationChannelId);

                if (confirmationChannel) {
                    // Przekaż wiadomość użytkownika na kanał potwierdzenia
                    await confirmationChannel.send({
                        content: `📩 **${message.author.tag}** napisał na DM zamiast kliknąć przycisk:\n>>> ${message.content}`
                    });

                    logger.info(`[REMINDER-DM] 📤 Przekazano wiadomość na kanał potwierdzenia`);
                }

                // Wyślij użytkownikowi odpowiedź
                await message.reply('**Nie leć w chuja, kliknij przycisk i bij tego bossa xD**');

                logger.info(`[REMINDER-DM] 💬 Wysłano odpowiedź do użytkownika`);
            }
        } catch (error) {
            logger.error(`[REMINDER-DM] ❌ Błąd obsługi wiadomości DM: ${error.message}`);
        }
    }

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
                const confirmation = phaseService.createProcessedImagesEmbed(session);

                session.stage = 'confirming_complete';
                phaseService.refreshSessionTimeout(session.sessionId);

                if (session.publicInteraction) {
                    // Obsługa zarówno Interaction jak i Message
                    if (session.publicInteraction.editReply) {
                        await session.publicInteraction.editReply({
                            embeds: [confirmation.embed],
                            components: [confirmation.row]
                        });
                    } else {
                        await session.publicInteraction.edit({
                            embeds: [confirmation.embed],
                            components: [confirmation.row]
                        });
                    }

                    // Wyślij ghost ping zamiast zwykłego pingu w edytowanej wiadomości
                    const channel = await client.channels.fetch(session.channelId);
                    await sendGhostPing(channel, message.author.id, session);
                }
            }
        }
    } catch (error) {
        logger.error(`[PHASE1] ❌ Błąd podczas obsługi wiadomości Phase 1: ${error.message}`);
    }

    // Obsługa wiadomości z zdjęciami dla /remind
    try {
        const session = reminderService.getSessionByUserId(message.author.id);

        if (session && session.stage === 'awaiting_images' && session.channelId === message.channelId) {
            // Sprawdź czy wiadomość ma załączniki (zdjęcia)
            const imageAttachments = message.attachments.filter(att => att.contentType?.startsWith('image/'));

            if (imageAttachments.size > 0) {
                logger.info(`[REMIND] 📸 Otrzymano ${imageAttachments.size} zdjęć od ${message.author.tag}`);

                const attachmentsArray = Array.from(imageAttachments.values());

                // KROK 1: Zapisz wszystkie zdjęcia na dysk
                logger.info('[REMIND] 💾 Zapisywanie zdjęć na dysk...');
                const downloadedFiles = [];

                for (let i = 0; i < attachmentsArray.length; i++) {
                    try {
                        const filepath = await reminderService.downloadImage(
                            attachmentsArray[i].url,
                            session.sessionId,
                            session.downloadedFiles.length + i
                        );
                        downloadedFiles.push({
                            filepath,
                            originalAttachment: attachmentsArray[i]
                        });
                    } catch (error) {
                        logger.error(`[REMIND] ❌ Błąd pobierania zdjęcia ${i + 1}:`, error);
                    }
                }

                session.downloadedFiles.push(...downloadedFiles.map(f => f.filepath));
                logger.info(`[REMIND] ✅ Zapisano ${downloadedFiles.length} zdjęć na dysk`);

                // KROK 2: Usuń wiadomość ze zdjęciami z kanału
                try {
                    await message.delete();
                    logger.info('[REMIND] 🗑️ Usunięto wiadomość ze zdjęciami z kanału');
                } catch (deleteError) {
                    logger.error('[REMIND] ❌ Błąd usuwania wiadomości:', deleteError);
                }

                // KROK 3: Przetwarzaj zdjęcia z dysku
                const results = await reminderService.processImagesFromDisk(
                    session.sessionId,
                    downloadedFiles,
                    message.guild,
                    message.member,
                    session.publicInteraction,
                    ocrService
                );

                // Pokaż końcowe potwierdzenie z listą graczy
                const confirmation = reminderService.createFinalConfirmationEmbed(session);

                session.stage = 'confirming_complete';
                reminderService.refreshSessionTimeout(session.sessionId);

                if (session.publicInteraction) {
                    // Obsługa zarówno Interaction jak i Message
                    if (session.publicInteraction.editReply) {
                        await session.publicInteraction.editReply({
                            embeds: [confirmation.embed],
                            components: [confirmation.row],
                            files: confirmation.files
                        });
                    } else {
                        await session.publicInteraction.edit({
                            embeds: [confirmation.embed],
                            components: [confirmation.row],
                            files: confirmation.files
                        });
                    }

                    // Wyślij ghost ping zamiast zwykłego pingu w edytowanej wiadomości
                    const channel = await client.channels.fetch(session.channelId);
                    await sendGhostPing(channel, message.author.id, session);
                }
            }
        }
    } catch (error) {
        logger.error(`[REMIND] ❌ Błąd podczas obsługi wiadomości /remind: ${error.message}`);
    }

    // Obsługa wiadomości z zdjęciami dla /punish
    try {
        const session = punishmentService.getSessionByUserId(message.author.id);

        if (session && session.stage === 'awaiting_images' && session.channelId === message.channelId) {
            // Sprawdź czy wiadomość ma załączniki (zdjęcia)
            const imageAttachments = message.attachments.filter(att => att.contentType?.startsWith('image/'));

            if (imageAttachments.size > 0) {
                logger.info(`[PUNISH] 📸 Otrzymano ${imageAttachments.size} zdjęć od ${message.author.tag}`);

                const attachmentsArray = Array.from(imageAttachments.values());

                // KROK 1: Zapisz wszystkie zdjęcia na dysk
                logger.info('[PUNISH] 💾 Zapisywanie zdjęć na dysk...');
                const downloadedFiles = [];

                for (let i = 0; i < attachmentsArray.length; i++) {
                    try {
                        const filepath = await punishmentService.downloadImage(
                            attachmentsArray[i].url,
                            session.sessionId,
                            session.downloadedFiles.length + i
                        );
                        downloadedFiles.push({
                            filepath,
                            originalAttachment: attachmentsArray[i]
                        });
                    } catch (error) {
                        logger.error(`[PUNISH] ❌ Błąd pobierania zdjęcia ${i + 1}:`, error);
                    }
                }

                session.downloadedFiles.push(...downloadedFiles.map(f => f.filepath));
                logger.info(`[PUNISH] ✅ Zapisano ${downloadedFiles.length} zdjęć na dysk`);

                // KROK 2: Usuń wiadomość ze zdjęciami z kanału
                try {
                    await message.delete();
                    logger.info('[PUNISH] 🗑️ Usunięto wiadomość ze zdjęciami z kanału');
                } catch (deleteError) {
                    logger.error('[PUNISH] ❌ Błąd usuwania wiadomości:', deleteError);
                }

                // KROK 3: Przetwarzaj zdjęcia z dysku
                const results = await punishmentService.processImagesFromDisk(
                    session.sessionId,
                    downloadedFiles,
                    message.guild,
                    message.member,
                    session.publicInteraction,
                    ocrService
                );

                // Pokaż końcowe potwierdzenie z listą graczy
                const confirmation = punishmentService.createFinalConfirmationEmbed(session);

                session.stage = 'confirming_complete';
                punishmentService.refreshSessionTimeout(session.sessionId);

                if (session.publicInteraction) {
                    // Obsługa zarówno Interaction jak i Message
                    if (session.publicInteraction.editReply) {
                        await session.publicInteraction.editReply({
                            embeds: [confirmation.embed],
                            components: [confirmation.row],
                            files: confirmation.files
                        });
                    } else {
                        await session.publicInteraction.edit({
                            embeds: [confirmation.embed],
                            components: [confirmation.row],
                            files: confirmation.files
                        });
                    }

                    // Wyślij ghost ping zamiast zwykłego pingu w edytowanej wiadomości
                    const channel = await client.channels.fetch(session.channelId);
                    await sendGhostPing(channel, message.author.id, session);
                }
            }
        }
    } catch (error) {
        logger.error(`[PUNISH] ❌ Błąd podczas obsługi wiadomości /punish: ${error.message}`);
    }

    // Obsługa MessageCreate dla /wyniki została przeniesiona do message collector w interactionHandlers.js
    // Ten blok kodu nie jest już używany, ale zostawiam dla referencji w przypadku problemów

    // Automatyczne czyszczenie kanału kolejki - usuń wszystkie wiadomości od użytkowników
    const queueChannelId = '1437122516974829679';
    if (message.channelId === queueChannelId && !message.author.bot) {
        try {
            await message.delete();
            logger.info(`[QUEUE-CLEANUP] 🧹 Usunięto wiadomość od ${message.author.tag} z kanału kolejki`);
        } catch (error) {
            // Ignoruj błąd Unknown Message (10008) - wiadomość została już usunięta przez inny proces
            if (error.code === 10008) {
                return;
            }
            logger.error(`[QUEUE-CLEANUP] ❌ Błąd usuwania wiadomości: ${error.message}`);
        }
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