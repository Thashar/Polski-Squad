const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getOwnerId } = require('../utils/helpers');

const logger = createBotLogger('EndersEcho');

/**
 * Subskrypcje wyników graczy.
 *
 * Celem subskrypcji jest PROFIL (targetPlayerKey), nie osoba — gracz z kilkoma kontami
 * ma osobny wpis w rankingu per profil i można obserwować konkretny z nich.
 * `targetUserId` zostaje zachowany (właściciel profilu) — służy do wzmianek i linków.
 *
 * Zgodność wstecz: stare wpisy mają tylko `targetUserId`; są odczytywane tak, jakby
 * `targetPlayerKey === targetUserId` (czyli profil główny), bez migracji pliku.
 */
class NotificationService {
    constructor(config) {
        this.config = config;
        this.dataFile = path.join(config.ranking.dataDir, 'notifications.json');
    }

    async load() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return {};
        }
    }

    async save(data) {
        await fs.mkdir(this.config.ranking.dataDir, { recursive: true });
        await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2), 'utf8');
    }

    /** Klucz profilu subskrypcji — obsługuje stare wpisy bez targetPlayerKey. */
    _keyOf(sub) {
        return sub.targetPlayerKey || sub.targetUserId;
    }

    /**
     * Adds a subscription. Returns false if already exists.
     * @param {string} subscriberUserId
     * @param {string} targetPlayerKey - profil obserwowanego gracza ("userId" lub "userId#N")
     * @param {string} targetGuildId
     * @param {string} targetUsername
     * @param {string} targetGuildName
     */
    async addSubscription(subscriberUserId, targetPlayerKey, targetGuildId, targetUsername, targetGuildName) {
        const data = await this.load();
        if (!data[subscriberUserId]) data[subscriberUserId] = [];
        const exists = data[subscriberUserId].some(
            s => this._keyOf(s) === targetPlayerKey && s.targetGuildId === targetGuildId
        );
        if (exists) return false;
        data[subscriberUserId].push({
            targetUserId: getOwnerId(targetPlayerKey),
            targetPlayerKey,
            targetGuildId,
            targetUsername,
            targetGuildName,
        });
        await this.save(data);
        return true;
    }

    /**
     * Removes a subscription. Returns false if not found.
     */
    async removeSubscription(subscriberUserId, targetPlayerKey, targetGuildId) {
        const data = await this.load();
        if (!data[subscriberUserId]) return false;
        const before = data[subscriberUserId].length;
        data[subscriberUserId] = data[subscriberUserId].filter(
            s => !(this._keyOf(s) === targetPlayerKey && s.targetGuildId === targetGuildId)
        );
        if (data[subscriberUserId].length === before) return false;
        if (data[subscriberUserId].length === 0) delete data[subscriberUserId];
        await this.save(data);
        return true;
    }

    /**
     * Returns all subscriptions for a subscriber (każdy wpis ma targetPlayerKey).
     */
    async getSubscriptions(subscriberUserId) {
        const data = await this.load();
        return (data[subscriberUserId] || []).map(s => ({ ...s, targetPlayerKey: this._keyOf(s) }));
    }

    /**
     * Returns all subscriber userIds watching a specific (targetPlayerKey, targetGuildId) pair.
     */
    async getSubscribersForTarget(targetPlayerKey, targetGuildId) {
        const data = await this.load();
        const result = [];
        for (const [subscriberId, subs] of Object.entries(data)) {
            if (subs.some(s => this._keyOf(s) === targetPlayerKey && s.targetGuildId === targetGuildId)) {
                result.push(subscriberId);
            }
        }
        return result;
    }

    /**
     * Usuwa wszystkie subskrypcje wskazujące na dany profil (np. po usunięciu profilu).
     * @returns {Promise<number>} liczba usuniętych subskrypcji
     */
    async removeAllSubscriptionsForTarget(targetPlayerKey) {
        const data = await this.load();
        let removed = 0;
        for (const [subscriberId, subs] of Object.entries(data)) {
            const filtered = subs.filter(s => this._keyOf(s) !== targetPlayerKey);
            removed += subs.length - filtered.length;
            if (filtered.length === 0) {
                delete data[subscriberId];
            } else {
                data[subscriberId] = filtered;
            }
        }
        if (removed > 0) {
            await this.save(data);
            logger.info(`🔔 Usunięto ${removed} subskrypcji profilu ${targetPlayerKey}`);
        }
        return removed;
    }
}

module.exports = NotificationService;
