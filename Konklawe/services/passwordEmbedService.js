const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatTimeDifference } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

class PasswordEmbedService {
    constructor(config, gameService) {
        this.config = config;
        this.gameService = gameService;
        this.client = null;
        this.embedMessageId = null; // ID wiadomości z embedem
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Inicjalizuje embed na kanale trigger
     * Usuwa wszystkie stare wiadomości i tworzy nowy embed
     */
    async initializeEmbed() {
        try {
            const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
            if (!triggerChannel || !triggerChannel.isTextBased()) {
                logger.error('❌ Nie znaleziono kanału trigger lub nie jest to kanał tekstowy');
                return;
            }

            // Wyczyść kanał
            await this.clearChannel(triggerChannel);

            // Utwórz i wyślij embed
            const { embed, components } = this.createPasswordEmbed();
            const message = await triggerChannel.send({ embeds: [embed], components });
            this.embedMessageId = message.id;

            logger.info('✅ Zainicjalizowano embed statusu hasła na kanale trigger');
        } catch (error) {
            logger.error('❌ Błąd podczas inicjalizacji embeda:', error);
        }
    }

    /**
     * Aktualizuje embed na kanale trigger
     * @param {boolean} clearHints - Czy wyczyścić podpowiedzi (wszystkie wiadomości oprócz embeda)
     */
    async updateEmbed(clearHints = false) {
        try {
            const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
            if (!triggerChannel || !triggerChannel.isTextBased()) {
                logger.error('❌ Nie znaleziono kanału trigger lub nie jest to kanał tekstowy');
                return;
            }

            // Jeśli trzeba wyczyścić podpowiedzi
            if (clearHints) {
                await this.clearChannelExceptEmbed(triggerChannel);
            }

            // Pobierz embed message
            let embedMessage;
            if (this.embedMessageId) {
                try {
                    embedMessage = await triggerChannel.messages.fetch(this.embedMessageId);
                } catch (error) {
                    logger.warn('⚠️ Nie znaleziono embeda o ID:', this.embedMessageId);
                    embedMessage = null;
                }
            }

            // Jeśli embed nie istnieje, utwórz nowy
            if (!embedMessage) {
                await this.initializeEmbed();
                return;
            }

            // Zaktualizuj embed
            const { embed, components } = this.createPasswordEmbed();
            await embedMessage.edit({ embeds: [embed], components });

            logger.info('✅ Zaktualizowano embed statusu hasła');
        } catch (error) {
            logger.error('❌ Błąd podczas aktualizacji embeda:', error);
        }
    }

    /**
     * Tworzy embed i komponenty w zależności od stanu gry
     * @returns {Object} - Obiekt z embedem i komponentami
     */
    createPasswordEmbed() {
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTimestamp();

        let components = [];

        // PRZYPADEK 1: Brak hasła (trigger === null)
        if (this.gameService.trigger === null) {
            embed.setTitle('⚔️ Konklawe - Oczekiwanie na hasło');
            embed.setDescription('Papież musi nadać nowe hasło aby rozpocząć grę.');

            // Timestamp ile czasu minęło od wyczyszczenia hasła
            if (this.gameService.triggerClearedTimestamp) {
                const timeSinceCleared = new Date() - this.gameService.triggerClearedTimestamp;
                const timeText = formatTimeDifference(timeSinceCleared);
                embed.addFields({
                    name: '⏱️ Czas oczekiwania',
                    value: `${timeText}`,
                    inline: false
                });
            }

            // Przycisk: Nadaj nowe hasło
            const setPasswordButton = new ButtonBuilder()
                .setCustomId('password_set_new')
                .setLabel('Nadaj nowe hasło')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔑');

            components = [new ActionRowBuilder().addComponents(setPasswordButton)];
        }
        // PRZYPADEK 2: Hasło domyślne "Konklawe"
        else if (this.gameService.trigger.toLowerCase() === this.config.messages.defaultPassword.toLowerCase()) {
            embed.setTitle('🔑 Konklawe - Hasło domyślne');
            embed.setDescription('Hasło domyślne "Konklawe" zostało ustawione.');

            embed.addFields({
                name: '📌 Jak rozpocząć?',
                value: `Napisz **"${this.config.messages.defaultPassword}"** na odpowiednim kanale aby rozpocząć grę i zostać papieżem!`,
                inline: false
            });

            // Przycisk: Zmień hasło (tylko dla papieża)
            const changePasswordButton = new ButtonBuilder()
                .setCustomId('password_change')
                .setLabel('Zmień aktualne hasło')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄');

            components = [new ActionRowBuilder().addComponents(changePasswordButton)];
        }
        // PRZYPADEK 3: Hasło ustawione, brak podpowiedzi
        else if (this.gameService.hints.length === 0) {
            embed.setTitle('🔑 Konklawe - Aktywne hasło');
            embed.setDescription('Hasło zostało ustawione. Papież musi dodać pierwszą podpowiedź.');

            // Timestamp ile czasu minęło od ustawienia hasła
            if (this.gameService.triggerSetTimestamp) {
                const timeSinceSet = new Date() - this.gameService.triggerSetTimestamp;
                const timeText = formatTimeDifference(timeSinceSet);
                embed.addFields({
                    name: '⏱️ Czas od ustawienia hasła',
                    value: `${timeText}`,
                    inline: false
                });
            }

            embed.addFields({
                name: '⚠️ Ważne',
                value: 'Papież musi dodać pierwszą podpowiedź!\n' +
                       '• Przypomnienie po **15 minutach**\n' +
                       '• Drugie przypomnienie po **30 minutach**\n' +
                       '• Utrata roli papieskiej po **1 godzinie** bez podpowiedzi',
                inline: false
            });

            // Przyciski: Zmień hasło i Dodaj podpowiedź
            const changePasswordButton = new ButtonBuilder()
                .setCustomId('password_change')
                .setLabel('Zmień aktualne hasło')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄');

            const addHintButton = new ButtonBuilder()
                .setCustomId('hint_add')
                .setLabel('Dodaj podpowiedź')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💡');

            components = [new ActionRowBuilder().addComponents(changePasswordButton, addHintButton)];
        }
        // PRZYPADEK 4: Hasło ustawione, są podpowiedzi
        else {
            embed.setTitle('🔑 Konklawe - Aktywne hasło');
            embed.setDescription('Hasło aktywne z podpowiedziami. Gra w toku!');

            // Timestamp ile czasu minęło od ustawienia hasła
            if (this.gameService.triggerSetTimestamp) {
                const timeSinceSet = new Date() - this.gameService.triggerSetTimestamp;
                const timeText = formatTimeDifference(timeSinceSet);
                embed.addFields({
                    name: '⏱️ Czas od ustawienia hasła',
                    value: `${timeText}`,
                    inline: true
                });
            }

            // Liczba podpowiedzi
            embed.addFields({
                name: '💡 Podpowiedzi',
                value: `Dodano **${this.gameService.hints.length}** ${this.gameService.hints.length === 1 ? 'podpowiedź' : 'podpowiedzi'}`,
                inline: true
            });

            // Informacje o systemie powiadomień
            embed.addFields({
                name: '📢 System powiadomień',
                value: '• Powiadomienia o następnej podpowiedzi **co 6 godzin**\n' +
                       '• Po **24 godzinach** bez nowej podpowiedzi hasło zostanie zresetowane do "Konklawe"\n' +
                       '• Papież straci rolę papieską przy resecie',
                inline: false
            });

            // Ostatnia podpowiedź
            if (this.gameService.lastHintTimestamp) {
                const timeSinceLastHint = new Date() - this.gameService.lastHintTimestamp;
                const timeText = formatTimeDifference(timeSinceLastHint);
                embed.addFields({
                    name: '🕐 Ostatnia podpowiedź',
                    value: `${timeText} temu`,
                    inline: false
                });
            }

            // Przyciski: Zmień hasło i Dodaj podpowiedź
            const changePasswordButton = new ButtonBuilder()
                .setCustomId('password_change')
                .setLabel('Zmień aktualne hasło')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄');

            const addHintButton = new ButtonBuilder()
                .setCustomId('hint_add')
                .setLabel('Dodaj podpowiedź')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💡');

            components = [new ActionRowBuilder().addComponents(changePasswordButton, addHintButton)];
        }

        return { embed, components };
    }

    /**
     * Dodaje podpowiedź jako osobną wiadomość na kanale
     * @param {string} hintText - Tekst podpowiedzi
     * @param {string} authorTag - Tag autora (np. "User#1234")
     */
    async addHintMessage(hintText, authorTag) {
        try {
            const triggerChannel = await this.client.channels.fetch(this.config.channels.trigger);
            if (!triggerChannel || !triggerChannel.isTextBased()) {
                logger.error('❌ Nie znaleziono kanału trigger lub nie jest to kanał tekstowy');
                return;
            }

            const hintNumber = this.gameService.hints.length;
            const embed = new EmbedBuilder()
                .setTitle(`${this.config.emojis.warning} Podpowiedź #${hintNumber} ${this.config.emojis.warning}`)
                .setDescription(`\`\`\`${hintText}\`\`\``)
                .setColor('#00FF00')
                .setTimestamp()
                .setFooter({ text: `Dodał: ${authorTag}` });

            await triggerChannel.send({ embeds: [embed] });
            logger.info(`✅ Dodano podpowiedź #${hintNumber} na kanale trigger`);
        } catch (error) {
            logger.error('❌ Błąd podczas dodawania podpowiedzi:', error);
        }
    }

    /**
     * Czyści cały kanał
     * @param {TextChannel} channel - Kanał do wyczyszczenia
     */
    async clearChannel(channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size > 0) {
                await channel.bulkDelete(messages, true);
                logger.info(`🗑️ Wyczyszczono ${messages.size} wiadomości z kanału trigger`);
            }
        } catch (error) {
            logger.error('❌ Błąd podczas czyszczenia kanału:', error);
        }
    }

    /**
     * Czyści kanał oprócz wiadomości z embedem
     * @param {TextChannel} channel - Kanał do wyczyszczenia
     */
    async clearChannelExceptEmbed(channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(msg => msg.id !== this.embedMessageId);

            if (messagesToDelete.size > 0) {
                await channel.bulkDelete(messagesToDelete, true);
                logger.info(`🗑️ Wyczyszczono ${messagesToDelete.size} wiadomości z kanału trigger (zachowano embed)`);
            }
        } catch (error) {
            logger.error('❌ Błąd podczas czyszczenia kanału:', error);
        }
    }
}

module.exports = PasswordEmbedService;
