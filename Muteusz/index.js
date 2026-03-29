const { Client, GatewayIntentBits, Events, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const config = require('./config/config');
const { createBotLogger } = require('../utils/consoleLogger');
const NicknameManager = require('../utils/nicknameManagerService');

const PLAYER_WELCOME_GIF_PATH = path.join(__dirname, 'data', 'player_welcome.gif');

const logger = createBotLogger('Muteusz');

const MediaService = require('./services/mediaService');
const LogService = require('./services/logService');
const SpecialRolesService = require('./services/specialRolesService');
const RoleManagementService = require('./services/roleManagementService');
const RoleKickingService = require('./services/roleKickingService');
const ReactionRoleService = require('./services/reactionRoleService');
const RoleConflictService = require('./services/roleConflictService');
const MemberCacheService = require('./services/memberCacheService');
const ChaosService = require('./services/chaosService');
const PrimaAprilisService = require('./services/primaAprilisService');
const BombTimerService = require('./services/bombTimerService');
const ButtonOrderService = require('./services/buttonOrderService');
const ReactionPuzzleService = require('./services/reactionPuzzleService');
const EmptyPuzzleService = require('./services/emptyPuzzleService');
const EchoPuzzleService = require('./services/echoPuzzleService');
const HotPotatoService = require('./services/hotPotatoService');
const BoosterSnapshotService = require('./services/boosterSnapshotService');
const GameCountdownService = require('./services/gameCountdownService');
const PuzzleChainService = require('./services/puzzleChainService');

const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const MemberHandler = require('./handlers/memberHandlers');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.GuildMember,
        Partials.User
    ]
});

const specialRolesService = new SpecialRolesService(config);
const roleManagementService = new RoleManagementService(config, specialRolesService);
const mediaService = new MediaService(config);
const logService = new LogService(config);
const roleKickingService = new RoleKickingService(config);
const roleConflictService = new RoleConflictService(config);
const memberCacheService = new MemberCacheService(config);
const chaosService = new ChaosService(config, logService);
const primaAprilisService = new PrimaAprilisService(config);
const bombTimerService = new BombTimerService(config);
const buttonOrderService = new ButtonOrderService(config);
const reactionPuzzleService = new ReactionPuzzleService(config);
const emptyPuzzleService = new EmptyPuzzleService(config);
const echoPuzzleService = new EchoPuzzleService(config);
const hotPotatoService = new HotPotatoService(config);
const boosterSnapshotService = new BoosterSnapshotService();
const gameCountdownService = new GameCountdownService();
const puzzleChainService = new PuzzleChainService();
bombTimerService.gameCountdownService = gameCountdownService;
bombTimerService.boosterSnapshotService = boosterSnapshotService;
boosterSnapshotService.onSnapshotChange = () => bombTimerService.refreshControlPanel();

let nicknameManager;
let reactionRoleService;

// Flaga gotowości bota - ustawiona po pełnej inicjalizacji
let isFullyInitialized = false;

const messageHandler = new MessageHandler(config, mediaService, logService, chaosService);
const interactionHandler = new InteractionHandler(config, logService, specialRolesService, messageHandler, roleKickingService, chaosService, primaAprilisService, bombTimerService, buttonOrderService, reactionPuzzleService, emptyPuzzleService, echoPuzzleService, hotPotatoService, boosterSnapshotService, gameCountdownService);
const memberHandler = new MemberHandler(config, logService, specialRolesService, roleManagementService, roleConflictService, memberCacheService);

const sharedState = {
    client,
    config,
    specialRolesService,
    roleManagementService,
    mediaService,
    logService,
    reactionRoleService,
    roleConflictService,
    memberCacheService,
    interactionHandler,
    messageHandler,
    memberHandler
};

// Kanały z auto-czyszczeniem wiadomości/reakcji/wątków nie-adminów
const AUTO_CLEANUP_CHANNEL_IDS = new Set([
    '1486919971165442048', // countdown
    '1486500418358870074', // prima aprilis
]);

async function isAdminMember(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return member.permissions.has(PermissionFlagsBits.Administrator);
    } catch {
        return false;
    }
}

