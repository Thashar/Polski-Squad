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

async function preprocessImageForWhiteText(inputPath, outputPath, config = null) {
    try {
        if (config?.ocr?.detailedLogging?.enabled && config.ocr.detailedLogging.logPreprocessing) {
            logger.info(`🔍 Szczegółowy debug: [IMAGE] Przetwarzanie obrazu: ${inputPath} -> ${outputPath}`);
            logger.info(`📐 Szczegółowy debug: Stosowanie inwersji + grayscale + threshold 80`);
        } else {
            logger.info(`[IMAGE] Przetwarzanie obrazu: ${inputPath} -> ${outputPath}`);
        }
        
        await sharp(inputPath)
            .negate()           // Inwersja przed konwersją na szarość
            .grayscale()
            .threshold(80)      // Threshold -80 (Sharp używa dodatnich wartości)
            .png()
            .toFile(outputPath);
        
        if (config?.ocr?.detailedLogging?.enabled && config.ocr.detailedLogging.logPreprocessing) {
            logger.info(`✅ Szczegółowy debug: [IMAGE] Przetworzono obraz z inwersją przed grayscale i threshold 80`);
        } else {
            logger.info(`[IMAGE] ✅ Przetworzono obraz z inwersją przed grayscale i threshold 80`);
        }
    } catch (error) {
        logger.error(`[IMAGE] ❌ Błąd przetwarzania obrazu:`, error);
        throw error;
    }
}

async function preprocessImageForWhiteTextOriginal(inputPath, outputPath) {
    try {
        logger.info(`[IMAGE] Przetwarzanie obrazu (oryginalne ustawienia): ${inputPath} -> ${outputPath}`);
        await sharp(inputPath)
            .grayscale()
            .threshold(200)
            .negate()
            .png()
            .toFile(outputPath);
        logger.info(`[IMAGE] ✅ Przetworzono obraz z oryginalnymi ustawieniami`);
    } catch (error) {
        logger.error(`[IMAGE] ❌ Błąd przetwarzania obrazu:`, error);
        throw error;
    }
}

