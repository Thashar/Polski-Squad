const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class MemberHandler {
    constructor(config, roleManagementService, logService) {
        this.config = config;
        this.roleManagementService = roleManagementService;
        this.logService = logService;
    }

    /**
     * Obsługuje zmiany członków serwera
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleGuildMemberUpdate(oldMember, newMember) {
        // Sprawdź zmiany ról do obsługi grup ekskluzywnych
        await this.handleExclusiveRoleGroups(oldMember, newMember);
        
        // Sprawdź czy są ustawienia automatycznego zarządzania rolami
        if (!this.config.roleManagement || !this.config.roleManagement.triggerRoleId || !this.config.roleManagement.rolesToRemove) {
            return;
        }

        // Obsłuż usuwanie ról (gdy użytkownik traci główną rolę)
        const removalResult = await this.roleManagementService.handleRoleRemoval(oldMember, newMember);
        
        if (removalResult.success && !removalResult.noAction && removalResult.removedRoles) {
            // Zaloguj do kanału
            await this.logService.logRoleRemoval(
                removalResult.removedRoles, 
                removalResult.user, 
                this.config.roleManagement.triggerRoleId
            );
        }
        
        // Obsłuż przywracanie ról (gdy użytkownik odzyskuje główną rolę)
        const restorationResult = await this.roleManagementService.handleRoleRestoration(oldMember, newMember);
        
        if (restorationResult.success && !restorationResult.noAction && restorationResult.restoredRoles) {
            // Zaloguj do kanału
            await this.logService.logRoleRestoration(
                restorationResult.restoredRoles, 
                restorationResult.user, 
                this.config.roleManagement.triggerRoleId
            );
        }
    }

    /**
     * Obsługuje grupy ekskluzywnych ról
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleExclusiveRoleGroups(oldMember, newMember) {
        try {
            // Grupa 1: Role główne (może mieć tylko jedną)
            const mainRoles = ['1170331604846120980', '1193124672070484050', '1200053198472359987', '1262785926984237066'];
            
            // Grupa 2: Role pomocnicze (może mieć tylko jedną)
            const secondaryRoles = ['1194249987677229186', '1196805078162616480', '1210265548584132648', '1262793135860355254'];
            
            // Role usuwane (usuwane gdy przyznana główna rola)
            const rolesToRemoveOnMain = ['1173760134527324270', '1194249987677229186', '1196805078162616480', '1210265548584132648', '1262793135860355254'];

            const oldRoleIds = oldMember.roles.cache.map(role => role.id);
            const newRoleIds = newMember.roles.cache.map(role => role.id);
            const addedRoles = newRoleIds.filter(id => !oldRoleIds.includes(id));

            if (addedRoles.length === 0) return;

            for (const addedRoleId of addedRoles) {
                // Jeśli przyznano główną rolę
                if (mainRoles.includes(addedRoleId)) {
                    // Usuń inne główne role
                    const otherMainRoles = mainRoles.filter(id => id !== addedRoleId && newRoleIds.includes(id));
                    for (const roleId of otherMainRoles) {
                        try {
                            await newMember.roles.remove(roleId);
                            this.logger.info(`🔄 Usunięto główną rolę ${roleId} dla ${newMember.displayName} (przyznano ${addedRoleId})`);
                        } catch (error) {
                            this.logger.error(`❌ Błąd usuwania głównej roli ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                    
                    // Usuń wszystkie role z listy rolesToRemoveOnMain
                    const rolesToRemove = rolesToRemoveOnMain.filter(id => newRoleIds.includes(id));
                    for (const roleId of rolesToRemove) {
                        try {
                            await newMember.roles.remove(roleId);
                            this.logger.info(`🔄 Usunięto rolę pomocniczą ${roleId} dla ${newMember.displayName} (przyznano główną ${addedRoleId})`);
                        } catch (error) {
                            this.logger.error(`❌ Błąd usuwania roli pomocniczej ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                }
                
                // Jeśli przyznano rolę pomocniczą
                if (secondaryRoles.includes(addedRoleId)) {
                    // Usuń inne role pomocnicze
                    const otherSecondaryRoles = secondaryRoles.filter(id => id !== addedRoleId && newRoleIds.includes(id));
                    for (const roleId of otherSecondaryRoles) {
                        try {
                            await newMember.roles.remove(roleId);
                            this.logger.info(`🔄 Usunięto rolę pomocniczą ${roleId} dla ${newMember.displayName} (przyznano ${addedRoleId})`);
                        } catch (error) {
                            this.logger.error(`❌ Błąd usuwania roli pomocniczej ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                }
                
                // Jeśli przyznano rolę 1173760134527324270 - usuń wszystkie główne role
                if (addedRoleId === '1173760134527324270') {
                    const mainRolesToRemove = mainRoles.filter(id => newRoleIds.includes(id));
                    for (const roleId of mainRolesToRemove) {
                        try {
                            await newMember.roles.remove(roleId);
                            this.logger.info(`🔄 Usunięto główną rolę ${roleId} dla ${newMember.displayName} (przyznano specjalną rolę ${addedRoleId})`);
                        } catch (error) {
                            this.logger.error(`❌ Błąd usuwania głównej roli ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error('❌ Błąd obsługi grup ekskluzywnych ról:', error?.message || 'Nieznany błąd');
        }
    }
}

module.exports = MemberHandler;