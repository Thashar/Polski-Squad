const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');

class ReminderUsageService {
    constructor(config) {
        this.config = config;
        this.dataPath = path.join(__dirname, '../data/reminder_usage.json');
        this.usageData = null;
    }

    /**
     * Ładuje dane o przypomnieniach z pliku
     * @returns {Promise<Object>} - Obiekt z danymi
     */
    async loadUsageData() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            this.usageData = JSON.parse(data);

            // Migracja danych ze starej struktury do nowej
            if (!this.usageData.senders || !this.usageData.receivers) {
                logger.info('🔄 Wykryto starą strukturę danych, przeprowadzam migrację...');

                const oldData = this.usageData;
                this.usageData = {
                    senders: {},   // Nowa struktura - limity per klan
                    receivers: {}  // Nowa struktura - pingi per użytkownik
                };

                // Jeśli były jakieś stare dane, zapisz je jako receivers (założenie że to były dane użytkowników)
                // Ale w praktyce najlepiej zacząć od czystego stanu
                await this.saveUsageData();
                logger.info('✅ Migracja zakończona - rozpoczynam z czystymi danymi');
            } else {
                logger.info('✅ Załadowano dane przypomnień (limity + pingi)');
            }

            return this.usageData;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje, utworzenie nowego
                this.usageData = {
                    senders: {},  // Kto wysyłał /remind (limity czasowe)
                    receivers: {} // Kto był pingowany (statystyki)
                };
                await this.saveUsageData();
                logger.info('📝 Utworzono nowy plik danych przypomnień');
                return this.usageData;
            }

            logger.error('❌ Błąd ładowania danych przypomnień:', error.message);
            this.usageData = {
                senders: {},
                receivers: {}
            };
            return this.usageData;
        }
    }

    /**
     * Zapisuje dane o przypomnieniach do pliku
     */
    async saveUsageData() {
        try {
            // Upewnij się, że katalog istnieje
            const dir = path.dirname(this.dataPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(this.dataPath, JSON.stringify(this.usageData, null, 2), 'utf8');
            logger.info('💾 Zapisano dane przypomnień');
        } catch (error) {
            logger.error('❌ Błąd zapisu danych przypomnień:', error.message);
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
     * Sprawdza czy klan może wysłać /remind (limity czasowe PER KLAN)
     * @param {string} roleId - ID roli (klanu)
     * @returns {Object} - { canSend: boolean, reason: string, minutesToDeadline: number }
     */
    async canSendReminder(roleId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const minutesToDeadline = this.getMinutesToDeadline();
        const today = this.getTodayDate();

        // Inicjalizacja danych klanu jeśli nie istnieją
        if (!this.usageData.senders[roleId]) {
            this.usageData.senders[roleId] = {
                totalSent: 0,
                dailyUsage: {}
            };
        }

        const clanData = this.usageData.senders[roleId];
        const todayUsage = clanData.dailyUsage[today] || [];

        // Sprawdź ile razy KLAN użył /remind dzisiaj
        const usageCount = todayUsage.length;

        // Logika limitów:
        // - Więcej niż 6h (>360 min) - za wcześnie, blokada
        // - Między 2h a 6h (120-360 min) - można wysłać PIERWSZE przypomnienie
        // - Między 1h a 2h (60-120 min) - można wysłać DRUGIE przypomnienie
        // - Mniej niż 1h (0-60 min) - tylko catch-up dla pierwszego, drugie zablokowane
        // - Po deadline (<0 min) - blokada

        if (minutesToDeadline < 0) {
            return {
                canSend: false,
                reason: '❌ Nie można wysłać przypomnienia - deadline już minął (17:50)!',
                minutesToDeadline
            };
        }

        if (minutesToDeadline >= 360) {
            // Więcej niż 6h - za wcześnie
            const hoursUntilWindow = Math.floor((minutesToDeadline - 360) / 60);
            const minutesUntilWindow = (minutesToDeadline - 360) % 60;
            let timeStr = '';
            if (hoursUntilWindow > 0) {
                timeStr = `${hoursUntilWindow}h ${minutesUntilWindow}m`;
            } else {
                timeStr = `${minutesUntilWindow}m`;
            }

            return {
                canSend: false,
                reason: `❌ Za wcześnie! Możesz użyć /remind dopiero w **ostatnich 6 godzinach** przed deadline.\n\nOkno na przypomnienia otwiera się o **11:50**.\nDo otwarcia okna zostało: **${timeStr}**`,
                minutesToDeadline
            };
        }

        if (minutesToDeadline >= 120 && minutesToDeadline < 360) {
            // Między 2h a 6h - można wysłać PIERWSZE przypomnienie
            if (usageCount === 0) {
                return {
                    canSend: true,
                    reason: '✅ Pierwsze przypomnienie (6h-2h przed deadline)',
                    minutesToDeadline,
                    reminderNumber: 1
                };
            } else if (usageCount === 1) {
                // Już wysłano pierwsze, ale jest jeszcze miejsce na drugie
                const firstUsage = todayUsage[0];
                const senderMention = firstUsage.sentBy ? ` przez <@${firstUsage.sentBy}>` : '';
                return {
                    canSend: false,
                    reason: `✅ Pierwsze przypomnienie już wysłane o **${new Date(firstUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}**${senderMention}.\n\nDrugie przypomnienie klan może wysłać w **oknie 1h-2h przed deadline** (15:50-16:50).`,
                    minutesToDeadline
                };
            } else {
                // Już wysłano oba przypomnienia
                const firstUsage = todayUsage[0];
                const secondUsage = todayUsage[1];
                const sender1 = firstUsage.sentBy ? ` - <@${firstUsage.sentBy}>` : '';
                const sender2 = secondUsage.sentBy ? ` - <@${secondUsage.sentBy}>` : '';
                return {
                    canSend: false,
                    reason: `❌ Klan wykorzystał już oba dzienne przypomnienia:\n\n` +
                           `**1.** ${new Date(firstUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender1} (${firstUsage.minutesToDeadline} min do deadline)\n` +
                           `**2.** ${new Date(secondUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender2} (${secondUsage.minutesToDeadline} min do deadline)\n\n` +
                           `Każdy klan może użyć komendy /remind maksymalnie **2 razy dziennie**.`,
                    minutesToDeadline
                };
            }
        }

        if (minutesToDeadline >= 60 && minutesToDeadline < 120) {
            // Między 1h a 2h - można wysłać DRUGIE przypomnienie
            if (usageCount === 0) {
                return {
                    canSend: true,
                    reason: '✅ Pierwsze przypomnienie (okno 1h-2h przed deadline)',
                    minutesToDeadline,
                    reminderNumber: 1
                };
            } else if (usageCount === 1) {
                return {
                    canSend: true,
                    reason: '✅ Drugie przypomnienie (okno 1h-2h przed deadline)',
                    minutesToDeadline,
                    reminderNumber: 2
                };
            } else {
                // Już wysłano oba przypomnienia
                const firstUsage = todayUsage[0];
                const secondUsage = todayUsage[1];
                const sender1 = firstUsage.sentBy ? ` - <@${firstUsage.sentBy}>` : '';
                const sender2 = secondUsage.sentBy ? ` - <@${secondUsage.sentBy}>` : '';
                return {
                    canSend: false,
                    reason: `❌ Klan wykorzystał już oba dzienne przypomnienia:\n\n` +
                           `**1.** ${new Date(firstUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender1} (${firstUsage.minutesToDeadline} min do deadline)\n` +
                           `**2.** ${new Date(secondUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender2} (${secondUsage.minutesToDeadline} min do deadline)\n\n` +
                           `Każdy klan może użyć komendy /remind maksymalnie **2 razy dziennie**.`,
                    minutesToDeadline
                };
            }
        }

        if (minutesToDeadline >= 0 && minutesToDeadline < 60) {
            // Ostatnia godzina - catch-up dla pierwszego, drugie zablokowane (okno 15:50-16:50 minęło)
            if (usageCount === 0) {
                return {
                    canSend: true,
                    reason: '✅ Pierwsze przypomnienie (ostatnia godzina przed deadline)',
                    minutesToDeadline,
                    reminderNumber: 1
                };
            } else if (usageCount === 1) {
                const firstUsage = todayUsage[0];
                const senderMention = firstUsage.sentBy ? ` przez <@${firstUsage.sentBy}>` : '';
                return {
                    canSend: false,
                    reason: `✅ Pierwsze przypomnienie już wysłane o **${new Date(firstUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}**${senderMention}.\n\n❌ Okno na drugie przypomnienie (15:50-16:50) już minęło.`,
                    minutesToDeadline
                };
            } else {
                // Już wysłano oba przypomnienia
                const firstUsage = todayUsage[0];
                const secondUsage = todayUsage[1];
                const sender1 = firstUsage.sentBy ? ` - <@${firstUsage.sentBy}>` : '';
                const sender2 = secondUsage.sentBy ? ` - <@${secondUsage.sentBy}>` : '';
                return {
                    canSend: false,
                    reason: `❌ Klan wykorzystał już oba dzienne przypomnienia:\n\n` +
                           `**1.** ${new Date(firstUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender1} (${firstUsage.minutesToDeadline} min do deadline)\n` +
                           `**2.** ${new Date(secondUsage.timestamp).toLocaleTimeString('pl-PL', { timeZone: this.config.timezone })}${sender2} (${secondUsage.minutesToDeadline} min do deadline)\n\n` +
                           `Każdy klan może użyć komendy /remind maksymalnie **2 razy dziennie**.`,
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
     * Rejestruje użycie /remind przez klan (dla limitów czasowych)
     * @param {string} roleId - ID roli (klanu)
     * @param {string} senderId - ID użytkownika który wysłał komendę
     */
    async recordRoleUsage(roleId, senderId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const today = this.getTodayDate();
        const minutesToDeadline = this.getMinutesToDeadline();

        // Inicjalizacja danych klanu jeśli nie istnieją
        if (!this.usageData.senders[roleId]) {
            this.usageData.senders[roleId] = {
                totalSent: 0,
                dailyUsage: {}
            };
        }

        const clanData = this.usageData.senders[roleId];

        // Inicjalizacja dzisiejszego użycia jeśli nie istnieje
        if (!clanData.dailyUsage[today]) {
            clanData.dailyUsage[today] = [];
        }

        // Dodaj nowe użycie
        clanData.dailyUsage[today].push({
            timestamp: Date.now(),
            minutesToDeadline: minutesToDeadline,
            sentBy: senderId
        });

        // Zwiększ całkowity licznik
        clanData.totalSent++;

        logger.info(`📤 Zarejestrowano użycie /remind dla klanu ${roleId} przez użytkownika ${senderId} (${clanData.totalSent} ogółem dla klanu)`);
    }

    /**
     * Pobiera informacje o użyciu remind dla danej roli (klanu) dzisiaj
     * @param {string} roleId - ID roli (klanu)
     * @returns {Promise<Object>} - { todayCount: number, todayUsage: Array }
     */
    async getReminderUsage(roleId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const today = this.getTodayDate();

        // Inicjalizacja danych klanu jeśli nie istnieją
        if (!this.usageData.senders[roleId]) {
            return {
                todayCount: 0,
                todayUsage: []
            };
        }

        const clanData = this.usageData.senders[roleId];
        const todayUsage = clanData.dailyUsage[today] || [];

        return {
            todayCount: todayUsage.length,
            todayUsage: todayUsage
        };
    }

    /**
     * Rejestruje pingi do użytkowników (dla statystyk w /debug-roles)
     * @param {Array<Object>} foundUsers - Tablica obiektów { member, matchedName }
     */
    async recordPingedUsers(foundUsers) {
        try {
            if (!this.usageData) {
                await this.loadUsageData();
            }

            const today = this.getTodayDate();
            const timestamp = Date.now();

            logger.info(`[REMIND-STATS] 📝 Rozpoczynam zapisywanie ${foundUsers.length} pingów`);

            for (const userData of foundUsers) {
                try {
                    const userId = userData.member.id;

                    // Inicjalizacja danych odbiorcy jeśli nie istnieją
                    if (!this.usageData.receivers[userId]) {
                        this.usageData.receivers[userId] = {
                            totalPings: 0,
                            dailyPings: {}
                        };
                    }

                    const receiverData = this.usageData.receivers[userId];

                    // Inicjalizacja dzisiejszych pingów jeśli nie istnieją
                    if (!receiverData.dailyPings[today]) {
                        receiverData.dailyPings[today] = [];
                    }

                    // Dodaj nowy ping
                    receiverData.dailyPings[today].push({
                        timestamp: timestamp,
                        matchedName: userData.matchedName
                    });

                    // Zwiększ całkowity licznik
                    receiverData.totalPings++;

                    logger.info(`[REMIND-STATS] 📢 Zarejestrowano ping dla użytkownika ${userData.member.displayName} (${userId}), ogółem: ${receiverData.totalPings}`);
                } catch (error) {
                    logger.error(`[REMIND-STATS] ❌ Błąd rejestrowania pingu dla użytkownika:`, error.message);
                }
            }

            // Zapisz dane
            await this.saveUsageData();
            logger.info(`[REMIND-STATS] ✅ Zapisano ${foundUsers.length} pingów do bazy danych`);
        } catch (error) {
            logger.error(`[REMIND-STATS] ❌ Błąd zapisywania statystyk pingów:`, error);
            throw error;
        }
    }

    /**
     * Pobiera całkowitą liczbę pingów dla użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {number}
     */
    async getTotalPings(userId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        return this.usageData.receivers[userId]?.totalPings || 0;
    }

    /**
     * Pobiera statystyki pingów dla wielu użytkowników (do wyświetlenia w /debug-roles)
     * @param {Array<string>} userIds - Tablica ID użytkowników
     * @returns {Object} - Mapa userId -> liczba pingów
     */
    async getMultipleUserStats(userIds) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const stats = {};
        for (const userId of userIds) {
            stats[userId] = this.usageData.receivers[userId]?.totalPings || 0;
        }

        return stats;
    }

    /**
     * Pobiera dane przypomień dla pojedynczego użytkownika (dla AI Chat)
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - Dane użytkownika lub null
     */
    async getUserReminderData(userId) {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const receiverData = this.usageData.receivers[userId];
        if (!receiverData) {
            return null;
        }

        return {
            totalPings: receiverData.totalPings || 0,
            // Dodatkowe dane mogą być tutaj dodane gdy będą dostępne
        };
    }

    /**
     * Czyści stare dane (starsze niż 30 dni)
     */
    async cleanupOldData() {
        if (!this.usageData) {
            await this.loadUsageData();
        }

        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        const thirtyDaysAgo = new Date(polandTime);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let cleanedCount = 0;

        // Czyść dane nadawców (limity czasowe)
        for (const userId in this.usageData.senders) {
            const senderData = this.usageData.senders[userId];
            const dailyUsage = senderData.dailyUsage;

            for (const date in dailyUsage) {
                const usageDate = new Date(date);
                if (usageDate < thirtyDaysAgo) {
                    delete dailyUsage[date];
                    cleanedCount++;
                }
            }
        }

        // Czyść dane odbiorców (pingi) - TYLKO szczegóły, NIE totalPings!
        for (const userId in this.usageData.receivers) {
            const receiverData = this.usageData.receivers[userId];
            const dailyPings = receiverData.dailyPings;

            for (const date in dailyPings) {
                const pingDate = new Date(date);
                if (pingDate < thirtyDaysAgo) {
                    delete dailyPings[date];
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
