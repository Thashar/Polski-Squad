const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { delay, updateUserEphemeralReply } = require('../utils/helpers');

function normalizeNickname(nick) {
  return nick.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
}
function areNicknamesSimilar(dNick, gNick) {
  const a = normalizeNickname(dNick);
  const b = normalizeNickname(gNick);
  return a === b || a.includes(b) || b.includes(a);
}

async function proposeNicknameChange(
  user,
  gameNick,
  member,
  pendingData,
  state,
  isOtherPurpose = false
) {
  const { nicknameRequests, pendingQualifications,
          pendingOtherPurposeFinish, userEphemeralReplies } = state;

  if (areNicknamesSimilar(member.displayName, gameNick)) {
    if (isOtherPurpose) {
      const { finishOtherPurposeRecruitment } = require('./qualificationService');
      await finishOtherPurposeRecruitment(member, state);
    } else if (pendingData) {
      const { sendPendingQualification } = require('./qualificationService');
      await sendPendingQualification(user.id, pendingData, state);
    }
    return;
  }

  if (!userEphemeralReplies.has(user.id)) {
    if (isOtherPurpose) {
      const { finishOtherPurposeRecruitment } = require('./qualificationService');
      await finishOtherPurposeRecruitment(member, state);
    } else if (pendingData) {
      const { sendPendingQualification } = require('./qualificationService');
      await sendPendingQualification(user.id, pendingData, state);
    }
    return;
  }

  if (pendingData && !isOtherPurpose) {
    pendingQualifications.set(user.id, pendingData);
  }
  if (isOtherPurpose) pendingOtherPurposeFinish.set(user.id, true);

  await delay(1000);

  const row = new ActionRowBuilder().addComponents(
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
    gameNick,
    memberId: member.id,
    guildId: member.guild.id
  });

  await updateUserEphemeralReply(
    user.id,
    `Zauważyliśmy różnicę między Twoim nickiem na Discordzie, a nickiem w grze.\n` +
    `Wykryty nick w grze: **${gameNick}**\nCzy chcesz, aby bot zmienił Twój nick?`,
    [row],
    userEphemeralReplies
  );
}

module.exports = { proposeNicknameChange };
