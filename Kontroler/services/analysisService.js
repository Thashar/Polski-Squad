const { isSimilarNick } = require('../utils/helpers');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

class AnalysisService {
    constructor(config, aiOcrService) {
        this.config = config;
        this.aiOcrService = aiOcrService;
    }

    /**
     * Normalizuje nick do porównań (lowercase, tylko litery/cyfry, zachowuje polskie znaki).
     * @param {string} value
     * @returns {string}
     */
    normalizeNick(value) {
        return (value || '').toLowerCase()
            .replace(/[^a-z0-9ąćęłńóśźż]/g, '');
    }

    /**
     * Waliduje liczbowy wynik na podstawie konfiguracji kanału.
     * @param {number} score - Surowy wynik odczytany przez AI
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {{inRange: boolean, score: number|null, rounded: boolean, originalScore: number|null}}
     */
    validateScore(score, channelConfig) {
        const [minRange, maxRange] = channelConfig.scoreRange;
        const step = channelConfig.scoreStep;

        if (score < minRange || score > maxRange) {
            logger.info(`Wynik ${score} poza zakresem [${minRange}, ${maxRange}]`);
            return { inRange: false, score: null, rounded: false, originalScore: null };
        }

        if (score % step === 0) {
            logger.info(`Prawidłowy wynik: ${score}`);
            return { inRange: true, score, rounded: false, originalScore: null };
        }

        const roundedScore = Math.round(score / step) * step;
        logger.info(`Zaokrąglam ${score} do ${roundedScore} (krok ${step})`);
        return { inRange: true, score: roundedScore, rounded: true, originalScore: score };
    }

    /**
     * Znajduje gracza pasującego do nicku na serwerze wśród wyników z AI OCR.
     * Najpierw dokładne dopasowanie, potem podobieństwo (dwa progi).
     * @param {Array<{playerName: string, score: number}>} players
     * @param {string} displayName
     * @returns {{player: Object, matchType: string}|null}
     */
    findMatchingPlayer(players, displayName) {
        const target = this.normalizeNick(displayName);

        // FAZA 1: dokładne dopasowanie (nick zawiera się w odczytanym lub odwrotnie)
        logger.info('FAZA 1: Szukam dokładnego dopasowania nicku...');
        for (const player of players) {
            const candidate = this.normalizeNick(player.playerName);
            if (candidate.length === 0) continue;
            if (candidate === target || candidate.includes(target) || target.includes(candidate)) {
                logger.info(`Znaleziono nick (dokładne dopasowanie): "${player.playerName}" - ${player.score}`);
                return { player, matchType: 'exact' };
            }
        }

        // FAZA 2: podobieństwo (próg główny → próg niższy)
        logger.info('FAZA 2: Szukam podobieństwa nicku...');
        for (const threshold of [this.config.similarity.threshold, this.config.similarity.lowThreshold]) {
            const matchType = threshold === this.config.similarity.threshold ? 'similarity' : 'similarity_low';
            for (const player of players) {
                if (isSimilarNick(displayName, player.playerName, threshold)) {
                    logger.info(`Znaleziono podobny nick (${(threshold * 100).toFixed(0)}%): "${player.playerName}" - ${player.score}`);
                    return { player, matchType };
                }
            }
        }

        return null;
    }

    /**
     * Analizuje obraz w poszukiwaniu nicku i wyniku (przez AI OCR).
     * @param {string} imagePath - Ścieżka do obrazu
     * @param {string} displayName - Nick na serwerze
     * @param {string} username - Nazwa użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     * @returns {Promise<Object>} - Wynik analizy
     */
    async analyzeImage(imagePath, displayName, username, channelConfig) {
        logger.info(`Rozpoczynam analizę AI OCR dla nicku: "${displayName}" (użytkownik: ${username})`);
        logger.info(`Konfiguracja: min=${channelConfig.minimumScore}, zakres=${channelConfig.scoreRange}, krok=${channelConfig.scoreStep}`);

        const ocrResult = await this.aiOcrService.analyzeResultsImage(imagePath);

        if (!ocrResult.isValid || ocrResult.players.length === 0) {
            logger.info('AI OCR nie odczytał żadnych wyników graczy');
            return {
                found: false,
                score: null,
                isValid: false,
                displayName,
                error: 'Nie udało się odczytać wyników graczy ze zdjęcia'
            };
        }

        logger.info(`AI OCR odczytał ${ocrResult.players.length} graczy - szukam nicku "${displayName}"`);

        const match = this.findMatchingPlayer(ocrResult.players, displayName);

        if (!match) {
            logger.info(`Nick "${displayName}" nie został znaleziony wśród odczytanych graczy`);
            return {
                found: false,
                score: null,
                isValid: false,
                displayName,
                error: 'Nick nie został znaleziony w wynikach na zdjęciu'
            };
        }

        const validation = this.validateScore(match.player.score, channelConfig);

        if (!validation.inRange) {
            return {
                found: true,
                score: null,
                isValid: false,
                displayName,
                matchType: match.matchType,
                error: 'Brak prawidłowego wyniku przy nicku'
            };
        }

        logger.info(`Znaleziono prawidłowy wynik: ${validation.score} dla "${match.player.playerName}"`);
        return {
            found: true,
            score: validation.score,
            isValid: validation.score >= channelConfig.minimumScore,
            displayName,
            matchType: match.matchType,
            rounded: validation.rounded,
            originalScore: validation.originalScore
        };
    }
}

module.exports = AnalysisService;
