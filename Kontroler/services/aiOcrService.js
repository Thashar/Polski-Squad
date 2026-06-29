const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const SAFETY_SETTINGS_OFF = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const PROMPT_VERSIONS = {
    'extract-results': 'v1',
};

const logger = createBotLogger('Kontroler');

/**
 * AI OCR Service - odczyt rankingu graczy (nick + wynik) ze zdjęcia przez Google Gemini Vision.
 * Jedyny silnik OCR Kontrolera - bez fallbacku na Tesseract.
 */
class AIOCRService {
    /**
     * @param {Object} config
     * @param {{ generate: Function }} llmAdapter — wspólny wrapper z utils/llmAdapter.js
     */
    constructor(config, llmAdapter) {
        this.config = config;
        this.adapter = llmAdapter;

        const apiKey = config.ocr.googleAiApiKey;
        this.enabled = !!apiKey && !!llmAdapter;
        this.modelName = config.ocr.googleAiModel || 'gemini-2.5-flash-lite';

        if (this.enabled) {
            logger.success(`✅ AI OCR aktywny (Google Gemini) - model: ${this.modelName}`);
        } else if (!apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak KONTROLER_GOOGLE_AI_API_KEY (OCR nie zadziała!)');
        } else {
            logger.warn('⚠️ AI OCR wyłączony - brak llmAdapter (DI) w konstruktorze');
        }
    }

    /**
     * Wywołanie Gemini przez wspólny adapter z retry.
     * Błędy 503 (przeciążone API) retry do 10x niezależnie od parametru `retries`.
     * Po 10 nieudanych próbach 503 rzuca błąd z flagą `isAPIOverloaded = true`.
     */
    async _generateContent(parts, maxOutputTokens, meta = {}, retries = 3) {
        let lastError;
        let regularAttempts = 0;
        let overloadedAttempts = 0;
        const MAX_OVERLOADED = 10;

        while (true) {
            try {
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
                };
            } catch (err) {
                lastError = err;
                const status = err.status ?? err.statusCode ?? err.code;
                const msgStr = typeof err.message === 'string' ? err.message : '';
                const isOverloaded = status === 503 || msgStr.includes('503') || msgStr.includes('Service Unavailable') || msgStr.includes('high demand');

                if (isOverloaded) {
                    overloadedAttempts++;
                    if (overloadedAttempts >= MAX_OVERLOADED) {
                        const overloadedError = new Error('API Gemini jest przeciążone. Spróbuj ponownie za kilka minut.');
                        overloadedError.isAPIOverloaded = true;
                        throw overloadedError;
                    }
                    const delay = Math.min(5000, 1000 * Math.pow(2, Math.min(overloadedAttempts - 1, 5)));
                    logger.warn(`[AI OCR] Gemini 503 przeciążone, próba ${overloadedAttempts}/${MAX_OVERLOADED} za ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                const isRetryable = status === 429 || status === 500 || status === 'ECONNRESET' || status === 'ETIMEDOUT';
                if (!isRetryable || regularAttempts >= retries - 1) throw err;
                regularAttempts++;
                const delay = Math.min(5000, 1000 * Math.pow(2, regularAttempts - 1));
                logger.warn(`[AI OCR] Gemini error ${status ?? 'unknown'}, retry ${regularAttempts}/${retries - 1} za ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    /**
     * Analizuje zdjęcie z rankingiem graczy przez Gemini Vision.
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{players: Array<{playerName: string, score: number}>, isValid: boolean, error?: string}>}
     */
    async analyzeResultsImage(imagePath) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony - brak KONTROLER_GOOGLE_AI_API_KEY');
        }

        try {
            logger.info(`[AI OCR] Rozpoczynam analizę obrazu: ${imagePath}`);

            const pngBuffer = await sharp(imagePath).png().toBuffer();
            const base64Image = pngBuffer.toString('base64');

            logger.info('[AI OCR] Wysyłam zapytanie do Gemini Vision...');

            const prompt = `Przeanalizuj zdjęcie z rankingiem graczy z gry Survivor.io i zwróć dla każdego widocznego gracza jego kompletny nick oraz wynik (liczbę punktów obok nicku).
Wynik to liczba całkowita stojąca w tym samym wierszu co nick gracza (zignoruj rangę/pozycję na liście z lewej strony).
Zwróć wynik w formacie (jeden gracz na linię):
<nick> - <wynik>
Jeśli nie możesz odczytać żadnych wyników lub zdjęcie nie zawiera rankingu graczy, odpowiedz: "Nie wykryto wyników graczy".`;

            const res = await this._generateContent([
                { inlineData: { data: base64Image, mimeType: 'image/png' } },
                { text: prompt }
            ], 2000, {
                step:          'extract-results',
                operationType: 'ocr.analyze',
                promptName:    'extract-results',
                promptVersion: PROMPT_VERSIONS['extract-results'],
            });

            logger.info('[AI OCR] Odpowiedź Gemini:');
            logger.info(res.text);

            const result = this.parseAIResponse(res.text);
            logger.info(`[AI OCR] Wynik parsowania: ${result.players.length} graczy`);

            return result;
        } catch (error) {
            logger.error(`[AI OCR] Błąd analizy obrazu: ${error.message}`);
            throw error;
        }
    }

    /**
     * Parsuje odpowiedź AI i wyciąga listę graczy z wynikami.
     * @param {string} responseText
     * @returns {{players: Array<{playerName: string, score: number}>, isValid: boolean, error?: string}}
     */
    parseAIResponse(responseText) {
        const lowerResponse = (responseText || '').toLowerCase();

        const invalidKeywords = [
            'niepoprawny screen',
            'nie wykryłem',
            'nie wykryto',
            'nie znalazłem',
            'nie można odczytać',
            'nie mogę odczytać',
            'brak wyników',
            'brak graczy',
            'cannot read',
            'unable to read',
            'no results',
            'no players'
        ];

        for (const keyword of invalidKeywords) {
            if (lowerResponse.includes(keyword)) {
                logger.info(`[AI OCR] AI wykrył niepoprawny screen (keyword: "${keyword}")`);
                return { players: [], isValid: false, error: 'INVALID_SCREENSHOT' };
            }
        }

        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const players = [];

        for (const line of lines) {
            const match = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
            if (!match) continue;

            let playerName = match[1].trim();
            let scoreStr = match[2].trim();

            playerName = playerName.replace(/^nick\s+nr\s+\d+[:\s]*/i, '');
            playerName = playerName.replace(/^\d+[\.\)]\s*/, '');

            scoreStr = scoreStr.replace(/[\s,._]/g, '');
            const scoreMatch = scoreStr.match(/\d+/);

            if (scoreMatch && playerName.length > 0) {
                const score = parseInt(scoreMatch[0]);
                if (score >= 0 && score <= 999999) {
                    players.push({ playerName, score });
                    logger.info(`[AI OCR] Sparsowano gracza: "${playerName}" - ${score}`);
                }
            }
        }

        const isValid = players.length > 0;
        if (!isValid) {
            logger.warn('[AI OCR] Nie znaleziono żadnych graczy w odpowiedzi AI');
        }

        return {
            players,
            isValid,
            error: isValid ? undefined : 'NO_PLAYERS_FOUND'
        };
    }
}

module.exports = AIOCRService;
