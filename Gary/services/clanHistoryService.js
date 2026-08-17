const path = require('path');

const store = require('../../utils/jsonStore');

// Shared data directory (accessible by all bots in the project)
const SHARED_DATA_DIR = path.join(__dirname, '../../shared_data');
const WEEKLY_DIR  = path.join(SHARED_DATA_DIR, 'lme_weekly');
const TOP500_DIR  = path.join(SHARED_DATA_DIR, 'lme_top500');
const GUILDS_DIR  = path.join(SHARED_DATA_DIR, 'lme_guilds');

/**
 * Persistent storage for three kinds of weekly snapshots:
 *
 * 1. `snapshots`      — TOP500 clan ranking (rank + score for every clan)
 * 2. `guildSnapshots` — Detailed data for the 4 PS clans (rank, totalRelicCores,
 *                        totalPower) captured straight from the garrytools analysis.
 * 3. shared_data/lme_weekly/week_YYYY_WW.json — Per-player RC+TC and attack
 *                        snapshot per week, keyed by lowercase player name,
 *                        readable by Stalker bot for /player-status and /player-compare charts.
 *
 * Both arrays grow indefinitely (no trimming) so history is never lost.
 * Data survives bot restarts via Gary/data/clan_history.json.
 *
 * Wszystkie dane trzymane są w pamięci przez `utils/jsonStore` — z dysku czytane
 * RAZ, przy starcie (`initialize()`), a zapis idzie jednocześnie do pliku i cache.
 * Pliki tygodniowe w `shared_data/` czyta Stalker, a że wszystkie boty dzielą jeden
 * proces i jeden store, widzi je natychmiast po zapisie.
 */
class ClanHistoryService {
    constructor(logger) {
        this.logger = logger;
        this.dataFile = path.join(__dirname, '../data/clan_history.json');

        store.register(this.dataFile, {
            defaultValue: () => ({ snapshots: [], guildSnapshots: [] }),
            label: 'Gary/clan_history'
        });
    }

    /**
     * Wypisuje stan po wczytaniu — wołane raz przy starcie bota (Gary/index.js).
     */
    initialize() {
        const history = this.history;
        this.logger.info(
            `📊 ClanHistory: załadowano ${history.snapshots.length} snapshots TOP500, ` +
            `${history.guildSnapshots.length} snapshots gildii`
        );
    }

    /**
     * Stan historii z pamięci (z dysku czytany tylko przy pierwszym sięgnięciu).
     * Mutujesz wynik → wołasz `_save()`.
     */
    get history() {
        return store.getSync(this.dataFile, () => ({ snapshots: [], guildSnapshots: [] }));
    }

    async _save() {
        try {
            await store.set(this.dataFile, this.history);
        } catch (err) {
            this.logger.error('ClanHistory: błąd zapisu:', err.message);
        }
    }

    /**
     * Zapis pliku tygodniowego do shared_data (TOP500 / gildie / gracze).
     */
    async _saveWeeklyFile(dir, fileName, data, description) {
        try {
            await store.set(path.join(dir, fileName), data);
            this.logger.info(`📊 ${description}: zapisano plik → ${fileName}`);
        } catch (err) {
            this.logger.error(`ClanHistory: błąd zapisu pliku ${description}:`, err.message);
        }
    }

    // ISO 8601 week number
    _getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TOP500 clan snapshots
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Save a snapshot of TOP500 clans from the ranking API.
     * @param {Array} clans - clan objects from clanAjaxService
     */
    async saveSnapshot(clans) {
        const now = new Date();
        const weekNumber = this._getWeekNumber(now);
        const year = now.getFullYear();

        const existingIdx = this.history.snapshots.findIndex(
            s => s.weekNumber === weekNumber && s.year === year
        );

        const snapshot = {
            weekNumber,
            year,
            timestamp: now.toISOString(),
            clans: clans.map(c => ({
                id: c.id,
                name: c.name,
                rank: c.rank,
                score: c.score,
                level: c.level,
                grade: c.grade || ''
            }))
        };

        if (existingIdx >= 0) {
            this.history.snapshots[existingIdx] = snapshot;
            this.logger.info(`📊 TOP500 snapshot: zaktualizowano tydz. ${weekNumber}/${year} (${clans.length} klanów)`);
        } else {
            this.history.snapshots.push(snapshot);
            this.logger.info(`📊 TOP500 snapshot: zapisano tydz. ${weekNumber}/${year} (${clans.length} klanów)`);
        }

        // Keep sorted chronologically; no trimming — history grows indefinitely
        this.history.snapshots.sort((a, b) =>
            a.year !== b.year ? a.year - b.year : a.weekNumber - b.weekNumber
        );

        await this._save();

        // Dodatkowo zapisz do osobnego pliku tygodniowego (shared_data/lme_top500/week_YYYY_WW.json)
        const weekStr = String(weekNumber).padStart(2, '0');
        await this._saveWeeklyFile(TOP500_DIR, `week_${year}_${weekStr}.json`, snapshot, 'TOP500 snapshot');
    }