async function preprocessImageStalkerStyle(inputPath, outputPath) {
    try {
        logger.info(`[IMAGE] Przetwarzanie obrazu w stylu Stalker: ${inputPath} -> ${outputPath}`);
        // Zaawansowane przetwarzanie obrazu jak w StalkerLME
        await sharp(inputPath)
            .greyscale()
            // 1. Zwiększamy rozdzielczość x3 dla lepszej jakości OCR
            .resize({ width: null, height: null, fit: 'inside', withoutEnlargement: false, scale: 3 })
            // 2. Delikatne rozmycie Gaussa - redukuje szum i artefakty
            .blur(0.3)
            // 3. Normalizacja dla pełnego wykorzystania zakresu tonalnego
            .normalize()
            // 4. INWERSJA OBRAZU - biały tekst staje się czarnym
            .negate()
            // 5. Gamma correction - poprawia czytelność środkowych tonów
            .gamma(1.1)
            // 6. Mocniejszy kontrast po inwersji dla ostrzejszego tekstu
            .linear(2.2, -100) // Agresywniejszy kontrast
            // 7. Wyostrzenie krawędzi tekstu
            .sharpen({ sigma: 0.5, m1: 0, m2: 2, x1: 2, y2: 10 })
            // 8. Operacja morfologiczna - zamykanie luk w literach
            .convolve({
                width: 3,
                height: 3,
                kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
            })
            // 9. Finalna binaryzacja - wszystkie odcienie szarości → białe, tekst → czarny
            .threshold(130, { greyscale: false }) // Nieco wyższy próg po wszystkich operacjach
            .png()
            .toFile(outputPath);
        
        logger.info(`[IMAGE] ✅ Przetworzono obraz w stylu Stalker (x3, blur, gamma, sharpen, morph)`);
    } catch (error) {
        logger.error(`[IMAGE] ❌ Błąd przetwarzania obrazu w stylu Stalker:`, error);
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

// Elastyczna metoda dla tekstu z gier mobilnych - lepsze rozpoznawanie Equipment
function checkForEquipmentKeywordFlexible(text) {
    const lowerText = text.toLowerCase();
    logger.info(`[EQUIPMENT] ===== ANALIZA EQUIPMENT =====`);
    
    // Podstawowe warianty Equipment
    const equipmentKeywords = [
        'equipment', 'equipement', 'equipmnt', 'equip', 'eq',
        'equipmnent', 'equipemnt', 'equipmenet', 'eqipment',
        'equipmant', 'equipmetn', 'equlpment', 'equlpmnt'
    ];
    
    // Sprawdź podstawowe warianty
    for (const keyword of equipmentKeywords) {
        if (lowerText.includes(keyword)) {
            logger.info(`[EQUIPMENT] ✅ Znaleziono słowo kluczowe: ${keyword}`);
            logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
            return true;
        }
    }
    
    // Elastyczne dopasowanie - usuń spacje i sprawdź ponownie
    const textNoSpaces = lowerText.replace(/\\s+/g, '');
    for (const keyword of equipmentKeywords) {
        if (textNoSpaces.includes(keyword)) {
            logger.info(`[EQUIPMENT] ✅ Znaleziono słowo kluczowe bez spacji: ${keyword}`);
            logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
            return true;
        }
    }
    
    // Sprawdź fragmenty tekstu z podobieństwem do "equipment"
    const words = lowerText.split(/\\s+/);
    for (const word of words) {
        // Słowa zaczynające się na "equ" i mające długość 5-12 znaków
        if (word.startsWith('equ') && word.length >= 5 && word.length <= 12) {
            // Sprawdź czy zawiera typowe litery z "equipment"
            const hasP = word.includes('p');
            const hasM = word.includes('m');
            const hasE = word.includes('e');
            const hasN = word.includes('n');
            const hasT = word.includes('t');
            
            if ((hasP && hasM) || (hasE && hasN && hasT)) {
                logger.info(`[EQUIPMENT] ✅ Znaleziono prawdopodobne "equipment": ${word}`);
                logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
                return true;
            }
        }
        
        // Słowa zawierające "quip" (środek equipment)
        if (word.includes('quip') && word.length >= 5) {
            logger.info(`[EQUIPMENT] ✅ Znaleziono słowo z "quip": ${word}`);
            logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
            return true;
        }
    }
    
    // Sprawdź zniekształcone wersje przez OCR
    const distortedVariants = [
        'equlpnent', 'equlpment', 'equlpmant', 'equlpmetn',
        'eqiupment', 'eqlupment', 'equ1pment', 'equ1pmnt',
        'equiprnent', 'equiprment', 'equiprnnt', 'equiprnt'
    ];
    
    for (const variant of distortedVariants) {
        if (lowerText.includes(variant)) {
            logger.info(`[EQUIPMENT] ✅ Znaleziono zniekształconą wersję: ${variant}`);
            logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
            return true;
        }
    }
    
    logger.info(`[EQUIPMENT] ❌ Nie znaleziono słów kluczowych Equipment przy elastycznym sprawdzaniu`);
    logger.info(`[EQUIPMENT] ===== KONIEC ANALIZY EQUIPMENT =====`);
    return false;
}

// NOWA FUNKCJA POMOCNICZA - sprawdza czy słowo zawiera znaki interpunkcyjne
function hasPunctuation(word) {
    return /[.,\/#!$%\^&\*;:{}=\-_`~()[\]"'<>?\\|+=]/.test(word);
}

// Nowa funkcja - dzieli obraz na 50 części (10 wierszy x 5 kolumn)
async function cropImageRegion(inputPath, outputPath, regionNumber) {
    try {
        const image = sharp(inputPath);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Oblicz wymiary pojedynczej części
        const regionWidth = Math.floor(width / 5);
        const regionHeight = Math.floor(height / 10);
        
        // Oblicz pozycję na podstawie numeru części (1-50)
        const row = Math.floor((regionNumber - 1) / 5);
        const col = (regionNumber - 1) % 5;
        
        const left = col * regionWidth;
        const top = row * regionHeight;
        
        logger.info(`[CROP] Wycinanie części ${regionNumber}: pozycja (${left},${top}), wymiary (${regionWidth}x${regionHeight})`);
        
        await image
            .extract({ left, top, width: regionWidth, height: regionHeight })
            .png()
            .toFile(outputPath);
            
        logger.info(`[CROP] ✅ Wycięto część ${regionNumber} do: ${outputPath}`);
        return { width: regionWidth, height: regionHeight };
    } catch (error) {
        logger.error(`[CROP] ❌ Błąd wycinania części ${regionNumber}:`, error);
        throw error;
    }
}


// Łączy kilka części obrazu w jedną i odczytuje tekst - nowe ustawienia dla nicku
async function readTextFromCombinedImageRegions(inputPath, regions) {
    try {
        // Najpierw przetwórz cały obraz - powiększ 3x i popraw jakość
        const enhancedPath = inputPath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, '_enhanced.png');
        await sharp(inputPath)
            .resize({ 
                width: null, 
                height: null, 
                scale: 3 // Powiększ 3x
            })
            .sharpen({ sigma: 1.0 }) // Wyostrz
            .gamma(1.1) // Popraw gamma
            .png()
            .toFile(enhancedPath);
        
        logger.info(`[OCR] Powiększono cały obraz 3x z wyostrzeniem i poprawą gamma`);
        
        const image = sharp(enhancedPath);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Oblicz wymiary pojedynczej części (dla powiększonego obrazu)
        const regionWidth = Math.floor(width / 5);
        const regionHeight = Math.floor(height / 10);
        
        // Znajdź zakres części do połączenia
        const rows = regions.map(r => Math.floor((r - 1) / 5));
        const cols = regions.map(r => (r - 1) % 5);
        
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);
        
        // Oblicz wymiary połączonego obszaru
        const combinedLeft = minCol * regionWidth;
        const combinedTop = minRow * regionHeight;
        const combinedWidth = (maxCol - minCol + 1) * regionWidth;
        const combinedHeight = (maxRow - minRow + 1) * regionHeight;
        
        logger.info(`[OCR] Łączenie części ${regions.join(', ')} w jeden obszar:`);
        logger.info(`[OCR] Pozycja: (${combinedLeft}, ${combinedTop}), wymiary: ${combinedWidth}x${combinedHeight}`);
        
        // Wytnij połączony obszar z powiększonego obrazu
        const combinedPath = inputPath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, `_combined_${regions.join('_')}.png`);
        await image
            .extract({ left: combinedLeft, top: combinedTop, width: combinedWidth, height: combinedHeight })
            .png()
            .toFile(combinedPath);
        
        // Przetwórz połączony fragment
        const processedPath = combinedPath.replace('.png', '_processed.png');
        await preprocessImageForWhiteText(combinedPath, processedPath);
        
        // Odczytaj tekst z przetworzonego fragmentu - proste ustawienia OCR
        const { data: { text } } = await Tesseract.recognize(processedPath);
        
        logger.info(`[OCR] ===== WYNIK TESSERACT - NICK (części ${regions.join(', ')}) =====`);
        logger.info(`[NICK] POCZĄTEK TEKSTU:`);
        logger.info(text.trim());
        logger.info(`[NICK] KONIEC TEKSTU`);
        logger.info(`[OCR] ===============================`);
        
        // Usuń pliki tymczasowe
        await fs.unlink(enhancedPath).catch(() => {});
        await fs.unlink(combinedPath).catch(() => {});
        await fs.unlink(processedPath).catch(() => {});
        
        return text.trim();
    } catch (error) {
        logger.error(`[OCR] ❌ Błąd odczytu z połączonych części obrazu:`, error);
        throw error;
    }
}

