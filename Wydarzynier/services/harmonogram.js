const { EmbedBuilder } = require('discord.js');

class Harmonogram {
    constructor(client, config, logger, przypomnieniaMenedzer, tablicaMenedzer) {
        this.client = client;
        this.config = config;
        this.logger = logger;
        this.przypomnieniaMenedzer = przypomnieniaMenedzer;
        this.tablicaMenedzer = tablicaMenedzer;
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
                content += scheduled.roles.map(r => `<@&${r}>`).join(' ') + '\n\n';
            }

            // Zbuduj wiadomość na podstawie typu szablonu
            if (template.type === 'text') {
                content += template.text;
            } else if (template.type === 'embed') {
                const colorHex = parseInt(template.embedColor || '5865F2', 16);
                const embed = new EmbedBuilder()
                    .setDescription(template.embedDescription)
                    .setColor(colorHex)
                    .setTimestamp();

                if (template.embedTitle) {
                    embed.setTitle(template.embedTitle);
                }

                if (template.embedIcon) {
                    embed.setThumbnail(template.embedIcon);
                }

                embeds.push(embed);
            }

            await channel.send({ content, embeds });

            this.logger.success(`Powiadomienie wysłane na kanał ${scheduled.channelId} (zaplanowane: ${scheduled.id})`);
        } catch (error) {
            this.logger.error(`Nie udało się wyzwolić zaplanowanego ${scheduled.id}:`, error);
        }
    }
}

module.exports = Harmonogram;
