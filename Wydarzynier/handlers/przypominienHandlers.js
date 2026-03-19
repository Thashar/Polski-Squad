const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ChannelType,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder
} = require('discord.js');

// ==================== HELPER FUNCTIONS ====================

/**
 * Parsuje datę w określonej strefie czasowej
 * @param {string} dateStr - String daty w formacie YYYY-MM-DD HH:MM
 * @param {string} timezone - Strefa czasowa (np. Europe/Warsaw)
 * @returns {Date} Date object w UTC
 */
function parseDateInTimezone(dateStr, timezone) {
    try {
        // Parsuj składowe daty
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
        if (!match) return null;

        const [_, year, month, day, hour, minute] = match;

        // OBLICZ OFFSET STREFY CZASOWEJ
        // Używamy referencyjnej daty (północ UTC tej samej daty) do obliczenia offsetu
        const refUTC = Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0);
        const refDate = new Date(refUTC);

        // Formatuj reference date w docelowej strefie czasowej
        const tzParts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            hour12: false
        }).formatToParts(refDate);

        // Formatuj reference date w UTC
        const utcParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            hour: '2-digit',
            hour12: false
        }).formatToParts(refDate);

        const tzHour = parseInt(tzParts.find(p => p.type === 'hour').value);
        const utcHour = parseInt(utcParts.find(p => p.type === 'hour').value);

        // Oblicz offset (np. Warsaw: 1 - 0 = +1, Bangkok: 7 - 0 = +7)
        let offsetHours = tzHour - utcHour;

        // Handle day boundary crossing
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        // ODEJMIJ offset od wpisanej godziny, żeby dostać UTC
        // Przykład: Warsaw (UTC+1), wpisane 17:00 → 17 - 1 = 16:00 UTC
        // Discord pokaże: 16:00 UTC + 1h = 17:00 w Warsaw ✅
        const finalUTCHour = parseInt(hour) - offsetHours;

        const finalUTC = Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            finalUTCHour,
            parseInt(minute),
            0
        );

        return new Date(finalUTC);
    } catch (error) {
        return null;
    }
}

// ==================== MAIN HANDLER ====================

async function handlePrzypominienInteraction(interaction, sharedState) {
    const { logger } = sharedState;

    try {
        if (interaction.isChatInputCommand()) {
            await handleSlashCommand(interaction, sharedState);
        }
        else if (interaction.isButton()) {
            await handleButton(interaction, sharedState);
        }
        else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction, sharedState);
        }
        else if (interaction.isChannelSelectMenu()) {
            await handleChannelSelectMenu(interaction, sharedState);
        }
        else if (interaction.isRoleSelectMenu()) {
            await handleRoleSelectMenu(interaction, sharedState);
        }
        else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction, sharedState);
        }
    } catch (error) {
        // Unknown interaction - timeout (>3s od kliknięcia)
        if (error.code === 10062) {
            logger.error('⚠️ Unknown interaction - user clicked button but response took too long (>3s)');
            // Nie próbuj odpowiadać - interakcja już wygasła
            return;
        }

        logger.error('Error handling interaction:', error);

        const errorMessage = '❌ Wystąpił błąd podczas przetwarzania akcji.';

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else if (interaction.isRepliable()) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (followUpError) {
            // Interakcja mogła wygasnąć podczas obsługi błędu
            logger.error('Could not send error message to user:', followUpError.message);
        }
    }
}

// ==================== SLASH COMMANDS ====================
// No slash commands - use control panel buttons only

async function handleSlashCommand(interaction, sharedState) {
    await interaction.reply({
        content: '❌ Komendy slash są wyłączone. Użyj przycisków panelu kontrolnego na tablicy przypomnień.',
        ephemeral: true
    });
}

// ==================== /NEW-REMINDER ====================

async function handleNewReminderCommand(interaction, sharedState) {
    const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('new_reminder_type_select')
        .setPlaceholder('Wybierz typ przypomnienia')
        .addOptions([
            {
                label: 'Text',
                description: 'Zwykła wiadomość tekstowa',
                value: 'text',
                emoji: '📝'
            },
            {
                label: 'Embed',
                description: 'Wiadomość z osadzonym contentem',
                value: 'embed',
                emoji: '📋'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(typeSelect);

    await interaction.reply({
        content: '**Step 1:** Wybierz typ przypomnienia',
        components: [row],
        ephemeral: true
    });
}

// ==================== /SET-REMINDER ====================

async function handleSetReminderCommand(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const templates = przypomnieniaMenedzer.getAllTemplates();

    if (templates.length === 0) {
        await interaction.reply({
            content: '❌ Nie znaleziono szablonów przypomnień. Use `/new-reminder` to create a template.',
            ephemeral: true
        });
        return;
    }

    // Paginacja - max 25 opcji w select menu
    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(templates.length / ITEMS_PER_PAGE);
    const page = 0; // Pierwsza strona

    await showTemplateSelectPage(interaction, sharedState, page, totalPages, templates, 'set');
}

async function showTemplateSelectPage(interaction, sharedState, page, totalPages, templates, action) {
    const ITEMS_PER_PAGE = 25;
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, templates.length);
    const pageTemplates = templates.slice(start, end);

    const options = pageTemplates.map(t => ({
        label: t.name.substring(0, 100),
        description: `${t.type === 'text' ? '📝 Text' : '📋 Embed'} - Utworzono ${new Date(t.createdAt).toLocaleDateString('pl-PL')}`,
        value: t.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`template_select_${action}_${page}`)
        .setPlaceholder(`Wybierz szablon (page ${page + 1}/${totalPages})`)
        .addOptions(options);

    const rows = [new ActionRowBuilder().addComponents(selectMenu)];

    // Dodaj przyciski paginacji jeśli więcej niż 1 strona
    if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder();

        if (page > 0) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`template_page_${action}_${page - 1}`)
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        paginationRow.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info')
                .setLabel(`Page ${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        if (page < totalPages - 1) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`template_page_${action}_${page + 1}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        rows.push(paginationRow);
    }

    const content = action === 'set'
        ? `**Wybierz szablon to schedule** (${templates.length} templates)`
        : `**Wybierz szablon to edit** (${templates.length} templates)`;

    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
            content,
            components: rows
        });
    } else {
        await interaction.reply({
            content,
            components: rows,
            ephemeral: true
        });
    }
}

// ==================== /EDIT-REMINDER ====================

async function handleEditReminderCommand(interaction, sharedState) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('edit_reminder_templates')
                .setLabel('Template')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝'),
            new ButtonBuilder()
                .setCustomId('edit_reminder_scheduled')
                .setLabel('Scheduled')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⏰')
        );

    await interaction.reply({
        content: '**Edit reminders** - Choose type:',
        components: [row],
        ephemeral: true
    });
}

// ==================== /SET-TIME-ZONE ====================

async function handleSetTimezoneCommand(interaction, sharedState) {
    const { strefaCzasowaManager } = sharedState;

    const currentTimezone = strefaCzasowaManager.getGlobalTimezone();
    const currentTime = strefaCzasowaManager.getCurrentTime();

    // Create buttons for timezone categories
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('timezone_category_positive')
                .setLabel('UTC+ Timezones')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🌍'),
            new ButtonBuilder()
                .setCustomId('timezone_category_negative')
                .setLabel('UTC- Timezones')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🌎')
        );

    await interaction.reply({
        content: `🕐 **Bot timezone:** ${currentTimezone}\n⏰ **Current time:** ${currentTime}\n\nSelect timezone category:`,
        components: [row],
        ephemeral: true
    });
}

