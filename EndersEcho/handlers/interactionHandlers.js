const { SlashCommandBuilder, REST, Routes, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { downloadFile, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');
const OcrBlockService = require('../services/ocrBlockService');

const logger = createBotLogger('EndersEcho');
const path = require('path');

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService) {
        this.config = config;
        this.ocrService = ocrService;
        this.aiOcrService = aiOcrService;
        this.rankingService = rankingService;
        this.logService = logService;
        this.roleService = roleService;
        this.notificationService = notificationService;
        this.userBlockService = userBlockService;
        this.ocrBlockService = new OcrBlockService(config);
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
                .setDescription('Accepts screenshots in English and Japanese')
                .setDescriptionLocalizations({ pl: 'Przyjmuje screeny w języku angielskim oraz japońskim' })
                .addAttachmentOption(option =>
                    option.setName('obraz')
                        .setDescription('Accepts screenshots in English and Japanese')
                        .setDescriptionLocalizations({ pl: 'Przyjmuje screeny w języku angielskim oraz japońskim' })
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('remove')
                .setDescription('Remove a player from the ranking (admins only)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove from the ranking')
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('notifications')
                .setDescription('Manage record break notifications for players'),

            new SlashCommandBuilder()
                .setName('info')
                .setDescription('Wyślij wiadomość informacyjną na wszystkie serwery (tylko dla wybranych)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('ocr-on-off')
                .setDescription('Zablokuj / odblokuj komendę /update na wszystkich serwerach (tylko dla wybranych)')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('test')
                .setDescription('Accepts screenshots without photo verification')
                .setDescriptionLocalizations({ pl: 'Przyjmuje screeny bez weryfikacji zdjęcia' })
                .addAttachmentOption(option =>
                    option.setName('obraz')
                        .setDescription('Accepts screenshots without photo verification')
                        .setDescriptionLocalizations({ pl: 'Przyjmuje screeny bez weryfikacji zdjęcia' })
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('unblock')
                .setDescription('Wyświetla zablokowanych użytkowników i umożliwia ich odblokowanie (tylko dla adminów)')
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
            // /info i /ocr-on-off działają z dowolnego kanału — obsługujemy przed sprawdzeniem kanału
            if (interaction.commandName === 'info') {
                await this.handleInfoCommand(interaction);
                return;
            }
            if (interaction.commandName === 'ocr-on-off') {
                await this.handleBlockOcrCommand(interaction);
                return;
            }

            if (interaction.commandName === 'test') {
                await this.handleTestCommand(interaction);
                return;
            }

            if (interaction.commandName === 'unblock') {
                await this.handleUnblockCommand(interaction);
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
                case 'notifications': await this.handleNotificationsCommand(interaction); break;
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'info_modal') {
                await this._handleInfoModalSubmit(interaction);
                return;
            }
            if (interaction.customId.startsWith('ee_block_modal_')) {
                await this._handleBlockUserModal(interaction);
                return;
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
        const gl = this.logService._gl(interaction.guildId);

        const msgs = this.msgs(interaction.guildId);

        if (this.userBlockService.isBlocked(interaction.user.id)) {
            await interaction.reply({
                content: '🚫 Twoje konto zostało zablokowane z powodu próby przesłania fałszywego zdjęcia. W celu odblokowania skontaktuj się z administratorem serwera.',
                flags: ['Ephemeral']
            });
            return;
        }

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

        const isOcrAuthorized = this.config.blockOcrUserIds.includes(interaction.user.id);
        if (this.ocrBlockService.isBlocked() && !isOcrAuthorized) {
            await interaction.reply({ content: msgs.ocrBlocked, flags: ['Ephemeral'] });
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
                    gl.info('🤖 Używam AI OCR do analizy obrazu...');
                    const aiResult = await this.aiOcrService.analyzeVictoryImage(tempImagePath, gl);

                    if (aiResult.isValidVictory) {
                        bestScore = aiResult.score;
                        bossName = aiResult.bossName;
                        gl.success(`✅ AI OCR: wynik="${bestScore}", boss="${bossName}"`);
                    } else {
                        gl.warn(`⚠️ AI OCR nie rozpoznał poprawnego screenu: ${aiResult.error}`);
                        await this._sendInvalidScreenReport(interaction, tempImagePath, aiResult.error, gl);
                        await fs.unlink(tempImagePath);

                        if (aiResult.error === 'FAKE_PHOTO') {
                            await interaction.editReply(msgs.fakePhotoDetected);
                            return;
                        }

                        await interaction.editReply(msgs.invalidScreenshot);
                        return;
                    }
                } catch (aiError) {
                    gl.error(`❌ AI OCR błąd, przechodzę na tradycyjny OCR: ${aiError.message}`);
                    await interaction.editReply({ content: msgs.aiOcrUnavailable });

                    const trad1 = await this._runTraditionalOCR(tempImagePath, interaction, msgs, gl);
                    if (!trad1) return;
                    ({ bestScore, bossName } = trad1);
                }
            } else {
                // === Tradycyjny OCR ===
                gl.info('🔍 Używam tradycyjnego OCR...');

                const trad2 = await this._runTraditionalOCR(tempImagePath, interaction, msgs, gl);
                if (!trad2) return;
                ({ bestScore, bossName } = trad2);
            }

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            const prevGlobalRanking = await this.rankingService.getGlobalRanking();

            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                guildId, userId, userName, bestScore, bossName
            );

            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);

            gl.info(`🎯 Przygotowuję odpowiedź dla użytkownika - isNewRecord: ${isNewRecord}`);

            if (!isNewRecord) {
                try {
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                    const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';

                    const fsSync = require('fs');
                    const fileStats = fsSync.statSync(tempImagePath);
                    gl.info(`📁 Plik do załączenia - rozmiar: ${(fileStats.size / (1024 * 1024)).toFixed(2)}MB`);

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
                        gl.info('✅ Wysłano embed z wynikiem (brak rekordu)');
                    } catch (editReplyError) {
                        gl.error(`❌ Błąd podczas wysyłania embed (brak rekordu): ${editReplyError.message}`);
                        try {
                            await interaction.editReply({
                                content: formatMessage(msgs.noRecordFallback, {
                                    username: userName,
                                    score: bestScore,
                                    current: currentScore.score
                                })
                            });
                        } catch (fallbackError) {
                            gl.error(`❌ Nie można wysłać fallback odpowiedzi: ${fallbackError.message}`);
                        }
                    }

                    await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));
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

                gl.info('✅ Wysłano publiczne ogłoszenie nowego rekordu');
            } catch (newRecordError) {
                gl.error(`❌ Błąd podczas wysyłania odpowiedzi o nowym rekordzie: ${newRecordError.message}`);
                try {
                    await interaction.editReply({
                        content: formatMessage(msgs.newRecordFallback, {
                            username: userName,
                            score: bestScore,
                            previous: currentScore ? currentScore.score : '—'
                        })
                    });
                } catch (fallbackError) {
                    gl.error(`❌ Nie można wysłać fallback odpowiedzi dla nowego rekordu: ${fallbackError.message}`);
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

                gl.info(`🌐 Global Top 3 check: userId=${userId}, prevPos=${prevGlobalPosition ?? 'brak'}, newPos=${newGlobalPosition ?? 'brak'}`);

                if (newGlobalPosition && newGlobalPosition <= 3) {
                    const prevGlobalUser = prevGlobalRanking.find(p => p.userId === userId);
                    const newGlobalUser = newGlobalRanking[newGlobalUserIndex];
                    const globalScoreChanged = !prevGlobalUser || newGlobalUser.scoreValue > prevGlobalUser.scoreValue;
                    const positionChanged = prevGlobalPosition !== newGlobalPosition;

                    gl.info(`🌐 W Top 3: globalScoreChanged=${globalScoreChanged}, positionChanged=${positionChanged} (${prevGlobalPosition ?? 'brak'} → ${newGlobalPosition})`);

                    if (globalScoreChanged && positionChanged) {
                        const sourceGuildName = interaction.guild.name;
                        const notifAvatarUrl = interaction.user.displayAvatarURL();

                        gl.info(`🌐 Wysyłam powiadomienia Global Top 3 do ${this.config.guilds.length} serwerów`);

                        for (const guildCfg of this.config.guilds) {
                            try {
                                // Pobieramy kanał bezpośrednio przez klienta bota, żeby mieć pewność tokenu
                                let channel;
                                try {
                                    channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                                } catch (fetchErr) {
                                    gl.warn(`⚠️ Nie można pobrać kanału ${guildCfg.allowedChannelId} dla serwera ${guildCfg.id}: ${fetchErr.message}`);
                                    continue;
                                }
                                if (!channel) {
                                    gl.warn(`⚠️ Kanał ${guildCfg.allowedChannelId} nie istnieje`);
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
                                gl.info(`✅ Wysłano powiadomienie Global Top 3 do serwera ${guildCfg.id}${isSourceGuild ? ' (bez zdjęcia — serwer macierzysty)' : ' (ze zdjęciem)'}`);
                            } catch (notifError) {
                                gl.error(`❌ Błąd wysyłania powiadomienia Global Top 3 do serwera ${guildCfg.id}: ${notifError.message}`);
                            }
                        }
                    } else {
                        gl.info(`🌐 Warunki nie spełnione — nie wysyłam powiadomień`);
                    }
                } else {
                    gl.info(`🌐 Gracz poza Top 3 (pos=${newGlobalPosition ?? 'brak'}) — nie wysyłam powiadomień`);
                }
            } catch (globalCheckError) {
                gl.error(`❌ Błąd sprawdzania/wysyłania Global Top 3: ${globalCheckError.message}`);
            }

            // DM powiadomienia dla subskrybentów
            try {
                const subscribers = await this.notificationService.getSubscribersForTarget(userId, guildId);
                if (subscribers.length > 0) {
                    gl.info(`📨 Wysyłam DM powiadomienia do ${subscribers.length} subskrybentów`);
                    for (const subscriberId of subscribers) {
                        try {
                            const subscriberUser = await interaction.client.users.fetch(subscriberId);
                            const dmAttachment = new AttachmentBuilder(tempImagePath, { name: imageAttachment.name });
                            const dmEmbed = this.rankingService.createDmNotifEmbed(publicEmbed, this.msgs(interaction.guildId));
                            await subscriberUser.send({ embeds: [dmEmbed], files: [dmAttachment] });
                            gl.info(`✅ Wysłano DM powiadomienie do ${subscriberId}`);
                        } catch (dmError) {
                            gl.warn(`⚠️ Nie można wysłać DM do ${subscriberId}: ${dmError.message}`);
                        }
                    }
                }
            } catch (dmCheckError) {
                gl.error(`❌ Błąd wysyłania DM powiadomień: ${dmCheckError.message}`);
            }

            await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));

        } catch (error) {
            await this.logService.logOCRError(error, 'handleUpdateCommand', interaction.guildId);

            if (tempImagePath) {
                await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));
            }

            try {
                await interaction.editReply(msgs.updateError);
            } catch (replyError) {
                gl.error(`Błąd podczas wysyłania komunikatu o błędzie: ${replyError.message}`);
            }
        }
    }

    /**
     * Obsługuje komendę /test — weryfikuje zdjęcie wzorcem, zapisuje dane jak /update
     * @param {CommandInteraction} interaction
     */
    async handleTestCommand(interaction) {
        await this.logService.logCommandUsage('test', interaction);
        const gl = this.logService._gl(interaction.guildId);

        const msgs = this.msgs(interaction.guildId);

        if (this.userBlockService.isBlocked(interaction.user.id)) {
            await interaction.reply({
                content: '🚫 Twoje konto zostało zablokowane z powodu próby przesłania fałszywego zdjęcia. W celu odblokowania skontaktuj się z administratorem serwera.',
                flags: ['Ephemeral']
            });
            return;
        }

        if (!this.aiOcrService.enabled) {
            await interaction.reply({ content: '❌ Komenda `/test` wymaga włączonego AI OCR (`USE_ENDERSECHO_AI_OCR=true`).', flags: ['Ephemeral'] });
            return;
        }

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

        const isOcrAuthorized = this.config.blockOcrUserIds.includes(interaction.user.id);
        if (this.ocrBlockService.isBlocked() && !isOcrAuthorized) {
            await interaction.reply({ content: msgs.ocrBlocked, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferReply({ flags: ['Ephemeral'] });
        await interaction.editReply({ content: msgs.updateProcessing });

        let tempImagePath = null;

        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });

            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);

            gl.info(`🤖 [/test] Uruchamiam analizę z weryfikacją wzorca dla ${interaction.user.username}`);

            const aiResult = await this.aiOcrService.analyzeTestImage(tempImagePath, gl);

            if (aiResult.error === 'NOT_SIMILAR') {
                await interaction.editReply({
                    content: '',
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Zdjęcie nie pasuje do wzorca')
                        .setDescription('AI uznało, że przesłany screenshot nie przedstawia ekranu wyników bossa.')
                        .setTimestamp()]
                });
                return;
            }

            if (!aiResult.isValidVictory) {
                await interaction.editReply(msgs.invalidScreenshot);
                return;
            }

            const bestScore = aiResult.score;
            const bossName = aiResult.bossName;
            gl.success(`✅ [/test] AI OCR: wynik="${bestScore}", boss="${bossName}"`);

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            const prevGlobalRanking = await this.rankingService.getGlobalRanking();

            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                guildId, userId, userName, bestScore, bossName
            );

            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);

            gl.info(`🎯 [/test] Przygotowuję odpowiedź dla użytkownika - isNewRecord: ${isNewRecord}`);

            if (!isNewRecord) {
                try {
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                    const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';

                    const fsSync = require('fs');
                    const fileStats = fsSync.statSync(tempImagePath);
                    gl.info(`📁 [/test] Plik do załączenia - rozmiar: ${(fileStats.size / (1024 * 1024)).toFixed(2)}MB`);

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
                        gl.info('✅ [/test] Wysłano embed z wynikiem (brak rekordu)');
                    } catch (editReplyError) {
                        gl.error(`❌ [/test] Błąd podczas wysyłania embed (brak rekordu): ${editReplyError.message}`);
                        try {
                            await interaction.editReply({
                                content: formatMessage(msgs.noRecordFallback, {
                                    username: userName,
                                    score: bestScore,
                                    current: currentScore.score
                                })
                            });
                        } catch (fallbackError) {
                            gl.error(`❌ [/test] Nie można wysłać fallback odpowiedzi: ${fallbackError.message}`);
                        }
                    }

                    await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));
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

                gl.info('✅ [/test] Wysłano publiczne ogłoszenie nowego rekordu');
            } catch (newRecordError) {
                gl.error(`❌ [/test] Błąd podczas wysyłania odpowiedzi o nowym rekordzie: ${newRecordError.message}`);
                try {
                    await interaction.editReply({
                        content: formatMessage(msgs.newRecordFallback, {
                            username: userName,
                            score: bestScore,
                            previous: currentScore ? currentScore.score : '—'
                        })
                    });
                } catch (fallbackError) {
                    gl.error(`❌ [/test] Nie można wysłać fallback odpowiedzi dla nowego rekordu: ${fallbackError.message}`);
                }
            }

            // Aktualizacja ról TOP po nowym rekordzie
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers, guildConfig?.topRoles || null);
                await this.logService.logMessage('success', 'Role TOP zostały zaktualizowane po nowym rekordzie (/test)', interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP (/test): ${roleError.message}`, interaction);
            }

            // Powiadomienie o zmianie w Global Top 3
            try {
                const newGlobalRanking = await this.rankingService.getGlobalRanking();
                const newGlobalUserIndex = newGlobalRanking.findIndex(p => p.userId === userId);
                const newGlobalPosition = newGlobalUserIndex !== -1 ? newGlobalUserIndex + 1 : null;
                const prevGlobalUserIndex = prevGlobalRanking.findIndex(p => p.userId === userId);
                const prevGlobalPosition = prevGlobalUserIndex !== -1 ? prevGlobalUserIndex + 1 : null;

                gl.info(`🌐 [/test] Global Top 3 check: userId=${userId}, prevPos=${prevGlobalPosition ?? 'brak'}, newPos=${newGlobalPosition ?? 'brak'}`);

                if (newGlobalPosition && newGlobalPosition <= 3) {
                    const prevGlobalUser = prevGlobalRanking.find(p => p.userId === userId);
                    const newGlobalUser = newGlobalRanking[newGlobalUserIndex];
                    const globalScoreChanged = !prevGlobalUser || newGlobalUser.scoreValue > prevGlobalUser.scoreValue;
                    const positionChanged = prevGlobalPosition !== newGlobalPosition;

                    gl.info(`🌐 [/test] W Top 3: globalScoreChanged=${globalScoreChanged}, positionChanged=${positionChanged} (${prevGlobalPosition ?? 'brak'} → ${newGlobalPosition})`);

                    if (globalScoreChanged && positionChanged) {
                        const sourceGuildName = interaction.guild.name;
                        const notifAvatarUrl = interaction.user.displayAvatarURL();

                        gl.info(`🌐 [/test] Wysyłam powiadomienia Global Top 3 do ${this.config.guilds.length} serwerów`);

                        for (const guildCfg of this.config.guilds) {
                            try {
                                let channel;
                                try {
                                    channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                                } catch (fetchErr) {
                                    gl.warn(`⚠️ [/test] Nie można pobrać kanału ${guildCfg.allowedChannelId} dla serwera ${guildCfg.id}: ${fetchErr.message}`);
                                    continue;
                                }
                                if (!channel) {
                                    gl.warn(`⚠️ [/test] Kanał ${guildCfg.allowedChannelId} nie istnieje`);
                                    continue;
                                }

                                const guildMsgs = this.msgs(guildCfg.id);
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
                                gl.info(`✅ [/test] Wysłano powiadomienie Global Top 3 do serwera ${guildCfg.id}${isSourceGuild ? ' (bez zdjęcia — serwer macierzysty)' : ' (ze zdjęciem)'}`);
                            } catch (notifError) {
                                gl.error(`❌ [/test] Błąd wysyłania powiadomienia Global Top 3 do serwera ${guildCfg.id}: ${notifError.message}`);
                            }
                        }
                    } else {
                        gl.info('[/test] Warunki Global Top 3 nie spełnione — nie wysyłam powiadomień');
                    }
                } else {
                    gl.info(`🌐 [/test] Gracz poza Top 3 (pos=${newGlobalPosition ?? 'brak'}) — nie wysyłam powiadomień`);
                }
            } catch (globalCheckError) {
                gl.error(`❌ [/test] Błąd sprawdzania/wysyłania Global Top 3: ${globalCheckError.message}`);
            }

            // DM powiadomienia dla subskrybentów
            try {
                const subscribers = await this.notificationService.getSubscribersForTarget(userId, guildId);
                if (subscribers.length > 0) {
                    gl.info(`📨 [/test] Wysyłam DM powiadomienia do ${subscribers.length} subskrybentów`);
                    for (const subscriberId of subscribers) {
                        try {
                            const subscriberUser = await interaction.client.users.fetch(subscriberId);
                            const dmAttachment = new AttachmentBuilder(tempImagePath, { name: imageAttachment.name });
                            const dmEmbed = this.rankingService.createDmNotifEmbed(publicEmbed, this.msgs(interaction.guildId));
                            await subscriberUser.send({ embeds: [dmEmbed], files: [dmAttachment] });
                            gl.info(`✅ [/test] Wysłano DM powiadomienie do ${subscriberId}`);
                        } catch (dmError) {
                            gl.warn(`⚠️ [/test] Nie można wysłać DM do ${subscriberId}: ${dmError.message}`);
                        }
                    }
                }
            } catch (dmCheckError) {
                gl.error(`❌ [/test] Błąd wysyłania DM powiadomień: ${dmCheckError.message}`);
            }

            await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));

        } catch (error) {
            await this.logService.logOCRError(error, 'handleTestCommand', interaction.guildId);

            if (tempImagePath) {
                await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));
            }

            try {
                await interaction.editReply(msgs.updateError);
            } catch (replyError) {
                gl.error(`Błąd podczas wysyłania komunikatu o błędzie (/test): ${replyError.message}`);
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

            // === Przyciski raportów odrzuconych screenów ===
            if (customId.startsWith('ee_approve_')) {
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: '❌ Brak uprawnień.', flags: ['Ephemeral'] });
                    return;
                }
                const adminName = interaction.member?.displayName || interaction.user.username;
                await interaction.update({
                    content: `✅ Zatwierdzone przez **${adminName}**`,
                    embeds: interaction.message.embeds,
                    components: []
                });
                return;
            }

            if (customId.startsWith('ee_block_')) {
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: '❌ Brak uprawnień.', flags: ['Ephemeral'] });
                    return;
                }
                const parts = customId.split('_');
                const targetUserId = parts[2];
                const targetGuildId = parts[3];
                const modal = new ModalBuilder()
                    .setCustomId(`ee_block_modal_${targetUserId}_${targetGuildId}`)
                    .setTitle('Zablokuj użytkownika')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('duration')
                                .setLabel('Czas blokady (np. 1h, 7d, 30m) — puste = permanentnie')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder('Zostaw puste dla blokady permanentnej')
                        )
                    );
                await interaction.showModal(modal);
                return;
            }

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
        try {
            const customId = interaction.customId;

            if (customId === 'ee_unblock_select') {
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: '❌ Brak uprawnień.', flags: ['Ephemeral'] });
                    return;
                }
                const targetUserId = interaction.values[0];
                const entry = this.userBlockService.getBlockedUsers().find(e => e.userId === targetUserId);
                const success = await this.userBlockService.unblockUser(targetUserId);
                const username = entry?.username || targetUserId;
                await interaction.update({
                    content: success ? `✅ Odblokowano użytkownika **${username}**.` : '⚠️ Użytkownik nie był zablokowany.',
                    embeds: [],
                    components: []
                });
                return;
            }

            if (!this.isAllowedChannel(interaction.channel.id, interaction.guildId)) return;

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

    async _handleBlockUserModal(interaction) {
        const parts = interaction.customId.split('_');
        const targetUserId = parts[3];
        const targetGuildId = parts[4];
        const durationStr = interaction.fields.getTextInputValue('duration').trim();

        let targetGuild;
        try {
            targetGuild = await interaction.client.guilds.fetch(targetGuildId);
        } catch {
            targetGuild = null;
        }

        let targetUsername = targetUserId;
        try {
            const member = await targetGuild?.members.fetch(targetUserId);
            targetUsername = member?.displayName || member?.user.username || targetUserId;
        } catch {
            try {
                const user = await interaction.client.users.fetch(targetUserId);
                targetUsername = user.username;
            } catch { /* zostaw userId */ }
        }

        const guildName = targetGuild?.name || targetGuildId;

        const blockedUntil = await this.userBlockService.blockUser(
            targetUserId, targetUsername, targetGuildId, guildName, durationStr
        );

        const timeLabel = blockedUntil
            ? `do <t:${Math.floor(blockedUntil / 1000)}:F>`
            : '**permanentnie**';

        const adminName = interaction.member?.displayName || interaction.user.username;

        await interaction.update({
            content: `🔒 Użytkownik **${targetUsername}** zablokowany ${timeLabel} przez **${adminName}**`,
            embeds: interaction.message.embeds,
            components: []
        });

        logger.info(`🔒 Zablokowano ${targetUsername} (${targetUserId}) ${blockedUntil ? `do ${new Date(blockedUntil).toISOString()}` : 'permanentnie'} przez ${adminName}`);
    }

    async handleUnblockCommand(interaction) {
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: '❌ Tylko administratorzy mogą używać tej komendy.', flags: ['Ephemeral'] });
            return;
        }

        const blocked = this.userBlockService.getBlockedUsers();

        if (blocked.length === 0) {
            await interaction.reply({ content: '✅ Brak zablokowanych użytkowników.', flags: ['Ephemeral'] });
            return;
        }

        const options = blocked.slice(0, 25).map(entry => {
            const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil);
            const desc = `${entry.guildName} | Pozostało: ${timeLabel}`;
            return {
                label: entry.username.slice(0, 100),
                description: desc.slice(0, 100),
                value: entry.userId
            };
        });

        const select = new StringSelectMenuBuilder()
            .setCustomId('ee_unblock_select')
            .setPlaceholder('Wybierz użytkownika do odblokowania')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        const embed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('🔒 Zablokowani użytkownicy OCR')
            .setDescription(blocked.slice(0, 25).map((entry, i) => {
                const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil);
                return `${i + 1}. **${entry.username}** — ${entry.guildName} | \`${timeLabel}\``;
            }).join('\n'))
            .setFooter({ text: `Łącznie: ${blocked.length} zablokowanych` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], components: [row], flags: ['Ephemeral'] });
    }

    async handleBlockOcrCommand(interaction) {
        const allowedIds = this.config.blockOcrUserIds;
        if (!allowedIds.length || !allowedIds.includes(interaction.user.id)) {
            await interaction.reply({ content: 'Brak uprawnień do tej komendy.', flags: ['Ephemeral'] });
            return;
        }

        const userNick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

        if (this.ocrBlockService.isBlocked()) {
            // Odblokowanie — wyślij powiadomienie na wszystkie serwery
            await this.ocrBlockService.unblock(interaction.user.id, userNick);
            logger.info(`🔓 OCR odblokowany przez ${userNick}`);

            for (const guildCfg of this.config.guilds) {
                try {
                    const channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                    if (!channel) continue;
                    const guildMsgs = this.msgs(guildCfg.id);
                    const embed = new EmbedBuilder()
                        .setColor(0x00C853)
                        .setTitle(guildMsgs.ocrResumedTitle)
                        .setDescription(guildMsgs.ocrResumedDescription)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                } catch (err) {
                    logger.warn(`⚠️ Nie można wysłać powiadomienia o odblokowaniu do serwera ${guildCfg.id}: ${err.message}`);
                }
            }

            const replyMsgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: replyMsgs.ocrBlockDisabled, flags: ['Ephemeral'] });
        } else {
            // Zablokowanie
            await this.ocrBlockService.block(interaction.user.id, userNick);
            logger.warn(`🔒 OCR zablokowany przez ${userNick}`);
            const replyMsgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: replyMsgs.ocrBlockEnabled, flags: ['Ephemeral'] });
        }
    }

    async _runTraditionalOCR(tempImagePath, interaction, msgs, gl) {
        const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath, gl);
        if (!hasRequiredWords) {
            await this._sendInvalidScreenReport(interaction, tempImagePath, 'NO_REQUIRED_WORDS', gl);
            await fs.unlink(tempImagePath);
            await interaction.editReply(msgs.updateNoRequiredWords);
            return null;
        }

        const extractedText = await this.ocrService.extractTextFromImage(tempImagePath, gl);
        const bestScore = this.ocrService.extractScoreAfterBest(extractedText, gl);

        if (!bestScore || bestScore.trim() === '') {
            await fs.unlink(tempImagePath);
            await interaction.editReply(msgs.updateNoScore);
            return null;
        }

        const bossName = this.ocrService.extractBossName(extractedText, gl);
        return { bestScore, bossName };
    }

    async _sendInvalidScreenReport(interaction, imagePath, reason, gl) {
        if (!this.config.invalidReportChannelId) return;
        try {
            const channel = await interaction.client.channels.fetch(this.config.invalidReportChannelId);
            if (!channel) return;

            const serverNick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            const discordUsername = interaction.user.username;
            const serverName = interaction.guild?.name || 'Nieznany serwer';
            const now = new Date();
            const timestamp = now.toLocaleString('pl-PL', {
                timeZone: 'Europe/Warsaw',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });

            const reasonLabels = {
                'FAKE_PHOTO': '🔴 Wykryto podrobione / edytowane zdjęcie',
                'INVALID_SCREENSHOT': '🟡 Nie znaleziono ekranu Victory (ang. i jap.)',
                'NO_REQUIRED_WORDS': '🟡 Brak wymaganych słów Best/Total',
            };
            const reasonText = reasonLabels[reason] || `🟠 ${reason}`;
            const color = reason === 'FAKE_PHOTO' ? 0xFF0000 : 0xFF8C00;

            const ext = path.extname(imagePath) || '.png';
            const fileName = `rejected_${Date.now()}${ext}`;
            const fileAttachment = new AttachmentBuilder(imagePath, { name: fileName });

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('⚠️ Odrzucony screen')
                .addFields(
                    { name: 'Nick na serwerze', value: serverNick, inline: true },
                    { name: 'Discord', value: `${discordUsername} (<@${interaction.user.id}>)`, inline: true },
                    { name: 'Serwer', value: serverName, inline: true },
                    { name: 'Czas', value: timestamp, inline: true },
                    { name: 'Powód odrzucenia', value: reasonText, inline: false }
                )
                .setImage(`attachment://${fileName}`)
                .setFooter({ text: `ID użytkownika: ${interaction.user.id}` });

            const approveBtn = new ButtonBuilder()
                .setCustomId(`ee_approve_${interaction.user.id}`)
                .setLabel('Zatwierdź')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Secondary);

            const blockBtn = new ButtonBuilder()
                .setCustomId(`ee_block_${interaction.user.id}_${interaction.guildId}`)
                .setLabel('Zablokuj użytkownika')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger);

            const reportRow = new ActionRowBuilder().addComponents(approveBtn, blockBtn);

            await channel.send({ embeds: [embed], files: [fileAttachment], components: [reportRow] });
            gl.info(`🛑 📋 Wysłano raport o odrzuconym screenie (${reason}) dla ${serverNick}`);
        } catch (err) {
            gl.warn(`⚠️ Nie można wysłać raportu o odrzuconym screenie: ${err.message}`);
        }
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
