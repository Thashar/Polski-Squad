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

function getTextChannelsByCategory(guild) {
    const textChannels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .sort((a, b) => {
            const aOrder = (a.parent?.position ?? -1) * 1000 + a.position;
            const bOrder = (b.parent?.position ?? -1) * 1000 + b.position;
            return aOrder - bOrder;
        });

    const categories = new Map(); // categoryId -> { name, channels[] }

    for (const ch of textChannels.values()) {
        const catId = ch.parentId || 'none';
        const catName = ch.parent?.name || '📁 Bez kategorii';
        if (!categories.has(catId)) categories.set(catId, { name: catName, channels: [] });
        categories.get(catId).channels.push({ id: ch.id, name: ch.name });
    }

    return categories;
}

async function showCategorySelect(interaction, sharedState, sessionId, isUpdate = false) {
    const categories = getTextChannelsByCategory(interaction.guild);

    const rows = [];
    let currentRow = [];
    for (const [catId, cat] of categories) {
        if (currentRow.length === 5) {
            rows.push(new ActionRowBuilder().addComponents(currentRow));
            currentRow = [];
        }
        if (rows.length === 5) break; // Discord max 5 rows
        currentRow.push(
            new ButtonBuilder()
                .setCustomId(`ch_cat_${sessionId}_${catId}`)
                .setLabel(cat.name.slice(0, 80))
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (currentRow.length > 0) rows.push(new ActionRowBuilder().addComponents(currentRow));

    const payload = { content: '**Krok 2/3:** Wybierz kategorię kanałów', components: rows };
    if (isUpdate) await interaction.update(payload);
    else await interaction.editReply(payload);
}

async function showChannelsByCategory(interaction, sharedState, sessionId, catId, isUpdate = false) {
    const categories = getTextChannelsByCategory(interaction.guild);
    const cat = categories.get(catId);
    if (!cat) return;

    const select = new StringSelectMenuBuilder()
        .setCustomId(`channel_string_select_${sessionId}`)
        .setPlaceholder('Wybierz kanał...')
        .addOptions(cat.channels.slice(0, 25).map(c => ({
            label: c.name.slice(0, 100),
            value: c.id
        })));

    const backBtn = new ButtonBuilder()
        .setCustomId(`ch_cat_back_${sessionId}`)
        .setLabel('◀ Kategorie')
        .setStyle(ButtonStyle.Secondary);

    const rowSelect = new ActionRowBuilder().addComponents(select);
    const rowBack = new ActionRowBuilder().addComponents(backBtn);

    const payload = {
        content: `**Krok 2/3:** Wybierz kanał z kategorii **${cat.name}**`,
        components: [rowSelect, rowBack]
    };
    if (isUpdate) await interaction.update(payload);
    else await interaction.editReply(payload);
}

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

        console.log(`[PARSE DEBUG] Input: "${dateStr}", Timezone: ${timezone}`);
        console.log(`[PARSE DEBUG] Reference (północ): TZ=${tzHour}:00, UTC=${utcHour}:00, Offset=${offsetHours}`);

        // Handle day boundary crossing
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        // ODEJMIJ offset od wpisanej godziny, żeby dostać UTC
        // Przykład: Warsaw (UTC+1), wpisane 17:00 → 17 - 1 = 16:00 UTC
        // Discord pokaże: 16:00 UTC + 1h = 17:00 w Warsaw ✅
        const finalUTCHour = parseInt(hour) - offsetHours;

        console.log(`[PARSE DEBUG] User hour: ${hour}, Offset: ${offsetHours}, Final UTC hour: ${finalUTCHour}`);

        const finalUTC = Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            finalUTCHour,
            parseInt(minute),
            0
        );

        const resultDate = new Date(finalUTC);
        console.log(`[PARSE DEBUG] Result: ${resultDate.toISOString()}`);
        console.log(`[PARSE DEBUG] Unix: ${Math.floor(finalUTC / 1000)}`);

        return resultDate;
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
        content: '**Krok 1:** Wybierz typ przypomnienia',
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
            content: '❌ Nie znaleziono szablonów przypomnień. Użyj `/new-reminder` aby utworzyć szablon.',
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
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        paginationRow.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info')
                .setLabel(`Strona ${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        if (page < totalPages - 1) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`template_page_${action}_${page + 1}`)
                    .setLabel('Następna ▶')
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
                .setLabel('Szablony')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝'),
            new ButtonBuilder()
                .setCustomId('edit_reminder_scheduled')
                .setLabel('Zaplanowane')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⏰'),
            new ButtonBuilder()
                .setCustomId('edit_reminder_manual')
                .setLabel('Manualne')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🖐️')
        );

    await interaction.reply({
        content: '**Edytuj powiadomienia** - Wybierz typ:',
        components: [row],
        ephemeral: true
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

    // Template/Scheduled selection in /edit-reminder
    if (customId === 'edit_reminder_templates') {
        await handleEditTemplatesButton(interaction, sharedState);
        return;
    }

    if (customId === 'edit_reminder_scheduled') {
        await handleEditScheduledButton(interaction, sharedState);
        return;
    }

    if (customId === 'edit_reminder_manual') {
        await handleEditManualButton(interaction, sharedState);
        return;
    }

    // Scheduled edit pagination
    if (customId.startsWith('scheduled_page_edit_')) {
        await handleScheduledPageEdit(interaction, sharedState);
        return;
    }

    // Manual edit pagination
    if (customId.startsWith('scheduled_page_manual_')) {
        await handleManualPageEdit(interaction, sharedState);
        return;
    }

    // Edit scheduled pause/resume
    if (customId.startsWith('edit_scheduled_pause_')) {
        await handleEditScheduledPause(interaction, sharedState);
        return;
    }

    if (customId.startsWith('edit_scheduled_resume_')) {
        await handleEditScheduledResume(interaction, sharedState);
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
    if (customId === 'goto_control_panel') {
        await handleGotoControlPanel(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_send_')) {
        await handleBoardScheduledSend(interaction, sharedState);
        return;
    }

    if (customId.startsWith('scheduled_preview_')) {
        await handleBoardScheduledPreview(interaction, sharedState);
        return;
    }

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
            content: '❌ Usuwanie eventu anulowane.',
            components: []
        });
        return;
    }

    if (customId.startsWith('ch_cat_back_')) {
        const sessionId = customId.replace('ch_cat_back_', '');
        const userState = userStates.get(interaction.user.id);
        if (!userState || userState.sessionId !== sessionId) {
            await interaction.update({ content: '❌ Sesja wygasła.', components: [] });
            return;
        }
        await showCategorySelect(interaction, sharedState, sessionId, true);
        return;
    }

    if (customId.startsWith('ch_cat_')) {
        // format: ch_cat_${sessionId}_${catId}
        const withoutPrefix = customId.replace('ch_cat_', '');
        const underscoreIdx = withoutPrefix.indexOf('_');
        const sessionId = withoutPrefix.slice(0, underscoreIdx);
        const catId = withoutPrefix.slice(underscoreIdx + 1);
        const userState = userStates.get(interaction.user.id);
        if (!userState || userState.sessionId !== sessionId) {
            await interaction.update({ content: '❌ Sesja wygasła.', components: [] });
            return;
        }
        await showChannelsByCategory(interaction, sharedState, sessionId, catId, true);
        return;
    }

    if (customId.startsWith('cancel_delete_')) {
        await handleCancelDelete(interaction, sharedState);
        return;
    }

    if (customId.startsWith('set_reminder_skip_roles_')) {
        await interaction.deferUpdate();

        const sessionId = customId.replace('set_reminder_skip_roles_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.editReply({
                content: '❌ Sesja wygasła. Zacznij od nowa.',
                components: []
            });
            return;
        }

        userState.roles = [];
        await createScheduledFromUserState(interaction, sharedState, userState);
        return;
    }

    if (customId.startsWith('set_reminder_everyone_')) {
        await interaction.deferUpdate();

        const sessionId = customId.replace('set_reminder_everyone_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.editReply({
                content: '❌ Sesja wygasła. Zacznij od nowa.',
                components: []
            });
            return;
        }

        userState.roles = ['everyone'];
        await createScheduledFromUserState(interaction, sharedState, userState);
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

    // Channel string select (paginated)
    if (customId.startsWith('channel_string_select_')) {
        const sessionId = customId.replace('channel_string_select_', '');
        const userState = sharedState.userStates.get(interaction.user.id);
        if (!userState || userState.sessionId !== sessionId) {
            await interaction.update({ content: '❌ Sesja wygasła.', components: [] });
            return;
        }
        const selectedChannelId = interaction.values[0];
        userState.channelId = selectedChannelId;
        userState.step = 'select_roles';
        sharedState.userStates.set(interaction.user.id, userState);

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`set_reminder_roles_${sessionId}`)
            .setPlaceholder('Wybierz role do pingowania (opcjonalne)')
            .setMinValues(0)
            .setMaxValues(10);

        const skipButton = new ButtonBuilder()
            .setCustomId(`set_reminder_skip_roles_${sessionId}`)
            .setLabel('Bez pingów')
            .setStyle(ButtonStyle.Secondary);

        const everyoneButton = new ButtonBuilder()
            .setCustomId(`set_reminder_everyone_${sessionId}`)
            .setLabel('Pinguj @everyone')
            .setStyle(ButtonStyle.Danger);

        const row1 = new ActionRowBuilder().addComponents(roleSelect);
        const row2 = new ActionRowBuilder().addComponents(skipButton, everyoneButton);

        await interaction.update({
            content: `**Krok 3/3:** Wybierz role do pingowania\n📍 **Kanał:** <#${selectedChannelId}>`,
            components: [row1, row2]
        });
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

    // Manual selection for /edit-reminder Manualne
    if (customId.startsWith('scheduled_select_manual_')) {
        await handleManualSelectForEdit(interaction, sharedState);
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
            .setTitle('Nowy szablon - Tekst');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. Przypomnienie o Bossie')
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
            .setTitle('Nowy szablon - Embed');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Nazwa szablonu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. Event Bossa')
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
            .setPlaceholder('Opis...')
            .setRequired(false)
            .setMaxLength(4000);

        const iconInput = new TextInputBuilder()
            .setCustomId('embedIcon')
            .setLabel('Embed icon (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://... (opcjonalne)')
            .setRequired(false);

        const imageInput = new TextInputBuilder()
            .setCustomId('embedImage')
            .setLabel('Obraz embed (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://... (opcjonalne)')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(imageInput)
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
        .setTitle('Ustaw harmonogram');

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('Pierwsze wyzwolenie (RRRR-MM-DD GG:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(currentTime)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Puste = jednorazowe, lub: 1s, 1m, 1h, 1d (max 90d), ee, msc')
        .setRequired(false)
        .setMaxLength(10);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Ustandaryzowane? (TAK / puste = dostosowane)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz TAK lub zostaw puste')
        .setRequired(false)
        .setMaxLength(3);

    const manualInput = new TextInputBuilder()
        .setCustomId('manual')
        .setLabel('Tylko manualne? (TAK = tak, puste = z datą)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz TAK lub zostaw puste')
        .setRequired(false)
        .setMaxLength(3);

    modal.addComponents(
        new ActionRowBuilder().addComponents(firstTriggerInput),
        new ActionRowBuilder().addComponents(intervalInput),
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(manualInput)
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
            content: '❌ Nie znaleziono zaplanowanego przypomnienia.',
            components: []
        });
        return;
    }

    await showScheduledEditPreview(interaction, scheduled, sharedState);
}

