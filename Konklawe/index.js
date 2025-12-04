const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import konfiguracji
const config = require('./config/config');

// Import serwisów
const DataService = require('./services/dataService');
const GameService = require('./services/gameService');
const TimerService = require('./services/timerService');
const RankingService = require('./services/rankingService');
const CommandService = require('./services/commandService');
const PasswordEmbedService = require('./services/passwordEmbedService');
const ScheduledHintsService = require('./services/scheduledHintsService');
const JudgmentService = require('./services/judgmentService');

// Import handlerów
const InteractionHandler = require('./handlers/interactionHandlers');
const MessageHandler = require('./handlers/messageHandlers');
const { createBotLogger } = require('../utils/consoleLogger');
const NicknameManager = require('../utils/nicknameManagerService');

const logger = createBotLogger('Konklawe');

// Klient Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// Inicjalizacja serwisów
let dataService, gameService, timerService, rankingService, commandService, nicknameManager, passwordEmbedService, scheduledHintsService, judgmentService;
let interactionHandler, messageHandler;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    dataService = new DataService();

    // Najpierw utwórz serwisy podstawowe
    gameService = new GameService(config, dataService);
    timerService = new TimerService(config, gameService);
    rankingService = new RankingService(config, gameService);
    commandService = new CommandService(config);

    // Utwórz scheduledHintsService (wymaga gameService, timerService, passwordEmbedService)
    // passwordEmbedService będzie ustawiony później
    scheduledHintsService = new ScheduledHintsService(config, gameService, timerService, null);

    // Utwórz passwordEmbedService z scheduledHintsService
    passwordEmbedService = new PasswordEmbedService(config, gameService, scheduledHintsService);

    // Ustaw passwordEmbedService w scheduledHintsService
    scheduledHintsService.passwordEmbedService = passwordEmbedService;

    // Inicjalizacja centralnego systemu zarządzania nickami
    nicknameManager = new NicknameManager();
    await nicknameManager.initialize();

    // Ustawienie klienta w serwisach
    timerService.setClient(client);
    passwordEmbedService.setClient(client);
    scheduledHintsService.setClient(client);
    timerService.setPasswordEmbedService(passwordEmbedService);

    // Ustaw scheduledHintsService w gameService
    gameService.setScheduledHintsService(scheduledHintsService);

    // Inicjalizacja JudgmentService
    judgmentService = new JudgmentService(config);

    // Inicjalizacja handlerów z wszystkimi serwisami
    interactionHandler = new InteractionHandler(config, gameService, rankingService, timerService, nicknameManager, passwordEmbedService, scheduledHintsService, judgmentService);
    messageHandler = new MessageHandler(config, gameService, rankingService, timerService, passwordEmbedService, scheduledHintsService);

    // Inicjalizacja danych gry
    gameService.initializeGameData();

    // Sprawdź przegapione podpowiedzi przy starcie
    await scheduledHintsService.checkMissedHints();
}

/**
 * Obsługuje zdarzenie ready
 */
