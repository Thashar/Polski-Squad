const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

// Stany wiadomości i odpowiadające im wyzwalacze
const STATES   = ['EMPTY', 'MPTY', 'M TY', 'M T', '<:ZZ_Pusto:1209494954762829866>'];
const TRIGGERS = ['E',     'P',    'Y',     'M T', '<:ZZ_Pusto:1209494954762829866>'];

class EmptyPuzzleService {
    constructor(config) {
        this.channelId = config.emptyPuzzle.channelId;
        this.messageId = null;
        this.step = 0;      // 0-4: aktywny krok, 5: wygrana (blokada)
        this.client = null;
    }

    async initialize(client) {
        this.client = client;
        const channel = await client.channels.fetch(this.channelId).catch(() => null);
        if (!channel) {
            logger.error(`❌ EmptyPuzzle: nie znaleziono kanału ${this.channelId}`);
            return;
        }

        // Szukaj istniejącej wiadomości bota z dowolnym stanem gry
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existing = messages?.find(m =>
            m.author.id === client.user.id && STATES.includes(m.content)
        );

        if (existing) {
            this.messageId = existing.id;
            this.step = STATES.indexOf(existing.content);
            if (this.step === -1) this.step = 0;
            logger.info(`✅ EmptyPuzzle: znaleziono istniejącą wiadomość (krok ${this.step})`);
        } else {
            const sent = await channel.send(STATES[0]);
            this.messageId = sent.id;
            this.step = 0;
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

            if (this.step === STATES.length) {
                // Wygrana!
                await message.delete().catch(() => {});
                await message.channel.send('## 🎉 Wygrałeś!');
                logger.success('🏆 EmptyPuzzle: Wygrałeś!');
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
            // Błędna wiadomość — po prostu usuń
            await message.delete().catch(() => {});
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
