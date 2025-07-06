const { SlashCommandBuilder } = require('discord.js');
const { getRanking } = require('../database/database');
const { readWeeklyRemovalData, getNextRemovalDate } = require('../database/weeklyRemoval');
const { createRankingEmbed } = require('../messages/embeds');
const { ERROR_MESSAGES } = require('../messages/messages');
const config = require('../config/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punishment')
        .setDescription('Wyświetl ranking punktów karnych')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Kategoria rankingu')
                .setRequired(true)
                .addChoices(
                    { name: '🎮PolskiSquad⁰🎮', value: '0' },
                    { name: '⚡PolskiSquad¹⚡', value: '1' },
                    { name: '💥PolskiSquad²💥', value: '2' },
                    { name: '🔥Polski Squad🔥', value: 'main' }
                )
        ),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        const category = interaction.options.getString('category');
        const roleId = config.TARGET_ROLES[category];
        
        if (!roleId) {
            return await interaction.editReply({
                content: ERROR_MESSAGES.INVALID_CATEGORY,
                ephemeral: true
            });
        }
        
        try {
            const ranking = await getRanking(roleId, interaction.guild.id);
            
            // Pobranie daty ostatniego usuwania punktów
            const removalData = await readWeeklyRemovalData();
            let lastRemovalText = 'Brak danych';
            
            if (removalData.lastRemovalDate) {
                const lastRemovalDate = new Date(removalData.lastRemovalDate);
                lastRemovalText = lastRemovalDate.toLocaleString('pl-PL', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Warsaw'
                });
            }
            
            // Pobranie daty następnego usuwania punktów
            const nextRemovalText = await getNextRemovalDate();
            
            if (ranking.length === 0) {
                return await interaction.editReply({
                    content: `📊 Ranking jest pusty dla tej kategorii.\n\n🗓️ **Ostatnie usuwanie punktów:** ${lastRemovalText}\n⏰ **Następne usuwanie punktów:** ${nextRemovalText}`,
                });
            }
            
            const embed = createRankingEmbed(ranking, category, roleId, interaction.guild, lastRemovalText, nextRemovalText);
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Błąd /punishment:', error);
            await interaction.editReply({
                content: ERROR_MESSAGES.RANKING_ERROR,
            });
        }
    }
};
