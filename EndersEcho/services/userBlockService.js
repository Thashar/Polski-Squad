const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class UserBlockService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'user_blocks.json');
        this._blocks = {};
        this._loadSync();
    }

    _loadSync() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            this._blocks = JSON.parse(data);
            const count = Object.keys(this._blocks).length;
            if (count > 0) {
                logger.info(`🔒 Załadowano ${count} zablokowanych użytkowników OCR`);
            }
        } catch {
            this._blocks = {};
        }
    }

    async _save() {
        await fsAsync.writeFile(this.filePath, JSON.stringify(this._blocks, null, 2), 'utf8');
    }

    // Parsuje string czasu: "30m", "2h", "7d", "2w". Puste = permanentny.
    parseDuration(durationStr) {
        if (!durationStr || !durationStr.trim()) return null;
        const match = durationStr.trim().toLowerCase().match(/^(\d+)\s*(m|h|d|w)$/);
        if (!match) return null;
        const value = parseInt(match[1]);
        const multipliers = { m: 60 * 1000, h: 3600 * 1000, d: 86400 * 1000, w: 604800 * 1000 };
        return Date.now() + value * multipliers[match[2]];
    }

    isBlocked(userId) {
        const entry = this._blocks[userId];
        if (!entry) return false;
        if (entry.blockedUntil !== null && Date.now() > entry.blockedUntil) {
            delete this._blocks[userId];
            this._save().catch(() => {});
            return false;
        }
        return true;
    }

    async blockUser(userId, username, guildId, guildName, durationStr, blockedByHeadAdmin = false) {
        const blockedUntil = this.parseDuration(durationStr);
        this._blocks[userId] = {
            userId,
            username,
            guildId,
            guildName,
            blockedAt: new Date().toISOString(),
            blockedUntil,
            blockedByHeadAdmin: !!blockedByHeadAdmin,
        };
        await this._save();
        return blockedUntil;
    }

    // Zwraca false jeśli blokada pochodzi od Head Admina i caller nie jest Head Adminem
    async unblockUser(userId, callerIsHeadAdmin = false) {
        if (!this._blocks[userId]) return false;
        if (this._blocks[userId].blockedByHeadAdmin && !callerIsHeadAdmin) {
            return 'head_admin_only';
        }
        delete this._blocks[userId];
        await this._save();
        return true;
    }

    isBlockedByHeadAdmin(userId) {
        return !!this._blocks[userId]?.blockedByHeadAdmin;
    }

    getBlockedUsers() {
        const now = Date.now();
        for (const [userId, entry] of Object.entries(this._blocks)) {
            if (entry.blockedUntil !== null && now > entry.blockedUntil) {
                delete this._blocks[userId];
            }
        }
        return Object.values(this._blocks).sort((a, b) => {
            if (a.blockedUntil === null && b.blockedUntil === null) return 0;
            if (a.blockedUntil === null) return 1;
            if (b.blockedUntil === null) return -1;
            return a.blockedUntil - b.blockedUntil;
        });
    }

    formatTimeRemaining(blockedUntil) {
        if (blockedUntil === null) return '∞ Permanentnie';
        const remaining = blockedUntil - Date.now();
        if (remaining <= 0) return 'Wygasła';
        const days = Math.floor(remaining / 86400000);
        const hours = Math.floor((remaining % 86400000) / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
}

module.exports = UserBlockService;
