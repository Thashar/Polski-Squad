const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

            // Sprawdź czy embed już istnieje
            const messages = await judgmentChannel.messages.fetch({ limit: 10 });
            const existingEmbed = messages.find(msg =>
                msg.author.id === this.client.user.id &&
                msg.embeds.length > 0 &&
                msg.embeds[0].title === '⚖️ SĄD BOŻY'
            );

            if (existingEmbed) {
                this.judgmentMessage = existingEmbed;
                this.judgmentMessageId = existingEmbed.id;
                logger.info('✅ Znaleziono istniejący embed Sądu Bożego');
                return;
            }

            // Utwórz nowy embed
            const embed = new EmbedBuilder()
                .setTitle('⚖️ SĄD BOŻY')
                .setDescription(
                    '**Papież właśnie stoi przed Sądem Bożym i musi wybrać czy chce należeć do aniołów czy demonów.**\n\n' +
                    '☁️ **Aniołowie** - Święci pełni łaski\n' +
                    '🔥 **Demony** - Upadłe duchy pełne potęgi\n\n' +
                    '**Wybierz swoją ścieżkę mądrze...**'
                )
                .setColor('#FFD700')
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

            // Usuń rolę Virtutti Papajlari
            await member.roles.remove(this.config.roles.virtuttiPapajlari);

            // Nadaj rolę Gabriel
            await member.roles.add(this.config.roles.gabriel);

            await interaction.reply({
                content: `☁️ **${member.displayName}** wybrał ścieżkę aniołów! Otrzymujesz rolę **Gabriel** - święty anioł pełen łaski i błogosławieństw! 🙏`,
                ephemeral: false
            });

            logger.info(`☁️ ${member.user.tag} wybrał ścieżkę aniołów (Gabriel)`);

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

            // Usuń rolę Virtutti Papajlari
            await member.roles.remove(this.config.roles.virtuttiPapajlari);

            // Nadaj rolę Lucyfer
            await member.roles.add(this.config.roles.lucyfer);

            await interaction.reply({
                content: `🔥 **${member.displayName}** wybrał ścieżkę demonów! Otrzymujesz rolę **Lucyfer** - upadły anioł pełen potęgi i klątw! 💀`,
                ephemeral: false
            });

            logger.info(`🔥 ${member.user.tag} wybrał ścieżkę demonów (Lucyfer)`);

        } catch (error) {
            logger.error(`❌ Błąd podczas obsługi wyboru demona: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas przetwarzania wyboru.',
                ephemeral: true
            });
        }
    }
}

module.exports = JudgmentService;
