const { SlashCommandBuilder } = require('discord.js');
const { hasPermission } = require('../utils/helpers');
const { analyzeImage } = require('../utils/ocr');
const { getAllTargetRoleMembers } = require('../utils/roleManager');
const { findMatchingMembers } = require('../utils/matching');
const { addPoints } = require('../database/database');
const { createAnalysisEmbed } = require('../messages/embeds');
const { ERROR_MESSAGES } = require('../messages/messages');
const config = require('../config/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punish')
        .setDescription('Analizuj zdjęcie i znajdź graczy z wynikiem 0')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Zdjęcie do analizy')
                .setRequired(true)
        ),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        if (!hasPermission(interaction.member)) {
            return await interaction.editReply({
                content: ERROR_MESSAGES.NO_PERMISSION,
                ephemeral: true
            });
        }
        
        const attachment = interaction.options.getAttachment('image');
        
        if (!attachment || !attachment.contentType?.startsWith('image/')) {
            return await interaction.editReply({
                content: ERROR_MESSAGES.INVALID_IMAGE,
                ephemeral: true
            });
        }
        
        try {
            const zeroScorePlayers = await analyzeImage(attachment.url);
            
            if (zeroScorePlayers.length === 0) {
                return await interaction.editReply({
                    content: '📷 Przeanalizowano zdjęcie, ale nie znaleziono graczy z wynikiem 0.',
                });
            }
            
            const targetMembers = await getAllTargetRoleMembers(interaction.guild);
            
            if (targetMembers.length === 0) {
                return await interaction.editReply({
                    content: '❌ Nie znaleziono członków na serwerze!',
                });
            }
            
            const matches = findMatchingMembers(zeroScorePlayers, targetMembers);
            
            if (matches.length === 0) {
                return await interaction.editReply({
                    content: `📷 Znaleziono ${zeroScorePlayers.length} graczy z wynikiem 0: \`${zeroScorePlayers.join(', ')}\`\n❌ Ale nie udało się dopasować żadnego z nich do członków.`,
                });
            }
            
            let addedPoints = 0;
            const processedUsers = [];
            
            for (const match of matches) {
                try {
                    const newPoints = await addPoints(
                        match.discordMember.id,
                        match.discordMember.displayName,
                        match.memberRole,
                        interaction.guild.id
                    );
                    
                    let roleDisplayName = match.memberRoleKey;
                    if (roleDisplayName === 'main') {
                        roleDisplayName = 'główna';
                    }
                    
                    const roleEmoji = newPoints >= 3 ? '🎭' : '✅';
                    const warningEmoji = (newPoints === 3 || newPoints === 5) ? '📢' : '';
                    processedUsers.push(`${roleEmoji}${warningEmoji} ${match.discordMember.displayName} (${match.foundName}) - ${newPoints} pkt [${match.similarity}%] [${roleDisplayName}]`);
                    addedPoints++;
                } catch (error) {
                    console.error(`❌ Błąd podczas dodawania punktów dla ${match.discordMember.displayName}:`, error);
                }
            }
            
            const embed = createAnalysisEmbed(zeroScorePlayers, processedUsers, addedPoints, targetMembers, attachment, interaction.user);
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Błąd /punish:', error);
            await interaction.editReply({
                content: ERROR_MESSAGES.OCR_ERROR,
            });
        }
    }
};
