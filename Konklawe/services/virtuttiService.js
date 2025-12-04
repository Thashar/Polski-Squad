const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Konklawe');

class VirtuttiService {
    constructor(config) {
        this.config = config;
        this.cooldowns = new Map(); // userId -> { blessing: timestamp, virtueCheck: timestamp, curse: timestamp }
        this.dailyUsage = new Map(); // userId -> { date: string, blessing: count, virtueCheck: count, curse: count }

        // === NOWY SYSTEM ENERGII ===
        this.energySystem = new Map(); // userId -> { energy: number, lastRegeneration: timestamp, dailyCurses: number, date: string }

        // Lucyfer - tracking odbić klątw
        this.lucyferCurses = new Map(); // userId -> { date: string, cursesThrown: count, reflectionChance: number }
        this.lucyferTargetCooldowns = new Map(); // userId -> Map(targetId -> timestamp)
        this.lucyferCurseBlocked = new Map(); // userId -> timestamp (blokada na 1h po odbiciu)

        // Lucyfer - Gabriel debuff tracking
        this.lucyferGabrielDebuff = new Map(); // userId -> { endTime: timestamp (24h), initialCurseEndTime: timestamp (5 min) }

        // Gabriel - tracking blessing cooldowns per target
        this.gabrielBlessingCooldowns = new Map(); // userId -> Map(targetId -> timestamp)

        // Ścieżki do plików danych
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'virtutti_cooldowns.json');
        this.dailyUsageFile = path.join(this.dataDir, 'virtutti_daily_usage.json');
        this.energySystemFile = path.join(this.dataDir, 'energy_system.json');
        this.lucyferCursesFile = path.join(this.dataDir, 'lucyfer_curses.json');
        this.lucyferTargetCooldownsFile = path.join(this.dataDir, 'lucyfer_target_cooldowns.json');
        this.lucyferCurseBlockedFile = path.join(this.dataDir, 'lucyfer_curse_blocked.json');
        this.lucyferGabrielDebuffFile = path.join(this.dataDir, 'lucyfer_gabriel_debuff.json');
        this.gabrielBlessingCooldownsFile = path.join(this.dataDir, 'gabriel_blessing_cooldowns.json');

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
     * Inicjalizuje energię dla użytkownika (jeśli nie istnieje)
     * @param {string} userId - ID użytkownika
     */
    initializeEnergy(userId) {
        if (!this.energySystem.has(userId)) {
            const today = this.getPolishTime().toDateString();
            this.energySystem.set(userId, {
                energy: 300, // Start z pełną maną
                lastRegeneration: Date.now(),
                dailyCurses: 0,
                date: today
            });
            logger.info(`⚡ Zainicjowano energię dla użytkownika ${userId}: 300/300`);
        }
    }

