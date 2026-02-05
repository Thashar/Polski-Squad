const { createBotLogger } = require('../../utils/consoleLogger');
const { reminderStorage } = require('../services/threadService');

const logger = createBotLogger('Szkolenia');
/**
 * Obsługa wszystkich interakcji przycisków w systemie szkoleń.
 * -------------------------------------------------
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
        // Obsługa modali (okienek)
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'knowledge_modal') {
                await handleKnowledgeModalSubmit(interaction, state, config);
            }
            return;
        }

        // Obsługa przycisków
        if (!interaction.isButton()) return;

        await delay(1000); // Drobny debounce

        const { customId, user, channel } = interaction;

        // AI Chat - przycisk dodawania wiedzy (działa wszędzie)
        if (customId === 'add_knowledge') {
            await handleAddKnowledge(interaction, state, config);
            return;
        }

        // AI Chat - przyciski zatwierdzania/odrzucania (działa wszędzie, tylko admini)
        if (customId.startsWith('approve_knowledge_') || customId.startsWith('reject_knowledge_')) {
            await handleKnowledgeApproval(interaction, state, config);
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
 * Obsługa przycisku "Dodaj nowe informacje" - pokazuje modal
 */
async function handleAddKnowledge(interaction, state, config) {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

    const modal = new ModalBuilder()
        .setCustomId('knowledge_modal')
        .setTitle('Dodaj wiedzę do kompendium');

    const knowledgeInput = new TextInputBuilder()
        .setCustomId('knowledge_content')
        .setLabel('Informacje do dodania')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Dodaj przydatne informacje, np. Cofając postać SP można odzyskać włożone w jej rozwój omnishardy.')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(1000);

    const actionRow = new ActionRowBuilder().addComponents(knowledgeInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

/**
 * Obsługa wysłania modalu - wysyła wiadomość do kanału z przyciskami zatwierdzania
 */
async function handleKnowledgeModalSubmit(interaction, state, config) {
    const knowledgeContent = interaction.fields.getTextInputValue('knowledge_content');
    const user = interaction.user;
    const member = interaction.member;

    // Kanał do wysyłania zgłoszeń
    const approvalChannelId = '1263240344871370804';
    const approvalChannel = await interaction.client.channels.fetch(approvalChannelId);

    if (!approvalChannel) {
        await interaction.reply({
            content: '⚠️ Nie znaleziono kanału do zgłoszeń. Skontaktuj się z administratorem.',
            ephemeral: true
        });
        return;
    }

    // Utwórz przyciski zatwierdzania
    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

    const approveButton = new ButtonBuilder()
        .setCustomId(`approve_knowledge_${user.id}_${Date.now()}`)
        .setLabel('Zatwierdź')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const rejectButton = new ButtonBuilder()
        .setCustomId(`reject_knowledge_${user.id}_${Date.now()}`)
        .setLabel('Odrzuć')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);

    // Wyślij wiadomość do kanału
    await approvalChannel.send({
        content: `📚 **Nowa propozycja wiedzy od ${member.displayName || user.username}:**\n\n${knowledgeContent}`,
        components: [row]
    });

    // Odpowiedź do użytkownika
    await interaction.reply({
        content: '✅ Twoja propozycja została wysłana do zatwierdzenia!',
        ephemeral: true
    });

    logger.info(`📚 Nowa propozycja wiedzy od ${user.username}: ${knowledgeContent.substring(0, 50)}...`);
}

/**
 * Obsługa zatwierdzania/odrzucania wiedzy
 */
async function handleKnowledgeApproval(interaction, state, config) {
    const { customId, user, message } = interaction;
    const member = interaction.member;

    // Sprawdź czy użytkownik jest adminem
    const isAdmin = config.adminRoles && config.adminRoles.some(roleId => member.roles.cache.has(roleId));

    if (!isAdmin) {
        await interaction.reply({
            content: '⚠️ Tylko administratorzy mogą zatwierdzać/odrzucać propozycje wiedzy.',
            ephemeral: true
        });
        return;
    }

    const isApprove = customId.startsWith('approve_knowledge_');

    if (isApprove) {
        // Wyciągnij treść wiedzy z wiadomości
        const knowledgeContent = message.content.split(':**\n\n')[1];

        if (!knowledgeContent) {
            await interaction.reply({
                content: '⚠️ Nie udało się wyciągnąć treści wiedzy.',
                ephemeral: true
            });
            return;
        }

        // Zapisz do knowledge_base.md
        const fs = require('fs').promises;
        const path = require('path');
        const knowledgeBasePath = path.join(__dirname, '../knowledge_base.md');

        try {
            // Wczytaj obecną zawartość
            let currentContent = '';
            try {
                currentContent = await fs.readFile(knowledgeBasePath, 'utf-8');
            } catch (err) {
                // Plik nie istnieje - utworzymy nowy
                currentContent = '# Baza Wiedzy - Survivor.io\n\n';
            }

            // Dodaj nową wiedzę na końcu z timestampem
            const now = new Date();
            const timestamp = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const newEntry = `\n\n---\n\n**Dodano ${timestamp}:**\n${knowledgeContent}\n`;

            await fs.writeFile(knowledgeBasePath, currentContent + newEntry, 'utf-8');

            // Zaktualizuj wiadomość
            await interaction.update({
                content: message.content + `\n\n✅ **Zatwierdzone przez ${member.displayName || user.username}** (${timestamp})`,
                components: []
            });

            logger.info(`✅ Wiedza zatwierdzona przez ${user.username}: ${knowledgeContent.substring(0, 50)}...`);
        } catch (error) {
            logger.error(`❌ Błąd zapisu do knowledge_base.md: ${error.message}`);
            await interaction.reply({
                content: '⚠️ Wystąpił błąd podczas zapisywania wiedzy.',
                ephemeral: true
            });
        }
    } else {
        // Odrzucenie
        await interaction.update({
            content: message.content + `\n\n❌ **Odrzucone przez ${member.displayName || user.username}**`,
            components: []
        });

        logger.info(`❌ Wiedza odrzucona przez ${user.username}`);
    }
}

module.exports = {
    handleInteraction
};