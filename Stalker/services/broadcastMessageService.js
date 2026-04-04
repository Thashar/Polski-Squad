const fs = require('fs').promises;
const path = require('path');

/**
 * Serwis zarządzający przechowywaniem wiadomości broadcast wysłanych przez komendę /msg
 */
class BroadcastMessageService {
    constructor(logger) {
        this.logger = logger;
        this.dataFilePath = path.join(__dirname, '../data/broadcast_messages.json');
        this.messages = [];
    }

    /**
     * Inicjalizuje serwis - wczytuje dane
     */
    async initialize() {
        try {
            await this.loadMessages();
        } catch (error) {
            this.logger.error('[BROADCAST] ❌ Błąd inicjalizacji:', error);
        }
    }

    /**
     * Wczytuje wiadomości z pliku JSON
     */
    async loadMessages() {
        try {
            const data = await fs.readFile(this.dataFilePath, 'utf8');
            this.messages = JSON.parse(data);
            this.logger.info(`[BROADCAST] ✅ Załadowano ${this.messages.length} wiadomości broadcast`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - utwórz pusty
                this.messages = [];
                await this.saveMessages();
                this.logger.info('[BROADCAST] ✅ Utworzono nowy plik wiadomości broadcast');
            } else {
                this.logger.error('[BROADCAST] ❌ Błąd wczytywania wiadomości:', error);
                this.messages = [];
            }
        }
    }

    /**
     * Zapisuje wiadomości do pliku JSON
     */
    async saveMessages() {
        try {
            await fs.writeFile(this.dataFilePath, JSON.stringify(this.messages, null, 2), 'utf8');
            this.logger.info(`[BROADCAST] 💾 Zapisano ${this.messages.length} wiadomości broadcast`);
        } catch (error) {
            this.logger.error('[BROADCAST] ❌ Błąd zapisu wiadomości:', error);
        }
    }

    /**
     * Dodaje nową wiadomość broadcast do listy
     */
    async addMessage(channelId, messageId, timestamp = Date.now()) {
        this.messages.push({
            channelId,
            messageId,
            timestamp
        });
        await this.saveMessages();
    }

    /**
     * Dodaje wiele wiadomości broadcast na raz
     */
    async addMessages(messagesArray) {
        for (const msg of messagesArray) {
            this.messages.push({
                channelId: msg.channelId,
                messageId: msg.messageId,
                timestamp: msg.timestamp || Date.now()
            });
        }
        await this.saveMessages();
    }

    /**
     * Pobiera wszystkie zapisane wiadomości
     */
    getMessages() {
        return [...this.messages];
    }

    /**
     * Usuwa wszystkie wiadomości z listy
     */
    async clearMessages() {
        const count = this.messages.length;
        this.messages = [];
        await this.saveMessages();
        this.logger.info(`[BROADCAST] 🗑️ Wyczyszczono ${count} wiadomości broadcast`);
        return count;
    }

    /**
     * Usuwa pojedynczą wiadomość z listy
     */
    async removeMessage(messageId) {
        const initialCount = this.messages.length;
        this.messages = this.messages.filter(msg => msg.messageId !== messageId);

        if (this.messages.length < initialCount) {
            await this.saveMessages();
            return true;
        }

        return false;
    }

    /**
     * Pobiera liczbę zapisanych wiadomości
     */
    getMessageCount() {
        return this.messages.length;
    }
}

module.exports = BroadcastMessageService;
