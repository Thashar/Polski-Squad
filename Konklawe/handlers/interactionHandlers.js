const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const NicknameManager = require('../../utils/nicknameManagerService');
const VirtuttiService = require('../services/virtuttiService');
const JudgmentService = require('../services/judgmentService');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Konklawe');
class InteractionHandler {
    constructor(config, gameService, rankingService, timerService, nicknameManager, passwordEmbedService = null, scheduledHintsService = null, judgmentService = null, detailedLogger = null) {
        this.config = config;
        this.gameService = gameService;
        this.rankingService = rankingService;
        this.timerService = timerService;
        this.nicknameManager = nicknameManager;
        this.passwordEmbedService = passwordEmbedService;
        this.scheduledHintsService = scheduledHintsService;
        this.judgmentService = judgmentService;
        this.detailedLogger = detailedLogger;
        this.virtuttiService = new VirtuttiService(config);
        this.client = null; // Zostanie ustawiony przez setClient()
        this.activeCurses = new Map(); // userId -> { type: string, data: any, endTime: timestamp }
        this.lucyferReflectedCurses = new Map(); // userId -> { endTime: timestamp, intervalId: any }

        // Ścieżka do pliku aktywnych klątw
        this.cursesFile = path.join(__dirname, '../data/active_curses.json');

        // Wczytaj aktywne klątwy przy starcie
        this.loadActiveCurses();

        // Czyszczenie starych danych co godzinę
        setInterval(() => {
            this.virtuttiService.cleanup();
            this.cleanupExpiredCurses();
        }, 60 * 60 * 1000);
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Zwraca odpowiednie emoji dla danej klątwy na podstawie jej opisu
     * @param {string} curseDescription - Opis klątwy
     * @returns {string} - Emoji reprezentujące klątwę
     */
    getCurseEmojis(curseDescription) {
        if (curseDescription.includes('Slow mode personal')) {
            return '⏰ 🐌';
        } else if (curseDescription.includes('Auto-delete')) {
            return '🗑️ 💨';
        } else if (curseDescription.includes('Random ping')) {
            return '📢 👻';
        } else if (curseDescription.includes('Emoji spam')) {
            return '😀 🎭';
        } else if (curseDescription.includes('Forced caps')) {
            return '📝 🔠';
        } else if (curseDescription.includes('Random timeout')) {
            return '💤 ⏸️';
        } else if (curseDescription.includes('Special role')) {
            return '🔇 🎭';
        } else if (curseDescription.includes('Scrambled words')) {
            return '🔤 🌀';
        } else if (curseDescription.includes('Don\'t be smart')) {
            return '🤡 💢';
        } else if (curseDescription.includes('Blah blah')) {
            return '😂 💬';
        }
        return '💀 ⚡'; // fallback
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;

        // Obsługa przycisków Sądu Bożego
        if (customId === 'judgment_angel') {
            if (this.judgmentService) {
                await this.judgmentService.handleAngelChoice(interaction, interaction.member);
            }
            return;
        }

        if (customId === 'judgment_demon') {
            if (this.judgmentService) {
                await this.judgmentService.handleDemonChoice(interaction, interaction.member);
            }
            return;
        }

        // Obsługa przycisków zarządzania hasłem i podpowiedziami
        if (customId === 'password_set_new' || customId === 'password_change') {
            await this.handlePasswordButton(interaction, customId);
            return;
        }

        if (customId === 'hint_add') {
            await this.handleHintButton(interaction);
            return;
        }

        if (customId === 'hint_schedule') {
            await this.handleScheduleHintButton(interaction);
            return;
        }

        if (customId === 'hint_remove_scheduled') {
            await this.handleRemoveScheduledButton(interaction);
            return;
        }

        // Stara logika przycisków
        const [action, ...params] = interaction.customId.split('_');
        const userId = params[params.length - 1];

        if (userId !== interaction.user.id) {
            return await interaction.reply({
                content: 'Możesz używać tylko swoich przycisków!',
                flags: MessageFlags.Ephemeral
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
                        flags: MessageFlags.Ephemeral
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
                        flags: MessageFlags.Ephemeral
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
        // Obsługa wyboru użytkownika dla Sądu Bożego (anioł)
        if (interaction.customId.startsWith('judgment_angel_user_select_')) {
            const expectedUserId = interaction.customId.split('_').pop();

            // Sprawdź czy to właściwy użytkownik
            if (interaction.user.id !== expectedUserId) {
                return await interaction.reply({
                    content: 'To nie twój wybór! Możesz używać tylko swoich przycisków.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const chosenUserId = interaction.values[0];

            // Pobierz użytkownika
            let chosenUser;
            try {
                chosenUser = await interaction.client.users.fetch(chosenUserId);
            } catch (error) {
                return await interaction.reply({
                    content: '❌ Nie udało się pobrać wybranego użytkownika!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Defer reply - finalizacja może potrwać
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Wywołaj finalizację przez JudgmentService
            if (this.judgmentService) {
                await this.judgmentService.finalizeJudgmentChoice(
                    interaction,
                    interaction.user,
                    chosenUser,
                    'angel'
                );
            }
            return;
        }

        // Obsługa wyboru użytkownika dla Sądu Bożego (demon)
        if (interaction.customId.startsWith('judgment_demon_user_select_')) {
            const expectedUserId = interaction.customId.split('_').pop();

            // Sprawdź czy to właściwy użytkownik
            if (interaction.user.id !== expectedUserId) {
                return await interaction.reply({
                    content: 'To nie twój wybór! Możesz używać tylko swoich przycisków.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const chosenUserId = interaction.values[0];

            // Pobierz użytkownika
            let chosenUser;
            try {
                chosenUser = await interaction.client.users.fetch(chosenUserId);
            } catch (error) {
                return await interaction.reply({
                    content: '❌ Nie udało się pobrać wybranego użytkownika!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Defer reply - finalizacja może potrwać
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Wywołaj finalizację przez JudgmentService
            if (this.judgmentService) {
                await this.judgmentService.finalizeJudgmentChoice(
                    interaction,
                    interaction.user,
                    chosenUser,
                    'demon'
                );
            }
            return;
        }

        if (interaction.customId === 'remove_scheduled_select') {
            await this.handleRemoveScheduledSelect(interaction);
        }
    }

    /**
     * Obsługuje slash commands
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleSlashCommand(interaction) {
        try {
            const { commandName } = interaction;
            
            // Komendy specjalne dla Virtutti Papajlari - działają globalnie
            if (commandName === 'blessing' || commandName === 'virtue-check' || commandName === 'curse') {
                await this.handleVirtuttiPapajlariCommand(interaction);
                return;
            }
            
            // Pozostałe komendy tylko na odpowiednim kanale
            if (interaction.channel.id !== this.config.channels.command) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'Ta komenda może być używana tylko na odpowiednim kanale!',
                        flags: 64
                    });
                }
                return;
            }

            if (commandName === 'podpowiedzi') {
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
                embed.setDescription('🚫 Brak aktualnych podpowiedzi.\n\nPapież może dodać podpowiedź używając przycisku "Dodaj podpowiedź" na kanale z hasłem.');
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
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
                    const setByName = setByMember.displayName;
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
                        const name = member.displayName;
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
                    const name = member.displayName;
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

                    const setByName = setByMember ? setByMember.displayName : 'System';
                    const solvedByName = solvedByMember.displayName;

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
                        const name = member.displayName;
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
                value: 'Medal Virtutti Papajlari otrzymuje gracz po zdobyciu **10 punktów**. Po zdobyciu medalu ranking zostaje zresetowany.',
                inline: false
            });
        } else {
            embed.addFields({
                name: `${this.config.emojis.virtuttiPapajlari} Medale Virtutti Papajlari`,
                value: 'Jeszcze nikt nie zdobył medalu Virtutti Papajlari!\n\nMedal otrzymuje się po zdobyciu **10 punktów**.',
                inline: false
            });
        }

        return embed;
    }

    /**
     * Obsługuje komendy specjalne dla Gabriel i Lucyfer
     * WAŻNE: Virtutti Papajlari to tylko medal kosmetyczny bez uprawnień do komend!
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleVirtuttiPapajlariCommand(interaction) {
        // Sprawdź czy użytkownik ma jedną z uprzywilejowanych ról (Gabriel lub Lucyfer)
        const hasGabriel = interaction.member.roles.cache.has(this.config.roles.gabriel);
        const hasLucyfer = interaction.member.roles.cache.has(this.config.roles.lucyfer);

        if (!hasGabriel && !hasLucyfer) {
            return await interaction.reply({
                content: '⛪ Ta komenda jest dostępna tylko dla posiadaczy ról: Gabriel lub Lucyfer!\n\n💡 Virtutti Papajlari to medal kosmetyczny bez uprawnień do komend.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Określ typ roli
        let roleType = 'gabriel';
        if (hasLucyfer) roleType = 'lucyfer';

        const { commandName } = interaction;

        if (commandName === 'blessing') {
            await this.handleBlessingCommand(interaction, roleType);
        } else if (commandName === 'virtue-check') {
            await this.handleVirtueCheckCommand(interaction, roleType);
        } else if (commandName === 'curse') {
            await this.handleCurseCommand(interaction, roleType);
        }
    }

    /**
     * Obsługuje komendę /blessing
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} roleType - Typ roli ('virtutti', 'gabriel', 'lucyfer')
     */
    async handleBlessingCommand(interaction, roleType = 'virtutti') {
        const targetUser = interaction.options.getUser('użytkownik');
        const userId = interaction.user.id;
        let curseRemoved = false; // Flaga dla specjalnego logowania Gabriel

        // Lucyfer nie może używać blessing
        if (roleType === 'lucyfer') {
            return await interaction.reply({
                content: '🔥 Lucyfer nie może błogosławić! Twoja ścieżka to klątwy, nie łaska.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Gabriel nie może błogosławić Lucyfera - odporność
        if (roleType === 'gabriel') {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            const hasLucyferRole = targetMember.roles.cache.has(this.config.roles.lucyfer);

            if (hasLucyferRole) {
                // Sprawdź czy Lucyfer ma aktywną klątwę i usuń ją wraz z nickiem
                if (this.activeCurses.has(targetUser.id)) {
                    const curseData = this.activeCurses.get(targetUser.id);
                    this.activeCurses.delete(targetUser.id);
                    await this.saveActiveCurses();

                    // Przywróć oryginalny nick - każda klątwa zmienia nick na "Przeklęty"
                    const nicknameManager = this.nicknameManager;
                    if (nicknameManager) {
                        await nicknameManager.restoreOriginalNickname(targetUser.id, interaction.guild);
                        logger.info(`✨ Gabriel przywrócił oryginalny nick Lucyfera ${targetUser.tag}`);
                    }
                }

                return await interaction.reply({
                    content: '☁️ Takie błogosławieństwa nie działają na demona! Ciemność odrzuca światło...',
                    ephemeral: false
                });
            }
        }

        // Sprawdź cooldown i limity (Gabriel ma cooldown per cel)
        const canUse = this.virtuttiService.canUseCommand(userId, 'blessing', roleType, targetUser.id);
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // === SPRAWDŹ ENERGIĘ (KOSZT: 5) ===
        const blessingCost = 5;
        const energyData = this.virtuttiService.getEnergy(userId);

        if (!this.virtuttiService.hasEnoughEnergy(userId, blessingCost)) {
            return await interaction.reply({
                content: `⚡ **Nie masz wystarczająco many!**\n\nKoszt blessing: **${blessingCost}** many\nTwoja mana: **${energyData.energy}/${energyData.maxEnergy}**\n\n🔋 Regeneracja: **10 punktów/godzinę**`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Zużyj energię
        this.virtuttiService.consumeEnergy(userId, blessingCost, 'blessing');

        // Zarejestruj użycie
        if (roleType === 'virtutti') {
            this.virtuttiService.registerUsage(userId, 'blessing', interaction.user.tag);
        } else if (roleType === 'gabriel') {
            this.virtuttiService.registerGabrielBlessing(userId, targetUser.id);
        }

        // Pobierz losowe błogosławieństwo
        const blessing = this.virtuttiService.getRandomBlessing();

        // Dodaj reakcje do oryginalnej wiadomości (jeśli to możliwe)
        const blessingReactions = ['🙏', '✨', '👑', '💫', '🕊️', '⭐', '🌟'];
        const randomReaction = blessingReactions[Math.floor(Math.random() * blessingReactions.length)];

        try {
            // Wyślij błogosławieństwo
            const roleEmoji = roleType === 'gabriel' ? '☁️' : '⛛';
            let blessingMessage = `${roleEmoji} **${targetUser.toString()} otrzymałeś błogosławieństwo!**\n\n${randomReaction} ${blessing}`;

            // === SPECJALNA MECHANIKA GABRIEL ===
            if (roleType === 'gabriel') {
                // 1. Sprawdź czy target ma klątwę - 50% szansa na usunięcie
                if (this.activeCurses.has(targetUser.id)) {
                    const randomChance = Math.random() * 100;
                    if (randomChance < 50) {
                        // Usuń klątwę
                        const curseData = this.activeCurses.get(targetUser.id);
                        this.activeCurses.delete(targetUser.id);
                        await this.saveActiveCurses();

                        // Przywróć oryginalny nick - każda klątwa zmienia nick na "Przeklęty"
                        const nicknameManager = this.nicknameManager;
                        if (nicknameManager) {
                            await nicknameManager.restoreOriginalNickname(targetUser.id, interaction.guild);
                            logger.info(`✨ Gabriel przywrócił oryginalny nick ${targetUser.tag}`);
                        }

                        blessingMessage += `\n\n✨ **Klątwa została usunięta!** ✨`;
                        logger.info(`✨ Gabriel (${interaction.user.tag}) usunął klątwę z ${targetUser.tag}`);

                        // Ustawienie flagi dla późniejszego logowania
                        curseRemoved = true;
                    }
                }

                // 2. 1% szansa na nałożenie silnej klątwy na Lucyfera (1h, zmiana co 5 min)
                const lucyferChance = Math.random() * 100;
                if (lucyferChance < 1) {
                    // Znajdź użytkownika z rolą Lucyfer
                    const guild = interaction.guild;
                    const lucyferRole = this.config.roles.lucyfer;
                    const lucyferMember = guild.members.cache.find(member => member.roles.cache.has(lucyferRole));

                    if (lucyferMember) {
                        // Pobierz dane silnej klątwy
                        const strongCurseData = this.virtuttiService.createGabrielStrongCurseData(lucyferMember.id);

                        // Rozpocznij silną klątwę (1h, zmiana co 5 min)
                        await this.startGabrielStrongCurse(lucyferMember, guild, strongCurseData);

                        blessingMessage += `\n\n💥⚡ **MEGA SILNA KLĄTWA NAŁOŻONA NA LUCYFERA!** ⚡💥`;
                        logger.info(`💥⚡ Gabriel (${interaction.user.tag}) nałożył MEGA SILNĄ KLĄTWĘ na Lucyfera (${lucyferMember.user.tag}) - 1h, zmiana co 5 min`);

                        // Szczegółowe logowanie silnej klątwy Gabriela
                        if (this.detailedLogger) {
                            await this.detailedLogger.logGabrielStrongCurse(
                                interaction.user,
                                lucyferMember.user,
                                60 // 60 minut
                            );
                        }
                    }
                }
            }

            await interaction.reply({
                content: blessingMessage,
                ephemeral: false
            });

            // Wyślij ephemeral message z informacją o pozostałej manie
            const updatedEnergyData = this.virtuttiService.getEnergy(userId);
            await interaction.followUp({
                content: `⚡ **Status many:** ${updatedEnergyData.energy}/${updatedEnergyData.maxEnergy}\n` +
                    `🔋 Regeneracja: **10 pkt/h**`,
                flags: MessageFlags.Ephemeral
            });

            // Szczegółowe logowanie blessing
            if (this.detailedLogger) {
                await this.detailedLogger.logBlessing(
                    interaction.user,
                    targetUser,
                    blessing,
                    blessingCost,
                    updatedEnergyData,
                    curseRemoved
                );
            }

            logger.info(`🙏 ${interaction.user.tag} (${roleType}) błogosławi ${targetUser.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania błogosławieństwa: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas udzielania błogosławieństwa.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    /**
     * Obsługuje komendę /virtue-check
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} roleType - Typ roli ('virtutti', 'gabriel', 'lucyfer')
     */
    async handleVirtueCheckCommand(interaction, roleType = 'virtutti') {
        const targetUser = interaction.options.getUser('użytkownik');
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const userId = interaction.user.id;

        // Sprawdź cooldown i limity
        const canUse = this.virtuttiService.canUseCommand(userId, 'virtueCheck', roleType);
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Zarejestruj użycie
        this.virtuttiService.registerUsage(userId, 'virtueCheck', interaction.user.tag);

        // Pobierz losowe cnoty i radę
        const virtues = this.virtuttiService.getRandomVirtues();
        const advice = this.virtuttiService.getRandomPapalAdvice();

        // Stwórz embed z wynikami
        const embed = new EmbedBuilder()
            .setTitle(`🔍 **Sprawdzenie cnót dla ${targetMember.displayName}**`)
            .setColor('#FFD700')
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp()
            .setFooter({
                text: `Sprawdził: ${interaction.member.displayName} | Cooldown: ${this.config.virtuttiPapajlari.cooldownMinutes} min`,
                iconURL: interaction.user.displayAvatarURL()
            });

        // Dodaj cnoty z opisami
        const virtuesText = virtues.map(virtue => {
            let emoji = '📱';
            if (virtue.percentage >= 80) emoji = '⭐';
            else if (virtue.percentage >= 60) emoji = '✨';
            else if (virtue.percentage >= 40) emoji = '💫';
            else if (virtue.percentage >= 20) emoji = '📱';
            else emoji = '💔';
            
            return `• **${virtue.name}:** **${virtue.percentage}%** ${emoji}\n  *"${virtue.description}"*`;
        }).join('\n\n');

        embed.addFields({
            name: '📊 **Wyniki duchowe:**',
            value: virtuesText,
            inline: false
        });

        embed.addFields({
            name: '⛪ **Papieska rada:**',
            value: `*"${advice}"*`,
            inline: false
        });

        const dailyUsage = this.virtuttiService.dailyUsage.get(userId);
        const remainingUses = this.config.virtuttiPapajlari.dailyLimit - (dailyUsage?.virtueCheck || 0);
        
        embed.addFields({
            name: '📈 **Status:**',
            value: `Pozostałe sprawdzenia dzisiaj: **${remainingUses}/${this.config.virtuttiPapajlari.dailyLimit}**`,
            inline: false
        });

        try {
            await interaction.reply({ embeds: [embed], ephemeral: false });

            // Szczegółowe logowanie virtue check
            if (this.detailedLogger) {
                await this.detailedLogger.logVirtueCheck(
                    interaction.user,
                    targetUser,
                    virtues
                );
            }

            logger.info(`🔍 ${interaction.user.tag} sprawdza cnoty ${targetUser.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas sprawdzania cnót: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas sprawdzania cnót.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    /**
     * Obsługuje komendę /curse
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} roleType - Typ roli ('virtutti', 'gabriel', 'lucyfer')
     */
    async handleCurseCommand(interaction, roleType = 'virtutti') {
        const targetUser = interaction.options.getUser('użytkownik');
        const userId = interaction.user.id;

        // Nie można rzucić klątwy na siebie
        if (targetUser.id === interaction.user.id) {
            return await interaction.reply({
                content: '💀 Nie możesz rzucić klątwy na samego siebie!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetMember = await interaction.guild.members.fetch(targetUser.id);

        // Sprawdź odporności między Gabriel i Lucyfer
        const targetHasGabrielRole = targetMember.roles.cache.has(this.config.roles.gabriel);
        const targetHasLucyferRole = targetMember.roles.cache.has(this.config.roles.lucyfer);

        // Sprawdź czy Lucyfer jest obecnie pod blokadą (po odbiciu klątwy)
        if (roleType === 'lucyfer') {
            const blockData = this.virtuttiService.checkLucyferCurseBlock(userId);
            if (blockData && blockData.blocked) {
                // Szczegółowe logowanie próby użycia curse podczas blokady
                if (this.detailedLogger) {
                    await this.detailedLogger.logLucyferBlock(
                        userId,
                        blockData.remainingMinutes
                    );
                }

                return await interaction.reply({
                    content: `� **Jesteś uśpiony!** Twoja własna klątwa została odbita!\n\n⚠️ Nie możesz używać /curse przez jeszcze **${blockData.remainingMinutes} minut**!`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Sprawdź cooldown i limity
        const canUse = this.virtuttiService.canUseCommand(userId, 'curse', roleType, targetUser.id);
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // === BLOKADA WIELOKROTNYCH KLĄTW ===
        // Sprawdź czy cel już ma aktywną klątwę
        const existingCurse = this.activeCurses.get(targetUser.id);
        if (existingCurse && Date.now() < existingCurse.endTime) {
            const timeLeft = Math.ceil((existingCurse.endTime - Date.now()) / 60000);
            return await interaction.reply({
                content: `⚠️ **${targetUser.toString()} ma już aktywną klątwę!**\n\nPozostały czas: **${timeLeft} min**\n\n💡 Poczekaj aż klątwa wygaśnie zanim rzucisz nową.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // === SPRAWDŹ ENERGIĘ (PROGRESYWNY KOSZT) ===
        // Inicjalizuj dane Lucyfera jeśli to Lucyfer
        if (roleType === 'lucyfer') {
            this.virtuttiService.initializeLucyferData(userId);
            this.virtuttiService.regenerateLucyferMana(userId);
        }

        const energyData = this.virtuttiService.getEnergy(userId);
        const curseCost = roleType === 'lucyfer'
            ? this.virtuttiService.getLucyferCurseCost(userId)
            : energyData.nextCurseCost;

        if (!this.virtuttiService.hasEnoughEnergy(userId, curseCost)) {
            if (roleType === 'lucyfer') {
                const lucyferStats = this.virtuttiService.getLucyferStats(userId);
                const nextRegenMinutes = Math.ceil(lucyferStats.nextRegenIn / (60 * 1000));
                return await interaction.reply({
                    content: `⚡ **Nie masz wystarczająco many!**\n\n` +
                        `Koszt następnej klątwy: **${curseCost}** many\n` +
                        `Twoja mana: **${energyData.energy}/${energyData.maxEnergy}**\n\n` +
                        `🔋 Regeneracja: **1 pkt / ${lucyferStats.regenTimeMinutes} min**\n` +
                        `⏰ Następna mana za: **${nextRegenMinutes} min**\n\n` +
                        `💡 Dynamiczny koszt: ${curseCost} many (5-15)\n` +
                        `📊 Sukcesy obniżają koszt, faile zwiększają`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                return await interaction.reply({
                    content: `⚡ **Nie masz wystarczająco many!**\n\nKoszt następnej klątwy: **${curseCost}** many (${energyData.dailyCurses} klątw dzisiaj)\nTwoja mana: **${energyData.energy}/${energyData.maxEnergy}**\n\n🔋 Regeneracja: **10 punktów/godzinę**\n💡 Koszt rośnie z każdą klątwą: 10 + (klątwy * 2)`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // === SPECJALNA LOGIKA GABRIEL vs LUCYFER ===
        // Gabriel curse → Lucyfer: 33% reset / 33% odporność / 33% klątwa / 1% potężna
        if (roleType === 'gabriel' && targetHasLucyferRole) {
            // Sprawdź czy Lucyfer ma blokadę (Uśpiony)
            const lucyferBlock = this.virtuttiService.checkLucyferCurseBlock(targetUser.id);
            if (lucyferBlock) {
                return await interaction.reply({
                    content: `☁️ **Lucyfer jest Uśpiony!**\n\n😴 Nie możesz rzucić klątwy na Lucyfera, gdy odpoczywa po odbiciu. Pozostało: **${lucyferBlock.remainingMinutes} min**`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const randomChance = Math.random() * 100;

            // Zużyj energię
            this.virtuttiService.consumeEnergy(userId, curseCost, 'curse');

            // Zarejestruj użycie
            this.virtuttiService.registerUsage(userId, 'curse', interaction.user.tag);

            if (randomChance < 33) {
                // 33% - Lucyfer urośnie w siłę (reset % odbicia)
                this.virtuttiService.resetLucyferReflectionChance(targetUser.id);

                return await interaction.reply({
                    content: `☁️ Gabriel rzucił klątwę na Lucyfera!\n\n🔥 **Gabriel używając klątwy przypadkiem wzmocnił Lucyfera!**`,
                    ephemeral: false
                });
            } else if (randomChance >= 33 && randomChance < 66) {
                // 33% - Nic się nie stanie (odporność)
                return await interaction.reply({
                    content: `☁️ Gabriel rzucił klątwę na Lucyfera!\n\n🔥 **Lucyfer okazał się odporny na tę klątwę!** Ciemność chroni go przed światłem...`,
                    ephemeral: false
                });
            } else if (randomChance >= 66 && randomChance < 99) {
                // 33% - Normalna klątwa 5 min
                // Pobierz losową klątwę
                const curse = this.virtuttiService.getRandomCurse();

                try {
                    // Defer reply
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferReply({ ephemeral: false });
                    }

                    // Aplikuj klątwę na Lucyfera
                    try {
                        await this.applyNicknameCurse(targetMember, interaction, curse.duration);
                    } catch (error) {
                        logger.warn(`⚠️ Nie udało się aplikować klątwy na nick: ${error.message}`);
                    }

                    // Wykonaj dodatkową klątwę
                    await this.executeCurse(interaction, targetMember, curse.additional, curse.duration * 60 * 1000);

                    const curseEmojis = this.getCurseEmojis(curse.additional);

                    await interaction.editReply({
                        content: `☁️ **Gabriel przeklął Lucyfera!**\n\n🔥 **${targetUser.toString()} zostałeś przeklęty!** ${curseEmojis}`
                    });

                    logger.info(`☁️ Gabriel (${interaction.user.tag}) skutecznie przeklął Lucyfera (${targetUser.tag})`);
                    return;
                } catch (error) {
                    logger.error(`❌ Błąd podczas rzucania klątwy na Lucyfera: ${error.message}`);
                    return await interaction.reply({
                        content: '❌ Wystąpił błąd podczas przetwarzania klątwy.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } else {
                // 1% - ⚡💥 ULTRA POTĘŻNA KLĄTWA 24h
                const curses = [
                    'slow_mode',
                    'auto_delete',
                    'random_ping',
                    'emoji_spam',
                    'forced_caps',
                    'random_timeout',
                    'special_role'
                ];
                const randomCurse = curses[Math.floor(Math.random() * curses.length)];

                // Nałóż potężną klątwę (5 min aktywna + 24h debuff)
                const debuffData = this.virtuttiService.applyGabrielDebuffToLucyfer(targetUser.id);
                await this.applyCurse(targetMember, randomCurse, interaction.guild, debuffData.initialCurseEndTime);

                return await interaction.reply({
                    content: `☁️ Gabriel rzucił klątwę na Lucyfera!\n\n⚡💥 **ULTRA POTĘŻNA KLĄTWA NAŁOŻONA!** Lucyfer został osłabiony! 💥⚡`,
                    ephemeral: false
                });
            }
        }

        // Lucyfer curse → Gabriel: 100% odbicie
        if (roleType === 'lucyfer' && targetHasGabrielRole) {
            // Automatyczne odbicie klątwy
            const actualTargetMember = await interaction.guild.members.fetch(interaction.user.id);

            // NIE rejestrujemy klątwy gdy jest odbita (licznik tylko dla skutecznych klątw)

            // Pobierz losową klątwę
            const curse = this.virtuttiService.getRandomCurse();

            try {
                // Defer reply
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ ephemeral: false });
                }

                // Aplikuj klątwę na Lucyfera (sam siebie)
                try {
                    await this.applyNicknameCurse(actualTargetMember, interaction, curse.duration);
                } catch (error) {
                    logger.warn(`⚠️ Nie udało się aplikować klątwy na nick: ${error.message}`);
                }

                // Wykonaj dodatkową klątwę
                await this.executeCurse(interaction, actualTargetMember, curse.additional, curse.duration * 60 * 1000);

                const curseEmojis = this.getCurseEmojis(curse.additional);

                await interaction.editReply({
                    content: `🛡️ **Gabriel okazał się odporny na tę klątwę Lucyfera!**\n\n🔥 **${interaction.user.toString()} zostałeś przeklęty własną klątwą!** ${curseEmojis}\n\n*Światło odpiera ciemność...*`
                });

                // Szczegółowe logowanie odbicia Gabriela (33%)
                if (this.detailedLogger) {
                    await this.detailedLogger.logGabrielReflection(
                        interaction.user,
                        targetUser
                    );
                }

                logger.info(`🛡️ Klątwa Lucyfera odbita przez Gabriela: ${interaction.user.tag}`);
                return;

            } catch (error) {
                logger.error(`❌ Błąd podczas odbicia klątwy Lucyfera: ${error.message}`);
                return await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania klątwy.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Sprawdź czy cel ma uprawnienia administratora - odbij klątwę!
        const hasAdminPermissions = targetMember.permissions.has('Administrator');

        let actualTarget = targetUser;
        let actualTargetMember = targetMember;
        let isReflected = false;
        let failedCurse = false;
        let curseReflectedByGabriel = false;

        // GABRIEL - 15% fail, 0% reflect (ale NIE na Lucyfera - to już obsłużone wyżej)
        if (roleType === 'gabriel') {
            const randomChance = Math.random() * 100;

            // 15% szans na niepowodzenie
            if (randomChance < 15) {
                failedCurse = true;
                logger.info(`☁️ Klątwa Gabriela nie powiodła się (${randomChance.toFixed(2)}% < 15%)`);
            }
            // Brak odbicia (0% reflect) - usunięto
        }

        // LUCYFER - progresywne odbicie (blokada 1h + nick "Osłabiony")
        if (roleType === 'lucyfer' && !hasAdminPermissions) {
            const reflectionChance = this.virtuttiService.getLucyferReflectionChance(userId);
            const randomChance = Math.random() * 100;

            if (randomChance < reflectionChance) {
                // Klątwa odbita! Lucyfer dostaje blokadę 1h + nick "Osłabiony"
                logger.info(`🔥 Klątwa Lucyfera została odbita! (${randomChance.toFixed(2)}% < ${reflectionChance}%)`);

                // Zablokuj rzucanie klątw na 1h
                this.virtuttiService.blockLucyferCurses(userId);

                // Zresetuj licznik progresywnego odbicia do 0%
                this.virtuttiService.resetLucyferReflectionChance(userId);

                // Zmień nick na "Osłabiony [nick]"
                try {
                    const lucyferMember = await interaction.guild.members.fetch(userId);
                    const durationMs = 60 * 60 * 1000; // 1 godzina
                    const endTime = Date.now() + durationMs;

                    // Zapisz oryginalny nick w nickname managerze
                    if (this.nicknameManager) {
                        const effectData = await this.nicknameManager.saveOriginalNickname(
                            userId,
                            'CURSE',
                            lucyferMember,
                            durationMs
                        );

                        // KRYTYCZNE: Użyj czystego nicku (bez istniejących prefixów)
                        const cleanNick = this.nicknameManager.getCleanNickname(lucyferMember.displayName);
                        const sleepyNick = `Uśpiony ${cleanNick}`.substring(0, 32);
                        await lucyferMember.setNickname(sleepyNick);

                        logger.info(`🔥 Zmieniono nick Lucyfera ${lucyferMember.user.tag} na "${sleepyNick}" na 1h`);

                        // Zapisz do activeCurses
                        this.activeCurses.set(userId, {
                            type: 'nickname',
                            data: { effectId: userId }, // effectId to samo co userId
                            endTime
                        });
                        await this.saveActiveCurses();

                        // Timer do automatycznego przywrócenia nicku po 1h
                        setTimeout(async () => {
                            try {
                                const restored = await this.nicknameManager.restoreOriginalNickname(userId, interaction.guild);
                                if (restored) {
                                    logger.info(`✅ Automatycznie przywrócono nick po odbiciu klątwy dla ${lucyferMember.user.tag}`);
                                }
                                // Bonus 50 many jest dodawany automatycznie przez virtuttiService.blockLucyferCurses()
                            } catch (error) {
                                logger.error(`❌ Błąd automatycznego przywracania nicku po odbiciu: ${error.message}`);
                            }
                        }, durationMs);
                    }
                } catch (error) {
                    logger.error(`❌ Błąd zmiany nicku przy odbiciu: ${error.message}`);
                }

                // Szczegółowe logowanie odbicia Lucyfera (progresywne)
                if (this.detailedLogger) {
                    await this.detailedLogger.logLucyferReflection(
                        interaction.user,
                        reflectionChance,
                        randomChance
                    );
                }

                // Wyślij komunikat o odbiciu i blokadzie
                return await interaction.reply({
                    content: `🔥 **O nie! Klątwa została odbita!**\n\n⚠️ **Lucyfer został osłabiony!**\n\n*Siły ciemności nie zagrażają serwerowi...*`,
                    ephemeral: false
                });
            }
        }

        // Admin - standardowe odbicie
        if (hasAdminPermissions && !curseReflectedByGabriel) {
            actualTarget = interaction.user;
            actualTargetMember = await interaction.guild.members.fetch(interaction.user.id);
            isReflected = true;
            logger.info(`🛡️ Klątwa odbita przez admina! ${targetUser.tag} odbija klątwę na ${interaction.user.tag}`);
        }

        // Zużyj manę (lub zwróć połowę przy failu)
        if (failedCurse) {
            // Gabriel failnął - zwróć połowę many
            this.virtuttiService.refundHalfEnergy(userId, curseCost);
        } else {
            // Normalnie zużyj manę
            this.virtuttiService.consumeEnergy(userId, curseCost, 'curse');
        }

        // Zarejestruj użycie
        if (roleType === 'virtutti' || roleType === 'gabriel') {
            this.virtuttiService.registerUsage(userId, 'curse', interaction.user.tag);
        } else if (roleType === 'lucyfer') {
            if (!isReflected) {
                // Lucyfer SUKCES - rejestruj i obniż koszt
                this.virtuttiService.registerLucyferCurse(userId, targetUser.id);
                this.virtuttiService.updateLucyferCost(userId, true); // Sukces

                // Logowanie diagnostyczne
                const currentReflectionChance = this.virtuttiService.getLucyferReflectionChance(userId);
                logger.info(`🔥 Lucyfer ${interaction.user.tag} zarejestrował klątwę (SUKCES). Szansa odbicia: ${currentReflectionChance}%`);
            } else {
                // Lucyfer FAIL (odbicie) - podnieś koszt, NIE rejestruj klątwy
                this.virtuttiService.updateLucyferCost(userId, false); // Fail
                logger.info(`🔥 Lucyfer ${interaction.user.tag} - klątwa ODBITA. Koszt zwiększony.`);
            }
        }

        // Jeśli Gabriel failnął, wyślij komunikat i zakończ
        if (failedCurse) {
            const failMessages = [
                `☁️ **O nie!** Klątwa nie powiodła się! Moc Gabriela nie była wystarczająca...`,
                `☁️ **Ups!** Klątwa rozwiała się w powietrzu!`,
                `☁️ **Nieudane!** Nawet święci anieli mają swoje dni... Klątwa nie zadziałała!`,
                `☁️ **Fiasko!** Łaska zablokowała klątwę! Może następnym razem się uda.`
            ];
            const randomFailMessage = failMessages[Math.floor(Math.random() * failMessages.length)];

            // Szczegółowe logowanie faila klątwy
            if (this.detailedLogger) {
                const refund = Math.floor(curseCost / 2);
                const energyDataAfterRefund = this.virtuttiService.getEnergy(userId);
                await this.detailedLogger.logCurseFail(
                    interaction.user,
                    targetUser,
                    curseCost,
                    refund,
                    energyDataAfterRefund
                );
            }

            return await interaction.reply({
                content: randomFailMessage,
                ephemeral: false
            });
        }

        // === LOSUJ POZIOM KLĄTWY ===
        // Gabriel: ZAWSZE zwykła klątwa (5 min)
        // Lucyfer i Virtutti: 96% zwykła / 3% silna / 1% potężna
        let curseLevel, curseDuration;

        if (roleType === 'gabriel') {
            // Gabriel rzuca TYLKO zwykłe klątwy
            curseLevel = 'normal';
            curseDuration = this.virtuttiService.getCurseDuration(curseLevel);
        } else {
            // Lucyfer i Virtutti mają normalne prawdopodobieństwa
            curseLevel = this.virtuttiService.rollCurseLevel();
            curseDuration = this.virtuttiService.getCurseDuration(curseLevel);
        }

        // Pobierz losową klątwę
        const curse = this.virtuttiService.getRandomCurse();

        // Log poziomu klątwy
        const levelEmoji = curseLevel === 'powerful' ? '💥' : (curseLevel === 'strong' ? '⚡' : '💀');
        logger.info(`${levelEmoji} Poziom klątwy: ${curseLevel} (czas: ${curseDuration / 60000} min)`);

        try {
            // Defer reply
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ ephemeral: false });
            }

            let nicknameError = null;

            // Aplikuj klątwę na nick (z czasem zależnym od poziomu)
            try {
                // Konwertuj curseDuration z ms na minuty
                const durationInMinutes = curseDuration / (60 * 1000);
                await this.applyNicknameCurse(actualTargetMember, interaction, durationInMinutes);
                logger.info(`✅ Pomyślnie zmieniono nick na "Przeklęty" dla ${actualTargetMember.user.tag}`);
            } catch (error) {
                logger.error(`❌ BŁĄD zmiany nicku na "Przeklęty" dla ${actualTargetMember.user.tag}: ${error.message}`);
                logger.error(`Stack trace:`, error.stack);
                nicknameError = error.message;
            }

            // Wykonaj dodatkową klątwę (z czasem zależnym od poziomu)
            await this.executeCurse(interaction, actualTargetMember, curse.additional, curseDuration);

            // Przygotuj komunikat
            const curseEmojis = this.getCurseEmojis(curse.additional);

            let responseContent;
            const roleEmoji = roleType === 'gabriel' ? '☁️' : (roleType === 'lucyfer' ? '🔥' : '💀');

            // Opis poziomu klątwy
            let levelDescription = '';
            if (curseLevel === 'powerful') {
                levelDescription = `\n\n💥 **POTĘŻNA KLĄTWA!**`;
            } else if (curseLevel === 'strong') {
                levelDescription = `\n\n⚡ **SILNA KLĄTWA!**`;
            } else {
                // Normal - brak dodatkowego opisu
                levelDescription = '';
            }

            if (curseReflectedByGabriel) {
                responseContent = `${roleEmoji} **Klątwa została odbita!** Gabriel dostaje własną klątwę! ${curseEmojis}${levelDescription}`;
            } else if (isReflected) {
                if (roleType === 'lucyfer') {
                    responseContent = `🔥 **O nie! Klątwa została odbita i wzmocniona przez co Lucyfer mocno osłabł! Siły ciemności nie zagrażają serwerowi!** ${curseEmojis}`;
                } else {
                    responseContent = `🛡️ **O nie! ${targetUser.toString()} jest zbyt potężny i odbija klątwę!**\n\n` +
                        `${roleEmoji} **${actualTarget.toString()} zostałeś przeklęty własną klątwą!** ${curseEmojis}${levelDescription}`;
                }
            } else {
                responseContent = `${roleEmoji} **${actualTarget.toString()} zostałeś przeklęty!** ${curseEmojis}${levelDescription}`;
            }

            if (nicknameError) {
                responseContent += `\n\n⚠️ *Uwaga: ${nicknameError}*`;
            }

            await interaction.editReply({
                content: responseContent
            });

            // Wyślij ephemeral message z informacją o manie i statusie
            const updatedEnergyData = this.virtuttiService.getEnergy(userId);
            const nextCostInfo = `Następna klątwa: **${updatedEnergyData.nextCurseCost}** many`;

            if (roleType !== 'lucyfer') {
                const remainingUses = this.virtuttiService.getRemainingUses(userId, 'curse');

                await interaction.followUp({
                    content: `⚡ **Status many:** ${updatedEnergyData.energy}/${updatedEnergyData.maxEnergy}\n` +
                        `📊 Rzucone dzisiaj: **${updatedEnergyData.dailyCurses}** klątw\n` +
                        `💰 ${nextCostInfo}\n` +
                        `🔋 Regeneracja: **10 pkt/h**`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                // Lucyfer - pokaż kompletne statystyki z nowego systemu
                const lucyferStats = this.virtuttiService.getLucyferStats(userId);
                const nextRegenMinutes = Math.ceil(lucyferStats.nextRegenIn / (60 * 1000));
                const nextRegenSeconds = Math.ceil((lucyferStats.nextRegenIn % (60 * 1000)) / 1000);

                // Logowanie diagnostyczne
                logger.info(`🔥 Lucyfer ${interaction.user.tag} wyświetlenie statusu. Szansa odbicia: ${lucyferStats.reflectionChance}%`);

                await interaction.followUp({
                    content: `🔥 **=== STATUS LUCYFERA ===**\n\n` +
                        `⚡ **Mana:** ${updatedEnergyData.energy}/${updatedEnergyData.maxEnergy}\n` +
                        `💰 **Koszt następnej klątwy:** ${lucyferStats.cost} many (5-15)\n\n` +
                        `🔋 **Regeneracja:** 1 pkt / ${lucyferStats.regenTimeMinutes} min\n` +
                        `⏰ **Następna mana za:** ${nextRegenMinutes}m ${nextRegenSeconds}s\n\n` +
                        `📊 **Statystyki:**\n` +
                        `├─ Rzucone klątwy: **${lucyferStats.curseCount}**\n` +
                        `├─ Seria sukcesów: **${lucyferStats.successStreak}** ✅\n` +
                        `├─ Seria failów: **${lucyferStats.failStreak}** ❌\n` +
                        `└─ Szansa odbicia: **${lucyferStats.reflectionChance}%** 🛡️\n\n` +
                        `💡 **Mechaniki:**\n` +
                        `• Atakowanie tej samej osoby: +1 min regeneracji\n` +
                        `• Atakowanie różnych osób: -1 min regeneracji\n` +
                        `• Sukcesy: -1 koszt klątwy\n` +
                        `• Faile (odbicia): +1 koszt klątwy`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Szczegółowe logowanie klątwy (tylko dla skutecznych klątw, nie dla failów)
            if (this.detailedLogger) {
                // Oblicz reflectionChance tylko dla Lucyfera
                const reflectionChance = roleType === 'lucyfer' ?
                    this.virtuttiService.getLucyferReflectionChance(userId) : null;

                await this.detailedLogger.logCurse(
                    interaction.user,
                    actualTarget,
                    curse.additional,
                    curseLevel,
                    curseCost,
                    updatedEnergyData,
                    reflectionChance,
                    roleType,
                    userId,
                    this.virtuttiService
                );
            }

            logger.info(`💀 ${interaction.user.tag} (${roleType}) przeklął ${actualTarget.tag}${isReflected ? ' (odbita klątwa)' : ''}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas rzucania klątwy: ${error.message}`);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas rzucania klątwy.',
                    flags: MessageFlags.Ephemeral
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas rzucania klątwy.'
                });
            }
        }
    }

    /**
     * Rozpoczyna godzinną karę dla Lucyfera po odbiciu klątwy
     * @param {string} userId - ID Lucyfera
     * @param {Guild} guild - Serwer Discord
     */
    async startLucyferReflectionPunishment(userId, guild) {
        const endTime = Date.now() + (60 * 60 * 1000); // 1 godzina

        // Wyczyść poprzednią karę jeśli istnieje
        const existingPunishment = this.lucyferReflectedCurses.get(userId);
        if (existingPunishment && existingPunishment.intervalId) {
            clearInterval(existingPunishment.intervalId);
        }

        // Ustaw interwał co 5 minut (12 klątw total przez godzinę)
        const intervalId = setInterval(async () => {
            if (Date.now() >= endTime) {
                clearInterval(intervalId);
                this.lucyferReflectedCurses.delete(userId);
                logger.info(`🔥 Kara odbicia zakończona dla Lucyfera ${userId}`);
                return;
            }

            try {
                const member = await guild.members.fetch(userId);
                const curse = this.virtuttiService.getRandomCurse();

                // Aplikuj losową klątwę
                await this.executeCurse({ guild, channel: member.guild.channels.cache.first() }, member, curse.additional, curse.duration * 60 * 1000);
                logger.info(`🔥 Lucyfer ${userId} dostał losową klątwę odbicia: ${curse.additional}`);
            } catch (error) {
                logger.error(`❌ Błąd podczas aplikowania klątwy odbicia dla Lucyfera: ${error.message}`);
            }
        }, 5 * 60 * 1000); // Co 5 minut

        // Zapisz karę
        this.lucyferReflectedCurses.set(userId, {
            endTime,
            intervalId
        });

        logger.info(`🔥 Rozpoczęto godzinną karę odbicia dla Lucyfera ${userId} (12 klątw co 5 min)`);
    }

    /**
     * Rozpoczyna 💥⚡ MEGA SILNĄ KLĄTWĘ Gabriela na Lucyfera (1h, zmiana co 5 min)
     * @param {GuildMember} lucyferMember - Członek z rolą Lucyfer
     * @param {Guild} guild - Serwer Discord
     * @param {Object} strongCurseData - Dane MEGA SILNEJ klątwy
     */
    async startGabrielStrongCurse(lucyferMember, guild, strongCurseData) {
        const userId = lucyferMember.id;
        const endTime = Date.now() + strongCurseData.duration;

        // Wyczyść poprzednią silną klątwę jeśli istnieje
        if (this.gabrielStrongCurses && this.gabrielStrongCurses.has(userId)) {
            const existing = this.gabrielStrongCurses.get(userId);
            if (existing.intervalId) {
                clearInterval(existing.intervalId);
            }
        }

        // Inicjalizuj Map jeśli nie istnieje
        if (!this.gabrielStrongCurses) {
            this.gabrielStrongCurses = new Map();
        }

        // Aplikuj pierwszą klątwę natychmiast
        const curses = [
            'slow_mode',
            'auto_delete',
            'random_ping',
            'emoji_spam',
            'forced_caps',
            'random_timeout',
            'special_role'
        ];

        const firstCurse = curses[Math.floor(Math.random() * curses.length)];
        try {
            await this.applyCurse(lucyferMember, firstCurse, guild, endTime);
            logger.info(`💥⚡ MEGA SILNA KLĄTWA: Lucyfer ${userId} dostał pierwszą klątwę: ${firstCurse}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas aplikowania pierwszej silnej klątwy: ${error.message}`);
        }

        // Ustaw interwał co 5 minut
        const intervalId = setInterval(async () => {
            if (Date.now() >= endTime) {
                clearInterval(intervalId);
                this.gabrielStrongCurses.delete(userId);
                logger.info(`💥⚡ MEGA SILNA KLĄTWA zakończona dla Lucyfera ${userId}`);
                return;
            }

            try {
                const member = await guild.members.fetch(userId);
                const randomCurse = curses[Math.floor(Math.random() * curses.length)];

                // Aplikuj nową losową klątwę
                await this.applyCurse(member, randomCurse, guild, Date.now() + strongCurseData.changeInterval);
                logger.info(`💥⚡ MEGA SILNA KLĄTWA: Lucyfer ${userId} dostał zmianę klątwy: ${randomCurse}`);
            } catch (error) {
                logger.error(`❌ Błąd podczas zmiany silnej klątwy Gabriela: ${error.message}`);
            }
        }, strongCurseData.changeInterval);

        // Zapisz silną klątwę
        this.gabrielStrongCurses.set(userId, {
            endTime,
            intervalId
        });

        logger.info(`⚡ Rozpoczęto silną klątwę Gabriela na Lucyfera ${userId} (1h, zmiana co 5 min)`);
    }

    /**
     * Wykonuje konkretną klątwę
     * @param {Interaction} interaction - Interakcja Discord
     * @param {GuildMember} targetMember - Docelowy członek serwera
     * @param {string} curseDescription - Opis klątwy
     * @param {number} curseDuration - Czas trwania klątwy w ms (opcjonalnie, domyślnie 5 minut)
     */
    async executeCurse(interaction, targetMember, curseDescription, curseDuration = 5 * 60 * 1000) {
        const userId = targetMember.id;
        const now = Date.now();
        
        if (curseDescription.includes('Slow mode personal')) {
            // Slow mode - 30 sekund między wiadomościami
            this.activeCurses.set(userId, {
                type: 'slowMode',
                data: { lastMessage: 0 },
                endTime: now + curseDuration
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Auto-delete')) {
            // Auto-delete z szansą 30%
            this.activeCurses.set(userId, {
                type: 'autoDelete',
                data: { chance: 3.33 }, // 1/3.33 szansa (30%)
                endTime: now + curseDuration
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Random ping')) {
            // Random ping
            this.activeCurses.set(userId, {
                type: 'randomPing',
                data: { channel: interaction.channel },
                endTime: now + curseDuration
            });
            this.startRandomPing(userId, interaction.channel);
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Emoji spam')) {
            // Emoji spam z szansą 30%
            this.activeCurses.set(userId, {
                type: 'emojiSpam',
                data: { chance: 3.33 }, // 1/3.33 szansa (30%)
                endTime: now + curseDuration
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Forced caps')) {
            // Forced caps z szansą 100%
            this.activeCurses.set(userId, {
                type: 'forcedCaps',
                data: { chance: 100 },
                endTime: now + curseDuration
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Random timeout')) {
            // Random timeout
            this.activeCurses.set(userId, {
                type: 'randomTimeout',
                data: { isTimedOut: false },
                endTime: now + curseDuration
            });
            this.startRandomTimeout(userId, targetMember);
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Special role')) {
            // Special role na 5 minut
            try {
                const specialRole = interaction.guild.roles.cache.get(this.config.virtuttiPapajlari.specialRoleId);
                if (specialRole) {
                    await targetMember.roles.add(specialRole);
                    logger.info(`🎭 Nadano specjalną rolę ${targetMember.user.tag} (klątwa)`);
                    
                    // Usuń rolę po czasie trwania klątwy
                    setTimeout(async () => {
                        try {
                            const memberToUpdate = await interaction.guild.members.fetch(targetMember.id);
                            if (memberToUpdate && memberToUpdate.roles.cache.has(this.config.virtuttiPapajlari.specialRoleId)) {
                                await memberToUpdate.roles.remove(specialRole);
                                logger.info(`🎭 Usunięto specjalną rolę ${targetMember.user.tag} (koniec klątwy)`);
                            }
                        } catch (error) {
                            logger.error(`❌ Błąd usuwania specjalnej roli: ${error.message}`);
                        }
                    }, curseDuration);
                } else {
                    logger.warn(`⚠️ Nie znaleziono specjalnej roli o ID: ${this.config.virtuttiPapajlari.specialRoleId}`);
                }
            } catch (error) {
                logger.error(`❌ Błąd nakładania specjalnej roli: ${error.message}`);
            }

        } else if (curseDescription.includes('Scrambled words')) {
            // Scrambled words z szansą 30%
            this.activeCurses.set(userId, {
                type: 'scrambledWords',
                data: { chance: 30 },
                endTime: now + curseDuration
            });
            this.saveActiveCurses();

        } else if (curseDescription.includes('Don\'t be smart')) {
            // Don't be smart z szansą 30%
            this.activeCurses.set(userId, {
                type: 'dontBeSmart',
                data: { chance: 30 },
                endTime: now + curseDuration
            });
            this.saveActiveCurses();

        } else if (curseDescription.includes('Blah blah')) {
            // Blah blah z szansą 30%
            this.activeCurses.set(userId, {
                type: 'blahBlah',
                data: {
                    chance: 30,
                    gifs: [
                        "https://tenor.com/view/blablabla-stopmainsplaining-gif-4048671241003979606",
                        "https://tenor.com/view/blah-blah-blah-blah-blah-blah-gif-22583735",
                        "https://tenor.com/view/bluh-bluh-gif-1341121593359244317",
                        "https://tenor.com/view/aburrido-gif-6860728247558979752",
                        "https://tenor.com/view/not-listening-stop-talking-shh-gif-18219914",
                        "https://tenor.com/view/leatylrs-friends-gif-24758003",
                        "https://tenor.com/view/blah-blah-blah-gif-2813101195058663365"
                    ]
                },
                endTime: now + curseDuration
            });
            this.saveActiveCurses();
        }
    }

    /**
     * Rozpoczyna losowe timeout/przywracanie
     * @param {string} userId - ID użytkownika
     * @param {GuildMember} targetMember - Docelowy członek
     */
    startRandomTimeout(userId, targetMember) {
        const timeoutInterval = setInterval(async () => {
            const curse = this.activeCurses.get(userId);
            if (!curse || curse.type !== 'randomTimeout' || Date.now() > curse.endTime) {
                // Koniec klątwy - upewnij się że użytkownik nie jest na timeout
                if (curse && curse.data.isTimedOut) {
                    try {
                        const member = await targetMember.guild.members.fetch(userId);
                        await member.timeout(null, 'Koniec klątwy random timeout');
                        logger.info(`💤 Przywrócono użytkownika ${member.user.tag} (koniec klątwy)`);
                    } catch (error) {
                        logger.error(`❌ Błąd przywracania z timeout: ${error.message}`);
                    }
                }
                clearInterval(timeoutInterval);
                return;
            }

            // Co 10 sekund losowanie 30% szansy na akcję timeout
            const chance = Math.random() * 100;
            if (chance < 30) {
                try {
                    const member = await targetMember.guild.members.fetch(userId);
                    const currentCurse = this.activeCurses.get(userId);
                    if (!currentCurse || currentCurse.type !== 'randomTimeout') return;

                    if (currentCurse.data.isTimedOut) {
                        // Przywróć z timeout
                        await member.timeout(null, 'Klątwa - random przywrócenie');
                        currentCurse.data.isTimedOut = false;
                        this.saveActiveCurses();
                        logger.info(`💤 Przywrócono użytkownika ${member.user.tag} (klątwa)`);
                    } else {
                        // Wyślij na timeout (maksymalnie 10 sekund)
                        const timeoutDuration = 10 * 1000; // 10 sekund
                        await member.timeout(timeoutDuration, 'Klątwa - random timeout');
                        currentCurse.data.isTimedOut = true;
                        this.saveActiveCurses();
                        logger.info(`💤 Wysłano na timeout użytkownika ${member.user.tag} na 10 sek (klątwa)`);
                        
                        // Automatycznie przywróć po 10 sekundach i oznacz jako nie-timeout
                        setTimeout(() => {
                            if (currentCurse.data.isTimedOut) {
                                currentCurse.data.isTimedOut = false;
                                this.saveActiveCurses();
                            }
                        }, timeoutDuration);
                    }
                } catch (error) {
                    logger.error(`❌ Błąd random timeout: ${error.message}`);
                }
            }

        }, 10000); // Sprawdzaj co 10 sekund
    }

    /**
     * Rozpoczyna losowe pingowanie
     * @param {string} userId - ID użytkownika
     * @param {Channel} channel - Kanał do pingowania
     */
    startRandomPing(userId, channel) {
        const pingInterval = setInterval(async () => {
            const curse = this.activeCurses.get(userId);
            if (!curse || curse.type !== 'randomPing' || Date.now() > curse.endTime) {
                clearInterval(pingInterval);
                return;
            }
            
            try {
                await channel.send(`<@${userId}> 👻`);
                setTimeout(async () => {
                    try {
                        const messages = await channel.messages.fetch({ limit: 1 });
                        const lastMessage = messages.first();
                        if (lastMessage && lastMessage.content === `<@${userId}> 👻`) {
                            await lastMessage.delete();
                        }
                    } catch (error) {
                        // Ignoruj błędy usuwania
                    }
                }, 2000);
            } catch (error) {
                logger.error(`❌ Błąd random ping: ${error.message}`);
            }
        }, Math.random() * 60000 + 30000); // 30-90 sekund między pingami
    }

    /**
     * Sprawdza czy wiadomość powinna być obsłużona przez klątwę
     * @param {Message} message - Wiadomość Discord
     */
    async handleCurseEffects(message) {
        if (message.author.bot) return;
        
        const userId = message.author.id;
        const curse = this.activeCurses.get(userId);
        
        if (!curse || Date.now() > curse.endTime) {
            if (curse) {
                this.activeCurses.delete(userId);
                this.saveActiveCurses();
            }
            return;
        }
        
        switch (curse.type) {
            case 'slowMode':
                const timeSinceLastMessage = Date.now() - curse.data.lastMessage;
                if (timeSinceLastMessage < 30000) {
                    try {
                        await message.delete();
                        const warning = await message.channel.send(`${message.author.toString()} musisz czekać ${Math.ceil((30000 - timeSinceLastMessage) / 1000)} sekund! 🐌`);
                        setTimeout(() => warning.delete().catch(() => {}), 3000);
                    } catch (error) {
                        logger.error(`❌ Błąd slow mode: ${error.message}`);
                    }
                } else {
                    curse.data.lastMessage = Date.now();
                }
                break;
                
            case 'autoDelete':
                // Losowa szansa 30% na usunięcie wiadomości
                const deleteChance = Math.random() * 100;
                if (deleteChance < 30) {
                    setTimeout(async () => {
                        try {
                            await message.delete();
                        } catch (error) {
                            // Ignoruj błędy usuwania
                        }
                    }, 3000);
                }
                break;
                
            case 'emojiSpam':
                // Losowa szansa 30% na emoji spam
                const emojiChance = Math.random() * 100;
                if (emojiChance < 30) {
                    const emojis = ['😀', '😂', '🤣', '😭', '😡', '💀', '👻', '🔥', '💯', '❤️'];
                    try {
                        for (const emoji of emojis) {
                            await message.react(emoji);
                        }
                    } catch (error) {
                        logger.error(`❌ Błąd emoji spam: ${error.message}`);
                    }
                }
                break;
                
            case 'forcedCaps':
                // Szansa na forced caps zgodnie z ustawieniem klątwy
                const capsChance = Math.random() * 100;
                if (capsChance < curse.data.chance && !message.content.match(/^[A-Z\s\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]*$/)) {
                    try {
                        const capsMessage = await message.channel.send(`${message.content.toUpperCase()}`);
                    } catch (error) {
                        logger.error(`❌ Błąd forced caps: ${error.message}`);
                    }
                }
                break;

            case 'scrambledWords':
                // Szansa 30% na przemieszanie liter w słowach
                const scrambleChance = Math.random() * 100;
                if (scrambleChance < curse.data.chance) {
                    try {
                        await message.delete();
                        const scrambledText = this.scrambleWords(message.content);
                        const member = await message.guild.members.fetch(message.author.id);
                        const displayName = member.displayName;
                        await message.channel.send(`**${displayName}** chciał powiedzieć, że ${scrambledText}`);
                    } catch (error) {
                        logger.error(`❌ Błąd scrambled words: ${error.message}`);
                    }
                }
                break;

            case 'dontBeSmart':
                // Szansa 30% na "nie mądruj się"
                const smartChance = Math.random() * 100;
                if (smartChance < curse.data.chance) {
                    try {
                        await message.delete();
                        await message.channel.send(`${message.author.toString()} nie mądruj się! <:z_Trollface:1171154605372084367>`);
                    } catch (error) {
                        logger.error(`❌ Błąd don't be smart: ${error.message}`);
                    }
                }
                break;

            case 'blahBlah':
                // Szansa 30% na losowy GIF
                const blahChance = Math.random() * 100;
                if (blahChance < curse.data.chance) {
                    try {
                        const randomGif = curse.data.gifs[Math.floor(Math.random() * curse.data.gifs.length)];
                        await message.reply(randomGif);
                    } catch (error) {
                        logger.error(`❌ Błąd blah blah: ${error.message}`);
                    }
                }
                break;
        }
    }

    /**
     * Miesza litery w słowach (zachowując pierwszą i ostatnią literę)
     * @param {string} text - Tekst do przemieszania
     * @returns {string} - Przemieszany tekst
     */
    scrambleWords(text) {
        return text.split(' ').map(word => {
            // Jeśli słowo ma mniej niż 4 znaki, zostaw bez zmian
            if (word.length <= 3) return word;

            // Wyodrębnij pierwszą, ostatnią i środkowe litery
            const first = word[0];
            const last = word[word.length - 1];
            const middle = word.slice(1, -1);

            // Przemieszaj środkowe litery
            const shuffledMiddle = middle.split('').sort(() => Math.random() - 0.5).join('');

            return first + shuffledMiddle + last;
        }).join(' ');
    }

    /**
     * Czyści wygasłe klątwy
     */
    async cleanupExpiredCurses() {
        const now = Date.now();
        let dataChanged = false;
        const expiredCurses = [];

        // Znajdź wygasłe klątwy
        for (const [userId, curse] of this.activeCurses.entries()) {
            if (now > curse.endTime) {
                expiredCurses.push({ userId, curse });
                this.activeCurses.delete(userId);
                dataChanged = true;
            }
        }

        // Przywróć nicki dla wygasłych klątw nicku
        if (expiredCurses.length > 0 && this.client) {
            const guild = this.client.guilds.cache.first();

            for (const { userId, curse } of expiredCurses) {
                if ((curse.type === 'nickname' || curse.type === 'forced_caps') && guild) {
                    try {
                        const restored = await this.nicknameManager.restoreOriginalNickname(userId, guild);
                        if (restored) {
                            logger.info(`✅ [Cleanup] Przywrócono nick po wygasłej klątwie dla userId: ${userId}`);
                        }
                    } catch (error) {
                        logger.error(`❌ Błąd przywracania nicku w cleanup dla ${userId}: ${error.message}`);
                    }
                }
            }
        }

        if (dataChanged) {
            await this.saveActiveCurses();
        }
    }

    /**
     * Wczytuje aktywne klątwy z pliku
     */
    async loadActiveCurses() {
        try {
            const cursesData = await fs.readFile(this.cursesFile, 'utf8');
            const parsedCurses = JSON.parse(cursesData);
            
            // Odtwórz klątwy z pliku, ale tylko te które jeszcze są aktywne
            const now = Date.now();
            for (const [userId, curse] of Object.entries(parsedCurses)) {
                if (curse.endTime > now) {
                    this.activeCurses.set(userId, curse);
                    
                    // Przywróć random ping jeśli był aktywny
                    if (curse.type === 'randomPing') {
                        // Nie możemy przywrócić dokładnego kanału, więc tę klątwę pomijamy
                        this.activeCurses.delete(userId);
                    }
                }
            }
            
            logger.info(`📂 Wczytano ${this.activeCurses.size} aktywnych klątw z pliku`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn(`⚠️ Błąd wczytywania aktywnych klątw: ${error.message}`);
            }
        }
    }

    /**
     * Zapisuje aktywne klątwy do pliku
     */
    async saveActiveCurses() {
        try {
            // Konwertuj Map na obiekt, ale pomijaj random ping (nie da się zapisać kanału)
            const cursesToSave = {};
            for (const [userId, curse] of this.activeCurses.entries()) {
                if (curse.type !== 'randomPing') {
                    cursesToSave[userId] = curse;
                }
            }

            await fs.writeFile(this.cursesFile, JSON.stringify(cursesToSave, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisywania aktywnych klątw: ${error.message}`);
        }
    }

    /**
     * Odtwarza timery dla aktywnych klątw po restarcie bota
     * Kluczowe: Przywraca automatyczne usuwanie klątw i nicków
     */
    async restoreActiveTimers(guild) {
        const now = Date.now();
        let timersRestored = 0;

        for (const [userId, curse] of this.activeCurses.entries()) {
            const timeLeft = curse.endTime - now;

            if (timeLeft <= 0) {
                // Klątwa już wygasła - usuń ją
                this.activeCurses.delete(userId);
                continue;
            }

            // Ustaw timer dla wygaszenia klątwy
            setTimeout(async () => {
                try {
                    // Usuń klątwę z active curses
                    this.activeCurses.delete(userId);
                    await this.saveActiveCurses();

                    // Przywróć nick jeśli to klątwa nicku
                    if (curse.type === 'nickname' || curse.type === 'forced_caps') {
                        const restored = await this.nicknameManager.restoreOriginalNickname(userId, guild);
                        if (restored) {
                            logger.info(`✅ [Timer] Automatycznie przywrócono nick po klątwie dla userId: ${userId}`);
                        }
                    }
                } catch (error) {
                    logger.error(`❌ Błąd automatycznego usuwania klątwy dla ${userId}: ${error.message}`);
                }
            }, timeLeft);

            timersRestored++;
            logger.info(`⏰ Odtworzono timer dla ${userId}: ${Math.ceil(timeLeft / 60000)} min pozostało (typ: ${curse.type})`);
        }

        // Zapisz wyczyszczone klątwy
        if (timersRestored > 0) {
            await this.saveActiveCurses();
        }

        return timersRestored;
    }

    /**
     * Obsługuje przyciski do ustawiania/zmiany hasła
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} buttonType - Typ przycisku ('password_set_new' lub 'password_change')
     */
    async handlePasswordButton(interaction, buttonType) {
        // Sprawdź czy użytkownik ma rolę papieską
        if (!interaction.member.roles.cache.has(this.config.roles.papal)) {
            return await interaction.reply({
                content: '⛪ Tylko papież może ustawiać hasło!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy użytkownik jest na kanale trigger
        if (interaction.channel.id !== this.config.channels.trigger) {
            return await interaction.reply({
                content: '⚠️ Ten przycisk działa tylko na kanale z hasłem!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Utwórz modal z polem do wpisania hasła
        const modal = new ModalBuilder()
            .setCustomId(buttonType === 'password_set_new' ? 'password_set_modal' : 'password_change_modal')
            .setTitle(buttonType === 'password_set_new' ? 'Nadaj nowe hasło' : 'Zmień aktualne hasło');

        const passwordInput = new TextInputBuilder()
            .setCustomId('password_input')
            .setLabel('Wpisz hasło (tylko jedno słowo)')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(50)
            .setRequired(true)
            .setPlaceholder('np. Papież');

        const actionRow = new ActionRowBuilder().addComponents(passwordInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    }

    /**
     * Obsługuje przycisk do dodawania podpowiedzi
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleHintButton(interaction) {
        // Sprawdź czy użytkownik ma rolę papieską
        if (!interaction.member.roles.cache.has(this.config.roles.papal)) {
            return await interaction.reply({
                content: '⛪ Tylko papież może dodawać podpowiedzi!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy użytkownik jest na kanale trigger
        if (interaction.channel.id !== this.config.channels.trigger) {
            return await interaction.reply({
                content: '⚠️ Ten przycisk działa tylko na kanale z hasłem!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy jest aktywne hasło
        if (!this.gameService.trigger || this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
            return await interaction.reply({
                content: '⚠️ Brak aktywnego hasła do którego można dodać podpowiedź!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Utwórz modal z polem do wpisania podpowiedzi
        const modal = new ModalBuilder()
            .setCustomId('hint_add_modal')
            .setTitle('Dodaj podpowiedź do hasła');

        const hintInput = new TextInputBuilder()
            .setCustomId('hint_input')
            .setLabel('Wpisz podpowiedź')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(1)
            .setMaxLength(500)
            .setRequired(true)
            .setPlaceholder('Treść podpowiedzi...');

        const actionRow = new ActionRowBuilder().addComponents(hintInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    }

    /**
     * Obsługuje submity modali
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleModalSubmit(interaction) {
        const modalId = interaction.customId;

        if (modalId === 'password_set_modal' || modalId === 'password_change_modal') {
            await this.handlePasswordModalSubmit(interaction, modalId);
        } else if (modalId === 'hint_add_modal') {
            await this.handleHintModalSubmit(interaction);
        } else if (modalId === 'hint_schedule_modal') {
            await this.handleScheduleHintModalSubmit(interaction);
        } else if (modalId === 'judgment_angel_modal') {
            await this.handleJudgmentAngelModalSubmit(interaction);
        } else if (modalId === 'judgment_demon_modal') {
            await this.handleJudgmentDemonModalSubmit(interaction);
        }
    }

    /**
     * Obsługuje submit modalu ustawiania/zmiany hasła
     * @param {Interaction} interaction - Interakcja Discord
     * @param {string} modalId - ID modalu
     */
    async handlePasswordModalSubmit(interaction, modalId) {
        const newPassword = interaction.fields.getTextInputValue('password_input').trim();

        // Walidacja hasła
        if (newPassword.includes(' ')) {
            return await interaction.reply({
                content: `${this.config.emojis.warning} Hasło nie zostało przyjęte! ${this.config.emojis.warning} Możesz ustawić tylko JEDNOWYRAZOWE hasło.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (newPassword.length === 0) {
            return await interaction.reply({
                content: '⚠️ Hasło nie może być puste!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (this.gameService.trigger && newPassword.toLowerCase() === this.gameService.trigger.toLowerCase()) {
            return await interaction.reply({
                content: '⚠️ To hasło jest już ustawione!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer reply
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Wyczyść wszystkie timery
            this.timerService.clearAllTimers();

            // Ustaw nowe hasło
            this.gameService.setNewPassword(newPassword, interaction.user.id);

            // Wyczyść kanał i zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(true);
            }

            // Wyślij informację na kanał start
            const startChannel = await interaction.client.channels.fetch(this.config.channels.start);
            if (startChannel && startChannel.isTextBased() && interaction.channel.id !== this.config.channels.start) {
                const passwordMessage = this.config.messages.passwordSet.replace(/{emoji}/g, this.config.emojis.warning2);
                await startChannel.send(passwordMessage);
            }

            // Ustaw timery dla przypominania o pierwszej podpowiedzi
            if (this.gameService.trigger.toLowerCase() !== this.config.messages.defaultPassword.toLowerCase()) {
                await this.timerService.setFirstHintReminder();
            }

            await interaction.editReply({
                content: `✅ Nowe hasło zostało ustawione!`
            });

            logger.info(`🔑 ${interaction.user.tag} ustawił nowe hasło: ${newPassword}`);
        } catch (error) {
            logger.error('❌ Błąd podczas ustawiania hasła:', error);
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas ustawiania hasła.'
            });
        }
    }

    /**
     * Obsługuje submit modalu dodawania podpowiedzi
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleHintModalSubmit(interaction) {
        const hintText = interaction.fields.getTextInputValue('hint_input').trim();

        if (hintText.length === 0) {
            return await interaction.reply({
                content: '⚠️ Podpowiedź nie może być pusta!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer reply
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Dodaj podpowiedź
            this.gameService.addHint(hintText);

            // Wyczyść wszystkie timery związane z przypomnieniami o podpowiedziach
            this.timerService.clearHintReminderTimer();
            this.timerService.clearFirstHintReminderTimer();
            this.timerService.clearSecondHintReminderTimer();
            this.timerService.clearPapalRoleRemovalTimer();
            this.timerService.clearRecurringReminderTimer();
            this.timerService.clearHintTimeoutTimer();

            // Ustaw nowy timer dla kolejnej podpowiedzi (6 godzin) i 24h timeout
            await this.timerService.setHintReminderTimer();
            await this.timerService.setHintTimeoutTimer();

            // Zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(false);
                // Wyślij podpowiedź na kanał command
                await this.passwordEmbedService.sendHintToCommandChannel(hintText, interaction.member.displayName);
            }

            await interaction.editReply({
                content: `✅ Podpowiedź została dodana i wysłana na kanał!`
            });

            logger.info(`💡 ${interaction.user.tag} dodał podpowiedź: ${hintText}`);
        } catch (error) {
            logger.error('❌ Błąd podczas dodawania podpowiedzi:', error);
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas dodawania podpowiedzi.'
            });
        }
    }

    /**
     * Aplikuje klątwę na nick przy użyciu centralnego systemu zarządzania nickami
     */
    async applyNicknameCurse(targetMember, interaction, durationMinutes) {
        const userId = targetMember.user.id; // POPRAWKA: używaj user.id jak w innych botach
        const durationMs = durationMinutes * 60 * 1000;

        try {
            logger.info(`🎯 Rozpoczynam aplikację klątwy na nick dla ${targetMember.user.tag} (${userId})`);
            
            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.CURSE,
                targetMember,
                durationMs
            );
            logger.info(`💾 Zapisano oryginalny nick w systemie`);

            // Sprawdź czy to Lucyfer (zawsze "Osłabiony" dla Lucyfera)
            const hasLucyferRole = targetMember.roles.cache.has(this.config.roles.lucyfer);

            let cursePrefix = this.config.virtuttiPapajlari.forcedNickname; // Domyślnie "Przeklęty"

            // Jeśli to Lucyfer, ZAWSZE użyj "Osłabiony"
            if (hasLucyferRole) {
                cursePrefix = 'Osłabiony';
                logger.info(`🔥 Wykryto Lucyfera - użyję prefixu "Osłabiony"`);
            }

            // KRYTYCZNE: Użyj czystego nicku (bez istniejących prefixów)
            const cleanNick = this.nicknameManager.getCleanNickname(targetMember.displayName);
            const cursedNickname = `${cursePrefix} ${cleanNick}`;
            
            logger.info(`🔄 Zmieniam nick z "${targetMember.displayName}" na "${cursedNickname}"`);

            await targetMember.setNickname(cursedNickname);
            logger.info(`😈 ✅ Aplikowano klątwę na nick ${targetMember.user.tag}: "${cursedNickname}"`);

            // Timer do automatycznego przywrócenia
            setTimeout(async () => {
                try {
                    const restored = await this.nicknameManager.restoreOriginalNickname(userId, interaction.guild);
                    if (restored) {
                        logger.info(`✅ Automatycznie przywrócono nick po klątwie dla ${targetMember.user.tag}`);
                    }
                } catch (error) {
                    logger.error(`❌ Błąd automatycznego przywracania nicku: ${error.message}`);
                }
            }, durationMs);

        } catch (error) {
            // Rzuć błąd dalej - zostanie obsłużony w funkcji wywołującej
            throw error;
        }
    }

    /**
     * Obsługuje przycisk "Zaplanuj podpowiedź"
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleScheduleHintButton(interaction) {
        // Sprawdź czy użytkownik ma rolę papieską
        if (!interaction.member.roles.cache.has(this.config.roles.papal)) {
            return await interaction.reply({
                content: '⛪ Tylko papież może planować podpowiedzi!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy użytkownik jest na kanale trigger
        if (interaction.channel.id !== this.config.channels.trigger) {
            return await interaction.reply({
                content: '⚠️ Ten przycisk działa tylko na kanale z hasłem!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy jest aktywne hasło
        if (!this.gameService.trigger || this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
            return await interaction.reply({
                content: '⚠️ Brak aktywnego hasła do którego można dodać podpowiedź!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź limit zaplanowanych
        if (this.scheduledHintsService) {
            const activeScheduled = this.scheduledHintsService.getActiveScheduledHints();
            if (activeScheduled.length >= 10) {
                return await interaction.reply({
                    content: '⚠️ Osiągnięto limit 10 zaplanowanych podpowiedzi!',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Utwórz modal z polami: data, czas, treść
        const modal = new ModalBuilder()
            .setCustomId('hint_schedule_modal')
            .setTitle('Zaplanuj podpowiedź');

        const dateInput = new TextInputBuilder()
            .setCustomId('schedule_date')
            .setLabel('Data ujawnienia (DD.MM.RRRR)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. 25.11.2025')
            .setMinLength(10)
            .setMaxLength(10)
            .setRequired(true);

        const timeInput = new TextInputBuilder()
            .setCustomId('schedule_time')
            .setLabel('Godzina ujawnienia (HH:MM)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. 18:00')
            .setMinLength(5)
            .setMaxLength(5)
            .setRequired(true);

        const hintInput = new TextInputBuilder()
            .setCustomId('hint_text')
            .setLabel('Treść podpowiedzi')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Treść podpowiedzi...')
            .setMinLength(1)
            .setMaxLength(500)
            .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(dateInput);
        const row2 = new ActionRowBuilder().addComponents(timeInput);
        const row3 = new ActionRowBuilder().addComponents(hintInput);

        modal.addComponents(row1, row2, row3);

        await interaction.showModal(modal);
    }

    /**
     * Obsługuje submit modalu planowania podpowiedzi
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleScheduleHintModalSubmit(interaction) {
        const dateString = interaction.fields.getTextInputValue('schedule_date').trim();
        const timeString = interaction.fields.getTextInputValue('schedule_time').trim();
        const hintText = interaction.fields.getTextInputValue('hint_text').trim();

        if (!this.scheduledHintsService) {
            return await interaction.reply({
                content: '❌ Serwis planowania podpowiedzi nie jest dostępny!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer reply
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Parsuj datę i czas
            const scheduledDate = this.scheduledHintsService.parseDateTime(dateString, timeString);

            if (!scheduledDate) {
                return await interaction.editReply({
                    content: `❌ Nieprawidłowy format daty lub czasu!\n\nUżyj formatu:\n• Data: **DD.MM.RRRR** (np. 25.11.2025)\n• Czas: **HH:MM** (np. 18:00)`
                });
            }

            // Zaplanuj podpowiedź
            const result = await this.scheduledHintsService.scheduleHint(
                hintText,
                scheduledDate,
                interaction.user.id,
                interaction.member.displayName
            );

            if (!result.success) {
                return await interaction.editReply({
                    content: `❌ ${result.error}`
                });
            }

            // Zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(false);
            }

            const timestamp = Math.floor(scheduledDate.getTime() / 1000);
            await interaction.editReply({
                content: `✅ Podpowiedź została zaplanowana!\n\n📅 Ujawnienie: <t:${timestamp}:F> (<t:${timestamp}:R>)\n💡 Treść: "${hintText}"`
            });

            logger.info(`📅 ${interaction.user.tag} zaplanował podpowiedź na ${scheduledDate.toISOString()}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas planowania podpowiedzi: ${error.message}`);
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas planowania podpowiedzi.'
            });
        }
    }

    /**
     * Obsługuje przycisk "Usuń zaplanowane"
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleRemoveScheduledButton(interaction) {
        // Sprawdź czy użytkownik ma rolę papieską
        if (!interaction.member.roles.cache.has(this.config.roles.papal)) {
            return await interaction.reply({
                content: '⛪ Tylko papież może usuwać zaplanowane podpowiedzi!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Sprawdź czy użytkownik jest na kanale trigger
        if (interaction.channel.id !== this.config.channels.trigger) {
            return await interaction.reply({
                content: '⚠️ Ten przycisk działa tylko na kanale z hasłem!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!this.scheduledHintsService) {
            return await interaction.reply({
                content: '❌ Serwis planowania podpowiedzi nie jest dostępny!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Pobierz zaplanowane podpowiedzi
        const scheduledHints = this.scheduledHintsService.getActiveScheduledHints();

        if (scheduledHints.length === 0) {
            return await interaction.reply({
                content: '⚠️ Brak zaplanowanych podpowiedzi do usunięcia!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Utwórz select menu
        const options = scheduledHints.map((hint, index) => {
            const date = new Date(hint.scheduledFor);
            const dateStr = date.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
            const hintPreview = hint.hint.substring(0, 50) + (hint.hint.length > 50 ? '...' : '');

            return {
                label: `${index + 1}. ${dateStr}`,
                description: hintPreview,
                value: hint.id
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_scheduled_select')
            .setPlaceholder('Wybierz podpowiedź do usunięcia')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '🗑️ **Wybierz zaplanowaną podpowiedź do usunięcia:**',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    /**
     * Obsługuje wybór z select menu usuwania zaplanowanych
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleRemoveScheduledSelect(interaction) {
        const hintId = interaction.values[0];

        if (!this.scheduledHintsService) {
            return await interaction.reply({
                content: '❌ Serwis planowania podpowiedzi nie jest dostępny!',
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer update
        await interaction.deferUpdate();

        try {
            const removed = await this.scheduledHintsService.removeScheduledHint(hintId);

            if (!removed) {
                return await interaction.followUp({
                    content: '❌ Nie znaleziono podpowiedzi do usunięcia!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(false);
            }

            await interaction.editReply({
                content: '✅ Zaplanowana podpowiedź została usunięta!',
                components: []
            });

            logger.info(`🗑️ ${interaction.user.tag} usunął zaplanowaną podpowiedź ${hintId}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania zaplanowanej podpowiedzi: ${error.message}`);
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas usuwania podpowiedzi.',
                components: []
            });
        }
    }

    /**
     * Aplikuje klątwę bezpośrednio na członka (dla Gabriel blessing → Lucyfer)
     * @param {GuildMember} targetMember - Cel klątwy
     * @param {string} curseType - Typ klątwy
     * @param {Guild} guild - Guild
     * @param {number} customEndTime - Opcjonalny custom timestamp końca klątwy
     */
    async applyCurse(targetMember, curseType, guild, customEndTime = null) {
        const userId = targetMember.id;
        const now = Date.now();
        const endTime = customEndTime || (now + (5 * 60 * 1000)); // 5 minut defaultowo

        try {
            // 1. Aplikuj nickname curse (Przeklęty prefix)
            try {
                // Sprawdź czy to Lucyfer (zawsze "Osłabiony" dla Lucyfera)
                const hasLucyferRole = targetMember.roles.cache.has(this.config.roles.lucyfer);

                let forcedPrefix = this.config.virtuttiPapajlari.forcedNickname || 'Przeklęty';

                // Jeśli to Lucyfer, ZAWSZE użyj "Osłabiony"
                if (hasLucyferRole) {
                    forcedPrefix = 'Osłabiony';
                }

                // KRYTYCZNE: Użyj czystego nicku (bez istniejących prefixów)
                const cleanNick = this.nicknameManager.getCleanNickname(targetMember.displayName);
                const newNick = `${forcedPrefix} ${cleanNick}`.substring(0, 32);

                // Zapisz oryginalny nick w nickname managerze
                const effectData = await this.nicknameManager.saveOriginalNickname(
                    userId,
                    'CURSE',
                    targetMember,
                    endTime - now
                );

                // Zmień nick ręcznie
                await targetMember.setNickname(newNick);
                logger.info(`😈 Aplikowano klątwę na nick ${targetMember.user.tag}: "${newNick}"`);

                // Zapisz do activeCurses
                this.activeCurses.set(userId, {
                    type: 'nickname',
                    data: { effectId: userId }, // effectId to userId
                    endTime
                });
            } catch (error) {
                logger.warn(`⚠️ Nie udało się aplikować klątwy na nick: ${error.message}`);
            }

            // 2. Wykonaj dodatkową klątwę na podstawie typu
            switch (curseType) {
                case 'slow_mode':
                    this.activeCurses.set(userId, {
                        type: 'slowMode',
                        data: { lastMessage: 0 },
                        endTime
                    });
                    break;

                case 'auto_delete':
                    this.activeCurses.set(userId, {
                        type: 'autoDelete',
                        data: { chance: 3.33 },
                        endTime
                    });
                    break;

                case 'random_ping':
                    this.activeCurses.set(userId, {
                        type: 'randomPing',
                        data: { channel: null }, // channel nie jest dostępny
                        endTime
                    });
                    // startRandomPing wymaga kanału, pominięte
                    break;

                case 'emoji_spam':
                    this.activeCurses.set(userId, {
                        type: 'emojiSpam',
                        data: { chance: 3.33 },
                        endTime
                    });
                    break;

                case 'forced_caps':
                    this.activeCurses.set(userId, {
                        type: 'forcedCaps',
                        data: { chance: 100 },
                        endTime
                    });
                    break;

                case 'random_timeout':
                    this.activeCurses.set(userId, {
                        type: 'randomTimeout',
                        data: { isTimedOut: false },
                        endTime
                    });
                    this.startRandomTimeout(userId, targetMember);
                    break;

                case 'special_role':
                    try {
                        const specialRole = guild.roles.cache.get(this.config.virtuttiPapajlari.specialRoleId);
                        if (specialRole) {
                            await targetMember.roles.add(specialRole);
                            logger.info(`🎭 Nadano specjalną rolę ${targetMember.user.tag} (klątwa Gabriel)`);

                            // Usuń rolę po zakończeniu klątwy
                            const duration = endTime - now;
                            setTimeout(async () => {
                                try {
                                    const memberToUpdate = await guild.members.fetch(targetMember.id);
                                    if (memberToUpdate && memberToUpdate.roles.cache.has(this.config.virtuttiPapajlari.specialRoleId)) {
                                        await memberToUpdate.roles.remove(specialRole);
                                        logger.info(`🎭 Usunięto specjalną rolę ${targetMember.user.tag} (koniec klątwy Gabriel)`);
                                    }
                                } catch (error) {
                                    logger.error(`❌ Błąd usuwania specjalnej roli: ${error.message}`);
                                }
                            }, duration);
                        }
                    } catch (error) {
                        logger.error(`❌ Błąd nakładania specjalnej roli: ${error.message}`);
                    }
                    break;
            }

            await this.saveActiveCurses();
            logger.info(`⚡ Nałożono klątwę typu ${curseType} na ${targetMember.user.tag} (Gabriel power)`);

        } catch (error) {
            logger.error(`❌ Błąd aplikowania klątwy: ${error.message}`);
        }
    }

    /**
     * Obsługuje submit modalu wyboru anioła
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleJudgmentAngelModalSubmit(interaction) {
        try {
            const searchQuery = interaction.fields.getTextInputValue('user_input').trim().toLowerCase();

            // Pobierz wszystkich członków serwera
            await interaction.guild.members.fetch();

            // Wyszukaj użytkowników pasujących do zapytania
            const matchingMembers = interaction.guild.members.cache.filter(member => {
                const displayName = member.displayName.toLowerCase();
                const username = member.user.username.toLowerCase();

                // Nie pokazuj botów ani użytkownika wywołującego
                if (member.user.bot || member.id === interaction.user.id) {
                    return false;
                }

                // Szukaj w display name i username
                return displayName.includes(searchQuery) || username.includes(searchQuery);
            });

            // Ogranicz do 25 wyników (limit Discord)
            const limitedMembers = Array.from(matchingMembers.values()).slice(0, 25);

            if (limitedMembers.length === 0) {
                return await interaction.reply({
                    content: `❌ Nie znaleziono użytkowników pasujących do: **${searchQuery}**\n\nSpróbuj wpisać inne litery.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Utwórz select menu z wynikami
            const { StringSelectMenuBuilder } = require('discord.js');
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`judgment_angel_user_select_${interaction.user.id}`)
                .setPlaceholder('Wybierz użytkownika')
                .addOptions(
                    limitedMembers.map(member => ({
                        label: member.displayName.substring(0, 100),
                        description: `@${member.user.username}`.substring(0, 100),
                        value: member.id
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: `🔍 **Znaleziono ${limitedMembers.length} użytkowników:**\n\n☁️ Wybrałeś ścieżkę aniołów - otrzymasz rolę **Gabriel**.\n🔥 Wybierz osobę która otrzyma rolę **Lucyfer** (przeciwna frakcja).`,
                components: [row],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru anioła z modalu: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }

    /**
     * Obsługuje submit modalu wyboru demona
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleJudgmentDemonModalSubmit(interaction) {
        try {
            const searchQuery = interaction.fields.getTextInputValue('user_input').trim().toLowerCase();

            // Pobierz wszystkich członków serwera
            await interaction.guild.members.fetch();

            // Wyszukaj użytkowników pasujących do zapytania
            const matchingMembers = interaction.guild.members.cache.filter(member => {
                const displayName = member.displayName.toLowerCase();
                const username = member.user.username.toLowerCase();

                // Nie pokazuj botów ani użytkownika wywołującego
                if (member.user.bot || member.id === interaction.user.id) {
                    return false;
                }

                // Szukaj w display name i username
                return displayName.includes(searchQuery) || username.includes(searchQuery);
            });

            // Ogranicz do 25 wyników (limit Discord)
            const limitedMembers = Array.from(matchingMembers.values()).slice(0, 25);

            if (limitedMembers.length === 0) {
                return await interaction.reply({
                    content: `❌ Nie znaleziono użytkowników pasujących do: **${searchQuery}**\n\nSpróbuj wpisać inne litery.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Utwórz select menu z wynikami
            const { StringSelectMenuBuilder } = require('discord.js');
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`judgment_demon_user_select_${interaction.user.id}`)
                .setPlaceholder('Wybierz użytkownika')
                .addOptions(
                    limitedMembers.map(member => ({
                        label: member.displayName.substring(0, 100),
                        description: `@${member.user.username}`.substring(0, 100),
                        value: member.id
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: `🔍 **Znaleziono ${limitedMembers.length} użytkowników:**\n\n🔥 Wybrałeś ścieżkę demonów - otrzymasz rolę **Lucyfer**.\n☁️ Wybierz osobę która otrzyma rolę **Gabriel** (przeciwna frakcja).`,
                components: [row],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru demona z modalu: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }

}

module.exports = InteractionHandler;