const fs = require('fs').promises;
const path = require('path');
const { getOwnerId } = require('../utils/helpers');
const store = require('../../utils/jsonStore');

/**
 * Historia wyników. Plik na PROFIL: wyniki/{playerKey}.json
 * (profil główny = samo userId, profile dodatkowe = "userId#N").
 *
 * Statystyki zbiorcze (przyrost graczy, aktywność, nowi gracze) agregują po WŁAŚCICIELU
 * (userId), nie po pliku — gracz z kilkoma profilami to nadal jedna osoba, a wszystkie
 * liczniki graczy w bocie muszą pokazywać tę samą liczbę co rankingService.getCountedPlayers().
 */
class ScoreHistoryService {
    constructor(dataDir) {
        this.dataDir = dataDir;
    }

    _file(guildId, playerKey) {
        return path.join(this.dataDir, 'guilds', guildId, 'wyniki', `${playerKey}.json`);
    }

    async _load(guildId, playerKey) {
        try {
            return await store.getOrLoad(this._file(guildId, playerKey), () => ([]));
        } catch {
            return [];
        }
    }

    async _save(guildId, playerKey, entries) {
        const file = this._file(guildId, playerKey);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await store.set(file, entries);
    }

    /**
     * Przenosi historię wyników pod nowy playerKey (przenumerowanie slotów profili).
     * Gdy plik docelowy istnieje (nie powinien — slot jest wolny), wpisy są scalane
     * chronologicznie, żeby nic nie przepadło.
     * @returns {Promise<boolean>} czy było co przenosić
     */
    async renamePlayerKey(guildId, oldKey, newKey) {
        if (oldKey === newKey) return false;
        const entries = await this._load(guildId, oldKey);
        if (entries.length === 0) return false;
        const target = await this._load(guildId, newKey);
        const merged = [...target, ...entries].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        await this._save(guildId, newKey, merged);
        await fs.unlink(this._file(guildId, oldKey)).catch(() => {});
        return true;
    }

    async addEntry(guildId, playerKey, entry) {
        const entries = await this._load(guildId, playerKey);
        entries.push(entry);
        await this._save(guildId, playerKey, entries);
    }

    // Usuwa ostatni wpis z danym scoreValue (przy cofaniu rekordu przez admina)
    async removeEntry(guildId, playerKey, scoreValue) {
        const entries = await this._load(guildId, playerKey);
        if (entries.length === 0) return;
        const lastIdx = entries.map(e => e.scoreValue).lastIndexOf(scoreValue);
        if (lastIdx === -1) return;
        entries.splice(lastIdx, 1);
        await this._save(guildId, playerKey, entries);
    }

    // Usuwa wszystkie wpisy z timestamp >= fromTimestamp (przy cofaniu rekordu przez CV).
    // Zwraca liczbę usuniętych wpisów.
    async removeEntriesAfter(guildId, playerKey, fromTimestamp) {
        const entries = await this._load(guildId, playerKey);
        if (entries.length === 0) return 0;
        const cutoff = new Date(fromTimestamp).getTime();
        const filtered = entries.filter(e => new Date(e.timestamp).getTime() < cutoff);
        const removed = entries.length - filtered.length;
        if (removed > 0) {
            await this._save(guildId, playerKey, filtered);
        }
        return removed;
    }

    // Zwraca WSZYSTKIE wpisy gracza (bez filtra dni), posortowane chronologicznie. Używane przez panel "Usuń wynik".
    async getAllUserEntries(guildId, playerKey) {
        const entries = await this._load(guildId, playerKey);
        return entries.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Usuwa wpis o danym timestampie (ms). Zwraca usunięty wpis lub null. Używane przez panel "Usuń wynik".
    async removeEntryByTimestamp(guildId, playerKey, timestampMs) {
        const entries = await this._load(guildId, playerKey);
        const idx = entries.findIndex(e => new Date(e.timestamp).getTime() === timestampMs);
        if (idx === -1) return null;
        const [removed] = entries.splice(idx, 1);
        await this._save(guildId, playerKey, entries);
        return removed;
    }

    // Zwraca wpisy z ostatnich maxDaysBack dni, posortowane chronologicznie
    async getUserHistory(guildId, playerKey, maxDaysBack = 90) {
        const entries = await this._load(guildId, playerKey);
        const cutoff = Date.now() - maxDaysBack * 24 * 60 * 60 * 1000;
        return entries
            .filter(e => new Date(e.timestamp).getTime() >= cutoff)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Zwraca wpisy ze wszystkich serwerów, scalone i posortowane chronologicznie.
    // Każdy wpis ma dodane pole guildId (z ścieżki pliku) do identyfikacji klanu.
    async getUserHistoryAllGuilds(allGuildIds, playerKey, maxDaysBack = 90) {
        const cutoff = Date.now() - maxDaysBack * 24 * 60 * 60 * 1000;
        const allEntries = await Promise.all(
            allGuildIds.map(gid =>
                this._load(gid, playerKey).then(entries => entries.map(e => ({ ...e, guildId: gid })))
            )
        );
        return allEntries
            .flat()
            .filter(e => new Date(e.timestamp).getTime() >= cutoff)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Zwraca { guildId: firstTimestampMs } — kiedy na danym serwerze pojawił się pierwszy wynik.
    async getGuildFirstTimestamps(allGuildIds) {
        const result = {};
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files = [];
            try { files = await fs.readdir(dir); } catch { continue; }
            let earliest = null;
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const entries = await store.getOrLoad(path.join(dir, file), () => ([]));
                    if (!Array.isArray(entries) || entries.length === 0) continue;
                    const ts = Math.min(...entries.map(e => new Date(e.timestamp).getTime()));
                    if (!isNaN(ts) && (earliest === null || ts < earliest)) earliest = ts;
                } catch { /* pomiń */ }
            }
            if (earliest !== null) result[guildId] = earliest;
        }
        return result;
    }

