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

        // System kolejkowania zapisów
        this.saveQueue = [];
        this.isSaving = false;

        // Deduplikacja eventów
        this.recentEvents = new Map(); // userId -> { timestamp, premiumSince }
        this.eventCooldown = 5000; // 5 sekund cooldown

        // Cooldown powiadomień boost
        this.lastNotificationTime = new Map(); // userId -> timestamp
        this.notificationCooldown = 30000; // 30 sekund cooldown dla powiadomień

        // Automatyczne czyszczenie starych eventów co 10 minut
        setInterval(() => {
            this.cleanupOldEvents();
        }, 10 * 60 * 1000);
    }

    /**
     * Inicjalizuje serwis i ładuje cache z pliku
     */
    async initialize(client) {
        try {
            this.client = client;

            // Ładuj cache z pliku
            await this.loadCacheFromFile();

            // Zbuduj początkowy cache
            const buildSuccess = await this.buildInitialCache();

            if (!buildSuccess) {
                this.logger.warn('⚠️ Budowanie cache nie powiodło się całkowicie - kontynuuję z częściowym cache');
            }

            // Wykonaj health check
            const healthOk = await this.healthCheck();

            if (!healthOk) {
                this.logger.error('❌ Health check nie powiódł się po inicjalizacji');
            }

            this.logger.info(`✅ MemberCacheService zainicjalizowany - ${this.memberBoostCache.size} wpisów w cache`);

        } catch (error) {
            this.logger.error('❌ Krytyczny błąd podczas inicjalizacji MemberCacheService:', error);

            // Próba ostatecznego recovery
            try {
                await this.recoverCache();
            } catch (recoveryError) {
                this.logger.error('❌ Recovery także się nie powiódło:', recoveryError);
            }
        }
    }

    /**
     * Czyści stare eventy z mapy deduplikacji i stare powiadomienia
     */
    cleanupOldEvents() {
        const now = Date.now();
        let cleanedEvents = 0;
        let cleanedNotifications = 0;

        // Czyść stare eventy deduplikacji
        for (const [userId, eventData] of this.recentEvents.entries()) {
            if (now - eventData.timestamp > this.eventCooldown * 2) {
                this.recentEvents.delete(userId);
                cleanedEvents++;
            }
        }

        // Czyść stare powiadomienia (cztery razy dłużej niż cooldown)
        for (const [userId, timestamp] of this.lastNotificationTime.entries()) {
            if (now - timestamp > this.notificationCooldown * 4) {
                this.lastNotificationTime.delete(userId);
                cleanedNotifications++;
            }
        }

        // Loguj tylko gdy rzeczywiście coś zostało wyczyszczone
        if (cleanedEvents > 0 || cleanedNotifications > 0) {
            this.logger.info(`🧹 Wyczyszczono ${cleanedEvents} eventów, ${cleanedNotifications} powiadomień. Cache: ${this.memberBoostCache.size} członków`);
        }
    }

    /**
     * Waliduje dane cache
     */
    validateCacheData(cacheData) {
        if (!cacheData || typeof cacheData !== 'object') {
            throw new Error('Cache data is not an object');
        }

        let validEntries = 0;
        let invalidEntries = 0;

        for (const [userId, memberData] of Object.entries(cacheData)) {
            try {
                // Waliduj userId
                if (!userId || typeof userId !== 'string' || !/^\d+$/.test(userId)) {
                    invalidEntries++;
                    continue;
                }

                // Waliduj memberData
                if (!memberData || typeof memberData !== 'object') {
                    invalidEntries++;
                    continue;
                }

                // Waliduj premiumSince
                if (memberData.premiumSince !== null &&
                    (typeof memberData.premiumSince !== 'string' ||
                     isNaN(Date.parse(memberData.premiumSince)))) {
                    invalidEntries++;
                    continue;
                }

                validEntries++;
            } catch (error) {
                invalidEntries++;
            }
        }

        if (invalidEntries > 0) {
            this.logger.warn(`⚠️ Walidacja cache: ${validEntries} poprawnych, ${invalidEntries} niepoprawnych wpisów`);
        }

        return { validEntries, invalidEntries };
    }

    /**
     * Ładuje cache z pliku z walidacją
     */
    async loadCacheFromFile() {
        try {
            const data = await fs.readFile(this.cacheFilePath, 'utf8');

            if (!data.trim()) {
                this.logger.info('📁 Plik cache boost jest pusty - inicjalizuję nowy');
                this.memberBoostCache = new Map();
                return;
            }

            const cacheData = JSON.parse(data);

            // Waliduj dane
            this.validateCacheData(cacheData);

            // Konwertuj obiekt na Map i przywróć daty
            for (const [userId, memberData] of Object.entries(cacheData)) {
                try {
                    // Dodatkowa walidacja na poziomie konwersji
                    if (!userId || typeof memberData !== 'object') continue;

                    const boostData = {
                        premiumSince: memberData.premiumSince ? new Date(memberData.premiumSince) : null
                    };

                    // Sprawdź czy data jest poprawna
                    if (boostData.premiumSince && isNaN(boostData.premiumSince.getTime())) {
                        this.logger.warn(`⚠️ Niepoprawna data dla użytkownika ${userId}, pomijam`);
                        continue;
                    }

                    this.memberBoostCache.set(userId, boostData);
                } catch (entryError) {
                    this.logger.warn(`⚠️ Błąd przetwarzania wpisu ${userId}:`, entryError.message);
                }
            }

            this.logger.info(`📁 Załadowano cache boost: ${this.memberBoostCache.size} wpisów`);

        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.info('📁 Plik cache boost nie istnieje - będzie utworzony');
                this.memberBoostCache = new Map();
            } else {
                this.logger.error('❌ Błąd podczas ładowania cache boost:', error.message);
                this.logger.warn('🔄 Inicjalizuję nowy cache z powodu błędów');
                this.memberBoostCache = new Map();

                // Stwórz backup uszkodzonego pliku
                try {
                    const backupPath = this.cacheFilePath + '.backup.' + Date.now();
                    await fs.copyFile(this.cacheFilePath, backupPath);
                    this.logger.info(`💾 Utworzono backup uszkodzonego cache: ${backupPath}`);
                } catch (backupError) {
                    this.logger.error('❌ Nie udało się utworzyć backup:', backupError.message);
                }
            }
        }
    }

    /**
     * Kolejkuje zapis cache do pliku (thread-safe)
     */
    async queueSaveToFile() {
        return new Promise((resolve, reject) => {
            this.saveQueue.push({ resolve, reject });
            this.processSaveQueue();
        });
    }

    /**
     * Przetwarza kolejkę zapisów
     */
    async processSaveQueue() {
        if (this.isSaving || this.saveQueue.length === 0) {
            return;
        }

        this.isSaving = true;

        try {
            // Wykonaj zapis
            await this.saveCacheToFile();

            // Rozwiąż wszystkie oczekujące promise
            while (this.saveQueue.length > 0) {
                const { resolve } = this.saveQueue.shift();
                resolve();
            }
        } catch (error) {
            // Odrzuć wszystkie oczekujące promise
            while (this.saveQueue.length > 0) {
                const { reject } = this.saveQueue.shift();
                reject(error);
            }
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Zapisuje cache do pliku z walidacją
     */
    async saveCacheToFile() {
        try {
            // Konwertuj Map na obiekt z walidacją
            const cacheObject = {};
            let validEntries = 0;
            let invalidEntries = 0;

            for (const [userId, boostData] of this.memberBoostCache.entries()) {
                try {
                    // Waliduj wpis przed zapisem
                    if (!userId || typeof userId !== 'string' || !/^\d+$/.test(userId)) {
                        invalidEntries++;
                        continue;
                    }

                    if (!boostData || typeof boostData !== 'object') {
                        invalidEntries++;
                        continue;
                    }

                    // Waliduj premiumSince
                    let premiumSinceISO = null;
                    if (boostData.premiumSince) {
                        if (boostData.premiumSince instanceof Date && !isNaN(boostData.premiumSince.getTime())) {
                            premiumSinceISO = boostData.premiumSince.toISOString();
                        } else {
                            this.logger.warn(`⚠️ Niepoprawna data dla użytkownika ${userId} podczas zapisu`);
                            invalidEntries++;
                            continue;
                        }
                    }

                    cacheObject[userId] = {
                        premiumSince: premiumSinceISO
                    };
                    validEntries++;

                } catch (entryError) {
                    this.logger.warn(`⚠️ Błąd walidacji wpisu ${userId} podczas zapisu:`, entryError.message);
                    invalidEntries++;
                }
            }

            if (invalidEntries > 0) {
                this.logger.warn(`⚠️ Zapis cache: ${validEntries} poprawnych, ${invalidEntries} niepoprawnych wpisów`);
            }

            // Zapisz z atomowością (tmp file → rename)
            const tmpPath = this.cacheFilePath + '.tmp';
            await fs.writeFile(tmpPath, JSON.stringify(cacheObject, null, 2));
            await fs.rename(tmpPath, this.cacheFilePath);

        } catch (error) {
            this.logger.error('❌ Błąd podczas zapisywania cache boost:', error.message);
            throw error;
        }
    }

    /**
     * Buduje początkowy cache wszystkich członków
     */
    async buildInitialCache() {
        if (!this.client) {
            this.logger.error('❌ Klient Discord nie jest dostępny');
            return false;
        }

        try {
            this.logger.info('🏗️ Budowanie początkowego cache boost członków...');
            let totalCached = 0;
            let totalErrors = 0;

            for (const guild of this.client.guilds.cache.values()) {
                try {
                    // Spróbuj pobrać wszystkich członków z retry
                    let members;
                    let retryCount = 0;
                    const maxRetries = 3;

                    while (retryCount < maxRetries) {
                        try {
                            members = await guild.members.fetch({ limit: 1000 });
                            break;
                        } catch (fetchError) {
                            retryCount++;
                            if (retryCount === maxRetries) {
                                throw fetchError;
                            }
                            this.logger.warn(`⚠️ Próba ${retryCount}/${maxRetries} pobrania członków z ${guild.name}: ${fetchError.message}`);
                            await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Exponential backoff
                        }
                    }

                    // Przetwórz członków
                    for (const member of members.values()) {
                        try {
                            const boostData = {
                                premiumSince: member.premiumSince
                            };
                            this.memberBoostCache.set(member.user.id, boostData);
                            totalCached++;
                        } catch (memberError) {
                            totalErrors++;
                            this.logger.warn(`⚠️ Błąd przetwarzania członka ${member.user?.id}: ${memberError.message}`);
                        }
                    }

                    this.logger.info(`✅ Zbudowano cache boost dla ${members.size} członków z ${guild.name}`);

                } catch (guildError) {
                    totalErrors++;
                    this.logger.error(`❌ Błąd pobierania członków z ${guild.name}:`, guildError.message);
                }
            }

            this.logger.info(`🎯 Łącznie w cache boost: ${totalCached} członków (${totalErrors} błędów)`);

            // Zapisz do pliku z error handling
            try {
                await this.queueSaveToFile();
            } catch (saveError) {
                this.logger.error('❌ Nie udało się zapisać początkowego cache:', saveError.message);
                return false;
            }

            return totalCached > 0;

        } catch (error) {
            this.logger.error('❌ Krytyczny błąd podczas budowania cache boost:', error);
            return false;
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

        // Zapisz do pliku używając systemu kolejkowania (async, nie czekamy)
        this.queueSaveToFile().catch(error => {
            this.logger.error('❌ Błąd podczas kolejkowania zapisu cache boost po aktualizacji:', error);
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
     * Sprawdza czy event jest duplikatem (deduplikacja)
     */
    isDuplicateEvent(userId, currentPremiumSince) {
        const now = Date.now();
        const recentEvent = this.recentEvents.get(userId);

        if (!recentEvent) {
            return false;
        }

        // Sprawdź czy event jest w cooldown
        if (now - recentEvent.timestamp < this.eventCooldown) {
            // Sprawdź czy dane są identyczne
            const oldDate = recentEvent.premiumSince;
            const newDate = currentPremiumSince;

            // Porównaj daty (null safe)
            const areDatesEqual = (oldDate === null && newDate === null) ||
                                 (oldDate !== null && newDate !== null &&
                                  oldDate.getTime() === newDate.getTime());

            if (areDatesEqual) {
                return true; // Duplikat
            }
        }

        return false;
    }

    /**
     * Rejestruje event w systemie deduplikacji
     */
    registerEvent(userId, premiumSince) {
        this.recentEvents.set(userId, {
            timestamp: Date.now(),
            premiumSince: premiumSince
        });
    }

    /**
     * Sprawdza czy można wysłać powiadomienie boost (cooldown)
     */
    canSendNotification(userId) {
        const lastNotification = this.lastNotificationTime.get(userId);
        if (!lastNotification) {
            return true;
        }

        const now = Date.now();
        return (now - lastNotification) >= this.notificationCooldown;
    }

    /**
     * Rejestruje wysłanie powiadomienia boost
     */
    registerNotification(userId) {
        this.lastNotificationTime.set(userId, Date.now());
    }

    /**
     * Główna funkcja obsługi zmiany członka
     */
    async handleMemberUpdate(oldMember, newMember) {
        try {
            // Podstawowa walidacja parametrów
            if (!newMember || !newMember.user || !newMember.user.id) {
                this.logger.warn('⚠️ Nieprawidłowe dane newMember w handleMemberUpdate');
                return {
                    changed: false,
                    changeType: null,
                    wasBooster: false,
                    isBooster: false,
                    member: newMember,
                    canNotify: false,
                    error: 'invalid_member'
                };
            }

            const userId = newMember.user.id;

            // Sprawdź zdrowie cache przed kontynuacją
            if (!this.memberBoostCache || !(this.memberBoostCache instanceof Map)) {
                this.logger.error('❌ Cache jest uszkodzony w handleMemberUpdate - próba recovery');
                const recoverySuccess = await this.recoverCache();
                if (!recoverySuccess) {
                    return {
                        changed: false,
                        changeType: null,
                        wasBooster: false,
                        isBooster: false,
                        member: newMember,
                        canNotify: false,
                        error: 'cache_corrupted'
                    };
                }
            }

            // Pobierz rzeczywiste nowe dane z retry
            let freshMember;
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount < maxRetries) {
                try {
                    freshMember = await newMember.guild.members.fetch(userId);
                    break;
                } catch (fetchError) {
                    retryCount++;
                    if (retryCount === maxRetries) {
                        this.logger.warn(`⚠️ Nie udało się pobrać fresh member po ${maxRetries} próbach: ${fetchError.message}`);
                        freshMember = newMember;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            const currentPremiumSince = freshMember.premiumSince;

            // Sprawdź deduplikację PRZED jakąkolwiek dalszą analizą
            if (this.isDuplicateEvent(userId, currentPremiumSince)) {
                return {
                    changed: false,
                    changeType: null,
                    wasBooster: false,
                    isBooster: false,
                    member: freshMember,
                    skipped: 'duplicate',
                    canNotify: false
                };
            }

            // Pobierz poprzedni status z NASZEGO cache (nie z oldMember!)
            const previousBoostData = this.getPreviousBoostStatus(userId);
            const previousPremiumSince = previousBoostData.premiumSince;

            // Porównaj
            const changes = this.compareBoostStatus(previousPremiumSince, currentPremiumSince);

            // Zarejestruj event w systemie deduplikacji
            this.registerEvent(userId, currentPremiumSince);

            // Aktualizuj cache z error handling
            try {
                await this.updateMemberBoostStatus(userId, currentPremiumSince);
            } catch (updateError) {
                this.logger.error(`❌ Błąd aktualizacji cache dla ${userId}:`, updateError.message);
                // Kontynuuj mimo błędu zapisu
            }

            // Sprawdź czy można wysłać powiadomienie
            const canNotify = changes.changed ? this.canSendNotification(userId) : false;

            // Loguj tylko faktyczne zmiany boost
            if (changes.changed) {
                this.logger.info(`[BOOST] ${newMember.user.tag} - był booster: ${changes.wasBooster}, jest booster: ${changes.isBooster}${canNotify ? '' : ' (cooldown powiadomienia)'}`);
            }

            return {
                changed: changes.changed,
                changeType: changes.changeType,
                wasBooster: changes.wasBooster,
                isBooster: changes.isBooster,
                member: freshMember,
                canNotify: canNotify
            };

        } catch (error) {
            this.logger.error(`❌ Krytyczny błąd w handleMemberUpdate boost cache:`, error);

            // Próba recovery w przypadku krytycznego błędu
            try {
                await this.healthCheck();
            } catch (healthError) {
                this.logger.error('❌ Health check też się nie powiódł:', healthError);
            }

            return {
                changed: false,
                changeType: null,
                wasBooster: false,
                isBooster: false,
                member: newMember,
                canNotify: false,
                error: 'critical_error'
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
     * Próbuje odzyskać cache po błędzie krytycznym
     */
    async recoverCache() {
        try {
            this.logger.warn('🔄 Rozpoczynanie recovery cache boost...');

            // Wyczyść zepsute dane
            this.memberBoostCache.clear();
            this.recentEvents.clear();
            this.lastNotificationTime.clear();

            // Spróbuj załadować z pliku
            await this.loadCacheFromFile();

            // Jeśli cache jest pusty, zbuduj od nowa
            if (this.memberBoostCache.size === 0) {
                this.logger.warn('⚠️ Cache pusty po recovery - przebudowa z API Discord');
                await this.buildInitialCache();
            }

            this.logger.info(`✅ Recovery cache zakończone. Załadowano ${this.memberBoostCache.size} wpisów`);
            return true;

        } catch (error) {
            this.logger.error('❌ Nie udało się odzyskać cache:', error);

            // Ostatnia szansa - pusta inicjalizacja
            this.memberBoostCache = new Map();
            this.recentEvents = new Map();
            this.lastNotificationTime = new Map();

            return false;
        }
    }

    /**
     * Sprawdza zdrowie cache i próbuje naprawić problemy
     */
    async healthCheck() {
        try {
            // Sprawdź podstawowe struktury
            if (!this.memberBoostCache || !(this.memberBoostCache instanceof Map)) {
                this.logger.error('❌ memberBoostCache jest uszkodzony');
                return await this.recoverCache();
            }

            if (!this.recentEvents || !(this.recentEvents instanceof Map)) {
                this.logger.warn('⚠️ recentEvents jest uszkodzony - resetowanie');
                this.recentEvents = new Map();
            }

            if (!this.lastNotificationTime || !(this.lastNotificationTime instanceof Map)) {
                this.logger.warn('⚠️ lastNotificationTime jest uszkodzony - resetowanie');
                this.lastNotificationTime = new Map();
            }

            // Sprawdź czy możemy zapisać
            try {
                await this.queueSaveToFile();
            } catch (saveError) {
                this.logger.error('❌ Nie można zapisać cache - próba recovery');
                return await this.recoverCache();
            }

            return true;

        } catch (error) {
            this.logger.error('❌ Błąd podczas health check:', error);
            return await this.recoverCache();
        }
    }

    /**
     * Czyści cache (przy wyłączaniu bota)
     */
    async cleanup() {
        try {
            // Ostatni zapis przed zamknięciem
            await this.queueSaveToFile();

            // Wyczyść mapy
            this.memberBoostCache.clear();
            this.recentEvents.clear();
            this.lastNotificationTime.clear();

            this.logger.info('🧹 Cache boost wyczyszczony');
        } catch (error) {
            this.logger.error('❌ Błąd podczas cleanup cache:', error);
        }
    }
}

module.exports = MemberCacheService;