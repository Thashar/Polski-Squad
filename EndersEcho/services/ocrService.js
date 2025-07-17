const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const { logWithTimestamp } = require('../utils/helpers');

class OCRService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Sprawdza czy obraz zawiera wymagane słowa "Best" i "Total"
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<boolean>} - Czy obraz zawiera wymagane słowa
     */
    async checkRequiredWords(imagePath) {
        try {
            const processedPath = imagePath.replace(
                new RegExp(`\\.(${this.config.images.supportedExtensions.join('|').replace(/\./g, '')})$`, 'i'),
                this.config.images.checkSuffix
            );
            
            await sharp(imagePath)
                .grayscale()
                .threshold(this.config.ocr.threshold)
                .negate()
                .png()
                .toFile(processedPath);
            
            logger.info('Sprawdzam obecność wymaganych słów w obrazie...');
            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                logger: m => logger.info(`Word Check Progress: ${m.status}`),
                tessedit_char_whitelist: this.config.ocr.charWhitelistWords
            });
            
            await fs.unlink(processedPath).catch(() => {});
            
            const hasBest = /best\s*:/i.test(text.trim());
            const hasTotal = /total\s*:/i.test(text.trim());
            
            logger.info('Tekst z obrazu:', text.trim());
            logger.info('Znaleziono "Best:":', hasBest);
            logger.info('Znaleziono "Total:":', hasTotal);
            
            return hasBest && hasTotal;
        } catch (error) {
            logger.error('Błąd podczas sprawdzania wymaganych słów:', error);
            return false;
        }
    }

    /**
     * Przetwarza obraz dla lepszego rozpoznawania białego tekstu
     * @param {string} inputPath - Ścieżka do obrazu wejściowego
     * @param {string} outputPath - Ścieżka do obrazu wyjściowego
     */
    async preprocessImageForWhiteText(inputPath, outputPath) {
        try {
            await sharp(inputPath)
                .grayscale()
                .threshold(this.config.ocr.threshold)
                .negate()
                .png()
                .toFile(outputPath);
            
            logger.info('Obraz został przetworzony dla białego tekstu');
        } catch (error) {
            logger.error('Błąd przetwarzania obrazu:', error);
            throw error;
        }
    }

    /**
     * Wyodrębnia tekst z obrazu przy użyciu OCR
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<string>} - Wyodrębniony tekst
     */
    async extractTextFromImage(imagePath) {
        try {
            const processedPath = imagePath.replace(
                new RegExp(`\\.(${this.config.images.supportedExtensions.join('|').replace(/\./g, '')})$`, 'i'),
                this.config.images.processedSuffix
            );
            
            await this.preprocessImageForWhiteText(imagePath, processedPath);
            
            logger.info('Rozpoczynam OCR...');
            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                logger: m => logger.info(`OCR Progress: ${m.status} - ${m.progress}`),
                tessedit_char_whitelist: this.config.ocr.charWhitelist
            });
            
            await fs.unlink(processedPath).catch(() => {});
            
            return text.trim();
        } catch (error) {
            logger.error('Błąd OCR:', error);
            throw error;
        }
    }

    /**
     * Poprawia format wyniku (korekcja błędów OCR)
     * @param {string} scoreText - Tekst wyniku
     * @returns {string} - Poprawiony tekst wyniku
     */
    fixScoreFormat(scoreText) {
        let fixedScore = scoreText;
        
        // Zamień TT na 1T - jeśli wynik kończy się na TT, zamień pierwsze T na 1
        fixedScore = fixedScore.replace(/TT$/i, '1T');
        
        // Zamień 7 na końcu na T (jeśli nie ma już jednostki)
        // Sprawdź czy wynik kończy się cyfrą 7 i nie ma jednostki K/M/B/T/Q/S
        if (/7$/.test(fixedScore) && !/[KMBTQS]$/i.test(fixedScore)) {
            fixedScore = fixedScore.replace(/7$/, 'T');
            logger.info('Zastąpiono końcową cyfrę 7 na literę T');
        }
        
        logger.info('Oryginalny wynik:', scoreText);
        logger.info('Poprawiony wynik:', fixedScore);
        
        return fixedScore;
    }

    /**
     * Wyodrębnia wynik po słowie "Best"
     * @param {string} text - Tekst z OCR
     * @returns {string|null} - Wyodrębniony wynik lub null
     */
    extractScoreAfterBest(text) {
        logger.info('Pełny tekst z OCR:');
        logger.info(text);
        logger.info('Analizowany tekst OCR:', text);
        
        // Rozszerzony wzorzec który uwzględnia również cyfry końcowe (mogące być błędnie odczytanymi literami)
        const bestScorePattern = /best\s*:?\s*(\d+(?:\.\d+)?[KMBTQSi7]*)/gi;
        let matches = text.match(bestScorePattern);
        
        logger.info('Znalezione dopasowania Best (wzorzec 1):', matches);
        
        if (!matches || matches.length === 0) {
            // Elastyczny wzorzec też uwzględnia cyfry końcowe
            const flexiblePattern = /best[\s\S]*?(\d+(?:\.\d+)?[KMBTQSi7]*)/gi;
            matches = [];
            let match;
            
            while ((match = flexiblePattern.exec(text)) !== null) {
                const score = match[1];
                const upperScore = score.toUpperCase();
                const hasUnit = /[KMBTQSi7]$/i.test(upperScore);
                const isBigNumber = /^\d{4,}$/.test(score);
                
                if (hasUnit || isBigNumber) {
                    matches.push(score);
                    break;
                }
            }
            
            logger.info('Znalezione dopasowania Best (wzorzec elastyczny):', matches);
            
            if (matches.length === 0) {
                logger.info('Nie znaleziono słowa "Best" z wynikiem');
                return null;
            }
        } else {
            // Zaktualizowany wzorzec dla wyciągania wyniku
            const scoreMatch = matches[0].match(/(\d+(?:\.\d+)?[KMBTQSi7]*)/i);
            matches = scoreMatch ? [scoreMatch[1]] : [];
        }
        
        if (matches.length > 0) {
            let result = matches[0];
            logger.info('Wyodrębniony wynik po "Best" (przed poprawką):', result);
            
            // Zastosuj poprawki: TT -> 1T oraz 7 -> T
            result = this.fixScoreFormat(result);
            
            logger.info('Wyodrębniony wynik po "Best" (po poprawce):', result);
            return result;
        }
        
        return null;
    }

    /**
     * Wyodrębnia nazwę bossa z drugiej linijki tekstu OCR
     * @param {string} text - Tekst z OCR
     * @returns {string|null} - Nazwa bossa lub null
     */
    extractBossName(text) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        if (lines.length >= 2) {
            const bossLine = lines[1];
            logger.info('Druga linijka tekstu (boss):', bossLine);
            
            // Oczyszczenie nazwy bossa z niepotrzebnych znaków
            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();
            logger.info('Oczyszczona nazwa bossa:', cleanBossName);
            
            return cleanBossName || null;
        }
        
        logger.info('Brak drugiej linijki dla nazwy bossa');
        return null;
    }
}

module.exports = OCRService;