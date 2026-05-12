const { SlashCommandBuilder, REST, Routes, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder } = require('discord.js');
const { downloadFile, downloadBuffer, formatMessage } = require('../utils/helpers');
const { formatCooldownTime } = require('../services/updateCooldownService');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

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
            return formatMessage(msgs.gatewayRateLimited, { retry: gwError.retryAfter ? ` ${gwError.retryAfter}s` : '' });
        case 'OPERATION_NOT_ENTITLED':
            return msgs.gatewayNotEntitled;
        case 'VALIDATION_FAILED':
        case 'GATEWAY_UNAVAILABLE':
            return msgs.updateError;
        default:
            return `❌ ${gwError.message || msgs.gatewayDefault}`;
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
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, botOps, guildConfigService, ocrBlockService, updateCooldownService, testerService, achievementService, communityVerificationService, scoreHistoryService = null, chartService = null, guildBanService = null, globalTop10Service = null) {
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
        this.guildConfigService = guildConfigService;
        this.ocrBlockService = ocrBlockService;
        this.updateCooldownService = updateCooldownService;
        this.testerService = testerService;
        this.achievementService = achievementService;
        this.communityVerificationService = communityVerificationService || null;
        this.scoreHistoryService = scoreHistoryService;
        this.chartService = chartService;
        this.guildBanService = guildBanService;
        this.globalTop10Service = globalTop10Service;
        // Tymczasowe sesje dla /info (userId -> { title, description, icon, image })
        // Każda sesja ma TTL 15 minut — timer usuwający ją automatycznie.
        this._infoSessions = new Map();
        this._infoSessionTimers = new Map();
        // Stan wizarda /configure (userId_guildId -> { step data })
        this._configWizard = new Map();
        // Cache rankingu osiągnięć (messageId -> { players, currentPage, totalPages, ... })
        this._achRankings = new Map();
        // Sesje revert po manualnej analizie (globalMsgId -> { targetUserId, targetGuildId, prevScore, prevBoss, userName, adminName })
        this._analyzeRevertSessions = new Map();
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
    /**
     * Buduje listę komend slash dla danego serwera (lub języka)
     */
    _buildCommands(lang) {
        const isPol = lang === 'pol';
        const pl = (text) => isPol ? { pl: text } : {};

        return [
            new SlashCommandBuilder()
                .setName('ranking')
                .setDescription('Display the player ranking (choose server or global)')
                .setDescriptionLocalizations(pl('Wyświetl ranking graczy (wybierz serwer lub globalny)')),

            new SlashCommandBuilder()
                .setName('update')
                .setDescription('Add a new Ender\'s Echo score for analysis')
                .setDescriptionLocalizations(pl('Dodaj nowy wynik Ender\'s Echo do analizy'))
                .addAttachmentOption(option =>
                    option.setName('image')
                        .setNameLocalizations(pl('obraz'))
                        .setDescription('Screenshot of the boss result screen')
                        .setDescriptionLocalizations(pl('Screenshot ekranu wyników bossa'))
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('subscribe')
                .setDescription('Manage record break notifications for players')
                .setDescriptionLocalizations(pl('Zarządzaj powiadomieniami o pobiciach rekordów graczy')),

            new SlashCommandBuilder()
                .setName('test')
                .setDescription('Add a new Ender\'s Echo score for analysis (Test OCR)')
                .setDescriptionLocalizations(pl('Dodaj nowy wynik Ender\'s Echo do analizy (Test OCR)'))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                .addAttachmentOption(option =>
                    option.setName('image')
                        .setNameLocalizations(pl('obraz'))
                        .setDescription('Screenshot of the boss result screen')
                        .setDescriptionLocalizations(pl('Screenshot ekranu wyników bossa'))
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('achievements')
                .setDescription('View your unlocked achievements')
                .setDescriptionLocalizations(pl('Sprawdź swoje odblokowane osiągnięcia')),


            new SlashCommandBuilder()
                .setName('configure')
                .setDescription('Configure EndersEcho for this server (admins only)')
                .setDescriptionLocalizations(pl('Skonfiguruj EndersEcho na tym serwerze (tylko dla adminów)'))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('manage')
                .setDescription('Open EndersEcho admin panel (admins only)')
                .setDescriptionLocalizations(pl('Otwórz panel administracyjny EndersEcho (tylko dla adminów)'))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('generate')
                .setDescription('Generate Global TOP 10 report on demand (head admins only)')
                .setDescriptionLocalizations(pl('Wygeneruj raport Global TOP 10 na żądanie (tylko head adminowie)'))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        ];
    }

    async registerSlashCommands(client) {
        const rest = new REST().setToken(this.config.token);
        const allGuilds = this.config.getAllGuilds();

        // Zbierz unikalne serwery (configured + unconfigured które bot zna)
        const guildIds = new Set(allGuilds.map(g => g.id));
        if (this.guildConfigService) {
            for (const id of this.guildConfigService.getAllConfiguredGuildIds()) guildIds.add(id);
        }

        const skipped = [];
        for (const guildId of guildIds) {
            if (!client.guilds.cache.has(guildId)) {
                skipped.push(guildId);
                continue;
            }
            const cfg = this.config.getGuildConfig(guildId) || { lang: 'eng' };
            const commands = this._buildCommands(cfg.lang || 'eng');
            try {
                await rest.put(
                    Routes.applicationGuildCommands(this.config.clientId, guildId),
                    { body: commands }
                );
                logger.info(`✅ Zarejestrowano komendy dla serwera "${client.guilds.cache.get(guildId)?.name || guildId}" (${cfg.lang || 'eng'})`);
            } catch (error) {
                logger.error(`Błąd rejestracji slash commands dla serwera "${client.guilds.cache.get(guildId)?.name || guildId}":`, error);
            }
        }
        if (skipped.length > 0) {
            logger.info(`ℹ️ Pominięto rejestrację komend dla ${skipped.length} serwer(ów) nieobecnych w cache (bot usunięty)`);
        }
    }

    /**
     * Rejestruje komendy slash dla pojedynczego serwera (używane przez guildCreate)
     */
    async registerCommandsForGuild(client, guildId) {
        const rest = new REST().setToken(this.config.token);
        const cfg = this.config.getGuildConfig(guildId) || { lang: 'eng' };
        const commands = this._buildCommands(cfg.lang || 'eng');
        try {
            await rest.put(
                Routes.applicationGuildCommands(this.config.clientId, guildId),
                { body: commands }
            );
            logger.info(`✅ Zarejestrowano komendy dla nowego serwera "${client.guilds.cache.get(guildId)?.name || guildId}"`);
        } catch (error) {
            logger.error(`Błąd rejestracji komend dla serwera "${client.guilds.cache.get(guildId)?.name || guildId}":`, error);
        }
    }

    /**
     * Obsługuje interakcje
     * @param {Interaction} interaction
     */
    async handleInteraction(interaction) {
        if (interaction.isAutocomplete()) {
            await this._handleAutocomplete(interaction);
            return;
        }

        if (interaction.isChatInputCommand()) {
            const guildId = interaction.guildId;

            // Log użycia każdej komendy slash
            this.logService.logCommandUsage(interaction.commandName, interaction);

            // Komendy działające bez konfiguracji (head admin / admin)
            if (interaction.commandName === 'configure') {
                await this.handleConfigureCommand(interaction);
                return;
            }
            if (interaction.commandName === 'manage') {
                if (!this._checkConfigured(interaction)) return;
                await this.handleManageCommand(interaction);
                return;
            }

            if (interaction.commandName === 'generate') {
                await this.handleGenerateCommand(interaction);
                return;
            }

            // Komendy admin — dowolny kanał, ale wymagają konfiguracji serwera
            if (interaction.commandName === 'test') {
                if (!this._checkConfigured(interaction)) return;
                await this.handleTestCommand(interaction);
                return;
            }
            // Pozostałe komendy — wymagają konfiguracji i dozwolonego kanału
            if (!this._checkConfigured(interaction)) return;

            const isHeadAdminBypassCmd = ['ranking', 'achievements', 'subscribe'].includes(interaction.commandName);
            if (!this.isAllowedChannel(interaction.channel.id, guildId) && !(this._isHeadAdmin(interaction.user.id) && isHeadAdminBypassCmd)) {
                await interaction.reply({
                    content: this.msgs(guildId).channelNotAllowed,
                    flags: ['Ephemeral']
                });
                return;
            }

            switch (interaction.commandName) {
                case 'ranking':      await this.handleRankingCommand(interaction);        break;
                case 'update':       await this.handleUpdateCommand(interaction);         break;
                case 'subscribe':    await this.handleNotificationsCommand(interaction);  break;
                case 'achievements': await this.handleAchievementsCommand(interaction); break;
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenuInteraction(interaction);
        } else if (interaction.isRoleSelectMenu()) {
            await this.handleSelectMenuInteraction(interaction);
        } else if (interaction.isChannelSelectMenu()) {
            await this._handleChannelSelectMenu(interaction);
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
            if (interaction.customId === 'panel_remove_search_modal') {
                await this._handlePanelRemoveSearch(interaction);
                return;
            }
            if (interaction.customId === 'panel_unblock_search_modal') {
                await this._handlePanelUnblockSearch(interaction);
                return;
            }
            if (interaction.customId === 'panel_ocr_search_modal') {
                await this._handlePanelOcrSearch(interaction);
                return;
            }
            if (interaction.customId === 'panel_tester_add_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTesterAddModal(interaction);
                return;
            }
            if (interaction.customId === 'top10_interval_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleTop10IntervalModal(interaction);
                return;
            }
            if (interaction.customId === 'panel_block_search_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBlockSearch(interaction);
                return;
            }
            if (interaction.customId === 'panel_ban_guild_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBanGuildSearch(interaction);
                return;
            }
            if (interaction.customId === 'ach_check_modal') {
                await this._handleAchCheckModal(interaction);
                return;
            }
            if (interaction.customId === 'panel_ach_del_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelSearch(interaction);
                return;
            }
            if (interaction.customId.startsWith('panel_block_modal_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                // panel_block_modal_{userId}_{guildId}
                const parts = interaction.customId.replace('panel_block_modal_', '').split('_');
                await this._handlePanelBlockModal(interaction, parts[0], parts[1]);
                return;
            }
            if (interaction.customId === 'cfg_tag_modal') {
                await this._handleConfigureTagModal(interaction);
                return;
            }
            if (interaction.customId.startsWith('cfg_tier_modal_')) {
                await this._handleTierModalSubmit(interaction);
                return;
            }
            if (interaction.customId === 'cfg_cv_threshold_modal') {
                await this._handleConfigureCvThresholdModal(interaction);
                return;
            }
        }
    }

    /**
     * Sprawdza czy serwer jest skonfigurowany, jeśli nie — odpowiada ephemeral i zwraca false
     */
    _checkConfigured(interaction) {
        if (!this.guildConfigService || this.guildConfigService.isConfigured(interaction.guildId)) return true;
        const msgs = this.msgs(interaction.guildId);
        interaction.reply({ content: msgs.notConfigured, flags: ['Ephemeral'] }).catch(() => {});
        return false;
    }

    /**
     * Obsługuje autocomplete (np. /ocr-on-off guild)
     */
    async _handleAutocomplete(interaction) {
        if (interaction.commandName === 'ocr-on-off' && interaction.options.getFocused(true).name === 'guild') {
            const focused = interaction.options.getFocused().toLowerCase();
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const choices = [];
            for (const guildId of configuredIds) {
                const discordGuild = interaction.client.guilds.cache.get(guildId);
                if (!discordGuild) continue;
                const name = discordGuild.name;
                if (name.toLowerCase().includes(focused) || guildId.includes(focused)) {
                    choices.push({ name: `${name} (${guildId})`, value: guildId });
                }
            }
            await interaction.respond(choices.slice(0, 25)).catch(() => {});
        }
    }

    // =====================================================================
    // /configure — wizard konfiguracji serwera
    // =====================================================================

    /** Klucz dla Map stanu wizarda */
    _wizardKey(userId, guildId) { return `${userId}_${guildId}`; }

    /** Buduje embed dashboardu z aktualnymi krokami wizarda */
    _buildWizardDashboard(state, guildId) {
        const msgs = this.msgs(guildId);
        const isPol = state.lang ? state.lang === 'pol' : (this.config.getGuildConfig(guildId)?.lang === 'pol');
        const t = (pol, eng) => isPol ? pol : eng;

        const done = {
            1: !!state.lang,
            2: !!state.allowedChannelId,
            3: !!state.invalidReportChannelId,
            4: state.tag !== null && state.tag !== undefined,
            5: state.rolesSkipped || (state.topRolesTemp?.tierRanges?.length ?? 0) > 0 || state.topRoles !== null,
            6: state.globalTop3Notifications !== null,
            7: state.roleRankingsDone === true,
            8: state.communityVerifDone === true,
        };
        const allDone = Object.values(done).every(Boolean);

        const btn = (n, labelPol, labelEng) => new ButtonBuilder()
            .setCustomId(`cfg_step_${n}`)
            .setLabel(t(labelPol, labelEng))
            .setEmoji(done[n] ? '✅' : '🔘')
            .setStyle(ButtonStyle.Secondary);

        const rows = [
            new ActionRowBuilder().addComponents(
                btn(1, '1. Język', '1. Language'),
                btn(2, '2. Kanał bota', '2. Bot Channel'),
                btn(3, '3. Kanał raportów', '3. Report Channel'),
            ),
            new ActionRowBuilder().addComponents(
                btn(4, '4. Tag serwera', '4. Server Tag'),
                btn(5, '5. Role TOP', '5. TOP Roles'),
                btn(6, '6. Raporty Global TOP10', '6. Global TOP10 Reports'),
                btn(7, '7. Ranking roli', '7. Role Rankings'),
            ),
            new ActionRowBuilder().addComponents(
                btn(8, '8. Weryfikacja społeczności', '8. Community Verification'),
            ),
        ];

        const cancelBtn = new ButtonBuilder()
            .setCustomId('cfg_cancel')
            .setLabel(t('Anuluj', 'Cancel'))
            .setStyle(ButtonStyle.Secondary);

        if (allDone) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cfg_accept')
                    .setLabel(t('Zaakceptuj konfigurację!', 'Accept Configuration!'))
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('panel_diagnostics')
                    .setEmoji('🔍')
                    .setLabel(t('Diagnostyka uprawnień', 'Permission Diagnostics'))
                    .setStyle(ButtonStyle.Secondary),
                cancelBtn
            ));
        } else {
            rows.push(new ActionRowBuilder().addComponents(cancelBtn));
        }


        const tier5Count = (state.topRolesTemp?.tierRanges?.length ?? 0) > 0
            ? state.topRolesTemp.tierRanges.length
            : (state.topRoles?.tiers?.length ?? 0);
        const rankCount = state.roleRankingsCount ?? 0;

        const summaryLines = [
            done[1] ? `✅ 🌐 ${t('Język:', 'Language:')} ${state.lang === 'pol' ? '🇵🇱 Polski' : '🇬🇧 English'}` : null,
            done[2] ? `✅ 📡 ${t('Kanał:', 'Channel:')} <#${state.allowedChannelId}>` : null,
            done[3] ? `✅ ⚠️ ${t('Kanał raportów:', 'Report Channel:')} <#${state.invalidReportChannelId}>` : null,
            done[4] ? `✅ 🏷️ ${t('Tag:', 'Tag:')} ${state.tag}` : null,
            done[5] ? (state.rolesSkipped ? `❌ 🏆 ${t('Role TOP:', 'TOP Roles:')} ${t('Pominięte', 'Skipped')}` : `✅ 🏆 ${t('Role TOP:', 'TOP Roles:')} ${t('Skonfigurowane', 'Configured')} (${tier5Count})`) : null,
            done[6] ? (state.globalTop3Notifications ? `✅ 🔔 ${t('Powiadomienia TOP10:', 'TOP10 Notifications:')} ${t('Włączone', 'Enabled')}` : `❌ 🔔 ${t('Powiadomienia TOP10:', 'TOP10 Notifications:')} ${t('Wyłączone', 'Disabled')}`) : null,
            done[7] ? (rankCount > 0 ? `✅ 🏅 ${t('Ranking roli:', 'Role Rankings:')} ${t('Skonfigurowane', 'Configured')} (${rankCount})` : `❌ 🏅 ${t('Ranking roli:', 'Role Rankings:')} ${t('Pominięte', 'Skipped')}`) : null,
            done[8] ? (state.communityVerifEnabled ? `✅ 🗳️ ${t('Weryfikacja społeczności:', 'Community Verification:')} ${t('Włączona (próg: ', 'Enabled (threshold: ')}${state.communityVerifThreshold || 5}${t(', kanał: ', ', channel: ')}${state.communityVerifChannelId ? `<#${state.communityVerifChannelId}>` : t('brak', 'none')})` : `❌ 🗳️ ${t('Weryfikacja społeczności:', 'Community Verification:')} ${t('Wyłączona', 'Disabled')}`) : null,
        ].filter(Boolean);

        const embed = new EmbedBuilder()
            .setColor(allDone ? 0x57F287 : 0x5865F2)
            .setTitle(t('⚙️ Konfiguracja EndersEcho', '⚙️ EndersEcho Configuration'))
            .setDescription(
                t(
                    'Uzupełnij wszystkie kroki poniżej, aby aktywować bota na tym serwerze.\nKlikaj przyciski aby konfigurować poszczególne elementy.',
                    'Complete all steps below to activate EndersEcho on this server.\nClick each button to configure that step.'
                ) + '\n\n' +
                (() => {
                    const updateBlocked = this.ocrBlockService.isBlocked(guildId, 'update');
                    const testBlocked = this.ocrBlockService.isBlocked(guildId, 'test');
                    const thasharLink = '[Thashar](https://discord.com/users/398983446812295168)';
                    const contactLine = t(
                        `\n💡 W razie pytań skontaktuj się z ${thasharLink}.`,
                        `\n💡 For questions, contact ${thasharLink}.`
                    );
                    let ocrLine;
                    if (updateBlocked && testBlocked) {
                        ocrLine = t(
                            `⚠️ Komendy \`/update\` i \`/test\` są **wyłączone**. Aby je włączyć, skontaktuj się z ${thasharLink}.`,
                            `⚠️ Commands \`/update\` and \`/test\` are **disabled**. To enable them, contact ${thasharLink}.`
                        );
                    } else if (!updateBlocked && !testBlocked) {
                        ocrLine = t(
                            `✅ Komendy \`/update\` i \`/test\` są **włączone** i gotowe do użycia.`,
                            `✅ Commands \`/update\` and \`/test\` are **enabled** and ready to use.`
                        ) + contactLine;
                    } else if (!updateBlocked && testBlocked) {
                        ocrLine = t(
                            `✅ Komenda \`/update\` jest **włączona**. Komenda \`/test\` jest wyłączona.`,
                            `✅ Command \`/update\` is **enabled**. Command \`/test\` is disabled.`
                        ) + contactLine;
                    } else {
                        ocrLine = t(
                            `✅ Komenda \`/test\` jest **włączona**. Komenda \`/update\` jest wyłączona.`,
                            `✅ Command \`/test\` is **enabled**. Command \`/update\` is disabled.`
                        ) + contactLine;
                    }
                    const diagHint = allDone ? t(
                        '\n🔍 Użyj przycisku **Diagnostyka uprawnień** poniżej, aby sprawdzić czy bot ma wszystkie wymagane uprawnienia na tym serwerze.',
                        '\n🔍 Use the **Permission Diagnostics** button below to verify that the bot has all required permissions on this server.'
                    ) : '';
                    return t(
                        '📋 **Przegląd kroków:**\n' +
                        '1️⃣  **Język** — interfejs po polsku lub angielsku\n' +
                        '2️⃣  **Kanał bota** — kanał dla `/update`, `/ranking`, `/subscribe` i `/achievements`\n' +
                        '3️⃣  **Kanał raportów** — gdzie trafiają alerty o odrzuconych screenach\n' +
                        '4️⃣  **Tag serwera** — 1–4 znaki/emoji widoczne w globalnym rankingu\n' +
                        '5️⃣  **Role TOP** *(opcjonalne)* — konfigurowalne automatyczne role za pozycje w rankingu\n' +
                        '6️⃣  **Raporty Global TOP10** — publikowane po zmianie bossa\n' +
                        '7️⃣  **Ranking roli** *(opcjonalne)* — osobne rankingi dla posiadaczy wybranych ról\n' +
                        '8️⃣  **Weryfikacja społeczności** *(opcjonalne)* — przycisk "Zgłoś" pod rekordami, moderacja przez graczy\n\n' +
                        '💡 Po zakończeniu konfiguracji możesz otwierać Panel Admina bezpośrednio przez `/manage`.\n' +
                        ocrLine + diagHint,
                        '📋 **Steps overview:**\n' +
                        '1️⃣  **Language** — Polish or English interface\n' +
                        '2️⃣  **Bot Channel** — where `/update`, `/ranking`, `/subscribe` and `/achievements` work\n' +
                        '3️⃣  **Report Channel** — where rejected screenshot alerts appear\n' +
                        '4️⃣  **Server Tag** — 1–4 char/emoji shown in the global ranking\n' +
                        '5️⃣  **TOP Roles** *(optional)* — configurable automatic roles based on ranking positions\n' +
                        '6️⃣  **Global TOP10 Reports** — published after boss change\n' +
                        '7️⃣  **Role Rankings** *(optional)* — separate rankings for holders of specific roles\n' +
                        '8️⃣  **Community Verification** *(optional)* — "Report" button on records, player-driven moderation\n\n' +
                        '💡 Once configuration is complete, open the Admin Panel directly with `/manage`.\n' +
                        ocrLine + diagHint
                    );
                })() + (summaryLines.length > 0 ? '\n\n**' + t('Aktualne ustawienia:', 'Current settings:') + '**\n' + summaryLines.join('\n') : '')
            );

        return { embed, rows, allDone };
    }

    async handleConfigureCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.configureNotAdmin, flags: ['Ephemeral'] });
            return;
        }

        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        // Jeśli już istnieje sesja — użyj jej; inaczej pre-wypełnij z istniejącej konfiguracji lub pusta
        if (!this._configWizard.has(key)) {
            const existing = this.guildConfigService?.getConfig(interaction.guildId);
            if (existing?.configured) {
                const existingCv = existing.communityVerification || {};
                const existingRoleRankings = await this.roleRankingConfigService.loadRoleRankings(interaction.guildId);
                this._configWizard.set(key, {
                    allowedChannelId: existing.allowedChannelId || null,
                    invalidReportChannelId: existing.invalidReportChannelId || null,
                    tag: existing.tag !== undefined ? existing.tag : null,
                    lang: existing.lang || null,
                    topRoles: existing.topRoles || null,
                    rolesSkipped: !existing.topRoles || existing.topRoles.disabled === true,
                    globalTop3Notifications: existing.globalTopNotifications ?? existing.globalTop3Notifications ?? true,
                    roleRankingsDone: true,
                    roleRankingsCount: existingRoleRankings.length,
                    communityVerifDone: true,
                    communityVerifEnabled: existingCv.enabled === true,
                    communityVerifChannelId: existingCv.rejectedChannelId || null,
                    communityVerifThreshold: existingCv.threshold || 5,
                });
            } else {
                this._configWizard.set(key, {
                    allowedChannelId: null,
                    invalidReportChannelId: null,
                    tag: null,
                    lang: null,
                    topRoles: null,
                    rolesSkipped: false,
                    globalTop3Notifications: null,
                    roleRankingsDone: false,
                    roleRankingsCount: 0,
                    communityVerifDone: false,
                    communityVerifEnabled: false,
                    communityVerifChannelId: null,
                    communityVerifThreshold: 5,
                });
            }
        }

        const state = this._configWizard.get(key);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.reply({ embeds: [embed], components: rows, flags: ['Ephemeral'] });
    }

    async handleManageCommand(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.configureNotAdmin, flags: ['Ephemeral'] });
            return;
        }
        const { embed, components } = this._buildAdminPanel(interaction);
        await interaction.reply({ embeds: [embed], components, flags: ['Ephemeral'] });
    }

    async handleGenerateCommand(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferReply();

        try {
            const msgs  = this.msgs(interaction.guildId);
            const embed = await this.globalTop10Service.buildOnDemandEmbed(msgs, interaction.client);
            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            logger.error(`[/generate] Błąd: ${err.message}`);
            await interaction.editReply({ content: '❌ Błąd podczas generowania TOP 10.' });
        }
    }

    /** Buduje embed kroku konfiguracji (step 1–6) i aktualizuje wiadomość */
    async _showConfigureStep(interaction, step) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) {
            await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] });
            return;
        }

        const guildId = interaction.guildId;
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const backBtn = new ButtonBuilder().setCustomId('cfg_back').setLabel(t('← Wstecz', '← Back')).setStyle(ButtonStyle.Secondary);

        if (step === 1) {
            const currentLangLine = state.lang
                ? '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + (state.lang === 'pol' ? '🇵🇱 Polski' : '🇬🇧 English')
                : '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + t('Nie ustawiono', 'Not set');
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🌐 Krok 1 — Język', '🌐 Step 1 — Language'))
                .setDescription(
                    t(
                        'Wybierz język interfejsu dla tego serwera.\nWszystkie wiadomości bota, powiadomienia i opisy komend będą wyświetlane w wybranym języku.',
                        'Choose the display language for this server.\nAll bot messages, notifications and command descriptions will appear in the selected language.'
                    ) + currentLangLine
                );
            const polBtn = new ButtonBuilder().setCustomId('cfg_lang_pol').setLabel(t('Polski', 'Polish')).setEmoji('🇵🇱').setStyle(ButtonStyle.Primary);
            const engBtn = new ButtonBuilder().setCustomId('cfg_lang_eng').setLabel(t('Angielski', 'English')).setEmoji('🇬🇧').setStyle(ButtonStyle.Primary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(polBtn, engBtn, backBtn)] });

        } else if (step === 2) {
            const currentChLine = state.allowedChannelId
                ? '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** <#' + state.allowedChannelId + '>'
                : '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + t('Nie ustawiono', 'Not set');
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('📡 Krok 2 — Kanał bota', '📡 Step 2 — Bot Channel'))
                .setDescription(
                    t(
                        'Wybierz kanał, na którym użytkownicy będą używać komend EndersEcho.\n\n' +
                        '**Dostępne na tym kanale (wszyscy):**\n• `/update` — prześlij wynik\n• `/ranking` — wyświetl ranking\n• `/subscribe` — zarządzaj powiadomieniami\n• `/achievements` — wyświetl osiągnięcia\n\n' +
                        'Komendy adminów są dostępne przez `/manage` z dowolnego kanału.',
                        'Choose the channel where users can run EndersEcho commands.\n\n' +
                        '**Available in this channel (all users):**\n• `/update` — submit a score\n• `/ranking` — view rankings\n• `/subscribe` — manage notifications\n• `/achievements` — view achievements\n\n' +
                        'Admin commands are available through `/manage` from any channel.'
                    ) + currentChLine
                );
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('cfg_channel_select')
                .setPlaceholder(t('Wybierz kanał tekstowy...', 'Choose a text channel...'))
                .setChannelTypes(ChannelType.GuildText);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(backBtn)] });

        } else if (step === 3) {
            const currentRepLine = state.invalidReportChannelId
                ? '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** <#' + state.invalidReportChannelId + '>'
                : '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + t('Nie ustawiono', 'Not set');
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('⚠️ Krok 3 — Kanał raportów', '⚠️ Step 3 — Report Channel'))
                .setDescription(
                    t(
                        'Gdy użytkownik prześle screenshot, który zostanie odrzucony (podrobione zdjęcie, zły screen, brak Victory), raport jest generowany automatycznie.\n\nUstaw dedykowany kanał na swoim serwerze, na którym będą pojawiać się te raporty. Twoi moderatorzy będą mogli zatwierdzać lub blokować użytkowników bezpośrednio z serwera.',
                        'When a user submits a screenshot that is rejected (fake photo, wrong screen, no Victory found), a report is generated automatically.\n\nSet a dedicated channel on your server where these reports appear. Your moderators can then approve or block users directly from your server.'
                    ) + currentRepLine
                );
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('cfg_report_channel_select')
                .setPlaceholder(t('Wybierz kanał raportów...', 'Choose a report channel...'))
                .setChannelTypes(ChannelType.GuildText);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(backBtn)] });

        } else if (step === 4) {
            const currentTagLine = (state.tag !== null && state.tag !== undefined)
                ? '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + state.tag
                : '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + t('Nie ustawiono', 'Not set');
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🏷️ Krok 4 — Tag serwera', '🏷️ Step 4 — Server Tag'))
                .setDescription(
                    t(
                        'Tag to krótki identyfikator (1–4 znaki) wyświetlany obok wyników Twojego serwera w globalnym rankingu.\n\nTag może być tekstem lub emoji.\nPrzykłady: 🇵🇱  ☆  Ӂ  US  PS  EU',
                        'The tag is a short identifier (1–4 characters) shown next to your server\'s players in the global ranking.\n\nThe tag can be text or an emoji.\nExamples: 🇵🇱  ☆  Ӂ  US  PS  EU'
                    ) + currentTagLine
                );
            const tagBtn = new ButtonBuilder().setCustomId('cfg_tag_open').setLabel(t('Wprowadź tag', 'Enter Tag')).setStyle(ButtonStyle.Primary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(tagBtn, backBtn)] });

        } else if (step === 5) {
            await this._showStep5Screen(interaction, state);

        } else if (step === 6) {
            const currentNotifLine = (state.globalTop3Notifications !== null && state.globalTop3Notifications !== undefined)
                ? '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + (state.globalTop3Notifications ? t('✅ Włączone', '✅ Enabled') : t('❌ Wyłączone', '❌ Disabled'))
                : '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + t('Nie ustawiono', 'Not set');
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🌐 Krok 6 — Raporty Global TOP10', '🌐 Step 6 — Global TOP10 Reports'))
                .setDescription(
                    t(
                        'Bot może cyklicznie (co ~3 dni) wysyłać na Twój kanał raport TOP10 globalnego rankingu EndersEcho.\n\nRaport zawiera: 10 najlepszych graczy ze wszystkich serwerów, ich wyniki, zmiany pozycji (▲/▼) od poprzedniego raportu oraz bossa, z którym walczono w tym okresie.\n\nCzy chcesz otrzymywać te raporty?',
                        'The bot can periodically (every ~3 days) send a TOP10 global ranking report to your channel.\n\nThe report includes: top 10 players from all servers, their scores, position changes (▲/▼) since the last report, and the boss fought during that period.\n\nWould you like to receive these reports?'
                    ) + currentNotifLine
                );
            const step6Btns = [];
            if (state.globalTop3Notifications !== true) {
                step6Btns.push(new ButtonBuilder().setCustomId('cfg_notif_yes').setLabel(t('Włącz', 'Enable')).setEmoji('✅').setStyle(ButtonStyle.Success));
            } else {
                step6Btns.push(new ButtonBuilder().setCustomId('cfg_notif_no').setLabel(t('Wyłącz', 'Disable')).setEmoji('❌').setStyle(ButtonStyle.Secondary));
            }
            if (state.globalTop3Notifications === null) {
                step6Btns.push(new ButtonBuilder().setCustomId('cfg_notif_no').setLabel(t('Pomiń', 'Skip')).setStyle(ButtonStyle.Secondary));
            }
            step6Btns.push(backBtn);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...step6Btns)] });

        } else if (step === 7) {
            const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);
            const list = existing.length > 0
                ? '\n\n**' + t('Aktualne rankingi:', 'Current rankings:') + '**\n' + existing.map(r => `• <@&${r.roleId}> — ${r.roleName}`).join('\n')
                : '';
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🏅 Krok 7 — Ranking roli (opcjonalne)', '🏅 Step 7 — Role Rankings (optional)'))
                .setDescription(
                    t(
                        'Możesz tworzyć osobne rankingi dla posiadaczy wybranych ról Discord. Przydatne gdy na serwerze są różne grupy klanowe lub rangowe z własną rywalizacją.\n\nMax 10 rankingów ról. Ranking roli to osobny `/ranking` widoczny dla graczy z daną rolą.\n\nMożesz pominąć ten krok i skonfigurować rankingi ról później przez `/configure`.',
                        'You can create separate rankings for holders of specific Discord roles. Useful when your server has clan or rank groups competing independently.\n\nMax 10 role rankings. A role ranking is a separate `/ranking` visible to players with that role.\n\nYou can skip this step and configure role rankings later by running `/configure`.'
                    ) + list
                );
            const addBtn = new ButtonBuilder()
                .setCustomId('cfg_role_ranking_add')
                .setLabel(t('Dodaj ranking roli', 'Add Role Ranking'))
                .setStyle(ButtonStyle.Primary);
            const removeBtn = new ButtonBuilder()
                .setCustomId('cfg_role_ranking_remove')
                .setLabel(t('Usuń ranking roli', 'Remove Role Ranking'))
                .setStyle(ButtonStyle.Danger)
                .setDisabled(existing.length === 0);
            const rowBtns = [addBtn, removeBtn];
            if (!state.roleRankingsDone) {
                rowBtns.push(new ButtonBuilder()
                    .setCustomId('cfg_role_ranking_skip')
                    .setLabel(t('Pomiń', 'Skip'))
                    .setStyle(ButtonStyle.Secondary));
            }
            rowBtns.push(backBtn);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...rowBtns)] });

        } else if (step === 8) {
            const cvCfg = this.guildConfigService?.getCommunityVerification(guildId) || {};
            const currentThreshold = state.communityVerifThreshold ?? cvCfg.threshold ?? 5;
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🗳️ Krok 8 — Weryfikacja społeczności (opcjonalne)', '🗳️ Step 8 — Community Verification (optional)'))
                .setDescription(t(
                    'Gdy ta opcja jest włączona, pod każdym nowym rekordem pojawi się przycisk **⚠️ Zgłoś**.\n\n' +
                    '**Jak działa:**\n' +
                    '• Głosować mogą tylko gracze obecni w rankingu tego serwera\n' +
                    '• Gracz nie może zgłosić własnego wyniku\n' +
                    '• Po osiągnięciu progu zgłoszeń: użytkownik blokowany na **24h** lub do zatwierdzenia przez admina\n' +
                    '• Na kanał raportów trafia embed z linkiem do zgłoszonej wiadomości i przyciskami akcji admina\n' +
                    '• To samo zgłoszenie wysyłane jest na globalny kanał raportów (dla head admina)\n' +
                    '• Sesja głosowania wygasa po 24h\n\n' +
                    '**Akcje admina po zgłoszeniu:**\n' +
                    '✅ **Zatwierdź** — usuwa przyciski z raportu, odblokuje użytkownika\n' +
                    '🗑️ **Usuń rekord i osiągnięcia** — przywraca poprzedni wynik (lub usuwa wpis) i cofa zdobyte osiągnięcia\n' +
                    '🔒 **Zablokuj permanentnie + usuń rekord** — permanentna blokada + usunięcie rekordu i osiągnięć',
                    'When enabled, a **⚠️ Report** button appears under every new record.\n\n' +
                    '**How it works:**\n' +
                    '• Only players present in this server\'s ranking can vote\n' +
                    '• Players cannot report their own scores\n' +
                    '• When the report threshold is reached: user is blocked for **24h** or until admin review\n' +
                    '• A report embed with a link to the flagged message and admin action buttons is sent to the report channel\n' +
                    '• The same report is also sent to the global report channel (for head admins)\n' +
                    '• The voting session expires after 24h\n\n' +
                    '**Admin actions after a report:**\n' +
                    '✅ **Approve** — removes buttons from the report, unblocks the user\n' +
                    '🗑️ **Remove Record & Achievements** — restores the previous score (or deletes the entry) and reverts earned achievements\n' +
                    '🔒 **Permanent Ban + Remove Record** — permanent block + record and achievements removal'
                ) + '\n\n' + t(
                    `**Aktualny próg:** ${currentThreshold} zgłoszeń`,
                    `**Current threshold:** ${currentThreshold} reports`
                ) + '\n' + (state.communityVerifEnabled
                    ? t('**Status:** ✅ Włączony', '**Status:** ✅ Enabled')
                    : t('**Status:** ❌ Wyłączony', '**Status:** ❌ Disabled')
                ));

            const thresholdBtn = new ButtonBuilder().setCustomId('cfg_cv_threshold').setLabel(t('Ustaw próg', 'Set Threshold')).setEmoji('🔢').setStyle(ButtonStyle.Primary);
            const step8Btns = [];
            if (!state.communityVerifEnabled) {
                step8Btns.push(new ButtonBuilder().setCustomId('cfg_cv_enable').setLabel(t('Włącz', 'Enable')).setEmoji('✅').setStyle(ButtonStyle.Success));
            } else {
                step8Btns.push(new ButtonBuilder().setCustomId('cfg_cv_disable').setLabel(t('Wyłącz', 'Disable')).setEmoji('❌').setStyle(ButtonStyle.Secondary));
            }
            step8Btns.push(thresholdBtn);
            if (!state.communityVerifDone) {
                step8Btns.push(new ButtonBuilder().setCustomId('cfg_cv_disable').setLabel(t('Pomiń', 'Skip')).setStyle(ButtonStyle.Secondary));
            }
            step8Btns.push(backBtn);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...step8Btns)] });
        }
    }

    async _handleChannelSelectMenu(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] }); return; }

        if (interaction.customId === 'cfg_channel_select') {
            state.allowedChannelId = interaction.values[0];
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
        } else if (interaction.customId === 'cfg_report_channel_select') {
            const selectedId = interaction.values[0];
            const isPol = state.lang === 'pol';
            if (!state.allowedChannelId) {
                await interaction.reply({
                    content: isPol
                        ? '❌ Najpierw wybierz kanał bota (krok 2), a dopiero potem kanał raportów.'
                        : '❌ Please set the bot channel first (step 2) before choosing the report channel.',
                    flags: ['Ephemeral']
                });
                return;
            }
            if (selectedId === state.allowedChannelId) {
                await interaction.reply({
                    content: isPol
                        ? '❌ Kanał raportów nie może być tym samym kanałem co kanał bota. Wybierz inny kanał.'
                        : '❌ The report channel cannot be the same as the bot channel. Please choose a different channel.',
                    flags: ['Ephemeral']
                });
                return;
            }
            state.invalidReportChannelId = selectedId;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
        } else if (interaction.customId === 'cfg_cv_channel_select') {
            state.communityVerifChannelId = interaction.values[0];
            state.communityVerifEnabled = true;
            state.communityVerifDone = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
        }
    }

    async _handleConfigureTagModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired. Run `/configure` again.', flags: ['Ephemeral'] }); return; }

        const tag = interaction.fields.getTextInputValue('cfg_tag_input').trim();
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const msgs = this.msgs(interaction.guildId);

        if (!tag) {
            await interaction.reply({ content: msgs.configureTagEmpty, flags: ['Ephemeral'] }); return;
        }
        // Policz widoczne znaki (emoji flagowe = 1 display char)
        const visLen = [...new Intl.Segmenter().segment(tag)].length;
        if (visLen > 4) {
            await interaction.reply({ content: msgs.configureTagTooLong, flags: ['Ephemeral'] }); return;
        }
        // Sprawdź czy tag nie jest już zajęty przez inny serwer
        const takenByGuild = this.guildConfigService?.getAllConfiguredGuilds()
            .find(g => g.id !== interaction.guildId && g.tag && g.tag.toLowerCase() === tag.toLowerCase());
        if (takenByGuild) {
            await interaction.reply({
                content: t(
                    `❌ Tag **${tag}** jest już zajęty przez inny serwer. Wybierz inny tag.`,
                    `❌ Tag **${tag}** is already taken by another server. Please choose a different tag.`
                ),
                flags: ['Ephemeral']
            });
            return;
        }
        state.tag = tag;
        this._configWizard.set(key, state);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.update({ embeds: [embed], components: rows });
    }

    async _showTierConfigScreen(interaction, state, wizardKey) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const tierRanges = state.topRolesTemp?.tierRanges || [];
        const MAX_TIERS = 20;
        const fmtRange = (r) => r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;

        const desc = t(
            'Skonfiguruj progi rankingowe. Każdy próg to zakres pozycji w rankingu.\n\nKlikaj przyciski kolejno — następny pojawia się po ustawieniu poprzedniego. Aby zmienić lub usunąć próg, kliknij go ponownie (puste pole = usuń).\n\n**Przykład:** Próg 1 = `1–3`, Próg 2 = `4–10`, Próg 3 = `11–30`',
            'Configure ranking tiers. Each tier is a range of ranking positions.\n\nClick buttons in order — the next appears after setting the previous. To change or remove a tier, click it again (leave empty to remove).\n\n**Example:** Tier 1 = `1–3`, Tier 2 = `4–10`, Tier 3 = `11–30`'
        );

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('🏆 Konfiguracja progów', '🏆 Tier Configuration'))
            .setDescription(desc);

        // Pokaż tylko skonfigurowane progi + jeden następny (max 20), żadnych nieaktywnych
        const visibleCount = Math.min(tierRanges.length + 1, MAX_TIERS);
        const tierBtns = [];
        for (let i = 0; i < visibleCount; i++) {
            const r = tierRanges[i];
            const isConfigured = !!r;
            const label = isConfigured
                ? `${t('Próg', 'Tier')} ${i + 1} (${fmtRange(r)})`
                : `${t('Próg', 'Tier')} ${i + 1}`;
            tierBtns.push(new ButtonBuilder()
                .setCustomId(`cfg_tier_${i}`)
                .setLabel(label)
                .setEmoji(isConfigured ? '✅' : '🔘')
                .setStyle(ButtonStyle.Secondary));
        }

        const tierRows = [];
        for (let i = 0; i < tierBtns.length; i += 5) {
            tierRows.push(new ActionRowBuilder().addComponents(...tierBtns.slice(i, i + 5)));
        }

        const assignBtn = new ButtonBuilder()
            .setCustomId('cfg_roles_configure')
            .setLabel(t('Skonfiguruj role progów', 'Configure Tier Roles'))
            .setEmoji('🎭')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(tierRanges.length === 0);
        const backBtn = new ButtonBuilder()
            .setCustomId('cfg_tier_back')
            .setLabel(t('← Wstecz', '← Back'))
            .setStyle(ButtonStyle.Secondary);

        const components = [...tierRows, new ActionRowBuilder().addComponents(assignBtn, backBtn)];
        await interaction.update({ embeds: [embed], components });
    }

    async _showStep5Screen(interaction, state) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const fmtRange = (r) => r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;

        // topRolesTemp ma priorytet — dane edytowane ale jeszcze niezapisane
        let effectiveTiers = null;
        if ((state.topRolesTemp?.tierRanges?.length ?? 0) > 0) {
            const assigningNow = state.topRolesTemp.tierAssigning || {};
            effectiveTiers = state.topRolesTemp.tierRanges.map((r, i) => ({
                from: r.from, to: r.to, roleId: assigningNow[i] || null
            }));
        } else if (state.topRoles?.tiers?.length > 0) {
            effectiveTiers = state.topRoles.tiers;
        } else if (state.topRoles && !state.topRoles.tiers) {
            const nm = [];
            if (state.topRoles.top1)      nm.push({ from: 1,  to: 1,  roleId: state.topRoles.top1 });
            if (state.topRoles.top2)      nm.push({ from: 2,  to: 2,  roleId: state.topRoles.top2 });
            if (state.topRoles.top3)      nm.push({ from: 3,  to: 3,  roleId: state.topRoles.top3 });
            if (state.topRoles.top4to10)  nm.push({ from: 4,  to: 10, roleId: state.topRoles.top4to10 });
            if (state.topRoles.top11to30) nm.push({ from: 11, to: 30, roleId: state.topRoles.top11to30 });
            if (nm.length > 0) effectiveTiers = nm;
        }
        const hasTiers = (effectiveTiers?.length ?? 0) > 0;
        const isDisabled = state.rolesSkipped === true;

        let desc = t(
            'Możesz przypisać specjalne role Discord graczom na podstawie ich pozycji w rankingu serwera. To świetny sposób na wyróżnienie najbardziej aktywnych graczy.\n\n' +
            '**Jak to działa:**\nKażdy raz gdy wynik gracza zostanie zaktualizowany, bot automatycznie przelicza ranking i przypisuje role. Nie wymaga ręcznej pracy.\nGracze, którzy wypadną z danego progu, tracą rolę i mogą otrzymać niższą.\n\n' +
            '**Konfiguracja:**\nMożesz zdefiniować do **20 progów** — każdy próg to zakres pozycji rankingowych i przypisana rola Discord.\nPrzykład: Próg 1 = miejsca 1–3 → rola Gold, Próg 2 = miejsca 4–10 → rola Silver.\n\nMożesz pominąć ten krok i skonfigurować role później przez `/configure`.',
            'You can assign special Discord roles to players based on their position in the server ranking. This highlights your most active players.\n\n' +
            '**How it works:**\nEvery time a player\'s score is updated, the bot automatically recalculates the ranking and reassigns roles in real time. No manual work needed.\nPlayers who drop out of a tier lose the role and may receive a lower one.\n\n' +
            '**Configuration:**\nYou can define up to **20 tiers** — each tier is a range of ranking positions with an assigned Discord role.\nExample: Tier 1 = positions 1–3 → Gold role, Tier 2 = positions 4–10 → Silver role.\n\nYou can skip this step and configure roles later by running `/configure` again.'
        );

        if (hasTiers) {
            const statusStr = isDisabled
                ? t('🔴 **Wyłączone**', '🔴 **Disabled**')
                : t('🟢 **Aktywne**', '🟢 **Active**');
            const tierLines = effectiveTiers.map((tier, i) => {
                const roleStr = tier.roleId ? `<@&${tier.roleId}>` : t('*(brak roli)*', '*(no role)*');
                return `**${t('Próg', 'Tier')} ${i + 1}** (${fmtRange(tier)}) → ${roleStr}`;
            }).join('\n');
            desc += `\n\n${t('**Aktualna konfiguracja:**', '**Current configuration:**')} ${statusStr}\n${tierLines}`;
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('🏆 Krok 5 — Role TOP (opcjonalne)', '🏆 Step 5 — TOP Roles (optional)'))
            .setDescription(desc);

        const configBtn = new ButtonBuilder()
            .setCustomId('cfg_roles_start')
            .setLabel(t('Skonfiguruj role', 'Configure Roles'))
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary);

        let actionBtn;
        if (!hasTiers) {
            actionBtn = new ButtonBuilder()
                .setCustomId('cfg_roles_skip')
                .setLabel(t('Pomiń', 'Skip'))
                .setStyle(ButtonStyle.Secondary);
        } else if (isDisabled) {
            actionBtn = new ButtonBuilder()
                .setCustomId('cfg_roles_enable')
                .setLabel(t('Włącz', 'Enable'))
                .setEmoji('🔔')
                .setStyle(ButtonStyle.Success);
        } else {
            actionBtn = new ButtonBuilder()
                .setCustomId('cfg_roles_skip')
                .setLabel(t('Wyłącz', 'Disable'))
                .setEmoji('🔕')
                .setStyle(ButtonStyle.Secondary);
        }

        const backBtn = new ButtonBuilder()
            .setCustomId('cfg_back')
            .setLabel(t('← Powrót do dashboardu', '← Back to Dashboard'))
            .setStyle(ButtonStyle.Secondary);

        const step5Rows = [new ActionRowBuilder().addComponents(configBtn, actionBtn)];
        if (hasTiers) {
            step5Rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cfg_tier_reset')
                    .setLabel(t('Usuń wszystkie progi i role', 'Remove All Tiers & Roles'))
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger)
            ));
        }
        step5Rows.push(new ActionRowBuilder().addComponents(backBtn));

        await interaction.update({ embeds: [embed], components: step5Rows });
    }

    async _showTierRoleAssign(interaction, state, wizardKey, tierIdx) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const tierRanges = state.topRolesTemp?.tierRanges || [];
        const tier = tierRanges[tierIdx];
        const assigning = state.topRolesTemp?.tierAssigning || {};

        const fmtR = (r) => r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
        const existingRoleId = assigning[tierIdx];
        const currentStr = existingRoleId
            ? t(`Aktualnie przypisana: <@&${existingRoleId}>`, `Currently assigned: <@&${existingRoleId}>`)
            : t('Brak przypisanej roli.', 'No role assigned.');

        const desc = t(
            `Wybierz rolę Discord dla **Progu ${tierIdx + 1}** (miejsce${tier.from === tier.to ? '' : 'a'} ${fmtR(tier)}).\n\n${currentStr}`,
            `Select a Discord role for **Tier ${tierIdx + 1}** (position${tier.from === tier.to ? '' : 's'} ${fmtR(tier)}).\n\n${currentStr}`
        );

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t(`🏆 Przydziel rolę — Próg ${tierIdx + 1} (${fmtR(tier)})`, `🏆 Assign Role — Tier ${tierIdx + 1} (${fmtR(tier)})`))
            .setDescription(desc);

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`cfg_roles_sel_${tierIdx}`)
            .setPlaceholder(t(`Wybierz rolę dla Progu ${tierIdx + 1}`, `Select role for Tier ${tierIdx + 1}`))
            .setMinValues(1)
            .setMaxValues(1);
        if (existingRoleId && /^\d{17,20}$/.test(String(existingRoleId))) {
            try { roleSelect.setDefaultRoles([existingRoleId]); } catch { /* ignoruj */ }
        }

        const clearBtn = new ButtonBuilder()
            .setCustomId(`cfg_roles_skip_${tierIdx}`)
            .setLabel(t('Brak roli', 'No Role'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!existingRoleId);
        const backBtn = new ButtonBuilder()
            .setCustomId(`cfg_roles_back_${tierIdx}`)
            .setLabel(t('← Wstecz', '← Back'))
            .setStyle(ButtonStyle.Secondary);

        await interaction.update({
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(roleSelect),
                new ActionRowBuilder().addComponents(clearBtn, backBtn),
            ]
        });
    }

    async _showRoleAssignScreen(interaction, state, key) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const tierRanges = state.topRolesTemp?.tierRanges || [];
        const assigning = state.topRolesTemp?.tierAssigning || {};
        const fmtRange = (r) => r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;

        const allAssigned = tierRanges.length > 0 && tierRanges.every((_, i) => !!assigning[i]);
        const statusLine = allAssigned
            ? t('✅ Wszystkie progi mają przypisane role.', '✅ All tiers have roles assigned.')
            : t('⚠️ Nie wszystkie progi mają przypisane role.', '⚠️ Not all tiers have roles assigned.');

        const lines = tierRanges.map((r, i) => {
            const roleId = assigning[i];
            const roleStr = roleId ? `<@&${roleId}>` : t('*(brak roli)*', '*(no role)*');
            return `**${t('Próg', 'Tier')} ${i + 1}** (${fmtRange(r)}) → ${roleStr}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(allAssigned ? 0x57F287 : 0x5865F2)
            .setTitle(t('🏆 Przypisz role do progów', '🏆 Assign Roles to Tiers'))
            .setDescription(
                t('Przypisz rolę Discord do każdego progu. Kliknij przycisk progu aby wybrać rolę.', 'Assign a Discord role to each tier. Click a tier button to select a role.') +
                `\n\n${statusLine}\n\n${lines}`
            );

        const roleBtns = tierRanges.map((r, i) => {
            const roleId = assigning[i];
            const roleName = roleId ? (interaction.guild.roles.cache.get(roleId)?.name ?? null) : null;
            const label = roleName
                ? `${roleName} (${fmtRange(r)})`
                : `${t('Brak roli', 'No role')} (${fmtRange(r)})`;
            return new ButtonBuilder()
                .setCustomId(`cfg_role_btn_${i}`)
                .setLabel(label)
                .setEmoji(roleName ? '✅' : '➕')
                .setStyle(roleName ? ButtonStyle.Primary : ButtonStyle.Secondary);
        });

        const roleRows = [];
        for (let i = 0; i < roleBtns.length; i += 5) {
            roleRows.push(new ActionRowBuilder().addComponents(...roleBtns.slice(i, i + 5)));
        }

        const backBtn = new ButtonBuilder()
            .setCustomId('cfg_roles_assign_back')
            .setLabel(t('← Wstecz', '← Back'))
            .setStyle(ButtonStyle.Secondary);

        await interaction.update({ embeds: [embed], components: [...roleRows, new ActionRowBuilder().addComponents(backBtn)] });
    }

    async _showRoleAssignBackConfirm(interaction, state) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle(t('⚠️ Nie wszystkie role są przypisane', '⚠️ Not all roles assigned'))
            .setDescription(t(
                'Nie wszystkie progi mają przypisane role. Konfiguracja zostanie zapisana z brakującymi rolami, co oznacza że progi bez ról **nie będą miały efektu**.\n\nCzy na pewno chcesz wyjść?',
                'Not all tiers have roles assigned. The configuration will be saved with missing roles, meaning tiers without roles **will have no effect**.\n\nAre you sure you want to go back?'
            ));

        const stayBtn = new ButtonBuilder()
            .setCustomId('cfg_roles_stay')
            .setLabel(t('Nie, dokończ przypisywanie', 'No, finish assigning'))
            .setEmoji('🎭')
            .setStyle(ButtonStyle.Primary);
        const confirmBtn = new ButtonBuilder()
            .setCustomId('cfg_roles_back_confirm')
            .setLabel(t('Tak, wróć do progów', 'Yes, go back to tiers'))
            .setStyle(ButtonStyle.Secondary);

        await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(stayBtn, confirmBtn)] });
    }

    async _handleTierModalSubmit(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired. Run `/configure` again.', flags: ['Ephemeral'] }); return; }

        const tierIdx = parseInt(interaction.customId.replace('cfg_tier_modal_', ''), 10);
        const raw = interaction.fields.getTextInputValue('tier_range').trim();
        const isPol = state.lang === 'pol';

        // Puste pole = usuń ten próg i wszystkie kolejne
        if (raw === '') {
            if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
            state.topRolesTemp.tierRanges = state.topRolesTemp.tierRanges.slice(0, tierIdx);
            if (state.topRolesTemp.tierAssigning) {
                for (const k of Object.keys(state.topRolesTemp.tierAssigning).map(Number)) {
                    if (k >= tierIdx) delete state.topRolesTemp.tierAssigning[k];
                }
            }
            this._configWizard.set(key, state);
            await this._showTierConfigScreen(interaction, state, key);
            return;
        }

        let from, to;
        if (/^\d+$/.test(raw)) {
            from = to = parseInt(raw, 10);
        } else if (/^(\d+)-(\d+)$/.test(raw)) {
            const parts = raw.split('-');
            from = parseInt(parts[0], 10);
            to = parseInt(parts[1], 10);
        } else {
            await interaction.reply({
                content: isPol
                    ? '❌ Nieprawidłowy format. Wpisz liczbę (np. `4`) lub zakres (np. `1-3`).'
                    : '❌ Invalid format. Enter a number (e.g. `4`) or a range (e.g. `1-3`).',
                flags: ['Ephemeral']
            });
            return;
        }

        if (from < 1 || to < from) {
            await interaction.reply({
                content: isPol
                    ? '❌ Nieprawidłowy zakres. Liczba początkowa musi być ≥ 1, a końcowa ≥ początkowej.'
                    : '❌ Invalid range. Start must be ≥ 1 and end must be ≥ start.',
                flags: ['Ephemeral']
            });
            return;
        }

        const tierRanges = state.topRolesTemp?.tierRanges || [];

        if (tierIdx === 0) {
            if (from !== 1) {
                await interaction.reply({
                    content: isPol
                        ? '❌ Pierwszy próg musi zaczynać się od pozycji **1**.'
                        : '❌ The first tier must start at position **1**.',
                    flags: ['Ephemeral']
                });
                return;
            }
        } else {
            const prev = tierRanges[tierIdx - 1];
            if (prev && from !== prev.to + 1) {
                await interaction.reply({
                    content: isPol
                        ? `❌ Ten próg musi zaczynać się od pozycji **${prev.to + 1}** (poprzedni próg kończy się na ${prev.to}).`
                        : `❌ This tier must start at position **${prev.to + 1}** (previous tier ends at ${prev.to}).`,
                    flags: ['Ephemeral']
                });
                return;
            }
        }

        if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
        state.topRolesTemp.tierRanges[tierIdx] = { from, to };
        // Unieważnij późniejsze progi (mogły mieć zły zakres)
        state.topRolesTemp.tierRanges = state.topRolesTemp.tierRanges.slice(0, tierIdx + 1);
        if (state.topRolesTemp.tierAssigning) {
            for (const k of Object.keys(state.topRolesTemp.tierAssigning).map(Number)) {
                if (k > tierIdx) delete state.topRolesTemp.tierAssigning[k];
            }
        }
        this._configWizard.set(key, state);

        await this._showTierConfigScreen(interaction, state, key);
    }

    async _handleTopRoleSelect(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired.', flags: ['Ephemeral'] }); return; }

        const tierIdx = parseInt(interaction.customId.replace('cfg_roles_sel_', ''), 10);
        if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
        if (!state.topRolesTemp.tierAssigning) state.topRolesTemp.tierAssigning = {};
        state.topRolesTemp.tierAssigning[tierIdx] = interaction.values[0];
        this._configWizard.set(key, state);
        await this._showRoleAssignScreen(interaction, state, key);
    }

    async _handleConfigureCvThresholdModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired.', flags: ['Ephemeral'] }); return; }

        const isPol = state.lang === 'pol';
        const raw = interaction.fields.getTextInputValue('cfg_cv_threshold_input').trim();
        const val = parseInt(raw, 10);
        if (!val || val < 1 || val > 25) {
            await interaction.reply({
                content: isPol
                    ? '❌ Próg musi być liczbą od 1 do 25.'
                    : '❌ Threshold must be a number between 1 and 25.',
                flags: ['Ephemeral']
            });
            return;
        }
        state.communityVerifThreshold = val;
        this._configWizard.set(key, state);
        await this._showConfigureStep(interaction, 8);
    }

    async _handleConfigureButton(interaction, customId) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);

        if (!state) {
            await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] });
            return;
        }

        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        // Przejście do kroku N
        if (customId.startsWith('cfg_step_')) {
            const step = parseInt(customId.replace('cfg_step_', ''), 10);
            await this._showConfigureStep(interaction, step);
            return;
        }

        // Powrót do dashboardu
        if (customId === 'cfg_back') {
            // Jeśli funkcja weryfikacji jest włączona, oznacz krok 8 jako zakończony
            if (state.communityVerifEnabled === true) state.communityVerifDone = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Otwórz modal tagu
        if (customId === 'cfg_tag_open') {
            const existingTag = state.tag || '';
            const modal = new ModalBuilder()
                .setCustomId('cfg_tag_modal')
                .setTitle(t('🏷️ Tag serwera', '🏷️ Server Tag'))
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('cfg_tag_input')
                            .setLabel(t('Tag (1–4 znaki lub emoji)', 'Tag (1–4 chars or emoji)'))
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('np. PS  🇵🇱  ☆  EU')
                            .setMaxLength(8)
                            .setValue(existingTag)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        // Wybór języka
        if (customId === 'cfg_lang_pol') {
            state.lang = 'pol';
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }
        if (customId === 'cfg_lang_eng') {
            state.lang = 'eng';
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Wejście do konfiguracji progów ról TOP
        if (customId === 'cfg_roles_start') {
            if (!state.topRolesTemp) state.topRolesTemp = {};
            if (!state.topRolesTemp.tierRanges) {
                const existing = state.topRoles;
                if (existing?.tiers) {
                    // Nowy format — wczytaj zakresy i pre-fill roleIds
                    state.topRolesTemp.tierRanges = existing.tiers.map(t => ({ from: t.from, to: t.to }));
                    state.topRolesTemp.tierAssigning = Object.fromEntries(
                        existing.tiers.map((t, i) => [i, t.roleId || null])
                    );
                } else if (existing) {
                    // Stary format — migruj zakresy + pre-fill roleIds
                    const nm = [];
                    if (existing.top1)      nm.push({ from: 1,  to: 1,  roleId: existing.top1 });
                    if (existing.top2)      nm.push({ from: 2,  to: 2,  roleId: existing.top2 });
                    if (existing.top3)      nm.push({ from: 3,  to: 3,  roleId: existing.top3 });
                    if (existing.top4to10)  nm.push({ from: 4,  to: 10, roleId: existing.top4to10 });
                    if (existing.top11to30) nm.push({ from: 11, to: 30, roleId: existing.top11to30 });
                    state.topRolesTemp.tierRanges = nm.map(r => ({ from: r.from, to: r.to }));
                    state.topRolesTemp.tierAssigning = Object.fromEntries(nm.map((r, i) => [i, r.roleId]));
                } else {
                    state.topRolesTemp.tierRanges = [];
                }
            }
            this._configWizard.set(key, state);
            await this._showTierConfigScreen(interaction, state, key);
            return;
        }

        // Otwórz modal zakresu dla progu N (przyciski cfg_tier_0 … cfg_tier_9)
        if (/^cfg_tier_\d+$/.test(customId)) {
            const tierIdx = parseInt(customId.replace('cfg_tier_', ''), 10);
            if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
            const tierRanges = state.topRolesTemp.tierRanges || [];
            const existingRange = tierRanges[tierIdx];
            const defaultVal = existingRange
                ? (existingRange.from === existingRange.to ? `${existingRange.from}` : `${existingRange.from}-${existingRange.to}`)
                : (tierIdx > 0 && tierRanges[tierIdx - 1] ? `${tierRanges[tierIdx - 1].to + 1}` : '');
            const modal = new ModalBuilder()
                .setCustomId(`cfg_tier_modal_${tierIdx}`)
                .setTitle(isPol ? `Próg ${tierIdx + 1} — zakres pozycji` : `Tier ${tierIdx + 1} — position range`)
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tier_range')
                        .setLabel(t('Zakres (puste = usuń próg)', 'Range (empty = remove tier)'))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setPlaceholder(t('np. 1-3 lub 4 (puste aby usunąć)', 'e.g. 1-3 or 4 (empty to remove)'))
                        .setMaxLength(10)
                        .setValue(defaultVal)
                ));
            await interaction.showModal(modal);
            return;
        }

        // Otwórz select ról dla konkretnego progu
        if (customId.startsWith('cfg_role_btn_')) {
            const tierIdx = parseInt(customId.replace('cfg_role_btn_', ''), 10);
            if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
            if (!state.topRolesTemp.tierAssigning) state.topRolesTemp.tierAssigning = {};
            this._configWizard.set(key, state);
            await this._showTierRoleAssign(interaction, state, key, tierIdx);
            return;
        }

        // Wyczyść wszystkie progi — ekran potwierdzenia
        if (customId === 'cfg_tier_reset') {
            const confirmEmbed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle(t('⚠️ Usuń konfigurację progów?', '⚠️ Clear tier configuration?'))
                .setDescription(t(
                    'Czy na pewno chcesz usunąć **wszystkie skonfigurowane progi i przypisane role**?\n\nTej operacji nie da się cofnąć.',
                    'Are you sure you want to remove **all configured tiers and role assignments**?\n\nThis operation cannot be undone.'
                ));
            const confirmBtn = new ButtonBuilder()
                .setCustomId('cfg_tier_reset_ok')
                .setLabel(t('Tak, usuń wszystkie progi', 'Yes, clear all tiers'))
                .setStyle(ButtonStyle.Danger);
            const cancelBtn = new ButtonBuilder()
                .setCustomId('cfg_tier_reset_cancel')
                .setLabel(t('Anuluj', 'Cancel'))
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({
                embeds: [confirmEmbed],
                components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)]
            });
            return;
        }

        // Potwierdzone usunięcie progów → wróć do kroku 5
        if (customId === 'cfg_tier_reset_ok') {
            if (!state.topRolesTemp) state.topRolesTemp = {};
            state.topRolesTemp.tierRanges = [];
            delete state.topRolesTemp.tierAssigning;
            this._configWizard.set(key, state);
            await this._showStep5Screen(interaction, state);
            return;
        }

        // Anuluj usunięcie progów — wróć do kroku 5
        if (customId === 'cfg_tier_reset_cancel') {
            await this._showStep5Screen(interaction, state);
            return;
        }

        // Wyczyść rolę dla progu N → wróć do ekranu przypisywania ról
        if (customId.startsWith('cfg_roles_skip_')) {
            const tierIdx = parseInt(customId.replace('cfg_roles_skip_', ''), 10);
            if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
            if (!state.topRolesTemp.tierAssigning) state.topRolesTemp.tierAssigning = {};
            state.topRolesTemp.tierAssigning[tierIdx] = null;
            this._configWizard.set(key, state);
            await this._showRoleAssignScreen(interaction, state, key);
            return;
        }

        // Wróć z wyboru roli → ekran przypisywania ról
        if (customId.startsWith('cfg_roles_back_')) {
            if (!state.topRolesTemp) state.topRolesTemp = { tierRanges: [] };
            this._configWizard.set(key, state);
            await this._showRoleAssignScreen(interaction, state, key);
            return;
        }

        // Powrót z ekranu progów → krok 5 landing
        if (customId === 'cfg_tier_back') {
            await this._showStep5Screen(interaction, state);
            return;
        }

        // Wejście do ekranu przypisywania ról (z ekranu progów)
        if (customId === 'cfg_roles_configure') {
            this._configWizard.set(key, state);
            await this._showRoleAssignScreen(interaction, state, key);
            return;
        }

        // Wstecz z ekranu przypisywania ról → sprawdź czy wszystkie role ustawione
        if (customId === 'cfg_roles_assign_back') {
            const tierRanges = state.topRolesTemp?.tierRanges || [];
            const assigning = state.topRolesTemp?.tierAssigning || {};
            const allAssigned = tierRanges.length > 0 && tierRanges.every((_, i) => !!assigning[i]);
            if (allAssigned) {
                await this._showTierConfigScreen(interaction, state, key);
            } else {
                await this._showRoleAssignBackConfirm(interaction, state);
            }
            return;
        }

        // Potwierdzone wyjście bez wszystkich ról → wróć do ekranu progów
        if (customId === 'cfg_roles_back_confirm') {
            await this._showTierConfigScreen(interaction, state, key);
            return;
        }

        // Zostań na ekranie przypisywania ról
        if (customId === 'cfg_roles_stay') {
            await this._showRoleAssignScreen(interaction, state, key);
            return;
        }

        // Włącz role TOP
        if (customId === 'cfg_roles_enable') {
            state.rolesSkipped = false;
            this._configWizard.set(key, state);
            await this._showStep5Screen(interaction, state);
            return;
        }

        // Wyłącz/pomiń role TOP
        if (customId === 'cfg_roles_skip') {
            state.rolesSkipped = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Powiadomienia Global TOP3
        if (customId === 'cfg_notif_yes') {
            state.globalTop3Notifications = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }
        if (customId === 'cfg_notif_no') {
            state.globalTop3Notifications = false;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Krok 7 — pokaż RoleSelectMenu do dodania rankingu roli
        if (customId === 'cfg_role_ranking_add') {
            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId('cfg_role_ranking_add_select')
                .setPlaceholder(t('Wybierz rolę...', 'Select a role...'));
            const backToStep7 = new ButtonBuilder()
                .setCustomId('cfg_step_7')
                .setLabel(t('← Powrót', '← Back'))
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x5865F2)
                    .setTitle(t('➕ Dodaj ranking roli', '➕ Add Role Ranking'))
                    .setDescription(t('Wybierz rolę Discord, dla której chcesz utworzyć osobny ranking.', 'Select the Discord role for which you want to create a separate ranking.'))],
                components: [new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(backToStep7)]
            });
            return;
        }

        // Krok 7 — pokaż StringSelectMenu do usunięcia rankingu roli
        if (customId === 'cfg_role_ranking_remove') {
            const existing = await this.roleRankingConfigService.loadRoleRankings(interaction.guildId);
            if (existing.length === 0) {
                await this._showConfigureStep(interaction, 7);
                return;
            }
            const options = existing.map(r => ({ label: r.roleName.substring(0, 100), value: r.roleId }));
            const select = new StringSelectMenuBuilder()
                .setCustomId('cfg_role_ranking_remove_select')
                .setPlaceholder(t('Wybierz ranking roli do usunięcia...', 'Select role ranking to remove...'))
                .addOptions(options);
            const backToStep7 = new ButtonBuilder()
                .setCustomId('cfg_step_7')
                .setLabel(t('← Powrót', '← Back'))
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x5865F2)
                    .setTitle(t('🗑️ Usuń ranking roli', '🗑️ Remove Role Ranking'))
                    .setDescription(t('Wybierz ranking roli do usunięcia.', 'Select the role ranking to remove.'))],
                components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backToStep7)]
            });
            return;
        }

        // Krok 7 — pomiń / gotowe
        if (customId === 'cfg_role_ranking_skip') {
            state.roleRankingsDone = true;
            const currentRankings = await this.roleRankingConfigService.loadRoleRankings(interaction.guildId);
            state.roleRankingsCount = currentRankings.length;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Krok 8 — weryfikacja społeczności
        if (customId === 'cfg_cv_enable') {
            if (!state.communityVerifThreshold) state.communityVerifThreshold = 5;
            state.communityVerifEnabled = true;
            state.communityVerifDone = true;
            this._configWizard.set(key, state);
            // Pokaż wybór kanału raportów CV — opcjonalne, krok jest już oznaczony jako zakończony
            const cvEmbed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('📢 Krok 8 — Kanał zgłoszeń społeczności (opcjonalne)', '📢 Step 8 — Community Report Channel (optional)'))
                .setDescription(t(
                    'Możesz wskazać dedykowany kanał, na który będą wysyłane raporty społeczności.\nJeśli pominiesz ten krok, raporty trafią wyłącznie na globalny kanał head admina.\n\nAdmin zobaczy link do zgłoszonej wiadomości i będzie mógł zatwierdzić lub usunąć rekord.',
                    'You can specify a dedicated channel where community reports will be sent.\nIf you skip this, reports will only go to the global head admin channel.\n\nAn admin will see a link to the flagged message and be able to approve or remove the record.'
                ) + (state.communityVerifChannelId ? '\n\n**' + t('Aktualny kanał:', 'Current channel:') + '** <#' + state.communityVerifChannelId + '>' : ''));
            const cvChannelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('cfg_cv_channel_select')
                .setPlaceholder(t('Wybierz kanał zgłoszeń...', 'Choose a report channel...'))
                .setChannelTypes(ChannelType.GuildText);
            const cvBackBtn = new ButtonBuilder()
                .setCustomId('cfg_back')
                .setLabel(t('← Wstecz', '← Back'))
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [cvEmbed], components: [new ActionRowBuilder().addComponents(cvChannelSelect), new ActionRowBuilder().addComponents(cvBackBtn)] });
            return;
        }
        if (customId === 'cfg_cv_disable') {
            state.communityVerifEnabled = false;
            state.communityVerifDone = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }
        if (customId === 'cfg_cv_threshold') {
            const modal = new ModalBuilder()
                .setCustomId('cfg_cv_threshold_modal')
                .setTitle(t('🔢 Próg zgłoszeń', '🔢 Report Threshold'))
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('cfg_cv_threshold_input')
                        .setLabel(t('Ile zgłoszeń wyzwala raport? (1–25)', 'How many reports trigger a report? (1–25)'))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('5')
                        .setValue(String(state.communityVerifThreshold || 5))
                ));
            await interaction.showModal(modal);
            return;
        }

        // Anuluj konfigurację
        if (customId === 'cfg_cancel') {
            this._configWizard.delete(key);
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle(t('❌ Konfiguracja anulowana', '❌ Configuration cancelled'))
                        .setDescription(t(
                            'Konfiguracja została anulowana. Poprzednie ustawienia pozostają bez zmian.\nAby rozpocząć ponownie, użyj komendy `/configure`.',
                            'Configuration has been cancelled. Previous settings remain unchanged.\nTo start again, run `/configure`.'
                        ))
                ],
                components: []
            });
            return;
        }

        // Zapisz konfigurację
        if (customId === 'cfg_accept') {
            const msgs = this.msgs(interaction.guildId);
            const existingConfig = this.guildConfigService.getConfig(interaction.guildId);
            const wasAlreadyConfigured = existingConfig?.configured === true;

            const newData = {
                configured: true,
                allowedChannelId: state.allowedChannelId,
                invalidReportChannelId: state.invalidReportChannelId || null,
                lang: state.lang,
                tag: state.tag || null,
                topRoles: (() => {
                    const tierRanges = state.topRolesTemp?.tierRanges;
                    if (tierRanges !== undefined) {
                        // Użytkownik wszedł do konfiguracji progów — topRolesTemp jest źródłem prawdy
                        if (tierRanges.length > 0) {
                            const assigningNow = state.topRolesTemp.tierAssigning || {};
                            const tiers = tierRanges.map((r, i) => ({ from: r.from, to: r.to, roleId: assigningNow[i] || null }));
                            const hasRoles = tiers.some(t => t.roleId);
                            if (state.rolesSkipped) return hasRoles ? { tiers, disabled: true } : null;
                            return hasRoles ? { tiers } : null;
                        }
                        return null; // Użytkownik wyczyścił wszystkie progi
                    }
                    // Użytkownik nie wszedł do konfiguracji progów — zachowaj istniejący config
                    if (state.rolesSkipped) {
                        if (state.topRoles?.tiers?.length > 0 && !state.topRoles.disabled) return { ...state.topRoles, disabled: true };
                        return state.topRoles || null;
                    }
                    if (state.topRoles?.disabled) {
                        const { disabled, ...enabledConfig } = state.topRoles;
                        return Object.keys(enabledConfig).length ? enabledConfig : null;
                    }
                    return state.topRoles || null;
                })(),
                globalTopNotifications: state.globalTop3Notifications !== false,
                communityVerification: state.communityVerifEnabled ? {
                    enabled: true,
                    rejectedChannelId: state.communityVerifChannelId || null,
                    threshold: state.communityVerifThreshold || 5,
                } : { enabled: false, rejectedChannelId: null, threshold: 5 },
                configuredBy: {
                    userId: interaction.user.id,
                    username: interaction.user.username,
                    configuredAt: new Date().toISOString(),
                },
            };
            // Nowy serwer domyślnie ma zablokowane OCR komendy
            if (!wasAlreadyConfigured) {
                newData.ocrBlocked = ['update', 'test'];
            }

            await this.guildConfigService.saveConfig(interaction.guildId, newData);
            this._configWizard.delete(key);

            // Re-register commands with new language
            try {
                await this.registerCommandsForGuild(interaction.client, interaction.guildId);
            } catch (regErr) {
                logger.warn(`⚠️ Nie można ponownie zarejestrować komend po konfiguracji: ${regErr.message}`);
            }

            const savedOcrBlocked = this.guildConfigService.getConfig(interaction.guildId)?.ocrBlocked || [];
            const updateBlocked = savedOcrBlocked.includes('update');
            const testBlocked = savedOcrBlocked.includes('test');
            const thasharLink = '[Thashar](https://discord.com/users/398983446812295168)';

            const contactLine = t(
                `\n💡 W razie pytań skontaktuj się z ${thasharLink}.`,
                `\n💡 For questions, contact ${thasharLink}.`
            );

            let ocrLine;
            if (updateBlocked && testBlocked) {
                ocrLine = t(
                    `⚠️ Komendy \`/update\` i \`/test\` są **wyłączone**. Aby je włączyć, skontaktuj się z ${thasharLink}.`,
                    `⚠️ Commands \`/update\` and \`/test\` are **disabled**. To enable them, contact ${thasharLink}.`
                );
            } else if (!updateBlocked && !testBlocked) {
                ocrLine = t(
                    `✅ Komendy \`/update\` i \`/test\` są **włączone** i gotowe do użycia.`,
                    `✅ Commands \`/update\` and \`/test\` are **enabled** and ready to use.`
                ) + contactLine;
            } else if (!updateBlocked && testBlocked) {
                ocrLine = t(
                    `✅ Komenda \`/update\` jest **włączona**. Komenda \`/test\` jest wyłączona.`,
                    `✅ Command \`/update\` is **enabled**. Command \`/test\` is disabled.`
                ) + contactLine;
            } else {
                ocrLine = t(
                    `✅ Komenda \`/test\` jest **włączona**. Komenda \`/update\` jest wyłączona.`,
                    `✅ Command \`/test\` is **enabled**. Command \`/update\` is disabled.`
                ) + contactLine;
            }

            const savedDesc = t(
                `✅ Konfiguracja została zapisana! Bot jest teraz aktywny na tym serwerze.\n\n${ocrLine}`,
                `✅ Configuration saved! The bot is now active on this server.\n\n${ocrLine}`
            );

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle(t('✅ Konfiguracja zapisana!', '✅ Configuration saved!'))
                        .setDescription(savedDesc)
                ],
                components: []
            });

            // Powiadomienie o skonfigurowanym serwerze — webhook logów lub fallback na kanał raportów
            try {
                const isEng = (newData.lang || 'pol') === 'eng';
                const tCfg = (p, e) => isEng ? e : p;

                const formatTopRoles = (topRoles) => {
                    if (!topRoles) return tCfg('❌ Brak', '❌ None');
                    let tiers = topRoles.tiers;
                    if (!tiers) {
                        tiers = [];
                        if (topRoles.top1)      tiers.push({ from: 1,  to: 1,  roleId: topRoles.top1 });
                        if (topRoles.top2)      tiers.push({ from: 2,  to: 2,  roleId: topRoles.top2 });
                        if (topRoles.top3)      tiers.push({ from: 3,  to: 3,  roleId: topRoles.top3 });
                        if (topRoles.top4to10)  tiers.push({ from: 4,  to: 10, roleId: topRoles.top4to10 });
                        if (topRoles.top11to30) tiers.push({ from: 11, to: 30, roleId: topRoles.top11to30 });
                    }
                    if (tiers.length === 0) return tCfg('❌ Brak progów', '❌ No tiers');
                    return tiers.map(t => {
                        const range = t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`;
                        return `${tCfg('Próg', 'Tier')} ${range}: <@&${t.roleId}>`;
                    }).join('\n');
                };

                let configEmbed;
                if (!wasAlreadyConfigured) {
                    // Pierwsza konfiguracja — pełny embed ze wszystkimi ustawieniami
                    configEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle(tCfg('⚙️ Nowy serwer skonfigurowany', '⚙️ New server configured'))
                        .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                        .addFields(
                            { name: tCfg('Serwer', 'Server'), value: interaction.guild.name },
                            { name: tCfg('Administrator', 'Administrator'), value: interaction.member?.displayName || interaction.user.username },
                            { name: tCfg('Kanał bota', 'Bot channel'), value: `<#${newData.allowedChannelId}>` },
                            { name: tCfg('Język', 'Language'), value: newData.lang || 'pol' },
                            { name: 'Tag', value: newData.tag || '—' },
                            { name: 'Role TOP', value: formatTopRoles(newData.topRoles) },
                            { name: tCfg('Raporty Global TOP10', 'Global TOP10 Reports'), value: newData.globalTop3Notifications !== false ? tCfg('✅ Włączone', '✅ Enabled') : tCfg('❌ Wyłączone', '❌ Disabled') },
                            { name: tCfg('Kanał raportów', 'Reports channel'), value: newData.invalidReportChannelId ? `<#${newData.invalidReportChannelId}>` : '—' },
                            { name: tCfg('Weryfikacja społeczności', 'Community verification'), value: newData.communityVerification?.enabled ? `${tCfg('✅ Włączona', '✅ Enabled')} (${tCfg('próg', 'threshold')}: ${newData.communityVerification.threshold})` : tCfg('❌ Wyłączona', '❌ Disabled') }
                        )
                        .setTimestamp();
                } else {
                    // Rekonfiguracja — tylko zmienione pola
                    const old = existingConfig;
                    const diffFields = [];

                    if (old?.allowedChannelId !== newData.allowedChannelId) {
                        const oldVal = old?.allowedChannelId ? `<#${old.allowedChannelId}>` : '—';
                        diffFields.push({ name: tCfg('Kanał bota', 'Bot channel'), value: `${oldVal} → <#${newData.allowedChannelId}>` });
                    }
                    if ((old?.invalidReportChannelId || null) !== newData.invalidReportChannelId) {
                        const oldVal = old?.invalidReportChannelId ? `<#${old.invalidReportChannelId}>` : '—';
                        const newVal = newData.invalidReportChannelId ? `<#${newData.invalidReportChannelId}>` : '—';
                        diffFields.push({ name: tCfg('Kanał raportów', 'Reports channel'), value: `${oldVal} → ${newVal}` });
                    }
                    if ((old?.lang || 'pol') !== newData.lang) {
                        diffFields.push({ name: tCfg('Język', 'Language'), value: `${old?.lang || 'pol'} → ${newData.lang}` });
                    }
                    if ((old?.tag || null) !== newData.tag) {
                        diffFields.push({ name: 'Tag', value: `${old?.tag || '—'} → ${newData.tag || '—'}` });
                    }
                    const oldRolesJson = JSON.stringify(old?.topRoles || null);
                    const newRolesJson = JSON.stringify(newData.topRoles || null);
                    if (oldRolesJson !== newRolesJson) {
                        const oldDetail = formatTopRoles(old?.topRoles || null);
                        const newDetail = formatTopRoles(newData.topRoles || null);
                        diffFields.push({ name: tCfg('Role TOP (poprzednie)', 'TOP Roles (previous)'), value: oldDetail });
                        diffFields.push({ name: tCfg('Role TOP (nowe)', 'TOP Roles (new)'), value: newDetail });
                    }
                    if ((old?.globalTop3Notifications !== false) !== (newData.globalTop3Notifications !== false)) {
                        const oldVal = old?.globalTop3Notifications !== false ? tCfg('✅ Włączone', '✅ Enabled') : tCfg('❌ Wyłączone', '❌ Disabled');
                        const newVal = newData.globalTop3Notifications !== false ? tCfg('✅ Włączone', '✅ Enabled') : tCfg('❌ Wyłączone', '❌ Disabled');
                        diffFields.push({ name: tCfg('Raporty Global TOP10', 'Global TOP10 Reports'), value: `${oldVal} → ${newVal}` });
                    }
                    const oldCvEnabled = old?.communityVerification?.enabled || false;
                    const newCvEnabled = newData.communityVerification?.enabled || false;
                    if (oldCvEnabled !== newCvEnabled) {
                        diffFields.push({ name: tCfg('Weryfikacja społeczności', 'Community verification'), value: `${oldCvEnabled ? tCfg('✅ Włączona', '✅ Enabled') : tCfg('❌ Wyłączona', '❌ Disabled')} → ${newCvEnabled ? tCfg('✅ Włączona', '✅ Enabled') : tCfg('❌ Wyłączona', '❌ Disabled')}` });
                    }
                    if (newCvEnabled) {
                        const oldCvChannel = old?.communityVerification?.rejectedChannelId || null;
                        const newCvChannel = newData.communityVerification?.rejectedChannelId || null;
                        if (oldCvChannel !== newCvChannel) {
                            const oldVal = oldCvChannel ? `<#${oldCvChannel}>` : '—';
                            const newVal = newCvChannel ? `<#${newCvChannel}>` : '—';
                            diffFields.push({ name: tCfg('Kanał weryfikacji', 'Verification channel'), value: `${oldVal} → ${newVal}` });
                        }
                        const oldThreshold = old?.communityVerification?.threshold || 5;
                        const newThreshold = newData.communityVerification?.threshold || 5;
                        if (oldThreshold !== newThreshold) {
                            diffFields.push({ name: tCfg('Próg zgłoszeń', 'Report threshold'), value: `${oldThreshold} → ${newThreshold}` });
                        }
                    }

                    if (diffFields.length === 0) return; // nic się nie zmieniło
                    configEmbed = new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle(tCfg('⚙️ Zmiana konfiguracji serwera', '⚙️ Server configuration changed'))
                        .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                        .addFields(
                            { name: tCfg('Serwer', 'Server'), value: interaction.guild.name, inline: true },
                            { name: tCfg('Administrator', 'Administrator'), value: interaction.member?.displayName || interaction.user.username, inline: true },
                            ...diffFields
                        )
                        .setTimestamp();
                }

                const sentViaWebhook = this.logService.sendEmbed(configEmbed);
                if (!sentViaWebhook) {
                    const reportChannelId = this.config.invalidReportChannelId;
                    if (reportChannelId) {
                        const reportChannel = await interaction.client.channels.fetch(reportChannelId);
                        if (reportChannel) await reportChannel.send({ embeds: [configEmbed] });
                    }
                }
            } catch (err) {
                logger.error(`Błąd wysyłania powiadomienia cfg_accept (serwer "${interaction.guild?.name || interaction.guildId}"):`, err.message);
            }
            return;
        }
    }

    // =====================================================================
    // Panel Admina — dostępny przez /manage
    // =====================================================================

    _isHeadAdmin(userId) {
        return this.config.blockOcrUserIds.includes(userId);
    }

    _panelT(guildId) {
        const isPol = (this.config.getGuildConfig(guildId)?.lang || 'pol') !== 'eng';
        return (pol, eng) => isPol ? pol : eng;
    }

    _buildAdminPanel(interaction) {
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(interaction.guildId);
        const adminOptions = [
            t('🗑️ **Usuń gracza z rankingu** — wyszukaj gracza i usuń go z rankingu serwera; automatycznie aktualizuje role TOP.',
              '🗑️ **Remove Player from Ranking** — search for a player and remove them from the server ranking; automatically updates TOP roles.'),
            t('🔓 **Odblokuj gracza** — odblokowuje gracza zablokowanego przez admina; nie można odblokować graczy zablokowanych przez Head Admina.',
              '🔓 **Unblock Player** — unblocks a player blocked by an admin; cannot unblock players blocked by the Head Admin.'),
            t('📊 **Zużycie tokenów** — statystyki zużycia AI OCR dla Twojego serwera (zapytania, tokeny).',
              '📊 **Token Usage** — AI OCR usage statistics for your server (requests, tokens).'),
        ];
        const headAdminOptions = [
            t('🔒 **Zablokuj gracza** — wyszukaj gracza cross-server i zablokuj mu dostęp do `/update`; tylko Head Admin może odblokować.',
              '🔒 **Block Player** — search for a player cross-server and block their access to `/update`; only the Head Admin can unblock.'),
            t('🔄 **AI OCR on/off** — włącz lub wyłącz OCR (`/update`, `/test`) per serwer.',
              '🔄 **AI OCR on/off** — enable or disable OCR (`/update`, `/test`) per server.'),
            t('⚙️ **Ustaw limity** — skonfiguruj cooldown po `/update` i dzienny limit użyć.',
              '⚙️ **Set Limits** — configure cooldown after `/update` and daily usage limit.'),
            t('📢 **Wyślij Info** — skomponuj wiadomość i wyślij ją na kanały wszystkich skonfigurowanych serwerów.',
              '📢 **Send Info** — compose a message and send it to all configured servers\' channels.'),
            t('🧪 **Testerzy** — zarządzaj listą testerów uprawnionych do `/test`.',
              '🧪 **Testers** — manage the list of testers authorized to use `/test`.'),
            t('🏆 **Usuń osiągnięcia** — usuń wybrane osiągnięcie lub wszystkie osiągnięcia i progress wybranego gracza na wybranym serwerze.',
              '🏆 **Remove Achievements** — remove a selected achievement or all achievements and progress of a selected player on a selected server.'),
            t('🚫 **Zbanuj serwer** — wyrzuć bota z wybranego serwera i zablokuj możliwość ponownego dodania go do tego serwera.',
              '🚫 **Ban Server** — remove the bot from a selected server and prevent it from being re-added to that server.'),
            t('📅 **Interwał TOP10** — ustaw datę i godzinę pierwszego raportu TOP10 globalnego (potem co ~3 dni automatycznie).',
              '📅 **TOP10 Interval** — set the date and time of the first global TOP10 report (then automatically every ~3 days).'),
            t('⚠️ **Nieskonfigurowane** — lista serwerów, na których bot jest obecny, ale nie został jeszcze skonfigurowany przez /configure.',
              '⚠️ **Unconfigured** — list of servers where the bot is present but has not yet been configured via /configure.'),
        ];

        const optionLines = isHeadAdmin
            ? [...adminOptions, ...headAdminOptions]
            : adminOptions;

        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('⚙️ Panel Administracyjny', '⚙️ Admin Panel'))
            .setDescription(
                `**${t('Tryb', 'Mode')}: ${isHeadAdmin ? 'Head Admin' : 'Admin'}**\n\n` +
                optionLines.join('\n\n')
            );

        let row1, row2;
        if (isHeadAdmin) {
            // Rząd 1 Head Admin (4 przyciski): Zablokuj, Odblokuj, Usuń gracza, Usuń osiągnięcia
            row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_block').setEmoji('🔒').setLabel(t('Zablokuj gracza', 'Block Player')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔓').setLabel(t('Odblokuj gracza', 'Unblock Player')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('panel_remove').setEmoji('🗑️').setLabel(t('Usuń gracza z rankingu', 'Remove Player from Ranking')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🏆').setLabel(t('Usuń osiągnięcia', 'Remove Achievements')).setStyle(ButtonStyle.Danger),
            );
            // Rząd 2 Head Admin: AI OCR, Ustaw limity, Testerzy, Interwał TOP10
            row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ocr').setEmoji('🔄').setLabel(t('AI OCR', 'AI OCR')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_limit').setEmoji('⚙️').setLabel(t('Ustaw limity', 'Set Limits')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_tester').setEmoji('🧪').setLabel(t('Testerzy', 'Testers')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_top10_interval').setEmoji('📅').setLabel(t('Interwał TOP10', 'TOP10 Interval')).setStyle(ButtonStyle.Primary),
            );
        } else {
            // Rząd 1 Admin: Usuń gracza, Odblokuj
            row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_remove').setEmoji('🗑️').setLabel(t('Usuń gracza z rankingu', 'Remove Player from Ranking')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔓').setLabel(t('Odblokuj gracza', 'Unblock Player')).setStyle(ButtonStyle.Secondary),
            );
            // Rząd 2 Admin: Zużycie tokenów
            row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_tokens').setEmoji('📊').setLabel(t('Zużycie tokenów', 'Token Usage')).setStyle(ButtonStyle.Secondary),
            );
        }

        const components = [row1, row2];
        if (isHeadAdmin) {
            // Rząd 3 Head Admin: Wyślij Info, Zużycie tokenów, Nieskonfigurowane
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_info').setEmoji('📢').setLabel(t('Wyślij Info', 'Send Info')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_tokens').setEmoji('📊').setLabel(t('Zużycie tokenów', 'Token Usage')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('panel_unconfigured').setEmoji('⚠️').setLabel(t('Nieskonfigurowane', 'Unconfigured')).setStyle(ButtonStyle.Secondary),
            ));
            // Rząd 4 Head Admin: Zbanuj serwer
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('🚫').setLabel(t('Zbanuj serwer', 'Ban Server')).setStyle(ButtonStyle.Danger),
            ));
        }

        return { embed, components };
    }

    async _handleAdminPanelOpen(interaction) {
        const { embed, components } = this._buildAdminPanel(interaction);
        await interaction.update({ embeds: [embed], components });
    }

    async _handlePanelRemove(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_remove_search_modal')
            .setTitle(t('Usuń gracza z rankingu', 'Remove Player from Ranking'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('remove_query')
                .setLabel(t('Fragment nicku gracza', 'Part of the player\'s nick'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Kowalski', 'e.g. Kowalski'))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelRemoveSearch(interaction) {
        const guildId = interaction.guildId;
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(guildId);
        const query = interaction.fields.getTextInputValue('remove_query').trim().toLowerCase();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            // Head Admin przeszukuje wszystkie serwery; Admin tylko swój
            const searchGuildIds = isHeadAdmin
                ? (this.guildConfigService?.getAllConfiguredGuildIds() || [guildId])
                : [guildId];
            const allMatches = [];
            for (const sgid of searchGuildIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if ((p.username || p.userId).toLowerCase().includes(query)) {
                        allMatches.push({ ...p, rank: i + 1, sgid, guildName });
                    }
                }
            }
            if (allMatches.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF4444)
                        .setTitle(t('🗑️ Nie znaleziono gracza', '🗑️ Player Not Found'))
                        .setDescription(t(`Brak gracza z nickiem zawierającym "**${query}**".`, `No player with nick containing "**${query}**".`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_remove').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const options = allMatches.slice(0, 25).map(p => ({
                label: `#${p.rank} ${(p.username || p.userId).slice(0, 60)}`.slice(0, 100),
                description: isHeadAdmin
                    ? `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100)
                    : `${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.userId}:${p.sgid}`,
            }));
            const subtitle = allMatches.length > 25
                ? t(`Znaleziono ${allMatches.length} — pokazuję 25. Zawęź wyszukiwanie.`, `Found ${allMatches.length} — showing 25. Narrow your search.`)
                : t(`Znaleziono ${allMatches.length} gracz(y).`, `Found ${allMatches.length} player(s).`);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🗑️ Wybierz gracza', '🗑️ Select Player'))
                    .setDescription(subtitle)],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('panel_remove_select')
                            .setPlaceholder(t('Wybierz gracza do usunięcia...', 'Select a player to remove...'))
                            .addOptions(options)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_remove').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveSearch (serwer "${interaction.guild?.name || guildId}"):`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania rankingu.', '❌ Error loading ranking.'), embeds: [], components: [] });
        }
    }

    async _handlePanelRemoveSelect(interaction) {
        const value = interaction.values[0]; // format: userId:guildId
        const [targetUserId, targetGuildId] = value.split(':');
        const t = this._panelT(interaction.guildId);
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => p.userId === targetUserId);
        const displayName = player?.username || targetUserId;
        const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
        const serverNote = targetGuildName ? ` (${targetGuildName})` : '';
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF4444)
                .setTitle(t('🗑️ Potwierdzenie usunięcia', '🗑️ Confirm Removal'))
                .setDescription(t(
                    `Czy na pewno chcesz usunąć **${displayName}**${serverNote} z rankingu?\n\nTej operacji nie można cofnąć.`,
                    `Are you sure you want to remove **${displayName}**${serverNote} from the ranking?\n\nThis action cannot be undone.`
                ))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`panel_remove_confirm_${targetUserId}:${targetGuildId}`).setEmoji('✅').setLabel(t('Usuń', 'Remove')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`panel_remove_all_confirm_${targetUserId}:${targetGuildId}`).setEmoji('🏆').setLabel(t('Usuń z osiągnięciami', 'Remove with Achievements')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    async _handlePanelRemoveConfirm(interaction, rawValue, { resetAllAchievements = false } = {}) {
        // rawValue: "userId:targetGuildId" (zawiera docelowy serwer, niekoniecznie bieżący)
        const [targetUserId, targetGuildId] = rawValue.split(':');
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
            const playersBefore = await this.rankingService.getSortedPlayers(targetGuildId).catch(() => []);
            const playerName = playersBefore.find(p => p.userId === targetUserId)?.username || targetUserId;
            const wasRemoved = await this.rankingService.removePlayerFromRanking(targetUserId, targetGuildId);
            if (!wasRemoved) {
                const { embed, components } = this._buildAdminPanel(interaction);
                embed.setDescription(t('⚠️ Gracz nie znajduje się w rankingu.\n\n', '⚠️ Player not found in ranking.\n\n') + (embed.data.description || ''));
                await interaction.editReply({ embeds: [embed], components });
                return;
            }
            try {
                const guildConfig = this.config.getGuildConfig(targetGuildId);
                const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
                const updatedPlayers = await this.rankingService.getSortedPlayers(targetGuildId);
                if (targetGuild) {
                    await this.roleService.updateTopRoles(targetGuild, updatedPlayers, guildConfig?.topRoles || null);
                }
                if (this.achievementService) {
                    if (resetAllAchievements) {
                        await this.achievementService.resetAllAchievements(targetGuildId, targetUserId);
                    } else {
                        await this.achievementService.clearUserAchievements(targetGuildId, targetUserId);
                    }
                }
                const guildNameLog = targetGuild?.name || targetGuildId;
                await this.logService.logMessage('success', `Gracz ${playerName} usunięty z rankingu${resetAllAchievements ? ' (z wszystkimi osiągnięciami)' : ''} (serwer ${guildNameLog}) przez panel admina`, interaction);
            } catch (roleError) {
                logger.warn(`Błąd aktualizacji ról TOP po usunięciu (panel): ${roleError.message}`);
            }
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle(t('✅ Gracz usunięty', '✅ Player Removed'))
                    .setDescription(t(
                        `Gracz <@${targetUserId}> został usunięty z rankingu${serverNote}${resetAllAchievements ? ' wraz ze wszystkimi osiągnięciami' : ''}.`,
                        `Player <@${targetUserId}> has been removed from the ranking${serverNote}${resetAllAchievements ? ' along with all achievements' : ''}.`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveConfirm (serwer "${interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId}", gracz ID ${targetUserId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania gracza.', '❌ Error removing player.'), embeds: [], components: [] });
        }
    }

    async _handlePanelUnblock(interaction) {
        const guildId = interaction.guildId;
        const msgs = this.msgs(guildId);
        const t = this._panelT(guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const blocked = await this.userBlockService.getBlockedUsers();
        const visibleBlocked = isHeadAdmin ? blocked : blocked.filter(e => e.guildId === guildId);
        if (visibleBlocked.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(t('🔓 Odblokuj gracza', '🔓 Unblock Player')).setDescription(msgs.unblockNoBlocked)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
                )]
            });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('panel_unblock_search_modal')
            .setTitle(t('Odblokuj gracza', 'Unblock Player'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('unblock_query')
                .setLabel(t('Fragment nicku gracza', 'Part of the player\'s nick'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Kowalski', 'e.g. Kowalski'))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelUnblockSearch(interaction) {
        const guildId = interaction.guildId;
        const msgs = this.msgs(guildId);
        const t = this._panelT(guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const query = interaction.fields.getTextInputValue('unblock_query').trim().toLowerCase();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const blocked = await this.userBlockService.getBlockedUsers();
        const scopedBlocked = isHeadAdmin ? blocked : blocked.filter(e => e.guildId === guildId);
        const filtered = scopedBlocked.filter(e => e.username.toLowerCase().includes(query));
        if (filtered.length === 0) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🔓 Nie znaleziono', '🔓 Not Found'))
                    .setDescription(t(`Brak zablokowanego gracza z nickiem zawierającym "**${query}**".`, `No blocked player with nick containing "**${query}**".`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                )]
            });
            return;
        }
        const blockLabels = { permanent: t('∞ Permanentnie', '∞ Permanent'), expired: t('Wygasła', 'Expired') };
        const options = filtered.slice(0, 25).map(entry => {
            const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil, blockLabels);
            return {
                label: entry.username.slice(0, 100),
                description: `${entry.guildName} | ${t('Pozostało', 'Remaining')}: ${timeLabel}`.slice(0, 100),
                value: entry.userId
            };
        });
        const subtitle = filtered.length > 25
            ? t(`Znaleziono ${filtered.length} — pokazuję 25. Zawęź wyszukiwanie.`, `Found ${filtered.length} — showing 25. Narrow your search.`)
            : t(`Znaleziono ${filtered.length} gracz(y).`, `Found ${filtered.length} player(s).`);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle(msgs.unblockTitle)
                .setDescription(
                    subtitle + '\n\n' +
                    filtered.slice(0, 25).map((entry, i) => {
                        const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil, blockLabels);
                        return `${i + 1}. **${entry.username}** — ${entry.guildName} | \`${timeLabel}\``;
                    }).join('\n')
                )
                .setTimestamp()],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_unblock_select')
                        .setPlaceholder(t('Wybierz gracza do odblokowania', 'Select a player to unblock'))
                        .addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                )
            ]
        });
    }

    async _handlePanelTokens(interaction) {
        await interaction.deferUpdate();
        const month = new Date().toISOString().slice(0, 7);
        const isSuperUser = this._isHeadAdmin(interaction.user.id);
        const guildFilter = isSuperUser ? 'all' : interaction.guildId;
        const reply = await this._buildTokensEmbed(interaction, month, guildFilter, isSuperUser, 0);
        await interaction.editReply(reply);
    }

    async _handlePanelBlock(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_block_search_modal')
            .setTitle(t('Zablokuj gracza', 'Block Player'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('block_query')
                .setLabel(t('Fragment nicku gracza', 'Part of the player\'s nick'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Kowalski', 'e.g. Kowalski'))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelBlockSearch(interaction) {
        const t = this._panelT(interaction.guildId);
        const query = interaction.fields.getTextInputValue('block_query').trim().toLowerCase();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const allMatches = [];
            for (const sgid of configuredIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if ((p.username || p.userId).toLowerCase().includes(query)) {
                        allMatches.push({ ...p, rank: i + 1, sgid, guildName });
                    }
                }
            }
            // Odfiltruj już zablokowanych
            const alreadyBlocked = new Set((await this.userBlockService.getBlockedUsers()).map(e => e.userId));
            const notBlocked = allMatches.filter(p => !alreadyBlocked.has(p.userId));
            const alreadyBlockedMatches = allMatches.filter(p => alreadyBlocked.has(p.userId));

            if (allMatches.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF4444)
                        .setTitle(t('🔒 Nie znaleziono gracza', '🔒 Player Not Found'))
                        .setDescription(t(`Brak gracza z nickiem zawierającym "**${query}**".`, `No player with nick containing "**${query}**".`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_block').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            if (notBlocked.length === 0) {
                // Wszyscy znalezieni są już zablokowani
                const list = alreadyBlockedMatches.slice(0, 10).map(p => `• **${p.username || p.userId}** — ${p.guildName}`).join('\n');
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF8C00)
                        .setTitle(t('🔒 Gracze już zablokowani', '🔒 Players Already Blocked'))
                        .setDescription(t(`Wszyscy znalezieni gracze są już zablokowani:\n${list}`, `All found players are already blocked:\n${list}`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_block').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const options = notBlocked.slice(0, 25).map(p => ({
                label: `#${p.rank} ${(p.username || p.userId).slice(0, 60)}`.slice(0, 100),
                description: `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.userId}:${p.sgid}`,
            }));
            let subtitle = notBlocked.length > 25
                ? t(`Znaleziono ${notBlocked.length} — pokazuję 25. Zawęź wyszukiwanie.`, `Found ${notBlocked.length} — showing 25. Narrow your search.`)
                : t(`Znaleziono ${notBlocked.length} gracz(y) do zablokowania.`, `Found ${notBlocked.length} player(s) to block.`);
            if (alreadyBlockedMatches.length > 0) {
                subtitle += '\n' + t(`(${alreadyBlockedMatches.length} już zablokowanych — pominięto)`, `(${alreadyBlockedMatches.length} already blocked — skipped)`);
            }
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🔒 Wybierz gracza do zablokowania', '🔒 Select Player to Block'))
                    .setDescription(subtitle)],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('panel_block_select')
                            .setPlaceholder(t('Wybierz gracza...', 'Select a player...'))
                            .addOptions(options)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_block').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelBlockSearch (serwer "${interaction.guild?.name || interaction.guildId}"):`, err);
            await interaction.editReply({ content: t('❌ Błąd wyszukiwania gracza.', '❌ Error searching for player.'), embeds: [], components: [] });
        }
    }

    async _handlePanelBlockSelect(interaction) {
        const value = interaction.values[0]; // userId:guildId
        const [targetUserId, targetGuildId] = value.split(':');
        const t = this._panelT(interaction.guildId);
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => p.userId === targetUserId);
        const displayName = player?.username || targetUserId;
        const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF4444)
                .setTitle(t('🔒 Zablokuj gracza', '🔒 Block Player'))
                .setDescription(t(
                    `Gracz: **${displayName}**\nSerwer: **${guildName}**\n\nPodaj czas blokady w kolejnym oknie.\nFormat: \`30m\`, \`2h\`, \`7d\`, \`2w\` lub puste = permanentnie.`,
                    `Player: **${displayName}**\nServer: **${guildName}**\n\nEnter the block duration in the next window.\nFormat: \`30m\`, \`2h\`, \`7d\`, \`2w\` or leave empty = permanent.`
                ))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`panel_block_time_${targetUserId}_${targetGuildId}`)
                    .setEmoji('⏱️').setLabel(t('Ustaw czas blokady', 'Set Block Duration'))
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_block').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    async _handlePanelBlockTimeModal(interaction, targetUserId, targetGuildId) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId(`panel_block_modal_${targetUserId}_${targetGuildId}`)
            .setTitle(t('Czas blokady', 'Block Duration'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('block_duration')
                .setLabel(t('Czas blokady (30m, 2h, 7d, 2w — puste = permanentnie)', 'Duration (30m, 2h, 7d, 2w — empty = permanent)'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('Puste = permanentna blokada', 'Empty = permanent block'))
                .setRequired(false)
                .setMaxLength(10)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelBlockModal(interaction, targetUserId, targetGuildId) {
        const t = this._panelT(interaction.guildId);
        const durationStr = (interaction.fields.getTextInputValue('block_duration') || '').trim();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const players = await this.rankingService.getSortedPlayers(targetGuildId);
            const player = players.find(p => p.userId === targetUserId);
            const username = player?.username || targetUserId;
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
            const blockedUntil = await this.userBlockService.blockUser(
                targetUserId, username, targetGuildId, guildName, durationStr,
                true // blockedByHeadAdmin
            );
            const timeLabel = blockedUntil
                ? this.userBlockService.formatTimeRemaining(blockedUntil, { permanent: t('∞ Permanentnie', '∞ Permanent'), expired: t('Wygasła', 'Expired') })
                : t('∞ Permanentnie', '∞ Permanent');
            logger.info(`🔒 Head Admin zablokował ${username} (${targetUserId}) na serwerze ${guildName} — ${timeLabel}`);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle(t('✅ Gracz zablokowany', '✅ Player Blocked'))
                    .setDescription(t(
                        `Gracz **${username}** (${guildName}) został zablokowany.\nCzas: **${timeLabel}**`,
                        `Player **${username}** (${guildName}) has been blocked.\nDuration: **${timeLabel}**`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelBlockModal (serwer "${interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId}", gracz ID ${targetUserId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd blokowania gracza.', '❌ Error blocking player.'), embeds: [], components: [] });
        }
    }

    async _handlePanelOcr(interaction) {
        const t = this._panelT(interaction.guildId);
        const guildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];

        const updateBlocked = [];
        const testEnabled = [];
        for (const guildId of guildIds) {
            const guild = interaction.client.guilds.cache.get(guildId);
            if (!guild) continue;
            if (this.ocrBlockService.isBlocked(guildId, 'update')) updateBlocked.push(guild.name);
            if (!this.ocrBlockService.isBlocked(guildId, 'test')) testEnabled.push(guild.name);
        }

        const none = t('*(brak)*', '*(none)*');
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(t('🔄 AI OCR — Stan serwerów', '🔄 AI OCR — Server Status'))
            .addFields(
                { name: t('🔒 /update wyłączone', '🔒 /update disabled'), value: updateBlocked.length ? updateBlocked.join('\n') : none, inline: true },
                { name: t('🔓 /test włączone', '🔓 /test enabled'), value: testEnabled.length ? testEnabled.join('\n') : none, inline: true },
            );

        await interaction.update({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ocr_manage').setEmoji('🔍').setLabel(t('Zarządzaj OCR', 'Manage OCR')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _openPanelOcrModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_ocr_search_modal')
            .setTitle(t('AI OCR on/off — wybierz serwer', 'AI OCR on/off — Select Server'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ocr_query')
                .setLabel(t('Fragment nazwy serwera', 'Part of the server name'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Polski Squad', 'e.g. Polski Squad'))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelOcrSearch(interaction) {
        const t = this._panelT(interaction.guildId);
        const query = interaction.fields.getTextInputValue('ocr_query').trim().toLowerCase();
        await interaction.deferUpdate();
        const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
        const matches = [];
        for (const guildId of configuredIds) {
            const guild = interaction.client.guilds.cache.get(guildId);
            if (!guild) continue;
            if (!guild.name.toLowerCase().includes(query)) continue;
            const updateBlocked = this.ocrBlockService.isBlocked(guildId, 'update');
            const testBlocked = this.ocrBlockService.isBlocked(guildId, 'test');
            matches.push({ guildId, guildName: guild.name, updateBlocked, testBlocked });
        }
        if (matches.length === 0) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🔄 Nie znaleziono serwera', '🔄 Server Not Found'))
                    .setDescription(t(`Brak skonfigurowanego serwera z nazwą zawierającą "**${query}**".`, `No configured server with name containing "**${query}**".`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ocr_manage').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                )]
            });
            return;
        }
        if (matches.length === 1) {
            // Bezpośrednio pokaż ustawienia OCR dla jedynego trafienia
            const { guildId, guildName, updateBlocked, testBlocked } = matches[0];
            const gid = guildId;
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF6B35)
                    .setTitle(`🔄 OCR on/off — ${guildName}`)
                    .setDescription(
                        `${t('Stan', 'Status')} /update: ${updateBlocked ? `🔒 ${t('wyłączone', 'disabled')}` : `🔓 ${t('włączone', 'enabled')}`}\n` +
                        `${t('Stan', 'Status')} /test: ${testBlocked ? `🔒 ${t('wyłączone', 'disabled')}` : `🔓 ${t('włączone', 'enabled')}`}\n\n` +
                        t('Wybierz akcję:', 'Select action:')
                    )],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`panel_ocr_en_update_${gid}`).setEmoji('🔓').setLabel(t('Włącz /update', 'Enable /update')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_en_test_${gid}`).setEmoji('🔓').setLabel(t('Włącz /test', 'Enable /test')).setStyle(ButtonStyle.Success).setDisabled(!testBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_en_both_${gid}`).setEmoji('🔓').setLabel(t('Włącz oba', 'Enable Both')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked && !testBlocked),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_update_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz /update', 'Disable /update')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_test_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz /test', 'Disable /test')).setStyle(ButtonStyle.Danger).setDisabled(testBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_both_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz oba', 'Disable Both')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked && testBlocked),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ocr_manage').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
            return;
        }
        // Wiele wyników — pokaż listę do wyboru
        const options = matches.slice(0, 25).map(({ guildId, guildName, updateBlocked, testBlocked }) => {
            const statusIcon = updateBlocked || testBlocked ? '🔒' : '🔓';
            return {
                label: `${statusIcon} ${guildName}`.slice(0, 100),
                description: `update: ${updateBlocked ? t('wyłączone', 'disabled') : t('włączone', 'enabled')} | test: ${testBlocked ? t('wyłączone', 'disabled') : t('włączone', 'enabled')}`,
                value: guildId,
            };
        });
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xFF6B35)
                .setTitle(t('🔄 AI OCR on/off — wybierz serwer', '🔄 AI OCR on/off — Select Server'))
                .setDescription(t(`Znaleziono ${matches.length} serwerów — wybierz serwer.`, `Found ${matches.length} servers — select a server.`))],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_ocr_guild_select')
                        .setPlaceholder(t('Wybierz serwer...', 'Select a server...'))
                        .addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ocr_manage').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                )
            ]
        });
    }

    async _handlePanelOcrGuildSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const targetGuildId = interaction.values[0];
        const guild = interaction.client.guilds.cache.get(targetGuildId);
        const guildName = guild?.name || targetGuildId;
        const updateBlocked = this.ocrBlockService.isBlocked(targetGuildId, 'update');
        const testBlocked = this.ocrBlockService.isBlocked(targetGuildId, 'test');
        const gid = targetGuildId;
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF6B35)
                .setTitle(`🔄 OCR on/off — ${guildName}`)
                .setDescription(
                    `${t('Stan', 'Status')} /update: ${updateBlocked ? `🔒 ${t('wyłączone', 'disabled')}` : `🔓 ${t('włączone', 'enabled')}`}\n` +
                    `${t('Stan', 'Status')} /test: ${testBlocked ? `🔒 ${t('wyłączone', 'disabled')}` : `🔓 ${t('włączone', 'enabled')}`}\n\n` +
                    t('Wybierz akcję:', 'Select action:')
                )],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`panel_ocr_en_update_${gid}`).setEmoji('🔓').setLabel(t('Włącz /update', 'Enable /update')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_en_test_${gid}`).setEmoji('🔓').setLabel(t('Włącz /test', 'Enable /test')).setStyle(ButtonStyle.Success).setDisabled(!testBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_en_both_${gid}`).setEmoji('🔓').setLabel(t('Włącz oba', 'Enable Both')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked && !testBlocked),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_update_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz /update', 'Disable /update')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_test_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz /test', 'Disable /test')).setStyle(ButtonStyle.Danger).setDisabled(testBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_both_${gid}`).setEmoji('🔒').setLabel(t('Wyłącz oba', 'Disable Both')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked && testBlocked),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
                )
            ]
        });
    }

    async _handlePanelOcrAction(interaction, customId) {
        // panel_ocr_{en|dis}_{update|test|both}_{guildId}
        const t = this._panelT(interaction.guildId);
        const parts = customId.split('_');
        const action = parts[2];       // 'en' lub 'dis'
        const target = parts[3];       // 'update', 'test', 'both'
        const targetGuildId = parts.slice(4).join('_');
        const targetCommands = target === 'both' ? ['update', 'test'] : [target];
        const cmdLabel = targetCommands.map(c => `\`/${c}\``).join(', ');
        const guildConfig = this.config.getGuildConfig(targetGuildId);
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        if (!guildConfig) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle(t('❌ Błąd', '❌ Error')).setDescription(t('Serwer nie jest skonfigurowany.', 'Server is not configured.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
                )]
            });
            return;
        }
        await interaction.deferUpdate();
        if (action === 'en') {
            await this.ocrBlockService.unblock(targetGuildId, targetCommands);
            logger.info(`🔓 OCR odblokowany dla ${cmdLabel} na serwerze ${serverName} (panel)`);
            if (guildConfig.allowedChannelId) {
                const ch = await interaction.client.channels.fetch(guildConfig.allowedChannelId).catch(() => null);
                if (ch) {
                    const guildMsgs = this.config.getMessages(targetGuildId);
                    await ch.send({ content: formatMessage(guildMsgs.ocrBlockPerGuildDisabled, { commands: cmdLabel, serverName }) }).catch(() => {});
                }
            }
        } else {
            await this.ocrBlockService.block(targetGuildId, targetCommands);
            logger.warn(`🔒 OCR zablokowany dla ${cmdLabel} na serwerze ${serverName} (panel)`);
        }
        const actionLabel = action === 'en' ? t('🔓 Odblokowano', '🔓 Unblocked') : t('🔒 Zablokowano', '🔒 Blocked');
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(action === 'en' ? 0x57F287 : 0xFF4444)
                .setTitle(`${actionLabel} OCR`)
                .setDescription(`${cmdLabel} ${t('na serwerze', 'on server')} **${serverName}** — ${action === 'en' ? t('włączone', 'enabled') : t('wyłączone', 'disabled')}.`)],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
            )]
        });
    }

    /**
     * Obsługuje komendę /ranking — pokazuje ephemeral z rankingiem własnego serwera.
     * @param {CommandInteraction} interaction
     */
    async handleRankingCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);

        try {
            await interaction.deferReply({ flags: ['Ephemeral'] });

            const guildId = interaction.guildId;
            const guild = interaction.guild;
            const players = await this.rankingService.getSortedPlayers(guildId);

            if (players.length === 0) {
                await interaction.editReply({ content: msgs.rankingEmpty });
                return;
            }

            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);

            // Statystyki wywołującego
            let callerStats = null;
            try {
                const callerUserId = interaction.user.id;
                const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
                const globalIdx = globalRanking.findIndex(p => p.userId === callerUserId);
                const serverIdx = players.findIndex(p => p.userId === callerUserId);
                callerStats = {
                    score: globalIdx !== -1 ? globalRanking[globalIdx].score : null,
                    serverPosition: serverIdx !== -1 ? serverIdx + 1 : null,
                    globalPosition: globalIdx !== -1 ? globalIdx + 1 : null,
                    rolePositions: []
                };
                if (this.roleRankingConfigService) {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    const memberRoles = interaction.member?.roles?.cache;
                    if (roleRankings.length > 0 && memberRoles) {
                        for (const rr of roleRankings) {
                            if (!memberRoles.has(rr.roleId)) continue;
                            const rolePlayers = await this.rankingService.getSortedPlayersByRole(guildId, rr.roleId, guild, this.roleRankingConfigService);
                            const roleIdx = rolePlayers.findIndex(p => p.userId === callerUserId);
                            if (roleIdx !== -1) callerStats.rolePositions.push({ roleName: rr.roleName, position: roleIdx + 1 });
                        }
                    }
                }
            } catch (statsErr) {
                logger.error('Błąd pobierania statystyk wywołującego:', statsErr);
            }

            // Przyciski ról
            let roleRows = [];
            if (this.roleRankingConfigService) {
                try {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    if (roleRankings.length > 0) roleRows = this.rankingService.createRoleRankingButtons(roleRankings, guildId);
                } catch (roleErr) {
                    logger.warn('Błąd ładowania rankingów ról:', roleErr);
                }
            }

            const callerIdx = players.findIndex(p => p.userId === interaction.user.id);
            const userPage = callerIdx !== -1 ? Math.floor(callerIdx / this.config.ranking.playersPerPage) : null;

            const embed = await this.rankingService.createRankingEmbed(
                players, 0, totalPages, interaction.user.id, guild,
                { mode: 'server', client: null, messages: msgs, callerStats }
            );
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, roleRows, {
                userPage, mode: 'server', guildId, guildName: guild?.name || null
            });

            // Wykres historii rekordów wywołującego (dołączany do tej samej wiadomości)
            let scoreHistoryAttachment = null;
            if (this.scoreHistoryService && this.chartService) {
                try {
                    const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [guildId];
                    const callerHistory = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIds, interaction.user.id, 90);
                    if (callerHistory.length >= 2) {
                        const chartTitle = msgs.chartTitle;
                        const callerUsername = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                        const chartBuffer = await this.chartService.generateScoreHistoryChart(callerHistory, callerUsername, chartTitle);
                        if (chartBuffer) {
                            scoreHistoryAttachment = new AttachmentBuilder(chartBuffer, { name: 'score_history.png' });
                        }
                    }
                } catch (chartErr) {
                    logger.warn('Błąd generowania wykresu historii wyników:', chartErr);
                }
            }

            const replyOptions = { embeds: [embed], components: buttons };
            if (scoreHistoryAttachment) replyOptions.files = [scoreHistoryAttachment];
            const reply = await interaction.editReply(replyOptions);
            this.rankingService.addActiveRanking(reply.id, {
                players, currentPage: 0, totalPages,
                userId: interaction.user.id, messageId: reply.id,
                mode: 'server', guildId, guildName: guild?.name || null,
                parentGuildId: null, parentGuildName: null,
                callerStats, roleRows, userPage
            });

            // Śledź przegląd rankingu dla osiągnięć (fire-and-forget)
            if (this.achievementService) {
                this.achievementService.trackRankingView(guildId, interaction.user.id).catch(() => {});
            }

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
            logger.warn(`Błąd pobierania pozycji ról dla użytkownika "${guild?.members?.cache?.get(userId)?.displayName || userId}": ${err.message}`);
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

        const isAllowed = this.config.blockOcrUserIds.includes(interaction.user.id)
            || (this.testerService && this.testerService.isTester(interaction.user.id));
        if (!isAllowed) {
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
        const gl = this.logService._gl(interaction.guildId);

        const msgs = this.msgs(interaction.guildId);
        let _ocrEmbedParams = null; // zbieramy przez cały flow, wysyłamy w finally

        if (await this.userBlockService.isBlocked(interaction.user.id)) {
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

        const attachment = interaction.options.getAttachment('image');

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
        if (this.ocrBlockService.isBlocked(interaction.guildId, ocrBlockKey) && !isOcrAuthorized) {
            await interaction.reply({ content: msgs.ocrBlocked, flags: ['Ephemeral'] });
            return;
        }

        // Cooldown /update (nie dotyczy /test ani head admina)
        if (!dryRun && this.updateCooldownService && !this._isHeadAdmin(interaction.user.id)) {
            const remainingMs = this.updateCooldownService.getRemainingMs(interaction.user.id);
            if (remainingMs !== null) {
                await interaction.reply({
                    content: formatMessage(msgs.updateCooldown, { time: formatCooldownTime(remainingMs) }),
                    flags: ['Ephemeral']
                });
                return;
            }
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
        await interaction.editReply({ content: msgs.updateDownloading });
        let lastMsgAt = Date.now();

        const editReplyStep = async (content) => {
            const elapsed = Date.now() - lastMsgAt;
            if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
            await interaction.editReply({ content });
            lastMsgAt = Date.now();
        };

        // Ustaw cooldown od razu — chroni przed spamem niezależnie od wyniku OCR (nie dotyczy head admina)
        if (!dryRun && this.updateCooldownService && !this._isHeadAdmin(interaction.user.id)) {
            const appliedCooldownMs = await this.updateCooldownService.setCooldown(interaction.user.id);
            const { formatCooldownDuration: fcd } = require('../services/updateCooldownService');
            const base = this.updateCooldownService.getCooldownDuration();
            if (appliedCooldownMs > base) {
                logger.info(`⏫ Cooldown podwojony dla ${interaction.user.username}: ${fcd(appliedCooldownMs)}`);
            }
        }

        let tempImagePath = null;

        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });

            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);

            await editReplyStep(msgs.updateComparingTemplate);

            const displayNameForLog = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            gl.info(`🤖 [/${commandName}] Uruchamiam analizę z weryfikacją wzorca dla ${this.logService.nickLink(displayNameForLog, interaction.user.id)}${dryRun ? ' (tryb testowy)' : ''}`);

            const onProgress = async (step) => {
                if (step === 'extracting') {
                    await editReplyStep(msgs.updateExtractingData);
                }
            };

            // ── Operations Gateway (authorize + root span + record) ───────────
            const op = await this.botOps.run({
                type:  OPERATIONS_TYPE,
                actor: { discordId: interaction.user.id },
                scope: { guildId: interaction.guildId, channelId: interaction.channelId },
                hints: { command: commandName },
            }, async (ctx) => {
                const guildLang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
                const ai = await this.aiOcrService.analyzeTestImage(tempImagePath, gl, ctx.telemetryMeta, guildLang, onProgress);
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
                this.tokenUsageService.record(interaction.guildId, promptTokens, outputTokens, interaction.user.id).catch(() => {});
            }

            if (aiResult.error === 'NOT_SIMILAR') {
                gl.warn(`❌ [/${commandName}] Odrzucono: NOT_SIMILAR`);
                _ocrEmbedParams = { type: 'rejected', userName: displayNameForLog, userId: interaction.user.id, commandName, reason: 'NOT_SIMILAR', rejectionReason: aiResult.rejectionReason };
                const _notSimilarImgUrl = await this._sendInvalidScreenReport(interaction, tempImagePath, 'NOT_SIMILAR', gl, aiResult.rejectionReason);
                if (_notSimilarImgUrl) _ocrEmbedParams.imageUrl = _notSimilarImgUrl;
                const notSimilarDesc = aiResult.rejectionReason
                    ? `**${msgs.testNotSimilarReasonLabel}:** ${aiResult.rejectionReason}`
                    : null;
                const _rejExt1 = path.extname(tempImagePath).slice(1) || 'png';
                const _rejName1 = `rejected_${Date.now()}.${_rejExt1}`;
                await interaction.editReply({
                    content: '',
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle(msgs.testNotSimilarTitle)
                        .setDescription(notSimilarDesc)
                        .setImage(`attachment://${_rejName1}`)
                        .setTimestamp()],
                    files: [new AttachmentBuilder(tempImagePath, { name: _rejName1 })],
                });
                return;
            }

            if (!aiResult.isValidVictory) {
                gl.warn(`❌ [/${commandName}] Odrzucono: ${aiResult.error || 'VALIDATION_FAILED'}`);
                _ocrEmbedParams = { type: 'rejected', userName: displayNameForLog, userId: interaction.user.id, commandName, reason: aiResult.error || 'VALIDATION_FAILED' };
                const _validationImgUrl = await this._sendInvalidScreenReport(interaction, tempImagePath, aiResult.error, gl);
                if (_validationImgUrl) _ocrEmbedParams.imageUrl = _validationImgUrl;
                const _rejExt2 = path.extname(tempImagePath).slice(1) || 'png';
                const _rejName2 = `rejected_${Date.now()}.${_rejExt2}`;
                await interaction.editReply({
                    content: msgs.invalidScreenshot,
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setImage(`attachment://${_rejName2}`)
                        .setTimestamp()],
                    files: [new AttachmentBuilder(tempImagePath, { name: _rejName2 })],
                });
                return;
            }

            const bestScore = aiResult.score;
            const bossName = aiResult.bossName;
            gl.success(`✅ [/${commandName}] AI OCR: wynik="${bestScore}", boss="${bossName}"${aiResult.total ? `, total="${aiResult.total}"` : ''}`);

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            const prevGlobalRanking = dryRun ? null : await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
            const prevGlobalPosition = !dryRun
                ? (() => { const i = prevGlobalRanking?.findIndex(p => p.userId === userId); return i !== -1 ? i + 1 : null; })()
                : null;

            // Dane cross-server — obliczane raz, używane przy sprawdzeniu duplikatu i przy embeddzie rekordu
            const _newScoreValue = this.rankingService.parseScoreValue(bestScore);
            const _prevGlobalUser = !dryRun ? prevGlobalRanking?.find(p => p.userId === userId) : null;

            // Duplikat cross-server: gracz ma już taki sam (lub lepszy) wynik na innym serwerze — nie zapisuj
            if (!dryRun && _prevGlobalUser && _prevGlobalUser.scoreValue >= _newScoreValue && _prevGlobalUser.sourceGuildId !== guildId) {
                const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                const imageAttachment = new AttachmentBuilder(tempImagePath, {
                    name: `wynik_${safeUserName}_${Date.now()}.${fileExtension}`
                });
                const sourceGuildName = interaction.client.guilds.cache.get(_prevGlobalUser.sourceGuildId)?.name
                    || _prevGlobalUser.sourceGuildId;
                const crossServerEmbed = new EmbedBuilder()
                    .setColor(0xff9900)
                    .setTitle(msgs.resultTitle)
                    .addFields([
                        { name: msgs.resultPlayer, value: userName, inline: true },
                        { name: msgs.resultScore, value: bestScore, inline: true },
                    ])
                    .setTimestamp();
                if (bossName) crossServerEmbed.addFields({ name: msgs.recordBoss, value: bossName, inline: false });
                crossServerEmbed.addFields({
                    name: msgs.resultStatus,
                    value: formatMessage(msgs.resultNotBeatenCrossServer, { score: _prevGlobalUser.score, guildName: sourceGuildName }),
                    inline: false
                });
                crossServerEmbed.setImage(`attachment://${imageAttachment.name}`);
                await interaction.editReply({ embeds: [crossServerEmbed], files: [imageAttachment] });
                _ocrEmbedParams = { type: 'cross_server', userName, userId, score: bestScore, bossName, commandName, previousScore: _prevGlobalUser.score };
                gl.info(`✅ ${this.logService.nickLink(userName, userId)} Duplikat cross-server (nie zapisano) — serwer: "${sourceGuildName}"`);
                return;
            }

            // Zapamiętaj poprzedni rekord przed nadpisaniem (potrzebne do community verification)
            const previousRecordSnapshot = dryRun ? null : await this.rankingService.getUserRecord(guildId, userId);

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
                await editReplyStep(msgs.updateSaving);
                ({ isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                    guildId, userId, userName, bestScore, bossName
                ));
                await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);
            }

            // Pozycja po zapisie (potrzebna do osiągnięć i do embeda)
            let newAchievements = [];
            let currentPositionForAch = 0;
            if (isNewRecord && !dryRun && this.achievementService) {
                try {
                    const sortedAfter = await this.rankingService.getSortedPlayers(guildId);
                    currentPositionForAch = sortedAfter.findIndex(p => p.userId === userId) + 1;
                    const prevScoreValue = currentScore ? this.rankingService.parseScoreValue(currentScore.score) : 0;
                    const newScoreValue = this.rankingService.parseScoreValue(bestScore);
                    newAchievements = await this.achievementService.processSubmission(guildId, userId, {
                        scoreValue: newScoreValue,
                        bossName,
                        isNewRecord: true,
                        prevScoreValue,
                        currentPosition: currentPositionForAch,
                    });
                } catch {}
            }

            if (!isNewRecord && !dryRun && this.achievementService) {
                this.achievementService.trackNonRecord(guildId, userId).catch(() => {});
            }

            if (!isNewRecord) {
                _ocrEmbedParams = { type: dryRun ? 'test_no_record' : 'no_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
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
                        await interaction.editReply({ embeds: [resultEmbed], files: [imageAttachment] });
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
            const lang = guildConfig?.lang || 'pol';
            const achievementsFieldValue = this.achievementService
                ? this.achievementService.buildNewAchievementsFieldValue(newAchievements, lang)
                : null;

            // Snippet globalny — dla wszystkich graczy u których zmieniła się pozycja
            let globalSnippetData = null;
            if (!dryRun) {
                try {
                    const newGlobalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
                    globalSnippetData = await this.globalTop10Service.buildSnippetFieldData(
                        userId, newGlobalRanking, prevGlobalPosition, msgs, interaction.client
                    );
                    if (globalSnippetData) {
                        const newGlobalIdx = newGlobalRanking.findIndex(p => p.userId === userId);
                        gl.info(`🌐 Snippet globalny: ${prevGlobalPosition ?? '—'} → #${newGlobalIdx + 1}`);
                    }
                } catch (snippetErr) {
                    gl.error(`❌ Błąd snippeta globalnego: ${snippetErr.message}`);
                }
            }

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
                rolePositions,
                achievementsFieldValue,
                globalSnippetData
            );

            // Dodaj pole o usuniętym rekordzie z innego serwera (jeśli nowy wynik go pobił)
            if (_prevGlobalUser && _newScoreValue > _prevGlobalUser.scoreValue && _prevGlobalUser.sourceGuildId !== guildId) {
                const removedGuildName = interaction.client.guilds.cache.get(_prevGlobalUser.sourceGuildId)?.name
                    || _prevGlobalUser.sourceGuildId;
                publicEmbed.addFields({
                    name: msgs.crossServerScoreRemovedField,
                    value: formatMessage(msgs.crossServerScoreRemovedValue, { score: _prevGlobalUser.score, guildName: removedGuildName }),
                    inline: false
                });
            }

            // Pobierz subskrybentów i dodaj liczbę obserwujących do embeda
            let recordSubscribers = [];
            if (!dryRun) {
                try {
                    recordSubscribers = await this.notificationService.getSubscribersForTarget(userId, guildId);
                    if (recordSubscribers.length > 0) {
                        publicEmbed.addFields({ name: `${msgs.recordFollowerLabel} ${recordSubscribers.length}`, value: '​' });
                    }
                } catch (subErr) {
                    gl.warn(`⚠️ Nie udało się pobrać subskrybentów: ${subErr.message}`);
                }
            }

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

                    // Sprawdź czy community verification włączona
                    const cvCfg = this.guildConfigService?.getCommunityVerification(guildId);
                    const cvEnabled = cvCfg?.enabled === true && this.communityVerificationService;

                    // Wyślij publiczny embed (bez przycisku na starcie — ID wiadomości nieznane przed wysłaniem)
                    const publicMsg = await interaction.followUp({
                        embeds: [publicEmbed],
                        files: [imageAttachment],
                    });

                    // Jeśli CV włączone — teraz znamy ID wiadomości, dodaj przycisk i utwórz sesję
                    if (cvEnabled && publicMsg) {
                        try {
                            // Wygaś stare pending sesje tego gracza i usuń przyciski ze starych wiadomości
                            const expired = await this.communityVerificationService.expireUserSessions(userId, guildId);
                            for (const oldMsgId of expired) {
                                try {
                                    const oldSession = this.communityVerificationService.getSession(oldMsgId);
                                    if (oldSession) {
                                        const ch = await interaction.client.channels.fetch(oldSession.channelId).catch(() => null);
                                        if (ch) {
                                            const oldMsg = await ch.messages.fetch(oldMsgId).catch(() => null);
                                            if (oldMsg) await oldMsg.edit({ components: [] }).catch(() => {});
                                        }
                                    }
                                } catch {}
                            }

                            // Dodaj przycisk Zgłoś z prawidłowym ID wiadomości
                            const voteBtn = new ButtonBuilder()
                                .setCustomId(`cv_vote_${publicMsg.id}`)
                                .setLabel(msgs.cvVoteButton)
                                .setStyle(ButtonStyle.Secondary);
                            await publicMsg.edit({ components: [new ActionRowBuilder().addComponents(voteBtn)] }).catch(() => {});

                            const msgUrl = `https://discord.com/channels/${guildId}/${publicMsg.channelId}/${publicMsg.id}`;
                            await this.communityVerificationService.createSession({
                                guildId,
                                userId,
                                messageId: publicMsg.id,
                                channelId: publicMsg.channelId,
                                messageUrl: msgUrl,
                                previousRecord: previousRecordSnapshot,
                                newRecord: { score: bestScore, bossName, timestamp: new Date().toISOString() },
                                newAchievements,
                            });
                        } catch (cvErr) {
                            gl.warn(`⚠️ community verification session error: ${cvErr.message}`);
                        }
                    }

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
                _ocrEmbedParams = { type: 'test_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
                return;
            }

            // Aktualizacja ról TOP po nowym rekordzie
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers, guildConfig?.topRoles || null);
                gl.success(`✅ ${this.logService.nickLink(userName, userId)} Role TOP zaktualizowane po nowym rekordzie`);
                _ocrEmbedParams = { type: 'new_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP: ${roleError.message}`, interaction);
                _ocrEmbedParams = { type: 'role_error', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score, roleError: roleError.message };
            }

            // DM powiadomienia dla subskrybentów (lista pobrana wcześniej przy liczeniu obserwujących)
            try {
                if (recordSubscribers.length > 0) {
                    gl.info(`📨 Wysyłam DM powiadomienia do ${recordSubscribers.length} subskrybentów`);
                    const guildRanking = await this.rankingService.loadRanking(guildId);
                    const trackedAvatarUrl = interaction.user.displayAvatarURL();
                    for (const subscriberId of recordSubscribers) {
                        try {
                            const subscriberUser = await interaction.client.users.fetch(subscriberId);
                            const dmAttachment = new AttachmentBuilder(tempImagePath, { name: imageAttachment.name });
                            const subscriberScore = guildRanking[subscriberId]?.score || null;
                            const dmEmbed = this.rankingService.createDmNotifEmbed(
                                publicEmbed,
                                userName,
                                trackedAvatarUrl,
                                bestScore,
                                subscriberScore,
                                this.msgs(interaction.guildId)
                            );
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
            // Wyślij dodatkowy embed do webhooka (nie zastępuje logowania tekstowego)
            if (_ocrEmbedParams) {
                try {
                    this.logService.sendOcrAnalysisEmbed(
                        interaction.guildId,
                        { ..._ocrEmbedParams, userAvatar: interaction.user.displayAvatarURL() },
                        interaction.guild ?? null
                    );
                } catch {}
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
                if (this.achievementService) {
                    await this.achievementService.clearUserAchievements(guildId, targetUser.id);
                }
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

    _describePanelButton(customId) {
        if (customId === 'panel_back' || customId === 'cfg_admin_panel') return 'Otwarto panel';
        if (customId === 'panel_back_configure') return 'Wróć do kreatora /configure';
        if (customId === 'panel_remove') return 'Usuń gracza z rankingu';
        if (customId.startsWith('panel_remove_confirm_')) return 'Potwierdzenie usunięcia gracza';
        if (customId.startsWith('panel_remove_all_confirm_')) return 'Potwierdzenie usunięcia gracza z osiągnięciami';
        if (customId === 'panel_unblock') return 'Odblokuj gracza';
        if (customId === 'panel_block') return 'Zablokuj gracza';
        if (customId.startsWith('panel_block_time_')) return 'Ustaw czas blokady gracza';
        if (customId === 'panel_tokens') return 'Zużycie tokenów';
        if (customId === 'panel_info') return 'Wyślij Info';
        if (customId === 'panel_tester') return 'Lista testerów';
        if (customId === 'panel_tester_add') return 'Dodaj testera';
        if (customId === 'panel_tester_remove') return 'Usuń testera (otwórz listę)';
        if (customId === 'panel_tester_remove_select') return 'Usuń testera (wybrano)';
        if (customId === 'panel_ach_del') return 'Usuń osiągnięcia (szukaj gracza)';
        if (customId === 'panel_ach_del_ps') return 'Usuń osiągnięcia (wybrano gracza)';
        if (customId === 'panel_ach_del_as') return 'Usuń osiągnięcia (wybrano osiągnięcie)';
        if (customId.startsWith('panel_ach_ok_')) return 'Potwierdzenie usunięcia osiągnięcia';
        if (customId === 'panel_ocr') return 'AI OCR on/off (szukaj serwera)';
        if (customId.startsWith('panel_ocr_en_')) return `Włącz AI OCR: ${customId.replace('panel_ocr_en_', '')}`;
        if (customId.startsWith('panel_ocr_dis_')) return `Wyłącz AI OCR: ${customId.replace('panel_ocr_dis_', '')}`;
        if (customId === 'panel_limit') return 'Ustaw limity';
        if (customId === 'panel_unconfigured') return 'Nieskonfigurowane serwery';
        if (customId === 'panel_diagnostics') return 'Diagnostyka uprawnień';
        if (customId === 'panel_ban_server') return 'Zbanuj serwer (panel)';
        if (customId === 'panel_ban_guild') return 'Zbanuj serwer (szukaj)';
        if (customId === 'panel_unban_guild') return 'Odbanuj serwer (lista)';
        if (customId.startsWith('panel_ban_guild_ok_')) return `Zbanuj serwer (potwierdź: ${customId.replace('panel_ban_guild_ok_', '')})`;
        return `panel: ${customId}`;
    }

    _describeCfgButton(customId) {
        if (customId === 'cfg_lang_pol') return 'Wybrano język: polski';
        if (customId === 'cfg_lang_eng') return 'Wybrano język: angielski';
        if (customId === 'cfg_back') return 'Cofnij krok';
        if (customId === 'cfg_tag_open') return 'Ustaw tag serwera (modal)';
        if (customId === 'cfg_roles_start') return 'Konfiguracja progów ról TOP — ekran główny';
        if (customId === 'cfg_roles_skip') return 'Wyłącz/Pomiń role TOP';
        if (customId === 'cfg_roles_enable') return 'Włącz role TOP';
        if (customId === 'cfg_tier_back') return '← Wstecz (ekran progów → krok 5)';
        if (customId === 'cfg_tier_accept') return 'Zaakceptuj konfigurację ról TOP';
        if (/^cfg_tier_\d+$/.test(customId)) return `Otwórz modal zakresu — próg ${parseInt(customId.replace('cfg_tier_', ''), 10) + 1}`;
        if (customId === 'cfg_tier_assign') return 'Przydziel role do progów — start';
        if (customId === 'cfg_tier_reset') return 'Usuń konfigurację progów';
        if (customId.startsWith('cfg_roles_skip_')) return `Pomiń rolę (próg ${parseInt(customId.replace('cfg_roles_skip_', ''), 10) + 1})`;
        if (customId.startsWith('cfg_roles_back_')) return `Wróć (próg ${parseInt(customId.replace('cfg_roles_back_', ''), 10) + 1})`;
        if (customId.startsWith('cfg_roles_sel_')) return `Wybrano rolę dla progu ${parseInt(customId.replace('cfg_roles_sel_', ''), 10) + 1}`;
        if (customId === 'cfg_notif_yes') return 'Raporty Global TOP10: TAK';
        if (customId === 'cfg_notif_no') return 'Raporty Global TOP10: NIE';
        if (customId === 'panel_top10_interval') return 'Interwał TOP10 — otwórz modal';
        if (customId === 'cfg_role_ranking_add') return 'Dodaj ranking roli';
        if (customId === 'cfg_role_ranking_remove') return 'Usuń ranking roli';
        if (customId === 'cfg_role_ranking_skip') return 'Pomiń ranking roli';
        if (customId === 'cfg_accept') return 'Zaakceptuj konfigurację';
        if (customId === 'cfg_cancel') return 'Anuluj konfigurację';
        if (customId.startsWith('cfg_step_')) return `Krok konfiguracji: ${customId.replace('cfg_step_', '')}`;
        return `cfg: ${customId}`;
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction
     */
    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;

        // === Community Verification — poza głównym try (własne error handling) ===
        if (customId.startsWith('cv_vote_')) {
            await this._handleCvVote(interaction);
            return;
        }
        if (customId.startsWith('cv_admin_')) {
            await this._handleCvAdmin(interaction);
            return;
        }

        try {

            // === Przyciski raportów odrzuconych screenów ===
            if (customId.startsWith('ee_approve_')) {
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const footerInfo = this._parseReportFooter(interaction.message.embeds[0]?.footer?.text);
                const adminName = interaction.member?.displayName || interaction.user.username;
                const sourceGuildId = footerInfo.guildId || interaction.guildId;
                const targetMsgs = this.config.getMessages(sourceGuildId);
                const serverName = interaction.client.guilds.cache.get(sourceGuildId)?.name || sourceGuildId;
                await interaction.deferUpdate();
                const updatedEmbeds = this._buildActionEmbeds(interaction.message.embeds, targetMsgs, serverName, 'approved', adminName);
                await interaction.editReply({
                    embeds: updatedEmbeds,
                    components: [],
                });
                if (footerInfo.globalMsgId) {
                    await this._updateGlobalReportMsg(interaction.client, footerInfo.globalMsgId, sourceGuildId, 'approved', adminName);
                } else if (footerInfo.perGuildChannelId && footerInfo.perGuildMsgId) {
                    await this._applyActionToAnyReport(interaction.client, footerInfo.perGuildChannelId, footerInfo.perGuildMsgId, sourceGuildId, 'approved', adminName);
                }
                return;
            }

            if (customId.startsWith('ee_block_')) {
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ModerateMembers')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const parts = customId.split('_');
                const targetUserId = parts[2];
                const targetGuildId = parts[3];
                const footerInfo = this._parseReportFooter(interaction.message.embeds[0]?.footer?.text);
                // Encode cross-update ref mutually: either global msgId or per-guild channel+msg
                const otherRef = footerInfo.globalMsgId
                    ? `g_${footerInfo.globalMsgId}`
                    : (footerInfo.perGuildChannelId && footerInfo.perGuildMsgId
                        ? `p_${footerInfo.perGuildChannelId}_${footerInfo.perGuildMsgId}`
                        : 'none');
                const modal = new ModalBuilder()
                    .setCustomId(`ee_block_modal_${targetUserId}_${targetGuildId}_${otherRef}`)
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

            if (customId.startsWith('ee_analyze_revert_')) {
                await this._handleAnalyzeRevert(interaction, customId);
                return;
            }

            if (customId.startsWith('ee_analyze_yes_')) {
                await this._handleAnalyzeConfirmed(interaction, customId);
                return;
            }

            if (customId.startsWith('ee_analyze_no_')) {
                await this._handleAnalyzeCancelled(interaction, customId);
                return;
            }

            if (customId.startsWith('ee_analyze_')) {
                await this._handleAnalyzeButton(interaction, customId);
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

            // === Paginacja ekranu wyboru serwera ===
            if (customId.startsWith('ranking_srv_prev_') || customId.startsWith('ranking_srv_next_')) {
                await this._handleRankingSrvPage(interaction, customId);
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

            // === Przycisk rankingu serwerów ===
            if (customId === 'ranking_guild_ranking') {
                await this._handleGuildRankingSelect(interaction);
                return;
            }

            // === Przycisk powrotu do wyboru ===
            if (customId === 'ranking_back') {
                await this._handleRankingBack(interaction);
                return;
            }

            // === Przyciski /achievements ===
            if (customId.startsWith('ach_cat_') || customId === 'ach_overview') {
                await this._handleAchievementsButton(interaction, customId);
                return;
            }

            // === Sprawdź gracza (osiągnięcia innego gracza) ===
            if (customId === 'ach_check_player') {
                await this._handleAchCheckPlayer(interaction);
                return;
            }
            if (customId.startsWith('ach_vc_') || customId.startsWith('ach_vo_') || customId === 'ach_vb') {
                await this._handleAchViewOtherButton(interaction, customId);
                return;
            }

            // === Ranking osiągnięć ===
            if (customId === 'ach_rank_start') {
                await this._handleAchRankingSelect(interaction, 'ach_rank_srv_' + interaction.guildId);
                return;
            }
            if (customId === 'ach_rank_back') {
                await this._handleAchRankingBack(interaction);
                return;
            }
            if (customId.startsWith('ach_rank_srv_prev_') || customId.startsWith('ach_rank_srv_next_')) {
                await this._handleAchRankingSrvPage(interaction, customId);
                return;
            }
            if (customId === 'ach_rank_global' || customId.startsWith('ach_rank_srv_') || customId.startsWith('ach_rank_role_')) {
                await this._handleAchRankingSelect(interaction, customId);
                return;
            }
            if (customId === 'ach_rank_prev' || customId === 'ach_rank_next' || customId === 'ach_rank_mypos') {
                await this._handleAchRankingPage(interaction, customId);
                return;
            }

            // === Przyciski Panelu Admina ===
            if (customId.startsWith('panel_') || customId === 'cfg_admin_panel') {
                const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                this.logService._gl(interaction.guildId).info(`${this.logService.nickLink(nick, interaction.user.id)} /manage → ${this._describePanelButton(customId)}`);
            }

            if (customId === 'cfg_admin_panel' || customId === 'panel_back') {
                await this._handleAdminPanelOpen(interaction);
                return;
            }
            if (customId === 'panel_back_configure') {
                const key = this._wizardKey(interaction.user.id, interaction.guildId);
                const state = this._configWizard.get(key);
                if (!state) {
                    const t = this._panelT(interaction.guildId);
                    await interaction.update({ content: t('⚠️ Sesja konfiguracji wygasła. Użyj komendy `/configure` ponownie.', '⚠️ Configuration session expired. Use `/configure` again.'), embeds: [], components: [] });
                    return;
                }
                const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
                await interaction.update({ embeds: [embed], components: rows });
                return;
            }
            if (customId === 'panel_remove') {
                await this._handlePanelRemove(interaction);
                return;
            }
            if (customId.startsWith('panel_remove_confirm_')) {
                const rawValue = customId.replace('panel_remove_confirm_', '');
                await this._handlePanelRemoveConfirm(interaction, rawValue);
                return;
            }
            if (customId.startsWith('panel_remove_all_confirm_')) {
                const rawValue = customId.replace('panel_remove_all_confirm_', '');
                await this._handlePanelRemoveConfirm(interaction, rawValue, { resetAllAchievements: true });
                return;
            }
            if (customId === 'panel_unblock') {
                await this._handlePanelUnblock(interaction);
                return;
            }
            if (customId === 'panel_block') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBlock(interaction);
                return;
            }
            if (customId.startsWith('panel_block_time_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                // panel_block_time_{userId}_{guildId}
                const parts = customId.replace('panel_block_time_', '').split('_');
                // userId to 18 cyfr, guildId to 18 cyfr
                const targetUserId = parts[0];
                const targetGuildId = parts[1];
                await this._handlePanelBlockTimeModal(interaction, targetUserId, targetGuildId);
                return;
            }
            if (customId === 'panel_tokens') {
                await this._handlePanelTokens(interaction);
                return;
            }
            if (customId === 'panel_info') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const prefill = this._infoSessions.get(interaction.user.id) || {};
                await interaction.showModal(this._buildInfoModal(prefill, interaction.guildId));
                return;
            }
            if (customId === 'panel_tester') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTester(interaction);
                return;
            }
            if (customId === 'panel_tester_add') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTesterAdd(interaction);
                return;
            }
            if (customId === 'panel_tester_remove') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTesterRemove(interaction);
                return;
            }
            if (customId === 'panel_ach_del') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDel(interaction);
                return;
            }
            if (customId.startsWith('panel_ach_ok_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelConfirm(interaction, customId.replace('panel_ach_ok_', ''));
                return;
            }
            if (customId === 'panel_ocr') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelOcr(interaction);
                return;
            }
            if (customId === 'panel_ocr_manage') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._openPanelOcrModal(interaction);
                return;
            }
            if (customId.startsWith('panel_ocr_en_') || customId.startsWith('panel_ocr_dis_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelOcrAction(interaction, customId);
                return;
            }
            if (customId === 'panel_limit') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const msgs = this.msgs(interaction.guildId);
                const currentLimit = this.usageLimitService.getLimit();
                const currentCooldownMs = this.updateCooldownService.getCooldownDuration();
                const { formatCooldownDuration } = require('../services/updateCooldownService');
                const currentCooldownStr = currentCooldownMs ? formatCooldownDuration(currentCooldownMs) : '';
                const modal = new ModalBuilder().setCustomId('limit_modal').setTitle(msgs.limitModalTitle);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('limit_value').setLabel(msgs.limitModalLabel)
                            .setStyle(TextInputStyle.Short).setPlaceholder(msgs.limitModalPlaceholder)
                            .setValue(currentLimit !== null ? String(currentLimit) : '').setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cooldown_value').setLabel(msgs.limitCooldownLabel)
                            .setStyle(TextInputStyle.Short).setPlaceholder(msgs.limitCooldownPlaceholder)
                            .setValue(currentCooldownStr).setRequired(false)
                    )
                );
                await interaction.showModal(modal);
                return;
            }

            if (customId === 'panel_top10_interval') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const cfg = this.globalTop10Service.getConfig();
                const currentVal = cfg.nextTrigger
                    ? (() => {
                        const d = new Date(cfg.nextTrigger);
                        return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
                    })()
                    : '';
                const t = this._panelT(interaction.guildId);
                const modal = new ModalBuilder()
                    .setCustomId('top10_interval_modal')
                    .setTitle(t('📅 Interwał TOP10 globalnego', '📅 Global TOP10 Interval'));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('top10_first_trigger')
                            .setLabel(t('Data i godzina pierwszego raportu', 'Date and time of first report'))
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('DD.MM.RRRR GG:MM  np. 10.05.2026 20:00')
                            .setValue(currentVal)
                            .setRequired(false)
                            .setMaxLength(20)
                    )
                );
                await interaction.showModal(modal);
                return;
            }

            if (customId === 'panel_unconfigured') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelUnconfigured(interaction);
                return;
            }

            if (customId === 'panel_diagnostics') {
                await this._handlePanelDiagnostics(interaction);
                return;
            }

            if (customId === 'panel_ban_server') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBanServer(interaction);
                return;
            }
            if (customId === 'panel_ban_guild') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBanGuild(interaction);
                return;
            }
            if (customId === 'panel_unban_guild') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelUnbanGuild(interaction);
                return;
            }
            if (customId.startsWith('panel_ban_guild_ok_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const guildIdToBan = customId.replace('panel_ban_guild_ok_', '');
                await this._handlePanelBanGuildConfirm(interaction, guildIdToBan);
                return;
            }

            // === Przyciski wizarda /configure ===
            if (customId.startsWith('cfg_step_') || customId === 'cfg_back' || customId === 'cfg_tag_open' ||
                customId === 'cfg_lang_pol' || customId === 'cfg_lang_eng' ||
                customId === 'cfg_roles_start' || customId === 'cfg_roles_skip' || customId === 'cfg_tier_back' || customId === 'cfg_roles_enable' ||
                customId === 'cfg_roles_configure' || customId === 'cfg_roles_assign_back' || customId === 'cfg_roles_back_confirm' || customId === 'cfg_roles_stay' ||
                customId.startsWith('cfg_roles_skip_') || customId.startsWith('cfg_roles_back_') || customId.startsWith('cfg_role_btn_') ||
                /^cfg_tier_\d+$/.test(customId) || customId === 'cfg_tier_reset' || customId === 'cfg_tier_reset_ok' || customId === 'cfg_tier_reset_cancel' ||
                customId === 'cfg_notif_yes' || customId === 'cfg_notif_no' ||
                customId === 'cfg_role_ranking_add' || customId === 'cfg_role_ranking_remove' || customId === 'cfg_role_ranking_skip' ||
                customId === 'cfg_cv_enable' || customId === 'cfg_cv_disable' || customId === 'cfg_cv_threshold' ||
                customId === 'cfg_accept' || customId === 'cfg_cancel') {
                const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                this.logService._gl(interaction.guildId).info(`${this.logService.nickLink(nick, interaction.user.id)} /configure → ${this._describeCfgButton(customId)}`);
                await this._handleConfigureButton(interaction, customId);
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
                case 'ranking_prev':   newPage = Math.max(0, rankingData.currentPage - 1); break;
                case 'ranking_next':   newPage = Math.min(rankingData.totalPages - 1, rankingData.currentPage + 1); break;
                case 'ranking_mypos':  newPage = rankingData.userPage ?? rankingData.currentPage; break;
            }

            rankingData.currentPage = newPage;
            this.rankingService.updateActiveRanking(interaction.message.id, rankingData);

            const btnOptions = {
                userPage: rankingData.userPage ?? null,
                mode: rankingData.mode,
                guildId: rankingData.guildId || null,
                guildName: rankingData.guildName || null,
                parentGuildId: rankingData.parentGuildId || null,
                parentGuildName: rankingData.parentGuildName || null
            };

            let embed;
            if (rankingData.mode === 'guild_ranking') {
                embed = this.rankingService.createGuildRankingEmbed(
                    rankingData.guildScores, newPage, rankingData.totalPages, msgs,
                    interaction.client.user?.displayAvatarURL({ size: 128 }),
                    rankingData.callerGuildId || null
                );
            } else {
                // Re-fetch fresh player data for server and global modes so pagination
                // always shows up-to-date scores after a new record is submitted.
                // Role mode keeps cached data (member-fetch is expensive and role list rarely changes).
                let players = rankingData.players;
                if (rankingData.mode === 'server' && rankingData.guildId) {
                    players = await this.rankingService.getSortedPlayers(rankingData.guildId);
                } else if (rankingData.mode === 'global') {
                    players = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
                }

                // Re-calculate totalPages in case the player count changed, clamp current page.
                const perPage = this.config.ranking.playersPerPage;
                const freshTotalPages = Math.max(1, Math.ceil(players.length / perPage));
                if (freshTotalPages !== rankingData.totalPages) {
                    rankingData.totalPages = freshTotalPages;
                    newPage = Math.min(newPage, freshTotalPages - 1);
                    rankingData.currentPage = newPage;
                }
                rankingData.players = players;
                this.rankingService.updateActiveRanking(interaction.message.id, rankingData);

                const guild = (rankingData.mode === 'server' || rankingData.mode === 'role')
                    ? (interaction.client.guilds.cache.get(rankingData.guildId) || interaction.guild)
                    : null;
                embed = await this.rankingService.createRankingEmbed(
                    players, newPage, rankingData.totalPages, rankingData.userId, guild,
                    {
                        mode: rankingData.mode,
                        client: rankingData.mode === 'global' ? interaction.client : null,
                        messages: msgs,
                        callerStats: rankingData.callerStats || null
                    }
                );
            }

            const buttons = this.rankingService.createRankingButtons(
                newPage, rankingData.totalPages, false, msgs, rankingData.roleRows || [], btnOptions
            );

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

    // =====================================================================
    // Community Verification — obsługa głosowania i akcji admina
    // =====================================================================

    async _handleCvVote(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!this.communityVerificationService) {
            await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] });
            return;
        }

        const messageId = interaction.customId.replace('cv_vote_', '');
        const session = this.communityVerificationService.getSession(messageId);

        if (!session || session.status !== 'pending') {
            await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] });
            return;
        }

        const voterId = interaction.user.id;

        if (session.userId === voterId) {
            await interaction.reply({ content: msgs.cvVoteSelf, flags: ['Ephemeral'] });
            return;
        }

        // Sprawdź czy głosujący jest w rankingu
        const inRanking = await this.communityVerificationService.isVoterInRanking(
            this.rankingService, session.guildId, voterId
        );
        if (!inRanking) {
            await interaction.reply({ content: msgs.cvVoteNotInRanking, flags: ['Ephemeral'] });
            return;
        }

        const result = await this.communityVerificationService.registerVote(messageId, voterId);

        if (result.invalid) {
            await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] });
            return;
        }
        if (result.alreadyVoted) {
            await interaction.reply({ content: msgs.cvVoteAlreadyVoted, flags: ['Ephemeral'] });
            return;
        }

        const cvCfg = this.guildConfigService?.getCommunityVerification(session.guildId);
        const threshold = cvCfg?.threshold || 5;
        const count = result.count;

        // Zaktualizuj etykietę przycisku na wiadomości
        try {
            const voteBtn = new ButtonBuilder()
                .setCustomId(`cv_vote_${messageId}`)
                .setLabel(msgs.cvVoteButton)
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({ components: [new ActionRowBuilder().addComponents(voteBtn)] });
        } catch {
            await interaction.reply({ content: msgs.cvVoteRegistered.replace('{count}', count).replace('{threshold}', threshold), flags: ['Ephemeral'] }).catch(() => {});
        }

        // Sprawdź czy próg osiągnięty
        if (count >= threshold) {
            await this._triggerCvReport(interaction.client, session, messageId);
        }
    }

    async _triggerCvReport(client, session, messageId) {
        try {
            // Zablokuj użytkownika na 24h
            if (this.userBlockService) {
                await this.userBlockService.blockUser(
                    session.userId, 'unknown', session.guildId, 'unknown', '24h', false
                );
            }

            // Zablokuj przycisk Zgłoś na oryginalnej wiadomości (disabled z licznikiem)
            try {
                const ch = await client.channels.fetch(session.channelId).catch(() => null);
                if (ch) {
                    const orig = await ch.messages.fetch(messageId).catch(() => null);
                    if (orig) {
                        const cvMsgs = this.msgs(session.guildId);
                        const disabledBtn = new ButtonBuilder()
                            .setCustomId(`cv_vote_${messageId}`)
                            .setLabel(cvMsgs.cvReported || '⚠️ Reported')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true);
                        await orig.edit({ components: [new ActionRowBuilder().addComponents(disabledBtn)] }).catch(() => {});
                    }
                }
            } catch {}

            // Zbuduj embed raportu (jeden dla obu kanałów)
            const sourceGuild = client.guilds.cache.get(session.guildId);
            const targetUser = await client.users.fetch(session.userId).catch(() => null);
            const msgs = this.config.getMessages(session.guildId);

            const cvGuildConfig = this.config.getGuildConfig(session.guildId);
            const cvGuildTag = cvGuildConfig?.tag || null;
            const cvGuildIcon = sourceGuild?.iconURL({ dynamic: true, size: 64 }) || cvGuildConfig?.icon || null;
            const cvAuthorName = cvGuildTag ? `${cvGuildTag}  ${sourceGuild?.name || session.guildId}` : (sourceGuild?.name || session.guildId);
            const cvUserAvatar = targetUser?.displayAvatarURL({ dynamic: true, size: 64 }) || cvGuildIcon || null;

            const reportEmbed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle(msgs.cvReportTitle)
                .setAuthor({ name: cvAuthorName, iconURL: cvGuildIcon || undefined })
                .setThumbnail(cvUserAvatar || undefined)
                .addFields(
                    { name: msgs.cvReportFieldUser, value: targetUser ? `[${targetUser.username}](https://discord.com/users/${session.userId})` : `<@${session.userId}>`, inline: true },
                    { name: msgs.cvReportFieldBoss, value: session.newRecord?.bossName || '—', inline: true },
                    { name: msgs.cvReportFieldScore, value: session.newRecord?.score || '—', inline: true },
                    { name: msgs.cvReportFieldPrev, value: session.previousRecord?.score || '—', inline: true },
                    { name: msgs.cvReportFieldVotes, value: String(session.count), inline: true },
                    { name: msgs.cvReportFieldLink, value: session.messageUrl || '—', inline: false },
                )
                .setTimestamp()
                .setFooter({ text: `cv:${messageId}|uid:${session.userId}|gid:${session.guildId}` });

            const approveBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_approve_${messageId}`)
                .setLabel(msgs.cvReportBtnApprove)
                .setStyle(ButtonStyle.Success);
            const removeBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_remove_${messageId}`)
                .setLabel(msgs.cvReportBtnRemove)
                .setStyle(ButtonStyle.Danger);
            const blockBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_block_${messageId}`)
                .setLabel(msgs.cvReportBtnBlock)
                .setStyle(ButtonStyle.Danger);
            const components = [new ActionRowBuilder().addComponents(approveBtn, removeBtn, blockBtn)];

            const rejectedMsgIds = [];

            // Wyślij na per-guild kanał
            const cvCfg = this.guildConfigService?.getCommunityVerification(session.guildId);
            if (cvCfg?.rejectedChannelId) {
                try {
                    const guildCh = await client.channels.fetch(cvCfg.rejectedChannelId).catch(() => null);
                    if (guildCh) {
                        const sent = await guildCh.send({ embeds: [reportEmbed], components });
                        rejectedMsgIds.push(`guild:${cvCfg.rejectedChannelId}:${sent.id}`);
                    }
                } catch (e) {
                    logger.warn(`⚠️ CV: błąd wysyłania raportu na per-guild channel: ${e.message}`);
                    if (e.code === 50001 || e.code === 50013) {
                        await this._dmPermissionAlert(client, session.guildId, {
                            channelId: cvCfg.rejectedChannelId,
                            missingPerms: e.code === 50001 ? ['ViewChannel'] : ['SendMessages', 'EmbedLinks'],
                            context: { pol: 'Kanał zgłoszeń weryfikacji społeczności (CV)', eng: 'Community verification reports channel (CV)' },
                        });
                    }
                }
            }

            // Wyślij na globalny kanał zgłoszeń społeczności (head admin)
            // Pomijamy jeśli to ten sam kanał co per-guild (żeby nie duplikować)
            const globalCvChannelId = this.config.communityReportChannelId;
            const skipGlobal = globalCvChannelId && cvCfg?.rejectedChannelId && globalCvChannelId === cvCfg.rejectedChannelId;
            if (globalCvChannelId && !skipGlobal) {
                try {
                    const globalCh = await client.channels.fetch(globalCvChannelId).catch(() => null);
                    if (globalCh) {
                        const sent = await globalCh.send({ embeds: [reportEmbed], components });
                        rejectedMsgIds.push(`global:${globalCvChannelId}:${sent.id}`);
                    }
                } catch (e) {
                    logger.warn(`⚠️ CV: błąd wysyłania raportu na globalny channel: ${e.message}`);
                }
            }

            await this.communityVerificationService.markTriggered(messageId, rejectedMsgIds);
            logger.info(`🚨 CV: zgłoszenie wysłane dla "${targetUser?.username || session.userId}" na serwerze "${sourceGuild?.name || session.guildId}" (${session.count} głosów)`);
        } catch (err) {
            logger.error(`CV _triggerCvReport error: ${err.message}`);
        }
    }

    async _handleCvAdmin(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator') && !this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }
        if (!this.communityVerificationService) {
            await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] });
            return;
        }

        // cv_admin_{action}_{messageId}
        const withoutPrefix = interaction.customId.replace('cv_admin_', '');
        const firstUnderscore = withoutPrefix.indexOf('_');
        const action = withoutPrefix.substring(0, firstUnderscore);
        const messageId = withoutPrefix.substring(firstUnderscore + 1);

        const session = this.communityVerificationService.getSession(messageId);
        if (!session || (session.status !== 'triggered' && session.status !== 'pending')) {
            await interaction.deferUpdate().catch(() => {});
            await interaction.editReply({ embeds: interaction.message.embeds, components: [] }).catch(() => {});
            return;
        }

        await interaction.deferUpdate();
        const adminName = interaction.member?.displayName || interaction.user.username;

        if (action === 'approve') {
            if (this.userBlockService) {
                await this.userBlockService.unblockUser(session.userId, this._isHeadAdmin(interaction.user.id)).catch(() => {});
            }
            await this.communityVerificationService.closeSession(messageId, 'approved');
            await this._updateOriginalRecordButton(interaction.client, session, 'approved');
            await this._updateAllCvReportMsgs(interaction.client, session,
                msgs.cvAdminApproved.replace('{adminName}', adminName), []);
            if (this.achievementService) {
                this.achievementService.trackCvApproved(session.guildId, session.userId).catch(() => {});
            }

        } else if (action === 'remove') {
            await this._cvRemoveRecord(session);
            await this.communityVerificationService.closeSession(messageId, 'removed');
            if (this.userBlockService) {
                await this.userBlockService.unblockUser(session.userId, true).catch(() => {});
            }
            await this._updateOriginalRecordButton(interaction.client, session, 'removed');
            await this._updateAllCvReportMsgs(interaction.client, session,
                msgs.cvAdminRemoved.replace('{adminName}', adminName), []);

        } else if (action === 'block') {
            if (this.userBlockService) {
                await this.userBlockService.blockUser(
                    session.userId, 'unknown', session.guildId, 'unknown', '', true
                );
            }
            await this._cvRemoveRecord(session);
            await this.communityVerificationService.closeSession(messageId, 'blocked');
            await this._updateOriginalRecordButton(interaction.client, session, 'blocked');
            await this._updateAllCvReportMsgs(interaction.client, session,
                msgs.cvAdminBlocked.replace('{adminName}', adminName), []);
        }
    }

    async _updateOriginalRecordButton(client, session, action) {
        try {
            const ch = await client.channels.fetch(session.channelId).catch(() => null);
            if (!ch) return;
            const msg = await ch.messages.fetch(session.messageId).catch(() => null);
            if (!msg) return;

            const sourceMsgs = this.config.getMessages(session.guildId);
            let label, style;
            if (action === 'approved') {
                label = sourceMsgs.cvBtnStatusApproved;
                style = ButtonStyle.Success;
            } else {
                label = sourceMsgs.cvBtnStatusRemoved;
                style = ButtonStyle.Danger;
            }

            const doneBtn = new ButtonBuilder()
                .setCustomId(`cv_done_${session.messageId}`)
                .setLabel(label)
                .setStyle(style)
                .setDisabled(true);

            await msg.edit({ components: [new ActionRowBuilder().addComponents(doneBtn)] }).catch(() => {});
        } catch (e) {
            logger.warn(`CV _updateOriginalRecordButton error: ${e.message}`);
        }
    }

    async _cvRemoveRecord(session) {
        // Cofaj ranking do stanu sprzed zgłoszenia (ignoruje rekordy B, C pobite po A)
        try {
            await this.rankingService.revertUserRecord(
                session.guildId, session.userId, session.previousRecord
            );
        } catch (e) {
            logger.error(`CV _cvRemoveRecord revert ranking error: ${e.message}`);
        }
        // Usuń wszystkie wpisy historii od momentu zgłoszonego rekordu (A + B + C + ...)
        if (this.scoreHistoryService && session.newRecord?.timestamp) {
            this.scoreHistoryService.removeEntriesAfter(
                session.guildId, session.userId, session.newRecord.timestamp
            ).catch(e => logger.error(`CV _cvRemoveRecord revert history error: ${e.message}`));
        }
        // Wyczyść osiągnięcia score/records — kolejne rekordy po A też mogły odblokować nowe
        try {
            if (this.achievementService) {
                await this.achievementService.clearUserAchievements(
                    session.guildId, session.userId
                );
            }
        } catch (e) {
            logger.error(`CV _cvRemoveRecord revert achievements error: ${e.message}`);
        }
    }

    async _updateAllCvReportMsgs(client, session, statusText, newComponents) {
        for (const ref of (session.rejectedMsgIds || [])) {
            try {
                // format: "guild:{channelId}:{msgId}" lub "global:{channelId}:{msgId}"
                const parts = ref.split(':');
                const channelId = parts[1];
                const msgId = parts[2];
                const ch = await client.channels.fetch(channelId).catch(() => null);
                if (!ch) continue;
                const msg = await ch.messages.fetch(msgId).catch(() => null);
                if (!msg) continue;
                const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
                    .addFields({ name: '─', value: statusText, inline: false });
                await msg.edit({ embeds: [updatedEmbed], components: newComponents }).catch(() => {});
            } catch {}
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
                players = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
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
                const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
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

            // Strona użytkownika w bieżącym rankingu (dla przycisku "Moja pozycja")
            const callerIdx = players.findIndex(p => p.userId === interaction.user.id);
            const userPage = callerIdx !== -1
                ? Math.floor(callerIdx / this.config.ranking.playersPerPage)
                : null;

            // Nazwa serwera dla przycisków
            const guildName = guild?.name || null;

            // parentGuildId: serwer do którego wraca button5 w trybie global
            // Gdy wchodzimy w global — poprzedni stan miał wybrany serwer (mode=server)
            const prevData = this.rankingService.getActiveRanking(interaction.message.id);
            let parentGuildId = null;
            let parentGuildName = null;
            if (mode === 'global') {
                // Poprzedni widok był serwerem — zapamiętaj który
                if (prevData?.mode === 'server' && prevData.guildId) {
                    parentGuildId = prevData.guildId;
                    parentGuildName = prevData.guildName || null;
                } else if (prevData?.mode === 'guild_ranking') {
                    // Wracamy z guild_ranking do global — zachowaj parentGuildId
                    parentGuildId = prevData.parentGuildId || null;
                    parentGuildName = prevData.parentGuildName || null;
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
            const buttons = this.rankingService.createRankingButtons(
                currentPage, totalPages, false, rankMsgs, roleRows,
                { userPage, mode, guildId, guildName, parentGuildId, parentGuildName }
            );

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
                guildName,
                parentGuildId,
                parentGuildName,
                callerStats,
                roleRows,
                userPage
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
        const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs, interaction.guildId, 0);
        await interaction.editReply({
            content: msgs.rankingSelectPrompt,
            embeds: [],
            components: selectRows
        });
    }

    async _handleRankingSrvPage(interaction, customId) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const isPrev = customId.startsWith('ranking_srv_prev_');
        const withoutPrefix = customId.replace(isPrev ? 'ranking_srv_prev_' : 'ranking_srv_next_', '');
        const underscoreIdx = withoutPrefix.indexOf('_');
        const currentPage = parseInt(withoutPrefix.substring(0, underscoreIdx)) || 0;
        const homeGuildId = withoutPrefix.substring(underscoreIdx + 1) || interaction.guildId;
        const newPage = isPrev ? currentPage - 1 : currentPage + 1;
        const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs, homeGuildId, newPage);
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
            const guildName = guild.name;

            // Przyciski ról — aktywna rola wyłączona
            const roleRows = roleRankings.length > 0
                ? this.rankingService.createRoleRankingButtons(roleRankings, guildId, roleId)
                : [];

            const players = await this.rankingService.getSortedPlayersByRole(guildId, roleId, guild, this.roleRankingConfigService);

            // Strona z wynikiem użytkownika w rankingu roli
            const callerIdx = players.findIndex(p => p.userId === parentUserId);
            const userPage = callerIdx !== -1
                ? Math.floor(callerIdx / this.config.ranking.playersPerPage)
                : null;

            const btnOptions = { userPage, mode: 'role', guildId, guildName };

            if (players.length === 0) {
                const emptyButtons = this.rankingService.createRankingButtons(0, 1, false, msgs, roleRows, btnOptions);
                await interaction.editReply({
                    content: formatMessage(msgs.roleRankingEmpty, { roleName }),
                    embeds: [],
                    components: emptyButtons
                });
                const reply = await interaction.fetchReply();
                this.rankingService.addActiveRanking(reply.id, {
                    players: [], currentPage: 0, totalPages: 1,
                    userId: parentUserId, messageId: reply.id,
                    mode: 'role', guildId, parentGuildId: guildId, roleId,
                    guildName, callerStats: parentCallerStats, roleRows, userPage: null
                });
                return;
            }

            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);

            const embed = await this.rankingService.createRankingEmbed(
                players, 0, totalPages, parentUserId, guild,
                { mode: 'server', client: null, messages: msgs, callerStats: parentCallerStats, titleOverride: `🎖️ Ranking roli: ${roleName}` }
            );
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, roleRows, btnOptions);

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons });
            this.rankingService.addActiveRanking(reply.id, {
                players, currentPage: 0, totalPages,
                userId: parentUserId, messageId: reply.id,
                mode: 'role', guildId, parentGuildId: guildId, roleId,
                guildName, callerStats: parentCallerStats, roleRows, userPage
            });

        } catch (err) {
            logger.error('Błąd w _handleRoleRankingSelect:', err);
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
        }
    }

    /**
     * Obsługuje kliknięcie przycisku "Ranking Serwerów" — tryb guild_ranking.
     */
    async _handleGuildRankingSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);

        // Pobierz poprzedni stan — potrzebny parentGuildId
        const prevData = this.rankingService.getActiveRanking(interaction.message.id);
        const parentGuildId = prevData?.parentGuildId || prevData?.guildId || null;
        const parentGuildName = prevData?.parentGuildName || prevData?.guildName || null;

        try {
            const guildScores = await this.rankingService.getGuildRanking(interaction.client);

            if (guildScores.length === 0) {
                await interaction.editReply({ content: msgs.rankingEmpty, embeds: [], components: [] });
                return;
            }

            const perPage = this.config.ranking.playersPerPage;
            const totalPages = Math.max(1, Math.ceil(guildScores.length / perPage));

            const callerGuildId = interaction.guildId;
            const callerIdx = guildScores.findIndex(gs => gs.guildId === callerGuildId);
            const userPage = callerIdx >= 0 ? Math.floor(callerIdx / perPage) : null;

            const embed = this.rankingService.createGuildRankingEmbed(guildScores, 0, totalPages, msgs,
                interaction.client.user?.displayAvatarURL({ size: 128 }), callerGuildId);
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, [], {
                userPage,
                mode: 'guild_ranking',
                guildId: null,
                guildName: null,
                parentGuildId,
                parentGuildName
            });

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons });
            this.rankingService.addActiveRanking(reply.id, {
                guildScores,
                players: [],
                currentPage: 0,
                totalPages,
                userId: interaction.user.id,
                messageId: reply.id,
                mode: 'guild_ranking',
                guildId: null,
                guildName: null,
                parentGuildId,
                parentGuildName,
                callerGuildId,
                callerStats: null,
                roleRows: [],
                userPage
            });

        } catch (err) {
            logger.error('Błąd w _handleGuildRankingSelect:', err);
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
        }
    }

    /** Obsługuje wybór roli do dodania rankingu w /configure krok 7 */
    async _handleCfgRoleRankingAddSelect(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) {
            await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] });
            return;
        }
        const guildId = interaction.guildId;
        const roleId = interaction.values[0];
        const role = interaction.guild.roles.cache.get(roleId);
        const roleName = role?.name || roleId;
        const MAX = 10;

        const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);
        const msgs = this.msgs(guildId);
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        if (existing.length >= MAX) {
            const errEmbed = new EmbedBuilder().setColor(0xFF0000)
                .setDescription(`❌ ${formatMessage(msgs.roleRankingLimitReached, { max: MAX })}`);
            const backBtn = new ButtonBuilder().setCustomId('cfg_step_7').setLabel(t('← Powrót', '← Back')).setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [errEmbed], components: [new ActionRowBuilder().addComponents(backBtn)] });
            return;
        }

        const result = await this.roleRankingConfigService.addRoleRanking(guildId, roleId, roleName);

        if (!result.ok) {
            const errMsg = result.reason === 'limit'
                ? formatMessage(msgs.roleRankingLimitReached, { max: MAX })
                : t(`⚠️ Ranking dla roli **${roleName}** już istnieje.`, `⚠️ A ranking for role **${roleName}** already exists.`);
            const errEmbed = new EmbedBuilder().setColor(0xFF0000).setDescription(errMsg);
            const backBtn = new ButtonBuilder().setCustomId('cfg_step_7').setLabel(t('← Powrót', '← Back')).setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [errEmbed], components: [new ActionRowBuilder().addComponents(backBtn)] });
            return;
        }

        state.roleRankingsDone = true;
        const afterAdd = await this.roleRankingConfigService.loadRoleRankings(guildId);
        state.roleRankingsCount = afterAdd.length;
        this._configWizard.set(key, state);
        await this._showConfigureStep(interaction, 7);
    }

    /** Obsługuje wybór roli do usunięcia rankingu w /configure krok 7 */
    async _handleCfgRoleRankingRemoveSelect(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) {
            await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] });
            return;
        }
        const roleId = interaction.values[0];
        const guildId = interaction.guildId;

        const existing = await this.roleRankingConfigService.loadRoleRankings(guildId);
        const roleCfg = existing.find(r => r.roleId === roleId);
        const roleName = roleCfg?.roleName || roleId;

        await this.roleRankingConfigService.removeRoleRanking(guildId, roleId);
        const afterRemove = await this.roleRankingConfigService.loadRoleRankings(guildId);
        state.roleRankingsCount = afterRemove.length;
        this._configWizard.set(key, state);
        await this._showConfigureStep(interaction, 7);
    }

    /**
     * Obsługuje komendę /notifications
     */
    // =====================================================================
    // /achievements
    // =====================================================================

    async _resolveAchGuildId(userId, guildId, client) {
        const ranking = await this.rankingService.loadRanking(guildId);
        if (ranking[userId]) return { achGuildId: guildId, crossServerGuildName: null };
        const allGuildIds = new Set(
            this.config.getAllGuilds()
                .filter(g => client.guilds.cache.has(g.id))
                .map(g => g.id)
        );
        const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
        const entry = globalRanking.find(p => p.userId === userId);
        if (!entry) return { achGuildId: guildId, crossServerGuildName: null };
        const crossServerGuildName = client.guilds.cache.get(entry.sourceGuildId)?.name || entry.sourceGuildId;
        return { achGuildId: entry.sourceGuildId, crossServerGuildName };
    }

    async handleAchievementsCommand(interaction) {
        if (!this._checkConfigured(interaction)) return;
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const lang = this.config.getGuildConfig(guildId)?.lang || 'pol';
            const { achGuildId, crossServerGuildName } = await this._resolveAchGuildId(userId, guildId, interaction.client);
            const { embed, components } = await this.achievementService.buildAchievementsView(
                achGuildId, userId, lang, 'overview', null, crossServerGuildName
            );
            await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd /achievements: ${err.message}`);
            await interaction.editReply({ content: this.msgs(interaction.guildId).generalError });
        }
    }

    async _handleAchievementsButton(interaction, customId) {
        // customId: ach_cat_{category} | ach_overview
        await interaction.deferUpdate();
        try {
            const isOverview = customId === 'ach_overview';
            const view = isOverview ? 'overview' : 'cat';
            const category = isOverview ? null : customId.replace('ach_cat_', '');
            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const lang = this.config.getGuildConfig(guildId)?.lang || 'pol';
            const { achGuildId, crossServerGuildName } = await this._resolveAchGuildId(userId, guildId, interaction.client);
            const { embed, components } = await this.achievementService.buildAchievementsView(
                achGuildId, userId, lang, view, category, isOverview ? crossServerGuildName : null
            );
            await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd przycisku osiągnięć: ${err.message}`);
        }
    }

    async handleNotificationsCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notif_set')
                .setEmoji('🔔')
                .setLabel(msgs.notifSetButton)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('notif_remove')
                .setEmoji('🔕')
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

            if (customId === 'ach_check_sel') {
                await this._handleAchCheckSelect(interaction);
                return;
            }

            if (customId === 'panel_remove_select') {
                await this._handlePanelRemoveSelect(interaction);
                return;
            }

            if (customId === 'panel_unblock_select') {
                const msgs = this.msgs(interaction.guildId);
                const t = this._panelT(interaction.guildId);
                const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
                const targetUserId = interaction.values[0];
                const entry = (await this.userBlockService.getBlockedUsers()).find(e => e.userId === targetUserId);
                // Admin może odblokować tylko graczy ze swojego serwera
                if (!isHeadAdmin && entry?.guildId !== interaction.guildId) {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xFF8C00)
                            .setTitle(t('⛔ Brak uprawnień', '⛔ No Permission'))
                            .setDescription(t(
                                `**${entry?.username || targetUserId}** pochodzi z innego serwera.\nMożesz odblokować tylko graczy zablokowanych na tym serwerze.`,
                                `**${entry?.username || targetUserId}** is from a different server.\nYou can only unblock players blocked on this server.`
                            ))],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                        )]
                    });
                    return;
                }
                // Admin nie może odblokować gracza zablokowanego przez Head Admina
                if (entry?.blockedByHeadAdmin && !isHeadAdmin) {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xFF8C00)
                            .setTitle(t('⛔ Brak uprawnień', '⛔ No Permission'))
                            .setDescription(t(
                                `**${entry.username}** został zablokowany przez Head Admina.\nTylko Head Admin może go odblokować.`,
                                `**${entry.username}** was blocked by a Head Admin.\nOnly a Head Admin can unblock them.`
                            ))],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                        )]
                    });
                    return;
                }
                const success = await this.userBlockService.unblockUser(targetUserId, isHeadAdmin);
                const username = entry?.username || targetUserId;
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(success === true ? 0x57F287 : 0xFF4444)
                        .setTitle(success === true ? t('✅ Odblokowano', '✅ Unblocked') : t('⚠️ Nie znaleziono', '⚠️ Not Found'))
                        .setDescription(success === true ? formatMessage(msgs.unblockSuccess, { username }) : msgs.unblockNotFound)],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                    )]
                });
                return;
            }

            if (customId === 'panel_block_select') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBlockSelect(interaction);
                return;
            }

            if (customId === 'panel_ocr_guild_select') {
                await this._handlePanelOcrGuildSelect(interaction);
                return;
            }
            if (customId === 'panel_ban_guild_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBanGuildSelect(interaction);
                return;
            }
            if (customId === 'panel_unban_guild_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelUnbanGuildSelect(interaction);
                return;
            }

            if (customId === 'panel_tester_remove_select') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTesterRemoveSelect(interaction);
                return;
            }

            if (customId === 'panel_ach_del_ps') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelPlayerSelect(interaction);
                return;
            }

            if (customId === 'panel_ach_del_as') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelAchSelect(interaction);
                return;
            }

            if (customId === 'ee_unblock_select') {
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
                const targetUserId = interaction.values[0];
                const entry = (await this.userBlockService.getBlockedUsers()).find(e => e.userId === targetUserId);
                if (entry?.blockedByHeadAdmin && !isHeadAdmin) {
                    const tUB = this._panelT(interaction.guildId);
                    await interaction.update({
                        content: tUB(
                            `⛔ **${entry.username}** został zablokowany przez Head Admina. Tylko Head Admin może go odblokować.`,
                            `⛔ **${entry.username}** was blocked by the Head Admin. Only the Head Admin can unblock them.`
                        ),
                        embeds: [],
                        components: []
                    });
                    return;
                }
                const success = await this.userBlockService.unblockUser(targetUserId, isHeadAdmin);
                const username = entry?.username || targetUserId;
                await interaction.update({
                    content: success === true ? formatMessage(msgs.unblockSuccess, { username }) : msgs.unblockNotFound,
                    embeds: [],
                    components: []
                });
                return;
            }

            if (customId === 'cfg_role_ranking_add_select') {
                await this._handleCfgRoleRankingAddSelect(interaction);
                return;
            }

            if (customId === 'cfg_role_ranking_remove_select') {
                await this._handleCfgRoleRankingRemoveSelect(interaction);
                return;
            }

            if (customId.startsWith('cfg_roles_sel_')) {
                await this._handleTopRoleSelect(interaction);
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
        const options = this.config.getAllGuilds().map(g => {
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
                .setEmoji('✅')
                .setLabel(msgs.notifConfirmYes)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('notif_cancel')
                .setEmoji('❌')
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
        // Śledź subskrypcję dla osiągnięć (fire-and-forget)
        if (this.achievementService) {
            this.achievementService.trackSubscription(interaction.guildId, interaction.user.id).catch(() => {});
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
    _buildInfoModal(prefill = {}, guildId = null) {
        const tM = guildId ? this._panelT(guildId) : (p, _e) => p;
        const titleInput = new TextInputBuilder()
            .setCustomId('embedTitle')
            .setLabel(tM('Tytuł (opcjonalnie)', 'Title (optional)'))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(tM('Tytuł wiadomości', 'Message title'))
            .setRequired(false)
            .setMaxLength(256);
        if (prefill.title) titleInput.setValue(prefill.title);

        const descPolInput = new TextInputBuilder()
            .setCustomId('embedDescriptionPol')
            .setLabel('Opis (serwery polskie)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Treść wiadomości po polsku...')
            .setRequired(true)
            .setMaxLength(4000);
        if (prefill.descriptionPol) descPolInput.setValue(prefill.descriptionPol);

        const descEngInput = new TextInputBuilder()
            .setCustomId('embedDescriptionEng')
            .setLabel('Description (English servers)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Message content in English...')
            .setRequired(true)
            .setMaxLength(4000);
        if (prefill.descriptionEng) descEngInput.setValue(prefill.descriptionEng);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel(tM('Ikona URL (opcjonalnie)', 'Icon URL (optional)'))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        if (prefill.icon) iconInput.setValue(prefill.icon);

        const imageInput = new TextInputBuilder()
            .setCustomId('embedImage')
            .setLabel(tM('Obraz URL (opcjonalnie)', 'Image URL (optional)'))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        if (prefill.image) imageInput.setValue(prefill.image);

        return new ModalBuilder()
            .setCustomId('info_modal')
            .setTitle(tM('Nowa wiadomość informacyjna', 'New Info Message'))
            .addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descPolInput),
                new ActionRowBuilder().addComponents(descEngInput),
                new ActionRowBuilder().addComponents(iconInput),
                new ActionRowBuilder().addComponents(imageInput)
            );
    }

    /**
     * Buduje czerwony embed na podstawie danych sesji.
     * @param {{ title?: string, descriptionPol: string, descriptionEng: string, icon?: string, image?: string }} data
     * @param {User} user
     * @param {string} description - konkretna treść do wstawienia (pol lub eng)
     */
    _buildInfoEmbed(data, user, description) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription(description)
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
        if (!this.config.blockOcrUserIds.includes(interaction.user.id)) {
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }
        const prefill = this._infoSessions.get(interaction.user.id) || {};
        await interaction.showModal(this._buildInfoModal(prefill, interaction.guildId));
    }

    /**
     * Obsługuje submit modala /info — zapisuje dane, pokazuje podgląd z przyciskami.
     */
    _setInfoSession(userId, data) {
        if (this._infoSessionTimers.has(userId)) clearTimeout(this._infoSessionTimers.get(userId));
        this._infoSessions.set(userId, data);
        const timer = setTimeout(() => {
            this._infoSessions.delete(userId);
            this._infoSessionTimers.delete(userId);
        }, 15 * 60 * 1000);
        this._infoSessionTimers.set(userId, timer);
    }

    _clearInfoSession(userId) {
        if (this._infoSessionTimers.has(userId)) {
            clearTimeout(this._infoSessionTimers.get(userId));
            this._infoSessionTimers.delete(userId);
        }
        this._infoSessions.delete(userId);
    }

    async _handleInfoModalSubmit(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!this.config.blockOcrUserIds.includes(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        const title = interaction.fields.getTextInputValue('embedTitle').trim() || null;
        const descriptionPol = interaction.fields.getTextInputValue('embedDescriptionPol').trim();
        const descriptionEng = interaction.fields.getTextInputValue('embedDescriptionEng').trim();
        const icon = interaction.fields.getTextInputValue('embedIcon').trim() || null;
        const image = interaction.fields.getTextInputValue('embedImage').trim() || null;

        const data = { title, descriptionPol, descriptionEng, icon, image, user: interaction.user };
        this._setInfoSession(interaction.user.id, data);

        const embedPol = this._buildInfoEmbed(data, interaction.user, descriptionPol);
        const embedEng = this._buildInfoEmbed(data, interaction.user, descriptionEng);
        const tInfo = this._panelT(interaction.guildId);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('info_send').setLabel(tInfo('Wyślij', 'Send')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('info_edit').setLabel(tInfo('Edytuj', 'Edit')).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('info_cancel').setLabel(tInfo('Anuluj', 'Cancel')).setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `${formatMessage(msgs.infoPreview, { count: this.config.getAllGuilds().length })}\n${tInfo('🇵🇱 **Podgląd PL** (powyżej) • 🇬🇧 **Podgląd ENG** (poniżej)', '🇵🇱 **PL Preview** (above) • 🇬🇧 **EN Preview** (below)')}`,
            embeds: [embedPol, embedEng],
            components: [row],
            flags: ['Ephemeral']
        });
    }

    /**
     * Mapuje błąd Discord API na obiekt { pol, eng, fix_pol, fix_eng }.
     */
    _mapSendError(err) {
        const code = err.code;
        const msg = err.message || '';
        if (code === 50001 || msg.includes('Missing Access')) return {
            pol: 'Brak uprawnienia **Wyświetl kanał** — bot nie widzi tego kanału',
            eng: 'Missing **View Channel** permission — bot cannot see this channel',
            fix_pol: 'Wejdź w ustawienia kanału → Uprawnienia i nadaj botowi uprawnienie **Wyświetl kanał**.',
            fix_eng: 'Go to channel settings → Permissions and grant the bot **View Channel**.',
        };
        if (code === 10003 || msg.includes('Unknown Channel')) return {
            pol: 'Kanał nie istnieje lub został usunięty',
            eng: 'Channel does not exist or was deleted',
            fix_pol: 'Użyj `/configure`, aby wybrać nowy kanał dla bota.',
            fix_eng: 'Use `/configure` to select a new channel for the bot.',
        };
        if (code === 50013 || msg.includes('Missing Permissions')) return {
            pol: 'Brak uprawnień **Wyślij wiadomości** lub **Osadzaj linki**',
            eng: 'Missing **Send Messages** or **Embed Links** permission',
            fix_pol: 'Sprawdź uprawnienia bota na tym kanale — wymagane: **Wyślij wiadomości** i **Osadzaj linki**.',
            fix_eng: 'Check bot permissions for this channel — required: **Send Messages** and **Embed Links**.',
        };
        if (code === 50035 || msg.includes('Invalid Form Body')) return {
            pol: 'Nieprawidłowy format wiadomości (embed za długi lub niedozwolone znaki)',
            eng: 'Invalid message format (embed too long or contains invalid characters)',
            fix_pol: 'Skróć treść wiadomości `/info` i spróbuj ponownie.',
            fix_eng: 'Shorten the `/info` message content and try again.',
        };
        if (code === 10004 || msg.includes('Unknown Guild')) return {
            pol: 'Serwer nie istnieje w bazie Discord',
            eng: 'Guild does not exist in Discord',
            fix_pol: 'Zaktualizuj konfigurację bota.',
            fix_eng: 'Update the bot configuration.',
        };
        return {
            pol: msg || 'Nieznany błąd',
            eng: msg || 'Unknown error',
            fix_pol: 'Sprawdź logi bota lub skontaktuj się z administratorem.',
            fix_eng: 'Check bot logs or contact the administrator.',
        };
    }

    /**
     * Wysyła DM do właściciela serwera i osoby która skonfigurowała bota z informacją o błędzie kanału.
     * @param {{ guildObj, label, channelId, error, lang, context: { titlePol, titleEng } }} params
     */
    async _sendChannelErrorDm({ guildObj, label, channelId, error, lang, context }) {
        try {
            const isPol = lang === 'pol';
            const embed = new EmbedBuilder()
                .setColor(0xcc0000)
                .setTitle(isPol ? context.titlePol : context.titleEng)
                .addFields(
                    { name: isPol ? 'Serwer' : 'Server', value: label, inline: true },
                    { name: isPol ? 'Kanał' : 'Channel', value: `<#${channelId}>`, inline: true },
                    { name: isPol ? '❌ Błąd' : '❌ Error', value: isPol ? error.pol : error.eng, inline: false },
                )
                .setTimestamp();
            const fix = isPol ? error.fix_pol : error.fix_eng;
            if (fix) embed.addFields({ name: isPol ? '🔧 Co zrobić' : '🔧 How to fix', value: fix, inline: false });

            const sentTo = new Set();
            const owner = await guildObj.fetchOwner().catch(() => null);
            if (owner) {
                await owner.send({ embeds: [embed] }).catch(() => {});
                sentTo.add(owner.id);
            }

            const configuredById = this.guildConfigService.getConfig(guildObj.id)?.configuredBy?.userId;
            if (configuredById && !sentTo.has(configuredById)) {
                const configAdmin = await guildObj.client.users.fetch(configuredById).catch(() => null);
                if (configAdmin) await configAdmin.send({ embeds: [embed] }).catch(() => {});
            }
        } catch {
            // DM zablokowane lub inny błąd — ignoruj cicho
        }
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

        const results = [];

        for (const guildCfg of this.config.getAllGuilds()) {
            const guildObj = interaction.client.guilds.cache.get(guildCfg.id);
            const guildLabel = guildObj?.name || guildCfg.tag || guildCfg.id;
            const lang = guildCfg.lang || 'pol';

            if (!guildObj) continue;

            try {
                const channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId).catch(() => null);
                if (!channel) {
                    results.push({
                        label: guildLabel, id: guildCfg.id, status: 'error', lang,
                        error: {
                            pol: 'Nie znaleziono kanału (ID kanału może być nieaktualne)',
                            eng: 'Channel not found (channel ID may be outdated)',
                            fix_pol: 'Użyj `/configure`, aby wybrać nowy kanał dla bota.',
                            fix_eng: 'Use `/configure` to select a new channel for the bot.',
                        },
                        channelId: guildCfg.allowedChannelId, guildObj,
                    });
                    continue;
                }
                const description = lang === 'pol' ? data.descriptionPol : data.descriptionEng;
                const embed = this._buildInfoEmbed(data, data.user, description);
                await channel.send({ embeds: [embed] });
                results.push({ label: guildLabel, id: guildCfg.id, status: 'ok', lang, guildObj });
            } catch (err) {
                logger.error(`Błąd wysyłania /info do serwera "${guildLabel}": ${err.message}`);
                results.push({
                    label: guildLabel, id: guildCfg.id, status: 'error', lang,
                    error: this._mapSendError(err),
                    channelId: guildCfg.allowedChannelId, guildObj,
                });
            }
        }

        this._clearInfoSession(interaction.user.id);

        // DM do właścicieli serwerów z błędami (tylko gdy bot jest na serwerze)
        const infoCtx = { titlePol: '⚠️ Błąd wysyłania wiadomości /info', titleEng: '⚠️ Failed to deliver /info message' };
        for (const r of results.filter(r => r.status === 'error' && r.guildObj)) {
            this._sendChannelErrorDm({ ...r, context: infoCtx }).catch(() => {});
        }

        const sent = results.filter(r => r.status === 'ok').length;
        const failed = results.filter(r => r.status === 'error').length;

        const color = failed === 0 ? 0x00aa00
            : sent === 0 ? 0xcc0000
            : 0xff8800;

        const interactionLang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const isPol = interactionLang === 'pol';

        const summaryParts = [];
        if (sent > 0) summaryParts.push(`✅ ${isPol ? 'Wysłano' : 'Sent'}: **${sent}**`);
        if (failed > 0) summaryParts.push(`❌ ${isPol ? 'Błędy' : 'Errors'}: **${failed}**`);

        const reportEmbed = new EmbedBuilder()
            .setTitle(isPol ? '📋 Raport wysyłania /info' : '📋 /info delivery report')
            .setColor(color)
            .setDescription(summaryParts.join(' · '))
            .setTimestamp();

        for (const r of results.slice(0, 25)) {
            let value;
            if (r.status === 'ok') {
                value = isPol ? '✅ Wysłano pomyślnie' : '✅ Sent successfully';
            } else {
                value = `❌ ${isPol ? r.error.pol : r.error.eng}`;
                const fix = isPol ? r.error.fix_pol : r.error.fix_eng;
                if (fix) value += `\n└ ${fix}`;
            }
            reportEmbed.addFields({ name: r.label, value, inline: true });
        }

        const footerParts = [];
        if (results.length > 25) footerParts.push(`${isPol ? 'Pokazano 25 z' : 'Showing 25 of'} ${results.length} ${isPol ? 'aktywnych serwerów' : 'active servers'}`);
        if (failed > 0) footerParts.push(isPol ? 'Właściciele serwerów z błędami otrzymali powiadomienie DM' : 'Server owners with errors received a DM notification');
        if (footerParts.length > 0) reportEmbed.setFooter({ text: footerParts.join(' · ') });

        await interaction.editReply({ content: '', embeds: [reportEmbed], components: [] });
    }

    /**
     * Obsługuje przycisk "Edytuj" — pokazuje modal z wypełnionymi danymi z sesji.
     */
    async _handleInfoEdit(interaction) {
        const data = this._infoSessions.get(interaction.user.id) || {};
        await interaction.showModal(this._buildInfoModal(data, interaction.guildId));
    }

    /**
     * Obsługuje przycisk "Anuluj" — czyści sesję.
     */
    async _handleInfoCancel(interaction) {
        this._clearInfoSession(interaction.user.id);
        await interaction.update({ content: 'Anulowano.', embeds: [], components: [] });
    }

    async _handleBlockUserModal(interaction) {
        const parts = interaction.customId.split('_');
        // Format: ee_block_modal_{targetUserId}_{targetGuildId}_{otherRefType}[_{ref1}[_{ref2}]]
        // otherRefType: 'g' (global msgId in ref1), 'p' (per-guild channelId+msgId in ref1+ref2), 'none'
        const targetUserId = parts[3];
        const targetGuildId = parts[4];
        const otherRefType = parts[5];
        let crossUpdateGlobalMsgId = null;
        let crossUpdatePerGuildChannelId = null;
        let crossUpdatePerGuildMsgId = null;
        if (otherRefType === 'g') {
            crossUpdateGlobalMsgId = parts[6];
        } else if (otherRefType === 'p') {
            crossUpdatePerGuildChannelId = parts[6];
            crossUpdatePerGuildMsgId = parts[7];
        }

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

        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const blockedUntil = await this.userBlockService.blockUser(
            targetUserId, targetUsername, targetGuildId, guildName, durationStr, isHeadAdmin
        );

        const durationLabel = blockedUntil
            ? new Date(blockedUntil).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
            : '∞';

        const adminName = interaction.member?.displayName || interaction.user.username;
        const targetMsgs = this.config.getMessages(targetGuildId);
        const serverName = guildName;

        const updatedEmbeds = this._buildActionEmbeds(interaction.message.embeds, targetMsgs, serverName, 'blocked', adminName, durationLabel);
        await interaction.update({
            embeds: updatedEmbeds,
            components: [],
        });

        logger.info(`🔒 Zablokowano ${targetUsername} (${targetUserId}) ${blockedUntil ? `do ${new Date(blockedUntil).toISOString()}` : 'permanentnie'} przez ${adminName}`);

        if (crossUpdateGlobalMsgId) {
            await this._updateGlobalReportMsg(interaction.client, crossUpdateGlobalMsgId, targetGuildId, 'blocked', adminName, durationLabel);
        } else if (crossUpdatePerGuildChannelId && crossUpdatePerGuildMsgId) {
            await this._applyActionToAnyReport(interaction.client, crossUpdatePerGuildChannelId, crossUpdatePerGuildMsgId, targetGuildId, 'blocked', adminName, durationLabel);
        }
    }

    async handleUnblockCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: msgs.noPermissionAdmin, flags: ['Ephemeral'] });
            return;
        }

        const blocked = await this.userBlockService.getBlockedUsers();

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
        const currentCooldownMs = this.updateCooldownService.getCooldownDuration();
        const { formatCooldownDuration } = require('../services/updateCooldownService');
        const currentCooldownStr = currentCooldownMs ? formatCooldownDuration(currentCooldownMs) : '';

        const modal = new ModalBuilder()
            .setCustomId('limit_modal')
            .setTitle(msgs.limitModalTitle);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('limit_value')
                    .setLabel(msgs.limitModalLabel)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(msgs.limitModalPlaceholder)
                    .setValue(currentLimit !== null ? String(currentLimit) : '')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_value')
                    .setLabel(msgs.limitCooldownLabel)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(msgs.limitCooldownPlaceholder)
                    .setValue(currentCooldownStr)
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
    }

    async _handleLimitModal(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const rawUsage = interaction.fields.getTextInputValue('limit_value').trim();
        const rawCooldown = (interaction.fields.getTextInputValue('cooldown_value') || '').trim();
        const results = [];

        // Dzienny limit użyć
        if (rawUsage === '') {
            await this.usageLimitService.setLimit(null);
            results.push(msgs.limitRemoved);
        } else {
            const parsed = parseInt(rawUsage, 10);
            if (isNaN(parsed) || parsed < 1) {
                await interaction.reply({ content: msgs.limitInvalidValue, flags: ['Ephemeral'] });
                return;
            }
            await this.usageLimitService.setLimit(parsed);
            results.push(formatMessage(msgs.limitSet, { limit: parsed }));
        }

        // Cooldown
        if (rawCooldown === '') {
            await this.updateCooldownService.setCooldownDuration(null);
            results.push(msgs.limitCooldownRemoved);
        } else {
            const ms = this._parseCooldownDuration(rawCooldown);
            if (!ms) {
                await interaction.reply({ content: msgs.limitCooldownInvalid, flags: ['Ephemeral'] });
                return;
            }
            await this.updateCooldownService.setCooldownDuration(ms);
            results.push(formatMessage(msgs.limitCooldownSet, { cooldown: rawCooldown }));
        }

        await interaction.reply({ content: results.join('\n'), flags: ['Ephemeral'] });
    }

    _parseCooldownDuration(raw) {
        if (!raw || !raw.trim()) return null;
        const str = raw.trim().toLowerCase().replace(/\s+/g, '');
        const match = str.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
        if (!match || (!match[1] && !match[2])) return null;
        const h = parseInt(match[1] || '0', 10);
        const m = parseInt(match[2] || '0', 10);
        const ms = (h * 3600 + m * 60) * 1000;
        return ms > 0 ? ms : null;
    }

    async handleBlockOcrCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const allowedIds = this.config.blockOcrUserIds;
        if (!allowedIds.length || !allowedIds.includes(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        const action = interaction.options.getString('action'); // 'enable' | 'disable'
        const target = interaction.options.getString('target') || 'both';
        const targetGuildId = interaction.options.getString('guild');

        if (!targetGuildId) {
            await interaction.reply({ content: msgs.ocrGuildNotFound, flags: ['Ephemeral'] });
            return;
        }

        const guildConfig = this.config.getGuildConfig(targetGuildId);
        if (!guildConfig) {
            await interaction.reply({ content: msgs.ocrGuildNotFound, flags: ['Ephemeral'] });
            return;
        }

        const targetCommands = target === 'both' ? ['update', 'test'] : [target];
        const cmdLabel = targetCommands.map(c => `\`/${c}\``).join(', ');
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;

        if (action === 'enable') {
            await this.ocrBlockService.unblock(targetGuildId, targetCommands);
            logger.info(`🔓 OCR odblokowany dla ${cmdLabel} na serwerze ${serverName}`);
            await interaction.reply({
                content: formatMessage(msgs.ocrBlockPerGuildDisabled, { commands: cmdLabel, serverName }),
                flags: ['Ephemeral']
            });
            // Ogłoszenie na kanale serwera
            if (guildConfig.allowedChannelId) {
                const ch = await interaction.client.channels.fetch(guildConfig.allowedChannelId).catch(() => null);
                if (ch) {
                    const guildMsgs = this.config.getMessages(targetGuildId);
                    await ch.send({ content: formatMessage(guildMsgs.ocrBlockPerGuildDisabled, { commands: cmdLabel, serverName }) }).catch(() => {});
                }
            }
        } else {
            await this.ocrBlockService.block(targetGuildId, targetCommands);
            logger.warn(`🔒 OCR zablokowany dla ${cmdLabel} na serwerze ${serverName}`);
            await interaction.reply({
                content: formatMessage(msgs.ocrBlockPerGuildEnabled, { commands: cmdLabel, serverName }),
                flags: ['Ephemeral']
            });
        }
    }

    /** Parsuje footer embeda raportu — zwraca { globalMsgId, userId, guildId } */
    _parseReportFooter(footerText) {
        const result = {};
        for (const part of (footerText || '').split('|')) {
            if (part.startsWith('ref:')) result.globalMsgId = part.slice(4);
            else if (part.startsWith('uid:')) result.userId = part.slice(4);
            else if (part.startsWith('gid:')) result.guildId = part.slice(4);
            else if (part.startsWith('pgc:')) result.perGuildChannelId = part.slice(4);
            else if (part.startsWith('pgm:')) result.perGuildMsgId = part.slice(4);
        }
        return result;
    }

    /** Buduje pola akcji do dodania do embeda raportu */
    _buildActionEmbeds(embeds, msgs, serverName, actionType, adminName, extraInfo = '') {
        const now = new Date().toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        let actionLabel;
        switch (actionType) {
            case 'approved': actionLabel = msgs.reportActionApproved; break;
            case 'blocked': actionLabel = formatMessage(msgs.reportActionBlocked, { duration: extraInfo }); break;
            case 'analyzed': actionLabel = extraInfo || msgs.reportActionAnalyzed; break;
            default: actionLabel = actionType;
        }
        return embeds.map(e => {
            const builder = EmbedBuilder.from(e);
            builder.addFields(
                { name: formatMessage(msgs.reportActionField, { serverName }), value: '​', inline: false },
                { name: msgs.reportActionBy, value: adminName, inline: true },
                { name: msgs.reportActionWhat, value: actionLabel, inline: true },
                { name: msgs.reportActionWhen, value: now, inline: true },
            );
            return builder;
        });
    }

    /** Aktualizuje dowolną wiadomość raportu — dodaje pole akcji, usuwa przyciski */
    async _applyActionToAnyReport(client, channelId, msgId, sourceGuildId, actionType, adminName, extraInfo = '') {
        if (!channelId || !msgId) return;
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;
            const msg = await channel.messages.fetch(msgId).catch(() => null);
            if (!msg) return;
            const msgs = this.config.getMessages(sourceGuildId);
            const serverName = client.guilds.cache.get(sourceGuildId)?.name || sourceGuildId;
            const updatedEmbeds = this._buildActionEmbeds(msg.embeds, msgs, serverName, actionType, adminName, extraInfo);
            await msg.edit({ embeds: updatedEmbeds, components: [] });
        } catch (err) {
            logger.error(`❌ Nie można zaktualizować raportu ${msgId}: ${err.message}`);
        }
    }

    /** Aktualizuje globalny kanał raportu — deleguje do _applyActionToAnyReport */
    async _updateGlobalReportMsg(client, globalMsgId, sourceGuildId, actionType, adminName, extraInfo = '') {
        if (!this.config.invalidReportChannelId || !globalMsgId) return;
        await this._applyActionToAnyReport(client, this.config.invalidReportChannelId, globalMsgId, sourceGuildId, actionType, adminName, extraInfo);
    }

    async _handleAnalyzeButton(interaction, customId) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ModerateMembers')) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        const parts = customId.split('_');
        const targetUserId = parts[2];
        const targetGuildId = parts[3];
        // Zapamiętujemy ID oryginalnej wiadomości raportu — nie modyfikujemy jej, żeby Discord
        // nie skasował CDN URL obrazu (attachment clearowany, URL przestaje być "własny" wiadomości).
        const origMsgId = interaction.message.id;

        const yesBtn = new ButtonBuilder()
            .setCustomId(`ee_analyze_yes_${targetUserId}_${targetGuildId}_${origMsgId}`)
            .setLabel(msgs.analyzeConfirmYes)
            .setStyle(ButtonStyle.Success);
        const noBtn = new ButtonBuilder()
            .setCustomId(`ee_analyze_no_${targetUserId}_${targetGuildId}_${origMsgId}`)
            .setLabel(msgs.analyzeConfirmNo)
            .setStyle(ButtonStyle.Secondary);

        // deferUpdate nie modyfikuje oryginalnej wiadomości raportu — obraz zostaje
        await interaction.deferUpdate();
        await interaction.followUp({
            content: msgs.analyzeConfirmQuestion,
            components: [new ActionRowBuilder().addComponents(yesBtn, noBtn)],
            flags: ['Ephemeral'],
        });
    }

    async _handleAnalyzeCancelled(interaction) {
        // Zamykamy ephemeral z potwierdzeniem — oryginalna wiadomość raportu pozostaje bez zmian
        await interaction.update({ content: this.msgs(interaction.guildId).analyzeConfirmNo, components: [] });
    }

    async _handleAnalyzeConfirmed(interaction, customId) {
        const msgs = this.msgs(interaction.guildId);
        if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ModerateMembers')) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferUpdate();

        const parts = customId.split('_');
        const targetUserId = parts[3];
        const targetGuildId = parts[4];
        const origMsgId = parts[5];

        // Pobierz oryginalną wiadomość raportu (nie interaction.message — to ephemeral z potwierdzeniem)
        let origMsg = null;
        try {
            origMsg = await interaction.channel.messages.fetch(origMsgId);
        } catch {
            await interaction.editReply({ content: msgs.analyzeNoImage, components: [] });
            return;
        }

        const footerInfo = this._parseReportFooter(origMsg.embeds[0]?.footer?.text);

        // Obraz jest w polu embed.image oryginalnej wiadomości raportu
        const imageUrl = origMsg.embeds[0]?.image?.url;
        if (!imageUrl) {
            await interaction.editReply({ content: msgs.analyzeNoImage, components: [] });
            return;
        }

        const targetMsgs = this.config.getMessages(targetGuildId);
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        const adminName = interaction.member?.displayName || interaction.user.username;

        const applyToCurrentMsg = async (extraInfo) => {
            const updatedEmbeds = this._buildActionEmbeds(
                origMsg.embeds, targetMsgs, serverName, 'analyzed', adminName, extraInfo
            );
            // Edytuj oryginalną wiadomość raportu (nie ephemeral)
            await origMsg.edit({ embeds: updatedEmbeds, components: [] }).catch(() => {});
            // Zamknij ephemeral z potwierdzeniem
            await interaction.editReply({ content: extraInfo, components: [] }).catch(() => {});
        };

        const applyToOtherMsg = async (extraInfo) => {
            const sourceGuildId = footerInfo.guildId || targetGuildId;
            if (footerInfo.globalMsgId) {
                // Kliknięto na per-guild → zaktualizuj globalny
                await this._updateGlobalReportMsg(interaction.client, footerInfo.globalMsgId, sourceGuildId, 'analyzed', adminName, extraInfo);
            } else if (footerInfo.perGuildChannelId && footerInfo.perGuildMsgId) {
                // Kliknięto na globalny → zaktualizuj per-guild
                await this._applyActionToAnyReport(interaction.client, footerInfo.perGuildChannelId, footerInfo.perGuildMsgId, sourceGuildId, 'analyzed', adminName, extraInfo);
            }
        };

        const gl = this.logService._gl(targetGuildId);
        const tempPath = path.join(this.config.ocr.tempDir, `analyze_${Date.now()}.png`);
        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });
            const imgBuffer = await downloadBuffer(imageUrl);
            await fs.writeFile(tempPath, imgBuffer);

            gl.info(`🔍 [Analizuj] ${adminName} uruchamia analizę OCR dla użytkownika ${targetUserId} (serwer: ${serverName})`);

            const aiResult = await this.aiOcrService.extractImageData(tempPath, gl, {
                guildId: targetGuildId,
                actorDiscordId: targetUserId,
                operationType: OPERATIONS_TYPE,
            });

            if (aiResult.tokenUsage) {
                const { promptTokens, outputTokens } = aiResult.tokenUsage;
                this.tokenUsageService.record(targetGuildId, promptTokens, outputTokens, targetUserId).catch(() => {});
                gl.info(`🪙 Tokeny AI: input=${promptTokens}, output=${outputTokens}`);
            }

            // Pobierz nick z embeda raportu (pole może być w języku serwera)
            // Wartość pola ma format "[Nick](link) (discordName)" — wyciągamy sam Nick
            const embedFields = origMsg.embeds[0]?.fields || [];
            const nickField = embedFields.find(f => f.name === targetMsgs.reportFieldNick);
            const nickRaw = nickField?.value || '';
            const userName = nickRaw.match(/^\[([^\]]+)\]/)?.[1]
                || await interaction.client.users.fetch(targetUserId).then(u => u.username).catch(() => 'Nieznany');

            if (!aiResult.isValidVictory || !aiResult.score) {
                gl.warn(`⚠️ [Analizuj] Wynik OCR nieprawidłowy — isValidVictory=${aiResult.isValidVictory}, score=${aiResult.score}, error=${aiResult.error}`);
                const extraInfo = formatMessage(targetMsgs.analyzeResultFail, { adminName, error: aiResult.error || targetMsgs.analyzeResultUnknown });
                await applyToCurrentMsg(extraInfo);
                await applyToOtherMsg(extraInfo);
                try {
                    this.logService.sendOcrAnalysisEmbed(targetGuildId, {
                        type: 'rejected',
                        userName,
                        userId: targetUserId,
                        userAvatar: interaction.user.displayAvatarURL(),
                        commandName: 'analyze',
                        reason: aiResult.error || 'VALIDATION_FAILED',
                        adminName,
                    }, interaction.client.guilds.cache.get(targetGuildId) ?? null);
                } catch {}
                return;
            }

            gl.success(`✅ [Analizuj] AI OCR: wynik="${aiResult.score}", boss="${aiResult.bossName}"`);

            const { isNewRecord, currentScore, ranking: updatedRanking } = await this.rankingService.updateUserRanking(
                targetGuildId, targetUserId, userName, aiResult.score, aiResult.bossName
            );
            await this.logService.logScoreUpdate(userName, aiResult.score, isNewRecord, targetGuildId, { adminName });
            gl.info(`🎯 [Analizuj] Wynik zapisany — isNewRecord: ${isNewRecord}`);

            let newAchievements = [];
            if (this.achievementService) {
                this.achievementService.trackAiAnalyzed(targetGuildId, targetUserId).catch(() => {});
                if (isNewRecord) {
                    try {
                        const sortedAfter = await this.rankingService.getSortedPlayers(targetGuildId);
                        const currentPositionForAch = sortedAfter.findIndex(p => p.userId === targetUserId) + 1;
                        const prevScoreValue = currentScore ? this.rankingService.parseScoreValue(currentScore.score) : 0;
                        const newScoreValue = this.rankingService.parseScoreValue(aiResult.score);
                        newAchievements = await this.achievementService.processSubmission(targetGuildId, targetUserId, {
                            scoreValue: newScoreValue,
                            bossName: aiResult.bossName,
                            isNewRecord: true,
                            prevScoreValue,
                            currentPosition: currentPositionForAch,
                        });
                    } catch {}
                }
            }

            // Aktualizuj role TOP jeśli nowy rekord
            let _analyzeRoleErr = null;
            if (isNewRecord) {
                try {
                    const guildConfig = this.config.getGuildConfig(targetGuildId);
                    const updatedPlayers = await this.rankingService.getSortedPlayers(targetGuildId);
                    await this.roleService.updateTopRoles(
                        await interaction.client.guilds.fetch(targetGuildId),
                        updatedPlayers,
                        guildConfig?.topRoles || null
                    );
                    gl.success('✅ [Analizuj] Role TOP zaktualizowane po nowym rekordzie');
                } catch (roleErr) {
                    _analyzeRoleErr = roleErr.message;
                    gl.error(`❌ [Analizuj] Błąd aktualizacji ról TOP: ${roleErr.message}`);
                }
            }

            // Embed do webhooka (dodatkowe, nie zastępuje logowania tekstowego)
            try {
                this.logService.sendOcrAnalysisEmbed(targetGuildId, {
                    type: _analyzeRoleErr ? 'analyze_panel_role_error' : 'analyze_panel',
                    userName,
                    userId: targetUserId,
                    userAvatar: interaction.user.displayAvatarURL(),
                    score: aiResult.score,
                    bossName: aiResult.bossName,
                    previousScore: currentScore?.score,
                    commandName: 'analyze',
                    adminName,
                    roleError: _analyzeRoleErr,
                }, interaction.client.guilds.cache.get(targetGuildId) ?? null);
            } catch {}


            // Ogłoszenie publiczne — tylko gdy wynik jest nowym rekordem
            const guildCfgAnnounce = this.config.getGuildConfig(targetGuildId);
            const announcementChannelId = guildCfgAnnounce?.allowedChannelId;
            if (isNewRecord && announcementChannelId) {
                try {
                    const announcementChannel = await interaction.client.channels.fetch(announcementChannelId).catch(() => null);
                    if (announcementChannel) {
                        const userAvatarUrl = await interaction.client.users.fetch(targetUserId)
                            .then(u => u.displayAvatarURL()).catch(() => null);
                        const targetGuildObj = interaction.client.guilds.cache.get(targetGuildId)
                            || await interaction.client.guilds.fetch(targetGuildId).catch(() => null);

                        const ext = path.extname(tempPath) || '.png';
                        const announceName = `analyze_wynik_${Date.now()}${ext}`;
                        const fileAttachment = new AttachmentBuilder(tempPath, { name: announceName });

                        const resultEmbed = await this.rankingService.createRecordEmbed(
                            userName, aiResult.score, userAvatarUrl, announceName,
                            currentScore?.score ?? null, targetUserId, targetGuildId,
                            targetMsgs, targetGuildObj, guildCfgAnnounce?.topRoles ?? null,
                            currentScore?.timestamp ?? null, newAchievements
                        );

                        const announcementContent = formatMessage(targetMsgs.analyzeManualAnnouncement, {
                            userId: targetUserId,
                            adminName,
                        });

                        const publicMsg = await announcementChannel.send({
                            content: announcementContent,
                            embeds: [resultEmbed],
                            files: [fileAttachment],
                        });
                        gl.info(`✅ [Analizuj] Ogłoszenie wysłane na kanał ${announcementChannelId}`);

                        // DM do subskrybentów
                        if (this.notificationService && publicMsg) {
                            try {
                                const subscribers = await this.notificationService.getSubscribersForTarget(targetUserId, targetGuildId);
                                for (const sub of subscribers) {
                                    try {
                                        const dmUser = await interaction.client.users.fetch(sub.subscriberId);
                                        const dmEmbed = this.rankingService.createDmNotifEmbed(resultEmbed, targetMsgs);
                                        await dmUser.send({ embeds: [dmEmbed], files: [new AttachmentBuilder(tempPath, { name: announceName })] });
                                    } catch {}
                                }
                            } catch {}
                        }
                    }
                } catch (annErr) {
                    gl.error(`❌ [Analizuj] Błąd wysyłania ogłoszenia: ${annErr.message}`);
                }
            }

            const extraInfo = formatMessage(targetMsgs.analyzeResultSuccess, {
                adminName,
                bossName: aiResult.bossName || targetMsgs.analyzeResultUnknown,
                score: aiResult.score,
                result: isNewRecord ? targetMsgs.analyzeResultNewRecord : targetMsgs.analyzeResultNoRecord,
            });
            await applyToCurrentMsg(extraInfo);
            await applyToOtherMsg(extraInfo);

            // Zapisz sesję revert i dodaj przycisk "Cofnij wynik" do globalnego raportu
            const globalMsgId = footerInfo.globalMsgId || origMsgId;
            if (this.config.invalidReportChannelId && globalMsgId) {
                this._analyzeRevertSessions.set(globalMsgId, {
                    targetUserId,
                    targetGuildId,
                    previousRecord: currentScore ?? null,
                    newRecordTimestamp: isNewRecord ? (updatedRanking[targetUserId]?.timestamp ?? null) : null,
                    userName,
                    adminName,
                });
                try {
                    const globalChan = await interaction.client.channels.fetch(this.config.invalidReportChannelId).catch(() => null);
                    if (globalChan) {
                        const globalMsg = await globalChan.messages.fetch(globalMsgId).catch(() => null);
                        if (globalMsg) {
                            const revertBtn = new ButtonBuilder()
                                .setCustomId(`ee_analyze_revert_${globalMsgId}`)
                                .setLabel('↩️ Cofnij wynik')
                                .setStyle(ButtonStyle.Danger);
                            await globalMsg.edit({
                                embeds: globalMsg.embeds,
                                components: [new ActionRowBuilder().addComponents(revertBtn)],
                            });
                        }
                    }
                } catch (revertErr) {
                    gl.warn(`⚠️ [Analizuj] Nie można dodać przycisku cofnięcia: ${revertErr.message}`);
                }
            }

            gl.info(`✅ [Analizuj] Embedy zaktualizowane — analiza zakończona`);

        } catch (err) {
            gl.error(`❌ [Analizuj] Błąd ee_analyze: ${err.message}`);
            await interaction.editReply({
                content: formatMessage(msgs.analyzeError, { error: err.message }),
                components: [],
            }).catch(() => {});
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }
    }

    async _handleAnalyzeRevert(interaction, customId) {
        if (!interaction.member.permissions.has('Administrator') && !interaction.member.permissions.has('ModerateMembers')) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }

        const globalMsgId = customId.slice('ee_analyze_revert_'.length);
        const session = this._analyzeRevertSessions.get(globalMsgId);
        if (!session) {
            await interaction.reply({ content: '⚠️ Sesja cofnięcia wygasła lub nie istnieje.', flags: ['Ephemeral'] });
            return;
        }
        this._analyzeRevertSessions.delete(globalMsgId);

        await interaction.deferUpdate();

        const { targetUserId, targetGuildId, previousRecord, newRecordTimestamp, userName, adminName } = session;
        const gl = this.logService._gl(targetGuildId);
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        const reverterName = interaction.member?.displayName || interaction.user.username;

        try {
            gl.info(`↩️ [Cofnij] ${reverterName} cofa wynik dla ${userName} (serwer: ${serverName}), poprzedni wynik: ${previousRecord?.score || 'brak'}`);

            // 1. Cofnij ranking (identycznie jak CV revert)
            await this.rankingService.revertUserRecord(targetGuildId, targetUserId, previousRecord ?? null);
            gl.info(`↩️ [Cofnij] Ranking cofnięty → ${previousRecord?.score || 'gracz usunięty'}`);

            // 2. Usuń wpisy historii wyników od momentu analizowanego rekordu
            if (this.scoreHistoryService && newRecordTimestamp) {
                this.scoreHistoryService.removeEntriesAfter(targetGuildId, targetUserId, newRecordTimestamp)
                    .catch(e => gl.error(`↩️ [Cofnij] Błąd usuwania historii: ${e.message}`));
            }

            // 3. Wyczyść osiągnięcia score/records (identycznie jak CV revert)
            if (this.achievementService) {
                await this.achievementService.clearUserAchievements(targetGuildId, targetUserId).catch(() => {});
                gl.info('↩️ [Cofnij] Osiągnięcia score/records wyczyszczone');
            }

            // 4. Zaktualizuj role TOP
            try {
                const guildConfig = this.config.getGuildConfig(targetGuildId);
                const updatedPlayers = await this.rankingService.getSortedPlayers(targetGuildId);
                await this.roleService.updateTopRoles(
                    await interaction.client.guilds.fetch(targetGuildId),
                    updatedPlayers,
                    guildConfig?.topRoles || null
                );
                gl.success('✅ [Cofnij] Role TOP zaktualizowane po cofnięciu wyniku');
            } catch (roleErr) {
                gl.error(`❌ [Cofnij] Błąd aktualizacji ról TOP: ${roleErr.message}`);
            }

            const now = new Date().toLocaleString('pl-PL', {
                timeZone: 'Europe/Warsaw',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });
            const revertInfo = previousRecord?.score
                ? `↩️ Wynik cofnięty przez **${reverterName}** → przywrócono: **${previousRecord.score}** | ${now}`
                : `↩️ Wynik cofnięty przez **${reverterName}** → gracz usunięty z rankingu | ${now}`;

            const updatedEmbeds = interaction.message.embeds.map(e => {
                const builder = EmbedBuilder.from(e);
                builder.addFields({ name: '↩️ Cofnięcie wyniku', value: revertInfo, inline: false });
                return builder;
            });

            await interaction.editReply({ embeds: updatedEmbeds, components: [] });
            gl.info(`↩️ [Cofnij] Embed zaktualizowany — cofnięcie zakończone`);
        } catch (err) {
            gl.error(`❌ [Cofnij] Błąd cofania wyniku: ${err.message}`);
            await interaction.editReply({ components: [] }).catch(() => {});
        }
    }

    async _dmPermissionAlert(client, guildId, { channelId, missingPerms, context }) {
        try {
            const storedCfg = this.guildConfigService.getConfig(guildId);
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            const guildName = guild?.name || guildId;
            const isPol = storedCfg?.lang !== 'eng';

            const ctxText = typeof context === 'object'
                ? (isPol ? context.pol : context.eng)
                : context;

            const missingList = missingPerms.length
                ? missingPerms.map(p => `• **${p}**`).join('\n')
                : isPol ? '• *(nieznane uprawnienie)*' : '• *(unknown permission)*';

            const dmEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(isPol ? '⚠️ EndersEcho — brak uprawnień' : '⚠️ EndersEcho — missing permissions')
                .setDescription(isPol
                    ? `Bot napotkał błąd uprawnień na serwerze **${guildName}** i nie może wykonać swojego zadania.\n\n**Kanał:** <#${channelId}>\n**Kontekst:** ${ctxText}\n\n**Brakujące uprawnienia:**\n${missingList}\n\nPrzejdź do ustawień kanału i nadaj botowi brakujące uprawnienia, lub zmień kanał przez \`/configure\`.`
                    : `The bot encountered a permission error on **${guildName}** and cannot complete its task.\n\n**Channel:** <#${channelId}>\n**Context:** ${ctxText}\n\n**Missing permissions:**\n${missingList}\n\nGo to the channel settings and grant the bot the missing permissions, or change the channel via \`/configure\`.`
                )
                .setTimestamp();

            const sentTo = new Set();
            const configuredById = storedCfg?.configuredBy?.userId;
            if (configuredById) {
                const admin = await client.users.fetch(configuredById).catch(() => null);
                if (admin) {
                    await admin.send({ embeds: [dmEmbed] }).catch(() => {});
                    sentTo.add(configuredById);
                }
            }
            const owner = guild ? await guild.fetchOwner().catch(() => null) : null;
            if (owner && !sentTo.has(owner.id)) {
                await owner.send({ embeds: [dmEmbed] }).catch(() => {});
            }
        } catch { /* fire-and-forget, nie przerywaj głównego flow */ }
    }

    async _sendInvalidScreenReport(interaction, imagePath, reason, gl, rejectionReason = null) {
        const hasGlobal = !!this.config.invalidReportChannelId;
        const guildCfg = this.config.getGuildConfig(interaction.guildId);
        const perGuildChannelId = guildCfg?.invalidReportChannelId || null;
        if (!hasGlobal && !perGuildChannelId) return null;
        let reportImgUrl = null;

        try {
            const msgs = this.config.getMessages(interaction.guildId);
            const serverNick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            const discordUsername = interaction.user.username;
            const serverName = interaction.guild?.name || 'Unknown server';
            const now = new Date();
            const timestamp = now.toLocaleString('pl-PL', {
                timeZone: 'Europe/Warsaw',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });

            // Pobierz aktualny rekord gracza
            let currentRecordText = msgs.reportFieldNoRecord || '—';
            try {
                const ranking = await this.rankingService.loadRanking(interaction.guildId);
                const userRecord = ranking[interaction.user.id];
                if (userRecord?.score) {
                    currentRecordText = userRecord.bossName
                        ? `${userRecord.score} (${userRecord.bossName})`
                        : userRecord.score;
                }
            } catch {}

            const reasonMap = {
                'FAKE_PHOTO': msgs.reportReasonFakePhoto,
                'INVALID_SCREENSHOT': msgs.reportReasonInvalidScreenshot,
                'NO_REQUIRED_WORDS': msgs.reportReasonNoRequiredWords,
                'NOT_SIMILAR': msgs.reportReasonNotSimilar,
                'INVALID_SCORE_FORMAT': msgs.reportReasonInvalidScoreFormat,
                'BEST_EXCEEDS_TOTAL': msgs.reportReasonBestExceedsTotal,
            };
            const reasonText = reasonMap[reason] || `🟠 ${reason}`;
            const color = reason === 'FAKE_PHOTO' ? 0xFF0000 : 0xFF8C00;

            const ext = path.extname(imagePath) || '.png';
            const fileName = `rejected_${Date.now()}${ext}`;

            const buildEmbed = (footerText, imageUrl = null) => {
                const guildConfig = this.config.getGuildConfig(interaction.guildId);
                const guildTag = guildConfig?.tag || null;
                const guildIcon = interaction.guild?.iconURL({ dynamic: true, size: 64 }) || guildConfig?.icon || null;
                const authorName = guildTag ? `${guildTag}  ${serverName}` : serverName;
                const userAvatar = interaction.user.displayAvatarURL({ dynamic: true, size: 64 });

                const fields = [
                    { name: msgs.reportFieldNick, value: `[${serverNick}](https://discord.com/users/${interaction.user.id}) (${discordUsername})`, inline: true },
                    { name: msgs.reportFieldTime, value: timestamp, inline: true },
                    { name: msgs.reportFieldCurrentRecord || '📊 Aktualny rekord', value: currentRecordText, inline: true },
                    { name: msgs.reportFieldReason, value: reasonText, inline: false },
                ];
                if (rejectionReason) {
                    fields.push({ name: msgs.reportFieldAiDetails, value: rejectionReason, inline: false });
                }
                const embed = new EmbedBuilder()
                    .setColor(color)
                    .setTitle(msgs.reportTitle)
                    .setAuthor({ name: authorName, iconURL: guildIcon || undefined })
                    .setThumbnail(userAvatar)
                    .addFields(...fields)
                    .setTimestamp()
                    .setFooter({ text: footerText });
                if (imageUrl) embed.setImage(imageUrl);
                return embed;
            };

            const buildButtons = () => {
                const blockBtn = new ButtonBuilder()
                    .setCustomId(`ee_block_${interaction.user.id}_${interaction.guildId}`)
                    .setLabel(msgs.reportBtnBlock)
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger);
                if (reason === 'NOT_SIMILAR') {
                    const analyzeBtn = new ButtonBuilder()
                        .setCustomId(`ee_analyze_${interaction.user.id}_${interaction.guildId}`)
                        .setLabel(msgs.reportBtnAnalyze)
                        .setEmoji('🔍')
                        .setStyle(ButtonStyle.Primary);
                    return new ActionRowBuilder().addComponents(analyzeBtn, blockBtn);
                }
                const approveBtn = new ButtonBuilder()
                    .setCustomId(`ee_approve_${interaction.user.id}`)
                    .setLabel(msgs.reportBtnApprove)
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Secondary);
                return new ActionRowBuilder().addComponents(approveBtn, blockBtn);
            };

            // Pomocnik: wyślij raport bez podwójnego podglądu zdjęcia.
            // Krok 1: wyślij sam plik → Discord nadaje CDN URL.
            // Krok 2: edytuj wiadomość — ustaw embed z CDN URL i usuń załącznik (attachments: []).
            // Dzięki temu zdjęcie widoczne jest tylko wewnątrz embeda, nie jako osobny podgląd.
            const sendReport = async (channel, footerText) => {
                const att = new AttachmentBuilder(imagePath, { name: fileName });
                const msg = await channel.send({ files: [att] });
                const imgUrl = msg.attachments.first()?.url;
                const embed = buildEmbed(footerText, imgUrl || null);
                const edited = await msg.edit({
                    embeds: [embed],
                    components: [buildButtons()],
                });
                return { msg: edited, imgUrl };
            };

            // Wyślij do globalnego kanału
            let globalMsgId = null;
            let sentGlobalMsg = null;
            if (hasGlobal) {
                try {
                    const globalChannel = await interaction.client.channels.fetch(this.config.invalidReportChannelId);
                    if (globalChannel) {
                        const { msg: _gMsg, imgUrl: _gImgUrl } = await sendReport(globalChannel, `uid:${interaction.user.id}|gid:${interaction.guildId}`);
                        sentGlobalMsg = _gMsg;
                        reportImgUrl = _gImgUrl;
                        globalMsgId = sentGlobalMsg.id;
                        gl.info(`🛑 📋 Wysłano raport (${reason}) do globalnego kanału dla ${serverNick}`);
                    }
                } catch (err) {
                    gl.warn(`⚠️ Nie można wysłać raportu do globalnego kanału: ${err.message}`);
                }
            }

            // Wyślij do per-guild kanału (jeśli skonfigurowany i różny od globalnego)
            if (perGuildChannelId && perGuildChannelId !== this.config.invalidReportChannelId) {
                try {
                    const guildChannel = await interaction.client.channels.fetch(perGuildChannelId);
                    if (guildChannel) {
                        const footerText = globalMsgId
                            ? `ref:${globalMsgId}|uid:${interaction.user.id}|gid:${interaction.guildId}`
                            : `uid:${interaction.user.id}|gid:${interaction.guildId}`;
                        const { msg: sentPerGuild, imgUrl: _pgImgUrl } = await sendReport(guildChannel, footerText);
                        if (!reportImgUrl) reportImgUrl = _pgImgUrl;
                        // Zapisz referencję do per-guild wiadomości w footerze globalnego embeda
                        // żeby Analyze kliknięty na global mógł zaktualizować też per-guild
                        if (sentGlobalMsg) {
                            const updatedGlobalEmbeds = sentGlobalMsg.embeds.map(e => {
                                const b = EmbedBuilder.from(e);
                                const cur = e.footer?.text || '';
                                b.setFooter({ text: `${cur}|pgc:${perGuildChannelId}|pgm:${sentPerGuild.id}` });
                                return b;
                            });
                            sentGlobalMsg.edit({
                                embeds: updatedGlobalEmbeds,
                                components: [...sentGlobalMsg.components],
                            }).catch(e => gl.warn(`⚠️ Nie można zaktualizować footera globalnego raportu: ${e.message}`));
                        }
                        gl.info(`🛑 📋 Wysłano raport (${reason}) do per-guild kanału serwera ${interaction.guildId}`);
                    }
                } catch (err) {
                    if (err.code === 50013 || err.code === 50001) {
                        try {
                            const guild = await interaction.client.guilds.fetch(interaction.guildId);
                            const me = await guild.members.fetchMe();
                            const ch = guild.channels.cache.get(perGuildChannelId)
                                || await guild.channels.fetch(perGuildChannelId).catch(() => null);
                            const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'];
                            let missing = needed;
                            if (ch && me) {
                                const perms = ch.permissionsFor(me);
                                missing = needed.filter(p => !perms.has(p));
                                gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału (${err.code} ${err.message}). Brakujące uprawnienia: ${missing.length ? missing.join(', ') : 'wszystkie OK — inny powód'}`);
                            } else {
                                gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału (${err.code}): nie udało się pobrać kanału/membera`);
                            }
                            await this._dmPermissionAlert(interaction.client, interaction.guildId, {
                                channelId: perGuildChannelId,
                                missingPerms: missing,
                                context: { pol: 'Kanał raportów odrzuconych screenów', eng: 'Rejected screenshots reports channel' },
                            });
                        } catch (diagErr) {
                            gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału (${err.code} ${err.message}): diagnostyka nieudana — ${diagErr.message}`);
                        }
                    } else {
                        gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału: ${err.message}`);
                    }
                }
            }
        } catch (err) {
            gl.warn(`⚠️ Nie można wysłać raportu o odrzuconym screenie: ${err.message}`);
        }
        return reportImgUrl;
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
        // tk_p_{YYYYMM}_{guildFilter}_{userId}            — poprzedni miesiąc (wykres per dzień)
        // tk_n_{YYYYMM}_{guildFilter}_{userId}            — następny miesiąc (wykres per dzień)
        // tk_m_{YYYYMM}_{guildFilter}_{userId}            — Zbiorczo: breakdown per serwer (tylko head admin)
        // tk_g_{YYYYMM}_{guildId}_{userId}                — konkretny serwer (wykres per dzień)
        // tk_a_{YYYYMM}_{userId}                          — wszystkie serwery (wykres per dzień)
        // tk_u_{YYYYMM}_{guildFilter}_{page}_{userId}     — widok per user (paginacja strzałkami)
        // tk_gp_{YYYYMM}_{guildFilter}_{page}_{userId}    — paginacja przycisków klanów
        const parts    = customId.split('_');
        const action   = parts[1];
        const monthRaw = parts[2];
        const month    = `${monthRaw.slice(0, 4)}-${monthRaw.slice(4, 6)}`;

        let userId, guildFilter, page;
        if (action === 'a') {
            userId      = parts[3];
            guildFilter = 'all';
            page        = 0;
        } else if (action === 'total') {
            userId      = parts[2];
            guildFilter = 'all';
            page        = 0;
        } else if (action === 'u' || action === 'gp') {
            guildFilter = parts[3];
            page        = parseInt(parts[4]) || 0;
            userId      = parts[5];
        } else {
            userId      = parts[4];
            guildFilter = parts[3];
            page        = 0;
        }

        if (userId !== interaction.user.id) {
            const tTk = this._panelT(interaction.guildId);
            await interaction.reply({ content: tTk('Tylko osoba która użyła komendy może klikać te przyciski.', 'Only the person who used the command can click these buttons.'), flags: ['Ephemeral'] });
            return;
        }

        const isSuperUser = this.config.blockOcrUserIds.includes(interaction.user.id);
        const isAdmin     = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isSuperUser && !isAdmin) return;

        if (action === 'm' && !isSuperUser) return;

        // Zwykły admin widzi tylko swój serwer — zignoruj filter z customId
        const effectiveFilter = isSuperUser ? guildFilter : interaction.guildId;
        const tTok = this._panelT(interaction.guildId);

        await interaction.deferUpdate();

        // Widok Zbiorczo (breakdown per serwer)
        if (action === 'm') {
            const reply = await this._buildTokensMonthBreakdown(interaction, month, isSuperUser);
            if (reply.components.length < 5) {
                reply.components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(tTok('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                ));
            }
            await interaction.editReply(reply);
            return;
        }

        // Widok Całe zużycie (all-time per serwer)
        if (action === 'total') {
            if (!isSuperUser) return;
            const reply = await this._buildTokensTotalBreakdown(interaction);
            if (reply.components.length < 5) {
                reply.components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(tTok('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                ));
            }
            await interaction.editReply(reply);
            return;
        }

        // Widok per user (paginacja)
        if (action === 'u') {
            const reply = await this._buildTokensUsersEmbed(interaction, month, effectiveFilter, page, isSuperUser);
            if (reply.components.length < 5) {
                reply.components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(tTok('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                ));
            }
            await interaction.editReply(reply);
            return;
        }

        // Nawigacja miesięcy / serwer w widoku wykres per dzień
        let targetMonth = month;
        if (action === 'p' || action === 'n') {
            const available = this.tokenUsageService.getAvailableMonths(effectiveFilter);
            const idx = available.indexOf(month);
            if (action === 'p' && idx > 0)                    targetMonth = available[idx - 1];
            if (action === 'n' && idx < available.length - 1) targetMonth = available[idx + 1];
        }

        // Paginacja klanów: zachowaj stronę; przy zmianie miesiąca/serwera wróć do 0
        const guildPage = action === 'gp' ? page : 0;
        const reply = await this._buildTokensEmbed(interaction, targetMonth, effectiveFilter, isSuperUser, guildPage);
        await interaction.editReply(reply);
    }

    async _buildTokensEmbed(interaction, month, guildFilter, isSuperUser = false, guildPage = 0) {
        const { PRICING } = require('../services/tokenUsageService');
        const t = this._panelT(interaction.guildId);

        const [y, m] = month.split('-').map(Number);
        const monthStr = `${y}${String(m).padStart(2, '0')}`;
        const userId   = interaction.user.id;

        const MONTH_NAMES_POL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
        const MONTH_NAMES_ENG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const monthLabel = `${t(MONTH_NAMES_POL[m - 1], MONTH_NAMES_ENG[m - 1])} ${y}`;

        // Wykres tekstowy
        const chartText = this.tokenUsageService.generateChartText(guildFilter, month, isSuperUser);

        // Statystyki miesięczne
        const totals = this.tokenUsageService.getMonthTotals(guildFilter, month);
        const fmtTok = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
        const fmtCost = (c) => `$${c.toFixed(5)}`;

        // Nazwy serwerów z cache
        const guildNames = {};
        for (const gc of this.config.getAllGuilds()) {
            const g = interaction.client.guilds.cache.get(gc.id);
            guildNames[gc.id] = g?.name || gc.id;
        }

        const footerText = guildFilter === 'all'
            ? t('Wszystkie serwery', 'All servers')
            : (guildNames[guildFilter] || guildFilter);

        const embedFields = [
            { name: t('📨 Zapytania', '📨 Requests'), value: `\`${totals.requests}\``, inline: true },
            { name: t('🔤 Tokeny', '🔤 Tokens'),      value: `\`${fmtTok(totals.promptTokens + totals.outputTokens)}\``, inline: true },
        ];
        if (isSuperUser) {
            embedFields.push({ name: t('💰 Koszt', '💰 Cost'), value: `**${fmtCost(totals.cost)}**`, inline: true });
        }
        const detailValue = `In: \`${fmtTok(totals.promptTokens)}\` • Out: \`${fmtTok(totals.outputTokens)}\`` +
            (isSuperUser ? `\n${t('Cennik', 'Pricing')}: In $${PRICING.input}/1M • Out $${PRICING.output}/1M` : '');
        embedFields.push({ name: t('Szczegóły', 'Details'), value: detailValue, inline: false });

        const embed = new EmbedBuilder()
            .setColor(0x4285F4)
            .setTitle(t(`📊 Tokeny AI — ${monthLabel}`, `📊 AI Tokens — ${monthLabel}`))
            .setDescription(chartText)
            .addFields(...embedFields)
            .setTimestamp()
            .setFooter({ text: `${footerText} • ${t('dane z /update', 'data from /update')}` });

        // Nawigacja miesiącami
        const available = this.tokenUsageService.getAvailableMonths(guildFilter);
        const idx       = available.indexOf(month);
        const hasPrev   = idx > 0;
        const hasNext   = idx < available.length - 1;

        const prevMonthRaw = hasPrev ? available[idx - 1].replace('-', '') : monthStr;
        const nextMonthRaw = hasNext ? available[idx + 1].replace('-', '') : monthStr;

        // Wiersz 1: ◀ | [Miesiąc → per user] | ▶ | 🌐 Wszystkie (superUser) | Zbiorczo (superUser)
        const row1Buttons = [
            new ButtonBuilder()
                .setCustomId(`tk_p_${prevMonthRaw}_${guildFilter}_${userId}`)
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrev),
            new ButtonBuilder()
                .setCustomId(`tk_u_${monthStr}_${guildFilter}_0_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`tk_n_${nextMonthRaw}_${guildFilter}_${userId}`)
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasNext),
        ];

        if (isSuperUser) {
            row1Buttons.push(
                new ButtonBuilder()
                    .setCustomId(`tk_a_${monthStr}_${userId}`)
                    .setEmoji('🌐').setLabel(t('Wszystkie', 'All'))
                    .setStyle(guildFilter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`tk_m_${monthStr}_${guildFilter}_${userId}`)
                    .setEmoji('🗂️').setLabel(t('Zbiorczo', 'Summary'))
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        const navRow = new ActionRowBuilder().addComponents(...row1Buttons);
        const components = [navRow];

        // Przyciski serwerów — tylko dla super użytkownika, max 10 per strona (wiersze 2 i 3)
        const t2 = this._panelT(interaction.guildId);
        if (isSuperUser) {
            const allGuildButtons = this.config.getAllGuilds()
                .filter(gc => interaction.client.guilds.cache.has(gc.id))
                .map(gc =>
                    new ButtonBuilder()
                        .setCustomId(`tk_g_${monthStr}_${gc.id}_${userId}`)
                        .setLabel((guildNames[gc.id] || gc.id).substring(0, 80))
                        .setStyle(guildFilter === gc.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );
            const totalGuilds = allGuildButtons.length;
            const totalPages  = Math.ceil(totalGuilds / 10);
            const safePage    = Math.min(Math.max(guildPage, 0), Math.max(totalPages - 1, 0));
            const pageButtons = allGuildButtons.slice(safePage * 10, safePage * 10 + 10);
            for (let i = 0; i < pageButtons.length; i += 5) {
                components.push(new ActionRowBuilder().addComponents(pageButtons.slice(i, i + 5)));
            }
            const hasPrevPage = safePage > 0;
            const hasNextPage = safePage < totalPages - 1;
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('panel_back')
                    .setEmoji('◀️').setLabel(t2('Powrót do panelu', 'Back to Panel'))
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`tk_gp_${monthStr}_${guildFilter}_${safePage - 1}_${userId}`)
                    .setEmoji('◀️')
                    .setLabel(t2(`Str. ${safePage}`, `Page ${safePage}`))
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasPrevPage),
                new ButtonBuilder()
                    .setCustomId(`tk_gp_${monthStr}_${guildFilter}_${safePage + 1}_${userId}`)
                    .setEmoji('▶️')
                    .setLabel(t2(`Str. ${safePage + 2}`, `Page ${safePage + 2}`))
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasNextPage),
            ));
        } else {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('panel_back')
                    .setEmoji('◀️').setLabel(t2('Powrót do panelu', 'Back to Panel'))
                    .setStyle(ButtonStyle.Secondary)
            ));
        }

        return { embeds: [embed], components };
    }

    async _buildTokensMonthBreakdown(interaction, month, isSuperUser) {
        const { PRICING } = require('../services/tokenUsageService');
        const t = this._panelT(interaction.guildId);
        const [y, m] = month.split('-').map(Number);
        const MONTH_NAMES_POL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
        const MONTH_NAMES_ENG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const monthLabel = `${t(MONTH_NAMES_POL[m - 1], MONTH_NAMES_ENG[m - 1])} ${y}`;
        const monthStr   = `${y}${String(m).padStart(2, '0')}`;
        const userId     = interaction.user.id;

        const fmtCost = (c) => `$${c.toFixed(5)}`;

        // Iteruj po wszystkich guildach które kiedykolwiek miały dane tokenów
        const tokenGuildIds = Object.keys(this.tokenUsageService.data.guilds);
        const activeLines = [];
        const leftLines   = [];
        let totalCost = 0;

        for (const guildId of tokenGuildIds) {
            const stats = this.tokenUsageService.getMonthlyStats(guildId, month);
            if (stats.requests === 0) continue;
            const cost = stats.cost;
            totalCost += cost;
            const liveName   = interaction.client.guilds.cache.get(guildId)?.name;
            const storedName = this.guildConfigService.getConfig(guildId)?.guildName;
            const name       = (liveName || storedName || guildId).slice(0, 24);
            const line = `**${name}** — ${fmtCost(cost)} (${stats.requests} req)`;
            if (liveName) {
                activeLines.push(line);
            } else {
                leftLines.push(line);
            }
        }

        activeLines.push('');
        activeLines.push(`**${t('Łącznie', 'Total')}** — **${fmtCost(totalCost)}**`);

        const embed = new EmbedBuilder()
            .setColor(0x4285F4)
            .setTitle(t(`📊 Koszty miesięczne — ${monthLabel}`, `📊 Monthly Costs — ${monthLabel}`))
            .setDescription(activeLines.join('\n'));

        if (leftLines.length > 0) {
            embed.addFields({ name: t('🚪 Serwery bez aplikacji', '🚪 Servers no longer present'), value: leftLines.join('\n'), inline: false });
        }

        embed
            .addFields({ name: t('Cennik', 'Pricing'), value: `In $${PRICING.input}/1M • Out $${PRICING.output}/1M`, inline: false })
            .setTimestamp()
            .setFooter({ text: t('Dane z /update', 'Data from /update') });

        // Nawigacja miesiącami (na podstawie dostępnych danych — wszystkie serwery)
        const available    = this.tokenUsageService.getAvailableMonths('all');
        const idx          = available.indexOf(month);
        const hasPrev      = idx > 0;
        const hasNext      = idx < available.length - 1;
        const prevMonthRaw = hasPrev ? available[idx - 1].replace('-', '') : monthStr;
        const nextMonthRaw = hasNext ? available[idx + 1].replace('-', '') : monthStr;

        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tk_m_${prevMonthRaw}_all_${userId}_p`)
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrev),
            new ButtonBuilder()
                .setCustomId(`tk_m_${monthStr}_all_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`tk_m_${nextMonthRaw}_all_${userId}_n`)
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasNext),
            new ButtonBuilder()
                .setCustomId(`tk_a_${monthStr}_${userId}`)
                .setEmoji('📅').setLabel(t('Dniowo', 'Daily'))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`tk_total_${userId}`)
                .setEmoji('📦').setLabel(t('Całe zużycie', 'All-time Usage'))
                .setStyle(ButtonStyle.Secondary),
        );

        return { embeds: [embed], components: [backRow] };
    }

    async _buildTokensTotalBreakdown(interaction) {
        const { PRICING } = require('../services/tokenUsageService');
        const t = this._panelT(interaction.guildId);
        const userId   = interaction.user.id;
        const fmtCost  = (c) => `$${c.toFixed(5)}`;
        const allMonths = this.tokenUsageService.getAvailableMonths('all');
        const tokenGuildIds = Object.keys(this.tokenUsageService.data.guilds);

        const activeLines = [];
        const leftLines   = [];
        let totalCost = 0;

        for (const guildId of tokenGuildIds) {
            let promptTokens = 0, outputTokens = 0, requests = 0;
            for (const month of allMonths) {
                const s = this.tokenUsageService.getMonthlyStats(guildId, month);
                promptTokens += s.promptTokens;
                outputTokens += s.outputTokens;
                requests     += s.requests;
            }
            if (requests === 0) continue;
            const cost = (promptTokens / 1_000_000) * PRICING.input + (outputTokens / 1_000_000) * PRICING.output;
            totalCost += cost;
            const liveName   = interaction.client.guilds.cache.get(guildId)?.name;
            const storedName = this.guildConfigService.getConfig(guildId)?.guildName;
            const name       = (liveName || storedName || guildId).slice(0, 24);
            const line = `**${name}** — ${fmtCost(cost)} (${requests} req)`;
            if (liveName) {
                activeLines.push(line);
            } else {
                leftLines.push(line);
            }
        }

        activeLines.push('');
        activeLines.push(`**${t('Łącznie', 'Total')}** — **${fmtCost(totalCost)}**`);

        const currentMonthRaw = new Date().toISOString().slice(0, 7).replace('-', '');

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(t('📦 Całe zużycie — wszystkie miesiące', '📦 All-time Usage — all months'))
            .setDescription(activeLines.join('\n'));

        if (leftLines.length > 0) {
            embed.addFields({ name: t('🚪 Serwery bez aplikacji', '🚪 Servers no longer present'), value: leftLines.join('\n'), inline: false });
        }

        embed
            .addFields({ name: t('Cennik', 'Pricing'), value: `In $${PRICING.input}/1M • Out $${PRICING.output}/1M`, inline: false })
            .setTimestamp()
            .setFooter({ text: t('Dane z /update • wszystkie dostępne miesiące', 'Data from /update • all available months') });

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tk_m_${currentMonthRaw}_all_${userId}`)
                .setEmoji('🗂️').setLabel(t('Zbiorczo', 'Summary'))
                .setStyle(ButtonStyle.Secondary),
        );

        return { embeds: [embed], components: [navRow] };
    }

    async _buildTokensUsersEmbed(interaction, month, guildFilter, page, isSuperUser) {
        const PAGE_SIZE  = 20;
        const t = this._panelT(interaction.guildId);
        const [y, m]     = month.split('-').map(Number);
        const MONTH_NAMES_POL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
        const MONTH_NAMES_ENG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const monthLabel = `${t(MONTH_NAMES_POL[m - 1], MONTH_NAMES_ENG[m - 1])} ${y}`;
        const monthStr   = `${y}${String(m).padStart(2, '0')}`;
        const userId     = interaction.user.id;

        const fmtTok  = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
        const fmtCost = (c) => `$${c.toFixed(5)}`;

        const allStats   = this.tokenUsageService.getUsersMonthlyStats(month, guildFilter);
        const totalPages = Math.max(1, Math.ceil(allStats.length / PAGE_SIZE));
        const safePage   = Math.min(Math.max(page, 0), totalPages - 1);
        const pageStats  = allStats.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

        const getNick = (uId) => {
            const guilds = guildFilter !== 'all'
                ? [interaction.client.guilds.cache.get(guildFilter)].filter(Boolean)
                : this.config.getAllGuilds().map(gc => interaction.client.guilds.cache.get(gc.id)).filter(Boolean);
            for (const g of guilds) {
                const member = g.members.cache.get(uId);
                if (member) return member.displayName;
            }
            return `<@${uId}>`;
        };

        const lines = pageStats.map((u, i) => {
            const rank  = safePage * PAGE_SIZE + i + 1;
            const nick  = getNick(u.userId);
            const cols  = [`${rank}. **${nick}**`, `${u.requests} ${t('analiz', 'analyses')}`, `${fmtTok(u.promptTokens + u.outputTokens)} ${t('tok', 'tok')}`];
            if (isSuperUser) cols.push(fmtCost(u.cost));
            return cols.join(' — ');
        });

        const description = lines.length > 0 ? lines.join('\n') : t('Brak danych.', 'No data.');

        const guildNames = {};
        for (const gc of this.config.getAllGuilds()) {
            const g = interaction.client.guilds.cache.get(gc.id);
            guildNames[gc.id] = g?.name || gc.id;
        }
        const footerText = guildFilter === 'all' ? t('Wszystkie serwery', 'All servers') : (guildNames[guildFilter] || guildFilter);

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(t(`👥 Tokeny per user — ${monthLabel}`, `👥 Tokens per user — ${monthLabel}`))
            .setDescription(description)
            .setFooter({ text: `${footerText} • ${t('str.', 'p.')} ${safePage + 1}/${totalPages} • ${allStats.length} ${t('userów', 'users')}` })
            .setTimestamp();

        const hasPrevPage = safePage > 0;
        const hasNextPage = safePage < totalPages - 1;
        const chartId     = guildFilter === 'all'
            ? `tk_a_${monthStr}_${userId}`
            : `tk_g_${monthStr}_${guildFilter}_${userId}`;

        const row1 = [
            new ButtonBuilder().setCustomId(`tk_u_${monthStr}_${guildFilter}_${safePage - 1}_${userId}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(!hasPrevPage),
            new ButtonBuilder().setCustomId(`tk_ui_${monthStr}_${guildFilter}_${safePage}_${userId}`).setLabel(`${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId(`tk_u_${monthStr}_${guildFilter}_${safePage + 1}_${userId}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(!hasNextPage),
            new ButtonBuilder().setCustomId(chartId).setEmoji('📊').setLabel(t('Wykres', 'Chart')).setStyle(ButtonStyle.Secondary),
        ];
        if (isSuperUser) {
            row1.push(new ButtonBuilder()
                .setCustomId(`tk_u_${monthStr}_all_0_${userId}`)
                .setEmoji('🌐').setLabel(t('Wszystkie', 'All'))
                .setStyle(guildFilter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary));
        }

        const components = [new ActionRowBuilder().addComponents(...row1)];

        if (isSuperUser) {
            const guildButtons = this.config.getAllGuilds()
                .filter(gc => interaction.client.guilds.cache.has(gc.id))
                .map(gc => new ButtonBuilder()
                    .setCustomId(`tk_u_${monthStr}_${gc.id}_0_${userId}`)
                    .setLabel((guildNames[gc.id] || gc.id).slice(0, 20))
                    .setStyle(guildFilter === gc.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );
            for (let i = 0; i < guildButtons.length; i += 5) {
                components.push(new ActionRowBuilder().addComponents(guildButtons.slice(i, i + 5)));
            }
        }

        return { embeds: [embed], components };
    }

    async _handlePanelAchDel(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_ach_del_modal')
            .setTitle(t('🏆 Usuń osiągnięcia', '🏆 Remove Achievements'))
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ach_del_query')
                    .setLabel(t('Fragment nicku gracza', 'Player nick fragment'))
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(50)
            ));
        await interaction.showModal(modal);
    }

    async _handlePanelAchDelSearch(interaction) {
        const guildId = interaction.guildId;
        const t = this._panelT(guildId);
        const query = interaction.fields.getTextInputValue('ach_del_query').trim().toLowerCase();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const searchGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [guildId];
            const allMatches = [];
            for (const sgid of searchGuildIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if ((p.username || p.userId).toLowerCase().includes(query)) {
                        allMatches.push({ ...p, rank: i + 1, sgid, guildName });
                    }
                }
            }
            if (allMatches.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF6B35)
                        .setTitle(t('🏆 Nie znaleziono gracza', '🏆 Player Not Found'))
                        .setDescription(t(`Brak gracza z nickiem zawierającym "**${query}**".`, `No player with nick containing "**${query}**".`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const options = allMatches.slice(0, 25).map(p => ({
                label: `#${p.rank} ${(p.username || p.userId).slice(0, 60)}`.slice(0, 100),
                description: `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.userId}:${p.sgid}`,
            }));
            const subtitle = allMatches.length > 25
                ? t(`Znaleziono ${allMatches.length} — pokazuję 25. Zawęź wyszukiwanie.`, `Found ${allMatches.length} — showing 25. Narrow your search.`)
                : t(`Znaleziono ${allMatches.length} gracz(y).`, `Found ${allMatches.length} player(s).`);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF6B35)
                    .setTitle(t('🏆 Wybierz gracza', '🏆 Select Player'))
                    .setDescription(subtitle)],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('panel_ach_del_ps')
                            .setPlaceholder(t('Wybierz gracza...', 'Select player...'))
                            .addOptions(options)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelAchDelSearch (serwer "${interaction.guild?.name || guildId}"):`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania rankingu.', '❌ Error loading ranking.'), embeds: [], components: [] });
        }
    }

    async _handlePanelAchDelPlayerSelect(interaction) {
        const value = interaction.values[0]; // format: userId:guildId
        const [targetUserId, targetGuildId] = value.split(':');
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
            const players = await this.rankingService.getSortedPlayers(targetGuildId);
            const player = players.find(p => p.userId === targetUserId);
            const displayName = player?.username || targetUserId;
            const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = targetGuildName ? ` (${targetGuildName})` : '';

            const unlockedAchs = this.achievementService
                ? await this.achievementService.getUnlockedAchievements(targetGuildId, targetUserId)
                : [];

            if (unlockedAchs.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF6B35)
                        .setTitle(t('🏆 Brak osiągnięć', '🏆 No Achievements'))
                        .setDescription(t(
                            `Gracz **${displayName}**${serverNote} nie ma żadnych odblokowanych osiągnięć.`,
                            `Player **${displayName}**${serverNote} has no unlocked achievements.`
                        ))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }

            const achOptions = [
                {
                    label: t('🗑️ Usuń WSZYSTKIE osiągnięcia', '🗑️ Remove ALL achievements'),
                    description: t(`Usuwa wszystkie ${unlockedAchs.length} osiągnięcia i cały progress`, `Removes all ${unlockedAchs.length} achievements and all progress`).slice(0, 100),
                    value: `all:${targetUserId}:${targetGuildId}`,
                },
                ...unlockedAchs.slice(0, 24).map(a => ({
                    label: `${a.icon} ${(a.namePol || a.nameEng || a.id).slice(0, 90)}`.slice(0, 100),
                    description: (a.descPol || a.descEng || '').slice(0, 100),
                    value: `${a.id}:${targetUserId}:${targetGuildId}`,
                })),
            ];

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF6B35)
                    .setTitle(t('🏆 Wybierz osiągnięcie', '🏆 Select Achievement'))
                    .setDescription(t(
                        `Gracz: **${displayName}**${serverNote}\nOdblokowanych osiągnięć: **${unlockedAchs.length}**\n\nWybierz osiągnięcie do usunięcia lub opcję "Usuń wszystkie".`,
                        `Player: **${displayName}**${serverNote}\nUnlocked achievements: **${unlockedAchs.length}**\n\nSelect an achievement to remove or "Remove ALL".`
                    ))],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('panel_ach_del_as')
                            .setPlaceholder(t('Wybierz osiągnięcie...', 'Select achievement...'))
                            .addOptions(achOptions)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Nowe wyszukiwanie', 'New Search')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelAchDelPlayerSelect (gracz ${targetUserId}, serwer ${targetGuildId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania osiągnięć.', '❌ Error loading achievements.'), embeds: [], components: [] });
        }
    }

    async _handlePanelAchDelAchSelect(interaction) {
        const value = interaction.values[0]; // format: achId:userId:guildId  lub  all:userId:guildId
        const parts = value.split(':');
        // achId może zawierać '_' ale nie ':', więc pierwsze dwie ostatnie wartości to userId i guildId
        const targetGuildId = parts[parts.length - 1];
        const targetUserId = parts[parts.length - 2];
        const achId = parts.slice(0, parts.length - 2).join(':');
        const isAll = achId === 'all';
        const t = this._panelT(interaction.guildId);

        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => p.userId === targetUserId);
        const displayName = player?.username || targetUserId;
        const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
        const serverNote = targetGuildName ? ` (${targetGuildName})` : '';

        const confirmId = isAll
            ? `panel_ach_ok_all:${targetUserId}:${targetGuildId}`
            : `panel_ach_ok_1:${achId}:${targetUserId}:${targetGuildId}`;

        const descPol = isAll
            ? `Czy na pewno chcesz usunąć **WSZYSTKIE** osiągnięcia i cały progress gracza **${displayName}**${serverNote}?\n\nTej operacji nie można cofnąć.`
            : `Czy na pewno chcesz usunąć osiągnięcie **${achId}** gracza **${displayName}**${serverNote}?`;
        const descEng = isAll
            ? `Are you sure you want to remove **ALL** achievements and progress of player **${displayName}**${serverNote}?\n\nThis action cannot be undone.`
            : `Are you sure you want to remove achievement **${achId}** of player **${displayName}**${serverNote}?`;

        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF6B35)
                .setTitle(t('🏆 Potwierdzenie', '🏆 Confirm'))
                .setDescription(t(descPol, descEng))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(confirmId).setEmoji('✅').setLabel(t('Usuń', 'Remove')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    async _handlePanelAchDelConfirm(interaction, rawValue) {
        // rawValue: "all:{userId}:{guildId}" lub "1:{achId}:{userId}:{guildId}"
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
            if (!this.achievementService) {
                await interaction.editReply({ content: t('❌ Serwis osiągnięć niedostępny.', '❌ Achievement service unavailable.'), embeds: [], components: [] });
                return;
            }

            const parts = rawValue.split(':');
            const isAll = parts[0] === 'all';
            let targetUserId, targetGuildId, achId;

            if (isAll) {
                // all:{userId}:{guildId}
                [, targetUserId, targetGuildId] = parts;
            } else {
                // 1:{achId}:{userId}:{guildId}  (achId nie zawiera ':')
                targetGuildId = parts[parts.length - 1];
                targetUserId = parts[parts.length - 2];
                achId = parts.slice(1, parts.length - 2).join(':');
            }

            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';

            if (isAll) {
                await this.achievementService.resetAllAchievements(targetGuildId, targetUserId);
                await this.logService.logMessage('success', `Wszystkie osiągnięcia gracza ${targetUserId} usunięte (serwer ${targetGuildId}) przez panel admina`, interaction);
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0x57F287)
                        .setTitle(t('✅ Osiągnięcia usunięte', '✅ Achievements Removed'))
                        .setDescription(t(
                            `Wszystkie osiągnięcia gracza <@${targetUserId}>${serverNote} zostały usunięte.`,
                            `All achievements of player <@${targetUserId}>${serverNote} have been removed.`
                        ))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                    )]
                });
            } else {
                await this.achievementService.removeOneAchievement(targetGuildId, targetUserId, achId);
                await this.logService.logMessage('success', `Osiągnięcie "${achId}" gracza ${targetUserId} usunięte (serwer ${targetGuildId}) przez panel admina`, interaction);
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0x57F287)
                        .setTitle(t('✅ Osiągnięcie usunięte', '✅ Achievement Removed'))
                        .setDescription(t(
                            `Osiągnięcie **${achId}** gracza <@${targetUserId}>${serverNote} zostało usunięte.`,
                            `Achievement **${achId}** of player <@${targetUserId}>${serverNote} has been removed.`
                        ))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                    )]
                });
            }
        } catch (err) {
            logger.error(`Błąd _handlePanelAchDelConfirm (rawValue="${rawValue}"):`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania osiągnięcia.', '❌ Error removing achievement.'), embeds: [], components: [] });
        }
    }

    async _resolveTesterNames(testers, guild) {
        const nameMap = new Map();
        const toFetch = [];
        for (const te of testers) {
            if (te.username) {
                nameMap.set(te.userId, te.username);
            } else {
                const cached = guild.members.cache.get(te.userId);
                if (cached) {
                    nameMap.set(te.userId, cached.displayName || cached.user.username);
                } else {
                    toFetch.push(te.userId);
                }
            }
        }
        if (toFetch.length > 0) {
            try {
                const fetched = await guild.members.fetch({ user: toFetch });
                for (const [id, member] of fetched) {
                    nameMap.set(id, member.displayName || member.user.username);
                }
            } catch {}
        }
        return nameMap;
    }

    async _handlePanelTester(interaction) {
        const t = this._panelT(interaction.guildId);
        const testers = this.testerService ? this.testerService.getTesters() : [];
        let desc;
        if (testers.length > 0) {
            const nameMap = await this._resolveTesterNames(testers, interaction.guild);
            desc = testers.map((te, i) => {
                const name = nameMap.get(te.userId);
                return name
                    ? `${i + 1}. **${name}** (<@${te.userId}>)`
                    : `${i + 1}. <@${te.userId}>`;
            }).join('\n');
        } else {
            desc = t('Brak testerów.', 'No testers.');
        }
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('🧪 Testerzy OCR', '🧪 OCR Testers'))
            .setDescription(desc);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_tester_add').setEmoji('➕').setLabel(t('Dodaj', 'Add')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('panel_tester_remove').setEmoji('➖').setLabel(t('Usuń', 'Remove')).setStyle(ButtonStyle.Danger).setDisabled(testers.length === 0),
            new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
    }

    async _handlePanelTesterAdd(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_tester_add_modal')
            .setTitle(t('Dodaj testera', 'Add Tester'));
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('tester_user_id')
                    .setLabel(t('ID użytkownika Discord', 'Discord User ID'))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678')
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
    }

    async _handlePanelTesterAddModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const userId = interaction.fields.getTextInputValue('tester_user_id').trim();
        if (!/^\d{17,20}$/.test(userId)) {
            await interaction.reply({ content: t('❌ Nieprawidłowe ID użytkownika.', '❌ Invalid user ID.'), flags: ['Ephemeral'] });
            return;
        }
        let username = null;
        try {
            const member = await interaction.guild.members.fetch(userId);
            username = member.displayName || member.user.username || null;
        } catch {}
        const added = await this.testerService.addTester(userId, interaction.user.id, username);
        if (!added) {
            await interaction.reply({ content: t(`⚠️ Użytkownik <@${userId}> jest już testerem.`, `⚠️ User <@${userId}> is already a tester.`), flags: ['Ephemeral'] });
            return;
        }
        const displayName = username ? `**${username}** (<@${userId}>)` : `<@${userId}>`;
        await interaction.reply({ content: t(`✅ Dodano ${displayName} jako testera OCR.`, `✅ Added ${displayName} as OCR tester.`), flags: ['Ephemeral'] });
    }

    async _handlePanelTesterRemove(interaction) {
        const t = this._panelT(interaction.guildId);
        const testers = this.testerService ? this.testerService.getTesters() : [];
        if (testers.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFF8C00).setDescription(t('Brak testerów do usunięcia.', 'No testers to remove.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_tester').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary)
                )],
            });
            return;
        }
        const nameMap = await this._resolveTesterNames(testers.slice(0, 25), interaction.guild);
        const options = testers.slice(0, 25).map(te => ({
            label: (nameMap.get(te.userId) || te.userId).slice(0, 100),
            value: te.userId,
            description: t(`Dodany: ${new Date(te.addedAt).toLocaleDateString('pl-PL')}`, `Added: ${new Date(te.addedAt).toLocaleDateString('en-US')}`),
        }));
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('panel_tester_remove_select')
                .setPlaceholder(t('Wybierz testera do usunięcia', 'Select tester to remove'))
                .addOptions(options)
        );
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_tester').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(t('🧪 Usuń testera', '🧪 Remove Tester'))],
            components: [row, backRow],
        });
    }

    async _handlePanelTesterRemoveSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const userId = interaction.values[0];
        const removed = await this.testerService.removeTester(userId);
        if (!removed) {
            await interaction.reply({ content: t('❌ Nie znaleziono testera.', '❌ Tester not found.'), flags: ['Ephemeral'] });
            return;
        }
        await interaction.reply({ content: t(`✅ Usunięto <@${userId}> z listy testerów OCR.`, `✅ Removed <@${userId}> from OCR testers.`), flags: ['Ephemeral'] });
    }

    // =====================================================================
    // Panel Admina — Zbanuj serwer (Head Admin)
    // =====================================================================

    async _handlePanelUnconfigured(interaction) {
        const t = this._panelT(interaction.guildId);
        const allGuilds = interaction.client.guilds.cache;

        const unconfigured = [];
        for (const [guildId, guild] of allGuilds) {
            if (!this.guildConfigService.isConfigured(guildId)) {
                unconfigured.push({ id: guildId, name: guild.name, memberCount: guild.memberCount });
            }
        }

        let description;
        if (unconfigured.length === 0) {
            description = t('✅ Wszystkie serwery z botem są skonfigurowane.', '✅ All servers with the bot are configured.');
        } else {
            const lines = unconfigured.map(g => `• **${g.name}** (\`${g.id}\`) — ${g.memberCount} członków`);
            description = t(
                `⚠️ Serwery bez konfiguracji (${unconfigured.length}):\n\n${lines.join('\n')}\n\nBot wysyła codziennie wiadomość na tych serwerach z prośbą o uruchomienie \`/configure\`.`,
                `⚠️ Unconfigured servers (${unconfigured.length}):\n\n${lines.join('\n')}\n\nThe bot sends a daily message on these servers prompting an admin to run \`/configure\`.`
            );
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(unconfigured.length > 0 ? 0xFEE75C : 0x57F287)
                .setTitle(t('⚠️ Nieskonfigurowane serwery', '⚠️ Unconfigured Servers'))
                .setDescription(description)],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
            )]
        });
    }

    // =====================================================================

    async _handlePanelDiagnostics(interaction) {
        const { normalizeTiers } = require('../services/roleService');
        const { PermissionFlagsBits } = require('discord.js');
        const t = this._panelT(interaction.guildId);
        const guild = interaction.guild;
        const botMember = guild.members.me;
        const guildId = guild.id;
        const guildConfig = this.config.getGuildConfig(guildId);

        const lines = [];
        let issueCount = 0;

        // --- Kategoria 1: Uprawnienia serwera ---
        const SERVER_PERMS = [
            [PermissionFlagsBits.ManageRoles,        'ManageRoles',        t('wymagane do przyznawania ról TOP', 'required to assign TOP roles')],
            [PermissionFlagsBits.SendMessages,        'SendMessages',       t('wymagane do odpowiedzi na komendy', 'required to respond to commands')],
            [PermissionFlagsBits.EmbedLinks,          'EmbedLinks',         t('wymagane do wyświetlania embedów', 'required to display embeds')],
            [PermissionFlagsBits.ReadMessageHistory,  'ReadMessageHistory', t('wymagane do odczytu historii kanału', 'required to read channel history')],
            [PermissionFlagsBits.ViewChannel,         'ViewChannel',        t('wymagane do widzenia kanałów', 'required to see channels')],
            [PermissionFlagsBits.AttachFiles,         'AttachFiles',        t('wymagane do wysyłania plików', 'required to send files')],
        ];

        const serverPermsHeader = t('🔐 **Uprawnienia serwera**', '🔐 **Server Permissions**');
        const addIssue = (line) => { issueCount++; lines.push(line); };

        lines.push(serverPermsHeader);
        for (const [flag, name, reason] of SERVER_PERMS) {
            if (botMember.permissions.has(flag)) {
                lines.push(`✅ ${name}`);
            } else {
                addIssue(`❌ ${name} — ${reason}`);
            }
        }

        // --- Kategoria 2: Uprawnienia w kanale OCR ---
        lines.push('');
        const channelId = guildConfig?.allowedChannelId;
        const channel = channelId ? guild.channels.cache.get(channelId) : null;
        if (!channel) {
            lines.push(t('📺 **Uprawnienia w kanale OCR**', '📺 **OCR Channel Permissions**'));
            addIssue(t(`❌ Kanał OCR nieznaleziony w cache (ID: \`${channelId || 'brak'}\`)`, `❌ OCR channel not found in cache (ID: \`${channelId || 'none'}\`)`));
        } else {
            lines.push(t(`📺 **Uprawnienia w kanale #${channel.name}**`, `📺 **Permissions in #${channel.name}**`));
            const CHANNEL_PERMS = [
                [PermissionFlagsBits.ViewChannel,        'ViewChannel'],
                [PermissionFlagsBits.SendMessages,       'SendMessages'],
                [PermissionFlagsBits.EmbedLinks,         'EmbedLinks'],
                [PermissionFlagsBits.ReadMessageHistory, 'ReadMessageHistory'],
                [PermissionFlagsBits.AttachFiles,        'AttachFiles'],
            ];
            for (const [flag, name] of CHANNEL_PERMS) {
                const hasGlobal = botMember.permissions.has(flag);
                const hasChannel = botMember.permissionsIn(channel).has(flag);
                if (hasChannel) {
                    lines.push(`✅ ${name}`);
                } else if (hasGlobal) {
                    addIssue(`❌ ${name} — ` + t('zablokowane przez override kanału', 'blocked by channel override'));
                } else {
                    addIssue(`❌ ${name} — ` + t('brak uprawnienia', 'missing permission'));
                }
            }
        }

        // --- Kategoria 3: Kanały raportów ---
        const REPORT_CHANNEL_PERMS = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
        ];
        const checkReportChannel = (chId, label, useClientCache) => {
            const ch = useClientCache
                ? interaction.client.channels.cache.get(chId)
                : guild.channels.cache.get(chId);
            if (!ch) {
                addIssue(`❌ ${label} — ` + t(`kanał \`${chId}\` nieznaleziony w cache`, `channel \`${chId}\` not found in cache`));
                return;
            }
            const chPerms = botMember.permissionsIn(ch);
            const missing = REPORT_CHANNEL_PERMS.filter(f => !chPerms.has(f));
            if (missing.length) {
                const names = missing.map(f => Object.keys(PermissionFlagsBits).find(k => PermissionFlagsBits[k] === f));
                addIssue(`❌ ${label} #${ch.name} — ` + t(`brak: ${names.join(', ')}`, `missing: ${names.join(', ')}`));
            } else {
                lines.push(`✅ ${label} — #${ch.name}`);
            }
        };

        lines.push('');
        lines.push(t('📋 **Kanały raportów**', '📋 **Report Channels**'));

        // Per-guild: kanał odrzuconych screenów
        const invalidChId = guildConfig?.invalidReportChannelId;
        if (!invalidChId) {
            lines.push(t('ℹ️ Kanał odrzuconych screenów — nie skonfigurowany (opcjonalny)', 'ℹ️ Invalid screens channel — not configured (optional)'));
        } else {
            checkReportChannel(invalidChId, t('Odrzucone screeny (per-serwer)', 'Invalid screens (per-guild)'), false);
        }

        // Per-guild: kanał weryfikacji społeczności
        const cvConfig = this.guildConfigService?.getCommunityVerification(guildId);
        const cvChId = cvConfig?.rejectedChannelId;
        if (!cvConfig?.enabled) {
            lines.push(t('ℹ️ Weryfikacja społeczności — wyłączona', 'ℹ️ Community verification — disabled'));
        } else if (!cvChId) {
            lines.push(t('ℹ️ Kanał CV — nie skonfigurowany', 'ℹ️ CV channel — not configured'));
        } else {
            checkReportChannel(cvChId, t('Weryfikacja społeczności (per-serwer)', 'Community verification (per-guild)'), false);
        }

        // --- Kategoria 5: Hierarchia ról TOP ---
        lines.push('');
        lines.push(t('🏅 **Hierarchia ról TOP**', '🏅 **TOP Role Hierarchy**'));
        const botHighestPos = botMember.roles.highest.position;
        const botRoleName = botMember.roles.highest.name;
        const normalized = normalizeTiers(guildConfig?.topRoles || null);
        const tiers = normalized?.tiers || [];
        if (!tiers.length) {
            lines.push(t('ℹ️ Brak skonfigurowanych ról TOP', 'ℹ️ No TOP roles configured'));
        } else {
            for (const tier of tiers) {
                if (!tier.roleId) continue;
                const role = guild.roles.cache.get(tier.roleId);
                const label = `TOP ${tier.from}${tier.to !== tier.from ? `–${tier.to}` : ''}`;
                if (!role) {
                    addIssue(`⚠️ ${label} — ` + t(`rola \`${tier.roleId}\` nie istnieje`, `role \`${tier.roleId}\` does not exist`));
                } else if (role.position >= botHighestPos) {
                    addIssue(`❌ ${label} "${role.name}" ` + t(`(poz. ${role.position}) jest WYŻEJ niż "${botRoleName}" (poz. ${botHighestPos}) — bot nie może jej przyznać`, `(pos. ${role.position}) is ABOVE "${botRoleName}" (pos. ${botHighestPos}) — bot cannot assign it`));
                } else {
                    lines.push(`✅ ${label} "${role.name}"`);
                }
            }
        }

        // --- Intenty ---
        lines.push('');
        lines.push(t('🔧 **Intenty klienta**', '🔧 **Client Intents**'));
        const intents = interaction.client.options.intents;
        const { GatewayIntentBits } = require('discord.js');
        const intentChecks = [
            [GatewayIntentBits.GuildMembers,    t('GuildMembers (fetch memberów, rankingi ról)', 'GuildMembers (member fetch, role rankings)')],
            [GatewayIntentBits.MessageContent,  t('MessageContent (odczyt treści wiadomości)', 'MessageContent (reading message content)')],
        ];
        for (const [bit, label] of intentChecks) {
            if (intents.has(bit)) {
                lines.push(`✅ ${label}`);
            } else {
                addIssue(`❌ ${label}`);
            }
        }

        // --- Podsumowanie ---
        const hasIssues = issueCount > 0;
        const color = hasIssues ? 0xFF6B35 : 0x57F287;
        const summary = hasIssues
            ? t('Wykryto problemy — sprawdź szczegóły poniżej.', 'Issues detected — check details below.')
            : t('✅ Wszystko wygląda poprawnie.', '✅ Everything looks correct.');

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(t(`🔍 Diagnostyka — ${guild.name}`, `🔍 Diagnostics — ${guild.name}`))
            .setDescription(`${summary}\n\n${lines.join('\n')}`)
            .setFooter({ text: t(`Rola bota: "${botRoleName}" · poz. ${botHighestPos}`, `Bot role: "${botRoleName}" · pos. ${botHighestPos}`) })
            .setTimestamp();

        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_back_configure').setEmoji('◀️').setLabel(t('Wróć do konfiguracji', 'Back to Configuration')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [backRow] });
    }

    async _handlePanelBanServer(interaction) {
        const t = this._panelT(interaction.guildId);
        const bannedCount = this.guildBanService?.getBannedGuilds().length ?? 0;
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(t('🚫 Zbanuj serwer', '🚫 Ban Server'))
            .setDescription(
                t(
                    `Zablokuj serwer — bot wyjdzie z serwera i nie będzie mógł być ponownie dodany.\n\n🚫 **Zablokowane serwery:** ${bannedCount}`,
                    `Block a server — the bot will leave and cannot be re-added.\n\n🚫 **Banned servers:** ${bannedCount}`
                )
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_ban_guild').setEmoji('🚫').setLabel(t('Zablokuj serwer', 'Block Server')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_unban_guild').setEmoji('🔓').setLabel(t('Odblokuj serwer', 'Unblock Server')).setStyle(ButtonStyle.Secondary).setDisabled(bannedCount === 0),
            new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
    }

    async _handlePanelBanGuild(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_ban_guild_modal')
            .setTitle(t('Zbanuj serwer — wyszukaj', 'Ban Server — Search'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ban_guild_query')
                .setLabel(t('Fragment nazwy serwera', 'Part of server name'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Polski Squad', 'e.g. Gaming Hub'))
                .setMinLength(1)
                .setMaxLength(100)
                .setRequired(true)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelBanGuildSearch(interaction) {
        const t = this._panelT(interaction.guildId);
        const query = interaction.fields.getTextInputValue('ban_guild_query').toLowerCase().trim();
        await interaction.deferReply({ flags: ['Ephemeral'] });

        const matches = [];
        for (const [guildId, guild] of interaction.client.guilds.cache) {
            if (!guild.name.toLowerCase().includes(query)) continue;
            if (this.guildBanService?.isBanned(guildId)) continue;
            matches.push({ guildId, guildName: guild.name });
        }

        if (matches.length === 0) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF8C00)
                    .setDescription(t(`Brak aktywnego serwera z nazwą zawierającą "**${query}**".`, `No active server with name containing "**${query}**".`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ban_guild').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }

        const options = matches.slice(0, 25).map(({ guildId, guildName }) => ({
            label: guildName.substring(0, 100),
            description: guildId,
            value: guildId,
        }));

        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xFF0000)
                .setTitle(t('🚫 Wybierz serwer do zbanowania', '🚫 Select Server to Ban'))
                .setDescription(t(`Znaleziono **${matches.length}** serwer(ów). Wybierz z listy:`, `Found **${matches.length}** server(s). Select from the list:`))],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_ban_guild_sel')
                        .setPlaceholder(t('Wybierz serwer...', 'Select a server...'))
                        .addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ban_guild').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                ),
            ],
        });
    }

    async _handlePanelBanGuildSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const guildId = interaction.values[0];
        const guild = interaction.client.guilds.cache.get(guildId);
        const guildName = guild?.name || guildId;

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(t('⚠️ Potwierdź zbanowanie serwera', '⚠️ Confirm Server Ban'))
            .setDescription(
                t(
                    `Czy na pewno chcesz zbanować serwer **${guildName}**?\n\n` +
                    `• Bot **wyjdzie** z tego serwera\n` +
                    `• Serwer zostanie **trwale zablokowany** — bot nie będzie mógł być ponownie dodany\n` +
                    `• Odblokować może tylko Head Admin`,
                    `Are you sure you want to ban server **${guildName}**?\n\n` +
                    `• The bot will **leave** this server\n` +
                    `• The server will be **permanently blocked** — the bot cannot be re-added\n` +
                    `• Only a Head Admin can unban`
                )
            );
        if (guild?.iconURL()) embed.setThumbnail(guild.iconURL({ dynamic: true, size: 128 }));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`panel_ban_guild_ok_${guildId}`).setEmoji('✅').setLabel(t('Tak, zbanuj', 'Yes, ban')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('❌').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
    }

    async _handlePanelBanGuildConfirm(interaction, guildIdToBan) {
        const t = this._panelT(interaction.guildId);
        if (!this.guildBanService) {
            await interaction.update({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(t('❌ GuildBanService niedostępny.', '❌ GuildBanService unavailable.'))], components: [] });
            return;
        }

        const guild = interaction.client.guilds.cache.get(guildIdToBan);
        const guildName = guild?.name || guildIdToBan;
        const adminName = interaction.member?.displayName || interaction.user.username;

        await this.guildBanService.banGuild(guildIdToBan, guildName, adminName);

        // Wyjdź z serwera (fire-and-forget z logowaniem)
        if (guild) {
            guild.leave().catch(err => {
                logger.warn(`Błąd opuszczania serwera "${guildName}" po banie: ${err.message}`);
            });
        }

        const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        this.logService._gl(interaction.guildId).warn(`${this.logService.nickLink(nick, interaction.user.id)} Zbanowano serwer "${guildName}" (${guildIdToBan})`);

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle(t('✅ Serwer zbanowany', '✅ Server Banned'))
                .setDescription(t(
                    `Serwer **${guildName}** został zbanowany. Bot wychodzi z serwera i nie będzie mógł być ponownie dodany.`,
                    `Server **${guildName}** has been banned. The bot is leaving and cannot be re-added.`
                ))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _handlePanelUnbanGuild(interaction) {
        const t = this._panelT(interaction.guildId);
        const banned = this.guildBanService?.getBannedGuilds() ?? [];

        if (banned.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(t('Brak zbanowanych serwerów.', 'No banned servers.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }

        const options = banned.slice(0, 25).map(({ guildId, guildName, bannedAt }) => {
            const date = bannedAt ? new Date(bannedAt).toLocaleDateString('pl-PL') : '?';
            return {
                label: guildName.substring(0, 100),
                description: `ID: ${guildId} | ${t('Zbanowano', 'Banned')}: ${date}`,
                value: guildId,
            };
        });

        const embed = new EmbedBuilder()
            .setColor(0xFF8C00)
            .setTitle(t('🔓 Odblokuj serwer', '🔓 Unblock Server'))
            .setDescription(t(`Wybierz serwer do odblokowania (${banned.length} zbanowanych):`, `Select a server to unblock (${banned.length} banned):`));

        await interaction.update({
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_unban_guild_sel')
                        .setPlaceholder(t('Wybierz serwer...', 'Select a server...'))
                        .addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                ),
            ],
        });
    }

    async _handlePanelUnbanGuildSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const guildId = interaction.values[0];
        const info = this.guildBanService?.getBannedGuilds().find(g => g.guildId === guildId);
        const guildName = info?.guildName || guildId;

        await this.guildBanService?.unbanGuild(guildId);

        const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        this.logService._gl(interaction.guildId).info(`${this.logService.nickLink(nick, interaction.user.id)} Odbanowano serwer "${guildName}" (${guildId})`);

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x57F287)
                .setDescription(t(`✅ Serwer **${guildName}** został odblokowany.`, `✅ Server **${guildName}** has been unblocked.`))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _handleTop10IntervalModal(interaction) {
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const t = this._panelT(interaction.guildId);
        const raw = interaction.fields.getTextInputValue('top10_first_trigger').trim();

        if (!raw) {
            // Wyłącz harmonogram
            this.globalTop10Service.disableSchedule();
            await interaction.editReply({ content: t('✅ Raport TOP10 globalnego został **wyłączony**.', '✅ Global TOP10 report has been **disabled**.') });
            return;
        }

        // Parsuj format DD.MM.RRRR GG:MM
        const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
        if (!match) {
            await interaction.editReply({ content: t('❌ Nieprawidłowy format daty. Użyj: `DD.MM.RRRR GG:MM`', '❌ Invalid date format. Use: `DD.MM.YYYY HH:MM`') });
            return;
        }

        const [, dd, mm, yyyy, hh, min] = match;
        const date = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}T${hh.padStart(2,'0')}:${min}:00Z`);
        if (isNaN(date.getTime())) {
            await interaction.editReply({ content: t('❌ Podana data jest nieprawidłowa.', '❌ The provided date is invalid.') });
            return;
        }
        if (date.getTime() < Date.now()) {
            await interaction.editReply({ content: t('❌ Data pierwszego raportu nie może być w przeszłości.', '❌ The first report date cannot be in the past.') });
            return;
        }

        this.globalTop10Service.setSchedule(date.toISOString());

        const formatted = `${dd.padStart(2,'0')}.${mm.padStart(2,'0')}.${yyyy} ${hh.padStart(2,'0')}:${min}`;
        await interaction.editReply({
            content: t(
                `✅ Harmonogram TOP10 ustawiony.\n📅 Pierwszy raport: **${formatted}**\n🔁 Kolejne: co 3 dni (po 9 raportach — 4 dni przerwy, powtórz)`,
                `✅ TOP10 schedule set.\n📅 First report: **${formatted}**\n🔁 Subsequent: every 3 days (after 9 reports — 4 day break, repeat)`
            )
        });
    }

    // ─── Sprawdź gracza — osiągnięcia innego gracza ──────────────────────────

    async _handleAchCheckPlayer(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('ach_check_modal')
            .setTitle(t('Sprawdź gracza', 'Check Player'));
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ach_check_query')
                    .setLabel(t('Nick gracza (fragment nazwy)', 'Player nick (part of name)'))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(2)
                    .setMaxLength(50)
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
    }

    async _handleAchCheckModal(interaction) {
        const query = interaction.fields.getTextInputValue('ach_check_query').toLowerCase().trim();
        await interaction.deferUpdate();
        const t = this._panelT(interaction.guildId);

        try {
            const allGuildIds = new Set(interaction.client.guilds.cache.keys());
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);

            const matches = globalRanking.filter(p =>
                (p.username || '').toLowerCase().includes(query)
            );

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ach_vb')
                    .setEmoji('↩️').setLabel(t('Wróć', 'Back'))
                    .setStyle(ButtonStyle.Secondary)
            );

            if (matches.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF8C00)
                        .setDescription(t(
                            `Nie znaleziono gracza z nickiem zawierającym **"${query}"**.`,
                            `No player found with a nick containing **"${query}"**.`
                        ))],
                    components: [backRow]
                });
                return;
            }

            if (matches.length > 25) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF8C00)
                        .setDescription(t(
                            `Znaleziono zbyt wiele wyników (${matches.length}). Podaj dokładniejszy fragment nicku.`,
                            `Too many results (${matches.length}). Please provide a more specific name fragment.`
                        ))],
                    components: [backRow]
                });
                return;
            }

            const options = matches.map(p => ({
                label: p.username.substring(0, 100),
                description: t(
                    `Serwer: ${interaction.client.guilds.cache.get(p.sourceGuildId)?.name || p.sourceGuildId}`,
                    `Server: ${interaction.client.guilds.cache.get(p.sourceGuildId)?.name || p.sourceGuildId}`
                ).substring(0, 100),
                value: `${p.userId}:${p.sourceGuildId}`
            }));

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x5865f2)
                    .setTitle(t('🔍 Wybierz gracza', '🔍 Select a Player'))
                    .setDescription(t(
                        `Znaleziono **${matches.length}** graczy. Wybierz z listy:`,
                        `Found **${matches.length}** players. Select from the list:`
                    ))],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('ach_check_sel')
                            .setPlaceholder(t('Wybierz gracza...', 'Select a player...'))
                            .addOptions(options.map(o => new StringSelectMenuOptionBuilder()
                                .setLabel(o.label)
                                .setDescription(o.description)
                                .setValue(o.value)
                            ))
                    ),
                    backRow
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handleAchCheckModal: ${err.message}`);
            await interaction.editReply({ content: t('❌ Błąd podczas wyszukiwania gracza.', '❌ Error while searching for player.') });
        }
    }

    async _handleAchCheckSelect(interaction) {
        await interaction.deferUpdate();
        try {
            const [userId, guildId] = interaction.values[0].split(':');
            const allGuildIds = new Set(interaction.client.guilds.cache.keys());
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
            const player = globalRanking.find(p => p.userId === userId);
            const username = player?.username || userId;
            await this._showPlayerAchievements(interaction, userId, username, guildId);
        } catch (err) {
            logger.error(`Błąd _handleAchCheckSelect: ${err.message}`);
        }
    }

    async _showPlayerAchievements(interaction, targetUserId, targetUsername, sourceGuildId) {
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const { embed, components } = await this.achievementService.buildAchievementsViewForUser(
            sourceGuildId, targetUserId, targetUsername, lang, 'cat', 'score'
        );
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed], components });
        } else {
            await interaction.update({ embeds: [embed], components });
        }
    }

    async _handleAchViewOtherButton(interaction, customId) {
        await interaction.deferUpdate();
        try {
            const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';

            if (customId === 'ach_vb') {
                // Powrót do własnych osiągnięć
                const { embed, components } = await this.achievementService.buildAchievementsView(
                    interaction.guildId, interaction.user.id, lang, 'cat', 'score'
                );
                await interaction.editReply({ embeds: [embed], components });
                return;
            }

            // ach_vc_{category}_{userId}_{guildId}  lub  ach_vo_{userId}_{guildId}
            const isOverview = customId.startsWith('ach_vo_');
            let targetUserId, targetGuildId, category;

            if (isOverview) {
                // ach_vo_{userId}_{guildId}
                const parts = customId.replace('ach_vo_', '').split('_');
                targetUserId = parts[0];
                targetGuildId = parts[1];
            } else {
                // ach_vc_{category}_{userId}_{guildId}
                const withoutPrefix = customId.replace('ach_vc_', '');
                const firstUnderscore = withoutPrefix.indexOf('_');
                category = withoutPrefix.substring(0, firstUnderscore);
                const rest = withoutPrefix.substring(firstUnderscore + 1);
                const secondUnderscore = rest.indexOf('_');
                targetUserId = rest.substring(0, secondUnderscore);
                targetGuildId = rest.substring(secondUnderscore + 1);
            }

            const allGuildIds = new Set(interaction.client.guilds.cache.keys());
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
            const player = globalRanking.find(p => p.userId === targetUserId);
            const targetUsername = player?.username || targetUserId;

            const { embed, components } = await this.achievementService.buildAchievementsViewForUser(
                targetGuildId, targetUserId, targetUsername, lang,
                isOverview ? 'overview' : 'cat',
                isOverview ? null : category
            );
            await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
            logger.error(`Błąd _handleAchViewOtherButton: ${err.message}`);
        }
    }

    // ─── Ranking osiągnięć (/ranking-osiagniec) ───────────────────────────────

    _buildAchServerSelectRows(client, homeGuildId, isPol, page = 0) {
        const t = (pol, eng) => isPol ? pol : eng;
        const allGuilds = this.config.getAllGuilds().filter(gc => client.guilds.cache.has(gc.id));
        const otherGuilds = allGuilds.filter(gc => gc.id !== homeGuildId);

        const PER_PAGE = 20; // 4 wiersze × 5 = 20 slotów na inne serwery
        const totalPages = Math.max(1, Math.ceil(otherGuilds.length / PER_PAGE));
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const pageGuilds = otherGuilds.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

        const homeGuild = homeGuildId ? allGuilds.find(gc => gc.id === homeGuildId) : null;
        const homeLabel = homeGuild
            ? (client.guilds.cache.get(homeGuildId)?.name || homeGuildId).substring(0, 76)
            : '🏠';
        const safeHome = homeGuildId || '';

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ach_rank_srv_${safeHome}`)
                .setLabel(homeLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!safeHome),
            new ButtonBuilder()
                .setCustomId(`ach_rank_srv_prev_${safePage}_${safeHome}`)
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`ach_rank_srv_next_${safePage}_${safeHome}`)
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId('ach_rank_global')
                .setEmoji('🌐').setLabel(t('Global', 'Global'))
                .setStyle(ButtonStyle.Secondary)
        );

        const rows = [row1];
        for (let i = 0; i < pageGuilds.length; i += 5) {
            const rowBtns = pageGuilds.slice(i, i + 5).map(gc => {
                const guildName = client.guilds.cache.get(gc.id)?.name || gc.id;
                return new ButtonBuilder()
                    .setCustomId(`ach_rank_srv_${gc.id}`)
                    .setLabel(guildName.substring(0, 80))
                    .setStyle(ButtonStyle.Secondary);
            });
            rows.push(new ActionRowBuilder().addComponents(rowBtns));
        }
        return rows;
    }

    async handleAchRankingCommand(interaction) {
        if (!this._checkConfigured(interaction)) return;
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        try {
            const rows = this._buildAchServerSelectRows(interaction.client, interaction.guildId, isPol, 0);
            await interaction.editReply({
                content: t('🏆 Wybierz serwer lub globalny ranking osiągnięć:', '🏆 Select a server or global achievement ranking:'),
                components: rows
            });
        } catch (err) {
            logger.error(`Błąd handleAchRankingCommand: ${err.message}`);
            await interaction.editReply({ content: this.msgs(interaction.guildId).generalError });
        }
    }

    async _handleAchRankingBack(interaction) {
        await interaction.deferUpdate();
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const rows = this._buildAchServerSelectRows(interaction.client, interaction.guildId, isPol, 0);
        await interaction.editReply({
            content: t('🏆 Wybierz serwer:', '🏆 Select a server:'),
            embeds: [],
            components: rows
        });
    }

    async _handleAchRankingSrvPage(interaction, customId) {
        await interaction.deferUpdate();
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const isPrev = customId.startsWith('ach_rank_srv_prev_');
        const withoutPrefix = customId.replace(isPrev ? 'ach_rank_srv_prev_' : 'ach_rank_srv_next_', '');
        const underscoreIdx = withoutPrefix.indexOf('_');
        const currentPage = parseInt(withoutPrefix.substring(0, underscoreIdx)) || 0;
        const homeGuildId = withoutPrefix.substring(underscoreIdx + 1) || interaction.guildId;
        const newPage = isPrev ? currentPage - 1 : currentPage + 1;

        const rows = this._buildAchServerSelectRows(interaction.client, homeGuildId, isPol, newPage);
        await interaction.editReply({
            content: t('🏆 Wybierz serwer:', '🏆 Select a server:'),
            embeds: [],
            components: rows
        });
    }

    async _handleAchRankingSelect(interaction, customId) {
        await interaction.deferUpdate();
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const isPol = lang === 'pol';
        const perPage = this.config.ranking.playersPerPage;

        try {
            let players, mode, guildId = null, guildName = null, activeRoleId = null, parentGuildId = null, parentGuildName = null;

            let iconUrl = null;
            if (customId === 'ach_rank_global') {
                const prevState = this._achRankings.get(interaction.message.id);
                parentGuildId = prevState?.guildId || interaction.guildId || null;
                parentGuildName = prevState?.guildName || interaction.client.guilds.cache.get(parentGuildId)?.name || null;
                const allGuildIds = new Set(
                    this.config.getAllGuilds()
                        .filter(g => interaction.client.guilds.cache.has(g.id))
                        .map(g => g.id)
                );
                players = await this.achievementService.getGlobalAchievementRanking(allGuildIds, this.rankingService);
                mode = 'global';
                iconUrl = interaction.client.user?.displayAvatarURL({ size: 128 }) || null;
            } else if (customId.startsWith('ach_rank_role_')) {
                const withoutPrefix = customId.replace('ach_rank_role_', '');
                const underscoreIdx = withoutPrefix.indexOf('_');
                guildId = withoutPrefix.substring(0, underscoreIdx);
                activeRoleId = withoutPrefix.substring(underscoreIdx + 1);
                const guild = interaction.client.guilds.cache.get(guildId);
                guildName = guild?.name || guildId;
                players = await this.achievementService.getAchievementRankingByRole(
                    guildId, activeRoleId, guild, this.rankingService, this.roleRankingConfigService
                );
                mode = 'role';
                iconUrl = guild?.iconURL({ size: 128 }) || null;
            } else {
                guildId = customId.replace('ach_rank_srv_', '');
                const guild = interaction.client.guilds.cache.get(guildId);
                guildName = guild?.name || guildId;
                players = await this.achievementService.getAchievementRanking(guildId, this.rankingService);
                mode = 'server';
                iconUrl = guild?.iconURL({ size: 128 }) || null;
            }

            const totalPages = Math.ceil(players.length / perPage) || 1;

            // Strona wywołującego
            const callerIdx = players.findIndex(p => p.userId === interaction.user.id);
            const userPage = callerIdx !== -1 ? Math.floor(callerIdx / perPage) : null;

            // Przyciski ról (tylko dla trybu serwera)
            let roleRows = [];
            if ((mode === 'server' || mode === 'role') && guildId && this.roleRankingConfigService) {
                try {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    if (roleRankings.length > 0) {
                        roleRows = this.achievementService.createAchRankingRoleButtons(roleRankings, guildId, activeRoleId);
                    }
                } catch {}
            }

            const embed = this.achievementService.buildAchRankingEmbed(players, 0, perPage, mode, guildName, isPol, iconUrl, interaction.user.id);
            const buttons = this.achievementService.createAchRankingButtons(
                0, totalPages, mode, guildId, guildName, roleRows, isPol, userPage, parentGuildId, parentGuildName
            );

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons });

            this._achRankings.set(reply.id, {
                players, currentPage: 0, totalPages, perPage,
                userId: interaction.user.id, mode, guildId, guildName,
                roleRows, userPage, isPol, activeRoleId, parentGuildId, parentGuildName, iconUrl
            });
        } catch (err) {
            logger.error(`Błąd _handleAchRankingSelect: ${err.message}`);
        }
    }

    async _handleAchRankingPage(interaction, customId) {
        await interaction.deferUpdate();
        const data = this._achRankings.get(interaction.message.id);
        if (!data) {
            const t = this._panelT(interaction.guildId);
            await interaction.editReply({ content: t('⏱️ Sesja rankingu wygasła. Użyj komendy ponownie.', '⏱️ Ranking session expired. Use the command again.'), embeds: [], components: [] });
            return;
        }

        if (interaction.user.id !== data.userId) {
            const t = this._panelT(interaction.guildId);
            await interaction.followUp({ content: t('⛔ To nie jest Twój ranking.', '⛔ This is not your ranking.'), flags: ['Ephemeral'] });
            return;
        }

        if (customId === 'ach_rank_prev') data.currentPage = Math.max(0, data.currentPage - 1);
        else if (customId === 'ach_rank_next') data.currentPage = Math.min(data.totalPages - 1, data.currentPage + 1);
        else if (customId === 'ach_rank_mypos') data.currentPage = data.userPage ?? data.currentPage;

        this._achRankings.set(interaction.message.id, data);

        const embed = this.achievementService.buildAchRankingEmbed(
            data.players, data.currentPage, data.perPage, data.mode, data.guildName, data.isPol, data.iconUrl, data.userId
        );
        const buttons = this.achievementService.createAchRankingButtons(
            data.currentPage, data.totalPages, data.mode, data.guildId, data.guildName,
            data.roleRows, data.isPol, data.userPage, data.parentGuildId, data.parentGuildName
        );
        await interaction.editReply({ embeds: [embed], components: buttons });
    }
}

module.exports = InteractionHandler;
