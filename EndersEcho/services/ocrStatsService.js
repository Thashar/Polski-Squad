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
            allTime:    { total: 0, success: 0, adminFixed: 0, doubleCheckRecovered: 0 },
            resettable: { total: 0, success: 0, adminFixed: 0, doubleCheckRecovered: 0, resetAt: null },
            userRejections: {},
            // Globalne liczniki zapytań do API AI (nie podlegają resetowi):
            // requests = każda próba zapytania, rejected = próba odrzucona przez API (przeciążenie/sieć),
            // fullFailures = wszystkie retry wyczerpane → screen użytkownika niezaakceptowany przez błąd API
            apiStats: { requests: 0, rejected: 0, fullFailures: 0 },
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
            // Uzupełnij brakujące pola dla starych plików (backward compat)
            this._data.allTime.doubleCheckRecovered = this._data.allTime.doubleCheckRecovered || 0;
            this._data.resettable.doubleCheckRecovered = this._data.resettable.doubleCheckRecovered || 0;
            if (!this._data.apiStats) this._data.apiStats = { requests: 0, rejected: 0, fullFailures: 0 };
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
        this._data.resettable = { total: 0, success: 0, adminFixed: 0, doubleCheckRecovered: 0, resetAt: new Date().toISOString() };
        await this._save();
    }

    // ── Globalne liczniki API AI (nie resetowane przyciskiem resetu) ──────────
    async recordApiRequest() {
        if (!this._data) await this.load();
        if (!this._data.apiStats) this._data.apiStats = { requests: 0, rejected: 0, fullFailures: 0 };
        this._data.apiStats.requests++;
        this._save().catch(() => {});
    }

    // Pojedyncza próba odrzucona przez API (429/500/503/błąd sieci)
    async recordApiRejection() {
        if (!this._data) await this.load();
        if (!this._data.apiStats) this._data.apiStats = { requests: 0, rejected: 0, fullFailures: 0 };
        this._data.apiStats.rejected++;
        this._save().catch(() => {});
    }

    // Wszystkie retry wyczerpane — API odrzuciło zapytania tyle razy pod rząd, że screen nie został zaakceptowany
    async recordApiFullFailure() {
        if (!this._data) await this.load();
        if (!this._data.apiStats) this._data.apiStats = { requests: 0, rejected: 0, fullFailures: 0 };
        this._data.apiStats.fullFailures++;
        this._save().catch(() => {});
    }

    // Podwójna analiza wzorca: pierwsza próba negatywna, druga próba pozytywna (screen przeszedł za drugim razem)
    async recordDoubleCheckRecovered() {
        if (!this._data) await this.load();
        this._data.allTime.doubleCheckRecovered = (this._data.allTime.doubleCheckRecovered || 0) + 1;
        this._data.resettable.doubleCheckRecovered = (this._data.resettable.doubleCheckRecovered || 0) + 1;
        this._save().catch(() => {});
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

    async recordRejection(guildId, userId) {
        if (!this._data) await this.load();
        if (!this._data.userRejections) this._data.userRejections = {};
        if (!this._data.userRejections[guildId]) this._data.userRejections[guildId] = {};
        if (!this._data.userRejections[guildId][userId]) this._data.userRejections[guildId][userId] = {};
        const monthKey = new Date().toISOString().slice(0, 7);
        const u = this._data.userRejections[guildId][userId];
        u[monthKey] = (u[monthKey] || 0) + 1;
        this._save().catch(() => {});
    }

    getMonthlyTopRejectedUsers(month, guildFilter) {
        const rejData = this._data?.userRejections || {};
        const guildIds = guildFilter === 'all' ? Object.keys(rejData) : [guildFilter];
        const byUser = new Map();
        for (const gId of guildIds) {
            for (const [uId, months] of Object.entries(rejData[gId] || {})) {
                const count = months[month] || 0;
                if (count > 0) byUser.set(uId, (byUser.get(uId) || 0) + count);
            }
        }
        return [...byUser.entries()]
            .map(([userId, count]) => ({ userId, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
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
