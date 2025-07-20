const { isSingleWord } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class MessageHandler {
    constructor(config, gameService, rankingService, timerService) {
        this.config = config;
        this.gameService = gameService;
        this.rankingService = rankingService;
        this.timerService = timerService;
    }

    /**
     * Obsługuje wiadomości
     * @param {Message} message - Wiadomość Discord
     */
    async handleMessage(message) {
        try {
            if (message.author.bot) return;

            // Rejestrowanie prób odgadnięcia
            if (message.channel.id === this.config.channels.attempts &&
                this.gameService.trigger &&
                isSingleWord(message.content) &&
                !message.member.roles.cache.has(this.config.roles.papal) &&
                message.content.toLowerCase() !== this.gameService.trigger.toLowerCase()) {
                
                this.gameService.registerAttempt(message.author.id, message.content, false);
                return;
            }

            // Ustawianie nowego hasła w kanale trigger
            if (message.channel.id === this.config.channels.trigger) {
                await this.handleTriggerChannel(message);
                return;
            }

            // Usuwanie wiadomości z hasłem od papieża poza kanałem trigger
            if (this.gameService.trigger &&
                message.content.toLowerCase() === this.gameService.trigger.toLowerCase() &&
                message.member.roles.cache.has(this.config.roles.papal) &&
                message.channel.id !== this.config.channels.trigger) {
                
                await message.delete().catch(err => {
                    logger.info(`❌ Nie udało się usunąć wiadomości od ${message.author.tag}:`, err);
                });
                logger.info(`🗑️ Usunięto wiadomość zawierającą hasło od papieża (${message.author.tag}) poza triggerChannelId.`);
                return;
            }

            // Główna logika odgadywania hasła
            if (this.gameService.trigger && 
                message.content.toLowerCase() === this.gameService.trigger.toLowerCase() && 
                !message.member.roles.cache.has(this.config.roles.papal)) {
                
                await this.handlePasswordGuess(message);
                return;
            }

        } catch (error) {
            logger.error('❌ Błąd w obsłudze wiadomości:', error);
        }
    }

    /**
     * Obsługuje wiadomości w kanale trigger
     * @param {Message} message - Wiadomość Discord
     */
    async handleTriggerChannel(message) {
        let newTrigger = message.content.trim();

        if (newTrigger.includes(' ')) {
            await message.channel.send(`${this.config.emojis.warning} Hasło nie zostało przyjęte! ${this.config.emojis.warning} Możesz ustawić tylko JEDNOWYRAZOWE hasło.`);
            return;
        }

        if (newTrigger.length === 0) {
            await message.channel.send('Hasło nie może być puste!');
            return;
        }

        if (this.gameService.trigger && newTrigger.toLowerCase() === this.gameService.trigger.toLowerCase()) {
            await message.channel.send('To hasło jest już ustawione!');
            return;
        }

        this.timerService.clearAllTimers();
        this.gameService.setNewPassword(newTrigger, message.author.id);

        await message.channel.send(`✅ Nowe hasło zostało ustawione jako: ${this.gameService.trigger}`);

        const startChannel = await message.client.channels.fetch(this.config.channels.start);
        if (startChannel && startChannel.isTextBased() && message.channel.id !== this.config.channels.start) {
            const passwordMessage = this.config.messages.passwordSet.replace(/{emoji}/g, this.config.emojis.warning2);
            await startChannel.send(passwordMessage);
        }

        if (this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
            // Ustaw timery dla przypominania o pierwszej podpowiedzi
            await this.timerService.setFirstHintReminder();
        }
    }

    /**
     * Obsługuje odgadnięcie hasła
     * @param {Message} message - Wiadomość Discord
     */
    async handlePasswordGuess(message) {
        logger.info(`🎉 Hasło odgadnięte przez ${message.author.tag}`);
        
        const guild = message.guild;
        const currentTrigger = this.gameService.trigger;
        const userId = message.author.id;
        const userAttempts = this.gameService.getUserAttempts(userId);
        const points = 1;

        // Zarejestruj zwycięską próbę
        this.gameService.registerAttempt(userId, currentTrigger, true);
        
        // Dodaj grę do historii przed wyczyszczeniem
        this.gameService.addGameToHistory(userId);

        // Oblicz czas PRZED wyczyszczeniem hasła
        const timeText = this.gameService.getFormattedTimeSincePasswordSet();

        this.timerService.clearAllTimers();
        this.gameService.clearPassword();

        logger.info('🔄 Usuwanie roli papieskiej wszystkim użytkownikom...');
        await this.timerService.removeRoleFromAllMembers(guild, this.config.roles.papal);
        await message.reply(`${this.config.messages.habemusPapam} ${this.config.emojis.jp2roll}`);

        try {
            await message.member.roles.add(this.config.roles.papal);
            logger.info(`👑 Nadano rolę papieską użytkownikowi ${message.author.tag}`);
        } catch (err) {
            logger.error(`❌ Błąd nadawania roli papieskiej ${this.config.roles.papal} dla ${message.author.tag}:`, err);
        }

        // Statystyki odpowiedzi
        if (currentTrigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
            let attemptsText = '';
            if (userAttempts > 0) {
                attemptsText = `\nLiczba prób: **${userAttempts + 1}** 🎯`;
            } else {
                attemptsText = `\nOdgadnięte za pierwszym razem! **1** próba 🎯`;
            }
            await message.channel.send(`Czas od ustawienia hasła: **${timeText}** ⏱️\nPrzyznane punkty: **${points}**${this.config.emojis.medal}${attemptsText}`);
        } else if (userAttempts > 0) {
            await message.channel.send(`Liczba prób: **${userAttempts + 1}** 🎯`);
        }

        // Czyszczenie kanału trigger i instrukcje
        const triggerChannel = guild.channels.cache.get(this.config.channels.trigger);
        if (triggerChannel && triggerChannel.isTextBased()) {
            try {
                const fetchedMessages = await triggerChannel.messages.fetch({ limit: 100 });
                await triggerChannel.bulkDelete(fetchedMessages, true);
            } catch (error) {
                logger.error(`❌ Błąd czyszczenia kanału ${this.config.channels.trigger}:`, error);
            }

            await triggerChannel.send(`<@${message.author.id}> nadaj tu nowe hasło konklawe.`);
            await triggerChannel.send('Zawsze ostatnia wpisana fraza będzie hasłem, dlatego jeżeli popełnisz błąd możesz poprawić.');
        }

        // Reset stanu gry
        this.gameService.resetHints();
        this.gameService.clearAttempts();

        // Obsługa specjalnego przypadku słowa "konklawe"
        if (currentTrigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase() && !this.gameService.konklaweUsed) {
            this.gameService.konklaweUsed = true;
            await this.timerService.setAutoResetTimer();
            await this.timerService.setReminderTimer(message.author.id);
            return;
        }

        // Aktualizacja punktów i sprawdzenie medali
        this.gameService.addPoints(userId, points);

        const achievedMedal = await this.rankingService.checkVirtuttiPapajlariAchievement(userId, guild, message.channel);
        if (!achievedMedal) {
            // Pokaż TOP 3
            const top3Message = await this.rankingService.createTop3Message(guild);
            await message.channel.send(top3Message);
        }

        await this.timerService.setAutoResetTimer();
        await this.timerService.setReminderTimer(message.author.id);
    }
}

module.exports = MessageHandler;