const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

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
            const data = await fs.readFile(this.cacheFilePath, 'utf8');
            const cacheData = JSON.parse(data);
            
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
            
            await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheObject, null, 2));
            
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
                
                this.logger.info(`✅ Zbudowano cache dla ${members.size} członków z ${guild.name}`);
            }
            
            this.logger.info(`🎯 Łącznie w cache: ${totalCached} członków`);
            
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
        
        // Zapisz do pliku (async, nie czekamy)
        this.saveCacheToFile().catch(error => {
            this.logger.error('❌ Błąd podczas zapisywania cache po aktualizacji:', error);
        });
        
        return previousRoles;
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
            
            // Loguj tylko jeśli są zmiany - bez szczegółów wszystkich ról
            if (changes.changed) {
                if (changes.added.length > 0) {
                    this.logger.info(`➕ Dodane role: ${changes.added.join(', ')}`);
                }
                if (changes.removed.length > 0) {
                    this.logger.info(`➖ Usunięte role: ${changes.removed.join(', ')}`);
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
        await this.saveCacheToFile();
        this.memberRolesCache.clear();
    }
}

module.exports = MemberCacheService;