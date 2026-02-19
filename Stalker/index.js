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
const RaportCleanupService = require('./services/raportCleanupService');
const BroadcastMessageService = require('./services/broadcastMessageService');
const AIChatService = require('./services/aiChatService');
const { createBotLogger } = require('../utils/consoleLogger');
const { safeFetchMembers } = require('../utils/guildMembersThrottle');

const logger = createBotLogger('Stalker');

// Cooldown kalkulatora - raz na godzinę per kanał
const calculatorCooldowns = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,  // Działa dla wiadomości guild I DM
        GatewayIntentBits.DirectMessages   // Żeby odbierać eventy DM
    ]
});

const databaseService = new DatabaseService(config);
const ocrService = new OCRService(config);
const punishmentService = new PunishmentService(config, databaseService);
const reminderService = new ReminderService(config);
const reminderUsageService = new ReminderUsageService(config);
const reminderStatusTrackingService = new ReminderStatusTrackingService(config);
const vacationService = new VacationService(config, logger);
const survivorService = new SurvivorService(config, logger);
const messageCleanupService = new MessageCleanupService(config, logger);
const raportCleanupService = new RaportCleanupService(client, logger);
const broadcastMessageService = new BroadcastMessageService(logger);
// Import funkcji pomocniczych do AI Chat
const { generatePlayerProgressTextData, generatePlayerStatusTextData } = require('./handlers/interactionHandlers');

const aiChatService = new AIChatService(
    config,
    databaseService,
    reminderUsageService,
    punishmentService,
    { generatePlayerProgressTextData, generatePlayerStatusTextData } // Helper functions
);
const PhaseService = require('./services/phaseService');
const phaseService = new PhaseService(config, databaseService, ocrService, client);

// Połącz serwisy - daj ocrService dostęp do reminderService, punishmentService i phaseService
ocrService.setServices(reminderService, punishmentService, phaseService);

// KRYTYCZNE: Daj każdemu serwisowi dostęp do ocrService (zapobiega deadlockom)
reminderService.setOCRService(ocrService);
punishmentService.setOCRService(ocrService);

global.stalkerClient = client;

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
    raportCleanupService,
    broadcastMessageService,
    aiChatService,
    phaseService
};

