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
                case 'reroll':
                    await handleRerollCommand(interaction, config, lotteryService);
                    break;
                case 'lottery-remove':
                    await handleLotteryRemoveCommand(interaction, config, lotteryService);
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
                case 'lottery_remove_select':
                    await handleLotteryRemoveSelect(interaction, config, lotteryService);
                    break;
                case 'lottery_test_select':
                    await handleLotteryTestSelect(interaction, config, lotteryService);
                    break;
                case 'reroll_lottery_select':
                    await handleRerollLotterySelect(interaction, config, lotteryService);
                    break;
                default:
                    await interaction.reply({ content: 'Nieznane menu wyboru!', ephemeral: true });
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
 * Obsługuje komendę reroll
 */
async function handleRerollCommand(interaction, config, lotteryService) {
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
            .setCustomId('reroll_lottery_select')
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

    const activeLotteries = lotteryService.getActiveLotteries();

    if (activeLotteries.length === 0) {
        await interaction.reply({
            content: '📋 **Brak aktywnych loterii do usunięcia.**\n\n💡 Użyj `/lottery` aby utworzyć nową loterię.',
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
            emoji: '🎰'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('lottery_remove_select')
        .setPlaceholder('🗑️ Wybierz loterię do usunięcia...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setTitle('🗑️ USUWANIE LOTERII')
        .setDescription(`Wybierz loterię do usunięcia z listy poniżej.\n\n` +
                       `📊 **Aktywnych loterii:** ${activeLotteries.length}\n\n` +
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
 * Obsługuje wybór loterii do usunięcia z Select Menu
 */
async function handleLotteryRemoveSelect(interaction, config, lotteryService) {
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
            .setName('reroll')
            .setDescription('Przeprowadza ponowne losowanie dla wybranej historycznej loterii'),

        new SlashCommandBuilder()
            .setName('lottery-remove')
            .setDescription('Usuwa aktywną loterię (lista wyboru)'),


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

module.exports = {
    handleInteraction,
    registerSlashCommands
};