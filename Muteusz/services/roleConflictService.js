const { safeParse } = require('../../utils/safeJSON');
const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

class RoleConflictService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('Muteusz');
        
        // Mapa aktywnych timerów sprawdzania konfliktów
        this.conflictCheckTimers = new Map();
        
        // Przechowuje dane o timerach dla persystencji
        this.persistentTimers = [];
        
        // Konfiguracja grup ekskluzywnych ról
        this.exclusiveRoleGroups = {
            main: ['1170331604846120980', '1193124672070484050', '1200053198472359987', '1262785926984237066', '1173760134527324270'],
            secondary: ['1194249987677229186', '1196805078162616480', '1210265548584132648', '1262793135860355254']
        };
        
        // Czas opóźnienia sprawdzania konfliktów (5 sekund - daje czas na seryjne zmiany ról np. z Rekrutera)
        this.conflictCheckDelay = 5 * 1000;
        
        // Ścieżka do pliku z aktywnymi timerami
        this.timersFilePath = path.join(__dirname, '../data/role_conflict_timers.json');
        
        // Klient Discord (zostanie ustawiony w initialize)
        this.client = null;

        // Debounce zapisu timerów - max 1 zapis co 5 sekund
        this.saveDebounceTimer = null;
        this.saveDebounceDelay = 5000;
    }

    /**
     * Inicjalizuje serwis i przywraca timery z pliku
     */
    async initialize(client) {
        this.client = client;
        await this.restoreTimersFromFile();
    }

    /**
     * Ładuje i przywraca timery z pliku
     */
    async restoreTimersFromFile() {
        try {
            const data = await fs.readFile(this.timersFilePath, 'utf8');
            const timersData = safeParse(data, {});
            
            let restoredCount = 0;
            let expiredCount = 0;
            const currentTime = Date.now();
            const stillActiveTimers = [];
            
            for (const timerInfo of timersData) {
                const { userId, guildId, expiresAt, groups, oldRoles } = timerInfo;
                
                // Sprawdź czy timer nie wygasł
                if (expiresAt <= currentTime) {
                    // Timer już wygasł - sprawdź konflikty natychmiast
                    await this.checkRoleConflicts(userId, guildId, groups, true, oldRoles || []);
                    expiredCount++;
                    continue;
                }
                
                // Oblicz pozostały czas
                const remainingTime = expiresAt - currentTime;
                
                // Ustaw timer na pozostały czas
                const timerKey = `${userId}-${guildId}`;
                const timer = setTimeout(async () => {
                    await this.checkRoleConflicts(userId, guildId, groups, true, oldRoles || []);
                    await this.removeTimerFromPersistence(userId, guildId);
                }, remainingTime);
                
                this.conflictCheckTimers.set(timerKey, timer);
                stillActiveTimers.push(timerInfo);
                restoredCount++;
            }
            
            // Zaktualizuj listę aktywnych timerów
            this.persistentTimers = stillActiveTimers;
            await this.saveTimersToFile();
            
            this.logger.info(`🔄 Przywrócono ${restoredCount} timerów konfliktów ról, sprawdzono ${expiredCount} wygasłych`);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.info('📁 Plik timerów konfliktów nie istnieje - będzie utworzony przy pierwszym użyciu');
                this.persistentTimers = [];
            } else {
                this.logger.error('❌ Błąd podczas przywracania timerów konfliktów:', error);
                this.persistentTimers = [];
            }
        }
    }

    /**
     * Obsługuje zmianę ról użytkownika - ustawia timer sprawdzania konfliktów
     */
    async handleRoleChange(userId, guildId, oldRoles, newRoles) {
        try {
            // Sprawdź które grupy mogą być dotknięte
            const affectedGroups = [];
            
            for (const [groupName, groupRoles] of Object.entries(this.exclusiveRoleGroups)) {
                const hasOldGroupRole = oldRoles.some(roleId => groupRoles.includes(roleId));
                const hasNewGroupRole = newRoles.some(roleId => groupRoles.includes(roleId));
                
                if (hasOldGroupRole || hasNewGroupRole) {
                    affectedGroups.push(groupName);
                }
            }
            
            if (affectedGroups.length === 0) {
                return; // Cichy return dla grup nie-ekskluzywnych
            }
            
            // Ustaw timer sprawdzania konfliktów (bez logowania)
            await this.setConflictCheckTimer(userId, guildId, affectedGroups, oldRoles);
            
        } catch (error) {
            this.logger.error(`❌ Błąd podczas obsługi zmiany ról:`, error);
        }
    }

    /**
     * Ustawia timer sprawdzania konfliktów ról
     */
    async setConflictCheckTimer(userId, guildId, groups, oldRoles = []) {
        const timerKey = `${userId}-${guildId}`;
        const expiresAt = Date.now() + this.conflictCheckDelay;
        
        // Anuluj poprzedni timer jeśli istnieje
        if (this.conflictCheckTimers.has(timerKey)) {
            clearTimeout(this.conflictCheckTimers.get(timerKey));
        }

        // Dodaj do persystencji
        await this.addTimerToPersistence(userId, guildId, expiresAt, groups, oldRoles);

        // Ustaw nowy timer
        const timer = setTimeout(async () => {
            try {
                // Pobierz informacje o starych rolach z persystencji
                const timerInfo = this.persistentTimers.find(t => t.userId === userId && t.guildId === guildId);
                const oldRoles = timerInfo ? timerInfo.oldRoles : [];
                
                await this.checkRoleConflicts(userId, guildId, groups, false, oldRoles);
                
                // Usuń timer z mapy i persystencji
                this.conflictCheckTimers.delete(timerKey);
                await this.removeTimerFromPersistence(userId, guildId);
                
            } catch (error) {
                this.logger.error(`❌ Błąd podczas sprawdzania konfliktów ról:`, error);
                this.conflictCheckTimers.delete(timerKey);
                await this.removeTimerFromPersistence(userId, guildId);
            }
        }, this.conflictCheckDelay);

        this.conflictCheckTimers.set(timerKey, timer);
        // Usuń logowanie timerów - za dużo noise
    }

    /**
     * Sprawdza i rozwiązuje konflikty ról - znajduje najnowszą dodaną rolę i usuwa pozostałe
     */
    async checkRoleConflicts(userId, guildId, groups, expired = false, oldRoles = []) {
        try {
            if (!this.client) {
                this.logger.error('❌ Klient Discord nie jest dostępny');
                return;
            }

            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) {
                this.logger.error(`❌ Nie można znaleźć serwera o ID: ${guildId}`);
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                this.logger.warn(`⚠️ Nie można znaleźć członka o ID: ${userId}`);
                return;
            }

            const currentRoleIds = member.roles.cache.map(role => role.id);

            // Sprawdź czy użytkownik dostał rolę klanową (main) - jeśli tak, usuń role rekrutacyjne (secondary)
            if (groups.includes('main') && oldRoles && oldRoles.length > 0) {
                const mainRoles = this.exclusiveRoleGroups.main;
                const secondaryRoles = this.exclusiveRoleGroups.secondary;

                // Sprawdź czy dodano nową rolę z grupy main
                const addedMainRoles = mainRoles.filter(roleId =>
                    currentRoleIds.includes(roleId) && !oldRoles.includes(roleId)
                );

                if (addedMainRoles.length > 0) {
                    // Usuń wszystkie role rekrutacyjne (secondary)
                    const secondaryToRemove = secondaryRoles.filter(roleId => currentRoleIds.includes(roleId));

                    if (secondaryToRemove.length > 0) {
                        const removedNames = secondaryToRemove.map(roleId =>
                            guild.roles.cache.get(roleId)?.name || `ID:${roleId}`
                        );
                        const addedName = guild.roles.cache.get(addedMainRoles[0])?.name || `ID:${addedMainRoles[0]}`;

                        this.logger.info(`🎯 ${member.user.tag} otrzymał rolę klanową "${addedName}" - usuwam role rekrutacyjne: ${removedNames.join(', ')}`);

                        for (const roleId of secondaryToRemove) {
                            try {
                                await member.roles.remove(roleId);
                            } catch (error) {
                                this.logger.error(`❌ Błąd usuwania roli rekrutacyjnej ${roleId}:`, error);
                            }
                        }
                    }
                }
            }

            // Sprawdź każdą grupę ekskluzywną - LOGUJ TYLKO KONFLIKTY
            for (const groupName of groups) {
                const groupRoles = this.exclusiveRoleGroups[groupName];
                if (!groupRoles) continue;

                const userGroupRoles = groupRoles.filter(roleId => currentRoleIds.includes(roleId));
                
                if (userGroupRoles.length > 1) {
                    // KONFLIKT WYKRYTY - loguj szczegółowo
                    
                    let roleToKeep;
                    
                    if (oldRoles && oldRoles.length > 0) {
                        // Znajdź najnowszą dodaną rolę (która nie była w oldRoles)
                        const addedGroupRoles = userGroupRoles.filter(roleId => !oldRoles.includes(roleId));
                        
                        if (addedGroupRoles.length > 0) {
                            // Zostaw najnowszą dodaną rolę z grupy
                            roleToKeep = addedGroupRoles[addedGroupRoles.length - 1];
                        } else {
                            // Jeśli żadna rola nie została dodana, zostaw pierwszą z listy
                            roleToKeep = userGroupRoles[0];
                        }
                    } else {
                        // Fallback - zostaw pierwszą rolę z listy
                        roleToKeep = userGroupRoles[0];
                    }
                    
                    // Usuń wszystkie inne role z grupy
                    const rolesToRemove = userGroupRoles.filter(roleId => roleId !== roleToKeep);
                    
                    // Pobierz nazwy ról dla czytelnego loga
                    const keptRoleName = guild.roles.cache.get(roleToKeep)?.name || `ID:${roleToKeep}`;
                    const removedRoleNames = rolesToRemove.map(roleId => {
                        return guild.roles.cache.get(roleId)?.name || `ID:${roleId}`;
                    });
                    
                    // GŁÓWNY LOG KONFLIKTU
                    this.logger.info(`⚔️ KONFLIKT ról ${groupName} dla ${member.user.tag}: zachowano "${keptRoleName}", usunięto ${removedRoleNames.join(', ')}`);
                    
                    for (const roleId of rolesToRemove) {
                        try {
                            await member.roles.remove(roleId);
                        } catch (error) {
                            this.logger.error(`❌ Błąd usuwania roli ${roleId}:`, error);
                        }
                    }
                }
                // Nie loguj braku konfliktów - za dużo noise
            }

        } catch (error) {
            this.logger.error(`❌ Błąd podczas sprawdzania konfliktów ról:`, error);
        }
    }

    /**
     * Zapisuje timery do pliku
     */
    async saveTimersToFile() {
        try {
            await fs.writeFile(this.timersFilePath, JSON.stringify(this.persistentTimers, null, 2));
        } catch (error) {
            this.logger.error('❌ Błąd podczas zapisywania timerów konfliktów:', error);
        }
    }

    /**
     * Debounced save - grupuje wiele zmian w jeden zapis
     */
    debouncedSaveTimers() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            this.saveTimersToFile();
        }, this.saveDebounceDelay);
    }

    /**
     * Dodaje timer do persystencji
     */
    async addTimerToPersistence(userId, guildId, expiresAt, groups, oldRoles = []) {
        const timerInfo = { userId, guildId, expiresAt, groups, oldRoles };

        // Usuń ewentualny poprzedni timer dla tego użytkownika
        this.persistentTimers = this.persistentTimers.filter(
            timer => !(timer.userId === userId && timer.guildId === guildId)
        );

        // Dodaj nowy timer
        this.persistentTimers.push(timerInfo);
        this.debouncedSaveTimers();
    }

    /**
     * Usuwa timer z persystencji
     */
    async removeTimerFromPersistence(userId, guildId) {
        this.persistentTimers = this.persistentTimers.filter(
            timer => !(timer.userId === userId && timer.guildId === guildId)
        );
        this.debouncedSaveTimers();
    }

    /**
     * Czyści wszystkie aktywne timery (przy wyłączaniu bota)
     */
    async cleanup() {
        this.logger.info(`🧹 Czyszczenie ${this.conflictCheckTimers.size} aktywnych timerów konfliktów ról`);

        // Wymuś natychmiastowy zapis jeśli jest oczekujący
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
            await this.saveTimersToFile();
        }

        for (const timer of this.conflictCheckTimers.values()) {
            clearTimeout(timer);
        }

        this.conflictCheckTimers.clear();
    }

    /**
     * Zwraca statystyki aktywnych timerów
     */
    getStats() {
        return {
            activeTimers: this.conflictCheckTimers.size,
            persistentTimers: this.persistentTimers.length,
            exclusiveGroups: Object.keys(this.exclusiveRoleGroups).length
        };
    }
}

module.exports = RoleConflictService;