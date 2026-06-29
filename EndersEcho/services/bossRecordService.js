'use strict';

const fs = require('fs').promises;
const path = require('path');

class BossRecordService {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this._queues = new Map(); // guildId → Promise (kolejka zapisu per-guild)
    }

    _file(guildId) {
        return path.join(this.dataDir, 'guilds', guildId, 'boss_records.json');
    }

    async _load(guildId) {
        try {
            const raw = await fs.readFile(this._file(guildId), 'utf8');
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    async _save(guildId, data) {
        const file = this._file(guildId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    }

    _enqueue(guildId, fn) {
        const prev = this._queues.get(guildId) || Promise.resolve();
        const next = prev.then(fn).catch(err => { throw err; });
        this._queues.set(guildId, next.catch(() => {}));
        return next;
    }

    /**
     * Aktualizuje rekord per-boss gracza jeśli nowy wynik jest lepszy.
     * Wywoływane zawsze po pozytywnym OCR — niezależnie od wyniku rekordu ogólnego.
     * @returns {{ isNewBossRecord: boolean, previousBossRecord: object|null }}
     */
    async updateBossRecord(guildId, userId, bossName, username, score, scoreValue, timestamp) {
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[userId]) data[userId] = {};
            const existing = data[userId][bossName];
            const existingValue = existing && typeof existing.scoreValue === 'number' ? existing.scoreValue : -Infinity;
            if (scoreValue <= existingValue) {
                return { isNewBossRecord: false, previousBossRecord: existing ? { ...existing } : null };
            }
            const previousBossRecord = existing ? { ...existing } : null;
            data[userId][bossName] = { score, scoreValue, timestamp, username };
            await this._save(guildId, data);
            return { isNewBossRecord: true, previousBossRecord };
        });
    }

    /**
     * Cofnięcie rekordu per-boss (CV remove / ocr revert).
     * previousBossRecord = null → usuwa rekord bossa dla gracza.
     */
    async revertBossRecord(guildId, userId, bossName, previousBossRecord) {
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[userId]) return;
            if (previousBossRecord) {
                data[userId][bossName] = { ...previousBossRecord };
            } else {
                delete data[userId][bossName];
                if (Object.keys(data[userId]).length === 0) delete data[userId];
            }
            await this._save(guildId, data);
        });
    }

    /**
     * Read-only: czy podany wynik pobiłby istniejący rekord bossa gracza?
     * Używane w trybie dryRun (/test) — nie zapisuje niczego.
     */
    async wouldBeatBossRecord(guildId, userId, bossName, scoreValue) {
        const data = await this._load(guildId);
        const existing = data?.[userId]?.[bossName];
        const existingValue = (existing && typeof existing.scoreValue === 'number') ? existing.scoreValue : -Infinity;
        return scoreValue > existingValue;
    }

    /**
     * Globalny ranking graczy wg najlepszego wyniku na danym bossie (cross-guild).
     * @param {string[]} allGuildIds
     * @param {string} bossName - angielska nazwa bossa
     * @returns {Array<{ userId, username, score, scoreValue, timestamp, sourceGuildId }>}
     */
    async getGlobalBossRanking(allGuildIds, bossName) {
        const bestPerPlayer = new Map();
        for (const guildId of allGuildIds) {
            const data = await this._load(guildId);
            for (const [userId, bosses] of Object.entries(data)) {
                const entry = bosses[bossName];
                if (!entry) continue;
                const prev = bestPerPlayer.get(userId);
                if (!prev || entry.scoreValue > prev.scoreValue) {
                    bestPerPlayer.set(userId, { ...entry, sourceGuildId: guildId });
                }
            }
        }
        return Array.from(bestPerPlayer.entries())
            .map(([userId, entry]) => ({ userId, ...entry }))
            .sort((a, b) => b.scoreValue - a.scoreValue);
    }

    /**
     * SYMULACJA (read-only, /test): globalny ranking bossa jak GDYBY zapisano nowy wynik gracza.
     * Nie modyfikuje danych — klonuje aktualny ranking i nakłada nowy wynik.
     */
    async simulateGlobalBossRanking(allGuildIds, bossName, userId, scoreValue, score, username, sourceGuildId) {
        const ranking = (await this.getGlobalBossRanking(allGuildIds, bossName)).map(p => ({ ...p }));
        const idx = ranking.findIndex(p => p.userId === userId);
        if (idx !== -1) {
            if (scoreValue > (ranking[idx].scoreValue || 0)) {
                ranking[idx] = { ...ranking[idx], score, scoreValue, sourceGuildId };
            }
        } else {
            ranking.push({ userId, username, score, scoreValue, sourceGuildId });
        }
        ranking.sort((a, b) => b.scoreValue - a.scoreValue);
        return ranking;
    }

    /**
     * Lista bossów które mają ≥1 rekord, filtrowana do znanych angielskich nazw.
     * Surowe/nieznane nazwy są niewidoczne w rankingach dopóki nie zostaną zmapowane.
     * @param {string[]} allGuildIds
     * @param {string[]} knownEnglishNames - z bossAliasService.getExtraEnglishNames()
     * @returns {Array<{ bossName: string, totalPlayers: number }>} posortowane alfabetycznie
     */
    async getBossesWithRecords(allGuildIds, knownEnglishNames) {
        const knownSet = new Set(knownEnglishNames);
        const bossPlayers = new Map();
        for (const guildId of allGuildIds) {
            const data = await this._load(guildId);
            for (const [userId, bosses] of Object.entries(data)) {
                for (const bossName of Object.keys(bosses)) {
                    if (!knownSet.has(bossName)) continue;
                    if (!bossPlayers.has(bossName)) bossPlayers.set(bossName, new Set());
                    bossPlayers.get(bossName).add(userId);
                }
            }
        }
        return Array.from(bossPlayers.entries())
            .map(([bossName, players]) => ({ bossName, totalPlayers: players.size }))
            .sort((a, b) => a.bossName.localeCompare(b.bossName));
    }

    /**
     * Liczy globalną pozycję gracza per boss jednym przebiegiem przez wszystkie serwery.
     * Zwraca tylko bossów gdzie gracz MA rekord.
     * @param {string[]|Set} allGuildIds
     * @param {string} userId
     * @returns {Promise<Object>} { bossName: position (1-indexed) }
     */
    async getPlayerBossPositions(allGuildIds, userId) {
        const allGuildsData = await Promise.all(
            [...allGuildIds].map(gid => this._load(gid).catch(() => ({})))
        );
        // Zbierz najlepszy wynik per gracz per boss ze wszystkich serwerów
        const bossPlayerBest = {}; // bossName -> Map<userId, scoreValue>
        for (const guildData of allGuildsData) {
            for (const [uid, bosses] of Object.entries(guildData)) {
                for (const [bossName, rec] of Object.entries(bosses)) {
                    if (!bossPlayerBest[bossName]) bossPlayerBest[bossName] = new Map();
                    const cur = bossPlayerBest[bossName].get(uid) ?? -Infinity;
                    if (rec.scoreValue > cur) bossPlayerBest[bossName].set(uid, rec.scoreValue);
                }
            }
        }
        const positions = {};
        for (const [bossName, playerMap] of Object.entries(bossPlayerBest)) {
            const targetScore = playerMap.get(userId);
            if (targetScore === undefined) continue;
            const sorted = [...playerMap.values()].sort((a, b) => b - a);
            positions[bossName] = sorted.findIndex(s => s === targetScore) + 1;
        }
        return positions;
    }

    /**
     * Zwraca rekordy bossów jednego gracza na danym serwerze.
     * @param {string} guildId
     * @param {string} userId
     * @returns {Object} { bossName: { score, scoreValue, timestamp, username } }
     */
    async getUserBossRecords(guildId, userId) {
        const all = await this._load(guildId);
        return all[userId] || {};
    }

    /**
     * Zwraca najlepsze rekordy bossów gracza ze wszystkich serwerów (merge po scoreValue).
     * @param {string[]|Set} allGuildIds
     * @param {string} userId
     * @returns {Object} { bossName: { score, scoreValue, timestamp, username, sourceGuildId } }
     */
    async getUserBossRecordsAllGuilds(allGuildIds, userId) {
        const perGuild = await Promise.all(
            [...allGuildIds].map(async gid => {
                const recs = await this._load(gid).catch(() => ({}));
                return [gid, recs[userId] || {}];
            })
        );
        const merged = {};
        for (const [gid, recs] of perGuild) {
            for (const [boss, rec] of Object.entries(recs)) {
                if (!merged[boss] || rec.scoreValue > merged[boss].scoreValue) {
                    merged[boss] = { ...rec, sourceGuildId: gid };
                }
            }
        }
        return merged;
    }

    /**
     * Migracja: przenosi rekordy z surowej/starej nazwy bossa do angielskiej.
     * Wywoływana po dodaniu aliasu przez admina (boss_map_lang_sel, boss_cfg_add_lang_sel).
     * Jeśli gracz ma rekordy pod obiema nazwami — zachowuje lepszy wynik.
     * @param {string} rawName - stara/surowa nazwa bossa
     * @param {string} englishName - angielska nazwa (cel)
     * @param {string[]} allGuildIds
     * @returns {number} liczba zmigrowanych wpisów graczy
     */
    async migrateBossName(rawName, englishName, allGuildIds) {
        if (rawName === englishName) return 0;
        let migratedCount = 0;
        for (const guildId of allGuildIds) {
            await this._enqueue(guildId, async () => {
                const data = await this._load(guildId);
                let changed = false;
                for (const [userId, bosses] of Object.entries(data)) {
                    const rawEntry = bosses[rawName];
                    if (!rawEntry) continue;
                    const engEntry = bosses[englishName];
                    if (!engEntry || rawEntry.scoreValue > engEntry.scoreValue) {
                        data[userId][englishName] = { ...rawEntry };
                    }
                    delete data[userId][rawName];
                    if (Object.keys(data[userId]).length === 0) delete data[userId];
                    changed = true;
                    migratedCount++;
                }
                if (changed) await this._save(guildId, data);
            });
        }
        return migratedCount;
    }
}

module.exports = BossRecordService;
