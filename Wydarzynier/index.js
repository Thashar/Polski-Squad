const { Client, GatewayIntentBits, Partials, Events, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactionHandlers');
const { handleMessageUpdate, handleMessageCreate } = require('./handlers/messageHandlers');
const LobbyService = require('./services/lobbyService');
const TimerService = require('./services/timerService');
const BazarService = require('./services/bazarService');
const PrzypomnieniaMenedzer = require('./services/przypomnieniaMenedzer');
const Harmonogram = require('./services/harmonogram');
const TablicaMenedzer = require('./services/tablicaMenedzer');
const EventMenedzer = require('./services/eventMenedzer');
const ListaEventowMenedzer = require('./services/listaEventowMenedzer');
const StrefaCzasowaManager = require('./services/strefaCzasowaManager');
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
    rest: {
        timeout: 60000, // 60 sekund timeout dla REST API
        retries: 3      // 3 próby w przypadku błędu
    }
});

const lobbyService = new LobbyService(config);
const timerService = new TimerService(config);
const bazarService = new BazarService(config);

// Serwisy systemu przypomnień i eventów
const przypomnieniaMenedzer = new PrzypomnieniaMenedzer(config, logger);
const strefaCzasowaManager = new StrefaCzasowaManager(logger);
const eventMenedzer = new EventMenedzer(config, logger);

// Te serwisy wymagają wcześniejszych serwisów, zainicjalizujemy je później
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
    userStates: new Map(), // Stan użytkowników dla interakcji z przypomnieniami
};

// Funkcje pomocnicze do dodania serwisów po inicjalizacji
function setHarmonogram(h) {
    harmonogram = h;
    sharedState.harmonogram = h;
}

function setTablicaMenedzer(t) {
    tablicaMenedzer = t;
    sharedState.tablicaMenedzer = t;
}

function setListaEventowMenedzer(l) {
    listaEventowMenedzer = l;
    sharedState.listaEventowMenedzer = l;
}

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
                if (same) {
                    logger.info('[ROBOT3] Wiadomość aktywacji bez zmian - pomijam');
                    return;
                }
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
    logger.success('✅ Wydarzynier gotowy - lobby partii, bazar, przypomnienia, eventy');

    // Wczytaj lobby i timery z plików
    await lobbyService.loadLobbies();
    await timerService.restoreTimers(sharedState);
    await bazarService.initialize(client);

    // Inicjalizuj system przypomnień i eventów
    await przypomnieniaMenedzer.initialize();
    await strefaCzasowaManager.initialize();
    await eventMenedzer.initialize();

    // Utwórz serwisy zależne
    tablicaMenedzer = new TablicaMenedzer(client, config, logger, przypomnieniaMenedzer, strefaCzasowaManager, eventMenedzer);
    setTablicaMenedzer(tablicaMenedzer);

    listaEventowMenedzer = new ListaEventowMenedzer(client, config, logger, eventMenedzer);
    setListaEventowMenedzer(listaEventowMenedzer);

    harmonogram = new Harmonogram(client, config, logger, przypomnieniaMenedzer, tablicaMenedzer, eventMenedzer, listaEventowMenedzer);
    setHarmonogram(harmonogram);

    // Inicjalizuj serwisy zależne
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

});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('robot_activate_wydarzynier_')) {
        const userId = interaction.customId.replace('robot_activate_wydarzynier_', '');
        try {
            const user = await client.users.fetch(userId);
            await user.send('System przekazywania wiadomości aktywny!');
            await interaction.reply({ content: `✅ Aktywowano system dla **${user.displayName || user.tag}**`, ephemeral: true });
            logger.info(`[ROBOT3] Aktywowano system dla ${user.tag}`);
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

// Obsługa nowych wiadomości (filtrowanie pingów w lobby)
client.on(Events.MessageCreate, async (message) => {
    if (message.channel.type === ChannelType.DM && !message.author.bot) {
        if (config.robot3Users.length > 0 && config.robot3Users.includes(message.author.id)) {
            if (message.partial) await message.fetch();

            // Odpowiedź na przekazaną wiadomość → odpowiedz w oryginalnym kanale
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
                    logger.info(`[ROBOT3] Przekazano wiadomość od ${message.author.tag} na kanał`);
                }
            } catch (error) {
                logger.error(`[ROBOT3] Błąd przekazywania wiadomości: ${error.message}`);
            }
            return;
        }
    }

    // Ping bota w kanale → przekaż do DM robot userów
    if (!message.author.bot && message.guild && config.robot3Users.length > 0 && message.mentions.has(client.user)) {
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
                logger.info(`[ROBOT3] Przekazano ping od ${message.author.tag} do ${user.tag}`);
            } catch (err) {
                logger.error(`[ROBOT3] Błąd przekazywania pinga do ${userId}: ${err.message}`);
            }
        }
    }

    try {
        await handleMessageCreate(message, sharedState);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi nowej wiadomości:', error);
    }
});

