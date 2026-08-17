const fs = require('fs').promises;
const path = require('path');
const store = require('../../utils/jsonStore');

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
            this.oligopolyData = await store.getOrLoad(this.oligopolyFile, () => []);
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
            await store.set(this.oligopolyFile, this.oligopolyData);
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd zapisu danych oligopoly:', error.message);
            throw error;
        }
    }

    async addOligopolyEntry(userId, username, serverNickname, klan, id) {
        try {
            // Sprawdź czy ID już istnieje w systemie (dla wszystkich użytkowników i klanów)
            const existingIdEntry = this.oligopolyData.find(entry => entry.id === id);

            if (existingIdEntry && existingIdEntry.userId !== userId) {
                // ID już istnieje u innego użytkownika
                return {
                    success: false,
                    error: 'ID_EXISTS',
                    existingUser: existingIdEntry.serverNickname || existingIdEntry.username,
                    existingKlan: existingIdEntry.klan
                };
            }

            // Sprawdź czy użytkownik już ma wpis dla tego klanu
            const existingUserEntryIndex = this.oligopolyData.findIndex(
                entry => entry.userId === userId && entry.klan === klan
            );

            const newEntry = {
                userId,
                username,
                serverNickname,
                klan,
                id,
                timestamp: new Date().toISOString()
            };

            if (existingUserEntryIndex !== -1) {
                // Zaktualizuj istniejący wpis tego samego użytkownika
                const oldId = this.oligopolyData[existingUserEntryIndex].id;
                this.oligopolyData[existingUserEntryIndex] = newEntry;
                this.logger.info(`[OLIGOPOLY] 🔄 Zaktualizowano wpis dla ${serverNickname} (${klan}): ${oldId} → ${id}`);
            } else {
                // Dodaj nowy wpis
                this.oligopolyData.push(newEntry);
                this.logger.info(`[OLIGOPOLY] ➕ Dodano nowy wpis dla ${serverNickname} (${klan}): ${id}`);
            }

            await this.saveOligopolyData();
            return { success: true };
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd dodawania wpisu oligopoly:', error.message);
            return { success: false, error: 'SYSTEM_ERROR' };
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

    async clearAllEntries() {
        try {
            const clearedCount = this.oligopolyData.length;
            this.oligopolyData = [];
            await this.saveOligopolyData();
            this.logger.info(`[OLIGOPOLY] 🗑️ Wyczyszczono wszystkie wpisy oligopoly (${clearedCount} wpisów)`);
            return true;
        } catch (error) {
            this.logger.error('[OLIGOPOLY] ❌ Błąd czyszczenia wpisów oligopoly:', error.message);
            return false;
        }
    }
}

module.exports = OligopolyService;