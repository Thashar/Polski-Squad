const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class OcrBlockService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'ocr_blocked.json');
        this._state = { blockedCommands: [] };
        this._loadSync();
    }

    _loadSync() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(data);
            // Migracja starego formatu { blocked: true/false }
            if ('blocked' in parsed && !('blockedCommands' in parsed)) {
                this._state = { blockedCommands: parsed.blocked ? ['update', 'test'] : [] };
            } else {
                this._state = { blockedCommands: parsed.blockedCommands || [] };
            }
            if (this._state.blockedCommands.length > 0) {
                logger.warn(`⚠️ OCR zablokowane dla: ${this._state.blockedCommands.join(', ')}`);
            }
        } catch {
            this._state = { blockedCommands: [] };
        }
    }

    async _save() {
        await fsAsync.writeFile(this.filePath, JSON.stringify(this._state, null, 2), 'utf8');
    }

    isBlocked(command) {
        return this._state.blockedCommands.includes(command);
    }

    getBlockedCommands() {
        return [...this._state.blockedCommands];
    }

    async block(userId, userNick, commands) {
        const existing = new Set(this._state.blockedCommands);
        for (const cmd of commands) existing.add(cmd);
        this._state = {
            blockedCommands: [...existing],
            blockedAt: new Date().toISOString(),
            blockedBy: userId,
            blockedByNick: userNick
        };
        await this._save();
    }

    async unblock(userId, userNick, commands) {
        const existing = new Set(this._state.blockedCommands);
        for (const cmd of commands) existing.delete(cmd);
        this._state = {
            blockedCommands: [...existing],
            unblockedAt: new Date().toISOString(),
            unblockedBy: userId,
            unblockedByNick: userNick
        };
        await this._save();
    }
}

module.exports = OcrBlockService;
