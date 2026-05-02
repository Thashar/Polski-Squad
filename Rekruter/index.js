const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, Partials, ChannelType, Events } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');
const { delay } = require('./utils/helpers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { handleMessage } = require('./handlers/messageHandlers');
const RoleMonitoringService = require('./services/roleMonitoringService');
const MemberNotificationService = require('./services/memberNotificationService');
const MemberCacheService = require('./services/memberCacheService');
const ClanRoleChangeService = require('./services/clanRoleChangeService');
const NotificationPreferencesService = require('./services/notificationPreferencesService');
const { initializeOCR } = require('./services/ocrService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

const roleMonitoringService = new RoleMonitoringService(config);
const memberNotificationService = new MemberNotificationService(config);
const memberCacheService = new MemberCacheService(config);
const notificationPreferencesService = new NotificationPreferencesService();
const clanRoleChangeService = new ClanRoleChangeService(config, notificationPreferencesService);

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

const userStates = new Map();
const userInfo = new Map();
const nicknameRequests = new Map();
const userEphemeralReplies = new Map();
const pendingQualifications = new Map();
const userImages = new Map();
const pendingOtherPurposeFinish = new Map();

const sharedState = {
    userStates,
    userInfo,
    nicknameRequests,
    userEphemeralReplies,
    pendingQualifications,
    userImages,
    pendingOtherPurposeFinish,
    notificationPreferencesService,
    client,
    config
};

const RELAY_FILE_2 = path.join(__dirname, 'data', 'message_relay.json');
const MAX_RELAY_ENTRIES_2 = 200;

async function loadRelay2() {
    try { return JSON.parse(await fs.readFile(RELAY_FILE_2, 'utf8')); } catch { return {}; }
}

async function saveRelay2(dmMessageId, channelId, messageId) {
    const relay = await loadRelay2();
    relay[dmMessageId] = { channelId, messageId };
    const keys = Object.keys(relay);
    if (keys.length > MAX_RELAY_ENTRIES_2) keys.slice(0, keys.length - MAX_RELAY_ENTRIES_2).forEach(k => delete relay[k]);
    await fs.mkdir(path.dirname(RELAY_FILE_2), { recursive: true });
    await fs.writeFile(RELAY_FILE_2, JSON.stringify(relay, null, 2));
}

async function updateActivationMessage(client, robotUsers, botLabel, customIdPrefix, msgFile) {
    if (robotUsers.length === 0) return;
    try {
        const activationChannel = await client.channels.fetch(config.robot2ActivationChannel);
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
                logger.error(`[ROBOT2] Nie można pobrać użytkownika ${userId}: ${err.message}`);
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
                if (same) return;
                await existing.edit({ content, components: [row] });
                logger.info('[ROBOT2] Zaktualizowano wiadomość aktywacji');
                return;
            } catch {
                // Wiadomość usunięta - utwórz nową
            }
        }

        const newMsg = await activationChannel.send({ content, components: [row] });
        await fs.mkdir(path.dirname(msgFile), { recursive: true });
        await fs.writeFile(msgFile, JSON.stringify({ messageId: newMsg.id }, null, 2));
        logger.info('[ROBOT2] Wysłano nową wiadomość aktywacji');
    } catch (error) {
        logger.error(`[ROBOT2] Błąd aktualizacji wiadomości aktywacji: ${error.message}`);
    }
}

