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
        // Debug logging
        this.logger.info(`🔄 Zmiana ról dla ${newMember.user.tag}`);
        
        // Sprawdź zmiany ról do obsługi grup ekskluzywnych
        await this.handleExclusiveRoleGroups(oldMember, newMember);
        
        // Sprawdź czy są ustawienia automatycznego zarządzania rolami
        if (!this.config.roleManagement || !this.config.roleManagement.triggerRoleId) {
            this.logger.info(`❌ Brak konfiguracji roleManagement lub triggerRoleId`);
            return;
        }
        
        this.logger.info(`✅ Konfiguracja OK, triggerRoleId: ${this.config.roleManagement.triggerRoleId}`);
        
        // Debug informacje o rolach
        const oldRoleIds = oldMember.roles.cache.map(r => r.id);
        const newRoleIds = newMember.roles.cache.map(r => r.id);
        const addedRoles = newRoleIds.filter(id => !oldRoleIds.includes(id));
        const removedRoles = oldRoleIds.filter(id => !newRoleIds.includes(id));
        
        if (addedRoles.length > 0) {
            this.logger.info(`➕ Dodane role: ${addedRoles.join(', ')}`);
        }
        if (removedRoles.length > 0) {
            this.logger.info(`➖ Usunięte role: ${removedRoles.join(', ')}`);
            this.logger.info(`🎯 Sprawdzam czy usunięto trigger rolę: ${this.config.roleManagement.triggerRoleId}`);
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
                            this.logger.info(`🔄 Nadano rolę 1173760134527324270 dla ${freshMember.displayName} (brak głównych ról po 5s, usunięto: ${removedMainRoles.join(', ')})`);
                        } else if (hasMainRole) {
                            this.logger.info(`ℹ️ Nie nadano roli 1173760134527324270 dla ${freshMember.displayName} (posiada główną rolę)`);
                        }
                    } catch (error) {
                        this.logger.error(`❌ Błąd nadawania roli 1173760134527324270 po 5s:`, error?.message || 'Nieznany błąd');
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

    /**
     * Obsługuje utratę boost przez użytkownika
     * @param {GuildMember} member - Członek który stracił boost
     */
    async handleBoostLoss(member) {
        try {
            this.logger.info(`💔 Obsługa utraty boost: ${member.user.tag}`);
            
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
                    await this.roleManagementService.addRemovedRoles(member.user.id, roleIdsToSave);
                    
                    // Usuń wszystkie znalezione role jednocześnie
                    await member.roles.remove(rolesToRemoveFromUser, 'Automatyczne usunięcie ról po utracie boost');
                    
                    const removedRoleNames = rolesToRemoveFromUser.map(role => role.name).join(', ');
                    this.logger.info(`🗑️ Automatycznie usunięto role po utracie boost: ${removedRoleNames} od ${member.user.tag}`);

                    // Loguj do kanału
                    await this.logService.logRoleRemoval(
                        rolesToRemoveFromUser,
                        member,
                        'Utrata boost serwera'
                    );

                } catch (error) {
                    this.logger.error(`❌ Błąd podczas usuwania ról po utracie boost (${member.user.tag}):`, error?.message || 'Nieznany błąd');
                }
            } else {
                this.logger.info(`ℹ️ ${member.user.tag} nie posiada ról specjalnych do usunięcia po utracie boost`);
            }
        } catch (error) {
            this.logger.error('❌ Błąd obsługi utraty boost:', error?.message || 'Nieznany błąd');
        }
    }

    /**
     * Obsługuje otrzymanie boost przez użytkownika
     * @param {GuildMember} member - Członek który otrzymał boost
     */
    async handleBoostGain(member) {
        try {
            this.logger.info(`💖 Obsługa otrzymania boost: ${member.user.tag}`);
            
            // Sprawdź czy użytkownik ma zapisane role do przywrócenia
            const rolesToRestore = await this.roleManagementService.getRemovedRoles(member.user.id);
            
            if (rolesToRestore && rolesToRestore.length > 0) {
                const rolesToAdd = [];
                
                for (const roleId of rolesToRestore) {
                    const role = member.guild.roles.cache.get(roleId);
                    if (role && !member.roles.cache.has(roleId)) {
                        rolesToAdd.push(role);
                    }
                }
                
                if (rolesToAdd.length > 0) {
                    try {
                        await member.roles.add(rolesToAdd, 'Automatyczne przywrócenie ról po otrzymaniu boost');
                        
                        const restoredRoleNames = rolesToAdd.map(role => role.name).join(', ');
                        this.logger.info(`✅ Automatycznie przywrócono role po otrzymaniu boost: ${restoredRoleNames} dla ${member.user.tag}`);

                        // Loguj do kanału
                        await this.logService.logRoleRestoration(
                            rolesToAdd,
                            member,
                            'Otrzymanie boost serwera'
                        );

                    } catch (error) {
                        this.logger.error(`❌ Błąd podczas przywracania ról po otrzymaniu boost (${member.user.tag}):`, error?.message || 'Nieznany błąd');
                    }
                } else {
                    this.logger.info(`ℹ️ Brak ról do przywrócenia dla ${member.user.tag} po otrzymaniu boost`);
                }
            } else {
                this.logger.info(`ℹ️ ${member.user.tag} nie ma zapisanych ról do przywrócenia po otrzymaniu boost`);
            }
        } catch (error) {
            this.logger.error('❌ Błąd obsługi otrzymania boost:', error?.message || 'Nieznany błąd');
        }
    }
}

module.exports = MemberHandler;