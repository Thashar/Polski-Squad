const { SlashCommandBuilder } = require('discord.js');
const { hasPermission } = require('../utils/helpers');
const { modifyPoints, removeUser } = require('../database/database');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../messages/messages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('points')
        .setDescription('Dodaj lub odejmij punkty użytkownikowi')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Użytkownik')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Liczba punktów (dodatnia = dodaj, ujemna = odejmij, puste = usuń użytkownika)')
                .setRequired(false)
                .setMinValue(-20)
                .setMaxValue(20)
        ),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        if (!hasPermission(interaction.member)) {
            return await interaction.editReply({
                content: ERROR_MESSAGES.NO_PERMISSION,
                ephemeral: true
            });
        }
        
        const targetUser = interaction.options.getUser('user');
        const pointsAmount = interaction.options.getInteger('amount');
        
        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const displayName = targetMember ? targetMember.displayName : targetUser.username;
            
            if (pointsAmount !== null) {
                const result = await modifyPoints(targetUser.id, pointsAmount, interaction.guild.id);
                
                if (result.success) {
                    let actionText = '';
                    if (result.action === 'added') {
                        actionText = `dodano ${result.addedPoints} punktów`;
                    } else if (result.action === 'removed') {
                        actionText = `odjęto ${result.removedPoints} punktów`;
                    }
                    
                    await interaction.editReply({
                        content: `✅ Pomyślnie ${actionText} użytkownikowi **${displayName}**. Nowy stan: ${result.newPoints} punktów.`,
                    });
                } else {
                    await interaction.editReply({
                        content: `❌ ${result.message}`,
                    });
                }
            } else {
                const result = await removeUser(targetUser.id, interaction.guild.id);
                
                if (result.success) {
                    let roleMessage = '';
                    if (result.roleAction !== 'no_change') {
                        roleMessage = ` ${result.roleMessage}`;
                    }
                    
                    await interaction.editReply({
                        content: `✅ Użytkownik **${displayName}** został całkowicie usunięty z rankingu.${roleMessage}`,
                    });
                } else {
                    await interaction.editReply({
                        content: `❌ Użytkownik **${displayName}** nie znajdował się w rankingu.`,
                    });
                }
            }
            
        } catch (error) {
            console.error('❌ Błąd /points:', error);
            await interaction.editReply({
                content: ERROR_MESSAGES.POINTS_ERROR,
            });
        }
    }
};
