'use strict';

const fs = require('fs').promises;
const path = require('path');
const { compareByScoreThenTimestamp, getOwnerId, getProfileIndex } = require('../utils/helpers');
const store = require('../../utils/jsonStore');

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
            return await store.getOrLoad(this._file(guildId), () => ({}));
        } catch {
            return {};
        }
    }

    async _save(guildId, data) {
        const file = this._file(guildId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await store.set(file, data);
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
    async updateBossRecord(guildId, playerKey, bossName, username, score, scoreValue, timestamp) {
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[playerKey]) data[playerKey] = {};
            const existing = data[playerKey][bossName];
            const existingValue = existing && typeof existing.scoreValue === 'number' ? existing.scoreValue : -Infinity;
            if (scoreValue <= existingValue) {
                return { isNewBossRecord: false, previousBossRecord: existing ? { ...existing } : null };
            }
            const previousBossRecord = existing ? { ...existing } : null;
            data[playerKey][bossName] = { score, scoreValue, timestamp, username };
            await this._save(guildId, data);
            return { isNewBossRecord: true, previousBossRecord };
        });
    }

    /**
     * Cofnięcie rekordu per-boss (CV remove / ocr revert).
     * previousBossRecord = null → usuwa rekord bossa dla gracza.
     */
    async revertBossRecord(guildId, playerKey, bossName, previousBossRecord) {
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[playerKey]) return;
            if (previousBossRecord) {
                data[playerKey][bossName] = { ...previousBossRecord };
            } else {
                delete data[playerKey][bossName];
                if (Object.keys(data[playerKey]).length === 0) delete data[playerKey];
            }
            await this._save(guildId, data);
        });
    }

    /**
     * Usuwa WSZYSTKIE rekordy bossów gracza na danym serwerze (np. przy usunięciu gracza z rankingu).
     * @returns {number} liczba usuniętych rekordów bossów
     */
    /**
     * Przenosi rekordy bossów pod nowy playerKey (przenumerowanie slotów profili).
     * @returns {Promise<boolean>} czy było co przenosić
     */
    async renamePlayerKey(guildId, oldKey, newKey) {
        if (oldKey === newKey) return false;
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[oldKey]) return false;
            data[newKey] = { ...(data[newKey] || {}), ...data[oldKey] };
            delete data[oldKey];
            await this._save(guildId, data);
            return true;
        });
    }

    async removeAllUserBossRecords(guildId, playerKey) {
        return this._enqueue(guildId, async () => {
            const data = await this._load(guildId);
            if (!data[playerKey]) return 0;
            const removed = Object.keys(data[playerKey]).length;
            delete data[playerKey];
            await this._save(guildId, data);
            return removed;
        });
    }

    /**
     * Read-only: czy podany wynik pobiłby istniejący rekord bossa gracza?
     * Używane w trybie dryRun (/test) — nie zapisuje niczego.
     */
    async wouldBeatBossRecord(guildId, playerKey, bossName, scoreValue) {
        const data = await this._load(guildId);
        const existing = data?.[playerKey]?.[bossName];
        const existingValue = (existing && typeof existing.scoreValue === 'number') ? existing.scoreValue : -Infinity;
        return scoreValue > existingValue;
    }

    /**
     * Globalny ranking profili wg najlepszego wyniku na danym bossie (cross-guild).
     * Każdy profil gracza to osobny wpis; `userId` to właściciel (do wzmianek Discord).
     * @param {string[]} allGuildIds
     * @param {string} bossName - angielska nazwa bossa
     * @returns {Array<{ playerKey, userId, profileIndex, username, score, scoreValue, timestamp, sourceGuildId }>}
     */
    async getGlobalBossRanking(allGuildIds, bossName) {
        const bestPerPlayer = new Map();
        for (const guildId of allGuildIds) {
            const data = await this._load(guildId);
            for (const [playerKey, bosses] of Object.entries(data)) {
                const entry = bosses[bossName];
                if (!entry) continue;
                const prev = bestPerPlayer.get(playerKey);
                if (!prev || entry.scoreValue > prev.scoreValue) {
                    bestPerPlayer.set(playerKey, { ...entry, sourceGuildId: guildId });
                }
            }
        }
        return Array.from(bestPerPlayer.entries())
            .map(([playerKey, entry]) => ({
                playerKey,
                userId: getOwnerId(playerKey),
                profileIndex: getProfileIndex(playerKey),
                ...entry,
            }))
            .sort(compareByScoreThenTimestamp);
    }

    /**
     * SYMULACJA (read-only, /test): globalny ranking bossa jak GDYBY zapisano nowy wynik profilu.
     * Nie modyfikuje danych — klonuje aktualny ranking i nakłada nowy wynik.
     */
    async simulateGlobalBossRanking(allGuildIds, bossName, playerKey, scoreValue, score, username, sourceGuildId) {
        const ranking = (await this.getGlobalBossRanking(allGuildIds, bossName)).map(p => ({ ...p }));
        const idx = ranking.findIndex(p => p.playerKey === playerKey);
        if (idx !== -1) {
            if (scoreValue > (ranking[idx].scoreValue || 0)) {
                ranking[idx] = { ...ranking[idx], score, scoreValue, sourceGuildId, timestamp: new Date().toISOString() };
            }
        } else {
            ranking.push({
                playerKey,
                userId: getOwnerId(playerKey),
                profileIndex: getProfileIndex(playerKey),
                username,
                score,
                scoreValue,
                sourceGuildId,
                timestamp: new Date().toISOString(),
            });
        }
        ranking.sort(compareByScoreThenTimestamp);
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
            for (const [playerKey, bosses] of Object.entries(data)) {
                for (const bossName of Object.keys(bosses)) {
                    if (!knownSet.has(bossName)) continue;
                    if (!bossPlayers.has(bossName)) bossPlayers.set(bossName, new Set());
                    bossPlayers.get(bossName).add(playerKey);
                }
            }
        }
        return Array.from(bossPlayers.entries())
            .map(([bossName, players]) => ({ bossName, totalPlayers: players.size }))
            .sort((a, b) => a.bossName.localeCompare(b.bossName));
    }

    /**
     * Zwraca surowe nazwy bossów z rekordów, które NIE są znane (brak w englishNames/aliasach)
     * — czekają na zmapowanie przez head admina.
     * @param {string[]|Set} allGuildIds
     * @param {string[]} knownEnglishNames
     * @returns {Promise<string[]>} posortowana lista nieznanych nazw
     */
    async getUnknownBossNames(allGuildIds, knownEnglishNames) {
        const knownSet = new Set(knownEnglishNames);
        const unknown = new Set();
        for (const guildId of allGuildIds) {
            const data = await this._load(guildId).catch(() => ({}));
            for (const bosses of Object.values(data)) {
                for (const bossName of Object.keys(bosses)) {
                    if (!knownSet.has(bossName)) unknown.add(bossName);
                }
            }
        }
        return [...unknown].sort((a, b) => a.localeCompare(b));
    }

    /**
     * Liczy globalną pozycję gracza per boss jednym przebiegiem przez wszystkie serwery.
     * Zwraca tylko bossów gdzie gracz MA rekord.
     * @param {string[]|Set} allGuildIds
     * @param {string} playerKey
     * @returns {Promise<Object>} { bossName: position (1-indexed) }
     */
    async getPlayerBossPositions(allGuildIds, playerKey) {
        const allGuildsData = await Promise.all(
            [...allGuildIds].map(gid => this._load(gid).catch(() => ({})))
        );
        // Zbierz najlepszy wynik per gracz per boss ze wszystkich serwerów
        const bossPlayerBest = {}; // bossName -> Map<playerKey, scoreValue>
        for (const guildData of allGuildsData) {
            for (const [playerKey, bosses] of Object.entries(guildData)) {
                for (const [bossName, rec] of Object.entries(bosses)) {
                    if (!bossPlayerBest[bossName]) bossPlayerBest[bossName] = new Map();
                    const cur = bossPlayerBest[bossName].get(playerKey) ?? -Infinity;
                    if (rec.scoreValue > cur) bossPlayerBest[bossName].set(playerKey, rec.scoreValue);
                }
            }
        }
        const positions = {};
        for (const [bossName, playerMap] of Object.entries(bossPlayerBest)) {
            const targetScore = playerMap.get(playerKey);
            if (targetScore === undefined) continue;
            const sorted = [...playerMap.values()].sort((a, b) => b - a);
            positions[bossName] = sorted.findIndex(s => s === targetScore) + 1;
        }
        return positions;
    }

    /**
     * Zwraca rekordy bossów jednego gracza na danym serwerze.
     * @param {string} guildId
     * @param {string} playerKey
     * @returns {Object} { bossName: { score, scoreValue, timestamp, username } }
     */
    /**
     * Najnowszy rekord bossa KAŻDEGO gracza, zebrany jednym przejściem po plikach.
     *
     * Używa tego losowanie Gracza Dnia do odsiania profili, na których nic się już
     * nie dzieje. Świadomie NIE woła getUserBossRecordsAllGuilds per gracz: plik
     * serwera trzyma rekordy wszystkich naraz, więc jedno wczytanie na serwer
     * wystarcza na całą pulę, zamiast setek odczytów.
     *
     * @param {Iterable<string>} allGuildIds
     * @returns {Promise<Object>} { playerKey: znacznik czasu w ms }
     */
    async getLastBossRecordTimestamps(allGuildIds) {
        const latest = {};
        for (const guildId of allGuildIds) {
            const data = await this._load(guildId).catch(() => ({}));
            for (const [playerKey, records] of Object.entries(data)) {
                for (const rec of Object.values(records || {})) {
                    const ts = Date.parse(rec?.timestamp);
                    if (!Number.isFinite(ts)) continue;
                    if (!latest[playerKey] || ts > latest[playerKey]) latest[playerKey] = ts;
                }
            }
        }
        return latest;
    }

    async getUserBossRecords(guildId, playerKey) {
        const all = await this._load(guildId);
        return all[playerKey] || {};
    }

    /**
     * Zwraca najlepsze rekordy bossów gracza ze wszystkich serwerów (merge po scoreValue).
     * @param {string[]|Set} allGuildIds
     * @param {string} playerKey
     * @returns {Object} { bossName: { score, scoreValue, timestamp, username, sourceGuildId } }
     */
    async getUserBossRecordsAllGuilds(allGuildIds, playerKey) {
        const perGuild = await Promise.all(
            [...allGuildIds].map(async gid => {
                const recs = await this._load(gid).catch(() => ({}));
                return [gid, recs[playerKey] || {}];
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
                for (const [playerKey, bosses] of Object.entries(data)) {
                    const rawEntry = bosses[rawName];
                    if (!rawEntry) continue;
                    const engEntry = bosses[englishName];
                    if (!engEntry || rawEntry.scoreValue > engEntry.scoreValue) {
                        data[playerKey][englishName] = { ...rawEntry };
                    }
                    delete data[playerKey][rawName];
                    if (Object.keys(data[playerKey]).length === 0) delete data[playerKey];
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
