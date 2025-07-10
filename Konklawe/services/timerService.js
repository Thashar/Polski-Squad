const { formatTimeDifference } = require('../utils/helpers');

class TimerService {
    constructor(config, gameService) {
        this.config = config;
        this.gameService = gameService;
        this.client = null;
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
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
        console.log('🔴 Wyczyszczono wszystkie timery');
    }

    /**
     * Czyści timer automatycznego resetowania
     */
    clearAutoResetTimer() {
        if (this.gameService.autoResetTimer) {
            clearTimeout(this.gameService.autoResetTimer);
            this.gameService.autoResetTimer = null;
            console.log('🔴 Wyczyszczono autoResetTimer');
        }
    }

    /**
     * Czyści timer przypomnienia
     */
    clearReminderTimer() {
        if (this.gameService.reminderTimer) {
            clearTimeout(this.gameService.reminderTimer);
            this.gameService.reminderTimer = null;
            console.log('🔴 Wyczyszczono reminderTimer');
        }
    }

    /**
     * Czyści timer przypomnienia o podpowiedzi
     */
    clearHintReminderTimer() {
        if (this.gameService.hintReminderTimer) {
            clearTimeout(this.gameService.hintReminderTimer);
            this.gameService.hintReminderTimer = null;
            console.log('🔴 Wyczyszczono hintReminderTimer');
        }
    }

    /**
     * Czyści timer usuwania roli papieskiej
     */
    clearPapalRoleRemovalTimer() {
        if (this.gameService.papalRoleRemovalTimer) {
            clearTimeout(this.gameService.papalRoleRemovalTimer);
            this.gameService.papalRoleRemovalTimer = null;
            console.log('🔴 Wyczyszczono papalRoleRemovalTimer');
        }
    }

    /**
     * Czyści pierwszy timer przypomnienia o podpowiedzi
     */
    clearFirstHintReminderTimer() {
        if (this.gameService.firstHintReminderTimer) {
            clearTimeout(this.gameService.firstHintReminderTimer);
            this.gameService.firstHintReminderTimer = null;
            console.log('🔴 Wyczyszczono firstHintReminderTimer');
        }
    }

    /**
     * Czyści drugi timer przypomnienia o podpowiedzi
     */
    clearSecondHintReminderTimer() {
        if (this.gameService.secondHintReminderTimer) {
            clearTimeout(this.gameService.secondHintReminderTimer);
            this.gameService.secondHintReminderTimer = null;
            console.log('🔴 Wyczyszczono secondHintReminderTimer');
        }
    }

    /**
     * Czyści timer powtarzających się przypomnień
     */
    clearRecurringReminderTimer() {
        if (this.gameService.recurringReminderTimer) {
            clearTimeout(this.gameService.recurringReminderTimer);
            this.gameService.recurringReminderTimer = null;
            console.log('🔴 Wyczyszczono recurringReminderTimer');
        }
    }

