const { logWithTimestamp } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
class RoleService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Aktualizuje role TOP 1-3, TOP 4-10 oraz TOP 11-30 na podstawie aktualnego rankingu
     * @param {Guild} guild - Serwer Discord
     * @param {Array} sortedPlayers - Posortowani gracze
     */
    async updateTopRoles(guild, sortedPlayers) {
        try {
            // Rozpoczynam aktualizację ról TOP (bez logowania)
            
            // Pobierz role z serwera
            const top1Role = guild.roles.cache.get(this.config.topRoles.top1);
            const top2Role = guild.roles.cache.get(this.config.topRoles.top2);
            const top3Role = guild.roles.cache.get(this.config.topRoles.top3);
            const top4to10Role = guild.roles.cache.get(this.config.topRoles.top4to10);
            const top11to30Role = guild.roles.cache.get(this.config.topRoles.top11to30);
            
            if (!top1Role || !top2Role || !top3Role || !top4to10Role || !top11to30Role) {
                logger.error('❌ Nie znaleziono wszystkich ról TOP na serwerze');
                return false;
            }
            
            const allTopRoles = [top1Role, top2Role, top3Role, top4to10Role, top11to30Role];
            
            // Usuń wszystkie role TOP od wszystkich użytkowników
            for (const role of allTopRoles) {
                const membersWithRole = role.members;
                for (const [memberId, member] of membersWithRole) {
                    try {
                        await member.roles.remove(role);
                        // Usunięto rolę (bez logowania)
                    } catch (error) {
                        logger.error(`Błąd usuwania roli ${role.name} od ${member.user.tag}:`, error.message);
                    }
                }
            }
            
            // Przyznaj nowe role na podstawie pozycji w rankingu
            for (let i = 0; i < sortedPlayers.length; i++) {
                const player = sortedPlayers[i];
                const position = i + 1;
                let targetRole = null;
                
                // Określ odpowiednią rolę na podstawie pozycji
                if (position === 1) {
                    targetRole = top1Role;
                } else if (position === 2) {
                    targetRole = top2Role;
                } else if (position === 3) {
                    targetRole = top3Role;
                } else if (position >= 4 && position <= 10) {
                    targetRole = top4to10Role;
                } else if (position >= 11 && position <= 30) {
                    targetRole = top11to30Role;
                }
                
                if (targetRole) {
                    try {
                        const member = await guild.members.fetch(player.userId);
                        if (member) {
                            await member.roles.add(targetRole);
                            // Przyznano rolę (bez logowania)
                        }
                    } catch (error) {
                        logger.error(`Błąd przyznawania roli ${targetRole.name} użytkownikowi ${player.userId}:`, error.message);
                    }
                }
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
     * @param {Guild} guild - Serwer Discord
     * @returns {Object} - Obiekt z informacjami o rolach
     */
    async getTopRoleHolders(guild) {
        try {
            const top1Role = guild.roles.cache.get(this.config.topRoles.top1);
            const top2Role = guild.roles.cache.get(this.config.topRoles.top2);
            const top3Role = guild.roles.cache.get(this.config.topRoles.top3);
            const top4to10Role = guild.roles.cache.get(this.config.topRoles.top4to10);
            const top11to30Role = guild.roles.cache.get(this.config.topRoles.top11to30);
            
            return {
                top1: top1Role ? Array.from(top1Role.members.values()) : [],
                top2: top2Role ? Array.from(top2Role.members.values()) : [],
                top3: top3Role ? Array.from(top3Role.members.values()) : [],
                top4to10: top4to10Role ? Array.from(top4to10Role.members.values()) : [],
                top11to30: top11to30Role ? Array.from(top11to30Role.members.values()) : []
            };
        } catch (error) {
            logger.error('Błąd pobierania posiadaczy ról TOP:', error);
            return { top1: [], top2: [], top3: [], top4to10: [], top11to30: [] };
        }
    }

    /**
     * Sprawdza czy użytkownik ma jakąkolwiek rolę TOP
     * @param {GuildMember} member - Członek serwera
     * @returns {string|null} - Nazwa roli TOP lub null
     */
    getUserTopRole(member) {
        const topRoleIds = Object.values(this.config.topRoles);
        
        for (const roleId of topRoleIds) {
            if (member.roles.cache.has(roleId)) {
                const role = member.guild.roles.cache.get(roleId);
                return role ? role.name : null;
            }
        }
        
        return null;
    }

    /**
     * Loguje zmiany w rolach TOP
     * @param {Array} oldHolders - Poprzedni posiadacze ról
     * @param {Array} newHolders - Nowi posiadacze ról
     */
    logRoleChanges(oldHolders, newHolders) {
        const positions = ['TOP1', 'TOP2', 'TOP3'];
        
        for (let i = 0; i < 3; i++) {
            const oldHolder = oldHolders[i] ? oldHolders[i].user.tag : 'Brak';
            const newHolder = newHolders[i] ? newHolders[i].username : 'Brak';
            
            if (oldHolder !== newHolder) {
                logWithTimestamp(`${positions[i]}: ${oldHolder} → ${newHolder}`, 'info');
            }
        }
    }
}

module.exports = RoleService;