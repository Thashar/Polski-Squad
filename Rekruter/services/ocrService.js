const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { updateUserEphemeralReply } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

async function downloadImage(url, filepath) {
    logger.info(`[DOWNLOAD] Rozpoczynam pobieranie obrazu: ${url}`);
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const file = require('fs').createWriteStream(filepath);
        protocol.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                logger.info(`[DOWNLOAD] ✅ Pobrano obraz do: ${filepath}`);
                resolve();
            });
        }).on('error', (err) => {
            logger.error(`[DOWNLOAD] ❌ Błąd pobierania obrazu:`, err);
            reject(err);
        });
    });
}

async function preprocessImageForWhiteText(inputPath, outputPath) {
    try {
        logger.info(`[IMAGE] Przetwarzanie obrazu: ${inputPath} -> ${outputPath}`);
        await sharp(inputPath)
            .grayscale()
            .threshold(200)
            .negate()
            .png()
            .toFile(outputPath);
        logger.info(`[IMAGE] ✅ Przetworzono obraz`);
    } catch (error) {
        logger.error(`[IMAGE] ❌ Błąd przetwarzania obrazu:`, error);
        throw error;
    }
}

function checkForEquipmentKeyword(text) {
    const lowerText = text.toLowerCase();
    logger.info(`[OCR] Sprawdzanie słów kluczowych Equipment w tekście`);
    
    const equipmentKeywords = [
        'equipment',
        'equipement',
        'equipmnt',
        'equip',
        'eq'
    ];
    
    for (const keyword of equipmentKeywords) {
        if (lowerText.includes(keyword)) {
            logger.info(`[OCR] ✅ Znaleziono słowo kluczowe: ${keyword}`);
            return true;
        }
    }
    
    logger.info(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment`);
    return false;
}

// NOWA FUNKCJA POMOCNICZA - sprawdza czy słowo zawiera znaki interpunkcyjne
function hasPunctuation(word) {
    return /[.,\/#!$%\^&\*;:{}=\-_`~()[\]"'<>?\\|+=]/.test(word);
}

// POPRAWIONA FUNKCJA - ignoruje słowa ze znakami interpunkcyjnymi
function findNicknameInText(text) {
    logger.info(`[OCR] Szukanie najdłuższego nicku BEZ znaków interpunkcyjnych w pierwszych 3 linijkach tekstu`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const maxLines = Math.min(3, lines.length);
    logger.info(`[OCR] Sprawdzanie ${maxLines} linii (maksymalnie 3)`);
    
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        logger.info(`[OCR] Sprawdzanie linii ${i + 1}: "${line}"`);
        const words = line.split(/\s+/);
        const filteredWords = words.filter(word => /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(word));
        logger.info(`[OCR] Znalezione słowa w linii ${i + 1}:`, filteredWords);
        
        // ZMIANA: Szukamy najdłuższego słowa BEZ interpunkcji (ignorujemy słowa z interpunkcją)
        let longestWord = '';
        
        for (let j = 0; j < filteredWords.length; j++) {
            const word = filteredWords[j];
            logger.info(`[OCR] Sprawdzanie słowa ${j + 1}: "${word}"`);
            
            // Sprawdź czy słowo zawiera znaki interpunkcyjne
            if (hasPunctuation(word)) {
                logger.info(`[OCR] ❌ Słowo "${word}" zawiera znaki interpunkcyjne - IGNORUJĘ`);
                continue; // Pomiń to słowo całkowicie
            }
            
            // Sprawdź długość słowa
            if (word.length >= 3 && word.length > longestWord.length) {
                longestWord = word;
                logger.info(`[OCR] ✅ Nowe najdłuższe słowo bez interpunkcji: "${word}" (${word.length} znaków)`);
            } else if (word.length < 3) {
                logger.info(`[OCR] ❌ Słowo "${word}" za krótkie (minimum 3 znaki)`);
            } else {
                logger.info(`[OCR] ❌ Słowo "${word}" krótsze niż obecne najdłuższe`);
            }
        }
        
        // Jeśli znaleziono najdłuższe słowo w tej linii
        if (longestWord.length >= 3) {
            logger.info(`[OCR] ✅ Znaleziono najdłuższy nick bez interpunkcji "${longestWord}" w linii ${i + 1}`);
            return { nickname: longestWord, lineIndex: i };
        } else {
            logger.info(`[OCR] ❌ Nie znaleziono odpowiednio długiego słowa bez interpunkcji w linii ${i + 1}`);
        }
    }
    
    logger.info(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach`);
    return { nickname: null, lineIndex: -1 };
}

function extractAttackFromLine(line) {
    logger.info(`[OCR] Ekstraktacja ataku z linii: "${line}"`);
    const numberMatches = line.match(/\b\d+\b/g);
    
    if (numberMatches) {
        logger.info(`[OCR] Znalezione liczby w linii:`, numberMatches);
        for (const numStr of numberMatches) {
            const num = parseInt(numStr);
            logger.info(`[OCR] Sprawdzam liczbę: ${num}`);
            if (num >= 1000 && num <= 10000000) {
                logger.info(`[OCR] ✅ Liczba ${num} mieści się w zakresie ataku`);
                return num;
            } else {
                logger.info(`[OCR] ❌ Liczba ${num} poza zakresem ataku (1000-10M)`);
            }
        }
    } else {
        logger.info(`[OCR] Nie znaleziono liczb w linii`);
    }
    
    return null;
}

function calculateSimpleConfidence(playerNick, characterAttack) {
    let confidence = 0;
    logger.info(`[OCR] Kalkulacja pewności:`);
    
    if (playerNick) {
        confidence += 40;
        logger.info(`[OCR] + 40 punktów za nick`);
        if (playerNick.length >= 4) {
            confidence += 10;
            logger.info(`[OCR] + 10 punktów za długość nicku`);
        }
    }
    
    if (characterAttack) {
        confidence += 50;
        logger.info(`[OCR] + 50 punktów za atak`);
        if (characterAttack >= 10000) {
            confidence += 10;
            logger.info(`[OCR] + 10 punktów za wysoki atak`);
        }
    }
    
    const finalConfidence = Math.min(confidence, 100);
    logger.info(`[OCR] Końcowa pewność: ${finalConfidence}%`);
    return finalConfidence;
}

function extractStatsFromLines(text) {
    logger.info(`[OCR] Rozpoczynam ekstraktację statystyk z tekstu`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    logger.info(`[OCR] Liczba linii po filtracji: ${lines.length}`);
    
    let playerNick = null;
    let characterAttack = null;
    let nickLineIndex = -1;
    
    const nicknameResult = findNicknameInText(text);
    if (nicknameResult.nickname) {
        playerNick = nicknameResult.nickname;
        nickLineIndex = nicknameResult.lineIndex;
        logger.info(`[OCR] Znaleziono nick "${playerNick}" w linii ${nickLineIndex + 1}`);
    } else {
        logger.info(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - zwracam błąd`);
        return {
            playerNick: null,
            characterAttack: null,
            confidence: 0,
            isValidEquipment: false
        };
    }
    
    if (nickLineIndex >= 0) {
        logger.info(`[OCR] Szukanie ataku zaczynając od linii ${nickLineIndex + 2}`);
        for (let i = nickLineIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            logger.info(`[OCR] Analiza linii ${i + 1} w poszukiwaniu ataku: "${line}"`);
            const attackFromLine = extractAttackFromLine(line);
            if (attackFromLine) {
                characterAttack = attackFromLine;
                logger.info(`[OCR] Znaleziono atak ${characterAttack} w linii ${i + 1}`);
                break;
            }
        }
    }
    
    if (!characterAttack) {
        logger.info(`[OCR] Nie znaleziono ataku w standardowych liniach, przeszukuję cały tekst`);
        const allNumberMatches = text.match(/\b\d+\b/g);
        if (allNumberMatches) {
            logger.info(`[OCR] Wszystkie znalezione liczby:`, allNumberMatches);
            const numbers = allNumberMatches
                .map(n => parseInt(n))
                .filter(n => n >= 1000 && n <= 10000000)
                .sort((a, b) => b - a);
            logger.info(`[OCR] Liczby po filtracji i sortowaniu (1000-10M):`, numbers);
            
            if (numbers.length > 0) {
                if (numbers[0] <= 10000000) {
                    characterAttack = numbers[0];
                    logger.info(`[OCR] Wybrano największą liczbę jako atak: ${characterAttack}`);
                } else if (numbers.length > 1 && numbers[1] <= 10000000) {
                    characterAttack = numbers[1];
                    logger.info(`[OCR] Pierwsza liczba przekracza limit, wybrano drugą najwyższą: ${characterAttack}`);
                } else {
                    logger.info(`[OCR] Wszystkie liczby przekraczają limit lub są nieodpowiednie`);
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
    
    logger.info(`[OCR] Finalne wyniki ekstraktacji:`, result);
    return result;
}

async function extractOptimizedStatsFromImage(imagePath, userId, userEphemeralReplies) {
    try {
        logger.info(`[OCR] ===== ROZPOCZĘCIE ANALIZY OCR =====`);
        logger.info(`[OCR] Użytkownik: ${userId}`);
        logger.info(`[OCR] Ścieżka obrazu: ${imagePath}`);
        
        const processedPath = imagePath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, '_processed.png');
        
        await updateUserEphemeralReply(userId, '🔄 Przetwarzam obraz...', [], userEphemeralReplies);
        logger.info(`[OCR] Rozpoczynam preprocessowanie obrazu`);
        await preprocessImageForWhiteText(imagePath, processedPath);
        
        await updateUserEphemeralReply(userId, '🔍 Analizuję obraz...', [], userEphemeralReplies);
        logger.info(`[OCR] Rozpoczynam rozpoznawanie tekstu Tesseract`);
        
        const { data: { text } } = await Tesseract.recognize(processedPath, 'pol+eng', {
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄĆĘŁŃÓŚŹŻąćęłńóśźż: +-%.,()/'
        });
        
        logger.info(`[OCR] ===== WYNIK TESSERACT =====`);
        logger.info(`[OCR] Rozpoznany tekst:`);
        logger.info(text);
        logger.info(`[OCR] ===============================`);
        
        await fs.unlink(processedPath).catch(() => {});
        
        await updateUserEphemeralReply(userId, '📊 Sprawdzam czy to Equipment...', [], userEphemeralReplies);
        const hasEquipment = checkForEquipmentKeyword(text);
        
        if (!hasEquipment) {
            logger.info(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment - odrzucam obraz`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0
            };
        }
        
        await updateUserEphemeralReply(userId, '📊 Analizuję statystyki...', [], userEphemeralReplies);
        logger.info(`[OCR] Rozpoczynam analizę statystyk`);
        
        const stats = extractStatsFromLines(text);
        
        if (!stats.playerNick) {
            logger.info(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - odrzucam obraz`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                error: 'NICK_NOT_FOUND_IN_FIRST_3_LINES'
            };
        }
        
        stats.isValidEquipment = true;
        
        logger.info(`[OCR] ===== WYNIKI ANALIZY =====`);
        logger.info(`[OCR] Nick gracza: ${stats.playerNick}`);
        logger.info(`[OCR] Atak postaci: ${stats.characterAttack}`);
        logger.info(`[OCR] Pewność: ${stats.confidence}%`);
        logger.info(`[OCR] ===========================`);
        
        return stats;
    } catch (error) {
        logger.error(`[OCR] ❌ Błąd podczas analizy OCR:`, error);
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