async function onReady() {
    logger.success('✅ Konklawe gotowy - gra w hasła, błogosławienia JP2');
    await commandService.registerSlashCommands();

    // Przywróć nicki dla wygasłych klątw (efektów które wygasły podczas offline bota)
    try {
        const result = await nicknameManager.restoreExpiredEffects(client);
        if (result.restored > 0) {
            logger.info(`✅ Przywrócono ${result.restored} nicków po restarcie bota`);
        }
    } catch (error) {
        logger.error('❌ Błąd przywracania wygasłych efektów:', error);
    }

    try {
        const commandChannel = await client.channels.fetch(config.channels.command);
        const triggerChannel = await client.channels.fetch(config.channels.trigger);

        // Sprawdź czy hasło powinno być automatycznie przywrócone
        if (gameService.trigger === null && gameService.triggerClearedTimestamp) {
            const timeSinceCleared = new Date() - gameService.triggerClearedTimestamp;
            if (timeSinceCleared >= gameService.AUTO_RESET_TIME) {
                gameService.resetToDefaultPassword();

                try {
                    const guild = client.guilds.cache.first();
                    if (guild) {
                        await timerService.removeRoleFromAllMembers(guild, config.roles.papal);
                    }
                } catch (error) {
                    logger.error('❌ Błąd podczas usuwania ról papieskich:', error);
                }

            }
        }

        // Inicjalizacja embeda na kanale trigger
        if (triggerChannel && triggerChannel.isTextBased()) {
            await passwordEmbedService.initializeEmbed();
            logger.info('✅ Zainicjalizowano embed statusu hasła');
        }

        // Inicjalizacja embeda Sądu Bożego
        judgmentService.setClient(client);
        await judgmentService.initializeJudgmentEmbed();
        logger.info('✅ Zainicjalizowano embed Sądu Bożego');

        // Ustawienie odpowiednich timerów
        if (gameService.trigger === null) {
            // Brak hasła - ustaw timery od początku
            await timerService.setAutoResetTimer();

            // Znajdź papieża i ustaw timer przypomnienia
            try {
                const guild = client.guilds.cache.first();
                if (guild) {
                    await guild.members.fetch();
                    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(config.roles.papal));
                    if (membersWithRole.size > 0) {
                        const papalMember = membersWithRole.first();
                        await timerService.setReminderTimer(papalMember.user.id);
                        logger.info(`⏰ Ustawiono timer przypomnienia dla papieża ${papalMember.user.tag}`);
                    }
                }
            } catch (error) {
                logger.error('❌ Błąd podczas ustawiania timera przypomnienia:', error);
            }
        } else {
            // Przywróć timery przypominania po restarcie z opóźnieniem
            setTimeout(async () => {
                await timerService.restoreRemindersAfterRestart();
            }, 2000); // 2 sekundy opóźnienia aby guild i kanały były gotowe
        }

        // Loguj szczegółowe statystyki Gabriela i Lucyfera
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('📊 STATYSTYKI GABRIELA I LUCYFERA - SĄD BOŻY');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');
        logger.info('☁️  GABRIEL - ŚWIĘTY ANIOŁ');
        logger.info('───────────────────────────────────────────────────────────────');
        logger.info('🙏 BŁOGOSŁAWIEŃSTWA (/blessing):');
        logger.info('   • Cooldown: 5 minut per cel');
        logger.info('   • Brak dziennego limitu');
        logger.info('   • 50% szans na usunięcie klątwy przy błogosławieństwie');
        logger.info('   • 1% szans: nałożenie potężnej klątwy na Lucyfera (24h debuff)');
        logger.info('');
        logger.info('💀 KLĄTWY (/curse) NA ZWYKŁYCH CELACH:');
        logger.info('   • Limit: 10 dziennie');
        logger.info('   • Cooldown: 5 minut');
        logger.info('   • 79% - Sukces (klątwa nałożona)');
        logger.info('   • 20% - Fail (klątwa się nie powiodła)');
        logger.info('   • 1% - Odbicie (klątwa wraca do Gabriela)');
        logger.info('');
        logger.info('⚔️  KLĄTWY NA LUCYFERA - 4 SCENARIUSZE:');
        logger.info('   • 33% - Reset odbicia Lucyfera do 0%');
        logger.info('   • 33% - Odporność (nic się nie dzieje)');
        logger.info('   • 33% - Zwykła klątwa (5 minut)');
        logger.info('   • 1% - POTĘŻNA KLĄTWA:');
        logger.info('        - Natychmiastowa klątwa (5 min)');
        logger.info('        - 24h debuff (10% szans co wiadomość na nową klątwę)');
        logger.info('');
        logger.info('🛡️  OBRONA PRZED LUCYFEREM:');
        logger.info('   • 100% odbicie klątw Lucyfera');
        logger.info('   • Lucyfer przeklina sam siebie');
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');
        logger.info('🔥 LUCYFER - UPADŁY ANIOŁ');
        logger.info('───────────────────────────────────────────────────────────────');
        logger.info('💀 KLĄTWY (/curse):');
        logger.info('   • Brak dziennego limitu');
        logger.info('   • Cooldown: 5 minut per cel');
        logger.info('   • Może rzucać na różne osoby równocześnie');
        logger.info('');
        logger.info('📈 PROGRESYWNE ODBICIE:');
        logger.info('   • Start: 0% dziennie');
        logger.info('   • +1% za każdą rzuconą klątwę');
        logger.info('   • Reset o północy (strefa polska)');
        logger.info('');
        logger.info('⚠️  KARA ZA ODBICIE:');
        logger.info('   • Godzinna kara (60 minut)');
        logger.info('   • Blokada /curse przez godzinę');
        logger.info('   • 12 losowych klątw (co 5 minut)');
        logger.info('');
        logger.info('🛡️  ATAK NA GABRIELA:');
        logger.info('   • 100% odbicie - klątwa wraca do Lucyfera');
        logger.info('   • Lucyfer przeklina sam siebie (5 min)');
        logger.info('');
        logger.info('⚡ GABRIEL DEBUFF (24 GODZINY):');
        logger.info('   • Nakładany przy 1% szansy przez Gabriela');
        logger.info('   • Faza 1 (5 min): Natychmiastowa klątwa');
        logger.info('   • Faza 2 (23h 55min): 10% szans co wiadomość na nową klątwę');
        logger.info('   • 7 typów losowych klątw (slow_mode, auto_delete, random_ping,');
        logger.info('     emoji_spam, forced_caps, random_timeout, special_role)');
        logger.info('');
        logger.info('⛔ OGRANICZENIA:');
        logger.info('   • BRAK możliwości błogosławienia');
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('⚖️  SĄD BOŻY - WARUNKI DOSTĘPU');
        logger.info('───────────────────────────────────────────────────────────────');
        logger.info('   • Wymaga medalu Virtutti Papajlari (30+ punktów)');
        logger.info('   • Wybór jednej frakcji usuwa medal');
        logger.info('   • Wybierający → wybrana frakcja');
        logger.info('   • Wybrana osoba → przeciwna frakcja');
        logger.info('   • Komenda /reset-all (admin) usuwa wszystkie role specjalne');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');

    } catch (error) {
        logger.error('❌ Błąd podczas uruchamiania bota:', error);
    }
}

/**
 * Obsługuje interakcje
 * @param {Interaction} interaction - Interakcja Discord
 */
async function onInteraction(interaction) {
    try {
        if (interaction.isButton()) {
            await interactionHandler.handleButtonInteraction(interaction);
        } else if (interaction.isChatInputCommand()) {
            await interactionHandler.handleSlashCommand(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await interactionHandler.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await interactionHandler.handleModalSubmit(interaction);
        }
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
        
        try {
            const { MessageFlags } = require('discord.js');
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
            logger.error('❌ Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
}

/**
 * Obsługuje wiadomości
 * @param {Message} message - Wiadomość Discord
 */
async function onMessage(message) {
    await messageHandler.handleMessage(message, interactionHandler);
}

/**
 * Konfiguruje event handlery
 */
function setupEventHandlers() {
    client.once('ready', onReady);
    client.on('interactionCreate', onInteraction);
    client.on('messageCreate', onMessage);
}

/**
 * Uruchamia bota
 */
async function start() {
    try {
        await initializeServices();
        setupEventHandlers();
        await client.login(config.token);
    } catch (error) {
        logger.error('❌ Błąd podczas uruchamiania bota:', error);
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