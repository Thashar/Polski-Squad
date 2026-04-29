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
    'extract-data-eng':  'v1',
    'compare-template':  'v3',
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

        const apiKey = process.env.ENDERSECHO_GOOGLE_AI_API_KEY;
        this.enabled = !!apiKey && config.ocr.useAI === true && !!llmAdapter;
        this.modelName = process.env.ENDERSECHO_GOOGLE_AI_MODEL || 'gemini-2.5-flash-preview-05-20';

        if (this.enabled) {
            logger.success(`✅ AI OCR aktywny - model: ${this.modelName}`);
        } else if (!apiKey) {
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
            thoughtTokens: result.usage.thoughtTokens || 0,
            durationMs:    result.durationMs,
            traceId:       result.traceId,
            provider:      result.provider,
            model:         result.model,
        };
    }

    async _extractData(base64Image, mediaType, telemetryMeta) {
        const prompt = `To jest screen z wynikami z gry mobilnej. Odczytaj z niego trzy wartości:
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
JEŻELI NIE MA TEKSTU NA EKRANIE ZWRÓĆ ZERO!
ZAKAZ HALUCYNACJI, ZAKAZ WYMYŚLANIA LICZB!
Odpowiedz WYŁĄCZNIE w tym formacie (3 linie, nic więcej):
<nazwa bossa>
<wynik Best z jednostką>
<wynik Total z jednostką>`;

        const res = await this._generateContent([
            { inlineData: { data: base64Image, mimeType: mediaType } },
            { text: prompt }
        ], 500, {
            ...telemetryMeta,
            step: 'extract-data-eng',
            promptName: 'extract-data-eng',
            promptVersion: PROMPT_VERSIONS['extract-data-eng'],
        });

        return { text: res.text, promptTokens: res.promptTokens, outputTokens: res.outputTokens, thoughtTokens: res.thoughtTokens };
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
            return { bossName: null, score: null, isValidVictory: false, error: 'INVALID_SCREENSHOT' };
        }

        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            log.warn(`[AI OCR] Odpowiedź za krótka (${lines.length} linii): "${responseText.trim()}"`);
            return { bossName: null, score: null, isValidVictory: false, error: 'PARSING_ERROR' };
        }

        let bossName = lines[0].replace(/^boss[:\s]*/i, '').replace(/^nazwa[:\s]*bossa[:\s]*/i, '').trim();
        let score    = lines[1].replace(/^wynik[:\s]*/i, '').replace(/^score[:\s]*/i, '').replace(/^best[:\s]*/i, '').trim();

        let total = null;
        if (lines.length >= 3) {
            total = this.normalizeScore(lines[2].replace(/^total[:\s]*/i, '').trim(), log);
            if (total === null) {
                return { bossName: null, score: null, isValidVictory: false, error: 'FAKE_PHOTO' };
            }
        }

        score = this.normalizeScore(score, log);
        if (score === null) {
            return { bossName: null, score: null, isValidVictory: false, error: 'FAKE_PHOTO' };
        }
        if (score && total) {
            const corrected = this.validateScoreAgainstTotal(score, total, log);
            if (corrected === null) {
                return { bossName: null, score: null, total, isValidVictory: false, error: 'BEST_EXCEEDS_TOTAL' };
            }
            score = corrected;
        }

        const validScorePattern = /^\d+(?:\.\d+)?(K|M|B|T|Q|Qi|Sx)$/i;
        if (score && !validScorePattern.test(score)) {
            log.warn(`[AI OCR] Wynik "${score}" nie posiada prawidłowej jednostki (K/M/B/T/Q/Qi/Sx) — odrzucam`);
            return { bossName: null, score: null, isValidVictory: false, error: 'INVALID_SCORE_FORMAT' };
        }

        const isValid = !!(bossName && score && score.length > 0);
        if (!isValid) {
            log.warn(`[AI OCR] Walidacja ✗ boss:"${bossName}" score:"${score}"`);
        }

        return {
            bossName: isValid ? bossName : null,
            score:    isValid ? score    : null,
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
                if (decimalPart.length > maxDec) {
                    log.warn(`[AI OCR] normalizeScore: "${originalScore}" za dużo miejsc po przecinku (${decimalPart.length} > ${maxDec}) — odrzucam jako podróbkę`);
                    return null;
                }
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

        log.warn(`[AI OCR] validateTotal: nie udało się skorygować "${score}" — odrzucam`);
        return null;
    }

    /**
     * Przepływ /update i /test: porównanie z wzorcem, potem ekstrakcja danych.
     * @param {string} imagePath
     * @param {object} log         — bot-per-guild logger
     * @param {object} [telemetryMeta] — { operationType, actorDiscordId, guildId, authorizationId }
     * @param {string} [lang]      — język serwera ('pol'|'eng'), wpływa na powód odrzucenia
     */
    async analyzeTestImage(imagePath, log = logger, telemetryMeta = {}, lang = 'pol') {
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

            const { isSimilar, rejectionReason, usage: u1 } = await this._compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log, telemetryMeta, lang);
            tokenUsage.promptTokens  += u1.promptTokens;
            tokenUsage.outputTokens  += u1.outputTokens;
            tokenUsage.thoughtTokens += u1.thoughtTokens;

            if (!isSimilar) {
                return { bossName: null, score: null, isValidVictory: false, error: 'NOT_SIMILAR', rejectionReason, tokenUsage };
            }

            const extractRes = await this._extractData(uploadedBase64, mediaType, telemetryMeta);
            tokenUsage.promptTokens  += extractRes.promptTokens;
            tokenUsage.outputTokens  += extractRes.outputTokens;
            tokenUsage.thoughtTokens += extractRes.thoughtTokens;

            const result = this.parseAIResponse(extractRes.text, log);

            return { ...result, tokenUsage };

        } catch (error) {
            log.error(`[AI Test] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    async _compareWithTemplate(wzorBase64, uploadedBase64, mediaType, log = logger, telemetryMeta, lang = 'pol') {
        const isEng = lang === 'eng';
        const reasonLang = isEng ? 'English' : 'Polish';
        const exampleReasons = isEng
            ? [
                'NOK: No boss results screen, main menu visible',
                'NOK: Panel has a close button (X)',
                'NOK: No yellow button below the panel',
              ]
            : [
                'NOK: Brak ekranu wyników bossa, widoczny ekran menu głównego',
                'NOK: Panel posiada ikonę zamknięcia (X)',
                'NOK: Brak żółtego przycisku pod panelem',
              ];
        const prompt = `Masz wzorzec ekranu referencyjnego. Sprawdź czy drugie zdjęcie
pasuje DO TEGO WZORCA.

KROK 0 — Przed porównaniem:
Przetłumacz mentalnie wszystkie napisy na obydwu zdjęciach
na język angielski. Dopiero na przetłumaczonej wersji wykonaj
poniższe sprawdzenie.

WZORZEC (pierwsze zdjęcie) ma DOKŁADNIE:
- pełnoekranowe tło z gameplayem
- centralny panel BEZ ikony X ani przycisku zamknięcia
- kolorowy baner na górze panelu (zaokrąglony, podobny do wstęgi)
- pod banerem: nazwa własna Bossa
- w centrum panelu: JEDNA duża ikona z liczbą
- poniżej: dwie linie statystyk (Best / Total)
- na dole panelu: rząd małych okrągłych lub sześciokątnych szarych ikon
- pod panelem: jeden żółty przycisk

Format odpowiedzi:
- Jeśli drugie zdjęcie pasuje do wzorca → odpowiedz TYLKO: OK
- Jeśli cokolwiek się różni strukturalnie → odpowiedz TYLKO: NOK: <short reason in ${reasonLang}, max 15 words>

Przykłady prawidłowych odpowiedzi:
OK
${exampleReasons.join('\n')}

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
        log.info(`[AI Test] Test wzorca: "${response}"`);
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
            const extractRes = await this._extractData(uploadedBase64, mediaType, telemetryMeta);
            tokenUsage.promptTokens  += extractRes.promptTokens;
            tokenUsage.outputTokens  += extractRes.outputTokens;
            tokenUsage.thoughtTokens += extractRes.thoughtTokens;

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
