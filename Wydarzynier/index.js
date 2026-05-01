const { Client, GatewayIntentBits, Partials, Events, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactionHandlers');
const { handleMessageUpdate } = require('./handlers/messageHandlers');
const LobbyService = require('./services/lobbyService');
const TimerService = require('./services/timerService');
const BazarService = require('./services/bazarService');
const PrzypomnieniaMenedzer = require('./services/przypomnieniaMenedzer');
const Harmonogram = require('./services/harmonogram');
const TablicaMenedzer = require('./services/tablicaMenedzer');
const EventMenedzer = require('./services/eventMenedzer');
const ListaEventowMenedzer = require('./services/listaEventowMenedzer');
const StrefaCzasowaManager = require('./services/strefaCzasowaManager');
const { delay } = require('./utils/helpers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});

const lobbyService = new LobbyService(config);
const timerService = new TimerService(config);
const bazarService = new BazarService(config);

const przypomnieniaMenedzer = new PrzypomnieniaMenedzer(config, logger);
const strefaCzasowaManager = new StrefaCzasowaManager(logger);
const eventMenedzer = new EventMenedzer(config, logger);

let harmonogram = null;
let tablicaMenedzer = null;
let listaEventowMenedzer = null;

const sharedState = {
    lobbyService,
    timerService,
    bazarService,
    przypomnieniaMenedzer,
    strefaCzasowaManager,
    eventMenedzer,
    client,
    config,
    logger,
    userStates: new Map(),
};

const RELAY_FILE_3 = path.join(__dirname, 'data', 'message_relay.json');
const MAX_RELAY_ENTRIES_3 = 200;

async function loadRelay3() {
    try { return JSON.parse(await fs.readFile(RELAY_FILE_3, 'utf8')); } catch { return {}; }
}

async function saveRelay3(dmMessageId, channelId, messageId) {
    const relay = await loadRelay3();
    relay[dmMessageId] = { channelId, messageId };
    const keys = Object.keys(relay);
    if (keys.length > MAX_RELAY_ENTRIES_3) keys.slice(0, keys.length - MAX_RELAY_ENTRIES_3).forEach(k => delete relay[k]);
    await fs.mkdir(path.dirname(RELAY_FILE_3), { recursive: true });
    await fs.writeFile(RELAY_FILE_3, JSON.stringify(relay, null, 2));
}

async function updateActivationMessage(client, robotUsers, botLabel, customIdPrefix, msgFile) {
    if (robotUsers.length === 0) return;
    try {
        const activationChannel = await client.channels.fetch(config.robot3ActivationChannel);
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
                logger.error(`[ROBOT3] Nie można pobrać użytkownika ${userId}: ${err.message}`);
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
                logger.info('[ROBOT3] Zaktualizowano wiadomość aktywacji');
                return;
            } catch {
                // Wiadomość usunięta - utwórz nową
            }
        }

        const newMsg = await activationChannel.send({ content, components: [row] });
        await fs.mkdir(path.dirname(msgFile), { recursive: true });
        await fs.writeFile(msgFile, JSON.stringify({ messageId: newMsg.id }, null, 2));
        logger.info('[ROBOT3] Wysłano nową wiadomość aktywacji');
    } catch (error) {
        logger.error(`[ROBOT3] Błąd aktualizacji wiadomości aktywacji: ${error.message}`);
    }
}

client.once(Events.ClientReady, async () => {
    try {
        logger.success('✅ Wydarzynier gotowy - lobby partii, bazar, przypomnienia, eventy');

        await lobbyService.loadLobbies();
        await timerService.restoreTimers(sharedState);
        await bazarService.initialize(client);

        await przypomnieniaMenedzer.initialize();
        await strefaCzasowaManager.initialize();
        await eventMenedzer.initialize();

        tablicaMenedzer = new TablicaMenedzer(client, config, logger, przypomnieniaMenedzer, strefaCzasowaManager, eventMenedzer);
        sharedState.tablicaMenedzer = tablicaMenedzer;

        listaEventowMenedzer = new ListaEventowMenedzer(client, config, logger, eventMenedzer);
        sharedState.listaEventowMenedzer = listaEventowMenedzer;

        harmonogram = new Harmonogram(client, config, logger, przypomnieniaMenedzer, tablicaMenedzer, eventMenedzer, listaEventowMenedzer);
        sharedState.harmonogram = harmonogram;

        await tablicaMenedzer.initialize();
        await listaEventowMenedzer.initialize();
        harmonogram.initialize();

        const { InteractionHandler } = require('./handlers/interactionHandlers');
        const interactionHandler = new InteractionHandler(config, lobbyService, timerService, bazarService);
        await interactionHandler.registerSlashCommands(client);

        startRepositionSystem(sharedState);

        await updateActivationMessage(
            client, config.robot3Users, 'Wydarzynier', 'robot_activate_wydarzynier_',
            path.join(__dirname, 'data', 'robot_activation_msg.json')
        );

    } catch (error) {
        logger.error('❌ Błąd krytyczny podczas inicjalizacji Wydarzynier:', error);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('robot_activate_wydarzynier_')) {
        const userId = interaction.customId.replace('robot_activate_wydarzynier_', '');
        try {
            const user = await client.users.fetch(userId);
            await user.send('System przekazywania wiadomości aktywny!');
            await interaction.reply({ content: `✅ Aktywowano system dla **${user.displayName || user.username}**`, ephemeral: true });
            logger.info(`[ROBOT3] Aktywowano system dla ${user.username}`);
        } catch (error) {
            await interaction.reply({ content: `❌ Błąd aktywacji: ${error.message}`, ephemeral: true });
            logger.error(`[ROBOT3] Błąd aktywacji: ${error.message}`);
        }
        return;
    }
    try {
        await handleInteraction(interaction, sharedState);
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
    try {
        await handleReactionAdd(reaction, user, sharedState);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi dodania reakcji:', error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        await handleReactionRemove(reaction, user, sharedState);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi usunięcia reakcji:', error);
    }
});

