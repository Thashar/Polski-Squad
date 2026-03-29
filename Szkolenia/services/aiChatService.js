const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

let Anthropic;
try {
    Anthropic = require('@anthropic-ai/sdk');
} catch {
    // Anthropic SDK niedostępne - nie problem jeśli provider to grok
}

const logger = createBotLogger('Szkolenia');

/**
 * AI Chat Service - Kompendium wiedzy o grze Survivor.io
 * Obsługuje trzech providerów: Anthropic (z kompendium wiedzy), Grok i Perplexity (web search)
 * Przełączanie przez SZKOLENIA_AI_PROVIDER w .env
 */
class AIChatService {
    constructor(config) {
        this.config = config;

        // Wybór providera AI: "anthropic", "grok" lub "perplexity"
        this.provider = (process.env.SZKOLENIA_AI_PROVIDER || 'anthropic').toLowerCase();

        if (this.provider === 'grok') {
            // Grok (xAI) API
            this.apiKey = process.env.XAI_API_KEY;
            this.enabled = !!this.apiKey;

            if (this.enabled) {
                this.model = process.env.SZKOLENIA_GROK_MODEL || 'grok-4';
                logger.success(`✅ AI Chat aktywny - provider: Grok, model: ${this.model}`);
            } else {
                logger.warn('⚠️ AI Chat wyłączony - brak XAI_API_KEY');
            }
        } else if (this.provider === 'perplexity') {
            // Perplexity API
            this.apiKey = process.env.PERPLEXITY_API_KEY;
            this.enabled = !!this.apiKey;

            if (this.enabled) {
                this.model = process.env.SZKOLENIA_PERPLEXITY_MODEL || 'sonar-pro';
                logger.success(`✅ AI Chat aktywny - provider: Perplexity, model: ${this.model}`);
            } else {
                logger.warn('⚠️ AI Chat wyłączony - brak PERPLEXITY_API_KEY');
            }
        } else {
            // Anthropic API (domyślny)
            this.apiKey = process.env.ANTHROPIC_API_KEY;
            this.enabled = !!this.apiKey;

            if (this.enabled) {
                this.client = new Anthropic({ apiKey: this.apiKey });
                this.model = process.env.SZKOLENIA_AI_CHAT_MODEL || 'claude-3-haiku-20240307';
                logger.success(`✅ AI Chat aktywny - provider: Anthropic, model: ${this.model}`);
            } else {
                logger.warn('⚠️ AI Chat wyłączony - brak ANTHROPIC_API_KEY');
            }
        }

        // Cooldown: Grok/Perplexity 1x dziennie (24h), Anthropic 1 min
        this.cooldownMinutes = (this.provider === 'grok' || this.provider === 'perplexity') ? 1440 : 1;
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
        const remainingMs = cooldownMs - elapsed;
        const remainingHours = Math.floor(remainingMs / 3600000);
        const remainingMins = Math.ceil((remainingMs % 3600000) / 60000);
        return { allowed: false, remainingHours, remainingMinutes: remainingMins };
    }

    recordAsk(userId, member) {
        if (this.isAdmin(member)) return;
        this.cooldowns.set(userId, Date.now());
        this.saveData();
    }

    buildSystemPrompt() {
        return `Jesteś asystentem wiedzy o grze Survivor.io na Discordzie.

ZASADY:
- Odpowiadaj PO POLSKU, krótko i rzeczowo (max 3-4 zdania)
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."
- Jeśli nie znasz odpowiedzi → powiedz że nie masz pewnych informacji
- ABSOLUTNY ZAKAZ wymyślania statystyk, nazw, umiejętności`;
    }

