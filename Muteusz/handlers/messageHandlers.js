const { formatMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const AutoModerationService = require('../services/autoModerationService');
const WarningService = require('../services/warningService');
const SpamDetectionService = require('../services/spamDetectionService');

const logger = createBotLogger('Muteusz');

class MessageHandler {
    constructor(config, mediaService, logService) {
        this.config = config;
        this.mediaService = mediaService;
        this.logService = logService;
        this.warningService = new WarningService(config, logger);
        this.autoModerationService = new AutoModerationService(config, logger, this.warningService);
        this.spamDetectionService = new SpamDetectionService(config, logger);
        this.imageBlockService = null;
        this.wordBlockService = null;
        
        // Uruchom czyszczenie co 5 minut
        setInterval(() => {
            this.autoModerationService.cleanup();
        }, 5 * 60 * 1000);
    }

    /**
     * Inicjalizuje serwis blokowania obrazów
     */
    async initializeImageBlockService() {
        if (!this.imageBlockService) {
            const ImageBlockService = require('../services/imageBlockService');
            this.imageBlockService = new ImageBlockService(this.config, this.logService);
            await this.imageBlockService.initialize();
        }
    }

    /**
     * Inicjalizuje serwis blokowania słów
     */
    async initializeWordBlockService() {
        if (!this.wordBlockService) {
            const WordBlockService = require('../services/wordBlockService');
            this.wordBlockService = new WordBlockService(this.config, this.logService);
            await this.wordBlockService.initialize();
        }
    }

    /**
     * Obsługuje wiadomości
     * @param {Message} message - Wiadomość Discord
     * @param {Client} client - Klient Discord
     */
    async handleMessage(message, client) {
        // Ignoruj wiadomości botów
        if (message.author.bot || !message.guild) {
            return;
        }

        // Sprawdź czy kanał ma zablokowane obrazy
        if (message.attachments.size > 0) {
            const hasImages = message.attachments.some(attachment => {
                const extension = attachment.name ? attachment.name.toLowerCase() : '';
                return extension.endsWith('.jpg') || extension.endsWith('.jpeg') || 
                       extension.endsWith('.png') || extension.endsWith('.gif') || 
                       extension.endsWith('.webp') || extension.endsWith('.bmp') || 
                       extension.endsWith('.svg');
            });
            
            if (hasImages) {
                await this.handleImageBlock(message);
                return; // Zatrzymaj dalsze przetwarzanie jeśli obrazy zostały zablokowane
            }
        }

        // Sprawdź czy wiadomość zawiera zablokowane słowa
        if (message.content) {
            const blockedWords = await this.handleWordBlock(message);
            if (blockedWords && blockedWords.length > 0) {
                return; // Zatrzymaj dalsze przetwarzanie jeśli słowa zostały zablokowane
            }
        }
        
        // Losowa odpowiedź dla użytkowników z rolą Virtutti Papajlari
        if (message.member && message.member.roles.cache.has(this.config.randomResponse.virtuttiPapajlariRoleId)) {
            const randomChance = Math.floor(Math.random() * this.config.randomResponse.virtuttiPapajlariChance) + 1;
            if (randomChance === 1) { // Szansa 1/N gdzie N = virtuttiPapajlariChance
                try {
                    await message.reply(this.config.randomResponse.pepeSoldierEmoji);
                    logger.info(`🎲 Losowa odpowiedź PepeSoldier dla ${message.author.tag} (1/${this.config.randomResponse.virtuttiPapajlariChance})`);
                } catch (error) {
                    logger.error(`❌ Błąd wysyłania losowej odpowiedzi PepeSoldier: ${error.message}`);
                }
            }
        }
        
        // Obsługa załączników (oryginalny kod)
        if (message.attachments.size > 0 && message.channel.id !== this.config.media.targetChannelId) {
            await this.mediaService.repostMedia(message, client);
        }
        
        // Trackuj wszystkie wiadomości dla deleted message logs (tylko z treścią, bez mediów)
        if (this.config.deletedMessageLogs?.enabled && 
            this.config.deletedMessageLogs?.trackMessageLinks && 
            message.content && 
            message.attachments.size === 0 && 
            message.channel.id !== this.config.media.targetChannelId &&
            message.channel.id !== this.config.deletedMessageLogs.logChannelId) {
            
            this.mediaService.messageLinks.set(message.id, {
                originalChannelId: message.channel.id,
                originalAuthorId: message.author.id,
                originalAuthorTag: message.author.tag,
                repostedMessageId: null,
                repostedChannelId: null,
                timestamp: Date.now(),
                hasMedia: false
            });
        }

        // Auto-moderacja
        await this.handleAutoModeration(message);
        
        // Detekcja spamu z linkami
        await this.handleSpamDetection(message);
    }

    /**
     * Obsługuje detekcję spamu z linkami
     * @param {Message} message - Wiadomość Discord
     */
    async handleSpamDetection(message) {
        try {
            // Sprawdź wiadomość pod kątem spamu
            const result = await this.spamDetectionService.processMessage(message);
            
            // Jeśli wykryto spam, wykonaj akcje
            if (result.isSpam) {
                await this.spamDetectionService.executeAntiSpamActions(message, result);
            }
        } catch (error) {
            logger.error(`❌ Błąd detekcji spamu: ${error.message}`);
        }
    }

    /**
     * Obsługuje auto-moderację
     * @param {Message} message - Wiadomość Discord
     */
    async handleAutoModeration(message) {
        // Sprawdź czy auto-moderacja jest włączona
        if (!this.config.autoModeration.enabled) {
            return;
        }

        // Sprawdź czy kanał jest zwolniony
        if (this.config.autoModeration.exemptChannels.includes(message.channel.id)) {
            return;
        }

        // Sprawdź czy użytkownik ma zwolnioną rolę
        if (this.hasExemptRole(message.member)) {
            // Loguj że użytkownik jest zwolniony (dla administratorów i moderatorów)
            if (message.member.permissions.has('Administrator') || message.member.permissions.has('ModerateMembers')) {
                try {
                    const badWords = this.autoModerationService.detectBadWords(message.content);
                    if (badWords.length > 0) {
                        const badWordsText = badWords.map(word => word.original).join(', ');
                        this.logger.info(`👑 Administrator/Moderator zwolniony: ${message.author.tag} (${message.author.id}) na kanale #${message.channel.name} - Słowa: ${badWordsText}`);
                    }
                } catch (error) {
                    // Ignoruj błędy przy logowaniu
                }
            }
            return;
        }

        try {
            const result = await this.autoModerationService.processMessage(message);
            await this.handleModerationResult(message, result);
        } catch (error) {
            // Nie loguj błędów regex - są obsłużone w serwisie
            if (!error.message.includes('Invalid regular expression')) {
                const errorMessage = error?.message || 'Nieznany błąd';
                await this.logService.logMessage('error', `Błąd auto-moderacji: ${errorMessage}`, message);
            }
        }
    }

    /**
     * Sprawdza czy użytkownik ma rolę zwolnioną z auto-moderacji
     * @param {GuildMember} member - Członek serwera
     * @returns {boolean} Czy użytkownik jest zwolniony
     */
    hasExemptRole(member) {
        if (!member || !member.roles) return false;
        
        // Sprawdź uprawnienia administratora i moderatora
        if (member.permissions.has('Administrator') || member.permissions.has('ModerateMembers')) {
            return true;
        }
        
        return this.config.autoModeration.exemptRoles.some(roleId => 
            member.roles.cache.has(roleId)
        );
    }

    /**
     * Obsługuje wynik moderacji
     * @param {Message} message - Wiadomość Discord
     * @param {Object} result - Wynik moderacji
     */
    async handleModerationResult(message, result) {
        switch (result.action) {
            case 'ignore':
            case 'clean':
                break;

            case 'violation':
                await this.handleViolation(message, result);
                break;

            case 'warn':
                await this.handleAutoWarn(message, result);
                break;

            case 'mute':
                await this.handleAutoMute(message, result);
                break;
        }
    }

    /**
     * Obsługuje naruszenie (ostrzeżenie przed warnem)
     * @param {Message} message - Wiadomość Discord
     * @param {Object} result - Wynik moderacji
     */
    async handleViolation(message, result) {
        // Nie usuwaj wiadomości z wyzwiskami

        // Nie wysyłaj powiadomień o naruszeniach przed warnem

        // Loguj wykroczenie w konsoli
        const badWordsText = result.badWords ? 
            result.badWords.map(word => word.original).join(', ') : 
            'Brak';
        
        this.logger.warn(`🚨 Wykryto wyzwiska: ${message.author.tag} (${message.author.id}) na kanale #${message.channel.name} - Słowa: ${badWordsText} - Naruszenie ${result.violationCount}/3`);

        // Zaloguj naruszenie
        await this.logAutoModeration(message, 'violation', result);
    }

    /**
     * Obsługuje automatyczny warn
     * @param {Message} message - Wiadomość Discord
     * @param {Object} result - Wynik moderacji
     */
    async handleAutoWarn(message, result) {
        // Nie usuwaj wiadomości z wyzwiskami

        // Loguj automatyczny warn w konsoli
        const badWordsText = result.badWords ? 
            result.badWords.map(word => word.original).join(', ') : 
            'Brak';
        
        this.logger.error(`⚠️ Automatyczny WARN: ${message.author.tag} (${message.author.id}) na kanale #${message.channel.name} - Słowa: ${badWordsText} - Łączne warny: ${result.warnResult.totalWarnings}`);

        // Powiadom użytkownika o warnie (reply z pingiem)
        if (this.config.autoModeration.notifyUser) {
            // Pobierz liczbę ostrzeżeń w ciągu ostatniej godziny
            const hourlyWarnings = this.autoModerationService.getUserWarningsInHour(message.author.id, message.guild.id);
            
            let warnMessage;
            if (hourlyWarnings === 1) {
                warnMessage = `🚨 ${message.author.toString()}, hamuj się z tymi wyzwiskami.`;
            } else if (hourlyWarnings === 2) {
                warnMessage = `🚨 ${message.author.toString()}, jeszcze raz i zostaniesz wyciszony.`;
            } else if (hourlyWarnings >= 3) {
                warnMessage = `🚨 ${message.author.toString()}, zostałeś uciszony na godzinę, ochłoń...`;
            } else {
                // Fallback dla innych przypadków
                warnMessage = `🚨 ${message.author.toString()}, hamuj się z tymi wyzwiskami.`;
            }

            try {
                // Stwórz reply do wiadomości z pingiem
                await this.createEphemeralReply(message, warnMessage);
            } catch (error) {
                await this.logService.logMessage('warn', `Nie udało się wysłać powiadomienia o warnie: ${error.message}`, message);
            }
        }

        // Zaloguj warn
        await this.logAutoModeration(message, 'warn', result);
        await this.logService.logMessage('success', `Auto-moderacja: nadano warn użytkownikowi ${message.author.tag} za używanie wyzwisk`, message);
    }

    /**
     * Obsługuje automatyczne mute
     * @param {Message} message - Wiadomość Discord
     * @param {Object} result - Wynik moderacji
     */
    async handleAutoMute(message, result) {
        // Nie usuwaj wiadomości z wyzwiskami

        // Loguj automatyczny mute w konsoli
        const badWordsText = result.badWords ? 
            result.badWords.map(word => word.original).join(', ') : 
            'Brak';
        
        this.logger.error(`🔇 Automatyczny MUTE: ${message.author.tag} (${message.author.id}) na kanale #${message.channel.name} - Słowa: ${badWordsText} - Powód: ${result.reason} - Czas: ${this.config.autoModeration.muteTime} min`);

        try {
            const member = await message.guild.members.fetch(message.author.id);
            const muteRole = message.guild.roles.cache.get(this.config.mute.muteRoleId);
            
            if (muteRole && member) {
                // Dodaj rolę mute
                await member.roles.add(muteRole);
                
                // Ustaw automatyczne odmute
                setTimeout(async () => {
                    try {
                        const memberToUnmute = await message.guild.members.fetch(message.author.id);
                        if (memberToUnmute && memberToUnmute.roles.cache.has(this.config.mute.muteRoleId)) {
                            await memberToUnmute.roles.remove(muteRole);
                            await this.logService.logMessage('info', `Auto-moderacja: automatyczne odmute użytkownika ${message.author.tag}`, message);
                        }
                    } catch (error) {
                        await this.logService.logMessage('error', `Błąd podczas automatycznego odmute: ${error.message}`, message);
                    }
                }, this.config.autoModeration.muteTime * 60 * 1000);

                // Powiadom użytkownika o mute (reply z pingiem)
                if (this.config.autoModeration.notifyUser) {
                    const muteMessage = `🔇 ${message.author.toString()}, zostałeś uciszony na godzinę, ochłoń...`;

                    try {
                        // Stwórz reply do wiadomości z pingiem
                        await this.createEphemeralReply(message, muteMessage);
                    } catch (error) {
                        await this.logService.logMessage('warn', `Nie udało się wysłać powiadomienia o mute: ${error.message}`, message);
                    }
                }

                // Zaloguj mute
                await this.logAutoModeration(message, 'mute', result);
                await this.logService.logMessage('success', `Auto-moderacja: wyciszono użytkownika ${message.author.tag} za ${this.config.autoModeration.muteTime} minut`, message);
            }
        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas automatycznego mute: ${error.message}`, message);
        }
    }

    /**
     * Loguje działania auto-moderacji
     * @param {Message} message - Wiadomość Discord
     * @param {string} action - Akcja
     * @param {Object} result - Wynik moderacji
     */
    async logAutoModeration(message, action, result) {
        if (!this.config.autoModeration.logChannel) {
            return;
        }

        try {
            const logChannel = message.guild.channels.cache.get(this.config.autoModeration.logChannel);
            if (!logChannel) {
                return;
            }

            const badWordsText = result.badWords ? 
                result.badWords.map(word => `\`${word.original}\``).join(', ') : 
                'Brak';

            let reason = '';
            switch (action) {
                case 'violation':
                    reason = `Naruszenie ${result.violationCount}/${this.config.autoModeration.violationsBeforeWarn}`;
                    break;
                case 'warn':
                    reason = result.warnResult.warning.reason;
                    break;
                case 'mute':
                    reason = result.reason;
                    break;
            }

            const logMessage = formatMessage(this.config.messages.autoModerationLog, {
                user: `${message.author.tag} (${message.author.id})`,
                channel: `#${message.channel.name}`,
                action: action.toUpperCase(),
                reason: reason,
                words: badWordsText
            });

            await logChannel.send(logMessage);
        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas logowania auto-moderacji: ${error.message}`, message);
        }
    }

    /**
     * Pobiera statystyki auto-moderacji
     * @returns {Object} Statystyki
     */
    getStats() {
        return this.autoModerationService.getStats();
    }

    /**
     * Dodaje nowe wyzwisko
     * @param {string} word - Wyzwisko
     */
    addBadWord(word) {
        this.autoModerationService.addBadWord(word);
    }

    /**
     * Usuwa wyzwisko
     * @param {string} word - Wyzwisko
     */
    removeBadWord(word) {
        this.autoModerationService.removeBadWord(word);
    }

    /**
     * Pobiera serwis auto-moderacji
     * @returns {AutoModerationService} Serwis auto-moderacji
     */
    getAutoModerationService() {
        return this.autoModerationService;
    }

    /**
     * Obsługuje blokadę obrazów na kanale
     * @param {Message} message - Wiadomość z obrazami
     */
    async handleImageBlock(message) {
        try {
            // Inicjalizuj serwis jeśli nie istnieje
            if (!this.imageBlockService) {
                await this.initializeImageBlockService();
            }

            // Sprawdź czy kanał jest zablokowany
            if (this.imageBlockService.isChannelBlocked(message.channel.id)) {
                const blockInfo = this.imageBlockService.getBlockInfo(message.channel.id);
                
                // Usuń wiadomość
                try {
                    await message.delete();
                } catch (error) {
                    logger.error(`❌ Nie można usunąć wiadomości z obrazami: ${error.message}`);
                }

                // Wyślij powiadomienie użytkownikowi
                const warningMessage = `🚫 **${message.author}**, wrzucanie zdjęć na tym kanale jest obecnie zablokowane!`;

                try {
                    // Wyślij TYLKO wiadomość prywatną - absolutnie nic publicznie
                    await message.author.send(warningMessage.replace(`**${message.author}**`, 'Ty'));
                } catch (dmError) {
                    // Jeśli DM nie działa - MILCZ. Nie wysyłaj niczego publicznego.
                    logger.info(`ℹ️ Nie można wysłać DM do ${message.author.tag} o blokadzie obrazów - pomijam powiadomienie`);
                }

                // Loguj blokadę
                logger.info(`🚫 Zablokowano obraz od ${message.author.tag} na kanale #${message.channel.name} (blokada do ${endTime})`);
                await this.logService.logMessage('info', 
                    `Zablokowano obraz od ${message.author.tag} na kanale #${message.channel.name}`, 
                    message
                );

                return; // Zatrzymaj dalsze przetwarzanie
            }
        } catch (error) {
            logger.error(`❌ Błąd obsługi blokady obrazów: ${error.message}`);
        }
    }

    /**
     * Obsługuje blokadę słów w wiadomościach
     * @param {Message} message - Wiadomość do sprawdzenia
     * @returns {Array} - Lista znalezionych zablokowanych słów
     */
    async handleWordBlock(message) {
        try {
            // Inicjalizuj serwis jeśli nie istnieje
            if (!this.wordBlockService) {
                await this.initializeWordBlockService();
            }

            // Sprawdź czy wiadomość zawiera zablokowane słowa
            const blockedWords = this.wordBlockService.checkForBlockedWords(message.content);
            
            if (blockedWords.length > 0) {
                // Usuń wiadomość
                try {
                    await message.delete();
                } catch (error) {
                    logger.error(`❌ Nie można usunąć wiadomości z zablokowanymi słowami: ${error.message}`);
                }

                // Przetwórz każde zablokowane słowo
                for (const blockedWordInfo of blockedWords) {
                    const { word, blockInfo } = blockedWordInfo;
                    
                    // Wyślij powiadomienie użytkownikowi
                    let warningMessage = `🚫 Użyłeś zabronionego wyrażenia!\n`;

                    // Zastosuj timeout jeśli jest skonfigurowany
                    if (blockInfo.shouldTimeout && blockInfo.timeoutDurationMinutes) {
                        try {
                            const timeoutDuration = blockInfo.timeoutDurationMinutes * 60 * 1000;
                            await message.member.timeout(timeoutDuration, `Użycie zablokowanego słowa: "${word}"`);
                            
                            const timeoutFormatted = this.formatTimeDisplay(blockInfo.timeoutDurationMinutes);
                            warningMessage += `⏱️ Otrzymujesz timeout na: **${timeoutFormatted}**`;
                            
                            logger.info(`⏱️ Nadano timeout ${timeoutFormatted} użytkownikowi ${message.author.tag} za słowo "${word}"`);
                        } catch (timeoutError) {
                            logger.error(`❌ Nie można nadać timeout użytkownikowi ${message.author.tag}: ${timeoutError.message}`);
                            warningMessage += `❌ Nie udało się nadać timeout`;
                        }
                    } else {
                        warningMessage += `ℹ️ Tylko usuwanie wiadomości - bez timeout`;
                    }

                    try {
                        // Wyślij TYLKO wiadomość prywatną - absolutnie nic publicznie
                        await message.author.send(warningMessage);
                    } catch (dmError) {
                        // Jeśli DM nie działa - MILCZ. Nie wysyłaj niczego publicznego.
                        logger.info(`ℹ️ Nie można wysłać DM do ${message.author.tag} o zablokowanym słowie - pomijam powiadomienie`);
                    }

                    // Loguj blokadę
                    logger.info(`🚫 Zablokowano słowo "${word}" od ${message.author.tag} na kanale #${message.channel.name}`);
                    await this.logService.logMessage('info', 
                        `Zablokowano słowo "${word}" od ${message.author.tag} na kanale #${message.channel.name}`, 
                        message
                    );
                }

                return blockedWords;
            }

            return [];
        } catch (error) {
            logger.error(`❌ Błąd obsługi blokady słów: ${error.message}`);
            return [];
        }
    }

    /**
     * Formatuje minuty na czytelny format czasu
     * @param {number} totalMinutes - Łączna liczba minut
     * @returns {string} - Sformatowany czas (np. "1h 30m")
     */
    formatTimeDisplay(totalMinutes) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        
        return parts.join(' ');
    }

    /**
     * Tworzy reply do wiadomości (bez usuwania, z pingiem)
     * @param {Message} message - Wiadomość do której reply
     * @param {string} content - Treść wiadomości
     */
    async createEphemeralReply(message, content) {
        try {
            // Stwórz zwykły reply z pingiem i bez usuwania
            await message.reply({
                content: content
                // allowedMentions domyślnie pozwala na ping
            });
        } catch (error) {
            // Fallback - wyślij na kanał
            await message.channel.send(content);
        }
    }
}

module.exports = MessageHandler;