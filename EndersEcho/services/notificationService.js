const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

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

    /**
     * Adds a subscription. Returns false if already exists.
     */
    async addSubscription(subscriberUserId, targetUserId, targetGuildId, targetUsername, targetGuildName) {
        const data = await this.load();
        if (!data[subscriberUserId]) data[subscriberUserId] = [];
        const exists = data[subscriberUserId].some(
            s => s.targetUserId === targetUserId && s.targetGuildId === targetGuildId
        );
        if (exists) return false;
        data[subscriberUserId].push({ targetUserId, targetGuildId, targetUsername, targetGuildName });
        await this.save(data);
        return true;
    }

    /**
     * Removes a subscription. Returns false if not found.
     */
    async removeSubscription(subscriberUserId, targetUserId, targetGuildId) {
        const data = await this.load();
        if (!data[subscriberUserId]) return false;
        const before = data[subscriberUserId].length;
        data[subscriberUserId] = data[subscriberUserId].filter(
            s => !(s.targetUserId === targetUserId && s.targetGuildId === targetGuildId)
        );
        if (data[subscriberUserId].length === before) return false;
        if (data[subscriberUserId].length === 0) delete data[subscriberUserId];
        await this.save(data);
        return true;
    }

    /**
     * Returns all subscriptions for a subscriber.
     */
    async getSubscriptions(subscriberUserId) {
        const data = await this.load();
        return data[subscriberUserId] || [];
    }

    /**
     * Returns all subscriber userIds watching a specific (targetUserId, targetGuildId) pair.
     */
    async getSubscribersForTarget(targetUserId, targetGuildId) {
        const data = await this.load();
        const result = [];
        for (const [subscriberId, subs] of Object.entries(data)) {
            if (subs.some(s => s.targetUserId === targetUserId && s.targetGuildId === targetGuildId)) {
                result.push(subscriberId);
            }
        }
        return result;
    }
}

module.exports = NotificationService;
