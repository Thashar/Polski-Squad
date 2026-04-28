const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class TesterService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'testers.json');
        this._testers = [];
        this._loadSync();
    }

    _loadSync() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            this._testers = JSON.parse(data);
            if (this._testers.length > 0) {
                logger.info(`🧪 Załadowano ${this._testers.length} testerów OCR`);
            }
        } catch {
            this._testers = [];
        }
    }

    async _save() {
        await fsAsync.writeFile(this.filePath, JSON.stringify(this._testers, null, 2), 'utf8');
    }

    isTester(userId) {
        return this._testers.some(t => t.userId === userId);
    }

    getTesters() {
        return [...this._testers];
    }

    async addTester(userId, addedBy) {
        if (this.isTester(userId)) return false;
        this._testers.push({ userId, addedBy, addedAt: new Date().toISOString() });
        await this._save();
        return true;
    }

    async removeTester(userId) {
        const before = this._testers.length;
        this._testers = this._testers.filter(t => t.userId !== userId);
        if (this._testers.length === before) return false;
        await this._save();
        return true;
    }
}

module.exports = TesterService;