    // Zwraca { guildId: liczba_graczy } — ile unikalnych GRACZY (nie profili) ma wyniki na danym serwerze.
    async getGuildPlayerCounts(allGuildIds) {
        const counts = {};
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files = [];
            try { files = await fs.readdir(dir); } catch { /* brak wyników */ }
            const owners = new Set(
                files.filter(f => f.endsWith('.json')).map(f => getOwnerId(f.slice(0, -5)))
            );
            counts[guildId] = owners.size;
        }
        return counts;
    }

    // Zwraca łączną liczbę wszystkich wpisów wyników (pobitych rekordów) we wszystkich serwerach.
    async getTotalSubmissionCount(allGuildIds) {
        let total = 0;
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files = [];
            try { files = await fs.readdir(dir); } catch { continue; }
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const entries = await store.getOrLoad(path.join(dir, file), () => ([]));
                    if (Array.isArray(entries)) total += entries.length;
                } catch { /* pomiń */ }
            }
        }
        return total;
    }

    // Zwraca tablicę { userId, firstTimestamp } dla każdego unikalnego gracza we wszystkich serwerach,
    // posortowaną chronologicznie. Używana do wykresu przyrostu unikalnych graczy globalnie.
    // allowedUserIds (Set|null) — gdy podany, liczeni są wyłącznie ci gracze (patrz getCountedPlayerIds
    // w rankingService: licznikiem całkowitym jest ranking globalny, nie pliki historii).
    async getAllUsersFirstEntries(allGuildIds, allowedUserIds = null) {
        const userFirstSeen = new Map(); // userId -> earliest timestamp ms
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files;
            try {
                files = await fs.readdir(dir);
            } catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                // Nazwa pliku = playerKey; gracza identyfikuje właściciel, więc wszystkie
                // profile jednej osoby scalają się w jeden wpis "pierwszy raz widziany"
                const userId = getOwnerId(file.slice(0, -5));
                if (allowedUserIds && !allowedUserIds.has(userId)) continue;
                try {
                    const entries = await store.getOrLoad(path.join(dir, file), () => ([]));
                    if (!Array.isArray(entries) || entries.length === 0) continue;
                    const earliest = Math.min(...entries.map(e => new Date(e.timestamp).getTime()));
                    if (isNaN(earliest)) continue;
                    const prev = userFirstSeen.get(userId);
                    if (prev === undefined || earliest < prev) {
                        userFirstSeen.set(userId, earliest);
                    }
                } catch {
                    // pomiń uszkodzone pliki
                }
            }
        }
        return Array.from(userFirstSeen.entries())
            .map(([userId, firstTimestamp]) => ({ userId, firstTimestamp }))
            .sort((a, b) => a.firstTimestamp - b.firstTimestamp);
    }

    // Zwraca statystyki aktywności graczy: aktywni (≥1 nowy rekord) w ostatnim tygodniu/miesiącu,
    // nowi gracze (pierwszy rekord kiedykolwiek) w ostatnim tygodniu/miesiącu,
    // oraz monthBuckets: { 'YYYY-MM': liczba_nowych_graczy }
    //
    // Wszystkie liczniki są deduplikowane GLOBALNIE po userId: historia gracza jest najpierw scalana
    // ze wszystkich serwerów, dopiero potem klasyfikowana. Bez tego gracz obecny na kilku serwerach
    // wchodził do monthBuckets wielokrotnie, a weteran, który po raz pierwszy wrzucił wynik na nowym
    // serwerze, był liczony jako "nowy" (pierwszy wpis liczony per plik, nie per gracz).
    //
    // allowedUserIds (Set|null) — gdy podany, liczeni są wyłącznie ci gracze (ranking globalny).
    async getActivePlayersStats(allGuildIds, allowedUserIds = null) {
        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

        // userId -> { firstTs, lastTs, count } scalone ze WSZYSTKICH serwerów
        const merged = new Map();

        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files = [];
            try { files = await fs.readdir(dir); } catch { continue; }

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                // Wszystkie profile gracza scalane w jeden wpis osoby (nazwa pliku = playerKey)
                const userId = getOwnerId(file.slice(0, -5));
                if (allowedUserIds && !allowedUserIds.has(userId)) continue;
                try {
                    const entries = await store.getOrLoad(path.join(dir, file), () => ([]));
                    if (!Array.isArray(entries) || entries.length === 0) continue;

                    let agg = merged.get(userId);
                    if (!agg) {
                        agg = { firstTs: Infinity, lastTs: -Infinity, count: 0 };
                        merged.set(userId, agg);
                    }
                    for (const entry of entries) {
                        const ts = new Date(entry.timestamp).getTime();
                        if (isNaN(ts)) continue;
                        agg.count++;
                        if (ts < agg.firstTs) agg.firstTs = ts;
                        if (ts > agg.lastTs) agg.lastTs = ts;
                    }
                } catch { /* pomiń uszkodzone pliki */ }
            }
        }

        let activeLastWeek = 0, activeLastMonth = 0, newLastWeek = 0, newLastMonth = 0;
        // Buckety miesięczne dla ostatnich 3 miesięcy (format YYYY-MM)
        const monthBuckets = {};
        // Liczba pobitych rekordów per gracz (każdy wpis historii = jedno pobicie), sumowana cross-server
        const recordCounts = [];

        for (const [userId, agg] of merged) {
            if (agg.count === 0) continue;
            if (agg.lastTs >= weekAgo) activeLastWeek++;
            if (agg.lastTs >= monthAgo) activeLastMonth++;
            if (agg.firstTs >= weekAgo) newLastWeek++;
            if (agg.firstTs >= monthAgo) newLastMonth++;
            const bucket = new Date(agg.firstTs).toISOString().slice(0, 7);
            monthBuckets[bucket] = (monthBuckets[bucket] || 0) + 1;
            recordCounts.push({ userId, count: agg.count });
        }

        // TOP10 graczy najczęściej pobijających rekordy (liczba wpisów historii, cross-server)
        const topRecordSetters = recordCounts
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            activeLastWeek,
            activeLastMonth,
            newLastWeek,
            newLastMonth,
            monthBuckets, // { 'YYYY-MM': count }
            topRecordSetters, // [{ userId, count }]
        };
    }

    // Zwraca { guildId, entry } dla najwcześniejszego wpisu danego gracza (szukane po wszystkich serwerach).
    // Używane do ustalenia, na którym serwerze i z jakim wynikiem gracz pojawił się po raz pierwszy.
    async getUserEarliestGuildEntry(allGuildIds, playerKey) {
        let best = null;
        for (const guildId of allGuildIds) {
            const entries = await this._load(guildId, playerKey);
            if (!Array.isArray(entries) || entries.length === 0) continue;
            for (const entry of entries) {
                const ts = new Date(entry.timestamp).getTime();
                if (isNaN(ts)) continue;
                if (!best || ts < best.ts) best = { guildId, entry, ts };
            }
        }
        return best ? { guildId: best.guildId, entry: best.entry } : null;
    }

    // Zwraca { guildId: [{userId, firstTimestamp}] } — dla każdego serwera lista pierwszych wpisów per gracz.
    // allowedUserIds (Set|null) — gdy podany, liczeni są wyłącznie ci gracze (ranking globalny).
    async getPerGuildFirstEntries(allGuildIds, allowedUserIds = null) {
        const result = {};
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            // ownerId -> najwcześniejszy timestamp (profile jednej osoby scalane w jeden wpis)
            const firstByOwner = new Map();
            let files;
            try { files = await fs.readdir(dir); } catch { result[guildId] = []; continue; }
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const ownerId = getOwnerId(file.slice(0, -5));
                if (allowedUserIds && !allowedUserIds.has(ownerId)) continue;
                try {
                    const userEntries = await store.getOrLoad(path.join(dir, file), () => ([]));
                    if (!Array.isArray(userEntries) || userEntries.length === 0) continue;
                    const earliest = Math.min(...userEntries.map(e => new Date(e.timestamp).getTime()));
                    if (isNaN(earliest)) continue;
                    const prev = firstByOwner.get(ownerId);
                    if (prev === undefined || earliest < prev) firstByOwner.set(ownerId, earliest);
                } catch {}
            }
            result[guildId] = Array.from(firstByOwner.entries())
                .map(([userId, firstTimestamp]) => ({ userId, firstTimestamp }))
                .sort((a, b) => a.firstTimestamp - b.firstTimestamp);
        }
        return result;
    }
}

module.exports = ScoreHistoryService;
