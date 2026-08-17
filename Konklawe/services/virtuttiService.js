const { createBotLogger } = require('../../utils/consoleLogger');
const store = require('../../utils/jsonStore');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Konklawe');

class VirtuttiService {
    constructor(config) {
        this.config = config;
        this.cooldowns = new Map(); // userId -> { blessing: timestamp, virtueCheck: timestamp, curse: timestamp }
        this.dailyUsage = new Map(); // userId -> { date: string, blessing: count, virtueCheck: count, curse: count }

        // === NOWY SYSTEM ENERGII ===
        this.energySystem = new Map(); // userId -> { energy: number, lastRegeneration: timestamp, dailyCurses: number, date: string, roleType: string }
        this.userRoles = new Map(); // userId -> 'gabriel' | 'lucyfer'

        // Lucyfer - nowy dynamiczny system
        this.lucyferData = new Map(); // userId -> { cost, regenTimeMs, lastTarget, targetHistory, successStreak, failStreak, lastRegeneration, curseCount }
        this.lucyferCurses = new Map(); // userId -> { cursesThrown: count, reflectionChance: number } (bez date - ciągła gra)
        this.lucyferTargetCooldowns = new Map(); // userId -> Map(targetId -> timestamp)
        this.lucyferCurseBlocked = new Map(); // userId -> timestamp (blokada na 1h po odbiciu)

        // Lucyfer - Gabriel debuff tracking
        this.lucyferGabrielDebuff = new Map(); // userId -> { endTime: timestamp (24h), initialCurseEndTime: timestamp (5 min) }

        // Gabriel - tracking blessing cooldowns per target
        this.gabrielBlessingCooldowns = new Map(); // userId -> Map(targetId -> timestamp)

        // === NOWY SYSTEM REVENGE ===
        this.revengeEffects = new Map(); // targetUserId -> [{ type: 'lucyfer'|'gabriel', remainingUses: number, expiresAt: timestamp, appliedBy: userId }]
        this.revengeCooldowns = new Map(); // userId -> Map(targetId -> timestamp) // 24h

        // === SYSTEM OCHRONY BŁOGOSŁAWIEŃSTW ===
        this.blessingProtection = new Map(); // userId -> { expiresAt: timestamp, used: boolean }

        // === BLOKADA GABRIELA (Upadły) ===
        this.gabrielBlessingBlocked = new Map(); // userId -> { expiresAt: timestamp }

        // === INFERNAL BARGAIN (Piekielny Układ) ===
        this.infernalBargainActive = new Map(); // userId -> { startedAt, lastCurseAt, lastRegenAt }
        this.infernalBargainCooldowns = new Map(); // userId -> timestamp (24h cooldown)

        // === CHAOS BLESSING (Mroczne Błogosławieństwo) ===
        this.chaosBlessingCooldowns = new Map(); // userId -> timestamp (1h cooldown)
        this.chaosBlessingDebuffs = new Map(); // userId -> { type: 'gabriel_slow_regen' | 'blessing_immunity', expiresAt, appliedBy }

        // Ścieżki do plików danych
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'virtutti_cooldowns.json');
        this.dailyUsageFile = path.join(this.dataDir, 'virtutti_daily_usage.json');
        this.energySystemFile = path.join(this.dataDir, 'energy_system.json');
        this.lucyferDataFile = path.join(this.dataDir, 'lucyfer_data.json');
        this.lucyferCursesFile = path.join(this.dataDir, 'lucyfer_curses.json');
        this.lucyferTargetCooldownsFile = path.join(this.dataDir, 'lucyfer_target_cooldowns.json');
        this.lucyferCurseBlockedFile = path.join(this.dataDir, 'lucyfer_curse_blocked.json');
        this.lucyferGabrielDebuffFile = path.join(this.dataDir, 'lucyfer_gabriel_debuff.json');
        this.gabrielBlessingCooldownsFile = path.join(this.dataDir, 'gabriel_blessing_cooldowns.json');
        this.revengeEffectsFile = path.join(this.dataDir, 'revenge_effects.json');
        this.revengeCooldownsFile = path.join(this.dataDir, 'revenge_cooldowns.json');
        this.blessingProtectionFile = path.join(this.dataDir, 'blessing_protection.json');
        this.gabrielBlessingBlockedFile = path.join(this.dataDir, 'gabriel_blessing_blocked.json');
        this.infernalBargainActiveFile = path.join(this.dataDir, 'infernal_bargain_active.json');
        this.infernalBargainCooldownsFile = path.join(this.dataDir, 'infernal_bargain_cooldowns.json');
        this.chaosBlessingCooldownsFile = path.join(this.dataDir, 'chaos_blessing_cooldowns.json');
        this.chaosBlessingDebuffsFile = path.join(this.dataDir, 'chaos_blessing_debuffs.json');

