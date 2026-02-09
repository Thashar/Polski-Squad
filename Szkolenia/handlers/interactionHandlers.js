const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');

const logger = createBotLogger('Szkolenia');
/**
 * Obsługa interakcji przycisków w systemie szkoleń.
 * • przycisk zamknięcia wątku (lock_thread)
 * • przycisk pozostawienia wątku otwartym (keep_open)
 */

const { delay } = require('../utils/helpers');

/**
 * Główna funkcja obsługi interakcji przycisków i modali
 * @param {Interaction} interaction - Interakcja Discord
 * @param {Object} state - Stan współdzielony aplikacji
 * @param {Object} config - Konfiguracja aplikacji
 */
async function handleInteraction(interaction, state, config) {
    try {
        // Obsługa slash commands
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'scan-knowledge') {
                await handleScanKnowledge(interaction, state);
            }
            return;
        }

        // Obsługa przycisków
        if (!interaction.isButton()) return;

        await delay(1000); // Drobny debounce

        const { customId, user, channel } = interaction;

        // Feedback AI Chat (👍/👎)
        if (customId === 'ai_feedback_up' || customId === 'ai_feedback_down') {
            await handleAiFeedback(interaction, state, customId === 'ai_feedback_up');
            return;
        }

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
    await reminderStorage.removeReminder(state.lastReminderMap, channel.id);

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

    // Zresetuj status przypomnienia - użytkownik wybrał "jeszcze nie zamykaj"
    await reminderStorage.resetReminderStatus(state.lastReminderMap, channel.id);
}

/**
 * Obsługa slash command /scan-knowledge (admin)
 * Skanuje kanały wiedzy rok wstecz i zapisuje wpisy do bazy
 */
async function handleScanKnowledge(interaction, state) {
    const isAdmin = state.aiChatService.isAdmin(interaction.member);
    if (!isAdmin) {
        await interaction.reply({ content: '⚠️ Tylko administratorzy mogą uruchomić skanowanie.', ephemeral: true });
        return;
    }

    await interaction.deferReply();
    const channel = interaction.channel;
    let tokenExpired = false;

    try {
        const result = await state.aiChatService.scanChannelHistory(state.client, async (scanned, saved, channelName) => {
            if (tokenExpired) return;
            try {
                await interaction.editReply(`🔍 Skanowanie... ${scanned} wiadomości sprawdzonych, ${saved} zapisanych (kanał: #${channelName})`);
            } catch (err) {
                tokenExpired = true;
            }
        });

        const summary = `✅ **Skanowanie zakończone!**\n\n` +
            `📊 Sprawdzono: **${result.totalScanned}** wiadomości\n` +
            `📚 Zapisano: **${result.totalSaved}** nowych wpisów\n` +
            `⏭️ Pominięto (duplikaty): **${result.totalSkipped}**`;

        if (tokenExpired) {
            await channel.send(summary);
        } else {
            await interaction.editReply(summary);
        }
    } catch (error) {
        logger.error(`❌ Błąd skanowania: ${error.message}`);
        try {
            if (tokenExpired) {
                await channel.send('❌ Wystąpił błąd podczas skanowania. Sprawdź logi.');
            } else {
                await interaction.editReply('❌ Wystąpił błąd podczas skanowania. Sprawdź logi.');
            }
        } catch (err) { /* ignore */ }
    }
}

/**
 * Obsługa feedbacku AI Chat (👍/👎)
 * Aktualizuje oceny fragmentów bazy wiedzy użytych w odpowiedzi
 */
async function handleAiFeedback(interaction, state, isPositive) {
    const messageId = interaction.message.id;
    const relevantKnowledge = state.feedbackMap?.get(messageId);

    if (!relevantKnowledge) {
        await interaction.update({ components: [] });
        return;
    }

    // Oceń fragmenty w bazie wiedzy
    await state.aiChatService.rateKnowledgeFragments(relevantKnowledge, isPositive);

    // Usuń przyciski i pokaż wynik
    state.feedbackMap.delete(messageId);
    const emoji = isPositive ? '👍' : '👎';
    await interaction.update({
        content: interaction.message.content + `\n\n${emoji} *Oceniono*`,
        components: []
    });
}

module.exports = {
    handleInteraction
};