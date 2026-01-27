/**
 * Obsługa wiadomości w kanale rekrutacyjnym.
 * -------------------------------------------------
 *  • odbiór RC, Lunar Level, Lunar Points
 *  • odbiór obrazka (OCR + kwalifikacja)
 */

const path = require('path');
const {
  safeDeleteMessage,
  updateUserEphemeralReply
} = require('../utils/helpers');

const {
  extractOptimizedStatsFromImage,
  downloadImage,
  initializeOCR
} = require('../services/ocrService');

const AIOCRService = require('../services/aiOcrService');

const { proposeNicknameChange } = require('../services/nicknameService');
const {
  finishOtherPurposeRecruitment,
  sendPendingQualification
} = require('../services/qualificationService');

/* -------------------------------------------------------------------------- */
/*  GŁÓWNA FUNKCJA EKSPORTOWANA                                               */
/* -------------------------------------------------------------------------- */
async function handleMessage(
  message,
  state,
  config,
  client,
  RECRUIT_CHANNEL_ID
) {
  if (message.author.bot) return;

  // Lista kanałów gdzie działa komenda !nick
  const allowedChannels = [
    RECRUIT_CHANNEL_ID,
    '1262792174475673610', // STALKER_LME_WARNING_CHANNEL_0
    '1200051393843695699', // STALKER_LME_WARNING_CHANNEL_1
    '1194298890069999756', // STALKER_LME_WARNING_CHANNEL_2
    '1194299628905042040', // STALKER_LME_WARNING_CHANNEL_MAIN
    '1262793022983114792', // CLAN0_CHANNEL
    '1210265872921526303', // CLAN1_CHANNEL
    '1196808118697463870', // CLAN2_CHANNEL
    '1195086151283912745'  // MAIN_CLAN_CHANNEL
  ];

  // Komendy dostępne na wybranych kanałach
  if (allowedChannels.includes(message.channel.id)) {
    const command = message.content.trim();
    
    // Komenda !nick - zwraca PLㅣ + nick użytkownika
    if (command === '!nick') {
      const userDisplayName = message.member.displayName;
      await message.channel.send(`PLㅣ${userDisplayName}`);
      await safeDeleteMessage(message);
      return;
    }
    
    // Komenda !clan - Polski Squad główny
    if (command === '!clan') {
      await message.channel.send('Aplikuj do: Polski Squad ID: 42578');
      await safeDeleteMessage(message);
      return;
    }
    
    // Komenda !clan2 - PolskiSquad²
    if (command === '!clan2') {
      await message.channel.send('Aplikuj do: PolskiSquad² ID: 202226');
      await safeDeleteMessage(message);
      return;
    }
    
    // Komenda !clan1 - PolskiSquad¹
    if (command === '!clan1') {
      await message.channel.send('Aplikuj do: PolskiSquad¹ ID: 125634');
      await safeDeleteMessage(message);
      return;
    }
    
    // Komenda !clan0 - PolskiSquad⁰
    if (command === '!clan0') {
      await message.channel.send('Aplikuj do: PolskiSquad⁰ ID: 11616');
      await safeDeleteMessage(message);
      return;
    }
  }

  // Reszta logiki tylko dla kanału rekrutacyjnego
  if (message.channel.id !== RECRUIT_CHANNEL_ID) return;

  const step = state.userStates.get(message.author.id)?.step;

  switch (step) {
    case 'waiting_rc':
      await handleRCInput(message, state, config);
      break;

    case 'waiting_lunar_level':
      await handleLunarLevelInput(message, state, config);
      break;

    case 'waiting_lunar_points':
      await handleLunarPointsInput(message, state, config);
      break;

    case 'waiting_image':
      await handleImageInput(message, state, config, client);
      break;

    default:
      await safeDeleteMessage(message); // niepotrzebna wiadomość
  }
}

/* ========================================================================== */
/*                             POSZCZEGÓLNE KROKI                             */
/* ========================================================================== */
async function handleRCInput(msg, state, config) {
  const val = parseInt(msg.content, 10);
  await safeDeleteMessage(msg);

  if (isNaN(val) || val < 0 || val > 500) {
    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.invalidRC,
      [],
      state.userEphemeralReplies
    );
    return;
  }

  state.userInfo.get(msg.author.id).rcAmount = val;
  state.userStates.set(msg.author.id, {
    step: 'waiting_lunar_level',
    rcAmount: val
  });

  await updateUserEphemeralReply(
    msg.author.id,
    config.messages.lunarLevelQuestion,
    [],
    state.userEphemeralReplies
  );
}

async function handleLunarLevelInput(msg, state, config) {
  const lvl = parseInt(msg.content, 10);
  await safeDeleteMessage(msg);

  if (isNaN(lvl) || lvl < 1 || lvl > 16) {
    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.invalidLunarLevel,
      [],
      state.userEphemeralReplies
    );
    return;
  }

  state.userInfo.get(msg.author.id).lunarLevel = lvl;
  state.userStates.set(msg.author.id, {
    step: 'waiting_lunar_points',
    rcAmount:  state.userInfo.get(msg.author.id).rcAmount,
    lunarLevel: lvl
  });

  await updateUserEphemeralReply(
    msg.author.id,
    config.messages.lunarPointsQuestion,
    [],
    state.userEphemeralReplies
  );
}

