const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class OcrBlockService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'ocr_blocked.json');
        this._state = { blocked: false };
        this._loadSync();
    }

    _loadSync() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            this._state = JSON.parse(data);
            if (this._state.blocked) {
                logger.warn(`⚠️ OCR zablokowane (od: ${this._state.blockedAt}, przez: ${this._state.blockedByNick})`);
            }
        } catch {
            this._state = { blocked: false };
        }
    }

    async _save() {
        await fsAsync.writeFile(this.filePath, JSON.stringify(this._state, null, 2), 'utf8');
    }

    isBlocked() {
        return this._state.blocked === true;
    }

    async block(userId, userNick) {
        this._state = {
            blocked: true,
            blockedAt: new Date().toISOString(),
            blockedBy: userId,
            blockedByNick: userNick
        };
        await this._save();
    }

    async unblock(userId, userNick) {
        this._state = {
            blocked: false,
            unblockedAt: new Date().toISOString(),
            unblockedBy: userId,
            unblockedByNick: userNick
        };
        await this._save();
    }
}

module.exports = OcrBlockService;
