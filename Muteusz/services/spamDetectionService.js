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
        
        this.logger.info(`🔍 SpamDetectionService zainicjalizowany - wykrywanie duplikatów/podobnych wiadomości z linkami (timeout: ${this.timeoutDuration / (24 * 60 * 60 * 1000)} dni)`);
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
        
        // Sprawdź duplikaty (identyczne i podobne wiadomości z linkami)
        const duplicates = recentMessages.filter(msg => 
            this.areMessagesSimilar(msg.content, message.content)
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
        
        this.logger.info(`🔍 ${message.author.tag} - duplikaty/podobne z linkami: ${duplicateCount}/${this.maxDuplicates}`);
        
        // Jeśli osiągnięto limit duplikatów
        if (duplicateCount >= this.maxDuplicates) {
            this.logger.warn(`🚨 SPAM DETECT: ${message.author.tag} wysłał ${duplicateCount} identycznych/podobnych wiadomości z linkami/zaproszeniami`);
            
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
     * Sprawdza podobieństwo wiadomości z linkami (dla ukrytych linków w długim tekście)
     * @param {string} content1 - Pierwsza wiadomość
     * @param {string} content2 - Druga wiadomość
     * @returns {boolean} Czy wiadomości są podobne
     */
    areMessagesSimilar(content1, content2) {
        const normalized1 = this.normalizeMessage(content1);
        const normalized2 = this.normalizeMessage(content2);
        
        // Jeśli wiadomości są identyczne
        if (normalized1 === normalized2) {
            return true;
        }
        
        // Wyciągnij linki z obu wiadomości
        const links1 = this.extractSuspiciousLinks(content1);
        const links2 = this.extractSuspiciousLinks(content2);
        
        // Jeśli nie ma linków w obu, nie porównuj
        if (links1.length === 0 || links2.length === 0) {
            return false;
        }
        
        // Sprawdź czy mają wspólne linki
        const commonLinks = links1.filter(link => links2.includes(link));
        if (commonLinks.length === 0) {
            return false;
        }
        
        // Usuń linki z wiadomości i porównaj pozostały tekst
        let text1 = content1;
        let text2 = content2;
        
        // Usuń wszystkie podejrzane linki
        const allLinks = [...new Set([...links1, ...links2])];
        for (const link of allLinks) {
            const escapedLink = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text1 = text1.replace(new RegExp(escapedLink, 'gi'), '');
            text2 = text2.replace(new RegExp(escapedLink, 'gi'), '');
        }
        
        // Normalizuj teksty po usunięciu linków
        const normalizedText1 = this.normalizeMessage(text1);
        const normalizedText2 = this.normalizeMessage(text2);
        
        // Jeśli teksty są bardzo podobne (minimum 70% podobieństwa)
        const similarity = this.calculateTextSimilarity(normalizedText1, normalizedText2);
        
        this.logger.info(`🔍 Podobieństwo tekstów: ${(similarity * 100).toFixed(1)}% (${similarity >= 0.7 ? 'PODOBNE' : 'różne'})`);
        
        return similarity >= 0.7; // 70% podobieństwa
    }
    
    /**
     * Oblicza podobieństwo między dwoma tekstami (algorytm Jaro-Winkler uproszczony)
     * @param {string} text1 - Pierwszy tekst
     * @param {string} text2 - Drugi tekst  
     * @returns {number} Podobieństwo od 0 do 1
     */
    calculateTextSimilarity(text1, text2) {
        if (text1 === text2) return 1.0;
        if (text1.length === 0 && text2.length === 0) return 1.0;
        if (text1.length === 0 || text2.length === 0) return 0.0;
        
        // Uproszczony algorytm podobieństwa oparty na wspólnych słowach
        const words1 = text1.split(' ').filter(w => w.length > 2);
        const words2 = text2.split(' ').filter(w => w.length > 2);
        
        if (words1.length === 0 && words2.length === 0) return 1.0;
        if (words1.length === 0 || words2.length === 0) return 0.0;
        
        const commonWords = words1.filter(word => words2.includes(word));
        const totalWords = new Set([...words1, ...words2]).size;
        
        return commonWords.length / totalWords;
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
                .setDescription(`Użytkownik wysłał ${result.duplicateCount} identycznych/podobnych wiadomości z linkami zewnętrznymi lub zaproszeniami Discord`)
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