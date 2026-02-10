const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

/**
 * AI Chat Service - Kompendium wiedzy o grze Survivor.io
 * Mention @Szkolenia → wyszukiwanie grep w bazie wiedzy → odpowiedź AI
 */
class AIChatService {
    constructor(config, knowledgeService) {
        this.config = config;
        this.knowledgeService = knowledgeService;

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

        // Cooldown
        this.cooldownMinutes = 1;
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'ai_chat_cooldowns.json');
        this.promptsDir = path.join(this.dataDir, 'prompts');
        this.cooldowns = new Map();

        this.loadData();
    }

    async loadData() {
        try {
            try {
                const cooldownData = await fs.readFile(this.cooldownsFile, 'utf8');
                const parsed = JSON.parse(cooldownData);
                this.cooldowns = new Map(Object.entries(parsed));
            } catch (err) {
                this.cooldowns = new Map();
            }
            this.cleanupOldData();
        } catch (error) {
            logger.error(`Błąd wczytywania danych AI Chat: ${error.message}`);
        }
    }

    async saveData() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const cooldownObj = Object.fromEntries(this.cooldowns);
            await fs.writeFile(this.cooldownsFile, JSON.stringify(cooldownObj, null, 2));
        } catch (error) {
            logger.error(`Błąd zapisywania danych AI Chat: ${error.message}`);
        }
    }

    cleanupOldData() {
        const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
        for (const [userId, timestamp] of this.cooldowns.entries()) {
            if (timestamp < twoDaysAgo) this.cooldowns.delete(userId);
        }
    }

    isAdmin(member) {
        if (!member) return false;
        const adminRoles = this.config.adminRoles || [];
        return member.roles.cache.some(role => adminRoles.includes(role.id));
    }

    canAsk(userId, member) {
        if (this.isAdmin(member)) return { allowed: true };
        const lastAsk = this.cooldowns.get(userId);
        if (!lastAsk) return { allowed: true };
        const elapsed = Date.now() - lastAsk;
        const cooldownMs = this.cooldownMinutes * 60 * 1000;
        if (elapsed >= cooldownMs) return { allowed: true };
        return { allowed: false, remainingMinutes: Math.ceil((cooldownMs - elapsed) / 60000) };
    }

    recordAsk(userId, member) {
        if (this.isAdmin(member)) return;
        this.cooldowns.set(userId, Date.now());
        this.saveData();
    }

    // --- Narzędzie grep_knowledge ---

    static GREP_TOOL = {
        name: 'grep_knowledge',
        description: 'Przeszukuje bazę wiedzy o grze Survivor.io. Zwraca fragmenty pasujące do wzorca (regex lub tekst). Możesz wywoływać wielokrotnie z różnymi frazami. Szukaj aż znajdziesz dokładną odpowiedź.',
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
     * Wyszukiwanie grep w bazie wiedzy + korektach
     */
    async executeGrepKnowledge(pattern) {
        if (!pattern) return 'Podaj frazę do wyszukania.';

        let regex;
        try {
            regex = new RegExp(pattern, 'gi');
        } catch (err) {
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        }

        const MAX_RESULTS = 20;
        const MAX_CHARS = 15000;
        const matches = [];

        // Przeszukaj bazę wiedzy (aktywne wpisy + korekty z prefixem)
        const knowledgeText = this.knowledgeService.getActiveEntriesText();
        if (knowledgeText) {
            const sections = knowledgeText.split(/\n\n+/).filter(s => s.trim().length > 0);
            // Korekty najpierw (mają priorytet)
            const corrections = sections.filter(s => s.startsWith('[KOREKTA UŻYTKOWNIKA]'));
            const regular = sections.filter(s => !s.startsWith('[KOREKTA UŻYTKOWNIKA]'));

            for (const section of [...corrections, ...regular]) {
                if (matches.length >= MAX_RESULTS) break;
                regex.lastIndex = 0;
                if (regex.test(section)) {
                    const totalChars = matches.reduce((sum, m) => sum + m.length, 0);
                    if (totalChars + section.length > MAX_CHARS) break;
                    matches.push(section);
                }
            }
        }

        if (matches.length === 0) {
            return `Brak wyników dla "${pattern}". Spróbuj innej frazy lub krótszego wzorca.`;
        }

        const corrCount = matches.filter(m => m.startsWith('[KOREKTA UŻYTKOWNIKA]')).length;
        return `Znaleziono ${matches.length} fragmentów (${corrCount} korekt):\n\n${matches.join('\n\n---\n\n')}`;
    }

    buildSystemPrompt() {
        return `Jesteś kompendium wiedzy o grze Survivor.io.

MASZ NARZĘDZIE: grep_knowledge
- Użyj go aby przeszukać bazę wiedzy ZANIM odpowiesz
- Możesz wywoływać WIELOKROTNIE z różnymi frazami - BEZ LIMITU
- Zwraca WSZYSTKIE pasujące fragmenty
- Używaj krótkich fraz: "transmute", "ciastk", "pet", "xeno", "awaken"
- Możesz używać regex: "pet.*level", "ciastk.*60"

STRATEGIA WYSZUKIWANIA:
1. ZAWSZE NAJPIERW szukaj DOKŁADNIE słów z pytania użytkownika (po polsku!)
2. NIGDY nie tłumacz polskich słów na angielski w pierwszym wyszukiwaniu
3. Dopiero jeśli polskie frazy nic nie dają → spróbuj angielskich odpowiedników
4. Jeśli pierwsze wyszukiwanie nie daje PEŁNEJ odpowiedzi → SZUKAJ DALEJ z inną frazą
5. Jeśli pytanie o koszty/ilości → szukaj po nazwie przedmiotu, potem po "koszt", "ile"
6. NIE PODDAWAJ SIĘ po 1-2 wyszukiwaniach - szukaj dopóki nie znajdziesz dokładnej odpowiedzi
7. Dopiero gdy wielokrotne wyszukiwania nic nie dają → odpowiedz że nie masz informacji

KOREKTY UŻYTKOWNIKÓW:
- Jeśli w wynikach są "KOREKTY UŻYTKOWNIKÓW" → to ZWERYFIKOWANE odpowiedzi od graczy
- Mają NAJWYŻSZY priorytet nad innymi danymi z bazy wiedzy

KRYTYCZNE ZASADY:
- Odpowiadaj TYLKO na podstawie znalezionych informacji
- ABSOLUTNY ZAKAZ wymyślania postaci, umiejętności, statystyk, mechanik
- Jeśli po wielu wyszukiwaniach nie znalazłeś odpowiedzi → powiedz że nie masz informacji

STYL ODPOWIEDZI:
- Po polsku, krótko (max 3-4 zdania)
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."

AKTUALNOŚĆ DANYCH (WAŻNE):
- Każdy wpis ma datę: [YYYY-MM-DD | Autor]
- ZAWSZE preferuj NOWSZE wpisy (2025-2026) nad starszymi (2024)

ZAKOŃCZENIE:
- Zakończ: "Oceń odpowiedź kciukiem 👍/👎!"

PRZYKŁADY NIEPOPRAWNEGO ZACHOWANIA:
❌ Wymyślanie statystyk, nazw, umiejętności
❌ Odpowiadanie BEZ użycia grep_knowledge`;
    }

    buildUserPrompt(context) {
        return `Użytkownik: ${context.asker.displayName}\nPytanie: ${context.question}\n\nUżyj narzędzia grep_knowledge aby przeszukać bazę wiedzy i odpowiedzieć na pytanie.`;
    }

    async savePromptToFile(prompt, askerName) {
        try {
            await fs.mkdir(this.promptsDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${askerName}_${timestamp}.txt`;
            await fs.writeFile(path.join(this.promptsDir, filename), prompt);
        } catch (err) {
            // ignore
        }
    }

    /**
     * Zadaj pytanie AI z pętlą tool_use
     */
    async ask(message, question) {
        if (!this.enabled) {
            return { content: '⚠️ AI Chat jest obecnie wyłączony. Skontaktuj się z administratorem.', relevantKnowledge: null };
        }

        try {
            const context = {
                asker: {
                    displayName: message.member?.displayName || message.author.username,
                    username: message.author.username,
                    id: message.author.id
                },
                question
            };

            const systemPrompt = this.buildSystemPrompt();
            const userPrompt = this.buildUserPrompt(context);

            await this.savePromptToFile(`SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`, context.asker.displayName);

            // Pętla tool_use
            const messages = [{ role: 'user', content: userPrompt }];
            const allSearchResults = [];
            const MAX_TOOL_CALLS = 15;

            for (let i = 0; i < MAX_TOOL_CALLS; i++) {
                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: 1024,
                    system: [{
                        type: 'text',
                        text: systemPrompt,
                        cache_control: { type: 'ephemeral' }
                    }],
                    messages,
                    tools: [AIChatService.GREP_TOOL],
                    temperature: 0.3
                });

                const usage = response.usage || {};
                const cacheInfo = usage.cache_read_input_tokens ? ` (cache: ${usage.cache_read_input_tokens}t)` : '';

                if (response.stop_reason === 'end_turn') {
                    const textBlock = response.content.find(b => b.type === 'text');
                    const answer = textBlock ? textBlock.text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim() : '⚠️ Brak odpowiedzi od AI.';
                    const relevantKnowledge = allSearchResults.length > 0 ? allSearchResults.join('\n\n') : null;

                    logger.info(`AI Chat: ${context.asker.username} pytanie="${question.substring(0, 50)}" grep×${i} ${cacheInfo}`);
                    return { content: answer, relevantKnowledge };
                }

                if (response.stop_reason === 'tool_use') {
                    const toolUseBlock = response.content.find(b => b.type === 'tool_use');
                    if (!toolUseBlock || toolUseBlock.name !== 'grep_knowledge') break;

                    const pattern = toolUseBlock.input.pattern;
                    logger.info(`AI Chat: grep_knowledge("${pattern}") [${i + 1}/${MAX_TOOL_CALLS}]`);

                    const searchResult = await this.executeGrepKnowledge(pattern);
                    allSearchResults.push(searchResult);

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

                break;
            }

            // Fallback
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
            logger.error(`❌ Błąd AI Chat: ${error.status || ''} ${JSON.stringify(error.error || error.message)}`);
            if (error.error) {
                logger.error(`❌ Stack trace: ${error}`);
            }
            return { content: '⚠️ Przepraszam, wystąpił błąd. Spróbuj ponownie za chwilę.', relevantKnowledge: null };
        }
    }
}

module.exports = AIChatService;
