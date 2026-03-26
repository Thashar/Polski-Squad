const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');
const DATA_FILE = path.join(__dirname, '../data/echo_puzzle_state.json');

const PUZZLE_MESSAGE = '# Spotkaliście kiedyś nimfę, która nie ma własnego głosu? Potrafi jedynie oddać wam to, co sami jej dacie. Ale żeby was usłyszała, musicie ją zawołać po imieniu... a ona na pewno wam odpowie.';
const MESSAGES_BEFORE_REPEAT = 10;
const MIN_LENGTH = 3;

class EchoPuzzleService {
    constructor(config) {
        this.channelId = config.echoPuzzle.channelId;
        this.solved = false;
        this.messagesSincePrompt = 0;
        this.lastEntry = null;
        this.client = null;
        this._loadState();
    }

    _loadState() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                this.solved              = saved.solved              ?? false;
                this.messagesSincePrompt = saved.messagesSincePrompt ?? 0;
                this.lastEntry           = saved.lastEntry           ?? null;
            }
        } catch (err) {
            logger.error('❌ EchoPuzzle: błąd wczytywania stanu:', err.message);
        }
    }

    _saveState() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify({
                solved:              this.solved,
                messagesSincePrompt: this.messagesSincePrompt,
                lastEntry:           this.lastEntry,
            }, null, 2));
        } catch (err) {
            logger.error('❌ EchoPuzzle: błąd zapisu stanu:', err.message);
        }
    }

    async initialize(client) {
        this.client = client;
        const channel = await client.channels.fetch(this.channelId).catch(() => null);
        if (!channel) {
            logger.error(`❌ EchoPuzzle: nie znaleziono kanału ${this.channelId}`);
            return;
        }

        // Sprawdź czy wiadomość zagadki już istnieje
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existing = messages?.find(m =>
            m.author.id === client.user.id && m.content === PUZZLE_MESSAGE
        );

        if (existing) {
            logger.info(`✅ EchoPuzzle: znaleziono istniejącą wiadomość zagadki`);
        } else {
            await channel.send(PUZZLE_MESSAGE);
            logger.info(`✅ EchoPuzzle: wysłano wiadomość zagadki`);
        }

        this.messagesSincePrompt = 0;
    }

    async handleMessageCreate(message) {
        if (message.author.bot) return;
        if (message.channelId !== this.channelId) return;

        // Po wygranej — usuń każdą wiadomość
        if (this.solved) {
            await message.delete().catch(() => {});
            return;
        }

        const content = message.content.trim();

        // Sprawdź rozwiązanie: ta sama treść (≥3 znaków) od tej samej osoby dwa razy z rzędu
        if (
            content.length >= MIN_LENGTH &&
            this.lastEntry?.authorId === message.author.id &&
            this.lastEntry?.content === content
        ) {
            this.solved = true;
            this.lastEntry = null;
            this._saveState();
            await message.channel.send('## 🎉 Wygrałeś!');
            logger.success('🏆 EchoPuzzle: Wygrałeś!');
            return;
        }

        // Zapisz ostatnią wiadomość i zwiększ licznik
        this.lastEntry = { authorId: message.author.id, content };
        this.messagesSincePrompt++;

        // Co MESSAGES_BEFORE_REPEAT wiadomości powtórz zagadkę
        if (this.messagesSincePrompt >= MESSAGES_BEFORE_REPEAT) {
            this.messagesSincePrompt = 0;
            await message.channel.send(PUZZLE_MESSAGE).catch(err =>
                logger.error('❌ EchoPuzzle: nie można wysłać powtórki:', err.message)
            );
        }
        this._saveState();
    }

    async reset() {
        this.solved = false;
        this.messagesSincePrompt = 0;
        this.lastEntry = null;
        if (this.client) {
            try {
                const channel = await this.client.channels.fetch(this.channelId);
                await channel.send(PUZZLE_MESSAGE);
            } catch (err) {
                logger.error('❌ EchoPuzzle: nie można wysłać wiadomości po resecie:', err.message);
            }
        }
        this._saveState();
        logger.info('🔄 EchoPuzzle: zagadka zresetowana');
    }
}

module.exports = EchoPuzzleService;