async function handleTimezoneCategorySelect(interaction, sharedState, category) {
    const { strefaCzasowaManager } = sharedState;

    await interaction.deferUpdate();

    const currentTimezone = strefaCzasowaManager.getGlobalTimezone();
    const timezones = category === 'positive'
        ? strefaCzasowaManager.getPositiveTimezones()
        : strefaCzasowaManager.getNegativeTimezones();

    // Create select menu with timezones from selected category
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('set_timezone_select')
        .setPlaceholder(`Select timezone (${category === 'positive' ? 'UTC+' : 'UTC-'})`)
        .addOptions(timezones.map(tz => ({
            label: tz.label,
            value: tz.value,
            default: tz.value === currentTimezone
        })));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Add back button
    const backButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('timezone_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️')
        );

    await interaction.editReply({
        content: `🌐 **${category === 'positive' ? 'UTC+' : 'UTC-'} Timezones**\nSelect timezone:`,
        components: [row, backButton]
    });
}

// ==================== BUTTON HANDLERS ====================

async function handleButton(interaction, sharedState) {
    const { logger, userStates } = sharedState;
    const customId = interaction.customId;

    logger.info(`Button: ${customId} by ${interaction.user.tag}`);

    // Board control panel buttons
    if (customId === 'board_new_reminder') {
        await handleNewReminderCommand(interaction, sharedState);
        return;
    }

    if (customId === 'board_set_reminder') {
        await handleSetReminderCommand(interaction, sharedState);
        return;
    }

    if (customId === 'board_edit_reminder') {
        await handleEditReminderCommand(interaction, sharedState);
        return;
    }

    if (customId === 'board_set_timezone') {
        await handleSetTimezoneCommand(interaction, sharedState);
        return;
    }

    // Event management buttons
    if (customId === 'board_add_event') {
        await handleAddEvent(interaction, sharedState);
        return;
    }

    if (customId === 'board_delete_event') {
        await handleDeleteEvent(interaction, sharedState);
        return;
    }

    if (customId === 'board_edit_event') {
        await handleEditEvent(interaction, sharedState);
        return;
    }

    if (customId === 'board_put_list') {
        await handlePutList(interaction, sharedState);
        return;
    }

    // Timezone category selection
    if (customId === 'timezone_category_positive') {
        await handleTimezoneCategorySelect(interaction, sharedState, 'positive');
        return;
    }

    if (customId === 'timezone_category_negative') {
        await handleTimezoneCategorySelect(interaction, sharedState, 'negative');
        return;
    }

    if (customId === 'timezone_back') {
        await handleSetTimezoneCommand(interaction, sharedState);
        return;
    }

    // Template/Scheduled selection in /edit-reminder
    if (customId === 'edit_reminder_templates') {
        await handleEditTemplatesButton(interaction, sharedState);
        return;
    }

    if (customId === 'edit_reminder_scheduled') {
        await handleEditScheduledButton(interaction, sharedState);
        return;
    }

    // Template pagination
    if (customId.startsWith('template_page_')) {
        await handleTemplatePagination(interaction, sharedState);
        return;
    }

    // Template preview actions (approve/cancel/edit)
    if (customId.startsWith('template_preview_approve_')) {
        await handleTemplatePreviewApprove(interaction, sharedState);
        return;
    }

    if (customId.startsWith('template_preview_cancel_')) {
        await handleTemplatePreviewCancel(interaction, sharedState);
        return;
    }

    if (customId.startsWith('template_preview_edit_')) {
        await handleTemplatePreviewEdit(interaction, sharedState);
        return;
    }

    // Scheduled preview actions (approve/cancel/edit)
    if (customId.startsWith('scheduled_preview_approve_')) {
        await handleScheduledPreviewApprove(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_preview_cancel_')) {
        await handleScheduledPreviewCancel(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_preview_edit_')) {
        await handleScheduledPreviewEdit(interaction, sharedState);
        return;
    }

    // Edit actions (edit/delete)
    if (customId.startsWith('edit_template_edit_')) {
        await handleEditTemplateEdit(interaction, sharedState);
        return;
    }

    if (customId.startsWith('edit_template_delete_')) {
        await handleEditTemplateDelete(interaction, sharedState);
        return;
    }

    if (customId.startsWith('edit_scheduled_edit_')) {
        await handleEditScheduledEdit(interaction, sharedState);
        return;
    }

    if (customId.startsWith('edit_scheduled_delete_')) {
        await handleEditScheduledDelete(interaction, sharedState);
        return;
    }

    // Board buttons for scheduled
    if (customId.startsWith('scheduled_pause_')) {
        await handleBoardScheduledPause(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_resume_')) {
        await handleBoardScheduledResume(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_edit_')) {
        await handleBoardScheduledEdit(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_delete_')) {
        await handleBoardScheduledDelete(interaction, sharedState);
        return;
    }

    // Confirm delete
    if (customId.startsWith('confirm_delete_template_')) {
        await handleConfirmDeleteTemplate(interaction, sharedState);
        return;
    }

    if (customId.startsWith('confirm_delete_scheduled_')) {
        await handleConfirmDeleteScheduled(interaction, sharedState);
        return;
    }

    if (customId.startsWith('confirm_delete_event_')) {
        await handleConfirmDeleteEvent(interaction, sharedState);
        return;
    }

    if (customId === 'cancel_delete_event') {
        await interaction.update({
            content: '❌ Event deletion cancelled.',
            components: []
        });
        return;
    }

    if (customId.startsWith('cancel_delete_')) {
        await handleCancelDelete(interaction, sharedState);
        return;
    }
}

// ==================== SELECT MENU HANDLERS ====================

async function handleSelectMenu(interaction, sharedState) {
    const { logger } = sharedState;
    const customId = interaction.customId;

    logger.info(`Select Menu: ${customId} by ${interaction.user.tag}`);

    // Type selection for /new-reminder
    if (customId === 'new_reminder_type_select') {
        await handleNewReminderTypeSelect(interaction, sharedState);
        return;
    }

    // Template selection for /set-reminder
    if (customId.startsWith('template_select_set_')) {
        await handleTemplateSelectForSet(interaction, sharedState);
        return;
    }

    // Template selection for /edit-reminder Templates
    if (customId.startsWith('template_select_edit_')) {
        await handleTemplateSelectForEdit(interaction, sharedState);
        return;
    }

    // Scheduled selection for /edit-reminder Scheduled
    if (customId.startsWith('scheduled_select_edit_')) {
        await handleScheduledSelectForEdit(interaction, sharedState);
        return;
    }

    // Timezone selection for /set-time-zone
    if (customId === 'set_timezone_select') {
        await handleTimezoneSelect(interaction, sharedState);
        return;
    }

    // Event delete selection
    if (customId === 'delete_event_select') {
        await handleDeleteEventSelect(interaction, sharedState);
        return;
    }

    // Event edit selection
    if (customId === 'edit_event_select') {
        await handleEditEventSelect(interaction, sharedState);
        return;
    }
}

async function handleNewReminderTypeSelect(interaction, sharedState) {
    const type = interaction.values[0];

    if (type === 'text') {
        const modal = new ModalBuilder()
            .setCustomId('new_reminder_modal_text')
            .setTitle('New template - Text');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. Boss Reminder')
            .setRequired(false)
            .setMaxLength(100);

        const textInput = new TextInputBuilder()
            .setCustomId('text')
            .setLabel('Treść wiadomości')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Reminder content...')
            .setRequired(false)
            .setMaxLength(2000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(textInput)
        );

        await interaction.showModal(modal);
    } else if (type === 'embed') {
        const modal = new ModalBuilder()
            .setCustomId('new_reminder_modal_embed')
            .setTitle('New template - Embed');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. Boss Event')
            .setRequired(false)
            .setMaxLength(100);

        const titleInput = new TextInputBuilder()
            .setCustomId('embedTitle')
            .setLabel('Tytuł embed')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Tytuł embed (optional)')
            .setRequired(false)
            .setMaxLength(256);

        const descInput = new TextInputBuilder()
            .setCustomId('embedDescription')
            .setLabel('Opis embed')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Description...')
            .setRequired(false)
            .setMaxLength(4000);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel('Embed icon (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://... (optional)')
            .setRequired(false);

        const colorInput = new TextInputBuilder()
            .setCustomId('embedColor')
            .setLabel('Embed color (hex)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#5865F2 or 5865F2 (default: #5865F2)')
            .setValue('5865F2')
            .setRequired(false)
            .setMaxLength(7);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(colorInput)
        );

        await interaction.showModal(modal);
    }
}

async function handleTemplateSelectForSet(interaction, sharedState) {
    const { przypomnieniaMenedzer, strefaCzasowaManager, userStates } = sharedState;

    const templateId = interaction.values[0];
    const template = przypomnieniaMenedzer.getTemplate(templateId);

    if (!template) {
        await interaction.update({
            content: '❌ Szablon nie znaleziony.',
            components: []
        });
        return;
    }

    // Pokaż modal do ustawienia harmonogramu
    // Use bot's global timezone (defaults to UTC if not set)
    const currentTime = strefaCzasowaManager.getCurrentTime();

    const modal = new ModalBuilder()
        .setCustomId(`set_reminder_modal_${templateId}`)
        .setTitle('Set schedule');

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('First trigger (YYYY-MM-DD HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(currentTime)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Puste = jednorazowe, lub: 1s, 1m, 1h, 1d (max 90d), ee')
        .setRequired(false)
        .setMaxLength(10);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Typ: 0 = dopasowane | 1 = ustandaryzowane')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0 lub 1')
        .setValue('0')
        .setRequired(true)
        .setMaxLength(1);

    modal.addComponents(
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput),
        new ActionRowBuilder().addComponents(typeInput)
    );

    await interaction.showModal(modal);
}

async function handleTemplateSelectForEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const templateId = interaction.values[0];
    const template = przypomnieniaMenedzer.getTemplate(templateId);

    if (!template) {
        await interaction.update({
            content: '❌ Szablon nie znaleziony.',
            components: []
        });
        return;
    }

    await showTemplateEditPreview(interaction, template);
}

async function handleScheduledSelectForEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduledId = interaction.values[0];
    const scheduled = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);

    if (!scheduled) {
        await interaction.update({
            content: '❌ Scheduled reminder not found.',
            components: []
        });
        return;
    }

    await showScheduledEditPreview(interaction, scheduled, sharedState);
}

