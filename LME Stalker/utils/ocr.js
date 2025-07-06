const Tesseract = require('tesseract.js');
const { createCanvas, loadImage } = require('canvas');
const config = require('../config/config');

/**
 * Funkcja do konwersji obrazu na czarno-biały
 */
async function convertToBlackAndWhite(imageUrl) {
    console.log('⚫⚪ ==================== KONWERSJA NA CZARNO-BIAŁY ====================');
    console.log(`📷 Przetwarzanie obrazu: ${imageUrl}`);
    
    try {
        const image = await loadImage(imageUrl);
        console.log(`✅ Obraz załadowany: ${image.width}x${image.height}px`);
        
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const data = imageData.data;
        
        const WHITE_THRESHOLD = 200;
        let whitePixels = 0;
        let blackPixels = 0;
        
        for (let i = 0; i < data.length; i += 4) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];
            const brightness = (red * 0.299 + green * 0.587 + blue * 0.114);
            
            if (brightness >= WHITE_THRESHOLD) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                whitePixels++;
            } else {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                blackPixels++;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        const buffer = canvas.toBuffer('image/png');
        
        console.log('✅ Konwersja na czarno-biały zakończona');
        return buffer;
        
    } catch (error) {
        console.error('❌ Błąd podczas konwersji na czarno-biały:', error);
        throw error;
    }
}

/**
 * Funkcja do podniesienia kontrastu obrazu
 */
async function enhanceImageContrast(imageBuffer) {
    console.log('📈 ==================== PODNOSZENIE KONTRASTU ====================');
    
    try {
        const image = await loadImage(imageBuffer);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const data = imageData.data;
        
        const contrast = 2.0;
        const brightness = 20;
        
        for (let i = 0; i < data.length; i += 4) {
            for (let j = 0; j < 3; j++) {
                let value = data[i + j];
                value = ((value - 128) * contrast) + 128 + brightness;
                value = Math.max(0, Math.min(255, value));
                data[i + j] = value;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        const buffer = canvas.toBuffer('image/png');
        
        console.log('✅ Podniesienie kontrastu zakończone');
        return buffer;
        
    } catch (error) {
        console.error('❌ Błąd podczas podnoszenia kontrastu:', error);
        throw error;
    }
}

/**
 * Funkcja do szczegółowej analizy obrazu za pomocą OCR
 */
async function analyzeImage(imageUrl) {
    console.log('\n🔍 ==================== ROZPOCZĘCIE ANALIZY OCR ====================');
    
    try {
        const blackWhiteImageBuffer = await convertToBlackAndWhite(imageUrl);
        const enhancedImageBuffer = await enhanceImageContrast(blackWhiteImageBuffer);
        
        console.log('\n📖 ==================== URUCHAMIANIE OCR ====================');
        const { data: { text } } = await Tesseract.recognize(enhancedImageBuffer, 'pol', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    console.log(`📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
                }
            },
            tessedit_char_whitelist: config.POLISH_ALPHABET
        });
        
        console.log('\n📄 ==================== PEŁNY TEKST Z OCR ====================');
        console.log('🔤 Odczytany tekst:');
        console.log('--- POCZĄTEK TEKSTU ---');
        console.log(text);
        console.log('--- KONIEC TEKSTU ---');
        
        const lines = text.split('\n');
        const zeroScorePlayers = [];
        
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            
            if (trimmedLine.length === 0) continue;
            
            const containsZero = hasZeroScore(trimmedLine);
            
            if (containsZero) {
                const longestWord = findLongestWord(trimmedLine);
                if (longestWord) {
                    zeroScorePlayers.push(longestWord);
                }
            }
        }
        
        console.log(`\n🎯 Znaleziono ${zeroScorePlayers.length} graczy z wynikiem 0`);
        if (zeroScorePlayers.length > 0) {
            console.log(`👥 Lista: ${zeroScorePlayers.join(', ')}`);
        }
        
        return zeroScorePlayers;
        
    } catch (error) {
        console.error('❌ Błąd OCR:', error);
        return [];
    }
}

/**
 * Funkcja do sprawdzania czy linia zawiera wynik 0
 */
function hasZeroScore(line) {
    let processedLine = line.replace(/\(1\)/g, '0');
    processedLine = processedLine.replace(/\[1\]/g, '0');
    processedLine = processedLine.replace(/\[1(?!\])/g, '0');
    processedLine = processedLine.replace(/\(1(?!\))/g, '0');
    
    const zeroPatterns = [
        /\s+0\s+/, /\s+0$/, /^0\s+/, /\s+0\.0\s+/, /\s+0\.0$/, /\s+0,0\s+/, /\s+0,0$/
    ];
    
    const oPatterns = [
        /\s+o\s+/, /\s+o$/, /^o\s+/
    ];
    
    const zoPatterns = [
        /\s+zo\s+/, /\s+zo$/, /^zo\s+/
    ];
    
    for (const pattern of zeroPatterns) {
        if (pattern.test(processedLine)) {
            return true;
        }
    }
    
    for (const pattern of zoPatterns) {
        if (pattern.test(processedLine.toLowerCase())) {
            return true;
        }
    }
    
    for (const pattern of oPatterns) {
        if (pattern.test(processedLine)) {
            const threeDigitPattern = /\d{3}$/;
            if (threeDigitPattern.test(processedLine.trim())) {
                return false;
            }
            return true;
        }
    }
    
    return false;
}

/**
 * Funkcja do znajdowania najdłuższego słowa w linii
 */
function findLongestWord(line) {
    const words = line.split(/\s+/);
    let longestWord = '';
    let longestLength = 0;
    
    for (const word of words) {
        const processedWord = word.trim();
        if (processedWord.length > longestLength) {
            longestWord = processedWord;
            longestLength = processedWord.length;
        }
    }
    
    return longestWord.length > 0 ? longestWord : null;
}

module.exports = {
    convertToBlackAndWhite,
    enhanceImageContrast,
    analyzeImage,
    hasZeroScore,
    findLongestWord
};
