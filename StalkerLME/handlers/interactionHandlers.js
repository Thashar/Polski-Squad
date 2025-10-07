const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const messages = require('../config/messages');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

const confirmationData = new Map();

async function handleInteraction(interaction, sharedState, config) {
    const { client, databaseService, ocrService, punishmentService, reminderService, survivorService, phaseService } = sharedState;

    try {
        if (interaction.isCommand()) {
            await handleSlashCommand(interaction, sharedState);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction, config, reminderService, sharedState);
        } else if (interaction.isButton()) {
            await handleButton(interaction, sharedState);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction, sharedState);
        }
    } catch (error) {
        logger.error('[INTERACTION] ❌ Błąd obsługi interakcji:', error);
        logger.error('[INTERACTION] ❌ Error message:', error?.message);
        logger.error('[INTERACTION] ❌ Stack trace:', error?.stack);
        logger.error('[INTERACTION] ❌ Full error object:', JSON.stringify(error, null, 2));
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Wystąpił błąd')
            .setDescription(messages.errors.unknownError)
            .setColor('#FF0000')
            .setTimestamp();
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }
}

async function handleSlashCommand(interaction, sharedState) {
    const { config, databaseService, ocrService, punishmentService, reminderService, survivorService, phaseService } = sharedState;

    // Sprawdź uprawnienia dla wszystkich komend oprócz /decode i /wyniki
    const publicCommands = ['decode', 'wyniki'];
    if (!publicCommands.includes(interaction.commandName) && !hasPermission(interaction.member, config.allowedPunishRoles)) {
        await interaction.reply({ content: messages.errors.noPermission, flags: MessageFlags.Ephemeral });
        return;
    }

    switch (interaction.commandName) {
        case 'punish':
            await handlePunishCommand(interaction, config, ocrService, punishmentService);
            break;
        case 'remind':
            await handleRemindCommand(interaction, config, ocrService, reminderService);
            break;
        case 'punishment':
            await handlePunishmentCommand(interaction, config, databaseService, punishmentService);
            break;
        case 'points':
            await handlePointsCommand(interaction, config, databaseService, punishmentService);
            break;
        case 'debug-roles':
            await handleDebugRolesCommand(interaction, config);
            break;
        case 'ocr-debug':
            await handleOcrDebugCommand(interaction, config);
            break;
        case 'decode':
            await handleDecodeCommand(interaction, sharedState);
            break;
        case 'faza1':
            await handlePhase1Command(interaction, sharedState);
            break;
        case 'wyniki':
            await handleWynikiCommand(interaction, sharedState);
            break;
        case 'modyfikuj':
            await handleModyfikujCommand(interaction, sharedState);
            break;
        case 'dodaj':
            await handleDodajCommand(interaction, sharedState);
            break;
        case 'faza2':
            await handlePhase2Command(interaction, sharedState);
            break;
        default:
            await interaction.reply({ content: 'Nieznana komenda!', flags: MessageFlags.Ephemeral });
    }
}

async function handlePunishCommand(interaction, config, ocrService, punishmentService) {
    const attachment = interaction.options.getAttachment('image');
    
    if (!attachment) {
        await interaction.reply({ content: messages.errors.noImage, flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: messages.errors.invalidImage, flags: MessageFlags.Ephemeral });
        return;
    }
    
    try {
        // Najpierw odpowiedz z informacją o rozpoczęciu analizy
        await interaction.reply({ content: '🔍 Odświeżam cache członków i analizuję zdjęcie...', flags: MessageFlags.Ephemeral });
        
        // Odśwież cache członków przed analizą
        logger.info('🔄 Odświeżanie cache\'u członków dla komendy /punish...');
        await interaction.guild.members.fetch();
        logger.info('✅ Cache członków odświeżony');
        
        const text = await ocrService.processImage(attachment);
        const zeroScorePlayers = await ocrService.extractPlayersFromText(text, interaction.guild, interaction.member);
        
        if (zeroScorePlayers.length === 0) {
            await interaction.editReply('Nie znaleziono graczy z wynikiem 0 na obrazie.');
            return;
        }
        
        // Sprawdź urlopy przed potwierdzeniem (tylko dla punish)
        await checkVacationsBeforeConfirmation(interaction, zeroScorePlayers, attachment.url, config, punishmentService, text);
        
    } catch (error) {
        logger.error('[PUNISH] ❌ Błąd komendy /punish:', error);
        await interaction.editReply({ content: messages.errors.ocrError });
    }
}

async function handleRemindCommand(interaction, config, ocrService, reminderService) {
    const attachment = interaction.options.getAttachment('image');
    
    if (!attachment) {
        await interaction.reply({ content: messages.errors.noImage, flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: messages.errors.invalidImage, flags: MessageFlags.Ephemeral });
        return;
    }
    
    try {
        // Najpierw odpowiedz z informacją o rozpoczęciu analizy
        await interaction.reply({ content: '🔍 Odświeżam cache członków i analizuję zdjęcie...', flags: MessageFlags.Ephemeral });
        
        // Odśwież cache członków przed analizą
        logger.info('🔄 Odświeżanie cache\'u członków dla komendy /remind...');
        await interaction.guild.members.fetch();
        logger.info('✅ Cache członków odświeżony');
        
        const text = await ocrService.processImage(attachment);
        const zeroScorePlayers = await ocrService.extractPlayersFromText(text, interaction.guild, interaction.member);
        
        if (zeroScorePlayers.length === 0) {
            await interaction.editReply('Nie znaleziono graczy z wynikiem 0 na obrazie.');
            return;
        }
        
        // Konwertuj nicki na obiekty z członkami dla reminderService
        const foundUserObjects = [];
        for (const nick of zeroScorePlayers) {
            const member = interaction.guild.members.cache.find(m => 
                m.displayName.toLowerCase() === nick.toLowerCase() || 
                m.user.username.toLowerCase() === nick.toLowerCase()
            );
            if (member) {
                foundUserObjects.push({ member: member, matchedName: nick });
            }
        }
        
        // Generowanie unikalnego ID dla potwierdzenia
        const confirmationId = Date.now().toString();
        
        // Zapisanie danych do mapy
        confirmationData.set(confirmationId, {
            action: 'remind',
            foundUsers: foundUserObjects, // Obiekty z właściwością member
            zeroScorePlayers: zeroScorePlayers, // Oryginalne nicki dla wyświetlenia
            imageUrl: attachment.url,
            originalUserId: interaction.user.id,
            config: config,
            reminderService: reminderService
        });
        
        // Usunięcie danych po 5 minut
        setTimeout(() => {
            confirmationData.delete(confirmationId);
        }, 5 * 60 * 1000);
        
        // Tworzenie przycisków
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_remind_${confirmationId}`)
            .setLabel('✅ Tak')
            .setStyle(ButtonStyle.Success);
        
        const cancelButton = new ButtonBuilder()
            .setCustomId(`cancel_remind_${confirmationId}`)
            .setLabel('❌ Nie')
            .setStyle(ButtonStyle.Danger);
        
        const row = new ActionRowBuilder()
            .addComponents(confirmButton, cancelButton);
        
        const confirmationEmbed = new EmbedBuilder()
            .setTitle('🔍 Potwierdzenie wysłania przypomnienia')
            .setDescription('Czy chcesz wysłać przypomnienie o bossie dla znalezionych graczy?')
            .setColor('#ffa500')
            .addFields(
                { name: `✅ Znaleziono ${zeroScorePlayers.length} graczy z wynikiem ZERO`, value: `\`${zeroScorePlayers.join(', ')}\``, inline: false }
            )
            .setImage(attachment.url)
            .setTimestamp()
            .setFooter({ text: `Żądanie od ${interaction.user.tag} | Potwierdź lub anuluj w ciągu 5 minut` });
        
        await interaction.editReply({ 
            embeds: [confirmationEmbed],
            components: [row]
        });
        
    } catch (error) {
        logger.error('[REMIND] ❌ Błąd komendy /remind:', error);
        await interaction.editReply({ content: messages.errors.ocrError });
    }
}

async function handlePunishmentCommand(interaction, config, databaseService, punishmentService) {
    const category = interaction.options.getString('category');
    const roleId = config.targetRoles[category];
    
    if (!roleId) {
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', flags: MessageFlags.Ephemeral });
        return;
    }
    
    await interaction.deferReply();
    
    // Odśwież cache członków przed sprawdzeniem rankingu
    try {
        logger.info('🔄 Odświeżanie cache\'u członków dla punishment...');
        await interaction.guild.members.fetch();
        logger.info('✅ Cache członków odświeżony');
    } catch (error) {
        logger.error('❌ Błąd odświeżania cache\'u:', error);
    }
    
    try {
        const ranking = await punishmentService.getRankingForRole(interaction.guild, roleId);
        const roleName = config.roleDisplayNames[category];
        
        let rankingText = '';
        if (ranking.length === 0) {
            rankingText = 'Brak użytkowników z punktami karnymi w tej kategorii.';
        } else {
            for (let i = 0; i < ranking.length && i < 10; i++) {
                const user = ranking[i];
                const punishmentEmoji = user.points >= 2 ? '🎭' : '';
                rankingText += `${i + 1}. ${user.member.displayName} - ${user.points} punktów ${punishmentEmoji}\n`;
            }
        }
        
        
        // Następne usuwanie punktów
        const nextMonday = new Date();
        nextMonday.setDate(nextMonday.getDate() + (7 - nextMonday.getDay()) % 7);
        if (nextMonday.getDay() !== 1) {
            nextMonday.setDate(nextMonday.getDate() + 1);
        }
        nextMonday.setHours(0, 0, 0, 0);
        const nextRemovalText = `${nextMonday.toLocaleDateString('pl-PL')} o 00:00`;
        
        // Kanał ostrzeżeń
        const warningChannelId = config.warningChannels[roleId];
        const warningChannel = interaction.guild.channels.cache.get(warningChannelId);
        const warningChannelText = warningChannel ? `<#${warningChannelId}>` : 'Nie znaleziono kanału';
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 Ranking Punktów Karnych`)
            .setDescription(`**Kategoria:** ${roleName}\n\n${rankingText}`)
            .setColor('#ff6b6b')
            .addFields(
                { name: '⏰ Następne usuwanie punktów', value: nextRemovalText, inline: false },
                { name: '🎭 Rola karania (2+ punktów)', value: `<@&${config.punishmentRoleId}>`, inline: false },
                { name: '🚨 Rola zakazu loterii (3+ punktów)', value: `<@&${config.lotteryBanRoleId}>`, inline: false },
                { name: '📢 Kanał ostrzeżeń', value: warningChannelText, inline: false },
                { name: '⚖️ Zasady', value: '2+ punktów = rola karania\n3+ punktów = zakaz loterii\n< 2 punktów = brak roli\nOstrzeżenia: 2 i 3 punkty', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Kategoria: ${category} | Co tydzień w poniedziałek o północy usuwany jest 1 punkt każdemu (${config.timezone})` });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        logger.error('[PUNISHMENT] ❌ Błąd komendy /punishment:', error);
        await interaction.editReply({ content: messages.errors.databaseError });
    }
}

async function handlePointsCommand(interaction, config, databaseService, punishmentService) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    
    await interaction.deferReply();
    
    try {
        if (amount === null || amount === undefined) {
            // Usuń użytkownika z systemu
            await databaseService.deleteUser(interaction.guild.id, user.id);
            await interaction.editReply({ content: `✅ Usunięto użytkownika ${user} z systemu punktów karnych.` });
        } else if (amount > 0) {
            // Dodaj punkty
            await punishmentService.addPointsManually(interaction.guild, user.id, amount);
            await interaction.editReply({ content: `✅ Dodano ${amount} punktów dla ${user}.` });
        } else if (amount < 0) {
            // Usuń punkty
            await punishmentService.removePointsManually(interaction.guild, user.id, Math.abs(amount));
            await interaction.editReply({ content: `✅ Usunięto ${Math.abs(amount)} punktów dla ${user}.` });
        } else {
            // amount === 0
            const userData = await databaseService.getUserPunishments(interaction.guild.id, user.id);
            await interaction.editReply({ content: `${user} ma obecnie ${userData.points} punktów karnych.` });
        }
    } catch (error) {
        logger.error('[POINTS] ❌ Błąd komendy /points:', error);
        await interaction.editReply({ content: messages.errors.databaseError });
    }
}

async function handleDebugRolesCommand(interaction, config) {
    const category = interaction.options.getString('category');
    const roleId = config.targetRoles[category];
    
    if (!roleId) {
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', flags: MessageFlags.Ephemeral });
        return;
    }
    
    await interaction.deferReply();
    
    // Odśwież cache członków przed sprawdzeniem ról
    try {
        logger.info('🔄 Odświeżanie cache\'u członków dla debug-roles...');
        await interaction.guild.members.fetch();
        logger.info('✅ Cache członków odświeżony');
    } catch (error) {
        logger.error('❌ Błąd odświeżania cache\'u:', error);
    }
    
    try {
        const role = interaction.guild.roles.cache.get(roleId);
        const roleName = config.roleDisplayNames[category];
        
        if (!role) {
            await interaction.editReply({ content: 'Nie znaleziono roli!', flags: MessageFlags.Ephemeral });
            return;
        }
        
        // Pobierz wszystkich członków z daną rolą
        const members = role.members;
        let membersList = '';
        
        if (members.size === 0) {
            membersList = 'Brak członków z tą rolą.';
        } else {
            const sortedMembers = members.sort((a, b) => a.displayName.localeCompare(b.displayName));
            let count = 0;
            for (const [userId, member] of sortedMembers) {
                if (count >= 50) { // Limit dla embed
                    membersList += `\n... i ${members.size - count} więcej`;
                    break;
                }
                membersList += `${count + 1}. ${member.displayName}\n`;
                count++;
            }
        }
        
        // Informacje o roli karania
        const punishmentRole = interaction.guild.roles.cache.get(config.punishmentRoleId);
        const punishmentRoleInfo = punishmentRole ? `<@&${config.punishmentRoleId}>` : 'Nie znaleziono';
        
        // Kanał ostrzeżeń
        const warningChannelId = config.warningChannels[roleId];
        const warningChannel = interaction.guild.channels.cache.get(warningChannelId);
        const warningChannelInfo = warningChannel ? `<#${warningChannelId}>` : 'Nie znaleziono';
        
        const embed = new EmbedBuilder()
            .setTitle(`🔧 Debug - ${roleName}`)
            .setDescription(`**Rola:** <@&${roleId}>\n**ID Roli:** ${roleId}\n**Liczba członków:** ${members.size}`)
            .addFields(
                { name: '👥 Członkowie', value: membersList.length > 1024 ? membersList.substring(0, 1020) + '...' : membersList, inline: false },
                { name: '🎭 Rola karania (2+ pkt)', value: punishmentRoleInfo, inline: true },
                { name: '🚨 Rola blokady loterii (3+ pkt)', value: `<@&${config.lotteryBanRoleId}>`, inline: true },
                { name: '📢 Kanał ostrzeżeń', value: warningChannelInfo, inline: true },
                { name: '⚙️ Konfiguracja', value: `Kategoria: ${category}\nStrefa czasowa: ${config.timezone}\nDeadline bossa: ${config.bossDeadline.hour}:${config.bossDeadline.minute.toString().padStart(2, '0')}`, inline: false }
            )
            .setColor('#0099FF')
            .setTimestamp()
            .setFooter({ text: `Debug wykonany przez ${interaction.user.tag}` });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        logger.error('[DEBUG] ❌ Błąd komendy /debug-roles:', error);
        await interaction.editReply({ content: 'Wystąpił błąd podczas debugowania ról.' });
    }
}

