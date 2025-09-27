const fs = require('fs');
const path = require('path');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
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
     * Zapisuje podpowiedzi do pliku
     * @param {Array} hints - Tablica podpowiedzi
     * @param {Date} lastHintTimestamp - Timestamp ostatniej podpowiedzi
     */
    saveHints(hints, lastHintTimestamp) {
        const hintsData = {
            hints: hints,
            lastHintTimestamp: lastHintTimestamp ? lastHintTimestamp.toISOString() : null
        };
        fs.writeFileSync(path.join(this.dataPath, 'hints.json'), JSON.stringify(hintsData, null, 2));
    }

    /**
     * Wczytuje podpowiedzi z pliku
     * @returns {Object} - Obiekt z podpowiedziami i timestampem
     */
    loadHints() {
        const hintsPath = path.join(this.dataPath, 'hints.json');
        if (fs.existsSync(hintsPath)) {
            const hintsData = JSON.parse(fs.readFileSync(hintsPath));
            return {
                hints: hintsData.hints || [],
                lastHintTimestamp: hintsData.lastHintTimestamp ? new Date(hintsData.lastHintTimestamp) : null
            };
        } else {
            return {
                hints: [],
                lastHintTimestamp: null
            };
        }
    }

    /**
     * Zapisuje ranking do pliku
     * @param {Object} scoreboard - Obiekt z rankingiem
     */
    saveScoreboard(scoreboard) {
        fs.writeFileSync(path.join(this.dataPath, 'scoreboard.json'), JSON.stringify(scoreboard, null, 2));
    }

    /**
     * Wczytuje ranking z pliku
     * @returns {Object} - Obiekt z rankingiem
     */
    loadScoreboard() {
        const scoreboardPath = path.join(this.dataPath, 'scoreboard.json');
        if (fs.existsSync(scoreboardPath)) {
            return JSON.parse(fs.readFileSync(scoreboardPath));
        }
        return {};
    }

    /**
     * Zapisuje medale Virtutti Papajlari do pliku
     * @param {Object} virtuttiMedals - Obiekt z medalami
     */
    saveVirtuttiMedals(virtuttiMedals) {
        fs.writeFileSync(path.join(this.dataPath, 'virtuttiMedals.json'), JSON.stringify(virtuttiMedals, null, 2));
    }

    /**
     * Wczytuje medale Virtutti Papajlari z pliku
     * @returns {Object} - Obiekt z medalami
     */
    loadVirtuttiMedals() {
        const virtuttiMedalsPath = path.join(this.dataPath, 'virtuttiMedals.json');
        if (fs.existsSync(virtuttiMedalsPath)) {
            return JSON.parse(fs.readFileSync(virtuttiMedalsPath));
        }
        return {};
    }

    /**
     * Zapisuje próby odgadnięcia do pliku
     * @param {Object} attempts - Obiekt z próbami
     */
    saveAttempts(attempts) {
        fs.writeFileSync(path.join(this.dataPath, 'attempts.json'), JSON.stringify(attempts, null, 2));
    }

    /**
     * Wczytuje próby odgadnięcia z pliku
     * @returns {Object} - Obiekt z próbami
     */
    loadAttempts() {
        const attemptsPath = path.join(this.dataPath, 'attempts.json');
        if (fs.existsSync(attemptsPath)) {
            return JSON.parse(fs.readFileSync(attemptsPath));
        }
        return {};
    }

    /**
     * Zapisuje stan trigger do pliku
     * @param {Object} triggerState - Stan trigger
     */
    saveTriggerState(triggerState) {
        fs.writeFileSync(path.join(this.dataPath, 'trigger.json'), JSON.stringify(triggerState, null, 2));
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
        if (fs.existsSync(triggerPath)) {
            const data = JSON.parse(fs.readFileSync(triggerPath));
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
        return {
            trigger: null,
            triggerSetTimestamp: null,
            triggerClearedTimestamp: null,
            triggerSetBy: null,
            timerStates: {}
        };
    }

    /**
     * Zapisuje historię gry do pliku
     * @param {Object} gameHistory - Historia gier
     */
    saveGameHistory(gameHistory) {
        fs.writeFileSync(path.join(this.dataPath, 'gameHistory.json'), JSON.stringify(gameHistory, null, 2));
    }

    /**
     * Wczytuje historię gry z pliku
     * @returns {Object} - Historia gier
     */
    loadGameHistory() {
        const historyPath = path.join(this.dataPath, 'gameHistory.json');
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath));
        }
        return {
            completedGames: [], // Historia ukończonych gier
            totalGames: 0,
            totalAttempts: 0,
            averageAttempts: 0,
            averageTime: 0
        };
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
        fs.writeFileSync(path.join(this.dataPath, 'playerAttempts.json'), JSON.stringify(playerAttempts, null, 2));
    }

    /**
     * Wczytuje szczegóły prób graczy
     * @returns {Object} - Szczegóły prób z timestampami
     */
    loadPlayerAttempts() {
        const attemptsPath = path.join(this.dataPath, 'playerAttempts.json');
        if (fs.existsSync(attemptsPath)) {
            return JSON.parse(fs.readFileSync(attemptsPath));
        }
        return {};
    }
}

module.exports = DataService;