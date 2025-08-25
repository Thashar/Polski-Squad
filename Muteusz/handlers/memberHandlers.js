const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class MemberHandler {
    constructor(config, logService, specialRolesService = null, roleManagementService = null, roleConflictService = null, memberCacheService = null) {
        this.config = config;
        this.logService = logService;
        this.specialRolesService = specialRolesService;
        this.roleManagementService = roleManagementService;
        this.roleConflictService = roleConflictService;
        this.memberCacheService = memberCacheService;
    }

    /**
     * Obsługuje zmiany członków serwera
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleGuildMemberUpdate(oldMember, newMember) {
        try {
            // Debug logging
            logger.info(`🔄 Zmiana ról dla ${newMember.user.tag}`);
            
            // NOWY SYSTEM: Użyj MemberCacheService do prawidłowego wykrywania zmian
            if (this.memberCacheService) {
                const cacheResult = await this.memberCacheService.handleMemberUpdate(oldMember, newMember);
                
                if (cacheResult.changed) {
                    logger.info(`🎯 Wykryto zmianę ról - uruchamiam system konfliktów`);
                    
                    // Użyj RoleConflictService z prawidłowymi danymi z cache
                    if (this.roleConflictService) {
                        await this.roleConflictService.handleRoleChange(
                            cacheResult.member.user.id,
                            cacheResult.member.guild.id,
                            cacheResult.previousRoles,
                            cacheResult.currentRoles
                        );
                    } else {
                        logger.warn(`⚠️ RoleConflictService niedostępny`);
                    }
                } else {
                    logger.info(`ℹ️ Brak zmian w rolach (z cache)`);
                }
            } else {
                // FALLBACK: Stary system (jeśli cache service niedostępny)
                logger.warn(`⚠️ MemberCacheService niedostępny - używam starego systemu`);
                
                // FIX: Po restarcie bota cache może być pusty - fetchuj świeże dane
                let freshOldMember, freshNewMember;
                
                try {
                    // Fetch aktualnych danych członków
                    freshOldMember = await oldMember.guild.members.fetch(oldMember.id);
                    freshNewMember = await newMember.guild.members.fetch(newMember.id);
                    logger.info(`✅ Pobrano świeże dane członków z API Discord`);
                } catch (fetchError) {
                    logger.warn(`⚠️ Nie można pobrać świeżych danych członków, używam cache: ${fetchError.message}`);
                    freshOldMember = oldMember;
                    freshNewMember = newMember;
                }
                
                // Pobierz role przed i po zmianie (używaj fresh data jeśli dostępne)
                const oldRoleIds = freshOldMember.roles.cache.map(role => role.id);
                const newRoleIds = freshNewMember.roles.cache.map(role => role.id);
                
                logger.info(`📊 FALLBACK Role PRZED: [${oldRoleIds.length}] ${oldRoleIds.join(', ')}`);
                logger.info(`📊 FALLBACK Role PO: [${newRoleIds.length}] ${newRoleIds.join(', ')}`);
                
                // Sprawdź różnice w rolach
                const addedRoles = newRoleIds.filter(id => !oldRoleIds.includes(id));
                const removedRoles = oldRoleIds.filter(id => !newRoleIds.includes(id));
                
                const rolesChanged = addedRoles.length > 0 || removedRoles.length > 0;
                
                if (rolesChanged && this.roleConflictService) {
                    await this.roleConflictService.handleRoleChange(
                        freshNewMember.user.id,
                        freshNewMember.guild.id,
                        oldRoleIds,
                        newRoleIds
                    );
                }
            }
            
            // Usunięto system zarządzania rolami TOP - EndersEcho już to obsługuje
            
        } catch (error) {
            logger.error(`❌ Błąd w handleGuildMemberUpdate dla ${newMember.user.tag}:`, error);
        }
    }


    /**
     * Obsługuje grupy ekskluzywnych ról - STARY SYSTEM (ZAKOMENTOWANY)
     * @param {GuildMember} oldMember - Stary członek
     * @param {GuildMember} newMember - Nowy członek
     */
    async handleExclusiveRoleGroups(oldMember, newMember) {
        // ===== STARY SYSTEM OBSŁUGI KOLIZJI RÓL - ZAKOMENTOWANY =====
        // Zastąpiony przez RoleConflictService z persistent storage i timer-based approach
        
        /* 
        try {
            // Grupa 1: Role główne (może mieć tylko jedną) - wszystkie 5 ról są wzajemnie wykluczające
            const mainRoles = ['1170331604846120980', '1193124672070484050', '1200053198472359987', '1262785926984237066', '1173760134527324270'];
            
            // Grupa 2: Role pomocnicze (może mieć tylko jedną)
            const secondaryRoles = ['1194249987677229186', '1196805078162616480', '1210265548584132648', '1262793135860355254'];

            logger.info(`🔍 Sprawdzenie ról ekskluzywnych dla ${newMember.displayName}`);

            // Pobierz świeże dane użytkownika aby mieć aktualne role
            const freshMember = await newMember.guild.members.fetch(newMember.id);
            const currentRoleIds = freshMember.roles.cache.map(role => role.id);
            
            logger.info(`📋 Wszystkie aktualne role użytkownika: ${currentRoleIds.join(', ')}`);
            logger.info(`📋 Role główne w systemie: ${mainRoles.join(', ')}`);
            
            // Sprawdź ile ról głównych użytkownik ma aktualnie
            const userMainRoles = mainRoles.filter(roleId => currentRoleIds.includes(roleId));
            logger.info(`🔍 Użytkownik ma ${userMainRoles.length} ról głównych: ${userMainRoles.join(', ')}`);
            
            // Jeśli użytkownik ma więcej niż jedną rolę główną - usuń wszystkie oprócz najnowszej
            if (userMainRoles.length > 1) {
                logger.info(`⚠️ KONFLIKT: Użytkownik ma ${userMainRoles.length} ról głównych, powinien mieć tylko 1`);
                
                // Sprawdź która rola została ostatnio dodana (porównaj z oldMember)
                const oldRoleIds = oldMember.roles.cache.map(role => role.id);
                const addedMainRoles = userMainRoles.filter(roleId => !oldRoleIds.includes(roleId));
                
                let roleToKeep;
                if (addedMainRoles.length > 0) {
                    // Jeśli któraś z głównych ról została dodana, zostaw najnowszą
                    roleToKeep = addedMainRoles[addedMainRoles.length - 1];
                    logger.info(`✅ Zostawiam najnowszą dodaną rolę główną: ${roleToKeep}`);
                } else {
                    // Jeśli żadna główna rola nie została dodana, zostaw pierwszą z listy
                    roleToKeep = userMainRoles[0];
                    logger.info(`✅ Zostawiam pierwszą rolę główną: ${roleToKeep}`);
                }
                
                // Usuń wszystkie inne role główne
                const rolesToRemove = userMainRoles.filter(roleId => roleId !== roleToKeep);
                logger.info(`🗑️ Rozpoczynam usuwanie ${rolesToRemove.length} konfliktowych ról głównych: ${rolesToRemove.join(', ')}`);
                
                for (const roleId of rolesToRemove) {
                    try {
                        logger.info(`🔄 Próba usunięcia roli ${roleId}...`);
                        await freshMember.roles.remove(roleId);
                        logger.info(`✅ Usunięto konfliktową główną rolę ${roleId} (pozostawiono ${roleToKeep})`);
                    } catch (error) {
                        logger.error(`❌ Błąd usuwania konfliktowej głównej roli ${roleId}:`, error?.message || 'Nieznany błąd');
                    }
                }
                logger.info(`🏁 Zakończono rozwiązywanie konfliktu ról głównych`);
            } else if (userMainRoles.length === 1) {
                logger.info(`✅ Użytkownik ma dokładnie 1 rolę główną - brak konfliktów`);
            } else {
                logger.info(`ℹ️ Użytkownik nie ma żadnej roli głównej`);
            }

            // Sprawdź role pomocnicze
            const userSecondaryRoles = secondaryRoles.filter(roleId => currentRoleIds.includes(roleId));
            logger.info(`🔍 Użytkownik ma ${userSecondaryRoles.length} ról pomocniczych: ${userSecondaryRoles.join(', ')}`);
            
            if (userSecondaryRoles.length > 1) {
                logger.info(`⚠️ KONFLIKT: Użytkownik ma ${userSecondaryRoles.length} ról pomocniczych, powinien mieć maksymalnie 1`);
                
                // Sprawdź która rola pomocnicza została ostatnio dodana
                const oldRoleIds = oldMember.roles.cache.map(role => role.id);
                const addedSecondaryRoles = userSecondaryRoles.filter(roleId => !oldRoleIds.includes(roleId));
                
                let roleToKeep;
                if (addedSecondaryRoles.length > 0) {
                    roleToKeep = addedSecondaryRoles[addedSecondaryRoles.length - 1];
                    logger.info(`✅ Zostawiam najnowszą dodaną rolę pomocniczą: ${roleToKeep}`);
                } else {
                    roleToKeep = userSecondaryRoles[0];
                    logger.info(`✅ Zostawiam pierwszą rolę pomocniczą: ${roleToKeep}`);
                }
                
                const rolesToRemove = userSecondaryRoles.filter(roleId => roleId !== roleToKeep);
                for (const roleId of rolesToRemove) {
                    try {
                        await freshMember.roles.remove(roleId);
                        logger.info(`✅ Usunięto konfliktową rolę pomocniczą ${roleId} (pozostawiono ${roleToKeep})`);
                    } catch (error) {
                        logger.error(`❌ Błąd usuwania konfliktowej roli pomocniczej ${roleId}:`, error?.message || 'Nieznany błąd');
                    }
                }
            } else if (userSecondaryRoles.length === 1) {
                logger.info(`✅ Użytkownik ma dokładnie 1 rolę pomocniczą - brak konfliktów`);
            }

        } catch (error) {
            logger.error('❌ Błąd obsługi grup ekskluzywnych ról:', error?.message || 'Nieznany błąd');
        }
        */

        logger.info(`📝 STARY SYSTEM: handleExclusiveRoleGroups zostało zakomentowane - używa się RoleConflictService`);
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