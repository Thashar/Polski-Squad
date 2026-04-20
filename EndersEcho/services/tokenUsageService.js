const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Cennik Gemini 2.5 Flash Preview ($/1M tokenów)
const PRICING = {
    input:   0.15,
    output:  0.60,
    thought: 0.35,
};

function calcCost(promptTokens, outputTokens, thoughtTokens) {
    return (
        (promptTokens  / 1_000_000) * PRICING.input  +
        (outputTokens  / 1_000_000) * PRICING.output +
        (thoughtTokens / 1_000_000) * PRICING.thought
    );
}

function todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(dateKey) {
    return dateKey.slice(0, 7); // YYYY-MM
}

class TokenUsageService {
    constructor(config) {
        this.config = config;
        this.dataFile = path.join(__dirname, '../data/token_usage.json');
        this.data = { guilds: {} };
    }

    async load() {
        try {
            const raw = await fs.readFile(this.dataFile, 'utf8');
            this.data = JSON.parse(raw);
        } catch {
            this.data = { guilds: {} };
        }
    }

    async save() {
        await fs.writeFile(this.dataFile, JSON.stringify(this.data, null, 2), 'utf8');
    }

    async record(guildId, promptTokens, outputTokens, thoughtTokens = 0) {
        const day = todayKey();
        if (!this.data.guilds[guildId]) this.data.guilds[guildId] = {};
        const g = this.data.guilds[guildId];
        if (!g[day]) g[day] = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, requests: 0 };
        g[day].promptTokens  += promptTokens;
        g[day].outputTokens  += outputTokens;
        g[day].thoughtTokens += thoughtTokens;
        g[day].requests      += 1;
        await this.save();
    }

    _sumDays(guildId, keys) {
        const g = this.data.guilds[guildId] || {};
        let promptTokens = 0, outputTokens = 0, thoughtTokens = 0, requests = 0;
        for (const k of keys) {
            const d = g[k];
            if (!d) continue;
            promptTokens  += d.promptTokens  || 0;
            outputTokens  += d.outputTokens  || 0;
            thoughtTokens += d.thoughtTokens || 0;
            requests      += d.requests      || 0;
        }
        return { promptTokens, outputTokens, thoughtTokens, requests, cost: calcCost(promptTokens, outputTokens, thoughtTokens) };
    }

    getDailyStats(guildId, dateKey = todayKey()) {
        return this._sumDays(guildId, [dateKey]);
    }

    getMonthlyStats(guildId, month = monthKey(todayKey())) {
        const g = this.data.guilds[guildId] || {};
        const keys = Object.keys(g).filter(k => k.startsWith(month));
        return this._sumDays(guildId, keys);
    }

    getAllGuildsStats(dateKey, month) {
        const result = {};
        for (const guildId of Object.keys(this.data.guilds)) {
            result[guildId] = {
                daily:   this.getDailyStats(guildId, dateKey),
                monthly: this.getMonthlyStats(guildId, month),
            };
        }
        return result;
    }
}

module.exports = { TokenUsageService, PRICING, calcCost };
