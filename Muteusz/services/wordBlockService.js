const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class WordBlockService {
    constructor(config, logService) {
        this.config = config;
        this.logService = logService;
        this.dataFile = path.join(__dirname, '../data/word_blocks.json');
        this.wordBlocks = new Map();
        this.cleanupInterval = null;
    }

    /**
     * Inicjalizuje serwis
     */
    async initialize() {
        try {
            await this.loadWordBlocks();
            this.startCleanupInterval();
            logger.info('🚫 WordBlockService zainicjalizowany');
        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji WordBlockService: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ładuje zablokowane słowa z pliku
     */
    async loadWordBlocks() {
        try {
            // Sprawdź czy plik istnieje
            try {
                await fs.access(this.dataFile);
            } catch (error) {
                // Plik nie istnieje, stwórz pusty
                await this.ensureDataDirectory();
                await fs.writeFile(this.dataFile, JSON.stringify({}, null, 2));
                return;
            }

            const data = await fs.readFile(this.dataFile, 'utf8');
            const blocksData = JSON.parse(data);
            
            // Konwertuj na Map z datami i filtruj wygasłe
            this.wordBlocks.clear();
            let totalLoaded = 0;
            let expiredCount = 0;
            
            // Pobierz aktualny czas w strefie polskiej jako UTC
            const nowPolandUTC = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
            
            for (const [word, blockInfo] of Object.entries(blocksData)) {
                totalLoaded++;
                const endTime = new Date(blockInfo.endTime);
                
                if (endTime > nowPolandUTC) {
                    // Blokada aktywna - dodaj do mapy
                    this.wordBlocks.set(word.toLowerCase(), {
                        ...blockInfo,
                        endTime: endTime
                    });
                } else {
                    // Blokada wygasła - zlicz do statystyk
                    expiredCount++;
                }
            }

            // Jeśli były wygasłe blokady, zapisz oczyszczoną listę
            if (expiredCount > 0) {
                await this.saveWordBlocks();
                logger.info(`🧹 Usunięto ${expiredCount} wygasłych blokad słów podczas uruchamiania`);
            }

            logger.info(`📥 Załadowano ${this.wordBlocks.size} aktywnych blokad słów (łącznie przetworzono: ${totalLoaded})`);
        } catch (error) {
            logger.error(`❌ Błąd ładowania blokad słów: ${error.message}`);
            throw error;
        }
    }

    /**
     * Zapisuje blokady słów do pliku
     */
    async saveWordBlocks() {
        try {
            await this.ensureDataDirectory();
            
            // Konwertuj Map na obiekt z ISO stringami dla dat
            const blocksData = {};
            for (const [word, blockInfo] of this.wordBlocks.entries()) {
                blocksData[word] = {
                    ...blockInfo,
                    endTime: blockInfo.endTime.toISOString()
                };
            }

            await fs.writeFile(this.dataFile, JSON.stringify(blocksData, null, 2));
            logger.info(`💾 Zapisano ${this.wordBlocks.size} blokad słów`);
        } catch (error) {
            logger.error(`❌ Błąd zapisywania blokad słów: ${error.message}`);
            throw error;
        }
    }

    /**
     * Zapewnia istnienie katalogu data
     */
    async ensureDataDirectory() {
        const dataDir = path.dirname(this.dataFile);
        try {
            await fs.access(dataDir);
        } catch (error) {
            await fs.mkdir(dataDir, { recursive: true });
        }
    }

    /**
     * Dodaje nową blokadę słowa
     * @param {string} word - Słowo do zablokowania
     * @param {Date} endTime - Czas zakończenia blokady
     * @param {boolean} shouldTimeout - Czy nakładać timeout
     * @param {number} timeoutDurationMinutes - Czas timeout w minutach
     * @param {boolean} inside - Czy blokować słowo jako część innych słów
     * @param {string} moderatorId - ID moderatora
     * @returns {Object} - Wynik operacji
     */
    async addWordBlock(word, endTime, shouldTimeout, timeoutDurationMinutes, inside, moderatorId) {
        try {
            const wordKey = word.toLowerCase();
            
            // Sprawdź czy słowo już jest zablokowane i czy nie wygasło
            if (this.wordBlocks.has(wordKey)) {
                const existingBlock = this.wordBlocks.get(wordKey);
                const nowPolandUTC = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
                
                if (existingBlock.endTime <= nowPolandUTC) {
                    // Blokada wygasła - usuń ją i pozwól na dodanie nowej
                    this.wordBlocks.delete(wordKey);
                    await this.saveWordBlocks();
                    logger.info(`🧹 Usunięto wygasłą blokadę słowa "${word}"`);
                } else {
                    // Blokada wciąż aktywna
                    return {
                        success: false,
                        message: `Słowo "${word}" jest już zablokowane do ${existingBlock.endTime.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`
                    };
                }
            }

            // Dodaj nową blokadę
            const blockInfo = {
                originalWord: word,
                endTime: endTime,
                shouldTimeout: shouldTimeout,
                timeoutDurationMinutes: timeoutDurationMinutes,
                inside: inside,
                moderatorId: moderatorId,
                createdAt: new Date()
            };

            this.wordBlocks.set(wordKey, blockInfo);
            await this.saveWordBlocks();

            return {
                success: true,
                message: 'Blokada słowa została dodana pomyślnie',
                blockInfo: blockInfo
            };
        } catch (error) {
            logger.error(`❌ Błąd dodawania blokady słowa: ${error.message}`);
            return {
                success: false,
                message: `Błąd dodawania blokady słowa: ${error.message}`
            };
        }
    }

    /**
     * Usuwa blokadę słowa
     * @param {string} word - Słowo do odblokowania
     * @returns {Object} - Wynik operacji
     */
    async removeWordBlock(word) {
        try {
            const wordKey = word.toLowerCase();
            
            if (!this.wordBlocks.has(wordKey)) {
                return {
                    success: false,
                    message: 'Słowo nie jest zablokowane'
                };
            }

            const blockInfo = this.wordBlocks.get(wordKey);
            this.wordBlocks.delete(wordKey);
            await this.saveWordBlocks();

            return {
                success: true,
                message: 'Blokada słowa została usunięta',
                blockInfo: blockInfo
            };
        } catch (error) {
            logger.error(`❌ Błąd usuwania blokady słowa: ${error.message}`);
            return {
                success: false,
                message: `Błąd usuwania blokady słowa: ${error.message}`
            };
        }
    }

    /**
     * Sprawdza czy wiadomość zawiera zablokowane słowa
     * @param {string} messageContent - Treść wiadomości
     * @returns {Array} - Lista znalezionych zablokowanych słów
     */
    checkForBlockedWords(messageContent) {
        if (!messageContent || typeof messageContent !== 'string') {
            return [];
        }

        const foundBlocks = [];
        
        for (const [wordKey, blockInfo] of this.wordBlocks.entries()) {
            // Sprawdź czy blokada nie wygasła
            const nowPolandUTC = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
            if (blockInfo.endTime <= nowPolandUTC) {
                // Usuń wygasłą blokadę
                this.wordBlocks.delete(wordKey);
                this.saveWordBlocks().catch(error => {
                    logger.error(`❌ Błąd usuwania wygasłej blokady słowa: ${error.message}`);
                });
                continue;
            }

            // Usuń znaki przestankowe z wiadomości i słowa do porównania
            const cleanMessage = this.removePunctuation(messageContent.toLowerCase());
            const cleanWord = this.removePunctuation(wordKey);
            
            // Sprawdź czy słowo występuje w wiadomości
            let wordRegex;
            if (blockInfo.inside) {
                // Tryb inside: słowo może być częścią innych słów
                wordRegex = new RegExp(this.escapeRegex(cleanWord), 'i');
            } else {
                // Tryb standardowy: tylko całe słowa (z granicami słów)
                wordRegex = new RegExp(`\\b${this.escapeRegex(cleanWord)}\\b`, 'i');
            }
            
            if (wordRegex.test(cleanMessage)) {
                foundBlocks.push({
                    word: blockInfo.originalWord,
                    blockInfo: blockInfo
                });
            }
        }

        return foundBlocks;
    }

    /**
     * Usuwa znaki przestankowe i spacje z tekstu
     * @param {string} text - Tekst do oczyszczenia
     * @returns {string} - Oczyszczony tekst
     */
    removePunctuation(text) {
        // Usuń wszystkie znaki poza literami i cyframi (włącznie ze spacjami)
        return text.replace(/[^\p{L}\p{N}]/gu, '');
    }

    /**
     * Escapuje znaki specjalne regex
     * @param {string} string - String do escapowania
     * @returns {string} - Escapowany string
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Pobiera informacje o blokadzie słowa
     * @param {string} word - Słowo
     * @returns {Object|null} - Informacje o blokadzie lub null
     */
    getWordBlockInfo(word) {
        const wordKey = word.toLowerCase();
        const block = this.wordBlocks.get(wordKey);
        
        if (!block || block.endTime <= new Date()) {
            return null;
        }
        
        return block;
    }

    /**
     * Pobiera wszystkie aktywne blokady słów
     * @returns {Array} - Lista aktywnych blokad
     */
    getAllWordBlocks() {
        const activeBlocks = [];
        for (const [word, block] of this.wordBlocks.entries()) {
            if (block.endTime > new Date()) {
                activeBlocks.push({
                    word: block.originalWord,
                    ...block
                });
            }
        }
        return activeBlocks;
    }

    /**
     * Uruchamia interwał czyszczenia wygasłych blokad
     */
    startCleanupInterval() {
        // Uruchamiaj czyszczenie co 5 minut
        this.cleanupInterval = setInterval(async () => {
            await this.cleanupExpiredBlocks();
        }, 5 * 60 * 1000);
    }

    /**
     * Czyści wygasłe blokady słów
     */
    async cleanupExpiredBlocks() {
        try {
            const now = new Date();
            let removedCount = 0;

            for (const [word, block] of this.wordBlocks.entries()) {
                if (block.endTime <= now) {
                    this.wordBlocks.delete(word);
                    removedCount++;
                }
            }

            if (removedCount > 0) {
                await this.saveWordBlocks();
                logger.info(`🧹 Usunięto ${removedCount} wygasłych blokad słów`);
            }
        } catch (error) {
            logger.error(`❌ Błąd czyszczenia wygasłych blokad słów: ${error.message}`);
        }
    }

    /**
     * Zatrzymuje serwis
     */
    async shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        logger.info('🛑 WordBlockService zatrzymany');
    }
}

module.exports = WordBlockService;