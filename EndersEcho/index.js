const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const config = require('./config/config');
const GuildConfigService = require('./services/guildConfigService');

// Telemetry init ma się wykonać po require('./config/config'), bo dopiero ten
// require woła dotenv.config() i wrzuca LANGFUSE_* do process.env. Tracery są
// pobierane leniwie przy pierwszym spanie (z handlera interakcji), więc SDK
// nie musi być zainicjowane wcześniej niż reszta modułów — nie używamy
// auto-instrumentacji, która by tego wymagała.
const telemetry = require('../utils/telemetry');
telemetry.init('endersecho-bot');

const OCRService = require('./services/ocrService');
const AIOCRService = require('./services/aiOcrService');
const RankingService = require('./services/rankingService');
const LogService = require('./services/logService');
const GuildLogger = require('./services/guildLogger');
const RoleService = require('./services/roleService');
const NotificationService = require('./services/notificationService');
const UserBlockService = require('./services/userBlockService');
const TesterService = require('./services/testerService');
const RoleRankingConfigService = require('./services/roleRankingConfigService');
const UsageLimitService = require('./services/usageLimitService');
const { TokenUsageService } = require('./services/tokenUsageService');
const { UpdateCooldownService } = require('./services/updateCooldownService');
const InteractionHandler = require('./handlers/interactionHandlers');
const AchievementService = require('./services/achievementService');
const CommunityVerificationService = require('./services/communityVerificationService');
const GuildBanService = require('./services/guildBanService');
const ScoreHistoryService = require('./services/scoreHistoryService');
const dataMigration = require('./services/dataMigration');
const { fixBossNamesInData } = require('./fix-boss-names');
const GlobalTop10Service = require('./services/globalTop10Service');
const { BossAliasService } = require('./services/bossAliasService');
const OcrStatsService = require('./services/ocrStatsService');
const { generateScoreHistoryChart, generateGlobalPlayerGrowthChart, generatePerServerGrowthChart, generatePlayersProgressChart, generateGuildComparisonChart } = require('./services/chartService');
const { createBotLogger } = require('../utils/consoleLogger');
const KingBumChatService = require('./services/kingBumChatService');
const { createLlmAdapter } = require('../utils/llmAdapter');
const cron = require('node-cron');

const logger = createBotLogger('EndersEcho');

let statusInterval = null;

const STATUS_POOL = [
    { type: ActivityType.Watching, text: n => `Watching ${n}'s results 🏆` },
    { type: ActivityType.Watching, text: n => `Checking ${n}'s score 🔍` },
    { type: ActivityType.Watching, text: n => `Comparing ${n}'s ranking 📊` },
    { type: ActivityType.Watching, text: n => `Calculating ${n}'s stats 🧮` },
    { type: ActivityType.Watching, text: n => `Reviewing ${n}'s progress 📈` },
    { type: ActivityType.Watching, text: n => `Analyzing ${n}'s results 🎯` },
    { type: ActivityType.Watching, text: g => `Watching ${g}'s ranking 🏅`, needsGuild: true },
];

async function _updateStatus() {
    try {
        const template = STATUS_POOL[Math.floor(Math.random() * STATUS_POOL.length)];
        if (template.needsGuild) {
            const guildIds = guildConfigService.getAllConfiguredGuildIds()
                .filter(id => client.guilds.cache.has(id));
            if (!guildIds.length) return;
            const guildId = guildIds[Math.floor(Math.random() * guildIds.length)];
            const guildName = client.guilds.cache.get(guildId).name;
            client.user.setActivity(template.text(guildName), { type: template.type });
        } else {
            const players = await rankingService.getGlobalRanking();
            if (!players.length) return;
            const player = players[Math.floor(Math.random() * players.length)];
            const guild = client.guilds.cache.get(player.sourceGuildId);
            const member = guild?.members.cache.get(player.userId);
            const displayName = member?.displayName || player.username;
            client.user.setActivity(template.text(displayName), { type: template.type });
        }
    } catch { /* status to nice-to-have */ }
}
const llmAdapter = createLlmAdapter({ botSlug: 'endersecho', tracerName: 'endersecho-bot' });

