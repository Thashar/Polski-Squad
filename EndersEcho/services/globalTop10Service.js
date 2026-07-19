'use strict';

const fs   = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { formatMessage } = require('../utils/helpers');

const logger = createBotLogger('EndersEcho');

// Interwał: 9 raportów (bossów) na sezon, co 3 dni, potem 4 dni przerwy (dzień odpoczynku + boss1 nowego sezonu), powtórz
// UWAGA: CYCLE_LEN = liczba RAPORTÓW w sezonie (9), NIE liczba wszystkich pozycji cyklu (poprzednio błędnie 10,
// co wstawiało dodatkowy, 10. raport przed każdą kolejną przerwą i przesuwało harmonogram o cały sezon w przód)
const CYCLE_LEN          = 9;
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
     * Ustawia harmonogram. Wywoływane z panelu admina. Podana data to zawsze początek
     * cyklu (pierwszy boss sezonu, triggerCount=0).
     *
     * Jeśli podana data jest tożsama z aktualnie zapisanym `nextTrigger` — nic się nie zmienia
     * (zapobiega przypadkowemu wyzerowaniu pozycji w cyklu przy samym otwarciu i zatwierdzeniu
     * modala bez faktycznej zmiany daty).
     * Jeśli podana data jest w przeszłości — traktowana jest jako punkt odniesienia (np. faktyczny
     * początek sezonu) i harmonogram jest przewijany wg wzorca 9×3 dni + 4 dni przerwy do najbliższego
     * przyszłego terminu, bez wysyłania pominiętych po drodze raportów.
     * @param {string} firstTriggerIso  ISO string początku cyklu (może być w przeszłości)
     */
    setSchedule(firstTriggerIso) {
        if (this._cfg.enabled && this._cfg.nextTrigger === firstTriggerIso && this._cfg.triggerCount === 0) {
            logger.info('[GlobalTop10] Harmonogram bez zmian — pomijam reset cyklu');
            return;
        }

        this._cfg.enabled      = true;
        this._cfg.firstTrigger = firstTriggerIso;
        this._cfg.nextTrigger  = firstTriggerIso;
        this._cfg.triggerCount = 0;

        let skipped = 0;
        while (new Date(this._cfg.nextTrigger).getTime() <= Date.now()) {
            this._stepOnce();
            skipped++;
        }

        this._save();
        logger.info(`[GlobalTop10] Harmonogram ustawiony: początek cyklu ${firstTriggerIso}, kolejny raport ${this._cfg.nextTrigger} (pominięto ${skipped} zaległych, triggerCount=${this._cfg.triggerCount})`);
    }

    disableSchedule() {
        this._cfg.enabled = false;
        this._save();
        logger.info('[GlobalTop10] Harmonogram wyłączony');
    }

    _nextIntervalMs() {
        // Interwał PO bieżącym raporcie — liczony na numerze raportu, jaki właśnie zostanie/został
        // wysłany (triggerCount+1, zgodnie z _stepOnce, który inkrementuje przed obliczeniem).
        // Przerwa następuje po KAŻDYM 9. raporcie sezonu (numer podzielny przez CYCLE_LEN=9),
        // nie po co 10. — inaczej sezon dostawałby dodatkowy raport i przesuwał harmonogram.
        const reportNumber = (this._cfg.triggerCount || 0) + 1;
        return reportNumber % CYCLE_LEN === 0 ? BREAK_INTERVAL_MS : REPORT_INTERVAL_MS;
    }

    /**
     * Jeden krok postępu harmonogramu (inkrementacja triggerCount + przesunięcie nextTrigger
     * o właściwy interwał). Używane zarówno przez realny tick (_advanceTrigger), jak i przez
     * przewijanie zaległych terminów w setSchedule() — bez zapisu do pliku (save robi wywołujący).
     */
    _stepOnce() {
        const intervalMs = this._nextIntervalMs();
        this._cfg.triggerCount = (this._cfg.triggerCount || 0) + 1;
        const now = new Date(this._cfg.nextTrigger || Date.now());
        this._cfg.nextTrigger = new Date(now.getTime() + intervalMs).toISOString();
    }

    _advanceTrigger() {
        this._stepOnce();
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
        const medals      = ['👑', '🥈', '🥉'];
        const top1Score   = top10[0]?.scoreValue || 1;

        let lines = '';
        for (let i = 0; i < top10.length; i++) {
            const player   = top10[i];
            const position = i + 1;
            const prevPos  = lastSnapshot[player.userId] || null;

            // Zmiana pozycji
            let changeStr, changeSign;
            if (!prevPos) {
                changeStr  = '🆕';
                changeSign = null;
            } else if (prevPos === position) {
                changeStr  = '`=`';
                changeSign = 'eq';
            } else if (prevPos > position) {
                const diff = prevPos - position;
                changeStr  = `**▲ +${diff}**`;
                changeSign = 'up';
            } else {
                const diff = position - prevPos;
                changeStr  = `**▼ −${diff}**`;
                changeSign = 'down';
            }

            // Nick (pobieramy z Discord)
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback na username */ }

            const tag       = guildTagMap.get(player.sourceGuildId);
            const date      = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const tagSuffix = tag ? `  ·  ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            const scoreStr  = player.score || this.rankingService.formatScore(player.scoreValue);
            const bossStr   = player.bossName || msgs.unknownBoss;

            if (position <= 3) {
                // TOP 3 — blok z blockquote
                lines += `\`${String(position).padStart(2, '0')}\` ${medals[i]}  **${displayName}**  ·  **${scoreStr}**\n`;
                lines += `> ${changeStr}  ·  ${bossStr}  ·  *${shortDate}*${tagSuffix}\n\n`;
            } else {
                // 4–10 — dwie linie, zmiana pozycji w 2. wierszu
                lines += `\`${String(position).padStart(2, '0')}\`  **${displayName}**  ·  **${scoreStr}**\n`;
                lines += `> ${changeStr}  ·  ${bossStr}  ·  *${shortDate}*${tagSuffix}\n\n`;
            }
        }

        const nextIntervalDays = Math.round(this._nextIntervalMs() / (24 * 60 * 60 * 1000));

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setAuthor({
                name:    (msgs.globalTop10ReportTitle || '🌐 TOP 10 Globalny').replace(/^🌐\s*/, ''),
                iconURL: 'https://cdn.discordapp.com/emojis/1521275407322845325.webp?size=128',
            })
            .setDescription(lines || msgs.rankingEmpty)
            .addFields({
                name:   msgs.globalTop10BossField || '⚔️ Boss okresu',
                value:  bossName || msgs.unknownBoss,
                inline: true,
            })
            .setTimestamp()
            .setFooter({
                text: formatMessage(msgs.globalTop10FooterNext || 'Next report in {days} days', { days: nextIntervalDays }),
            });

        const botIconUrl = this.client?.user?.displayAvatarURL({ size: 128 });
        if (botIconUrl) embed.setThumbnail(botIconUrl);

        return embed;
    }

    /**
     * Generuje embed TOP 10 na żądanie (komenda /generate).
     * Używa losowego snapshootu żeby pokazać wszystkie typy wskaźników (▲▼=🆕).
     * Nie aktualizuje snapshootu ani harmonogramu.
     */
    async buildOnDemandEmbed(msgs, client) {
        const globalRanking = await this.rankingService.getGlobalRanking(
            new Set(client.guilds.cache.keys())
        );
        const top10    = globalRanking.slice(0, 10);
        const bossName = await this._getMostFrequentBoss(10);

        // Losowy snapshot: każdy gracz dostaje "poprzednią" pozycję z zakresu 1–13
        // dając mix ▲ ▼ = i 🆕 (gdy brak wpisu)
        const fakeSnapshot = {};
        const positions = Array.from({ length: 13 }, (_, i) => i + 1);
        // tasuj Fisher-Yates
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        top10.forEach((player, idx) => {
            // ~20% graczy jako 🆕 (brak w snapshocie), reszta z losową poprzednią pozycją
            if (Math.random() > 0.2) fakeSnapshot[player.userId] = positions[idx];
        });

        return this._buildTop10Embed(top10, fakeSnapshot, bossName, msgs, null, client);
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
            const serverSuffix = tag ? ` • ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            return `${posLabel} ${displayName} • **${player.score || this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${player.bossName || msgs.unknownBoss}${serverSuffix}`;
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
            title,
            newGlobalPosition,
            description: `**${msgs.snippetPositionChange || 'Zmiana pozycji:'}** ${direction} ${prevLabel} → #${newGlobalPosition}\n\n${lines.join('\n\n')}`
        };
    }

    /**
     * Snippet dla rankingu konkretnego bossa (identyczny format jak globalny).
     * @param {string} userId
     * @param {Array} bossRanking  - wynik getGlobalBossRanking (już po aktualizacji)
     * @param {number|null} prevBossPosition - pozycja przed aktualizacją (null = nowy wpis)
     * @param {string} bossName
     * @param {object} msgs
     * @param {object} client
     * @returns {{ title, description }|null}
     */
    async buildBossSnippetFieldData(userId, bossRanking, prevBossPosition, bossName, msgs, client) {
        const newBossIndex = bossRanking.findIndex(p => p.userId === userId);
        if (newBossIndex === -1) return null;
        const newBossPosition = newBossIndex + 1;

        if (prevBossPosition !== null && prevBossPosition === newBossPosition) return null;

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
            const serverSuffix = tag ? ` • ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            return `${posLabel} ${displayName} • **${player.score || this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${bossName}${serverSuffix}`;
        };

        const prevLabel = prevBossPosition ? `#${prevBossPosition}` : '—';
        const direction = !prevBossPosition || prevBossPosition > newBossPosition ? '↑' : '↓';
        const title = msgs.bossSnippetTitle || '🎯 Zmiana w rankingu bossa';

        const lines = [];
        const above   = bossRanking[newBossIndex - 1];
        const current = bossRanking[newBossIndex];
        const below   = bossRanking[newBossIndex + 1];

        if (above) lines.push(await buildLine(above, newBossPosition - 1));

        let currentLine = await buildLine(current, newBossPosition);
        lines.push(`${direction} ${currentLine}`);

        if (below) {
            const belowDir = direction === '↑' ? '↓' : '↑';
            lines.push(`${belowDir} ${await buildLine(below, newBossPosition + 1)}`);
        }

        return { title, description: `**${msgs.snippetPositionChange || 'Zmiana pozycji:'}** ${direction} ${prevLabel} → #${newBossPosition}\n\n${lines.join('\n\n')}` };
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
