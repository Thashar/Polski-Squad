const {
    SlashCommandBuilder, REST, Routes,
    EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs').promises;
const OligopolyService = require('../services/oligopolyService');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getPolandParts } = require('../utils/timezone');

const logger = createBotLogger('Kontroler');

/**
 * Obsługuje wszystkie interakcje Discord dla Kontroler bot
 */
async function handleInteraction(interaction, config, lotteryService = null) {
    try {
        if (interaction.isAutocomplete()) {
            // Obsługa autocomplete
            if (interaction.commandName === 'kawka') {
                await handleKawkaAutocomplete(interaction);
            }
        } else if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'ocr-debug':
                    await handleOcrDebugCommand(interaction, config);
                    break;
                case 'lottery':
                    await handleLotteryCommand(interaction, config, lotteryService);
                    break;
                case 'lottery-reroll':
                    await handleLotteryRerollCommand(interaction, config, lotteryService);
                    break;
                case 'lottery-remove':
                    await handleLotteryRemoveCommand(interaction, config, lotteryService);
                    break;
                case 'lottery-history':
                    await handleLotteryHistoryCommand(interaction, config, lotteryService);
                    break;
                case 'lottery-debug':
                    await handleLotteryDebugCommand(interaction, config, lotteryService);
                    break;
                case 'oligopoly':
                    await handleOligopolyCommand(interaction, config);
                    break;
                case 'oligopoly-review':
                    await handleOligopolyReviewCommand(interaction, config);
                    break;
                case 'oligopoly-clear':
                    await handleOligopolyClearCommand(interaction, config);
                    break;
                case 'oligopoly-list':
                    await handleOligopolyListCommand(interaction, config);
                    break;
                case 'kawka':
                    await handleKawkaCommand(interaction, config);
                    break;
                default:
                    await interaction.reply({ content: 'Nieznana komenda!', ephemeral: true });
            }
        } else if (interaction.isStringSelectMenu()) {
            // Obsługa Select Menu
            switch (interaction.customId) {
                case 'lottery_remove_planned_select':
                    await handleLotteryRemovePlannedSelect(interaction, config, lotteryService);
                    break;
                case 'lottery_remove_historical_select':
                    await handleLotteryRemoveHistoricalSelect(interaction, config, lotteryService);
                    break;
                case 'lottery_reroll_select':
                    await handleRerollLotterySelect(interaction, config, lotteryService);
                    break;
                default:
                    await interaction.reply({ content: 'Nieznane menu wyboru!', ephemeral: true });
            }
        } else if (interaction.isModalSubmit()) {
            // Obsługa Modal Submit
            if (interaction.customId.startsWith('kawka_modal_')) {
                await handleKawkaModalSubmit(interaction, config);
            } else {
                await interaction.reply({ content: 'Nieznany modal!', ephemeral: true });
            }
        } else if (interaction.isButton()) {
            // Obsługa Button
            if (interaction.customId.startsWith('lottery_remove_planned_confirm_')) {
                await handleLotteryRemovePlannedConfirm(interaction, config, lotteryService);
            } else if (interaction.customId.startsWith('vote_')) {
                // Obsługa przycisków głosowania
                const votingService = interaction.client.votingService;
                if (votingService) {
                    const handled = await votingService.handleVoteButton(interaction);
                    if (!handled) {
                        await interaction.reply({ content: 'Nieznany przycisk głosowania!', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'Serwis głosowania niedostępny!', ephemeral: true });
                }
            } else {
                switch (interaction.customId) {
                    case 'lottery_history_prev':
                        await handleLotteryHistoryNavigation(interaction, config, lotteryService, 'prev');
                        break;
                    case 'lottery_history_next':
                        await handleLotteryHistoryNavigation(interaction, config, lotteryService, 'next');
                        break;
                    case 'lottery_history_stats':
                        await handleLotteryHistoryStats(interaction, config, lotteryService);
                        break;
                    case 'lottery_history_back':
                        await handleLotteryHistoryCommand(interaction, config, lotteryService, true);
                        break;
                    default:
                        await interaction.reply({ content: 'Nieznany przycisk!', ephemeral: true });
                }
            }
        }
    } catch (error) {
        logger.error('❌ Błąd obsługi interakcji:', error);

        // Dla autocomplete nie można używać reply/followUp - tylko respond
        if (interaction.isAutocomplete()) {
            try {
                await interaction.respond([]);
            } catch (respondError) {
                logger.error('❌ Nie można wysłać odpowiedzi autocomplete:', respondError);
            }
        } else {
            const errorMessage = '❌ Wystąpił błąd podczas wykonywania komendy.';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
}

/**
 * Obsługuje komendę debug OCR
 */
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
    
    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.username}`);
    
    await interaction.reply({
        content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
        ephemeral: true
    });
}

/**
 * Obsługuje komendę lottery
 */
async function handleLotteryCommand(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    const targetRole = interaction.options.getRole('rola');
    const clanKey = interaction.options.getString('klan');
    const frequency = interaction.options.getInteger('częstotliwość');
    const dateString = interaction.options.getString('data');
    const timeString = interaction.options.getString('godzina');
    const winnersCount = interaction.options.getInteger('ilość');
    const channelId = interaction.options.getString('kanał');

    // Walidacje
    if (!config.lottery.clans[clanKey]) {
        const availableClans = Object.keys(config.lottery.clans).map(key => 
            `\`${key}\` (${config.lottery.clans[key].displayName})`
        ).join(', ');
        
        await interaction.reply({
            content: `❌ Nieprawidłowy klan. Dostępne klany: ${availableClans}`,
            ephemeral: true
        });
        return;
    }

    // Walidacja daty
    const dateMatch = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!dateMatch) {
        await interaction.reply({
            content: '❌ Nieprawidłowy format daty. Użyj formatu dd.mm.rrrr (np. 15.03.2025)',
            ephemeral: true
        });
        return;
    }
    
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]);
    const year = parseInt(dateMatch[3]);
    
    // Sprawdź czy data jest prawidłowa
    const drawDate = new Date(year, month - 1, day);
    if (drawDate.getDate() !== day || drawDate.getMonth() !== month - 1 || drawDate.getFullYear() !== year) {
        await interaction.reply({
            content: '❌ Nieprawidłowa data. Sprawdź czy podana data istnieje.',
            ephemeral: true
        });
        return;
    }
    
    // Sprawdź czy data nie jest w przeszłości i nie przekracza limitu 365 dni (względem POLSKIEJ daty "dziś")
    const plNow = getPolandParts();
    const today = new Date(Date.UTC(plNow.year, plNow.month - 1, plNow.day));
    const drawDay = new Date(Date.UTC(year, month - 1, day));

    if (drawDay < today) {
        await interaction.reply({
            content: '❌ Data następnego losowania nie może być w przeszłości.',
            ephemeral: true
        });
        return;
    }

    // Sprawdź czy data nie przekracza limitu 365 dni
    const maxDate = new Date(today);
    maxDate.setUTCDate(today.getUTCDate() + 365);

    if (drawDay > maxDate) {
        await interaction.reply({
            content: '❌ Data następnego losowania nie może być dalej niż 365 dni w przyszłości.',
            ephemeral: true
        });
        return;
    }

    // Parsowanie godziny
    const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
        await interaction.reply({
            content: '❌ Nieprawidłowy format godziny. Użyj formatu HH:MM (np. 19:00)',
            ephemeral: true
        });
        return;
    }

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        await interaction.reply({
            content: '❌ Nieprawidłowa godzina. Godzina musi być 0-23, minuty 0-59.',
            ephemeral: true
        });
        return;
    }

    if (frequency < 0 || frequency > 365) {
        await interaction.reply({
            content: '❌ Częstotliwość musi być między 0 a 365 dni. (0 = jednorazowa loteria)',
            ephemeral: true
        });
        return;
    }

    if (winnersCount < 1 || winnersCount > 20) {
        await interaction.reply({
            content: '❌ Liczba zwycięzców musi być między 1 a 20.',
            ephemeral: true
        });
        return;
    }

    // Sprawdź czy kanał istnieje
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
        await interaction.reply({
            content: '❌ Podany kanał nie istnieje.',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const result = await lotteryService.createLottery(interaction, {
            targetRole,
            clanKey,
            frequency,
            drawDate,
            hour,
            minute,
            winnersCount,
            channelId
        });

        if (result.success) {
            const clan = config.lottery.clans[clanKey];
            // nextDraw jest już w UTC, więc konwertujemy na polski czas poprawnie
            const nextDrawUTC = new Date(result.lottery.nextDraw);
            const nextDraw = lotteryService.convertUTCToPolishTime(nextDrawUTC);

            await interaction.editReply({
                content: `✅ **Loteria została utworzona pomyślnie!**\n\n` +
                        `🎰 **Nazwa:** ${result.lottery.name}\n` +
                        `🎯 **Rola docelowa:** ${targetRole.name}\n` +
                        `🏰 **Klan:** ${clan.displayName}\n` +
                        `📅 **Częstotliwość:** ${frequency === 0 ? 'Jednorazowa' : `Co ${frequency} dni`}\n` +
                        `⏰ **Pierwsza data:** ${dateString} o ${timeString}\n` +
                        `🏆 **Liczba zwycięzców:** ${winnersCount}\n` +
                        `📺 **Kanał wyników:** <#${channelId}>\n` +
                        `⏭️ **Następne losowanie:** ${nextDraw}\n\n` +
                        `🆔 **ID loterii:** \`${result.lottery.id}\``
            });

            logger.info(`✅ ${interaction.user.username} utworzył loterię: ${result.lottery.name}`);
        }
    } catch (error) {
        await interaction.editReply({
            content: `❌ Błąd podczas tworzenia loterii: ${error.message}`
        });
        logger.error('❌ Błąd tworzenia loterii:', error);
    }
}

