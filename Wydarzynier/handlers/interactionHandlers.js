const { SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { delay, runThreadCountdown, isGoneError, isNetworkError } = require('../utils/helpers');
const { handlePrzypominienInteraction } = require('./przypominienHandlers');

const logger = createBotLogger('Wydarzynier');

// Panele ±1 (/rewards, /correct): panelId -> webhook interakcji, która wysłała panel.
// Minusy są w drugiej wiadomości, więc po kliknięciu trzeba odświeżyć pierwszą (embed + plusy).
// Mapa musi być modułowa - dla każdej interakcji tworzona jest nowa instancja InteractionHandler.
const rewardPanels = new Map();

// Lobby, dla których trwa przepisywanie pytania o nagrodę - blokada przed podwójną wysyłką
// (również modułowa, bo każda wiadomość dostaje własną instancję InteractionHandler).
const rewardPromptRepositioning = new Set();

// Sposób potwierdzenia interakcji (deferReply vs deferUpdate). discord.js oznacza oba
// jako `deferred`, a odpowiedź trzeba wysłać inaczej: po deferReply wisi „Bot myśli…",
// które domyka wyłącznie editReply; po deferUpdate nic nie wisi i pasuje followUp.
const ACK_MODE = Symbol('wydarzynierAckMode');

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
        // /correct - domyślnie tylko administratorzy. Gdy w `WYDARZYNIER_CORRECT_ROLES` są role,
        // komenda musi być widoczna dla wszystkich (Discord ukryłby ją przed nie-adminami),
        // a uprawnienia sprawdza `canCorrectRewards` przy wywołaniu i przy każdym kliknięciu
        const correctRoles = this.config.roles.correctRewards || [];

        const correctCommand = new SlashCommandBuilder()
            .setName('correct')
            .setDescription(correctRoles.length > 0
                ? 'Panel korekty nagród gracza z party - wpływa na ranking /stats (administratorzy i uprawnione role)'
                : 'Panel korekty nagród gracza z party - wpływa na ranking /stats (tylko administratorzy)')
            .addUserOption(option =>
                option.setName('użytkownik')
                    .setDescription('Użytkownik, któremu korygujemy nagrody')
                    .setRequired(true)
            );

        if (correctRoles.length === 0) {
            correctCommand.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
        }

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
                ),

            new SlashCommandBuilder()
                .setName('stats')
                .setDescription('Ranking nagród specjalnych zdobytych w party'),

            new SlashCommandBuilder()
                .setName('rewards')
                .setDescription('Twoje nagrody - z party i dodane samodzielnie, z możliwością korekty własnych'),

            correctCommand
        ];

        const rest = new REST().setToken(this.config.token);
        
        try {
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

            logger.info('Zarejestrowano slash commands');
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
        const { commandName, channelId } = interaction;

        if (commandName === 'party') {
            // Sprawdź czy komenda jest używana na właściwym kanale
            if (channelId !== this.config.channels.party) {
                await interaction.reply({
                    content: this.config.messages.channelOnly,
                    ephemeral: true
                });
                return;
            }

            // Usuwanie ewentualnego starego lobby dzieje się w createPartyLobby,
            // już po potwierdzeniu interakcji
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
        } else if (commandName === 'stats') {
            await this.handleStatsCommand(interaction, sharedState);
        } else if (commandName === 'rewards') {
            await this.handleRewardsCommand(interaction, sharedState);
        } else if (commandName === 'correct') {
            await this.handleCorrectCommand(interaction, sharedState);
        }
    }

    /**
     * Tworzy lobby party
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async createPartyLobby(interaction, sharedState) {
        try {
            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /party' })) return;

            const { user, guild, channel } = interaction;

            // Jedno lobby na osobę - stare znika przed utworzeniem nowego. Kasowanie idzie PO
            // potwierdzeniu interakcji, bo to kilka requestów do Discorda (wątek + ogłoszenie)
            // i potrafiło samo w sobie przekroczyć 3 s na pierwszą odpowiedź
            if (sharedState.lobbyService.hasActiveLobby(user.id)) {
                const existingLobby = sharedState.lobbyService.getAllActiveLobbies()
                    .find(lobby => lobby.ownerId === user.id);

                if (existingLobby) {
                    await this.deleteLobby(existingLobby, sharedState);
                    logger.info(`🗑️ Usunięto poprzednie lobby użytkownika ${user.username} przed utworzeniem nowego`);
                }
            }

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
                await this.sendLobbyWarning(lobbyId, sharedState);
            };

            const deleteCallback = async () => {
                try {
                    // Czas lobby upłynął - w wątku leci odliczanie, dopiero potem znika
                    await this.closeLobbyWithCountdown(lobby, sharedState, this.config.messages.lobbyExpiredCountdown);
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

        // Obsługa przycisku subskrypcji powiadomień o eventach
        if (customId === 'event_notifications_subscribe') {
            await this.handleEventNotificationsSubscribe(interaction, sharedState);
            return;
        }

        // Obsługa przycisku powiadomień o party (dostępny dla wszystkich)
        if (customId === 'toggle_party_notifications' || customId === 'party_access_notifications') {
            await this.handleToggleNotifications(interaction, sharedState);
            return;
        }

        // Obsługa przycisków nagród specjalnych (czerwone skrzynki)
        if (customId.startsWith('reward_pick_')) {
            await this.handleRewardPickButton(interaction, sharedState);
            return;
        }

        if (customId.startsWith('reward_yes_')) {
            await this.handleRewardConfirmButton(interaction, sharedState);
            return;
        }

        if (customId === 'reward_no') {
            await this.handleRewardRejectButton(interaction, sharedState);
            return;
        }

        // „Nikt z obecnych nie otrzymał czerwonej skrzynki" - tylko w pytaniu przy zamykaniu lobby
        if (customId.startsWith('reward_none_')) {
            await this.handleRewardNoneButton(interaction, sharedState);
            return;
        }

        // Wyszarzone przyciski po zgłoszeniu nagrody - nieklikalne, zabezpieczenie na wszelki wypadek
        if (customId.startsWith('reward_done_')) {
            await this.acknowledgeInteraction(interaction, { update: true, label: 'Wyszarzony przycisk nagrody' });
            return;
        }

        // Stronicowanie rankingu /stats
        if (customId.startsWith('stats_page_')) {
            await this.handleStatsPageButton(interaction, sharedState);
            return;
        }

        // Korekta własnych nagród w panelu /rewards
        if (customId.startsWith('myrw_')) {
            await this.handleOwnRewardButton(interaction, sharedState);
            return;
        }

        // Panel korekty nagród (/correct dla administratorów)
        if (customId.startsWith('corr_')) {
            await this.handleCorrectionButton(interaction, sharedState);
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

        // Obsługa przycisków tablicy przypomnień (muszą być przed sprawdzaniem lobby)
        if (
            customId === 'goto_control_panel' ||
            customId.startsWith('scheduled_send_') ||
            customId.startsWith('scheduled_preview_') ||
            customId.startsWith('scheduled_pause_') ||
            customId.startsWith('scheduled_resume_') ||
            customId.startsWith('scheduled_edit_') ||
            customId.startsWith('scheduled_delete_') ||
            customId.startsWith('edit_scheduled_') ||
            customId.startsWith('ch_cat_')
        ) {
            await handlePrzypominienInteraction(interaction, sharedState);
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

        if (!customId.startsWith('accept_') && !customId.startsWith('reject_')) return;

        // Potwierdzenie PRZED debounce'em i pracą - obie ścieżki robią kilka requestów do
        // Discorda (wątek, DM, ogłoszenie), a sam debounce zjadał 0,5 s z limitu 3 s
        if (!await this.acknowledgeInteraction(interaction, { update: true, label: 'Prośba o dołączenie do lobby' })) return;

        await delay(500); // Mały debounce

        if (customId.startsWith('accept_')) {
            await this.handleAcceptPlayer(interaction, customId, lobby, sharedState);
        } else {
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
                    // Jeśli nie można usunąć wiadomości, zaktualizuj ją.
                    // Interakcja jest już potwierdzona (deferUpdate), więc edytujemy przez editReply
                    try {
                        await interaction.editReply({
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
                await this.respondEphemeral(interaction, '❌ Nie można dodać gracza (lobby może być pełne).');
            }
        } catch (error) {
            logger.error('❌ Błąd podczas akceptacji gracza:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas akceptacji gracza.');
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
                // Jeśli nie można usunąć wiadomości, zaktualizuj ją.
                // Interakcja jest już potwierdzona (deferUpdate), więc edytujemy przez editReply
                try {
                    await interaction.editReply({
                        content: '❌ **Odrzucono**',
                        components: []
                    });
                } catch (updateError) {
                    logger.error('❌ Błąd podczas aktualizacji wiadomości:', updateError);
                }
            }

        } catch (error) {
            logger.error('❌ Błąd podczas odrzucania gracza:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas odrzucania gracza.');
        }
    }

    /**
     * Wysyła w wątku ostrzeżenie o kończącym się czasie lobby wraz z przyciskami właściciela.
     * Wątek pobierany jest na świeżo - callback odpala się kilkanaście minut po utworzeniu timera,
     * więc obiekt wątku z domknięcia mógł już przestać istnieć.
     * @param {string} lobbyId - ID lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async sendLobbyWarning(lobbyId, sharedState) {
        const currentLobby = sharedState.lobbyService.getLobby(lobbyId);
        if (!currentLobby) return;

        try {
            const thread = await sharedState.client.channels.fetch(currentLobby.threadId);

            // Przyciski dla właściciela lobby
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
            if (isGoneError(error)) {
                // Wątku nie ma, choć lobby wisi w pamięci - ślad po sprzątaniu przerwanym w połowie.
                // Dokańczamy je tutaj, zamiast raz po raz strzelać w nieistniejący kanał.
                logger.warn(`⚠️ Wątek lobby ${lobbyId} już nie istnieje - usuwam osierocone lobby zamiast wysyłać ostrzeżenie`);
                sharedState.lobbyService.removeLobby(lobbyId);
                sharedState.timerService?.removeTimer(lobbyId);
                return;
            }

            logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla lobby ${lobbyId}:`, error);
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

            // Zaplanuj pytanie o nagrodę specjalną (1 minuta po zapełnieniu lobby)
            await this.scheduleRewardPrompt(lobby, sharedState);

            // Ustaw nowy timer na 15 minut od zapełnienia
            const warningCallback = async (lobbyId) => {
                await this.sendLobbyWarning(lobbyId, sharedState);
            };

            const deleteCallback = async () => {
                try {
                    // Czas lobby upłynął - w wątku leci odliczanie, dopiero potem znika
                    await this.closeLobbyWithCountdown(lobby, sharedState, this.config.messages.lobbyExpiredCountdown);
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
     * Planuje pytanie o nagrodę specjalną (1 minuta po zapełnieniu lobby)
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async scheduleRewardPrompt(lobby, sharedState) {
        try {
            // Nie planuj ponownie jeśli pytanie już zostało wysłane lub zaplanowane
            if (lobby.rewardPromptSent || lobby.rewardPromptAt) return;

            const delayMs = this.config.lobby.rewardPromptDelay;

            lobby.rewardPromptAt = Date.now() + delayMs;
            lobby.rewardPromptSent = false;
            await sharedState.lobbyService.saveLobbies();

            setTimeout(() => {
                this.sendRewardPrompt(lobby.id, sharedState).catch(error => {
                    logger.error(`❌ Błąd podczas wysyłania pytania o nagrodę dla lobby ${lobby.id}:`, error);
                });
            }, delayMs);

        } catch (error) {
            logger.error('❌ Błąd podczas planowania pytania o nagrodę:', error);
        }
    }

    /**
     * Wysyła pytanie o nagrodę specjalną wraz z przyciskami emoji
     * @param {string} lobbyId - ID lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async sendRewardPrompt(lobbyId, sharedState) {
        const lobby = sharedState.lobbyService.getLobby(lobbyId);
        if (!lobby || lobby.rewardPromptSent) return;

        // Pytanie zostało anulowane (właściciel kogoś wyrzucił)
        if (!lobby.rewardPromptAt) return;

        // Timer sprzed anulowania - po ponownym zapełnieniu obowiązuje nowy termin
        if (Date.now() + 1000 < lobby.rewardPromptAt) return;

        const thread = await sharedState.client.channels.fetch(lobby.threadId).catch(() => null);
        if (!thread) {
            logger.warn(`⚠️ Nie znaleziono wątku lobby ${lobbyId} - pytanie o nagrodę pominięte`);
            return;
        }

        const promptMessage = await thread.send({
            content: this.config.messages.rewardPrompt,
            components: this.buildRewardButtons()
        });

        lobby.rewardPromptSent = true;
        lobby.rewardPromptAt = null;
        lobby.rewardPromptMessageId = promptMessage.id;
        lobby.rewardPromptMessagesSince = 0;
        await sharedState.lobbyService.saveLobbies();

        logger.info(`🎁 Wysłano pytanie o nagrodę specjalną w lobby ${lobbyId}`);
    }

    /**
     * Kasuje pytanie o nagrodę po wyrzuceniu gracza przez właściciela (`/party-kick`) - wiadomość
     * znika z wątku, przepisywanie się zatrzymuje, a po ponownym zapełnieniu pytanie jest planowane od nowa.
     * Samodzielne wyjście gracza z lobby pytania NIE kasuje.
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async cancelRewardPrompt(lobby, sharedState) {
        try {
            if (!lobby || (!lobby.rewardPromptSent && !lobby.rewardPromptAt && !lobby.rewardPromptMessageId)) return;

            const thread = await sharedState.client.channels.fetch(lobby.threadId).catch(() => null);

            if (thread) {
                const prompts = await this.findRewardPromptMessages(thread);

                for (const prompt of prompts) {
                    await prompt.delete().catch(error =>
                        logger.warn(`⚠️ Nie udało się usunąć pytania o nagrodę: ${error.message}`)
                    );
                }
            }

            // Wyzerowanie stanu = przy kolejnym zapełnieniu `scheduleRewardPrompt` zaplanuje pytanie ponownie
            lobby.rewardPromptSent = false;
            lobby.rewardPromptAt = null;
            lobby.rewardPromptMessageId = null;
            lobby.rewardPromptMessagesSince = 0;
            lobby.rewardPromptClosesLobby = false;
            await sharedState.lobbyService.saveLobbies();

            logger.info(`🗑️ Party ${lobby.id} przestało być pełne - usunięto pytanie o nagrodę`);

        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania pytania o nagrodę (${lobby?.id}):`, error);
        }
    }

    /**
     * Liczy wiadomości w wątku lobby i co N wiadomości przepisuje pytanie o nagrodę na koniec,
     * żeby nie uciekło graczom w górę rozmowy (analogicznie do repozycjonowania ogłoszenia party).
     * @param {Message} message - Nowa wiadomość w wątku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardPromptReposition(message, sharedState) {
        try {
            // Wiadomości bota nie przesuwają licznika - inaczej samo przepisane pytanie
            // wyzwalałoby kolejne przepisanie i pytania mnożyłyby się w nieskończoność
            if (message.author?.id === sharedState.client.user.id) return;

            const lobby = sharedState.lobbyService.getLobbyByThreadId(message.channelId);
            if (!lobby?.rewardPromptMessageId) return;

            // Pytania zadanego przy zamykaniu lobby nie przepisujemy - czeka na wybór i znika razem z wątkiem
            if (lobby.rewardPromptClosesLobby) return;

            // Losowanie zamknięte (nagroda zgłoszona) albo przepisywanie właśnie trwa
            if (sharedState.nagrodyService.getPromptClaimer(lobby.rewardPromptMessageId)) return;
            if (rewardPromptRepositioning.has(lobby.id)) return;

            lobby.rewardPromptMessagesSince = (lobby.rewardPromptMessagesSince || 0) + 1;

            if (lobby.rewardPromptMessagesSince < this.config.lobby.rewardPromptRepositionMessages) {
                await sharedState.lobbyService.saveLobbies();
                return;
            }

            // Licznik zerujemy przed wysyłką - wiadomości, które przyjdą w trakcie
            // przepisywania, nie mogą wyzwolić go drugi raz
            lobby.rewardPromptMessagesSince = 0;
            rewardPromptRepositioning.add(lobby.id);

            try {
                await this.repositionRewardPrompt(lobby, message.channel, sharedState);
            } finally {
                rewardPromptRepositioning.delete(lobby.id);
            }

        } catch (error) {
            logger.error('❌ Błąd podczas liczenia wiadomości do przepisania pytania o nagrodę:', error);
        }
    }

    /**
     * Znajduje w wątku wiadomości bota z pytaniem o nagrodę (rozpoznawane po przyciskach `reward_pick_`)
     * @param {ThreadChannel} thread - Wątek lobby
     * @returns {Array} - Znalezione wiadomości z pytaniem
     */
    async findRewardPromptMessages(thread) {
        const messages = await thread.messages.fetch({ limit: 50 });

        return [...messages.values()].filter(message =>
            message.author?.id === thread.client.user.id &&
            message.components?.some(row =>
                row.components?.some(component => component.customId?.startsWith('reward_pick_'))
            )
        );
    }

    /**
     * Przepisuje pytanie o nagrodę na koniec wątku - stare wiadomości są usuwane,
     * bo zgłoszenia są kluczowane po ID wiadomości z pytaniem (dwie żywe kopie = dwie blokady)
     * @param {Object} lobby - Dane lobby
     * @param {ThreadChannel} thread - Wątek lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async repositionRewardPrompt(lobby, thread, sharedState) {
        try {
            // Kasujemy każdą kopię pytania w wątku, także osieroconą po wcześniejszych błędach
            const oldPrompts = await this.findRewardPromptMessages(thread);

            for (const oldPrompt of oldPrompts) {
                await oldPrompt.delete().catch(error =>
                    logger.warn(`⚠️ Nie udało się usunąć starego pytania o nagrodę: ${error.message}`)
                );
            }

            const newMessage = await thread.send({
                content: this.config.messages.rewardPrompt,
                components: this.buildRewardButtons()
            });

            lobby.rewardPromptMessageId = newMessage.id;
            lobby.rewardPromptMessagesSince = 0;
            await sharedState.lobbyService.saveLobbies();

            logger.info(`🔄 Przepisano pytanie o nagrodę na koniec wątku lobby ${lobby.id} (usunięto starych: ${oldPrompts.length})`);

        } catch (error) {
            logger.error(`❌ Błąd podczas przepisywania pytania o nagrodę (${lobby.id}):`, error);
        }
    }

    /**
     * Buduje rzędy przycisków nagród (same ikony, bez opisów).
     * Emotki serwera renderują się na przyciskach - w listach wyboru slash commands nie.
     * @param {Function} idFactory - Funkcja budująca customId dla nagrody
     * @param {boolean} disabled - Czy przyciski mają być nieaktywne (wyszarzone)
     * @returns {Array} - Rzędy przycisków
     */
    buildRewardButtons(idFactory = reward => `reward_pick_${reward.key}`, disabled = false) {
        const rows = [];

        for (let i = 0; i < this.config.rewards.length; i += 5) {
            const buttons = this.config.rewards.slice(i, i + 5).map(reward =>
                new ButtonBuilder()
                    .setCustomId(idFactory(reward))
                    .setEmoji(reward.emoji)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled)
            );

            rows.push(new ActionRowBuilder().addComponents(...buttons));
        }

        return rows;
    }

    /**
     * Wysyła pytanie o nagrodę przy zamykaniu lobby (`/party-close`), gdy zwykłe pytanie
     * jeszcze się nie pojawiło. Pod nagrodami dochodzi przycisk „nikt nie otrzymał",
     * a wybór dowolnej opcji kończy się odliczaniem i usunięciem wątku.
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @returns {boolean} - Czy pytanie zostało wysłane
     */
    async sendClosingRewardPrompt(lobby, sharedState) {
        try {
            const thread = await sharedState.client.channels.fetch(lobby.threadId).catch(() => null);
            if (!thread) return false;

            const message = await thread.send({
                content: this.config.messages.rewardPromptOnClose,
                components: this.buildClosingRewardButtons(lobby.id)
            });

            lobby.rewardPromptSent = true;
            lobby.rewardPromptAt = null;
            lobby.rewardPromptMessageId = message.id;
            lobby.rewardPromptMessagesSince = 0;
            lobby.rewardPromptClosesLobby = true;
            await sharedState.lobbyService.saveLobbies();

            logger.info(`🎁 Wysłano pytanie o nagrodę przy zamykaniu lobby ${lobby.id}`);
            return true;

        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania pytania o nagrodę przy zamykaniu lobby ${lobby.id}:`, error);
            return false;
        }
    }

    /**
     * Buduje przyciski pytania zamykającego - nagrody + przycisk „nikt nie otrzymał" na dole
     * @param {string} lobbyId - ID lobby
     * @param {boolean} disabled - Czy przyciski mają być nieaktywne
     * @returns {Array} - Rzędy przycisków
     */
    buildClosingRewardButtons(lobbyId, disabled = false) {
        const rows = this.buildRewardButtons(
            reward => disabled ? `reward_done_${reward.key}` : `reward_pick_${reward.key}`,
            disabled
        );

        // Ostatni rząd rezerwujemy na przycisk „nikt nie otrzymał" (limit Discorda to 5 rzędów)
        if (rows.length >= 5) {
            logger.warn(`⚠️ Za dużo nagród (${this.config.rewards.length}) - w pytaniu zamykającym mieści się 20, nadmiar pominięto`);
            rows.length = 4;
        }

        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reward_none_${lobbyId}`)
                .setLabel(this.config.messages.rewardNoneButton)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled)
        ));

        return rows;
    }

    /**
     * Obsługuje przycisk „Nikt z obecnych nie otrzymał czerwonej skrzynki" - zamyka lobby bez nagrody
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardNoneButton(interaction, sharedState) {
        try {
            const lobbyId = interaction.customId.replace('reward_none_', '');
            const lobby = sharedState.lobbyService.getLobby(lobbyId);

            if (!lobby) {
                await interaction.reply({
                    content: '❌ To lobby zostało już zamknięte.',
                    ephemeral: true
                });
                return;
            }

            await interaction.update({
                content: `${this.config.messages.rewardPromptOnClose}\n\n${this.config.messages.rewardNoneAcknowledged(interaction.user.id)}`,
                components: this.buildClosingRewardButtons(lobbyId, true)
            });

            logger.info(`📭 ${interaction.user.username} zamknął lobby ${lobbyId} bez zgłoszenia nagrody`);

            await this.closeLobbyWithCountdown(lobby, sharedState);

        } catch (error) {
            logger.error('❌ Błąd podczas zamykania lobby bez nagrody:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas zamykania lobby.');
        }
    }

    /**
     * Zamyka pytanie o nagrodę - wyszarza przyciski wspólnej wiadomości i dopisuje kto zgłosił nagrodę.
     * Wywoływane po pierwszym zgłoszeniu, bo w losowaniu nagrodę odbiera tylko jedna osoba.
     * @param {Message} promptMessage - Wiadomość z pytaniem o nagrodę
     * @param {string} claimerId - ID osoby, która zgłosiła nagrodę
     * @returns {boolean} - Czy udało się zamknąć pytanie
     */
    async closeRewardPrompt(promptMessage, claimerId, lobby = null) {
        if (!promptMessage) return false;

        // Pytanie zamykające ma inną treść i dodatkowy przycisk „nikt nie otrzymał"
        const closesLobby = Boolean(lobby?.rewardPromptClosesLobby);

        try {
            await promptMessage.edit({
                content: closesLobby
                    ? `${this.config.messages.rewardPromptOnClose}\n\n${this.config.messages.rewardPromptClosed(claimerId)}`
                    : `${this.config.messages.rewardPrompt}\n\n${this.config.messages.rewardPromptClosed(claimerId)}`,
                components: closesLobby
                    ? this.buildClosingRewardButtons(lobby.id, true)
                    : this.buildRewardButtons(reward => `reward_done_${reward.key}`, true)
            });
            return true;
        } catch (error) {
            logger.error('❌ Błąd podczas wyłączania przycisków nagrody:', error);
            return false;
        }
    }

    /**
     * Pobiera wiadomość z pytaniem o nagrodę na podstawie ID kanału i wiadomości
     * @param {string} channelId - ID kanału (wątku lobby)
     * @param {string} messageId - ID wiadomości z pytaniem
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @returns {Message|null} - Wiadomość albo null
     */
    async fetchRewardPrompt(channelId, messageId, sharedState) {
        const channel = await sharedState.client.channels.fetch(channelId).catch(() => null);
        if (!channel) return null;

        return channel.messages.fetch(messageId).catch(() => null);
    }

    /**
     * Obsługuje kliknięcie przycisku nagrody - pyta o potwierdzenie
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardPickButton(interaction, sharedState) {
        try {
            const rewardKey = interaction.customId.replace('reward_pick_', '');
            const reward = sharedState.nagrodyService.getRewardDefinition(rewardKey);

            if (!reward) {
                await interaction.reply({
                    content: '❌ Nieznana nagroda.',
                    ephemeral: true
                });
                return;
            }

            // Blokada GLOBALNA - w jednym losowaniu nagrodę zgłasza tylko jedna osoba.
            // Przy pierwszym zgłoszeniu przyciski są wyłączane, ale gdyby edycja wiadomości
            // się nie powiodła (albo ktoś kliknął w międzyczasie), domykamy pytanie tutaj.
            const claimerId = sharedState.nagrodyService.getPromptClaimer(interaction.message.id);

            if (claimerId) {
                await interaction.reply({
                    content: claimerId === interaction.user.id
                        ? `⚠️ ${this.config.messages.rewardAlreadyClaimed}`
                        : `⚠️ ${this.config.messages.rewardAlreadyTaken(claimerId)}`,
                    ephemeral: true
                });

                const lobby = sharedState.lobbyService.getLobbyByThreadId(interaction.channelId);
                await this.closeRewardPrompt(interaction.message, claimerId, lobby);
                return;
            }

            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`reward_yes_${rewardKey}_${interaction.channelId}_${interaction.message.id}`)
                        .setLabel('Tak')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('reward_no')
                        .setLabel('Nie')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.reply({
                content: this.config.messages.rewardConfirmation(reward.name, reward.emoji),
                components: [confirmRow],
                ephemeral: true
            });

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi przycisku nagrody:', error);
        }
    }

    /**
     * Obsługuje potwierdzenie nagrody ("Tak")
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardConfirmButton(interaction, sharedState) {
        try {
            // Potwierdzenie PRZED doliczeniem nagrody - niżej leci zapis `nagrody.json`,
            // pobranie wiadomości z pytaniem i ogłoszenie na kanale party
            if (!await this.acknowledgeInteraction(interaction, { update: true, label: 'Potwierdzenie nagrody' })) return;

            // Format: reward_yes_<klucz>_<idKanału>_<idWiadomości>
            const [, , rewardKey, promptChannelId, clickedPromptId] = interaction.customId.split('_');
            const reward = sharedState.nagrodyService.getRewardDefinition(rewardKey);

            // Pytanie bywa przepisywane na koniec wątku, więc zgłoszenie zapisujemy zawsze
            // na aktualnej wiadomości - inaczej blokada nie objęłaby przepisanego pytania
            const lobby = sharedState.lobbyService.getLobbyByThreadId(promptChannelId);
            const promptMessageId = lobby?.rewardPromptMessageId || clickedPromptId;

            if (!reward) {
                await interaction.editReply({
                    content: '❌ Nieznana nagroda.',
                    components: []
                });
                return;
            }

            // Blokada GLOBALNA - w losowaniu nagrodę odbiera tylko jedna osoba,
            // więc pierwsze potwierdzenie zamyka pytanie dla całego party
            const claimRegistered = sharedState.nagrodyService.tryRegisterClaim(
                promptMessageId,
                interaction.user.id
            );

            if (!claimRegistered) {
                const claimerId = sharedState.nagrodyService.getPromptClaimer(promptMessageId);

                await interaction.editReply({
                    content: claimerId === interaction.user.id
                        ? `⚠️ ${this.config.messages.rewardAlreadyClaimed}`
                        : `⚠️ ${this.config.messages.rewardAlreadyTaken(claimerId)}`,
                    components: []
                });

                const promptMessage = await this.fetchRewardPrompt(promptChannelId, promptMessageId, sharedState);
                await this.closeRewardPrompt(promptMessage, claimerId, lobby);
                return;
            }

            const member = interaction.member;
            const displayName = member?.displayName || interaction.user.username;

            try {
                await sharedState.nagrodyService.addReward(interaction.user.id, displayName, rewardKey);
            } catch (error) {
                // Zwolnij rezerwację, żeby użytkownik mógł spróbować ponownie
                sharedState.nagrodyService.releaseClaim(promptMessageId, interaction.user.id);
                throw error;
            }

            // Nagroda jest już zapisana, więc nieudana odpowiedź nie może przerwać domykania losowania
            await interaction.editReply({
                content: this.config.messages.rewardAccepted(reward.name, reward.emoji),
                components: []
            }).catch(error => logger.warn(`⚠️ Nie udało się pokazać potwierdzenia nagrody: ${error.message}`));

            // Wspólna wiadomość w wątku - wyszarzenie przycisków dla wszystkich uczestników party
            const promptMessage = await this.fetchRewardPrompt(promptChannelId, promptMessageId, sharedState);

            if (!await this.closeRewardPrompt(promptMessage, interaction.user.id, lobby)) {
                logger.warn(`⚠️ Nie udało się wyłączyć przycisków pytania o nagrodę ${promptMessageId} - blokada działa dalej po stronie bota`);
            }

            // Ogłoszenie na kanale party
            try {
                const partyChannel = await sharedState.client.channels.fetch(this.config.channels.party);
                await partyChannel.send(
                    this.config.messages.rewardAnnouncement(interaction.user.id, reward.emoji)
                );
            } catch (error) {
                logger.error('❌ Błąd podczas wysyłania ogłoszenia o nagrodzie:', error);
            }

            logger.info(`🎁 ${displayName} zgłosił nagrodę specjalną: ${reward.name}`);

            // Pytanie zadane przy zamykaniu lobby - po zgłoszeniu odliczamy i usuwamy wątek
            if (lobby?.rewardPromptClosesLobby) {
                await this.closeLobbyWithCountdown(lobby, sharedState);
            }

        } catch (error) {
            logger.error('❌ Błąd podczas potwierdzania nagrody:', error);
        }
    }

    /**
     * Obsługuje odrzucenie potwierdzenia nagrody ("Nie")
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardRejectButton(interaction, sharedState) {
        try {
            await interaction.update({
                content: this.config.messages.rewardDenied,
                components: []
            });
        } catch (error) {
            logger.error('❌ Błąd podczas odrzucania nagrody:', error);
        }
    }

    /**
     * Odmienia słowo "nagroda" według liczby
     * @param {number} count - Liczba nagród
     * @returns {string} - Odmieniona forma
     */
    pluralizeRewards(count) {
        if (count === 1) return 'nagroda';

        const mod10 = count % 10;
        const mod100 = count % 100;

        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'nagrody';
        return 'nagród';
    }

    /**
     * Obsługuje komendę /stats - ranking nagród specjalnych
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleStatsCommand(interaction, sharedState) {
        try {
            const view = this.buildStatsView(sharedState, 0);

            if (!view) {
                await interaction.reply({
                    content: '📊 Nikt jeszcze nie zgłosił żadnej nagrody specjalnej.',
                    ephemeral: true
                });
                return;
            }

            await interaction.reply({ embeds: [view.embed], components: view.components, ephemeral: true });

        } catch (error) {
            logger.error('❌ Błąd podczas wyświetlania rankingu nagród:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas pobierania rankingu.');
        }
    }

    /**
     * Obsługuje przyciski stronicowania rankingu /stats
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleStatsPageButton(interaction, sharedState) {
        try {
            const page = parseInt(interaction.customId.replace('stats_page_', ''), 10) || 0;
            const view = this.buildStatsView(sharedState, page);

            if (!view) {
                await interaction.update({
                    content: '📊 Nikt jeszcze nie zgłosił żadnej nagrody specjalnej.',
                    embeds: [],
                    components: []
                });
                return;
            }

            await interaction.update({ embeds: [view.embed], components: view.components });

        } catch (error) {
            logger.error('❌ Błąd podczas zmiany strony rankingu:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas zmiany strony rankingu.');
        }
    }

    /**
     * Buduje wiersz nagród `emoji×N` - tylko te z niezerowym stanem
     * @param {Object} rewards - Licznik nagród { klucz: liczba }
     * @returns {string} - Rozbicie nagród albo pusty string
     */
    formatRewardBreakdown(rewards) {
        return this.config.rewards
            .filter(reward => (rewards[reward.key] || 0) > 0)
            .map(reward => `${reward.emoji}×${rewards[reward.key]}`)
            .join(' ');
    }

    /**
     * Buduje widok rankingu /stats dla wskazanej strony (embed + przyciski stronicowania)
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @param {number} page - Numer strony (od 0)
     * @returns {Object|null} - { embed, components } albo null gdy ranking jest pusty
     */
    buildStatsView(sharedState, page) {
        const ranking = sharedState.nagrodyService.getRanking();
        if (ranking.length === 0) return null;

        const perPage = this.config.stats.usersPerPage;
        const totalPages = Math.max(1, Math.ceil(ranking.length / perPage));
        const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
        const pageEntries = ranking.slice(currentPage * perPage, (currentPage + 1) * perPage);

        // Układ jak w rankingu EndersEcho: numer w `kodzie`, pogrubiony nick, ikony dopiero
        // w linii cytatu pod spodem, a gracze rozdzieleni pustą linią
        const buildEntry = (entry, index, withBreakdown) => {
            const position = String(currentPage * perPage + index + 1).padStart(2, '0');
            const lines = [`\`${position}\`  **${entry.displayName}**`];

            if (withBreakdown) {
                const party = this.formatRewardBreakdown(entry.rewards);
                const manual = this.formatRewardBreakdown(entry.manualRewards);

                if (party) lines.push(`> ${party}`);
                if (manual) lines.push(`> Zdobyte na randomach:  ${manual}`);
            }

            // Suma na serwerze (licznik z party) ustawia miejsce w rankingu,
            // suma z randomami dolicza jeszcze nagrody dopisane samodzielnie
            lines.push(`> Suma na serwerze: **${entry.total}** | Suma z randomami: **${entry.total + entry.manualTotal}**`);

            return lines.join('\n');
        };

        const buildDescription = withBreakdown => pageEntries
            .map((entry, index) => buildEntry(entry, index, withBreakdown))
            .join('\n\n');

        // Przy bardzo rozbudowanych kontach rozbicie nie mieści się w limicie opisu (4096 znaków)
        let description = buildDescription(true);
        if (description.length > 3800) description = buildDescription(false);

        const partyTotals = sharedState.nagrodyService.getTotalsByReward('party');
        const manualTotals = sharedState.nagrodyService.getTotalsByReward('manual');
        const partySum = ranking.reduce((sum, entry) => sum + entry.total, 0);
        const manualSum = ranking.reduce((sum, entry) => sum + entry.manualTotal, 0);

        const embed = new EmbedBuilder()
            .setTitle('Ranking nagród specjalnych')
            .setColor('#e74c3c')
            .setDescription(description)
            .addFields({
                name: `Łącznie z party   ${partySum} ${this.pluralizeRewards(partySum)}`,
                value: this.formatRewardBreakdown(partyTotals) || 'brak'
            })
            .setFooter({
                text: `Strona ${currentPage + 1}/${totalPages}   Graczy ${ranking.length}`
                    + '   Ranking liczy tylko nagrody z party'
            })
            .setTimestamp();

        if (manualSum > 0) {
            embed.addFields({
                name: `Dodane samodzielnie   ${manualSum} ${this.pluralizeRewards(manualSum)}`,
                value: this.formatRewardBreakdown(manualTotals) || 'brak'
            });
        }

        return { embed, components: this.buildStatsButtons(currentPage, totalPages) };
    }

    /**
     * Buduje przyciski stronicowania rankingu (puste, gdy wszystko mieści się na jednej stronie)
     * @param {number} page - Aktualna strona (od 0)
     * @param {number} totalPages - Liczba stron
     * @returns {Array} - Rzędy przycisków
     */
    buildStatsButtons(page, totalPages) {
        if (totalPages <= 1) return [];

        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`stats_page_${page - 1}`)
                .setLabel('Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page <= 0),
            new ButtonBuilder()
                .setCustomId(`stats_page_${page + 1}`)
                .setLabel('Następna')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        )];
    }

    /**
     * Buduje embed panelu /rewards - nagrody z party i dodane samodzielnie osobno, poniżej suma
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @param {string} lastChange - Opis ostatniej zmiany (opcjonalny)
     * @returns {EmbedBuilder} - Embed panelu
     */
    buildOwnRewardsEmbed(userId, displayName, sharedState, lastChange = null) {
        const stats = sharedState.nagrodyService.getUserStats(userId);
        const fromParty = stats?.rewards || {};
        const manual = stats?.manualRewards || {};
        const partyTotal = stats?.total || 0;
        const manualTotal = stats?.manualTotal || 0;
        const allRewards = partyTotal + manualTotal;

        // Tylko nagrody, które faktycznie posiadasz - reszta jest dostępna na przyciskach poniżej
        const owned = this.config.rewards.filter(reward =>
            (fromParty[reward.key] || 0) > 0 || (manual[reward.key] || 0) > 0
        );

        // Trzy kolumny obok siebie: z party | dodane samodzielnie | razem
        const column = counter => owned
            .map(reward => `${reward.emoji} **${counter(reward)}**`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`🎁 Twoje nagrody — ${displayName}`)
            .setColor('#e74c3c')
            .setFooter({ text: 'Zielone +1 i czerwone -1 zmieniają WYŁĄCZNIE nagrody dodane samodzielnie · do rankingu /stats liczą się tylko nagrody z party' })
            .setTimestamp();

        if (owned.length === 0) {
            embed.setDescription('Nie masz jeszcze żadnych nagród.\nZdobądź je w party albo dopisz sobie zielonym przyciskiem **+1** poniżej.');
        } else {
            embed.addFields(
                {
                    name: '🎉 Z party',
                    value: column(reward => fromParty[reward.key] || 0),
                    inline: true
                },
                {
                    name: '📝 Dodane samodzielnie',
                    value: column(reward => manual[reward.key] || 0),
                    inline: true
                },
                {
                    name: '📦 Razem',
                    value: column(reward => (fromParty[reward.key] || 0) + (manual[reward.key] || 0)),
                    inline: true
                },
                {
                    name: 'Podsumowanie',
                    value: `🎉 Z party: **${partyTotal}** · 📝 Dodane samodzielnie: **${manualTotal}** ` +
                        `· 📦 Łącznie: **${allRewards}** ${this.pluralizeRewards(allRewards)}`
                }
            );
        }

        if (lastChange) {
            embed.addFields({ name: 'Ostatnia zmiana (dodane samodzielnie)', value: lastChange });
        }

        return embed;
    }

    /**
     * Buduje rzędy przycisków nagród dla JEDNEGO znaku (osobna wiadomość na plusy, osobna na minusy).
     * Dzięki rozbiciu na dwie wiadomości limit 5 rzędów Discorda dotyczy każdego znaku osobno,
     * więc mieści się do 25 nagród (zamiast 12 przy wspólnej wiadomości).
     * @param {number} delta - 1 (zielone plusy) albo -1 (czerwone minusy)
     * @param {Function} idFactory - Funkcja budująca customId dla (nagroda, delta)
     * @returns {Array} - Rzędy przycisków
     */
    buildSignedRewardRows(delta, idFactory) {
        const rows = [];

        for (let i = 0; i < this.config.rewards.length; i += 5) {
            const buttons = this.config.rewards.slice(i, i + 5).map(reward =>
                new ButtonBuilder()
                    .setCustomId(idFactory(reward, delta))
                    .setEmoji(reward.emoji)
                    .setLabel(delta > 0 ? '+' : '−')
                    .setStyle(delta > 0 ? ButtonStyle.Success : ButtonStyle.Danger)
            );

            rows.push(new ActionRowBuilder().addComponents(...buttons));
        }

        if (rows.length > 5) {
            logger.warn(`⚠️ Za dużo nagród (${this.config.rewards.length}) - jedna wiadomość panelu mieści maksymalnie 25, nadmiar pominięto`);
            return rows.slice(0, 5);
        }

        return rows;
    }

    /**
     * Generuje identyfikator panelu ±1 (bez podkreśleń - customId jest parsowany przez split('_'))
     * @returns {string} - Identyfikator panelu
     */
    createRewardPanelId() {
        return Math.random().toString(36).slice(2, 10);
    }

    /**
     * Zapamiętuje panel ±1, żeby kliknięcie minusa (druga wiadomość) mogło odświeżyć
     * pierwszą wiadomość z embedem. Token interakcji żyje 15 minut - wpisy wygasają razem z nim.
     * @param {string} panelId - Identyfikator panelu
     * @param {CommandInteraction} interaction - Interakcja, która wysłała panel
     */
    registerRewardPanel(panelId, interaction) {
        const now = Date.now();

        for (const [id, entry] of rewardPanels) {
            if (entry.expiresAt <= now) rewardPanels.delete(id);
        }

        rewardPanels.set(panelId, {
            webhook: interaction.webhook,
            expiresAt: now + 14 * 60 * 1000
        });
    }

    /**
     * Odświeża pierwszą wiadomość panelu ±1 (embed + plusy) po kliknięciu minusa
     * @param {string} panelId - Identyfikator panelu
     * @param {Object} payload - Nowa treść wiadomości
     * @returns {boolean} - Czy udało się odświeżyć
     */
    async refreshRewardPanel(panelId, payload) {
        const panel = panelId ? rewardPanels.get(panelId) : null;

        if (!panel || panel.expiresAt <= Date.now()) {
            if (panelId) rewardPanels.delete(panelId);
            return false;
        }

        try {
            await panel.webhook.editMessage('@original', payload);
            return true;
        } catch (error) {
            logger.warn(`⚠️ Nie udało się odświeżyć panelu nagród ${panelId}: ${error.message}`);
            rewardPanels.delete(panelId);
            return false;
        }
    }

    /**
     * Potwierdza interakcję ZANIM handler wykona pracę sięgającą poza pamięć bota
     * (request do API Discorda albo zapis pliku). Discord daje 3 s na pierwszą odpowiedź -
     * po tym czasie token jest martwy, a akcja zdążyła się wykonać bez informacji zwrotnej.
     * @param {Interaction} interaction - Interakcja do potwierdzenia
     * @param {Object} options - `update` = deferUpdate zamiast deferReply, `label` do logów
     * @returns {boolean} - Czy token żyje. `false` = przerwij handler PRZED zmianą danych
     */
    async acknowledgeInteraction(interaction, { update = false, label = 'Interakcja' } = {}) {
        if (interaction.deferred || interaction.replied) return true;

        try {
            if (update) {
                await interaction.deferUpdate();
            } else {
                await interaction.deferReply({ ephemeral: true });
            }

            interaction[ACK_MODE] = update ? 'update' : 'reply';
            return true;

        } catch (error) {
            if (isGoneError(error)) {
                logger.warn(`⚠️ ${label}: token interakcji wygasł przed potwierdzeniem - przerywam bez zmiany danych`);
            } else if (isNetworkError(error)) {
                logger.error(`❌ ${label}: brak łączności z Discordem (${error.code || error.cause?.code}) - przerywam bez zmiany danych`);
            } else {
                logger.error(`❌ ${label}: nie udało się potwierdzić interakcji:`, error);
            }
            return false;
        }
    }

    /**
     * Odpowiada na interakcję niezależnie od tego, czy była już potwierdzona (defer)
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {string} content - Treść odpowiedzi
     */
    async respondEphemeral(interaction, content) {
        const payload = { content, ephemeral: true };

        // Po deferReply wisi „Bot myśli…" - domknie je tylko edycja pierwotnej odpowiedzi
        if (interaction[ACK_MODE] === 'reply' && interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
            return;
        }

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }

    /**
     * Wysyła drugą wiadomość panelu ±1 - same czerwone przyciski, bez tekstu.
     * Discord nie przyjmuje wiadomości bez treści, więc content to spacja zerowej szerokości.
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Array} rows - Rzędy przycisków na minus
     */
    async sendMinusPanelMessage(interaction, rows) {
        await interaction.followUp({
            content: '​',
            components: rows,
            ephemeral: true
        });
    }

    /**
     * Sprawdza, czy użytkownik może korygować nagrody (`/correct`) - administrator
     * albo posiadacz roli z `WYDARZYNIER_CORRECT_ROLES`
     * @param {Interaction} interaction - Interakcja komendy lub przycisku
     * @returns {boolean} - Czy ma uprawnienia
     */
    canCorrectRewards(interaction) {
        if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

        const allowedRoles = this.config.roles.correctRewards || [];
        if (allowedRoles.length === 0) return false;

        // GuildMember ma kolekcję ról, surowy obiekt z API - zwykłą tablicę ID
        const memberRoles = interaction.member?.roles;
        const hasRole = roleId => Array.isArray(memberRoles)
            ? memberRoles.includes(roleId)
            : Boolean(memberRoles?.cache?.has(roleId));

        return allowedRoles.some(hasRole);
    }

    /**
     * Buduje przyciski panelu /rewards dla jednego znaku.
     * Działają wyłącznie na nagrodach dodanych samodzielnie przez właściciela panelu.
     * @param {number} delta - 1 (plusy) albo -1 (minusy)
     * @param {string} panelId - Identyfikator panelu (wymagany dla minusów)
     * @returns {Array} - Rzędy przycisków
     */
    buildOwnRewardsButtons(delta = 1, panelId = null) {
        return this.buildSignedRewardRows(delta, reward =>
            delta > 0
                ? `myrw_${reward.key}_1`
                : `myrw_${reward.key}_-1_${panelId}`
        );
    }

    /**
     * Obsługuje komendę /rewards - panel własnych nagród z korektą nagród dodanych samodzielnie.
     * Panel to dwie wiadomości: embed z zielonymi plusami + osobna wiadomość z czerwonymi minusami.
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleRewardsCommand(interaction, sharedState) {
        try {
            const displayName = interaction.member?.displayName || interaction.user.username;
            const panelId = this.createRewardPanelId();

            await interaction.reply({
                embeds: [this.buildOwnRewardsEmbed(interaction.user.id, displayName, sharedState)],
                components: this.buildOwnRewardsButtons(1),
                ephemeral: true
            });

            this.registerRewardPanel(panelId, interaction);
            await this.sendMinusPanelMessage(interaction, this.buildOwnRewardsButtons(-1, panelId));

        } catch (error) {
            logger.error('❌ Błąd podczas wyświetlania nagród użytkownika:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas pobierania Twoich nagród.');
        }
    }

    /**
     * Obsługuje przyciski panelu /rewards - zmienia o ±1 WYŁĄCZNIE własne nagrody
     * dodane samodzielnie (poza systemem party, poza rankingiem /stats)
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleOwnRewardButton(interaction, sharedState) {
        try {
            // Format: myrw_<klucz>_1 (plusy) albo myrw_<klucz>_-1_<idPanelu> (minusy z drugiej wiadomości)
            const [, rewardKey, rawDelta, panelId] = interaction.customId.split('_');
            const delta = rawDelta === '-1' ? -1 : 1;
            const displayName = interaction.member?.displayName || interaction.user.username;

            // Potwierdzamy klik ZANIM zapiszemy nagrodę - to samo co w panelu /correct: przy odpowiedzi
            // po 3 s token jest już martwy (10062), a nagroda zdążyła się doliczyć bez informacji zwrotnej
            if (!await this.acknowledgeInteraction(interaction, {
                update: true,
                label: `Korekta własnych nagród (${displayName}) - nagroda NIE została zmieniona`
            })) return;

            // Zawsze własne konto i zawsze licznik spoza rankingu
            const result = await sharedState.nagrodyService.correctReward(
                interaction.user.id,
                displayName,
                rewardKey,
                delta,
                'manual'
            );

            if (!result) {
                await this.respondEphemeral(interaction, '❌ Nieznana nagroda.');
                return;
            }

            const { reward, previous, current, applied } = result;
            let lastChange = `${reward.emoji} **${reward.name}**: ${previous} → **${current}**`;

            if (applied === 0) {
                lastChange += '\n⚠️ Licznik nie może zejść poniżej 0 - brak zmiany.';
            }

            // Log PRZED odświeżeniem panelu - zmiana jest już zapisana
            logger.info(`📝 ${displayName} skorygował własną nagrodę ${reward.name}: ${previous} → ${current}`);

            const payload = {
                embeds: [this.buildOwnRewardsEmbed(interaction.user.id, displayName, sharedState, lastChange)],
                components: this.buildOwnRewardsButtons(1)
            };

            if (delta > 0) {
                // Po deferUpdate edytujemy wiadomość z przyciskiem przez editReply - `update()` już nie zadziała
                await interaction.editReply(payload);
            } else if (!await this.refreshRewardPanel(panelId, payload)) {
                // Panel wygasł albo bot się zrestartował - pokazujemy przynajmniej wynik zmiany
                await this.respondEphemeral(
                    interaction,
                    `${lastChange}\n\n💡 Panel jest już nieaktualny - wpisz \`/rewards\`, aby zobaczyć pełny stan.`
                );
            }

        } catch (error) {
            logger.error('❌ Błąd podczas korekty własnych nagród:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas korekty nagród.');
        }
    }

    /**
     * Obsługuje komendę /correct - korekta nagród przez administratora
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleCorrectCommand(interaction, sharedState) {
        try {
            if (!this.canCorrectRewards(interaction)) {
                await interaction.reply({
                    content: '❌ Nie masz uprawnień do korygowania nagród.',
                    ephemeral: true
                });
                return;
            }

            // Potwierdzenie przed `members.fetch` - to request do API, a po nim panel
            // odpowiadał dopiero jako pierwsza reakcja na komendę
            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /correct' })) return;

            const targetUser = interaction.options.getUser('użytkownik');
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const displayName = member?.displayName || targetUser.username;
            const panelId = this.createRewardPanelId();

            await interaction.editReply({
                embeds: [this.buildCorrectionEmbed(targetUser.id, displayName, sharedState)],
                components: this.buildCorrectionButtons(targetUser.id, 1)
            });

            this.registerRewardPanel(panelId, interaction);
            await this.sendMinusPanelMessage(interaction, this.buildCorrectionButtons(targetUser.id, -1, panelId));

        } catch (error) {
            logger.error('❌ Błąd podczas otwierania panelu korekty:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas otwierania panelu korekty.');
        }
    }

    /**
     * Buduje embed panelu korekty ze stanem nagród gracza (licznik z party)
     * @param {string} userId - ID korygowanego gracza
     * @param {string} displayName - Nazwa gracza na serwerze
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @param {string} lastChange - Opis ostatniej zmiany (opcjonalny)
     * @returns {EmbedBuilder} - Embed panelu
     */
    buildCorrectionEmbed(userId, displayName, sharedState, lastChange = null) {
        const stats = sharedState.nagrodyService.getUserStats(userId);
        const rewards = stats?.rewards || {};
        const total = stats?.total || 0;

        // Tylko posiadane nagrody - resztę i tak można dodać przyciskami poniżej
        const owned = this.config.rewards.filter(reward => (rewards[reward.key] || 0) > 0);

        const description = owned.length > 0
            ? owned.map(reward => `${reward.emoji} **${reward.name}** — **${rewards[reward.key]}**`).join('\n')
            : 'Gracz nie ma jeszcze żadnych nagród z party.';

        const embed = new EmbedBuilder()
            .setTitle(`🛠️ Korekta nagród — ${displayName}`)
            .setColor('#f1c40f')
            .setDescription(description)
            .addFields({
                name: 'Łącznie z party',
                value: `${total} ${this.pluralizeRewards(total)}`
            })
            .setFooter({ text: 'Zielone przyciski dodają +1, czerwone odejmują -1 · zmiany wpływają na ranking /stats' })
            .setTimestamp();

        if (lastChange) {
            embed.addFields({ name: 'Ostatnia zmiana', value: lastChange });
        }

        return embed;
    }

    /**
     * Buduje przyciski panelu korekty - komplet nagród na plus i na minus
     * @param {string} userId - ID korygowanego gracza
     * @param {number} delta - 1 (plusy) albo -1 (minusy)
     * @param {string} panelId - Identyfikator panelu (wymagany dla minusów)
     * @returns {Array} - Rzędy przycisków
     */
    buildCorrectionButtons(userId, delta = 1, panelId = null) {
        return this.buildSignedRewardRows(delta, reward =>
            delta > 0
                ? `corr_${userId}_${reward.key}_1`
                : `corr_${userId}_${reward.key}_-1_${panelId}`
        );
    }

    /**
     * Obsługuje przyciski panelu korekty - zmienia nagrodę gracza o ±1
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleCorrectionButton(interaction, sharedState) {
        try {
            if (!this.canCorrectRewards(interaction)) {
                await interaction.reply({
                    content: '❌ Nie masz uprawnień do korygowania nagród.',
                    ephemeral: true
                });
                return;
            }

            // Format: corr_<idGracza>_<klucz>_1 albo corr_<idGracza>_<klucz>_-1_<idPanelu>
            const [, targetUserId, rewardKey, rawDelta, panelId] = interaction.customId.split('_');
            const delta = rawDelta === '-1' ? -1 : 1;

            // Potwierdzamy klik ZANIM cokolwiek policzymy - Discord daje na pierwszą odpowiedź 3 s,
            // a niżej idzie fetch membera (request do API) i zapis nagrody na dysk. Bez tego przy
            // wolniejszym fetchu `update()` trafiało w martwy token (10062) JUŻ PO doliczeniu nagrody:
            // admin widział "interakcja nie powiodła się", klikał ponownie i licznik rósł dwa razy.
            if (!await this.acknowledgeInteraction(interaction, {
                update: true,
                label: `Korekta nagród (${interaction.user.username}) - nagroda NIE została zmieniona`
            })) return;

            const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
            const displayName = member?.displayName
                || sharedState.nagrodyService.getUserStats(targetUserId)?.displayName
                || 'Nieznany';

            // Zawsze licznik z party - czyli ten, który buduje ranking /stats
            const result = await sharedState.nagrodyService.correctReward(
                targetUserId,
                displayName,
                rewardKey,
                delta,
                'party'
            );

            if (!result) {
                await this.respondEphemeral(interaction, '❌ Nieznana nagroda.');
                return;
            }

            const { reward, previous, current, applied } = result;
            let lastChange = `${reward.emoji} **${reward.name}**: ${previous} → **${current}**`;

            if (applied === 0) {
                lastChange += '\n⚠️ Licznik nie może zejść poniżej 0 - brak zmiany.';
            }

            // Log PRZED odświeżeniem panelu - zmiana jest już zapisana, więc musi zostać w logu
            // nawet gdyby samo odrysowanie wiadomości padło
            logger.info(`🛠️ ${interaction.user.username} skorygował nagrodę z party ${reward.name} gracza ${displayName}: ${previous} → ${current}`);

            const payload = {
                embeds: [this.buildCorrectionEmbed(targetUserId, displayName, sharedState, lastChange)],
                components: this.buildCorrectionButtons(targetUserId, 1)
            };

            if (delta > 0) {
                // Po deferUpdate edytujemy wiadomość z przyciskiem przez editReply - `update()` już nie zadziała
                await interaction.editReply(payload);
            } else if (!await this.refreshRewardPanel(panelId, payload)) {
                // Panel wygasł albo bot się zrestartował - pokazujemy przynajmniej wynik zmiany
                await this.respondEphemeral(
                    interaction,
                    `${lastChange}\n\n💡 Panel jest już nieaktualny - wpisz \`/correct\` ponownie, aby zobaczyć pełny stan.`
                );
            }

        } catch (error) {
            logger.error('❌ Błąd podczas korekty nagród:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas korekty nagród.');
        }
    }

    /**
     * Wysyła na końcu wątku wiadomość pożegnalną z odliczaniem i czeka aż dobiegnie końca.
     * Dopiero po odliczaniu wątek może zostać usunięty.
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async runCloseCountdown(lobby, sharedState, messageFactory = null) {
        try {
            const thread = await sharedState.client.channels.fetch(lobby.threadId);

            await runThreadCountdown(
                thread,
                this.config.lobby.closeCountdownSeconds,
                messageFactory || this.config.messages.lobbyCloseCountdown
            );

        } catch (threadError) {
            // Bez wątku nie ma czego odliczać - lobby i tak zostanie zamknięte
            logger.error('❌ Błąd podczas odliczania do usunięcia wątku:', threadError);
        }
    }

    /**
     * Odlicza i usuwa lobby - wspólne domknięcie dla wygasłych timerów i pytania o nagrodę przy zamykaniu
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     * @param {Function} messageFactory - Treść odliczania (domyślnie „zamknięte przez właściciela")
     */
    async closeLobbyWithCountdown(lobby, sharedState, messageFactory = null) {
        await this.runCloseCountdown(lobby, sharedState, messageFactory);
        await this.deleteLobby(lobby, sharedState);
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

            logger.info(`🗑️ Usunięto lobby ${lobby.id} wraz z zasobami`);
        } catch (error) {
            logger.error('❌ Błąd podczas usuwania lobby:', error);
        } finally {
            // Stan lokalny sprzątamy ZAWSZE, także gdy kasowanie po stronie Discorda padło w połowie.
            // Inaczej zanik sieci zostawiał lobby w pamięci i żywy timer, który kilka minut później
            // strzelał ostrzeżeniem w nieistniejący wątek (Unknown Channel).
            sharedState.lobbyService.removeLobby(lobby.id);

            if (sharedState.timerService) {
                sharedState.timerService.removeTimer(lobby.id);
            }
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

            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /bazar' })) return;

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

            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /bazar-off' })) return;

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

        // Potwierdzamy klik od razu - utworzenie prośby to trzy requesty do API (fetch wątku,
        // fetch membera, wysłanie wiadomości), więc bez tego łatwo wyjść poza 3 s Discorda
        // i wysłać prośbę do wątku, o której klikający nigdy się nie dowie (10062)
        if (!await this.acknowledgeInteraction(interaction, {
            label: `Dołączanie do lobby (${user.username}) - prośba NIE została wysłana`
        })) return;

        // Znajdź lobby na podstawie wiadomości
        const lobby = sharedState.lobbyService.getLobbyByAnnouncementId(message.id);
        if (!lobby) {
            await interaction.editReply({
                content: '❌ Nie znaleziono lobby dla tej wiadomości.'
            });
            return;
        }

        // Sprawdź czy lobby nie jest pełne
        if (lobby.isFull) {
            await interaction.editReply({
                content: sharedState.config.messages.lobbyFullEphemeral
            });
            return;
        }

        // Sprawdź czy użytkownik to nie właściciel lobby
        if (user.id === lobby.ownerId) {
            await interaction.editReply({
                content: '❌ Nie możesz dołączyć do własnego lobby.'
            });
            return;
        }

        // Sprawdź czy użytkownik już jest w lobby
        if (lobby.players.includes(user.id)) {
            await interaction.editReply({
                content: '❌ Już jesteś w tym lobby.'
            });
            return;
        }

        // Sprawdź czy użytkownik ma już oczekującą prośbę
        if (sharedState.lobbyService.hasPendingRequest(lobby.id, user.id)) {
            await interaction.editReply({
                content: '❌ Masz już wysłaną prośbę do tego lobby.'
            });
            return;
        }

        // Utwórz prośbę o dołączenie
        try {
            await this.createJoinRequestFromButton(lobby, user, sharedState);
            await interaction.editReply({
                content: '✅ Wysłano prośbę o dołączenie do lobby!'
            });
        } catch (error) {
            logger.error('❌ Błąd podczas tworzenia prośby:', error);
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas wysyłania prośby.'
            }).catch(() => {});
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
        // Potwierdzamy klik ZANIM ruszymy API - niżej idzie fetch membera i zmiana roli, czyli
        // dwa requesty, a Discord daje na pierwszą odpowiedź 3 s. Bez tego rola bywała już
        // nadana, a potwierdzenie leciało w martwy token (10062): użytkownik widział
        // „interakcja nie powiodła się", klikał ponownie i przełącznik ZDEJMOWAŁ mu rolę
        if (!await this.acknowledgeInteraction(interaction, {
            label: `Przełącznik powiadomień (${interaction.user.username}) - rola NIE została zmieniona`
        })) return;

        try {
            const { user, guild } = interaction;
            const member = await guild.members.fetch(user.id);
            const notificationRoleId = this.config.roles.partyNotifications;

            // Sprawdź czy użytkownik ma już rolę
            const hasRole = member.roles.cache.has(notificationRoleId);

            if (hasRole) {
                // Usuń rolę
                await member.roles.remove(notificationRoleId);
                await interaction.editReply({
                    content: '🔕 Usunięto rolę powiadomień o party. Nie będziesz już otrzymywał powiadomień.'
                });
            } else {
                // Dodaj rolę
                await member.roles.add(notificationRoleId);
                await interaction.editReply({
                    content: '🔔 Dodano rolę powiadomień o party! Będziesz otrzymywał powiadomienia o nowych lobby.'
                });
            }

        } catch (error) {
            logger.error('❌ Błąd podczas przełączania powiadomień:', error);
            // editReply, nie followUp - inaczej po deferReply zostałoby wiszące „Bot myśli…"
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas zmiany ustawień powiadomień.'
            }).catch(() => {});
        }
    }

    /**
     * Obsługuje przycisk subskrypcji powiadomień o eventach
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handleEventNotificationsSubscribe(interaction, sharedState) {
        logger.info(`🔔 Obsługa przycisku subskrypcji eventów: ${interaction.user.username}`);

        try {
            if (!await this.acknowledgeInteraction(interaction, {
                label: `Subskrypcja eventów (${interaction.user.username}) - rola NIE została zmieniona`
            })) return;

            const { user, guild } = interaction;
            const member = await guild.members.fetch(user.id);
            const eventNotificationRoleId = '1297587256101699776';

            logger.info(`Sprawdzam rolę ${eventNotificationRoleId} dla ${user.username}`);

            // Sprawdź czy użytkownik ma już rolę
            const hasRole = member.roles.cache.has(eventNotificationRoleId);

            if (hasRole) {
                // Usuń rolę
                await member.roles.remove(eventNotificationRoleId);
                logger.success(`✅ Usunięto rolę powiadomień eventów dla ${user.username}`);
                await interaction.editReply({
                    content: '🔕 Usunięto rolę powiadomień o eventach. Nie będziesz już otrzymywał powiadomień o eventach w grze.'
                });
            } else {
                // Dodaj rolę
                await member.roles.add(eventNotificationRoleId);
                logger.success(`✅ Dodano rolę powiadomień eventów dla ${user.username}`);
                await interaction.editReply({
                    content: '🔔 Dodano rolę powiadomień o eventach! Będziesz otrzymywał powiadomienia o nadchodzących eventach w grze.'
                });
            }

        } catch (error) {
            logger.error('❌ Błąd podczas przełączania powiadomień eventów:', error);

            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Wystąpił błąd podczas zmiany ustawień powiadomień.'
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Wystąpił błąd podczas zmiany ustawień powiadomień.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error('❌ Nie można odpowiedzieć na interakcję:', replyError);
            }
        }
    }

    /**
     * Obsługuje komendę /party-kick
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyKickCommand(interaction, sharedState) {
        try {
            // Potwierdzenie na starcie - niżej leci usunięcie z wątku, edycja ogłoszenia i DM,
            // czyli kilka requestów, które łącznie przekraczały 3 s na pierwszą odpowiedź
            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /party-kick' })) return;

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

            // Sprawdź czy użytkownik jest w lobby
            const playerIndex = ownerLobby.players.indexOf(targetUser.id);
            if (playerIndex === -1) {
                await interaction.editReply({
                    content: `❌ ${targetUser.displayName || targetUser.username} nie jest w twoim lobby.`
                });
                return;
            }

            // Nie można wykopać siebie
            if (targetUser.id === interaction.user.id) {
                await interaction.editReply({
                    content: '❌ Nie możesz wykopać samego siebie z lobby.'
                });
                return;
            }

            // Usuń gracza z lobby
            ownerLobby.players.splice(playerIndex, 1);
            
            // Sprawdź czy lobby nie jest już pełne
            if (ownerLobby.isFull && ownerLobby.players.length < this.config.lobby.maxPlayers) {
                ownerLobby.isFull = false;

                // Właściciel wyrzucił gracza - pytanie o nagrodę znika do czasu ponownego zapełnienia
                await this.cancelRewardPrompt(ownerLobby, sharedState);
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

            await interaction.editReply({
                content: `✅ Usunięto **${targetUser.displayName || targetUser.username}** z lobby.`
            });

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi komendy /party-kick:', error);
            await this.respondEphemeral(interaction, '❌ Wystąpił błąd podczas usuwania gracza z lobby.');
        }
    }

    /**
     * Obsługuje komendę /party-close
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async handlePartyCloseCommand(interaction, sharedState) {
        try {
            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /party-close' })) return;

            // Znajdź lobby właściciela
            const ownerLobby = sharedState.lobbyService.getAllActiveLobbies()
                .find(lobby => lobby.ownerId === interaction.user.id);
            
            if (!ownerLobby) {
                await interaction.editReply({
                    content: '❌ Nie masz aktywnego lobby.'
                });
                return;
            }

            // Pytanie o nagrodę jeszcze się nie pojawiło (lobby nie zdążyło się zapełnić)
            // - najpierw pytamy w wątku, a lobby zamknie się po wybraniu opcji
            if (!ownerLobby.rewardPromptSent && await this.sendClosingRewardPrompt(ownerLobby, sharedState)) {
                await interaction.editReply({
                    content: '📩 W wątku pojawiło się pytanie o nagrodę - lobby zamknie się po wybraniu opcji.'
                }).catch(() => {});
                return;
            }

            // Odliczanie trwa kilka sekund - właściciel od razu dostaje potwierdzenie
            await interaction.editReply({
                content: `⏳ Zamykam lobby - wątek zniknie za ${this.config.lobby.closeCountdownSeconds} s.`
            }).catch(() => {});

            // Wiadomość pożegnalna z odliczaniem na końcu wątku - dopiero po nim znika wątek
            await this.closeLobbyWithCountdown(ownerLobby, sharedState);

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

            logger.info(`✅ Wysłano wiadomość party-access przez ${interaction.user.username} na kanale ${interaction.channel.name}`);

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
            if (!await this.acknowledgeInteraction(interaction, { update: true, label: 'Przedłużenie lobby' })) return;

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
                    // Czas lobby upłynął - w wątku leci odliczanie, dopiero potem znika
                    await this.closeLobbyWithCountdown(lobby, sharedState, this.config.messages.lobbyExpiredCountdown);
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

            logger.info(`⏰ Lobby ${lobbyId} zostało przedłużone o 15 minut przez ${interaction.user.username}`);

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
            if (!await this.acknowledgeInteraction(interaction, { update: true, label: 'Zamknięcie lobby przyciskiem' })) return;

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

            logger.info(`🔒 Lobby ${lobbyId} zostało zamknięte przez właściciela ${interaction.user.username}`);

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
            if (!await this.acknowledgeInteraction(interaction, { label: 'Komenda /party-add' })) return;

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
    // Sprawdź czy to interakcja z systemem przypomnień/eventów
    const isPrzypominienInteraction = (
        (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() ||
         interaction.isRoleSelectMenu() || interaction.isModalSubmit()) &&
        interaction.customId &&
        interaction.customId !== 'event_notifications_subscribe' && // Wyjątek dla przycisku subskrypcji
        (
            interaction.customId.startsWith('board_') ||
            interaction.customId.startsWith('template_') ||
            interaction.customId.startsWith('scheduled_') ||
            interaction.customId.startsWith('set_reminder_') ||
            interaction.customId.startsWith('new_reminder_') ||
            interaction.customId.startsWith('edit_template_') ||
            interaction.customId.startsWith('edit_reminder_') ||
            interaction.customId.startsWith('edit_scheduled_') ||
            interaction.customId.startsWith('event_') ||
            interaction.customId.startsWith('add_event_') ||
            interaction.customId.startsWith('delete_event_') ||
            interaction.customId.startsWith('edit_event_') ||
            interaction.customId.startsWith('confirm_delete_template_') ||
            interaction.customId.startsWith('confirm_delete_scheduled_') ||
            interaction.customId.startsWith('confirm_delete_event_') ||
            interaction.customId.startsWith('cancel_delete_') ||
            interaction.customId === 'event_list_channel_select' ||
            interaction.customId === 'put_list' ||
            interaction.customId.startsWith('channel_string_select_') ||
            interaction.customId.startsWith('ch_cat_') ||
            interaction.customId.startsWith('scheduled_page_manual_') ||
            interaction.customId.startsWith('edit_reminder_manual')
        )
    );

    // Przekieruj do odpowiedniego handlera
    if (isPrzypominienInteraction) {
        await handlePrzypominienInteraction(interaction, sharedState);
    } else {
        const handler = new InteractionHandler(sharedState.config, sharedState.lobbyService, sharedState.timerService, sharedState.bazarService);
        await handler.handleInteraction(interaction, sharedState);
    }
}

/**
 * Obsługuje nową wiadomość w wątku lobby - liczy wiadomości do przepisania pytania o nagrodę
 * @param {Message} message - Nowa wiadomość
 * @param {Object} sharedState - Współdzielony stan aplikacji
 */
async function handleThreadMessage(message, sharedState) {
    const handler = new InteractionHandler(sharedState.config, sharedState.lobbyService, sharedState.timerService, sharedState.bazarService);
    await handler.handleRewardPromptReposition(message, sharedState);
}

module.exports = {
    handleInteraction,
    handleThreadMessage,
    InteractionHandler
};