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
            for (const [threadId, threadData] of Object.entries(reminderData)) {
                // Wsparcie dla starego formatu (tylko timestamp) i nowego (obiekt z danymi)
                if (typeof threadData === 'number') {
                    // Stary format - tylko timestamp przypomnienia
                    reminderMap.set(threadId, {
                        lastReminder: threadData,
                        threadCreated: null, // Nie znamy daty utworzenia
                        reminderSent: false, // Nowe pole dla śledzenia przypomnienia
                        ownerId: null, // Właściciel wątku (nieznany w starym formacie)
                        helpPingSent: false // Czy wysłano już ping z prośbą o pomoc w tym cyklu
                    });
                } else {
                    // Nowy format - obiekt z pełnymi danymi
                    reminderMap.set(threadId, threadData);
                }
            }
            
            return reminderMap;
        } catch (error) {
            if (error.code === 'ENOENT') {
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
            for (const [threadId, threadData] of reminderMap.entries()) {
                reminderData[threadId] = threadData;
            }
            
            await fs.writeFile(this.dataPath, JSON.stringify(reminderData, null, 2), 'utf8');
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
     * @param {number|null} threadCreated - Timestamp utworzenia wątku (opcjonalny)
     * @param {string|null} ownerId - ID właściciela wątku (opcjonalny)
     */
    async setReminder(reminderMap, threadId, timestamp, threadCreated = null, ownerId = null) {
        const existingData = reminderMap.get(threadId);

        const threadData = {
            lastReminder: timestamp,
            threadCreated: threadCreated || (existingData ? existingData.threadCreated : null),
            reminderSent: existingData ? existingData.reminderSent : false,
            ownerId: ownerId || (existingData ? existingData.ownerId : null),
            helpPingSent: existingData ? (existingData.helpPingSent || false) : false
        };

        reminderMap.set(threadId, threadData);
        await this.saveReminders(reminderMap);
        logger.info(`📅 Zaktualizowano przypomnienie dla wątku: ${threadId}`);
    }

    /**
     * Oznacza że wysłano ping z prośbą o pomoc dla wątku (raz na cykl otwarcia)
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku
     */
    async markHelpPingSent(reminderMap, threadId) {
        const existingData = reminderMap.get(threadId);
        if (existingData) {
            existingData.helpPingSent = true;
            reminderMap.set(threadId, existingData);
            await this.saveReminders(reminderMap);
            logger.info(`📢 Oznaczono ping o pomoc jako wysłany dla wątku: ${threadId}`);
        }
    }

    /**
     * Resetuje flagę pingu o pomoc (przy otwarciu/ponownym otwarciu wątku)
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku
     */
    async resetHelpPing(reminderMap, threadId) {
        const existingData = reminderMap.get(threadId);
        if (existingData) {
            existingData.helpPingSent = false;
            reminderMap.set(threadId, existingData);
            await this.saveReminders(reminderMap);
            logger.info(`🔄 Zresetowano flagę pingu o pomoc dla wątku: ${threadId}`);
        }
    }

    /**
     * Oznacza że przypomnienie zostało wysłane dla wątku
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku
     */
    async markReminderSent(reminderMap, threadId) {
        const existingData = reminderMap.get(threadId);
        if (existingData) {
            existingData.reminderSent = true;
            reminderMap.set(threadId, existingData);
            await this.saveReminders(reminderMap);
            logger.info(`📨 Oznaczono przypomnienie jako wysłane dla wątku: ${threadId}`);
        }
    }

    /**
     * Resetuje status przypomnienia dla wątku (gdy użytkownik wybierze "jeszcze nie zamykaj")
     * @param {Map} reminderMap - Mapa z danymi przypomień
     * @param {string} threadId - ID wątku
     */
    async resetReminderStatus(reminderMap, threadId, timestamp = null) {
        const existingData = reminderMap.get(threadId);
        if (existingData) {
            existingData.reminderSent = false;
            existingData.lastReminder = timestamp || Date.now();
            reminderMap.set(threadId, existingData);
            await this.saveReminders(reminderMap);
            logger.info(`🔄 Zresetowano status przypomnienia dla wątku: ${threadId}`);
        }
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