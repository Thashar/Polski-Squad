const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Konklawe');

class VirtuttiService {
    constructor(config) {
        this.config = config;
        this.cooldowns = new Map(); // userId -> { blessing: timestamp, virtueCheck: timestamp, curse: timestamp }
        this.dailyUsage = new Map(); // userId -> { date: string, blessing: count, virtueCheck: count, curse: count }
        
        // Ścieżki do plików danych
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'virtutti_cooldowns.json');
        this.dailyUsageFile = path.join(this.dataDir, 'virtutti_daily_usage.json');
        
        // Wczytaj dane przy starcie
        this.loadData();
    }

    /**
     * Sprawdza czy użytkownik może użyć komendy
     * @param {string} userId - ID użytkownika
     * @param {string} commandType - 'blessing', 'virtueCheck' lub 'curse'
     * @returns {Object} - { canUse: boolean, reason?: string }
     */
    canUseCommand(userId, commandType) {
        const now = Date.now();
        const today = new Date().toDateString();

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
        const today = new Date().toDateString();

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
     * Czyszczenie starych danych (opcjonalne)
     */
    cleanup() {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const today = new Date().toDateString();
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

            // Zapisz cooldowny
            await fs.writeFile(this.cooldownsFile, JSON.stringify(cooldownsObj, null, 2));

            // Zapisz dzienne użycia
            await fs.writeFile(this.dailyUsageFile, JSON.stringify(dailyUsageObj, null, 2));

        } catch (error) {
            logger.error(`❌ Błąd zapisywania danych VirtuttiService: ${error.message}`);
        }
    }
}

module.exports = VirtuttiService;