// Obsługa dodawania członków do wątku
client.on(Events.ThreadMembersUpdate, async (addedMembers, removedMembers, thread) => {
    try {
        // Sprawdź czy to wątek lobby
        const lobby = sharedState.lobbyService.getLobbyByThreadId(thread.id);
        if (!lobby) return;

        // Sprawdź nowo dodanych członków
        for (const member of addedMembers.values()) {
            // Ignoruj bota
            if (member.user?.bot) continue;
            
            // Sprawdź czy użytkownik jest na liście zaakceptowanych graczy
            if (!lobby.players.includes(member.id)) {
                try {
                    // Sprawdź czy to administrator - jeśli tak, ignoruj jego obecność ale nie dodawaj do lobby
                    const guildMember = await thread.guild.members.fetch(member.id).catch(() => null);
                    if (guildMember && guildMember.permissions.has('Administrator')) {
                        logger.info(`🛡️ Administrator ${member.user?.username} wszedł do lobby - ignoruję jego obecność`);
                        continue; // Nie usuwaj administratora, ale też nie dodawaj go do lobby
                    }
                    
                    // Usuń nieupoważnionego członka
                    await thread.members.remove(member.id);
                    
                    // Wyślij wiadomość informacyjną (bez pingu żeby uniknąć pętli)
                    const warningMsg = await thread.send(
                        `⚠️ **${member.user?.username || 'Użytkownik'}** został usunięty z wątku - dołączenie możliwe tylko przez system akceptacji!`
                    );
                    
                    // Usuń wiadomość po 10 sekundach
                    setTimeout(async () => {
                        try {
                            await warningMsg.delete();
                        } catch (error) {
                            // Ignoruj błędy usuwania
                        }
                    }, 10000);
                    
                } catch (error) {
                    logger.error(`❌ Błąd podczas usuwania nieupoważnionego członka z wątku:`, error);
                }
            }
        }

        // Sprawdź usuniętych członków i zwolnij miejsca
        for (const member of removedMembers.values()) {
            // Ignoruj bota
            if (member.user?.bot) continue;
            
            // Ignoruj administratorów - nie są częścią oficjalnego lobby
            const guildMember = await thread.guild.members.fetch(member.id).catch(() => null);
            if (guildMember && guildMember.permissions.has('Administrator')) {
                logger.info(`🛡️ Administrator ${member.user?.username} opuścił lobby - ignoruję (nie był oficjalnie w lobby)`);
                continue;
            }
            
            // Usuń z listy graczy jeśli był na liście
            const playerIndex = lobby.players.indexOf(member.id);
            if (playerIndex > -1) {
                lobby.players.splice(playerIndex, 1);
                
                // Sprawdź czy lobby nie jest już pełne
                if (lobby.isFull && lobby.players.length < sharedState.config.lobby.maxPlayers) {
                    lobby.isFull = false;
                    
                    // Wyślij informację o zwolnionym miejscu
                    await thread.send(`📢 Zwolniono miejsce w lobby! Dostępne miejsca: ${sharedState.config.lobby.maxPlayers - lobby.players.length}`);
                }
                
                // Zapisz zmiany
                await sharedState.lobbyService.saveLobbies();

                // Aktualizuj wiadomość ogłoszeniową
                try {
                    const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
                    const announcementMessage = await channel.messages.fetch(lobby.announcementMessageId).catch(() => null);

                    if (announcementMessage) {
                        const updatedContent = sharedState.config.messages.partyAnnouncement(
                            lobby.ownerDisplayName,
                            lobby.players.length,
                            sharedState.config.lobby.maxPlayers
                        );

                        // Pobierz customId z aktualnego przycisku
                        const currentButton = announcementMessage.components[0]?.components[0];
                        const customId = currentButton?.customId || `join_lobby_${Date.now()}`;

                        // Utwórz przycisk z odpowiednim stanem
                        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                        const joinButton = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(customId)
                                    .setLabel('Dołącz do Party')
                                    .setEmoji(sharedState.config.emoji.ticket)
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(lobby.isFull) // Wyłącz jeśli pełne
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

// Obsługa aktualizacji wiadomości (do monitorowania reakcji)
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

/**
 * Uruchamia system repozycjonowania ogłoszeń lobby co 5 minut
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
function startRepositionSystem(sharedState) {
    // Sprawdzaj co minutę czy są lobby do repozycjonowania
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
    }, 60000); // Co minutę sprawdzaj
}

/**
 * Repozycjonuje ogłoszenie lobby (usuwa stare i tworzy nowe na górze)
 * @param {Object} lobby - Dane lobby
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function repositionLobbyAnnouncement(lobby, sharedState) {
    try {
        const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
        
        // Sprawdź czy minęło dokładnie 5 minut od ostatniego repozycjonowania
        const now = Date.now();
        const timeSinceLastReposition = now - lobby.lastRepositionTime;
        if (timeSinceLastReposition < sharedState.config.lobby.repositionInterval) {
            return;
        }

        // Usuń stare ogłoszenie
        try {
            const oldMessage = await channel.messages.fetch(lobby.announcementMessageId);
            await oldMessage.delete();
        } catch (deleteError) {
            // Ignoruj błędy usuwania (wiadomość może już nie istnieć)
        }

        // Utwórz nowe ogłoszenie na górze
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
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

        // Zaktualizuj ID wiadomości w lobby
        lobby.announcementMessageId = newMessage.id;
        sharedState.lobbyService.updateRepositionTime(lobby.id);
        
        // Zapisz zmiany
        await sharedState.lobbyService.saveLobbies();

        logger.info(`🔄 Repozycjonowano ogłoszenie lobby ${lobby.id} właściciela ${lobby.ownerDisplayName}`);

    } catch (error) {
        logger.error(`❌ Błąd podczas repozycjonowania lobby ${lobby.id}:`, error);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Otrzymano SIGINT - zamykanie Wydarzyniera...');

    // Zatrzymaj harmonogram i periodic updates
    if (harmonogram) harmonogram.stop();
    if (tablicaMenedzer) tablicaMenedzer.stopPeriodicUpdates();

    // Zapisz dane
    await lobbyService.saveLobbies().catch(err => logger.error('Błąd podczas zapisywania lobbies:', err));
    await timerService.saveTimersToFile().catch(err => logger.error('Błąd podczas zapisywania timerów:', err));

    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Otrzymano SIGTERM - zamykanie Wydarzyniera...');

    // Zatrzymaj harmonogram i periodic updates
    if (harmonogram) harmonogram.stop();
    if (tablicaMenedzer) tablicaMenedzer.stopPeriodicUpdates();

    // Zapisz dane
    await lobbyService.saveLobbies().catch(err => logger.error('Błąd podczas zapisywania lobbies:', err));
    await timerService.saveTimersToFile().catch(err => logger.error('Błąd podczas zapisywania timerów:', err));

    await client.destroy();
    process.exit(0);
});

module.exports = {
    client,
    start: () => {
        return client.login(config.token);
    },
    stop: async () => {
        // Zatrzymaj harmonogram i periodic updates
        if (harmonogram) harmonogram.stop();
        if (tablicaMenedzer) tablicaMenedzer.stopPeriodicUpdates();

        // Zapisz dane
        await lobbyService.saveLobbies().catch(err => logger.error('Błąd podczas zapisywania lobbies:', err));
        await timerService.saveTimersToFile().catch(err => logger.error('Błąd podczas zapisywania timerów:', err));

        return client.destroy();
    }
};