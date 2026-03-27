const { isSingleWord } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class MessageHandler {
    constructor(config, gameService, rankingService, timerService, passwordEmbedService = null, scheduledHintsService = null, bombChaosService = null) {
        this.config = config;
        this.gameService = gameService;
        this.rankingService = rankingService;
        this.timerService = timerService;
        this.passwordEmbedService = passwordEmbedService;
        this.scheduledHintsService = scheduledHintsService;
        this.bombChaosService = bombChaosService;
    }

    /**
     * Wykrywa herezję "Full HP najlepsze" i próby obejścia cenzury
     * @param {string} text - Treść wiadomości
     * @returns {boolean} true jeśli wykryto herezję
     */
    detectFullHpHeresy(text) {
        // Normalizacja: małe litery + podmiana leet speak
        let normalized = text.toLowerCase()
            .replace(/0/g, 'o')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/\$/g, 's')
            .replace(/@/g, 'a');

        // Usuń wszystkie separatory (spacje, kropki, myślniki, podkreślenia itp.)
        // żeby wykryć "f.u.l.l h.p", "f u l l h p", "f-u-l-l-h-p" itp.
        const noSeparators = normalized.replace(/[\s.\-_*|,!?'"`~^+=&#%@]/g, '');

        if (noSeparators.includes('fullhp') && noSeparators.includes('lepsz')) {
            return true;
        }

        // Sprawdź też wersję z normalnymi spacjami (full hp lepsze/najlepsze)
        const spacedNorm = normalized.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        if (spacedNorm.includes('full hp') && spacedNorm.includes('lepsz')) {
            return true;
        }

        return false;
    }

    /**
     * Obsługuje wiadomości
     * @param {Message} message - Wiadomość Discord
     */
    async handleMessage(message, interactionHandler = null) {
        try {
            if (message.author.bot) return;

            // Bomb chaos: ghost pingi dla graczy bez roli gracza
            if (this.bombChaosService) {
                await this.bombChaosService.handleMessage(message);
            }

            // Sprawdź efekty klątw jeśli mamy dostęp do interactionHandler
            if (interactionHandler && interactionHandler.handleCurseEffects) {
                await interactionHandler.handleCurseEffects(message);
            }

            // === HEREZJA FULL HP - Automatyczna cicha klątwa za "Full HP najlepsze" ===
            if (interactionHandler && message.member && this.detectFullHpHeresy(message.content)) {
                try {
                    await interactionHandler.applyRandomCurseToUser(message.member, 'FullHpHeresy');
                    logger.info(`🔱 Herezja Full HP wykryta od ${message.author.tag} - nałożono cichą klątwę`);
                } catch (error) {
                    logger.error(`❌ Błąd nakładania klątwy za herezję Full HP: ${error.message}`);
                }
            }

            // === ULTRA POTĘŻNY DEBUFF (Gabriel/Admin) - 10% szansa na klątwę po fazie początkowej ===
            if (interactionHandler && interactionHandler.virtuttiService && message.member) {
                // Sprawdź czy użytkownik ma debuff (niezależnie od roli, bo admin może nałożyć na każdego)
                const debuffData = interactionHandler.virtuttiService.hasGabrielDebuff(message.author.id);

                // Jeśli debuff wygasł naturalnie, zaloguj to
                if (debuffData && debuffData.expired && interactionHandler.detailedLogger) {
                    try {
                        await interactionHandler.detailedLogger.logDebuffEnd(
                            message.author,
                            debuffData.source || 'gabriel',
                            24 * 60 * 60 * 1000 // 24 godziny
                        );
                    } catch (error) {
                        logger.warn(`⚠️ Błąd logowania zakończenia debuffu: ${error.message}`);
                    }
                }

                // Jeśli ma debuff i przeszło 5 minut (po fazie początkowej)
                if (debuffData && !debuffData.expired && Date.now() > debuffData.initialCurseEndTime) {
                    const randomChance = Math.random() * 100;

                    if (randomChance < 10) {
                        // 10% szansa na nową losową klątwę (10 typów)
                        const curses = [
                            'slow_mode',
                            'auto_delete',
                            'random_ping',
                            'emoji_spam',
                            'forced_caps',
                            'random_timeout',
                            'special_role',
                            'scramble_letters',
                            'smart_reply',
                            'blah_blah'
                        ];
                        // Wylosuj klątwę która nie jest aktywna (max 10 prób)
                        let selectedCurse = null;
                        for (let i = 0; i < 10; i++) {
                            const randomCurse = curses[Math.floor(Math.random() * curses.length)];
                            if (!interactionHandler.hasActiveCurse(message.author.id, randomCurse)) {
                                selectedCurse = randomCurse;
                                break;
                            }
                        }

                        if (selectedCurse) {
                            try {
                                // Nałóż klątwę (5 minut)
                                await interactionHandler.applyCurse(
                                    message.member,
                                    selectedCurse,
                                    message.guild,
                                    Date.now() + (5 * 60 * 1000)
                                );

                                // Określ źródło debuffa
                                const debuffSource = debuffData.source === 'admin' ? 'Admin' : 'Gabriel';

                                logger.info(`⚡ ${debuffSource} debuff wywołał klątwę na ${message.author.tag} (10% szansa): ${selectedCurse}`);

                                // Szczegółowe logowanie trigger klątwy
                                if (interactionHandler.detailedLogger) {
                                    await interactionHandler.detailedLogger.logDebuffCurseTrigger(
                                        message.author,
                                        selectedCurse,
                                        debuffSource
                                    );
                                }
                            } catch (error) {
                                logger.error(`❌ Błąd nakładania klątwy przez debuff: ${error.message}`);
                            }
                        } else {
                            logger.warn(`⚠️ Pominięto debuff dla ${message.author.tag} - już ma aktywną klątwę`);
                        }
                    }
                }
            }

            // Losowa odpowiedź dla użytkowników z rolą Virtutti Papajlari
            if (message.member.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                const randomChance = Math.floor(Math.random() * this.config.randomResponse.virtuttiPapajlariChance) + 1;
                if (randomChance === 1) { // Szansa 1/N gdzie N = virtuttiPapajlariChance
                    try {
                        await message.reply(`# ${this.config.emojis.jp2roll}`);
                        logger.info(`🎲 Losowa odpowiedź JP2roll dla ${message.author.tag} (1/${this.config.randomResponse.virtuttiPapajlariChance})`);
                    } catch (error) {
                        logger.error(`❌ Błąd wysyłania losowej odpowiedzi JP2roll: ${error.message}`);
                    }
                }
            }

            // Rejestrowanie prób odgadnięcia
            if (message.channel.id === this.config.channels.attempts &&
                this.gameService.trigger &&
                isSingleWord(message.content) &&
                !message.member.roles.cache.has(this.config.roles.papal) &&
                message.content.toLowerCase() !== this.gameService.trigger.toLowerCase()) {

                this.gameService.registerAttempt(message.author.id, message.content, false);

                // Zaplanuj aktualizację embeda (z cooldownem 1 sekundy)
                if (this.passwordEmbedService) {
                    this.passwordEmbedService.scheduleUpdate();
                }

                return;
            }

            // Kanał trigger jest teraz zarządzany przez przyciski - ignoruj wiadomości
            if (message.channel.id === this.config.channels.trigger) {
                // Usuwaj wszystkie wiadomości użytkowników na kanale trigger
                try {
                    await message.delete();
                    logger.info(`🗑️ Usunięto wiadomość od ${message.author.tag} na kanale trigger (kanał zarządzany przez przyciski)`);
                } catch (error) {
                    logger.error(`❌ Nie udało się usunąć wiadomości: ${error.message}`);
                }
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

        // Wyczyść zaplanowane podpowiedzi
        if (this.scheduledHintsService) {
            await this.scheduledHintsService.clearAllScheduled();
        }

        this.gameService.clearPassword();

        logger.info('🔄 Usuwanie roli papieskiej wszystkim użytkownikom...');
        await this.timerService.removeRoleFromAllMembers(guild, this.config.roles.papal);

        // Sprawdź czy to będzie 10. zwycięstwo (Virtutti Papajlari achievement)
        const currentPoints = this.gameService.getPoints(userId) || 0;
        const willGetVirtuttiPapajlari = (currentPoints + points) >= this.config.achievements.virtuttiPapajlariThreshold;

        if (willGetVirtuttiPapajlari) {
            // Użyj nowego komunikatu "VERTE PAPA MORTUUS EST!" dla 10. zwycięstwa
            await message.reply(`${this.config.messages.papaDeadAnnouncement}`);
        } else {
            // Standardowy komunikat dla pozostałych zwycięstw
            await message.reply(`${this.config.messages.habemusPapam} ${this.config.emojis.jp2roll}`);
        }

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

        // Zaktualizuj embed na kanale trigger (wyczyść podpowiedzi)
        if (this.passwordEmbedService) {
            await this.passwordEmbedService.updateEmbed(true);
        }

        // Wyślij ping do nowego papieża z przypomnieniem
        try {
            const triggerChannel = await message.client.channels.fetch(this.config.channels.trigger);
            if (triggerChannel && triggerChannel.isTextBased()) {
                const autoResetMinutes = this.config.timers.autoResetMinutes;
                await triggerChannel.send(
                    `<@${message.author.id}> **Dodaj nowe hasło by rozpocząć grę. Pospiesz się!**\n\n` +
                    `⏰ Masz na to **${autoResetMinutes} minut**, po tym czasie zostanie ustawione domyślne hasło, a Ty stracisz rolę papieską!`
                );
                logger.info(`📢 Wysłano ping do nowego papieża ${message.author.tag}`);
            }
        } catch (error) {
            logger.error(`❌ Błąd wysyłania pinga do nowego papieża: ${error.message}`);
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