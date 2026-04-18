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

    async initialize() {
        if (this.config.ocr.saveProcessedImages) {
            await fs.mkdir(this.config.ocr.processedDir, { recursive: true });
        }
    }

    async checkRequiredWords(imagePath, log = logger) {
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
                log.info('🔍 Szczegółowy debug: Sprawdzam obecność wymaganych słów w obrazie...');
            } else {
                log.info('Sprawdzam obecność wymaganych słów w obrazie...');
            }

            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                logger: m => {
                    if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logImageProcessing) {
                        log.info(`📊 Word Check Progress: ${m.status}`);
                    }
                },
                tessedit_char_whitelist: this.config.ocr.charWhitelistWords
            });

            await fs.unlink(processedPath).catch(() => {});

            const hasBest = /best\s*:|最高記録/i.test(text.trim());
            const hasTotal = /total\s*:|合計/i.test(text.trim());

            const bestMatch = text.trim().match(/(?:best\s*:|最高記録[：:]\s*)([^\n\r]*)/i);
            const totalMatch = text.trim().match(/(?:total\s*:|合計[：:]\s*)([^\n\r]*)/i);
            const bestValue = bestMatch ? bestMatch[1].trim() : '';
            const totalValue = totalMatch ? totalMatch[1].trim() : '';

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                log.info('📝 Szczegółowy debug: Tekst z obrazu: "' + text.trim() + '"');
                log.info('🔍 Szczegółowy debug: Znaleziono "Best:": ' + (bestValue || '[brak wartości]'));
                log.info('🔍 Szczegółowy debug: Znaleziono "Total:": ' + (totalValue || '[brak wartości]'));
            } else {
                log.info('Tekst z obrazu: "' + text.trim() + '"');
                log.info('Znaleziono "Best:": ' + (bestValue || '[brak wartości]'));
                log.info('Znaleziono "Total:": ' + (totalValue || '[brak wartości]'));
            }

            return hasBest && hasTotal;
        } catch (error) {
            log.error(`Błąd podczas sprawdzania wymaganych słów: ${error.message}`);
            return false;
        }
    }

    async preprocessImageForWhiteText(inputPath, outputPath, log = logger) {
        try {
            await sharp(inputPath)
                .grayscale()
                .threshold(this.config.ocr.threshold)
                .negate()
                .png()
                .toFile(outputPath);

            log.info(`🔧 Debug: saveProcessedImages = ${this.config.ocr.saveProcessedImages}`);
            if (this.config.ocr.saveProcessedImages) {
                log.info('🔧 Debug: Zapisuję przetworzony obraz EndersEcho z: ' + outputPath);
                await saveProcessedImage(
                    outputPath,
                    this.config.ocr.processedDir,
                    'ENDERSECHO',
                    'endersecho',
                    this.config.ocr.maxProcessedFiles,
                    log
                );
            } else {
                log.info(`🔧 Debug: Zapisywanie przetworzonych obrazów WYŁĄCZONE`);
            }

            log.info('Obraz został przetworzony dla białego tekstu');
        } catch (error) {
            log.error(`Błąd przetwarzania obrazu: ${error.message}`);
            throw error;
        }
    }

    async extractTextFromImage(imagePath, log = logger) {
        try {
            const processedPath = imagePath.replace(
                new RegExp(`\\.(${this.config.images.supportedExtensions.join('|').replace(/\./g, '')})$`, 'i'),
                this.config.images.processedSuffix
            );

            await this.preprocessImageForWhiteText(imagePath, processedPath, log);

            log.info('Rozpoczynam OCR...');
            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                tessedit_char_whitelist: this.config.ocr.charWhitelist
            });

            await fs.unlink(processedPath).catch(() => {});

            const trimmedText = text.trim();

            if (this.config.ocr.detailedLogging.enabled) {
                log.info('🔍 DEBUG: text przed trim: "' + text + '"');
                log.info('🔍 DEBUG: text type: ' + typeof text);
                log.info('🔍 DEBUG: text length przed trim: ' + (text ? text.length : 'null/undefined'));
                log.info('🔍 DEBUG: trimmedText: "' + trimmedText + '"');
                log.info('🔍 DEBUG: trimmedText type: ' + typeof trimmedText);
                log.info('🔍 DEBUG: trimmedText length: ' + (trimmedText ? trimmedText.length : 'null/undefined'));
            }

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                log.info('📝 Szczegółowy debug - wyodrębniony tekst z OCR: "' + trimmedText + '"');
                log.info('📝 Szczegółowy debug - długość tekstu: ' + trimmedText.length);
            } else {
                log.info('Wyodrębniony tekst z OCR: "' + trimmedText + '"');
                log.info('Długość tekstu: ' + trimmedText.length);
            }

            return trimmedText;
        } catch (error) {
            log.error(`Błąd OCR: ${error.message}`);
            throw error;
        }
    }

    fixScoreFormat(scoreText, log = logger) {
        let fixedScore = scoreText;

        fixedScore = fixedScore.replace(/TT$/i, '1T');

        if (/\.\d0$/.test(fixedScore)) {
            fixedScore = fixedScore.replace(/(\.\d)0$/, '$1Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                log.info('Zastąpiono końcowe 0 po kropce na Q (np. .20 -> .2Q)');
            }
        }

        if (/\.\d9$/.test(fixedScore)) {
            fixedScore = fixedScore.replace(/(\.\d)9$/, '$1Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                log.info('Zastąpiono końcowe 9 po kropce na Q (np. .29 -> .2Q)');
            }
        }

        if (/7$/.test(fixedScore) && !/[KMBTQS]$/i.test(fixedScore)) {
            fixedScore = fixedScore.replace(/7$/, 'T');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                log.info('Zastąpiono końcową cyfrę 7 na literę T');
            }
        }

        if (/0$/.test(fixedScore) && !/(?:Qi|[MBTQ])$/i.test(fixedScore)) {
            fixedScore = fixedScore.replace(/0$/, 'Q');
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
                log.info('Zastąpiono końcową cyfrę 0 na literę Q');
            }
        }

        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            log.info('Oryginalny wynik: ' + scoreText);
            log.info('Poprawiony wynik: ' + fixedScore);
        }

        return fixedScore;
    }

    extractScoreAfterBest(text, log = logger) {
        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            log.info('📊 Szczegółowy debug: Analizowany tekst OCR: "' + text + '"');
            log.info('📊 Szczegółowy debug: Długość tekstu: ' + (text ? text.length : 'null'));
        } else {
            log.info('Analizowany tekst OCR: "' + text + '"');
            log.info('Długość tekstu: ' + (text ? text.length : 'null'));
        }

        const lines = text.split('\n').map(line => line.trim());
        let bestLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (/best\s*:/i.test(lines[i])) {
                bestLineIndex = i;
                break;
            }
        }

        log.info('KROK 1: Sprawdzam linijkę z "Best:" / "最高記録" - czy jest wynik z jednostką...');
        const bestScorePattern = /(?:best\s*:?|最高記録[：:]?)\s*[©»]*\s*(\d+(?:\.\d+)?(?:Qi|Sx|[KMBTQ])+)/gi;
        let matches = text.match(bestScorePattern);

        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            log.info('🎯 Szczegółowy debug: Znalezione dopasowania Best z jednostką: ' + matches);
        } else {
            log.info('Znalezione dopasowania Best z jednostką: ' + matches);
        }

        if (matches && matches.length > 0) {
            const scoreMatch = matches[0].match(/(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (scoreMatch) {
                let result = scoreMatch[1];
                log.info(`Znaleziono wynik w linijce "Best:" z jednostką: "${result}"`);

                const numericPart = result.match(/^(\d+)(?:\.(\d+))?/);
                if (numericPart) {
                    const wholePart = numericPart[1];
                    if (wholePart.length <= 5) {
                        result = this.fixScoreFormat(result, log);
                        log.info(`✅ Używam wyniku z linijki "Best:" z jednostką: "${result}"`);
                        return result;
                    } else {
                        log.info(`⚠️ Wynik ma za dużo cyfr (${wholePart.length}), pomijam i idę do KROKU 2`);
                    }
                }
            }
        }

        if (bestLineIndex !== -1 && bestLineIndex > 0) {
            const lineAbove = lines[bestLineIndex - 1];
            log.info(`KROK 2: Sprawdzam linijkę WYŻEJ przed Best (${bestLineIndex - 1}): "${lineAbove}"`);

            const aboveMatch = lineAbove.match(/©?\s*(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (aboveMatch) {
                let score = aboveMatch[1];
                log.info(`✅ Znaleziono wynik z jednostką w linijce wyżej: "${score}"`);

                const numericPart = score.match(/^(\d+)(?:\.(\d+))?/);
                if (numericPart) {
                    const wholePart = numericPart[1];
                    if (wholePart.length <= 5) {
                        score = this.fixScoreFormat(score, log);
                        log.info(`✅ Używam wyniku z linijki wyżej: "${score}"`);
                        return score;
                    } else {
                        log.info(`⚠️ Wynik ma za dużo cyfr (${wholePart.length}), pomijam i idę do KROKU 3`);
                    }
                }
            }
        }

        log.info('KROK 3: Wracam do linijki "Best:" / "最高記録" i sprawdzam wynik bez jednostki...');
        const bestScoreNoUnitPattern = /(?:best\s*:?|最高記録[：:]?)\s*[©»]*[^\d]*(\d+(?:\.\d+)?)[^\w]*$/gmi;
        const noUnitMatches = text.match(bestScoreNoUnitPattern);

        if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logScoreAnalysis) {
            log.info('🎯 Szczegółowy debug: Znalezione dopasowania Best bez jednostek: ' + noUnitMatches);
        } else {
            log.info('Znalezione dopasowania Best bez jednostek: ' + noUnitMatches);
        }

        if (noUnitMatches && noUnitMatches.length > 0) {
            const scoreMatch = noUnitMatches[0].match(/(\d+(?:\.\d+)?)[^\w]*$/);
            if (scoreMatch) {
                let result = scoreMatch[1];
                log.info(`Znaleziono wynik w linijce "Best:" bez jednostki: "${result}"`);

                result = this.normalizeScoreWithoutUnit(result, log);

                if (result) {
                    log.info(`✅ Znormalizowany wynik z linijki "Best:": "${result}"`);
                    return result;
                }
            }
        }

        log.info('❌ Brak dopasowań - zwracam null');
        return null;
    }

    normalizeScoreWithoutUnit(score, log = logger) {
        if (!score) return null;

        const numericPart = score.match(/^(\d+)(?:\.(\d+))?/);
        if (!numericPart) return null;

        const wholePart = numericPart[1];
        const decimalPart = numericPart[2] || '';

        log.info(`Normalizacja wyniku: całość="${wholePart}" (długość: ${wholePart.length}), część dziesiętna="${decimalPart}"`);

        let result;

        if (wholePart.length <= 5) {
            result = score + 'T';
            log.info(`Wynik ma ${wholePart.length} cyfr przed kropką (≤5), dodaję T na końcu: "${result}"`);
        } else if (wholePart.length === 6) {
            const lastDigit = wholePart[wholePart.length - 1];
            const trimmedWhole = wholePart.slice(0, -1);

            let unit = 'T';
            if (lastDigit === '0') unit = 'Q';
            else if (lastDigit === '7') unit = 'T';

            if (decimalPart) {
                result = trimmedWhole + '.' + decimalPart + unit;
                log.info(`Wynik ma 6 cyfr przed kropką, usuwam ostatnią cyfrę "${lastDigit}", zachowuję kropkę, dodaję "${unit}": "${result}"`);
            } else {
                result = trimmedWhole + unit;
                log.info(`Wynik ma 6 cyfr (bez kropki), usuwam ostatnią cyfrę "${lastDigit}", dodaję "${unit}": "${result}"`);
            }
        } else {
            log.warn(`⚠️ Wynik ma zbyt dużo cyfr (${wholePart.length}), oczekiwano max 6`);
            return null;
        }

        result = this.fixScoreFormat(result, log);

        if (result && /\d+(?:\.\d+)?(?:Qi|[KMBTQ])/i.test(result)) {
            return result;
        }

        log.warn(`⚠️ Wynik po normalizacji nie ma poprawnego formatu: "${result}"`);
        return null;
    }

    extractBossName(text, log = logger) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        const victoryIndex = lines.findIndex(line => /victory|勝利/i.test(line));

        if (victoryIndex !== -1 && victoryIndex + 1 < lines.length) {
            const bossLine = lines[victoryIndex + 1];

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                log.info('Znaleziono "Victory" w linii ' + victoryIndex + ': "' + lines[victoryIndex] + '"');
                log.info('Nazwa bossa (następna linia): "' + bossLine + '"');
            }

            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();

            if (this.config.ocr.detailedLogging.enabled) {
                log.info('🔍 DEBUG: bossLine przed czyszczeniem: "' + bossLine + '"');
                log.info('🔍 DEBUG: cleanBossName po czyszczeniu: "' + cleanBossName + '"');
                log.info('🔍 DEBUG: cleanBossName type: ' + typeof cleanBossName);
                log.info('🔍 DEBUG: cleanBossName length: ' + (cleanBossName ? cleanBossName.length : 'null/undefined'));
            }

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                log.info('Oczyszczona nazwa bossa: ' + cleanBossName);
            }

            return cleanBossName || null;
        }

        if (lines.length >= 2) {
            const secondLine = lines[1];
            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                log.info('Nie znaleziono "Victory", fallback do starej logiki');
                log.info('Druga linijka tekstu (boss): ' + secondLine);
            }

            const hasDigits = /\d/.test(secondLine);

            let bossLine;
            if (hasDigits && lines.length >= 1) {
                bossLine = lines[0];
                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                    log.info('Druga linijka zawiera cyfry, używam pierwszej linijki: ' + bossLine);
                }
            } else {
                bossLine = secondLine;
                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                    log.info('Używam drugiej linijki (brak cyfr): ' + bossLine);
                }
            }

            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();

            if (this.config.ocr.detailedLogging.enabled) {
                log.info('🔍 DEBUG: bossLine przed czyszczeniem: "' + bossLine + '"');
                log.info('🔍 DEBUG: cleanBossName po czyszczeniu: "' + cleanBossName + '"');
                log.info('🔍 DEBUG: cleanBossName type: ' + typeof cleanBossName);
                log.info('🔍 DEBUG: cleanBossName length: ' + (cleanBossName ? cleanBossName.length : 'null/undefined'));
            }

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logBossNameExtraction) {
                log.info('Oczyszczona nazwa bossa: ' + cleanBossName);
            }

            return cleanBossName || null;
        }

        log.info('Brak wystarczającej liczby linijek dla nazwy bossa');
        return null;
    }
}

module.exports = OCRService;
