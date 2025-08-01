/**
 * Obsługa wszystkich interakcji przycisków.
 * -------------------------------------------------
 *  • przyciski 🇵🇱 / 🇬🇧 (start rekrutacji)
 *  • przyciski wyboru ścieżki
 *  • przyciski propozycji zmiany nicku
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { delay, updateUserEphemeralReply } = require('../utils/helpers');
const { safeAddRole } = require('../services/roleService');
const {
  finishOtherPurposeRecruitment,
  sendPendingQualification
} = require('../services/qualificationService');

/* -------------------------------------------------------------------------- */
/*  GŁÓWNA FUNKCJA EKSPORTOWANA                                               */
/* -------------------------------------------------------------------------- */
async function handleInteraction(interaction, state, config, client) {
  // Obsługa slash commands
  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case 'ocr-debug':
        await handleOcrDebugCommand(interaction, config);
        return;
      default:
        await interaction.reply({ content: 'Nieznana komenda!', ephemeral: true });
        return;
    }
  }
  
  if (!interaction.isButton()) return;

  await delay(1_000);                                          // drobny „debounce”

  /* ---------------------------------------------------------------------- */
  /* 1.  Przyciski zmiany nicku                                              */
  /* ---------------------------------------------------------------------- */
  if (interaction.customId.startsWith('nickname_')) {
    await handleNicknameButtons(interaction, state, client);
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* 2.  Pozostałe przyciski                                                 */
  /* ---------------------------------------------------------------------- */
  switch (interaction.customId) {
    /* ──────────────── użytkownik NIE jest Polakiem ────────────────────── */
    case 'not_polish':
      await handleNotPolish(interaction, config);
      break;

    /* ──────────────── użytkownik JEST Polakiem ─────────────────────────── */
    case 'yes_polish':
      await handleYesPolish(interaction, state, config);
      break;

    /* ──────────────── ścieżka „Szukam klanu” ───────────────────────────── */
    case 'looking_clan':
      await handleLookingClan(interaction, state, config);
      break;

    /* ──────────────── ścieżka „Inny cel” ───────────────────────────────── */
    case 'other_purpose':
      await handleOtherPurpose(interaction, state, config);
      break;
  }
}

/* ========================================================================== */
/*                     ---------------  HELPERS ---------------               */
/* ========================================================================== */

/* ----------------------------- przyciski nicku ---------------------------- */
async function handleNicknameButtons(interaction, state, client) {
  const {
    nicknameRequests,
    pendingQualifications,
    pendingOtherPurposeFinish,
    userEphemeralReplies
  } = state;

  const [, action, targetId] = interaction.customId.split('_');

  if (interaction.user.id !== targetId) {
    await updateUserEphemeralReply(
      targetId,
      'Te przyciski nie są dla Ciebie!',
      [],
      userEphemeralReplies
    );
    return;
  }

  const req = nicknameRequests.get(targetId);
  if (!req) {
    await updateUserEphemeralReply(
      targetId,
      'Ta prośba już wygasła.',
      [],
      userEphemeralReplies
    );
    return;
  }

  /* -------------------- akceptacja / odrzucenie ------------------------- */
  const guild  = client.guilds.cache.get(req.guildId);
  const member = guild ? await guild.members.fetch(req.memberId) : null;

  if (member && action === 'yes') {
    try {
      await member.setNickname(req.gameNick);
      await updateUserEphemeralReply(
        targetId,
        `✅ Twój nick został zmieniony na: **${req.gameNick}**`,
        [],
        userEphemeralReplies
      );
    } catch {
      await updateUserEphemeralReply(
        targetId,
        '❌ Nie udało się zmienić nicku. Sprawdź uprawnienia bota.',
        [],
        userEphemeralReplies
      );
    }
  } else if (action === 'no') {
    await updateUserEphemeralReply(
      targetId,
      '✅ Rozumiem. Nick pozostaje bez zmian.',
      [],
      userEphemeralReplies
    );
  }

  /* ---------------- kontynuacja procesu rekrutacji ---------------------- */
  if (pendingOtherPurposeFinish.get(targetId) && member) {
    await finishOtherPurposeRecruitment(member, state);
  } else if (pendingQualifications.has(targetId)) {
    await sendPendingQualification(
      targetId,
      pendingQualifications.get(targetId),
      state
    );
  }

  nicknameRequests.delete(targetId);
}

