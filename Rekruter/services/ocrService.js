const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { updateUserEphemeralReply } = require('../utils/helpers');

async function downloadImage(url, filepath) {
    console.log(`[DOWNLOAD] Rozpoczynam pobieranie obrazu: ${url}`);
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const file = require('fs').createWriteStream(filepath);
        protocol.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`[DOWNLOAD] ✅ Pobrano obraz do: ${filepath}`);
                resolve();
            });
        }).on('error', (err) => {
            console.error(`[DOWNLOAD] ❌ Błąd pobierania obrazu:`, err);
            reject(err);
        });
    });
}

async function preprocessImageForWhiteText(inputPath, outputPath) {
    try {
        console.log(`[IMAGE] Przetwarzanie obrazu: ${inputPath} -> ${outputPath}`);
        await sharp(inputPath)
            .grayscale()
            .threshold(200)
            .negate()
            .png()
            .toFile(outputPath);
        console.log(`[IMAGE] ✅ Przetworzono obraz`);
    } catch (error) {
        console.error(`[IMAGE] ❌ Błąd przetwarzania obrazu:`, error);
        throw error;
    }
}

function checkForEquipmentKeyword(text) {
    const lowerText = text.toLowerCase();
    console.log(`[OCR] Sprawdzanie słów kluczowych Equipment w tekście`);
    
    const equipmentKeywords = [
        'equipment',
        'equipement',
        'equipmnt',
        'equip',
        'eq'
    ];
    
    for (const keyword of equipmentKeywords) {
        if (lowerText.includes(keyword)) {
            console.log(`[OCR] ✅ Znaleziono słowo kluczowe: ${keyword}`);
            return true;
        }
    }
    
    console.log(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment`);
    return false;
}

// POPRAWIONA FUNKCJA - priorytet od lewej strony
function findNicknameInText(text) {
    console.log(`[OCR] Szukanie nicku w pierwszych 3 linijkach tekstu - priorytet od lewej strony`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const maxLines = Math.min(3, lines.length);
    console.log(`[OCR] Sprawdzanie ${maxLines} linii (maksymalnie 3)`);
    
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        console.log(`[OCR] Sprawdzanie linii ${i + 1}: "${line}"`);
        const words = line.split(/\s+/);
        const filteredWords = words.filter(word => /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(word));
        console.log(`[OCR] Znalezione słowa w linii ${i + 1}:`, filteredWords);
        
        // ZMIANA: Sprawdzamy słowa od lewej strony, nie szukamy najdłuższego
        for (let j = 0; j < filteredWords.length; j++) {
            let word = filteredWords[j];
            word = word.replace(/^[^\w\u00C0-\u017F]+|[^\w\u00C0-\u017F]+$/g, '');
            console.log(`[OCR] Sprawdzanie słowa ${j + 1} od lewej: "${word}"`);
            
            if (word && word.length >= 3) {
                console.log(`[OCR] ✅ Znaleziono potencjalny nick "${word}" w linii ${i + 1}, pozycja ${j + 1} od lewej`);
                return { nickname: word, lineIndex: i };
            } else {
                console.log(`[OCR] ❌ Słowo "${word}" za krótkie (minimum 3 znaki)`);
            }
        }
    }
    
    console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach`);
    return { nickname: null, lineIndex: -1 };
}

function extractAttackFromLine(line) {
    console.log(`[OCR] Ekstraktacja ataku z linii: "${line}"`);
    const numberMatches = line.match(/\b\d+\b/g);
    
    if (numberMatches) {
        console.log(`[OCR] Znalezione liczby w linii:`, numberMatches);
        for (const numStr of numberMatches) {
            const num = parseInt(numStr);
            console.log(`[OCR] Sprawdzam liczbę: ${num}`);
            if (num >= 1000 && num <= 10000000) {
                console.log(`[OCR] ✅ Liczba ${num} mieści się w zakresie ataku`);
                return num;
            } else {
                console.log(`[OCR] ❌ Liczba ${num} poza zakresem ataku (1000-10M)`);
            }
        }
    } else {
        console.log(`[OCR] Nie znaleziono liczb w linii`);
    }
    
    return null;
}

function calculateSimpleConfidence(playerNick, characterAttack) {
    let confidence = 0;
    console.log(`[OCR] Kalkulacja pewności:`);
    
    if (playerNick) {
        confidence += 40;
        console.log(`[OCR] + 40 punktów za nick`);
        if (playerNick.length >= 4) {
            confidence += 10;
            console.log(`[OCR] + 10 punktów za długość nicku`);
        }
    }
    
    if (characterAttack) {
        confidence += 50;
        console.log(`[OCR] + 50 punktów za atak`);
        if (characterAttack >= 10000) {
            confidence += 10;
            console.log(`[OCR] + 10 punktów za wysoki atak`);
        }
    }
    
    const finalConfidence = Math.min(confidence, 100);
    console.log(`[OCR] Końcowa pewność: ${finalConfidence}%`);
    return finalConfidence;
}

