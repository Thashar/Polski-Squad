const { EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');

class ReminderStatusTrackingService {
    constructor(config) {
        this.config = config;
        this.trackingData = {}; // roleId_date → tracking data

        // Załaduj dane z pliku
        this.loadTrackingData();
    }

    /**
     * Ładuje dane trackingu z pliku
     */
    async loadTrackingData() {
        try {
            const data = await fs.readFile(this.config.database.reminderStatusTracking, 'utf8');
            this.trackingData = JSON.parse(data);
            logger.info('[REMINDER-TRACKING] 📂 Załadowano dane trackingu');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('[REMINDER-TRACKING] 📝 Brak pliku trackingu - utworzono nowy');
                this.trackingData = {};
                await this.saveTrackingData();
            } else {
                logger.error('[REMINDER-TRACKING] ❌ Błąd ładowania trackingu:', error);
            }
        }
    }

    /**
     * Zapisuje dane trackingu do pliku
     */
    async saveTrackingData() {
        try {
            await fs.writeFile(
                this.config.database.reminderStatusTracking,
                JSON.stringify(this.trackingData, null, 2),
                'utf8'
            );
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd zapisywania trackingu:', error);
        }
    }

    /**
     * Tworzy klucz trackingu (roleId_YYYY-MM-DD)
     */
    getTrackingKey(roleId) {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        const dateStr = polandTime.toISOString().split('T')[0]; // YYYY-MM-DD
        return `${roleId}_${dateStr}`;
    }

    /**
     * Tworzy embed ze statusem potwierdzeń
     */
    createStatusEmbed(trackingKey, trackingData) {
        const { reminders } = trackingData;

        const embed = new EmbedBuilder()
            .setTitle('📊 Status potwierdzeń przypomnienia')
            .setColor('#FFA500')
            .setTimestamp();

        let description = '';

        // Iteruj po wszystkich reminderach (1/2 i/lub 2/2)
        for (const reminder of reminders) {
            const { reminderNumber, sentAt, users } = reminder;

            // Nagłówek dla tego reminda
            description += `**Przypomnienie ${reminderNumber}/2** • Wysłano <t:${Math.floor(sentAt / 1000)}:R>\n`;

            // Posortuj użytkowników: najpierw potwierdzeni, potem niepotwierdzeni
            const sortedUsers = Object.entries(users).sort((a, b) => {
                if (a[1].confirmed === b[1].confirmed) return 0;
                return a[1].confirmed ? -1 : 1;
            });

            // Utwórz listę użytkowników
            let confirmedCount = 0;
            let totalCount = sortedUsers.length;

            for (const [userId, userData] of sortedUsers) {
                const icon = userData.confirmed ? '✅' : '❌';
                let line = `${icon} ${userData.displayName}`;

                // Dodaj godzinę potwierdzenia jeśli potwierdzone
                if (userData.confirmed && userData.confirmedAt) {
                    const confirmTime = new Date(userData.confirmedAt).toLocaleTimeString('pl-PL', {
                        timeZone: this.config.timezone,
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    line += ` • ${confirmTime}`;
                }

                description += line + '\n';
                if (userData.confirmed) confirmedCount++;
            }

            // Dodaj pustą linię między reminderami
            description += '\n';
        }

        embed.setDescription(description.trim());

        return embed;
    }

    /**
     * Tworzy lub aktualizuje tracking po wysłaniu remind
     */
    async createOrUpdateTracking(guild, roleId, users, reminderUsageService) {
        try {
            const trackingKey = this.getTrackingKey(roleId);

            // Sprawdź ile razy remind został użyty dzisiaj dla tej roli
            const usageData = await reminderUsageService.getReminderUsage(roleId);
            const reminderNumber = usageData.todayCount;

            logger.info(`[REMINDER-TRACKING] 📝 Tworzenie trackingu dla ${trackingKey}, remind ${reminderNumber}/2`);

            // Przygotuj dane użytkowników
            const usersData = {};
            for (const member of users) {
                usersData[member.id] = {
                    displayName: member.displayName,
                    confirmed: false,
                    confirmedAt: null
                };
            }

            // Pobierz kanał ostrzeżeń (tam gdzie lądują przypomnienia)
            const warningChannelId = this.config.warningChannels[roleId];
            const warningChannel = await guild.channels.fetch(warningChannelId);

            // Pobierz istniejący tracking lub utwórz nowy
            let tracking = this.trackingData[trackingKey];

            // Nowy reminder
            const newReminder = {
                reminderNumber: reminderNumber,
                sentAt: Date.now(),
                users: usersData
            };

            if (!tracking) {
                // Pierwszy remind - utwórz nowy tracking
                tracking = {
                    messageId: null,
                    channelId: warningChannelId,
                    reminders: [newReminder]
                };

                // Utwórz embed
                const embed = this.createStatusEmbed(trackingKey, tracking);

                // Wyślij embed
                const message = await warningChannel.send({ embeds: [embed] });
                tracking.messageId = message.id;

                // Zapisz tracking
                this.trackingData[trackingKey] = tracking;
                await this.saveTrackingData();

                logger.info(`[REMINDER-TRACKING] ✅ Utworzono nowy tracking, messageId: ${message.id}`);
            } else {
                // Drugi remind - dodaj do istniejącego trackingu
                tracking.reminders.push(newReminder);

                // Zapisz tracking
                this.trackingData[trackingKey] = tracking;
                await this.saveTrackingData();

                // Aktualizuj embed (dodaj drugą sekcję)
                await this.updateEmbed(trackingKey);

                logger.info(`[REMINDER-TRACKING] 📝 Dodano drugi remind do trackingu`);
            }

            return trackingKey;
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd tworzenia trackingu:', error);
            throw error;
        }
    }

    /**
     * Aktualizuje status użytkownika po potwierdzeniu
     */
    async updateUserStatus(userId, roleId, confirmationTimestamp) {
        try {
            const trackingKey = this.getTrackingKey(roleId);
            let tracking = this.trackingData[trackingKey];
            let actualTrackingKey = trackingKey;

            // Jeśli nie znaleziono po kluczu z roleId użytkownika (np. moderator z innego klanu),
            // przeszukaj wszystkie trackings z dziś i znajdź ten który zawiera userId
            if (!tracking) {
                const now = new Date();
                const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
                const dateStr = polandTime.toISOString().split('T')[0];

                for (const [key, data] of Object.entries(this.trackingData)) {
                    if (!key.endsWith(`_${dateStr}`)) continue;
                    const foundInKey = data.reminders.some(r => r.users[userId]);
                    if (foundInKey) {
                        tracking = data;
                        actualTrackingKey = key;
                        logger.info(`[REMINDER-TRACKING] 🔍 Znaleziono tracking po userId: ${key} (zamiast ${trackingKey})`);
                        break;
                    }
                }
            }

            if (!tracking) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Brak trackingu dla ${trackingKey} i nie znaleziono po userId ${userId}`);
                return false;
            }

            // Znajdź reminder zawierający userId (przeszukaj WSZYSTKIE, nie tylko najnowszy)
            let targetReminder = null;
            for (const reminder of tracking.reminders) {
                if (reminder.users[userId]) {
                    targetReminder = reminder;
                    // Nie przerywaj - jeśli jest w kilku reminderach, weź ostatni
                }
            }

            if (!targetReminder) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Użytkownik ${userId} nie jest w żadnym reminderze trackingu ${actualTrackingKey}`);
                return false;
            }

            // Oznacz jako confirmed i zapisz timestamp
            targetReminder.users[userId].confirmed = true;
            targetReminder.users[userId].confirmedAt = confirmationTimestamp;

            logger.info(`[REMINDER-TRACKING] ✅ Zaktualizowano status użytkownika ${userId} w ${actualTrackingKey} (remind ${targetReminder.reminderNumber})`);

            // Zapisz i aktualizuj embed
            await this.saveTrackingData();
            await this.updateEmbed(actualTrackingKey);

            return true;
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd aktualizacji statusu:', error);
            return false;
        }
    }

    /**
     * Aktualizuje embed na Discordzie
     */
    async updateEmbed(trackingKey) {
        try {
            const tracking = this.trackingData[trackingKey];

            if (!tracking || !tracking.messageId) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Brak messageId dla ${trackingKey}`);
                return;
            }

            // Pobierz kanał
            const channel = await global.stalkerClient.channels.fetch(tracking.channelId);

            // Usuń starą wiadomość
            try {
                const oldMessage = await channel.messages.fetch(tracking.messageId);
                await oldMessage.delete();
                logger.info(`[REMINDER-TRACKING] 🗑️ Usunięto stary embed`);
            } catch (error) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Nie udało się usunąć starego embeda: ${error.message}`);
            }

            // Utwórz zaktualizowany embed
            const embed = this.createStatusEmbed(trackingKey, tracking);

            // Wyślij nowy embed (na dole czatu)
            const newMessage = await channel.send({ embeds: [embed] });
            tracking.messageId = newMessage.id;

            // Zapisz nowy messageId
            await this.saveTrackingData();

            logger.info(`[REMINDER-TRACKING] 🔄 Zaktualizowano embed dla ${trackingKey} (nowy messageId: ${newMessage.id})`);
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd aktualizacji embeda:', error);
        }
    }
}

module.exports = ReminderStatusTrackingService;
