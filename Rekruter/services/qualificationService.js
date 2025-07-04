const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { roleService } = require('./roleService');
const fs = require('fs').promises;
const { updateUserEphemeralReply } = require('../utils/helpers');

async function sendPendingQualification(userId, qualificationData, sharedState) {
    try {
        console.log(`[QUALIFICATION] Wysyłanie odroczonej kwalifikacji dla użytkownika ${userId}`);
        const { member, attack, user, stats, config, client } = qualificationData;
        
        const { assignClanRole } = require('./roleService');
        const targetChannelId = await assignClanRole(member, attack, user, config, client);
        
        if (targetChannelId) {
            await sendUserSummary(user, targetChannelId, sharedState, config);
        }
        
        sharedState.pendingQualifications.delete(userId);
        console.log(`[QUALIFICATION] ✅ Zakończono odroczoną kwalifikację dla użytkownika ${userId}`);
    } catch (error) {
        console.error(`[QUALIFICATION] ❌ Błąd podczas wysyłania odroczonej kwalifikacji:`, error);
    }
}

async function finishOtherPurposeRecruitment(user, sharedState) {
    try {
        console.log(`[OTHER_PURPOSE] Finalizacja rekrutacji "inne cele" dla ${user.username}`);
        
        const { safeAddRole } = require('./roleService');
        const guild = Object.values(sharedState.client.guilds.cache)[0];
        const member = await guild.members.fetch(user.id);
        
        await safeAddRole(member, sharedState.config.roles.verified);
        await updateUserEphemeralReply(user.id, '✅ Proces rekrutacji zakończony pomyślnie! Witamy na serwerze!', [], sharedState.userEphemeralReplies);
        await sendWelcomeMessageWithSummary(user, sharedState);
        
        setTimeout(() => {
            sharedState.userEphemeralReplies.delete(user.id);
        }, 5000);
        
        sharedState.userStates.delete(user.id);
        sharedState.pendingOtherPurposeFinish.delete(user.id);
        
        console.log(`[OTHER_PURPOSE] ✅ Zakończono rekrutację "inne cele" dla ${user.username}`);
    } catch (error) {
        console.error(`[OTHER_PURPOSE] ❌ Błąd podczas finalizacji rekrutacji "inne cele":`, error);
    }
}

async function sendWelcomeMessageWithSummary(user, sharedState) {
    console.log(`[WELCOME] Wysyłanie wiadomości powitalnej dla ${user.username}`);
    
    const welcomeChannel = sharedState.client.channels.cache.get(sharedState.config.channels.welcome);
    if (!welcomeChannel) {
        console.error(`[WELCOME] ❌ Nie znaleziono kanału powitalnego`);
        return;
    }
    
    try {
        await welcomeChannel.send(`${user} ${sharedState.config.messages.generalWelcome}`);
        await sendUserSummaryToWelcome(user, sharedState.config.channels.welcome, sharedState);
        console.log(`[WELCOME] ✅ Wysłano wiadomość powitalną dla ${user.username}`);
    } catch (error) {
        console.error(`[WELCOME] ❌ Błąd podczas wysyłania wiadomości powitalnej:`, error);
    }
}

