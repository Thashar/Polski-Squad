const { formatMessage } = require('../utils/helpers');

class MessageService {
    constructor(config, lotteryService = null) {
        this.config = config;
        this.lotteryService = lotteryService;
    }

    /**
     * Formatuje wiadomość z wynikiem analizy
     * @param {Object} result - Wynik analizy
     * @param {Object|null} roleResult - Wynik przyznawania roli
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {string} - Sformatowana wiadomość
     */
    formatResultMessage(result, roleResult = null, channelConfig = null) {
        if (!result.found) {
            let message = this.config.messages.nickNotFound;
            if (channelConfig && channelConfig.requireSecondOccurrence) {
                message += this.config.messages.nickRequiredTwice;
            }
            return message;
        }

        if (result.score === null) {
            if (result.error && result.error.includes('liniach tekstu')) {
                return formatMessage(this.config.messages.nickInFirstLines, { 
                    skipLines: channelConfig.skipLines 
                });
            }
            return this.config.messages.nickFoundButNoScore;
        }

        if (!result.isValid) {
            return formatMessage(this.config.messages.scoreInsufficient, {
                score: result.score,
                minimum: channelConfig.minimumScore
            });
        }

        // Wynik pozytywny
        let baseMessage = '';
        if (roleResult && !roleResult.alreadyHad) {
            baseMessage = formatMessage(this.config.messages.analysisSuccess, {
                score: result.score,
                role: roleResult.role.name
            });

            // Sprawdzenie czy przyznana rola to "Daily"
            if (roleResult.role.name === 'Daily') {
                // Usunięto informacje o aktywnych loteriach
                baseMessage += formatMessage(this.config.messages.dailyLottery, { lotteryInfo: '' });
            }
        } else {
            baseMessage = formatMessage(this.config.messages.analysisAlreadyHasRole, {
                score: result.score
            });

            // Sprawdzenie czy to kanał Daily
            if (channelConfig && channelConfig.name === 'Daily') {
                // Usunięto informacje o aktywnych loteriach
                baseMessage += formatMessage(this.config.messages.dailyLottery, { lotteryInfo: '' });
            }
        }

        // Dodaj informację o sposobie dopasowania nicku
        if (result.matchType === 'similarity' || result.matchType === 'similarity_low') {
            baseMessage += this.config.messages.similarityMatch;
        }

        return baseMessage;
    }

    /**
     * Formatuje wiadomość błędu z przyznawaniem roli
     * @param {Object} result - Wynik analizy
     * @param {string} errorMessage - Komunikat błędu
     * @returns {string} - Sformatowana wiadomość
     */
    formatRoleErrorMessage(result, errorMessage) {
        return `${this.config.messages.roleError}\n🎯 **Wynik:** ${result.score} (wystarczający)\n❌ **Problem z rolą:** ${errorMessage}`;
    }

    /**
     * Formatuje wiadomość błędu analizy
     * @param {string} errorMessage - Komunikat błędu
     * @returns {string} - Sformatowana wiadomość
     */
    formatAnalysisErrorMessage(errorMessage) {
        return `${this.config.messages.analysisError}\n🔧 **Szczegóły:** ${errorMessage}`;
    }

    /**
     * Zwraca wiadomość o zablokowaniu użytkownika
     * @returns {string} - Wiadomość o blokowaniu
     */
    getBlockedUserMessage() {
        return this.config.messages.penaltyBlocked;
    }
}

module.exports = MessageService;