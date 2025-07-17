const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');
/**
 * Obsługa wszystkich interakcji przycisków w systemie szkoleń.
 * -------------------------------------------------
 * • przycisk zamknięcia wątku (lock_thread)
 * • przycisk pozostawienia wątku otwartym (keep_open)
 */

const { delay } = require('../utils/helpers');

/**
 * Główna funkcja obsługi interakcji przycisków
 * @param {Interaction} interaction - Interakcja Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function handleInteraction(interaction, state, config) {
    if (!interaction.isButton()) return;

    await delay(1000); // Drobny debounce

    try {
        const { customId, user, channel } = interaction;

        // Sprawdź czy to właściciel wątku klika przycisk
        if (!channel.isThread()) return;

        const guild = interaction.guild;
        const member = await guild.members.fetch(user.id);
        const memberName = member.displayName || user.username;

        if (channel.name !== memberName) {
            await interaction.reply({
                content: config.messages.ownerOnly,
                ephemeral: true
            });
            return;
        }

        if (customId === 'lock_thread') {
            await handleLockThread(interaction, state, config);
        } else if (customId === 'keep_open') {
            await handleKeepOpen(interaction, state, config);
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
    }
}

/**
 * Obsługa zamykania wątku
 * @param {Interaction} interaction - Interakcja Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function handleLockThread(interaction, state, config) {
    const { channel } = interaction;

    await interaction.update({
        content: config.messages.threadLocked,
        components: []
    });

    // Usuń wątek z mapy przypomnień
    state.lastReminderMap.delete(channel.id);

    // Zablokuj wątek po krótkiej chwili
    setTimeout(async () => {
        try {
            await channel.setLocked(true, 'Wątek zablokowany na żądanie właściciela');
            await channel.setArchived(true, 'Wątek zablokowany na żądanie właściciela');
        } catch (error) {
            logger.error('Błąd podczas blokowania wątku:', error);
        }
    }, 2000);
}

/**
 * Obsługa pozostawienia wątku otwartym
 * @param {Interaction} interaction - Interakcja Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function handleKeepOpen(interaction, state, config) {
    const { channel } = interaction;

    await interaction.update({
        content: config.messages.threadKeptOpen,
        components: []
    });

    // Nie aktualizuj czasu ostatniego przypomnienia - pozwól botowi przypominać co 24h
    // state.lastReminderMap.set(channel.id, Date.now());
}

module.exports = {
    handleInteraction
};