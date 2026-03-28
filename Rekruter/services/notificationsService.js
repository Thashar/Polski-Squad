const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
const DATA_FILE = path.join(__dirname, '../data/notifications_disabled.json');

class NotificationsService {
    constructor() {
        this.disabledUsers = new Set();
        this._loaded = false;
    }

    async load() {
        try {
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            const data = JSON.parse(raw);
            this.disabledUsers = new Set(data.disabledUsers || []);
            this._loaded = true;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.error('[NOTIFICATIONS] ❌ Błąd odczytu pliku:', err);
            }
            this.disabledUsers = new Set();
            this._loaded = true;
        }
    }

    async _save() {
        try {
            await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
            await fs.writeFile(DATA_FILE, JSON.stringify({ disabledUsers: [...this.disabledUsers] }, null, 2), 'utf8');
        } catch (err) {
            logger.error('[NOTIFICATIONS] ❌ Błąd zapisu pliku:', err);
        }
    }

    isDisabled(userId) {
        return this.disabledUsers.has(userId);
    }

    async setDisabled(userId, disabled) {
        if (disabled) {
            this.disabledUsers.add(userId);
        } else {
            this.disabledUsers.delete(userId);
        }
        await this._save();
    }

    getAll() {
        return [...this.disabledUsers];
    }
}

module.exports = NotificationsService;
