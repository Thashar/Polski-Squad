const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');
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
        logger.info('Rozpoczynam preprocessing obrazu...');
        
        try {
            const outputPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '_processed.png');
            
            if (channelConfig.name === 'Daily') {
                logger.info('Daily - używam metody dla białego tekstu na szarym tle');
                return await this.preprocessWhiteTextOnGray(imagePath, outputPath);
            } else {
                logger.info('CX - używam zaawansowanej konwersji biało-czarnej');
                return await this.preprocessBlackWhite(imagePath, outputPath);
            }
        } catch (error) {
            logger.error(`Błąd preprocessingu: ${error.message}`);
            throw error;
        }
    }

    /**
     * Preprocessing dla białego tekstu na szarym tle (Daily) - ustawienia z Rekrutera dla ataku
     * @param {string} imagePath - Ścieżka do obrazu
     * @param {string} outputPath - Ścieżka wyjściowa
     * @returns {string} - Ścieżka do przetworzonego obrazu
     */
    async preprocessWhiteTextOnGray(imagePath, outputPath) {
        logger.info('Użycie ustawień OCR z Rekrutera dla ataku z korekcją gamma 2.5');
        
        await sharp(imagePath)
            .gamma(2.5)
            .grayscale()
            .threshold(200)
            .negate()
            .png()
            .toFile(outputPath);
        
        logger.info('Preprocessing dla białego tekstu zakończony (styl Rekruter - atak + gamma 2.5)');
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
            .gamma(this.config.ocr.gamma)
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        logger.info(`Informacje o obrazie: ${info.width}x${info.height}, ${info.channels} kanały, ${Math.round(data.length / 1024)}KB`);

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
        logger.info(`Pikseli białych: ${whitePixels} (${whitePercentage}%), czarnych: ${blackPixels}`);

        await sharp(data, {
            raw: {
                width: info.width,
                height: info.height,
                channels: info.channels
            }
        })
        .png()
        .toFile(outputPath);

        logger.info('Zaawansowany preprocessing zakończony');
        return outputPath;
    }

    /**
     * Rozpoznaje tekst z obrazu
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {string} - Rozpoznany tekst
     */
    async extractTextFromImage(imagePath) {
        logger.info('Rozpoczynam rozpoznawanie tekstu OCR...');
        
        const { data: { text } } = await Tesseract.recognize(imagePath, this.config.ocr.languages, {
            tessedit_char_whitelist: this.config.ocr.charWhitelist,
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
            textord_heavy_nr: '1',
            textord_debug_tabfind: '0',
            classify_bln_numeric_mode: '1'
        });

        logger.info(`Rozpoznany tekst: "${text.trim()}"`);

        return text;
    }

    /**
     * Normalizuje wynik z tekstu
     * @param {string} scoreText - Tekst wyniku
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object} - Znormalizowany wynik
     */
    normalizeScore(scoreText, channelConfig) {
        logger.info(`Normalizacja wyniku: "${scoreText}"`);
        
        // Specjalne wyjątki dla Daily
        if (channelConfig.name === 'Daily') {
            // Wyjątek 1: "sg" -> "9"
            if (scoreText.toLowerCase().includes('sg')) {
                logger.info('DAILY: Wykryto "sg" - zamieniam na "9"');
                scoreText = scoreText.toLowerCase().replace(/sg/g, '9');
            }
            
            // Wyjątek 2: "&" i "& " -> "9" (przed dwucyfrowym wynikiem)
            if (scoreText.includes('&')) {
                logger.info('DAILY: Wykryto "&" - zamieniam na "9"');
                scoreText = scoreText.replace(/& /g, '9').replace(/&/g, '9');
            }
        }

        let normalized = scoreText;
        
        // Podstawowe zamienniki
        for (const [char, digit] of Object.entries(this.config.charReplacements)) {
            normalized = normalized.replace(new RegExp(char, 'g'), digit);
        }

        // Specjalne traktowanie 's' i 'S'
        if (normalized.includes('s') || normalized.includes('S')) {
            logger.info('Wykryto s/S - testuję warianty 5 i 8');
            
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
        
        logger.info(`Wynik po normalizacji: "${finalResult}"`);
        
        return {
            hasVariants: false,
            normalized: finalResult,
            original: scoreText
        };
    }
}

module.exports = OCRService;