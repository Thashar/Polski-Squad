const { safeParse } = require('../../utils/safeJSON');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class RoleManagementService {
    constructor(config, specialRolesService) {
        this.config = config;
        this.specialRolesService = specialRolesService;
        this.removedRolesFile = config.database.removedRoles;
    }

    /**
     * Odczytuje dane o usuniętych rolach
     * @returns {Object} Dane o usuniętych rolach
     */
    async readRemovedRoles() {
        try {
            const data = await fs.readFile(this.removedRolesFile, 'utf8');
            return safeParse(data, {});
        } catch (error) {
            // Jeśli plik nie istnieje, zwróć pusty obiekt
            if (error.code === 'ENOENT') {
                return {};
            }
            logger.error(`Błąd podczas odczytu pliku ról: ${error.message}`);
            return {};
        }
    }

    /**
     * Zapisuje dane o usuniętych rolach
     * @param {Object} data - Dane do zapisania
     */
    async writeRemovedRoles(data) {
        try {
            // Upewniamy się, że katalog istnieje
            const path = require('path');
            const dir = path.dirname(this.removedRolesFile);
            await fs.mkdir(dir, { recursive: true });
            
            await fs.writeFile(this.removedRolesFile, JSON.stringify(data, null, 2), 'utf8');
            logger.info('Dane o usuniętych rolach zostały zapisane');
        } catch (error) {
            logger.error(`Błąd podczas zapisu pliku ról: ${error.message}`);
        }
    }

    /**
     * Dodaje usunięte role użytkownika
     * @param {string} userId - ID użytkownika
     * @param {Array} roleIds - Array ID ról
     */
    async addRemovedRoles(userId, roleIds) {
        const removedRoles = await this.readRemovedRoles();
        
        if (!removedRoles[userId]) {
            removedRoles[userId] = [];
        }
        
        // Dodaj nowe role, unikając duplikatów
        for (const roleId of roleIds) {
            if (!removedRoles[userId].includes(roleId)) {
                removedRoles[userId].push(roleId);
            }
        }
        
        await this.writeRemovedRoles(removedRoles);
        logger.info(`Zapisano usunięte role dla użytkownika ${userId}: ${roleIds.join(', ')}`);
    }

    /**
     * Pobiera i usuwa zapisane role użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {Array} Array ID ról
     */
    async getRemovedRoles(userId) {
        const removedRoles = await this.readRemovedRoles();
        const userRoles = removedRoles[userId] || [];
        
        // Usuń dane użytkownika po pobraniu
        if (removedRoles[userId]) {
            delete removedRoles[userId];
            await this.writeRemovedRoles(removedRoles);
            logger.info(`Pobrano i usunięto zapisane role dla użytkownika ${userId}: ${userRoles.join(', ')}`);
        }
        
        return userRoles;
    }

    /**
     * Obsługuje usuwanie ról gdy użytkownik traci boost serwera
     * @param {GuildMember} member - Członek który stracił boost
     */
    async handleBoostLoss(member) {
        try {
            logger.info(`Obsługa utraty boost: ${member.user.tag}`);
            
            // Pobierz role specjalne do usunięcia
            const rolesToRemove = await this.specialRolesService.getAllRolesToRemove();
            const rolesToRemoveFromUser = [];
            const roleIdsToSave = [];

            // Sprawdź które specjalne role użytkownik posiada
            for (const roleId of rolesToRemove) {
                if (member.roles.cache.has(roleId)) {
                    const role = member.roles.cache.get(roleId);
                    rolesToRemoveFromUser.push(role);
                    roleIdsToSave.push(roleId);
                }
            }

            if (rolesToRemoveFromUser.length > 0) {
                try {
                    // Zapisz usunięte role do pliku PRZED ich usunięciem
                    await this.addRemovedRoles(member.user.id, roleIdsToSave);
                    
                    // Usuń wszystkie znalezione role jednocześnie
                    await member.roles.remove(rolesToRemoveFromUser, 'Automatyczne usunięcie ról po utracie boost');
                    
                    const removedRoleNames = rolesToRemoveFromUser.map(role => role.name).join(', ');
                    logger.info(`Automatycznie usunięto i zapisano role: ${removedRoleNames} od użytkownika ${member.user.tag}`);

                    return {
                        success: true,
                        removedRoles: rolesToRemoveFromUser,
                        user: member
                    };

                } catch (error) {
                    logger.error(`Błąd podczas automatycznego usuwania ról po utracie boost od ${member.user.tag}: ${error.message}`);
                    return { success: false, error: error.message };
                }
            } else {
                logger.info(`Użytkownik ${member.user.tag} nie posiada żadnych ról do automatycznego usunięcia po utracie boost`);
            }

            return { success: true, noAction: true };

        } catch (error) {
            logger.error(`Błąd w handleBoostLoss: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Obsługuje przywracanie ról gdy użytkownik odzyskuje boost serwera
     * @param {GuildMember} member - Członek który otrzymał boost
     */
    async handleBoostGain(member) {
        try {
            logger.info(`Obsługa otrzymania boost: ${member.user.tag}`);

            // Pobierz zapisane role użytkownika
            const savedRoleIds = await this.getRemovedRoles(member.user.id);

            if (savedRoleIds.length > 0) {
                try {
                    const rolesToRestore = [];
                    const roleNamesToRestore = [];

                    // Sprawdź które role nadal istnieją na serwerze i użytkownik ich nie ma
                    for (const roleId of savedRoleIds) {
                        const role = member.guild.roles.cache.get(roleId);
                        if (role && !member.roles.cache.has(roleId)) {
                            rolesToRestore.push(role);
                            roleNamesToRestore.push(role.name);
                        } else if (!role) {
                            logger.warn(`Rola o ID ${roleId} nie istnieje już na serwerze`);
                        }
                    }

                    if (rolesToRestore.length > 0) {
                        // Przywróć role użytkownikowi
                        await member.roles.add(rolesToRestore, 'Automatyczne przywrócenie ról po otrzymaniu boost');
                        
                        logger.info(`Automatycznie przywrócono role: ${roleNamesToRestore.join(', ')} użytkownikowi ${member.user.tag}`);

                        return {
                            success: true,
                            restoredRoles: rolesToRestore,
                            user: member
                        };
                    }

                } catch (error) {
                    logger.error(`Błąd podczas automatycznego przywracania ról po otrzymaniu boost użytkownikowi ${member.user.tag}: ${error.message}`);
                    return { success: false, error: error.message };
                }
            } else {
                logger.info(`Użytkownik ${member.user.tag} nie ma zapisanych ról do przywrócenia po otrzymaniu boost`);
            }

            return { success: true, noAction: true };

        } catch (error) {
            logger.error(`Błąd w handleBoostGain: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

module.exports = RoleManagementService;