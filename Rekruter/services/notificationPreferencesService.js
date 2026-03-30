const fs = require('fs').promises;
const path = require('path');
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
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            const data = JSON.parse(raw);
            this.globalEnabled = data.globalEnabled !== false; // domyślnie true
            this.optedOut = new Set(data.optedOut || []);
            logger.info(`[NOTIF_PREFS] Wczytano preferencje - globalne: ${this.globalEnabled ? 'włączone' : 'wyłączone'}, ${this.optedOut.size} użytkowników z wyłączonymi powiadomieniami`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.error(`[NOTIF_PREFS] Błąd wczytywania preferencji: ${err.message}`);
            }
            this.globalEnabled = true;
            this.optedOut = new Set();
        }
    }

    async save() {
        try {
            await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
            await fs.writeFile(DATA_FILE, JSON.stringify({
                globalEnabled: this.globalEnabled,
                optedOut: [...this.optedOut]
            }, null, 2));
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