const guildConfigService = new GuildConfigService(config.ranking.dataDir);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const bossAliasService = new BossAliasService();
const ocrService = new OCRService(config);
const aiOcrService = new AIOCRService(config, llmAdapter, bossAliasService);
const scoreHistoryService = new ScoreHistoryService(config.ranking.dataDir);
const chartService = { generateScoreHistoryChart, generateGlobalPlayerGrowthChart, generatePerServerGrowthChart, generatePlayersProgressChart, generateGuildComparisonChart };
const rankingService = new RankingService(config, scoreHistoryService);
const guildLogger = new GuildLogger(config);
const logService = new LogService(config, guildLogger);
const roleService = new RoleService(config, rankingService, logService);
const notificationService = new NotificationService(config);
const userBlockService = new UserBlockService(config);
const testerService = new TesterService(config);
const ocrBlockService = new (require('./services/ocrBlockService'))(guildConfigService);
const roleRankingConfigService = new RoleRankingConfigService(config);
const usageLimitService = new UsageLimitService(config);
const tokenUsageService = new TokenUsageService(config);
const updateCooldownService = new UpdateCooldownService(config);
const achievementService = new AchievementService(config);
const communityVerificationService = new CommunityVerificationService(config.ranking.dataDir);
const guildBanService = new GuildBanService(config.ranking.dataDir);
const globalTop10Service = new GlobalTop10Service(config.ranking.dataDir, rankingService, guildConfigService, config);
const ocrStatsService = new OcrStatsService(config.ranking.dataDir, logger);
const kingBumChatService = new KingBumChatService(config, rankingService);
const interactionHandler = new InteractionHandler(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, null, guildConfigService, ocrBlockService, updateCooldownService, testerService, achievementService, communityVerificationService, scoreHistoryService, chartService, guildBanService, globalTop10Service, bossAliasService, ocrStatsService);

/**
 * Inicjalizuje bota EndersEcho
 */
