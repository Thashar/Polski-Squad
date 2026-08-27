const { SlashCommandBuilder, REST, Routes, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, ComponentType } = require('discord.js');
const { downloadFile, downloadBuffer, formatMessage, compareByScoreThenTimestamp, makePlayerKey, getOwnerId, getProfileIndex, formatProfileDisplayName, getProfileButtonEmoji } = require('../utils/helpers');
const { formatCooldownTime } = require('../services/updateCooldownService');
const { generatePositionIcon } = require('../services/positionIconService');
const ProfileService = require('../services/profileService');
const MESSAGES = require('../config/messages');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Limit klikania liczników reakcji pod rozgłoszeniami: 5 kliknięć w 5 s → 15 minut przerwy.
// Jedno kliknięcie przebudowuje przyciski na kopiach embeda na wszystkich serwerach, więc
// spam jednej osoby zapycha wspólną kolejkę REST i spowalnia bota także w innych rzeczach.
const BCR_WINDOW_MS = 5000;
const BCR_MAX_CLICKS = 5;
const BCR_PENALTY_MS = 15 * 60 * 1000;
const path = require('path');

const OPERATIONS_TYPE = 'ocr.analyze';

/**
 * Buduje usage payload do `/record` z `aiResult.tokenUsage` zwracanego przez
 * `aiOcrService`. Zwraca null gdy brak danych (np. AI OCR wyłączony).
 */
// Znaki wyglądające jak łacina/cyfry ale będące innymi kodami Unicode
const _HOMOGLYPHS = {
    // Cyrylica homoglify (małe)
    'а':'a','е':'e','о':'o','р':'p','с':'c','у':'y','х':'x',
    'ѕ':'s','і':'i','ј':'j','ԁ':'d','ԛ':'q','ԝ':'w','ԟ':'w',
    // Cyrylica homoglify (wielkie)
    'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O',
    'Р':'P','С':'C','Т':'T','У':'Y','Х':'X','Ѕ':'S','І':'I',
    'Ј':'J','Ԁ':'D','Ԛ':'Q','Ԝ':'W',
    // Greka homoglify (wielkie)
    'Α':'A','Β':'B','Ε':'E','Ζ':'Z','Η':'H','Ι':'I','Κ':'K',
    'Μ':'M','Ν':'N','Ο':'O','Ρ':'P','Τ':'T','Υ':'Y','Χ':'X',
    // Greka homoglify (małe)
    'α':'a','β':'b','ε':'e','ι':'i','ν':'v','ο':'o','ρ':'p',
    'υ':'u','χ':'x','γ':'y',
    // Małe majuskuły (small caps)
    'ᴀ':'a','ʙ':'b','ᴄ':'c','ᴅ':'d','ᴇ':'e','ꜰ':'f','ɢ':'g',
    'ʜ':'h','ɪ':'i','ᴊ':'j','ᴋ':'k','ʟ':'l','ᴍ':'m','ɴ':'n',
    'ᴏ':'o','ᴘ':'p','ʀ':'r','ꜱ':'s','ᴛ':'t','ᴜ':'u','ᴠ':'v',
    'ᴡ':'w','ʏ':'y','ᴢ':'z',
    // Litery wykładnikowe (superscript)
    'ᵃ':'a','ᵇ':'b','ᶜ':'c','ᵈ':'d','ᵉ':'e','ᶠ':'f','ᵍ':'g',
    'ʰ':'h','ⁱ':'i','ʲ':'j','ᵏ':'k','ˡ':'l','ᵐ':'m','ⁿ':'n',
    'ᵒ':'o','ᵖ':'p','ʳ':'r','ˢ':'s','ᵗ':'t','ᵘ':'u','ᵛ':'v',
    'ʷ':'w','ˣ':'x','ʸ':'y','ᶻ':'z',
    // Litery indeksowe (subscript)
    'ₐ':'a','ₑ':'e','ₒ':'o','ₓ':'x',
    // Cyfry wykładnikowe
    '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4',
    '⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
    // Cyfry indeksowe
    '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4',
    '₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
    // Symbole podobne do liter (letterlike)
    'ℂ':'c','ℊ':'g','ℎ':'h','ℋ':'h','ℌ':'h','ℍ':'h',
    'ℐ':'i','ℑ':'i','ℒ':'l','ℓ':'l','ℕ':'n','ℙ':'p',
    'ℚ':'q','ℝ':'r','ℜ':'r','ℤ':'z','ℬ':'b','ℰ':'e',
    'ℱ':'f','ℳ':'m','ℛ':'r',
    // IPA i znaki fonetyczne podobne do łaciny
    'ɑ':'a','ɒ':'a','ɓ':'b','ƀ':'b','ƃ':'b','ɔ':'c',
    'ɖ':'d','ɗ':'d','ƌ':'d','ǝ':'e','ɛ':'e','ɜ':'e',
    'ɡ':'g','ɣ':'g','ɦ':'h','ɧ':'h',
    'ɨ':'i','ɩ':'i','ʝ':'j','ɫ':'l','ɬ':'l','ɭ':'l',
    'ɯ':'m','ɱ':'m','ɲ':'n','ɳ':'n','ɵ':'o',
    'ɹ':'r','ɻ':'r','ɾ':'r','ʂ':'s','ʃ':'s',
    'ƭ':'t','ʈ':'t','ʊ':'u','ʋ':'v','ʌ':'v',
    'ʍ':'w','ʎ':'y','ʐ':'z','ʑ':'z',
    // Litery Regional Indicator (składowe flag emoji: 🇦–🇿)
    '\u{1F1E6}':'a','\u{1F1E7}':'b','\u{1F1E8}':'c','\u{1F1E9}':'d',
    '\u{1F1EA}':'e','\u{1F1EB}':'f','\u{1F1EC}':'g','\u{1F1ED}':'h',
    '\u{1F1EE}':'i','\u{1F1EF}':'j','\u{1F1F0}':'k','\u{1F1F1}':'l',
    '\u{1F1F2}':'m','\u{1F1F3}':'n','\u{1F1F4}':'o','\u{1F1F5}':'p',
    '\u{1F1F6}':'q','\u{1F1F7}':'r','\u{1F1F8}':'s','\u{1F1F9}':'t',
    '\u{1F1FA}':'u','\u{1F1FB}':'v','\u{1F1FC}':'w','\u{1F1FD}':'x',
    '\u{1F1FE}':'y','\u{1F1FF}':'z',
    // Otoczone litery (enclosed, te których NFKC nie łapie)
    '\u{1F150}':'a','\u{1F151}':'b','\u{1F152}':'c','\u{1F153}':'d',
    '\u{1F154}':'e','\u{1F155}':'f','\u{1F156}':'g','\u{1F157}':'h',
    '\u{1F158}':'i','\u{1F159}':'j','\u{1F15A}':'k','\u{1F15B}':'l',
    '\u{1F15C}':'m','\u{1F15D}':'n','\u{1F15E}':'o','\u{1F15F}':'p',
    '\u{1F160}':'q','\u{1F161}':'r','\u{1F162}':'s','\u{1F163}':'t',
    '\u{1F164}':'u','\u{1F165}':'v','\u{1F166}':'w','\u{1F167}':'x',
    '\u{1F168}':'y','\u{1F169}':'z',
    '\u{1F170}':'a','\u{1F171}':'b','\u{1F17E}':'o','\u{1F17F}':'p',
    // Polskie „ł" — NFD go NIE rozkłada (to osobny znak, nie l + diakryt), więc bez tego
    // wpisu „polbog" nie znajdowało „Półbóg", a „michal" nicku „Michał".
    'ł':'l', 'Ł':'l',
};

function normalizeForSearch(str) {
    if (!str) return '';
    // Krok 1: NFKC — obsługuje czcionki matematyczne (𝓗𝓮𝓵𝓵𝓸), fullwidth (Ａｂｃ), halfwidth itp.
    let s = str.normalize('NFKC');
    // Krok 2: zamień homoglify (Cyrylica/Greka/small-caps/superscript/regional-indicator)
    s = s.replace(/./gsu, ch => _HOMOGLYPHS[ch] ?? ch);
    // Krok 3: NFD + usuń znaki diakrytyczne (ą→a, é→e, ñ→n itp.)
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.toLowerCase();
}

// Sprawdza czy gracz pasuje do query — szuka po nazwie rankingowej ORAZ po nazwie Discord
function playerMatchesQuery(p, query, client, guildId) {
    if (!query) return true;
    if (normalizeForSearch(p.username || '').includes(query)) return true;
    if ((p.userId || '').includes(query)) return true;
    const discordUser = client?.users?.cache?.get(p.userId);
    if (discordUser) {
        if (normalizeForSearch(discordUser.username || '').includes(query)) return true;
        if (normalizeForSearch(discordUser.globalName || '').includes(query)) return true;
    }
    if (guildId) {
        const member = client?.guilds?.cache?.get(guildId)?.members?.cache?.get(p.userId);
        if (member?.nickname) {
            if (normalizeForSearch(member.nickname).includes(query)) return true;
        }
    }
    return false;
}

function buildGeminiUsage(aiResult) {
    if (!aiResult?.tokenUsage) return null;
    const model = process.env.ENDERSECHO_GOOGLE_AI_MODEL || 'gemini-2.5-flash-lite';
    return {
        provider:     `gemini/${model}`,
        inputTokens:  aiResult.tokenUsage.promptTokens,
        outputTokens: aiResult.tokenUsage.outputTokens,
    };
}

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService, notificationService, userBlockService, roleRankingConfigService, usageLimitService, tokenUsageService, _botOps, guildConfigService, ocrBlockService, updateCooldownService, testerService, achievementService, communityVerificationService, scoreHistoryService = null, chartService = null, guildBanService = null, globalTop10Service = null, bossAliasService = null, ocrStatsService = null, bossRecordService = null, adminPanelService = null, commandUsageService = null, milestoneService = null, profileRegistryService = null, recordRevertService = null, webRankingSyncService = null) {
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
        this.bossAliasService = bossAliasService;
        this.ocrStatsService = ocrStatsService;
        this.bossRecordService = bossRecordService;
        this.adminPanelService = adminPanelService;
        this.commandUsageService = commandUsageService;
        this.milestoneService = milestoneService;
        this.profileRegistryService = profileRegistryService;
        this.recordRevertService = recordRevertService;
        this.webRankingSyncService = webRankingSyncService;
        this.broadcastReactionService = null; // ustawiany setterem z index.js
        this.profileService = new ProfileService({
            rankingService,
            bossRecordService,
            bossAliasService,
            roleService,
            roleRankingConfigService,
            guildConfigService,
            profileRegistryService,
            dataDir: config.ranking?.dataDir || null,
        });
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
        // Sesje mapowania nieznanej nazwy bossa (sessionKey -> { rawBoss })
        this._unknownBossEmbeds = new Map();
        // Sesje robocze flow mapowania (userId -> { rawBoss, adjustedBoss?, englishBoss? })
        this._bossMapSessions = new Map();
        // Sesje wizarda /challenge (userId -> { guildId, playerKey, playerName, boss })
        this._challengeSessions = new Map();
        this.challengeService = null;
        // Sesje robocze panelu konfiguracji bossów (userId -> { pendingBoss? })
        this._bossCfgSessions = new Map();
        // Sesje cofnięcia wyniku OCR (playerKey_guildId -> { guildId, userId, playerKey, previousRecord, newRecord })
        this._ocrRevertSessions = new Map();
        // Stan paginacji rankingów per-boss (messageId -> { bossName, players, currentPage, totalPages, userId })
        this._bossRankings = new Map();
        // Stan sesji /profile (messageId -> { viewerId, targetPlayerKey, targetGuildId, view, category, bossPage, bossMaxPage, cachedData })
        this._profileStates = new Map();
        // Oczekujące wybory profilu przy /update i /test (interactionId -> { interaction, dryRun, commandName, ocrBlockKey, userId })
        this._updateProfileSessions = new Map();
        // Panel „Usuń osiągnięcia" (userId -> { playerKey, guildId, query, selected, ts }) — filtr nazwy
        // i zaznaczenie wielu osiągnięć nie zmieszczą się w customId (limit 100 znaków)
        this._achDelSessions = new Map();
        // Limit klikania reakcji pod rozgłoszeniami: userId → { klikniecia: number[], doKiedy: number }
        this._bcrClicks = new Map();
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
                .setName('challenge')
                .setDescription('Challenge another player to a 1v1 duel on a chosen boss')
                .setDescriptionLocalizations(pl('Rzuć innemu graczowi wyzwanie 1 na 1 na wybranym bossie'))
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

            new SlashCommandBuilder()
                .setName('profile')
                .setDescription('Player profile: records, bosses, achievements and your in-game accounts')
                .setDescriptionLocalizations(pl('Profil gracza: rekordy, bossowie, osiągnięcia i Twoje konta w grze')),


            new SlashCommandBuilder()
                .setName('configure')
                .setDescription('Configure EndersEcho for this server (admins only)')
                .setDescriptionLocalizations(pl('Skonfiguruj EndersEcho na tym serwerze (tylko dla adminów)'))
                .setDefaultMemberPermissions(this.config.configureAdminOnly ? PermissionFlagsBits.Administrator : null),

            new SlashCommandBuilder()
                .setName('manage')
                .setDescription('Open EndersEcho admin panel (admins and moderators)')
                .setDescriptionLocalizations(pl('Otwórz panel administracyjny EndersEcho (adminowie i moderatorzy)')),

            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show help and useful links for Ender\'s Echo')
                .setDescriptionLocalizations(pl('Pokaż pomoc i przydatne linki do Ender\'s Echo')),
        ];
    }

    async registerSlashCommands(client) {
        const rest = new REST().setToken(this.config.token);
        const allGuilds = this.config.getAllGuilds();

        // Zbierz unikalne serwery (configured + unconfigured które bot zna + wszystkie w cache)
        const guildIds = new Set(allGuilds.map(g => g.id));
        if (this.guildConfigService) {
            for (const id of this.guildConfigService.getAllConfiguredGuildIds()) guildIds.add(id);
        }
        for (const id of client.guilds.cache.keys()) guildIds.add(id);

        const skipped = [];
        const registered = [];
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
                registered.push(`"${client.guilds.cache.get(guildId)?.name || guildId}" (${cfg.lang || 'eng'})`);
            } catch (error) {
                logger.error(`Błąd rejestracji slash commands dla serwera "${client.guilds.cache.get(guildId)?.name || guildId}":`, error);
            }
        }
        if (registered.length > 0) {
            logger.info(`✅ Zarejestrowano komendy dla ${registered.length} serwer(ów): ${registered.join(', ')}`);
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
            if (this.commandUsageService) {
                this.commandUsageService.record(guildId, interaction.commandName);
            }

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

            // /help — działa też na serwerach bez konfiguracji
            if (interaction.commandName === 'help') {
                await this.handleHelpCommand(interaction);
                return;
            }

            // /challenge — na razie wyłącznie head admin (dowolny kanał, wymaga konfiguracji)
            if (interaction.commandName === 'challenge') {
                if (!this._checkConfigured(interaction)) return;
                await this.handleChallengeCommand(interaction);
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

            const isAdminGuild = this.config.adminGuildId && guildId === this.config.adminGuildId;
            const isHeadAdminBypassCmd = ['ranking', 'achievements', 'subscribe'].includes(interaction.commandName);
            const isAdminGuildBypassCmd = isAdminGuild && ['ranking', 'profile', 'achievements', 'subscribe'].includes(interaction.commandName);
            if (!this.isAllowedChannel(interaction.channel.id, guildId) && !(this._isHeadAdmin(interaction.user.id) && isHeadAdminBypassCmd) && !isAdminGuildBypassCmd) {
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
                case 'achievements': await this.handleAchievementsCommand(interaction);   break;
                case 'profile':      await this.handleProfileCommand(interaction);        break;
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
            if (interaction.customId.startsWith('prof_modal_')) {
                await this._handleProfileNameModal(interaction);
                return;
            }
            if (interaction.customId.startsWith('upd_prof_modal_')) {
                await this._handleUpdateProfileModal(interaction);
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
            if (interaction.customId === 'boss_cfg_img_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgImgModal(interaction);
                return;
            }
            if (interaction.customId === 'panel_remove_search_modal') {
                await this._handlePanelRemoveSearch(interaction);
                return;
            }
            if (interaction.customId === 'panel_remove_score_search_modal') {
                await this._handlePanelRemoveScoreSearch(interaction);
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
            if (interaction.customId === 'cc_player_lookup_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcPlayerLookupModal(interaction);
                return;
            }
            if (interaction.customId === 'cc_cost_alert_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcCostAlertModal(interaction);
                return;
            }
            if (interaction.customId === 'ach_check_modal') {
                await this._handleAchCheckModal(interaction);
                return;
            }
            if (interaction.customId === 'profile_search_modal') {
                await this._handleProfileSearchModal(interaction);
                return;
            }
            if (interaction.customId === 'cc_potd_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcPotdSearch(interaction);
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
            if (interaction.customId === 'panel_ach_del_q_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelQuerySubmit(interaction);
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
            if (interaction.customId === 'cfg_autoreact_modal') {
                await this._handleCfgAutoReactModal(interaction);
                return;
            }
            if (interaction.customId === 'boss_cfg_add_name_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddNameModal(interaction);
                return;
            }
            if (interaction.customId === 'boss_cfg_add_alias_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddAliasModal(interaction);
                return;
            }
            if (interaction.customId === 'boss_cfg_edit_entry_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditEntryModal(interaction);
                return;
            }
            if (interaction.customId === 'boss_cfg_edit_alias_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditAliasModal(interaction);
                return;
            }
            if (interaction.customId === 'boss_map_boss_modal') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossMapBossModal(interaction);
                return;
            }
            if (interaction.customId === 'cfg_mod_add_modal') {
                await this._handleCfgModAddModal(interaction);
                return;
            }
        }
    }

    /**
     * Sprawdza czy serwer jest skonfigurowany, jeśli nie — odpowiada ephemeral i zwraca false
     */
    _checkConfigured(interaction) {
        if (this.config.adminGuildId && interaction.guildId === this.config.adminGuildId) return true;
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
            const focused = normalizeForSearch(interaction.options.getFocused());
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const choices = [];
            for (const guildId of configuredIds) {
                const discordGuild = interaction.client.guilds.cache.get(guildId);
                if (!discordGuild) continue;
                const name = discordGuild.name;
                if (normalizeForSearch(name).includes(focused) || guildId.includes(focused)) {
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
            9: state.moderatorsDone === true,
            10: state.autoReactionDone === true,
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
                btn(9, '9. Moderatorzy gry', '9. Game Moderators'),
                btn(10, '10. Auto-reakcja', '10. Auto Reaction'),
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
            done[9] ? ((state.moderators || []).length > 0 ? `✅ 👮 ${t('Moderatorzy gry:', 'Game Moderators:')} ${(state.moderators || []).map(m => `<@${m.userId}>`).join(', ')}` : `❌ 👮 ${t('Moderatorzy gry:', 'Game Moderators:')} ${t('Brak', 'None')}`) : null,
            done[10] ? (state.autoReactionEmoji ? `✅ 💫 ${t('Auto-reakcja:', 'Auto Reaction:')} ${state.autoReactionEmoji}` : `❌ 💫 ${t('Auto-reakcja:', 'Auto Reaction:')} ${t('Wyłączona', 'Disabled')}`) : null,
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
                        '2️⃣  **Kanał bota** — kanał dla `/update`, `/ranking` i `/profile`\n' +
                        '3️⃣  **Kanał raportów** — gdzie trafiają alerty o odrzuconych screenach\n' +
                        '4️⃣  **Tag serwera** — 1–4 znaki/emoji widoczne w globalnym rankingu\n' +
                        '5️⃣  **Role TOP** *(opcjonalne)* — konfigurowalne automatyczne role za pozycje w rankingu\n' +
                        '6️⃣  **Raporty Global TOP10** — publikowane po zmianie bossa\n' +
                        '7️⃣  **Ranking roli** *(opcjonalne)* — osobne rankingi dla posiadaczy wybranych ról\n' +
                        '8️⃣  **Weryfikacja społeczności** *(opcjonalne)* — przycisk "Zgłoś" pod rekordami, moderacja przez graczy\n' +
                        '9️⃣  **Moderatorzy gry** *(opcjonalne)* — użytkownicy z dostępem do `/manage`\n' +
                        '🔟  **Auto-reakcja** *(opcjonalne)* — emoji dodawane przez bota pod każdym ogłoszeniem rekordu\n\n' +
                        '💡 Po zakończeniu konfiguracji możesz otwierać Panel Admina bezpośrednio przez `/manage`.\n' +
                        ocrLine + diagHint,
                        '📋 **Steps overview:**\n' +
                        '1️⃣  **Language** — Polish or English interface\n' +
                        '2️⃣  **Bot Channel** — where `/update`, `/ranking` and `/profile` work\n' +
                        '3️⃣  **Report Channel** — where rejected screenshot alerts appear\n' +
                        '4️⃣  **Server Tag** — 1–4 char/emoji shown in the global ranking\n' +
                        '5️⃣  **TOP Roles** *(optional)* — configurable automatic roles based on ranking positions\n' +
                        '6️⃣  **Global TOP10 Reports** — published after boss change\n' +
                        '7️⃣  **Role Rankings** *(optional)* — separate rankings for holders of specific roles\n' +
                        '8️⃣  **Community Verification** *(optional)* — "Report" button on records, player-driven moderation\n' +
                        '9️⃣  **Game Moderators** *(optional)* — users with access to `/manage`\n' +
                        '🔟  **Auto Reaction** *(optional)* — an emoji the bot adds under every record announcement\n\n' +
                        '💡 Once configuration is complete, open the Admin Panel directly with `/manage`.\n' +
                        ocrLine + diagHint
                    );
                })() + (summaryLines.length > 0 ? '\n\n**' + t('Aktualne ustawienia:', 'Current settings:') + '**\n' + summaryLines.join('\n') : '')
            );

        return { embed, rows, allDone };
    }

    async handleConfigureCommand(interaction) {
        const configureHeadAdminAllowed = !this.config.configureAdminOnly;
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !(configureHeadAdminAllowed && this._isHeadAdmin(interaction.user.id))) {
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
                    moderators: existing.moderators || [],
                    moderatorsDone: true,
                    autoReactionEmoji: existing.autoReactionEmoji || null,
                    autoReactionDone: true,
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
                    moderators: [],
                    moderatorsDone: false,
                    autoReactionEmoji: null,
                    autoReactionDone: false,
                });
            }
        }

        const state = this._configWizard.get(key);
        const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
        await interaction.reply({ embeds: [embed], components: rows, flags: ['Ephemeral'] });
    }

    async handleManageCommand(interaction) {
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const isModerator = this._isGameModerator(interaction.user.id, interaction.guildId);
        if (!isAdmin && !isHeadAdmin && !isModerator) {
            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({ content: msgs.manageNotAdmin, flags: ['Ephemeral'] });
            return;
        }
        const { embed, components } = this._buildAdminPanel(interaction);
        await interaction.reply({ embeds: [embed], components, flags: ['Ephemeral'] });
    }

    async handleHelpCommand(interaction) {
        const t = this._panelT(interaction.guildId);
        const msgs = this.msgs(interaction.guildId);
        const url = 'https://endersecho.thashar.dev/';

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(msgs.helpTitle || t('📖 Ender\'s Echo — pomoc', '📖 Ender\'s Echo — Help'))
            .setDescription(
                (msgs.helpDescription || t(
                    'Opis komend, konfiguracji i odpowiedzi na częste pytania znajdziesz na stronie:\n{url}',
                    'Command reference, setup guide and FAQ are available on the website:\n{url}'
                )).replace('{url}', url)
            )
            .addFields(
                {
                    // Wymóg Sekcji 5(a) Warunków Discorda — łatwy dostęp do polityki prywatności z poziomu aplikacji
                    name: msgs.helpDocsTitle || t('Dokumenty', 'Documents'),
                    value: [
                        `[${msgs.helpPrivacy || t('Polityka prywatności', 'Privacy Policy')}](${url}privacy)`,
                        `[${msgs.helpTerms || t('Regulamin', 'Terms of Service')}](${url}terms)`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: msgs.helpSupportTitle || t('Wsparcie', 'Support'),
                    value: `[${msgs.helpSupport || t('Serwer pomocy', 'Support server')}](https://discord.gg/aTPH4r9Zbg)`,
                    inline: true,
                },
            );

        await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
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
                        '**Dostępne na tym kanale (wszyscy):**\n• `/update` — prześlij wynik\n• `/ranking` — wyświetl ranking\n• `/profile` — przeglądaj profil gracza\n\n' +
                        'Komendy adminów są dostępne przez `/manage` z dowolnego kanału.',
                        'Choose the channel where users can run EndersEcho commands.\n\n' +
                        '**Available in this channel (all users):**\n• `/update` — submit a score\n• `/ranking` — view rankings\n• `/profile` — browse a player\'s profile\n\n' +
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

        } else if (step === 9) {
            await this._showModeratorStep(interaction, state, guildId);

        } else if (step === 10) {
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('💫 Krok 10 — Auto-reakcja (opcjonalne)', '💫 Step 10 — Auto Reaction (optional)'))
                .setDescription(
                    t(
                        'Bot może automatycznie dodawać wybraną reakcję pod każdym ogłoszeniem pobitego rekordu po użyciu `/update`.\n\n' +
                        '**Jak działa:**\n' +
                        '• Po opublikowaniu ogłoszenia rekordu bot dodaje pod nim wybraną emotkę jako reakcję\n' +
                        '• Akceptowane są **systemowe emoji Discord** (standardowe Unicode, np. 🔥 👑 🎉)\n' +
                        '• Akceptowane są też **emotki customowe** (`:nazwa:` lub `<:nazwa:id>`) — z serwerów, na których jest bot\n\n' +
                        'Możesz pominąć ten krok i skonfigurować auto-reakcję później przez `/configure`.',
                        'The bot can automatically add a chosen reaction under every beaten record announcement after `/update`.\n\n' +
                        '**How it works:**\n' +
                        '• After a record announcement is published, the bot adds the chosen emoji as a reaction under it\n' +
                        '• **Default Discord emoji** are accepted (standard Unicode, e.g. 🔥 👑 🎉)\n' +
                        '• **Custom emotes** are accepted too (`:name:` or `<:name:id>`) — from servers the bot is a member of\n\n' +
                        'You can skip this step and configure the auto reaction later by running `/configure`.'
                    ) + '\n\n**' + t('Aktualne ustawienie:', 'Current setting:') + '** ' + (state.autoReactionEmoji
                        ? t('✅ Włączona — ', '✅ Enabled — ') + state.autoReactionEmoji
                        : t('❌ Wyłączona', '❌ Disabled'))
                );
            const step10Btns = [];
            if (!state.autoReactionEmoji) {
                step10Btns.push(new ButtonBuilder().setCustomId('cfg_autoreact_enable').setLabel(t('Włącz', 'Enable')).setEmoji('✅').setStyle(ButtonStyle.Success));
            } else {
                step10Btns.push(new ButtonBuilder().setCustomId('cfg_autoreact_enable').setLabel(t('Zmień emotkę', 'Change Emoji')).setEmoji('✏️').setStyle(ButtonStyle.Primary));
                step10Btns.push(new ButtonBuilder().setCustomId('cfg_autoreact_disable').setLabel(t('Wyłącz', 'Disable')).setEmoji('❌').setStyle(ButtonStyle.Secondary));
            }
            if (!state.autoReactionDone) {
                step10Btns.push(new ButtonBuilder().setCustomId('cfg_autoreact_disable').setLabel(t('Pomiń', 'Skip')).setStyle(ButtonStyle.Secondary));
            }
            step10Btns.push(backBtn);
            await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...step10Btns)] });
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

    /**
     * Sprawdza czy string to DOKŁADNIE jedno systemowe emoji Discord (standardowy Unicode).
     * Obsługuje: piktogramy (z wariantem VS16 i odcieniem skóry), flagi (pary regional indicators),
     * keycapy (0️⃣–9️⃣, #️⃣, *️⃣), flagi tag-sequence (🏴󠁧󠁢󠁥󠁮󠁧󠁿) oraz sekwencje ZWJ (👨‍👩‍👧).
     * Odrzuca emotki customowe (<:nazwa:id>), tekst i cyfry bez keycapu.
     * @param {string} str
     * @returns {boolean}
     */
    _isSingleStandardEmoji(str) {
        if (!str || /^[0-9#*]$/.test(str)) return false;
        const single = '(?:\\p{Extended_Pictographic}\\uFE0F?[\\u{1F3FB}-\\u{1F3FF}]?|[\\u{1F1E6}-\\u{1F1FF}]{2}|[#*0-9]\\uFE0F?\\u20E3|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]+\\u{E007F})';
        return new RegExp(`^${single}(?:\\u200D${single})*$`, 'u').test(str);
    }

    async _handleCfgAutoReactModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired. Run `/configure` again.', flags: ['Ephemeral'] }); return; }

        const isPol = state.lang === 'pol';
        let raw = interaction.fields.getTextInputValue('cfg_autoreact_emoji_input').trim();

        // Emotka customowa — pełny format <:nazwa:id> / <a:nazwa:id> lub sama :nazwa: (lookup w emotkach serwera)
        const customMatch = raw.match(/^<(a?):([\w]+):(\d+)>$/);
        const nameMatch = !customMatch && raw.match(/^:?([\w]{2,32}):?$/);
        if (customMatch) {
            // Bot może reagować tylko emotkami z serwerów, na których jest — sprawdź dostęp
            if (!interaction.client.emojis.cache.has(customMatch[3])) {
                await interaction.reply({
                    content: isPol
                        ? '❌ Bot nie ma dostępu do tej emotki. Emotka customowa musi pochodzić z serwera, na którym jest EndersEcho.'
                        : '❌ The bot has no access to this emote. A custom emote must come from a server EndersEcho is a member of.',
                    flags: ['Ephemeral']
                });
                return;
            }
        } else if (nameMatch && !this._isSingleStandardEmoji(raw)) {
            // Nazwa emotki — szukaj najpierw na tym serwerze, potem na wszystkich serwerach bota
            const found = interaction.guild.emojis.cache.find(e => e.name === nameMatch[1])
                || interaction.client.emojis.cache.find(e => e.name === nameMatch[1]);
            if (!found) {
                await interaction.reply({
                    content: isPol
                        ? `❌ Nie znaleziono emotki o nazwie \`${nameMatch[1]}\` na serwerach, na których jest bot. Podaj systemowe emoji Discord (np. 🔥 👑 🎉) lub emotkę customową (\`:nazwa:\` lub \`<:nazwa:id>\`).`
                        : `❌ No emote named \`${nameMatch[1]}\` was found on any server the bot is a member of. Provide a default Discord emoji (e.g. 🔥 👑 🎉) or a custom emote (\`:name:\` or \`<:name:id>\`).`,
                    flags: ['Ephemeral']
                });
                return;
            }
            raw = found.toString(); // <:nazwa:id> lub <a:nazwa:id>
        } else if (!this._isSingleStandardEmoji(raw)) {
            await interaction.reply({
                content: isPol
                    ? '❌ Podaj dokładnie jedno emoji: systemowe Discord (np. 🔥 👑 🎉) lub emotkę customową (`:nazwa:` lub `<:nazwa:id>`) z serwera, na którym jest bot.'
                    : '❌ Provide exactly one emoji: a default Discord emoji (e.g. 🔥 👑 🎉) or a custom emote (`:name:` or `<:name:id>`) from a server the bot is a member of.',
                flags: ['Ephemeral']
            });
            return;
        }

        state.autoReactionEmoji = raw;
        state.autoReactionDone = true;
        this._configWizard.set(key, state);
        await this._showConfigureStep(interaction, 10);
    }

    /**
     * Dodaje skonfigurowaną auto-reakcję pod ogłoszeniem pobitego rekordu (fire-and-forget).
     * Emoji pochodzi z guild_configs.json (autoReactionEmoji, /configure krok 10).
     * @param {Message|null} publicMsg - wiadomość publicznego ogłoszenia rekordu
     * @param {string} guildId
     */
    _addRecordAutoReaction(publicMsg, guildId) {
        const emoji = this.guildConfigService?.getConfig(guildId)?.autoReactionEmoji;
        if (!emoji || !publicMsg) return;
        publicMsg.react(emoji).catch(err => {
            this.logService._gl(guildId).warn(`⚠️ Nie udało się dodać auto-reakcji "${emoji}" pod ogłoszeniem rekordu: ${err.message}`);
        });
    }

    async _showModeratorStep(interaction, state, guildId) {
        const isPol = state.lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const backBtn = new ButtonBuilder().setCustomId('cfg_back').setLabel(t('← Wstecz', '← Back')).setStyle(ButtonStyle.Secondary);

        const mods = state.moderators || [];
        const modList = mods.length > 0
            ? '\n\n**' + t('Aktualni moderatorzy:', 'Current moderators:') + '**\n' + mods.map(m => `• <@${m.userId}>`).join('\n')
            : '\n\n*' + t('Brak skonfigurowanych moderatorów.', 'No moderators configured.') + '*';

        const embed = new EmbedBuilder().setColor(0x5865F2)
            .setTitle(t('👮 Krok 9 — Moderatorzy gry (opcjonalne)', '👮 Step 9 — Game Moderators (optional)'))
            .setDescription(
                t(
                    'Możesz dodać moderatorów gry, którzy będą mieli dostęp do panelu zarządzania przez komendę `/manage`.\n\nModerator może zarządzać graczami i rankingiem na tym serwerze, ale nie ma dostępu do ustawień bota ani funkcji head admina.',
                    'You can add game moderators who will have access to the management panel through the `/manage` command.\n\nA moderator can manage players and rankings on this server, but does not have access to bot settings or head admin features.'
                ) + modList
            );

        const addBtn = new ButtonBuilder().setCustomId('cfg_mod_add').setLabel(t('Dodaj', 'Add')).setStyle(ButtonStyle.Primary);
        const removeBtn = new ButtonBuilder().setCustomId('cfg_mod_remove').setLabel(t('Usuń', 'Remove')).setStyle(ButtonStyle.Danger).setDisabled(mods.length === 0);

        const btns = [addBtn, removeBtn];
        if (!state.moderatorsDone) {
            btns.push(new ButtonBuilder().setCustomId('cfg_mod_skip').setLabel(t('Pomiń', 'Skip')).setStyle(ButtonStyle.Secondary));
        }
        btns.push(backBtn);

        await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(...btns)] });
    }

    async _handleCfgModAddModal(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.reply({ content: '⚠️ Session expired. Run `/configure` again.', flags: ['Ephemeral'] }); return; }

        const msgs = this.msgs(interaction.guildId);
        const userId = interaction.fields.getTextInputValue('cfg_mod_user_id_input').trim();

        if (!/^\d{17,20}$/.test(userId)) {
            await interaction.reply({ content: msgs.modInvalidId, flags: ['Ephemeral'] }); return;
        }

        if (!state.moderators) state.moderators = [];
        if (state.moderators.some(m => m.userId === userId)) {
            await interaction.reply({ content: msgs.modAlreadyExists, flags: ['Ephemeral'] }); return;
        }

        state.moderators.push({ userId });
        state.moderatorsDone = true;
        this._configWizard.set(key, state);
        await this._showModeratorStep(interaction, state, interaction.guildId);
    }

    async _handleCfgModRemoveSelect(interaction) {
        const key = this._wizardKey(interaction.user.id, interaction.guildId);
        const state = this._configWizard.get(key);
        if (!state) { await interaction.update({ content: '⚠️ Session expired. Run `/configure` again.', embeds: [], components: [] }); return; }

        const userId = interaction.values[0];
        state.moderators = (state.moderators || []).filter(m => m.userId !== userId);
        this._configWizard.set(key, state);
        await this._showModeratorStep(interaction, state, interaction.guildId);
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

        // Krok 9 — moderatorzy gry: pomiń
        if (customId === 'cfg_mod_skip') {
            state.moderatorsDone = true;
            this._configWizard.set(key, state);
            const { embed, rows } = this._buildWizardDashboard(state, interaction.guildId);
            await interaction.update({ embeds: [embed], components: rows });
            return;
        }

        // Krok 9 — moderatorzy gry: dodaj (modal)
        if (customId === 'cfg_mod_add') {
            const modal = new ModalBuilder()
                .setCustomId('cfg_mod_add_modal')
                .setTitle(t('👮 Dodaj moderatora gry', '👮 Add Game Moderator'))
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('cfg_mod_user_id_input')
                        .setLabel(t('ID użytkownika Discord', 'Discord User ID'))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('123456789012345678')
                ));
            await interaction.showModal(modal);
            return;
        }

        // Krok 9 — moderatorzy gry: usuń (select menu)
        if (customId === 'cfg_mod_remove') {
            const mods = state.moderators || [];
            if (mods.length === 0) return;

            const options = await Promise.all(mods.map(async m => {
                let label = m.userId;
                try {
                    const member = await interaction.guild.members.fetch(m.userId);
                    label = (member.displayName || member.user.username).slice(0, 100);
                } catch {}
                return new StringSelectMenuOptionBuilder().setLabel(label).setValue(m.userId);
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('cfg_mod_remove_select')
                .setPlaceholder(t('Wybierz moderatora do usunięcia...', 'Select moderator to remove...'))
                .addOptions(options);
            const backBtn = new ButtonBuilder().setCustomId('cfg_step_9').setLabel(t('← Wstecz', '← Back')).setStyle(ButtonStyle.Secondary);
            const embed = new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🗑️ Usuń moderatora gry', '🗑️ Remove Game Moderator'))
                .setDescription(t('Wybierz moderatora do usunięcia z listy:', 'Select a moderator to remove from the list:'));
            await interaction.update({ embeds: [embed], components: [
                new ActionRowBuilder().addComponents(selectMenu),
                new ActionRowBuilder().addComponents(backBtn),
            ]});
            return;
        }

        // Krok 10 — auto-reakcja: włącz / zmień emotkę (modal)
        if (customId === 'cfg_autoreact_enable') {
            const modal = new ModalBuilder()
                .setCustomId('cfg_autoreact_modal')
                .setTitle(t('💫 Auto-reakcja', '💫 Auto Reaction'))
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('cfg_autoreact_emoji_input')
                        .setLabel(t('Emoji (np. 🔥) lub emotka customowa', 'Emoji (e.g. 🔥) or custom emote'))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder(t('🔥 lub :nazwa: lub <:nazwa:id>', '🔥 or :name: or <:name:id>'))
                        .setMaxLength(64)
                        .setValue(state.autoReactionEmoji || '')
                ));
            await interaction.showModal(modal);
            return;
        }

        // Krok 10 — auto-reakcja: wyłącz / pomiń
        if (customId === 'cfg_autoreact_disable') {
            state.autoReactionEmoji = null;
            state.autoReactionDone = true;
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
                moderators: state.moderators || [],
                communityVerification: state.communityVerifEnabled ? {
                    enabled: true,
                    rejectedChannelId: state.communityVerifChannelId || null,
                    threshold: state.communityVerifThreshold || 5,
                } : { enabled: false, rejectedChannelId: null, threshold: 5 },
                autoReactionEmoji: state.autoReactionEmoji || null,
                configuredBy: {
                    userId: interaction.user.id,
                    username: interaction.user.username,
                    configuredAt: new Date().toISOString(),
                },
            };
            // Nowy serwer domyślnie ma zablokowane OCR komendy.
            // Ogłoszenie o dołączeniu do rywalizacji NIE leci tutaj — poleci dopiero,
            // gdy head admin odblokuje na tym serwerze OCR `/update` (patrz
            // `_maybeAnnounceNewServer`). Do tego czasu serwer nic nie zgłasza,
            // więc nie ma czego ogłaszać.
            if (!wasAlreadyConfigured) {
                newData.ocrBlocked = ['update', 'test'];
                newData.newServerAnnounced = false;
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
                            { name: tCfg('Administrator', 'Administrator'), value: `[${interaction.member?.displayName || interaction.user.username}](https://discord.com/users/${interaction.user.id})` },
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
                            { name: tCfg('Administrator', 'Administrator'), value: `[${interaction.member?.displayName || interaction.user.username}](https://discord.com/users/${interaction.user.id})`, inline: true },
                            ...diffFields
                        )
                        .setTimestamp();
                }

                // Dedykowany kanał logów serwerowych
                if (this.config.serverLogChannelId) {
                    const serverLogChannel = await interaction.client.channels.fetch(this.config.serverLogChannelId).catch(() => null);
                    if (serverLogChannel) {
                        // Przycisk włączenia OCR `/update` dla TEGO serwera — nowy serwer startuje
                        // z zablokowanym OCR, więc head admin włącza go jednym kliknięciem prosto
                        // pod powiadomieniem, bez wchodzenia w panel i szukania serwera na liście.
                        const ocrRow = this._buildCfgOcrRow(interaction.guildId);
                        await serverLogChannel.send({
                            content: '<@398983446812295168>',
                            embeds: [configEmbed],
                            components: ocrRow ? [ocrRow] : [],
                        });
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

    _isGameModerator(userId, guildId) {
        const config = this.guildConfigService?.getConfig(guildId);
        return (config?.moderators || []).some(m => m.userId === userId);
    }

    _panelT(guildId) {
        const isPol = (this.config.getGuildConfig(guildId)?.lang || 'pol') !== 'eng';
        return (pol, eng) => isPol ? pol : eng;
    }

    /**
     * Język serwera dla tekstów wypalanych w bitmapę wykresu (miesiące na osi X, podpisy stref).
     * @param {string} guildId
     * @returns {'pol'|'eng'}
     */
    _chartLang(guildId) {
        return (this.config.getGuildConfig(guildId)?.lang || 'pol') === 'eng' ? 'eng' : 'pol';
    }

    /**
     * Rozbija datę na składowe wg strefy Europe/Warsaw (uwzględnia CET/CEST).
     */
    _warsawParts(date) {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Europe/Warsaw', hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const parts = fmt.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
        if (parts.hour === '24') parts.hour = '00';
        return parts;
    }

    /**
     * Konwertuje datę/godzinę podaną jako czas lokalny Europe/Warsaw (np. z modala admina)
     * na poprawny instant UTC — uwzględnia przesunięcie CET/CEST. Bez tego naiwne parsowanie
     * jako UTC (samo doklejenie 'Z') zapisywało harmonogram przesunięty o 1-2h względem tego,
     * co admin faktycznie wpisał.
     */
    _warsawToUtc(yyyy, mm, dd, hh, min) {
        const guess = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, 0));
        const p = this._warsawParts(guess);
        const asWarsaw = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
        const diff = guess.getTime() - asWarsaw.getTime();
        return new Date(guess.getTime() + diff);
    }

    /**
     * Formatuje datę do wyświetlenia w czasie Europe/Warsaw (DD.MM.RRRR GG:MM), niezależnie
     * od strefy czasowej, w jakiej działa proces bota.
     */
    _fmtWarsaw(date) {
        const p = this._warsawParts(date);
        return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
    }

    _buildAdminPanel(interaction) {
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(interaction.guildId);

        const descLines = [
            `👥 **${t('Zarządzaj użytkownikami', 'Manage Users')}** — ${t('blokowanie, odblokowanie, usuwanie graczy z rankingu', 'blocking, unblocking, removing players from ranking')}`,
            `🖥️ **${t('Zarządzaj serwerem', 'Manage Server')}** — ${t('OCR, limity, role, konfiguracja bossów', 'OCR, limits, roles, boss configuration')}`,
            `📊 **${t('Statystyki', 'Statistics')}** — ${t('zużycie tokenów, przyrost graczy, nieskonfigurowane serwery', 'token usage, player growth, unconfigured servers')}`,
        ];
        if (isHeadAdmin) {
            descLines.push(`\n📢 **${t('Wyślij Info', 'Send Info')}** — ${t('skomponuj wiadomość i wyślij ją na kanały wszystkich skonfigurowanych serwerów.', 'compose a message and send it to all configured servers\' channels.')}`);
            descLines.push(`📡 **${t('Centrum Dowodzenia', 'Command Center')}** — ${t('panel sterowania z live-statystykami OCR, graczy i kosztów AI, aktualizowany po każdej analizie.', 'control panel with live OCR, player and AI cost statistics, updated after each analysis.')}`);
        }

        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('⚙️ Panel Administracyjny', '⚙️ Admin Panel'))
            .setDescription(
                `**${t('Tryb', 'Mode')}: ${isHeadAdmin ? 'Head Admin' : 'Admin'}**\n\n` +
                descLines.join('\n')
            );

        // Rząd 1: 3 szare przyciski kategorii (Admin i Head Admin)
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_cat_users').setEmoji('👥').setLabel(t('Zarządzaj użytkownikami', 'Manage Users')).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_cat_server').setEmoji('🖥️').setLabel(t('Zarządzaj serwerem', 'Manage Server')).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_cat_stats').setEmoji('📊').setLabel(t('Statystyki', 'Statistics')).setStyle(ButtonStyle.Secondary),
        );

        const components = [row1];
        if (isHeadAdmin) {
            // Rząd 2 Head Admin: Wyślij Info + Centrum Dowodzenia
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_info').setEmoji('📢').setLabel(t('Wyślij Info', 'Send Info')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_cmd_center').setEmoji('📡').setLabel(t('Centrum Dowodzenia', 'Command Center')).setStyle(ButtonStyle.Primary),
            ));
        }

        return { embed, components };
    }

    async _handleAdminPanelOpen(interaction) {
        const { embed, components } = this._buildAdminPanel(interaction);
        await interaction.update({ embeds: [embed], components });
    }

    _buildUsersSubPanel(interaction) {
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(interaction.guildId);
        const back = new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary);
        if (isHeadAdmin) {
            return [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_block').setEmoji('🔒').setLabel(t('Zablokuj gracza', 'Block Player')).setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔓').setLabel(t('Odblokuj gracza', 'Unblock Player')).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('panel_remove').setEmoji('🗑️').setLabel(t('Usuń gracza z rankingu', 'Remove Player from Ranking')).setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🧹').setLabel(t('Usuń wynik', 'Remove Score')).setStyle(ButtonStyle.Danger),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🏆').setLabel(t('Usuń osiągnięcia', 'Remove Achievements')).setStyle(ButtonStyle.Danger),
                    back,
                ),
            ];
        }
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_remove').setEmoji('🗑️').setLabel(t('Usuń gracza z rankingu', 'Remove Player from Ranking')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🧹').setLabel(t('Usuń wynik', 'Remove Score')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_unblock').setEmoji('🔓').setLabel(t('Odblokuj gracza', 'Unblock Player')).setStyle(ButtonStyle.Secondary),
            back,
        )];
    }

    _buildServerSubPanel(interaction) {
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(interaction.guildId);
        const back = new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary);
        if (isHeadAdmin) {
            return [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ocr').setEmoji('🔄').setLabel(t('AI OCR', 'AI OCR')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_limit').setEmoji('⚙️').setLabel(t('Ustaw limity', 'Set Limits')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_tester').setEmoji('🧪').setLabel(t('Testerzy', 'Testers')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_top10_interval').setEmoji('📅').setLabel(t('Interwał TOP10', 'TOP10 Interval')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_process_roles').setEmoji('🔁').setLabel(t('Przetwórz role', 'Process Roles')).setStyle(ButtonStyle.Primary),
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('👾').setLabel(t('Konfiguracja bossów', 'Boss Configuration')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('🚫').setLabel(t('Zbanuj serwer', 'Ban Server')).setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('panel_delete_server_data').setEmoji('🗑️').setLabel(t('Usuń dane serwera', 'Delete Server Data')).setStyle(ButtonStyle.Danger),
                    back,
                ),
            ];
        }
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_process_roles').setEmoji('🔁').setLabel(t('Przetwórz role', 'Process Roles')).setStyle(ButtonStyle.Primary),
            back,
        )];
    }

    _buildStatsSubPanel(interaction) {
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(interaction.guildId);
        const back = new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary);
        const successRateBtn = new ButtonBuilder().setCustomId('panel_ocr_stats').setEmoji('🎯').setLabel(t('Success Rate', 'Success Rate')).setStyle(ButtonStyle.Secondary);
        const cmdUsageBtn = new ButtonBuilder().setCustomId('panel_cmd_usage').setEmoji('🔢').setLabel(t('Użycia komend', 'Command Usage')).setStyle(ButtonStyle.Secondary);
        if (isHeadAdmin) {
            return [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_tokens').setEmoji('📊').setLabel(t('Zużycie tokenów', 'Token Usage')).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('panel_unconfigured').setEmoji('⚠️').setLabel(t('Nieskonfigurowane', 'Unconfigured')).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('panel_player_growth').setEmoji('📈').setLabel(t('Przyrost graczy', 'Player Growth')).setStyle(ButtonStyle.Secondary),
                    successRateBtn,
                    back,
                ),
                new ActionRowBuilder().addComponents(cmdUsageBtn),
            ];
        }
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_tokens').setEmoji('📊').setLabel(t('Zużycie tokenów', 'Token Usage')).setStyle(ButtonStyle.Secondary),
            cmdUsageBtn,
            back,
        )];
    }

    async _handlePanelCatUsers(interaction) {
        const t = this._panelT(interaction.guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const lines = [
            t('🗑️ **Usuń gracza z rankingu** — wyszukaj gracza i usuń go z rankingu serwera; automatycznie aktualizuje role TOP.',
              '🗑️ **Remove Player from Ranking** — search for a player and remove them from the server ranking; automatically updates TOP roles.'),
            t('🔓 **Odblokuj gracza** — odblokowuje gracza zablokowanego przez admina; nie można odblokować graczy zablokowanych przez Head Admina.',
              '🔓 **Unblock Player** — unblocks a player blocked by an admin; cannot unblock players blocked by the Head Admin.'),
        ];
        if (isHeadAdmin) {
            lines.push(
                t('🔒 **Zablokuj gracza** — wyszukaj gracza cross-server i zablokuj mu dostęp do `/update`; tylko Head Admin może odblokować.',
                  '🔒 **Block Player** — search for a player cross-server and block their access to `/update`; only the Head Admin can unblock.'),
                t('🏆 **Usuń osiągnięcia** — usuń wybrane osiągnięcie lub wszystkie osiągnięcia i progress wybranego gracza na wybranym serwerze.',
                  '🏆 **Remove Achievements** — remove a selected achievement or all achievements and progress of a selected player on a selected server.'),
            );
        }
        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('👥 Zarządzaj użytkownikami', '👥 Manage Users'))
            .setDescription(lines.join('\n\n'));
        await interaction.update({ embeds: [embed], components: this._buildUsersSubPanel(interaction) });
    }

    async _handlePanelCatServer(interaction) {
        const t = this._panelT(interaction.guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const lines = [
            t('🔁 **Przetwórz role** — usuwa wszystkie role TOP od wszystkich członków serwera, a następnie przyznaje je od nowa na podstawie aktualnego rankingu. Przydatne gdy role są nie zsynchronizowane.',
              '🔁 **Process Roles** — removes all TOP roles from all server members, then reassigns them based on the current ranking. Useful when roles are out of sync.'),
        ];
        if (isHeadAdmin) {
            lines.push(
                t('🔄 **AI OCR on/off** — włącz lub wyłącz OCR (`/update`, `/test`) per serwer.',
                  '🔄 **AI OCR on/off** — enable or disable OCR (`/update`, `/test`) per server.'),
                t('⚙️ **Ustaw limity** — skonfiguruj cooldown po `/update` i dzienny limit użyć.',
                  '⚙️ **Set Limits** — configure cooldown after `/update` and daily usage limit.'),
                t('🧪 **Testerzy** — zarządzaj listą testerów uprawnionych do `/test`.',
                  '🧪 **Testers** — manage the list of testers authorized to use `/test`.'),
                t('📅 **Interwał TOP10** — ustaw datę i godzinę pierwszego raportu TOP10 globalnego (potem co ~3 dni automatycznie).',
                  '📅 **TOP10 Interval** — set the date and time of the first global TOP10 report (then automatically every ~3 days).'),
                t('👾 **Konfiguracja bossów** — zarządzaj angielskimi nazwami bossów i ich aliasami w innych językach (automatyczna normalizacja OCR).',
                  '👾 **Boss Configuration** — manage English boss names and their aliases in other languages (automatic OCR normalization).'),
                t('🚫 **Zbanuj serwer** — wyrzuć bota z wybranego serwera i zablokuj możliwość ponownego dodania go do tego serwera.',
                  '🚫 **Ban Server** — remove the bot from a selected server and prevent it from being re-added to that server.'),
            );
        }
        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('🖥️ Zarządzaj serwerem', '🖥️ Manage Server'))
            .setDescription(lines.join('\n\n'));
        await interaction.update({ embeds: [embed], components: this._buildServerSubPanel(interaction) });
    }

    async _handlePanelCatStats(interaction) {
        const t = this._panelT(interaction.guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const lines = [
            t('📊 **Zużycie tokenów** — statystyki zużycia AI OCR dla Twojego serwera (zapytania, tokeny).',
              '📊 **Token Usage** — AI OCR usage statistics for your server (requests, tokens).'),
        ];
        if (isHeadAdmin) {
            lines.push(
                t('🎯 **Success Rate** — procent analiz OCR bez interwencji admina (zatwierdzone + odrzucone, ale nienaprawiane); drugi licznik pokazuje ile razy admin musiał interweniować (ręczna analiza lub cofnięcie wyniku).',
                  '🎯 **Success Rate** — percentage of OCR analyses without admin intervention (approved + rejected but untouched); second counter shows how many times admin had to intervene (manual analysis or record reversion).'),
                t('⚠️ **Nieskonfigurowane** — lista serwerów, na których bot jest obecny, ale nie został jeszcze skonfigurowany przez /configure.',
                  '⚠️ **Unconfigured** — list of servers where the bot is present but has not yet been configured via /configure.'),
                t('📈 **Przyrost graczy** — statystyki i wykres kumulatywnego przyrostu unikalnych graczy globalnie w czasie.',
                  '📈 **Player Growth** — statistics and chart of cumulative unique player growth globally over time.'),
            );
        }
        const embed = new EmbedBuilder()
            .setColor(isHeadAdmin ? 0xFF6B35 : 0x5865F2)
            .setTitle(t('📊 Statystyki', '📊 Statistics'))
            .setDescription(lines.join('\n\n'));
        await interaction.update({ embeds: [embed], components: this._buildStatsSubPanel(interaction) });
    }

    _formatRate(success, total) {
        if (total === 0) return '—';
        return `${((success / total) * 100).toFixed(1)}%`;
    }

    _buildOcrStatsEmbed(interaction) {
        const t = this._panelT(interaction.guildId);
        const stats = this.ocrStatsService?.getStats();
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(t('🎯 Success Rate — Analizy OCR (globalnie)', '🎯 Success Rate — OCR Analyses (global)'));

        if (!stats || stats.allTime.total === 0) {
            embed.setDescription(t('Brak danych — żadna analiza OCR jeszcze nie została wykonana.', 'No data — no OCR analysis has been performed yet.'));
        } else {
            const at = stats.allTime;
            const rs = stats.resettable;

            // Success rate = (total - adminFixed) / total
            // "Sukces" = poprawna analiza LUB odrzucona, ale nieprzeanalizowana przez admina
            const atSuccessCount = at.total - (at.adminFixed || 0);
            const rsSuccessCount = rs.total - (rs.adminFixed || 0);
            const resetInfo = rs.resetAt
                ? `\n${t('Ostatni reset', 'Last reset')}: <t:${Math.floor(new Date(rs.resetAt).getTime() / 1000)}:R>`
                : '';

            embed.addFields({ name: t('✅ Success Rate', '✅ Success Rate'), value:
                `**${t('Od zawsze', 'All time')}**: **${atSuccessCount}** / ${at.total} → **${this._formatRate(atSuccessCount, at.total)}**\n` +
                `**${t('Resetowalny', 'Resettable')}**: **${rsSuccessCount}** / ${rs.total} → **${this._formatRate(rsSuccessCount, rs.total)}**` +
                resetInfo,
            });

            // Podwójna analiza wzorca — druga próba pozytywna (% względem wszystkich analiz)
            const atDouble = at.doubleCheckRecovered || 0;
            const rsDouble = rs.doubleCheckRecovered || 0;
            embed.addFields({ name: t('🔁 Wzorzec OK za 2. razem', '🔁 Template OK on 2nd try'), value:
                `**${t('Od zawsze', 'All time')}**: **${atDouble}** / ${at.total} → **${this._formatRate(atDouble, at.total)}**\n` +
                `**${t('Resetowalny', 'Resettable')}**: **${rsDouble}** / ${rs.total} → **${this._formatRate(rsDouble, rs.total)}**`,
            });

            // Fail counter = adminFixed (ręczna analiza admina + cofnięcia)
            embed.addFields({ name: t('❌ Interwencje admina (Fail)', '❌ Admin interventions (Fail)'), value:
                t(
                    `**Od zawsze**: **${at.adminFixed || 0}** (analizy manualne + cofnięcia)\n**Resetowalny**: **${rs.adminFixed || 0}**`,
                    `**All time**: **${at.adminFixed || 0}** (manual analyses + reversions)\n**Resettable**: **${rs.adminFixed || 0}**`
                ),
            });
        }

        return embed;
    }

    _buildOcrStatsComponents(interaction) {
        const t = this._panelT(interaction.guildId);
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_ocr_stats_reset').setEmoji('🔄').setLabel(t('Resetuj liczniki', 'Reset counters')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_cat_stats').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
        )];
    }

    async _handlePanelOcrStats(interaction) {
        const embed = this._buildOcrStatsEmbed(interaction);
        const components = this._buildOcrStatsComponents(interaction);
        await interaction.update({ embeds: [embed], components });
    }

    async _handlePanelOcrStatsReset(interaction) {
        const t = this._panelT(interaction.guildId);
        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(t('🔄 Potwierdź reset liczników', '🔄 Confirm counter reset'))
            .setDescription(t(
                'Czy na pewno chcesz zresetować **resetowalne liczniki Success Rate i Fail**?\n\nLiczniki "od zawsze" pozostaną nienaruszony.',
                'Are you sure you want to reset the **resettable Success Rate and Fail counters**?\n\nThe all-time counters will remain unchanged.'
            ));
        const components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_ocr_stats_reset_ok').setEmoji('✅').setLabel(t('Tak, resetuj', 'Yes, reset')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_ocr_stats').setEmoji('◀️').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
        )];
        await interaction.update({ embeds: [embed], components });
    }

    async _handlePanelOcrStatsResetConfirm(interaction) {
        const t = this._panelT(interaction.guildId);
        if (this.ocrStatsService) {
            await this.ocrStatsService.resetResettable();
        }
        const embed = this._buildOcrStatsEmbed(interaction);
        const components = this._buildOcrStatsComponents(interaction);
        embed.setFooter({ text: t('Resetowalne liczniki zresetowane.', 'Resettable counters have been reset.') });
        await interaction.update({ embeds: [embed], components });
    }

    async _handlePanelCmdCenter(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const t = this._panelT(interaction.guildId);
        const svc = this.adminPanelService;
        let desc;
        if (!svc?.isConfigured()) {
            desc = t(
                '⚠️ **Panel nie jest skonfigurowany.**\nUstaw `ENDERSECHO_ADMIN_PANEL_CHANNEL_ID` w `.env` i zrestartuj bota.',
                '⚠️ **Panel is not configured.**\nSet `ENDERSECHO_ADMIN_PANEL_CHANNEL_ID` in `.env` and restart the bot.'
            );
        } else {
            const channelId = svc.getChannelId();
            const messageId = svc.getMessageId();
            if (messageId) {
                desc = t(
                    `📡 **Centrum Dowodzenia jest aktywne** na kanale <#${channelId}>.\n\nPanel odświeża się automatycznie po każdej akcji. Kliknij **Odśwież Panel** żeby wymusić aktualizację.`,
                    `📡 **Command Center is active** on channel <#${channelId}>.\n\nThe panel updates automatically after each action. Click **Refresh Panel** to force an update.`
                );
            } else {
                desc = t(
                    `📬 Kanał ustawiony: <#${channelId}>\n⏳ Wiadomość zostanie wysłana przy najbliższym refresh.`,
                    `📬 Channel set: <#${channelId}>\n⏳ The message will be sent on next refresh.`
                );
            }
        }
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle(t('📡 Centrum Dowodzenia', '📡 Command Center'))
                .setDescription(desc)
            ],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_cmd_center_refresh').setEmoji('🔄').setLabel(t('Odśwież Panel', 'Refresh Panel')).setStyle(ButtonStyle.Primary).setDisabled(!svc?.isConfigured()),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _handlePanelCmdCenterRefresh(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();

        const svc = this.adminPanelService;
        if (!svc?.isConfigured()) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('❌ Błąd', '❌ Error'))
                    .setDescription(t('Panel nie jest skonfigurowany.', 'Panel is not configured.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_cmd_center').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
                )]
            });
            return;
        }

        await svc._doRefresh().catch(() => {});

        const channelId = svc.getChannelId();
        const messageId = svc.getMessageId();
        const statusLine = messageId
            ? t(`✅ Panel odświeżony — <#${channelId}>`, `✅ Panel refreshed — <#${channelId}>`)
            : t(`⚠️ Nie udało się znaleźć wiadomości panelu.`, `⚠️ Panel message not found.`);

        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57F287)
                .setTitle(t('📡 Centrum Dowodzenia', '📡 Command Center'))
                .setDescription(statusLine)],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_cmd_center').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
            )]
        });
    }

    // ─── Panel message CC handlers (ephemeral) ───────────────────────────────

    async _handleCcRefresh(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const svc = this.adminPanelService;
        if (!svc?.isConfigured()) {
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4444).setDescription('❌ Panel nie jest skonfigurowany.')], flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });
        await svc._doRefresh().catch(() => {});
        const channelId = svc.getChannelId();
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x57F287)
                .setTitle('✅ Panel odświeżony')
                .setDescription(`Panel Centrum Dowodzenia na <#${channelId}> został zaktualizowany.`)
            ]
        });
    }

    // ─── CC Panel — nowe akcje (cc_action_*) ─────────────────────────────────

    async _handleCcActionUnblock(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const blocked = await this.userBlockService?.getBlockedUsers().catch(() => []) ?? [];
        if (blocked.length === 0) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('✅ Brak zablokowanych graczy.')],
                flags: ['Ephemeral'],
            });
            return;
        }
        // Pokaż modal wyszukiwania
        const modal = new ModalBuilder()
            .setCustomId('panel_unblock_search_modal')
            .setTitle('Odblokuj gracza');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('unblock_query')
                .setLabel('Fragment nicku gracza')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handleCcActionRoles(interaction, page = 0) {
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
        if (!this._isHeadAdmin(interaction.user.id) && !isAdmin) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        // Head admin przelicza role na DOWOLNYM serwerze bota (panel stoi na jednym serwerze,
        // a role trzeba naprawiać tam, gdzie się rozjechały). Zwykły admin — tylko u siebie.
        const servers = this._isHeadAdmin(interaction.user.id)
            ? this._ccConfiguredServers(interaction)
            : this._ccConfiguredServers(interaction).filter(s => s.id === interaction.guildId);

        if (servers.length === 0) {
            await interaction.reply({ content: '❌ Brak skonfigurowanych serwerów z botem.', flags: ['Ephemeral'] });
            return;
        }

        const payload = {
            embeds: [new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle('🔁 Przetwórz role TOP')
                .setDescription(
                    'Wybierz serwer, na którym przeliczyć role TOP.\n\n' +
                    'Akcja jest bezpieczna — usuwa stare role i przyznaje nowe wg aktualnego rankingu.'
                )
            ],
            components: this._buildServerPickerRows({
                servers,
                page,
                selectId: 'cc_roles_sel',
                pagePrefix: 'cc_roles_pg',
                placeholder: 'Wybierz serwer do przeliczenia ról',
            }),
        };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({ ...payload, flags: ['Ephemeral'] });
        }
    }

    async _handleCcActionTester(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const t = this._panelT(interaction.guildId);
        const testers = this.testerService ? this.testerService.getTesters() : [];
        let desc;
        if (testers.length > 0) {
            const nameMap = await this._resolveTesterNames(testers, interaction.guild);
            desc = testers.map((te, i) => {
                const name = nameMap.get(te.userId);
                return name ? `${i + 1}. **${name}** (<@${te.userId}>)` : `${i + 1}. <@${te.userId}>`;
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
        );
        await interaction.reply({ embeds: [embed], components: [row], flags: ['Ephemeral'] });
    }

    /**
     * Nick do wpisu w dzienniku akcji. Dziennik czytają ludzie, więc ma zawierać NICKI —
     * ani surowych ID (nieczytelne), ani pingów `<@id>` (renderują się w embedzie panelu
     * jako klikalna wzmianka i potrafią pingnąć gracza przy każdym odświeżeniu panelu).
     *
     * Przyjmuje `userId` albo `playerKey` (`123#2`) — znacznik profilu zostaje w nazwie.
     * @returns {Promise<string>} nick, a gdy nie da się go ustalić — samo ID
     */
    async _ccName(interaction, idOrKey) {
        const raw = String(idOrKey ?? '').trim();
        if (!raw) return 'nieznany';
        const ownerId = getOwnerId(raw);
        if (!/^\d{5,}$/.test(String(ownerId))) return raw;   // to już nie jest ID — zostaw jak jest

        let nick = null;
        try {
            const member = interaction.guild?.members?.cache?.get(ownerId)
                || await interaction.guild?.members?.fetch(ownerId).catch(() => null);
            nick = member?.displayName || null;
        } catch { /* brak na tym serwerze — próbujemy dalej */ }

        if (!nick) {
            try {
                // Gracz może być z innego serwera bota — ranking trzyma jego nick
                const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                const activeGuildIds = new Set(configuredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                const globalRanking = await this.rankingService.getGlobalRanking(activeGuildIds);
                nick = globalRanking.find(p => (p.playerKey || p.userId) === raw)?.username
                    || globalRanking.find(p => getOwnerId(p.playerKey || p.userId) === ownerId)?.username
                    || null;
            } catch { /* zostanie fallback na ID */ }
        }

        if (!nick) {
            const user = interaction.client.users.cache.get(ownerId);
            nick = user?.username || null;
        }

        return nick ? formatProfileDisplayName(nick, raw) : raw;
    }

    /**
     * Wiersz z przyciskiem „Włącz OCR /update" pod powiadomieniem o konfiguracji serwera
     * (kanał logów serwerowych head admina).
     *
     * `null`, gdy OCR `/update` jest już na tym serwerze odblokowany — wtedy przycisk
     * niczego by nie zmieniał.
     */
    _buildCfgOcrRow(guildId) {
        if (!guildId) return null;
        if (!this.ocrBlockService?.isBlocked(guildId, 'update')) return null;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`cfg_ocr_en_${guildId}`)
                .setEmoji('🔓')
                .setLabel('Włącz OCR /update')
                .setStyle(ButtonStyle.Success)
        );
    }

    /**
     * Przycisk „Włącz OCR /update" spod powiadomienia o konfiguracji serwera.
     * Robi to samo co panel (`ocrBlockService.unblock` + info na kanał bota tego serwera),
     * ale ZOSTAWIA embed powiadomienia — podmienia tylko przycisk na wyszarzone potwierdzenie.
     */
    async _handleCfgOcrEnable(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const targetGuildId = interaction.customId.replace('cfg_ocr_en_', '');
        const guildConfig = this.config.getGuildConfig(targetGuildId);
        const serverName = this.guildConfigService?.getConfig(targetGuildId)?.guildName
            || interaction.client.guilds.cache.get(targetGuildId)?.name
            || targetGuildId;

        if (!guildConfig) {
            await interaction.reply({ content: `❌ Serwer **${serverName}** nie jest skonfigurowany.`, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferUpdate();
        await this.ocrBlockService.unblock(targetGuildId, ['update']);
        logger.info(`🔓 OCR odblokowany dla \`/update\` na serwerze ${serverName} (przycisk pod powiadomieniem o konfiguracji)`);

        // Ta sama informacja dla serwera co przy odblokowaniu z panelu
        if (guildConfig.allowedChannelId) {
            const ch = await interaction.client.channels.fetch(guildConfig.allowedChannelId).catch(() => null);
            if (ch) {
                const guildMsgs = this.config.getMessages(targetGuildId);
                await ch.send({ content: formatMessage(guildMsgs.ocrBlockPerGuildDisabled, { commands: '`/update`', serverName }) }).catch(() => {});
            }
        }

        await interaction.editReply({
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cfg_ocr_done')
                    .setEmoji('✅')
                    .setLabel(`OCR /update włączony — ${interaction.member?.displayName || interaction.user.username}`.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            )],
        });

        this._ccAudit(interaction, `🔓 Włączono OCR /update — ${serverName}`);
        this.adminPanelService?.refresh();

        // Serwer właśnie realnie dołączył do rywalizacji — czas na ogłoszenie
        await this._maybeAnnounceNewServer(interaction.client, targetGuildId, ['update']);
    }

    /** Dopisuje wpis do dziennika akcji admina w Centrum Dowodzenia */
    _ccAudit(interaction, action) {
        try {
            const adminName = interaction.member?.displayName || interaction.user?.username || 'admin';
            this.adminPanelService?.logAdminAction?.(adminName, action);
        } catch { /* dziennik nie może blokować akcji */ }
    }

    // ── CC: Podgląd gracza ───────────────────────────────────────────────────
    async _handleCcPlayerLookup(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('cc_player_lookup_modal')
            .setTitle('Podgląd gracza');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('cc_player_query')
                .setLabel('Fragment nicku gracza')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handleCcPlayerLookupModal(interaction) {
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const query = interaction.fields.getTextInputValue('cc_player_query').trim().toLowerCase();
        const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
        const matches = globalRanking.filter(p => (p.username || '').toLowerCase().includes(query));

        if (matches.length === 0) {
            await interaction.editReply({ content: `❌ Nie znaleziono gracza pasującego do "${query}".` });
            return;
        }
        if (matches.length === 1) {
            const embed = await this._buildCcPlayerDetailEmbed(matches[0], globalRanking, interaction.client);
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        const options = matches.slice(0, 25).map(p => ({
            label: formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 100),
            description: `${p.score || ''} ${p.bossName ? `· ${p.bossName}` : ''}`.trim().slice(0, 100) || undefined,
            value: p.playerKey || p.userId,
        }));
        const select = new StringSelectMenuBuilder()
            .setCustomId('cc_player_lookup_sel')
            .setPlaceholder(`Wyniki (${matches.length}) — wybierz gracza`)
            .addOptions(options);
        await interaction.editReply({
            content: `🔍 Znaleziono **${matches.length}** graczy:`,
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    async _handleCcPlayerLookupSelect(interaction) {
        await interaction.deferUpdate();
        const selectedPlayerKey = interaction.values[0];
        const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
        const player = globalRanking.find(p => (p.playerKey || p.userId) === selectedPlayerKey);
        if (!player) {
            await interaction.editReply({ content: '❌ Gracz nie znaleziony w rankingu.', components: [] });
            return;
        }
        const embed = await this._buildCcPlayerDetailEmbed(player, globalRanking, interaction.client);
        await interaction.editReply({ content: null, embeds: [embed], components: [] });
    }

    /** Buduje szczegółowy embed gracza dla Centrum Dowodzenia (rekord, blokady, cooldown, odrzucenia, osiągnięcia) */
    async _buildCcPlayerDetailEmbed(player, globalRanking, client) {
        const cfgSvc = this.guildConfigService;
        // Pozycja dotyczy PROFILU; blokady/cooldown/odrzucenia niżej — właściciela (osoby)
        const position = globalRanking.findIndex(p => (p.playerKey || p.userId) === (player.playerKey || player.userId)) + 1;
        const serverName = cfgSvc?.getConfig(player.sourceGuildId)?.guildName || player.sourceGuildId || '—';

        // Blokada
        let blockValue = '✅ Nie';
        try {
            const blocked = await this.userBlockService?.getBlockedUsers() ?? [];
            const entry = blocked.find(b => b.userId === player.userId);
            if (entry) {
                blockValue = entry.blockedUntil
                    ? `🔒 Tak — do ${new Date(entry.blockedUntil).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`
                    : '🔒 Tak — permanentnie';
                if (entry.blockedByHeadAdmin) blockValue += ' (head admin)';
            }
        } catch { /* opcjonalne */ }

        // Cooldown
        const remainingMs = this.updateCooldownService?.getRemainingMs(player.userId);
        const cooldownValue = remainingMs ? `⏳ ${formatCooldownTime(remainingMs)}` : '✅ Brak';

        // Odrzucenia w tym miesiącu (wszystkie serwery)
        const month = new Date().toISOString().slice(0, 7);
        let rejections = 0;
        try {
            const rejData = this.ocrStatsService?.getStats()?.userRejections || {};
            for (const guildRej of Object.values(rejData)) {
                rejections += guildRej?.[player.userId]?.[month] || 0;
            }
        } catch { /* opcjonalne */ }

        // Osiągnięcia (serwer źródłowy rekordu)
        let achCount = null;
        try {
            const unlocked = await this.achievementService?.getUnlockedAchievements(player.sourceGuildId, player.playerKey || player.userId);
            if (Array.isArray(unlocked)) achCount = unlocked.length;
        } catch { /* opcjonalne */ }

        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🔍 ${player.username || player.userId}`)
            .addFields(
                { name: '🌐 Pozycja globalna', value: position > 0 ? `#${position} / ${globalRanking.length}` : '—', inline: true },
                { name: '🏆 Rekord', value: `${player.score || '—'}${player.bossName ? ` (${player.bossName})` : ''}`, inline: true },
                { name: '🖥️ Serwer', value: serverName, inline: true },
                { name: '🔒 Zablokowany', value: blockValue, inline: true },
                { name: '⏳ Cooldown', value: cooldownValue, inline: true },
                { name: `🚫 Odrzucenia (${month})`, value: `${rejections}`, inline: true },
                { name: '🏅 Osiągnięcia', value: achCount !== null ? `${achCount}` : '—', inline: true },
                { name: '👤 Profil', value: `<@${player.userId}>`, inline: true },
            )
            .setTimestamp();
    }

    // ── CC: Wyczyść cooldown gracza ──────────────────────────────────────────
    async _handleCcClearCooldown(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const now = Date.now();
        const active = [];
        for (const [userId, entry] of (this.updateCooldownService?._cooldowns || new Map())) {
            if (entry.expiresAt > now) active.push({ userId, remainingMs: entry.expiresAt - now });
        }
        if (active.length === 0) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('✅ Brak aktywnych cooldownów.')],
                flags: ['Ephemeral'],
            });
            return;
        }
        const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys())).catch(() => []);
        const nameMap = new Map(globalRanking.map(p => [p.userId, p.username]));
        const options = active.slice(0, 25).map(a => ({
            label: (nameMap.get(a.userId) || a.userId).slice(0, 100),
            description: `Pozostało: ${formatCooldownTime(a.remainingMs)}`.slice(0, 100),
            value: a.userId,
        }));
        const select = new StringSelectMenuBuilder()
            .setCustomId('cc_clear_cd_sel')
            .setPlaceholder(`Aktywne cooldowny (${active.length}) — wybierz gracza`)
            .addOptions(options);
        await interaction.reply({
            content: '🧊 Wybierz gracza, któremu wyczyścić cooldown:',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: ['Ephemeral'],
        });
    }

    async _handleCcClearCooldownSelect(interaction) {
        const userId = interaction.values[0];
        await this.updateCooldownService.clearCooldown(userId);
        const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys())).catch(() => []);
        const username = globalRanking.find(p => p.userId === userId)?.username || userId;
        this._ccAudit(interaction, `🧊 Wyczyszczono cooldown: ${username}`);
        this.adminPanelService?.refresh();
        await interaction.update({
            content: `✅ Cooldown gracza **${username}** został wyczyszczony.`,
            components: [],
        });
    }

    // ── CC: Oczekujące zgłoszenia CV ─────────────────────────────────────────
    async _handleCcPendingCv(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const sessions = Object.entries(this.communityVerificationService?._sessions || {})
            .filter(([, s]) => s.status === 'pending')
            .sort((a, b) => new Date(b[1].createdAt || 0) - new Date(a[1].createdAt || 0));

        if (sessions.length === 0) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('✅ Brak oczekujących zgłoszeń weryfikacji społeczności.')],
                flags: ['Ephemeral'],
            });
            return;
        }
        const cfgSvc = this.guildConfigService;
        const lines = sessions.slice(0, 15).map(([msgId, s]) => {
            const serverName = cfgSvc?.getConfig(s.guildId)?.guildName || s.guildId;
            const link = s.messageUrl ? ` — [wiadomość](${s.messageUrl})` : '';
            return `• <@${s.userId}> — zgłoszeń: **${s.count || 0}** — ${serverName}${link}`;
        });
        if (sessions.length > 15) lines.push(`... i ${sessions.length - 15} więcej`);
        let cvDesc = lines.join('\n');
        if (cvDesc.length > 4000) cvDesc = cvDesc.slice(0, 3998) + '…';
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle(`🗳️ Oczekujące zgłoszenia CV (${sessions.length})`)
                .setDescription(cvDesc)],
            flags: ['Ephemeral'],
        });
    }

    // ── CC: Nieskonfigurowane serwery (wersja ephemeral, nie rusza wiadomości panelu) ──
    /** Serwery, na których bot jest, ale nie przeszły /configure */
    _ccUnconfiguredServers(interaction) {
        const servers = [];
        for (const [guildId, guild] of interaction.client.guilds.cache) {
            if (this.config.adminGuildId && guildId === this.config.adminGuildId) continue;
            if (!this.guildConfigService.isConfigured(guildId)) {
                servers.push({ id: guildId, name: guild.name, memberCount: guild.memberCount, hint: `${guild.memberCount} członków` });
            }
        }
        return servers.sort((a, b) => a.name.localeCompare(b.name));
    }

    async _handleCcUnconfigured(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const t = this._panelT(interaction.guildId);
        const unconfigured = this._ccUnconfiguredServers(interaction);
        const description = unconfigured.length === 0
            ? t('✅ Wszystkie serwery z botem są skonfigurowane.', '✅ All servers with the bot are configured.')
            : unconfigured.map(g => `• **${g.name}** (\`${g.id}\`) — ${g.memberCount} członków`).join('\n');

        // Serwer, który nigdy nie przeszedł /configure, zwykle po prostu trzyma bota bez pożytku —
        // stąd kickowanie dostępne od razu pod listą, zamiast szukania serwera po ID gdzie indziej.
        const components = unconfigured.length > 0
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cc_unconf_kick').setEmoji('👢')
                    .setLabel(t('Kicknij bota z serwera', 'Kick bot from server')).setStyle(ButtonStyle.Danger)
            )]
            : [];

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(unconfigured.length > 0 ? 0xFEE75C : 0x57F287)
                .setTitle(t('⚠️ Nieskonfigurowane serwery', '⚠️ Unconfigured Servers'))
                .setDescription(description)],
            components,
            flags: ['Ephemeral'],
        });
    }

    /** Lista nieskonfigurowanych serwerów do wyboru — krok 1 kickowania */
    async _handleCcUnconfKick(interaction, page = 0) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const servers = this._ccUnconfiguredServers(interaction);
        if (servers.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle('✅ Nieskonfigurowane serwery')
                    .setDescription('Nie ma już nieskonfigurowanych serwerów.')],
                components: [],
            });
            return;
        }
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF4444)
                .setTitle('👢 Kicknij bota z serwera')
                .setDescription('Wybierz serwer, z którego bot ma wyjść. Przed usunięciem zapytam o potwierdzenie.')],
            components: this._buildServerPickerRows({
                servers,
                page,
                selectId: 'cc_kick_sel',
                pagePrefix: 'cc_kick_pg',
                placeholder: 'Wybierz serwer do opuszczenia',
            }),
        });
    }

    /** Potwierdzenie przed wyjściem bota — krok 2 kickowania */
    async _handleCcKickSelect(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const guildId = interaction.values[0];
        const guild = interaction.client.guilds.cache.get(guildId);
        if (!guild) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Serwer niedostępny')
                    .setDescription('Bota już nie ma na tym serwerze albo nie ma go w cache.')],
                components: [],
            });
            return;
        }
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF4444)
                .setTitle('⚠️ Na pewno usunąć bota z serwera?')
                .setDescription(
                    `Bot opuści serwer **${guild.name}** (\`${guild.id}\`, ${guild.memberCount} członków).\n\n` +
                    'Aby wrócić, serwer musi ponownie zaprosić bota. Dane serwera zostają nietknięte.'
                )],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`cc_kick_ok_${guild.id}`).setEmoji('✅').setLabel('Tak, usuń bota').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('cc_kick_no').setEmoji('❌').setLabel('Nie, anuluj').setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    /** Wyjście bota z serwera — krok 3 kickowania */
    async _handleCcKickConfirm(interaction, guildId) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const guild = interaction.client.guilds.cache.get(guildId);
        const guildName = guild?.name || guildId;
        await interaction.deferUpdate();

        try {
            await guild.leave();
            logger.warn(`👢 Bot opuścił serwer "${guildName}" (${guildId}) — decyzja head admina z Centrum Dowodzenia`);
            this._ccAudit(interaction, `👢 Usunięto bota z serwera: ${guildName}`);
            this.adminPanelService?.refresh();
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle('✅ Bot usunięty z serwera')
                    .setDescription(`Bot opuścił serwer **${guildName}**.`)],
                components: [],
            });
        } catch (err) {
            logger.error(`❌ Nie udało się opuścić serwera "${guildName}" (${guildId}): ${err.message}`);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle('❌ Nie udało się usunąć bota')
                    .setDescription(`Serwer **${guildName}** — \`${err.message}\``)],
                components: [],
            });
        }
    }

    // ── CC: Diagnostyka wybranego serwera ────────────────────────────────────
    /**
     * Wspólny, stronicowany wybór serwera dla akcji Centrum Dowodzenia.
     *
     * Select menu Discorda przyjmuje MAX 25 opcji — przy większej liczbie serwerów
     * reszta po prostu znikała z listy. Stąd paginacja: strona jest zaszyta w customId
     * przycisków, więc nie trzeba trzymać stanu sesji per admin.
     *
     * @param {{id: string, name: string, hint?: string}[]} servers
     * @returns {ActionRowBuilder[]}
     */
    _buildServerPickerRows({ servers, page = 0, selectId, pagePrefix, placeholder }) {
        const PER_PAGE = 25;
        const totalPages = Math.max(1, Math.ceil(servers.length / PER_PAGE));
        const safePage = Math.min(Math.max(0, page), totalPages - 1);
        const slice = servers.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

        const select = new StringSelectMenuBuilder()
            .setCustomId(selectId)
            .setPlaceholder(totalPages > 1 ? `${placeholder} (${safePage + 1}/${totalPages})` : placeholder)
            .addOptions(slice.map(g => {
                const option = { label: g.name.slice(0, 100), value: g.id };
                if (g.hint) option.description = String(g.hint).slice(0, 100);
                return option;
            }));

        const rows = [new ActionRowBuilder().addComponents(select)];
        if (totalPages > 1) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${pagePrefix}_${safePage - 1}`).setEmoji('◀️')
                    .setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
                new ButtonBuilder().setCustomId('cc_pg_label').setLabel(`${safePage + 1} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`${pagePrefix}_${safePage + 1}`).setEmoji('▶️')
                    .setStyle(ButtonStyle.Secondary).setDisabled(safePage === totalPages - 1),
            ));
        }
        return rows;
    }

    /** Skonfigurowane serwery, na których bot faktycznie jest — do wyboru w akcjach CC */
    _ccConfiguredServers(interaction) {
        const cfgSvc = this.guildConfigService;
        const servers = [];
        for (const guildId of cfgSvc.getAllConfiguredGuildIds()) {
            const g = interaction.client.guilds.cache.get(guildId);
            if (g) servers.push({ id: guildId, name: cfgSvc.getConfig(guildId)?.guildName || g.name, hint: `${g.memberCount} członków` });
        }
        return servers.sort((a, b) => a.name.localeCompare(b.name));
    }

    async _handleCcDiagServer(interaction, page = 0) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const servers = this._ccConfiguredServers(interaction);
        if (servers.length === 0) {
            await interaction.reply({ content: '❌ Brak skonfigurowanych serwerów z botem.', flags: ['Ephemeral'] });
            return;
        }
        const payload = {
            content: '🔍 Diagnostyka uprawnień — wybierz serwer:',
            components: this._buildServerPickerRows({
                servers,
                page,
                selectId: 'cc_diag_sel',
                pagePrefix: 'cc_diag_pg',
                placeholder: 'Wybierz serwer do diagnostyki',
            }),
        };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({ ...payload, flags: ['Ephemeral'] });
        }
    }

    async _handleCcDiagSelect(interaction) {
        const guildId = interaction.values[0];
        const guild = interaction.client.guilds.cache.get(guildId);
        if (!guild) {
            await interaction.update({ content: '❌ Serwer niedostępny w cache.', components: [] });
            return;
        }
        const t = this._panelT(interaction.guildId);
        // Diagnostyka odpytuje API (member, role, każdy kanał z osobna) i wysyła
        // wiadomość próbną — spokojnie przekracza 3-sekundowe okno na odpowiedź.
        // Bez wcześniejszego potwierdzenia interakcja kończy się błędem 10062.
        await interaction.deferUpdate();
        const embed = await this._buildDiagnosticsEmbed(guild, t, interaction.client);
        await interaction.editReply({ content: null, embeds: [embed], components: [] });
    }

    // ── CC: Podgląd raportu TOP10 na żądanie ─────────────────────────────────
    async _handleCcTop10Preview(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const embed = await this.globalTop10Service.buildOnDemandEmbed(this.msgs(interaction.guildId), interaction.client);
            await interaction.editReply({ content: '📢 Podgląd raportu TOP10 (wskaźniki zmian są symulowane):', embeds: [embed] });
        } catch (err) {
            await interaction.editReply({ content: `❌ Błąd generowania podglądu: ${err.message}` });
        }
    }

    // ── CC: Konfiguracja bossów (wersja ephemeral) ───────────────────────────
    async _handleCcActionBossCfg(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        if (!this.bossAliasService) {
            await interaction.reply({ content: '⚠️ BossAliasService niedostępny.', flags: ['Ephemeral'] });
            return;
        }
        const { embed, components } = this._buildBossConfigPanel(interaction);
        await interaction.reply({ embeds: [embed], components, flags: ['Ephemeral'] });
    }

    // ── CC: Alert kosztowy ───────────────────────────────────────────────────
    async _handleCcCostAlert(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const current = this.adminPanelService?.getCostAlertThreshold?.();
        const modal = new ModalBuilder()
            .setCustomId('cc_cost_alert_modal')
            .setTitle('Alert kosztowy AI');
        const input = new TextInputBuilder()
            .setCustomId('cc_cost_alert_value')
            .setLabel('Próg dzienny w USD (puste = wyłącz)')
            .setPlaceholder('np. 0.50')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10);
        if (current) input.setValue(String(current));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    async _handleCcCostAlertModal(interaction) {
        const raw = interaction.fields.getTextInputValue('cc_cost_alert_value').trim().replace(',', '.');
        let threshold = null;
        if (raw !== '') {
            threshold = parseFloat(raw);
            if (isNaN(threshold) || threshold <= 0) {
                await interaction.reply({ content: '❌ Nieprawidłowa wartość progu (podaj liczbę > 0, np. 0.50).', flags: ['Ephemeral'] });
                return;
            }
        }
        await this.adminPanelService?.setCostAlertThreshold?.(threshold);
        this._ccAudit(interaction, threshold ? `🔔 Ustawiono alert kosztowy: $${threshold}/dzień` : '🔕 Wyłączono alert kosztowy');
        this.adminPanelService?.refresh();
        await interaction.reply({
            content: threshold
                ? `✅ Alert kosztowy ustawiony: ping przy dziennym koszcie ≥ **$${threshold}**.`
                : '✅ Alert kosztowy wyłączony.',
            flags: ['Ephemeral'],
        });
    }

    // ── CC: Globalny kill-switch OCR ─────────────────────────────────────────
    async _handleCcGlobalOcr(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const blocked = this.adminPanelService?.isGlobalOcrBlocked?.() === true;
        const target = blocked ? 'unblock' : 'block';
        const desc = blocked
            ? '▶️ Włączyć OCR globalnie? Wrócą ustawienia per-serwer.'
            : '🛑 Wyłączyć OCR **globalnie** (tryb serwisowy)?\n`/update` i `/test` przestaną działać na WSZYSTKICH serwerach (head admin ma nadal dostęp).';
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(blocked ? 0x57F287 : 0xED4245).setDescription(desc)],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`cc_global_ocr_ok_${target}`)
                    .setEmoji(blocked ? '▶️' : '🛑')
                    .setLabel(blocked ? 'Włącz globalnie' : 'Wyłącz globalnie')
                    .setStyle(blocked ? ButtonStyle.Success : ButtonStyle.Danger),
            )],
            flags: ['Ephemeral'],
        });
    }

    async _handleCcGlobalOcrConfirm(interaction, target) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const block = target === 'block';
        await this.adminPanelService?.setGlobalOcrBlocked?.(block);
        this._ccAudit(interaction, block ? '🛑 Wyłączono OCR globalnie (tryb serwisowy)' : '▶️ Włączono OCR globalnie');
        this.adminPanelService?.refresh();
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(block ? 0xED4245 : 0x57F287)
                .setDescription(block
                    ? '🛑 OCR został **wyłączony globalnie** — `/update` i `/test` zablokowane na wszystkich serwerach.'
                    : '▶️ OCR został **włączony globalnie** — obowiązują ustawienia per-serwer.')],
            components: [],
        });
    }

    async _handleCcActionTokens(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const month = new Date().toISOString().slice(0, 7);
        const isSuperUser = true; // head admin widzi wszystkie serwery
        const guildFilter = 'all';
        const reply = await this._buildTokensEmbed(interaction, month, guildFilter, isSuperUser, 0);
        await interaction.editReply(reply);
    }

    async _handleCcActionCmdUsage(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const t = this._panelT(interaction.guildId);
        const stats = await this.commandUsageService?.getGlobalStats() || [];
        const total = stats.reduce((sum, s) => sum + s.count, 0);
        const fmt = n => n.toLocaleString('pl-PL');
        const lines = stats.length > 0
            ? stats.map(s => `\`/${s.name.padEnd(12)}\` — **${fmt(s.count)}**`)
            : [t('Brak danych.', 'No data yet.')];
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('🔢 Użycia Komend — Globalnie', '🔢 Command Usage — Global'))
            .setDescription(lines.join('\n'))
            .setFooter({ text: t(`Łącznie: ${fmt(total)} wywołań`, `Total: ${fmt(total)} calls`) });
        await interaction.editReply({ embeds: [embed] });
    }

    async _handleCcActionOcrStats(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const embed = this._buildOcrStatsEmbed(interaction);
        const components = this._buildOcrStatsComponents(interaction);
        await interaction.editReply({ embeds: [embed], components });
    }

    // ─────────────────────────────────────────────────────────────────────────

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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('remove_query').trim());
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
                    if (playerMatchesQuery(p, query, interaction.client, sgid)) {
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
                label: `#${p.rank} ${formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 60)}`.slice(0, 100),
                description: isHeadAdmin
                    ? `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100)
                    : `${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.playerKey || p.userId}:${p.sgid}`,
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
        const [targetPlayerKey, targetGuildId] = value.split(':');
        const t = this._panelT(interaction.guildId);
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
        const displayName = formatProfileDisplayName(player?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
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
                new ButtonBuilder().setCustomId(`panel_remove_confirm_${targetPlayerKey}:${targetGuildId}`).setEmoji('✅').setLabel(t('Usuń', 'Remove')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`panel_remove_all_confirm_${targetPlayerKey}:${targetGuildId}`).setEmoji('🏆').setLabel(t('Usuń z osiągnięciami', 'Remove with Achievements')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    async _handlePanelRemoveConfirm(interaction, rawValue, { resetAllAchievements = false } = {}) {
        // rawValue: "playerKey:targetGuildId" (playerKey = profil gracza; serwer niekoniecznie bieżący)
        const [targetPlayerKey, targetGuildId] = rawValue.split(':');
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
            const playersBefore = await this.rankingService.getSortedPlayers(targetGuildId).catch(() => []);
            const playerRecord = playersBefore.find(p => (p.playerKey || p.userId) === targetPlayerKey);
            const playerName = formatProfileDisplayName(playerRecord?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
            const playerTimestamp = playerRecord?.timestamp || null;
            const wasRemoved = await this.rankingService.removePlayerFromRanking(targetPlayerKey, targetGuildId);
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
                        await this.achievementService.resetAllAchievements(targetGuildId, targetPlayerKey);
                    } else {
                        await this.achievementService.clearUserAchievements(targetGuildId, targetPlayerKey);
                    }
                }
                if (this.scoreHistoryService && playerTimestamp) {
                    this.scoreHistoryService.removeEntriesAfter(targetGuildId, targetPlayerKey, playerTimestamp)
                        .catch(e => logger.warn(`Błąd czyszczenia historii po usunięciu z rankingu: ${e.message}`));
                }
                if (this.bossRecordService) {
                    await this.bossRecordService.removeAllUserBossRecords(targetGuildId, targetPlayerKey)
                        .catch(e => logger.warn(`Błąd usuwania rekordów bossów po usunięciu z rankingu: ${e.message}`));
                }
                // Rekord już nie istnieje → przycisk „Cofnij wynik" pod ogłoszeniem traci ważność
                await this._invalidateUndoForPlayer(interaction.client, targetPlayerKey, targetGuildId,
                    interaction.member?.displayName || interaction.user.username).catch(() => {});
                const guildNameLog = targetGuild?.name || targetGuildId;
                await this.logService.logMessage('success', `Gracz ${playerName} usunięty z rankingu${resetAllAchievements ? ' (z wszystkimi osiągnięciami)' : ''} (serwer ${guildNameLog}) przez panel admina`, interaction);
            } catch (roleError) {
                logger.warn(`Błąd aktualizacji ról TOP po usunięciu (panel): ${roleError.message}`);
            }
            this._ccAudit(interaction, `🗑️ Usunięto gracza z rankingu: ${playerName}`);
            this.adminPanelService?.refresh();
            // Usunięcie mogło ruszyć czołówkę — odśwież ranking serwera na stronie
            this.webRankingSyncService?.syncGuild(targetGuildId, interaction.client).catch(() => {});
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle(t('✅ Gracz usunięty', '✅ Player Removed'))
                    .setDescription(t(
                        `Gracz <@${getOwnerId(targetPlayerKey)}> został usunięty z rankingu${serverNote}${resetAllAchievements ? ' wraz ze wszystkimi osiągnięciami' : ''}.`,
                        `Player <@${getOwnerId(targetPlayerKey)}> has been removed from the ranking${serverNote}${resetAllAchievements ? ' along with all achievements' : ''}.`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveConfirm (serwer "${interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId}", profil ${targetPlayerKey}):`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania gracza.', '❌ Error removing player.'), embeds: [], components: [] });
        }
    }

    // ─── Usuń wynik (pojedynczy wpis z historii) ─────────────────────────────
    async _handlePanelRemoveScore(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('panel_remove_score_search_modal')
            .setTitle(t('Usuń wynik', 'Remove Score'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('remove_score_query')
                .setLabel(t('Fragment nicku gracza', 'Part of the player\'s nick'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(t('np. Kowalski', 'e.g. Kowalski'))
                .setRequired(true).setMinLength(1).setMaxLength(50)
        ));
        await interaction.showModal(modal);
    }

    async _handlePanelRemoveScoreSearch(interaction) {
        const guildId = interaction.guildId;
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);
        const t = this._panelT(guildId);
        const query = normalizeForSearch(interaction.fields.getTextInputValue('remove_score_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const searchGuildIds = isHeadAdmin
                ? (this.guildConfigService?.getAllConfiguredGuildIds() || [guildId])
                : [guildId];
            const allMatches = [];
            for (const sgid of searchGuildIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if (playerMatchesQuery(p, query, interaction.client, sgid)) {
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
                        new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const options = allMatches.slice(0, 25).map(p => ({
                label: `#${p.rank} ${formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 60)}`.slice(0, 100),
                description: isHeadAdmin
                    ? `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100)
                    : `${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.playerKey || p.userId}:${p.sgid}`,
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
                        new StringSelectMenuBuilder().setCustomId('panel_remove_score_player')
                            .setPlaceholder(t('Wybierz gracza...', 'Select a player...'))
                            .addOptions(options)
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )
                ]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveScoreSearch (serwer "${interaction.guild?.name || guildId}"):`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania rankingu.', '❌ Error loading ranking.'), embeds: [], components: [] });
        }
    }

    async _handlePanelRemoveScorePlayer(interaction) {
        const [targetPlayerKey, targetGuildId] = interaction.values[0].split(':');
        await interaction.deferUpdate();
        await this._renderRemoveScorePage(interaction, targetPlayerKey, targetGuildId, 0);
    }

    async _handlePanelRemoveScorePage(interaction, rawValue) {
        // rawValue: userId:guildId:page
        const [targetPlayerKey, targetGuildId, pageStr] = rawValue.split(':');
        await interaction.deferUpdate();
        await this._renderRemoveScorePage(interaction, targetPlayerKey, targetGuildId, Number(pageStr) || 0);
    }

    // Renderuje stronę listy wyników gracza (25/stronę) z paginacją; edytuje bieżącą (ephemeral) wiadomość.
    async _renderRemoveScorePage(interaction, targetPlayerKey, targetGuildId, page) {
        const t = this._panelT(interaction.guildId);
        try {
            const entries = this.scoreHistoryService
                ? await this.scoreHistoryService.getAllUserEntries(targetGuildId, targetPlayerKey)
                : [];
            const players = await this.rankingService.getSortedPlayers(targetGuildId);
            const _dnPlayer = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
            const displayName = formatProfileDisplayName(_dnPlayer?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
            if (entries.length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF4444)
                        .setTitle(t('🗑️ Brak historii', '🗑️ No History'))
                        .setDescription(t(`Gracz **${displayName}** nie ma zapisanych wyników w historii.`, `Player **${displayName}** has no saved score history.`))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const PER_PAGE = 25;
            const totalPages = Math.ceil(entries.length / PER_PAGE);
            const safePage = Math.max(0, Math.min(page, totalPages - 1));
            const locale = (this.config.getGuildConfig(targetGuildId)?.lang === 'pol') ? 'pl-PL' : 'en-GB';
            const sortedDesc = entries.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const pageEntries = sortedDesc.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
            const options = pageEntries.map(e => {
                const tsMs = new Date(e.timestamp).getTime();
                const dateStr = new Date(e.timestamp).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
                return {
                    label: `${e.score}`.slice(0, 100),
                    description: `${dateStr}${e.bossName ? ' • ' + e.bossName : ''}`.slice(0, 100),
                    value: `${targetPlayerKey}:${targetGuildId}:${tsMs}`,
                };
            });
            const components = [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_remove_score_entry')
                        .setPlaceholder(t('Wybierz wynik...', 'Select a score...'))
                        .addOptions(options)
                ),
            ];
            if (totalPages > 1) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`panel_remove_score_page_${targetPlayerKey}:${targetGuildId}:${safePage - 1}`).setEmoji('◀️').setLabel(t('Poprzednia', 'Previous')).setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
                    new ButtonBuilder().setCustomId('panel_remove_score_page_noop').setLabel(`${safePage + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`panel_remove_score_page_${targetPlayerKey}:${targetGuildId}:${safePage + 1}`).setEmoji('▶️').setLabel(t('Następna', 'Next')).setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
                ));
            }
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
            ));
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🗑️ Wybierz wynik do usunięcia', '🗑️ Select Score to Remove'))
                    .setDescription(t(
                        `Gracz: **${displayName}** — ${entries.length} wpis(ów). Strona ${safePage + 1}/${totalPages}.`,
                        `Player: **${displayName}** — ${entries.length} entr(ies). Page ${safePage + 1}/${totalPages}.`
                    ))],
                components,
            });
        } catch (err) {
            logger.error(`Błąd _renderRemoveScorePage:`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania historii.', '❌ Error loading history.'), embeds: [], components: [] });
        }
    }

    async _handlePanelRemoveScoreEntry(interaction) {
        const t = this._panelT(interaction.guildId);
        const [targetPlayerKey, targetGuildId, tsMs] = interaction.values[0].split(':');
        await interaction.deferUpdate();
        try {
            const entries = this.scoreHistoryService ? await this.scoreHistoryService.getAllUserEntries(targetGuildId, targetPlayerKey) : [];
            const entry = entries.find(e => String(new Date(e.timestamp).getTime()) === tsMs);
            const players = await this.rankingService.getSortedPlayers(targetGuildId);
            const _dnPlayer = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
            const displayName = formatProfileDisplayName(_dnPlayer?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';
            if (!entry) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle(t('🗑️ Wpis nieaktualny', '🗑️ Entry Outdated')).setDescription(t('Ten wpis już nie istnieje. Spróbuj ponownie.', 'This entry no longer exists. Try again.'))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🔍').setLabel(t('Szukaj ponownie', 'Search Again')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                    )]
                });
                return;
            }
            const dateStr = new Date(entry.timestamp).toLocaleString((this.config.getGuildConfig(targetGuildId)?.lang === 'pol') ? 'pl-PL' : 'en-GB');
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('🗑️ Potwierdzenie usunięcia wyniku', '🗑️ Confirm Score Removal'))
                    .setDescription(t(
                        `Gracz: **${displayName}**${serverNote}\nWynik: **${entry.score}**\nData: ${dateStr}${entry.bossName ? `\nBoss: ${entry.bossName}` : ''}\n\nUsunąć ten wpis z historii? Jeśli to aktualny rekord gracza, ranking zostanie przeliczony do następnego najlepszego wyniku.`,
                        `Player: **${displayName}**${serverNote}\nScore: **${entry.score}**\nDate: ${dateStr}${entry.bossName ? `\nBoss: ${entry.bossName}` : ''}\n\nRemove this entry from history? If it's the player's current record, the ranking will be recalculated to the next best score.`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`panel_remove_score_confirm_${targetPlayerKey}:${targetGuildId}:${tsMs}`).setEmoji('✅').setLabel(t('Usuń wynik', 'Remove Score')).setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveScoreEntry:`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania wpisu.', '❌ Error loading entry.'), embeds: [], components: [] });
        }
    }

    async _handlePanelRemoveScoreConfirm(interaction, rawValue) {
        // rawValue: userId:guildId:tsMs
        const [targetPlayerKey, targetGuildId, tsMsStr] = rawValue.split(':');
        const tsMs = Number(tsMsStr);
        const t = this._panelT(interaction.guildId);
        await interaction.deferUpdate();
        try {
            const rankingBefore = await this.rankingService.loadRanking(targetGuildId);
            const oldRecord = rankingBefore[targetPlayerKey] || null;
            const oldUsername = formatProfileDisplayName(oldRecord?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));

            const removed = this.scoreHistoryService
                ? await this.scoreHistoryService.removeEntryByTimestamp(targetGuildId, targetPlayerKey, tsMs)
                : null;

            // ⚔️ Wyzwania — ten sam wynik przestaje liczyć się w wyzwaniach w toku
            if (removed && this.challengeService) {
                await this.challengeService.removeScore(targetPlayerKey, removed.timestamp)
                    .catch(e => logger.warn(`⚠️ Błąd wypisywania wyniku z wyzwań: ${e.message}`));
            }

            if (!removed) {
                const { embed, components } = this._buildAdminPanel(interaction);
                embed.setDescription(t('⚠️ Wpis nie istnieje (mógł zostać już usunięty).\n\n', '⚠️ Entry not found (may have been removed already).\n\n') + (embed.data.description || ''));
                await interaction.editReply({ embeds: [embed], components });
                return;
            }

            // Czy usunięty wpis był aktualnym rekordem? → przelicz ranking z pozostałej historii
            let rankingChanged = false;
            let newRecordInfo = null;
            let removedAchievements = [];
            const removedVal = typeof removed.scoreValue === 'number' ? removed.scoreValue : this.rankingService.parseScoreValue(removed.score);
            if (oldRecord && removedVal >= this.rankingService.parseScoreValue(oldRecord.score)) {
                const remaining = await this.scoreHistoryService.getAllUserEntries(targetGuildId, targetPlayerKey);
                let best = null;
                for (const e of remaining) {
                    const v = typeof e.scoreValue === 'number' ? e.scoreValue : this.rankingService.parseScoreValue(e.score);
                    if (!best || v > best._v || (v === best._v && new Date(e.timestamp) > new Date(best.timestamp))) {
                        best = { ...e, _v: v };
                    }
                }

                // Osiągnięcia przypisane do TEGO wyniku — kasujemy tylko gdy usuwany wpis jest
                // ostatnim (najnowszym) w historii. Wtedy „odblokowane od jego momentu" = dokładnie
                // te nadane przy jego zapisie; przy starszym wpisie cięcie po czasie zabrałoby
                // osiągnięcia za późniejsze, legalne wyniki. Kategoria explorer zostaje nietknięta.
                const removedTs = new Date(removed.timestamp).getTime();
                const isLatestEntry = remaining.every(e => new Date(e.timestamp).getTime() <= removedTs);
                if (this.achievementService && removed.timestamp && isLatestEntry) {
                    try {
                        removedAchievements = await this.achievementService.clearRecordAchievementsAfter(
                            targetGuildId, targetPlayerKey, removed.timestamp,
                            { removedRecordCount: 1, previousRecord: best ? { timestamp: best.timestamp } : null }
                        );
                    } catch (achErr) {
                        logger.warn(`Błąd cofania osiągnięć po usunięciu wyniku: ${achErr.message}`);
                    }
                }
                if (!best) {
                    await this.rankingService.revertUserRecord(targetGuildId, targetPlayerKey, null);
                } else {
                    await this.rankingService.revertUserRecord(targetGuildId, targetPlayerKey, {
                        score: best.score,
                        scoreValue: best._v,
                        timestamp: best.timestamp,
                        username: oldUsername,
                        bossName: best.bossName || null,
                        userId: getOwnerId(targetPlayerKey),
                        playerKey: targetPlayerKey,
                    });
                    newRecordInfo = best.score;
                }
                rankingChanged = true;
                try {
                    const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
                    if (targetGuild) {
                        const guildConfig = this.config.getGuildConfig(targetGuildId);
                        const updatedPlayers = await this.rankingService.getSortedPlayers(targetGuildId);
                        await this.roleService.updateTopRoles(targetGuild, updatedPlayers, guildConfig?.topRoles || null);
                    }
                } catch (roleErr) {
                    logger.warn(`Błąd aktualizacji ról TOP po usunięciu wyniku: ${roleErr.message}`);
                }
            }

            // Cofnij rekord bossa, jeśli usuwany wpis był aktualnym rekordem tego bossa → przelicz z pozostałej historii bossa
            let bossRecordReverted = false;
            let newBossRecordInfo = null;
            if (this.bossRecordService && removed.bossName) {
                try {
                    const userBoss = await this.bossRecordService.getUserBossRecords(targetGuildId, targetPlayerKey);
                    const currentBossRec = userBoss?.[removed.bossName] || null;
                    const currentBossVal = currentBossRec && typeof currentBossRec.scoreValue === 'number' ? currentBossRec.scoreValue : null;
                    if (currentBossRec && currentBossVal === removedVal) {
                        const remainingBoss = await this.scoreHistoryService.getAllUserEntries(targetGuildId, targetPlayerKey);
                        let bestBoss = null;
                        for (const e of remainingBoss) {
                            if (e.bossName !== removed.bossName) continue;
                            const v = typeof e.scoreValue === 'number' ? e.scoreValue : this.rankingService.parseScoreValue(e.score);
                            if (!bestBoss || v > bestBoss._v || (v === bestBoss._v && new Date(e.timestamp) > new Date(bestBoss.timestamp))) {
                                bestBoss = { ...e, _v: v };
                            }
                        }
                        if (!bestBoss) {
                            await this.bossRecordService.revertBossRecord(targetGuildId, targetPlayerKey, removed.bossName, null);
                        } else {
                            await this.bossRecordService.revertBossRecord(targetGuildId, targetPlayerKey, removed.bossName, {
                                score: bestBoss.score, scoreValue: bestBoss._v, timestamp: bestBoss.timestamp, username: oldUsername,
                            });
                            newBossRecordInfo = bestBoss.score;
                        }
                        bossRecordReverted = true;
                    }
                } catch (bossErr) {
                    logger.warn(`Błąd cofania rekordu bossa po usunięciu wyniku: ${bossErr.message}`);
                }
            }

            // Usunięty wpis mógł być rekordem, którego dotyczy przycisk „Cofnij wynik" — unieważnij go
            await this._invalidateUndoForPlayer(interaction.client, targetPlayerKey, targetGuildId,
                interaction.member?.displayName || interaction.user.username).catch(() => {});
            this._ccAudit(interaction, `🧹 Usunięto wynik ${removed?.score || ''} gracza ${oldUsername}`);
            this.adminPanelService?.refresh();
            this.webRankingSyncService?.syncGuild(targetGuildId, interaction.client).catch(() => {});
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';
            let desc = t(
                `Usunięto wynik **${removed.score}** gracza **${oldUsername}**${serverNote} z historii.`,
                `Removed score **${removed.score}** of player **${oldUsername}**${serverNote} from history.`
            );
            if (rankingChanged) {
                desc += newRecordInfo
                    ? t(`\nRanking przeliczony — nowy rekord: **${newRecordInfo}**.`, `\nRanking recalculated — new record: **${newRecordInfo}**.`)
                    : t(`\nBrak innych wyników — gracz usunięty z rankingu.`, `\nNo other scores — player removed from the ranking.`);
            }
            if (bossRecordReverted) {
                desc += newBossRecordInfo
                    ? t(`\nRekord bossa \`${removed.bossName}\` cofnięty do: **${newBossRecordInfo}**.`, `\nBoss record \`${removed.bossName}\` reverted to: **${newBossRecordInfo}**.`)
                    : t(`\nRekord bossa \`${removed.bossName}\` usunięty (brak innych wyników na tym bossie).`, `\nBoss record \`${removed.bossName}\` removed (no other scores on this boss).`);
            }
            if (removedAchievements.length > 0) {
                const isPolDesc = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
                const achNames = this.achievementService.getAchievementDefs(removedAchievements)
                    .map(a => `${a.icon} ${isPolDesc ? a.namePol : a.nameEng}`);
                desc += t(
                    `\nCofnięto osiągnięcia zdobyte za ten wynik (**${removedAchievements.length}**): ${achNames.join(', ')}`,
                    `\nAchievements earned for this score reverted (**${removedAchievements.length}**): ${achNames.join(', ')}`
                );
            }
            await this.logService.logMessage('success', `Usunięto wynik ${removed.score} gracza ${oldUsername} z historii (serwer ${guildName || targetGuildId})${rankingChanged ? ', ranking przeliczony' : ''}${bossRecordReverted ? ', rekord bossa cofnięty' : ''}${removedAchievements.length ? `, cofnięto ${removedAchievements.length} osiągnięć` : ''} przez panel admina`, interaction);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(t('✅ Wynik usunięty', '✅ Score Removed')).setDescription(desc)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelRemoveScoreConfirm:`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania wyniku.', '❌ Error removing score.'), embeds: [], components: [] });
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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('unblock_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });
        const blocked = await this.userBlockService.getBlockedUsers();
        const scopedBlocked = isHeadAdmin ? blocked : blocked.filter(e => e.guildId === guildId);
        const filtered = scopedBlocked.filter(e => normalizeForSearch(e.username).includes(query));
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

    async _handlePanelCmdUsage(interaction) {
        await interaction.deferUpdate();
        const t = this._panelT(interaction.guildId);
        const isHeadAdmin = this._isHeadAdmin(interaction.user.id);

        let stats;
        let title;
        if (isHeadAdmin) {
            stats = await this.commandUsageService?.getGlobalStats() || [];
            title = t('🔢 Użycia Komend — Globalnie', '🔢 Command Usage — Global');
        } else {
            stats = await this.commandUsageService?.getGuildStats(interaction.guildId) || [];
            const guildName = interaction.guild?.name || interaction.guildId;
            title = t(`🔢 Użycia Komend — ${guildName}`, `🔢 Command Usage — ${guildName}`);
        }

        const total = stats.reduce((sum, s) => sum + s.count, 0);
        const fmt = n => n.toLocaleString('pl-PL');
        const padLeft = (str, len) => str.toString().padStart(len, ' ');

        const lines = stats.length > 0
            ? stats.map(s => `\`/${s.name.padEnd(12)}\` — **${fmt(s.count)}**`)
            : [t('Brak danych.', 'No data yet.')];

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(title)
            .setDescription(lines.join('\n'))
            .setFooter({ text: t(`Łącznie: ${fmt(total)} wywołań`, `Total: ${fmt(total)} calls`) });

        const backBtn = new ButtonBuilder()
            .setCustomId('panel_cat_stats')
            .setEmoji('◀️')
            .setLabel(t('Wróć', 'Back'))
            .setStyle(ButtonStyle.Secondary);

        await interaction.editReply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(backBtn)],
        });
    }

    async _handlePanelProcessRoles(interaction, targetGuildId = interaction.guildId) {
        const t = this._panelT(interaction.guildId);
        const guildId = targetGuildId;
        // Panel stoi na jednym serwerze, a role przelicza się na wybranym — wszystkie
        // operacje muszą iść na obiekt WYBRANEGO serwera, nie tego, z którego kliknięto.
        const targetGuild = guildId === interaction.guildId
            ? interaction.guild
            : interaction.client.guilds.cache.get(guildId);

        if (!targetGuild) {
            const payload = {
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle(t('❌ Serwer niedostępny', '❌ Server unavailable'))
                    .setDescription(t('Bota nie ma już na tym serwerze albo nie ma go w cache.', 'The bot is no longer on that server, or it is not cached.'))],
                components: [],
            };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
            else await interaction.update(payload);
            return;
        }
        const guildConfig = this.config.getGuildConfig(guildId);
        const topRoles = guildConfig?.topRoles || null;

        if (!topRoles || Object.keys(topRoles).length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF6B35)
                    .setTitle(t('⚠️ Brak konfiguracji ról TOP', '⚠️ No TOP Role Configuration'))
                    .setDescription(t(
                        'Na tym serwerze nie skonfigurowano ról TOP. Skonfiguruj je przez `/configure` → Krok 5.',
                        'This server has no TOP roles configured. Configure them via `/configure` → Step 5.'
                    ))
                ],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót', 'Back')).setStyle(ButtonStyle.Secondary)
                )]
            });
            return;
        }

        await interaction.deferUpdate();
        const gl = this.logService._gl(guildId);
        const nick = interaction.member?.displayName || interaction.user.username;
        gl.info(`🔁 ${this.logService.nickLink(nick, interaction.user.id)} uruchamia "Przetwórz role TOP" na serwerze "${targetGuild.name}"`);

        try {
            const result = await this.roleService.updateTopRoles(targetGuild, null, topRoles, { fullFetch: true });
            const stats = (result && typeof result === 'object') ? result : { added: [], removed: [] };
            gl.success(`✅ Przetworzono role TOP na "${targetGuild.name}": +${stats.added.length} / -${stats.removed.length}`);

            const MAX_LINES = 20;
            const formatLines = (entries) => {
                if (entries.length === 0) return null;
                const lines = entries.slice(0, MAX_LINES).map(e => `**${e.name}** — ${e.roleName}`);
                if (entries.length > MAX_LINES) lines.push(t(`... i ${entries.length - MAX_LINES} więcej`, `... and ${entries.length - MAX_LINES} more`));
                return lines.join('\n');
            };

            const embed = new EmbedBuilder().setColor(0x00C851);
            if (stats.added.length === 0 && stats.removed.length === 0) {
                embed.setTitle(t('✅ Role TOP — wszystko OK', '✅ TOP Roles — All Good'));
                embed.setDescription(t('Żadna rola nie wymagała zmiany. Role TOP są zgodne z aktualnym rankingiem.', 'No role changes were needed. TOP roles are in sync with the current ranking.'));
            } else {
                embed.setTitle(t('✅ Role TOP zaktualizowane', '✅ TOP Roles Updated'));
                const addedText = formatLines(stats.added);
                const removedText = formatLines(stats.removed);
                if (addedText) embed.addFields({ name: t(`🏆 Przyznano (${stats.added.length})`, `🏆 Assigned (${stats.added.length})`), value: addedText });
                if (removedText) embed.addFields({ name: t(`🗑️ Usunięto (${stats.removed.length})`, `🗑️ Removed (${stats.removed.length})`), value: removedText });
            }

            await interaction.editReply({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            gl.error(`❌ Błąd przetwarzania ról TOP: ${err.message}`);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle(t('❌ Błąd', '❌ Error'))
                    .setDescription(t(`Błąd podczas przetwarzania ról: \`${err.message}\``, `Error processing roles: \`${err.message}\``))
                ],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        }
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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('block_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const allMatches = [];
            for (const sgid of configuredIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if (playerMatchesQuery(p, query, interaction.client, sgid)) {
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
                label: `#${p.rank} ${formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 60)}`.slice(0, 100),
                description: `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.playerKey || p.userId}:${p.sgid}`,
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
        const value = interaction.values[0]; // playerKey:guildId
        const [selectedPlayerKey, targetGuildId] = value.split(':');
        // Blokada dotyczy OSOBY (wszystkich jej profili), więc z klucza bierzemy właściciela
        const targetUserId = getOwnerId(selectedPlayerKey);
        const t = this._panelT(interaction.guildId);
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => (p.playerKey || p.userId) === selectedPlayerKey);
        const displayName = formatProfileDisplayName(player?.username || targetUserId, getProfileIndex(selectedPlayerKey));
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
                .setLabel(t('Czas blokady (30m, 2h, 7d, 2w)', 'Duration (30m, 2h, 7d, 2w)'))
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
            // (blokada obejmuje wszystkie profile gracza — identyfikujemy po userId)
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
            const blockedUntil = await this.userBlockService.blockUser(
                targetUserId, username, targetGuildId, guildName, durationStr,
                true // blockedByHeadAdmin
            );
            const timeLabel = blockedUntil
                ? this.userBlockService.formatTimeRemaining(blockedUntil, { permanent: t('∞ Permanentnie', '∞ Permanent'), expired: t('Wygasła', 'Expired') })
                : t('∞ Permanentnie', '∞ Permanent');
            logger.info(`🔒 Head Admin zablokował ${username} (${targetUserId}) na serwerze ${guildName} — ${timeLabel}`);
            this._announceUserBlock(interaction.client, targetUserId, blockedUntil, interaction.member?.displayName || interaction.user.username);
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

    /**
     * Ogłasza CZASOWĄ blokadę gracza nałożoną przez admina — systemowa wiadomość na kanale bota
     * serwera, na którym gracz ma swój najlepszy (globalny) wynik. Fire-and-forget.
     * Blokady permanentne (blockedUntil === null) i automatyczne (CV) nie są ogłaszane.
     * @param {Client} client
     * @param {string} targetUserId - ID zablokowanego gracza
     * @param {number|null} blockedUntil - timestamp końca blokady (null = permanentna)
     * @param {string} adminName - nick administratora nakładającego blokadę
     */
    async _announceUserBlock(client, targetUserId, blockedUntil, adminName) {
        try {
            if (!blockedUntil) return; // permanentna — bez ogłoszenia
            const globalRanking = await this.rankingService.getGlobalRanking();
            const entry = globalRanking.find(p => p.userId === targetUserId);
            if (!entry?.sourceGuildId) return; // gracz nie ma wyniku w żadnym rankingu
            const channelId = this.guildConfigService?.getConfig(entry.sourceGuildId)?.allowedChannelId;
            if (!channelId) return;
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;
            const msgs = this.msgs(entry.sourceGuildId);
            const duration = this.userBlockService.formatTimeRemaining(blockedUntil);
            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(msgs.userBlockAnnouncementTitle)
                .setDescription(msgs.userBlockAnnouncement
                    .replace('{userMention}', `<@${targetUserId}>`)
                    .replace('{duration}', duration)
                    .replace('{adminName}', adminName))
                .setTimestamp();
            await channel.send({ embeds: [embed] });
            this.logService._gl(entry.sourceGuildId).info(`🔒 Ogłoszono blokadę gracza ${this.logService.nickLink(entry.username || targetUserId, targetUserId)} (${duration}, przez ${adminName})`);
        } catch (err) {
            logger.warn(`⚠️ Nie udało się ogłosić blokady gracza ${targetUserId}: ${err.message}`);
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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('ocr_query').trim());
        await interaction.deferUpdate();
        const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
        const matches = [];
        for (const guildId of configuredIds) {
            const guild = interaction.client.guilds.cache.get(guildId);
            const guildName = guild?.name || this.guildConfigService.getConfig(guildId)?.guildName || guildId;
            if (!normalizeForSearch(guildName).includes(query)) continue;
            const updateBlocked = this.ocrBlockService.isBlocked(guildId, 'update');
            const testBlocked = this.ocrBlockService.isBlocked(guildId, 'test');
            matches.push({ guildId, guildName, updateBlocked, testBlocked });
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
            await this._maybeAnnounceNewServer(interaction.client, targetGuildId, targetCommands);
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
                if (this.config.adminGuildId && guildId === this.config.adminGuildId) {
                    const selectRows = this.rankingService.createServerSelectButtons(interaction.client, msgs, guildId, 0);
                    await interaction.editReply({ content: msgs.rankingSelectPrompt, embeds: [], components: selectRows });
                    return;
                }
                await interaction.editReply({ content: msgs.rankingEmpty });
                return;
            }

            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);

            // Statystyki wywołującego
            let callerStats = null;
            try {
                const callerUserId = interaction.user.id;
                const globalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
                const globalIdx = this._findCallerIndex(globalRanking, callerUserId);
                const serverIdx = this._findCallerIndex(players, callerUserId);
                callerStats = {
                    score: globalIdx !== -1 ? globalRanking[globalIdx].score : null,
                    serverPosition: serverIdx !== -1 ? serverIdx + 1 : null,
                    globalPosition: globalIdx !== -1 ? globalIdx + 1 : null,
                    rolePositions: [],
                    noScoreNote: globalIdx === -1 ? this._mainProfileNoScoreNote(callerUserId, msgs) : null
                };
                if (this.roleRankingConfigService) {
                    const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
                    const memberRoles = interaction.member?.roles?.cache;
                    if (roleRankings.length > 0 && memberRoles) {
                        for (const rr of roleRankings) {
                            if (!memberRoles.has(rr.roleId)) continue;
                            const rolePlayers = await this.rankingService.getSortedPlayersByRole(guildId, rr.roleId, guild, this.roleRankingConfigService);
                            const roleIdx = this._findCallerIndex(rolePlayers, callerUserId);
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

            const callerIdx = this._findCallerIndex(players, interaction.user.id);
            const userPage = callerIdx !== -1 ? Math.floor(callerIdx / this.config.ranking.playersPerPage) : null;

            const embed = await this.rankingService.createRankingEmbed(
                players, 0, totalPages, interaction.user.id, guild,
                { mode: 'server', client: null, messages: msgs, callerStats, callerPlayerKey: this._mainPlayerKey(interaction.user.id) }
            );
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, roleRows, {
                userPage, mode: 'server', guildId, guildName: guild?.name || null
            });

            // Wykres historii rekordów wywołującego (dołączany do tej samej wiadomości)
            let scoreHistoryAttachment = null;
            if (this.scoreHistoryService && this.chartService) {
                try {
                    const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [guildId];
                    const callerHistory = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIds, this.profileRegistryService?.getMainPlayerKey(interaction.user.id) || interaction.user.id, 365);
                    if (callerHistory.length >= 2) {
                        const chartTitle = msgs.chartTitle;
                        const callerUsername = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                        const guildTagMap = {};
                        const guildNameMap = {};
                        for (const g of (this.guildConfigService?.getAllConfiguredGuilds() || [])) {
                            const discordName = interaction.client.guilds.cache.get(g.id)?.name;
                            guildTagMap[g.id] = g.tag || discordName?.slice(0, 14) || g.id.slice(-4);
                            guildNameMap[g.id] = discordName || g.tag || g.id.slice(-4);
                        }
                        const chartBuffer = await this.chartService.generateScoreHistoryChart(callerHistory, callerUsername, chartTitle, guildTagMap, guildNameMap, this._chartLang(guildId));
                        if (chartBuffer) {
                            scoreHistoryAttachment = new AttachmentBuilder(chartBuffer, { name: 'score_history.png' });
                        }
                    }
                } catch (chartErr) {
                    logger.warn('Błąd generowania wykresu historii wyników:', chartErr);
                }
            }

            const replyEmbeds = [embed];
            if (scoreHistoryAttachment) {
                replyEmbeds.push(new EmbedBuilder().setImage('attachment://score_history.png'));
            }
            const replyOptions = { embeds: replyEmbeds, components: buttons };
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
    async _computeRolePositions(guildId, playerKey, guild, memberRoles) {
        if (!this.roleRankingConfigService || !memberRoles || !guild) return [];
        const ownerId = getOwnerId(playerKey);
        try {
            const roleRankings = await this.roleRankingConfigService.loadRoleRankings(guildId);
            const result = [];
            for (const rr of roleRankings) {
                if (!memberRoles.has(rr.roleId)) continue;
                const rolePlayers = await this.rankingService.getSortedPlayersByRole(guildId, rr.roleId, guild, this.roleRankingConfigService);
                // Pozycja dotyczy PROFILU (ranking ról zawiera wszystkie profile członków roli)
                const idx = rolePlayers.findIndex(p => (p.playerKey || p.userId) === playerKey);
                if (idx !== -1) result.push({ roleName: rr.roleName, position: idx + 1 });
            }
            return result;
        } catch (err) {
            logger.warn(`Błąd pobierania pozycji ról dla użytkownika "${guild?.members?.cache?.get(ownerId)?.displayName || playerKey}": ${err.message}`);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  COFANIE REKORDU (przycisk gracza pod ogłoszeniem + przycisk admina w logu)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Komponenty pod publicznym ogłoszeniem rekordu: opcjonalne „⚠️ Zgłoś" (weryfikacja
     * społeczności) + „↩️ Cofnij wynik" dla właściciela wyniku.
     * @param {string} publicMsgId
     * @param {boolean} cvEnabled
     * @param {Object} msgs - komunikaty serwera (dwujęzyczne)
     * @returns {ActionRowBuilder[]}
     */
    _buildRecordAnnouncementRows(publicMsgId, cvEnabled, msgs) {
        const row = new ActionRowBuilder();
        if (cvEnabled) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`cv_vote_${publicMsgId}`)
                    .setLabel(msgs.cvVoteButton)
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`rec_undo_${publicMsgId}`)
                .setLabel(msgs.recordUndoButton)
                .setStyle(ButtonStyle.Secondary)
        );
        return [row];
    }

    /**
     * Czy sesja cofnięcia jest już zamknięta (rekord cofnięty w którykolwiek sposób).
     * @param {string} status
     */
    _isSessionReverted(status) {
        return status === 'owner' || status === 'admin' || status === 'profile_deleted';
    }

    /**
     * Komponenty ogłoszenia po cofnięciu wyniku: jeden nieaktywny CZERWONY przycisk
     * informujący DLACZEGO rekord zniknął.
     * @param {'owner'|'admin'|'profile_deleted'} by
     */
    _buildRevertedRows(by, msgs) {
        const label = by === 'owner'
            ? msgs.recordUndoByOwner
            : by === 'profile_deleted'
                ? msgs.recordUndoProfileDeleted
                : msgs.recordUndoByAdmin;
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`rec_undone_${by}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
        )];
    }

    /**
     * Rejestruje opublikowane ogłoszenie rekordu jako sesję cofnięcia i podpina przyciski.
     * Poprzednie ogłoszenie tego profilu traci możliwość cofnięcia — cofnąć można
     * WYŁĄCZNIE ostatni rekord, więc jego przycisk jest dezaktywowany.
     *
     * @returns {Promise<Object|null>} utworzona sesja
     */
    async _registerRecordAnnouncement(interaction, publicMsg, data) {
        if (!this.recordRevertService || !publicMsg) return null;
        const msgs = this.msgs(data.guildId);
        try {
            const { session, previous } = await this.recordRevertService.register({
                publicMsgId: publicMsg.id,
                publicChannelId: publicMsg.channelId,
                guildId: data.guildId,
                playerKey: data.playerKey,
                userId: getOwnerId(data.playerKey),
                previousRecord: data.previousRecord ?? null,
                newRecord: data.newRecord ?? null,
                previousBossRecord: data.previousBossRecord ?? null,
                bossName: data.bossName ?? null,
                skipGlobalRevert: data.skipGlobalRevert === true,
            });

            // Przyciski pod nowym ogłoszeniem
            await publicMsg.edit({
                // cvEnabled bywa przekazane jako wartość prawdziwościowa (np. instancja serwisu),
                // dlatego świadomie sprawdzamy truthy, a nie === true
                components: this._buildRecordAnnouncementRows(publicMsg.id, !!data.cvEnabled, msgs),
            }).catch(() => {});

            // Stare ogłoszenie: przycisk cofnięcia przestaje działać
            if (previous) await this._disablePreviousUndoButton(interaction.client, previous);
            return session;
        } catch (err) {
            this.logService._gl(data.guildId).warn(`⚠️ Nie udało się zarejestrować sesji cofnięcia: ${err.message}`);
            return null;
        }
    }

    /** Dezaktywuje przycisk cofnięcia pod poprzednim (już nieaktualnym) ogłoszeniem. */
    async _disablePreviousUndoButton(client, session) {
        if (!session?.publicMsgId || !session?.publicChannelId) return;
        const msgs = this.msgs(session.guildId);
        try {
            const chan = client.channels.cache.get(session.publicChannelId)
                || await client.channels.fetch(session.publicChannelId).catch(() => null);
            if (!chan) return;
            const msg = await chan.messages.fetch(session.publicMsgId).catch(() => null);
            if (!msg) return;
            // Zachowujemy istniejące przyciski (np. „Zgłoś"), wyłączamy tylko cofnięcie
            const rows = [];
            for (const row of msg.components || []) {
                const rebuilt = new ActionRowBuilder();
                for (const comp of row.components || []) {
                    const btn = ButtonBuilder.from(comp);
                    if (comp.customId?.startsWith('rec_undo_')) {
                        btn.setDisabled(true).setStyle(ButtonStyle.Secondary).setLabel(msgs.recordUndoButton);
                    }
                    rebuilt.addComponents(btn);
                }
                if (rebuilt.components.length > 0) rows.push(rebuilt);
            }
            if (rows.length > 0) await msg.edit({ components: rows }).catch(() => {});
        } catch { /* stare ogłoszenie mogło zostać usunięte */ }
    }

    /**
     * Po cofnięciu rekordu synchronizuje OBA miejsca:
     * - publiczne ogłoszenie → nieaktywny czerwony przycisk + notka
     * - embed w kanale logów OCR (przycisk admina) → nieaktywny czerwony przycisk
     * Pomija wiadomość, na której admin/gracz właśnie kliknął (`skipMessageId`) — tę
     * aktualizuje sama obsługa interakcji.
     *
     * @param {'owner'|'admin'} by
     */
    async _applyRevertVisuals(client, session, by, actorName, { skipMessageId = null, publicNote = null } = {}) {
        const msgs = this.msgs(session.guildId);
        const revertedRows = this._buildRevertedRows(by, msgs);

        // 1) Publiczne ogłoszenie
        if (session.publicMsgId && session.publicChannelId && session.publicMsgId !== skipMessageId) {
            try {
                const chan = client.channels.cache.get(session.publicChannelId)
                    || await client.channels.fetch(session.publicChannelId).catch(() => null);
                const msg = chan ? await chan.messages.fetch(session.publicMsgId).catch(() => null) : null;
                if (msg) {
                    const payload = { components: revertedRows };
                    if (publicNote) {
                        const existing = msg.content ? `${msg.content}\n` : '';
                        payload.content = `${existing}${publicNote}`;
                    }
                    await msg.edit(payload).catch(() => {});
                }
            } catch { /* ogłoszenie mogło zostać usunięte */ }
        }

        // 2) Embed w kanale logów OCR (przycisk admina)
        if (session.adminMsgId && session.adminChannelId && session.adminMsgId !== skipMessageId) {
            try {
                const chan = client.channels.cache.get(session.adminChannelId)
                    || await client.channels.fetch(session.adminChannelId).catch(() => null);
                const msg = chan ? await chan.messages.fetch(session.adminMsgId).catch(() => null) : null;
                if (msg) {
                    const embeds = msg.embeds?.length
                        ? [EmbedBuilder.from(msg.embeds[0]).addFields(
                            by === 'profile_deleted'
                                ? {
                                    name: '🗑️ Profil usunięty',
                                    value: `właściciel usunął profil${actorName ? ` **${actorName}**` : ''} — wynik zniknął razem z nim`,
                                    inline: false,
                                }
                                : {
                                    name: '↩️ Cofnięto',
                                    value: by === 'owner'
                                        ? `przez **właściciela wyniku**${actorName ? ` (${actorName})` : ''}`
                                        : `przez **${actorName || 'administratora'}**`,
                                    inline: false,
                                }
                        )]
                        : msg.embeds;
                    await msg.edit({ embeds, components: revertedRows }).catch(() => {});
                }
            } catch { /* embed mógł zostać usunięty */ }
        }

        // 3) Raport odrzuconego screena z panelu „Analizuj"
        await this._disableAnalyzeRevertFor(client, session.publicMsgId, skipMessageId).catch(() => {});
    }

    /**
     * Wygasza przycisk `ee_analyze_revert_*` pod raportem odrzuconego screena, gdy ten sam
     * rekord cofnięto INNĄ drogą (przycisk gracza pod ogłoszeniem albo przycisk admina
     * w kanale logów OCR).
     *
     * Analiza z panelu tworzy dla jednego rekordu DWA niezależne przyciski cofnięcia,
     * oparte na osobnych mechanizmach sesji: `ocr_revert_*`/`rec_undo_*` (persystentny
     * `recordRevertService`) i `ee_analyze_revert_*` (`_analyzeRevertSessions` w RAM).
     * Bez tego kroku cofnięcie jedną drogą zostawiało drugi przycisk aktywnym, a jego
     * kliknięcie próbowało cofnąć już cofnięty wynik.
     *
     * Sesje analizy kluczowane są ID raportu, więc szukamy po `publicMsgId`.
     */
    async _disableAnalyzeRevertFor(client, publicMsgId, skipMessageId = null) {
        if (!publicMsgId || !client || !this.config.rejectedChannelId) return;
        for (const [globalMsgId, s] of [...this._analyzeRevertSessions]) {
            if (s?.publicMsgId !== publicMsgId) continue;
            // Sesja przestaje być ważna niezależnie od tego, czy uda się odświeżyć wiadomość
            this._analyzeRevertSessions.delete(globalMsgId);
            if (globalMsgId === skipMessageId) continue;
            try {
                const chan = client.channels.cache.get(this.config.rejectedChannelId)
                    || await client.channels.fetch(this.config.rejectedChannelId).catch(() => null);
                const msg = chan ? await chan.messages.fetch(globalMsgId).catch(() => null) : null;
                await this._disableButtonsByPrefix(msg, 'ee_analyze_revert_');
            } catch { /* raport mógł zostać usunięty */ }
        }
    }

    /**
     * Zwraca przycisk „↩️ Cofnij wynik" dla danego ogłoszenia albo null, gdy rekord
     * został już cofnięty lub przestał być najnowszy. Używane wszędzie tam, gdzie inny
     * przepływ (np. zgłoszenie CV) przebudowuje komponenty wiadomości — bez tego
     * przycisk gracza znikałby po pierwszym zgłoszeniu.
     * @returns {ButtonBuilder|null}
     */
    _undoButtonFor(publicMsgId, msgs) {
        const session = this.recordRevertService?.get(publicMsgId);
        if (!session) return null;
        if (session.status !== 'active') return null;
        return new ButtonBuilder()
            .setCustomId(`rec_undo_${publicMsgId}`)
            .setLabel(msgs.recordUndoButton)
            .setStyle(ButtonStyle.Secondary);
    }

    /**
     * Rozstrzyga typ wpisu w kanale logów OCR po ZAPISANYM rekordzie (`/update`, panel).
     * Brak wpisu profilu na tym serwerze nie znaczy jeszcze „nowy gracz":
     *  - profil miał wynik na innym serwerze → przeprowadzka (`server_change`) z podaniem, skąd
     *  - to dodatkowy profil tej samej osoby (slot > 1) → nowe konto w grze (`new_account`)
     *  - dopiero pierwszy wynik pierwszego profilu to faktycznie nowy gracz (`new_player`)
     * @param {Object|null} currentScore - dotychczasowy rekord profilu NA TYM serwerze
     * @param {Object|null} prevGlobalUser - wpis profilu w rankingu globalnym sprzed zapisu
     * @param {string} guildId - serwer, na którym wynik został zapisany
     * @param {number} profileIndex - numer slotu profilu (1 = główny)
     * @param {boolean} roleError - czy aktualizacja ról TOP padła (wariant żółty)
     * @returns {{ type: string, movedFromGuildId: string|null }}
     */
    _resolveUpdateLogType(currentScore, prevGlobalUser, guildId, profileIndex, roleError = false) {
        if (currentScore) return { type: roleError ? 'role_error' : 'new_record', movedFromGuildId: null };

        const movedFromGuildId = prevGlobalUser?.sourceGuildId && prevGlobalUser.sourceGuildId !== guildId
            ? prevGlobalUser.sourceGuildId
            : null;

        if (movedFromGuildId) {
            return { type: roleError ? 'role_error_server_change' : 'server_change', movedFromGuildId };
        }
        if (profileIndex > 1) {
            return { type: roleError ? 'role_error_new_account' : 'new_account', movedFromGuildId: null };
        }
        return { type: roleError ? 'role_error_new_player' : 'new_player', movedFromGuildId: null };
    }

    /**
     * Wiersz z przyciskiem cofnięcia dla admina (embed w kanale logów OCR).
     * Kluczem jest ID publicznego ogłoszenia — dzięki temu przycisk admina i przycisk
     * gracza dotyczą DOKŁADNIE tego samego rekordu. Fallback na starą postać
     * `{playerKey}_{guildId}` gdy ogłoszenia nie ma (np. błąd publikacji).
     * @returns {Object[]} tablica JSON komponentów (format oczekiwany przez logService)
     */
    _buildAdminRevertRow(publicMsgId, playerKey, guildId) {
        const token = publicMsgId || `${playerKey}_${guildId}`;
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ocr_revert_${token}`)
                .setLabel('↩️ Cofnij wynik')
                .setStyle(ButtonStyle.Secondary)
        ).toJSON()];
    }

    /**
     * Callback do `logService.sendOcrAnalysisEmbed({ onSent })` — zapamiętuje ID embeda
     * admina w sesji cofnięcia, żeby po cofnięciu przez gracza dało się dezaktywować
     * przycisk również po stronie admina.
     */
    _adminMsgTracker(publicMsgId) {
        if (!publicMsgId || !this.recordRevertService) return null;
        return async (sentMsg) => {
            if (!sentMsg?.id) return;
            await this.recordRevertService.attachAdminMessage(publicMsgId, sentMsg.id, sentMsg.channelId);
        };
    }

    /**
     * Czy klikający może cofnąć CUDZY rekord: administrator serwera, na którym rekord padł,
     * albo head admin. Admin z innego serwera nie rusza cudzych danych.
     */
    _canAdminUndoRecord(interaction, session) {
        if (this._isHeadAdmin(interaction.user.id)) return true;
        if (!session?.guildId || interaction.guildId !== session.guildId) return false;
        return interaction.member?.permissions?.has('Administrator') === true;
    }

    /**
     * Kliknięcie „↩️ Cofnij wynik" pod ogłoszeniem rekordu.
     * Cofnąć może właściciel wyniku ALBO administrator serwera (head admin zawsze),
     * i WYŁĄCZNIE najnowszy rekord danego profilu.
     */
    async _handleRecordUndo(interaction, customId) {
        const publicMsgId = customId.slice('rec_undo_'.length);
        const session = this.recordRevertService?.get(publicMsgId);
        const msgs = this.msgs(session?.guildId || interaction.guildId);

        if (!session) {
            await interaction.reply({ content: msgs.recordUndoExpired, flags: ['Ephemeral'] });
            return;
        }
        // Właściciel = osoba (dowolny profil tej osoby cofa własny wynik)
        const isOwner = getOwnerId(session.playerKey) === interaction.user.id;
        const isAdmin = !isOwner && this._canAdminUndoRecord(interaction, session);
        if (!isOwner && !isAdmin) {
            await interaction.reply({ content: msgs.recordUndoNotOwner, flags: ['Ephemeral'] });
            return;
        }
        if (this._isSessionReverted(session.status)) {
            await interaction.reply({ content: msgs.recordUndoAlready, flags: ['Ephemeral'] });
            return;
        }
        if (session.status === 'superseded' || !this.recordRevertService.isLatest(publicMsgId)) {
            // Ogłoszenie przestało być najnowsze — dezaktywuj przycisk, żeby nie mylił
            await interaction.reply({ content: msgs.recordUndoNotLatest, flags: ['Ephemeral'] });
            await this._disablePreviousUndoButton(interaction.client, session).catch(() => {});
            return;
        }

        // Potwierdzenie — cofnięcia nie da się odwrócić
        await interaction.reply({
            content: isOwner ? msgs.recordUndoConfirmTitle : msgs.recordUndoAdminConfirmTitle,
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rec_undo_ok_${publicMsgId}`)
                    .setLabel(msgs.recordUndoConfirmYes)
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('rec_undo_no')
                    .setLabel(msgs.recordUndoConfirmNo)
                    .setStyle(ButtonStyle.Secondary)
            )],
            flags: ['Ephemeral'],
        });
    }

    /** Potwierdzone cofnięcie rekordu — przez właściciela albo przez admina serwera. */
    async _handleRecordUndoConfirm(interaction, customId) {
        const publicMsgId = customId.slice('rec_undo_ok_'.length);
        const session = this.recordRevertService?.get(publicMsgId);
        const msgs = this.msgs(session?.guildId || interaction.guildId);

        if (!session) {
            await interaction.update({ content: msgs.recordUndoExpired, components: [] });
            return;
        }
        // Rolę ustalamy ponownie tutaj — customId nie jest źródłem prawdy o uprawnieniach
        const isOwner = getOwnerId(session.playerKey) === interaction.user.id;
        const isAdmin = !isOwner && this._canAdminUndoRecord(interaction, session);
        if (!isOwner && !isAdmin) {
            await interaction.update({ content: msgs.recordUndoNotOwner, components: [] });
            return;
        }
        if (this._isSessionReverted(session.status)) {
            await interaction.update({ content: msgs.recordUndoAlready, components: [] });
            return;
        }
        if (!this.recordRevertService.isLatest(publicMsgId)) {
            await interaction.update({ content: msgs.recordUndoNotLatest, components: [] });
            return;
        }

        await interaction.deferUpdate();
        const gl = this.logService._gl(session.guildId);
        const actorName = interaction.member?.displayName || interaction.user.username;

        // Blokada przed podwójnym kliknięciem — status ustawiamy PRZED cofnięciem danych
        const by = isOwner ? 'owner' : 'admin';
        await this.recordRevertService.markReverted(publicMsgId, by, actorName);

        try {
            await this._cvRemoveRecord(session, { skipUndoInvalidate: true, client: interaction.client });

            // Role TOP mogły się zmienić po cofnięciu wyniku
            const guild = interaction.client.guilds.cache.get(session.guildId);
            if (guild) {
                const guildCfg = this.config.getGuildConfig(session.guildId);
                await this.roleService.updateTopRoles(guild, null, guildCfg?.topRoles || null).catch(() => {});
            }
            // Zgłoszenia CV dotyczące cofniętego rekordu tracą sens
            if (this.communityVerificationService) {
                await this.communityVerificationService.expireUserSessions(session.playerKey, session.guildId).catch(() => {});
            }
            this.ocrStatsService?.recordReverted().catch(() => {});
            this.adminPanelService?.refresh();
            // Wysyłka rankingu na stronę leci z `_cvRemoveRecord` (wspólna dla wszystkich cofnięć)

            // Ogłoszenie dostaje notkę i nieaktywny czerwony przycisk: „Cofnął właściciel" albo „Cofnął admin"
            await this._applyRevertVisuals(interaction.client, session, by, actorName, {
                publicNote: isOwner
                    ? msgs.recordUndoOwnerNote
                    : formatMessage(msgs.recordUndoAdminNote, { adminName: actorName }),
            });
            await interaction.editReply({ content: isOwner ? msgs.recordUndoDone : msgs.recordUndoAdminDone, components: [] });
            if (isOwner) {
                gl.info(`↩️ ${this.logService.nickLink(actorName, interaction.user.id)} samodzielnie cofnął swój ostatni rekord${session.bossName ? ` (boss: "${session.bossName}")` : ''}`);
            } else {
                gl.info(`↩️ Administrator ${this.logService.nickLink(actorName, interaction.user.id)} cofnął rekord gracza ${session.playerKey}${session.bossName ? ` (boss: "${session.bossName}")` : ''}`);
                this._ccAudit(interaction, `↩️ Cofnięto rekord gracza ${await this._ccName(interaction, session.playerKey)} (przycisk pod ogłoszeniem)`);
            }
        } catch (err) {
            gl.error(`❌ Błąd cofania rekordu (${isOwner ? 'właściciel' : 'admin'}): ${err.message}`);
            await interaction.editReply({ content: msgs.updateError, components: [] }).catch(() => {});
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PROFILE GRACZA (kilka kont w grze)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Nazwa profilu do wyświetlenia: „1️⃣ Profil 1 — Nick 📌".
     * Emoji oznacza SLOT (stały numer), pinezka — który profil jest mainem.
     * @param {{ index: number, label: string|null, isMain?: boolean }} prof
     * @param {Object} msgs
     * @returns {string}
     */
    _profileDisplayName(prof, msgs) {
        const emoji = getProfileButtonEmoji(prof.index);
        const base = `${emoji ? `${emoji} ` : ''}${formatMessage(msgs.profileCmdSlotName, { index: prof.index })}`;
        const withLabel = prof.label ? `${base} — ${prof.label}` : base;
        return prof.isMain ? `${withLabel} 📌` : withLabel;
    }

    /**
     * Klucz profilu, którego dotyczą statystyki i podkreślenie w rankingach:
     * ZAWSZE profil MAIN (pinezka 📌 w `/profile`).
     * Gracz bez wpisu w rejestrze profili → własne ID (slot 1).
     * @param {string} userId - Discord ID gracza
     * @returns {string|null}
     */
    _mainPlayerKey(userId) {
        if (!userId) return null;
        const ownerId = String(userId);
        return this.profileRegistryService?.getMainPlayerKey(ownerId) || ownerId;
    }

    /**
     * Notka do pola „Twoje statystyki", gdy profil MAIN nie ma jeszcze wyniku, a gracz
     * ma kilka profili. Bez niej widział tylko „Nie jesteś jeszcze w rankingu" i nie
     * wiedział, że wynik ma na innym profilu (nie-mainie).
     * @param {string} userId
     * @param {Object} msgs
     * @returns {string|null} null gdy gracz ma jeden profil (komunikat domyślny wystarcza)
     */
    _mainProfileNoScoreNote(userId, msgs) {
        const registry = this.profileRegistryService;
        if (!registry?.hasMultipleProfiles(userId)) return null;
        const idx = getProfileIndex(this._mainPlayerKey(userId));
        const prof = registry.getProfiles(userId).find(p => p.index === idx);
        return formatMessage(msgs.rankingMainNoScore, {
            profile: prof ? this._profileDisplayName({ ...prof, isMain: false }, msgs) : `#${idx}`
        });
    }

    /**
     * Pozycja gracza na liście rankingowej z uwzględnieniem profili.
     * Liczy się WYŁĄCZNIE profil MAIN — brak jego wyniku oznacza brak pozycji
     * (-1). Świadomie nie ma fallbacku na inny profil gracza: pokazywanie wyniku
     * z innego profilu, gdy main go nie ma, myliło graczy.
     * @param {Array} players - lista wpisów rankingu (z playerKey lub userId)
     * @param {string} userId - Discord ID gracza
     * @returns {number} indeks w liście lub -1
     */
    _findCallerIndex(players, userId) {
        if (!Array.isArray(players) || !userId) return -1;
        const trackedKey = this._mainPlayerKey(userId);
        return players.findIndex(p => (p.playerKey || p.userId) === trackedKey);
    }

    /** Krótka etykieta na przycisk (limit 80 znaków) — pinezka oznacza maina. */
    _profileButtonLabel(prof, msgs) {
        const base = formatMessage(msgs.profileCmdSlotName, { index: prof.index });
        const label = prof.label ? `${base} — ${prof.label}` : base;
        return `${prof.isMain ? '📌 ' : ''}${label}`.slice(0, 80);
    }

    /**
     * Modal wyboru profilu przy /update i /test — okno pop-up z listą kont gracza.
     * Kolejność opcji: Main, potem profile 2, 3… (zgodnie z numeracją slotów);
     * domyślny profil gracza jest wstępnie zaznaczony.
     *
     * Discord dopuszcza w modalach wyłącznie pola tekstowe i select menu (owinięte
     * w komponent Label) — przyciski są tu niemożliwe, stąd lista rozwijana.
     *
     * @param {string} sessionId - ID interakcji komendy (klucz sesji)
     * @param {Array} profiles
     * @param {number} activeIdx - domyślnie zaznaczony profil
     * @returns {ModalBuilder}
     */
    _buildProfileModal(sessionId, profiles, activeIdx, guildId) {
        const msgs = this.msgs(guildId);
        const select = new StringSelectMenuBuilder()
            .setCustomId('upd_prof_sel')
            .setPlaceholder(msgs.updateProfileSelectPlaceholder)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(profiles.map(prof => {
                const option = new StringSelectMenuOptionBuilder()
                    .setValue(String(prof.index))
                    .setLabel(this._profileButtonLabel(prof, msgs).slice(0, 100))
                    .setDefault(prof.index === activeIdx);
                const emoji = getProfileButtonEmoji(prof.index);
                if (emoji) option.setEmoji(emoji);
                if (prof.label) option.setDescription(prof.label.slice(0, 100));
                return option;
            }));

        return new ModalBuilder()
            .setCustomId(`upd_prof_modal_${sessionId}`)
            .setTitle(msgs.updateProfileModalTitle.slice(0, 45))
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel(msgs.updateProfileModalLabel.slice(0, 45))
                    .setDescription(msgs.updateProfileModalDescription.slice(0, 100))
                    .setStringSelectMenuComponent(select)
            );
    }

    /**
     * Wysłanie modala wyboru profilu przy /update lub /test.
     * Dalszy flow korzysta z interakcji MODALA (nie komendy) — po odpowiedzi typu „modal"
     * pierwotna interakcja nie ma już wiadomości, którą dałoby się edytować, więc postęp
     * analizy i publiczne ogłoszenie idą przez interakcję modala.
     */
    async _handleUpdateProfileModal(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const sessionId = interaction.customId.slice('upd_prof_modal_'.length);

        const session = this._updateProfileSessions.get(sessionId);
        if (!session) {
            await interaction.reply({ content: msgs.updateProfileSessionExpired, flags: ['Ephemeral'] });
            return;
        }
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: msgs.updateProfileNotYours, flags: ['Ephemeral'] });
            return;
        }

        const selected = interaction.fields.getStringSelectValues('upd_prof_sel');
        const profileIndex = parseInt(selected?.[0], 10);
        if (!Number.isFinite(profileIndex)) {
            await interaction.reply({ content: msgs.updateProfileNotSelected, flags: ['Ephemeral'] });
            return;
        }
        if (!this.profileRegistryService?.hasProfile(interaction.user.id, profileIndex)) {
            await interaction.reply({ content: msgs.profileCmdNotFound, flags: ['Ephemeral'] });
            return;
        }

        this._updateProfileSessions.delete(sessionId);

        const playerKey = makePlayerKey(interaction.user.id, profileIndex);
        const gl = this.logService._gl(interaction.guildId);
        const prof = this.profileRegistryService.getProfiles(interaction.user.id).find(pr => pr.index === profileIndex);
        gl.info(`👥 [/${session.commandName}] Wybrano profil ${profileIndex}${prof?.label ? ` ("${prof.label}")` : ''} — ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, interaction.user.id)}`);

        await this._runUpdateAnalysis(interaction, {
            dryRun: session.dryRun,
            commandName: session.commandName,
            ocrBlockKey: session.ocrBlockKey,
            playerKey,
            alreadyReplied: false,
            attachment: session.attachment,
        });
    }

    /**
     * Panel zarządzania profilami gracza — otwierany przyciskiem „👥 Moje profile"
     * w `/profile` (osobnej komendy nie ma). Odpowiada nowym ephemeralem, więc
     * modale nazwy i potwierdzenia nie ruszają wiadomości z widokiem profilu.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
    async handleProfilesPanel(interaction) {
        if (!this.profileRegistryService) {
            await interaction.reply({ content: this.msgs(interaction.guildId).updateError, flags: ['Ephemeral'] });
            return;
        }
        const { embed, components } = await this._buildProfilesPanel(interaction.user.id, interaction.guildId, interaction.client);
        await interaction.reply({ embeds: [embed], components, flags: ['Ephemeral'] });
    }

    /**
     * Bramka edukacyjna przed dodaniem PIERWSZEGO dodatkowego profilu.
     * Discord nie pozwala umieścić w okienku modalnym sformatowanego tekstu ani
     * przycisków (tylko pola i listy), dlatego wyjaśnienie jest osobnym ephemeralem
     * z potwierdzeniem — okno z nazwą profilu otwiera się dopiero po nim.
     * @param {import('discord.js').ButtonInteraction} interaction
     */
    async handleProfileAddIntro(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const registry = this.profileRegistryService;
        if (!registry) {
            await interaction.reply({ content: msgs.updateError, flags: ['Ephemeral'] });
            return;
        }
        const maxProfiles = registry.getMaxProfiles();
        if (registry.getProfiles(interaction.user.id).length >= maxProfiles) {
            await interaction.reply({
                content: formatMessage(msgs.profileCmdAddLimit, { limit: maxProfiles }),
                flags: ['Ephemeral'],
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(msgs.profileIntroTitle)
            .setDescription(formatMessage(msgs.profileIntroBody, { max: maxProfiles }))
            .setFooter({ text: msgs.profileIntroFooter });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('prof_intro_ok')
                .setLabel(msgs.profileIntroBtnOk)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('prof_intro_cancel')
                .setLabel(msgs.profileIntroBtnCancel)
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [embed], components: [row], flags: ['Ephemeral'] });
    }

    /**
     * Buduje embed + przyciski panelu profili gracza.
     */
    async _buildProfilesPanel(userId, guildId, client) {
        const msgs = this.msgs(guildId);
        const profiles = this.profileRegistryService.getProfiles(userId);
        const activeIdx = this.profileRegistryService.getMainIndex(userId);
        const maxProfiles = this.profileRegistryService.getMaxProfiles();

        // Wyniki profili z rankingu globalnego (żeby gracz widział, co jest gdzie zapisane)
        const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
        const activeGuildIds = new Set(configuredIds.filter(gid => client.guilds.cache.has(gid)));
        const globalRanking = await this.rankingService.getGlobalRanking(activeGuildIds).catch(() => []);

        const lines = profiles.map(prof => {
            const idx = globalRanking.findIndex(pl => (pl.playerKey || pl.userId) === prof.playerKey);
            const scorePart = idx !== -1
                ? `**${globalRanking[idx].score}** *(#${idx + 1})*`
                : `*${msgs.profileCmdNoScore}*`;
            const isActive = prof.index === activeIdx;
            const name = this._profileDisplayName(prof, msgs);
            // Profil czekający na skasowanie — data w formacie względnym Discorda
            const pendingHint = prof.pendingDeleteAt
                ? ` · ⏳ *${formatMessage(msgs.profileCmdDeletePending, { when: this._discordTs(prof.pendingDeleteAt, 'R') })}*`
                : '';
            return `${isActive ? '**▸** ' : '　'}${name} — ${scorePart}${pendingHint}`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(msgs.profileCmdTitle)
            .setDescription(
                `${formatMessage(msgs.profileCmdDescription, { count: profiles.length, max: maxProfiles })}\n\n${lines.join('\n')}`
            );

        const canAdd = profiles.length < maxProfiles;
        const hasAlts = profiles.some(pr => !pr.isMain);
        const hasPending = profiles.some(pr => pr.pendingDeleteAt);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('prof_add')
                .setLabel(msgs.profileCmdBtnAdd)
                .setStyle(ButtonStyle.Success)
                .setDisabled(!canAdd),
            new ButtonBuilder()
                .setCustomId('prof_switch')
                .setLabel(msgs.profileCmdBtnSwitch)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(profiles.length < 2),
            new ButtonBuilder()
                .setCustomId('prof_rename')
                .setLabel(msgs.profileCmdBtnRename)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('prof_delete')
                .setLabel(msgs.profileCmdBtnDelete)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!hasAlts),
        );
        // Odwołanie usuwania pokazujemy tylko wtedy, gdy jest co odwoływać
        if (hasPending) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('prof_delete_cancel')
                    .setLabel(msgs.profileCmdBtnCancelDelete)
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        return { embed, components: [row] };
    }

    /** Znacznik czasu Discorda (`<t:sekundy:styl>`) — sam się lokalizuje u odbiorcy. */
    _discordTs(iso, style = 'F') {
        const ms = Date.parse(iso);
        if (!Number.isFinite(ms)) return '—';
        return `<t:${Math.floor(ms / 1000)}:${style}>`;
    }

    /**
     * Linijka „aktualny rekord profilu" do okna potwierdzenia usunięcia — gracz widzi,
     * co dokładnie straci (wynik, boss, data), zanim zdecyduje.
     * @returns {Promise<string>}
     */
    async _profileRecordSummary(playerKey, client, msgs) {
        try {
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const activeGuildIds = new Set(configuredIds.filter(gid => client.guilds.cache.has(gid)));
            const globalRanking = await this.rankingService.getGlobalRanking(activeGuildIds);
            const entry = globalRanking.find(p => (p.playerKey || p.userId) === playerKey);
            if (!entry) return msgs.profileCmdDeleteNoRecord;
            return formatMessage(msgs.profileCmdDeleteRecord, {
                score: entry.score || this.rankingService.formatScore(entry.scoreValue),
                boss: entry.bossName || msgs.unknownBoss,
                date: this._discordTs(entry.timestamp, 'D'),
            });
        } catch {
            return msgs.profileCmdDeleteNoRecord;
        }
    }

    /** Odświeża panel profili w miejscu. */
    async _refreshProfilesPanel(interaction, extraContent = null) {
        const { embed, components } = await this._buildProfilesPanel(interaction.user.id, interaction.guildId, interaction.client);
        const payload = { embeds: [embed], components };
        if (extraContent !== null) payload.content = extraContent;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
    }

    /**
     * Przyciski panelu profili: dodaj / przełącz / zmień nazwę / usuń.
     */
    async handleProfileRegistryButton(interaction, customId) {
        const msgs = this.msgs(interaction.guildId);
        const userId = interaction.user.id;
        const registry = this.profileRegistryService;
        if (!registry) {
            await interaction.reply({ content: msgs.updateError, flags: ['Ephemeral'] });
            return;
        }

        // Bramka edukacyjna: potwierdzenie przeczytania → okno z nazwą profilu
        if (customId === 'prof_intro_ok') {
            if (registry.getProfiles(userId).length >= registry.getMaxProfiles()) {
                await interaction.update({
                    content: formatMessage(msgs.profileCmdAddLimit, { limit: registry.getMaxProfiles() }),
                    embeds: [],
                    components: [],
                });
                return;
            }
            // Tryb „addfirst" — po dodaniu zamyka wyjaśnienie, żeby nie dało się
            // kliknąć potwierdzenia drugi raz i dodać profilu, o który nikt nie prosił
            await this._showProfileNameModal(interaction, 'addfirst', null, msgs);
            return;
        }

        if (customId === 'prof_intro_cancel') {
            await interaction.update({ content: msgs.profileIntroCancelled, embeds: [], components: [] });
            return;
        }

        // Dodanie profilu — modal na nazwę (nick w grze), nazwa opcjonalna
        if (customId === 'prof_add') {
            if (registry.getProfiles(userId).length >= registry.getMaxProfiles()) {
                await interaction.reply({
                    content: formatMessage(msgs.profileCmdAddLimit, { limit: registry.getMaxProfiles() }),
                    flags: ['Ephemeral'],
                });
                return;
            }
            await this._showProfileNameModal(interaction, 'add', null, msgs);
            return;
        }

        // Wybór profilu do przełączenia / zmiany nazwy / usunięcia — lista przycisków
        if (customId === 'prof_switch' || customId === 'prof_rename' || customId === 'prof_delete') {
            const action = customId.split('_')[1]; // switch | rename | delete
            const profiles = registry.getProfiles(userId)
                // Maina nie da się usunąć — nie pokazujemy go nawet na liście wyboru
                .filter(pr => action !== 'delete' || !pr.isMain);
            if (profiles.length === 0) {
                await interaction.reply({ content: msgs.profileCmdNotFound, flags: ['Ephemeral'] });
                return;
            }
            const rows = [];
            let row = new ActionRowBuilder();
            for (const prof of profiles) {
                if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
                const btn = new ButtonBuilder()
                    .setCustomId(`prof_${action}_do_${prof.index}`)
                    .setLabel(this._profileButtonLabel(prof, msgs))
                    .setStyle(action === 'delete' ? ButtonStyle.Danger : ButtonStyle.Secondary);
                const emoji = getProfileButtonEmoji(prof.index);
                if (emoji) btn.setEmoji(emoji);
                row.addComponents(btn);
            }
            if (row.components.length > 0) rows.push(row);
            await interaction.reply({ content: msgs.profileCmdSelectPrompt, components: rows, flags: ['Ephemeral'] });
            return;
        }

        // Ustawienie domyślnego profilu
        if (customId.startsWith('prof_switch_do_')) {
            const idx = parseInt(customId.slice('prof_switch_do_'.length), 10);
            const ok = await registry.setMain(userId, idx);
            if (!ok) {
                await interaction.update({ content: msgs.profileCmdNotFound, components: [] });
                return;
            }
            const prof = registry.getProfiles(userId).find(pr => pr.index === idx);
            await interaction.update({
                content: formatMessage(msgs.profileCmdMainSet, { profile: this._profileDisplayName(prof, msgs) }),
                components: [],
            });
            return;
        }

        // Zmiana nazwy profilu — modal
        if (customId.startsWith('prof_rename_do_')) {
            const idx = parseInt(customId.slice('prof_rename_do_'.length), 10);
            await this._showProfileNameModal(interaction, 'rename', idx, msgs);
            return;
        }

        // Odwołanie zaplanowanego usunięcia — lista profili czekających na skasowanie
        if (customId === 'prof_delete_cancel') {
            const pending = registry.getProfiles(userId).filter(pr => pr.pendingDeleteAt);
            if (pending.length === 0) {
                await interaction.reply({ content: msgs.profileCmdNoPendingDeletions, flags: ['Ephemeral'] });
                return;
            }
            const cancelRow = new ActionRowBuilder();
            for (const prof of pending.slice(0, 5)) {
                const btn = new ButtonBuilder()
                    .setCustomId(`prof_delete_cancel_do_${prof.index}`)
                    .setLabel(this._profileButtonLabel(prof, msgs))
                    .setStyle(ButtonStyle.Success);
                const emoji = getProfileButtonEmoji(prof.index);
                if (emoji) btn.setEmoji(emoji);
                cancelRow.addComponents(btn);
            }
            await interaction.reply({ content: msgs.profileCmdSelectPrompt, components: [cancelRow], flags: ['Ephemeral'] });
            return;
        }

        if (customId.startsWith('prof_delete_cancel_do_')) {
            const idx = parseInt(customId.slice('prof_delete_cancel_do_'.length), 10);
            const prof = registry.getProfiles(userId).find(pr => pr.index === idx);
            const res = await registry.cancelDeletion(userId, idx, interaction.member?.displayName || interaction.user.username);
            if (!res.ok) {
                await interaction.update({ content: msgs.profileCmdNoPendingDeletions, components: [] });
                return;
            }
            this.logService._gl(interaction.guildId).info(
                `👥 ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, userId)} odwołał usunięcie profilu #${idx}`
            );
            await interaction.update({
                content: formatMessage(msgs.profileCmdDeleteCancelled, { profile: this._profileDisplayName(prof || { index: idx, label: null }, msgs) }),
                components: [],
            });
            return;
        }

        // Usunięcie profilu — potwierdzenie (z aktualnym rekordem, żeby gracz wiedział, co traci)
        if (customId.startsWith('prof_delete_do_')) {
            const idx = parseInt(customId.slice('prof_delete_do_'.length), 10);
            const prof = registry.getProfiles(userId).find(pr => pr.index === idx);
            if (!prof) {
                await interaction.update({ content: msgs.profileCmdNotFound, components: [] });
                return;
            }
            // Maina nie da się usunąć — dopiero po wskazaniu pinezką innego profilu
            if (prof.isMain) {
                await interaction.update({ content: msgs.profileCmdDeleteMain, components: [] });
                return;
            }
            const recordLine = await this._profileRecordSummary(prof.playerKey, interaction.client, msgs);
            await interaction.update({
                content: formatMessage(msgs.profileCmdDeleteConfirm, {
                    profile: this._profileDisplayName(prof, msgs),
                    record: recordLine,
                }),
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`prof_delete_confirm_${idx}`)
                        .setLabel(msgs.profileCmdBtnDelete)
                        .setStyle(ButtonStyle.Danger),
                )],
            });
            return;
        }

        // Usunięcie profilu — PLANOWANIE (dane kasuje sweep dopiero po 7 dniach)
        if (customId.startsWith('prof_delete_confirm_')) {
            const idx = parseInt(customId.slice('prof_delete_confirm_'.length), 10);
            const prof = registry.getProfiles(userId).find(pr => pr.index === idx);
            const res = await registry.scheduleDeletion(userId, idx, interaction.member?.displayName || interaction.user.username);
            if (!res.ok) {
                await interaction.update({
                    content: res.reason === 'IS_MAIN' ? msgs.profileCmdDeleteMain : msgs.profileCmdNotFound,
                    components: [],
                });
                return;
            }
            this.logService._gl(interaction.guildId).info(
                `👥 ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, userId)} zaplanował usunięcie profilu #${idx} (termin: ${res.deleteAt})`
            );
            await interaction.update({
                content: formatMessage(msgs.profileCmdDeleteScheduled, {
                    profile: this._profileDisplayName(prof || { index: idx, label: null }, msgs),
                    when: this._discordTs(res.deleteAt, 'F'),
                    relative: this._discordTs(res.deleteAt, 'R'),
                }),
                components: [],
            });
            return;
        }
    }

    /** Modal nazwy profilu (dodanie albo zmiana nazwy). */
    async _showProfileNameModal(interaction, mode, profileIndex, msgs) {
        const modal = new ModalBuilder()
            .setCustomId(`prof_modal_${mode}_${profileIndex ?? 0}`)
            .setTitle(msgs.profileCmdModalTitle)
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('prof_label')
                    .setLabel(msgs.profileCmdModalLabel)
                    .setPlaceholder(msgs.profileCmdModalPlaceholder)
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(24)
                    .setRequired(false)
            ));
        await interaction.showModal(modal);
    }

    /** Zapis nazwy profilu z modala. */
    async _handleProfileNameModal(interaction) {
        const msgs = this.msgs(interaction.guildId);
        const registry = this.profileRegistryService;
        // prof_modal_{add|rename}_{index}
        const parts = interaction.customId.split('_');
        const mode = parts[2];
        const idx = parseInt(parts[3], 10);
        const label = interaction.fields.getTextInputValue('prof_label')?.trim() || null;

        if (mode === 'add' || mode === 'addfirst') {
            const res = await registry.addProfile(interaction.user.id, label, interaction.member?.displayName || interaction.user.username);
            if (!res.ok) {
                const content = res.reason === 'LIMIT'
                    ? formatMessage(msgs.profileCmdAddLimit, { limit: res.limit })
                    : msgs.profileCmdDuplicateLabel;
                await interaction.reply({ content, flags: ['Ephemeral'] });
                return;
            }
            const prof = registry.getProfiles(interaction.user.id).find(pr => pr.index === res.index);
            const addedContent = formatMessage(msgs.profileCmdAdded, { profile: this._profileDisplayName(prof, msgs) });
            if (mode === 'addfirst' && interaction.isFromMessage?.()) {
                // Zamiast osobnej wiadomości: wyjaśnienie zamienia się w potwierdzenie
                await interaction.update({ content: addedContent, embeds: [], components: [] });
            } else {
                await interaction.reply({ content: addedContent, flags: ['Ephemeral'] });
            }
            this.logService._gl(interaction.guildId).info(
                `👥 ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, interaction.user.id)} dodał profil #${res.index}${label ? ` ("${label}")` : ''}`
            );
            return;
        }

        const res = await registry.setLabel(interaction.user.id, idx, label);
        if (!res.ok) {
            const content = res.reason === 'DUPLICATE_LABEL' ? msgs.profileCmdDuplicateLabel : msgs.profileCmdNotFound;
            await interaction.reply({ content, flags: ['Ephemeral'] });
            return;
        }
        await interaction.reply({
            content: res.label
                ? formatMessage(msgs.profileCmdRenamed, { label: res.label })
                : msgs.profileCmdRenameCleared,
            flags: ['Ephemeral'],
        });
    }

    /**
     * Kasuje profil wraz ze WSZYSTKIMI jego danymi na wszystkich serwerach.
     * Wywoływane WYŁĄCZNIE przez sweep rejestru po upływie 7 dni od zaplanowania
     * usunięcia (gracz do tego czasu może się rozmyślić) — nie z interakcji.
     * Numer slotu nie jest odzyskiwany przez przenumerowanie — pozostaje wolny.
     * @param {string} userId
     * @param {number} profileIndex
     * @param {{ client: import('discord.js').Client, logGuildId?: string|null }} ctx
     * @returns {Promise<{ ok: boolean, profileName?: string, removedRecords?: number }>}
     */
    async _purgeProfileData(userId, profileIndex, { client, logGuildId = null }) {
        const msgs = this.msgs(logGuildId);
        const registry = this.profileRegistryService;
        const prof = registry.getProfiles(userId).find(pr => pr.index === profileIndex);
        // Main mógł zostać przestawiony po zaplanowaniu usunięcia — wtedy nie kasujemy
        if (!prof || prof.isMain) return { ok: false };

        const playerKey = prof.playerKey;
        const profileName = this._profileDisplayName(prof, msgs);
        const gl = this.logService._gl(logGuildId);
        const guildIds = this.guildConfigService?.getAllConfiguredGuildIds()
            || Array.from(client.guilds.cache.keys());

        let removedRecords = 0;
        const touchedGuildIds = [];
        for (const gid of guildIds) {
            try {
                const wasRemoved = await this.rankingService.removePlayerFromRanking(playerKey, gid);
                if (wasRemoved) {
                    removedRecords++;
                    touchedGuildIds.push(gid);
                }
                if (this.bossRecordService) {
                    await this.bossRecordService.removeAllUserBossRecords(gid, playerKey).catch(() => 0);
                }
                if (this.achievementService) {
                    await this.achievementService.resetAllAchievements(gid, playerKey).catch(() => {});
                }
                if (this.scoreHistoryService) {
                    await this.scoreHistoryService.removeEntriesAfter(gid, playerKey, 0).catch(() => 0);
                }
                // Role TOP na serwerze mogą się zmienić po usunięciu wpisu z rankingu
                const guildObj = client.guilds.cache.get(gid);
                const guildCfg = this.config.getGuildConfig(gid);
                if (wasRemoved && guildObj && guildCfg?.topRoles) {
                    this.roleService.updateTopRoles(guildObj, null, guildCfg.topRoles).catch(() => {});
                }
            } catch (err) {
                gl.warn(`⚠️ Błąd usuwania danych profilu ${playerKey} na serwerze ${gid}: ${err.message}`);
            }
        }

        // Przyciski cofnięcia pod ogłoszeniami usuwanego profilu tracą ważność.
        // Powód „profile_deleted" → etykieta „🗑️ Profil usunięty" zamiast „Cofnął admin"
        // (żaden admin tu nie interweniował — wynik zniknął razem z profilem)
        for (const gid of guildIds) {
            await this._invalidateUndoForPlayer(client, playerKey, gid, profileName, { by: 'profile_deleted' }).catch(() => {});
        }
        // Subskrypcje wskazujące na ten profil tracą sens
        await this.notificationService.removeAllSubscriptionsForTarget?.(playerKey).catch(() => {});
        // ⚔️ Wyzwania: te w toku są anulowane (z DM do przeciwnika), a rozstrzygnięte ZOSTAJĄ —
        // to również historia przeciwnika. Uczestnik dostaje flagę `profileDeleted`, którą
        // warstwa wyświetlania tłumaczy na „Profil usunięty" w języku odbiorcy.
        await this._cancelChallengesForProfile(client, playerKey).catch(() => {});

        // Rejestr przenumerowuje pozostałe profile (2→1, 3→2) i mówi, co przenieść
        const removal = await registry.removeProfile(userId, profileIndex);
        for (const move of removal.renumbered || []) {
            await this._migratePlayerKey(move.fromKey, move.toKey, guildIds, gl);
        }

        gl.info(`👥 Skasowano profil #${profileIndex} gracza <@${userId}> po 7 dniach od zgłoszenia (wpisy w rankingu: ${removedRecords})`);
        this.adminPanelService?.refresh();
        // Profil znika ze WSZYSTKICH serwerów naraz — każdy z nich musi dostać nowy TOP 10.
        // Przy przenumerowaniu (2→1, 3→2) zmienia się też znacznik profilu w nicku, więc
        // wtedy odświeżamy komplet serwerów, nie tylko te, z których coś usunięto.
        const syncTargets = (removal.renumbered || []).length ? guildIds : touchedGuildIds;
        this.webRankingSyncService?.syncGuilds(syncTargets, client).catch(() => {});
        return { ok: true, profileName, removedRecords, renumbered: removal.renumbered || [] };
    }

    /**
     * Przenosi WSZYSTKIE dane profilu pod nowy playerKey — po usunięciu profilu numery
     * pozostałych zjeżdżają w dół (2→1, 3→2), a numer slotu jest częścią klucza danych.
     * Pominięcie któregokolwiek magazynu = osierocone dane, więc lista musi być pełna:
     * ranking, rekordy bossów, osiągnięcia, historia wyników (plik na profil),
     * subskrypcje, sesje cofnięcia rekordu, sesje weryfikacji społeczności i wyzwania.
     * @param {string[]} guildIds
     * @param {Object} gl - logger serwerowy
     */
    async _migratePlayerKey(fromKey, toKey, guildIds, gl) {
        for (const gid of guildIds) {
            try {
                await this.rankingService.renamePlayerKey(gid, fromKey, toKey);
                await this.bossRecordService?.renamePlayerKey(gid, fromKey, toKey);
                await this.achievementService?.renamePlayerKey(gid, fromKey, toKey);
                await this.scoreHistoryService?.renamePlayerKey(gid, fromKey, toKey);
            } catch (err) {
                gl.warn(`⚠️ Błąd przenoszenia danych profilu ${fromKey} → ${toKey} na serwerze ${gid}: ${err.message}`);
            }
        }
        await this.notificationService?.renameTargetPlayerKey?.(fromKey, toKey).catch(() => {});
        await this.recordRevertService?.renamePlayerKey?.(fromKey, toKey).catch(() => {});
        await this.communityVerificationService?.renamePlayerKey?.(fromKey, toKey).catch(() => {});
        await this.challengeService?.renamePlayerKey?.(fromKey, toKey).catch(() => {});
        gl.info(`👥 Przeniesiono dane profilu ${fromKey} → ${toKey}`);
    }

    /**
     * Sweep odroczonych usunięć profili — uruchamiany przy starcie bota i co godzinę.
     * Rejestr trzyma terminy, kasowanie danych należy do handlera (ma dostęp do wszystkich serwisów).
     * @param {import('discord.js').Client} client
     */
    startProfileDeletionSweep(client) {
        if (!this.profileRegistryService) return;
        this.profileRegistryService.start(async ({ userId, index }) => {
            await this._purgeProfileData(userId, index, { client });
        });
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
    /**
     * Walidacje wejściowe /update i /test + ewentualny wybór profilu.
     * Sam OCR i zapis wyniku wykonuje `_runUpdateAnalysis` (osobno, bo wybór profilu
     * przerywa flow na kliknięcie przycisku).
     * @param {{ dryRun: boolean, commandName: string, ocrBlockKey: string, playerKey?: string|null }} opts
     *   playerKey — ustawiany tylko przy wznowieniu po wyborze profilu
     */
    async _runUpdateFlow(interaction, { dryRun, commandName, ocrBlockKey, playerKey = null }) {
        const gl = this.logService._gl(interaction.guildId);

        const msgs = this.msgs(interaction.guildId);

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

        // Globalny kill-switch OCR (tryb serwisowy z Centrum Dowodzenia) — blokuje wszystkie serwery naraz
        if (this.adminPanelService?.isGlobalOcrBlocked?.() && !isOcrAuthorized) {
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

        // ── Wybór profilu (gracz z kilkoma kontami w grze) ───────────────────────────
        // Gdy gracz ma więcej niż jeden profil, przed analizą pytamy przyciskami, do którego
        // profilu przypisać wynik. Limit dzienny i cooldown NIE są jeszcze naliczane —
        // porzucony wybór nie może kosztować gracza próby.
        const profileList = this.profileRegistryService?.getProfiles(interaction.user.id) || [];
        if (!playerKey && profileList.length > 1) {
            const activeIdx = this.profileRegistryService.getMainIndex(interaction.user.id);
            // showModal MUSI być pierwszą odpowiedzią na interakcję — dlatego wszystkie
            // walidacje wyżej kończą się `return` i żadna nie odpowiada w happy path.
            await interaction.showModal(
                this._buildProfileModal(interaction.id, profileList, activeIdx, interaction.guildId)
            );
            // Załącznik zapamiętujemy tutaj — interakcja modala nie ma dostępu do opcji komendy
            this._updateProfileSessions.set(interaction.id, {
                attachment,
                dryRun,
                commandName,
                ocrBlockKey,
                userId: interaction.user.id,
                createdAt: Date.now(),
            });
            setTimeout(() => this._updateProfileSessions.delete(interaction.id), 10 * 60 * 1000);
            gl.info(`👥 [/${commandName}] Otwarto modal wyboru profilu (${profileList.length} profile) — ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, interaction.user.id)}`);
            return;
        }

        await this._runUpdateAnalysis(interaction, {
            dryRun,
            commandName,
            ocrBlockKey,
            playerKey: playerKey || interaction.user.id,
            alreadyReplied: false,
            attachment,
        });
    }

    /**
     * Analiza screena i zapis wyniku dla KONKRETNEGO profilu.
     * Wywoływana bezpośrednio (gracz z jednym profilem) albo po wyborze profilu przyciskiem.
     *
     * @param {CommandInteraction} interaction - zawsze ORYGINALNA interakcja komendy
     *   (po wyborze profilu komponent jest tylko potwierdzany przez deferUpdate, a dalszy
     *   flow korzysta z tokenu komendy — dzięki temu publiczne ogłoszenie followUp działa
     *   dokładnie tak jak przed wprowadzeniem profili).
     * @param {{ dryRun: boolean, commandName: string, ocrBlockKey: string, playerKey: string, alreadyReplied: boolean, attachment: object|null }} opts
     */
    async _runUpdateAnalysis(interaction, { dryRun, commandName, ocrBlockKey, playerKey, alreadyReplied = false, attachment = null }) {
        const gl = this.logService._gl(interaction.guildId);
        const msgs = this.msgs(interaction.guildId);
        let _ocrEmbedParams = null; // zbieramy przez cały flow, wysyłamy w finally

        // Potwierdź interakcję ZANIM zaczniemy cokolwiek liczyć — Discord daje na to tylko 3s,
        // a sprawdzenie limitu dziennego czyta i zapisuje plik na dysku. Przy obciążonym
        // serwerze te operacje wypychały deferReply poza limit → DiscordAPIError[10062].
        if (!alreadyReplied) {
            try {
                await interaction.deferReply({ flags: ['Ephemeral'] });
            } catch (deferError) {
                if (deferError.code === 10062) {
                    logger.warn(`⚠️ [/${commandName}] Interakcja wygasła przed potwierdzeniem — analiza pominięta (${interaction.user.username})`);
                    return;
                }
                throw deferError;
            }
        }

        // ModalSubmitInteraction nie ma opcji komendy — załącznik przychodzi z sesji wyboru profilu
        const image = attachment || interaction.options?.getAttachment?.('image');
        const profileIndex = getProfileIndex(playerKey);
        const profileLabel = this.profileRegistryService?.getLabel(interaction.user.id, profileIndex) || null;

        const limitCheck = await this.usageLimitService.checkAndRecord(interaction.user.id);
        if (!limitCheck.allowed) {
            await interaction.editReply({
                content: formatMessage(msgs.dailyLimitExceeded, { limit: limitCheck.limit }),
                components: []
            });
            return;
        }

        // components: [] usuwa przyciski wyboru profilu z wiadomości
        await interaction.editReply({ content: msgs.updateDownloading, components: [] });
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
        let globalPlayerCount = null;

        try {
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });

            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${image.name}`);
            await downloadFile(image.url, tempImagePath);

            await editReplyStep(msgs.updateComparingTemplate);

            const displayNameForLog = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            gl.info(`🤖 [/${commandName}] Uruchamiam analizę z weryfikacją wzorca dla ${this.logService.nickLink(displayNameForLog, interaction.user.id)}${dryRun ? ' (tryb testowy)' : ''}`);

            const onProgress = async (step) => {
                if (step === 'extracting') {
                    await editReplyStep(msgs.updateExtractingData);
                }
            };

            const onRetry = async (attempt, total, step) => {
                const msgKey = step === 'extract' ? 'updateRetryExtract' : 'updateRetryTemplate';
                const template = msgs[msgKey] || '⏳ API przeciążone — próba {attempt}/{total}...';
                const text = template.replace('{attempt}', attempt + 1).replace('{total}', total);
                await interaction.editReply({ content: text }).catch(() => {});
            };

            const guildLang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
            const aiResult = await this.aiOcrService.analyzeTestImage(tempImagePath, gl, null, guildLang, onProgress, onRetry);

            const fileExtension = image.name ? image.name.split('.').pop() : 'png';

            if (aiResult.tokenUsage && this.tokenUsageService) {
                const { promptTokens, outputTokens } = aiResult.tokenUsage;
                this.tokenUsageService.record(interaction.guildId, promptTokens, outputTokens, interaction.user.id).catch(() => {});
            }
            if (this.ocrStatsService && !dryRun) {
                const _ocrIsValid = !!aiResult.isValidVictory;
                this.ocrStatsService.record(interaction.guildId, _ocrIsValid).catch(() => {});
                if (!_ocrIsValid) {
                    this.ocrStatsService.recordRejection(interaction.guildId, interaction.user.id).catch(() => {});
                }
                if (aiResult.doubleCheckRecovered) {
                    this.ocrStatsService.recordDoubleCheckRecovered().catch(() => {});
                }
            }

            if (aiResult.error === 'NOT_SIMILAR') {
                gl.warn(`❌ [/${commandName}] Odrzucono: NOT_SIMILAR`);
                _ocrEmbedParams = { profileIndex, profileLabel, type: 'rejected', userName: displayNameForLog, userId: interaction.user.id, commandName, reason: 'NOT_SIMILAR', rejectionReason: aiResult.rejectionReason, revertComponents: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`panel_block_time_${interaction.user.id}_${interaction.guildId}`).setLabel('🔒 Zablokuj użytkownika').setStyle(ButtonStyle.Danger)).toJSON()] };
                const _notSimilarImgUrl = await this._sendInvalidScreenReport(interaction, tempImagePath, 'NOT_SIMILAR', gl, aiResult.rejectionReason, playerKey);
                if (_notSimilarImgUrl) _ocrEmbedParams.imageUrl = _notSimilarImgUrl;
                const _rejExt1 = path.extname(tempImagePath).slice(1) || 'png';
                const _rejName1 = `rejected_${Date.now()}.${_rejExt1}`;
                const notSimilarReasonText = aiResult.rejectionReason
                    || this._mapRejectionReason('NOT_SIMILAR', msgs).text;
                const notSimilarEmbeds = this.rankingService.createNoRecordEmbeds({
                    userName: displayNameForLog,
                    userAvatarUrl: interaction.user.displayAvatarURL(),
                    screenshotName: _rejName1,
                    reasonLabel: msgs.analyzeFailReasonField,
                    reasonText: notSimilarReasonText,
                    messages: msgs,
                    color1: 0xff9900,
                    color2: 0xFF0000,
                });
                await interaction.editReply({
                    content: '',
                    embeds: notSimilarEmbeds,
                    files: [new AttachmentBuilder(tempImagePath, { name: _rejName1 })],
                });
                return;
            }

            if (!aiResult.isValidVictory) {
                gl.warn(`❌ [/${commandName}] Odrzucono: ${aiResult.error || 'VALIDATION_FAILED'}`);
                _ocrEmbedParams = { profileIndex, profileLabel, type: 'rejected', userName: displayNameForLog, userId: interaction.user.id, commandName, reason: aiResult.error || 'VALIDATION_FAILED', revertComponents: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`panel_block_time_${interaction.user.id}_${interaction.guildId}`).setLabel('🔒 Zablokuj użytkownika').setStyle(ButtonStyle.Danger)).toJSON()] };
                const _validationImgUrl = await this._sendInvalidScreenReport(interaction, tempImagePath, aiResult.error, gl, null, playerKey);
                if (_validationImgUrl) _ocrEmbedParams.imageUrl = _validationImgUrl;
                const _rejExt2 = path.extname(tempImagePath).slice(1) || 'png';
                const _rejName2 = `rejected_${Date.now()}.${_rejExt2}`;
                const { text: invalidReasonText, color: invalidReasonColor } = this._mapRejectionReason(aiResult.error || 'VALIDATION_FAILED', msgs);
                const invalidEmbeds = this.rankingService.createNoRecordEmbeds({
                    userName: displayNameForLog,
                    userAvatarUrl: interaction.user.displayAvatarURL(),
                    screenshotName: _rejName2,
                    reasonLabel: msgs.analyzeFailReasonField,
                    reasonText: invalidReasonText,
                    messages: msgs,
                    color1: 0xff9900,
                    color2: invalidReasonColor,
                });
                await interaction.editReply({
                    content: '',
                    embeds: invalidEmbeds,
                    files: [new AttachmentBuilder(tempImagePath, { name: _rejName2 })],
                });
                return;
            }

            const bestScore = aiResult.score;
            const bossName = aiResult.bossName;
            gl.success(`✅ [/${commandName}] AI OCR: wynik="${bestScore}", boss="${bossName}"${aiResult.total ? `, total="${aiResult.total}"` : ''}`);

            // Nieznana nazwa bossa — alert dla admina na kanał logów
            let unknownBossSessionKey = null;
            if (aiResult.wasUnknownBoss && this.bossAliasService) {
                unknownBossSessionKey = await this._sendUnknownBossEmbed(interaction.client, interaction.guildId, {
                    rawBoss: aiResult.rawBossName || bossName,
                    userName: interaction.member?.displayName || interaction.user.displayName || interaction.user.username,
                    userId: interaction.user.id,
                    userAvatarUrl: interaction.user.displayAvatarURL(),
                    imagePath: tempImagePath,
                    imageExt: path.extname(tempImagePath).slice(1) || 'png',
                    commandName,
                    guild: interaction.guild,
                }).catch(err => { gl.warn(`[BossAlias] Błąd wysyłania embeda nieznanego bossa: ${err.message}`); return null; });
            }

            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

            // ⚔️ Wyzwania — wynik zaliczany PRZED rozgałęzieniem na ścieżki (duplikat cross-server /
            // brak rekordu / nowy rekord), żeby liczył się każdy pozytywnie zweryfikowany screen.
            // /test (dryRun) nie zalicza niczego. Nierozpoznana nazwa bossa nie jest zaliczana od razu —
            // wynik czeka na zmapowanie aliasu przez admina (_resolveChallengePendingBoss).
            const _challengeResult = dryRun ? { notices: [], pending: false } : await this._registerChallengeScore(interaction, {
                playerKey,
                bossName,
                score: bestScore,
                scoreValue: this.rankingService.parseScoreValue(bestScore),
                guildId,
                timestamp: new Date().toISOString(),
                wasUnknownBoss: aiResult.wasUnknownBoss === true,
            });
            const _challengeNotice = this._challengeSystemNotice(_challengeResult, msgs);

            // Stan globalny przed zapisem — liczony też w /test (dryRun), żeby podgląd był identyczny jak /update (read-only)
            const prevGlobalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
            const prevGlobalPosition = (() => { const i = prevGlobalRanking?.findIndex(p => (p.playerKey || p.userId) === playerKey); return i !== -1 ? i + 1 : null; })();

            // Dane cross-server — obliczane raz, używane przy sprawdzeniu duplikatu i przy embeddzie rekordu
            const _newScoreValue = this.rankingService.parseScoreValue(bestScore);
            const _prevGlobalUser = prevGlobalRanking?.find(p => (p.playerKey || p.userId) === playerKey) || null;

            // Duplikat cross-server: gracz ma już lepszy wynik na innym serwerze — nie zapisuj do rankingu globalnego.
            // Dokładne wyrównanie (===) NIE wchodzi w ten blok — trafia do normalnego flow niżej i jest traktowane
            // jako migracja wpisu (usunięcie z poprzedniego serwera, zapis na nowym).
            if (_prevGlobalUser && _prevGlobalUser.scoreValue > _newScoreValue && _prevGlobalUser.sourceGuildId !== guildId) {
                const sourceGuildId = _prevGlobalUser.sourceGuildId;
                const sourceGuildName = interaction.client.guilds.cache.get(sourceGuildId)?.name || sourceGuildId;

                // Mimo duplikatu globalnego — sprawdź czy pobito rekord na bossie (globalnie, po wszystkich serwerach)
                let csBossIsNew = false;
                let csPrevBossRecord = null; // globalny poprzedni rekord bossa (do wyświetlenia "stary ➜ nowy")
                if (bossName && this.bossRecordService) {
                    try {
                        const allGuildIdsCs = this.guildConfigService?.getAllConfiguredGuildIds()
                            || Array.from(interaction.client.guilds.cache.keys());
                        const userBossAll = await this.bossRecordService.getUserBossRecordsAllGuilds(allGuildIdsCs, playerKey);
                        const prevBoss = userBossAll?.[bossName] || null;
                        const prevBossVal = prevBoss && typeof prevBoss.scoreValue === 'number' ? prevBoss.scoreValue : -Infinity;
                        if (_newScoreValue > prevBossVal) {
                            csBossIsNew = true;
                            csPrevBossRecord = prevBoss
                                ? { score: prevBoss.score, scoreValue: prevBoss.scoreValue, timestamp: prevBoss.timestamp, username: prevBoss.username }
                                : null;
                        }
                    } catch (csBossErr) {
                        gl.warn(`⚠️ [cross-server] Błąd sprawdzania rekordu bossa: ${csBossErr.message}`);
                    }
                }

                // === Przypadek: pobito rekord bossa mimo duplikatu globalnego ===
                // Zapis trafia na POPRZEDNI serwer gracza (dane nie przenoszą się na nowy serwer); publikujemy ogłoszenie.
                if (csBossIsNew) {
                    const wasUnknownBossCs = aiResult.wasUnknownBoss === true;
                    const bossTs = new Date().toISOString();
                    const bossScoreValue = _newScoreValue;

                    // Zapis rekordu bossa na poprzednim serwerze; previousBossRecord (serwera A) → potrzebny do poprawnego cofnięcia
                    // /test (dryRun): pomijamy zapis (podgląd bez modyfikacji danych)
                    let csServerAPrevBoss = null;
                    if (!dryRun) {
                        try {
                            const res = await this.bossRecordService.updateBossRecord(
                                sourceGuildId, playerKey, bossName, userName, bestScore, bossScoreValue, bossTs
                            );
                            csServerAPrevBoss = res.previousBossRecord;
                        } catch (saveErr) {
                            gl.error(`Błąd zapisu rekordu bossa (cross-server): ${saveErr.message}`);
                        }
                    }

                    // Achievementy rekordu bossa — na poprzednim serwerze (tam są dane gracza); /test = preview bez zapisu
                    let csAchievements = [];
                    if (this.achievementService) {
                        try {
                            const _csAchConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                            const _csAchActiveGuildIds = new Set(_csAchConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                            const _csAchGlobalRanking = await this.rankingService.getGlobalRanking(_csAchActiveGuildIds);
                            const _csAchGlobalIdx = _csAchGlobalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                            const csGlobalPosForAch = _csAchGlobalIdx !== -1 ? _csAchGlobalIdx + 1 : 0;
                            csAchievements = await this.achievementService.processSubmission(sourceGuildId, playerKey, {
                                scoreValue: bossScoreValue,
                                bossName,
                                isNewRecord: false,
                                prevScoreValue: csPrevBossRecord ? csPrevBossRecord.scoreValue : 0,
                                currentPosition: 0,
                                globalPosition: csGlobalPosForAch,
                            }, { preview: dryRun });
                        } catch {}
                    }
                    const langCs = this.config.getGuildConfig(guildId)?.lang || 'pol';
                    const csAchVal = this.achievementService
                        ? this.achievementService.buildNewAchievementsFieldValue(csAchievements, langCs)
                        : null;

                    // Snippet rankingu bossa + ikona bossa (tylko boss znany)
                    let csBossSnippet = null;
                    let csBossImageName = null;
                    let csBossImageAttachment = null;
                    if (!wasUnknownBossCs) {
                        try {
                            const allGuildIdsCs2 = this.guildConfigService?.getAllConfiguredGuildIds()
                                || Array.from(interaction.client.guilds.cache.keys());
                            // /test (dryRun): symulowany ranking bossa (nowy wynik nałożony bez zapisu); inaczej realny stan po zapisie
                            const bossRankingCs = dryRun
                                ? await this.bossRecordService.simulateGlobalBossRanking(allGuildIdsCs2, bossName, playerKey, bossScoreValue, bestScore, userName, sourceGuildId)
                                : await this.bossRecordService.getGlobalBossRanking(allGuildIdsCs2, bossName);
                            const newBossIdxCs = bossRankingCs.findIndex(p => (p.playerKey || p.userId) === playerKey);
                            if (newBossIdxCs !== -1 && this.globalTop10Service) {
                                let prevBossPosCs = null;
                                if (csPrevBossRecord) {
                                    const prevValCs = csPrevBossRecord.scoreValue;
                                    const tempCs = bossRankingCs.map(p => (p.playerKey || p.userId) === playerKey ? { ...p, scoreValue: prevValCs } : p);
                                    tempCs.sort(compareByScoreThenTimestamp);
                                    const prevIdxCs = tempCs.findIndex(p => (p.playerKey || p.userId) === playerKey);
                                    prevBossPosCs = prevIdxCs !== -1 ? prevIdxCs + 1 : null;
                                }
                                csBossSnippet = await this.globalTop10Service.buildBossSnippetFieldData(
                                    playerKey, bossRankingCs, prevBossPosCs, bossName, msgs, interaction.client
                                );
                            }
                        } catch { /* snippet opcjonalny */ }

                        if (this.bossAliasService) {
                            try {
                                const imgPath = this.bossAliasService.getBossImagePath(bossName);
                                if (imgPath) {
                                    const buf = await fs.readFile(path.join(__dirname, '../data/boss_images', imgPath));
                                    csBossImageName = imgPath;
                                    csBossImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                                }
                            } catch { /* bez ikony bossa */ }
                        }
                    }

                    // Komunikaty systemowe (Embed 4): dane pozostają na poprzednim serwerze + ew. nieznany boss
                    const csSystemNotices = [{
                        name: msgs.crossServerBossKeptField,
                        value: formatMessage(msgs.crossServerBossKeptValue, { score: _prevGlobalUser.score, guildName: sourceGuildName }),
                    }];
                    if (wasUnknownBossCs) {
                        const noticeVal = formatMessage(
                            msgs.unknownBossRankingNotice || 'Wykryto nową nazwę bossa: *{bossName}*\nWynik nie pojawi się w rankingu bossów do czasu weryfikacji przez admina.',
                            { bossName }
                        );
                        csSystemNotices.push({ name: msgs.unknownBossRankingField || '⚠️ Unverified Boss Name', value: noticeVal });
                    }
                    // ⚔️ Wyzwanie — informacja o zaliczeniu wyniku (Embed 4)
                    if (_challengeNotice) csSystemNotices.push(_challengeNotice);

                    const safeUserNameCs = userName.replace(/[^a-zA-Z0-9]/g, '_');
                    const imageAttachmentCs = new AttachmentBuilder(tempImagePath, { name: `rekord_${safeUserNameCs}_${Date.now()}.${fileExtension}` });

                    // Pozycja w rankingu bossa na serwerze, na którym wynik faktycznie leży (poprzedni serwer gracza)
                    const csBossServerPosition = wasUnknownBossCs ? null : await this._buildBossServerPosition(
                        sourceGuildId, bossName, playerKey,
                        { dryRun, scoreValue: bossScoreValue, score: bestScore, username: userName }
                    );

                    const _botUserCs = interaction.client.user;
                    const csEmbeds = await this.rankingService.createRecordEmbeds({
                        userName,
                        bestScore,
                        userAvatarUrl: interaction.user.displayAvatarURL(),
                        screenshotName: imageAttachmentCs.name,
                        previousScore: null,
                        userId: null,            // brak pozycji w klanie (dane na poprzednim serwerze)
                        playerKey: null,
                        profileIndex,
                        profileLabel,
                        guildId: null,
                        messages: msgs,
                        guild: interaction.guild,
                        achievementsFieldValue: csAchVal,
                        globalSnippetData: null, // brak Embedu 2 (ranking globalny niezmieniony)
                        bossRecordData: { isNewBossRecord: true, previousBossRecord: csPrevBossRecord, bossName },
                        bossSnippetData: csBossSnippet,
                        bossServerPosition: csBossServerPosition,
                        bossName,
                        botName: _botUserCs?.username || null,
                        botIconUrl: _botUserCs?.displayAvatarURL() || null,
                        bossImageName: csBossImageName,
                        systemNotices: csSystemNotices,
                    });
                    const csFiles = [imageAttachmentCs];
                    if (csBossImageAttachment) csFiles.push(csBossImageAttachment);

                    // /test (dryRun): podgląd ephemeral, bez publicznego ogłoszenia i bez sesji cofnięcia
                    if (dryRun) {
                        _ocrEmbedParams = { profileIndex, profileLabel, type: 'test_boss_record', userName, userId, score: bestScore, bossName, commandName, previousScore: csPrevBossRecord?.score };
                        await interaction.editReply({ embeds: csEmbeds, files: csFiles });
                        gl.info(`🧪 [/test] Podgląd: duplikat globalny cross-server + rekord bossa "${bossName}" (bez zapisu)`);
                        return;
                    }

                    await interaction.editReply({ content: msgs.bossRecordOnlyConfirmed || '✅ Nowy rekord na bossie ogłoszony!' });
                    const csPublicMsg = await interaction.followUp({ embeds: csEmbeds, files: csFiles });
                    this._addRecordAutoReaction(csPublicMsg, guildId);

                    // Sesja cofnięcia rekordu bossa — dane zapisano na POPRZEDNIM serwerze gracza,
                    // więc cofnięcie musi celować w niego (guildId: sourceGuildId), a globalny ranking zostaje nietknięty
                    await this._registerRecordAnnouncement(interaction, csPublicMsg, {
                        guildId: sourceGuildId,
                        playerKey,
                        previousRecord: null,
                        newRecord: { score: bestScore, bossName, timestamp: bossTs },
                        previousBossRecord: csServerAPrevBoss ?? null,
                        bossName: bossName || null,
                        skipGlobalRevert: true,
                        cvEnabled: false,   // CV nie obejmuje ogłoszeń cross-server
                    });

                    _ocrEmbedParams = {
                        profileIndex, profileLabel, type: 'boss_record', userName, userId,
                        score: bestScore, bossName, commandName,
                        previousScore: csPrevBossRecord?.score,
                        revertComponents: this._buildAdminRevertRow(csPublicMsg?.id, playerKey, sourceGuildId),
                        onSent: this._adminMsgTracker(csPublicMsg?.id),
                    };
                    gl.info(`🎯 [/${commandName}] Duplikat globalny cross-server, ale pobito rekord bossa "${bossName}" — zapis na serwerze "${sourceGuildName}"`);
                    return;
                }

                // === Brak rekordu bossa — standardowy komunikat duplikatu cross-server (bez zapisu) ===
                const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                const imageAttachment = new AttachmentBuilder(tempImagePath, {
                    name: `wynik_${safeUserName}_${Date.now()}.${fileExtension}`
                });
                const crossServerReasonLines = [];
                if (bossName) crossServerReasonLines.push(`\`${bossName}\``);
                crossServerReasonLines.push(formatMessage(msgs.resultNotBeatenCrossServer, { score: _prevGlobalUser.score, guildName: sourceGuildName }));
                const crossServerEmbeds = this.rankingService.createNoRecordEmbeds({
                    userName,
                    userAvatarUrl: interaction.user.displayAvatarURL(),
                    screenshotName: imageAttachment.name,
                    reasonLabel: msgs.resultDetailsField,
                    reasonText: crossServerReasonLines.join('\n'),
                    messages: msgs,
                });
                await interaction.editReply({ embeds: crossServerEmbeds, files: [imageAttachment] });
                _ocrEmbedParams = { profileIndex, profileLabel, type: 'cross_server', userName, userId, score: bestScore, bossName, commandName, previousScore: _prevGlobalUser.score };
                gl.info(`✅ ${this.logService.nickLink(userName, userId)} Duplikat cross-server (nie zapisano) — serwer: "${sourceGuildName}"`);
                return;
            }

            // Zapamiętaj poprzedni rekord przed nadpisaniem (potrzebne do community verification)
            const previousRecordSnapshot = dryRun ? null : await this.rankingService.getUserRecord(guildId, playerKey);

            // Dokładne wyrównanie globalnego wyniku z innego serwera — wpis migruje z poprzedniego serwera na ten
            const isCrossServerTieMigration = !!(_prevGlobalUser && _prevGlobalUser.scoreValue === _newScoreValue && _prevGlobalUser.sourceGuildId !== guildId);

            let isNewRecord;
            let currentScore;
            let newRecordTimestamp = null;
            let affectedGuildIds = [];
            if (dryRun) {
                // Tryb testowy: porównanie bez zapisu do rankingu.
                const ranking = await this.rankingService.loadRanking(guildId);
                currentScore = ranking[playerKey] || null;
                const newScoreValue = this.rankingService.parseScoreValue(bestScore);
                if (!currentScore) {
                    isNewRecord = true;
                } else {
                    const currentScoreValue = this.rankingService.parseScoreValue(currentScore.score);
                    isNewRecord = newScoreValue > currentScoreValue;
                }
            } else {
                await editReplyStep(msgs.updateSaving);
                ({ isNewRecord, currentScore, newTimestamp: newRecordTimestamp, affectedGuildIds } = await this.rankingService.updateUserRanking(
                    guildId, playerKey, userName, bestScore, bossName, profileLabel
                ));
                await this.logService.logScoreUpdate(userName, bestScore, isNewRecord, guildId);
                if (isNewRecord && this.milestoneService) this.milestoneService.checkAndAnnounce();
                // Migracja wpisu: przy dokładnym wyrównaniu wyniku _removeWeakerScoresFromOtherGuilds (porównanie "<")
                // nie usuwa wpisu na poprzednim serwerze — trzeba to zrobić jawnie.
                if (isCrossServerTieMigration && isNewRecord) {
                    try {
                        await this.rankingService.removePlayerFromRanking(playerKey, _prevGlobalUser.sourceGuildId);
                        if (!affectedGuildIds.includes(_prevGlobalUser.sourceGuildId)) affectedGuildIds.push(_prevGlobalUser.sourceGuildId);
                        gl.info(`🔁 Migracja wyniku gracza "${userName}" — usunięto wpis z poprzedniego serwera po wyrównaniu wyniku`);
                    } catch (migrateErr) {
                        gl.warn(`⚠️ Błąd migracji wpisu cross-server: ${migrateErr.message}`);
                    }
                }
                // Aktualizuj panel Centrum Dowodzenia po każdym zapisie (nowy rekord lub nie)
                if (this.adminPanelService) {
                    this.adminPanelService.setLastRecord(userName, bestScore, bossName, guildId);
                    this.adminPanelService.refresh();
                }
                // TOP 10 na stronie — wysyłka tylko gdy czołówka serwera faktycznie się zmieniła.
                // Razem z bieżącym serwerem lecą te z `affectedGuildIds`: pobicie rekordu kasuje
                // słabszy wpis gracza na pozostałych serwerach, a bez ich odświeżenia ten sam
                // gracz zostaje na stronie w dwóch rankingach naraz.
                this.webRankingSyncService?.syncGuilds([guildId, ...affectedGuildIds], interaction.client).catch(() => {});
            }

            // Per-boss rekord (zawsze po pozytywnym OCR, niezależnie od isNewRecord)
            let isNewBossRecord = false;
            let previousBossRecord = null;
            if (!dryRun && bossName && this.bossRecordService) {
                const bossTs = newRecordTimestamp || new Date().toISOString();
                const bossScoreValue = this.rankingService.parseScoreValue(bestScore);
                try {
                    const bossResult = await this.bossRecordService.updateBossRecord(
                        guildId, playerKey, bossName, userName, bestScore, bossScoreValue, bossTs
                    );
                    isNewBossRecord = bossResult.isNewBossRecord;
                    previousBossRecord = bossResult.previousBossRecord;
                } catch (bossErr) {
                    gl.error(`Błąd zapisu per-boss rekordu: ${bossErr.message}`);
                }
            } else if (dryRun && bossName && this.bossRecordService) {
                // dryRun (/test): read-only — czy boss rekord byłby pobity + poprzedni rekord (bez zapisu)
                try {
                    const bossScoreValue = this.rankingService.parseScoreValue(bestScore);
                    isNewBossRecord = await this.bossRecordService.wouldBeatBossRecord(guildId, playerKey, bossName, bossScoreValue);
                    const userBoss = await this.bossRecordService.getUserBossRecords(guildId, playerKey);
                    previousBossRecord = userBoss?.[bossName] ? { ...userBoss[bossName] } : null;
                } catch { /* ignoruj */ }
            }

            // Pozycja po zapisie (potrzebna do osiągnięć i do embeda); /test = symulacja + preview bez zapisu
            let newAchievements = [];
            let currentPositionForAch = 0;
            if (isNewRecord && this.achievementService) {
                try {
                    const sortedAfter = dryRun
                        ? await this.rankingService.simulateSortedPlayers(guildId, playerKey, userName, bestScore)
                        : await this.rankingService.getSortedPlayers(guildId);
                    currentPositionForAch = sortedAfter.findIndex(p => (p.playerKey || p.userId) === playerKey) + 1;
                    const prevScoreValue = currentScore ? this.rankingService.parseScoreValue(currentScore.score) : 0;
                    const newScoreValue = this.rankingService.parseScoreValue(bestScore);
                    const _achConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                    const _achActiveGuildIds = new Set(_achConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                    const _achGlobalRanking = dryRun
                        ? await this.rankingService.simulateGlobalRanking(_achActiveGuildIds, playerKey, userName, bestScore, guildId)
                        : await this.rankingService.getGlobalRanking(_achActiveGuildIds);
                    const _achGlobalIdx = _achGlobalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                    const globalPositionForAch = _achGlobalIdx !== -1 ? _achGlobalIdx + 1 : 0;
                    newAchievements = await this.achievementService.processSubmission(guildId, playerKey, {
                        scoreValue: newScoreValue,
                        bossName,
                        isNewRecord: true,
                        prevScoreValue,
                        currentPosition: currentPositionForAch,
                        globalPosition: globalPositionForAch,
                    }, { preview: dryRun });
                } catch {}
            }

            if (!isNewRecord && !dryRun && this.achievementService) {
                this.achievementService.trackNonRecord(guildId, userId).catch(() => {});
            }

            const wasUnknownBoss = aiResult.wasUnknownBoss === true;

            // Odrzuć tylko gdy: boss rozpoznany + brak rekordu globalnego + brak rekordu per-boss
            if (!isNewRecord && !wasUnknownBoss && !isNewBossRecord) {
                _ocrEmbedParams = { profileIndex, profileLabel, type: dryRun ? 'test_no_record' : 'no_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
                try {
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');

                    const fsSync = require('fs');
                    const fileStats = fsSync.statSync(tempImagePath);
                    gl.info(`📁 Plik do załączenia - rozmiar: ${(fileStats.size / (1024 * 1024)).toFixed(2)}MB`);

                    const imageAttachment = new AttachmentBuilder(tempImagePath, {
                        name: `wynik_${safeUserName}_${Date.now()}.${fileExtension}`
                    });

                    const currentScoreValue = this.rankingService.parseScoreValue(currentScore.score);
                    const newScoreValueForDiff = this.rankingService.parseScoreValue(bestScore);
                    const diffText = this.rankingService.formatScore(Math.abs(currentScoreValue - newScoreValueForDiff));
                    const noRecordReasonLines = [];
                    if (bossName) noRecordReasonLines.push(`\`${bossName}\``);
                    noRecordReasonLines.push(formatMessage(msgs.resultNotBeaten, { currentScore: currentScore.score }));
                    // Rekord tego bossa. Linia wyżej pokazuje rekord OGÓLNY gracza (może być
                    // z zupełnie innego bossa), więc bez tego wrzucenie tego samego wyniku
                    // wygląda, jakby dla tego bossa nic nie było jeszcze zapisane.
                    if (bossName && previousBossRecord) {
                        const bossRecordScore = previousBossRecord.score
                            || this.rankingService.formatScore(previousBossRecord.scoreValue);
                        const sameAsBossRecord = previousBossRecord.scoreValue === newScoreValueForDiff;
                        noRecordReasonLines.push(formatMessage(
                            sameAsBossRecord ? msgs.resultBossRecordSame : msgs.resultBossRecordCurrent,
                            { score: bossRecordScore, date: this._discordTs(previousBossRecord.timestamp, 'D') }
                        ));
                    }
                    noRecordReasonLines.push(formatMessage(msgs.resultDifference, { diff: diffText }));
                    // ⚔️ Wyzwanie — ani rekord ogólny, ani rekord bossa nie padł, więc nie ma
                    // publicznego ogłoszenia; informacja idzie do embeda odpowiedzi ORAZ na priv
                    if (_challengeNotice) {
                        noRecordReasonLines.push('');
                        noRecordReasonLines.push(`**${_challengeNotice.name}**`);
                        noRecordReasonLines.push(_challengeNotice.value);
                        this._sendChallengeScoreDm(interaction.client, userId, guildId, _challengeResult).catch(() => {});
                    }

                    const resultEmbeds = this.rankingService.createNoRecordEmbeds({
                        userName,
                        userAvatarUrl: interaction.user.displayAvatarURL(),
                        screenshotName: imageAttachment.name,
                        reasonLabel: msgs.resultDetailsField,
                        reasonText: noRecordReasonLines.join('\n'),
                        messages: msgs,
                    });

                    try {
                        await interaction.editReply({ embeds: resultEmbeds, files: [imageAttachment] });
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

            // Akceptacja bez pobicia rekordu globalnego:
            // (A) boss nierozpoznany bez poprawy rekordu bossa → reply-only, żółty embed
            // (B) pobito rekord bossa → publiczne ogłoszenie turkusowe
            if (!isNewRecord) {
                const safeUserNameAlt = userName.replace(/[^a-zA-Z0-9]/g, '_');
                const imageAttachmentAlt = new AttachmentBuilder(tempImagePath, {
                    name: `wynik_${safeUserNameAlt}_${Date.now()}.${fileExtension}`
                });

                if (!isNewBossRecord) {
                    // Case A: boss nierozpoznany, brak poprawy rekordu bossa — reply only, żółty warning
                    const statusVal = msgs.unknownBossAccepted || '⚠️ Wynik zapamiętany — nazwa bossa nierozpoznana. Po weryfikacji przez admina wpis zostanie zaktualizowany lub usunięty z rankingu.';
                    const unknownBossReasonLines = [];
                    if (bossName) unknownBossReasonLines.push(`\`${bossName}\``);
                    unknownBossReasonLines.push(`**${msgs.resultScore}:** ${bestScore}`);
                    unknownBossReasonLines.push(statusVal);
                    // ⚔️ Wyzwanie — brak publicznego ogłoszenia, więc informacja też na priv
                    if (_challengeNotice) {
                        unknownBossReasonLines.push('');
                        unknownBossReasonLines.push(`**${_challengeNotice.name}**`);
                        unknownBossReasonLines.push(_challengeNotice.value);
                        this._sendChallengeScoreDm(interaction.client, userId, guildId, _challengeResult).catch(() => {});
                    }
                    const warnEmbeds = this.rankingService.createNoRecordEmbeds({
                        userName,
                        userAvatarUrl: interaction.user.displayAvatarURL(),
                        screenshotName: imageAttachmentAlt.name,
                        reasonLabel: msgs.resultDetailsField,
                        reasonText: unknownBossReasonLines.join('\n'),
                        messages: msgs,
                        color1: 0xFEE75C,
                    });
                    _ocrEmbedParams = { profileIndex, profileLabel, type: 'no_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
                    gl.info(`⚠️ [/${commandName}] Wynik zaakceptowany z nierozpoznanym bossem (bez poprawy rekordu): "${bossName || '???'}"`);
                    await interaction.editReply({ embeds: warnEmbeds, files: [imageAttachmentAlt] });
                    return;
                }

                // Case B: pobito rekord bossa (isNewBossRecord = true)
                // Achievementy dla rekordu bossa; /test = preview bez zapisu
                if (this.achievementService) {
                    try {
                        const bossScoreVal = this.rankingService.parseScoreValue(bestScore);
                        const _bossAchConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                        const _bossAchActiveGuildIds = new Set(_bossAchConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                        const _bossAchGlobalRanking = await this.rankingService.getGlobalRanking(_bossAchActiveGuildIds);
                        const _bossAchGlobalIdx = _bossAchGlobalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                        const bossGlobalPositionForAch = _bossAchGlobalIdx !== -1 ? _bossAchGlobalIdx + 1 : 0;
                        newAchievements = await this.achievementService.processSubmission(guildId, playerKey, {
                            scoreValue: bossScoreVal,
                            bossName,
                            isNewRecord: false,
                            prevScoreValue: previousBossRecord ? this.rankingService.parseScoreValue(previousBossRecord.score) : 0,
                            currentPosition: 0,
                            globalPosition: bossGlobalPositionForAch,
                        }, { preview: dryRun });
                    } catch {}
                }

                const guildConfigBoss = this.config.getGuildConfig(interaction.guildId);
                const langBoss = guildConfigBoss?.lang || 'pol';
                const bossAchievementsVal = this.achievementService
                    ? this.achievementService.buildNewAchievementsFieldValue(newAchievements, langBoss)
                    : null;

                // Oblicz pozycję w rankingu bossa + snippet (jedno zapytanie do bossRecordService)
                // Pomijamy dla nieznanego bossa — wynik jeszcze nie trafia do rankingu publicznego
                let bossRankingOverride = null;
                let bossSnippetDataLocal = null;
                if (!wasUnknownBoss) try {
                    const allGuildIdsForBoss = this.guildConfigService?.getAllConfiguredGuildIds()
                        || Array.from(interaction.client.guilds.cache.keys());
                    // /test (dryRun): symulowany ranking bossa (nowy wynik bez zapisu); inaczej realny stan po zapisie
                    const bossRanking = dryRun
                        ? await this.bossRecordService.simulateGlobalBossRanking(allGuildIdsForBoss, bossName, playerKey, this.rankingService.parseScoreValue(bestScore), bestScore, userName, guildId)
                        : await this.bossRecordService.getGlobalBossRanking(allGuildIdsForBoss, bossName);
                    const newBossIdx = bossRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                    if (newBossIdx !== -1) {
                        const newBossPosition = newBossIdx + 1;
                        let bossPositionChange = 0;
                        let bossIsNewEntry = false;
                        let prevBossPosition = null;
                        if (!previousBossRecord) {
                            bossIsNewEntry = true;
                        } else {
                            const prevBossScoreValue = this.rankingService.parseScoreValue(previousBossRecord.score);
                            const tempRanking = bossRanking.map(p =>
                                (p.playerKey || p.userId) === playerKey ? { ...p, scoreValue: prevBossScoreValue } : p
                            );
                            tempRanking.sort(compareByScoreThenTimestamp);
                            const prevBossIdx = tempRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                            bossPositionChange = (prevBossIdx + 1) - newBossPosition;
                            prevBossPosition = prevBossIdx !== -1 ? prevBossIdx + 1 : null;
                        }
                        bossRankingOverride = {
                            position: newBossPosition,
                            positionChange: bossPositionChange,
                            isNewEntry: bossIsNewEntry,
                            label: msgs.recordBossRanking || '🎯 Pozycja (boss)',
                        };
                        if (this.globalTop10Service) {
                            bossSnippetDataLocal = await this.globalTop10Service.buildBossSnippetFieldData(
                                playerKey, bossRanking, prevBossPosition, bossName, msgs, interaction.client
                            );
                        }
                    }
                } catch { /* pozycja opcjonalna */ }

                // Stos embedów — bez Embedu 2 (globalny ranking niezmieniony): Embed 1 (gratulacje + achievementy),
                // Embed 3 (rekord na bossie + snippet + ikona bossa), Embed 4 (komunikaty systemowe + screenshot)
                const bossSystemNotices = [];
                if (wasUnknownBoss) {
                    const noticeVal = formatMessage(
                        msgs.unknownBossRankingNotice || 'Wykryto nową nazwę bossa: *{bossName}*\nWynik nie pojawi się w rankingu bossów do czasu weryfikacji przez admina.',
                        { bossName }
                    );
                    bossSystemNotices.push({ name: msgs.unknownBossRankingField || 'Unverified Boss Name', value: noticeVal });
                }
                // ⚔️ Wyzwanie — informacja o zaliczeniu wyniku (Embed 4)
                if (_challengeNotice) bossSystemNotices.push(_challengeNotice);

                // Ikona bossa (Embed 3) — gdy boss znany
                let bossOnlyImageAttachment = null;
                let bossOnlyImageName = null;
                if (!wasUnknownBoss && this.bossAliasService) {
                    try {
                        const imgPath = this.bossAliasService.getBossImagePath(bossName);
                        if (imgPath) {
                            const buf = await fs.readFile(path.join(__dirname, '../data/boss_images', imgPath));
                            bossOnlyImageName = imgPath;
                            bossOnlyImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                        }
                    } catch { /* bez ikony bossa */ }
                }

                // Pozycja w rankingu bossa NA SERWERZE (Embed 1)
                const bossOnlyServerPosition = wasUnknownBoss ? null : await this._buildBossServerPosition(
                    guildId, bossName, playerKey,
                    { dryRun, scoreValue: this.rankingService.parseScoreValue(bestScore), score: bestScore, username: userName }
                );

                const _botUserBoss = interaction.client.user;
                const bossPublicEmbeds = await this.rankingService.createRecordEmbeds({
                    userName,
                    bestScore,
                    userAvatarUrl: interaction.user.displayAvatarURL(),
                    screenshotName: imageAttachmentAlt.name,
                    previousScore: null,
                    userId: null,            // brak pozycji w klanie (rekord globalny niezmieniony)
                    playerKey: null,
                    profileIndex,
                    profileLabel,
                    guildId: null,
                    messages: msgs,
                    guild: interaction.guild,
                    achievementsFieldValue: bossAchievementsVal,
                    globalSnippetData: null, // brak Embedu 2
                    bossRecordData: { isNewBossRecord: true, previousBossRecord, bossName },
                    bossSnippetData: bossSnippetDataLocal,
                    bossServerPosition: bossOnlyServerPosition,
                    bossName,
                    botName: _botUserBoss?.username || null,
                    botIconUrl: _botUserBoss?.displayAvatarURL() || null,
                    bossImageName: bossOnlyImageName,
                    systemNotices: bossSystemNotices,
                });

                const bossPublicFiles = [imageAttachmentAlt];
                if (bossOnlyImageAttachment) bossPublicFiles.push(bossOnlyImageAttachment);

                gl.info(`🎯 [/${commandName}] Pobito rekord na bossie "${bossName}"${wasUnknownBoss ? ' (nieznany boss)' : ''} (rekord globalny bez zmian)`);

                if (dryRun) {
                    _ocrEmbedParams = { profileIndex, profileLabel, type: 'test_boss_record', userName, userId, score: bestScore, bossName, commandName, previousScore: previousBossRecord?.score };
                    await interaction.editReply({ embeds: bossPublicEmbeds, files: bossPublicFiles });
                    return;
                }

                await interaction.editReply({ content: msgs.bossRecordOnlyConfirmed || '✅ Nowy rekord na bossie ogłoszony!' });

                // Sprawdź czy community verification włączona
                const cvCfgBoss = this.guildConfigService?.getCommunityVerification(guildId);
                const cvEnabledBoss = !!(cvCfgBoss?.enabled === true && this.communityVerificationService);
                // Wspólny timestamp dla sesji CV i sesji cofnięcia — obie muszą wskazywać ten sam moment
                const bossAnnounceTs = new Date().toISOString();

                const bossPublicMsg = await interaction.followUp({ embeds: bossPublicEmbeds, files: bossPublicFiles });
                this._addRecordAutoReaction(bossPublicMsg, guildId);

                // Aktualizuj sesję nieznanego bossa z ID ogłoszenia
                if (unknownBossSessionKey && bossPublicMsg) {
                    const _ubSess = this._unknownBossEmbeds.get(unknownBossSessionKey);
                    if (_ubSess) { _ubSess.publicMsgId = bossPublicMsg.id; _ubSess.publicChannelId = bossPublicMsg.channelId; }
                }

                // CV: przycisk Zgłoś + sesja weryfikacji (usuwa tylko rekord bossa, nie globalny)
                if (cvEnabledBoss && bossPublicMsg) {
                    try {
                        const expired = await this.communityVerificationService.expireUserSessions(playerKey, guildId);
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

                        const bossMsgUrl = `https://discord.com/channels/${guildId}/${bossPublicMsg.channelId}/${bossPublicMsg.id}`;
                        await this.communityVerificationService.createSession({
                            guildId,
                            userId,
                            playerKey,
                            messageId: bossPublicMsg.id,
                            channelId: bossPublicMsg.channelId,
                            messageUrl: bossMsgUrl,
                            previousRecord: null,        // globalny ranking niezmieniony
                            skipGlobalRevert: true,      // przy cofnięciu nie ruszaj globalnego rankingu
                            newRecord: { score: bestScore, bossName, timestamp: bossAnnounceTs },
                            newAchievements,
                            previousBossRecord: previousBossRecord ?? null,
                        });
                        gl.info(`🔍 CV sesja (boss record) utworzona dla ${userName} — boss: "${bossName}"`);
                    } catch (cvBossErr) {
                        gl.warn(`⚠️ community verification (boss record) session error: ${cvBossErr.message}`);
                    }
                }

                // Sesja cofnięcia (przycisk gracza pod ogłoszeniem + przycisk admina w logu OCR).
                // Globalny ranking niezmieniony → skipGlobalRevert.
                await this._registerRecordAnnouncement(interaction, bossPublicMsg, {
                    guildId,
                    playerKey,
                    previousRecord: null,
                    newRecord: { score: bestScore, bossName, timestamp: bossAnnounceTs },
                    previousBossRecord: previousBossRecord ?? null,
                    bossName: bossName || null,
                    skipGlobalRevert: true,
                    cvEnabled: cvEnabledBoss,
                });

                _ocrEmbedParams = {
                    profileIndex, profileLabel,
                    type: 'boss_record',
                    userName, userId, score: bestScore, bossName, commandName,
                    previousScore: previousBossRecord?.score,
                    revertComponents: this._buildAdminRevertRow(bossPublicMsg?.id, playerKey, guildId),
                    onSent: this._adminMsgTracker(bossPublicMsg?.id),
                };

                return;
            }

            // Nowy rekord — publiczne ogłoszenie
            const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
            const imageAttachment = new AttachmentBuilder(tempImagePath, {
                name: `rekord_${safeUserName}_${Date.now()}.${fileExtension}`
            });

            const guildConfig = this.config.getGuildConfig(interaction.guildId);
            const rolePositions = await this._computeRolePositions(guildId, playerKey, interaction.guild, interaction.member?.roles?.cache);
            const lang = guildConfig?.lang || 'pol';
            const achievementsFieldValue = this.achievementService
                ? this.achievementService.buildNewAchievementsFieldValue(newAchievements, lang)
                : null;

            // Snippet globalny — dla wszystkich graczy u których zmieniła się pozycja; /test = symulacja bez zapisu
            let globalSnippetData = null;
            try {
                const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                const activeGuildIds = configuredIds.filter(gid => interaction.client.guilds.cache.has(gid));
                const newGlobalRanking = dryRun
                    ? await this.rankingService.simulateGlobalRanking(new Set(activeGuildIds), playerKey, userName, bestScore, guildId)
                    : await this.rankingService.getGlobalRanking(new Set(activeGuildIds));
                // Licznik w stopce zawsze z REALNEGO rankingu — przy /test symulacja dokłada gracza,
                // który nie jest jeszcze w rankingu, i stopka pokazywała N+1.
                // Liczymy OSOBY, nie wpisy: `newGlobalRanking` zawiera profile, więc gracz
                // z drugim kontem zawyżałby „N unikalnych graczy globalnie".
                globalPlayerCount = dryRun
                    ? (await this.rankingService.getCountedPlayers(new Set(activeGuildIds))).total
                    : this.rankingService.countPeople(newGlobalRanking);
                globalSnippetData = await this.globalTop10Service.buildSnippetFieldData(
                    playerKey, newGlobalRanking, prevGlobalPosition, msgs, interaction.client
                );
                if (globalSnippetData) {
                    const newGlobalIdx = newGlobalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
                    gl.info(`🌐 Snippet globalny${dryRun ? ' (test)' : ''}: ${prevGlobalPosition ?? '—'} → #${newGlobalIdx + 1}`);
                }
            } catch (snippetErr) {
                gl.error(`❌ Błąd snippeta globalnego: ${snippetErr.message}`);
            }

            // Snippet + pozycja rankingu bossa — gdy rekord bossa pobity i boss jest znany; /test = symulacja bez zapisu
            let bossSnippetData = null;
            let bossGlobalRankingOverride = null;
            if (isNewBossRecord && bossName && !wasUnknownBoss) {
                const allGuildIdsForBoss = this.guildConfigService?.getAllConfiguredGuildIds()
                    || Array.from(interaction.client.guilds.cache.keys());
                const bossRankingOverrideSim = dryRun
                    ? await this.bossRecordService.simulateGlobalBossRanking(allGuildIdsForBoss, bossName, playerKey, _newScoreValue, bestScore, userName, guildId)
                    : null;
                const bossResult = await this._buildBossSnippetData(
                    playerKey, bossName, previousBossRecord, allGuildIdsForBoss, msgs, interaction.client, bossRankingOverrideSim
                );
                bossSnippetData = bossResult.snippetData;
                bossGlobalRankingOverride = bossResult.override;
                if (bossGlobalRankingOverride) {
                    const prevBossPos = bossGlobalRankingOverride.isNewEntry ? null : bossGlobalRankingOverride.position + bossGlobalRankingOverride.positionChange;
                    gl.info(`🎯 Snippet bossa "${bossName}": ${prevBossPos ?? '—'} → #${bossGlobalRankingOverride.position}`);
                }
            }

            // Pozycja w rankingu bossa NA SERWERZE (Embed 1) — pokazywana zawsze gdy boss jest znany
            let bossServerPositionData = null;
            if (bossName && !wasUnknownBoss) {
                bossServerPositionData = await this._buildBossServerPosition(guildId, bossName, playerKey, {
                    dryRun, scoreValue: _newScoreValue, score: bestScore, username: userName,
                });
            }

            // === Komunikaty systemowe (Embed 4) ===
            const systemNotices = [];
            if (wasUnknownBoss && isNewBossRecord && bossName) {
                const noticeVal = formatMessage(
                    msgs.unknownBossRankingNotice || 'Wykryto nową nazwę bossa: *{bossName}*\nWynik nie pojawi się w rankingu bossów do czasu weryfikacji przez admina.',
                    { bossName }
                );
                systemNotices.push({ name: msgs.unknownBossRankingField || 'Unverified Boss Name', value: noticeVal });
            }
            // ⚔️ Wyzwanie — informacja o zaliczeniu wyniku (Embed 4)
            if (_challengeNotice) systemNotices.push(_challengeNotice);
            // Poprzedni wynik na innym serwerze zostaje ukryty (nowy wynik jest ściśle lepszy) — nadpisuje opis Embedu 4
            let crossServerScoreRemovedNote = null;
            if (_prevGlobalUser && _newScoreValue > _prevGlobalUser.scoreValue && _prevGlobalUser.sourceGuildId !== guildId) {
                const removedGuildName = interaction.client.guilds.cache.get(_prevGlobalUser.sourceGuildId)?.name
                    || _prevGlobalUser.sourceGuildId;
                const newGuildName = interaction.guild?.name || guildId;
                crossServerScoreRemovedNote = `${msgs.systemInfoAllGood}\n${formatMessage(msgs.crossServerScoreRemovedNotice, {
                    score: _prevGlobalUser.score,
                    oldGuildName: removedGuildName,
                    newGuildName,
                })}`;
            }

            // Dokładne wyrównanie wyniku z innego serwera — wpis migruje na ten serwer, nadpisuje opis Embedu 4
            let crossServerMigratedNote = null;
            if (isCrossServerTieMigration) {
                const oldGuildName = interaction.client.guilds.cache.get(_prevGlobalUser.sourceGuildId)?.name
                    || _prevGlobalUser.sourceGuildId;
                const newGuildName = interaction.guild?.name || guildId;
                crossServerMigratedNote = formatMessage(msgs.crossServerMigratedNotice, { oldGuildName, newGuildName });
            }

            // === Licznik subskrybentów (Embed 1) === (read-only; w /test pokazujemy taki sam licznik, DM nie wychodzi)
            let recordSubscribers = [];
            try {
                recordSubscribers = await this.notificationService.getSubscribersForTarget(playerKey, guildId);
            } catch (subErr) {
                gl.warn(`⚠️ Nie udało się pobrać subskrybentów: ${subErr.message}`);
            }

            // === Wykres progresu (Embed 2) — tylko gdy zmiana w globalnym rankingu ===
            let chartAttachment = null;
            let chartName = null;
            if (globalSnippetData && this.scoreHistoryService && this.chartService) {
                try {
                    const allGuildIdsChart = this.guildConfigService?.getAllConfiguredGuildIds() || [guildId];
                    const callerHistory = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIdsChart, playerKey, 365);
                    // /test (dryRun): nowy wpis nie jest jeszcze w historii — dokładamy symulowany punkt, by wykres był identyczny jak po /update
                    // WAŻNE: pole 'guildId' (nie 'sourceGuildId') — wykres grupuje serie po 'guildId' (z getUserHistoryAllGuilds)
                    if (dryRun) {
                        callerHistory.push({ scoreValue: _newScoreValue, score: bestScore, timestamp: new Date().toISOString(), bossName: bossName || null, guildId });
                    }
                    if (callerHistory.length >= 2) {
                        const guildTagMap = {};
                        const guildNameMap = {};
                        for (const g of (this.guildConfigService?.getAllConfiguredGuilds() || [])) {
                            const discordName = interaction.client.guilds.cache.get(g.id)?.name;
                            guildTagMap[g.id] = g.tag || discordName?.slice(0, 14) || g.id.slice(-4);
                            guildNameMap[g.id] = discordName || g.tag || g.id.slice(-4);
                        }
                        const chartBuffer = await this.chartService.generateScoreHistoryChart(callerHistory, userName, msgs.chartTitle, guildTagMap, guildNameMap, this._chartLang(guildId));
                        if (chartBuffer) {
                            chartName = 'score_history.png';
                            chartAttachment = new AttachmentBuilder(chartBuffer, { name: chartName });
                        }
                    }
                } catch (chartErr) {
                    gl.warn(`⚠️ Błąd generowania wykresu progresu: ${chartErr.message}`);
                }
            }

            // === Ikona pozycji globalnej (thumbnail Embedu 2) — grafika generowana z numerem pozycji ===
            let positionIconAttachment = null;
            let positionIconName = null;
            if (globalSnippetData?.newGlobalPosition) {
                try {
                    const iconBuffer = await generatePositionIcon(globalSnippetData.newGlobalPosition);
                    if (iconBuffer) {
                        positionIconName = 'global_position.png';
                        positionIconAttachment = new AttachmentBuilder(iconBuffer, { name: positionIconName });
                    }
                } catch (iconErr) {
                    gl.warn(`⚠️ Błąd generowania ikony pozycji globalnej: ${iconErr.message}`);
                }
            }

            // === Ikona bossa (Embed 3) — gdy pobito rekord bossa i boss znany ===
            let bossImageAttachment = null;
            let bossImageName = null;
            if (isNewBossRecord && bossName && !wasUnknownBoss && this.bossAliasService) {
                try {
                    const imgPath = this.bossAliasService.getBossImagePath(bossName);
                    if (imgPath) {
                        const buf = await fs.readFile(path.join(__dirname, '../data/boss_images', imgPath));
                        bossImageName = imgPath;
                        bossImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                    }
                } catch { /* bez ikony bossa */ }
            }

            const _botUser = interaction.client.user;
            const publicEmbeds = await this.rankingService.createRecordEmbeds({
                userName,
                bestScore,
                userAvatarUrl: interaction.user.displayAvatarURL(),
                screenshotName: imageAttachment.name,
                previousScore: currentScore ? currentScore.score : null,
                userId,
                playerKey,
                profileIndex,
                profileLabel,
                guildId: interaction.guildId,
                messages: msgs,
                guild: interaction.guild,
                guildTopRoles: guildConfig?.topRoles || null,
                previousTimestamp: currentScore ? currentScore.timestamp : null,
                rolePositions,
                achievementsFieldValue,
                globalSnippetData,
                bossRecordData: isNewBossRecord && !wasUnknownBoss ? { isNewBossRecord, previousBossRecord, bossName } : null,
                bossSnippetData,
                bossServerPosition: bossServerPositionData,
                bossName,
                botName: _botUser?.username || null,
                botIconUrl: _botUser?.displayAvatarURL() || null,
                chartName,
                globalPositionIconName: positionIconName,
                bossImageName,
                followerCount: recordSubscribers.length,
                systemNotices,
                crossServerScoreRemovedNote,
                crossServerMigratedNote,
                // /test (dryRun): symulowana pozycja w klanie (nowy wynik bez zapisu), by była identyczna jak po /update
                sortedPlayersOverride: dryRun
                    ? await this.rankingService.simulateSortedPlayers(guildId, playerKey, userName, bestScore)
                    : null,
            });

            const publicFiles = [imageAttachment];
            if (chartAttachment) publicFiles.push(chartAttachment);
            if (positionIconAttachment) publicFiles.push(positionIconAttachment);
            if (bossImageAttachment) publicFiles.push(bossImageAttachment);

            let _newRecordPublicMsg = null;
            let _recordRevertSession = null;
            try {
                if (dryRun) {
                    // Tryb testowy: wynik wyświetlany wyłącznie ephemeral,
                    // brak publicznego followUp, brak aktualizacji ról,
                    // brak powiadomień na inne serwery i brak DM.
                    await interaction.editReply({
                        embeds: publicEmbeds,
                        files: publicFiles
                    });
                    gl.info('✅ Wysłano ephemeral podgląd nowego rekordu (tryb testowy)');
                } else {
                    await interaction.editReply({ content: msgs.newRecordConfirmed });

                    // Sprawdź czy community verification włączona
                    const cvCfg = this.guildConfigService?.getCommunityVerification(guildId);
                    const cvEnabled = !!(cvCfg?.enabled === true && this.communityVerificationService);

                    // Wyślij publiczne ogłoszenie (stos 4 embedów; przycisk CV dodany niżej, gdy znamy ID wiadomości)
                    const publicMsg = await interaction.followUp({
                        embeds: publicEmbeds,
                        files: publicFiles,
                    });
                    _newRecordPublicMsg = publicMsg;
                    this._addRecordAutoReaction(publicMsg, guildId);

                    // Aktualizuj sesję nieznanego bossa z ID ogłoszenia
                    if (unknownBossSessionKey && publicMsg) {
                        const _ubSess = this._unknownBossEmbeds.get(unknownBossSessionKey);
                        if (_ubSess) { _ubSess.publicMsgId = publicMsg.id; _ubSess.publicChannelId = publicMsg.channelId; }
                    }

                    // Jeśli CV włączone — teraz znamy ID wiadomości, utwórz sesję zgłoszeń
                    if (cvEnabled && publicMsg) {
                        try {
                            // Wygaś stare pending sesje tego gracza i usuń przyciski zgłoszeń ze starych wiadomości
                            const expired = await this.communityVerificationService.expireUserSessions(playerKey, guildId);
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

                            const msgUrl = `https://discord.com/channels/${guildId}/${publicMsg.channelId}/${publicMsg.id}`;
                            await this.communityVerificationService.createSession({
                                guildId,
                                userId,
                                playerKey,
                                messageId: publicMsg.id,
                                channelId: publicMsg.channelId,
                                messageUrl: msgUrl,
                                previousRecord: previousRecordSnapshot,
                                newRecord: { score: bestScore, bossName, timestamp: newRecordTimestamp || new Date().toISOString() },
                                newAchievements,
                                previousBossRecord: previousBossRecord ?? null,
                            });
                        } catch (cvErr) {
                            gl.warn(`⚠️ community verification session error: ${cvErr.message}`);
                        }
                    }

                    // Przyciski pod ogłoszeniem: „⚠️ Zgłoś" (gdy CV włączone) + „↩️ Cofnij wynik" dla właściciela.
                    // Rejestracja unieważnia przycisk pod poprzednim ogłoszeniem tego profilu.
                    _recordRevertSession = await this._registerRecordAnnouncement(interaction, publicMsg, {
                        guildId,
                        playerKey,
                        previousRecord: previousRecordSnapshot ?? null,
                        newRecord: { score: bestScore, bossName, timestamp: newRecordTimestamp || new Date().toISOString() },
                        previousBossRecord: previousBossRecord ?? null,
                        bossName: bossName || null,
                        skipGlobalRevert: false,
                        cvEnabled,
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
                _ocrEmbedParams = { profileIndex, profileLabel, type: 'test_record', userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score };
                return;
            }

            // Aktualizacja ról TOP po nowym rekordzie
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers, guildConfig?.topRoles || null);
                gl.success(`✅ ${this.logService.nickLink(userName, userId)} Role TOP zaktualizowane po nowym rekordzie`);
                // Sesja cofnięcia wyniku (tylko dla zapisanego rekordu, nie dryRun)
                const revertRow = this._buildAdminRevertRow(_newRecordPublicMsg?.id, playerKey, guildId);
                const logType = this._resolveUpdateLogType(currentScore, _prevGlobalUser, guildId, profileIndex);
                _ocrEmbedParams = { profileIndex, profileLabel, type: logType.type, movedFromGuildId: logType.movedFromGuildId, userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score ?? _prevGlobalUser?.score, revertComponents: revertRow, onSent: this._adminMsgTracker(_newRecordPublicMsg?.id) };
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP: ${roleError.message}`, interaction);
                // Sesja cofnięcia wyniku (tylko dla zapisanego rekordu, nie dryRun)
                const revertRow = this._buildAdminRevertRow(_newRecordPublicMsg?.id, playerKey, guildId);
                const logTypeErr = this._resolveUpdateLogType(currentScore, _prevGlobalUser, guildId, profileIndex, true);
                _ocrEmbedParams = { profileIndex, profileLabel, type: logTypeErr.type, movedFromGuildId: logTypeErr.movedFromGuildId, userName, userId, score: bestScore, bossName, commandName, previousScore: currentScore?.score ?? _prevGlobalUser?.score, roleError: roleError.message, revertComponents: revertRow, onSent: this._adminMsgTracker(_newRecordPublicMsg?.id) };
            }

            // Aktualizacja ról TOP na serwerach, z których usunięto gorszy wynik gracza
            if (affectedGuildIds.length > 0) {
                for (const affectedGuildId of affectedGuildIds) {
                    const affectedGuild = interaction.client.guilds.cache.get(affectedGuildId);
                    if (!affectedGuild) continue;
                    const affectedConfig = this.config.getGuildConfig(affectedGuildId);
                    if (!affectedConfig?.topRoles) continue;
                    this.roleService.updateTopRoles(affectedGuild, null, affectedConfig.topRoles).catch(err =>
                        gl.warn(`⚠️ Błąd aktualizacji ról TOP na serwerze "${affectedGuild.name}": ${err.message}`)
                    );
                }
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
                            const subscriberScore = guildRanking[subscriberId]?.score || null;
                            // Cały stos embedów (pierwszy przekształcony pod subskrybenta)
                            const dmEmbeds = this.rankingService.createDmNotifEmbeds(
                                publicEmbeds,
                                userName,
                                trackedAvatarUrl,
                                bestScore,
                                subscriberScore,
                                this.msgs(interaction.guildId)
                            );
                            // Odtwórz załączniki z tymi samymi nazwami, by setImage/thumbnail się rozwiązały
                            const dmFiles = [new AttachmentBuilder(tempImagePath, { name: imageAttachment.name })];
                            if (chartAttachment) dmFiles.push(new AttachmentBuilder(chartAttachment.attachment, { name: chartName }));
                            if (positionIconAttachment) dmFiles.push(new AttachmentBuilder(positionIconAttachment.attachment, { name: positionIconName }));
                            if (bossImageAttachment) dmFiles.push(new AttachmentBuilder(bossImageAttachment.attachment, { name: bossImageName }));
                            await subscriberUser.send({ embeds: dmEmbeds, files: dmFiles });
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
            const errStatus = error?.status ?? error?.statusCode ?? error?.code;
            const is503 = error?.message?.includes('503') || error?.message?.includes('Service Unavailable') || errStatus === 503;
            // Każdy błąd API (przeciążenie, rate limit, błąd serwera, sieć) → to nie wina użytkownika
            const isApiError = is503
                || [429, 500].includes(errStatus)
                || ['ECONNRESET', 'ETIMEDOUT'].includes(errStatus)
                || /\b(429|500)\b|Too Many Requests|Internal Server Error|overloaded|fetch failed/i.test(error?.message || '');

            // Odrzucenie przez API → użytkownik nie dostaje cooldownu (wyczyść ustawiony z góry)
            if (isApiError && !dryRun && this.updateCooldownService && !this._isHeadAdmin(interaction.user.id)) {
                await this.updateCooldownService.clearCooldown(interaction.user.id);
            }

            if (!isApiError) {
                await this.logService.logOCRError(error, `handle${commandName.charAt(0).toUpperCase() + commandName.slice(1)}Command`, interaction.guildId);
            } else {
                gl.warn(`⚠️ [/${commandName}] Błąd API AI (${errStatus || 'brak statusu'}) — cooldown wyczyszczony dla ${interaction.user.username}`);
            }

            try {
                await interaction.editReply(isApiError ? msgs.updateAiOverloaded : msgs.updateError);
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
                        { ..._ocrEmbedParams, userAvatar: interaction.user.displayAvatarURL(), globalPlayerCount },
                        interaction.guild ?? null,
                        _ocrEmbedParams.revertComponents ?? null,
                        interaction.client
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
            const rankingBefore = await this.rankingService.loadRanking(guildId).catch(() => ({}));
            const playerTimestamp = rankingBefore[targetUser.id]?.timestamp || null;
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
                if (this.scoreHistoryService && playerTimestamp) {
                    this.scoreHistoryService.removeEntriesAfter(guildId, targetUser.id, playerTimestamp)
                        .catch(e => logger.warn(`Błąd czyszczenia historii po /remove: ${e.message}`));
                }
                if (this.bossRecordService) {
                    await this.bossRecordService.removeAllUserBossRecords(guildId, targetUser.id)
                        .catch(e => logger.warn(`Błąd usuwania rekordów bossów po /remove: ${e.message}`));
                }
                await this.logService.logMessage('success', `Gracz ${targetUser.tag} został usunięty z rankingu i zaktualizowano role TOP`, interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP po usunięciu gracza: ${roleError.message}`, interaction);
            }

            // Usunięcie mogło ruszyć czołówkę — odśwież ranking serwera na stronie
            this.webRankingSyncService?.syncGuild(guildId, interaction.client).catch(() => {});

            await interaction.editReply(formatMessage(msgs.playerRemovedSuccess, { tag: targetUser.tag }));

        } catch (error) {
            await this.logService.logMessage('error', `Błąd usuwania gracza ${targetUser.tag} z rankingu: ${error.message}`, interaction);
            await interaction.editReply(msgs.playerRemoveError);
        }
    }

    _describePanelButton(customId) {
        if (customId === 'panel_back' || customId === 'cfg_admin_panel') return 'Otwarto panel';
        if (customId === 'panel_cmd_center') return 'Centrum Dowodzenia';
        if (customId === 'panel_cmd_center_refresh') return 'Odśwież Centrum Dowodzenia';
        if (customId === 'panel_cat_users') return 'Zarządzaj użytkownikami';
        if (customId === 'panel_cat_server') return 'Zarządzaj serwerem';
        if (customId === 'panel_cat_stats') return 'Statystyki';
        if (customId === 'panel_ocr_stats') return 'Success Rate (globalnie)';
        if (customId === 'panel_ocr_stats_reset_ok') return 'Potwierdzono reset liczników OCR';
        if (customId === 'panel_ocr_stats_reset') return 'Reset liczników OCR';

        if (customId === 'panel_back_configure') return 'Wróć do kreatora /configure';
        if (customId === 'panel_remove') return 'Usuń gracza z rankingu';
        if (customId.startsWith('panel_remove_confirm_')) return 'Potwierdzenie usunięcia gracza';
        if (customId.startsWith('panel_remove_all_confirm_')) return 'Potwierdzenie usunięcia gracza z osiągnięciami';
        if (customId === 'panel_remove_score') return 'Usuń wynik z historii';
        if (customId.startsWith('panel_remove_score_confirm_')) return 'Potwierdzenie usunięcia wyniku';
        if (customId === 'panel_unblock') return 'Odblokuj gracza';
        if (customId === 'panel_block') return 'Zablokuj gracza';
        if (customId.startsWith('panel_block_time_')) return 'Ustaw czas blokady gracza';
        if (customId === 'panel_tokens') return 'Zużycie tokenów';
        if (customId === 'panel_cmd_usage') return 'Użycia komend';
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
        if (customId === 'panel_process_roles') return 'Przetwórz role TOP';
        if (customId === 'panel_player_growth') return 'Przyrost graczy (statystyki)';
        if (customId === 'panel_ban_server') return 'Zbanuj serwer (panel)';
        if (customId === 'panel_ban_guild') return 'Zbanuj serwer (szukaj)';
        if (customId === 'panel_unban_guild') return 'Odbanuj serwer (lista)';
        if (customId.startsWith('panel_ban_guild_ok_')) return `Zbanuj serwer (potwierdź: ${customId.replace('panel_ban_guild_ok_', '')})`;
        if (customId === 'panel_delete_server_data') return 'Usuń dane serwera (panel)';
        if (customId === 'panel_delete_server_sel') return 'Usuń dane serwera (wybór)';
        if (customId.startsWith('panel_delete_server_ok_')) return `Usuń dane serwera (potwierdź: ${customId.replace('panel_delete_server_ok_', '')})`;
        if (customId === 'cc_refresh') return 'CC: Odśwież Panel';
        if (customId === 'cc_action_unblock') return 'CC: Odblokuj gracza';
        if (customId === 'cc_action_roles') return 'CC: Przetwórz role';
        if (customId === 'cc_action_tester') return 'CC: Testerzy';
        if (customId === 'cc_action_tokens') return 'CC: Zużycie tokenów';
        if (customId === 'cc_action_cmd_usage') return 'CC: Użycia komend';
        if (customId === 'cc_action_ocr_stats') return 'CC: Success Rate';
        if (customId === 'cc_player_lookup') return 'CC: Podgląd gracza';
        if (customId === 'cc_clear_cooldown') return 'CC: Wyczyść cooldown';
        if (customId === 'cc_pending_cv') return 'CC: Oczekujące CV';
        if (customId === 'cc_unconfigured') return 'CC: Nieskonfigurowane serwery';
        if (customId === 'cc_diag_server') return 'CC: Diagnostyka serwera';
        if (customId === 'cc_unconf_kick') return 'CC: Kicknij bota — lista serwerów';
        if (customId.startsWith('cc_kick_ok_')) return 'CC: Kicknij bota — potwierdzenie';
        if (customId === 'cc_kick_no') return 'CC: Kicknij bota — anulowano';
        if (customId.startsWith('cc_kick_pg_')) return 'CC: Kicknij bota — paginacja';
        if (customId.startsWith('cc_diag_pg_')) return 'CC: Diagnostyka — paginacja';
        if (customId.startsWith('cc_roles_pg_')) return 'CC: Przetwórz role — paginacja';
        if (customId.startsWith('cfg_ocr_en_')) return 'Włącz OCR /update (powiadomienie o konfiguracji)';
        if (customId === 'cc_top10_preview') return 'CC: Podgląd TOP10';
        if (customId === 'cc_action_boss_cfg') return 'CC: Konfiguracja bossów';
        if (customId === 'cc_cost_alert') return 'CC: Alert kosztowy';
        if (customId === 'cc_global_ocr') return 'CC: Globalny OCR (przełącznik)';
        if (customId === 'cc_bcr_refresh') return 'CC: Odśwież przyciski ogłoszeń';
        if (customId === 'cc_potd_set') return 'CC: Nadaj Gracza Dnia';
        if (customId === 'cc_potd_ps') return 'CC: Nadaj Gracza Dnia (wybrano gracza)';
        if (customId.startsWith('cc_global_ocr_ok_')) return 'CC: Globalny OCR (potwierdzenie)';
        if (customId === 'cc_srv_pg_prev' || customId === 'cc_srv_pg_next') return 'CC: Paginacja serwerów';
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
        if (customId === 'cfg_mod_skip') return 'Pomiń moderatorów gry';
        if (customId === 'cfg_mod_add') return 'Dodaj moderatora gry (modal)';
        if (customId === 'cfg_mod_remove') return 'Usuń moderatora gry';
        if (customId === 'cfg_autoreact_enable') return 'Auto-reakcja: włącz / zmień emotkę (modal)';
        if (customId === 'cfg_autoreact_disable') return 'Auto-reakcja: wyłącz/pomiń';
        if (customId === 'cfg_accept') return 'Zaakceptuj konfigurację';
        if (customId === 'cfg_cancel') return 'Anuluj konfigurację';
        if (customId.startsWith('cfg_step_')) return `Krok konfiguracji: ${customId.replace('cfg_step_', '')}`;
        return `cfg: ${customId}`;
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction
     */
    /**
     * Serwis zbiorczych liczników reakcji pod rozgłoszeniami — wstrzykiwany z `index.js`.
     * @param {Object} service
     */
    setBroadcastReactionService(service) {
        this.broadcastReactionService = service;
    }

    /**
     * Gracz dnia na stronie — potrzebny w /profile do przełącznika „Ukryj na stronie".
     * Setterem z tego samego powodu co wyżej: konstruktor ma już ponad trzydzieści argumentów.
     * @param {Object} service
     */
    setPlayerOfTheDayService(service) {
        this.playerOfTheDayService = service;
    }

    /**
     * `🔁 Odśwież ogłoszenia` (Centrum Dowodzenia) — przebudowa przycisków pod WSZYSTKIMI
     * żyjącymi rozgłoszeniami globalnymi. Potrzebne po zmianie zasad w kodzie: układ
     * przycisków siedzi w wiadomości, więc bez tego stare ogłoszenie czeka na pierwszą
     * reakcję albo kliknięcie.
     */
    async _handleCcBroadcastRefresh(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        const svc = this.broadcastReactionService;
        if (!svc) {
            await interaction.reply({ content: '❌ Serwis reakcji pod rozgłoszeniami jest niedostępny.', flags: ['Ephemeral'] });
            return;
        }

        // Rozgłoszenia lecą po kolei, z przerwą — to grubo ponad 3 s limitu Discorda
        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
            const { total, updated, skipped } = await svc.refreshAll(interaction.client);
            const opis = total === 0
                ? 'Brak ogłoszeń w rejestrze — nie ma czego odświeżać.'
                : `Odświeżono **${updated}** z **${total}** ogłoszeń.${skipped > 0 ? `\nPominięto **${skipped}** (skasowane wiadomości albo brak dostępu).` : ''}`;

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(updated > 0 ? 0x57F287 : 0xFEE75C)
                    .setTitle('🔁 Ogłoszenia globalne')
                    .setDescription(opis)],
            });
            this._ccAudit(interaction, `🔁 Odświeżono przyciski ogłoszeń: ${updated}/${total}`);
        } catch (err) {
            logger.warn(`Błąd odświeżania ogłoszeń: ${err.message}`);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF4444)
                    .setTitle('❌ Nie udało się odświeżyć ogłoszeń')
                    .setDescription(`\`${err.message}\``)],
            }).catch(() => {});
        }
    }

    /**
     * Limit klikania liczników reakcji.
     *
     * Jedno kliknięcie to przebudowa przycisków na kopiach embeda na WSZYSTKICH serwerach —
     * kilkadziesiąt zapytań do Discorda. Blokada współbieżności w serwisie chroni przed
     * tłumem, a to jest zabezpieczenie przed jedną osobą walącą w przycisk: `BCR_MAX_CLICKS`
     * kliknięć w oknie `BCR_WINDOW_MS` włącza przerwę na `BCR_PENALTY_MS`.
     *
     * @returns {{blocked: boolean, until: number, justBlocked: boolean}}
     */
    _bcrRateLimit(userId) {
        const now = Date.now();
        const wpis = this._bcrClicks.get(userId) || { klikniecia: [], doKiedy: 0 };

        if (wpis.doKiedy > now) return { blocked: true, until: wpis.doKiedy, justBlocked: false };

        wpis.klikniecia = wpis.klikniecia.filter(t => now - t < BCR_WINDOW_MS);
        wpis.klikniecia.push(now);

        let justBlocked = false;
        if (wpis.klikniecia.length >= BCR_MAX_CLICKS) {
            wpis.doKiedy = now + BCR_PENALTY_MS;
            wpis.klikniecia = [];
            justBlocked = true;
        }
        this._bcrClicks.set(userId, wpis);

        // Mapa rośnie z każdym klikającym — sprzątamy wygasłe wpisy, gdy się rozrośnie
        if (this._bcrClicks.size > 500) {
            for (const [id, w] of this._bcrClicks) {
                const swieze = w.doKiedy > now || w.klikniecia.some(t => now - t < BCR_WINDOW_MS);
                if (!swieze) this._bcrClicks.delete(id);
            }
        }

        return { blocked: justBlocked, until: wpis.doKiedy, justBlocked };
    }

    /**
     * Klik w licznik emotki = reakcja przyciskiem. Pierwszy klik dodaje głos, kolejny cofa;
     * gracz, który zostawił pod embedem prawdziwą reakcję tą emotką, cofa nią właśnie ją
     * (bot zdejmuje reakcję zamiast dokładać drugi głos tej samej osoby).
     */
    async _handleBroadcastReactionVote(interaction, broadcastId, emojiKey) {
        const isPol = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
        const svc = this.broadcastReactionService;
        if (!svc) { await interaction.deferUpdate().catch(() => {}); return; }

        const limit = this._bcrRateLimit(interaction.user.id);
        if (limit.blocked) {
            // Wyjaśnienie leci DOKŁADNIE RAZ — przy nałożeniu przerwy. Każde kolejne
            // kliknięcie do końca kary kończy się TU, bez ani jednego zapytania do API
            // (nawet bez `deferUpdate`) — inaczej spam nadal generowałby ruch, tyle że
            // tańszy. Kosztem jest „This interaction failed" u klikającego, co w trakcie
            // kary jest raczej cechą niż wadą.
            if (!limit.justBlocked) return;

            const msgs = this.msgs(interaction.guildId);
            await interaction.reply({
                content: formatMessage(msgs.broadcastVoteCooldown, {
                    when: `<t:${Math.floor(limit.until / 1000)}:R>`,
                }),
                flags: ['Ephemeral'],
            }).catch(() => {});
            return;
        }

        // Przebudowa liczników na WSZYSTKICH kopiach to kilka-kilkanaście zapytań do Discorda,
        // czyli grubo ponad 3 s, które Discord daje na potwierdzenie interakcji
        await interaction.deferUpdate().catch(() => {});

        try {
            const result = await svc.toggleVote({
                broadcastId,
                emojiKey,
                user: interaction.user,
                userName: interaction.member?.displayName || interaction.user.username,
                guildId: interaction.guildId,
                message: interaction.message,
                client: interaction.client,
            });

            if (result.state === 'reaction') {
                await interaction.followUp({
                    content: isPol
                        ? '⚠️ Masz już własną reakcję tą emotką pod tą wiadomością — zdejmij ją, żeby cofnąć głos. (Bot nie ma uprawnienia „Zarządzanie wiadomościami", więc nie może zrobić tego za Ciebie.)'
                        : '⚠️ You already reacted with this emoji on this message — remove that reaction to take your vote back. (The bot lacks the "Manage Messages" permission, so it cannot do it for you.)',
                    flags: ['Ephemeral'],
                }).catch(() => {});
                return;
            }

            // Rząd „ostatnia reakcja" traktuje klik tak samo jak zostawienie emotki;
            // cofnięcie głosu go nie rusza — poprzedniego autora i tak nie dałoby się odtworzyć
            if (result.state === 'added') {
                const userName = interaction.member?.displayName || interaction.user.username;
                await svc.recordLastFromVote({
                    broadcastId,
                    userName,
                    guildId: interaction.guildId,
                    emojiKey,
                    client: interaction.client,
                }).catch(() => {});
            }

            await svc.refreshAfterVote(broadcastId, interaction.client);
        } catch (err) {
            logger.warn(`Błąd głosu pod rozgłoszeniem: ${err.message}`);
        }
    }

    /**
     * Przyciski pod rozgłoszeniem globalnym:
     *   • licznik emotki (`_e_{klucz}`) — DZIAŁA JAK REAKCJA: pierwszy klik +1, kolejny -1;
     *     zmiana wchodzi od razu na kopie embeda na wszystkich serwerach,
     *   • zbiorczy `➕` (`_other`) — aktywny, ale bezczynny (klik trzeba potwierdzić,
     *     inaczej Discord pokaże „This interaction failed"),
     *   • „ostatnia reakcja" (`_last`) — pełna lista reagujących ze wszystkich serwerów.
     *
     * CustomID: `bcr_{broadcastId}_e_{kluczEmotki}` | `bcr_{broadcastId}_other` | `bcr_{broadcastId}_last`
     */
    async _handleBroadcastReactionButton(interaction, customId) {
        const rest = customId.slice('bcr_'.length);
        const sep = rest.indexOf('_');
        if (sep === -1) { await interaction.deferUpdate().catch(() => {}); return; }

        const broadcastId = rest.slice(0, sep);
        const suffix = rest.slice(sep + 1);

        // Zbiorczy `➕` — zostaje aktywny, ale niczego nie otwiera (listę pokazuje rząd 5)
        if (suffix === 'other') { await interaction.deferUpdate().catch(() => {}); return; }

        if (suffix.startsWith('e_')) {
            await this._handleBroadcastReactionVote(interaction, broadcastId, suffix.slice(2));
            return;
        }

        // `_last` → lista WSZYSTKICH reagujących (dawne zachowanie zbiorczego `➕`)
        const target = { type: 'all' };

        const isPol = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
        // Zebranie listy to odczyt N wiadomości + użytkownicy reakcji — grubo ponad 3 s,
        // które Discord daje na pierwszą odpowiedź
        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
            const data = await this.broadcastReactionService?.collectReactors(broadcastId, target, interaction.client);
            if (!data || !data.total) {
                await interaction.editReply(isPol
                    ? '🔍 Nikt jeszcze nie zareagował pod tym ogłoszeniem.'
                    : '🔍 Nobody has reacted to this announcement yet.');
                return;
            }

            // JEDEN EMBED NA EMOTKĘ, a jej obrazek idzie jako ikona autora. Discord renderuje
            // w treści tylko emotki customowe, do których BOT ma dostęp — pozostałe pokazuje
            // jako goły `:nazwa:`. Ikona z CDN nie podlega temu ograniczeniu, więc widać
            // każdą emotkę, także tę z serwera bez bota. Limit: 10 embedów na wiadomość.
            const embeds = [];
            const emojiList = data.emojis.slice(0, 10);

            for (const [idx, item] of emojiList.entries()) {
                const embed = new EmbedBuilder().setColor(0x5865F2);

                // Customowa ma już swój obrazek jako ikonę autora, więc jej NAZWA nic nie wnosi
                // (a bywa nieczytelna: zalgo, znaki spoza alfabetu). Zostaje sam licznik.
                // Unicode nie ma ikony z CDN, więc tam glif emotki musi zostać w tekście.
                const headline = item.isCustom
                    ? `– ${item.total}`
                    : `${item.display} – ${item.total}`;
                embed.setAuthor(item.iconUrl
                    ? { name: headline, iconURL: item.iconUrl }
                    : { name: headline });

                // Pierwszy embed niesie podsumowanie całości
                if (idx === 0) {
                    embed.setTitle(isPol ? 'Kto zareagował' : 'Who reacted');
                    embed.setDescription(isPol
                        ? `Łącznie: **${data.total}** ze wszystkich serwerów`
                        : `Total: **${data.total}** across all servers`);
                }

                // Limity Discorda: 25 pól na embed, 1024 znaki na pole
                for (const group of item.groups.slice(0, 25)) {
                    let value = '';
                    let shown = 0;
                    for (const name of group.names) {
                        if (value.length + name.length + 2 > 980) break;
                        value += (value ? ', ' : '') + name;
                        shown++;
                    }
                    if (shown < group.names.length) {
                        value += isPol
                            ? ` … i ${group.names.length - shown} więcej`
                            : ` … and ${group.names.length - shown} more`;
                    }
                    embed.addFields({ name: `${group.guildName} (${group.names.length})`, value: value || '—' });
                }
                embeds.push(embed);
            }

            if (data.emojis.length > emojiList.length) {
                embeds[embeds.length - 1].setFooter({ text: isPol
                    ? `Pokazano ${emojiList.length} z ${data.emojis.length} emotek`
                    : `Showing ${emojiList.length} of ${data.emojis.length} emojis` });
            }

            await interaction.editReply({ embeds });
        } catch (err) {
            logger.warn(`Błąd listy reagujących: ${err.message}`);
            await interaction.editReply(isPol
                ? '❌ Nie udało się pobrać listy osób.'
                : '❌ Could not load the list of people.').catch(() => {});
        }
    }

    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;

        // === Liczniki reakcji pod rozgłoszeniem ===
        if (customId.startsWith('bcr_')) {
            await this._handleBroadcastReactionButton(interaction, customId);
            return;
        }

        // === Community Verification — poza głównym try (własne error handling) ===
        if (customId.startsWith('cv_vote_')) {
            await this._handleCvVote(interaction);
            return;
        }
        if (customId.startsWith('cv_admin_')) {
            await this._handleCvAdmin(interaction);
            return;
        }

        // === ⚔️ Wyzwania — poza głównym try, bo przyciski w DM nie mają guild ani member ===
        if (customId.startsWith('chal_')) {
            await this.handleChallengeButton(interaction, customId);
            return;
        }

        try {

            // === Cofnięcie własnego rekordu przez gracza ===
            if (customId.startsWith('rec_undo_ok_')) {
                await this._handleRecordUndoConfirm(interaction, customId);
                return;
            }
            if (customId === 'rec_undo_no') {
                await interaction.update({ content: this.msgs(interaction.guildId).recordUndoCancelled, components: [] });
                return;
            }
            if (customId.startsWith('rec_undo_')) {
                await this._handleRecordUndo(interaction, customId);
                return;
            }
            if (customId.startsWith('rec_undone_')) {
                // Nieaktywny znacznik „cofnięto" — klik nie powinien się zdarzyć (przycisk disabled)
                await interaction.deferUpdate().catch(() => {});
                return;
            }

            // === Profile gracza (kilka kont w grze) ===
            if (customId.startsWith('prof_')) {
                await this.handleProfileRegistryButton(interaction, customId);
                return;
            }

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

            // MUSI stać przed ogólnym `ee_analyze_` — inaczej blokada trafiłaby
            // do handlera samej analizy (ten sam prefiks)
            if (customId.startsWith('ee_analyze_block_')) {
                await this._handleAnalyzeBlock(interaction, customId);
                return;
            }

            if (customId.startsWith('ee_analyze_')) {
                await this._handleAnalyzeButton(interaction, customId);
                return;
            }

            // === Cofnięcie wyniku OCR (przycisk w embedzie analizy) ===
            if (customId.startsWith('ocr_revert_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                // ocr_revert_{publicMsgId} (nowy format) albo ocr_revert_{playerKey}_{guildId}
                // (stare embedy sprzed wdrożenia przycisku gracza — wtedy cofamy OSTATNI rekord profilu)
                const token = customId.replace('ocr_revert_', '');
                let session = null;
                if (token.includes('_')) {
                    const [legacyPlayerKey, legacyGuildId] = token.split('_');
                    session = this.recordRevertService?.getLatest(legacyPlayerKey, legacyGuildId)
                        || this._ocrRevertSessions.get(`${legacyPlayerKey}_${legacyGuildId}`)
                        || null;
                } else {
                    session = this.recordRevertService?.get(token) || null;
                }
                if (!session) {
                    await interaction.reply({ content: '❌ Sesja wygasła lub wynik został już cofnięty.', flags: ['Ephemeral'] });
                    return;
                }
                if (this._isSessionReverted(session.status)) {
                    await interaction.reply({
                        content: session.status === 'owner'
                            ? '❌ Ten wynik został już cofnięty przez właściciela.'
                            : '❌ Ten wynik został już cofnięty.',
                        flags: ['Ephemeral'],
                    });
                    return;
                }
                const targetPlayerKey = session.playerKey;
                const targetGuildId = session.guildId;
                const targetUserId = getOwnerId(targetPlayerKey);
                await interaction.deferUpdate();
                if (session.publicMsgId) {
                    await this.recordRevertService?.markReverted(session.publicMsgId, 'admin',
                        interaction.member?.displayName || interaction.user.username);
                }
                this._ocrRevertSessions.delete(`${targetPlayerKey}_${targetGuildId}`);
                await this._cvRemoveRecord(session, { skipUndoInvalidate: true, client: interaction.client });
                // Cofnięcie własnego wyniku przez head admina (testowanie) — nie liczy się do statystyk
                if (this.ocrStatsService && targetUserId !== interaction.user.id) {
                    this.ocrStatsService.recordReverted().catch(() => {});
                }
                try {
                    const guild = interaction.client.guilds.cache.get(targetGuildId);
                    if (guild) {
                        const guildCfg = this.config.getGuildConfig(targetGuildId);
                        await this.roleService.updateTopRoles(guild, null, guildCfg?.topRoles || null).catch(() => {});
                    }
                } catch {}
                const adminName = interaction.member?.displayName || interaction.user.username;
                this._ccAudit(interaction, `↩️ Cofnięto wynik: ${await this._ccName(interaction, targetUserId)}`);
                this.adminPanelService?.refresh();
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .addFields({ name: '↩️ Cofnięto', value: `przez **${adminName}**`, inline: false });
                // Dezaktywuj przycisk cofnięcia (zamiast usuwać)
                const disabledOcrRevertBtn = new ButtonBuilder()
                    .setCustomId(customId)
                    .setLabel('↩️ Cofnij wynik')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
                await interaction.message.edit({ embeds: [updatedEmbed], components: [new ActionRowBuilder().addComponents(disabledOcrRevertBtn)] }).catch(() => {});
                // Ogłoszenie publiczne: notka + nieaktywny czerwony przycisk „Cofnął admin"
                const _t = this._panelT(targetGuildId);
                const _noteText = _t(
                    `↩️ Administrator **${adminName}** cofnął wynik oraz wszystkie osiągnięcia do stanu sprzed pobicia tego rekordu z powodu naruszenia zasad.`,
                    `↩️ Administrator **${adminName}** reverted the score and all achievements to the state before this record was set due to a rules violation.`
                );
                await this._applyRevertVisuals(interaction.client, session, 'admin', adminName, {
                    skipMessageId: interaction.message.id,
                    publicNote: _noteText,
                });
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
            if (customId === 'ach_rank_go_ranking') {
                await this._handleRankingSelect(interaction, 'ranking_select_global');
                return;
            }

            // === Przyciski /profile ===
            if (customId === 'profile_main' || customId === 'profile_bosses' ||
                customId === 'profile_ach_overview' || customId.startsWith('profile_ach_cat_') ||
                customId === 'profile_bosses_prev' || customId === 'profile_bosses_next' ||
                customId === 'profile_back' || customId === 'profile_search' ||
                customId === 'profile_challenges' ||
                customId === 'profile_chal_prev' || customId === 'profile_chal_next' ||
                customId === 'profile_manage_subs' || customId === 'profile_manage_prof' ||
                customId === 'profile_add_intro' ||
                customId === 'profile_subscribe' ||
                customId === 'profile_unsubscribe' || customId === 'profile_track' ||
                customId === 'profile_potd_toggle' ||
                customId.startsWith('profile_view_')) {
                await this._handleProfileButton(interaction);
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
            if (customId === 'panel_cat_users') {
                await this._handlePanelCatUsers(interaction);
                return;
            }
            if (customId === 'panel_cat_server') {
                await this._handlePanelCatServer(interaction);
                return;
            }
            if (customId === 'panel_cat_stats') {
                await this._handlePanelCatStats(interaction);
                return;
            }
            if (customId === 'panel_ocr_stats') {
                await this._handlePanelOcrStats(interaction);
                return;
            }
            if (customId === 'panel_ocr_stats_reset_ok') {
                await this._handlePanelOcrStatsResetConfirm(interaction);
                return;
            }
            if (customId === 'panel_ocr_stats_reset') {
                await this._handlePanelOcrStatsReset(interaction);
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
            if (customId === 'panel_cmd_center') {
                await this._handlePanelCmdCenter(interaction);
                return;
            }
            if (customId === 'panel_cmd_center_refresh') {
                await this._handlePanelCmdCenterRefresh(interaction);
                return;
            }
            // Centrum Dowodzenia — przyciski na wiadomości panelu
            if (customId === 'cc_refresh') {
                await this._handleCcRefresh(interaction);
                return;
            }
            if (customId === 'cc_action_unblock') {
                await this._handleCcActionUnblock(interaction);
                return;
            }
            if (customId === 'cc_action_roles') {
                await this._handleCcActionRoles(interaction);
                return;
            }
            if (customId === 'cc_action_tester') {
                await this._handleCcActionTester(interaction);
                return;
            }
            if (customId === 'cc_potd_set') {
                await this._handleCcPotdSet(interaction);
                return;
            }
            if (customId === 'cc_action_tokens') {
                await this._handleCcActionTokens(interaction);
                return;
            }
            if (customId === 'cc_action_cmd_usage') {
                await this._handleCcActionCmdUsage(interaction);
                return;
            }
            if (customId === 'cc_action_ocr_stats') {
                await this._handleCcActionOcrStats(interaction);
                return;
            }
            if (customId === 'cc_srv_pg_prev' || customId === 'cc_srv_pg_next') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await interaction.deferUpdate();
                this.adminPanelService?.changeServersPage(customId === 'cc_srv_pg_next' ? 1 : -1);
                this.adminPanelService?.refresh();
                return;
            }
            if (customId === 'cc_player_lookup') {
                await this._handleCcPlayerLookup(interaction);
                return;
            }
            if (customId === 'cc_clear_cooldown') {
                await this._handleCcClearCooldown(interaction);
                return;
            }
            if (customId === 'cc_pending_cv') {
                await this._handleCcPendingCv(interaction);
                return;
            }
            if (customId === 'cc_unconf_kick') {
                await this._handleCcUnconfKick(interaction);
                return;
            }
            if (customId.startsWith('cc_kick_pg_')) {
                await this._handleCcUnconfKick(interaction, parseInt(customId.replace('cc_kick_pg_', ''), 10) || 0);
                return;
            }
            if (customId.startsWith('cc_kick_ok_')) {
                await this._handleCcKickConfirm(interaction, customId.replace('cc_kick_ok_', ''));
                return;
            }
            if (customId === 'cc_kick_no') {
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(0x99AAB5)
                        .setTitle('❌ Anulowano')
                        .setDescription('Bot zostaje na serwerze.')],
                    components: [],
                });
                return;
            }
            if (customId.startsWith('cc_diag_pg_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await interaction.deferUpdate();
                await this._handleCcDiagServer(interaction, parseInt(customId.replace('cc_diag_pg_', ''), 10) || 0);
                return;
            }
            if (customId.startsWith('cc_roles_pg_')) {
                await interaction.deferUpdate();
                await this._handleCcActionRoles(interaction, parseInt(customId.replace('cc_roles_pg_', ''), 10) || 0);
                return;
            }
            if (customId === 'cc_pg_label') {
                await interaction.deferUpdate();
                return;
            }
            if (customId === 'cc_unconfigured') {
                await this._handleCcUnconfigured(interaction);
                return;
            }
            if (customId === 'cc_diag_server') {
                await this._handleCcDiagServer(interaction);
                return;
            }
            if (customId === 'cc_top10_preview') {
                await this._handleCcTop10Preview(interaction);
                return;
            }
            if (customId === 'cc_bcr_refresh') {
                await this._handleCcBroadcastRefresh(interaction);
                return;
            }
            if (customId === 'cc_action_boss_cfg') {
                await this._handleCcActionBossCfg(interaction);
                return;
            }
            if (customId === 'cc_cost_alert') {
                await this._handleCcCostAlert(interaction);
                return;
            }
            if (customId.startsWith('cc_global_ocr_ok_')) {
                await this._handleCcGlobalOcrConfirm(interaction, customId.replace('cc_global_ocr_ok_', ''));
                return;
            }
            if (customId === 'cc_global_ocr') {
                await this._handleCcGlobalOcr(interaction);
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
            if (customId === 'panel_remove_score') {
                await this._handlePanelRemoveScore(interaction);
                return;
            }
            if (customId.startsWith('panel_remove_score_confirm_')) {
                const rawValue = customId.replace('panel_remove_score_confirm_', '');
                await this._handlePanelRemoveScoreConfirm(interaction, rawValue);
                return;
            }
            if (customId.startsWith('panel_remove_score_page_') && customId !== 'panel_remove_score_page_noop') {
                const rawValue = customId.replace('panel_remove_score_page_', '');
                await this._handlePanelRemoveScorePage(interaction, rawValue);
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
            if (customId === 'panel_cmd_usage') {
                await this._handlePanelCmdUsage(interaction);
                return;
            }
            if (customId === 'panel_process_roles') {
                await this._handlePanelProcessRoles(interaction);
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
            if (customId === 'panel_ach_ok_n') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelConfirmMany(interaction);
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
            // Filtr osiągnięć po nazwie (PL/ENG), czyszczenie filtra i powrót do listy
            if (customId === 'panel_ach_del_q') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelAchDelQuery(interaction);
                return;
            }
            if (customId === 'panel_ach_del_clear' || customId === 'panel_ach_del_back') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const achSession = this._getAchDelSession(interaction.user.id);
                if (achSession && customId === 'panel_ach_del_clear') {
                    achSession.query = '';
                    achSession.page = 0;
                }
                if (achSession) achSession.selected = [];
                await interaction.deferUpdate();
                await this._renderAchDelView(interaction);
                return;
            }
            if (customId === 'panel_ach_del_pg_prev' || customId === 'panel_ach_del_pg_next') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const achSession = this._getAchDelSession(interaction.user.id);
                if (achSession) {
                    achSession.page = Math.max(0, (achSession.page || 0) + (customId === 'panel_ach_del_pg_next' ? 1 : -1));
                    achSession.selected = [];
                }
                await interaction.deferUpdate();
                await this._renderAchDelView(interaction);
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
                {
                    const en = customId.startsWith('panel_ocr_en_');
                    const rest = customId.replace(en ? 'panel_ocr_en_' : 'panel_ocr_dis_', '');
                    const target = rest.split('_')[0]; // update | test | both
                    const gid = rest.split('_').slice(1).join('_');
                    const gName = this.guildConfigService?.getConfig(gid)?.guildName || gid;
                    this._ccAudit(interaction, `🔄 AI OCR ${en ? 'włączono' : 'wyłączono'} (${target}) — ${gName}`);
                }
                this.adminPanelService?.refresh();
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
                const currentVal = cfg.nextTrigger ? this._fmtWarsaw(new Date(cfg.nextTrigger)) : '';
                const t = this._panelT(interaction.guildId);
                const modal = new ModalBuilder()
                    .setCustomId('top10_interval_modal')
                    .setTitle(t('📅 Interwał TOP10 globalnego', '📅 Global TOP10 Interval'));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('top10_first_trigger')
                            .setLabel(t('Data/godzina początku cyklu', 'Cycle start date/time'))
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

            if (customId === 'panel_delete_server_data') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelDeleteServerData(interaction);
                return;
            }

            if (customId.startsWith('panel_delete_server_ok_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                const guildIdToDelete = customId.replace('panel_delete_server_ok_', '');
                await this._handlePanelDeleteServerDataConfirm(interaction, guildIdToDelete);
                return;
            }

            if (customId === 'panel_player_growth') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelPlayerGrowth(interaction);
                return;
            }
            if (customId === 'panel_boss_cfg') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelBossConfig(interaction);
                return;
            }
            if (customId === 'boss_cfg_add_name') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddName(interaction);
                return;
            }
            if (customId === 'boss_cfg_add_alias_start') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddAliasStart(interaction);
                return;
            }
            if (customId === 'boss_cfg_rm_start') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgRmStart(interaction);
                return;
            }
            if (customId === 'boss_cfg_rm_entry') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgRmEntry(interaction);
                return;
            }
            if (customId === 'boss_cfg_edit_entry') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditEntry(interaction);
                return;
            }
            if (customId === 'boss_cfg_edit_alias') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditAlias(interaction);
                return;
            }
            if (customId.startsWith('boss_mapm_')) {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossMapButton(interaction, customId);
                return;
            }
            if (customId === 'boss_cfg_set_img') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgSetImg(interaction);
                return;
            }
            if (customId === 'ranking_boss_list') {
                await this._handleRankingBossList(interaction);
                return;
            }
            // Ranking bossów zawężony do jednego serwera
            if (customId.startsWith('ranking_boss_srv_')) {
                await this._handleRankingBossList(interaction, customId.replace('ranking_boss_srv_', ''));
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

            // Przycisk „Włącz OCR /update" spod powiadomienia o konfiguracji serwera
            if (customId.startsWith('cfg_ocr_en_')) {
                await this._handleCfgOcrEnable(interaction);
                return;
            }
            if (customId === 'cfg_ocr_done') {
                await interaction.deferUpdate();
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
                customId === 'cfg_mod_skip' || customId === 'cfg_mod_add' || customId === 'cfg_mod_remove' ||
                customId === 'cfg_autoreact_enable' || customId === 'cfg_autoreact_disable' ||
                customId === 'cfg_accept' || customId === 'cfg_cancel') {
                const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                this.logService._gl(interaction.guildId).info(`${this.logService.nickLink(nick, interaction.user.id)} /configure → ${this._describeCfgButton(customId)}`);
                await this._handleConfigureButton(interaction, customId);
                return;
            }

            // === Przyciski paginacji ===
            await interaction.deferUpdate();

            // Sprawdź najpierw czy to ranking bossa (przechowywany w _bossRankings)
            if (this._bossRankings.has(interaction.message.id)) {
                await this._handleRankingBossPage(interaction, customId);
                return;
            }

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
                        callerStats: rankingData.callerStats || null,
                        callerPlayerKey: this._mainPlayerKey(rankingData.userId)
                    }
                );
            }

            const buttons = this.rankingService.createRankingButtons(
                newPage, rankingData.totalPages, false, msgs, rankingData.roleRows || [], btnOptions
            );

            let paginationChartAttachment = null;
            let paginationChartFilename = null;
            if (rankingData.mode === 'global') {
                const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                const t = this._panelT(interaction.guildId);
                paginationChartAttachment = await this._buildGlobalRankingChartAttachment(
                    rankingData.players, newPage, allGuildIds, t
                );
                paginationChartFilename = 'ranking_progress.png';
            } else if (rankingData.mode === 'guild_ranking' && this.chartService?.generateGuildComparisonChart) {
                try {
                    const t = this._panelT(interaction.guildId);
                    const chartTitle = t('📊 Porównanie Serwerów', '📊 Server Comparison');
                    const perPage = this.config.ranking.playersPerPage;
                    const pageGuildScores = rankingData.guildScores.slice(newPage * perPage, (newPage + 1) * perPage);
                    const buf = await this.chartService.generateGuildComparisonChart(pageGuildScores, chartTitle, this._chartLang(interaction.guildId));
                    if (buf) {
                        paginationChartAttachment = new AttachmentBuilder(buf, { name: 'guild_comparison.png' });
                        paginationChartFilename = 'guild_comparison.png';
                    }
                } catch (err) {
                    logger.warn('Błąd generowania wykresu porównania serwerów (paginacja):', err);
                }
            }

            const paginationEmbeds = paginationChartAttachment
                ? [embed, new EmbedBuilder().setImage(`attachment://${paginationChartFilename}`)]
                : [embed];
            const paginationOpts = { embeds: paginationEmbeds, components: buttons, attachments: [] };
            if (paginationChartAttachment) {
                paginationOpts.files = [paginationChartAttachment];
                delete paginationOpts.attachments;
            }

            await interaction.editReply(paginationOpts);

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
        try {
            await this._handleCvVoteInner(interaction, msgs);
        } catch (err) {
            logger.error('Błąd obsługi głosu CV:', err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] }).catch(() => {});
            }
        }
    }

    async _handleCvVoteInner(interaction, msgs) {
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
        const voterIsHeadAdmin = this._isHeadAdmin(voterId);
        const ownerIsHeadAdmin = this._isHeadAdmin(session.userId);

        // Rekord należący do head admina = tryb testowy CV — przycisk może kliknąć WYŁĄCZNIE jego właściciel
        if (ownerIsHeadAdmin && voterId !== session.userId) {
            await interaction.reply({ content: msgs.cvVoteHeadAdminOnly, flags: ['Ephemeral'] });
            return;
        }

        // Zwykły gracz nie może zgłosić własnego wyniku (head admin może — tryb testowy)
        if (session.userId === voterId && !voterIsHeadAdmin) {
            await interaction.reply({ content: msgs.cvVoteSelf, flags: ['Ephemeral'] });
            return;
        }

        // Sprawdź czy głosujący jest w rankingu (head admin omija ten check)
        if (!voterIsHeadAdmin) {
            const inRanking = await this.communityVerificationService.isVoterInRanking(
                this.rankingService, session.guildId, voterId
            );
            if (!inRanking) {
                await interaction.reply({ content: msgs.cvVoteNotInRanking, flags: ['Ephemeral'] });
                return;
            }
        }

        const result = await this.communityVerificationService.registerVote(messageId, voterId, { allowSelf: voterIsHeadAdmin });

        if (result.invalid) {
            await interaction.reply({ content: msgs.cvVoteInvalid, flags: ['Ephemeral'] });
            return;
        }
        if (result.isSelf) {
            await interaction.reply({ content: msgs.cvVoteSelf, flags: ['Ephemeral'] });
            return;
        }
        if (result.alreadyVoted) {
            await interaction.reply({ content: msgs.cvVoteAlreadyVoted, flags: ['Ephemeral'] });
            return;
        }

        const cvCfg = this.guildConfigService?.getCommunityVerification(session.guildId);
        // Rekord head admina = tryb testowy: jedno kliknięcie uruchamia pełny przepływ zgłoszenia
        const threshold = ownerIsHeadAdmin ? 1 : (cvCfg?.threshold || 5);
        const count = result.count;
        session.count = count; // zaktualizuj snapshot — getSession() zwraca kopię sprzed registerVote

        // Zaktualizuj etykietę przycisku na wiadomości (z licznikiem zgłoszeń)
        try {
            const voteBtn = new ButtonBuilder()
                .setCustomId(`cv_vote_${messageId}`)
                .setLabel(`${msgs.cvVoteButton} (${count})`)
                .setStyle(ButtonStyle.Secondary);
            const voteRow = new ActionRowBuilder().addComponents(voteBtn);
            // Zachowaj przycisk „Cofnij wynik" właściciela — przebudowa komponentów by go usunęła
            const keepUndoBtn = this._undoButtonFor(messageId, this.config.getMessages(session.guildId));
            if (keepUndoBtn) voteRow.addComponents(keepUndoBtn);
            await interaction.update({ components: [voteRow] });
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
            const cvAuthorName = cvGuildTag ? `${cvGuildTag.replace(/^<a?:([^:]+):\d+>$/, '$1')}  ${sourceGuild?.name || session.guildId}` : (sourceGuild?.name || session.guildId);
            const cvUserAvatar = targetUser?.displayAvatarURL({ dynamic: true, size: 64 }) || cvGuildIcon || null;

            // Pobierz screenshota z oryginalnej wiadomości (embed.image lub attachment)
            let cvScreenImageUrl = null;
            if (session.channelId) {
                try {
                    const origCh = await client.channels.fetch(session.channelId).catch(() => null);
                    if (origCh) {
                        const origMsg = await origCh.messages.fetch(messageId).catch(() => null);
                        if (origMsg) {
                            cvScreenImageUrl = origMsg.embeds?.[0]?.image?.url
                                || origMsg.attachments?.first()?.url
                                || null;
                        }
                    }
                } catch {}
            }

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

            if (cvScreenImageUrl) reportEmbed.setImage(cvScreenImageUrl);

            const approveBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_approve_${messageId}`)
                .setEmoji('✅')
                .setLabel(msgs.cvReportBtnApprove)
                .setStyle(ButtonStyle.Success);
            const removeBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_remove_${messageId}`)
                .setEmoji('🗑️')
                .setLabel(msgs.cvReportBtnRemove)
                .setStyle(ButtonStyle.Danger);
            const blockBtn = new ButtonBuilder()
                .setCustomId(`cv_admin_block_${messageId}`)
                .setEmoji('🔒')
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
            const globalCvChannelId = this.config.communityChannelId;
            const skipGlobal = globalCvChannelId && cvCfg?.rejectedChannelId && globalCvChannelId === cvCfg.rejectedChannelId;
            if (globalCvChannelId && !skipGlobal) {
                try {
                    const globalCh = await client.channels.fetch(globalCvChannelId).catch(() => null);
                    if (globalCh) {
                        const sent = await globalCh.send({ content: '<@398983446812295168>', embeds: [reportEmbed], components });
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
            await this._cvRemoveRecord(session, { by: 'admin', actorName: adminName, client: interaction.client });
            if (this.ocrStatsService) this.ocrStatsService.recordReverted().catch(() => {});
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
            await this._cvRemoveRecord(session, { by: 'admin', actorName: adminName, client: interaction.client });
            if (this.ocrStatsService) this.ocrStatsService.recordReverted().catch(() => {});
            await this.communityVerificationService.closeSession(messageId, 'blocked');
            await this._updateOriginalRecordButton(interaction.client, session, 'blocked');
            await this._updateAllCvReportMsgs(interaction.client, session,
                msgs.cvAdminBlocked.replace('{adminName}', adminName), []);
        }
        const cvActionLabel = action === 'approve' ? '✅ CV: zatwierdzono wynik' : action === 'remove' ? '🗑️ CV: usunięto rekord' : '🔒 CV: zablokowano gracza';
        this._ccAudit(interaction, `${cvActionLabel}: ${await this._ccName(interaction, session.userId)}`);
        this.adminPanelService?.refresh();
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

            const doneRow = new ActionRowBuilder().addComponents(doneBtn);
            // Zgłoszenie odrzucone (rekord zostaje) → właściciel nadal może cofnąć swój wynik
            if (action === 'approved') {
                const keepUndoBtn = this._undoButtonFor(session.messageId, sourceMsgs);
                if (keepUndoBtn) doneRow.addComponents(keepUndoBtn);
            }
            await msg.edit({ components: [doneRow] }).catch(() => {});
        } catch (e) {
            logger.warn(`CV _updateOriginalRecordButton error: ${e.message}`);
        }
    }

    /**
     * @param {Object} session - sesja CV / cofnięcia rekordu
     * @param {{ by?: 'owner'|'admin', actorName?: string|null, client?: object|null, skipUndoInvalidate?: boolean }} opts
     *   Po cofnięciu unieważniamy przycisk „Cofnij wynik" gracza — inaczej ten sam rekord
     *   dałoby się cofnąć drugi raz (podwójny revert rankingu i osiągnięć).
     */
    async _cvRemoveRecord(session, opts = {}) {
        // Wszystkie cofnięcia dotyczą PROFILU z sesji (session.playerKey);
        // sesje utworzone przed wdrożeniem profili mają tylko userId = profil główny.
        // Cofaj ranking do stanu sprzed zgłoszenia (ignoruje rekordy B, C pobite po A)
        // skipGlobalRevert = true gdy pobito tylko rekord bossa (globalny ranking niezmieniony)
        if (!session.skipGlobalRevert) {
            try {
                await this.rankingService.revertUserRecord(
                    session.guildId, (session.playerKey || session.userId), session.previousRecord
                );
            } catch (e) {
                logger.error(`CV _cvRemoveRecord revert ranking error: ${e.message}`);
            }
        }
        // Usuń wszystkie wpisy historii od momentu zgłoszonego rekordu (A + B + C + ...)
        let removedRecordCount = 0;
        if (this.scoreHistoryService && session.newRecord?.timestamp) {
            removedRecordCount = await this.scoreHistoryService.removeEntriesAfter(
                session.guildId, (session.playerKey || session.userId), session.newRecord.timestamp
            ).catch(e => { logger.error(`CV _cvRemoveRecord revert history error: ${e.message}`); return 0; });
        }
        // ⚔️ Wyzwania — wynik wypisany z wyzwań BĘDĄCYCH W TOKU. Wyzwania rozstrzygnięte
        // zostają nietknięte: rezultat już padł i obie strony dostały powiadomienie.
        if (this.challengeService && session.newRecord?.timestamp) {
            await this.challengeService.removeScore(
                (session.playerKey || session.userId), session.newRecord.timestamp
            ).catch(e => logger.warn(`⚠️ Błąd wypisywania wyniku z wyzwań: ${e.message}`));
        }
        // Cofnij tylko osiągnięcia score/records zdobyte od momentu zgłoszonego rekordu — wcześniejsze zostają
        try {
            if (this.achievementService && session.newRecord?.timestamp) {
                await this.achievementService.clearAchievementsAfter(
                    session.guildId, (session.playerKey || session.userId), session.newRecord.timestamp,
                    { removedRecordCount, previousRecord: session.previousRecord }
                );
            }
        } catch (e) {
            logger.error(`CV _cvRemoveRecord revert achievements error: ${e.message}`);
        }
        // Cofnij per-boss rekord
        if (this.bossRecordService) {
            const bossNameToRevert = session.newRecord?.bossName ?? session.bossName ?? null;
            if (bossNameToRevert) {
                await this.bossRecordService.revertBossRecord(
                    session.guildId, (session.playerKey || session.userId), bossNameToRevert,
                    session.previousBossRecord ?? null
                ).catch(e => logger.error(`CV _cvRemoveRecord revert boss record error: ${e.message}`));
            }
        }

        // Przycisk „Cofnij wynik" pod ogłoszeniem przestaje działać (rekord już cofnięty)
        if (!opts.skipUndoInvalidate) {
            await this._invalidateUndoForSession(session, opts).catch(() => {});
        }

        // Cofnięcie rekordu potrafi zmienić czołówkę — odśwież ranking serwera na stronie.
        // Sync siedzi TUTAJ, a nie w wywołaniach, żeby objął każdą ścieżkę cofnięcia
        // (przycisk gracza/admina, akcje CV „usuń rekord" i „zablokuj").
        // Bez klienta payload nie zna daty dołączenia bota do serwera, a to ona ustawia
        // kolejność kafelków na stronie — wtedy odpuszczamy i czeka na cykliczny snapshot.
        if (opts.client) {
            this.webRankingSyncService?.syncGuild(session.guildId, opts.client).catch(() => {});
        } else if (this.webRankingSyncService?.isEnabled()) {
            logger.warn('_cvRemoveRecord bez opts.client — pominięto wysyłkę rankingu na stronę');
        }
    }

    /**
     * Oznacza rekord jako cofnięty w magazynie sesji i (gdy podano klienta) aktualizuje
     * przyciski: ogłoszenie publiczne + embed admina dostają nieaktywny czerwony przycisk.
     */
    async _invalidateUndoForSession(session, { by = 'admin', actorName = null, client = null } = {}) {
        if (!this.recordRevertService) return;
        const key = session.publicMsgId || session.messageId || null;
        const recSession = key
            ? this.recordRevertService.get(key)
            : this.recordRevertService.getLatest(session.playerKey || session.userId, session.guildId);
        if (!recSession || this._isSessionReverted(recSession.status)) return;
        await this.recordRevertService.markReverted(recSession.publicMsgId, by, actorName);
        if (client) {
            await this._applyRevertVisuals(client, recSession, by, actorName).catch(() => {});
        }
    }

    /**
     * Unieważnia przycisk cofnięcia dla OSTATNIEGO rekordu profilu — używane tam, gdzie admin
     * usuwa dane inną drogą niż przycisk cofnięcia (usunięcie gracza/wyniku, kasowanie profilu).
     */
    /**
     * @param {'admin'|'profile_deleted'} by - powód unieważnienia; decyduje o etykiecie
     *        przycisku pod ogłoszeniem („Cofnął admin" vs „Profil usunięty")
     */
    /**
     * @param {string|null} expectPublicMsgId - gdy podane, unieważniamy WYŁĄCZNIE wtedy, gdy
     *        ostatnia sesja profilu to dokładnie ten rekord. Bez tej kontroli cofnięcie jednej
     *        akcji potrafiło ostemplować jako „cofnięty" zupełnie inny, poprawny rekord gracza
     *        — tak zginął legalny rekord bossa przy cofaniu analizy „No record broken".
     *        Ścieżki, które kasują dane gracza hurtem (usunięcie gracza/wyniku/profilu),
     *        nie podają go i celują w ostatni rekord, bo o to tam właśnie chodzi.
     */
    async _invalidateUndoForPlayer(client, playerKey, guildId, actorName = null, { by = 'admin', expectPublicMsgId = null } = {}) {
        if (!this.recordRevertService) return;
        const recSession = this.recordRevertService.getLatest(playerKey, guildId);
        if (!recSession || this._isSessionReverted(recSession.status)) return;
        if (expectPublicMsgId && recSession.publicMsgId !== expectPublicMsgId) {
            logger.warn(`Pominięto unieważnienie cofnięcia: ostatni rekord profilu (${recSession.publicMsgId}) to nie ten cofany (${expectPublicMsgId})`);
            return;
        }
        await this.recordRevertService.markReverted(recSession.publicMsgId, by, actorName);
        if (client) await this._applyRevertVisuals(client, recSession, by, actorName).catch(() => {});
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
    /**
     * Generuje wykres progresu graczy dla wskazanej strony rankingu globalnego.
     * @returns {Promise<AttachmentBuilder|null>}
     */
    async _buildGlobalRankingChartAttachment(players, currentPage, allGuildIds, t) {
        if (!this.chartService?.generatePlayersProgressChart || !this.scoreHistoryService) return null;
        const perPage = this.config.ranking.playersPerPage;
        const pagePlayers = players.slice(currentPage * perPage, (currentPage + 1) * perPage);
        if (pagePlayers.length === 0) return null;
        try {
            const histories = await Promise.all(
                pagePlayers.map(async (p) => {
                    const entries = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIds, p.playerKey || p.userId);
                    return {
                        userId: p.userId,
                        name: p.username || p.userId,
                        entries: entries.filter(e => typeof e.scoreValue === 'number' && e.scoreValue > 0),
                    };
                })
            );
            const chartTitle = t('📊 Porównanie Wyników', '📊 Score Comparison');
            const buf = await this.chartService.generatePlayersProgressChart(histories, chartTitle);
            if (!buf) return null;
            return new AttachmentBuilder(buf, { name: 'ranking_progress.png' });
        } catch (err) {
            logger.warn('Błąd generowania wykresu progresu graczy:', err);
            return null;
        }
    }

    // Wykres dla rankingu konkretnego bossa — filtruje historię tylko do wpisów tego bossa.
    // Dla graczy bez historii na tym bossie (rekord bez pobicia globalnego) używa aktualnego
    // wpisu boss_records jako pojedynczego punktu danych.
    async _buildBossRankingChartAttachment(players, currentPage, allGuildIds, bossName, t) {
        if (!this.chartService?.generatePlayersProgressChart || !this.scoreHistoryService) return null;
        const perPage = this.config.ranking.playersPerPage;
        const pagePlayers = players.slice(currentPage * perPage, (currentPage + 1) * perPage);
        if (pagePlayers.length === 0) return null;
        try {
            const histories = await Promise.all(
                pagePlayers.map(async (p) => {
                    const allEntries = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIds, p.playerKey || p.userId);
                    const bossEntries = allEntries.filter(e =>
                        typeof e.scoreValue === 'number' && e.scoreValue > 0 && e.bossName === bossName
                    );
                    // Brak historii dla tego bossa (np. tylko rekord bossa, nie globalny) →
                    // użyj aktualnego rekordu jako pojedynczego punktu
                    const finalEntries = bossEntries.length > 0 ? bossEntries : [{
                        scoreValue: p.scoreValue,
                        score: p.score,
                        timestamp: p.timestamp,
                        bossName,
                    }];
                    return {
                        userId: p.userId,
                        name: p.username || p.userId,
                        entries: finalEntries,
                    };
                })
            );
            const chartTitle = `📊 ${bossName}`;
            const buf = await this.chartService.generatePlayersProgressChart(histories, chartTitle);
            if (!buf) return null;
            return new AttachmentBuilder(buf, { name: 'boss_ranking_progress.png' });
        } catch (err) {
            logger.warn('Błąd generowania wykresu rankingu bossa:', err);
            return null;
        }
    }

    /**
     * Pozycja profilu w rankingu danego bossa NA SERWERZE (nie globalnie) — linijka w Embedzie 1.
     * /test (dryRun) korzysta z symulacji, żeby podgląd był identyczny jak po zapisie.
     * @returns {Promise<{position: number, total: number}|null>}
     */
    async _buildBossServerPosition(guildId, bossName, playerKey, opts = {}) {
        if (!this.bossRecordService || !guildId || !bossName || !playerKey) return null;
        const { dryRun = false, scoreValue = 0, score = null, username = null } = opts;
        try {
            const ranking = dryRun
                ? await this.bossRecordService.simulateGlobalBossRanking([guildId], bossName, playerKey, scoreValue, score, username, guildId)
                : await this.bossRecordService.getGlobalBossRanking([guildId], bossName);
            const idx = ranking.findIndex(p => (p.playerKey || p.userId) === playerKey);
            if (idx === -1) return null;
            return { position: idx + 1, total: ranking.length };
        } catch {
            return null;
        }
    }

    // Buduje dane snippetu zmiany w rankingu bossa (format identyczny jak globalSnippetData).
    // Zwraca { title, description } lub null.
    async _buildBossSnippetData(playerKey, bossName, previousBossRecord, allGuildIds, msgs, client, bossRankingOverride = null) {
        if (!this.bossRecordService || !this.globalTop10Service) return { snippetData: null, override: null };
        try {
            // /test (dryRun): symulowany ranking bossa (z nowym wynikiem, bez zapisu); inaczej realny stan po zapisie
            const bossRanking = bossRankingOverride || await this.bossRecordService.getGlobalBossRanking(allGuildIds, bossName);
            const matchKey = (p) => (p.playerKey || p.userId) === playerKey;
            const newBossIdx = bossRanking.findIndex(matchKey);
            if (newBossIdx === -1) return { snippetData: null, override: null };
            const newBossPosition = newBossIdx + 1;

            let prevBossPosition = null;
            if (previousBossRecord) {
                const prevVal = this.rankingService.parseScoreValue(previousBossRecord.score);
                const temp = bossRanking.map(p => matchKey(p) ? { ...p, scoreValue: prevVal } : p);
                temp.sort(compareByScoreThenTimestamp);
                const prevIdx = temp.findIndex(matchKey);
                prevBossPosition = prevIdx !== -1 ? prevIdx + 1 : null;
            }

            const snippetData = await this.globalTop10Service.buildBossSnippetFieldData(
                playerKey, bossRanking, prevBossPosition, bossName, msgs, client
            );

            const bossPositionChange = prevBossPosition !== null ? prevBossPosition - newBossPosition : 0;
            const override = {
                position: newBossPosition,
                positionChange: bossPositionChange,
                isNewEntry: prevBossPosition === null,
                label: msgs.recordBossRanking
            };

            return { snippetData, override };
        } catch {
            return { snippetData: null, override: null };
        }
    }

    async _handleRankingSelect(interaction, customId) {
        await interaction.deferUpdate();

        // Wychodzimy z rankingu bossa — inaczej paginacja tej wiadomości wracałaby do bossa
        this._bossRankings.delete(interaction.message.id);

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
                const globalIdx = this._findCallerIndex(globalRanking, callerUserId);
                const serverPlayers = await this.rankingService.getSortedPlayers(interaction.guildId);
                const serverIdx = this._findCallerIndex(serverPlayers, callerUserId);
                callerStats = {
                    score: globalIdx !== -1 ? globalRanking[globalIdx].score : null,
                    serverPosition: serverIdx !== -1 ? serverIdx + 1 : null,
                    globalPosition: globalIdx !== -1 ? globalIdx + 1 : null,
                    rolePositions: [],
                    noScoreNote: globalIdx === -1 ? this._mainProfileNoScoreNote(callerUserId, this.msgs(interaction.guildId)) : null
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
                            const roleIdx = this._findCallerIndex(rolePlayers, callerUserId);
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
            const callerIdx = this._findCallerIndex(players, interaction.user.id);
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
                    callerStats,
                    callerPlayerKey: this._mainPlayerKey(interaction.user.id)
                }
            );
            const buttons = this.rankingService.createRankingButtons(
                currentPage, totalPages, false, rankMsgs, roleRows,
                { userPage, mode, guildId, guildName, parentGuildId, parentGuildName }
            );

            let chartAttachment = null;
            if (mode === 'global') {
                const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                const t = this._panelT(interaction.guildId);
                chartAttachment = await this._buildGlobalRankingChartAttachment(players, currentPage, allGuildIds, t);
            }

            const replyEmbeds = chartAttachment
                ? [embed, new EmbedBuilder().setImage('attachment://ranking_progress.png')]
                : [embed];
            const replyOpts = { content: null, embeds: replyEmbeds, components: buttons, attachments: [] };
            if (chartAttachment) {
                replyOpts.files = [chartAttachment];
                delete replyOpts.attachments;
            }

            const reply = await interaction.editReply(replyOpts);

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
        this._bossRankings.delete(interaction.message.id);
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
        this._bossRankings.delete(interaction.message.id);
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
            const callerIdx = this._findCallerIndex(players, parentUserId);
            const userPage = callerIdx !== -1
                ? Math.floor(callerIdx / this.config.ranking.playersPerPage)
                : null;

            const btnOptions = { userPage, mode: 'role', guildId, guildName };

            if (players.length === 0) {
                const emptyButtons = this.rankingService.createRankingButtons(0, 1, false, msgs, roleRows, btnOptions);
                await interaction.editReply({
                    content: formatMessage(msgs.roleRankingEmpty, { roleName }),
                    embeds: [],
                    components: emptyButtons,
                    attachments: []
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
                { mode: 'server', client: null, messages: msgs, callerStats: parentCallerStats, callerPlayerKey: this._mainPlayerKey(parentUserId), titleOverride: formatMessage(msgs.roleRankingTitle, { roleName }) }
            );
            const buttons = this.rankingService.createRankingButtons(0, totalPages, false, msgs, roleRows, btnOptions);

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons, attachments: [] });
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
        // Wychodzimy z rankingu bossa — inaczej paginacja tej wiadomości wracałaby do bossa
        this._bossRankings.delete(interaction.message.id);
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

            let guildChartAttachment = null;
            if (this.chartService?.generateGuildComparisonChart) {
                try {
                    const t = this._panelT(interaction.guildId);
                    const chartTitle = t('📊 Porównanie Serwerów', '📊 Server Comparison');
                    const pageGuildScores = guildScores.slice(0, perPage);
                    const buf = await this.chartService.generateGuildComparisonChart(pageGuildScores, chartTitle, this._chartLang(interaction.guildId));
                    if (buf) {
                        const { AttachmentBuilder } = require('discord.js');
                        guildChartAttachment = new AttachmentBuilder(buf, { name: 'guild_comparison.png' });
                    }
                } catch (err) {
                    logger.warn('Błąd generowania wykresu porównania serwerów:', err);
                }
            }

            const embeds = guildChartAttachment
                ? [embed, new (require('discord.js').EmbedBuilder)().setImage('attachment://guild_comparison.png')]
                : [embed];
            const replyOpts = { content: null, embeds, components: buttons, attachments: [] };
            if (guildChartAttachment) replyOpts.files = [guildChartAttachment];

            const reply = await interaction.editReply(replyOpts);
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
            const allAchGuildIds = this._getProfileAllGuildIds(interaction.client);
            const { embed, components } = await this.achievementService.buildAchievementsViewGlobal(
                allAchGuildIds, this.profileRegistryService?.getMainPlayerKey(userId) || userId, lang, 'overview', null
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
            const allAchGuildIds = this._getProfileAllGuildIds(interaction.client);
            const { embed, components } = await this.achievementService.buildAchievementsViewGlobal(
                allAchGuildIds, this.profileRegistryService?.getMainPlayerKey(userId) || userId, lang, view, category
            );
            await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd przycisku osiągnięć: ${err.message}`);
        }
    }

    // ─── /profile ──────────────────────────────────────────────────────────────

    _getProfileAllGuildIds(client) {
        return new Set(
            this.config.getAllGuilds()
                .filter(g => client.guilds.cache.has(g.id))
                .map(g => g.id)
        );
    }

    // Pobiera lang dla profilu — na serwerze admina (brak konfiguracji) fallback na targetGuildId
    /**
     * Komunikaty po JĘZYKU, nie po serwerze — widok profilu trzyma `state.lang`
     * (język wyliczony przez `_getProfileLang`), który nie musi pokrywać się
     * z językiem serwera, na którym wywołano komendę.
     */
    _msgsByLang(lang) {
        return lang === 'pol' ? MESSAGES.pol : MESSAGES.eng;
    }

    _getProfileLang(interactionGuildId, targetGuildId) {
        const cfg = this.config.getGuildConfig(interactionGuildId);
        if (cfg?.lang) return cfg.lang;
        const targetCfg = this.config.getGuildConfig(targetGuildId);
        if (targetCfg?.lang) return targetCfg.lang;
        return 'pol';
    }

    async handleProfileCommand(interaction) {
        const guildId      = interaction.guildId;
        const isAdminGuild = this.config.adminGuildId && guildId === this.config.adminGuildId;

        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const viewerId    = interaction.user.id;
            const allGuildIds = this._getProfileAllGuildIds(interaction.client);
            // Domyślnie pokazujemy aktywny profil gracza (przełączanie przyciskami niżej)
            const viewerPlayerKey = this.profileRegistryService?.getMainPlayerKey(viewerId) || viewerId;
            const viewerProfiles = this.profileRegistryService?.getProfiles(viewerId) || [];

            // Zawsze używaj serwera skąd pochodzi najlepszy wynik profilu
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
            const entry = globalRanking.find(p => (p.playerKey || p.userId) === viewerPlayerKey);
            let targetGuildId = entry?.sourceGuildId || guildId;

            const lang  = this._getProfileLang(guildId, targetGuildId);
            const isPol = lang === 'pol';

            const data = await this.profileService.collectData(targetGuildId, viewerPlayerKey, allGuildIds, interaction.client);
            const embed = this.profileService.buildMainEmbed(data, isPol);
            const state = {
                viewerId, targetPlayerKey: viewerPlayerKey, targetGuildId,
                lang,
                view: 'main', category: null, bossPage: 0, bossMaxPage: 1, cachedData: data,
            };
            const components = this.profileService.buildProfileComponents(
                {
                    view: 'main', category: null, bossPage: 0, bossMaxPage: 1, isOwnProfile: true,
                    ownProfiles: viewerProfiles,
                    currentProfileIndex: getProfileIndex(viewerPlayerKey),
                    mainProfileIndex: this.profileRegistryService?.getMainIndex(viewerId) || 1,
                    potdHidden: this.playerOfTheDayService?.isOptedOut(viewerId) || false,
                },
                isPol
            );
            const replyMsg = await interaction.editReply({ embeds: [embed], components });
            this._profileStates.set(replyMsg.id, state);
            setTimeout(() => this._profileStates.delete(replyMsg.id), 15 * 60 * 1000);
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd /profile: ${err.message}`);
            await interaction.editReply({ content: this.msgs(interaction.guildId).generalError }).catch(() => {});
        }
    }

    async _handleProfileButton(interaction) {
        const customId = interaction.customId;
        const state = this._profileStates.get(interaction.message.id);
        const msgs   = this.msgs(interaction.guildId);

        if (!state || state.view === 'select') {
            await interaction.reply({ content: msgs.profileExpired, flags: ['Ephemeral'] });
            return;
        }
        if (interaction.user.id !== state.viewerId) {
            await interaction.reply({ content: msgs.profileWrongUser, flags: ['Ephemeral'] });
            return;
        }

        if (customId === 'profile_search') {
            const isPol = (state.lang || 'pol') === 'pol';
            const t = (pol, eng) => isPol ? pol : eng;
            const modal = new ModalBuilder()
                .setCustomId('profile_search_modal')
                .setTitle(t('🔍 Szukaj gracza', '🔍 Search Player'));
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('profile_search_query')
                        .setLabel(t('Fragment nicku gracza', 'Part of player\'s nick'))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(2)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        if (customId === 'profile_manage_subs') {
            await this.handleNotificationsCommand(interaction);
            return;
        }

        // Panel zarządzania profilami (kilka kont w grze) — osobny ephemeral,
        // żeby modale nazwy i potwierdzenia nie kolidowały ze stanem widoku profilu
        if (customId === 'profile_manage_prof') {
            await this.handleProfilesPanel(interaction);
            return;
        }

        // Pierwsze dodatkowe konto — najpierw wyjaśnienie, potem dopiero nazwa profilu
        if (customId === 'profile_add_intro') {
            await this.handleProfileAddIntro(interaction);
            return;
        }

        await interaction.deferUpdate();
        try {
            const guildId = interaction.guildId;
            const isPol   = (state.lang || 'pol') === 'pol';
            const allGuildIds = this._getProfileAllGuildIds(interaction.client);

            if (customId === 'profile_track') {
                // Ustawienie profilu MAIN (pinezka) — od teraz jego dane pokazują
                // /ranking (statystyki, „Moja pozycja", wykres), /achievements i /profile,
                // jest podpowiadany przy /update i nie można go usunąć.
                // setMain odwołuje też ewentualne zaplanowane usunięcie tego profilu.
                const wantedIdx = getProfileIndex(state.targetPlayerKey);
                // Cudzy profil pomijamy — mainem można ustawić wyłącznie własny
                if (getOwnerId(state.targetPlayerKey) === state.viewerId
                    && await this.profileRegistryService?.setMain(state.viewerId, wantedIdx)) {
                    const prof = this.profileRegistryService.getProfiles(state.viewerId).find(pr => pr.index === wantedIdx);
                    const profName = prof ? this._profileDisplayName(prof, msgs) : `#${wantedIdx}`;
                    this.logService._gl(guildId).info(
                        `📌 ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, state.viewerId)} ustawił profil #${wantedIdx} jako main`
                    );
                    await interaction.followUp({
                        content: formatMessage(msgs.profileSetMainDone, { profile: profName }),
                        flags: ['Ephemeral'],
                    }).catch(() => {});
                }
            } else if (customId === 'profile_potd_toggle') {
                // Wypisanie działa NATYCHMIAST: gdy wypisuje się dzisiejszy gracz dnia,
                // serwis kasuje wpis na stronie, zamiast czekać na kolejne losowanie.
                const potd = this.playerOfTheDayService;
                if (potd) {
                    const nowHidden = !potd.isOptedOut(state.viewerId);
                    await potd.setOptOut(state.viewerId, nowHidden);
                    await interaction.followUp({
                        content: nowHidden ? msgs.profilePotdHidden : msgs.profilePotdShown,
                        flags: ['Ephemeral'],
                    }).catch(() => {});
                }
            } else if (customId.startsWith('profile_view_')) {
                // Przełączenie widoku na inny profil TEGO SAMEGO gracza
                const wantedIdx = parseInt(customId.slice('profile_view_'.length), 10);
                if (this.profileRegistryService?.hasProfile(state.viewerId, wantedIdx)) {
                    state.targetPlayerKey = makePlayerKey(state.viewerId, wantedIdx);
                    state.view = 'main';
                    state.category = null;
                    state.bossPage = 0;
                    state.cachedData = null;
                    const switchRanking = await this.rankingService.getGlobalRanking(allGuildIds);
                    const switchEntry = switchRanking.find(p => (p.playerKey || p.userId) === state.targetPlayerKey);
                    state.targetGuildId = switchEntry?.sourceGuildId || state.targetGuildId || guildId;
                    state.lang = this._getProfileLang(guildId, state.targetGuildId);
                }
            } else if (customId === 'profile_back') {
                state.targetPlayerKey   = this.profileRegistryService?.getMainPlayerKey(state.viewerId) || state.viewerId;
                state.view           = 'main';
                state.category       = null;
                state.bossPage       = 0;
                state.cachedData     = null;
                state.isSubscribed   = false;
                state.subscriberCount = null;
                // Zawsze używaj serwera skąd pochodzi najlepszy wynik gracza
                const backRanking = await this.rankingService.getGlobalRanking(allGuildIds);
                const backEntry = backRanking.find(p => (p.playerKey || p.userId) === state.targetPlayerKey);
                state.targetGuildId = backEntry?.sourceGuildId || guildId;
                state.lang = this._getProfileLang(guildId, state.targetGuildId);
            } else if (customId === 'profile_subscribe') {
                const targetUsername  = state.cachedData?.username || state.targetPlayerKey;
                const targetGuildName = interaction.client.guilds.cache.get(state.targetGuildId)?.name || state.targetGuildId;
                const added = await this.notificationService.addSubscription(
                    state.viewerId, state.targetPlayerKey, state.targetGuildId, targetUsername, targetGuildName
                );
                if (added && this.achievementService) {
                    this.achievementService.trackSubscription(guildId, state.viewerId).catch(() => {});
                }
                state.isSubscribed = true;
                if (state.subscriberCount !== null) state.subscriberCount = (state.subscriberCount || 0) + (added ? 1 : 0);
            } else if (customId === 'profile_unsubscribe') {
                const removed = await this.notificationService.removeSubscription(
                    state.viewerId, state.targetPlayerKey, state.targetGuildId
                );
                state.isSubscribed = false;
                if (state.subscriberCount !== null && removed) state.subscriberCount = Math.max(0, (state.subscriberCount || 1) - 1);
            } else if (customId === 'profile_main') {
                state.view = 'main';
            } else if (customId === 'profile_bosses') {
                state.view     = 'bosses';
                state.bossPage = 0;
            } else if (customId === 'profile_bosses_prev') {
                state.bossPage = Math.max(0, state.bossPage - 1);
            } else if (customId === 'profile_bosses_next') {
                state.bossPage = Math.min(state.bossMaxPage - 1, state.bossPage + 1);
            } else if (customId === 'profile_challenges') {
                state.view     = 'challenges';
                state.chalPage = 0;
            } else if (customId === 'profile_chal_prev') {
                state.chalPage = Math.max(0, (state.chalPage || 0) - 1);
            } else if (customId === 'profile_chal_next') {
                state.chalPage = Math.min((state.chalMaxPage || 1) - 1, (state.chalPage || 0) + 1);
            } else if (customId === 'profile_ach_overview') {
                state.view     = 'ach_overview';
                state.category = null;
            } else if (customId.startsWith('profile_ach_cat_')) {
                state.view     = 'ach_cat';
                state.category = customId.replace('profile_ach_cat_', '');
            }

            // Jeśli zmieniamy gracza (back) lub nie ma cache → odśwież dane
            if (!state.cachedData) {
                state.cachedData = await this.profileService.collectData(
                    state.targetGuildId, state.targetPlayerKey, allGuildIds, interaction.client
                );
            }
            const data = state.cachedData;

            let embed;
            let files = [];
            const isOwnProfileNow = getOwnerId(state.targetPlayerKey) === state.viewerId;
            if (state.view === 'main') {
                const subCount = !isOwnProfileNow ? (state.subscriberCount ?? null) : null;
                embed = this.profileService.buildMainEmbed(data, isPol, subCount);
            } else if (state.view === 'bosses') {
                const result = await this.profileService.buildBossesEmbed(data, isPol, state.bossPage);
                embed = result.embed;
                files = result.files || [];
                state.bossMaxPage = result.totalPages;
                state.bossPage    = result.currentPage;
            } else if (state.view === 'challenges') {
                const chalResult = await this._buildChallengeProfileEmbed(
                    state.targetPlayerKey, data.username, this._msgsByLang(state.lang || 'pol'),
                    state.chalPage || 0, isOwnProfileNow
                );
                embed = chalResult.embed;
                state.chalMaxPage = chalResult.maxPage;
                state.chalPage    = Math.min(state.chalPage || 0, chalResult.maxPage - 1);
                if (data.userAvatarURL) embed.setThumbnail(data.userAvatarURL);
            } else {
                const achView   = state.view === 'ach_overview' ? 'overview' : 'cat';
                const isOwnProf = getOwnerId(state.targetPlayerKey) === state.viewerId;
                const lang      = isPol ? 'pol' : 'eng';
                let achResult;
                if (isOwnProf) {
                    achResult = await this.achievementService.buildAchievementsViewGlobal(
                        allGuildIds, state.targetPlayerKey, lang, achView, state.category
                    );
                } else {
                    achResult = await this.achievementService.buildAchievementsViewForUserGlobal(
                        allGuildIds, state.targetPlayerKey, data.username, lang, achView, state.category, state.targetGuildId
                    );
                }
                embed = achResult.embed;
                if (data.userAvatarURL) embed.setThumbnail(data.userAvatarURL);
            }

            const components = this.profileService.buildProfileComponents({
                view: state.view,
                category: state.category,
                bossPage: state.bossPage,
                bossMaxPage: state.bossMaxPage,
                isOwnProfile: isOwnProfileNow,
                isSubscribed: state.isSubscribed || false,
                ownProfiles: isOwnProfileNow ? (this.profileRegistryService?.getProfiles(state.viewerId) || []) : [],
                currentProfileIndex: getProfileIndex(state.targetPlayerKey),
                mainProfileIndex: this.profileRegistryService?.getMainIndex(state.viewerId) || 1,
                potdHidden: this.playerOfTheDayService?.isOptedOut(state.viewerId) || false,
                chalPage: state.chalPage || 0,
                chalMaxPage: state.chalMaxPage || 1,
            }, isPol);

            await interaction.editReply({ embeds: [embed], components, files, attachments: [] });
            this._profileStates.set(interaction.message.id, state);
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd przycisku /profile: ${err.message}`);
        }
    }

    async _handleProfileSearchModal(interaction) {
        const state = this._profileStates.get(interaction.message?.id);
        await interaction.deferUpdate();
        try {
            const guildId     = interaction.guildId;
            const viewerId    = interaction.user.id;
            const msgs        = this.msgs(guildId);
            const lang        = state?.lang || this._getProfileLang(guildId, guildId);
            const isPol       = lang === 'pol';
            const query       = normalizeForSearch(interaction.fields.getTextInputValue('profile_search_query').trim());
            const allGuildIds = this._getProfileAllGuildIds(interaction.client);

            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
            const matches = globalRanking.filter(p =>
                playerMatchesQuery(p, query, interaction.client, p.sourceGuildId || null)
            );

            if (matches.length > 0 && this.achievementService) {
                this.achievementService.trackProfileSearch(guildId, viewerId).catch(() => {});
            }

            if (matches.length === 0) {
                // Pokaż błąd z powrotem do aktualnego profilu (zachowaj stan)
                const t = (pol, eng) => isPol ? pol : eng;
                const notFoundRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('profile_search')
                        .setLabel(t('Szukaj ponownie', 'Search again'))
                        .setEmoji('🔍')
                        .setStyle(ButtonStyle.Secondary)
                );
                // Przywróć poprzedni embed profilu jeśli mamy cached data
                if (state?.cachedData && state.view !== 'select') {
                    const prevEmbed = this.profileService.buildMainEmbed(state.cachedData, isPol);
                    const isOwnPrev = getOwnerId(state.targetPlayerKey) === state.viewerId;
                    const prevComponents = this.profileService.buildProfileComponents(
                        {
                            view: state.view || 'main', category: state.category, bossPage: state.bossPage,
                            bossMaxPage: state.bossMaxPage, isOwnProfile: isOwnPrev,
                            ownProfiles: isOwnPrev ? (this.profileRegistryService?.getProfiles(state.viewerId) || []) : [],
                            currentProfileIndex: getProfileIndex(state.targetPlayerKey),
                            mainProfileIndex: this.profileRegistryService?.getMainIndex(state.viewerId) || 1,
                            potdHidden: this.playerOfTheDayService?.isOptedOut(state.viewerId) || false,
                        },
                        isPol
                    );
                    await interaction.editReply({
                        content: msgs.profileNotFound.replace('{query}', query),
                        embeds: [prevEmbed],
                        components: prevComponents,
                    });
                } else {
                    await interaction.editReply({ content: msgs.profileNotFound.replace('{query}', query), embeds: [], components: [notFoundRow] });
                }
                return;
            }

            if (matches.length === 1) {
                const targetPlayerKey  = matches[0].playerKey || matches[0].userId;
                const targetGuildId = matches[0].sourceGuildId || guildId;
                const newLang = this._getProfileLang(guildId, targetGuildId);
                const newIsPol = newLang === 'pol';
                const isOwnProfile = getOwnerId(targetPlayerKey) === viewerId;

                let isSubscribed = false;
                let subscriberCount = null;
                if (!isOwnProfile && this.notificationService) {
                    const [viewerSubs, targetSubscribers] = await Promise.all([
                        this.notificationService.getSubscriptions(viewerId),
                        this.notificationService.getSubscribersForTarget(targetPlayerKey, targetGuildId),
                    ]);
                    isSubscribed = viewerSubs.some(s => s.targetPlayerKey === targetPlayerKey && s.targetGuildId === targetGuildId);
                    subscriberCount = targetSubscribers.length;
                }

                const data = await this.profileService.collectData(targetGuildId, targetPlayerKey, allGuildIds, interaction.client);
                const embed = this.profileService.buildMainEmbed(data, newIsPol, subscriberCount);
                const newState = {
                    viewerId, targetPlayerKey, targetGuildId, lang: newLang,
                    view: 'main', category: null, bossPage: 0, bossMaxPage: 1, cachedData: data,
                    isSubscribed, subscriberCount,
                };
                const components = this.profileService.buildProfileComponents(
                    {
                        view: 'main', category: null, bossPage: 0, bossMaxPage: 1, isOwnProfile, isSubscribed,
                        ownProfiles: isOwnProfile ? (this.profileRegistryService?.getProfiles(viewerId) || []) : [],
                        currentProfileIndex: getProfileIndex(targetPlayerKey),
                        mainProfileIndex: this.profileRegistryService?.getMainIndex(viewerId) || 1,
                        potdHidden: this.playerOfTheDayService?.isOptedOut(viewerId) || false,
                    },
                    newIsPol
                );
                await interaction.editReply({ content: null, embeds: [embed], components });
                if (interaction.message?.id) this._profileStates.set(interaction.message.id, newState);
                return;
            }

            const options = matches.slice(0, 25).map(p => ({
                label: formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 100),
                description: `${interaction.client.guilds.cache.get(p.sourceGuildId)?.name || p.sourceGuildId} · ${p.score}`.slice(0, 100),
                value: `${p.playerKey || p.userId}:${p.sourceGuildId || guildId}`,
            }));
            const select = new StringSelectMenuBuilder()
                .setCustomId('profile_search_sel')
                .setPlaceholder(msgs.profileSelectPlaceholder)
                .addOptions(options.map(o => new StringSelectMenuOptionBuilder().setLabel(o.label).setDescription(o.description).setValue(o.value)));
            await interaction.editReply({
                content: msgs.profileMultipleResults.replace('{count}', matches.length),
                embeds: [],
                components: [new ActionRowBuilder().addComponents(select)],
            });
            if (interaction.message?.id) {
                const updState = this._profileStates.get(interaction.message.id) || {};
                this._profileStates.set(interaction.message.id, {
                    ...updState, viewerId, lang, view: 'select', cachedData: updState.cachedData ?? null,
                });
            }
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd profile search modal: ${err.message}`);
        }
    }

    async _handleProfileSearchSelect(interaction) {
        await interaction.deferUpdate();
        try {
            const [targetPlayerKey, targetGuildId] = interaction.values[0].split(':');
            const guildId    = interaction.guildId;
            const viewerId   = interaction.user.id;
            const lang       = this._getProfileLang(guildId, targetGuildId);
            const isPol      = lang === 'pol';
            const allGuildIds = this._getProfileAllGuildIds(interaction.client);
            const isOwnProfile = getOwnerId(targetPlayerKey) === viewerId;

            let isSubscribed = false;
            let subscriberCount = null;
            if (!isOwnProfile && this.notificationService) {
                const [viewerSubs, targetSubscribers] = await Promise.all([
                    this.notificationService.getSubscriptions(viewerId),
                    this.notificationService.getSubscribersForTarget(targetPlayerKey, targetGuildId),
                ]);
                isSubscribed = viewerSubs.some(s => s.targetPlayerKey === targetPlayerKey && s.targetGuildId === targetGuildId);
                subscriberCount = targetSubscribers.length;
            }

            const data = await this.profileService.collectData(targetGuildId, targetPlayerKey, allGuildIds, interaction.client);
            const embed = this.profileService.buildMainEmbed(data, isPol, subscriberCount);
            const newState = {
                viewerId, targetPlayerKey, targetGuildId, lang,
                view: 'main', category: null, bossPage: 0, bossMaxPage: 1, cachedData: data,
                isSubscribed, subscriberCount,
            };
            const components = this.profileService.buildProfileComponents(
                {
                    view: 'main', category: null, bossPage: 0, bossMaxPage: 1, isOwnProfile, isSubscribed,
                    ownProfiles: isOwnProfile ? (this.profileRegistryService?.getProfiles(viewerId) || []) : [],
                    currentProfileIndex: getProfileIndex(targetPlayerKey),
                    mainProfileIndex: this.profileRegistryService?.getMainIndex(viewerId) || 1,
                    potdHidden: this.playerOfTheDayService?.isOptedOut(viewerId) || false,
                },
                isPol
            );
            await interaction.editReply({ content: null, embeds: [embed], components });
            if (interaction.message?.id) {
                this._profileStates.set(interaction.message.id, newState);
            }
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd profile search select: ${err.message}`);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────

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

            if (customId === 'chal_srv') { await this._handleChallengeServerSelect(interaction); return; }
            if (customId === 'chal_pl')  { await this._handleChallengePlayerSelect(interaction); return; }
            if (customId === 'chal_boss') { await this._handleChallengeBossSelect(interaction); return; }

            if (customId === 'boss_cfg_add_alias_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddAliasSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_add_lang_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgAddLangSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_rm_boss_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgRmBossSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_rm_alias_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgRmAliasSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_rm_entry_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgRmEntrySel(interaction);
                return;
            }

            if (customId === 'boss_cfg_edit_entry_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditEntrySel(interaction);
                return;
            }

            if (customId === 'boss_cfg_edit_alias_boss_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditAliasBossSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_edit_alias_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgEditAliasSel(interaction);
                return;
            }

            if (customId === 'boss_map_boss_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossMapBossSel(interaction);
                return;
            }

            if (customId === 'boss_map_lang_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossMapLangSel(interaction);
                return;
            }

            if (customId === 'boss_cfg_img_boss_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleBossCfgImgBossSel(interaction);
                return;
            }

            if (customId === 'ranking_boss_sel') {
                await this._handleRankingBossShow(interaction);
                return;
            }

            if (customId.startsWith('ranking_boss_ssel_')) {
                await this._handleRankingBossShow(interaction, customId.replace('ranking_boss_ssel_', ''));
                return;
            }

            if (customId === 'ach_check_sel') {
                await this._handleAchCheckSelect(interaction);
                return;
            }

            if (customId === 'profile_search_sel') {
                await this._handleProfileSearchSelect(interaction);
                return;
            }

            if (customId === 'panel_remove_select') {
                await this._handlePanelRemoveSelect(interaction);
                return;
            }

            if (customId === 'panel_remove_score_player') {
                await this._handlePanelRemoveScorePlayer(interaction);
                return;
            }
            if (customId === 'panel_remove_score_entry') {
                await this._handlePanelRemoveScoreEntry(interaction);
                return;
            }

            // Centrum Dowodzenia — selecty nowych akcji (tylko head admin)
            if (customId === 'cc_player_lookup_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcPlayerLookupSelect(interaction);
                return;
            }
            if (customId === 'cc_clear_cd_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcClearCooldownSelect(interaction);
                return;
            }
            if (customId === 'cc_kick_sel') {
                await this._handleCcKickSelect(interaction);
                return;
            }
            if (customId === 'cc_roles_sel') {
                const isAdminSel = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
                if (!this._isHeadAdmin(interaction.user.id) && !isAdminSel) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelProcessRoles(interaction, interaction.values[0]);
                return;
            }
            if (customId === 'cc_diag_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcDiagSelect(interaction);
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
                if (success === true) {
                    this._ccAudit(interaction, `🔓 Odblokowano gracza: ${username}`);
                    this.adminPanelService?.refresh();
                }
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
            if (customId === 'panel_delete_server_sel') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handlePanelDeleteServerDataSelect(interaction);
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

            if (customId === 'cc_potd_ps') {
                if (!this._isHeadAdmin(interaction.user.id)) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
                    return;
                }
                await this._handleCcPotdSelect(interaction);
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

            if (customId === 'cfg_mod_remove_select') {
                await this._handleCfgModRemoveSelect(interaction);
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
                .setValue(p.playerKey || p.userId)
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
        // Wartość to klucz profilu ("userId" lub "userId#N") — subskrybuje się konkretny profil
        const selectedPlayerKey = interaction.values[0];
        const selectedOwnerId = getOwnerId(selectedPlayerKey);
        const targetGuildName = interaction.client.guilds.cache.get(selectedGuildId)?.name || selectedGuildId;
        let targetUsername = selectedOwnerId;
        const players = await this.rankingService.getSortedPlayers(selectedGuildId);
        const player = players.find(p => (p.playerKey || p.userId) === selectedPlayerKey);
        if (player) targetUsername = player.username || selectedOwnerId;
        const targetGuild = interaction.client.guilds.cache.get(selectedGuildId);
        if (targetGuild) {
            try {
                const member = await targetGuild.members.fetch(selectedOwnerId);
                targetUsername = member.displayName;
            } catch {}
        }
        targetUsername = formatProfileDisplayName(targetUsername, getProfileIndex(selectedPlayerKey));
        const confirmText = formatMessage(msgs.notifConfirmText, { username: targetUsername, guild: targetGuildName });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`notif_confirm_${selectedPlayerKey}_${selectedGuildId}`)
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
        // customId: notif_confirm_{playerKey}_{guildId}  (playerKey = userId lub userId#N)
        const parts = customId.split('_');
        // parts: ['notif','confirm', playerKey, guildId]
        const targetPlayerKey = parts[2];
        const targetGuildId = parts[3];
        const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        const targetOwnerId = getOwnerId(targetPlayerKey);
        let targetUsername = targetOwnerId;
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
        if (player) targetUsername = player.username || targetOwnerId;
        const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
        if (targetGuild) {
            try {
                const member = await targetGuild.members.fetch(targetOwnerId);
                targetUsername = member.displayName;
            } catch {}
        }
        targetUsername = formatProfileDisplayName(targetUsername, getProfileIndex(targetPlayerKey));
        const added = await this.notificationService.addSubscription(
            interaction.user.id, targetPlayerKey, targetGuildId, targetUsername, targetGuildName
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
                .setValue(`${sub.targetPlayerKey || sub.targetUserId}_${sub.targetGuildId}`)
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
            // Profil dodatkowy → nick ze znacznikiem, żeby lista rozróżniała konta jednej osoby
            result.push({ ...player, displayName: formatProfileDisplayName(displayName, player.profileIndex || 1) });
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
                .setValue(p.playerKey || p.userId)
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
        const [targetPlayerKey, targetGuildId] = interaction.values[0].split('_');
        const subs = await this.notificationService.getSubscriptions(interaction.user.id);
        const sub = subs.find(s => (s.targetPlayerKey || s.targetUserId) === targetPlayerKey && s.targetGuildId === targetGuildId);
        const removed = await this.notificationService.removeSubscription(interaction.user.id, targetPlayerKey, targetGuildId);
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
     * Zwraca suffix ordinalny dla liczby angielskiej (1→st, 2→nd, 3→rd, N→th).
     */
    _enOrdinal(n) {
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
        switch (n % 10) {
            case 1: return `${n}st`;
            case 2: return `${n}nd`;
            case 3: return `${n}rd`;
            default: return `${n}th`;
        }
    }

    /**
     * Buduje uroczyste embedy ogłoszenia (PL + EN) dla nowego serwera.
     */
    _buildNewServerAnnouncementEmbeds(guild, serverNumber) {
        const guildName = guild?.name || '???';
        const memberCount = guild?.memberCount ?? 0;
        const icon = guild?.iconURL({ dynamic: true, size: 256 }) || null;

        const embedPL = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎉 Nowy serwer dołącza do rywalizacji!')
            .setDescription(
                `Witajcie, Mistrzowie **Ender's Echo**!\n\n` +
                `Z wielką radością ogłaszamy, że do grona serwerów uczestniczących w globalnej rywalizacji dołącza:\n\n` +
                `🏰 **${guildName}**\n` +
                `👥 **${memberCount.toLocaleString('pl-PL')}** członków\n` +
                `🔢 **${serverNumber}.** skonfigurowany serwer w rywalizacji!\n\n` +
                `Powitajcie nowych rywali serdecznie — niech najlepsi zwyciężą! ⚔️🏆`
            )
            .setTimestamp()
            .setFooter({ text: "Ender's Echo — Rywalizacja Międzyserwerowa" });
        if (icon) embedPL.setThumbnail(icon);

        const embedEN = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎉 A new server joins the competition!')
            .setDescription(
                `Greetings, **Ender's Echo** Champions!\n\n` +
                `We are thrilled to announce that a new server is joining the global competition:\n\n` +
                `🏰 **${guildName}**\n` +
                `👥 **${memberCount.toLocaleString('en-US')}** members\n` +
                `🔢 The **${this._enOrdinal(serverNumber)}** configured server in the competition!\n\n` +
                `Welcome our new rivals — may the best competitors win! ⚔️🏆`
            )
            .setTimestamp()
            .setFooter({ text: "Ender's Echo — Cross-Server Competition" });
        if (icon) embedEN.setThumbnail(icon);

        return { embedPL, embedEN };
    }

    /**
     * Automatycznie broadcastuje ogłoszenie o nowym serwerze na kanały wszystkich serwerów.
     * Wywoływana fire-and-forget z cfg_accept przy pierwszej konfiguracji serwera.
     */
    async _broadcastNewServerAnnouncement(client, targetGuild) {
        const configuredIds = this.guildConfigService.getAllConfiguredGuildIds();
        const serverNumber = configuredIds.length;
        const { embedPL, embedEN } = this._buildNewServerAnnouncementEmbeds(targetGuild, serverNumber);

        const sentMessages = [];
        for (const guildCfg of this.config.getAllGuilds()) {
            const lang = guildCfg.lang || 'pol';
            const embed = lang === 'eng' ? embedEN : embedPL;
            try {
                const guildObj = client.guilds.cache.get(guildCfg.id);
                if (!guildObj) continue;
                // Ten sam resolver co w diagnostyce i /info: odrzuca kanał z obcego
                // serwera i kanał, na który nie da się nic wysłać.
                const wynikKanalu = await this._pobierzKanalSerwera(client, guildObj, guildCfg.allowedChannelId);
                const channel = wynikKanalu.ch;
                if (!channel) {
                    logger.error(`Ogłoszenie nowego serwera pominięte dla "${guildObj.name}": kanał ${guildCfg.allowedChannelId} — powód=${wynikKanalu.powod}`);
                    continue;
                }
                const sent = await channel.send({ embeds: [embed] });
                sentMessages.push({ guildId: guildCfg.id, channelId: channel.id, messageId: sent.id });
            } catch (err) {
                const guildName = client.guilds.cache.get(guildCfg.id)?.name || guildCfg.id;
                logger.error(`Błąd wysyłania ogłoszenia nowego serwera do "${guildName}": ${err.message}`);
            }
        }

        // Rejestr kopii — bez niego reakcje z różnych serwerów nie mają jak się zsumować
        await this.broadcastReactionService?.register('new_server', sentMessages).catch(() => {});
    }

    /**
     * Ogłasza nowy serwer, jeśli właśnie odblokowano na nim OCR `/update`.
     *
     * Ogłoszenie celowo NIE leci po zakończeniu konfiguracji: nowy serwer startuje
     * z zablokowanym OCR, więc do momentu odblokowania nikt na nim nie zgłasza wyników
     * i nie bierze udziału w rywalizacji. Momentem, w którym serwer naprawdę do niej
     * dołącza, jest odblokowanie `/update` przez head admina — i to on wyzwala ogłoszenie.
     *
     * Wywoływana ze WSZYSTKICH ścieżek odblokowania (przycisk pod powiadomieniem
     * o konfiguracji, panel admina, komenda `/block-ocr`). Flaga `newServerAnnounced`
     * w `guild_configs.json` gwarantuje, że ogłoszenie poleci dokładnie raz — także
     * po restarcie bota i po ponownym wyłączeniu i włączeniu OCR.
     *
     * @param {import('discord.js').Client} client
     * @param {string} guildId - serwer, na którym odblokowano OCR
     * @param {string[]} unlockedCommands - komendy objęte odblokowaniem
     */
    async _maybeAnnounceNewServer(client, guildId, unlockedCommands) {
        try {
            if (!Array.isArray(unlockedCommands) || !unlockedCommands.includes('update')) return;
            if (!guildId || !this.guildConfigService) return;
            if (!this.guildConfigService.isConfigured(guildId)) return;
            if (this.guildConfigService.isNewServerAnnounced(guildId)) return;
            // Zabezpieczenie na wypadek, gdyby odblokowanie się nie zapisało
            if (this.ocrBlockService?.isBlocked(guildId, 'update')) return;

            const guild = client.guilds.cache.get(guildId)
                || await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                logger.error(`Ogłoszenie nowego serwera pominięte: serwer ${guildId} niedostępny`);
                return;
            }

            // Flagę stawiamy PRZED wysyłką — częściowo nieudany broadcast jest mniejszym
            // złem niż ogłoszenie tego samego serwera po raz drugi
            await this.guildConfigService.setNewServerAnnounced(guildId, true);
            logger.info(`📣 Ogłaszam nowy serwer "${guild.name}" — OCR /update właśnie odblokowany`);
            await this._broadcastNewServerAnnouncement(client, guild);
        } catch (err) {
            logger.error(`Błąd ogłoszenia nowego serwera (${guildId}): ${err.message}`);
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
        const sentMessages = [];

        for (const guildCfg of this.config.getAllGuilds()) {
            const guildObj = interaction.client.guilds.cache.get(guildCfg.id);
            const guildLabel = guildObj?.name || guildCfg.tag || guildCfg.id;
            const lang = guildCfg.lang || 'pol';

            // Serwer zostaje w konfiguracji także wtedy, gdy bot z niego wyleciał.
            // Wcześniej znikał z raportu bez słowa i „wysłano 8/9" nie miało jak się
            // zgodzić z liczbą serwerów pokazaną w podglądzie.
            if (!guildObj) {
                logger.error(`[/info] Pominięto "${guildLabel}" (${guildCfg.id}) — bota nie ma na tym serwerze`);
                results.push({
                    label: guildLabel, id: guildCfg.id, status: 'error', lang,
                    error: {
                        pol: 'Bota nie ma na tym serwerze (usunięty lub serwer niedostępny)',
                        eng: 'The bot is not on this server (removed or server unavailable)',
                        fix_pol: 'Zaproś bota ponownie albo usuń serwer z konfiguracji.',
                        fix_eng: 'Re-invite the bot or remove the server from the configuration.',
                    },
                    channelId: guildCfg.allowedChannelId, guildObj: null,
                });
                continue;
            }

            try {
                // Ten sam resolver, na którym stoi diagnostyka — inaczej obie strony
                // sprawdzają co innego i raport potrafi wskazywać nieistniejącą przyczynę
                // (np. „nadaj Wyświetl kanał" dla kanału z zupełnie innego serwera).
                const wynikKanalu = await this._pobierzKanalSerwera(interaction.client, guildObj, guildCfg.allowedChannelId);
                const channel = wynikKanalu.ch;
                if (!channel) {
                    logger.error(
                        `[/info] "${guildLabel}" (${guildCfg.id}): kanał ${guildCfg.allowedChannelId} odrzucony — powód=${wynikKanalu.powod}` +
                        (wynikKanalu.obcyGuildId ? ` (należy do ${wynikKanalu.obcyGuildId})` : '') +
                        (wynikKanalu.err ? ` (${wynikKanalu.err.code ?? '?'} ${wynikKanalu.err.message})` : ''));
                    results.push({
                        label: guildLabel, id: guildCfg.id, status: 'error', lang,
                        error: this._opisProblemuKanalu(wynikKanalu),
                        channelId: guildCfg.allowedChannelId, guildObj,
                    });
                    continue;
                }
                const description = lang === 'pol' ? data.descriptionPol : data.descriptionEng;
                const embed = this._buildInfoEmbed(data, data.user, description);
                const sent = await channel.send({ embeds: [embed] });
                sentMessages.push({ guildId: guildCfg.id, channelId: channel.id, messageId: sent.id });
                results.push({ label: guildLabel, id: guildCfg.id, status: 'ok', lang, guildObj });
            } catch (err) {
                /* Sam komunikat Discorda nie mówi, CO dokładnie zawiodło. Zapisujemy
                   więc stan, na którym operowaliśmy: do jakiego serwera należy kanał,
                   jakiego jest typu i jakie uprawnienia widzi na nim bot. To rozstrzyga
                   między „odebrano ViewChannel", „kanał z innego serwera" i „kanał
                   nietekstowy" bez zgadywania. */
                try {
                    const ch = await interaction.client.channels.fetch(guildCfg.allowedChannelId).catch(() => null);
                    const me = guildObj.members.me;
                    const upr = (ch && me && ch.guildId === guildObj.id)
                        ? me.permissionsIn(ch).toArray().join(', ')
                        : '(nie policzono)';
                    logger.error(
                        `[/info] Diagnoza "${guildLabel}" (${guildCfg.id}): kanał=${guildCfg.allowedChannelId}` +
                        ` | znaleziony=${ch ? 'tak' : 'nie'}` +
                        ` | guildId kanału=${ch?.guildId || '?'} (serwer=${guildObj.id})` +
                        ` | typ=${ch?.type ?? '?'}` +
                        ` | wysyłalny=${ch && typeof ch.send === 'function' ? 'tak' : 'nie'}` +
                        ` | uprawnienia bota=[${upr}]`);
                } catch (diagErr) {
                    logger.error(`[/info] Diagnoza "${guildLabel}" nie powiodła się: ${diagErr.message}`);
                }
                logger.error(`Błąd wysyłania /info do serwera "${guildLabel}": ${err.message} (kod ${err.code ?? '?'})`);
                results.push({
                    label: guildLabel, id: guildCfg.id, status: 'error', lang,
                    error: this._mapSendError(err),
                    channelId: guildCfg.allowedChannelId, guildObj,
                });
            }
        }

        this._clearInfoSession(interaction.user.id);

        // Rejestr kopii — bez niego reakcje z różnych serwerów nie mają jak się zsumować
        await this.broadcastReactionService?.register('info', sentMessages).catch(() => {});

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
        this._announceUserBlock(interaction.client, targetUserId, blockedUntil, adminName);
        this._ccAudit(interaction, `🔒 Zablokowano gracza: ${targetUsername}${blockedUntil ? '' : ' (permanentnie)'}`);
        this.adminPanelService?.refresh();

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

        this._ccAudit(interaction, `⚙️ Zmieniono limity: dzienny=${rawUsage || 'brak'}, cooldown=${rawCooldown || 'brak'}`);
        this.adminPanelService?.refresh();
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
            await this._maybeAnnounceNewServer(interaction.client, targetGuildId, targetCommands);
        } else {
            await this.ocrBlockService.block(targetGuildId, targetCommands);
            logger.warn(`🔒 OCR zablokowany dla ${cmdLabel} na serwerze ${serverName}`);
            await interaction.reply({
                content: formatMessage(msgs.ocrBlockPerGuildEnabled, { commands: cmdLabel, serverName }),
                flags: ['Ephemeral']
            });
        }
    }

    /**
     * Przebudowuje komponenty wiadomości, wyłączając przyciski o podanym prefiksie customId.
     * Pozostałe przyciski zostają nietknięte — także ich etykiety i style, bo raport bywa
     * współdzielony przez kilka niezależnych akcji (Zatwierdź, Zablokuj, Analizuj, Cofnij).
     * @returns {boolean} czy cokolwiek wyłączono
     */
    async _disableButtonsByPrefix(msg, prefixes) {
        if (!msg) return false;
        const wanted = Array.isArray(prefixes) ? prefixes : [prefixes];
        const rows = [];
        let hit = false;
        for (const row of msg.components || []) {
            const rebuilt = new ActionRowBuilder();
            for (const comp of row.components || []) {
                // Raporty mają wyłącznie przyciski; select menu przepuszczone przez
                // ButtonBuilder.from() rzuciłoby wyjątkiem, więc lepiej nie ruszać wiadomości
                if (comp.type !== ComponentType.Button) return false;
                const btn = ButtonBuilder.from(comp);
                if (wanted.some(p => comp.customId?.startsWith(p)) && !comp.disabled) {
                    btn.setDisabled(true);
                    hit = true;
                }
                rebuilt.addComponents(btn);
            }
            if (rebuilt.components.length > 0) rows.push(rebuilt);
        }
        if (!hit) return false;
        await msg.edit({ components: rows }).catch(() => {});
        return true;
    }

    /**
     * Head admin blokuje adminowi serwera „Analizuj" dla konkretnego zgłoszenia.
     * Wyłącza przycisk na kopii serwerowej raportu (etykieta zostaje bez zmian — zmienia się
     * wyłącznie aktywność) i wygasza własny przycisk blokady na kopii globalnej, żeby stan
     * był widoczny. Stan trzyma sama wiadomość Discorda, więc przeżywa restart bota.
     */
    async _handleAnalyzeBlock(interaction, customId) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }

        const footerInfo = this._parseReportFooter(interaction.message.embeds[0]?.footer?.text);
        const sourceGuildId = footerInfo.guildId || customId.split('_')[4] || interaction.guildId;
        const targetMsgs = this.config.getMessages(sourceGuildId);
        const adminName = interaction.member?.displayName || interaction.user.username;

        if (!footerInfo.perGuildChannelId || !footerInfo.perGuildMsgId) {
            await interaction.reply({ content: targetMsgs.reportAnalyzeBlockedNoTarget, flags: ['Ephemeral'] });
            return;
        }

        await interaction.deferUpdate();

        try {
            const chan = interaction.client.channels.cache.get(footerInfo.perGuildChannelId)
                || await interaction.client.channels.fetch(footerInfo.perGuildChannelId).catch(() => null);
            const perGuildMsg = chan ? await chan.messages.fetch(footerInfo.perGuildMsgId).catch(() => null) : null;
            await this._disableButtonsByPrefix(perGuildMsg, 'ee_analyze_');
        } catch (err) {
            this.logService._gl(sourceGuildId).warn(`⚠️ Nie można zablokować analizy na kopii serwerowej: ${err.message}`);
        }

        // Kopia globalna: notka w embedzie + wygaszony przycisk blokady (head admin nadal
        // może analizować sam — blokada dotyczy admina serwera, nie jego)
        const updatedEmbeds = interaction.message.embeds.map(e => EmbedBuilder.from(e).addFields({
            name: targetMsgs.reportAnalyzeBlockedField,
            value: formatMessage(targetMsgs.reportAnalyzeBlockedBy, { adminName }),
            inline: false,
        }));
        const rows = [];
        for (const row of interaction.message.components || []) {
            const rebuilt = new ActionRowBuilder();
            for (const comp of row.components || []) {
                const btn = ButtonBuilder.from(comp);
                if (comp.customId?.startsWith('ee_analyze_block_')) btn.setDisabled(true);
                rebuilt.addComponents(btn);
            }
            if (rebuilt.components.length > 0) rows.push(rebuilt);
        }
        await interaction.editReply({ embeds: updatedEmbeds, components: rows }).catch(() => {});

        this._ccAudit(interaction, `🚫 Zablokowano analizę admina: ${await this._ccName(interaction, footerInfo.userId)}`);
        await interaction.followUp({ content: targetMsgs.reportAnalyzeBlockedDone, flags: ['Ephemeral'] }).catch(() => {});
    }

    /** Parsuje footer embeda raportu — zwraca { globalMsgId, userId, guildId } */
    _parseReportFooter(footerText) {
        const result = {};
        for (const part of (footerText || '').split('|')) {
            if (part.startsWith('ref:')) result.globalMsgId = part.slice(4);
            else if (part.startsWith('uid:')) result.userId = part.slice(4);
            else if (part.startsWith('pk:')) result.playerKey = part.slice(3);
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
        if (!this.config.rejectedChannelId || !globalMsgId) return;
        await this._applyActionToAnyReport(client, this.config.rejectedChannelId, globalMsgId, sourceGuildId, actionType, adminName, extraInfo);
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
        // Profil, dla którego wysłano screen (stopka `pk:`); stare raporty → profil główny
        const targetPlayerKey = footerInfo.playerKey || targetUserId;
        const targetProfileIndex = getProfileIndex(targetPlayerKey);
        const targetProfileLabel = this.profileRegistryService?.getLabel(targetUserId, targetProfileIndex) || null;

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

                // Ephemeral w konwencji ogłoszenia wyników: Embed 1 = "nie pobił rekordu" + awatar, Embed 2 = powód odrzucenia
                const targetUserAvatarUrl = await interaction.client.users.fetch(targetUserId)
                    .then(u => u.displayAvatarURL()).catch(() => null);
                const failEmbeds = this.rankingService.createNoRecordEmbeds({
                    userName,
                    userAvatarUrl: targetUserAvatarUrl,
                    reasonLabel: targetMsgs.analyzeFailReasonField,
                    reasonText: aiResult.error || targetMsgs.analyzeResultUnknown,
                    messages: targetMsgs,
                    color2: 0xFF0000,
                });

                const updatedEmbeds = this._buildActionEmbeds(
                    origMsg.embeds, targetMsgs, serverName, 'analyzed', adminName, extraInfo
                );
                await origMsg.edit({ embeds: updatedEmbeds, components: [] }).catch(() => {});
                await interaction.editReply({ embeds: failEmbeds, components: [] }).catch(() => {});
                await applyToOtherMsg(extraInfo);
                try {
                    this.logService.sendOcrAnalysisEmbed(targetGuildId, {
                        type: 'rejected',
                        userName,
                        userId: targetUserId,
                        playerKey: targetPlayerKey,
                        profileIndex: targetProfileIndex,
                        profileLabel: targetProfileLabel,
                        userAvatar: interaction.user.displayAvatarURL(),
                        commandName: 'analyze',
                        reason: aiResult.error || 'VALIDATION_FAILED',
                        adminName,
                    }, interaction.client.guilds.cache.get(targetGuildId) ?? null,
                    [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`panel_block_time_${targetUserId}_${targetGuildId}`).setLabel('🔒 Zablokuj użytkownika').setStyle(ButtonStyle.Danger)).toJSON()],
                    interaction.client);
                } catch {}
                return;
            }

            gl.success(`✅ [Analizuj] AI OCR: wynik="${aiResult.score}", boss="${aiResult.bossName}"`);

            // Stan globalny przed zapisem — potrzebny do snippetu globalnego (Embed 2)
            const _analyzePrevGlobalRanking = await this.rankingService.getGlobalRanking(new Set(interaction.client.guilds.cache.keys()));
            const _analyzePrevGlobalPosition = (() => {
                const i = _analyzePrevGlobalRanking?.findIndex(p => (p.playerKey || p.userId) === targetPlayerKey);
                return i !== -1 ? i + 1 : null;
            })();

            const { isNewRecord, currentScore, ranking: updatedRanking, affectedGuildIds: analyzeAffectedGuilds = [] } = await this.rankingService.updateUserRanking(
                targetGuildId, targetPlayerKey, userName, aiResult.score, aiResult.bossName, targetProfileLabel
            );
            await this.logService.logScoreUpdate(userName, aiResult.score, isNewRecord, targetGuildId, { adminName });
            if (isNewRecord && this.milestoneService) this.milestoneService.checkAndAnnounce();
            gl.info(`🎯 [Analizuj] Wynik zapisany — isNewRecord: ${isNewRecord}`);
            if (this.ocrStatsService) this.ocrStatsService.recordAnalyze().catch(() => {});
            if (this.adminPanelService) {
                this._ccAudit(interaction, `🔬 Analiza manualna: ${userName} — ${aiResult.score}`);
                this.adminPanelService.setLastRecord(userName, aiResult.score, aiResult.bossName, targetGuildId);
                this.adminPanelService.refresh();
            }
            // Zapis z panelu to normalny rekord — razem z serwerem docelowym lecą te,
            // z których dedup cross-server usunął słabszy wpis gracza
            this.webRankingSyncService?.syncGuilds([targetGuildId, ...analyzeAffectedGuilds], interaction.client).catch(() => {});

            // Per-boss rekord (zawsze gdy jest bossName — niezależnie od isNewRecord)
            let isNewBossRecord = false;
            let previousBossRecord = null;
            if (aiResult.bossName && this.bossRecordService) {
                const analyzeBossTs = isNewRecord
                    ? (updatedRanking[targetPlayerKey]?.timestamp ?? new Date().toISOString())
                    : new Date().toISOString();
                const analyzeBossScoreValue = this.rankingService.parseScoreValue(aiResult.score);
                try {
                    const bossResult = await this.bossRecordService.updateBossRecord(
                        targetGuildId, targetPlayerKey, aiResult.bossName, userName,
                        aiResult.score, analyzeBossScoreValue, analyzeBossTs
                    );
                    isNewBossRecord = bossResult.isNewBossRecord;
                    previousBossRecord = bossResult.previousBossRecord;
                } catch (bossErr) {
                    gl.error(`Błąd zapisu per-boss rekordu [Analizuj]: ${bossErr.message}`);
                }
            }

            let newAchievements = [];
            if (this.achievementService) {
                this.achievementService.trackAiAnalyzed(targetGuildId, targetUserId).catch(() => {});
                if (isNewRecord) {
                    try {
                        const sortedAfter = await this.rankingService.getSortedPlayers(targetGuildId);
                        const currentPositionForAch = sortedAfter.findIndex(p => (p.playerKey || p.userId) === targetPlayerKey) + 1;
                        const prevScoreValue = currentScore ? this.rankingService.parseScoreValue(currentScore.score) : 0;
                        const newScoreValue = this.rankingService.parseScoreValue(aiResult.score);
                        const _analyzeConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                        const _analyzeActiveGuildIds = new Set(_analyzeConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                        const _analyzeGlobalRanking = await this.rankingService.getGlobalRanking(_analyzeActiveGuildIds);
                        const _analyzeGlobalIdx = _analyzeGlobalRanking.findIndex(p => (p.playerKey || p.userId) === targetPlayerKey);
                        const analyzeGlobalPositionForAch = _analyzeGlobalIdx !== -1 ? _analyzeGlobalIdx + 1 : 0;
                        newAchievements = await this.achievementService.processSubmission(targetGuildId, targetPlayerKey, {
                            scoreValue: newScoreValue,
                            bossName: aiResult.bossName,
                            isNewRecord: true,
                            prevScoreValue,
                            currentPosition: currentPositionForAch,
                            globalPosition: analyzeGlobalPositionForAch,
                        });
                    } catch {}
                } else if (isNewBossRecord) {
                    try {
                        const bossScoreVal = this.rankingService.parseScoreValue(aiResult.score);
                        const _bossAchConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                        const _bossAchActiveGuildIds = new Set(_bossAchConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid)));
                        const _bossAchGlobalRanking = await this.rankingService.getGlobalRanking(_bossAchActiveGuildIds);
                        const _bossAchGlobalIdx = _bossAchGlobalRanking.findIndex(p => (p.playerKey || p.userId) === targetPlayerKey);
                        const bossGlobalPositionForAch = _bossAchGlobalIdx !== -1 ? _bossAchGlobalIdx + 1 : 0;
                        newAchievements = await this.achievementService.processSubmission(targetGuildId, targetPlayerKey, {
                            scoreValue: bossScoreVal,
                            bossName: aiResult.bossName,
                            isNewRecord: false,
                            prevScoreValue: previousBossRecord ? this.rankingService.parseScoreValue(previousBossRecord.score) : 0,
                            currentPosition: 0,
                            globalPosition: bossGlobalPositionForAch,
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

                // Aktualizacja ról TOP na serwerach, z których usunięto gorszy wynik gracza
                if (analyzeAffectedGuilds.length > 0) {
                    for (const affectedGuildId of analyzeAffectedGuilds) {
                        const affectedGuild = interaction.client.guilds.cache.get(affectedGuildId);
                        if (!affectedGuild) continue;
                        const affectedConfig = this.config.getGuildConfig(affectedGuildId);
                        if (!affectedConfig?.topRoles) continue;
                        this.roleService.updateTopRoles(affectedGuild, null, affectedConfig.topRoles).catch(err =>
                            gl.warn(`⚠️ [Analizuj] Błąd aktualizacji ról TOP na serwerze "${affectedGuild.name}": ${err.message}`)
                        );
                    }
                }
            }

            // Ogłoszenie publiczne — gdy nowy rekord globalny lub nowy rekord bossa
            let analyzePublicMsg = null;
            const analyzeChangedData = isNewRecord || isNewBossRecord;
            const guildCfgAnnounce = this.config.getGuildConfig(targetGuildId);
            const announcementChannelId = guildCfgAnnounce?.allowedChannelId;
            if (analyzeChangedData && announcementChannelId) {
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

                        const analyzeAchFieldValue = this.achievementService && newAchievements.length > 0
                            ? this.achievementService.buildNewAchievementsFieldValue(newAchievements, guildCfgAnnounce?.lang || 'eng')
                            : null;

                        const analyzeWasUnknownBoss = aiResult.wasUnknownBoss === true;

                        // Pozycje w rankingach ról (Embed 1)
                        let analyzeRolePositions = [];
                        try {
                            const targetMember = targetGuildObj ? await targetGuildObj.members.fetch(targetUserId).catch(() => null) : null;
                            analyzeRolePositions = await this._computeRolePositions(targetGuildId, targetPlayerKey, targetGuildObj, targetMember?.roles?.cache);
                        } catch {}

                        // Snippet globalny (Embed 2) — tylko gdy zmieniła się pozycja w rankingu globalnym
                        let analyzeGlobalSnippetData = null;
                        if (isNewRecord) {
                            try {
                                const analyzeConfiguredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
                                const analyzeActiveGuildIds = analyzeConfiguredIds.filter(gid => interaction.client.guilds.cache.has(gid));
                                const analyzeNewGlobalRanking = await this.rankingService.getGlobalRanking(new Set(analyzeActiveGuildIds));
                                analyzeGlobalSnippetData = await this.globalTop10Service.buildSnippetFieldData(
                                    targetPlayerKey, analyzeNewGlobalRanking, _analyzePrevGlobalPosition, targetMsgs, interaction.client
                                );
                            } catch (snippetErr) {
                                gl.warn(`⚠️ [Analizuj] Błąd snippeta globalnego: ${snippetErr.message}`);
                            }
                        }

                        // Snippet rankingu bossa (Embed 3) — gdy pobito rekord bossa i boss jest znany
                        let analyzeBossSnippetData = null;
                        if (isNewBossRecord && aiResult.bossName && !analyzeWasUnknownBoss) {
                            try {
                                const allGuildIdsForBoss = this.guildConfigService?.getAllConfiguredGuildIds()
                                    || Array.from(interaction.client.guilds.cache.keys());
                                const bossResult = await this._buildBossSnippetData(
                                    targetPlayerKey, aiResult.bossName, previousBossRecord, allGuildIdsForBoss, targetMsgs, interaction.client
                                );
                                analyzeBossSnippetData = bossResult.snippetData;
                            } catch (bossSnippetErr) {
                                gl.warn(`⚠️ [Analizuj] Błąd snippeta bossa: ${bossSnippetErr.message}`);
                            }
                        }

                        // Komunikaty systemowe (Embed 4)
                        const analyzeSystemNotices = [];
                        if (analyzeWasUnknownBoss && isNewBossRecord && aiResult.bossName) {
                            const noticeVal = formatMessage(
                                targetMsgs.unknownBossRankingNotice || 'Wykryto nową nazwę bossa: *{bossName}*\nWynik nie pojawi się w rankingu bossów do czasu weryfikacji przez admina.',
                                { bossName: aiResult.bossName }
                            );
                            analyzeSystemNotices.push({ name: targetMsgs.unknownBossRankingField || 'Unverified Boss Name', value: noticeVal });
                        }

                        // Licznik subskrybentów (Embed 1)
                        let analyzeSubscribers = [];
                        try {
                            analyzeSubscribers = await this.notificationService.getSubscribersForTarget(targetPlayerKey, targetGuildId);
                        } catch (subErr) {
                            gl.warn(`⚠️ [Analizuj] Nie udało się pobrać subskrybentów: ${subErr.message}`);
                        }

                        // Wykres progresu (Embed 2) — tylko gdy zmiana w globalnym rankingu
                        let analyzeChartAttachment = null;
                        let analyzeChartName = null;
                        if (analyzeGlobalSnippetData && this.scoreHistoryService && this.chartService) {
                            try {
                                const allGuildIdsChart = this.guildConfigService?.getAllConfiguredGuildIds() || [targetGuildId];
                                const analyzeHistory = await this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIdsChart, targetPlayerKey, 365);
                                if (analyzeHistory.length >= 2) {
                                    const guildTagMap = {};
                                    const guildNameMap = {};
                                    for (const g of (this.guildConfigService?.getAllConfiguredGuilds() || [])) {
                                        const discordName = interaction.client.guilds.cache.get(g.id)?.name;
                                        guildTagMap[g.id] = g.tag || discordName?.slice(0, 14) || g.id.slice(-4);
                                        guildNameMap[g.id] = discordName || g.tag || g.id.slice(-4);
                                    }
                                    const chartBuffer = await this.chartService.generateScoreHistoryChart(analyzeHistory, userName, targetMsgs.chartTitle, guildTagMap, guildNameMap, this._chartLang(targetGuildId));
                                    if (chartBuffer) {
                                        analyzeChartName = 'score_history.png';
                                        analyzeChartAttachment = new AttachmentBuilder(chartBuffer, { name: analyzeChartName });
                                    }
                                }
                            } catch (chartErr) {
                                gl.warn(`⚠️ [Analizuj] Błąd generowania wykresu progresu: ${chartErr.message}`);
                            }
                        }

                        // Ikona pozycji globalnej (thumbnail Embedu 2) — grafika generowana z numerem pozycji
                        let analyzePositionIconAttachment = null;
                        let analyzePositionIconName = null;
                        if (analyzeGlobalSnippetData?.newGlobalPosition) {
                            try {
                                const iconBuffer = await generatePositionIcon(analyzeGlobalSnippetData.newGlobalPosition);
                                if (iconBuffer) {
                                    analyzePositionIconName = 'global_position.png';
                                    analyzePositionIconAttachment = new AttachmentBuilder(iconBuffer, { name: analyzePositionIconName });
                                }
                            } catch (iconErr) {
                                gl.warn(`⚠️ [Analizuj] Błąd generowania ikony pozycji globalnej: ${iconErr.message}`);
                            }
                        }

                        // Ikona bossa (Embed 3) — gdy pobito rekord bossa i boss znany
                        let analyzeBossImageAttachment = null;
                        let analyzeBossImageName = null;
                        if (isNewBossRecord && aiResult.bossName && !analyzeWasUnknownBoss && this.bossAliasService) {
                            try {
                                const imgPath = this.bossAliasService.getBossImagePath(aiResult.bossName);
                                if (imgPath) {
                                    const buf = await fs.readFile(path.join(__dirname, '../data/boss_images', imgPath));
                                    analyzeBossImageName = imgPath;
                                    analyzeBossImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                                }
                            } catch { /* bez ikony bossa */ }
                        }

                        // Pozycja w rankingu bossa NA SERWERZE (Embed 1)
                        const analyzeBossServerPosition = (aiResult.bossName && !analyzeWasUnknownBoss)
                            ? await this._buildBossServerPosition(targetGuildId, aiResult.bossName, targetPlayerKey)
                            : null;

                        const _analyzeBotUser = interaction.client.user;
                        const manualVerificationNote = formatMessage(targetMsgs.analyzeManualAnnouncement, {
                            userId: targetUserId,
                            adminName,
                        });

                        // Stos 4 embedów — identyczny format co /update, z manualną notką w Embedzie 4
                        const resultEmbeds = await this.rankingService.createRecordEmbeds({
                            userName,
                            bestScore: aiResult.score,
                            userAvatarUrl,
                            screenshotName: announceName,
                            previousScore: currentScore ? currentScore.score : null,
                            userId: targetUserId,
                            playerKey: targetPlayerKey,
                            profileIndex: targetProfileIndex,
                            profileLabel: targetProfileLabel,
                            guildId: targetGuildId,
                            messages: targetMsgs,
                            guild: targetGuildObj,
                            guildTopRoles: guildCfgAnnounce?.topRoles || null,
                            previousTimestamp: currentScore ? currentScore.timestamp : null,
                            rolePositions: analyzeRolePositions,
                            achievementsFieldValue: analyzeAchFieldValue,
                            globalSnippetData: analyzeGlobalSnippetData,
                            bossRecordData: isNewBossRecord && !analyzeWasUnknownBoss ? { isNewBossRecord, previousBossRecord, bossName: aiResult.bossName } : null,
                            bossSnippetData: analyzeBossSnippetData,
                            bossServerPosition: analyzeBossServerPosition,
                            bossName: aiResult.bossName,
                            botName: _analyzeBotUser?.username || null,
                            botIconUrl: _analyzeBotUser?.displayAvatarURL() || null,
                            chartName: analyzeChartName,
                            globalPositionIconName: analyzePositionIconName,
                            bossImageName: analyzeBossImageName,
                            followerCount: analyzeSubscribers.length,
                            systemNotices: analyzeSystemNotices,
                            manualVerificationNote,
                        });

                        // Rekord bossa bez globalnego — teal embed (jak dla /update)
                        if (!isNewRecord && isNewBossRecord) {
                            for (const e of resultEmbeds) e.setColor(0x1ABC9C);
                        }

                        const announcementContent = manualVerificationNote;

                        const analyzeFiles = [fileAttachment];
                        if (analyzeChartAttachment) analyzeFiles.push(analyzeChartAttachment);
                        if (analyzePositionIconAttachment) analyzeFiles.push(analyzePositionIconAttachment);
                        if (analyzeBossImageAttachment) analyzeFiles.push(analyzeBossImageAttachment);

                        analyzePublicMsg = await announcementChannel.send({
                            content: announcementContent,
                            embeds: resultEmbeds,
                            files: analyzeFiles,
                        });
                        gl.info(`✅ [Analizuj] Ogłoszenie wysłane na kanał ${announcementChannelId}`);

                        // Przycisk „↩️ Cofnij wynik" dla właściciela — jak przy zwykłym /update
                        await this._registerRecordAnnouncement(interaction, analyzePublicMsg, {
                            guildId: targetGuildId,
                            playerKey: targetPlayerKey,
                            previousRecord: currentScore ?? null,
                            newRecord: {
                                score: aiResult.score,
                                bossName: aiResult.bossName,
                                timestamp: isNewRecord ? (updatedRanking[targetPlayerKey]?.timestamp ?? new Date().toISOString()) : new Date().toISOString(),
                            },
                            previousBossRecord: previousBossRecord ?? null,
                            bossName: aiResult.bossName || null,
                            skipGlobalRevert: !isNewRecord,
                            cvEnabled: false,   // ogłoszenie z ręcznej analizy nie podlega zgłoszeniom CV
                        });

                        // DM do subskrybentów — cały stos embedów (jak dla /update)
                        if (this.notificationService && analyzePublicMsg && analyzeSubscribers.length > 0) {
                            try {
                                const guildRanking = await this.rankingService.loadRanking(targetGuildId);
                                for (const subscriberId of analyzeSubscribers) {
                                    try {
                                        const dmUser = await interaction.client.users.fetch(subscriberId);
                                        const subscriberScore = guildRanking[subscriberId]?.score || null;
                                        const dmEmbeds = this.rankingService.createDmNotifEmbeds(
                                            resultEmbeds, userName, userAvatarUrl, aiResult.score, subscriberScore, targetMsgs
                                        );
                                        const dmFiles = [new AttachmentBuilder(tempPath, { name: announceName })];
                                        if (analyzeChartAttachment) dmFiles.push(new AttachmentBuilder(analyzeChartAttachment.attachment, { name: analyzeChartName }));
                                        if (analyzePositionIconAttachment) dmFiles.push(new AttachmentBuilder(analyzePositionIconAttachment.attachment, { name: analyzePositionIconName }));
                                        if (analyzeBossImageAttachment) dmFiles.push(new AttachmentBuilder(analyzeBossImageAttachment.attachment, { name: analyzeBossImageName }));
                                        await dmUser.send({ embeds: dmEmbeds, files: dmFiles });
                                    } catch {}
                                }
                            } catch {}
                        }
                    }
                } catch (annErr) {
                    gl.error(`❌ [Analizuj] Błąd wysyłania ogłoszenia: ${annErr.message}`);
                }
            }

            // Embed do kanału logów OCR (dodatkowe, nie zastępuje logowania tekstowego).
            //
            // Wysyłany PO ogłoszeniu publicznym, bo dokładamy pod nim przycisk „↩️ Cofnij wynik",
            // a jego kluczem jest ID tego ogłoszenia — dzięki temu przycisk admina i przycisk
            // gracza dotyczą DOKŁADNIE tego samego rekordu (sesja z `_registerRecordAnnouncement`).
            //
            // ⚠️ Przycisk dokładamy WYŁĄCZNIE gdy ogłoszenie faktycznie poszło. Bez jego ID
            // `_buildAdminRevertRow` schodzi na starą postać `{playerKey}_{guildId}`, która cofa
            // OSTATNI rekord profilu — a tu nie ma pewności, że to akurat ten z analizy. Gdy
            // analiza niczego nie pobiła, ogłoszenia nie ma i nie ma też czego cofać.
            try {
                const analyzeRevertRow = analyzePublicMsg?.id
                    ? this._buildAdminRevertRow(analyzePublicMsg.id, targetPlayerKey, targetGuildId)
                    : null;
                this.logService.sendOcrAnalysisEmbed(targetGuildId, {
                    type: _analyzeRoleErr ? 'analyze_panel_role_error' : 'analyze_panel',
                    userName,
                    userId: targetUserId,
                    playerKey: targetPlayerKey,
                    profileIndex: targetProfileIndex,
                    profileLabel: targetProfileLabel,
                    userAvatar: interaction.user.displayAvatarURL(),
                    score: aiResult.score,
                    bossName: aiResult.bossName,
                    previousScore: currentScore?.score,
                    commandName: 'analyze',
                    adminName,
                    roleError: _analyzeRoleErr,
                    // Referencja do embeda admina — po cofnięciu przez właściciela wygaszamy
                    // przycisk również po tej stronie
                    onSent: this._adminMsgTracker(analyzePublicMsg?.id),
                }, interaction.client.guilds.cache.get(targetGuildId) ?? null, analyzeRevertRow, interaction.client);
            } catch {}

            const extraInfo = formatMessage(targetMsgs.analyzeResultSuccess, {
                adminName,
                bossName: aiResult.bossName || targetMsgs.analyzeResultUnknown,
                score: aiResult.score,
                result: isNewRecord ? targetMsgs.analyzeResultNewRecord : (isNewBossRecord ? (targetMsgs.analyzeResultBossRecord || '🎯 Nowy rekord na bossie!') : targetMsgs.analyzeResultNoRecord),
            });
            await applyToCurrentMsg(extraInfo);
            await applyToOtherMsg(extraInfo);

            // Zapisz sesję revert i dodaj przycisk "Cofnij wynik" do globalnego raportu.
            //
            // ⚠️ TYLKO gdy analiza FAKTYCZNIE coś zmieniła. Gdy nie pobiła ani rekordu
            // globalnego, ani rekordu bossa, nie ma czego cofać — a przycisk mimo to istniał
            // i jego kliknięcie unieważniało (przez `getLatest`) cofnięcie CZYJEGOŚ INNEGO,
            // poprawnego rekordu tego gracza. Realny incydent: analiza „No record broken"
            // ostemplowała legalny rekord bossa sprzed kilku godzin jako „cofnięty przez admina".
            // (`analyzeChangedData` policzone wyżej — steruje też wysyłką ogłoszenia publicznego.)
            const globalMsgId = footerInfo.globalMsgId || origMsgId;
            if (this.config.rejectedChannelId && globalMsgId && analyzeChangedData) {
                this._analyzeRevertSessions.set(globalMsgId, {
                    targetUserId,
                    targetPlayerKey,
                    targetGuildId,
                    previousRecord: currentScore ?? null,
                    newRecordTimestamp: isNewRecord ? (updatedRanking[targetPlayerKey]?.timestamp ?? null) : null,
                    // Bez tego cofnięcie zostawiało w bazie rekord bossa ustawiony przez analizę
                    isNewRecord,
                    isNewBossRecord,
                    bossName: aiResult.bossName || null,
                    previousBossRecord: previousBossRecord ?? null,
                    // Snapshot wyniku zapisanego przez analizę — przy cofaniu sprawdzamy, czy
                    // ranking nadal go zawiera; gracz mógł w międzyczasie ustawić nowszy rekord
                    appliedScore: isNewRecord ? (updatedRanking[targetPlayerKey]?.score ?? null) : null,
                    userName,
                    adminName,
                    publicMsgId: analyzePublicMsg?.id || null,
                    publicChannelId: analyzePublicMsg?.channelId || null,
                });
                try {
                    const globalChan = await interaction.client.channels.fetch(this.config.rejectedChannelId).catch(() => null);
                    if (globalChan) {
                        const globalMsg = await globalChan.messages.fetch(globalMsgId).catch(() => null);
                        if (globalMsg) {
                            const revertBtn = new ButtonBuilder()
                                .setCustomId(`ee_analyze_revert_${globalMsgId}`)
                                .setLabel('↩️ Cofnij wynik')
                                .setStyle(ButtonStyle.Secondary);
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
        // Sesje sprzed poprawki nie mają tych pól — brak flag traktujemy jak „analiza ruszyła
        // ranking", czyli zachowanie sprzed zmiany
        const sessionIsNewRecord = session.isNewRecord !== false;
        const sessionIsNewBossRecord = session.isNewBossRecord === true;
        // Sesje utworzone przed wdrożeniem profili nie mają targetPlayerKey → profil główny
        const targetPlayerKey = session.targetPlayerKey || targetUserId;
        const gl = this.logService._gl(targetGuildId);
        const serverName = interaction.client.guilds.cache.get(targetGuildId)?.name || targetGuildId;
        const reverterName = interaction.member?.displayName || interaction.user.username;

        try {
            gl.info(`↩️ [Cofnij] ${reverterName} cofa wynik dla ${userName} (serwer: ${serverName}), poprzedni wynik: ${previousRecord?.score || 'brak'}`);

            // 1. Cofnij ranking — TYLKO jeśli analiza faktycznie go zmieniła.
            if (sessionIsNewRecord) {
                // Snapshot `previousRecord` pochodzi z momentu analizy i bywa stary o godziny.
                // Gdy gracz zdążył w międzyczasie ustawić nowszy rekord, przywrócenie snapshotu
                // wymazałoby TAMTEN wynik — więc najpierw sprawdzamy, czy w rankingu nadal leży
                // to, co zapisała analiza.
                const currentEntry = await this.rankingService.getUserRecord(targetGuildId, targetPlayerKey).catch(() => null);
                const stillOurs = !session.appliedScore
                    || !currentEntry
                    || currentEntry.score === session.appliedScore;

                if (!stillOurs) {
                    gl.warn(`↩️ [Cofnij] Przerwano: gracz ma nowszy wynik (${currentEntry.score}) niż zapisany przez analizę (${session.appliedScore})`);
                    await interaction.followUp({
                        content: `⚠️ Nie cofnięto: **${userName}** ma już nowszy wynik (**${currentEntry.score}**) niż ten zapisany przez analizę (**${session.appliedScore}**). Cofnięcie skasowałoby ten nowszy rekord — usuń go ręcznie przez panel, jeśli tego chcesz.`,
                        flags: ['Ephemeral'],
                    }).catch(() => {});
                    return;
                }

                await this.rankingService.revertUserRecord(targetGuildId, targetPlayerKey, previousRecord ?? null);
                gl.info(`↩️ [Cofnij] Ranking cofnięty → ${previousRecord?.score || 'gracz usunięty'}`);
            } else {
                gl.info('↩️ [Cofnij] Analiza nie ruszyła rankingu — pomijam cofanie wpisu rankingowego');
            }

            // 1b. Cofnij rekord bossa, jeśli analiza go pobiła. Wcześniej ta ścieżka w ogóle
            // tego nie robiła i rekord bossa ustawiony przez analizę zostawał w bazie.
            if (sessionIsNewBossRecord && session.bossName && this.bossRecordService) {
                await this.bossRecordService.revertBossRecord(
                    targetGuildId, targetPlayerKey, session.bossName, session.previousBossRecord ?? null
                ).catch(e => gl.error(`↩️ [Cofnij] Błąd cofania rekordu bossa: ${e.message}`));
                gl.info(`↩️ [Cofnij] Rekord bossa "${session.bossName}" cofnięty → ${session.previousBossRecord?.score || 'usunięty'}`);
            }

            // Cofnięcie własnego wyniku przez head admina (testowanie) — nie liczy się do statystyk
            if (this.ocrStatsService && targetUserId !== interaction.user.id) {
                this.ocrStatsService.recordReverted().catch(() => {});
            }

            // 2. Usuń wpisy historii wyników od momentu analizowanego rekordu
            let removedRecordCount = 0;
            if (this.scoreHistoryService && newRecordTimestamp) {
                removedRecordCount = await this.scoreHistoryService.removeEntriesAfter(targetGuildId, targetPlayerKey, newRecordTimestamp)
                    .catch(e => { gl.error(`↩️ [Cofnij] Błąd usuwania historii: ${e.message}`); return 0; });
            }

            // 3. Cofnij tylko osiągnięcia score/records zdobyte od momentu analizowanego rekordu — wcześniejsze zostają
            if (this.achievementService && newRecordTimestamp) {
                await this.achievementService.clearAchievementsAfter(targetGuildId, targetPlayerKey, newRecordTimestamp,
                    { removedRecordCount, previousRecord: previousRecord ?? null }).catch(() => {});
                gl.info('↩️ [Cofnij] Osiągnięcia score/records zdobyte od cofniętego rekordu wyczyszczone');
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
            this._ccAudit(interaction, `↩️ Cofnięto wynik (Analizuj): ${userName}`);
            this.adminPanelService?.refresh();
            // Przycisk gracza „Cofnij wynik" przestaje działać — ale WYŁĄCZNIE pod ogłoszeniem
            // tej analizy. Bez `expectPublicMsgId` trafiało w ostatni rekord profilu, czyli
            // potrafiło unieważnić cofnięcie zupełnie innego, legalnego wyniku.
            if (session.publicMsgId) {
                await this._invalidateUndoForPlayer(interaction.client, targetPlayerKey, targetGuildId, reverterName,
                    { expectPublicMsgId: session.publicMsgId }).catch(() => {});
            }

            const updatedEmbeds = interaction.message.embeds.map(e => {
                const builder = EmbedBuilder.from(e);
                builder.addFields({ name: '↩️ Cofnięcie wyniku', value: revertInfo, inline: false });
                return builder;
            });

            // Dezaktywuj przycisk cofnięcia (zamiast usuwać)
            const disabledAnalyzeRevertBtn = new ButtonBuilder()
                .setCustomId(`ee_analyze_revert_${globalMsgId}`)
                .setLabel('↩️ Cofnij wynik')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);
            await interaction.editReply({ embeds: updatedEmbeds, components: [new ActionRowBuilder().addComponents(disabledAnalyzeRevertBtn)] });
            gl.info(`↩️ [Cofnij] Embed zaktualizowany — cofnięcie zakończone`);

            // Dodaj notkę do ogłoszenia publicznego
            if (session.publicMsgId && session.publicChannelId) {
                try {
                    const _pubChan = await interaction.client.channels.fetch(session.publicChannelId).catch(() => null);
                    if (_pubChan) {
                        const _pubMsg = await _pubChan.messages.fetch(session.publicMsgId).catch(() => null);
                        if (_pubMsg) {
                            const _t = this._panelT(targetGuildId);
                            const _noteText = _t(
                                `↩️ Administrator **${reverterName}** cofnął wynik oraz wszystkie osiągnięcia do stanu sprzed pobicia tego rekordu z powodu naruszenia zasad.`,
                                `↩️ Administrator **${reverterName}** reverted the score and all achievements to the state before this record was set due to a rules violation.`
                            );
                            const _existingContent = _pubMsg.content ? `${_pubMsg.content}\n` : '';
                            await _pubMsg.edit({ content: `${_existingContent}${_noteText}` }).catch(() => null);
                        }
                    }
                } catch {}
            }
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

    // Mapuje kod odrzucenia OCR na czytelny tekst + kolor — współdzielone przez raport admina i ephemeral gracza
    _mapRejectionReason(reason, msgs) {
        const reasonMap = {
            'FAKE_PHOTO': msgs.reportReasonFakePhoto,
            'INVALID_SCREENSHOT': msgs.reportReasonInvalidScreenshot,
            'NO_REQUIRED_WORDS': msgs.reportReasonNoRequiredWords,
            'NOT_SIMILAR': msgs.reportReasonNotSimilar,
            'INVALID_SCORE_FORMAT': msgs.reportReasonInvalidScoreFormat,
            'BEST_EXCEEDS_TOTAL': msgs.reportReasonBestExceedsTotal,
        };
        return {
            text: reasonMap[reason] || `🟠 ${reason}`,
            color: reason === 'FAKE_PHOTO' ? 0xFF0000 : 0xFF8C00,
        };
    }

    /**
     * @param {string|null} playerKey - profil, dla którego wysłano screen; trafia do stopki (pk:),
     *   żeby późniejsza ręczna analiza admina zapisała wynik na właściwym profilu.
     */
    async _sendInvalidScreenReport(interaction, imagePath, reason, gl, rejectionReason = null, playerKey = null) {
        const _reportProfileRef = playerKey && getProfileIndex(playerKey) > 1 ? `|pk:${playerKey}` : '';
        const hasGlobal = !!this.config.rejectedChannelId;
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

            const { text: reasonText, color } = this._mapRejectionReason(reason, msgs);

            const ext = path.extname(imagePath) || '.png';
            const fileName = `rejected_${Date.now()}${ext}`;

            const buildEmbed = (footerText, imageUrl = null) => {
                const guildConfig = this.config.getGuildConfig(interaction.guildId);
                const guildTag = guildConfig?.tag || null;
                const guildIcon = interaction.guild?.iconURL({ dynamic: true, size: 64 }) || guildConfig?.icon || null;
                const authorName = guildTag ? `${guildTag.replace(/^<a?:([^:]+):\d+>$/, '$1')}  ${serverName}` : serverName;
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

            // isGlobal = kopia na kanale head admina. Tylko tam dokładamy „Zablokuj analizę
            // admina" — to narzędzie head admina PRZECIWKO analizie z panelu serwerowego,
            // więc na kopii serwerowej byłoby wyłącznikiem samego siebie.
            const buildButtons = (isGlobal = false) => {
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
                    const row = new ActionRowBuilder().addComponents(analyzeBtn, blockBtn);
                    // Blokować da się tylko „Analizuj", więc przycisk ma sens wyłącznie
                    // przy NOT_SIMILAR — pozostałe powody raportu nie mają czego blokować
                    if (isGlobal) {
                        row.addComponents(new ButtonBuilder()
                            .setCustomId(`ee_analyze_block_${interaction.user.id}_${interaction.guildId}`)
                            .setLabel(msgs.reportBtnBlockAnalyze)
                            .setEmoji('🚫')
                            .setStyle(ButtonStyle.Secondary));
                    }
                    return row;
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
            const sendReport = async (channel, footerText, addPing = false, isGlobal = false) => {
                const att = new AttachmentBuilder(imagePath, { name: fileName });
                const msg = await channel.send({ content: addPing ? '<@398983446812295168>' : undefined, files: [att] });
                const imgUrl = msg.attachments.first()?.url;
                const embed = buildEmbed(footerText, imgUrl || null);
                const edited = await msg.edit({
                    embeds: [embed],
                    components: [buildButtons(isGlobal)],
                });
                return { msg: edited, imgUrl };
            };

            // Wyślij do globalnego kanału
            let globalMsgId = null;
            let sentGlobalMsg = null;
            if (hasGlobal) {
                try {
                    const globalChannel = await interaction.client.channels.fetch(this.config.rejectedChannelId);
                    if (globalChannel) {
                        const { msg: _gMsg, imgUrl: _gImgUrl } = await sendReport(globalChannel, `uid:${interaction.user.id}|gid:${interaction.guildId}${_reportProfileRef}`, true, true);
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
            if (perGuildChannelId && perGuildChannelId !== this.config.rejectedChannelId) {
                try {
                    const guildChannel = await interaction.client.channels.fetch(perGuildChannelId);
                    if (guildChannel) {
                        const footerText = globalMsgId
                            ? `ref:${globalMsgId}|uid:${interaction.user.id}|gid:${interaction.guildId}${_reportProfileRef}`
                            : `uid:${interaction.user.id}|gid:${interaction.guildId}${_reportProfileRef}`;
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

        // Przyciski kodują BIEŻĄCY miesiąc — handler sam oblicza prev/next
        // Wiersz 1: ◀ | [Miesiąc → per user] | ▶ | 🌐 Wszystkie (superUser) | Zbiorczo (superUser)
        const row1Buttons = [
            new ButtonBuilder()
                .setCustomId(`tk_p_${monthStr}_${guildFilter}_${userId}`)
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPrev),
            new ButtonBuilder()
                .setCustomId(`tk_u_${monthStr}_${guildFilter}_0_${userId}`)
                .setLabel(monthLabel)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`tk_n_${monthStr}_${guildFilter}_${userId}`)
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

        const guildEntries = [];
        for (const guildId of tokenGuildIds) {
            const stats = this.tokenUsageService.getMonthlyStats(guildId, month);
            if (stats.requests === 0) continue;
            totalCost += stats.cost;
            const liveName   = interaction.client.guilds.cache.get(guildId)?.name;
            const storedName = this.guildConfigService.getConfig(guildId)?.guildName;
            const name       = (liveName || storedName || guildId).slice(0, 24);
            guildEntries.push({ name, cost: stats.cost, requests: stats.requests, isActive: !!liveName });
        }
        guildEntries.sort((a, b) => b.requests - a.requests);
        for (const entry of guildEntries) {
            const line = `**${entry.name}** — ${fmtCost(entry.cost)} (${entry.requests} req)`;
            if (entry.isActive) activeLines.push(line);
            else leftLines.push(line);
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

        const guildEntries = [];
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
            guildEntries.push({ name, cost, requests, isActive: !!liveName });
        }
        guildEntries.sort((a, b) => b.requests - a.requests);
        for (const entry of guildEntries) {
            const line = `**${entry.name}** — ${fmtCost(entry.cost)} (${entry.requests} req)`;
            if (entry.isActive) activeLines.push(line);
            else leftLines.push(line);
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

    /* ── Centrum Dowodzenia: ręczne nadanie Gracza Dnia ──────────────────────
       Zastępuje dzisiejsze losowanie i wchodzi na stronę od razu. Filtr
       aktywności tu nie obowiązuje — skoro ktoś wskazuje gracza palcem, to wie,
       kogo chce pokazać. Wypisania się gracza nie da się jednak obejść. */

    async _handleCcPotdSet(interaction) {
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: this.msgs(interaction.guildId).noPermission, flags: ['Ephemeral'] });
            return;
        }
        if (!this.playerOfTheDayService?.isEnabled()) {
            await interaction.reply({
                content: '⚪ Gracz Dnia jest wyłączony — brak konfiguracji wysyłki na stronę.',
                flags: ['Ephemeral'],
            });
            return;
        }
        const modal = new ModalBuilder().setCustomId('cc_potd_modal').setTitle('🏆 Nadaj Gracza Dnia');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('cc_potd_query')
                .setLabel('Fragment nicku gracza')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
        ));
        await interaction.showModal(modal);
    }

    async _handleCcPotdSearch(interaction) {
        const query = normalizeForSearch(interaction.fields.getTextInputValue('cc_potd_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            // Szukamy w rankingu globalnym, bo to dokładnie ta pula, z której
            // losuje Gracz Dnia — jeden wpis na profil, z najlepszym wynikiem.
            const global = await this.rankingService.getGlobalRanking();
            const matches = [];
            for (let i = 0; i < global.length; i++) {
                const pl = global[i];
                if (!pl.username) continue; // bez nazwy nie ma czego pokazać na stronie
                if (playerMatchesQuery(pl, query, interaction.client, pl.sourceGuildId)) {
                    matches.push({ ...pl, pos: i + 1 });
                }
            }

            const retryRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cc_potd_set').setEmoji('🔍').setLabel('Szukaj ponownie').setStyle(ButtonStyle.Primary),
            );

            if (!matches.length) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFFD94D)
                        .setTitle('🏆 Nie znaleziono gracza')
                        .setDescription(`Brak gracza z nickiem zawierającym "**${query}**".`)],
                    components: [retryRow],
                });
                return;
            }

            const options = matches.slice(0, 25).map(pl => {
                const guildName = interaction.client.guilds.cache.get(pl.sourceGuildId)?.name || pl.sourceGuildId;
                const hidden = this.playerOfTheDayService?.isOptedOut(pl.playerKey) ? '🙈 ' : '';
                return {
                    label: `${hidden}#${pl.pos} ${formatProfileDisplayName(pl.username, pl.profileIndex || 1).slice(0, 60)}`.slice(0, 100),
                    description: `${guildName} | Wynik: ${pl.score}`.slice(0, 100),
                    value: pl.playerKey,
                };
            });

            const subtitle = matches.length > 25
                ? `Znaleziono ${matches.length} — pokazuję 25. Zawęź wyszukiwanie.`
                : `Znaleziono ${matches.length} gracz(y).`;

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFFD94D)
                    .setTitle('🏆 Kogo wrzucić na stronę?')
                    .setDescription(`${subtitle}\n🙈 = gracz wypisał się z wyróżnienia i nie da się go nadać.`)],
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('cc_potd_ps')
                            .setPlaceholder('Wybierz gracza...')
                            .addOptions(options)
                    ),
                    retryRow,
                ],
            });
        } catch (err) {
            logger.error('Błąd _handleCcPotdSearch:', err);
            await interaction.editReply({ content: '❌ Błąd wczytywania rankingu.', embeds: [], components: [] });
        }
    }

    async _handleCcPotdSelect(interaction) {
        const playerKey = interaction.values[0];
        await interaction.deferUpdate();

        const res = await this.playerOfTheDayService.setManual(interaction.client, playerKey);
        const powod = {
            opted_out: '🙈 Ten gracz wypisał się z wyróżnienia na stronie — tego nie da się obejść z panelu.',
            not_found: '❌ Nie ma go już w rankingu globalnym.',
            no_name: '❌ Ten profil nie ma zapisanej nazwy, a samego ID na stronę nie wysyłamy.',
            disabled: '⚪ Wysyłka na stronę jest wyłączona.',
            build_failed: '❌ Nie udało się złożyć karty gracza.',
            error: '❌ Wysyłka na stronę się nie powiodła — szczegóły w logach.',
        };

        const embed = new EmbedBuilder()
            .setColor(res.ok ? 0x7DFF8A : 0xFF6B35)
            .setTitle(res.ok ? '🏆 Gracz Dnia nadany' : '🏆 Nie udało się nadać')
            .setDescription(res.ok
                ? `Na stronie stoi teraz **${res.nick}**.\nJutrzejsze losowanie odbędzie się normalnie.`
                : (powod[res.reason] || '❌ Nieznany błąd.'));

        if (res.ok) {
            this.logService._gl(interaction.guildId).info(
                `🏆 ${this.logService.nickLink(interaction.member?.displayName || interaction.user.username, interaction.user.id)} nadał Gracza Dnia: ${res.nick}`
            );
        }

        await interaction.editReply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('cc_potd_set').setEmoji('🔍').setLabel('Nadaj innego').setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _handlePanelAchDelSearch(interaction) {
        const guildId = interaction.guildId;
        const t = this._panelT(guildId);
        const query = normalizeForSearch(interaction.fields.getTextInputValue('ach_del_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });
        try {
            const searchGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [guildId];
            const allMatches = [];
            for (const sgid of searchGuildIds) {
                const players = await this.rankingService.getSortedPlayers(sgid);
                const guildName = interaction.client.guilds.cache.get(sgid)?.name || sgid;
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if (playerMatchesQuery(p, query, interaction.client, sgid)) {
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
                label: `#${p.rank} ${formatProfileDisplayName(p.username || p.userId, p.profileIndex || 1).slice(0, 60)}`.slice(0, 100),
                description: `${p.guildName} | ${t('Wynik', 'Score')}: ${p.score}`.slice(0, 100),
                value: `${p.playerKey || p.userId}:${p.sgid}`,
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
        const [targetPlayerKey, targetGuildId] = value.split(':');
        await interaction.deferUpdate();
        // Sesja panelu: gracz + filtr nazwy + zaznaczone osiągnięcia. Lista ID nie zmieści się
        // w customId (limit 100 znaków), więc wybór wielu osiągnięć trzymamy tutaj.
        this._achDelSessions.set(interaction.user.id, {
            playerKey: targetPlayerKey, guildId: targetGuildId, query: '', selected: [], page: 0, ts: Date.now()
        });
        await this._renderAchDelView(interaction);
    }

    /** Sesja panelu „Usuń osiągnięcia" (RAM, TTL 15 min — czysto UI, restart bota tylko ją zeruje) */
    _getAchDelSession(userId) {
        const s = this._achDelSessions.get(userId);
        if (!s) return null;
        if (Date.now() - s.ts > 15 * 60 * 1000) {
            this._achDelSessions.delete(userId);
            return null;
        }
        s.ts = Date.now();
        return s;
    }

    /**
     * Widok wyboru osiągnięć do usunięcia: multi-select (do 25 pozycji naraz) + filtr po
     * nazwie polskiej ORAZ angielskiej. Bez filtra gracz z >25 osiągnięciami nie zmieściłby
     * się w limicie select menu Discorda — stąd wyszukiwarka.
     */
    async _renderAchDelView(interaction, notice = null) {
        const t = this._panelT(interaction.guildId);
        const isPol = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
        const session = this._getAchDelSession(interaction.user.id);
        if (!session) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF6B35)
                    .setTitle(t('🏆 Sesja wygasła', '🏆 Session Expired'))
                    .setDescription(t('Rozpocznij wyszukiwanie gracza od nowa.', 'Start the player search again.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Szukaj gracza', 'Search Player')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
                )]
            });
            return;
        }
        const { playerKey: targetPlayerKey, guildId: targetGuildId, query } = session;
        try {
            const players = await this.rankingService.getSortedPlayers(targetGuildId);
            const player = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
            const displayName = formatProfileDisplayName(player?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
            const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = targetGuildName ? ` (${targetGuildName})` : '';

            const unlockedAchs = this.achievementService
                ? await this.achievementService.getUnlockedAchievements(targetGuildId, targetPlayerKey)
                : [];

            if (unlockedAchs.length === 0) {
                this._achDelSessions.delete(interaction.user.id);
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

            // Filtr obejmuje OBIE wersje nazwy (i ID), niezależnie od języka serwera —
            // admin może znać osiągnięcie pod polską albo angielską nazwą.
            const q = normalizeForSearch(query || '');
            const matching = q
                ? unlockedAchs.filter(a =>
                    normalizeForSearch(a.namePol || '').includes(q) ||
                    normalizeForSearch(a.nameEng || '').includes(q) ||
                    normalizeForSearch(a.id || '').includes(q))
                : unlockedAchs;

            // Select menu Discorda mieści maks. 25 opcji, a osiągnięć może być kilkadziesiąt —
            // stąd paginacja. Strona trzymana w sesji i przycinana do zakresu, bo liczba
            // pozycji zmienia się po filtrze i po usunięciu osiągnięć.
            const PER_PAGE = 25;
            const totalPages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
            const page = Math.min(Math.max(0, session.page || 0), totalPages - 1);
            session.page = page;
            const shown = matching.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

            const descLines = [
                t(`Gracz: **${displayName}**${serverNote}`, `Player: **${displayName}**${serverNote}`),
                t(`Odblokowanych osiągnięć: **${unlockedAchs.length}**`, `Unlocked achievements: **${unlockedAchs.length}**`),
            ];
            if (q) {
                descLines.push(t(
                    `Filtr: \`${query}\` — pasujących: **${matching.length}**`,
                    `Filter: \`${query}\` — matching: **${matching.length}**`
                ));
            }
            if (totalPages > 1) {
                descLines.push(t(
                    `Strona **${page + 1}/${totalPages}** (pozycje ${page * PER_PAGE + 1}–${page * PER_PAGE + shown.length})`,
                    `Page **${page + 1}/${totalPages}** (items ${page * PER_PAGE + 1}–${page * PER_PAGE + shown.length})`
                ));
            }
            descLines.push('');
            descLines.push(t(
                'Zaznacz jedno lub kilka osiągnięć do usunięcia.',
                'Select one or more achievements to remove.'
            ));
            if (notice) descLines.unshift(notice, '');

            const components = [];
            if (shown.length > 0) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel_ach_del_as')
                        .setPlaceholder(t('Wybierz osiągnięcia...', 'Select achievements...'))
                        .setMinValues(1)
                        .setMaxValues(shown.length)
                        .addOptions(shown.map(a => ({
                            // Etykieta w języku serwera, druga wersja nazwy w opisie —
                            // dzięki temu widać, po czym jeszcze można wyszukiwać.
                            label: `${a.icon} ${((isPol ? a.namePol : a.nameEng) || a.id).slice(0, 90)}`.slice(0, 100),
                            description: `${(isPol ? a.nameEng : a.namePol) || a.id} | ${(isPol ? a.descPol : a.descEng) || ''}`.slice(0, 100),
                            value: a.id,
                        })))
                ));
            } else {
                descLines.push(t('\n❌ Żadne osiągnięcie nie pasuje do filtra.', '\n❌ No achievement matches the filter.'));
            }

            const btnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ach_del_q').setEmoji('🔎').setLabel(t('Szukaj osiągnięcia', 'Search Achievement')).setStyle(ButtonStyle.Primary),
            );
            if (q) {
                btnRow.addComponents(
                    new ButtonBuilder().setCustomId('panel_ach_del_clear').setEmoji('🧹').setLabel(t('Wyczyść filtr', 'Clear Filter')).setStyle(ButtonStyle.Secondary)
                );
            }
            btnRow.addComponents(
                new ButtonBuilder().setCustomId(`panel_ach_ok_all:${targetPlayerKey}:${targetGuildId}`).setEmoji('🗑️').setLabel(t('Usuń wszystkie', 'Remove All')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🔍').setLabel(t('Inny gracz', 'Other Player')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Do panelu', 'To Panel')).setStyle(ButtonStyle.Secondary),
            );
            components.push(btnRow);

            if (totalPages > 1) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ach_del_pg_prev').setEmoji('◀️')
                        .setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId('panel_ach_del_pg_info')
                        .setLabel(`${page + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('panel_ach_del_pg_next').setEmoji('▶️')
                        .setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
                ));
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF6B35)
                    .setTitle(t('🏆 Wybierz osiągnięcia', '🏆 Select Achievements'))
                    .setDescription(descLines.join('\n'))],
                components
            });
        } catch (err) {
            logger.error(`Błąd _renderAchDelView (gracz ${targetPlayerKey}, serwer ${targetGuildId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd wczytywania osiągnięć.', '❌ Error loading achievements.'), embeds: [], components: [] });
        }
    }

    /** Modal filtra osiągnięć — szuka po nazwie polskiej i angielskiej */
    async _handlePanelAchDelQuery(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._getAchDelSession(interaction.user.id);
        if (!session) {
            await interaction.reply({ content: t('❌ Sesja wygasła — zacznij od wyszukania gracza.', '❌ Session expired — start by searching for a player.'), flags: ['Ephemeral'] });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('panel_ach_del_q_modal')
            .setTitle(t('🔎 Szukaj osiągnięcia', '🔎 Search Achievement'))
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ach_del_name')
                    .setLabel(t('Nazwa PL lub ENG', 'Name in PL or ENG'))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(t('np. Lewiatan albo Leviathan', 'e.g. Leviathan or Lewiatan'))
                    .setRequired(false)
                    .setMaxLength(60)
            ));
        await interaction.showModal(modal);
    }

    async _handlePanelAchDelQuerySubmit(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._getAchDelSession(interaction.user.id);
        await interaction.deferUpdate();
        if (!session) {
            await this._renderAchDelView(interaction);
            return;
        }
        session.query = (interaction.fields.getTextInputValue('ach_del_name') || '').trim();
        session.selected = [];
        session.page = 0; // nowy filtr → wracamy na pierwszą stronę
        await this._renderAchDelView(interaction);
    }

    /** Zaznaczenie osiągnięć (multi-select) → ekran potwierdzenia z ich listą */
    async _handlePanelAchDelAchSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const isPol = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
        const session = this._getAchDelSession(interaction.user.id);
        if (!session) {
            await interaction.deferUpdate();
            await this._renderAchDelView(interaction);
            return;
        }
        const achIds = interaction.values || [];
        session.selected = achIds;

        const { playerKey: targetPlayerKey, guildId: targetGuildId } = session;
        const players = await this.rankingService.getSortedPlayers(targetGuildId);
        const player = players.find(p => (p.playerKey || p.userId) === targetPlayerKey);
        const displayName = formatProfileDisplayName(player?.username || getOwnerId(targetPlayerKey), getProfileIndex(targetPlayerKey));
        const targetGuildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
        const serverNote = targetGuildName ? ` (${targetGuildName})` : '';

        const defs = this.achievementService?.getAchievementDefs(achIds) || [];
        const list = defs.map(a => `${a.icon} **${(isPol ? a.namePol : a.nameEng) || a.id}**`).join('\n') || achIds.join(', ');

        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xFF6B35)
                .setTitle(t('🏆 Potwierdzenie', '🏆 Confirm'))
                .setDescription(t(
                    `Usunąć **${achIds.length}** osiągnięcie(a) gracza **${displayName}**${serverNote}?\n\n${list}`,
                    `Remove **${achIds.length}** achievement(s) of player **${displayName}**${serverNote}?\n\n${list}`
                ))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ach_ok_n').setEmoji('✅').setLabel(t('Usuń zaznaczone', 'Remove Selected')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('panel_ach_del_back').setEmoji('◀️').setLabel(t('Wróć do listy', 'Back to List')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('panel_back').setEmoji('❌').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
            )]
        });
    }

    /** Usunięcie zaznaczonych osiągnięć (lista w sesji — nie mieści się w customId) */
    async _handlePanelAchDelConfirmMany(interaction) {
        const t = this._panelT(interaction.guildId);
        const isPol = (this.config.getGuildConfig(interaction.guildId)?.lang || 'pol') === 'pol';
        await interaction.deferUpdate();
        const session = this._getAchDelSession(interaction.user.id);
        if (!session || !session.selected?.length) {
            await this._renderAchDelView(interaction, t('⚠️ Zaznaczenie wygasło — wybierz ponownie.', '⚠️ Selection expired — pick again.'));
            return;
        }
        const { playerKey: targetPlayerKey, guildId: targetGuildId, selected } = session;
        try {
            const removed = await this.achievementService.removeAchievements(targetGuildId, targetPlayerKey, selected);
            const defs = this.achievementService.getAchievementDefs(removed);
            const names = defs.map(a => `${a.icon} **${(isPol ? a.namePol : a.nameEng) || a.id}**`).join('\n');
            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';

            await this.logService.logMessage('success', `Usunięto ${removed.length} osiągnięć gracza ${targetPlayerKey} (serwer ${guildName || targetGuildId}) przez panel admina`, interaction);
            this._ccAudit(interaction, `🏆 Usunięto ${removed.length} osiągnięć gracza ${await this._ccName(interaction, targetPlayerKey)}`);
            this.adminPanelService?.refresh();

            session.selected = [];
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x57F287)
                    .setTitle(t('✅ Osiągnięcia usunięte', '✅ Achievements Removed'))
                    .setDescription(t(
                        `Gracz <@${getOwnerId(targetPlayerKey)}>${serverNote} stracił **${removed.length}** osiągnięcie(a):\n\n${names}`,
                        `Player <@${getOwnerId(targetPlayerKey)}>${serverNote} lost **${removed.length}** achievement(s):\n\n${names}`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_ach_del_back').setEmoji('🏆').setLabel(t('Usuń kolejne', 'Remove More')).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                )]
            });
        } catch (err) {
            logger.error(`Błąd _handlePanelAchDelConfirmMany (gracz ${targetPlayerKey}, serwer ${targetGuildId}):`, err);
            await interaction.editReply({ content: t('❌ Błąd usuwania osiągnięć.', '❌ Error removing achievements.'), embeds: [], components: [] });
        }
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
            let targetPlayerKey, targetGuildId, achId;

            if (isAll) {
                // all:{userId}:{guildId}
                [, targetPlayerKey, targetGuildId] = parts;
            } else {
                // 1:{achId}:{userId}:{guildId}  (achId nie zawiera ':')
                targetGuildId = parts[parts.length - 1];
                targetPlayerKey = parts[parts.length - 2];
                achId = parts.slice(1, parts.length - 2).join(':');
            }

            const guildName = interaction.client.guilds.cache.get(targetGuildId)?.name;
            const serverNote = guildName ? ` (${guildName})` : '';

            if (isAll) {
                await this.achievementService.resetAllAchievements(targetGuildId, targetPlayerKey);
                await this.logService.logMessage('success', `Wszystkie osiągnięcia gracza ${targetPlayerKey} usunięte (serwer ${targetGuildId}) przez panel admina`, interaction);
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0x57F287)
                        .setTitle(t('✅ Osiągnięcia usunięte', '✅ Achievements Removed'))
                        .setDescription(t(
                            `Wszystkie osiągnięcia gracza <@${getOwnerId(targetPlayerKey)}>${serverNote} zostały usunięte.`,
                            `All achievements of player <@${getOwnerId(targetPlayerKey)}>${serverNote} have been removed.`
                        ))],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Powrót do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary)
                    )]
                });
            } else {
                await this.achievementService.removeOneAchievement(targetGuildId, targetPlayerKey, achId);
                await this.logService.logMessage('success', `Osiągnięcie "${achId}" gracza ${targetPlayerKey} usunięte (serwer ${targetGuildId}) przez panel admina`, interaction);
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0x57F287)
                        .setTitle(t('✅ Osiągnięcie usunięte', '✅ Achievement Removed'))
                        .setDescription(t(
                            `Osiągnięcie **${achId}** gracza <@${getOwnerId(targetPlayerKey)}>${serverNote} zostało usunięte.`,
                            `Achievement **${achId}** of player <@${getOwnerId(targetPlayerKey)}>${serverNote} has been removed.`
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
            if (this.config.adminGuildId && guildId === this.config.adminGuildId) continue;
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
        const t = this._panelT(interaction.guildId);
        // Jak wyżej: odpytania API + wiadomość próbna nie mieszczą się w 3 sekundach.
        await interaction.deferUpdate();
        const embed = await this._buildDiagnosticsEmbed(interaction.guild, t, interaction.client);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_back_configure').setEmoji('◀️').setLabel(t('Wróć do konfiguracji', 'Back to Configuration')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply({ embeds: [embed], components: [backRow] });
    }

    /**
     * Ustala kanał serwera po ID — wspólne źródło prawdy dla diagnostyki i dla
     * realnej wysyłki (/info, ogłoszenie nowego serwera). Jedna implementacja, bo
     * dopóki były dwie, diagnostyka sprawdzała co innego, niż robiła wysyłka.
     *
     * Stan bierzemy z API (`force`), nie z pamięci podręcznej: nakładki uprawnień
     * odświeżają się zdarzeniem channelUpdate, a bot dostaje je wyłącznie dla
     * kanałów, które widzi. Gdy ktoś odbierze mu „Wyświetl kanał", zdarzenia
     * przestają przychodzić i w pamięci zostaje ostatnia, zielona wersja nakładek.
     *
     * Nieudany fetch jest odpowiedzią samą w sobie: 50001 znaczy, że bot tego
     * kanału nie widzi, a 10003 – że kanału już nie ma.
     *
     * @returns {Promise<{ch: Object|null, powod: string|null, obcyGuildId?: string, obcaNazwa?: string, typ?: number, err?: Error}>}
     */
    async _pobierzKanalSerwera(client, guild, chId) {
        if (!chId) return { ch: null, powod: 'brak' };
        try {
            const ch = await client.channels.fetch(chId, { force: true });
            if (!ch) return { ch: null, powod: 'nieznany' };
            // channels.fetch szuka GLOBALNIE, po wszystkich serwerach bota.
            // Kanał spoza tego serwera trzeba odrzucić, bo liczenie na nim
            // uprawnień membera z tego serwera daje wynik bez znaczenia –
            // potrafiłby wyjść zielony, choć wysyłka nie ma prawa przejść.
            if (ch.guildId && ch.guildId !== guild.id) {
                return { ch: null, powod: 'obcy', obcyGuildId: ch.guildId, obcaNazwa: ch.name };
            }
            if (!ch.guildId) return { ch: null, powod: 'nieserwerowy', typ: ch.type };
            // Kategoria, kanał głosowy bez czatu czy forum przejdą KAŻDY test uprawnień
            // na zielono, bo uprawnienia liczy się dla nich normalnie — a `.send()`
            // i tak nie istnieje albo kończy się błędem.
            if (typeof ch.send !== 'function' || (typeof ch.isTextBased === 'function' && !ch.isTextBased())) {
                return { ch: null, powod: 'nietekstowy', typ: ch.type };
            }
            return { ch, powod: null };
        } catch (err) {
            if (err.code === 50001) return { ch: null, powod: 'niewidoczny' };
            if (err.code === 10003) return { ch: null, powod: 'usuniety' };
            return { ch: null, powod: 'blad', err };
        }
    }

    /**
     * Tłumaczy `powod` z `_pobierzKanalSerwera` na komunikat w formacie
     * `_mapSendError` — ten sam, którym raport `/info` i DM do właściciela
     * opisują błędy Discorda.
     */
    _opisProblemuKanalu(wynik) {
        switch (wynik.powod) {
            case 'brak': return {
                pol: 'Kanał nie jest skonfigurowany',
                eng: 'Channel is not configured',
                fix_pol: 'Użyj `/configure`, aby wskazać kanał dla bota.',
                fix_eng: 'Use `/configure` to select a channel for the bot.',
            };
            case 'niewidoczny': return {
                pol: 'Brak uprawnienia **Wyświetl kanał** — bot nie widzi tego kanału',
                eng: 'Missing **View Channel** permission — bot cannot see this channel',
                fix_pol: 'Wejdź w ustawienia kanału → Uprawnienia i nadaj botowi uprawnienie **Wyświetl kanał**.',
                fix_eng: 'Go to channel settings → Permissions and grant the bot **View Channel**.',
            };
            case 'usuniety': return {
                pol: 'Kanał nie istnieje lub został usunięty',
                eng: 'Channel does not exist or was deleted',
                fix_pol: 'Użyj `/configure`, aby wybrać nowy kanał dla bota.',
                fix_eng: 'Use `/configure` to select a new channel for the bot.',
            };
            case 'obcy': return {
                pol: `Skonfigurowany kanał należy do INNEGO serwera (\`${wynik.obcyGuildId}\`)`,
                eng: `The configured channel belongs to a DIFFERENT server (\`${wynik.obcyGuildId}\`)`,
                fix_pol: 'Użyj `/configure`, aby wybrać kanał na tym serwerze.',
                fix_eng: 'Use `/configure` to pick a channel on this server.',
            };
            case 'nietekstowy':
            case 'nieserwerowy': return {
                pol: `Skonfigurowany kanał nie jest kanałem tekstowym (typ ${wynik.typ ?? '?'})`,
                eng: `The configured channel is not a text channel (type ${wynik.typ ?? '?'})`,
                fix_pol: 'Użyj `/configure`, aby wskazać kanał tekstowy.',
                fix_eng: 'Use `/configure` to pick a text channel.',
            };
            default: return {
                pol: `Nie udało się sprawdzić kanału: ${wynik.err?.message || 'nieznany błąd'}`,
                eng: `Could not check the channel: ${wynik.err?.message || 'unknown error'}`,
                fix_pol: 'Sprawdź logi bota lub skontaktuj się z administratorem.',
                fix_eng: 'Check bot logs or contact the administrator.',
            };
        }
    }

    /**
     * Buduje embed diagnostyki uprawnień dla dowolnego serwera
     * (używany przez /configure i Centrum Dowodzenia).
     *
     * Stan bierzemy z API, nie z pamięci podręcznej. Powód jest konkretny:
     * nakładki uprawnień odświeżają się zdarzeniem channelUpdate, a bot dostaje
     * je wyłącznie dla kanałów, które widzi. Gdy ktoś odbierze mu „Wyświetl
     * kanał", zdarzenia przestają przychodzić i w pamięci zostaje ostatnia,
     * zielona wersja nakładek – diagnostyka pokazywała wtedy komplet ptaszków,
     * podczas gdy każda realna wysyłka leciała na Missing Access. Pętla sama się
     * nie przerywa, bo im mniej bot widzi, tym mniej ma szans dowiedzieć się,
     * że czegoś nie widzi.
     */
    async _buildDiagnosticsEmbed(guild, t, client) {
        const { normalizeTiers } = require('../services/roleService');
        const { PermissionFlagsBits } = require('discord.js');
        const guildId = guild.id;
        const guildConfig = this.config.getGuildConfig(guildId);

        // Świeży member bota: role i uprawnienia globalne prosto z API.
        let botMember = guild.members.me;
        try { botMember = await guild.members.fetchMe({ force: true }); } catch (e) { /* zostaje to, co jest */ }
        // Świeże role serwera – hierarchia ról TOP liczy się z ich pozycji.
        await guild.roles.fetch().catch(() => {});

        const pobierzKanal = (chId) => this._pobierzKanalSerwera(client, guild, chId);

        const lines = [];
        let issueCount = 0;

        // --- Kategoria 1: Uprawnienia serwera ---
        // Część uprawnień jest potrzebna WYŁĄCZNIE pod funkcje, które ten serwer
        // może mieć wyłączone. Zgłaszanie ich jako błędów zapalało nagłówek
        // „Wykryto problemy" przy komplecie sprawnych funkcji i przykrywało to,
        // co naprawdę nie działa.
        const normalized = normalizeTiers(guildConfig?.topRoles || null);
        const tiers = normalized?.tiers || [];
        const uzywaRolTop = tiers.some(tier => tier.roleId);
        const autoReakcja = this.guildConfigService?.getConfig(guildId)?.autoReactionEmoji || null;
        const autoReakcjaCustom = !!autoReakcja && /<a?:\w+:\d+>/.test(autoReakcja);

        const SERVER_PERMS = [
            [PermissionFlagsBits.ManageRoles,        'ManageRoles',        t('wymagane do przyznawania ról TOP', 'required to assign TOP roles'), uzywaRolTop, t('role TOP nie są skonfigurowane', 'TOP roles are not configured')],
            [PermissionFlagsBits.SendMessages,        'SendMessages',       t('wymagane do odpowiedzi na komendy', 'required to respond to commands'), true],
            [PermissionFlagsBits.EmbedLinks,          'EmbedLinks',         t('wymagane do wyświetlania embedów', 'required to display embeds'), true],
            [PermissionFlagsBits.ReadMessageHistory,  'ReadMessageHistory', t('wymagane do odczytu historii kanału', 'required to read channel history'), true],
            [PermissionFlagsBits.ViewChannel,         'ViewChannel',        t('wymagane do widzenia kanałów', 'required to see channels'), true],
            [PermissionFlagsBits.AttachFiles,         'AttachFiles',        t('wymagane do wysyłania plików', 'required to send files'), true],
            [PermissionFlagsBits.AddReactions,        'AddReactions',       t('wymagane do auto-reakcji pod ogłoszeniami rekordów (/configure krok 10)', 'required for auto reactions under record announcements (/configure step 10)'), !!autoReakcja, t('auto-reakcja wyłączona', 'auto reaction disabled')],
            [PermissionFlagsBits.UseExternalEmojis,   'UseExternalEmojis',  t('wymagane gdy auto-reakcja używa emotki customowej z innego serwera', 'required when the auto reaction uses a custom emote from another server'), autoReakcjaCustom, t('auto-reakcja nie używa emotki customowej', 'auto reaction does not use a custom emote')],
        ];

        const serverPermsHeader = t('🔐 **Uprawnienia serwera**', '🔐 **Server Permissions**');
        const addIssue = (line) => { issueCount++; lines.push(line); };

        lines.push(serverPermsHeader);
        for (const [flag, name, reason, wymagane, powodNieistotne] of SERVER_PERMS) {
            if (botMember.permissions.has(flag)) {
                lines.push(`✅ ${name}`);
            } else if (wymagane) {
                addIssue(`❌ ${name} — ${reason}`);
            } else {
                lines.push(`ℹ️ ${name} — ` + t(`brak, ale nieużywane (${powodNieistotne})`, `missing, but unused (${powodNieistotne})`));
            }
        }

        // --- Kategoria 2: Uprawnienia w kanale OCR ---
        lines.push('');
        const channelId = guildConfig?.allowedChannelId;
        const ocr = await pobierzKanal(channelId);
        const channel = ocr.ch;
        if (!channel) {
            lines.push(t('📺 **Uprawnienia w kanale OCR**', '📺 **OCR Channel Permissions**'));
            const idTxt = channelId || (t('brak', 'none'));
            if (ocr.powod === 'niewidoczny') {
                addIssue(t(
                    `❌ Bot nie widzi kanału OCR (ID: \`${idTxt}\`) — brak uprawnienia **Wyświetl kanał**`,
                    `❌ Bot cannot see the OCR channel (ID: \`${idTxt}\`) — missing **View Channel**`));
                lines.push(t(
                    '└ Ustawienia kanału → Uprawnienia → nadaj botowi **Wyświetl kanał**.',
                    '└ Channel settings → Permissions → grant the bot **View Channel**.'));
            } else if (ocr.powod === 'usuniety') {
                addIssue(t(`❌ Kanał OCR nie istnieje (ID: \`${idTxt}\`)`, `❌ OCR channel does not exist (ID: \`${idTxt}\`)`));
                lines.push(t('└ Użyj `/configure`, aby wybrać nowy kanał.', '└ Use `/configure` to pick a new channel.'));
            } else if (ocr.powod === 'obcy') {
                addIssue(t(
                    `❌ Kanał OCR (ID: \`${idTxt}\`) należy do INNEGO serwera (\`${ocr.obcyGuildId}\`, #${ocr.obcaNazwa})`,
                    `❌ The OCR channel (ID: \`${idTxt}\`) belongs to a DIFFERENT server (\`${ocr.obcyGuildId}\`, #${ocr.obcaNazwa})`));
                lines.push(t(
                    '└ Konfiguracja wskazuje cudzy kanał. Użyj `/configure`, aby wybrać kanał na tym serwerze.',
                    '└ The config points at a channel on a different server. Use `/configure` to pick a channel on this server.'));
            } else if (ocr.powod === 'brak') {
                addIssue(t('❌ Kanał OCR nie jest skonfigurowany', '❌ OCR channel is not configured'));
            } else if (ocr.powod === 'nietekstowy' || ocr.powod === 'nieserwerowy') {
                // Kategoria/kanał głosowy przechodzi każdy test uprawnień na zielono,
                // a mimo to nie da się na niego nic wysłać.
                addIssue(t(
                    `❌ Kanał OCR (ID: \`${idTxt}\`) nie jest kanałem tekstowym (typ ${ocr.typ ?? '?'}) — bot nie ma jak nic na nim wysłać`,
                    `❌ The OCR channel (ID: \`${idTxt}\`) is not a text channel (type ${ocr.typ ?? '?'}) — the bot cannot post there`));
                lines.push(t('└ Użyj `/configure`, aby wskazać kanał tekstowy.', '└ Use `/configure` to pick a text channel.'));
            } else {
                addIssue(t(`❌ Nie udało się sprawdzić kanału OCR (ID: \`${idTxt}\`)`, `❌ Could not check the OCR channel (ID: \`${idTxt}\`)`));
            }
        } else {
            lines.push(t(`📺 **Uprawnienia w kanale #${channel.name}**`, `📺 **Permissions in #${channel.name}**`));
            const jestWatkiem = typeof channel.isThread === 'function' && channel.isThread();
            const CHANNEL_PERMS = [
                [PermissionFlagsBits.ViewChannel,        'ViewChannel'],
                // W wątku „Wyślij wiadomości" NIE wystarcza — Discord sprawdza osobną
                // flagę. Uprawnienia wątku liczy się z kanału-rodzica, więc SendMessages
                // potrafi być zielone przy wysyłce lecącej na Missing Access.
                jestWatkiem
                    ? [PermissionFlagsBits.SendMessagesInThreads, 'SendMessagesInThreads']
                    : [PermissionFlagsBits.SendMessages, 'SendMessages'],
                [PermissionFlagsBits.EmbedLinks,         'EmbedLinks'],
                [PermissionFlagsBits.ReadMessageHistory, 'ReadMessageHistory'],
                [PermissionFlagsBits.AttachFiles,        'AttachFiles'],
            ];
            if (autoReakcja) CHANNEL_PERMS.push([PermissionFlagsBits.AddReactions, 'AddReactions']);
            if (autoReakcjaCustom) CHANNEL_PERMS.push([PermissionFlagsBits.UseExternalEmojis, 'UseExternalEmojis']);
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
            if (jestWatkiem && channel.locked) {
                addIssue(t('❌ Wątek jest zamknięty (locked) — nikt poza moderacją nic w nim nie napisze', '❌ The thread is locked — nobody but moderators can post in it'));
            } else if (jestWatkiem && channel.archived) {
                lines.push(t('ℹ️ Wątek jest zarchiwizowany — wysyłka go odarchiwizuje', 'ℹ️ The thread is archived — sending will unarchive it'));
            }
        }

        // --- Kategoria 2b: Rozgłoszenia /info ---
        // Rachunek uprawnień to nie to samo, co zgoda Discorda: liczymy go z nakładek,
        // a serwer sprawdza jeszcze typ kanału, stan wątku i to, czy aplikacja w ogóle
        // ma dostęp do zasobu. Dlatego oprócz rachunku wykonujemy DOKŁADNIE tę operację,
        // którą robi /info — wysyłamy embed i od razu go kasujemy. Ptaszek postawiony
        // na podstawie samego rachunku potrafił kłamać, ten nie ma jak.
        lines.push('');
        lines.push(t('📨 **Rozgłoszenia /info**', '📨 **/info Broadcasts**'));

        const naLiscieOdbiorcow = this.config.getAllGuilds().some(g => g.id === guildId);
        if (naLiscieOdbiorcow) {
            lines.push(t('✅ Serwer jest na liście odbiorców rozgłoszeń', '✅ Server is on the broadcast recipient list'));
        } else {
            addIssue(t(
                '❌ Serwer NIE jest na liście odbiorców — `/info` pomija go po cichu',
                '❌ Server is NOT on the recipient list — `/info` silently skips it'));
            lines.push(t('└ Dokończ `/configure` na tym serwerze.', '└ Complete `/configure` on this server.'));
        }

        if (channel) {
            const testEmbed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setDescription(t(
                    '🔧 Test dostarczania `/info` — ta wiadomość zaraz zniknie.',
                    '🔧 `/info` delivery test — this message will disappear in a moment.'));
            try {
                const probna = await channel.send({ embeds: [testEmbed] });
                lines.push(t('✅ Test wysyłki — wiadomość dostarczona i usunięta', '✅ Delivery test — message delivered and removed'));
                await probna.delete().catch(() => {
                    lines.push(t('└ ℹ️ Nie udało się jej usunąć — skasuj ją ręcznie.', '└ ℹ️ Could not remove it — please delete it manually.'));
                });
            } catch (err) {
                const opis = this._mapSendError(err);
                addIssue('❌ ' + t('Test wysyłki NIE przeszedł', 'Delivery test FAILED')
                    + `: ${t(opis.pol, opis.eng)} (${err.code ?? '?'} — ${err.message})`);
                lines.push(`└ ${t(opis.fix_pol, opis.fix_eng)}`);
            }
        }

        // --- Kategoria 3: Kanały raportów ---
        const REPORT_CHANNEL_PERMS = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
        ];
        const checkReportChannel = async (chId, label) => {
            const wynik = await pobierzKanal(chId);
            const ch = wynik.ch;
            if (!ch) {
                const opis = wynik.powod === 'niewidoczny'
                    ? t('bot nie widzi tego kanału (brak **Wyświetl kanał**)', 'bot cannot see this channel (missing **View Channel**)')
                    : wynik.powod === 'obcy'
                        ? t(`kanał należy do innego serwera (\`${wynik.obcyGuildId}\`)`, `channel belongs to another server (\`${wynik.obcyGuildId}\`)`)
                    : wynik.powod === 'usuniety'
                        ? t(`kanał \`${chId}\` nie istnieje`, `channel \`${chId}\` does not exist`)
                    : (wynik.powod === 'nietekstowy' || wynik.powod === 'nieserwerowy')
                        ? t(`kanał \`${chId}\` nie jest kanałem tekstowym (typ ${wynik.typ ?? '?'})`, `channel \`${chId}\` is not a text channel (type ${wynik.typ ?? '?'})`)
                        : t(`nie udało się sprawdzić kanału \`${chId}\``, `could not check channel \`${chId}\``);
                addIssue(`❌ ${label} — ${opis}`);
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
            await checkReportChannel(invalidChId, t('Odrzucone screeny (per-serwer)', 'Invalid screens (per-guild)'));
        }

        // Per-guild: kanał weryfikacji społeczności
        const cvConfig = this.guildConfigService?.getCommunityVerification(guildId);
        const cvChId = cvConfig?.rejectedChannelId;
        if (!cvConfig?.enabled) {
            lines.push(t('ℹ️ Weryfikacja społeczności — wyłączona', 'ℹ️ Community verification — disabled'));
        } else if (!cvChId) {
            lines.push(t('ℹ️ Kanał CV — nie skonfigurowany', 'ℹ️ CV channel — not configured'));
        } else {
            await checkReportChannel(cvChId, t('Weryfikacja społeczności (per-serwer)', 'Community verification (per-guild)'));
        }

        // --- Kategoria 5: Hierarchia ról TOP ---
        lines.push('');
        lines.push(t('🏅 **Hierarchia ról TOP**', '🏅 **TOP Role Hierarchy**'));
        const botHighestPos = botMember.roles.highest.position;
        const botRoleName = botMember.roles.highest.name;
        if (!uzywaRolTop) {
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
        const intents = client.options.intents;
        const { GatewayIntentBits } = require('discord.js');
        const intentChecks = [
            [GatewayIntentBits.GuildMembers,    t('GuildMembers (fetch memberów, rankingi ról)', 'GuildMembers (member fetch, role rankings)')],
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

        // Opis embeda ma twardy limit 4096 znaków — przekroczenie wywraca CAŁĄ
        // diagnostykę na walidacji, więc przy długiej liście ról TOP wolimy uciąć.
        let opis = `${summary}\n\n${lines.join('\n')}`;
        if (opis.length > 4096) {
            opis = opis.slice(0, 4040) + '\n' + t('… (raport skrócony)', '… (report truncated)');
        }

        return new EmbedBuilder()
            .setColor(color)
            .setTitle(t(`🔍 Diagnostyka — ${guild.name}`, `🔍 Diagnostics — ${guild.name}`))
            .setDescription(opis)
            .setFooter({ text: t(`Rola bota: "${botRoleName}" · poz. ${botHighestPos}`, `Bot role: "${botRoleName}" · pos. ${botHighestPos}`) })
            .setTimestamp();
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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('ban_guild_query').trim());
        await interaction.deferReply({ flags: ['Ephemeral'] });

        const matches = [];
        for (const [guildId, guild] of interaction.client.guilds.cache) {
            if (!normalizeForSearch(guild.name).includes(query)) continue;
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
        this._ccAudit(interaction, `🚫 Zbanowano serwer: ${guildName}`);
        this.adminPanelService?.refresh();

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

    async _handlePanelDeleteServerData(interaction) {
        const t = this._panelT(interaction.guildId);

        const configuredIds = this.guildConfigService.getAllConfiguredGuildIds();
        const absentGuilds = configuredIds.filter(guildId => !interaction.client.guilds.cache.has(guildId));

        if (absentGuilds.length === 0) {
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle(t('🗑️ Usuń dane serwera', '🗑️ Delete Server Data'))
                    .setDescription(t(
                        'Brak skonfigurowanych serwerów, na których bot już nie jest obecny.',
                        'No configured servers where the bot is no longer present.'
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_cat_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }

        const options = absentGuilds.slice(0, 25).map(guildId => {
            const cfg = this.guildConfigService.getConfig(guildId);
            const label = cfg?.tag || guildId;
            return {
                label: label.substring(0, 100),
                description: guildId,
                value: guildId,
            };
        });

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle(t('🗑️ Usuń dane serwera', '🗑️ Delete Server Data'))
                .setDescription(t(
                    `Znaleziono **${absentGuilds.length}** serwer(ów), na których bot już nie jest obecny.\n\nWybierz serwer, którego dane chcesz usunąć:`,
                    `Found **${absentGuilds.length}** server(s) where the bot is no longer present.\n\nSelect a server to delete its data:`
                ))],
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('panel_delete_server_sel')
                        .setPlaceholder(t('Wybierz serwer...', 'Select a server...'))
                        .addOptions(options)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_cat_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                ),
            ],
        });
    }

    async _handlePanelDeleteServerDataSelect(interaction) {
        const t = this._panelT(interaction.guildId);
        const guildId = interaction.values[0];
        const cfg = this.guildConfigService.getConfig(guildId);
        const guildName = cfg?.tag || guildId;

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(t('⚠️ Potwierdź usunięcie danych', '⚠️ Confirm Data Deletion'))
            .setDescription(t(
                `Czy na pewno chcesz usunąć wszystkie dane serwera **${guildName}**?\n\n` +
                `Zostaną usunięte:\n` +
                `• Ranking graczy\n` +
                `• Historia wyników\n` +
                `• Osiągnięcia graczy\n` +
                `• Rekordy bossów\n` +
                `• Konfiguracja serwera\n\n` +
                `⚠️ **Ta operacja jest nieodwracalna!**`,
                `Are you sure you want to delete all data for server **${guildName}**?\n\n` +
                `The following will be deleted:\n` +
                `• Player rankings\n` +
                `• Score history\n` +
                `• Player achievements\n` +
                `• Boss records\n` +
                `• Server configuration\n\n` +
                `⚠️ **This action cannot be undone!**`
            ));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`panel_delete_server_ok_${guildId}`).setEmoji('✅').setLabel(t('Tak, usuń dane', 'Yes, delete data')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_delete_server_data').setEmoji('❌').setLabel(t('Anuluj', 'Cancel')).setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [embed], components: [row] });
    }

    async _handlePanelDeleteServerDataConfirm(interaction, guildIdToDelete) {
        const t = this._panelT(interaction.guildId);
        const cfg = this.guildConfigService.getConfig(guildIdToDelete);
        const guildName = cfg?.tag || guildIdToDelete;

        try {
            const guildDataDir = path.join(__dirname, '../data/guilds', guildIdToDelete);
            await fs.rm(guildDataDir, { recursive: true, force: true }).catch(err => {
                if (err.code !== 'ENOENT') throw err;
            });

            // Wyrzuć skasowane pliki z pamięci — inaczej cache nadal by je oddawał,
            // a pierwszy zapis odtworzyłby je na dysku ze starą zawartością
            store.forget(guildDataDir);

            // ⚠️ Sam `store.forget()` NIE wystarcza: rankingService ma WŁASNY cache
            // (`_rankingCache`), który `loadRanking()` sprawdza PRZED sięgnięciem do store'a.
            // Bez tego skasowany ranking dalej był oddawany z pamięci, a pierwszy zapis
            // wskrzeszał go na dysku — czyli dane, które użytkownik kazał usunąć, wracały.
            this.rankingService?.invalidateGuildCache(guildIdToDelete);

            await this.guildConfigService.deleteConfig(guildIdToDelete);

            const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            this.logService._gl(interaction.guildId).warn(`${this.logService.nickLink(nick, interaction.user.id)} Usunięto dane serwera "${guildName}" (${guildIdToDelete})`);
            this._ccAudit(interaction, `🗑️ Usunięto dane serwera: ${guildName}`);
            this.adminPanelService?.refresh();

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle(t('✅ Dane usunięte', '✅ Data Deleted'))
                    .setDescription(t(
                        `Dane serwera **${guildName}** zostały pomyślnie usunięte.`,
                        `Data for server **${guildName}** has been successfully deleted.`
                    ))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_delete_server_data').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
        } catch (err) {
            this.logService._gl(interaction.guildId).error(`Błąd usuwania danych serwera "${guildName}": ${err.message}`);
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription(t(`❌ Błąd podczas usuwania danych: ${err.message}`, `❌ Error deleting data: ${err.message}`))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_delete_server_data').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
        }
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
        this._ccAudit(interaction, `✅ Odbanowano serwer: ${guildName}`);

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x57F287)
                .setDescription(t(`✅ Serwer **${guildName}** został odblokowany.`, `✅ Server **${guildName}** has been unblocked.`))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_ban_server').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    async _handlePanelPlayerGrowth(interaction) {
        const t = this._panelT(interaction.guildId);
        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
            const configuredIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const allGuildIds = configuredIds.filter(gid => interaction.client.guilds.cache.has(gid));

            // Licznik całkowity = ranking globalny (jak stopka embeda admina po /update). Historia
            // filtrowana do tego samego zbioru graczy, żeby +7/+30 dni i krzywa wykresu zgadzały się
            // z "Łącznie".
            const { total: totalPlayers, playerIds } = await this.rankingService.getCountedPlayers(new Set(allGuildIds));

            const [firstEntries, guildFirstTs, totalSubmissions, guildRankingCounts, perGuildEntries] = await Promise.all([
                this.scoreHistoryService?.getAllUsersFirstEntries(allGuildIds, playerIds) || [],
                this.scoreHistoryService?.getGuildFirstTimestamps(allGuildIds) || {},
                this.scoreHistoryService?.getTotalSubmissionCount(allGuildIds) || 0,
                Promise.all(allGuildIds.map(gid =>
                    this.rankingService.loadRanking(gid).then(r => ({ gid, count: Object.keys(r).length }))
                )),
                this.scoreHistoryService?.getPerGuildFirstEntries(allGuildIds, playerIds) || {},
            ]);

            const guildCounts = Object.fromEntries(guildRankingCounts.map(r => [r.gid, r.count]));
            const now = Date.now();
            const last7  = firstEntries.filter(e => e.firstTimestamp >= now - 7  * 86400000).length;
            const last30 = firstEntries.filter(e => e.firstTimestamp >= now - 30 * 86400000).length;

            // Daty pierwszego i ostatniego gracza
            const fmtDate = (ts) => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const firstDate = firstEntries.length > 0 ? fmtDate(firstEntries[0].firstTimestamp) : '—';
            const lastDate  = firstEntries.length > 0 ? fmtDate(firstEntries[firstEntries.length - 1].firstTimestamp) : '—';

            // Linie per serwer (liczba graczy którzy mają jakikolwiek wynik na danym serwerze)
            const guildLines = allGuildIds
                .map(guildId => ({
                    guildId,
                    count: guildCounts[guildId] || 0,
                    guildName: interaction.client.guilds.cache.get(guildId)?.name || guildId,
                    tag: this.guildConfigService?.getAllConfiguredGuilds().find(g => g.id === guildId)?.tag || '',
                }))
                .filter(g => g.count > 0)
                .sort((a, b) => b.count - a.count)
                .map(g => `• **${g.guildName}**${g.tag ? ` \`${g.tag}\`` : ''} — **${g.count}** ${t('graczy', 'players')}`);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(t('📈 Przyrost Unikalnych Graczy', '📈 Unique Player Growth'))
                .addFields(
                    {
                        name: t('📊 Łącznie', '📊 Total'),
                        value: [
                            `**${totalPlayers}** ${t('unikalnych graczy globalnie', 'unique players globally')}`,
                            `+**${last7}** ${t('ostatnie 7 dni', 'last 7 days')}`,
                            `+**${last30}** ${t('ostatnie 30 dni', 'last 30 days')}`,
                        ].join('\n'),
                        inline: true,
                    },
                    {
                        name: t('📅 Zakres', '📅 Range'),
                        value: [
                            `${t('Pierwszy gracz:', 'First player:')} **${firstDate}**`,
                            `${t('Ostatni gracz:', 'Latest player:')} **${lastDate}**`,
                        ].join('\n'),
                        inline: true,
                    },
                    {
                        name: t('🌍 Per serwer', '🌍 Per server'),
                        value: guildLines.length > 0 ? guildLines.join('\n') : t('Brak danych', 'No data'),
                        inline: false,
                    }
                );

            // Wspólny zakres czasu dla obu wykresów (ta sama logika co w chartService)
            const growthCutoff = Date.UTC(2026, 3, 1);
            const filteredForRange = firstEntries.filter(e => e.firstTimestamp >= growthCutoff);
            let sharedTMin = null, sharedTMax = null;
            if (filteredForRange.length >= 2) {
                const daySetMs = new Set(filteredForRange.map(e => {
                    const d = new Date(e.firstTimestamp);
                    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
                }));
                const sortedDays = Array.from(daySetMs).sort((a, b) => a - b);
                if (sortedDays.length >= 2) {
                    sharedTMin = sortedDays[0];
                    sharedTMax = Math.max(Date.now(), sortedDays[sortedDays.length - 1] + 86400000);
                }
            }

            const allCfgGuilds = this.guildConfigService?.getAllConfiguredGuilds() || [];

            let chartAttachment = null;
            if (this.chartService && firstEntries.length >= 2) {
                try {
                    const chartTitle = t('📊 Przyrost Unikalnych Graczy', '📊 Unique Player Growth');
                    const chartSubtitle = `${totalPlayers} ${t('graczy', 'players')} · ${totalSubmissions} ${t('pobitych wyników', 'beaten records')}`;
                    const guildMarkers = allGuildIds
                        .filter(gid => guildFirstTs[gid] != null)
                        .map(gid => {
                            const cfg = allCfgGuilds.find(g => g.id === gid);
                            const name = interaction.client.guilds.cache.get(gid)?.name || gid;
                            return { firstTimestamp: guildFirstTs[gid], tag: cfg?.tag || name, name };
                        });
                    const buf = await this.chartService.generateGlobalPlayerGrowthChart(firstEntries, chartTitle, guildMarkers, totalSubmissions, chartSubtitle, totalPlayers, this._chartLang(interaction.guildId));
                    if (buf) chartAttachment = new AttachmentBuilder(buf, { name: 'player_growth.png' });
                } catch (chartErr) {
                    logger.warn('Błąd generowania wykresu przyrostu graczy:', chartErr);
                }
            }

            let chart2Attachment = null;
            if (this.chartService && perGuildEntries && Object.keys(perGuildEntries).length > 0 && sharedTMin !== null) {
                try {
                    const guildInfoForChart = allGuildIds.map(gid => {
                        const cfg = allCfgGuilds.find(g => g.id === gid);
                        const name = interaction.client.guilds.cache.get(gid)?.name || gid;
                        return { guildId: gid, name, tag: cfg?.tag || name };
                    });
                    const chartTitle2 = t('📊 Przyrost Graczy per Serwer', '📊 Player Growth per Server');
                    const buf2 = await this.chartService.generatePerServerGrowthChart(
                        perGuildEntries, guildInfoForChart, chartTitle2, sharedTMin, sharedTMax, this._chartLang(interaction.guildId)
                    );
                    if (buf2) chart2Attachment = new AttachmentBuilder(buf2, { name: 'player_growth_per_server.png' });
                } catch (chartErr) {
                    logger.warn('Błąd generowania wykresu przyrostu graczy per serwer:', chartErr);
                }
            }

            const replyFiles = [];
            const replyEmbeds = [embed];
            if (chartAttachment) {
                replyEmbeds.push(new EmbedBuilder().setImage('attachment://player_growth.png'));
                replyFiles.push(chartAttachment);
            }
            if (chart2Attachment) {
                replyEmbeds.push(new EmbedBuilder().setImage('attachment://player_growth_per_server.png'));
                replyFiles.push(chart2Attachment);
            }

            await interaction.editReply({ embeds: replyEmbeds, files: replyFiles.length > 0 ? replyFiles : undefined });
        } catch (err) {
            logger.error('Błąd _handlePanelPlayerGrowth:', err);
            await interaction.editReply({ content: t('❌ Wystąpił błąd podczas generowania statystyk.', '❌ An error occurred while generating statistics.') });
        }
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
        // Podana data/godzina to czas lokalny Europe/Warsaw (tak jak wszędzie indziej w bocie,
        // np. fmtTs w Centrum Dowodzenia) — konwertowana na poprawny instant UTC z uwzględnieniem
        // CET/CEST. Naiwne parsowanie jako UTC (samo doklejenie 'Z') zapisywałoby harmonogram
        // przesunięty o 1-2h względem tego, co admin faktycznie wpisał.
        const date = this._warsawToUtc(yyyy, mm, dd, hh, min);
        if (isNaN(date.getTime())) {
            await interaction.editReply({ content: t('❌ Podana data jest nieprawidłowa.', '❌ The provided date is invalid.') });
            return;
        }
        // Data w przeszłości jest dozwolona — traktowana jako punkt odniesienia (np. faktyczny
        // koniec bossa), harmonogram sam przewinie się do najbliższego przyszłego terminu.
        const wasPast = date.getTime() <= Date.now();

        // Podana data to zawsze początek cyklu (boss #1 sezonu) — setSchedule domyślnie
        // ustawia triggerCount na 0 (reportNumber=1).
        this.globalTop10Service.setSchedule(date.toISOString());
        const cfg = this.globalTop10Service.getConfig();

        const formatted = `${dd.padStart(2,'0')}.${mm.padStart(2,'0')}.${yyyy} ${hh.padStart(2,'0')}:${min}`;
        const fmtNext = this._fmtWarsaw(new Date(cfg.nextTrigger));

        const recalibrationNote = wasPast
            ? t(`\n⏪ Punkt odniesienia był w przeszłości — harmonogram przewinięty bez wysyłania zaległych raportów.\n➡️ Najbliższy kolejny raport: **${fmtNext}**`,
                `\n⏪ Reference point was in the past — schedule fast-forwarded without sending backlog reports.\n➡️ Next upcoming report: **${fmtNext}**`)
            : '';

        await interaction.editReply({
            content: t(
                `✅ Harmonogram TOP10 ustawiony.\n📅 Początek cyklu: **${formatted}**\n🔁 Kolejne: co 3 dni (po 9 raportach — 4 dni przerwy, powtórz)${recalibrationNote}`,
                `✅ TOP10 schedule set.\n📅 Cycle start: **${formatted}**\n🔁 Subsequent: every 3 days (after 9 reports — 4 day break, repeat)${recalibrationNote}`
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
        const query = normalizeForSearch(interaction.fields.getTextInputValue('ach_check_query').trim());
        await interaction.deferUpdate();
        const t = this._panelT(interaction.guildId);

        try {
            const allGuildIds = new Set(interaction.client.guilds.cache.keys());
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);

            const matches = globalRanking.filter(p =>
                playerMatchesQuery(p, query, interaction.client, p.sourceGuildId || null)
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
                label: formatProfileDisplayName(p.username, p.profileIndex || 1).substring(0, 100),
                description: t(
                    `Serwer: ${interaction.client.guilds.cache.get(p.sourceGuildId)?.name || p.sourceGuildId}`,
                    `Server: ${interaction.client.guilds.cache.get(p.sourceGuildId)?.name || p.sourceGuildId}`
                ).substring(0, 100),
                value: `${p.playerKey || p.userId}:${p.sourceGuildId}`
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
            const [selectedPlayerKey, guildId] = interaction.values[0].split(':');
            const allGuildIds = new Set(interaction.client.guilds.cache.keys());
            const globalRanking = await this.rankingService.getGlobalRanking(allGuildIds);
            const player = globalRanking.find(p => (p.playerKey || p.userId) === selectedPlayerKey);
            const username = formatProfileDisplayName(player?.username || getOwnerId(selectedPlayerKey), getProfileIndex(selectedPlayerKey));
            await this._showPlayerAchievements(interaction, selectedPlayerKey, username, guildId);
        } catch (err) {
            logger.error(`Błąd _handleAchCheckSelect: ${err.message}`);
        }
    }

    async _showPlayerAchievements(interaction, targetUserId, targetUsername, sourceGuildId) {
        const lang = this.config.getGuildConfig(interaction.guildId)?.lang || 'pol';
        const allAchGuildIds = this._getProfileAllGuildIds(interaction.client);
        const { embed, components } = await this.achievementService.buildAchievementsViewForUserGlobal(
            allAchGuildIds, targetUserId, targetUsername, lang, 'cat', 'score', sourceGuildId
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
                const allAchGuildIds = this._getProfileAllGuildIds(interaction.client);
                const { embed, components } = await this.achievementService.buildAchievementsViewGlobal(
                    allAchGuildIds, this.profileRegistryService?.getMainPlayerKey(interaction.user.id) || interaction.user.id, lang, 'cat', 'score'
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

            const allAchGuildIds = this._getProfileAllGuildIds(interaction.client);
            const globalRanking = await this.rankingService.getGlobalRanking(allAchGuildIds);
            const player = globalRanking.find(p => (p.playerKey || p.userId) === targetUserId);
            const targetUsername = formatProfileDisplayName(player?.username || getOwnerId(targetUserId), getProfileIndex(targetUserId));

            const { embed, components } = await this.achievementService.buildAchievementsViewForUserGlobal(
                allAchGuildIds, targetUserId, targetUsername, lang,
                isOverview ? 'overview' : 'cat',
                isOverview ? null : category,
                targetGuildId
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
            const callerIdx = this._findCallerIndex(players, interaction.user.id);
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

            const embed = this.achievementService.buildAchRankingEmbed(players, 0, perPage, mode, guildName, isPol, iconUrl, this._mainPlayerKey(interaction.user.id));
            const buttons = this.achievementService.createAchRankingButtons(
                0, totalPages, mode, guildId, guildName, roleRows, isPol, userPage, parentGuildId, parentGuildName
            );

            const reply = await interaction.editReply({ content: null, embeds: [embed], components: buttons, files: [], attachments: [] });

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
            data.players, data.currentPage, data.perPage, data.mode, data.guildName, data.isPol, data.iconUrl, this._mainPlayerKey(data.userId)
        );
        const buttons = this.achievementService.createAchRankingButtons(
            data.currentPage, data.totalPages, data.mode, data.guildId, data.guildName,
            data.roleRows, data.isPol, data.userPage, data.parentGuildId, data.parentGuildName
        );
        await interaction.editReply({ embeds: [embed], components: buttons, files: [], attachments: [] });
    }

    // ─── ⚔️ WYZWANIA (/challenge) ─────────────────────────────────────────────

    /**
     * Serwis wyzwań podawany setterem, nie kolejnym parametrem pozycyjnym —
     * konstruktor ma ich już 31 (patrz komentarz w index.js).
     */
    setChallengeService(service) {
        this.challengeService = service;
    }

    /**
     * Ikona bossa do thumbnaila embeda. Zwracamy BUFOR, nie gotowy AttachmentBuilder —
     * ten sam obrazek leci w kilku wiadomościach (DM do obu graczy, ogłoszenie na serwerze),
     * a załącznik trzeba zbudować osobno dla każdej wysyłki.
     * @returns {Promise<{ buffer: Buffer|null, name: string|null, thumb: string|null }>}
     */
    async _challengeBossImage(boss) {
        try {
            const imgPath = this.bossAliasService?.getBossImagePath(boss);
            if (!imgPath) return { buffer: null, name: null, thumb: null };
            const buffer = await fs.readFile(path.join(__dirname, '../data/boss_images', imgPath));
            return { buffer, name: imgPath, thumb: `attachment://${imgPath}` };
        } catch {
            return { buffer: null, name: null, thumb: null };
        }
    }

    /** Świeży załącznik ikony bossa dla pojedynczej wiadomości */
    _challengeBossFiles(image) {
        return image?.buffer ? [new AttachmentBuilder(image.buffer, { name: image.name })] : [];
    }

    /** Nazwa serwera do embedów wyzwania */
    _challengeGuildName(client, guildId) {
        return client.guilds.cache.get(guildId)?.name
            || this.config.getGuildConfig(guildId)?.guildName
            || guildId;
    }

    // ── Wizard ────────────────────────────────────────────────────────────────

    /**
     * `/challenge` — na razie WYŁĄCZNIE dla head admina (komenda widoczna tylko dla
     * administratorów przez setDefaultMemberPermissions, wykonanie dodatkowo bramkowane).
     */
    async handleChallengeCommand(interaction) {
        const msgs = this.msgs(interaction.guildId);
        if (!this._isHeadAdmin(interaction.user.id)) {
            await interaction.reply({ content: msgs.noPermission, flags: ['Ephemeral'] });
            return;
        }
        if (!this.challengeService) {
            await interaction.reply({ content: msgs.updateError, flags: ['Ephemeral'] });
            return;
        }

        this._challengeSessions.set(interaction.user.id, {
            guildId: null, playerKey: null, playerName: null, boss: null,
            createdAt: Date.now(),
        });

        const options = this.config.getAllGuilds().map(g =>
            new StringSelectMenuOptionBuilder()
                .setValue(g.id)
                .setLabel(this._challengeGuildName(interaction.client, g.id).substring(0, 100))
        );
        if (options.length === 0) {
            await interaction.reply({ content: msgs.challengeNoPlayers, flags: ['Ephemeral'] });
            return;
        }
        const select = new StringSelectMenuBuilder()
            .setCustomId('chal_srv')
            .setPlaceholder(msgs.challengeSelectServerPlaceholder)
            .addOptions(options.slice(0, 25));

        await interaction.reply({
            content: msgs.challengeIntro,
            components: [new ActionRowBuilder().addComponents(select)],
            flags: ['Ephemeral'],
        });
    }

    /** Sesja wizarda (RAM, TTL 15 min) — customId nie pomieści guildId + playerKey + nazwy bossa */
    _getChallengeSession(userId) {
        const session = this._challengeSessions.get(userId);
        if (!session) return null;
        if (Date.now() - session.createdAt > 15 * 60 * 1000) {
            this._challengeSessions.delete(userId);
            return null;
        }
        return session;
    }

    async _handleChallengeServerSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const session = this._getChallengeSession(interaction.user.id);
        if (!session) {
            await interaction.editReply({ content: msgs.challengeSessionExpired, components: [] });
            return;
        }
        session.guildId = interaction.values[0];
        await this._renderChallengePlayerPicker(interaction, 0);
    }

    /** Lista graczy wybranego serwera (25/stronę + przyciski zakresów liter) */
    async _renderChallengePlayerPicker(interaction, offset) {
        const msgs = this.msgs(interaction.guildId);
        const session = this._getChallengeSession(interaction.user.id);
        if (!session?.guildId) {
            await interaction.editReply({ content: msgs.challengeSessionExpired, components: [] });
            return;
        }

        const sorted = (await this._getNotifSortedPlayers(session.guildId, interaction.client))
            // Wyzwać można wyłącznie kogoś innego — wszystkie własne profile odpadają
            .filter(p => getOwnerId(p.playerKey || p.userId) !== interaction.user.id);

        if (sorted.length === 0) {
            await interaction.editReply({ content: msgs.challengeNoPlayers, components: [] });
            return;
        }

        const PAGE_SIZE = 25;
        const page = sorted.slice(offset, offset + PAGE_SIZE);
        const select = new StringSelectMenuBuilder()
            .setCustomId('chal_pl')
            .setPlaceholder(msgs.challengeSelectPlayerPlaceholder)
            .addOptions(page.map(p =>
                new StringSelectMenuOptionBuilder()
                    .setValue(p.playerKey || p.userId)
                    .setLabel(p.displayName.substring(0, 100))
            ));
        const selectRow = new ActionRowBuilder().addComponents(select);

        const components = sorted.length <= PAGE_SIZE
            ? [selectRow]
            : [...this._buildChallengePageButtons(sorted, offset), selectRow];

        await interaction.editReply({ content: msgs.challengeSelectPlayer, components });
    }

    /** Przyciski zakresów liter dla listy graczy (analogicznie do `/subscribe`) */
    _buildChallengePageButtons(players, activeOffset) {
        const PAGE_SIZE = 25;
        const rows = [];
        let currentRow = [];
        for (let offset = 0; offset < players.length; offset += PAGE_SIZE) {
            if (rows.length >= 4 && currentRow.length === 0) break;
            const page = players.slice(offset, offset + PAGE_SIZE);
            const first = (page[0].displayName || '?')[0].toUpperCase();
            const last = (page[page.length - 1].displayName || '?')[0].toUpperCase();
            currentRow.push(
                new ButtonBuilder()
                    .setCustomId(`chal_page_${offset}`)
                    .setLabel(first === last ? first : `${first} - ${last}`)
                    .setStyle(offset === activeOffset ? ButtonStyle.Success : ButtonStyle.Primary)
            );
            if (currentRow.length === 5) {
                rows.push(new ActionRowBuilder().addComponents(currentRow));
                currentRow = [];
            }
        }
        if (currentRow.length > 0 && rows.length < 4) rows.push(new ActionRowBuilder().addComponents(currentRow));
        return rows;
    }

    async _handleChallengePlayerSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const session = this._getChallengeSession(interaction.user.id);
        if (!session?.guildId) {
            await interaction.editReply({ content: msgs.challengeSessionExpired, components: [] });
            return;
        }
        session.playerKey = interaction.values[0];
        const sorted = await this._getNotifSortedPlayers(session.guildId, interaction.client);
        const chosen = sorted.find(p => (p.playerKey || p.userId) === session.playerKey);
        session.playerName = chosen?.displayName || session.playerKey;
        await this._renderChallengeBossPicker(interaction, 0);
    }

    /** Lista bossów (25/stronę — nazw bywa więcej niż limit select menu) */
    async _renderChallengeBossPicker(interaction, page) {
        const msgs = this.msgs(interaction.guildId);
        const bosses = this._getAllEnglishBossNames();
        if (bosses.length === 0) {
            await interaction.editReply({ content: msgs.challengeNoBosses, components: [] });
            return;
        }
        const PAGE_SIZE = 25;
        const maxPage = Math.max(0, Math.ceil(bosses.length / PAGE_SIZE) - 1);
        const safePage = Math.min(Math.max(0, page), maxPage);
        const slice = bosses.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

        const select = new StringSelectMenuBuilder()
            .setCustomId('chal_boss')
            .setPlaceholder(msgs.challengeSelectBossPlaceholder)
            .addOptions(slice.map(b =>
                new StringSelectMenuOptionBuilder().setValue(b.substring(0, 100)).setLabel(b.substring(0, 100))
            ));
        const components = [new ActionRowBuilder().addComponents(select)];
        if (maxPage > 0) {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`chal_bpage_${safePage - 1}`).setEmoji('◀').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
                new ButtonBuilder().setCustomId('chal_bpage_info').setLabel(`${safePage + 1}/${maxPage + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`chal_bpage_${safePage + 1}`).setEmoji('▶').setStyle(ButtonStyle.Secondary).setDisabled(safePage === maxPage),
            ));
        }
        await interaction.editReply({ content: msgs.challengeSelectBoss, components });
    }

    async _handleChallengeBossSelect(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const session = this._getChallengeSession(interaction.user.id);
        if (!session?.playerKey) {
            await interaction.editReply({ content: msgs.challengeSessionExpired, components: [] });
            return;
        }
        session.boss = interaction.values[0];

        const guildName = this._challengeGuildName(interaction.client, session.guildId);
        const bossImage = await this._challengeBossImage(session.boss);
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(msgs.challengeConfirmTitle)
            .setDescription([
                formatMessage(msgs.challengeConfirmText, {
                    opponent: session.playerName, guild: guildName, boss: session.boss,
                }),
                '',
                msgs.challengeRules,
            ].join('\n'));
        if (bossImage.thumb) embed.setThumbnail(bossImage.thumb);

        await interaction.editReply({
            content: '',
            embeds: [embed],
            files: this._challengeBossFiles(bossImage),
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('chal_ok').setEmoji('⚔️').setLabel(msgs.challengeConfirmYes).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('chal_no').setEmoji('❌').setLabel(msgs.challengeConfirmNo).setStyle(ButtonStyle.Secondary),
            )],
        });
    }

    /** Zatwierdzenie wyzwania — walidacje, wysyłka DM, dopiero potem zapis rekordu */
    async _handleChallengeConfirm(interaction) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        const session = this._getChallengeSession(interaction.user.id);
        if (!session?.boss || !session?.playerKey) {
            await interaction.editReply({ content: msgs.challengeSessionExpired, embeds: [], files: [], components: [] });
            return;
        }
        const gl = this.logService._gl(interaction.guildId);
        const challengerKey = this._mainPlayerKey(interaction.user.id);
        const opponentKey = session.playerKey;
        const opponentId = getOwnerId(opponentKey);

        const done = (content) => interaction.editReply({ content, embeds: [], files: [], components: [] });

        if (opponentId === interaction.user.id) return void await done(msgs.challengeErrSelf);

        const open = await this.challengeService.countOpenForPlayer(challengerKey);
        if (open >= this.challengeService.maxActivePerPlayer) {
            return void await done(formatMessage(msgs.challengeErrLimit, {
                count: open, max: this.challengeService.maxActivePerPlayer,
            }));
        }
        if (await this.challengeService.hasOpenBetween(challengerKey, opponentKey, session.boss)) {
            return void await done(formatMessage(msgs.challengeErrDuplicate, { boss: session.boss }));
        }

        const challengerName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        const challenge = await this.challengeService.create({
            challenger: { playerKey: challengerKey, guildId: interaction.guildId, username: challengerName },
            opponent: { playerKey: opponentKey, guildId: session.guildId, username: session.playerName },
            boss: session.boss,
        });

        // DM idzie PRZED utrwaleniem wyzwania jako ważne — gdy nie dojdzie, kasujemy wpis
        const sent = await this._sendChallengeInvite(interaction.client, challenge, challengerName);
        if (!sent) {
            await this.challengeService.discard(challenge.id);
            return void await done(formatMessage(msgs.challengeErrDmClosed, { opponent: session.playerName }));
        }

        this._challengeSessions.delete(interaction.user.id);
        if (this.achievementService) {
            this.achievementService.trackChallengeSent(interaction.guildId, challengerKey).catch(() => {});
        }
        gl.info(`⚔️ ${this.logService.nickLink(challengerName, interaction.user.id)} rzucił wyzwanie graczowi "${session.playerName}" na bossie "${session.boss}"`);
        await done(formatMessage(msgs.challengeSent, { opponent: session.playerName, boss: session.boss }));
    }

    /** Wysyła DM z zaproszeniem. @returns {Promise<boolean>} czy doszło */
    async _sendChallengeInvite(client, challenge, challengerName) {
        const opponentMsgs = this.msgs(challenge.opponent.guildId);
        const guildName = this._challengeGuildName(client, challenge.challenger.guildId);
        const bossImage = await this._challengeBossImage(challenge.boss);

        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(opponentMsgs.challengeDmInviteTitle)
            .setDescription([
                formatMessage(opponentMsgs.challengeDmInviteDesc, {
                    challenger: challengerName, guild: guildName, boss: challenge.boss,
                }),
                '',
                opponentMsgs.challengeRules,
                '',
                formatMessage(opponentMsgs.challengeDmInviteExpires, {
                    date: this._discordTs(challenge.inviteExpiresAt, 'F'),
                }),
            ].join('\n'))
            .setTimestamp();
        if (bossImage.thumb) embed.setThumbnail(bossImage.thumb);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`chal_acc_${challenge.id}`).setEmoji('⚔️').setLabel(opponentMsgs.challengeBtnAccept).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`chal_rej_${challenge.id}`).setEmoji('❌').setLabel(opponentMsgs.challengeBtnDecline).setStyle(ButtonStyle.Danger),
        );

        try {
            const user = await client.users.fetch(challenge.opponent.userId);
            const dm = await user.send({ embeds: [embed], files: this._challengeBossFiles(bossImage), components: [row] });
            await this.challengeService.attachInvite(challenge.id, dm.channelId, dm.id);
            return true;
        } catch {
            return false;
        }
    }

    // ── Przyciski (DM + wizard) ───────────────────────────────────────────────

    /**
     * Router przycisków wyzwań. Wołany PRZED głównym `try` w `handleButtonInteraction`,
     * bo przyciski w DM nie mają `interaction.guild` ani `interaction.member`.
     */
    async handleChallengeButton(interaction, customId) {
        try {
            if (customId === 'chal_no') {
                this._challengeSessions.delete(interaction.user.id);
                await interaction.update({ content: this.msgs(interaction.guildId).challengeCancelled, embeds: [], files: [], components: [] });
                return;
            }
            if (customId === 'chal_ok') { await this._handleChallengeConfirm(interaction); return; }
            if (customId.startsWith('chal_page_')) {
                await interaction.deferUpdate();
                await this._renderChallengePlayerPicker(interaction, parseInt(customId.replace('chal_page_', ''), 10) || 0);
                return;
            }
            if (customId === 'chal_bpage_info') { await interaction.deferUpdate().catch(() => {}); return; }
            if (customId.startsWith('chal_bpage_')) {
                await interaction.deferUpdate();
                await this._renderChallengeBossPicker(interaction, parseInt(customId.replace('chal_bpage_', ''), 10) || 0);
                return;
            }
            if (customId.startsWith('chal_acc_')) { await this._handleChallengeResponse(interaction, customId.replace('chal_acc_', ''), true); return; }
            if (customId.startsWith('chal_rej_')) { await this._handleChallengeResponse(interaction, customId.replace('chal_rej_', ''), false); return; }
            if (customId.startsWith('chal_share_')) { await this._handleChallengeShare(interaction, customId); return; }
            if (customId.startsWith('chal_done_')) { await interaction.deferUpdate().catch(() => {}); return; }
        } catch (error) {
            logger.error(`Błąd obsługi przycisku wyzwania (${customId}): ${error.message}`);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: this.msgs(interaction.guildId).challengeErrGone, flags: ['Ephemeral'] });
                }
            } catch {}
        }
    }

    /** Przyjęcie / odrzucenie wyzwania z DM */
    async _handleChallengeResponse(interaction, challengeId, accepted) {
        const challenge = await this.challengeService.getById(challengeId);
        const msgs = this.msgs(challenge?.opponent?.guildId || interaction.guildId);

        if (!challenge || challenge.status !== 'pending') {
            await interaction.reply({ content: msgs.challengeErrGone, flags: ['Ephemeral'] });
            return;
        }
        // Uprawnienie sprawdzane po WŁAŚCICIELU profilu — customId nie jest źródłem prawdy
        if (challenge.opponent.userId !== interaction.user.id) {
            await interaction.reply({ content: msgs.challengeErrNotForYou, flags: ['Ephemeral'] });
            return;
        }

        if (accepted) {
            const open = await this.challengeService.countOpenForPlayer(challenge.opponent.playerKey);
            // Zaproszenie liczy się do limitu, więc porównujemy z limitem powiększonym o nie samo
            if (open > this.challengeService.maxActivePerPlayer) {
                await interaction.reply({
                    content: formatMessage(msgs.challengeErrAcceptLimit, {
                        count: open - 1, max: this.challengeService.maxActivePerPlayer,
                    }),
                    flags: ['Ephemeral'],
                });
                return;
            }
        }

        const updated = accepted
            ? await this.challengeService.accept(challengeId)
            : await this.challengeService.decline(challengeId);
        if (!updated) {
            await interaction.reply({ content: msgs.challengeErrGone, flags: ['Ephemeral'] });
            return;
        }

        // Przycisk zamienia się w nieaktywny znacznik
        const marker = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`chal_done_${challengeId}`)
                .setEmoji(accepted ? '⚔️' : '❌')
                .setLabel(accepted ? msgs.challengeBtnAccepted : msgs.challengeBtnDeclined)
                .setStyle(accepted ? ButtonStyle.Success : ButtonStyle.Danger)
                .setDisabled(true)
        );
        await interaction.update({ components: [marker] }).catch(() => {});
        await interaction.followUp({
            content: accepted
                ? formatMessage(msgs.challengeAcceptedReply, { boss: updated.boss })
                : msgs.challengeDeclinedReply,
            flags: ['Ephemeral'],
        }).catch(() => {});

        if (accepted && this.achievementService) {
            this.achievementService.trackChallengeAccepted(updated.opponent.guildId, updated.opponent.playerKey).catch(() => {});
        }

        // Powiadomienie dla wyzywającego — w języku JEGO serwera
        const challengerMsgs = this.msgs(updated.challenger.guildId);
        const opponentName = this.challengeService.participantName(updated.opponent, challengerMsgs);
        await this._dmUser(interaction.client, updated.challenger.userId, {
            content: formatMessage(
                accepted ? challengerMsgs.challengeDmAcceptedNotice : challengerMsgs.challengeDmDeclinedNotice,
                { opponent: opponentName, boss: updated.boss }
            ),
        });
    }

    /** Bezpieczna wysyłka DM — zamknięte wiadomości prywatne nie mogą wywrócić flow */
    async _dmUser(client, userId, payload) {
        try {
            const user = await client.users.fetch(userId);
            return await user.send(payload);
        } catch {
            return null;
        }
    }

    // ── Zaliczanie wyników ────────────────────────────────────────────────────

    /**
     * Wpinane w `_runUpdateFlow` po pozytywnej weryfikacji screena, PRZED rozgałęzieniem
     * na ścieżki (duplikat cross-server / brak rekordu / nowy rekord).
     *
     * Nierozpoznana nazwa bossa nie jest zaliczana od razu — wynik czeka na zmapowanie
     * aliasu przez admina (`_resolveChallengePendingBoss`).
     *
     * @returns {Promise<{ notices: Array, pending: boolean }>} notices → pole w Embedzie 4
     */
    async _registerChallengeScore(interaction, { playerKey, bossName, score, scoreValue, guildId, timestamp, wasUnknownBoss }) {
        if (!this.challengeService || !bossName) return { notices: [], pending: false };
        try {
            if (wasUnknownBoss) {
                const parked = await this.challengeService.addPendingScore({
                    playerKey, guildId, rawBoss: bossName, score, scoreValue, timestamp,
                });
                return { notices: [], pending: parked };
            }
            const { notices, finished } = await this.challengeService.registerScore({
                playerKey, bossName, score, scoreValue, guildId, timestamp,
            });
            if (finished.length > 0) await this._finishChallenges(interaction.client, finished);
            return { notices, pending: false };
        } catch (err) {
            this.logService._gl(guildId).warn(`⚠️ Błąd zaliczania wyniku do wyzwania: ${err.message}`);
            return { notices: [], pending: false };
        }
    }

    /** Buduje pole `⚔️ Wyzwanie` do Embeda 4 / treść DM o zaliczeniu wyniku */
    _challengeNoticeValue(notices, pending, msgs) {
        if (pending) return msgs.challengeNoticePending;
        if (!notices.length) return null;
        return notices.map(n => formatMessage(msgs.challengeNoticeCounted, {
            opponent: this.challengeService.participantName(n.opponent, msgs),
            boss: n.boss,
            count: n.count,
            total: n.total,
            sum: this.rankingService.formatScore(n.sum),
        })).join('\n\n');
    }

    /** Pole do `systemNotices` (Embed 4) albo null, gdy nie ma o czym informować */
    _challengeSystemNotice(result, msgs) {
        const value = this._challengeNoticeValue(result?.notices || [], result?.pending, msgs);
        return value ? { name: msgs.challengeNoticeField, value } : null;
    }

    /**
     * DM o zaliczeniu wyniku — wysyłany wyłącznie wtedy, gdy nie poszło publiczne
     * ogłoszenie (brak rekordu ogólnego i brak rekordu bossa), bo wtedy gracz nie
     * zobaczyłby tej informacji nigdzie indziej.
     */
    async _sendChallengeScoreDm(client, userId, guildId, result) {
        const msgs = this.msgs(guildId);
        const value = this._challengeNoticeValue(result?.notices || [], result?.pending, msgs);
        if (!value) return;
        const embed = new EmbedBuilder()
            .setColor(result?.pending ? 0xFEE75C : 0x5865F2)
            .setTitle(msgs.challengeDmCountedTitle)
            .setDescription(value)
            .setTimestamp();
        await this._dmUser(client, userId, { embeds: [embed] });
    }

    /**
     * Admin zmapował surową nazwę bossa na angielską — dopisujemy zaparkowane wyniki
     * i DOPIERO TERAZ informujemy graczy na priv.
     * Wołane z obu ścieżek mapowania: alertu o nieznanym bossie i panelu konfiguracji bossów.
     */
    async _resolveChallengePendingBoss(client, rawBoss, englishBoss) {
        if (!this.challengeService) return;
        try {
            const { credited, dropped, finished } = await this.challengeService.resolvePendingBoss(rawBoss, englishBoss);

            for (const item of credited) {
                const msgs = this.msgs(item.guildId);
                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle(msgs.challengeDmVerifiedTitle)
                    .setDescription([
                        formatMessage(msgs.challengeDmVerifiedDesc, { boss: englishBoss, score: item.score }),
                        '',
                        this._challengeNoticeValue(item.notices, false, msgs),
                    ].filter(Boolean).join('\n'))
                    .setTimestamp();
                await this._dmUser(client, item.userId, { embeds: [embed] });
            }

            for (const item of dropped) {
                const msgs = this.msgs(item.guildId);
                const embed = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle(msgs.challengeDmDroppedTitle)
                    .setDescription(formatMessage(
                        item.reason === 'too_late' ? msgs.challengeDmDroppedTooLate : msgs.challengeDmDroppedNoChallenge,
                        { boss: englishBoss, score: item.score }
                    ))
                    .setTimestamp();
                await this._dmUser(client, item.userId, { embeds: [embed] });
            }

            if (finished.length > 0) await this._finishChallenges(client, finished);
        } catch (err) {
            logger.warn(`⚠️ Błąd doliczania wyników wyzwań po zatwierdzeniu bossa: ${err.message}`);
        }
    }

    // ── Rezultat ──────────────────────────────────────────────────────────────

    /** Embed z rezultatem — składany w języku odbiorcy, nigdy nie przechowywany gotowy */
    _buildChallengeResultEmbed(challenge, msgs, { viewerSide = null, thumb = null, publicView = false } = {}) {
        const cs = this.challengeService;
        const nameA = cs.participantName(challenge.challenger, msgs);
        const nameB = cs.participantName(challenge.opponent, msgs);
        const fmt = (side) => {
            const scores = challenge[side].scores || [];
            const list = scores.length ? scores.map(s => `\`${s.score}\``).join(' · ') : msgs.challengeNoScores;
            return `${list}\n${msgs.challengeFieldSum}: **${this.rankingService.formatScore(challenge[side].sum)}**`;
        };

        let headline;
        if (challenge.status !== 'finished') {
            headline = msgs.challengeStatusUnresolved;
        } else if (!challenge.winner) {
            headline = msgs.challengeDrawLine;
        } else {
            const winnerName = challenge.winner === 'challenger' ? nameA : nameB;
            headline = formatMessage(msgs.challengeWinnerLine, { winner: winnerName });
        }
        // Na własnym DM dokładamy osobisty werdykt („Wygrałeś" / „Przegrałeś" / „Remis")
        if (viewerSide && challenge.status === 'finished') {
            const personal = !challenge.winner
                ? msgs.challengeResultDraw
                : (challenge.winner === viewerSide ? msgs.challengeResultWin : msgs.challengeResultLoss);
            headline = `${personal}\n${headline}`;
        }

        const color = challenge.status !== 'finished'
            ? 0x95A5A6
            : (!challenge.winner ? 0x5865F2 : (viewerSide && challenge.winner === viewerSide ? 0xF1C40F : (viewerSide ? 0xED4245 : 0xF1C40F)));

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(publicView ? msgs.challengePublicTitle : msgs.challengeDmResultTitle)
            .setDescription([
                formatMessage(msgs.challengeResultDesc, { a: nameA, b: nameB, boss: challenge.boss }),
                '',
                headline,
            ].join('\n'))
            .addFields(
                { name: `⚔️ ${nameA}`, value: fmt('challenger'), inline: true },
                { name: `🛡️ ${nameB}`, value: fmt('opponent'), inline: true },
            )
            .setTimestamp(challenge.finishedAt ? new Date(challenge.finishedAt) : new Date());
        if (thumb) embed.setThumbnail(thumb);
        return embed;
    }

    /**
     * Rozstrzygnięcie: osiągnięcia + DM do OBU graczy z jednorazowym przyciskiem
     * „pochwal się wynikami na swoim serwerze". Wyniku nie ogłaszamy automatycznie.
     */
    async _finishChallenges(client, challenges) {
        for (const challenge of challenges) {
            try {
                await this._applyChallengeAchievements(challenge);
                const bossImage = await this._challengeBossImage(challenge.boss);

                for (const side of ['challenger', 'opponent']) {
                    const participant = challenge[side];
                    if (participant.profileDeleted) continue;
                    const msgs = this.msgs(participant.guildId);
                    const embed = this._buildChallengeResultEmbed(challenge, msgs, { viewerSide: side, thumb: bossImage.thumb });
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`chal_share_${challenge.id}_${side === 'challenger' ? 'c' : 'o'}`)
                            .setEmoji('📢')
                            .setLabel(msgs.challengeBtnShare)
                            .setStyle(ButtonStyle.Success)
                    );
                    const dm = await this._dmUser(client, participant.userId, {
                        embeds: [embed],
                        files: this._challengeBossFiles(bossImage),
                        components: [row],
                    });
                    if (dm) await this.challengeService.attachResultDm(challenge.id, side, dm.channelId, dm.id);
                }

                this.logService._gl(challenge.challenger.guildId).info(
                    `⚔️ Wyzwanie zakończone: "${challenge.challenger.username}" vs "${challenge.opponent.username}" (${challenge.boss}) — ${challenge.winner ? `wygrał ${challenge[challenge.winner].username}` : 'remis'}`
                );
            } catch (err) {
                logger.error(`Błąd finalizacji wyzwania ${challenge.id}: ${err.message}`);
            }
        }
    }

    /** Osiągnięcia za wygraną/przegraną — remis i nierozstrzygnięcie nie liczą się */
    async _applyChallengeAchievements(challenge) {
        if (!this.achievementService || challenge.status !== 'finished' || !challenge.winner) return;
        const winner = challenge[challenge.winner];
        const loser = challenge[challenge.winner === 'challenger' ? 'opponent' : 'challenger'];
        await this.achievementService.trackChallengeWon(winner.guildId, winner.playerKey).catch(() => {});
        await this.achievementService.trackChallengeLost(loser.guildId, loser.playerKey).catch(() => {});
    }

    /**
     * „Pochwal się wynikami" — publikuje rezultat na kanale bota serwera klikającego.
     * Przycisk działa RAZ; stan siedzi w pliku, więc restart bota go nie resetuje.
     */
    async _handleChallengeShare(interaction, customId) {
        const rest = customId.replace('chal_share_', '');
        const sep = rest.lastIndexOf('_');
        const challengeId = rest.slice(0, sep);
        const side = rest.slice(sep + 1) === 'c' ? 'challenger' : 'opponent';

        const challenge = await this.challengeService.getById(challengeId);
        const msgs = this.msgs(challenge?.[side]?.guildId || interaction.guildId);

        if (!challenge) {
            await interaction.reply({ content: msgs.challengeErrGone, flags: ['Ephemeral'] });
            return;
        }
        if (challenge[side].userId !== interaction.user.id) {
            await interaction.reply({ content: msgs.challengeErrNotForYou, flags: ['Ephemeral'] });
            return;
        }

        const guildId = challenge[side].guildId;
        const guildName = this._challengeGuildName(interaction.client, guildId);
        const channelId = this.config.getGuildConfig(guildId)?.allowedChannelId;

        const disableButton = async (label, style = ButtonStyle.Secondary) => {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`chal_done_${challengeId}`).setEmoji('📢').setLabel(label).setStyle(style).setDisabled(true)
            );
            await interaction.message.edit({ components: [row] }).catch(() => {});
        };

        if (!channelId) {
            await interaction.reply({ content: formatMessage(msgs.challengeShareNoChannel, { guild: guildName }), flags: ['Ephemeral'] });
            return;
        }

        const marked = await this.challengeService.markShared(challengeId, side);
        if (!marked.ok) {
            await interaction.reply({ content: msgs.challengeSharedAlready, flags: ['Ephemeral'] });
            await disableButton(msgs.challengeBtnShared);
            return;
        }

        try {
            const channel = interaction.client.channels.cache.get(channelId)
                || await interaction.client.channels.fetch(channelId);
            // Embed w języku SERWERA docelowego, nie odbiorcy DM
            const guildMsgs = this.msgs(guildId);
            const bossImage = await this._challengeBossImage(challenge.boss);
            const embed = this._buildChallengeResultEmbed(challenge, guildMsgs, { thumb: bossImage.thumb, publicView: true });
            await channel.send({ embeds: [embed], files: this._challengeBossFiles(bossImage) });
            await interaction.reply({ content: formatMessage(msgs.challengeSharedOk, { guild: guildName }), flags: ['Ephemeral'] });
            await disableButton(msgs.challengeBtnShared, ButtonStyle.Secondary);
        } catch (err) {
            logger.warn(`⚠️ Nie udało się opublikować wyniku wyzwania ${challengeId}: ${err.message}`);
            await interaction.reply({ content: formatMessage(msgs.challengeShareFailed, { guild: guildName }), flags: ['Ephemeral'] }).catch(() => {});
        }
    }

    // ── Sweep ─────────────────────────────────────────────────────────────────

    /** Uruchamiany z index.js po starcie bota */
    startChallengeSweep(client) {
        if (!this.challengeService) return;
        this.challengeService.start(async (events) => {
            await this._handleChallengeSweep(client, events);
        });
    }

    async _handleChallengeSweep(client, { expiredInvites, unresolved, stalePending }) {
        for (const challenge of expiredInvites) {
            const msgs = this.msgs(challenge.challenger.guildId);
            await this._dmUser(client, challenge.challenger.userId, {
                content: formatMessage(msgs.challengeDmInviteExpiredNotice, {
                    opponent: this.challengeService.participantName(challenge.opponent, msgs),
                    boss: challenge.boss,
                }),
            });
            await this._disableChallengeInvite(client, challenge);
        }

        for (const challenge of unresolved) {
            const bossImage = await this._challengeBossImage(challenge.boss);
            for (const side of ['challenger', 'opponent']) {
                const participant = challenge[side];
                if (participant.profileDeleted) continue;
                const msgs = this.msgs(participant.guildId);
                const other = challenge[side === 'challenger' ? 'opponent' : 'challenger'];
                const embed = this._buildChallengeResultEmbed(challenge, msgs, { thumb: bossImage.thumb })
                    .setTitle(msgs.challengeDmUnresolvedTitle)
                    .setColor(0x95A5A6);
                embed.setDescription([
                    formatMessage(msgs.challengeDmUnresolvedDesc, {
                        opponent: this.challengeService.participantName(other, msgs),
                        boss: challenge.boss,
                    }),
                ].join('\n'));
                await this._dmUser(client, participant.userId, {
                    embeds: [embed],
                    files: this._challengeBossFiles(bossImage),
                });
            }
        }

        for (const pending of stalePending) {
            const msgs = this.msgs(pending.guildId);
            const embed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle(msgs.challengeDmDroppedTitle)
                .setDescription(formatMessage(msgs.challengeDmDroppedStale, { score: pending.score }))
                .setTimestamp();
            await this._dmUser(client, pending.userId, { embeds: [embed] });
        }
    }

    /** Wygasza przyciski pod DM z zaproszeniem */
    async _disableChallengeInvite(client, challenge, labelKey = 'challengeBtnExpired') {
        if (!challenge.invite?.channelId || !challenge.invite?.messageId) return;
        try {
            const msgs = this.msgs(challenge.opponent.guildId);
            const channel = await client.channels.fetch(challenge.invite.channelId);
            const message = await channel.messages.fetch(challenge.invite.messageId);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`chal_done_${challenge.id}`)
                    .setEmoji('⏳')
                    .setLabel(msgs[labelKey] || msgs.challengeBtnExpired)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            await message.edit({ components: [row] });
        } catch { /* DM mógł zostać skasowany */ }
    }

    // ── Spójność z profilami ──────────────────────────────────────────────────

    /**
     * Gracz skasował profil: wyzwania w toku są anulowane (z powiadomieniem przeciwnika),
     * a rozstrzygnięte zostają — w historii uczestnik pokazuje się jako „Profil usunięty".
     */
    async _cancelChallengesForProfile(client, playerKey) {
        if (!this.challengeService) return;
        try {
            const { cancelled } = await this.challengeService.onProfilePurged(playerKey);
            for (const challenge of cancelled) {
                const otherSide = challenge.cancelledSide === 'challenger' ? 'opponent' : 'challenger';
                const other = challenge[otherSide];
                if (other.profileDeleted) continue;
                const msgs = this.msgs(other.guildId);
                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle(msgs.challengeDmCancelledTitle)
                    .setDescription(formatMessage(msgs.challengeDmCancelledDesc, {
                        opponent: msgs.challengeDeletedProfile,
                        boss: challenge.boss,
                    }))
                    .setTimestamp();
                await this._dmUser(client, other.userId, { embeds: [embed] });
                await this._disableChallengeInvite(client, challenge);
            }
        } catch (err) {
            logger.warn(`⚠️ Błąd anulowania wyzwań usuniętego profilu ${playerKey}: ${err.message}`);
        }
    }

    // ── Widok w /profile ──────────────────────────────────────────────────────

    /**
     * Zakładka `⚔️ Wyzwania` — bilans, wyzwania w toku (tylko własny profil) i historia.
     * @returns {Promise<{ embed: EmbedBuilder, maxPage: number }>}
     */
    async _buildChallengeProfileEmbed(playerKey, displayName, msgs, page = 0, isOwnProfile = false) {
        const PER_PAGE = 8;
        const cs = this.challengeService;
        const all = await cs.getForPlayer(playerKey);
        const stats = cs.summarize(all, playerKey);
        const pendingScores = isOwnProfile ? await cs.getPendingScoresForPlayer(playerKey) : [];

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(formatMessage(msgs.challengeProfileTitle, { name: displayName }))
            .setDescription(formatMessage(msgs.challengeProfileSummary, stats));

        const active = all.filter(c => c.status === 'active');
        if (isOwnProfile && active.length > 0) {
            const lines = active.map(c => {
                const side = cs.sideOf(c, playerKey);
                const other = c[cs.otherSide(side)];
                const mine = c[side].scores.length;
                const theirs = other.scores.length;
                return `⚔️ **${cs.participantName(other, msgs)}** — \`${c.boss}\`\n`
                    + `└ ${mine}/${cs.scoresPerSide} : ${theirs}/${cs.scoresPerSide} · ${this._discordTs(c.expiresAt, 'R')}`;
            });
            // Wynik oczekujący na zatwierdzenie nazwy bossa nie jest jeszcze przypisany
            // do konkretnego wyzwania, więc idzie jedną notką pod listą — nie przy wierszach
            if (pendingScores.length > 0) {
                lines.push(formatMessage(msgs.challengeProfilePendingSuffix, { count: pendingScores.length }).trim());
            }
            embed.addFields({ name: msgs.challengeProfileActive, value: lines.join('\n').slice(0, 1024), inline: false });
        }

        const history = all.filter(c => ['finished', 'unresolved', 'cancelled'].includes(c.status));
        const maxPage = Math.max(1, Math.ceil(history.length / PER_PAGE));
        const safePage = Math.min(Math.max(0, page), maxPage - 1);

        if (history.length === 0) {
            embed.addFields({ name: msgs.challengeProfileHistory, value: msgs.challengeProfileEmpty, inline: false });
        } else {
            const lines = history.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE).map(c => {
                const side = cs.sideOf(c, playerKey);
                const other = c[cs.otherSide(side)];
                const mySum = this.rankingService.formatScore(c[side].sum);
                const theirSum = this.rankingService.formatScore(other.sum);
                return `${cs.statusLabel(c, playerKey, msgs)} · **${cs.participantName(other, msgs)}** — \`${c.boss}\`\n`
                    + `└ ${mySum} : ${theirSum} · ${this._discordTs(c.finishedAt, 'd')}`;
            });
            embed.addFields({ name: msgs.challengeProfileHistory, value: lines.join('\n').slice(0, 1024), inline: false });
            if (maxPage > 1) embed.setFooter({ text: `${safePage + 1}/${maxPage}` });
        }

        return { embed, maxPage };
    }

    // ─── BOSS ALIAS — panel konfiguracji bossów ───────────────────────────────

    /** Zwraca angielskie nazwy bossów z pliku boss_aliases.json, posortowane alfabetycznie */
    _getAllEnglishBossNames() {
        return (this.bossAliasService?.getExtraEnglishNames() || []).slice().sort();
    }

    /** Buduje embed + komponenty panelu "Konfiguracja bossów" */
    _buildBossConfigPanel(interaction) {
        const t = this._panelT(interaction.guildId);
        const aliases = this.bossAliasService?.getAllAliases() || {};
        const allNames = this._getAllEnglishBossNames();
        const hasNames = allNames.length > 0;
        const hasAliases = !!(this.bossAliasService?.getFlatAliases().length);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(t('👾 Konfiguracja Bossów', '👾 Boss Configuration'))
            .setDescription(
                t(
                    'Aliasy w innych językach są automatycznie normalizowane do angielskiej nazwy przy analizie OCR.\nNazwa angielska jest kluczem — jeden boss = jeden rekord w osiągnięciach.',
                    'Aliases in other languages are automatically normalized to the English name during OCR analysis.\nThe English name is the key — one boss = one achievement record.'
                )
            );

        if (!hasNames) {
            embed.addFields({ name: t('Brak bossów', 'No bosses'), value: t('Dodaj pierwszego bossa przyciskiem ➕', 'Add the first boss using the ➕ button'), inline: false });
        } else {
            // Jedno pole per boss (max 24 pola embedu)
            const maxFields = 24;
            const shown = allNames.slice(0, maxFields);
            for (const bossName of shown) {
                const langMap = aliases[bossName] || {};
                const lines = [];
                for (const [lang, aliasArr] of Object.entries(langMap)) {
                    if (aliasArr.length > 0)
                        lines.push(`**${lang}:** ${aliasArr.join(', ')}`);
                }
                embed.addFields({
                    name: bossName,
                    value: lines.length > 0 ? lines.join('\n') : t('*(brak aliasów)*', '*(no aliases)*'),
                    inline: false,
                });
            }
            if (allNames.length > maxFields) {
                embed.setFooter({ text: t(`Pokazano ${maxFields} z ${allNames.length} bossów.`, `Showing ${maxFields} of ${allNames.length} bosses.`) });
            }
        }

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_cfg_add_name').setEmoji('➕').setLabel(t('Dodaj bossa', 'Add Boss')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('boss_cfg_rm_entry').setEmoji('🗑️').setLabel(t('Usuń bossa', 'Remove Boss')).setStyle(ButtonStyle.Danger).setDisabled(!hasNames),
            new ButtonBuilder().setCustomId('boss_cfg_edit_entry').setEmoji('✏️').setLabel(t('Edytuj bossa', 'Rename Boss')).setStyle(ButtonStyle.Primary).setDisabled(!hasNames),
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_cfg_add_alias_start').setEmoji('➕').setLabel(t('Dodaj alias', 'Add Alias')).setStyle(ButtonStyle.Success).setDisabled(!hasNames),
            new ButtonBuilder().setCustomId('boss_cfg_rm_start').setEmoji('🗑️').setLabel(t('Usuń alias', 'Remove Alias')).setStyle(ButtonStyle.Danger).setDisabled(!hasAliases),
            new ButtonBuilder().setCustomId('boss_cfg_edit_alias').setEmoji('✏️').setLabel(t('Edytuj alias', 'Rename Alias')).setStyle(ButtonStyle.Primary).setDisabled(!hasAliases),
        );
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_cfg_set_img').setEmoji('🖼️').setLabel(t('Przypisz zdjęcie', 'Set Image')).setStyle(ButtonStyle.Secondary).setDisabled(!hasNames),
            new ButtonBuilder().setCustomId('panel_back').setEmoji('◀️').setLabel(t('Wróć do panelu', 'Back to Panel')).setStyle(ButtonStyle.Secondary),
        );

        return { embed, components: [row1, row2, row3] };
    }

    async _handlePanelBossConfig(interaction) {
        if (!this.bossAliasService) {
            await interaction.reply({ content: '⚠️ BossAliasService niedostępny.', flags: ['Ephemeral'] });
            return;
        }
        const { embed, components } = this._buildBossConfigPanel(interaction);
        await interaction.update({ embeds: [embed], components });
    }

    /** Otwiera modal do wpisania nowej angielskiej nazwy bossa */
    async _handleBossCfgAddName(interaction) {
        const t = this._panelT(interaction.guildId);
        const modal = new ModalBuilder()
            .setCustomId('boss_cfg_add_name_modal')
            .setTitle(t('Nowa angielska nazwa bossa', 'New English Boss Name'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('boss_en_name')
                .setLabel(t('Angielska nazwa (np. Shadow Beast)', 'English name (e.g. Shadow Beast)'))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(80)
        ));
        await interaction.showModal(modal);
    }

    /** Przetwarza modal dodania angielskiej nazwy bossa */
    async _handleBossCfgAddNameModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const rawName = interaction.fields.getTextInputValue('boss_en_name').trim();
        if (!rawName) {
            await interaction.reply({ content: t('❌ Nazwa nie może być pusta.', '❌ Name cannot be empty.'), flags: ['Ephemeral'] });
            return;
        }
        await this.bossAliasService.addEnglishName(rawName);
        await interaction.deferUpdate();
        const { embed, components } = this._buildBossConfigPanel(interaction);
        await interaction.editReply({ embeds: [embed], components });
    }

    /** Wyświetla select: który boss angielski ma dostać alias */
    async _handleBossCfgAddAliasStart(interaction) {
        const t = this._panelT(interaction.guildId);
        const allNames = this._getAllEnglishBossNames();
        if (!allNames.length) {
            await interaction.reply({ content: t('❌ Brak bossów do wyboru.', '❌ No bosses available.'), flags: ['Ephemeral'] });
            return;
        }
        const options = allNames.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_add_alias_sel')
            .setPlaceholder(t('Wybierz bossa...', 'Select boss...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🔤 Dodaj alias — wybierz bossa', '🔤 Add Alias — Select Boss'))
                .setDescription(t('Do którego bossa chcesz dodać nazwę w innym języku?', 'Which boss do you want to add a name in another language for?'))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu bossa — otwiera modal z polem aliasu */
    async _handleBossCfgAddAliasSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const selectedBoss = interaction.values[0];
        this._bossCfgSessions.set(interaction.user.id, { pendingBoss: selectedBoss });
        const modal = new ModalBuilder()
            .setCustomId('boss_cfg_add_alias_modal')
            .setTitle(t('Dodaj alias', 'Add Alias'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('alias_name')
                .setLabel(t(`Alias dla: ${selectedBoss.substring(0, 30)}`, `Alias for: ${selectedBoss.substring(0, 30)}`))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(80)
        ));
        await interaction.showModal(modal);
    }

    /** Po modalu z aliasem — wyświetla select języka */
    async _handleBossCfgAddAliasModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss) {
            await interaction.reply({ content: t('❌ Sesja wygasła. Spróbuj ponownie.', '❌ Session expired. Please try again.'), flags: ['Ephemeral'] });
            return;
        }
        const aliasName = interaction.fields.getTextInputValue('alias_name').trim();
        session.pendingAlias = aliasName;
        const langs = this.bossAliasService.getSupportedLanguages();
        const options = langs.map(l =>
            new StringSelectMenuOptionBuilder().setValue(l.code).setLabel(l.label.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_add_lang_sel')
            .setPlaceholder(t('Wybierz język...', 'Select language...'))
            .addOptions(options);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🌐 Wybierz język aliasu', '🌐 Select Alias Language'))
                .setDescription(t(
                    `Boss: **${session.pendingBoss}**\nAlias: **${aliasName}**\n\nJaki to język?`,
                    `Boss: **${session.pendingBoss}**\nAlias: **${aliasName}**\n\nWhat language is this?`
                ))],
            components: [new ActionRowBuilder().addComponents(select)],
            flags: ['Ephemeral'],
        });
    }

    /** Po wybraniu języka — zapisuje alias i odświeża panel */
    async _handleBossCfgAddLangSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss || !session?.pendingAlias) {
            await interaction.update({ content: t('❌ Sesja wygasła.', '❌ Session expired.'), embeds: [], components: [] });
            return;
        }
        const lang = interaction.values[0];
        const addResult = await this.bossAliasService.addAlias(session.pendingBoss, session.pendingAlias, lang);
        const backRow = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('👾').setLabel(t('Powrót do konfiguracji bossów', 'Back to Boss Config')).setStyle(ButtonStyle.Primary),
        )];
        if (!addResult.added) {
            const { englishName: conflictBoss, language: conflictLang } = addResult.conflict;
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xED4245)
                    .setTitle(t('❌ Alias już istnieje', '❌ Alias Already Exists'))
                    .setDescription(t(
                        `Alias **${session.pendingAlias}** jest już przypisany do **${conflictBoss}** (${conflictLang}).`,
                        `Alias **${session.pendingAlias}** is already assigned to **${conflictBoss}** (${conflictLang}).`
                    ))],
                components: backRow,
            });
            return;
        }
        this._bossCfgSessions.delete(interaction.user.id);
        // Migracja boss_records: przenieś rekordy pod surową nazwą aliasu na nazwę angielską
        if (this.bossRecordService) {
            const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const rawAlias = session.pendingAlias;
            const engName = session.pendingBoss;
            this.bossRecordService.migrateBossName(rawAlias, engName, allGuildIds)
                .then(count => { if (count > 0) logger.info(`Migracja boss_records: "${rawAlias}" → "${engName}" (${count} graczy)`); })
                .catch(e => logger.error(`Błąd migracji boss_records: ${e.message}`));
        }

        // ⚔️ Wyzwania — ten sam efekt co przy mapowaniu z alertu o nieznanym bossie
        this._resolveChallengePendingBoss(interaction.client, session.pendingAlias, session.pendingBoss)
            .catch(e => logger.warn(`⚠️ Błąd doliczania wyników wyzwań: ${e.message}`));
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x57F287)
                .setTitle(t('✅ Alias dodany', '✅ Alias Added'))
                .setDescription(t(
                    `**${session.pendingAlias}** (${lang}) → **${session.pendingBoss}**`,
                    `**${session.pendingAlias}** (${lang}) → **${session.pendingBoss}**`
                ))],
            components: backRow,
        });
    }

    /** Wyświetla select bossów z aliasami (do usunięcia) */
    async _handleBossCfgRmStart(interaction) {
        const t = this._panelT(interaction.guildId);
        const aliases = this.bossAliasService?.getAllAliases() || {};
        const bossesWithAliases = Object.keys(aliases).filter(b => this.bossAliasService.hasAliases(b));
        if (!bossesWithAliases.length) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFEE75C)
                    .setTitle(t('⚠️ Brak aliasów', '⚠️ No Aliases'))
                    .setDescription(t('Nie ma żadnych aliasów do usunięcia.', 'There are no aliases to remove.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }
        const options = bossesWithAliases.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_rm_boss_sel')
            .setPlaceholder(t('Wybierz bossa...', 'Select boss...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xED4245)
                .setTitle(t('🗑️ Usuń alias — wybierz bossa', '🗑️ Remove Alias — Select Boss'))
                .setDescription(t('Którego bossa chcesz edytować?', 'Which boss do you want to edit?'))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu bossa — wyświetla listę aliasów tego bossa */
    async _handleBossCfgRmBossSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const selectedBoss = interaction.values[0];
        const aliases = this.bossAliasService.getAllAliases()[selectedBoss] || {};
        const flat = [];
        for (const [lang, arr] of Object.entries(aliases)) {
            for (const alias of arr) flat.push({ lang, alias });
        }
        if (!flat.length) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(t('⚠️ Brak aliasów', '⚠️ No Aliases')).setDescription(t('Ten boss nie ma aliasów.', 'This boss has no aliases.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }
        this._bossCfgSessions.set(interaction.user.id, { pendingBoss: selectedBoss });
        const options = flat.slice(0, 25).map(({ lang, alias }) =>
            new StringSelectMenuOptionBuilder()
                .setValue(`${lang}::${alias}`)
                .setLabel(`[${lang}] ${alias}`.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_rm_alias_sel')
            .setPlaceholder(t('Wybierz alias do usunięcia...', 'Select alias to remove...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xED4245)
                .setTitle(t('🗑️ Usuń alias', '🗑️ Remove Alias'))
                .setDescription(t(`Boss: **${selectedBoss}**\nWybierz alias do usunięcia:`, `Boss: **${selectedBoss}**\nSelect alias to remove:`))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu aliasu do usunięcia — usuwa i odświeża panel */
    async _handleBossCfgRmAliasSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss) {
            await interaction.update({ content: t('❌ Sesja wygasła.', '❌ Session expired.'), embeds: [], components: [] });
            return;
        }
        const [lang, ...aliasParts] = interaction.values[0].split('::');
        const alias = aliasParts.join('::');
        await this.bossAliasService.removeAlias(session.pendingBoss, lang, alias);
        this._bossCfgSessions.delete(interaction.user.id);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x57F287)
                .setTitle(t('✅ Alias usunięty', '✅ Alias Removed'))
                .setDescription(t(
                    `Usunięto alias **${alias}** (${lang}) dla bossa **${session.pendingBoss}**.`,
                    `Removed alias **${alias}** (${lang}) for boss **${session.pendingBoss}**.`
                ))],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('👾').setLabel(t('Powrót do konfiguracji bossów', 'Back to Boss Config')).setStyle(ButtonStyle.Primary),
            )],
        });
    }

    /** Wyświetla select menu do wyboru bossa do usunięcia */
    async _handleBossCfgRmEntry(interaction) {
        const t = this._panelT(interaction.guildId);
        const allNames = this._getAllEnglishBossNames();
        if (!allNames.length) {
            await interaction.reply({ content: t('❌ Brak bossów do usunięcia.', '❌ No bosses to remove.'), flags: ['Ephemeral'] });
            return;
        }
        const options = allNames.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_rm_entry_sel')
            .setPlaceholder(t('Wybierz bossa do usunięcia...', 'Select boss to remove...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0xED4245)
                .setTitle(t('❌ Usuń bossa', '❌ Remove Boss'))
                .setDescription(t('Wybierz bossa do usunięcia. Zostaną usunięte WSZYSTKIE jego aliasy.', 'Select a boss to remove. ALL its aliases will be deleted.'))],
            components: [
                new ActionRowBuilder().addComponents(select),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                ),
            ],
        });
    }

    /** Po wybraniu bossa do usunięcia — usuwa i odświeża panel */
    async _handleBossCfgRmEntrySel(interaction) {
        const t = this._panelT(interaction.guildId);
        const bossName = interaction.values[0];
        await this.bossAliasService.removeEnglishName(bossName);
        const { embed, components } = this._buildBossConfigPanel(interaction);
        const confirmEmbed = new EmbedBuilder().setColor(0x57F287)
            .setTitle(t('✅ Boss usunięty', '✅ Boss Removed'))
            .setDescription(t(`Usunięto bossa **${bossName}** wraz ze wszystkimi aliasami.`, `Removed boss **${bossName}** with all its aliases.`));
        await interaction.update({ embeds: [confirmEmbed, embed], components });
    }

    /** Wyświetla select menu do wyboru bossa do edycji (zmiany nazwy) */
    async _handleBossCfgEditEntry(interaction) {
        const t = this._panelT(interaction.guildId);
        const allNames = this._getAllEnglishBossNames();
        if (!allNames.length) {
            await interaction.reply({ content: t('❌ Brak bossów do edycji.', '❌ No bosses to edit.'), flags: ['Ephemeral'] });
            return;
        }
        const options = allNames.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_edit_entry_sel')
            .setPlaceholder(t('Wybierz bossa do edycji...', 'Select boss to rename...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('✏️ Edytuj nazwę bossa', '✏️ Rename Boss'))
                .setDescription(t('Wybierz bossa, którego nazwę chcesz zmienić.', 'Select a boss you want to rename.'))],
            components: [
                new ActionRowBuilder().addComponents(select),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                ),
            ],
        });
    }

    /** Po wyborze bossa do edycji — otwiera modal z aktualną nazwą */
    async _handleBossCfgEditEntrySel(interaction) {
        const t = this._panelT(interaction.guildId);
        const oldName = interaction.values[0];
        this._bossCfgSessions.set(interaction.user.id, { pendingBoss: oldName });
        const modal = new ModalBuilder()
            .setCustomId('boss_cfg_edit_entry_modal')
            .setTitle(t('Zmień nazwę bossa', 'Rename Boss'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('boss_new_name')
                .setLabel(t('Nowa nazwa angielska', 'New English Name'))
                .setStyle(TextInputStyle.Short)
                .setValue(oldName)
                .setMinLength(1)
                .setMaxLength(100)
                .setRequired(true)
        ));
        await interaction.showModal(modal);
    }

    /** Po modalu zmiany nazwy — zapisuje nową nazwę i odświeża panel */
    async _handleBossCfgEditEntryModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss) {
            await interaction.reply({ content: t('❌ Sesja wygasła.', '❌ Session expired.'), flags: ['Ephemeral'] });
            return;
        }
        const oldName = session.pendingBoss;
        const newName = interaction.fields.getTextInputValue('boss_new_name').trim();
        this._bossCfgSessions.delete(interaction.user.id);
        if (!newName) {
            await interaction.reply({ content: t('❌ Nazwa nie może być pusta.', '❌ Name cannot be empty.'), flags: ['Ephemeral'] });
            return;
        }
        if (newName === oldName) {
            await interaction.deferUpdate();
            const { embed, components } = this._buildBossConfigPanel(interaction);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }
        await this.bossAliasService.renameEnglishName(oldName, newName);
        await interaction.deferUpdate();
        const { embed, components } = this._buildBossConfigPanel(interaction);
        const confirmEmbed = new EmbedBuilder().setColor(0x57F287)
            .setTitle(t('✅ Nazwa zmieniona', '✅ Boss Renamed'))
            .setDescription(t(`Zmieniono: **${oldName}** → **${newName}**`, `Renamed: **${oldName}** → **${newName}**`));
        await interaction.editReply({ embeds: [confirmEmbed, embed], components });
    }

    // ─── BOSS ALIAS — edytuj alias ────────────────────────────────────────────

    /** Pokazuje select menu bossów z aliasami do edycji */
    async _handleBossCfgEditAlias(interaction) {
        const t = this._panelT(interaction.guildId);
        const aliases = this.bossAliasService?.getAllAliases() || {};
        const bossesWithAliases = Object.keys(aliases).filter(b => this.bossAliasService.hasAliases(b));
        if (!bossesWithAliases.length) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFEE75C)
                    .setTitle(t('⚠️ Brak aliasów', '⚠️ No Aliases'))
                    .setDescription(t('Nie ma żadnych aliasów do edycji.', 'There are no aliases to edit.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }
        const options = bossesWithAliases.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_edit_alias_boss_sel')
            .setPlaceholder(t('Wybierz bossa...', 'Select boss...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('✏️ Edytuj alias — wybierz bossa', '✏️ Edit Alias — Select Boss'))
                .setDescription(t('Wybierz bossa, którego alias chcesz zmienić.', 'Select the boss whose alias you want to edit.'))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu bossa — wyświetla listę aliasów tego bossa do edycji */
    async _handleBossCfgEditAliasBossSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const selectedBoss = interaction.values[0];
        const aliases = this.bossAliasService.getAllAliases()[selectedBoss] || {};
        const flat = [];
        for (const [lang, arr] of Object.entries(aliases)) {
            for (const alias of arr) flat.push({ lang, alias });
        }
        if (!flat.length) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(t('⚠️ Brak aliasów', '⚠️ No Aliases')).setDescription(t('Ten boss nie ma aliasów.', 'This boss has no aliases.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }
        this._bossCfgSessions.set(interaction.user.id, { pendingBoss: selectedBoss });
        const options = flat.slice(0, 25).map(({ lang, alias }) =>
            new StringSelectMenuOptionBuilder()
                .setValue(`${lang}::${alias}`)
                .setLabel(`[${lang}] ${alias}`.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_edit_alias_sel')
            .setPlaceholder(t('Wybierz alias do edycji...', 'Select alias to edit...'))
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('✏️ Edytuj alias', '✏️ Edit Alias'))
                .setDescription(t(`Boss: **${selectedBoss}**\nWybierz alias do edycji:`, `Boss: **${selectedBoss}**\nSelect alias to edit:`))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu aliasu — otwiera modal z aktualną wartością */
    async _handleBossCfgEditAliasSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss) {
            await interaction.reply({ content: t('❌ Sesja wygasła.', '❌ Session expired.'), flags: ['Ephemeral'] });
            return;
        }
        const [lang, ...aliasParts] = interaction.values[0].split('::');
        const oldAlias = aliasParts.join('::');
        this._bossCfgSessions.set(interaction.user.id, { ...session, pendingLang: lang, pendingAlias: oldAlias });
        const modal = new ModalBuilder()
            .setCustomId('boss_cfg_edit_alias_modal')
            .setTitle(t('Zmień alias', 'Edit Alias'));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('alias_new_name')
                .setLabel(t('Nowa nazwa aliasu', 'New Alias Name'))
                .setStyle(TextInputStyle.Short)
                .setValue(oldAlias)
                .setMinLength(1)
                .setMaxLength(100)
                .setRequired(true)
        ));
        await interaction.showModal(modal);
    }

    /** Po modalu edycji aliasu — zapisuje nową nazwę i odświeża panel */
    async _handleBossCfgEditAliasModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const session = this._bossCfgSessions.get(interaction.user.id);
        if (!session?.pendingBoss || !session?.pendingAlias || !session?.pendingLang) {
            await interaction.reply({ content: t('❌ Sesja wygasła.', '❌ Session expired.'), flags: ['Ephemeral'] });
            return;
        }
        const { pendingBoss, pendingLang, pendingAlias } = session;
        const newAlias = interaction.fields.getTextInputValue('alias_new_name').trim();
        this._bossCfgSessions.delete(interaction.user.id);
        if (!newAlias) {
            await interaction.reply({ content: t('❌ Alias nie może być pusty.', '❌ Alias cannot be empty.'), flags: ['Ephemeral'] });
            return;
        }
        if (newAlias === pendingAlias) {
            await interaction.deferUpdate();
            const { embed, components } = this._buildBossConfigPanel(interaction);
            await interaction.editReply({ embeds: [embed], components });
            return;
        }
        await this.bossAliasService.renameAlias(pendingBoss, pendingLang, pendingAlias, newAlias);
        await interaction.deferUpdate();
        const { embed, components } = this._buildBossConfigPanel(interaction);
        const confirmEmbed = new EmbedBuilder().setColor(0x57F287)
            .setTitle(t('✅ Alias zmieniony', '✅ Alias Renamed'))
            .setDescription(t(
                `Boss **${pendingBoss}** [${pendingLang}]: **${pendingAlias}** → **${newAlias}**`,
                `Boss **${pendingBoss}** [${pendingLang}]: **${pendingAlias}** → **${newAlias}**`
            ));
        await interaction.editReply({ embeds: [confirmEmbed, embed], components });
    }

    // ─── BOSS ALIAS — nieznana nazwa bossa → embed + flow mapowania ──────────

    /**
     * Wysyła czerwony embed na kanał logów gdy OCR wykryje nieznaną nazwę bossa.
     * Zawiera przycisk "Dopasuj do nazwy angielskiej" z unikalnym sessionKey.
     */
    async _sendUnknownBossEmbed(client, guildId, { rawBoss, userName, userId, userAvatarUrl, imagePath, imageExt, commandName, guild }) {
        const channelId = this.config.serverLogChannelId;
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const guildConfig = this.config.getGuildConfig(guildId);
        const guildName = guild?.name || guildConfig?.guildName || guildId;
        const guildIcon = guild?.iconURL({ dynamic: true, size: 64 }) || guildConfig?.icon || undefined;

        // Unikalny klucz sesji (zakodowany w customId przycisku)
        const sessionKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('⚠️ Wykryto nieznaną nazwę bossa')
            .setAuthor({ name: guildName, iconURL: guildIcon })
            .setTimestamp();
        if (userAvatarUrl) embed.setThumbnail(userAvatarUrl);
        embed.addFields(
            { name: '👾 Nazwa bossa (OCR)', value: `\`${rawBoss}\``, inline: false },
            { name: '👤 Gracz', value: `[${userName}](https://discord.com/users/${userId})`, inline: true },
            { name: '⌨️ Komenda', value: `/${commandName}`, inline: true },
            { name: '🏠 Serwer', value: guildName, inline: true },
        );

        const safeExt = imageExt || 'png';
        const fileName = `unknown_boss_${Date.now()}.${safeExt}`;
        embed.setImage(`attachment://${fileName}`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`boss_mapm_${sessionKey}`)
                .setEmoji('🔗')
                .setLabel('Dopasuj do nazwy angielskiej')
                .setStyle(ButtonStyle.Primary)
        );

        const { AttachmentBuilder: AB } = require('discord.js');
        const file = new AB(imagePath, { name: fileName });

        const msg = await channel.send({ content: '<@398983446812295168>', embeds: [embed], files: [file], components: [row] }).catch(() => null);
        if (msg) {
            // Zapisz sesję (TTL 48h)
            this._unknownBossEmbeds.set(sessionKey, { rawBoss, guildId, userId, messageId: msg.id, channelId: msg.channelId });
            setTimeout(() => this._unknownBossEmbeds.delete(sessionKey), 48 * 60 * 60 * 1000);
            return sessionKey;
        }
        return null;
    }

    /** Obsługuje kliknięcie przycisku "Dopasuj do nazwy angielskiej" */
    async _handleBossMapButton(interaction, customId) {
        const sessionKey = customId.replace('boss_mapm_', '');
        const session = this._unknownBossEmbeds.get(sessionKey);
        let rawBoss = session?.rawBoss || '???';
        // Fallback: odczytaj nazwę bossa z embeda gdy sesja wygasła (np. po restarcie bota)
        if (!session && interaction.message?.embeds?.[0]) {
            const bossField = interaction.message.embeds[0].fields?.find(f => f.name.includes('Nazwa bossa'));
            if (bossField) rawBoss = bossField.value.replace(/`/g, '').trim() || rawBoss;
        }

        // Zapamiętaj sesję mapowania dla tego admina
        this._bossMapSessions.set(interaction.user.id, { rawBoss, sessionKey });

        const modal = new ModalBuilder()
            .setCustomId('boss_map_boss_modal')
            .setTitle('Dopasuj nazwę bossa');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('detected_boss_name')
                .setLabel('Odczytana nazwa bossa (możesz poprawić)')
                .setStyle(TextInputStyle.Short)
                .setValue(rawBoss.substring(0, 100))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(80)
        ));
        await interaction.showModal(modal);
    }

    /** Po modalu z poprawioną nazwą — wyświetla select bossa angielskiego */
    async _handleBossMapBossModal(interaction) {
        const session = this._bossMapSessions.get(interaction.user.id);
        if (!session) {
            await interaction.reply({ content: '❌ Sesja wygasła. Kliknij przycisk ponownie.', flags: ['Ephemeral'] });
            return;
        }
        const adjustedBoss = interaction.fields.getTextInputValue('detected_boss_name').trim();
        session.adjustedBoss = adjustedBoss;

        const allNames = this._getAllEnglishBossNames();
        const options = allNames.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_map_boss_sel')
            .setPlaceholder('Wybierz angielską nazwę bossa...')
            .addOptions(options);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle('🔗 Dopasuj alias do bossa')
                .setDescription(`Alias do przypisania: **\`${adjustedBoss}\`**\n\nKtóry to boss (angielska nazwa)?`)],
            components: [new ActionRowBuilder().addComponents(select)],
            flags: ['Ephemeral'],
        });
    }

    /** Po wybraniu angielskiego bossa — wyświetla select języka */
    async _handleBossMapBossSel(interaction) {
        const session = this._bossMapSessions.get(interaction.user.id);
        if (!session?.adjustedBoss) {
            await interaction.update({ content: '❌ Sesja wygasła.', embeds: [], components: [] });
            return;
        }
        session.englishBoss = interaction.values[0];
        const langs = this.bossAliasService.getSupportedLanguages();
        const options = langs.map(l =>
            new StringSelectMenuOptionBuilder().setValue(l.code).setLabel(l.label.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_map_lang_sel')
            .setPlaceholder('Wybierz język aliasu...')
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle('🌐 Wybierz język aliasu')
                .setDescription(`Alias: **\`${session.adjustedBoss}\`** → Boss: **${session.englishBoss}**\n\nJaki to język?`)],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wybraniu języka — zapisuje alias i wyświetla potwierdzenie */
    async _handleBossMapLangSel(interaction) {
        const session = this._bossMapSessions.get(interaction.user.id);
        if (!session?.adjustedBoss || !session?.englishBoss) {
            await interaction.update({ content: '❌ Sesja wygasła.', embeds: [], components: [] });
            return;
        }
        const lang = interaction.values[0];
        const addResult = await this.bossAliasService.addAlias(session.englishBoss, session.adjustedBoss, lang);
        const _langEntry = this.bossAliasService.getSupportedLanguages().find(l => l.code === lang);
        const langLabel = _langEntry?.label || lang;
        const langLabelEn = _langEntry?.labelEn || _langEntry?.label || lang;
        if (!addResult.added) {
            const { englishName: conflictBoss, language: conflictLang } = addResult.conflict;
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xED4245)
                    .setTitle('❌ Alias już istnieje')
                    .setDescription(
                        `Alias **${session.adjustedBoss}** jest już przypisany do **${conflictBoss}** (${conflictLang}).`
                    )],
                components: [],
            });
            return;
        }

        // Pobierz dane sesji embeda przed usunięciem
        const adminName = interaction.member?.displayName || interaction.user.username;
        const ubSession = session.sessionKey ? this._unknownBossEmbeds.get(session.sessionKey) : null;
        const ubMsgId = ubSession?.messageId;
        const ubChanId = ubSession?.channelId;
        const ubPublicMsgId = ubSession?.publicMsgId;
        const ubPublicChanId = ubSession?.publicChannelId;

        // Wyczyszanie sesji
        this._bossMapSessions.delete(interaction.user.id);
        // Migracja boss_records: przenieś rekordy pod surową nazwą bossa na nazwę angielską
        if (this.bossRecordService) {
            const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const rawBoss = session.adjustedBoss;
            const engName = session.englishBoss;
            this.bossRecordService.migrateBossName(rawBoss, engName, allGuildIds)
                .then(count => { if (count > 0) logger.info(`Migracja boss_records: "${rawBoss}" → "${engName}" (${count} graczy)`); })
                .catch(e => logger.error(`Błąd migracji boss_records: ${e.message}`));
        }

        // ⚔️ Wyzwania — wyniki zaparkowane pod surową nazwą bossa są DOPIERO TERAZ doliczane,
        // a gracze dostają o tym informację na priv (wcześniej nie było wiadomo, jaki to boss)
        this._resolveChallengePendingBoss(interaction.client, session.adjustedBoss, session.englishBoss)
            .catch(e => logger.warn(`⚠️ Błąd doliczania wyników wyzwań: ${e.message}`));

        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x57F287)
                .setTitle('✅ Alias zapisany')
                .setDescription(
                    `Alias **\`${session.adjustedBoss}\`** (${langLabel}) przypisany do bossa **${session.englishBoss}**.\n\n` +
                    `Od teraz nazwy podobne do tego aliasu będą automatycznie normalizowane do **${session.englishBoss}** przy analizie OCR.`
                )],
            components: [],
        });

        // Usuń sesję embeda (już przetworzona)
        if (session.sessionKey) this._unknownBossEmbeds.delete(session.sessionKey);

        // Dezaktywuj przycisk w embedzie nieznanego bossa
        if (ubChanId && ubMsgId) {
            try {
                const ubChan = interaction.client.channels.cache.get(ubChanId)
                    || await interaction.client.channels.fetch(ubChanId).catch(() => null);
                if (ubChan) {
                    const ubMsg = await ubChan.messages.fetch(ubMsgId).catch(() => null);
                    if (ubMsg) {
                        const disabledMapBtn = new ButtonBuilder()
                            .setCustomId(`boss_mapm_${session.sessionKey}`)
                            .setEmoji('🔗')
                            .setLabel('Dopasuj do nazwy angielskiej')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true);
                        await ubMsg.edit({ embeds: ubMsg.embeds, components: [new ActionRowBuilder().addComponents(disabledMapBtn)] }).catch(() => null);
                    }
                }
            } catch {}
        }

        // Dodaj notkę do ogłoszenia publicznego
        if (ubPublicChanId && ubPublicMsgId) {
            try {
                const pubChan = interaction.client.channels.cache.get(ubPublicChanId)
                    || await interaction.client.channels.fetch(ubPublicChanId).catch(() => null);
                if (pubChan) {
                    const pubMsg = await pubChan.messages.fetch(ubPublicMsgId).catch(() => null);
                    if (pubMsg) {
                        const _tPub = this._panelT(ubSession?.guildId || interaction.guildId);
                        const noteText = _tPub(
                            `📋 Administrator **${adminName}** ustawił nazwę **${session.adjustedBoss}** (${langLabel}) jako alias do angielskiej nazwy bossa **${session.englishBoss}**`,
                            `📋 Administrator **${adminName}** set **${session.adjustedBoss}** (${langLabelEn}) as an alias for English boss name **${session.englishBoss}**`
                        );
                        const existingContent = pubMsg.content ? `${pubMsg.content}\n` : '';
                        await pubMsg.edit({ content: `${existingContent}${noteText}` }).catch(() => null);
                    }
                }
            } catch {}
        }
    }

    // =========================================================================
    // Boss Config — przypisywanie zdjęć do bossów
    // =========================================================================

    /** Wyświetla select menu bossów do przypisania zdjęcia */
    async _handleBossCfgSetImg(interaction) {
        const t = this._panelT(interaction.guildId);
        const msgs = this.msgs(interaction.guildId);
        const allNames = this._getAllEnglishBossNames();
        if (!allNames.length) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(0xFEE75C)
                    .setTitle(t('⚠️ Brak bossów', '⚠️ No Bosses'))
                    .setDescription(t('Dodaj najpierw bossa angielską nazwą.', 'Add a boss with an English name first.'))],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('panel_boss_cfg').setEmoji('◀️').setLabel(t('Wróć', 'Back')).setStyle(ButtonStyle.Secondary),
                )],
            });
            return;
        }
        const options = allNames.slice(0, 25).map(n =>
            new StringSelectMenuOptionBuilder().setValue(n).setLabel(n.substring(0, 100))
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId('boss_cfg_img_boss_sel')
            .setPlaceholder(msgs.bossCfgImgSelectPlaceholder || 'Wybierz bossa...')
            .addOptions(options);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(0x5865F2)
                .setTitle(t('🖼️ Przypisz zdjęcie', '🖼️ Set Boss Image'))
                .setDescription(msgs.bossCfgImgSelectBoss || t('Wybierz bossa do przypisania zdjęcia:', 'Select a boss to assign an image:'))],
            components: [new ActionRowBuilder().addComponents(select)],
        });
    }

    /** Po wyborze bossa — pokazuje modal z polem na link do zdjęcia */
    async _handleBossCfgImgBossSel(interaction) {
        const t = this._panelT(interaction.guildId);
        const msgs = this.msgs(interaction.guildId);
        const bossName = interaction.values[0];

        // Nazwa bossa idzie do sesji, nie do customId — customId ma limit 100 znaków
        this._bossCfgSessions.set(interaction.user.id, { pendingBoss: bossName });

        const modal = new ModalBuilder()
            .setCustomId('boss_cfg_img_modal')
            .setTitle((msgs.bossCfgImgModalTitle || t('Zdjęcie bossa', 'Boss Image')).substring(0, 45));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('boss_img_url')
                .setLabel((msgs.bossCfgImgModalLabel || t('Link do zdjęcia', 'Image link')).substring(0, 45))
                .setPlaceholder('https://cdn.discordapp.com/attachments/...')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(1000)
        ));
        await interaction.showModal(modal);
    }

    /** Zapis zdjęcia bossa z linku wklejonego w modalu */
    async _handleBossCfgImgModal(interaction) {
        const t = this._panelT(interaction.guildId);
        const msgs = this.msgs(interaction.guildId);

        const session = this._bossCfgSessions.get(interaction.user.id);
        const bossName = session?.pendingBoss;
        if (!bossName) {
            await interaction.reply({
                content: msgs.bossCfgImgNoSession || t('❌ Sesja wygasła. Wybierz bossa ponownie.', '❌ Session expired. Select the boss again.'),
                flags: ['Ephemeral'],
            });
            return;
        }
        this._bossCfgSessions.delete(interaction.user.id);

        await interaction.deferReply({ flags: ['Ephemeral'] });

        const rawUrl = (interaction.fields.getTextInputValue('boss_img_url') || '').trim();

        // Rozszerzenie bierzemy ze ścieżki URL — przy linku nie ma nazwy załącznika ani content-type
        const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        let ext;
        try {
            ext = path.extname(new URL(rawUrl).pathname).toLowerCase();
        } catch {
            await interaction.editReply({ content: msgs.bossCfgImgInvalidUrl || t('❌ Nieprawidłowy link.', '❌ Invalid link.') });
            return;
        }
        if (!ALLOWED_EXTS.includes(ext)) {
            await interaction.editReply({ content: msgs.bossCfgImgInvalidType || t('❌ Nieobsługiwany format.', '❌ Unsupported format.') });
            return;
        }

        // Pobierz i zapisz zdjęcie — downloadBuffer pilnuje HTTPS, hosta (Discord CDN) i limitu 25 MB
        try {
            const imgDir = path.join(__dirname, '../data/boss_images');
            await fs.mkdir(imgDir, { recursive: true });
            const safeName = bossName.replace(/[^a-zA-Z0-9_\-]/g, '_');
            const filename = `${safeName}${ext}`;
            const buffer = await downloadBuffer(rawUrl);
            await fs.writeFile(path.join(imgDir, filename), buffer);
            await this.bossAliasService.setBossImage(bossName, filename);
            const successMsg = (msgs.bossCfgImgSuccess || '✅ Zdjęcie przypisane do bossa **{bossName}**.').replace('{bossName}', bossName);
            await interaction.editReply({ content: successMsg });
            logger.info(`Zdjęcie bossa "${bossName}" zapisane jako ${filename}`);
        } catch (e) {
            logger.error(`Błąd zapisu zdjęcia bossa: ${e.message}`);
            await interaction.editReply({ content: t('❌ Błąd zapisu zdjęcia.', '❌ Failed to save image.') });
        }
    }

    // =========================================================================
    // Ranking bossów — lista bossów i per-boss ranking globalny
    // =========================================================================

    /** Wyświetla select menu z listą bossów mających rekordy */
    async _handleRankingBossList(interaction, srvGuildId = null) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        if (!this.bossRecordService) {
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
            return;
        }
        // srvGuildId = ranking bossów zawężony do jednego serwera; null = ranking globalny
        const rankGuildIds = srvGuildId
            ? [srvGuildId]
            : (this.guildConfigService?.getAllConfiguredGuildIds() || Array.from(interaction.client.guilds.cache.keys()));
        const guildName = srvGuildId
            ? (interaction.client.guilds.cache.get(srvGuildId)?.name || srvGuildId)
            : null;
        const knownNames = this.bossAliasService?.getExtraEnglishNames() || [];
        const bosses = await this.bossRecordService.getBossesWithRecords(rankGuildIds, knownNames);

        const embedColor = srvGuildId ? 0xF1C40F : 0x5865F2;
        const backBtn = srvGuildId
            ? new ButtonBuilder().setCustomId(`ranking_select_server_${srvGuildId}`).setEmoji('↩️')
                .setLabel((guildName || msgs.buttonBack || 'Powrót').substring(0, 70)).setStyle(ButtonStyle.Danger)
            : new ButtonBuilder().setCustomId('ranking_select_global').setEmoji('🌐')
                .setLabel(msgs.rankingGlobal || 'Global').setStyle(ButtonStyle.Secondary);

        if (!bosses.length) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(embedColor)
                    .setTitle(msgs.bossRankingSelectTitle || '🎯 Ranking Bossów')
                    .setDescription(msgs.bossRankingNoBosses || '📭 Brak wyników bossów do wyświetlenia.')],
                components: [new ActionRowBuilder().addComponents(backBtn)],
                files: [],
                attachments: [],
            });
            return;
        }

        const options = bosses.slice(0, 25).map(b =>
            new StringSelectMenuOptionBuilder()
                .setValue(b.bossName)
                .setLabel(b.bossName.substring(0, 100))
                .setDescription(`${b.totalPlayers} ${msgs.bossRankingPlayers || 'graczy'}`)
        );
        const select = new StringSelectMenuBuilder()
            .setCustomId(srvGuildId ? `ranking_boss_ssel_${srvGuildId}` : 'ranking_boss_sel')
            .setPlaceholder(msgs.bossRankingSelectPlaceholder || 'Wybierz bossa...')
            .addOptions(options);

        const description = srvGuildId
            ? formatMessage(msgs.bossRankingSelectDescServer || 'Wybierz bossa z listy aby zobaczyć ranking serwera **{guildName}**.', { guildName })
            : (msgs.bossRankingSelectDesc || 'Wybierz bossa z listy aby zobaczyć globalny ranking.');

        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(embedColor)
                .setTitle(msgs.bossRankingSelectTitle || '🎯 Ranking Bossów')
                .setDescription(description)],
            components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backBtn)],
            files: [],
            attachments: [],
        });
    }

    /** Wyświetla ranking dla wybranego bossa — globalny albo zawężony do jednego serwera */
    async _handleRankingBossShow(interaction, srvGuildId = null) {
        await interaction.deferUpdate();
        const msgs = this.msgs(interaction.guildId);
        if (!this.bossRecordService) {
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
            return;
        }
        const bossName = interaction.values[0];
        const guildName = srvGuildId
            ? (interaction.client.guilds.cache.get(srvGuildId)?.name || srvGuildId)
            : null;
        const allGuildIds = srvGuildId
            ? [srvGuildId]
            : (this.guildConfigService?.getAllConfiguredGuildIds() || Array.from(interaction.client.guilds.cache.keys()));
        const players = await this.bossRecordService.getGlobalBossRanking(allGuildIds, bossName);

        const perPage = this.config.ranking.playersPerPage || 10;
        const totalPages = Math.max(1, Math.ceil(players.length / perPage));
        const callerIdx = this._findCallerIndex(players, interaction.user.id);
        const userPage = callerIdx !== -1 ? Math.floor(callerIdx / perPage) : null;

        // Zdjęcie bossa
        let bossImageName = null;
        let bossImageAttachment = null;
        if (this.bossAliasService) {
            const imgPath = this.bossAliasService.getBossImagePath(bossName);
            if (imgPath) {
                try {
                    const fullPath = path.join(__dirname, '../data/boss_images', imgPath);
                    const buf = await fs.readFile(fullPath);
                    bossImageName = imgPath;
                    bossImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                } catch { /* bez zdjęcia */ }
            }
        }

        // Wykres postępu graczy dla bossów — tylko wyniki z tego bossa (i tylko z serwerów rankingu)
        let chartAttachment = null;
        try {
            const t = this._panelT(interaction.guildId);
            chartAttachment = await this._buildBossRankingChartAttachment(players, 0, allGuildIds, bossName, t);
        } catch { /* wykres opcjonalny */ }

        const embed = this.rankingService.createBossRankingEmbed(
            bossName, players, 0, perPage, msgs, bossImageName, this._mainPlayerKey(interaction.user.id), interaction.client, guildName
        );
        const buttons = this.rankingService.createBossRankingButtons(0, totalPages, userPage, false, msgs, {
            guildId: srvGuildId, guildName
        });

        const rankingData = {
            bossName,
            players,
            currentPage: 0,
            totalPages,
            userId: interaction.user.id,
            userPage,
            allGuildIds,
            srvGuildId,
            guildName,
        };
        const reply = await interaction.fetchReply();
        this._bossRankings.set(reply.id, rankingData);

        const files = [];
        const embeds = [embed];
        if (bossImageAttachment) files.push(bossImageAttachment);
        if (chartAttachment) {
            files.push(chartAttachment);
            embeds.push(new EmbedBuilder().setImage('attachment://boss_ranking_progress.png'));
        }
        await interaction.editReply({ embeds, components: buttons, files, attachments: [] });
    }

    /** Paginacja rankingu bossa — prev/next/mypos (wywoływana po deferUpdate z caller) */
    async _handleRankingBossPage(interaction, customId) {
        const msgs = this.msgs(interaction.guildId);
        const rankingData = this._bossRankings.get(interaction.message.id);
        if (!rankingData) {
            await interaction.editReply({ content: msgs.rankingError, embeds: [], components: [] });
            return;
        }

        let newPage = rankingData.currentPage;
        if (customId === 'ranking_prev') newPage = Math.max(0, rankingData.currentPage - 1);
        else if (customId === 'ranking_next') newPage = Math.min(rankingData.totalPages - 1, rankingData.currentPage + 1);
        else if (customId === 'ranking_mypos') newPage = rankingData.userPage ?? rankingData.currentPage;

        rankingData.currentPage = newPage;
        this._bossRankings.set(interaction.message.id, rankingData);

        const perPage = this.config.ranking.playersPerPage || 10;

        // Zdjęcie bossa
        let bossImageName = null;
        let bossImageAttachment = null;
        if (this.bossAliasService) {
            const imgPath = this.bossAliasService.getBossImagePath(rankingData.bossName);
            if (imgPath) {
                try {
                    const fullPath = path.join(__dirname, '../data/boss_images', imgPath);
                    const buf = await fs.readFile(fullPath);
                    bossImageName = imgPath;
                    bossImageAttachment = new AttachmentBuilder(buf, { name: imgPath });
                } catch { /* bez zdjęcia */ }
            }
        }

        // Wykres postępu graczy — tylko wyniki z tego bossa
        let chartAttachment = null;
        try {
            const allGuildIdsForChart = rankingData.allGuildIds
                || this.guildConfigService?.getAllConfiguredGuildIds()
                || Array.from(interaction.client.guilds.cache.keys());
            const t = this._panelT(interaction.guildId);
            chartAttachment = await this._buildBossRankingChartAttachment(rankingData.players, newPage, allGuildIdsForChart, rankingData.bossName, t);
        } catch { /* wykres opcjonalny */ }

        const embed = this.rankingService.createBossRankingEmbed(
            rankingData.bossName, rankingData.players, newPage, perPage, msgs, bossImageName,
            this._mainPlayerKey(interaction.user.id), interaction.client, rankingData.guildName || null
        );
        const buttons = this.rankingService.createBossRankingButtons(newPage, rankingData.totalPages, rankingData.userPage, false, msgs, {
            guildId: rankingData.srvGuildId || null, guildName: rankingData.guildName || null
        });

        const files = [];
        const embeds = [embed];
        if (bossImageAttachment) files.push(bossImageAttachment);
        if (chartAttachment) {
            files.push(chartAttachment);
            embeds.push(new EmbedBuilder().setImage('attachment://boss_ranking_progress.png'));
        }
        await interaction.editReply({ embeds, components: buttons, files, attachments: [] });
    }

} // end InteractionHandler

module.exports = InteractionHandler;
