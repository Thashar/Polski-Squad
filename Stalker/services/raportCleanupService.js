const fs = require('fs').promises;
const path = require('path');

/**
 * Serwis zarządzający automatycznym usuwaniem raportów WDUPIE
 */
class RaportCleanupService {
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
        this.dataFilePath = path.join(__dirname, '../data/player_raport_deletions.json');
        this.scheduledDeletions = new Map(); // messageId -> timeoutId
        this.pendingDeletions = []; // Tablica obiektów do usunięcia
    }

    /**
     * Inicjalizuje serwis - wczytuje dane i przywraca timery
     */
    async initialize() {
        try {
            await this.loadData();
            await this.restoreTimers();
            await this.cleanupExpiredMessages();
        } catch (error) {
            this.logger.error('[RAPORT-CLEANUP] ❌ Błąd inicjalizacji:', error);
        }
    }

    /**
     * Wczytuje dane z pliku JSON
     */
    async loadData() {
        try {
            const data = await fs.readFile(this.dataFilePath, 'utf8');
            this.pendingDeletions = JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - utwórz pusty
                this.pendingDeletions = [];
                await this.saveData();
            } else {
                this.logger.error('[RAPORT-CLEANUP] ❌ Błąd wczytywania danych:', error);
                this.pendingDeletions = [];
            }
        }
    }

    /**
     * Zapisuje dane do pliku JSON
     */
    async saveData() {
        try {
            await fs.writeFile(this.dataFilePath, JSON.stringify(this.pendingDeletions, null, 2), 'utf8');
        } catch (error) {
            this.logger.error('[RAPORT-CLEANUP] ❌ Błąd zapisu danych:', error);
        }
    }

    /**
     * Dodaje wiadomość do usunięcia po 5 minutach
     */
    async scheduleRaportDeletion(channelId, messageId, createdAt = Date.now()) {
        const deleteAt = createdAt + (5 * 60 * 1000); // 5 minut

        // Dodaj do listy oczekujących
        this.pendingDeletions.push({
            channelId,
            messageId,
            deleteAt
        });

        await this.saveData();

        // Ustaw timer
        const delay = deleteAt - Date.now();
        if (delay > 0) {
            const timeoutId = setTimeout(() => {
                this.deleteMessage(channelId, messageId);
            }, delay);

            this.scheduledDeletions.set(messageId, timeoutId);
            this.logger.info(`[RAPORT-CLEANUP] 🕐 Zaplanowano usunięcie raportu (ID: ${messageId}) za ${Math.round(delay / 1000)}s`);
        } else {
            // Wiadomość już powinna być usunięta
            await this.deleteMessage(channelId, messageId);
        }
    }

    /**
     * Usuwa wiadomość
     */
    async deleteMessage(channelId, messageId) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                this.logger.warn(`[RAPORT-CLEANUP] ⚠️ Nie znaleziono kanału (ID: ${channelId})`);
                await this.removePendingDeletion(messageId);
                return;
            }

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
                await message.delete();
                this.logger.info(`[RAPORT-CLEANUP] 🗑️ Usunięto raport (ID: ${messageId})`);
            } else {
                this.logger.warn(`[RAPORT-CLEANUP] ⚠️ Wiadomość już nie istnieje (ID: ${messageId})`);
            }

            await this.removePendingDeletion(messageId);
        } catch (error) {
            if (error.code === 10008) {
                // Unknown Message - wiadomość już usunięta
                this.logger.info(`[RAPORT-CLEANUP] ℹ️ Wiadomość już usunięta (ID: ${messageId})`);
            } else {
                this.logger.error(`[RAPORT-CLEANUP] ❌ Błąd usuwania wiadomości (ID: ${messageId}):`, error);
            }
            await this.removePendingDeletion(messageId);
        }
    }

    /**
     * Usuwa wpis z listy oczekujących
     */
    async removePendingDeletion(messageId) {
        this.pendingDeletions = this.pendingDeletions.filter(item => item.messageId !== messageId);
        this.scheduledDeletions.delete(messageId);
        await this.saveData();
    }

    /**
     * Przywraca timery po restarcie bota
     */
    async restoreTimers() {
        const now = Date.now();
        let restoredCount = 0;

        for (const deletion of this.pendingDeletions) {
            const delay = deletion.deleteAt - now;

            if (delay > 0) {
                const timeoutId = setTimeout(() => {
                    this.deleteMessage(deletion.channelId, deletion.messageId);
                }, delay);

                this.scheduledDeletions.set(deletion.messageId, timeoutId);
                restoredCount++;
                this.logger.info(`[RAPORT-CLEANUP] 🔄 Przywrócono timer (ID: ${deletion.messageId}, za ${Math.round(delay / 1000)}s)`);
            }
        }

        if (restoredCount > 0) {
            this.logger.info(`[RAPORT-CLEANUP] ✅ Przywrócono ${restoredCount} timerów`);
        }
    }

    /**
     * Czyści wiadomości, które powinny być już usunięte (po restarcie bota)
     */
    async cleanupExpiredMessages() {
        const now = Date.now();
        const expiredMessages = this.pendingDeletions.filter(item => item.deleteAt <= now);

        if (expiredMessages.length === 0) {
            return;
        }

        this.logger.info(`[RAPORT-CLEANUP] 🧹 Czyszczenie ${expiredMessages.length} wygasłych raportów...`);

        for (const deletion of expiredMessages) {
            await this.deleteMessage(deletion.channelId, deletion.messageId);
        }

        this.logger.info(`[RAPORT-CLEANUP] ✅ Wyczyszczono ${expiredMessages.length} wygasłych raportów`);
    }

    /**
     * Zatrzymuje wszystkie timery (przy wyłączaniu bota)
     */
    async shutdown() {
        for (const timeoutId of this.scheduledDeletions.values()) {
            clearTimeout(timeoutId);
        }
        this.scheduledDeletions.clear();
        this.logger.info('[RAPORT-CLEANUP] 🛑 Zatrzymano wszystkie timery usuwania raportów');
    }
}

module.exports = RaportCleanupService;