    /**
     * Ustawia timer automatycznego resetowania
     */
    async setAutoResetTimer() {
        this.clearAutoResetTimer();
        if (this.gameService.trigger === null) {
            console.log(`🕐 Ustawiono timer na automatyczne ustawienie hasła "${this.config.messages.defaultPassword}" za ${this.config.timers.autoResetMinutes} minut`);
            this.gameService.autoResetTimer = setTimeout(async () => {
                if (this.gameService.trigger === null) {
                    console.log(`⏰ Automatycznie ustawiam hasło "${this.config.messages.defaultPassword}" po ${this.config.timers.autoResetMinutes} minutach bezczynności`);
                    this.gameService.resetToDefaultPassword();

                    try {
                        const guild = this.client.guilds.cache.first();
                        if (guild) {
                            await this.removeRoleFromAllMembers(guild, this.config.roles.papal);
                        }
                    } catch (error) {
                        console.error('❌ Błąd podczas usuwania ról papieskich:', error);
                    }

                    try {
                        const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
                        const startChannel = await this.client.channels.fetch(this.config.channels.start);

                        if (triggerChannel && triggerChannel.isTextBased()) {
                            await triggerChannel.send(`Aktualne hasło: ${this.gameService.trigger}`);
                        }

                        if (startChannel && startChannel.isTextBased()) {
                            const message = this.config.messages.autoReset
                                .replace('{emoji}', this.config.emojis.warning2)
                                .replace('{minutes}', this.config.timers.autoResetMinutes);
                            await startChannel.send(message);
                            await startChannel.send(`Napisz **"${this.config.messages.defaultPassword}"** by rozpocząć grę.`);
                        }
                    } catch (error) {
                        console.error('❌ Błąd podczas automatycznego ustawiania hasła:', error);
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
        console.log(`🔔 Ustawiono przypomnienie dla użytkownika ${userId} za ${this.config.timers.reminderMinutes} minut`);
        this.gameService.reminderTimer = setTimeout(async () => {
            if (this.gameService.trigger === null) {
                try {
                    const reminderChannel = await this.client.channels.fetch(this.config.channels.reminder);
                    if (reminderChannel && reminderChannel.isTextBased()) {
                        await reminderChannel.send(`<@${userId}> Przypomnienie: Minęło już ${this.config.timers.reminderMinutes} minut, a nowe hasło konklawe nie zostało jeszcze ustawione! ⏰\nZa ${this.config.timers.autoResetMinutes - this.config.timers.reminderMinutes} minut hasło zostanie automatycznie ustawione na "${this.config.messages.defaultPassword}".`);
                    }
                } catch (error) {
                    console.error('❌ Błąd podczas wysyłania przypomnienia:', error);
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
            console.log(`🟡 Ustawiono pierwszy timer przypomnienia o podpowiedzi na 15 minut`);
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
                        console.error('Błąd podczas wysyłania pierwszego przypomnienia o podpowiedzi:', error);
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
        console.log(`🟠 Ustawiono drugi timer przypomnienia o podpowiedzi na kolejne 15 minut`);
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
                    console.error('Błąd podczas wysyłania drugiego przypomnienia o podpowiedzi:', error);
                }
            }
        }, this.gameService.FIRST_HINT_REMINDER_TIME);
        this.gameService.saveTriggerState();
    }

    /**
     * Ustawia powtarzające się przypomnienia
     * @param {string} userId - ID użytkownika
     */
    async setRecurringReminders(userId) {
        this.clearRecurringReminderTimer();
        console.log(`🔄 Ustawiono powtarzające się przypomnienia co 15 minut dla użytkownika ${userId}`);
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
                    console.error('Błąd podczas wysyłania powtarzającego się przypomnienia:', error);
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
        console.log(`🔴 Ustawiono timer na usunięcie roli papieskiej za brak podpowiedzi użytkownikowi ${userId} za 30 minut`);
        this.gameService.papalRoleRemovalTimer = setTimeout(async () => {
            if (this.gameService.trigger && this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase() && this.gameService.hints.length === 0) {
                try {
                    const guild = this.client.guilds.cache.first();
                    if (guild) {
                        const member = guild.members.cache.get(userId);
                        if (member && member.roles.cache.has(this.config.roles.papal)) {
                            await member.roles.remove(this.config.roles.papal);
                            console.log(`Usunięto rolę papieską użytkownikowi ${member.user.tag} za brak podpowiedzi przez godzinę`);
                            await this.resetToDefaultPassword();
                        }
                    }
                } catch (error) {
                    console.error('Błąd podczas usuwania roli papieskiej za brak podpowiedzi:', error);
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
            console.log(`🟢 Ustawiono timer przypomnienia o kolejnej podpowiedzi na 6 godzin`);
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
                                await triggerChannel.send(`<@${papalMember.user.id}> Przypomnienie: Minęło już **${timeText}** od ostatniej podpowiedzi! Rozważ dodanie nowej podpowiedzi dla graczy. 💡`);
                                await this.setHintReminderTimer();
                            }
                        }
                    } catch (error) {
                        console.error('Błąd podczas wysyłania przypomnienia o kolejnej podpowiedzi:', error);
                    }
                }
            }, this.gameService.EXISTING_HINT_REMINDER_TIME);
            this.gameService.saveTriggerState();
        }
    }

    /**
     * Resetuje hasło na domyślne
     */
    async resetToDefaultPassword() {
        try {
            const guild = this.client.guilds.cache.first();
            const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
            const startChannel = await this.client.channels.fetch(this.config.channels.start);

            this.gameService.resetToDefaultPassword();

            if (triggerChannel && triggerChannel.isTextBased()) {
                await triggerChannel.send(`Aktualne hasło: ${this.gameService.trigger}`);
            }

            if (startChannel && startChannel.isTextBased()) {
                await startChannel.send(`🚨 **Rola papieska została usunięta** za brak podpowiedzi przez godzinę!`);
                await startChannel.send(`Hasło zostało automatycznie ustawione na "${this.config.messages.defaultPassword}". Napisz **"${this.config.messages.defaultPassword}"** by rozpocząć grę.`);
            }

            console.log('Zresetowano hasło na domyślne po usunięciu roli papieskiej');
        } catch (error) {
            console.error('Błąd podczas resetowania hasła:', error);
        }
    }

    /**
     * Usuwa rolę wszystkim członkom
     * @param {Guild} guild - Serwer Discord
     * @param {string} roleId - ID roli
     */
    async removeRoleFromAllMembers(guild, roleId) {
        try {
            console.log(`Rozpoczynam usuwanie roli ${roleId} wszystkim użytkownikom...`);
            const allMembers = await guild.members.fetch();
            const membersWithRole = allMembers.filter(member => member.roles.cache.has(roleId));
            console.log(`Znaleziono ${membersWithRole.size} użytkowników z rolą ${roleId}`);

            if (membersWithRole.size === 0) {
                console.log(`Brak użytkowników z rolą ${roleId} do usunięcia`);
                return;
            }

            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.roles.remove(roleId);
                    console.log(`✅ Usunięto rolę ${roleId} od ${member.user.tag}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    console.error(`❌ Błąd usuwania roli ${roleId} od ${member.user.tag}:`, err);
                }
            }
            console.log(`✅ Zakończono usuwanie roli ${roleId} wszystkim użytkownikom`);
        } catch (error) {
            console.error(`❌ Błąd podczas usuwania ról ${roleId}:`, error);
        }
    }

    /**
     * Przywraca timery po restarcie bota
     */
    async restoreRemindersAfterRestart() {
        console.log('🔄 Rozpoczynam przywracanie timerów po restarcie...');
        
        if (!this.gameService.trigger || this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
            console.log('❌ Hasło jest domyślne lub brak triggera - nie przywracam timerów');
            return;
        }

        const now = new Date();
        const timeSincePassword = now - this.gameService.triggerSetTimestamp;
        
        console.log(`⏱️ Czas od ustawienia hasła: ${formatTimeDifference(timeSincePassword)}`);
        console.log(`📝 Liczba podpowiedzi: ${this.gameService.hints.length}`);

        // Jeśli brak podpowiedzi
        if (this.gameService.hints.length === 0) {
            if (timeSincePassword >= this.gameService.ROLE_REMOVAL_TIME) {
                // Godzina minęła - usuń rolę natychmiast
                console.log('⚠️ Minęła godzina bez podpowiedzi - usuwanie roli papieskiej');
                const guild = this.client.guilds.cache.first();
                const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(this.config.roles.papal));
                if (membersWithRole.size > 0) {
                    const papalMember = membersWithRole.first();
                    await papalMember.roles.remove(this.config.roles.papal);
                    await this.resetToDefaultPassword();
                }
            } else {
                // Ustaw odpowiednie timery na pozostały czas
                const guild = this.client.guilds.cache.first();
                const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(this.config.roles.papal));
                if (membersWithRole.size > 0) {
                    const papalMember = membersWithRole.first();
                    
                    if (timeSincePassword < this.gameService.FIRST_HINT_REMINDER_TIME) {
                        // Ustaw bezpośrednio timer na wysłanie pierwszego przypomnienia
                        const remainingTime = this.gameService.FIRST_HINT_REMINDER_TIME - timeSincePassword;
                        setTimeout(async () => {
                            // Wysłanie pierwszego przypomnienia
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
                                    console.error('Błąd podczas wysyłania pierwszego przypomnienia o podpowiedzi:', error);
                                }
                            }
                        }, remainingTime);
                        console.log(`⏱️ Ustawiono pierwszy timer na ${Math.round(remainingTime / 1000)} sekund`);
                    } else if (timeSincePassword < this.gameService.SECOND_HINT_REMINDER_TIME) {
                        // Ustaw bezpośrednio timer na wysłanie drugiego przypomnienia
                        const remainingTime = this.gameService.SECOND_HINT_REMINDER_TIME - timeSincePassword;
                        setTimeout(async () => {
                            // Wysłanie drugiego przypomnienia
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
                                    console.error('Błąd podczas wysyłania drugiego przypomnienia o podpowiedzi:', error);
                                }
                            }
                        }, remainingTime);
                        console.log(`⏱️ Ustawiono drugi timer na ${Math.round(remainingTime / 1000)} sekund`);
                    } else {
                        // Już po drugim przypomnieniu - ustaw usuwanie roli na pozostały czas
                        const remainingTime = this.gameService.ROLE_REMOVAL_TIME - timeSincePassword;
                        if (remainingTime > 0) {
                            setTimeout(async () => {
                                await this.setPapalRoleRemovalForNoHints(papalMember.user.id);
                                await this.setRecurringReminders(papalMember.user.id);
                            }, remainingTime);
                            console.log(`⏱️ Ustawiono timer usuwania roli na ${Math.round(remainingTime / 1000)} sekund`);
                        } else {
                            // Czas już minął - ustaw natychmiast
                            await this.setPapalRoleRemovalForNoHints(papalMember.user.id);
                            await this.setRecurringReminders(papalMember.user.id);
                            console.log(`⏱️ Czas minął - ustawianie timerów natychmiast`);
                        }
                    }
                }
            }
        } else if (this.gameService.lastHintTimestamp) {
            // Są podpowiedzi - ustaw timer dla kolejnej podpowiedzi
            const timeSinceLastHint = now - this.gameService.lastHintTimestamp;
            if (timeSinceLastHint >= this.gameService.EXISTING_HINT_REMINDER_TIME) {
                await this.setHintReminderTimer();
                console.log(`⏱️ Czas od ostatniej podpowiedzi minął - ustawianie timer natychmiast`);
            } else {
                const remainingTime = this.gameService.EXISTING_HINT_REMINDER_TIME - timeSinceLastHint;
                setTimeout(async () => await this.setHintReminderTimer(), remainingTime);
                console.log(`⏱️ Ustawiono timer dla kolejnej podpowiedzi na ${Math.round(remainingTime / 1000)} sekund`);
            }
        }
        
        console.log('✅ Zakończono przywracanie timerów po restarcie');
    }
}

module.exports = TimerService;