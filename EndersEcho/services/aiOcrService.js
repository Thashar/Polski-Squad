const path = require('path');
const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const SAFETY_SETTINGS_OFF = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/**
 * Wersje promptów — emitowane jako `llm.prompt.name` + `llm.prompt.version`
 * na span generation. Pozwala w Langfuse filtrować/grupować po konkretnej
 * wersji promptu i porównywać z różnymi modelami (A/B testing).
 *
 * Zasada: po każdej zmianie treści promptu BUMPUJ version ('v1' → 'v2').
 * Stary trace z 'v1' zostaje w Langfuse do porównania — nie trać historii.
 */
const PROMPT_VERSIONS = {
    'victory-check-eng':  'v1',
    'victory-check-jpn':  'v1',
    'authenticity-check': 'v1',
    'extract-data-eng':   'v1',
    'extract-data-jpn':   'v1',
    'compare-template':   'v2',
};
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class AIOCRService {
    /**
     * @param {Object} config
     * @param {{ generate: Function }} llmAdapter — wspólny wrapper z utils/llmAdapter.js
     */
    constructor(config, llmAdapter) {
        this.config = config;
        this.adapter = llmAdapter;

        this.apiKey = process.env.ENDERSECHO_GOOGLE_AI_API_KEY;
        this.enabled = !!this.apiKey && config.ocr.useAI === true && !!llmAdapter;
        this.modelName = process.env.ENDERSECHO_GOOGLE_AI_MODEL || 'gemini-2.5-flash-preview-05-20';

        if (this.enabled) {
            logger.success(`✅ AI OCR aktywny - model: ${this.modelName}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak ENDERSECHO_GOOGLE_AI_API_KEY');
        } else if (!llmAdapter) {
            logger.warn('⚠️ AI OCR wyłączony - brak llmAdapter (DI) w konstruktorze');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_ENDERSECHO_AI_OCR=false');
        }
    }

    /**
     * Wywołanie Gemini przez wspólny adapter. Adapter otwiera OpenTelemetry span
     * (rozpoznawany przez Langfuse jako LLM generation) wewnątrz aktywnego
     * kontekstu — jeśli handler opakował flow w `withOperationSpan`, ten call
     * zostanie dzieckiem root spana operacji.
     *
     * Zachowuje poprzedni kształt odpowiedzi (text, promptTokens, outputTokens,
     * thoughtTokens) + dodaje pola telemetryczne (durationMs, traceId, provider).
     */
    async _generateContent(parts, maxOutputTokens, meta = {}) {
        const result = await this.adapter.generate({
            provider: 'gemini',
            model:    this.modelName,
            parts,
            maxOutputTokens,
            safetySettings: SAFETY_SETTINGS_OFF,
            meta,
        });

        return {
            text:          result.content,
            promptTokens:  result.usage.inputTokens,
            outputTokens:  result.usage.outputTokens,
            thoughtTokens: result.usage.thoughtTokens,
            durationMs:    result.durationMs,
            traceId:       result.traceId,
            provider:      result.provider,
            model:         result.model,
        };
    }

    /**
     * @param {string} imagePath
     * @param {object} log         — bot-per-guild logger
     * @param {object} [telemetryMeta] — { operationType, actorDiscordId, guildId, authorizationId }
     */
    async analyzeVictoryImage(imagePath, log = logger, telemetryMeta = {}) {
        if (!this.enabled) throw new Error('AI OCR nie jest włączony');

        const tokenUsage = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0 };

        try {
            const pngBuffer = await sharp(imagePath).png().toBuffer();
            const base64Image = pngBuffer.toString('base64');
            const mediaType = 'image/png';
            let fakeCheckDone = false;

            for (const lang of ['eng', 'jpn']) {
                const label = lang === 'eng' ? 'ang' : 'jpn';

                const { victoryFound, usage: u1 } = await this._checkVictory(base64Image, mediaType, lang, telemetryMeta);
                tokenUsage.promptTokens  += u1.promptTokens;
                tokenUsage.outputTokens  += u1.outputTokens;
                tokenUsage.thoughtTokens += u1.thoughtTokens;

                if (!victoryFound) {
                    log.info(`[AI OCR] ${label}: ✗Victory → próbuję ${lang === 'eng' ? 'japoński' : 'koniec'}`);
                    continue;
                }

                if (!fakeCheckDone) {
                    const { isAuthentic, usage: u2 } = await this._checkAuthentic(base64Image, mediaType, telemetryMeta);
                    tokenUsage.promptTokens  += u2.promptTokens;
                    tokenUsage.outputTokens  += u2.outputTokens;
                    tokenUsage.thoughtTokens += u2.thoughtTokens;
                    fakeCheckDone = true;
                    if (!isAuthentic) {
                        log.warn(`[AI OCR] ${label}: ✓Victory ✗autentyczne → FAKE_PHOTO`);
                        return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'FAKE_PHOTO', tokenUsage };
                    }
                }

                const { text, usage: u3 } = await this._extractData(base64Image, mediaType, lang, telemetryMeta);
                tokenUsage.promptTokens  += u3.promptTokens;
                tokenUsage.outputTokens  += u3.outputTokens;
                tokenUsage.thoughtTokens += u3.thoughtTokens;

                const result = this.parseAIResponse(text, log);

                if (result.isValidVictory) {
                    log.info(`✅ [AI OCR] ${label}: ✓Victory ✓autentyczne → boss="${result.bossName}" score="${result.score}"`);
                    return { ...result, tokenUsage };
                }

                log.warn(`[AI OCR] ${label}: ✓Victory ✓autentyczne ✗dane → ${lang === 'eng' ? 'próbuję japoński' : 'INVALID_SCREENSHOT'}`);
            }

            log.warn(`[AI OCR] Brak wyniku po wszystkich językach`);
            return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'INVALID_SCREENSHOT', tokenUsage };

        } catch (error) {
            log.error(`[AI OCR] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    async _checkVictory(base64Image, mediaType, lang, telemetryMeta) {
        const prompt = lang === 'jpn'
            ? `添付のスクリーンショットに「勝利」または「勝利！」というフレーズがあるか探してください。見つからない場合は、正確にこの3つの単語を書いてください：「Nie znalezionow frazy」、それ以外は何も書かないでください。見つかった場合は、「Znaleziono」という1つの単語だけ書いてください。`
            : `Poszukaj na załączonym screenie czy występuje fraza "Victory". Jeżeli nie znajdziesz napisz dokładnie te trzy słowa: "Nie znalezionow frazy", nie pisz nic poza tym. Jeżeli znajdziesz napisz tylko jedno słowo: "Znaleziono", nie pisz nic poza tym.`;

        const promptName = `victory-check-${lang}`;
        const res = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 50, {
            ...telemetryMeta,
            step: promptName,
            promptName,
            promptVersion: PROMPT_VERSIONS[promptName],
        });

        return { victoryFound: !res.text.trim().toLowerCase().includes('nie znaleziono'), usage: res };
    }

    async _checkAuthentic(base64Image, mediaType, telemetryMeta) {
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

        const res = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 10, {
            ...telemetryMeta,
            step: 'authenticity-check',
            promptName: 'authenticity-check',
            promptVersion: PROMPT_VERSIONS['authenticity-check'],
        });

        return { isAuthentic: !res.text.trim().toUpperCase().includes('NOK'), usage: res };
    }

    async _extractData(base64Image, mediaType, lang, telemetryMeta) {
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

        const promptName = `extract-data-${lang}`;
        const res = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 500, {
            ...telemetryMeta,
            step: promptName,
            promptName,
            promptVersion: PROMPT_VERSIONS[promptName],
        });

        return { text: res.text, usage: res, promptTokens: res.promptTokens, outputTokens: res.outputTokens, thoughtTokens: res.thoughtTokens };
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

    /**
     * @param {string} imagePath
     * @param {object} log         — bot-per-guild logger
     * @param {object} [telemetryMeta] — { operationType, actorDiscordId, guildId, authorizationId }
     */
    async analyzeTestImage(imagePath, log = logger, telemetryMeta = {}) {
        if (!this.enabled) throw new Error('AI OCR nie jest włączony');

        const tokenUsage = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0 };
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
            const { isSimilar, rejectionReason, usage: u1 } = await this._compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log, telemetryMeta);
            tokenUsage.promptTokens  += u1.promptTokens;
            tokenUsage.outputTokens  += u1.outputTokens;
            tokenUsage.thoughtTokens += u1.thoughtTokens;

            if (!isSimilar) {
                log.warn(`[AI Test] Zdjęcie niepodobne do wzorca: ${rejectionReason || 'brak powodu'}`);
                return { bossName: null, score: null, confidence: 0, isValidVictory: false, error: 'NOT_SIMILAR', rejectionReason, tokenUsage };
            }

            log.info('[AI Test] Zdjęcie podobne do wzorca → wyciągam dane...');

            const extractRes = await this._extractData(uploadedBase64, mediaType, 'eng', telemetryMeta);
            tokenUsage.promptTokens  += extractRes.promptTokens;
            tokenUsage.outputTokens  += extractRes.outputTokens;
            tokenUsage.thoughtTokens += extractRes.thoughtTokens;

            const result = this.parseAIResponse(extractRes.text, log);

            if (result.isValidVictory) {
                log.info(`[AI Test] Boss="${result.bossName}" score="${result.score}"`);
            } else {
                log.warn(`[AI Test] Nie udało się wyciągnąć danych: ${result.error}`);
            }

            return { ...result, tokenUsage };

        } catch (error) {
            log.error(`[AI Test] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    async _compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log = logger, telemetryMeta) {
        const prompt = `Masz wzorzec ekranu referencyjnego. Sprawdź czy drugie zdjęcie
pasuje DO TEGO WZORCA.

KROK 0 — Przed porównaniem:
Przetłumacz mentalnie wszystkie napisy na obydwu zdjęciach
na język angielski. Dopiero na przetłumaczonej wersji wykonaj
poniższe sprawdzenie.

WZORZEC (pierwsze zdjęcie) ma DOKŁADNIE:
- pełnoekranowe tło z gameplayem
- centralny panel BEZ ikony X ani przycisku zamknięcia
- kolorowy baner na górze panelu (zaokrąglony, bez paska tytułowego)
- pod banerem: nazwa postaci
- w centrum panelu: JEDNA duża ikona z liczbą
- poniżej: dwie linie statystyk (Best / Total)
- na dole panelu: rząd małych okrągłych ikon
- pod panelem: jeden żółty przycisk

Format odpowiedzi:
- Jeśli drugie zdjęcie pasuje do wzorca → odpowiedz TYLKO: OK
- Jeśli cokolwiek się różni strukturalnie → odpowiedz TYLKO: NOK: <krótki powód po polsku, max 15 słów>

Przykłady prawidłowych odpowiedzi:
OK
NOK: Brak ekranu wyników bossa, widoczny ekran menu głównego
NOK: Panel posiada ikonę zamknięcia (X)
NOK: Brak żółtego przycisku pod panelem

**ZASADA BEZWZGLĘDNA: Odpowiedz TYLKO w formacie OK lub NOK: <powód>. Zero innych słów.**`;

        const res = await this._generateContent([
            { inlineData: { data: wzorBase64, mimeType: mediaType } },
            { inlineData: { data: uploadedBase64, mimeType: mediaType } },
            { text: prompt }
        ], 50, {
            ...telemetryMeta,
            step: 'compare-template',
            promptName: 'compare-template',
            promptVersion: PROMPT_VERSIONS['compare-template'],
        });

        const response = res.text.trim();
        const upper = response.toUpperCase();
        log.info(`[AI Test] Odpowiedź porównania: "${response}"`);
        const isSimilar = upper.startsWith('OK') && !upper.startsWith('NOK');
        let rejectionReason = null;
        if (!isSimilar) {
            const colonIdx = response.indexOf(':');
            if (colonIdx !== -1) {
                rejectionReason = response.substring(colonIdx + 1).trim();
            }
        }
        return { isSimilar, rejectionReason, usage: res };
    }

    /**
     * Uruchamia tylko krok ekstrakcji danych (bez porównania z wzorcem).
     * Używane przez przycisk "Analizuj" w kanale raportów.
     */
    async extractImageData(imagePath, log = logger, telemetryMeta = {}) {
        if (!this.enabled) throw new Error('AI OCR nie jest włączony');
        const tokenUsage = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0 };
        try {
            const uploadedBuffer = await sharp(imagePath).png().toBuffer();
            const uploadedBase64 = uploadedBuffer.toString('base64');
            const mediaType = 'image/png';

            log.info('[AI Analyze] Wyciągam dane ze zdjęcia (bez sprawdzania wzorca)...');
            const extractRes = await this._extractData(uploadedBase64, mediaType, 'eng', telemetryMeta);
            tokenUsage.promptTokens  += extractRes.promptTokens;
            tokenUsage.outputTokens  += extractRes.outputTokens;
            tokenUsage.thoughtTokens += (extractRes.thoughtTokens || 0);

            const result = this.parseAIResponse(extractRes.text, log);
            if (result.isValidVictory) {
                log.info(`[AI Analyze] Boss="${result.bossName}" score="${result.score}"`);
            } else {
                log.warn(`[AI Analyze] Nie udało się wyciągnąć danych: ${result.error}`);
            }
            return { ...result, tokenUsage };
        } catch (error) {
            log.error(`[AI Analyze] Błąd analizy: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AIOCRService;
