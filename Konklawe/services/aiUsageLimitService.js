const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * AI Usage Limit Service - Zarządzanie limitami używania AI
 */
class AIUsageLimitService {
    constructor(dataService) {
        this.dataService = dataService;
        this.limits = {
            passwordGenerations: 3, // Max 3 próby generowania haseł
            hintCooldown: 60 * 60 * 1000 // 1 godzina w ms
        };
    }

    /**
     * Sprawdza czy użytkownik może wygenerować hasła
     * @param {string} userId - ID użytkownika
     * @returns {Object} - {canUse: boolean, remainingAttempts: number}
     */
    canGeneratePassword(userId) {
        const usage = this.dataService.loadAIUsage();
        const userUsage = usage[userId] || this.createUserUsage();

        const remaining = this.limits.passwordGenerations - userUsage.passwordGenerations.count;

        return {
            canUse: remaining > 0,
            remainingAttempts: Math.max(0, remaining)
        };
    }

    /**
     * Zapisuje użycie generowania hasła
     * @param {string} userId - ID użytkownika
     */
    recordPasswordGeneration(userId) {
        const usage = this.dataService.loadAIUsage();

        if (!usage[userId]) {
            usage[userId] = this.createUserUsage();
        }

        usage[userId].passwordGenerations.count++;
        usage[userId].passwordGenerations.lastUsed = Date.now();

        this.dataService.saveAIUsage(usage);

        const remaining = this.limits.passwordGenerations - usage[userId].passwordGenerations.count;
        logger.info(`🤖 ${userId} użył generowania hasła (pozostało: ${remaining}/3)`);
    }

    /**
     * Resetuje licznik generowania haseł dla wszystkich użytkowników
     * Wywołane gdy hasło jest zmieniane
     */
    resetPasswordGenerations() {
        const usage = this.dataService.loadAIUsage();

        for (const userId in usage) {
            usage[userId].passwordGenerations = {
                count: 0,
                lastUsed: null
            };
        }

        this.dataService.saveAIUsage(usage);
        logger.info('🔄 Zresetowano liczniki generowania haseł dla wszystkich użytkowników');
    }

    /**
     * Sprawdza czy użytkownik może wygenerować podpowiedzi danego poziomu
     * @param {string} userId - ID użytkownika
     * @param {string} difficulty - Poziom trudności ('easy' lub 'hard')
     * @returns {Object} - {canUse: boolean, cooldownRemaining: number (ms)}
     */
    canGenerateHints(userId, difficulty) {
        const usage = this.dataService.loadAIUsage();
        const userUsage = usage[userId] || this.createUserUsage();

        const lastUsed = userUsage.hintCooldowns[difficulty];

        if (!lastUsed) {
            return { canUse: true, cooldownRemaining: 0 };
        }

        const timeSinceLastUse = Date.now() - lastUsed;
        const cooldownRemaining = Math.max(0, this.limits.hintCooldown - timeSinceLastUse);

        return {
            canUse: cooldownRemaining === 0,
            cooldownRemaining
        };
    }

    /**
     * Zapisuje użycie generowania podpowiedzi
     * @param {string} userId - ID użytkownika
     * @param {string} difficulty - Poziom trudności ('easy' lub 'hard')
     */
    recordHintGeneration(userId, difficulty) {
        const usage = this.dataService.loadAIUsage();

        if (!usage[userId]) {
            usage[userId] = this.createUserUsage();
        }

        usage[userId].hintCooldowns[difficulty] = Date.now();

        this.dataService.saveAIUsage(usage);

        logger.info(`🤖 ${userId} użył generowania podpowiedzi (${difficulty})`);
    }

    /**
     * Zwraca czyste dane użycia dla nowego użytkownika
     * @returns {Object}
     */
    createUserUsage() {
        return {
            passwordGenerations: {
                count: 0,
                lastUsed: null
            },
            hintCooldowns: {
                easy: null,
                hard: null
            }
        };
    }

    /**
     * Formatuje pozostały czas cooldownu do czytelnej formy
     * @param {number} ms - Czas w milisekundach
     * @returns {string} - Sformatowany czas (np. "45 minut", "1 godzina")
     */
    formatCooldown(ms) {
        const minutes = Math.ceil(ms / (60 * 1000));

        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;

            if (remainingMinutes === 0) {
                return `${hours} ${hours === 1 ? 'godzina' : 'godziny'}`;
            }

            return `${hours} ${hours === 1 ? 'godzina' : 'godziny'} i ${remainingMinutes} ${remainingMinutes === 1 ? 'minuta' : 'minut'}`;
        }

        return `${minutes} ${minutes === 1 ? 'minuta' : minutes < 5 ? 'minuty' : 'minut'}`;
    }
}

module.exports = AIUsageLimitService;
