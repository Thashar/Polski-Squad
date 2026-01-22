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
            
            // Znajdź wartości po "Best:" i "Total:"
            const bestMatch = text.trim().match(/best\s*:\s*([^\n\r]*)/i);
            const totalMatch = text.trim().match(/total\s*:\s*([^\n\r]*)/i);
            const bestValue = bestMatch ? bestMatch[1].trim() : '';
            const totalValue = totalMatch ? totalMatch[1].trim() : '';
            
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                logger.info('📝 Szczegółowy debug: Tekst z obrazu: "' + text.trim() + '"');
                logger.info('🔍 Szczegółowy debug: Znaleziono "Best:": ' + (bestValue || '[brak wartości]'));
                logger.info('🔍 Szczegółowy debug: Znaleziono "Total:": ' + (totalValue || '[brak wartości]'));
            } else {
                logger.info('Tekst z obrazu: "' + text.trim() + '"');
                logger.info('Znaleziono "Best:": ' + (bestValue || '[brak wartości]'));
                logger.info('Znaleziono "Total:": ' + (totalValue || '[brak wartości]'));
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
            
            // Debugowanie (tylko gdy włączone szczegółowe logowanie)
            if (this.config.ocr.detailedLogging.enabled) {
                logger.info('🔍 DEBUG: text przed trim: "' + text + '"');
                logger.info('🔍 DEBUG: text type: ' + typeof text);
                logger.info('🔍 DEBUG: text length przed trim: ' + (text ? text.length : 'null/undefined'));
                logger.info('🔍 DEBUG: trimmedText: "' + trimmedText + '"');
                logger.info('🔍 DEBUG: trimmedText type: ' + typeof trimmedText);
                logger.info('🔍 DEBUG: trimmedText length: ' + (trimmedText ? trimmedText.length : 'null/undefined'));
            }
            
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

        // NORMALIZACJA: Zamień .X0 na .XQ (gdy są dwie cyfry po kropce i ostatnia to 0)
        // Przykład: 224.20 -> 224.2Q
        if (/\.\d0$/.test(fixedScore)) {
            fixedScore = fixedScore.replace(/(\.\d)0$/, '$1Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                logger.info('Zastąpiono końcowe 0 po kropce na Q (np. .20 -> .2Q)');
            }
        }

        // NORMALIZACJA: Zamień .X9 na .XQ (gdy są dwie cyfry po kropce i ostatnia to 9)
        // Przykład: 224.29 -> 224.2Q
        if (/\.\d9$/.test(fixedScore)) {
            fixedScore = fixedScore.replace(/(\.\d)9$/, '$1Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                logger.info('Zastąpiono końcowe 9 po kropce na Q (np. .29 -> .2Q)');
            }
        }

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
        if (/0$/.test(fixedScore) && !/(?:Qi|[MBTQ])$/i.test(fixedScore)) {
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
            logger.info('📊 Szczegółowy debug: Analizowany tekst OCR: "' + text + '"');
            logger.info('📊 Szczegółowy debug: Długość tekstu:', text ? text.length : 'null');
        } else {
            logger.info('Analizowany tekst OCR: "' + text + '"');
            logger.info('Długość tekstu:', text ? text.length : 'null');
        }

        // Znajdź linię z "Best:"
        const lines = text.split('\n').map(line => line.trim());
        let bestLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (/best\s*:/i.test(lines[i])) {
                bestLineIndex = i;
                break;
            }
        }

        // KROK 1: Sprawdź linijkę z "Best:" - czy jest wynik z jednostką?
        logger.info('KROK 1: Sprawdzam linijkę z "Best:" - czy jest wynik z jednostką...');
        const bestScorePattern = /best\s*:?\s*[©»]*\s*(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/gi;
        let matches = text.match(bestScorePattern);

        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            logger.info('🎯 Szczegółowy debug: Znalezione dopasowania Best z jednostką:', matches);
        } else {
            logger.info('Znalezione dopasowania Best z jednostką:', matches);
        }

        if (matches && matches.length > 0) {
            const scoreMatch = matches[0].match(/(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (scoreMatch) {
                let result = scoreMatch[1];
                logger.info(`Znaleziono wynik w linijce "Best:" z jednostką: "${result}"`);

                // Waliduj długość - max 5 cyfr przed kropką
                const numericPart = result.match(/^(\d+)(?:\.(\d+))?/);
                if (numericPart) {
                    const wholePart = numericPart[1];
                    if (wholePart.length <= 5) {
                        // Zastosuj poprawki: TT -> 1T
                        result = this.fixScoreFormat(result);
                        logger.info(`✅ Używam wyniku z linijki "Best:" z jednostką: "${result}"`);
                        return result;
                    } else {
                        logger.info(`⚠️ Wynik ma za dużo cyfr (${wholePart.length}), pomijam i idę do KROKU 2`);
                    }
                }
            }
        }

        // KROK 2: Sprawdź linijkę WYŻEJ (przed "Best:") - czy jest wynik z jednostką?
        if (bestLineIndex !== -1 && bestLineIndex > 0) {
            const lineAbove = lines[bestLineIndex - 1];
            logger.info(`KROK 2: Sprawdzam linijkę WYŻEJ przed Best (${bestLineIndex - 1}): "${lineAbove}"`);

            // Sprawdź czy w linijce wyżej jest wynik z jednostką
            const aboveMatch = lineAbove.match(/©?\s*(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (aboveMatch) {
                let score = aboveMatch[1];
                logger.info(`✅ Znaleziono wynik z jednostką w linijce wyżej: "${score}"`);

                // Waliduj długość - max 5 cyfr przed kropką
                const numericPart = score.match(/^(\d+)(?:\.(\d+))?/);
                if (numericPart) {
                    const wholePart = numericPart[1];
                    if (wholePart.length <= 5) {
                        // Zastosuj poprawki: TT -> 1T
                        score = this.fixScoreFormat(score);
                        logger.info(`✅ Używam wyniku z linijki wyżej: "${score}"`);
                        return score;
                    } else {
                        logger.info(`⚠️ Wynik ma za dużo cyfr (${wholePart.length}), pomijam i idę do KROKU 3`);
                    }
                }
            }
        }

        // KROK 3: Wróć do linijki "Best:" i znormalizuj wynik bez jednostki
        logger.info('KROK 3: Wracam do linijki "Best:" i sprawdzam wynik bez jednostki...');
        const bestScoreNoUnitPattern = /best\s*:?\s*[©»]*[^\d]*(\d+(?:\.\d+)?)[^\w]*$/gmi;
        const noUnitMatches = text.match(bestScoreNoUnitPattern);

        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            logger.info('🎯 Szczegółowy debug: Znalezione dopasowania Best bez jednostek:', noUnitMatches);
        } else {
            logger.info('Znalezione dopasowania Best bez jednostek:', noUnitMatches);
        }

        if (noUnitMatches && noUnitMatches.length > 0) {
            const scoreMatch = noUnitMatches[0].match(/(\d+(?:\.\d+)?)[^\w]*$/);
            if (scoreMatch) {
                let result = scoreMatch[1];
                logger.info(`Znaleziono wynik w linijce "Best:" bez jednostki: "${result}"`);

                // Normalizacja wyniku bez jednostki
                result = this.normalizeScoreWithoutUnit(result);

                if (result) {
                    logger.info(`✅ Znormalizowany wynik z linijki "Best:": "${result}"`);
                    return result;
                }
            }
        }

        logger.info('❌ Brak dopasowań - zwracam null');
        return null;
    }

    /**
     * Normalizuje wynik bez jednostki - dodaje jednostkę lub usuwa ostatnią cyfrę
     * @param {string} score - Wynik bez jednostki (np. "38547", "385477", "38547.7", "385477.7")
     * @returns {string|null} - Znormalizowany wynik z jednostką lub null
     */
    normalizeScoreWithoutUnit(score) {
        if (!score) return null;

        // Wyciągnij część liczbową (przed ewentualną kropką)
        const numericPart = score.match(/^(\d+)(?:\.(\d+))?/);
        if (!numericPart) return null;

        const wholePart = numericPart[1]; // Cyfry przed kropką
        const decimalPart = numericPart[2] || ''; // Cyfry po kropce (jeśli są)

        logger.info(`Normalizacja wyniku: całość="${wholePart}" (długość: ${wholePart.length}), część dziesiętna="${decimalPart}"`);

        let result;

        if (wholePart.length <= 5) {
            // ≤5 cyfr przed kropką - dodaj jednostkę na końcu całego wyniku
            result = score + 'T';
            logger.info(`Wynik ma ${wholePart.length} cyfr przed kropką (≤5), dodaję T na końcu: "${result}"`);
        } else if (wholePart.length === 6) {
            // 6 cyfr przed kropką - usuń ostatnią cyfrę przed kropką, zachowaj kropkę+resztę, dodaj jednostkę
            const lastDigit = wholePart[wholePart.length - 1];
            const trimmedWhole = wholePart.slice(0, -1); // Usuń ostatnią cyfrę

            // Wybierz odpowiednią jednostkę na podstawie ostatniej cyfry
            let unit = 'T';
            if (lastDigit === '0') {
                unit = 'Q';
            } else if (lastDigit === '7') {
                unit = 'T';
            }

            // Zachowaj kropkę i cyfrę po kropce (jeśli są)
            if (decimalPart) {
                result = trimmedWhole + '.' + decimalPart + unit;
                logger.info(`Wynik ma 6 cyfr przed kropką, usuwam ostatnią cyfrę "${lastDigit}", zachowuję kropkę, dodaję "${unit}": "${result}"`);
            } else {
                result = trimmedWhole + unit;
                logger.info(`Wynik ma 6 cyfr (bez kropki), usuwam ostatnią cyfrę "${lastDigit}", dodaję "${unit}": "${result}"`);
            }
        } else {
            // Więcej niż 6 cyfr - nieprawidłowy wynik
            logger.warn(`⚠️ Wynik ma zbyt dużo cyfr (${wholePart.length}), oczekiwano max 6`);
            return null;
        }

        // Zastosuj dodatkowe poprawki (TT -> 1T)
        result = this.fixScoreFormat(result);

        // Waliduj końcowy wynik
        if (result && /\d+(?:\.\d+)?(?:Qi|[KMBTQ])/i.test(result)) {
            return result;
        }

        logger.warn(`⚠️ Wynik po normalizacji nie ma poprawnego formatu: "${result}"`);
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

        // NOWA LOGIKA: Szukaj linii z "Victory" i weź następną linię jako nazwę bossa
        const victoryIndex = lines.findIndex(line => /victory/i.test(line));

        if (victoryIndex !== -1 && victoryIndex + 1 < lines.length) {
            // Znaleziono "Victory" i jest następna linia
            const bossLine = lines[victoryIndex + 1];

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                logger.info('Znaleziono "Victory" w linii ' + victoryIndex + ': "' + lines[victoryIndex] + '"');
                logger.info('Nazwa bossa (następna linia): "' + bossLine + '"');
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

        // FALLBACK: Jeśli nie znaleziono "Victory", użyj starej logiki
        if (lines.length >= 2) {
            const secondLine = lines[1];
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                logger.info('Nie znaleziono "Victory", fallback do starej logiki');
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