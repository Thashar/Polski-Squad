const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
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

function niceMax(val) {
    if (val === 0) return 1000;
    const mag = Math.pow(10, Math.floor(Math.log10(val)));
    const n = val / mag;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * mag;
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

    // Zwraca posortowane dostępne miesiące (zawsze zawiera bieżący)
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

    // Agreguje dane dzienne dla danego miesiąca i filtra serwera
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
                const tokens = (v.promptTokens || 0) + (v.outputTokens || 0) + (v.thoughtTokens || 0);
                daily[key].total    += tokens;
                daily[key].requests += v.requests || 0;
                daily[key].cost     += calcCost(v.promptTokens || 0, v.outputTokens || 0, v.thoughtTokens || 0);
            }
        }

        return { daily, daysInMonth };
    }

    // Agreguje statystyki miesięczne dla danego filtra
    getMonthTotals(guildFilter, month) {
        const guildIds = guildFilter === 'all'
            ? (this.config?.guilds?.map(g => g.id) || Object.keys(this.data.guilds))
            : [guildFilter];

        let promptTokens = 0, outputTokens = 0, thoughtTokens = 0, requests = 0;
        for (const guildId of guildIds) {
            const s = this.getMonthlyStats(guildId, month);
            promptTokens  += s.promptTokens;
            outputTokens  += s.outputTokens;
            thoughtTokens += s.thoughtTokens;
            requests      += s.requests;
        }
        return { promptTokens, outputTokens, thoughtTokens, requests, cost: calcCost(promptTokens, outputTokens, thoughtTokens) };
    }

    async generateChartBuffer(guildFilter, month) {
        const { daily, daysInMonth } = this.getMonthDailyTotals(guildFilter, month);
        const today = todayKey();

        const totals = Object.values(daily).map(v => v.total);
        const maxTokens = Math.max(...totals, 1);
        const yMax = niceMax(maxTokens);

        const W = 800, H = 260;
        const padL = 58, padR = 16, padT = 16, padB = 36;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const barSlotW = chartW / daysInMonth;

        const GRID_LINES = 4;
        let parts = [];

        // Tło
        parts.push(`<rect width="${W}" height="${H}" fill="#23272a"/>`);

        // Linie siatki i etykiety Y
        for (let i = 0; i <= GRID_LINES; i++) {
            const ratio = i / GRID_LINES;
            const y = (padT + chartH - ratio * chartH).toFixed(1);
            const val = Math.round(ratio * yMax);
            parts.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#2f3136" stroke-width="1"/>`);
            parts.push(`<text x="${padL - 6}" y="${parseFloat(y) + 4}" text-anchor="end" fill="#72767d" font-size="11" font-family="sans-serif">${fmtK(val)}</text>`);
        }

        // Słupki
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${month}-${String(d).padStart(2, '0')}`;
            const v = daily[key];
            const x = padL + (d - 1) * barSlotW;
            const cx = x + barSlotW / 2;

            if (v.isFuture) {
                // Przyszłe dni — subtelna kropka
                parts.push(`<circle cx="${cx.toFixed(1)}" cy="${(padT + chartH).toFixed(1)}" r="2" fill="#3a3c40"/>`);
            } else {
                const barH = v.total > 0 ? Math.max((v.total / yMax) * chartH, 3) : 0;
                const barX = (x + barSlotW * 0.1).toFixed(1);
                const barW = (barSlotW * 0.8).toFixed(1);
                const barY = (padT + chartH - barH).toFixed(1);
                const isToday = key === today;
                const color = isToday ? '#34a853' : (v.total > 0 ? '#4285f4' : '#3a3c40');
                parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH.toFixed(1)}" fill="${color}" rx="2"/>`);
            }

            // Etykiety X — co 5 dni
            if (d === 1 || d % 5 === 0 || d === daysInMonth) {
                parts.push(`<text x="${cx.toFixed(1)}" y="${H - padB + 15}" text-anchor="middle" fill="#72767d" font-size="11" font-family="sans-serif">${d}</text>`);
            }
        }

        // Osie
        parts.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#40444b" stroke-width="1.5"/>`);
        parts.push(`<line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="#40444b" stroke-width="1.5"/>`);

        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
        return await sharp(Buffer.from(svg)).png().toBuffer();
    }
}

module.exports = { TokenUsageService, PRICING, calcCost };
