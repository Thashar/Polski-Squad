const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { delay, updateUserEphemeralReply } = require('../utils/helpers');
const { safeAddRole } = require('../services/roleService');
const { finishOtherPurposeRecruitment, sendPendingQualification } = require('../services/qualificationService');

async function handleInteraction(interaction, sharedState, config, client) {
    if (!interaction.isButton()) return;
    
    const userId = interaction.user.id;
    console.log(`[INTERACTION] Otrzymano interakcję ${interaction.customId} od ${interaction.user.username}`);
    
    try {
        await delay(1000);
        
        if (interaction.customId.startsWith('nickname_')) {
            await handleNicknameInteraction(interaction, sharedState, client);
            return;
        }
        
        switch (interaction.customId) {
            case 'not_polish':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} wskazał że nie jest Polakiem`);
                await handleNotPolish(interaction, config);
                break;
            case 'yes_polish':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} potwierdził że jest Polakiem`);
                await handleYesPolish(interaction, sharedState, config);
                break;
            case 'looking_clan':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} szuka klanu`);
                await handleLookingClan(interaction, sharedState, config);
                break;
            case 'other_purpose':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} przyszedł w innym celu`);
                await handleOtherPurpose(interaction, sharedState, config);
                break;
        }
    } catch (error) {
        console.error(`[INTERACTION] ❌ Błąd podczas obsługi interakcji:`, error);
    }
}

async function handleNicknameInteraction(interaction, sharedState, client) {
    const { nicknameRequests, pendingQualifications, pendingOtherPurposeFinish, userEphemeralReplies } = sharedState;
    const action = interaction.customId.split('_')[1];
    const targetUserId = interaction.customId.split('_')[2];
    console.log(`[NICK] Interakcja nicku: ${action} dla użytkownika ${targetUserId}`);
    
    if (interaction.user.id !== targetUserId) {
        await updateUserEphemeralReply(targetUserId, 'Te przyciski nie są dla Ciebie!', [], userEphemeralReplies);
        return;
    }
    
    const nicknameRequest = nicknameRequests.get(targetUserId);
    if (!nicknameRequest) {
        await updateUserEphemeralReply(targetUserId, 'Ta prośba już wygasła.', [], userEphemeralReplies);
        return;
    }
    
    if (action === 'yes') {
        try {
            const guild = client.guilds.cache.get(nicknameRequest.guildId);
            const member = await guild.members.fetch(nicknameRequest.memberId);
            await member.setNickname(nicknameRequest.gameNick);
            console.log(`[NICK] ✅ Zmieniono nick użytkownika ${member.user.username} na ${nicknameRequest.gameNick}`);
            await updateUserEphemeralReply(targetUserId, `✅ Twój nick został zmieniony na: **${nicknameRequest.gameNick}**`, [], userEphemeralReplies);
        } catch (error) {
            console.error(`[NICK] ❌ Błąd podczas zmiany nicku:`, error);
            await updateUserEphemeralReply(targetUserId, '❌ Nie udało się zmienić nicku. Sprawdź uprawnienia bota.', [], userEphemeralReplies);
        }
    } else if (action === 'no') {
        console.log(`[NICK] Użytkownik ${targetUserId} odrzucił zmianę nicku`);
        await updateUserEphemeralReply(targetUserId, '✅ Rozumiem. Nick pozostaje bez zmian.', [], userEphemeralReplies);
    }
    
    // Obsługa oczekujących procesów
    const isOtherPending = pendingOtherPurposeFinish.get(targetUserId);
    if (isOtherPending) {
        const targetUser = client.users.cache.get(targetUserId);
        if (targetUser) {
            await finishOtherPurposeRecruitment(targetUser, sharedState);
        }
    }
    
    const pendingData = pendingQualifications.get(targetUserId);
    if (pendingData) {
        await sendPendingQualification(targetUserId, pendingData, sharedState);
    }
    
    nicknameRequests.delete(targetUserId);
}

async function handleNotPolish(interaction, config) {
    const member = interaction.member;
    console.log(`[NOT_POLISH] Obsługuję użytkownika ${interaction.user.username} jako nie-Polaka`);
    
    await safeAddRole(member, config.roles.notPolish);
    
    try {
        await interaction.user.send(config.messages.notPolishDM);
        console.log(`[NOT_POLISH] ✅ Wysłano DM do ${interaction.user.username}`);
    } catch (error) {
        console.log(`[NOT_POLISH] ❌ Nie udało się wysłać DM do ${interaction.user.username}`);
    }
    
    await interaction.reply({
        content: 'Otrzymałeś odpowiednią rolę i wiadomość prywatną.',
        ephemeral: true
    });
}

async function handleYesPolish(interaction, sharedState, config) {
    console.log(`[YES_POLISH] Inicjalizuję dane dla ${interaction.user.username}`);
    
    sharedState.userInfo.set(interaction.user.id, {
        username: interaction.user.username,
        isPolish: true,
        purpose: null,
        rcAmount: null,
        lunarLevel: null,
        lunarPoints: null,
        characterAttack: null,
        playerNick: null
    });
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('looking_clan')
                .setLabel('Szukam klanu')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Peperednice:1341085025306808400>'),
            new ButtonBuilder()
                .setCustomId('other_purpose')
                .setLabel('Przyszedłem w innym celu...')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:PepeWelcome:1185134579967852605>')
        );
    
    await interaction.reply({
        content: config.messages.purposeQuestion,
        components: [row],
        ephemeral: true
    });
    
    sharedState.userEphemeralReplies.set(interaction.user.id, interaction);
    console.log(`[YES_POLISH] ✅ Zapisano ephemeral reply dla ${interaction.user.username}`);
}

async function handleLookingClan(interaction, sharedState, config) {
    console.log(`[LOOKING_CLAN] Użytkownik ${interaction.user.username} szuka klanu`);
    
    const info = sharedState.userInfo.get(interaction.user.id);
    if (info) {
        info.purpose = 'Szukam klanu';
        sharedState.userInfo.set(interaction.user.id, info);
    }
    
    sharedState.userStates.set(interaction.user.id, { step: 'waiting_rc' });
    console.log(`[LOOKING_CLAN] Ustawiono stan waiting_rc dla ${interaction.user.username}`);
    
    await updateUserEphemeralReply(interaction.user.id, config.messages.rcQuestion, [], sharedState.userEphemeralReplies);
}

async function handleOtherPurpose(interaction, sharedState, config) {
    console.log(`[OTHER_PURPOSE] Użytkownik ${interaction.user.username} przyszedł w innym celu`);
    
    const info = sharedState.userInfo.get(interaction.user.id);
    if (info) {
        info.purpose = 'Przyszedłem w innym celu';
        sharedState.userInfo.set(interaction.user.id, info);
    }
    
    sharedState.userStates.set(interaction.user.id, { step: 'waiting_image' });
    console.log(`[OTHER_PURPOSE] Ustawiono stan waiting_image dla ${interaction.user.username}`);
    
    await updateUserEphemeralReply(interaction.user.id, config.messages.otherPurposeMessage, [], sharedState.userEphemeralReplies);
}

module.exports = {
    handleInteraction
};