async function handleManualSelectForEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduledId = interaction.values[0];
    const scheduled = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);

    if (!scheduled) {
        await interaction.update({
            content: '❌ Nie znaleziono manualnego powiadomienia.',
            components: []
        });
        return;
    }

    await showManualEditPreview(interaction, scheduled, sharedState);
}

async function handleEditScheduledPause(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    const scheduledId = interaction.customId.replace('edit_scheduled_pause_', '');

    try {
        await przypomnieniaMenedzer.pauseScheduled(scheduledId);
        await tablicaMenedzer.ensureControlPanel();

        const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
        if (!updated) {
            await interaction.update({ content: '❌ Nie znaleziono przypomnienia.', components: [] });
            return;
        }
        await showScheduledEditPreview(interaction, updated, sharedState);
        logger.success(`Wstrzymano zaplanowane ${scheduledId} z widoku edycji`);
    } catch (error) {
        logger.error('Błąd wstrzymywania zaplanowanego:', error);
        await interaction.update({ content: '❌ Błąd podczas wstrzymywania.', components: [] });
    }
}

async function handleEditScheduledResume(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    const scheduledId = interaction.customId.replace('edit_scheduled_resume_', '');

    try {
        await przypomnieniaMenedzer.resumeScheduled(scheduledId);
        await tablicaMenedzer.ensureControlPanel();

        const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
        if (!updated) {
            await interaction.update({ content: '❌ Nie znaleziono przypomnienia.', components: [] });
            return;
        }
        await showScheduledEditPreview(interaction, updated, sharedState);
        logger.success(`Wznowiono zaplanowane ${scheduledId} z widoku edycji`);
    } catch (error) {
        logger.error('Błąd wznawiania zaplanowanego:', error);
        await interaction.update({ content: '❌ Błąd podczas wznawiania.', components: [] });
    }
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
                content: '❌ Sesja wygasła. Zacznij od nowa.',
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
            .setPlaceholder('Wybierz role do pingowania (opcjonalne)')
            .setMinValues(0)
            .setMaxValues(10);

        const skipButton = new ButtonBuilder()
            .setCustomId(`set_reminder_skip_roles_${sessionId}`)
            .setLabel('Bez pingów')
            .setStyle(ButtonStyle.Secondary);

        const everyoneButton = new ButtonBuilder()
            .setCustomId(`set_reminder_everyone_${sessionId}`)
            .setLabel('Pinguj @everyone')
            .setStyle(ButtonStyle.Danger);

        const row1 = new ActionRowBuilder().addComponents(roleSelect);
        const row2 = new ActionRowBuilder().addComponents(skipButton, everyoneButton);

        await interaction.update({
            content: `**Krok 3/3:** Wybierz role do pingowania (opcjonalne)\n📍 **Kanał:** <#${selectedChannel.id}>`,
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

    if (customId.startsWith('set_reminder_roles_')) {
        await interaction.deferUpdate();

        const sessionId = customId.replace('set_reminder_roles_', '');
        const userState = userStates.get(interaction.user.id);

        if (!userState || userState.sessionId !== sessionId) {
            await interaction.editReply({
                content: '❌ Sesja wygasła. Zacznij od nowa.',
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
            const embedImage = interaction.fields.getTextInputValue('embedImage') || null;

            const sessionId = Date.now().toString();
            userStates.set(interaction.user.id, {
                sessionId,
                type: 'embed',
                name,
                embedTitle,
                embedDescription,
                embedIcon,
                embedImage
            });

            await showTemplatePreview(interaction, {
                type: 'embed',
                name,
                embedTitle,
                embedDescription,
                embedIcon,
                embedImage
            }, sessionId);
        }
        // Set reminder schedule
        else if (customId.startsWith('set_reminder_modal_')) {
            const templateId = customId.replace('set_reminder_modal_', '');
            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');
            const type = interaction.fields.getTextInputValue('type');
            const manualStr = interaction.fields.getTextInputValue('manual').trim().toUpperCase();
            const isManual = manualStr === 'TAK';
            const isStandardized = type.trim().toUpperCase() === 'TAK';

            let firstTrigger = null;
            if (!isManual) {
                // Parse firstTrigger z konwersją strefy czasowej Warsaw → UTC
                const timezone = sharedState.strefaCzasowaManager.getGlobalTimezone();
                firstTrigger = parseDateInTimezone(firstTriggerStr, timezone);
                if (isNaN(firstTrigger.getTime())) {
                    await interaction.editReply({
                        content: '❌ Nieprawidłowy format daty. Użyj: RRRR-MM-DD GG:MM (np. 2026-03-20 10:00)'
                    });
                    return;
                }

                if (firstTrigger < new Date()) {
                    await interaction.editReply({
                        content: '❌ Data pierwszego wyzwolenia nie może być w przeszłości.'
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
            }

            const sessionId = Date.now().toString();

            // USTANDARYZOWANE (kanał z Listą Eventów, tylko pingi)
            if (isStandardized) {
                const { eventMenedzer } = sharedState;
                const eventListChannelId = eventMenedzer.getListChannelId();

                if (!eventListChannelId) {
                    await interaction.editReply({
                        content: '❌ Kanał z Listą Eventów nie został ustawiony. Użyj opcji dostosowanej lub ustaw kanał listy eventów.'
                    });
                    return;
                }

                // Store in user state with channel already set
                userStates.set(interaction.user.id, {
                    sessionId,
                    templateId,
                    firstTrigger: firstTrigger ? firstTrigger.toISOString() : null,
                    interval: isManual ? null : interval,
                    channelId: eventListChannelId,
                    notificationType: 1,
                    isManual,
                    step: 'select_roles'
                });

                // Pokaż role select od razu (bez wyboru kanału)
                const roleSelect = new RoleSelectMenuBuilder()
                    .setCustomId(`set_reminder_roles_${sessionId}`)
                    .setPlaceholder('Wybierz role do pingowania (opcjonalne)')
                    .setMinValues(0)
                    .setMaxValues(10);

                const skipButton = new ButtonBuilder()
                    .setCustomId(`set_reminder_skip_roles_${sessionId}`)
                    .setLabel('Bez pingów')
                    .setStyle(ButtonStyle.Secondary);

                const everyoneButton = new ButtonBuilder()
                    .setCustomId(`set_reminder_everyone_${sessionId}`)
                    .setLabel('Pinguj @everyone')
                    .setStyle(ButtonStyle.Danger);

                const row1 = new ActionRowBuilder().addComponents(roleSelect);
                const row2 = new ActionRowBuilder().addComponents(skipButton, everyoneButton);

                await interaction.editReply({
                    content: `**Krok 2/2:** Wybierz role do pingowania (opcjonalne)\n📍 **Kanał:** <#${eventListChannelId}> (Lista Eventów)`,
                    components: [row1, row2]
                });
            }
            // DOSTOSOWANE (wybór kanału + pingi)
            else {
                // Store in user state for channel/role selection
                userStates.set(interaction.user.id, {
                    sessionId,
                    templateId,
                    firstTrigger: firstTrigger ? firstTrigger.toISOString() : null,
                    interval: isManual ? null : interval,
                    notificationType: 0,
                    isManual,
                    step: 'select_channel'
                });

                await showCategorySelect(interaction, sharedState, sessionId, false);
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
                await tablicaMenedzer.ensureControlPanel();
                await interaction.deleteReply();
                await interaction.followUp({ content: `✅ Szablon **${name}** zaktualizowany!\n\n${text}`, ephemeral: true });
            } else {
                const name = interaction.fields.getTextInputValue('name');
                const embedTitle = interaction.fields.getTextInputValue('embedTitle');
                const embedDescription = interaction.fields.getTextInputValue('embedDescription');
                const embedIcon = interaction.fields.getTextInputValue('embedIcon') || null;
                const embedImage = interaction.fields.getTextInputValue('embedImage') || null;

                await przypomnieniaMenedzer.updateTemplate(templateId, {
                    name,
                    embedTitle,
                    embedDescription,
                    embedIcon,
                    embedImage
                });
                await tablicaMenedzer.ensureControlPanel();

                const embed = new EmbedBuilder().setDescription(embedDescription);
                if (embedTitle) embed.setTitle(embedTitle);
                if (embedIcon) embed.setThumbnail(embedIcon);
                if (embedImage) embed.setImage(embedImage);

                await interaction.deleteReply();
                await interaction.followUp({ content: `✅ Szablon **${name}** zaktualizowany!`, embeds: [embed], ephemeral: true });
            }

            logger.success(`Updated template ${templateId}`);
        }
        // Edit scheduled
        else if (customId.startsWith('edit_scheduled_modal_')) {
            const scheduledId = customId.replace('edit_scheduled_modal_', '');
            const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);

            if (!scheduled) {
                await interaction.editReply({ content: '❌ Nie znaleziono zaplanowanego przypomnienia.' });
                return;
            }

            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');

            // Parse firstTrigger z konwersją strefy czasowej Warsaw → UTC
            const timezone = sharedState.strefaCzasowaManager.getGlobalTimezone();
            const firstTrigger = parseDateInTimezone(firstTriggerStr, timezone);
            if (isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format daty. Użyj: RRRR-MM-DD GG:MM'
                });
                return;
            }

            // Validate interval (opcjonalne - puste = jednorazowe)
            if (!przypomnieniaMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), "ee", "msc", lub zostaw puste dla jednorazowego przypomnienia.'
                });
                return;
            }

            // Jeśli podano interwał, sprawdź limit
            let intervalMs = null;
            if (interval && interval.trim() !== '') {
                intervalMs = przypomnieniaMenedzer.parseInterval(interval);
                const maxInterval = 90 * 24 * 60 * 60 * 1000;
                if (intervalMs && intervalMs > maxInterval) {
                    await interaction.editReply({
                        content: '❌ Interwał nie może przekraczać 90 dni.'
                    });
                    return;
                }
            }

            // Dla msc - oblicz monthlyDay z nowego firstTrigger
            const monthlyDay = interval === 'msc'
                ? parseInt(firstTrigger.toLocaleString('en-US', { timeZone: 'Europe/Warsaw', day: 'numeric' }))
                : null;

            await przypomnieniaMenedzer.updateScheduled(scheduledId, {
                firstTrigger: firstTrigger.toISOString(),
                interval,
                intervalMs,
                monthlyDay,
                nextTrigger: firstTrigger.toISOString()
            });

            // Update board
            const { tablicaMenedzer } = sharedState;
            const updated = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);
            await tablicaMenedzer.updateEmbed(updated);
            await interaction.deleteReply();
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
                    content: '❌ Nieprawidłowy format daty. Użyj: RRRR-MM-DD GG:MM (np. 2026-03-20 10:00)'
                });
                return;
            }

            if (firstTrigger < new Date()) {
                await interaction.editReply({
                    content: '❌ Data pierwszego wyzwolenia nie może być w przeszłości.'
                });
                return;
            }

            // Validate interval
            if (!eventMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), "ee" lub "msc"'
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
                await sharedState.tablicaMenedzer.ensureControlPanel();
                await interaction.deleteReply();
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
            const { eventMenedzer, listaEventowMenedzer, strefaCzasowaManager } = sharedState;

            const eventId = customId.replace('edit_event_modal_', '');
            const event = eventMenedzer.getEvent(eventId);

            if (!event) {
                await interaction.editReply({ content: '❌ Event nie znaleziony.' });
                return;
            }

            const name = interaction.fields.getTextInputValue('name');
            const firstTriggerStr = interaction.fields.getTextInputValue('firstTrigger');
            const interval = interaction.fields.getTextInputValue('interval');

            // Parse firstTrigger z konwersją strefy czasowej Warsaw → UTC
            const timezone = strefaCzasowaManager.getGlobalTimezone();
            const firstTrigger = parseDateInTimezone(firstTriggerStr, timezone);
            if (isNaN(firstTrigger.getTime())) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format daty. Użyj: RRRR-MM-DD GG:MM'
                });
                return;
            }

            // Validate interval
            if (!eventMenedzer.validateInterval(interval)) {
                await interaction.editReply({
                    content: '❌ Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), "ee" lub "msc"'
                });
                return;
            }

            const intervalMs = (interval && interval.trim() !== '') ? eventMenedzer.parseInterval(interval) : null;

            const effectiveInterval = interval && interval.trim() !== '' ? interval : null;
            await eventMenedzer.updateEvent(eventId, {
                name,
                firstTrigger: firstTrigger.toISOString(),
                interval: effectiveInterval,
                intervalMs,
                monthlyDay: effectiveInterval === 'msc'
                    ? parseInt(firstTrigger.toLocaleString('en-US', { timeZone: 'Europe/Warsaw', day: 'numeric' }))
                    : null,
                nextTrigger: firstTrigger.toISOString()
            });

            // Update events list
            await listaEventowMenedzer.ensureEventsList();
            await sharedState.tablicaMenedzer.ensureControlPanel();
            await interaction.deleteReply();
            logger.success(`Updated event ${eventId}`);
        }

    } catch (error) {
        logger.error('Error handling modal submit:', error);
        await interaction.editReply({ content: '❌ Wystąpił błąd podczas przetwarzania.' });
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
        const embed = new EmbedBuilder()
            .setDescription(data.embedDescription);

        if (data.embedTitle) embed.setTitle(data.embedTitle);
        if (data.embedIcon) embed.setThumbnail(data.embedIcon);
        if (data.embedImage) embed.setImage(data.embedImage);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`template_preview_approve_${sessionId}`)
                .setLabel('Zatwierdź')
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
    let content = `**📝 Szablon: ${template.name}**\n`;
    content += `📋 Typ: ${template.type === 'text' ? 'Tekst' : 'Embed'}\n\n`;
    content += '**Podgląd:**';

    const embeds = [];
    if (template.type === 'text') {
        content += `\n\n${template.text}`;
    } else {
        const embed = new EmbedBuilder()
            .setDescription(template.embedDescription);

        if (template.embedTitle) embed.setTitle(template.embedTitle);
        if (template.embedIcon) embed.setThumbnail(template.embedIcon);
        if (template.embedImage) embed.setImage(template.embedImage);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_template_edit_${template.id}`)
                .setLabel('Edytuj')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`edit_template_delete_${template.id}`)
                .setLabel('Usuń')
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
    const statusIcon = scheduled.status === 'active' ? '🟢' : '⏸️';
    const statusText = scheduled.status === 'active' ? 'Aktywne' : 'Wstrzymane';

    let content = `**⏰ Zaplanowane: ${template.name}**\n`;
    content += `📍 Kanał: <#${scheduled.channelId}> | ${statusIcon} ${statusText}\n`;
    content += `⏭️ Następne: <t:${nextTriggerTimestamp}:R>\n`;
    content += `🔄 Interwał: ${przypomnieniaMenedzer.formatInterval(scheduled.interval)}\n\n`;
    content += '**Podgląd powiadomienia:**\n';

    if (scheduled.roles && scheduled.roles.length > 0) {
        if (scheduled.roles[0] === 'everyone') {
            content += '@everyone\n';
        } else {
            content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n';
        }
    }

    const embeds = [];
    if (template.type === 'text') {
        content += `\n${template.text}`;
    } else {
        const embed = new EmbedBuilder()
            .setDescription(template.embedDescription)
            .setTimestamp();

        if (template.embedTitle) embed.setTitle(template.embedTitle);
        if (template.embedIcon) embed.setThumbnail(template.embedIcon);
        if (template.embedImage) embed.setImage(template.embedImage);

        embeds.push(embed);
    }

    const isPaused = scheduled.status === 'paused';
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_edit_${scheduled.id}`)
                .setLabel('Edytuj')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_delete_${scheduled.id}`)
                .setLabel('Usuń')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            isPaused
                ? new ButtonBuilder()
                    .setCustomId(`edit_scheduled_resume_${scheduled.id}`)
                    .setLabel('Wznów')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('▶️')
                : new ButtonBuilder()
                    .setCustomId(`edit_scheduled_pause_${scheduled.id}`)
                    .setLabel('Wstrzymaj')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏸️')
        );

    await interaction.update({
        content,
        embeds,
        components: [row]
    });
}

