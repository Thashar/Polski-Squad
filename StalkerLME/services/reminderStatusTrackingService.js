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
        const { reminderNumber, sentAt, users } = trackingData;

        // Posortuj użytkowników: najpierw niepotwierdzeni, potem potwierdzeni
        const sortedUsers = Object.entries(users).sort((a, b) => {
            if (a[1].confirmed === b[1].confirmed) return 0;
            return a[1].confirmed ? 1 : -1;
        });

        // Utwórz listę użytkowników
        let usersList = '';
        let confirmedCount = 0;
        let totalCount = sortedUsers.length;

        for (const [userId, userData] of sortedUsers) {
            const icon = userData.confirmed ? '✅' : '❌';
            usersList += `${icon} ${userData.displayName}\n`;
            if (userData.confirmed) confirmedCount++;
        }

        // Jeśli lista jest pusta
        if (usersList === '') {
            usersList = '*Brak użytkowników*';
        }

        const embed = new EmbedBuilder()
            .setTitle(`📊 Status potwierdzeń przypomnienia (${reminderNumber}/2)`)
            .setDescription(usersList)
            .setColor(reminderNumber === 1 ? '#FFA500' : '#FF0000')
            .addFields(
                { name: '📈 Postęp', value: `${confirmedCount}/${totalCount} potwierdzonych`, inline: true },
                { name: '📅 Wysłano', value: `<t:${Math.floor(sentAt / 1000)}:R>`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Przypomnienie ${reminderNumber}/2 • ${new Date(sentAt).toLocaleString('pl-PL', { timeZone: this.config.timezone })}` });

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
                    confirmedReminders: [] // array numerów remind które potwierdził [1] lub [1, 2]
                };
            }

            // Jeśli to drugi remind tego dnia
            if (reminderNumber === 2 && this.trackingData[trackingKey]) {
                // Zachowaj informacje o potwierdzeniach z pierwszego remind
                const oldTracking = this.trackingData[trackingKey];

                for (const [userId, userData] of Object.entries(oldTracking.users)) {
                    if (usersData[userId]) {
                        // Użytkownik był w pierwszym i jest w drugim remind
                        usersData[userId].confirmedReminders = userData.confirmedReminders;
                        // confirmed = false, bo czekamy na potwierdzenie drugiego remind
                        usersData[userId].confirmed = false;
                    }
                }

                // Usuń starą wiadomość trackingu
                try {
                    const channel = await guild.channels.fetch(oldTracking.channelId);
                    const oldMessage = await channel.messages.fetch(oldTracking.messageId);
                    await oldMessage.delete();
                    logger.info('[REMINDER-TRACKING] 🗑️ Usunięto starą wiadomość trackingu');
                } catch (error) {
                    logger.warn('[REMINDER-TRACKING] ⚠️ Nie udało się usunąć starej wiadomości:', error.message);
                }
            }

            // Pobierz kanał potwierdzenia
            const confirmationChannelId = this.config.confirmationChannels[roleId];
            const confirmationChannel = await guild.channels.fetch(confirmationChannelId);

            // Utwórz nowy tracking
            const newTracking = {
                messageId: null, // Zostanie ustawione po wysłaniu embeda
                channelId: confirmationChannelId,
                reminderNumber: reminderNumber,
                sentAt: Date.now(),
                users: usersData
            };

            // Utwórz embed
            const embed = this.createStatusEmbed(trackingKey, newTracking);

            // Wyślij embed
            const message = await confirmationChannel.send({ embeds: [embed] });
            newTracking.messageId = message.id;

            // Zapisz tracking
            this.trackingData[trackingKey] = newTracking;
            await this.saveTrackingData();

            logger.info(`[REMINDER-TRACKING] ✅ Utworzono tracking, messageId: ${message.id}`);

            return trackingKey;
        } catch (error) {
            logger.error('[REMINDER-TRACKING] ❌ Błąd tworzenia trackingu:', error);
            throw error;
        }
    }

    /**
     * Aktualizuje status użytkownika po potwierdzeniu
     */
    async updateUserStatus(userId, roleId) {
        try {
            const trackingKey = this.getTrackingKey(roleId);
            const tracking = this.trackingData[trackingKey];

            if (!tracking) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Brak trackingu dla ${trackingKey}`);
                return false;
            }

            if (!tracking.users[userId]) {
                logger.warn(`[REMINDER-TRACKING] ⚠️ Użytkownik ${userId} nie jest w trackingu`);
                return false;
            }

            // Dodaj numer remind do potwierdzonych
            const reminderNumber = tracking.reminderNumber;
            if (!tracking.users[userId].confirmedReminders.includes(reminderNumber)) {
                tracking.users[userId].confirmedReminders.push(reminderNumber);
            }

            // Oznacz jako confirmed tylko jeśli potwierdził bieżący remind
            tracking.users[userId].confirmed = true;

            logger.info(`[REMINDER-TRACKING] ✅ Zaktualizowano status użytkownika ${userId} w ${trackingKey}`);

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
