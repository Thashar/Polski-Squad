const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');
const { saveProcessedImage } = require('../../utils/ocrFileUtils');

const logger = createBotLogger('EndersEcho');

class OCRService {
    constructor(config) {
        this.config = config;
    }

    /**
     * Inicjalizuje folder dla przetworzonych obrazów
     */
    async initialize() {
        if (this.config.ocr.saveProcessedImages) {
            await fs.mkdir(this.config.ocr.processedDir, { recursive: true });
        }
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
            
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logImageProcessing) {
                logger.info('🔍 Szczegółowy debug: Sprawdzam obecność wymaganych słów w obrazie...');
            } else {
                logger.info('Sprawdzam obecność wymaganych słów w obrazie...');
            }
            
            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                logger: m => {
                    if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logImageProcessing) {
                        logger.info(`📊 Word Check Progress: ${m.status}`);
                    }
                },
                tessedit_char_whitelist: this.config.ocr.charWhitelistWords
            });
            
            await fs.unlink(processedPath).catch(() => {});
            
            const hasBest = /best\s*:/i.test(text.trim());
            const hasTotal = /total\s*:/i.test(text.trim());
            
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                logger.info('📝 Szczegółowy debug: Tekst z obrazu: "' + text.trim() + '"');
                logger.info('🔍 Szczegółowy debug: Znaleziono "Best:":', hasBest);
                logger.info('🔍 Szczegółowy debug: Znaleziono "Total:":', hasTotal);
            } else {
                logger.info('Tekst z obrazu: "' + text.trim() + '"');
                logger.info('Znaleziono "Best:":', hasBest);
                logger.info('Znaleziono "Total:":', hasTotal);
            }
            
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
            
            // Zapisz przetworzone zdjęcie na dysku jeśli włączone
            logger.info(`🔧 Debug: saveProcessedImages = ${this.config.ocr.saveProcessedImages}`);
            if (this.config.ocr.saveProcessedImages) {
                logger.info('🔧 Debug: Zapisuję przetworzony obraz EndersEcho z: ' + outputPath);
                await saveProcessedImage(
                    outputPath,
                    this.config.ocr.processedDir,
                    'ENDERSECHO',
                    'endersecho',
                    this.config.ocr.maxProcessedFiles,
                    logger
                );
            } else {
                logger.info(`🔧 Debug: Zapisywanie przetworzonych obrazów WYŁĄCZONE`);
            }
            
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
                tessedit_char_whitelist: this.config.ocr.charWhitelist
            });
            
            await fs.unlink(processedPath).catch(() => {});
            
            const trimmedText = text.trim();
            
            // Dodatkowe debugowanie
            logger.info('🔍 DEBUG: text przed trim: "' + text + '"');
            logger.info('🔍 DEBUG: text type: ' + typeof text);
            logger.info('🔍 DEBUG: text length przed trim: ' + (text ? text.length : 'null/undefined'));
            logger.info('🔍 DEBUG: trimmedText: "' + trimmedText + '"');
            logger.info('🔍 DEBUG: trimmedText type: ' + typeof trimmedText);
            logger.info('🔍 DEBUG: trimmedText length: ' + (trimmedText ? trimmedText.length : 'null/undefined'));
            
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                logger.info('📝 Szczegółowy debug - wyodrębniony tekst z OCR: "' + trimmedText + '"');
                logger.info('📝 Szczegółowy debug - długość tekstu: ' + trimmedText.length);
            } else {
                logger.info('Wyodrębniony tekst z OCR: "' + trimmedText + '"');
                logger.info('Długość tekstu: ' + trimmedText.length);
            }
            
            return trimmedText;
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
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                logger.info('Zastąpiono końcową cyfrę 7 na literę T');
            }
        }
        
        // Zamień 0 na końcu na Q (jeśli nie ma już jednostki M/B/T/Q/Qi)
        // Sprawdź czy wynik kończy się cyfrą 0 i nie ma jednostki M/B/T/Q/Qi
        if (/0$/.test(fixedScore) && !/[MBTQ]i?$/i.test(fixedScore)) {
            fixedScore = fixedScore.replace(/0$/, 'Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                logger.info('Zastąpiono końcową cyfrę 0 na literę Q');
            }
        }
        
        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            logger.info('Oryginalny wynik:', scoreText);
            logger.info('Poprawiony wynik:', fixedScore);
        }
        
        return fixedScore;
    }

    /**
     * Wyodrębnia wynik po słowie "Best"
     * @param {string} text - Tekst z OCR
     * @returns {string|null} - Wyodrębniony wynik lub null
     */
    extractScoreAfterBest(text) {
        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            logger.info('📊 Szczegółowy debug: Pełny tekst z OCR: "' + text + '"');
            logger.info('📊 Szczegółowy debug: Analizowany tekst OCR: "' + text + '"');
            logger.info('📊 Szczegółowy debug: Długość tekstu:', text ? text.length : 'null');
        } else {
            logger.info('Pełny tekst z OCR: "' + text + '"');
            logger.info('Analizowany tekst OCR: "' + text + '"');
            logger.info('Długość tekstu:', text ? text.length : 'null');
        }
        
        // Rozszerzony wzorzec który uwzględnia również cyfry końcowe (mogące być błędnie odczytanymi literami)
        const bestScorePattern = /best\s*:?\s*(\d+(?:\.\d+)?[KMBTQSi70]*)/gi;
        let matches = text.match(bestScorePattern);
        
        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            logger.info('🎯 Szczegółowy debug: Znalezione dopasowania Best (wzorzec 1):', matches);
        } else {
            logger.info('Znalezione dopasowania Best (wzorzec 1):', matches);
        }
        
        if (!matches || matches.length === 0) {
            // Elastyczny wzorzec też uwzględnia cyfry końcowe
            const flexiblePattern = /best[\s\S]*?(\d+(?:\.\d+)?[KMBTQSi70]*)/gi;
            matches = [];
            let match;
            
            while ((match = flexiblePattern.exec(text)) !== null) {
                const score = match[1];
                const upperScore = score.toUpperCase();
                const hasUnit = /[KMBTQSi70]$/i.test(upperScore);
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
            const scoreMatch = matches[0].match(/(\d+(?:\.\d+)?[KMBTQSi70]*)/i);
            matches = scoreMatch ? [scoreMatch[1]] : [];
        }
        
        if (matches.length > 0) {
            let result = matches[0];
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('Wyodrębniony wynik po "Best" (przed poprawką): "' + result + '"');
                logger.info('🔍 DEBUG: result przed poprawką type: ' + typeof result);
                logger.info('🔍 DEBUG: result przed poprawką length: ' + (result ? result.length : 'null/undefined'));
            }
            
            // Zastosuj poprawki: TT -> 1T oraz 7 -> T
            result = this.fixScoreFormat(result);
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('Wyodrębniony wynik po "Best" (po poprawce): "' + result + '"');
                logger.info('🔍 DEBUG: result po poprawce type: ' + typeof result);
                logger.info('🔍 DEBUG: result po poprawce length: ' + (result ? result.length : 'null/undefined'));
            }
            
            // Sprawdź czy wynik nie jest pusty po korekcjach
            if (!result || result.trim() === '') {
                logger.info('Wynik jest pusty po korekcjach');
                return null;
            }
            
            return result;
        }
        
        logger.info('Brak dopasowań - zwracam null');
        return null;
    }

    /**
     * Wyodrębnia nazwę bossa z drugiej linijki tekstu OCR
     * Jeśli druga linijka zawiera cyfry, używa pierwszej linijki
     * @param {string} text - Tekst z OCR
     * @returns {string|null} - Nazwa bossa lub null
     */
    extractBossName(text) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        if (lines.length >= 2) {
            const secondLine = lines[1];
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                logger.info('Druga linijka tekstu (boss):', secondLine);
            }
            
            // Sprawdź czy druga linijka zawiera cyfry
            const hasDigits = /\d/.test(secondLine);
            
            let bossLine;
            if (hasDigits && lines.length >= 1) {
                // Jeśli druga linijka ma cyfry, użyj pierwszej linijki
                bossLine = lines[0];
                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                    logger.info('Druga linijka zawiera cyfry, używam pierwszej linijki:', bossLine);
                }
            } else {
                // Standardowo używaj drugiej linijki
                bossLine = secondLine;
                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                    logger.info('Używam drugiej linijki (brak cyfr):', bossLine);
                }
            }
            
            // Oczyszczenie nazwy bossa z niepotrzebnych znaków
            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();
            
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: bossLine przed czyszczeniem: "' + bossLine + '"');
                logger.info('🔍 DEBUG: cleanBossName po czyszczeniu: "' + cleanBossName + '"');
                logger.info('🔍 DEBUG: cleanBossName type: ' + typeof cleanBossName);
                logger.info('🔍 DEBUG: cleanBossName length: ' + (cleanBossName ? cleanBossName.length : 'null/undefined'));
            }
            
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                logger.info('Oczyszczona nazwa bossa:', cleanBossName);
            }
            
            return cleanBossName || null;
        }
        
        logger.info('Brak wystarczającej liczby linijek dla nazwy bossa');
        return null;
    }
}

module.exports = OCRService;