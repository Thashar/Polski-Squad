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

            await sharp(imagePath).grayscale().threshold(this.config.ocr.threshold).negate().png().toFile(processedPath);

            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                tessedit_char_whitelist: this.config.ocr.charWhitelistWords
            });

            await fs.unlink(processedPath).catch(() => {});

            const hasBest  = /best\s*:|最高記録/i.test(text.trim());
            const hasTotal = /total\s*:|合計/i.test(text.trim());
            const bestMatch  = text.trim().match(/(?:best\s*:|最高記録[：:]\s*)([^\n\r]*)/i);
            const totalMatch = text.trim().match(/(?:total\s*:|合計[：:]\s*)([^\n\r]*)/i);
            const bestValue  = bestMatch  ? bestMatch[1].trim()  : '';
            const totalValue = totalMatch ? totalMatch[1].trim() : '';

            const wcOk = hasBest && hasTotal;
            log[wcOk ? 'info' : 'warn'](`${wcOk ? '✅' : '⚠️'} Word check → Best:"${bestValue || '—'}" Total:"${totalValue || '—'}"`);

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                log.info(`Word check raw text: "${text.trim()}"`);
            }

            return hasBest && hasTotal;
        } catch (error) {
            log.error(`Word check błąd: ${error.message}`);
            return false;
        }
    }

    async preprocessImageForWhiteText(inputPath, outputPath, log = logger) {
        try {
            await sharp(inputPath).grayscale().threshold(this.config.ocr.threshold).negate().png().toFile(outputPath);

            if (this.config.ocr.saveProcessedImages) {
                await saveProcessedImage(
                    outputPath,
                    this.config.ocr.processedDir,
                    'ENDERSECHO',
                    'endersecho',
                    this.config.ocr.maxProcessedFiles,
                    log
                );
            }
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

            const { data: { text } } = await Tesseract.recognize(processedPath, this.config.ocr.languages, {
                tessedit_char_whitelist: this.config.ocr.charWhitelist
            });

            await fs.unlink(processedPath).catch(() => {});

            const trimmedText = text.trim();
            const preview = trimmedText.length > 120 ? trimmedText.substring(0, 120) + '…' : trimmedText;
            log.info(`✅ OCR: "${preview}" (${trimmedText.length} znaków)`);

            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logTextExtraction) {
                log.info(`OCR pełny tekst: "${trimmedText}"`);
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

        if (/\.\d0$/.test(fixedScore)) fixedScore = fixedScore.replace(/(\.\d)0$/, '$1Q');
        if (/\.\d9$/.test(fixedScore)) fixedScore = fixedScore.replace(/(\.\d)9$/, '$1Q');
        if (/7$/.test(fixedScore) && !/[KMBTQS]$/i.test(fixedScore)) fixedScore = fixedScore.replace(/7$/, 'T');
        if (/0$/.test(fixedScore) && !/(?:Qi|[MBTQ])$/i.test(fixedScore)) fixedScore = fixedScore.replace(/0$/, 'Q');

        if (fixedScore !== scoreText) {
            log.info(`fixScore: "${scoreText}" → "${fixedScore}"`);
        }

        return fixedScore;
    }

    extractScoreAfterBest(text, log = logger) {
        const lines = text.split('\n').map(line => line.trim());
        let bestLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (/best\s*:/i.test(lines[i])) { bestLineIndex = i; break; }
        }

        // KROK 1: linia "Best:" z jednostką
        const bestScorePattern = /(?:best\s*:?|最高記録[：:]?)\s*[©»]*\s*(\d+(?:\.\d+)?(?:Qi|Sx|[KMBTQ])+)/gi;
        const matches = text.match(bestScorePattern);
        if (matches && matches.length > 0) {
            const scoreMatch = matches[0].match(/(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (scoreMatch) {
                let result = scoreMatch[1];
                const wholePart = result.match(/^(\d+)/)?.[1] || '';
                if (wholePart.length <= 5) {
                    result = this.fixScoreFormat(result, log);
                    log.info(`✅ Score: "${result}" (KROK 1 — Best+jednostka)`);
                    return result;
                }
                log.warn(`Score KROK 1: "${result}" — ${wholePart.length} cyfr > 5, pomijam`);
            }
        }

        // KROK 2: linia wyżej przed "Best:"
        if (bestLineIndex > 0) {
            const lineAbove = lines[bestLineIndex - 1];
            const aboveMatch = lineAbove.match(/©?\s*(\d+(?:\.\d+)?(?:Qi|[KMBTQ])+)/i);
            if (aboveMatch) {
                let score = aboveMatch[1];
                const wholePart = score.match(/^(\d+)/)?.[1] || '';
                if (wholePart.length <= 5) {
                    score = this.fixScoreFormat(score, log);
                    log.info(`✅ Score: "${score}" (KROK 2 — linia wyżej)`);
                    return score;
                }
                log.warn(`Score KROK 2: "${score}" — ${wholePart.length} cyfr > 5, pomijam`);
            }
        }

        // KROK 3: "Best:" bez jednostki, normalizacja
        const bestScoreNoUnitPattern = /(?:best\s*:?|最高記録[：:]?)\s*[©»]*[^\d]*(\d+(?:\.\d+)?)[^\w]*$/gmi;
        const noUnitMatches = text.match(bestScoreNoUnitPattern);
        if (noUnitMatches && noUnitMatches.length > 0) {
            const scoreMatch = noUnitMatches[0].match(/(\d+(?:\.\d+)?)[^\w]*$/);
            if (scoreMatch) {
                const result = this.normalizeScoreWithoutUnit(scoreMatch[1], log);
                if (result) {
                    log.info(`✅ Score: "${result}" (KROK 3 — bez jednostki, znormalizowany)`);
                    return result;
                }
            }
        }

        log.warn(`⚠️ Score: null (brak dopasowań)`);
        return null;
    }

    normalizeScoreWithoutUnit(score, log = logger) {
        if (!score) return null;

        const numericPart = score.match(/^(\d+)(?:\.(\d+))?/);
        if (!numericPart) return null;

        const wholePart  = numericPart[1];
        const decimalPart = numericPart[2] || '';
        let result;

        if (wholePart.length <= 5) {
            result = score + 'T';
        } else if (wholePart.length === 6) {
            const lastDigit = wholePart[wholePart.length - 1];
            const trimmedWhole = wholePart.slice(0, -1);
            const unit = lastDigit === '0' ? 'Q' : 'T';
            result = decimalPart ? `${trimmedWhole}.${decimalPart}${unit}` : `${trimmedWhole}${unit}`;
        } else {
            log.warn(`normalizeNoUnit: "${score}" → null (${wholePart.length} cyfr > 6)`);
            return null;
        }

        result = this.fixScoreFormat(result, log);

        if (result && /\d+(?:\.\d+)?(?:Qi|[KMBTQ])/i.test(result)) {
            log.info(`✅ normalizeNoUnit: "${score}" → "${result}"`);
            return result;
        }

        log.warn(`normalizeNoUnit: "${result}" — niepoprawny format po normalizacji`);
        return null;
    }

    extractBossName(text, log = logger) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const victoryIndex = lines.findIndex(line => /victory|勝利/i.test(line));

        if (victoryIndex !== -1 && victoryIndex + 1 < lines.length) {
            const bossLine = lines[victoryIndex + 1];
            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();
            if (cleanBossName) log.info(`✅ Boss: "${cleanBossName}" (Victory@line${victoryIndex + 1})`);
            else log.warn(`⚠️ Boss: null (Victory@line${victoryIndex + 1}, pusta linia)`);
            return cleanBossName || null;
        }

        if (lines.length >= 2) {
            const hasDigits = /\d/.test(lines[1]);
            const bossLine = hasDigits ? lines[0] : lines[1];
            const cleanBossName = bossLine.replace(/[^\w\s\-]/g, '').trim();
            if (cleanBossName) log.info(`✅ Boss: "${cleanBossName}" (fallback, linia ${hasDigits ? 1 : 2})`);
            else log.warn(`⚠️ Boss: null (fallback, pusta linia)`);
            return cleanBossName || null;
        }

        log.warn(`⚠️ Boss: null (za mało linii)`);
        return null;
    }
}

module.exports = OCRService;
