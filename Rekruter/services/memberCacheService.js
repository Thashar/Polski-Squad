const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

class MemberCacheService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('Rekruter');
        
        // Cache statusu boost członków w pamięci
        this.memberBoostCache = new Map(); // userId -> { premiumSince: Date|null }
        
        // Ścieżka do pliku cache
        this.cacheFilePath = path.join(__dirname, '../data/member_boost_cache.json');
        
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
            
            // Konwertuj obiekt na Map i przywróć daty
            for (const [userId, memberData] of Object.entries(cacheData)) {
                const boostData = {
                    premiumSince: memberData.premiumSince ? new Date(memberData.premiumSince) : null
                };
                this.memberBoostCache.set(userId, boostData);
            }
            
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.info('📁 Plik cache boost nie istnieje - będzie utworzony');
                this.memberBoostCache = new Map();
            } else {
                this.logger.error('❌ Błąd podczas ładowania cache boost:', error);
                this.memberBoostCache = new Map();
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
            for (const [userId, boostData] of this.memberBoostCache.entries()) {
                cacheObject[userId] = {
                    premiumSince: boostData.premiumSince ? boostData.premiumSince.toISOString() : null
                };
            }
            
            await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheObject, null, 2));
            
        } catch (error) {
            this.logger.error('❌ Błąd podczas zapisywania cache boost:', error);
        }
    }

    /**
     * Buduje początkowy cache wszystkich członków
     */
    async buildInitialCache() {
        if (!this.client) return;
        
        try {
            this.logger.info('🏗️ Budowanie początkowego cache boost członków...');
            let totalCached = 0;
            
            for (const guild of this.client.guilds.cache.values()) {
                const members = await guild.members.fetch({ limit: 1000 });
                
                for (const member of members.values()) {
                    const boostData = {
                        premiumSince: member.premiumSince
                    };
                    this.memberBoostCache.set(member.user.id, boostData);
                    totalCached++;
                }
                
                this.logger.info(`✅ Zbudowano cache boost dla ${members.size} członków z ${guild.name}`);
            }
            
            this.logger.info(`🎯 Łącznie w cache boost: ${totalCached} członków`);
            
            // Zapisz do pliku
            await this.saveCacheToFile();
            
        } catch (error) {
            this.logger.error('❌ Błąd podczas budowania cache boost:', error);
        }
    }

    /**
     * Pobiera poprzedni status boost członka z cache
     */
    getPreviousBoostStatus(userId) {
        return this.memberBoostCache.get(userId) || { premiumSince: null };
    }

    /**
     * Aktualizuje status boost członka w cache
     */
    async updateMemberBoostStatus(userId, newPremiumSince) {
        const previousBoostData = this.memberBoostCache.get(userId) || { premiumSince: null };
        
        // Aktualizuj cache
        this.memberBoostCache.set(userId, { premiumSince: newPremiumSince });
        
        // Zapisz do pliku (async, nie czekamy)
        this.saveCacheToFile().catch(error => {
            this.logger.error('❌ Błąd podczas zapisywania cache boost po aktualizacji:', error);
        });
        
        return previousBoostData;
    }

    /**
     * Porównuje status boost i zwraca zmiany
     */
    compareBoostStatus(oldPremiumSince, newPremiumSince) {
        const wasBooster = !!oldPremiumSince;
        const isBooster = !!newPremiumSince;
        
        let changeType = null;
        if (!wasBooster && isBooster) {
            changeType = 'gained';
        } else if (wasBooster && !isBooster) {
            changeType = 'lost';
        }
        
        return {
            wasBooster,
            isBooster,
            changed: changeType !== null,
            changeType
        };
    }

    /**
     * Główna funkcja obsługi zmiany członka
     */
    async handleMemberUpdate(oldMember, newMember) {
        try {
            const userId = newMember.user.id;
            
            // Pobierz rzeczywiste nowe dane
            let freshMember;
            try {
                freshMember = await newMember.guild.members.fetch(userId);
            } catch (fetchError) {
                freshMember = newMember;
            }
            
            const currentPremiumSince = freshMember.premiumSince;
            
            // Pobierz poprzedni status z NASZEGO cache (nie z oldMember!)
            const previousBoostData = this.getPreviousBoostStatus(userId);
            const previousPremiumSince = previousBoostData.premiumSince;
            
            // Porównaj
            const changes = this.compareBoostStatus(previousPremiumSince, currentPremiumSince);
            
            // Aktualizuj cache
            await this.updateMemberBoostStatus(userId, currentPremiumSince);
            
            // Loguj zmiany boost
            this.logger.info(`[BOOST] Sprawdzanie ${newMember.user.tag} - był booster: ${changes.wasBooster}, jest booster: ${changes.isBooster}`);
            
            return {
                changed: changes.changed,
                changeType: changes.changeType,
                wasBooster: changes.wasBooster,
                isBooster: changes.isBooster,
                member: freshMember
            };
            
        } catch (error) {
            this.logger.error(`❌ Błąd w handleMemberUpdate boost cache:`, error);
            return {
                changed: false,
                changeType: null,
                wasBooster: false,
                isBooster: false,
                member: newMember
            };
        }
    }

    /**
     * Zwraca statystyki cache
     */
    getStats() {
        const boosters = Array.from(this.memberBoostCache.values()).filter(data => data.premiumSince !== null);
        return {
            cachedMembers: this.memberBoostCache.size,
            currentBoosters: boosters.length
        };
    }

    /**
     * Czyści cache (przy wyłączaniu bota)
     */
    async cleanup() {
        await this.saveCacheToFile();
        this.memberBoostCache.clear();
    }
}

module.exports = MemberCacheService;