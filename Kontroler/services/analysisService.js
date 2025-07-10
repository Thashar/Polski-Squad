const { logWithTimestamp, isSimilarNick } = require('../utils/helpers');

class AnalysisService {
    constructor(config, ocrService) {
        this.config = config;
        this.ocrService = ocrService;
    }

    /**
     * Waliduje wynik na podstawie konfiguracji kanału
     * @param {Object} normalizedResult - Znormalizowany wynik
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object} - Wynik walidacji
     */
    validateScore(normalizedResult, channelConfig) {
        const [minRange, maxRange] = channelConfig.scoreRange;
        const step = channelConfig.scoreStep;
        
        if (!normalizedResult.hasVariants) {
            const scoreMatch = normalizedResult.normalized.match(/^(\d{1,4})$/);
            if (scoreMatch) {
                const score = parseInt(scoreMatch[1]);
                logWithTimestamp(`Znaleziona liczba: ${score}`, 'info');
                
                if (score >= minRange && score <= maxRange && score % step === 0) {
                    logWithTimestamp(`Prawidłowy wynik: ${score}`, 'success');
                    return { isValid: true, score: score, variant: null };
                } else if (score >= minRange && score <= maxRange) {
                    const roundedScore = Math.round(score / step) * step;
                    logWithTimestamp(`Zaokrąglam ${score} do ${roundedScore}`, 'info');
                    return { isValid: true, score: roundedScore, originalScore: score, rounded: true, variant: null };
                }
            }
            return { isValid: false, score: null, variant: null };
        } else {
            logWithTimestamp('Testuję warianty dla s/S...', 'info');
            
            // Test wariantu z 5
            const scoreMatch5 = normalizedResult.variant5.match(/^(\d{1,4})$/);
            if (scoreMatch5) {
                const score5 = parseInt(scoreMatch5[1]);
                logWithTimestamp(`Wariant z 5: ${score5}`, 'info');
                
                if (score5 >= minRange && score5 <= maxRange && score5 % step === 0) {
                    logWithTimestamp(`Prawidłowy wynik (wariant 5): ${score5}`, 'success');
                    return { isValid: true, score: score5, variant: '5' };
                } else if (score5 >= minRange && score5 <= maxRange) {
                    const roundedScore5 = Math.round(score5 / step) * step;
                    logWithTimestamp(`Zaokrąglam ${score5} do ${roundedScore5} (wariant 5)`, 'info');
                    return { isValid: true, score: roundedScore5, originalScore: score5, rounded: true, variant: '5' };
                }
            }
            
            // Test wariantu z 8
            const scoreMatch8 = normalizedResult.variant8.match(/^(\d{1,4})$/);
            if (scoreMatch8) {
                const score8 = parseInt(scoreMatch8[1]);
                logWithTimestamp(`Wariant z 8: ${score8}`, 'info');
                
                if (score8 >= minRange && score8 <= maxRange && score8 % step === 0) {
                    logWithTimestamp(`Prawidłowy wynik (wariant 8): ${score8}`, 'success');
                    return { isValid: true, score: score8, variant: '8' };
                } else if (score8 >= minRange && score8 <= maxRange) {
                    const roundedScore8 = Math.round(score8 / step) * step;
                    logWithTimestamp(`Zaokrąglam ${score8} do ${roundedScore8} (wariant 8)`, 'info');
                    return { isValid: true, score: roundedScore8, originalScore: score8, rounded: true, variant: '8' };
                }
            }
            
            logWithTimestamp('Żaden wariant nie jest prawidłowy', 'error');
            return { isValid: false, score: null, variant: null };
        }
    }