client.once(Events.ClientReady, async () => {
    await logService.logMessage('success', `Bot ${client.user.tag} jest online!`);
    
    // Załaduj członków do cache
    try {
        let totalMembers = 0;
        for (const guild of client.guilds.cache.values()) {
            const members = await guild.members.fetch({ limit: 1000 });
            totalMembers += members.size;
        }
    } catch (cacheError) {
        logger.warn('⚠️ Nie udało się załadować członków:', cacheError.message);
    }
    
    // Inicjalizuj centralny system zarządzania nickami
    nicknameManager = new NicknameManager();
    await nicknameManager.initialize();

    // Przywróć nicki dla wygasłych efektów (klątwy z Konklawe)
    try {
        const result = await nicknameManager.restoreExpiredEffects(client);
        if (result.restored > 0) {
            logger.info(`✅ Przywrócono ${result.restored} nicków po restarcie bota (wygasłe efekty)`);
        }
    } catch (error) {
        logger.error('❌ Błąd przywracania wygasłych efektów:', error);
    }

    // Inicjalizuj reactionRoleService z nickname manager
    reactionRoleService = new ReactionRoleService(config, nicknameManager);
    
    // Inicjalizuj pozostałe serwisy
    logService.initialize(client);
    await mediaService.initialize();
    await roleKickingService.initialize(client);
    await reactionRoleService.initialize(client);
    await roleConflictService.initialize(client);
    await memberCacheService.initialize(client);
    // Inicjalizuj serwisy blokowania w messageHandlerze
    await messageHandler.initializeImageBlockService();
    await messageHandler.initializeWordBlockService();
    // Inicjalizuj ChaosService
    await chaosService.initialize();
    await chaosService.restoreTimeouts(client);

    // Inicjalizuj Prima Aprilis
    await primaAprilisService.initialize();

    // Inicjalizuj Bomb Timer
    await bombTimerService.initialize(client);

    // Inicjalizuj Button Order
    await buttonOrderService.initialize(client);
    await reactionPuzzleService.initialize(client);
    await emptyPuzzleService.initialize(client);
    await echoPuzzleService.initialize(client);
    await hotPotatoService.initialize(client);
    boosterSnapshotService.initialize(client);
    gameCountdownService.initialize(client);
    puzzleChainService.initialize(client);

    // Powiąż łańcuch zagadek: wygrana → odblokowanie następnego kanału
    echoPuzzleService.onWin    = () => puzzleChainService.onPuzzleSolved(0);
    buttonOrderService.onWin   = () => puzzleChainService.onPuzzleSolved(1);
    emptyPuzzleService.onWin   = () => puzzleChainService.onPuzzleSolved(2);
    reactionPuzzleService.onWin = () => puzzleChainService.onPuzzleSolved(3);
    hotPotatoService.onWin = async () => {
        const guild = client.guilds.cache.first();
        // Zatrzymaj countdown gry
        await gameCountdownService.stop().catch(() => {});
        // Rozbrój bombę jeśli aktywna
        await bombTimerService.forceDefuse().catch(() => {});
        // Wyślij wiadomość zwycięstwa na kanał countdown
        try {
            const victoryChannel = await client.channels.fetch('1486919971165442048');
            await victoryChannel.send('@everyone\n# Serwer został uratowany! Gratulacje! <a:PepeOklaski:1259556219312410760>');
        } catch (err) {
            logger.error('❌ Błąd wysyłania wiadomości zwycięstwa:', err.message);
        }
        // Dezaktywuj przycisk NIE KLIKAĆ
        await primaAprilisService.disableTrapButton().catch(() => {});
        // Zwolnij wszystkich uwięzionych graczy w kolejności
        if (guild) await primaAprilisService.freeAllTrapped(guild).catch(() => {});
        // Odśwież panel kontrolny
        await bombTimerService.refreshControlPanel().catch(() => {});
    };

    // Rejestruj komendy na końcu (może blokować startup)
    await interactionHandler.registerSlashCommands(client);

    // Oznacz bota jako w pełni zainicjalizowanego
    isFullyInitialized = true;

    // Wyślij/odśwież wiadomość z przyciskiem do zgłaszania
    await setupReportButtonMessage(client, config);

    // Wyślij/odśwież wiadomość Prima Aprilis
    await primaAprilisService.setupButtonMessage(client);
    await primaAprilisService.setupPasswordMessage(client);

    // Wyślij/odśwież panel kontrolny Bomb Timer
    await bombTimerService.setupControlMessage(client);

    logger.success('✅ Muteusz gotowy - moderacja, media (100MB), zarządzanie rolami, blokowanie obrazów i słów, Chaos Mode, system zgłoszeń, Prima Aprilis, Bomb Timer');
});

