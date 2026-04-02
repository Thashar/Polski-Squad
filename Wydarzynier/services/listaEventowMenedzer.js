const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

class ListaEventowMenedzer {
    constructor(client, config, logger, eventMenedzer) {
        this.client = client;
        this.config = config;
        this.logger = logger;
        this.eventMenedzer = eventMenedzer;
        this.listChannel = null;
    }

    async initialize() {
        try {
            const channelId = this.eventMenedzer.getListChannelId();
            if (channelId) {
                const channel = await this.client.channels.fetch(channelId);
                if (channel) {
                    this.listChannel = channel;
                    this.logger.success('ListaEventowMenedzer zainicjalizowany');

                    // Utwórz lub zaktualizuj listę
                    await this.ensureEventsList();
                } else {
                    this.logger.warn('Kanał listy eventów nie znaleziony');
                }
            } else {
                this.logger.info('Kanał listy eventów nie ustawiony');
            }
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować ListaEventowMenedzer:', error);
        }
    }

    // Ustaw kanał listy
    async setListChannel(channelId) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                throw new Error('Kanał nie znaleziony');
            }

            // Pobierz stare ID kanału i wiadomości przed przełączeniem
            const oldChannelId = this.eventMenedzer.getListChannelId();
            const oldMessageId = this.eventMenedzer.getListMessageId();

            // Sprawdź czy to ten sam kanał
            if (oldChannelId === channelId && oldMessageId) {
                this.logger.info('Lista eventów już jest na tym kanale - brak akcji');
                return {
                    success: true,
                    sameChannel: true,
                    channelName: channel.name
                };
            }

            // Usuń stary embed z poprzedniego kanału jeśli istnieje
            if (oldChannelId && oldMessageId && oldChannelId !== channelId) {
                try {
                    const oldChannel = await this.client.channels.fetch(oldChannelId);
                    if (oldChannel) {
                        const oldMessage = await oldChannel.messages.fetch(oldMessageId);
                        await oldMessage.delete();
                        this.logger.info(`Usunięto stary embed listy eventów z kanału: ${oldChannel.name}`);
                    }
                } catch (error) {
                    this.logger.warn(`Nie można usunąć starego embed listy eventów: ${error.message}`);
                    // Kontynuuj mimo tego - nie jest to krytyczne
                }
            }

            // Ustaw nowy kanał
            this.listChannel = channel;
            await this.eventMenedzer.setListChannel(channelId);

            // Utwórz nową listę na nowym kanale
            await this.ensureEventsList();

            this.logger.success(`Kanał listy eventów ustawiony na: ${channel.name}`);
            return {
                success: true,
                sameChannel: false,
                channelName: channel.name
            };
        } catch (error) {
            this.logger.error('Nie udało się ustawić kanału listy eventów:', error);
            throw error;
        }
    }

    // Zbuduj embed listy eventów
    buildEventsList() {
        const events = this.eventMenedzer.getAllEvents();

        const embed = new EmbedBuilder()
            .setColor(0x5865F2) // Blurple
            .setTitle('📅 Nadchodzące Eventy')
            .setTimestamp();

        if (events.length === 0) {
            embed.setDescription('_Brak zaplanowanych eventów. Użyj panelu kontrolnego aby dodać eventy._');
        } else {
            const sortedEvents = [...events].sort((a, b) => new Date(a.nextTrigger) - new Date(b.nextTrigger));

            const now = Date.now();
            const h24 = 24 * 60 * 60 * 1000;
            const d7  = 7  * 24 * 60 * 60 * 1000;

            const soon    = sortedEvents.filter(e => (new Date(e.nextTrigger).getTime() - now) <  h24);
            const week    = sortedEvents.filter(e => { const t = new Date(e.nextTrigger).getTime() - now; return t >= h24 && t < d7; });
            const later   = sortedEvents.filter(e => (new Date(e.nextTrigger).getTime() - now) >= d7);

            const buildLines = (list, emoji) =>
                list.map(e => {
                    const isOneTime = !e.interval || e.isOneTime;
                    const prefix = isOneTime ? '<a:X_Uwaga:1297531538186965003> ' : '';
                    return `${prefix}**${e.name}** - <t:${Math.floor(new Date(e.nextTrigger).getTime() / 1000)}:R>${emoji ? ' ' + emoji : ''}`;
                }).join('\n');

            const fields = [];
            if (soon.length > 0)  fields.push({ name: '🚨 Najbliższe 24h', value: buildLines(soon, '<a:PepeAlarmMan:1341086085089857619>'), inline: false });
            if (week.length > 0)  fields.push({ name: '📆 Najbliższe 7 dni', value: buildLines(week, null), inline: false });
            if (later.length > 0) fields.push({ name: '🗓️ Późniejsze', value: buildLines(later, null), inline: false });

            if (fields.length > 0) embed.addFields(...fields);
        }

        embed.setFooter({ text: `Łączna liczba eventów: ${events.length}` });

        return embed;
    }

    // Upewnij się, że lista eventów istnieje i jest zaktualizowana
    async ensureEventsList() {
        if (!this.listChannel) {
            this.logger.warn('Nie można zaktualizować listy eventów - brak ustawionego kanału');
            return;
        }

        try {
            const messageId = this.eventMenedzer.getListMessageId();
            const embed = this.buildEventsList();

            // Przycisk subskrypcji
            const subscribeButton = new ButtonBuilder()
                .setCustomId('event_notifications_subscribe')
                .setLabel('Otrzymuj powiadomienia o Eventach w grze!')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔔');

            const row = new ActionRowBuilder().addComponents(subscribeButton);

            if (messageId) {
                // Spróbuj zaktualizować istniejącą wiadomość
                try {
                    const message = await this.listChannel.messages.fetch(messageId);
                    await message.edit({ embeds: [embed], components: [row] });
                    this.logger.info('Zaktualizowano listę eventów');
                    return;
                } catch (error) {
                    // Wiadomość nie istnieje, utwórz nową
                    this.logger.warn('Wiadomość listy eventów nie znaleziona, tworzenie nowej');
                }
            }

            // Utwórz nową wiadomość
            const message = await this.listChannel.send({ embeds: [embed], components: [row] });
            await this.eventMenedzer.setListMessageId(message.id);
            this.logger.success('Utworzono listę eventów');

        } catch (error) {
            this.logger.error('Nie udało się zaktualizować listy eventów:', error);
        }
    }
}

module.exports = ListaEventowMenedzer;
