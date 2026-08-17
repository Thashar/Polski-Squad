const { safeParse } = require('../../utils/safeJSON');
const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');
const store = require('../../utils/jsonStore');

class MemberCacheService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('Muteusz');

        // Cache ról członków w pamięci
        this.memberRolesCache = new Map(); // userId -> roleIds[]

        // Ścieżka do pliku cache
        this.cacheFilePath = path.join(__dirname, '../data/member_roles_cache.json');

        // Klient Discord
        this.client = null;

        // ID kanału do logowania zmian ról
        this.roleChangeLogChannelId = '1407485227927998545';

        // Debounce zapisu - max 1 zapis co 5 sekund
        this.saveDebounceTimer = null;
        this.saveDebounceDelay = 5000;
    }

    /**
     * Inicjalizuje serwis i ładuje cache z pliku
     */
    async initialize(client) {
        this.client = client;
        await this.loadCacheFromFile();
        await this.buildInitialCache();
    }

    /**
     * Ładuje cache z pliku
     */
    async loadCacheFromFile() {
        try {
            const cacheData = await store.getOrLoad(this.cacheFilePath, () => ({}));
            
            // Konwertuj obiekt na Map
            for (const [userId, roleIds] of Object.entries(cacheData)) {
                this.memberRolesCache.set(userId, roleIds);
            }
            
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.info('📁 Plik cache ról nie istnieje - będzie utworzony');
                this.memberRolesCache = new Map();
            } else {
                this.logger.error('❌ Błąd podczas ładowania cache ról:', error);
                this.memberRolesCache = new Map();
            }
        }
    }

    /**
     * Zapisuje cache do pliku
     */
    async saveCacheToFile() {
        try {
            // Konwertuj Map na obiekt
            const cacheObject = {};
            for (const [userId, roleIds] of this.memberRolesCache.entries()) {
                cacheObject[userId] = roleIds;
            }
            
            await store.set(this.cacheFilePath, cacheObject);
            
        } catch (error) {
            this.logger.error('❌ Błąd podczas zapisywania cache ról:', error);
        }
    }

    /**
     * Buduje początkowy cache wszystkich członków
     */
    async buildInitialCache() {
        if (!this.client) return;
        
        try {
            this.logger.info('🏗️ Budowanie początkowego cache ról członków...');
            let totalCached = 0;
            
            for (const guild of this.client.guilds.cache.values()) {
                const members = await guild.members.fetch({ limit: 1000 });
                
                for (const member of members.values()) {
                    const roleIds = member.roles.cache.map(role => role.id);
                    this.memberRolesCache.set(member.user.id, roleIds);
                    totalCached++;
                }
                
                // Cache zbudowany pomyślnie
            }

            // Cache gotowy
            
            // Zapisz do pliku
            await this.saveCacheToFile();
            
        } catch (error) {
            this.logger.error('❌ Błąd podczas budowania cache ról:', error);
        }
    }

    /**
     * Pobiera poprzednie role członka z cache
     */
    getPreviousRoles(userId) {
        return this.memberRolesCache.get(userId) || [];
    }

    /**
     * Aktualizuje role członka w cache
     */
    async updateMemberRoles(userId, newRoleIds) {
        const previousRoles = this.memberRolesCache.get(userId) || [];
        
        // Aktualizuj cache
        this.memberRolesCache.set(userId, [...newRoleIds]);
        
        // Zapisz do pliku z debounce (max 1 zapis co 5s)
        this.debouncedSave();
        
        return previousRoles;
    }

    /**
     * Debounced save - grupuje wiele zmian w jeden zapis
     */
    debouncedSave() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            this.saveCacheToFile().catch(error => {
                this.logger.error('❌ Błąd podczas zapisywania cache po aktualizacji:', error);
            });
        }, this.saveDebounceDelay);
    }

    /**
     * Porównuje role i zwraca zmiany
     */
    compareRoles(oldRoleIds, newRoleIds) {
        const addedRoles = newRoleIds.filter(id => !oldRoleIds.includes(id));
        const removedRoles = oldRoleIds.filter(id => !newRoleIds.includes(id));
        
        return {
            added: addedRoles,
            removed: removedRoles,
            changed: addedRoles.length > 0 || removedRoles.length > 0
        };
    }

    /**
     * Główna funkcja obsługi zmiany członka
     */
    async handleMemberUpdate(oldMember, newMember) {
        try {
            const userId = newMember.user.id;

            // Pobierz rzeczywiste nowe role
            let freshMember;
            try {
                freshMember = await newMember.guild.members.fetch(userId);
            } catch (fetchError) {
                freshMember = newMember;
            }

            const currentRoleIds = freshMember.roles.cache.map(role => role.id);

            // Pobierz poprzednie role z NASZEGO cache (nie z oldMember!)
            const previousRoleIds = this.getPreviousRoles(userId);

            // Porównaj
            const changes = this.compareRoles(previousRoleIds, currentRoleIds);

            // Aktualizuj cache
            await this.updateMemberRoles(userId, currentRoleIds);

            // Loguj tylko jeśli są zmiany - z nazwami ról zamiast ID
            if (changes.changed) {
                const memberDisplayName = freshMember.displayName;
                const memberTag = freshMember.user.tag;

                if (changes.added.length > 0) {
                    const addedRoleNames = changes.added.map(roleId => {
                        const role = freshMember.guild.roles.cache.get(roleId);
                        return role ? role.name : `ID:${roleId}`;
                    });
                    this.logger.info(`➕ ${memberDisplayName} - Dodane role: ${addedRoleNames.join(', ')}`);

                    // Wyślij log na kanał Discord
                    await this.logRoleChangeToChannel(freshMember, addedRoleNames, 'added');
                }
                if (changes.removed.length > 0) {
                    const removedRoleNames = changes.removed.map(roleId => {
                        const role = freshMember.guild.roles.cache.get(roleId);
                        return role ? role.name : `ID:${roleId}`;
                    });
                    this.logger.info(`➖ ${memberDisplayName} - Usunięte role: ${removedRoleNames.join(', ')}`);

                    // Wyślij log na kanał Discord
                    await this.logRoleChangeToChannel(freshMember, removedRoleNames, 'removed');
                }
            }

            return {
                changed: changes.changed,
                previousRoles: previousRoleIds,
                currentRoles: currentRoleIds,
                added: changes.added,
                removed: changes.removed,
                member: freshMember
            };

        } catch (error) {
            this.logger.error(`❌ Błąd w handleMemberUpdate cache:`, error);
            return {
                changed: false,
                previousRoles: [],
                currentRoles: [],
                added: [],
                removed: [],
                member: newMember
            };
        }
    }

    /**
     * Loguje zmianę ról na kanał Discord
     * @param {GuildMember} member - Członek serwera
     * @param {Array} roleNames - Nazwy ról
     * @param {string} type - Typ zmiany ('added' lub 'removed')
     */
    async logRoleChangeToChannel(member, roleNames, type) {
        try {
            if (!this.client) {
                return;
            }

            const channel = this.client.channels.cache.get(this.roleChangeLogChannelId);
            if (!channel) {
                this.logger.warn(`⚠️ Nie znaleziono kanału logów zmian ról: ${this.roleChangeLogChannelId}`);
                return;
            }

            const emoji = type === 'added' ? '➕' : '➖';
            const action = type === 'added' ? 'Dodane role' : 'Usunięte role';
            const rolesText = roleNames.join(', ');

            const message = `${emoji} **${member.displayName}** (${member.user.tag}) - ${action}: ${rolesText}`;

            await channel.send(message);
        } catch (error) {
            this.logger.error(`❌ Błąd logowania zmian ról na kanał: ${error.message}`);
        }
    }

    /**
     * Zwraca statystyki cache
     */
    getStats() {
        return {
            cachedMembers: this.memberRolesCache.size,
            averageRolesPerMember: this.memberRolesCache.size > 0 ? 
                Array.from(this.memberRolesCache.values()).reduce((sum, roles) => sum + roles.length, 0) / this.memberRolesCache.size : 0
        };
    }

    /**
     * Czyści cache (przy wyłączaniu bota)
     */
    async cleanup() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        await this.saveCacheToFile();
        this.memberRolesCache.clear();
    }
}

module.exports = MemberCacheService;