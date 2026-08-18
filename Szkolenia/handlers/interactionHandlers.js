const { MessageFlags } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');
const { delay } = require('../utils/helpers');

const logger = createBotLogger('Szkolenia');

/**
 * Główna funkcja obsługi interakcji przycisków i modali
 */
async function handleInteraction(interaction, state, config) {
    try {
        // Obsługa slash commandów
        if (interaction.isChatInputCommand()) {
            return;
        }

        // Obsługa przycisków
        if (!interaction.isButton()) return;

        // ⚠️ Żadnego `delay()` przed odpowiedzią — Discord unieważnia interakcję
        // po 3 sekundach. Sekunda uśpienia plus `members.fetch()` zjadały połowę
        // budżetu i przy wolniejszej odpowiedzi API leciał błąd "Unknown interaction".

        const { customId, user, channel } = interaction;

        // Sprawdź czy to właściciel wątku klika przycisk (tylko dla wątków)
        if (!channel.isThread()) return;

        const guild = interaction.guild;
        const member = await guild.members.fetch(user.id);
        const memberName = member.displayName || user.username;

        // Właściciela rozpoznajemy po zapisanym ID, a nazwa wątku jest tylko zapasem
        // dla wpisów sprzed wprowadzenia `ownerId`. Samo porównanie z nazwą wątku
        // odcinało właściciela od jego własnych przycisków po każdej zmianie nicku.
        const zapisanyWlasciciel = state.lastReminderMap.get(channel.id)?.ownerId || null;
        const jestWlascicielem = zapisanyWlasciciel
            ? zapisanyWlasciciel === user.id
            : channel.name === memberName;

        if (!jestWlascicielem) {
            await interaction.reply({
                content: config.messages.ownerOnly,
                flags: MessageFlags.Ephemeral
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

async function handleLockThread(interaction, state, config) {
    const { channel } = interaction;

    await interaction.update({
        content: config.messages.threadLocked,
        components: []
    });

    await reminderStorage.removeReminder(state.lastReminderMap, channel.id);

    await delay(2000);
    try {
        await channel.setLocked(true, 'Wątek zablokowany na żądanie właściciela');
        await channel.setArchived(true, 'Wątek zablokowany na żądanie właściciela');
    } catch (error) {
        logger.error('Błąd podczas blokowania wątku:', error);
    }
}

async function handleKeepOpen(interaction, state, config) {
    const { channel } = interaction;

    await interaction.update({
        content: config.messages.threadKeptOpen,
        components: []
    });

    await reminderStorage.resetReminderStatus(state.lastReminderMap, channel.id);
}

/**
 * Rejestracja slash commandów
 */
async function registerSlashCommands(client) {
    // Brak komend slash do zarejestrowania
}

module.exports = {
    handleInteraction,
    registerSlashCommands
};