async function initializeBot() {
    try {
        // Migracja struktury folderów data/ → data/guilds/{guildId}/
        await dataMigration.migrate(config.ranking.dataDir);

        // Korekcja nazw bossów w istniejących danych (uwzględnia aliasy z boss_aliases.json)
        const sharedDataDir = path.join(__dirname, '../shared_data');
        await fixBossNamesInData(config.ranking.dataDir, sharedDataDir, false, logger, bossAliasService);

        // Inicjalizuj GuildConfigService — importuje .env guilds i migruje ocr_blocked.json
        await guildConfigService.load(config.guilds);
        config.setGuildConfigService(guildConfigService);

        const guildCount = config.getAllGuilds().length;
        logger.success(`✅ EndersEcho gotowy - ranking z OCR, TOP role, ${guildCount} serwer(ów)`);

        // Inicjalizuj OCR service
        await ocrService.initialize();

        // Wczytaj limit dzienny, historię tokenów, cooldowny /update i listę zbanowanych serwerów
        await usageLimitService.load();
        await tokenUsageService.load();
        await updateCooldownService.load();
        await guildBanService.load();
        await ocrStatsService.load();

        // Uruchom scheduler cyklicznych raportów TOP10 globalnego
        globalTop10Service.setClient(client);
        globalTop10Service.start();

        // Dzienna wiadomość na nieskonfigurowanych serwerach (co dzień o 10:00 UTC)
        cron.schedule('0 10 * * *', async () => {
            try {
                for (const [guildId, guild] of client.guilds.cache) {
                    if (guildConfigService.isConfigured(guildId)) continue;

                    const channel = guild.systemChannel ||
                        guild.channels.cache
                            .filter(c => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages'))
                            .sort((a, b) => a.position - b.position)
                            .first();

                    if (!channel) continue;

                    await channel.send(
                        '⚠️ **EndersEcho** has not been configured on this server yet.\n\n' +
                        'An administrator must run **/configure** to unlock all bot features:\n' +
                        '🏆 **Rankings** — track player scores with automatic TOP role assignment\n' +
                        '📸 **Score submission** — submit boss scores via `/update` with AI image recognition\n' +
                        '🔔 **Notifications** — subscribe to DM alerts when a tracked player breaks their record\n' +
                        '🎖️ **Achievements** — unlock achievements based on performance and activity\n' +
                        '🌐 **Global ranking** — compare scores across all servers the bot is on'
                    ).catch(() => {});
                }
            } catch (err) {
                logger.error('Błąd przy codziennym przypomnieniu nieskonfigurowanym serwerom:', err.message);
            }
        }, { timezone: 'UTC' });

        // Rejestracja slash commands dla wszystkich serwerów
        await interactionHandler.registerSlashCommands(client);

        // Aktualizuj nazwy serwerów w guild_configs.json — tylko dla istniejących wpisów
        // (nie twórz nowych wpisów z samym guildName gdy plik jest pusty/uszkodzony)
        for (const [guildId, guild] of client.guilds.cache) {
            const existing = guildConfigService.getConfig(guildId);
            if (existing) {
                await guildConfigService.saveConfig(guildId, { guildName: guild.name }).catch(() => {});
            }
        }

        // Eksportuj aktualny globalny ranking do shared_data przy starcie.
        // syncToApi: false — ranking się nie zmienił od ostatniego zapisu, nie ma
        // sensu spamować Web API tym samym snapshotem przy każdym restarcie.
        try {
            await rankingService.saveSharedRanking({ syncToApi: false });
        } catch (e) {
            logger.warn('Nie można wyeksportować rankingu do shared_data przy starcie:', e.message);
        }

        // Przekaż klienta do GuildLogger — embedy admin wysyłane przez bota (nie webhook HTTP)
        await guildLogger.setClient(client);

        // Przekaż klienta do LogService — embedy OCR z komponentami wysyłane przez bota
        logService.setClient(client);

        // Status rotacji — "Watching [nick]'s results" co 30 sekund
        await _updateStatus();
        statusInterval = setInterval(_updateStatus, 30_000);

    } catch (error) {
        logger.error('Błąd podczas inicjalizacji bota EndersEcho:', error);
    }
}

client.once('ready', initializeBot);

client.on('interactionCreate', async (interaction) => {
    try {
        await interactionHandler.handleInteraction(interaction);
    } catch (error) {
        logger.error('Błąd podczas obsługi interakcji:', error);

        try {
            const errMsgs = interaction.guildId ? config.getMessages(interaction.guildId) : null;
            const errContent = errMsgs?.commandError || '❌ An error occurred while processing the command.';
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: errContent,
                    flags: ['Ephemeral']
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: errContent
                });
            }
        } catch (replyError) {
            logger.error('Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

client.on('guildCreate', async (guild) => {
    try {
        if (guildBanService.isBanned(guild.id)) {
            logger.warn(`🚫 Próba dodania do zbanowanego serwera "${guild.name}" (${guild.id}) — wychodzę`);
            await guild.leave().catch(() => {});
            return;
        }
        logger.info(`🆕 Bot dodany do serwera: ${guild.name} (${guild.id})`);
        const existing = guildConfigService.getConfig(guild.id);
        await guildConfigService.saveConfig(guild.id, {
            ...(!existing ? { configured: false, ocrBlocked: ['update', 'test'] } : {}),
            guildName: guild.name,
        });
        await interactionHandler.registerCommandsForGuild(client, guild.id);
        if (guild.systemChannel) {
            await guild.systemChannel.send(
                '⚙️ **EndersEcho** has been added to your server!\nAn administrator must run **/configure** to set up the bot before it can be used.'
            ).catch(() => {});
        }
        const guildLang = guildConfigService.getConfig(guild.id)?.lang || 'pol';
        const tGC = guildLang === 'eng' ? ((_p, e) => e) : ((p, _e) => p);
        await sendAdminNotification(client, new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(tGC('🆕 Bot dodany do serwera', '🆕 Bot added to server'))
            .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: tGC('Serwer', 'Server'), value: `${guild.name} (\`${guild.id}\`)` },
                { name: tGC('Członkowie', 'Members'), value: `${guild.memberCount}` }
            )
            .setTimestamp()
        );
    } catch (err) {
        logger.error(`Błąd przy dodawaniu do serwera "${guild.name}": ${err.message}`);
    }
});

async function sendAdminNotification(discordClient, embed) {
    // Dedykowany kanał logów serwerowych
    const channelId = config.serverLogChannelId;
    if (!channelId) return;
    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel) await channel.send({ content: '<@398983446812295168>', embeds: [embed] });
    } catch (err) {
        logger.error(`Błąd wysyłania powiadomienia admin (kanał "${discordClient.channels.cache.get(channelId)?.name || channelId}"):`, err.message);
    }
}