async function handleSelectMenu(interaction, config, reminderService, sharedState) {
    if (interaction.customId === 'reminder_role_select') {
        const selectedRole = interaction.values[0];
        const roleId = config.targetRoles[selectedRole];

        if (!roleId) {
            await interaction.reply({ content: 'Nieprawidłowa rola!', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply();

        try {
            await reminderService.sendBulkReminder(interaction.guild, roleId);
            await interaction.editReply({ content: `✅ Wysłano przypomnienie do roli ${config.roleDisplayNames[selectedRole]}` });
        } catch (error) {
            logger.error('[REMINDER] ❌ Błąd wysyłania przypomnienia:', error);
            await interaction.editReply({ content: messages.errors.unknownError });
        }
    } else if (interaction.customId === 'wyniki_select_clan') {
        await handleWynikiClanSelect(interaction, sharedState);
    } else if (interaction.customId === 'wyniki_select_week') {
        await handleWynikiWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_clan|')) {
        await handleModyfikujClanSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_round|')) {
        await handleModyfikujRoundSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_week_')) {
        await handleModyfikujWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_player_')) {
        await handleModyfikujPlayerSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_week|')) {
        await handleDodajWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_round|')) {
        await handleDodajRoundSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_user|')) {
        await handleDodajUserSelect(interaction, sharedState);
    }
}

async function handleButton(interaction, sharedState) {
    const { config, databaseService, punishmentService, survivorService, phaseService } = sharedState;

    // Obsługa przycisków paginacji buildów
    if (interaction.customId === 'statystyki_page' || interaction.customId === 'ekwipunek_page' || interaction.customId === 'tech_party_page' || interaction.customId === 'survivor_page' || interaction.customId === 'legend_colls_page' || interaction.customId === 'epic_colls_page' || interaction.customId === 'custom_sets_page' || interaction.customId === 'pets_page') {
        if (!sharedState.buildPagination) {
            await interaction.reply({ content: '❌ Sesja paginacji wygasła.', flags: MessageFlags.Ephemeral });
            return;
        }

        const paginationData = sharedState.buildPagination.get(interaction.message.id);
        if (!paginationData) {
            await interaction.reply({ content: '❌ Nie znaleziono danych paginacji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Wszyscy użytkownicy mogą zmieniać strony

        // Ustaw nową stronę na podstawie przycisku
        let newPage = paginationData.currentPage;
        if (interaction.customId === 'statystyki_page') {
            newPage = 0;
        } else if (interaction.customId === 'ekwipunek_page') {
            newPage = 1;
        } else if (interaction.customId === 'tech_party_page') {
            newPage = 2;
        } else if (interaction.customId === 'survivor_page') {
            newPage = 3;
        } else if (interaction.customId === 'legend_colls_page') {
            newPage = 4;
        } else if (interaction.customId === 'epic_colls_page') {
            newPage = 5;
        } else if (interaction.customId === 'custom_sets_page') {
            newPage = 6;
        } else if (interaction.customId === 'pets_page') {
            newPage = 7;
        }

        // Aktualizuj dane paginacji
        paginationData.currentPage = newPage;
        const navigationButtons = survivorService.createNavigationButtons(newPage);

        await interaction.update({
            embeds: [paginationData.embeds[newPage]],
            components: navigationButtons
        });
        return;
    }

    // Obsługa przycisku "Usuń" dla embedów buildu
    if (interaction.customId === 'delete_embed') {
        // Po restarcie bota nie ma danych paginacji w RAM, ale wiadomość nadal istnieje
        // Pozwól na usunięcie wiadomości jeśli użytkownik jest jej właścicielem (sprawdź przez embed footer lub inne metody)

        let canDelete = false;
        let userId = null;

        // Sprawdź czy mamy dane paginacji w pamięci
        if (sharedState.buildPagination && sharedState.buildPagination.has(interaction.message.id)) {
            const paginationData = sharedState.buildPagination.get(interaction.message.id);
            userId = paginationData.userId;
            canDelete = interaction.user.id === userId;
        } else {
            // Po restarcie nie ma danych w RAM, ale sprawdź czy wiadomość jest w pliku zaplanowanych usunięć
            const scheduledMessages = sharedState.messageCleanupService.scheduledMessages || [];
            const scheduledMessage = scheduledMessages.find(msg => msg.messageId === interaction.message.id);

            if (scheduledMessage) {
                // Sprawdź czy użytkownik jest właścicielem (jeśli mamy zapisane userId)
                if (scheduledMessage.userId && scheduledMessage.userId === interaction.user.id) {
                    canDelete = true;
                } else if (!scheduledMessage.userId) {
                    // Dla starszych wiadomości bez userId, pozwól każdemu usunąć
                    canDelete = true;
                }
            }
        }

        if (!canDelete) {
            await interaction.reply({
                content: '❌ Tylko właściciel embeda może go usunąć lub sesja paginacji wygasła.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Usuń embed i dane paginacji
        try {
            // Usuń zaplanowane automatyczne usuwanie z pliku
            await sharedState.messageCleanupService.removeScheduledMessage(interaction.message.id);

            // Usuń wiadomość
            await interaction.message.delete();

            // Usuń dane paginacji z pamięci
            sharedState.buildPagination.delete(interaction.message.id);

            logger.info(`🗑️ Embed buildu został usunięty przez ${interaction.user.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd usuwania embeda: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas usuwania embeda.',
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    if (interaction.customId === 'vacation_request') {
        // Obsługa przycisku "Zgłoś urlop"
        await sharedState.vacationService.handleVacationRequest(interaction);
        return;
    } else if (interaction.customId.startsWith('vacation_submit_')) {
        // Obsługa przycisku "Złóż wniosek o urlop"
        await sharedState.vacationService.handleVacationSubmit(interaction);
        return;
    } else if (interaction.customId.startsWith('vacation_cancel_')) {
        // Obsługa przycisku "Nie otwieraj wniosku"
        await sharedState.vacationService.handleVacationCancel(interaction);
        return;
    } else if (interaction.customId.startsWith('confirm_')) {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const confirmationId = parts[2];
        
        const data = confirmationData.get(confirmationId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane potwierdzenia wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        // Sprawdź czy użytkownik ma prawo do potwierdzenia
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(confirmationId);
        
        try {
            switch (action) {
                case 'punish':
                    const results = await data.punishmentService.processPunishments(interaction.guild, data.foundUsers);
                    
                    // Zaktualizuj ephemeral message z potwierdzeniem
                    const punishConfirmation = new EmbedBuilder()
                        .setTitle('✅ Punkty karne dodane')
                        .setDescription('Pomyślnie dodano punkty karne dla znalezionych graczy.')
                        .setColor('#00ff00')
                        .setTimestamp()
                        .setFooter({ text: `Wykonano przez ${interaction.user.tag}` });
                    
                    await interaction.update({ 
                        embeds: [punishConfirmation],
                        components: []
                    });
                    
                    // Oryginalny embed format dla publicznej wiadomości
                    const processedUsers = [];
                    let addedPoints = 0;
                    
                    for (const result of results) {
                        const warningEmoji = result.points === 2 || result.points === 3 ? '📢' : '';
                        const punishmentEmoji = result.points >= 2 ? '🎭' : '';
                        processedUsers.push(`${result.user} - ${result.points} punktów ${punishmentEmoji}${warningEmoji}`);
                        addedPoints += 1;
                    }
                    
                    const targetMembers = interaction.guild.members.cache.filter(member => 
                        Object.values(data.config.targetRoles).some(roleId => member.roles.cache.has(roleId))
                    );
                    
                    // Wyślij publiczny embed z pełnym podsumowaniem
                    const punishEmbed = new EmbedBuilder()
                        .setTitle('📊 Analiza Zakończona')
                        .setColor('#ff6b6b')
                        .addFields(
                            { name: '📷 Znaleziono graczy z wynikiem 0', value: `\`${data.zeroScorePlayers.join(', ')}\``, inline: false },
                            { name: '✅ Dopasowano i dodano punkty', value: processedUsers.length > 0 ? processedUsers.join('\n') : 'Brak', inline: false },
                            { name: '📈 Dodano punktów', value: addedPoints.toString(), inline: true },
                            { name: '🎭 Rola karania (2+ pkt)', value: `<@&${data.config.punishmentRoleId}>`, inline: true },
                            { name: '🚨 Rola karania (3+ pkt)', value: `<@&${data.config.lotteryBanRoleId}>`, inline: true }
                        )
                        .setImage(data.imageUrl)
                        .setTimestamp()
                        .setFooter({ text: `Przeanalizowano przez ${interaction.user.tag} | 🎭 = rola karania (2+ pkt) | 🚨 = rola karania (3+ pkt) | 📢 = ostrzeżenie wysłane` });
                    
                    await interaction.followUp({ 
                        embeds: [punishEmbed],
                        ephemeral: false
                    });
                    break;
                case 'remind':
                    const reminderResult = await data.reminderService.sendReminders(interaction.guild, data.foundUsers);
                    
                    // Zaktualizuj ephemeral message z potwierdzeniem
                    const confirmationSuccess = new EmbedBuilder()
                        .setTitle('✅ Przypomnienie wysłane')
                        .setDescription('Pomyślnie wysłano przypomnienia dla znalezionych graczy.')
                        .setColor('#00ff00')
                        .setTimestamp()
                        .setFooter({ text: `Wykonano przez ${interaction.user.tag}` });
                    
                    await interaction.update({ 
                        embeds: [confirmationSuccess],
                        components: []
                    });
                    
                    // Oblicz czas do deadline
                    const now = new Date();
                    const polandTime = new Date(now.toLocaleString('en-US', { timeZone: data.config.timezone }));
                    const deadline = new Date(polandTime);
                    deadline.setHours(data.config.bossDeadline.hour, data.config.bossDeadline.minute, 0, 0);
                    
                    if (polandTime >= deadline) {
                        deadline.setDate(deadline.getDate() + 1);
                    }
                    
                    const timeDiff = deadline - polandTime;
                    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
                    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                    
                    let timeDisplay = '';
                    if (timeDiff > 0) {
                        if (hours > 0) {
                            timeDisplay = `${hours}h ${minutes}m`;
                        } else {
                            timeDisplay = `${minutes}m`;
                        }
                    } else {
                        timeDisplay = 'Deadline minął!';
                    }
                    
                    const matchedUsers = data.foundUsers.map(user => `${user.member} (${user.matchedName})`);
                    
                    // Wyślij publiczny embed z pełnym podsumowaniem
                    const reminderEmbed = new EmbedBuilder()
                        .setTitle('📢 Przypomnienie Wysłane')
                        .setColor('#ffa500')
                        .addFields(
                            { name: '📷 Znaleziono graczy z wynikiem 0', value: `\`${data.zeroScorePlayers.join(', ')}\``, inline: false },
                            { name: '📢 Wysłano przypomnienia dla', value: matchedUsers.length > 0 ? matchedUsers.join('\n') : 'Brak', inline: false },
                            { name: '⏰ Pozostały czas do 17:50', value: timeDisplay, inline: true },
                            { name: '📤 Wysłano wiadomości', value: reminderResult.sentMessages.toString(), inline: true },
                            { name: '📢 Na kanały', value: reminderResult.roleGroups.toString(), inline: true }
                        )
                        .setImage(data.imageUrl)
                        .setTimestamp()
                        .setFooter({ text: `Przypomnienie wysłane przez ${interaction.user.tag} | Boss deadline: 17:50` });
                    
                    await interaction.followUp({ 
                        embeds: [reminderEmbed],
                        ephemeral: false
                    });
                    break;
            }
        } catch (error) {
            logger.error('[CONFIRM] ❌ Błąd potwierdzenia:', error.message);
            logger.error('[CONFIRM] ❌ Stack trace:', error.stack);
            await interaction.followUp({ content: messages.errors.unknownError, flags: MessageFlags.Ephemeral });
        }
    } else if (interaction.customId.startsWith('vacation_')) {
        const parts = interaction.customId.split('_');
        const choice = parts[1]; // 'yes' lub 'no'
        const vacationId = parts[2];
        
        const data = confirmationData.get(vacationId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(vacationId);
        
        let finalPlayers = data.allPlayers;
        
        if (choice === 'no') {
            // Usuń urlopowiczów z listy
            finalPlayers = data.allPlayers.filter(player => !data.playersWithVacation.includes(player));
            logger.info(`🏖️ Usunięto urlopowiczów z listy: ${data.playersWithVacation.join(', ')}`);
        } else {
            logger.info(`🏖️ Urlopowicze zostają w liście: ${data.playersWithVacation.join(', ')}`);
        }
        
        if (finalPlayers.length === 0) {
            await interaction.update({
                content: 'Brak graczy do ukarania po wykluczeniu urlopowiczów.',
                components: []
            });
            return;
        }
        
        // Sprawdź niepewne wyniki przed finalnym potwierdzeniem
        await checkUncertainResultsWithUpdate(interaction, finalPlayers, data.imageUrl, data.config, data.punishmentService, data.ocrText);
    } else if (interaction.customId.startsWith('uncertainty_')) {
        const parts = interaction.customId.split('_');
        const choice = parts[1]; // 'yes' lub 'no'
        const uncertaintyId = parts[2];
        
        const data = confirmationData.get(uncertaintyId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(uncertaintyId);
        
        let finalPlayers = data.allPlayers;
        
        if (choice === 'no') {
            // Usuń niepewne wyniki z listy
            finalPlayers = data.allPlayers.filter(player => !data.uncertainPlayers.includes(player));
            logger.info(`❓ Usunięto niepewne wyniki z listy: ${data.uncertainPlayers.join(', ')}`);
        } else {
            logger.info(`❓ Niepewne wyniki zostają w liście: ${data.uncertainPlayers.join(', ')}`);
        }
        
        if (finalPlayers.length === 0) {
            await interaction.update({
                content: 'Brak graczy do ukarania po wykluczeniu niepewnych wyników.',
                components: []
            });
            return;
        }
        
        // Przejdź do finalnego potwierdzenia
        await showFinalConfirmationWithUpdate(interaction, finalPlayers, data.imageUrl, data.config, data.punishmentService);
        
    } else if (interaction.customId.startsWith('cancel_')) {
        const parts = interaction.customId.split('_');
        const confirmationId = parts[2];
        
        const data = confirmationData.get(confirmationId);
        
        if (data && data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją anulować.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(confirmationId);
        
        await interaction.update({
            content: '❌ Akcja została anulowana.',
            components: [],
            embeds: []
        });
    } else if (interaction.customId === 'phase1_overwrite_yes' || interaction.customId === 'phase1_overwrite_no') {
        // Obsługa przycisków nadpisywania danych Phase 1
        await handlePhase1OverwriteButton(interaction, sharedState);
    } else if (interaction.customId === 'phase1_complete_yes' || interaction.customId === 'phase1_complete_no' || interaction.customId === 'phase1_cancel_session') {
        // Obsługa przycisków potwierdzenia zakończenia dodawania zdjęć i anulowania
        await handlePhase1CompleteButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase1_resolve_')) {
        // Obsługa przycisków rozstrzygania konfliktów
        await handlePhase1ConflictResolveButton(interaction, sharedState);
    } else if (interaction.customId === 'phase1_confirm_save' || interaction.customId === 'phase1_cancel_save') {
        // Obsługa przycisków finalnego potwierdzenia zapisu
        await handlePhase1FinalConfirmButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_confirm_') || interaction.customId === 'modyfikuj_cancel') {
        await handleModyfikujConfirmButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_page_prev|') || interaction.customId.startsWith('modyfikuj_page_next|')) {
        await handleModyfikujPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_week_prev|') || interaction.customId.startsWith('modyfikuj_week_next|')) {
        await handleModyfikujWeekPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_weeks_prev|') || interaction.customId.startsWith('wyniki_weeks_next|')) {
        await handleWynikiWeekPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_phase2_view|')) {
        await handleWynikiPhase2ViewButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_view|')) {
        await handleWynikiViewButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_overwrite_')) {
        await handlePhase2OverwriteButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_complete_') || interaction.customId.startsWith('phase2_resolve_') || interaction.customId === 'phase2_cancel_session') {
        await handlePhase2CompleteButton(interaction, sharedState);
    } else if (interaction.customId === 'phase2_confirm_save' || interaction.customId === 'phase2_cancel_save') {
        await handlePhase2FinalConfirmButton(interaction, sharedState);
    } else if (interaction.customId === 'phase2_round_continue') {
        await handlePhase2RoundContinue(interaction, sharedState);
    }
}

function hasPermission(member, allowedRoles) {
    return allowedRoles.some(roleId => member.roles.cache.has(roleId));
}

function createConfirmationButtons(action) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_${action}`)
                .setLabel('Potwierdź')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`cancel_${action}`)
                .setLabel('Anuluj')
                .setStyle(ButtonStyle.Danger)
        );
}

// Funkcja do wyrejestrowania konkretnej komendy
async function unregisterCommand(client, commandName) {
    try {
        logger.info(`[COMMANDS] 🗑️ Wyrejestrowanie komendy: ${commandName}`);

        // Pobierz wszystkie komendy
        const commands = await client.application.commands.fetch();

        // Znajdź komendę do usunięcia
        const commandToDelete = commands.find(cmd => cmd.name === commandName);

        if (commandToDelete) {
            await commandToDelete.delete();
            logger.info(`[COMMANDS] ✅ Komenda ${commandName} została wyrejestrowana`);
            return true;
        } else {
            logger.info(`[COMMANDS] ⚠️ Komenda ${commandName} nie została znaleziona`);
            return false;
        }
    } catch (error) {
        logger.error(`[COMMANDS] ❌ Błąd wyrejestrowania komendy ${commandName}:`, error);
        return false;
    }
}

// Funkcja do rejestracji komend slash
async function registerSlashCommands(client) {
    const commands = [
        new SlashCommandBuilder()
            .setName('punish')
            .setDescription('Analizuj zdjęcie i znajdź graczy z wynikiem 0')
            .addAttachmentOption(option =>
                option.setName('image')
                    .setDescription('Zdjęcie do analizy')
                    .setRequired(true)
            ),
        
        new SlashCommandBuilder()
            .setName('remind')
            .setDescription('Wyślij przypomnienie o bossie dla graczy z wynikiem 0')
            .addAttachmentOption(option =>
                option.setName('image')
                    .setDescription('Zdjęcie do analizy')
                    .setRequired(true)
            ),
        
        new SlashCommandBuilder()
            .setName('punishment')
            .setDescription('Wyświetl ranking punktów karnych')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria rankingu')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('points')
            .setDescription('Dodaj lub odejmij punkty użytkownikowi')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Użytkownik')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('Liczba punktów (dodatnia = dodaj, ujemna = odejmij, puste = usuń użytkownika)')
                    .setRequired(false)
                    .setMinValue(-20)
                    .setMaxValue(20)
            ),
        
        new SlashCommandBuilder()
            .setName('debug-roles')
            .setDescription('Debugowanie ról na serwerze')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria do sprawdzenia')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('ocr-debug')
            .setDescription('Przełącz szczegółowe logowanie OCR')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                    .setRequired(false)
            ),

        new SlashCommandBuilder()
            .setName('decode')
            .setDescription('Dekoduj kod buildu Survivor.io i wyświetl dane o ekwipunku'),

        new SlashCommandBuilder()
            .setName('faza1')
            .setDescription('Zbierz i zapisz wyniki wszystkich graczy dla Fazy 1'),

        new SlashCommandBuilder()
            .setName('wyniki')
            .setDescription('Wyświetl wyniki dla wszystkich faz'),

        new SlashCommandBuilder()
            .setName('modyfikuj')
            .setDescription('Modyfikuj wynik gracza')
            .addStringOption(option =>
                option.setName('faza')
                    .setDescription('Wybierz fazę')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Faza 1', value: 'phase1' },
                        { name: 'Faza 2', value: 'phase2' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('dodaj')
            .setDescription('Dodaj nowego gracza do istniejących wyników')
            .addStringOption(option =>
                option.setName('faza')
                    .setDescription('Wybierz fazę')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Faza 1', value: 'phase1' },
                        { name: 'Faza 2', value: 'phase2' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('faza2')
            .setDescription('Zbierz i zapisz wyniki wszystkich graczy dla Fazy 2 (3 rundy)')
    ];

    try {
        await client.application.commands.set(commands);
    } catch (error) {
        logger.error('[COMMANDS] ❌ Błąd rejestracji komend:', error);
    }
}

async function checkVacationsBeforeConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService, ocrText = '') {
    const vacationChannelId = '1269726207633522740';
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    try {
        logger.info(`🏖️ Rozpoczynam sprawdzanie urlopów dla ${zeroScorePlayers.length} graczy`);
        
        const vacationChannel = await interaction.guild.channels.fetch(vacationChannelId);
        if (!vacationChannel) {
            logger.warn('Kanał urlopów nie znaleziony, pomijam sprawdzenie');
            return await showFinalConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService);
        }
        
        const playersWithVacation = [];
        
        // Sprawdź każdego gracza
        for (const playerNick of zeroScorePlayers) {
            // Znajdź członka serwera po nicku
            const members = await interaction.guild.members.fetch();
            const member = members.find(m => m.displayName.toLowerCase() === playerNick.toLowerCase());
            
            if (member) {
                // Sprawdź wiadomości na kanale urlopów
                const messages = await vacationChannel.messages.fetch({ limit: 100 });
                const userMessages = messages.filter(msg => 
                    msg.author.id === member.user.id && 
                    msg.createdAt >= oneMonthAgo
                );
                
                // Sprawdź czy któraś z wiadomości ma obecnie reakcje (sprawdzenie w czasie rzeczywistym)
                let hasActiveVacation = false;
                for (const userMsg of userMessages.values()) {
                    if (userMsg.reactions && userMsg.reactions.cache && userMsg.reactions.cache.size > 0) {
                        hasActiveVacation = true;
                        break;
                    }
                }
                
                if (hasActiveVacation) {
                    playersWithVacation.push(playerNick);
                    logger.info(`🏖️ ${playerNick} ma aktywny urlop (z reakcjami)`);
                } else if (userMessages.size > 0) {
                    logger.info(`🏖️ ${playerNick} miał urlop, ale bez reakcji - będzie uwzględniony w karach`);
                }
            }
        }
        
        if (playersWithVacation.length > 0) {
            // Pokaż pytanie o urlopowiczów
            await showVacationQuestion(interaction, playersWithVacation, zeroScorePlayers, imageUrl, config, punishmentService, ocrText);
        } else {
            // Sprawdź niepewne wyniki (© na końcu linii) przed finalnym potwierdzeniem
            await checkUncertainResults(interaction, zeroScorePlayers, imageUrl, config, punishmentService, ocrText);
        }
        
    } catch (error) {
        logger.error('❌ Błąd sprawdzania urlopów:', error.message);
        logger.error('❌ Stack trace:', error.stack);
        try {
            await showFinalConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService);
        } catch (fallbackError) {
            logger.error('❌ Błąd fallback confirmation:', fallbackError.message);
            await interaction.editReply('❌ Wystąpił błąd podczas sprawdzania urlopów.');
        }
    }
}

async function checkUncertainResults(interaction, players, imageUrl, config, punishmentService, ocrText) {
    // Sprawdź które graczy mają symbol © na końcu linii
    const uncertainPlayers = [];
    const certainPlayers = [];
    
    for (const player of players) {
        // Znajdź linię z tym graczem w tekście OCR
        const lines = ocrText.split('\n');
        let hasUncertainty = false;
        
        for (const line of lines) {
            const normalizedLine = line.toLowerCase();
            const normalizedPlayer = player.toLowerCase();
            
            if (normalizedLine.includes(normalizedPlayer) && line.trim().endsWith('©')) {
                hasUncertainty = true;
                break;
            }
        }
        
        if (hasUncertainty) {
            uncertainPlayers.push(player);
        } else {
            certainPlayers.push(player);
        }
    }
    
    if (uncertainPlayers.length > 0) {
        // Pokaż pytanie o niepewne wyniki
        await showUncertaintyQuestion(interaction, uncertainPlayers, players, imageUrl, config, punishmentService);
    } else {
        // Przejdź do normalnego potwierdzenia
        await showFinalConfirmation(interaction, players, imageUrl, config, punishmentService);
    }
}

async function checkUncertainResultsWithUpdate(interaction, players, imageUrl, config, punishmentService, ocrText) {
    // Sprawdź które graczy mają symbol © na końcu linii
    const uncertainPlayers = [];
    const certainPlayers = [];
    
    for (const player of players) {
        // Znajdź linię z tym graczem w tekście OCR
        const lines = ocrText.split('\n');
        let hasUncertainty = false;
        
        for (const line of lines) {
            const normalizedLine = line.toLowerCase();
            const normalizedPlayer = player.toLowerCase();
            
            if (normalizedLine.includes(normalizedPlayer) && line.trim().endsWith('©')) {
                hasUncertainty = true;
                break;
            }
        }
        
        if (hasUncertainty) {
            uncertainPlayers.push(player);
        } else {
            certainPlayers.push(player);
        }
    }
    
    if (uncertainPlayers.length > 0) {
        // Pokaż pytanie o niepewne wyniki
        await showUncertaintyQuestionWithUpdate(interaction, uncertainPlayers, players, imageUrl, config, punishmentService);
    } else {
        // Przejdź do normalnego potwierdzenia
        await showFinalConfirmationWithUpdate(interaction, players, imageUrl, config, punishmentService);
    }
}

async function showUncertaintyQuestion(interaction, uncertainPlayers, allPlayers, imageUrl, config, punishmentService) {
    const uncertaintyId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(uncertaintyId, {
        action: 'uncertainty_check',
        uncertainPlayers: uncertainPlayers,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(uncertaintyId);
    }, 5 * 60 * 1000);
    
    const playersText = uncertainPlayers.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`uncertainty_yes_${uncertaintyId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`uncertainty_no_${uncertaintyId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    const embed = new EmbedBuilder()
        .setTitle('❓ Niepewny wynik OCR')
        .setDescription(`Bot nie jest pewny wyniku dla: ${playersText} (wykryto symbol ©).\nCzy dodać ${uncertainPlayers.length > 1 ? 'tych graczy' : 'tego gracza'} do listy z zerami?`)
        .setColor('#FFA500')
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Sprawdź obraz i zdecyduj • Żądanie od ${interaction.user.tag}` });
    
    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function showUncertaintyQuestionWithUpdate(interaction, uncertainPlayers, allPlayers, imageUrl, config, punishmentService) {
    const uncertaintyId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(uncertaintyId, {
        action: 'uncertainty_check',
        uncertainPlayers: uncertainPlayers,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(uncertaintyId);
    }, 5 * 60 * 1000);
    
    const playersText = uncertainPlayers.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`uncertainty_yes_${uncertaintyId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`uncertainty_no_${uncertaintyId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    const embed = new EmbedBuilder()
        .setTitle('❓ Niepewny wynik OCR')
        .setDescription(`Bot nie jest pewny wyniku dla: ${playersText} (wykryto symbol ©).\nCzy dodać ${uncertainPlayers.length > 1 ? 'tych graczy' : 'tego gracza'} do listy z zerami?`)
        .setColor('#FFA500')
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Sprawdź obraz i zdecyduj • Żądanie od ${interaction.user.tag}` });
    
    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

async function showVacationQuestion(interaction, playersWithVacation, allPlayers, imageUrl, config, punishmentService, ocrText = '') {
    const vacationId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(vacationId, {
        action: 'vacation_check',
        playersWithVacation: playersWithVacation,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id,
        ocrText: ocrText
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(vacationId);
    }, 5 * 60 * 1000);
    
    const playersText = playersWithVacation.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`vacation_yes_${vacationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`vacation_no_${vacationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    await interaction.editReply({
        content: `🏖️ ${playersText} zgłaszał/a urlop w ostatnim czasie.\nCzy w takim razie dodać punkty kary?`,
        components: [row]
    });
}

async function showFinalConfirmation(interaction, finalPlayers, imageUrl, config, punishmentService) {
    const confirmationId = Date.now().toString();
    
    // Konwertuj nicki na obiekty z członkami dla punishmentService
    const foundUserObjects = [];
    for (const nick of finalPlayers) {
        const member = interaction.guild.members.cache.find(m => 
            m.displayName.toLowerCase() === nick.toLowerCase() || 
            m.user.username.toLowerCase() === nick.toLowerCase()
        );
        if (member) {
            foundUserObjects.push({ 
                userId: member.id,
                member: member, 
                matchedName: nick 
            });
        }
    }
    
    // Zapisz dane do mapy
    confirmationData.set(confirmationId, {
        action: 'punish',
        foundUsers: foundUserObjects,
        zeroScorePlayers: finalPlayers,
        imageUrl: imageUrl,
        originalUserId: interaction.user.id,
        config: config,
        punishmentService: punishmentService
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(confirmationId);
    }, 5 * 60 * 1000);
    
    const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_punish_${confirmationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_punish_${confirmationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);
    
    const confirmationEmbed = new EmbedBuilder()
        .setTitle('⚖️ Potwierdzenie dodania punktów karnych')
        .setDescription('Czy chcesz dodać punkty karne dla znalezionych graczy?')
        .setColor('#ff6b6b')
        .addFields(
            { name: `✅ Znaleziono ${finalPlayers.length} graczy z wynikiem ZERO`, value: `\`${finalPlayers.join(', ')}\``, inline: false }
        )
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Żądanie od ${interaction.user.tag} | Potwierdź lub anuluj w ciągu 5 minut` });
    
    await interaction.editReply({ 
        embeds: [confirmationEmbed],
        components: [row]
    });
}

async function showFinalConfirmationWithUpdate(interaction, finalPlayers, imageUrl, config, punishmentService) {
    const confirmationId = Date.now().toString();
    
    // Konwertuj nicki na obiekty z członkami dla punishmentService
    const foundUserObjects = [];
    for (const nick of finalPlayers) {
        const member = interaction.guild.members.cache.find(m => 
            m.displayName.toLowerCase() === nick.toLowerCase() || 
            m.user.username.toLowerCase() === nick.toLowerCase()
        );
        if (member) {
            foundUserObjects.push({ 
                userId: member.id,
                member: member, 
                matchedName: nick 
            });
        }
    }
    
    // Zapisz dane do mapy
    confirmationData.set(confirmationId, {
        action: 'punish',
        foundUsers: foundUserObjects,
        zeroScorePlayers: finalPlayers,
        imageUrl: imageUrl,
        originalUserId: interaction.user.id,
        config: config,
        punishmentService: punishmentService
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(confirmationId);
    }, 5 * 60 * 1000);
    
    const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_punish_${confirmationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_punish_${confirmationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);
    
    const confirmationEmbed = new EmbedBuilder()
        .setTitle('⚖️ Potwierdzenie dodania punktów karnych')
        .setDescription('Czy chcesz dodać punkty karne dla znalezionych graczy?')
        .setColor('#ff6b6b')
        .addFields(
            { name: `✅ Znaleziono ${finalPlayers.length} graczy z wynikiem ZERO`, value: `\`${finalPlayers.join(', ')}\``, inline: false }
        )
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Żądanie od ${interaction.user.tag} | Potwierdź lub anuluj w ciągu 5 minut` });
    
    await interaction.update({ 
        embeds: [confirmationEmbed],
        components: [row]
    });
}

async function handleOcrDebugCommand(interaction, config) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const enabled = interaction.options.getBoolean('enabled');

    if (enabled === null) {
        // Sprawdź aktualny stan
        const currentState = config.ocr.detailedLogging.enabled;
        await interaction.reply({
            content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Przełącz stan
    config.ocr.detailedLogging.enabled = enabled;

    const statusText = enabled ? '✅ Włączone' : '❌ Wyłączone';
    const emoji = enabled ? '🔍' : '🔇';

    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);

    await interaction.reply({
        content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleDecodeCommand(interaction, sharedState) {
    const { config, survivorService } = sharedState;

    // Sprawdź czy kanał jest zablokowany dla komendy /decode
    const currentChannelId = interaction.channelId;
    const parentChannelId = interaction.channel?.parent?.id;

    // Sprawdź czy to kanał dozwolony lub wątek w dozwolonym kanale
    const isAllowedChannel = config.allowedDecodeChannels.includes(currentChannelId) ||
                            config.allowedDecodeChannels.includes(parentChannelId);

    // Administratorzy mogą używać komendy wszędzie
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!isAllowedChannel && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/decode` jest dostępna tylko na wybranych kanałach.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wyświetl modal z polem do wpisania kodu
    const modal = new ModalBuilder()
        .setCustomId('decode_modal')
        .setTitle('Dekoduj build Survivor.io');

    const codeInput = new TextInputBuilder()
        .setCustomId('build_code')
        .setLabel('Kod buildu')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Skopiuj tu kod otrzymany po kliknięciu "EXPORT" na stronie https://sio-tools.vercel.app/')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(4000);

    const actionRow = new ActionRowBuilder().addComponents(codeInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

async function handleModalSubmit(interaction, sharedState) {
    if (interaction.customId === 'decode_modal') {
        await handleDecodeModalSubmit(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_modal_')) {
        await handleModyfikujModalSubmit(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_modal|')) {
        await handleDodajModalSubmit(interaction, sharedState);
    }
}

async function handlePhase1Command(interaction, sharedState) {
    const { config, phaseService, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy ktoś już przetwarza
    if (phaseService.isProcessingActive(interaction.guild.id)) {
        const activeUserId = phaseService.getActiveProcessor(interaction.guild.id);
        await interaction.reply({
            content: `⏳ Trwa już przetwarzanie Fazy 1 przez <@${activeUserId}>.\n\nProszę poczekać na zakończenie obecnego procesu.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Wykryj klan użytkownika
        const targetRoleIds = Object.entries(config.targetRoles);
        let userClan = null;

        for (const [clanKey, roleId] of targetRoleIds) {
            if (interaction.member.roles.cache.has(roleId)) {
                userClan = clanKey;
                logger.info(`[PHASE1] 🎯 Wykryto klan użytkownika: ${clanKey} (${config.roleDisplayNames[clanKey]})`);
                break;
            }
        }

        if (!userClan) {
            await interaction.editReply({
                content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról: ' +
                    Object.values(config.roleDisplayNames).join(', ')
            });
            return;
        }

        // Sprawdź czy ktoś już przetwarza dane
        if (phaseService.isProcessingActive(interaction.guild.id)) {
            const activeUserId = phaseService.getActiveProcessor(interaction.guild.id);
            phaseService.addToWaitingQueue(interaction.guild.id, interaction.user.id);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('⏳ Kolejka zajęta')
                    .setDescription(`Komendy \`/faza1\` i \`/faza2\` są obecnie używane przez <@${activeUserId}>.\n\n✅ **Zostaniesz powiadomiony na priv** gdy kolejka się zwolni.`)
                    .setColor('#FFA500')
                    .setTimestamp()
                ]
            });
            return;
        }

        // Sprawdź czy dane dla tego tygodnia i klanu już istnieją
        const weekInfo = phaseService.getCurrentWeekInfo();
        const existingData = await databaseService.checkPhase1DataExists(
            interaction.guild.id,
            weekInfo.weekNumber,
            weekInfo.year,
            userClan
        );

        if (existingData.exists) {
            // Pokaż ostrzeżenie z przyciskami
            const warningEmbed = await phaseService.createOverwriteWarningEmbed(
                interaction.guild.id,
                weekInfo,
                userClan,
                1,
                interaction.guild
            );

            if (warningEmbed) {
                await interaction.editReply({
                    embeds: [warningEmbed.embed],
                    components: [warningEmbed.row]
                });
                return;
            }
        }

        // Zablokuj przetwarzanie dla tego guild
        phaseService.setActiveProcessing(interaction.guild.id, interaction.user.id);

        // Utwórz sesję
        const sessionId = phaseService.createSession(
            interaction.user.id,
            interaction.guild.id,
            interaction.channelId
        );

        const session = phaseService.getSession(sessionId);
        session.publicInteraction = interaction;
        session.clan = userClan;

        // Pokaż embed z prośbą o zdjęcia (PUBLICZNY)
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE1] ✅ Sesja utworzona, czekam na zdjęcia od ${interaction.user.tag}`);

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd komendy /faza1:', error);

        // Odblokuj w przypadku błędu
        phaseService.clearActiveProcessing(interaction.guild.id);

        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas inicjalizacji komendy /faza1.'
        });
    }
}

async function handleDecodeModalSubmit(interaction, sharedState) {
    const { config, survivorService } = sharedState;

    const code = interaction.fields.getTextInputValue('build_code');

    if (!code || code.trim().length === 0) {
        await interaction.reply({
            content: '❌ Nie podano kodu do dekodowania.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        const buildData = survivorService.decodeBuild(code.trim());

        if (!buildData.success) {
            await interaction.editReply({
                content: `❌ **Nie udało się zdekodować kodu**\n\n**Błąd:** ${buildData.error}\n**Kod:** \`${code}\``,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userDisplayName = interaction.member?.displayName || interaction.user.username;
        const embeds = await survivorService.createBuildEmbeds(buildData.data, userDisplayName, code);
        const navigationButtons = survivorService.createNavigationButtons(0);
        const response = await interaction.editReply({
            embeds: [embeds[0]], // Rozpocznij od pierwszej strony
            components: navigationButtons
        });

        // Przechowuj dane dla paginacji
        if (!sharedState.buildPagination) {
            sharedState.buildPagination = new Map();
        }

        sharedState.buildPagination.set(response.id, {
            embeds: embeds,
            currentPage: 0,
            userId: interaction.user.id,
            timestamp: Date.now()
        });

        // Zaplanuj usunięcie wiadomości po 15 minutach (persist across restarts)
        const deleteAt = Date.now() + (15 * 60 * 1000); // 15 minut
        await sharedState.messageCleanupService.scheduleMessageDeletion(
            response.id,
            response.channelId,
            deleteAt,
            interaction.user.id // Zapisz właściciela
        );

        // Usuń dane paginacji po 15 minutach (tylko jeśli bot nie zostanie zrestartowany)
        setTimeout(() => {
            if (sharedState.buildPagination && sharedState.buildPagination.has(response.id)) {
                sharedState.buildPagination.delete(response.id);
            }
        }, 15 * 60 * 1000);

        logger.info(`✅ Pomyślnie zdekodowano build Survivor.io dla ${interaction.user.tag}`);

    } catch (error) {
        logger.error(`❌ Błąd dekodowania build Survivor.io: ${error.message}`);

        await interaction.editReply({
            content: `❌ **Wystąpił błąd podczas dekodowania**\n\n**Błąd:** ${error.message}\n**Kod:** \`${code}\``,
            flags: MessageFlags.Ephemeral
        });
    }
}

// =============== PHASE 1 HANDLERS ===============

async function handlePhase1OverwriteButton(interaction, sharedState) {
    const { phaseService, config } = sharedState;

    if (interaction.customId === 'phase1_overwrite_no') {
        // Anuluj - odblokuj przetwarzanie
        phaseService.clearActiveProcessing(interaction.guild.id);

        await interaction.update({
            content: '❌ Operacja anulowana.',
            embeds: [],
            components: []
        });
        return;
    }

    // Wykryj klan użytkownika ponownie
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.update({
            content: '❌ Nie wykryto Twojego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    // Nadpisz - zablokuj przetwarzanie i utwórz sesję
    phaseService.setActiveProcessing(interaction.guild.id, interaction.user.id);

    const sessionId = phaseService.createSession(
        interaction.user.id,
        interaction.guild.id,
        interaction.channelId
    );

    const session = phaseService.getSession(sessionId);
    session.publicInteraction = interaction;
    session.clan = userClan;

    const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
    await interaction.update({
        embeds: [awaitingEmbed.embed],
        components: [awaitingEmbed.row]
    });

    logger.info(`[PHASE1] ✅ Sesja utworzona (nadpisywanie), czekam na zdjęcia od ${interaction.user.tag}`);
}

async function handlePhase1CompleteButton(interaction, sharedState) {
    const { phaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może ją potwierdzić.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === 'phase1_cancel_session') {
        // Anuluj sesję
        await phaseService.cleanupSession(session.sessionId);

        await interaction.update({
            content: '❌ Sesja anulowana.',
            embeds: [],
            components: []
        });

        logger.info(`[PHASE1] ❌ Sesja anulowana przez użytkownika: ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'phase1_complete_no') {
        // Dodaj więcej zdjęć
        session.stage = 'awaiting_images';
        phaseService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE1] ➕ Użytkownik chce dodać więcej zdjęć`);
        return;
    }

    // Tak, analizuj
    await interaction.update({
        content: '🔄 Analizuję wyniki...',
        embeds: [],
        components: []
    });

    try {
        // Identyfikuj konflikty
        const conflicts = phaseService.identifyConflicts(session);

        if (conflicts.length > 0) {
            // Przejdź do rozstrzygania konfliktów
            session.stage = 'resolving_conflicts';
            const firstConflict = phaseService.getNextUnresolvedConflict(session);

            if (firstConflict) {
                const conflictEmbed = phaseService.createConflictEmbed(firstConflict, 1, conflicts.length, 1);
                await interaction.editReply({
                    content: '',
                    embeds: [conflictEmbed.embed],
                    components: [conflictEmbed.row]
                });
            }
        } else {
            // Brak konfliktów - przejdź do finalnego podsumowania
            await showPhase1FinalSummary(interaction, session, phaseService);
        }

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd analizy wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas analizy wyników.'
        });
    }
}

async function handlePhase1ConflictResolveButton(interaction, sharedState) {
    const { phaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może rozstrzygać konflikty.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wyciągnij nick i wartość z customId
    // Format: phase1_resolve_{nick}_{value}
    const parts = interaction.customId.split('_');
    const value = parts[parts.length - 1];
    const nick = parts.slice(2, parts.length - 1).join('_');

    logger.info(`[PHASE1] Rozstrzygam konflikt dla nick="${nick}", value="${value}"`);

    // Rozstrzygnij konflikt
    phaseService.resolveConflict(session, nick, parseInt(value) || 0);

    logger.info(`[PHASE1] Rozstrzygnięto konfliktów: ${session.resolvedConflicts.size}/${session.conflicts.length}`);

    // Sprawdź czy są jeszcze konflikty
    const nextConflict = phaseService.getNextUnresolvedConflict(session);

    if (nextConflict) {
        // Pokaż następny konflikt
        const currentIndex = session.resolvedConflicts.size + 1;
        const totalConflicts = session.conflicts.length;

        logger.info(`[PHASE1] Następny konflikt: nick="${nextConflict.nick}", index=${currentIndex}/${totalConflicts}`);

        const conflictEmbed = phaseService.createConflictEmbed(nextConflict, currentIndex, totalConflicts, 1);
        await interaction.update({
            embeds: [conflictEmbed.embed],
            components: [conflictEmbed.row]
        });
    } else {
        logger.info(`[PHASE1] Wszystkie konflikty rozstrzygnięte!`);
        // Wszystkie konflikty rozstrzygnięte - pokaż finalne podsumowanie
        await interaction.update({
            content: '🔄 Przygotowuję podsumowanie...',
            embeds: [],
            components: []
        });

        await showPhase1FinalSummary(interaction, session, phaseService);
    }
}

async function handlePhase1FinalConfirmButton(interaction, sharedState) {
    const { phaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może ją zatwierdzić.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === 'phase1_cancel_save') {
        // Anuluj - usuń pliki temp
        await phaseService.cleanupSession(session.sessionId);

        await interaction.update({
            content: '❌ Operacja anulowana. Dane nie zostały zapisane.',
            embeds: [],
            components: []
        });
        return;
    }

    // Zatwierdź - zapisz do bazy
    await interaction.update({
        content: '💾 Zapisuję wyniki do bazy danych...',
        embeds: [],
        components: []
    });

    try {
        const finalResults = phaseService.getFinalResults(session);
        const savedCount = await phaseService.saveFinalResults(session, finalResults, interaction.guild, interaction.user.id);

        const weekInfo = phaseService.getCurrentWeekInfo();
        const stats = phaseService.calculateStatistics(finalResults);
        const clanName = sharedState.config.roleDisplayNames[session.clan] || session.clan;

        // Publiczny raport (wszystko widoczne dla wszystkich)
        const publicEmbed = new EmbedBuilder()
            .setTitle('✅ Faza 1 - Dane zapisane pomyślnie')
            .setDescription(`Wyniki dla tygodnia **${weekInfo.weekNumber}/${weekInfo.year}** zostały zapisane.`)
            .setColor('#00FF00')
            .addFields(
                { name: '👥 Unikalnych graczy', value: stats.uniqueNicks.toString(), inline: true },
                { name: '📈 Wynik > 0', value: `${stats.aboveZero} osób`, inline: true },
                { name: '⭕ Wynik = 0', value: `${stats.zeroCount} osób`, inline: true },
                { name: '🏆 Suma TOP30', value: `${stats.top30Sum.toLocaleString('pl-PL')} pkt`, inline: false },
                { name: '🎯 Klan', value: clanName, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Zapisane przez ${interaction.user.tag}` });

        await interaction.editReply({ embeds: [publicEmbed], components: [] });

        // Usuń pliki temp po zapisaniu (odblokuje też przetwarzanie)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[PHASE1] ✅ Dane zapisane dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}`);

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd zapisu danych:', error);

        // Odblokuj przetwarzanie w przypadku błędu
        phaseService.clearActiveProcessing(interaction.guild.id);

        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas zapisu danych do bazy.',
            components: []
        });
    }
}

async function showPhase1FinalSummary(interaction, session, phaseService) {
    const finalResults = phaseService.getFinalResults(session);
    const stats = phaseService.calculateStatistics(finalResults);
    const weekInfo = phaseService.getCurrentWeekInfo();

    const summaryEmbed = phaseService.createFinalSummaryEmbed(stats, weekInfo, session.clan, 1);

    session.stage = 'final_confirmation';

    await interaction.editReply({
        content: '',
        embeds: [summaryEmbed.embed],
        components: [summaryEmbed.row]
    });
}

// =============== PHASE 2 HANDLERS ===============

async function handlePhase2Command(interaction, sharedState) {
    const { config, phaseService, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy ktoś już przetwarza
    if (phaseService.isProcessingActive(interaction.guild.id)) {
        const activeUserId = phaseService.getActiveProcessor(interaction.guild.id);
        await interaction.reply({
            content: `⏳ Trwa już przetwarzanie przez <@${activeUserId}>.\n\nProszę poczekać na zakończenie obecnego procesu.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Wykryj klan użytkownika
        const targetRoleIds = Object.entries(config.targetRoles);
        let userClan = null;

        for (const [clanKey, roleId] of targetRoleIds) {
            if (interaction.member.roles.cache.has(roleId)) {
                userClan = clanKey;
                logger.info(`[PHASE2] 🎯 Wykryto klan użytkownika: ${clanKey} (${config.roleDisplayNames[clanKey]})`);
                break;
            }
        }

        if (!userClan) {
            await interaction.editReply({
                content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról: ' +
                    Object.values(config.roleDisplayNames).join(', ')
            });
            return;
        }

        // Sprawdź czy ktoś już przetwarza dane
        if (phaseService.isProcessingActive(interaction.guild.id)) {
            const activeUserId = phaseService.getActiveProcessor(interaction.guild.id);
            phaseService.addToWaitingQueue(interaction.guild.id, interaction.user.id);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('⏳ Kolejka zajęta')
                    .setDescription(`Komendy \`/faza1\` i \`/faza2\` są obecnie używane przez <@${activeUserId}>.\n\n✅ **Zostaniesz powiadomiony na priv** gdy kolejka się zwolni.`)
                    .setColor('#FFA500')
                    .setTimestamp()
                ]
            });
            return;
        }

        // Sprawdź czy dane dla tego tygodnia i klanu już istnieją
        const weekInfo = phaseService.getCurrentWeekInfo();
        const existingData = await databaseService.checkPhase2DataExists(
            interaction.guild.id,
            weekInfo.weekNumber,
            weekInfo.year,
            userClan
        );

        if (existingData.exists) {
            // Pokaż ostrzeżenie z przyciskami
            const warningEmbed = await phaseService.createOverwriteWarningEmbed(
                interaction.guild.id,
                weekInfo,
                userClan,
                2,
                interaction.guild
            );

            if (warningEmbed) {
                await interaction.editReply({
                    embeds: [warningEmbed.embed],
                    components: [warningEmbed.row]
                });
                return;
            }
        }

        // Zablokuj przetwarzanie dla tego guild
        phaseService.setActiveProcessing(interaction.guild.id, interaction.user.id);

        // Utwórz sesję dla fazy 2
        const sessionId = phaseService.createSession(
            interaction.user.id,
            interaction.guild.id,
            interaction.channelId,
            2 // phase 2
        );

        const session = phaseService.getSession(sessionId);
        session.publicInteraction = interaction;
        session.clan = userClan;

        // Pokaż embed z prośbą o zdjęcia dla rundy 1 (PUBLICZNY)
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, 1);
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE2] ✅ Sesja utworzona, czekam na zdjęcia z rundy 1/3 od ${interaction.user.tag}`);

    } catch (error) {
        logger.info(`[PHASE2] ❌ Błąd komendy /faza2:`, error);

        // Odblokuj w przypadku błędu
        phaseService.clearActiveProcessing(interaction.guild.id);

        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas uruchamiania komendy.'
        });
    }
}

async function handlePhase2OverwriteButton(interaction, sharedState) {
    const { phaseService, config } = sharedState;

    if (interaction.customId === 'phase2_overwrite_no') {
        phaseService.clearActiveProcessing(interaction.guild.id);
        await interaction.update({
            content: '❌ Operacja anulowana.',
            embeds: [],
            components: []
        });
        return;
    }

    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.update({
            content: '❌ Nie wykryto Twojego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    phaseService.setActiveProcessing(interaction.guild.id, interaction.user.id);

    const sessionId = phaseService.createSession(
        interaction.user.id,
        interaction.guild.id,
        interaction.channelId,
        2
    );

    const session = phaseService.getSession(sessionId);
    session.publicInteraction = interaction;
    session.clan = userClan;

    const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, 1);
    await interaction.update({
        embeds: [awaitingEmbed.embed],
        components: [awaitingEmbed.row]
    });

    logger.info(`[PHASE2] ✅ Sesja utworzona (nadpisywanie), czekam na zdjęcia od ${interaction.user.tag}`);
}

async function handlePhase2CompleteButton(interaction, sharedState) {
    const { phaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === 'phase2_cancel_session') {
        // Anuluj sesję
        await phaseService.cleanupSession(session.sessionId);

        await interaction.update({
            content: '❌ Sesja anulowana.',
            embeds: [],
            components: []
        });

        logger.info(`[PHASE2] ❌ Sesja anulowana przez użytkownika: ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'phase2_complete_no') {
        session.stage = 'awaiting_images';
        phaseService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, session.currentRound);
        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });
        return;
    }

    // Jeśli to przycisk rozwiązywania konfliktu
    if (interaction.customId.startsWith('phase2_resolve_')) {
        const parts = interaction.customId.split('_');
        const nick = parts[2];
        const chosenValue = parseInt(parts[3]);

        logger.info(`[PHASE2] Rozstrzygam konflikt dla nick="${nick}", value="${chosenValue}"`);

        const conflict = phaseService.getNextUnresolvedConflict(session);

        if (conflict) {
            phaseService.resolveConflict(session, conflict.nick, chosenValue);
            const nextConflict = phaseService.getNextUnresolvedConflict(session);

            if (nextConflict) {
                const conflictEmbed = phaseService.createConflictEmbed(
                    nextConflict,
                    session.resolvedConflicts.size + 1,
                    session.conflicts.length,
                    2
                );
                await interaction.update({
                    embeds: [conflictEmbed.embed],
                    components: [conflictEmbed.row]
                });
                return;
            }
        }

        // Wszystkie konflikty rozwiązane - pokaż podsumowanie rundy
        logger.info(`[PHASE2] ✅ Wszystkie konflikty rozwiązane!`);

        // Pokaż podsumowanie rundy (działa dla rund 1, 2 i 3)
        await showPhase2RoundSummary(interaction, session, phaseService);
        return;
    }

    // Przycisk "Tak, gotowe" po dodaniu zdjęć
    await interaction.update({
        content: '🔄 Analizuję wyniki...',
        embeds: [],
        components: []
    });

    try {
        const aggregated = phaseService.aggregateResults(session);
        const conflicts = phaseService.identifyConflicts(session);

        if (conflicts.length > 0) {
            session.stage = 'resolving_conflicts';
            session.currentConflictIndex = 0;
            const conflictEmbed = phaseService.createConflictEmbed(conflicts[0], 0, conflicts.length, 2);
            await interaction.editReply({
                content: '',
                embeds: [conflictEmbed.embed],
                components: [conflictEmbed.row]
            });
        } else {
            // Brak konfliktów - pokaż podsumowanie rundy
            await showPhase2RoundSummary(interaction, session, phaseService);
        }
    } catch (error) {
        logger.error('[PHASE2] ❌ Błąd analizy:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas analizy wyników.'
        });
    }
}

