const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMessage } = require('../utils/helpers');

class RankingService {
    constructor(config, appSync) {
        this.config = config;
        this.appSync = appSync;
        this.activeRankings = new Map();
        // Kolejka operacji per-guild — zapobiega race condition przy równoczesnych /update
        this._writeQueues = new Map();
    }

    // Serializuje operacje dla danego guildId — następna zaczyna się dopiero gdy poprzednia skończy
    _enqueue(guildId, fn) {
        const prev = this._writeQueues.get(guildId) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this._writeQueues.set(guildId, next);
        return next;
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
    async getGlobalRanking(activeGuildIds = null) {
        const bestPerPlayer = new Map();

        for (const guild of this.config.getAllGuilds()) {
            if (activeGuildIds && !activeGuildIds.has(guild.id)) continue;
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
     * Eksportuje globalny ranking do shared_data/endersecho_ranking.json.
     * @param {{ syncToApi?: boolean }} [options] — syncToApi=false pomija push
     *   do Web API (używane przy starcie bota, żeby nie spamować API rankingiem,
     *   który się nie zmienił). Lokalny eksport JSON wykonuje się zawsze.
     */
    async saveSharedRanking({ syncToApi = true } = {}) {
        try {
            const sharedDir = path.join(__dirname, '../../shared_data');
            await fs.mkdir(sharedDir, { recursive: true });

            // Wczytaj wszystkie rankingi serwerów w jednym przebiegu —
            // potrzebne do obliczenia globalnego rankingu i rankingów per-serwer.
            const perGuildData = new Map(); // guildId -> { userId: data }
            const bestPerPlayer = new Map(); // userId -> best data
            for (const guild of this.config.getAllGuilds()) {
                const ranking = await this.loadRanking(guild.id);
                perGuildData.set(guild.id, ranking);
                for (const [userId, data] of Object.entries(ranking)) {
                    const existing = bestPerPlayer.get(userId);
                    if (!existing || data.scoreValue > existing.scoreValue) {
                        bestPerPlayer.set(userId, { ...data, userId, sourceGuildId: guild.id });
                    }
                }
            }

            // Ranking globalny (posortowany malejąco)
            const globalSorted = Array.from(bestPerPlayer.values())
                .sort((a, b) => b.scoreValue - a.scoreValue);

            // Rankingi per-serwer: posortowane userId dla każdej gildii
            const perGuildSortedIds = new Map();
            for (const [guildId, ranking] of perGuildData) {
                const sorted = Object.entries(ranking)
                    .filter(([, d]) => d.scoreValue > 0)
                    .sort(([, a], [, b]) => b.scoreValue - a.scoreValue)
                    .map(([userId]) => userId);
                perGuildSortedIds.set(guildId, sorted);
            }

            const players = globalSorted.map((player, index) => {
                const guildIds = perGuildSortedIds.get(player.sourceGuildId) || [];
                const serverRankIdx = guildIds.indexOf(player.userId);
                return {
                    rank: index + 1,
                    userId: player.userId,
                    username: player.username,
                    score: player.score,
                    scoreValue: player.scoreValue,
                    bossName: player.bossName || null,
                    timestamp: player.timestamp,
                    sourceGuildId: player.sourceGuildId,
                    serverRank: serverRankIdx >= 0 ? serverRankIdx + 1 : null,
                    serverTotalPlayers: guildIds.length || null,
                };
            });

            const sharedData = { updatedAt: new Date().toISOString(), players };
            const sharedPath = path.join(sharedDir, 'endersecho_ranking.json');
            await fs.writeFile(sharedPath, JSON.stringify(sharedData, null, 2), 'utf8');

            // Mirror do web API — endpoint upsertowy po discordId.
            // snapshotDate przycinamy do doby UTC.
            // scoreNumeric: toFixed(0) zamiast String(), bo String() dla wartości
            // >= 1e21 (Sx, duże Qi) daje notację wykładniczą "1.65e+21", którą API
            // odrzuca walidacją /^\d+$/.
            if (syncToApi) {
                const now = new Date();
                const snapshotDate = new Date(Date.UTC(
                    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
                )).toISOString();
                for (const player of players) {
                    const score = Number(player.scoreValue);
                    if (!Number.isFinite(score) || score < 0) continue;
                    this.appSync.endersEchoSnapshot({
                        discordId: player.userId,
                        snapshotDate,
                        rank: player.rank,
                        scoreNumeric: score.toFixed(0),
                        totalPlayers: players.length,
                        serverRank: player.serverRank,
                        serverTotalPlayers: player.serverTotalPlayers,
                    });
                }
            }
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
        const match = upperScore.match(/^(\d+(?:\.\d+)?)(QI|SX|[KMBTQ])?$/);
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
            { name: 'Sx', value: 1000000000000000000000 },
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
        const match = upperScore.match(/^(\d+(?:\.\d+)?)(QI|SX|[KMBTQ])?$/);
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

        const displayUnit = targetUnit === 'QI' ? 'Qi' : targetUnit === 'SX' ? 'Sx' : targetUnit;
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
        const { mode = 'server', client = null, callerStats = null } = options;
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

                const targetGuild = isGlobal
                    ? (client?.guilds.cache.get(player.sourceGuildId) || null)
                    : guild;

                let displayName = player.username || `ID:${player.userId}`;
                try {
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
                let serverSuffix = '';
                if (isGlobal) {
                    const guildTag = this.config.getAllGuilds().find(g => g.id === player.sourceGuildId)?.tag;
                    serverSuffix = guildTag ? ` • ${guildTag}` : '';
                }

                const lineText = `${position} ${nickDisplay} • **${this.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${bossName}${serverSuffix}\n\n`;

                rankingText += lineText;

                if (rankingText.length > 3800) {
                    logger.warn(`⚠️ Osiągnięto limit znaków, przerywam na pozycji ${actualPosition}`);
                    break;
                }
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania gracza ${index}: ${error.message}`);
            }
        }

        if (!rankingText.trim()) {
            rankingText = msgs.noDataOnPage;
        }

        const title = options.titleOverride || (isGlobal ? msgs.rankingGlobalTitle : msgs.rankingTitle);

        // Pole statystyk
        const serverCount = isGlobal
            ? this.config.getAllGuilds().filter(g => client?.guilds?.cache?.has(g.id)).length
            : 0;
        const statsLines = [
            ...(isGlobal ? [formatMessage(msgs.rankingServersCount, { count: serverCount })] : []),
            formatMessage(msgs.rankingPlayersCount, { count: players.length })
        ];
        if (players.length > 0) {
            statsLines.push(formatMessage(msgs.rankingHighestScore, { score: this.formatScore(players[0].scoreValue) }));
        }

        const embed = new EmbedBuilder()
            .setColor(isGlobal ? 0x5865f2 : 0xffd700)
            .setTitle(title)
            .setDescription(rankingText);

        // Pole statystyk wywołującego (pierwsze)
        if (callerStats !== null) {
            let callerValue;
            if (!callerStats.score) {
                callerValue = msgs.rankingNotInRanking;
            } else {
                const lines = [
                    `🎯 **${msgs.rankingYourScore}:** ${callerStats.score}`,
                    `🏠 **${msgs.rankingYourServerPos}:** ${callerStats.serverPosition ? `#${callerStats.serverPosition}` : '—'}`,
                    `🌐 **${msgs.rankingYourGlobalPos}:** ${callerStats.globalPosition ? `#${callerStats.globalPosition}` : '—'}`
                ];
                if (callerStats.rolePositions?.length > 0) {
                    for (const rp of callerStats.rolePositions) {
                        lines.push(`🎖️ **${rp.roleName}:** #${rp.position}`);
                    }
                }
                callerValue = lines.join('\n');
            }
            embed.addFields({ name: msgs.rankingYourStats, value: callerValue, inline: false });
        }

        // Pole statystyk ogólnych (drugie)
        embed.addFields({ name: isGlobal ? msgs.rankingStatsGlobal : msgs.rankingStats, value: statsLines.join('\n'), inline: false });

        embed
            .setFooter({ text: formatMessage(msgs.rankingPage, { current: page + 1, total: totalPages }) })
            .setTimestamp();

        if (!isGlobal && guild) {
            const iconUrl = guild.iconURL({ size: 128 });
            if (iconUrl) embed.setThumbnail(iconUrl);
        }

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
    createRankingButtons(page, totalPages, disabled = false, messages = null, roleRows = []) {
        const msgs = messages || this.config.messages;

        const navRow = new ActionRowBuilder();
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId('ranking_first')
                .setLabel(msgs.buttonFirst)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_prev')
                .setLabel(msgs.buttonPrev)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_next')
                .setLabel(msgs.buttonNext)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1),

            new ButtonBuilder()
                .setCustomId('ranking_last')
                .setLabel(msgs.buttonLast)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1),

            new ButtonBuilder()
                .setCustomId('ranking_back')
                .setLabel(msgs.buttonBack)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled)
        );

        return [navRow, ...roleRows];
    }

    /**
     * Tworzy wiersze przycisków dla rankingów ról danego serwera.
     * Maks. 10 ról = 2 wiersze po 5.
     * @param {Array} roleRankings - lista { roleId, roleName }
     * @param {string} guildId
     * @returns {ActionRowBuilder[]}
     */
    createRoleRankingButtons(roleRankings, guildId) {
        const rows = [];
        for (let i = 0; i < roleRankings.length; i += 5) {
            const row = new ActionRowBuilder();
            const chunk = roleRankings.slice(i, i + 5);
            for (const rr of chunk) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ranking_role_${guildId}_${rr.roleId}`)
                        .setLabel(rr.roleName.substring(0, 80))
                        .setStyle(ButtonStyle.Primary)
                );
            }
            rows.push(row);
        }
        return rows;
    }

    /**
     * Filtruje ranking do graczy posiadających daną rolę.
     * @param {string} guildId
     * @param {string} roleId
     * @param {Guild} guild
     * @param {RoleRankingConfigService} roleRankingConfigService
     * @returns {Promise<Array>}
     */
    async getSortedPlayersByRole(guildId, roleId, guild, roleRankingConfigService) {
        const allPlayers = await this.getSortedPlayers(guildId);
        const playerIds = allPlayers.map(p => p.userId);
        const membersWithRole = await roleRankingConfigService.getMembersWithRole(guild, roleId, playerIds);
        return allPlayers.filter(p => membersWithRole.has(p.userId));
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

        for (const guildConfig of this.config.getAllGuilds()) {
            if (!client.guilds.cache.has(guildConfig.id)) continue;
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
    getPositionColor(position) {
        if (!position) return 0x57F287;
        if (position === 1) return 0xFFD700;
        if (position === 2) return 0xC0C0C0;
        if (position === 3) return 0xCD7F32;
        if (position <= 10) return 0x5865F2;
        return 0x57F287;
    }

    getPositionMedal(position) {
        if (!position) return '⭐';
        if (position === 1) return '🥇';
        if (position === 2) return '🥈';
        if (position === 3) return '🥉';
        if (position <= 10) return '🏅';
        return '⭐';
    }

    getPositionRole(position, guildTopRoles, guild) {
        if (!guildTopRoles || !guild) return null;
        let roleId = null;
        if (position === 1) roleId = guildTopRoles.top1;
        else if (position === 2) roleId = guildTopRoles.top2;
        else if (position === 3) roleId = guildTopRoles.top3;
        else if (position >= 4 && position <= 10) roleId = guildTopRoles.top4to10;
        else if (position >= 11 && position <= 30) roleId = guildTopRoles.top11to30;
        return roleId ? guild.roles.cache.get(roleId) || null : null;
    }

    formatTimeSince(previousTimestamp) {
        if (!previousTimestamp) return null;
        const diffMs = Date.now() - new Date(previousTimestamp).getTime();
        if (diffMs <= 0) return null;
        const totalMinutes = Math.floor(diffMs / 60000);
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0 || days > 0) parts.push(`${hours}h`);
        parts.push(`${minutes}m`);
        return parts.join(' ');
    }

    async createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName, previousScore = null, userId = null, guildId = null, messages = null, guild = null, guildTopRoles = null, previousTimestamp = null, rolePositions = []) {
        const msgs = messages || this.config.messages;

        // Oblicz postęp i poprawę w jednej linii
        let progressText = bestScore;
        if (previousScore) {
            const previousScoreValue = this.parseScoreValue(previousScore);
            const newScoreValue = this.parseScoreValue(bestScore);
            const improvement = newScoreValue - previousScoreValue;
            const newScoreUnit = this.getScoreUnit(bestScore);
            const improvementText = this.formatProgressInUnit(improvement, newScoreUnit);
            progressText = `${previousScore} ➜ ${bestScore} (${improvementText})`;
        }

        // Pobierz pozycję w rankingu
        let currentPosition = null;
        let positionChange = 0;
        let isNewEntry = false;

        if (userId && guildId) {
            try {
                const sortedPlayers = await this.getSortedPlayers(guildId);
                const userIndex = sortedPlayers.findIndex(player => player.userId === userId);

                if (userIndex !== -1) {
                    currentPosition = userIndex + 1;

                    if (previousScore) {
                        const tempPlayers = [...sortedPlayers];
                        const userPlayer = tempPlayers.find(p => p.userId === userId);
                        if (userPlayer) {
                            userPlayer.scoreValue = this.parseScoreValue(previousScore);
                            tempPlayers.sort((a, b) => b.scoreValue - a.scoreValue);
                            const previousIndex = tempPlayers.findIndex(player => player.userId === userId);
                            positionChange = (previousIndex + 1) - currentPosition;
                        }
                    } else {
                        isNewEntry = true;
                    }
                }
            } catch (error) {
                logger.error('Błąd pobierania pozycji w rankingu:', error);
            }
        }

        // Rola i ikona roli
        const positionRole = currentPosition ? this.getPositionRole(currentPosition, guildTopRoles, guild) : null;

        // Kolor i medal wg pozycji
        const embedColor = this.getPositionColor(currentPosition);
        const medal = this.getPositionMedal(currentPosition);

        // Buduj opis z wszystkimi danymi
        let descLines = [];
        descLines.push(formatMessage(msgs.recordDescription, { username: userName }));
        descLines.push('');

        if (previousScore) {
            descLines.push(`**${msgs.recordProgress}:** ${progressText}`);
        } else {
            descLines.push(`**${msgs.recordNewScore}:** ${bestScore}`);
        }

        if (currentPosition !== null) {
            let posLine = `**${msgs.recordRanking}:** ${medal} #${currentPosition}`;
            if (positionChange > 0) {
                posLine += `  *(${msgs.recordPromotionBy} +${positionChange})*`;
            } else if (isNewEntry) {
                posLine += `  *(${msgs.recordNewEntry})*`;
            }
            descLines.push(posLine);
        }

        if (rolePositions?.length > 0) {
            for (const rp of rolePositions) {
                descLines.push(`🎖️ **${rp.roleName}:** #${rp.position}`);
            }
        }

        const timeSince = this.formatTimeSince(previousTimestamp);
        if (timeSince) {
            descLines.push(`*(${msgs.recordPreviousRecordAgo}: ${timeSince} ${msgs.recordAgo})*`);
        }

        const description = descLines.join('\n');

        // Author: ikona roli jeśli dostępna
        let authorData = null;
        if (positionRole) {
            const roleIconUrl = positionRole.iconURL({ size: 256 });
            if (roleIconUrl) {
                authorData = { name: positionRole.name, iconURL: roleIconUrl };
            } else if (positionRole.unicodeEmoji) {
                authorData = { name: `${positionRole.unicodeEmoji} ${positionRole.name}` };
            } else {
                authorData = { name: positionRole.name };
            }
        }

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(msgs.recordTitle)
            .setDescription(description)
            .setThumbnail(userAvatarUrl)
            .setTimestamp()
            .setImage(`attachment://${attachmentName}`);

        if (authorData) {
            embed.setAuthor(authorData);
        }

        return embed;
    }

    /**
     * Tworzy embed powiadomienia o zmianie w globalnym Top 3
     * @param {string} userName
     * @param {string} bestScore
     * @param {string|null} previousScore
     * @param {string} userAvatarUrl
     * @param {number} globalPosition - 1, 2 lub 3
     * @param {number|null} prevGlobalPosition - poprzednia pozycja globalna lub null
     * @param {string} sourceGuildName - nazwa serwera, na którym pobito rekord
     * @param {Object|null} messages
     * @param {string|null} previousTimestamp
     * @returns {EmbedBuilder}
     */
    createGlobalTop3Embed(userName, bestScore, previousScore, userAvatarUrl, globalPosition, prevGlobalPosition, sourceGuildName, messages, previousTimestamp, attachmentName = null, top3Players = []) {
        const msgs = messages || this.config.messages;

        const medal = this.getPositionMedal(globalPosition);
        const embedColor = this.getPositionColor(globalPosition);

        let progressText;
        if (previousScore) {
            const previousScoreValue = this.parseScoreValue(previousScore);
            const newScoreValue = this.parseScoreValue(bestScore);
            const improvement = newScoreValue - previousScoreValue;
            const newScoreUnit = this.getScoreUnit(bestScore);
            const improvementText = this.formatProgressInUnit(improvement, newScoreUnit);
            progressText = `${previousScore} ➜ ${bestScore} (${improvementText})`;
        } else {
            progressText = bestScore;
        }

        let positionNote = '';
        if (!prevGlobalPosition || prevGlobalPosition > 3) {
            positionNote = ` *(${msgs.globalTop3EnteredTop3})*`;
        } else if (prevGlobalPosition > globalPosition) {
            positionNote = ` *(${formatMessage(msgs.globalTop3PositionImproved, { prevPos: prevGlobalPosition })})*`;
        }

        const descHeader = formatMessage(msgs.globalTop3Description, { username: userName, medal, position: globalPosition });
        const descLines = [descHeader, ''];

        if (previousScore) {
            descLines.push(`**${msgs.recordProgress}:** ${progressText}`);
        } else {
            descLines.push(`**${msgs.recordNewScore}:** ${bestScore}`);
        }

        descLines.push(`**${msgs.globalTop3GlobalPosition}:** ${medal} #${globalPosition}${positionNote}`);
        descLines.push(`**${msgs.globalTop3Server}:** ${sourceGuildName}`);

        const timeSince = this.formatTimeSince(previousTimestamp);
        if (timeSince) {
            descLines.push(`*(${msgs.recordPreviousRecordAgo}: ${timeSince} ${msgs.recordAgo})*`);
        }

        const podiumMedals = ['🥇', '🥈', '🥉'];
        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const podiumLines = top3Players.slice(0, 3).map((p, i) => {
            const m = podiumMedals[i];
            const tag = guildTagMap.get(p.sourceGuildId);
            return tag ? `${m} **${p.username}** - ${p.score} - ${tag}` : `${m} **${p.username}** - ${p.score}`;
        });

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(msgs.globalTop3Title)
            .setDescription(descLines.join('\n'))
            .setThumbnail(userAvatarUrl)
            .setImage(attachmentName || null)
            .setTimestamp();

        if (podiumLines.length > 0) {
            embed.addFields({ name: msgs.globalTop3PodiumLabel, value: podiumLines.join('\n'), inline: false });
        }

        return embed;
    }

    /**
     * Tworzy embed DM powiadomienia dla subskrybenta.
     * @param {EmbedBuilder} recordEmbed
     * @param {string} trackedUsername
     * @param {string} trackedAvatarUrl
     * @param {string} bestScore
     * @param {string|null} subscriberScore
     * @param {Object} messages
     * @returns {EmbedBuilder}
     */
    createDmNotifEmbed(recordEmbed, trackedUsername, trackedAvatarUrl, bestScore, subscriberScore, messages) {
        const msgs = messages || this.config.messages;
        const data = recordEmbed.toJSON();
        const dmEmbed = new EmbedBuilder(data);

        // Zastąp tytuł authorem: ikonka gracza + "pobił swój rekord!"
        dmEmbed.setTitle(null);
        dmEmbed.setAuthor({
            name: `${trackedUsername} ${msgs.notifDmBrokeRecord}`,
            iconURL: trackedAvatarUrl
        });

        // Usuń pierwszą linię opisu ("## {username} pobił swój rekord!" + pusta linia)
        if (data.description) {
            const lines = data.description.split('\n');
            const trimmedLines = lines.length > 1 && lines[1] === '' ? lines.slice(2) : lines.slice(1);
            dmEmbed.setDescription(trimmedLines.join('\n') || null);
        }

        // Wyczyść pola z publicznego embeda (np. liczba obserwujących) — DM ma własne
        dmEmbed.setFields([]);

        // Pole 1 (duży nagłówek): aktualny wynik subskrybenta
        const field1Value = subscriberScore || '—';
        dmEmbed.addFields({ name: msgs.notifDmField1Name, value: field1Value });

        // Pole 2: porównanie z wynikiem subskrybenta
        let comparisonText;
        if (subscriberScore) {
            const subscriberScoreValue = this.parseScoreValue(subscriberScore);
            const newScoreValue = this.parseScoreValue(bestScore);
            const diff = newScoreValue - subscriberScoreValue;
            if (diff > 0) {
                comparisonText = formatMessage(msgs.notifDmBeatYourRecord, { diff: `+${this.formatScore(diff)}` });
            } else if (diff < 0) {
                comparisonText = formatMessage(msgs.notifDmMissingToRecord, { diff: this.formatScore(Math.abs(diff)) });
            } else {
                comparisonText = '🎯 Wyniki równe!';
            }
        } else {
            comparisonText = msgs.notifDmNoSubscriberRecord;
        }
        dmEmbed.addFields({ name: msgs.notifDmField2Name, value: comparisonText });

        return dmEmbed;
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
        // Całe read-modify-write w kolejce per-guild — eliminuje race condition przy równoczesnych /update
        return this._enqueue(guildId, async () => {
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
                await this._removeWeakerScoresFromOtherGuilds(userId, newScoreValue, guildId);
            }

            return { isNewRecord, ranking, currentScore };
        });
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
     * Po nowym rekordzie na `currentGuildId` usuwa gorsze wyniki tego gracza z pozostałych serwerów.
     */
    async _removeWeakerScoresFromOtherGuilds(userId, newScoreValue, currentGuildId) {
        const otherGuilds = this.config.getAllGuilds().filter(g => g.id !== currentGuildId);
        for (const guild of otherGuilds) {
            await this._enqueue(guild.id, async () => {
                const ranking = await this.loadRanking(guild.id);
                if (ranking[userId] && ranking[userId].scoreValue < newScoreValue) {
                    logger.info(`🗑️ Usunięto gorszy wynik gracza ${userId} z serwera ${guild.id} (pobity przez rekord na ${currentGuildId})`);
                    delete ranking[userId];
                    await this.saveRanking(guild.id, ranking);
                }
            });
        }
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