async function handleTimezoneSelect(interaction, sharedState) {
    const { strefaCzasowaManager, tablicaMenedzer } = sharedState;

    const selectedTimezone = interaction.values[0];
    await strefaCzasowaManager.setGlobalTimezone(selectedTimezone);

    const currentTime = strefaCzasowaManager.getCurrentTime();

    // Update control panel to show new timezone
    await tablicaMenedzer.ensureControlPanel();

    await interaction.update({
        content: `✅ **Bot timezone updated!**\n🕐 **New timezone:** ${selectedTimezone}\n⏰ **Current time:** ${currentTime}\n\n*All users will see times in this timezone.*`,
        components: []
    });
}

// ==================== CHANNEL SELECT MENU ====================

async function handleChannelSelectMenu(interaction, sharedState) {
    const { logger, userStates } = sharedState;
    const customId = interaction.customId;

    logger.info(`Channel Select: ${customId} by ${interaction.user.tag}`);

    if (customId.startsWith('set_reminder_channel_')) {
        const sessionId = customId.replace('set_reminder_channel_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.update({
                content: '❌ Session expired. Start over.',
                components: []
            });
            return;
        }

        const selectedChannel = interaction.channels.first();
        userState.channelId = selectedChannel.id;
        userState.step = 'select_roles';
        userStates.set(interaction.user.id, userState);

        // Pokaż role select
        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`set_reminder_roles_${sessionId}`)
            .setPlaceholder('Select roles to ping (optional)')
            .setMinValues(0)
            .setMaxValues(10);

        const skipButton = new ButtonBuilder()
            .setCustomId(`set_reminder_skip_roles_${sessionId}`)
            .setLabel('Skip - no pings')
            .setStyle(ButtonStyle.Secondary);

        const row1 = new ActionRowBuilder().addComponents(roleSelect);
        const row2 = new ActionRowBuilder().addComponents(skipButton);

        await interaction.update({
            content: `**Step 3/3:** Select roles to ping (optional)\n📍 **Channel:** <#${selectedChannel.id}>`,
            components: [row1, row2]
        });
    }

    if (customId === 'event_list_channel_select') {
        const { listaEventowMenedzer, tablicaMenedzer, logger } = sharedState;

        const selectedChannel = interaction.channels.first();

        try {
            const result = await listaEventowMenedzer.setListChannel(selectedChannel.id);

            // Odpowiedz NAJPIERW aby uniknąć timeout (<3s)
            // Różne komunikaty w zależności czy to ten sam kanał
            if (result.sameChannel) {
                await interaction.update({
                    content: `ℹ️ **Lista eventów już jest na tym kanale!**\n📍 **Kanał:** <#${selectedChannel.id}>`,
                    components: []
                });
            } else {
                await interaction.update({
                    content: `✅ **Kanał listy eventów ustawiony!**\n📍 **Kanał:** <#${selectedChannel.id}>\n\nLista eventów będzie wyświetlana tam.`,
                    components: []
                });
            }

            logger.success(`Kanał listy eventów ustawiony na: ${selectedChannel.name}`);

            // Zaktualizuj panel kontrolny PO odpowiedzi (może zająć >3s podczas wyszukiwania)
            await tablicaMenedzer.updateControlPanel();
        } catch (error) {
            logger.error('Nie udało się ustawić kanału listy eventów:', error);
            await interaction.update({
                content: '❌ Nie udało się ustawić kanału listy eventów.',
                components: []
            });
        }
    }
}

// ==================== ROLE SELECT MENU ====================

async function handleRoleSelectMenu(interaction, sharedState) {
    const { logger, userStates } = sharedState;
    const customId = interaction.customId;

    logger.info(`Role Select: ${customId} by ${interaction.user.tag}`);

    if (customId.startsWith('set_reminder_skip_roles_')) {
        await interaction.deferUpdate();

        const sessionId = customId.replace('set_reminder_skip_roles_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.editReply({
                content: '❌ Session expired. Start over.',
                components: []
            });
            return;
        }

        userState.roles = []; // No roles selected

        await createScheduledFromUserState(interaction, sharedState, userState);
    }

    if (customId.startsWith('set_reminder_roles_')) {
        await interaction.deferUpdate();

        const sessionId = customId.replace('set_reminder_roles_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.editReply({
                content: '❌ Session expired. Start over.',
                components: []
            });
            return;
        }

        const selectedRoles = interaction.roles.map(r => r.id);
        userState.roles = selectedRoles;

        await createScheduledFromUserState(interaction, sharedState, userState);
    }
}

// ==================== MODAL SUBMIT HANDLERS ====================

