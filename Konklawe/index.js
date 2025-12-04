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
        logger.info('📊 STATYSTYKI GABRIELA I LUCYFERA - SĄD BOŻY (NOWY SYSTEM)');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');
        logger.info('⚡ SYSTEM MANY (DLA OBUICH):');
        logger.info('───────────────────────────────────────────────────────────────');
        logger.info('   • Start: 300 many');
        logger.info('   • Regeneracja: 10 pkt/godzinę');
        logger.info('   • Koszt blessing: 5 many');
        logger.info('   • Koszt curse: 10 + (klątwy dzisiaj × 2) many');
        logger.info('   • Naturalny limit: ~8-10 klątw dziennie');
        logger.info('');
        logger.info('🎲 POZIOMY KLĄTW (DLA OBUICH):');
        logger.info('   • 💀 Zwykła (96%): 5 minut');
        logger.info('   • ⚡ Silna (3%): 15 minut (jedna klątwa zmieniana co 5 min)');
        logger.info('   • 💥 Potężna (1%): 30 minut (combo efektów zmieniane co 5 min)');
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');
        logger.info('☁️  GABRIEL - ŚWIĘTY ANIOŁ');
        logger.info('───────────────────────────────────────────────────────────────');
        logger.info('🙏 BŁOGOSŁAWIEŃSTWA (/blessing):');
        logger.info('   • Koszt: 5 many');
        logger.info('   • Cooldown: 5 minut per cel');
        logger.info('   • Brak dziennego limitu');
        logger.info('   • 50% szans na usunięcie klątwy');
        logger.info('   • 1% szans: SILNA klątwa na Lucyfera (1h, zmiana co 5 min)');
        logger.info('');
        logger.info('💀 KLĄTWY (/curse) NA ZWYKŁYCH CELACH:');
        logger.info('   • Koszt: progresywny (10 + klątwy × 2)');
        logger.info('   • Cooldown: 5 minut per target');
        logger.info('   • 85% - Sukces (klątwa nałożona)');
        logger.info('   • 15% - Fail (klątwa się nie powiodła, zwrot 50% many)');
        logger.info('   • 0% - Odbicie (brak odbicia)');
        logger.info('');
        logger.info('⚔️  KLĄTWY NA LUCYFERA - 4 SCENARIUSZE:');
        logger.info('   • 33% - Reset odbicia Lucyfera do 0%');
        logger.info('   • 33% - Odporność (nic się nie dzieje)');
        logger.info('   • 33% - Zwykła klątwa (3-30 min losowo)');
        logger.info('   • 1% - Odbicie (obie klątwy wracają na siebie)');
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
        logger.info('   • Koszt: progresywny (10 + klątwy × 2)');
        logger.info('   • Cooldown: 5 minut per cel');
        logger.info('   • Brak dziennego limitu (tylko mana)');
        logger.info('');
        logger.info('📈 PROGRESYWNE ODBICIE (NOWY SYSTEM):');
        logger.info('   • Start: 3% dziennie');
        logger.info('   • +3% za każdą rzuconą klątwę (3%, 6%, 9%...)');
        logger.info('   • Reset o północy (strefa polska)');
        logger.info('');
        logger.info('⚠️  KARA ZA ODBICIE (NOWY SYSTEM):');
        logger.info('   • Blokada /curse na 1 godzinę');
        logger.info('   • Nick zmieniony na "Osłabiony [nick]" (1h)');
        logger.info('   • BEZ klątwy na siebie!');
        logger.info('');
        logger.info('🛡️  ATAK NA GABRIELA:');
        logger.info('   • 100% odbicie - klątwa wraca do Lucyfera');
        logger.info('   • Lucyfer przeklina sam siebie');
        logger.info('');
        logger.info('⚡ SILNA KLĄTWA GABRIELA (1% przy blessing):');
        logger.info('   • Czas trwania: 1 godzina');
        logger.info('   • Zmiana klątwy co 5 minut (12 total)');
        logger.info('   • 7 typów losowych klątw');
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