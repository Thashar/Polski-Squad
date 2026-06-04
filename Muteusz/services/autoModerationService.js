const { safeParse } = require('../../utils/safeJSON');
const fs = require('fs');
const path = require('path');

class AutoModerationService {
    constructor(config, logger, warningService) {
        this.config = config;
        this.logger = logger;
        this.warningService = warningService;
        
        // Walidacja wymaganych zależności
        if (!this.warningService) {
            throw new Error('WarningService nie został przekazany do AutoModerationService');
        }
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
     * Domyślna lista wyzwisk polskich (tylko te skierowane bezpośrednio do osób)
     */
    getDefaultBadWords() {
        return [
            // Podstawowe wyzwiska w wołaczu - skierowane bezpośrednio do osób
            "kurwo", "chuju", "pizdo", "suko", "dziwko", "debilu", "idioto", "kretynie",
            "śmieciu", "gnido", "bydlaku", "szuju", "cwelu", "pedale", "żulu", "kutasie",
            
            // Wyszukane wyzwiska w wołaczu - skierowane bezpośrednio do osób
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
            
            // Zwroty bezpośrednio skierowane do osób
            "jebaj się", "spierdalaj", "wypierdalaj", "odpierdol się", "pieprz się",
            "jeb się", "spadaj", "odwal się", "skurwysynie", "skurwielu", "skurwysynu",
            "pojeb", "pierdol się",
            "chuj ci w dupę", "chuj ci w oko", "chuj ci w mordę", "chuj ci w ryj",
            "chuj ci w gardło", "chuj ci w ucho", "chuj ci w dupe", "chuj ci w buzię",
            "pizda ci w mordę", "pizda ci w ryj", "pizda ci w oko", "pizda ci w dupe",
            "kurwa ci w dupę", "kurwa ci w mordę", "kurwa ci w ryj", "kurwa ci w oko",
            "w dupie ci pies", "w dupie ci osioł", "w dupie ci diabeł", "w dupie ci kot",
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
            "mam cię w dupie", "mam was w dupie", "mam go w dupie",
            "ssij chuja", "ssij kutasa", "ssij fiuta", "ssij pale", "ssij mi",
            "lizać dupę", "lizać chuj", "lizać kutas", "lizać fiut", "lizać cipę",
            "ruchać w dupę", "ruchać w cipę", "ruchać w mordę", "ruchać w ryj",
            "jebać w dupę", "jebać w cipę", "jebać w mordę", "jebać w ryj",
            "pierdolić w dupę", "pierdolić w cipę", "pierdolić w mordę", "pierdolić w ryj",
            "jebał cię pies", "jebał cię kot", "jebał cię osioł", "jebał cię diabeł",
            "jebała cię kurwa", "jebała cię suka", "jebała cię dziwka", "jebała cię pizda",
            "pojebało cię", "pojebało go", "pojebało ją", "pojebało ich", "pojebało was",
            "zjebało cię", "zjebało go", "zjebało ją", "zjebało ich", "zjebało was",
            "pieprzy cię",
            
            // Nowe wyzwiska z czatu użytkowników - bardziej wyszukane formy
            "jebać ci matkę", "jebać ci ojca", "jebać ci babę", "jebać ci dziadka",
            "rucham ci matkę", "rucham ci ojca", "rucham ci babę", "rucham ci siostrę",
            "rucham ci rodzinę", "rucham ci całą rodzinę", "rucham wasze matki",
            "rucham wasze siostry", "rucham wasze baby", "rucham wasze rodziny",
            "zjebię cię", "zjebię was", "zjebię go", "zjebię ją", "zjebię ich",
            "zajebie cię", "zajebie was", "zajebie go", "zajebie ją", "zajebie ich",
            "zajebie cię i twoją rodzinę", "zajebie was i wasze rodziny",
            "śmieciu zjebany", "śmieciu pierdolony", "śmieciu sperdolony",
            "niech ci matka zdechnie", "niech ci ojciec zdechnie", "niech ci rodzina zdechnie",
            "niech zdechnie", "niech was diabli wezmą", "niech was piorun trzaśnie",
            "wypierdalaj ty szmato", "wypierdalaj ty szmacie", "wypierdalaj ty gnido",
            "szmato jebana", "szmato pierdolona", "szmato sperdolona", "szmato zjebana",
            "pierdolę was w dupala", "pierdolę cię w dupala", "pierdolę go w dupala",
            "do ryja w chuja ci wkładam", "do ryja ci wkładam", "w mordę ci wkładam",
            "ssiesz lache za darmo", "ssiesz pale za darmo", "ssiesz kutasa za darmo",
            "pierdolę wasze matki w dupę", "pierdolę wasze siostry w dupę",
            "skaczę wam po głowach", "skaczę ci po głowie", "skaczę wam po rybach",
            "chuj wam w dupę", "chuj ci w dupę", "chuj im w dupę", "chuj jej w dupę",
            "sperdolony", "sperdolona", "sperdolone", "sperdolił", "sperdoliła",
            "zjebany chuj", "zjebana kurwa", "zjebana suka", "zjebana pizda",
            "zajebie cie", "zajebie was", "zajebie go", "zajebie ją", "zajebie ich",
            "ty stara kurwo", "ty stary chuju", "ty stara suko", "ty stara pizdo",
            "ty stara dziwko", "ty stary pedale", "ty stary żulu", "ty stary kutasie",
            
            // Podobne zwroty - rozszerzenia tematyczne
            "jebać ci żonę", "jebać ci męża", "jebać ci dzieci", "jebać ci wnuki",
            "rucham ci żonę", "rucham ci męża", "rucham ci dzieci", "rucham ci córkę",
            "rucham ci syna", "rucham ci brata", "rucham ci bratową", "rucham ci szwagra",
            "pierdolę ci żonę", "pierdolę ci męża", "pierdolę ci dzieci", "pierdolę ci rodzinę",
            "chuj ci w żonę", "chuj ci w męża", "chuj ci w dzieci", "chuj ci w córkę",
            "chuj ci w syna", "chuj ci w brata", "chuj ci w siostrę", "chuj ci w babę",
            "niech ci żona zdechnie", "niech ci mąż zdechnie", "niech ci dzieci zdechną",
            "niech ci syn zdechnie", "niech ci córka zdechnie", "niech ci brat zdechnie",
            "zajebie ci żonę", "zajebie ci męża", "zajebie ci dzieci", "zajebie ci syna",
            "zajebie ci córkę", "zajebie ci brata", "zajebie ci siostrę", "zajebie ci babę",
            "śmieciu pierdolony", "śmieciu kurwiony", "śmieciu zjebany", "śmieciu sperdolony",
            "gnido jebana", "gnido pierdolona", "gnido sperdolona", "gnido zjebana",
            "bydlaku jebany", "bydlaku pierdolony", "bydlaku sperdolony", "bydlaku zjebany",
            "debilu jebany", "debilu pierdolony", "debilu sperdolony", "debilu zjebany",
            "kretynie jebany", "kretynie pierdolony", "kretynie sperdolony", "kretynie zjebany",
            "idioto jebany", "idioto pierdolony", "idioto sperdolony", "idioto zjebany",
            "chuju jebany", "chuju pierdolony", "chuju sperdolony", "chuju zjebany",
            "kurwo jebana", "kurwo pierdolona", "kurwo sperdolona", "kurwo zjebana",
            "suko jebana", "suko pierdolona", "suko sperdolona", "suko zjebana",
            "pizdo jebana", "pizdo pierdolona", "pizdo sperdolona", "pizdo zjebana",
            "dziwko jebana", "dziwko pierdolona", "dziwko sperdolona", "dziwko zjebana",
            "pedale jebany", "pedale pierdolony", "pedale sperdolony", "pedale zjebany",
            "żulu jebany", "żulu pierdolony", "żulu sperdolony", "żulu zjebany",
            "kutasie jebany", "kutasie pierdolony", "kutasie sperdolony", "kutasie zjebany",
            
            // Wyzwiska skierowane do grupy osób (forma "wy")
            "wy kurwy", "wy chuje", "wy pizdy", "wy suki", "wy dziwki", "wy debile", 
            "wy idioci", "wy kretyny", "wy śmiecie", "wy gnidy", "wy bydlaki", 
            "wy szuje", "wy cwele", "wy pedały", "wy żule", "wy kutasy",
            "wy chamy", "wy barbarzyńcy", "wy prostacy", "wy gbory", "wy wieśniacy",
            "wy ciemnocioty", "wy matołki", "wy tępacy", "wy głąby", "wy durnie",
            "wy głupcy", "wy imbecyle", "wy mohery", "wy cepy", "wy balwany",
            "wy osłupy", "wy bałwany", "wy ciule", "wy pajace", "wy klauni",
            "wy błaźni", "wy mendy", "wy łajzy", "wy łobuzy", "wy szubrawcy",
            "wy nicponie", "wy łajdacy", "wy bandziory", "wy hochsztaplerzy",
            "wy oszuści", "wy kanaliki", "wy łotry", "wy zbóje", "wy rozbójnicy",
            "wy bandyci", "wy gangsterzy", "wy złodzieje", "wy złoczyńcy",
            "wy awanturnicy", "wy hulajnogi", "wy rozpustnicy", "wy hedoniści",
            "wy pijacy", "wy alkohole", "wy narkomany", "wy ćpuny", "wy psychopaci",
            "wy sadyści", "wy maniacy", "wy zboczency", "wy degeneraci", "wy patologii",
            "wy marginesy", "wy szumowiny", "wy żyły", "wy pasożyty", "wy pijawki",
            "wy darmozjady", "wy obibocy", "wy próżniacy", "wy leniwcy", "wy nieroboty",
            "wy ofermy", "wy niedojdy", "wy nieudacznicy", "wy przegrywy", "wy frajery",
            "wy naiwniacy", "wy głupcy", "wy bałwochwalcy", "wy fanatycy", "wy sekciarze",
            "wy hipokryci", "wy świętoszki", "wy obłudnicy", "wy kłamczuchy",
            "wy manipulatory", "wy intryganci", "wy karierowicze", "wy oportuniści",
            "wy podlizywacze", "wy serwiliści", "wy pachołki", "wy lakaje", "wy sługusy",
            "wy wasale", "wy ignoranci", "wy analfabeci", "wy niedouczki", "wy dzikusy",
            "wy wandale", "wy niszczyciele", "wy burzyciele", "wy agitatorzy",
            "wy ekstremiści", "wy radykałowie", "wy terroryści", "wy kretyńscy",
            "wy niedorozwinieci", "wy upośledzeni", "wy niedorajdy", "wy smarkacze",
            "wy pisklaki", "wy bachory", "wy szczeniaki", "wy gówniarze", "wy smyki",
            "wy gołowązy", "wy zadziory", "wy urwisy",
            
            // Zwroty do grup z "was"
            "mam was w dupie", "jebał was pies", "jebał was kot", "jebał was osioł",
            "jebał was diabeł", "jebała was kurwa", "jebała was suka", "jebała was dziwka",
            "jebała was pizda", "spierdalajcie", "wypierdalajcie", "odpierdolcie się",
            "jebajcie się", "pierdolcie się", "spadajcie", "odwalcie się",
            "spierdalajcie stąd", "wypierdalajcie stąd", "odpierdolcie się stąd",
            "jebajcie się stąd", "idźcie się jebać", "idźcie się pieprzyć",
            "idźcie do dupy", "idźcie do chuja", "idźcie do pizdy",
            
            // Angielskie wyzwiska skierowane bezpośrednio do osób
            "fuck off", "fuck you", "go to hell", "kiss my ass",
            "suck my dick", "eat shit", "dickhead", "asshole", "motherfucker",
            "cocksucker", "bastard", "bitch", "bite me", "piss off", "piss on you",
            "go screw yourself", "screw you", "shithead", "shitface", "dipshit",
            "dumbass", "jackass", "smartass", "kiss my butt", "up yours", "blow me",
            "suck it", "get stuffed", "go jump off a cliff", "drop dead", "go die",
            "kill yourself", "shut the hell up", "shut the fuck up", "fuck off and die",
            "go fuck yourself", "fuck your mother", "your mom", "your mama",
            "son of a bitch", "piece of shit",

            // === FORMY BAZOWE (mianownik) - brakujące w oryginalnej liście ===
            // Rzeczowniki wulgarne
            "kurwa", "chuj", "pizda", "kutas", "fiut", "cipka", "cipa", "dupa", "dupek",
            "kurwiszon", "kurwiszonie", "kurewnik", "kurewstwo", "kurewstwem",
            "pierdolec", "pierdolcu", "pierdolstwo", "chujnia", "jebaka", "jebaku",
            "gówno", "gównie", "gówna", "gównem", "sraka", "srakę", "sraką",

            // Formy odmienione (deklinacja)
            "kurwy", "kurwą", "kurwom", "kurwami",
            "chuja", "chujowi", "chuje", "chujom", "chujami", "chujów",
            "pizdy", "pizdzie", "pizdę", "pizdą", "pizdom", "pizd",
            "kutasa", "kutasowi", "kutasem", "kutasów",
            "fiuta", "fiutowi", "fiutem", "fiuty",
            "cipki", "cipce", "cipkę", "cipką", "cipek",
            "cipy", "cipie", "cipę", "cipą",
            "dupy", "dupie", "dupę", "dupą", "dup", "dupom", "dupami",
            "dupka", "dupkowi", "dupkiem",

            // === PRZYMIOTNIKI I PRZYSŁÓWKI POCHODNE ===
            "jebany", "jebana", "jebane", "jebanego", "jebanej", "jebanych", "jebanym",
            "pierdolony", "pierdolona", "pierdolone", "pierdolonego", "pierdolonej", "pierdolonych",
            "skurwiony", "skurwiona", "skurwione", "skurwionego",
            "kurewski", "kurewska", "kurewskie", "kurewskiego", "kurewskiej",
            "chujowy", "chujowa", "chujowe", "chujowego",
            "dupny", "dupna", "dupne",
            "zajebany", "zajebana", "zajebane", "zajebanego",
            "pojebany", "pojebana", "pojebane", "pojebanego",
            "wyjebany", "wyjebana", "wyjebane",
            "przejebany", "przejebana", "przejebane",
            "jebliwy", "jebliwa", "jebliwe",
            "pierdolnięty", "pierdolnięta", "pierdolnięte",
            "jebnięty", "jebięta", "jebięte",
            "zajebisty", "zajebista", "zajebiste", "zajebiście",
            "zapierdolony", "zapierdolona", "zapierdolone",

            // === CZASOWNIKI (formy osobowe) ===
            "jebać", "jebię", "jebiesz", "jebie", "jebał", "jebała", "jebało", "jebali",
            "pierdolić", "pierdolę", "pierdolisz", "pierdoli", "pierdolił", "pierdoliła",
            "ruchać", "rucham", "ruchasz", "rucha", "ruchał", "ruchała",
            "srać", "sram", "srasz", "srał", "srała",
            "onanizować", "onanizuje", "masturbować", "masturbuje",
            "zajebać", "zajebie", "zajebał", "zajebała",
            "wyjebać", "wyjebie", "wyjebał", "wyjebała",
            "przejebać", "przejebie", "przejebał",
            "pojebać", "pojebie", "pojebał",
            "spierdolić", "spierdoli", "spierdolił",
            "opierdolić", "opierdoli", "opierdolił",
            "przypierdolić", "przypierdoli",
            "napierdolić", "napierdoli",
            "zapierdolić", "zapierdoli",
            "odpierdolić", "odpierdoli",
            "wypierdolić", "wypierdoli",
            "spierdalać", "spierdala",
            "wypierdolić", "wyjebywać",
            "ruchnąć", "ruchnął", "ruchnęła",
            "dupczyć", "dupczy", "dupczył",
            "wyruchać", "wyruchał", "wyruchała",
            "zjebać", "zjebie", "zjebał", "zjebała",

            // === RASISTOWSKIE / KSENOFOBICZNE (polskie internet) ===
            "kacap", "kacapie", "kacapy", "kacapów", "kacapski", "kacapska",
            "moskal", "moskale", "moskalu", "moskali", "moskalski",
            "rusek", "rusku", "ruskowi", "ruskie", "ruska",
            "ciapaty", "ciapacie", "ciapatym", "ciapatego", "ciapate",
            "bambus", "bambusie", "bambusy", "bambusów",
            "żydek", "żydku", "żydkowi", "żydki",
            "szkop", "szkopie", "szkopu", "szkopy", "szkopów",
            "szwab", "szwabie", "szwabu", "szwaby",
            "murzyn", "murzynie", "murzyna", "murzynem", "murzyni", "murzynów",
            "czarnuch", "czarnuchu", "czarnucha", "czarnuchy",
            "małpa" /* rasistowskie wobec czarnoskórych */,
            "paker", "pakier",
            "cygan" /* w kontekście obraźliwym */, "cyganie",

            // === HOMOFOBICZNE / TRANSFOBICZNE ===
            "pedał", "pedały", "pedałów", "pedałom", "pedałem",
            "pedałek", "pedałku",
            "pederasta", "pederaście", "pederastów", "pederasty",
            "lesba", "lesbo", "lesby", "lesbie", "lesb",
            "ciota", "ciocie", "ciot", "ciotą", "ciotom",
            "zboczeń", "zboczeniec", "zboczeńcy",
            "transa", "transie" /* w użyciu obraźliwym */,
            "pedałować", "pedałuje",

            // === ANGIELSKIE SLURY (brakujące) ===
            "nigger", "nigga", "nigg", "n-word",
            "faggot", "fagg", "fags",
            "cunt", "cunts",
            "whore", "whores",
            "slut", "slutty", "sluts",
            "retard", "retarded", "retards",
            "spastic", "spaz",
            "kike", "kikes",
            "chink", "chinks",
            "wetback", "wetbacks",
            "tranny", "trannies",
            "dyke", "dykes",
            "cracker" /* rasistowskie */, "crackers",
            "spic", "spics",
            "gook", "gooks",
            "towelhead", "sandnigger",

            // === SLANG INTERNETOWY / NOWOCZESNE WYZWISKA ===
            "dzban", "dzbanie", "dzbanku", "dzbany",
            "patola", "patolasie", "patolas", "patole",
            "dresik", "dresiaku", "dresiak", "dresy", "driszcz", "dresiara",
            "seba", "sebku", "sebek",
            "śmierdziel", "śmierdzieciu",
            "ćwok", "ćwoku", "ćwoki",
            "burak" /* jako obraźliwe */, "buraku",
            "plebs", "plebsie",
            "normik", "normiku",
            "janusz" /* jako obraźliwe */, "januszek",
            "grażyna" /* jako obraźliwe */,
            "hejter", "hejterze",
            "troglodyta", "troglodyto",
            "nieuk", "nieuuku",
            "tuman", "tumanie",
            "obibok", "obiboku",
            "bzdurnik", "bzdurniku",
            "pieniacz", "pieniaczu",
            "kłótnik", "kłótniku",
            "pienisty",

            // === ARCHAICZNE / RZADKIE POLSKIE WULGARYZMY ===
            "bździna", "bździno",
            "świntuch", "świntuchu", "świntuszka",
            "szelma", "szelmie",
            "hultaj", "hultaju",
            "łotr", "łotrze" /* już istnieje */,
            "pinda", "pindzie", "pindy",
            "gałgan", "gałganie",
            "huncwot", "huncwocie",
            "niecnota", "niecnoto",
            "plugawiec", "plugawcze",
            "sprośnik", "sprośniku",
            "ladacznica", "ladacznico",
            "wszetecznica", "wszetecznico",
            "wszetecznik", "wszeteczniku",
            "nierządnica", "nierządnico",
            "swołocz", "swołoczy",
            "bydlę", "bydlęciu",
            "pomiot", "pomiocie",
            "szumowina", "szumowinę" /* już mamy "szumowino" */,
            "wyrzutek", "wyrzutku",
            "potwór", "potworze",
            "ohyda", "ohydo",
            "zwyrodnienie", "zwyrodniałe",
            "zwyrodniały", "zwyrodniała",

            // === WYZWISKA NA TLE RELIGIJNYM / POLITYCZNYM (polskie internet) ===
            "pisowiec", "pisowcy", "pisowców", "pisiorze", "pisiory",
            "lemingiem", "leming", "lemingi", "lemingów",
            "moherowy beret", "moherowe berety", "mohery", "moherze",
            "watykaniarz", "watykaniarzu",
            "klecha", "klechu", "klechów",
            "popie" /* w kontekście obraźliwym */,
            "oszołom", "oszołomie", "oszołomy",
            "faszystowski", "faszystowska", "faszysto", "faszyście",
            "komunisto", "komuniście", "komuno",
            "nazisto", "naziście", "nazi",
            "bolszewiku", "bolszewicki",
            "zdrajco", "zdrajcy", "zdrajców",
            "zaprzańcu", "zaprzaniec",
            "kolaborancie", "kolaborant",
            "donosicielu", "donosiciel",

            // === DYSKRYMINUJĄCE DOTYCZĄCE SPRAWNOŚCI / WYGLĄDU ===
            "grubas", "grubasie", "grubasku", "grubaska",
            "tłuścioch", "tłuściochu",
            "kaleka", "kaleko", "kalecy",
            "ślepak", "ślepaku",
            "głuchak", "głuchachu",
            "kulawy", "kulawa", "kulawi",
            "garbaty", "garbata", "garbacie",
            "brzydal", "brzydalu",
            "potwora", "potworze",
            "szczapa" /* zbyt chuda osoba */,
            "wrak" /* o wyglądzie */
        ];
    }

    /**
     * Wczytuje listę wyzwisk z pliku
     */
    loadBadWords() {
        try {
            const data = fs.readFileSync(this.badWordsFile, 'utf8');
            this.badWords = safeParse(data, {});
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

        // Najpierw sprawdź całe frazy (długie zwroty)
        for (const badWord of this.badWords) {
            if (badWord.includes(' ')) {
                // Dla fraz (np. "jebaj się", "chuj ci w dupę")
                if (normalized.includes(badWord)) {
                    foundBadWords.push({
                        word: badWord,
                        original: badWord,
                        normalized: badWord,
                        type: 'phrase'
                    });
                }
            }
        }

        // Jeśli znaleziono frazy, nie sprawdzaj pojedynczych słów
        if (foundBadWords.length > 0) {
            return foundBadWords;
        }

        // Sprawdź pojedyncze słowa tylko jeśli nie ma fraz
        for (const badWord of this.badWords) {
            if (!badWord.includes(' ')) {
                // Dla pojedynczych słów - sprawdź tylko jako całe słowa z word boundaries
                const wordBoundaryPattern = new RegExp(`\\b${badWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(em|ami|ach|ów|y|i|a|e|o|u|ie|ę|ą)?\\b`, 'i');
                
                if (wordBoundaryPattern.test(normalized)) {
                    // Dodatkowo sprawdź czy to nie jest część zwykłej frazy
                    const isPartOfNormalPhrase = this.isPartOfNormalPhrase(normalized, badWord);
                    
                    if (!isPartOfNormalPhrase) {
                        foundBadWords.push({
                            word: badWord,
                            original: badWord,
                            normalized: badWord,
                            type: 'word'
                        });
                    }
                }
            }
        }

        return foundBadWords;
    }

    /**
     * Sprawdza czy słowo jest częścią normalnej frazy i nie powinno być flagowane
     * @param {string} text - Pełny tekst
     * @param {string} word - Sprawdzane słowo
     * @returns {boolean} True jeśli jest częścią normalnej frazy
     */
    isPartOfNormalPhrase(text, word) {
        const normalPhrases = [
            'w dupie', 'na dupie', 'z dupy', 'do dupy', 'przy dupie', 'pod dupą', 'nad dupą',
            'pojebało', 'pojebane', 'pojebany', 'pojebana', 'pojebaną', 'pojebanego',
            'nie dupie', 'nie dupa', 'w dupe', 'na dupe', 'z dupe', 'dupie maryni'
        ];

        for (const phrase of normalPhrases) {
            if (text.includes(phrase) && phrase.includes(word)) {
                return true;
            }
        }

        return false;
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

        // Loguj wszystkie wykryte wyzwiska w konsoli
        const badWordsText = badWords.map(word => word.original).join(', ');
        this.logger.info(`🔍 Wykryte wyzwiska: ${message.author.tag} (${message.author.id}) na kanale #${message.channel.name} - Słowa: ${badWordsText} - Treść: "${message.content}"`);
        

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

        // Sprawdź czy przekroczono limit lub użytkownik już ma warny
        const existingWarnings = this.getUserWarningsInHour(userId, guildId);
        
        if (userViolations.count >= this.config.autoModeration.violationsBeforeWarn || existingWarnings > 0) {
            // Nie resetuj licznika - pozwól na kolejne warny
            
            // Dodaj automatyczny warn
            if (!this.warningService || typeof this.warningService.addWarning !== 'function') {
                this.logger.error('❌ WarningService nie jest dostępny lub nie ma metody addWarning');
                return { action: 'ignore' };
            }
            
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
        if (!this.warningService || typeof this.warningService.getUserWarnings !== 'function') {
            this.logger.error('❌ WarningService nie jest dostępny lub nie ma metody getUserWarnings');
            return 0;
        }
        
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
     * Czyści licznik wyzwisk dla konkretnego użytkownika
     * @param {string} userId - ID użytkownika
     */
    clearViolations(userId) {
        if (this.violationCounts.has(userId)) {
            this.violationCounts.delete(userId);
            this.logger.info(`Wyczyszczono licznik wyzwisk dla użytkownika ${userId}`);
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