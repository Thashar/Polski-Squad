const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('NicknameManager');

/**
 * Centralny serwis zarządzania nickami użytkowników
 * Zapobiega konfliktom między efektami różnych botów (klątwy/flagi)
 * Zapewnia przywracanie oryginalnych nicków serwerowych
 */
class NicknameManagerService {
    constructor() {
        // Singleton pattern - zapobiega wielokrotnym instancjom
        if (NicknameManagerService.instance) {
            return NicknameManagerService.instance;
        }
        
        this.dataPath = path.join(__dirname, '../shared_data');
        this.activeEffectsFile = path.join(this.dataPath, 'active_nickname_effects.json');
        this.configFile = path.join(this.dataPath, 'nickname_manager_config.json');
        
        // Mapa aktywnych efektów: userId -> effectData
        this.activeEffects = new Map();
        
        // Konfiguracja domyślna
        this.config = {
            buildInitialDatabase: false,
            enableSnapshotting: false,
            monitorNicknameChanges: false,
            cleanupInterval: 24 * 60 * 60 * 1000, // 24h
            maxEffectDuration: 30 * 24 * 60 * 60 * 1000 // 30 dni
        };
        
        // Ustaw singleton instance
        NicknameManagerService.instance = this;
    }
    
    // Stałe typów efektów
    static EFFECTS = {
        CURSE: 'curse',        // Klątwa z Konklawe
        FLAG: 'flag'           // Flaga z Muteusz
    };
    
    /**
     * Pobiera singleton instancję
     */
    static getInstance() {
        if (!NicknameManagerService.instance) {
            new NicknameManagerService();
        }
        return NicknameManagerService.instance;
    }
    
    /**
     * Inicjalizuje serwis - tworzy katalogi i ładuje dane
     */
    async initialize() {
        try {
            // Utwórz katalog jeśli nie istnieje
            await fs.mkdir(this.dataPath, { recursive: true });
            
            // Załaduj konfigurację
            await this.loadConfig();
            
            // Załaduj aktywne efekty
            await this.loadActiveEffects();
            
            // Uruchom automatyczne czyszczenie
            this.startCleanupInterval();
            
            logger.info('✅ NicknameManager zainicjalizowany');
        } catch (error) {
            logger.error('❌ Błąd inicjalizacji NicknameManager:', error);
            throw error;
        }
    }
    
