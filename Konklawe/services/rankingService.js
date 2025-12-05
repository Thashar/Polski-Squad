const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');
class RankingService {
    constructor(config, gameService, detailedLogger = null) {
        this.config = config;
        this.gameService = gameService;
        this.detailedLogger = detailedLogger;
    }

    /**
     * Tworzy stronę wyników
     * @param {Interaction} interaction - Interakcja Discord
     * @param {number} page - Numer strony
     * @returns {Object} - Obiekt z zawartością i komponentami
     */
    async createResultsPage(interaction, page = 0) {
        const sorted = this.gameService.getSortedPlayers();
        
        if (sorted.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🏆 Ranking Konklawe')
                .setDescription('🚫 Jeszcze nikt nie odgadł hasła!\n\nSpróbuj swoich sił w grze słownej Konklawe.')
                .setColor('#FFD700')
                .setTimestamp()
                .setFooter({ text: 'Konklawe - System rankingowy' });
            
            return {
                embeds: [embed],
                components: []
            };
        }

        const totalPages = Math.ceil(sorted.length / 10);
        const startIndex = page * 10;
        const endIndex = Math.min(startIndex + 10, sorted.length);
        const pageData = sorted.slice(startIndex, endIndex);
        const wynikLines = [];

        for (let i = 0; i < pageData.length; i++) {
            const [userId, count] = pageData[i];
            const globalRank = startIndex + i + 1;
            try {
                let member = interaction.guild.members.cache.get(userId);
                if (!member) {
                    member = await interaction.guild.members.fetch(userId);
                }
                const name = member.displayName;
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                wynikLines.push(`${globalRank}. ${name} - ${medalDisplay}${count}${this.config.emojis.medal}`);
            } catch (memberError) {
                logger.error(`Błąd pobierania danych użytkownika ${userId}:`, memberError);
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                wynikLines.push(`${globalRank}. Nieznany użytkownik - ${medalDisplay}${count}${this.config.emojis.medal}`);
            }
        }

        const wynik = wynikLines.join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking Konklawe')
            .setDescription(wynik)
            .setColor('#FFD700')
            .setTimestamp()
            .setFooter({ text: `Strona ${page + 1}/${totalPages} | Łącznie graczy: ${sorted.length}` });
        
        const row = new ActionRowBuilder();

        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`results_first_${interaction.user.id}`)
                    .setLabel('⏮️ Pierwsza')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`results_prev_${page}_${interaction.user.id}`)
                    .setLabel('◀️ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`results_next_${page}_${interaction.user.id}`)
                    .setLabel('Następna ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`results_last_${totalPages - 1}_${interaction.user.id}`)
                    .setLabel('Ostatnia ⏭️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );
        }

        return {
            embeds: [embed],
            components: totalPages > 1 ? [row] : []
        };
    }

    /**
     * Tworzy stronę medali
     * @param {Interaction} interaction - Interakcja Discord
     * @param {number} page - Numer strony
     * @returns {Object} - Obiekt z zawartością i komponentami
     */
    async createMedalsPage(interaction, page = 0) {
        const sorted = this.gameService.getSortedMedals();
        
        if (sorted.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`${this.config.emojis.virtuttiPapajlari} Ranking Medali Virtutti Papajlari`)
                .setDescription('🚫 Jeszcze nikt nie zdobył medalu Virtutti Papajlari!\n\nMedal otrzymuje gracz, który osiągnie **10 punktów** w rankingu.')
                .setColor('#9B59B6')
                .setTimestamp()
                .setFooter({ text: 'Konklawe - System medali' });
            
            return {
                embeds: [embed],
                components: []
            };
        }

        const totalPages = Math.ceil(sorted.length / 10);
        const startIndex = page * 10;
        const endIndex = Math.min(startIndex + 10, sorted.length);
        const pageData = sorted.slice(startIndex, endIndex);
        const medalLines = [];

        for (let i = 0; i < pageData.length; i++) {
            const [userId, medalCount] = pageData[i];
            const globalRank = startIndex + i + 1;
            try {
                let member = interaction.guild.members.cache.get(userId);
                if (!member) {
                    member = await interaction.guild.members.fetch(userId);
                }
                const name = member.displayName;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                medalLines.push(`${globalRank}. ${name} - ${medalIcons} (${medalCount})`);
            } catch (memberError) {
                logger.error(`Błąd pobierania danych użytkownika ${userId}:`, memberError);
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                medalLines.push(`${globalRank}. Nieznany użytkownik - ${medalIcons} (${medalCount})`);
            }
        }

        const wynik = medalLines.join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle(`${this.config.emojis.virtuttiPapajlari} Ranking Medali Virtutti Papajlari`)
            .setDescription(wynik)
            .setColor('#9B59B6')
            .setTimestamp()
            .setFooter({ text: `Strona ${page + 1}/${totalPages} | Łącznie posiadaczy medali: ${sorted.length}` });
        
        const row = new ActionRowBuilder();

        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`medals_first_${interaction.user.id}`)
                    .setLabel('⏮️ Pierwsza')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`medals_prev_${page}_${interaction.user.id}`)
                    .setLabel('◀️ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`medals_next_${page}_${interaction.user.id}`)
                    .setLabel('Następna ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1)
            );
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`medals_last_${totalPages - 1}_${interaction.user.id}`)
                    .setLabel('Ostatnia ⏭️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );
        }

        return {
            embeds: [embed],
            components: totalPages > 1 ? [row] : []
        };
    }

    /**
     * Sprawdza osiągnięcie medalu Virtutti Papajlari
     * @param {string} userId - ID użytkownika
     * @param {Guild} guild - Serwer Discord
     * @param {Channel} channel - Kanał Discord
     * @returns {boolean} - True jeśli osiągnięto medal
     */
    async checkVirtuttiPapajlariAchievement(userId, guild, channel) {
        if (this.gameService.hasAchievedVirtuttiPapajlari(userId)) {
            // Usuń wszystkie role specjalne (Virtutti Papajlari, Gabriel, Lucyfer) od wszystkich użytkowników
            await this.removeRoleFromAllMembers(guild, this.config.roles.virtuttiPapajlari);
            await this.removeRoleFromAllMembers(guild, this.config.roles.gabriel);
            await this.removeRoleFromAllMembers(guild, this.config.roles.lucyfer);

            try {
                const member = await guild.members.fetch(userId);
                await member.roles.add(this.config.roles.virtuttiPapajlari);
                logger.info(`👑 Nadano rolę Virtutti Papajlari użytkownikowi ${member.user.tag}`);
            } catch (err) {
                logger.error(`❌ Błąd nadawania roli Virtutti Papajlari dla ${userId}:`, err);
            }

            // Pobierz punkty przed resetem
            const points = this.gameService.getPoints(userId);

            this.gameService.addVirtuttiMedal(userId);
            const member = await guild.members.fetch(userId);

            // Pobierz liczbę medali PO dodaniu nowego
            const medalCount = this.gameService.virtuttiMedals[userId] || 1;

            // Szczegółowe logowanie osiągnięcia
            if (this.detailedLogger) {
                await this.detailedLogger.logVirtuttiAchievement(
                    member.user,
                    points,
                    medalCount
                );
            }

            const achievementMessage = this.config.messages.virtuttiPapajlariAchieved
                .replace('{user}', `<@${userId}>`)
                .replace('{emoji}', this.config.emojis.virtuttiPapajlari);
            await channel.send(achievementMessage);

            this.gameService.resetScoreboard();
            await channel.send(this.config.messages.rankingReset);
            logger.info(`🏆 ${member.user.tag} osiągnął medal Virtutti Papajlari! Ranking został zresetowany.`);
            return true;
        }
        return false;
    }

    /**
     * Tworzy wiadomość TOP 3
     * @param {Guild} guild - Serwer Discord
     * @returns {string} - Sformatowana wiadomość TOP 3
     */
    async createTop3Message(guild) {
        const top3 = this.gameService.getTop3Players();
        const top3Lines = [];

        for (let i = 0; i < top3.length; i++) {
            const [userId, count] = top3[i];
            try {
                const member = await guild.members.fetch(userId);
                const name = member.displayName;
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                top3Lines.push(`${i + 1}. ${name} - ${medalDisplay}${count}${this.config.emojis.medal}`);
            } catch (error) {
                logger.error(`❌ Błąd pobierania użytkownika ${userId}:`, error);
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                top3Lines.push(`${i + 1}. Nieznany użytkownik (${userId}) - ${medalDisplay}${count}${this.config.emojis.medal}`);
            }
        }

        return `## 🏆 **TOP 3** 🏆\n${top3Lines.join('\n')}`;
    }

    /**
     * Usuwa rolę wszystkim członkom
     * @param {Guild} guild - Serwer Discord
     * @param {string} roleId - ID roli
     */
    async removeRoleFromAllMembers(guild, roleId) {
        try {
            logger.info(`Rozpoczynam usuwanie roli ${roleId} wszystkim użytkownikom...`);

            // Sprawdź czy guild jest prawidłowe
            if (!guild) {
                logger.error(`❌ Guild jest null lub undefined dla roli ${roleId}`);
                return;
            }

            // Fetch członków z cache (nie force fetch aby uniknąć rate limitu)
            let allMembers;
            try {
                // Użyj cache jeśli dostępny, w przeciwnym razie fetch
                allMembers = guild.members.cache.size > 0
                    ? guild.members.cache
                    : await guild.members.fetch({ force: false });
            } catch (fetchError) {
                logger.error(`❌ Błąd podczas pobierania członków dla roli ${roleId}:`, fetchError.message);
                // Spróbuj użyć cache jako fallback
                allMembers = guild.members.cache;
                if (allMembers.size === 0) {
                    logger.error(`❌ Cache członków jest pusty, nie można usunąć roli ${roleId}`);
                    return;
                }
                logger.info(`ℹ️ Użyto cache członków (${allMembers.size} członków)`);
            }

            const membersWithRole = allMembers.filter(member => member.roles.cache.has(roleId));
            logger.info(`Znaleziono ${membersWithRole.size} użytkowników z rolą ${roleId}`);

            if (membersWithRole.size === 0) {
                logger.info(`Brak użytkowników z rolą ${roleId} do usunięcia`);
                return;
            }

            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.roles.remove(roleId);
                    logger.info(`✅ Usunięto rolę ${roleId} od ${member.user.tag}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    logger.error(`❌ Błąd usuwania roli ${roleId} od ${member.user.tag}:`, err.message || err);
                }
            }
            logger.info(`✅ Zakończono usuwanie roli ${roleId} wszystkim użytkownikom`);
        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania ról ${roleId}:`, error.message || error.stack || error);
        }
    }
}

module.exports = RankingService;