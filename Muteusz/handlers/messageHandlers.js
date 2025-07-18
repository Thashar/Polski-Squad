const { formatMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const AutoModerationService = require('../services/autoModerationService');
const WarningService = require('../services/warningService');

const logger = createBotLogger('Muteusz');

class MessageHandler {
    constructor(config, mediaService, logService) {
        this.config = config;
        this.mediaService = mediaService;
        this.logService = logService;
        this.warningService = new WarningService(config, logger);
        this.autoModerationService = new AutoModerationService(config, logger, this.warningService);
        
        // Uruchom czyszczenie co 5 minut
        setInterval(() => {
            this.autoModerationService.cleanup();
        }, 5 * 60 * 1000);
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
        
        // Obsługa załączników (oryginalny kod)
        if (message.attachments.size > 0 && message.channel.id !== this.config.media.targetChannelId) {
            await this.mediaService.repostMedia(message, client);
        }

        // Auto-moderacja
        await this.handleAutoModeration(message);
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
                await this.logService.logMessage('error', `Błąd auto-moderacji: ${error.message}`, message);
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