    /**
     * Ładuje konfigurację z pliku
     */
    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configFile, 'utf8');
            this.config = { ...this.config, ...JSON.parse(configData) };
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - utwórz domyślną konfigurację
                await this.saveConfig();
                logger.info('📁 Utworzono domyślną konfigurację NicknameManager');
            } else {
                logger.error('❌ Błąd ładowania konfiguracji:', error);
            }
        }
    }
    
    /**
     * Zapisuje konfigurację do pliku
     */
    async saveConfig() {
        try {
            await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
        } catch (error) {
            logger.error('❌ Błąd zapisywania konfiguracji:', error);
        }
    }
    
    /**
     * Ładuje aktywne efekty z pliku
     */
    async loadActiveEffects() {
        try {
            const data = await fs.readFile(this.activeEffectsFile, 'utf8');
            const effectsData = JSON.parse(data);
            
            // Konwertuj obiekt z powrotem na Map
            this.activeEffects = new Map();
            for (const [userId, effectData] of Object.entries(effectsData)) {
                // Sprawdź czy efekt nie wygasł
                if (effectData.expiresAt && effectData.expiresAt < Date.now()) {
                    logger.info(`🧹 Usuwam wygasły efekt dla użytkownika ${userId}`);
                    continue;
                }
                
                this.activeEffects.set(userId, effectData);
            }
            
            logger.info(`📂 Załadowano ${this.activeEffects.size} aktywnych efektów`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - zacznij z pustą mapą
                this.activeEffects = new Map();
                logger.info('📁 Rozpoczynam z pustą bazą efektów');
            } else {
                logger.error('❌ Błąd ładowania efektów:', error);
                this.activeEffects = new Map();
            }
        }
    }
    
    /**
     * Zapisuje aktywne efekty do pliku
     */
    async persistActiveEffects() {
        try {
            const effectsObject = {};
            for (const [userId, effectData] of this.activeEffects.entries()) {
                effectsObject[userId] = effectData;
            }
            
            await fs.writeFile(this.activeEffectsFile, JSON.stringify(effectsObject, null, 2));
        } catch (error) {
            logger.error('❌ Błąd zapisywania efektów:', error);
        }
    }
    
    /**
     * Pobiera aktualny nick serwerowy użytkownika
     */
    getCurrentServerNickname(member) {
        return member.nickname; // null jeśli używa nick główny
    }
    
    /**
     * Sprawdza czy nick jest nickiem efektu (klątwy/flagi)
     */
    isEffectNickname(nickname) {
        if (!nickname) return false;
        
        // Wzorce nicków efektów
        const cursePattern = /^Przeklęty /;
        const flagNicknames = [
            "Slava Ukrainu!",
            "POLSKA GUROM!",
            "עם ישראל חי!",
            "American Dream",
            "Hände hoch!",
            "Cyka blyat!"
        ];
        
        return cursePattern.test(nickname) || flagNicknames.includes(nickname);
    }
    
    /**
     * Sprawdza czy użytkownik ma aktywny efekt
     */
    hasActiveEffect(userId) {
        const effectData = this.activeEffects.get(userId);
        if (!effectData) return false;
        
        // Sprawdź czy nie wygasł
        if (effectData.expiresAt && effectData.expiresAt < Date.now()) {
            // Efekt wygasł - usuń go
            this.activeEffects.delete(userId);
            this.persistActiveEffects();
            return false;
        }
        
        return true;
    }
    
    /**
     * Pobiera typ aktywnego efektu użytkownika
     */
    getActiveEffectType(userId) {
        const effectData = this.activeEffects.get(userId);
        return effectData ? effectData.effectType : null;
    }
    
    /**
     * Waliduje czy można aplikować efekt
     * NOWA LOGIKA: Pozwala na nakładanie efektów, zachowując oryginalny nick
     */
    async validateEffectApplication(member, effectType) {
        const userId = member.user.id;
        
        // KRYTYCZNE: Przeładuj dane z pliku przed walidacją (synchronizacja między procesami)
        await this.loadActiveEffects();
        
        // 1. Sprawdź czy to nie jest próba podwójnego efektu tego samego typu
        const currentNickname = member.displayName;
        const existingEffect = this.activeEffects.get(userId);
        
        if (existingEffect && existingEffect.effectType === effectType) {
            return {
                canApply: false,
                reason: `Użytkownik ma już aktywny efekt tego typu: ${effectType}`
            };
        }
        
        // 2. Sprawdź specyficzne przypadki duplikacji
        if (effectType === NicknameManagerService.EFFECTS.CURSE && currentNickname.startsWith('Przeklęty ')) {
            return {
                canApply: false,
                reason: `Użytkownik ma już klątwę`
            };
        }
        
        // 3. NOWE: Efekty różnych typów mogą się nakładać
        // System zachowa oryginalny nick z pierwszego efektu
        
        return { canApply: true };
    }
    
    /**
     * Zapisuje oryginalny nick przed aplikowaniem efektu
     * NOWA LOGIKA: Przy nakładaniu efektów zachowuje oryginalny nick z pierwszego
     */
    async saveOriginalNickname(userId, effectType, member, durationMs) {
        // Walidacja (już zawiera loadActiveEffects())
        const validation = await this.validateEffectApplication(member, effectType);
        if (!validation.canApply) {
            throw new Error(validation.reason);
        }
        
        // Ponownie przeładuj dane na wypadek zmiany między walidacją a zapisem
        await this.loadActiveEffects();
        const existingEffect = this.activeEffects.get(userId);
        let originalNickname, wasUsingMainNick;
        
        if (existingEffect) {
            // NAKŁADANIE: Zachowaj oryginalny nick z pierwszego efektu
            originalNickname = existingEffect.originalNickname;
            wasUsingMainNick = existingEffect.wasUsingMainNick;
            logger.info(`🔄 Nakładanie efektu ${effectType} na ${existingEffect.effectType} - zachowuję oryginalny nick: "${originalNickname || '[nick główny]'}"}`);
        } else {
            // PIERWSZY EFEKT: Zapisz aktualny nick jako oryginalny
            originalNickname = this.getCurrentServerNickname(member);
            wasUsingMainNick = originalNickname === null;
            logger.info(`💾 Zapisano oryginalny nick dla ${member.user.tag}: "${originalNickname || '[nick główny]'}" (pierwszy efekt: ${effectType})`);
        }
        
        const effectData = {
            effectType,
            originalNickname,
            wasUsingMainNick,
            appliedAt: Date.now(),
            expiresAt: durationMs === Infinity ? null : Date.now() + durationMs,
            guildId: member.guild.id,
            username: member.user.username,
            previousEffect: existingEffect ? existingEffect.effectType : null // Śledzenie historii
        };
        
        this.activeEffects.set(userId, effectData);
        await this.persistActiveEffects();
        
        return effectData;
    }
    
    /**
     * Przywraca oryginalny nick użytkownika
     */
    async restoreOriginalNickname(userId, guild) {
        const effectData = this.activeEffects.get(userId);
        if (!effectData) {
            logger.warn(`⚠️ Brak danych efektu dla użytkownika ${userId}`);
            return false;
        }
        
        try {
            const member = await guild.members.fetch(userId);
            
            // Przywróć dokładnie to co było
            if (effectData.wasUsingMainNick) {
                // Użytkownik miał nick główny - resetuj do null
                await member.setNickname(null);
                logger.info(`🔄 Przywrócono nick główny dla ${member.user.tag}`);
            } else {
                // Użytkownik miał nick serwerowy - przywróć go
                await member.setNickname(effectData.originalNickname);
                logger.info(`🔄 Przywrócono nick serwerowy "${effectData.originalNickname}" dla ${member.user.tag}`);
            }
            
            // Usuń z systemu
            this.activeEffects.delete(userId);
            await this.persistActiveEffects();
            return true;
            
        } catch (error) {
            logger.error(`❌ Błąd przywracania nicku dla ${userId}:`, error);
            return false;
        }
    }
    
    /**
     * Pobiera informacje o aktywnym efekcie użytkownika
     */
    getEffectInfo(userId) {
        const effectData = this.activeEffects.get(userId);
        if (!effectData) return null;
        
        // Sprawdź czy nie wygasł
        if (effectData.expiresAt && effectData.expiresAt < Date.now()) {
            this.activeEffects.delete(userId);
            this.persistActiveEffects();
            return null;
        }
        
        return {
            effectType: effectData.effectType,
            appliedAt: effectData.appliedAt,
            expiresAt: effectData.expiresAt,
            originalNickname: effectData.originalNickname,
            wasUsingMainNick: effectData.wasUsingMainNick
        };
    }
    
    /**
     * Usuwa efekt użytkownika (np. gdy admin ręcznie usuwa flagę)
     */
    async removeEffect(userId) {
        if (this.activeEffects.has(userId)) {
            this.activeEffects.delete(userId);
            await this.persistActiveEffects();
            logger.info(`🗑️ Usunięto efekt dla użytkownika ${userId}`);
            return true;
        }
        return false;
    }
    
    /**
     * Czyści wygasłe efekty
     */
    async cleanupExpiredEffects() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [userId, effectData] of this.activeEffects.entries()) {
            if (effectData.expiresAt && effectData.expiresAt < now) {
                this.activeEffects.delete(userId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            await this.persistActiveEffects();
            logger.info(`🧹 Wyczyszczono ${cleaned} wygasłych efektów`);
        }
        
        return cleaned;
    }
    
    /**
     * Uruchamia automatyczne czyszczenie w interwałach
     */
    startCleanupInterval() {
        setInterval(async () => {
            await this.cleanupExpiredEffects();
        }, this.config.cleanupInterval);
        
        logger.info(`🔄 Uruchomiono automatyczne czyszczenie (co ${this.config.cleanupInterval / (60 * 1000)} minut)`);
    }
    
    /**
     * Pobiera statystyki systemu
     */
    getStats() {
        const stats = {
            totalActiveEffects: this.activeEffects.size,
            curses: 0,
            flags: 0
        };
        
        for (const effectData of this.activeEffects.values()) {
            if (effectData.effectType === NicknameManagerService.EFFECTS.CURSE) {
                stats.curses++;
            } else if (effectData.effectType === NicknameManagerService.EFFECTS.FLAG) {
                stats.flags++;
            }
        }
        
        return stats;
    }
    
    /**
     * Wyłącza serwis - zapisuje dane
     */
    async shutdown() {
        try {
            await this.persistActiveEffects();
            await this.saveConfig();
            logger.info('💾 NicknameManager - dane zapisane przed wyłączeniem');
        } catch (error) {
            logger.error('❌ Błąd podczas wyłączania NicknameManager:', error);
        }
    }
}

module.exports = NicknameManagerService;