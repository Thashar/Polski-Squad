'use strict';

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { formatMessage } = require('../utils/helpers');

const logger = createBotLogger('EndersEcho');

const MILESTONE_STEP = 100;

class MilestoneService {
    /**
     * @param {string} dataDir                 ścieżka do EndersEcho/data/
     * @param {object} scoreHistoryService     ScoreHistoryService
     * @param {object} guildConfigService      GuildConfigService
     * @param {object} config                  config bota
     * @param {object} chartService            { generateGlobalPlayerGrowthChart }
     */
    constructor(dataDir, scoreHistoryService, guildConfigService, config, chartService) {
        this.scoreHistoryService = scoreHistoryService;
        this.guildConfigService  = guildConfigService;
        this.config              = config;
        this.chartService        = chartService;
        this.client              = null;
        this._stateFile          = path.join(dataDir, 'milestones.json');
        this._lastAnnounced      = 0;
        // Kolejkuje sprawdzenia sekwencyjnie — zapobiega podwójnemu ogłoszeniu tego
        // samego progu przy dwóch niemal równoczesnych nowych rekordach.
        this._queue = Promise.resolve();
    }

    setClient(client) {
        this.client = client;
    }

    async load() {
        try {
            const raw = await fs.promises.readFile(this._stateFile, 'utf8');
            this._lastAnnounced = JSON.parse(raw).lastAnnounced || 0;
        } catch {
            this._lastAnnounced = 0;
        }
    }

    async _save() {
        await fs.promises.writeFile(
            this._stateFile,
            JSON.stringify({ lastAnnounced: this._lastAnnounced }, null, 2),
            'utf8'
        );
    }

    /**
     * Wołane po każdym nowo zapisanym rekordzie. Tanie w typowym przypadku (tylko listing
     * katalogów) — pełne dane graczy pobierane wyłącznie gdy faktycznie przekroczono próg.
     */
    checkAndAnnounce() {
        this._queue = this._queue
            .then(() => this._check())
            .catch(err => logger.error(`[Milestone] Błąd sprawdzania kamienia milowego: ${err.message}`));
        return this._queue;
    }

    async _check() {
        if (!this.client?.isReady()) return;

        const allGuildIds = this.guildConfigService.getAllConfiguredGuildIds()
            .filter(id => this.client.guilds.cache.has(id));
        if (allGuildIds.length === 0) return;

        const total = await this.scoreHistoryService.getUniqueUserCount(allGuildIds);
        const milestone = Math.floor(total / MILESTONE_STEP) * MILESTONE_STEP;

        if (milestone <= 0 || milestone <= this._lastAnnounced) return;

        this._lastAnnounced = milestone;
        await this._save();

        logger.success(`[Milestone] 🎉 Osiągnięto ${milestone} unikatowych graczy!`);

        try {
            await this._announce(milestone, allGuildIds);
        } catch (err) {
            logger.error(`[Milestone] Błąd wysyłania ogłoszenia: ${err.message}`);
        }
    }

    _tier(milestone) {
        if (milestone % 1000 === 0) return 'grand';
        if (milestone % 500 === 0) return 'major';
        return 'standard';
    }

    async _resolveMilestonePlayer(firstEntries, milestone, allGuildIds) {
        const target = firstEntries[milestone - 1];
        if (!target) return null;

        const located = await this.scoreHistoryService.getUserEarliestGuildEntry(allGuildIds, target.userId);
        return { userId: target.userId, guildId: located?.guildId || null };
    }

