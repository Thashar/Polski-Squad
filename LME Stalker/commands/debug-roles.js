const { SlashCommandBuilder } = require('discord.js');
const { getMembersOfRole } = require('../utils/roleManager');
const { readWeeklyRemovalData, getNextRemovalDate } = require('../database/weeklyRemoval');
const { ERROR_MESSAGES } = require('../messages/messages');
const config = require('../config/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug-roles')
        .setDescription('Debugowanie ról na serwerze')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Kategoria do sprawdzenia')
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
        
        try {
            const guild = interaction.guild;
            const category = interaction.options.getString('category');
            
            await guild.members.fetch();
            
            let debugInfo = `🔧 **Sprawdzenie członków klanów dla serwera ${guild.name}**\n\n`;
            debugInfo += `👥 **Członków w cache:** ${guild.members.cache.size}\n`;
            debugInfo += `🎭 **Ról na serwerze:** ${guild.roles.cache.size}\n`;
            debugInfo += `🎭 **Rola karania:** <@&${config.PUNISHMENT_ROLE_ID}>\n\n`;
            
            // Informacje o kanałach ostrzeżeń
            debugInfo += `📢 **Kanały ostrzeżeń:**\n`;
            for (const [roleId, channelId] of Object.entries(config.WARNING_CHANNELS)) {
                const roleKey = Object.keys(config.TARGET_ROLES).find(key => config.TARGET_ROLES[key] === roleId);
                const roleName = config.ROLE_DISPLAY_NAMES[roleKey] || roleId;
                debugInfo += `🎭 ${roleName}: <#${channelId}>\n`;
            }
            debugInfo += '\n';
            
            debugInfo += `🔍 **Wzorce wykrywania zera:**\n`;
            debugInfo += `✅ Standardowe: 0, 0.0, 0,0\n`;
            debugInfo += `✅ Nawiasy: (1), [1], [1, (1\n`;
            debugInfo += `✅ Litera "o"\n`;
            debugInfo += `✅ **NOWE: "zo" (case-insensitive)**\n\n`;
            
            // Pobranie daty ostatniego usuwania punktów
            const removalData = await readWeeklyRemovalData();
            let lastRemovalText = 'Brak danych';
            
            if (removalData.lastRemovalDate) {
                const lastRemovalDate = new Date(removalData.lastRemovalDate);
                lastRemovalText = lastRemovalDate.toLocaleString('pl-PL', {
                    timeZone: 'Europe/Warsaw'
                });
            }
            
            // Pobranie daty następnego usuwania punktów
            const nextRemovalText = await getNextRemovalDate();
            
            debugInfo += `🗓️ **Ostatnie usywanie punktów:** ${lastRemovalText}\n`;
            debugInfo += `⏰ **Następne usuwanie punktów:** ${nextRemovalText}\n\n`;
            
            const roleMembers = await getMembersOfRole(guild, category);
            const roleDisplayName = config.ROLE_DISPLAY_NAMES[category] || category;
            
            debugInfo += `📊 **Statystyki według ról:**\n`;
            debugInfo += `🎭 ${roleDisplayName}: ${roleMembers.length} członków\n\n`;
            
            if (roleMembers.length > 0) {
                debugInfo += `👥 **Wszyscy członkowie roli ${roleDisplayName}:**\n`;
                roleMembers.forEach((memberData, index) => {
                    const hasPunishmentRole = memberData.member.roles.cache.has(config.PUNISHMENT_ROLE_ID);
                    const punishmentEmoji = hasPunishmentRole ? '🎭' : '✅';
                    debugInfo += `${index + 1}. ${punishmentEmoji} ${memberData.member.displayName} (${memberData.member.user.username})\n`;
                });
                debugInfo += `\n🎭 = ma rolę karania | ✅ = nie ma roli karania`;
            } else {
                debugInfo += `❌ **Brak członków w roli ${roleDisplayName}**\n`;
            }
            
            await interaction.editReply({
                content: debugInfo,
                ephemeral: true
            });
            
        } catch (error) {
            console.error('❌ Błąd debug roles:', error);
            await interaction.editReply({
                content: ERROR_MESSAGES.DEBUG_ERROR,
                ephemeral: true
            });
        }
    }
};
