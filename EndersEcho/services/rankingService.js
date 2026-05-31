const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMessage } = require('../utils/helpers');

class RankingService {
    constructor(config, scoreHistoryService = null) {
        this.config = config;
        this.scoreHistoryService = scoreHistoryService;
        this.activeRankings = new Map();
        this._writeQueues = new Map();
        // Write-through cache odczytów z dysku — inwalidowany przy saveRanking (brak TTL)
        this._rankingCache = new Map(); // guildId → data
        // Cache posortowanych graczy — inwalidowany przy saveRanking
        this._sortedCache = new Map(); // guildId → Array
        // Cache globalnego rankingu — inwalidowany przy saveRanking
        this._globalCache = null; // Array | null
    }

    // Serializuje operacje dla danego guildId — następna zaczyna się dopiero gdy poprzednia skończy.
    // Każda operacja ma timeout 30s — jeśli przekroczy, kolejka jest odblokowana.
    _enqueue(guildId, fn) {
        const prev = this._writeQueues.get(guildId) ?? Promise.resolve();
        const next = prev.then(() => Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout kolejki dla guildId=${guildId}`)), 30000)),
        ]), () => Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout kolejki dla guildId=${guildId}`)), 30000)),
        ]));
        this._writeQueues.set(guildId, next.catch(() => {}));
        return next;
    }

    /**
     * Zwraca ścieżkę do pliku rankingu dla danego serwera
     * @param {string} guildId
     * @returns {string}
     */
    getRankingFile(guildId) {
        return path.join(this.config.ranking.dataDir, 'guilds', guildId, 'ranking.json');
    }

    /**
     * Wczytuje ranking dla danego serwera.
     * Przy pierwszym wywołaniu na guild_1 sprawdza czy istnieje stary ranking.json i migruje go.
     * @param {string} guildId
     * @returns {Promise<Object>}
     */
    async loadRanking(guildId) {
        const cached = this._rankingCache.get(guildId);
        if (cached) return cached;
        const file = this.getRankingFile(guildId);
        try {
            const data = await fs.readFile(file, 'utf8');
            const parsed = JSON.parse(data);
            // Normalizuj stare wpisy bez scoreValue
            for (const [uid, entry] of Object.entries(parsed)) {
                if (typeof entry.scoreValue !== 'number' || isNaN(entry.scoreValue)) {
                    parsed[uid].scoreValue = entry.score ? this.parseScoreValue(entry.score) : 0;
                }
            }
            this._rankingCache.set(guildId, parsed);
            return parsed;
        } catch {
            return {};
        }
    }

    /**
     * Zapisuje ranking dla danego serwera
     * @param {string} guildId
     * @param {Object} ranking
     */
    async saveRanking(guildId, ranking) {
        try {
            const file = this.getRankingFile(guildId);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, JSON.stringify(ranking, null, 2), 'utf8');
            this._rankingCache.set(guildId, ranking);
            this._sortedCache.delete(guildId);
            this._globalCache = null;
            await this.saveSharedRanking();
        } catch (error) {
            logger.error('Błąd zapisu rankingu:', error);
            throw error;
        }
    }

    /**
     * Buduje globalny ranking — najlepszy wynik gracza ze wszystkich serwerów.
     * Rankingi są wczytywane równolegle (Promise.all).
     * @returns {Promise<Array>}
     */
    async getGlobalRanking(activeGuildIds = null) {
        // Gdy filtrujemy po aktywnych guildach (np. status bota) — pomijamy globalny cache
        if (!activeGuildIds && this._globalCache) return this._globalCache;

        const guilds = this.config.getAllGuilds()
            .filter(g => !activeGuildIds || activeGuildIds.has(g.id));

        const rankings = await Promise.all(
            guilds.map(g => this.loadRanking(g.id).then(r => ({ guildId: g.id, ranking: r })))
        );

        const bestPerPlayer = new Map();
        for (const { guildId, ranking } of rankings) {
            for (const [userId, data] of Object.entries(ranking)) {
                const existing = bestPerPlayer.get(userId);
                if (!existing || data.scoreValue > existing.scoreValue) {
                    bestPerPlayer.set(userId, { ...data, userId, sourceGuildId: guildId });
                }
            }
        }

        const sorted = Array.from(bestPerPlayer.values())
            .sort((a, b) => b.scoreValue - a.scoreValue);

        if (!activeGuildIds) this._globalCache = sorted;
        return sorted;
    }

    /**
     * Oblicza ranking serwerów — suma wyników top 30 graczy per serwer.
     * @param {import('discord.js').Client} client
     * @returns {Promise<Array<{guildId,guildName,totalScoreValue,totalScore,playerCount,topScore,topScoreValue}>>}
     */
    async getGuildRanking(client) {
        const configuredGuilds = this.config.getAllGuilds();
        const results = [];

        await Promise.all(configuredGuilds.map(async (guildCfg) => {
            const guild = client?.guilds?.cache?.get(guildCfg.id);
            if (!guild) return; // Bot usunięty z serwera — pomijamy w rankingu klanów
            const guildName = guild.name;
            const players = await this.getSortedPlayers(guildCfg.id);
            if (players.length === 0) return;

            const totalScoreValue = players.reduce((sum, p) => sum + (p.scoreValue || 0), 0);

            results.push({
                guildId: guildCfg.id,
                guildName,
                tag: guildCfg.tag || null,
                totalScoreValue,
                totalScore: this.formatScore(totalScoreValue),
                playerCount: players.length,
                topScore: players[0]?.score || '0',
                topScoreValue: players[0]?.scoreValue || 0
            });
        }));

        return results.sort((a, b) => b.totalScoreValue - a.totalScoreValue);
    }

    /**
     * Tworzy embed z rankingiem serwerów.
     * @param {Array} guildScores
     * @param {number} page
     * @param {number} totalPages
     * @param {object} messages
     * @returns {EmbedBuilder}
     */
    createGuildRankingEmbed(guildScores, page, totalPages, messages, botIconUrl, callerGuildId = null) {
        const msgs = messages || this.config.messages;
        const perPage = this.config.ranking.playersPerPage;
        const start = page * perPage;
        const pageItems = guildScores.slice(start, start + perPage);

        const MEDALS = ['👑', '🥈', '🥉'];
        const playersLabel = msgs.guildRankingPlayers || 'graczy';
        const bestLabel = msgs.guildRankingBest || 'najlepszy';

        let rankingText = '';
        for (const [idx, gs] of pageItems.entries()) {
            const rank = start + idx + 1;
            const posLabel = rank <= 3
                ? `\`${String(rank).padStart(2, '0')}\` ${MEDALS[rank - 1]}`
                : `\`${String(rank).padStart(2, '0')}\``;
            const tagPart = gs.tag ? `  ·  ${gs.tag}` : '';
            const isCaller = callerGuildId && gs.guildId === callerGuildId;
            const nameFormatted = isCaller ? `__**${gs.guildName}**__` : `**${gs.guildName}**`;
            rankingText += `${posLabel}  ${nameFormatted}  ·  **${gs.totalScore}**\n> ${gs.playerCount} ${playersLabel}  ·  ${bestLabel}: ${gs.topScore}${tagPart}\n\n`;
        }

        const totalPlayers = guildScores.reduce((sum, gs) => sum + (gs.playerCount || 0), 0);
        const statsValue = [
            formatMessage(msgs.rankingServersCount || '🌍 Serwery: {count}', { count: guildScores.length }),
            formatMessage(msgs.rankingTotalPlayers || '👥 Łącznie graczy: {count}', { count: totalPlayers }),
            formatMessage(msgs.rankingHighestScore || '🏆 Najwyższy wynik: {score}', { score: guildScores[0]?.topScore || '—' }),
        ].join('\n');

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(msgs.guildRankingTitle || '🏛️ Ranking Serwerów')
            .setDescription(rankingText.trim() || (msgs.rankingEmpty || 'Brak danych'))
            .addFields({ name: msgs.rankingStats || 'Statystyki', value: statsValue, inline: false })
            .setFooter({ text: formatMessage(msgs.rankingPage || 'Strona {current} z {total}', { current: page + 1, total: totalPages }) })
            .setTimestamp();

        if (botIconUrl) embed.setThumbnail(botIconUrl);
        return embed;
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

            // Wczytaj wszystkie rankingi serwerów równolegle —
            // potrzebne do obliczenia globalnego rankingu i rankingów per-serwer.
            const allGuilds = this.config.getAllGuilds();
            const loadedRankings = await Promise.all(
                allGuilds.map(g => this.loadRanking(g.id).then(r => ({ guildId: g.id, ranking: r })))
            );

            const perGuildData = new Map(); // guildId -> { userId: data }
            const bestPerPlayer = new Map(); // userId -> best data
            for (const { guildId, ranking } of loadedRankings) {
                perGuildData.set(guildId, ranking);
                for (const [userId, data] of Object.entries(ranking)) {
                    const existing = bestPerPlayer.get(userId);
                    if (!existing || data.scoreValue > existing.scoreValue) {
                        bestPerPlayer.set(userId, { ...data, userId, sourceGuildId: guildId });
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
        if (value == null || isNaN(value)) return '0';
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
                    `${parseFloat(unitValue.toFixed(2))}${unit.name}`;
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

        const MEDALS = ['👑', '🥈', '🥉'];

        for (const [index, player] of currentPagePlayers.entries()) {
            try {
                const actualPosition = startIndex + index + 1;
                const posLabel = actualPosition <= 3
                    ? `\`${String(actualPosition).padStart(2, '0')}\` ${MEDALS[actualPosition - 1]}`
                    : `\`${String(actualPosition).padStart(2, '0')}\``;

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
                const nickDisplay = isCurrentUser ? `**__${displayName}__**` : `**${displayName}**`;
                let tagSuffix = '';
                if (isGlobal) {
                    const guildTag = this.config.getAllGuilds().find(g => g.id === player.sourceGuildId)?.tag;
                    tagSuffix = guildTag ? `  ·  ${guildTag}` : '';
                }

                const lineText = `${posLabel}  ${nickDisplay}  ·  **${player.score || this.formatScore(player.scoreValue)}**\n> ${bossName}  ·  *${shortDate}*${tagSuffix}\n\n`;

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
            statsLines.push(formatMessage(msgs.rankingHighestScore, { score: players[0].score || this.formatScore(players[0].scoreValue) }));
        }

        const embed = new EmbedBuilder()
            .setColor(isGlobal ? 0x5865f2 : 0xffd700)
            .setTitle(title)
            .setDescription(rankingText);

        // Pole statystyk ogólnych (pierwsze)
        embed.addFields({ name: isGlobal ? msgs.rankingStatsGlobal : msgs.rankingStats, value: statsLines.join('\n'), inline: false });

        // Pole statystyk wywołującego (drugie)
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

        embed
            .setFooter({ text: formatMessage(msgs.rankingPage, { current: page + 1, total: totalPages }) })
            .setTimestamp();

        if (!isGlobal && guild) {
            const iconUrl = guild.iconURL({ size: 128 });
            if (iconUrl) embed.setThumbnail(iconUrl);
        } else if (isGlobal && client) {
            const botIconUrl = client.user?.displayAvatarURL({ size: 128 });
            if (botIconUrl) embed.setThumbnail(botIconUrl);
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
    /**
     * @param {number} page
     * @param {number} totalPages
     * @param {boolean} disabled
     * @param {object|null} messages
     * @param {ActionRowBuilder[]} roleRows
     * @param {object} options
     * @param {number|null} options.userPage - strona z wynikiem wywołującego (null = brak)
     * @param {'server'|'global'|'guild_ranking'|'role'} options.mode
     * @param {string|null} options.guildId - ID serwera kontekstowego
     * @param {string|null} options.guildName - nazwa serwera
     * @param {string|null} options.parentGuildId - ID serwera do którego wraca button5 (w trybie global/guild_ranking)
     * @param {string|null} options.parentGuildName - nazwa serwera do przycisku Powrót
     */
    createRankingButtons(page, totalPages, disabled = false, messages = null, roleRows = [], options = {}) {
        const msgs = messages || this.config.messages;
        const { userPage = null, mode = 'server', guildId = null, guildName = null, parentGuildId = null, parentGuildName = null } = options;

        // Przycisk 4: przełącznik trybu
        let switchBtn;
        if (mode === 'server') {
            switchBtn = new ButtonBuilder()
                .setCustomId('ranking_select_global')
                .setEmoji('🌐')
                .setLabel(msgs.buttonGlobal || 'Global')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled);
        } else if (mode === 'global') {
            switchBtn = new ButtonBuilder()
                .setCustomId('ranking_guild_ranking')
                .setEmoji('🏛️')
                .setLabel(msgs.buttonServerRanking || 'Ranking Serwerów')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled);
        } else if (mode === 'guild_ranking') {
            switchBtn = new ButtonBuilder()
                .setCustomId('ranking_select_global')
                .setEmoji('👤')
                .setLabel(msgs.buttonIndividualRanking || 'Ranking Indywidualny')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled);
        } else {
            // role — przycisk do serwera
            const label = guildName ? guildName.substring(0, 80) : '🏠';
            const serverId = guildId || '';
            switchBtn = new ButtonBuilder()
                .setCustomId(`ranking_select_server_${serverId}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || !serverId);
        }

        // Przycisk 5: powrót
        // W global/guild_ranking — wraca do serwera który był wcześniej wybrany
        // W server/role — wraca do wyboru serwerów
        let backBtn;
        if ((mode === 'global' || mode === 'guild_ranking') && parentGuildId) {
            const backLabel = parentGuildName
                ? parentGuildName.substring(0, 70)
                : (msgs.buttonBack || 'Powrót');
            backBtn = new ButtonBuilder()
                .setCustomId(`ranking_select_server_${parentGuildId}`)
                .setEmoji('↩️')
                .setLabel(backLabel)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled);
        } else {
            backBtn = new ButtonBuilder()
                .setCustomId('ranking_back')
                .setEmoji('↩️')
                .setLabel(msgs.buttonBack || 'Wybór serwerów')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled);
        }

        const isGuildRanking = mode === 'guild_ranking';
        const myPosDisabled = disabled || userPage === null;

        const navRow = new ActionRowBuilder();
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId('ranking_prev')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_mypos')
                .setEmoji('🎯')
                .setLabel(isGuildRanking ? (msgs.buttonServerPos || 'Pozycja serwera') : (msgs.buttonMyPos || 'Moja pozycja'))
                .setStyle(ButtonStyle.Primary)
                .setDisabled(myPosDisabled),

            new ButtonBuilder()
                .setCustomId('ranking_next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1),

            switchBtn,
            // W trybie global: bossBtn na końcu wiersza 1 (szary), backBtn w osobnym wierszu
            ...(mode === 'global' ? [
                new ButtonBuilder()
                    .setCustomId('ranking_boss_list')
                    .setEmoji('👾')
                    .setLabel(msgs.buttonBossRanking || 'Ranking Bossów')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled)
            ] : [backBtn])
        );

        // W trybie global: roleRows → backRow (osobny wiersz)
        if (mode === 'global') {
            const backRow = new ActionRowBuilder().addComponents(backBtn);
            return [navRow, ...roleRows, backRow];
        }

        return [navRow, ...roleRows];
    }

    /**
     * Tworzy przyciski nawigacji dla rankingu bossa (tryb 'boss').
     */
    createBossRankingButtons(page, totalPages, userPage, disabled, messages) {
        const msgs = messages || this.config.messages;
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ranking_prev')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page === 0),

            new ButtonBuilder()
                .setCustomId('ranking_mypos')
                .setEmoji('🎯')
                .setLabel(msgs.buttonMyPos || 'Moja pozycja')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled || userPage === null),

            new ButtonBuilder()
                .setCustomId('ranking_next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || page >= totalPages - 1),

            new ButtonBuilder()
                .setCustomId('ranking_boss_list')
                .setEmoji('📋')
                .setLabel(msgs.bossRankingBackList || 'Lista bossów')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId('ranking_select_global')
                .setEmoji('🌐')
                .setLabel(msgs.buttonGlobal || 'Global')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled)
        );
        return [navRow];
    }

    /**
     * Tworzy embed rankingu bossa (globalny, tryb 'boss').
     */
    createBossRankingEmbed(bossName, players, page, perPage, messages, bossImageName = null, callerUserId = null, client = null) {
        const msgs = messages || this.config.messages;
        const startIdx = page * perPage;
        const pagePlayers = players.slice(startIdx, startIdx + perPage);
        const totalPages = Math.max(1, Math.ceil(players.length / perPage));

        const MEDALS = ['👑', '🥈', '🥉'];

        let rankingText = '';
        for (const [idx, p] of pagePlayers.entries()) {
            const rank = startIdx + idx + 1;
            const posLabel = rank <= 3
                ? `\`${String(rank).padStart(2, '0')}\` ${MEDALS[rank - 1]}`
                : `\`${String(rank).padStart(2, '0')}\``;

            const displayName = p.username || `ID:${p.userId}`;
            const isMe = p.userId === callerUserId;
            const nickDisplay = isMe ? `**__${displayName}__**` : `**${displayName}**`;

            const score = p.score || this.formatScore(p.scoreValue);

            const date = p.timestamp ? new Date(p.timestamp) : null;
            const shortDate = date
                ? `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`
                : '—';

            const guildTag = p.sourceGuildId
                ? (this.config.getAllGuilds().find(g => g.id === p.sourceGuildId)?.tag || null)
                : null;
            const tagSuffix = guildTag ? `  ·  ${guildTag}` : '';

            rankingText += `${posLabel}  ${nickDisplay}  ·  **${score}**\n> *${shortDate}*${tagSuffix}\n\n`;
        }

        if (!rankingText.trim()) rankingText = msgs.rankingEmpty || 'Brak wyników.';

        const statsLines = [
            formatMessage(msgs.rankingPlayersCount, { count: players.length })
        ];
        if (players.length > 0) {
            statsLines.push(formatMessage(msgs.rankingHighestScore, { score: players[0].score || this.formatScore(players[0].scoreValue) }));
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${msgs.bossRankingTitle || '🎯 Ranking'} — ${bossName}`)
            .setDescription(rankingText)
            .addFields({ name: msgs.rankingStatsGlobal || msgs.rankingStats || '📊 Statystyki', value: statsLines.join('\n'), inline: false })
            .setFooter({ text: formatMessage(msgs.rankingPage, { current: page + 1, total: totalPages }) })
            .setTimestamp();

        if (bossImageName) {
            embed.setThumbnail(`attachment://${bossImageName}`);
        } else if (client) {
            const botIconUrl = client.user?.displayAvatarURL({ size: 128 });
            if (botIconUrl) embed.setThumbnail(botIconUrl);
        }

        return embed;
    }

    /**
     * Tworzy wiersze przycisków dla rankingów ról danego serwera.
     * Maks. 10 ról = 2 wiersze po 5.
     * @param {Array} roleRankings - lista { roleId, roleName }
     * @param {string} guildId
     * @param {string|null} activeRoleId - ID aktualnie wyświetlanej roli (przycisk wyłączony)
     * @returns {ActionRowBuilder[]}
     */
    createRoleRankingButtons(roleRankings, guildId, activeRoleId = null) {
        const rows = [];
        for (let i = 0; i < roleRankings.length; i += 5) {
            const row = new ActionRowBuilder();
            const chunk = roleRankings.slice(i, i + 5);
            for (const rr of chunk) {
                const isActive = rr.roleId === activeRoleId;
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ranking_role_${guildId}_${rr.roleId}`)
                        .setLabel(rr.roleName.substring(0, 80))
                        .setStyle(isActive ? ButtonStyle.Secondary : ButtonStyle.Primary)
                        .setDisabled(isActive)
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
     * Układ: wiersz 1 = [serwer bieżący] [◀] [▶], wiersze 2–5 = inne serwery (paginacja, max 20/strona).
     * @param {Client} client
     * @param {Object} messages - komunikaty serwera wywołującego
     * @param {string|null} homeGuildId - ID serwera użytkownika (zawsze w wierszu 1)
     * @param {number} page - strona "innych serwerów" (0-based)
     * @returns {ActionRowBuilder[]}
     */
    createServerSelectButtons(client, messages = null, homeGuildId = null, page = 0) {
        const msgs = messages || this.config.messages;

        const allGuilds = this.config.getAllGuilds().filter(gc => client.guilds.cache.has(gc.id));
        const otherGuilds = allGuilds.filter(gc => gc.id !== homeGuildId);

        const PER_PAGE = 20; // 4 wiersze × 5 przycisków
        const totalPages = Math.max(1, Math.ceil(otherGuilds.length / PER_PAGE));
        const safePage = Math.max(0, Math.min(page, totalPages - 1));
        const pageGuilds = otherGuilds.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

        // Wiersz 1: bieżący serwer + strzałki paginacji
        const homeGuild = homeGuildId ? allGuilds.find(gc => gc.id === homeGuildId) : null;
        const homeLabel = homeGuild
            ? (client.guilds.cache.get(homeGuildId)?.name || homeGuildId).substring(0, 76)
            : '🏠';
        const safeHome = homeGuildId || '';

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ranking_select_server_${safeHome}`)
                .setLabel(homeLabel)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!safeHome),
            new ButtonBuilder()
                .setCustomId(`ranking_srv_prev_${safePage}_${safeHome}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`ranking_srv_next_${safePage}_${safeHome}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= totalPages - 1)
        );

        const rows = [row1];

        // Wiersze 2–5: inne serwery (max 20)
        for (let i = 0; i < pageGuilds.length; i += 5) {
            const rowBtns = pageGuilds.slice(i, i + 5).map(gc => {
                const guildName = client.guilds.cache.get(gc.id)?.name || gc.id;
                return new ButtonBuilder()
                    .setCustomId(`ranking_select_server_${gc.id}`)
                    .setLabel(guildName.substring(0, 80))
                    .setStyle(ButtonStyle.Secondary);
            });
            rows.push(new ActionRowBuilder().addComponents(rowBtns));
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
        if (guildTopRoles.disabled) return null;
        // Nowy format: { tiers: [{from, to, roleId}] }
        if (guildTopRoles.tiers) {
            const tier = guildTopRoles.tiers.find(t => position >= t.from && position <= t.to);
            const roleId = tier?.roleId;
            return roleId ? guild.roles.cache.get(roleId) || null : null;
        }
        // Stary format (backward compat)
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

    async createRecordEmbed(userName, bestScore, userAvatarUrl, attachmentName, previousScore = null, userId = null, guildId = null, messages = null, guild = null, guildTopRoles = null, previousTimestamp = null, rolePositions = [], achievementsFieldValue = null, globalSnippetData = null, bossRecordData = null, rankingOverride = null, bossSnippetData = null) {
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

        if (globalSnippetData) {
            embed.addFields({ name: globalSnippetData.title, value: globalSnippetData.description, inline: false });
        }

        if (bossSnippetData) {
            embed.addFields({ name: bossSnippetData.title, value: bossSnippetData.description, inline: false });
        }

        // Per-boss rekord (tuż przed osiągnięciami)
        if (bossRecordData?.isNewBossRecord && bossRecordData.bossName) {
            let bossFieldVal;
            if (bossRecordData.previousBossRecord) {
                bossFieldVal = `**${bossRecordData.bossName}:** ${bossRecordData.previousBossRecord.score} ➜ ${bestScore}`;
            } else {
                bossFieldVal = `**${bossRecordData.bossName}:** ${bestScore} *(${msgs.bossRecordFirst || 'pierwszy wynik na tym bossie!'})*`;
            }
            if (rankingOverride?.position) {
                const overrideMedal = this.getPositionMedal(rankingOverride.position);
                let posLine = `${overrideMedal} #${rankingOverride.position}`;
                if (rankingOverride.positionChange > 0) {
                    posLine += `  *(${msgs.recordPromotionBy} +${rankingOverride.positionChange})*`;
                } else if (rankingOverride.isNewEntry) {
                    posLine += `  *(${msgs.recordNewEntry})*`;
                }
                bossFieldVal += `\n${posLine}`;
            }
            embed.addFields({ name: msgs.bossRecordField || '👾 Rekord na bossie', value: bossFieldVal, inline: false });
        }

        if (achievementsFieldValue) {
            const fieldName = msgs.achievementsNewField || '🎉 Nowe osiągnięcia';
            embed.addFields({ name: fieldName, value: achievementsFieldValue, inline: false });
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
                comparisonText = msgs.notifDmScoresEqual;
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
                logger.info(`🔍 DEBUG: updateUserRanking - serwer: "${this.config.getAllGuilds().find(g => g.id === guildId)?.tag || guildId}", gracz: "${userName}", bestScore: "${bestScore}"`);
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
                const nowIso = new Date().toISOString();
                ranking[userId] = {
                    score: bestScore,
                    username: userName,
                    timestamp: nowIso,
                    scoreValue: newScoreValue,
                    userId,
                    bossName: bossName || this.config.messages.unknownBossLabel
                };
                await this.saveRanking(guildId, ranking);
                if (this.scoreHistoryService) {
                    this.scoreHistoryService.addEntry(guildId, userId, {
                        score: bestScore,
                        scoreValue: newScoreValue,
                        timestamp: nowIso,
                        bossName: bossName || this.config.messages.unknownBossLabel
                    }).catch(err => logger.error('Błąd zapisu historii wyników:', err));
                }
                const affectedGuildIds = await this._removeWeakerScoresFromOtherGuilds(userId, newScoreValue, guildId);
                return { isNewRecord, ranking, currentScore, newTimestamp: nowIso, affectedGuildIds };
            }

            return { isNewRecord, ranking, currentScore, newTimestamp: null, affectedGuildIds: [] };
        });
    }

    /**
     * Zwraca aktualny rekord gracza lub null.
     * @param {string} guildId
     * @param {string} userId
     * @returns {Promise<Object|null>}
     */
    async getUserRecord(guildId, userId) {
        const ranking = await this.loadRanking(guildId);
        return ranking[userId] || null;
    }

    /**
     * Przywraca poprzedni rekord gracza (lub usuwa wpis gdy previousRecord=null).
     * Używane przez community verification po decyzji admina.
     * @param {string} guildId
     * @param {string} userId
     * @param {Object|null} previousRecord
     */
    async revertUserRecord(guildId, userId, previousRecord) {
        return this._enqueue(guildId, async () => {
            const ranking = await this.loadRanking(guildId);
            if (previousRecord) {
                ranking[userId] = { ...previousRecord };
            } else {
                delete ranking[userId];
            }
            await this.saveRanking(guildId, ranking);
        });
    }

    /**
     * Pobiera posortowanych graczy dla danego serwera
     * @param {string} guildId
     * @returns {Promise<Array>}
     */
    async getSortedPlayers(guildId) {
        const cached = this._sortedCache.get(guildId);
        if (cached) return cached;
        const ranking = await this.loadRanking(guildId);
        const sorted = Object.entries(ranking)
            .map(([userId, data]) => ({ ...data, userId }))
            .sort((a, b) => b.scoreValue - a.scoreValue);
        this._sortedCache.set(guildId, sorted);
        return sorted;
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
     * Zwraca listę guildId serwerów, z których usunięto wynik (do aktualizacji ról TOP).
     */
    async _removeWeakerScoresFromOtherGuilds(userId, newScoreValue, currentGuildId) {
        const otherGuilds = this.config.getAllGuilds().filter(g => g.id !== currentGuildId);
        const affectedGuildIds = [];
        for (const guild of otherGuilds) {
            await this._enqueue(guild.id, async () => {
                const ranking = await this.loadRanking(guild.id);
                if (ranking[userId] && ranking[userId].scoreValue < newScoreValue) {
                    const playerName = ranking[userId].username || userId;
                    const currentGuildTag = this.config.getAllGuilds().find(g => g.id === currentGuildId)?.tag;
                    logger.info(`🗑️ Usunięto gorszy wynik gracza "${playerName}" z serwera "${guild.tag || guild.id}" (pobity przez rekord na "${currentGuildTag || currentGuildId}")`);
                    delete ranking[userId];
                    await this.saveRanking(guild.id, ranking);
                    affectedGuildIds.push(guild.id);
                }
            });
        }
        return affectedGuildIds;
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
                const playerName = ranking[userId].username || userId;
                delete ranking[userId];
                await this.saveRanking(guildId, ranking);
                const guildTag = this.config.getAllGuilds().find(g => g.id === guildId)?.tag;
                logger.info(`🗑️ Usunięto gracza "${playerName}" z rankingu serwera "${guildTag || guildId}"`);
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