        // Wczytaj dane przy starcie
        this.loadData();
    }

    /**
     * Pobiera aktualny czas w polskiej strefie czasowej
     * @returns {Date} - Data w polskim czasie
     */
    getPolishTime() {
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
    }

    // ========================================
    // SYSTEM ENERGII
    // ========================================

    /**
     * Pobiera maksymalną ilość many dla użytkownika na podstawie roli
     * @param {string} userId - ID użytkownika
     * @returns {number} - Maksymalna ilość many (Gabriel: 150, Lucyfer: 100)
     */
    getMaxEnergy(userId) {
        const roleType = this.userRoles.get(userId);
        if (roleType === 'gabriel') {
            return 150;
        } else if (roleType === 'lucyfer') {
            return 100;
        }
        // Fallback dla starych użytkowników bez roli
        return 150;
    }

    /**
     * Inicjalizuje energię dla użytkownika (jeśli nie istnieje)
     * @param {string} userId - ID użytkownika
     * @param {string} roleType - 'gabriel' lub 'lucyfer'
     */
    initializeEnergy(userId, roleType = null) {
        if (!this.energySystem.has(userId)) {
            // Zapisz rolę użytkownika
            if (roleType) {
                this.userRoles.set(userId, roleType);
            }

            const maxEnergy = this.getMaxEnergy(userId);
            const today = this.getPolishTime().toDateString();
            this.energySystem.set(userId, {
                energy: maxEnergy, // Start z pełną maną
                lastRegeneration: Date.now(),
                dailyCurses: 0,
                date: today,
                roleType: roleType
            });
            logger.info(`⚡ Zainicjowano energię dla użytkownika ${userId} (${roleType}): ${maxEnergy}/${maxEnergy}`);
        } else if (roleType && !this.userRoles.has(userId)) {
            // Aktualizuj rolę dla istniejącego użytkownika
            this.userRoles.set(userId, roleType);
            const userData = this.energySystem.get(userId);
            userData.roleType = roleType;
        }
    }

    /**
     * Regeneruje energię użytkownika (1 pkt/10min dla Gabriel, 1pkt/10-30min dla Lucyfer)
     * @param {string} userId - ID użytkownika
     */
    regenerateEnergy(userId) {
        const userData = this.energySystem.get(userId);
        if (!userData) return;

        const maxEnergy = this.getMaxEnergy(userId);
        const now = Date.now();
        const minutesSinceLastRegen = (now - userData.lastRegeneration) / (60 * 1000);

        // Sprawdź czy Gabriel ma debuff slow regen (Chaos Blessing)
        const hasSlowRegen = this.hasChaosBlessingDebuff(userId, 'gabriel_slow_regen');
        const regenInterval = hasSlowRegen ? 20 : 10; // 2x wolniejsza regeneracja jeśli debuff
        const energyToRegenerate = Math.floor(minutesSinceLastRegen / regenInterval); // 1 punkt co 10/20 minut (Gabriel)

        if (energyToRegenerate > 0 && userData.energy < maxEnergy) {
            userData.energy = Math.min(maxEnergy, userData.energy + energyToRegenerate);
            // Aktualizuj lastRegeneration z uwzględnieniem reszty czasu
            userData.lastRegeneration = now - ((minutesSinceLastRegen % regenInterval) * 60 * 1000);
            logger.info(`🔋 Regeneracja ${energyToRegenerate} many dla ${userId}. Obecna: ${userData.energy}/${maxEnergy}${hasSlowRegen ? ' (wolna regen)' : ''}`);
            this.saveData();
        }
    }

    /**
     * Oblicza koszt klątwy (progresywny)
     * @param {number} dailyCurses - Liczba klątw rzuconych dzisiaj
     * @returns {number} - Koszt many
     */
    calculateCurseCost(dailyCurses) {
        const baseCost = 10;
        return baseCost + (dailyCurses * 2);
    }

    /**
     * Pobiera obecną energię użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} roleType - Opcjonalnie, rola użytkownika dla inicjalizacji
     * @returns {Object} - { energy, maxEnergy, dailyCurses, nextCurseCost }
     */
    getEnergy(userId, roleType = null) {
        this.initializeEnergy(userId, roleType);

        // Regeneruj manę w zależności od typu użytkownika
        const userRole = roleType || this.userRoles.get(userId);
        if (userRole === 'lucyfer') {
            // Lucyfer ma własny system regeneracji
            this.regenerateLucyferMana(userId);
        } else {
            // Gabriel i Virtutti używają standardowej regeneracji
            this.regenerateEnergy(userId);
        }

        const today = this.getPolishTime().toDateString();
        const userData = this.energySystem.get(userId);
        const maxEnergy = this.getMaxEnergy(userId);

        // Reset dzienny
        if (userData.date !== today) {
            userData.date = today;
            userData.dailyCurses = 0;
        }

        return {
            energy: userData.energy,
            maxEnergy: maxEnergy,
            dailyCurses: userData.dailyCurses,
            nextCurseCost: this.calculateCurseCost(userData.dailyCurses)
        };
    }

    /**
     * Sprawdza czy użytkownik ma wystarczająco many
     * @param {string} userId - ID użytkownika
     * @param {number} cost - Koszt akcji
     * @returns {boolean}
     */
    hasEnoughEnergy(userId, cost) {
        const { energy } = this.getEnergy(userId);
        return energy >= cost;
    }

    /**
     * Zużywa manę użytkownika
     * @param {string} userId - ID użytkownika
     * @param {number} cost - Koszt many
     * @param {string} actionType - 'curse' lub 'blessing'
     * @returns {boolean} - Sukces zużycia
     */
    consumeEnergy(userId, cost, actionType = 'curse') {
        this.initializeEnergy(userId);
        const userData = this.energySystem.get(userId);
        const maxEnergy = this.getMaxEnergy(userId);

        if (userData.energy < cost) {
            return false;
        }

        userData.energy -= cost;

        if (actionType === 'curse') {
            userData.dailyCurses++;
        }

        logger.info(`⚡ ${userId} zużył ${cost} many (${actionType}). Pozostało: ${userData.energy}/${maxEnergy}, klątwy dzisiaj: ${userData.dailyCurses}`);
        this.saveData();
        return true;
    }

    /**
     * Zwraca połowę many (gdy klątwa się nie udaje)
     * @param {string} userId - ID użytkownika
     * @param {number} originalCost - Oryginalny koszt
     */
    refundHalfEnergy(userId, originalCost) {
        this.initializeEnergy(userId);
        const userData = this.energySystem.get(userId);
        const maxEnergy = this.getMaxEnergy(userId);
        const refund = Math.floor(originalCost / 2);

        userData.energy = Math.min(maxEnergy, userData.energy + refund);
        logger.info(`💰 ${userId} otrzymał ${refund} many zwrotu (połowa kosztu). Obecna: ${userData.energy}/${maxEnergy}`);
        this.saveData();
    }

    /**
     * Sprawdza czy użytkownik może użyć komendy
     * @param {string} userId - ID użytkownika
     * @param {string} commandType - 'blessing', 'virtueCheck' lub 'curse'
     * @param {string} roleType - 'virtutti', 'gabriel' lub 'lucyfer'
     * @param {string} targetUserId - ID celu (dla curse Lucyfera)
     * @returns {Object} - { canUse: boolean, reason?: string }
     */
    canUseCommand(userId, commandType, roleType = 'virtutti', targetUserId = null) {
        const now = Date.now();
        const today = this.getPolishTime().toDateString();

        // Gabriel - blessing z cooldownem per target
        if (roleType === 'gabriel' && commandType === 'blessing') {
            // Sprawdź cooldown tylko dla tego samego targetu
            if (targetUserId) {
                const targetCooldowns = this.gabrielBlessingCooldowns.get(userId);
                if (targetCooldowns && targetCooldowns.has(targetUserId)) {
                    const lastBlessingTime = targetCooldowns.get(targetUserId);
                    const timeSince = now - lastBlessingTime;
                    const cooldownMs = 5 * 60 * 1000; // 5 minut

                    if (timeSince < cooldownMs) {
                        const remainingMinutes = Math.ceil((cooldownMs - timeSince) / (60 * 1000));
                        return {
                            canUse: false,
                            reason: `Musisz poczekać jeszcze ${remainingMinutes} minut przed kolejnym błogosławieństwem tej samej osoby.`
                        };
                    }
                }
            }
            return { canUse: true };
        }

        // Lucyfer - specjalna logika curse
        if (roleType === 'lucyfer' && commandType === 'curse') {
            // Sprawdź cooldown tylko dla tego samego targetu
            if (targetUserId) {
                const targetCooldowns = this.lucyferTargetCooldowns.get(userId);
                if (targetCooldowns && targetCooldowns.has(targetUserId)) {
                    const lastCurseTime = targetCooldowns.get(targetUserId);
                    const timeSince = now - lastCurseTime;
                    const cooldownMs = 5 * 60 * 1000; // 5 minut

                    if (timeSince < cooldownMs) {
                        const remainingMinutes = Math.ceil((cooldownMs - timeSince) / (60 * 1000));
                        return {
                            canUse: false,
                            reason: `Musisz poczekać jeszcze ${remainingMinutes} minut przed kolejną klątwą na tę samą osobę.`
                        };
                    }
                }
            }
            return { canUse: true };
        }

        // Standardowa logika dla pozostałych (Virtutti/Gabriel)
        // Sprawdź cooldown
        const userCooldowns = this.cooldowns.get(userId);
        if (userCooldowns && userCooldowns[commandType]) {
            const timeSinceLastUse = now - userCooldowns[commandType];
            const cooldownMs = this.config.virtuttiPapajlari.cooldownMinutes * 60 * 1000;

            if (timeSinceLastUse < cooldownMs) {
                const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastUse) / (60 * 1000));
                return {
                    canUse: false,
                    reason: `Musisz poczekać jeszcze ${remainingMinutes} minut przed następnym użyciem.`
                };
            }
        }

        // Sprawdź dzienny limit
        const userDailyUsage = this.dailyUsage.get(userId);
        if (userDailyUsage && userDailyUsage.date === today) {
            if (userDailyUsage[commandType] >= this.config.virtuttiPapajlari.dailyLimit) {
                return {
                    canUse: false,
                    reason: `Osiągnąłeś dzienny limit ${this.config.virtuttiPapajlari.dailyLimit} użyć tej komendy.`
                };
            }
        }

        return { canUse: true };
    }

    /**
     * Rejestruje użycie komendy
     * @param {string} userId - ID użytkownika
     * @param {string} commandType - 'blessing', 'virtueCheck' lub 'curse'
     * @param {string} userTag - Tag użytkownika (username#0000) - opcjonalny
     */
    registerUsage(userId, commandType, userTag = null) {
        const now = Date.now();
        const today = this.getPolishTime().toDateString();

        // Ustaw cooldown
        if (!this.cooldowns.has(userId)) {
            this.cooldowns.set(userId, {});
        }
        this.cooldowns.get(userId)[commandType] = now;

        // Aktualizuj dzienny licznik
        if (!this.dailyUsage.has(userId) || this.dailyUsage.get(userId).date !== today) {
            this.dailyUsage.set(userId, {
                date: today,
                blessing: 0,
                virtueCheck: 0,
                curse: 0
            });
        }
        this.dailyUsage.get(userId)[commandType]++;

        const displayName = userTag || `ID:${userId}`;
        logger.info(`📊 Użytkownik ${displayName} użył komendy ${commandType}. Dzienny użyty: ${this.dailyUsage.get(userId)[commandType]}/${this.config.virtuttiPapajlari.dailyLimit}`);

        // Zapisz dane do pliku po każdym użyciu
        this.saveData();
    }

    /**
     * Zwraca pozostałe użycia komendy w danym dniu
     * @param {string} userId - ID użytkownika
     * @param {string} commandType - 'blessing', 'virtueCheck' lub 'curse'
     * @returns {number} - Liczba pozostałych użyć
     */
    getRemainingUses(userId, commandType) {
        const today = this.getPolishTime().toDateString();
        const userDailyUsage = this.dailyUsage.get(userId);

        if (!userDailyUsage || userDailyUsage.date !== today) {
            return this.config.virtuttiPapajlari.dailyLimit;
        }

        const used = userDailyUsage[commandType] || 0;
        return Math.max(0, this.config.virtuttiPapajlari.dailyLimit - used);
    }

    /**
     * Pobiera losowe błogosławieństwo
     * @returns {string} - Tekstowe błogosławieństwo
     */
    getRandomBlessing() {
        const blessings = this.config.virtuttiPapajlari.blessings;
        return blessings[Math.floor(Math.random() * blessings.length)];
    }

    /**
     * Pobiera losowe cnoty z procentami i opisami
     * @returns {Array} - Lista cnót z procentami i opisami
     */
    getRandomVirtues() {
        const virtues = this.config.virtuttiPapajlari.virtues;
        const selectedVirtues = virtues
            .sort(() => 0.5 - Math.random())
            .slice(0, 3)
            .map(virtue => {
                const percentage = Math.floor(Math.random() * 101);
                return {
                    name: virtue,
                    percentage: percentage,
                    description: this.getVirtueDescription(virtue, percentage)
                };
            });
        
        return selectedVirtues;
    }

    /**
     * Pobiera opis cnoty na podstawie nazwy i procentu
     * @param {string} virtueName - Nazwa cnoty
     * @param {number} percentage - Procent cnoty (0-100)
     * @returns {string} - Opis cnoty
     */
    getVirtueDescription(virtueName, percentage) {
        const descriptions = {
            "Memiczność": {
                high: "Mistrz internetowej kultury! Twoje memy są legendarne.",
                good: "Solidna znajomość memów. Jesteś na bieżąco z trendami.",
                medium: "Podstawowa wiedza memowa. Czasami łapiesz żarty.",
                low: "Memy cię omijają. Potrzebujesz więcej r/dankmemes.",
                veryLow: "Co to jest mem? Musisz nadrobić zaległości."
            },
            "Cierpliwość na Loading": {
                high: "Zen master ładowania! Nie denerwuje cię żaden spinner.",
                good: "Dobrze radzisz sobie z czekaniem na strony.",
                medium: "Czasami tracisz cierpliwość przy 3 sekundach.",
                low: "Klikasz F5 co 2 sekundy. Uspokój się.",
                veryLow: "Twoja cierpliwość = 0ms. Potrzebujesz terapii."
            },
            "Mądrość Googlowania": {
                high: "Google Guru! Znajdziesz wszystko w pierwszym wynikce.",
                good: "Sprawnie nawigujesz po wynikach wyszukiwania.",
                medium: "Potrafisz znaleźć to czego szukasz... czasami.",
                low: "Szukasz 'jak naprawić komputer' w Bingu.",
                veryLow: "Pytasz na forum zamiast googlować. Grzech!"
            },
            "Pokora przed Bugami": {
                high: "Bugi to twoi przyjaciele. Akceptujesz je z godnością.",
                good: "Rozumiesz że błędy to część procesu rozwoju.",
                medium: "Czasami się denerwujesz na niedziałający kod.",
                low: "Każdy bug to dla ciebie osobista obraza.",
                veryLow: "Krzyczysz na monitor. Bug nie słyszy."
            },
            "Wytrwałość w Kolejkach": {
                high: "Kolejki to dla ciebie medytacja. Stoicki spokój.",
                good: "Cierpliwie czekasz, może przeglądasz telefon.",
                medium: "Po 10 minutach zaczynasz się niecierpliwić.",
                low: "Zmieniasz kolejki co 3 minuty szukając szybszej.",
                veryLow: "Kolejka = torture. Zamawiasz wszystko online."
            },
            "Łaska WiFi": {
                high: "Internet nigdy cię nie zawodzi. Magiczne połączenia.",
                good: "Zazwyczaj masz stabilne połączenie.",
                medium: "Czasami musisz resetować router.",
                low: "WiFi cię nie lubi. Często się rozłącza.",
                veryLow: "Internet to twój największy wróg. Dial-up vibes."
            },
            "Cnota Backup'owania": {
                high: "Backup masterclass! Masz kopie swoich kopii.",
                good: "Regularnie robisz kopie ważnych rzeczy.",
                medium: "Pamiętasz o backup'ie... czasami.",
                low: "Backup? Co to takiego? Żyjesz niebezpiecznie.",
                veryLow: "Stracisz wszystko i będziesz płakać. Backup NOW!"
            },
            "Mądrość Update'ów": {
                high: "Update master! Wiesz kiedy aktualizować a kiedy czekać.",
                good: "Rozsądnie podchodzisz do aktualizacji systemu.",
                medium: "Czasami klikasz 'Remind me later' zbyt często.",
                low: "Update'y cię przerażają. Nigdy nie aktualizujesz.",
                veryLow: "Używasz Windows XP w 2025. Help."
            },
            "Pokora przed Autocorrectem": {
                high: "Autocorrect to twój przyjaciel. Akceptujesz jego mądrość.",
                good: "Zazwyczaj poprawki są w porządku.",
                medium: "Czasami autocorrect zmienia sens na absurd.",
                low: "Walczysz z autocorrectem jak z wiatrakami.",
                veryLow: "Ducking autocorrect! (widzisz co zrobił?)"
            },
            "Świętość Dark Mode": {
                high: "Dark mode everywhere! Twoje oczy są błogosławione.",
                good: "Używasz dark mode w większości aplikacji.",
                medium: "Mieszasz light i dark mode zależnie od nastroju.",
                low: "Czasami używasz light mode. Grzech venialny.",
                veryLow: "Light mode only? Twoje oczy potrzebują exorcyzmów!"
            }
        };

        const virtueDescriptions = descriptions[virtueName];
        if (!virtueDescriptions) {
            return "Tajemnicza cnota, której nikt nie potrafi opisać.";
        }

        if (percentage >= 80) return virtueDescriptions.high;
        if (percentage >= 60) return virtueDescriptions.good;
        if (percentage >= 40) return virtueDescriptions.medium;
        if (percentage >= 20) return virtueDescriptions.low;
        return virtueDescriptions.veryLow;
    }

    /**
     * Pobiera losową radę papieską
     * @returns {string} - Rada papieska
     */
    getRandomPapalAdvice() {
        const advice = this.config.virtuttiPapajlari.papalAdvice;
        return advice[Math.floor(Math.random() * advice.length)];
    }

    // ========================================
    // BLOKADA LUCYFERA (PO ODBICIU)
    // ========================================

    /**
     * Blokuje możliwość rzucania klątw przez Lucyfera na 1h
     * @param {string} userId - ID Lucyfera
     */
    blockLucyferCurses(userId) {
        const blockUntil = Date.now() + (60 * 60 * 1000); // 1 godzina
        this.lucyferCurseBlocked.set(userId, blockUntil);
        logger.info(`🚫 Lucyfer ${userId} zablokowany od rzucania klątw na 1h (po odbiciu)`);
        this.saveData();

        // Ustaw timer do dodania 100 many po zakończeniu blokady
        setTimeout(() => {
            this.grantLucyferBlockEndBonus(userId);
        }, 60 * 60 * 1000);
    }

    /**
     * Dodaje 25 many Lucyferowi po zakończeniu blokady
     * @param {string} userId - ID Lucyfera
     */
    grantLucyferBlockEndBonus(userId) {
        // Sprawdź czy użytkownik nadal jest w systemie
        if (!this.energySystem.has(userId)) {
            logger.warn(`⚠️ Nie można dodać bonusu - użytkownik ${userId} nie istnieje w systemie energii`);
            return;
        }

        const userData = this.energySystem.get(userId);
        const maxEnergy = this.getMaxEnergy(userId);
        userData.energy = Math.min(maxEnergy, userData.energy + 25);
        this.saveData();
        logger.info(`✨ Lucyfer ${userId} otrzymał 25 many po zakończeniu blokady. Obecna mana: ${userData.energy}/${maxEnergy}`);
    }

    /**
     * Sprawdza czy Lucyfer ma blokadę na rzucanie klątw
     * @param {string} userId - ID Lucyfera
     * @returns {Object|null} - { blocked: true, remainingMinutes } lub null
     */
    checkLucyferCurseBlock(userId) {
        const blockUntil = this.lucyferCurseBlocked.get(userId);
        if (!blockUntil) return null;

        const now = Date.now();
        if (now >= blockUntil) {
            this.lucyferCurseBlocked.delete(userId);
            this.saveData();
            return null;
        }

        const remainingMs = blockUntil - now;
        const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
        return { blocked: true, remainingMinutes };
    }

    // ========================================
    // POZIOMY KLĄTW (96% / 3% / 1%)
    // ========================================

    /**
     * Losuje poziom klątwy
     * @returns {string} - 'normal' (96%), 'strong' (3%), 'powerful' (1%)
     */
    rollCurseLevel() {
        const roll = Math.random() * 100;

        if (roll < 1) {
            return 'powerful'; // 1%
        } else if (roll < 4) {
            return 'strong'; // 3% (1-4)
        } else {
            return 'normal'; // 96% (4-100)
        }
    }

    /**
     * Pobiera czas trwania klątwy na podstawie poziomu
     * @param {string} level - 'normal', 'strong', 'powerful'
     * @returns {number} - Czas w milisekundach
     */
    getCurseDuration(level) {
        switch (level) {
            case 'normal':
                return 5 * 60 * 1000; // 5 minut
            case 'strong':
                return 15 * 60 * 1000; // 15 minut
            case 'powerful':
                return 30 * 60 * 1000; // 30 minut
            default:
                return 5 * 60 * 1000; // Fallback 5 minut
        }
    }

    /**
     * Pobiera losową klątwę (zawsze nickname + jedna dodatkowa)
     * @returns {Object} - Obiekt z klątwami
     */
    getRandomCurse() {
        const curses = this.config.virtuttiPapajlari.curses;
        const randomCurse = curses[Math.floor(Math.random() * curses.length)];
        
        return {
            nickname: true, // zawsze zmiana nicku
            additional: randomCurse,
            duration: this.config.virtuttiPapajlari.nicknameTime
        };
    }

    /**
     * Rejestruje błogosławieństwo Gabriela
     * @param {string} userId - ID Gabriela
     * @param {string} targetUserId - ID celu
     */
    registerGabrielBlessing(userId, targetUserId) {
        const now = Date.now();

        // Aktualizuj cooldown dla tego targetu
        if (!this.gabrielBlessingCooldowns.has(userId)) {
            this.gabrielBlessingCooldowns.set(userId, new Map());
        }
        this.gabrielBlessingCooldowns.get(userId).set(targetUserId, now);

        logger.info(`☁️ Gabriel ${userId} błogosławi. Cooldown dla targetu ${targetUserId} ustawiony na 5 minut.`);

        this.saveData();
    }

    // ========================================
    // NOWY SYSTEM LUCYFERA - DYNAMICZNA REGENERACJA I KOSZTY
    // ========================================

    /**
     * Inicjalizuje dane Lucyfera
     * @param {string} userId - ID Lucyfera
     */
    initializeLucyferData(userId) {
        if (!this.lucyferData.has(userId)) {
            this.lucyferData.set(userId, {
                cost: 5, // Bazowy koszt 5 many
                regenTimeMs: 10 * 60 * 1000, // Bazowy czas 10 min
                lastTarget: null,
                targetHistory: [], // Ostatnie 10 celów
                successStreak: 0, // Seria sukcesów
                failStreak: 0, // Seria failów
                lastRegeneration: Date.now(),
                curseCount: 0 // Łączna liczba rzuconych klątw (do odbicia)
            });
            logger.info(`🔥 Zainicjowano dane Lucyfera dla ${userId}`);
        }
    }

    /**
     * Regeneruje manę dla Lucyfera z dynamicznym czasem
     * @param {string} userId - ID Lucyfera
     */
    regenerateLucyferMana(userId) {
        const userData = this.energySystem.get(userId);
        const lucyferData = this.lucyferData.get(userId);

        if (!userData || !lucyferData) return;

        const now = Date.now();
        const timeSinceLastRegen = now - lucyferData.lastRegeneration;

        // Ile pełnych jednostek czasu minęło?
        const fullUnits = Math.floor(timeSinceLastRegen / lucyferData.regenTimeMs);

        const maxEnergy = this.getMaxEnergy(userId);
        if (fullUnits > 0 && userData.energy < maxEnergy) {
            userData.energy = Math.min(maxEnergy, userData.energy + fullUnits);
            lucyferData.lastRegeneration = now - (timeSinceLastRegen % lucyferData.regenTimeMs);
            logger.info(`🔋 Regeneracja ${fullUnits} many dla Lucyfera ${userId}. Obecna: ${userData.energy}/${maxEnergy}, czas/jednostkę: ${lucyferData.regenTimeMs / 60000} min`);
            this.saveData();
        }
    }

    /**
     * Aktualizuje czas regeneracji na podstawie targetowania
     * @param {string} userId - ID Lucyfera
     * @param {string} newTargetId - ID nowego celu
     */
    updateLucyferRegenTime(userId, newTargetId) {
        const lucyferData = this.lucyferData.get(userId);
        if (!lucyferData) return;

        const oldRegenTime = lucyferData.regenTimeMs;

        // Czy to ten sam cel co ostatnio?
        if (lucyferData.lastTarget === newTargetId) {
            // Ten sam cel - spowolnienie regeneracji (+1 min, max 30 min)
            lucyferData.regenTimeMs = Math.min(30 * 60 * 1000, lucyferData.regenTimeMs + (1 * 60 * 1000));
            logger.info(`🐌 Lucyfer ${userId} atakuje tego samego celu. Regeneracja: ${oldRegenTime / 60000} → ${lucyferData.regenTimeMs / 60000} min`);
        } else {
            // Inny cel - przyspieszenie regeneracji (-1 min, min 10 min)
            lucyferData.regenTimeMs = Math.max(10 * 60 * 1000, lucyferData.regenTimeMs - (1 * 60 * 1000));
            logger.info(`🏃 Lucyfer ${userId} atakuje inny cel. Regeneracja: ${oldRegenTime / 60000} → ${lucyferData.regenTimeMs / 60000} min`);
        }

        // Aktualizuj lastTarget i historię
        lucyferData.lastTarget = newTargetId;
        lucyferData.targetHistory.unshift(newTargetId);
        if (lucyferData.targetHistory.length > 10) {
            lucyferData.targetHistory = lucyferData.targetHistory.slice(0, 10);
        }

        // NATYCHMIASTOWA ZMIANA - Przyznaj punkt many jeśli czas się zmienił i upłynęło wystarczająco czasu
        this.adjustLucyferRegeneration(userId, oldRegenTime);
    }

    /**
     * Dostosowuje regenerację natychmiast gdy czas się zmienia
     * @param {string} userId - ID Lucyfera
     * @param {number} oldRegenTime - Stary czas regeneracji
     */
    adjustLucyferRegeneration(userId, oldRegenTime) {
        const userData = this.energySystem.get(userId);
        const lucyferData = this.lucyferData.get(userId);
        const maxEnergy = this.getMaxEnergy(userId);

        if (!userData || !lucyferData || userData.energy >= maxEnergy) return;

        const now = Date.now();
        const timeSinceLastRegen = now - lucyferData.lastRegeneration;
        const newRegenTime = lucyferData.regenTimeMs;

        // Jeśli nowy czas jest krótszy i upłynęło więcej niż nowy czas, przyznaj punkty
        if (timeSinceLastRegen >= newRegenTime) {
            const pointsToGrant = Math.floor(timeSinceLastRegen / newRegenTime);
            userData.energy = Math.min(maxEnergy, userData.energy + pointsToGrant);
            lucyferData.lastRegeneration = now - (timeSinceLastRegen % newRegenTime);
            logger.info(`⚡ Natychmiastowa regeneracja ${pointsToGrant} many dla Lucyfera ${userId} po zmianie czasu`);
            this.saveData();
        }
    }

    /**
     * Aktualizuje koszt klątwy na podstawie sukcesów/failów
     * @param {string} userId - ID Lucyfera
     * @param {boolean} success - Czy klątwa się powiodła
     */
    updateLucyferCost(userId, success) {
        const lucyferData = this.lucyferData.get(userId);
        if (!lucyferData) return;

        const oldCost = lucyferData.cost;

        if (success) {
            // Sukces - koszt maleje (-1, min 5)
            lucyferData.cost = Math.max(5, lucyferData.cost - 1);
            lucyferData.successStreak++;
            lucyferData.failStreak = 0;
            logger.info(`✅ Sukces klątwy. Koszt: ${oldCost} → ${lucyferData.cost} many`);
        } else {
            // Fail (odbicie) - koszt rośnie (+5, max 15)
            lucyferData.cost = Math.min(15, lucyferData.cost + 5);
            lucyferData.failStreak++;
            lucyferData.successStreak = 0;
            logger.info(`❌ Fail klątwy (odbicie). Koszt: ${oldCost} → ${lucyferData.cost} many`);
        }

        this.saveData();
    }

    /**
     * Pobiera koszt następnej klątwy dla Lucyfera
     * @param {string} userId - ID Lucyfera
     * @returns {number} - Koszt many
     */
    getLucyferCurseCost(userId) {
        this.initializeLucyferData(userId);
        return this.lucyferData.get(userId).cost;
    }

    /**
     * Pobiera dane Lucyfera dla embeda
     * @param {string} userId - ID Lucyfera
     * @returns {Object} - Szczegółowe dane
     */
    getLucyferStats(userId) {
        this.initializeLucyferData(userId);
        const lucyferData = this.lucyferData.get(userId);

        return {
            cost: lucyferData.cost,
            regenTimeMinutes: lucyferData.regenTimeMs / (60 * 1000),
            successStreak: lucyferData.successStreak,
            failStreak: lucyferData.failStreak,
            curseCount: lucyferData.curseCount,
            reflectionChance: this.getLucyferReflectionChance(userId),
            lastRegeneration: lucyferData.lastRegeneration,
            nextRegenIn: this.getNextLucyferRegenTime(userId)
        };
    }

    /**
     * Pobiera czas do następnej regeneracji
     * @param {string} userId - ID Lucyfera
     * @returns {number} - Czas w milisekundach
     */
    getNextLucyferRegenTime(userId) {
        const lucyferData = this.lucyferData.get(userId);
        if (!lucyferData) return 0;

        const now = Date.now();
        const timeSinceLastRegen = now - lucyferData.lastRegeneration;
        const timeToNext = lucyferData.regenTimeMs - timeSinceLastRegen;

        return Math.max(0, timeToNext);
    }

    /**
     * Rejestruje rzuconą klątwę przez Lucyfera (NOWA WERSJA)
     * @param {string} userId - ID Lucyfera
     * @param {string} targetUserId - ID celu
     */
    registerLucyferCurse(userId, targetUserId) {
        this.initializeLucyferData(userId);
        const now = Date.now();
        const lucyferData = this.lucyferData.get(userId);

        // Aktualizuj tracking klątw (BEZ DATE - ciągła gra)
        if (!this.lucyferCurses.has(userId)) {
            this.lucyferCurses.set(userId, {
                cursesThrown: 0,
                reflectionChance: 0
            });
        }

        const userCurses = this.lucyferCurses.get(userId);
        userCurses.cursesThrown++;
        userCurses.reflectionChance = userCurses.cursesThrown * 1; // 1% za każdą klątwę
        lucyferData.curseCount++;

        // Aktualizuj cooldown dla tego targetu
        if (!this.lucyferTargetCooldowns.has(userId)) {
            this.lucyferTargetCooldowns.set(userId, new Map());
        }
        this.lucyferTargetCooldowns.get(userId).set(targetUserId, now);

        // Aktualizuj czas regeneracji i koszt (sukces - wykonano w interactionHandlers)
        this.updateLucyferRegenTime(userId, targetUserId);

        logger.info(`💀 Lucyfer ${userId} rzucił klątwę. Łącznie: ${userCurses.cursesThrown}, szansa odbicia: ${userCurses.reflectionChance}%`);

        this.saveData();
    }

    /**
     * Pobiera szansę na odbicie klątwy dla Lucyfera (NOWA WERSJA - bez daty)
     * @param {string} userId - ID Lucyfera
     * @returns {number} - Szansa w procentach (0-100)
     */
    getLucyferReflectionChance(userId) {
        const userCurses = this.lucyferCurses.get(userId);

        if (!userCurses) {
            return 0;
        }

        return userCurses.reflectionChance;
    }

    /**
     * Resetuje szansę odbicia konkretnego Lucyfera (wywołane przez Gabriela)
     * @param {string} userId - ID Lucyfera
     */
    resetLucyferReflectionChance(userId) {
        if (this.lucyferCurses.has(userId)) {
            const curseData = this.lucyferCurses.get(userId);
            curseData.cursesThrown = 0;
            curseData.reflectionChance = 0;
            logger.info(`☁️ Gabriel zresetował progresywne odbicie Lucyfera ${userId} do 0%`);
            this.saveData();
        }
    }

    /**
     * USUNIĘTE - Resetuje klątwy Lucyfera (wywoływane o północy)
     * NOWA LOGIKA: Gra ciągła bez resetów o północy
     */
    resetLucyferCursesDaily() {
        // FUNKCJA PUSTA - Lucyfer nie resetuje się o północy
        // Gra jest ciągła
    }

    /**
     * Czyszczenie starych danych (opcjonalne)
     */
    cleanup() {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const today = this.getPolishTime().toDateString();
        let dataChanged = false;

        // Usuń stare cooldowny (starsze niż dzień)
        for (const [userId, cooldowns] of this.cooldowns.entries()) {
            let hasValidCooldown = false;
            for (const [commandType, timestamp] of Object.entries(cooldowns)) {
                if (now - timestamp < oneDayMs) {
                    hasValidCooldown = true;
                    break;
                }
            }
            if (!hasValidCooldown) {
                this.cooldowns.delete(userId);
                dataChanged = true;
            }
        }

        // Usuń stare dzienne użycia
        for (const [userId, usage] of this.dailyUsage.entries()) {
            if (usage.date !== today) {
                this.dailyUsage.delete(userId);
                dataChanged = true;
            }
        }

        // Wyczyść wygasłe Gabriel debuffs na Lucyfera
        for (const [userId, debuffData] of this.lucyferGabrielDebuff.entries()) {
            if (now > debuffData.endTime) {
                this.lucyferGabrielDebuff.delete(userId);
                dataChanged = true;
                logger.info(`🧹 Usunięto wygasły Gabriel debuff dla użytkownika ${userId}`);
            }
        }

        // Resetuj klątwy Lucyfera
        this.resetLucyferCursesDaily();

        // Zapisz dane jeśli coś się zmieniło
        if (dataChanged) {
            this.saveData();
        }
    }

    /**
     * Wczytuje dane z plików JSON
     */
    async loadData() {
        try {
            // Upewnij się że folder data istnieje
            await fs.mkdir(this.dataDir, { recursive: true });

            // Wczytaj cooldowny
            try {
                const parsedCooldowns = await store.getOrLoad(this.cooldownsFile, () => ({}));
                this.cooldowns = new Map(Object.entries(parsedCooldowns));
                logger.info(`📂 Wczytano ${this.cooldowns.size} cooldownów z pliku`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania cooldownów: ${error.message}`);
                }
            }

            // Wczytaj dzienne użycia
            try {
                const parsedDailyUsage = await store.getOrLoad(this.dailyUsageFile, () => ({}));
                this.dailyUsage = new Map(Object.entries(parsedDailyUsage));
                logger.info(`📂 Wczytano ${this.dailyUsage.size} dziennych użyć z pliku`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania dziennych użyć: ${error.message}`);
                }
            }

            // Wczytaj dane Lucyfera - główne dane (NOWY PLIK)
            try {
                const parsedLucyferData = await store.getOrLoad(this.lucyferDataFile, () => ({}));
                this.lucyferData = new Map(Object.entries(parsedLucyferData));
                logger.info(`📂 Wczytano ${this.lucyferData.size} głównych danych Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania głównych danych Lucyfera: ${error.message}`);
                }
            }

            // Wczytaj dane Lucyfera - klątwy
            try {
                const parsedLucyferCurses = await store.getOrLoad(this.lucyferCursesFile, () => ({}));
                this.lucyferCurses = new Map(Object.entries(parsedLucyferCurses));
                logger.info(`📂 Wczytano ${this.lucyferCurses.size} danych klątw Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania danych Lucyfera: ${error.message}`);
                }
            }

            // Wczytaj dane Lucyfera - target cooldowny
            try {
                const parsedTargetCooldowns = await store.getOrLoad(this.lucyferTargetCooldownsFile, () => ({}));
                // Konwertuj zagnieżdżone obiekty na Maps
                this.lucyferTargetCooldowns = new Map();
                for (const [userId, targets] of Object.entries(parsedTargetCooldowns)) {
                    this.lucyferTargetCooldowns.set(userId, new Map(Object.entries(targets)));
                }
                logger.info(`📂 Wczytano ${this.lucyferTargetCooldowns.size} target cooldownów Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania target cooldownów Lucyfera: ${error.message}`);
                }
            }

            // Wczytaj Gabriel debuff na Lucyfera
            try {
                const parsedDebuff = await store.getOrLoad(this.lucyferGabrielDebuffFile, () => ({}));
                this.lucyferGabrielDebuff = new Map(Object.entries(parsedDebuff));
                logger.info(`📂 Wczytano ${this.lucyferGabrielDebuff.size} Gabriel debuff na Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania Gabriel debuff: ${error.message}`);
                }
            }

            // Wczytaj Gabriel blessing cooldowns
            try {
                const parsedBlessingCooldowns = await store.getOrLoad(this.gabrielBlessingCooldownsFile, () => ({}));
                // Konwertuj zagnieżdżone obiekty na Maps
                this.gabrielBlessingCooldowns = new Map();
                for (const [userId, targets] of Object.entries(parsedBlessingCooldowns)) {
                    this.gabrielBlessingCooldowns.set(userId, new Map(Object.entries(targets)));
                }
                logger.info(`📂 Wczytano ${this.gabrielBlessingCooldowns.size} blessing cooldownów Gabriela`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania blessing cooldownów Gabriela: ${error.message}`);
                }
            }

            // Wczytaj system many
            try {
                const parsedEnergySystem = await store.getOrLoad(this.energySystemFile, () => ({}));
                this.energySystem = new Map(Object.entries(parsedEnergySystem));

                // WALIDACJA: Ogranicz energię do maksymalnego limitu przy wczytywaniu
                let correctedCount = 0;
                const now = Date.now();
                for (const [userId, userData] of this.energySystem.entries()) {
                    // Zapisz rolę do userRoles jeśli istnieje w danych
                    if (userData.roleType) {
                        this.userRoles.set(userId, userData.roleType);
                    }

                    // Pobierz maksymalną energię dla użytkownika
                    const maxEnergy = this.getMaxEnergy(userId);

                    // Ogranicz energię jeśli przekracza limit
                    if (userData.energy > maxEnergy) {
                        logger.warn(`⚠️ Wykryto przekroczenie limitu many dla ${userId}: ${userData.energy}/${maxEnergy} - naprawiam...`);
                        userData.energy = maxEnergy;
                        // KRYTYCZNE: Zaktualizuj lastRegeneration na teraz, aby zapobiec natychmiastowej regeneracji
                        userData.lastRegeneration = now;

                        // Jeśli to Lucyfer, zaktualizuj także lucyferData.lastRegeneration
                        if (userData.roleType === 'lucyfer' && this.lucyferData.has(userId)) {
                            const lucyferData = this.lucyferData.get(userId);
                            lucyferData.lastRegeneration = now;
                            logger.info(`🔥 Zaktualizowano lastRegeneration dla Lucyfera ${userId}`);
                        }

                        correctedCount++;
                    }
                }

                logger.info(`📂 Wczytano ${this.energySystem.size} danych systemu many${correctedCount > 0 ? ` (naprawiono ${correctedCount} przekroczeń)` : ''}`);

                // Zapisz naprawione dane jeśli były korekty
                if (correctedCount > 0) {
                    await this.saveData();
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania systemu many: ${error.message}`);
                }
            }

            // Wczytaj blokady Lucyfera
            try {
                const parsedLucyferBlocked = await store.getOrLoad(this.lucyferCurseBlockedFile, () => ({}));
                this.lucyferCurseBlocked = new Map(Object.entries(parsedLucyferBlocked));
                logger.info(`📂 Wczytano ${this.lucyferCurseBlocked.size} blokad Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania blokad Lucyfera: ${error.message}`);
                }
            }

            // Wczytaj efekty revenge
            try {
                const parsedRevengeEffects = await store.getOrLoad(this.revengeEffectsFile, () => ({}));
                this.revengeEffects = new Map(Object.entries(parsedRevengeEffects));
                logger.info(`📂 Wczytano ${this.revengeEffects.size} efektów revenge`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania efektów revenge: ${error.message}`);
                }
            }

            // Wczytaj revenge cooldowny
            try {
                const parsedRevengeCooldowns = await store.getOrLoad(this.revengeCooldownsFile, () => ({}));
                // Konwertuj zagnieżdżone obiekty na Maps
                this.revengeCooldowns = new Map();
                for (const [userId, targets] of Object.entries(parsedRevengeCooldowns)) {
                    this.revengeCooldowns.set(userId, new Map(Object.entries(targets)));
                }
                logger.info(`📂 Wczytano ${this.revengeCooldowns.size} revenge cooldownów`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania revenge cooldownów: ${error.message}`);
                }
            }

            // Wczytaj ochronę błogosławieństw
            try {
                const parsedBlessingProtection = await store.getOrLoad(this.blessingProtectionFile, () => ({}));
                this.blessingProtection = new Map(Object.entries(parsedBlessingProtection));
                logger.info(`📂 Wczytano ${this.blessingProtection.size} ochrony błogosławieństw`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania ochrony błogosławieństw: ${error.message}`);
                }
            }

            // Wczytaj blokady blessing Gabriela
            try {
                const parsedGabrielBlocked = await store.getOrLoad(this.gabrielBlessingBlockedFile, () => ({}));
                this.gabrielBlessingBlocked = new Map(Object.entries(parsedGabrielBlocked));
                logger.info(`📂 Wczytano ${this.gabrielBlessingBlocked.size} blokad blessing Gabriela`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania blokad blessing Gabriela: ${error.message}`);
                }
            }

            // Wczytaj aktywne infernal bargains
            try {
                const parsedInfernalActive = await store.getOrLoad(this.infernalBargainActiveFile, () => ({}));
                this.infernalBargainActive = new Map(Object.entries(parsedInfernalActive));
                logger.info(`📂 Wczytano ${this.infernalBargainActive.size} aktywnych infernal bargains`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania aktywnych infernal bargains: ${error.message}`);
                }
            }

            // Wczytaj cooldowny infernal bargain
            try {
                const parsedInfernalCooldowns = await store.getOrLoad(this.infernalBargainCooldownsFile, () => ({}));
                this.infernalBargainCooldowns = new Map(Object.entries(parsedInfernalCooldowns));
                logger.info(`📂 Wczytano ${this.infernalBargainCooldowns.size} cooldownów infernal bargain`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania cooldownów infernal bargain: ${error.message}`);
                }
            }

            // Wczytaj cooldowny chaos blessing
            try {
                const parsedChaosCooldowns = await store.getOrLoad(this.chaosBlessingCooldownsFile, () => ({}));
                this.chaosBlessingCooldowns = new Map(Object.entries(parsedChaosCooldowns));
                logger.info(`📂 Wczytano ${this.chaosBlessingCooldowns.size} cooldownów chaos blessing`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania cooldownów chaos blessing: ${error.message}`);
                }
            }

            // Wczytaj debuffs chaos blessing
            try {
                const parsedChaosDebuffs = await store.getOrLoad(this.chaosBlessingDebuffsFile, () => ({}));
                this.chaosBlessingDebuffs = new Map(Object.entries(parsedChaosDebuffs));
                logger.info(`📂 Wczytano ${this.chaosBlessingDebuffs.size} debuffs chaos blessing`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania debuffs chaos blessing: ${error.message}`);
                }
            }

        } catch (error) {
            logger.error(`❌ Błąd wczytywania danych VirtuttiService: ${error.message}`);
        }
    }

    /**
     * Zapisuje dane do plików JSON
     */
    async saveData() {
        try {
            // Konwertuj Maps na obiekty
            const cooldownsObj = Object.fromEntries(this.cooldowns);
            const dailyUsageObj = Object.fromEntries(this.dailyUsage);
            const lucyferCursesObj = Object.fromEntries(this.lucyferCurses);

            // Konwertuj zagnieżdżone Maps dla target cooldownów
            const lucyferTargetCooldownsObj = {};
            for (const [userId, targets] of this.lucyferTargetCooldowns.entries()) {
                lucyferTargetCooldownsObj[userId] = Object.fromEntries(targets);
            }

            // Konwertuj Gabriel debuff
            const lucyferGabrielDebuffObj = Object.fromEntries(this.lucyferGabrielDebuff);

            // Konwertuj zagnieżdżone Maps dla Gabriel blessing cooldowns
            const gabrielBlessingCooldownsObj = {};
            for (const [userId, targets] of this.gabrielBlessingCooldowns.entries()) {
                gabrielBlessingCooldownsObj[userId] = Object.fromEntries(targets);
            }

            // Zapisz cooldowny
            await store.set(this.cooldownsFile, cooldownsObj);

            // Zapisz dzienne użycia
            await store.set(this.dailyUsageFile, dailyUsageObj);

            // Zapisz dane Lucyfera - główne dane
            const lucyferDataObj = Object.fromEntries(this.lucyferData);
            await store.set(this.lucyferDataFile, lucyferDataObj);

            // Zapisz dane Lucyfera - klątwy
            await store.set(this.lucyferCursesFile, lucyferCursesObj);
            await store.set(this.lucyferTargetCooldownsFile, lucyferTargetCooldownsObj);
            await store.set(this.lucyferGabrielDebuffFile, lucyferGabrielDebuffObj);

            // Zapisz dane Gabriela
            await store.set(this.gabrielBlessingCooldownsFile, gabrielBlessingCooldownsObj);

            // WALIDACJA: Sprawdź limity many przed zapisem
            for (const [userId, userData] of this.energySystem.entries()) {
                const maxEnergy = this.getMaxEnergy(userId);
                if (userData.energy > maxEnergy) {
                    logger.warn(`⚠️ Przed zapisem: naprawiam przekroczenie many dla ${userId}: ${userData.energy} -> ${maxEnergy}`);
                    userData.energy = maxEnergy;
                }
            }

            // Zapisz system many
            const energySystemObj = Object.fromEntries(this.energySystem);
            await store.set(this.energySystemFile, energySystemObj);

            // Zapisz blokady Lucyfera
            const lucyferCurseBlockedObj = Object.fromEntries(this.lucyferCurseBlocked);
            await store.set(this.lucyferCurseBlockedFile, lucyferCurseBlockedObj);

            // Zapisz efekty revenge
            const revengeEffectsObj = Object.fromEntries(this.revengeEffects);
            await store.set(this.revengeEffectsFile, revengeEffectsObj);

            // Zapisz revenge cooldowny (zagnieżdżone Maps)
            const revengeCooldownsObj = {};
            for (const [userId, targets] of this.revengeCooldowns.entries()) {
                revengeCooldownsObj[userId] = Object.fromEntries(targets);
            }
            await store.set(this.revengeCooldownsFile, revengeCooldownsObj);

            // Zapisz ochronę błogosławieństw
            const blessingProtectionObj = Object.fromEntries(this.blessingProtection);
            await store.set(this.blessingProtectionFile, blessingProtectionObj);

            // Zapisz blokady blessing Gabriela
            const gabrielBlessingBlockedObj = Object.fromEntries(this.gabrielBlessingBlocked);
            await store.set(this.gabrielBlessingBlockedFile, gabrielBlessingBlockedObj);

            // Zapisz aktywne infernal bargains
            const infernalBargainActiveObj = Object.fromEntries(this.infernalBargainActive);
            await store.set(this.infernalBargainActiveFile, infernalBargainActiveObj);

            // Zapisz cooldowny infernal bargain
            const infernalBargainCooldownsObj = Object.fromEntries(this.infernalBargainCooldowns);
            await store.set(this.infernalBargainCooldownsFile, infernalBargainCooldownsObj);

            // Zapisz cooldowny chaos blessing
            const chaosBlessingCooldownsObj = Object.fromEntries(this.chaosBlessingCooldowns);
            await store.set(this.chaosBlessingCooldownsFile, chaosBlessingCooldownsObj);

            // Zapisz debuffs chaos blessing
            const chaosBlessingDebuffsObj = Object.fromEntries(this.chaosBlessingDebuffs);
            await store.set(this.chaosBlessingDebuffsFile, chaosBlessingDebuffsObj);

        } catch (error) {
            logger.error(`❌ Błąd zapisywania danych VirtuttiService: ${error.message}`);
        }
    }

    // ========================================
    // 💥⚡ MEGA SILNA KLĄTWA GABRIELA NA LUCYFERA (1% przy blessing)
    // ========================================

    /**
     * Tworzy MEGA SILNĄ KLĄTWĘ Gabriela na Lucyfera (1h, zmiana co 5 min)
     * Zwraca dane do zarządzania intervalem w interactionHandlers
     * @param {string} userId - ID Lucyfera
     * @returns {Object} - { duration, changeInterval }
     */
    createGabrielStrongCurseData(userId) {
        return {
            duration: 60 * 60 * 1000, // 1 godzina
            changeInterval: 5 * 60 * 1000, // Zmiana co 5 minut
            totalChanges: 12 // 12 zmian przez godzinę
        };
    }

    /**
     * Nakłada Gabriel debuff na Lucyfera
     * @param {string} userId - ID użytkownika (Lucyfer)
     * @returns {Object} - { initialCurseEndTime, debuffEndTime }
     */
    applyGabrielDebuffToLucyfer(userId, source = 'gabriel') {
        const now = Date.now();
        const initialCurseEndTime = now + (5 * 60 * 1000); // 5 minut
        const debuffEndTime = now + (24 * 60 * 60 * 1000); // 24 godziny

        this.lucyferGabrielDebuff.set(userId, {
            endTime: debuffEndTime,
            initialCurseEndTime: initialCurseEndTime,
            source: source // 'gabriel' lub 'admin'
        });

        const sourceText = source === 'admin' ? 'Admin' : 'Gabriel';
        logger.info(`⚡ ${sourceText} debuff nałożony na ${userId} (5 min klątwa + 24h debuff)`);
        this.saveData();

        return { initialCurseEndTime, debuffEndTime };
    }

    /**
     * Sprawdza czy użytkownik ma Gabriel debuff
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - Dane debuffu lub null
     */
    hasGabrielDebuff(userId) {
        const debuffData = this.lucyferGabrielDebuff.get(userId);
        if (!debuffData) return null;

        const now = Date.now();
        if (now > debuffData.endTime) {
            this.lucyferGabrielDebuff.delete(userId);
            this.saveData();
            // Zwróć informację że debuff wygasł naturalnie (do logowania)
            return { expired: true, ...debuffData };
        }

        return debuffData;
    }

    /**
     * Usuwa Gabriel debuff
     * @param {string} userId - ID użytkownika
     * @param {boolean} natural - Czy usunięcie jest naturalne (wygaśnięcie) czy manualne
     * @returns {Object|null} - Dane usuniętego debuffu lub null
     */
    removeGabrielDebuff(userId, natural = false) {
        const debuffData = this.lucyferGabrielDebuff.get(userId);
        if (debuffData) {
            this.lucyferGabrielDebuff.delete(userId);
            logger.info(`🧹 Usunięto Gabriel debuff dla użytkownika ${userId} (${natural ? 'wygasł' : 'manualnie'})`);
            this.saveData();
            return debuffData;
        }
        return null;
    }

    // ========================================
    // 🛡️ SYSTEM OCHRONY BŁOGOSŁAWIEŃSTW
    // ========================================

    /**
     * Dodaje ochronę błogosławieństwa dla użytkownika (1h, 50% szansa na zablokowanie klątwy)
     * @param {string} userId - ID użytkownika
     */
    addBlessingProtection(userId) {
        const expiresAt = Date.now() + (60 * 60 * 1000); // 1 godzina
        this.blessingProtection.set(userId, {
            expiresAt,
            used: false
        });
        logger.info(`🛡️ Dodano ochronę błogosławieństwa dla ${userId} (1h)`);
        this.saveData();
    }

    /**
     * Sprawdza czy użytkownik ma aktywną ochronę błogosławieństwa
     * @param {string} userId - ID użytkownika
     * @returns {boolean}
     */
    hasBlessingProtection(userId) {
        const protection = this.blessingProtection.get(userId);
        if (!protection) return false;

        // Sprawdź czy nie wygasło
        if (Date.now() > protection.expiresAt) {
            this.blessingProtection.delete(userId);
            this.saveData();
            return false;
        }

        return !protection.used;
    }

    /**
     * Usuwa ochronę błogosławieństwa (po użyciu lub wygaśnięciu)
     * @param {string} userId - ID użytkownika
     */
    removeBlessingProtection(userId) {
        if (this.blessingProtection.has(userId)) {
            this.blessingProtection.delete(userId);
            logger.info(`🧹 Usunięto ochronę błogosławieństwa dla ${userId}`);
            this.saveData();
        }
    }

    // ========================================
    // 💀 SYSTEM REVENGE
    // ========================================

    /**
     * Sprawdza cooldown dla revenge na daną osobę
     * @param {string} userId - ID użytkownika rzucającego
     * @param {string} targetId - ID celu
     * @returns {Object|null} - { hoursLeft, expiresAt } lub null
     */
    checkRevengeCooldown(userId, targetId) {
        if (!this.revengeCooldowns.has(userId)) return null;

        const targets = this.revengeCooldowns.get(userId);
        const cooldownEnd = targets.get(targetId);

        if (!cooldownEnd) return null;

        const now = Date.now();
        if (now > cooldownEnd) {
            targets.delete(targetId);
            if (targets.size === 0) {
                this.revengeCooldowns.delete(userId);
            }
            this.saveData();
            return null;
        }

        const timeLeft = cooldownEnd - now;
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));

        return { hoursLeft, expiresAt: cooldownEnd };
    }

    /**
     * Ustawia cooldown revenge (24h)
     * @param {string} userId - ID użytkownika rzucającego
     * @param {string} targetId - ID celu
     */
    setRevengeCooldown(userId, targetId) {
        if (!this.revengeCooldowns.has(userId)) {
            this.revengeCooldowns.set(userId, new Map());
        }

        const cooldownEnd = Date.now() + (24 * 60 * 60 * 1000); // 24h
        this.revengeCooldowns.get(userId).set(targetId, cooldownEnd);
        logger.info(`⏰ Ustawiono revenge cooldown dla ${userId} → ${targetId} (24h)`);
        this.saveData();
    }

    /**
     * Dodaje efekt revenge na cel
     * @param {string} targetId - ID osoby chronionej
     * @param {string} appliedBy - ID użytkownika rzucającego
     * @param {string} type - 'lucyfer' (1 użycie) lub 'gabriel' (3 użycia)
     */
    applyRevengeEffect(targetId, appliedBy, type) {
        const remainingUses = type === 'lucyfer' ? 1 : 3;
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 godziny

        // Pobierz istniejące efekty lub stwórz nową tablicę
        let effects = this.revengeEffects.get(targetId) || [];

        // Sprawdź czy już nie ma tego samego typu efektu
        const existingEffect = effects.find(e => e.type === type);
        if (existingEffect) {
            logger.warn(`⚠️ ${targetId} już ma aktywny efekt revenge_${type}`);
            return false;
        }

        // Dodaj nowy efekt
        effects.push({
            type,
            remainingUses,
            expiresAt,
            appliedBy
        });

        this.revengeEffects.set(targetId, effects);
        logger.info(`💀 Dodano revenge_${type} na ${targetId} (${remainingUses} użyć, 24h)`);
        this.saveData();
        return true;
    }

    /**
     * Sprawdza czy cel ma aktywny efekt revenge danego typu
     * @param {string} targetId - ID celu
     * @param {string} type - 'lucyfer' lub 'gabriel'
     * @returns {Object|null} - Efekt lub null
     */
    hasRevengeEffect(targetId, type) {
        const effects = this.revengeEffects.get(targetId);
        if (!effects) return null;

        const now = Date.now();

        // Filtruj wygasłe efekty
        const validEffects = effects.filter(e => now < e.expiresAt);
        if (validEffects.length !== effects.length) {
            this.revengeEffects.set(targetId, validEffects);
            this.saveData();
        }

        // Znajdź efekt danego typu
        const effect = validEffects.find(e => e.type === type);
        return effect || null;
    }

    /**
     * Zmniejsza licznik użyć revenge i usuwa jeśli 0
     * @param {string} targetId - ID celu
     * @param {string} type - 'lucyfer' lub 'gabriel'
     * @returns {number} - Pozostała liczba użyć (po zmniejszeniu)
     */
    decrementRevengeUses(targetId, type) {
        const effects = this.revengeEffects.get(targetId);
        if (!effects) return 0;

        const effectIndex = effects.findIndex(e => e.type === type);
        if (effectIndex === -1) return 0;

        effects[effectIndex].remainingUses--;
        const remaining = effects[effectIndex].remainingUses;

        if (remaining <= 0) {
            effects.splice(effectIndex, 1);
            logger.info(`🧹 Usunięto revenge_${type} z ${targetId} (zużyte)`);
        } else {
            logger.info(`💀 Revenge_${type} na ${targetId}: ${remaining} użyć pozostało`);
        }

        if (effects.length === 0) {
            this.revengeEffects.delete(targetId);
        } else {
            this.revengeEffects.set(targetId, effects);
        }

        this.saveData();
        return remaining;
    }

    /**
     * Usuwa wszystkie efekty revenge z celu
     * @param {string} targetId - ID celu
     */
    removeAllRevengeEffects(targetId) {
        if (this.revengeEffects.has(targetId)) {
            this.revengeEffects.delete(targetId);
            logger.info(`🧹 Usunięto wszystkie revenge efekty z ${targetId}`);
            this.saveData();
        }
    }

    /**
     * Pobiera statystyki revenge dla embeda Sądu Bożego
     * @param {string} targetId - ID celu
     * @returns {Array} - Tablica efektów z detalami
     */
    getRevengeStats(targetId) {
        const effects = this.revengeEffects.get(targetId);
        if (!effects) return [];

        const now = Date.now();
        return effects
            .filter(e => now < e.expiresAt)
            .map(e => ({
                type: e.type,
                remainingUses: e.remainingUses,
                timeLeft: Math.ceil((e.expiresAt - now) / (60 * 1000)) // w minutach
            }));
    }

    // ========================================
    // ⚔️ BLOKADA BLESSING GABRIELA (Upadły)
    // ========================================

    /**
     * Blokuje blessing Gabriela na 1h i zmienia nick na "Upadły"
     * @param {string} userId - ID Gabriela
     */
    blockGabrielBlessing(userId) {
        const expiresAt = Date.now() + (60 * 60 * 1000); // 1 godzina
        this.gabrielBlessingBlocked.set(userId, { expiresAt });
        logger.info(`⚔️ Zablokowano blessing Gabriela ${userId} na 1h (Upadły)`);
        this.saveData();
    }

    /**
     * Sprawdza czy Gabriel ma zablokowane blessing
     * @param {string} userId - ID Gabriela
     * @returns {Object|null} - { minutesLeft } lub null
     */
    isGabrielBlessingBlocked(userId) {
        const blocked = this.gabrielBlessingBlocked.get(userId);
        if (!blocked) return null;

        const now = Date.now();
        if (now > blocked.expiresAt) {
            this.gabrielBlessingBlocked.delete(userId);
            this.saveData();
            return null;
        }

        const timeLeft = blocked.expiresAt - now;
        const minutesLeft = Math.ceil(timeLeft / (60 * 1000));

        return { minutesLeft, expiresAt: blocked.expiresAt };
    }

    /**
     * Usuwa blokadę blessing Gabriela
     * @param {string} userId - ID Gabriela
     */
    removeGabrielBlessingBlock(userId) {
        if (this.gabrielBlessingBlocked.has(userId)) {
            this.gabrielBlessingBlocked.delete(userId);
            logger.info(`🧹 Usunięto blokadę blessing Gabriela ${userId}`);
            this.saveData();
        }
    }

    // ========================================
    // 🔥 INFERNAL BARGAIN (Piekielny Układ)
    // ========================================

    /**
     * Sprawdza cooldown dla infernal bargain (24h)
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - { hoursLeft, expiresAt } lub null
     */
    checkInfernalBargainCooldown(userId) {
        const cooldownEnd = this.infernalBargainCooldowns.get(userId);
        if (!cooldownEnd) return null;

        const now = Date.now();
        if (now > cooldownEnd) {
            this.infernalBargainCooldowns.delete(userId);
            this.saveData();
            return null;
        }

        const timeLeft = cooldownEnd - now;
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));

        return { hoursLeft, expiresAt: cooldownEnd };
    }

    /**
     * Sprawdza czy użytkownik ma aktywny infernal bargain
     * @param {string} userId - ID użytkownika
     * @returns {boolean}
     */
    hasActiveInfernalBargain(userId) {
        return this.infernalBargainActive.has(userId);
    }

    /**
     * Aktywuje infernal bargain dla użytkownika
     * @param {string} userId - ID użytkownika
     */
    activateInfernalBargain(userId) {
        const now = Date.now();
        this.infernalBargainActive.set(userId, {
            startedAt: now,
            lastCurseAt: now,
            lastRegenAt: now
        });
        logger.info(`🔥 Aktywowano Infernal Bargain dla ${userId}`);
        this.saveData();
    }

    /**
     * Dezaktywuje infernal bargain i ustawia cooldown 24h
     * @param {string} userId - ID użytkownika
     */
    deactivateInfernalBargain(userId) {
        if (this.infernalBargainActive.has(userId)) {
            this.infernalBargainActive.delete(userId);

            // Ustaw cooldown 24h
            const cooldownEnd = Date.now() + (24 * 60 * 60 * 1000);
            this.infernalBargainCooldowns.set(userId, cooldownEnd);

            logger.info(`🔥 Dezaktywowano Infernal Bargain dla ${userId} (cooldown 24h)`);
            this.saveData();
        }
    }

    /**
     * Pobiera dane aktywnego infernal bargain
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - { startedAt, lastCurseAt, lastRegenAt } lub null
     */
    getInfernalBargainData(userId) {
        return this.infernalBargainActive.get(userId) || null;
    }

    /**
     * Aktualizuje timestamp ostatniej klątwy infernal bargain
     * @param {string} userId - ID użytkownika
     */
    updateInfernalBargainCurseTime(userId) {
        const data = this.infernalBargainActive.get(userId);
        if (data) {
            data.lastCurseAt = Date.now();
            this.saveData();
        }
    }

    /**
     * Aktualizuje timestamp ostatniej regeneracji infernal bargain
     * @param {string} userId - ID użytkownika
     */
    updateInfernalBargainRegenTime(userId) {
        const data = this.infernalBargainActive.get(userId);
        if (data) {
            data.lastRegenAt = Date.now();
            this.saveData();
        }
    }

    // ========================================
    // 🌑 CHAOS BLESSING (Mroczne Błogosławieństwo)
    // ========================================

    /**
     * Sprawdza cooldown dla chaos blessing (1h)
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - { minutesLeft, expiresAt } lub null
     */
    checkChaosBlessingCooldown(userId) {
        const cooldownEnd = this.chaosBlessingCooldowns.get(userId);
        if (!cooldownEnd) return null;

        const now = Date.now();
        if (now > cooldownEnd) {
            this.chaosBlessingCooldowns.delete(userId);
            this.saveData();
            return null;
        }

        const timeLeft = cooldownEnd - now;
        const minutesLeft = Math.ceil(timeLeft / (60 * 1000));

        return { minutesLeft, expiresAt: cooldownEnd };
    }

    /**
     * Ustawia cooldown chaos blessing (1h)
     * @param {string} userId - ID użytkownika
     */
    setChaosBlessingCooldown(userId) {
        const cooldownEnd = Date.now() + (60 * 60 * 1000); // 1 godzina
        this.chaosBlessingCooldowns.set(userId, cooldownEnd);
        this.saveData();
    }

    /**
     * Nakłada debuff chaos blessing
     * @param {string} targetId - ID celu
     * @param {string} type - Typ debuffu ('gabriel_slow_regen' | 'blessing_immunity')
     * @param {string} appliedBy - ID użytkownika rzucającego
     */
    applyChaosBlessingDebuff(targetId, type, appliedBy) {
        const expiresAt = Date.now() + (60 * 60 * 1000); // 1 godzina
        this.chaosBlessingDebuffs.set(targetId, {
            type,
            expiresAt,
            appliedBy
        });
        logger.info(`🌑 Nałożono debuff chaos blessing (${type}) na ${targetId} przez ${appliedBy}`);
        this.saveData();
    }

    /**
     * Sprawdza czy użytkownik ma aktywny debuff chaos blessing
     * @param {string} userId - ID użytkownika
     * @param {string} type - Opcjonalnie, typ debuffu do sprawdzenia
     * @returns {Object|null} - Dane debuffu lub null
     */
    hasChaosBlessingDebuff(userId, type = null) {
        const debuff = this.chaosBlessingDebuffs.get(userId);
        if (!debuff) return null;

        // Sprawdź czy nie wygasł
        if (Date.now() > debuff.expiresAt) {
            this.chaosBlessingDebuffs.delete(userId);
            this.saveData();
            return null;
        }

        // Jeśli podano typ, sprawdź czy się zgadza
        if (type && debuff.type !== type) return null;

        return debuff;
    }

    /**
     * Usuwa debuff chaos blessing
     * @param {string} userId - ID użytkownika
     */
    removeChaosBlessingDebuff(userId) {
        if (this.chaosBlessingDebuffs.has(userId)) {
            this.chaosBlessingDebuffs.delete(userId);
            logger.info(`🧹 Usunięto debuff chaos blessing dla ${userId}`);
            this.saveData();
        }
    }
}

module.exports = VirtuttiService;