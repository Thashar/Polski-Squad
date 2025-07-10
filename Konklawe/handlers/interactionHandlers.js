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
                console.error('❌ Błąd podczas aktualizacji strony wyników:', error);
                if (!interaction.replied) {
                    await interaction.reply({
                        content: 'Wystąpił błąd podczas ładowania strony.',
                        ephemeral: true
                    });
                }
            }
        }
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
            } else if (commandName === 'wyniki') {
                await this.handleResultsCommand(interaction);
            } else if (commandName === 'medale') {
                await this.handleMedalsCommand(interaction);
            }

        } catch (error) {
            console.error('❌ Błąd w obsłudze slash command:', error);
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
                console.error('❌ Nie udało się odpowiedzieć na interakcję:', replyError);
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
            const message = this.config.messages.hintAdded.replace(/{emoji}/g, this.config.emojis.warning);
            await interaction.reply(message);
            setTimeout(async () => {
                try {
                    await interaction.editReply(`${message}\nDodana podpowiedź: ${hintText}`);
                } catch (err) {
                    console.error('❌ Błąd podczas edycji odpowiedzi:', err);
                }
            }, 100);
        }
    }

    /**
     * Obsługuje komendę /podpowiedzi
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleHintsCommand(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            if (this.gameService.hints.length === 0) {
                await interaction.reply('Brak aktualnych podpowiedzi.');
            } else {
                const hintsList = this.gameService.hints.map((h, i) => `${i + 1}. ${h}`).join('\n');
                await interaction.reply(`## 📌 **Podpowiedzi:** 📌\n${hintsList}`);
            }
        }
    }

    /**
     * Obsługuje komendę /wyniki
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleResultsCommand(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ ephemeral: true });
        }

        try {
            const resultsData = await this.rankingService.createResultsPage(interaction, 0);
            await interaction.editReply(resultsData);
        } catch (error) {
            console.error('❌ Błąd w komendzie wyniki:', error);
            try {
                await interaction.editReply('Wystąpił błąd podczas pobierania wyników.');
            } catch (editError) {
                console.error('❌ Błąd podczas edycji odpowiedzi:', editError);
            }
        }
    }

    /**
     * Obsługuje komendę /medale
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleMedalsCommand(interaction) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.deferReply({ ephemeral: true });
        }

        try {
            const medalsData = await this.rankingService.createMedalsPage(interaction, 0);
            await interaction.editReply(medalsData);
        } catch (error) {
            console.error('❌ Błąd w komendzie medale:', error);
            try {
                await interaction.editReply('Wystąpił błąd podczas pobierania medali.');
            } catch (editError) {
                console.error('❌ Błąd podczas edycji odpowiedzi:', editError);
            }
        }
    }
}

module.exports = InteractionHandler;