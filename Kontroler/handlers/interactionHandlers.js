const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

/**
 * Obsługuje wszystkie interakcje Discord dla Kontroler bot
 */
async function handleInteraction(interaction, config, lotteryService = null) {
    try {
        if (interaction.isChatInputCommand()) {
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
                case 'lottery-test':
                    await handleLotteryTestCommand(interaction, config, lotteryService);
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
                case 'lottery_test_select':
                    await handleLotteryTestSelect(interaction, config, lotteryService);
                    break;
                case 'lottery_reroll_select':
                    await handleLotteryRerollSelect(interaction, config, lotteryService);
                    break;
                default:
                    await interaction.reply({ content: 'Nieznane menu wyboru!', ephemeral: true });
            }
        } else if (interaction.isButton()) {
            // Obsługa Button
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
    } catch (error) {
        logger.error('❌ Błąd obsługi interakcji:', error);
        
        const errorMessage = '❌ Wystąpił błąd podczas wykonywania komendy.';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
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
    
    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);
    
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
    const dayOfWeek = interaction.options.getString('dzień');
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

    if (!config.lottery.allowedDays.includes(dayOfWeek)) {
        await interaction.reply({
            content: `❌ Nieprawidłowy dzień tygodnia. Dostępne dni: ${config.lottery.allowedDays.join(', ')}`,
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

    if (frequency < 1 || frequency > 30) {
        await interaction.reply({
            content: '❌ Częstotliwość musi być między 1 a 30 dni.',
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
            dayOfWeek,
            hour,
            minute,
            winnersCount,
            channelId
        });

        if (result.success) {
            const clan = config.lottery.clans[clanKey];
            const nextDraw = new Date(result.lottery.nextDraw).toLocaleString('pl-PL');

            await interaction.editReply({
                content: `✅ **Loteria została utworzona pomyślnie!**\n\n` +
                        `🎰 **Nazwa:** ${result.lottery.name}\n` +
                        `🎯 **Rola docelowa:** ${targetRole.name}\n` +
                        `🏰 **Klan:** ${clan.displayName}\n` +
                        `📅 **Częstotliwość:** Co ${frequency} dni\n` +
                        `⏰ **Termin:** ${dayOfWeek} o ${timeString}\n` +
                        `🏆 **Liczba zwycięzców:** ${winnersCount}\n` +
                        `📺 **Kanał wyników:** <#${channelId}>\n` +
                        `⏭️ **Następne losowanie:** ${nextDraw}\n\n` +
                        `🆔 **ID loterii:** \`${result.lottery.id}\``
            });

            logger.info(`✅ ${interaction.user.tag} utworzył loterię: ${result.lottery.name}`);
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
        const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
        
        const recentHistory = history.slice(-20); // Ostatnie 20 loterii
        const selectOptions = recentHistory.map((result, index) => {
            const originalIndex = history.length - recentHistory.length + index;
            const date = new Date(result.date).toLocaleDateString('pl-PL');
            const time = new Date(result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'});
            
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
                text: `Żądanie od ${interaction.user.tag}` 
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
    const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
    
    const selectOptions = activeLotteries.map(lottery => {
        const datePart = lottery.id.split('_')[0];
        const formattedDate = `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}`;
        const clan = config.lottery.clans[lottery.clanKey];
        
        return {
            label: `${lottery.name}`,
            description: `${lottery.dayOfWeek} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')} | ${formattedDate}`,
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
            text: `Żądanie od ${interaction.user.tag}` 
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
    const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
    
    const recentHistory = history.slice(-20); // Ostatnie 20 loterii
    const selectOptions = recentHistory.map((result, index) => {
        const originalIndex = history.length - recentHistory.length + index;
        const date = new Date(result.originalDate || result.date).toLocaleDateString('pl-PL');
        const time = new Date(result.originalDate || result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'});
        
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
            text: `Żądanie od ${interaction.user.tag}` 
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

        // Usuń loterię
        await lotteryService.removeLottery(lotteryId);

        const { EmbedBuilder } = require('discord.js');
        
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
                    value: `${lottery.dayOfWeek} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')}`,
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
            .setFooter({ 
                text: `Usunięte przez ${interaction.user.tag}` 
            })
            .setTimestamp();

        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

        logger.info(`✅ ${interaction.user.tag} usunął loterię przez Select Menu: ${lottery.name} (${lotteryId})`);

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

        const { EmbedBuilder } = require('discord.js');
        
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
                    value: new Date(lotteryToRemove.originalDate || lotteryToRemove.date).toLocaleDateString('pl-PL'),
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
                text: `Usunięte przez ${interaction.user.tag}` 
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

        logger.info(`✅ ${interaction.user.tag} usunął loterię historyczną przez Select Menu: ${lotteryToRemove.lotteryName} (${lotteryToRemove.lotteryId})`);

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
 * Obsługuje wybór loterii do testowego uruchomienia z Select Menu
 */
async function handleLotteryTestSelect(interaction, config, lotteryService) {
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

        await interaction.editReply({
            content: `🧪 **Testowe uruchomienie loterii:**\n\n` +
                    `🎰 **Loteria:** ${lottery.name}\n` +
                    `🆔 **ID:** \`${lottery.id}\`\n\n` +
                    `⏳ Uruchamiam losowanie... Sprawdź logi i kanał wyników.`,
            embeds: [],
            components: []
        });

        // Uruchom loterię testowo
        logger.info(`🧪 TESTOWE uruchomienie loterii przez ${interaction.user.tag}: ${lottery.id}`);
        await lotteryService.executeLottery(lotteryId);

        // Powiadom o zakończeniu
        await interaction.followUp({
            content: `✅ **Testowe losowanie zakończone!**\n\n` +
                    `Sprawdź:\n` +
                    `• 📺 Kanał wyników: <#${lottery.channelId}>\n` +
                    `• 📋 Logi w konsoli\n` +
                    `• 🐛 \`/lottery-debug\` dla szczegółów`,
            ephemeral: true
        });

        logger.info(`✅ ${interaction.user.tag} wykonał testowe uruchomienie loterii przez Select Menu: ${lottery.name} (${lotteryId})`);

    } catch (error) {
        await interaction.editReply({
            content: `❌ **Błąd podczas testowego uruchomienia!**\n\n` +
                    `Szczegóły: ${error.message}\n\n` +
                    `💡 Spróbuj ponownie lub sprawdź logi serwera.`,
            embeds: [],
            components: []
        });
        logger.error('❌ Błąd testowego uruchomienia loterii przez Select Menu:', error);
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
            const { EmbedBuilder } = require('discord.js');
            
            const embed = new EmbedBuilder()
                .setTitle('🎰 PONOWNE LOSOWANIE')
                .setDescription(`**${result.originalResult.lotteryName}**`)
                .setColor('#ffa500')
                .addFields(
                    {
                        name: '📅 Oryginalna loteria',
                        value: new Date(result.originalResult.date).toLocaleString('pl-PL'),
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
                    text: `Ponowne losowanie wykonane przez ${interaction.user.tag} | Oryginalna loteria: ${result.originalResult.lotteryId}` 
                })
                .setTimestamp();

            await interaction.editReply({ 
                embeds: [embed],
                components: []
            });

            logger.info(`✅ ${interaction.user.tag} wykonał ponowne losowanie przez Select Menu dla: ${result.originalResult.lotteryName}`);
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
                const nextDraw = new Date(lottery.nextDraw).toLocaleString('pl-PL');
                debugInfo += `• **${lottery.id}**\n`;
                debugInfo += `  └ Nazwa: ${lottery.name}\n`;
                debugInfo += `  └ Następne losowanie: ${nextDraw}\n`;
                debugInfo += `  └ Cron job: ${hasCronJob ? '✅ Aktywny' : '❌ Brak'}\n`;
                debugInfo += `  └ Pattern: ${lottery.minute} ${lottery.hour} * * ${config.lottery.dayMap[lottery.dayOfWeek]}\n\n`;
            }
        } else {
            debugInfo += `📋 **Brak aktywnych loterii**\n\n`;
        }
        
        // Sprawdź plik danych
        try {
            const fs = require('fs').promises;
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
        
        logger.info(`🐛 ${interaction.user.tag} sprawdził debug loterii`);
        
    } catch (error) {
        await interaction.editReply({
            content: `❌ Błąd podczas debugowania: ${error.message}`
        });
        logger.error('❌ Błąd debugowania loterii:', error);
    }
}

/**
 * Obsługuje komendę lottery-test
 */
async function handleLotteryTestCommand(interaction, config, lotteryService) {
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

    const activeLotteries = lotteryService.getActiveLotteries();

    if (activeLotteries.length === 0) {
        await interaction.reply({
            content: '📋 **Brak aktywnych loterii do testowania.**\n\n💡 Użyj `/lottery` aby utworzyć nową loterię.',
            ephemeral: true
        });
        return;
    }

    // Stwórz Select Menu z aktywnymi loteriami
    const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
    
    const selectOptions = activeLotteries.map(lottery => {
        const datePart = lottery.id.split('_')[0];
        const formattedDate = `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}`;
        const clan = config.lottery.clans[lottery.clanKey];
        
        return {
            label: `${lottery.name}`,
            description: `${lottery.dayOfWeek} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')} | ${formattedDate}`,
            value: lottery.id,
            emoji: '🧪'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('lottery_test_select')
        .setPlaceholder('🧪 Wybierz loterię do testowego uruchomienia...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('🧪 TESTOWE URUCHOMIENIE LOTERII')
        .setDescription(`Wybierz loterię do testowego uruchomienia.\n\n` +
                       `📊 **Aktywnych loterii:** ${activeLotteries.length}\n\n` +
                       `⚠️ **Uwaga:** Testowe uruchomienie wykonuje pełne losowanie z publikacją wyników w kanale. Użyj tylko do debugowania!`)
        .setColor('#ffa500')
        .setFooter({ 
            text: `Żądanie od ${interaction.user.tag}` 
        })
        .setTimestamp();

    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

/**
 * Rejestruje komendy slash
 */
async function registerSlashCommands(client, config) {
    const clanChoices = Object.entries(config.lottery.clans).map(([key, clan]) => ({
        name: clan.displayName,
        value: key
    }));

    const dayChoices = config.lottery.allowedDays.map(day => ({
        name: day.charAt(0).toUpperCase() + day.slice(1),
        value: day
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
                    .setDescription('Co ile dni ma być powtarzana loteria (1-30)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(30))
            .addStringOption(option =>
                option.setName('dzień')
                    .setDescription('Dzień tygodnia')
                    .setRequired(true)
                    .addChoices(...dayChoices))
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
            .setName('lottery-test')
            .setDescription('Testowe uruchomienie loterii (admin only)')
    ];

    const rest = new REST().setToken(config.token);
    
    try {
        logger.info('[COMMANDS] 🔄 Rejestracja komend slash...');
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        logger.info('[COMMANDS] ✅ Komendy slash zarejestrowane pomyślnie');
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

        const { embed, components } = await generateHistoryEmbed(history, currentPage, config);
        
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

        const { embed, components } = await generateHistoryEmbed(history, currentPage, config);
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
async function generateHistoryEmbed(history, currentPage, config) {
    const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    
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
                const date = new Date(result.originalDate || result.date).toLocaleDateString('pl-PL');
                const time = new Date(result.originalDate || result.date).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'});
            
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
            Object.values(config.lottery.targetRoles).forEach(role => {
                if (role.roleId === result.targetRole) {
                    roleName = role.displayName;
                }
            });

            // Pobierz zwycięzców (dla rerolls może być w newWinners)
            const winners = result.winners || result.newWinners || [];
            const winnersText = winners.map(w => w.displayName || w.username).join(', ') || 'Brak zwycięzców';

            description += `**${globalIndex}.** **${result.lotteryName}**\n`;
            description += `📅 ${date} ${time}\n`;
            description += `🏰 **Klan:** ${clanName}\n`;
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
    const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    
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

    Object.values(clanStats).forEach(clan => {
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

module.exports = {
    handleInteraction,
    registerSlashCommands
};