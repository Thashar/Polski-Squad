const path = require('path');
const { safeDeleteMessage, updateUserEphemeralReply } = require('../utils/helpers');
const { extractOptimizedStatsFromImage } = require('../services/ocrService');
const { proposeNicknameChange } = require('../services/nicknameService');
const { finishOtherPurposeRecruitment, sendPendingQualification } = require('../services/qualificationService');
const { safeAddRole } = require('../services/roleService');

async function handleMessage(message, sharedState, config, client, MONITORED_CHANNEL_ID) {
    if (message.channel.id !== MONITORED_CHANNEL_ID) {
        return;
    }
    
    if (message.author.bot) return;
    
    const userId = message.author.id;
    const userState = sharedState.userStates.get(userId);
    console.log(`[MESSAGE] Otrzymano wiadomość od ${message.author.username}: "${message.content.substring(0, 50)}..."`);
    
    const isUseful = await analyzeMessage(message, userState, sharedState, config, client);
    if (!isUseful) {
        console.log(`[MESSAGE] Usuwam bezużyteczną wiadomość od ${message.author.username}`);
        await safeDeleteMessage(message);
    } else {
        console.log(`[MESSAGE] Wiadomość od ${message.author.username} jest przydatna`);
    }
}

async function analyzeMessage(message, userState, sharedState, config, client) {
    console.log(`[ANALYZE] Analizuję wiadomość w stanie: ${userState?.step || 'brak stanu'}`);
    
    if (userState && userState.step === 'waiting_rc') {
        await handleRCInput(message, userState, sharedState, config);
        return true;
    }
    
    if (userState && userState.step === 'waiting_lunar_level') {
        await handleLunarLevelInput(message, userState, sharedState, config);
        return true;
    }
    
    if (userState && userState.step === 'waiting_lunar_points') {
        await handleLunarPointsInput(message, userState, sharedState, config);
        return true;
    }
    
    if (userState && userState.step === 'waiting_image') {
        await handleImageInput(message, userState, sharedState, config, client);
        return true;
    }
    
    console.log(`[ANALYZE] Wiadomość nie pasuje do żadnego stanu`);
    return false;
}

async function handleRCInput(message, userState, sharedState, config) {
    const rcAmount = parseInt(message.content);
    console.log(`[RC_INPUT] Użytkownik ${message.author.username} podał RC: ${message.content}`);
    
    await safeDeleteMessage(message);
    
    if (isNaN(rcAmount) || rcAmount < 0 || rcAmount > 500) {
        console.log(`[RC_INPUT] ❌ Nieprawidłowa wartość RC: ${rcAmount}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidRC, [], sharedState.userEphemeralReplies);
        return;
    }
    
    console.log(`[RC_INPUT] ✅ Prawidłowa wartość RC: ${rcAmount}`);
    
    const info = sharedState.userInfo.get(message.author.id);
    if (info) {
        info.rcAmount = rcAmount;
        sharedState.userInfo.set(message.author.id, info);
    }
    
    sharedState.userStates.set(message.author.id, { step: 'waiting_lunar_level', rcAmount });
    await updateUserEphemeralReply(message.author.id, config.messages.lunarLevelQuestion, [], sharedState.userEphemeralReplies);
}

async function handleLunarLevelInput(message, userState, sharedState, config) {
    const lunarLevel = parseInt(message.content);
    console.log(`[LUNAR_LEVEL] Użytkownik ${message.author.username} podał poziom Lunar: ${message.content}`);
    
    await safeDeleteMessage(message);
    
    if (isNaN(lunarLevel) || lunarLevel < 1 || lunarLevel > 12) {
        console.log(`[LUNAR_LEVEL] ❌ Nieprawidłowy poziom Lunar: ${lunarLevel}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidLunarLevel, [], sharedState.userEphemeralReplies);
        return;
    }
    
    console.log(`[LUNAR_LEVEL] ✅ Prawidłowy poziom Lunar: ${lunarLevel}`);
    
    const info = sharedState.userInfo.get(message.author.id);
    if (info) {
        info.lunarLevel = lunarLevel;
        sharedState.userInfo.set(message.author.id, info);
    }
    
    sharedState.userStates.set(message.author.id, {
        step: 'waiting_lunar_points',
        rcAmount: userState.rcAmount,
        lunarLevel
    });
    
    await updateUserEphemeralReply(message.author.id, config.messages.lunarPointsQuestion, [], sharedState.userEphemeralReplies);
}

