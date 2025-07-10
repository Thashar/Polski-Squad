const { logWithTimestamp } = require('../utils/helpers');

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
}

module.exports = MemberHandler;