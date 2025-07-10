const { logWithTimestamp } = require('../utils/helpers');

class RoleService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Aktualizuje role TOP 1-3 na podstawie aktualnego rankingu
     * @param {Guild} guild - Serwer Discord
     * @param {Array} sortedPlayers - Posortowani gracze
     */
    async updateTopRoles(guild, sortedPlayers) {
        try {
            console.log('Rozpoczynam aktualizację ról TOP...');
            
            // Pobierz role z serwera
            const top1Role = guild.roles.cache.get(this.config.topRoles.top1);
            const top2Role = guild.roles.cache.get(this.config.topRoles.top2);
            const top3Role = guild.roles.cache.get(this.config.topRoles.top3);
            
            if (!top1Role || !top2Role || !top3Role) {
                console.error('❌ Nie znaleziono wszystkich ról TOP na serwerze');
                return false;
            }
            
            const topRoles = [top1Role, top2Role, top3Role];
            
            // Usuń wszystkie role TOP od wszystkich użytkowników (bez fetch)
            for (const role of topRoles) {
                const membersWithRole = role.members;
                for (const [memberId, member] of membersWithRole) {
                    try {
                        await member.roles.remove(role);
                        console.log(`Usunięto rolę ${role.name} od ${member.user.tag}`);
                    } catch (error) {
                        console.error(`Błąd usuwania roli ${role.name} od ${member.user.tag}:`, error.message);
                    }
                }
            }
            
            // Przyznaj nowe role TOP 1-3
            for (let i = 0; i < Math.min(3, sortedPlayers.length); i++) {
                const player = sortedPlayers[i];
                const role = topRoles[i];
                
                try {
                    // Pobierz tylko konkretnego użytkownika
                    const member = await guild.members.fetch(player.userId);
                    if (member) {
                        await member.roles.add(role);
                        console.log(`✅ Przyznano rolę ${role.name} użytkownikowi ${member.user.tag}`);
                    }
                } catch (error) {
                    console.error(`Błąd przyznawania roli ${role.name} użytkownikowi ${player.userId}:`, error.message);
                }
            }
            
            console.log('✅ Aktualizacja ról TOP zakończona pomyślnie');
            return true;
            
        } catch (error) {
            console.error('❌ Błąd podczas aktualizacji ról TOP:', error);
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
            
            return {
                top1: top1Role ? Array.from(top1Role.members.values()) : [],
                top2: top2Role ? Array.from(top2Role.members.values()) : [],
                top3: top3Role ? Array.from(top3Role.members.values()) : []
            };
        } catch (error) {
            console.error('Błąd pobierania posiadaczy ról TOP:', error);
            return { top1: [], top2: [], top3: [] };
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