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
            this.logger.info('[MESSAGE_CLEANUP] ✅ Serwis automatycznego usuwania wiadomości zainicjowany');
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
                this.logger.info('[MESSAGE_CLEANUP] ✅ Utworzono nowy plik zaplanowanych usunięć');
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

    async scheduleMessageDeletion(messageId, channelId, deleteAtTimestamp) {
        try {
            const scheduledMessage = {
                messageId,
                channelId,
                deleteAt: deleteAtTimestamp,
                createdAt: new Date().toISOString()
            };

            this.scheduledMessages.push(scheduledMessage);
            await this.saveScheduledMessages();

            this.logger.info(`[MESSAGE_CLEANUP] 📝 Zaplanowano usunięcie wiadomości ${messageId} na ${new Date(deleteAtTimestamp).toLocaleString('pl-PL')}`);
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

        this.logger.info('[MESSAGE_CLEANUP] ⏰ Uruchomiono automatyczne sprawdzanie co 2 minuty');
    }

    async processScheduledDeletions() {
        const now = Date.now();
        const messagesToDelete = this.scheduledMessages.filter(msg => msg.deleteAt <= now);
        const remainingMessages = this.scheduledMessages.filter(msg => msg.deleteAt > now);

        if (messagesToDelete.length === 0) {
            return;
        }

        this.logger.info(`[MESSAGE_CLEANUP] 🗑️ Przetwarzanie ${messagesToDelete.length} wiadomości do usunięcia`);

        for (const messageData of messagesToDelete) {
            await this.deleteMessage(messageData);
        }

        // Usuń przetworzone wiadomości z listy
        this.scheduledMessages = remainingMessages;
        await this.saveScheduledMessages();
    }

    async deleteMessage(messageData) {
        try {
            // Pobierz klienta Discord z globalnego kontekstu
            const client = global.stalkerLMEClient;
            if (!client) {
                this.logger.warn('[MESSAGE_CLEANUP] ⚠️ Brak dostępu do klienta Discord');
                return;
            }

            const channel = await client.channels.fetch(messageData.channelId);
            if (!channel) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Nie znaleziono kanału ${messageData.channelId}`);
                return;
            }

            const message = await channel.messages.fetch(messageData.messageId);
            if (!message) {
                this.logger.warn(`[MESSAGE_CLEANUP] ⚠️ Nie znaleziono wiadomości ${messageData.messageId}`);
                return;
            }

            await message.delete();
            this.logger.info(`[MESSAGE_CLEANUP] ✅ Usunięto wiadomość ${messageData.messageId} z kanału ${messageData.channelId}`);

        } catch (error) {
            if (error.code === 10008) {
                // Wiadomość już nie istnieje
                this.logger.info(`[MESSAGE_CLEANUP] ℹ️ Wiadomość ${messageData.messageId} już została usunięta`);
            } else {
                this.logger.error(`[MESSAGE_CLEANUP] ❌ Błąd usuwania wiadomości ${messageData.messageId}:`, error.message);
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