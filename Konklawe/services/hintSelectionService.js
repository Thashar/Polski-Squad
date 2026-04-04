const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * Hint Selection Service - Obsługa wyboru podpowiedzi z wygenerowanych przez AI
 */
class HintSelectionService {
    constructor(config, gameService, dataService) {
        this.config = config;
        this.gameService = gameService;
        this.dataService = dataService;
        this.activeSelectionMessageId = null; // ID wiadomości z przyciskami wyboru
    }

    /**
     * Tworzy wiadomość z przyciskami wyboru podpowiedzi
     * @param {TextChannel} channel - Kanał na którym wysłać wiadomość
     * @param {string[]} hints - Tablica podpowiedzi do wyboru
     * @param {string} difficulty - Poziom trudności (easy/normal/hard)
     * @returns {Promise<Message>} - Wysłana wiadomość
     */
    async createHintSelectionMessage(channel, hints, difficulty = 'normal') {
        // Usuń poprzednią wiadomość jeśli istnieje
        await this.deleteSelectionMessage(channel);

        // Mapa emoji dla poziomów trudności
        const difficultyEmoji = {
            'easy': '🟢',
            'normal': '🔵',
            'hard': '🔴'
        };

        const difficultyText = {
            'easy': 'łatwych',
            'normal': 'zwykłych',
            'hard': 'trudnych'
        };

        // Twórz przyciski dla każdej podpowiedzi (każdy w osobnym rzędzie)
        const rows = hints.map((hint, index) => {
            const button = new ButtonBuilder()
                .setCustomId(`hint_select_${index}_${hint.substring(0, 80)}`) // Limit 100 znaków dla customId
                .setLabel(hint.length > 80 ? hint.substring(0, 77) + '...' : hint)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('💡');

            return new ActionRowBuilder().addComponents(button);
        });

        const emoji = difficultyEmoji[difficulty] || '💡';
        const text = difficultyText[difficulty] || 'zwykłych';

        const message = await channel.send({
            content: `${emoji} **AI wygenerowało ${hints.length} ${text} ${hints.length === 1 ? 'podpowiedź' : hints.length < 5 ? 'podpowiedzi' : 'podpowiedzi'}** - wybierz jedną klikając przycisk:`,
            components: rows
        });

        this.activeSelectionMessageId = message.id;
        await this.saveState();

        logger.info(`📝 Utworzono wiadomość z wyborem podpowiedzi (${difficulty}, ID: ${message.id})`);
        return message;
    }

    /**
     * Usuwa wiadomość z wyborem podpowiedzi
     * @param {TextChannel} channel - Kanał z którego usunąć wiadomość
     */
    async deleteSelectionMessage(channel) {
        if (!this.activeSelectionMessageId) return;

        try {
            const message = await channel.messages.fetch(this.activeSelectionMessageId);
            await message.delete();
            logger.info('🗑️ Usunięto wiadomość z wyborem podpowiedzi');
        } catch (error) {
            // Ignoruj błędy Unknown Message (wiadomość już usunięta)
            if (error.code !== 10008) {
                logger.warn(`⚠️ Nie udało się usunąć wiadomości wyboru podpowiedzi: ${error.message}`);
            }
        }

        this.activeSelectionMessageId = null;
        await this.saveState();
    }

    /**
     * Zapisuje stan do pliku
     */
    async saveState() {
        this.dataService.saveHintSelectionState({
            activeSelectionMessageId: this.activeSelectionMessageId
        });
    }

    /**
     * Wczytuje stan z pliku
     */
    loadState() {
        const state = this.dataService.loadHintSelectionState();
        this.activeSelectionMessageId = state.activeSelectionMessageId || null;

    }
}

module.exports = HintSelectionService;
