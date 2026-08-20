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

  const step = state.userStates.get(message.author.id)?.step;

  // Kanał z przyciskiem „Chcę dołączyć do klanu” NIE jest kanałem wyłącznie rekrutacyjnym,
  // więc reagujemy tam tylko na osoby z rozpoczętą rekrutacją. Bez tego warunku wpadłyby
  // one w `default` poniżej i bot kasowałby wszystkim wszystkie wiadomości
  if (message.channel.id === config.channels.joinClan && message.channel.id !== RECRUIT_CHANNEL_ID) {
    if (!step) return;
  } else if (message.channel.id !== RECRUIT_CHANNEL_ID) {
    return;
  }

  switch (step) {
    case 'waiting_core_stock':
      await handleCoreStockImage(message, state, config);
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

    case 'ai_interview':
      await handleAiInterviewMessage(message, state, config, client);
      break;

    default:
      await safeDeleteMessage(message); // niepotrzebna wiadomość
  }
}

/* ========================================================================== */
/*                             POSZCZEGÓLNE KROKI                             */
/* ========================================================================== */
async function handleCoreStockImage(msg, state, config) {
  if (msg.attachments.size === 0) {
    await safeDeleteMessage(msg);
    await updateUserEphemeralReply(
      msg.author.id,
      'Musisz przesłać zdjęcie Core Stock!',
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
    '🤖 Analizuję zdjęcie Core Stock...',
    [],
    state.userEphemeralReplies
  );

  const imgPath = path.join(
    __dirname,
    '../temp',
    `cs_${Date.now()}_${msg.author.id}.png`
  );
  await downloadImage(file.url, imgPath);
  await safeDeleteMessage(msg);

  try {
    const aiOcrService = new AIOCRService(config);
    const result = await aiOcrService.analyzeCoreStockImage(imgPath);

    // Usuń plik tymczasowy
    try { const fs = require('fs').promises; await fs.unlink(imgPath); } catch {/* pomijamy */}

    if (!result.isValid) {
      const errMsg = result.error === 'NOT_CORE_STOCK'
        ? config.messages.invalidCoreStockImage
        : config.messages.coreStockError;
      await updateUserEphemeralReply(msg.author.id, errMsg, [], state.userEphemeralReplies);
      return;
    }

    state.userInfo.get(msg.author.id).coreStock = result.items;
    state.userStates.set(msg.author.id, { step: 'waiting_lunar_level' });

    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.lunarLevelQuestion,
      [],
      state.userEphemeralReplies
    );
  } catch (err) {
    try { const fs = require('fs').promises; await fs.unlink(imgPath); } catch {/* pomijamy */}
    await updateUserEphemeralReply(
      msg.author.id,
      config.messages.coreStockError,
      [],
      state.userEphemeralReplies
    );
  }
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

  if (isNaN(pts) || pts < 0 || pts > 9999) {
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
      member:      msg.member,
      lunarPoints: info.lunarPoints ?? null,
      user:        msg.author,
      config,
      client,
      guildId:     msg.guild?.id ?? null
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

/* ========================================================================== */
/*                        ROZMOWA REKRUTACYJNA Z AI                           */
/* ========================================================================== */

/**
 * Obsługuje jedną wiadomość kandydata w trybie rozmowy z AI.
 *
 * Wiadomość (tekst albo zdjęcie) jest kasowana z kanału tak samo jak w klasycznej
 * ścieżce, a cała rozmowa toczy się w efemerycznej odpowiedzi widocznej tylko
 * dla kandydata.
 */
async function handleAiInterviewMessage(msg, state, config, client) {
  const { createBotLogger } = require('../../utils/consoleLogger');
  const logger = createBotLogger('Rekruter');

  const serwis = state.aiInterviewService;
  const userId = msg.author.id;
  const kanal  = msg.channel;

  if (!serwis?.czyAktywny()) {
    await safeDeleteMessage(msg);
    return;
  }

  const zalacznik = msg.attachments.first();
  const tekst     = msg.content?.trim();

  if (!zalacznik && !tekst) {
    await safeDeleteMessage(msg);
    await serwis.pokazOdpowiedz(
      userId,
      serwis.zbudujTranskrypcje(userId, config.messages.aiInterviewEmptyMessage),
      state,
      kanal
    );
    return;
  }

  if (zalacznik && !zalacznik.contentType?.startsWith('image/')) {
    await safeDeleteMessage(msg);
    await serwis.pokazOdpowiedz(
      userId,
      serwis.zbudujTranskrypcje(userId, config.messages.aiInterviewInvalidImage),
      state,
      kanal
    );
    return;
  }

  await serwis.pokazOdpowiedz(
    userId,
    serwis.zbudujTranskrypcje(userId, config.messages.aiInterviewThinking),
    state,
    kanal
  );

  let wynik;

  try {
    if (zalacznik) {
      const imgPath = path.join(
        __dirname,
        '../temp',
        `ai_${Date.now()}_${userId}.png`
      );
      await downloadImage(zalacznik.url, imgPath);
      await safeDeleteMessage(msg);

      const analiza = await serwis.przeanalizujZdjecie(userId, imgPath, state);

      if (analiza.typ === 'ekwipunek') {
        // Ten screen ląduje w podsumowaniu na kanale klanowym - zostawiamy go na dysku
        const poprzedni = state.userImages.get(userId);
        if (poprzedni && poprzedni !== imgPath) await usunPlik(poprzedni);
        state.userImages.set(userId, imgPath);
      } else {
        await usunPlik(imgPath);
      }

      wynik = await serwis.wiadomoscSystemowa(userId, analiza.opis, state, '📷 *przesłano zdjęcie*');
    } else {
      await safeDeleteMessage(msg);
      wynik = await serwis.wiadomoscUzytkownika(userId, tekst, state);
    }
  } catch (error) {
    logger.error(`[AI_WYWIAD] ❌ Błąd tury rozmowy dla ${msg.author.username}: ${error.message}`);
    await serwis.pokazOdpowiedz(
      userId,
      serwis.zbudujTranskrypcje(userId, config.messages.aiInterviewError),
      state,
      kanal
    );
    return;
  }

  if (!wynik) {
    // Rozmowa zniknęła z pamięci (restart bota albo sprzątanie) - kończymy po cichu
    state.userStates.delete(userId);
    return;
  }

  await serwis.pokazOdpowiedz(userId, serwis.zbudujTranskrypcje(userId), state, kanal);

  if (wynik.przerwane) {
    logger.warn(`[AI_WYWIAD] Rozmowa z ${msg.author.username} przerwana - limit tur`);
    serwis.zakonczRozmowe(userId);
    state.userStates.delete(userId);
    return;
  }

  if (wynik.zakonczone) {
    await finalizujRekrutacjeAI(msg, state, config, client);
  }
}

/**
 * Domyka rekrutację po zakończonej rozmowie z AI.
 *
 * Od tego miejsca w dół wszystko dzieje się tak samo jak w klasycznej ścieżce:
 * propozycja zmiany nicku, przydział klanu i podsumowanie na kanale.
 */
async function finalizujRekrutacjeAI(msg, state, config, client) {
  const { createBotLogger } = require('../../utils/consoleLogger');
  const logger = createBotLogger('Rekruter');

  const userId = msg.author.id;
  const info   = state.userInfo.get(userId);

  state.aiInterviewService.zakonczRozmowe(userId);
  state.userStates.delete(userId);

  if (!info) {
    logger.error('[AI_WYWIAD] ❌ Brak danych kandydata przy finalizacji');
    return;
  }

  state.client = client;
  state.config = config;

  const nick = info.playerNick && info.playerNick !== 'Nieznany' ? info.playerNick : null;

  /* ---------------- ścieżka „inne cele” ---------------- */
  if (info.purpose === 'Przyszedłem w innym celu') {
    if (nick) {
      await proposeNicknameChange(msg.author, nick, msg.member, null, state, true);
    } else {
      await finishOtherPurposeRecruitment(msg.member, state);
    }
    return;
  }

  /* ---------------- ścieżka „szukam klanu” -------------- */
  const pq = {
    member:      msg.member,
    lunarPoints: info.lunarPoints ?? null,
    user:        msg.author,
    config,
    client,
    guildId:     msg.guild?.id ?? null
  };

  if (nick) {
    await proposeNicknameChange(msg.author, nick, msg.member, pq, state, false);
  } else {
    await sendPendingQualification(userId, pq, state);
  }
}

async function usunPlik(sciezka) {
  try {
    const fs = require('fs').promises;
    await fs.unlink(sciezka);
  } catch {/* pomijamy */}
}

module.exports = { handleMessage };