async function showManualEditPreview(interaction, scheduled, sharedState) {
    const template = scheduled.template;

    let content = `**🖐️ Manualne: ${template.name}**\n`;
    content += `📍 Kanał: <#${scheduled.channelId}>\n\n`;
    content += '**Podgląd powiadomienia:**\n';

    if (scheduled.roles && scheduled.roles.length > 0) {
        if (scheduled.roles[0] === 'everyone') {
            content += '@everyone\n';
        } else {
            content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n';
        }
    }

    const embeds = [];
    if (template.type === 'text') {
        content += `\n${template.text}`;
    } else {
        const embed = new EmbedBuilder()
            .setDescription(template.embedDescription)
            .setTimestamp();

        if (template.embedTitle) embed.setTitle(template.embedTitle);
        if (template.embedIcon) embed.setThumbnail(template.embedIcon);
        if (template.embedImage) embed.setImage(template.embedImage);

        embeds.push(embed);
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_edit_${scheduled.id}`)
                .setLabel('Edytuj')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId(`edit_scheduled_delete_${scheduled.id}`)
                .setLabel('Usuń')
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

        if (userState.isManual) {
            await przypomnieniaMenedzer.updateScheduled(scheduled.id, { isManual: true, status: 'manual' });
        }

        // Get scheduled with template for board embed
        const scheduledWithTemplate = przypomnieniaMenedzer.getScheduledWithTemplate(scheduled.id);
        logger.info(`Creating board embed for ${scheduled.id} - has template: ${!!scheduledWithTemplate?.template}`);
        const embedResult = await tablicaMenedzer.createEmbed(scheduledWithTemplate);
        logger.info(`Board embed creation result: ${embedResult ? 'success' : 'failed'}`);

        userStates.delete(interaction.user.id);

        const template = przypomnieniaMenedzer.getTemplate(userState.templateId);
        const nextTriggerDate = new Date(scheduled.nextTrigger);
        const nextTriggerTimestamp = Math.floor(nextTriggerDate.getTime() / 1000);

        let content = '✅ **Zaplanowane przypomnienie utworzone!**\n\n';
        content += `⏰ **ID:** ${scheduled.id}\n`;
        content += `📝 **Szablon:** ${template.name}\n`;
        content += `📅 **Pierwsze wyzwolenie:** <t:${nextTriggerTimestamp}:F>\n`;
        content += `🔄 **Interwał:** ${przypomnieniaMenedzer.formatInterval(scheduled.interval)}\n`;
        content += `📍 **Kanał:** <#${userState.channelId}>\n`;
        const rolesDisplay = userState.roles && userState.roles.length > 0
            ? (userState.roles[0] === 'everyone' ? '@everyone' : userState.roles.map(r => `<@&${r}>`).join(', '))
            : 'Brak';
        content += `👥 **Role:** ${rolesDisplay}`;

        await interaction.editReply({
            content,
            components: []
        });

        logger.success(`Created scheduled reminder ${scheduled.id}`);
    } catch (error) {
        logger.error('Error creating scheduled reminder:', error);
        await interaction.editReply({
            content: `❌ Błąd: ${error.message}`,
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
            content: '❌ Sesja wygasła.',
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
                    embedImage: userState.embedImage
                }
            );
        }

        userStates.delete(interaction.user.id);

        await interaction.editReply({
            content: `✅ Szablon **${template.name}** został utworzony!\n🆔 ID: ${template.id}`,
            embeds: [],
            components: []
        });

        // Update control panel to show new template
        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Created template ${template.id}`);
    } catch (error) {
        logger.error('Error creating template:', error);
        await interaction.editReply({
            content: '❌ Błąd podczas tworzenia szablonu.',
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
        content: '❌ Tworzenie szablonu anulowane.',
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
            content: '❌ Sesja wygasła.',
            embeds: [],
            components: []
        });
        return;
    }

    if (userState.type === 'text') {
        const modal = new ModalBuilder()
            .setCustomId('new_reminder_modal_text')
            .setTitle('Edytuj szablon - Tekst');

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
            .setTitle('Edytuj szablon - Embed');

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

        const imageInput = new TextInputBuilder()
            .setCustomId('embedImage')
            .setLabel('Obraz embed (URL)')
            .setStyle(TextInputStyle.Short)
            .setValue(userState.embedImage || '')
            .setPlaceholder('https://... (opcjonalne)')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(imageInput)
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
        content: '❌ Anulowano',
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
            content: '❌ Brak szablonów. Użyj `/new-reminder` aby utworzyć szablon.',
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

    const allScheduled = przypomnieniaMenedzer.getAllScheduled();
    const scheduled = allScheduled.filter(s => !s.isManual && s.status !== 'manual');

    if (scheduled.length === 0) {
        await interaction.update({
            content: '❌ Brak zaplanowanych przypomnień. Użyj `/set-reminder` aby utworzyć.',
            components: []
        });
        return;
    }

    await showScheduledSelectPage(interaction, sharedState, 0, scheduled, 'edit');
}

async function handleEditManualButton(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const allScheduled = przypomnieniaMenedzer.getAllScheduled();
    const manual = allScheduled.filter(s => s.isManual || s.status === 'manual');

    if (manual.length === 0) {
        await interaction.update({
            content: '❌ Brak manualnych powiadomień. Utwórz powiadomienie z trybem manualnym.',
            components: []
        });
        return;
    }

    await showScheduledSelectPage(interaction, sharedState, 0, manual, 'manual');
}

async function showScheduledSelectPage(interaction, sharedState, page, list, mode) {
    const { przypomnieniaMenedzer } = sharedState;

    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, list.length);
    const pageItems = list.slice(start, end);

    const options = pageItems.map(s => {
        const template = przypomnieniaMenedzer.getTemplate(s.templateId);
        const templateName = template ? template.name : 'Nieznany';
        const channel = interaction.guild?.channels.cache.get(s.channelId);
        const channelName = channel ? channel.name : s.channelId;
        return {
            label: `${templateName} — #${channelName}`.substring(0, 100),
            value: s.id
        };
    });

    const customIdPrefix = mode === 'manual' ? 'scheduled_select_manual_' : 'scheduled_select_edit_';
    const pageButtonPrefix = mode === 'manual' ? 'scheduled_page_manual_' : 'scheduled_page_edit_';
    const title = mode === 'manual' ? 'Wybierz manualne powiadomienie' : 'Wybierz zaplanowane przypomnienie';

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`${customIdPrefix}${page}`)
        .setPlaceholder(`${title} (${list.length} łącznie)`)
        .addOptions(options);

    const rows = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder();
        if (page > 0) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`${pageButtonPrefix}${page - 1}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        paginationRow.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info')
                .setLabel(`Strona ${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
        if (page < totalPages - 1) {
            paginationRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`${pageButtonPrefix}${page + 1}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        rows.push(paginationRow);
    }

    await interaction.update({
        content: `**${title}** (${list.length} łącznie)`,
        components: rows
    });
}

async function handleScheduledPageEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;
    const page = parseInt(interaction.customId.replace('scheduled_page_edit_', ''));
    const allScheduled = przypomnieniaMenedzer.getAllScheduled();
    const list = allScheduled.filter(s => !s.isManual && s.status !== 'manual');
    await showScheduledSelectPage(interaction, sharedState, page, list, 'edit');
}

async function handleManualPageEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;
    const page = parseInt(interaction.customId.replace('scheduled_page_manual_', ''));
    const allScheduled = przypomnieniaMenedzer.getAllScheduled();
    const list = allScheduled.filter(s => s.isManual || s.status === 'manual');
    await showScheduledSelectPage(interaction, sharedState, page, list, 'manual');
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
            .setTitle('Edytuj szablon - Tekst');

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
            .setTitle('Edytuj szablon - Embed');

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

        const imageInput = new TextInputBuilder()
            .setCustomId('embedImage')
            .setLabel('Obraz embed (URL)')
            .setStyle(TextInputStyle.Short)
            .setValue(template.embedImage || '')
            .setPlaceholder('https://... (opcjonalne)')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(iconInput),
            new ActionRowBuilder().addComponents(imageInput)
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
                .setLabel('Tak, usuń')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${templateId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({
        content: '⚠️ **Czy na pewno chcesz usunąć ten szablon?**\n\nUwaga: Wszystkie zaplanowane przypomnienia używające tego szablonu zostaną również usunięte!',
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
            content: '❌ Nie znaleziono zaplanowanego przypomnienia.',
            components: []
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_scheduled_modal_${scheduledId}`)
        .setTitle('Edytuj zaplanowane przypomnienie');

    const formattedDate = new Date(scheduled.firstTrigger).toLocaleString('sv-SE', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).replace(',', '');

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('Pierwsze wyzwolenie (RRRR-MM-DD GG:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(formattedDate)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setValue(scheduled.interval ?? '')
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
                .setLabel('Tak, usuń')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${scheduledId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({
        content: '⚠️ **Czy na pewno chcesz usunąć to zaplanowane przypomnienie?**',
        embeds: [],
        components: [row]
    });
}

async function handleConfirmDeleteTemplate(interaction, sharedState) {
    const { przypomnieniaMenedzer, tablicaMenedzer, logger } = sharedState;

    await interaction.deferUpdate();

    const templateId = interaction.customId.replace('confirm_delete_template_', '');

    try {
        // Zbierz powiązane scheduledy PRZED usunięciem z JSON
        const affectedScheduled = przypomnieniaMenedzer.getAllScheduled().filter(s => s.templateId === templateId);

        // Usuń ich embedy z tablicy
        for (const sch of affectedScheduled) {
            await tablicaMenedzer.deleteEmbed(sch);
        }

        await przypomnieniaMenedzer.deleteTemplate(templateId);

        // Odśwież panel kontrolny
        await tablicaMenedzer.ensureControlPanel();

        await interaction.deleteReply();

        logger.success(`Deleted template ${templateId} and ${affectedScheduled.length} associated scheduled reminder(s)`);
    } catch (error) {
        logger.error('Error deleting template:', error);
        await interaction.editReply({
            content: '❌ Błąd podczas usuwania szablonu.',
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

        await interaction.deleteReply();

        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Deleted scheduled ${scheduledId}`);
    } catch (error) {
        logger.error('Error deleting scheduled:', error);
        await interaction.editReply({
            content: '❌ Błąd podczas usuwania zaplanowanego przypomnienia.',
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

        // Update events list and control panel
        await listaEventowMenedzer.ensureEventsList();
        await tablicaMenedzer.ensureControlPanel();

        await interaction.deleteReply();
        logger.success(`Deleted event ${eventId}`);
    } catch (error) {
        logger.error('Error deleting event:', error);
        await interaction.editReply({
            content: '❌ Błąd podczas usuwania eventu.',
            embeds: [],
            components: []
        });
    }
}

async function handleCancelDelete(interaction, sharedState) {
    await interaction.update({
        content: '❌ Usuwanie anulowane.',
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
        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Paused scheduled ${scheduledId} from board`);
    } catch (error) {
        logger.error('Error pausing scheduled:', error);
        await interaction.followUp({
            content: '❌ Błąd podczas pauzowania przypomnienia.',
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
        await tablicaMenedzer.ensureControlPanel();

        logger.success(`Resumed scheduled ${scheduledId} from board`);
    } catch (error) {
        logger.error('Error resuming scheduled:', error);
        await interaction.followUp({
            content: '❌ Błąd podczas wznawiania przypomnienia.',
            ephemeral: true
        });
    }
}

async function handleGotoControlPanel(interaction, sharedState) {
    const { tablicaMenedzer } = sharedState;
    const panelMessageId = tablicaMenedzer.controlPanelMessageId;
    const boardChannel = tablicaMenedzer.boardChannel;

    if (!panelMessageId || !boardChannel) {
        await interaction.reply({ content: '❌ Panel kontrolny nie został jeszcze utworzony.', ephemeral: true });
        return;
    }

    const guildId = boardChannel.guild?.id;
    const channelId = boardChannel.id;
    const url = `https://discord.com/channels/${guildId}/${channelId}/${panelMessageId}`;

    await interaction.reply({ content: `[➡️ Przejdź do panelu kontrolnego](${url})`, ephemeral: true });
}

async function handleBoardScheduledPreview(interaction, sharedState) {
    const { przypomnieniaMenedzer, logger } = sharedState;

    const scheduledId = interaction.customId.replace('scheduled_preview_', '');
    const scheduled = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);

    if (!scheduled || !scheduled.template) {
        await interaction.reply({ content: '❌ Nie znaleziono przypomnienia lub szablonu.', ephemeral: true });
        return;
    }

    try {
        const template = scheduled.template;
        let content = '';
        const embeds = [];

        if (scheduled.roles && scheduled.roles.length > 0) {
            content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n\n';
        }

        if (template.type === 'text') {
            content += template.text;
        } else if (template.type === 'embed') {
            const embed = new EmbedBuilder()
                .setDescription(template.embedDescription)
                .setTimestamp();

            if (template.embedTitle) embed.setTitle(template.embedTitle);
            if (template.embedIcon) embed.setThumbnail(template.embedIcon);
            if (template.embedImage) embed.setImage(template.embedImage);
            embeds.push(embed);
        }

        await interaction.reply({ content: content || undefined, embeds, ephemeral: true });

        logger.info(`Podgląd przypomnienia ${scheduledId} przez ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error in handleBoardScheduledPreview:', error);
        await interaction.reply({ content: '❌ Błąd podczas generowania podglądu.', ephemeral: true });
    }
}

async function handleBoardScheduledSend(interaction, sharedState) {
    const { przypomnieniaMenedzer, logger, client } = sharedState;

    await interaction.deferUpdate();

    const scheduledId = interaction.customId.replace('scheduled_send_', '');
    const scheduled = przypomnieniaMenedzer.getScheduledWithTemplate(scheduledId);

    if (!scheduled || !scheduled.template) {
        await interaction.followUp({ content: '❌ Nie znaleziono przypomnienia lub szablonu.', ephemeral: true });
        return;
    }

    try {
        const channel = await client.channels.fetch(scheduled.channelId);
        if (!channel) {
            await interaction.followUp({ content: '❌ Nie znaleziono kanału docelowego.', ephemeral: true });
            return;
        }

        let content = '';
        const embeds = [];

        if (scheduled.roles && scheduled.roles.length > 0) {
            content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n\n';
        }

        const template = scheduled.template;
        if (template.type === 'text') {
            content += template.text;
        } else if (template.type === 'embed') {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

            const embed = new EmbedBuilder()
                .setDescription(template.embedDescription)
                .setFooter({ text: `Wysłał ${interaction.user.displayName} • ${timeStr}` });

            if (template.embedTitle) embed.setTitle(template.embedTitle);
            if (template.embedIcon) embed.setThumbnail(template.embedIcon);
            if (template.embedImage) embed.setImage(template.embedImage);
            embeds.push(embed);
        }

        await channel.send({ content, embeds });

        logger.info(`Testowe wysłanie przypomnienia ${scheduledId} przez ${interaction.user.tag}`);
    } catch (error) {
        logger.error('Error in handleBoardScheduledSend:', error);
        await interaction.followUp({ content: '❌ Błąd podczas wysyłania przypomnienia.', ephemeral: true });
    }
}

async function handleBoardScheduledEdit(interaction, sharedState) {
    const { przypomnieniaMenedzer } = sharedState;

    const scheduledId = interaction.customId.replace('scheduled_edit_', '');
    const scheduled = przypomnieniaMenedzer.getScheduled(scheduledId);

    if (!scheduled) {
        await interaction.reply({
            content: '❌ Nie znaleziono zaplanowanego przypomnienia.',
            ephemeral: true
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_scheduled_modal_${scheduledId}`)
        .setTitle('Edytuj zaplanowane przypomnienie');

    const formattedDate = new Date(scheduled.firstTrigger).toLocaleString('sv-SE', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).replace(',', '');

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('Pierwsze wyzwolenie (RRRR-MM-DD GG:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(formattedDate)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setValue(scheduled.interval ?? '')
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
                .setLabel('Tak, usuń')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId(`cancel_delete_${scheduledId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.reply({
        content: '⚠️ **Czy na pewno chcesz usunąć to zaplanowane przypomnienie?**',
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
            content: '❌ Event nie znaleziony.',
            components: []
        });
        return;
    }

    // Show confirmation
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_event_${eventId}`)
                .setLabel('Potwierdź usunięcie')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('✔️'),
            new ButtonBuilder()
                .setCustomId('cancel_delete_event')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('✖️')
        );

    await interaction.update({
        content: `⚠️ **Czy na pewno chcesz usunąć ten event?**\n\n📅 **Nazwa:** ${event.name}\n🆔 **ID:** ${event.id}\n⏰ **Następne wyzwolenie:** <t:${Math.floor(new Date(event.nextTrigger).getTime() / 1000)}:F>`,
        components: [row]
    });
}

async function handleEditEventSelect(interaction, sharedState) {
    const { eventMenedzer } = sharedState;

    const eventId = interaction.values[0];
    const event = eventMenedzer.getEvent(eventId);

    if (!event) {
        await interaction.update({
            content: '❌ Event nie znaleziony.',
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
        .setLabel('Nazwa/opis eventu')
        .setStyle(TextInputStyle.Short)
        .setValue(event.name)
        .setRequired(false)
        .setMaxLength(100);

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('Pierwsze wyzwolenie (RRRR-MM-DD GG:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(new Date(event.firstTrigger).toLocaleString('sv-SE', {
            timeZone: 'Europe/Warsaw',
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
        .setValue(event.interval ?? '')
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
        .setPlaceholder('Wybierz kanał dla listy eventów')
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
        .setLabel('Nazwa/opis eventu')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('np. Spawn Bossa, Spotkanie')
        .setRequired(false)
        .setMaxLength(100);

    const firstTriggerInput = new TextInputBuilder()
        .setCustomId('firstTrigger')
        .setLabel('Pierwsze wyzwolenie (RRRR-MM-DD GG:MM)')
        .setStyle(TextInputStyle.Short)
        .setValue(currentTime)
        .setRequired(false);

    const intervalInput = new TextInputBuilder()
        .setCustomId('interval')
        .setLabel('Interwał powtarzania (opcjonalnie)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Puste = jednorazowe, lub: 1s, 1m, 1h, 1d (max 90d), ee, msc')
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
            content: '❌ Brak eventów do usunięcia.',
            ephemeral: true
        });
        return;
    }

    // Show select menu with events
    const options = events.map(e => ({
        label: e.name.substring(0, 100),
        description: `Następny: ${new Date(e.nextTrigger).toLocaleDateString('pl-PL')}`,
        value: e.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('delete_event_select')
        .setPlaceholder('Wybierz event do usunięcia')
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
            content: '❌ Brak eventów do edycji.',
            ephemeral: true
        });
        return;
    }

    // Show select menu with events
    const options = events.map(e => ({
        label: e.name.substring(0, 100),
        description: `Następny: ${new Date(e.nextTrigger).toLocaleDateString('pl-PL')}`,
        value: e.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('edit_event_select')
        .setPlaceholder('Wybierz event do edycji')
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
