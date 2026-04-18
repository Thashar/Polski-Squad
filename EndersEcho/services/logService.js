const { createBotLogger } = require('../../utils/consoleLogger');

class LogService {
    constructor(config, guildLogger) {
        this.config = config;
        this.logger = createBotLogger('EndersEcho');
        this.guildLogger = guildLogger;
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
    async logCommandUsage(commandName, interaction) {
        const nick = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
        this._gl(interaction.guildId).info(`[${nick}] Użycie komendy /${commandName}`);
    }

    /**
     * @param {string} userName
     * @param {string} score
     * @param {boolean} isNewRecord
     * @param {string|null} guildId
     */
    async logScoreUpdate(userName, score, isNewRecord, guildId = null) {
        const status = isNewRecord ? 'NOWY REKORD' : 'Bez rekordu';
        this._gl(guildId).info(`Aktualizacja wyniku: ${userName} - ${score} [${status}]`);
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
