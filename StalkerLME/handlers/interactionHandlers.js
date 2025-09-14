const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const messages = require('../config/messages');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

const confirmationData = new Map();

async function handleInteraction(interaction, sharedState, config) {
    const { client, databaseService, ocrService, punishmentService, reminderService, survivorService } = sharedState;

    try {
        if (interaction.isCommand()) {
            await handleSlashCommand(interaction, config, databaseService, ocrService, punishmentService, reminderService, survivorService);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction, config, reminderService);
        } else if (interaction.isButton()) {
            await handleButton(interaction, sharedState);
        }
    } catch (error) {
        logger.error('[INTERACTION] ❌ Błąd obsługi interakcji:', error.message);
        logger.error('[INTERACTION] ❌ Stack trace:', error.stack);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Wystąpił błąd')
            .setDescription(messages.errors.unknownError)
            .setColor('#FF0000')
            .setTimestamp();
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
}

async function handleSlashCommand(interaction, config, databaseService, ocrService, punishmentService, reminderService, survivorService) {
    if (!hasPermission(interaction.member, config.allowedPunishRoles)) {
        await interaction.reply({ content: messages.errors.noPermission, ephemeral: true });
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
            await handleDecodeCommand(interaction, config, survivorService);
            break;
        default:
            await interaction.reply({ content: 'Nieznana komenda!', ephemeral: true });
    }
}

async function handlePunishCommand(interaction, config, ocrService, punishmentService) {
    const attachment = interaction.options.getAttachment('image');
    
    if (!attachment) {
        await interaction.reply({ content: messages.errors.noImage, ephemeral: true });
        return;
    }
    
    if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: messages.errors.invalidImage, ephemeral: true });
        return;
    }
    
    try {
        // Najpierw odpowiedz z informacją o rozpoczęciu analizy
        await interaction.reply({ content: '🔍 Odświeżam cache członków i analizuję zdjęcie...', ephemeral: true });
        
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
        await interaction.reply({ content: messages.errors.noImage, ephemeral: true });
        return;
    }
    
    if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: messages.errors.invalidImage, ephemeral: true });
        return;
    }
    
    try {
        // Najpierw odpowiedz z informacją o rozpoczęciu analizy
        await interaction.reply({ content: '🔍 Odświeżam cache członków i analizuję zdjęcie...', ephemeral: true });
        
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
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', ephemeral: true });
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
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', ephemeral: true });
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
            await interaction.editReply({ content: 'Nie znaleziono roli!', ephemeral: true });
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

async function handleSelectMenu(interaction, config, reminderService) {
    if (interaction.customId === 'reminder_role_select') {
        const selectedRole = interaction.values[0];
        const roleId = config.targetRoles[selectedRole];
        
        if (!roleId) {
            await interaction.reply({ content: 'Nieprawidłowa rola!', ephemeral: true });
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
    }
}

async function handleButton(interaction, sharedState) {
    const { config, databaseService, punishmentService } = sharedState;
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
            await interaction.reply({ content: 'Dane potwierdzenia wygasły. Spróbuj ponownie.', ephemeral: true });
            return;
        }
        
        // Sprawdź czy użytkownik ma prawo do potwierdzenia
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', ephemeral: true });
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
            await interaction.followUp({ content: messages.errors.unknownError, ephemeral: true });
        }
    } else if (interaction.customId.startsWith('vacation_')) {
        const parts = interaction.customId.split('_');
        const choice = parts[1]; // 'yes' lub 'no'
        const vacationId = parts[2];
        
        const data = confirmationData.get(vacationId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', ephemeral: true });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', ephemeral: true });
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
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', ephemeral: true });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', ephemeral: true });
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
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją anulować.', ephemeral: true });
            return;
        }
        
        confirmationData.delete(confirmationId);
        
        await interaction.update({ 
            content: '❌ Akcja została anulowana.', 
            components: [], 
            embeds: [] 
        });
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
            .setDescription('Dekoduj kod buildu Survivor.io i wyświetl dane o ekwipunku')
            .addStringOption(option =>
                option.setName('code')
                    .setDescription('Kod buildu Survivor.io do zdekodowania')
                    .setRequired(true)
            )
    ];
    
    try {
        logger.info('[COMMANDS] 🔄 Rejestracja komend slash...');
        await client.application.commands.set(commands);
        logger.info('[COMMANDS] ✅ Komendy slash zostały zarejestrowane');
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
            ephemeral: true
        });
        return;
    }

    const enabled = interaction.options.getBoolean('enabled');

    if (enabled === null) {
        // Sprawdź aktualny stan
        const currentState = config.ocr.detailedLogging.enabled;
        await interaction.reply({
            content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
            ephemeral: true
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
        ephemeral: true
    });
}

async function handleDecodeCommand(interaction, config, survivorService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    const code = interaction.options.getString('code');

    if (!code || code.trim().length === 0) {
        await interaction.reply({
            content: '❌ Nie podano kodu do dekodowania.',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply();

    try {
        const buildData = survivorService.decodeBuild(code.trim());

        if (!buildData.success) {
            await interaction.editReply({
                content: `❌ **Nie udało się zdekodować kodu**\n\n**Błąd:** ${buildData.error}\n**Kod:** \`${code}\``,
                ephemeral: true
            });
            return;
        }

        const embed = survivorService.createBuildEmbed(buildData.data, interaction.user.tag, code);

        await interaction.editReply({
            embeds: [embed]
        });

        logger.info(`✅ Pomyślnie zdekodowano build Survivor.io dla ${interaction.user.tag}`);

    } catch (error) {
        logger.error(`❌ Błąd dekodowania build Survivor.io: ${error.message}`);

        await interaction.editReply({
            content: `❌ **Wystąpił błąd podczas dekodowania**\n\n**Błąd:** ${error.message}\n**Kod:** \`${code}\``,
            ephemeral: true
        });
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands,
    confirmationData
};