/* --------------------------- przycisk „Nie jestem Polakiem” -------------- */
async function handleNotPolish(interaction, config) {
  await safeAddRole(interaction.member, config.roles.notPolish);

  try { await interaction.user.send(config.messages.notPolishDM); } catch {/* DM wyłączone */}

  await interaction.reply({ content: 'Rolę nadano.', ephemeral: true });
}

/* --------------------------- przycisk „Jestem Polakiem” ------------------ */
async function handleYesPolish(interaction, state, config) {
  state.userInfo.set(interaction.user.id, {
    username:        interaction.user.username,
    isPolish:        true,
    purpose:         null,
    rcAmount:        null,
    lunarLevel:      null,
    lunarPoints:     null,
    characterAttack: null,
    playerNick:      null
  });

  const row = new ActionRowBuilder().addComponents(
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
    content:    config.messages.purposeQuestion,
    components: [row],
    ephemeral:  true
  });

  state.userEphemeralReplies.set(interaction.user.id, interaction);
}

/* --------------------------- ścieżka „Szukam klanu” ---------------------- */
async function handleLookingClan(interaction, state, config) {
  state.userInfo.get(interaction.user.id).purpose = 'Szukam klanu';
  state.userStates.set(interaction.user.id, { step: 'waiting_rc' });

  await updateUserEphemeralReply(
    interaction.user.id,
    config.messages.rcQuestion,
    [],
    state.userEphemeralReplies
  );
}

/* --------------------------- ścieżka „Inny cel” -------------------------- */
async function handleOtherPurpose(interaction, state, config) {
  state.userInfo.get(interaction.user.id).purpose = 'Przyszedłem w innym celu';
  state.userStates.set(interaction.user.id, { step: 'waiting_image' });

  await updateUserEphemeralReply(
    interaction.user.id,
    config.messages.otherPurposeMessage,
    [],
    state.userEphemeralReplies
  );
}

/**
 * Obsługuje komendę debug OCR
 */
async function handleOcrDebugCommand(interaction, config) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            ephemeral: true
        });
        return;
    }
    
    const enabled = interaction.options.getBoolean('enabled');
    
    if (enabled === null) {
        // Sprawdź aktualny stan
        const currentState = config.ocr.detailedLogging.enabled;
        await interaction.reply({
            content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
            ephemeral: true
        });
        return;
    }
    
    // Przełącz stan
    config.ocr.detailedLogging.enabled = enabled;
    
    const statusText = enabled ? '✅ Włączone' : '❌ Wyłączone';
    const emoji = enabled ? '🔍' : '🔇';
    
    const { createBotLogger } = require('../../utils/consoleLogger');
    const logger = createBotLogger('Rekruter');
    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);
    
    await interaction.reply({
        content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
        ephemeral: true
    });
}

/**
 * Rejestruje komendy slash
 */
async function registerSlashCommands(client, config) {
    const { SlashCommandBuilder, REST, Routes } = require('discord.js');
    const { createBotLogger } = require('../../utils/consoleLogger');
    const logger = createBotLogger('Rekruter');
    
    const commands = [
        new SlashCommandBuilder()
            .setName('ocr-debug')
            .setDescription('Przełącz szczegółowe logowanie OCR')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                    .setRequired(false))
    ];

    const rest = new REST().setToken(config.token);
    
    try {
        logger.info('[COMMANDS] 🔄 Rejestracja komend slash...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        logger.info('[COMMANDS] ✅ Komendy slash zarejestrowane pomyślnie');
    } catch (error) {
        logger.error('[COMMANDS] ❌ Błąd rejestracji komend slash:', error);
    }
}

module.exports = { handleInteraction, registerSlashCommands };
