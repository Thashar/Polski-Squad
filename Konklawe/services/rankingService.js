const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class RankingService {
    constructor(config, gameService) {
        this.config = config;
        this.gameService = gameService;
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
            return {
                content: 'Jeszcze nikt nie odgadł hasła!',
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
                const name = member.nickname || member.user.username;
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                wynikLines.push(`${globalRank}. ${name} - ${medalDisplay}${count}${this.config.emojis.medal}`);
            } catch (memberError) {
                console.error(`Błąd pobierania danych użytkownika ${userId}:`, memberError);
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                wynikLines.push(`${globalRank}. Nieznany użytkownik - ${medalDisplay}${count}${this.config.emojis.medal}`);
            }
        }

        const wynik = wynikLines.join('\n');
        const content = `## 🏆 **Ranking Konklawe** 🏆\n${wynik}\n\n📄 Strona ${page + 1}/${totalPages} | Łącznie graczy: ${sorted.length}`;
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
            content: content,
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
            return {
                content: 'Jeszcze nikt nie zdobył medalu Virtutti Papajlari!',
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
                const name = member.nickname || member.user.username;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                medalLines.push(`${globalRank}. ${name} - ${medalIcons} (${medalCount})`);
            } catch (memberError) {
                console.error(`Błąd pobierania danych użytkownika ${userId}:`, memberError);
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                medalLines.push(`${globalRank}. Nieznany użytkownik - ${medalIcons} (${medalCount})`);
            }
        }

        const wynik = medalLines.join('\n');
        const content = `## ${this.config.emojis.virtuttiPapajlari} **Ranking Medali Virtutti Papajlari** ${this.config.emojis.virtuttiPapajlari}\n${wynik}\n\n📄 Strona ${page + 1}/${totalPages} | Łącznie posiadaczy medali: ${sorted.length}`;
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
            content: content,
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
            await this.removeRoleFromAllMembers(guild, this.config.roles.virtuttiPapajlari);
            try {
                const member = await guild.members.fetch(userId);
                await member.roles.add(this.config.roles.virtuttiPapajlari);
                console.log(`👑 Nadano rolę Virtutti Papajlari użytkownikowi ${member.user.tag}`);
            } catch (err) {
                console.error(`❌ Błąd nadawania roli Virtutti Papajlari dla ${userId}:`, err);
            }

            this.gameService.addVirtuttiMedal(userId);
            const member = await guild.members.fetch(userId);
            const achievementMessage = this.config.messages.virtuttiPapajlariAchieved
                .replace('{user}', `<@${userId}>`)
                .replace('{emoji}', this.config.emojis.virtuttiPapajlari);
            await channel.send(achievementMessage);

            this.gameService.resetScoreboard();
            await channel.send(this.config.messages.rankingReset);
            console.log(`🏆 ${member.user.tag} osiągnął medal Virtutti Papajlari! Ranking został zresetowany.`);
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
                const name = member.nickname || member.user.username;
                const medalCount = this.gameService.virtuttiMedals[userId] || 0;
                const medalIcons = this.config.emojis.virtuttiPapajlari.repeat(medalCount);
                const medalDisplay = medalIcons ? `${medalIcons} ` : '';
                top3Lines.push(`${i + 1}. ${name} - ${medalDisplay}${count}${this.config.emojis.medal}`);
            } catch (error) {
                console.error(`❌ Błąd pobierania użytkownika ${userId}:`, error);
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
            console.log(`Rozpoczynam usuwanie roli ${roleId} wszystkim użytkownikom...`);
            const allMembers = await guild.members.fetch();
            const membersWithRole = allMembers.filter(member => member.roles.cache.has(roleId));
            console.log(`Znaleziono ${membersWithRole.size} użytkowników z rolą ${roleId}`);

            if (membersWithRole.size === 0) {
                console.log(`Brak użytkowników z rolą ${roleId} do usunięcia`);
                return;
            }

            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.roles.remove(roleId);
                    console.log(`✅ Usunięto rolę ${roleId} od ${member.user.tag}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    console.error(`❌ Błąd usuwania roli ${roleId} od ${member.user.tag}:`, err);
                }
            }
            console.log(`✅ Zakończono usuwanie roli ${roleId} wszystkim użytkownikom`);
        } catch (error) {
            console.error(`❌ Błąd podczas usuwania ról ${roleId}:`, error);
        }
    }
}

module.exports = RankingService;