client.on(Events.MessageCreate, async (message) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        return;
    }

    // Auto-czyszczenie: usuń wiadomości nie-adminów na wybranych kanałach
    if (!message.author.bot && message.guild && AUTO_CLEANUP_CHANNEL_IDS.has(message.channelId)) {
        const admin = await isAdminMember(message.guild, message.author.id);
        if (!admin) {
            await message.delete().catch(() => {});
            return;
        }
    }

    // Prima Aprilis: sprawdzanie hasła przez uwięzionych użytkowników
    if (!message.author.bot && message.guild && primaAprilisService.isTrapped(message.author.id)) {
        try {
            const member = await message.guild.members.fetch(message.author.id);
            await primaAprilisService.tryPassword(member, message.content);
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy sprawdzaniu hasła:', error.message);
        }
        return;
    }

    if (!message.author.bot && message.guild) {
        bombTimerService.handleMessageCreate(message).catch(err =>
            logger.error('❌ BombTimer: błąd handleMessageCreate:', err.message)
        );
        reactionPuzzleService.handleMessageCreate(message).catch(err =>
            logger.error('❌ ReactionPuzzle: błąd handleMessageCreate:', err.message)
        );
        emptyPuzzleService.handleMessageCreate(message).catch(err =>
            logger.error('❌ EmptyPuzzle: błąd handleMessageCreate:', err.message)
        );
        echoPuzzleService.handleMessageCreate(message).catch(err =>
            logger.error('❌ EchoPuzzle: błąd handleMessageCreate:', err.message)
        );
        buttonOrderService.handleMessageCreate(message).catch(err =>
            logger.error('❌ ButtonOrder: błąd handleMessageCreate:', err.message)
        );
        hotPotatoService.handleMessageCreate(message).catch(err =>
            logger.error('❌ HotPotato: błąd handleMessageCreate:', err.message)
        );
    }

    await messageHandler.handleMessage(message, client);
});

client.on(Events.MessageDelete, async (message) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        return;
    }
    await mediaService.handleDeletedMessage(message, client);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        return;
    }
    await mediaService.handleEditedMessage(oldMessage, newMessage, client);
});

client.on(Events.GuildMemberAdd, async (member) => {
    if (!isFullyInitialized) return;

    // Prima Aprilis: jeśli uwięziony gracz wrócił na serwer, przywróć rolę gracza
    if (primaAprilisService.isTrapped(member.id)) {
        try {
            await primaAprilisService.handleMemberRejoin(member);
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy powrocie gracza na serwer:', error.message);
        }
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    if (!isFullyInitialized) return;
    try {
        await primaAprilisService.handleMemberLeave(member);
    } catch (error) {
        logger.error('❌ PrimaAprilis: błąd przy opuszczeniu serwera przez gracza:', error.message);
    }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        logger.warn('⚠️ Ignoruję GuildMemberUpdate - bot jeszcze się inicjalizuje');
        return;
    }

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

    // Rola gracza: ping + GIF gdy ktoś dostanie rolę
    const PLAYER_ROLE_ID = '1486506395057524887';
    const PLAYER_WELCOME_CHANNEL_ID = '1486848827997818900';
    const hadRole = oldMember.roles.cache.has(PLAYER_ROLE_ID);
    const hasRole = newMember.roles.cache.has(PLAYER_ROLE_ID);
    if (!hadRole && hasRole) {
        try {
            const channel = await client.channels.fetch(PLAYER_WELCOME_CHANNEL_ID);
            const msgData = { content: `<@${newMember.id}>` };
            if (fs.existsSync(PLAYER_WELCOME_GIF_PATH)) {
                msgData.files = [new AttachmentBuilder(PLAYER_WELCOME_GIF_PATH, { name: 'welcome.gif' })];
            }
            await channel.send(msgData);
        } catch (err) {
            logger.error('❌ Błąd pinga nowego gracza:', err.message);
        }
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    // Guard: Informuj użytkownika jeśli bot jeszcze się inicjalizuje
    if (!isFullyInitialized) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '⏳ Bot jeszcze się inicjalizuje, spróbuj za chwilę...',
                    ephemeral: true
                });
            }
        } catch (error) {
            logger.error('❌ Nie można odpowiedzieć na interakcję podczas inicjalizacji:', error.message);
        }
        return;
    }

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

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        return;
    }

    try {
        // Discord może wymagać fetchowania partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                logger.error('❌ Nie można pobrać partial reaction:', error);
                return;
            }
        }

        // Auto-czyszczenie: usuń reakcje nie-adminów na wybranych kanałach
        if (!user.bot && reaction.message.guild && AUTO_CLEANUP_CHANNEL_IDS.has(reaction.message.channelId)) {
            const admin = await isAdminMember(reaction.message.guild, user.id);
            if (!admin) {
                await reaction.users.remove(user.id).catch(() => {});
                return;
            }
        }

        await reactionRoleService.handleReactionAdd(reaction, user);
        await bombTimerService.handleReactionAdd(reaction, user);
        await reactionPuzzleService.handleReactionAdd(reaction, user);
        await emptyPuzzleService.handleReactionAdd(reaction, user);
        await buttonOrderService.handleReactionAdd(reaction, user);
        await hotPotatoService.handleReactionAdd(reaction, user);
    } catch (error) {
        logger.error('❌ Błąd w obsłudze reakcji (add):', error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    // Guard: Ignoruj eventy dopóki bot nie jest w pełni zainicjalizowany
    if (!isFullyInitialized) {
        return;
    }

    try {
        // Discord może wymagać fetchowania partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                logger.error('❌ Nie można pobrać partial reaction:', error);
                return;
            }
        }

        await reactionRoleService.handleReactionRemove(reaction, user);
        await bombTimerService.handleReactionRemove(reaction, user);
    } catch (error) {
        logger.error('❌ Błąd w obsłudze reakcji (remove):', error);
    }
});

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

