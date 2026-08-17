const path = require('path');
const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
const DATA_FILE = path.join(__dirname, '../data/notification_preferences.json');

class NotificationPreferencesService {
    constructor() {
        this.globalEnabled = true;
        this.optedOut = new Set();
    }

    async load() {
        try {
            const data = await store.getOrLoad(DATA_FILE, () => ({ globalEnabled: true, optedOut: [] }));
            this.globalEnabled = data.globalEnabled !== false; // domyślnie true
            this.optedOut = new Set(data.optedOut || []);
            logger.info(`[NOTIF_PREFS] Wczytano preferencje - globalne: ${this.globalEnabled ? 'włączone' : 'wyłączone'}, ${this.optedOut.size} użytkowników z wyłączonymi powiadomieniami`);
        } catch (err) {
            // Brak pliku obsługuje store, więc tu trafiają realne błędy odczytu
            logger.error(`[NOTIF_PREFS] Błąd wczytywania preferencji: ${err.message}`);
            this.globalEnabled = true;
            this.optedOut = new Set();
        }
    }

    async save() {
        try {
            await store.set(DATA_FILE, {
                globalEnabled: this.globalEnabled,
                optedOut: [...this.optedOut]
            });
        } catch (err) {
            logger.error(`[NOTIF_PREFS] Błąd zapisywania preferencji: ${err.message}`);
        }
    }

    isGlobalEnabled() {
        return this.globalEnabled;
    }

    async toggleGlobal() {
        this.globalEnabled = !this.globalEnabled;
        await this.save();
        return this.globalEnabled;
    }

    isOptedOut(userId) {
        return this.optedOut.has(userId);
    }

    async optOut(userId) {
        this.optedOut.add(userId);
        await this.save();
    }

    async optIn(userId) {
        this.optedOut.delete(userId);
        await this.save();
    }
}

module.exports = NotificationPreferencesService;