async function handleModalSubmit(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger, userStates } = sharedState;
    const customId = interaction.customId;

    logger.info(`Modal Submit: ${customId} by ${interaction.user.tag}`);

    await interaction.deferReply({ ephemeral: true });

    try {
        // New reminder - Text
        if (customId === 'new_reminder_modal_text') {
            const name = interaction.fields.getTextInputValue('name');
            const text = interaction.fields.getTextInputValue('text');

            const sessionId = Date.now().toString();
            userStates.set(interaction.user.id, {
                sessionId,
                type: 'text',
                name,
                text
            });

            await showTemplatePreview(interaction, { type: 'text', name, text }, sessionId);
        }
        // New reminder - Embed
        else if (customId === 'new_reminder_modal_embed') {
            const name = interaction.fields.getTextInputValue('name');
            const embedTitle = interaction.fields.getTextInputValue('embedTitle');
            const embedDescription = interaction.fields.getTextInputValue('embedDescription');
            const embedIcon = interaction.fields.getTextInputValue('embedIcon') || null;
            let embedColor = interaction.fields.getTextInputValue('embedColor') || '5865F2';

            // Parse hex color - remove # if present
            embedColor = embedColor.replace('#', '').toUpperCase();

            // Validate hex color (6 characters, 0-9 A-F)
            if (!/^[0-9A-F]{6}$/.test(embedColor)) {
                await interaction.reply({
                    content: '❌ Invalid hex color format. Use 6 characters (e.g., 5865F2 or #5865F2)',
                    ephemeral: true
                });
                return;
            }

            const sessionId = Date.now().toString();
            userStates.set(interaction.user.id, {
                sessionId,
                type: 'embed',
                name,
                embedTitle,
                embedDescription,
                embedIcon,
                embedColor
            });

            await showTemplatePreview(interaction, {
                type: 'embed',
                name,
                embedTitle,
                embedDescription,
                embedIcon,
                embedColor
            }, sessionId);
        }
        // Set reminder schedule
        else if (customId.startsWith('set_reminder_modal_')) {
            const templateId = customId.replace('set_reminder_modal_', '');
            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');
            const type = interaction.fields.getTextInputValue('type');

            // Walidacja typu
            if (type !== '0' && type !== '1') {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy typ. Użyj: 0 (dopasowane) lub 1 (ustandaryzowane)'
                });
                return;
            }

            // Parse firstTrigger
            const firstTrigger = new Date(firstTriggerStr);
            if (isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Invalid date format. Use: YYYY-MM-DD HH:MM (e.g. 2026-03-20 10:00)'
                });
                return;
            }

            if (firstTrigger < new Date()) {
                await interaction.editReply({
                    content: '❌ First trigger date cannot be in the past.'
                });
                return;
            }

            // Validate interval (opcjonalne - puste = jednorazowe)
            if (!przypomnieniaMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), "ee", lub zostaw puste dla jednorazowego przypomnienia.'
                });
                return;
            }

            // Jeśli podano interwał, sprawdź limit
            if (interval && interval.trim() !== '') {
                const intervalMs = przypomnieniaMenedzer.parseInterval(interval);
                const maxInterval = 90 * 24 * 60 * 60 * 1000;
                if (intervalMs && intervalMs > maxInterval) {
                    await interaction.editReply({
                        content: '❌ Interwał nie może przekraczać 90 dni.'
                    });
                    return;
                }
            }

            const sessionId = Date.now().toString();

            // TYP 1 = USTANDARYZOWANE (kanał z Listą Eventów, tylko pingi)
            if (type === '1') {
                const { eventMenedzer } = sharedState;
                const eventListChannelId = eventMenedzer.getListChannelId();

                if (!eventListChannelId) {
                    await interaction.editReply({
                        content: '❌ Kanał z Listą Eventów nie został ustawiony. Użyj typu 0 (dopasowane) lub ustaw kanał listy eventów.'
                    });
                    return;
                }

                // Store in user state with channel already set
                userStates.set(interaction.user.id, {
                    sessionId,
                    templateId,
                    firstTrigger: firstTrigger.toISOString(),
                    interval,
                    channelId: eventListChannelId,
                    notificationType: 1,
                    step: 'select_roles'
                });

                // Pokaż role select od razu (bez wyboru kanału)
                const roleSelect = new RoleSelectMenuBuilder()
                    .setCustomId(`set_reminder_roles_${sessionId}`)
                    .setPlaceholder('Select roles to ping (optional)')
                    .setMinValues(0)
                    .setMaxValues(10);

                const skipButton = new ButtonBuilder()
                    .setCustomId(`set_reminder_skip_roles_${sessionId}`)
                    .setLabel('Skip - no pings')
                    .setStyle(ButtonStyle.Secondary);

                const row1 = new ActionRowBuilder().addComponents(roleSelect);
                const row2 = new ActionRowBuilder().addComponents(skipButton);

                await interaction.editReply({
                    content: `**Step 2/2:** Select roles to ping (optional)\n📍 **Kanał:** <#${eventListChannelId}> (Lista Eventów)`,
                    components: [row1, row2]
                });
            }
            // TYP 0 = DOPASOWANE (wybór kanału + pingi)
            else {
                // Store in user state for channel/role selection
                userStates.set(interaction.user.id, {
                    sessionId,
                    templateId,
                    firstTrigger: firstTrigger.toISOString(),
                    interval,
                    notificationType: 0,
                    step: 'select_channel'
                });

                // Show channel select
                const channelSelect = new ChannelSelectMenuBuilder()
                    .setCustomId(`set_reminder_channel_${sessionId}`)
                    .setPlaceholder('Select channel for reminders')
                    .setChannelTypes([ChannelType.GuildText]);

                const row = new ActionRowBuilder().addComponents(channelSelect);

                await interaction.editReply({
                    content: '**Step 2/3:** Select the channel where notifications will be sent',
                    components: [row]
                });
            }
        }
        // Edit template
        else if (customId.startsWith('edit_template_modal_')) {
            const templateId = customId.replace('edit_template_modal_', '');
            const template = przypomnieniaMenedzer.getTemplate(templateId);

            if (!template) {
                await interaction.editReply({ content: '❌ Szablon nie znaleziony.' });
                return;
            }

            if (template.type === 'text') {
                const name = interaction.fields.getTextInputValue('name');
                const text = interaction.fields.getTextInputValue('text');

                await przypomnieniaMenedzer.updateTemplate(templateId, { name, text });
                await interaction.editReply({
                    content: `✅ Template **${name}** has been updated!`,
                    components: []
                });

                // Update control panel to show updated template
                await tablicaMenedzer.ensureControlPanel();
            } else {
                const name = interaction.fields.getTextInputValue('name');
                const embedTitle = interaction.fields.getTextInputValue('embedTitle');
                const embedDescription = interaction.fields.getTextInputValue('embedDescription');
                const embedIcon = interaction.fields.getTextInputValue('embedIcon') || null;
                let embedColor = interaction.fields.getTextInputValue('embedColor') || '5865F2';

                // Parse hex color - remove # if present
                embedColor = embedColor.replace('#', '').toUpperCase();

                // Validate hex color (6 characters, 0-9 A-F)
                if (!/^[0-9A-F]{6}$/.test(embedColor)) {
                    await interaction.editReply({
                        content: '❌ Invalid hex color format. Use 6 characters (e.g., 5865F2 or #5865F2)',
                        components: []
                    });
                    return;
                }

                await przypomnieniaMenedzer.updateTemplate(templateId, {
                    name,
                    embedTitle,
                    embedDescription,
                    embedIcon,
                    embedColor
                });
                await interaction.editReply({
                    content: `✅ Template **${name}** has been updated!`,
                    components: []
                });

                // Update control panel to show updated template
                await tablicaMenedzer.ensureControlPanel();
            }

            logger.success(`Updated template ${templateId}`);
        }
        // Edit scheduled
        else if (customId.startsWith('edit_scheduled_modal_')) {
            const scheduledId = customId.replace('edit_scheduled_modal_', '');
            const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);

            if (!scheduled) {
                await interaction.editReply({ content: '❌ Scheduled reminder not found.' });
                return;
            }

            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');

            // Parse firstTrigger
            const firstTrigger = new Date(firstTriggerStr);
            if (isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Invalid date format. Use: YYYY-MM-DD HH:MM'
                });
                return;
            }

            // Validate interval (opcjonalne - puste = jednorazowe)
            if (!przypomnieniaMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), "ee", lub zostaw puste dla jednorazowego przypomnienia.'
                });
                return;
            }

            // Jeśli podano interwał, sprawdź limit
            if (interval && interval.trim() !== '') {
                const intervalMs = przypomnieniaMenedzer.parseInterval(interval);
                const maxInterval = 90 * 24 * 60 * 60 * 1000;
                if (intervalMs && intervalMs > maxInterval) {
                    await interaction.editReply({
                        content: '❌ Interwał nie może przekraczać 90 dni.'
                    });
                    return;
                }
            }

            await przypomnieniaMenedzer.updateScheduled(scheduledId, {
                firstTrigger: firstTrigger.toISOString(),
                interval,
                intervalMs,
                nextTrigger: firstTrigger.toISOString()
            });

            // Update board
            const { tablicaMenedzer } = sharedState;
            const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
            await tablicaMenedzer.updateEmbed(updated);

            await interaction.editReply({
                content: `✅ Scheduled reminder **${scheduledId}** has been updated!`,
                components: []
            });

            logger.success(`Updated scheduled ${scheduledId}`);
        }
        // Add event
        else if (customId === 'add_event_modal') {
            const { eventMenedzer, listaEventowMenedzer, strefaCzasowaManager } = sharedState;

            const name = interaction.fields.getTextInputValue('name');
            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');

            // Parse firstTrigger w strefie czasowej bota
            const timezone = strefaCzasowaManager.getGlobalTimezone();
            logger.info(`[EVENT PARSE] Input: "${firstTriggerStr}", Timezone: ${timezone}`);
            const firstTrigger = parseDateInTimezone(firstTriggerStr, timezone);
            logger.info(`[EVENT PARSE] Result: ${firstTrigger ? firstTrigger.toISOString() : 'NULL'}`);
            logger.info(`[EVENT PARSE] Unix timestamp: ${firstTrigger ? Math.floor(firstTrigger.getTime() / 1000) : 'NULL'}`);

            if (!firstTrigger || isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Invalid date format. Use: YYYY-MM-DD HH:MM (e.g. 2026-03-20 10:00)'
                });
                return;
            }

            if (firstTrigger < new Date()) {
                await interaction.editReply({
                    content: '❌ First trigger date cannot be in the past.'
                });
                return;
            }

            // Validate interval
            if (!eventMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Invalid interval format. Use: 1s, 1m, 1h, 1d (max 90d) or "ee"'
                });
                return;
            }

            try {
                const event = await eventMenedzer.createEvent(
                    interaction.user.id,
                    name,
                    firstTrigger,
                    interval
                );

                // Update events list
                await listaEventowMenedzer.ensureEventsList();

                await interaction.editReply({
                    content: `✅ **Event created!**\n📅 **Name:** ${name}\n🆔 **ID:** ${event.id}\n⏰ **Next trigger:** <t:${Math.floor(new Date(event.nextTrigger).getTime() / 1000)}:F>`
                });

                logger.success(`Created event ${event.id}`);
            } catch (error) {
                logger.error('Failed to create event:', error);
                await interaction.editReply({
                    content: `❌ Error: ${error.message}`
                });
            }
        }
        // Edit event
        else if (customId.startsWith('edit_event_modal_')) {
            const { eventMenedzer, listaEventowMenedzer } = sharedState;

            const eventId = customId.replace('edit_event_modal_', '');
            const event = eventMenedzer.getEvent(eventId);

            if (!event) {
                await interaction.editReply({ content: '❌ Event not found.' });
                return;
            }

            const name = interaction.fields.getTextInputValue('name');
            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');

            // Parse firstTrigger
            const firstTrigger = new Date(firstTriggerStr);
            if (isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Invalid date format. Use: YYYY-MM-DD HH:MM'
                });
                return;
            }

            // Validate interval
            if (!eventMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Invalid interval format. Use: 1s, 1m, 1h, 1d (max 90d) or "ee"'
                });
                return;
            }

            const intervalMs = eventMenedzer.parseInterval(interval);

            await eventMenedzer.updateEvent(eventId, {
                name,
                firstTrigger: firstTrigger.toISOString(),
                interval,
                intervalMs,
                nextTrigger: firstTrigger.toISOString()
            });

            // Update events list
            await listaEventowMenedzer.ensureEventsList();

            await interaction.editReply({
                content: `✅ Event **${name}** has been updated!`,
                components: []
            });

            logger.success(`Updated event ${eventId}`);
        }

    } catch (error) {
        logger.error('Error handling modal submit:', error);
        await interaction.editReply({ content: '❌ An error occurred during processing.' });
    }
}

