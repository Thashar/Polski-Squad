const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class RoleService {
    constructor(config, rankingService) {
        this.config = config;
        this.rankingService = rankingService;
        // Per-guild mutex: zapobiega równoległym aktualizacjom ról dla tego samego serwera.
        // Jeśli aktualizacja jest w toku i przyjdzie kolejna, ustawia hasPending=true,
        // dzięki czemu po zakończeniu bieżącej zostanie uruchomiona ponowna z najświeższym rankingiem.
        this._locks = new Map();
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
            logger.info(`ℹ️ Serwer ${guild.name} nie ma skonfigurowanych ról TOP — pomijam aktualizację`);
            return true;
        }

        const guildId = guild.id;
        let lock = this._locks.get(guildId);
        if (!lock) {
            lock = { running: false, hasPending: false, pendingGuild: null, pendingTopRoles: null };
            this._locks.set(guildId, lock);
        }

        if (lock.running) {
            lock.hasPending = true;
            lock.pendingGuild = guild;
            lock.pendingTopRoles = guildTopRoles;
            logger.info(`⏳ Aktualizacja ról TOP dla ${guild.name} już w toku — zaplanowano ponowną po zakończeniu`);
            return true;
        }

        lock.running = true;
        lock.hasPending = false;

        try {
            const players = await this.rankingService.getSortedPlayers(guildId);
            await this._applyRoleDiff(guild, players, guildTopRoles);
        } catch (error) {
            logger.error('❌ Błąd podczas aktualizacji ról TOP:', error);
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

        return true;
    }

    /**
     * Oblicza diff między aktualnym a pożądanym stanem ról i wykonuje tylko niezbędne zmiany.
     * Zamiast resetować wszystkie role i przyznawać od nowa, zmienia tylko to co faktycznie się różni.
     * Operacje usuwania i dodawania wykonywane są równolegle (Promise.allSettled).
     */
    async _applyRoleDiff(guild, sortedPlayers, guildTopRoles) {
        const roleMap = {
            top1:     guildTopRoles.top1     ? guild.roles.cache.get(guildTopRoles.top1)     : null,
            top2:     guildTopRoles.top2     ? guild.roles.cache.get(guildTopRoles.top2)     : null,
            top3:     guildTopRoles.top3     ? guild.roles.cache.get(guildTopRoles.top3)     : null,
            top4to10: guildTopRoles.top4to10 ? guild.roles.cache.get(guildTopRoles.top4to10) : null,
            top11to30:guildTopRoles.top11to30? guild.roles.cache.get(guildTopRoles.top11to30): null,
        };

        const allTopRoles = Object.values(roleMap).filter(Boolean);
        if (allTopRoles.length === 0) {
            logger.warn(`⚠️ Żadna skonfigurowana rola TOP nie istnieje na serwerze ${guild.name}`);
            return;
        }

        // Pożądany stan: userId -> role (null = brak roli TOP)
        const desired = new Map();
        for (let i = 0; i < sortedPlayers.length; i++) {
            const pos = i + 1;
            let role = null;
            if (pos === 1)                    role = roleMap.top1;
            else if (pos === 2)               role = roleMap.top2;
            else if (pos === 3)               role = roleMap.top3;
            else if (pos >= 4 && pos <= 10)   role = roleMap.top4to10;
            else if (pos >= 11 && pos <= 30)  role = roleMap.top11to30;
            desired.set(sortedPlayers[i].userId, role);
        }

        // Aktualny stan z cache Discorda: userId -> role
        const current = new Map();
        for (const role of allTopRoles) {
            for (const [memberId] of role.members) {
                current.set(memberId, role);
            }
        }

        // Diff: co usunąć, co dodać
        const toRemove = []; // { member, role }
        const toAdd = [];    // { userId, role }

        for (const [memberId, currentRole] of current) {
            const desiredRole = desired.get(memberId) ?? null;
            if (desiredRole !== currentRole) {
                toRemove.push({ member: currentRole.members.get(memberId), role: currentRole });
            }
        }

        for (const [userId, desiredRole] of desired) {
            if (!desiredRole) continue;
            if (current.get(userId) !== desiredRole) {
                toAdd.push({ userId, role: desiredRole });
            }
        }

        if (toRemove.length === 0 && toAdd.length === 0) {
            logger.info('✅ Role TOP bez zmian');
            return;
        }

        // Usunięcia równolegle
        if (toRemove.length > 0) {
            await Promise.allSettled(
                toRemove.map(({ member, role }) =>
                    member.roles.remove(role).catch(err =>
                        logger.error(`Błąd usuwania roli ${role.name} od ${member.user.tag}:`, err.message)
                    )
                )
            );
        }

        // Dodania — batch fetch + równolegle
        const removedFromRanking = [];
        if (toAdd.length > 0) {
            const ids = toAdd.map(({ userId }) => userId);
            let members = new Map();
            try {
                members = await guild.members.fetch({ user: ids });
            } catch (err) {
                logger.error('Błąd batch fetch members:', err.message);
            }

            await Promise.allSettled(
                toAdd.map(async ({ userId, role }) => {
                    const member = members.get(userId);
                    if (!member) {
                        logger.warn(`⚠️ ${userId} nie jest na serwerze — usuwam z rankingu`);
                        if (this.rankingService) {
                            await this.rankingService.removePlayerFromRanking(userId, guild.id).catch(e =>
                                logger.error(`Błąd usuwania z rankingu:`, e.message)
                            );
                            removedFromRanking.push(userId);
                        }
                        return;
                    }
                    await member.roles.add(role).catch(err =>
                        logger.error(`Błąd przyznawania roli ${role.name} użytkownikowi ${member.user.tag}:`, err.message)
                    );
                })
            );
        }

        logger.info(`✅ Role TOP zaktualizowane — usunięto: ${toRemove.length}, dodano: ${toAdd.length}`);

        // Jeśli usunięto kogoś z rankingu, zaplanuj ponowny diff z odświeżonymi danymi
        if (removedFromRanking.length > 0) {
            const lock = this._locks.get(guild.id);
            if (lock && !lock.hasPending) {
                lock.hasPending = true;
                lock.pendingGuild = guild;
                lock.pendingTopRoles = guildTopRoles;
            }
        }
    }

    /**
     * Pobiera informacje o aktualnych posiadaczach ról TOP
     * @param {Guild} guild
     * @param {Object|null} guildTopRoles
     */
    async getTopRoleHolders(guild, guildTopRoles = null) {
        const topRoles = guildTopRoles || {};
        try {
            const get = (key) => topRoles[key] ? guild.roles.cache.get(topRoles[key]) : null;
            const toArr = (role) => role ? Array.from(role.members.values()) : [];

            return {
                top1:      toArr(get('top1')),
                top2:      toArr(get('top2')),
                top3:      toArr(get('top3')),
                top4to10:  toArr(get('top4to10')),
                top11to30: toArr(get('top11to30'))
            };
        } catch (error) {
            logger.error('Błąd pobierania posiadaczy ról TOP:', error);
            return { top1: [], top2: [], top3: [], top4to10: [], top11to30: [] };
        }
    }

    /**
     * Sprawdza czy użytkownik ma jakąkolwiek rolę TOP (na danym serwerze)
     * @param {GuildMember} member
     * @param {Object|null} guildTopRoles
     */
    getUserTopRole(member, guildTopRoles = null) {
        const topRoles = guildTopRoles || {};
        const roleIds = Object.values(topRoles).filter(Boolean);

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