// Łączy kilka części obrazu w jedną i odczytuje tekst - oryginalne ustawienia dla ataku
async function readTextFromCombinedImageRegionsOriginal(inputPath, regions) {
    try {
        const image = sharp(inputPath);
        const metadata = await image.metadata();
        const { width, height } = metadata;
        
        // Oblicz wymiary pojedynczej części (bez powiększenia)
        const regionWidth = Math.floor(width / 5);
        const regionHeight = Math.floor(height / 10);
        
        // Znajdź zakres części do połączenia
        const rows = regions.map(r => Math.floor((r - 1) / 5));
        const cols = regions.map(r => (r - 1) % 5);
        
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);
        
        // Oblicz wymiary połączonego obszaru
        const combinedLeft = minCol * regionWidth;
        const combinedTop = minRow * regionHeight;
        const combinedWidth = (maxCol - minCol + 1) * regionWidth;
        const combinedHeight = (maxRow - minRow + 1) * regionHeight;
        
        logger.info(`[OCR] Łączenie części ${regions.join(', ')} w jeden obszar (oryginalne ustawienia):`);
        logger.info(`[OCR] Pozycja: (${combinedLeft}, ${combinedTop}), wymiary: ${combinedWidth}x${combinedHeight}`);
        
        // Wytnij połączony obszar bez powiększenia
        const combinedPath = inputPath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, `_combined_original_${regions.join('_')}.png`);
        await image
            .extract({ left: combinedLeft, top: combinedTop, width: combinedWidth, height: combinedHeight })
            .png()
            .toFile(combinedPath);
        
        // Przetwórz połączony fragment z oryginalnymi ustawieniami
        const processedPath = combinedPath.replace('.png', '_processed.png');
        await preprocessImageForWhiteTextOriginal(combinedPath, processedPath);
        
        // Odczytaj tekst z przetworzonego fragmentu - oryginalne ustawienia OCR
        const { data: { text } } = await Tesseract.recognize(processedPath);
        
        logger.info(`[OCR] ===== WYNIK TESSERACT - ATAK (części ${regions.join(', ')}) =====`);
        logger.info(`[ATAK] POCZĄTEK TEKSTU:`);
        logger.info(text.trim());
        logger.info(`[ATAK] KONIEC TEKSTU`);
        logger.info(`[OCR] ===============================`);
        
        // Usuń pliki tymczasowe
        await fs.unlink(combinedPath).catch(() => {});
        await fs.unlink(processedPath).catch(() => {});
        
        return text.trim();
    } catch (error) {
        logger.error(`[OCR] ❌ Błąd odczytu z połączonych części obrazu (oryginalne ustawienia):`, error);
        throw error;
    }
}

