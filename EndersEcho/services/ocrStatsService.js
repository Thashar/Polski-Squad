const fs = require('fs').promises;
const path = require('path');

class OcrStatsService {
    constructor(dataDir, logger) {
        this.dataPath = path.join(dataDir, 'ocr_stats.json');
        this.logger = logger;
        this._data = null;
        this._saving = false;
        this._pendingSave = false;
    }

    async load() {
        try {
            const raw = await fs.readFile(this.dataPath, 'utf8');
            this._data = JSON.parse(raw);
        } catch {
            this._data = { guilds: {} };
        }
    }

    _guild(guildId) {
        if (!this._data.guilds[guildId]) {
            this._data.guilds[guildId] = {
                allTime:    { total: 0, success: 0 },
                resettable: { total: 0, success: 0, resetAt: null },
            };
        }
        return this._data.guilds[guildId];
    }

    async record(guildId, isSuccess) {
        if (!this._data) await this.load();
        const g = this._guild(guildId);
        g.allTime.total++;
        g.resettable.total++;
        if (isSuccess) {
            g.allTime.success++;
            g.resettable.success++;
        }
        this._save().catch(() => {});
    }

    async resetResettable(guildId) {
        if (!this._data) await this.load();
        const g = this._guild(guildId);
        g.resettable = { total: 0, success: 0, resetAt: new Date().toISOString() };
        await this._save();
    }

    getStats(guildId) {
        if (!this._data) return null;
        return this._guild(guildId);
    }

    getAllStats() {
        if (!this._data) return {};
        return this._data.guilds;
    }

    async _save() {
        if (this._saving) { this._pendingSave = true; return; }
        this._saving = true;
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(this._data, null, 2), 'utf8');
        } catch (err) {
            this.logger?.warn?.(`OcrStatsService: błąd zapisu: ${err.message}`);
        } finally {
            this._saving = false;
            if (this._pendingSave) {
                this._pendingSave = false;
                this._save().catch(() => {});
            }
        }
    }
}

module.exports = OcrStatsService;
