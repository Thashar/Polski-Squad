const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const SAFETY_SETTINGS_OFF = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class AIOCRService {
    constructor(config) {
        this.config = config;

        this.apiKey = process.env.ENDERSECHO_GOOGLE_AI_API_KEY;
        this.enabled = !!this.apiKey && config.ocr.useAI === true;

        if (this.enabled) {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.modelName = process.env.ENDERSECHO_GOOGLE_AI_MODEL || 'gemini-2.5-flash';
            logger.success(`✅ AI OCR aktywny - model: ${this.modelName}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak ENDERSECHO_GOOGLE_AI_API_KEY');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_ENDERSECHO_AI_OCR=false');
        }
    }

    _getModel(maxOutputTokens) {
        return this.genAI.getGenerativeModel({
            model: this.modelName,
            generationConfig: { maxOutputTokens },
            safetySettings: SAFETY_SETTINGS_OFF
        });
    }

    async _generateContent(parts, maxOutputTokens) {
        const model = this._getModel(maxOutputTokens);
        const result = await model.generateContent({
            contents: [{ role: 'user', parts }]
        });

        const feedback = result.response.promptFeedback;
        if (feedback?.blockReason) {
            throw new Error(`Safety filter zablokował odpowiedź: ${feedback.blockReason}`);
        }

        const candidate = result.response.candidates?.[0];
        if (!candidate) {
            throw new Error('Brak kandydatów w odpowiedzi Gemini (safety filter lub błąd API)');
        }

        if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
            throw new Error(`Odpowiedź zakończona z powodu: ${candidate.finishReason}`);
        }

        return result.response.text();
    }

    async analyzeVictoryImage(imagePath, log = logger) {
        if (!this.enabled) throw new Error('AI OCR nie jest włączony');

        try {
            const pngBuffer = await sharp(imagePath).png().toBuffer();
            const base64Image = pngBuffer.toString('base64');
            const mediaType = 'image/png';
            let fakeCheckDone = false;

            for (const lang of ['eng', 'jpn']) {
                const label = lang === 'eng' ? 'ang' : 'jpn';

                const victoryFound = await this._checkVictory(base64Image, mediaType, lang);
                if (!victoryFound) {
                    log.info(`[AI OCR] ${label}: ✗Victory → próbuję ${lang === 'eng' ? 'japoński' : 'koniec'}`);
                    continue;
                }

                if (!fakeCheckDone) {
                    const isAuthentic = await this._checkAuthentic(base64Image, mediaType);
                    fakeCheckDone = true;
                    if (!isAuthentic) {
                        log.warn(`[AI OCR] ${label}: ✓Victory ✗autentyczne → FAKE_PHOTO`);
                        return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'FAKE_PHOTO' };
                    }
                }

                const extractResponse = await this._extractData(base64Image, mediaType, lang);
                const result = this.parseAIResponse(extractResponse, log);

                if (result.isValidVictory) {
                    log.info(`✅ [AI OCR] ${label}: ✓Victory ✓autentyczne → boss="${result.bossName}" score="${result.score}"`);
                    return result;
                }

                log.warn(`[AI OCR] ${label}: ✓Victory ✓autentyczne ✗dane → ${lang === 'eng' ? 'próbuję japoński' : 'INVALID_SCREENSHOT'}`);
            }

            log.warn(`[AI OCR] Brak wyniku po wszystkich językach`);
            return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'INVALID_SCREENSHOT' };

        } catch (error) {
            log.error(`[AI OCR] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    async _checkVictory(base64Image, mediaType, lang) {
        const prompt = lang === 'jpn'
            ? `添付のスクリーンショットに「勝利」または「勝利！」というフレーズがあるか探してください。見つからない場合は、正確にこの3つの単語を書いてください：「Nie znalezionow frazy」、それ以外は何も書かないでください。見つかった場合は、「Znaleziono」という1つの単語だけ書いてください。`
            : `Poszukaj na załączonym screenie czy występuje fraza "Victory". Jeżeli nie znajdziesz napisz dokładnie te trzy słowa: "Nie znalezionow frazy", nie pisz nic poza tym. Jeżeli znajdziesz napisz tylko jedno słowo: "Znaleziono", nie pisz nic poza tym.`;

        const responseText = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 50);

        return !responseText.trim().toLowerCase().includes('nie znaleziono');
    }

    async _checkAuthentic(base64Image, mediaType) {
        const prompt = `Przeprowadź ABSOLUTNIE DOKŁADNĄ weryfikację zdjęcia ze SZCZEGÓLNYM naciskiem na:
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

        const responseText = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 10);

        return !responseText.trim().toUpperCase().includes('NOK');
    }

    async _extractData(base64Image, mediaType, lang) {
        const prompt = lang === 'jpn'
            ? `この画像の内容を読み取ってください。「勝利！」の下にボス名があります。ボス名の下にスコア（最高記録）があります。画面には「合計」の値もあります。それも読み取ってください。
重要 — スコアの単位（小さい順）: K, M, B, T, Q, Qi, Sx
注意：単位の「Q」は数字の「0」に似て見えることがあります — 正確に識別してください。
注意：スコアの最後の文字は常に単位（アルファベット）であり、数字ではありません。「18540」のように文字がない場合、最後の文字はおそらく「Q」であり「0」ではありません。
⚠️ スコア読み取りの重要ルール：
画面に表示されている通りに正確に読み取ってください。
画像に明確に表示されていない区切り文字（カンマや小数点）を追加しないでください。
数字を「千」単位として解釈してカンマを追加しないでください。
画面にない数字を追加しないでください。
スコアの最後の文字に特に注意してください — それは単位（アルファベット）であり、数字ではありません。
ボス名、スコア（最高記録）と単位、合計の値を以下の形式で記載してください：
<ボス名>
<スコア>
<合計>`
            : `To jest screen z wynikami z gry mobilnej. Odczytaj z niego trzy wartości:
1. Nazwa bossa — widoczna jako nazwa postaci/przeciwnika na ekranie wyników
2. Wynik Best — liczba z jednostką (np. 123.4M), oznaczona jako "Best" na ekranie
3. Wynik Total — liczba z jednostką, oznaczona jako "Total" na ekranie
WAŻNE - Możliwe jednostki (od najmniejszej): K, M, B, T, Q, Qi, Sx
UWAGA: Litera Q może wyglądać jak cyfra 0 — rozróżniaj je uważnie.
UWAGA: Ostatni znak wyniku to ZAWSZE litera jednostki (K/M/B/T/Q/Qi/Sx), NIGDY cyfra.
⚠️ KRYTYCZNA ZASADA:
Odczytaj wartości DOKŁADNIE tak jak są na ekranie.
NIE DODAWAJ przecinków ani kropek których nie ma na obrazie.
NIE DODAWAJ cyfr których nie ma na ekranie.
Odpowiedz WYŁĄCZNIE w tym formacie (3 linie, nic więcej):
<nazwa bossa>
<wynik Best z jednostką>
<wynik Total z jednostką>`;

        return await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 500);
    }

    parseAIResponse(responseText, log = logger) {
        const lowerResponse = responseText.toLowerCase();

        const invalidKeywords = [
            'niepoprawny screen', 'przesłano niepoprawny', 'trzeba przesłać screen',
            'nie wykryłem', 'nie wykryto', 'brak victory', 'nie znalazłem', 'nie można odczytać',
            'nie mogę odczytać', 'nie mogę', 'przepraszam', 'nie ma napisu', 'nie widzę',
            'cannot read', 'unable to read', 'i cannot', 'i\'m unable', 'no text'
        ];
        if (invalidKeywords.some(kw => lowerResponse.includes(kw))) {
            return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'INVALID_SCREENSHOT' };
        }

        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            log.warn(`[AI OCR] Odpowiedź za krótka (${lines.length} linii): "${responseText.trim()}"`);
            return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'PARSING_ERROR' };
        }

        let bossName = lines[0].replace(/^boss[:\s]*/i, '').replace(/^nazwa[:\s]*bossa[:\s]*/i, '').trim();
        let score    = lines[1].replace(/^wynik[:\s]*/i, '').replace(/^score[:\s]*/i, '').replace(/^best[:\s]*/i, '').trim();

        let total = null;
        if (lines.length >= 3) {
            total = this.normalizeScore(lines[2].replace(/^total[:\s]*/i, '').trim(), log);
            if (total) log.info(`✅ [AI OCR] Total: "${total}"`);
        }

        score = this.normalizeScore(score, log);
        if (score && total) score = this.validateScoreAgainstTotal(score, total, log);

        const validScorePattern = /^\d+(?:\.\d+)?(K|M|B|T|Q|Qi|Sx)$/i;
        if (score && !validScorePattern.test(score)) {
            log.warn(`[AI OCR] Wynik "${score}" nie posiada prawidłowej jednostki (K/M/B/T/Q/Qi/Sx) — odrzucam`);
            return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'INVALID_SCORE_FORMAT' };
        }

        const isValid = !!(bossName && score && score.length > 0);
        if (!isValid) {
            log.warn(`[AI OCR] Walidacja ✗ boss:"${bossName}" score:"${score}"`);
        }

        let confidence = 0;
        if (bossName) { confidence += 50; if (bossName.length >= 3) confidence += 10; }
        if (score && score.length > 0) confidence += 40;

        return {
            bossName: isValid ? bossName : null,
            score:    isValid ? score    : null,
            confidence: Math.min(confidence, 100),
            isValidVictory: isValid,
            error: isValid ? undefined : 'VALIDATION_FAILED'
        };
    }

    normalizeScore(score, log = logger) {
        if (!score) return score;

        if (score.includes(',')) {
            const cleaned = score.replace(/,/g, '');
            log.info(`[AI OCR] normalizeScore: usunięto przecinek "${score}" → "${cleaned}"`);
            score = cleaned;
        }

        if (/\d0i$/i.test(score)) {
            const fixed = score.replace(/(\d)0i$/i, '$1Qi');
            log.info(`[AI OCR] normalizeScore: "0i" → "Qi" "${score}" → "${fixed}"`);
            score = fixed;
        } else if (/\di$/i.test(score) && !/Qi$/i.test(score)) {
            const fixed = score.replace(/i$/i, 'Qi');
            log.info(`[AI OCR] normalizeScore: "i" → "Qi" "${score}" → "${fixed}"`);
            score = fixed;
        }

        const match = score.match(/^([\d,.]+)\s*(K|M|B|T|Q|QI|Qi|SX|Sx)?$/i);
        if (!match) return score;

        let numberPart = match[1].replace(/,/g, '.');
        const unit = match[2] || '';
        const parts = numberPart.split('.');
        let integerPart = parts[0] || '';
        let decimalPart = parts[1] || '';
        const originalScore = score;

        if (unit) {
            if (integerPart.length > 5) {
                log.warn(`[AI OCR] normalizeScore: obcięto ${integerPart.length} cyfr → 5 (${unit})`);
                integerPart = integerPart.substring(0, 5);
            }
            if (decimalPart) {
                const maxDec = integerPart.length === 1 ? 2 : 1;
                if (decimalPart.length > maxDec) decimalPart = decimalPart.substring(0, maxDec);
            }
        }

        const normalized = decimalPart ? `${integerPart}.${decimalPart}${unit}` : `${integerPart}${unit}`;
        if (normalized !== originalScore) {
            log.info(`[AI OCR] normalizeScore: "${originalScore}" → "${normalized}"`);
        }

        return normalized;
    }

    parseScoreToNumber(score) {
        if (!score) return null;
        const unitMultipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, Q: 1e15, QI: 1e18, SX: 1e21 };
        const match = score.match(/^([\d.]+)\s*(K|M|B|T|Q|QI|Qi|SX|Sx)?$/i);
        if (!match) return null;
        return parseFloat(match[1]) * (unitMultipliers[(match[2] || '').toUpperCase()] || 1);
    }

    validateScoreAgainstTotal(score, total, log = logger) {
        const scoreNum = this.parseScoreToNumber(score);
        const totalNum = this.parseScoreToNumber(total);
        if (scoreNum === null || totalNum === null || scoreNum <= totalNum) return score;

        log.warn(`[AI OCR] validateTotal: score ${score} > total ${total} — próbuję korektę`);

        const match = score.match(/^([\d.]+)(K|M|B|T|Q|QI|Qi)$/i);
        if (match && match[1].length > 1) {
            const corrected = match[1].slice(0, -1) + match[2];
            const correctedNum = this.parseScoreToNumber(corrected);
            if (correctedNum !== null && correctedNum <= totalNum) {
                log.info(`✅ [AI OCR] validateTotal: "${score}" → "${corrected}"`);
                return corrected;
            }
        }

        log.warn(`[AI OCR] validateTotal: nie udało się skorygować "${score}"`);
        return score;
    }

    async analyzeTestImage(imagePath, log = logger) {
        if (!this.enabled) throw new Error('AI OCR nie jest włączony');

        const wzorPath = path.join(__dirname, '../files/Wzór.jpg');

        try {
            const [uploadedBuffer, wzorBuffer] = await Promise.all([
                sharp(imagePath).png().toBuffer(),
                sharp(wzorPath).png().toBuffer()
            ]);

            const uploadedBase64 = uploadedBuffer.toString('base64');
            const wzorBase64 = wzorBuffer.toString('base64');
            const mediaType = 'image/png';

            log.info('[AI Test] Porównuję zdjęcie z wzorcem...');
            const isSimilar = await this._compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log);

            if (!isSimilar) {
                log.warn('[AI Test] Zdjęcie niepodobne do wzorca');
                return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'NOT_SIMILAR' };
            }

            log.info('[AI Test] Zdjęcie podobne do wzorca → wyciągam dane...');

            const extractResponse = await this._extractData(uploadedBase64, mediaType, 'eng');
            const result = this.parseAIResponse(extractResponse, log);

            if (result.isValidVictory) {
                log.info(`[AI Test] Boss="${result.bossName}" score="${result.score}"`);
            } else {
                log.warn(`[AI Test] Nie udało się wyciągnąć danych: ${result.error}`);
            }

            return result;

        } catch (error) {
            log.error(`[AI Test] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    async _compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log = logger) {
        const prompt = `Oba zdjęcia powinny być screenami z ekranem wyników tej samej gry mobilnej. Porównaj elementy wizualne obu zdjęć. Jeśli oba przedstawiają podobny ekran wyników z podobnymi elementami wizualnymi — odpowiedz "OK". Jeśli zdjęcia wyraźnie się różnią lub drugie zdjęcie nie wygląda jak ekran wyników tej samej gry — odpowiedz "NOK".

KRYTYCZNA ZASADA: Twoja odpowiedź musi składać się WYŁĄCZNIE z jednego słowa: "OK" lub "NOK". Żadnych innych słów, żadnych wyjaśnień, żadnych znaków interpunkcyjnych. Tylko "OK" lub "NOK".`;

        const responseText = await this._generateContent([
            { inlineData: { data: wzorBase64, mimeType: mediaType } },
            { inlineData: { data: uploadedBase64, mimeType: mediaType } },
            { text: prompt }
        ], 10);

        const response = responseText.trim().toUpperCase();
        log.info(`[AI Test] Odpowiedź porównania: "${response}"`);
        if (!response || !response.includes('OK')) return false;
        return !response.includes('NOK');
    }
}

module.exports = AIOCRService;
