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
     * Domyślna lista wyzwisk polskich (różne formy)
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
            "szczeniaku", "gówniarzu", "smyku", "gołowązku", "zadzioro", "urwisie",
            
            // Zwroty i komendy wulgarne
            "jebaj się", "spierdalaj", "wypierdalaj", "odpierdol się", "pieprz się",
            "jeb się", "spadaj", "odwal się", "skurwysynie", "skurwielu", "skurwysynu",
            "pojeb", "pojebany", "pojebana", "pojebane", "zjeb", "zjebany", "zjebana",
            "wkurwiony", "wkurwiona", "wkurwione", "kurwa mać", "kurwa jego mać",
            "chuj ci w dupę", "chuj ci w oko", "chuj ci w mordę", "chuj ci w ryj",
            "pieprzy cię", "pierdol się", "pierdolisz", "pierdolony", "pierdolona",
            "gówno", "gówna", "gównem", "gównie", "gówniany", "gówniara", "gówniarz",
            "sraj", "srajcie", "srajmy", "sranie", "sranko", "sracze", "sraczu",
            "szlag", "szlaga", "szlagiem", "szlakiem", "cholera", "cholernie", "cholerni",
            "diabel", "diabła", "diabłu", "diabłem", "diabli", "diabolic", "diabełek",
            "do dupy", "w dupie", "na dupie", "dupek", "dupcia", "dupsko", "dupasz",
            "cipy", "cipę", "cipka", "cipko", "cipeczka", "cipucha", "cipusia",
            "fiut", "fiuta", "fiutem", "fiutka", "fiutko", "fiutaś", "fiutaszek",
            "jaja", "jaj", "jajco", "jajek", "jajkiem", "jajca", "jajcarz", "jajecznica",
            "chuja", "chujek", "chujnia", "chujowy", "chujowa", "chujowe", "chujek",
            "kurewski", "kurewska", "kurewskie", "kurewsko", "kurewnie", "kurewny",
            "pierdolenie", "pierdolnij", "pierdolnął", "pierdolnęła", "pierdolnęło",
            "zajebisty", "zajebista", "zajebiste", "zajebały", "zajebała", "zajebało",
            "rozjebany", "rozjebana", "rozjebane", "rozjebał", "rozjebała", "rozjebało",
            "przejebany", "przejebana", "przejebane", "przejebał", "przejebała", "przejebało",
            "najebany", "najebana", "najebane", "najebał", "najebała", "najebało",
            "wjebany", "wjebana", "wjebane", "wjebał", "wjebała", "wjebało",
            "ujebany", "ujebana", "ujebane", "ujebał", "ujebała", "ujebało",
            "dojebany", "dojebana", "dojebane", "dojebał", "dojebała", "dojebało",
            "popierdolony", "popierdolona", "popierdolone", "popierdolił", "popierdoliła",
            "zasrany", "zasrana", "zasrane", "zasrał", "zasrała", "zasrało",
            "posrany", "posrana", "posrane", "posrał", "posrała", "posrało",
            "nasrany", "nasrana", "nasrane", "nasrał", "nasrała", "nasrało",
            "obsrany", "obsrana", "obsrane", "obsrał", "obsrała", "obsrało",
            "obciągnij", "obciągaj", "obciągasz", "obciąganie", "obciągarka", "obciągacz",
            "lizać", "liże", "liżesz", "liza", "lizanie", "lizaczka", "lizacz",
            "ruchaj", "ruchać", "ruchanie", "ruchasz", "rucha", "ruchał", "ruchała",
            "dupczenie", "dupczy", "dupczysz", "dupczył", "dupczyła", "dupczyło",
            "pojebać", "pojebał", "pojebała", "pojebało", "pojebię", "pojebiesz",
            "zjebać", "zjebał", "zjebała", "zjebało", "zjebię", "zjebiesz",
            "wyjebać", "wyjebał", "wyjebała", "wyjebało", "wyjebię", "wyjebiesz",
            "przejebać", "przejebał", "przejebała", "przejebało", "przejebię", "przejebiesz",
            "najebać", "najebał", "najebała", "najebało", "najebię", "najebiesz",
            "dojebać", "dojebał", "dojebała", "dojebało", "dojebię", "dojebiesz",
            "ujebać", "ujebał", "ujebała", "ujebało", "ujebię", "ujebiesz",
            "wjebać", "wjebał", "wjebała", "wjebało", "wjebię", "wjebiesz",
            "rozjebać", "rozjebał", "rozjebała", "rozjebało", "rozjebię", "rozjebiesz",
            "zasrać", "zasrał", "zasrała", "zasrało", "zasrę", "zasriesz",
            "posrać", "posrał", "posrała", "posrało", "posrę", "posriesz",
            "nasrać", "nasrał", "nasrała", "nasrało", "nasrę", "nasriesz",
            "obsrać", "obsrał", "obsrała", "obsrało", "obsrę", "obsriesz",
            "kurwisz", "kurwił", "kurwiła", "kurwiło", "kurwić", "kurwienie",
            "pierdolisz", "pierdolił", "pierdoliła", "pierdoliło", "pierdolić",
            "odpierdolisz", "odpierdolił", "odpierdoliła", "odpierdoliło", "odpierdolić",
            "spierdolisz", "spierdolił", "spierdoliła", "spierdoliło", "spierdolić",
            "wypierdolisz", "wypierdolił", "wypierdoliła", "wypierdoliło", "wypierdolić",
            
            // Wyszukane formy i zwroty wulgarne
            "jebał cię pies", "jebał cię kot", "jebał cię osioł", "jebał cię diabeł",
            "jebała cię kurwa", "jebała cię suka", "jebała cię dziwka", "jebała cię pizda",
            "jebane gówno", "jebana kurwa", "jebany chuj", "jebana suka", "jebana pizda",
            "pojebało cię", "pojebało go", "pojebało ją", "pojebało ich", "pojebało was",
            "zjebało cię", "zjebało go", "zjebało ją", "zjebało ich", "zjebało was",
            "chuj ci w dupę", "chuj ci w oko", "chuj ci w mordę", "chuj ci w ryj",
            "chuj ci w gardło", "chuj ci w ucho", "chuj ci w dupe", "chuj ci w buzię",
            "pizda ci w mordę", "pizda ci w ryj", "pizda ci w oko", "pizda ci w dupe",
            "kurwa ci w dupę", "kurwa ci w mordę", "kurwa ci w ryj", "kurwa ci w oko",
            "w dupie ci pies", "w dupie ci osioł", "w dupie ci diabeł", "w dupie ci kot",
            "w dupie mam", "w dupie to mam", "w dupie was mam", "w dupie go mam",
            "do dupy z gruszkami", "do dupy z jabłkami", "do dupy z koniem", "do dupy z psem",
            "na chuj", "na chuja", "na kurwa", "na kurwę", "na pizda", "na pizdę",
            "po chuj", "po chuja", "po kurwa", "po kurwę", "po pizda", "po pizdę",
            "co za kurwa", "co za chuj", "co za pizda", "co za gówno", "co za suka",
            "ale kurwa", "ale chuj", "ale pizda", "ale gówno", "ale suka", "ale dziwka",
            "kurwa jego mać", "kurwa jego ojca", "kurwa jego babę", "kurwa jego rodzinę",
            "chuj jego mać", "chuj jego ojca", "chuj jego babę", "chuj jego rodzinę",
            "pierdol się", "pierdol sie", "pierdolisz się", "pierdolisz sie",
            "jeb się", "jeb sie", "jebiesz się", "jebiesz sie", "jebać się", "jebać sie",
            "sraj się", "sraj sie", "srasz się", "srasz sie", "srać się", "srać sie",
            "gówno prawda", "gówno z tego", "gówno warte", "gówno warty", "gówno warta",
            "chujowe", "chujowa", "chujowy", "chujowe to", "chujowa to", "chujowy to",
            "kurewski", "kurewska", "kurewskie", "kurewsko", "kurewnie", "kurewny",
            "pierdolony", "pierdolona", "pierdolone", "pierdolnie", "pierdolnięty",
            "zajebisty", "zajebista", "zajebiste", "zajebało", "zajebany", "zajebana",
            "rozjebany", "rozjebana", "rozjebane", "rozjebało", "rozjebał", "rozjebała",
            "przejebany", "przejebana", "przejebane", "przejebało", "przejebał", "przejebała",
            "najebany", "najebana", "najebane", "najebało", "najebał", "najebała",
            "wjebany", "wjebana", "wjebane", "wjebało", "wjebał", "wjebała",
            "ujebany", "ujebana", "ujebane", "ujebało", "ujebał", "ujebała",
            "dojebany", "dojebana", "dojebane", "dojebało", "dojebał", "dojebała",
            "zasrany", "zasrana", "zasrane", "zasrało", "zasrał", "zasrała",
            "posrany", "posrana", "posrane", "posrało", "posrał", "posrała",
            "nasrany", "nasrana", "nasrane", "nasrało", "nasrał", "nasrała",
            "obsrany", "obsrana", "obsrane", "obsrało", "obsrał", "obsrała",
            "kurwa mać", "kurwa jego mać", "kurwa jego ojca", "kurwa jego babę",
            "chodź tu kurwo", "chodź tu chuju", "chodź tu pizdo", "chodź tu suko",
            "ty kurwo", "ty chuju", "ty pizdo", "ty suko", "ty dziwko", "ty gnido",
            "ty debilu", "ty idioto", "ty kretynie", "ty śmieciu", "ty bydlaku",
            "ty szuju", "ty cwelu", "ty pedale", "ty żulu", "ty kutasie",
            "twoja stara", "twoja stara to kurwa", "twoja stara to dziwka", "twoja stara to suka",
            "twój stary", "twój stary to pedał", "twój stary to chuj", "twój stary to kutas",
            "twoje matka", "twoja matka to kurwa", "twoja matka to dziwka", "twoja matka to suka",
            "twoje ojciec", "twój ojciec to chuj", "twój ojciec to kutas", "twój ojciec to pedał",
            "spierdalaj stąd", "wypierdalaj stąd", "odpierdol się stąd", "jebaj się stąd",
            "idź się jebać", "idź się pieprzyć", "idź do dupy", "idź do chuja", "idź do pizdy",
            "mam cię w dupie", "mam was w dupie", "mam to w dupie", "mam go w dupie",
            "ssij chuja", "ssij kutasa", "ssij fiuta", "ssij pale", "ssij mi",
            "lizać dupę", "lizać chuj", "lizać kutas", "lizać fiut", "lizać cipę",
            "ruchać w dupę", "ruchać w cipę", "ruchać w mordę", "ruchać w ryj",
            "jebać w dupę", "jebać w cipę", "jebać w mordę", "jebać w ryj",
            "pierdolić w dupę", "pierdolić w cipę", "pierdolić w mordę", "pierdolić w ryj",
            "chuj mnie to", "chuj mnie obchodzi", "chuj mnie interesuje", "chuj mnie to boli",
            "kurwa mnie to", "kurwa mnie obchodzi", "kurwa mnie interesuje", "kurwa mnie to boli",
            "gówno mnie to", "gówno mnie obchodzi", "gówno mnie interesuje", "gówno mnie to boli",
            "pizda mnie to", "pizda mnie obchodzi", "pizda mnie interesuje", "pizda mnie to boli",
            "fuck off", "fuck you", "fuck this", "fuck that", "fucking hell",
            "son of a bitch", "piece of shit", "go to hell", "kiss my ass",
            "suck my dick", "eat shit", "bullshit", "horseshit", "dickhead",
            "asshole", "motherfucker", "cocksucker", "bastard", "bitch",
            "damn it", "god damn", "what the fuck", "what the hell", "holy shit",
            "shit happens", "no shit", "tough shit", "eat my shorts", "bite me",
            "piss off", "piss on you", "go screw yourself", "screw you", "screw this",
            "shithead", "shitface", "dipshit", "dumbass", "jackass", "smartass",
            "kiss my butt", "up yours", "blow me", "suck it", "get stuffed",
            "go jump off a cliff", "drop dead", "go die", "kill yourself",
            "shut the hell up", "shut the fuck up", "fuck off and die",
            "go fuck yourself", "fuck your mother", "your mom", "your mama"
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
            // Escapuj znaki specjalne w wyrażeniu regularnym
            const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            normalized = normalized.replace(new RegExp(escapedFrom, 'g'), to);
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
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return [];
        }
        
        const normalized = this.normalizeText(text);
        const foundBadWords = [];

        for (const badWord of this.badWords) {
            // Sprawdź czy tekst zawiera wyzwisko jako całe słowo lub frazę
            if (badWord.includes(' ')) {
                // Dla fraz (np. "jebaj się", "chuj ci w dupę")
                if (normalized.includes(badWord)) {
                    foundBadWords.push({
                        word: badWord,
                        original: badWord,
                        normalized: badWord
                    });
                }
            } else {
                // Dla pojedynczych słów
                const words = normalized.split(/\s+/).filter(word => word.length > 0);
                
                for (const word of words) {
                    // Usuń znaki interpunkcyjne z początku i końca słowa
                    const cleanWord = word.replace(/^[^\w\u00C0-\u017F]+|[^\w\u00C0-\u017F]+$/g, '');
                    
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
        }

        return foundBadWords;
    }

    /**
     * Przetwarza wiadomość pod kątem wyzwisk
     * @param {Message} message - Wiadomość Discord
     * @returns {Object} Wynik analizy
     */
    async processMessage(message) {
        if (!message || !message.content || message.author.bot) {
            return { action: 'ignore' };
        }

        try {
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
        } catch (error) {
            this.logger.error(`Błąd podczas przetwarzania wiadomości: ${error.message}`);
            return { action: 'ignore' };
        }
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