/**
 * Obsługuje komendę lottery-reroll
 */
async function handleLotteryRerollCommand(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // Pobierz historię loterii
        const history = await lotteryService.getLotteryHistory();
        
        if (history.length === 0) {
            await interaction.editReply({
                content: '📋 **Brak historii loterii do ponownego losowania.**\n\n💡 Przeprowadź najpierw jakąś loterię używając `/lottery` lub `/lottery-test`.'
            });
            return;
        }

        // Stwórz Select Menu z historią loterii (ostatnie 20)
        
        const recentHistory = history.slice(-20); // Ostatnie 20 loterii
        const selectOptions = recentHistory.map((result, index) => {
            const originalIndex = history.length - recentHistory.length + index;
            const date = new Date(result.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
            const time = new Date(result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw'});
            
            return {
                label: `${result.lotteryName}`,
                description: `${date} ${time} | ${result.participantCount} uczestników | ${result.winners.length} zwycięzców`,
                value: originalIndex.toString(),
                emoji: '🎲'
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('lottery_reroll_select')
            .setPlaceholder('🎲 Wybierz loterię do ponownego losowania...')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(selectOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('🎲 PONOWNE LOSOWANIE')
            .setDescription(`Wybierz loterię z historii do ponownego losowania.\n\n` +
                           `📊 **Historia loterii:** ${history.length} (pokazano ostatnie ${Math.min(20, history.length)})\n\n` +
                           `ℹ️ **Jak to działa:**\n` +
                           `• Losowanie spośród uczestników którzy nie wygrali w oryginalnej loterii\n` +
                           `• Sprawdza aktualne role użytkowników\n` +
                           `• Domyślnie wybiera 1 dodatkowego zwycięzcę`)
            .setColor('#ffa500')
            .setFooter({ 
                text: `Żądanie od ${interaction.user.username}` 
            })
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

    } catch (error) {
        await interaction.editReply({
            content: `❌ Błąd podczas ładowania historii loterii: ${error.message}`
        });
        logger.error('❌ Błąd ładowania historii dla reroll:', error);
    }
}

/**
 * Obsługuje komendę lottery-remove
 */
async function handleLotteryRemoveCommand(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    const removeType = interaction.options.getString('typ');
    
    if (removeType === 'planned') {
        await handlePlannedLotteryRemove(interaction, config, lotteryService);
    } else if (removeType === 'historical') {
        await handleHistoricalLotteryRemove(interaction, config, lotteryService);
    }
}

/**
 * Obsługuje usuwanie zaplanowanych loterii
 */
async function handlePlannedLotteryRemove(interaction, config, lotteryService) {
    const activeLotteries = lotteryService.getActiveLotteries();

    if (activeLotteries.length === 0) {
        await interaction.reply({
            content: '📋 **Brak zaplanowanych loterii do usunięcia.**\n\n💡 Użyj `/lottery` aby utworzyć nową loterię.',
            ephemeral: true
        });
        return;
    }

    // Stwórz Select Menu z zaplanowanymi loteriami
    
    const selectOptions = activeLotteries.map(lottery => {
        // Użyj nextDraw zamiast daty z ID loterii
        const nextDrawDate = lottery.nextDraw ? new Date(lottery.nextDraw) : null;
        const formattedDate = nextDrawDate ? nextDrawDate.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jednorazowa - wykonana';
        const clan = config.lottery.clans[lottery.clanKey];
        
        return {
            label: `${lottery.name}`,
            description: `Data: ${formattedDate} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')} | Częst: ${lottery.frequency === 0 ? 'Jednorazowa' : `Co ${lottery.frequency}d`}`,
            value: lottery.id,
            emoji: '🎰'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('lottery_remove_planned_select')
        .setPlaceholder('🗑️ Wybierz zaplanowaną loterię do usunięcia...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('🗑️ USUWANIE ZAPLANOWANEJ LOTERII')
        .setDescription(`Wybierz zaplanowaną loterię do usunięcia z listy poniżej.\n\n` +
                       `📊 **Zaplanowanych loterii:** ${activeLotteries.length}\n\n` +
                       `⚠️ **Uwaga:** Usunięcie loterii zatrzyma wszystkie automatyczne losowania dla wybranej loterii.`)
        .setColor('#ff6b6b')
        .setFooter({ 
            text: `Żądanie od ${interaction.user.username}` 
        })
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

/**
 * Obsługuje usuwanie historycznych loterii
 */
async function handleHistoricalLotteryRemove(interaction, config, lotteryService) {
    const history = await lotteryService.getLotteryHistory();

    if (history.length === 0) {
        await interaction.reply({
            content: '📋 **Brak historycznych loterii do usunięcia.**\n\n💡 Przeprowadź najpierw jakąś loterię używając `/lottery` lub `/lottery-test`.',
            ephemeral: true
        });
        return;
    }

    // Stwórz Select Menu z ostatnimi 20 loteriami historycznymi
    
    const recentHistory = history.slice(-20); // Ostatnie 20 loterii
    const selectOptions = recentHistory.map((result, index) => {
        const originalIndex = history.length - recentHistory.length + index;
        const date = new Date(result.originalDate || result.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
        const time = new Date(result.originalDate || result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw'});
        
        return {
            label: `${result.lotteryName}`,
            description: `${date} ${time} | ${result.participantCount || result.originalParticipantCount} uczestników | ${(result.winners || result.newWinners || []).length} zwycięzców`,
            value: originalIndex.toString(),
            emoji: result.lotteryId && result.lotteryId.includes('_reroll') ? '🔄' : '🎲'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('lottery_remove_historical_select')
        .setPlaceholder('🗑️ Wybierz historyczną loterię do usunięcia...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('🗑️ USUWANIE HISTORYCZNEJ LOTERII')
        .setDescription(`Wybierz historyczną loterię do usunięcia z listy poniżej.\n\n` +
                       `📊 **Historycznych loterii:** ${history.length} (pokazano ostatnie 20)\n\n` +
                       `⚠️ **Uwaga:** Usunięcie loterii historycznej spowoduje trwałe usunięcie wszystkich związanych z nią danych, w tym rerolls.`)
        .setColor('#ff6b6b')
        .setFooter({ 
            text: `Żądanie od ${interaction.user.username}` 
        })
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

/**
 * Obsługuje wybór zaplanowanej loterii do usunięcia z Select Menu
 */
async function handleLotteryRemovePlannedSelect(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej opcji. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    const lotteryId = interaction.values[0];

    await interaction.deferUpdate();

    try {
        // Sprawdź czy loteria nadal istnieje
        const activeLotteries = lotteryService.getActiveLotteries();
        const lottery = activeLotteries.find(l => l.id === lotteryId);
        
        if (!lottery) {
            await interaction.editReply({
                content: `❌ **Loteria nie została znaleziona!**\n\n` +
                        `Loteria o ID \`${lotteryId}\` mogła zostać już usunięta lub nie istnieje.\n\n` +
                        `💡 Użyj \`/lottery-debug\` aby sprawdzić aktywne loterie.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Sprawdź czy istnieją historyczne wyniki dla tej loterii
        const history = await lotteryService.getLotteryHistory();
        const relatedResults = history.filter(result => 
            result.lotteryId === lotteryId || result.lotteryId.startsWith(lotteryId + '_')
        );

        if (relatedResults.length > 0) {
            // Pytaj czy usunąć też historyczne wyniki
            
            // Przygotuj listę historycznych wyników z datami
            let historyList = '';
            relatedResults.forEach((result, index) => {
                const date = new Date(result.originalDate || result.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
                const time = new Date(result.originalDate || result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw'});
                const isReroll = result.lotteryId && result.lotteryId.includes('_reroll');
                const type = isReroll ? '🔄 Reroll' : '🎲 Losowanie';
                const winnersCount = (result.winners || result.newWinners || []).length;
                
                historyList += `${index + 1}. ${type} - ${date} ${time} (${winnersCount} zwycięzców)\n`;
                
                // Ogranicz do maksymalnie 8 pozycji w opisie
                if (index >= 7 && relatedResults.length > 8) {
                    historyList += `... i ${relatedResults.length - 8} więcej\n`;
                    return false;
                }
            });
            
            const confirmEmbed = new EmbedBuilder()
                .setTitle('🗑️ POTWIERDZENIE USUNIĘCIA')
                .setDescription(`Znaleziono **${relatedResults.length}** historycznych wyników dla tej loterii.\n\n` +
                               `**Czy chcesz również usunąć wszystkie historyczne wyniki?**\n\n` +
                               `📋 **Zostaną usunięte:**\n` +
                               `• Zaplanowana loteria: **${lottery.name}**\n` +
                               `• ${relatedResults.length} historycznych wyników:\n\n` +
                               `${historyList}`)
                .setColor('#ff6b6b')
                .addFields(
                    {
                        name: '🎰 Loteria do usunięcia',
                        value: `**${lottery.name}**`,
                        inline: false
                    },
                    {
                        name: '📅 Harmonogram',
                        value: `${lottery.nextDraw ? new Date(lottery.nextDraw).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jednorazowa'} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')}`,
                        inline: true
                    },
                    {
                        name: '🏆 Zwycięzców',
                        value: lottery.winnersCount.toString(),
                        inline: true
                    },
                    {
                        name: '📺 Kanał',
                        value: `<#${lottery.channelId}>`,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: `Żądanie od ${interaction.user.username}` 
                })
                .setTimestamp();

            const yesButton = new ButtonBuilder()
                .setCustomId(`lottery_remove_planned_confirm_yes_${lotteryId}`)
                .setLabel('🗑️ Tak, usuń wszystko')
                .setStyle(ButtonStyle.Danger);

            const noButton = new ButtonBuilder()
                .setCustomId(`lottery_remove_planned_confirm_no_${lotteryId}`)
                .setLabel('📋 Nie, zostaw historię')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(yesButton, noButton);

            await interaction.editReply({
                embeds: [confirmEmbed],
                components: [row]
            });
        } else {
            // Brak historycznych wyników - usuń od razu
            await lotteryService.removeLottery(lotteryId);

            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ LOTERIA USUNIĘTA')
                .setDescription(`Loteria została pomyślnie usunięta i wszystkie automatyczne losowania zostały zatrzymane.`)
                .setColor('#00ff00')
                .addFields(
                    {
                        name: '🗑️ Usunięta loteria',
                        value: `**${lottery.name}**`,
                        inline: false
                    },
                    {
                        name: '📅 Harmonogram',
                        value: `${lottery.nextDraw ? new Date(lottery.nextDraw).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jednorazowa'} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')}`,
                        inline: true
                    },
                    {
                        name: '🏆 Zwycięzców',
                        value: lottery.winnersCount.toString(),
                        inline: true
                    },
                    {
                        name: '📺 Kanał',
                        value: `<#${lottery.channelId}>`,
                        inline: true
                    },
                    {
                        name: '🆔 ID Loterii',
                        value: `\`${lottery.id}\``,
                        inline: false
                    }
                )
                .addFields({
                    name: '📋 Dodatkowe informacje',
                    value: 'Brak historycznych wyników do usunięcia.',
                    inline: false
                })
                .setFooter({ 
                    text: `Usunięte przez ${interaction.user.username}` 
                })
                .setTimestamp();

            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });

            logger.info(`✅ ${interaction.user.username} usunął loterię przez Select Menu: ${lottery.name} (${lotteryId}) - brak historii`);
        }

    } catch (error) {
        await interaction.editReply({
            content: `❌ **Błąd podczas usuwania loterii!**\n\n` +
                    `Szczegóły: ${error.message}\n\n` +
                    `💡 Spróbuj ponownie lub skontaktuj się z administratorem.`,
            embeds: [],
            components: []
        });
        logger.error('❌ Błąd usuwania loterii przez Select Menu:', error);
    }
}

/**
 * Obsługuje potwierdzenie usunięcia zaplanowanej loterii z historią
 */
async function handleLotteryRemovePlannedConfirm(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej opcji. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    const action = interaction.customId.includes('_yes_') ? 'yes' : 'no';
    const lotteryId = interaction.customId.replace(/^lottery_remove_planned_confirm_(yes|no)_/, '');

    await interaction.deferUpdate();

    try {
        // Sprawdź czy loteria nadal istnieje
        const activeLotteries = lotteryService.getActiveLotteries();
        const lottery = activeLotteries.find(l => l.id === lotteryId);
        
        if (!lottery) {
            await interaction.editReply({
                content: `❌ **Loteria nie została znaleziona!**\n\n` +
                        `Loteria o ID \`${lotteryId}\` mogła zostać już usunięta lub nie istnieje.\n\n` +
                        `💡 Użyj \`/lottery-debug\` aby sprawdzić aktywne loterie.`,
                embeds: [],
                components: []
            });
            return;
        }

        if (action === 'yes') {
            // Usuń loterię i historię
            await lotteryService.removeLottery(lotteryId);
            
            // Usuń też historyczne wyniki
            const history = await lotteryService.getLotteryHistory();
            const relatedIndices = [];
            
            // Znajdź wszystkie indeksy związanych wyników (od końca do początku)
            for (let i = history.length - 1; i >= 0; i--) {
                const result = history[i];
                if (result.lotteryId === lotteryId || result.lotteryId.startsWith(lotteryId + '_')) {
                    relatedIndices.push(i);
                }
            }
            
            // Usuń wyniki (od największego indeksu do najmniejszego)
            for (const index of relatedIndices) {
                await lotteryService.removeHistoricalLottery(index);
            }

            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ LOTERIA I HISTORIA USUNIĘTE')
                .setDescription(`Loteria wraz z całą historią została pomyślnie usunięta.`)
                .setColor('#00ff00')
                .addFields(
                    {
                        name: '🗑️ Usunięta loteria',
                        value: `**${lottery.name}**`,
                        inline: false
                    },
                    {
                        name: '📅 Harmonogram',
                        value: `${lottery.nextDraw ? new Date(lottery.nextDraw).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jednorazowa'} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')}`,
                        inline: true
                    },
                    {
                        name: '🏆 Zwycięzców',
                        value: lottery.winnersCount.toString(),
                        inline: true
                    },
                    {
                        name: '📺 Kanał',
                        value: `<#${lottery.channelId}>`,
                        inline: true
                    },
                    {
                        name: '🆔 ID Loterii',
                        value: `\`${lottery.id}\``,
                        inline: false
                    },
                    {
                        name: '📋 Dodatkowe informacje',
                        value: `Usunięto ${relatedIndices.length} historycznych wyników (włącznie z rerolls).`,
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Usunięte przez ${interaction.user.username}` 
                })
                .setTimestamp();

            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });

            logger.info(`✅ ${interaction.user.username} usunął loterię z historią: ${lottery.name} (${lotteryId}) - ${relatedIndices.length} wyników`);
        } else {
            // Usuń tylko zaplanowaną loterię
            await lotteryService.removeLottery(lotteryId);

            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ LOTERIA USUNIĘTA')
                .setDescription(`Loteria została pomyślnie usunięta. Historia została zachowana.`)
                .setColor('#00ff00')
                .addFields(
                    {
                        name: '🗑️ Usunięta loteria',
                        value: `**${lottery.name}**`,
                        inline: false
                    },
                    {
                        name: '📅 Harmonogram',
                        value: `${lottery.nextDraw ? new Date(lottery.nextDraw).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Jednorazowa'} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')}`,
                        inline: true
                    },
                    {
                        name: '🏆 Zwycięzców',
                        value: lottery.winnersCount.toString(),
                        inline: true
                    },
                    {
                        name: '📺 Kanał',
                        value: `<#${lottery.channelId}>`,
                        inline: true
                    },
                    {
                        name: '🆔 ID Loterii',
                        value: `\`${lottery.id}\``,
                        inline: false
                    },
                    {
                        name: '📋 Dodatkowe informacje',
                        value: 'Historyczne wyniki zostały zachowane.',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Usunięte przez ${interaction.user.username}` 
                })
                .setTimestamp();

            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });

            logger.info(`✅ ${interaction.user.username} usunął tylko zaplanowaną loterię: ${lottery.name} (${lotteryId}) - historia zachowana`);
        }

    } catch (error) {
        await interaction.editReply({
            content: `❌ **Błąd podczas usuwania loterii!**\n\n` +
                    `Szczegóły: ${error.message}\n\n` +
                    `💡 Spróbuj ponownie lub skontaktuj się z administratorem.`,
            embeds: [],
            components: []
        });
        logger.error('❌ Błąd usuwania loterii z potwierdzeniem:', error);
    }
}

/**
 * Obsługuje wybór historycznej loterii do usunięcia z Select Menu
 */
async function handleLotteryRemoveHistoricalSelect(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej opcji. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    await interaction.deferUpdate();

    try {
        const historyIndex = parseInt(interaction.values[0]);
        const history = await lotteryService.getLotteryHistory();

        if (historyIndex >= history.length || historyIndex < 0) {
            await interaction.editReply({
                content: '❌ **Błąd!** Nieprawidłowy indeks loterii historycznej.',
                embeds: [],
                components: []
            });
            return;
        }

        const lotteryToRemove = history[historyIndex];
        
        // Usuń loterię historyczną
        const result = await lotteryService.removeHistoricalLottery(historyIndex);

        
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ LOTERIA HISTORYCZNA USUNIĘTA')
            .setDescription(`Loteria historyczna została pomyślnie usunięta z systemu.`)
            .setColor('#00ff00')
            .addFields(
                {
                    name: '🗑️ Usunięta loteria',
                    value: `**${lotteryToRemove.lotteryName}**`,
                    inline: false
                },
                {
                    name: '📅 Data',
                    value: new Date(lotteryToRemove.originalDate || lotteryToRemove.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }),
                    inline: true
                },
                {
                    name: '👥 Uczestnicy',
                    value: (lotteryToRemove.participantCount || lotteryToRemove.originalParticipantCount || 0).toString(),
                    inline: true
                },
                {
                    name: '🏆 Zwycięzców',
                    value: (lotteryToRemove.winners || lotteryToRemove.newWinners || []).length.toString(),
                    inline: true
                },
                {
                    name: '🆔 ID Loterii',
                    value: `\`${lotteryToRemove.lotteryId}\``,
                    inline: false
                }
            )
            .setFooter({ 
                text: `Usunięte przez ${interaction.user.username}` 
            })
            .setTimestamp();

        // Dodaj informację o usuniętych rerolls jeśli to była oryginalna loteria
        if (!lotteryToRemove.lotteryId.includes('_reroll')) {
            successEmbed.addFields({
                name: '🔄 Dodatkowe informacje',
                value: 'Usunięto także wszystkie powiązane rerolls dla tej loterii.',
                inline: false
            });
        }

        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

        logger.info(`✅ ${interaction.user.username} usunął loterię historyczną przez Select Menu: ${lotteryToRemove.lotteryName} (${lotteryToRemove.lotteryId})`);

    } catch (error) {
        await interaction.editReply({
            content: `❌ **Błąd podczas usuwania loterii historycznej!**\n\n` +
                    `Szczegóły: ${error.message}\n\n` +
                    `💡 Spróbuj ponownie lub skontaktuj się z administratorem.`,
            embeds: [],
            components: []
        });
        logger.error('❌ Błąd usuwania loterii historycznej przez Select Menu:', error);
    }
}


/**
 * Obsługuje wybór loterii do ponownego losowania z Select Menu
 */
async function handleRerollLotterySelect(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej opcji. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    const resultIndex = parseInt(interaction.values[0]);

    await interaction.deferUpdate();

    try {
        const result = await lotteryService.rerollLottery(interaction, resultIndex, 1); // Domyślnie 1 dodatkowy zwycięzca
        
        if (result.success) {
            
            const embed = new EmbedBuilder()
                .setTitle('🎰 PONOWNE LOSOWANIE')
                .setDescription(`**${result.originalResult.lotteryName}**`)
                .setColor('#ffa500')
                .addFields(
                    {
                        name: '📅 Oryginalna loteria',
                        value: lotteryService.convertUTCToPolishTime(new Date(result.originalResult.date)),
                        inline: true
                    },
                    {
                        name: '👥 Pula do ponownego losowania',
                        value: (result.originalResult.participantCount - result.originalResult.winners.length).toString(),
                        inline: true
                    },
                    {
                        name: '🏆 Nowi zwycięzcy',
                        value: result.newWinners.length > 0 
                            ? result.newWinners.map((winner, index) => 
                                `${index + 1}. ${winner.displayName} (<@${winner.id}>)`
                              ).join('\n')
                            : 'Brak nowych zwycięzców',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `Ponowne losowanie wykonane przez ${interaction.user.username} | Oryginalna loteria: ${result.originalResult.lotteryId}` 
                })
                .setTimestamp();

            await interaction.editReply({ 
                embeds: [embed],
                components: []
            });

            logger.info(`✅ ${interaction.user.username} wykonał ponowne losowanie przez Select Menu dla: ${result.originalResult.lotteryName}`);
        }
    } catch (error) {
        await interaction.editReply({
            content: `❌ **Błąd podczas ponownego losowania!**\n\n` +
                    `Szczegóły: ${error.message}\n\n` +
                    `💡 Sprawdź czy użytkownicy z oryginalnej loterii nadal mają odpowiednie role.`,
            embeds: [],
            components: []
        });
        logger.error('❌ Błąd ponownego losowania przez Select Menu:', error);
    }
}


/**
 * Obsługuje komendę lottery-debug
 */
async function handleLotteryDebugCommand(interaction, config, lotteryService) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    if (!lotteryService) {
        await interaction.reply({
            content: '❌ Serwis loterii nie jest dostępny.',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const activeLotteries = lotteryService.getActiveLotteries();
        const cronJobsCount = lotteryService.cronJobs ? lotteryService.cronJobs.size : 0;
        
        let debugInfo = `🐛 **DEBUG INFORMACJE LOTERII**\n\n`;
        debugInfo += `📊 **Stan systemu:**\n`;
        debugInfo += `• Aktywne loterie w pamięci: ${activeLotteries.length}\n`;
        debugInfo += `• Aktywne cron jobs: ${cronJobsCount}\n`;
        debugInfo += `• Plik danych: ${config.lottery.dataFile}\n\n`;
        
        if (activeLotteries.length > 0) {
            debugInfo += `🎯 **Aktywne loterie:**\n`;
            for (const lottery of activeLotteries) {
                const hasCronJob = lotteryService.cronJobs && lotteryService.cronJobs.has(lottery.id);
                const nextDraw = lottery.nextDraw ? lotteryService.convertUTCToPolishTime(new Date(lottery.nextDraw)) : 'Jednorazowa - już wykonana';
                const frequency = lottery.frequency === 0 ? 'Jednorazowa' : `Co ${lottery.frequency} dni`;
                debugInfo += `• **${lottery.id}**\n`;
                debugInfo += `  └ Nazwa: ${lottery.name}\n`;
                debugInfo += `  └ Następne losowanie: ${nextDraw}\n`;
                debugInfo += `  └ Częstotliwość: ${frequency}\n`;
                debugInfo += `  └ Cron job: ${hasCronJob ? '✅ Aktywny' : '❌ Brak'}\n`;
                debugInfo += `  └ Data losowania: ${lottery.firstDrawDate || 'Brak'}\n\n`;
            }
        } else {
            debugInfo += `📋 **Brak aktywnych loterii**\n\n`;
        }
        
        // Sprawdź plik danych
        try {
            const fileData = await fs.readFile(config.lottery.dataFile, 'utf8');
            const parsed = JSON.parse(fileData);
            debugInfo += `📄 **Plik danych:**\n`;
            debugInfo += `• Aktywne w pliku: ${Object.keys(parsed.activeLotteries || {}).length}\n`;
            debugInfo += `• Historia: ${parsed.results ? parsed.results.length : 0}\n`;
            debugInfo += `• Reroll: ${parsed.rerolls ? parsed.rerolls.length : 0}\n`;
            debugInfo += `• Ostatnia aktualizacja: ${parsed.lastUpdated || 'Nieznana'}\n`;
        } catch (error) {
            debugInfo += `📄 **Plik danych:** ❌ Błąd odczytu: ${error.message}\n`;
        }
        
        await interaction.editReply({ content: debugInfo });
        
        logger.info(`🐛 ${interaction.user.username} sprawdził debug loterii`);
        
    } catch (error) {
        await interaction.editReply({
            content: `❌ Błąd podczas debugowania: ${error.message}`
        });
        logger.error('❌ Błąd debugowania loterii:', error);
    }
}


/**
 * Rejestruje komendy slash
 */
async function registerSlashCommands(client, config) {
    // Generuj opcje klanów z "Cały serwer" na końcu
    const clanEntries = Object.entries(config.lottery.clans);
    const serverEntry = clanEntries.find(([key]) => key === 'server');
    const otherEntries = clanEntries.filter(([key]) => key !== 'server');
    
    const clanChoices = [...otherEntries, ...(serverEntry ? [serverEntry] : [])].map(([key, clan]) => ({
        name: clan.displayName,
        value: key
    }));


    const commands = [
        new SlashCommandBuilder()
            .setName('ocr-debug')
            .setDescription('Przełącz szczegółowe logowanie OCR')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('lottery')
            .setDescription('Tworzy nową loterię dla wybranej roli i klanu')
            .addRoleOption(option =>
                option.setName('rola')
                    .setDescription('Rola dla której będzie robiona loteria')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('klan')
                    .setDescription('Klan dla którego będzie robiona loteria')
                    .setRequired(true)
                    .addChoices(...clanChoices))
            .addIntegerOption(option =>
                option.setName('częstotliwość')
                    .setDescription('Co ile dni ma być powtarzana loteria (0 = jednorazowo, 1-365 = cyklicznie)')
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(365))
            .addStringOption(option =>
                option.setName('data')
                    .setDescription('Data pierwszego losowania (format: dd.mm.rrrr)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('godzina')
                    .setDescription('Godzina losowania (format HH:MM, np. 19:00)')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('ilość')
                    .setDescription('Ilość osób które będą wyłonione z losowania (1-20)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(20))
            .addStringOption(option =>
                option.setName('kanał')
                    .setDescription('ID kanału na którym będą publikowane wyniki')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('lottery-reroll')
            .setDescription('Przeprowadza ponowne losowanie dla wybranej historycznej loterii'),

        new SlashCommandBuilder()
            .setName('lottery-remove')
            .setDescription('Usuwa loterię')
            .addStringOption(option =>
                option.setName('typ')
                    .setDescription('Typ loterii do usunięcia')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Zaplanowana loteria', value: 'planned' },
                        { name: 'Historyczna loteria', value: 'historical' }
                    )),

        new SlashCommandBuilder()
            .setName('lottery-history')
            .setDescription('Wyświetla historię wszystkich przeprowadzonych loterii'),

        new SlashCommandBuilder()
            .setName('lottery-debug')
            .setDescription('Debugowanie systemu loterii (admin only)'),

        new SlashCommandBuilder()
            .setName('oligopoly')
            .setDescription('Dodaj swoje ID do systemu oligopoly - klan zostanie wykryty automatycznie')
            .addStringOption(option =>
                option.setName('id')
                    .setDescription('Twoje ID (tylko cyfry)')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('oligopoly-review')
            .setDescription('Przeglądaj listę ID dla wybranego klanu')
            .addStringOption(option =>
                option.setName('klan')
                    .setDescription('Klan do przejrzenia')
                    .setRequired(true)
                    .addChoices(
                        { name: '🔥Polski Squad🔥', value: '🔥Polski Squad🔥' },
                        { name: '💥PolskiSquad²💥', value: '💥PolskiSquad²💥' },
                        { name: '⚡PolskiSquad¹⚡', value: '⚡PolskiSquad¹⚡' },
                        { name: '🎮PolskiSquad⁰🎮', value: '🎮PolskiSquad⁰🎮' }
                    )),

        new SlashCommandBuilder()
            .setName('oligopoly-clear')
            .setDescription('Usuwa wszystkie wpisy oligopoly (tylko administratorzy)'),

        new SlashCommandBuilder()
            .setName('oligopoly-list')
            .setDescription('Generuje listę wszystkich osób z Twoją rolą klanową'),

        new SlashCommandBuilder()
            .setName('kawka')
            .setDescription('Ogłoszenie wsparcia serwera kawką (tylko administratorzy)')
            .addStringOption(option =>
                option.setName('nick')
                    .setDescription('Nick użytkownika (wybierz z listy lub wpisz własny)')
                    .setRequired(true)
                    .setAutocomplete(true)),

    ];

    const rest = new REST().setToken(config.token);
    
    try {
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
    } catch (error) {
        logger.error('[COMMANDS] ❌ Błąd rejestracji komend slash:', error);
    }
}

/**
 * Obsługuje komendę lottery-history
 */
async function handleLotteryHistoryCommand(interaction, config, lotteryService, isUpdate = false) {
    if (!isUpdate) {
        await interaction.deferReply({ ephemeral: true });
    }

    try {
        const history = await lotteryService.getLotteryHistory();
        
        if (history.length === 0) {
            const content = '📋 **Brak historii loterii do wyświetlenia.**\n\n💡 Przeprowadź najpierw jakąś loterię używając `/lottery` lub `/lottery-test`.';
            
            if (isUpdate) {
                await interaction.update({ content, embeds: [], components: [] });
            } else {
                await interaction.editReply({ content });
            }
            return;
        }

        // Pobierz numer strony z customId jeśli to nawigacja
        let currentPage = 0;
        if (interaction.customId && interaction.customId.includes('_page_')) {
            const pageMatch = interaction.customId.match(/_page_(\d+)$/);
            if (pageMatch) {
                currentPage = parseInt(pageMatch[1]);
            }
        }

        const { embed, components } = await generateHistoryEmbed(history, currentPage, config, interaction.guild);
        
        if (isUpdate) {
            await interaction.update({ embeds: [embed], components });
        } else {
            await interaction.editReply({ embeds: [embed], components });
        }

    } catch (error) {
        logger.error('❌ Błąd ładowania historii:', error);
        const errorContent = '❌ Wystąpił błąd podczas ładowania historii loterii.';
        
        if (isUpdate) {
            await interaction.update({ content: errorContent, embeds: [], components: [] });
        } else {
            await interaction.editReply({ content: errorContent });
        }
    }
}

/**
 * Obsługuje nawigację w historii loterii
 */
async function handleLotteryHistoryNavigation(interaction, config, lotteryService, direction) {
    try {
        const history = await lotteryService.getLotteryHistory();
        
        // Pobierz aktualną stronę z customId
        let currentPage = 0;
        if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
            const embed = interaction.message.embeds[0];
            const footerMatch = embed.footer?.text.match(/Strona (\d+) z (\d+)/);
            if (footerMatch) {
                currentPage = parseInt(footerMatch[1]) - 1;
            }
        }

        // Oblicz nową stronę
        const itemsPerPage = 10;
        const totalPages = Math.ceil(history.length / itemsPerPage);
        
        if (direction === 'next') {
            currentPage = Math.min(currentPage + 1, totalPages - 1);
        } else if (direction === 'prev') {
            currentPage = Math.max(currentPage - 1, 0);
        }

        const { embed, components } = await generateHistoryEmbed(history, currentPage, config, interaction.guild);
        await interaction.update({ embeds: [embed], components });

    } catch (error) {
        logger.error('❌ Błąd nawigacji historii:', error);
        await interaction.update({ 
            content: '❌ Wystąpił błąd podczas nawigacji.', 
            embeds: [], 
            components: [] 
        });
    }
}

/**
 * Obsługuje wyświetlanie statystyk TOP3
 */
async function handleLotteryHistoryStats(interaction, config, lotteryService) {
    try {
        const history = await lotteryService.getLotteryHistory();
        
        if (history.length === 0) {
            await interaction.update({ 
                content: '📋 **Brak historii loterii do analizy.**', 
                embeds: [], 
                components: [] 
            });
            return;
        }

        const { embed, components } = await generateStatsEmbed(history, config);
        await interaction.update({ embeds: [embed], components });

    } catch (error) {
        logger.error('❌ Błąd ładowania statystyk:', error);
        await interaction.update({ 
            content: '❌ Wystąpił błąd podczas ładowania statystyk.', 
            embeds: [], 
            components: [] 
        });
    }
}

/**
 * Generuje embed z historią loterii
 */
async function generateHistoryEmbed(history, currentPage, config, guild = null) {
    
    const itemsPerPage = 10;
    const totalPages = Math.ceil(history.length / itemsPerPage);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, history.length);
    
    // Odwróć kolejność aby najnowsze były na górze
    const reversedHistory = [...history].reverse();
    const pageItems = reversedHistory.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
        .setTitle('📊 Historia Loterii')
        .setColor('#4CAF50')
        .setTimestamp()
        .setFooter({ text: `Strona ${currentPage + 1} z ${totalPages}` });

    if (pageItems.length === 0) {
        embed.setDescription('Brak loterii na tej stronie.');
    } else {
        let description = '';
        
        pageItems.forEach((result, index) => {
            try {
                const globalIndex = startIndex + index + 1;
                const date = new Date(result.originalDate || result.date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
                const time = new Date(result.originalDate || result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw'});
            
            // Znajdź nazwę klanu
            let clanName = 'Nieznany';
            if (result.clanName) {
                clanName = result.clanName;
            } else {
                // Fallback - szukaj po roleId
                Object.values(config.lottery.clans).forEach(clan => {
                    if (clan.roleId === result.clanRole) {
                        clanName = clan.displayName;
                    }
                });
            }
            
            // Znajdź nazwę roli docelowej
            let roleName = 'Nieznana rola';
            if (result.targetRoleName) {
                roleName = result.targetRoleName;
            } else if (result.targetRole) {
                // Spróbuj znaleźć rolę po ID w Guild
                try {

                    if (guild && guild.roles.cache.has(result.targetRole)) {
                        const role = guild.roles.cache.get(result.targetRole);
                        roleName = role.name;
                    } else {
                        roleName = result.targetRole; // Fallback do ID
                    }
                } catch (error) {
                    roleName = result.targetRole || 'Nieznana rola';
                }
            }

            // Pobierz zwycięzców (dla rerolls może być w newWinners)
            const winners = result.winners || result.newWinners || [];
            const winnersText = winners.map(w => w.displayName || w.username).join(', ') || 'Brak zwycięzców';

            description += `**${globalIndex}.** **${result.lotteryName}**\n`;
            description += `📅 ${date} ${time}\n`;
            
            // Pokaż klan tylko jeśli to nie "Cały serwer"
            if (clanName !== 'Nieznany' && !clanName.includes('Cały Serwer')) {
                description += `🏰 **Klan:** ${clanName}\n`;
            }
            
            description += `🎯 **Rola:** ${roleName}\n`;
                description += `👥 **Uczestnicy:** ${result.participantCount || result.originalParticipantCount || 0}\n`;
                description += `🏆 **Zwycięzcy:** ${winnersText}\n\n`;
            } catch (itemError) {
                logger.error(`❌ Błąd przetwarzania loterii ${index}:`, itemError);
                description += `**${startIndex + index + 1}.** **[Błąd danych]**\n\n`;
            }
        });

        embed.setDescription(description);
    }

    // Przyciski nawigacji
    const prevButton = new ButtonBuilder()
        .setCustomId('lottery_history_prev')
        .setLabel('◀️ Poprzednia')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
        .setCustomId('lottery_history_next')
        .setLabel('Następna ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages - 1);

    const statsButton = new ButtonBuilder()
        .setCustomId('lottery_history_stats')
        .setLabel('📈 Statystyki TOP3')
        .setStyle(ButtonStyle.Primary);

    const components = [
        new ActionRowBuilder().addComponents(prevButton, nextButton, statsButton)
    ];

    return { embed, components };
}

/**
 * Generuje embed ze statystykami TOP3
 */
async function generateStatsEmbed(history, config) {
    
    // Grupuj zwycięzców według klanów
    const clanStats = {};
    
    // Inicjalizuj statystyki dla każdego klanu
    Object.entries(config.lottery.clans).forEach(([key, clan]) => {
        clanStats[clan.roleId] = {
            name: clan.displayName,
            winners: {}
        };
    });

    // Przeanalizuj historię
    history.forEach(result => {
        const clanId = result.clanRole;
        
        if (clanStats[clanId]) {
            result.winners.forEach(winner => {
                const playerName = winner.displayName || winner.username;
                if (!clanStats[clanId].winners[playerName]) {
                    clanStats[clanId].winners[playerName] = 0;
                }
                clanStats[clanId].winners[playerName]++;
            });
        }
    });

    const embed = new EmbedBuilder()
        .setTitle('📈 Statystyki TOP3 - Najczęściej Wygrywający')
        .setColor('#FF9800')
        .setTimestamp();

    let description = '';
    let hasAnyWinners = false;

    // Wyświetl klany z "Cały serwer" na końcu
    const clanEntries = Object.entries(config.lottery.clans);
    const serverEntry = clanEntries.find(([key]) => key === 'server');
    const otherEntries = clanEntries.filter(([key]) => key !== 'server');
    
    const orderedClanKeys = [...otherEntries, ...(serverEntry ? [serverEntry] : [])];
    
    orderedClanKeys.forEach(([key, clanConfig]) => {
        const clan = clanStats[clanConfig.roleId];
        if (!clan) return;
        if (Object.keys(clan.winners).length === 0) {
            description += `\n**🏰 ${clan.name}**\n`;
            description += `*Brak wygranych w historii*\n`;
            return;
        }

        hasAnyWinners = true;
        
        // Sortuj zwycięzców według liczby wygranych
        const sortedWinners = Object.entries(clan.winners)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3); // TOP 3

        description += `\n**🏰 ${clan.name}**\n`;
        
        sortedWinners.forEach(([playerName, wins], index) => {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[index] || '🏆';
            description += `${medal} **${playerName}** - ${wins} ${wins === 1 ? 'wygrana' : wins < 5 ? 'wygrane' : 'wygranych'}\n`;
        });
    });

    if (!hasAnyWinners) {
        description = '\n*Brak danych o wygranych w historii loterii.*';
    }

    embed.setDescription(description);

    // Przycisk powrotu
    const backButton = new ButtonBuilder()
        .setCustomId('lottery_history_back')
        .setLabel('🔙 Powrót do historii')
        .setStyle(ButtonStyle.Secondary);

    const components = [
        new ActionRowBuilder().addComponents(backButton)
    ];

    return { embed, components };
}

/**
 * Obsługuje komendę /oligopoly
 */
async function handleOligopolyCommand(interaction, config) {
    const id = interaction.options.getString('id');

    // Walidacja ID (sprawdź czy to liczba)
    if (!/^\d+$/.test(id)) {
        await interaction.reply({
            content: '❌ ID musi być liczbą (zawierać tylko cyfry).',
            ephemeral: true
        });
        return;
    }

    // Sprawdź czy użytkownik ma którąkolwiek z ról klanowych
    const clanRoles = Object.values(config.lottery.clans)
        .filter(clan => clan.roleId !== null) // Wyklucz "cały serwer"
        .map(clan => clan.roleId);

    const userClanRoles = interaction.member.roles.cache.filter(role =>
        clanRoles.includes(role.id)
    );

    if (userClanRoles.size === 0) {
        const availableClans = Object.values(config.lottery.clans)
            .filter(clan => clan.roleId !== null)
            .map(clan => clan.displayName);

        await interaction.reply({
            content: `❌ **Brak uprawnień do używania tej komendy!**\n\n` +
                    `Musisz posiadać jedną z ról klanowych:\n${availableClans.map(name => `• ${name}`).join('\n')}\n\n` +
                    `💡 Skontaktuj się z administratorem jeśli uważasz, że to błąd.`,
            ephemeral: true
        });
        return;
    }

    // Jeśli użytkownik ma więcej niż jedną rolę klanową, użyj pierwszej znalezionej
    const userClanRoleId = userClanRoles.first().id;

    // Znajdź odpowiedni klan na podstawie roli
    let detectedClan = null;
    for (const [key, clan] of Object.entries(config.lottery.clans)) {
        if (clan.roleId === userClanRoleId) {
            detectedClan = clan.displayName;
            break;
        }
    }

    if (!detectedClan) {
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas wykrywania klanu. Skontaktuj się z administratorem.',
            ephemeral: true
        });
        return;
    }

    // Inicjalizuj oligopolyService jeśli nie istnieje
    if (!interaction.client.oligopolyService) {
        interaction.client.oligopolyService = new OligopolyService(config, logger);
    }

    // Pobierz nick na serwerze (displayName lub nick lub username)
    const serverNickname = interaction.member.displayName;

    const result = await interaction.client.oligopolyService.addOligopolyEntry(
        interaction.user.id,
        interaction.user.username,
        serverNickname,
        detectedClan,
        id
    );

    if (result.success) {
        await interaction.reply({
            content: `✅ **Dodano wpis oligopoly**\n🏰 **Wykryty klan:** ${detectedClan}\n🆔 **ID:** ${id}`,
            ephemeral: true
        });
    } else {
        if (result.error === 'ID_EXISTS') {
            await interaction.reply({
                content: `❌ **ID już istnieje w systemie!**\n\n🆔 **ID:** ${id}\n👤 **Używane przez:** ${result.existingUser}\n🏰 **Klan:** ${result.existingKlan}\n\n💡 Każde ID może być używane tylko przez jedną osobę.`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas dodawania wpisu oligopoly.',
                ephemeral: true
            });
        }
    }
}

/**
 * Obsługuje komendę /oligopoly-review
 */
async function handleOligopolyReviewCommand(interaction, config) {
    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = [
        '1194249987677229186', // Main clan
        '1196805078162616480', // Clan 2
        '1210265548584132648', // Clan 1
        '1262793135860355254'  // Clan 0
    ];

    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do tej komendy. Wymagana jest rola klanowa.',
            ephemeral: true
        });
        return;
    }

    const klan = interaction.options.getString('klan');

    // Sprawdź czy klan istnieje w konfiguracji (bez "cały serwer")
    const availableClans = Object.values(config.lottery.clans)
        .filter(clan => clan.roleId !== null)
        .map(clan => clan.displayName);

    if (!availableClans.includes(klan)) {
        await interaction.reply({
            content: `❌ Nieprawidłowy klan. Dostępne klany:\n${availableClans.map(name => `• ${name}`).join('\n')}`,
            ephemeral: true
        });
        return;
    }

    // Inicjalizuj oligopolyService jeśli nie istnieje
    if (!interaction.client.oligopolyService) {
        interaction.client.oligopolyService = new OligopolyService(config, logger);
    }

    const entries = interaction.client.oligopolyService.getOligopolyEntriesByKlan(klan);

    if (entries.length === 0) {
        await interaction.reply({
            content: `📋 **Brak wpisów oligopoly dla klanu:** ${klan}`,
            ephemeral: true
        });
        return;
    }

    // Formatuj listę
    const playerList = entries.map(entry => `Nick: ${entry.serverNickname || entry.username} ID:${entry.id}`).join('\n');
    const idList = entries.map(entry => entry.id).join('\n');

    const response = `📋 **Lista oligopoly - ${klan}**\n\n${playerList}\n\n**ID zbiorczo:**\n${idList}`;

    // Sprawdź długość odpowiedzi (limit Discord: 2000 znaków)
    if (response.length > 1900) {
        await interaction.reply({
            content: `📋 **Lista oligopoly - ${klan}** (${entries.length} wpisów)\n\n⚠️ Lista jest za długa do wyświetlenia. Skontaktuj się z administratorem w celu otrzymania pełnej listy.`,
            ephemeral: true
        });
    } else {
        await interaction.reply({
            content: response,
            ephemeral: true
        });
    }
}

/**
 * Obsługuje komendę /oligopoly-list
 */
async function handleOligopolyListCommand(interaction, config) {
    // Sprawdź czy użytkownik ma którąkolwiek z ról klanowych
    const clanRoles = Object.values(config.lottery.clans)
        .filter(clan => clan.roleId !== null) // Wyklucz "cały serwer"
        .map(clan => clan.roleId);

    const userClanRoles = interaction.member.roles.cache.filter(role =>
        clanRoles.includes(role.id)
    );

    if (userClanRoles.size === 0) {
        const availableClans = Object.values(config.lottery.clans)
            .filter(clan => clan.roleId !== null)
            .map(clan => clan.displayName);

        await interaction.reply({
            content: `❌ **Brak uprawnień do używania tej komendy!**\n\n` +
                    `Musisz posiadać jedną z ról klanowych:\n${availableClans.map(name => `• ${name}`).join('\n')}\n\n` +
                    `💡 Skontaktuj się z administratorem jeśli uważasz, że to błąd.`,
            ephemeral: true
        });
        return;
    }

    // Jeśli użytkownik ma więcej niż jedną rolę klanową, użyj pierwszej znalezionej
    const userClanRoleId = userClanRoles.first().id;

    // Znajdź odpowiedni klan na podstawie roli
    let detectedClan = null;
    for (const [key, clan] of Object.entries(config.lottery.clans)) {
        if (clan.roleId === userClanRoleId) {
            detectedClan = clan.displayName;
            break;
        }
    }

    if (!detectedClan) {
        await interaction.reply({
            content: '❌ Nie udało się wykryć Twojego klanu. Skontaktuj się z administratorem.',
            ephemeral: true
        });
        return;
    }

    // Defer reply - pobieranie członków może trochę potrwać
    await interaction.deferReply({ ephemeral: true });

    try {
        // Pobierz wszystkich członków serwera
        await interaction.guild.members.fetch();

        // Filtruj członków z daną rolą klanową
        const membersWithRole = interaction.guild.members.cache.filter(member =>
            member.roles.cache.has(userClanRoleId)
        );

        if (membersWithRole.size === 0) {
            await interaction.editReply({
                content: `📋 **Brak członków z rolą klanu:** ${detectedClan}`
            });
            return;
        }

        // Sortuj alfabetycznie po nicku serwera
        const sortedMembers = Array.from(membersWithRole.values()).sort((a, b) => {
            const nameA = a.displayName.toLowerCase();
            const nameB = b.displayName.toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Podziel listę na chunki po 10 osób
        const MEMBERS_PER_MESSAGE = 10;
        const chunks = [];

        for (let i = 0; i < sortedMembers.length; i += MEMBERS_PER_MESSAGE) {
            const chunk = sortedMembers.slice(i, i + MEMBERS_PER_MESSAGE);
            const memberList = chunk.map(member =>
                `<@${member.user.id}> PLㅣ${member.displayName}`
            ).join('\n');

            chunks.push(memberList);
        }

        // Wyślij nagłówek jako osobną pierwszą wiadomość
        await interaction.editReply({
            content: `📋 **Lista członków klanu ${detectedClan}** (${sortedMembers.length} osób)`
        });

        // Wyślij wszystkie chunki jako followUp
        for (let i = 0; i < chunks.length; i++) {
            await interaction.followUp({
                content: chunks[i],
                ephemeral: true
            });
        }
    } catch (error) {
        logger.error(`Błąd podczas pobierania listy członków klanu: ${error.message}`);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania listy członków. Spróbuj ponownie później.'
        });
    }
}

/**
 * Obsługuje komendę /oligopoly-clear
 */
async function handleOligopolyClearCommand(interaction, config) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }

    // Inicjalizuj oligopolyService jeśli nie istnieje
    if (!interaction.client.oligopolyService) {
        interaction.client.oligopolyService = new OligopolyService(config, logger);
    }

    const entriesCount = interaction.client.oligopolyService.getEntryCount();

    if (entriesCount === 0) {
        await interaction.reply({
            content: '📋 **Brak wpisów oligopoly do usunięcia.**',
            ephemeral: true
        });
        return;
    }

    const success = await interaction.client.oligopolyService.clearAllEntries();

    if (success) {
        await interaction.reply({
            content: `✅ **Usunięto wszystkie wpisy oligopoly**\n📊 Usuniętych wpisów: ${entriesCount}`,
            ephemeral: true
        });
    } else {
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas usuwania wpisów oligopoly.',
            ephemeral: true
        });
    }
}

/**
 * Obsługuje autocomplete dla komendy /kawka
 */
async function handleKawkaAutocomplete(interaction) {
    try {
        const focusedValue = interaction.options.getFocused();

        // Pobierz członków serwera z Discord API używając query
        // To bezpośrednio wyszukuje członków po nazwie w API Discord, co jest znacznie szybsze
        let members;
        if (focusedValue.length > 0) {
            // Wyszukaj członków którzy pasują do wpisanego tekstu
            members = await interaction.guild.members.fetch({
                query: focusedValue,
                limit: 100 // Pobierz więcej żeby po odfiltrowaniu botów zostało 25
            });
        } else {
            // Jeśli nic nie wpisano, pobierz pierwszych 100 członków
            members = await interaction.guild.members.fetch({ limit: 100 });
        }

        const focusedValueLower = focusedValue.toLowerCase();

        // Filtruj i sortuj członków według dopasowania
        const choices = members
            .filter(member => !member.user.bot) // Pomijamy boty
            .filter(member => {
                // Dodatkowa filtracja po stronie klienta dla lepszego dopasowania
                const displayName = member.displayName.toLowerCase();
                const username = member.user.username.toLowerCase();
                return displayName.includes(focusedValueLower) || username.includes(focusedValueLower);
            })
            .sort((a, b) => {
                // Sortuj: najpierw ci którzy zaczynają się od wpisanego tekstu
                const aDisplayLower = a.displayName.toLowerCase();
                const bDisplayLower = b.displayName.toLowerCase();
                const aStartsWith = aDisplayLower.startsWith(focusedValueLower);
                const bStartsWith = bDisplayLower.startsWith(focusedValueLower);

                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                // Jeśli oba zaczynają się lub oba nie zaczynają się, sortuj alfabetycznie
                return aDisplayLower.localeCompare(bDisplayLower);
            })
            .map(member => ({
                name: `${member.displayName} (@${member.user.username})`,
                value: `userid_${member.id}` // Prefix userid_ oznacza że to member
            }))
            .slice(0, 24); // Discord limit: max 25 opcji (zostawiamy miejsce na opcję "użyj wpisanego")

        // Jeśli użytkownik coś wpisał, dodaj opcję "użyj tego co wpisałem"
        if (focusedValue.length > 0) {
            choices.unshift({
                name: `📝 Użyj wpisanego: "${focusedValue}"`,
                value: `custom_${focusedValue}`
            });
        }

        await interaction.respond(choices);
    } catch (error) {
        logger.error('❌ Błąd autocomplete kawka:', error);
        await interaction.respond([]);
    }
}

/**
 * Obsługuje komendę /kawka
 */
async function handleKawkaCommand(interaction, config) {
    try {
        // Sprawdź uprawnienia administratora
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
                ephemeral: true
            });
            return;
        }

        // Pobierz nick z opcji komendy
        const nickOption = interaction.options.getString('nick');


        // Stwórz modal z customId zawierającym nick
        // Enkodujemy nick w base64 żeby uniknąć problemów ze znakami specjalnymi
        const encodedNick = Buffer.from(nickOption).toString('base64');
        const modal = new ModalBuilder()
            .setCustomId(`kawka_modal_${encodedNick}`)
            .setTitle('☕ Wsparcie kawką');

        // Pole PLN
        const plnInput = new TextInputBuilder()
            .setCustomId('pln_input')
            .setLabel('PLN')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Wpisz kwotę w PLN')
            .setRequired(true)
            .setMaxLength(50);

        // Pole Wpłata (jednorazowa/cykliczna)
        const wplataInput = new TextInputBuilder()
            .setCustomId('wplata_input')
            .setLabel('Wpłata (1=jednorazowa, 2=cykliczna)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1 lub 2')
            .setRequired(true)
            .setMaxLength(1);

        // Dodaj pola do wierszy
        const firstRow = new ActionRowBuilder().addComponents(plnInput);
        const secondRow = new ActionRowBuilder().addComponents(wplataInput);

        // Dodaj wiersze do modala
        modal.addComponents(firstRow, secondRow);

        // Pokaż modal
        await interaction.showModal(modal);

        logger.info(`☕ ${interaction.user.username} otworzył modal /kawka dla: ${nickOption}`);
    } catch (error) {
        logger.error('❌ Błąd podczas pokazywania modala kawka:', error);

        const errorMessage = `❌ Wystąpił błąd podczas otwierania formularza: ${error.message}`;

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
}

/**
 * Obsługuje submit modala kawka
 */
async function handleKawkaModalSubmit(interaction, config) {
    try {
        // WAŻNE: Defer reply zanim zaczniemy długie operacje (Discord wymaga odpowiedzi w 3 sekundy)
        await interaction.deferReply({ ephemeral: true });

        // Pobierz nick z customId modala (zdekoduj base64)
        const customId = interaction.customId;
        const encodedNick = customId.replace('kawka_modal_', '');
        const nickOption = Buffer.from(encodedNick, 'base64').toString('utf-8');

        // Pobierz wartości z modala
        const pln = interaction.fields.getTextInputValue('pln_input');
        const wplataInput = interaction.fields.getTextInputValue('wplata_input').trim();

        // Walidacja typu wpłaty
        if (wplataInput !== '1' && wplataInput !== '2') {
            await interaction.editReply({
                content: '❌ Nieprawidłowy typ wpłaty. Dozwolone wartości: **1** (jednorazowa) lub **2** (cykliczna)'
            });
            return;
        }

        // Mapuj 1/2 na typ wpłaty
        const wplata = wplataInput === '1' ? 'jednorazowa' : 'cykliczna';

        // ID kanału do wysłania wiadomości
        const channelId = '1170323972173340744';

        const channel = await interaction.client.channels.fetch(channelId);

        if (!channel) {
            await interaction.editReply({
                content: '❌ Nie można znaleźć kanału do wysłania wiadomości.'
            });
            return;
        }

        // Sprawdź czy nick to userid czy custom
        let displayNick;
        let shouldPing = false;

        if (nickOption.startsWith('userid_')) {
            // To jest member - pingujemy
            const userId = nickOption.replace('userid_', '');
            try {
                const member = await interaction.guild.members.fetch(userId);
                displayNick = `<@${userId}>`;
                shouldPing = true;
            } catch (error) {
                logger.warn(`Nie można znaleźć użytkownika ${userId}, używam fallback`);
                displayNick = `**Użytkownik**`;
            }
        } else if (nickOption.startsWith('custom_')) {
            // To jest custom nick - bez pinga
            displayNick = `**${nickOption.replace('custom_', '')}**`;
        } else {
            // Fallback - traktuj jako custom nick
            displayNick = `**${nickOption}**`;
        }

        // Przygotuj losową wiadomość w zależności od typu wpłaty
        const jednorazoweWiadomosci = [
            `## ${displayNick} postawił mocne espresso za **${pln} PLN**! ☕\n## W imieniu serwera dzięki za ten energetyczny shot! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} funduje pyszne latte za **${pln} PLN**! ☕\n## W imieniu serwera dzięki, ta kawa smakuje wybornie! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} stawia podwójne doppio za **${pln} PLN**! ☕☕\n## W imieniu serwera dzięki za tę podwójną dawkę kofeiny! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} serwuje aromatyczne cappuccino za **${pln} PLN**! ☕\n## W imieniu serwera dzięki, pachnie wyśmienicie! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} stawia solidną americano za **${pln} PLN**! ☕\n## W imieniu serwera dzięki za tego dużego czarnego! <:PepeHeart2:1223714711196143787>`
        ];

        const cykliczneWiadomosci = [
            `## ${displayNick} wykupił miesięczny abonament kawowy za **${pln} PLN**! ☕📅\n## W imieniu serwera dzięki za regularną porcję kofeiny! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} dołączył do Coffee Club z miesięcznym flat white za **${pln} PLN**! ☕✨\n## W imieniu serwera dzięki, widzimy się przy barze co miesiąc! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} zamówił comiesięczne espresso za **${pln} PLN**! ☕🔄\n## W imieniu serwera dzięki za ten stały zastrzyk energii! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} został stałym bywalcem kawiarni serwerowej za **${pln} PLN** miesięcznie! ☕💳\n## W imieniu serwera dzięki za regularne dolewki! <:PepeHeart2:1223714711196143787>`,
            `## ${displayNick} zapisał się na comiesięczne macchiato za **${pln} PLN**! ☕📆\n## W imieniu serwera dzięki, co miesiąc pachnie świeżą kawą! <:PepeHeart2:1223714711196143787>`
        ];

        // Wybierz losową wiadomość
        let message = '';
        if (wplata === 'jednorazowa') {
            const randomIndex = Math.floor(Math.random() * jednorazoweWiadomosci.length);
            message = jednorazoweWiadomosci[randomIndex];
        } else if (wplata === 'cykliczna') {
            const randomIndex = Math.floor(Math.random() * cykliczneWiadomosci.length);
            message = cykliczneWiadomosci[randomIndex];
        }

        // Wyślij wiadomość na kanał
        await channel.send(message);

        // Potwierdź użytkownikowi
        const confirmNick = shouldPing ? displayNick : nickOption.replace('custom_', '').replace('userid_', '');
        await interaction.editReply({
            content: `✅ **Wiadomość została wysłana na kanał!**\n\n📝 **Nick:** ${confirmNick}\n💰 **Kwota:** ${pln}\n📊 **Typ wpłaty:** ${wplata}${shouldPing ? '\n🔔 **Z pingiem**' : ''}`
        });

        logger.info(`☕ ${interaction.user.username} użył komendy /kawka - Nick: ${confirmNick}, PLN: ${pln}, Wpłata: ${wplata}, Ping: ${shouldPing}`);

    } catch (error) {
        logger.error('❌ Błąd podczas wysyłania wiadomości kawka:', error);

        const errorMessage = `❌ Wystąpił błąd podczas wysyłania wiadomości: ${error.message}`;

        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else if (!interaction.replied) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            logger.error('❌ Nie można wysłać komunikatu o błędzie:', replyError);
        }
    }
}

module.exports = {
    handleInteraction,
    registerSlashCommands
};