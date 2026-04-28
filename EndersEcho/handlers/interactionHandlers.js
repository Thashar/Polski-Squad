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
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, botOps, guildConfigService, ocrBlockService, updateCooldownService, testerService) {
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
        // Tymczasowe sesje dla /info (userId -> { title, description, icon, image })
        this._infoSessions = new Map();
        // Stan wizarda /configure (userId_guildId -> { step data })
        this._configWizard = new Map();
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
                    option.setName('obraz')
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
                    option.setName('obraz')
                        .setDescription('Screenshot of the boss result screen')
                        .setDescriptionLocalizations(pl('Screenshot ekranu wyników bossa'))
                        .setRequired(true)),

            new SlashCommandBuilder()
                .setName('configure')
                .setDescription('Configure EndersEcho for this server (admins only)')
                .setDescriptionLocalizations(pl('Skonfiguruj EndersEcho na tym serwerze (tylko dla adminów)'))
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
                logger.info(`✅ Zarejestrowano komendy dla serwera ${guildId} (${cfg.lang || 'eng'})`);
            } catch (error) {
                logger.error(`Błąd rejestracji slash commands dla serwera ${guildId}:`, error);
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
            logger.info(`✅ Zarejestrowano komendy dla nowego serwera ${guildId}`);
        } catch (error) {
            logger.error(`Błąd rejestracji komend dla serwera ${guildId}:`, error);
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

            // Komendy działające bez konfiguracji (head admin / admin)
            if (interaction.commandName === 'configure') {
                await this.handleConfigureCommand(interaction);
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

            if (!this.isAllowedChannel(interaction.channel.id, guildId)) {
                await interaction.reply({
                    content: this.msgs(guildId).channelNotAllowed,
                    flags: ['Ephemeral']
                });
                return;
            }

            switch (interaction.commandName) {
                case 'ranking':   await this.handleRankingCommand(interaction);        break;
                case 'update':    await this.handleUpdateCommand(interaction);         break;
                case 'subscribe': await this.handleNotificationsCommand(interaction);  break;
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
            if (interaction.customId === 'panel_block_search_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBlockSearch(interaction);
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
            if (interaction.customId === 'cfg_roles_modal') {
                await this._handleConfigureRolesModal(interaction);
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
        const isPol = state.lang ? state.lang === 'pol' : (this.config.getGuildConfig(guildId)?.lang !== 'eng');
        const t = (pol, eng) => isPol ? pol : eng;

        const done = {
            1: !!state.lang,
            2: !!state.allowedChannelId,
            3: !!state.invalidReportChannelId,
            4: state.tag !== null && state.tag !== undefined,
            5: state.topRoles !== null || state.rolesSkipped,
            6: state.globalTop3Notifications !== null,
            7: state.roleRankingsDone === true,
        };
        const allDone = Object.values(done).every(Boolean);

        const btn = (n, labelPol, labelEng) => new ButtonBuilder()
            .setCustomId(`cfg_step_${n}`)
            .setLabel((done[n] ? '✅ ' : '🔘 ') + t(labelPol, labelEng))
            .setStyle(ButtonStyle.Secondary);

        const rows = [
            new ActionRowBuilder().addComponents(
                btn(1, '1. Język', '1. Language'),
                btn(2, '2. Kanał bota', '2. Bot Channel'),
                btn(3, '3. Kanał raportów', '3. Report Channel'),
            ),
            new ActionRowBuilder().addComponents(
                btn(4, '4. Tag serwera', '4. Server Tag'),
                btn(5, '5. Role TOP (opcjonalne)', '5. TOP Roles (optional)'),
                btn(6, '6. Powiadomienia Global TOP3', '6. Global TOP3 Notifications'),
                btn(7, '7. Ranking roli (opcjonalne)', '7. Role Rankings (optional)'),
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
                    .setLabel(t('🔒  Zaakceptuj konfigurację!', '🔒  Accept Configuration!'))
                    .setStyle(ButtonStyle.Success),
                cancelBtn
            ));
        } else {
            rows.push(new ActionRowBuilder().addComponents(cancelBtn));
        }

        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cfg_admin_panel')
                .setLabel(t('⚙️ Panel Admina', '⚙️ Admin Panel'))
                .setStyle(ButtonStyle.Secondary)
        ));

        const summaryLines = [
            done[1] ? `🌐 ${t('Język:', 'Language:')} ${state.lang === 'pol' ? '🇵🇱 Polish' : '🇬🇧 English'}` : null,
            done[2] ? `📡 ${t('Kanał:', 'Channel:')} <#${state.allowedChannelId}>` : null,
            done[3] ? `⚠️ ${t('Kanał raportów:', 'Report Channel:')} <#${state.invalidReportChannelId}>` : null,
            done[4] ? `🏷️ ${t('Tag:', 'Tag:')} ${state.tag}` : null,
            done[5] ? `🏆 ${t('Role TOP:', 'TOP Roles:')} ${state.rolesSkipped ? t('Pominięte', 'Skipped') : t('Skonfigurowane', 'Configured')}` : null,
            done[6] ? `🔔 ${t('Powiadomienia TOP3:', 'TOP3 Notifications:')} ${state.globalTop3Notifications ? t('Włączone', 'Enabled') : t('Wyłączone', 'Disabled')}` : null,
            done[7] ? `🏅 ${t('Ranking roli:', 'Role Rankings:')} ${t('Skonfigurowane', 'Configured')}` : null,
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
                    const commandsEnabled = !this.ocrBlockService.isBlocked(guildId, 'update') && !this.ocrBlockService.isBlocked(guildId, 'test');
                    const polOcrLine = commandsEnabled
                        ? '✅ Komendy `/update` i `/test` są **włączone** i można z nich korzystać.'
                        : '⚠️ Po aktywacji `/update` i `/test` będą **domyślnie wyłączone**. Skontaktuj się z @Thashar w celu odblokowania komend do analizy.';
                    const engOcrLine = commandsEnabled
                        ? '✅ Commands `/update` and `/test` are **enabled** and ready to use.'
                        : '⚠️ After activation `/update` and `/test` will be **disabled** by default. Contact @Thashar to unlock the analysis commands.';
                    return t(
                        '📋 **Przegląd kroków:**\n' +
                        '1️⃣  **Język** — interfejs po polsku lub angielsku\n' +
                        '2️⃣  **Kanał bota** — kanał dla `/update`, `/ranking` i `/subscribe`\n' +
                        '3️⃣  **Kanał raportów** — gdzie trafiają alerty o odrzuconych screenach\n' +
                        '4️⃣  **Tag serwera** — 1–4 znaki/emoji widoczne w globalnym rankingu\n' +
                        '5️⃣  **Role TOP** *(opcjonalne)* — automatyczne role za TOP30 na serwerze\n' +
                        '6️⃣  **Powiadomienia Global TOP3** — ogłoszenia gdy gracz wchodzi do globalnego TOP3\n' +
                        '7️⃣  **Ranking roli** *(opcjonalne)* — osobne rankingi dla posiadaczy wybranych ról\n\n' +
                        polOcrLine,
                        '📋 **Steps overview:**\n' +
                        '1️⃣  **Language** — Polish or English interface\n' +
                        '2️⃣  **Bot Channel** — where `/update`, `/ranking` and `/subscribe` work\n' +
                        '3️⃣  **Report Channel** — where rejected screenshot alerts appear\n' +
                        '4️⃣  **Server Tag** — 1–4 char/emoji shown in the global ranking\n' +
                        '5️⃣  **TOP Roles** *(optional)* — automatic roles based on server TOP30\n' +
                        '6️⃣  **Global TOP3 Notifications** — announcements when players enter global TOP3\n' +
                        '7️⃣  **Role Rankings** *(optional)* — separate rankings for holders of specific roles\n\n' +
                        engOcrLine
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
                this._configWizard.set(key, {
                    allowedChannelId: existing.allowedChannelId || null,
                    invalidReportChannelId: existing.invalidReportChannelId || null,
                    tag: existing.tag !== undefined ? existing.tag : null,
                    lang: existing.lang || null,
                    topRoles: existing.topRoles || null,
                    rolesSkipped: !existing.topRoles,
                    globalTop3Notifications: existing.globalTop3Notifications !== undefined
                        ? existing.globalTop3Notifications
                        : true,
                    roleRankingsDone: true,
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
                });
            }
        }

        const state = this._configWizard.get(key);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.reply({ embeds: [embed], components: rows, flags: ['Ephemeral'] });
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
        const backBtn = new ButtonBuilder().setCustomId('cfg_back').setLabel(t('← Powrót', '← Back')).setStyle(ButtonStyle.Secondary);

        if (step === 1) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🌐 Krok 1 — Język', '🌐 Step 1 — Language'))
                .setDescription(
                    t(
                        'Wybierz język interfejsu dla tego serwera.\nWszystkie wiadomości bota, powiadomienia i opisy komend będą wyświetlane w wybranym języku.',
                        'Choose the display language for this server.\nAll bot messages, notifications and command descriptions will appear in the selected language.'
                    )
                );
            const polBtn = new ButtonBuilder().setCustomId('cfg_lang_pol').setLabel(t('🇵🇱 Polski', '🇵🇱 Polish')).setStyle(ButtonStyle.Primary);
            const engBtn = new ButtonBuilder().setCustomId('cfg_lang_eng').setLabel(t('🇬🇧 Angielski', '🇬🇧 English')).setStyle(ButtonStyle.Primary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(polBtn, engBtn, backBtn)] });

        } else if (step === 2) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('📡 Krok 2 — Kanał bota', '📡 Step 2 — Bot Channel'))
                .setDescription(
                    t(
                        'Wybierz kanał, na którym użytkownicy będą używać komend EndersEcho.\n\n' +
                        '**Dostępne na tym kanale (wszyscy):**\n• `/update` — prześlij wynik\n• `/ranking` — wyświetl ranking\n• `/subscribe` — zarządzaj powiadomieniami\n\n' +
                        'Komendy adminów są dostępne przez **Panel Admina** w `/configure` z dowolnego kanału.',
                        'Choose the channel where users can run EndersEcho commands.\n\n' +
                        '**Available in this channel (all users):**\n• `/update` — submit a score\n• `/ranking` — view rankings\n• `/subscribe` — manage notifications\n\n' +
                        'Admin commands are available through the **Admin Panel** in `/configure` from any channel.'
                    )
                );
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('cfg_channel_select')
                .setPlaceholder(t('Wybierz kanał tekstowy...', 'Choose a text channel...'))
                .setChannelTypes(ChannelType.GuildText);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(backBtn)] });

        } else if (step === 3) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('⚠️ Krok 3 — Kanał raportów', '⚠️ Step 3 — Report Channel'))
                .setDescription(
                    t(
                        'Gdy użytkownik prześle screenshot, który zostanie odrzucony (podrobione zdjęcie, zły screen, brak Victory), raport jest generowany automatycznie.\n\nUstaw dedykowany kanał na swoim serwerze, na którym będą pojawiać się te raporty. Twoi moderatorzy będą mogli zatwierdzać lub blokować użytkowników bezpośrednio z serwera.',
                        'When a user submits a screenshot that is rejected (fake photo, wrong screen, no Victory found), a report is generated automatically.\n\nSet a dedicated channel on your server where these reports appear. Your moderators can then approve or block users directly from your server.'
                    )
                );
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('cfg_report_channel_select')
                .setPlaceholder(t('Wybierz kanał raportów...', 'Choose a report channel...'))
                .setChannelTypes(ChannelType.GuildText);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(backBtn)] });

        } else if (step === 4) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🏷️ Krok 4 — Tag serwera', '🏷️ Step 4 — Server Tag'))
                .setDescription(
                    t(
                        'Tag to krótki identyfikator (1–4 znaki) wyświetlany obok wyników Twojego serwera w globalnym rankingu.\n\nTag może być tekstem lub emoji.\nPrzykłady: 🇵🇱  ☆  Ӂ  US  PS  EU',
                        'The tag is a short identifier (1–4 characters) shown next to your server\'s players in the global ranking.\n\nThe tag can be text or an emoji.\nExamples: 🇵🇱  ☆  Ӂ  US  PS  EU'
                    )
                );
            const tagBtn = new ButtonBuilder().setCustomId('cfg_tag_open').setLabel(t('Wprowadź tag', 'Enter Tag')).setStyle(ButtonStyle.Primary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(tagBtn, backBtn)] });

        } else if (step === 5) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🏆 Krok 5 — Role TOP (opcjonalne)', '🏆 Step 5 — TOP Roles (optional)'))
                .setDescription(
                    t(
                        'Możesz przypisać specjalne role Discord graczom na podstawie ich pozycji w TOP30 serwera. To świetny sposób na wyróżnienie najbardziej aktywnych graczy.\n\n' +
                        '**Jak to działa:**\nKażdy raz gdy wynik gracza zostanie zaktualizowany, bot automatycznie przelicza ranking serwera i przypisuje role. Nie wymaga ręcznej pracy.\nGracze, którzy wypadną z danego poziomu, tracą rolę i mogą otrzymać niższą.\n\n' +
                        '**Poziomy ról:**\n🥇 TOP 1 — Najlepszy gracz serwera\n🥈 TOP 2 — Drugie miejsce\n🥉 TOP 3 — Trzecie miejsce\n⭐ TOP 4–10 — Silni gracze\n🎯 TOP 11–30 — Aktywni gracze\n\nMożesz pominąć ten krok i skonfigurować role później przez `/configure`.',
                        'You can assign special Discord roles to players based on their position in your server\'s TOP30 ranking. This highlights your most active players.\n\n' +
                        '**How it works:**\nEvery time a player\'s score is updated, the bot automatically recalculates the server ranking and reassigns roles in real time. No manual work needed.\nPlayers who drop out of a tier lose the role and may receive a lower one.\n\n' +
                        '**Role tiers:**\n🥇 TOP 1 — Best player on the server\n🥈 TOP 2 — Second place\n🥉 TOP 3 — Third place\n⭐ TOP 4–10 — Strong performers\n🎯 TOP 11–30 — Active players\n\nYou can skip this step and configure roles later by running `/configure` again.'
                    )
                );
            const configRolesBtn = new ButtonBuilder().setCustomId('cfg_roles_open').setLabel(t('Skonfiguruj role', 'Configure Roles')).setStyle(ButtonStyle.Primary);
            const skipBtn = new ButtonBuilder().setCustomId('cfg_roles_skip').setLabel(t('Pomiń', 'Skip')).setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(configRolesBtn, skipBtn, backBtn)] });

        } else if (step === 6) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🌐 Krok 6 — Powiadomienia Global TOP3', '🌐 Step 6 — Global TOP3 Notifications'))
                .setDescription(
                    t(
                        'Gdy jakikolwiek gracz z dowolnego serwera EndersEcho wbije nowy rekord i wejdzie do globalnego TOP3, bot może wysłać ogłoszenie na Twój kanał bota.\n\nOgłoszenie zawiera: kto wchodzi do TOP3, wynik i poprawę, z jakiego serwera pochodzi oraz aktualne podium globalnego TOP3.\n\nCzy chcesz otrzymywać te ogłoszenia?',
                        'When any player across all EndersEcho servers submits a new best score and enters the global TOP3 ranking, the bot can post an announcement in your Bot Channel.\n\nThe announcement includes: who entered TOP3, their score, which server they\'re from, and the current global TOP3 podium.\n\nWould you like to receive these announcements?'
                    )
                );
            const yesBtn = new ButtonBuilder().setCustomId('cfg_notif_yes').setLabel(t('✅ Tak, włącz', '✅ Yes, enable')).setStyle(ButtonStyle.Success);
            const noBtn = new ButtonBuilder().setCustomId('cfg_notif_no').setLabel(t('❌ Nie', '❌ No')).setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(yesBtn, noBtn, backBtn)] });

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
            const skipBtn = new ButtonBuilder()
                .setCustomId('cfg_role_ranking_skip')
                .setLabel(t('Gotowe / Pomiń', 'Done / Skip'))
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(addBtn, removeBtn, skipBtn, backBtn)] });
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
        }
    }

    async _handleConfigureTagModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired. Run `/configure` again.', flags: ['Ephemeral'] }); return; }

        const tag = interaction.fields.getTextInputValue('cfg_tag_input').trim();
        const isPol = state.lang === 'pol';
        const msgs = this.msgs(interaction.guildId);

        if (!tag) {
            await interaction.reply({ content: msgs.configureTagEmpty, flags: ['Ephemeral'] }); return;
        }
        // Policz widoczne znaki (emoji flagowe = 1 display char)
        const visLen = [...new Intl.Segmenter().segment(tag)].length;
        if (visLen > 4) {
            await interaction.reply({ content: msgs.configureTagTooLong, flags: ['Ephemeral'] }); return;
        }
        state.tag = tag;
        this._configWizard.set(key, state);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.update({ embeds: [embed], components: rows });
    }

    async _handleConfigureRolesModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired.', flags: ['Ephemeral'] }); return; }

        const topRoles = {};
        const fields = ['top1', 'top2', 'top3', 'top4to10', 'top11to30'];
        for (const f of fields) {
            try {
                const val = interaction.fields.getTextInputValue(`cfg_role_${f}`).trim();
                if (val && /^\d+$/.test(val)) topRoles[f] = val;
            } catch { /* pole opcjonalne */ }
        }
        state.topRoles = Object.keys(topRoles).length > 0 ? topRoles : null;
        state.rolesSkipped = false;
        this._configWizard.set(key, state);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.update({ embeds: [embed], components: rows });
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

        // Otwórz modal ról TOP
        if (customId === 'cfg_roles_open') {
            const existing = state.topRoles || {};
            const modal = new ModalBuilder()
                .setCustomId('cfg_roles_modal')
                .setTitle(t('🏆 Role TOP — ID ról', '🏆 TOP Roles — Role IDs'))
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cfg_role_top1')
                            .setLabel(t('🥇 TOP 1 — ID roli (opcjonalnie)', '🥇 TOP 1 — Role ID (optional)'))
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(existing.top1 || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cfg_role_top2')
                            .setLabel(t('🥈 TOP 2 — ID roli (opcjonalnie)', '🥈 TOP 2 — Role ID (optional)'))
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(existing.top2 || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cfg_role_top3')
                            .setLabel(t('🥉 TOP 3 — ID roli (opcjonalnie)', '🥉 TOP 3 — Role ID (optional)'))
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(existing.top3 || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cfg_role_top4to10')
                            .setLabel(t('⭐ TOP 4–10 — ID roli (opcjonalnie)', '⭐ TOP 4–10 — Role ID (optional)'))
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(existing.top4to10 || '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('cfg_role_top11to30')
                            .setLabel(t('🎯 TOP 11–30 — ID roli (opcjonalnie)', '🎯 TOP 11–30 — Role ID (optional)'))
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(existing.top11to30 || '')
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        // Pomiń role
        if (customId === 'cfg_roles_skip') {
            state.topRoles = null;
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
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
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
                topRoles: state.topRoles || null,
                globalTop3Notifications: state.globalTop3Notifications !== false,
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

            const finalMsgs = this.config.getMessages(interaction.guildId);
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle(t('✅ Konfiguracja zapisana!', '✅ Configuration saved!'))
                        .setDescription(finalMsgs.configureSaved)
                ],
                components: []
            });

            // Powiadomienie na kanał raportów o w pełni skonfigurowanym serwerze
            const reportChannelId = this.config.invalidReportChannelId;
            if (reportChannelId) {
                try {
                    const reportChannel = await interaction.client.channels.fetch(reportChannelId);
                    if (reportChannel) {
                        const configEmbed = new EmbedBuilder()
                            .setColor(0x5865F2)
                            .setTitle(`⚙️ Serwer w pełni skonfigurowany${wasAlreadyConfigured ? ' (rekonfiguracja)' : ''}`)
                            .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                            .addFields(
                                { name: 'Serwer', value: `${interaction.guild.name} (\`${interaction.guildId}\`)` },
                                { name: 'Administrator', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
                                { name: 'Kanał bota', value: `<#${newData.allowedChannelId}>` },
                                { name: 'Język', value: newData.lang || 'pol' },
                                { name: 'Tag', value: newData.tag || '—' },
                                { name: 'Role TOP', value: newData.topRoles ? '✅ Skonfigurowane' : '❌ Brak' },
                                { name: 'Kanał raportów', value: newData.invalidReportChannelId ? `<#${newData.invalidReportChannelId}>` : '—' }
                            )
                            .setTimestamp();
                        await reportChannel.send({ embeds: [configEmbed] });
                    }
                } catch (err) {
                    logger.error(`Błąd wysyłania powiadomienia cfg_accept (guildId=${interaction.guildId}):`, err.message);
                }
            }
            return;
        }
    }

    // =====================================================================
    // Panel Admina — dostępny z /configure → przycisk cfg_admin_panel
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
        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('⚙️ Panel Administracyjny', '⚙️ Admin Panel'))
            .setDescription(
                `**${t('Tryb', 'Mode')}: ${isHeadAdmin ? 'Head Admin' : 'Admin'}**\n\n` +
                (isHeadAdmin
                    ? t('Pełny dostęp do wszystkich operacji administracyjnych.', 'Full access to all administrative operations.')
                    : t('Dostęp do podstawowych operacji administracyjnych.', 'Access to basic administrative operations.'))
            );

        // Rząd 1: operacje gracza (wszyscy admini)
        const row1Components = [
            new ButtonBuilder().setCustomId('panel_remove').setLabel(t('🗑️ Usuń gracza z rankingu', '🗑️ Remove Player from Ranking')).setStyle(ButtonStyle.Danger),
        ];
        if (isHeadAdmin) {
            row1Components.push(
                new ButtonBuilder().setCustomId('panel_block').setLabel(t('🔒 Zablokuj gracza', '🔒 Block Player')).setStyle(ButtonStyle.Danger),
            );
        }
        row1Components.push(
            new ButtonBuilder().setCustomId('panel_unblock').setLabel(t('🔓 Odblokuj gracza', '🔓 Unblock Player')).setStyle(ButtonStyle.Secondary),
        );
        const row1 = new ActionRowBuilder().addComponents(...row1Components);

        // Rząd 2: narzędzia (tokeny dla wszystkich, OCR+Limity tylko Head Admin)
        const row2Components = [
            new ButtonBuilder().setCustomId('panel_tokens').setLabel(t('📊 Zużycie tokenów', '📊 Token Usage')).setStyle(ButtonStyle.Secondary),
        ];
        if (isHeadAdmin) {
            row2Components.push(
                new ButtonBuilder().setCustomId('panel_ocr').setLabel(t('🔄 AI OCR on/off', '🔄 AI OCR on/off')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_limit').setLabel(t('⚙️ Ustaw limity', '⚙️ Set Limits')).setStyle(ButtonStyle.Primary),
            );
        }
        const row2 = new ActionRowBuilder().addComponents(...row2Components);

        // Rząd (2 lub 3): wróć do konfiguracji
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_back_configure').setLabel(t('◀️ Wróć do konfiguracji', '◀️ Back to Configure')).setStyle(ButtonStyle.Secondary),
        );

        const components = [row1, row2];
        if (isHeadAdmin) {
            // Rząd 3: Head Admin only — Wyślij Info + Testerzy
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_info').setLabel(t('📢 Wyślij Info', '📢 Send Info')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_tester').setLabel(t('🧪 Dodaj/usuń testera', '🧪 Add/Remove Tester')).setStyle(ButtonStyle.Primary),
            ));
        }
        components.push(backRow);

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
                        new ButtonBuilder().setCustomId('panel_remove').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                        new ButtonBuilder().setCustomId('panel_remove').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveSearch (guildId=${guildId}):`, err);
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
                new ButtonBuilder().setCustomId(`panel_remove_confirm_${targetUserId}:${targetGuildId}`).setLabel(t('✅ Usuń', '✅ Remove')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Anuluj', '◀️ Cancel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    async _handlePanelRemoveConfirm(interaction, rawValue) {
        // rawValue: "userId:targetGuildId" (zawiera docelowy serwer, niekoniecznie bieżący)
        const [targetUserId, targetGuildId] = rawValue.split(':');
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
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
                await this.logService.logMessage('success', `Gracz ${targetUserId} usunięty z rankingu (serwer ${targetGuildId}) przez panel admina`, interaction);
            } catch (roleError) {
                logger.warn(`Błąd aktualizacji ról TOP po usunięciu (panel): ${roleError.message}`);
            }
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle(t('✅ Gracz usunięty', '✅ Player Removed'))
                    .setDescription(t(`Gracz <@${targetUserId}> został usunięty z rankingu${serverNote}.`, `Player <@${targetUserId}> has been removed from the ranking${serverNote}.`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveConfirm (targetGuildId=${targetGuildId}, userId=${targetUserId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania gracza.', '❌ Error removing player.'), embeds: [], components: [] });
        }
    }

    async _handlePanelUnblock(interaction) {
        const guildId = interaction.guildId;
        const msgs = this.msgs(guildId);
        const t = this._panelT(guildId);
        const blocked = this.userBlockService.getBlockedUsers();
        if (blocked.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(t('🔓 Odblokuj gracza', '🔓 Unblock Player')).setDescription(msgs.unblockNoBlocked)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót', '◀️ Back')).setStyle(ButtonStyle.Secondary)
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
        const query = interaction.fields.getTextInputValue('unblock_query').trim().toLowerCase();
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const blocked = this.userBlockService.getBlockedUsers();
        const filtered = blocked.filter(e => e.username.toLowerCase().includes(query));
        if (filtered.length === 0) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🔓 Nie znaleziono', '🔓 Not Found'))
                    .setDescription(t(`Brak zablokowanego gracza z nickiem zawierającym "**${query}**".`, `No blocked player with nick containing "**${query}**".`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_unblock').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
                )]
            });
            return;
        }
        const options = filtered.slice(0, 25).map(entry => {
            const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil);
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
                        const timeLabel = this.userBlockService.formatTimeRemaining(entry.blockedUntil);
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
                    new ButtonBuilder().setCustomId('panel_unblock').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
                )
            ]
        });
    }

    async _handlePanelTokens(interaction) {
        await interaction.deferUpdate();
        const month = new Date().toISOString().slice(0, 7);
        const isSuperUser = this._isHeadAdmin(interaction.user.id);
        const guildFilter = isSuperUser ? 'all' : interaction.guildId;
        const t = this._panelT(interaction.guildId);
        const reply = await this._buildTokensEmbed(interaction, month, guildFilter, isSuperUser);
        if (reply.components.length < 5) {
            reply.components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
            ));
        }
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
            const alreadyBlocked = new Set(this.userBlockService.getBlockedUsers().map(e => e.userId));
            const notBlocked = allMatches.filter(p => !alreadyBlocked.has(p.userId));
            const alreadyBlockedMatches = allMatches.filter(p => alreadyBlocked.has(p.userId));

            if (allMatches.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF4444)
                        .setTitle(t('🔒 Nie znaleziono gracza', '🔒 Player Not Found'))
                        .setDescription(t(`Brak gracza z nickiem zawierającym "**${query}**".`, `No player with nick containing "**${query}**".`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_block').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                        new ButtonBuilder().setCustomId('panel_block').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                        new ButtonBuilder().setCustomId('panel_block').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelBlockSearch (guildId=${interaction.guildId}):`, err);
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
                    .setLabel(t('⏱️ Ustaw czas blokady', '⏱️ Set Block Duration'))
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_block').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                ? this.userBlockService.formatTimeRemaining(blockedUntil)
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
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelBlockModal (userId=${targetUserId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd blokowania gracza.', '❌ Error blocking player.'), embeds: [], components: [] });
        }
    }

    async _handlePanelOcr(interaction) {
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
        await interaction.deferReply({ flags: ['Ephemeral'] });
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
                    new ButtonBuilder().setCustomId('panel_ocr').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                        new ButtonBuilder().setCustomId(`panel_ocr_en_update_${gid}`).setLabel(t('🔓 Włącz /update', '🔓 Enable /update')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_en_test_${gid}`).setLabel(t('🔓 Włącz /test', '🔓 Enable /test')).setStyle(ButtonStyle.Success).setDisabled(!testBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_en_both_${gid}`).setLabel(t('🔓 Włącz oba', '🔓 Enable Both')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked && !testBlocked),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_update_${gid}`).setLabel(t('🔒 Wyłącz /update', '🔒 Disable /update')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_test_${gid}`).setLabel(t('🔒 Wyłącz /test', '🔒 Disable /test')).setStyle(ButtonStyle.Danger).setDisabled(testBlocked),
                        new ButtonBuilder().setCustomId(`panel_ocr_dis_both_${gid}`).setLabel(t('🔒 Wyłącz oba', '🔒 Disable Both')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked && testBlocked),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_ocr').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                    new ButtonBuilder().setCustomId('panel_ocr').setLabel(t('🔍 Szukaj ponownie', '🔍 Search Again')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Do panelu', '◀️ To Panel')).setStyle(ButtonStyle.Secondary),
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
                    new ButtonBuilder().setCustomId(`panel_ocr_en_update_${gid}`).setLabel(t('🔓 Włącz /update', '🔓 Enable /update')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_en_test_${gid}`).setLabel(t('🔓 Włącz /test', '🔓 Enable /test')).setStyle(ButtonStyle.Success).setDisabled(!testBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_en_both_${gid}`).setLabel(t('🔓 Włącz oba', '🔓 Enable Both')).setStyle(ButtonStyle.Success).setDisabled(!updateBlocked && !testBlocked),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_update_${gid}`).setLabel(t('🔒 Wyłącz /update', '🔒 Disable /update')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_test_${gid}`).setLabel(t('🔒 Wyłącz /test', '🔒 Disable /test')).setStyle(ButtonStyle.Danger).setDisabled(testBlocked),
                    new ButtonBuilder().setCustomId(`panel_ocr_dis_both_${gid}`).setLabel(t('🔒 Wyłącz oba', '🔒 Disable Both')).setStyle(ButtonStyle.Danger).setDisabled(updateBlocked && testBlocked),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót', '◀️ Back')).setStyle(ButtonStyle.Secondary)
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
                    new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót', '◀️ Back')).setStyle(ButtonStyle.Secondary)
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
                new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
            )]
        });
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

        // Cooldown /update (nie dotyczy /test)
        if (!dryRun && this.updateCooldownService) {
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
        await interaction.editReply({ content: msgs.updateProcessing });

        // Ustaw cooldown od razu — chroni przed spamem niezależnie od wyniku OCR
        if (!dryRun && this.updateCooldownService) {
            await this.updateCooldownService.setCooldown(interaction.user.id);
        }

        let tempImagePath = null;

        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });

            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);

            const displayNameForLog = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            gl.info(`🤖 [/${commandName}] Uruchamiam analizę z weryfikacją wzorca dla ${displayNameForLog}${dryRun ? ' (tryb testowy)' : ''}`);

            // ── Operations Gateway (authorize + root span + record) ───────────
            const op = await this.botOps.run({
                type:  OPERATIONS_TYPE,
                actor: { discordId: interaction.user.id },
                scope: { guildId: interaction.guildId, channelId: interaction.channelId },
                hints: { command: commandName },
            }, async (ctx) => {
                const guildLang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
                const ai = await this.aiOcrService.analyzeTestImage(tempImagePath, gl, ctx.telemetryMeta, guildLang);
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
                gl.warn(`❌ [/${commandName}] Odrzucono: NOT_SIMILAR`);
                await this._sendInvalidScreenReport(interaction, tempImagePath, 'NOT_SIMILAR', gl, aiResult.rejectionReason);
                const notSimilarDesc = aiResult.rejectionReason
                    ? `**${msgs.testNotSimilarReasonLabel}:** ${aiResult.rejectionReason}`
                    : null;
                await interaction.editReply({
                    content: '',
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle(msgs.testNotSimilarTitle)
                        .setDescription(notSimilarDesc)
                        .setTimestamp()]
                });
                return;
            }

            if (!aiResult.isValidVictory) {
                gl.warn(`❌ [/${commandName}] Odrzucono: ${aiResult.error || 'VALIDATION_FAILED'}`);
                await this._sendInvalidScreenReport(interaction, tempImagePath, aiResult.error, gl);
                await interaction.editReply(msgs.invalidScreenshot);
                return;
            }

            const bestScore = aiResult.score;
            const bossName = aiResult.bossName;
            gl.success(`✅ [/${commandName}] AI OCR: wynik="${bestScore}", boss="${bossName}"${aiResult.total ? `, total="${aiResult.total}"` : ''}`);

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
                gl.success(`✅ [${userName}] Role TOP zaktualizowane po nowym rekordzie`);
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

                if (newGlobalPosition && newGlobalPosition <= 3) {
                    const prevGlobalUser = prevGlobalRanking.find(p => p.userId === userId);
                    const newGlobalUser = newGlobalRanking[newGlobalUserIndex];
                    const globalScoreChanged = !prevGlobalUser || newGlobalUser.scoreValue > prevGlobalUser.scoreValue;
                    const positionChanged = prevGlobalPosition !== newGlobalPosition;

                    if (globalScoreChanged && positionChanged) {
                        const sourceGuildName = interaction.guild.name;
                        const notifAvatarUrl = interaction.user.displayAvatarURL();

                        const allNotifGuilds = this.config.getAllGuilds()
                            .filter(g => g.globalTop3Notifications !== false)
                            .filter(g => interaction.client.guilds.cache.has(g.id));
                        gl.info(`🌐 Global Top 3: ${prevGlobalPosition ?? 'brak'}→${newGlobalPosition} — wysyłam do ${allNotifGuilds.length} serwerów`);

                        const sentTo = [];
                        const failedAt = [];

                        for (const guildCfg of allNotifGuilds) {
                            const guildName = interaction.client.guilds.cache.get(guildCfg.id)?.name || guildCfg.id;
                            try {
                                // Pobieramy kanał bezpośrednio przez klienta bota, żeby mieć pewność tokenu
                                let channel;
                                try {
                                    channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                                } catch (fetchErr) {
                                    failedAt.push(`${guildName} (${fetchErr.message})`);
                                    continue;
                                }
                                if (!channel) {
                                    failedAt.push(`${guildName} (brak kanału)`);
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
                                    notifImageRef,
                                    newGlobalRanking.slice(0, 3)
                                );

                                const sendPayload = { embeds: [globalEmbed] };
                                if (notifFiles) sendPayload.files = notifFiles;
                                await channel.send(sendPayload);
                                sentTo.push(guildName);
                            } catch (notifError) {
                                failedAt.push(`${guildName} (${notifError.message})`);
                            }
                        }

                        const sentPart = sentTo.length ? `✅ ${sentTo.join(', ')}` : '';
                        const failPart = failedAt.length ? `❌ ${failedAt.join(', ')}` : '';
                        gl.info(`🌐 Global Top 3 wysłano: ${[sentPart, failPart].filter(Boolean).join(' | ')}`);
                    } else {
                        gl.info(`🌐 Global Top 3: pos=${newGlobalPosition} (bez zmian) — warunki nie spełnione`);
                    }
                } else {
                    gl.info(`🌐 Global Top 3: pos=${newGlobalPosition ?? 'brak'} — nie wysyłam powiadomień`);
                }
            } catch (globalCheckError) {
                gl.error(`❌ Błąd sprawdzania/wysyłania Global Top 3: ${globalCheckError.message}`);
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

            // === Przyciski Panelu Admina ===
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
                await interaction.showModal(this._buildInfoModal(prefill));
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
            if (customId === 'panel_tester_remove_select') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelTesterRemoveSelect(interaction);
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

            // === Przyciski wizarda /configure ===
            if (customId.startsWith('cfg_step_') || customId === 'cfg_back' || customId === 'cfg_tag_open' ||
                customId === 'cfg_lang_pol' || customId === 'cfg_lang_eng' ||
                customId === 'cfg_roles_open' || customId === 'cfg_roles_skip' ||
                customId === 'cfg_notif_yes' || customId === 'cfg_notif_no' ||
                customId === 'cfg_role_ranking_add' || customId === 'cfg_role_ranking_remove' || customId === 'cfg_role_ranking_skip' ||
                customId === 'cfg_accept' || customId === 'cfg_cancel') {
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
        await this._showConfigureStep(interaction, 7);
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

            if (customId === 'panel_remove_select') {
                await this._handlePanelRemoveSelect(interaction);
                return;
            }

            if (customId === 'panel_unblock_select') {
                const msgs = this.msgs(interaction.guildId);
                const t = this._panelT(interaction.guildId);
                const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
                const targetUserId = interaction.values[0];
                const entry = this.userBlockService.getBlockedUsers().find(e => e.userId === targetUserId);
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
                            new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
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
                        new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
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

            if (customId === 'ee_unblock_select') {
                const msgs = this.msgs(interaction.guildId);
                if (!interaction.member.permissions.has('Administrator')) {
                    await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
                const targetUserId = interaction.values[0];
                const entry = this.userBlockService.getBlockedUsers().find(e => e.userId === targetUserId);
                if (entry?.blockedByHeadAdmin && !isHeadAdmin) {
                    await interaction.update({
                        content: `⛔ **${entry.username}** został zablokowany przez Head Admina. Tylko Head Admin może go odblokować.`,
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
        await interaction.showModal(this._buildInfoModal(prefill));
    }

    /**
     * Obsługuje submit modala /info — zapisuje dane, pokazuje podgląd z przyciskami.
     */
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
        this._infoSessions.set(interaction.user.id, data);

        const embedPol = this._buildInfoEmbed(data, interaction.user, descriptionPol);
        const embedEng = this._buildInfoEmbed(data, interaction.user, descriptionEng);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('info_send').setLabel('Wyślij').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('info_edit').setLabel('Edytuj').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('info_cancel').setLabel('Anuluj').setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `${formatMessage(msgs.infoPreview, { count: this.config.getAllGuilds().length })}\n🇵🇱 **Podgląd PL** (powyżej) • 🇬🇧 **Podgląd ENG** (poniżej)`,
            embeds: [embedPol, embedEng],
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
        let sent = 0;
        let failed = 0;

        for (const guildCfg of this.config.getAllGuilds()) {
            try {
                const channel = await interaction.client.channels.fetch(guildCfg.allowedChannelId);
                if (!channel) { failed++; continue; }
                const description = guildCfg.lang === 'pol' ? data.descriptionPol : data.descriptionEng;
                const embed = this._buildInfoEmbed(data, data.user, description);
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

        const footerInfo = this._parseReportFooter(interaction.message.embeds[0]?.footer?.text);

        await interaction.deferUpdate();

        const parts = customId.split('_');
        const targetUserId = parts[2];
        const targetGuildId = parts[3];

        // Obraz jest w polu embed.image — Discord zwraca już pełny CDN URL po wysłaniu
        const imageUrl = interaction.message.embeds[0]?.image?.url;
        if (!imageUrl) {
            await interaction.editReply({
                content: '❌ Brak zdjęcia w raporcie.',
                embeds: interaction.message.embeds,
                attachments: [],
                components: [],
            });
            return;
        }

        const targetMsgs = this.config.getMessages(targetGuildId);
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        const adminName = interaction.member?.displayName || interaction.user.username;

        const applyToCurrentMsg = async (extraInfo) => {
            const updatedEmbeds = this._buildActionEmbeds(
                interaction.message.embeds, targetMsgs, serverName, 'analyzed', adminName, extraInfo
            );
            await interaction.editReply({
                embeds: updatedEmbeds,
                components: [],
            });
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
                this.tokenUsageService.record(targetGuildId, promptTokens, outputTokens).catch(() => {});
                gl.info(`🪙 Tokeny AI: input=${promptTokens}, output=${outputTokens}`);
            }

            if (!aiResult.isValidVictory || !aiResult.score) {
                gl.warn(`⚠️ [Analizuj] Wynik OCR nieprawidłowy — isValidVictory=${aiResult.isValidVictory}, score=${aiResult.score}, error=${aiResult.error}`);
                const extraInfo = formatMessage(targetMsgs.analyzeResultFail, { adminName, error: aiResult.error || targetMsgs.analyzeResultUnknown });
                await applyToCurrentMsg(extraInfo);
                await applyToOtherMsg(extraInfo);
                return;
            }

            gl.success(`✅ [Analizuj] AI OCR: wynik="${aiResult.score}", boss="${aiResult.bossName}"`);

            // Pobierz nick z embeda raportu (pole może być w języku serwera)
            const embedFields = interaction.message.embeds[0]?.fields || [];
            const nickField = embedFields.find(f => f.name === targetMsgs.reportFieldNick);
            const userName = nickField?.value || (await interaction.client.users.fetch(targetUserId).then(u => u.username).catch(() => 'Nieznany'));

            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                targetGuildId, targetUserId, userName, aiResult.score, aiResult.bossName
            );
            await this.logService.logScoreUpdate(userName, aiResult.score, isNewRecord, targetGuildId);
            gl.info(`🎯 [Analizuj] Wynik zapisany — isNewRecord: ${isNewRecord}`);

            // Aktualizuj role TOP jeśli nowy rekord
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
                    gl.error(`❌ [Analizuj] Błąd aktualizacji ról TOP: ${roleErr.message}`);
                }
            }

            // Ogłoszenie publiczne na kanale serwera z pingiem do autora screena
            const guildCfgAnnounce = this.config.getGuildConfig(targetGuildId);
            const announcementChannelId = guildCfgAnnounce?.allowedChannelId;
            if (announcementChannelId) {
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

                        let resultEmbed;
                        if (isNewRecord) {
                            resultEmbed = await this.rankingService.createRecordEmbed(
                                userName, aiResult.score, userAvatarUrl, announceName,
                                currentScore?.score ?? null, targetUserId, targetGuildId,
                                targetMsgs, targetGuildObj, guildCfgAnnounce?.topRoles ?? null,
                                currentScore?.timestamp ?? null, []
                            );
                        } else {
                            resultEmbed = this.rankingService.createResultEmbed(
                                userName, aiResult.score, currentScore?.score ?? null,
                                announceName, aiResult.bossName, targetMsgs
                            );
                        }

                        const announcementContent = formatMessage(targetMsgs.analyzeManualAnnouncement, {
                            userId: targetUserId,
                            adminName,
                        });

                        await announcementChannel.send({
                            content: announcementContent,
                            embeds: [resultEmbed],
                            files: [fileAttachment],
                        });
                        gl.info(`✅ [Analizuj] Ogłoszenie wysłane na kanał ${announcementChannelId}`);
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
            gl.info(`✅ [Analizuj] Embedy zaktualizowane — analiza zakończona`);

        } catch (err) {
            gl.error(`❌ [Analizuj] Błąd ee_analyze: ${err.message}`);
            await interaction.editReply({
                content: `❌ Błąd analizy: ${err.message}`,
                embeds: interaction.message.embeds,
                components: [],
            }).catch(() => {});
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }
    }

    async _sendInvalidScreenReport(interaction, imagePath, reason, gl, rejectionReason = null) {
        const hasGlobal = !!this.config.invalidReportChannelId;
        const guildCfg = this.config.getGuildConfig(interaction.guildId);
        const perGuildChannelId = guildCfg?.invalidReportChannelId || null;
        if (!hasGlobal && !perGuildChannelId) return;

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

            const buildEmbed = (footerText) => {
                const fields = [
                    { name: msgs.reportFieldNick, value: serverNick, inline: true },
                    { name: 'Discord', value: `${discordUsername} (<@${interaction.user.id}>)`, inline: true },
                    { name: msgs.reportFieldServer, value: serverName, inline: true },
                    { name: msgs.reportFieldTime, value: timestamp, inline: true },
                    { name: msgs.reportFieldReason, value: reasonText, inline: false },
                ];
                if (rejectionReason) {
                    fields.push({ name: msgs.reportFieldAiDetails, value: rejectionReason, inline: false });
                }
                return new EmbedBuilder()
                    .setColor(color)
                    .setTitle(msgs.reportTitle)
                    .addFields(...fields)
                    .setImage(`attachment://${fileName}`)
                    .setFooter({ text: footerText });
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

            // Wyślij do globalnego kanału
            let globalMsgId = null;
            let sentGlobalMsg = null;
            if (hasGlobal) {
                try {
                    const globalChannel = await interaction.client.channels.fetch(this.config.invalidReportChannelId);
                    if (globalChannel) {
                        const fileAttachment = new AttachmentBuilder(imagePath, { name: fileName });
                        const globalEmbed = buildEmbed(`uid:${interaction.user.id}|gid:${interaction.guildId}`);
                        sentGlobalMsg = await globalChannel.send({ embeds: [globalEmbed], files: [fileAttachment], components: [buildButtons()] });
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
                        const fileAttachment2 = new AttachmentBuilder(imagePath, { name: fileName });
                        const footerText = globalMsgId
                            ? `ref:${globalMsgId}|uid:${interaction.user.id}|gid:${interaction.guildId}`
                            : `uid:${interaction.user.id}|gid:${interaction.guildId}`;
                        const guildEmbed = buildEmbed(footerText);
                        const sentPerGuild = await guildChannel.send({ embeds: [guildEmbed], files: [fileAttachment2], components: [buildButtons()] });
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
                            if (ch && me) {
                                const perms = ch.permissionsFor(me);
                                const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'];
                                const missing = needed.filter(p => !perms.has(p));
                                gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału (${err.code} ${err.message}). Brakujące uprawnienia: ${missing.length ? missing.join(', ') : 'wszystkie OK — inny powód'}`);
                            } else {
                                gl.warn(`⚠️ Nie można wysłać raportu do per-guild kanału (${err.code}): nie udało się pobrać kanału/membera`);
                            }
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
        // tk_m_{YYYYMM}_{guildFilter}_{userId}  — breakdown miesięczny per serwer (tylko superUser)
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

        if (action === 'm' && !isSuperUser) return;

        // Zwykły admin widzi tylko swój serwer — zignoruj filter z customId
        const effectiveFilter = isSuperUser ? guildFilter : interaction.guildId;
        const tTok = this._panelT(interaction.guildId);

        await interaction.deferUpdate();

        if (action === 'm') {
            const reply = await this._buildTokensMonthBreakdown(interaction, month, isSuperUser);
            if (reply.components.length < 5) {
                reply.components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setLabel(tTok('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
                ));
            }
            await interaction.editReply(reply);
            return;
        }

        let targetMonth = month;
        if (action === 'p' || action === 'n') {
            const available = this.tokenUsageService.getAvailableMonths(effectiveFilter);
            const idx = available.indexOf(month);
            if (action === 'p' && idx > 0)                    targetMonth = available[idx - 1];
            if (action === 'n' && idx < available.length - 1) targetMonth = available[idx + 1];
        }

        const reply = await this._buildTokensEmbed(interaction, targetMonth, effectiveFilter, isSuperUser);
        if (reply.components.length < 5) {
            reply.components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_back').setLabel(tTok('◀️ Powrót do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary)
            ));
        }
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
        for (const gc of this.config.getAllGuilds()) {
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

        // Wiersz 1: ◀ | Miesiąc | ▶ | 🌐 Wszystkie (tylko superUser)
        const row1Buttons = [
            new ButtonBuilder()
                .setCustomId(`tk_p_${prevMonthRaw}_${guildFilter}_${userId}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrev),
            new ButtonBuilder()
                .setCustomId(`tk_m_${monthStr}_${guildFilter}_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!isSuperUser),
            new ButtonBuilder()
                .setCustomId(`tk_n_${nextMonthRaw}_${guildFilter}_${userId}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasNext),
        ];

        if (isSuperUser) {
            row1Buttons.push(
                new ButtonBuilder()
                    .setCustomId(`tk_a_${monthStr}_${userId}`)
                    .setLabel('🌐 Wszystkie')
                    .setStyle(guildFilter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );
        }

        const navRow = new ActionRowBuilder().addComponents(...row1Buttons);
        const components = [navRow];

        // Przyciski serwerów — tylko dla super użytkownika (blockOcrUserIds), bez Wszystkie
        if (isSuperUser) {
            const guildButtons = this.config.getAllGuilds()
                .filter(gc => interaction.client.guilds.cache.has(gc.id))
                .map(gc =>
                    new ButtonBuilder()
                        .setCustomId(`tk_g_${monthStr}_${gc.id}_${userId}`)
                        .setLabel((guildNames[gc.id] || gc.id).slice(0, 20))
                        .setStyle(guildFilter === gc.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );
            for (let i = 0; i < guildButtons.length; i += 5) {
                components.push(new ActionRowBuilder().addComponents(guildButtons.slice(i, i + 5)));
            }
        }

        return { embeds: [embed], components };
    }

    async _buildTokensMonthBreakdown(interaction, month, isSuperUser) {
        const { PRICING } = require('../services/tokenUsageService');
        const [y, m] = month.split('-').map(Number);
        const MONTH_NAMES = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
        const monthLabel = `${MONTH_NAMES[m - 1]} ${y}`;
        const monthStr   = `${y}${String(m).padStart(2, '0')}`;
        const userId     = interaction.user.id;

        const fmtCost = (c) => `$${c.toFixed(5)}`;

        // Iteruj po wszystkich guildach które kiedykolwiek miały dane tokenów
        const tokenGuildIds = Object.keys(this.tokenUsageService.data.guilds);
        const lines = [];
        let totalCost = 0;

        for (const guildId of tokenGuildIds) {
            const stats = this.tokenUsageService.getMonthlyStats(guildId, month);
            const cost  = stats.cost;
            totalCost  += cost;
            // Kolejność: aktywny cache → zapisana nazwa w config → ID serwera
            const liveName    = interaction.client.guilds.cache.get(guildId)?.name;
            const storedName  = this.guildConfigService.getConfig(guildId)?.guildName;
            const name        = (liveName || storedName || guildId).slice(0, 24);
            const leftMarker  = liveName ? '' : ' *(opuścił)*';
            lines.push(`**${name}**${leftMarker} — ${fmtCost(cost)} (${stats.requests} req)`);
        }

        lines.push('');
        lines.push(`**Łącznie** — **${fmtCost(totalCost)}**`);

        const embed = new EmbedBuilder()
            .setColor(0x4285F4)
            .setTitle(`📊 Koszty miesięczne — ${monthLabel}`)
            .setDescription(lines.join('\n'))
            .addFields({ name: 'Cennik', value: `In $${PRICING.input}/1M • Out $${PRICING.output}/1M`, inline: false })
            .setTimestamp()
            .setFooter({ text: 'Dane z /update' });

        // Przycisk powrotu do widoku głównego (dla aktualnego filtra = all)
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`tk_p_${monthStr}_all_${userId}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`tk_m_${monthStr}_all_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(false),
            new ButtonBuilder()
                .setCustomId(`tk_n_${monthStr}_all_${userId}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`tk_a_${monthStr}_${userId}`)
                .setLabel('🌐 Wszystkie')
                .setStyle(ButtonStyle.Secondary),
        );

        return { embeds: [embed], components: [backRow] };
    }

    async _handlePanelTester(interaction) {
        const t = this._panelT(interaction.guildId);
        const testers = this.testerService ? this.testerService.getTesters() : [];
        const desc = testers.length > 0
            ? testers.map((t2, i) => `${i + 1}. <@${t2.userId}>`).join('\n')
            : t('Brak testerów.', 'No testers.');
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('🧪 Testerzy OCR', '🧪 OCR Testers'))
            .setDescription(desc);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_tester_add').setLabel(t('➕ Dodaj', '➕ Add')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('panel_tester_remove').setLabel(t('➖ Usuń', '➖ Remove')).setStyle(ButtonStyle.Danger).setDisabled(testers.length === 0),
            new ButtonBuilder().setCustomId('panel_back').setLabel(t('◀️ Wróć do panelu', '◀️ Back to Panel')).setStyle(ButtonStyle.Secondary),
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
        const added = await this.testerService.addTester(userId, interaction.user.id);
        if (!added) {
            await interaction.reply({ content: t(`⚠️ Użytkownik <@${userId}> jest już testerem.`, `⚠️ User <@${userId}> is already a tester.`), flags: ['Ephemeral'] });
            return;
        }
        await interaction.reply({ content: t(`✅ Dodano <@${userId}> jako testera OCR.`, `✅ Added <@${userId}> as OCR tester.`), flags: ['Ephemeral'] });
    }

    async _handlePanelTesterRemove(interaction) {
        const t = this._panelT(interaction.guildId);
        const testers = this.testerService ? this.testerService.getTesters() : [];
        if (testers.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFF8C00).setDescription(t('Brak testerów do usunięcia.', 'No testers to remove.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_tester').setLabel(t('◀️ Wróć', '◀️ Back')).setStyle(ButtonStyle.Secondary)
                )],
            });
            return;
        }
        const options = testers.slice(0, 25).map(te => ({
            label: te.userId,
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
            new ButtonBuilder().setCustomId('panel_tester').setLabel(t('◀️ Wróć', '◀️ Back')).setStyle(ButtonStyle.Secondary)
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
}

module.exports = InteractionHandler;
