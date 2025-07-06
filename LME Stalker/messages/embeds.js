const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');

/**
 * Embed dla wyników analizy OCR
 */
function createAnalysisEmbed(zeroScorePlayers, processedUsers, addedPoints, targetMembers, attachment, user) {
    const embed = new EmbedBuilder()
        .setTitle('📊 Analiza Zakończona')
        .setColor('#ff6b6b')
        .addFields(
            { name: '📷 Znaleziono graczy z wynikiem 0', value: `\`${zeroScorePlayers.join(', ')}\``, inline: false },
            { name: '✅ Dopasowano i dodano punkty', value: processedUsers.length > 0 ? processedUsers.join('\n') : 'Brak', inline: false },
            { name: '📈 Dodano punktów', value: addedPoints.toString(), inline: true },
            { name: '👥 Przeszukano członków', value: `${targetMembers.length}`, inline: true },
            { name: '🎭 Rola karania', value: `<@&${config.PUNISHMENT_ROLE_ID}>`, inline: true }
        )
        .setImage(attachment.url)
        .setTimestamp()
        .setFooter({ text: `Przeanalizowano przez ${user.tag} | 🎭 = rola karania | 📢 = ostrzeżenie wysłane` });
    
    return embed;
}

/**
 * Embed dla rankingu punktów karnych
 */
function createRankingEmbed(ranking, category, roleId, guild, lastRemovalText, nextRemovalText) {
    const role = guild.roles.cache.get(roleId);
    const roleName = role ? role.name : `ID: ${roleId}`;
    
    const rankingText = ranking.map((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
        return `${medal} **${index + 1}.** ${user.username} - ${user.points} pkt`;
    }).join('\n');
    
    const warningChannelId = config.WARNING_CHANNELS[roleId];
    const warningChannelText = warningChannelId ? `<#${warningChannelId}>` : 'Brak';
    
    const embed = new EmbedBuilder()
        .setTitle(`📊 Ranking Punktów Karnych`)
        .setDescription(`**Kategoria:** ${roleName}\n\n${rankingText}`)
        .setColor('#ff6b6b')
        .addFields(
            { name: '🗓️ Ostatnie usuwanie punktów', value: lastRemovalText, inline: false },
            { name: '⏰ Następne usuwanie punktów', value: nextRemovalText, inline: false },
            { name: '🎭 Rola karania', value: `<@&${config.PUNISHMENT_ROLE_ID}>`, inline: false },
            { name: '📢 Kanał ostrzeżeń', value: warningChannelText, inline: false },
            { name: '⚖️ Zasady', value: '3+ punktów = rola karania\n< 3 punktów = brak roli\nOstrzeżenia: 3 i 5 punktów', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `Kategoria: ${category} | Punkty usuwane co tydzień w poniedziałek o północy` });
    
    return embed;
}

module.exports = {
    createAnalysisEmbed,
    createRankingEmbed
};