async function handlePhase2FinalConfirmButton(interaction, sharedState) {
    const { phaseService, databaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === 'phase2_cancel_save') {
        await interaction.update({
            content: '❌ Anulowano zapis danych.',
            embeds: [],
            components: []
        });
        phaseService.cleanupSession(session.sessionId);
        return;
    }

    await interaction.update({
        content: '💾 Zapisywanie wyników...',
        embeds: [],
        components: []
    });

    try {
        // Wyniki wszystkich rund są już w roundsData (dodane po rozwiązaniu konfliktów)
        logger.info(`[PHASE2] 📊 Sumowanie wyników z ${session.roundsData.length} rund...`);
        const summedResults = phaseService.sumPhase2Results(session);
        const weekInfo = phaseService.getCurrentWeekInfo();

        // Przygotuj dane z każdej rundy
        const roundsData = [];
        for (const roundData of session.roundsData) {
            const roundPlayers = [];
            for (const [nick, score] of roundData.results) {
                const member = interaction.guild.members.cache.find(m =>
                    m.displayName.toLowerCase() === nick.toLowerCase() ||
                    m.user.username.toLowerCase() === nick.toLowerCase()
                );

                if (member) {
                    roundPlayers.push({
                        userId: member.id,
                        displayName: member.displayName,
                        score: score
                    });
                }
            }
            roundsData.push({
                round: roundData.round,
                players: roundPlayers
            });
        }

        // Przygotuj zsumowane wyniki
        const summaryPlayers = [];
        for (const [nick, totalScore] of summedResults) {
            const member = interaction.guild.members.cache.find(m =>
                m.displayName.toLowerCase() === nick.toLowerCase() ||
                m.user.username.toLowerCase() === nick.toLowerCase()
            );

            if (member) {
                summaryPlayers.push({
                    userId: member.id,
                    displayName: member.displayName,
                    score: totalScore
                });
            }
        }

        // Zapisz wszystko do bazy
        await databaseService.savePhase2Results(
            session.guildId,
            weekInfo.weekNumber,
            weekInfo.year,
            session.clan,
            roundsData,
            summaryPlayers,
            interaction.user.id
        );

        const stats = phaseService.calculateStatistics(summedResults);
        const clanName = sharedState.config.roleDisplayNames[session.clan] || session.clan;

        const publicEmbed = new EmbedBuilder()
            .setTitle('✅ Faza 2 - Dane zapisane pomyślnie')
            .setDescription(`Wyniki dla tygodnia **${weekInfo.weekNumber}/${weekInfo.year}** zostały zapisane.`)
            .setColor('#00FF00')
            .addFields(
                { name: '👥 Unikalnych graczy', value: stats.uniqueNicks.toString(), inline: true },
                { name: '📈 Wynik > 0', value: `${stats.aboveZero} osób`, inline: true },
                { name: '⭕ Wynik = 0', value: `${stats.zeroCount} osób`, inline: true },
                { name: '🎯 Klan', value: clanName, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Zapisane przez ${interaction.user.tag}` });

        await interaction.editReply({ embeds: [publicEmbed], components: [] });
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[PHASE2] ✅ Dane zapisane dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}`);

    } catch (error) {
        logger.error('[PHASE2] ❌ Błąd zapisu:', error);
        phaseService.clearActiveProcessing(interaction.guild.id);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas zapisywania danych.'
        });
    }
}