    /**
     * Return weekly score history for a clan (by numeric ID).
     * Returns at most 20 entries (last 20 weeks) for chart display.
     * @param {number} clanId
     * @returns {Array<{weekNumber, year, score, rank, level, grade, name}>}
     */
    getClanHistory(clanId) {
        const result = [];
        for (const snapshot of this.history.snapshots) {
            const clan = snapshot.clans.find(c => c.id === clanId);
            if (clan) {
                result.push({
                    weekNumber: snapshot.weekNumber,
                    year: snapshot.year,
                    timestamp: snapshot.timestamp,
                    score: clan.score,
                    rank: clan.rank,
                    level: clan.level,
                    grade: clan.grade,
                    name: clan.name
                });
            }
        }
        return result.slice(-20);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Detailed guild snapshots (4 PS clans — rank, RC, total power)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Save detailed weekly data for the 4 PS clans captured during the
     * scheduled Lunar Mine analysis.
     *
     * @param {Array} guilds - guild objects from garrytoolsService.fetchGroupDetails()
     *   Each guild: { guildId, title, rank, totalRelicCores, totalPower, ... }
     */
    async saveGuildSnapshot(guilds, scoreMap = null) {
        const now = new Date();
        const weekNumber = this._getWeekNumber(now);
        const year = now.getFullYear();

        // Parse rank — comes as "#5" or number
        const parseRank = (r) => {
            if (!r) return null;
            const n = parseInt(r.toString().replace('#', ''));
            return isNaN(n) ? null : n;
        };

        const existingIdx = this.history.guildSnapshots.findIndex(
            s => s.weekNumber === weekNumber && s.year === year
        );

        const snapshot = {
            weekNumber,
            year,
            timestamp: now.toISOString(),
            guilds: guilds.map(g => ({
                id: g.guildId,
                name: g.title,
                rank: parseRank(g.rank),
                totalRelicCores: g.totalRelicCores || 0,
                totalPower: g.totalPower || 0,
                gradeScore: g.gradeScore || '0%',
                ...(scoreMap && { score: scoreMap.get(g.guildId) || 0 })
            }))
        };

        if (existingIdx >= 0) {
            this.history.guildSnapshots[existingIdx] = snapshot;
            this.logger.info(`📊 Guild snapshot: zaktualizowano tydz. ${weekNumber}/${year} (${guilds.length} gildii)`);
        } else {
            this.history.guildSnapshots.push(snapshot);
            this.logger.info(`📊 Guild snapshot: zapisano tydz. ${weekNumber}/${year} (${guilds.length} gildii)`);
        }

        this.history.guildSnapshots.sort((a, b) =>
            a.year !== b.year ? a.year - b.year : a.weekNumber - b.weekNumber
        );

        await this._save();

        // Dodatkowo zapisz do shared_data/lme_guilds/week_YYYY_WW.json (dostępne dla innych botów)
        const weekStr = String(weekNumber).padStart(2, '0');
        await this._saveWeeklyFile(GUILDS_DIR, `week_${year}_${weekStr}.json`, snapshot, 'Guild snapshot');
    }

    /**
     * Return detailed weekly history for a specific guild (by numeric guildId).
     * Returns at most 20 entries for chart display.
     * @param {number} guildId
     * @returns {Array<{weekNumber, year, rank, totalRelicCores, totalPower, name}>}
     */
    getGuildHistory(guildId) {
        const result = [];
        for (const snapshot of this.history.guildSnapshots) {
            const guild = snapshot.guilds.find(g => g.id === guildId);
            if (guild) {
                result.push({
                    weekNumber: snapshot.weekNumber,
                    year: snapshot.year,
                    timestamp: snapshot.timestamp,
                    rank: guild.rank,
                    totalRelicCores: guild.totalRelicCores,
                    totalPower: guild.totalPower,
                    name: guild.name
                });
            }
        }
        return result.slice(-20);
    }

    /**
     * Return history for all 4 guilds in format suitable for multi-clan charts.
     * @param {number[]} guildIds
     * @returns {Array<{id, name, history}>}
     */
    getAllGuildsHistory(guildIds) {
        return guildIds.map(id => {
            const history = this.getGuildHistory(id);
            const name = history.length > 0 ? history[history.length - 1].name : `Guild ${id}`;
            return { id, name, history };
        }).filter(g => g.history.length >= 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Per-player combat stats snapshot (shared with Stalker bot)
    // File: shared_data/player_combat_history.json
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Save weekly RC+TC and attack stats for every member of the 4 PS guilds.
     * Data is written to shared_data/player_combat_history.json so that Stalker
     * bot can read it for /player-status and /player-compare charts.
     *
     * @param {Array} guilds - guild objects from garrytoolsService.fetchGroupDetails()
     *   Each guild has: { guildId, title, members: [{name, attack, relicCores}] }
     */
    async savePlayerSnapshot(guilds) {
        const now = new Date();
        const weekNumber = this._getWeekNumber(now);
        const year = now.getFullYear();

        try {
            // Zbierz dane wszystkich graczy z bieżącego tygodnia
            const players = {};
            let saved = 0;

            for (const guild of guilds) {
                if (!guild.members) continue;
                for (const member of guild.members) {
                    if (!member.name) continue;
                    const key = member.name.toLowerCase();
                    players[key] = {
                        originalName: member.name,
                        attack:       member.attack      || 0,
                        relicCores:   member.relicCores  || 0
                    };
                    saved++;
                }
            }

            // Zapisz do dedykowanego pliku tygodnia: week_YYYY_WW.json
            const weekStr = String(weekNumber).padStart(2, '0');
            const fileName = `week_${year}_${weekStr}.json`;
            const weekData = { weekNumber, year, savedAt: now.toISOString(), players };

            await store.set(path.join(WEEKLY_DIR, fileName), weekData);
            this.logger.info(`📊 Player combat snapshot: zapisano ${saved} wpisów → ${fileName}`);
        } catch (err) {
            this.logger.error('ClanHistory: błąd zapisu player combat snapshot:', err.message);
        }
    }

    getSnapshotCount() { return this.history.snapshots.length; }
    getGuildSnapshotCount() { return this.history.guildSnapshots.length; }
    getLatestTimestamp() {
        if (this.history.snapshots.length === 0) return null;
        return this.history.snapshots[this.history.snapshots.length - 1].timestamp;
    }
}

module.exports = ClanHistoryService;
