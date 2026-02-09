const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

/**
 * AI Chat Service - Kompendium wiedzy o grze Survivor.io
 * Wspiera mention @Szkolenia z bazą wiedzy z pliku knowledge_base.md
 */
class AIChatService {
    constructor(config) {
        this.config = config;

        // Anthropic API
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.SZKOLENIA_AI_CHAT_MODEL || 'claude-3-haiku-20240307';
            logger.success('✅ AI Chat aktywny - model: ' + this.model);
        } else {
            logger.warn('⚠️ AI Chat wyłączony - brak ANTHROPIC_API_KEY');
        }

        // Limity
        this.cooldownMinutes = 1; // 1 minuta

        // Persistent storage
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'ai_chat_cooldowns.json');
        this.knowledgeBaseFile = path.join(__dirname, '../knowledge_base.md'); // Zasady ogólne
        // Osobna baza wiedzy per kanał + plik korekt
        this.knowledgeFiles = AIChatService.KNOWLEDGE_CHANNEL_IDS.map(id =>
            path.join(this.dataDir, `knowledge_${id}.md`)
        );
        this.correctionsFile = path.join(this.dataDir, 'knowledge_corrections.md');

        // In-memory cache
        this.cooldowns = new Map(); // userId -> timestamp

        // Load data
        this.loadData();
    }

    /**
     * Wczytaj dane z plików
     */
    async loadData() {
        try {
            // Cooldowns
            try {
                const cooldownData = await fs.readFile(this.cooldownsFile, 'utf8');
                const parsed = JSON.parse(cooldownData);
                this.cooldowns = new Map(Object.entries(parsed));
            } catch (err) {
                // Plik nie istnieje - OK
                this.cooldowns = new Map();
            }

            // Cleanup starych danych (starsze niż 2 dni)
            this.cleanupOldData();
        } catch (error) {
            logger.error(`Błąd wczytywania danych AI Chat: ${error.message}`);
        }
    }

    /**
     * Zapisz dane do plików
     */
    async saveData() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            // Cooldowns
            const cooldownObj = Object.fromEntries(this.cooldowns);
            await fs.writeFile(this.cooldownsFile, JSON.stringify(cooldownObj, null, 2));
        } catch (error) {
            logger.error(`Błąd zapisywania danych AI Chat: ${error.message}`);
        }
    }

    /**
     * Cleanup starych danych
     */
    cleanupOldData() {
        const now = Date.now();
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

        // Usuń stare cooldowny
        for (const [userId, timestamp] of this.cooldowns.entries()) {
            if (timestamp < twoDaysAgo) {
                this.cooldowns.delete(userId);
            }
        }
    }

    /**
     * Wczytaj zasady ogólne (knowledge_base.md) - statyczne, cache'owane w system prompt
     */
    async loadKnowledgeRules() {
        try {
            return await fs.readFile(this.knowledgeBaseFile, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('⚠️ Plik knowledge_base.md nie istnieje');
            }
            return '';
        }
    }

    /**
     * Wczytaj bazę wiedzy ze wszystkich plików kanałów
     * @returns {string[]} Tablica treści z każdego pliku
     */
    async loadAllKnowledgeData() {
        const allFiles = [...this.knowledgeFiles, this.correctionsFile];
        const results = [];
        for (const filePath of allFiles) {
            try {
                const content = await fs.readFile(filePath, 'utf8');
                results.push(content);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.error(`❌ Błąd wczytywania ${filePath}: ${error.message}`);
                }
                results.push('');
            }
        }
        return results;
    }

    /**
     * Parsuj ocenę z sekcji bazy wiedzy
     * Format: [2026-02-09 | Janusz] [++] Treść → rating: 2
     * Format: [---] Treść → rating: -3
     */
    parseRating(section) {
        const match = section.match(/^(\[[\d-]+\s*\|\s*[^\]]+\]\s*)?\[([+-]+)\]\s*/);
        if (match) {
            const signs = match[2];
            const rating = signs[0] === '+' ? signs.length : -signs.length;
            const cleanSection = section.replace(/\[([+-]+)\]\s*/, '');
            return { rating, cleanSection };
        }
        return { rating: 0, cleanSection: section };
    }

    /**
     * Zaktualizuj ocenę w sekcji bazy wiedzy
     */
    updateSectionRating(section, newRating) {
        const { cleanSection } = this.parseRating(section);

        if (newRating === 0) return cleanSection;

        const sign = newRating > 0 ? '+' : '-';
        const marker = `[${sign.repeat(Math.abs(newRating))}] `;

        // Wstaw marker po nagłówku [data | autor] lub na początku
        const headerMatch = cleanSection.match(/^(\[[\d-]+\s*\|\s*[^\]]+\]\s*)/);
        if (headerMatch) {
            return headerMatch[1] + marker + cleanSection.slice(headerMatch[1].length);
        }
        return marker + cleanSection;
    }

    /**
     * Wyszukaj relevantne sekcje z bazy wiedzy na podstawie pytania
     * Zamiast wysyłać CAŁĄ bazę do AI, filtruje tylko pasujące fragmenty
     * @param {string} question - Pytanie użytkownika
     * @param {string} knowledgeData - Pełna zawartość knowledge_data.md
     * @returns {string|null} - Relevantne fragmenty lub null jeśli brak dopasowań
     */
    searchKnowledge(question, knowledgeData) {
        if (!knowledgeData || !knowledgeData.trim() || !question) return null;

        // Podziel bazę wiedzy na sekcje (po podwójnych newline'ach)
        const sections = knowledgeData.split(/\n\n+/).filter(s => s.trim().length > 0);
        if (sections.length === 0) return null;

        // Jeśli baza jest mała (≤5 sekcji), zwróć całość - nie warto filtrować
        if (sections.length <= 5) return knowledgeData;

        // Polskie stop words - pomijane przy wyszukiwaniu
        const stopWords = new Set([
            'jak', 'co', 'to', 'jest', 'czy', 'ile', 'jaki', 'jaka', 'jakie',
            'gdzie', 'kiedy', 'kto', 'dlaczego', 'który', 'która', 'które',
            'ten', 'ta', 'te', 'tym', 'tej', 'tego', 'tych',
            'się', 'nie', 'tak', 'ale', 'lub', 'albo', 'ani',
            'na', 'do', 'od', 'po', 'za', 'ze', 'we', 'przy',
            'są', 'być', 'mam', 'masz', 'ma', 'mają',
            'bardzo', 'też', 'jeszcze', 'już', 'tylko', 'może',
            'dla', 'przez', 'pod', 'nad', 'przed', 'między',
            'mi', 'mnie', 'ci', 'cię', 'go', 'mu', 'ich', 'im',
            'o', 'w', 'z', 'i', 'a'
        ]);

        // Wyciągnij słowa kluczowe z pytania (min 2 znaki, bez stop words)
        const keywords = question.toLowerCase()
            .replace(/[^\w\sąćęłńóśźż]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length >= 2 && !stopWords.has(word));

        // Brak słów kluczowych → zwróć całą bazę (fallback)
        if (keywords.length === 0) return knowledgeData;

        // Oceń każdą sekcję pod kątem dopasowania do pytania + oceny użytkowników
        const scoredSections = sections.map((section, index) => {
            const { rating, cleanSection } = this.parseRating(section);

            // Pomijaj sekcje z oceną ≤ -5 (do usunięcia)
            if (rating <= -5) return { index, section, cleanSection, score: -Infinity, matchedKeywords: [] };

            const sectionLower = cleanSection.toLowerCase();
            let score = 0;
            const matchedKeywords = [];

            // Punkty za każde dopasowanie słowa kluczowego
            for (const keyword of keywords) {
                const regex = new RegExp(keyword, 'gi');
                const matches = sectionLower.match(regex);
                if (matches) {
                    score += matches.length;
                    matchedKeywords.push(keyword);
                }
            }

            // Bonus za dopasowanie pełnej frazy pytania
            const questionClean = question.toLowerCase().replace(/[^\w\sąćęłńóśźż]/g, '');
            if (sectionLower.includes(questionClean)) {
                score += 10;
            }

            // Bonus za bigramy (pary kolejnych słów kluczowych)
            for (let i = 0; i < keywords.length - 1; i++) {
                if (sectionLower.includes(keywords[i] + ' ' + keywords[i + 1])) {
                    score += 3;
                }
            }

            // Bonus/kara za ocenę użytkowników (+1 za każdy plus, -1 za każdy minus)
            score += rating;

            return { index, section, cleanSection, score, matchedKeywords };
        });

        // Dla każdego keyword zbierz top 10 sekcji, potem zdeduplikuj
        const selectedIndices = new Set();
        for (const keyword of keywords) {
            const keywordSections = scoredSections
                .filter(s => s.score > 0 && s.matchedKeywords.includes(keyword))
                .sort((a, b) => b.score - a.score)
                .slice(0, 30);
            for (const s of keywordSections) {
                selectedIndices.add(s.index);
            }
        }

        const relevant = scoredSections
            .filter(s => selectedIndices.has(s.index))
            .sort((a, b) => b.score - a.score);

        if (relevant.length === 0) return null;

        logger.info(`🔍 Keyword search: ${sections.length} sekcji → ${relevant.length} relevantnych (keywords: ${keywords.join(', ')})`);
        // Zwracaj czyste sekcje (bez markerów ocen) - AI nie widzi [+++]/[---]
        return relevant.map(s => s.cleanSection).join('\n\n');
    }

    /**
     * Sprawdź czy użytkownik jest administratorem/moderatorem
     */
    isAdmin(member) {
        if (!member) return false;

        // Role administracyjne z config (jeśli istnieją)
        const adminRoles = this.config.adminRoles || [];
        return member.roles.cache.some(role => adminRoles.includes(role.id));
    }

    /**
     * Sprawdź czy użytkownik ma rolę klanową
     */
    hasAnyClanRole(member) {
        if (!member) return false;

        // Role klanowe z config
        const clanRoles = this.config.roles?.clan || [];
        return member.roles.cache.some(role => clanRoles.includes(role.id));
    }

    /**
     * Sprawdź czy użytkownik może zadać pytanie
     */
    canAsk(userId, member = null) {
        // Administratorzy nie mają limitów
        if (member && this.isAdmin(member)) {
            return { allowed: true, isAdmin: true };
        }

        const now = Date.now();

        // Sprawdź cooldown
        const lastAsk = this.cooldowns.get(userId);
        if (lastAsk) {
            const timeSinceLastAsk = now - lastAsk;
            const cooldownMs = this.cooldownMinutes * 60 * 1000;

            if (timeSinceLastAsk < cooldownMs) {
                const remainingMs = cooldownMs - timeSinceLastAsk;
                const remainingMinutes = Math.ceil(remainingMs / 60000);
                return {
                    allowed: false,
                    reason: `cooldown`,
                    remainingMinutes
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Zapisz że użytkownik zadał pytanie
     */
    recordAsk(userId, member = null) {
        // Administratorzy nie mają limitów - nie zapisuj statystyk
        if (member && this.isAdmin(member)) {
            return;
        }

        const now = Date.now();

        // Zapisz cooldown
        this.cooldowns.set(userId, now);

        // Zapisz do pliku (async, nie czekaj)
        this.saveData().catch(err => {
            logger.error(`Błąd zapisywania AI Chat stats: ${err.message}`);
        });
    }

    /**
     * Zbierz kontekst dla pytania użytkownika
     */
    async gatherContext(message, question) {
        const context = {
            asker: {
                id: message.author.id,
                username: message.author.username,
                displayName: message.member?.displayName || message.author.username,
                roles: message.member?.roles.cache.map(r => r.name) || []
            },
            guild: {
                id: message.guild.id,
                name: message.guild.name
            },
            channel: {
                id: message.channel.id,
                name: message.channel.name
            },
            question: question
        };

        return context;
    }

    /**
     * Zapisz prompt do pliku w folderze data/prompts/
     */
    async savePromptToFile(promptContent, userDisplayName) {
        try {
            // Utwórz katalog jeśli nie istnieje
            const promptsDir = path.join(__dirname, '../data/prompts');
            await fs.mkdir(promptsDir, { recursive: true });

            // Przygotuj timestamp dla nazwy pliku (YYYY-MM-DD_HH-mm-ss)
            const now = new Date();
            const timestamp = now.toISOString()
                .replace(/T/, '_')
                .replace(/:/g, '-')
                .split('.')[0];

            // Wyczyść nick z niedozwolonych znaków w nazwie pliku
            const safeNick = userDisplayName.replace(/[<>:"/\\|?*]/g, '_');

            // Nazwa pliku: <nick>_<timestamp>.txt
            const filename = `${safeNick}_${timestamp}.txt`;
            const filePath = path.join(promptsDir, filename);

            // Zapisz prompt do pliku
            await fs.writeFile(filePath, promptContent, 'utf-8');

            logger.info(`📄 Zapisano prompt do pliku: ${filename}`);
        } catch (error) {
            logger.error(`❌ Błąd zapisu promptu do pliku: ${error.message}`);
        }
    }

    /**
     * Zbuduj system prompt (statyczny - cache'owany przez Anthropic API)
     * Ten prompt jest identyczny dla każdego pytania, więc prompt caching oszczędza ~90% tokenów
     */
    /**
     * Definicja narzędzia grep_knowledge dla AI (tool_use)
     */
    static GREP_TOOL = {
        name: 'grep_knowledge',
        description: 'Przeszukuje bazę wiedzy o grze Survivor.io. Zwraca WSZYSTKIE fragmenty pasujące do wzorca (regex lub tekst). Możesz wywoływać wielokrotnie z różnymi frazami. Szukaj aż znajdziesz dokładną odpowiedź.',
        input_schema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Fraza lub regex do wyszukania w bazie wiedzy (case-insensitive). Np. "transmute", "ciastk", "pet.*awaken", "xeno.*core"'
                }
            },
            required: ['pattern']
        }
    };

    /**
     * Wykonaj wyszukiwanie grep w bazach wiedzy (wszystkie pliki kanałów)
     * @param {string} pattern - Fraza/regex do wyszukania
     * @param {string[]} knowledgeDataArray - Tablica treści z każdego pliku
     * @returns {string} Znalezione fragmenty lub info o braku wyników
     */
    executeGrepKnowledge(pattern, knowledgeDataArray) {
        if (!pattern) return 'Podaj frazę do wyszukania.';

        let regex;
        try {
            regex = new RegExp(pattern, 'gi');
        } catch (err) {
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        }

        const correctionMatches = [];
        const regularMatches = [];
        const correctionsIndex = knowledgeDataArray.length - 1;

        for (let i = 0; i < knowledgeDataArray.length; i++) {
            const data = knowledgeDataArray[i];
            if (!data || !data.trim()) continue;
            const sections = data.split(/\n\n+/).filter(s => s.trim().length > 0);
            const isCorrections = i === correctionsIndex;

            for (const section of sections) {
                const { rating, cleanSection } = this.parseRating(section);
                if (rating <= -5) continue;

                if (regex.test(cleanSection)) {
                    if (isCorrections) {
                        correctionMatches.push(`[KOREKTA UŻYTKOWNIKA] ${cleanSection}`);
                    } else {
                        regularMatches.push(cleanSection);
                    }
                    regex.lastIndex = 0;
                }
            }
        }

        const allMatches = [...correctionMatches, ...regularMatches];

        if (allMatches.length === 0) {
            return `Brak wyników dla "${pattern}". Spróbuj innej frazy lub krótszego wzorca.`;
        }

        return `Znaleziono ${allMatches.length} fragmentów (${correctionMatches.length} korekt):\n\n${allMatches.join('\n\n---\n\n')}`;
    }

    buildSystemPrompt(knowledgeRules) {
        let systemPrompt = `Jesteś kompendium wiedzy o grze Survivor.io.

MASZ NARZĘDZIE: grep_knowledge
- Użyj go aby przeszukać bazę wiedzy ZANIM odpowiesz
- Możesz wywoływać WIELOKROTNIE z różnymi frazami - BEZ LIMITU
- Zwraca WSZYSTKIE pasujące fragmenty
- Używaj krótkich fraz: "transmute", "ciastk", "pet", "xeno", "awaken"
- Możesz używać regex: "pet.*level", "ciastk.*60"

STRATEGIA WYSZUKIWANIA:
1. ZAWSZE NAJPIERW szukaj DOKŁADNIE słów z pytania użytkownika (po polsku!)
   - Pytanie "najlepsza broń" → szukaj "broń", NIE "weapon"
   - Pytanie "rozwój petów" → szukaj "pet", NIE "evolve"
   - Pytanie "ile ciastek" → szukaj "ciast", NIE "cake"
2. NIGDY nie tłumacz polskich słów na angielski w pierwszym wyszukiwaniu
3. Dopiero jeśli polskie frazy nic nie dają → spróbuj angielskich odpowiedników
4. Jeśli pierwsze wyszukiwanie nie daje PEŁNEJ odpowiedzi → SZUKAJ DALEJ z inną frazą
5. Jeśli pytanie o koszty/ilości → szukaj po nazwie przedmiotu, potem po "koszt", "ile", konkretne liczby
6. NIE PODDAWAJ SIĘ po 1-2 wyszukiwaniach - szukaj dopóki nie znajdziesz dokładnej odpowiedzi
6. Dopiero gdy wielokrotne wyszukiwania nic nie dają → odpowiedz że nie masz informacji

KOREKTY UŻYTKOWNIKÓW:
- Jeśli w promptie użytkownika są "KOREKTY UŻYTKOWNIKÓW" → to ZWERYFIKOWANE odpowiedzi od graczy
- Mają NAJWYŻSZY priorytet nad innymi danymi z bazy wiedzy
- Jeśli korekta odpowiada na pytanie → użyj jej natychmiast BEZ szukania dalej
- Jeśli korekta mówi coś innego niż reszta bazy → KOREKTA ma rację

KRYTYCZNE ZASADY:
- Odpowiadaj TYLKO na podstawie znalezionych informacji
- ABSOLUTNY ZAKAZ wymyślania postaci, umiejętności, statystyk, mechanik
- Jeśli po wielu wyszukiwaniach nie znalazłeś odpowiedzi → powiedz że nie masz informacji

STYL ODPOWIEDZI:
- Po polsku, krótko (max 3-4 zdania)
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."

FOKUS NA TEMAT PYTANIA:
- Odpowiadaj WYŁĄCZNIE na temat pytania
- Ignoruj znalezione fragmenty które nie dotyczą tematu
- Lepiej krótka celna odpowiedź niż długa z domieszką niezwiązanych tematów

ROZUMOWANIE I ANALIZA:
- Łącz dane z różnych fragmentów, obliczaj, porównuj
- Jeśli nie masz dokładnych danych ale masz powiązane → podaj co masz i oszacuj
- Częściowa odpowiedź > "nie wiem"

AKTUALNOŚĆ DANYCH (WAŻNE):
- Każdy wpis ma datę: [YYYY-MM-DD | Autor]
- Dane w grze się ZMIENIAJĄ (balanse, aktualizacje, nowe itemy)
- ZAWSZE preferuj NOWSZE wpisy (2025-2026) nad starszymi (2024)
- Jeśli starszy wpis mówi jedno, a nowszy drugie → NOWSZY ma rację
- Jeśli masz tylko stare dane → podaj je, ale zaznacz że mogą być nieaktualne

ZAKOŃCZENIE:
- Zakończ: "Oceń odpowiedź kciukiem 👍/👎!"
- NIGDY nie dodawaj "baza nie zawiera..."

PRZYKŁADY NIEPOPRAWNEGO ZACHOWANIA:
❌ Wymyślanie statystyk, nazw, umiejętności
❌ Odpowiadanie BEZ użycia grep_knowledge
❌ Dodawanie "niestety baza nie zawiera..." po udzieleniu odpowiedzi`;

        if (knowledgeRules) {
            systemPrompt += `\n\n${knowledgeRules}`;
        }

        return systemPrompt;
    }

    /**
     * Zbuduj user prompt (dynamiczny - tylko pytanie, baza wiedzy dostępna przez narzędzie)
     */
    async buildUserPrompt(context) {
        // Wczytaj korekty użytkowników - zawsze dołączone do promptu (priorytetowe)
        let correctionsContent = '';
        try {
            correctionsContent = await fs.readFile(this.correctionsFile, 'utf-8');
        } catch (err) {
            // Plik nie istnieje - brak korekt
        }

        let prompt = `Użytkownik: ${context.asker.displayName}\nPytanie: ${context.question}\n\n`;

        if (correctionsContent.trim()) {
            prompt += `KOREKTY UŻYTKOWNIKÓW (zweryfikowane odpowiedzi - NAJWYŻSZY PRIORYTET):\n${correctionsContent.trim()}\n\n`;
            prompt += `Jeśli korekty zawierają odpowiedź na pytanie → użyj ich BEZ szukania dalej.\nJeśli nie → użyj grep_knowledge aby przeszukać bazę wiedzy.`;
        } else {
            prompt += `Użyj narzędzia grep_knowledge aby przeszukać bazę wiedzy i odpowiedzieć na pytanie.`;
        }

        return prompt;
    }

    /**
     * Frazy kluczowe do auto-zbierania wiedzy z kanału
     * Dopasowanie częściowe (case-insensitive) - np. "najlepsz" dopasuje "najlepszy", "najlepsza"
     */
    static KNOWLEDGE_KEYWORDS = [
        'pet', 'eq', 'transmute', 'xeno', 'lanca', 'void', 'eternal', 'chaos',
        'tech', 'part', 'postać', 'najlepsz', 'najgorsz', 'fusion', 'astral',
        'af', 'skrzynk', 'klucz', 'shop', 'sklep', 'plecak', 'shard', 'odłam',
        'ss', 'skill', 'kalkulator', 'coll', 'synerg', 'core', 'chip', 'rc',
        'legend', 'epic', 'set', 'zone', 'main', 'op', 'daily', 'ciast', 'misja'
    ];

    /** ID kanałów do auto-zbierania wiedzy */
    static KNOWLEDGE_CHANNEL_IDS = [
        '1207041051831832586',
        '1194299628905042040'
    ];

    /** ID roli wymaganej do auto-zbierania wiedzy */
    static KNOWLEDGE_ROLE_ID = '1368903928468738080';

    /**
     * Sprawdź czy wiadomość zawiera frazy kluczowe do auto-zbierania wiedzy
     * @param {string} text - Treść wiadomości
     * @returns {boolean}
     */
    matchesKnowledgeKeywords(text) {
        if (!text) return false;
        const textLower = text.toLowerCase();
        return AIChatService.KNOWLEDGE_KEYWORDS.some(keyword => textLower.includes(keyword));
    }

    /**
     * Zapisz wpis wiedzy do pliku kanału
     * @param {string} content - Treść wpisu
     * @param {string} authorName - Nazwa autora
     * @param {string} channelId - ID kanału
     * @param {Date} [date] - Data wpisu (domyślnie teraz)
     */
    async saveKnowledgeEntry(content, authorName, channelId, date = null) {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            const filePath = path.join(this.dataDir, `knowledge_${channelId}.md`);

            let currentContent = '';
            try {
                currentContent = await fs.readFile(filePath, 'utf-8');
            } catch (err) {
                currentContent = '';
            }

            const dateObj = date || new Date();
            const dateStr = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
            const separator = currentContent.trim() ? '\n\n' : '';
            const newEntry = `${separator}[${dateStr} | ${authorName}] ${content}`;

            await fs.writeFile(filePath, currentContent + newEntry, 'utf-8');
        } catch (error) {
            logger.error(`❌ Błąd auto-zapisu wiedzy: ${error.message}`);
        }
    }

    /**
     * Zapisz korektę odpowiedzi AI do pliku korekt
     * @param {string} question - Pytanie użytkownika
     * @param {string} correction - Poprawna odpowiedź
     * @param {string} authorName - Autor korekty
     */
    async saveCorrection(question, correction, authorName) {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            let currentContent = '';
            try {
                currentContent = await fs.readFile(this.correctionsFile, 'utf-8');
            } catch (err) {
                currentContent = '';
            }

            const dateStr = new Date().toISOString().split('T')[0];
            const separator = currentContent.trim() ? '\n\n' : '';
            const entry = `${separator}[${dateStr} | ${authorName}] Pytanie: ${question} Odpowiedź: ${correction}`;

            await fs.writeFile(this.correctionsFile, currentContent + entry, 'utf-8');
            logger.info(`📝 Korekta od ${authorName}: "${question.substring(0, 50)}..."`);
        } catch (error) {
            logger.error(`❌ Błąd zapisu korekty: ${error.message}`);
        }
    }

    /**
     * Oceń fragmenty bazy wiedzy na podstawie feedbacku użytkownika
     * 👍 dodaje [+] do pasujących fragmentów, 👎 dodaje [-]
     * Fragmenty z oceną ≤ -5 są automatycznie usuwane
     * @param {string} relevantKnowledgeStr - Czyste fragmenty (bez markerów ocen)
     * @param {boolean} isPositive - true = 👍, false = 👎
     */
    async rateKnowledgeFragments(relevantKnowledgeStr, isPositive) {
        try {
            const relevantClean = relevantKnowledgeStr.split(/\n\n+/).map(s => s.trim());

            for (const filePath of this.knowledgeFiles) {
                let fileContent = '';
                try {
                    fileContent = await fs.readFile(filePath, 'utf-8');
                } catch (err) {
                    continue;
                }

                const fileSections = fileContent.split(/\n\n+/).filter(s => s.trim());
                let updated = false;
                let removedCount = 0;
                const updatedSections = [];

                for (const fileSection of fileSections) {
                    const { rating: currentRating, cleanSection } = this.parseRating(fileSection);
                    const isRelevant = relevantClean.some(rel => cleanSection.trim() === rel.trim());

                    if (isRelevant) {
                        const newRating = isPositive ? currentRating + 1 : currentRating - 1;
                        if (newRating <= -5) {
                            removedCount++;
                            continue;
                        }
                        updatedSections.push(this.updateSectionRating(fileSection, newRating));
                        updated = true;
                    } else {
                        updatedSections.push(fileSection);
                    }
                }

                if (updated) {
                    await fs.writeFile(filePath, updatedSections.join('\n\n'), 'utf-8');
                    const action = isPositive ? '👍' : '👎';
                    logger.info(`📊 Ocena wiedzy: ${action}${removedCount > 0 ? ` (usunięto ${removedCount})` : ''}`);
                }
            }
        } catch (error) {
            logger.error(`❌ Błąd oceniania wiedzy: ${error.message}`);
        }
    }

    /**
     * Skanuj historię kanałów od początku 2024 i zapisuj WSZYSTKO
     * Każdy kanał ma osobny plik bazy wiedzy
     * Odpowiedzi na wiadomości zapisywane jako pary Pytanie: / Odpowiedź:
     */
    async scanChannelHistory(client, channelCallback) {
        const startOf2024 = new Date('2024-01-01').getTime();

        const guild = client.guilds.cache.first();
        if (!guild) {
            logger.error('❌ Scan: brak guild');
            return [];
        }

        const results = [];

        for (const channelId of AIChatService.KNOWLEDGE_CHANNEL_IDS) {
            let channel;
            try {
                channel = await client.channels.fetch(channelId);
            } catch (err) {
                logger.warn(`⚠️ Scan: nie można pobrać kanału ${channelId}: ${err.message}`);
                continue;
            }
            if (!channel) continue;

            logger.info(`🔍 Scan: rozpoczynam kanał #${channel.name} (${channelId})`);

            // Wczytaj istniejącą bazę tego kanału do sprawdzania duplikatów
            let existingContent = '';
            try {
                existingContent = await fs.readFile(path.join(this.dataDir, `knowledge_${channelId}.md`), 'utf-8');
            } catch (err) { /* plik nie istnieje */ }

            let scanned = 0;
            let saved = 0;
            let skipped = 0;
            let lastMessageId = null;
            let channelDone = false;

            while (!channelDone) {
                const options = { limit: 100 };
                if (lastMessageId) options.before = lastMessageId;

                let messages;
                try {
                    messages = await channel.messages.fetch(options);
                } catch (err) {
                    logger.warn(`⚠️ Scan: błąd pobierania wiadomości z #${channel.name}: ${err.message}`);
                    break;
                }
                if (messages.size === 0) break;

                for (const [, msg] of messages) {
                    if (msg.createdTimestamp < startOf2024) {
                        channelDone = true;
                        break;
                    }

                    scanned++;
                    if (msg.author.bot) { skipped++; continue; }
                    if (!msg.content || !msg.content.trim()) { skipped++; continue; }

                    const authorName = msg.member?.displayName || msg.author.displayName || msg.author.username;

                    // Jeśli to odpowiedź na inną wiadomość → zapisz jako Pytanie/Odpowiedź
                    if (msg.reference) {
                        try {
                            const fetchPromise = msg.fetchReference();
                            const timeoutPromise = new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('timeout')), 5000)
                            );
                            const repliedMessage = await Promise.race([fetchPromise, timeoutPromise]);
                            if (repliedMessage.content?.trim()) {
                                const entry = `Pytanie: ${repliedMessage.content} Odpowiedź: ${msg.content}`;
                                if (!existingContent.includes(msg.content.trim())) {
                                    await this.saveKnowledgeEntry(entry, authorName, channelId, msg.createdAt);
                                    saved++;
                                } else {
                                    skipped++;
                                }
                                continue;
                            }
                        } catch (err) { /* usunięta wiadomość lub timeout */ }
                    }

                    // Zwykła wiadomość → zapisz bezpośrednio
                    if (!existingContent.includes(msg.content.trim())) {
                        await this.saveKnowledgeEntry(msg.content, authorName, channelId, msg.createdAt);
                        saved++;
                    } else {
                        skipped++;
                    }
                }

                lastMessageId = messages.last().id;

                // Progress callback co 500 wiadomości
                if (channelCallback && scanned % 500 < 100) {
                    await channelCallback({ type: 'progress', channelName: channel.name, scanned, saved });
                }

                // Ochrona przed rate limitem
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            logger.info(`✅ Scan #${channel.name} zakończony: ${scanned} sprawdzonych, ${saved} zapisanych, ${skipped} duplikatów`);

            const channelResult = { type: 'done', channelName: channel.name, scanned, saved, skipped };
            results.push(channelResult);

            if (channelCallback) {
                await channelCallback(channelResult);
            }
        }

        return results;
    }

    /**
     * Zadaj pytanie AI (główna metoda)
     */
    async ask(message, question) {
        // Sprawdź czy enabled
        if (!this.enabled) {
            return { content: '⚠️ AI Chat jest obecnie wyłączony. Skontaktuj się z administratorem.', relevantKnowledge: null };
        }

        const userId = message.author.id;

        try {
            // Zbierz kontekst
            const context = await this.gatherContext(message, question);

            // Wczytaj zasady ogólne (statyczne) i bazę wiedzy (dynamiczną)
            const knowledgeRules = await this.loadKnowledgeRules();
            const knowledgeDataArray = await this.loadAllKnowledgeData();

            // Zbuduj prompty
            const systemPrompt = this.buildSystemPrompt(knowledgeRules);
            const userPrompt = await this.buildUserPrompt(context);

            // Zapisz prompt do pliku (debug)
            await this.savePromptToFile(`SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`, context.asker.displayName);

            // Pętla tool_use - AI sam przeszukuje bazę wiedzy narzędziem grep_knowledge
            const messages = [{ role: 'user', content: userPrompt }];
            const allSearchResults = [];
            const MAX_TOOL_CALLS = 15;

            for (let i = 0; i < MAX_TOOL_CALLS; i++) {
                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: 1024,
                    system: [
                        {
                            type: 'text',
                            text: systemPrompt,
                            cache_control: { type: 'ephemeral' }
                        }
                    ],
                    messages,
                    tools: [AIChatService.GREP_TOOL],
                    temperature: 0.3
                });

                // Log cache info
                const usage = response.usage || {};
                const cacheInfo = usage.cache_read_input_tokens ? ` (cache: ${usage.cache_read_input_tokens}t)` : '';

                // Jeśli AI zakończyło (end_turn) - zwróć odpowiedź
                if (response.stop_reason === 'end_turn') {
                    const textBlock = response.content.find(b => b.type === 'text');
                    const answer = textBlock ? textBlock.text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim() : '⚠️ Brak odpowiedzi od AI.';
                    const relevantKnowledge = allSearchResults.length > 0 ? allSearchResults.join('\n\n') : null;

                    logger.info(`AI Chat: ${context.asker.username} pytanie="${question.substring(0, 50)}" grep×${i} ${cacheInfo}`);
                    return { content: answer, relevantKnowledge };
                }

                // Jeśli AI chce użyć narzędzia
                if (response.stop_reason === 'tool_use') {
                    const toolUseBlock = response.content.find(b => b.type === 'tool_use');
                    if (!toolUseBlock || toolUseBlock.name !== 'grep_knowledge') break;

                    const pattern = toolUseBlock.input.pattern;
                    logger.info(`AI Chat: grep_knowledge("${pattern}") [${i + 1}/${MAX_TOOL_CALLS}]`);

                    // Wykonaj wyszukiwanie
                    const searchResult = this.executeGrepKnowledge(pattern, knowledgeDataArray);
                    allSearchResults.push(searchResult);

                    // Dodaj odpowiedź AI i wynik narzędzia do konwersacji
                    messages.push({ role: 'assistant', content: response.content });
                    messages.push({
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: toolUseBlock.id,
                            content: searchResult
                        }]
                    });

                    continue;
                }

                // Inny stop_reason - przerwij pętlę
                break;
            }

            // Fallback - jeśli pętla się wyczerpała, zrób ostatni call bez narzędzi
            const finalResponse = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
                messages,
                temperature: 0.3
            });

            const textBlock = finalResponse.content.find(b => b.type === 'text');
            const answer = textBlock ? textBlock.text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim() : '⚠️ Brak odpowiedzi od AI.';
            const relevantKnowledge = allSearchResults.length > 0 ? allSearchResults.join('\n\n') : null;

            logger.info(`AI Chat: ${context.asker.username} pytanie="${question.substring(0, 50)}" grep×${MAX_TOOL_CALLS} (fallback)`);
            return { content: answer, relevantKnowledge };

        } catch (error) {
            logger.error(`Błąd AI Chat: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);

            if (error.status === 401) {
                return { content: '⚠️ Błąd autoryzacji API. Skontaktuj się z administratorem.', relevantKnowledge: null };
            } else if (error.status === 429) {
                return { content: '⚠️ Przekroczono limit API. Spróbuj ponownie za chwilę.', relevantKnowledge: null };
            } else if (error.status === 500) {
                return { content: '⚠️ Problem z serwerem API. Spróbuj ponownie za chwilę.', relevantKnowledge: null };
            }

            return { content: '⚠️ Wystąpił błąd podczas przetwarzania pytania. Spróbuj ponownie.', relevantKnowledge: null };
        }
    }
}

module.exports = AIChatService;
