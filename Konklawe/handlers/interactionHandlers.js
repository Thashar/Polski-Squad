const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const NicknameManager = require('../../utils/nicknameManagerService');
const VirtuttiService = require('../services/virtuttiService');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Konklawe');
class InteractionHandler {
    constructor(config, gameService, rankingService, timerService, nicknameManager) {
        this.config = config;
        this.gameService = gameService;
        this.rankingService = rankingService;
        this.timerService = timerService;
        this.nicknameManager = nicknameManager;
        this.virtuttiService = new VirtuttiService(config);
        this.activeCurses = new Map(); // userId -> { type: string, data: any, endTime: timestamp }
        
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
        this.timerService.clearHintTimeoutTimer();

        // Ustaw nowy timer dla kolejnej podpowiedzi (6 godzin) i 24h timeout
        await this.timerService.setHintReminderTimer();
        await this.timerService.setHintTimeoutTimer();

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
     * Obsługuje komendy specjalne dla Virtutti Papajlari
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleVirtuttiPapajlariCommand(interaction) {
        // Sprawdź czy użytkownik ma rolę Virtutti Papajlari
        if (!interaction.member.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
            return await interaction.reply({
                content: '⛪ Ta komenda jest dostępna tylko dla posiadaczy medalu Virtutti Papajlari!',
                ephemeral: true
            });
        }

        const { commandName } = interaction;
        
        if (commandName === 'blessing') {
            await this.handleBlessingCommand(interaction);
        } else if (commandName === 'virtue-check') {
            await this.handleVirtueCheckCommand(interaction);
        } else if (commandName === 'curse') {
            await this.handleCurseCommand(interaction);
        }
    }

    /**
     * Obsługuje komendę /blessing
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleBlessingCommand(interaction) {
        const targetUser = interaction.options.getUser('użytkownik');
        const userId = interaction.user.id;
        
        // Sprawdź cooldown i limity
        const canUse = this.virtuttiService.canUseCommand(userId, 'blessing');
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                ephemeral: true
            });
        }

        // Zarejestruj użycie
        this.virtuttiService.registerUsage(userId, 'blessing', interaction.user.tag);

        // Pobierz losowe błogosławieństwo
        const blessing = this.virtuttiService.getRandomBlessing();
        
        // Dodaj reakcje do oryginalnej wiadomości (jeśli to możliwe)
        const blessingReactions = ['🙏', '✨', '👑', '💫', '🕊️', '⭐', '🌟'];
        const randomReaction = blessingReactions[Math.floor(Math.random() * blessingReactions.length)];

        try {
            // Wyślij błogosławieństwo
            await interaction.reply({
                content: `**${targetUser.toString()} otrzymałeś błogosławieństwo!**\n\n${randomReaction} ${blessing}`,
                ephemeral: false
            });

            logger.info(`🙏 ${interaction.user.tag} błogosławi ${targetUser.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania błogosławieństwa: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas udzielania błogosławieństwa.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje komendę /virtue-check
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleVirtueCheckCommand(interaction) {
        const targetUser = interaction.options.getUser('użytkownik');
        const userId = interaction.user.id;
        
        // Sprawdź cooldown i limity
        const canUse = this.virtuttiService.canUseCommand(userId, 'virtueCheck');
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                ephemeral: true
            });
        }

        // Zarejestruj użycie
        this.virtuttiService.registerUsage(userId, 'virtueCheck', interaction.user.tag);

        // Pobierz losowe cnoty i radę
        const virtues = this.virtuttiService.getRandomVirtues();
        const advice = this.virtuttiService.getRandomPapalAdvice();
        
        // Stwórz embed z wynikami
        const embed = new EmbedBuilder()
            .setTitle(`🔍 **Sprawdzenie cnót dla ${targetUser.displayName}**`)
            .setColor('#FFD700')
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp()
            .setFooter({ 
                text: `Sprawdził: ${interaction.user.displayName} | Cooldown: ${this.config.virtuttiPapajlari.cooldownMinutes} min`,
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
            logger.info(`🔍 ${interaction.user.tag} sprawdza cnoty ${targetUser.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas sprawdzania cnót: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas sprawdzania cnót.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje komendę /curse
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleCurseCommand(interaction) {
        const targetUser = interaction.options.getUser('użytkownik');
        const userId = interaction.user.id;
        
        // Sprawdź cooldown i limity (używamy tego samego systemu co blessing)
        const canUse = this.virtuttiService.canUseCommand(userId, 'curse');
        if (!canUse.canUse) {
            return await interaction.reply({
                content: `⏰ ${canUse.reason}`,
                ephemeral: true
            });
        }

        // Nie można rzucić klątwy na siebie
        if (targetUser.id === interaction.user.id) {
            return await interaction.reply({
                content: '💀 Nie możesz rzucić klątwy na samego siebie!',
                ephemeral: true
            });
        }

        // Sprawdź czy cel ma uprawnienia administratora - odbij klątwę!
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const hasAdminPermissions = targetMember.permissions.has('Administrator');

        let actualTarget = targetUser;
        let actualTargetMember = targetMember;
        let isReflected = false;

        if (hasAdminPermissions) {
            // Klątwa zostaje odbita na osobę rzucającą!
            actualTarget = interaction.user;
            actualTargetMember = await interaction.guild.members.fetch(interaction.user.id);
            isReflected = true;
            logger.info(`🛡️ Klątwa odbita! ${targetUser.tag} (administrator) odbija klątwę na ${interaction.user.tag}`);
        }

        // Zarejestruj użycie
        this.virtuttiService.registerUsage(userId, 'curse', interaction.user.tag);

        // Pobierz losową klątwę
        const curse = this.virtuttiService.getRandomCurse();

        try {
            // POPRAWKA: Najpierw defer, żeby zabezpieczyć interakcję
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ ephemeral: false });
            }

            let nicknameError = null;

            // Aplikuj klątwę na nick przy użyciu centralnego systemu
            try {
                await this.applyNicknameCurse(actualTargetMember, interaction, curse.duration);
                logger.info(`😈 Aplikowano klątwę na nick ${actualTarget.tag}: "${this.config.virtuttiPapajlari.forcedNickname} ${actualTargetMember.displayName}"`);
            } catch (error) {
                // Jeśli klątwa na nick nie może być aplikowana, kontynuuj z pozostałymi efektami
                logger.warn(`⚠️ Nie udało się aplikować klątwy na nick: ${error.message}`);
                nicknameError = error.message;
            }

            // Wyślij klątwę
            const curseReactions = ['💀', '⚡', '🔥', '💜', '🌙', '👹', '🔮'];
            const randomReaction = curseReactions[Math.floor(Math.random() * curseReactions.length)];

            // Wykonaj dodatkową klątwę
            await this.executeCurse(interaction, actualTargetMember, curse.additional);

            // POPRAWKA: Użyj editReply zamiast reply po defer
            let responseContent;
            if (isReflected) {
                // Komunikat o odbiciu klątwy
                responseContent = `🛡️ **O nie! ${targetUser.toString()} jest zbyt potężny i odbija klątwę!**\n\n` +
                    `💀 **${actualTarget.toString()} zostałeś przeklęty własną klątwą!** ${randomReaction}`;
            } else {
                responseContent = `💀 **${actualTarget.toString()} zostałeś przeklęty!** ${randomReaction}`;
            }

            if (nicknameError) {
                responseContent += `\n\n⚠️ *Uwaga: ${nicknameError}*`;
            }

            await interaction.editReply({
                content: responseContent
            });

            // Wyślij ephemeral message z informacją o pozostałych użyciach
            const dailyUsage = this.virtuttiService.dailyUsage.get(userId);
            const remainingUses = this.config.virtuttiPapajlari.dailyLimit - (dailyUsage?.curse || 0);

            await interaction.followUp({
                content: `📊 Pozostałe klątwy dzisiaj: **${remainingUses}/${this.config.virtuttiPapajlari.dailyLimit}**`,
                ephemeral: true
            });

            logger.info(`💀 ${interaction.user.tag} przeklął ${actualTarget.tag}${isReflected ? ' (odbita klątwa)' : ''}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas rzucania klątwy: ${error.message}`);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas rzucania klątwy.',
                    ephemeral: true
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas rzucania klątwy.'
                });
            }
        }
    }

    /**
     * Wykonuje konkretną klątwę
     * @param {Interaction} interaction - Interakcja Discord
     * @param {GuildMember} targetMember - Docelowy członek serwera
     * @param {string} curseDescription - Opis klątwy
     */
    async executeCurse(interaction, targetMember, curseDescription) {
        const userId = targetMember.id;
        const now = Date.now();
        
        if (curseDescription.includes('Slow mode personal')) {
            // Slow mode - 30 sekund między wiadomościami przez 5 minut
            this.activeCurses.set(userId, {
                type: 'slowMode',
                data: { lastMessage: 0 },
                endTime: now + (5 * 60 * 1000)
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Auto-delete')) {
            // Auto-delete przez 5 minut z szansą 30%
            this.activeCurses.set(userId, {
                type: 'autoDelete',
                data: { chance: 3.33 }, // 1/3.33 szansa (30%)
                endTime: now + (5 * 60 * 1000) // 5 minut
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Random ping')) {
            // Random ping przez 5 minut
            this.activeCurses.set(userId, {
                type: 'randomPing',
                data: { channel: interaction.channel },
                endTime: now + (5 * 60 * 1000)
            });
            this.startRandomPing(userId, interaction.channel);
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Emoji spam')) {
            // Emoji spam przez 5 minut z szansą 30%
            this.activeCurses.set(userId, {
                type: 'emojiSpam',
                data: { chance: 3.33 }, // 1/3.33 szansa (30%)
                endTime: now + (5 * 60 * 1000) // 5 minut
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Forced caps')) {
            // Forced caps przez 5 minut z szansą 100%
            this.activeCurses.set(userId, {
                type: 'forcedCaps',
                data: { chance: 100 },
                endTime: now + (5 * 60 * 1000)
            });
            this.saveActiveCurses();
            
        } else if (curseDescription.includes('Random timeout')) {
            // Random timeout przez 5 minut
            this.activeCurses.set(userId, {
                type: 'randomTimeout',
                data: { isTimedOut: false },
                endTime: now + (5 * 60 * 1000)
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
                    
                    // Usuń rolę po 5 minutach
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
                    }, 5 * 60 * 1000);
                } else {
                    logger.warn(`⚠️ Nie znaleziono specjalnej roli o ID: ${this.config.virtuttiPapajlari.specialRoleId}`);
                }
            } catch (error) {
                logger.error(`❌ Błąd nakładania specjalnej roli: ${error.message}`);
            }

        } else if (curseDescription.includes('Scrambled words')) {
            // Scrambled words przez 5 minut z szansą 30%
            this.activeCurses.set(userId, {
                type: 'scrambledWords',
                data: { chance: 30 },
                endTime: now + (5 * 60 * 1000)
            });
            this.saveActiveCurses();

        } else if (curseDescription.includes('Don\'t be smart')) {
            // Don't be smart przez 5 minut z szansą 30%
            this.activeCurses.set(userId, {
                type: 'dontBeSmart',
                data: { chance: 30 },
                endTime: now + (5 * 60 * 1000)
            });
            this.saveActiveCurses();

        } else if (curseDescription.includes('Blah blah')) {
            // Blah blah przez 5 minut z szansą 30%
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
                endTime: now + (5 * 60 * 1000)
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
    cleanupExpiredCurses() {
        const now = Date.now();
        let dataChanged = false;
        
        for (const [userId, curse] of this.activeCurses.entries()) {
            if (now > curse.endTime) {
                this.activeCurses.delete(userId);
                dataChanged = true;
            }
        }
        
        if (dataChanged) {
            this.saveActiveCurses();
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
     * Aplikuje klątwę na nick przy użyciu centralnego systemu zarządzania nickami
     */
    async applyNicknameCurse(targetMember, interaction, durationMinutes) {
        const userId = targetMember.user.id; // POPRAWKA: używaj user.id jak w innych botach
        const durationMs = durationMinutes * 60 * 1000;
        
        try {
            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.CURSE,
                targetMember,
                durationMs
            );
            
            // Aplikuj klątwę
            const originalDisplayName = targetMember.displayName;
            const cursedNickname = `${this.config.virtuttiPapajlari.forcedNickname} ${originalDisplayName}`;
            
            await targetMember.setNickname(cursedNickname);
            logger.info(`😈 Aplikowano klątwę na nick ${targetMember.user.tag}: "${cursedNickname}"`);
            
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

}

module.exports = InteractionHandler;