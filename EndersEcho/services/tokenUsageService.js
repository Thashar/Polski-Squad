const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Cennik Gemini 2.5 Flash Preview ($/1M tokenów)
const PRICING = {
    input:  0.10,
    output: 0.40,
};

function calcCost(promptTokens, outputTokens) {
    return (
        (promptTokens / 1_000_000) * PRICING.input +
        (outputTokens / 1_000_000) * PRICING.output
    );
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function monthKey(dateKey) {
    return dateKey.slice(0, 7);
}

function fmtK(val) {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000)     return `${(val / 1_000).toFixed(0)}K`;
    return val.toString();
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

    async record(guildId, promptTokens, outputTokens) {
        const day = todayKey();
        if (!this.data.guilds[guildId]) this.data.guilds[guildId] = {};
        const g = this.data.guilds[guildId];
        if (!g[day]) g[day] = { promptTokens: 0, outputTokens: 0, requests: 0 };
        g[day].promptTokens += promptTokens;
        g[day].outputTokens += outputTokens;
        g[day].requests     += 1;
        await this.save();
    }

    _sumDays(guildId, keys) {
        const g = this.data.guilds[guildId] || {};
        let promptTokens = 0, outputTokens = 0, requests = 0;
        for (const k of keys) {
            const d = g[k];
            if (!d) continue;
            promptTokens += d.promptTokens || 0;
            outputTokens += d.outputTokens || 0;
            requests     += d.requests     || 0;
        }
        return { promptTokens, outputTokens, requests, cost: calcCost(promptTokens, outputTokens) };
    }

    getMonthlyStats(guildId, month = monthKey(todayKey())) {
        const g = this.data.guilds[guildId] || {};
        const keys = Object.keys(g).filter(k => k.startsWith(month));
        return this._sumDays(guildId, keys);
    }

    getAvailableMonths(guildFilter) {
        const months = new Set();
        months.add(monthKey(todayKey()));

        const guildIds = guildFilter === 'all'
            ? Object.keys(this.data.guilds)
            : [guildFilter];

        for (const guildId of guildIds) {
            for (const key of Object.keys(this.data.guilds[guildId] || {})) {
                months.add(key.slice(0, 7));
            }
        }

        return [...months].sort();
    }

    getMonthDailyTotals(guildFilter, month) {
        const [y, m] = month.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const today = todayKey();

        const guildIds = guildFilter === 'all'
            ? Object.keys(this.data.guilds)
            : [guildFilter];

        const daily = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${month}-${String(d).padStart(2, '0')}`;
            daily[key] = { total: 0, requests: 0, cost: 0, isFuture: key > today };
        }

        for (const guildId of guildIds) {
            const g = this.data.guilds[guildId] || {};
            for (let d = 1; d <= daysInMonth; d++) {
                const key = `${month}-${String(d).padStart(2, '0')}`;
                const v = g[key];
                if (!v) continue;
                const p = v.promptTokens || 0;
                const o = v.outputTokens || 0;
                daily[key].total    += p + o;
                daily[key].requests += v.requests || 0;
                daily[key].cost     += calcCost(p, o);
            }
        }

        return { daily, daysInMonth };
    }

    getMonthTotals(guildFilter, month) {
        const guildIds = guildFilter === 'all'
            ? (this.config?.guilds?.map(g => g.id) || Object.keys(this.data.guilds))
            : [guildFilter];

        let promptTokens = 0, outputTokens = 0, requests = 0;
        for (const guildId of guildIds) {
            const s = this.getMonthlyStats(guildId, month);
            promptTokens += s.promptTokens;
            outputTokens += s.outputTokens;
            requests     += s.requests;
        }
        return { promptTokens, outputTokens, requests, cost: calcCost(promptTokens, outputTokens) };
    }

    generateChartText(guildFilter, month) {
        const { daily, daysInMonth } = this.getMonthDailyTotals(guildFilter, month);
        const today = todayKey();
        const BAR_WIDTH = 16;

        const maxVal = Math.max(...Object.values(daily).map(v => v.total), 1);

        const lines = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${month}-${String(d).padStart(2, '0')}`;
            const v = daily[key];
            const dayStr = String(d).padStart(2, '0');

            if (v.isFuture) {
                lines.push(`${dayStr} ${'░'.repeat(BAR_WIDTH)}   —`);
                continue;
            }

            const filled    = v.total > 0 ? Math.max(Math.round((v.total / maxVal) * BAR_WIDTH), 1) : 0;
            const bar       = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
            const label     = v.total > 0 ? fmtK(v.total).padStart(6) : '    — ';
            const cost      = v.total > 0 ? ` ($${v.cost.toFixed(2)})` : '';
            const todayMark = key === today ? ' ◄' : '';
            lines.push(`${dayStr} ${bar} ${label}${cost}${todayMark}`);
        }

        return '```\n' + lines.join('\n') + '\n```';
    }
}

module.exports = { TokenUsageService, PRICING, calcCost };