    buildUserPrompt(context) {
        return `Użytkownik: ${context.asker.displayName}\nPytanie: ${context.question}`;
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
     * Zadaj pytanie przez Grok API (Responses API z web_search)
     */
    async askGrok(message, question) {
        try {
            const displayName = message.member?.displayName || message.author.username;

            const currentYear = new Date().getFullYear();
            const systemPrompt = `Jesteś kompendium wiedzy o grze Survivor.io na Discordzie.

MASZ NARZĘDZIE: web_search - przeszukuje Reddit w czasie rzeczywistym.
- Wyszukiwanie ograniczone TYLKO do Reddit (reddit.com)
- ZAWSZE dodawaj "site:reddit.com" do zapytań
  Przykład: "Survivor.io best pets ${currentYear} site:reddit.com"
- Szukaj po angielsku: "Survivor.io" + temat pytania
- Preferuj nowsze wyniki, ale NIE odrzucaj starszych jeśli są wartościowe
- Ogranicz się do max 10 najważniejszych wyników - nie przeszukuj więcej

ZASADY:
- Odpowiadaj PO POLSKU, wyczerpująco i szczegółowo - pisz ile trzeba, nie skracaj
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."
- Jeśli nie znalazłeś informacji na Reddit → powiedz że nie masz aktualnych danych
- ABSOLUTNY ZAKAZ wymyślania statystyk, nazw, umiejętności

ZAKOŃCZENIE:
- Zakończ: "Oceń odpowiedź kciukiem 👍/👎!"`;

            const userPrompt = `Użytkownik: ${displayName}\nPytanie: ${question}\n\nUżyj web_search aby znaleźć najświeższe informacje na Reddit i odpowiedzieć na pytanie.`;

            await this.savePromptToFile(`[GROK] SYSTEM:\n${systemPrompt}\n\nUSER (${displayName}):\n${userPrompt}`, displayName);

            const response = await fetch('https://api.x.ai/v1/responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    input: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    tools: [{ type: 'web_search', allowed_domains: ['reddit.com'] }],
                    max_output_tokens: 10000,
                    store: false
                })
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => '');
                throw new Error(`Grok API ${response.status}: ${errorBody}`);
            }

            const data = await response.json();

            // Logowanie struktury odpowiedzi dla debugowania
            logger.info(`AI Chat [Grok] response keys: ${Object.keys(data).join(', ')}`);
            if (!data.output_text) {
                logger.warn(`AI Chat [Grok] brak output_text, status: ${data.status}, output type: ${typeof data.output}, output length: ${Array.isArray(data.output) ? data.output.length : 'N/A'}`);
                if (data.output) {
                    logger.warn(`AI Chat [Grok] output: ${JSON.stringify(data.output).substring(0, 500)}`);
                }
                if (data.error) {
                    logger.error(`AI Chat [Grok] error w odpowiedzi: ${JSON.stringify(data.error)}`);
                }
            }

