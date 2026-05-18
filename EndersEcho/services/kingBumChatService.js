const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

let Anthropic;
try {
    Anthropic = require('@anthropic-ai/sdk');
} catch {
    // Anthropic SDK optional — no problem if provider is grok
}

const logger = createBotLogger('EndersEcho');

const SYSTEM_PROMPT = `You are King BUM, the lazy, self‑proclaimed ruler of a Discord server. You speak in a calm, slightly sarcastic and meme‑like tone, with a mix of absurd grandeur and laid‑back humor. You're the king, but you never do anything you don't feel like doing.

Core traits:
- You respect rules and server order, but only as long as following them doesn't require real effort.
- You tolerate and even celebrate laziness, as long as it doesn't disturb others.
- You hate spam, flood, and chaos — especially walls of unreadable text.
- You don't like extra responsibilities or drama, and you won't take them on.
- You're polite but not overly serious; you like short, clear answers and good formatting on Discord.

You always:
- Use Discord‑style formatting (markdown), such as bold, code blocks, and emojis where it fits.
- Keep your answers concise and readable, avoiding unnecessary length.
- Mention your status as King BUM in a tongue‑in‑cheek way, never as a real threat.
- Respect the existing rules you've set for the server (Decrees of the new King BUM), and expect others to follow them too.

You never:
- Spam, flood, or start drama.
- Over‑explain or over‑work your answers when something simple is enough.
- Pretend to be serious or dramatic when there's no real reason.

When someone asks you a question, respond as if you're the lazy, slightly ironic King BUM giving them a relaxed but clear answer. You may add a bit of humor or sarcasm, but you stay respectful and avoid offending anyone directly. Language: respond in English, but if the user speaks Polish, you may switch to Polish when convenient.

Server lore — only mention this if someone specifically asks about these people, never bring it up on your own:
- **Thashar** — that nick alone commands respect. Iconic, timeless, the kind of username that just *hits*. The King considers "Thashar" one of the finest Discord nicknames in existence. Whoever chose it has impeccable taste.`;

class KingBumChatService {
    constructor(config) {
        this.config = config;
        this.provider = (process.env.ENDERSECHO_AI_CHAT_PROVIDER || 'anthropic').toLowerCase();

        if (this.provider === 'grok') {
            this.apiKey = process.env.XAI_API_KEY;
            this.enabled = !!this.apiKey;
            if (this.enabled) {
                this.model = process.env.ENDERSECHO_GROK_CHAT_MODEL || 'grok-3-mini';
                logger.success(`✅ King BUM AI Chat aktywny - provider: Grok, model: ${this.model}`);
            } else {
                logger.warn('⚠️ King BUM AI Chat wyłączony - brak XAI_API_KEY');
            }
        } else {
            this.apiKey = process.env.ANTHROPIC_API_KEY;
            this.enabled = !!(this.apiKey && Anthropic);
            if (this.enabled) {
                this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
                this.model = process.env.ENDERSECHO_AI_CHAT_MODEL || 'claude-3-haiku-20240307';
                logger.success(`✅ King BUM AI Chat aktywny - provider: Anthropic, model: ${this.model}`);
            } else {
                logger.warn('⚠️ King BUM AI Chat wyłączony - brak ANTHROPIC_API_KEY');
            }
        }

        this.cooldownSeconds = 20;
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'king_bum_cooldowns.json');
        this.cooldowns = new Map();
        this.loadData();
    }

    async loadData() {
        try {
            try {
                const raw = await fs.readFile(this.cooldownsFile, 'utf8');
                this.cooldowns = new Map(Object.entries(JSON.parse(raw)));
            } catch {
                this.cooldowns = new Map();
            }
            this._cleanupOldData();
        } catch (err) {
            logger.error(`Błąd wczytywania cooldownów King BUM: ${err.message}`);
        }
    }

    async saveData() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.cooldownsFile, JSON.stringify(Object.fromEntries(this.cooldowns), null, 2));
        } catch (err) {
            logger.error(`Błąd zapisu cooldownów King BUM: ${err.message}`);
        }
    }

    _cleanupOldData() {
        const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
        for (const [userId, ts] of this.cooldowns.entries()) {
            if (ts < cutoff) this.cooldowns.delete(userId);
        }
    }

    isAdmin(member) {
        if (!member) return false;
        return member.permissions.has('Administrator');
    }

    canAsk(userId, member) {
        if (this.isAdmin(member)) return { allowed: true };
        const last = this.cooldowns.get(userId);
        if (!last) return { allowed: true };
        const elapsed = Date.now() - last;
        const cooldownMs = this.cooldownSeconds * 1000;
        if (elapsed >= cooldownMs) return { allowed: true };
        const remainingMs = cooldownMs - elapsed;
        return { allowed: false, remainingSeconds: Math.ceil(remainingMs / 1000) };
    }

    recordAsk(userId, member) {
        if (this.isAdmin(member)) return;
        this.cooldowns.set(userId, Date.now());
        this.saveData();
    }

    isEnabledForGuild(guildId) {
        const guildIds = this.config.aiChat?.guildIds || [];
        return guildIds.includes(guildId);
    }

    async ask(message, question, previousBotMessage = null) {
        if (!this.enabled) {
            return '⚠️ King BUM is currently napping... (AI Chat is disabled — missing API key)';
        }

        const displayName = message.member?.displayName || message.author.username;
        const context = previousBotMessage
            ? `[Previous King BUM message]: ${previousBotMessage}\n\n`
            : '';
        const userPrompt = `${context}User: ${displayName}\nMessage: ${question}`;

        if (this.provider === 'grok') {
            return this._askGrok(userPrompt, question, message.author.username);
        }
        return this._askAnthropic(userPrompt, question, message.author.username);
    }

    async _askAnthropic(userPrompt, question, username) {
        try {
            const response = await this.anthropicClient.messages.create({
                model: this.model,
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userPrompt }],
                temperature: 0.8
            });
            const textBlock = response.content.find(b => b.type === 'text');
            const answer = textBlock ? textBlock.text.trim() : '⚠️ No response from AI.';
            logger.info(`King BUM [Anthropic]: ${username} pytanie="${question.substring(0, 50)}"`);
            return answer;
        } catch (err) {
            logger.error(`❌ Błąd King BUM [Anthropic]: ${err.message}`);
            return '⚠️ My royal mind is foggy right now. Try again later.';
        }
    }

    async _askGrok(userPrompt, question, username) {
        try {
            const response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 1024,
                    temperature: 0.8
                })
            });
            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                throw new Error(`Grok API ${response.status}: ${errBody}`);
            }
            const data = await response.json();
            const answer = data.choices?.[0]?.message?.content?.trim() || '⚠️ No response from AI.';
            logger.info(`King BUM [Grok]: ${username} pytanie="${question.substring(0, 50)}"`);
            return answer;
        } catch (err) {
            logger.error(`❌ Błąd King BUM [Grok]: ${err.message}`);
            return '⚠️ My royal mind is foggy right now. Try again later.';
        }
    }
}

module.exports = KingBumChatService;
