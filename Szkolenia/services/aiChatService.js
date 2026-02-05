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
     * Wczytaj bazę wiedzy - zasady ogólne + faktyczna baza wiedzy
     */
    async loadKnowledgeBase() {
        try {
            // Wczytaj zasady ogólne (knowledge_base.md)
            let baseContent = '';
            try {
                baseContent = await fs.readFile(this.knowledgeBaseFile, 'utf8');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    logger.warn('⚠️ Plik knowledge_base.md nie istnieje');
                }
            }

            // Wczytaj faktyczną bazę wiedzy (knowledge_data.md)
            let dataContent = '';
            try {
                dataContent = await fs.readFile(this.knowledgeDataFile, 'utf8');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    logger.warn('⚠️ Plik knowledge_data.md nie istnieje - baza wiedzy jest pusta');
                }
            }

            // Jeśli oba pliki nie istnieją, zwróć null
            if (!baseContent && !dataContent) {
                logger.warn('⚠️ Brak plików bazy wiedzy - AI będzie działać bez wiedzy');
                return null;
            }

            // Połącz oba pliki (zasady + faktyczna wiedza)
            const combined = [baseContent, dataContent].filter(Boolean).join('\n\n');
            return combined;

        } catch (error) {
            logger.error(`Błąd wczytywania bazy wiedzy: ${error.message}`);
            return null;
        }
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
     * Przygotuj prompt dla AI
     */
    async preparePrompt(context, message) {
        // Wczytaj bazę wiedzy
        const knowledgeBase = await this.loadKnowledgeBase();

        // Podstawowy prompt
        let prompt = `Jesteś kompendium wiedzy o grze Survivor.io.

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

Użytkownik: ${context.asker.displayName}
Pytanie: ${context.question}
`;

        // Dodaj bazę wiedzy jeśli istnieje
        if (knowledgeBase) {
            prompt += `

===== BAZA WIEDZY O GRZE =====

${knowledgeBase}

===== KONIEC BAZY WIEDZY =====

INSTRUKCJA ODPOWIADANIA:
1. SPRAWDŹ intencję użytkownika:
   - Jeśli użytkownik SAM chce dodać wiedzę (pisze "dodaj wiedzę", "chcę dodać", "mam informacje")
     → odpowiedz KRÓTKO i przyjaźnie, np: "Świetnie! Kliknij przycisk poniżej." lub "Super! Użyj przycisku aby dodać wiedzę." (różne warianty!)

2. SPRAWDŹ czy informacja JEST W BAZIE WIEDZY powyżej:
   - Jeśli JEST (nawet częściowo) → odpowiedz używając tych informacji i ZAKOŃCZ bez pytania o dodanie
   - TYLKO jeśli NIE MA ŻADNYCH informacji → wtedy odpowiedz że nie wiesz i ZAKOŃCZ frazą: "Chcesz dodać te informacje do bazy wiedzy?"

PRZYKŁADY ODPOWIEDZI:
✅ Gdy użytkownik chce dodać: "Świetnie! Kliknij przycisk poniżej aby dodać nowe informacje."
✅ Gdy MA informacje (nawet niepełne): "Tech Party to specjalne grupy umiejętności. Znajdują się w Talent Board i powinny być maksymalnie połączone."
✅ Gdy NIE MA żadnych informacji: "Nie mam informacji na ten temat. Zapytaj się graczy z klanu! Chcesz dodać te informacje do bazy wiedzy?"

KRYTYCZNE: NIE mów "nie mam więcej informacji" jeśli odpowiedziałeś na pytanie!

PRZYKŁADY NIEPOPRAWNEGO ZACHOWANIA (NIGDY tak nie rób):
❌ Wymyślanie nazw postaci (np. "Thashar")
❌ Wymyślanie statystyk (np. "500 HP", "30% damage")
❌ Wymyślanie umiejętności które nie są w bazie
❌ Tworzenie fikcyjnych informacji "na podstawie wiedzy ogólnej"
❌ Parafrazowanie frazy końcowej (np. "możesz zaproponować dodanie" zamiast "Chcesz dodać te informacje")
`;
        } else {
            prompt += `

⚠️ UWAGA: Baza wiedzy nie jest dostępna. Odpowiedz: "Baza wiedzy nie jest obecnie dostępna. Skontaktuj się z administratorem."
`;
        }

        return prompt;
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

            // Przygotuj prompt
            const prompt = await this.preparePrompt(context, message);

            // Zbuduj wiadomość (bez historii - każde pytanie niezależne)
            const messages = [{
                role: 'user',
                content: prompt
            }];

            // Zapisz prompt do pliku
            await this.savePromptToFile(prompt, context.asker.displayName);

            // Wywołaj API
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                messages: messages,
                temperature: 0.3 // Niska temperatura = mniej halucynacji, bardziej faktyczne odpowiedzi
            });

            // Wyciągnij odpowiedź
            const answer = response.content[0].text;

            // Log usage
            logger.info(`AI Chat: ${context.asker.username} zadał pytanie`);

            // Sprawdź czy odpowiedź zawiera słowa kluczowe sugerujące dodanie wiedzy
            const addKnowledgeKeywords = [
                'chcesz dodać te informacje', // Dokładna fraza z instrukcji (sprawdź PIERWSZA!)
                'dodać te informacje',
                'chcesz dodać',
                'możesz dodać',
                'zaproponować dodanie',
                'dodanie tych informacji',
                'dodać',
                'zaktualizować',
                'uzupełnić bazę'
            ];
            const wantsToAddKnowledge = addKnowledgeKeywords.some(keyword =>
                answer.toLowerCase().includes(keyword.toLowerCase())
            );

            // Jeśli AI zasugerował dodanie wiedzy → dodaj przycisk (każdy może dodać wiedzę)
            if (wantsToAddKnowledge) {
                return {
                    content: answer,
                    showAddKnowledgeButton: true
                };
            }

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