    /**
     * Regeneruje energię użytkownika (5 punktów/godzinę)
     * @param {string} userId - ID użytkownika
     */
    regenerateEnergy(userId) {
        const userData = this.energySystem.get(userId);
        if (!userData) return;

        const now = Date.now();
        const hoursSinceLastRegen = (now - userData.lastRegeneration) / (60 * 60 * 1000);
        const energyToRegenerate = Math.floor(hoursSinceLastRegen * 10); // 10 punktów/h

        if (energyToRegenerate > 0 && userData.energy < 300) {
            userData.energy = Math.min(300, userData.energy + energyToRegenerate);
            userData.lastRegeneration = now;
            logger.info(`🔋 Regeneracja ${energyToRegenerate} many dla ${userId}. Obecna: ${userData.energy}/300`);
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
     * @returns {Object} - { energy, maxEnergy, dailyCurses, nextCurseCost }
     */
    getEnergy(userId) {
        this.initializeEnergy(userId);
        this.regenerateEnergy(userId);

        const today = this.getPolishTime().toDateString();
        const userData = this.energySystem.get(userId);

        // Reset dzienny
        if (userData.date !== today) {
            userData.date = today;
            userData.dailyCurses = 0;
        }

        return {
            energy: userData.energy,
            maxEnergy: 300,
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

        if (userData.energy < cost) {
            return false;
        }

        userData.energy -= cost;

        if (actionType === 'curse') {
            userData.dailyCurses++;
        }

        logger.info(`⚡ ${userId} zużył ${cost} many (${actionType}). Pozostało: ${userData.energy}/300, klątwy dzisiaj: ${userData.dailyCurses}`);
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
        const refund = Math.floor(originalCost / 2);

        userData.energy = Math.min(300, userData.energy + refund);
        logger.info(`💰 ${userId} otrzymał ${refund} many zwrotu (połowa kosztu). Obecna: ${userData.energy}/300`);
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

    /**
     * Rejestruje rzuconą klątwę przez Lucyfera
     * @param {string} userId - ID Lucyfera
     * @param {string} targetUserId - ID celu
     */
    registerLucyferCurse(userId, targetUserId) {
        const today = this.getPolishTime().toDateString();
        const now = Date.now();

        // Aktualizuj tracking klątw
        if (!this.lucyferCurses.has(userId) || this.lucyferCurses.get(userId).date !== today) {
            this.lucyferCurses.set(userId, {
                date: today,
                cursesThrown: 0,
                reflectionChance: 0
            });
        }

        const userCurses = this.lucyferCurses.get(userId);
        userCurses.cursesThrown++;
        userCurses.reflectionChance = userCurses.cursesThrown * 3; // 3% za każdą klątwę

        // Aktualizuj cooldown dla tego targetu
        if (!this.lucyferTargetCooldowns.has(userId)) {
            this.lucyferTargetCooldowns.set(userId, new Map());
        }
        this.lucyferTargetCooldowns.get(userId).set(targetUserId, now);

        logger.info(`💀 Lucyfer ${userId} rzucił klątwę. Łącznie dzisiaj: ${userCurses.cursesThrown}, szansa odbicia: ${userCurses.reflectionChance}%`);

        this.saveData();
    }

    /**
     * Pobiera szansę na odbicie klątwy dla Lucyfera
     * @param {string} userId - ID Lucyfera
     * @returns {number} - Szansa w procentach (0-100)
     */
    getLucyferReflectionChance(userId) {
        const today = this.getPolishTime().toDateString();
        const userCurses = this.lucyferCurses.get(userId);

        if (!userCurses || userCurses.date !== today) {
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
     * Resetuje klątwy Lucyfera (wywoływane o północy)
     */
    resetLucyferCursesDaily() {
        const today = this.getPolishTime().toDateString();

        for (const [userId, curses] of this.lucyferCurses.entries()) {
            if (curses.date !== today) {
                this.lucyferCurses.delete(userId);
                logger.info(`🔄 Reset klątw Lucyfera dla ${userId}`);
            }
        }

        this.saveData();
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
                const cooldownsData = await fs.readFile(this.cooldownsFile, 'utf8');
                const parsedCooldowns = JSON.parse(cooldownsData);
                this.cooldowns = new Map(Object.entries(parsedCooldowns));
                logger.info(`📂 Wczytano ${this.cooldowns.size} cooldownów z pliku`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania cooldownów: ${error.message}`);
                }
            }

            // Wczytaj dzienne użycia
            try {
                const dailyUsageData = await fs.readFile(this.dailyUsageFile, 'utf8');
                const parsedDailyUsage = JSON.parse(dailyUsageData);
                this.dailyUsage = new Map(Object.entries(parsedDailyUsage));
                logger.info(`📂 Wczytano ${this.dailyUsage.size} dziennych użyć z pliku`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania dziennych użyć: ${error.message}`);
                }
            }

            // Wczytaj dane Lucyfera - klątwy
            try {
                const lucyferCursesData = await fs.readFile(this.lucyferCursesFile, 'utf8');
                const parsedLucyferCurses = JSON.parse(lucyferCursesData);
                this.lucyferCurses = new Map(Object.entries(parsedLucyferCurses));
                logger.info(`📂 Wczytano ${this.lucyferCurses.size} danych klątw Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania danych Lucyfera: ${error.message}`);
                }
            }

            // Wczytaj dane Lucyfera - target cooldowny
            try {
                const lucyferTargetCooldownsData = await fs.readFile(this.lucyferTargetCooldownsFile, 'utf8');
                const parsedTargetCooldowns = JSON.parse(lucyferTargetCooldownsData);
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
                const lucyferGabrielDebuffData = await fs.readFile(this.lucyferGabrielDebuffFile, 'utf8');
                const parsedDebuff = JSON.parse(lucyferGabrielDebuffData);
                this.lucyferGabrielDebuff = new Map(Object.entries(parsedDebuff));
                logger.info(`📂 Wczytano ${this.lucyferGabrielDebuff.size} Gabriel debuff na Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania Gabriel debuff: ${error.message}`);
                }
            }

            // Wczytaj Gabriel blessing cooldowns
            try {
                const gabrielBlessingCooldownsData = await fs.readFile(this.gabrielBlessingCooldownsFile, 'utf8');
                const parsedBlessingCooldowns = JSON.parse(gabrielBlessingCooldownsData);
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
                const energySystemData = await fs.readFile(this.energySystemFile, 'utf8');
                const parsedEnergySystem = JSON.parse(energySystemData);
                this.energySystem = new Map(Object.entries(parsedEnergySystem));
                logger.info(`📂 Wczytano ${this.energySystem.size} danych systemu many`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania systemu many: ${error.message}`);
                }
            }

            // Wczytaj blokady Lucyfera
            try {
                const lucyferCurseBlockedData = await fs.readFile(this.lucyferCurseBlockedFile, 'utf8');
                const parsedLucyferBlocked = JSON.parse(lucyferCurseBlockedData);
                this.lucyferCurseBlocked = new Map(Object.entries(parsedLucyferBlocked));
                logger.info(`📂 Wczytano ${this.lucyferCurseBlocked.size} blokad Lucyfera`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn(`⚠️ Błąd wczytywania blokad Lucyfera: ${error.message}`);
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
            await fs.writeFile(this.cooldownsFile, JSON.stringify(cooldownsObj, null, 2));

            // Zapisz dzienne użycia
            await fs.writeFile(this.dailyUsageFile, JSON.stringify(dailyUsageObj, null, 2));

            // Zapisz dane Lucyfera
            await fs.writeFile(this.lucyferCursesFile, JSON.stringify(lucyferCursesObj, null, 2));
            await fs.writeFile(this.lucyferTargetCooldownsFile, JSON.stringify(lucyferTargetCooldownsObj, null, 2));
            await fs.writeFile(this.lucyferGabrielDebuffFile, JSON.stringify(lucyferGabrielDebuffObj, null, 2));

            // Zapisz dane Gabriela
            await fs.writeFile(this.gabrielBlessingCooldownsFile, JSON.stringify(gabrielBlessingCooldownsObj, null, 2));

            // Zapisz system many
            const energySystemObj = Object.fromEntries(this.energySystem);
            await fs.writeFile(this.energySystemFile, JSON.stringify(energySystemObj, null, 2));

            // Zapisz blokady Lucyfera
            const lucyferCurseBlockedObj = Object.fromEntries(this.lucyferCurseBlocked);
            await fs.writeFile(this.lucyferCurseBlockedFile, JSON.stringify(lucyferCurseBlockedObj, null, 2));

        } catch (error) {
            logger.error(`❌ Błąd zapisywania danych VirtuttiService: ${error.message}`);
        }
    }

    // ========================================
    // SILNA KLĄTWA GABRIELA NA LUCYFERA (1% przy blessing)
    // ========================================

    /**
     * Tworzy silną klątwę Gabriela na Lucyfera (1h, zmiana co 5 min)
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
    applyGabrielDebuffToLucyfer(userId) {
        const now = Date.now();
        const initialCurseEndTime = now + (5 * 60 * 1000); // 5 minut
        const debuffEndTime = now + (24 * 60 * 60 * 1000); // 24 godziny

        this.lucyferGabrielDebuff.set(userId, {
            endTime: debuffEndTime,
            initialCurseEndTime: initialCurseEndTime
        });

        logger.info(`⚡ Gabriel debuff nałożony na Lucyfera ${userId} (5 min klątwa + 24h debuff)`);
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
            return null;
        }

        return debuffData;
    }

    /**
     * Usuwa Gabriel debuff
     * @param {string} userId - ID użytkownika
     */
    removeGabrielDebuff(userId) {
        if (this.lucyferGabrielDebuff.has(userId)) {
            this.lucyferGabrielDebuff.delete(userId);
            logger.info(`🧹 Usunięto Gabriel debuff dla użytkownika ${userId}`);
            this.saveData();
        }
    }
}

module.exports = VirtuttiService;