const path = require('path');
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
    'extract-results':       'v1',
    'extract-results-batch': 'v1',
    'extract-nicks-batch':   'v1',
    'extract-equipment':     'v1',
};

const logger = createBotLogger('Stalker');

/**
 * AI OCR Service - Analiza zdjęć z wynikami graczy przez Google Gemini API
 * Używa Gemini Vision do odczytu nicków i wyników z ekranu Survivor.io
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
        this.enabled = !!apiKey && config.ocr.useAI === true && !!llmAdapter;
        this.modelName = config.ocr.googleAiModel || 'gemini-2.5-flash-lite';

        if (this.enabled) {
            logger.success(`✅ AI OCR aktywny (Google Gemini) - model: ${this.modelName}`);
        } else if (!apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak STALKER_GOOGLE_AI_API_KEY');
        } else if (!llmAdapter) {
            logger.warn('⚠️ AI OCR wyłączony - brak llmAdapter (DI) w konstruktorze');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_STALKER_AI_OCR=false');
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
     * Analizuje zdjęcie z wynikami graczy przez Gemini Vision
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}>}
     */
    async analyzeResultsImage(imagePath) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony');
        }

        try {
            logger.info(`[AI OCR] Rozpoczynam analizę obrazu: ${imagePath}`);

            const pngBuffer = await sharp(imagePath).png().toBuffer();
            const base64Image = pngBuffer.toString('base64');
            const mediaType = 'image/png';

            logger.info('[AI OCR] Wysyłam zapytanie do Gemini Vision...');

            const prompt = `Przeanalizuj zdjęcie z wynikami poszczególnych graczy oraz zwróć kompletne nicki oraz wyniki w następującym formacie:
<nick nr 1> - <wynik>
<nick nr 2> - <wynik> itd.
Jeśli nie możesz odczytać wyników lub zdjęcie nie zawiera wyników graczy, odpowiedz: "Nie wykryto wyników graczy".`;

            const res = await this._generateContent([
                { inlineData: { data: base64Image, mimeType: mediaType } },
                { text: prompt }
            ], 2000, {
                step:          'extract-results',
                promptName:    'extract-results',
                promptVersion: PROMPT_VERSIONS['extract-results'],
            });

            logger.info(`[AI OCR] Odpowiedź Gemini:`);
            logger.info(res.text);

            const result = this.parseAIResponse(res.text);
            logger.info(`[AI OCR] Wynik parsowania: ${result.players.length} graczy`);

            return result;

        } catch (error) {
            logger.error(`[AI OCR] Błąd analizy obrazu:`, error);
            throw error;
        }
    }

    /**
     * Analizuje WSZYSTKIE zdjęcia naraz w jednym zapytaniu do Gemini Vision (batch).
     * Dodatkowo otrzymuje listę nicków z roli klanowej Discord i prosi AI o dopasowanie
     * odczytanych nicków ze screenów do najbliższego nicku Discord.
     * @param {string[]} imagePaths - Ścieżki do obrazów
     * @param {string[]} clanNicks - Lista nicków członków roli klanowej z Discorda
     * @param {{anyScore?: boolean}} [options] - anyScore (RemindCX): bez górnej granicy wyniku, liczy się tylko nick
     * @returns {Promise<{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}>}
     */
    async analyzeResultsImagesBatch(imagePaths, clanNicks = [], options = {}) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony');
        }

        try {
            logger.info(`[AI OCR - Batch] Rozpoczynam analizę ${imagePaths.length} zdjęć naraz (nicki klanu: ${clanNicks.length})`);

            // Zbuduj części zapytania: najpierw wszystkie obrazy, potem prompt tekstowy
            const parts = [];
            for (const imagePath of imagePaths) {
                const pngBuffer = await sharp(imagePath).png().toBuffer();
                parts.push({ inlineData: { data: pngBuffer.toString('base64'), mimeType: 'image/png' } });
            }

            const nickListText = clanNicks.length > 0
                ? clanNicks.map((n, i) => `${i + 1}. ${n}`).join('\n')
                : '(brak listy)';

            const prompt = `Przeanalizuj ${imagePaths.length} zdjęć z wynikami graczy z gry Survivor.io.
Zdjęcia mogą się nakładać - ten sam gracz może pojawić się na kilku zdjęciach. Połącz wszystkie zdjęcia w jedną wspólną listę i usuń duplikaty (każdy gracz tylko raz, z jego wynikiem).

Poniżej lista nicków graczy z roli klanowej na Discordzie:
${nickListText}

Dla każdego gracza odczytanego ze zdjęć dopasuj jego nick do NAJBARDZIEJ PODOBNEGO nicku z powyższej listy Discord. Nicki w grze mogą się nieznacznie różnić od nicków Discord (literówki, dodatkowe ozdobniki, inne znaki specjalne, emoji) - wybierz najbardziej prawdopodobne dopasowanie. W wyniku użyj DOKŁADNIE nicku z listy Discord.
Jeśli żaden nick z listy nie pasuje, użyj nicku odczytanego bezpośrednio ze zdjęcia.

Zwróć wynik w następującym formacie (jeden gracz na linię):
<nick na discordzie> - <wynik>

Jeśli nie możesz odczytać wyników lub zdjęcia nie zawierają wyników graczy, odpowiedz: "Nie wykryto wyników graczy".`;

            parts.push({ text: prompt });

            logger.info('[AI OCR - Batch] Wysyłam zapytanie zbiorcze do Gemini Vision...');

            const res = await this._generateContent(parts, 4000, {
                step:          'extract-results-batch',
                promptName:    'extract-results-batch',
                promptVersion: PROMPT_VERSIONS['extract-results-batch'],
            });

            logger.info('[AI OCR - Batch] Odpowiedź Gemini:');
            logger.info(res.text);

            const result = this.parseAIResponse(res.text, options);
            logger.info(`[AI OCR - Batch] Wynik parsowania: ${result.players.length} graczy`);

            return result;

        } catch (error) {
            logger.error('[AI OCR - Batch] Błąd analizy zbiorczej:', error);
            throw error;
        }
    }

    /**
     * Analiza batch dla RemindCX: wyciąga ze zdjęć SAME NICKI graczy (bez wyników).
     * Screeny bossa CX nie zawierają wyników w formacie zwykłych rankingów, dlatego
     * osobny prompt (tylko nicki) i osobny parser bez walidacji wyników.
     * @param {string[]} imagePaths - Ścieżki do obrazów
     * @param {string[]} clanNicks - Lista nicków członków roli klanowej z Discorda
     * @returns {Promise<{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}>}
     */
    async analyzeNicksImagesBatch(imagePaths, clanNicks = []) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony');
        }

        try {
            logger.info(`[AI OCR - Nicks] Rozpoczynam analizę ${imagePaths.length} zdjęć naraz (nicki klanu: ${clanNicks.length})`);

            const parts = [];
            for (const imagePath of imagePaths) {
                const pngBuffer = await sharp(imagePath).png().toBuffer();
                parts.push({ inlineData: { data: pngBuffer.toString('base64'), mimeType: 'image/png' } });
            }

            const nickListText = clanNicks.length > 0
                ? clanNicks.map((n, i) => `${i + 1}. ${n}`).join('\n')
                : '(brak listy)';

            const prompt = `Przeanalizuj ${imagePaths.length} zdjęć z gry Survivor.io zawierających listę graczy (np. lista uczestników walki z bossem).
Zdjęcia mogą się nakładać - ten sam gracz może pojawić się na kilku zdjęciach. Połącz wszystkie zdjęcia w jedną wspólną listę i usuń duplikaty (każdy gracz tylko raz).

Poniżej lista nicków graczy z roli klanowej na Discordzie:
${nickListText}

Dla każdego gracza odczytanego ze zdjęć dopasuj jego nick do NAJBARDZIEJ PODOBNEGO nicku z powyższej listy Discord. Nicki w grze mogą się nieznacznie różnić od nicków Discord (literówki, dodatkowe ozdobniki, inne znaki specjalne, emoji) - wybierz najbardziej prawdopodobne dopasowanie. W wyniku użyj DOKŁADNIE nicku z listy Discord.
Jeśli żaden nick z listy nie pasuje, użyj nicku odczytanego bezpośrednio ze zdjęcia.

Zwróć TYLKO nicki, jeden nick na linię, bez numeracji, bez wyników i bez żadnego dodatkowego tekstu.

Jeśli zdjęcia nie zawierają listy graczy, odpowiedz: "Nie wykryto graczy".`;

            parts.push({ text: prompt });

            logger.info('[AI OCR - Nicks] Wysyłam zapytanie zbiorcze do Gemini Vision...');

            const res = await this._generateContent(parts, 4000, {
                step:          'extract-nicks-batch',
                promptName:    'extract-nicks-batch',
                promptVersion: PROMPT_VERSIONS['extract-nicks-batch'],
            });

            logger.info('[AI OCR - Nicks] Odpowiedź Gemini:');
            logger.info(res.text);

            const result = this.parseAINickResponse(res.text);
            logger.info(`[AI OCR - Nicks] Wynik parsowania: ${result.players.length} graczy`);

            return result;

        } catch (error) {
            logger.error('[AI OCR - Nicks] Błąd analizy zbiorczej nicków:', error);
            throw error;
        }
    }

    /**
     * Parsuje odpowiedź AI zawierającą SAME NICKI (jeden na linię, bez wyników).
     * Toleruje numerację, markdown i doklejone wyniki (obcina " - 123456" z końca linii).
     * @param {string} responseText
     * @returns {{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}}
     */
    parseAINickResponse(responseText) {
        const lowerResponse = responseText.toLowerCase();

        const invalidKeywords = [
            'niepoprawny screen',
            'przesłano niepoprawny',
            'trzeba przesłać screen',
            'nie wykryłem',
            'nie wykryto',
            'nie znalazłem',
            'nie można odczytać',
            'nie mogę odczytać',
            'brak graczy',
            'cannot read',
            'unable to read',
            'no players'
        ];

        for (const keyword of invalidKeywords) {
            if (lowerResponse.includes(keyword)) {
                logger.info(`[AI OCR - Nicks] AI wykrył niepoprawny screen (keyword: "${keyword}")`);
                return {
                    players: [],
                    confidence: 0,
                    isValid: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }
        }

        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const players = [];
        const seen = new Set();

        for (const line of lines) {
            let playerName = line;

            // Usuń markdown (pogrubienia) PRZED punktorami, żeby "**Nick**" nie zostawiało gwiazdki
            playerName = playerName.replace(/\*\*/g, '');
            // Usuń numerację, prefiksy i punktory
            playerName = playerName.replace(/^nick\s+nr\s+\d+[:\s]*/i, '');
            playerName = playerName.replace(/^\d+[\.\)]\s*/, '');
            playerName = playerName.replace(/^[\*\-•]\s*/, '');
            // Usuń doklejony wynik z końca linii (gdyby AI mimo wszystko go dodał)
            playerName = playerName.replace(/\s*[-–—]\s*[\d\s,._]+$/, '').trim();

            if (playerName.length > 0 && !seen.has(playerName)) {
                seen.add(playerName);
                players.push({ playerName, score: 0 });
                logger.info(`[AI OCR - Nicks] Sparsowano nick: "${playerName}"`);
            }
        }

        return {
            players,
            confidence: players.length > 0 ? Math.min(50 + (players.length * 10), 100) : 0,
            isValid: players.length > 0,
            error: players.length === 0 ? 'NO_PLAYERS_FOUND' : undefined
        };
    }

    /**
     * Parsuje odpowiedź AI i wyciąga listę graczy z wynikami
     * @param {string} responseText
     * @param {{anyScore?: boolean}} [options] - anyScore (RemindCX): bez górnej granicy wyniku, liczy się tylko nick
     * @returns {{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}}
     */
    parseAIResponse(responseText, options = {}) {
        const lowerResponse = responseText.toLowerCase();

        const invalidKeywords = [
            'niepoprawny screen',
            'przesłano niepoprawny',
            'trzeba przesłać screen',
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
                return {
                    players: [],
                    confidence: 0,
                    isValid: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }
        }

        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const players = [];

        for (const line of lines) {
            const match = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);

            if (match) {
                let playerName = match[1].trim();
                let scoreStr = match[2].trim();

                playerName = playerName.replace(/^nick\s+nr\s+\d+[:\s]*/i, '');
                playerName = playerName.replace(/^\d+[\.\)]\s*/, '');

                scoreStr = scoreStr.replace(/[\s,._]/g, '');
                const scoreMatch = scoreStr.match(/\d+/);

                if (scoreMatch && playerName.length > 0) {
                    const score = parseInt(scoreMatch[0]);

                    // anyScore (RemindCX): obrażenia na bossie CX przekraczają 999999 - liczy się tylko nick
                    if (score >= 0 && (options.anyScore || score <= 999999)) {
                        players.push({
                            playerName: playerName,
                            score: score
                        });
                        logger.info(`[AI OCR] Sparsowano gracza: "${playerName}" - ${score}`);
                    }
                }
            }
        }

        const isValid = players.length > 0;

        if (!isValid) {
            logger.warn('[AI OCR] Nie znaleziono żadnych graczy w odpowiedzi AI');
        }

        let confidence = 0;
        if (players.length > 0) {
            confidence = Math.min(50 + (players.length * 10), 100);
        }

        return {
            players: players,
            confidence: confidence,
            isValid: isValid,
            error: isValid ? undefined : 'NO_PLAYERS_FOUND'
        };
    }

    /**
     * Analizuje zdjęcie z Core Stock (ekwipunek gracza)
     * @param {Buffer} imageBuffer - Bufor obrazu
     * @returns {Promise<{items: Object, isValid: boolean, error?: string}>}
     */
    async analyzeEquipmentImage(imageBuffer) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony - brak STALKER_GOOGLE_AI_API_KEY lub USE_STALKER_AI_OCR=false');
        }

        try {
            logger.info('[AI OCR - Equipment] Rozpoczynam analizę ekwipunku...');

            const pngBuffer = await sharp(imageBuffer).png().toBuffer();
            const base64Image = pngBuffer.toString('base64');

            const prompt = `Analyze this Survivor.io screenshot showing the "Core Stock" inventory section.
Extract all items visible in the list. For each item, return its name and the first number before the slash (the "All" total quantity, NOT the "Available" quantity after the slash).
Return ONLY a JSON object mapping item names to their total quantities, like this example:
{"Transmute Core": 29, "Xeno Pet Core": 75, "Mount Core": 7, "Relic Core": 155, "Resonance Chip": 68, "Survivor Awakening Core": 131}
If this is not a Core Stock screenshot, return: {"error": "not_core_stock"}`;

            const res = await this._generateContent([
                { inlineData: { data: base64Image, mimeType: 'image/png' } },
                { text: prompt }
            ], 500, {
                step:          'extract-equipment',
                promptName:    'extract-equipment',
                promptVersion: PROMPT_VERSIONS['extract-equipment'],
            }, 10);

            const responseText = res.text.trim();
            logger.info(`[AI OCR - Equipment] Odpowiedź: ${responseText}`);

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { items: {}, isValid: false, error: 'NO_JSON_IN_RESPONSE' };
            }

            const parsed = JSON.parse(jsonMatch[0]);

            if (parsed.error === 'not_core_stock') {
                return { items: {}, isValid: false, error: 'NOT_CORE_STOCK' };
            }

            const items = {};
            for (const [name, qty] of Object.entries(parsed)) {
                const num = Number(qty);
                if (typeof name === 'string' && name.length > 0 && !isNaN(num) && num >= 0) {
                    items[name] = num;
                }
            }

            if (Object.keys(items).length === 0) {
                return { items: {}, isValid: false, error: 'NO_ITEMS_FOUND' };
            }

            const ALLOWED_ITEMS = new Set([
                'Transmute Core', 'Xeno Pet Core', 'Mount Core',
                'Relic Core', 'Resonance Chip', 'Survivor Awakening Core'
            ]);
            const invalidKeys = Object.keys(items).filter(k => !ALLOWED_ITEMS.has(k));
            if (invalidKeys.length > 0) {
                logger.warn(`[AI OCR - Equipment] Nieznane przedmioty: ${invalidKeys.join(', ')}`);
                return { items: {}, isValid: false, error: 'INVALID_ITEMS' };
            }

            logger.info(`[AI OCR - Equipment] Odczytano ${Object.keys(items).length} przedmiotów`);
            return { items, isValid: true };

        } catch (error) {
            logger.error('[AI OCR - Equipment] Błąd analizy:', error);
            throw error;
        }
    }
}

module.exports = AIOCRService;
