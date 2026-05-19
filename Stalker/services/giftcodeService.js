const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { delay } = require('../utils/helpers');

const HABBY_API_BASE = 'https://prod-mail.habbyservice.com/Survivor/api/v1';
const DELAY_BETWEEN_UIDS_MS = 500;

const PERMANENT_ERROR_CODES = new Set([
    20402, // Kod już wykorzystany / limit osiągnięty
    20403, // Kod wygasł
    20404, // Nieprawidłowy kod
    20405, // Gracz nie kwalifikuje się
    20406, // Gracz nie znaleziony
    20407, // Giftcode self claimed (już odebrano)
]);

const CLAIMED_ERROR_CODES = new Set([20402, 20407]);

class GiftcodeService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.uidsFile = path.join(__dirname, '../data/habby_uids.json');
        this.claimedFile = path.join(__dirname, '../data/giftcode_claimed.json');
    }

    // ===== STORAGE =====

    async loadData() {
        try {
            return JSON.parse(await fs.readFile(this.uidsFile, 'utf8'));
        } catch {
            return { uids: {} };
        }
    }

    async saveData(data) {
        await fs.mkdir(path.dirname(this.uidsFile), { recursive: true });
        await fs.writeFile(this.uidsFile, JSON.stringify(data, null, 2));
    }

    async addUid(discordId, uid, displayName) {
        const data = await this.loadData();
        const existed = !!data.uids[discordId];
        data.uids[discordId] = { uid: uid.trim(), nick: displayName, addedAt: new Date().toISOString() };
        await this.saveData(data);
        return existed;
    }

    async removeUid(discordId) {
        const data = await this.loadData();
        if (!data.uids[discordId]) return null;
        const removed = data.uids[discordId];
        delete data.uids[discordId];
        await this.saveData(data);
        return removed;
    }

    async listUids() {
        const data = await this.loadData();
        return data.uids;
    }

    async getUserUid(discordId) {
        const data = await this.loadData();
        return data.uids[discordId] || null;
    }

    // ===== CLAIMED (per kod) =====

    async _loadClaimed() {
        try {
            return JSON.parse(await fs.readFile(this.claimedFile, 'utf8'));
        } catch {
            return {};
        }
    }

    async _saveClaimed(data) {
        await fs.mkdir(path.dirname(this.claimedFile), { recursive: true });
        await fs.writeFile(this.claimedFile, JSON.stringify(data, null, 2));
    }

    _normalizeEntry(entry) {
        if (!entry) return { firstUsed: null, claimed: [] };
        if (Array.isArray(entry)) return { firstUsed: null, claimed: entry };
        return { firstUsed: entry.firstUsed ?? null, claimed: entry.claimed ?? [] };
    }

    async getClaimedForCode(code) {
        const data = await this._loadClaimed();
        return new Set(this._normalizeEntry(data[code]).claimed);
    }

    async recordSuccess(uid, code) {
        const data = await this._loadClaimed();
        const entry = this._normalizeEntry(data[code]);
        if (!entry.claimed.includes(uid)) {
            entry.claimed.push(uid);
            data[code] = entry;
            await this._saveClaimed(data);
        }
    }

    async setCodeFirstUsed(code) {
        const data = await this._loadClaimed();
        const entry = this._normalizeEntry(data[code]);
        if (!entry.firstUsed) {
            entry.firstUsed = new Date().toISOString();
            data[code] = entry;
            await this._saveClaimed(data);
        }
    }

    async getRecentCodes(days = 30) {
        const data = await this._loadClaimed();
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return Object.entries(data)
            .filter(([, entry]) => {
                const { firstUsed } = this._normalizeEntry(entry);
                return firstUsed && new Date(firstUsed) >= cutoff;
            })
            .map(([code]) => code);
    }

    // ===== HABBY API =====

    async _redeemForUid(uid, giftCode, nick, shouldAbort) {
        if (shouldAbort?.()) {
            return { success: false, aborted: true, message: 'Przerwano przez użytkownika' };
        }

        try {
            const res = await axios.post(
                `${HABBY_API_BASE}/giftcode/redeem`,
                { userId: uid, giftCode },
                { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
            );
            const apiMsg = res.data?.message ?? res.data?.msg ?? null;

            if (res.data?.code === 0) {
                return { success: true, message: 'Kod aktywowany pomyślnie' };
            } else if (PERMANENT_ERROR_CODES.has(res.data?.code)) {
                return {
                    success: false,
                    claimed: CLAIMED_ERROR_CODES.has(res.data.code),
                    message: apiMsg ?? `Błąd API (kod: ${res.data.code})`
                };
            } else {
                this.logger.warn(`[GIFTCODE] ${nick}: API ${res.data?.code} ${apiMsg ?? ''}`);
                return { success: false, retryable: true, message: apiMsg ?? `Błąd API (kod: ${res.data?.code})` };
            }
        } catch (error) {
            this.logger.error(`[GIFTCODE] ${nick}: ${error.message.split('\n')[0]}`);
            return { success: false, retryable: true, message: `Błąd: ${error.message.split('\n')[0]}` };
        }
    }

    // ===== REDEMPTION =====

    async redeemAll(giftcode, progressCallback) {
        const data = await this.loadData();
        return this.redeemEntries(Object.entries(data.uids), giftcode, progressCallback);
    }

    async redeemEntries(entries, giftcode, progressCallback, shouldAbort) {
        if (entries.length === 0) return [];
        await this.setCodeFirstUsed(giftcode);
        const claimedSet = await this.getClaimedForCode(giftcode);
        const results = [];

        for (let i = 0; i < entries.length; i++) {
            if (shouldAbort?.()) break;

            const [discordId, userData] = entries[i];

            if (claimedSet.has(userData.uid)) {
                const skipped = { discordId, uid: userData.uid, nick: userData.nick, success: false, skippedClaimed: true, message: 'Już aktywowano w poprzedniej sesji' };
                results.push(skipped);
                if (progressCallback) {
                    try { await progressCallback(i + 1, entries.length, skipped); } catch { /* nie blokuj */ }
                }
                continue;
            }

            const result = await this._redeemForUid(userData.uid, giftcode, userData.nick, shouldAbort);

            if (result.success || result.claimed) {
                claimedSet.add(userData.uid);
                this.recordSuccess(userData.uid, giftcode).catch(() => {});
            }

            const icon = result.success ? '✅' : result.claimed ? '🎫' : result.aborted ? '⏹️' : '❌';
            this.logger.info(`[GIFTCODE] [${i + 1}/${entries.length}] ${userData.nick} ${icon}${result.success ? '' : `: ${result.message}`}`);

            results.push({ discordId, uid: userData.uid, nick: userData.nick, ...result });

            if (progressCallback) {
                try { await progressCallback(i + 1, entries.length, results[results.length - 1]); } catch { /* nie blokuj */ }
            }

            if (!result.aborted && i < entries.length - 1) await delay(DELAY_BETWEEN_UIDS_MS);
        }

        return results;
    }

    async redeemForNewUser(discordId, userData) {
        const recentCodes = await this.getRecentCodes(30);
        if (recentCodes.length === 0) return [];

        const results = [];
        for (let i = 0; i < recentCodes.length; i++) {
            const code = recentCodes[i];
            const claimedSet = await this.getClaimedForCode(code);
            if (claimedSet.has(userData.uid)) {
                results.push({ code, skipped: true, message: 'Już aktywowano' });
                continue;
            }

            const result = await this._redeemForUid(userData.uid, code, userData.nick);

            if (result.success || result.claimed) {
                this.recordSuccess(userData.uid, code).catch(() => {});
            }

            const icon = result.success ? '✅' : result.claimed ? '🎫' : '❌';
            this.logger.info(`[GIFTCODE] ${userData.nick} ${icon} ${code}${result.success ? '' : `: ${result.message}`}`);

            results.push({ code, ...result });
            if (i < recentCodes.length - 1) await delay(DELAY_BETWEEN_UIDS_MS);
        }

        return results;
    }
}

module.exports = GiftcodeService;
