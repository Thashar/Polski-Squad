const { logWithTimestamp } = require('../utils/helpers');

class RoleService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Sprawdza czy użytkownik ma rolę blokującą udział w loteriach
     * @param {GuildMember} member - Członek serwera
     * @returns {boolean} - Czy użytkownik jest zablokowany
     */
    isUserBlocked(member) {
        const hasBlockedRole = member.roles.cache.has(this.config.blockedRole);
        if (hasBlockedRole) {
            logWithTimestamp(`Użytkownik ${member.displayName} ma rolę blokującą (${this.config.blockedRole})`, 'warn');
        }
        return hasBlockedRole;
    }

    /**
     * Sprawdza czy użytkownik już posiada wymaganą rolę
     * @param {GuildMember} member - Członek serwera
     * @param {string} requiredRoleId - ID wymaganej roli
     * @returns {boolean} - Czy użytkownik ma rolę
     */
    hasRequiredRole(member, requiredRoleId) {
        return member.roles.cache.has(requiredRoleId);
    }

    /**
     * Przyznaje rolę użytkownikowi
     * @param {GuildMember} member - Członek serwera
     * @param {string} roleId - ID roli do przyznania
     * @param {Guild} guild - Serwer Discord
     * @returns {Object} - Wynik operacji
     */
    async assignRole(member, roleId, guild) {
        try {
            const role = await guild.roles.fetch(roleId);
            if (!role) {
                throw new Error(`Nie znaleziono roli o ID: ${roleId}`);
            }

            if (this.hasRequiredRole(member, roleId)) {
                logWithTimestamp(`Użytkownik ${member.displayName} już posiada rolę ${role.name}`, 'info');
                return {
                    success: true,
                    alreadyHad: true,
                    role: role
                };
            }

            await member.roles.add(role);
            logWithTimestamp(`Przyznano rolę ${role.name} użytkownikowi ${member.displayName}`, 'success');
            
            return {
                success: true,
                alreadyHad: false,
                role: role
            };

        } catch (error) {
            logWithTimestamp(`Błąd podczas przyznawania roli: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sprawdza czy kanał jest dozwolony dla analizy
     * @param {string} channelId - ID kanału
     * @returns {Object|null} - Konfiguracja kanału lub null
     */
    getChannelConfig(channelId) {
        for (const [key, channelConfig] of Object.entries(this.config.channels)) {
            if (channelConfig.targetChannelId === channelId) {
                return channelConfig;
            }
        }
        return null;
    }

    /**
     * Sprawdza czy kanał jest kanałem Daily lub CX (do blokowania)
     * @param {string} channelId - ID kanału
     * @returns {boolean} - Czy kanał podlega blokowaniu
     */
    isRestrictedChannel(channelId) {
        const channelConfig = this.getChannelConfig(channelId);
        return channelConfig !== null;
    }
}

module.exports = RoleService;