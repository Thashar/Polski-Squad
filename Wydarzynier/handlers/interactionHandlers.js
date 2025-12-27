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
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
            new SlashCommandBuilder()
                .setName('party-kick')
                .setDescription('Usuwa gracza z twojego party')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do usunięcia z party')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('party-close')
                .setDescription('Zamyka i usuwa twoje lobby'),
            
            new SlashCommandBuilder()
                .setName('party-add')
                .setDescription('Dodaje użytkownika bezpośrednio do twojego lobby')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do dodania do lobby')
                        .setRequired(true)
                )
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
                    logger.info(`🗑️ Usunięto poprzednie lobby użytkownika ${user.tag} przed utworzeniem nowego`);
                }
            }

            await this.createPartyLobby(interaction, sharedState);
        } else if (commandName === 'bazar') {
            await this.handleBazarCommand(interaction, sharedState);
        } else if (commandName === 'bazar-off') {
            await this.handleBazarOffCommand(interaction, sharedState);
        } else if (commandName === 'party-access') {
            await this.handlePartyAccessCommand(interaction, sharedState);
        } else if (commandName === 'party-kick') {
            await this.handlePartyKickCommand(interaction, sharedState);
        } else if (commandName === 'party-close') {
            await this.handlePartyCloseCommand(interaction, sharedState);
        } else if (commandName === 'party-add') {
            await this.handlePartyAddCommand(interaction, sharedState);
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

            // Utwórz przycisk do dołączania
            const joinButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`join_lobby_${Date.now()}`)
                        .setLabel('Dołącz do Party')
                        .setEmoji(this.config.emoji.ticket)
                        .setStyle(ButtonStyle.Primary)
                );

            // Utwórz wiadomość ogłoszeniową na kanale głównym
            const announcementMessage = await channel.send({
                content: this.config.messages.partyAnnouncement(displayName, 1, this.config.lobby.maxPlayers),
                components: [joinButton]
            });

            // Buttony nie wymagają czyszczenia reakcji

            // Zarejestruj lobby w serwisie
            const lobby = await sharedState.lobbyService.createLobby(
                user.id, 
                displayName, 
                thread, 
                announcementMessage
            );

            // Utwórz timer dla lobby
            const warningCallback = async (lobbyId) => {
                try {
                    // Pobierz aktualne dane lobby
                    const currentLobby = sharedState.lobbyService.getLobby(lobbyId);
                    if (!currentLobby) return;

                    // Utwórz przyciski dla właściciela lobby
                    const warningButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`extend_lobby_${lobbyId}`)
                                .setLabel('Przedłuż o 15 min')
                                .setEmoji('⏰')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`close_lobby_${lobbyId}`)
                                .setLabel('Zamknij lobby')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Danger)
                        );

                    await thread.send({
                        content: this.config.messages.lobbyWarning(currentLobby.ownerId),
                        components: [warningButtons]
                    });
                } catch (error) {
                    logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla lobby ${lobbyId}:`, error);
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
                content: `✅ Lobby zostało utworzone! Wątek: <#${thread.id}>\n⏰ Lobby zostanie automatycznie usunięte po 15 minutach.`
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

        // Obsługa przycisku dołączania do lobby
        if (customId.startsWith('join_lobby_')) {
            await this.handleJoinLobbyButton(interaction, sharedState);
            return;
        }

        // Obsługa przycisku przedłużenia lobby (tylko właściciel)
        if (customId.startsWith('extend_lobby_')) {
            await this.handleExtendLobbyButton(interaction, sharedState);
            return;
        }

        // Obsługa przycisku zamknięcia lobby (tylko właściciel)
        if (customId.startsWith('close_lobby_')) {
            await this.handleCloseLobbyButton(interaction, sharedState);
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

            // Ustaw nowy timer na 15 minut od zapełnienia
            const warningCallback = async (lobbyId) => {
                try {
                    // Pobierz aktualne dane lobby
                    const currentLobby = sharedState.lobbyService.getLobby(lobbyId);
                    if (!currentLobby) return;

                    // Utwórz przyciski dla właściciela lobby
                    const warningButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`extend_lobby_${lobbyId}`)
                                .setLabel('Przedłuż o 15 min')
                                .setEmoji('⏰')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`close_lobby_${lobbyId}`)
                                .setLabel('Zamknij lobby')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Danger)
                        );

                    await thread.send({
                        content: this.config.messages.lobbyWarning(currentLobby.ownerId),
                        components: [warningButtons]
                    });
                } catch (error) {
                    logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla pełnego lobby ${lobbyId}:`, error);
                }
            };

            const deleteCallback = async () => {
                try {
                    await this.deleteLobby(lobby, sharedState);
                } catch (error) {
                    logger.error(`❌ Błąd podczas usuwania pełnego lobby ${lobby.id}:`, error);
                }
            };

            // Zastąp istniejący timer nowym 15-minutowym
            await sharedState.timerService.createFullLobbyTimer(
                lobby.id,
                warningCallback,
                deleteCallback
            );

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

                // Pobierz customId z aktualnego przycisku (jeśli istnieje)
                const currentButton = announcementMessage.components[0]?.components[0];
                const customId = currentButton?.customId || `join_lobby_${Date.now()}`;

                // Utwórz przycisk z odpowiednim stanem (wyłączony jeśli pełne)
                const joinButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(customId)
                            .setLabel('Dołącz do Party')
                            .setEmoji(this.config.emoji.ticket)
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(lobby.isFull) // Wyłącz przycisk gdy lobby pełne
                    );

                await announcementMessage.edit({
                    content: updatedContent,
                    components: [joinButton]
                });
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
     * Obsługuje przycisk dołączania do lobby
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleJoinLobbyButton(interaction, sharedState) {
        const { user, message } = interaction;

        // Znajdź lobby na podstawie wiadomości
        const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(message.id);
        if (!lobby) {
            await interaction.reply({
                content: '❌ Nie znaleziono lobby dla tej wiadomości.',
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy lobby nie jest pełne
        if (lobby.isFull) {
            await interaction.reply({
                content: sharedState.config.messages.lobbyFullEphemeral,
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy użytkownik to nie właściciel lobby
        if (user.id === lobby.ownerId) {
            await interaction.reply({
                content: '❌ Nie możesz dołączyć do własnego lobby.',
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy użytkownik już jest w lobby
        if (lobby.players.includes(user.id)) {
            await interaction.reply({
                content: '❌ Już jesteś w tym lobby.',
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy użytkownik ma już oczekującą prośbę
        if (sharedState.lobbyService.hasPendingRequest(lobby.id, user.id)) {
            await interaction.reply({
                content: '❌ Masz już wysłaną prośbę do tego lobby.',
                ephemeral: true
            });
            return;
        }

        // Utwórz prośbę o dołączenie
        try {
            await this.createJoinRequestFromButton(lobby, user, sharedState);
            await interaction.reply({
                content: '✅ Wysłano prośbę o dołączenie do lobby!',
                ephemeral: true
            });
        } catch (error) {
            logger.error('❌ Błąd podczas tworzenia prośby:', error);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas wysyłania prośby.',
                ephemeral: true
            });
        }
    }

    /**
     * Tworzy prośbę o dołączenie z button interaction
     * @param {Object} lobby - Dane lobby
     * @param {User} user - Użytkownik chcący dołączyć
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async createJoinRequestFromButton(lobby, user, sharedState) {
        // Pobierz wątek lobby
        const thread = await sharedState.client.channels.fetch(lobby.threadId);
        
        // Pobierz dane członka serwera dla wyświetlenia nicku
        const guild = thread.guild;
        const member = await guild.members.fetch(user.id);
        const displayName = member.displayName || user.username;

        // Utwórz przyciski
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${user.id}`)
                    .setLabel('Tak')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${user.id}`)
                    .setLabel('Nie')
                    .setStyle(ButtonStyle.Danger)
            );

        // Wyślij wiadomość z przyciskami
        const requestMessage = await thread.send({
            content: sharedState.config.messages.joinRequest(displayName),
            components: [row]
        });

        // Zarejestruj oczekującą prośbę
        sharedState.lobbyService.addPendingRequest(lobby.id, user.id, requestMessage.id);
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
     * Obsługuje komendę /party-kick
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyKickCommand(interaction, sharedState) {
        try {
            const targetUser = interaction.options.getUser('użytkownik');
            
            // Znajdź lobby właściciela
            const ownerLobby = sharedState.lobbyService.getAllActiveLobbies()
                .find(lobby => lobby.ownerId === interaction.user.id);
            
            if (!ownerLobby) {
                await interaction.reply({
                    content: '❌ Nie masz aktywnego lobby.',
                    ephemeral: true
                });
                return;
            }

            // Sprawdź czy użytkownik jest w lobby
            const playerIndex = ownerLobby.players.indexOf(targetUser.id);
            if (playerIndex === -1) {
                await interaction.reply({
                    content: `❌ ${targetUser.displayName || targetUser.username} nie jest w twoim lobby.`,
                    ephemeral: true
                });
                return;
            }

            // Nie można wykopać siebie
            if (targetUser.id === interaction.user.id) {
                await interaction.reply({
                    content: '❌ Nie możesz wykopać samego siebie z lobby.',
                    ephemeral: true
                });
                return;
            }

            // Usuń gracza z lobby
            ownerLobby.players.splice(playerIndex, 1);
            
            // Sprawdź czy lobby nie jest już pełne
            if (ownerLobby.isFull && ownerLobby.players.length < this.config.lobby.maxPlayers) {
                ownerLobby.isFull = false;
            }

            // Zapisz zmiany
            await sharedState.lobbyService.saveLobbies();

            // Usuń gracza z wątku
            try {
                const thread = await sharedState.client.channels.fetch(ownerLobby.threadId);
                await thread.members.remove(targetUser.id);
                
                // Wyślij informację w wątku
                await thread.send(`👢 **${targetUser.displayName || targetUser.username}** został usunięty z lobby przez właściciela.`);
            } catch (threadError) {
                logger.error('❌ Błąd podczas usuwania z wątku:', threadError);
            }

            // Aktualizuj wiadomość ogłoszeniową
            try {
                const channel = await sharedState.client.channels.fetch(this.config.channels.party);
                const announcementMessage = await channel.messages.fetch(ownerLobby.announcementMessageId).catch(() => null);
                
                if (announcementMessage) {
                    const updatedContent = this.config.messages.partyAnnouncement(
                        ownerLobby.ownerDisplayName, 
                        ownerLobby.players.length, 
                        this.config.lobby.maxPlayers
                    );
                    
                    await announcementMessage.edit({
                        content: updatedContent,
                        components: announcementMessage.components // Zachowaj przycisk
                    });
                }
            } catch (error) {
                logger.error('❌ Błąd podczas aktualizacji wiadomości:', error);
            }

            // Wyślij prywatną wiadomość do usuniętego gracza
            try {
                await targetUser.send(`👢 Zostałeś usunięty z lobby **${ownerLobby.ownerDisplayName}** przez właściciela.`);
            } catch (dmError) {
                // Ignoruj błędy DM
            }

            await interaction.reply({
                content: `✅ Usunięto **${targetUser.displayName || targetUser.username}** z lobby.`,
                ephemeral: true
            });

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /party-kick:', error);
            
            const errorMessage = '❌ Wystąpił błąd podczas usuwania gracza z lobby.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }

    /**
     * Obsługuje komendę /party-close
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyCloseCommand(interaction, sharedState) {
        try {
            // Defer interaction na początku aby uniknąć timeout
            await interaction.deferReply({ ephemeral: true });

            // Znajdź lobby właściciela
            const ownerLobby = sharedState.lobbyService.getAllActiveLobbies()
                .find(lobby => lobby.ownerId === interaction.user.id);
            
            if (!ownerLobby) {
                await interaction.editReply({
                    content: '❌ Nie masz aktywnego lobby.'
                });
                return;
            }

            // Wyślij wiadomość pożegnalną w wątku przed zamknięciem
            try {
                const thread = await sharedState.client.channels.fetch(ownerLobby.threadId);
                await thread.send(`🔒 **Lobby zostało zamknięte przez właściciela.**\nDziękujemy za udział!`);
            } catch (threadError) {
                logger.error('❌ Błąd podczas wysyłania wiadomości pożegnalnej:', threadError);
            }

            // Usuń lobby używając istniejącej funkcji
            await this.deleteLobby(ownerLobby, sharedState);

            try {
                await interaction.editReply({
                    content: '✅ Lobby zostało pomyślnie zamknięte.'
                });
            } catch (replyError) {
                // Jeśli nie można edytować odpowiedzi (Unknown Message), to znaczy że interakcja wygasła
                // ale lobby zostało pomyślnie zamknięte
                if (replyError.code === 10008) {
                    logger.info('ℹ️ Lobby zamknięte pomyślnie (interakcja wygasła)');
                } else {
                    throw replyError;
                }
            }

        } catch (error) {
            // Jeśli błąd to Unknown Message, lobby zostało zamknięte ale nie można wysłać potwierdzenia
            if (error.code === 10008) {
                logger.info('ℹ️ Lobby zamknięte pomyślnie (nie można wysłać potwierdzenia - interakcja wygasła)');
                return;
            }

            logger.error('❌ Błąd podczas obsługi komendy /party-close:', error);

            try {
                const errorMessage = '❌ Wystąpił błąd podczas zamykania lobby.';
                if (interaction.deferred) {
                    await interaction.editReply({ content: errorMessage });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                // Jeśli to Unknown Message, lobby i tak zostało zamknięte
                if (replyError.code !== 10008) {
                    logger.error('❌ Nie można odpowiedzieć na interakcję /party-close:', replyError);
                }
            }
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

    /**
     * Obsługuje przycisk przedłużenia lobby o 15 minut
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleExtendLobbyButton(interaction, sharedState) {
        try {
            // Defer interaction na początku aby uniknąć timeout
            await interaction.deferUpdate();
            
            const lobbyId = interaction.customId.replace('extend_lobby_', '');
            const lobby = sharedState.lobbyService.getLobby(lobbyId);
            
            if (!lobby) {
                await interaction.followUp({
                    content: '❌ Nie znaleziono lobby.',
                    ephemeral: true
                });
                return;
            }

            // Sprawdź czy użytkownik to właściciel lobby
            if (interaction.user.id !== lobby.ownerId) {
                await interaction.followUp({
                    content: '❌ Tylko właściciel lobby może przedłużyć czas.',
                    ephemeral: true
                });
                return;
            }


            // Pobierz wątek
            const thread = await sharedState.client.channels.fetch(lobby.threadId);

            // Utwórz nowy timer na 15 minut
            const warningCallback = async (lobbyId) => {
                try {
                    // Pobierz aktualne dane lobby
                    const currentLobby = sharedState.lobbyService.getLobby(lobbyId);
                    if (!currentLobby) return;

                    // Utwórz przyciski dla właściciela lobby
                    const warningButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`extend_lobby_${lobbyId}`)
                                .setLabel('Przedłuż o 15 min')
                                .setEmoji('⏰')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`close_lobby_${lobbyId}`)
                                .setLabel('Zamknij lobby')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Danger)
                        );

                    await thread.send({
                        content: this.config.messages.lobbyWarning(currentLobby.ownerId),
                        components: [warningButtons]
                    });
                } catch (error) {
                    logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla przedłużonego lobby ${lobbyId}:`, error);
                }
            };

            const deleteCallback = async () => {
                try {
                    await this.deleteLobby(lobby, sharedState);
                } catch (error) {
                    logger.error(`❌ Błąd podczas usuwania przedłużonego lobby ${lobbyId}:`, error);
                }
            };


            // Utwórz nowy timer na 15 minut
            await sharedState.timerService.createFullLobbyTimer(
                lobbyId,
                warningCallback,
                deleteCallback
            );

            // Zaktualizuj wiadomość ostrzeżenia
            await interaction.editReply({
                content: '✅ **Lobby zostało przedłużone o 15 minut!**',
                components: []
            });

            logger.info(`⏰ Lobby ${lobbyId} zostało przedłużone o 15 minut przez ${interaction.user.tag}`);

        } catch (error) {
            logger.error('❌ Błąd podczas przedłużania lobby:', error);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Wystąpił błąd podczas przedłużania lobby.',
                        components: []
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Wystąpił błąd podczas przedłużania lobby.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error('❌ Nie można odpowiedzieć na interakcję przedłużenia:', replyError);
            }
        }
    }

    /**
     * Obsługuje przycisk zamknięcia lobby
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleCloseLobbyButton(interaction, sharedState) {
        try {
            // Defer interaction na początku aby uniknąć timeout
            await interaction.deferUpdate();
            
            const lobbyId = interaction.customId.replace('close_lobby_', '');
            const lobby = sharedState.lobbyService.getLobby(lobbyId);
            
            if (!lobby) {
                await interaction.followUp({
                    content: '❌ Nie znaleziono lobby.',
                    ephemeral: true
                });
                return;
            }

            // Sprawdź czy użytkownik to właściciel lobby
            if (interaction.user.id !== lobby.ownerId) {
                await interaction.followUp({
                    content: '❌ Tylko właściciel lobby może zamknąć lobby.',
                    ephemeral: true
                });
                return;
            }

            // Wyślij wiadomość pożegnalną w wątku przed zamknięciem
            try {
                const thread = await sharedState.client.channels.fetch(lobby.threadId);
                await thread.send(`🔒 **Lobby zostało zamknięte przez właściciela.**\nDziękujemy za udział!`);
            } catch (threadError) {
                logger.error('❌ Błąd podczas wysyłania wiadomości pożegnalnej:', threadError);
            }

            // Zaktualizuj wiadomość ostrzeżenia
            await interaction.editReply({
                content: '🔒 **Lobby zostało zamknięte przez właściciela.**',
                components: []
            });

            // Usuń lobby
            await this.deleteLobby(lobby, sharedState);

            logger.info(`🔒 Lobby ${lobbyId} zostało zamknięte przez właściciela ${interaction.user.tag}`);

        } catch (error) {
            logger.error('❌ Błąd podczas zamykania lobby:', error);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Wystąpił błąd podczas zamykania lobby.',
                        components: []
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Wystąpił błąd podczas zamykania lobby.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error('❌ Nie można odpowiedzieć na interakcję zamknięcia:', replyError);
            }
        }
    }

    /**
     * Obsługuje komendę /party-add
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyAddCommand(interaction, sharedState) {
        try {
            // Defer interaction na początku aby uniknąć timeout
            await interaction.deferReply({ ephemeral: true });

            const targetUser = interaction.options.getUser('użytkownik');
            
            // Znajdź lobby właściciela
            const ownerLobby = sharedState.lobbyService.getAllActiveLobbies()
                .find(lobby => lobby.ownerId === interaction.user.id);
            
            if (!ownerLobby) {
                await interaction.editReply({
                    content: '❌ Nie masz aktywnego lobby.'
                });
                return;
            }

            // Sprawdź czy lobby nie jest pełne
            if (ownerLobby.isFull) {
                await interaction.editReply({
                    content: '❌ Twoje lobby jest już pełne.'
                });
                return;
            }

            // Sprawdź czy użytkownik już jest w lobby
            if (ownerLobby.players.includes(targetUser.id)) {
                await interaction.editReply({
                    content: `❌ ${targetUser.displayName || targetUser.username} już jest w twoim lobby.`
                });
                return;
            }

            // Sprawdź czy to nie właściciel próbuje dodać siebie
            if (targetUser.id === interaction.user.id) {
                await interaction.editReply({
                    content: '❌ Już jesteś w swoim lobby jako właściciel.'
                });
                return;
            }

            // Dodaj gracza do lobby (bez procedury akceptacji)
            const added = sharedState.lobbyService.addPlayerToLobby(ownerLobby.id, targetUser.id);
            
            if (added) {
                // Dodaj gracza do wątku
                const thread = await sharedState.client.channels.fetch(ownerLobby.threadId);
                await thread.members.add(targetUser.id);

                // Wyślij wiadomość o dodaniu gracza
                await thread.send(sharedState.config.messages.playerAdded(targetUser.id));

                // Aktualizuj wiadomość ogłoszeniową z nową liczbą graczy
                await this.updateAnnouncementMessage(ownerLobby, sharedState);

                // Sprawdź czy lobby jest pełne
                if (ownerLobby.isFull) {
                    await this.handleFullLobby(ownerLobby, sharedState);
                }

                await interaction.editReply({
                    content: `✅ Dodano **${targetUser.displayName || targetUser.username}** do lobby.`
                });

            } else {
                await interaction.editReply({
                    content: '❌ Nie można dodać gracza do lobby.'
                });
            }

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /party-add:', error);
            
            try {
                const errorMessage = '❌ Wystąpił błąd podczas dodawania gracza do lobby.';
                if (interaction.deferred) {
                    await interaction.editReply({ content: errorMessage });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                logger.error('❌ Nie można odpowiedzieć na interakcję /party-add:', replyError);
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