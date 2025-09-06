const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class ImageBlockService {
    constructor(config, logService) {
        this.config = config;
        this.logService = logService;
        this.dataFile = path.join(__dirname, '../data/image_blocks.json');
        this.blocks = new Map();
        this.cleanupInterval = null;
    }

    /**
     * Inicjalizuje serwis
     */
    async initialize() {
        try {
            await this.loadBlocks();
            this.startCleanupInterval();
            logger.info('🚫 ImageBlockService zainicjalizowany');
        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji ImageBlockService: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ładuje blokady z pliku
     */
    async loadBlocks() {
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
            this.blocks.clear();
            let totalLoaded = 0;
            let expiredCount = 0;
            const now = new Date();
            
            for (const [channelId, blockInfo] of Object.entries(blocksData)) {
                totalLoaded++;
                const endTime = new Date(blockInfo.endTime);
                
                if (endTime > now) {
                    // Blokada aktywna - dodaj do mapy
                    this.blocks.set(channelId, {
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
                await this.saveBlocks();
                logger.info(`🧹 Usunięto ${expiredCount} wygasłych blokad obrazów podczas uruchamiania`);
            }

            logger.info(`📥 Załadowano ${this.blocks.size} aktywnych blokad obrazów (łącznie przetworzono: ${totalLoaded})`);
        } catch (error) {
            logger.error(`❌ Błąd ładowania blokad: ${error.message}`);
            throw error;
        }
    }

    /**
     * Zapisuje blokady do pliku
     */
    async saveBlocks() {
        try {
            await this.ensureDataDirectory();
            
            // Konwertuj Map na obiekt z ISO stringami dla dat
            const blocksData = {};
            for (const [channelId, blockInfo] of this.blocks.entries()) {
                blocksData[channelId] = {
                    ...blockInfo,
                    endTime: blockInfo.endTime.toISOString()
                };
            }

            await fs.writeFile(this.dataFile, JSON.stringify(blocksData, null, 2));
            logger.info(`💾 Zapisano ${this.blocks.size} blokad obrazów`);
        } catch (error) {
            logger.error(`❌ Błąd zapisywania blokad: ${error.message}`);
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
     * Dodaje nową blokadę
     * @param {string} channelId - ID kanału
     * @param {Date} endTime - Czas zakończenia blokady
     * @param {string} moderatorId - ID moderatora
     * @returns {Object} - Wynik operacji
     */
    async addBlock(channelId, endTime, moderatorId) {
        try {
            // Sprawdź czy blokada już istnieje i czy nie wygasła
            if (this.blocks.has(channelId)) {
                const existingBlock = this.blocks.get(channelId);
                const now = new Date();
                
                if (existingBlock.endTime <= now) {
                    // Blokada wygasła - usuń ją i pozwól na dodanie nowej
                    this.blocks.delete(channelId);
                    await this.saveBlocks();
                    logger.info(`🧹 Usunięto wygasłą blokadę kanału ${channelId}`);
                } else {
                    // Blokada wciąż aktywna
                    return {
                        success: false,
                        message: `Kanał jest już zablokowany do ${existingBlock.endTime.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`
                    };
                }
            }

            // Dodaj nową blokadę
            const blockInfo = {
                channelId: channelId,
                endTime: endTime,
                moderatorId: moderatorId,
                createdAt: new Date()
            };

            this.blocks.set(channelId, blockInfo);
            await this.saveBlocks();

            return {
                success: true,
                message: 'Blokada została dodana pomyślnie',
                blockInfo: blockInfo
            };
        } catch (error) {
            logger.error(`❌ Błąd dodawania blokady: ${error.message}`);
            return {
                success: false,
                message: `Błąd dodawania blokady: ${error.message}`
            };
        }
    }

    /**
     * Usuwa blokadę
     * @param {string} channelId - ID kanału
     * @returns {Object} - Wynik operacji
     */
    async removeBlock(channelId) {
        try {
            if (!this.blocks.has(channelId)) {
                return {
                    success: false,
                    message: 'Kanał nie jest zablokowany'
                };
            }

            const blockInfo = this.blocks.get(channelId);
            this.blocks.delete(channelId);
            await this.saveBlocks();

            return {
                success: true,
                message: 'Blokada została usunięta',
                blockInfo: blockInfo
            };
        } catch (error) {
            logger.error(`❌ Błąd usuwania blokady: ${error.message}`);
            return {
                success: false,
                message: `Błąd usuwania blokady: ${error.message}`
            };
        }
    }

    /**
     * Sprawdza czy kanał jest zablokowany
     * @param {string} channelId - ID kanału
     * @returns {boolean} - Czy kanał jest zablokowany
     */
    isChannelBlocked(channelId) {
        const block = this.blocks.get(channelId);
        if (!block) {
            return false;
        }

        // Sprawdź czy blokada nie wygasła
        const now = new Date();
        if (block.endTime <= now) {
            // Usuń wygasłą blokadę
            this.blocks.delete(channelId);
            this.saveBlocks().catch(error => {
                logger.error(`❌ Błąd usuwania wygasłej blokady: ${error.message}`);
            });
            return false;
        }

        return true;
    }

    /**
     * Pobiera informacje o blokadzie kanału
     * @param {string} channelId - ID kanału
     * @returns {Object|null} - Informacje o blokadzie lub null
     */
    getBlockInfo(channelId) {
        const block = this.blocks.get(channelId);
        if (!block || block.endTime <= new Date()) {
            return null;
        }
        return block;
    }

    /**
     * Pobiera wszystkie aktywne blokady
     * @returns {Array} - Lista aktywnych blokad
     */
    getAllBlocks() {
        const activeBlocks = [];
        for (const [channelId, block] of this.blocks.entries()) {
            if (block.endTime > new Date()) {
                activeBlocks.push({
                    channelId,
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
     * Czyści wygasłe blokady
     */
    async cleanupExpiredBlocks() {
        try {
            const now = new Date();
            let removedCount = 0;

            for (const [channelId, block] of this.blocks.entries()) {
                if (block.endTime <= now) {
                    this.blocks.delete(channelId);
                    removedCount++;
                }
            }

            if (removedCount > 0) {
                await this.saveBlocks();
                logger.info(`🧹 Usunięto ${removedCount} wygasłych blokad obrazów`);
            }
        } catch (error) {
            logger.error(`❌ Błąd czyszczenia wygasłych blokad: ${error.message}`);
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
        logger.info('🛑 ImageBlockService zatrzymany');
    }
}

module.exports = ImageBlockService;