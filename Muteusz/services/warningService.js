const fs = require('fs');
const path = require('path');

class WarningService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.warningsFile = path.join(__dirname, '../data/warnings.json');
        this.ensureDataDirectory();
    }

    /**
     * Zapewnia istnienie katalogu danych
     */
    ensureDataDirectory() {
        const dataDir = path.dirname(this.warningsFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Utwórz plik jeśli nie istnieje
        if (!fs.existsSync(this.warningsFile)) {
            fs.writeFileSync(this.warningsFile, JSON.stringify({}));
        }
    }

    /**
     * Wczytuje ostrzeżenia z pliku
     * @returns {Object} Dane ostrzeżeń
     */
    loadWarnings() {
        try {
            const data = fs.readFileSync(this.warningsFile, 'utf8');
            return safeParse(data, {});
        } catch (error) {
            this.logger.error(`Błąd podczas wczytywania ostrzeżeń: ${error.message}`);
            return {};
        }
    }

    /**
     * Zapisuje ostrzeżenia do pliku
     * @param {Object} warnings - Dane ostrzeżeń
     */
    saveWarnings(warnings) {
        try {
            fs.writeFileSync(this.warningsFile, JSON.stringify(warnings, null, 2));
        } catch (error) {
            this.logger.error(`Błąd podczas zapisywania ostrzeżeń: ${error.message}`);
        }
    }

    /**
     * Dodaje ostrzeżenie użytkownikowi
     * @param {string} userId - ID użytkownika
     * @param {string} moderatorId - ID moderatora
     * @param {string} moderatorTag - Tag moderatora
     * @param {string} reason - Powód ostrzeżenia
     * @param {string} guildId - ID serwera
     * @returns {Object} Informacje o dodanym ostrzeżeniu
     */
    addWarning(userId, moderatorId, moderatorTag, reason, guildId) {
        const warnings = this.loadWarnings();
        
        if (!warnings[userId]) {
            warnings[userId] = [];
        }

        const warning = {
            id: Date.now().toString(),
            reason: reason,
            moderator: {
                id: moderatorId,
                tag: moderatorTag
            },
            timestamp: new Date().toISOString(),
            guildId: guildId
        };

        warnings[userId].push(warning);
        this.saveWarnings(warnings);

        this.logger.info(`Dodano ostrzeżenie dla użytkownika ${userId} przez ${moderatorTag}: ${reason}`);
        
        return {
            warning: warning,
            totalWarnings: warnings[userId].length
        };
    }

    /**
     * Pobiera ostrzeżenia użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     * @returns {Array} Lista ostrzeżeń
     */
    getUserWarnings(userId, guildId) {
        const warnings = this.loadWarnings();
        
        if (!warnings[userId]) {
            return [];
        }

        // Filtruj ostrzeżenia dla konkretnego serwera
        return warnings[userId].filter(warning => warning.guildId === guildId);
    }

    /**
     * Pobiera statystyki ostrzeżeń użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     * @returns {Object} Statystyki ostrzeżeń
     */
    getUserWarningStats(userId, guildId) {
        const userWarnings = this.getUserWarnings(userId, guildId);
        
        return {
            totalWarnings: userWarnings.length,
            latestWarning: userWarnings.length > 0 ? userWarnings[userWarnings.length - 1] : null,
            firstWarning: userWarnings.length > 0 ? userWarnings[0] : null
        };
    }

    /**
     * Dzieli ostrzeżenia na strony
     * @param {Array} warnings - Lista ostrzeżeń
     * @param {number} pageSize - Rozmiar strony
     * @returns {Array} Podzielone strony
     */
    paginateWarnings(warnings, pageSize = 10) {
        const pages = [];
        
        for (let i = 0; i < warnings.length; i += pageSize) {
            pages.push(warnings.slice(i, i + pageSize));
        }
        
        return pages;
    }

    /**
     * Usuwa ostrzeżenie
     * @param {string} userId - ID użytkownika
     * @param {string} warningId - ID ostrzeżenia
     * @param {string} guildId - ID serwera
     * @returns {boolean} Czy ostrzeżenie zostało usunięte
     */
    removeWarning(userId, warningId, guildId) {
        const warnings = this.loadWarnings();
        
        if (!warnings[userId]) {
            return false;
        }

        const initialLength = warnings[userId].length;
        warnings[userId] = warnings[userId].filter(warning => 
            warning.id !== warningId || warning.guildId !== guildId
        );

        if (warnings[userId].length === initialLength) {
            return false;
        }

        // Usuń użytkownika z listy jeśli nie ma więcej ostrzeżeń
        if (warnings[userId].length === 0) {
            delete warnings[userId];
        }

        this.saveWarnings(warnings);
        this.logger.info(`Usunięto ostrzeżenie ${warningId} dla użytkownika ${userId}`);
        
        return true;
    }

    /**
     * Usuwa ostatnie ostrzeżenie użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     * @returns {Object} Informacje o usuniętym ostrzeżeniu
     */
    removeLastWarning(userId, guildId) {
        const warnings = this.loadWarnings();
        
        if (!warnings[userId] || warnings[userId].length === 0) {
            return { success: false, message: 'Użytkownik nie ma żadnych ostrzeżeń' };
        }

        const userWarnings = warnings[userId].filter(warning => warning.guildId === guildId);
        
        if (userWarnings.length === 0) {
            return { success: false, message: 'Użytkownik nie ma żadnych ostrzeżeń na tym serwerze' };
        }

        // Znajdź ostatnie ostrzeżenie (najnowsze)
        const lastWarning = userWarnings[userWarnings.length - 1];
        
        // Usuń ostatnie ostrzeżenie
        warnings[userId] = warnings[userId].filter(warning => warning.id !== lastWarning.id);

        // Usuń użytkownika z listy jeśli nie ma więcej ostrzeżeń
        if (warnings[userId].length === 0) {
            delete warnings[userId];
        }

        this.saveWarnings(warnings);
        this.logger.info(`Usunięto ostatnie ostrzeżenie dla użytkownika ${userId}`);
        
        return { 
            success: true, 
            warning: lastWarning,
            remainingWarnings: warnings[userId] ? warnings[userId].filter(w => w.guildId === guildId).length : 0
        };
    }

    /**
     * Usuwa wszystkie ostrzeżenia użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     * @returns {Object} Informacje o usuniętych ostrzeżeniach
     */
    removeAllWarnings(userId, guildId) {
        const warnings = this.loadWarnings();
        
        if (!warnings[userId]) {
            return { success: false, message: 'Użytkownik nie ma żadnych ostrzeżeń' };
        }

        const userWarnings = warnings[userId].filter(warning => warning.guildId === guildId);
        
        if (userWarnings.length === 0) {
            return { success: false, message: 'Użytkownik nie ma żadnych ostrzeżeń na tym serwerze' };
        }

        const removedCount = userWarnings.length;
        
        // Usuń wszystkie ostrzeżenia dla tego serwera
        warnings[userId] = warnings[userId].filter(warning => warning.guildId !== guildId);

        // Usuń użytkownika z listy jeśli nie ma więcej ostrzeżeń
        if (warnings[userId].length === 0) {
            delete warnings[userId];
        }

        this.saveWarnings(warnings);
        this.logger.info(`Usunięto wszystkie ostrzeżenia (${removedCount}) dla użytkownika ${userId} na serwerze ${guildId}`);
        
        return { 
            success: true, 
            removedCount: removedCount
        };
    }

    /**
     * Pobiera wszystkie ostrzeżenia na serwerze
     * @param {string} guildId - ID serwera
     * @returns {Array} Lista wszystkich ostrzeżeń
     */
    getAllWarnings(guildId) {
        const warnings = this.loadWarnings();
        const allWarnings = [];
        
        for (const userId in warnings) {
            const userWarnings = warnings[userId].filter(warning => warning.guildId === guildId);
            userWarnings.forEach(warning => {
                allWarnings.push({
                    ...warning,
                    userId: userId
                });
            });
        }
        
        return allWarnings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
}

module.exports = WarningService;