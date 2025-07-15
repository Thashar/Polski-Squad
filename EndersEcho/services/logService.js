const { createBotLogger } = require('../../utils/consoleLogger');

class LogService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('EndersEcho');
    }

    /**
     * Loguje wiadomość do konsoli
     * @param {string} type - Typ wiadomości (info, warn, error, success)
     * @param {string} message - Treść wiadomości
     * @param {Object} interaction - Opcjonalna interakcja Discord
     */
    async logMessage(type, message, interaction = null) {
        const prefix = interaction ? `[${interaction.user.tag}] ` : '';
        const fullMessage = `${prefix}${message}`;
        
        switch(type) {
            case 'error':
                this.logger.error(fullMessage);
                break;
            case 'warn':
                this.logger.warn(fullMessage);
                break;
            case 'success':
                this.logger.info(`✅ ${fullMessage}`);
                break;
            default:
                this.logger.info(fullMessage);
        }
    }

    /**
     * Loguje błąd OCR
     * @param {Error} error - Błąd
     * @param {string} context - Kontekst błędu
     */
    async logOCRError(error, context) {
        await this.logMessage('error', `Błąd OCR w ${context}: ${error.message}`);
    }

    /**
     * Loguje błąd rankingu
     * @param {Error} error - Błąd
     * @param {string} context - Kontekst błędu
     */
    async logRankingError(error, context) {
        await this.logMessage('error', `Błąd rankingu w ${context}: ${error.message}`);
    }

    /**
     * Loguje sukces aktualizacji wyniku
     * @param {string} userName - Nazwa użytkownika
     * @param {string} score - Wynik
     * @param {boolean} isNewRecord - Czy to nowy rekord
     */
    async logScoreUpdate(userName, score, isNewRecord) {
        const status = isNewRecord ? 'NOWY REKORD' : 'Bez rekordu';
        await this.logMessage('info', `Aktualizacja wyniku: ${userName} - ${score} [${status}]`);
    }

    /**
     * Loguje użycie komendy
     * @param {string} commandName - Nazwa komendy
     * @param {Object} interaction - Interakcja Discord
     */
    async logCommandUsage(commandName, interaction) {
        await this.logMessage('info', `Użycie komendy /${commandName}`, interaction);
    }
}

module.exports = LogService;