client.on('guildDelete', async (guild) => {
    if (guild.available === false) return;
    const guildLangDel = guildConfigService.getConfig(guild.id)?.lang || 'pol';
    const tGD = guildLangDel === 'eng' ? ((_p, e) => e) : ((p, _e) => p);
    await sendAdminNotification(client, new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(tGD('🚪 Bot usunięty z serwera', '🚪 Bot removed from server'))
        .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
        .addFields(
            { name: tGD('Serwer', 'Server'), value: `${guild.name} (\`${guild.id}\`)` }
        )
        .setTimestamp()
    );
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guildId) {
        await message.reply('👑 The King does not do private audiences. Find me on the server.').catch(() => {});
        return;
    }
    if (!kingBumChatService.isEnabledForGuild(message.guildId)) return;

    const isBotMentioned = message.mentions.has(client.user.id);
    const isEveryoneMention = message.mentions.everyone;
    const isReplyToBot = message.reference && message.mentions.repliedUser?.id === client.user.id;

    if ((!isBotMentioned && !isReplyToBot) || isEveryoneMention) return;

    let previousBotMessage = null;
    if (isReplyToBot && message.reference?.messageId) {
        try {
            const ref = await message.channel.messages.fetch(message.reference.messageId);
            if (ref.author.id === client.user.id) previousBotMessage = ref.content;
        } catch { /* ignoruj jeśli nie da się pobrać */ }
    }

    try {
        const question = message.content.replace(/<@!?\d+>/g, '').trim();

        if (!question) {
            await message.reply('👑 *adjusts crown lazily* ...You rang? Ask me something.');
            return;
        }

        if (question.length > 500) {
            await message.reply('👑 King BUM does not read walls of text. Keep it short, subject.');
            return;
        }

        const canAskResult = kingBumChatService.canAsk(message.author.id, message.member);
        if (!canAskResult.allowed) {
            await message.reply(`⏳ Still processing the last one. Come back in **${canAskResult.remainingSeconds}s**.`);
            return;
        }

        await message.channel.sendTyping();

        const answer = await kingBumChatService.ask(message, question, previousBotMessage);
        kingBumChatService.recordAsk(message.author.id, message.member);

        const splitMessage = (text, maxLen = 2000) => {
            if (text.length <= maxLen) return [text];
            const parts = [];
            let remaining = text;
            while (remaining.length > 0) {
                if (remaining.length <= maxLen) { parts.push(remaining); break; }
                let splitAt = remaining.lastIndexOf('\n\n', maxLen);
                if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
                if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('. ', maxLen);
                if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
                if (splitAt < maxLen * 0.3) splitAt = maxLen;
                parts.push(remaining.substring(0, splitAt + 1).trimEnd());
                remaining = remaining.substring(splitAt + 1).trimStart();
            }
            return parts;
        };

        const parts = splitMessage(answer);
        await message.reply({ content: parts[0] });
        for (let i = 1; i < parts.length; i++) {
            await message.channel.send({ content: parts[i] });
        }
    } catch (err) {
        logger.error(`Błąd King BUM MessageCreate (guildId=${message.guildId}): ${err.message}`);
    }
});

client.on('error', error => {
    logger.error('Błąd klienta Discord:', error);
});

/**
 * Startuje bota EndersEcho
 */
async function startBot() {
    try {
        await client.login(config.token);
        return client;
    } catch (error) {
        logger.error('Błąd podczas logowania bota EndersEcho:', error);
        throw error;
    }
}

/**
 * Zatrzymuje bota EndersEcho
 */
async function stopBot() {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    globalTop10Service.stop();
    try {
        if (client.readyAt) {
            await client.destroy();
            logger.info('Bot EndersEcho został zatrzymany');
        }
    } catch (error) {
        logger.error('Błąd podczas zatrzymywania bota EndersEcho:', error);
    }
    // OTel flush — trace buffer musi wyjść zanim proces się zamknie.
    try {
        await telemetry.shutdown();
    } catch (e) {
        logger.warn('OTel shutdown error: ' + (e.message || e));
    }
}

module.exports = {
    name: 'EndersEcho',
    start: startBot,
    stop: stopBot,
    client
};

if (require.main === module) {
    startBot().catch(error => logger.error('Błąd uruchomienia bota:', error));

    process.on('SIGINT', async () => {
        logger.info('Otrzymano sygnał SIGINT, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Otrzymano sygnał SIGTERM, zamykam bota EndersEcho...');
        await stopBot();
        process.exit(0);
    });
}
