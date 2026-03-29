const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/empty_puzzle_state.json');

// Stany wiadomości i odpowiadające im wyzwalacze
const STATES   = ['# EMPTY', '# MPTY', '# M TY', '# M T', '<:ZZ_Pusto:1209494954762829866>'];
const TRIGGERS = Array.from({ length: 5 }, (_, i) => process.env[`EMPTY_TRIGGER${i + 1}`] ?? '');

class EmptyPuzzleService {
    constructor(config) {
        this.channelId = config.emptyPuzzle.channelId;
        this.messageId = null;
        this.step = 0;      // 0-4: aktywny krok, 5: wygrana (blokada)
        this.client = null;
        this.onWin = null; // callback wywoływany po wygraniu
        this._loadState();
    }

    _loadState() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                this.messageId = saved.messageId ?? null;
                this.step      = saved.step      ?? 0;
            }
        } catch (err) {
            logger.error('❌ EmptyPuzzle: błąd wczytywania stanu:', err.message);
        }
    }

    _saveState() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify({ messageId: this.messageId, step: this.step }, null, 2));
        } catch (err) {
            logger.error('❌ EmptyPuzzle: błąd zapisu stanu:', err.message);
        }
    }

    async initialize(client) {
        this.client = client;
        const channel = await client.channels.fetch(this.channelId).catch(() => null);
        if (!channel) {
            logger.error(`❌ EmptyPuzzle: nie znaleziono kanału ${this.channelId}`);
            return;
        }

        // Szukaj wiadomości po zapisanym ID, potem po treści
        let existing = null;
        if (this.messageId) {
            existing = await channel.messages.fetch(this.messageId).catch(() => null);
        }
        if (!existing) {
            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
            existing = messages?.find(m => m.author.id === client.user.id && STATES.includes(m.content));
        }

        if (existing) {
            this.messageId = existing.id;
            // Upewnij się że wiadomość pokazuje aktualny stan
            if (this.step < STATES.length && existing.content !== STATES[this.step]) {
                await existing.edit(STATES[this.step]).catch(() => {});
            }
            logger.info(`✅ EmptyPuzzle: znaleziono wiadomość (krok ${this.step})`);
        } else {
            const sent = await channel.send(STATES[0]);
            this.messageId = sent.id;
            this.step = 0;
            this._saveState();
            logger.info(`✅ EmptyPuzzle: wysłano nową wiadomość`);
        }
    }

    async handleMessageCreate(message) {
        if (message.author.bot) return;
        if (message.channelId !== this.channelId) return;

        const content = message.content.trim();

        // Po wygranej: usuń wiadomość i zignoruj
        if (this.step >= STATES.length) {
            await message.delete().catch(() => {});
            return;
        }

        // Sprawdź czy wiadomość to oczekiwany wyzwalacz
        if (content === TRIGGERS[this.step]) {
            this.step++;
            this._saveState();

            if (this.step === STATES.length) {
                // Wygrana!
                await message.delete().catch(() => {});
                await message.channel.send('## 🎉 Wygrałeś!' + (process.env.PUZZLE_DESC_3 ? `\n${process.env.PUZZLE_DESC_3}` : ''));
                logger.success('🏆 EmptyPuzzle: Wygrałeś!');
                if (this.onWin) await this.onWin();
            } else {
                // Zaktualizuj wiadomość do następnego stanu
                await message.delete().catch(() => {});
                try {
                    const channel = await this.client.channels.fetch(this.channelId);
                    const msg = await channel.messages.fetch(this.messageId);
                    await msg.edit(STATES[this.step]);
                } catch (err) {
                    logger.error('❌ EmptyPuzzle: nie można zaktualizować wiadomości:', err.message);
                }
            }
        } else {
            // Błędna wiadomość — usuń i resetuj do bazowej formy
            this.step = 0;
            this._saveState();
            await message.delete().catch(() => {});
            try {
                const channel = await this.client.channels.fetch(this.channelId);
                const msg = await channel.messages.fetch(this.messageId);
                await msg.edit(STATES[0]);
            } catch (err) {
                logger.error('❌ EmptyPuzzle: nie można zresetować wiadomości:', err.message);
            }
        }
    }

    async handleReactionAdd(reaction, user) {
        if (user.bot) return;
        if (reaction.message.channelId !== this.channelId) return;
        // Po wygranej usuń reakcję
        if (this.step >= STATES.length) {
            await reaction.users.remove(user.id).catch(() => {});
        }
    }

    async reset() {
        this.step = 0;
        this._saveState();
        if (this.messageId && this.client) {
            try {
                const channel = await this.client.channels.fetch(this.channelId);
                const msg = await channel.messages.fetch(this.messageId);
                await msg.edit(STATES[0]);
            } catch (err) {
                logger.error('❌ EmptyPuzzle: nie można zresetować wiadomości:', err.message);
            }
        }
        logger.info('🔄 EmptyPuzzle: zagadka zresetowana');
    }
}

module.exports = EmptyPuzzleService;