client.once(Events.ClientReady, async () => {
    try {
        logger.success('✅ Rekruter gotowy - rekrutacja z OCR, boost tracking');

        await registerSlashCommands(client, config);

        await notificationPreferencesService.load();
        await roleMonitoringService.initialize(client);
        memberNotificationService.initialize(client);
        await memberCacheService.initialize(client);
        await clanRoleChangeService.initialize(client);
        await initializeOCR(config);

        try {
            await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        } catch {}

        const channel = client.channels.cache.get(config.channels.recruitment);
        if (channel) {
            try {
                const messages = await channel.messages.fetch({ limit: 50 });
                const botMessages = messages.filter(msg =>
                    msg.author.id === client.user.id &&
                    msg.content === config.messages.initialQuestion &&
                    msg.components.length > 0
                );

                logger.info(`[BOT] Znaleziono ${botMessages.size} starych wiadomości bota do usunięcia`);

                for (const [messageId, message] of botMessages) {
                    try {
                        await message.delete();
                    } catch {
                        logger.warn(`[BOT] Nie udało się usunąć wiadomości ${messageId}`);
                    }
                }
            } catch (error) {
                logger.error(`[BOT] ❌ Błąd podczas czyszczenia kanału:`, error);
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('not_polish')
                        .setLabel('Nie, nie jestem Polakiem')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:PepeNie:1185134768464076831>'),
                    new ButtonBuilder()
                        .setCustomId('yes_polish')
                        .setLabel('Oczywiście, że tak!')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:peepoxYes:461067799427547136>')
                );

            await channel.send({
                content: config.messages.initialQuestion,
                components: [row]
            });

            logger.info(`[BOT] ✅ Wysłano wiadomość rekrutacyjną`);
        } else {
            logger.error(`[BOT] ❌ Nie znaleziono kanału rekrutacji`);
        }

        await updateActivationMessage(
            client, config.robot2Users, 'Rekruter', 'robot_activate_rekruter_',
            path.join(__dirname, 'data', 'robot_activation_msg.json')
        );
    } catch (error) {
        logger.error('❌ Błąd krytyczny podczas inicjalizacji Rekruter:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton() && interaction.customId.startsWith('robot_activate_rekruter_')) {
        const userId = interaction.customId.replace('robot_activate_rekruter_', '');
        try {
            const user = await client.users.fetch(userId);
            await user.send('System przekazywania wiadomości aktywny!');
            await interaction.reply({ content: `✅ Aktywowano system dla **${user.displayName || user.username}**`, ephemeral: true });
            logger.info(`[ROBOT2] Aktywowano system dla ${user.username}`);
        } catch (error) {
            await interaction.reply({ content: `❌ Błąd aktywacji: ${error.message}`, ephemeral: true });
            logger.error(`[ROBOT2] Błąd aktywacji: ${error.message}`);
        }
        return;
    }
    try {
        await handleInteraction(interaction, sharedState, config, client);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
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
            logger.error('❌ Nie można odpowiedzieć na interakcję:', replyError.message);
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.channel.type === ChannelType.DM && !message.author.bot) {
        if (config.robot2Users.length > 0 && config.robot2Users.includes(message.author.id)) {
            if (message.partial) await message.fetch();

            if (message.reference?.messageId) {
                const relay = await loadRelay2();
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
                        logger.info(`[ROBOT2] Przekazano odpowiedź na kanał`);
                    } catch (error) {
                        logger.error(`[ROBOT2] Błąd przekazywania odpowiedzi: ${error.message}`);
                    }
                    return;
                }
            }

            try {
                const forwardChannel = await client.channels.fetch(config.notificationForwardChannel);
                if (forwardChannel) {
                    const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                    const payload = {};
                    let msgContent = message.content || '';
                    if (msgContent.startsWith('@') && config.mentionRoleId) {
                        msgContent = `<@&${config.mentionRoleId}> ${msgContent.slice(1).trimStart()}`;
                    }
                    if (msgContent) payload.content = msgContent;
                    if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                    if (payload.content || payload.files) await forwardChannel.send(payload);
                    logger.info(`[ROBOT2] Przekazano wiadomość od ${message.author.username} na kanał`);
                }
            } catch (error) {
                logger.error(`[ROBOT2] Błąd przekazywania wiadomości: ${error.message}`);
            }
            return;
        }
    }

    if (!message.author.bot && message.guild && config.robot2Users.length > 0 && message.channelId === config.notificationForwardChannel && message.mentions.has(client.user) && !message.mentions.everyone) {
        for (const userId of config.robot2Users) {
            try {
                const user = await client.users.fetch(userId);
                const channelName = message.channel.name || message.channel.id;
                const content = `📨 **${message.member?.displayName || message.author.username}** na #${channelName}:\n${message.content}`;
                const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                const payload = { content };
                if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                const dmMsg = await user.send(payload);
                await saveRelay2(dmMsg.id, message.channelId, message.id);
                logger.info(`[ROBOT2] Przekazano ping od ${message.author.username} do ${user.username}`);
            } catch (err) {
                logger.error(`[ROBOT2] Błąd przekazywania pinga do ${userId}: ${err.message}`);
            }
        }
    }

    await handleMessage(message, sharedState, config, client, config.channels.recruitment);
});