// Funkcja do wyodrębnienia liter i cyfr z tekstu (bez znaków specjalnych)
function extractLettersAndNumbers(text) {
    // Usuń wszystkie znaki oprócz liter (polskich i angielskich) i cyfr
    const lettersAndNumbers = text.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]/g, '');
    return lettersAndNumbers;
}

// Funkcja do wyodrębnienia TYLKO liter z tekstu (bez cyfr i znaków specjalnych)
function extractLettersOnly(text) {
    // Usuń wszystkie znaki oprócz liter (polskich i angielskich)
    const lettersOnly = text.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, '');
    return lettersOnly;
}


// POPRAWIONA FUNKCJA - traktuje cały tekst jako jedną linię i wyodrębnia same litery
function findNicknameInText(text) {
    logger.info(`[OCR] Szukanie najdłuższego nicku BEZ znaków interpunkcyjnych w tekście z części 1-5`);
    
    // Zamień wszystkie znaki nowej linii na spacje i traktuj jako jedną linię
    const singleLine = text.replace(/\n/g, ' ').trim();
    logger.info(`[OCR] Cały tekst w jednej linii: "${singleLine}"`);
    
    const words = singleLine.split(/\s+/);
    const filteredWords = words.filter(word => /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(word));
    logger.info(`[OCR] Znalezione słowa w całym tekście:`, filteredWords);
    
    // Szukamy najdłuższego słowa, ale licząc TYLKO litery (bez cyfr)
    let longestNick = '';
    let originalWord = '';
    
    for (let j = 0; j < filteredWords.length; j++) {
        const word = filteredWords[j];
        logger.info(`[OCR] Sprawdzanie słowa ${j + 1}: "${word}"`);
        
        // Wyodrębnij TYLKO litery z słowa (bez cyfr i znaków specjalnych)
        const lettersOnly = extractLettersOnly(word);
        logger.info(`[OCR] Litery wyodrębnione ze słowa "${word}": "${lettersOnly}"`);
        
        // Sprawdź długość słowa po wyodrębnieniu TYLKO liter
        if (lettersOnly.length >= 3 && lettersOnly.length > longestNick.length) {
            // Ale jako nick zwróć litery i cyfry razem
            const cleanNick = extractLettersAndNumbers(word);
            longestNick = lettersOnly; // Do porównania długości używamy tylko liter
            originalWord = word;
            logger.info(`[OCR] ✅ Nowy najdłuższy nick: "${cleanNick}" (${lettersOnly.length} liter) z oryginalnego słowa "${word}"`);
        } else if (lettersOnly.length < 3) {
            logger.info(`[OCR] ❌ Słowo "${word}" ma tylko ${lettersOnly.length} liter (minimum 3 litery)`);
        } else {
            logger.info(`[OCR] ❌ Słowo "${word}" ma ${lettersOnly.length} liter, krótsze niż obecne najdłuższe (${longestNick.length})`);
        }
    }
    
    // Jeśli znaleziono najdłuższy nick
    if (longestNick.length >= 3) {
        // Zwróć pełny nick (litery + cyfry) z najdłuższego słowa
        const finalNick = extractLettersAndNumbers(originalWord);
        logger.info(`[OCR] ✅ Znaleziono najdłuższy nick "${finalNick}" w całym tekście (${longestNick.length} liter z oryginalnego słowa "${originalWord}")`);
        return { nickname: finalNick, lineIndex: 0 };
    } else {
        logger.info(`[OCR] ❌ Nie znaleziono odpowiednio długiego nicku w całym tekście`);
        return { nickname: null, lineIndex: -1 };
    }
}

