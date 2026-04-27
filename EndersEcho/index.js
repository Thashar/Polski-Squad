const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
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
const RoleRankingConfigService = require('./services/roleRankingConfigService');
const UsageLimitService = require('./services/usageLimitService');
const { TokenUsageService } = require('./services/tokenUsageService');
const { UpdateCooldownService } = require('./services/updateCooldownService');
const InteractionHandler = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');
const { createLlmAdapter } = require('../utils/llmAdapter');
const { createAppSync } = require('../utils/appSync');
const { createBotOperations } = require('../utils/operationRunner');

const logger = createBotLogger('EndersEcho');
const llmAdapter = createLlmAdapter({ botSlug: 'endersecho', tracerName: 'endersecho-bot' });
const { sync: appSync } = createAppSync({ apiKey: config.appApiKey });
const botOps = createBotOperations({ botSlug: 'endersecho', apiKey: config.appApiKey });

const guildConfigService = new GuildConfigService(config.ranking.dataDir);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const ocrService = new OCRService(config);
const aiOcrService = new AIOCRService(config, llmAdapter);
const rankingService = new RankingService(config, appSync);
const guildLogger = new GuildLogger(config);
const logService = new LogService(config, guildLogger);
const roleService = new RoleService(config, rankingService);
const notificationService = new NotificationService(config);
const userBlockService = new UserBlockService(config);
const ocrBlockService = new (require('./services/ocrBlockService'))(guildConfigService);
const roleRankingConfigService = new RoleRankingConfigService(config);
const usageLimitService = new UsageLimitService(config);
const tokenUsageService = new TokenUsageService(config);
const updateCooldownService = new UpdateCooldownService(config);
const interactionHandler = new InteractionHandler(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, botOps, guildConfigService, ocrBlockService, updateCooldownService);

/**
 * Inicjalizuje bota EndersEcho
 */
async function initializeBot() {
    try {
        // Inicjalizuj GuildConfigService — importuje .env guilds i migruje ocr_blocked.json
        await guildConfigService.load(config.guilds);
        config.setGuildConfigService(guildConfigService);

        const guildCount = config.getAllGuilds().length;
        logger.success(`✅ EndersEcho gotowy - ranking z OCR, TOP role, ${guildCount} serwer(ów)`);

        // Inicjalizuj OCR service
        await ocrService.initialize();

        // Wczytaj limit dzienny, historię tokenów i cooldowny /update
        await usageLimitService.load();
        await tokenUsageService.load();
        await updateCooldownService.load();

        // Rejestracja slash commands dla wszystkich serwerów
        await interactionHandler.registerSlashCommands(client);

        // Zapisz nazwy serwerów do guild_configs.json (fallback gdy bot wyjdzie z serwera)
        for (const [guildId, guild] of client.guilds.cache) {
            await guildConfigService.saveConfig(guildId, { guildName: guild.name }).catch(() => {});
        }

        // Eksportuj aktualny globalny ranking do shared_data przy starcie.
        // syncToApi: false — ranking się nie zmienił od ostatniego zapisu, nie ma
        // sensu spamować Web API tym samym snapshotem przy każdym restarcie.
        try {
            await rankingService.saveSharedRanking({ syncToApi: false });
        } catch (e) {
            logger.warn('Nie można wyeksportować rankingu do shared_data przy starcie:', e.message);
        }

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
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.',
                    flags: ['Ephemeral']
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.'
                });
            }
        } catch (replyError) {
            logger.error('Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

client.on('guildCreate', async (guild) => {
    try {
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
        await sendAdminNotification(client, new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🆕 Bot dodany do serwera')
            .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: 'Serwer', value: `${guild.name} (\`${guild.id}\`)` },
                { name: 'Członkowie', value: `${guild.memberCount}` }
            )
            .setTimestamp()
        );
    } catch (err) {
        logger.error(`Błąd przy dodawaniu do serwera ${guild.id}: ${err.message}`);
    }
});

async function sendAdminNotification(discordClient, embed) {
    const channelId = config.invalidReportChannelId;
    if (!channelId) return;
    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel) await channel.send({ embeds: [embed] });
    } catch (err) {
        logger.error(`Błąd wysyłania powiadomienia admin (channelId=${channelId}):`, err.message);
    }
}

function projectGuildMember(member) {
    const username = member?.user?.username;
    if (!username) return null;

    const globalName = member.user.globalName?.trim() ? member.user.globalName : null;
    const nickname = member.nickname?.trim() ? member.nickname : null;

    return {
        guildId: member.guild.id,
        discordId: member.user.id,
        username,
        globalName,
        nickname,
        avatarHash: member.user.avatar ?? null,
        roleIds: member.roles.cache.map(r => r.id),
        joinedAt: member.joinedAt?.toISOString() ?? new Date().toISOString(),
    };
}

client.on('guildCreate', async (guild) => {
    try {
        await appSync.guildJoined({ guildId: guild.id, guildName: guild.name });
    } catch (err) {
        logger.error(`Błąd guildJoined (guildId=${guild.id}):`, err);
    }
});

client.on('guildDelete', async (guild) => {
    if (guild.available === false) return;
    try {
        await appSync.guildLeft({ guildId: guild.id });
    } catch (err) {
        logger.error(`Błąd guildLeft (guildId=${guild.id}):`, err);
    }
    await sendAdminNotification(client, new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚪 Bot usunięty z serwera')
        .setThumbnail(guild.iconURL({ dynamic: true, size: 128 }))
        .addFields(
            { name: 'Serwer', value: `${guild.name} (\`${guild.id}\`)` }
        )
        .setTimestamp()
    );
});

client.on('guildMemberAdd', async (member) => {
    try {
        const payload = projectGuildMember(member);
        if (!payload) return;
        await appSync.memberSeen(payload);
    } catch (err) {
        logger.error(`Błąd memberSeen add (guildId=${member?.guild?.id}, discordId=${member?.user?.id}):`, err);
    }
});

client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    try {
        const payload = projectGuildMember(newMember);
        if (!payload) return;
        await appSync.memberSeen(payload);
    } catch (err) {
        logger.error(`Błąd memberSeen update (guildId=${newMember?.guild?.id}, discordId=${newMember?.user?.id}):`, err);
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