async function showPhase2FinalSummary(interaction, session, phaseService) {
    logger.info(`[PHASE2] 📋 Tworzenie finalnego podsumowania...`);

    try {
        logger.info(`[PHASE2] 🔢 Rozpoczynam sumowanie wyników...`);
        const summedResults = phaseService.sumPhase2Results(session);

        logger.info(`[PHASE2] 📊 Obliczam statystyki...`);
        const stats = phaseService.calculateStatistics(summedResults);

        logger.info(`[PHASE2] 📅 Pobieram informacje o tygodniu...`);
        const weekInfo = phaseService.getCurrentWeekInfo();

        logger.info(`[PHASE2] 🎨 Tworzę embed podsumowania...`);
        const summaryEmbed = phaseService.createFinalSummaryEmbed(stats, weekInfo, session.clan, 2);

        session.stage = 'final_confirmation';

        logger.info(`[PHASE2] 📤 Wysyłam podsumowanie do użytkownika...`);
        logger.info(`[PHASE2] 🔍 Stan interakcji - deferred: ${interaction.deferred}, replied: ${interaction.replied}`);

        try {
            // Po update() trzeba użyć followUp() zamiast editReply()
            if (interaction.replied) {
                await interaction.followUp({
                    content: '',
                    embeds: [summaryEmbed.embed],
                    components: [summaryEmbed.row]
                });
            } else {
                await interaction.editReply({
                    content: '',
                    embeds: [summaryEmbed.embed],
                    components: [summaryEmbed.row]
                });
            }
            logger.info(`[PHASE2] ✅ Podsumowanie wysłane pomyślnie`);
        } catch (replyError) {
            logger.error(`[PHASE2] ❌ Błąd podczas wysyłania odpowiedzi:`, replyError);
            logger.error(`[PHASE2] ❌ Reply error message:`, replyError?.message);
            logger.error(`[PHASE2] ❌ Reply error code:`, replyError?.code);
            throw replyError;
        }
    } catch (error) {
        logger.error(`[PHASE2] ❌ Błąd w showPhase2FinalSummary:`, error);
        logger.error(`[PHASE2] ❌ Error stack:`, error.stack);
        throw error;
    }
}

