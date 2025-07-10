const fs = require('fs');
const path = require('path');

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
        console.log('💾 Zapisano stan triggera:', triggerState);
    }

    /**
     * Wczytuje stan trigger z pliku
     * @returns {Object} - Stan trigger
     */
    loadTriggerState() {
        const triggerPath = path.join(this.dataPath, 'trigger.json');
        if (fs.existsSync(triggerPath)) {
            const data = JSON.parse(fs.readFileSync(triggerPath));
            console.log('📂 Wczytano stan triggera:', {
                trigger: data.trigger,
                triggerSetTimestamp: data.timestamp ? new Date(data.timestamp) : null,
                clearedTimestamp: data.clearedTimestamp ? new Date(data.clearedTimestamp) : null,
                timerStates: data.timerStates || {}
            });
            return {
                trigger: data.trigger,
                triggerSetTimestamp: data.timestamp ? new Date(data.timestamp) : null,
                triggerClearedTimestamp: data.clearedTimestamp ? new Date(data.clearedTimestamp) : null,
                timerStates: data.timerStates || {}
            };
        }
        return {
            trigger: null,
            triggerSetTimestamp: null,
            triggerClearedTimestamp: null,
            timerStates: {}
        };
    }
}

module.exports = DataService;