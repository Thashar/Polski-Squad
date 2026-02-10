const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');

const logger = createBotLogger('Szkolenia');

const { delay } = require('../utils/helpers');

/**
 * Główna funkcja obsługi interakcji przycisków i modali
 */
async function handleInteraction(interaction, state, config) {
    try {
        // Obsługa modali (korekta odpowiedzi AI)
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('ai_correction_')) {
                await handleCorrectionModal(interaction, state);
            }
            return;
        }

        // Obsługa przycisków
        if (!interaction.isButton()) return;

        await delay(1000);

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
 * Obsługa feedbacku AI Chat (👍/👎)
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
        // 👍 - oceń pozytywnie
        const fragments = feedbackData.knowledge.split(/\n\n+/).map(s => s.trim()).filter(s => s);
        await state.knowledgeService.rateEntries(fragments, true);
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
 */
const APPROVAL_CHANNEL_ID = '1470703877924978772';

async function handleCorrectionModal(interaction, state) {
    const messageId = interaction.customId.replace('ai_correction_', '');
    const feedbackData = state.feedbackMap?.get(messageId);

    const question = interaction.fields.getTextInputValue('question');
    const correction = interaction.fields.getTextInputValue('correction');
    const authorName = interaction.member?.displayName || interaction.user.username;

    // Oceń negatywnie fragmenty
    if (feedbackData?.knowledge) {
        const fragments = feedbackData.knowledge.split(/\n\n+/).map(s => s.trim()).filter(s => s);
        await state.knowledgeService.rateEntries(fragments, false);
    }
    state.feedbackMap.delete(messageId);

    // Dodaj korektę jako wpis do bazy wiedzy
    const correctionId = await state.knowledgeService.addCorrectionEntry(question, correction, authorName);

    // Wyślij na kanał zatwierdzania
    if (correctionId) {
        try {
            const approvalChannel = await state.client.channels.fetch(APPROVAL_CHANNEL_ID);
            if (approvalChannel) {
                const content = `Pytanie: ${question}\nOdpowiedź: ${correction}`;
                const embed = new EmbedBuilder()
                    .setTitle('📝 Korekta odpowiedzi AI')
                    .setDescription(content.length > 4000 ? content.substring(0, 4000) + '...' : content)
                    .addFields(
                        { name: 'Autor korekty', value: authorName, inline: true }
                    )
                    .setFooter({ text: 'Zaznacz ✅ aby usunąć z bazy wiedzy' })
                    .setTimestamp()
                    .setColor(0xe67e22);

                const approvalMsg = await approvalChannel.send({ embeds: [embed] });
                await state.knowledgeService.setApprovalMsgId(correctionId, approvalMsg.id);
            }
        } catch (error) {
            logger.error(`❌ Błąd wysyłania korekty na kanał zatwierdzania: ${error.message}`);
        }
    }

    try {
        await interaction.reply({
            content: '👎 *Oceniono* — poprawna odpowiedź została zapisana do bazy wiedzy. Dziękuję!',
            ephemeral: true
        });
    } catch (err) { /* expired */ }

    // Usuń przyciski z oryginalnej wiadomości
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
