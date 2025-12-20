const { EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

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

            // Postęp dla tego reminda
            description += `📈 ${confirmedCount}/${totalCount} potwierdzonych\n\n`;
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

            // Pobierz kanał potwierdzenia
            const confirmationChannelId = this.config.confirmationChannels[roleId];
            const confirmationChannel = await guild.channels.fetch(confirmationChannelId);

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
                    channelId: confirmationChannelId,
                    reminders: [newReminder]
                };

                // Utwórz embed
                const embed = this.createStatusEmbed(trackingKey, tracking);

                // Wyślij embed
                const message = await confirmationChannel.send({ embeds: [embed] });
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
            const tracking = this.trackingData[trackingKey];

            if (!tracking) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Brak trackingu dla ${trackingKey}`);
                return false;
            }

            // Znajdź ostatni reminder (najnowszy)
            const latestReminder = tracking.reminders[tracking.reminders.length - 1];

            if (!latestReminder.users[userId]) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Użytkownik ${userId} nie jest w najnowszym reminderze`);
                return false;
            }

            // Oznacz jako confirmed i zapisz timestamp
            latestReminder.users[userId].confirmed = true;
            latestReminder.users[userId].confirmedAt = confirmationTimestamp;

            logger.info(`[REMINDER-TRACKING] ✅ Zaktualizowano status użytkownika ${userId} w ${trackingKey} (remind ${latestReminder.reminderNumber})`);

            // Zapisz i aktualizuj embed
            await this.saveTrackingData();
            await this.updateEmbed(trackingKey);

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

            // Pobierz wiadomość z Discorda
            const channel = await global.stalkerClient.channels.fetch(tracking.channelId);
            const message = await channel.messages.fetch(tracking.messageId);

            // Utwórz zaktualizowany embed
            const embed = this.createStatusEmbed(trackingKey, tracking);

            // Zaktualizuj wiadomość
            await message.edit({ embeds: [embed] });

            logger.info(`[REMINDER-TRACKING] 🔄 Zaktualizowano embed dla ${trackingKey}`);
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd aktualizacji embeda:', error);
        }
    }
}

module.exports = ReminderStatusTrackingService;
