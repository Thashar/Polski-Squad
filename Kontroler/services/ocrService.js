const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { logWithTimestamp } = require('../utils/helpers');

class OCRService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Sprawdza czy piksel jest biały lub bardzo jasny
     * @param {number} r - Wartość czerwona
     * @param {number} g - Wartość zielona
     * @param {number} b - Wartość niebieska
     * @param {number} threshold - Próg jasności
     * @returns {boolean} - Czy piksel jest jasny
     */
    isWhiteOrNearWhite(r, g, b, threshold = 200) {
        return r >= threshold && g >= threshold && b >= threshold;
    }

    /**
     * Preprocessing obrazu - różne metody dla różnych kanałów
     * @param {string} imagePath - Ścieżka do obrazu
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {string} - Ścieżka do przetworzonego obrazu
     */
    async preprocessImage(imagePath, channelConfig) {
        logWithTimestamp('Rozpoczynam preprocessing obrazu...', 'info');
        
        try {
            const outputPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '_processed.png');
            
            if (channelConfig.name === 'Daily') {
                logWithTimestamp('Daily - używam metody dla białego tekstu na szarym tle', 'info');
                return await this.preprocessWhiteTextOnGray(imagePath, outputPath);
            } else {
                logWithTimestamp('CX - używam zaawansowanej konwersji biało-czarnej', 'info');
                return await this.preprocessBlackWhite(imagePath, outputPath);
            }
        } catch (error) {
            logWithTimestamp(`Błąd preprocessingu: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Preprocessing dla białego tekstu na szarym tle (Daily)
     * @param {string} imagePath - Ścieżka do obrazu
     * @param {string} outputPath - Ścieżka wyjściowa
     * @returns {string} - Ścieżka do przetworzonego obrazu
     */
    async preprocessWhiteTextOnGray(imagePath, outputPath) {
        const { data, info } = await sharp(imagePath)
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        logWithTimestamp(`Informacje o obrazie: ${info.width}x${info.height}, ${info.channels} kanały, ${Math.round(data.length / 1024)}KB`, 'info');

        let whitePixels = 0;
        let blackPixels = 0;
        
        for (let i = 0; i < data.length; i += info.channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            
            if (luminance >= this.config.ocr.luminanceThresholds.white) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                whitePixels++;
            } else if (luminance <= this.config.ocr.luminanceThresholds.black) {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                blackPixels++;
            } else {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                blackPixels++;
            }
        }

        const totalPixels = whitePixels + blackPixels;
        const whitePercentage = ((whitePixels / totalPixels) * 100).toFixed(1);
        logWithTimestamp(`Pikseli białych: ${whitePixels} (${whitePercentage}%), czarnych: ${blackPixels}`, 'info');

        await sharp(data, {
            raw: {
                width: info.width,
                height: info.height,
                channels: info.channels
            }
        })
        .sharpen(2, 1, 2)
        .png()
        .toFile(outputPath);

        logWithTimestamp('Preprocessing dla białego tekstu zakończony', 'success');
        return outputPath;
    }

    /**
     * Preprocessing biało-czarny (CX)
     * @param {string} imagePath - Ścieżka do obrazu
     * @param {string} outputPath - Ścieżka wyjściowa
     * @returns {string} - Ścieżka do przetworzonego obrazu
     */
    async preprocessBlackWhite(imagePath, outputPath) {
        const { data, info } = await sharp(imagePath)
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        logWithTimestamp(`Informacje o obrazie: ${info.width}x${info.height}, ${info.channels} kanały, ${Math.round(data.length / 1024)}KB`, 'info');

        let whitePixels = 0;
        let blackPixels = 0;
        
        for (let i = 0; i < data.length; i += info.channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            if (this.isWhiteOrNearWhite(r, g, b, 180)) {
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

        const totalPixels = whitePixels + blackPixels;
        const whitePercentage = ((whitePixels / totalPixels) * 100).toFixed(1);
        logWithTimestamp(`Pikseli białych: ${whitePixels} (${whitePercentage}%), czarnych: ${blackPixels}`, 'info');

        await sharp(data, {
            raw: {
                width: info.width,
                height: info.height,
                channels: info.channels
            }
        })
        .png()
        .toFile(outputPath);

        logWithTimestamp('Zaawansowany preprocessing zakończony', 'success');
        return outputPath;
    }

    /**
     * Rozpoznaje tekst z obrazu
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {string} - Rozpoznany tekst
     */
    async extractTextFromImage(imagePath) {
        logWithTimestamp('Rozpoczynam rozpoznawanie tekstu OCR...', 'info');
        
        const { data: { text } } = await Tesseract.recognize(imagePath, this.config.ocr.languages, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    console.log(`📖 OCR Progress: ${Math.round(m.progress * 100)}%`);
                }
            },
            tessedit_char_whitelist: this.config.ocr.charWhitelist,
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
            textord_heavy_nr: '1',
            textord_debug_tabfind: '0',
            classify_bln_numeric_mode: '1'
        });

        logWithTimestamp('Rozpoznany tekst:', 'info');
        console.log('─'.repeat(50));
        console.log(text);
        console.log('─'.repeat(50));

        return text;
    }

    /**
     * Normalizuje wynik z tekstu
     * @param {string} scoreText - Tekst wyniku
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object} - Znormalizowany wynik
     */
    normalizeScore(scoreText, channelConfig) {
        logWithTimestamp(`Normalizacja wyniku: "${scoreText}"`, 'info');
        
        // Specjalny wyjątek dla Daily: "sg" -> "9"
        if (channelConfig.name === 'Daily' && scoreText.toLowerCase().includes('sg')) {
            logWithTimestamp('DAILY: Wykryto "sg" - zamieniam na "9"', 'info');
            scoreText = scoreText.toLowerCase().replace(/sg/g, '9');
        }

        let normalized = scoreText;
        
        // Podstawowe zamienniki
        for (const [char, digit] of Object.entries(this.config.charReplacements)) {
            normalized = normalized.replace(new RegExp(char, 'g'), digit);
        }

        // Specjalne traktowanie 's' i 'S'
        if (normalized.includes('s') || normalized.includes('S')) {
            logWithTimestamp('Wykryto s/S - testuję warianty 5 i 8', 'info');
            
            const variant5Text = normalized.replace(/[sS]/g, '5');
            const variant5Numbers = variant5Text.match(/\d+/g);
            const variant5 = variant5Numbers ? variant5Numbers.join('') : '';
            
            const variant8Text = normalized.replace(/[sS]/g, '8');
            const variant8Numbers = variant8Text.match(/\d+/g);
            const variant8 = variant8Numbers ? variant8Numbers.join('') : '';
            
            return {
                hasVariants: true,
                variant5: variant5,
                variant8: variant8,
                original: scoreText
            };
        }

        const numbersOnly = normalized.match(/\d+/g);
        const finalResult = numbersOnly ? numbersOnly.join('') : '';
        
        logWithTimestamp(`Wynik po normalizacji: "${finalResult}"`, 'info');
        
        return {
            hasVariants: false,
            normalized: finalResult,
            original: scoreText
        };
    }
}

module.exports = OCRService;