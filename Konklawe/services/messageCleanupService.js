const fs = require('fs').promises;
const path = require('path');

/**
 * Serwis do automatycznego usuwania wiadomości po określonym czasie
 * - Persistent storage (przetrwa restart bota)
 * - Automatyczne usuwanie przeterminowanych wiadomości przy starcie
 * - Przywracanie timerów po restarcie
 */
class MessageCleanupService {
    constructor(client, logger, dataDir) {
        this.client = client;
        this.logger = logger;
        this.dataPath = path.join(dataDir, 'scheduled_message_deletions.json');

        // Mapa aktywnych timerów: messageId -> timeoutId
        this.activeTimers = new Map();

        // Dane scheduled deletions
        this.scheduledDeletions = [];
    }

    /**
     * Inicjalizacja serwisu - ładuje dane i przywraca timery
     */
    async initialize() {
        await this.loadScheduledDeletions();
        await this.restoreTimers();
        this.logger.info(`🗑️ MessageCleanupService zainicjalizowany: ${this.scheduledDeletions.length} zaplanowanych usunięć`);
    }

    /**
     * Ładuje zaplanowane usunięcia z pliku
     */
    async loadScheduledDeletions() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');
            this.scheduledDeletions = JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - pierwszy start
                this.scheduledDeletions = [];
                await this.saveScheduledDeletions();
            } else {
                this.logger.error(`❌ Błąd ładowania scheduled deletions: ${error.message}`);
                this.scheduledDeletions = [];
            }
        }
    }

    /**
     * Zapisuje zaplanowane usunięcia do pliku
     */
    async saveScheduledDeletions() {
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(this.scheduledDeletions, null, 2));
        } catch (error) {
            this.logger.error(`❌ Błąd zapisywania scheduled deletions: ${error.message}`);
        }
    }

    /**
     * Przywraca timery po restarcie bota
     * - Usuwa przeterminowane wiadomości
     * - Ustawia timery dla aktualnych
     */
    async restoreTimers() {
        const now = Date.now();
        const toDelete = [];
        const toKeep = [];

        for (const scheduled of this.scheduledDeletions) {
            const timeLeft = scheduled.deleteAt - now;

            if (timeLeft <= 0) {
                // Wiadomość już przeterminowana - usuń natychmiast
                toDelete.push(scheduled);
                await this.deleteMessage(scheduled.channelId, scheduled.messageId, scheduled.reason + ' (przeterminowana przy starcie)');
            } else {
                // Wiadomość jeszcze aktualna - ustaw timer
                toKeep.push(scheduled);
                this.setTimer(scheduled.messageId, scheduled.channelId, timeLeft, scheduled.reason);
            }
        }

        // Aktualizuj listę (usuń przeterminowane)
        this.scheduledDeletions = toKeep;
        await this.saveScheduledDeletions();

        if (toDelete.length > 0) {
            this.logger.info(`🗑️ Usunięto ${toDelete.length} przeterminowanych wiadomości przy starcie`);
        }
    }

    /**
     * Zaplanuj usunięcie wiadomości
     * @param {string} messageId - ID wiadomości
     * @param {string} channelId - ID kanału
     * @param {number} deleteAt - Timestamp kiedy usunąć (Date.now() + ms)
     * @param {string} reason - Powód usunięcia (dla logów)
     */
    async scheduleMessageDeletion(messageId, channelId, deleteAt, reason) {
        // Sprawdź czy nie ma już zaplanowanego usunięcia dla tej wiadomości
        const existing = this.scheduledDeletions.find(s => s.messageId === messageId);
        if (existing) {
            this.logger.warn(`⚠️ Wiadomość ${messageId} ma już zaplanowane usunięcie - pomijam`);
            return;
        }

        // Dodaj do listy
        this.scheduledDeletions.push({
            messageId,
            channelId,
            deleteAt,
            reason,
            scheduledAt: Date.now()
        });

        await this.saveScheduledDeletions();

        // Ustaw timer
        const delay = deleteAt - Date.now();
        this.setTimer(messageId, channelId, delay, reason);

        this.logger.info(`🗑️ Zaplanowano usunięcie wiadomości ${messageId} za ${Math.round(delay / 1000 / 60)} min (${reason})`);
    }

    /**
     * Ustawia timer dla usunięcia wiadomości
     * @param {string} messageId - ID wiadomości
     * @param {string} channelId - ID kanału
     * @param {number} delay - Opóźnienie w ms
     * @param {string} reason - Powód usunięcia
     */
    setTimer(messageId, channelId, delay, reason) {
        // Anuluj istniejący timer jeśli jest
        if (this.activeTimers.has(messageId)) {
            clearTimeout(this.activeTimers.get(messageId));
        }

        // Ustaw nowy timer
        const timerId = setTimeout(async () => {
            await this.deleteMessage(channelId, messageId, reason);

            // Usuń z listy scheduled deletions
            this.scheduledDeletions = this.scheduledDeletions.filter(s => s.messageId !== messageId);
            await this.saveScheduledDeletions();

            // Usuń timer z mapy
            this.activeTimers.delete(messageId);
        }, delay);

        this.activeTimers.set(messageId, timerId);
    }

    /**
     * Usuwa wiadomość z kanału
     * @param {string} channelId - ID kanału
     * @param {string} messageId - ID wiadomości
     * @param {string} reason - Powód usunięcia
     */
    async deleteMessage(channelId, messageId, reason) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                this.logger.warn(`⚠️ Nie znaleziono kanału ${channelId} - pomijam usunięcie wiadomości ${messageId}`);
                return;
            }

            const message = await channel.messages.fetch(messageId);
            if (!message) {
                this.logger.warn(`⚠️ Nie znaleziono wiadomości ${messageId} - pomijam usunięcie`);
                return;
            }

            await message.delete();
            this.logger.info(`🗑️ Usunięto wiadomość ${messageId} (${reason})`);
        } catch (error) {
            // Ignoruj błąd Unknown Message (wiadomość już usunięta)
            if (error.code === 10008) {
                this.logger.info(`ℹ️ Wiadomość ${messageId} już usunięta (${reason})`);
            } else {
                this.logger.error(`❌ Błąd usuwania wiadomości ${messageId}: ${error.message}`);
            }
        }
    }

    /**
     * Anuluj zaplanowane usunięcie wiadomości
     * @param {string} messageId - ID wiadomości
     */
    async cancelMessageDeletion(messageId) {
        // Anuluj timer
        if (this.activeTimers.has(messageId)) {
            clearTimeout(this.activeTimers.get(messageId));
            this.activeTimers.delete(messageId);
        }

        // Usuń z listy
        const before = this.scheduledDeletions.length;
        this.scheduledDeletions = this.scheduledDeletions.filter(s => s.messageId !== messageId);
        const after = this.scheduledDeletions.length;

        if (before > after) {
            await this.saveScheduledDeletions();
            this.logger.info(`🗑️ Anulowano usunięcie wiadomości ${messageId}`);
        }
    }

    /**
     * Pobiera statystyki serwisu
     * @returns {Object} - { scheduled: number, active: number }
     */
    getStats() {
        return {
            scheduled: this.scheduledDeletions.length,
            active: this.activeTimers.size
        };
    }
}

module.exports = MessageCleanupService;