client.on(Events.GuildMemberAdd, async member => {
    await memberNotificationService.handleMemberJoin(member);
});

client.on(Events.GuildMemberRemove, async member => {
    await memberNotificationService.handleMemberLeave(member);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        await clanRoleChangeService.handleRoleChange(oldMember, newMember);

        const cacheResult = await memberCacheService.handleMemberUpdate(oldMember, newMember);

        if (cacheResult.changed) {
            if (cacheResult.changeType === 'gained') {
                logger.info(`[BOOST] 🎉 Nowy boost od ${newMember.user.username} (${newMember.id})`);
                await handleNewBoost(cacheResult.member);
            } else if (cacheResult.changeType === 'lost') {
                logger.info(`[BOOST] 💔 Utrata boost od ${newMember.user.username} (${newMember.id})`);
                await handleLostBoost(cacheResult.member);
            }
        }
    } catch (error) {
        logger.error(`[BOOST] ❌ Błąd podczas obsługi boost event dla ${newMember?.user?.username || 'nieznany'}:`, error);
    }
});

async function handleNewBoost(member) {
    try {
        const memberCount = member.guild.memberCount;

        const boostMessages = [
            `🧟‍♂️ Boost zebrany! ${member} jak prawdziwy strateg wybiera najlepsze wzmocnienia - dzięki Tobie serwer ma teraz legendarną moc! ${memberCount}+ członków podziwia Twoją hojność!`,
            `💎 To lepsze niż 100k gemów! ${member} dropnął nam najrzadszy boost w całej historii serwera! Twoja szczodrość podnosi nas na wyższy poziom!`,
            `⚡ Wzmocnienie aktywne! Dzięki ${member} mamy teraz nieskończone możliwości - Twój boost czyni naszą społeczność niepokonaną!`,
            `🎯 Perfekcyjne trafienie! ${member} wie dokładnie, jak wesprzeć społeczność - Twój boost to strzał w dziesiątkę prosto w serce serwera!`,
            `🔄 Nadchodzi nowa fala wyzwań, ale z ${member} w naszych szeregach jesteśmy nie do pokonania! Twój boost zawsze na czas!`,
            `📱 Jednym gestem ${member} zmienia wszystko na lepsze! Twoja mądrość i hojność robią z tego serwera prawdziwy bastion!`,
            `🎮 Kolejny poziom odblokowany! To ${member} prowadzi nas do zwycięstwa - Twój boost to klucz do naszego sukcesu!`,
            `🏃‍♂️ Podczas gdy inni uciekają od problemów, ${member} je rozwiązuje boostami! Jesteś naszym bohaterem społeczności!`,
            `⭐ ${member} ma oko do najlepszych wyborów! Twój boost dowodzi, że jesteś prawdziwym liderem z wielkim sercem dla społeczności!`,
            `🔋 ${member} to nasz główny bohater! Twój boost napędza cały serwer i pokazuje, że jesteś jednym z najcenniejszych członków tej społeczności!`
        ];

        const randomMessage = boostMessages[Math.floor(Math.random() * boostMessages.length)];

        try {
            const mainChannel = client.channels.cache.get(config.channels.main) || await client.channels.fetch(config.channels.main);
            await mainChannel.send(randomMessage);
        } catch (error) {
            logger.error(`[BOOST] ❌ Błąd wysyłania na kanał główny:`, error);
        }

        try {
            const bonusChannel = client.channels.cache.get(config.channels.boost) || await client.channels.fetch(config.channels.boost);
            const bonusMessage = `${member} bardzo nam miło, że wspierasz nasz serwer. Chcemy się Tobie odwdzięczyć dlatego przygotowaliśmy kilka bonusów, które umilą Ci tu pobyt. Zapoznaj się z nimi tutaj: https://discord.com/channels/1170323970692743240/1283802643789250673/1283803231008456724\n\nW sprawie indywidualnej roli kontaktuj się tutaj z właścicielem serwera. <:PepeOK:1185134659286347886>`;
            await bonusChannel.send(bonusMessage);
        } catch (error) {
            logger.error(`[BOOST] ❌ Błąd wysyłania na kanał bonusowy:`, error);
        }

        logger.info(`[BOOST] ✅ Wysłano wiadomości boost dla ${member.user.username}`);

    } catch (error) {
        logger.error(`[BOOST] ❌ Błąd podczas obsługi nowego boost dla ${member.user.username}:`, error);
    }
}

