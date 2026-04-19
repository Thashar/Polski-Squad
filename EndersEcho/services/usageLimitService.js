const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class UsageLimitService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'usage_limits.json');
        this._limit = null;
        this._dailyUsage = {};
    }

    async load() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            this._limit = data.limit ?? null;
            this._dailyUsage = data.dailyUsage || {};
        } catch {
            this._limit = null;
            this._dailyUsage = {};
        }
    }

    async save() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const today = this._today();
        for (const key of Object.keys(this._dailyUsage)) {
            if (!key.endsWith(`_${today}`)) delete this._dailyUsage[key];
        }
        await fs.writeFile(this.filePath, JSON.stringify({
            limit: this._limit,
            dailyUsage: this._dailyUsage
        }, null, 2), 'utf8');
    }

    getLimit() {
        return this._limit;
    }

    async setLimit(limit) {
        this._limit = limit;
        await this.save();
        logger.info(`[UsageLimit] Ustawiono dzienny limit: ${limit === null ? 'brak' : limit}`);
    }

    _today() {
        return new Date().toISOString().split('T')[0];
    }

    _key(userId) {
        return `${userId}_${this._today()}`;
    }

    async checkAndRecord(userId) {
        await this.load();
        if (this._limit === null) return { allowed: true, limit: null, used: null };

        const key = this._key(userId);
        const used = this._dailyUsage[key] || 0;

        if (used >= this._limit) return { allowed: false, limit: this._limit, used };

        this._dailyUsage[key] = used + 1;
        await this.save();
        return { allowed: true, limit: this._limit, used: used + 1 };
    }
}

module.exports = UsageLimitService;
