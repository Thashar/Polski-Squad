const fs = require('fs').promises;
const path = require('path');

class OligopolyService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.oligopolyFile = path.join(__dirname, '../data/oligopoly.json');
        this.oligopolyData = [];
        this.init();
    }

    async init() {
        try {
            await this.loadOligopolyData();
            this.logger.info('[OLIGOPOLY] ✅ Serwis oligopoly zainicjowany');
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd inicjalizacji serwisu oligopoly:', error.message);
        }
    }

    async loadOligopolyData() {
        try {
            const data = await fs.readFile(this.oligopolyFile, 'utf-8');
            this.oligopolyData = JSON.parse(data);
            this.logger.info(`[OLIGOPOLY] ✅ Załadowano ${this.oligopolyData.length} wpisów oligopoly`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.oligopolyData = [];
                await this.saveOligopolyData();
                this.logger.info('[OLIGOPOLY] ✅ Utworzono nowy plik danych oligopoly');
            } else {
                this.logger.error('[OLIGOPOLY] ❌ Błąd ładowania danych oligopoly:', error.message);
                throw error;
            }
        }
    }

    async saveOligopolyData() {
        try {
            await fs.writeFile(this.oligopolyFile, JSON.stringify(this.oligopolyData, null, 2), 'utf-8');
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd zapisu danych oligopoly:', error.message);
            throw error;
        }
    }

    async addOligopolyEntry(userId, username, klan, id) {
        try {
            // Sprawdź czy użytkownik już ma wpis dla tego klanu
            const existingEntryIndex = this.oligopolyData.findIndex(
                entry => entry.userId === userId && entry.klan === klan
            );

            const newEntry = {
                userId,
                username,
                klan,
                id,
                timestamp: new Date().toISOString()
            };

            if (existingEntryIndex !== -1) {
                // Zaktualizuj istniejący wpis
                this.oligopolyData[existingEntryIndex] = newEntry;
                this.logger.info(`[OLIGOPOLY] 🔄 Zaktualizowano wpis dla ${username} (${klan}): ${id}`);
            } else {
                // Dodaj nowy wpis
                this.oligopolyData.push(newEntry);
                this.logger.info(`[OLIGOPOLY] ➕ Dodano nowy wpis dla ${username} (${klan}): ${id}`);
            }

            await this.saveOligopolyData();
            return true;
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd dodawania wpisu oligopoly:', error.message);
            return false;
        }
    }

    getOligopolyEntriesByKlan(klan) {
        return this.oligopolyData.filter(entry => entry.klan === klan);
    }

    getAllKlans() {
        const klans = [...new Set(this.oligopolyData.map(entry => entry.klan))];
        return klans.sort();
    }

    getEntryCount() {
        return this.oligopolyData.length;
    }
}

module.exports = OligopolyService;