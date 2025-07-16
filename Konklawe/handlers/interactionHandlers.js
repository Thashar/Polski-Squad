const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class InteractionHandler {
    constructor(config, gameService, rankingService, timerService) {
        this.config = config;
        this.gameService = gameService;
        this.rankingService = rankingService;
        this.timerService = timerService;
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleButtonInteraction(interaction) {
        const [action, ...params] = interaction.customId.split('_');
        const userId = params[params.length - 1];

        if (userId !== interaction.user.id) {
            return await interaction.reply({
                content: 'Możesz używać tylko swoich przycisków!',
                ephemeral: true
            });
        }

        if (action === 'results' || action === 'medals') {
            const subAction = params[0];
            let page = 0;

            if (subAction === 'first') {
                page = 0;
            } else if (subAction === 'prev') {
                page = Math.max(0, parseInt(params[1]) - 1);
            } else if (subAction === 'next') {
                page = parseInt(params[1]) + 1;
            } else if (subAction === 'last') {
                page = parseInt(params[1]);
            }

            try {
                await interaction.deferUpdate();
                let resultsData;
                if (action === 'results') {
                    resultsData = await this.rankingService.createResultsPage(interaction, page);
                } else {
                    resultsData = await this.rankingService.createMedalsPage(interaction, page);
                }
                await interaction.editReply(resultsData);
            } catch (error) {
                logger.error('❌ Błąd podczas aktualizacji strony wyników:', error);
                if (!interaction.replied) {
                    await interaction.reply({
                        content: 'Wystąpił błąd podczas ładowania strony.',
                        ephemeral: true
                    });
                }
            }
        } else if (action === 'stats') {
            const tab = params[0];
            
            try {
                await interaction.deferUpdate();
                const statisticsData = await this.createStatisticsEmbed(interaction, tab);
                await interaction.editReply(statisticsData);
            } catch (error) {
                logger.error('❌ Błąd podczas aktualizacji statystyk:', error);
                if (!interaction.replied) {
                    await interaction.reply({
                        content: 'Wystąpił błąd podczas ładowania statystyk.',
                        ephemeral: true
                    });
                }
            }
        }
    }

    /**
     * Obsługuje interakcje select menu
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleSelectMenuInteraction(interaction) {
        // Usunięto obsługę select menu - używamy tylko przycisków
    }

    /**
     * Obsługuje slash commands
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleSlashCommand(interaction) {
        try {
            if (interaction.channel.id !== this.config.channels.command) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'Ta komenda może być używana tylko na odpowiednim kanale!',
                        flags: 64
                    });
                }
                return;
            }

            const { commandName } = interaction;

            if (commandName === 'podpowiedz') {
                await this.handleHintCommand(interaction);
            } else if (commandName === 'podpowiedzi') {
                await this.handleHintsCommand(interaction);
            } else if (commandName === 'statystyki') {
                await this.handleStatisticsCommand(interaction);
            }

        } catch (error) {
            logger.error('❌ Błąd w obsłudze slash command:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'Wystąpił błąd podczas wykonywania komendy.',
                        flags: 64
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply('Wystąpił błąd podczas wykonywania komendy.');
                }
            } catch (replyError) {
                logger.error('❌ Nie udało się odpowiedzieć na interakcję:', replyError);
            }
        }
    }

    /**
     * Obsługuje komendę /podpowiedz
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleHintCommand(interaction) {
        if (!interaction.member.roles.cache.has(this.config.roles.papal)) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Nie masz uprawnień do dodawania podpowiedzi.',
                    flags: 64
                });
            }
            return;
        }

        const hintText = interaction.options.getString('tekst');
        this.gameService.addHint(hintText);

        // Wyczyść wszystkie timery związane z przypomnieniami o podpowiedziach
        this.timerService.clearHintReminderTimer();
        this.timerService.clearFirstHintReminderTimer();
        this.timerService.clearSecondHintReminderTimer();  
        this.timerService.clearPapalRoleRemovalTimer();
        this.timerService.clearRecurringReminderTimer();

        // Ustaw nowy timer dla kolejnej podpowiedzi (6 godzin)
        await this.timerService.setHintReminderTimer();

        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply();
            
            const embed = new EmbedBuilder()
                .setTitle(`${this.config.emojis.warning} Podpowiedź dodana ${this.config.emojis.warning}`)
                .setDescription(`\`\`\`${hintText}\`\`\``)
                .setColor('#00FF00')
                .setTimestamp()
                .setFooter({ text: `Dodał: ${interaction.user.tag}` });
            
            await interaction.editReply({ embeds: [embed] });
        }
    }

    /**
     * Obsługuje komendę /podpowiedzi
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleHintsCommand(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply();
            
            const embed = new EmbedBuilder()
                .setTitle('📌 Podpowiedzi do hasła')
                .setColor('#FFD700')
                .setTimestamp()
                .setFooter({ text: 'Konklawe - System podpowiedzi' });
            
            if (this.gameService.hints.length === 0) {
                embed.setDescription('🚫 Brak aktualnych podpowiedzi.\n\nPapież może dodać podpowiedź używając `/podpowiedz`.');
            } else {
                const hintsList = this.gameService.hints.map((hint, index) => {
                    const hintNumber = (index + 1).toString().padStart(2, '0');
                    return `\`${hintNumber}.\` ${hint}`;
                }).join('\n');
                
                embed.setDescription(hintsList);
            }
            
            await interaction.editReply({ embeds: [embed] });
        }
    }



    /**
     * Obsługuje komendę /statystyki
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleStatisticsCommand(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ ephemeral: true });
        }

        try {
            const statisticsData = await this.createStatisticsEmbed(interaction, 'current');
            await interaction.editReply(statisticsData);
        } catch (error) {
            logger.error('❌ Błąd w komendzie statystyki:', error);
            try {
                await interaction.editReply('Wystąpił błąd podczas pobierania statystyk.');
            } catch (editError) {
                logger.error('❌ Błąd podczas edycji odpowiedzi:', editError);
            }
        }
    }

    /**
     * Tworzy embed ze statystykami
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} tab - Zakładka do wyświetlenia
     * @returns {Object} - Obiekt z embedem i komponentami
     */
    async createStatisticsEmbed(interaction, tab = 'current') {
        const currentButton = new ButtonBuilder()
            .setCustomId(`stats_current_${interaction.user.id}`)
            .setLabel('📊 Bieżąca gra')
            .setStyle(tab === 'current' ? ButtonStyle.Primary : ButtonStyle.Secondary);

        const historyButton = new ButtonBuilder()
            .setCustomId(`stats_history_${interaction.user.id}`)
            .setLabel('📜 Historia gier')
            .setStyle(tab === 'history' ? ButtonStyle.Primary : ButtonStyle.Secondary);

        const rankingButton = new ButtonBuilder()
            .setCustomId(`stats_ranking_${interaction.user.id}`)
            .setLabel('🏆 Aktualny ranking')
            .setStyle(tab === 'ranking' ? ButtonStyle.Primary : ButtonStyle.Secondary);

        const globalButton = new ButtonBuilder()
            .setCustomId(`stats_global_${interaction.user.id}`)
            .setLabel('📈 Statystyki globalne')
            .setStyle(tab === 'global' ? ButtonStyle.Primary : ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(currentButton, historyButton, rankingButton, globalButton);

        let embed;
        
        switch (tab) {
            case 'current':
                embed = await this.createCurrentGameEmbed(interaction);
                break;
            case 'history':
                embed = await this.createHistoryEmbed(interaction);
                break;
            case 'ranking':
                embed = await this.createRankingEmbed(interaction);
                break;
            case 'global':
                embed = await this.createGlobalStatsEmbed(interaction);
                break;
            default:
                embed = await this.createCurrentGameEmbed(interaction);
        }

        return {
            embeds: [embed],
            components: [row]
        };
    }

    /**
     * Tworzy embed z statystykami bieżącej gry
     */
    async createCurrentGameEmbed(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📊 Statystyki bieżącej gry')
            .setColor('#3498DB')
            .setTimestamp()
            .setFooter({ text: 'Konklawe - Statystyki bieżącej sesji' });

        // Informacje o haśle
        if (this.gameService.trigger) {
            const timeFromSet = this.gameService.getFormattedTimeSincePasswordSet();
            let passwordInfo = `**Czas trwania:** ${timeFromSet}`;
            
            if (this.gameService.triggerSetBy) {
                try {
                    const setByMember = await interaction.guild.members.fetch(this.gameService.triggerSetBy);
                    const setByName = setByMember.nickname || setByMember.user.username;
                    passwordInfo += `\n**Ustawił:** ${setByName}`;
                } catch {
                    passwordInfo += `\n**Ustawił:** Nieznany użytkownik`;
                }
            }
            
            embed.addFields({
                name: '🔑 Aktywne hasło',
                value: passwordInfo,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🔑 Stan gry',
                value: 'Brak aktywnego hasła',
                inline: false
            });
        }

        // Statystyki podpowiedzi
        const hintsCount = this.gameService.hints.length;
        let hintsInfo = `**Liczba podpowiedzi:** ${hintsCount}`;
        if (hintsCount > 0 && this.gameService.lastHintTimestamp) {
            const lastHintTime = new Date(this.gameService.lastHintTimestamp);
            const timeSince = new Date() - lastHintTime;
            const hours = Math.floor(timeSince / (1000 * 60 * 60));
            const minutes = Math.floor((timeSince % (1000 * 60 * 60)) / (1000 * 60));
            hintsInfo += `\n**Ostatnia podpowiedź:** ${hours}h ${minutes}m temu`;
        }

        embed.addFields({
            name: '💡 Podpowiedzi',
            value: hintsInfo,
            inline: true
        });

        // Aktywni gracze w tej sesji
        const currentAttempts = Object.keys(this.gameService.attempts).length;
        const totalAttempts = Object.values(this.gameService.attempts).reduce((sum, attempts) => sum + attempts, 0);
        
        embed.addFields({
            name: '🎯 Aktywność',
            value: `**Aktywni gracze:** ${currentAttempts}\n**Łączne próby:** ${totalAttempts}`,
            inline: true
        });

        // Top 3 najaktywniejsze osoby w bieżącej sesji
        const activePlayersEntries = Object.entries(this.gameService.attempts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3);

        if (activePlayersEntries.length > 0) {
            const activePlayersText = await Promise.all(
                activePlayersEntries.map(async ([userId, attempts], index) => {
                    try {
                        const member = await interaction.guild.members.fetch(userId);
                        const name = member.nickname || member.user.username;
                        return `${index + 1}. ${name} - ${attempts} prób`;
                    } catch {
                        return `${index + 1}. Nieznany użytkownik - ${attempts} prób`;
                    }
                })
            );

            embed.addFields({
                name: '🔥 Najaktywniejsze osoby (bieżąca gra)',
                value: activePlayersText.join('\n'),
                inline: false
            });
        }

        return embed;
    }

    /**
     * Tworzy embed z aktualnym rankingiem
     */
    async createRankingEmbed(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🏆 Aktualny ranking')
            .setColor('#FFD700')
            .setTimestamp()
            .setFooter({ text: 'Konklawe - Aktualny ranking graczy' });

        // Pobierz ranking z gameService
        const ranking = Object.entries(this.gameService.scoreboard)
            .filter(([userId, points]) => points > 0)
            .sort(([,a], [,b]) => b - a);

        if (ranking.length === 0) {
            embed.setDescription('🚫 Brak graczy w rankingu.');
            return embed;
        }

        // Stwórz listę graczy
        const rankingList = await Promise.all(
            ranking.map(async ([userId, points], index) => {
                try {
                    const member = await interaction.guild.members.fetch(userId);
                    const name = member.nickname || member.user.username;
                    const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                    const medalIcons = medalCount > 0 ? ` ${this.config.emojis.virtuttiPapajlari.repeat(medalCount)}` : '';
                    return `${index + 1}. ${name} - ${points}${this.config.emojis.medal}${medalIcons}`;
                } catch {
                    return `${index + 1}. Nieznany użytkownik - ${points}${this.config.emojis.medal}`;
                }
            })
        );

        embed.setDescription(rankingList.join('\n'));
        return embed;
    }

    /**
     * Tworzy embed z historią gier
     */
    async createHistoryEmbed(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📜 Historia gier')
            .setColor('#8E44AD')
            .setTimestamp()
            .setFooter({ text: 'Konklawe - Historia 10 ostatnich gier' });

        const history = this.gameService.getGameHistory();
        
        if (history.completedGames.length === 0) {
            embed.setDescription('🚫 Brak ukończonych gier w historii.\n\nHistoria jest zapisywana od momentu aktualizacji systemu.');
            return embed;
        }

        // Ostatnie 10 gier
        const recentGames = history.completedGames.slice(0, 10);
        const gamesList = await Promise.all(
            recentGames.map(async (game, index) => {
                try {
                    const setByMember = game.setBy ? await interaction.guild.members.fetch(game.setBy) : null;
                    const solvedByMember = await interaction.guild.members.fetch(game.solvedBy);
                    
                    const setByName = setByMember ? (setByMember.nickname || setByMember.user.username) : 'System';
                    const solvedByName = solvedByMember.nickname || solvedByMember.user.username;
                    
                    const duration = this.formatDuration(game.duration);
                    
                    return `\`${(index + 1).toString().padStart(2, '0')}.\` **${game.password}**\n` +
                           `🎯 Ustawił: ${setByName} | ✅ Odgadł: ${solvedByName}\n` +
                           `⏱️ Czas: ${duration} | 🎲 Próby: ${game.totalAttempts} | 💡 Podpowiedzi: ${game.hintsUsed}`;
                } catch {
                    const duration = this.formatDuration(game.duration);
                    return `\`${(index + 1).toString().padStart(2, '0')}.\` **${game.password}**\n` +
                           `🎯 Ustawił: Nieznany | ✅ Odgadł: Nieznany\n` +
                           `⏱️ Czas: ${duration} | 🎲 Próby: ${game.totalAttempts} | 💡 Podpowiedzi: ${game.hintsUsed}`;
                }
            })
        );

        embed.setDescription(gamesList.join('\n\n'));

        return embed;
    }

    /**
     * Formatuje czas w milisekundach na czytelny format
     */
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Tworzy embed ze statystykami globalnymi
     */
    async createGlobalStatsEmbed(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📈 Statystyki globalne')
            .setColor('#F39C12')
            .setTimestamp()
            .setFooter({ text: 'Konklawe - Statystyki globalne' });

        // Statystyki ogólne na górze
        const history = this.gameService.getGameHistory();
        if (history.totalGames > 0) {
            // Znajdź hasło nieodgadnięte najdłużej
            const longestGame = history.completedGames.reduce((longest, current) => 
                current.duration > longest.duration ? current : longest
            );

            // Znajdź hasło wymagające największej ilości prób
            const mostAttemptsGame = history.completedGames.reduce((most, current) => 
                current.totalAttempts > most.totalAttempts ? current : most
            );

            embed.addFields({
                name: '',
                value: `**Łącznie gier:** ${history.totalGames}\n**Próby średnio:** ${history.averageAttempts}\n**Średni czas:** ${this.formatDuration(history.averageTime)}\n\n**Najdłużej nieodgadnięte:** "${longestGame.password}" (${this.formatDuration(longestGame.duration)})\n**Najwięcej prób:** "${mostAttemptsGame.password}" (${mostAttemptsGame.totalAttempts} prób)`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '',
                value: 'Brak danych - nie ukończono jeszcze żadnej gry.',
                inline: false
            });
        }

        // Wszystkie osoby z medalami Virtutti Papajlari
        const allMedalHolders = Object.entries(this.gameService.virtuttiMedals)
            .filter(([,count]) => count > 0)
            .sort(([,a], [,b]) => b - a);

        if (allMedalHolders.length > 0) {
            const allMedalsText = await Promise.all(
                allMedalHolders.map(async ([userId, count], index) => {
                    try {
                        const member = await interaction.guild.members.fetch(userId);
                        const name = member.nickname || member.user.username;
                        const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(count);
                        return `${index + 1}. ${name} - ${medalIcons} (${count})`;
                    } catch {
                        return `${index + 1}. Nieznany użytkownik - (${count})`;
                    }
                })
            );

            embed.addFields({
                name: `${this.config.emojis.virtuttiPapajlari} Wszystkie medale Virtutti Papajlari`,
                value: allMedalsText.join('\n'),
                inline: false
            });

            // Informacja o medalach
            embed.addFields({
                name: '💡 O medalach',
                value: 'Medal Virtutti Papajlari otrzymuje gracz po zdobyciu **30 punktów**. Po zdobyciu medalu ranking zostaje zresetowany.',
                inline: false
            });
        } else {
            embed.addFields({
                name: `${this.config.emojis.virtuttiPapajlari} Medale Virtutti Papajlari`,
                value: 'Jeszcze nikt nie zdobył medalu Virtutti Papajlari!\n\nMedal otrzymuje się po zdobyciu **30 punktów**.',
                inline: false
            });
        }

        return embed;
    }

}

module.exports = InteractionHandler;