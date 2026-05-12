const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

/**
 * Konwertuje stary format topRoles (top1/top2/top3/top4to10/top11to30) lub nowy format (tiers[])
 * na znormalizowany format { tiers: [{from, to, roleId}] }.
 * Zwraca null jeśli brak konfiguracji.
 */
function normalizeTiers(topRoles) {
    if (!topRoles) return null;
    if (topRoles.disabled) return null; // Feature wyłączone, konfiguracja zachowana ale nieaktywna
    if (topRoles.tiers) return topRoles;

    // Stary format → nowy
    const tiers = [];
    if (topRoles.top1)     tiers.push({ from: 1,  to: 1,  roleId: topRoles.top1 });
    if (topRoles.top2)     tiers.push({ from: 2,  to: 2,  roleId: topRoles.top2 });
    if (topRoles.top3)     tiers.push({ from: 3,  to: 3,  roleId: topRoles.top3 });
    if (topRoles.top4to10) tiers.push({ from: 4,  to: 10, roleId: topRoles.top4to10 });
    if (topRoles.top11to30)tiers.push({ from: 11, to: 30, roleId: topRoles.top11to30 });
    return tiers.length > 0 ? { tiers } : null;
}

class RoleService {
    constructor(config, rankingService, logService = null) {
        this.config = config;
        this.rankingService = rankingService;
        this.logService = logService;
        // Per-guild mutex: zapobiega równoległym aktualizacjom ról dla tego samego serwera.
        // Jeśli aktualizacja jest w toku i przyjdzie kolejna, ustawia hasPending=true,
        // dzięki czemu po zakończeniu bieżącej zostanie uruchomiona ponowna z najświeższym rankingiem.
        this._locks = new Map();
    }

    _gl(guildId) {
        return this.logService ? this.logService._gl(guildId) : logger;
    }

    /**
     * Aktualizuje role TOP na podstawie aktualnego rankingu serwera.
     * Jeśli guildTopRoles jest null (brak konfiguracji ról), metoda nie robi nic.
     * Wywołania nakładające się na siebie są kolejkowane (pending), nie gubione.
     * @param {Guild} guild - Serwer Discord
     * @param {Array|null} _sortedPlayers - Nieużywane — metoda zawsze pobiera świeże dane
     * @param {Object|null} guildTopRoles - Konfiguracja ról dla tego serwera (lub null)
     */
    async updateTopRoles(guild, _sortedPlayers, guildTopRoles = null) {
        if (!guildTopRoles || Object.keys(guildTopRoles).length === 0) {
            return true;
        }

        const guildId = guild.id;
        const gl = this._gl(guildId);
        let lock = this._locks.get(guildId);
        if (!lock) {
            lock = { running: false, hasPending: false, pendingGuild: null, pendingTopRoles: null };
            this._locks.set(guildId, lock);
        }

        if (lock.running) {
            lock.hasPending = true;
            lock.pendingGuild = guild;
            lock.pendingTopRoles = guildTopRoles;
            return true;
        }

        lock.running = true;
        lock.hasPending = false;

        let stats = null;
        try {
            const players = await this.rankingService.getSortedPlayers(guildId);
            stats = await this._applyRoleDiff(guild, players, guildTopRoles, gl);
        } catch (error) {
            gl.error(`❌ Błąd podczas aktualizacji ról TOP: ${error.message}`);
            return false;
        } finally {
            lock.running = false;
            if (lock.hasPending) {
                const pendingGuild = lock.pendingGuild;
                const pendingTopRoles = lock.pendingTopRoles;
                lock.hasPending = false;
                lock.pendingGuild = null;
                lock.pendingTopRoles = null;
                setImmediate(() => this.updateTopRoles(pendingGuild, null, pendingTopRoles));
            }
        }

        return stats || { added: [], removed: [] };
    }

