const { SlashCommandBuilder, REST, Routes, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { downloadFile, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const path = require('path');

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService) {
        this.config = config;
        this.ocrService = ocrService;
        this.aiOcrService = aiOcrService;
        this.rankingService = rankingService;
        this.logService = logService;
        this.roleService = roleService;
        this.notificationService = notificationService;
        // Tymczasowe sesje dla /info (userId -> { title, description, icon, image })
        this._infoSessions = new Map();
    }

    /**
     * Zwraca zestaw komunikatów dla danego serwera
     * @param {string} guildId
     * @returns {Object}
     */
    msgs(guildId) {
        return this.config.getMessages(guildId);
    }

    /**
     * Sprawdza czy kanał jest dozwolony dla danego serwera
     * @param {string} channelId
     * @param {string} guildId
     * @returns {boolean}
     */
    isAllowedChannel(channelId, guildId) {
        const guildConfig = this.config.getGuildConfig(guildId);
        return guildConfig?.allowedChannelId === channelId;
    }

    /**
     * Rejestruje komendy slash dla wszystkich skonfigurowanych serwerów
     * @param {Client} client
     */
    async registerSlashCommands(client) {
        const commands = [
            new SlashCommandBuilder()
                .setName('ranking')
                .setDescription('Display the player ranking (choose server or global)'),

            new SlashCommandBuilder()
                .setName('update')
                .setDescription('Update your score from a result screenshot')
                .addAttachmentOption(option =>
                    option.setName('obraz')
                        .setDescription('Image containing "Best:" and "Total:"')
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('remove')
                .setDescription('Remove a player from the ranking (admins only)')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove from the ranking')
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('ocr-debug')
                .setDescription('Toggle detailed OCR logging')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable (true) or disable (false) detailed logging')
                        .setRequired(false)),

            new SlashCommandBuilder()
                .setName('notifications')
                .setDescription('Manage record break notifications for players'),

            new SlashCommandBuilder()
                .setName('info')
                .setDescription('Wyślij wiadomość informacyjną na wszystkie serwery (tylko dla wybranych)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        ];

        const rest = new REST().setToken(this.config.token);

        for (const guildConfig of this.config.guilds) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(this.config.clientId, guildConfig.id),
                    { body: commands }
                );
                logger.info(`✅ Zarejestrowano komendy dla serwera ${guildConfig.id}`);
            } catch (error) {
                logger.error(`Błąd rejestracji slash commands dla serwera ${guildConfig.id}:`, error);
            }
        }
    }

    /**
     * Obsługuje interakcje
     * @param {Interaction} interaction
     */
    async handleInteraction(interaction) {
        if (interaction.isChatInputCommand()) {
            // /info działa z dowolnego kanału — obsługujemy przed sprawdzeniem kanału
            if (interaction.commandName === 'info') {
                await this.handleInfoCommand(interaction);
                return;
            }

            if (!this.isAllowedChannel(interaction.channel.id, interaction.guildId)) {
                await interaction.reply({
                    content: this.msgs(interaction.guildId).channelNotAllowed,
                    flags: ['Ephemeral']
                });
                return;
            }

            switch (interaction.commandName) {
                case 'ranking': await this.handleRankingCommand(interaction); break;
                case 'update':  await this.handleUpdateCommand(interaction);  break;
                case 'remove':  await this.handleRemoveCommand(interaction);  break;
                case 'ocr-debug': await this.handleOcrDebugCommand(interaction); break;
                case 'notifications': await this.handleNotificationsCommand(interaction); break;
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'info_modal') {
                await this._handleInfoModalSubmit(interaction);
            }
        }
    }

    /**
     * Obsługuje komendę /ranking — pokazuje ephemeral z przyciskami wyboru serwera/global
     * @param {CommandInteraction} interaction
     */
    async handleRankingCommand(interaction) {
        await this.logService.logCommandUsage('ranking', interaction);

        const msgs = this.msgs(interaction.guildId);

        try {
            await interaction.deferReply({ flags: ['Ephemeral'] });

            const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs);

            await interaction.editReply({
                content: msgs.rankingSelectPrompt,
                components: selectRows
            });

        } catch (error) {
            await this.logService.logRankingError(error, 'handleRankingCommand', interaction.guildId);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: msgs.rankingError, flags: ['Ephemeral'] });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: msgs.rankingError });
            }
        }
    }

    /**
     * Obsługuje komendę /update
     * @param {CommandInteraction} interaction
     */
    async handleUpdateCommand(interaction) {
        await this.logService.logCommandUsage('update', interaction);

        const msgs = this.msgs(interaction.guildId);
        const attachment = interaction.options.getAttachment('obraz');

        const isImage = this.config.images.supportedExtensions.some(ext =>
            attachment.name.toLowerCase().endsWith(ext)
        );

        if (!isImage) {
            await interaction.reply({ content: msgs.updateNotImage, flags: ['Ephemeral'] });
            return;
        }

        if (attachment.size > this.config.images.maxSize) {
            const maxSizeMB = Math.round(this.config.images.maxSize / (1024 * 1024));
            const fileSizeMB = Math.round(attachment.size / (1024 * 1024) * 100) / 100;
            await interaction.reply({
                content: formatMessage(msgs.updateFileTooLarge, { maxMB: maxSizeMB, fileMB: fileSizeMB }),
                flags: ['Ephemeral']
            });
            return;
        }

        await interaction.deferReply({ flags: ['Ephemeral'] });
        await interaction.editReply({ content: msgs.updateProcessing });

        let tempImagePath = null;

        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });

            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);

            let bestScore = null;
            let bossName = null;

            // === AI OCR (jeśli włączony) ===
            if (this.aiOcrService.enabled) {
                try {
                    logger.info('🤖 Używam AI OCR do analizy obrazu...');
                    const aiResult = await this.aiOcrService.analyzeVictoryImage(tempImagePath);

                    if (aiResult.isValidVictory) {
                        bestScore = aiResult.score;
                        bossName = aiResult.bossName;
                        logger.success(`✅ AI OCR: wynik="${bestScore}", boss="${bossName}"`);
                    } else {
                        logger.warn(`⚠️ AI OCR nie rozpoznał poprawnego screenu: ${aiResult.error}`);
                        await fs.unlink(tempImagePath);

                        if (aiResult.error === 'FAKE_PHOTO') {
                            await interaction.editReply(msgs.fakePhotoDetected);
                            return;
                        }

                        await interaction.editReply(msgs.invalidScreenshot);
                        return;
                    }
                } catch (aiError) {
                    logger.error('❌ AI OCR błąd, przechodzę na tradycyjny OCR:', aiError);
                    await interaction.editReply({ content: msgs.aiOcrUnavailable });

                    const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath);
                    if (!hasRequiredWords) {
                        await fs.unlink(tempImagePath);
                        await interaction.editReply(msgs.updateNoRequiredWords);
                        return;
                    }

                    const extractedText = await this.ocrService.extractTextFromImage(tempImagePath);
                    bestScore = this.ocrService.extractScoreAfterBest(extractedText);

                    if (!bestScore || bestScore.trim() === '') {
                        await fs.unlink(tempImagePath);
                        await interaction.editReply(msgs.updateNoScore);
                        return;
                    }

                    bossName = this.ocrService.extractBossName(extractedText);
                }
            } else {
                // === Tradycyjny OCR ===
                logger.info('🔍 Używam tradycyjnego OCR...');

                const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath);
                if (!hasRequiredWords) {
                    await fs.unlink(tempImagePath);
                    await interaction.editReply(msgs.updateNoRequiredWords);
                    return;
                }

                const extractedText = await this.ocrService.extractTextFromImage(tempImagePath);
                bestScore = this.ocrService.extractScoreAfterBest(extractedText);

                if (!bestScore || bestScore.trim() === '') {
                    await fs.unlink(tempImagePath);
                    await interaction.editReply(msgs.updateNoScore);
                    return;
                }

                bossName = this.ocrService.extractBossName(extractedText);
            }

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            const prevGlobalRanking = await this.rankingService.getGlobalRanking();

            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                guildId, userId, userName, bestScore, bossName
            );

            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);

            logger.info(`🎯 Przygotowuję odpowiedź dla użytkownika - isNewRecord: ${isNewRecord}`);

            if (!isNewRecord) {
                try {
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                    const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';

                    const fsSync = require('fs');
                    const fileStats = fsSync.statSync(tempImagePath);
                    logger.info(`📁 Plik do załączenia - rozmiar: ${(fileStats.size / (1024 * 1024)).toFixed(2)}MB`);

                    const imageAttachment = new AttachmentBuilder(tempImagePath, {
                        name: `wynik_${safeUserName}_${Date.now()}.${fileExtension}`
                    });

                    const resultEmbed = this.rankingService.createResultEmbed(
                        userName, bestScore, currentScore.score, imageAttachment.name, bossName, msgs
                    );

                    try {
                        await interaction.editReply({ embeds: [resultEmbed] });
                        await interaction.followUp({
                            content: msgs.rankingImageCaption,
                            files: [imageAttachment],
                            flags: ['Ephemeral']
                        });
                        logger.info('✅ Wysłano embed z wynikiem (brak rekordu)');
                    } catch (editReplyError) {
                        logger.error('❌ Błąd podczas wysyłania embed (brak rekordu):', editReplyError);
                        try {
                            await interaction.editReply({
                                content: formatMessage(msgs.noRecordFallback, {
                                    username: userName,
                                    score: bestScore,
                                    current: currentScore.score
                                })
                            });
                        } catch (fallbackError) {
                            logger.error('❌ Nie można wysłać fallback odpowiedzi:', fallbackError);
                        }
                    }

                    await fs.unlink(tempImagePath).catch(err => logger.error('Błąd usuwania pliku tymczasowego:', err));
                    return;
                } catch (noRecordError) {
                    throw noRecordError;
                }
            }

            // Nowy rekord — publiczne ogłoszenie
            const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
            const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';
            const imageAttachment = new AttachmentBuilder(tempImagePath, {
                name: `rekord_${safeUserName}_${Date.now()}.${fileExtension}`
            });

            const guildConfig = this.config.getGuildConfig(interaction.guildId);
            const publicEmbed = await this.rankingService.createRecordEmbed(
                userName,
                bestScore,
                interaction.user.displayAvatarURL(),
                imageAttachment.name,
                currentScore ? currentScore.score : null,
                userId,
                interaction.guildId,
                msgs,
                interaction.guild,
                guildConfig?.topRoles || null,
                currentScore ? currentScore.timestamp : null
            );

            try {
                await interaction.editReply({ content: msgs.newRecordConfirmed });

                await interaction.followUp({
                    embeds: [publicEmbed],
                    files: [imageAttachment]
                });

                logger.info('✅ Wysłano publiczne ogłoszenie nowego rekordu');
            } catch (newRecordError) {
                logger.error('❌ Błąd podczas wysyłania odpowiedzi o nowym rekordzie:', newRecordError);
                try {
                    await interaction.editReply({
                        content: formatMessage(msgs.newRecordFallback, {
                            username: userName,
                            score: bestScore,
                            previous: currentScore ? currentScore.score : '—'
                        })
                    });
                } catch (fallbackError) {
                    logger.error('❌ Nie można wysłać fallback odpowiedzi dla nowego rekordu:', fallbackError);
                }
            }

            // Aktualizacja ról TOP po nowym rekordzie
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers, guildConfig?.topRoles || null);
                await this.logService.logMessage('success', 'Role TOP zostały zaktualizowane po nowym rekordzie', interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP: ${roleError.message}`, interaction);
            }

            // Powiadomienie o zmianie w Global Top 3
            try {
                const newGlobalRanking = await this.rankingService.getGlobalRanking();
                const newGlobalUserIndex = newGlobalRanking.findIndex(p => p.userId === userId);
                const newGlobalPosition = newGlobalUserIndex !== -1 ? newGlobalUserIndex + 1 : null;
                const prevGlobalUserIndex = prevGlobalRanking.findIndex(p => p.userId === userId);
                const prevGlobalPosition = prevGlobalUserIndex !== -1 ? prevGlobalUserIndex + 1 : null;

                logger.info(`🌐 Global Top 3 check: userId=${userId}, prevPos=${prevGlobalPosition ?? 'brak'}, newPos=${newGlobalPosition ?? 'brak'}`);

                if (newGlobalPosition && newGlobalPosition <= 3) {
                    const prevGlobalUser = prevGlobalRanking.find(p => p.userId === userId);
                    const newGlobalUser = newGlobalRanking[newGlobalUserIndex];
                    const globalScoreChanged = !prevGlobalUser || newGlobalUser.scoreValue > prevGlobalUser.scoreValue;
                    const positionChanged = prevGlobalPosition !== newGlobalPosition;

                    logger.info(`🌐 W Top 3: globalScoreChanged=${globalScoreChanged}, positionChanged=${positionChanged} (${prevGlobalPosition ?? 'brak'} → ${newGlobalPosition})`);

                    if (globalScoreChanged && positionChanged) {
                        const sourceGuildName = interaction.guild.name;
                        const notifAvatarUrl = interaction.user.displayAvatarURL();

                        logger.info(`🌐 Wysyłam powiadomienia Global Top 3 do ${this.config.guilds.length} serwerów`);

                        for (const guildCfg of this.config.guilds) {
                            try {
                                // Pobieramy kanał bezpośrednio przez klienta bota, żeby mieć pewność tokenu
                                let channel;
                                try {
                                    channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                                } catch (fetchErr) {
                                    logger.warn(`⚠️ Nie można pobrać kanału ${guildCfg.allowedChannelId} dla serwera ${guildCfg.id}: ${fetchErr.message}`);
                                    continue;
                                }
                                if (!channel) {
                                    logger.warn(`⚠️ Kanał ${guildCfg.allowedChannelId} nie istnieje`);
                                    continue;
                                }

                                const guildMsgs = this.msgs(guildCfg.id);
                                // Na serwerze macierzystym plik był już w embeddzie rekordu — bez duplikatu.
                                // Na innych serwerach tworzymy nowy AttachmentBuilder z oryginalnego pliku (plik
                                // jeszcze istnieje — usuwany jest dopiero po zakończeniu całej pętli notyfikacji).
                                const isSourceGuild = guildCfg.id === interaction.guildId;

                                let notifImageRef = null;
                                let notifFiles;
                                if (!isSourceGuild) {
                                    const notifAttachment = new AttachmentBuilder(tempImagePath, { name: imageAttachment.name });
                                    notifImageRef = `attachment://${notifAttachment.name}`;
                                    notifFiles = [notifAttachment];
                                }

                                const globalEmbed = this.rankingService.createGlobalTop3Embed(
                                    userName,
                                    bestScore,
                                    currentScore ? currentScore.score : null,
                                    notifAvatarUrl,
                                    newGlobalPosition,
                                    prevGlobalPosition,
                                    sourceGuildName,
                                    guildMsgs,
                                    currentScore ? currentScore.timestamp : null,
                                    notifImageRef
                                );

                                const sendPayload = { embeds: [globalEmbed] };
                                if (notifFiles) sendPayload.files = notifFiles;
                                await channel.send(sendPayload);
                                logger.info(`✅ Wysłano powiadomienie Global Top 3 do serwera ${guildCfg.id}${isSourceGuild ? ' (bez zdjęcia — serwer macierzysty)' : ' (ze zdjęciem)'}`);
                            } catch (notifError) {
                                logger.error(`❌ Błąd wysyłania powiadomienia Global Top 3 do serwera ${guildCfg.id}: ${notifError.message}`);
                            }
                        }
                    } else {
                        logger.info(`🌐 Warunki nie spełnione — nie wysyłam powiadomień`);
                    }
                } else {
                    logger.info(`🌐 Gracz poza Top 3 (pos=${newGlobalPosition ?? 'brak'}) — nie wysyłam powiadomień`);
                }
            } catch (globalCheckError) {
                logger.error('❌ Błąd sprawdzania/wysyłania Global Top 3:', globalCheckError);
            }

            // DM powiadomienia dla subskrybentów
            try {
                const subscribers = await this.notificationService.getSubscribersForTarget(userId, guildId);
                if (subscribers.length > 0) {
                    logger.info(`📨 Wysyłam DM powiadomienia do ${subscribers.length} subskrybentów`);
                    for (const subscriberId of subscribers) {
                        try {
                            const subscriberUser = await interaction.client.users.fetch(subscriberId);
                            const dmAttachment = new AttachmentBuilder(tempImagePath, { name: imageAttachment.name });
                            const dmEmbed = this.rankingService.createDmNotifEmbed(publicEmbed, this.msgs(interaction.guildId));
                            await subscriberUser.send({ embeds: [dmEmbed], files: [dmAttachment] });
                            logger.info(`✅ Wysłano DM powiadomienie do ${subscriberId}`);
                        } catch (dmError) {
                            logger.warn(`⚠️ Nie można wysłać DM do ${subscriberId}: ${dmError.message}`);
                        }
                    }
                }
            } catch (dmCheckError) {
                logger.error('❌ Błąd wysyłania DM powiadomień:', dmCheckError);
            }

            await fs.unlink(tempImagePath).catch(err => logger.error('Błąd usuwania pliku tymczasowego:', err));

        } catch (error) {
            await this.logService.logOCRError(error, 'handleUpdateCommand', interaction.guildId);

            if (tempImagePath) {
                await fs.unlink(tempImagePath).catch(err => logger.error('Błąd usuwania pliku tymczasowego:', err));
            }

            try {
                await interaction.editReply(msgs.updateError);
            } catch (replyError) {
                logger.error('Błąd podczas wysyłania komunikatu o błędzie:', replyError.message);
            }
        }
    }

    /**
     * Obsługuje komendę /remove
     * @param {CommandInteraction} interaction
     */
    async handleRemoveCommand(interaction) {
        await this.logService.logCommandUsage('remove', interaction);

        const msgs = this.msgs(interaction.guildId);

        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        const guildId = interaction.guildId;

        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
            const wasRemoved = await this.rankingService.removePlayerFromRanking(targetUser.id, guildId);

            if (!wasRemoved) {
                await interaction.editReply(formatMessage(msgs.playerNotInRanking, { tag: targetUser.tag }));
                return;
            }

            try {
                const guildConfig = this.config.getGuildConfig(guildId);
                const updatedPlayers = await this.rankingService.getSortedPlayers(guildId);
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers, guildConfig?.topRoles || null);
                await this.logService.logMessage('success', `Gracz ${targetUser.tag} został usunięty z rankingu i zaktualizowano role TOP`, interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP po usunięciu gracza: ${roleError.message}`, interaction);
            }

            await interaction.editReply(formatMessage(msgs.playerRemovedSuccess, { tag: targetUser.tag }));

        } catch (error) {
            await this.logService.logMessage('error', `Błąd usuwania gracza ${targetUser.tag} z rankingu: ${error.message}`, interaction);
            await interaction.editReply(msgs.playerRemoveError);
        }
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction
     */
    async handleButtonInteraction(interaction) {
        try {
            const customId = interaction.customId;

            // === Przyciski /info ===
            if (customId === 'info_send') {
                await this._handleInfoSend(interaction);
                return;
            }
            if (customId === 'info_edit') {
                await this._handleInfoEdit(interaction);
                return;
            }
            if (customId === 'info_cancel') {
                await this._handleInfoCancel(interaction);
                return;
            }

            // === Przyciski powiadomień ===
            if (customId === 'notif_set') {
                await this._handleNotifSet(interaction);
                return;
            }
            if (customId === 'notif_remove') {
                await this._handleNotifRemove(interaction);
                return;
            }
            if (customId.startsWith('notif_confirm_')) {
                await this._handleNotifConfirm(interaction, customId);
                return;
            }
            if (customId === 'notif_cancel') {
                await this._handleNotifCancel(interaction);
                return;
            }
            if (customId.startsWith('notif_page_')) {
                await this._handleNotifPageSelect(interaction, customId);
                return;
            }

            // === Przyciski wyboru serwera/global ===
            if (customId.startsWith('ranking_select_')) {
                await this._handleRankingSelect(interaction, customId);
                return;
            }

            // === Przycisk powrotu do wyboru ===
            if (customId === 'ranking_back') {
                await this._handleRankingBack(interaction);
                return;
            }

            // === Przyciski paginacji ===
            await interaction.deferUpdate();

            const rankingData = this.rankingService.getActiveRanking(interaction.message.id);

            if (!rankingData) {
                // Wiadomość wygasła — komunikat w języku serwera wywołującego
                const msgs = this.msgs(interaction.guildId);
                await interaction.editReply({ content: msgs.rankingExpired, embeds: [], components: [] });
                return;
            }

            // Język zawsze wg serwera, na którym użytkownik klika
            const msgs = this.msgs(interaction.guildId);

            if (interaction.user.id !== rankingData.userId) {
                await interaction.followUp({ content: msgs.rankingWrongUser, flags: ['Ephemeral'] });
                return;
            }

            let newPage = rankingData.currentPage;

            switch (customId) {
                case 'ranking_first': newPage = 0; break;
                case 'ranking_prev':  newPage = Math.max(0, rankingData.currentPage - 1); break;
                case 'ranking_next':  newPage = Math.min(rankingData.totalPages - 1, rankingData.currentPage + 1); break;
                case 'ranking_last':  newPage = rankingData.totalPages - 1; break;
            }

            rankingData.currentPage = newPage;
            this.rankingService.updateActiveRanking(interaction.message.id, rankingData);

            const guild = rankingData.mode === 'server'
                ? (interaction.client.guilds.cache.get(rankingData.guildId) || interaction.guild)
                : null;

            const embed = await this.rankingService.createRankingEmbed(
                rankingData.players, newPage, rankingData.totalPages, rankingData.userId, guild,
                {
                    mode: rankingData.mode,
                    client: rankingData.mode === 'global' ? interaction.client : null,
                    messages: msgs,
                    callerStats: rankingData.callerStats || null
                }
            );
            const buttons = this.rankingService.createRankingButtons(newPage, rankingData.totalPages, false, msgs);

            await interaction.editReply({ embeds: [embed], components: buttons });

        } catch (error) {
            logger.error('Błąd w handleButtonInteraction:', error);

            const msgs = this.msgs(interaction.guildId);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: msgs.rankingError, flags: ['Ephemeral'] });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
            }
        }
    }

    /**
     * Obsługuje kliknięcie przycisku wyboru serwera lub global
     * @param {ButtonInteraction} interaction
     * @param {string} customId
     */
    async _handleRankingSelect(interaction, customId) {
        await interaction.deferUpdate();

        // Język użytkownika = język serwera, na którym kliknął przycisk
        const msgs = this.msgs(interaction.guildId);

        try {
            let players;
            let mode;
            let guildId = null;
            let guild = null;
            let rankMsgs = msgs; // komunikaty do użycia w embeddzie

            if (customId === 'ranking_select_global') {
                players = await this.rankingService.getGlobalRanking();
                mode = 'global';
                // Dla globalnego używamy języka bieżącego serwera
            } else {
                guildId = customId.replace('ranking_select_server_', '');
                players = await this.rankingService.getSortedPlayers(guildId);
                mode = 'server';
                guild = interaction.client.guilds.cache.get(guildId) || null;
                // Język zawsze wg serwera, na którym użytkownik klika
            }

            if (players.length === 0) {
                await interaction.editReply({ content: rankMsgs.rankingEmpty, components: [] });
                return;
            }

            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);
            const currentPage = 0;

            // Statystyki wywołującego (raz, przy pierwszym otwarciu)
            let callerStats = null;
            try {
                const callerUserId = interaction.user.id;
                const globalRanking = await this.rankingService.getGlobalRanking();
                const globalIdx = globalRanking.findIndex(p => p.userId === callerUserId);
                const serverPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                const serverIdx = serverPlayers.findIndex(p => p.userId === callerUserId);
                callerStats = {
                    score: globalIdx !== -1 ? globalRanking[globalIdx].score : null,
                    serverPosition: serverIdx !== -1 ? serverIdx + 1 : null,
                    globalPosition: globalIdx !== -1 ? globalIdx + 1 : null
                };
            } catch (statsErr) {
                logger.error('Błąd pobierania statystyk wywołującego:', statsErr);
            }

            const embed = await this.rankingService.createRankingEmbed(
                players, currentPage, totalPages, interaction.user.id, guild,
                {
                    mode,
                    client: mode === 'global' ? interaction.client : null,
                    messages: rankMsgs,
                    callerStats
                }
            );
            const buttons = this.rankingService.createRankingButtons(currentPage, totalPages, false, rankMsgs);

            const reply = await interaction.editReply({
                content: null,
                embeds: [embed],
                components: buttons
            });

            this.rankingService.addActiveRanking(reply.id, {
                players,
                currentPage,
                totalPages,
                userId: interaction.user.id,
                messageId: reply.id,
                mode,
                guildId,
                callerStats
            });

        } catch (error) {
            logger.error('Błąd w _handleRankingSelect:', error);
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
        }
    }

    /**
     * Obsługuje przycisk powrotu do wyboru serwera/global
     * @param {ButtonInteraction} interaction
     */
    async _handleRankingBack(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs);
        await interaction.editReply({
            content: msgs.rankingSelectPrompt,
            embeds: [],
            components: selectRows
        });
    }

    /**
     * Obsługuje komendę /notifications
     */
    async handleNotificationsCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notif_set')
                .setLabel(msgs.notifSetButton)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('notif_remove')
                .setLabel(msgs.notifRemoveButton)
                .setStyle(ButtonStyle.Danger)
        );
        await interaction.reply({ content: msgs.notifDescription, components: [row], flags: ['Ephemeral'] });
    }

    /**
     * Obsługuje select menu i inne interakcje z powiadomieniami
     */
    async handleSelectMenuInteraction(interaction) {
        if (!this.isAllowedChannel(interaction.channel.id, interaction.guildId)) return;
        try {
            const customId = interaction.customId;
            if (customId === 'notif_server_select') {
                await this._handleNotifServerSelect(interaction);
            } else if (customId.startsWith('notif_player_select_')) {
                await this._handleNotifPlayerSelect(interaction, customId);
            } else if (customId === 'notif_remove_select') {
                await this._handleNotifRemoveSelect(interaction);
            }
        } catch (error) {
            logger.error('Błąd w handleSelectMenuInteraction:', error);
            const msgs = this.msgs(interaction.guildId);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msgs.rankingError, components: [] });
                }
            } catch {}
        }
    }

    async _handleNotifSet(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const options = this.config.guilds.map(g => {
            const guildName = interaction.client.guilds.cache.get(g.id)?.name || g.id;
            return new StringSelectMenuOptionBuilder()
                .setValue(g.id)
                .setLabel(guildName.substring(0, 100));
        });
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('notif_server_select')
            .setPlaceholder(msgs.notifSelectServerPlaceholder)
            .addOptions(options);
        await interaction.editReply({
            content: msgs.notifSelectServer,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    async _handleNotifServerSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const selectedGuildId = interaction.values[0];
        const players = await this.rankingService.getSortedPlayers(selectedGuildId);
        if (players.length === 0) {
            await interaction.editReply({ content: msgs.notifNoPlayers, components: [] });
            return;
        }
        const sorted = await this._getNotifSortedPlayers(selectedGuildId, interaction.client);
        const PAGE_SIZE = 25;
        const options = sorted.slice(0, PAGE_SIZE).map(p =>
            new StringSelectMenuOptionBuilder()
                .setValue(p.userId)
                .setLabel(p.displayName.substring(0, 100))
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`notif_player_select_${selectedGuildId}`)
            .setPlaceholder(msgs.notifSelectPlayerPlaceholder)
            .addOptions(options);
        const selectRow = new ActionRowBuilder().addComponents(selectMenu);
        if (sorted.length <= PAGE_SIZE) {
            await interaction.editReply({
                content: msgs.notifSelectPlayer,
                components: [selectRow]
            });
        } else {
            const buttonRows = this._buildNotifPageButtons(sorted, selectedGuildId, 0);
            await interaction.editReply({
                content: msgs.notifSelectPlayer,
                components: [...buttonRows, selectRow]
            });
        }
    }

    async _handleNotifPlayerSelect(interaction, customId) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const selectedGuildId = customId.replace('notif_player_select_', '');
        const selectedUserId = interaction.values[0];
        const targetGuildName = interaction.client.guilds.cache.get(selectedGuildId)?.name || selectedGuildId;
        let targetUsername = selectedUserId;
        const players = await this.rankingService.getSortedPlayers(selectedGuildId);
        const player = players.find(p => p.userId === selectedUserId);
        if (player) targetUsername = player.username || selectedUserId;
        const targetGuild = interaction.client.guilds.cache.get(selectedGuildId);
        if (targetGuild) {
            try {
                const member = await targetGuild.members.fetch(selectedUserId);
                targetUsername = member.displayName;
            } catch {}
        }
        const confirmText = formatMessage(msgs.notifConfirmText, { username: targetUsername, guild: targetGuildName });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`notif_confirm_${selectedUserId}_${selectedGuildId}`)
                .setLabel(msgs.notifConfirmYes)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('notif_cancel')
                .setLabel(msgs.notifConfirmNo)
                .setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ content: confirmText, components: [row] });
    }

    async _handleNotifConfirm(interaction, customId) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        // customId: notif_confirm_{userId}_{guildId}  (snowflakes contain only digits)
        const parts = customId.split('_');
        // parts: ['notif','confirm', userId, guildId]
        const targetUserId = parts[2];
        const targetGuildId = parts[3];
        const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        let targetUsername = targetUserId;
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => p.userId === targetUserId);
        if (player) targetUsername = player.username || targetUserId;
        const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
        if (targetGuild) {
            try {
                const member = await targetGuild.members.fetch(targetUserId);
                targetUsername = member.displayName;
            } catch {}
        }
        const added = await this.notificationService.addSubscription(
            interaction.user.id, targetUserId, targetGuildId, targetUsername, targetGuildName
        );
        if (!added) {
            await interaction.editReply({
                content: formatMessage(msgs.notifAlreadySet, { username: targetUsername, guild: targetGuildName }),
                components: []
            });
            return;
        }
        await interaction.editReply({
            content: formatMessage(msgs.notifSuccess, { username: targetUsername, guild: targetGuildName }),
            components: []
        });
    }

    async _handleNotifCancel(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        await interaction.editReply({ content: msgs.notifCancelled, components: [] });
    }

    async _handleNotifRemove(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const subs = await this.notificationService.getSubscriptions(interaction.user.id);
        if (subs.length === 0) {
            await interaction.editReply({ content: msgs.notifRemoveNone, components: [] });
            return;
        }
        const options = subs.slice(0, 25).map(sub =>
            new StringSelectMenuOptionBuilder()
                .setValue(`${sub.targetUserId}_${sub.targetGuildId}`)
                .setLabel(`${sub.targetUsername} — ${sub.targetGuildName}`.substring(0, 100))
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('notif_remove_select')
            .setPlaceholder(msgs.notifRemoveSelectPlaceholder)
            .addOptions(options);
        await interaction.editReply({
            content: msgs.notifRemoveTitle,
            components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
    }

    /**
     * Pobiera graczy z rankingu z display names i sortuje alfabetycznie (znaki specjalne na końcu).
     */
    async _getNotifSortedPlayers(guildId, client) {
        const players = await this.rankingService.getSortedPlayers(guildId);
        const targetGuild = client.guilds.cache.get(guildId);
        const result = [];
        for (const player of players) {
            let displayName = player.username || `ID:${player.userId}`;
            if (targetGuild) {
                try {
                    const member = await targetGuild.members.fetch(player.userId);
                    displayName = member.displayName;
                } catch {}
            }
            result.push({ ...player, displayName });
        }
        const isLetter = name => /^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(name);
        result.sort((a, b) => {
            const nameA = a.displayName.toLowerCase();
            const nameB = b.displayName.toLowerCase();
            const letterA = isLetter(nameA);
            const letterB = isLetter(nameB);
            if (letterA && !letterB) return -1;
            if (!letterA && letterB) return 1;
            return nameA.localeCompare(nameB, 'pl', { sensitivity: 'base' });
        });
        return result;
    }

    /**
     * Buduje wiersze przycisków paginacji z zakresami liter dla listy graczy.
     * Maks. 4 wiersze × 5 przycisków = 20 stron po 25 graczy = do 500 graczy
     * (5. wiersz jest zarezerwowany dla select menu w tej samej wiadomości).
     * @param {number} activeOffset - offset aktualnie wyświetlanej strony (podświetlony na zielono)
     */
    _buildNotifPageButtons(players, guildId, activeOffset = 0) {
        const PAGE_SIZE = 25;
        const rows = [];
        let currentRow = [];
        for (let offset = 0; offset < players.length; offset += PAGE_SIZE) {
            if (rows.length >= 4 && currentRow.length === 0) break; // max 4 wiersze
            const page = players.slice(offset, offset + PAGE_SIZE);
            const firstName = (page[0].displayName || '?')[0].toUpperCase();
            const lastName = (page[page.length - 1].displayName || '?')[0].toUpperCase();
            const label = firstName === lastName ? firstName : `${firstName} - ${lastName}`;
            currentRow.push(
                new ButtonBuilder()
                    .setCustomId(`notif_page_${guildId}_${offset}`)
                    .setLabel(label)
                    .setStyle(offset === activeOffset ? ButtonStyle.Success : ButtonStyle.Primary)
            );
            if (currentRow.length === 5) {
                rows.push(new ActionRowBuilder().addComponents(currentRow));
                currentRow = [];
            }
        }
        if (currentRow.length > 0 && rows.length < 4) {
            rows.push(new ActionRowBuilder().addComponents(currentRow));
        }
        return rows;
    }

    /**
     * Obsługuje kliknięcie przycisku strony — wyświetla select menu z graczami z danego zakresu.
     * customId: notif_page_{guildId}_{offset}
     */
    async _handleNotifPageSelect(interaction, customId) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const withoutPrefix = customId.replace('notif_page_', '');
        const lastUnderscore = withoutPrefix.lastIndexOf('_');
        const guildId = withoutPrefix.substring(0, lastUnderscore);
        const offset = parseInt(withoutPrefix.substring(lastUnderscore + 1), 10);
        const sorted = await this._getNotifSortedPlayers(guildId, interaction.client);
        const page = sorted.slice(offset, offset + 25);
        const options = page.map(p =>
            new StringSelectMenuOptionBuilder()
                .setValue(p.userId)
                .setLabel(p.displayName.substring(0, 100))
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`notif_player_select_${guildId}`)
            .setPlaceholder(msgs.notifSelectPlayerPlaceholder)
            .addOptions(options);
        const buttonRows = this._buildNotifPageButtons(sorted, guildId, offset);
        const selectRow = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.editReply({
            content: msgs.notifSelectPlayer,
            components: [...buttonRows, selectRow]
        });
    }

    async _handleNotifRemoveSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const [targetUserId, targetGuildId] = interaction.values[0].split('_');
        const subs = await this.notificationService.getSubscriptions(interaction.user.id);
        const sub = subs.find(s => s.targetUserId === targetUserId && s.targetGuildId === targetGuildId);
        const removed = await this.notificationService.removeSubscription(interaction.user.id, targetUserId, targetGuildId);
        if (removed && sub) {
            await interaction.editReply({
                content: formatMessage(msgs.notifRemoveSuccess, { username: sub.targetUsername, guild: sub.targetGuildName }),
                components: []
            });
        } else {
            await interaction.editReply({ content: msgs.notifCancelled, components: [] });
        }
    }

    // =========================================================
    // KOMENDA /info — wiadomość informacyjna na wszystkie serwery
    // =========================================================

    /**
     * Buduje modal do tworzenia/edycji wiadomości informacyjnej.
     * @param {{ title?: string, description?: string, icon?: string, image?: string }} prefill
     */
    _buildInfoModal(prefill = {}) {
        const titleInput = new TextInputBuilder()
            .setCustomId('embedTitle')
            .setLabel('Tytuł (opcjonalnie)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Tytuł wiadomości')
            .setRequired(false)
            .setMaxLength(256);
        if (prefill.title) titleInput.setValue(prefill.title);

        const descInput = new TextInputBuilder()
            .setCustomId('embedDescription')
            .setLabel('Opis')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Treść wiadomości...')
            .setRequired(true)
            .setMaxLength(4000);
        if (prefill.description) descInput.setValue(prefill.description);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel('Ikona URL (opcjonalnie)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        if (prefill.icon) iconInput.setValue(prefill.icon);

        const imageInput = new TextInputBuilder()
            .setCustomId('embedImage')
            .setLabel('Obraz URL (opcjonalnie)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        if (prefill.image) imageInput.setValue(prefill.image);

        return new ModalBuilder()
            .setCustomId('info_modal')
            .setTitle('Nowa wiadomość informacyjna')
            .addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descInput),
                new ActionRowBuilder().addComponents(iconInput),
                new ActionRowBuilder().addComponents(imageInput)
            );
    }

    /**
     * Buduje czerwony embed na podstawie danych sesji.
     * @param {{ title?: string, description: string, icon?: string, image?: string }} data
     */
    _buildInfoEmbed(data, user) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription(data.description)
            .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() });
        if (data.title) embed.setTitle(data.title);
        if (data.icon) embed.setThumbnail(data.icon);
        if (data.image) embed.setImage(data.image);
        return embed;
    }

    /**
     * Obsługuje komendę /info — sprawdza userId, pokazuje modal.
     */
    async handleInfoCommand(interaction) {
        if (!this.config.infoUserId || interaction.user.id !== this.config.infoUserId) {
            await interaction.reply({ content: 'Brak uprawnień do tej komendy.', flags: ['Ephemeral'] });
            return;
        }
        const prefill = this._infoSessions.get(interaction.user.id) || {};
        await interaction.showModal(this._buildInfoModal(prefill));
    }

    /**
     * Obsługuje submit modala /info — zapisuje dane, pokazuje podgląd z przyciskami.
     */
    async _handleInfoModalSubmit(interaction) {
        if (!this.config.infoUserId || interaction.user.id !== this.config.infoUserId) {
            await interaction.reply({ content: 'Brak uprawnień.', flags: ['Ephemeral'] });
            return;
        }

        const title = interaction.fields.getTextInputValue('embedTitle').trim() || null;
        const description = interaction.fields.getTextInputValue('embedDescription').trim();
        const icon = interaction.fields.getTextInputValue('embedIcon').trim() || null;
        const image = interaction.fields.getTextInputValue('embedImage').trim() || null;

        const data = { title, description, icon, image, user: interaction.user };
        this._infoSessions.set(interaction.user.id, data);

        const embed = this._buildInfoEmbed(data, interaction.user);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('info_send').setLabel('Wyślij').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('info_edit').setLabel('Edytuj').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('info_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `**Podgląd** — wiadomość zostanie wysłana na **${this.config.guilds.length}** serwer(ów):`,
            embeds: [embed],
            components: [row],
            flags: ['Ephemeral']
        });
    }

    /**
     * Obsługuje przycisk "Wyślij" — wysyła embed na kanały wszystkich serwerów.
     */
    async _handleInfoSend(interaction) {
        const data = this._infoSessions.get(interaction.user.id);
        if (!data) {
            await interaction.update({ content: 'Sesja wygasła. Użyj `/info` ponownie.', embeds: [], components: [] });
            return;
        }

        await interaction.deferUpdate();
        const embed = this._buildInfoEmbed(data, data.user);
        let sent = 0;
        let failed = 0;

        for (const guildCfg of this.config.guilds) {
            try {
                const channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                if (!channel) { failed++; continue; }
                await channel.send({ embeds: [embed] });
                sent++;
            } catch (err) {
                logger.error(`Błąd wysyłania /info do serwera ${guildCfg.id}: ${err.message}`);
                failed++;
            }
        }

        this._infoSessions.delete(interaction.user.id);
        const summary = failed > 0
            ? `✅ Wysłano na **${sent}** serwer(ów). ❌ Błąd na **${failed}** serwer(ach).`
            : `✅ Wiadomość wysłana na **${sent}** serwer(ów).`;
        await interaction.editReply({ content: summary, embeds: [], components: [] });
    }

    /**
     * Obsługuje przycisk "Edytuj" — pokazuje modal z wypełnionymi danymi z sesji.
     */
    async _handleInfoEdit(interaction) {
        const data = this._infoSessions.get(interaction.user.id) || {};
        await interaction.showModal(this._buildInfoModal(data));
    }

    /**
     * Obsługuje przycisk "Anuluj" — czyści sesję.
     */
    async _handleInfoCancel(interaction) {
        this._infoSessions.delete(interaction.user.id);
        await interaction.update({ content: 'Anulowano.', embeds: [], components: [] });
    }

    /**
     * Obsługuje komendę /ocr-debug
     * @param {CommandInteraction} interaction
     */
    async handleOcrDebugCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);

        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }

        const enabled = interaction.options.getBoolean('enabled');

        if (enabled === null) {
            const currentState = this.config.ocr.detailedLogging.enabled;
            await interaction.reply({
                content: formatMessage(msgs.ocrDebugStatus, {
                    status: currentState ? msgs.ocrDebugEnabled : msgs.ocrDebugDisabled
                }),
                flags: ['Ephemeral']
            });
            return;
        }

        this.config.ocr.detailedLogging.enabled = enabled;

        logger.info(`${enabled ? '🔍' : '🔇'} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);

        await interaction.reply({
            content: enabled ? msgs.ocrDebugOn : msgs.ocrDebugOff,
            flags: ['Ephemeral']
        });
    }
}

module.exports = InteractionHandler;
