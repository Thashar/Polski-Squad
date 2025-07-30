const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

class ReminderStorageService {
    constructor() {
        this.dataPath = path.join(__dirname, '../data/reminders.json');
    }

    /**
     * Ładuje dane przypomień z pliku
     * @returns {Promise<Map>} - Mapa z danymi przypomień
     */
    async loadReminders() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            const reminderData = JSON.parse(data);
            
            // Konwertuj obiekt z powrotem na Map
            const reminderMap = new Map();
            for (const [threadId, timestamp] of Object.entries(reminderData)) {
                reminderMap.set(threadId, timestamp);
            }
            
            logger.info(`📂 Załadowano ${reminderMap.size} wpisów przypomień z pliku`);
            return reminderMap;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('📄 Plik przypomień nie istnieje - tworzę nową mapę');
                return new Map();
            }
            
            logger.error('❌ Błąd ładowania danych przypomień:', error.message);
            return new Map();
        }
    }

    /**
     * Zapisuje dane przypomień do pliku
     * @param {Map} reminderMap - Mapa z danymi przypomień
     */
    async saveReminders(reminderMap) {
        try {
            // Upewnij się, że katalog istnieje
            const dir = path.dirname(this.dataPath);
            await fs.mkdir(dir, { recursive: true });
            
            // Konwertuj Map na obiekt do serializacji JSON
            const reminderData = {};
            for (const [threadId, timestamp] of reminderMap.entries()) {
                reminderData[threadId] = timestamp;
            }
            
            await fs.writeFile(this.dataPath, JSON.stringify(reminderData, null, 2), 'utf8');
            logger.info(`💾 Zapisano ${reminderMap.size} wpisów przypomień do pliku`);
        } catch (error) {
            logger.error('❌ Błąd zapisu danych przypomień:', error.message);
        }
    }

    /**
     * Usuwa wpis o przypomnieniu dla konkretnego wątku
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku do usunięcia
     */
    async removeReminder(reminderMap, threadId) {
        if (reminderMap.has(threadId)) {
            reminderMap.delete(threadId);
            await this.saveReminders(reminderMap);
            logger.info(`🗑️ Usunięto przypomnienie dla wątku: ${threadId}`);
        }
    }

    /**
     * Dodaje/aktualizuje wpis o przypomnieniu
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku
     * @param {number} timestamp - Timestamp przypomnienia
     */
    async setReminder(reminderMap, threadId, timestamp) {
        reminderMap.set(threadId, timestamp);
        await this.saveReminders(reminderMap);
        logger.info(`📅 Zaktualizowano przypomnienie dla wątku: ${threadId}`);
    }

    /**
     * Czyści nieistniejące wątki z danych przypomień
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {Collection} activeThreads - Kolekcja aktywnych wątków z Discord
     */
    async cleanupOrphanedReminders(reminderMap, activeThreads) {
        const orphanedIds = [];
        
        for (const threadId of reminderMap.keys()) {
            if (!activeThreads.has(threadId)) {
                orphanedIds.push(threadId);
            }
        }
        
        if (orphanedIds.length > 0) {
            for (const threadId of orphanedIds) {
                reminderMap.delete(threadId);
            }
            
            await this.saveReminders(reminderMap);
            logger.info(`🧹 Wyczyszczono ${orphanedIds.length} nieistniejących wątków z przypomień`);
        }
    }
}

module.exports = ReminderStorageService;