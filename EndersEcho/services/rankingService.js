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

            // Eksportuj posortowany ranking do shared_data
            await this.saveSharedRanking(ranking);
        } catch (error) {
            logger.error('Błąd zapisu rankingu:', error);
            throw error;
        }
    }

    /**
     * Eksportuje posortowany ranking do shared_data/endersecho_ranking.json
     * Używany przez inne boty (np. Stalker /player-status)
     */
    async saveSharedRanking(ranking) {
        try {
            const path = require('path');
            const sharedDir = path.join(__dirname, '../../../shared_data');
            await fs.mkdir(sharedDir, { recursive: true });

            const sorted = Object.values(ranking)
                .sort((a, b) => b.scoreValue - a.scoreValue)
                .map((player, index) => ({
                    rank: index + 1,
                    userId: player.userId,
                    username: player.username,
                    score: player.score,
                    scoreValue: player.scoreValue,
                    bossName: player.bossName || null,
                    timestamp: player.timestamp
                }));

            const sharedData = {
                updatedAt: new Date().toISOString(),
                players: sorted
            };

            const sharedPath = path.join(sharedDir, 'endersecho_ranking.json');
            await fs.writeFile(sharedPath, JSON.stringify(sharedData, null, 2), 'utf8');
        } catch (error) {
            logger.error('Błąd eksportu rankingu do shared_data:', error);
            // Nie rzucamy błędu — to operacja pomocnicza
        }
    }

    /**
     * Konwertuje tekst wyniku na wartość liczbową
     * @param {string} scoreText - Tekst wyniku
     * @returns {number} - Wartość liczbowa
     */
    parseScoreValue(scoreText) {
        const upperScore = scoreText.toUpperCase().trim();
        const match = upperScore.match(/^(\d+(?:\.\d+)?)(QI|[KMBTQ])?$/);
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
        const match = upperScore.match(/^(\d+(?:\.\d+)?)(QI|[KMBTQ])?$/);
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
            Math.floor(unitImprovement).toString() :
            parseFloat(unitImprovement.toFixed(2)).toString();

        // Zamień QI na Qi dla wyświetlania
        const displayUnit = targetUnit === 'QI' ? 'Qi' : targetUnit;

        return `+${formattedValue}${displayUnit}`;
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
            try {
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
                
                // Pobierz nick na serwerze (displayName to nickname użytkownika na serwerze)
                let displayName = player.username || `ID:${player.userId}`;
                try {
                    if (guild) {
                        const member = await guild.members.fetch(player.userId);
                        displayName = member.displayName; // displayName to server nickname
                    }
                } catch (error) {
                    // Jeśli nie można pobrać membera, używamy zapisanego username jako fallback
                    // displayName zostaje jako player.username lub ID
                }
                
                const bossName = player.bossName || 'Nieznany';
                
                // Wyróżnij tylko osobę, która wywołuje ranking
                const isCurrentUser = player.userId === userId;
                const nickDisplay = isCurrentUser ? `**${displayName}**` : displayName;
                
                // Prosty format: pozycja nick • wynik (data) • boss
                const lineText = `${position} ${nickDisplay} • **${this.formatScore(player.scoreValue)}** *(${shortDate})* • ${bossName}\n`;
                rankingText += lineText;
                
                // Sprawdź limity Discord
                if (rankingText.length > 1800) {
                    logger.warn(`⚠️ Osiągnięto limit 1800 znaków, przerywam na pozycji ${actualPosition}`);
                    break;
                }
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania gracza ${index}: ${error.message}`);
                logger.error('Player data:', player);
                // Kontynuuj z następnym graczem zamiast przerywać całą pętlę
                continue;
            }
        }
        
        
        // Sprawdź czy rankingText nie jest pusty
        if (!rankingText.trim()) {
            logger.error('❌ BŁĄD: rankingText jest pusty!');
            rankingText = '⚠️ Brak danych do wyświetlenia na tej stronie';
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(this.config.messages.rankingTitle)
            .setDescription(rankingText)
            .addFields(
                {
                    name: this.config.messages.rankingStats,
                    value: formatMessage(this.config.messages.rankingPlayersCount, { count: players.length }) + 
                           (players.length > 0 ? '\n' + formatMessage(this.config.messages.rankingHighestScore, { score: this.formatScore(players[0].scoreValue) }) : ''),
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
     * @param {string} bossName - Nazwa bossa (opcjonalny)
     * @returns {EmbedBuilder} - Embed wyniku
     */
    createResultEmbed(userName, bestScore, currentScore, attachmentName = null, bossName = null) {
        const logger = require('../../utils/consoleLogger').createBotLogger('EndersEcho');
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: createResultEmbed - Rozpoczynam tworzenie embed');
            logger.info('🔍 DEBUG: createResultEmbed - Parametry wejściowe:');
            logger.info('🔍 DEBUG: - userName: "' + userName + '"');
            logger.info('🔍 DEBUG: - bestScore: "' + bestScore + '"');
            logger.info('🔍 DEBUG: - currentScore: "' + currentScore + '"');
            logger.info('🔍 DEBUG: - attachmentName: "' + attachmentName + '"');
        }
        
        try {
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: Sprawdzam currentScore i wywołuję parseScoreValue');
            }
            const currentScoreValue = currentScore ? this.parseScoreValue(currentScore) : 0;
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: currentScoreValue: ' + currentScoreValue);
                logger.info('🔍 DEBUG: Parsowanie bestScore');
            }
            
            const newScoreValue = this.parseScoreValue(bestScore);
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: newScoreValue: ' + newScoreValue);
                logger.info('🔍 DEBUG: Obliczanie różnicy');
            }
            
            const difference = currentScoreValue - newScoreValue;
            const differenceText = difference > 0 ? `+${this.formatScore(difference)}` : this.formatScore(Math.abs(difference));
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: difference: ' + difference);
                logger.info('🔍 DEBUG: differenceText: "' + differenceText + '"');
            }
        } catch (parseError) {
            logger.error('🔍 DEBUG: Błąd podczas parsowania wartości w createResultEmbed:');
            logger.error('🔍 DEBUG: parseError message: ' + parseError.message);
            logger.error('🔍 DEBUG: parseError stack: ' + parseError.stack);
            throw parseError;
        }
        
        const currentScoreValue = currentScore ? this.parseScoreValue(currentScore) : 0;
        const newScoreValue = this.parseScoreValue(bestScore);
        const difference = currentScoreValue - newScoreValue;
        const differenceText = difference > 0 ? `+${this.formatScore(difference)}` : this.formatScore(Math.abs(difference));
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: Tworzenie EmbedBuilder');
        }
        
        try {
            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle(this.config.messages.resultTitle);
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: Podstawowy embed utworzony');
                logger.info('🔍 DEBUG: Dodawanie pól do embed');
                logger.info('🔍 DEBUG: resultPlayer field - name: "' + this.config.messages.resultPlayer + '", value: "' + userName + '"');
                logger.info('🔍 DEBUG: resultScore field - name: "' + this.config.messages.resultScore + '", value: "' + bestScore + '"');
            }
            
            const statusMessage = formatMessage(this.config.messages.resultNotBeaten, { currentScore: currentScore || 'Brak poprzedniego wyniku' });
            const fullStatusValue = statusMessage + `\n**Różnica:** ${differenceText}`;
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: statusMessage: "' + statusMessage + '"');
                logger.info('🔍 DEBUG: fullStatusValue: "' + fullStatusValue + '"');
            }
            
            const fields = [
                {
                    name: this.config.messages.resultPlayer,
                    value: userName,
                    inline: true
                },
                {
                    name: this.config.messages.resultScore,
                    value: bestScore,
                    inline: true
                }
            ];

            // Dodaj pole z bossem jeśli dostępne
            if (bossName) {
                fields.push({
                    name: '👹 Boss',
                    value: bossName,
                    inline: false
                });
            }

            // Dodaj status na końcu
            fields.push({
                name: this.config.messages.resultStatus,
                value: fullStatusValue,
                inline: false
            });

            embed.addFields(fields);
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: Pola dodane do embed');
            }
            
            embed.setTimestamp();
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: Timestamp ustawiony');
            }
            
            if (attachmentName) {
                if (this.config.ocr.detailedLogging.enabled) {
                    logger.info('🔍 DEBUG: Ustawianie obrazu attachment: ' + attachmentName);
                }
                embed.setImage(`attachment://${attachmentName}`);
                if (this.config.ocr.detailedLogging.enabled) {
                    logger.info('🔍 DEBUG: Obraz ustawiony');
                }
            } else {
                if (this.config.ocr.detailedLogging.enabled) {
                    logger.info('🔍 DEBUG: Brak attachmentName - pomijam obraz');
                }
            }
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: createResultEmbed zakończone pomyślnie');
            }
            return embed;
        } catch (embedError) {
            logger.error('🔍 DEBUG: Błąd podczas tworzenia embed w createResultEmbed:');
            logger.error('🔍 DEBUG: embedError message: ' + embedError.message);
            logger.error('🔍 DEBUG: embedError stack: ' + embedError.stack);
            throw embedError;
        }
    }

    /**
     * Tworzy embed nowego rekordu
     * @param {string} userName - Nazwa użytkownika
     * @param {string} bestScore - Najlepszy wynik
     * @param {string} userAvatarUrl - URL awatara użytkownika
     * @param {string} attachmentName - Nazwa załącznika
     * @param {string} previousScore - Poprzedni wynik (opcjonalny)
     * @param {string} userId - ID użytkownika (opcjonalny)
     * @returns {EmbedBuilder} - Embed rekordu
     */
    async createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName, previousScore = null, userId = null) {
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

        // Pobierz pozycję w rankingu jeśli userId jest podany
        let rankingText = '';
        if (userId) {
            try {
                const sortedPlayers = await this.getSortedPlayers();
                const userIndex = sortedPlayers.findIndex(player => player.userId === userId);
                
                if (userIndex !== -1) {
                    const currentPosition = userIndex + 1;
                    
                    // Sprawdź poprzednią pozycję jeśli był poprzedni wynik
                    if (previousScore) {
                        // Stwórz tymczasowy ranking z poprzednim wynikiem
                        const tempPlayers = [...sortedPlayers];
                        const userPlayer = tempPlayers.find(p => p.userId === userId);
                        if (userPlayer) {
                            userPlayer.scoreValue = this.parseScoreValue(previousScore);
                            tempPlayers.sort((a, b) => b.scoreValue - a.scoreValue);
                            const previousIndex = tempPlayers.findIndex(player => player.userId === userId);
                            const previousPosition = previousIndex + 1;
                            const positionChange = previousPosition - currentPosition;
                            
                            if (positionChange > 0) {
                                rankingText = `Miejsce w rankingu: ${currentPosition} (Awans o +${positionChange})`;
                            } else {
                                rankingText = `Miejsce w rankingu: ${currentPosition}`;
                            }
                        } else {
                            rankingText = `Miejsce w rankingu: ${currentPosition}`;
                        }
                    } else {
                        // Pierwszy wynik - brak poprzedniej pozycji do porównania
                        rankingText = `Miejsce w rankingu: ${currentPosition} (nowy w rankingu)`;
                    }
                }
            } catch (error) {
                logger.error('Błąd pobierania pozycji w rankingu:', error);
            }
        }
        
        const embedFields = [
            {
                name: '🏆 Nowy wynik',
                value: newScoreText,
                inline: true
            },
            {
                name: this.config.messages.recordDate,
                value: new Date().toLocaleDateString('pl-PL'),
                inline: true
            }
        ];

        // Dodaj pole z pozycją w rankingu jeśli jest dostępne - przeniesione wyżej
        if (rankingText) {
            embedFields.push({
                name: '📊 Ranking',
                value: rankingText,
                inline: false
            });
        }

        embedFields.push({
            name: this.config.messages.recordStatus,
            value: this.config.messages.recordSaved,
            inline: false
        });
        
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(this.config.messages.recordTitle)
            .setDescription(formatMessage(this.config.messages.recordDescription, { username: userName }))
            .setThumbnail(userAvatarUrl)
            .addFields(embedFields)
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
        const logger = require('../../utils/consoleLogger').createBotLogger('EndersEcho');
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: updateUserRanking - Start');
            logger.info('🔍 DEBUG: updateUserRanking - userId: ' + userId);
            logger.info('🔍 DEBUG: updateUserRanking - userName: "' + userName + '"');
            logger.info('🔍 DEBUG: updateUserRanking - bestScore: "' + bestScore + '"');
            logger.info('🔍 DEBUG: updateUserRanking - bossName: "' + bossName + '"');
        }
        
        const ranking = await this.loadRanking();
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: updateUserRanking - Ranking załadowany');
        }
        
        const newScoreValue = this.parseScoreValue(bestScore);
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: updateUserRanking - newScoreValue: ' + newScoreValue);
        }
        
        const currentScore = ranking[userId];
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: updateUserRanking - currentScore: ' + (currentScore ? JSON.stringify(currentScore) : 'null'));
        }
        
        let isNewRecord = false;
        
        if (!currentScore) {
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: updateUserRanking - Użytkownik nie ma poprzedniego wyniku - to będzie nowy rekord');
            }
            isNewRecord = true;
        } else {
            const currentScoreValue = this.parseScoreValue(currentScore.score);
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: updateUserRanking - currentScoreValue: ' + currentScoreValue);
                logger.info('🔍 DEBUG: updateUserRanking - Porównanie: newScoreValue (' + newScoreValue + ') > currentScoreValue (' + currentScoreValue + ') = ' + (newScoreValue > currentScoreValue));
            }
            
            if (newScoreValue > currentScoreValue) {
                if (this.config.ocr.detailedLogging.enabled) {
                    logger.info('🔍 DEBUG: updateUserRanking - Nowy wynik jest lepszy - to będzie nowy rekord');
                }
                isNewRecord = true;
            } else {
                if (this.config.ocr.detailedLogging.enabled) {
                    logger.info('🔍 DEBUG: updateUserRanking - Nowy wynik NIE jest lepszy - nie ma rekordu');
                }
            }
        }
        
        if (isNewRecord) {
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: updateUserRanking - Zapisywanie nowego rekordu');
            }
            ranking[userId] = {
                score: bestScore,
                username: userName,
                timestamp: new Date().toISOString(),
                scoreValue: newScoreValue,
                userId: userId,
                bossName: bossName || 'Nieznany boss'
            };
            await this.saveRanking(ranking);
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: updateUserRanking - Nowy rekord zapisany');
            }
        }
        
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info('🔍 DEBUG: updateUserRanking - Zwracanie rezultatu: isNewRecord=' + isNewRecord);
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