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
     * Pobiera jednostkę z wyniku tekstowego
     * @param {string} scoreText - Tekst wyniku
     * @returns {string} - Jednostka lub pusty string
     */
    getScoreUnit(scoreText) {
        const upperScore = scoreText.toUpperCase().trim();
        const match = upperScore.match(/^(\d+(?:\.\d+)?)([KMBTQ]|QI)?$/);
        return match && match[2] ? match[2] : '';
    }

    /**
     * Formatuje progres w określonej jednostce
     * @param {number} improvement - Wartość progreso w jednostkach bazowych
     * @param {string} targetUnit - Docelowa jednostka
     * @returns {string} - Sformatowany progres
     */
    formatProgressInUnit(improvement, targetUnit) {
        if (!targetUnit) {
            return `+${improvement}`;
        }

        const unitValue = this.config.scoring.units[targetUnit];
        if (!unitValue) {
            return `+${this.formatScore(improvement)}`;
        }

        const unitImprovement = improvement / unitValue;
        const formattedValue = unitImprovement % 1 === 0 ? 
            unitImprovement.toString() : 
            unitImprovement.toFixed(2);
        
        return `+${formattedValue}${targetUnit}`;
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
        
        // Tworzymy ranking w prostym formacie
        const medals = this.config.scoring.medals;
        
        let rankingText = '';
        
        for (const [index, player] of currentPagePlayers.entries()) {
            const actualPosition = startIndex + index + 1;
            let position;
            if (actualPosition <= 3) {
                const medalMap = { 1: '🥇', 2: '🥈', 3: '🥉' };
                position = medalMap[actualPosition];
            } else {
                position = `${actualPosition}.`;
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
            
            // Wyróżnij tylko osobę, która wywołuje ranking
            const isCurrentUser = player.userId === userId;
            const nickDisplay = isCurrentUser ? `**${displayName}**` : displayName;
            
            // Prosty format: pozycja nick • wynik (data) • boss
            rankingText += `${position} ${nickDisplay} • **${this.formatScore(player.scoreValue)}** *(${shortDate})* • ${bossName}\n`;
            
            // Sprawdź limity Discord
            if (rankingText.length > 1800) {
                break;
            }
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(this.config.messages.rankingTitle)
            .setDescription(rankingText)
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
     * @param {string} attachmentName - Nazwa załącznika ze zdjęciem (opcjonalny)
     * @returns {EmbedBuilder} - Embed wyniku
     */
    createResultEmbed(userName, bestScore, currentScore, attachmentName = null) {
        const currentScoreValue = currentScore ? this.parseScoreValue(currentScore) : 0;
        const newScoreValue = this.parseScoreValue(bestScore);
        const difference = currentScoreValue - newScoreValue;
        const differenceText = difference > 0 ? `+${this.formatScore(difference)}` : this.formatScore(Math.abs(difference));
        
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
                    value: formatMessage(this.config.messages.resultNotBeaten, { currentScore: currentScore || 'Brak poprzedniego wyniku' }) + `\n**Różnica:** ${differenceText}`,
                    inline: false
                }
            )
            .setTimestamp();
        
        if (attachmentName) {
            embed.setImage(`attachment://${attachmentName}`);
        }
        
        return embed;
    }

    /**
     * Tworzy embed nowego rekordu
     * @param {string} userName - Nazwa użytkownika
     * @param {string} bestScore - Najlepszy wynik
     * @param {string} userAvatarUrl - URL awatara użytkownika
     * @param {string} attachmentName - Nazwa załącznika
     * @param {string} previousScore - Poprzedni wynik (opcjonalny)
     * @returns {EmbedBuilder} - Embed rekordu
     */
    createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName, previousScore = null) {
        let newScoreText = `**${bestScore}**`;
        
        if (previousScore) {
            const previousScoreValue = this.parseScoreValue(previousScore);
            const newScoreValue = this.parseScoreValue(bestScore);
            const improvement = newScoreValue - previousScoreValue;
            
            // Formatuj progres w tej samej jednostce co nowy wynik
            const newScoreUnit = this.getScoreUnit(bestScore);
            const improvementText = this.formatProgressInUnit(improvement, newScoreUnit);
            
            newScoreText = `${bestScore} (progres ${improvementText})`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(this.config.messages.recordTitle)
            .setDescription(formatMessage(this.config.messages.recordDescription, { username: userName }))
            .setThumbnail(userAvatarUrl)
            .addFields(
                {
                    name: '🏆 Nowy wynik',
                    value: newScoreText,
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

    /**
     * Usuwa gracza z rankingu
     * @param {string} userId - ID użytkownika do usunięcia
     * @returns {Promise<boolean>} - True jeśli gracz został usunięty, false jeśli nie był w rankingu
     */
    async removePlayerFromRanking(userId) {
        try {
            const ranking = await this.loadRanking();
            
            if (ranking[userId]) {
                delete ranking[userId];
                await this.saveRanking(ranking);
                logger.info(`🗑️ Usunięto gracza ${userId} z rankingu`);
                return true;
            }
            
            return false;
        } catch (error) {
            logger.error('❌ Błąd podczas usuwania gracza z rankingu:', error);
            return false;
        }
    }
}

module.exports = RankingService;