// ==================== HELPER FUNCTIONS ====================

async function showTemplatePreview(interaction, data, sessionId) {
    let previewContent = '**Template Preview:**\n\n';
    previewContent += `📝 **Name:** ${data.name}\n`;
    previewContent += `📋 **Type:** ${data.type === 'text' ? 'Text' : 'Embed'}\n\n`;
    previewContent += '**How the reminder will look:**';

    const embeds = [];
    if (data.type === 'text') {
        previewContent += `\n\n${data.text}`;
    } else {
        const colorHex = parseInt(data.embedColor || '5865F2', 16);
        const embed = new EmbedBuilder()
            .setDescription(data.embedDescription)
            .setColor(colorHex);

        if (data.embedTitle) embed.setTitle(data.embedTitle);
        if (data.embedIcon) embed.setThumbnail(data.embedIcon);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`template_preview_approve_${sessionId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✔️'),
            new ButtonBuilder()
                .setCustomId(`template_preview_cancel_${sessionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('✖️'),
            new ButtonBuilder()
                .setCustomId(`template_preview_edit_${sessionId}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝')
        );

    await interaction.editReply({
        content: previewContent,
        embeds,
        components: [row]
    });
}

async function showTemplateEditPreview(interaction, template) {
    let content = '**Edit Template:**\n\n';
    content += `📝 **Name:** ${template.name}\n`;
    content += `📋 **Type:** ${template.type === 'text' ? 'Text' : 'Embed'}\n`;
    content += `🆔 **ID:** ${template.id}\n\n`;
    content += '**Preview:**';

    const embeds = [];
    if (template.type === 'text') {
        content += `\n\n${template.text}`;
    } else {
        const colorHex = parseInt(template.embedColor || '5865F2', 16);
        const embed = new EmbedBuilder()
            .setDescription(template.embedDescription)
            .setColor(colorHex);

        if (template.embedTitle) embed.setTitle(template.embedTitle);
        if (template.embedIcon) embed.setThumbnail(template.embedIcon);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_template_edit_${template.id}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`edit_template_delete_${template.id}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

    await interaction.update({
        content,
        embeds,
        components: [row]
    });
}

async function showScheduledEditPreview(interaction, scheduled, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const template = scheduled.template;
    const nextTriggerDate = new Date(scheduled.nextTrigger);
    const nextTriggerTimestamp = Math.floor(nextTriggerDate.getTime() / 1000);

    let content = '**Scheduled Reminder:**\n\n';
    content += `⏰ **ID:** ${scheduled.id}\n`;
    content += `📝 **Template:** ${template.name}\n`;
    content += `📅 **First trigger:** ${new Date(scheduled.firstTrigger).toLocaleString('en-US')}\n`;
    content += `🔄 **Interval:** ${przypomnieniaMenedzer.formatInterval(scheduled.interval)}\n`;
    content += `⏭️ **Next trigger:** <t:${nextTriggerTimestamp}:F> (<t:${nextTriggerTimestamp}:R>)\n`;
    content += `📍 **Channel:** <#${scheduled.channelId}>\n`;
    content += `👥 **Roles:** ${scheduled.roles.length > 0 ? scheduled.roles.map(r => `<@&${r}>`).join(', ') : 'None'}\n`;
    content += `📊 **Status:** ${scheduled.status === 'active' ? '🟢 Active' : '⏸️ Paused'}\n\n`;
    content += '**Message preview:**';

    const embeds = [];
    if (template.type === 'text') {
        content += `\n\n${template.text}`;
    } else {
        const colorHex = parseInt(template.embedColor || '5865F2', 16);
        const embed = new EmbedBuilder()
            .setDescription(template.embedDescription)
            .setColor(colorHex);

        if (template.embedTitle) embed.setTitle(template.embedTitle);
        if (template.embedIcon) embed.setThumbnail(template.embedIcon);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_edit_${scheduled.id}`)
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_delete_${scheduled.id}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

    await interaction.update({
        content,
        embeds,
        components: [row]
    });
}

async function createScheduledFromUserState(interaction, sharedState, userState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger, userStates } = sharedState;

    try {
        const scheduled = await przypomnieniaMenedzer.createScheduled(
            interaction.user.id,
            userState.templateId,
            userState.firstTrigger,
            userState.interval,
            userState.channelId,
            userState.roles || [],
            userState.notificationType || 0
        );

        // Get scheduled with template for board embed
        const scheduledWithTemplate = przypomnieniaMenedzer.getScheduledWithTemplate(scheduled.id);
        logger.info(`Creating board embed for ${scheduled.id} - has template: ${!!scheduledWithTemplate?.template}`);
        const embedResult = await tablicaMenedzer.createEmbed(scheduledWithTemplate);
        logger.info(`Board embed creation result: ${embedResult ? 'success' : 'failed'}`);

        userStates.delete(interaction.user.id);

        const template = przypomnieniaMenedzer.getTemplate(userState.templateId);
        const nextTriggerDate = new Date(scheduled.nextTrigger);
        const nextTriggerTimestamp = Math.floor(nextTriggerDate.getTime() / 1000);

        let content = '✅ **Scheduled reminder created!**\n\n';
        content += `⏰ **ID:** ${scheduled.id}\n`;
        content += `📝 **Template:** ${template.name}\n`;
        content += `📅 **First trigger:** <t:${nextTriggerTimestamp}:F>\n`;
        content += `🔄 **Interval:** ${przypomnieniaMenedzer.formatInterval(scheduled.interval)}\n`;
        content += `📍 **Channel:** <#${userState.channelId}>\n`;
        content += `👥 **Roles:** ${userState.roles && userState.roles.length > 0 ? userState.roles.map(r => `<@&${r}>`).join(', ') : 'None'}`;

        await interaction.editReply({
            content,
            components: []
        });

        logger.success(`Created scheduled reminder ${scheduled.id}`);
    } catch (error) {
        logger.error('Error creating scheduled reminder:', error);
        await interaction.editReply({
            content: `❌ Error: ${error.message}`,
            components: []
        });
    }
}

// ==================== BUTTON ACTION HANDLERS ====================

async function handleTemplatePreviewApprove(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, userStates, logger } = sharedState;

    await interaction.deferUpdate();

    const sessionId = interaction.customId.replace('template_preview_approve_', '');
    const userState = userStates.get(interaction.user.id);

    if (!userState || userState.sessionId !== sessionId) {
        await interaction.editReply({
            content: '❌ Session expired.',
            embeds: [],
            components: []
        });
        return;
    }

    try {
        let template;
        if (userState.type === 'text') {
            template = await przypomnieniaMenedzer.createTemplate(
                interaction.user.id,
                userState.name,
                'text',
                { text: userState.text }
            );
        } else {
            template = await przypomnieniaMenedzer.createTemplate(
                interaction.user.id,
                userState.name,
                'embed',
                {
                    embedTitle: userState.embedTitle,
                    embedDescription: userState.embedDescription,
                    embedIcon: userState.embedIcon,
                    embedColor: userState.embedColor
                }
            );
        }

        userStates.delete(interaction.user.id);

        await interaction.editReply({
            content: `✅ Template **${template.name}** has been created!\n🆔 ID: ${template.id}\n\nUse \`/set-reminder\` to schedule reminders.`,
            embeds: [],
            components: []
        });

        // Update control panel to show new template
        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Created template ${template.id}`);
    } catch (error) {
        logger.error('Error creating template:', error);
        await interaction.editReply({
            content: '❌ Error creating template.',
            embeds: [],
            components: []
        });
    }
}

async function handleTemplatePreviewCancel(interaction, sharedState) {
    const { userStates } = sharedState;

    const sessionId = interaction.customId.replace('template_preview_cancel_', '');
    userStates.delete(interaction.user.id);

    await interaction.update({
        content: '❌ Template creation cancelled.',
        embeds: [],
        components: []
    });
}

async function handleTemplatePreviewEdit(interaction, sharedState) {
    const { userStates } = sharedState;

    const sessionId = interaction.customId.replace('template_preview_edit_', '');
    const userState = userStates.get(interaction.user.id);

    if (!userState || userState.sessionId !== sessionId) {
        await interaction.update({
            content: '❌ Session expired.',
            embeds: [],
            components: []
        });
        return;
    }

    if (userState.type === 'text') {
        const modal = new ModalBuilder()
            .setCustomId('new_reminder_modal_text')
            .setTitle('Edit template - Text');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.name)
            .setRequired(false)
            .setMaxLength(100);

        const textInput = new TextInputBuilder()
            .setCustomId('text')
            .setLabel('Treść wiadomości')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(userState.text)
            .setRequired(false)
            .setMaxLength(2000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(textInput)
        );

        await interaction.showModal(modal);
    } else {
        const modal = new ModalBuilder()
            .setCustomId('new_reminder_modal_embed')
            .setTitle('Edit template - Embed');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.name)
            .setRequired(false)
            .setMaxLength(100);

        const titleInput = new TextInputBuilder()
            .setCustomId('embedTitle')
            .setLabel('Tytuł embed')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.embedTitle || '')
            .setRequired(false)
            .setMaxLength(256);

        const descInput = new TextInputBuilder()
            .setCustomId('embedDescription')
            .setLabel('Opis embed')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(userState.embedDescription)
            .setRequired(false)
            .setMaxLength(4000);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel('Embed icon (URL)')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.embedIcon || '')
            .setRequired(false);

        const colorInput = new TextInputBuilder()
            .setCustomId('embedColor')
            .setLabel('Embed color (hex)')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.embedColor || '5865F2')
            .setPlaceholder('#5865F2 or 5865F2')
            .setRequired(false)
            .setMaxLength(7);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(colorInput)
        );

        await interaction.showModal(modal);
    }
}

async function handleScheduledPreviewApprove(interaction, sharedState) {
    // Placeholder - not used in current flow
    await interaction.update({
        content: '✅ Zatwierdzone',
        components: []
    });
}

async function handleScheduledPreviewCancel(interaction, sharedState) {
    // Placeholder - not used in current flow
    await interaction.update({
        content: '❌ Cancelled',
        components: []
    });
}

async function handleScheduledPreviewEdit(interaction, sharedState) {
    // Placeholder - not used in current flow
    await interaction.reply({
        content: '✏️ Edycja...',
        ephemeral: true
    });
}

async function handleEditTemplatesButton(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const templates = przypomnieniaMenedzer.getAllTemplates();

    if (templates.length === 0) {
        await interaction.update({
            content: '❌ No templates found. Use `/new-reminder` to create a template.',
            components: []
        });
        return;
    }

    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(templates.length / ITEMS_PER_PAGE);

    await showTemplateSelectPage(interaction, sharedState, 0, totalPages, templates, 'edit');
}

async function handleEditScheduledButton(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduled = przypomnieniaMenedzer.getAllScheduled();

    if (scheduled.length === 0) {
        await interaction.update({
            content: '❌ No scheduled reminders found. Use `/set-reminder` to create one.',
            components: []
        });
        return;
    }

    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(scheduled.length / ITEMS_PER_PAGE);
    const page = 0;
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, scheduled.length);
    const pageScheduled = scheduled.slice(start, end);

    const options = pageScheduled.map(s => {
        const template = przypomnieniaMenedzer.getTemplate(s.templateId);
        const templateName = template ? template.name : 'Unknown';
        return {
            label: `⏰ ${templateName}`.substring(0, 100),
            description: `ID: ${s.id} - Następny: ${new Date(s.nextTrigger).toLocaleString('pl-PL')}`.substring(0, 100),
            value: s.id
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`scheduled_select_edit_${page}`)
        .setPlaceholder(`Select zaplanowane przypomnienie (${scheduled.length} total)`)
        .addOptions(options);

    const rows = [new ActionRowBuilder().addComponents(selectMenu)];

    // Pagination
    if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder();

        if (page > 0) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scheduled_page_edit_${page - 1}`)
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        paginationRow.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info')
                .setLabel(`Page ${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        if (page < totalPages - 1) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scheduled_page_edit_${page + 1}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        rows.push(paginationRow);
    }

    await interaction.update({
        content: `**Select zaplanowane przypomnienie** (${scheduled.length} total)`,
        components: rows
    });
}

async function handleTemplatePagination(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const parts = interaction.customId.split('_');
    const action = parts[2]; // 'set' or 'edit'
    const page = parseInt(parts[3]);

    const templates = przypomnieniaMenedzer.getAllTemplates();
    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(templates.length / ITEMS_PER_PAGE);

    await showTemplateSelectPage(interaction, sharedState, page, totalPages, templates, action);
}

async function handleEditTemplateEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const templateId = interaction.customId.replace('edit_template_edit_', '');
    const template = przypomnieniaMenedzer.getTemplate(templateId);

    if (!template) {
        await interaction.update({
            content: '❌ Szablon nie znaleziony.',
            components: []
        });
        return;
    }

    if (template.type === 'text') {
        const modal = new ModalBuilder()
            .setCustomId(`edit_template_modal_${templateId}`)
            .setTitle('Edit template - Text');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setValue(template.name)
            .setRequired(false)
            .setMaxLength(100);

        const textInput = new TextInputBuilder()
            .setCustomId('text')
            .setLabel('Treść wiadomości')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(template.text)
            .setRequired(false)
            .setMaxLength(2000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(textInput)
        );

        await interaction.showModal(modal);
    } else {
        const modal = new ModalBuilder()
            .setCustomId(`edit_template_modal_${templateId}`)
            .setTitle('Edit template - Embed');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setValue(template.name)
            .setRequired(false)
            .setMaxLength(100);

        const titleInput = new TextInputBuilder()
            .setCustomId('embedTitle')
            .setLabel('Tytuł embed')
            .setStyle(TextInputStyle.Short)
            .setValue(template.embedTitle || '')
            .setRequired(false)
            .setMaxLength(256);

        const descInput = new TextInputBuilder()
            .setCustomId('embedDescription')
            .setLabel('Opis embed')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(template.embedDescription)
            .setRequired(false)
            .setMaxLength(4000);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel('Embed icon (URL)')
            .setStyle(TextInputStyle.Short)
            .setValue(template.embedIcon || '')
            .setRequired(false);

        const colorInput = new TextInputBuilder()
            .setCustomId('embedColor')
            .setLabel('Embed color (hex)')
            .setStyle(TextInputStyle.Short)
            .setValue(template.embedColor || '5865F2')
            .setPlaceholder('#5865F2 or 5865F2')
            .setRequired(false)
            .setMaxLength(7);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(colorInput)
        );

        await interaction.showModal(modal);
    }
}

async function handleEditTemplateDelete(interaction, sharedState) {
    const templateId = interaction.customId.replace('edit_template_delete_', '');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_template_${templateId}`)
                .setLabel('Yes, delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${templateId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({
        content: '⚠️ **Are you sure you want to delete this template?**\n\nWarning: All scheduled reminders using this template will also be deleted!',
        embeds: [],
        components: [row]
    });
}

async function handleEditScheduledEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduledId = interaction.customId.replace('edit_scheduled_edit_', '');
    const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);

    if (!scheduled) {
        await interaction.update({
            content: '❌ Scheduled reminder not found.',
            components: []
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_scheduled_modal_${scheduledId}`)
        .setTitle('Edit scheduled reminder');

    const firstTriggerDate = new Date(scheduled.firstTrigger);
    const formattedDate = `${firstTriggerDate.getFullYear()}-${String(firstTriggerDate.getMonth() + 1).padStart(2, '0')}-${String(firstTriggerDate.getDate()).padStart(2, '0')} ${String(firstTriggerDate.getHours()).padStart(2, '0')}:${String(firstTriggerDate.getMinutes()).padStart(2, '0')}`;

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('First trigger (YYYY-MM-DD HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(formattedDate)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setValue(scheduled.interval)
        .setRequired(false)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput)
    );

    await interaction.showModal(modal);
}

async function handleEditScheduledDelete(interaction, sharedState) {
    const scheduledId = interaction.customId.replace('edit_scheduled_delete_', '');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_scheduled_${scheduledId}`)
                .setLabel('Yes, delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${scheduledId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({
        content: '⚠️ **Are you sure you want to delete this scheduled reminder?**',
        embeds: [],
        components: [row]
    });
}