async function handlePhase2RoundContinue(interaction, sharedState) {
    const { phaseService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy to była ostatnia runda
    if (session.currentRound < 3) {
        // Zapisz wyniki bieżącej rundy i przejdź do następnej
        phaseService.startNextRound(session);
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, session.currentRound);
        await interaction.update({
            content: '',
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });
        logger.info(`[PHASE2] 🔄 Przechodzę do rundy ${session.currentRound}/3`);
    } else {
        // Zapisz wyniki ostatniej rundy przed pokazaniem podsumowania
        logger.info(`[PHASE2] 💾 Zapisywanie wyników rundy 3 przed podsumowaniem...`);
        const lastRoundData = {
            round: session.currentRound,
            results: phaseService.getFinalResults(session)
        };
        logger.info(`[PHASE2] 📊 Wyniki rundy 3: ${lastRoundData.results.size} graczy`);
        session.roundsData.push(lastRoundData);
        logger.info(`[PHASE2] ✅ Zapisano wyniki rundy ${session.currentRound}/3. Łącznie ${session.roundsData.length} rund w roundsData`);

        // Pokaż finalne podsumowanie
        await interaction.update({
            content: '✅ Wszystkie rundy zakończone! Przygotowuję finalne podsumowanie...',
            embeds: [],
            components: []
        });

        try {
            await showPhase2FinalSummary(interaction, session, phaseService);
        } catch (error) {
            logger.error(`[PHASE2] ❌ Błąd podczas wyświetlania podsumowania:`, error);
            throw error;
        }
    }
}

async function showPhase2RoundSummary(interaction, session, phaseService) {
    logger.info(`[PHASE2] 📋 Tworzenie podsumowania rundy ${session.currentRound}...`);

    // Oblicz statystyki dla tej rundy
    const finalResults = phaseService.getFinalResults(session);
    const stats = phaseService.calculateStatistics(finalResults);

    const embed = new EmbedBuilder()
        .setTitle(`✅ Runda ${session.currentRound}/3 - Podsumowanie`)
        .setColor('#00FF00')
        .addFields(
            { name: '👥 Unikalnych graczy', value: stats.uniqueNicks.toString(), inline: true },
            { name: '📈 Wynik > 0', value: `${stats.aboveZero} osób`, inline: true },
            { name: '⭕ Wynik = 0', value: `${stats.zeroCount} osób`, inline: true }
        )
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('phase2_round_continue')
                .setLabel(session.currentRound < 3 ? '✅ Przejdź do następnej rundy' : '✅ Pokaż finalne podsumowanie')
                .setStyle(ButtonStyle.Success)
        );

    // Użyj odpowiedniej metody w zależności od stanu interakcji
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
            content: '',
            embeds: [embed],
            components: [row]
        });
    } else {
        await interaction.update({
            content: '',
            embeds: [embed],
            components: [row]
        });
    }

    logger.info(`[PHASE2] ✅ Podsumowanie rundy ${session.currentRound} wysłane`);
}

// =============== DODAJ HANDLERS ===============

