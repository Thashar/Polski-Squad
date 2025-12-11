const { formatTimeDifference } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class TimerService {
    constructor(config, gameService) {
        this.config = config;
        this.gameService = gameService;
        this.client = null;
        this.passwordEmbedService = null;
    }

    /**
     * Pobiera aktualny czas w polskiej strefie czasowej
     * Uwaga: Ta metoda została zachowana dla kompatybilności, ale do obliczeń timestamp
     * używamy new Date() bezpośrednio, gdyż Date obiekty wewnętrznie przechowują czas UTC
     * @returns {Date} - Data w polskim czasie
     */
    getPolishTime() {
        const now = new Date(); // UTC timestamp
        return new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Ustawia passwordEmbedService
     * @param {PasswordEmbedService} passwordEmbedService - Serwis embeda
     */
    setPasswordEmbedService(passwordEmbedService) {
        this.passwordEmbedService = passwordEmbedService;
    }

    /**
     * Czyści wszystkie timery
     */
    clearAllTimers() {
        this.clearAutoResetTimer();
        this.clearReminderTimer();
        this.clearHintReminderTimer();
        this.clearPapalRoleRemovalTimer();
        this.clearFirstHintReminderTimer();
        this.clearSecondHintReminderTimer();
        this.clearRecurringReminderTimer();
        this.clearHintTimeoutTimer();
    }

    /**
     * Czyści timer automatycznego resetowania
     */
    clearAutoResetTimer() {
        if (this.gameService.autoResetTimer) {
            clearTimeout(this.gameService.autoResetTimer);
            this.gameService.autoResetTimer = null;
        }
    }

    /**
     * Czyści timer przypomnienia
     */
    clearReminderTimer() {
        if (this.gameService.reminderTimer) {
            clearTimeout(this.gameService.reminderTimer);
            this.gameService.reminderTimer = null;
        }
    }

    /**
     * Czyści timer przypomnienia o podpowiedzi
     */
    clearHintReminderTimer() {
        if (this.gameService.hintReminderTimer) {
            clearTimeout(this.gameService.hintReminderTimer);
            this.gameService.hintReminderTimer = null;
        }
    }

    /**
     * Czyści timer usuwania roli papieskiej
     */
    clearPapalRoleRemovalTimer() {
        if (this.gameService.papalRoleRemovalTimer) {
            clearTimeout(this.gameService.papalRoleRemovalTimer);
            this.gameService.papalRoleRemovalTimer = null;
        }
    }

    /**
     * Czyści pierwszy timer przypomnienia o podpowiedzi
     */
    clearFirstHintReminderTimer() {
        if (this.gameService.firstHintReminderTimer) {
            clearTimeout(this.gameService.firstHintReminderTimer);
            this.gameService.firstHintReminderTimer = null;
        }
    }

    /**
     * Czyści drugi timer przypomnienia o podpowiedzi
     */
    clearSecondHintReminderTimer() {
        if (this.gameService.secondHintReminderTimer) {
            clearTimeout(this.gameService.secondHintReminderTimer);
            this.gameService.secondHintReminderTimer = null;
        }
    }

    /**
     * Czyści timer powtarzających się przypomnień
     */
    clearRecurringReminderTimer() {
        if (this.gameService.recurringReminderTimer) {
            clearTimeout(this.gameService.recurringReminderTimer);
            this.gameService.recurringReminderTimer = null;
        }
    }

    /**
     * Czyści timer 24h timeout za brak podpowiedzi
     */
    clearHintTimeoutTimer() {
        if (this.gameService.hintTimeoutTimer) {
            clearTimeout(this.gameService.hintTimeoutTimer);
            this.gameService.hintTimeoutTimer = null;
        }
    }

    /**
     * Ustawia timer automatycznego resetowania
     */
    async setAutoResetTimer() {
        this.clearAutoResetTimer();
        if (this.gameService.trigger === null) {
            this.gameService.autoResetTimer = setTimeout(async () => {
                if (this.gameService.trigger === null) {
                    logger.info(`⏰ Auto-reset hasła po ${this.config.timers.autoResetMinutes} min bezczynności`);
                    this.gameService.resetToDefaultPassword();

                    try {
                        const guild = this.client.guilds.cache.first();
                        if (guild) {
                            await this.removeRoleFromAllMembers(guild, this.config.roles.papal);
                        }
                    } catch (error) {
                        logger.error('❌ Błąd podczas usuwania ról papieskich:', error);
                    }

                    try {
                        const startChannel = await this.client.channels.fetch(this.config.channels.start);

                        // Zaktualizuj embed
                        if (this.passwordEmbedService) {
                            await this.passwordEmbedService.updateEmbed(true);
                        }

                        if (startChannel && startChannel.isTextBased()) {
                            const message = this.config.messages.autoReset
                                .replace(/{emoji}/g, this.config.emojis.warning2)
                                .replace('{minutes}', this.config.timers.autoResetMinutes);
                            await startChannel.send(message);
                            await startChannel.send(`Napisz **"${this.config.messages.defaultPassword}"** by rozpocząć grę.`);
                        }
                    } catch (error) {
                        logger.error('❌ Błąd podczas automatycznego ustawiania hasła:', error);
                    }
                }
            }, this.gameService.AUTO_RESET_TIME);
            this.gameService.saveTriggerState();
        }
    }

    /**
     * Ustawia timer przypomnienia
     * @param {string} userId - ID użytkownika
     */
    async setReminderTimer(userId) {
        this.clearReminderTimer();
        this.gameService.reminderTimer = setTimeout(async () => {
            // Nie wysyłaj przypomnienia jeśli hasło to "Konklawe"
            if (this.gameService.trigger && this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
                return;
            }

            // Wyślij przypomnienie jeśli trigger === null (brak hasła)
            if (this.gameService.trigger === null) {
                try {
                    const reminderChannel = await this.client.channels.fetch(this.config.channels.reminder);
                    if (reminderChannel && reminderChannel.isTextBased()) {
                        await reminderChannel.send(`<@${userId}> Przypomnienie: Minęło już ${this.config.timers.reminderMinutes} minut, a nowe hasło konklawe nie zostało jeszcze ustawione! ⏰\nZa ${this.config.timers.autoResetMinutes - this.config.timers.reminderMinutes} minut hasło zostanie automatycznie ustawione na "${this.config.messages.defaultPassword}".`);
                    }
                } catch (error) {
                    logger.error('❌ Błąd podczas wysyłania przypomnienia:', error);
                }
            }
        }, this.gameService.REMINDER_TIME);
        this.gameService.saveTriggerState();
    }

    /**
     * Ustawia pierwszy timer przypomnienia o podpowiedzi
     */
    async setFirstHintReminder() {
        this.clearFirstHintReminderTimer();
        if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
            this.gameService.firstHintReminderTimer = setTimeout(async () => {
                if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.hints.length === 0) {
                    try {
                        const guild = this.client.guilds.cache.first();
                        const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                        if (guild && triggerChannel && triggerChannel.isTextBased()) {
                            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));
                            if (membersWithRole.size > 0) {
                                const papalMember = membersWithRole.first();
                                const timeSincePassword = new Date() - this.gameService.triggerSetTimestamp;
                                const timeText = formatTimeDifference(timeSincePassword);
                                await triggerChannel.send(`<@${papalMember.user.id}> ⚠️ Przypomnienie: Minęło już **${timeText}** od ustawienia hasła. Dodaj podpowiedź dla graczy. 💡`);
                                await this.setSecondHintReminder();
                            }
                        }
                    } catch (error) {
                        logger.error('Błąd podczas wysyłania pierwszego przypomnienia o podpowiedzi:', error);
                    }
                }
            }, this.gameService.FIRST_HINT_REMINDER_TIME);
            this.gameService.saveTriggerState();
        }
    }

    /**
     * Ustawia drugi timer przypomnienia o podpowiedzi
     */
    async setSecondHintReminder() {
        this.clearSecondHintReminderTimer();
        // Czas od pierwszego do drugiego przypomnienia (15 minut)
        const timeUntilSecondReminder = this.gameService.SECOND_HINT_REMINDER_TIME - this.gameService.FIRST_HINT_REMINDER_TIME;
        this.gameService.secondHintReminderTimer = setTimeout(async () => {
            if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.hints.length === 0) {
                try {
                    const guild = this.client.guilds.cache.first();
                    const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                    if (guild && triggerChannel && triggerChannel.isTextBased()) {
                        const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));
                        if (membersWithRole.size > 0) {
                            const papalMember = membersWithRole.first();
                            const timeSincePassword = new Date() - this.gameService.triggerSetTimestamp;
                            const timeText = formatTimeDifference(timeSincePassword);
                            await triggerChannel.send(`<@${papalMember.user.id}> ⚠️ Drugie przypomnienie: Minęło już **${timeText}** od ustawienia hasła bez podpowiedzi. Za **30 minut** stracisz rolę papieską! 🚨`);
                            await this.setPapalRoleRemovalForNoHints(papalMember.user.id);
                            await this.setRecurringReminders(papalMember.user.id);
                        }
                    }
                } catch (error) {
                    logger.error('Błąd podczas wysyłania drugiego przypomnienia o podpowiedzi:', error);
                }
            }
        }, timeUntilSecondReminder);
        this.gameService.saveTriggerState();
    }

    /**
     * Ustawia powtarzające się przypomnienia
     * @param {string} userId - ID użytkownika
     */
    async setRecurringReminders(userId) {
        this.clearRecurringReminderTimer();
        this.gameService.recurringReminderTimer = setTimeout(async () => {
            if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.hints.length === 0) {
                try {
                    const guild = this.client.guilds.cache.first();
                    const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                    if (guild && triggerChannel && triggerChannel.isTextBased()) {
                        const member = guild.members.cache.get(userId);
                        if (member && member.roles.cache.has(this.config.roles.papal)) {
                            const timeSincePassword = new Date() - this.gameService.triggerSetTimestamp;
                            const timeText = formatTimeDifference(timeSincePassword);
                            await triggerChannel.send(`<@${userId}> ⚠️ Ostatnie ostrzeżenie! Czas bez podpowiedzi: **${timeText}**. Za **15 minut** stracisz rolę papieską! 🚨`);
                            await this.setRecurringReminders(userId);
                        }
                    }
                } catch (error) {
                    logger.error('Błąd podczas wysyłania powtarzającego się przypomnienia:', error);
                }
            }
        }, this.gameService.RECURRING_REMINDER_TIME);
        this.gameService.saveTriggerState();
    }

    /**
     * Ustawia timer usuwania roli papieskiej za brak podpowiedzi
     * @param {string} userId - ID użytkownika
     */
    async setPapalRoleRemovalForNoHints(userId) {
        this.clearPapalRoleRemovalTimer();
        this.gameService.papalRoleRemovalTimer = setTimeout(async () => {
            if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.hints.length === 0) {
                try {
                    const guild = this.client.guilds.cache.first();
                    if (guild) {
                        const member = guild.members.cache.get(userId);
                        if (member && member.roles.cache.has(this.config.roles.papal)) {
                            await member.roles.remove(this.config.roles.papal);
                            logger.info(`Usunięto rolę papieską użytkownikowi ${member.user.tag} za brak podpowiedzi przez godzinę`);
                            await this.resetToDefaultPassword('1h');
                        }
                    }
                } catch (error) {
                    logger.error('Błąd podczas usuwania roli papieskiej za brak podpowiedzi:', error);
                }
            }
        }, this.gameService.SECOND_HINT_REMINDER_TIME);
        this.gameService.saveTriggerState();
    }

    /**
     * Ustawia timer przypomnienia o kolejnej podpowiedzi
     */
    async setHintReminderTimer() {
        this.clearHintReminderTimer();
        if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
            this.gameService.hintReminderTimer = setTimeout(async () => {
                if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
                    try {
                        const guild = this.client.guilds.cache.first();
                        const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                        if (guild && triggerChannel && triggerChannel.isTextBased()) {
                            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));
                            if (membersWithRole.size > 0) {
                                const papalMember = membersWithRole.first();
                                const timeSinceLastHint = new Date() - this.gameService.lastHintTimestamp;
                                const timeText = formatTimeDifference(timeSinceLastHint);
                                await triggerChannel.send(`<@${papalMember.user.id}> Przypomnienie: Minęło już **${timeText}** od ostatniej podpowiedzi! Dodaj nową podpowiedź dla graczy! Po 24h nieaktywności hasło automatycznie zostanie ustawione jako Konklawe, a Ty stracisz rolę papieską! 💡`);
                                await this.setHintReminderTimer();
                                await this.setHintTimeoutTimer(); // Ustaw 24h timer
                            }
                        }
                    } catch (error) {
                        logger.error('Błąd podczas wysyłania przypomnienia o kolejnej podpowiedzi:', error);
                    }
                }
            }, this.gameService.EXISTING_HINT_REMINDER_TIME);
            this.gameService.saveTriggerState();
        }
    }

    /**
     * Ustawia timer 24h timeout za brak nowej podpowiedzi
     */
    async setHintTimeoutTimer() {
        this.clearHintTimeoutTimer();

        if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.lastHintTimestamp) {

            // Oblicz ile czasu już minęło od ostatniej podpowiedzi
            const now = new Date();
            const timeSinceLastHint = now - this.gameService.lastHintTimestamp;
            const timeUntilTimeout = this.gameService.HINT_TIMEOUT_TIME - timeSinceLastHint;

            // Jeśli już minęło 24h, usuń rolę natychmiast
            if (timeUntilTimeout <= 0) {
                logger.info('⚠️ Już minęło 24h bez nowej podpowiedzi - usuwanie roli papieskiej natychmiast');
                try {
                    const guild = this.client.guilds.cache.first();
                    if (guild) {
                        // Odśwież cache ról i członków przed sprawdzeniem
                        await guild.roles.fetch();
                        await guild.members.fetch();

                        const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));

                        if (membersWithRole.size > 0) {
                            const papalMember = membersWithRole.first();
                            await papalMember.roles.remove(this.config.roles.papal);
                            logger.info(`Usunięto rolę papieską użytkownikowi ${papalMember.user.tag} za brak nowej podpowiedzi przez 24 godziny`);
                            await this.resetToDefaultPassword('24h');
                        }
                    }
                } catch (error) {
                    logger.error('Błąd podczas usuwania roli papieskiej za brak nowej podpowiedzi:', error);
                }
                return;
            }

            // Ustaw timer na pozostały czas
            this.gameService.hintTimeoutTimer = setTimeout(async () => {
                if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
                    try {
                        const guild = this.client.guilds.cache.first();
                        if (guild) {
                            // Odśwież cache ról i członków przed sprawdzeniem
                            await guild.roles.fetch();
                            await guild.members.fetch();

                            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));

                            if (membersWithRole.size > 0) {
                                const papalMember = membersWithRole.first();
                                await papalMember.roles.remove(this.config.roles.papal);
                                logger.info(`Usunięto rolę papieską użytkownikowi ${papalMember.user.tag} za brak nowej podpowiedzi przez 24 godziny`);
                                await this.resetToDefaultPassword('24h');
                            }
                        }
                    } catch (error) {
                        logger.error('Błąd podczas usuwania roli papieskiej za brak nowej podpowiedzi:', error);
                    }
                }
            }, timeUntilTimeout);
            this.gameService.saveTriggerState();
        }
    }

    /**
     * Resetuje hasło na domyślne
     * @param {string} reason - Powód resetowania ('1h' lub '24h')
     */
    async resetToDefaultPassword(reason = '1h') {
        try {
            const guild = this.client.guilds.cache.first();
            const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
            const startChannel = await this.client.channels.fetch(this.config.channels.start);

            this.gameService.resetToDefaultPassword();

            // Zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(true);
            }

            if (startChannel && startChannel.isTextBased()) {
                if (reason === '24h') {
                    await startChannel.send(`🚨 **Rola papieska została usunięta** za brak nowej podpowiedzi przez 24 godziny!`);
                } else {
                    await startChannel.send(`🚨 **Rola papieska została usunięta** za brak podpowiedzi przez godzinę!`);
                }
                await startChannel.send(`Hasło zostało automatycznie ustawione na "${this.config.messages.defaultPassword}". Napisz **"${this.config.messages.defaultPassword}"** by rozpocząć grę.`);
            }

            logger.info(`Zresetowano hasło na domyślne po usunięciu roli papieskiej (powód: ${reason})`);
        } catch (error) {
            logger.error('Błąd podczas resetowania hasła:', error);
        }
    }

    /**
     * Usuwa rolę wszystkim członkom
     * @param {Guild} guild - Serwer Discord
     * @param {string} roleId - ID roli
     */
    async removeRoleFromAllMembers(guild, roleId) {
        try {
            logger.info(`Rozpoczynam usuwanie roli ${roleId} wszystkim użytkownikom...`);
            const allMembers = await guild.members.fetch();
            const membersWithRole = allMembers.filter(member => member.roles.cache.has(roleId));
            logger.info(`Znaleziono ${membersWithRole.size} użytkowników z rolą ${roleId}`);

            if (membersWithRole.size === 0) {
                logger.info(`Brak użytkowników z rolą ${roleId} do usunięcia`);
                return;
            }

            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.roles.remove(roleId);
                    logger.info(`✅ Usunięto rolę ${roleId} od ${member.user.tag}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    logger.error(`❌ Błąd usuwania roli ${roleId} od ${member.user.tag}:`, err);
                }
            }
            logger.info(`✅ Zakończono usuwanie roli ${roleId} wszystkim użytkownikom`);
        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania ról ${roleId}:`, error);
        }
    }

    /**
     * Przywraca timery po restarcie bota
     * ZASADA: Resetuj timery od początku gdy brak hasła lub brak podpowiedzi
     */
    async restoreRemindersAfterRestart() {
        // Trigger === null jest obsłużony w index.js (setAutoResetTimer + setReminderTimer)
        if (!this.gameService.trigger) {
            return;
        }

        // Hasło domyślne "Konklawe" - brak timerów
        if (this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
            logger.info('ℹ️ Restart: hasło domyślne "Konklawe" - brak timerów');
            return;
        }

        // SCENARIUSZ 1: Hasło ustawione, BRAK podpowiedzi → RESETUJ timery od początku
        if (this.gameService.hints.length === 0) {
            logger.info('🔄 Restart: hasło bez podpowiedzi - resetowanie timerów od POCZĄTKU');

            // RESETUJ triggerSetTimestamp na teraz (aby timery były liczone od restartu)
            this.gameService.triggerSetTimestamp = new Date();
            this.gameService.saveTriggerState();

            // Ustaw timery od początku (15 min, 30 min, 60 min od TERAZ)
            await this.setFirstHintReminder();
            logger.info('✅ Timery przypominania o podpowiedziach zresetowane od początku');
            return;
        }

        // SCENARIUSZ 2: Hasło + są podpowiedzi → odtwórz na podstawie lastHintTimestamp
        if (this.gameService.lastHintTimestamp) {
            logger.info('♻️ Restart: odtwarzanie timerów na podstawie lastHintTimestamp');
            const now = new Date();
            const timeSinceLastHint = now - this.gameService.lastHintTimestamp;

            // Timer 6h dla przypomnienia o kolejnej podpowiedzi
            if (timeSinceLastHint >= this.gameService.EXISTING_HINT_REMINDER_TIME) {
                // Już minęło 6h - wyślij przypomnienie natychmiast
                try {
                    const guild = this.client.guilds.cache.first();
                    const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                    if (guild && triggerChannel && triggerChannel.isTextBased()) {
                        const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));
                        if (membersWithRole.size > 0) {
                            const papalMember = membersWithRole.first();
                            const timeText = formatTimeDifference(timeSinceLastHint);
                            await triggerChannel.send(`<@${papalMember.user.id}> Przypomnienie: Minęło już **${timeText}** od ostatniej podpowiedzi! Dodaj nową podpowiedź dla graczy! Po 24h nieaktywności hasło automatycznie zostanie ustawione jako Konklawe, a Ty stracisz rolę papieską! 💡`);
                            // Ustaw kolejny timer
                            await this.setHintReminderTimer();
                        }
                    }
                } catch (error) {
                    logger.error('Błąd podczas wysyłania przypomnienia o kolejnej podpowiedzi po restarcie:', error);
                }
            } else {
                // Ustaw timer na pozostały czas do wysłania przypomnienia
                const remainingTime = this.gameService.EXISTING_HINT_REMINDER_TIME - timeSinceLastHint;
                this.gameService.hintReminderTimer = setTimeout(async () => {
                    try {
                        const guild = this.client.guilds.cache.first();
                        const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                        if (guild && triggerChannel && triggerChannel.isTextBased()) {
                            const membersWithRole = guild.members.cache.filter(member => member.roles.cache.has(this.config.roles.papal));
                            if (membersWithRole.size > 0) {
                                const papalMember = membersWithRole.first();
                                const timeSinceLastHint = new Date() - this.gameService.lastHintTimestamp;
                                const timeText = formatTimeDifference(timeSinceLastHint);
                                await triggerChannel.send(`<@${papalMember.user.id}> Przypomnienie: Minęło już **${timeText}** od ostatniej podpowiedzi! Dodaj nową podpowiedź dla graczy! Po 24h nieaktywności hasło automatycznie zostanie ustawione jako Konklawe, a Ty stracisz rolę papieską! 💡`);
                                // Ustaw kolejny timer
                                await this.setHintReminderTimer();
                            }
                        }
                    } catch (error) {
                        logger.error('Błąd podczas wysyłania przypomnienia o kolejnej podpowiedzi:', error);
                    }
                }, remainingTime);
            }

            // Timer 24h dla usunięcia roli za brak nowej podpowiedzi
            if (timeSinceLastHint >= this.gameService.HINT_TIMEOUT_TIME) {
                // Już minęło 24h - usuń rolę natychmiast
                logger.info('⚠️ Minęło 24h bez nowej podpowiedzi - usuwanie roli papieskiej');

                const guild = this.client.guilds.cache.first();
                if (guild) {
                    // Odśwież cache ról i członków
                    await guild.roles.fetch();
                    await guild.members.fetch();

                    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(this.config.roles.papal));

                    if (membersWithRole.size > 0) {
                        const papalMember = membersWithRole.first();
                        try {
                            await papalMember.roles.remove(this.config.roles.papal);
                            logger.info(`✅ Usunięto rolę papieską użytkownikowi ${papalMember.user.tag} za brak nowej podpowiedzi przez 24 godziny`);
                            await this.resetToDefaultPassword('24h');
                        } catch (error) {
                            logger.error(`❌ Błąd podczas usuwania roli papieskiej: ${error.message}`);
                        }
                    } else {
                        logger.info('ℹ️ Brak użytkowników z rolą papieską do usunięcia');
                    }
                }
            } else {
                // Ustaw timer 24h bezpośrednio na pozostały czas
                await this.setHintTimeoutTimer();
            }
        }
    }
}

module.exports = TimerService;