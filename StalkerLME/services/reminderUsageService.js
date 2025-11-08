const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

class ReminderUsageService {
    constructor(config) {
        this.config = config;
        this.dataPath = path.join(__dirname, '../data/reminder_usage.json');
        this.usageData = null;
    }

    /**
     * Ładuje dane o użyciu przypomnień z pliku
     * @returns {Promise<Object>} - Obiekt z danymi użycia przypomnień
     */
    async loadUsageData() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            this.usageData = JSON.parse(data);
            logger.info('✅ Załadowano dane użycia przypomnień');
            return this.usageData;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje, utworzenie nowego
                this.usageData = {};
                await this.saveUsageData();
                logger.info('📝 Utworzono nowy plik danych użycia przypomnień');
                return this.usageData;
            }

            logger.error('❌ Błąd ładowania danych użycia przypomnień:', error.message);
            this.usageData = {};
            return this.usageData;
        }
    }

    /**
     * Zapisuje dane o użyciu przypomnień do pliku
     */
    async saveUsageData() {
        try {
            // Upewnij się, że katalog istnieje
            const dir = path.dirname(this.dataPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(this.dataPath, JSON.stringify(this.usageData, null, 2), 'utf8');
            logger.info('💾 Zapisano dane użycia przypomnień');
        } catch (error) {
            logger.error('❌ Błąd zapisu danych użycia przypomnień:', error.message);
        }
    }

    /**
     * Pobiera dzisiejszą datę w formacie YYYY-MM-DD (czas Polski)
     * @returns {string}
     */
    getTodayDate() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));

        const year = polandTime.getFullYear();
        const month = String(polandTime.getMonth() + 1).padStart(2, '0');
        const day = String(polandTime.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    /**
     * Oblicza ile minut zostało do deadline
     * @returns {number} - Minuty do deadline
     */
    getMinutesToDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));

        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);

        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }

        const timeDiff = deadline - polandTime;
        return Math.floor(timeDiff / (1000 * 60));
    }

    /**
     * Sprawdza czy użytkownik może wysłać przypomnienie
     * @param {string} userId - ID użytkownika
     * @returns {Object} - { canSend: boolean, reason: string, minutesToDeadline: number }
     */
    async canSendReminder(userId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const minutesToDeadline = this.getMinutesToDeadline();
        const today = this.getTodayDate();

        // Inicjalizacja danych użytkownika jeśli nie istnieją
        if (!this.usageData[userId]) {
            this.usageData[userId] = {
                totalReminders: 0,
                dailyReminders: {}
            };
        }

        const userData = this.usageData[userId];
        const todayReminders = userData.dailyReminders[today] || [];

        // Sprawdź czy użytkownik wysłał już przypomnienia dzisiaj
        const remindersCount = todayReminders.length;

        // Logika limitów:
        // - Więcej niż 6h (>360 min) - można wysłać pierwsze przypomnienie
        // - Między 1h a 6h (60-360 min) - można wysłać drugie przypomnienie
        // - Mniej niż 1h (<60 min) - nie można wysłać

        if (minutesToDeadline < 60) {
            return {
                canSend: false,
                reason: '❌ Nie można wysłać przypomnienia - zostało mniej niż **1 godzina** do deadline (16:50)!',
                minutesToDeadline
            };
        }

        if (minutesToDeadline >= 360) {
            // Więcej niż 6h - można wysłać pierwsze przypomnienie
            if (remindersCount === 0) {
                return {
                    canSend: true,
                    reason: '✅ Pierwsze przypomnienie (> 6h do deadline)',
                    minutesToDeadline,
                    reminderNumber: 1
                };
            } else {
                // Już wysłano przypomnienie w tym okresie
                const firstReminder = todayReminders[0];
                return {
                    canSend: false,
                    reason: `❌ Już wysłałeś przypomnienie dzisiaj o **${new Date(firstReminder.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}**.\n\nMożesz wysłać drugie przypomnienie po godzinie **10:50** (6h przed deadline).`,
                    minutesToDeadline
                };
            }
        }

        if (minutesToDeadline >= 60 && minutesToDeadline < 360) {
            // Między 1h a 6h - można wysłać drugie przypomnienie
            if (remindersCount === 0) {
                return {
                    canSend: true,
                    reason: '✅ Pierwsze przypomnienie (1-6h do deadline)',
                    minutesToDeadline,
                    reminderNumber: 1
                };
            } else if (remindersCount === 1) {
                return {
                    canSend: true,
                    reason: '✅ Drugie przypomnienie (1-6h do deadline)',
                    minutesToDeadline,
                    reminderNumber: 2
                };
            } else {
                // Już wysłano oba przypomnienia
                const firstReminder = todayReminders[0];
                const secondReminder = todayReminders[1];
                return {
                    canSend: false,
                    reason: `❌ Wykorzystałeś już oba dzienne przypomnienia:\n\n` +
                           `**1.** ${new Date(firstReminder.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })} (${firstReminder.minutesToDeadline} min do deadline)\n` +
                           `**2.** ${new Date(secondReminder.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })} (${secondReminder.minutesToDeadline} min do deadline)\n\n` +
                           `Możesz użyć komendy /remind maksymalnie **2 razy dziennie**.`,
                    minutesToDeadline
                };
            }
        }

        return {
            canSend: false,
            reason: '❌ Nieznany błąd weryfikacji limitu przypomnień.',
            minutesToDeadline
        };
    }

    /**
     * Rejestruje wysłanie przypomnienia przez użytkownika
     * @param {string} userId - ID użytkownika
     */
    async recordReminder(userId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const today = this.getTodayDate();
        const minutesToDeadline = this.getMinutesToDeadline();

        // Inicjalizacja danych użytkownika jeśli nie istnieją
        if (!this.usageData[userId]) {
            this.usageData[userId] = {
                totalReminders: 0,
                dailyReminders: {}
            };
        }

        const userData = this.usageData[userId];

        // Inicjalizacja dzisiejszych przypomnień jeśli nie istnieją
        if (!userData.dailyReminders[today]) {
            userData.dailyReminders[today] = [];
        }

        // Dodaj nowe przypomnienie
        userData.dailyReminders[today].push({
            timestamp: Date.now(),
            minutesToDeadline: minutesToDeadline
        });

        // Zwiększ całkowity licznik
        userData.totalReminders++;

        // Zapisz dane
        await this.saveUsageData();

        logger.info(`📝 Zarejestrowano przypomnienie dla użytkownika ${userId} (${userData.totalReminders} ogółem, ${userData.dailyReminders[today].length} dzisiaj)`);
    }

    /**
     * Pobiera całkowitą liczbę przypomnień dla użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {number}
     */
    async getTotalReminders(userId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        return this.usageData[userId]?.totalReminders || 0;
    }

    /**
     * Pobiera statystyki przypomnień dla wielu użytkowników
     * @param {Array<string>} userIds - Tablica ID użytkowników
     * @returns {Object} - Mapa userId -> liczba przypomnień
     */
    async getMultipleUserStats(userIds) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const stats = {};
        for (const userId of userIds) {
            stats[userId] = this.usageData[userId]?.totalReminders || 0;
        }

        return stats;
    }

    /**
     * Czyści stare dane przypomnień (starsze niż 30 dni)
     */
    async cleanupOldReminders() {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        const thirtyDaysAgo = new Date(polandTime);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let cleanedCount = 0;

        for (const userId in this.usageData) {
            const userData = this.usageData[userId];
            const dailyReminders = userData.dailyReminders;

            for (const date in dailyReminders) {
                const reminderDate = new Date(date);
                if (reminderDate < thirtyDaysAgo) {
                    delete dailyReminders[date];
                    cleanedCount++;
                }
            }
        }

        if (cleanedCount > 0) {
            await this.saveUsageData();
            logger.info(`🧹 Wyczyszczono ${cleanedCount} starych wpisów przypomnień (>30 dni)`);
        }
    }
}

module.exports = ReminderUsageService;
