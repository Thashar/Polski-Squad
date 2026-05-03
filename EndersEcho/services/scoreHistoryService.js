const fs = require('fs').promises;
const path = require('path');

class ScoreHistoryService {
    constructor(dataDir) {
        this.dataDir = dataDir;
    }

    _file(guildId) {
        return path.join(this.dataDir, `score_history_${guildId}.json`);
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
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this._file(guildId), JSON.stringify(data, null, 2), 'utf8');
    }

    async addEntry(guildId, userId, entry) {
        const data = await this._load(guildId);
        if (!data[userId]) data[userId] = [];
        data[userId].push(entry);
        await this._save(guildId, data);
    }

    // Zwraca wpisy z ostatnich maxDaysBack dni, posortowane chronologicznie
    async getUserHistory(guildId, userId, maxDaysBack = 90) {
        const data = await this._load(guildId);
        const history = data[userId] || [];
        const cutoff = Date.now() - maxDaysBack * 24 * 60 * 60 * 1000;
        return history
            .filter(e => new Date(e.timestamp).getTime() >= cutoff)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
}

module.exports = ScoreHistoryService;
