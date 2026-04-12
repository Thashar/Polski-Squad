const { Client, GatewayIntentBits, Partials, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');

const OCRService = require('./services/ocrService');
const AnalysisService = require('./services/analysisService');
const RoleService = require('./services/roleService');
const MessageService = require('./services/messageService');
const LotteryService = require('./services/lotteryService');
const OligopolyService = require('./services/oligopolyService');
const VotingService = require('./services/votingService');

const MessageHandler = require('./handlers/messageHandlers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

let ocrService, analysisService, roleService, messageService, messageHandler, lotteryService, oligopolyService, votingService;

/**
 * Inicjalizuje wszystkie serwisy
 */
async function initializeServices() {
    ocrService = new OCRService(config);
    await ocrService.ensureDirectories();
    analysisService = new AnalysisService(config, ocrService);
    roleService = new RoleService(config);
    lotteryService = new LotteryService(config);
    oligopolyService = new OligopolyService(config, logger);
    votingService = new VotingService(config);
    messageService = new MessageService(config, lotteryService);
    messageHandler = new MessageHandler(
        config,
        ocrService,
        analysisService,
        roleService,
        messageService,
        lotteryService,
        votingService
    );

}

/**
 * Handler dla zdarzenia ready
 */
function onReady() {
    const channelCount = Object.keys(config.channels).length;
    const clanCount = Object.keys(config.lottery.clans).length;
    logger.success(`✅ Kontroler gotowy - OCR (${channelCount} kanały), Loterie (${clanCount} klany)`);
}

/**
 * Handler dla błędów klienta
 * @param {Error} error - Błąd
 */
function onError(error) {
    logger.error(`Błąd klienta Discord: ${error.message}`);
}

/**
 * Handler dla nieobsłużonych Promise rejections
 * @param {Error} error - Błąd
 */
function onUnhandledRejection(error) {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
}

/**
 * Handler dla nieobsłużonych wyjątków
 * @param {Error} error - Błąd
 */
function onUncaughtException(error) {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
}

/**
 * Handler dla sygnałów zamykania
 * @param {string} signal - Sygnał
 */
function onShutdown(signal) {
    logger.warn(`Otrzymano sygnał ${signal}. Zamykanie bota...`);

    // Zatrzymaj serwis loterii
    if (lotteryService) {
        lotteryService.stop();
    }

    client.destroy();
    process.exit(0);
}

/**
 * Aktualizuje (lub tworzy) wiadomość aktywacji systemu przekazywania na kanale
 */
const RELAY_FILE_1 = path.join(__dirname, 'data', 'message_relay.json');
const MAX_RELAY_ENTRIES = 200;

async function loadRelay1() {
    try { return JSON.parse(await fs.readFile(RELAY_FILE_1, 'utf8')); } catch { return {}; }
}

async function saveRelay1(dmMessageId, channelId, messageId) {
    const relay = await loadRelay1();
    relay[dmMessageId] = { channelId, messageId };
    const keys = Object.keys(relay);
    if (keys.length > MAX_RELAY_ENTRIES) keys.slice(0, keys.length - MAX_RELAY_ENTRIES).forEach(k => delete relay[k]);
    await fs.mkdir(path.dirname(RELAY_FILE_1), { recursive: true });
    await fs.writeFile(RELAY_FILE_1, JSON.stringify(relay, null, 2));
}

async function updateActivationMessage(client, robotUsers, botLabel, customIdPrefix, msgFile) {
    if (robotUsers.length === 0) return;
    try {
        const activationChannel = await client.channels.fetch('1486510519119773818');
        const guild = activationChannel.guild;

        const buttons = [];
        for (const userId of robotUsers) {
            try {
                const member = await guild.members.fetch(userId);
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`${customIdPrefix}${userId}`)
                        .setLabel(member.displayName)
                        .setStyle(ButtonStyle.Success)
                );
            } catch (err) {
                logger.error(`[ROBOT1] Nie można pobrać użytkownika ${userId}: ${err.message}`);
            }
        }
        if (buttons.length === 0) return;

        const content = `**${botLabel}** — aktywacja systemu przekazywania wiadomości:`;
        const row = new ActionRowBuilder().addComponents(...buttons);

        let storedId = null;
        try {
            const data = JSON.parse(await fs.readFile(msgFile, 'utf8'));
            storedId = data.messageId;
        } catch {}

        if (storedId) {
            try {
                const existing = await activationChannel.messages.fetch(storedId);
                const existingButtons = existing.components[0]?.components ?? [];
                const same = existing.content === content &&
                    existingButtons.length === buttons.length &&
                    existingButtons.every((b, i) =>
                        b.customId === buttons[i].data.custom_id &&
                        b.label === buttons[i].data.label
                    );
                if (same) {
                    return;
                }
                await existing.edit({ content, components: [row] });
                logger.info('[ROBOT1] Zaktualizowano wiadomość aktywacji');
                return;
            } catch {
                // Wiadomość usunięta - utwórz nową
            }
        }

        const newMsg = await activationChannel.send({ content, components: [row] });
        await fs.mkdir(path.dirname(msgFile), { recursive: true });
        await fs.writeFile(msgFile, JSON.stringify({ messageId: newMsg.id }, null, 2));
        logger.info('[ROBOT1] Wysłano nową wiadomość aktywacji');
    } catch (error) {
        logger.error(`[ROBOT1] Błąd aktualizacji wiadomości aktywacji: ${error.message}`);
    }
}

