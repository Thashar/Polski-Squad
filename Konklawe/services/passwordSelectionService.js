const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * Password Selection Service - Obsługa wyboru hasła z wygenerowanych przez AI
 */
class PasswordSelectionService {
    constructor(config, gameService, dataService) {
        this.config = config;
        this.gameService = gameService;
        this.dataService = dataService;
        this.activeSelectionMessageId = null; // ID wiadomości z przyciskami wyboru
    }

    /**
     * Tworzy wiadomość z przyciskami wyboru hasła
     * @param {TextChannel} channel - Kanał na którym wysłać wiadomość
     * @param {string[]} passwords - Tablica haseł do wyboru
     * @returns {Promise<Message>} - Wysłana wiadomość
     */
    async createPasswordSelectionMessage(channel, passwords) {
        // Usuń poprzednią wiadomość jeśli istnieje
        await this.deleteSelectionMessage(channel);

        // Twórz przyciski dla każdego hasła
        const buttons = passwords.map((password, index) =>
            new ButtonBuilder()
                .setCustomId(`password_select_${index}_${password}`)
                .setLabel(password)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔑')
        );

        const row = new ActionRowBuilder().addComponents(buttons);

        const message = await channel.send({
            content: '🤖 **AI wygenerowało 3 hasła** - wybierz jedno klikając przycisk:',
            components: [row]
        });

        this.activeSelectionMessageId = message.id;
        await this.saveState();

        logger.info(`📝 Utworzono wiadomość z wyborem haseł (ID: ${message.id})`);
        return message;
    }

    /**
     * Usuwa wiadomość z wyborem haseł
     * @param {TextChannel} channel - Kanał z którego usunąć wiadomość
     */
    async deleteSelectionMessage(channel) {
        if (!this.activeSelectionMessageId) return;

        try {
            const message = await channel.messages.fetch(this.activeSelectionMessageId);
            await message.delete();
            logger.info('🗑️ Usunięto wiadomość z wyborem haseł');
        } catch (error) {
            // Ignoruj błędy Unknown Message (wiadomość już usunięta)
            if (error.code !== 10008) {
                logger.warn(`⚠️ Nie udało się usunąć wiadomości wyboru haseł: ${error.message}`);
            }
        }

        this.activeSelectionMessageId = null;
        await this.saveState();
    }

    /**
     * Zapisuje stan do pliku
     */
    async saveState() {
        this.dataService.savePasswordSelectionState({
            activeSelectionMessageId: this.activeSelectionMessageId
        });
    }

    /**
     * Wczytuje stan z pliku
     */
    loadState() {
        const state = this.dataService.loadPasswordSelectionState();
        this.activeSelectionMessageId = state.activeSelectionMessageId || null;

    }
}

module.exports = PasswordSelectionService;