async function handleConfirmDeleteTemplate(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const templateId = interaction.customId.replace('confirm_delete_template_', '');

    try {
        await przypomnieniaMenedzer.deleteTemplate(templateId);

        await interaction.editReply({
            content: `✅ Template **${templateId}** and all associated scheduled reminders have been deleted.`,
            embeds: [],
            components: []
        });

        // Update control panel to remove deleted template
        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Deleted template ${templateId}`);
    } catch (error) {
        logger.error('Error deleting template:', error);
        await interaction.editReply({
            content: '❌ Error deleting template.',
            embeds: [],
            components: []
        });
    }
}

async function handleConfirmDeleteScheduled(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const scheduledId = interaction.customId.replace('confirm_delete_scheduled_', '');

    try {
        const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);
        if (scheduled) {
            await tablicaMenedzer.deleteEmbed(scheduled);
        }

        await przypomnieniaMenedzer.deleteScheduled(scheduledId);

        await interaction.editReply({
            content: `✅ Scheduled reminder **${scheduledId}** has been deleted.`,
            embeds: [],
            components: []
        });

        logger.success(`Deleted scheduled ${scheduledId}`);
    } catch (error) {
        logger.error('Error deleting scheduled:', error);
        await interaction.editReply({
            content: '❌ Error deleting scheduled reminder.',
            embeds: [],
            components: []
        });
    }
}

async function handleConfirmDeleteEvent(interaction, sharedState) {
    const { eventMenedzer, listaEventowMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const eventId = interaction.customId.replace('confirm_delete_event_', '');

    try {
        await eventMenedzer.deleteEvent(eventId);

        // Update events list
        await listaEventowMenedzer.ensureEventsList();

        await interaction.editReply({
            content: `✅ Event **${eventId}** has been deleted.`,
            embeds: [],
            components: []
        });

        logger.success(`Deleted event ${eventId}`);
    } catch (error) {
        logger.error('Error deleting event:', error);
        await interaction.editReply({
            content: '❌ Error deleting event.',
            embeds: [],
            components: []
        });
    }
}

async function handleCancelDelete(interaction, sharedState) {
    await interaction.update({
        content: '❌ Cancelled usuwanie.',
        embeds: [],
        components: []
    });
}

// ==================== BOARD BUTTON HANDLERS ====================

async function handleBoardScheduledPause(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const scheduledId = interaction.customId.replace('scheduled_pause_', '');

    try {
        await przypomnieniaMenedzer.pauseScheduled(scheduledId);

        const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
        await tablicaMenedzer.updateEmbed(updated);

        await interaction.followUp({
            content: `⏸️ Scheduled reminder **${scheduledId}** has been paused.`,
            ephemeral: true
        });

        logger.success(`Paused scheduled ${scheduledId} from board`);
    } catch (error) {
        logger.error('Error pausing scheduled:', error);
        await interaction.followUp({
            content: '❌ Error pausing reminder.',
            ephemeral: true
        });
    }
}

async function handleBoardScheduledResume(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const scheduledId = interaction.customId.replace('scheduled_resume_', '');

    try {
        await przypomnieniaMenedzer.resumeScheduled(scheduledId);

        const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
        await tablicaMenedzer.updateEmbed(updated);

        await interaction.followUp({
            content: `▶️ Scheduled reminder **${scheduledId}** has been resumed.`,
            ephemeral: true
        });

        logger.success(`Resumed scheduled ${scheduledId} from board`);
    } catch (error) {
        logger.error('Error resuming scheduled:', error);
        await interaction.followUp({
            content: '❌ Error resuming reminder.',
            ephemeral: true
        });
    }
}

async function handleBoardScheduledEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduledId = interaction.customId.replace('scheduled_edit_', '');
    const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);

    if (!scheduled) {
        await interaction.reply({
            content: '❌ Scheduled reminder not found.',
            ephemeral: true
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_scheduled_modal_${scheduledId}`)
        .setTitle('Edit scheduled reminder');

    const firstTriggerDate = new Date(scheduled.firstTrigger);
    const formattedDate = `${firstTriggerDate.getFullYear()}-${String(firstTriggerDate.getMonth() + 1).padStart(2, '0')}-${String(firstTriggerDate.getDate()).padStart(2, '0')} ${String(firstTriggerDate.getHours()).padStart(2, '0')}:${String(firstTriggerDate.getMinutes()).padStart(2, '0')}`;

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('First trigger (YYYY-MM-DD HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(formattedDate)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setValue(scheduled.interval)
        .setRequired(false)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput)
    );

    await interaction.showModal(modal);
}