/**
 * Konfiguruje event handlery
 */
function setupEventHandlers() {
    client.once('ready', async () => {
        try {
            await onReady();
            // Inicjalizuj serwis loterii z klientem Discord
            await lotteryService.initialize(client);
            // Inicjalizuj serwis głosowania z klientem Discord
            await votingService.initialize(client);
            await registerSlashCommands(client, config);

            await updateActivationMessage(
                client, config.robot1Users, 'Kontroler', 'robot_activate_kontroler_',
                path.join(__dirname, 'data', 'robot_activation_msg.json')
            );
        } catch (error) {
            logger.error('❌ Błąd krytyczny podczas inicjalizacji Kontroler:', error);
        }
    });
    client.on('messageCreate', async (message) => {
        if (message.channel.type === ChannelType.DM && !message.author.bot) {
            if (config.robot1Users.length > 0 && config.robot1Users.includes(message.author.id)) {
                if (message.partial) await message.fetch();

                // Odpowiedź na przekazaną wiadomość → odpowiedz w oryginalnym kanale
                if (message.reference?.messageId) {
                    const relay = await loadRelay1();
                    const original = relay[message.reference.messageId];
                    if (original) {
                        try {
                            const originalChannel = await client.channels.fetch(original.channelId);
                            const originalMessage = await originalChannel.messages.fetch(original.messageId);
                            const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                            const payload = {};
                            if (message.content) payload.content = message.content;
                            if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                            if (payload.content || payload.files) await originalMessage.reply(payload);
                            logger.info(`[ROBOT1] Przekazano odpowiedź na kanał`);
                        } catch (error) {
                            logger.error(`[ROBOT1] Błąd przekazywania odpowiedzi: ${error.message}`);
                        }
                        return;
                    }
                }

                // Zwykły DM → przekaż na kanał
                try {
                    const forwardChannel = await client.channels.fetch(config.notificationForwardChannel);
                    if (forwardChannel) {
                        const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                        const payload = {};
                        let msgContent = message.content || '';
                        // Jeśli wiadomość zaczyna się od "@" i skonfigurowano rolę → dodaj ping do roli
                        if (msgContent.startsWith('@') && config.mentionRoleId) {
                            msgContent = `<@&${config.mentionRoleId}> ${msgContent.slice(1).trimStart()}`;
                        }
                        if (msgContent) payload.content = msgContent;
                        if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                        if (payload.content || payload.files) await forwardChannel.send(payload);
                        logger.info(`[ROBOT1] Przekazano wiadomość od ${message.author.tag} na kanał`);
                    }
                } catch (error) {
                    logger.error(`[ROBOT1] Błąd przekazywania wiadomości: ${error.message}`);
                }
                return;
            }
        }

        // Ping bota w kanale → przekaż do DM robot userów (tylko z kanału notificationForwardChannel, ignoruj @everyone/@here)
        if (!message.author.bot && message.guild && config.robot1Users.length > 0 && message.channelId === config.notificationForwardChannel && message.mentions.has(client.user) && !message.mentions.everyone) {
            for (const userId of config.robot1Users) {
                try {
                    const user = await client.users.fetch(userId);
                    const channelName = message.channel.name || message.channel.id;
                    const content = `📨 **${message.member?.displayName || message.author.username}** na #${channelName}:\n${message.content}`;
                    const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                    const payload = { content };
                    if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                    const dmMsg = await user.send(payload);
                    await saveRelay1(dmMsg.id, message.channelId, message.id);
                    logger.info(`[ROBOT1] Przekazano ping od ${message.author.tag} do ${user.tag}`);
                } catch (err) {
                    logger.error(`[ROBOT1] Błąd przekazywania pinga do ${userId}: ${err.message}`);
                }
            }
        }

        messageHandler.handleMessage(message);
    });
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isButton() && interaction.customId.startsWith('robot_activate_kontroler_')) {
            const userId = interaction.customId.replace('robot_activate_kontroler_', '');
            try {
                const user = await client.users.fetch(userId);
                await user.send('System przekazywania wiadomości aktywny!');
                await interaction.reply({ content: `✅ Aktywowano system dla **${user.displayName || user.tag}**`, ephemeral: true });
                logger.info(`[ROBOT1] Aktywowano system dla ${user.tag}`);
            } catch (error) {
                await interaction.reply({ content: `❌ Błąd aktywacji: ${error.message}`, ephemeral: true });
                logger.error(`[ROBOT1] Błąd aktywacji: ${error.message}`);
            }
            return;
        }
        interaction.client.oligopolyService = oligopolyService;
        interaction.client.votingService = votingService;
        handleInteraction(interaction, config, lotteryService);
    });
    client.on('error', onError);

    process.on('unhandledRejection', onUnhandledRejection);
    process.on('uncaughtException', onUncaughtException);
    process.on('SIGINT', () => onShutdown('SIGINT'));
    process.on('SIGTERM', () => onShutdown('SIGTERM'));
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
        logger.error(`Błąd podczas logowania: ${error.message}`);
        process.exit(1);
    }
}

module.exports = {
    start
};

// Uruchomienie jeśli plik jest wywoływany bezpośrednio
if (require.main === module) {
    start();
}