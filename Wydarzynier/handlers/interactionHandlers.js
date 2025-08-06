const { SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { isAllowedChannel, delay } = require('../utils/helpers');

const logger = createBotLogger('Wydarzynier');

class InteractionHandler {
    constructor(config, lobbyService, timerService, bazarService) {
        this.config = config;
        this.lobbyService = lobbyService;
        this.timerService = timerService;
        this.bazarService = bazarService;
    }

    /**
     * Rejestruje komendy slash
     * @param {Client} client - Klient Discord
     */
    async registerSlashCommands(client) {
        const commands = [
            new SlashCommandBuilder()
                .setName('party')
                .setDescription('Tworzy lobby do zbierania graczy na party'),
            
            new SlashCommandBuilder()
                .setName('bazar')
                .setDescription('Tworzy kategorię i kanały bazaru (tylko administratorzy)')
                .addIntegerOption(option =>
                    option.setName('godzina')
                        .setDescription('Godzina startu resetów bazaru')
                        .setRequired(true)
                        .addChoices(
                            { name: '17:00', value: 17 },
                            { name: '18:00', value: 18 }
                        )
                )
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
            new SlashCommandBuilder()
                .setName('bazar-off')
                .setDescription('Usuwa kategorię i kanały bazaru (tylko administratorzy)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
            new SlashCommandBuilder()
                .setName('party-access')
                .setDescription('Tworzy wiadomość z przyciskiem do roli powiadomień o party (tylko administratorzy)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];

        const rest = new REST().setToken(this.config.token);
        
        try {
            logger.info('Rozpoczynam rejestrację slash commands...');
            
            // Pobierz guild ID z pierwszego serwera (podobnie jak w innych botach)
            const guildId = client.guilds.cache.first()?.id;
            if (!guildId) {
                logger.error('Nie znaleziono serwera do rejestracji komend');
                return;
            }
            
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            
            logger.info('Slash commands zostały pomyślnie zarejestrowane!');
        } catch (error) {
            logger.error('Błąd podczas rejestracji slash commands:', error);
        }
    }

    /**
     * Obsługuje interakcje
     * @param {Interaction} interaction - Interakcja Discord
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleInteraction(interaction, sharedState) {
        if (interaction.isChatInputCommand()) {
            await this.handleSlashCommand(interaction, sharedState);
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction, sharedState);
        }
    }

    /**
     * Obsługuje komendy slash
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleSlashCommand(interaction, sharedState) {
        const { commandName, channelId, user, guild } = interaction;

        if (commandName === 'party') {
            // Sprawdź czy komenda jest używana na właściwym kanale
            if (!isAllowedChannel(channelId, this.config.channels.party)) {
                await interaction.reply({
                    content: this.config.messages.channelOnly,
                    ephemeral: true
                });
                return;
            }

            // Sprawdź czy użytkownik ma już aktywne lobby i usuń je
            if (sharedState.lobbyService.hasActiveLobby(user.id)) {
                // Znajdź istniejące lobby użytkownika
                const existingLobby = sharedState.lobbyService.getAllActiveLobbies()
                    .find(lobby => lobby.ownerId === user.id);
                
                if (existingLobby) {
                    // Usuń stare lobby
                    await this.deleteLobby(existingLobby, sharedState);
                    logger.info(`🗑️ Usunięto poprzednie lobby użytkownika ${user.id} przed utworzeniem nowego`);
                }
            }

            await this.createPartyLobby(interaction, sharedState);
        } else if (commandName === 'bazar') {
            await this.handleBazarCommand(interaction, sharedState);
        } else if (commandName === 'bazar-off') {
            await this.handleBazarOffCommand(interaction, sharedState);
        } else if (commandName === 'party-access') {
            await this.handlePartyAccessCommand(interaction, sharedState);
        }
    }

    /**
     * Tworzy lobby party
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async createPartyLobby(interaction, sharedState) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const { user, guild, channel } = interaction;
            const member = await guild.members.fetch(user.id);
            const displayName = member.displayName || user.username;

            // Utwórz prywatny wątek
            const thread = await channel.threads.create({
                name: this.config.lobby.threadName(displayName),
                autoArchiveDuration: 60, // 1 godzina
                type: ChannelType.PrivateThread,
                reason: `Party lobby utworzone przez ${displayName}`,
                invitable: false // Wyłącz opcję "Każdy może zapraszać"
            });

            // Uwaga: Wątki nie obsługują permissionOverwrites jak zwykłe kanały
            // Będziemy monitorować wiadomości i usuwać niechciane pingi

            // Dodaj użytkownika do wątku
            await thread.members.add(user.id);

            // Wyślij wiadomość powitania w wątku
            await thread.send(this.config.messages.lobbyCreated(user.id));

            // Utwórz wiadomość ogłoszeniową na kanale głównym
            const announcementMessage = await channel.send(
                this.config.messages.partyAnnouncement(displayName, 1, this.config.lobby.maxPlayers)
            );

            // Dodaj reakcję do wiadomości ogłoszeniowej
            await announcementMessage.react(this.config.emoji.ticket);

            // Okresowo sprawdzaj czy nie ma nieprawidłowych reakcji
            this.startReactionCleanup(announcementMessage, sharedState);

            // Zarejestruj lobby w serwisie
            const lobby = await sharedState.lobbyService.createLobby(
                user.id, 
                displayName, 
                thread, 
                announcementMessage
            );

            // Utwórz timer dla lobby
            const warningCallback = async () => {
                try {
                    await thread.send(this.config.messages.lobbyWarning);
                } catch (error) {
                    logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla lobby ${lobby.id}:`, error);
                }
            };

            const deleteCallback = async () => {
                try {
                    await this.deleteLobby(lobby, sharedState);
                } catch (error) {
                    logger.error(`❌ Błąd podczas usuwania lobby ${lobby.id}:`, error);
                }
            };

            await sharedState.timerService.createLobbyTimer(
                lobby.id, 
                lobby.createdAt, 
                warningCallback, 
                deleteCallback
            );

            await interaction.editReply({
                content: `✅ Lobby zostało utworzone! Wątek: <#${thread.id}>\n⏰ Lobby zostanie automatycznie usunięte po 1 godzinie.`
            });


        } catch (error) {
            logger.error('❌ Błąd podczas tworzenia lobby:', error);
            
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas tworzenia lobby.'
                });
            }
        }
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleButtonInteraction(interaction, sharedState) {
        const { customId, user, message } = interaction;
        
        // Obsługa przycisku powiadomień o party (dostępny dla wszystkich)
        if (customId === 'toggle_party_notifications' || customId === 'party_access_notifications') {
            await this.handleToggleNotifications(interaction, sharedState);
            return;
        }
        
        // Znajdź lobby na podstawie wiadomości
        const lobby = sharedState.lobbyService.getLobbyByThreadId(message.channel.id);
        if (!lobby) {
            await interaction.reply({
                content: '❌ Nie znaleziono powiązanego lobby.',
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy tylko właściciel może używać przycisków (oprócz powiadomień)
        if (user.id !== lobby.ownerId) {
            await interaction.reply({
                content: this.config.messages.ownerOnly,
                ephemeral: true
            });
            return;
        }

        await delay(500); // Mały debounce

        if (customId.startsWith('accept_')) {
            await this.handleAcceptPlayer(interaction, customId, lobby, sharedState);
        } else if (customId.startsWith('reject_')) {
            await this.handleRejectPlayer(interaction, customId, lobby, sharedState);
        }
    }

    /**
     * Obsługuje akceptację gracza
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {string} customId - ID przycisku
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleAcceptPlayer(interaction, customId, lobby, sharedState) {
        const playerId = customId.replace('accept_', '');
        
        try {
            // Dodaj gracza do lobby
            const added = sharedState.lobbyService.addPlayerToLobby(lobby.id, playerId);
            
            if (added) {
                // Dodaj gracza do wątku
                const thread = await interaction.guild.channels.fetch(lobby.threadId);
                await thread.members.add(playerId);

                // Wyślij wiadomość o dodaniu gracza
                await thread.send(this.config.messages.playerAdded(playerId));

                // Usuń oczekującą prośbę
                sharedState.lobbyService.removePendingRequest(lobby.id, playerId);

                // Aktualizuj wiadomość ogłoszeniową z nową liczbą graczy
                await this.updateAnnouncementMessage(lobby, sharedState);

                // Usuń wiadomość z prośbą bezpośrednio
                try {
                    await interaction.message.delete();
                } catch (error) {
                    // Jeśli nie można usunąć wiadomości, zaktualizuj ją
                    try {
                        await interaction.update({
                            content: '✅ **Zaakceptowano**',
                            components: []
                        });
                    } catch (updateError) {
                        logger.error('❌ Błąd podczas aktualizacji wiadomości:', updateError);
                    }
                }

                // Sprawdź czy lobby jest pełne
                if (lobby.isFull) {
                    await this.handleFullLobby(lobby, sharedState);
                }

            } else {
                await interaction.reply({
                    content: '❌ Nie można dodać gracza (lobby może być pełne).',
                    ephemeral: true
                });
            }
        } catch (error) {
            logger.error('❌ Błąd podczas akceptacji gracza:', error);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas akceptacji gracza.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje odrzucenie gracza
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {string} customId - ID przycisku
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRejectPlayer(interaction, customId, lobby, sharedState) {
        const playerId = customId.replace('reject_', '');
        
        try {
            // Wyślij prywatną wiadomość do odrzuconego gracza
            const player = await interaction.guild.members.fetch(playerId);
            try {
                await player.send(this.config.messages.playerRejected);
            } catch (dmError) {
                // Jeśli nie można wysłać DM, zignoruj błąd
                logger.warn(`Nie można wysłać DM do gracza ${playerId}`);
            }

            // Usuń oczekującą prośbę
            sharedState.lobbyService.removePendingRequest(lobby.id, playerId);

            // Usuń wiadomość z prośbą bezpośrednio
            try {
                await interaction.message.delete();
            } catch (error) {
                // Jeśli nie można usunąć wiadomości, zaktualizuj ją
                try {
                    await interaction.update({
                        content: '❌ **Odrzucono**',
                        components: []
                    });
                } catch (updateError) {
                    logger.error('❌ Błąd podczas aktualizacji wiadomości:', updateError);
                }
            }

        } catch (error) {
            logger.error('❌ Błąd podczas odrzucania gracza:', error);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas odrzucania gracza.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje pełne lobby
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleFullLobby(lobby, sharedState) {
        try {
            // Wyślij wiadomość o pełnym lobby z przyciskiem powiadomień
            const thread = await sharedState.client.channels.fetch(lobby.threadId);
            
            // Utwórz przycisk do zarządzania rolą powiadomień
            const notificationButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('toggle_party_notifications')
                        .setLabel('🔔 Powiadomienia o party')
                        .setStyle(ButtonStyle.Success)
                );

            await thread.send({
                content: this.config.messages.lobbyFull,
                components: [notificationButton]
            });

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi pełnego lobby:', error);
        }
    }

    /**
     * Usuwa lobby i czyści zasoby
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async deleteLobby(lobby, sharedState) {
        try {
            // Usuń wątek
            const thread = await sharedState.client.channels.fetch(lobby.threadId).catch(() => null);
            if (thread) {
                await thread.delete('Czas lobby upłynął');
            }

            // Usuń wiadomość ogłoszeniową
            const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
            const announcementMessage = await channel.messages.fetch(lobby.announcementMessageId).catch(() => null);
            if (announcementMessage) {
                await announcementMessage.delete();
            }

            // Usuń lobby z serwisu
            sharedState.lobbyService.removeLobby(lobby.id);

            // Usuń timer
            if (sharedState.timerService) {
                sharedState.timerService.removeTimer(lobby.id);
            }

            logger.info(`🗑️ Usunięto lobby ${lobby.id} wraz z zasobami`);
        } catch (error) {
            logger.error('❌ Błąd podczas usuwania lobby:', error);
        }
    }

    /**
     * Uruchamia okresowe czyszczenie nieprawidłowych reakcji
     * @param {Message} message - Wiadomość ogłoszeniowa
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    startReactionCleanup(message, sharedState) {
        const interval = setInterval(async () => {
            try {
                // Sprawdź czy lobby nadal istnieje
                const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(message.id);
                if (!lobby) {
                    clearInterval(interval);
                    return;
                }

                // Odśwież wiadomość
                await message.fetch();

                // Sprawdź wszystkie reakcje
                const allowedEmoji = this.config.emoji.ticket;
                
                for (const [emojiId, reaction] of message.reactions.cache) {
                    if (reaction.emoji.toString() !== allowedEmoji) {
                        try {
                            await reaction.remove();
                        } catch (error) {
                            logger.error('❌ Błąd podczas czyszczenia reakcji:', error);
                        }
                    }
                }

                // Upewnij się, że bot ma swoją reakcję ticket
                const ticketReaction = message.reactions.cache.find(r => r.emoji.toString() === allowedEmoji);
                if (!ticketReaction || !ticketReaction.users.cache.has(sharedState.client.user.id)) {
                    try {
                        await message.react(allowedEmoji);
                    } catch (error) {
                        logger.error('❌ Błąd podczas dodawania reakcji bota:', error);
                    }
                }

            } catch (error) {
                logger.error('❌ Błąd podczas okresowego czyszczenia reakcji:', error);
                clearInterval(interval);
            }
        }, 30000); // Co 30 sekund

        // Zatrzymaj czyszczenie po 1 godzinie (maksymalny czas lobby)
        setTimeout(() => {
            clearInterval(interval);
        }, this.config.lobby.maxDuration);
    }

    /**
     * Aktualizuje wiadomość ogłoszeniową z aktualną liczbą graczy
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async updateAnnouncementMessage(lobby, sharedState) {
        try {
            const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
            const announcementMessage = await channel.messages.fetch(lobby.announcementMessageId).catch(() => null);
            
            if (announcementMessage) {
                const updatedContent = this.config.messages.partyAnnouncement(
                    lobby.ownerDisplayName, 
                    lobby.players.length, 
                    this.config.lobby.maxPlayers
                );
                
                await announcementMessage.edit(updatedContent);
            }
        } catch (error) {
            logger.error('❌ Błąd podczas aktualizacji wiadomości ogłoszeniowej:', error);
        }
    }

    /**
     * Obsługuje komendę /bazar
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleBazarCommand(interaction, sharedState) {
        try {
            // Sprawdź uprawnienia administratora
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({
                    content: '❌ Ta komenda wymaga uprawnień administratora.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            const startHour = interaction.options.getInteger('godzina');
            const result = await this.bazarService.createBazar(interaction.guild, startHour);

            if (result.success) {
                await interaction.editReply({
                    content: `✅ ${result.message}\n📁 Kategoria: <#${result.categoryId}>\n📋 Kanały: ${result.channelIds.map(id => `<#${id}>`).join(', ')}`
                });
                logger.info(`Utworzono bazar dla serwera ${interaction.guild.name} z godziną startu ${startHour}:00`);
            } else {
                await interaction.editReply({
                    content: `❌ ${result.message}`
                });
            }

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /bazar:', error);
            
            const errorMessage = '❌ Wystąpił błąd podczas tworzenia bazaru.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }

    /**
     * Obsługuje komendę /bazar-off
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleBazarOffCommand(interaction, sharedState) {
        try {
            // Sprawdź uprawnienia administratora
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({
                    content: '❌ Ta komenda wymaga uprawnień administratora.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            const result = await this.bazarService.removeBazar(interaction.guild);

            if (result.success) {
                await interaction.editReply({
                    content: `✅ ${result.message}`
                });
                logger.info(`Usunięto bazar dla serwera ${interaction.guild.name}`);
            } else {
                await interaction.editReply({
                    content: `❌ ${result.message}`
                });
            }

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /bazar-off:', error);
            
            const errorMessage = '❌ Wystąpił błąd podczas usuwania bazaru.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }

    /**
     * Obsługuje przełączanie powiadomień o party
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleToggleNotifications(interaction, sharedState) {
        try {
            const { user, guild } = interaction;
            const member = await guild.members.fetch(user.id);
            const notificationRoleId = this.config.roles.partyNotifications;
            
            // Sprawdź czy użytkownik ma już rolę
            const hasRole = member.roles.cache.has(notificationRoleId);
            
            if (hasRole) {
                // Usuń rolę
                await member.roles.remove(notificationRoleId);
                await interaction.reply({
                    content: '🔕 Usunięto rolę powiadomień o party. Nie będziesz już otrzymywał powiadomień.',
                    ephemeral: true
                });
            } else {
                // Dodaj rolę
                await member.roles.add(notificationRoleId);
                await interaction.reply({
                    content: '🔔 Dodano rolę powiadomień o party! Będziesz otrzymywał powiadomienia o nowych lobby.',
                    ephemeral: true
                });
            }
            
        } catch (error) {
            logger.error('❌ Błąd podczas przełączania powiadomień:', error);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas zmiany ustawień powiadomień.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje komendę /party-access
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyAccessCommand(interaction, sharedState) {
        try {
            // Sprawdź uprawnienia administratora
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({
                    content: '❌ Ta komenda wymaga uprawnień administratora.',
                    ephemeral: true
                });
                return;
            }

            // Utwórz przycisk do zarządzania rolą powiadomień
            const notificationButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('party_access_notifications')
                        .setLabel('🔔 Otrzymuj powiadomienia o Party')
                        .setStyle(ButtonStyle.Success)
                );

            // Wyślij wiadomość z przyciskiem
            await interaction.reply({
                content: 'Chcesz otrzymywać powiadomienia o tworzonych przez użytkowników **Party?**',
                components: [notificationButton]
            });

            logger.info(`✅ Wysłano wiadomość party-access przez ${interaction.user.tag} na kanale ${interaction.channel.name}`);

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /party-access:', error);
            
            const errorMessage = '❌ Wystąpił błąd podczas tworzenia wiadomości party-access.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
}

/**
 * Główna funkcja obsługi interakcji
 * @param {Interaction} interaction - Interakcja Discord
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleInteraction(interaction, sharedState) {
    const handler = new InteractionHandler(sharedState.config, sharedState.lobbyService, sharedState.timerService, sharedState.bazarService);
    await handler.handleInteraction(interaction, sharedState);
}

module.exports = {
    handleInteraction,
    InteractionHandler
};