    /**
     * Oblicza diff między aktualnym a pożądanym stanem ról i wykonuje tylko niezbędne zmiany.
     * Zamiast resetować wszystkie role i przyznawać od nowa, zmienia tylko to co faktycznie się różni.
     * Operacje usuwania i dodawania wykonywane są równolegle (Promise.allSettled).
     * @returns {{ added: Array<{name, roleName}>, removed: Array<{name, roleName}> }}
     */
    async _applyRoleDiff(guild, sortedPlayers, guildTopRoles, gl = logger) {
        const stats = { added: [], removed: [] };
        const normalized = normalizeTiers(guildTopRoles);
        if (!normalized) return stats;

        const tierRoles = normalized.tiers
            .filter(t => t.roleId)
            .map(t => ({ ...t, role: guild.roles.cache.get(t.roleId) }))
            .filter(t => t.role);

        const allTopRoles = tierRoles.map(t => t.role);
        if (allTopRoles.length === 0) {
            gl.warn(`⚠️ Żadna skonfigurowana rola TOP nie istnieje na serwerze "${guild.name}"`);
            return stats;
        }

        // Pożądany stan: userId -> role (null = brak roli TOP)
        const desired = new Map();
        for (let i = 0; i < sortedPlayers.length; i++) {
            const pos = i + 1;
            const tier = tierRoles.find(t => pos >= t.from && pos <= t.to);
            desired.set(sortedPlayers[i].userId, tier ? tier.role : null);
        }

        // Aktualny stan z cache Discorda: userId -> Set<role> (member może mieć wiele ról TOP jednocześnie)
        const current = new Map(); // userId -> Set<role>
        for (const role of allTopRoles) {
            for (const [memberId] of role.members) {
                if (!current.has(memberId)) current.set(memberId, new Set());
                current.get(memberId).add(role);
            }
        }

        // Diff: co usunąć, co dodać
        const toRemove = []; // { member, role }
        const toAdd = [];    // { userId, role }

        for (const [memberId, currentRoles] of current) {
            const desiredRole = desired.get(memberId) ?? null;
            for (const role of currentRoles) {
                if (role !== desiredRole) {
                    toRemove.push({ member: role.members.get(memberId), role });
                }
            }
        }

        for (const [userId, desiredRole] of desired) {
            if (!desiredRole) continue;
            const currentRoles = current.get(userId);
            if (!currentRoles || !currentRoles.has(desiredRole)) {
                toAdd.push({ userId, role: desiredRole });
            }
        }

        if (toRemove.length === 0 && toAdd.length === 0) {
            return stats;
        }

        // Usunięcia w chunkach po 10 z przerwą 250ms — zapobiega global rate limit Discord
        if (toRemove.length > 0) {
            const CHUNK = 10;
            for (let i = 0; i < toRemove.length; i += CHUNK) {
                const chunk = toRemove.slice(i, i + CHUNK);
                await Promise.allSettled(
                    chunk.map(({ member, role }) =>
                        member.roles.remove(role).catch(err =>
                            gl.error(`Błąd usuwania roli "${role.name}" od "${member.displayName}": ${err.message}`)
                        )
                    )
                );
                if (i + CHUNK < toRemove.length) {
                    await new Promise(r => setTimeout(r, 250));
                }
            }
            for (const { member, role } of toRemove) {
                if (member) stats.removed.push({ name: member.displayName, roleName: role.name });
            }
        }

        // Dodania — batch fetch + równolegle
        const removedFromRanking = [];
        if (toAdd.length > 0) {
            const ids = toAdd.map(({ userId }) => userId);
            let members = new Map();
            try {
                members = await guild.members.fetch({ user: ids });
            } catch (err) {
                gl.error(`Błąd batch fetch members: ${err.message}`);
            }

            // Dodania w chunkach po 10 z przerwą 250ms — zapobiega global rate limit Discord
            const CHUNK = 10;
            const addErrors = new Map(); // roleName -> { missing: string[], other: {name, msg}[] }
            for (let i = 0; i < toAdd.length; i += CHUNK) {
                const chunk = toAdd.slice(i, i + CHUNK);
                await Promise.allSettled(
                    chunk.map(async ({ userId, role }) => {
                        const member = members.get(userId);
                        if (!member) {
                            gl.warn(`⚠️ Użytkownik ${userId} nie jest na serwerze — usuwam z rankingu`);
                            if (this.rankingService) {
                                await this.rankingService.removePlayerFromRanking(userId, guild.id).catch(e =>
                                    gl.error(`Błąd usuwania z rankingu: ${e.message}`)
                                );
                                removedFromRanking.push(userId);
                            }
                            return;
                        }
                        const addErr = await member.roles.add(role).then(() => null).catch(err => err);
                        if (addErr) {
                            if (!addErrors.has(role.name)) addErrors.set(role.name, { missing: [], other: [] });
                            const bucket = addErrors.get(role.name);
                            if (addErr.message.includes('Missing Permissions')) {
                                bucket.missing.push(member.displayName);
                            } else {
                                bucket.other.push({ name: member.displayName, msg: addErr.message });
                            }
                        } else {
                            stats.added.push({ name: member.displayName, roleName: role.name });
                        }
                    })
                );
                if (i + CHUNK < toAdd.length) {
                    await new Promise(r => setTimeout(r, 250));
                }
            }
            for (const [roleName, { missing, other }] of addErrors) {
                if (missing.length > 0)
                    gl.warn(`⚠️ Brak uprawnień do przyznania roli "${roleName}": ${missing.join(', ')}`);
                if (other.length > 0)
                    gl.error(`❌ Błąd przyznawania roli "${roleName}": ${other.map(e => `"${e.name}" (${e.msg})`).join(', ')}`);
            }
        }

        // Jeśli usunięto kogoś z rankingu, zaplanuj ponowny diff z odświeżonymi danymi
        if (removedFromRanking.length > 0) {
            const lock = this._locks.get(guild.id);
            if (lock && !lock.hasPending) {
                lock.hasPending = true;
                lock.pendingGuild = guild;
                lock.pendingTopRoles = guildTopRoles;
            }
        }

        return stats;
    }

