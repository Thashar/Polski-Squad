const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

class LobbyService {
    constructor(config) {
        this.config = config;
        this.activeLobbyies = new Map(); // Mapa aktywnych lobby
        this.dataPath = path.join(__dirname, '../data/lobbies.json');
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
     * Tworzy nowe lobby
     * @param {string} ownerId - ID właściciela lobby
     * @param {string} ownerDisplayName - Nazwa właściciela na serwerze
     * @param {ThreadChannel} thread - Wątek lobby
     * @param {Message} announcementMessage - Wiadomość ogłoszeniowa
     * @returns {Object} - Dane utworzonego lobby
     */
    async createLobby(ownerId, ownerDisplayName, thread, announcementMessage) {
        const lobby = {
            id: `lobby_${ownerId}_${Date.now()}`,
            ownerId: ownerId,
            ownerDisplayName: ownerDisplayName,
            threadId: thread.id,
            announcementMessageId: announcementMessage.id,
            players: [ownerId], // Właściciel jest automatycznie w lobby
            pendingRequests: new Map(), // Mapa oczekujących próśb dołączenia
            isFull: false,
            createdAt: Date.now(),
            lastRepositionTime: Date.now(), // Czas ostatniego repozycjonowania
            isExtended: false // Czy lobby zostało już przedłużone
        };

        this.activeLobbyies.set(lobby.id, lobby);
        
        // Zapisz do pliku
        await this.saveLobbies();
        
        return lobby;
    }

    /**
     * Dodaje gracza do lobby
     * @param {string} lobbyId - ID lobby
     * @param {string} playerId - ID gracza do dodania
     * @returns {boolean} - Czy gracz został dodany
     */
    addPlayerToLobby(lobbyId, playerId) {
        const lobby = this.activeLobbyies.get(lobbyId);
        if (!lobby || lobby.isFull) return false;

        if (!lobby.players.includes(playerId)) {
            lobby.players.push(playerId);

            // Sprawdź czy lobby jest pełne
            if (lobby.players.length >= this.config.lobby.maxPlayers) {
                lobby.isFull = true;
            }

            return true;
        }

        return false;
    }

    /**
     * Pobiera lobby po ID
     * @param {string} lobbyId - ID lobby
     * @returns {Object|null} - Dane lobby lub null
     */
    getLobby(lobbyId) {
        return this.activeLobbyies.get(lobbyId) || null;
    }

    /**
     * Pobiera lobby po ID wątku
     * @param {string} threadId - ID wątku
     * @returns {Object|null} - Dane lobby lub null
     */
    getLobbyByThreadId(threadId) {
        for (const lobby of this.activeLobbyies.values()) {
            if (lobby.threadId === threadId) {
                return lobby;
            }
        }
        return null;
    }

    /**
     * Pobiera lobby po ID wiadomości ogłoszeniowej
     * @param {string} messageId - ID wiadomości
     * @returns {Object|null} - Dane lobby lub null
     */
    getLobbyByAnnouncementId(messageId) {
        for (const lobby of this.activeLobbyies.values()) {
            if (lobby.announcementMessageId === messageId) {
                return lobby;
            }
        }
        return null;
    }

    /**
     * Sprawdza czy użytkownik ma aktywne lobby
     * @param {string} userId - ID użytkownika
     * @returns {boolean} - Czy użytkownik ma aktywne lobby
     */
    hasActiveLobby(userId) {
        for (const lobby of this.activeLobbyies.values()) {
            if (lobby.ownerId === userId) {
                return true;
            }
        }
        return false;
    }

    /**
     * Dodaje oczekującą prośbę dołączenia
     * @param {string} lobbyId - ID lobby
     * @param {string} userId - ID użytkownika
     * @param {string} messageId - ID wiadomości z przyciskami
     */
    addPendingRequest(lobbyId, userId, messageId) {
        const lobby = this.activeLobbyies.get(lobbyId);
        if (lobby) {
            lobby.pendingRequests.set(userId, messageId);
        }
    }

    /**
     * Usuwa oczekującą prośbę dołączenia
     * @param {string} lobbyId - ID lobby
     * @param {string} userId - ID użytkownika
     */
    removePendingRequest(lobbyId, userId) {
        const lobby = this.activeLobbyies.get(lobbyId);
        if (lobby && lobby.pendingRequests.has(userId)) {
            lobby.pendingRequests.delete(userId);
        }
    }

    /**
     * Sprawdza czy użytkownik ma oczekującą prośbę
     * @param {string} lobbyId - ID lobby
     * @param {string} userId - ID użytkownika
     * @returns {boolean} - Czy użytkownik ma oczekującą prośbę
     */
    hasPendingRequest(lobbyId, userId) {
        const lobby = this.activeLobbyies.get(lobbyId);
        return lobby ? lobby.pendingRequests.has(userId) : false;
    }

    /**
     * Usuwa lobby
     * @param {string} lobbyId - ID lobby do usunięcia
     */
    removeLobby(lobbyId) {
        if (this.activeLobbyies.has(lobbyId)) {
            this.activeLobbyies.delete(lobbyId);
            logger.info(`🗑️ Usunięto lobby: ${lobbyId}`);
            
            // Zapisz do pliku
            this.saveLobbies().catch(error => {
                logger.error('❌ Błąd podczas zapisywania lobby po usunięciu:', error);
            });
        }
    }

    /**
     * Pobiera wszystkie aktywne lobby
     * @returns {Array} - Lista aktywnych lobby
     */
    getAllActiveLobbies() {
        return Array.from(this.activeLobbyies.values());
    }

    /**
     * Czyści stare lobby (opcjonalne - dla przyszłego użytku)
     * @param {number} maxAge - Maksymalny wiek lobby w ms
     */
    cleanupOldLobbies(maxAge = 24 * 60 * 60 * 1000) { // 24 godziny
        const now = Date.now();
        const toRemove = [];

        for (const [lobbyId, lobby] of this.activeLobbyies.entries()) {
            if (now - lobby.createdAt > maxAge) {
                toRemove.push(lobbyId);
            }
        }

        toRemove.forEach(lobbyId => {
            this.removeLobby(lobbyId);
        });

        if (toRemove.length > 0) {
            logger.info(`🧹 Wyczyszczono ${toRemove.length} starych lobby`);
        }
    }

    /**
     * Zapisuje lobby do pliku
     */
    async saveLobbies() {
        try {
            const lobbiesForSave = {};
            
            for (const [lobbyId, lobby] of this.activeLobbyies.entries()) {
                // Kopiuj lobby bez pendingRequests (Map nie da się zserializować do JSON)
                lobbiesForSave[lobbyId] = {
                    id: lobby.id,
                    ownerId: lobby.ownerId,
                    ownerDisplayName: lobby.ownerDisplayName,
                    threadId: lobby.threadId,
                    announcementMessageId: lobby.announcementMessageId,
                    players: lobby.players,
                    isFull: lobby.isFull,
                    createdAt: lobby.createdAt,
                    lastRepositionTime: lobby.lastRepositionTime || lobby.createdAt,
                    isExtended: lobby.isExtended || false
                };
            }

            await fs.writeFile(this.dataPath, JSON.stringify(lobbiesForSave, null, 2));
        } catch (error) {
            logger.error('❌ Błąd podczas zapisywania lobby do pliku:', error);
        }
    }

    /**
     * Wczytuje lobby z pliku
     */
    async loadLobbies() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            const lobbiesData = JSON.parse(data);
            
            this.activeLobbyies.clear();
            
            for (const [lobbyId, lobbyData] of Object.entries(lobbiesData)) {
                // Odtwórz lobby z dodaniem pustej mapy pendingRequests
                const lobby = {
                    ...lobbyData,
                    pendingRequests: new Map(),
                    lastRepositionTime: lobbyData.lastRepositionTime || lobbyData.createdAt,
                    isExtended: lobbyData.isExtended || false
                };
                
                this.activeLobbyies.set(lobbyId, lobby);
            }
            
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('❌ Błąd podczas wczytywania lobby:', error);
            }
        }
    }

    /**
     * Aktualizuje czas ostatniego repozycjonowania lobby
     * @param {string} lobbyId - ID lobby
     */
    updateRepositionTime(lobbyId) {
        const lobby = this.activeLobbyies.get(lobbyId);
        if (lobby) {
            lobby.lastRepositionTime = Date.now();
        }
    }

    /**
     * Pobiera lobby które wymagają repozycjonowania (niepełne i starsze niż 5 min od ostatniego repozycjonowania)
     * @param {number} repositionInterval - Interwał repozycjonowania w ms
     * @returns {Array} - Lista lobby do repozycjonowania
     */
    getLobbiesForRepositioning(repositionInterval) {
        const now = Date.now();
        const lobbiesForRepositioning = [];

        for (const lobby of this.activeLobbyies.values()) {
            // Pomiń pełne lobby
            if (lobby.isFull) continue;
            
            // Sprawdź czy minęło wystarczająco czasu od ostatniego repozycjonowania
            const timeSinceLastReposition = now - lobby.lastRepositionTime;
            if (timeSinceLastReposition >= repositionInterval) {
                lobbiesForRepositioning.push(lobby);
            }
        }

        return lobbiesForRepositioning;
    }
}

module.exports = LobbyService;