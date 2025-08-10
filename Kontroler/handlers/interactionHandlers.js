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
                default:
                    await interaction.reply({ content: 'Nieznana komenda!', ephemeral: true });
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

    const resultIndex = interaction.options.getInteger('indeks');
    const additionalWinners = interaction.options.getInteger('dodatkowi') || 1;

    await interaction.deferReply({ ephemeral: false });

    try {
        // Pobierz historię loterii
        const history = await lotteryService.getLotteryHistory();
        
        if (history.length === 0) {
            await interaction.editReply({
                content: '❌ Brak historii loterii do ponownego losowania.'
            });
            return;
        }

        if (resultIndex >= history.length || resultIndex < 0) {
            await interaction.editReply({
                content: `❌ Nieprawidłowy indeks. Dostępne indeksy: 0-${history.length - 1}\n\n` +
                        `📋 **Ostatnie loterie:**\n` +
                        history.slice(-5).map((result, index) => 
                            `**${history.length - 5 + index}.** ${result.lotteryName} - ${new Date(result.date).toLocaleString('pl-PL')}`
                        ).join('\n')
            });
            return;
        }

        const result = await lotteryService.rerollLottery(interaction, resultIndex, additionalWinners);
        
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

            await interaction.editReply({ embeds: [embed] });

            logger.info(`✅ ${interaction.user.tag} wykonał ponowne losowanie dla: ${result.originalResult.lotteryName}`);
        }
    } catch (error) {
        await interaction.editReply({
            content: `❌ Błąd podczas ponownego losowania: ${error.message}`
        });
        logger.error('❌ Błąd ponownego losowania:', error);
    }
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
            .setDescription('Przeprowadza ponowne losowanie dla wybranej historycznej loterii')
            .addIntegerOption(option =>
                option.setName('indeks')
                    .setDescription('Indeks loterii z historii (0 = najstarsza)')
                    .setRequired(true)
                    .setMinValue(0))
            .addIntegerOption(option =>
                option.setName('dodatkowi')
                    .setDescription('Liczba dodatkowych zwycięzców (domyślnie 1)')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(10))
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