async function handleLunarPointsInput(msg, state, config) {
  const pts = parseInt(msg.content, 10);
  await safeDeleteMessage(msg);

  if (isNaN(pts) || pts < 0 || pts > 1500) {
    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.invalidLunarPoints,
      [],
      state.userEphemeralReplies
    );
    return;
  }

  state.userInfo.get(msg.author.id).lunarPoints = pts;
  state.userStates.set(msg.author.id, {
    step:        'waiting_image',
    rcAmount:    state.userInfo.get(msg.author.id).rcAmount,
    lunarLevel:  state.userInfo.get(msg.author.id).lunarLevel,
    lunarPoints: pts
  });

  await updateUserEphemeralReply(
    msg.author.id,
    config.messages.statsQuestion,
    [],
    state.userEphemeralReplies
  );
}

async function handleImageInput(msg, state, config, client) {
  if (msg.attachments.size === 0) {
    await safeDeleteMessage(msg);
    await updateUserEphemeralReply(
      msg.author.id,
      'Musisz przesłać zdjęcie!',
      [],
      state.userEphemeralReplies
    );
    return;
  }

  const file = msg.attachments.first();
  if (!file.contentType?.startsWith('image/')) {
    await safeDeleteMessage(msg);
    await updateUserEphemeralReply(
      msg.author.id,
      'Prześlij prawidłowy obraz!',
      [],
      state.userEphemeralReplies
    );
    return;
  }

  await updateUserEphemeralReply(
    msg.author.id,
    '📥 Pobieranie obrazu...',
    [],
    state.userEphemeralReplies
  );

  const imgPath = path.join(
    __dirname,
    '../temp',
    `img_${Date.now()}_${msg.author.id}.png`
  );
  await downloadImage(file.url, imgPath);
  state.userImages.set(msg.author.id, imgPath);

  // Wybierz metodę OCR - AI lub tradycyjny Tesseract
  let stats;
  if (config.ocr.useAI) {
    await updateUserEphemeralReply(
      msg.author.id,
      '🤖 Analizuję obraz przez AI...',
      [],
      state.userEphemeralReplies
    );
    try {
      const aiOcrService = new AIOCRService(config);
      stats = await aiOcrService.analyzeRecruitmentImage(imgPath);
    } catch (aiError) {
      // Jeśli AI OCR zawiedzie, fallback na tradycyjny OCR
      await updateUserEphemeralReply(
        msg.author.id,
        '⚠️ AI OCR niedostępny, używam tradycyjnego OCR...',
        [],
        state.userEphemeralReplies
      );
      stats = await extractOptimizedStatsFromImage(
        imgPath,
        msg.author.id,
        state.userEphemeralReplies
      );
    }
  } else {
    stats = await extractOptimizedStatsFromImage(
      imgPath,
      msg.author.id,
      state.userEphemeralReplies
    );
  }

  await safeDeleteMessage(msg);                               // usuwamy oryginał

  if (!stats?.isValidEquipment) {
    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.invalidEquipmentImage,
      [],
      state.userEphemeralReplies
    );
    return;
  }

  /* zapisujemy odczytane dane */
  const info = state.userInfo.get(msg.author.id);
  info.characterAttack = stats.characterAttack ?? null;
  info.playerNick      = stats.playerNick      ?? 'Nieznany';
  state.userInfo.set(msg.author.id, info);

  await updateUserEphemeralReply(
    msg.author.id,
    '✅ Analiza zakończona pomyślnie!',
    [],
    state.userEphemeralReplies
  );

  /* ---------------- ścieżka „inne cele” ---------------- */
  if (info.purpose === 'Przyszedłem w innym celu') {
    state.client  = client;
    state.config  = config;

    if (stats.playerNick && stats.playerNick !== 'Nieznany') {
      await proposeNicknameChange(
        msg.author,
        stats.playerNick,
        msg.member,
        null,
        state,
        true               // flagujemy ścieżkę „inne cele”
      );
    } else {
      await finishOtherPurposeRecruitment(msg.member, state);
    }
    state.userStates.delete(msg.author.id);
    return;
  }

  /* ---------------- ścieżka „szukam klanu” -------------- */
  if (stats.characterAttack) {
    const pq = {
      member: msg.member,
      attack: stats.characterAttack,
      user:   msg.author,
      config,
      client
    };

    if (stats.playerNick && stats.playerNick !== 'Nieznany') {
      await proposeNicknameChange(
        msg.author,
        stats.playerNick,
        msg.member,
        pq,
        state,
        false
      );
    } else {
      await sendPendingQualification(msg.author.id, pq, state);
    }
  }
  state.userStates.delete(msg.author.id);
}

module.exports = { handleMessage };
