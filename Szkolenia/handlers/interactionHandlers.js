const { SlashCommandBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');

const logger = createBotLogger('Szkolenia');

const { delay } = require('../utils/helpers');

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

        await delay(1000);

        const { customId, user, channel } = interaction;

        // Sprawdź czy to właściciel wątku klika przycisk (tylko dla wątków)
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

async function handleLockThread(interaction, state, config) {
    const { channel } = interaction;

    await interaction.update({
        content: config.messages.threadLocked,
        components: []
    });

    await reminderStorage.removeReminder(state.lastReminderMap, channel.id);

    setTimeout(async () => {
        try {
            await channel.setLocked(true, 'Wątek zablokowany na żądanie właściciela');
            await channel.setArchived(true, 'Wątek zablokowany na żądanie właściciela');
        } catch (error) {
            logger.error('Błąd podczas blokowania wątku:', error);
        }
    }, 2000);
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
    try {
        await client.application.commands.set([]);
        logger.info('✅ Komendy slash zarejestrowane');
    } catch (error) {
        logger.error(`❌ Błąd rejestracji komend slash: ${error.message}`);
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands
};