    /**
     * Pobiera informacje o aktualnych posiadaczach ról TOP (per tier).
     * @param {Guild} guild
     * @param {Object|null} guildTopRoles
     * @returns {Array<{from, to, role, members}>}
     */
    async getTopRoleHolders(guild, guildTopRoles = null) {
        const normalized = normalizeTiers(guildTopRoles);
        if (!normalized) return [];
        try {
            return normalized.tiers
                .filter(t => t.roleId)
                .map(t => {
                    const role = guild.roles.cache.get(t.roleId);
                    return {
                        from: t.from,
                        to: t.to,
                        role,
                        members: role ? Array.from(role.members.values()) : []
                    };
                });
        } catch (error) {
            logger.error('Błąd pobierania posiadaczy ról TOP:', error);
            return [];
        }
    }

    /**
     * Sprawdza czy użytkownik ma jakąkolwiek rolę TOP (na danym serwerze)
     * @param {GuildMember} member
     * @param {Object|null} guildTopRoles
     */
    getUserTopRole(member, guildTopRoles = null) {
        const normalized = normalizeTiers(guildTopRoles);
        if (!normalized) return null;
        const roleIds = normalized.tiers.map(t => t.roleId).filter(Boolean);

        for (const roleId of roleIds) {
            if (member.roles.cache.has(roleId)) {
                const role = member.guild.roles.cache.get(roleId);
                return role ? role.name : null;
            }
        }

        return null;
    }

    /**
     * Loguje zmiany w rolach TOP
     */
    logRoleChanges(oldHolders, newHolders) {
        const positions = ['TOP1', 'TOP2', 'TOP3'];

        for (let i = 0; i < 3; i++) {
            const oldHolder = oldHolders[i] ? oldHolders[i].user.tag : 'Brak';
            const newHolder = newHolders[i] ? newHolders[i].username : 'Brak';

            if (oldHolder !== newHolder) {
                logger.info(`${positions[i]}: ${oldHolder} → ${newHolder}`);
            }
        }
    }
}

module.exports = RoleService;
module.exports.normalizeTiers = normalizeTiers;
