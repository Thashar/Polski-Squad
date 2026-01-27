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

            // === KROK 2: Wyciągnij nazwę bossa i wynik ===
            logger.info(`[AI OCR] KROK 2: Wyciągam nazwę bossa i wynik...`);

            const extractPrompt = `Odczytaj zawartość zdjęcia. Poniżej napisu "Victory" znajduje się nazwa Bossa. Poniżej nazwy bossa znajduje się wynik. Odczytaj nazwę bossa oraz dokładny wynik wraz z jednostką i napisz go w następującym formacie:
<nazwa bossa>
<wynik>`;

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
            logger.info(`[AI OCR] KROK 2 - Odpowiedź Claude:`);
            logger.info(extractResponse);

            // Parsuj odpowiedź AI
            const result = this.parseAIResponse(extractResponse);
            logger.info(`[AI OCR] KROK 2 - Wynik parsowania:`, result);

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

        // Wyciągnij nazwę bossa i wynik - pierwsze dwie niepuste linie
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
            .trim();

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
}

module.exports = AIOCRService;