            // Parsowanie odpowiedzi - output_text lub fallback do output array
            let answer = data.output_text;
            if (!answer && Array.isArray(data.output)) {
                // Szukaj tekstu w output array
                for (const item of data.output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        const textBlock = item.content.find(b => b.type === 'output_text' || b.type === 'text');
                        if (textBlock?.text) {
                            answer = textBlock.text;
                            break;
                        }
                    }
                }
            }
            // Fallback: choices (Chat Completions format)
            if (!answer && data.choices?.[0]?.message?.content) {
                answer = data.choices[0].message.content;
            }

            if (!answer) {
                answer = '⚠️ Brak odpowiedzi od AI.';
            }

            const citationCount = data.citations?.length || 0;
            logger.info(`AI Chat [Grok]: ${message.author.username} pytanie="${question.substring(0, 50)}" citations=${citationCount} answer_len=${answer.length}`);
            return { content: answer, relevantKnowledge: null };

        } catch (error) {
            logger.error(`❌ Błąd Grok AI Chat: ${error.message}`);
            return { content: '⚠️ Przepraszam, wystąpił błąd. Spróbuj ponownie za chwilę.', relevantKnowledge: null };
        }
    }

    /**
     * Zadaj pytanie przez Perplexity API (Chat Completions z web search)
     */
    async askPerplexity(message, question) {
        try {
            const displayName = message.member?.displayName || message.author.username;

            const systemPrompt = `Jesteś kompendium wiedzy o grze Survivor.io na Discordzie.

MASZ WBUDOWANE WYSZUKIWANIE INTERNETOWE - przeszukujesz internet w czasie rzeczywistym.
- ZAWSZE szukaj aktualnych informacji o Survivor.io
- PRIORYTET: Szukaj NAJPIERW na Reddit - dodawaj "site:reddit.com" do zapytań
  Przykład: "Survivor.io best pets 2026 site:reddit.com"
- Jeśli Reddit nie daje wyników → szukaj bez ograniczenia domeny
- Szukaj po angielsku: "Survivor.io" + temat pytania
- Szukaj też po polsku jeśli pytanie dotyczy polskiej społeczności
- ZAWSZE preferuj najnowsze wyniki - dodawaj aktualny rok do zapytań (np. "2026")

ZASADY:
- Odpowiadaj PO POLSKU, wyczerpująco i szczegółowo - pisz ile trzeba, nie skracaj
- **Ważne informacje** pogrubione
- Minimalne emoji: ⚔️ 🎯 💎 🏆 ⚡
- BEZ wstępów typu "Dobrze, odpowiem..."
- Jeśli nie znalazłeś informacji w sieci → powiedz że nie masz aktualnych danych
- ABSOLUTNY ZAKAZ wymyślania statystyk, nazw, umiejętności

ZAKOŃCZENIE:
- Zakończ: "Oceń odpowiedź kciukiem 👍/👎!"`;

            const userPrompt = `Użytkownik: ${displayName}\nPytanie: ${question}\n\nPrzeszukaj internet aby znaleźć najświeższe informacje (priorytet: Reddit, potem reszta internetu) i odpowiedzieć na pytanie.`;

            await this.savePromptToFile(`[PERPLEXITY] SYSTEM:\n${systemPrompt}\n\nUSER (${displayName}):\n${userPrompt}`, displayName);

            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    search_recency_filter: 'month'
                })
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => '');
                throw new Error(`Perplexity API ${response.status}: ${errorBody}`);
            }

            const data = await response.json();

            logger.info(`AI Chat [Perplexity] response keys: ${Object.keys(data).join(', ')}`);

            let answer = data.choices?.[0]?.message?.content;

            if (!answer) {
                answer = '⚠️ Brak odpowiedzi od AI.';
            }

            const citationCount = data.citations?.length || 0;
            logger.info(`AI Chat [Perplexity]: ${message.author.username} pytanie="${question.substring(0, 50)}" citations=${citationCount} answer_len=${answer.length}`);
            return { content: answer, relevantKnowledge: null };

        } catch (error) {
            logger.error(`❌ Błąd Perplexity AI Chat: ${error.message}`);
            return { content: '⚠️ Przepraszam, wystąpił błąd. Spróbuj ponownie za chwilę.', relevantKnowledge: null };
        }
    }

    /**
     * Zadaj pytanie AI - deleguje do odpowiedniego providera
     */
    async ask(message, question) {
        if (!this.enabled) {
            return { content: '⚠️ AI Chat jest obecnie wyłączony. Skontaktuj się z administratorem.', relevantKnowledge: null };
        }

        if (this.provider === 'grok') {
            return this.askGrok(message, question);
        }

        if (this.provider === 'perplexity') {
            return this.askPerplexity(message, question);
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

            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                temperature: 0.3
            });

            const textBlock = response.content.find(b => b.type === 'text');
            const answer = textBlock ? textBlock.text.trim() : '⚠️ Brak odpowiedzi od AI.';

            logger.info(`AI Chat: ${context.asker.username} pytanie="${question.substring(0, 50)}"`);
            return { content: answer, relevantKnowledge: null };

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