async function handleDodajWeekSelect(interaction, sharedState) {
    const { config } = sharedState;
    const [prefix, phase, clan] = interaction.customId.split('|');
    const selectedWeek = interaction.values[0];

    // Jeśli Faza 2, pokaż wybór rundy
    if (phase === 'phase2') {
        const roundOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 1')
                .setValue('round1')
                .setDescription('Dodaj do rundy 1'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 2')
                .setValue('round2')
                .setDescription('Dodaj do rundy 2'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 3')
                .setValue('round3')
                .setDescription('Dodaj do rundy 3')
        ];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`dodaj_select_round|${phase}|${clan}|${selectedWeek}`)
            .setPlaceholder('Wybierz rundę')
            .addOptions(roundOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('➕ Dodaj gracza - Faza 2')
            .setDescription(`**Krok 2/3:** Wybierz rundę\n\nTydzień: **${selectedWeek}**\nKlan: **${config.roleDisplayNames[clan]}**`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    } else {
        // Faza 1 - pokaż select menu z użytkownikami z odpowiednią rolą
        await showUserSelectMenu(interaction, sharedState, phase, clan, selectedWeek, 'none');
    }
}

async function handleDodajRoundSelect(interaction, sharedState) {
    const [prefix, phase, clan, weekNumber] = interaction.customId.split('|');
    const selectedRound = interaction.values[0];

    // Pokaż select menu z użytkownikami z odpowiednią rolą
    await showUserSelectMenu(interaction, sharedState, phase, clan, weekNumber, selectedRound);
}

async function showUserSelectMenu(interaction, sharedState, phase, clan, weekNumber, round) {
    const { config, databaseService } = sharedState;

    // Pobierz role ID dla wybranego klanu
    const clanRoleId = config.targetRoles[clan];

    if (!clanRoleId) {
        await interaction.update({
            content: '❌ Nie znaleziono roli dla tego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    // Pobierz dane z bazy dla tego tygodnia
    const [week, year] = weekNumber.split('-');
    let existingPlayerIds = new Set();

    try {
        if (phase === 'phase1') {
            const weekData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );
            if (weekData && weekData.players) {
                weekData.players.forEach(p => existingPlayerIds.add(p.userId));
            }
        } else if (phase === 'phase2') {
            const weekData = await databaseService.getPhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );
            if (weekData) {
                if (round === 'summary' && weekData.summary) {
                    weekData.summary.players.forEach(p => existingPlayerIds.add(p.userId));
                } else if (round !== 'summary' && weekData.rounds) {
                    const roundIndex = round === 'round1' ? 0 : round === 'round2' ? 1 : 2;
                    if (weekData.rounds[roundIndex]) {
                        weekData.rounds[roundIndex].players.forEach(p => existingPlayerIds.add(p.userId));
                    }
                }
            }
        }
    } catch (error) {
        logger.error('[DODAJ] Błąd pobierania istniejących graczy:', error);
    }

    // Pobierz wszystkich członków serwera z odpowiednią rolą
    await interaction.guild.members.fetch();
    const membersWithRole = interaction.guild.members.cache.filter(member =>
        member.roles.cache.has(clanRoleId) && !existingPlayerIds.has(member.id)
    );

    if (membersWithRole.size === 0) {
        await interaction.update({
            content: '❌ Nie znaleziono użytkowników do dodania. Wszyscy członkowie klanu mają już wyniki.',
            embeds: [],
            components: []
        });
        return;
    }

    // Sortuj alfabetycznie po displayName
    const sortedMembers = Array.from(membersWithRole.values())
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 25); // Discord limit: max 25 opcji

    // Utwórz opcje select menu
    const userOptions = sortedMembers.map(member =>
        new StringSelectMenuOptionBuilder()
            .setLabel(member.displayName)
            .setValue(member.id)
            .setDescription(`@${member.user.username}`)
    );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`dodaj_select_user|${phase}|${clan}|${weekNumber}|${round}`)
        .setPlaceholder('Wybierz użytkownika')
        .addOptions(userOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const phaseTitle = phase === 'phase2' ? 'Faza 2' : 'Faza 1';
    const roundText = round !== 'none' && round !== 'summary'
        ? `, ${round === 'round1' ? 'Runda 1' : round === 'round2' ? 'Runda 2' : 'Runda 3'}`
        : round === 'summary' ? ', Podsumowanie' : '';

    const embed = new EmbedBuilder()
        .setTitle(`➕ Dodaj gracza - ${phaseTitle}${roundText}`)
        .setDescription(`**Wybierz użytkownika:**\n\nTydzień: **${weekNumber}**\nKlan: **${config.roleDisplayNames[clan]}**\n\nDostępnych użytkowników: **${sortedMembers.length}**`)
        .setColor('#00FF00')
        .setTimestamp();

    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

async function handleDodajUserSelect(interaction, sharedState) {
    const [prefix, phase, clan, weekNumber, round] = interaction.customId.split('|');
    const selectedUserId = interaction.values[0];

    // Pobierz wybranego użytkownika
    const selectedMember = await interaction.guild.members.fetch(selectedUserId);

    if (!selectedMember) {
        await interaction.update({
            content: '❌ Nie znaleziono wybranego użytkownika.',
            embeds: [],
            components: []
        });
        return;
    }

    // Pokaż modal tylko z polem na wynik
    const modal = new ModalBuilder()
        .setCustomId(`dodaj_modal|${phase}|${clan}|${weekNumber}|${round}|${selectedUserId}`)
        .setTitle(`Dodaj wynik dla ${selectedMember.displayName}`);

    const scoreInput = new TextInputBuilder()
        .setCustomId('score')
        .setLabel('Wynik')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz wynik (liczba)')
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(scoreInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleDodajCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wykryj klan użytkownika
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.reply({
            content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról klanowych aby dodawać wyniki.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const selectedPhase = interaction.options.getString('faza');

    try {
        const clanName = config.roleDisplayNames[userClan];

        // Pobierz dostępne tygodnie dla tego klanu
        const availableWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
        const weeksForClan = availableWeeks.filter(week => week.clans.includes(userClan));

        if (weeksForClan.length === 0) {
            await interaction.reply({
                content: `❌ Brak zapisanych wyników dla klanu ${clanName}. Najpierw użyj \`/faza1\` lub \`/faza2\` aby dodać wyniki.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Twórz select menu z tygodniami
        const weekOptions = weeksForClan.slice(0, 25).map(week => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                .setValue(`${week.weekNumber}-${week.year}`)
                .setDescription(`${week.clans.map(c => config.roleDisplayNames[c]).join(', ')}`);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`dodaj_select_week|${selectedPhase}|${userClan}`)
            .setPlaceholder('Wybierz tydzień')
            .addOptions(weekOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const embed = new EmbedBuilder()
            .setTitle(`➕ Dodaj gracza - ${phaseTitle}`)
            .setDescription(`**Krok 1/3:** Wybierz tydzień (klan: **${clanName}**)`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[DODAJ] ❌ Błąd komendy /dodaj:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas inicjalizacji komendy.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleDodajModalSubmit(interaction, sharedState) {
    const { config, databaseService } = sharedState;
    const customIdParts = interaction.customId.split('|');
    const [prefix, phase, clan, weekNumber, round, userId] = customIdParts;

    const scoreInput = interaction.fields.getTextInputValue('score');
    const scoreNum = parseInt(scoreInput);

    if (isNaN(scoreNum)) {
        await interaction.reply({
            content: '❌ Wynik musi być liczbą.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Pobierz informacje o użytkowniku
        const member = await interaction.guild.members.fetch(userId);
        const displayName = member.displayName;

        const [week, year] = weekNumber.split('-');

        if (phase === 'phase1') {
            // Dodaj gracza do Fazy 1
            const weekData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            if (!weekData) {
                await interaction.editReply({
                    content: '❌ Nie znaleziono danych dla tego tygodnia.'
                });
                return;
            }

            // Zapisz nowego gracza
            await databaseService.savePhase1Result(
                interaction.guild.id,
                userId, // userId
                displayName, // displayName
                scoreNum, // score
                parseInt(week),
                parseInt(year),
                clan,
                null // createdBy - nie nadpisujemy oryginalnego autora
            );

            // Odśwież dane i przelicz TOP30
            const updatedData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            const sortedPlayers = [...updatedData.players].sort((a, b) => b.score - a.score);
            const top30 = sortedPlayers.slice(0, 30);
            const top30Sum = top30.reduce((sum, p) => sum + p.score, 0);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Gracz dodany - Faza 1')
                    .setDescription(`Dodano gracza **${displayName}** z wynikiem **${scoreNum}**`)
                    .addFields(
                        { name: 'Tydzień', value: `${week}/${year}`, inline: true },
                        { name: 'Klan', value: config.roleDisplayNames[clan], inline: true },
                        { name: 'TOP30 (suma)', value: top30Sum.toString(), inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp()
                ]
            });

        } else if (phase === 'phase2') {
            // Dodaj gracza do Fazy 2
            const weekData = await databaseService.getPhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            if (!weekData) {
                await interaction.editReply({
                    content: '❌ Nie znaleziono danych dla tego tygodnia.'
                });
                return;
            }

            if (round === 'summary') {
                // Dodaj do podsumowania
                weekData.summary.players.push({
                    userId: userId,
                    displayName: displayName,
                    score: scoreNum
                });
            } else {
                // Dodaj do konkretnej rundy
                const roundIndex = round === 'round1' ? 0 : round === 'round2' ? 1 : 2;

                weekData.rounds[roundIndex].players.push({
                    userId: userId,
                    displayName: displayName,
                    score: scoreNum
                });

                // Przelicz sumę wyników dla tego gracza we wszystkich rundach
                let totalScore = 0;
                for (const r of weekData.rounds) {
                    const playerInRound = r.players.find(p => p.userId === userId);
                    if (playerInRound) {
                        totalScore += playerInRound.score;
                    }
                }

                // Zaktualizuj podsumowanie
                const playerInSummary = weekData.summary.players.find(p => p.userId === userId);
                if (playerInSummary) {
                    playerInSummary.score = totalScore;
                } else {
                    weekData.summary.players.push({
                        userId: userId,
                        displayName: displayName,
                        score: totalScore
                    });
                }
            }

            // Zapisz dane (zachowaj oryginalnego autora)
            await databaseService.savePhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan,
                weekData.rounds,
                weekData.summary.players,
                weekData.createdBy || interaction.user.id
            );

            const roundName = round === 'summary' ? 'Podsumowanie' :
                              round === 'round1' ? 'Runda 1' :
                              round === 'round2' ? 'Runda 2' : 'Runda 3';

            // Policz sumę dla podsumowania
            const summarySum = weekData.summary.players.reduce((sum, p) => sum + p.score, 0);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Gracz dodany - Faza 2')
                    .setDescription(`Dodano gracza **${displayName}** z wynikiem **${scoreNum}**`)
                    .addFields(
                        { name: 'Tydzień', value: `${week}/${year}`, inline: true },
                        { name: 'Klan', value: config.roleDisplayNames[clan], inline: true },
                        { name: 'Runda', value: roundName, inline: true },
                        { name: 'Suma (podsumowanie)', value: summarySum.toString(), inline: false }
                    )
                    .setColor('#00FF00')
                    .setTimestamp()
                ]
            });
        }

    } catch (error) {
        logger.error('[DODAJ] ❌ Błąd dodawania gracza:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas dodawania gracza.'
        });
    }
}

// =============== MODYFIKUJ HANDLERS ===============

async function handleModyfikujCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wykryj klan użytkownika
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.reply({
            content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról klanowych aby modyfikować wyniki.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const selectedPhase = interaction.options.getString('faza');

    try {
        const clanName = config.roleDisplayNames[userClan];

        // Krok 1: Wybór klanu (tylko klan użytkownika)
        const clanOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel(clanName)
                .setValue(userClan)
        ];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_clan|${selectedPhase}`)
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}`)
            .setDescription(`**Krok 1/4:** Wybierz klan (dostępny: **${clanName}**)`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd komendy /modyfikuj:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas uruchamiania komendy.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function showModyfikujWeekSelection(interaction, databaseService, config, userClan, selectedPhase, selectedRound = null, page = 0) {
    const clanName = config.roleDisplayNames[userClan];

    // Pobierz dostępne tygodnie dla wybranego klanu i fazy
    let allWeeks;
    if (selectedPhase === 'phase2') {
        allWeeks = await databaseService.getAvailableWeeksPhase2(interaction.guild.id);
    } else {
        allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
    }

    const weeksForClan = allWeeks.filter(week => week.clans.includes(userClan));

    if (weeksForClan.length === 0) {
        await interaction.editReply({
            content: `❌ Brak zapisanych wyników dla klanu **${clanName}**.`,
            components: []
        });
        return;
    }

    // Paginacja tygodni
    const weeksPerPage = 20;
    const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * weeksPerPage;
    const endIndex = startIndex + weeksPerPage;
    const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

    // Utwórz select menu z tygodniami
    const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`modyfikuj_select_week_${customIdSuffix}`)
        .setPlaceholder('Wybierz tydzień')
        .addOptions(
            weeksOnPage.map(week => {
                const date = new Date(week.createdAt);
                const dateStr = date.toLocaleDateString('pl-PL', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });

                return new StringSelectMenuOptionBuilder()
                    .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                    .setDescription(`Zapisano: ${dateStr}`)
                    .setValue(`${userClan}|${week.weekNumber}-${week.year}`);
            })
        );

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
    if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_prev|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_info|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel(`Strona ${currentPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_next|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === totalPages - 1)
            );
        components.push(paginationRow);
    }

    const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
    const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';
    const stepNumber = selectedPhase === 'phase2' ? (selectedRound ? '4/4' : '2/4') : '2/3';

    const embed = new EmbedBuilder()
        .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}${roundText}`)
        .setDescription(`**Krok ${stepNumber}:** Wybierz tydzień\n**Klan:** ${clanName}\n\nTygodni: ${weeksForClan.length}${totalPages > 1 ? ` | Strona ${currentPage + 1}/${totalPages}` : ''}`)
        .setColor('#FF9900')
        .setTimestamp();

    await interaction.editReply({
        embeds: [embed],
        components: components
    });
}

async function handleModyfikujClanSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Format: modyfikuj_select_clan|phase1 lub modyfikuj_select_clan|phase2
        const parts = interaction.customId.split('|');
        const selectedPhase = parts[1];
        const selectedClan = interaction.values[0];

        // Krok 2: Pokaż wybór tygodnia
        await showModyfikujWeekSelection(interaction, databaseService, config, selectedClan, selectedPhase, null, 0);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru klanu.',
            components: []
        });
    }
}

async function handleModyfikujRoundSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Format: modyfikuj_select_round|clan|weekNumber-year|phase
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const selectedPhase = parts[3];
        const selectedRound = interaction.values[0];

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const clanName = config.roleDisplayNames[clan];

        // Pobierz wyniki dla wybranego tygodnia
        const weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        // Wybierz graczy z odpowiedniej rundy
        let players;
        if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
            players = weekData.rounds[0].players;
        } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
            players = weekData.rounds[1].players;
        } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
            players = weekData.rounds[2].players;
        } else {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranej rundy.`,
                components: []
            });
            return;
        }

        if (!players || players.length === 0) {
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranej rundy.`,
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const currentPage = 0;
        const startIndex = 0;
        const endIndex = playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami
        const customIdSuffix = `${selectedPhase}|${selectedRound}`;
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${customIdSuffix}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
        if (totalPages > 1) {
            const paginationRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel('◀ Poprzednia')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel(`Strona 1/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel('Następna ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(totalPages === 1)
                );
            components.push(paginationRow);
        }

        const roundText = selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : 'Runda 3';
        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - Faza 2 - ${roundText}`)
            .setDescription(`**Krok 4/4:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length}${totalPages > 1 ? ` | Strona 1/${totalPages}` : ''}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru rundy:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru rundy.',
            components: []
        });
    }
}

async function handleModyfikujWeekSelect(interaction, sharedState, page = 0) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Parsuj customId: modyfikuj_select_week_phase1 lub modyfikuj_select_week_phase2
        const customIdParts = interaction.customId.replace('modyfikuj_select_week_', '').split('|');
        const selectedPhase = customIdParts[0]; // phase1 lub phase2

        const selectedValue = interaction.values[0];
        const [clan, weekKey] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        const clanName = config.roleDisplayNames[clan];

        // Dla Fazy 2 - pokaż wybór rundy
        if (selectedPhase === 'phase2') {
            const roundOptions = [
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 1')
                    .setValue('round1'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 2')
                    .setValue('round2'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 3')
                    .setValue('round3')
            ];

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`modyfikuj_select_round|${clan}|${weekNumber}-${year}|${selectedPhase}`)
                .setPlaceholder('Wybierz rundę')
                .addOptions(roundOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setTitle('🔧 Modyfikacja wyniku - Faza 2')
                .setDescription(`**Krok 3/4:** Wybierz rundę\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}`)
                .setColor('#FF9900')
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
            return;
        }

        // Dla Fazy 1 - pokaż wybór gracza
        const weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData || !weekData.players) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        const players = weekData.players;

        if (!players || players.length === 0) {
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranego tygodnia.`,
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const startIndex = currentPage * playersPerPage;
        const endIndex = startIndex + playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${selectedPhase}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
        if (totalPages > 1) {
            const paginationRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel('◀ Poprzednia')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel(`Strona ${currentPage + 1}/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel('Następna ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === totalPages - 1)
                );
            components.push(paginationRow);
        }

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const stepNumber = '3/3';

        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}`)
            .setDescription(`**Krok ${stepNumber}:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length}${totalPages > 1 ? ` | Strona ${currentPage + 1}/${totalPages}` : ''}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru tygodnia:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru tygodnia.',
            components: []
        });
    }
}

