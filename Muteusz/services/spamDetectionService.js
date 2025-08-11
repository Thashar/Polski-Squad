const { EmbedBuilder } = require('discord.js');

/**
 * Serwis do wykrywania spamu z linkami zewnętrznymi
 */
class SpamDetectionService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // Przechowywanie wiadomości z linkami: userId -> Array<{content, timestamp, messageId, channelId}>
        this.userMessages = new Map();
        
        // Konfiguracja z config.js
        this.enabled = config.spamDetection?.enabled ?? true;
        this.maxDuplicates = config.spamDetection?.maxDuplicates ?? 3;
        this.timeWindow = config.spamDetection?.timeWindow ?? (30 * 60 * 1000);
        this.timeoutDuration = config.spamDetection?.timeoutDuration ?? (7 * 24 * 60 * 60 * 1000);
        this.alertChannelId = config.spamDetection?.alertChannelId ?? '1173653205557719140';
        
        // Czyszczenie co 5 minut
        setInterval(() => {
            this.cleanupOldMessages();
        }, 5 * 60 * 1000);
        
        this.logger.info(`🔍 SpamDetectionService zainicjalizowany - wykrywanie duplikatów linków zewnętrznych i zaproszeń Discord (timeout: ${this.timeoutDuration / (24 * 60 * 60 * 1000)} dni)`);
    }
    
    /**
     * Sprawdza wiadomość pod kątem spamu z linkami
     * @param {Message} message - Wiadomość Discord
     * @returns {Object} Wynik analizy {isSpam, action, duplicateCount}
     */
    async processMessage(message) {
        // Sprawdź czy detekcja spamu jest włączona
        if (!this.enabled) {
            return { isSpam: false, action: 'disabled' };
        }
        
        // Ignoruj tylko boty i administratorów (nie moderatorów)
        if (message.author.bot || 
            message.member?.permissions.has('Administrator')) {
            return { isSpam: false, action: 'ignore' };
        }
        
        // Sprawdź czy wiadomość zawiera linki zewnętrzne lub zaproszenia Discord
        const suspiciousLinks = this.extractSuspiciousLinks(message.content);
        if (suspiciousLinks.length === 0) {
            return { isSpam: false, action: 'ignore' };
        }
        
        const userId = message.author.id;
        const now = Date.now();
        
        // Pobierz historię wiadomości użytkownika
        if (!this.userMessages.has(userId)) {
            this.userMessages.set(userId, []);
        }
        
        const userHistory = this.userMessages.get(userId);
        
        // Usuń stare wiadomości (poza oknem czasowym)
        const recentMessages = userHistory.filter(msg => 
            now - msg.timestamp < this.timeWindow
        );
        
        // Sprawdź duplikaty
        const duplicates = recentMessages.filter(msg => 
            this.normalizeMessage(msg.content) === this.normalizeMessage(message.content)
        );
        
        const duplicateCount = duplicates.length + 1; // +1 za aktualną wiadomość
        
        // Dodaj aktualną wiadomość do historii
        recentMessages.push({
            content: message.content,
            timestamp: now,
            messageId: message.id,
            channelId: message.channel.id
        });
        
        // Zaktualizuj historię użytkownika
        this.userMessages.set(userId, recentMessages);
        
        this.logger.info(`🔍 ${message.author.tag} - duplikaty z linkami: ${duplicateCount}/${this.maxDuplicates}`);
        
        // Jeśli osiągnięto limit duplikatów
        if (duplicateCount >= this.maxDuplicates) {
            this.logger.warn(`🚨 SPAM DETECT: ${message.author.tag} wysłał ${duplicateCount} identycznych wiadomości z linkami/zaproszeniami`);
            
            return {
                isSpam: true,
                action: 'timeout',
                duplicateCount: duplicateCount,
                duplicateMessages: [...duplicates, {
                    content: message.content,
                    timestamp: now,
                    messageId: message.id,
                    channelId: message.channel.id
                }]
            };
        }
        
        return { isSpam: false, action: 'monitor', duplicateCount };
    }
    
    /**
     * Wyciąga podejrzane linki z wiadomości (zewnętrzne + zaproszenia Discord)
     * @param {string} content - Treść wiadomości
     * @returns {Array} Tablica znalezionych linków
     */
    extractSuspiciousLinks(content) {
        const links = [];
        
        // 1. Linki zewnętrzne (nie Discord)
        const externalUrlRegex = /https?:\/\/(?!(?:discord\.gg|discord\.com|discordapp\.com))[^\s]+/gi;
        const externalLinks = content.match(externalUrlRegex) || [];
        links.push(...externalLinks);
        
        // 2. Zaproszenia Discord (wszystkie formy)
        const discordInviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;
        const discordInvites = content.match(discordInviteRegex) || [];
        links.push(...discordInvites);
        
        return links;
    }
    
    /**
     * Wyciąga linki zewnętrzne z wiadomości (stara funkcja - zachowana dla kompatybilności)
     * @param {string} content - Treść wiadomości
     * @returns {Array} Tablica znalezionych linków
     */
    extractExternalLinks(content) {
        return this.extractSuspiciousLinks(content);
    }
    
    /**
     * Normalizuje wiadomość do porównania (usuwa białe znaki, zmienia na małe litery)
     * @param {string} content - Treść wiadomości
     * @returns {string} Znormalizowana treść
     */
    normalizeMessage(content) {
        return content.toLowerCase().replace(/\s+/g, ' ').trim();
    }
    
    /**
     * Wykonuje akcje antyspamowe
     * @param {Message} message - Wiadomość Discord
     * @param {Object} result - Wynik analizy spamu
     */
    async executeAntiSpamActions(message, result) {
        if (!result.isSpam || result.action !== 'timeout') {
            return;
        }
        
        try {
            // 1. Usuń wszystkie duplikaty wiadomości
            await this.deleteSpamMessages(message, result.duplicateMessages);
            
            // 2. Daj timeout użytkownikowi
            await this.timeoutUser(message.member);
            
            // 3. Wyślij powiadomienie na kanał administracyjny
            await this.sendAlertNotification(message, result);
            
            this.logger.success(`✅ Wykonano akcje antyspamowe dla ${message.author.tag}`);
            
        } catch (error) {
            this.logger.error(`❌ Błąd podczas wykonywania akcji antyspamowych: ${error.message}`);
        }
    }
    
    /**
     * Usuwa spam wiadomości
     * @param {Message} currentMessage - Aktualna wiadomość
     * @param {Array} duplicateMessages - Lista duplikatów do usunięcia
     */
    async deleteSpamMessages(currentMessage, duplicateMessages) {
        let deletedCount = 0;
        
        for (const msgData of duplicateMessages) {
            try {
                const channel = currentMessage.guild.channels.cache.get(msgData.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(msgData.messageId).catch(() => null);
                    if (message) {
                        await message.delete();
                        deletedCount++;
                        this.logger.info(`🗑️ Usunięto spam wiadomość ${msgData.messageId} z kanału #${channel.name}`);
                    }
                }
            } catch (error) {
                this.logger.warn(`⚠️ Nie można usunąć wiadomości ${msgData.messageId}: ${error.message}`);
            }
        }
        
        this.logger.info(`🗑️ Usunięto ${deletedCount}/${duplicateMessages.length} spam wiadomości`);
    }
    
    /**
     * Daje timeout użytkownikowi
     * @param {GuildMember} member - Członek do timeout
     */
    async timeoutUser(member) {
        try {
            const timeoutUntil = new Date(Date.now() + this.timeoutDuration);
            await member.timeout(this.timeoutDuration, 'Spam z linkami zewnętrznymi/zaproszeniami Discord - automatyczny timeout');
            
            this.logger.warn(`⏰ Timeout na 7 dni dla ${member.user.tag} do ${timeoutUntil.toLocaleString('pl-PL')}`);
        } catch (error) {
            this.logger.error(`❌ Nie można dać timeout ${member.user.tag}: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Wysyła powiadomienie na kanał administracyjny
     * @param {Message} message - Oryginalna wiadomość
     * @param {Object} result - Wynik analizy spamu
     */
    async sendAlertNotification(message, result) {
        try {
            const alertChannel = message.guild.channels.cache.get(this.alertChannelId);
            if (!alertChannel) {
                this.logger.warn(`⚠️ Nie znaleziono kanału alertów: ${this.alertChannelId}`);
                return;
            }
            
            const timeoutEnd = new Date(Date.now() + this.timeoutDuration);
            
            const embed = new EmbedBuilder()
                .setTitle('🚨 SPAM DETECTED - Automatyczny Timeout')
                .setColor('#ff4444')
                .setDescription(`Użytkownik wysłał ${result.duplicateCount} identycznych wiadomości z linkami zewnętrznymi lub zaproszeniami Discord`)
                .addFields(
                    {
                        name: '👤 Użytkownik',
                        value: `${message.author.tag} (<@${message.author.id}>)\nID: \`${message.author.id}\``,
                        inline: true
                    },
                    {
                        name: '⏰ Timeout do',
                        value: `<t:${Math.floor(timeoutEnd.getTime() / 1000)}:F>\n(<t:${Math.floor(timeoutEnd.getTime() / 1000)}:R>)`,
                        inline: true
                    },
                    {
                        name: '📊 Statystyki',
                        value: `**Duplikaty:** ${result.duplicateCount}/${this.maxDuplicates}\n**Czas okna:** ${this.timeWindow / 60000} min\n**Czas timeout:** ${this.timeoutDuration / (24 * 60 * 60 * 1000)} dni`,
                        inline: true
                    },
                    {
                        name: '💬 Treść spam wiadomości',
                        value: message.content.length > 1024 ? 
                            message.content.substring(0, 1020) + '...' : 
                            message.content,
                        inline: false
                    },
                    {
                        name: '🔗 Wykryte linki',
                        value: this.extractSuspiciousLinks(message.content).join('\n') || 'Brak',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Muteusz Bot - Automatyczna detekcja spamu` 
                })
                .setTimestamp();
            
            await alertChannel.send({ embeds: [embed] });
            
            this.logger.success(`📢 Wysłano powiadomienie o spam na kanał ${alertChannel.name}`);
            
        } catch (error) {
            this.logger.error(`❌ Błąd wysyłania powiadomienia: ${error.message}`);
        }
    }
    
    /**
     * Czyści stare wiadomości z pamięci
     */
    cleanupOldMessages() {
        const now = Date.now();
        let totalCleaned = 0;
        
        for (const [userId, messages] of this.userMessages.entries()) {
            const recentMessages = messages.filter(msg => 
                now - msg.timestamp < this.timeWindow
            );
            
            const cleanedCount = messages.length - recentMessages.length;
            totalCleaned += cleanedCount;
            
            if (recentMessages.length === 0) {
                this.userMessages.delete(userId);
            } else {
                this.userMessages.set(userId, recentMessages);
            }
        }
        
        if (totalCleaned > 0) {
            this.logger.info(`🧹 Wyczyszczono ${totalCleaned} starych wiadomości z pamięci`);
        }
    }
    
    /**
     * Pobiera statystyki serwisu
     * @returns {Object} Statystyki
     */
    getStats() {
        const totalUsers = this.userMessages.size;
        let totalMessages = 0;
        
        for (const messages of this.userMessages.values()) {
            totalMessages += messages.length;
        }
        
        return {
            monitoredUsers: totalUsers,
            totalMessages: totalMessages,
            timeWindow: this.timeWindow / 60000, // w minutach
            maxDuplicates: this.maxDuplicates,
            timeoutDuration: this.timeoutDuration / (24 * 60 * 60 * 1000) // w dniach
        };
    }
}

module.exports = SpamDetectionService;