const fs = require('fs');
const path = require('path');

class AutoModerationService {
    constructor(config, logger, warningService) {
        this.config = config;
        this.logger = logger;
        this.warningService = warningService;
        this.violationCounts = new Map(); // userId -> { count, firstViolation, violations: [] }
        this.userWarnings = new Map(); // userId -> { warnings: [], firstWarning }
        this.badWordsFile = path.join(__dirname, '../data/badwords.json');
        this.ensureDataDirectory();
        this.loadBadWords();
    }

    /**
     * Zapewnia istnienie katalogu danych
     */
    ensureDataDirectory() {
        const dataDir = path.dirname(this.badWordsFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Utwórz plik z wyzwiskami jeśli nie istnieje
        if (!fs.existsSync(this.badWordsFile)) {
            const defaultBadWords = this.getDefaultBadWords();
            fs.writeFileSync(this.badWordsFile, JSON.stringify(defaultBadWords, null, 2));
        }
    }

    /**
     * Domyślna lista wyzwisk polskich (wołacz)
     */
    getDefaultBadWords() {
        return [
            // Podstawowe wyzwiska w wołaczu
            "kurwo", "chuju", "pizdo", "suko", "dziwko", "debilu", "idioto", "kretynie",
            "śmieciu", "gnido", "bydlaku", "szuju", "cwelu", "pedale", "żulu", "kutasie",
            
            // Wyszukane wyzwiska w wołaczu
            "chamie", "barbarzyńco", "prostaku", "gburu", "wieśniaku", "ciemnocioto",
            "matole", "tępaku", "głąbie", "durniu", "głupcze", "imbecylu", "moherze",
            "cepie", "balwanie", "osłupie", "bałwanie", "ciulo", "pajaco", "klaunie",
            "błaźnie", "mendo", "łajzo", "łobuzie", "szubrawcu", "nicponiu", "łajdaku",
            "bandziorze", "hochsztaplerze", "oszuscie", "kanaliku", "łotrze", "zbóju",
            "rozbójniku", "bandycie", "gangsterze", "złodzieju", "złoczyńco", "awantyrniku",
            "hulajnogo", "rozpustniku", "hedonisto", "pijaku", "alkoholu", "narkonie",
            "ćpunie", "psychopato", "sadysto", "maniaku", "zboczeńcu", "degeneracie",
            "patologu", "marginesie", "szumowino", "żyło", "pasożycie", "pijawko",
            "darmozjadzie", "obibozie", "próżniaku", "leniwcu", "nierobotaku", "oferma",
            "niedojdo", "nieudaczniku", "przegrywie", "frajerze", "naiwniaku", "głupocie",
            "bałwochwalco", "fanatystyku", "sekciarzu", "hipokryto", "świętoszku", "obłudniku",
            "kłamczuchu", "manipulatorze", "intrygancie", "karierowiczu", "oportunisto",
            "podlizywaczu", "serwilisto", "pachołku", "lakayu", "sługusie", "wasalu",
            "chamo", "prostaku", "gburu", "wieśniaku", "palancie", "kmiocie", "ciemniaku",
            "analfabeto", "ignorancie", "niedouczkuo", "barbarzyńco", "dzikusie", "wandalu",
            "niszczycielu", "burzycielu", "agitatoro", "ekstremisto", "radykale", "terrorysto",
            "kretyńsku", "debilek", "idioto", "głupku", "durniu", "tępaku", "matole",
            "niedorozwinięty", "upośledzonek", "niedorajdo", "maniekuszku", "bzdrenko",
            "kretynko", "dziecinku", "niemowlaku", "smarkaczu", "pisklaczy", "bachorze",
            "szczeniaku", "gówniarzu", "smyku", "gołowązku", "zadzioro", "urwisie"
        ];
    }

    /**
     * Wczytuje listę wyzwisk z pliku
     */
    loadBadWords() {
        try {
            const data = fs.readFileSync(this.badWordsFile, 'utf8');
            this.badWords = JSON.parse(data);
        } catch (error) {
            this.logger.error(`Błąd podczas wczytywania listy wyzwisk: ${error.message}`);
            this.badWords = this.getDefaultBadWords();
        }
    }

    /**
     * Normalizuje tekst - zamienia znaki specjalne i cyfry na litery
     * @param {string} text - Tekst do normalizacji
     * @returns {string} Znormalizowany tekst
     */
    normalizeText(text) {
        const replacements = {
            // Cyfry na litery
            '0': 'o',
            '1': 'i',
            '3': 'e',
            '4': 'a',
            '5': 's',
            '6': 'g',
            '7': 't',
            '8': 'b',
            '9': 'g',
            // Znaki specjalne na litery
            '@': 'a',
            '!': 'i',
            '$': 's',
            '€': 'e',
            '#': 'h',
            '%': 'o',
            '&': 'a',
            '*': 'a',
            '+': 't',
            '=': 'e',
            '|': 'i',
            '\\': 'l',
            '/': 'l',
            '[': 'l',
            ']': 'l',
            '{': 'l',
            '}': 'l',
            '(': 'o',
            ')': 'o',
            '<': 'l',
            '>': 'l',
            '?': 'o',
            '^': 'a',
            '~': 'o',
            '`': 'l',
            '²': 'z',
            '³': 'e',
            // Podwójne litery na pojedyncze
            'aa': 'a',
            'bb': 'b',
            'cc': 'c',
            'dd': 'd',
            'ee': 'e',
            'ff': 'f',
            'gg': 'g',
            'hh': 'h',
            'ii': 'i',
            'jj': 'j',
            'kk': 'k',
            'll': 'l',
            'mm': 'm',
            'nn': 'n',
            'oo': 'o',
            'pp': 'p',
            'qq': 'q',
            'rr': 'r',
            'ss': 's',
            'tt': 't',
            'uu': 'u',
            'vv': 'v',
            'ww': 'w',
            'xx': 'x',
            'yy': 'y',
            'zz': 'z',
            // Podobne znaki
            'ą': 'a',
            'ć': 'c',
            'ę': 'e',
            'ł': 'l',
            'ń': 'n',
            'ó': 'o',
            'ś': 's',
            'ź': 'z',
            'ż': 'z'
        };

        let normalized = text.toLowerCase();
        
        // Zastąp znaki specjalne
        for (const [from, to] of Object.entries(replacements)) {
            normalized = normalized.replace(new RegExp(from, 'g'), to);
        }

        // Usuń spacje wewnątrz słów (np. "k u r w a" -> "kurwa")
        normalized = normalized.replace(/\s+/g, ' ');
        
        return normalized;
    }

    /**
     * Sprawdza czy tekst zawiera wyzwiska
     * @param {string} text - Tekst do sprawdzenia
     * @returns {Array} Lista znalezionych wyzwisk
     */
    detectBadWords(text) {
        const normalized = this.normalizeText(text);
        const words = normalized.split(/\s+/);
        const foundBadWords = [];

        for (const word of words) {
            // Usuń znaki interpunkcyjne z początku i końca słowa
            const cleanWord = word.replace(/^[^\w\u00C0-\u017F]+|[^\w\u00C0-\u017F]+$/g, '');
            
            for (const badWord of this.badWords) {
                // Sprawdź czy całe słowo to wyzwisko (nie fragment)
                if (cleanWord === badWord) {
                    foundBadWords.push({
                        word: badWord,
                        original: word,
                        normalized: cleanWord
                    });
                    break;
                }
                
                // Sprawdź czy słowo zaczyna się i kończy na wyzwisko (z możliwymi końcówkami)
                const wordPattern = new RegExp(`^${badWord}(em|ami|ach|ów|y|i|a|e|o|u|ie|ę|ą)?$`);
                if (wordPattern.test(cleanWord)) {
                    foundBadWords.push({
                        word: badWord,
                        original: word,
                        normalized: cleanWord
                    });
                    break;
                }
            }
        }

        return foundBadWords;
    }

    /**
     * Przetwarza wiadomość pod kątem wyzwisk
     * @param {Message} message - Wiadomość Discord
     * @returns {Object} Wynik analizy
     */
    async processMessage(message) {
        if (!message.content || message.author.bot) {
            return { action: 'ignore' };
        }

        const userId = message.author.id;
        const guildId = message.guild.id;
        const badWords = this.detectBadWords(message.content);

        if (badWords.length === 0) {
            return { action: 'clean' };
        }

        // Zwiększ licznik wyzwisk
        const now = Date.now();
        const windowMs = this.config.autoModeration.violationWindow * 60 * 1000; // 15 minut

        if (!this.violationCounts.has(userId)) {
            this.violationCounts.set(userId, {
                count: 0,
                firstViolation: now,
                violations: []
            });
        }

        const userViolations = this.violationCounts.get(userId);
        
        // Wyczyść stare naruszenia (spoza okna 15 minut)
        userViolations.violations = userViolations.violations.filter(
            violation => now - violation.timestamp < windowMs
        );

        // Dodaj nowe naruszenie
        userViolations.violations.push({
            timestamp: now,
            badWords: badWords,
            messageId: message.id,
            channelId: message.channel.id
        });

        userViolations.count = userViolations.violations.length;

        // Sprawdź czy przekroczono limit
        if (userViolations.count >= this.config.autoModeration.violationsBeforeWarn) {
            // Wyczyść licznik
            this.violationCounts.delete(userId);
            
            // Dodaj automatyczny warn
            const warnResult = this.warningService.addWarning(
                userId,
                message.client.user.id,
                'System Auto-Moderacji',
                `Używanie wyzwisk na serwerze (${badWords.length} wyzwisk w ${userViolations.count} wiadomościach)`,
                guildId
            );

            // Sprawdź czy użytkownik ma już 3 warny w ciągu godziny
            const hourlyWarnings = this.getUserWarningsInHour(userId, guildId);
            
            if (hourlyWarnings >= this.config.autoModeration.warningsBeforeMute) {
                return {
                    action: 'mute',
                    reason: `Automatyczne wyciszenie za ${hourlyWarnings} ostrzeżenia w ciągu godziny`,
                    warnResult: warnResult,
                    badWords: badWords
                };
            }

            return {
                action: 'warn',
                warnResult: warnResult,
                badWords: badWords,
                violationCount: userViolations.count
            };
        }

        return {
            action: 'violation',
            badWords: badWords,
            violationCount: userViolations.count,
            remaining: this.config.autoModeration.violationsBeforeWarn - userViolations.count
        };
    }

    /**
     * Pobiera liczbę warnów użytkownika w ciągu ostatniej godziny
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     * @returns {number} Liczba warnów
     */
    getUserWarningsInHour(userId, guildId) {
        const warnings = this.warningService.getUserWarnings(userId, guildId);
        const hourAgo = Date.now() - (60 * 60 * 1000); // 1 godzina temu
        
        return warnings.filter(warning => {
            const warningTime = new Date(warning.timestamp).getTime();
            return warningTime >= hourAgo;
        }).length;
    }

    /**
     * Czyści stare dane z pamięci
     */
    cleanup() {
        const now = Date.now();
        const windowMs = this.config.autoModeration.violationWindow * 60 * 1000;

        for (const [userId, data] of this.violationCounts.entries()) {
            if (now - data.firstViolation > windowMs) {
                this.violationCounts.delete(userId);
            }
        }
    }

    /**
     * Pobiera statystyki auto-moderacji
     * @returns {Object} Statystyki
     */
    getStats() {
        return {
            activeViolations: this.violationCounts.size,
            totalBadWords: this.badWords.length,
            memoryUsage: {
                violations: this.violationCounts.size,
                warnings: this.userWarnings.size
            }
        };
    }

    /**
     * Dodaje nowe wyzwisko do listy
     * @param {string} word - Wyzwisko do dodania
     */
    addBadWord(word) {
        const normalized = this.normalizeText(word);
        if (!this.badWords.includes(normalized)) {
            this.badWords.push(normalized);
            this.saveBadWords();
        }
    }

    /**
     * Usuwa wyzwisko z listy
     * @param {string} word - Wyzwisko do usunięcia
     */
    removeBadWord(word) {
        const normalized = this.normalizeText(word);
        this.badWords = this.badWords.filter(badWord => badWord !== normalized);
        this.saveBadWords();
    }

    /**
     * Zapisuje listę wyzwisk do pliku
     */
    saveBadWords() {
        try {
            fs.writeFileSync(this.badWordsFile, JSON.stringify(this.badWords, null, 2));
        } catch (error) {
            this.logger.error(`Błąd podczas zapisywania listy wyzwisk: ${error.message}`);
        }
    }
}

module.exports = AutoModerationService;