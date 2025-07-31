const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class MemberHandler {
    constructor(config, logService, specialRolesService = null, roleManagementService = null) {
        this.config = config;
        this.logService = logService;
        this.specialRolesService = specialRolesService;
        this.roleManagementService = roleManagementService;
    }

    /**
     * Obsługuje zmiany członków serwera
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleGuildMemberUpdate(oldMember, newMember) {
        // Debug logging
        logger.info(`🔄 Zmiana ról dla ${newMember.user.tag}`);
        
        // Sprawdź zmiany ról do obsługi grup ekskluzywnych
        await this.handleExclusiveRoleGroups(oldMember, newMember);
        
        // Usunięto system zarządzania rolami TOP - EndersEcho już to obsługuje
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
            const removedRoles = oldRoleIds.filter(id => !newRoleIds.includes(id));

            // Sprawdź czy usunięto główną rolę - jeśli tak, poczekaj 5s i sprawdź ponownie
            const removedMainRoles = removedRoles.filter(id => mainRoles.includes(id));
            if (removedMainRoles.length > 0) {
                // Poczekaj 5 sekund przed sprawdzeniem
                setTimeout(async () => {
                    try {
                        // Pobierz świeże dane użytkownika
                        const freshMember = await newMember.guild.members.fetch(newMember.id);
                        const currentRoleIds = freshMember.roles.cache.map(role => role.id);
                        
                        // Sprawdź czy użytkownik nadal nie ma żadnej głównej roli
                        const hasMainRole = mainRoles.some(roleId => currentRoleIds.includes(roleId));
                        
                        if (!hasMainRole && !currentRoleIds.includes('1173760134527324270')) {
                            await freshMember.roles.add('1173760134527324270');
                            logger.info(`🔄 Nadano rolę 1173760134527324270 dla ${freshMember.displayName} (brak głównych ról po 5s, usunięto: ${removedMainRoles.join(', ')})`);
                        } else if (hasMainRole) {
                            logger.info(`ℹ️ Nie nadano roli 1173760134527324270 dla ${freshMember.displayName} (posiada główną rolę)`);
                        }
                    } catch (error) {
                        logger.error(`❌ Błąd nadawania roli 1173760134527324270 po 5s:`, error?.message || 'Nieznany błąd');
                    }
                }, 5000);
            }

            if (addedRoles.length === 0) return;

            for (const addedRoleId of addedRoles) {
                // Jeśli przyznano główną rolę
                if (mainRoles.includes(addedRoleId)) {
                    // Usuń inne główne role
                    const otherMainRoles = mainRoles.filter(id => id !== addedRoleId && newRoleIds.includes(id));
                    for (const roleId of otherMainRoles) {
                        try {
                            await newMember.roles.remove(roleId);
                            logger.info(`🔄 Usunięto główną rolę ${roleId} dla ${newMember.displayName} (przyznano ${addedRoleId})`);
                        } catch (error) {
                            logger.error(`❌ Błąd usuwania głównej roli ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                    
                    // Usuń wszystkie role z listy rolesToRemoveOnMain
                    const rolesToRemove = rolesToRemoveOnMain.filter(id => newRoleIds.includes(id));
                    for (const roleId of rolesToRemove) {
                        try {
                            await newMember.roles.remove(roleId);
                            logger.info(`🔄 Usunięto rolę pomocniczą ${roleId} dla ${newMember.displayName} (przyznano główną ${addedRoleId})`);
                        } catch (error) {
                            logger.error(`❌ Błąd usuwania roli pomocniczej ${roleId}:`, error?.message || 'Nieznany błąd');
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
                            logger.info(`🔄 Usunięto rolę pomocniczą ${roleId} dla ${newMember.displayName} (przyznano ${addedRoleId})`);
                        } catch (error) {
                            logger.error(`❌ Błąd usuwania roli pomocniczej ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                }
                
                // Jeśli przyznano rolę 1173760134527324270 - usuń wszystkie główne role
                if (addedRoleId === '1173760134527324270') {
                    const mainRolesToRemove = mainRoles.filter(id => newRoleIds.includes(id));
                    for (const roleId of mainRolesToRemove) {
                        try {
                            await newMember.roles.remove(roleId);
                            logger.info(`🔄 Usunięto główną rolę ${roleId} dla ${newMember.displayName} (przyznano specjalną rolę ${addedRoleId})`);
                        } catch (error) {
                            logger.error(`❌ Błąd usuwania głównej roli ${roleId}:`, error?.message || 'Nieznany błąd');
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('❌ Błąd obsługi grup ekskluzywnych ról:', error?.message || 'Nieznany błąd');
        }
    }

    /**
     * Obsługuje utratę boost przez użytkownika
     * @param {GuildMember} member - Członek który stracił boost
     */
    async handleBoostLoss(member) {
        try {
            logger.info(`💔 Obsługa utraty boost: ${member.user.tag}`);
            
            if (this.roleManagementService) {
                const result = await this.roleManagementService.handleBoostLoss(member);
                
                if (result.success && result.removedRoles) {
                    // Loguj do kanału
                    await this.logService.logRoleRemoval(
                        result.removedRoles,
                        member,
                        'Utrata boost serwera'
                    );
                }
            } else {
                logger.warn('RoleManagementService nie jest dostępny dla handleBoostLoss');
            }
        } catch (error) {
            logger.error('❌ Błąd obsługi utraty boost:', error?.message || 'Nieznany błąd');
        }
    }

    /**
     * Obsługuje otrzymanie boost przez użytkownika
     * @param {GuildMember} member - Członek który otrzymał boost
     */
    async handleBoostGain(member) {
        try {
            logger.info(`💖 Obsługa otrzymania boost: ${member.user.tag}`);
            
            if (this.roleManagementService) {
                const result = await this.roleManagementService.handleBoostGain(member);
                
                if (result.success && result.restoredRoles) {
                    // Loguj do kanału
                    await this.logService.logRoleRestoration(
                        result.restoredRoles,
                        member,
                        'Otrzymanie boost serwera'
                    );
                }
            } else {
                logger.warn('RoleManagementService nie jest dostępny dla handleBoostGain');
            }
        } catch (error) {
            logger.error('❌ Błąd obsługi otrzymania boost:', error?.message || 'Nieznany błąd');
        }
    }
}

module.exports = MemberHandler;