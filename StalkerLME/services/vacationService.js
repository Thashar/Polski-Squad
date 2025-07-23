const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class VacationService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.cooldowns = new Map(); // userId -> lastRequestTime
    }

    async sendPermanentVacationMessage(guild) {
        try {
            const vacationChannel = await guild.channels.fetch(this.config.vacations.vacationChannelId);
            if (!vacationChannel) {
                this.logger.error('❌ Nie znaleziono kanału urlopów');
                return;
            }

            // Usuń wszystkie poprzednie wiadomości bota z kanału
            const messages = await vacationChannel.messages.fetch({ limit: 50 });
            const botMessages = messages.filter(msg => msg.author.bot);
            
            for (const message of botMessages.values()) {
                try {
                    await message.delete();
                } catch (error) {
                    this.logger.warn(`⚠️ Nie można usunąć wiadomości: ${error.message}`);
                }
            }

            // Utwórz przycisk do zgłaszania urlopu
            const vacationButton = new ButtonBuilder()
                .setCustomId('vacation_request')
                .setLabel('Zgłoś urlop')
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder()
                .addComponents(vacationButton);

            await vacationChannel.send({
                content: '## Chcesz zgłosić urlop? Kliknij przycisk poniżej.',
                components: [row]
            });

            this.logger.info('✅ Wysłano stałą wiadomość o urlopach');
        } catch (error) {
            this.logger.error(`❌ Błąd wysyłania stałej wiadomości: ${error.message}`);
        }
    }

    async handleVacationRequest(interaction) {
        try {
            const userId = interaction.user.id;
            
            // Sprawdź cooldown
            if (this.isOnCooldown(userId)) {
                const remainingTime = this.getRemainingCooldown(userId);
                await interaction.reply({
                    content: `⏰ Możesz złożyć kolejny wniosek o urlop za ${remainingTime}.`,
                    ephemeral: true
                });
                return;
            }

            // Wyślij pierwszą wiadomość z zasadami
            const rulesMessage = `Kilka ważnych zasad odnośnie składania urlopów:
- Urlopy zgłaszamy maksymalnie na 2 tygodnie przed rozpoczęciem urlopu,
- Każdy urlop może trwać maksymalnie 2 tygodnie,
- Jeżeli musisz przedłużyć urlop, zrób to dopiero w czasie jego trwania.
- Podczas urlopu można odpuścić punkty daily, eventy, oraz w niektórych przypadkach 3 fazę LME
- **Pamiętaj, że urlop nie obowiązuje podczas 1 fazy LME, chyba, że uczestnictwo jest niemożliwe (zepsuty telefon, brak internetu w innym kraju).**
- Urlop chroni przed nałożeniem punktów kary za brak uczestnictwa w 3 fazie LME.

Jeżeli zapoznałeś się z powyższymi zasadami i zgadzasz się z nimi naciśnij przycisk poniżej w celu złożenia wniosku.`;

            const submitButton = new ButtonBuilder()
                .setCustomId(`vacation_submit_${userId}`)
                .setLabel('Złóż wniosek o urlop')
                .setStyle(ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`vacation_cancel_${userId}`)
                .setLabel('Nie otwieraj wniosku')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(submitButton, cancelButton);

            await interaction.reply({
                content: rulesMessage,
                components: [row],
                ephemeral: true
            });

        } catch (error) {
            this.logger.error(`❌ Błąd obsługi wniosku o urlop: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas obsługi wniosku.',
                ephemeral: true
            });
        }
    }

    async handleVacationSubmit(interaction) {
        try {
            const userId = interaction.user.id;
            const member = interaction.member;

            // Nadaj rolę do składania wniosku
            const vacationRole = interaction.guild.roles.cache.get(this.config.vacations.vacationRequestRoleId);
            if (vacationRole) {
                await member.roles.add(vacationRole);
                this.logger.info(`✅ Nadano rolę urlopową użytkownikowi ${member.user.tag}`);
            }

            // Ustaw cooldown
            this.setCooldown(userId);

            const successMessage = `Możesz teraz napisać wniosek na czacie.
Pamiętaj, żeby podać dokładny termin kiedy będziesz niedostępny.

**Po wysłaniu wiadomości nowy wniosek będziesz mógł złożyć dopiero za 6h!**`;

            await interaction.update({
                content: successMessage,
                components: []
            });

            // Sprawdź czy wiadomość o urlopach jest ostatnia
            await this.ensureVacationMessageIsLast(interaction.guild);

        } catch (error) {
            this.logger.error(`❌ Błąd składania wniosku: ${error.message}`);
            await interaction.update({
                content: '❌ Wystąpił błąd podczas składania wniosku.',
                components: []
            });
        }
    }

    async handleVacationCancel(interaction) {
        try {
            await interaction.update({
                content: 'Wniosek został zamknięty.',
                components: []
            });

        } catch (error) {
            this.logger.error(`❌ Błąd anulowania wniosku: ${error.message}`);
        }
    }

    async handleVacationMessage(message) {
        try {
            // Sprawdź czy wiadomość jest na kanale urlopów
            if (message.channel.id !== this.config.vacations.vacationChannelId) {
                return;
            }

            // Sprawdź czy użytkownik ma rolę do składania wniosku i usuń ją
            const vacationRole = message.guild.roles.cache.get(this.config.vacations.vacationRequestRoleId);
            if (vacationRole && message.member.roles.cache.has(vacationRole.id)) {
                await message.member.roles.remove(vacationRole);
                this.logger.info(`✅ Usunięto rolę urlopową użytkownikowi ${message.author.tag} po napisaniu wniosku`);
            }

            // Sprawdź czy wiadomość bota z przyciskiem urlopowym jest ostatnia
            await this.ensureVacationMessageIsLast(message.guild);

        } catch (error) {
            this.logger.error(`❌ Błąd obsługi wiadomości urlopowej: ${error.message}`);
        }
    }

    async ensureVacationMessageIsLast(guild) {
        try {
            const vacationChannel = await guild.channels.fetch(this.config.vacations.vacationChannelId);
            if (!vacationChannel) {
                return;
            }

            // Pobierz najnowsze wiadomości z kanału
            const messages = await vacationChannel.messages.fetch({ limit: 10 });
            const messageList = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            if (messageList.length === 0) {
                // Jeśli kanał jest pusty, wyślij wiadomość
                await this.sendPermanentVacationMessage(guild);
                return;
            }

            const lastMessage = messageList[messageList.length - 1];
            
            // Sprawdź czy ostatnia wiadomość to wiadomość bota z przyciskiem urlopowym
            const isVacationMessage = lastMessage.author.bot && 
                lastMessage.content === '## Chcesz zgłosić urlop? Kliknij przycisk poniżej.' &&
                lastMessage.components.length > 0 &&
                lastMessage.components[0].components.some(comp => comp.customId === 'vacation_request');

            if (!isVacationMessage) {
                // Wiadomość bota nie jest ostatnia lub nie istnieje - odśwież
                this.logger.info('🔄 Wiadomość o urlopach nie jest ostatnia - odświeżam');
                await this.sendPermanentVacationMessage(guild);
            }

        } catch (error) {
            this.logger.error(`❌ Błąd sprawdzania pozycji wiadomości urlopowej: ${error.message}`);
        }
    }

    isOnCooldown(userId) {
        const lastRequest = this.cooldowns.get(userId);
        if (!lastRequest) return false;

        const now = Date.now();
        const cooldownTime = this.config.vacations.cooldownHours * 60 * 60 * 1000; // Convert hours to milliseconds
        return (now - lastRequest) < cooldownTime;
    }

    getRemainingCooldown(userId) {
        const lastRequest = this.cooldowns.get(userId);
        if (!lastRequest) return '0 minut';

        const now = Date.now();
        const cooldownTime = this.config.vacations.cooldownHours * 60 * 60 * 1000;
        const remaining = cooldownTime - (now - lastRequest);

        if (remaining <= 0) return '0 minut';

        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    setCooldown(userId) {
        this.cooldowns.set(userId, Date.now());
    }
}

module.exports = VacationService;