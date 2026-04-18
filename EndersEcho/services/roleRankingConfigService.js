const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

const MAX_ROLES = 10;
const CACHE_TTL = 3 * 60 * 1000; // 3 minuty

class RoleRankingConfigService {
    constructor(config) {
        this.dataDir = config.ranking.dataDir;
        // Cache: `${guildId}_${roleId}` → { members: Set<userId>, fetchedAt: number }
        this._memberCache = new Map();
    }

    _filePath(guildId) {
        return path.join(this.dataDir, `role_rankings_${guildId}.json`);
    }

    async loadRoleRankings(guildId) {
        try {
            const raw = await fs.readFile(this._filePath(guildId), 'utf8');
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    async saveRoleRankings(guildId, list) {
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this._filePath(guildId), JSON.stringify(list, null, 2), 'utf8');
    }

    async addRoleRanking(guildId, roleId, roleName) {
        const list = await this.loadRoleRankings(guildId);
        if (list.length >= MAX_ROLES) return { ok: false, reason: 'limit' };
        if (list.some(r => r.roleId === roleId)) return { ok: false, reason: 'duplicate' };
        list.push({ roleId, roleName, addedAt: new Date().toISOString() });
        await this.saveRoleRankings(guildId, list);
        return { ok: true };
    }

    async removeRoleRanking(guildId, roleId) {
        const list = await this.loadRoleRankings(guildId);
        const filtered = list.filter(r => r.roleId !== roleId);
        if (filtered.length === list.length) return false;
        await this.saveRoleRankings(guildId, filtered);
        this._memberCache.delete(`${guildId}_${roleId}`);
        return true;
    }

    // --- cache memberów ---

    _cacheKey(guildId, roleId) {
        return `${guildId}_${roleId}`;
    }

    _getCached(guildId, roleId) {
        const entry = this._memberCache.get(this._cacheKey(guildId, roleId));
        if (!entry) return null;
        if (Date.now() - entry.fetchedAt > CACHE_TTL) {
            this._memberCache.delete(this._cacheKey(guildId, roleId));
            return null;
        }
        return entry.members;
    }

    _setCache(guildId, roleId, members) {
        this._memberCache.set(this._cacheKey(guildId, roleId), {
            members,
            fetchedAt: Date.now()
        });
    }

    /**
     * Zwraca Set userId graczy z rankingu którzy aktualnie mają daną rolę.
     * Batch-fetchuje tylko tych graczy, nie cały serwer.
     * @param {Guild} guild
     * @param {string} roleId
     * @param {string[]} playerUserIds - userId z rankingu (do batch-fetch)
     * @returns {Promise<Set<string>>}
     */
    async getMembersWithRole(guild, roleId, playerUserIds) {
        const cached = this._getCached(guild.id, roleId);
        if (cached) {
            logger.info(`[RoleRanking] Cache hit: rola ${roleId} na serwerze ${guild.id}`);
            return cached;
        }

        logger.info(`[RoleRanking] Fetchuję ${playerUserIds.length} graczy dla roli ${roleId} na serwerze ${guild.id}...`);

        const withRole = new Set();
        // Discord pozwala batch do 100 ID w jednym żądaniu
        const BATCH = 100;
        for (let i = 0; i < playerUserIds.length; i += BATCH) {
            const chunk = playerUserIds.slice(i, i + BATCH);
            try {
                const membersMap = await guild.members.fetch({ user: chunk });
                for (const [userId, member] of membersMap) {
                    if (member.roles.cache.has(roleId)) withRole.add(userId);
                }
            } catch (err) {
                logger.warn(`[RoleRanking] Błąd batch-fetch (chunk ${i / BATCH + 1}): ${err.message}`);
            }
        }

        this._setCache(guild.id, roleId, withRole);
        logger.info(`[RoleRanking] Znaleziono ${withRole.size} graczy z rolą ${roleId}`);
        return withRole;
    }
}

module.exports = RoleRankingConfigService;