client.on(Events.MessageCreate, async (message) => {
    if (message.channel.type === ChannelType.DM && !message.author.bot) {
        if (config.robot3Users.length > 0 && config.robot3Users.includes(message.author.id)) {
            if (message.partial) await message.fetch();

            if (message.reference?.messageId) {
                const relay = await loadRelay3();
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
                        logger.info(`[ROBOT3] Przekazano odpowiedź na kanał`);
                    } catch (error) {
                        logger.error(`[ROBOT3] Błąd przekazywania odpowiedzi: ${error.message}`);
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
                    logger.info(`[ROBOT3] Przekazano wiadomość od ${message.author.username} na kanał`);
                }
            } catch (error) {
                logger.error(`[ROBOT3] Błąd przekazywania wiadomości: ${error.message}`);
            }
            return;
        }
    }

    if (!message.author.bot && message.guild && config.robot3Users.length > 0 && message.channelId === config.notificationForwardChannel && message.mentions.has(client.user) && !message.mentions.everyone) {
        for (const userId of config.robot3Users) {
            try {
                const user = await client.users.fetch(userId);
                const channelName = message.channel.name || message.channel.id;
                const content = `📨 **${message.member?.displayName || message.author.username}** na #${channelName}:\n${message.content}`;
                const attachmentUrls = [...message.attachments.values()].map(a => a.url);
                const payload = { content };
                if (attachmentUrls.length > 0) payload.files = attachmentUrls;
                const dmMsg = await user.send(payload);
                await saveRelay3(dmMsg.id, message.channelId, message.id);
                logger.info(`[ROBOT3] Przekazano ping od ${message.author.username} do ${user.username}`);
            } catch (err) {
                logger.error(`[ROBOT3] Błąd przekazywania pinga do ${userId}: ${err.message}`);
            }
        }
    }
});

