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
        this.lastUpdateTimestamp = 0; // Timestamp ostatniej aktualizacji
        this.pendingUpdate = false; // Czy jest zaplanowana aktualizacja
        this.updateCooldown = 1000; // Cooldown w milisekundach (1 sekunda)
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

            // Zapisz timestamp aktualizacji
            this.lastUpdateTimestamp = Date.now();
            this.pendingUpdate = false;

            logger.info('✅ Zaktualizowano embed statusu hasła');
        } catch (error) {
            logger.error('❌ Błąd podczas aktualizacji embeda:', error);
            this.pendingUpdate = false;
        }
    }

    /**
     * Planuje aktualizację embeda z cooldownem
     * Jeśli minęła 1 sekunda od ostatniej aktualizacji, aktualizuje natychmiast
     * W przeciwnym razie planuje aktualizację po upływie cooldownu
     */
    async scheduleUpdate() {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUpdateTimestamp;

        // Jeśli minął cooldown, aktualizuj natychmiast
        if (timeSinceLastUpdate >= this.updateCooldown) {
            await this.updateEmbed(false);
            return;
        }

        // Jeśli już jest zaplanowana aktualizacja, nie planuj kolejnej
        if (this.pendingUpdate) {
            return;
        }

        // Zaplanuj aktualizację po upływie pozostałego czasu cooldownu
        this.pendingUpdate = true;
        const remainingCooldown = this.updateCooldown - timeSinceLastUpdate;

        setTimeout(async () => {
            if (this.pendingUpdate) {
                await this.updateEmbed(false);
            }
        }, remainingCooldown);
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
                const timestamp = Math.floor(this.gameService.triggerClearedTimestamp.getTime() / 1000);
                embed.addFields({
                    name: '⏱️ Czas oczekiwania',
                    value: `Od <t:${timestamp}:R>`,
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

            const fields = [];

            // POLE 1: Hasło (inline)
            fields.push({
                name: '🔑 Hasło',
                value: `**${this.gameService.trigger}**`,
                inline: true
            });

            // POLE 2: Jak rozpocząć
            fields.push({
                name: '📌 Jak rozpocząć?',
                value: `Napisz **"${this.config.messages.defaultPassword}"** na odpowiednim kanale aby rozpocząć grę i zostać papieżem!`,
                inline: false
            });

            embed.addFields(fields);

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

            const fields = [];

            // POLE 1: Hasło (inline)
            fields.push({
                name: '🔑 Hasło',
                value: `**${this.gameService.trigger}**`,
                inline: true
            });

            // POLE 2: Czas od ustawienia hasła (inline)
            if (this.gameService.triggerSetTimestamp) {
                const timestamp = Math.floor(this.gameService.triggerSetTimestamp.getTime() / 1000);
                fields.push({
                    name: '⏱️ Czas od ustawienia hasła',
                    value: `<t:${timestamp}:R>`,
                    inline: true
                });
            }

            // POLE 3: Ostatnia podpowiedź - brak (inline)
            fields.push({
                name: '🕐 Ostatnia podpowiedź',
                value: 'Brak podpowiedzi',
                inline: true
            });

            // POLE 4: Podpowiedzi (inline) - brak
            fields.push({
                name: '💡 Podpowiedzi',
                value: 'Brak podpowiedzi',
                inline: true
            });

            // POLE 5: Liczba graczy (inline)
            const activePlayers = Object.keys(this.gameService.attempts).length;
            const totalAttempts = Object.values(this.gameService.attempts).reduce((sum, attempts) => sum + attempts, 0);
            fields.push({
                name: '👥 Liczba graczy',
                value: activePlayers > 0 ? `${activePlayers} graczy\n${totalAttempts} prób` : 'Brak prób',
                inline: true
            });

            // POLE 6: Ważne informacje (inline)
            fields.push({
                name: '📢 Ważne informacje',
                value: '• Przypomnienie po **15 minutach**\n' +
                       '• Drugie przypomnienie po **30 minutach**\n' +
                       '• Utrata roli po **1 godzinie**',
                inline: true
            });

            embed.addFields(fields);

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
            const hintsCount = this.gameService.hints.length;
            embed.setTitle(`🔑 Konklawe - Aktywne hasło | 💡 Podpowiedzi (${hintsCount})`);
            embed.setDescription('Hasło aktywne z podpowiedziami. Gra w toku!');

            const fields = [];

            // POLE 1: Hasło (inline)
            fields.push({
                name: '🔑 Hasło',
                value: `**${this.gameService.trigger}**`,
                inline: true
            });

            // POLE 2: Czas od ustawienia hasła (inline)
            if (this.gameService.triggerSetTimestamp) {
                const timestamp = Math.floor(this.gameService.triggerSetTimestamp.getTime() / 1000);
                fields.push({
                    name: '⏱️ Czas od ustawienia hasła',
                    value: `<t:${timestamp}:R>`,
                    inline: true
                });
            }

            // POLE 3: Ostatnia podpowiedź (inline)
            if (this.gameService.lastHintTimestamp) {
                const timestamp = Math.floor(this.gameService.lastHintTimestamp.getTime() / 1000);
                fields.push({
                    name: '🕐 Ostatnia podpowiedź',
                    value: `<t:${timestamp}:R>`,
                    inline: true
                });
            }

            // POLE 4: Podpowiedzi (inline) - wyświetl treść wszystkich podpowiedzi
            const hintsText = this.gameService.hints.map((hint, index) => {
                return `**${index + 1}.** ${hint}`;
            }).join('\n');

            fields.push({
                name: '💡 Podpowiedzi',
                value: hintsText.length > 1024 ? hintsText.substring(0, 1021) + '...' : hintsText,
                inline: true
            });

            // POLE 5: Liczba graczy (inline) - wyświetl listę graczy z próbami
            const activePlayers = Object.entries(this.gameService.attempts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5); // Top 5 graczy

            let playersText = '';
            if (activePlayers.length > 0) {
                playersText = activePlayers.map(([userId, attempts]) => {
                    return `<@${userId}>: ${attempts} ${attempts === 1 ? 'próba' : attempts < 5 ? 'próby' : 'prób'}`;
                }).join('\n');

                const totalPlayers = Object.keys(this.gameService.attempts).length;
                if (totalPlayers > 5) {
                    playersText += `\n\n...i ${totalPlayers - 5} więcej`;
                }
            } else {
                playersText = 'Brak prób';
            }

            fields.push({
                name: '👥 Liczba graczy',
                value: playersText.length > 1024 ? playersText.substring(0, 1021) + '...' : playersText,
                inline: true
            });

            // POLE 6: Ważne informacje (inline)
            fields.push({
                name: '📢 Ważne informacje',
                value: '• Powiadomienia **co 6 godzin**\n' +
                       '• Reset po **24h** bez podpowiedzi\n' +
                       '• Papież traci rolę przy resecie',
                inline: true
            });

            embed.addFields(fields);

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
     * Wysyła podpowiedź jako wiadomość na kanale command
     * @param {string} hintText - Tekst podpowiedzi
     * @param {string} authorTag - Tag autora (np. "User#1234")
     */
    async sendHintToCommandChannel(hintText, authorTag) {
        try {
            const commandChannel = await this.client.channels.fetch(this.config.channels.command);
            if (!commandChannel || !commandChannel.isTextBased()) {
                logger.error('❌ Nie znaleziono kanału command lub nie jest to kanał tekstowy');
                return;
            }

            const hintNumber = this.gameService.hints.length;
            const embed = new EmbedBuilder()
                .setTitle(`${this.config.emojis.warning} Podpowiedź #${hintNumber} ${this.config.emojis.warning}`)
                .setDescription(`\`\`\`${hintText}\`\`\``)
                .setColor('#00FF00')
                .setTimestamp()
                .setFooter({ text: `Dodał: ${authorTag}` });

            await commandChannel.send({ embeds: [embed] });
            logger.info(`✅ Wysłano podpowiedź #${hintNumber} na kanale command`);
        } catch (error) {
            logger.error('❌ Błąd podczas wysyłania podpowiedzi:', error);
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