async function handleLostBoost(member) {
    try {
        const lostBoostMessages = [
            `💔 Game over... ${member} zakończył swoją misję wsparcia serwera. Dziękujemy za każdy dzień Twojego boosta - zniknął jak ostatnia amunicja w magazynie, ale Twoja hojność pozostanie w pamięci!`,
            `😢 Połączenie utracone! ${member} opuścił nasze szeregi boosterów. Dziękujemy za cały czas wspierania - jak gdy skończy się energia w grze, musimy poczekać na Twój powrót!`,
            `🌫️ Mgła opadła na serwer... ${member} zabrał ze sobą swój boost. Dziękujemy za wszystkie miesiące/tygodnie wsparcia - Twoja legendarną moc zniknęła z naszego arsenału, ale wspomnienia zostają!`,
            `⚰️ Boost nie przeżył tej rundy! ${member} zakończył wspieranie serwera. Dziękujemy za ten wspaniały okres - jak stracona życiówka, zostały nam tylko wspomnienia Twojej niesamowitej hojności!`,
            `🥀 Koniec epoki! ${member} przestał nas boostować. Dziękujemy za bycie jednym z naszych najlepszych obrońców przez ten czas - Twoje wsparcie było jak rzadki artefakt!`,
            `💸 Klejnoty przepadły! ${member} wycofał swój boost z naszego serwera. Dziękujemy za każdy dzień wspierania - 100k gemów nie wróci, ale wdzięczność za Twój wkład pozostanie na zawsze!`,
            `🛡️ Tarcza opuszczona! ${member} przestał chronić nasz serwer swoim boostem. Dziękujemy za ochronę którą nam dawałeś - bez Twojego wsparcia będzie nam trudniej, ale pamiętamy Twoje poświęcenie!`,
            `🌙 Noc nadeszła dla boosta! ${member} zakończył swoją przygodę ze wspieraniem serwera. Dziękujemy za bycie naszym światłem przez ten czas - ciemność ogarnia społeczność, ale Twój wkład świeci dalej!`,
            `⏰ Czas minął! ${member} przestał boostować nasz serwer. Dziękujemy za każdą minutę Twojego wsparcia - jak gdy kończy się timer w grze, wszystko wraca do punktu wyjścia, ale pamięć trwa!`,
            `💀 Bohater upadł! ${member} nie jest już naszym boosterem. Dziękujemy za cały okres bycia jednym z najcenniejszych członków - czy kiedyś powrócisz do gry? Zawsze będziesz mile widziany!`
        ];

        const randomMessage = lostBoostMessages[Math.floor(Math.random() * lostBoostMessages.length)];

        try {
            const mainChannel = client.channels.cache.get(config.channels.main) || await client.channels.fetch(config.channels.main);
            await mainChannel.send(randomMessage);
        } catch (error) {
            logger.error(`[BOOST] ❌ Błąd wysyłania smutnej wiadomości na kanał główny:`, error);
        }

        logger.info(`[BOOST] ✅ Wysłano wiadomość o utracie boost dla ${member.user.username}`);

    } catch (error) {
        logger.error(`[BOOST] ❌ Błąd podczas obsługi utraty boost dla ${member.user.username}:`, error);
    }
}

async function shutdown(signal) {
    logger.info(`Otrzymano ${signal} - zamykanie bota Rekruter...`);
    try {
        await memberCacheService.cleanup();
        client.destroy();
        logger.info('Bot Rekruter został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota Rekruter: ${error.message}`);
        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', error => {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
});

process.on('uncaughtException', error => {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
});

module.exports = {
    client,
    start: () => client.login(config.token),
    stop: async () => {
        await memberCacheService.cleanup();
        return client.destroy();
    }
};