function extractStatsFromLines(text) {
    console.log(`[OCR] Rozpoczynam ekstraktację statystyk z tekstu`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[OCR] Liczba linii po filtracji: ${lines.length}`);
    
    let playerNick = null;
    let characterAttack = null;
    let nickLineIndex = -1;
    
    const nicknameResult = findNicknameInText(text);
    if (nicknameResult.nickname) {
        playerNick = nicknameResult.nickname;
        nickLineIndex = nicknameResult.lineIndex;
        console.log(`[OCR] Znaleziono nick "${playerNick}" w linii ${nickLineIndex + 1}`);
    } else {
        console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - zwracam błąd`);
        return {
            playerNick: null,
            characterAttack: null,
            confidence: 0,
            isValidEquipment: false
        };
    }
    
    if (nickLineIndex >= 0) {
        console.log(`[OCR] Szukanie ataku zaczynając od linii ${nickLineIndex + 2}`);
        for (let i = nickLineIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            console.log(`[OCR] Analiza linii ${i + 1} w poszukiwaniu ataku: "${line}"`);
            const attackFromLine = extractAttackFromLine(line);
            if (attackFromLine) {
                characterAttack = attackFromLine;
                console.log(`[OCR] Znaleziono atak ${characterAttack} w linii ${i + 1}`);
                break;
            }
        }
    }
    
    if (!characterAttack) {
        console.log(`[OCR] Nie znaleziono ataku w standardowych liniach, przeszukuję cały tekst`);
        const allNumberMatches = text.match(/\b\d+\b/g);
        if (allNumberMatches) {
            console.log(`[OCR] Wszystkie znalezione liczby:`, allNumberMatches);
            const numbers = allNumberMatches
                .map(n => parseInt(n))
                .filter(n => n >= 1000 && n <= 10000000)
                .sort((a, b) => b - a);
            console.log(`[OCR] Liczby po filtracji i sortowaniu (1000-10M):`, numbers);
            
            if (numbers.length > 0) {
                if (numbers[0] <= 10000000) {
                    characterAttack = numbers[0];
                    console.log(`[OCR] Wybrano największą liczbę jako atak: ${characterAttack}`);
                } else if (numbers.length > 1 && numbers[1] <= 10000000) {
                    characterAttack = numbers[1];
                    console.log(`[OCR] Pierwsza liczba przekracza limit, wybrano drugą najwyższą: ${characterAttack}`);
                } else {
                    console.log(`[OCR] Wszystkie liczby przekraczają limit lub są nieodpowiednie`);
                }
            }
        }
    }
    
    const result = {
        playerNick,
        characterAttack,
        confidence: calculateSimpleConfidence(playerNick, characterAttack),
        isValidEquipment: true
    };
    
    console.log(`[OCR] Finalne wyniki ekstraktacji:`, result);
    return result;
}

async function extractOptimizedStatsFromImage(imagePath, userId, userEphemeralReplies) {
    try {
        console.log(`[OCR] ===== ROZPOCZĘCIE ANALIZY OCR =====`);
        console.log(`[OCR] Użytkownik: ${userId}`);
        console.log(`[OCR] Ścieżka obrazu: ${imagePath}`);
        
        const processedPath = imagePath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, '_processed.png');
        
        await updateUserEphemeralReply(userId, '🔄 Przetwarzam obraz...', [], userEphemeralReplies);
        console.log(`[OCR] Rozpoczynam preprocessowanie obrazu`);
        await preprocessImageForWhiteText(imagePath, processedPath);
        
        await updateUserEphemeralReply(userId, '🔍 Analizuję obraz...', [], userEphemeralReplies);
        console.log(`[OCR] Rozpoczynam rozpoznawanie tekstu Tesseract`);
        
        const { data: { text } } = await Tesseract.recognize(processedPath, 'pol+eng', {
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄĆĘŁŃÓŚŹŻąćęłńóśźż: +-%.,()/'
        });
        
        console.log(`[OCR] ===== WYNIK TESSERACT =====`);
        console.log(`[OCR] Rozpoznany tekst:`);
        console.log(text);
        console.log(`[OCR] ===============================`);
        
        await fs.unlink(processedPath).catch(() => {});
        
        await updateUserEphemeralReply(userId, '📊 Sprawdzam czy to Equipment...', [], userEphemeralReplies);
        const hasEquipment = checkForEquipmentKeyword(text);
        
        if (!hasEquipment) {
            console.log(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment - odrzucam obraz`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0
            };
        }
        
        await updateUserEphemeralReply(userId, '📊 Analizuję statystyki...', [], userEphemeralReplies);
        console.log(`[OCR] Rozpoczynam analizę statystyk`);
        
        const stats = extractStatsFromLines(text);
        
        if (!stats.playerNick) {
            console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - odrzucam obraz`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                error: 'NICK_NOT_FOUND_IN_FIRST_3_LINES'
            };
        }
        
        stats.isValidEquipment = true;
        
        console.log(`[OCR] ===== WYNIKI ANALIZY =====`);
        console.log(`[OCR] Nick gracza: ${stats.playerNick}`);
        console.log(`[OCR] Atak postaci: ${stats.characterAttack}`);
        console.log(`[OCR] Pewność: ${stats.confidence}%`);
        console.log(`[OCR] ===========================`);
        
        return stats;
    } catch (error) {
        console.error(`[OCR] ❌ Błąd podczas analizy OCR:`, error);
        throw error;
    }
}

module.exports = {
    downloadImage,
    preprocessImageForWhiteText,
    checkForEquipmentKeyword,
    findNicknameInText,
    extractAttackFromLine,
    calculateSimpleConfidence,
    extractStatsFromLines,
    extractOptimizedStatsFromImage
};
