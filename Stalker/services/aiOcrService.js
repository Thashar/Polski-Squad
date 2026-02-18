const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');

/**
 * AI OCR Service - Analiza zdjęć z wynikami graczy przez Anthropic API
 * Używa Claude Vision do odczytu nicków i wyników z ekranu Survivor.io
 */
class AIOCRService {
    constructor(config) {
        this.config = config;

        // Anthropic API
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey && config.ocr.useAI === true;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.STALKER_LME_AI_OCR_MODEL || 'claude-3-haiku-20240307';
            logger.success(`✅ AI OCR aktywny - model: ${this.model}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak ANTHROPIC_API_KEY');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_STALKER_AI_OCR=false');
        }
    }

    /**
     * Analizuje zdjęcie z wynikami graczy przez Claude Vision
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}>}
     */
    async analyzeResultsImage(imagePath) {
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

            logger.info(`[AI OCR] Wysyłam zapytanie do Claude Vision...`);

            const extractPrompt = `Przeanalizuj zdjęcie z wynikami poszczególnych graczy oraz zwróć kompletne nicki oraz wyniki w następującym formacie:
<nick nr 1> - <wynik>
<nick nr 2> - <wynik> itd.`;

            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: 2000,
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

            const response = message.content[0].text;
            logger.info(`[AI OCR] Odpowiedź Claude:`);
            logger.info(response);

            // Parsuj odpowiedź AI
            const result = this.parseAIResponse(response);
            logger.info(`[AI OCR] Wynik parsowania: ${result.players.length} graczy`);

            return result;

        } catch (error) {
            logger.error(`[AI OCR] Błąd analizy obrazu:`, error);
            throw error;
        }
    }

    /**
     * Parsuje odpowiedź Claude i wyciąga listę graczy z wynikami
     * @param {string} responseText - Odpowiedź AI
     * @returns {{players: Array<{playerName: string, score: number}>, confidence: number, isValid: boolean, error?: string}}
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
            'nie znalazłem',
            'nie można odczytać',
            'brak wyników',
            'brak graczy'
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

        // Parsuj linie z wynikami (format: "nick - wynik")
        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const players = [];

        for (const line of lines) {
            // Szukaj wzorca: nick - wynik (może być z przecinkami, spacjami itp.)
            const match = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);

            if (match) {
                let playerName = match[1].trim();
                let scoreStr = match[2].trim();

                // Usuń prefiks "nick nr X:" jeśli występuje
                playerName = playerName.replace(/^nick\s+nr\s+\d+[:\s]*/i, '');
                playerName = playerName.replace(/^\d+[\.\)]\s*/, ''); // Usuń numerację (1. , 2) , 3.)

                // Parsuj wynik - usuń spacje, przecinki, kropki
                scoreStr = scoreStr.replace(/[\s,._]/g, '');
                const scoreMatch = scoreStr.match(/\d+/);

                if (scoreMatch && playerName.length > 0) {
                    const score = parseInt(scoreMatch[0]);

                    // Walidacja wyniku (rozsądne wartości dla Survivor.io)
                    if (score >= 0 && score <= 10000) {
                        players.push({
                            playerName: playerName,
                            score: score
                        });
                        logger.info(`[AI OCR] Sparsowano gracza: "${playerName}" - ${score}`);
                    }
                }
            }
        }

        // Walidacja
        const isValid = players.length > 0;

        if (!isValid) {
            logger.warn(`[AI OCR] Nie znaleziono żadnych graczy w odpowiedzi AI`);
        }

        // Oblicz confidence (prosta heurystyka)
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
}

module.exports = AIOCRService;
