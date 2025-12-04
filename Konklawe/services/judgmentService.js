const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

class JudgmentService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.judgmentMessage = null;
        this.judgmentMessageId = null;
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Inicjalizuje embed Sądu Bożego
     */
    async initializeJudgmentEmbed() {
        if (!this.client) {
            logger.error('❌ Klient Discord nie został ustawiony dla JudgmentService');
            return;
        }

        if (!this.config.channels.judgment) {
            logger.warn('⚠️ Kanał Sądu Bożego nie jest skonfigurowany w ENV');
            return;
        }

        try {
            const judgmentChannel = await this.client.channels.fetch(this.config.channels.judgment);

            if (!judgmentChannel || !judgmentChannel.isTextBased()) {
                logger.error('❌ Kanał Sądu Bożego nie jest kanałem tekstowym');
                return;
            }

            // Sprawdź czy embed już istnieje - jeśli tak, usuń go i stwórz nowy
            const messages = await judgmentChannel.messages.fetch({ limit: 10 });
            const existingEmbed = messages.find(msg =>
                msg.author.id === this.client.user.id &&
                msg.embeds.length > 0 &&
                msg.embeds[0].title === '⚖️ SĄD BOŻY'
            );

            if (existingEmbed) {
                try {
                    await existingEmbed.delete();
                    logger.info('🗑️ Usunięto stary embed Sądu Bożego');
                } catch (error) {
                    logger.warn(`⚠️ Nie udało się usunąć starego embeda: ${error.message}`);
                }
            }

            // Utwórz nowy embed
            const embed = new EmbedBuilder()
                .setTitle('⚖️ SĄD BOŻY')
                .setDescription(
                    '**Papież właśnie stoi przed Sądem Bożym i musi wybrać czy chce należeć do aniołów czy demonów.**\n\n' +
                    '**Każda frakcja posiada unikalne moce i ograniczenia.**\n' +
                    '**Wybierz swoją ścieżkę mądrze...**'
                )
                .setColor('#FFD700')
                .addFields(
                    {
                        name: '☁️ **GABRIEL - Święty Anioł**',
                        value:
                            '**Moce:**\n' +
                            '• 🙏 Nieograniczone błogosławieństwa `/blessing`\n' +
                            '• ✨ 50% szans na usunięcie klątwy przy błogosławieństwie\n' +
                            '• 💀 Klątwy `/curse` (20% szans na niepowodzenie, 1% na odbicie na siebie)\n' +
                            '• 🔍 Sprawdzanie cnót `/virtue-check`\n' +
                            '• ⚡ Specjalna moc: 1% szansa przy błogosławieństwie na nałożenie klątwy na Lucyfera\n' +
                            '• 🛡️ Odporność na klątwy Lucyfera\n\n' +
                            '**Ścieżka łaski i światła.**',
                        inline: false
                    },
                    {
                        name: '🔥 **LUCYFER - Upadły Anioł**',
                        value:
                            '**Moce:**\n' +
                            '• 💀 Nieograniczone klątwy `/curse` (5 min cooldown per cel)\n' +
                            '• 🔍 Sprawdzanie cnót `/virtue-check`\n' +
                            '• 📈 Progresywne odbicie: 0% → +1% za każdą klątwę dziennie (reset o północy)\n' +
                            '• ⚠️ Przy odbiciu: 1h kara + losowa klątwa co 5 min + blokada `/curse`\n' +
                            '• 🛡️ Odporność na klątwy i błogosławieństwa Gabriela\n\n' +
                            '**Ograniczenia:**\n' +
                            '• ⛔ BRAK błogosławieństw\n\n' +
                            '**Ścieżka potęgi i ciemności.**',
                        inline: false
                    }
                )
                .setFooter({ text: 'Konklawe - Sąd Boży' })
                .setTimestamp();

            const angelButton = new ButtonBuilder()
                .setCustomId('judgment_angel')
                .setLabel('Aniołowie')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('☁️');

            const demonButton = new ButtonBuilder()
                .setCustomId('judgment_demon')
                .setLabel('Demony')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔥');

            const row = new ActionRowBuilder().addComponents(angelButton, demonButton);

            this.judgmentMessage = await judgmentChannel.send({
                embeds: [embed],
                components: [row]
            });

            this.judgmentMessageId = this.judgmentMessage.id;
            logger.info('✅ Utworzono embed Sądu Bożego');

        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji embeda Sądu Bożego: ${error.message}`);
        }
    }

    /**
     * Obsługuje wybór anioła (przycisk niebieski)
     * @param {Interaction} interaction - Interakcja Discord
     * @param {Member} member - Członek serwera
     */
    async handleAngelChoice(interaction, member) {
        try {
            // Sprawdź czy użytkownik ma rolę Virtutti Papajlari
            if (!member.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                return await interaction.reply({
                    content: '⛪ Tylko posiadacze medalu Virtutti Papajlari mogą stanąć przed Sądem Bożym!',
                    ephemeral: true
                });
            }

            // Pokaż user select do wyboru osoby która dostanie rolę Lucyfer
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('judgment_angel_select')
                .setPlaceholder('Wybierz osobę która otrzyma rolę Lucyfer')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(userSelect);

            await interaction.reply({
                content:
                    '☁️ **Wybrałeś ścieżkę aniołów - otrzymasz rolę Gabriel!**\n\n' +
                    '⚖️ **Jednak równowaga wymaga ofiary...**\n\n' +
                    '🔥 **Wybierz jedną osobę z serwera, która otrzyma rolę Lucyfer** (przeciwna frakcja).\n' +
                    'Ta osoba nie będzie miała wyboru - los został przesądzony przez twój wybór.',
                ephemeral: true,
                components: [row]
            });

            logger.info(`☁️ ${member.user.tag} rozpoczął wybór frakcji anioła`);

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru anioła: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                ephemeral: true
            });
        }
    }

    /**
     * Obsługuje wybór demona (przycisk czerwony)
     * @param {Interaction} interaction - Interakcja Discord
     * @param {Member} member - Członek serwera
     */
    async handleDemonChoice(interaction, member) {
        try {
            // Sprawdź czy użytkownik ma rolę Virtutti Papajlari
            if (!member.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                return await interaction.reply({
                    content: '⛪ Tylko posiadacze medalu Virtutti Papajlari mogą stanąć przed Sądem Bożym!',
                    ephemeral: true
                });
            }

            // Pokaż user select do wyboru osoby która dostanie rolę Gabriel
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('judgment_demon_select')
                .setPlaceholder('Wybierz osobę która otrzyma rolę Gabriel')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(userSelect);

            await interaction.reply({
                content:
                    '🔥 **Wybrałeś ścieżkę demonów - otrzymasz rolę Lucyfer!**\n\n' +
                    '⚖️ **Jednak równowaga wymaga ofiary...**\n\n' +
                    '☁️ **Wybierz jedną osobę z serwera, która otrzyma rolę Gabriel** (przeciwna frakcja).\n' +
                    'Ta osoba nie będzie miała wyboru - los został przesądzony przez twój wybór.',
                ephemeral: true,
                components: [row]
            });

            logger.info(`🔥 ${member.user.tag} rozpoczął wybór frakcji demona`);

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru demona: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                ephemeral: true
            });
        }
    }

    /**
     * Finalizuje wybór frakcji - nadaje role obu osobom i wysyła ogłoszenie
     * @param {Interaction} interaction - Interakcja z user select menu
     * @param {User} chooser - Osoba która wybiera (dostanie wybraną frakcję)
     * @param {User} chosenUser - Wybrana osoba (dostanie przeciwną frakcję)
     * @param {string} choiceType - Typ wyboru ('angel' lub 'demon')
     */
    async finalizeJudgmentChoice(interaction, chooser, chosenUser, choiceType) {
        try {
            const guild = interaction.guild;
            const chooserMember = await guild.members.fetch(chooser.id);
            const chosenMember = await guild.members.fetch(chosenUser.id);

            // Sprawdź czy chooser nadal ma Virtutti Papajlari
            if (!chooserMember.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                return await interaction.update({
                    content: '⛪ Nie posiadasz już medalu Virtutti Papajlari!',
                    components: [],
                    ephemeral: true
                });
            }

            let chooserRole, chosenRole, chooserRoleName, chosenRoleName;

            if (choiceType === 'angel') {
                chooserRole = this.config.roles.gabriel;
                chosenRole = this.config.roles.lucyfer;
                chooserRoleName = 'Gabriel';
                chosenRoleName = 'Lucyfer';
            } else { // demon
                chooserRole = this.config.roles.lucyfer;
                chosenRole = this.config.roles.gabriel;
                chooserRoleName = 'Lucyfer';
                chosenRoleName = 'Gabriel';
            }

            // Usuń Virtutti Papajlari od obu
            if (chooserMember.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                await chooserMember.roles.remove(this.config.roles.virtuttiPapajlari);
            }
            if (chosenMember.roles.cache.has(this.config.roles.virtuttiPapajlari)) {
                await chosenMember.roles.remove(this.config.roles.virtuttiPapajlari);
            }

            // Nadaj role
            await chooserMember.roles.add(chooserRole);
            await chosenMember.roles.add(chosenRole);

            // Wyślij potwierdzenie do wybierającego
            await interaction.update({
                content:
                    `⚖️ **Sąd Boży został dokonany!**\n\n` +
                    `✅ Otrzymałeś rolę: **${chooserRoleName}**\n` +
                    `🎯 ${chosenUser.toString()} otrzymał rolę: **${chosenRoleName}**\n\n` +
                    `**Los został przesądzony...**`,
                components: [],
                ephemeral: true
            });

            // Wyślij ogłoszenie na kanał gry
            const gameChannel = await this.client.channels.fetch(this.config.channels.command);
            if (gameChannel && gameChannel.isTextBased()) {
                const announcement = new EmbedBuilder()
                    .setTitle('⚖️ **SĄD BOŻY ZOSTAŁ DOKONANY!**')
                    .setDescription(
                        `**Równowaga została przywrócona. Dwie dusze zostały wybrane...**\n\n` +
                        `☁️ **${chooserMember.displayName}** otrzymał rolę **${chooserRoleName}**!\n` +
                        `🔥 **${chosenMember.displayName}** otrzymał rolę **${chosenRoleName}**!\n\n` +
                        `*Niech ich moce służą zarówno światłu jak i ciemności.*`
                    )
                    .setColor(choiceType === 'angel' ? '#87CEEB' : '#FF4500')
                    .setTimestamp()
                    .setFooter({ text: 'Konklawe - Sąd Boży' });

                await gameChannel.send({ embeds: [announcement] });
            }

            // Wyczyść kanał Sądu Bożego, ale zostaw główny embed
            try {
                const judgmentChannel = await this.client.channels.fetch(this.config.channels.judgment);
                if (judgmentChannel && judgmentChannel.isTextBased()) {
                    const messages = await judgmentChannel.messages.fetch({ limit: 100 });

                    // Usuń wszystkie wiadomości OPRÓCZ głównego embeda Sądu Bożego
                    const messagesToDelete = messages.filter(msg =>
                        msg.id !== this.judgmentMessageId
                    );

                    if (messagesToDelete.size > 0) {
                        // Bulk delete dla wiadomości młodszych niż 14 dni
                        const recentMessages = messagesToDelete.filter(msg =>
                            Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
                        );

                        if (recentMessages.size > 0) {
                            await judgmentChannel.bulkDelete(recentMessages, true);
                            logger.info(`🧹 Wyczyszczono ${recentMessages.size} wiadomości z kanału Sądu Bożego`);
                        }

                        // Usuń starsze wiadomości pojedynczo
                        const oldMessages = messagesToDelete.filter(msg =>
                            Date.now() - msg.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
                        );

                        for (const [, msg] of oldMessages) {
                            try {
                                await msg.delete();
                            } catch (err) {
                                logger.warn(`⚠️ Nie udało się usunąć starej wiadomości: ${err.message}`);
                            }
                        }
                    }
                }
            } catch (error) {
                logger.warn(`⚠️ Błąd podczas czyszczenia kanału Sądu Bożego: ${error.message}`);
            }

            logger.info(
                `⚖️ Sąd Boży: ${chooser.tag} (${chooserRoleName}) wybrał ${chosenUser.tag} (${chosenRoleName})`
            );

        } catch (error) {
            logger.error(`❌ Błąd podczas finalizacji wyboru Sądu Bożego: ${error.message}`);
            await interaction.update({
                content: '❌ Wystąpił błąd podczas finalizacji wyboru.',
                components: [],
                ephemeral: true
            });
        }
    }
}

module.exports = JudgmentService;