process.on('SIGINT', async () => {
    if (logService && logService.logMessage) {
        await logService.logMessage('info', 'Zamykanie bota...');
    } else {
        logger.info('Zamykanie bota...');
    }
    
    if (config.media.autoCleanup && mediaService) {
        await mediaService.cleanupAllCache();
    }
    
    // Wyczyść timery reaction roles i role conflicts
    reactionRoleService.cleanup();
    roleConflictService.cleanup();
    await memberCacheService.cleanup();
    bombTimerService.cleanup();
    primaAprilisService.cleanup();

    // Wyczyść ImageBlockService
    if (messageHandler.imageBlockService) {
        await messageHandler.imageBlockService.shutdown();
    }
    
    // Wyczyść WordBlockService
    if (messageHandler.wordBlockService) {
        await messageHandler.wordBlockService.shutdown();
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
        
        // Wyczyść timery reaction roles i role conflicts
        reactionRoleService.cleanup();
        roleConflictService.cleanup();
        await memberCacheService.cleanup();
        bombTimerService.cleanup();
    primaAprilisService.cleanup();

        // Wyczyść ImageBlockService
        if (messageHandler.imageBlockService) {
            await messageHandler.imageBlockService.shutdown();
        }

        // Wyczyść WordBlockService
        if (messageHandler.wordBlockService) {
            await messageHandler.wordBlockService.shutdown();
        }

        client.destroy();
        logger.info('Bot został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota: ${error.message}`);
        process.exit(1);
    }
});

/**
 * Wysyła lub aktualizuje wiadomość z przyciskiem do zgłaszania naruszeń na dedykowanym kanale.
 * Przy starcie bota sprawdza czy wiadomość już istnieje - jeśli tak, pomija.
 */
async function setupReportButtonMessage(client, config) {
    const channelId = config.reports?.buttonChannelId;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        // Sprawdź czy wiadomość z przyciskiem już istnieje (szukaj wśród ostatnich 50 wiadomości bota)
        const messages = await channel.messages.fetch({ limit: 50 });
        const existing = messages.find(msg =>
            msg.author.id === client.user.id &&
            msg.components?.length > 0 &&
            msg.components[0]?.components?.[0]?.customId === 'report_start_button'
        );

        if (existing) {
            logger.info('ℹ️ Wiadomość z przyciskiem zgłoszenia już istnieje na kanale, pomijam.');
            return;
        }

        const button = new ButtonBuilder()
            .setCustomId('report_start_button')
            .setLabel('Zgłoś wypowiedź naruszającą zasady na serwerze')
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ id: '1341086085089857619', name: 'PepeAlarmMan', animated: true });

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({ components: [row] });
        logger.success('✅ Wysłano wiadomość z przyciskiem zgłoszenia na kanale');
    } catch (error) {
        logger.error('❌ Nie można wysłać wiadomości z przyciskiem zgłoszenia:', error.message);
    }
}

client.on(Events.ThreadCreate, async (thread) => {
    if (!isFullyInitialized) return;
    const parentId = thread.parentId;
    if (!AUTO_CLEANUP_CHANNEL_IDS.has(parentId)) return;
    try {
        const guild = thread.guild;
        const admin = await isAdminMember(guild, thread.ownerId);
        if (!admin) await thread.delete().catch(() => {});
    } catch (err) {
        logger.error('❌ AutoCleanup: błąd usuwania wątku:', err.message);
    }
});

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
        
        // Wyczyść timery reaction roles i role conflicts
        reactionRoleService.cleanup();
        roleConflictService.cleanup();
        await memberCacheService.cleanup();
        
        // Wyczyść ImageBlockService
        if (messageHandler.imageBlockService) {
            await messageHandler.imageBlockService.shutdown();
        }
        
        // Wyczyść WordBlockService
        if (messageHandler.wordBlockService) {
            await messageHandler.wordBlockService.shutdown();
        }
        
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
    
    // Dla kompatybilności z głównym launcherem
    start: startBot,
    stop: stopBot
};

if (require.main === module) {
    startBot().catch(error => {
        logger.error('❌ Błąd uruchamiania bota:', error.message);
        process.exit(1);
    });
}