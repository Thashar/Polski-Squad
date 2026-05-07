'use strict';

const fs   = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Interwał: 9 × 3 dni, potem 4 dni przerwy, powtórz (cykl 10)
const CYCLE_LEN          = 10;
const REPORT_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 dni
const BREAK_INTERVAL_MS  = 4 * 24 * 60 * 60 * 1000;  // 4 dni

const CHECK_INTERVAL_MS  = 60_000; // sprawdzaj co minutę

class GlobalTop10Service {
    /**
     * @param {string} dataDir                ścieżka do EndersEcho/data/
     * @param {object} rankingService         RankingService
     * @param {object} guildConfigService     GuildConfigService
     * @param {object} config                 config bota
     * @param {object} client                 Discord.js Client (ustawiany później przez setClient)
     */
    constructor(dataDir, rankingService, guildConfigService, config) {
        this.dataDir          = dataDir;
        this.rankingService   = rankingService;
        this.guildConfigService = guildConfigService;
        this.config           = config;
        this.client           = null;
        this._configFile      = path.join(dataDir, 'global_top10_config.json');
        this._cfg             = null;
        this._timer           = null;
    }

    setClient(client) {
        this.client = client;
    }

    // ── persistence ────────────────────────────────────────────────────────────

    _load() {
        try {
            this._cfg = JSON.parse(fs.readFileSync(this._configFile, 'utf8'));
        } catch {
            this._cfg = {
                enabled:      false,
                firstTrigger: null,
                nextTrigger:  null,
                triggerCount: 0,
                lastSnapshot: {},   // { [userId]: position }
            };
        }
    }

    _save() {
        fs.writeFileSync(this._configFile, JSON.stringify(this._cfg, null, 2), 'utf8');
    }

    getConfig() {
        return { ...this._cfg };
    }

    // ── schedule management ────────────────────────────────────────────────────

    /**
     * Ustawia harmonogram. Wywoływane z panelu admina.
     * @param {string} firstTriggerIso  ISO string pierwszego raportu
     */
    setSchedule(firstTriggerIso) {
        this._cfg.enabled      = true;
        this._cfg.firstTrigger = firstTriggerIso;
        this._cfg.nextTrigger  = firstTriggerIso;
        this._cfg.triggerCount = 0;
        this._save();
        logger.info(`[GlobalTop10] Harmonogram ustawiony: pierwszy raport ${firstTriggerIso}`);
    }

    disableSchedule() {
        this._cfg.enabled = false;
        this._save();
        logger.info('[GlobalTop10] Harmonogram wyłączony');
    }

    _nextIntervalMs() {
        const pos = (this._cfg.triggerCount || 0) % CYCLE_LEN;
        return pos === CYCLE_LEN - 1 ? BREAK_INTERVAL_MS : REPORT_INTERVAL_MS;
    }

    _advanceTrigger() {
        this._cfg.triggerCount = (this._cfg.triggerCount || 0) + 1;
        const now = new Date(this._cfg.nextTrigger || Date.now());
        this._cfg.nextTrigger = new Date(now.getTime() + this._nextIntervalMs()).toISOString();
        this._save();
    }

    // ── scheduler ─────────────────────────────────────────────────────────────

