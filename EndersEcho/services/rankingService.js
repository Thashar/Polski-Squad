const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMessage } = require('../utils/helpers');

class RankingService {
    constructor(config) {
        this.config = config;
        this.activeRankings = new Map();
    }

    /**
     * Wczytuje ranking z pliku
     * @returns {Promise<Object>} - Obiekt z rankingiem
     */
    async loadRanking() {
        try {
            const data = await fs.readFile(this.config.ranking.file, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    /**
     * Zapisuje ranking do pliku
     * @param {Object} ranking - Obiekt z rankingiem
     */
    async saveRanking(ranking) {
        try {
            // Upewniamy się, że katalog istnieje
            const path = require('path');
            const dir = path.dirname(this.config.ranking.file);
            await fs.mkdir(dir, { recursive: true });
            
            await fs.writeFile(this.config.ranking.file, JSON.stringify(ranking, null, 2), 'utf8');
        } catch (error) {
            logger.error('Błąd zapisu rankingu:', error);
            throw error;
        }
    }

    /**
     * Konwertuje tekst wyniku na wartość liczbową
     * @param {string} scoreText - Tekst wyniku
     * @returns {number} - Wartość liczbowa
     */
    parseScoreValue(scoreText) {
        const upperScore = scoreText.toUpperCase().trim();
        const match = upperScore.match(/^(\d+(?:\.\d+)?)([KMBTQ]|QI)?$/);
        if (!match) return 0;
        
        const number = parseFloat(match[1]);
        const unit = match[2];
        
        return unit ? number * (this.config.scoring.units[unit] || 1) : number;
    }

    /**
     * Formatuje wartość liczbową na tekst z jednostkami
     * @param {number} value - Wartość liczbowa
     * @returns {string} - Sformatowany tekst
     */
    formatScore(value) {
        const units = [
            { name: 'Qi', value: 1000000000000000000 },
            { name: 'Q', value: 1000000000000000 },
            { name: 'T', value: 1000000000000 },
            { name: 'B', value: 1000000000 },
            { name: 'M', value: 1000000 },
            { name: 'K', value: 1000 }
        ];
        
        for (const unit of units) {
            if (value >= unit.value) {
                const unitValue = value / unit.value;
                return unitValue % 1 === 0 ? 
                    `${unitValue}${unit.name}` : 
                    `${unitValue.toFixed(2)}${unit.name}`;
            }
        }
        
        return value.toString();
    }

    /**
     * Tworzy embed rankingu
     * @param {Array} players - Lista graczy
     * @param {number} page - Aktualna strona
     * @param {number} totalPages - Całkowita liczba stron
     * @param {string} userId - ID użytkownika
     * @param {Guild} guild - Serwer Discord
     * @returns {EmbedBuilder} - Embed rankingu
     */
    async createRankingEmbed(players, page, totalPages, userId, guild) {
        const startIndex = page * this.config.ranking.playersPerPage;
        const endIndex = Math.min(startIndex + this.config.ranking.playersPerPage, players.length);
        const currentPagePlayers = players.slice(startIndex, endIndex);
        
        // Tworzymy ranking w formie tabeli (wymuszony układ poziomy)
        const medals = this.config.scoring.medals;
        
        let tableText = '';
        
        // Formatowanie w code block dla lepszego wyrównania
        tableText += '```\n';
        tableText += 'Pos  Nick               Wynik    Boss               Data\n';
        tableText += '===========================================================\n';
        
        for (const [index, player] of currentPagePlayers.entries()) {
            const actualPosition = startIndex + index + 1;
            let position;
            if (actualPosition <= 3) {
                const medalMap = { 1: '1st', 2: '2nd', 3: '3rd' };
                position = medalMap[actualPosition].padEnd(4);
            } else {
                position = `${actualPosition}.`.padEnd(4);
            }
            
            // Skrócona data - tylko dzień i miesiąc
            const date = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            
            // Pobierz nick na serwerze
            let displayName = player.username;
            try {
                const member = await guild.members.fetch(player.userId);
                displayName = member.displayName;
            } catch (error) {
                // Jeśli nie można pobrać membera, używamy zapisanego username
                logger.info(`Nie można pobrać membera ${player.userId}, używam zapisanego username`);
            }
            
            const bossName = player.bossName || 'Nieznany';
            
            // Funkcja do liczenia rzeczywistej szerokości wizualnej tekstu
            const getVisualWidth = (text) => {
                // Normalizuj tekst do formy NFD (decomposed) żeby rozdzielić znaki składowe
                const normalizedText = text.normalize('NFD');
                
                let width = 0;
                let i = 0;
                
                while (i < normalizedText.length) {
                    const code = normalizedText.codePointAt(i);
                    
                    // Znaki łączące (combining marks) - szerokość 0
                    if (code >= 0x0300 && code <= 0x036F || // Combining Diacritical Marks
                        code >= 0x1AB0 && code <= 0x1AFF || // Combining Diacritical Marks Extended
                        code >= 0x1DC0 && code <= 0x1DFF || // Combining Diacritical Marks Supplement
                        code >= 0x20D0 && code <= 0x20FF || // Combining Diacritical Marks for Symbols
                        code >= 0xFE20 && code <= 0xFE2F) { // Combining Half Marks
                        // Nie dodawaj szerokości dla znaków łączących
                    }
                    // Znaki ASCII i łacińskie - szerokość 1
                    else if (code <= 0x7F || (code >= 0x80 && code <= 0x24F)) {
                        width += 1;
                    }
                    // Znaki CJK i szerokie - szerokość 2
                    else if (code >= 0x1100 && code <= 0x11FF || // Hangul Jamo
                             code >= 0x2E80 && code <= 0x2EFF || // CJK Radicals
                             code >= 0x2F00 && code <= 0x2FDF || // Kangxi Radicals
                             code >= 0x3000 && code <= 0x303F || // CJK Symbols and Punctuation
                             code >= 0x3040 && code <= 0x309F || // Hiragana
                             code >= 0x30A0 && code <= 0x30FF || // Katakana
                             code >= 0x3100 && code <= 0x312F || // Bopomofo
                             code >= 0x3130 && code <= 0x318F || // Hangul Compatibility Jamo
                             code >= 0x3200 && code <= 0x32FF || // Enclosed CJK Letters and Months
                             code >= 0x3400 && code <= 0x4DBF || // CJK Extension A
                             code >= 0x4E00 && code <= 0x9FFF || // CJK Unified Ideographs
                             code >= 0xAC00 && code <= 0xD7AF || // Hangul Syllables
                             code >= 0xF900 && code <= 0xFAFF || // CJK Compatibility Ideographs
                             code >= 0xFF00 && code <= 0xFFEF || // Halfwidth and Fullwidth Forms
                             code >= 0x0400 && code <= 0x04FF) { // Cyrillic (dla Ӂ)
                        width += 2;
                    }
                    // Inne znaki - szerokość 1
                    else {
                        width += 1;
                    }
                    
                    // Przeskocz do następnego code point (może być 2-bajtowy)
                    i += (code > 0xFFFF) ? 2 : 1;
                }
                return width;
            };
            
            // Funkcja do dopełniania tekstu do określonej szerokości wizualnej
            const padToVisualWidth = (text, targetWidth) => {
                const currentWidth = getVisualWidth(text);
                const spacesNeeded = Math.max(0, targetWidth - currentWidth);
                return text + ' '.repeat(spacesNeeded);
            };
            
            // Funkcja do obcinania tekstu do określonej szerokości wizualnej
            const truncateToVisualWidth = (text, maxWidth) => {
                let result = '';
                let currentWidth = 0;
                
                for (let i = 0; i < text.length; i++) {
                    const char = text[i];
                    const charWidth = getVisualWidth(char);
                    
                    if (currentWidth + charWidth > maxWidth) {
                        break;
                    }
                    
                    result += char;
                    currentWidth += charWidth;
                }
                
                return result;
            };
            
            // Formatuj z odpowiednimi szerokościami wizualnymi
            const truncatedNick = truncateToVisualWidth(displayName, 18);
            const truncatedBoss = truncateToVisualWidth(bossName, 18);
            
            const nickCol = padToVisualWidth(truncatedNick, 18);
            const scoreCol = padToVisualWidth(this.formatScore(player.scoreValue), 8);
            const bossCol = padToVisualWidth(truncatedBoss, 18);
            const dateCol = padToVisualWidth(shortDate, 5);
            
            tableText += `${position} ${nickCol} ${scoreCol} ${bossCol} ${dateCol}\n`;
            
            // Sprawdź limity Discord
            if (tableText.length > 1800) {
                break;
            }
        }
        
        tableText += '```';
        
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(this.config.messages.rankingTitle)
            .setDescription(tableText)
            .addFields(
                {
                    name: this.config.messages.rankingStats,
                    value: formatMessage(this.config.messages.rankingPlayersCount, { count: players.length }) + 
                           '\n' + formatMessage(this.config.messages.rankingHighestScore, { score: this.formatScore(players[0].scoreValue) }),
                    inline: false
                }
            )
            .setFooter({ text: formatMessage(this.config.messages.rankingPage, { current: page + 1, total: totalPages }) })
            .setTimestamp();
        
        return embed;
    }

    /**
     * Tworzy przyciski nawigacji rankingu
     * @param {number} page - Aktualna strona
     * @param {number} totalPages - Całkowita liczba stron
     * @param {boolean} disabled - Czy przyciski mają być wyłączone
     * @returns {ActionRowBuilder} - Rząd przycisków
     */
    createRankingButtons(page, totalPages, disabled = false) {
        const row = new ActionRowBuilder();
        
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('ranking_first')
                .setLabel(this.config.messages.buttonFirst)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),
            
            new ButtonBuilder()
                .setCustomId('ranking_prev')
                .setLabel(this.config.messages.buttonPrev)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || page === 0),
            
            new ButtonBuilder()
                .setCustomId('ranking_next')
                .setLabel(this.config.messages.buttonNext)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || page >= totalPages - 1),
            
            new ButtonBuilder()
                .setCustomId('ranking_last')
                .setLabel(this.config.messages.buttonLast)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1)
        );
        
        return row;
    }

    /**
     * Tworzy embed wyniku (bez pobicia rekordu)
     * @param {string} userName - Nazwa użytkownika
     * @param {string} bestScore - Najlepszy wynik
     * @param {string} currentScore - Obecny wynik
     * @returns {EmbedBuilder} - Embed wyniku
     */
    createResultEmbed(userName, bestScore, currentScore) {
        const embed = new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle(this.config.messages.resultTitle)
            .addFields(
                {
                    name: this.config.messages.resultPlayer,
                    value: userName,
                    inline: true
                },
                {
                    name: this.config.messages.resultScore,
                    value: bestScore,
                    inline: true
                },
                {
                    name: this.config.messages.resultStatus,
                    value: formatMessage(this.config.messages.resultNotBeaten, { currentScore: currentScore }),
                    inline: false
                }
            )
            .setTimestamp();
        
        return embed;
    }

    /**
     * Tworzy embed nowego rekordu
     * @param {string} userName - Nazwa użytkownika
     * @param {string} bestScore - Najlepszy wynik
     * @param {string} userAvatarUrl - URL awatara użytkownika
     * @param {string} attachmentName - Nazwa załącznika
     * @returns {EmbedBuilder} - Embed rekordu
     */
    createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName) {
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(this.config.messages.recordTitle)
            .setDescription(formatMessage(this.config.messages.recordDescription, { username: userName }))
            .setThumbnail(userAvatarUrl)
            .addFields(
                {
                    name: this.config.messages.recordNewScore,
                    value: `**${bestScore}**`,
                    inline: true
                },
                {
                    name: this.config.messages.recordDate,
                    value: new Date().toLocaleDateString('pl-PL'),
                    inline: true
                },
                {
                    name: this.config.messages.recordStatus,
                    value: this.config.messages.recordSaved,
                    inline: false
                }
            )
            .setTimestamp()
            .setImage(`attachment://${attachmentName}`);
        
        return embed;
    }

    /**
     * Aktualizuje ranking użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} userName - Nazwa użytkownika
     * @param {string} bestScore - Najlepszy wynik
     * @param {string} bossName - Nazwa bossa
     * @returns {Promise<{isNewRecord: boolean, ranking: Object}>} - Wynik aktualizacji
     */
    async updateUserRanking(userId, userName, bestScore, bossName = null) {
        const ranking = await this.loadRanking();
        const newScoreValue = this.parseScoreValue(bestScore);
        
        const currentScore = ranking[userId];
        let isNewRecord = false;
        
        if (!currentScore || newScoreValue > this.parseScoreValue(currentScore.score)) {
            ranking[userId] = {
                score: bestScore,
                username: userName,
                timestamp: new Date().toISOString(),
                scoreValue: newScoreValue,
                userId: userId,
                bossName: bossName || 'Nieznany boss'
            };
            await this.saveRanking(ranking);
            isNewRecord = true;
        }
        
        return { isNewRecord, ranking, currentScore };
    }

    /**
     * Pobiera posortowanych graczy
     * @returns {Promise<Array>} - Lista posortowanych graczy
     */
    async getSortedPlayers() {
        const ranking = await this.loadRanking();
        const players = Object.entries(ranking).map(([userId, data]) => ({
            ...data,
            userId: userId
        }));
        
        return players.sort((a, b) => b.scoreValue - a.scoreValue);
    }

    /**
     * Dodaje aktywny ranking do cache
     * @param {string} messageId - ID wiadomości
     * @param {Object} rankingData - Dane rankingu
     */
    addActiveRanking(messageId, rankingData) {
        // Dodaj domyślny format jeśli nie jest określony
        if (rankingData.mobileFormat === undefined) {
            rankingData.mobileFormat = false;
        }
        
        this.activeRankings.set(messageId, rankingData);
        
        // Automatyczne czyszczenie
        setTimeout(() => {
            this.activeRankings.delete(messageId);
        }, this.config.ranking.paginationTimeout);
    }

    /**
     * Pobiera aktywny ranking
     * @param {string} messageId - ID wiadomości
     * @returns {Object|null} - Dane rankingu lub null
     */
    getActiveRanking(messageId) {
        return this.activeRankings.get(messageId) || null;
    }

    /**
     * Aktualizuje aktywny ranking
     * @param {string} messageId - ID wiadomości
     * @param {Object} rankingData - Dane rankingu
     */
    updateActiveRanking(messageId, rankingData) {
        this.activeRankings.set(messageId, rankingData);
    }
}

module.exports = RankingService;