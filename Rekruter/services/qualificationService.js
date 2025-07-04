const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const { updateUserEphemeralReply } = require('../utils/helpers');
const { safeAddRole } = require('./roleService');

/* -------------------------------------------------------------------------- */
/* 1.  ODKŁADANA KWALIFIKACJA DO KLANU                                        */
/* -------------------------------------------------------------------------- */
async function sendPendingQualification(userId, data, state) {
  try {
    const { member, attack, user, config, client } = data;
    const { assignClanRole } = require('./roleService');

    const targetChannelId = await assignClanRole(
      member,
      attack,
      user,
      config,
      client
    );

    if (targetChannelId) {
      await sendUserSummary(user, targetChannelId, state, config);
    }
    state.pendingQualifications.delete(userId);
  } catch (err) {
    console.error('[QUALIFICATION] ❌ Błąd kwalifikacji:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* 2.  FINISH OTHER PURPOSE  – nowy parametr `member`                         */
/* -------------------------------------------------------------------------- */
async function finishOtherPurposeRecruitment(member, state) {
  const { user } = member;
  try {
    await safeAddRole(member, state.config.roles.verified);

    await updateUserEphemeralReply(
      user.id,
      '✅ Proces rekrutacji zakończony pomyślnie! Witamy na serwerze!',
      [],
      state.userEphemeralReplies
    );

    await sendWelcomeMessageWithSummary(user, state);

    setTimeout(
      () => state.userEphemeralReplies.delete(user.id),
      5_000
    );

    state.userStates.delete(user.id);
    state.pendingOtherPurposeFinish.delete(user.id);
    console.log(`[OTHER_PURPOSE] ✅ Zakończono rekrutację dla ${user.username}`);
  } catch (err) {
    console.error('[OTHER_PURPOSE] ❌ Błąd finalizacji:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* 3.  WIADOMOŚĆ POWITALNA I PODSUMOWANIA                                     */
/* -------------------------------------------------------------------------- */
async function sendWelcomeMessageWithSummary(user, state) {
  const welcomeChannel = state.client.channels.cache.get(
    state.config.channels.welcome
  );
  if (!welcomeChannel) return;

  await welcomeChannel.send(
    `${user} ${state.config.messages.generalWelcome}`
  );
  await sendUserSummaryToWelcome(user, welcomeChannel.id, state);
}

async function sendUserSummaryToWelcome(user, channelId, state) {
  await sendUserSummary(user, channelId, state, state.config);
}

/* -------------------------------------------------------------------------- */
/* 4.  PODSUMOWANIE UŻYTKOWNIKA                                               */
/* -------------------------------------------------------------------------- */
async function sendUserSummary(user, channelId, state, config) {
  const info = state.userInfo.get(user.id);
  if (!info) return;

  const channel = state.client.channels.cache.get(channelId);
  if (!channel) return;

  let txt = ` **Użytkownik Discord:** ${info.username}\n`;
  if (info.playerNick)      txt += `<:J_SurvivorJoey:1326511743555600451> **Nick w grze:** ${info.playerNick}\n`;
  if (info.characterAttack) txt += `<:L_ATK:1209754263228522516> **Atak postaci:** ${info.characterAttack.toLocaleString()}\n`;
  if (info.rcAmount != null)txt += `<:I_RC:1385139885924421653> **Ilość RC:** ${info.rcAmount}\n`;
  if (info.lunarLevel != null)txt += `<:I_LVL:1389178270888759296> **Lunar Mine – Poziom:** ${info.lunarLevel}\n`;
  if (info.lunarPoints!= null)txt += `<:M_Medal:1209754405373747260> **Lunar Mine – Punkty I fazy:** ${info.lunarPoints.toLocaleString()}\n`;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('📊 Podsumowanie')
    .setDescription(txt)
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  const msg = { embeds: [embed] };
  const imgPath = state.userImages.get(user.id);

  if (imgPath) {
    try {
      await fs.access(imgPath);
      const att = new AttachmentBuilder(imgPath, {
        name: `stats_${user.id}.png`
      });
      msg.files = [att];
      embed.setImage(`attachment://stats_${user.id}.png`);
    } catch {/* pomijamy */}
  }

  await channel.send(msg);
  state.userInfo.delete(user.id);
  if (imgPath) {
    try { await fs.unlink(imgPath); } catch {/* pomijamy */}
    state.userImages.delete(user.id);
  }
}

module.exports = {
  sendPendingQualification,
  finishOtherPurposeRecruitment
};
