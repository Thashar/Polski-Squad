const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

/**
 * AI OCR Service - Analiza zdjęć rekrutacyjnych przez Anthropic API
 * Używa Claude Vision do odczytu nicku i ataku z ekranu Survivor.io
 */
class AIOCRService {
    constructor(config) {
        this.config = config;

        // Anthropic API
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey && config.ocr.useAI === true;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307';
            logger.success(`✅ AI OCR aktywny - model: ${this.model}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak ANTHROPIC_API_KEY');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_AI_OCR=false');
        }
    }

    /**
     * Analizuje zdjęcie rekrutacyjne przez Claude Vision
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{playerNick: string|null, characterAttack: number|null, confidence: number, isValidEquipment: boolean, error?: string}>}
     */
    async analyzeRecruitmentImage(imagePath) {
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

            // === KROK 1: Sprawdź czy jest "My Equipment" ===
            logger.info(`[AI OCR] KROK 1: Sprawdzam obecność "My Equipment"...`);

            const checkPrompt = `Znajdź na screenie napis "My Equipment", jeżeli znajdziesz napisz "Znalezniono", jeżeli nie znajdziesz napisz "Brak frazy".`;

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

            // Sprawdź czy znaleziono "My Equipment"
            const foundEquipment = checkResponse.toLowerCase().includes('znalezniono');

            if (!foundEquipment) {
                logger.warn(`[AI OCR] KROK 1 - Nie znaleziono "My Equipment", przerywam analizę`);
                return {
                    playerNick: null,
                    characterAttack: null,
                    confidence: 0,
                    isValidEquipment: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }

            logger.info(`[AI OCR] KROK 1 - "My Equipment" znaleznione, przechodzę do KROKU 2`);

            // === KROK 2: Wyciągnij nick i atak ===
            logger.info(`[AI OCR] KROK 2: Wyciągam nick i atak...`);

            const extractPrompt = `Na zdjęciu powinien być ekran z gry Survivor.io na którym przedstawiona jest postać z ekwipunkiem. Po lewej stronie na górze, nad zieloną linią progresu na szarym tle znajduje się nick postaci napisany białą czcionką, natomiast po prawej od ikonki mieczyka z napisem ATK znajduje się atak postaci. Po lewej od nicku jest awatar gracza, nie halucynuj żadnych znaków w tym miejscu. 

Twoim zadaniem jest znaleźć kompletny nick postaci łącznie z prefixem jeżeli występuje oraz jej wartość ataku. Przedstaw dane w formacie:
<nick postaci>
<atak>`;

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
     * Parsuje odpowiedź Claude i wyciąga nick + atak
     * @param {string} responseText - Odpowiedź AI
     * @returns {{playerNick: string|null, characterAttack: number|null, confidence: number, isValidEquipment: boolean, error?: string}}
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
            'brak ekwipunku',
            'nie znalazłem',
            'nie można odczytać'
        ];

        for (const keyword of invalidKeywords) {
            if (lowerResponse.includes(keyword)) {
                logger.info(`[AI OCR] AI wykrył niepoprawny screen (keyword: "${keyword}")`);
                return {
                    playerNick: null,
                    characterAttack: null,
                    confidence: 0,
                    isValidEquipment: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }
        }

        // Wyciągnij nick - pierwsza niepusta linia
        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            logger.warn(`[AI OCR] AI zwrócił za mało linii (${lines.length})`);
            return {
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                isValidEquipment: false,
                error: 'PARSING_ERROR'
            };
        }

        // Pierwsza linia = nick (usuń potencjalne prefix "Nick:" lub podobne)
        let playerNick = lines[0]
            .replace(/^nick[:\s]*/i, '')
            .replace(/^postać[:\s]*/i, '')
            .replace(/^gracz[:\s]*/i, '')
            .trim();

        // Druga linia = atak (usuń potencjalne prefix "Atak:" lub podobne, oraz spacje i separatory)
        let attackStr = lines[1]
            .replace(/^atak[:\s]*/i, '')
            .replace(/^atk[:\s]*/i, '')
            .replace(/[\s,._]/g, '') // Usuń spacje, przecinki, kropki, podkreślniki
            .trim();

        // Parsuj atak
        let characterAttack = null;
        const attackMatch = attackStr.match(/\d+/);
        if (attackMatch) {
            characterAttack = parseInt(attackMatch[0]);
        }

        // Walidacja
        const isValid = playerNick && characterAttack && characterAttack >= 100 && characterAttack <= 10000000;

        if (!isValid) {
            logger.warn(`[AI OCR] Walidacja nie powiodła się - nick: "${playerNick}", atak: ${characterAttack}`);
        }

        // Oblicz confidence (prosta heurystyka)
        let confidence = 0;
        if (playerNick) {
            confidence += 50;
            if (playerNick.length >= 4) confidence += 10;
        }
        if (characterAttack && characterAttack >= 100 && characterAttack <= 10000000) {
            confidence += 40;
        }

        return {
            playerNick: isValid ? playerNick : null,
            characterAttack: isValid ? characterAttack : null,
            confidence: Math.min(confidence, 100),
            isValidEquipment: isValid,
            error: isValid ? undefined : 'VALIDATION_FAILED'
        };
    }
}

module.exports = AIOCRService;