    start() {
        this._load();
        this._timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
        logger.info(`[GlobalTop10] Scheduler uruchomiony (${this._cfg.enabled ? `następny: ${this._cfg.nextTrigger}` : 'wyłączony'})`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async _tick() {
        if (!this._cfg?.enabled || !this._cfg.nextTrigger) return;
        if (!this.client?.isReady()) return;

        const now  = Date.now();
        const next = new Date(this._cfg.nextTrigger).getTime();
        if (now < next) return;

        logger.info('[GlobalTop10] Czas raportu TOP10 — generuję…');
        try {
            await this._sendReports();
        } catch (err) {
            logger.error(`[GlobalTop10] Błąd wysyłania raportu: ${err.message}`);
        }
        this._advanceTrigger();
    }

    // ── report generation ─────────────────────────────────────────────────────

    async _sendReports() {
        const guilds = this.guildConfigService.getAllConfiguredGuilds()
            .filter(g => g.globalTopNotifications !== false)
            .filter(g => this.client.guilds.cache.has(g.id));

        if (guilds.length === 0) {
            logger.info('[GlobalTop10] Brak serwerów z włączonymi powiadomieniami');
            return;
        }

        const globalRanking = await this.rankingService.getGlobalRanking(
            new Set(this.client.guilds.cache.keys())
        );
        const top10 = globalRanking.slice(0, 10);
        const bossName = await this._getMostFrequentBoss(10);
        const lastSnapshot = this._cfg.lastSnapshot || {};

        // Zaktualizuj snapshot przed wysłaniem
        const newSnapshot = {};
        top10.forEach((p, i) => { newSnapshot[p.userId] = i + 1; });
        this._cfg.lastSnapshot = newSnapshot;
        this._save();

        const sent = [], failed = [];

        for (const guildCfg of guilds) {
            try {
                const channel = await this.client.channels.fetch(guildCfg.allowedChannelId);
                if (!channel) continue;

                const msgs = this.config.getMessages(guildCfg.id);
                const embed = await this._buildTop10Embed(
                    top10, lastSnapshot, bossName, msgs, guildCfg, this.client
                );

                await channel.send({ embeds: [embed] });
                sent.push(guildCfg.tag || guildCfg.id);
            } catch (err) {
                failed.push(`${guildCfg.tag || guildCfg.id} (${err.message})`);
            }
        }

        if (sent.length)   logger.info(`[GlobalTop10] Wysłano: ${sent.join(', ')}`);
        if (failed.length) logger.warn(`[GlobalTop10] Błędy: ${failed.join(', ')}`);
    }

    async _buildTop10Embed(top10, lastSnapshot, bossName, msgs, guildCfg, client) {
        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const medals = ['🥇', '🥈', '🥉'];

        let lines = '';
        for (let i = 0; i < top10.length; i++) {
            const player   = top10[i];
            const position = i + 1;
            const prevPos  = lastSnapshot[player.userId] || null;

            // Ikona pozycji
            const posLabel = position <= 3 ? medals[i] : `**${position}.**`;

            // Zmiana pozycji
            let changeLabel;
            if (!prevPos)                         changeLabel = '🆕';
            else if (prevPos === position)        changeLabel = '`=`';
            else if (prevPos > position)          changeLabel = `\`▲${prevPos - position}\``;
            else                                  changeLabel = `\`▼${position - prevPos}\``;

            // Nick (pobieramy z Discord)
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback na username */ }

            const tag = guildTagMap.get(player.sourceGuildId);
            const date = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const serverSuffix = tag ? ` • ${tag}` : '';

            lines += `${posLabel} ${changeLabel} ${displayName} • **${this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${player.bossName || msgs.unknownBoss}${serverSuffix}\n\n`;
        }

        const nextIntervalDays = Math.round(this._nextIntervalMs() / (24 * 60 * 60 * 1000));

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle(msgs.globalTop10ReportTitle || '🌐 TOP 10 Globalny')
            .setDescription(lines || msgs.rankingEmpty)
            .addFields({
                name: msgs.globalTop10BossField || '⚔️ Boss tygodnia',
                value: bossName || msgs.unknownBoss,
                inline: true,
            })
            .setTimestamp()
            .setFooter({
                text: `Następny raport za ${nextIntervalDays} dni`,
            });

        const botIconUrl = this.client?.user?.displayAvatarURL({ size: 128 });
        if (botIconUrl) embed.setThumbnail(botIconUrl);

        return embed;
    }

    // ── most frequent boss ─────────────────────────────────────────────────────

    async _getMostFrequentBoss(limit = 10) {
        const allEntries = [];
        const guildsDir  = path.join(this.dataDir, 'guilds');

        if (fs.existsSync(guildsDir)) {
            for (const guildDir of fs.readdirSync(guildsDir)) {
                const wDir = path.join(guildsDir, guildDir, 'wyniki');
                if (!fs.existsSync(wDir)) continue;
                for (const file of fs.readdirSync(wDir)) {
                    if (!file.endsWith('.json')) continue;
                    try {
                        const entries = JSON.parse(fs.readFileSync(path.join(wDir, file), 'utf8'));
                        if (Array.isArray(entries)) allEntries.push(...entries);
                    } catch { /* skip */ }
                }
            }
        }

        // Stara lokalizacja wyniki/
        const oldWDir = path.join(this.dataDir, 'wyniki');
        if (fs.existsSync(oldWDir)) {
            for (const file of fs.readdirSync(oldWDir)) {
                if (!file.endsWith('.json')) continue;
                try {
                    const entries = JSON.parse(fs.readFileSync(path.join(oldWDir, file), 'utf8'));
                    if (Array.isArray(entries)) allEntries.push(...entries);
                } catch { /* skip */ }
            }
        }

        // Bierzemy ostatnie `limit` wpisów (po timestamp desc)
        allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const recent = allEntries.slice(0, limit);

        const freq = {};
        for (const e of recent) {
            if (e.bossName) freq[e.bossName] = (freq[e.bossName] || 0) + 1;
        }

        if (Object.keys(freq).length === 0) return null;
        return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    }

    // ── snippet po nowym rekordzie ─────────────────────────────────────────────

    /**
     * Buduje dane snippetu (awans w globalnym rankingu).
     * Zwraca { title, description } lub null jeśli brak zmiany pozycji.
     */
    async buildSnippetFieldData(userId, newGlobalRanking, prevGlobalPosition, msgs, client) {
        const newGlobalIndex = newGlobalRanking.findIndex(p => p.userId === userId);
        if (newGlobalIndex === -1) return null;
        const newGlobalPosition = newGlobalIndex + 1;

        if (prevGlobalPosition === newGlobalPosition) return null;

        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const medals = ['🥇', '🥈', '🥉'];

        const buildLine = async (player, position) => {
            const posLabel = position <= 3 ? medals[position - 1] : `**${position}.**`;
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback */ }
            const tag = guildTagMap.get(player.sourceGuildId);
            const date = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const serverSuffix = tag ? ` • ${tag}` : '';
            return `${posLabel} ${displayName} • **${this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${player.bossName || msgs.unknownBoss}${serverSuffix}`;
        };

        const prevLabel = prevGlobalPosition ? `#${prevGlobalPosition}` : '—';
        const direction = !prevGlobalPosition || prevGlobalPosition > newGlobalPosition ? '↑' : '↓';
        const title = msgs.globalSnippetTitle || '🌐 Zmiana w globalnym rankingu';

        const lines = [];
        const above = newGlobalRanking[newGlobalIndex - 1];
        const current = newGlobalRanking[newGlobalIndex];
        const below = newGlobalRanking[newGlobalIndex + 1];

        if (above)   lines.push(await buildLine(above, newGlobalPosition - 1));

        // Środkowa linia — oznaczona strzałką kierunku zmiany pozycji
        let currentLine = await buildLine(current, newGlobalPosition);
        currentLine = `${direction} ${currentLine}`;
        lines.push(currentLine);

        if (below) {
            // Gracz poniżej nowej pozycji został wypchnięty w przeciwnym kierunku
            const belowDirection = direction === '↑' ? '↓' : '↑';
            lines.push(`${belowDirection} ${await buildLine(below, newGlobalPosition + 1)}`);
        }

        return {
            title: `${title} ${direction} ${prevLabel} → #${newGlobalPosition}`,
            description: lines.join('\n\n')
        };
    }

    /**
     * Buduje snippet embed (awans w globalnym rankingu).
     * Zwraca EmbedBuilder lub null jeśli brak zmiany pozycji.
     */
    async buildSnippetEmbed(userId, newGlobalRanking, prevGlobalPosition, msgs, client) {
        const data = await this.buildSnippetFieldData(userId, newGlobalRanking, prevGlobalPosition, msgs, client);
        if (!data) return null;

        return new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(data.title)
            .setDescription(data.description);
    }
}

module.exports = GlobalTop10Service;