async function handleModyfikujPlayerSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Parsuj customId: modyfikuj_select_player_phase1 lub modyfikuj_select_player_phase2|round1
        const customIdParts = interaction.customId.replace('modyfikuj_select_player_', '').split('|');
        const selectedPhase = customIdParts[0];
        const selectedRound = customIdParts[1] || null;

        const selectedValue = interaction.values[0];
        const [clan, weekKey, userId] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        logger.info(`[MODYFIKUJ] Wybrano gracza: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekNumber}/${year}, userId=${userId}`);

        // Pobierz dane gracza
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase2: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.reply({
                    content: '❌ Nie znaleziono danych dla wybranego tygodnia.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            logger.info(`[MODYFIKUJ] weekData structure: rounds=${weekData.rounds ? 'exists' : 'null'}, roundsLength=${weekData.rounds?.length}`);

            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                logger.info(`[MODYFIKUJ] Szukam w round1, players count: ${weekData.rounds[0].players?.length}`);
                player = weekData.rounds[0].players.find(p => p.userId === userId);
                logger.info(`[MODYFIKUJ] Znaleziono gracza w round1: ${player ? 'TAK' : 'NIE'}`);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                logger.info(`[MODYFIKUJ] Szukam w round2, players count: ${weekData.rounds[1].players?.length}`);
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                logger.info(`[MODYFIKUJ] Szukam w round3, players count: ${weekData.rounds[2].players?.length}`);
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            } else {
                logger.error(`[MODYFIKUJ] Nie można znaleźć rundy: selectedRound=${selectedRound}, weekData.rounds[0]=${weekData.rounds?.[0] ? 'exists' : 'null'}`);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData || !weekData.players) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase1: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}, weekData=${weekData}`);
                await interaction.reply({
                    content: '❌ Nie znaleziono danych dla wybranego tygodnia.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            logger.error(`[MODYFIKUJ] Nie znaleziono gracza: userId=${userId}, phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekNumber}/${year}`);
            await interaction.reply({
                content: '❌ Nie znaleziono gracza.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Pokaż modal do wprowadzenia nowego wyniku
        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const modal = new ModalBuilder()
            .setCustomId(`modyfikuj_modal_${customIdSuffix}|${clan}|${weekNumber}-${year}|${userId}`)
            .setTitle('Modyfikuj wynik gracza');

        const scoreInput = new TextInputBuilder()
            .setCustomId('new_score')
            .setLabel(`Nowy wynik dla ${player.displayName}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Aktualny wynik: ${player.score}`)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(6);

        const row = new ActionRowBuilder().addComponents(scoreInput);
        modal.addComponents(row);

        await interaction.showModal(modal);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru gracza:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas wyboru gracza.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModyfikujPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const parts = interaction.customId.split('|');
        const action = parts[0]; // modyfikuj_page_prev lub modyfikuj_page_next
        const clan = parts[1];
        const weekKey = parts[2];
        const currentPage = parseInt(parts[3]);
        const selectedPhase = parts[4] || 'phase1'; // phase1 lub phase2
        const selectedRound = parts[5] || null; // round1, round2, round3 lub null

        const [weekNumber, year] = weekKey.split('-').map(Number);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'modyfikuj_page_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'modyfikuj_page_next') {
            newPage = currentPage + 1;
        }

        const clanName = config.roleDisplayNames[clan];

        // Pobierz wyniki dla wybranego tygodnia i klanu
        let weekData;
        let players;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase2: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.editReply({
                    content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            // Wybierz graczy z odpowiedniej rundy (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                players = weekData.rounds[0].players;
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                players = weekData.rounds[1].players;
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                players = weekData.rounds[2].players;
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase1: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.editReply({
                    content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            players = weekData.players;
        }

        if (!players || players.length === 0) {
            logger.error(`[MODYFIKUJ] Brak players dla: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}, phase=${selectedPhase}, round=${selectedRound}`);
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranego tygodnia i klanu **${clanName}**.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const validPage = Math.max(0, Math.min(newPage, totalPages - 1));
        const startIndex = validPage * playersPerPage;
        const endIndex = startIndex + playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami na aktualnej stronie
        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${customIdSuffix}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji
        const paginationCustomId = selectedRound
            ? `|${selectedPhase}|${selectedRound}`
            : `|${selectedPhase}`;

        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel(`Strona ${validPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === totalPages - 1)
            );
        components.push(paginationRow);

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';
        const stepNumber = selectedPhase === 'phase2' ? (selectedRound ? '4/4' : '?/4') : '3/3';

        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}${roundText}`)
            .setDescription(`**Krok ${stepNumber}:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length} | Strona ${validPage + 1}/${totalPages}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd paginacji:', error);
        logger.error('[MODYFIKUJ] ❌ Error stack:', error.stack);
        logger.error('[MODYFIKUJ] ❌ customId:', interaction.customId);

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas zmiany strony.',
                    embeds: [],
                    components: []
                });
            } else {
                await interaction.update({
                    content: '❌ Wystąpił błąd podczas zmiany strony.',
                    embeds: [],
                    components: []
                });
            }
        } catch (replyError) {
            logger.error('[MODYFIKUJ] ❌ Błąd podczas odpowiedzi na błąd:', replyError);
        }
    }
}

async function handleModyfikujWeekPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        const parts = interaction.customId.split('|');
        const action = parts[0]; // modyfikuj_week_prev lub modyfikuj_week_next
        const clan = parts[1];
        const currentPage = parseInt(parts[2]);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'modyfikuj_week_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'modyfikuj_week_next') {
            newPage = currentPage + 1;
        }

        const clanName = config.roleDisplayNames[clan];

        // Pobierz dostępne tygodnie dla wybranego klanu
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
        const weeksForClan = allWeeks.filter(week => week.clans.includes(clan));

        if (weeksForClan.length === 0) {
            await interaction.update({
                content: `❌ Brak zapisanych wyników dla klanu **${clanName}**.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Paginacja tygodni
        const weeksPerPage = 20;
        const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
        const validPage = Math.max(0, Math.min(newPage, totalPages - 1));
        const startIndex = validPage * weeksPerPage;
        const endIndex = startIndex + weeksPerPage;
        const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

        // Utwórz select menu z tygodniami na aktualnej stronie
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('modyfikuj_select_week')
            .setPlaceholder('Wybierz tydzień')
            .addOptions(
                weeksOnPage.map(week => {
                    const date = new Date(week.createdAt);
                    const dateStr = date.toLocaleDateString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });

                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                        .setDescription(`Zapisano: ${dateStr}`)
                        .setValue(`${clan}|${week.weekNumber}-${week.year}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji
        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_prev|${clan}|${validPage}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_info|${clan}|${validPage}`)
                    .setLabel(`Strona ${validPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_next|${clan}|${validPage}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === totalPages - 1)
            );
        components.push(paginationRow);

        const embed = new EmbedBuilder()
            .setTitle('🔧 Modyfikacja wyniku - Faza 1')
            .setDescription(`**Krok 2/4:** Wybierz tydzień dla klanu **${clanName}**\n\nTygodni: ${weeksForClan.length} | Strona ${validPage + 1}/${totalPages}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd paginacji tygodni:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zmiany strony.',
            embeds: [],
            components: []
        });
    }
}

async function handleModyfikujModalSubmit(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Parsuj customId: modyfikuj_modal_phase1|clan|week|userId lub modyfikuj_modal_phase2|round1|clan|week|userId
        const customIdParts = interaction.customId.replace('modyfikuj_modal_', '').split('|');

        let selectedPhase, selectedRound, clan, weekKey, userId;

        logger.info(`[MODYFIKUJ] Modal customId parts: ${JSON.stringify(customIdParts)}`);

        if (customIdParts[0] === 'phase2') {
            selectedPhase = customIdParts[0];
            selectedRound = customIdParts[1];
            clan = customIdParts[2];
            weekKey = customIdParts[3];
            userId = customIdParts[4];
        } else {
            selectedPhase = customIdParts[0];
            selectedRound = null;
            clan = customIdParts[1];
            weekKey = customIdParts[2];
            userId = customIdParts[3];
        }

        logger.info(`[MODYFIKUJ] Modal parsed: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekKey}, userId=${userId}`);

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const newScore = interaction.fields.getTextInputValue('new_score');

        // Walidacja nowego wyniku
        if (!/^\d+$/.test(newScore)) {
            await interaction.reply({
                content: '❌ Wynik musi być liczbą całkowitą.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const newScoreNum = parseInt(newScore);

        // Pobierz dane gracza
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                player = weekData.rounds[0].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            await interaction.reply({
                content: '❌ Nie znaleziono gracza.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const clanName = config.roleDisplayNames[clan];
        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';

        // Pokaż potwierdzenie
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Potwierdzenie zmiany wyniku - ${phaseTitle}${roundText}`)
            .setDescription(`Czy na pewno chcesz zmienić wynik dla **${player.displayName}**?`)
            .setColor('#FF9900')
            .addFields(
                { name: '🎯 Klan', value: clanName, inline: true },
                { name: '📅 Tydzień', value: `${weekNumber}/${year}`, inline: true },
                { name: '📊 Stary wynik', value: player.score.toString(), inline: true },
                { name: '📈 Nowy wynik', value: newScoreNum.toString(), inline: true }
            )
            .setTimestamp();

        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_confirm_${customIdSuffix}|${clan}|${weekNumber}-${year}|${userId}|${newScoreNum}`)
                    .setLabel('🟢 Zamień')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('modyfikuj_cancel')
                    .setLabel('🔴 Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd modala:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas przetwarzania formularza.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModyfikujConfirmButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    if (interaction.customId === 'modyfikuj_cancel') {
        await interaction.update({
            content: '❌ Operacja anulowana.',
            embeds: [],
            components: []
        });
        return;
    }

    try {
        // Parsuj customId: modyfikuj_confirm_phase1|clan|week|userId|score lub modyfikuj_confirm_phase2|round1|clan|week|userId|score
        const customIdParts = interaction.customId.replace('modyfikuj_confirm_', '').split('|');

        let selectedPhase, selectedRound, clan, weekKey, userId, newScore;

        logger.info(`[MODYFIKUJ] Confirm customId parts: ${JSON.stringify(customIdParts)}`);

        if (customIdParts[0] === 'phase2') {
            selectedPhase = customIdParts[0];
            selectedRound = customIdParts[1];
            clan = customIdParts[2];
            weekKey = customIdParts[3];
            userId = customIdParts[4];
            newScore = customIdParts[5];
        } else {
            selectedPhase = customIdParts[0];
            selectedRound = null;
            clan = customIdParts[1];
            weekKey = customIdParts[2];
            userId = customIdParts[3];
            newScore = customIdParts[4];
        }

        logger.info(`[MODYFIKUJ] Confirm parsed: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekKey}, userId=${userId}, newScore=${newScore}`);

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const newScoreNum = parseInt(newScore);

        // Pobierz dane gracza przed zmianą
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                player = weekData.rounds[0].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            await interaction.update({
                content: '❌ Nie znaleziono gracza.',
                embeds: [],
                components: []
            });
            return;
        }

        const oldScore = player.score;

        // Zaktualizuj wynik
        if (selectedPhase === 'phase2') {
            // Aktualizuj wynik w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1') {
                weekData.rounds[0].players = weekData.rounds[0].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            } else if (selectedRound === 'round2') {
                weekData.rounds[1].players = weekData.rounds[1].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            } else if (selectedRound === 'round3') {
                weekData.rounds[2].players = weekData.rounds[2].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            }

            // Przelicz sumę wyników dla wszystkich graczy
            const summedScores = new Map(); // userId -> total score
            for (const round of weekData.rounds) {
                for (const p of round.players) {
                    const current = summedScores.get(p.userId) || 0;
                    summedScores.set(p.userId, current + p.score);
                }
            }

            // Zaktualizuj summary.players z nowymi sumami
            weekData.summary.players = weekData.summary.players.map(p => ({
                ...p,
                score: summedScores.get(p.userId) || 0
            }));

            logger.info(`[MODYFIKUJ] Zaktualizowano sumę dla gracza ${userId}: ${summedScores.get(userId)}`);

            // Zapisz zaktualizowane dane (zachowaj oryginalnego creatora)
            await databaseService.savePhase2Results(
                interaction.guild.id,
                weekNumber,
                year,
                clan,
                weekData.rounds,
                weekData.summary.players,
                weekData.createdBy || interaction.user.id
            );
        } else {
            await databaseService.savePhase1Result(
                interaction.guild.id,
                userId,
                player.displayName,
                newScoreNum,
                weekNumber,
                year,
                clan
            );
        }

        const clanName = config.roleDisplayNames[clan];
        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';

        // Potwierdzenie
        const embed = new EmbedBuilder()
            .setTitle(`✅ Wynik został zmieniony - ${phaseTitle}${roundText}`)
            .setDescription(`Pomyślnie zmieniono wynik dla **${player.displayName}**`)
            .setColor('#00FF00')
            .addFields(
                { name: '🎯 Klan', value: clanName, inline: true },
                { name: '📅 Tydzień', value: `${weekNumber}/${year}`, inline: true },
                { name: '📊 Stary wynik', value: oldScore.toString(), inline: true },
                { name: '📈 Nowy wynik', value: newScoreNum.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Zmodyfikowane przez ${interaction.user.tag}` });

        await interaction.update({
            embeds: [embed],
            components: []
        });

        logger.info(`[MODYFIKUJ] ✅ Zmieniono wynik ${player.displayName}: ${oldScore} → ${newScoreNum} (Klan: ${clan}, Tydzień: ${weekNumber}/${year})`);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd potwierdzenia:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zapisywania zmiany.',
            embeds: [],
            components: []
        });
    }
}

// =============== WYNIKI HANDLERS ===============