function extractAttackFromText(text) {
    logger.info(`[OCR] Ekstraktacja ataku z tekstu części 7 i 8: "${text}"`);
    const numberMatches = text.match(/\b\d+\b/g);
    
    if (numberMatches) {
        logger.info(`[OCR] Znalezione liczby w tekście:`, numberMatches);
        for (const numStr of numberMatches) {
            const num = parseInt(numStr);
            logger.info(`[OCR] Sprawdzam liczbę: ${num}`);
            if (num >= 100 && num <= 10000000) {
                logger.info(`[OCR] ✅ Liczba ${num} mieści się w zakresie ataku`);
                return num;
            } else {
                logger.info(`[OCR] ❌ Liczba ${num} poza zakresem ataku (100-10M)`);
            }
        }
    } else {
        logger.info(`[OCR] Nie znaleziono liczb w tekście`);
    }
    
    return null;
}

function extractAttackFromLine(line) {
    logger.info(`[OCR] Ekstraktacja ataku z linii: "${line}"`);
    const numberMatches = line.match(/\b\d+\b/g);
    
    if (numberMatches) {
        logger.info(`[OCR] Znalezione liczby w linii:`, numberMatches);
        for (const numStr of numberMatches) {
            const num = parseInt(numStr);
            logger.info(`[OCR] Sprawdzam liczbę: ${num}`);
            if (num >= 100 && num <= 10000000) {
                logger.info(`[OCR] ✅ Liczba ${num} mieści się w zakresie ataku`);
                return num;
            } else {
                logger.info(`[OCR] ❌ Liczba ${num} poza zakresem ataku (100-10M)`);
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

async function preprocessImageForNickDetection(inputPath, outputPath) {
    try {
        logger.info(`[IMAGE] Przetwarzanie obrazu dla odczytu nicku: ${inputPath} -> ${outputPath}`);
        
        // Krok 1: Zamień wszystkie kolory na czarne, poza białym
        // Krok 2: Odwróć kolory (biały → czarny, czarny → biały)
        await sharp(inputPath)
            .threshold(240) // Wszystko co nie jest prawie białe staje się czarne
            .negate()       // Odwróć kolory: biały tekst → czarny tekst na białym tle
            .png()
            .toFile(outputPath);
        
        logger.info(`[IMAGE] ✅ Przetworzono obraz - kolory zamienione na czarno-białe i odwrócone`);
    } catch (error) {
        logger.error(`[IMAGE] ❌ Błąd przetwarzania obrazu dla nicku:`, error);
        throw error;
    }
}


async function extractStatsFromImage(imagePath) {
    logger.info(`[OCR] Rozpoczynam ekstraktację statystyk z obrazu z podziałem na części`);
    
    // Najpierw przetwórz cały obraz - zamień kolory dla lepszego odczytu nicku
    const preprocessedPath = imagePath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, '_preprocessed_for_nick.png');
    await preprocessImageForNickDetection(imagePath, preprocessedPath);
    
    let playerNick = null;
    let characterAttack = null;
    
    // Odczytaj nick z połączonych części 1-5 jako jeden obszar - użyj przetworzonego obrazu
    logger.info(`[OCR] Odczytywanie nicku z połączonych części 1-5...`);
    const nickText = await readTextFromCombinedImageRegions(preprocessedPath, [1, 2, 3, 4, 5]);
    const nicknameResult = findNicknameInText(nickText);
    
    if (nicknameResult.nickname) {
        playerNick = nicknameResult.nickname;
        logger.info(`[OCR] Znaleziono nick "${playerNick}" w połączonych częściach 1-5`);
        
    } else {
        logger.info(`[OCR] ❌ Nie znaleziono nicku w połączonych częściach 1-5 - zwracam błąd`);
        return {
            playerNick: null,
            characterAttack: null,
            confidence: 0,
            isValidEquipment: false
        };
    }
    
    // Odczytaj atak z połączonych części 7 i 8 jako jeden obszar - z oryginalnymi ustawieniami
    logger.info(`[OCR] Odczytywanie ataku z połączonych części 7 i 8...`);
    const attackText = await readTextFromCombinedImageRegionsOriginal(imagePath, [7, 8]);
    characterAttack = extractAttackFromText(attackText);
    
    if (characterAttack) {
        logger.info(`[OCR] Znaleziono atak ${characterAttack} w połączonych częściach 7 i 8`);
    } else {
        logger.info(`[OCR] ❌ Nie znaleziono ataku w połączonych częściach 7 i 8`);
    }
    
    const result = {
        playerNick,
        characterAttack,
        confidence: calculateSimpleConfidence(playerNick, characterAttack),
        isValidEquipment: true
    };
    
    // Usuń plik tymczasowy
    await fs.unlink(preprocessedPath).catch(() => {});
    
    logger.info(`[OCR] Finalne wyniki ekstraktacji:`, result);
    return result;
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
                .filter(n => n >= 100 && n <= 10000000)
                .sort((a, b) => b - a);
            logger.info(`[OCR] Liczby po filtracji i sortowaniu (100-10M):`, numbers);
            
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
        logger.info(`[OCR] Rozpoczynam preprocessowanie obrazu z oryginalnymi ustawieniami`);
        await preprocessImageForWhiteTextOriginal(imagePath, processedPath);
        
        await updateUserEphemeralReply(userId, '🔍 Analizuję obraz...', [], userEphemeralReplies);
        logger.info(`[OCR] Rozpoczynam rozpoznawanie tekstu Tesseract`);
        
        const { data: { text } } = await Tesseract.recognize(processedPath);
        
        logger.info(`[OCR] ===== WYNIK TESSERACT - CAŁY OBRAZ =====`);
        logger.info(`[OCR] Rozpoznany tekst (equipment):`);
        logger.info(`[EQUIPMENT] POCZĄTEK TEKSTU:`);
        logger.info(text);
        logger.info(`[EQUIPMENT] KONIEC TEKSTU`);
        logger.info(`[OCR] ===============================`);
        
        await fs.unlink(processedPath).catch(() => {});
        
        await updateUserEphemeralReply(userId, '📊 Sprawdzam czy to Equipment...', [], userEphemeralReplies);
        const hasEquipment = checkForEquipmentKeywordFlexible(text);
        
        if (!hasEquipment) {
            logger.info(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment - odrzucam obraz`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0
            };
        }
        
        await updateUserEphemeralReply(userId, '📊 Analizuję statystyki z części obrazu...', [], userEphemeralReplies);
        logger.info(`[OCR] Rozpoczynam analizę statystyk z podziałem na części`);
        
        const stats = await extractStatsFromImage(imagePath);
        
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
    preprocessImageForNickDetection,
    checkForEquipmentKeyword,
    checkForEquipmentKeywordFlexible,
    findNicknameInText,
    extractLettersAndNumbers,
    extractLettersOnly,
    extractAttackFromLine,
    extractAttackFromText,
    calculateSimpleConfidence,
    extractStatsFromLines,
    extractStatsFromImage,
    cropImageRegion,
    readTextFromCombinedImageRegions,
    readTextFromCombinedImageRegionsOriginal,
    preprocessImageForWhiteTextOriginal,
    preprocessImageStalkerStyle,
    extractOptimizedStatsFromImage
};
