const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

const config = require('./config/config');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactionHandlers');
const { handleMessageUpdate, handleMessageCreate } = require('./handlers/messageHandlers');
const LobbyService = require('./services/lobbyService');
const TimerService = require('./services/timerService');
const BazarService = require('./services/bazarService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// Inicjalizacja serwisów
const lobbyService = new LobbyService(config);
const timerService = new TimerService(config);
const bazarService = new BazarService(config);

// Obiekt zawierający wszystkie współdzielone stany
const sharedState = {
    lobbyService,
    timerService,
    bazarService,
    client,
    config
};

client.once(Events.ClientReady, async () => {
    logger.info(`Bot zalogowany jako ${client.user.tag}`);
    logger.info(`Aktywny na ${client.guilds.cache.size} serwerach`);
    
    client.guilds.cache.forEach(guild => {
        logger.info(`- ${guild.name} (${guild.id})`);
    });
    
    // Wczytaj lobby i timery z plików
    await lobbyService.loadLobbies();
    await timerService.restoreTimers(sharedState);
    await bazarService.initialize(client);
    
    // Zarejestruj komendy slash
    const { InteractionHandler } = require('./handlers/interactionHandlers');
    const interactionHandler = new InteractionHandler(config, lobbyService, timerService, bazarService);
    await interactionHandler.registerSlashCommands(client);
    
    logger.info('Bot Wydarzynier jest gotowy do pracy!');
});

// Obsługa komend slash i przycisków
client.on(Events.InteractionCreate, async (interaction) => {
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

// Obsługa reakcji
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
                        
                        await announcementMessage.edit(updatedContent);
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

// Obsługa błędów
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

// Eksportuj funkcje do zarządzania botem
module.exports = {
    client,
    start: () => {
        return client.login(config.token);
    },
    stop: () => {
        return client.destroy();
    }
};