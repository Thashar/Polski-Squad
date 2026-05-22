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

    _defaultData() {
        return {
            allTime:    { total: 0, success: 0, adminFixed: 0 },
            resettable: { total: 0, success: 0, adminFixed: 0, resetAt: null },
        };
    }

    async load() {
        try {
            const raw = await fs.readFile(this.dataPath, 'utf8');
            const parsed = JSON.parse(raw);
            // Migracja starej struktury per-guild → globalna
            if (parsed.guilds && !parsed.allTime) {
                this._data = this._defaultData();
                for (const g of Object.values(parsed.guilds)) {
                    this._data.allTime.total    += g.allTime?.total    || 0;
                    this._data.allTime.success  += g.allTime?.success  || 0;
                    this._data.resettable.total   += g.resettable?.total   || 0;
                    this._data.resettable.success += g.resettable?.success || 0;
                }
            } else {
                this._data = { ...this._defaultData(), ...parsed };
                // Migracja — przenieś stare liczniki analyze → adminFixed
                if (this._data.allTime.adminFixed === undefined)
                    this._data.allTime.adminFixed = parsed.analyzeAllTime?.count || 0;
                if (this._data.resettable.adminFixed === undefined)
                    this._data.resettable.adminFixed = parsed.analyzeResettable?.count || 0;
                // Usuń przestarzałe pola
                delete this._data.analyzeAllTime;
                delete this._data.analyzeResettable;
            }
        } catch {
            this._data = this._defaultData();
        }
    }

    async record(_guildId, isSuccess) {
        if (!this._data) await this.load();
        this._data.allTime.total++;
        this._data.resettable.total++;
        if (isSuccess) {
            this._data.allTime.success++;
            this._data.resettable.success++;
        }
        this._save().catch(() => {});
    }

    async resetResettable() {
        if (!this._data) await this.load();
        this._data.resettable = { total: 0, success: 0, adminFixed: 0, resetAt: new Date().toISOString() };
        await this._save();
    }

    // Admin ręcznie zanalizował odrzucony screen → liczy się jako fail w success rate
    async recordAnalyze() {
        if (!this._data) await this.load();
        this._data.allTime.adminFixed++;
        this._data.resettable.adminFixed++;
        this._save().catch(() => {});
    }

    // Rekord cofnięty w jakikolwiek sposób (CV remove/block, revert button, analyze revert) → fail
    async recordReverted() {
        if (!this._data) await this.load();
        this._data.allTime.adminFixed++;
        this._data.resettable.adminFixed++;
        this._save().catch(() => {});
    }

    getStats() {
        if (!this._data) return null;
        return this._data;
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
