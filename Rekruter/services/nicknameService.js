const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { delay, updateUserEphemeralReply } = require('../utils/helpers');

function normalizeNickname(nickname) {
    const normalized = nickname.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
    console.log(`[NICK] Znormalizowano nick "${nickname}" -> "${normalized}"`);
    return normalized;
}

function areNicknamesSimilar(discordNick, gameNick) {
    const normalizedDiscord = normalizeNickname(discordNick);
    const normalizedGame = normalizeNickname(gameNick);
    console.log(`[NICK] Porównywanie nicków: Discord="${normalizedDiscord}" vs Game="${normalizedGame}"`);
    
    if (normalizedDiscord === normalizedGame) {
        console.log(`[NICK] ✅ Nicki są identyczne`);
        return true;
    }
    
    if (normalizedDiscord.includes(normalizedGame) || normalizedGame.includes(normalizedDiscord)) {
        console.log(`[NICK] ✅ Nicki są podobne (jeden zawiera drugi)`);
        return true;
    }
    
    console.log(`[NICK] ❌ Nicki są różne`);
    return false;
}

async function proposeNicknameChange(user, gameNick, member, pendingData, sharedState, isOtherPurpose = false) {
    const { nicknameRequests, pendingQualifications, userEphemeralReplies, pendingOtherPurposeFinish } = sharedState;
    const discordNick = member.displayName;
    console.log(`[NICK] Propozycja zmiany nicku dla ${user.username}: "${discordNick}" -> "${gameNick}"`);
    
    if (areNicknamesSimilar(discordNick, gameNick)) {
        console.log(`[NICK] Nicki są podobne, pomijam zmianę`);
        
        if (isOtherPurpose) {
            const { finishOtherPurposeRecruitment } = require('./qualificationService');
            await finishOtherPurposeRecruitment(user, sharedState);
        } else if (pendingData) {
            const { sendPendingQualification } = require('./qualificationService');
            await sendPendingQualification(user.id, pendingData, sharedState);
        }
        return;
    }
    
    if (!userEphemeralReplies.has(user.id)) {
        console.log(`[NICK] Brak ephemeral reply dla użytkownika, pomijam propozycję`);
        
        if (isOtherPurpose) {
            const { finishOtherPurposeRecruitment } = require('./qualificationService');
            await finishOtherPurposeRecruitment(user, sharedState);
        } else if (pendingData) {
            const { sendPendingQualification } = require('./qualificationService');
            await sendPendingQualification(user.id, pendingData, sharedState);
        }
        return;
    }
    
    if (pendingData && !isOtherPurpose) {
        pendingQualifications.set(user.id, pendingData);
        console.log(`[NICK] Zapisano odroczoną kwalifikację dla ${user.username}`);
    }
    
    if (isOtherPurpose) {
        pendingOtherPurposeFinish.set(user.id, true);
        console.log(`[NICK] Zapisano oczekujące zakończenie rekrutacji "inne cele" dla ${user.username}`);
    }
    
    await delay(1000);
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`nickname_yes_${user.id}`)
                .setLabel('Tak')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`nickname_no_${user.id}`)
                .setLabel('Nie')
                .setStyle(ButtonStyle.Danger)
        );
    
    nicknameRequests.set(user.id, {
        gameNick: gameNick,
        memberId: member.id,
        guildId: member.guild.id
    });
    
    console.log(`[NICK] Wysłano propozycję zmiany nicku dla ${user.username}`);
    
    await updateUserEphemeralReply(user.id,
        `Zauważyliśmy, że posiadasz inny nick w grze niż na discordzie.\nWykryty nick w grze: **${gameNick}**\nWymagamy tu używania takiego samego nicku jak w grze, w celu lepszej komunikacji.\n\nCzy zmienić Twój nick?`,
        [row],
        userEphemeralReplies
    );
    
    setTimeout(() => {
        if (nicknameRequests.has(user.id)) {
            console.log(`[NICK] Timeout propozycji nicku dla ${user.username}`);
            nicknameRequests.delete(user.id);
            
            const pendingQualification = pendingQualifications.get(user.id);
            const isOtherPending = pendingOtherPurposeFinish.get(user.id);
            
            if (isOtherPending) {
                const { finishOtherPurposeRecruitment } = require('./qualificationService');
                finishOtherPurposeRecruitment(user, sharedState);
            } else if (pendingQualification) {
                const { sendPendingQualification } = require('./qualificationService');
                sendPendingQualification(user.id, pendingQualification, sharedState);
            }
        }
    }, 300000);
}

module.exports = {
    normalizeNickname,
    areNicknamesSimilar,
    proposeNicknameChange
};