async function handleBoardScheduledDelete(interaction, sharedState) {
    const scheduledId = interaction.customId.replace('scheduled_delete_', '');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_scheduled_${scheduledId}`)
                .setLabel('Yes, delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${scheduledId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.reply({
        content: '⚠️ **Are you sure you want to delete this scheduled reminder?**',
        components: [row],
        ephemeral: true
    });
}

// ==================== EVENT SELECT HANDLERS ====================

async function handleDeleteEventSelect(interaction, sharedState) {
    const { eventMenedzer } = sharedState;

    const eventId = interaction.values[0];
    const event = eventMenedzer.getEvent(eventId);

    if (!event) {
        await interaction.update({
            content: '❌ Event not found.',
            components: []
        });
        return;
    }

    // Show confirmation
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_event_${eventId}`)
                .setLabel('Confirm Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('✔️'),
            new ButtonBuilder()
                .setCustomId('cancel_delete_event')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✖️')
        );

    await interaction.update({
        content: `❌ **Are you sure you want to delete this event?**\n\n📅 **Name:** ${event.name}\n🆔 **ID:** ${event.id}\n⏰ **Next trigger:** <t:${Math.floor(new Date(event.nextTrigger).getTime() / 1000)}:F>`,
        components: [row]
    });
}

async function handleEditEventSelect(interaction, sharedState) {
    const { eventMenedzer } = sharedState;

    const eventId = interaction.values[0];
    const event = eventMenedzer.getEvent(eventId);

    if (!event) {
        await interaction.update({
            content: '❌ Event not found.',
            components: []
        });
        return;
    }

    // Show edit modal
    const modal = new ModalBuilder()
        .setCustomId(`edit_event_modal_${eventId}`)
        .setTitle('Edytuj Event');

    const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Event name/description')
        .setStyle(TextInputStyle.Short)
        .setValue(event.name)
        .setRequired(false)
        .setMaxLength(100);

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('First trigger (YYYY-MM-DD HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(new Date(event.firstTrigger).toLocaleString('sv-SE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(',', '').replace('T', ' '))
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setValue(event.interval)
        .setRequired(false)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput)
    );

    await interaction.showModal(modal);
}

