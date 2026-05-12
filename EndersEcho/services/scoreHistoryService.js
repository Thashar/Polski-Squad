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
}

module.exports = ScoreHistoryService;