async function sendUserSummaryToWelcome(user, channelId, sharedState) {
    console.log(`[SUMMARY] Wysyłanie podsumowania dla ${user.username} na kanał ${channelId}`);
    
    const info = sharedState.userInfo.get(user.id);
    if (!info) {
        console.log(`[SUMMARY] ❌ Brak danych użytkownika ${user.username}`);
        return;
    }
    
    const channel = sharedState.client.channels.cache.get(channelId);
    if (!channel) {
        console.log(`[SUMMARY] ❌ Nie znaleziono kanału ${channelId}`);
        return;
    }
    
    let summaryText = '';
    summaryText += ` **Użytkownik Discord:** ${info.username}\n`;
    
    if (info.playerNick) {
        summaryText += `<:J_SurvivorJoey:1326511743555600451> **Nick w grze:** ${info.playerNick}\n`;
    }
    
    if (info.characterAttack !== null) {
        summaryText += `<:L_ATK:1209754263228522516> **Atak postaci:** ${info.characterAttack.toLocaleString()}\n`;
    }
    
    if (info.rcAmount !== null) {
        summaryText += `<:I_RC:1385139885924421653> **Ilość RC:** ${info.rcAmount}\n`;
    }
    
    if (info.lunarLevel !== null) {
        summaryText += `<:I_LVL:1389178270888759296> **Lunar Mine - Poziom:** ${info.lunarLevel}\n`;
    }
    
    if (info.lunarPoints !== null) {
        summaryText += `<:M_Medal:1209754405373747260> **Lunar Mine - Punkty I fazy:** ${info.lunarPoints.toLocaleString()}\n`;
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 Podsumowanie')
        .setDescription(summaryText)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Analiza zakończona' });
    
    const messageOptions = { embeds: [embed] };
    const userImagePath = sharedState.userImages.get(user.id);
    
    if (userImagePath) {
        try {
            await fs.access(userImagePath);
            const attachment = new AttachmentBuilder(userImagePath, {
                name: `stats_${user.id}.png`,
                description: 'Zdjęcie statystyk użytkownika'
            });
            messageOptions.files = [attachment];
            embed.setImage(`attachment://stats_${user.id}.png`);
            console.log(`[SUMMARY] ✅ Dołączono obraz do podsumowania`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się dołączyć obrazu`);
        }
    }
    
    await channel.send(messageOptions);
    console.log(`[SUMMARY] ✅ Wysłano podsumowanie dla ${user.username}`);
    
    sharedState.userInfo.delete(user.id);
    
    if (userImagePath) {
        try {
            await fs.unlink(userImagePath);
            sharedState.userImages.delete(user.id);
            console.log(`[SUMMARY] ✅ Usunięto tymczasowy obraz`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się usunąć tymczasowego obrazu`);
        }
    }
}

async function sendUserSummary(user, channelId, sharedState, config) {
    console.log(`[SUMMARY] Wysyłanie podsumowania dla ${user.username} na kanał klanu ${channelId}`);
    
    const info = sharedState.userInfo.get(user.id);
    if (!info) {
        console.log(`[SUMMARY] ❌ Brak danych użytkownika ${user.username}`);
        return;
    }
    
    const channel = sharedState.client.channels.cache.get(channelId);
    if (!channel) {
        console.log(`[SUMMARY] ❌ Nie znaleziono kanału ${channelId}`);
        return;
    }
    
    let summaryText = '';
    summaryText += ` **Użytkownik Discord:** ${info.username}\n`;
    
    if (info.playerNick) {
        summaryText += `<:J_SurvivorJoey:1326511743555600451> **Nick w grze:** ${info.playerNick}\n`;
    }
    
    if (info.characterAttack !== null) {
        summaryText += `<:L_ATK:1209754263228522516> **Atak postaci:** ${info.characterAttack.toLocaleString()}\n`;
    }
    
    if (info.rcAmount !== null) {
        summaryText += `<:I_RC:1385139885924421653> **Ilość RC:** ${info.rcAmount}\n`;
    }
    
    if (info.lunarLevel !== null) {
        summaryText += `<:I_LVL:1389178270888759296> **Lunar Mine - Poziom:** ${info.lunarLevel}\n`;
    }
    
    if (info.lunarPoints !== null) {
        summaryText += `<:M_Medal:1209754405373747260> **Lunar Mine - Punkty I fazy:** ${info.lunarPoints.toLocaleString()}\n`;
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 Podsumowanie')
        .setDescription(summaryText)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Analiza zakończona' });
    
    const messageOptions = { embeds: [embed] };
    const userImagePath = sharedState.userImages.get(user.id);
    
    if (userImagePath) {
        try {
            await fs.access(userImagePath);
            const attachment = new AttachmentBuilder(userImagePath, {
                name: `stats_${user.id}.png`,
                description: 'Zdjęcie statystyk użytkownika'
            });
            messageOptions.files = [attachment];
            embed.setImage(`attachment://stats_${user.id}.png`);
            console.log(`[SUMMARY] ✅ Dołączono obraz do podsumowania klanu`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się dołączyć obrazu do podsumowania klanu`);
        }
    }
    
    await channel.send(messageOptions);
    console.log(`[SUMMARY] ✅ Wysłano podsumowanie klanu dla ${user.username}`);
    
    sharedState.userInfo.delete(user.id);
    
    if (userImagePath) {
        try {
            await fs.unlink(userImagePath);
            sharedState.userImages.delete(user.id);
            console.log(`[SUMMARY] ✅ Usunięto tymczasowy obraz po podsumowaniu klanu`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się usunąć tymczasowego obrazu po podsumowaniu klanu`);
        }
    }
}

module.exports = {
    sendPendingQualification,
    finishOtherPurposeRecruitment,
    sendWelcomeMessageWithSummary,
    sendUserSummaryToWelcome,
    sendUserSummary
};
