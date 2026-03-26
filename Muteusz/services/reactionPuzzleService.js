const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

// Normalizacja: Discord usuwa variation selectory (U+FE0F) z reaction.emoji.name
function norm(str) { return str.replace(/\uFE0F/g, ''); }

const SEQUENCE = ['👩🏻‍🍳', '6️⃣', '❌', '🍽️'].map(norm);
const MESSAGE_CONTENT = '# Gdzie kucharek sześć, tam nie ma co jeść! 👩🏻‍🍳';

class ReactionPuzzleService {
    constructor(config) {
        this.config = config;
        this.channelId = config.reactionPuzzle.channelId;
        this.messageId = null;
        this.progress = 0; // ile poprawnych reakcji dodano w ciągu
        this.solved = false; // czy sekwencja już rozwiązana
        this.client = null;
    }

    async initialize(client) {
        this.client = client;
        const channel = await client.channels.fetch(this.channelId).catch(() => null);
        if (!channel) {
            logger.error(`❌ ReactionPuzzle: nie znaleziono kanału ${this.channelId}`);
            return;
        }

        // Szukaj istniejącej wiadomości bota z tym tekstem
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existing = messages?.find(m => m.author.id === client.user.id && m.content === MESSAGE_CONTENT);

        if (existing) {
            this.messageId = existing.id;
            logger.info(`✅ ReactionPuzzle: znaleziono istniejącą wiadomość ${existing.id}`);
        } else {
            const sent = await channel.send(MESSAGE_CONTENT);
            this.messageId = sent.id;
            logger.info(`✅ ReactionPuzzle: wysłano nową wiadomość ${sent.id}`);
        }
    }

    isMyMessage(messageId) {
        return messageId === this.messageId;
    }

    async handleReactionAdd(reaction, user) {
        if (user.bot) return;
        if (!this.isMyMessage(reaction.message.id)) return;

        // Po rozwiązaniu — usuń każdą reakcję użytkownika
        if (this.solved) {
            try {
                await reaction.users.remove(user.id);
            } catch (err) {
                logger.error('❌ ReactionPuzzle: nie można usunąć reakcji (solved):', err.message);
            }
            return;
        }

        const emoji = norm(reaction.emoji.name ?? '');

        // Sprawdź czy to kolejna oczekiwana reakcja w sekwencji
        if (emoji === SEQUENCE[this.progress]) {
            this.progress++;
            if (this.progress === SEQUENCE.length) {
                // Sekwencja ukończona!
                this.progress = 0;
                this.solved = true;
                logger.success('🏆 ReactionPuzzle: Wygrałeś!');
                const channel = reaction.message.channel;
                await channel.send('## 🎉 Wygrałeś!');
                // Usuń wszystkie reakcje i dodaj sekwencję przez bota
                await reaction.message.reactions.removeAll();
                const msg = reaction.message;
                for (const e of ['👩🏻‍🍳', '6️⃣', '❌', '🍽️']) {
                    await msg.react(e).catch(err =>
                        logger.error('❌ ReactionPuzzle: nie można dodać reakcji bota:', err.message)
                    );
                }
            }
        } else {
            // Błędna reakcja — usuń wszystkie i resetuj
            this.progress = 0;
            try {
                await reaction.message.reactions.removeAll();
            } catch (err) {
                logger.error('❌ ReactionPuzzle: nie można usunąć reakcji:', err.message);
            }
        }
    }

    async reset() {
        this.progress = 0;
        this.solved = false;
        if (this.messageId && this.client) {
            try {
                const channel = await this.client.channels.fetch(this.channelId);
                const msg = await channel.messages.fetch(this.messageId);
                await msg.reactions.removeAll();
            } catch (err) {
                logger.error('❌ ReactionPuzzle: nie można usunąć reakcji przy resecie:', err.message);
            }
        }
        logger.info('🔄 ReactionPuzzle: zagadka zresetowana');
    }

    async handleMessageCreate(message) {
        if (message.author.bot) return;
        if (message.channelId !== this.channelId) return;
        try {
            await message.delete();
        } catch (err) {
            logger.error('❌ ReactionPuzzle: nie można usunąć wiadomości:', err.message);
        }
    }
}

module.exports = ReactionPuzzleService;
