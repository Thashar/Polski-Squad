const fs = require('fs').promises;
const path = require('path');
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
     * Zwraca ścieżkę do pliku rankingu dla danego serwera
     * @param {string} guildId
     * @returns {string}
     */
    getRankingFile(guildId) {
        return path.join(this.config.ranking.dataDir, `ranking_${guildId}.json`);
    }

    /**
     * Wczytuje ranking dla danego serwera.
     * Przy pierwszym wywołaniu na guild_1 sprawdza czy istnieje stary ranking.json i migruje go.
     * @param {string} guildId
     * @returns {Promise<Object>}
     */
    async loadRanking(guildId) {
        const file = this.getRankingFile(guildId);
        try {
            const data = await fs.readFile(file, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (this.config.guilds[0]?.id === guildId) {
                const legacy = await this._loadLegacyRanking();
                if (legacy) {
                    logger.info(`🔄 Migruję stary ranking.json do ranking_${guildId}.json`);
                    await this.saveRanking(guildId, legacy);
                    return legacy;
                }
            }
            return {};
        }
    }

    /**
     * Wczytuje stary ranking.json (migracja jednorazowa)
     * @returns {Promise<Object|null>}
     */
    async _loadLegacyRanking() {
        try {
            const data = await fs.readFile(this.config.ranking.legacyFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    /**
     * Zapisuje ranking dla danego serwera
     * @param {string} guildId
     * @param {Object} ranking
     */
    async saveRanking(guildId, ranking) {
        try {
            await fs.mkdir(this.config.ranking.dataDir, { recursive: true });
            const file = this.getRankingFile(guildId);
            await fs.writeFile(file, JSON.stringify(ranking, null, 2), 'utf8');
            await this.saveSharedRanking();
        } catch (error) {
            logger.error('Błąd zapisu rankingu:', error);
            throw error;
        }
    }

    /**
     * Buduje globalny ranking — najlepszy wynik gracza ze wszystkich serwerów.
     * @returns {Promise<Array>}
     */
    async getGlobalRanking() {
        const bestPerPlayer = new Map();

        for (const guild of this.config.guilds) {
            const ranking = await this.loadRanking(guild.id);
            for (const [userId, data] of Object.entries(ranking)) {
                const existing = bestPerPlayer.get(userId);
                if (!existing || data.scoreValue > existing.scoreValue) {
                    bestPerPlayer.set(userId, { ...data, userId, sourceGuildId: guild.id });
                }
            }
        }

        return Array.from(bestPerPlayer.values())
            .sort((a, b) => b.scoreValue - a.scoreValue);
    }

    /**
     * Eksportuje globalny ranking do shared_data/endersecho_ranking.json
     */
    async saveSharedRanking() {
        try {
            const sharedDir = path.join(__dirname, '../../shared_data');
            await fs.mkdir(sharedDir, { recursive: true });

            const sorted = await this.getGlobalRanking();
            const players = sorted.map((player, index) => ({
                rank: index + 1,
                userId: player.userId,
                username: player.username,
                score: player.score,
                scoreValue: player.scoreValue,
                bossName: player.bossName || null,
                timestamp: player.timestamp,
                sourceGuildId: player.sourceGuildId
            }));

            const sharedData = { updatedAt: new Date().toISOString(), players };
            const sharedPath = path.join(sharedDir, 'endersecho_ranking.json');
            await fs.writeFile(sharedPath, JSON.stringify(sharedData, null, 2), 'utf8');
        } catch (error) {
            logger.error('Błąd eksportu rankingu do shared_data:', error);
        }
    }

    /**
     * Konwertuje tekst wyniku na wartość liczbową
     * @param {string} scoreText
     * @returns {number}
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
     * @param {number} value
     * @returns {string}
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
     * @param {string} scoreText
     * @returns {string}
     */
    getScoreUnit(scoreText) {
        const upperScore = scoreText.toUpperCase().trim();
        const match = upperScore.match(/^(\d+(?:\.\d+)?)(QI|[KMBTQ])?$/);
        return match && match[2] ? match[2] : '';
    }

    /**
     * Formatuje progres w określonej jednostce
     * @param {number} improvement
     * @param {string} targetUnit
     * @returns {string}
     */
    formatProgressInUnit(improvement, targetUnit) {
        if (!targetUnit) return `+${improvement}`;

        const unitValue = this.config.scoring.units[targetUnit];
        if (!unitValue) return `+${this.formatScore(improvement)}`;

        const unitImprovement = improvement / unitValue;
        const formattedValue = unitImprovement % 1 === 0 ?
            Math.floor(unitImprovement).toString() :
            parseFloat(unitImprovement.toFixed(2)).toString();

        const displayUnit = targetUnit === 'QI' ? 'Qi' : targetUnit;
        return `+${formattedValue}${displayUnit}`;
    }

    /**
     * Tworzy embed rankingu
     * @param {Array} players
     * @param {number} page
     * @param {number} totalPages
     * @param {string} userId
     * @param {Guild|null} guild
     * @param {Object} options - { mode: 'global'|'server', client, messages }
     * @returns {Promise<EmbedBuilder>}
     */
    async createRankingEmbed(players, page, totalPages, userId, guild, options = {}) {
        const { mode = 'server', client = null } = options;
        const msgs = options.messages || this.config.messages;
        const isGlobal = mode === 'global';

        const startIndex = page * this.config.ranking.playersPerPage;
        const endIndex = Math.min(startIndex + this.config.ranking.playersPerPage, players.length);
        const currentPagePlayers = players.slice(startIndex, endIndex);

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

                const date = new Date(player.timestamp);
                const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;

                let displayName = player.username || `ID:${player.userId}`;
                try {
                    const targetGuild = isGlobal
                        ? (client?.guilds.cache.get(player.sourceGuildId) || null)
                        : guild;

                    if (targetGuild) {
                        const member = await targetGuild.members.fetch(player.userId);
                        displayName = member.displayName;
                    }
                } catch {
                    // fallback na zapisane username
                }

                const bossName = player.bossName || msgs.unknownBoss;
                const isCurrentUser = player.userId === userId;
                const nickDisplay = isCurrentUser ? `**${displayName}**` : displayName;

                const lineText = `${position} ${nickDisplay} • **${this.formatScore(player.scoreValue)}** *(${shortDate})* • ${bossName}\n`;

                rankingText += lineText;

                if (rankingText.length > 1800) {
                    logger.warn(`⚠️ Osiągnięto limit 1800 znaków, przerywam na pozycji ${actualPosition}`);
                    break;
                }
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania gracza ${index}: ${error.message}`);
                continue;
            }
        }

        if (!rankingText.trim()) {
            rankingText = msgs.noDataOnPage;
        }

        const title = isGlobal ? msgs.rankingGlobalTitle : msgs.rankingTitle;

        const embed = new EmbedBuilder()
            .setColor(isGlobal ? 0x5865f2 : 0xffd700)
            .setTitle(title)
            .setDescription(rankingText)
            .addFields({
                name: msgs.rankingStats,
                value: formatMessage(msgs.rankingPlayersCount, { count: players.length }) +
                       (players.length > 0 ? '\n' + formatMessage(msgs.rankingHighestScore, { score: this.formatScore(players[0].scoreValue) }) : ''),
                inline: false
            })
            .setFooter({ text: formatMessage(msgs.rankingPage, { current: page + 1, total: totalPages }) })
            .setTimestamp();

        return embed;
    }

    /**
     * Tworzy przyciski nawigacji rankingu
     * @param {number} page
     * @param {number} totalPages
     * @param {boolean} disabled
     * @param {Object|null} messages - opcjonalny zestaw komunikatów
     * @returns {ActionRowBuilder}
     */
    createRankingButtons(page, totalPages, disabled = false, messages = null) {
        const msgs = messages || this.config.messages;
        const row = new ActionRowBuilder();

        row.addComponents(
            new ButtonBuilder()
                .setCustomId('ranking_first')
                .setLabel(msgs.buttonFirst)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_prev')
                .setLabel(msgs.buttonPrev)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_next')
                .setLabel(msgs.buttonNext)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || page >= totalPages - 1),

            new ButtonBuilder()
                .setCustomId('ranking_last')
                .setLabel(msgs.buttonLast)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1)
        );

        return row;
    }

    /**
     * Tworzy przyciski wyboru serwera/global dla komendy /ranking.
     * Etykiety przycisków serwera to nazwy z Discord, przycisk Global — z komunikatów danego serwera.
     * @param {Client} client
     * @param {Object} messages - komunikaty serwera wywołującego
     * @returns {ActionRowBuilder[]}
     */
    createServerSelectButtons(client, messages = null) {
        const msgs = messages || this.config.messages;
        const buttons = [];

        for (const guildConfig of this.config.guilds) {
            const guildName = client.guilds.cache.get(guildConfig.id)?.name || `Server ${guildConfig.id}`;
            const label = guildName.length > 20 ? guildName.substring(0, 20) + '…' : guildName;

            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`ranking_select_server_${guildConfig.id}`)
                    .setLabel(label)
                    .setStyle(ButtonStyle.Primary)
            );
        }

        buttons.push(
            new ButtonBuilder()
                .setCustomId('ranking_select_global')
                .setLabel(msgs.globalButtonLabel)
                .setStyle(ButtonStyle.Success)
        );

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            const row = new ActionRowBuilder();
            row.addComponents(buttons.slice(i, i + 5));
            rows.push(row);
        }

        return rows;
    }

    /**
     * Tworzy embed wyniku (bez pobicia rekordu)
     * @param {string} userName
     * @param {string} bestScore
     * @param {string} currentScore
     * @param {string|null} attachmentName
     * @param {string|null} bossName
     * @param {Object|null} messages
     * @returns {EmbedBuilder}
     */
    createResultEmbed(userName, bestScore, currentScore, attachmentName = null, bossName = null, messages = null) {
        const msgs = messages || this.config.messages;

        if (this.config.ocr.detailedLogging.enabled) {
            logger.info(`🔍 DEBUG: createResultEmbed - userName: "${userName}", bestScore: "${bestScore}", currentScore: "${currentScore}"`);
        }

        try {
            const currentScoreValue = currentScore ? this.parseScoreValue(currentScore) : 0;
            const newScoreValue = this.parseScoreValue(bestScore);
            const difference = currentScoreValue - newScoreValue;
            const differenceText = difference > 0
                ? `+${this.formatScore(difference)}`
                : this.formatScore(Math.abs(difference));

            const statusMessage = formatMessage(msgs.resultNotBeaten, { currentScore: currentScore || msgs.unknownBoss });
            const fullStatusValue = statusMessage + '\n' + formatMessage(msgs.resultDifference, { diff: differenceText });

            const fields = [
                { name: msgs.resultPlayer, value: userName, inline: true },
                { name: msgs.resultScore, value: bestScore, inline: true }
            ];

            if (bossName) {
                fields.push({ name: msgs.recordBoss, value: bossName, inline: false });
            }

            fields.push({ name: msgs.resultStatus, value: fullStatusValue, inline: false });

            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle(msgs.resultTitle)
                .addFields(fields)
                .setTimestamp();

            if (attachmentName) {
                embed.setImage(`attachment://${attachmentName}`);
            }

            return embed;
        } catch (error) {
            logger.error('🔍 DEBUG: Błąd w createResultEmbed:', error.message);
            throw error;
        }
    }

    /**
     * Tworzy embed nowego rekordu
     * @param {string} userName
     * @param {string} bestScore
     * @param {string} userAvatarUrl
     * @param {string} attachmentName
     * @param {string|null} previousScore
     * @param {string|null} userId
     * @param {string|null} guildId
     * @param {Object|null} messages
     * @returns {Promise<EmbedBuilder>}
     */
    async createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName, previousScore = null, userId = null, guildId = null, messages = null) {
        const msgs = messages || this.config.messages;

        let newScoreText = `**${bestScore}**`;

        if (previousScore) {
            const previousScoreValue = this.parseScoreValue(previousScore);
            const newScoreValue = this.parseScoreValue(bestScore);
            const improvement = newScoreValue - previousScoreValue;
            const newScoreUnit = this.getScoreUnit(bestScore);
            const improvementText = this.formatProgressInUnit(improvement, newScoreUnit);
            newScoreText = `${bestScore} (${improvementText})`;
        }

        let rankingText = '';
        if (userId && guildId) {
            try {
                const sortedPlayers = await this.getSortedPlayers(guildId);
                const userIndex = sortedPlayers.findIndex(player => player.userId === userId);

                if (userIndex !== -1) {
                    const currentPosition = userIndex + 1;

                    if (previousScore) {
                        const tempPlayers = [...sortedPlayers];
                        const userPlayer = tempPlayers.find(p => p.userId === userId);
                        if (userPlayer) {
                            userPlayer.scoreValue = this.parseScoreValue(previousScore);
                            tempPlayers.sort((a, b) => b.scoreValue - a.scoreValue);
                            const previousIndex = tempPlayers.findIndex(player => player.userId === userId);
                            const previousPosition = previousIndex + 1;
                            const positionChange = previousPosition - currentPosition;

                            if (positionChange > 0) {
                                rankingText = formatMessage(msgs.rankingPositionPromotion, { pos: currentPosition, change: positionChange });
                            } else {
                                rankingText = formatMessage(msgs.rankingPosition, { pos: currentPosition });
                            }
                        } else {
                            rankingText = formatMessage(msgs.rankingPosition, { pos: currentPosition });
                        }
                    } else {
                        rankingText = formatMessage(msgs.rankingPositionNew, { pos: currentPosition });
                    }
                }
            } catch (error) {
                logger.error('Błąd pobierania pozycji w rankingu:', error);
            }
        }

        const embedFields = [
            { name: msgs.recordNewScore, value: newScoreText, inline: true },
            { name: msgs.recordDate, value: new Date().toLocaleDateString('pl-PL'), inline: true }
        ];

        if (rankingText) {
            embedFields.push({ name: msgs.recordRanking, value: rankingText, inline: false });
        }

        embedFields.push({ name: msgs.recordStatus, value: msgs.recordSaved, inline: false });

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(msgs.recordTitle)
            .setDescription(formatMessage(msgs.recordDescription, { username: userName }))
            .setThumbnail(userAvatarUrl)
            .addFields(embedFields)
            .setTimestamp()
            .setImage(`attachment://${attachmentName}`);

        return embed;
    }

    /**
     * Aktualizuje ranking użytkownika na danym serwerze
     * @param {string} guildId
     * @param {string} userId
     * @param {string} userName
     * @param {string} bestScore
     * @param {string|null} bossName
     */
    async updateUserRanking(guildId, userId, userName, bestScore, bossName = null) {
        if (this.config.ocr.detailedLogging.enabled) {
            logger.info(`🔍 DEBUG: updateUserRanking - guildId: ${guildId}, userId: ${userId}, bestScore: "${bestScore}"`);
        }

        const ranking = await this.loadRanking(guildId);
        const newScoreValue = this.parseScoreValue(bestScore);
        const currentScore = ranking[userId];

        let isNewRecord = false;

        if (!currentScore) {
            isNewRecord = true;
        } else {
            const currentScoreValue = this.parseScoreValue(currentScore.score);
            if (newScoreValue > currentScoreValue) {
                isNewRecord = true;
            }
        }

        if (isNewRecord) {
            ranking[userId] = {
                score: bestScore,
                username: userName,
                timestamp: new Date().toISOString(),
                scoreValue: newScoreValue,
                userId,
                bossName: bossName || this.config.messages.unknownBossLabel
            };
            await this.saveRanking(guildId, ranking);
        }

        return { isNewRecord, ranking, currentScore };
    }

    /**
     * Pobiera posortowanych graczy dla danego serwera
     * @param {string} guildId
     * @returns {Promise<Array>}
     */
    async getSortedPlayers(guildId) {
        const ranking = await this.loadRanking(guildId);
        const players = Object.entries(ranking).map(([userId, data]) => ({ ...data, userId }));
        return players.sort((a, b) => b.scoreValue - a.scoreValue);
    }

    /**
     * Dodaje aktywny ranking do cache
     */
    addActiveRanking(messageId, rankingData) {
        if (rankingData.mobileFormat === undefined) rankingData.mobileFormat = false;
        this.activeRankings.set(messageId, rankingData);

        setTimeout(() => {
            this.activeRankings.delete(messageId);
        }, this.config.ranking.paginationTimeout);
    }

    getActiveRanking(messageId) {
        return this.activeRankings.get(messageId) || null;
    }

    updateActiveRanking(messageId, rankingData) {
        this.activeRankings.set(messageId, rankingData);
    }

    /**
     * Usuwa gracza z rankingu danego serwera
     * @param {string} userId
     * @param {string} guildId
     * @returns {Promise<boolean>}
     */
    async removePlayerFromRanking(userId, guildId) {
        try {
            const ranking = await this.loadRanking(guildId);

            if (ranking[userId]) {
                delete ranking[userId];
                await this.saveRanking(guildId, ranking);
                logger.info(`🗑️ Usunięto gracza ${userId} z rankingu serwera ${guildId}`);
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
