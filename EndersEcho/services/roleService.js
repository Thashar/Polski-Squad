const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class RoleService {
    constructor(config, rankingService) {
        this.config = config;
        this.rankingService = rankingService;
    }

    /**
     * Aktualizuje role TOP na podstawie aktualnego rankingu serwera.
     * Jeśli guildTopRoles jest null (brak konfiguracji ról), metoda nie robi nic.
     * @param {Guild} guild - Serwer Discord
     * @param {Array} sortedPlayers - Posortowani gracze
     * @param {Object|null} guildTopRoles - Konfiguracja ról dla tego serwera (lub null)
     */
    async updateTopRoles(guild, sortedPlayers, guildTopRoles = null) {
        // Jeśli serwer nie ma skonfigurowanych ról TOP — pomijamy
        if (!guildTopRoles || Object.keys(guildTopRoles).length === 0) {
            logger.info(`ℹ️ Serwer ${guild.name} nie ma skonfigurowanych ról TOP — pomijam aktualizację`);
            return true;
        }

        try {
            const top1Role = guildTopRoles.top1 ? guild.roles.cache.get(guildTopRoles.top1) : null;
            const top2Role = guildTopRoles.top2 ? guild.roles.cache.get(guildTopRoles.top2) : null;
            const top3Role = guildTopRoles.top3 ? guild.roles.cache.get(guildTopRoles.top3) : null;
            const top4to10Role = guildTopRoles.top4to10 ? guild.roles.cache.get(guildTopRoles.top4to10) : null;
            const top11to30Role = guildTopRoles.top11to30 ? guild.roles.cache.get(guildTopRoles.top11to30) : null;

            // Zbierz tylko role, które faktycznie istnieją na serwerze
            const allTopRoles = [top1Role, top2Role, top3Role, top4to10Role, top11to30Role].filter(Boolean);

            if (allTopRoles.length === 0) {
                logger.warn(`⚠️ Żadna skonfigurowana rola TOP nie istnieje na serwerze ${guild.name}`);
                return false;
            }

            const playerIds = new Set(sortedPlayers.map(player => player.userId));
            let playersRemovedFromRanking = false;

            // Usuń role TOP od graczy którzy zniknęli z rankingu
            for (const role of allTopRoles) {
                const membersWithRole = role.members;
                for (const [memberId, member] of membersWithRole) {
                    if (!playerIds.has(memberId)) {
                        try {
                            await member.roles.remove(role);
                            logger.info(`🗑️ Usunięto rolę ${role.name} od ${member.user.tag} (zniknął z rankingu)`);
                        } catch (error) {
                            logger.error(`Błąd usuwania roli ${role.name} od ${member.user.tag}:`, error.message);
                        }
                    }
                }
            }

            // Reset ról graczy w rankingu
            for (const role of allTopRoles) {
                const membersWithRole = role.members;
                for (const [memberId, member] of membersWithRole) {
                    if (playerIds.has(memberId)) {
                        try {
                            await member.roles.remove(role);
                        } catch (error) {
                            logger.error(`Błąd resetowania roli ${role.name} od ${member.user.tag}:`, error.message);
                        }
                    }
                }
            }

            // Przyznaj nowe role na podstawie pozycji
            for (let i = 0; i < sortedPlayers.length; i++) {
                const player = sortedPlayers[i];
                const position = i + 1;
                let targetRole = null;

                if (position === 1) targetRole = top1Role;
                else if (position === 2) targetRole = top2Role;
                else if (position === 3) targetRole = top3Role;
                else if (position >= 4 && position <= 10) targetRole = top4to10Role;
                else if (position >= 11 && position <= 30) targetRole = top11to30Role;

                if (targetRole) {
                    try {
                        const member = await guild.members.fetch(player.userId);
                        if (member) {
                            await member.roles.add(targetRole);
                        }
                    } catch (error) {
                        logger.error(`Błąd przyznawania roli ${targetRole.name} użytkownikowi ${player.userName || `ID:${player.userId}`}:`, error.message);

                        if (error.code === 10007 || error.message.includes('Unknown Member') || error.message.includes('Unknown User')) {
                            logger.warn(`⚠️ Użytkownik ${player.userName || `ID:${player.userId}`} nie jest na serwerze — usuwam z rankingu`);

                            if (this.rankingService) {
                                try {
                                    await this.rankingService.removePlayerFromRanking(player.userId, guild.id);
                                    logger.success(`✅ Usunięto użytkownika ${player.userName || `ID:${player.userId}`} z rankingu`);
                                    playersRemovedFromRanking = true;
                                } catch (removeError) {
                                    logger.error(`❌ Błąd podczas usuwania użytkownika z rankingu:`, removeError.message);
                                }
                            }
                        }
                    }
                }
            }

            // Przeładuj jeśli ktoś został usunięty z rankingu
            if (playersRemovedFromRanking && this.rankingService) {
                logger.info('🔄 Przeładowywanie rankingu po usunięciu nieaktywnych użytkowników');
                const updatedPlayers = await this.rankingService.getSortedPlayers(guild.id);
                return await this.updateTopRoles(guild, updatedPlayers, guildTopRoles);
            }

            logger.info('✅ Aktualizacja ról TOP zakończona pomyślnie');
            return true;

        } catch (error) {
            logger.error('❌ Błąd podczas aktualizacji ról TOP:', error);
            return false;
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
                top1: toArr(get('top1')),
                top2: toArr(get('top2')),
                top3: toArr(get('top3')),
                top4to10: toArr(get('top4to10')),
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
