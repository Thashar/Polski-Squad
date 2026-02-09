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
        this.cooldownMinutes = 5; // 5 minut

        // Persistent storage
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'ai_chat_cooldowns.json');
        this.knowledgeBaseFile = path.join(__dirname, '../knowledge_base.md'); // Zasady ogólne
        this.knowledgeDataFile = path.join(this.dataDir, 'knowledge_data.md'); // Faktyczna baza wiedzy (gitignore)

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
     * Wczytaj faktyczną bazę wiedzy (knowledge_data.md) - dynamiczna, przeszukiwana
     */
    async loadKnowledgeData() {
        try {
            return await fs.readFile(this.knowledgeDataFile, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('⚠️ Plik knowledge_data.md nie istnieje - baza wiedzy jest pusta');
            }
            return '';
        }
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

        // Oceń każdą sekcję pod kątem dopasowania do pytania
        const scoredSections = sections.map(section => {
            const sectionLower = section.toLowerCase();
            let score = 0;

            // Punkty za każde dopasowanie słowa kluczowego
            for (const keyword of keywords) {
                const regex = new RegExp(keyword, 'gi');
                const matches = sectionLower.match(regex);
                if (matches) {
                    score += matches.length;
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

            return { section, score };
        });

        // Filtruj sekcje z score > 0, sortuj malejąco, max 5
        const relevant = scoredSections
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        if (relevant.length === 0) return null;

        logger.info(`🔍 Keyword search: ${sections.length} sekcji → ${relevant.length} relevantnych (keywords: ${keywords.join(', ')})`);
        return relevant.map(s => s.section).join('\n\n');
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
    buildSystemPrompt(knowledgeRules) {
        let systemPrompt = `Jesteś kompendium wiedzy o grze Survivor.io.

KRYTYCZNE ZASADY:
- Odpowiadaj TYLKO na podstawie informacji Z BAZY WIEDZY poniżej
- Jeśli informacji NIE MA w bazie wiedzy → POWIEDZ że nie masz informacji
- ABSOLUTNY ZAKAZ wymyślania postaci, umiejętności, statystyk, mechanik
- NIGDY nie twórz fikcyjnych nazw, wartości liczbowych, opisów
- Jeśli nie wiesz → przyznaj się że nie wiesz

STYL ODPOWIEDZI:
- Po polsku, krótko (max 3-4 zdania)
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."

INSTRUKCJA ODPOWIADANIA:
1. SPRAWDŹ czy informacja JEST W BAZIE WIEDZY:
   - Jeśli JEST (nawet częściowo) → odpowiedz używając tych informacji
   - Jeśli NIE MA żadnych informacji → odpowiedz że nie masz informacji na ten temat

PRZYKŁADY ODPOWIEDZI:
✅ Gdy MA informacje (nawet niepełne): "Tech Party to specjalne grupy umiejętności. Znajdują się w Talent Board i powinny być maksymalnie połączone."
✅ Gdy NIE MA żadnych informacji: "Nie mam informacji na ten temat. Zapytaj się graczy z klanu!"

KRYTYCZNE: NIE mów "nie mam więcej informacji" jeśli odpowiedziałeś na pytanie!

PRZYKŁADY NIEPOPRAWNEGO ZACHOWANIA (NIGDY tak nie rób):
❌ Wymyślanie nazw postaci (np. "Thashar")
❌ Wymyślanie statystyk (np. "500 HP", "30% damage")
❌ Wymyślanie umiejętności które nie są w bazie
❌ Tworzenie fikcyjnych informacji "na podstawie wiedzy ogólnej"`;

        if (knowledgeRules) {
            systemPrompt += `\n\n${knowledgeRules}`;
        }

        return systemPrompt;
    }

    /**
     * Zbuduj user prompt (dynamiczny - zawiera pytanie + relevantne fragmenty bazy wiedzy)
     */
    buildUserPrompt(context, relevantKnowledge) {
        let prompt = `Użytkownik: ${context.asker.displayName}\nPytanie: ${context.question}`;

        if (relevantKnowledge) {
            prompt += `\n\n===== BAZA WIEDZY O GRZE =====\n\n${relevantKnowledge}\n\n===== KONIEC BAZY WIEDZY =====`;
        } else {
            prompt += `\n\n⚠️ UWAGA: Brak informacji w bazie wiedzy na ten temat. Odpowiedz że nie masz informacji i zapytaj czy użytkownik chce dodać te informacje.`;
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
        '1194299628905042040',
        '1194298890069999756',
        '1200051393843695699'
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
     * Zapisz wpis wiedzy do knowledge_data.md
     * @param {string} content - Treść wpisu
     * @param {string} authorName - Nazwa autora
     */
    async saveKnowledgeEntry(content, authorName) {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            let currentContent = '';
            try {
                currentContent = await fs.readFile(this.knowledgeDataFile, 'utf-8');
            } catch (err) {
                // Plik nie istnieje - utworzymy nowy
                currentContent = '';
            }

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const separator = currentContent.trim() ? '\n\n' : '';
            const newEntry = `${separator}[${dateStr} | ${authorName}] ${content}`;

            await fs.writeFile(this.knowledgeDataFile, currentContent + newEntry, 'utf-8');
            logger.info(`📚 Auto-zapis wiedzy od ${authorName}: ${content.substring(0, 60)}...`);
        } catch (error) {
            logger.error(`❌ Błąd auto-zapisu wiedzy: ${error.message}`);
        }
    }

    /**
     * Zadaj pytanie AI (główna metoda)
     */
    async ask(message, question) {
        // Sprawdź czy enabled
        if (!this.enabled) {
            return '⚠️ AI Chat jest obecnie wyłączony. Skontaktuj się z administratorem.';
        }

        const userId = message.author.id;

        try {
            // Zbierz kontekst
            const context = await this.gatherContext(message, question);

            // Wczytaj zasady ogólne (statyczne) i bazę wiedzy (dynamiczną)
            const knowledgeRules = await this.loadKnowledgeRules();
            const knowledgeData = await this.loadKnowledgeData();

            // Wyszukaj relevantne fragmenty z bazy wiedzy (keyword search)
            const relevantKnowledge = this.searchKnowledge(question, knowledgeData);

            // Zbuduj prompty
            const systemPrompt = this.buildSystemPrompt(knowledgeRules);
            const userPrompt = this.buildUserPrompt(context, relevantKnowledge);

            // Zapisz prompt do pliku (debug)
            await this.savePromptToFile(`SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`, context.asker.displayName);

            // Wywołaj API z prompt caching (system prompt cache'owany = ~90% taniej)
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
                messages: [{ role: 'user', content: userPrompt }],
                temperature: 0.3
            });

            // Wyciągnij odpowiedź
            const answer = response.content[0].text;

            // Log usage + cache info
            const usage = response.usage || {};
            const cacheInfo = usage.cache_read_input_tokens ? ` (cache hit: ${usage.cache_read_input_tokens} tokenów)` : '';
            logger.info(`AI Chat: ${context.asker.username} zadał pytanie - ${relevantKnowledge ? 'znaleziono fragmenty' : 'brak dopasowań w bazie'}${cacheInfo}`);

            return answer;

        } catch (error) {
            logger.error(`Błąd AI Chat: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);

            if (error.status === 401) {
                return '⚠️ Błąd autoryzacji API. Skontaktuj się z administratorem.';
            } else if (error.status === 429) {
                return '⚠️ Przekroczono limit API. Spróbuj ponownie za chwilę.';
            } else if (error.status === 500) {
                return '⚠️ Problem z serwerem API. Spróbuj ponownie za chwilę.';
            }

            return '⚠️ Wystąpił błąd podczas przetwarzania pytania. Spróbuj ponownie.';
        }
    }
}

module.exports = AIChatService;
