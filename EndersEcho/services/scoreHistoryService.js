const fs = require('fs').promises;
const path = require('path');

class ScoreHistoryService {
    constructor(dataDir) {
        this.dataDir = dataDir;
    }

    _file(guildId, userId) {
        return path.join(this.dataDir, 'guilds', guildId, 'wyniki', `${userId}.json`);
    }

    async _load(guildId, userId) {
        try {
            const raw = await fs.readFile(this._file(guildId, userId), 'utf8');
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    async _save(guildId, userId, entries) {
        const file = this._file(guildId, userId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf8');
    }

    async addEntry(guildId, userId, entry) {
        const entries = await this._load(guildId, userId);
        entries.push(entry);
        await this._save(guildId, userId, entries);
    }

    // Usuwa ostatni wpis z danym scoreValue (przy cofaniu rekordu przez admina)
    async removeEntry(guildId, userId, scoreValue) {
        const entries = await this._load(guildId, userId);
        if (entries.length === 0) return;
        const lastIdx = entries.map(e => e.scoreValue).lastIndexOf(scoreValue);
        if (lastIdx === -1) return;
        entries.splice(lastIdx, 1);
        await this._save(guildId, userId, entries);
    }

    // Usuwa wszystkie wpisy z timestamp >= fromTimestamp (przy cofaniu rekordu przez CV).
    // Zwraca liczbę usuniętych wpisów.
    async removeEntriesAfter(guildId, userId, fromTimestamp) {
        const entries = await this._load(guildId, userId);
        if (entries.length === 0) return 0;
        const cutoff = new Date(fromTimestamp).getTime();
        const filtered = entries.filter(e => new Date(e.timestamp).getTime() < cutoff);
        const removed = entries.length - filtered.length;
        if (removed > 0) {
            await this._save(guildId, userId, filtered);
        }
        return removed;
    }

    // Zwraca wpisy z ostatnich maxDaysBack dni, posortowane chronologicznie
    async getUserHistory(guildId, userId, maxDaysBack = 90) {
        const entries = await this._load(guildId, userId);
        const cutoff = Date.now() - maxDaysBack * 24 * 60 * 60 * 1000;
        return entries
            .filter(e => new Date(e.timestamp).getTime() >= cutoff)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Zwraca wpisy ze wszystkich serwerów, scalone i posortowane chronologicznie.
    // Każdy wpis ma dodane pole guildId (z ścieżki pliku) do identyfikacji klanu.
    async getUserHistoryAllGuilds(allGuildIds, userId, maxDaysBack = 90) {
        const cutoff = Date.now() - maxDaysBack * 24 * 60 * 60 * 1000;
        const allEntries = await Promise.all(
            allGuildIds.map(gid =>
                this._load(gid, userId).then(entries => entries.map(e => ({ ...e, guildId: gid })))
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
                    const raw = await fs.readFile(path.join(dir, file), 'utf8');
                    const entries = JSON.parse(raw);
                    if (!Array.isArray(entries) || entries.length === 0) continue;
                    const ts = Math.min(...entries.map(e => new Date(e.timestamp).getTime()));
                    if (!isNaN(ts) && (earliest === null || ts < earliest)) earliest = ts;
                } catch { /* pomiń */ }
            }
            if (earliest !== null) result[guildId] = earliest;
        }
        return result;
    }

    // Zwraca { guildId: liczba_graczy } — ile unikalnych plików wyników istnieje na danym serwerze.
    async getGuildPlayerCounts(allGuildIds) {
        const counts = {};
        for (const guildId of allGuildIds) {
            const dir = path.join(this.dataDir, 'guilds', guildId, 'wyniki');
            let files = [];
            try { files = await fs.readdir(dir); } catch { /* brak wyników */ }
            counts[guildId] = files.filter(f => f.endsWith('.json')).length;
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
                    const raw = await fs.readFile(path.join(dir, file), 'utf8');
                    const entries = JSON.parse(raw);
                    if (Array.isArray(entries)) total += entries.length;
                } catch { /* pomiń */ }
            }
        }
        return total;
    }

    // Zwraca tablicę { userId, firstTimestamp } dla każdego unikalnego gracza we wszystkich serwerach,
    // posortowaną chronologicznie. Używana do wykresu przyrostu unikalnych graczy globalnie.
    async getAllUsersFirstEntries(allGuildIds) {
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
                const userId = file.slice(0, -5);
                try {
                    const raw = await fs.readFile(path.join(dir, file), 'utf8');
                    const entries = JSON.parse(raw);
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
}

module.exports = ScoreHistoryService;