client.on(Events.ThreadMembersUpdate, async (addedMembers, removedMembers, thread) => {
    try {
        const lobby = sharedState.lobbyService.getLobbyByThreadId(thread.id);
        if (!lobby) return;

        for (const member of addedMembers.values()) {
            if (member.user?.bot) continue;

            if (!lobby.players.includes(member.id)) {
                try {
                    const guildMember = await thread.guild.members.fetch(member.id).catch(() => null);
                    if (guildMember && guildMember.permissions.has('Administrator')) {
                        logger.info(`🛡️ Administrator ${member.user?.username} wszedł do lobby - ignoruję jego obecność`);
                        continue;
                    }

                    await thread.members.remove(member.id);

                    const warningMsg = await thread.send(
                        `⚠️ **${member.user?.username || 'Użytkownik'}** został usunięty z wątku - dołączenie możliwe tylko przez system akceptacji!`
                    );

                    await delay(10000);
                    try {
                        await warningMsg.delete();
                    } catch {
                        // wiadomość już usunięta
                    }

                } catch (error) {
                    logger.error(`❌ Błąd podczas usuwania nieupoważnionego członka z wątku:`, error);
                }
            }
        }

        for (const member of removedMembers.values()) {
            if (member.user?.bot) continue;

            const guildMember = await thread.guild.members.fetch(member.id).catch(() => null);
            if (guildMember && guildMember.permissions.has('Administrator')) {
                logger.info(`🛡️ Administrator ${member.user?.username} opuścił lobby - ignoruję (nie był oficjalnie w lobby)`);
                continue;
            }

            const playerIndex = lobby.players.indexOf(member.id);
            if (playerIndex > -1) {
                lobby.players.splice(playerIndex, 1);

                if (lobby.isFull && lobby.players.length < sharedState.config.lobby.maxPlayers) {
                    lobby.isFull = false;
                    await thread.send(`📢 Zwolniono miejsce w lobby! Dostępne miejsca: ${sharedState.config.lobby.maxPlayers - lobby.players.length}`);
                }

                await sharedState.lobbyService.saveLobbies();

                try {
                    const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
                    const announcementMessage = await channel.messages.fetch(lobby.announcementMessageId).catch(() => null);

                    if (announcementMessage) {
                        const updatedContent = sharedState.config.messages.partyAnnouncement(
                            lobby.ownerDisplayName,
                            lobby.players.length,
                            sharedState.config.lobby.maxPlayers
                        );

                        const currentButton = announcementMessage.components[0]?.components[0];
                        const customId = currentButton?.customId || `join_lobby_${Date.now()}`;

                        const joinButton = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(customId)
                                    .setLabel('Dołącz do Party')
                                    .setEmoji(sharedState.config.emoji.ticket)
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(lobby.isFull)
                            );

                        await announcementMessage.edit({
                            content: updatedContent,
                            components: [joinButton]
                        });
                    }
                } catch (error) {
                    logger.error('❌ Błąd podczas aktualizacji wiadomości po wyjściu gracza:', error);
                }
            }
        }
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi aktualizacji członków wątku:', error);
    }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        await handleMessageUpdate(oldMessage, newMessage, sharedState);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi aktualizacji wiadomości:', error);
    }
});

client.on('error', error => {
    logger.error(`Błąd klienta Discord: ${error.message}`);
});

process.on('unhandledRejection', error => {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
});

process.on('uncaughtException', error => {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
});

function startRepositionSystem(sharedState) {
    setInterval(async () => {
        try {
            const lobbiesForRepositioning = sharedState.lobbyService.getLobbiesForRepositioning(
                sharedState.config.lobby.repositionInterval
            );
            for (const lobby of lobbiesForRepositioning) {
                await repositionLobbyAnnouncement(lobby, sharedState);
            }
        } catch (error) {
            logger.error('❌ Błąd podczas repozycjonowania lobby:', error);
        }
    }, 60000);
}

async function repositionLobbyAnnouncement(lobby, sharedState) {
    try {
        const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);

        const now = Date.now();
        const timeSinceLastReposition = now - lobby.lastRepositionTime;
        if (timeSinceLastReposition < sharedState.config.lobby.repositionInterval) return;

        try {
            const oldMessage = await channel.messages.fetch(lobby.announcementMessageId);
            await oldMessage.delete();
        } catch {
            // wiadomość już usunięta
        }

        const joinButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`join_lobby_${Date.now()}`)
                    .setLabel('Dołącz do Party')
                    .setEmoji(sharedState.config.emoji.ticket)
                    .setStyle(ButtonStyle.Primary)
            );

        const newMessage = await channel.send({
            content: sharedState.config.messages.partyAnnouncementReposition(
                lobby.ownerDisplayName,
                lobby.players.length,
                sharedState.config.lobby.maxPlayers
            ),
            components: [joinButton]
        });

        lobby.announcementMessageId = newMessage.id;
        sharedState.lobbyService.updateRepositionTime(lobby.id);
        await sharedState.lobbyService.saveLobbies();

        logger.info(`🔄 Repozycjonowano ogłoszenie lobby ${lobby.id} właściciela ${lobby.ownerDisplayName}`);

    } catch (error) {
        logger.error(`❌ Błąd podczas repozycjonowania lobby ${lobby.id}:`, error);
    }
}

async function shutdown(signal) {
    logger.info(`Otrzymano ${signal} - zamykanie Wydarzyniera...`);
    if (harmonogram) harmonogram.stop();
    if (tablicaMenedzer) tablicaMenedzer.stopPeriodicUpdates();
    await lobbyService.saveLobbies().catch(err => logger.error('Błąd podczas zapisywania lobbies:', err));
    await timerService.saveTimersToFile().catch(err => logger.error('Błąd podczas zapisywania timerów:', err));
    await client.destroy();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = {
    client,
    start: () => client.login(config.token),
    stop: async () => {
        if (harmonogram) harmonogram.stop();
        if (tablicaMenedzer) tablicaMenedzer.stopPeriodicUpdates();
        await lobbyService.saveLobbies().catch(err => logger.error('Błąd podczas zapisywania lobbies:', err));
        await timerService.saveTimersToFile().catch(err => logger.error('Błąd podczas zapisywania timerów:', err));
        return client.destroy();
    }
};
