const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

/**
 * AI OCR Service - Analiza zdjęć wyników przez Anthropic API
 * Używa Claude Vision do odczytu nazwy bossa i wyniku z ekranu gry
 */
class AIOCRService {
    constructor(config) {
        this.config = config;

        // Anthropic API
        this.apiKey = process.env.ENDERSECHO_ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey && config.ocr.useAI === true;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.ENDERSECHO_ANTHROPIC_MODEL || 'claude-3-haiku-20240307';
            logger.success(`✅ AI OCR aktywny - model: ${this.model}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak ENDERSECHO_ANTHROPIC_API_KEY');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_ENDERSECHO_AI_OCR=false');
        }
    }

    /**
     * Analizuje zdjęcie wyniku przez Claude Vision
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{bossName: string|null, score: string|null, confidence: number, isValidVictory: boolean, error?: string}>}
     */
    async analyzeVictoryImage(imagePath) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony');
        }

        try {
            logger.info(`[AI OCR] Rozpoczynam analizę obrazu: ${imagePath}`);

            // Konwertuj obraz na PNG używając sharp (normalizacja formatu)
            const pngBuffer = await sharp(imagePath)
                .png()
                .toBuffer();

            const base64Image = pngBuffer.toString('base64');
            const mediaType = 'image/png';

            // === KROK 1: Sprawdź czy jest "Victory" ===
            logger.info(`[AI OCR] KROK 1: Sprawdzam obecność "Victory"...`);

            const checkPrompt = `Poszukaj na załączonym screenie czy występuje fraza "Victory". Jeżeli nie znajdziesz napisz dokładnie te trzy słowa: "Nie znalezionow frazy", nie pisz nic poza tym. Jeżeli znajdziesz napisz tylko jedno słowo: "Znaleziono", nie pisz nic poza tym.`;

            const checkMessage = await this.client.messages.create({
                model: this.model,
                max_tokens: 50,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: checkPrompt
                        }
                    ]
                }]
            });

            const checkResponse = checkMessage.content[0].text.trim();
            logger.info(`[AI OCR] KROK 1 - Odpowiedź: "${checkResponse}"`);

            // Sprawdź czy znaleziono "Victory"
            // Sprawdzamy czy odpowiedź NIE zawiera frazy "nie znaleziono" (case insensitive)
            const foundVictory = !checkResponse.toLowerCase().includes('nie znaleziono');

            if (!foundVictory) {
                logger.warn(`[AI OCR] KROK 1 - Nie znaleziono "Victory", przerywam analizę`);
                return {
                    bossName: null,
                    score: null,
                    confidence: 0,
                    isValidVictory: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }

            logger.info(`[AI OCR] KROK 1 - "Victory" znaleznione, przechodzę do KROKU 2`);

            // === KROK 2: Sprawdź czy zdjęcie nie jest fałszywe ===
            logger.info(`[AI OCR] KROK 2: Sprawdzam autentyczność zdjęcia...`);

            const fakeCheckPrompt = `Przeprowadź ABSOLUTNIE DOKŁADNĄ weryfikację zdjęcia ze SZCZEGÓLNYM naciskiem na:
DOKŁADNĄ ANALIZĘ LICZB
Sprawdzenie KAŻDEGO piksela w cyfrach
Analiza spójności czcionkiWE WSZYSTKICH ZNAKACH
SZCZEGÓLNA UWAGA na cyfry po przecinku
Porównanie WSZYSTKICH znaków z oficjalnym interfejsem gry
KLUCZOWE KRYTERIA WERYFIKACJI
Czy KAŻDY piksel jest 100% zgodny z oryginalnym interfejsem
Czy liczby wyglądają IDEALNIE symetrycznie
Czy po przecinku nie ma JAKICHKOLWIEK oznak edycji
METODOLOGIA SPRAWDZENIA
Porównaj KAŻDY element z wzorcem oryginalnego interfejsu
Zwróć uwagę na NAJMNIEJSZE rozbieżności
Sprawdź KAŻDĄ literę i cyfrę pod kątem zgodności
Sprawdz czy dostało coś dopisane odręcznie. 
INSTRUKCJA WYKONANIA:
Jeśli zauważysz JAKĄKOLWIEK ingerencję - napisz tylko jednym słowem "NOK". 
Jeśli ABSOLUTNIE WSZYSTKO jest oryginalne - napisz tylko jednym słowem "OK"`;

            const fakeCheckMessage = await this.client.messages.create({
                model: this.model,
                max_tokens: 10,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: fakeCheckPrompt
                        }
                    ]
                }]
            });

            const fakeCheckResponse = fakeCheckMessage.content[0].text.trim().toUpperCase();
            logger.info(`[AI OCR] KROK 2 - Odpowiedź: "${fakeCheckResponse}"`);

            // Sprawdź czy zdjęcie jest autentyczne
            if (fakeCheckResponse.includes('NOK')) {
                logger.warn(`[AI OCR] KROK 2 - WYKRYTO PODROBIONE ZDJĘCIE!`);
                return {
                    bossName: null,
                    score: null,
                    confidence: 0,
                    isValidVictory: false,
                    error: 'FAKE_PHOTO'
                };
            }

            logger.info(`[AI OCR] KROK 2 - Zdjęcie autentyczne, przechodzę do KROKU 3`);

            // === KROK 3: Wyciągnij nazwę bossa i wynik ===
            logger.info(`[AI OCR] KROK 3: Wyciągam nazwę bossa i wynik...`);

            const extractPrompt = `Odczytaj zawartość zdjęcia. Poniżej napisu "Victory" znajduje się nazwa Bossa. Poniżej nazwy bossa znajduje się wynik (Best). Na ekranie jest też wartość "Total" - odczytaj ją również.

WAŻNE - Możliwe jednostki wyniku (od najmniejszej do największej): K, M, B, T, Q, Qi
UWAGA: Litera Q w jednostce może wyglądać podobnie do cyfry 0 - upewnij się że prawidłowo rozpoznajesz jednostkę.
UWAGA: Ostatni znak wyniku to ZAWSZE litera jednostki (K/M/B/T/Q), NIGDY cyfra. Jeśli widzisz coś jak "18540" bez litery - prawdopodobnie ostatni znak to litera Q, nie cyfra 0.

⚠️ KRYTYCZNA ZASADA ODCZYTU WYNIKU:
Odczytaj wynik DOKŁADNIE tak jak jest napisany na ekranie.
NIE DODAWAJ separatorów (przecinków ani kropek) które NIE SĄ wyraźnie widoczne na obrazie.
NIGDY nie interpretuj cyfr jako "tysięcy" i nie dodawaj przecinków.
NIGDY nie dodawaj dodatkowych cyfr których nie ma na ekranie.
Zwróć szczególną uwagę na OSTATNI ZNAK wyniku - to jest jednostka (litera), nie cyfra.

Odczytaj nazwę bossa, dokładny wynik (Best) wraz z jednostką, oraz Total i napisz w następującym formacie:
<nazwa bossa>
<wynik>
<total>`;

            const extractMessage = await this.client.messages.create({
                model: this.model,
                max_tokens: 500,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: extractPrompt
                        }
                    ]
                }]
            });

            const extractResponse = extractMessage.content[0].text;
            logger.info(`[AI OCR] KROK 3 - Odpowiedź Claude:`);
            logger.info(extractResponse);

            // Parsuj odpowiedź AI
            const result = this.parseAIResponse(extractResponse);
            logger.info(`[AI OCR] KROK 3 - Wynik parsowania:`, result);

            return result;

        } catch (error) {
            logger.error(`[AI OCR] Błąd analizy obrazu:`, error);
            throw error;
        }
    }

    /**
     * Parsuje odpowiedź Claude i wyciąga nazwę bossa + wynik
     * @param {string} responseText - Odpowiedź AI
     * @returns {{bossName: string|null, score: string|null, confidence: number, isValidVictory: boolean, error?: string}}
     */
    parseAIResponse(responseText) {
        const lowerResponse = responseText.toLowerCase();

        // Sprawdź czy AI wykrył niepoprawny screen
        const invalidKeywords = [
            'niepoprawny screen',
            'przesłano niepoprawny',
            'trzeba przesłać screen',
            'nie wykryłem',
            'nie wykryto',
            'brak victory',
            'nie znalazłem',
            'nie można odczytać'
        ];

        for (const keyword of invalidKeywords) {
            if (lowerResponse.includes(keyword)) {
                logger.info(`[AI OCR] AI wykrył niepoprawny screen (keyword: "${keyword}")`);
                return {
                    bossName: null,
                    score: null,
                    confidence: 0,
                    isValidVictory: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }
        }

        // Wyciągnij nazwę bossa, wynik i total - pierwsze trzy niepuste linie
        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            logger.warn(`[AI OCR] AI zwrócił za mało linii (${lines.length})`);
            return {
                bossName: null,
                score: null,
                confidence: 0,
                isValidVictory: false,
                error: 'PARSING_ERROR'
            };
        }

        // Pierwsza linia = nazwa bossa (usuń potencjalne prefix "Boss:" lub podobne)
        let bossName = lines[0]
            .replace(/^boss[:\s]*/i, '')
            .replace(/^nazwa[:\s]*bossa[:\s]*/i, '')
            .trim();

        // Druga linia = wynik (usuń potencjalne prefix "Wynik:" lub podobne)
        let score = lines[1]
            .replace(/^wynik[:\s]*/i, '')
            .replace(/^score[:\s]*/i, '')
            .replace(/^best[:\s]*/i, '')
            .trim();

        // Trzecia linia = total (opcjonalna)
        let total = null;
        if (lines.length >= 3) {
            total = lines[2]
                .replace(/^total[:\s]*/i, '')
                .trim();
            total = this.normalizeScore(total);
            logger.info(`[AI OCR] Odczytano Total: "${total}"`);
        }

        // Normalizacja wyniku (max 5 cyfr + jednostka)
        score = this.normalizeScore(score);

        // Walidacja score vs Total - jeśli score > total, prawdopodobnie AI dodał cyfrę 0 zamiast rozpoznać literę jednostki
        if (score && total) {
            score = this.validateScoreAgainstTotal(score, total);
        }

        // Walidacja
        const isValid = bossName && score && score.length > 0;

        if (!isValid) {
            logger.warn(`[AI OCR] Walidacja nie powiodła się - boss: "${bossName}", wynik: "${score}"`);
        }

        // Oblicz confidence (prosta heurystyka)
        let confidence = 0;
        if (bossName) {
            confidence += 50;
            if (bossName.length >= 3) confidence += 10;
        }
        if (score && score.length > 0) {
            confidence += 40;
        }

        return {
            bossName: isValid ? bossName : null,
            score: isValid ? score : null,
            confidence: Math.min(confidence, 100),
            isValidVictory: isValid,
            error: isValid ? undefined : 'VALIDATION_FAILED'
        };
    }

    /**
     * Normalizuje wynik - max 5 cyfr PRZED kropką + jednostka
     * Zasady:
     * - Max 5 cyfr PRZED kropką (część całkowita)
     * - Jeśli przed kropką 1 cyfra → po kropce max 2 cyfry
     * - Jeśli przed kropką 2-5 cyfr → po kropce max 1 cyfra
     * - Jeśli jest 6+ cyfr przed kropką → obcina do 5
     * @param {string} score - Wynik do normalizacji
     * @returns {string} - Znormalizowany wynik
     */
    normalizeScore(score) {
        if (!score) return score;

        // === Usuwanie przecinków (AI czasem halucynuje separatory tysięcy) ===
        if (score.includes(',')) {
            const cleanedScore = score.replace(/,/g, '');
            logger.info(`[AI OCR] Normalizacja: Usunięto przecinek: "${score}" → "${cleanedScore}"`);
            score = cleanedScore;
        }

        // === POST-PROCESSING: Naprawa błędnej interpretacji jednostki Qi ===
        // AI często myli Q z cyfrą 0, np. "364.4Qi" → "364.40i"
        // Jeśli wynik kończy się na "0i" (gdzie 0 to pomylone Q) → zamień na "Qi"
        if (/\d0i$/i.test(score)) {
            const fixedScore = score.replace(/(\d)0i$/i, '$1Qi');
            logger.info(`[AI OCR] Post-processing: Naprawiono "0i" → "Qi": "${score}" → "${fixedScore}"`);
            score = fixedScore;
        }
        // Jeśli jednostka to samo "i" (bez Q przed) → zamień na "Qi"
        else if (/\di$/i.test(score) && !/Qi$/i.test(score)) {
            const fixedScore = score.replace(/i$/i, 'Qi');
            logger.info(`[AI OCR] Post-processing: Naprawiono "i" → "Qi": "${score}" → "${fixedScore}"`);
            score = fixedScore;
        }

        // Regex: cyfry (opcjonalnie z kropką i cyframi dziesiętnymi) + opcjonalna jednostka
        const match = score.match(/^([\d,.]+)\s*(K|M|B|T|Q|QI|Qi)?$/i);
        if (!match) {
            logger.info(`[AI OCR] Normalizacja: Nie udało się sparsować wyniku "${score}"`);
            return score;
        }

        let numberPart = match[1].replace(/,/g, '.'); // Zamień przecinki na kropki
        const unit = match[2] || '';

        // Rozdziel na część całkowitą i dziesiętną
        const parts = numberPart.split('.');
        let integerPart = parts[0] || '';
        let decimalPart = parts[1] || '';

        const originalScore = score;

        // Jeśli jest jednostka, normalizuj liczbę cyfr
        if (unit) {
            // Sprawdź część CAŁKOWITĄ (przed kropką) - max 5 cyfr
            if (integerPart.length > 5) {
                logger.warn(`[AI OCR] Normalizacja: Wykryto ${integerPart.length} cyfr przed kropką z jednostką ${unit} - obcinam do 5`);
                integerPart = integerPart.substring(0, 5);
            }

            // Sprawdź część dziesiętną (po kropce)
            if (decimalPart) {
                if (integerPart.length === 1) {
                    // 1 cyfra przed kropką → max 2 po kropce
                    if (decimalPart.length > 2) {
                        decimalPart = decimalPart.substring(0, 2);
                    }
                } else {
                    // 2-5 cyfr przed kropką → max 1 po kropce
                    if (decimalPart.length > 1) {
                        decimalPart = decimalPart.substring(0, 1);
                    }
                }
            }
        }

        // Zbuduj znormalizowany wynik
        let normalizedScore;
        if (decimalPart) {
            normalizedScore = `${integerPart}.${decimalPart}${unit}`;
        } else {
            normalizedScore = `${integerPart}${unit}`;
        }

        if (normalizedScore !== originalScore) {
            logger.info(`[AI OCR] Normalizacja: "${originalScore}" → "${normalizedScore}"`);
        }

        return normalizedScore;
    }

    /**
     * Konwertuje wynik z jednostką na liczbę do porównania
     * np. "1854Q" → 1854e15, "6513.3Q" → 6513.3e15
     * @param {string} score - Wynik z jednostką
     * @returns {number|null} - Wartość liczbowa lub null jeśli nie da się sparsować
     */
    parseScoreToNumber(score) {
        if (!score) return null;

        const unitMultipliers = {
            'K': 1e3,
            'M': 1e6,
            'B': 1e9,
            'T': 1e12,
            'Q': 1e15,
            'QI': 1e18
        };

        const match = score.match(/^([\d.]+)\s*(K|M|B|T|Q|QI|Qi)?$/i);
        if (!match) return null;

        const number = parseFloat(match[1]);
        const unit = (match[2] || '').toUpperCase();
        const multiplier = unitMultipliers[unit] || 1;

        return number * multiplier;
    }

    /**
     * Waliduje score vs Total - jeśli score > total, prawdopodobnie AI dodał cyfrę zamiast jednostki
     * np. AI odczytał "18540Q" zamiast "1854Q" (0 to w rzeczywistości Q)
     * @param {string} score - Wynik Best
     * @param {string} total - Wynik Total
     * @returns {string} - Skorygowany wynik
     */
    validateScoreAgainstTotal(score, total) {
        const scoreNum = this.parseScoreToNumber(score);
        const totalNum = this.parseScoreToNumber(total);

        if (scoreNum === null || totalNum === null) return score;

        // Jeśli score > total → coś jest nie tak
        if (scoreNum > totalNum) {
            logger.warn(`[AI OCR] Walidacja Total: score (${score} = ${scoreNum}) > total (${total} = ${totalNum}) - próbuję skorygować`);

            // Spróbuj usunąć ostatnią cyfrę przed jednostką (np. "18540Q" → "1854Q")
            const match = score.match(/^([\d.]+)(K|M|B|T|Q|QI|Qi)$/i);
            if (match) {
                const numberPart = match[1];
                const unit = match[2];

                // Usuń ostatnią cyfrę z części liczbowej
                if (numberPart.length > 1) {
                    const corrected = numberPart.slice(0, -1) + unit;
                    const correctedNum = this.parseScoreToNumber(corrected);

                    if (correctedNum !== null && correctedNum <= totalNum) {
                        logger.info(`[AI OCR] Walidacja Total: Skorygowano "${score}" → "${corrected}" (usunięto dodatkową cyfrę przed jednostką)`);
                        return corrected;
                    }
                }
            }

            logger.warn(`[AI OCR] Walidacja Total: Nie udało się automatycznie skorygować wyniku "${score}"`);
        }

        return score;
    }
}

module.exports = AIOCRService;
