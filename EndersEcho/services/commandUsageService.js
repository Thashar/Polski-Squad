'use strict';
const fs   = require('fs').promises;
const path = require('path');
const store = require('../../utils/jsonStore');

class CommandUsageService {
    constructor(dataDir) {
        this.dataFile = path.join(dataDir, 'command_usage.json');
        this._queue   = Promise.resolve();
    }

    async _load() {
        try {
            return await store.getOrLoad(this.dataFile, () => ({}));
        } catch {
            return {};
        }
    }

    async _save(data) {
        await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
        await store.set(this.dataFile, data);
    }

    /**
     * Rejestruje użycie komendy (fire-and-forget, szeregowe zapisy przez queue).
     * @param {string} guildId
     * @param {string} commandName
     */
    record(guildId, commandName) {
        this._queue = this._queue.then(async () => {
            try {
                const data = await this._load();
                if (!data[guildId]) data[guildId] = {};
                data[guildId][commandName] = (data[guildId][commandName] || 0) + 1;
                await this._save(data);
            } catch {}
        });
    }

    /**
     * Zwraca statystyki dla jednego serwera (posortowane malejąco po liczbie).
     * @param {string} guildId
     * @returns {Promise<Array<{name: string, count: number}>>}
     */
    async getGuildStats(guildId) {
        const data = await this._load();
        const guild = data[guildId] || {};
        return Object.entries(guild)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Zwraca globalne sumy (wszystkie serwery) posortowane malejąco.
     * @returns {Promise<Array<{name: string, count: number}>>}
     */
    async getGlobalStats() {
        const data = await this._load();
        const totals = {};
        for (const guildStats of Object.values(data)) {
            for (const [cmd, count] of Object.entries(guildStats)) {
                totals[cmd] = (totals[cmd] || 0) + count;
            }
        }
        return Object.entries(totals)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Zwraca globalne sumy + podział per serwer.
     * @returns {Promise<{totals: Array, byGuild: Object}>}
     */
    async getAllStats() {
        const data   = await this._load();
        const totals = await this.getGlobalStats();
        return { totals, byGuild: data };
    }
}

module.exports = CommandUsageService;