    async _announce(milestone, allGuildIds) {
        const tier = this._tier(milestone);
        // Kosztowne (parsuje JSON wszystkich graczy) — wołane tylko raz na 100 graczy;
        // ta sama lista service'ów zasila zarówno ustalenie gracza-jubilata, jak i wykres.
        const [firstEntries, guildFirstTsMap, totalSubmissions] = await Promise.all([
            this.scoreHistoryService.getAllUsersFirstEntries(allGuildIds),
            this.scoreHistoryService.getGuildFirstTimestamps(allGuildIds),
            this.scoreHistoryService.getTotalSubmissionCount(allGuildIds),
        ]);
        const player = await this._resolveMilestonePlayer(firstEntries, milestone, allGuildIds);

        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));

        let playerName   = null;
        let playerAvatar = null;
        if (player?.userId) {
            try {
                const user = await this.client.users.fetch(player.userId);
                playerName   = user.username;
                playerAvatar = user.displayAvatarURL({ size: 128 });
            } catch { /* użytkownik mógł opuścić wszystkie wspólne serwery */ }
        }
        const sourceGuild = player?.guildId ? this.client.guilds.cache.get(player.guildId) : null;
        const sourceTag   = player?.guildId ? (guildTagMap.get(player.guildId) || sourceGuild?.name || null) : null;

        const guilds = this.guildConfigService.getAllConfiguredGuilds()
            .filter(g => this.client.guilds.cache.has(g.id));
        if (guilds.length === 0) return;

        // Znaczniki serwerów (kiedy każdy z nich dołączył) — dokładnie jak w panelu
        // Centrum Dowodzenia → "Wykres przyrostu" (BEZ podziału krzywej na klany, tylko badge'e).
        const guildMarkers = allGuildIds
            .filter(gid => guildFirstTsMap[gid] != null)
            .map(gid => {
                const g = this.client.guilds.cache.get(gid);
                return { firstTimestamp: guildFirstTsMap[gid], tag: guildTagMap.get(gid) || g?.name || gid, name: g?.name || gid };
            });

        // Wykres generowany raz na język (tytuł/podtytuł są wypalone w bitmapę) i buforowany,
        // żeby nie renderować go osobno dla każdego skonfigurowanego serwera.
        const chartCache = new Map();
        const getChart = async (lang) => {
            if (chartCache.has(lang)) return chartCache.get(lang);
            const isPol = lang !== 'eng';
            const chartTitle = isPol ? '📊 Przyrost Unikalnych Graczy' : '📊 Unique Player Growth';
            const chartSubtitle = isPol
                ? `${milestone} graczy · ${totalSubmissions} pobitych wyników`
                : `${milestone} players · ${totalSubmissions} beaten records`;
            let buffer = null;
            try {
                buffer = await this.chartService.generateGlobalPlayerGrowthChart(
                    firstEntries, chartTitle, guildMarkers, totalSubmissions, chartSubtitle, milestone
                );
            } catch (err) {
                logger.warn(`[Milestone] Błąd generowania wykresu: ${err.message}`);
            }
            chartCache.set(lang, buffer);
            return buffer;
        };

        const sent = [], failed = [];
        for (const guildCfg of guilds) {
            try {
                const channel = await this.client.channels.fetch(guildCfg.allowedChannelId);
                if (!channel) continue;

                const msgs  = this.config.getMessages(guildCfg.id);
                const embed = this._buildEmbed(milestone, tier, playerName, sourceTag, msgs, totalSubmissions);

                const files = [];
                const chartBuffer = await getChart(guildCfg.lang);
                if (chartBuffer) {
                    embed.setImage('attachment://milestone_growth.png');
                    files.push(new AttachmentBuilder(chartBuffer, { name: 'milestone_growth.png' }));
                }
                if (playerAvatar) embed.setThumbnail(playerAvatar);

                await channel.send({ embeds: [embed], files });
                sent.push(guildCfg.tag || guildCfg.id);
            } catch (err) {
                failed.push(`${guildCfg.tag || guildCfg.id} (${err.message})`);
            }
        }

        if (sent.length)   logger.info(`[Milestone] Wysłano na: ${sent.join(', ')}`);
        if (failed.length) logger.warn(`[Milestone] Błędy wysyłki: ${failed.join(', ')}`);
    }

    _buildEmbed(milestone, tier, playerName, sourceTag, msgs, totalSubmissions) {
        const tierStyle = {
            standard: { color: 0xFFD700, titleKey: 'milestoneTitleStandard' },
            major:    { color: 0xE67E22, titleKey: 'milestoneTitleMajor' },
            grand:    { color: 0x9B59B6, titleKey: 'milestoneTitleGrand' },
        }[tier];

        const title = formatMessage(msgs[tierStyle.titleKey], { count: milestone });
        const description = playerName
            ? formatMessage(msgs.milestoneDescriptionWithPlayer, {
                count: milestone,
                records: totalSubmissions,
                player: playerName,
                server: sourceTag ? ` (${sourceTag.replace(/^<a?:([^:]+):\d+>$/, '$1')})` : '',
            })
            : formatMessage(msgs.milestoneDescriptionNoPlayer, { count: milestone, records: totalSubmissions });

        return new EmbedBuilder()
            .setColor(tierStyle.color)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: msgs.milestoneFooter });
    }
}

module.exports = MilestoneService;
