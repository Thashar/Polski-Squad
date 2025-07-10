const { formatTimeDifference } = require('../utils/helpers');

class GameService {
    constructor(config, dataService) {
        this.config = config;
        this.dataService = dataService;
        
        // Zmienne stanu gry
        this.trigger = null;
        this.triggerSetTimestamp = null;
        this.triggerClearedTimestamp = null;
        this.scoreboard = {};
        this.virtuttiMedals = {};
        this.attempts = {};
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
        const triggerState = this.dataService.loadTriggerState();
        this.trigger = triggerState.trigger;
        this.triggerSetTimestamp = triggerState.triggerSetTimestamp;
        this.triggerClearedTimestamp = triggerState.triggerClearedTimestamp;
    }

    /**
     * Zapisuje stan triggera
     */
    saveTriggerState() {
        const data = {
            trigger: this.trigger,
            timestamp: this.triggerSetTimestamp ? this.triggerSetTimestamp.toISOString() : null,
            clearedTimestamp: this.triggerClearedTimestamp ? this.triggerClearedTimestamp.toISOString() : null,
            timerStates: {
                hasFirstHintReminder: !!this.firstHintReminderTimer,
                hasSecondHintReminder: !!this.secondHintReminderTimer,
                hasPapalRoleRemoval: !!this.papalRoleRemovalTimer,
                hasHintReminder: !!this.hintReminderTimer,
                hasAutoReset: !!this.autoResetTimer,
                hasReminder: !!this.reminderTimer,
                hasRecurringReminder: !!this.recurringReminderTimer
            }
        };
        this.dataService.saveTriggerState(data);
    }

    /**
     * Czyści próby odgadnięcia
     */
    clearAttempts() {
        this.attempts = {};
        this.dataService.saveAttempts(this.attempts);
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
        console.log(`🎯 Próba ${this.attempts[userId]} od użytkownika ${userId}: "${attempt}"`);
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
     */
    setNewPassword(newTrigger) {
        this.trigger = newTrigger;
        this.triggerSetTimestamp = new Date();
        this.triggerClearedTimestamp = null;
        this.clearAttempts();
        this.resetHints();
        this.saveTriggerState();
        console.log(`🔑 Nowe hasło: ${this.trigger} (ustawione o ${this.triggerSetTimestamp.toISOString()})`);
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