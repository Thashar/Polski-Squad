const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

// Konfiguracja typów embedów OCR — kolor, emoji, etykieta
const OCR_EMBED_TYPES = {
    new_record:              { color: 0x57F287, emoji: '🏆', label: 'NOWY REKORD' },
    new_player:              { color: 0x57F287, emoji: '🆕', label: 'NOWY GRACZ' },
    role_error:              { color: 0xFEE75C, emoji: '⚠️', label: 'NOWY REKORD — błąd uprawnień ról' },
    role_error_new_player:   { color: 0xFEE75C, emoji: '⚠️', label: 'NOWY GRACZ — błąd uprawnień ról' },
    rejected:                { color: 0xED4245, emoji: '🚫', label: 'ANALIZA ODRZUCONA' },
    no_record:               { color: 0x5865F2, emoji: '📊', label: 'REKORD NIE POBITY' },
    test_record:             { color: 0x00B4D8, emoji: '🧪', label: 'TEST — nowy rekord' },
    test_no_record:          { color: 0x7289DA, emoji: '🧪', label: 'TEST — brak rekordu' },
    analyze_panel:           { color: 0xE67E22, emoji: '🔬', label: 'ANALIZA Z PANELU' },
    analyze_panel_role_error:{ color: 0xFEE75C, emoji: '⚠️', label: 'ANALIZA Z PANELU — błąd ról' },
    cross_server:            { color: 0x95A5A6, emoji: '🔄', label: 'DUPLIKAT CROSS-SERVER' },
};

const REJECTION_REASONS = {
    NOT_SIMILAR:           '🔍 Screen niepodobny do wzorca',
    FAKE_PHOTO:            '🎭 Podrobione zdjęcie',
    INVALID_SCREENSHOT:    '❌ Nieprawidłowy screenshot',
    NO_REQUIRED_WORDS:     '📝 Brak wymaganych słów',
    INVALID_SCORE_FORMAT:  '🔢 Nieprawidłowy format wyniku',
    BEST_EXCEEDS_TOTAL:    '📊 Best przekracza Total',
    VALIDATION_FAILED:     '❌ Walidacja nieudana',
};

class LogService {
    constructor(config, guildLogger) {
        this.config = config;
        this.logger = createBotLogger('EndersEcho');
        this.guildLogger = guildLogger;
        this._ocrLogChannelId = config.ocrLogChannelId || null;
        this._ocrQueue = [];
        this._ocrProcessing = false;
        this._client = null;
        if (this._ocrLogChannelId) {
            this.logger.info(`📋 LogService: kanał OCR logów skonfigurowany (ID: ${this._ocrLogChannelId})`);
        }
    }

    setClient(discordClient) {
        this._client = discordClient;
    }

    /**
     * Zwraca logger z kontekstem serwera (jeśli guildId podany) lub base logger.
     * @param {string|null} guildId
     */
    _gl(guildId) {
        return guildId ? this.guildLogger.forGuild(guildId) : this.logger;
    }

    /**
     * @param {string} commandName
     * @param {import('discord.js').CommandInteraction} interaction
     */
    nickLink(nick, userId) {
        return `[${nick}] [[X](https://discord.com/users/${userId})]`;
    }

    async logCommandUsage(commandName, interaction) {
        const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        this._gl(interaction.guildId).info(`${this.nickLink(nick, interaction.user.id)} Użycie komendy /${commandName}`);
    }

    /**
     * @param {string} userName
     * @param {string} score
     * @param {boolean} isNewRecord
     * @param {string|null} guildId
     */
    async logScoreUpdate(userName, score, isNewRecord, guildId = null, { adminName } = {}) {
        const status = isNewRecord ? 'NOWY REKORD' : 'Bez rekordu';
        if (adminName) {
            this._gl(guildId).info(`🔬 MANUALNA ANALIZA ADMINA 🔬 | ${adminName} → ${userName} | ${score} [${status}]`);
        } else {
            this._gl(guildId).info(`Aktualizacja wyniku: ${userName} - ${score} [${status}]`);
        }
    }

    /**
     * @param {Error} error
     * @param {string} context
     * @param {string|null} guildId
     */
    async logOCRError(error, context, guildId = null) {
        this._gl(guildId).error(`Błąd OCR w ${context}: ${error.message}`);
    }

    /**
     * @param {Error} error
     * @param {string} context
     * @param {string|null} guildId
     */
    async logRankingError(error, context, guildId = null) {
        this._gl(guildId).error(`Błąd rankingu w ${context}: ${error.message}`);
    }

    /**
     * Wysyła embed przez webhook logów EndersEcho.
     * Zwraca true jeśli webhook skonfigurowany, false gdy brak webhooka.
     * @param {Object|import('discord.js').EmbedBuilder} embed
     * @returns {boolean}
     */
    sendEmbed(embed) {
        return this.guildLogger.sendEmbed(embed);
    }