async function handleWynikiClanSelect(interaction, sharedState, page = 0) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const selectedClan = interaction.values[0];
        const clanName = config.roleDisplayNames[selectedClan];

        // Pobierz dostępne tygodnie dla wybranego klanu z obu faz
        const allWeeksPhase1 = await databaseService.getAvailableWeeks(interaction.guild.id);
        const allWeeksPhase2 = await databaseService.getAvailableWeeksPhase2(interaction.guild.id);

        const weeksForClanPhase1 = allWeeksPhase1.filter(week => week.clans.includes(selectedClan));
        const weeksForClanPhase2 = allWeeksPhase2.filter(week => week.clans.includes(selectedClan));

        // Połącz tygodnie z obu faz i posortuj po numerze tygodnia (malejąco)
        const combinedWeeks = [];

        // Znajdź wszystkie unikalne tygodnie
        const uniqueWeeks = new Map();

        for (const week of weeksForClanPhase1) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    hasPhase1: true,
                    hasPhase2: false,
                    createdAt: week.createdAt
                });
            } else {
                uniqueWeeks.get(key).hasPhase1 = true;
            }
        }

        for (const week of weeksForClanPhase2) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    hasPhase1: false,
                    hasPhase2: true,
                    createdAt: week.createdAt
                });
            } else {
                uniqueWeeks.get(key).hasPhase2 = true;
            }
        }

        const weeksForClan = Array.from(uniqueWeeks.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        if (weeksForClan.length === 0) {
            await interaction.editReply({
                content: `📊 Brak zapisanych wyników dla klanu **${clanName}**.\n\nUżyj \`/faza1\` lub \`/faza2\` aby rozpocząć zbieranie danych.`,
                components: []
            });
            return;
        }

        // Paginacja: 20 tygodni na stronę
        const weeksPerPage = 20;
        const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
        const startIndex = page * weeksPerPage;
        const endIndex = Math.min(startIndex + weeksPerPage, weeksForClan.length);
        const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

        // Utwórz select menu z tygodniami
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('wyniki_select_week')
            .setPlaceholder('Wybierz tydzień')
            .addOptions(
                weeksOnPage.map(week => {
                    const date = new Date(week.createdAt);
                    const dateStr = date.toLocaleDateString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });

                    const phases = [];
                    if (week.hasPhase1) phases.push('F1');
                    if (week.hasPhase2) phases.push('F2');
                    const phasesLabel = phases.join(', ');

                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`Tydzień ${week.weekNumber}/${week.year} (${phasesLabel})`)
                        .setDescription(`Zapisano: ${dateStr}`)
                        .setValue(`${selectedClan}|${week.weekNumber}-${week.year}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski nawigacji jeśli jest więcej niż jedna strona
        if (totalPages > 1) {
            const navRow = new ActionRowBuilder();

            const prevButton = new ButtonBuilder()
                .setCustomId(`wyniki_weeks_prev|${selectedClan}|${page}`)
                .setLabel('◀ Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0);

            const nextButton = new ButtonBuilder()
                .setCustomId(`wyniki_weeks_next|${selectedClan}|${page}`)
                .setLabel('Następna ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1);

            navRow.addComponents(prevButton, nextButton);
            components.push(navRow);
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Wyniki - Wszystkie Fazy')
            .setDescription(`**Krok 2/2:** Wybierz tydzień dla klanu **${clanName}**:`)
            .setColor('#0099FF')
            .setFooter({ text: `Strona ${page + 1}/${totalPages} | Łącznie tygodni: ${weeksForClan.length}` })
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd wyboru klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru klanu.',
            components: []
        });
    }
}

async function handleWynikiWeekPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format customId: wyniki_weeks_prev|clanKey|page lub wyniki_weeks_next|clanKey|page
        const customIdParts = interaction.customId.split('|');
        const action = customIdParts[0]; // np. "wyniki_weeks_prev"
        const clan = customIdParts[1];
        const currentPage = parseInt(customIdParts[2]);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'wyniki_weeks_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'wyniki_weeks_next') {
            newPage = currentPage + 1;
        }

        // Wywołaj ponownie handleWynikiClanSelect z nową stroną
        // Musimy przygotować mock interaction z values
        const mockInteraction = {
            ...interaction,
            values: [clan],
            deferUpdate: async () => {} // Mock - już jest deferred
        };

        await handleWynikiClanSelect(mockInteraction, sharedState, newPage);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd paginacji tygodni:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zmiany strony.',
            embeds: [],
            components: []
        });
    }
}

async function handleWynikiWeekSelect(interaction, sharedState, view = 'phase1') {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const selectedValue = interaction.values[0]; // Format: "clanKey|weekNumber-year"
        const [clan, weekKey] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        const clanName = config.roleDisplayNames[clan];

        // Pobierz dane z obu faz
        const weekDataPhase1 = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
        const weekDataPhase2 = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekDataPhase1 && !weekDataPhase2) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        // Wyświetl wyniki w zależności od wybranego widoku (domyślnie Faza 1)
        await showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd wyświetlania wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyświetlania wyników.',
            components: []
        });
    }
}

async function handleWynikiViewButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format: wyniki_view|clanKey|weekNumber-year|view
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const view = parts[3];

        const [weekNumber, year] = weekKey.split('-').map(Number);

        // Pobierz dane z obu faz
        const weekDataPhase1 = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
        const weekDataPhase2 = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekDataPhase1 && !weekDataPhase2) {
            await interaction.update({
                content: '❌ Brak danych.',
                embeds: [],
                components: []
            });
            return;
        }

        await showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config, true);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd przełączania widoku:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas przełączania widoku.',
            embeds: [],
            components: []
        });
    }
}

async function handleWynikiPhase2ViewButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format: wyniki_phase2_view|clanKey|weekNumber-year|view
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const view = parts[3];

        const [weekNumber, year] = weekKey.split('-').map(Number);

        const weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData) {
            await interaction.update({
                content: '❌ Brak danych.',
                embeds: [],
                components: []
            });
            return;
        }

        await showPhase2Results(interaction, weekData, clan, weekNumber, year, view, config, true);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd przełączania widoku Phase 2:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas przełączania widoku.',
            embeds: [],
            components: []
        });
    }
}

async function showPhase2Results(interaction, weekData, clan, weekNumber, year, view, config, isUpdate = false) {
    const clanName = config.roleDisplayNames[clan];

    // Wybierz dane do wyświetlenia w zależności od widoku
    let players;
    let viewTitle;

    if (view === 'round1' && weekData.rounds && weekData.rounds[0]) {
        players = weekData.rounds[0].players;
        viewTitle = 'Runda 1';
    } else if (view === 'round2' && weekData.rounds && weekData.rounds[1]) {
        players = weekData.rounds[1].players;
        viewTitle = 'Runda 2';
    } else if (view === 'round3' && weekData.rounds && weekData.rounds[2]) {
        players = weekData.rounds[2].players;
        viewTitle = 'Runda 3';
    } else {
        // Domyślnie pokaż sumę
        players = weekData.summary ? weekData.summary.players : weekData.players;
        viewTitle = 'Suma';
    }

    if (!players || players.length === 0) {
        const replyMethod = isUpdate ? 'update' : 'editReply';
        await interaction[replyMethod]({
            content: `❌ Brak danych dla wybranego widoku.`,
            embeds: [],
            components: []
        });
        return;
    }

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 16;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        const isCaller = player.userId === interaction.user.id;
        const displayName = isCaller ? `**${player.displayName}**` : player.displayName;

        return `${progressBar} ${position}. ${displayName} - ${player.score}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`📊 Wyniki - Faza 2 - ${viewTitle}`)
        .setDescription(`**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\n${resultsText}`)
        .setColor('#0099FF')
        .setFooter({ text: `Łącznie graczy: ${sortedPlayers.length} | Zapisano: ${new Date(weekData.createdAt).toLocaleDateString('pl-PL')}` })
        .setTimestamp();

    // Przyciski nawigacji między rundami
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round1`)
                .setLabel('Runda 1')
                .setStyle(view === 'round1' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round2`)
                .setLabel('Runda 2')
                .setStyle(view === 'round2' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round3`)
                .setLabel('Runda 3')
                .setStyle(view === 'round3' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|summary`)
                .setLabel('Suma')
                .setStyle(view === 'summary' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

    const replyMethod = isUpdate ? 'update' : 'editReply';
    await interaction[replyMethod]({
        embeds: [embed],
        components: [navRow]
    });
}

async function showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config, isUpdate = false) {
    const clanName = config.roleDisplayNames[clan];

    // Wybierz dane do wyświetlenia w zależności od widoku
    let players;
    let viewTitle;
    let weekData;

    if (view === 'phase1' && weekDataPhase1) {
        players = weekDataPhase1.players;
        viewTitle = 'Faza 1';
        weekData = weekDataPhase1;
    } else if (view === 'round1' && weekDataPhase2?.rounds?.[0]) {
        players = weekDataPhase2.rounds[0].players;
        viewTitle = 'Runda 1';
        weekData = weekDataPhase2;
    } else if (view === 'round2' && weekDataPhase2?.rounds?.[1]) {
        players = weekDataPhase2.rounds[1].players;
        viewTitle = 'Runda 2';
        weekData = weekDataPhase2;
    } else if (view === 'round3' && weekDataPhase2?.rounds?.[2]) {
        players = weekDataPhase2.rounds[2].players;
        viewTitle = 'Runda 3';
        weekData = weekDataPhase2;
    } else if (view === 'summary' && weekDataPhase2) {
        players = weekDataPhase2.summary ? weekDataPhase2.summary.players : weekDataPhase2.players;
        viewTitle = 'Suma';
        weekData = weekDataPhase2;
    } else {
        // Fallback - pokaż pierwszą dostępną fazę
        if (weekDataPhase1) {
            players = weekDataPhase1.players;
            viewTitle = 'Faza 1';
            weekData = weekDataPhase1;
            view = 'phase1';
        } else if (weekDataPhase2) {
            players = weekDataPhase2.summary ? weekDataPhase2.summary.players : weekDataPhase2.players;
            viewTitle = 'Suma';
            weekData = weekDataPhase2;
            view = 'summary';
        }
    }

    if (!players || players.length === 0) {
        const replyMethod = isUpdate ? 'update' : 'editReply';
        await interaction[replyMethod]({
            content: `❌ Brak danych dla wybranego widoku.`,
            embeds: [],
            components: []
        });
        return;
    }

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    // Dla Fazy 1 oblicz TOP30 i pobierz historyczne rekordy
    let descriptionExtra = '';
    let playerHistoricalRecords = new Map(); // userId -> bestScore

    if (view === 'phase1') {
        const top30Players = sortedPlayers.slice(0, 30);
        const top30Sum = top30Players.reduce((sum, player) => sum + player.score, 0);

        // Pobierz TOP30 z poprzedniego tygodnia
        const { databaseService } = interaction.client;
        let top30ProgressText = '';

        if (databaseService) {
            try {
                // Znajdź poprzedni tydzień
                const availableWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
                const weeksForClan = availableWeeks
                    .filter(w => w.clans.includes(clan))
                    .sort((a, b) => {
                        if (a.year !== b.year) return b.year - a.year;
                        return b.weekNumber - a.weekNumber;
                    });

                // Znajdź poprzedni tydzień przed aktualnym
                const currentWeekIndex = weeksForClan.findIndex(w =>
                    w.weekNumber === weekNumber && w.year === year
                );

                if (currentWeekIndex !== -1 && currentWeekIndex < weeksForClan.length - 1) {
                    const previousWeek = weeksForClan[currentWeekIndex + 1];
                    const previousWeekData = await databaseService.getPhase1Results(
                        interaction.guild.id,
                        previousWeek.weekNumber,
                        previousWeek.year,
                        clan
                    );

                    if (previousWeekData && previousWeekData.players) {
                        const previousTop30 = [...previousWeekData.players]
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 30);
                        const previousTop30Sum = previousTop30.reduce((sum, p) => sum + p.score, 0);
                        const top30Difference = top30Sum - previousTop30Sum;

                        if (top30Difference > 0) {
                            top30ProgressText = `\n**Progres:** +${top30Difference.toLocaleString('pl-PL')} pkt`;
                        } else if (top30Difference < 0) {
                            top30ProgressText = `\n**Regres:** ${top30Difference.toLocaleString('pl-PL')} pkt`;
                        }
                    }
                }
            } catch (error) {
                logger.error('[WYNIKI] Błąd pobierania TOP30 z poprzedniego tygodnia:', error);
            }
        }

        descriptionExtra = `**TOP30:** ${top30Sum.toLocaleString('pl-PL')} pkt${top30ProgressText}\n`;

        // Pobierz historyczne rekordy dla wszystkich graczy
        if (databaseService) {
            for (const player of sortedPlayers) {
                if (player.userId) {
                    const historicalBest = await databaseService.getPlayerHistoricalBestScore(
                        interaction.guild.id,
                        player.userId,
                        weekNumber,
                        year,
                        clan
                    );
                    if (historicalBest !== null) {
                        playerHistoricalRecords.set(player.userId, historicalBest);
                    }
                }
            }
        }
    }

    // Przechowuj informacje o progresie dla każdego gracza (do TOP3)
    const playerProgressData = [];

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 16;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        const isCaller = player.userId === interaction.user.id;
        const displayName = isCaller ? `**${player.displayName}**` : player.displayName;

        // Dla Fazy 1 dodaj progres względem historycznego rekordu
        let progressText = '';
        let difference = 0;
        if (view === 'phase1' && player.userId && playerHistoricalRecords.has(player.userId)) {
            const historicalBest = playerHistoricalRecords.get(player.userId);
            difference = player.score - historicalBest;

            if (difference > 0) {
                // Nowy rekord - użyj indeksu górnego (superscript) z trójkątem
                const superscriptMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                const superscriptNumber = ('' + difference).split('').map(c => superscriptMap[c] || c).join('');
                progressText = ` ▲${superscriptNumber}`;
            } else if (difference < 0 && player.score > 0) {
                // Poniżej rekordu - użyj indeksu dolnego (subscript) z trójkątem - tylko jeśli wynik > 0
                const subscriptMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
                const subscriptNumber = ('' + Math.abs(difference)).split('').map(c => subscriptMap[c] || c).join('');
                progressText = ` ▼${subscriptNumber}`;
            }

            // Zapisz dane do TOP3
            playerProgressData.push({
                displayName: player.displayName,
                difference: difference,
                userId: player.userId,
                score: player.score
            });
        }

        return `${progressBar} ${position}. ${displayName} - ${player.score}${progressText}`;
    }).join('\n');

    // Dla Fazy 1: oblicz TOP3 progresów i regresów
    let top3Section = '';
    if (view === 'phase1' && playerProgressData.length > 0) {
        // TOP3 najlepsze progresy (największe dodatnie wartości)
        const topProgress = [...playerProgressData]
            .filter(p => p.difference > 0)
            .sort((a, b) => b.difference - a.difference)
            .slice(0, 3);

        // TOP3 największe regresy (największe ujemne wartości) - wykluczamy osoby z wynikiem 0
        const topRegress = [...playerProgressData]
            .filter(p => p.difference < 0 && p.score > 0)
            .sort((a, b) => a.difference - b.difference)
            .slice(0, 3);

        if (topProgress.length > 0 || topRegress.length > 0) {
            top3Section = '\n\n';

            // Oblicz sumę wszystkich progresów i regresów
            const totalProgressSum = playerProgressData
                .filter(p => p.difference > 0)
                .reduce((sum, p) => sum + p.difference, 0);

            const totalRegressSum = playerProgressData
                .filter(p => p.difference < 0 && p.score > 0)
                .reduce((sum, p) => sum + Math.abs(p.difference), 0);

            if (topProgress.length > 0) {
                top3Section += '**🏆 TOP3 Progres:**\n';
                topProgress.forEach((p, idx) => {
                    const isCaller = p.userId === interaction.user.id;
                    const displayName = isCaller ? `**${p.displayName}**` : p.displayName;
                    const emoji = isCaller ? ' <a:PepeOklaski:1259556219312410760>' : '';
                    top3Section += `${idx + 1}. ${displayName} (+${p.difference})${emoji}\n`;
                });

                if (totalProgressSum > 0) {
                    top3Section += `**Suma progresu:** +${totalProgressSum.toLocaleString('pl-PL')} pkt\n`;
                }
            }

            if (topRegress.length > 0) {
                if (topProgress.length > 0) top3Section += '\n';
                top3Section += '**💀 TOP3 Regres:**\n';
                topRegress.forEach((p, idx) => {
                    const isCaller = p.userId === interaction.user.id;
                    const displayName = isCaller ? `**${p.displayName}**` : p.displayName;
                    const emoji = isCaller ? ' <a:X_Uwaga:1297531538186965003>' : '';
                    top3Section += `${idx + 1}. ${displayName} (${p.difference})${emoji}\n`;
                });

                if (totalRegressSum > 0) {
                    top3Section += `**Suma regresu:** -${totalRegressSum.toLocaleString('pl-PL')} pkt\n`;
                }
            }
        }
    }

    // Oblicz timestamp usunięcia (15 minut od teraz - zawsze resetuj przy każdym kliknięciu)
    const messageCleanupService = interaction.client.messageCleanupService;
    const deleteAt = Date.now() + (15 * 60 * 1000);
    const deleteTimestamp = Math.floor(deleteAt / 1000);

    const embed = new EmbedBuilder()
        .setTitle(`📊 Wyniki - ${viewTitle}`)
        .setDescription(`**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n${descriptionExtra}\n${resultsText}${top3Section}\n\n⏱️ Wygasa: <t:${deleteTimestamp}:R>`)
        .setColor('#0099FF')
        .setFooter({ text: `Łącznie graczy: ${sortedPlayers.length} | Zapisano: ${new Date(weekData.createdAt).toLocaleDateString('pl-PL')}` })
        .setTimestamp();

    // Przyciski nawigacji między fazami
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|phase1`)
                .setLabel('Faza 1')
                .setStyle(view === 'phase1' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase1),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round1`)
                .setLabel('Runda 1')
                .setStyle(view === 'round1' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[0]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round2`)
                .setLabel('Runda 2')
                .setStyle(view === 'round2' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[1]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round3`)
                .setLabel('Runda 3')
                .setStyle(view === 'round3' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[2]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|summary`)
                .setLabel('Suma Faza 2')
                .setStyle(view === 'summary' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2)
        );

    const replyMethod = isUpdate ? 'update' : 'editReply';
    const response = await interaction[replyMethod]({
        embeds: [embed],
        components: [navRow]
    });

    // Zaplanuj usunięcie wiadomości po 15 minutach (resetuj timer przy każdym kliknięciu)
    // Dla update, message jest w interaction.message
    // Dla editReply, message jest w response
    const messageToSchedule = isUpdate ? interaction.message : response;

    if (messageToSchedule && messageCleanupService) {
        // Usuń stary scheduled deletion jeśli istnieje
        if (isUpdate) {
            await messageCleanupService.removeScheduledMessage(messageToSchedule.id);
        }

        // Dodaj nowy scheduled deletion z nowym czasem (15 minut od teraz)
        await messageCleanupService.scheduleMessageDeletion(
            messageToSchedule.id,
            messageToSchedule.channelId,
            deleteAt,
            interaction.user.id
        );
    }
}

async function handleWynikiCommand(interaction, sharedState) {
    const { config } = sharedState;

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    if (!allowedChannels.includes(interaction.channelId)) {
        await interaction.reply({
            content: '❌ Komenda `/wyniki` jest dostępna tylko na określonych kanałach.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Utwórz select menu z klanami (bez parametru phase)
        const clanOptions = Object.entries(config.targetRoles).map(([clanKey, roleId]) => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(config.roleDisplayNames[clanKey])
                .setValue(clanKey);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('wyniki_select_clan')
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📊 Wyniki - Wszystkie Fazy')
            .setDescription('**Krok 1/2:** Wybierz klan, dla którego chcesz zobaczyć wyniki:')
            .setColor('#0099FF')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd pobierania wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania wyników.'
        });
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands,
    unregisterCommand,
    confirmationData
};