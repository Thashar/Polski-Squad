const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
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

        // Obsługa modali (korekta odpowiedzi AI)
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ai_correction_')) {
                await handleCorrectionModal(interaction, state);
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

    await interaction.reply('🔍 Rozpoczynam skanowanie kanałów (ostatni rok)...');
    const channel = interaction.channel;
    let progressMsg = null;

    try {
        const results = await state.aiChatService.scanChannelHistory(state.client, async (event) => {
            if (event.type === 'progress') {
                const text = `🔍 Skanowanie **#${event.channelName}**... ${event.scanned} wiadomości, ${event.saved} zapisanych`;
                if (progressMsg) {
                    try { await progressMsg.edit(text); } catch (err) { /* ignore */ }
                } else {
                    progressMsg = await channel.send(text);
                }
            } else if (event.type === 'done') {
                if (progressMsg) {
                    try { await progressMsg.delete(); } catch (err) { /* ignore */ }
                    progressMsg = null;
                }
                await channel.send(
                    `📁 **#${event.channelName}** — ` +
                    `sprawdzono: **${event.scanned}**, ` +
                    `zapisano: **${event.saved}**, ` +
                    `duplikaty: **${event.skipped}**`
                );
            }
        });

        const totalScanned = results.reduce((s, r) => s + r.scanned, 0);
        const totalSaved = results.reduce((s, r) => s + r.saved, 0);
        const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);

        await channel.send(
            `✅ **Skanowanie zakończone!**\n\n` +
            `📊 Sprawdzono: **${totalScanned}** wiadomości\n` +
            `📚 Zapisano: **${totalSaved}** nowych wpisów\n` +
            `⏭️ Pominięto (duplikaty): **${totalSkipped}**`
        );
    } catch (error) {
        logger.error(`❌ Błąd skanowania: ${error.message}`);
        await channel.send('❌ Wystąpił błąd podczas skanowania. Sprawdź logi.');
    }
}

/**
 * Obsługa feedbacku AI Chat (👍/👎)
 * Aktualizuje oceny fragmentów bazy wiedzy użytych w odpowiedzi
 */
async function handleAiFeedback(interaction, state, isPositive) {
    const messageId = interaction.message.id;
    const feedbackData = state.feedbackMap?.get(messageId);

    if (!feedbackData) {
        try { await interaction.update({ components: [] }); } catch (err) { /* expired */ }
        return;
    }

    // Tylko pytający może ocenić
    if (feedbackData.askerId && interaction.user.id !== feedbackData.askerId) {
        try {
            await interaction.reply({ content: '⚠️ Tylko osoba która zadała pytanie może ocenić odpowiedź.', ephemeral: true });
        } catch (err) { /* expired */ }
        return;
    }

    if (isPositive) {
        // 👍 - oceń pozytywnie i zamknij
        await state.aiChatService.rateKnowledgeFragments(feedbackData.knowledge, true);
        state.feedbackMap.delete(messageId);
        try {
            await interaction.update({
                content: interaction.message.content + '\n\n👍 *Oceniono*',
                components: []
            });
        } catch (err) { /* expired */ }
    } else {
        // 👎 - pokaż modal z prośbą o poprawną odpowiedź
        const question = feedbackData.question || 'Brak pytania';
        const modal = new ModalBuilder()
            .setCustomId(`ai_correction_${messageId}`)
            .setTitle('Popraw odpowiedź AI')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('question')
                        .setLabel('Pytanie które zadano')
                        .setStyle(TextInputStyle.Short)
                        .setValue(question.substring(0, 100))
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('correction')
                        .setLabel('Poprawna odpowiedź')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Wpisz poprawną odpowiedź na to pytanie...')
                        .setRequired(true)
                        .setMaxLength(1000)
                )
            );

        try {
            await interaction.showModal(modal);
        } catch (err) { /* expired */ }
    }
}

/**
 * Obsługa modala korekty odpowiedzi AI
 * Zapisuje pytanie + poprawną odpowiedź do pliku korekt
 */
async function handleCorrectionModal(interaction, state) {
    const messageId = interaction.customId.replace('ai_correction_', '');
    const feedbackData = state.feedbackMap?.get(messageId);

    const question = interaction.fields.getTextInputValue('question');
    const correction = interaction.fields.getTextInputValue('correction');
    const authorName = interaction.member?.displayName || interaction.user.username;

    // Oceń negatywnie fragmenty
    if (feedbackData?.knowledge) {
        await state.aiChatService.rateKnowledgeFragments(feedbackData.knowledge, false);
    }
    state.feedbackMap.delete(messageId);

    // Zapisz korektę do pliku
    await state.aiChatService.saveCorrection(question, correction, authorName);

    try {
        await interaction.reply({
            content: '👎 *Oceniono* — poprawna odpowiedź została zapisana do bazy wiedzy. Dziękuję!',
            ephemeral: true
        });
    } catch (err) { /* expired */ }

    // Edytuj oryginalną wiadomość - usuń przyciski
    try {
        await interaction.message.edit({
            content: interaction.message.content + '\n\n👎 *Oceniono i poprawiono*',
            components: []
        });
    } catch (err) { /* expired */ }
}

module.exports = {
    handleInteraction
};