const { SlashCommandBuilder, REST, Routes, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { downloadFile, downloadBuffer, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');
const OcrBlockService = require('../services/ocrBlockService');

const logger = createBotLogger('EndersEcho');
const path = require('path');

const OPERATIONS_TYPE = 'ocr.analyze';

/**
 * Mapuje gatewayError z runOperation na komunikat ephemeral dla usera.
 * Wołane gdy `op.gatewayError` jest truthy (authorize odrzucił 4xx).
 */
function mapGatewayErrorMessage(gwError, msgs) {
    switch (gwError.code) {
        case 'QUOTA_EXCEEDED':
            return formatMessage(msgs.dailyLimitExceeded, { limit: gwError.retryAfter || '' });
        case 'RATE_LIMITED':
            return `⏱️ Zbyt wiele żądań. Spróbuj ponownie${gwError.retryAfter ? ` za ${gwError.retryAfter}s` : ''}.`;
        case 'OPERATION_NOT_ENTITLED':
            return `🔒 Operacja nie jest dostępna dla tego serwera.`;
        case 'VALIDATION_FAILED':
        case 'GATEWAY_UNAVAILABLE':
            return msgs.updateError;
        default:
            return `❌ ${gwError.message || 'Żądanie odrzucone przez gateway.'}`;
    }
}

/**
 * Buduje usage payload do `/record` z `aiResult.tokenUsage` zwracanego przez
 * `aiOcrService`. Zwraca null gdy brak danych (np. AI OCR wyłączony).
 */
function buildGeminiUsage(aiResult) {
    if (!aiResult?.tokenUsage) return null;
    const model = process.env.ENDERSECHO_GOOGLE_AI_MODEL || 'gemini-2.5-flash-preview-05-20';
    return {
        provider:     `gemini/${model}`,
        inputTokens:  aiResult.tokenUsage.promptTokens,
        outputTokens: aiResult.tokenUsage.outputTokens,
    };
}

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, botOps) {
        this.config = config;
        this.ocrService = ocrService;
        this.aiOcrService = aiOcrService;
        this.rankingService = rankingService;
        this.logService = logService;
        this.roleService = roleService;
        this.notificationService = notificationService;
        this.userBlockService = userBlockService;
        this.roleRankingConfigService = roleRankingConfigService;
        this.usageLimitService = usageLimitService;
        this.tokenUsageService = tokenUsageService;
        this.botOps = botOps;
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
        const rest = new REST().setToken(this.config.token);

        for (const guildConfig of this.config.guilds) {
            const isPol = guildConfig.lang === 'pol';
            const pl = (text) => isPol ? { pl: text } : {};

            const commands = [
                new SlashCommandBuilder()
                    .setName('ranking')
                    .setDescription('Display the player ranking (choose server or global)')
                    .setDescriptionLocalizations(pl('Wyświetl ranking graczy (wybierz serwer lub globalny)')),

                new SlashCommandBuilder()
                    .setName('update')
                    .setDescription('Add a new Ender\'s Echo score for analysis')
                    .setDescriptionLocalizations(pl('Dodaj nowy wynik Ender\'s Echo do analizy'))
                    .addAttachmentOption(option =>
                        option.setName('obraz')
                            .setDescription('Screenshot of the boss result screen')
                            .setDescriptionLocalizations(pl('Screenshot ekranu wyników bossa'))
                            .setRequired(true)),

                new SlashCommandBuilder()
                    .setName('remove')
                    .setDescription('Remove a player from the ranking (admins only)')
                    .setDescriptionLocalizations(pl('Usuń gracza z rankingu (tylko dla adminów)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('User to remove from the ranking')
                            .setDescriptionLocalizations(pl('Użytkownik do usunięcia z rankingu'))
                            .setRequired(true)),

                new SlashCommandBuilder()
                    .setName('notifications')
                    .setDescription('Manage record break notifications for players')
                    .setDescriptionLocalizations(pl('Zarządzaj powiadomieniami o pobiciach rekordów graczy')),

                new SlashCommandBuilder()
                    .setName('info')
                    .setDescription('Send an info message to all servers (selected users only)')
                    .setDescriptionLocalizations(pl('Wyślij wiadomość informacyjną na wszystkie serwery (tylko dla wybranych)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

                new SlashCommandBuilder()
                    .setName('ocr-on-off')
                    .setDescription('Block / unblock /update and/or /test on all servers (selected users only)')
                    .setDescriptionLocalizations(pl('Zablokuj / odblokuj /update i/lub /test na wszystkich serwerach (tylko dla wybranych)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .addStringOption(option =>
                        option.setName('target')
                            .setDescription('Which command to block/unblock (default: both)')
                            .setDescriptionLocalizations(pl('Którą komendę zablokować/odblokować (domyślnie: obie)'))
                            .setRequired(false)
                            .addChoices(
                                { name: '/update', value: 'update' },
                                { name: '/test', value: 'test' },
                                { name: 'Obie komendy', value: 'both' }
                            )),

                new SlashCommandBuilder()
                    .setName('test')
                    .setDescription('Submit a new Ender\'s Echo score (EN/JP screenshots)')
                    .setDescriptionLocalizations(pl('Dodaj nowy wynik Ender\'s Echo (screeny EN/JP)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .addAttachmentOption(option =>
                        option.setName('obraz')
                            .setDescription('Screenshot of the boss result screen')
                            .setDescriptionLocalizations(pl('Screenshot ekranu wyników bossa'))
                            .setRequired(true)),

                new SlashCommandBuilder()
                    .setName('unblock')
                    .setDescription('View blocked users and unblock them (admins only)')
                    .setDescriptionLocalizations(pl('Wyświetla zablokowanych użytkowników i umożliwia ich odblokowanie (tylko dla adminów)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

                new SlashCommandBuilder()
                    .setName('add-role-ranking')
                    .setDescription('Add a ranking for role holders (admins only)')
                    .setDescriptionLocalizations(pl('Dodaje ranking dla posiadaczy wybranej roli (tylko dla adminów)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .addRoleOption(option =>
                        option.setName('rola')
                            .setDescription('Role for which you want to create a ranking')
                            .setDescriptionLocalizations(pl('Rola, dla której chcesz utworzyć ranking'))
                            .setRequired(true)),

                new SlashCommandBuilder()
                    .setName('remove-role-ranking')
                    .setDescription('Remove a role ranking (admins only)')
                    .setDescriptionLocalizations(pl('Usuwa ranking roli (tylko dla adminów)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

                new SlashCommandBuilder()
                    .setName('limit')
                    .setDescription('Set daily usage limit for /update and /test per user (selected users only)')
                    .setDescriptionLocalizations(pl('Ustaw dzienny limit użyć /update i /test na użytkownika (tylko dla wybranych)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

                new SlashCommandBuilder()
                    .setName('tokens')
                    .setDescription('Show AI token usage and cost statistics (admins only)')
                    .setDescriptionLocalizations(pl('Wyświetl statystyki zużycia tokenów AI i kosztów (tylko dla adminów)'))
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            ];

            try {
                await rest.put(
                    Routes.applicationGuildCommands(this.config.clientId, guildConfig.id),
                    { body: commands }
                );
                logger.info(`✅ Zarejestrowano komendy dla serwera ${guildConfig.id} (${guildConfig.lang})`);
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
            if (interaction.commandName === 'limit') {
                await this.handleLimitCommand(interaction);
                return;
            }

            if (interaction.commandName === 'tokens') {
                await this.handleTokensCommand(interaction);
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
                case 'ranking':            await this.handleRankingCommand(interaction);          break;
                case 'update':             await this.handleUpdateCommand(interaction);           break;
                case 'test':               await this.handleTestCommand(interaction);             break;
                case 'remove':             await this.handleRemoveCommand(interaction);           break;
                case 'notifications':      await this.handleNotificationsCommand(interaction);    break;
                case 'add-role-ranking':   await this.handleAddRoleRankingCommand(interaction);   break;
                case 'remove-role-ranking':await this.handleRemoveRoleRankingCommand(interaction);break;
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
            if (interaction.customId === 'limit_modal') {
                await this._handleLimitModal(interaction);
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
     * Zwraca pozycje użytkownika we wszystkich rankingach ról, które posiada.
     * Sprawdza tylko role z cache memberów (zero extra requestów do Discord).
     * @param {string} guildId
     * @param {string} userId
     * @param {Guild} guild
     * @param {Collection} memberRoles - interaction.member.roles.cache
     * @returns {Promise<Array<{roleName: string, position: number}>>}
     */
    async _computeRolePositions(guildId, userId, guild, memberRoles) {
        if (!this.roleRankingConfigService || !memberRoles || !guild) return [];
        try {
            const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
            const result = [];
            for (const rr of roleRankings) {
                if (!memberRoles.has(rr.roleId)) continue;
                const rolePlayers = await this.rankingService.getSortedPlayersByRole(guildId, rr.roleId, guild, this.roleRankingConfigService);
                const idx = rolePlayers.findIndex(p => p.userId === userId);
                if (idx !== -1) result.push({ roleName: rr.roleName, position: idx + 1 });
            }
            return result;
        } catch (err) {
            logger.warn(`Błąd pobierania pozycji ról dla użytkownika ${userId}: ${err.message}`);
            return [];
        }
    }

    /**
     * Obsługuje komendę /update — pełny flow z zapisem do rankingu,
     * publicznym ogłoszeniem i aktualizacją ról.
     * @param {CommandInteraction} interaction
     */
    async handleUpdateCommand(interaction) {
        await this._runUpdateFlow(interaction, {
            dryRun:       false,
            commandName:  'update',
            ocrBlockKey:  'update',
        });
    }

    /**
     * Obsługuje komendę /test — działa identycznie jak /update, ale wynik
     * wyświetla jako ephemeral, nie zapisuje do rankingu, nie aktualizuje ról
     * i nie wysyła powiadomień na inne serwery. Służy do testowania flow /update.
     * @param {CommandInteraction} interaction
     */
    async handleTestCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);

        const allowedIds = this.config.blockOcrUserIds;
        if (!allowedIds.length || !allowedIds.includes(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        await this._runUpdateFlow(interaction, {
            dryRun:       true,
            commandName:  'test',
            ocrBlockKey:  'test',
        });
    }

    /**
     * Wspólny flow dla /update i /test.
     * @param {CommandInteraction} interaction
     * @param {{ dryRun: boolean, commandName: 'update'|'test', ocrBlockKey: 'update'|'test' }} opts
     */
    async _runUpdateFlow(interaction, { dryRun, commandName, ocrBlockKey }) {
        await this.logService.logCommandUsage(commandName, interaction);
        const gl = this.logService._gl(interaction.guildId);

        const msgs = this.msgs(interaction.guildId);

        if (this.userBlockService.isBlocked(interaction.user.id)) {
            await interaction.reply({
                content: msgs.userBlocked,
                flags: ['Ephemeral']
            });
            return;
        }

        if (!this.aiOcrService.enabled) {
            await interaction.reply({ content: msgs.testAiOcrRequired, flags: ['Ephemeral'] });
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
        if (this.ocrBlockService.isBlocked(ocrBlockKey) && !isOcrAuthorized) {
            await interaction.reply({ content: msgs.ocrBlocked, flags: ['Ephemeral'] });
            return;
        }

        const limitCheck = await this.usageLimitService.checkAndRecord(interaction.user.id);
        if (!limitCheck.allowed) {
            await interaction.reply({
                content: formatMessage(msgs.dailyLimitExceeded, { limit: limitCheck.limit }),
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

            gl.info(`🤖 [/${commandName}] Uruchamiam analizę z weryfikacją wzorca dla ${interaction.user.username}${dryRun ? ' (tryb testowy)' : ''}`);

            // ── Operations Gateway (authorize + root span + record) ───────────
            const op = await this.botOps.run({
                type:  OPERATIONS_TYPE,
                actor: { discordId: interaction.user.id },
                scope: { guildId: interaction.guildId, channelId: interaction.channelId },
                hints: { command: commandName },
            }, async (ctx) => {
                const ai = await this.aiOcrService.analyzeTestImage(tempImagePath, gl, ctx.telemetryMeta);
                const usage = buildGeminiUsage(ai);
                if (ai.error === 'NOT_SIMILAR' || !ai.isValidVictory) {
                    return { result: ai, status: 'REJECTED', errorCode: ai.error || 'VALIDATION_FAILED', usage };
                }
                return { result: ai, usage };
            });

            if (op.gatewayError) {
                await interaction.editReply({ content: mapGatewayErrorMessage(op.gatewayError, msgs) });
                return;
            }
            const aiResult = op.result;

            const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';

            if (aiResult.tokenUsage && this.tokenUsageService) {
                const { promptTokens, outputTokens } = aiResult.tokenUsage;
                this.tokenUsageService.record(interaction.guildId, promptTokens, outputTokens).catch(() => {});
            }

            if (aiResult.error === 'NOT_SIMILAR') {
                await this._sendInvalidScreenReport(interaction, tempImagePath, 'NOT_SIMILAR', gl);
                await interaction.editReply({
                    content: '',
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle(msgs.testNotSimilarTitle)
                        .setDescription(msgs.testNotSimilarDescription)
                        .setTimestamp()]
                });
                return;
            }

            if (!aiResult.isValidVictory) {
                await this._sendInvalidScreenReport(interaction, tempImagePath, aiResult.error, gl);
                await interaction.editReply(msgs.invalidScreenshot);
                return;
            }

            const bestScore = aiResult.score;
            const bossName = aiResult.bossName;
            gl.success(`✅ [/${commandName}] AI OCR: wynik="${bestScore}", boss="${bossName}"`);

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            const prevGlobalRanking = dryRun ? null : await this.rankingService.getGlobalRanking();

            let isNewRecord;
            let currentScore;
            if (dryRun) {
                // Tryb testowy: porównanie bez zapisu do rankingu.
                const ranking = await this.rankingService.loadRanking(guildId);
                currentScore = ranking[userId] || null;
                const newScoreValue = this.rankingService.parseScoreValue(bestScore);
                if (!currentScore) {
                    isNewRecord = true;
                } else {
                    const currentScoreValue = this.rankingService.parseScoreValue(currentScore.score);
                    isNewRecord = newScoreValue > currentScoreValue;
                }
            } else {
                ({ isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                    guildId, userId, userName, bestScore, bossName
                ));
                await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);
            }

            gl.info(`🎯 Przygotowuję odpowiedź dla użytkownika - isNewRecord: ${isNewRecord}${dryRun ? ' (tryb testowy)' : ''}`);

            if (!isNewRecord) {
                try {
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');

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

                    return;
                } catch (noRecordError) {
                    throw noRecordError;
                }
            }

            // Nowy rekord — publiczne ogłoszenie
            const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
            const imageAttachment = new AttachmentBuilder(tempImagePath, {
                name: `rekord_${safeUserName}_${Date.now()}.${fileExtension}`
            });

            const guildConfig = this.config.getGuildConfig(interaction.guildId);
            const rolePositions = await this._computeRolePositions(guildId, userId, interaction.guild, interaction.member?.roles?.cache);
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
                currentScore ? currentScore.timestamp : null,
                rolePositions
            );

            try {
                if (dryRun) {
                    // Tryb testowy: wynik wyświetlany wyłącznie ephemeral,
                    // brak publicznego followUp, brak aktualizacji ról,
                    // brak powiadomień na inne serwery i brak DM.
                    await interaction.editReply({
                        embeds: [publicEmbed],
                        files: [imageAttachment]
                    });
                    gl.info('✅ Wysłano ephemeral podgląd nowego rekordu (tryb testowy)');
                } else {
                    await interaction.editReply({ content: msgs.newRecordConfirmed });

                    await interaction.followUp({
                        embeds: [publicEmbed],
                        files: [imageAttachment]
                    });

                    gl.info('✅ Wysłano publiczne ogłoszenie nowego rekordu');
                }
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

            if (dryRun) {
                // W trybie testowym pomijamy aktualizację ról TOP,
                // powiadomienia Global Top 3 oraz DM subskrybentów.
                return;
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

        } catch (error) {
            await this.logService.logOCRError(error, `handle${commandName.charAt(0).toUpperCase() + commandName.slice(1)}Command`, interaction.guildId);

            try {
                await interaction.editReply(msgs.updateError);
            } catch (replyError) {
                gl.error(`Błąd podczas wysyłania komunikatu o błędzie: ${replyError.message}`);
            }
        } finally {
            if (tempImagePath) {
                await fs.unlink(tempImagePath).catch(err => gl.error(`Błąd usuwania pliku tymczasowego: ${err.message}`));
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
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const adminName = interaction.member?.displayName || interaction.user.username;
                await interaction.update({
                    content: formatMessage(msgs.approveSuccess, { adminName }),
                    embeds: interaction.message.embeds,
                    components: []
                });
                return;
            }

            if (customId.startsWith('ee_block_')) {
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const parts = customId.split('_');
                const targetUserId = parts[2];
                const targetGuildId = parts[3];
                const modal = new ModalBuilder()
                    .setCustomId(`ee_block_modal_${targetUserId}_${targetGuildId}`)
                    .setTitle(msgs.blockUserModalTitle)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('duration')
                                .setLabel(msgs.blockUserTimeLabel)
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder(msgs.blockUserTimePlaceholder)
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

            // === Przyciski /tokens ===
            if (customId.startsWith('tk_')) {
                await this._handleTokensButton(interaction, customId);
                return;
            }

            // === Przyciski wyboru serwera/global ===
            if (customId.startsWith('ranking_select_')) {
                await this._handleRankingSelect(interaction, customId);
                return;
            }

            // === Przyciski rankingu roli ===
            if (customId.startsWith('ranking_role_')) {
                await this._handleRoleRankingSelect(interaction, customId);
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
            const buttons = this.rankingService.createRankingButtons(newPage, rankingData.totalPages, false, msgs, rankingData.roleRows || []);

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
                    globalPosition: globalIdx !== -1 ? globalIdx + 1 : null,
                    rolePositions: []
                };

                // Pozycje w rankingach ról — sprawdzamy tylko role które użytkownik ma (zero extra requestów na role check)
                if (mode === 'server' && guildId && this.roleRankingConfigService) {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    const memberRoles = interaction.member?.roles?.cache;
                    const rankingGuild = guild || interaction.client.guilds.cache.get(guildId);
                    if (roleRankings.length > 0 && memberRoles && rankingGuild) {
                        for (const rr of roleRankings) {
                            if (!memberRoles.has(rr.roleId)) continue;
                            const rolePlayers = await this.rankingService.getSortedPlayersByRole(guildId, rr.roleId, rankingGuild, this.roleRankingConfigService);
                            const roleIdx = rolePlayers.findIndex(p => p.userId === callerUserId);
                            if (roleIdx !== -1) {
                                callerStats.rolePositions.push({ roleName: rr.roleName, position: roleIdx + 1 });
                            }
                        }
                    }
                }
            } catch (statsErr) {
                logger.error('Błąd pobierania statystyk wywołującego:', statsErr);
            }

            // Przyciski rankingów ról (tylko dla trybu serwera)
            let roleRows = [];
            if (mode === 'server' && guildId && this.roleRankingConfigService) {
                try {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    if (roleRankings.length > 0) {
                        roleRows = this.rankingService.createRoleRankingButtons(roleRankings, guildId);
                    }
                } catch (roleErr) {
                    logger.warn('Błąd ładowania rankingów ról:', roleErr);
                }
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
            const buttons = this.rankingService.createRankingButtons(currentPage, totalPages, false, rankMsgs, roleRows);

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
                callerStats,
                roleRows
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

        const rankingData = this.rankingService.getActiveRanking(interaction.message.id);

        // Powrót z rankingu roli → przywróć ranking serwera
        if (rankingData?.mode === 'role' && rankingData.parentGuildId) {
            try {
                const parentGuildId = rankingData.parentGuildId;
                const players = await this.rankingService.getSortedPlayers(parentGuildId);
                const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);
                const guild = interaction.client.guilds.cache.get(parentGuildId) || null;

                let roleRows = [];
                if (this.roleRankingConfigService) {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(parentGuildId);
                    if (roleRankings.length > 0) {
                        roleRows = this.rankingService.createRoleRankingButtons(roleRankings, parentGuildId);
                    }
                }

                const embed = await this.rankingService.createRankingEmbed(
                    players, 0, totalPages, rankingData.userId, guild,
                    { mode: 'server', client: null, messages: msgs, callerStats: rankingData.callerStats || null }
                );
                const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, roleRows);

                const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons });
                this.rankingService.addActiveRanking(reply.id, {
                    players, currentPage: 0, totalPages,
                    userId: rankingData.userId, messageId: reply.id,
                    mode: 'server', guildId: parentGuildId,
                    callerStats: rankingData.callerStats || null, roleRows
                });
                return;
            } catch (err) {
                logger.error('Błąd powrotu z rankingu roli:', err);
            }
        }

        // Domyślny powrót → wybór serwera/global
        const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs);
        await interaction.editReply({
            content: msgs.rankingSelectPrompt,
            embeds: [],
            components: selectRows
        });
    }

    /**
     * Obsługuje kliknięcie przycisku rankingu roli
     */
    async _handleRoleRankingSelect(interaction, customId) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);

        // customId: ranking_role_{guildId}_{roleId}
        const withoutPrefix = customId.replace('ranking_role_', '');
        const firstUnderscore = withoutPrefix.indexOf('_');
        const guildId = withoutPrefix.substring(0, firstUnderscore);
        const roleId = withoutPrefix.substring(firstUnderscore + 1);

        const rankingData = this.rankingService.getActiveRanking(interaction.message.id);
        const parentCallerStats = rankingData?.callerStats || null;
        const parentUserId = rankingData?.userId || interaction.user.id;

        try {
            const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: msgs.roleRankingServerError, embeds: [], components: [] });
                return;
            }

            const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
            const roleCfg = roleRankings.find(r => r.roleId === roleId);
            const roleName = roleCfg?.roleName || roleId;

            const players = await this.rankingService.getSortedPlayersByRole(guildId, roleId, guild, this.roleRankingConfigService);

            if (players.length === 0) {
                await interaction.editReply({
                    content: `📋 Brak graczy z rolą **${roleName}** w rankingu.`,
                    embeds: [],
                    components: this.rankingService.createRankingButtons(0, 1, false, msgs)
                });
                // Zachowaj cache z mode=role żeby Back działał
                const reply = await interaction.fetchReply();
                this.rankingService.addActiveRanking(reply.id, {
                    players: [], currentPage: 0, totalPages: 1,
                    userId: parentUserId, messageId: reply.id,
                    mode: 'role', guildId, parentGuildId: guildId, roleId,
                    callerStats: parentCallerStats, roleRows: []
                });
                return;
            }

            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);

            const embed = await this.rankingService.createRankingEmbed(
                players, 0, totalPages, parentUserId, guild,
                { mode: 'server', client: null, messages: msgs, callerStats: parentCallerStats, titleOverride: `🎖️ Ranking roli: ${roleName}` }
            );
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs);

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons });
            this.rankingService.addActiveRanking(reply.id, {
                players, currentPage: 0, totalPages,
                userId: parentUserId, messageId: reply.id,
                mode: 'role', guildId, parentGuildId: guildId, roleId,
                callerStats: parentCallerStats, roleRows: []
            });

        } catch (err) {
            logger.error('Błąd w _handleRoleRankingSelect:', err);
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
        }
    }

    /**
     * Obsługuje komendę /add-role-ranking
     */
    async handleAddRoleRankingCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });

        const guildId = interaction.guildId;
        const role = interaction.options.getRole('rola');
        const MAX = 10;

        const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);

        if (existing.length >= MAX) {
            await interaction.editReply({ content: formatMessage(msgs.roleRankingLimitReached, { max: MAX }) });
            return;
        }

        const result = await this.roleRankingConfigService.addRoleRanking(guildId, role.id, role.name);

        if (!result.ok) {
            const msg = result.reason === 'limit'
                ? formatMessage(msgs.roleRankingLimitReached, { max: MAX })
                : `⚠️ Ranking dla roli **${role.name}** już istnieje.`;
            await interaction.editReply({ content: msg });
            return;
        }

        await interaction.editReply({
            content: formatMessage(msgs.roleRankingAdded, { roleName: role.name })
        });
    }

    /**
     * Obsługuje komendę /remove-role-ranking
     */
    async handleRemoveRoleRankingCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });

        const guildId = interaction.guildId;
        const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);

        if (existing.length === 0) {
            await interaction.editReply({ content: msgs.roleRankingNoRankings });
            return;
        }

        const options = existing.map(r => ({ label: r.roleName.substring(0, 100), value: r.roleId }));

        const select = new StringSelectMenuBuilder()
            .setCustomId('ee_remove_role_select')
            .setPlaceholder('Wybierz ranking roli do usunięcia...')
            .addOptions(options);

        await interaction.editReply({
            content: '🗑️ Wybierz ranking roli do usunięcia:',
            components: [new ActionRowBuilder().addComponents(select)]
        });
    }

    /**
     * Obsługuje wybór roli w /remove-role-ranking
     */
    async _handleRemoveRoleSelect(interaction) {
        const roleId = interaction.values[0];
        const guildId = interaction.guildId;

        const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);
        const roleCfg = existing.find(r => r.roleId === roleId);
        const roleName = roleCfg?.roleName || roleId;

        const removed = await this.roleRankingConfigService.removeRoleRanking(guildId, roleId);

        await interaction.update({
            content: removed
                ? `✅ Usunięto ranking roli **${roleName}**.`
                : `⚠️ Ranking roli **${roleName}** nie istnieje.`,
            components: []
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
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const targetUserId = interaction.values[0];
                const entry = this.userBlockService.getBlockedUsers().find(e => e.userId === targetUserId);
                const success = await this.userBlockService.unblockUser(targetUserId);
                const username = entry?.username || targetUserId;
                await interaction.update({
                    content: success ? formatMessage(msgs.unblockSuccess, { username }) : msgs.unblockNotFound,
                    embeds: [],
                    components: []
                });
                return;
            }

            if (customId === 'ee_remove_role_select') {
                await this._handleRemoveRoleSelect(interaction);
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
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }
        const prefill = this._infoSessions.get(interaction.user.id) || {};
        await interaction.showModal(this._buildInfoModal(prefill));
    }

    /**
     * Obsługuje submit modala /info — zapisuje dane, pokazuje podgląd z przyciskami.
     */
    async _handleInfoModalSubmit(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!this.config.infoUserId || interaction.user.id !== this.config.infoUserId) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
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
            content: formatMessage(msgs.infoPreview, { count: this.config.guilds.length }),
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
            const msgs = this.msgs(interaction.guildId);
            await interaction.update({ content: msgs.infoSessionExpired, embeds: [], components: [] });
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
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }

        const blocked = this.userBlockService.getBlockedUsers();

        if (blocked.length === 0) {
            await interaction.reply({ content: msgs.unblockNoBlocked, flags: ['Ephemeral'] });
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
            .setTitle(msgs.unblockTitle)
            .setDescription(blocked.slice(0, 25).map((entry, i) => {
                const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil);
                return `${i + 1}. **${entry.username}** — ${entry.guildName} | \`${timeLabel}\``;
            }).join('\n'))
            .setFooter({ text: `Łącznie: ${blocked.length} zablokowanych` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], components: [row], flags: ['Ephemeral'] });
    }

    async handleLimitCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const allowedIds = this.config.blockOcrUserIds;
        if (!allowedIds.length || !allowedIds.includes(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        const currentLimit = this.usageLimitService.getLimit();
        const currentText = currentLimit !== null ? String(currentLimit) : '';

        const modal = new ModalBuilder()
            .setCustomId('limit_modal')
            .setTitle(msgs.limitModalTitle);

        const limitInput = new TextInputBuilder()
            .setCustomId('limit_value')
            .setLabel(msgs.limitModalLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(msgs.limitModalPlaceholder)
            .setValue(currentText)
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
        await interaction.showModal(modal);
    }

    async _handleLimitModal(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const raw = interaction.fields.getTextInputValue('limit_value').trim();

        if (raw === '') {
            await this.usageLimitService.setLimit(null);
            await interaction.reply({ content: msgs.limitRemoved, flags: ['Ephemeral'] });
            return;
        }

        const parsed = parseInt(raw, 10);
        if (isNaN(parsed) || parsed < 1) {
            await interaction.reply({ content: msgs.limitInvalidValue, flags: ['Ephemeral'] });
            return;
        }

        await this.usageLimitService.setLimit(parsed);
        await interaction.reply({ content: formatMessage(msgs.limitSet, { limit: parsed }), flags: ['Ephemeral'] });
    }

    async handleBlockOcrCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const allowedIds = this.config.blockOcrUserIds;
        if (!allowedIds.length || !allowedIds.includes(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        const userNick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        const target = interaction.options.getString('target') || 'both';
        const targetCommands = target === 'both' ? ['update', 'test'] : [target];

        const currentlyBlocked = this.ocrBlockService.getBlockedCommands();
        const allTargetBlocked = targetCommands.every(cmd => currentlyBlocked.includes(cmd));

        const cmdLabel = targetCommands.map(c => `\`/${c}\``).join(', ');

        if (allTargetBlocked) {
            // Odblokowanie
            await this.ocrBlockService.unblock(interaction.user.id, userNick, targetCommands);
            logger.info(`🔓 OCR odblokowany dla ${cmdLabel} przez ${userNick}`);

            await interaction.reply({ content: formatMessage(msgs.ocrBlockDisabled, { commands: cmdLabel }), flags: ['Ephemeral'] });
        } else {
            // Zablokowanie
            await this.ocrBlockService.block(interaction.user.id, userNick, targetCommands);
            logger.warn(`🔒 OCR zablokowany dla ${cmdLabel} przez ${userNick}`);
            await interaction.reply({ content: formatMessage(msgs.ocrBlockEnabled, { commands: cmdLabel }), flags: ['Ephemeral'] });
        }
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
                'NOT_SIMILAR': '🟡 Zdjęcie nie pasuje do wzorca (komenda /test)',
                'INVALID_SCORE_FORMAT': '🟠 Odczytany wynik nie posiada prawidłowej jednostki (K/M/B/T/Q/Qi/Sx)',
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

    async handleTokensCommand(interaction) {
        const isSuperUser = this.config.blockOcrUserIds.includes(interaction.user.id);
        const isAdmin     = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isSuperUser && !isAdmin) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferReply({ flags: ['Ephemeral'] });

        const month       = new Date().toISOString().slice(0, 7);
        const guildFilter = isSuperUser ? 'all' : interaction.guildId;
        const reply       = await this._buildTokensEmbed(interaction, month, guildFilter, isSuperUser);
        await interaction.editReply(reply);
    }

    async _handleTokensButton(interaction, customId) {
        // Formy customId:
        // tk_p_{YYYYMM}_{guildFilter}_{userId}  — poprzedni miesiąc
        // tk_n_{YYYYMM}_{guildFilter}_{userId}  — następny miesiąc
        // tk_g_{YYYYMM}_{guildId}_{userId}      — konkretny serwer
        // tk_a_{YYYYMM}_{userId}                — wszystkie serwery
        const parts    = customId.split('_');
        const action   = parts[1];
        const monthRaw = parts[2];
        const month    = `${monthRaw.slice(0, 4)}-${monthRaw.slice(4, 6)}`;

        let userId, guildFilter;
        if (action === 'a') {
            userId      = parts[3];
            guildFilter = 'all';
        } else {
            userId      = parts[4];
            guildFilter = parts[3];
        }

        if (userId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba która użyła komendy może klikać te przyciski.', flags: ['Ephemeral'] });
            return;
        }

        const isSuperUser = this.config.blockOcrUserIds.includes(interaction.user.id);
        const isAdmin     = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isSuperUser && !isAdmin) return;

        // Zwykły admin widzi tylko swój serwer — zignoruj filter z customId
        const effectiveFilter = isSuperUser ? guildFilter : interaction.guildId;

        await interaction.deferUpdate();

        let targetMonth = month;
        if (action === 'p' || action === 'n') {
            const available = this.tokenUsageService.getAvailableMonths(effectiveFilter);
            const idx = available.indexOf(month);
            if (action === 'p' && idx > 0)                    targetMonth = available[idx - 1];
            if (action === 'n' && idx < available.length - 1) targetMonth = available[idx + 1];
        }

        const reply = await this._buildTokensEmbed(interaction, targetMonth, effectiveFilter, isSuperUser);
        await interaction.editReply(reply);
    }

    async _buildTokensEmbed(interaction, month, guildFilter, isSuperUser = false) {
        const { PRICING } = require('../services/tokenUsageService');

        const [y, m] = month.split('-').map(Number);
        const monthStr = `${y}${String(m).padStart(2, '0')}`;
        const userId   = interaction.user.id;

        const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
        const monthLabel = `${MONTH_NAMES[m - 1]} ${y}`;

        // Wykres tekstowy
        const chartText = this.tokenUsageService.generateChartText(guildFilter, month);

        // Statystyki miesięczne
        const totals = this.tokenUsageService.getMonthTotals(guildFilter, month);
        const fmtTok = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
        const fmtCost = (c) => `$${c.toFixed(5)}`;

        // Nazwy serwerów z cache
        const guildNames = {};
        for (const gc of this.config.guilds) {
            const g = interaction.client.guilds.cache.get(gc.id);
            guildNames[gc.id] = g?.name || gc.id;
        }

        const footerText = guildFilter === 'all'
            ? 'Wszystkie serwery'
            : (guildNames[guildFilter] || guildFilter);

        const embed = new EmbedBuilder()
            .setColor(0x4285F4)
            .setTitle(`📊 Tokeny AI — ${monthLabel}`)
            .setDescription(chartText)
            .addFields(
                { name: '📨 Zapytania', value: `\`${totals.requests}\``,                                              inline: true },
                { name: '🔤 Tokeny',    value: `\`${fmtTok(totals.promptTokens + totals.outputTokens)}\``,            inline: true },
                { name: '💰 Koszt',     value: `**${fmtCost(totals.cost)}**`,                                         inline: true },
                { name: 'Szczegóły',   value: `In: \`${fmtTok(totals.promptTokens)}\` • Out: \`${fmtTok(totals.outputTokens)}\`\nCennik: In $${PRICING.input}/1M • Out $${PRICING.output}/1M`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `${footerText} • dane z /update` });

        // Nawigacja miesiącami
        const available = this.tokenUsageService.getAvailableMonths(guildFilter);
        const idx       = available.indexOf(month);
        const hasPrev   = idx > 0;
        const hasNext   = idx < available.length - 1;

        const prevMonthRaw = hasPrev ? available[idx - 1].replace('-', '') : monthStr;
        const nextMonthRaw = hasNext ? available[idx + 1].replace('-', '') : monthStr;

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tk_p_${prevMonthRaw}_${guildFilter}_${userId}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrev),
            new ButtonBuilder()
                .setCustomId(`tk_c_${monthStr}_${guildFilter}_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`tk_n_${nextMonthRaw}_${guildFilter}_${userId}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasNext),
        );

        const components = [navRow];

        // Przyciski serwerów — tylko dla super użytkownika (blockOcrUserIds)
        if (isSuperUser) {
            const guildButtons = this.config.guilds.map(gc =>
                new ButtonBuilder()
                    .setCustomId(`tk_g_${monthStr}_${gc.id}_${userId}`)
                    .setLabel((guildNames[gc.id] || gc.id).slice(0, 20))
                    .setStyle(guildFilter === gc.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );
            guildButtons.push(
                new ButtonBuilder()
                    .setCustomId(`tk_a_${monthStr}_${userId}`)
                    .setLabel('🌐 Wszystkie')
                    .setStyle(guildFilter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );
            for (let i = 0; i < guildButtons.length; i += 5) {
                components.push(new ActionRowBuilder().addComponents(guildButtons.slice(i, i + 5)));
            }
        }

        return { embeds: [embed], components };
    }
}

module.exports = InteractionHandler;

module.exports = InteractionHandler;
