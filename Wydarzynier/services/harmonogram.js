const { EmbedBuilder } = require('discord.js');

class Harmonogram {
    constructor(client, config, logger, przypomnieniaMenedzer, tablicaMenedzer, eventMenedzer, listaEventowMenedzer) {
        this.client = client;
        this.config = config;
        this.logger = logger;
        this.przypomnieniaMenedzer = przypomnieniaMenedzer;
        this.tablicaMenedzer = tablicaMenedzer;
        this.eventMenedzer = eventMenedzer;
        this.listaEventowMenedzer = listaEventowMenedzer;
        this.checkInterval = null;
    }

    initialize() {
        // Sprawdzaj powiadomienia co 30 sekund
        this.checkInterval = setInterval(async () => {
            await this.checkNotifications();
        }, 30000); // 30 sekund

        this.logger.success('Harmonogram zainicjalizowany - sprawdzanie co 30 sekund');

        // Sprawdź również natychmiast przy starcie
        setTimeout(() => this.checkNotifications(), 5000);
    }

    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            this.logger.info('Harmonogram zatrzymany');
        }
    }

    async checkNotifications() {
        const now = new Date();

        // Sprawdź zaplanowane przypomnienia
        await this.checkScheduled(now);

        // Sprawdź eventy
        await this.checkEvents(now);

        // Sprawdź wiadomości do usunięcia (typ 1 - ustandaryzowane, 23h 50min)
        await this.checkMessagesToDelete();
    }

    async checkScheduled(now) {
        const scheduled = this.przypomnieniaMenedzer.getActiveScheduled();

        for (const sch of scheduled) {
            const nextTriggerTime = new Date(sch.nextTrigger);

            if (now >= nextTriggerTime) {
                await this.triggerScheduled(sch);

                // Sprawdź czy to jednorazowe przypomnienie
                const isOneTime = !sch.interval || sch.interval === null || sch.isOneTime;

                // Zaktualizuj następne wyzwolenie (dla jednorazowych ustawi status 'completed')
                await this.przypomnieniaMenedzer.updateNextTrigger(sch.id);

                if (isOneTime) {
                    // Jednorazowe - usuń embed z tablicy
                    await this.tablicaMenedzer.deleteEmbed(sch);
                    this.logger.info(`Wyzwolono jednorazowe przypomnienie: ${sch.id} - usunięto z tablicy`);
                } else {
                    // Cykliczne - zaktualizuj embed tablicy
                    const updatedScheduled = this.przypomnieniaMenedzer.getScheduledWithTemplate(sch.id);
                    await this.tablicaMenedzer.updateEmbed(updatedScheduled);
                    this.logger.info(`Wyzwolono cykliczne przypomnienie: ${sch.id}`);
                }
            }
        }
    }

    async triggerScheduled(scheduled) {
        try {
            const template = this.przypomnieniaMenedzer.getTemplate(scheduled.templateId);
            if (!template) {
                this.logger.error(`Szablon nie znaleziony dla zaplanowanego: ${scheduled.id} (templateId: ${scheduled.templateId})`);
                return;
            }

            const channel = await this.client.channels.fetch(scheduled.channelId);
            if (!channel) {
                this.logger.error(`Kanał nie znaleziony: ${scheduled.channelId}`);
                return;
            }

            let content = '';
            const embeds = [];

            // Dodaj pingi ról
            if (scheduled.roles && scheduled.roles.length > 0) {
                if (scheduled.roles[0] === 'everyone') {
                    content += '@everyone\n\n';
                } else {
                    content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n\n';
                }
            }

            // Zbuduj wiadomość na podstawie typu szablonu
            if (template.type === 'text') {
                content += template.text;
            } else if (template.type === 'embed') {
                const colorHex = parseInt(template.embedColor || '5865F2', 16);
                const now = new Date();
                const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

                const embed = new EmbedBuilder()
                    .setDescription(template.embedDescription)
                    .setColor(colorHex)
                    .setFooter({ text: `System powiadomień • ${timeStr}` });

                if (template.embedTitle) {
                    embed.setTitle(template.embedTitle);
                }

                if (template.embedIcon) {
                    embed.setThumbnail(template.embedIcon);
                }

                embeds.push(embed);
            }

            const message = await channel.send({ content, embeds });

            this.logger.success(`Powiadomienie wysłane na kanał ${scheduled.channelId} (zaplanowane: ${scheduled.id})`);

            // Jeśli typ 1 (ustandaryzowane) - zaplanuj usunięcie po 23h 50min
            if (scheduled.notificationType === 1) {
                await this.przypomnieniaMenedzer.addMessageToDelete(message.id, scheduled.channelId);
                this.logger.info(`Wiadomość ${message.id} zostanie usunięta za 23h 50min (typ: ustandaryzowane)`);
            }
        } catch (error) {
            this.logger.error(`Nie udało się wyzwolić zaplanowanego ${scheduled.id}:`, error);
        }
    }

    async checkEvents(now) {
        if (!this.eventMenedzer || !this.listaEventowMenedzer) return;

        const events = this.eventMenedzer.getAllEvents();
        let anyTriggered = false;

        for (const event of events) {
            const nextTriggerTime = new Date(event.nextTrigger);
            if (now >= nextTriggerTime) {
                const isOneTime = !event.interval || event.isOneTime;

                // Oblicz następne wyzwolenie (lub usuń jeśli jednorazowy)
                await this.eventMenedzer.updateNextTrigger(event.id);
                anyTriggered = true;

                if (isOneTime) {
                    this.logger.info(`Event jednorazowy ${event.id} (${event.name}) wygasł - usunięto`);
                } else {
                    const updated = this.eventMenedzer.getEvent(event.id);
                    const nextTs = updated ? Math.floor(new Date(updated.nextTrigger).getTime() / 1000) : '?';
                    this.logger.info(`Event cykliczny ${event.id} (${event.name}) - następny: <t:${nextTs}:F>`);
                }
            }
        }

        // Zaktualizuj listę eventów jeśli cokolwiek się zmieniło
        if (anyTriggered) {
            await this.listaEventowMenedzer.ensureEventsList();
        }
    }

    async checkMessagesToDelete() {
        const messagesToDelete = this.przypomnieniaMenedzer.getMessagesToDeleteNow();

        for (const msg of messagesToDelete) {
            try {
                const channel = await this.client.channels.fetch(msg.channelId);
                if (!channel) {
                    this.logger.warn(`Kanał nie znaleziony: ${msg.channelId} (wiadomość ${msg.messageId})`);
                    await this.przypomnieniaMenedzer.removeMessageFromDeleteList(msg.messageId);
                    continue;
                }

                await channel.messages.delete(msg.messageId);
                this.logger.success(`Usunięto wiadomość ${msg.messageId} z kanału ${msg.channelId} (23h 50min upłynęło)`);
                await this.przypomnieniaMenedzer.removeMessageFromDeleteList(msg.messageId);
            } catch (error) {
                if (error.code === 10008) { // Unknown Message
                    this.logger.warn(`Wiadomość ${msg.messageId} już nie istnieje - usuwam z listy`);
                    await this.przypomnieniaMenedzer.removeMessageFromDeleteList(msg.messageId);
                } else {
                    this.logger.error(`Nie udało się usunąć wiadomości ${msg.messageId}:`, error);
                }
            }
        }
    }
}

module.exports = Harmonogram;