client.once(Events.ClientReady, async () => {
    logger.success('✅ Stalker gotowy - kary za bossów (OCR), urlopy');

    // Inicjalizacja serwisów
    await databaseService.initializeDatabase();
    await ocrService.initializeOCR();
    ocrService.setClient(client); // Ustaw klienta dla systemu kolejkowania OCR
    await messageCleanupService.init();
    await raportCleanupService.initialize();
    await broadcastMessageService.initialize();
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

    // SPRAWDZENIE PO STARCIE: Czy deadline minął? Jeśli tak, usuń przyciski natychmiast
    const now = new Date();
    const polandTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
    const deadline = new Date(polandTime);
    deadline.setHours(config.bossDeadline.hour, config.bossDeadline.minute, 0, 0);

    if (polandTime >= deadline) {
        logger.info('⏰ Deadline minął - usuwam wygasłe przyciski potwierdzenia natychmiast po starcie...');
        try {
            await reminderService.disableExpiredConfirmationButtons(client);
            logger.info('✅ Przyciski zostały usunięte po starcie bota');
        } catch (error) {
            logger.error(`❌ Błąd usuwania przycisków po starcie: ${error.message}`);
        }
    } else {
        logger.info(`✅ Deadline jeszcze nie minął (${config.bossDeadline.hour}:${String(config.bossDeadline.minute).padStart(2, '0')}) - przyciski pozostają aktywne`);
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

    // Uruchomienie zadania cron dla wyłączania przycisków potwierdzenia po deadline (codziennie o 16:50)
    cron.schedule('50 16 * * *', async () => {
        logger.info('⏰ Deadline minął - wyłączam przyciski potwierdzenia...');
        await reminderService.disableExpiredConfirmationButtons(client);
    }, {
        timezone: config.timezone
    });

    // Usunięto automatyczne odświeżanie cache'u członków - teraz odbywa się przed użyciem komend

});

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

                // Wyślij użytkownikowi odpowiedź TYLKO RAZ
                if (!sessionData.repliedToMessage) {
                    // Tablica losowych odpowiedzi
                    const responses = [
                        '**Nie leć w chuja, kliknij przycisk i bij tego bossa xD**',
                        '**Skończ to pierdolenie, kliknij przycisk i lej tego bossa xD**',
                        '**Ale Ty dupisz, weź kliknij ten przycisk i nadupcaj bossa, a nie xD**',
                        '**Weź nie pierdol tylko zbij tego bossa xD Nie zapomnij kliknąć potwierdzenia powyżej ;)**',
                        '**Bla, bla, bla xD Nakurwiaj bossa, a nie jakieś kocopoły mi tu piszesz. Tak poza tym, potwierdź odbiór wiadomości ;)**',
                        '**Ta, a krowy latają... Potwierdź komunikat i nakurwiaj bossa xD**',
                        '**Zwal bossa, a później możesz sobie tu pierdolić co chcesz xD Przy okazji kliknij potwierdzenie odbioru ;)**'
                    ];

                    // Wybierz losową odpowiedź
                    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

                    // Wyślij odpowiedź
                    await message.reply(randomResponse);

                    // Oznacz że użytkownik już dostał odpowiedź
                    await reminderService.markReminderDMAsReplied(userId);

                    logger.info(`[REMINDER-DM] 💬 Wysłano odpowiedź do użytkownika (losowa #${responses.indexOf(randomResponse) + 1})`);
                } else {
                    logger.info(`[REMINDER-DM] 🔇 Użytkownik już dostał odpowiedź - pomijam`);
                }
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

    // ============ OBSŁUGA AI CHAT (MENTION @Stalker) ============
    if (message.mentions.has(client.user) && message.guild) {
        // Ignoruj wzmianki przez role bota
        if (!message.mentions.users.has(client.user.id)) {
            return;
        }

        // Ignoruj @everyone i @here
        if (message.mentions.everyone) {
            return;
        }

        // Ignoruj odpowiedzi na wiadomości bota
        if (message.reference) {
            try {
                const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (repliedMessage.author.id === client.user.id) {
                    return;
                }
            } catch (error) {
                // Jeśli nie można pobrać wiadomości, kontynuuj normalnie
            }
        }

        try {
            // Wyciągnij pytanie (usuń mention)
            const question = message.content
                .replace(/<@!?\d+>/g, '')
                .trim();

            // Jeśli puste pytanie
            if (!question) {
                await message.reply('🤖 Cześć! Zadaj mi pytanie o graczy, statystyki lub klan!\n\n**Przykłady:**\n• Porównaj mnie z @gracz\n• Jak wygląda mój progres?\n• Kto jest najlepszy w moim klanie?\n• Jakie mam statystyki?');
                return;
            }

            // Sprawdź długość pytania
            if (question.length > 300) {
                await message.reply('🚫 Pytanie za długie! Maksymalnie 300 znaków.');
                return;
            }

            // Sprawdź kanał - AI Chat działa tylko na wybranym kanale (admini bez ograniczeń)
            const AI_CHAT_CHANNEL_ID = '1464709857545552146';
            const isAdmin = aiChatService.isAdmin(message.member);

            if (message.channel.id !== AI_CHAT_CHANNEL_ID && !isAdmin) {
                await message.reply(`🚫 AI Chat jest dostępny tylko na kanale <#${AI_CHAT_CHANNEL_ID}>!`);
                return;
            }

            // Sprawdź czy użytkownik ma rolę klanową
            const clanRoles = Object.values(config.targetRoles);
            const hasClanRole = message.member.roles.cache.some(role => clanRoles.includes(role.id));

            if (!hasClanRole) {
                await message.reply('🚫 Tylko członkowie klanów mogą korzystać z AI Chat!');
                return;
            }

            // Sprawdź cooldown
            const canAsk = aiChatService.canAsk(message.author.id, message.member);

            if (!canAsk.allowed) {
                if (canAsk.reason === 'cooldown') {
                    await message.reply(`⏱️ Hej, daj mi chwilę! Możesz zadać kolejne pytanie za **${canAsk.remainingMinutes} min**.`);
                }
                return;
            }

            // Pokaż typing indicator
            await message.channel.sendTyping();

            // Zapisz że użytkownik zadał pytanie (cooldown + daily limit)
            // Administratorzy nie mają limitów - statystyki nie są zapisywane
            aiChatService.recordAsk(message.author.id, message.member);

            // Zadaj pytanie AI
            const answer = await aiChatService.ask(message, question);

            // Odpowiedz
            await message.reply(answer);

        } catch (error) {
            logger.error(`❌ Błąd AI Chat: ${error.message}`);
            try {
                await message.reply('⚠️ Wystąpił błąd podczas przetwarzania pytania. Spróbuj ponownie.');
            } catch (replyError) {
                logger.error(`❌ Nie można wysłać odpowiedzi o błędzie: ${replyError.message}`);
            }
        }
        return; // Nie przetwarzaj dalej jeśli to było pytanie AI
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

    // ============ ODPOWIEDŹ NA "KALKULATOR" ============
    if (message.guild && message.content.toLowerCase().includes('kalkulator')) {
        const now = Date.now();
        const lastUsed = calculatorCooldowns.get(message.channelId) || 0;
        const COOLDOWN_MS = 60 * 60 * 1000; // 1 godzina

        if (now - lastUsed >= COOLDOWN_MS) {
            try {
                await message.channel.send('https://sio-tools.vercel.app/ <:PFrogMaszRacje:1341894087598669985>');
                calculatorCooldowns.set(message.channelId, now);
                logger.info(`[KALKULATOR] 🧮 Odpowiedź na kanale #${message.channel.name} (trigger: ${message.author.tag})`);
            } catch (error) {
                logger.error(`[KALKULATOR] ❌ Błąd wysyłania odpowiedzi: ${error.message}`);
            }
        }
    }

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

async function refreshMemberCache() {
    try {
        logger.info('Odświeżanie cache\'u członków');
        
        let totalMembers = 0;
        let guildsProcessed = 0;
        
        for (const guild of client.guilds.cache.values()) {
            try {
                logger.info(`🏰 Przetwarzanie serwera: ${guild.name} (${guild.id})`);
                
                // Odśwież cache dla wszystkich członków serwera
                // Dodaj opóźnienie między fetchami aby uniknąć rate limitów Gateway (opcode 8)
                if (guildsProcessed > 0) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5s przerwy między serwerami
                }

                const members = await safeFetchMembers(guild, logger);
                
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