async function handleLunarPointsInput(message, userState, sharedState, config) {
    const lunarPoints = parseInt(message.content);
    console.log(`[LUNAR_POINTS] Użytkownik ${message.author.username} podał punkty Lunar: ${message.content}`);
    
    await safeDeleteMessage(message);
    
    if (isNaN(lunarPoints) || lunarPoints < 0 || lunarPoints > 1500) {
        console.log(`[LUNAR_POINTS] ❌ Nieprawidłowe punkty Lunar: ${lunarPoints}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidLunarPoints, [], sharedState.userEphemeralReplies);
        return;
    }
    
    console.log(`[LUNAR_POINTS] ✅ Prawidłowe punkty Lunar: ${lunarPoints}`);
    
    const info = sharedState.userInfo.get(message.author.id);
    if (info) {
        info.lunarPoints = lunarPoints;
        sharedState.userInfo.set(message.author.id, info);
    }
    
    sharedState.userStates.set(message.author.id, {
        step: 'waiting_image',
        rcAmount: userState.rcAmount,
        lunarLevel: userState.lunarLevel,
        lunarPoints
    });
    
    await updateUserEphemeralReply(message.author.id, config.messages.statsQuestion, [], sharedState.userEphemeralReplies);
}

async function handleImageInput(message, userState, sharedState, config, client) {
    console.log(`[IMAGE_INPUT] Użytkownik ${message.author.username} przesłał ${message.attachments.size} załączników`);
    
    if (message.attachments.size === 0) {
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, 'Musisz przesłać zdjęcie!', [], sharedState.userEphemeralReplies);
        return;
    }
    
    const attachment = message.attachments.first();
    console.log(`[IMAGE_INPUT] Typ załącznika: ${attachment.contentType}`);
    
    if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        console.log(`[IMAGE_INPUT] ❌ Nieprawidłowy typ pliku`);
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, 'Prześlij prawidłowy obraz!', [], sharedState.userEphemeralReplies);
        return;
    }
    
    try {
        await updateUserEphemeralReply(message.author.id, '🚀 Rozpoczynam szybką analizę zdjęcia...', [], sharedState.userEphemeralReplies);
        
        const tempImagePath = path.join(__dirname, '../temp', `temp_${Date.now()}_${message.author.id}.png`);
        console.log(`[IMAGE_INPUT] Ścieżka tymczasowa: ${tempImagePath}`);
        
        await updateUserEphemeralReply(message.author.id, '📥 Pobieranie obrazu...', [], sharedState.userEphemeralReplies);
        
        const { downloadImage } = require('../services/ocrService');
        await downloadImage(attachment.url, tempImagePath);
        sharedState.userImages.set(message.author.id, tempImagePath);
        
        const stats = await extractOptimizedStatsFromImage(tempImagePath, message.author.id, sharedState.userEphemeralReplies);
        
        if (!stats || !stats.isValidEquipment) {
            console.log(`[IMAGE_INPUT] ❌ Obraz nie zawiera prawidłowych danych`);
            await safeDeleteMessage(message);
            
            try {
                const fs = require('fs').promises;
                await fs.unlink(tempImagePath);
                sharedState.userImages.delete(message.author.id);
            } catch (error) {}
            
            if (stats && stats.error === 'NICK_NOT_FOUND_IN_FIRST_3_LINES') {
                console.log(`[IMAGE_INPUT] ❌ Nick nie został znaleziony w pierwszych 3 linijkach`);
                await updateUserEphemeralReply(message.author.id, config.messages.invalidEquipmentImage, [], sharedState.userEphemeralReplies);
            } else {
                await updateUserEphemeralReply(message.author.id, config.messages.invalidEquipmentImage, [], sharedState.userEphemeralReplies);
            }
            return;
        }
        
        if (!stats.characterAttack && !stats.playerNick) {
            console.log(`[IMAGE_INPUT] ❌ Nie udało się odczytać danych z obrazu`);
            await safeDeleteMessage(message);
            await updateUserEphemeralReply(message.author.id, '❌ Nie udało się odczytać danych z obrazu. Spróbuj z lepszej jakości zdjęciem.', [], sharedState.userEphemeralReplies);
            return;
        }
        
        console.log(`[IMAGE_INPUT] ✅ Pomyślnie przeanalizowano obraz`);
        
        const info = sharedState.userInfo.get(message.author.id);
        if (info) {
            info.characterAttack = stats.characterAttack || null;
            info.playerNick = stats.playerNick || 'Nieznany';
            sharedState.userInfo.set(message.author.id, info);
        }
        
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, '✅ Analiza zakończona pomyślnie!', [], sharedState.userEphemeralReplies);
        
        // GŁÓWNA ZMIANA: Obsługa propozycji nicku dla ścieżki "inne cele"
        if (info && info.purpose === 'Przyszedłem w innym celu') {
            console.log(`[IMAGE_INPUT] Użytkownik ${message.author.username} przyszedł w innym celu - sprawdzamy nick`);
            
            // Dodajemy client i config do sharedState dla potrzeb tej funkcji
            sharedState.client = client;
            sharedState.config = config;
            
            if (stats.playerNick && stats.playerNick !== 'Nieznany') {
                console.log(`[IMAGE_INPUT] Wykryto nick w grze: ${stats.playerNick}, sprawdzamy podobieństwo`);
                await proposeNicknameChange(message.author, stats.playerNick, message.member, null, sharedState, true);
            } else {
                console.log(`[IMAGE_INPUT] Nie wykryto nicku lub nick nieznany - kończenie rekrutacji bez propozycji zmiany`);
                await finishOtherPurposeRecruitment(message.author, sharedState);
            }
            
            sharedState.userStates.delete(message.author.id);
            return;
        }
        
        // Standardowa obsługa dla ścieżki "Szukam klanu"
        if (stats.characterAttack) {
            console.log(`[IMAGE_INPUT] Przystępuję do kwalifikacji klanu dla ${message.author.username} (atak: ${stats.characterAttack})`);
            
            const qualificationData = {
                member: message.member,
                attack: stats.characterAttack,
                user: message.author,
                stats: stats,
                config: config,
                client: client
            };
            
            if (stats.playerNick && stats.playerNick !== 'Nieznany') {
                await proposeNicknameChange(message.author, stats.playerNick, message.member, qualificationData, sharedState, false);
            } else {
                await sendPendingQualification(message.author.id, qualificationData, sharedState);
            }
        }
    } catch (error) {
        console.error(`[IMAGE_INPUT] ❌ Błąd podczas analizy obrazu:`, error);
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, '❌ Wystąpił błąd podczas analizy obrazu. Spróbuj ponownie z innym zdjęciem.', [], sharedState.userEphemeralReplies);
    }
    
    sharedState.userStates.delete(message.author.id);
}

module.exports = {
    handleMessage
};