// ==================== EVENT MANAGEMENT HANDLERS ====================

async function handlePutList(interaction, sharedState) {
    const { listaEventowMenedzer, logger } = sharedState;

    // Show channel select menu
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('event_list_channel_select')
        .setPlaceholder('Select channel for events list')
        .setChannelTypes([ChannelType.GuildText]);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.reply({
        content: '📋 **Select channel** where the events list should be displayed:',
        components: [row],
        ephemeral: true
    });

    logger.info(`Ustaw Listę initiated by ${interaction.user.tag}`);
}

async function handleAddEvent(interaction, sharedState) {
    const { strefaCzasowaManager } = sharedState;

    const currentTime = strefaCzasowaManager.getCurrentTime();

    const modal = new ModalBuilder()
        .setCustomId('add_event_modal')
        .setTitle('Dodaj Event');

    const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Event name/description')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Boss Spawn, Weekly Meeting')
        .setRequired(false)
        .setMaxLength(100);

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('First trigger (YYYY-MM-DD HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(currentTime)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Puste = jednorazowe, lub: 1s, 1m, 1h, 1d (max 90d), ee')
        .setRequired(false)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput)
    );

    await interaction.showModal(modal);
}

async function handleDeleteEvent(interaction, sharedState) {
    const { eventMenedzer } = sharedState;

    const events = eventMenedzer.getAllEvents();

    if (events.length === 0) {
        await interaction.reply({
            content: '❌ No events to delete.',
            ephemeral: true
        });
        return;
    }

    // Show select menu with events
    const options = events.map(e => ({
        label: e.name.substring(0, 100),
        description: `Next: ${new Date(e.nextTrigger).toLocaleDateString('en-US')}`,
        value: e.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('delete_event_select')
        .setPlaceholder('Select event to delete')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '🗑️ **Select event to delete:**',
        components: [row],
        ephemeral: true
    });
}

async function handleEditEvent(interaction, sharedState) {
    const { eventMenedzer } = sharedState;

    const events = eventMenedzer.getAllEvents();

    if (events.length === 0) {
        await interaction.reply({
            content: '❌ No events to edit.',
            ephemeral: true
        });
        return;
    }

    // Show select menu with events
    const options = events.map(e => ({
        label: e.name.substring(0, 100),
        description: `Next: ${new Date(e.nextTrigger).toLocaleDateString('en-US')}`,
        value: e.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('edit_event_select')
        .setPlaceholder('Select event to edit')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '✏️ **Select event to edit:**',
        components: [row],
        ephemeral: true
    });
}

module.exports = {
    handlePrzypominienInteraction
};
