const fs = require('fs');
const path = require('path');

const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * Cały serwis chodzi przez `utils/jsonStore` (cache-first): z dysku czytamy raz,
 * przy pierwszym sięgnięciu po dany plik, a każdy zapis aktualizuje pamięć
 * natychmiast i utrwala plik atomowo w tle.
 *
 * API pozostaje SYNCHRONICZNE (wywołujący nie awaitują), dlatego zapisy idą przez
 * `store.setSync()`. Wcześniej każdy `saveX()` robił blokujący `writeFileSync`,
 * który zatrzymywał cały proces — a w nim wszystkie 9 botów.
 */
class DataService {
    constructor() {
        this.dataPath = path.join(__dirname, '..', 'data');
        this.ensureDataDirectory();
    }

    /**
     * Zapewnia istnienie katalogu data
     */
    ensureDataDirectory() {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }
    }

    /**
     * Odczyt z pamięci (z dysku tylko przy pierwszym sięgnięciu). Uszkodzony lub
     * pusty plik — np. po ENOSPC — daje wartość domyślną, tak jak dotąd.
     */
    _safeReadJSON(filePath, fallback) {
        return store.getSync(filePath, () => fallback);
    }

    /**
     * Zapis: pamięć od razu, plik atomowo w tle.
     */
    _write(fileName, data) {
        store.setSync(path.join(this.dataPath, fileName), data);
    }

    /**
     * Zapisuje podpowiedzi do pliku
     * @param {Array} hints - Tablica podpowiedzi
     * @param {Date} lastHintTimestamp - Timestamp ostatniej podpowiedzi
     */
    saveHints(hints, lastHintTimestamp) {
        const hintsData = {
            hints: hints,
            lastHintTimestamp: lastHintTimestamp ? lastHintTimestamp.toISOString() : null
        };
        this._write('hints.json', hintsData);
    }

    /**
     * Wczytuje podpowiedzi z pliku
     * @returns {Object} - Obiekt z podpowiedziami i timestampem
     */
    loadHints() {
        const hintsPath = path.join(this.dataPath, 'hints.json');
        const hintsData = this._safeReadJSON(hintsPath, {});
        return {
            hints: hintsData.hints || [],
            lastHintTimestamp: hintsData.lastHintTimestamp ? new Date(hintsData.lastHintTimestamp) : null
        };
    }

    /**
     * Zapisuje ranking do pliku
     * @param {Object} scoreboard - Obiekt z rankingiem
     */
    saveScoreboard(scoreboard) {
        this._write('scoreboard.json', scoreboard);
    }

    /**
     * Wczytuje ranking z pliku
     * @returns {Object} - Obiekt z rankingiem
     */
    loadScoreboard() {
        const scoreboardPath = path.join(this.dataPath, 'scoreboard.json');
        return this._safeReadJSON(scoreboardPath, {});
    }

    /**
     * Zapisuje medale Virtutti Papajlari do pliku
     * @param {Object} virtuttiMedals - Obiekt z medalami
     */
    saveVirtuttiMedals(virtuttiMedals) {
        this._write('virtuttiMedals.json', virtuttiMedals);
    }

    /**
     * Wczytuje medale Virtutti Papajlari z pliku
     * @returns {Object} - Obiekt z medalami
     */
    loadVirtuttiMedals() {
        const virtuttiMedalsPath = path.join(this.dataPath, 'virtuttiMedals.json');
        return this._safeReadJSON(virtuttiMedalsPath, {});
    }

    /**
     * Zapisuje próby odgadnięcia do pliku
     * @param {Object} attempts - Obiekt z próbami
     */
    saveAttempts(attempts) {
        this._write('attempts.json', attempts);
    }

    /**
     * Wczytuje próby odgadnięcia z pliku
     * @returns {Object} - Obiekt z próbami
     */
    loadAttempts() {
        const attemptsPath = path.join(this.dataPath, 'attempts.json');
        return this._safeReadJSON(attemptsPath, {});
    }

    /**
     * Zapisuje stan trigger do pliku
     * @param {Object} triggerState - Stan trigger
     */
    saveTriggerState(triggerState) {
        this._write('trigger.json', triggerState);
        const triggerDisplay = triggerState.trigger || 'brak';
        const activeTimers = Object.values(triggerState.timerStates || {}).filter(Boolean).length;
        logger.info(`💾 Zapisano stan triggera: "${triggerDisplay}" (${activeTimers} aktywnych timerów)`);
    }

    /**
     * Wczytuje stan trigger z pliku
     * @returns {Object} - Stan trigger
     */
    loadTriggerState() {
        const triggerPath = path.join(this.dataPath, 'trigger.json');
        const empty = {
            trigger: null,
            triggerSetTimestamp: null,
            triggerClearedTimestamp: null,
            triggerSetBy: null,
            timerStates: {}
        };

        const data = this._safeReadJSON(triggerPath, {});
        if (!data || data.trigger === undefined) return empty;

        logger.info('📂 Wczytano stan triggera:', {
            trigger: data.trigger,
            triggerSetTimestamp: data.timestamp ? new Date(data.timestamp) : null,
            clearedTimestamp: data.clearedTimestamp ? new Date(data.clearedTimestamp) : null,
            timerStates: data.timerStates || {}
        });

        return {
            trigger: data.trigger,
            triggerSetTimestamp: data.timestamp ? new Date(data.timestamp) : null,
            triggerClearedTimestamp: data.clearedTimestamp ? new Date(data.clearedTimestamp) : null,
            triggerSetBy: data.triggerSetBy || null,
            timerStates: data.timerStates || {}
        };
    }

    /**
     * Zapisuje historię gry do pliku
     * @param {Object} gameHistory - Historia gier
     */
    saveGameHistory(gameHistory) {
        this._write('gameHistory.json', gameHistory);
    }

    /**
     * Wczytuje historię gry z pliku
     * @returns {Object} - Historia gier
     */
    loadGameHistory() {
        const historyPath = path.join(this.dataPath, 'gameHistory.json');
        const fallback = { completedGames: [], totalGames: 0, totalAttempts: 0, averageAttempts: 0, averageTime: 0 };
        return this._safeReadJSON(historyPath, fallback);
    }

    /**
     * Dodaje ukończoną grę do historii
     * @param {Object} gameData - Dane ukończonej gry
     */
    addCompletedGame(gameData) {
        const history = this.loadGameHistory();
        
        // Dodaj nową grę na początek (najnowsze pierwsze)
        history.completedGames.unshift({
            id: Date.now().toString(),
            password: gameData.password,
            setBy: gameData.setBy,
            setAt: gameData.setAt,
            solvedBy: gameData.solvedBy,
            solvedAt: gameData.solvedAt,
            duration: gameData.duration,
            totalAttempts: gameData.totalAttempts,
            hintsUsed: gameData.hintsUsed,
            playersInvolved: gameData.playersInvolved
        });

        // Zachowaj tylko ostatnie 50 gier dla wydajności
        if (history.completedGames.length > 50) {
            history.completedGames = history.completedGames.slice(0, 50);
        }

        // Aktualizuj statystyki globalne
        history.totalGames = history.completedGames.length;
        history.totalAttempts = history.completedGames.reduce((sum, game) => sum + game.totalAttempts, 0);
        history.averageAttempts = history.totalGames > 0 ? (history.totalAttempts / history.totalGames).toFixed(1) : 0;
        
        const totalDuration = history.completedGames.reduce((sum, game) => sum + game.duration, 0);
        history.averageTime = history.totalGames > 0 ? Math.floor(totalDuration / history.totalGames) : 0;

        this.saveGameHistory(history);
        logger.info('📊 Dodano ukończoną grę do historii:', gameData.password);
    }

    /**
     * Zapisuje szczegóły prób graczy dla bieżącej gry
     * @param {Object} playerAttempts - Szczegóły prób z timestampami
     */
    savePlayerAttempts(playerAttempts) {
        this._write('playerAttempts.json', playerAttempts);
    }

    /**
     * Wczytuje szczegóły prób graczy
     * @returns {Object} - Szczegóły prób z timestampami
     */
    loadPlayerAttempts() {
        const attemptsPath = path.join(this.dataPath, 'playerAttempts.json');
        return this._safeReadJSON(attemptsPath, {});
    }

    /**
     * Zapisuje stan wyboru hasła
     * @param {Object} state - Stan do zapisania
     */
    savePasswordSelectionState(state) {
        this._write('password_selection_state.json', state);
    }

    /**
     * Wczytuje stan wyboru hasła
     * @returns {Object} - Stan wyboru hasła
     */
    loadPasswordSelectionState() {
        const filePath = path.join(this.dataPath, 'password_selection_state.json');
        return this._safeReadJSON(filePath, { activeSelectionMessageId: null });
    }

    /**
     * Zapisuje stan wyboru podpowiedzi
     * @param {Object} state - Stan do zapisania
     */
    saveHintSelectionState(state) {
        this._write('hint_selection_state.json', state);
    }

    /**
     * Wczytuje stan wyboru podpowiedzi
     * @returns {Object} - Stan wyboru podpowiedzi
     */
    loadHintSelectionState() {
        const filePath = path.join(this.dataPath, 'hint_selection_state.json');
        return this._safeReadJSON(filePath, { activeSelectionMessageId: null });
    }

    /**
     * Zapisuje dane o użyciu AI
     * @param {Object} usage - Dane o użyciu AI
     */
    saveAIUsage(usage) {
        this._write('ai_usage.json', usage);
    }

    /**
     * Wczytuje dane o użyciu AI
     * @returns {Object} - Dane o użyciu AI (userId -> usage data)
     */
    loadAIUsage() {
        const filePath = path.join(this.dataPath, 'ai_usage.json');
        return this._safeReadJSON(filePath, {});
    }
}

module.exports = DataService;