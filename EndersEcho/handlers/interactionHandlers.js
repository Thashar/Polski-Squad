const { SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { downloadFile, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const path = require('path');

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService) {
        this.config = config;
        this.ocrService = ocrService;
        this.aiOcrService = aiOcrService;
        this.rankingService = rankingService;
        this.logService = logService;
        this.roleService = roleService;
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
                        .setRequired(false))
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
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
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
            await this.logService.logRankingError(error, 'handleRankingCommand');

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

            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord);

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
                                // Na serwerze macierzystym plik był już w embeddzie rekordu — nie dołączamy go ponownie
                                const isSourceGuild = guildCfg.id === interaction.guildId;
                                const notifAttachmentName = isSourceGuild ? null : imageAttachment.name;

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
                                    notifAttachmentName
                                );

                                if (isSourceGuild) {
                                    await channel.send({ embeds: [globalEmbed] });
                                } else {
                                    await channel.send({ embeds: [globalEmbed], files: [imageAttachment] });
                                }
                                logger.info(`✅ Wysłano powiadomienie Global Top 3 do serwera ${guildCfg.id}${isSourceGuild ? ' (bez pliku — serwer macierzysty)' : ' (z plikiem)'}`);
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

            await fs.unlink(tempImagePath).catch(err => logger.error('Błąd usuwania pliku tymczasowego:', err));

        } catch (error) {
            await this.logService.logOCRError(error, 'handleUpdateCommand');

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