    /**
     * Wysyła dodatkowy embed OCR do webhooka — nie zastępuje istniejącego logowania tekstowego.
     * @param {string} guildId
     * @param {Object} options
     * @param {string} options.type          - klucz z OCR_EMBED_TYPES
     * @param {string} [options.userName]
     * @param {string} [options.userId]
     * @param {string} [options.score]
     * @param {string} [options.bossName]
     * @param {string} [options.previousScore]
     * @param {string} [options.commandName]
     * @param {string} [options.reason]       - kod odrzucenia np. NOT_SIMILAR
     * @param {string} [options.rejectionReason] - szczegóły AI
     * @param {string} [options.adminName]
     * @param {string} [options.roleError]    - wiadomość błędu ról
     * @param {import('discord.js').Guild|null} guildObj
     */
    sendOcrAnalysisEmbed(guildId, options = {}, guildObj = null, components = null, client = null) {
        const targetChannelId = this._ocrLogChannelId;
        if (!targetChannelId) {
            this.logger.warn(`[OCR Log] Brak ENDERSECHO_OCR_LOG_CHANNEL_ID — embed pominięty (type: ${options.type})`);
            return;
        }

        try {
            const {
                type = 'no_record',
                userName,
                userId,
                userAvatar,
                score,
                bossName,
                previousScore,
                commandName,
                reason,
                rejectionReason,
                adminName,
                roleError,
                globalPlayerCount = null,
            } = options;

            const cfg = OCR_EMBED_TYPES[type] || { color: 0x99AAB5, emoji: '•', label: type };

            const guildConfig = this.config.getGuildConfig(guildId);
            const guildTag    = guildConfig?.tag || null;
            const guildName   = guildObj?.name || guildConfig?.guildName || guildId;
            const guildIcon   = guildObj?.iconURL({ dynamic: true, size: 64 })
                             || guildConfig?.icon
                             || null;

            const embed = new EmbedBuilder()
                .setColor(cfg.color)
                .setTitle(`${cfg.emoji} ${cfg.label}`)
                .setTimestamp();

            const authorName = guildTag ? `${guildTag}  ${guildName}` : guildName;
            embed.setAuthor({ name: authorName, iconURL: guildIcon || undefined });
            const thumbnailUrl = userAvatar || guildIcon;
            if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

            if (userName) {
                const playerVal = userId
                    ? `[${userName}](https://discord.com/users/${userId})`
                    : userName;
                embed.addFields({ name: '👤 Gracz', value: playerVal, inline: true });
            }
            if (commandName) {
                embed.addFields({ name: '⌨️ Komenda', value: `/${commandName}`, inline: true });
            }
            if (adminName) {
                embed.addFields({ name: '👑 Admin', value: adminName, inline: true });
            }
            if (score) {
                const scoreVal = bossName ? `${score}  •  ${bossName}` : score;
                embed.addFields({ name: '🎯 Wynik', value: scoreVal, inline: false });
            }
            if (previousScore) {
                embed.addFields({ name: '📈 Poprzedni rekord', value: previousScore, inline: true });
            }
            if (reason) {
                const reasonText = REJECTION_REASONS[reason] || `🟠 ${reason}`;
                embed.addFields({ name: '⛔ Powód odrzucenia', value: reasonText, inline: false });
            }
            if (rejectionReason) {
                embed.addFields({ name: '🤖 Szczegóły AI', value: rejectionReason.substring(0, 1024), inline: false });
            }
            if (roleError) {
                embed.addFields({ name: '🔐 Błąd uprawnień ról', value: roleError.substring(0, 512), inline: false });
            }
            if (globalPlayerCount !== null) {
                embed.setFooter({ text: `👥 ${globalPlayerCount} unikalnych graczy globalnie` });
            }

            this._enqueueOcr(client || this._client, targetChannelId, embed, components || null);
        } catch (err) {
            this.logger.warn(`sendOcrAnalysisEmbed błąd: ${err.message}`);
        }
    }

    _enqueueOcr(activeClient, channelId, embed, components) {
        this._ocrQueue.push({ activeClient, channelId, embed, components });
        setImmediate(() => this._processOcrQueue());
    }

    async _processOcrQueue() {
        if (this._ocrProcessing || this._ocrQueue.length === 0) return;
        this._ocrProcessing = true;
        while (this._ocrQueue.length > 0) {
            const { activeClient, channelId, embed, components } = this._ocrQueue.shift();
            try {
                if (!activeClient) { this.logger.warn('[OCR Log] Brak klienta Discord — embed pominięty'); continue; }
                const ch = await activeClient.channels.fetch(channelId).catch(() => null);
                if (!ch) { this.logger.warn(`[OCR Log] Nie znaleziono kanału ${channelId}`); continue; }
                const payload = { embeds: [embed] };
                if (components) payload.components = components;
                await ch.send(payload);
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                this.logger.warn(`[OCR Log] Błąd wysyłania embeda: ${err.message}`);
            }
        }
        this._ocrProcessing = false;
    }

    /**
     * Ogólny log — bez kontekstu serwera (fallback do base loggera).
     * @param {string} type
     * @param {string} message
     * @param {import('discord.js').CommandInteraction|null} interaction
     */
    async logMessage(type, message, interaction = null) {
        const guildId = interaction?.guildId || null;
        const prefix = interaction ? `[${interaction.user.tag}] ` : '';
        const fullMessage = `${prefix}${message}`;
        const log = this._gl(guildId);
        switch (type) {
            case 'error':   log.error(fullMessage);   break;
            case 'warn':    log.warn(fullMessage);    break;
            case 'success': log.success(fullMessage); break;
            default:        log.info(fullMessage);    break;
        }
    }
}

module.exports = LogService;