    /**
     * Analizuje obraz w poszukiwaniu nicku i wyniku
     * @param {string} imagePath - Ścieżka do przetworzonego obrazu
     * @param {string} displayName - Nick na serwerze
     * @param {string} username - Nazwa użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object} - Wynik analizy
     */
    async analyzeImage(imagePath, displayName, username, channelConfig) {
        logWithTimestamp(`Rozpoczynam analizę OCR dla nicku: "${displayName}" (użytkownik: ${username})`, 'info');
        logWithTimestamp(`Konfiguracja: min=${channelConfig.minimumScore}, zakres=${channelConfig.scoreRange}, krok=${channelConfig.scoreStep}, drugie wystąpienie=${channelConfig.requireSecondOccurrence}`, 'info');

        try {
            const text = await this.ocrService.extractTextFromImage(imagePath);
            
            const lines = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 2);

            logWithTimestamp(`Znaleziono ${lines.length} linii tekstu do analizy`, 'info');

            const displayNameNormalized = displayName.toLowerCase()
                .replace(/[^a-z0-9ąćęłńóśźż\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            // FAZA 1: Dokładne dopasowanie
            const linesWithNick = [];
            logWithTimestamp('FAZA 1: Szukam dokładnego dopasowania nicku...', 'info');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNormalized = line.toLowerCase()
                    .replace(/[^a-z0-9ąćęłńóśźż\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (lineNormalized.includes(displayNameNormalized)) {
                    linesWithNick.push({ index: i + 1, line: line, matchType: 'exact' });
                    logWithTimestamp(`Znaleziono nick (dokładne dopasowanie) w linii ${i + 1}: "${line}"`, 'success');
                }
            }

            logWithTimestamp(`Dokładne dopasowania: ${linesWithNick.length}`, 'info');

            // FAZA 2: Podobieństwo
            if (channelConfig.requireSecondOccurrence && linesWithNick.length < 2) {
                await this.findSimilarNicks(lines, displayName, linesWithNick, this.config.similarity.threshold);
                
                if (linesWithNick.length < 2) {
                    await this.findSimilarNicks(lines, displayName, linesWithNick, this.config.similarity.lowThreshold);
                }
            } else if (!channelConfig.requireSecondOccurrence && linesWithNick.length === 0) {
                await this.findSimilarNicks(lines, displayName, linesWithNick, this.config.similarity.threshold);
            }

            logWithTimestamp(`Nick "${displayName}" wystąpił łącznie ${linesWithNick.length} razy`, 'info');

            // Walidacja wystąpień
            if (linesWithNick.length === 0) {
                return {
                    found: false,
                    score: null,
                    line: null,
                    isValid: false,
                    displayName: displayName,
                    error: 'Nick nie został znaleziony w tekście'
                };
            }

            if (channelConfig.requireSecondOccurrence && linesWithNick.length < 2) {
                return {
                    found: false,
                    score: null,
                    line: null,
                    isValid: false,
                    displayName: displayName,
                    error: 'Nick musi wystąpić co najmniej dwa razy na zdjęciu'
                };
            }

            // Wybór linii do analizy
            const targetLine = this.selectTargetLine(linesWithNick, channelConfig);
            if (!targetLine) {
                return {
                    found: false,
                    score: null,
                    line: null,
                    isValid: false,
                    displayName: displayName,
                    error: `Wszystkie wystąpienia nicku znajdują się w pierwszych ${channelConfig.skipLines} liniach tekstu`
                };
            }

            // Analiza wyniku
            return await this.extractScoreFromLine(targetLine, displayName, channelConfig);

        } catch (error) {
            logWithTimestamp(`Błąd podczas analizy OCR: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Znajduje podobne nicki w liniach
     * @param {Array} lines - Linie tekstu
     * @param {string} displayName - Nick do wyszukania
     * @param {Array} linesWithNick - Tablica znalezionych linii
     * @param {number} threshold - Próg podobieństwa
     */
    async findSimilarNicks(lines, displayName, linesWithNick, threshold) {
        logWithTimestamp(`Szukam podobieństwa z progiem ${(threshold * 100).toFixed(0)}%...`, 'info');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            const alreadyFound = linesWithNick.some(found => found.index === i + 1);
            if (alreadyFound) continue;

            const lineNormalized = line.toLowerCase()
                .replace(/[^a-z0-9ąćęłńóśźż\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const wordsInLine = lineNormalized.split(' ').filter(word => word.length > 2);

            for (const word of wordsInLine) {
                if (isSimilarNick(displayName, word, threshold)) {
                    const matchType = threshold === this.config.similarity.threshold ? 'similarity' : 'similarity_low';
                    linesWithNick.push({ index: i + 1, line: line, matchType: matchType, matchedWord: word });
                    logWithTimestamp(`Znaleziono podobny nick w linii ${i + 1}: "${line}" (słowo: "${word}")`, 'success');
                    break;
                }
            }

            if (linesWithNick.length >= 2) break;
        }
    }

    /**
     * Wybiera linię docelową do analizy
     * @param {Array} linesWithNick - Linie z nickiem
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object|null} - Wybrana linia lub null
     */
    selectTargetLine(linesWithNick, channelConfig) {
        if (channelConfig.requireSecondOccurrence) {
            linesWithNick.sort((a, b) => {
                const priority = { 'exact': 0, 'similarity': 1, 'similarity_low': 2 };
                return priority[a.matchType] - priority[b.matchType];
            });

            logWithTimestamp('Posortowane wystąpienia nicku:', 'info');
            linesWithNick.forEach((item, index) => {
                console.log(`  ${index + 1}. Linia ${item.index}: ${item.matchType} - "${item.line}"`);
            });

            for (let i = 0; i < linesWithNick.length; i++) {
                if (linesWithNick[i].index > channelConfig.skipLines) {
                    logWithTimestamp(`Analizuję wystąpienie w linii ${linesWithNick[i].index} (typ: ${linesWithNick[i].matchType})`, 'info');
                    return linesWithNick[i];
                }
            }
        } else {
            const validLines = linesWithNick.filter(item => item.index > channelConfig.skipLines);
            
            if (validLines.length === 0) return null;

            const exactMatch = validLines.find(item => item.matchType === 'exact');
            const targetLine = exactMatch || validLines[0];
            logWithTimestamp(`Analizuję wystąpienie w linii ${targetLine.index} (typ: ${targetLine.matchType})`, 'info');
            return targetLine;
        }

        return null;
    }

    /**
     * Wyciąga wynik z linii
     * @param {Object} targetLine - Linia do analizy
     * @param {string} displayName - Nick użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Object} - Wynik analizy
     */
    async extractScoreFromLine(targetLine, displayName, channelConfig) {
        const line = targetLine.line;
        logWithTimestamp(`Analizuję wybraną linię: "${line}"`, 'info');

        let nickIndex = -1;
        let foundNickVariant = '';

        if (targetLine.matchType === 'exact') {
            const displayNameCore = displayName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            const nickVariants = [
                displayName.toLowerCase(),
                displayNameCore,
                displayName.replace('_', '').toLowerCase(),
                displayName.replace(/[_\-\.]/g, '').toLowerCase()
            ];

            for (const variant of nickVariants) {
                nickIndex = line.toLowerCase().indexOf(variant);
                if (nickIndex !== -1) {
                    foundNickVariant = variant;
                    logWithTimestamp(`Znaleziono wariant nicku "${variant}" na pozycji ${nickIndex}`, 'success');
                    break;
                }
            }
        } else {
            if (targetLine.matchedWord) {
                nickIndex = line.toLowerCase().indexOf(targetLine.matchedWord);
                foundNickVariant = targetLine.matchedWord;
                logWithTimestamp(`Znaleziono podobny nick "${targetLine.matchedWord}" na pozycji ${nickIndex}`, 'success');
            }
        }

        if (nickIndex !== -1) {
            const afterNickStart = nickIndex + foundNickVariant.length;
            let afterNick = line.substring(afterNickStart);
            
            afterNick = afterNick.replace(/^[^a-zA-Z0-9]*/, '').trim();
            logWithTimestamp(`Tekst po nicku: "${afterNick}"`, 'info');

            const potentialScoreMatch = afterNick.match(/(\S+)\s*$/);
            if (potentialScoreMatch) {
                const rawScore = potentialScoreMatch[1];
                logWithTimestamp(`Potencjalny wynik: "${rawScore}"`, 'info');

                const normalizedResult = this.ocrService.normalizeScore(rawScore, channelConfig);
                const validation = this.validateScore(normalizedResult, channelConfig);

                if (validation.isValid) {
                    logWithTimestamp(`Znaleziono prawidłowy wynik: ${validation.score}${validation.variant ? ` (s/S -> ${validation.variant})` : ''}`, 'success');
                    return {
                        found: true,
                        score: validation.score,
                        line: line,
                        isValid: validation.score >= channelConfig.minimumScore,
                        displayName: displayName,
                        matchType: targetLine.matchType,
                        rounded: validation.rounded || false,
                        originalScore: validation.originalScore || null,
                        sVariant: validation.variant || null
                    };
                }
            }
        }

        return {
            found: true,
            score: null,
            line: line,
            isValid: false,
            displayName: displayName,
            error: 'Brak prawidłowego wyniku na końcu linii po nicku',
            matchType: targetLine.matchType
        };
    }
}

module.exports = AnalysisService;