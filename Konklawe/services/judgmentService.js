const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

class JudgmentService {
    constructor(config, detailedLogger = null) {
        this.config = config;
        this.client = null;
        this.judgmentMessage = null;
        this.judgmentMessageId = null;
        this.detailedLogger = detailedLogger;
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
    /**
     * Porównuje zawartość dwóch embedów
     * @param {Object} embed1 - Pierwszy embed (Discord Embed)
     * @param {Object} embed2 - Drugi embed (EmbedBuilder)
     * @returns {boolean} - true jeśli embedy są identyczne
     */
    compareEmbeds(embed1, embed2) {
        try {
            // Porównaj title
            if (embed1.title !== embed2.data.title) return false;

            // Porównaj description
            if (embed1.description !== embed2.data.description) return false;

            // Porównaj fields
            const fields1 = embed1.fields || [];
            const fields2 = embed2.data.fields || [];

            if (fields1.length !== fields2.length) return false;

            for (let i = 0; i < fields1.length; i++) {
                if (fields1[i].name !== fields2[i].name) return false;
                if (fields1[i].value !== fields2[i].value) return false;
                if (fields1[i].inline !== fields2[i].inline) return false;
            }

            return true;
        } catch (error) {
            logger.warn(`⚠️ Błąd porównywania embedów: ${error.message}`);
            return false;
        }
    }

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

            // Sprawdź czy embed już istnieje
            const messages = await judgmentChannel.messages.fetch({ limit: 10 });
            const existingMessage = messages.find(msg =>
                msg.author.id === this.client.user.id &&
                msg.embeds.length > 0 &&
                msg.embeds[0].title === '⚖️ SĄD BOŻY'
            );

            // Utwórz nowy embed (do porównania lub wysłania)
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
                            '**⚡ MANA:** 150, regen 1/5min\n\n' +
                            '**✨ MOCE:**\n' +
                            '• 🙏 `/blessing` (5): 50% usunięcia klątwy + ochrona (1h, 50% block następnej)\n' +
                            '• 💀 `/curse` (10+(N×2)): Zwykła klątwa (5min), 85% sukces\n' +
                            '• ⚔️ `/revenge` (50, 24h cd): Pułapka na neutralnego. Gdy Lucyfer przeklnie → odbicie 3x\n' +
                            '• 🔍 `/virtue-check` (0)\n\n' +
                            '**⚠️ SŁABOŚCI:**\n' +
                            '• 15% fail przy curse\n' +
                            '• Blessing nie działa na Lucyfera\n' +
                            '• Revenge Lucyfera → "Upadły" (blessing block 1h)\n\n' +
                            '**💀 POZIOMY:**\n' +
                            '• Zwykła (100%): 5min, 1 z 7 efektów\n' +
                            '• Mega (33% na Lucyfera): Blessing → 1h, zmiana co 5min\n' +
                            '• Ultra (1% na Lucyfera): Curse → 5min + debuff 24h (10% co 5min)\n\n' +
                            '**Efekty:** ⏰ Slow | 🗑️ Delete | 📢 Ping | 😀 Emoji | 📝 CAPS | 💤 Timeout | 🎭 Rola',
                        inline: false
                    },
                    {
                        name: '🔥 **LUCYFER - Upadły Anioł**',
                        value:
                            '**⚡ MANA:** 100, regen dynamiczny 5-15min/pkt\n\n' +
                            '**🔥 MOCE:**\n' +
                            '• 💀 `/curse` (5-15, 5min cd): Koszt dynamiczny (sukces ↓, fail ↑)\n' +
                            '• ⚔️ `/revenge` (50, 24h cd): Pułapka na neutralnego. Gdy Gabriel błogosławi → "Upadły" (blessing block 1h)\n' +
                            '• 🔍 `/virtue-check` (0)\n\n' +
                            '**⚠️ SŁABOŚCI:**\n' +
                            '• 📈 Progresywne odbicie: Za każdą klątwę +1% że Gabriel odbije\n' +
                            '  → Przy odbiciu: reset % + blokada 1h + nick "Uśpiony"\n' +
                            '• 100% odbicie od Gabriela\n' +
                            '• ⛔ Brak `/blessing`\n\n' +
                            '**💀 POZIOMY:**\n' +
                            '• Zwykła (96%): 5min, 1 z 7 efektów\n' +
                            '• Silna (3%): 15min, 1 z 7 efektów\n' +
                            '• Potężna (1%): 30min, 1 z 7 efektów\n\n' +
                            '**Efekty:** ⏰ Slow | 🗑️ Delete | 📢 Ping | 😀 Emoji | 📝 CAPS | 💤 Timeout | 🎭 Rola',
                        inline: false
                    }
                )
                .setFooter({ text: 'Konklawe - Sąd Boży' })
                .setTimestamp();

            // Porównaj z istniejącym embedem
            if (existingMessage) {
                const existingEmbed = existingMessage.embeds[0];
                const isIdentical = this.compareEmbeds(existingEmbed, embed);

                if (isIdentical) {
                    // Embed jest identyczny - zachowaj istniejący
                    this.judgmentMessage = existingMessage;
                    this.judgmentMessageId = existingMessage.id;
                    logger.info('ℹ️ Embed Sądu Bożego bez zmian - pozostawiono istniejący');
                    return;
                } else {
                    // Embed się zmienił - usuń stary
                    try {
                        await existingMessage.delete();
                        logger.info('🗑️ Usunięto stary embed Sądu Bożego (zawartość się zmieniła)');
                    } catch (error) {
                        logger.warn(`⚠️ Nie udało się usunąć starego embeda: ${error.message}`);
                    }
                }
            }

            // Wyślij nowy embed
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
            logger.info('✅ Utworzono nowy embed Sądu Bożego');

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
                    flags: MessageFlags.Ephemeral
                });
            }

            // Utwórz modal do wpisania ID/mention użytkownika
            const modal = new ModalBuilder()
                .setCustomId('judgment_angel_modal')
                .setTitle('⚖️ Sąd Boży - Wybór Anioła');

            const userInput = new TextInputBuilder()
                .setCustomId('user_input')
                .setLabel('Wpisz kilka liter z nicku użytkownika')
                .setPlaceholder('np. "push" aby znaleźć pushok_10')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(32);

            const row = new ActionRowBuilder().addComponents(userInput);
            modal.addComponents(row);

            await interaction.showModal(modal);

            logger.info(`☁️ ${member.user.tag} rozpoczął wybór frakcji anioła`);

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru anioła: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                    flags: MessageFlags.Ephemeral
                });
            }
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
                    flags: MessageFlags.Ephemeral
                });
            }

            // Utwórz modal do wpisania ID/mention użytkownika
            const modal = new ModalBuilder()
                .setCustomId('judgment_demon_modal')
                .setTitle('⚖️ Sąd Boży - Wybór Demona');

            const userInput = new TextInputBuilder()
                .setCustomId('user_input')
                .setLabel('Wpisz kilka liter z nicku użytkownika')
                .setPlaceholder('np. "push" aby znaleźć pushok_10')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(32);

            const row = new ActionRowBuilder().addComponents(userInput);
            modal.addComponents(row);

            await interaction.showModal(modal);

            logger.info(`🔥 ${member.user.tag} rozpoczął wybór frakcji demona`);

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru demona: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                    flags: MessageFlags.Ephemeral
                });
            }
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
                return await interaction.editReply({
                    content: '⛪ Nie posiadasz już medalu Virtutti Papajlari!'
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

            // Zaloguj Sąd Boży
            if (this.detailedLogger) {
                await this.detailedLogger.logJudgment(
                    chooserMember.user,
                    chosenUser,
                    chooserRoleName,
                    chosenRoleName
                );
            }

            // Wyślij potwierdzenie do wybierającego
            await interaction.editReply({
                content:
                    `⚖️ **Sąd Boży został dokonany!**\n\n` +
                    `✅ Otrzymałeś rolę: **${chooserRoleName}**\n` +
                    `🎯 ${chosenUser.toString()} otrzymał rolę: **${chosenRoleName}**\n\n` +
                    `**Los został przesądzony...**\n\n` +
                    `📬 Sprawdź wiadomości prywatne - wysłano szczegóły Twojej roli!`
            });

            // Funkcja pomocnicza do generowania opisu umiejętności
            const getAbilitiesDescription = (roleName) => {
                if (roleName === 'Gabriel') {
                    return '**⚡ System Many:** 150 many, regen 1/5min\n' +
                        '**Moce:**\n' +
                        '• 🙏 `/blessing` (5 many): 50% usunięcie klątwy + 🛡️ ochrona celu (1h, 50%)\n' +
                        '• 💀 `/curse` (85% sukces): Zwykła klątwa (5 min)\n' +
                        '• 🔍 `/virtue-check`\n' +
                        '• ⚔️ `/revenge` (50 many, 24h cd): Cel → Lucyfer /curse = odbicie 3x\n\n' +
                        '**VS Lucyfer:**\n' +
                        '• curse: 33% wzmocnienie | 33% odporność | 33% klątwa | 1% ultra klątwa\n' +
                        '• blessing: nie działa (odporność)\n\n' +
                        '**Ścieżka łaski i światła.**';
                } else { // Lucyfer
                    return '**⚡ System Many:** 100 many, regen dynamiczny 5-15min/pkt\n' +
                        '**Moce:**\n' +
                        '• 💀 `/curse` (5min cd): 96% zwykła | 3% silna | 1% potężna\n' +
                        '• 📈 Progresywne odbicie: +1% za klątwę (przy odbiciu: reset + blokada 1h)\n' +
                        '• 🔍 `/virtue-check`\n' +
                        '• 💀 `/revenge` (50 many, 24h cd): Cel → Gabriel /blessing = "Upadły" 1h\n\n' +
                        '**VS Gabriel:** 100% odbicie klątwy\n' +
                        '**Ograniczenia:** ⛔ Brak `/blessing`\n\n' +
                        '**Ścieżka potęgi i ciemności.**';
                }
            };

            // Wyślij powiadomienie DM do osoby wybierającej
            try {
                await chooserMember.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⚖️ **STANĄŁEŚ PRZED SĄDEM BOŻYM!**')
                            .setDescription(
                                `**Wybrałeś swoją ścieżkę w Sądzie Bożym!**\n\n` +
                                `✨ **Otrzymałeś rolę: ${chooserRoleName}**\n` +
                                `🎯 **${chosenMember.displayName}** otrzymał rolę: **${chosenRoleName}**\n\n` +
                                `*Los został przesądzony. Równowaga została przywrócona...*`
                            )
                            .addFields({
                                name: chooserRoleName === 'Gabriel' ? '☁️ **GABRIEL - Święty Anioł**' : '🔥 **LUCYFER - Upadły Anioł**',
                                value: getAbilitiesDescription(chooserRoleName),
                                inline: false
                            })
                            .setColor(chooserRoleName === 'Gabriel' ? '#87CEEB' : '#FF4500')
                            .setTimestamp()
                            .setFooter({ text: 'Konklawe - Sąd Boży' })
                    ]
                });
                logger.info(`📨 Wysłano powiadomienie DM do ${chooser.tag} o roli ${chooserRoleName}`);
            } catch (error) {
                logger.warn(`⚠️ Nie udało się wysłać DM do ${chooser.tag}: ${error.message}`);
            }

            // Wyślij powiadomienie DM do wybranej osoby
            try {
                await chosenMember.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⚖️ **ZOSTAŁEŚ WYBRANY PRZEZ SĄD BOŻY!**')
                            .setDescription(
                                `**${chooserMember.displayName}** stanął przed Sądem Bożym i wybrał Cię!\n\n` +
                                `✨ **Otrzymałeś rolę: ${chosenRoleName}**\n\n` +
                                `*Los został przesądzony. Twoja ścieżka została wyznaczona...*`
                            )
                            .addFields({
                                name: chosenRoleName === 'Gabriel' ? '☁️ **GABRIEL - Święty Anioł**' : '🔥 **LUCYFER - Upadły Anioł**',
                                value: getAbilitiesDescription(chosenRoleName),
                                inline: false
                            })
                            .setColor(chosenRoleName === 'Gabriel' ? '#87CEEB' : '#FF4500')
                            .setTimestamp()
                            .setFooter({ text: 'Konklawe - Sąd Boży' })
                    ]
                });
                logger.info(`📨 Wysłano powiadomienie DM do ${chosenUser.tag} o roli ${chosenRoleName}`);
            } catch (error) {
                logger.warn(`⚠️ Nie udało się wysłać DM do ${chosenUser.tag}: ${error.message}`);
            }

            // Wyślij ogłoszenie na kanał gry
            const gameChannel = await this.client.channels.fetch(this.config.channels.command);
            if (gameChannel && gameChannel.isTextBased()) {
                const chooserEmoji = chooserRoleName === 'Gabriel' ? '☁️' : '🔥';
                const chosenEmoji = chosenRoleName === 'Gabriel' ? '☁️' : '🔥';

                const announcement = new EmbedBuilder()
                    .setTitle('⚖️ **SĄD BOŻY ZOSTAŁ DOKONANY!**')
                    .setDescription(
                        `**Równowaga została przywrócona. Dwie dusze zostały wybrane...**\n\n` +
                        `${chooserEmoji} **${chooserMember.displayName}** otrzymał rolę **${chooserRoleName}**!\n` +
                        `${chosenEmoji} **${chosenMember.displayName}** otrzymał rolę **${chosenRoleName}**!\n\n` +
                        `⚔️ **Przygotujcie się na walkę dobra ze złem!**`
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
            logger.error(`Stack trace: ${error.stack}`);

            try {
                // Użyj editReply bo modal zrobił deferReply
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Wystąpił błąd podczas finalizacji wyboru.'
                    });
                }
            } catch (replyError) {
                logger.error(`❌ Nie udało się wysłać komunikatu błędu: ${replyError.message}`);
                // Jeśli nie możemy odpowiedzieć przez interakcję, wyślij wiadomość na kanał Sądu Bożego
                try {
                    const judgmentChannel = await this.client.channels.fetch(this.config.channels.judgment);
                    if (judgmentChannel && judgmentChannel.isTextBased()) {
                        await judgmentChannel.send({
                            content: `❌ <@${interaction.user.id}> Wystąpił błąd podczas finalizacji wyboru Sądu Bożego. Spróbuj ponownie.`
                        });
                    }
                } catch (channelError) {
                    logger.error(`❌ Nie udało się wysłać komunikatu na kanał: ${channelError.message}`);
                }
            }
        }
    }
}

module.exports = JudgmentService;
