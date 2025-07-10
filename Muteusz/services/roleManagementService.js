const fs = require('fs').promises;
const { logWithTimestamp } = require('../utils/helpers');

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
            return JSON.parse(data);
        } catch (error) {
            // Jeśli plik nie istnieje, zwróć pusty obiekt
            if (error.code === 'ENOENT') {
                return {};
            }
            logWithTimestamp(`Błąd podczas odczytu pliku ról: ${error.message}`, 'error');
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
            logWithTimestamp('Dane o usuniętych rolach zostały zapisane', 'info');
        } catch (error) {
            logWithTimestamp(`Błąd podczas zapisu pliku ról: ${error.message}`, 'error');
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
        logWithTimestamp(`Zapisano usunięte role dla użytkownika ${userId}: ${roleIds.join(', ')}`, 'info');
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
            logWithTimestamp(`Pobrano i usunięto zapisane role dla użytkownika ${userId}: ${userRoles.join(', ')}`, 'info');
        }
        
        return userRoles;
    }

    /**
     * Obsługuje usuwanie ról gdy użytkownik traci główną rolę
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleRoleRemoval(oldMember, newMember) {
        try {
            const triggerRoleId = this.config.roleManagement.triggerRoleId;
            const rolesToRemove = await this.specialRolesService.getAllRolesToRemove();

            // Sprawdź czy użytkownik stracił główną rolę (trigger role)
            const hadTriggerRole = oldMember.roles.cache.has(triggerRoleId);
            const hasTriggerRole = newMember.roles.cache.has(triggerRoleId);

            if (hadTriggerRole && !hasTriggerRole) {
                logWithTimestamp(`Użytkownik ${newMember.user.tag} stracił główną rolę (ID: ${triggerRoleId})`, 'info');

                // Sprawdź które z określonych ról użytkownik nadal posiada
                const currentRoles = newMember.roles.cache;
                const rolesToRemoveFromUser = [];
                const roleIdsToSave = [];

                for (const roleId of rolesToRemove) {
                    if (currentRoles.has(roleId)) {
                        const role = currentRoles.get(roleId);
                        rolesToRemoveFromUser.push(role);
                        roleIdsToSave.push(roleId);
                    }
                }

                if (rolesToRemoveFromUser.length > 0) {
                    try {
                        // Zapisz usunięte role do pliku PRZED ich usunięciem
                        await this.addRemovedRoles(newMember.user.id, roleIdsToSave);
                        
                        // Usuń wszystkie znalezione role jednocześnie
                        await newMember.roles.remove(rolesToRemoveFromUser, 'Automatyczne usunięcie ról po utracie głównej roli');
                        
                        const removedRoleNames = rolesToRemoveFromUser.map(role => role.name).join(', ');
                        logWithTimestamp(`Automatycznie usunięto i zapisano role: ${removedRoleNames} od użytkownika ${newMember.user.tag}`, 'success');

                        return {
                            success: true,
                            removedRoles: rolesToRemoveFromUser,
                            user: newMember
                        };

                    } catch (error) {
                        logWithTimestamp(`Błąd podczas automatycznego usuwania ról od ${newMember.user.tag}: ${error.message}`, 'error');
                        return { success: false, error: error.message };
                    }
                } else {
                    logWithTimestamp(`Użytkownik ${newMember.user.tag} nie posiada żadnych ról do automatycznego usunięcia`, 'info');
                }
            }

            return { success: true, noAction: true };

        } catch (error) {
            logWithTimestamp(`Błąd w handleRoleRemoval: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Obsługuje przywracanie ról gdy użytkownik odzyskuje główną rolę
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleRoleRestoration(oldMember, newMember) {
        try {
            const triggerRoleId = this.config.roleManagement.triggerRoleId;

            // Sprawdź czy użytkownik odzyskał główną rolę (trigger role)
            const hadTriggerRole = oldMember.roles.cache.has(triggerRoleId);
            const hasTriggerRole = newMember.roles.cache.has(triggerRoleId);

            if (!hadTriggerRole && hasTriggerRole) {
                logWithTimestamp(`Użytkownik ${newMember.user.tag} odzyskał główną rolę (ID: ${triggerRoleId})`, 'info');

                // Pobierz zapisane role użytkownika
                const savedRoleIds = await this.getRemovedRoles(newMember.user.id);

                if (savedRoleIds.length > 0) {
                    try {
                        const rolesToRestore = [];
                        const roleNamesToRestore = [];

                        // Sprawdź które role nadal istnieją na serwerze
                        for (const roleId of savedRoleIds) {
                            const role = newMember.guild.roles.cache.get(roleId);
                            if (role) {
                                rolesToRestore.push(role);
                                roleNamesToRestore.push(role.name);
                            } else {
                                logWithTimestamp(`Rola o ID ${roleId} nie istnieje już na serwerze`, 'warn');
                            }
                        }

                        if (rolesToRestore.length > 0) {
                            // Przywróć role użytkownikowi
                            await newMember.roles.add(rolesToRestore, 'Automatyczne przywrócenie ról po odzyskaniu głównej roli');
                            
                            logWithTimestamp(`Automatycznie przywrócono role: ${roleNamesToRestore.join(', ')} użytkownikowi ${newMember.user.tag}`, 'success');

                            return {
                                success: true,
                                restoredRoles: rolesToRestore,
                                user: newMember
                            };
                        }

                    } catch (error) {
                        logWithTimestamp(`Błąd podczas automatycznego przywracania ról użytkownikowi ${newMember.user.tag}: ${error.message}`, 'error');
                        return { success: false, error: error.message };
                    }
                } else {
                    logWithTimestamp(`Użytkownik ${newMember.user.tag} nie ma zapisanych ról do przywrócenia`, 'info');
                }
            }

            return { success: true, noAction: true };

        } catch (error) {
            logWithTimestamp(`Błąd w handleRoleRestoration: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }
}

module.exports = RoleManagementService;