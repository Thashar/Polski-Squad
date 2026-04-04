const fs = require('fs').promises;
const path = require('path');

class MessageCleanupService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.messagesFile = path.join(__dirname, '../data/scheduled_deletions.json');
        this.scheduledMessages = [];
        this.cleanupInterval = null;
    }

    async init() {
        try {
            await this.loadScheduledMessages();
            this.startCleanupInterval();
        } catch (error) {
            this.logger.error('[MESSAGE_CLEANUP] ❌ Błąd inicjalizacji serwisu:', error.message);
        }
    }

    async loadScheduledMessages() {
        try {
            const data = await fs.readFile(this.messagesFile, 'utf-8');
            this.scheduledMessages = JSON.parse(data);
            this.logger.info(`[MESSAGE_CLEANUP] ✅ Załadowano ${this.scheduledMessages.length} zaplanowanych usunięć`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.scheduledMessages = [];
                await this.saveScheduledMessages();
            } else {
                this.logger.error('[MESSAGE_CLEANUP] ❌ Błąd ładowania zaplanowanych usunięć:', error.message);
                throw error;
            }
        }
    }

    async saveScheduledMessages() {
        try {
            await fs.writeFile(this.messagesFile, JSON.stringify(this.scheduledMessages, null, 2), 'utf-8');
        } catch (error) {
            this.logger.error('[MESSAGE_CLEANUP] ❌ Błąd zapisu zaplanowanych usunięć:', error.message);
            throw error;
        }
    }

    async scheduleMessageDeletion(messageId, channelId, deleteAtTimestamp, userId = null) {
        try {
            const scheduledMessage = {
                messageId,
                channelId,
                deleteAt: deleteAtTimestamp,
                userId: userId, // Zapisz właściciela wiadomości
                createdAt: new Date().toISOString()
            };

            this.scheduledMessages.push(scheduledMessage);
            await this.saveScheduledMessages();

            return true;
        } catch (error) {
            this.logger.error('[MESSAGE_CLEANUP] ❌ Błąd planowania usunięcia wiadomości:', error.message);
            return false;
        }
    }

    startCleanupInterval() {
        // Sprawdzaj co 2 minuty
        this.cleanupInterval = setInterval(async () => {
            await this.processScheduledDeletions();
        }, 2 * 60 * 1000);

    }

    async processScheduledDeletions() {
        const now = Date.now();
        const messagesToDelete = this.scheduledMessages.filter(msg => msg.deleteAt <= now);

        if (messagesToDelete.length === 0) {
            return;
        }

        this.logger.info(`[MESSAGE_CLEANUP] 🗑️ Przetwarzanie ${messagesToDelete.length} wiadomości do usunięcia`);

        for (const messageData of messagesToDelete) {
            await this.deleteMessage(messageData);
        }

        // Usuń przetworzone wiadomości z listy (zarówno te pomyślnie usunięte jak i te z błędami)
        this.scheduledMessages = this.scheduledMessages.filter(msg => msg.deleteAt > now);
        await this.saveScheduledMessages();

        this.logger.info(`[MESSAGE_CLEANUP] 🧹 Usunięto ${messagesToDelete.length} wpisów z pliku zaplanowanych usunięć`);
    }

    async deleteMessage(messageData) {
        try {
            // Pobierz klienta Discord z globalnego kontekstu
            const client = global.stalkerClient;
            if (!client) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Brak dostępu do klienta Discord dla wiadomości ${messageData.messageId}`);
                return;
            }

            if (!client.isReady()) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Klient Discord nie jest gotowy dla wiadomości ${messageData.messageId}`);
                return;
            }

            const channel = await client.channels.fetch(messageData.channelId);
            if (!channel) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Nie znaleziono kanału ${messageData.channelId} dla wiadomości ${messageData.messageId}`);
                return;
            }

            const message = await channel.messages.fetch(messageData.messageId);
            if (!message) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Nie znaleziono wiadomości ${messageData.messageId} w kanale ${messageData.channelId}`);
                return;
            }

            await message.delete();
            this.logger.info(`[MESSAGE_CLEANUP] ✅ Usunięto wiadomość ${messageData.messageId} z kanału ${messageData.channelId}`);

        } catch (error) {
            if (error.code === 10008) {
                // Wiadomość już nie istnieje
                this.logger.info(`[MESSAGE_CLEANUP] ℹ️ Wiadomość ${messageData.messageId} już została usunięta`);
            } else if (error.code === 10003) {
                // Kanał nie istnieje
                this.logger.info(`[MESSAGE_CLEANUP] ℹ️ Kanał ${messageData.channelId} już nie istnieje dla wiadomości ${messageData.messageId}`);
            } else if (error.code === 50001) {
                // Brak uprawnień
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Brak uprawnień do usunięcia wiadomości ${messageData.messageId} w kanale ${messageData.channelId}`);
            } else if (error.code === 50013) {
                // Brak uprawnień do zarządzania wiadomościami
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Brak uprawnień 'Manage Messages' dla wiadomości ${messageData.messageId}`);
            } else {
                this.logger.error(`[MESSAGE_CLEANUP] ❌ Błąd usuwania wiadomości ${messageData.messageId}: ${error.message} (kod: ${error.code || 'brak'})`);
            }
        }
    }

    async cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Usuń wiadomości starsze niż 24 godziny (czyszczenie pliku)
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const validMessages = this.scheduledMessages.filter(msg =>
            msg.deleteAt > oneDayAgo || msg.deleteAt > Date.now()
        );

        if (validMessages.length !== this.scheduledMessages.length) {
            this.scheduledMessages = validMessages;
            await this.saveScheduledMessages();
            this.logger.info('[MESSAGE_CLEANUP] 🧹 Wyczyszczono stare wpisy z zaplanowanych usunięć');
        }
    }

    async removeScheduledMessage(messageId) {
        try {
            const initialCount = this.scheduledMessages.length;
            this.scheduledMessages = this.scheduledMessages.filter(msg => msg.messageId !== messageId);

            if (this.scheduledMessages.length < initialCount) {
                await this.saveScheduledMessages();
                return true;
            }

            return false;
        } catch (error) {
            this.logger.error('[MESSAGE_CLEANUP] ❌ Błąd usuwania zaplanowanego usuwania:', error.message);
            return false;
        }
    }

    getScheduledCount() {
        return this.scheduledMessages.length;
    }

    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            this.logger.info('[MESSAGE_CLEANUP] ⏹️ Zatrzymano serwis automatycznego usuwania wiadomości');
        }
    }
}

module.exports = MessageCleanupService;