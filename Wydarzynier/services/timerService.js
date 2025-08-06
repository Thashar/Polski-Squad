const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

class TimerService {
    constructor(config) {
        this.config = config;
        this.activeTimers = new Map(); // Mapa aktywnych timerów
        this.dataPath = path.join(__dirname, '../data/timers.json');
        this.ensureDataDirectory();
    }

    /**
     * Zapewnia istnienie katalogu data
     */
    async ensureDataDirectory() {
        const dataDir = path.dirname(this.dataPath);
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                logger.error('❌ Błąd podczas tworzenia katalogu data:', error);
            }
        }
    }

    /**
     * Tworzy timer dla lobby z ostrzeżeniem i zamknięciem
     * @param {string} lobbyId - ID lobby
     * @param {number} createdAt - Timestamp utworzenia lobby
     * @param {Function} warningCallback - Funkcja wywoływana przy ostrzeżeniu
     * @param {Function} deleteCallback - Funkcja wywoływana przy usunięciu
     */
    async createLobbyTimer(lobbyId, createdAt, warningCallback, deleteCallback) {
        const now = Date.now();
        const warningTime = createdAt + this.config.lobby.maxDuration - this.config.lobby.warningTime;
        const deleteTime = createdAt + this.config.lobby.maxDuration;

        // Sprawdź czy ostrzeżenie już minęło
        const warningDelay = Math.max(0, warningTime - now);
        const deleteDelay = Math.max(0, deleteTime - now);

        // Jeśli czas już minął, usuń lobby od razu
        if (deleteDelay === 0) {
            logger.info(`⏰ Timer lobby ${lobbyId} już wygasł - usuwanie od razu`);
            if (deleteCallback) {
                await deleteCallback();
            }
            return;
        }

        const timerData = {
            lobbyId,
            createdAt,
            warningTime,
            deleteTime,
            warningExecuted: warningDelay === 0,
            isFullLobby: false // Oznacza czy lobby jest pełne i ma skrócony timer
        };

        // Ustaw timer ostrzeżenia (jeśli jeszcze nie minął)
        if (warningDelay > 0) {
            const warningTimer = setTimeout(async () => {
                logger.info(`⚠️ Wysyłanie ostrzeżenia dla lobby ${lobbyId}`);
                timerData.warningExecuted = true;
                await this.saveTimersToFile();
                if (warningCallback) {
                    await warningCallback(lobbyId); // Przekaż lobbyId do callback
                }
            }, warningDelay);

            timerData.warningTimer = warningTimer;
        }

        // Ustaw timer usunięcia
        const deleteTimer = setTimeout(async () => {
            logger.info(`🗑️ Usuwanie lobby ${lobbyId} - czas minął`);
            if (deleteCallback) {
                await deleteCallback();
            }
            this.removeTimer(lobbyId);
        }, deleteDelay);

        timerData.deleteTimer = deleteTimer;
        this.activeTimers.set(lobbyId, timerData);

        // Zapisz do pliku
        await this.saveTimersToFile();

        logger.info(`⏰ Utworzono timer dla lobby ${lobbyId} - ostrzeżenie za ${Math.round(warningDelay/1000/60)}min, usunięcie za ${Math.round(deleteDelay/1000/60)}min`);
    }

    /**
     * Tworzy skrócony timer 15 minut dla pełnego lobby
     * @param {string} lobbyId - ID lobby
     * @param {Function} warningCallback - Funkcja wywoływana przy ostrzeżeniu
     * @param {Function} deleteCallback - Funkcja wywoływana przy usunięciu
     */
    async createFullLobbyTimer(lobbyId, warningCallback, deleteCallback) {
        // Usuń istniejący timer jeśli istnieje
        this.removeTimer(lobbyId);

        const now = Date.now();
        const fullLobbyDuration = this.config.lobby.fullLobbyDuration; // 15 minut
        const warningTime = now + fullLobbyDuration - this.config.lobby.warningTime; // 5 minut przed końcem
        const deleteTime = now + fullLobbyDuration;

        const warningDelay = Math.max(0, warningTime - now);
        const deleteDelay = Math.max(0, deleteTime - now);

        const timerData = {
            lobbyId,
            createdAt: now,
            warningTime,
            deleteTime,
            warningExecuted: warningDelay === 0,
            isFullLobby: true // Oznacza że to timer dla pełnego lobby
        };

        // Ustaw timer ostrzeżenia (jeśli jeszcze nie minął)
        if (warningDelay > 0) {
            const warningTimer = setTimeout(async () => {
                logger.info(`⚠️ Wysyłanie ostrzeżenia dla pełnego lobby ${lobbyId}`);
                timerData.warningExecuted = true;
                await this.saveTimersToFile();
                if (warningCallback) {
                    await warningCallback(lobbyId); // Przekaż lobbyId do callback
                }
            }, warningDelay);

            timerData.warningTimer = warningTimer;
        }

        // Ustaw timer usunięcia
        const deleteTimer = setTimeout(async () => {
            logger.info(`🗑️ Usuwanie pełnego lobby ${lobbyId} - czas 15 minut minął`);
            if (deleteCallback) {
                await deleteCallback();
            }
            this.removeTimer(lobbyId);
        }, deleteDelay);

        timerData.deleteTimer = deleteTimer;
        this.activeTimers.set(lobbyId, timerData);

        // Zapisz do pliku
        await this.saveTimersToFile();

        logger.info(`⏰ Utworzono timer 15 minut dla pełnego lobby ${lobbyId} - ostrzeżenie za ${Math.round(warningDelay/1000/60)}min, usunięcie za ${Math.round(deleteDelay/1000/60)}min`);
    }

    /**
     * Usuwa timer dla lobby
     * @param {string} lobbyId - ID lobby
     */
    removeTimer(lobbyId) {
        const timerData = this.activeTimers.get(lobbyId);
        if (timerData) {
            if (timerData.warningTimer) {
                clearTimeout(timerData.warningTimer);
            }
            if (timerData.deleteTimer) {
                clearTimeout(timerData.deleteTimer);
            }
            this.activeTimers.delete(lobbyId);
            
            // Aktualizuj plik
            this.saveTimersToFile().catch(error => {
                logger.error('❌ Błąd podczas zapisywania timerów po usunięciu:', error);
            });
            
            logger.info(`🗑️ Usunięto timer dla lobby ${lobbyId}`);
        }
    }

    /**
     * Przywraca timery po restarcie bota
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async restoreTimers(sharedState) {
        try {
            await this.loadTimersFromFile();
            
            const now = Date.now();
            const timersToRestore = [];

            for (const [lobbyId, timerData] of this.activeTimers.entries()) {
                // Sprawdź czy lobby nadal istnieje
                const lobby = sharedState.lobbyService.getLobby(lobbyId);
                if (!lobby) {
                    logger.warn(`⚠️ Lobby ${lobbyId} nie istnieje - usuwanie timer`);
                    this.activeTimers.delete(lobbyId);
                    continue;
                }

                timersToRestore.push({ lobbyId, timerData, lobby });
            }

            // Przywróć timery
            for (const { lobbyId, timerData, lobby } of timersToRestore) {
                const warningCallback = async (lobbyId) => {
                    try {
                        const thread = await sharedState.client.channels.fetch(lobby.threadId);
                        
                        // Utwórz przyciski dla właściciela lobby
                        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                        const warningButtons = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`extend_lobby_${lobbyId}`)
                                    .setLabel('Przedłuż o 15 min')
                                    .setEmoji('⏰')
                                    .setStyle(ButtonStyle.Primary),
                                new ButtonBuilder()
                                    .setCustomId(`close_lobby_${lobbyId}`)
                                    .setLabel('Zamknij lobby')
                                    .setEmoji('🔒')
                                    .setStyle(ButtonStyle.Danger)
                            );

                        await thread.send({
                            content: this.config.messages.lobbyWarning,
                            components: [warningButtons]
                        });
                    } catch (error) {
                        logger.error(`❌ Błąd podczas wysyłania ostrzeżenia dla lobby ${lobbyId}:`, error);
                    }
                };

                const deleteCallback = async () => {
                    try {
                        await this.deleteLobby(lobby, sharedState);
                    } catch (error) {
                        logger.error(`❌ Błąd podczas usuwania lobby ${lobbyId}:`, error);
                    }
                };

                // Usuń stary timer z mapy i utwórz nowy
                this.activeTimers.delete(lobbyId);
                await this.createLobbyTimer(lobbyId, timerData.createdAt, warningCallback, deleteCallback);
            }

            await this.saveTimersToFile();
            logger.info(`🔄 Przywrócono ${timersToRestore.length} timerów lobby`);

        } catch (error) {
            logger.error('❌ Błąd podczas przywracania timerów:', error);
        }
    }

    /**
     * Usuwa lobby (kopiowane z interactionHandlers.js)
     * @param {Object} lobby - Dane lobby
     * @param {Object} sharedState - Współdzielony stan aplikacji
     */
    async deleteLobby(lobby, sharedState) {
        try {
            // Usuń wątek
            const thread = await sharedState.client.channels.fetch(lobby.threadId).catch(() => null);
            if (thread) {
                await thread.delete('Czas lobby upłynął');
            }

            // Usuń wiadomość ogłoszeniową
            const channel = await sharedState.client.channels.fetch(sharedState.config.channels.party);
            const announcementMessage = await channel.messages.fetch(lobby.announcementMessageId).catch(() => null);
            if (announcementMessage) {
                await announcementMessage.delete();
            }

            // Usuń lobby z serwisu
            sharedState.lobbyService.removeLobby(lobby.id);

            // Usuń timer
            this.removeTimer(lobby.id);

            logger.info(`🗑️ Usunięto lobby ${lobby.id} wraz z zasobami (timer expired)`);
        } catch (error) {
            logger.error('❌ Błąd podczas usuwania lobby przez timer:', error);
        }
    }

    /**
     * Zapisuje aktywne timery do pliku
     */
    async saveTimersToFile() {
        try {
            const timersForSave = {};
            
            for (const [lobbyId, timerData] of this.activeTimers.entries()) {
                timersForSave[lobbyId] = {
                    lobbyId: timerData.lobbyId,
                    createdAt: timerData.createdAt,
                    warningTime: timerData.warningTime,
                    deleteTime: timerData.deleteTime,
                    warningExecuted: timerData.warningExecuted,
                    isFullLobby: timerData.isFullLobby || false
                };
            }

            await fs.writeFile(this.dataPath, JSON.stringify(timersForSave, null, 2));
        } catch (error) {
            logger.error('❌ Błąd podczas zapisywania timerów do pliku:', error);
        }
    }

    /**
     * Wczytuje timery z pliku
     */
    async loadTimersFromFile() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            const timersData = JSON.parse(data);
            
            this.activeTimers.clear();
            
            for (const [lobbyId, timerData] of Object.entries(timersData)) {
                this.activeTimers.set(lobbyId, timerData);
            }
            
            logger.info(`📂 Wczytano ${Object.keys(timersData).length} timerów z pliku`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('📂 Brak pliku timerów - rozpoczynanie z pustą listą');
            } else {
                logger.error('❌ Błąd podczas wczytywania timerów:', error);
            }
        }
    }

    /**
     * Pobiera informacje o aktywnych timerach
     * @returns {Array} - Lista aktywnych timerów
     */
    getActiveTimers() {
        const now = Date.now();
        return Array.from(this.activeTimers.entries()).map(([lobbyId, timerData]) => ({
            lobbyId,
            timeRemaining: Math.max(0, timerData.deleteTime - now),
            warningExecuted: timerData.warningExecuted
        }));
    }
}

module.exports = TimerService;