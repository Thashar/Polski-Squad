const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, SlashCommandBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
            if (interaction.commandName === 'ranking-pomocy') {
                await handleRankingPomocy(interaction, state);
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

        await delay(1000);

        const { customId, user, channel } = interaction;

        // Feedback AI Chat (👍/👎)
        if (customId === 'ai_feedback_up' || customId === 'ai_feedback_down') {
            await handleAiFeedback(interaction, state, customId === 'ai_feedback_up');
            return;
        }

        // Nawigacja rankingu (◀ / ▶)
        if (customId.startsWith('ranking_nav_')) {
            await handleRankingNav(interaction, state);
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

    if (isPositive) {
        // 👍 - tylko pytający może ocenić pozytywnie
        if (feedbackData.askerId && interaction.user.id !== feedbackData.askerId) {
            try {
                await interaction.reply({ content: '⚠️ Tylko osoba która zadała pytanie może ocenić pozytywnie.', ephemeral: true });
            } catch (err) { /* expired */ }
            return;
        }

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
        // 👎 - każdy może kliknąć i zaproponować korektę (przyciski zostają)
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

    // Oceń negatywnie fragmenty (tylko raz per wiadomość - nie usuwaj z feedbackMap)
    if (feedbackData?.knowledge) {
        const fragments = feedbackData.knowledge.split(/\n\n+/).map(s => s.trim()).filter(s => s);
        await state.knowledgeService.rateEntries(fragments, false);
    }

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
            content: '✅ Twoja korekta została zapisana do bazy wiedzy. Dziękuję!',
            ephemeral: true
        });
    } catch (err) { /* expired */ }
}

/**
 * Formatowanie nazwy miesiąca po polsku
 */
const MONTH_NAMES = [
    'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
    'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

function formatMonth(monthStr) {
    const [year, month] = monthStr.split('-');
    return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

/**
 * Buduje embed rankingu dla danego miesiąca
 */
function buildRankingEmbed(state, month, userId) {
    const ranking = state.knowledgeService.getRanking(month);
    const userPoints = state.knowledgeService.getUserPoints(userId, month);
    const availableMonths = state.knowledgeService.getAvailableMonths();

    const embed = new EmbedBuilder()
        .setTitle(`📊 Ranking Pomocy — ${formatMonth(month)}`)
        .setColor(0x3498db)
        .setTimestamp();

    // Twoje punkty na górze
    embed.setDescription(`**Twoje punkty:** ${userPoints} pkt`);

    // TOP 10
    if (ranking.length === 0) {
        embed.addFields({ name: 'Top 10', value: '*Brak danych w tym miesiącu*' });
    } else {
        const medals = ['🥇', '🥈', '🥉'];
        const top10 = ranking.slice(0, 10);
        const lines = top10.map((entry, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            const highlight = entry.userId === userId ? ' ⬅️' : '';
            return `${prefix} ${entry.displayName} — **${entry.points}** pkt${highlight}`;
        });
        embed.addFields({ name: 'Top 10', value: lines.join('\n') });
    }

    // Przyciski nawigacji
    const currentIndex = availableMonths.indexOf(month);
    const row = new ActionRowBuilder();

    const prevButton = new ButtonBuilder()
        .setCustomId(`ranking_nav_prev_${availableMonths[currentIndex + 1] || 'none'}`)
        .setLabel('◀ Starszy')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentIndex >= availableMonths.length - 1);

    const nextButton = new ButtonBuilder()
        .setCustomId(`ranking_nav_next_${availableMonths[currentIndex - 1] || 'none'}`)
        .setLabel('Nowszy ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentIndex <= 0);

    row.addComponents(prevButton, nextButton);

    return { embed, row };
}

/**
 * Obsługa komendy /ranking-pomocy
 */
async function handleRankingPomocy(interaction, state) {
    const currentMonth = state.knowledgeService.getCurrentMonth();
    const availableMonths = state.knowledgeService.getAvailableMonths();

    // Jeśli brak danych, pokaż aktualny miesiąc (pusty)
    const month = availableMonths.length > 0 && availableMonths.includes(currentMonth)
        ? currentMonth
        : (availableMonths[0] || currentMonth);

    const { embed, row } = buildRankingEmbed(state, month, interaction.user.id);

    await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: 64
    });
}

/**
 * Obsługa nawigacji po miesiącach (przyciski ◀ / ▶)
 */
async function handleRankingNav(interaction, state) {
    const month = interaction.customId.replace(/^ranking_nav_(prev|next)_/, '');
    if (month === 'none') return;

    const { embed, row } = buildRankingEmbed(state, month, interaction.user.id);

    try {
        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    } catch (err) { /* expired */ }
}

/**
 * Rejestracja slash commandów
 */
async function registerSlashCommands(client) {
    const commands = [
        new SlashCommandBuilder()
            .setName('ranking-pomocy')
            .setDescription('Wyświetla ranking osób, które pomogły budować bazę wiedzy')
    ];

    try {
        await client.application.commands.set(commands);
        logger.info('✅ Komendy slash zarejestrowane');
    } catch (error) {
        logger.error(`❌ Błąd rejestracji komend slash: ${error.message}`);
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands
};
