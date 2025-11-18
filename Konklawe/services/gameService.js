const { formatTimeDifference } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class GameService {
    constructor(config, dataService) {
        this.config = config;
        this.dataService = dataService;

        // Zmienne stanu gry
        this.trigger = null;
        this.triggerSetTimestamp = null;
        this.triggerClearedTimestamp = null;
        this.triggerSetBy = null; // Kto ustawił hasło
        this.scoreboard = {};
        this.virtuttiMedals = {};
        this.attempts = {};
        this.playerAttempts = {}; // Szczegóły prób z timestampami
        this.konklaweUsed = false;
        this.hints = [];
        this.lastHintTimestamp = null;
        
        // Timery
        this.autoResetTimer = null;
        this.reminderTimer = null;
        this.hintReminderTimer = null;
        this.papalRoleRemovalTimer = null;
        this.firstHintReminderTimer = null;
        this.secondHintReminderTimer = null;
        this.recurringReminderTimer = null;
        this.hintTimeoutTimer = null; // Timer dla 24h timeout za brak nowej podpowiedzi
        
        // Konwersja czasów z konfiguracji na milisekundy
        this.AUTO_RESET_TIME = this.config.timers.autoResetMinutes * 60 * 1000;
        this.REMINDER_TIME = this.config.timers.reminderMinutes * 60 * 1000;
        this.HINT_REMINDER_TIME = this.config.timers.hintReminderHours * 60 * 60 * 1000;
        this.PAPAL_ROLE_REMOVAL_TIME = this.config.timers.papalRoleRemovalHours * 60 * 60 * 1000;
        
        // Nowe stałe czasowe dla przypominania o podpowiedziach
        this.FIRST_HINT_REMINDER_TIME = 15 * 60 * 1000; // 15 minut
        this.SECOND_HINT_REMINDER_TIME = 30 * 60 * 1000; // 30 minut
        this.ROLE_REMOVAL_TIME = 60 * 60 * 1000; // 1 godzina
        this.EXISTING_HINT_REMINDER_TIME = 6 * 60 * 60 * 1000; // 6 godzin
        this.RECURRING_REMINDER_TIME = 15 * 60 * 1000; // 15 minut dla powtarzających się przypomnień
        this.HINT_TIMEOUT_TIME = 24 * 60 * 60 * 1000; // 24 godziny - timeout za brak nowej podpowiedzi
    }

    /**
     * Pobiera aktualny czas w polskiej strefie czasowej
     * @returns {Date} - Data w polskim czasie
     */
    getPolishTime() {
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
    }

    /**
     * Inicjalizuje dane gry
     */
    initializeGameData() {
        this.scoreboard = this.dataService.loadScoreboard();
        this.virtuttiMedals = this.dataService.loadVirtuttiMedals();
        const hintsData = this.dataService.loadHints();
        this.hints = hintsData.hints;
        this.lastHintTimestamp = hintsData.lastHintTimestamp;
        this.attempts = this.dataService.loadAttempts();
        this.playerAttempts = this.dataService.loadPlayerAttempts();
        const triggerState = this.dataService.loadTriggerState();
        this.trigger = triggerState.trigger;
        this.triggerSetTimestamp = triggerState.triggerSetTimestamp;
        this.triggerClearedTimestamp = triggerState.triggerClearedTimestamp;
        this.triggerSetBy = triggerState.triggerSetBy;
    }

    /**
     * Zapisuje stan triggera
     */
    saveTriggerState() {
        const data = {
            trigger: this.trigger,
            timestamp: this.triggerSetTimestamp ? this.triggerSetTimestamp.toISOString() : null,
            clearedTimestamp: this.triggerClearedTimestamp ? this.triggerClearedTimestamp.toISOString() : null,
            triggerSetBy: this.triggerSetBy,
            timerStates: {
                hasFirstHintReminder: !!this.firstHintReminderTimer,
                hasSecondHintReminder: !!this.secondHintReminderTimer,
                hasPapalRoleRemoval: !!this.papalRoleRemovalTimer,
                hasHintReminder: !!this.hintReminderTimer,
                hasAutoReset: !!this.autoResetTimer,
                hasReminder: !!this.reminderTimer,
                hasRecurringReminder: !!this.recurringReminderTimer,
                hasHintTimeout: !!this.hintTimeoutTimer
            }
        };
        this.dataService.saveTriggerState(data);
    }

    /**
     * Czyści próby odgadnięcia
     */
    clearAttempts() {
        this.attempts = {};
        this.playerAttempts = {};
        this.dataService.saveAttempts(this.attempts);
        this.dataService.savePlayerAttempts(this.playerAttempts);
    }

    /**
     * Rejestruje próbę odgadnięcia hasła
     * @param {string} userId - ID użytkownika
     * @param {string} attempt - Próba hasła
     * @param {boolean} isCorrect - Czy próba była poprawna
     */
    registerAttempt(userId, attempt, isCorrect = false) {
        // Zwiększ licznik prób
        this.attempts[userId] = (this.attempts[userId] || 0) + 1;

        // Zapisz szczegóły próby z timestampem
        if (!this.playerAttempts[userId]) {
            this.playerAttempts[userId] = [];
        }

        this.playerAttempts[userId].push({
            attempt: attempt,
            timestamp: new Date().toISOString(),
            isCorrect: isCorrect
        });

        // Zapisz dane
        this.dataService.saveAttempts(this.attempts);
        this.dataService.savePlayerAttempts(this.playerAttempts);
    }

    /**
     * Dodaje ukończoną grę do historii
     * @param {string} solvedByUserId - ID użytkownika który rozwiązał
     */
    addGameToHistory(solvedByUserId) {
        if (!this.trigger || !this.triggerSetTimestamp) return;

        const now = new Date();
        const duration = now - this.triggerSetTimestamp; // w milisekundach
        const totalAttempts = Object.values(this.attempts).reduce((sum, attempts) => sum + attempts, 0);

        const gameData = {
            password: this.trigger,
            setBy: this.triggerSetBy,
            setAt: this.triggerSetTimestamp.toISOString(),
            solvedBy: solvedByUserId,
            solvedAt: now.toISOString(),
            duration: duration,
            totalAttempts: totalAttempts,
            hintsUsed: this.hints.length,
            playersInvolved: Object.keys(this.attempts).length
        };

        this.dataService.addCompletedGame(gameData);
    }

    /**
     * Pobiera historię gier
     * @returns {Object} Historia gier
     */
    getGameHistory() {
        return this.dataService.loadGameHistory();
    }

    /**
     * Dodaje próbę odgadnięcia
     * @param {string} userId - ID użytkownika
     * @param {string} attempt - Próba odgadnięcia
     */
    addAttempt(userId, attempt) {
        if (!this.attempts[userId]) {
            this.attempts[userId] = 0;
        }
        this.attempts[userId]++;
        this.dataService.saveAttempts(this.attempts);
        logger.info(`🎯 Próba ${this.attempts[userId]} od użytkownika ${userId}: "${attempt}"`);
    }

    /**
     * Dodaje podpowiedź
     * @param {string} hintText - Tekst podpowiedzi
     */
    addHint(hintText) {
        this.hints.push(hintText);
        this.lastHintTimestamp = new Date();
        this.dataService.saveHints(this.hints, this.lastHintTimestamp);
    }

    /**
     * Resetuje podpowiedzi
     */
    resetHints() {
        this.hints = [];
        this.lastHintTimestamp = null;
        this.dataService.saveHints(this.hints, this.lastHintTimestamp);
    }

    /**
     * Ustawia nowe hasło
     * @param {string} newTrigger - Nowe hasło
     * @param {string} setByUserId - ID użytkownika który ustawił hasło
     */
    setNewPassword(newTrigger, setByUserId = null) {
        this.trigger = newTrigger;
        this.triggerSetTimestamp = new Date();
        this.triggerClearedTimestamp = null;
        this.triggerSetBy = setByUserId;
        this.clearAttempts();
        this.resetHints();
        this.saveTriggerState();
        logger.info(`🔑 Nowe hasło: ${this.trigger} (ustawione o ${this.triggerSetTimestamp.toISOString()}) przez ${setByUserId || 'system'}`);
    }

    /**
     * Czyści hasło
     */
    clearPassword() {
        this.trigger = null;
        this.triggerSetTimestamp = null;
        this.triggerClearedTimestamp = new Date();
        this.saveTriggerState();
    }

    /**
     * Resetuje hasło na domyślne
     */
    resetToDefaultPassword() {
        this.trigger = this.config.messages.defaultPassword;
        this.triggerSetTimestamp = new Date();
        this.triggerClearedTimestamp = null;
        this.clearAttempts();
        this.resetHints();
        this.saveTriggerState();
    }

    /**
     * Dodaje punkty użytkownikowi
     * @param {string} userId - ID użytkownika
     * @param {number} points - Liczba punktów
     */
    addPoints(userId, points) {
        this.scoreboard[userId] = (this.scoreboard[userId] || 0) + points;
        this.dataService.saveScoreboard(this.scoreboard);
    }

    /**
     * Resetuje ranking
     */
    resetScoreboard() {
        this.scoreboard = {};
        this.dataService.saveScoreboard(this.scoreboard);
    }

    /**
     * Dodaje medal Virtutti Papajlari
     * @param {string} userId - ID użytkownika
     */
    addVirtuttiMedal(userId) {
        this.virtuttiMedals[userId] = (this.virtuttiMedals[userId] || 0) + 1;
        this.dataService.saveVirtuttiMedals(this.virtuttiMedals);
    }

    /**
     * Sprawdza czy użytkownik osiągnął medal Virtutti Papajlari
     * @param {string} userId - ID użytkownika
     * @returns {boolean} - True jeśli osiągnął medal
     */
    hasAchievedVirtuttiPapajlari(userId) {
        const userScore = this.scoreboard[userId] || 0;
        return userScore >= this.config.achievements.virtuttiPapajlariThreshold;
    }

    /**
     * Pobiera TOP 3 graczy
     * @returns {Array} - Tablica z TOP 3 graczami
     */
    getTop3Players() {
        return Object.entries(this.scoreboard).sort((a, b) => b[1] - a[1]).slice(0, 3);
    }

    /**
     * Pobiera posortowanych graczy
     * @returns {Array} - Tablica z posortowanymi graczami
     */
    getSortedPlayers() {
        return Object.entries(this.scoreboard).sort((a, b) => b[1] - a[1]);
    }

    /**
     * Pobiera posortowanych graczy z medalami
     * @returns {Array} - Tablica z posortowanymi graczami z medalami
     */
    getSortedMedals() {
        return Object.entries(this.virtuttiMedals).filter(([userId, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    }

    /**
     * Pobiera liczbę prób użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {number} - Liczba prób
     */
    getUserAttempts(userId) {
        return this.attempts[userId] || 0;
    }

    /**
     * Pobiera różnicę czasu od ustawienia hasła
     * @returns {number} - Różnica w milisekundach
     */
    getTimeSincePasswordSet() {
        if (!this.triggerSetTimestamp) return 0;
        return new Date() - this.triggerSetTimestamp;
    }

    /**
     * Pobiera sformatowany czas od ustawienia hasła
     * @returns {string} - Sformatowany czas
     */
    getFormattedTimeSincePasswordSet() {
        return formatTimeDifference(this.getTimeSincePasswordSet());
    }
}

module.exports = GameService;