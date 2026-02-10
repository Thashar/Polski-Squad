const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

/**
 * Knowledge Service - zarządzanie bazą wiedzy w JSON
 * Wpisy dodawane/usuwane przez reakcje ✅, zatwierdzane na kanale moderacji
 */
class KnowledgeService {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        this.knowledgeFile = path.join(this.dataDir, 'knowledge_base.json');
        this.pointsFile = path.join(this.dataDir, 'knowledge_points.json');
        this.entries = {};
        this.points = {}; // { "YYYY-MM": { "userId": { displayName, points } } }
    }

    async load() {
        try {
            const content = await fs.readFile(this.knowledgeFile, 'utf8');
            const data = JSON.parse(content);
            this.entries = data.entries || {};
            logger.info(`📂 Wczytano bazę wiedzy: ${this.getActiveCount()} aktywnych / ${Object.keys(this.entries).length} łącznie`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('📂 Brak bazy wiedzy - zostanie utworzona przy pierwszym wpisie');
            } else {
                logger.error(`❌ Błąd wczytywania bazy wiedzy: ${error.message}`);
            }
            this.entries = {};
        }

        // Wczytaj punkty
        try {
            const content = await fs.readFile(this.pointsFile, 'utf8');
            this.points = JSON.parse(content);
            const currentMonth = this.getCurrentMonth();
            const currentMonthData = this.points[currentMonth] || {};
            const usersCount = Object.keys(currentMonthData).length;
            logger.info(`📊 Wczytano punkty pomocy: ${usersCount} użytkowników w ${currentMonth}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`❌ Błąd wczytywania punktów: ${error.message}`);
            }
            this.points = {};
        }
    }

    async save() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.knowledgeFile, JSON.stringify({ entries: this.entries }, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisu bazy wiedzy: ${error.message}`);
        }
    }

    async savePoints() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.pointsFile, JSON.stringify(this.points, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisu punktów: ${error.message}`);
        }
    }

    getCurrentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Dodaj/odejmij punkty użytkownikowi
     * @param {string} userId
     * @param {string} displayName
     * @param {number} delta - ilość punktów (+1, -1, -2)
     */
    async addPoints(userId, displayName, delta) {
        const month = this.getCurrentMonth();
        if (!this.points[month]) this.points[month] = {};
        if (!this.points[month][userId]) {
            this.points[month][userId] = { displayName, points: 0 };
        }
        this.points[month][userId].displayName = displayName;
        this.points[month][userId].points += delta;
        await this.savePoints();
    }

    /**
     * Pobierz ranking dla danego miesiąca
     * @param {string} month - format "YYYY-MM"
     * @returns {{ userId: string, displayName: string, points: number }[]}
     */
    getRanking(month) {
        const monthData = this.points[month] || {};
        return Object.entries(monthData)
            .map(([userId, data]) => ({ userId, displayName: data.displayName, points: data.points }))
            .sort((a, b) => b.points - a.points);
    }

    /**
     * Pobierz punkty konkretnego użytkownika w danym miesiącu
     */
    getUserPoints(userId, month) {
        return this.points[month]?.[userId]?.points || 0;
    }

    /**
     * Pobierz dostępne miesiące (posortowane od najnowszego)
     */
    getAvailableMonths() {
        return Object.keys(this.points).sort().reverse();
    }

    /**
     * Dodaj wpis do bazy wiedzy
     * @returns {boolean} true jeśli dodano nowy wpis, false jeśli już istniał
     */
    async addEntry(messageId, content, author, reactedBy, reactedById) {
        if (this.entries[messageId]) return false;

        this.entries[messageId] = {
            content,
            author,
            date: new Date().toISOString().split('T')[0],
            reactedBy,
            reactedById,
            approvalMsgId: null,
            active: true,
            rating: 0
        };
        await this.save();
        return true;
    }

    /**
     * Usuń wpis z bazy wiedzy (przy usunięciu ✅ z oryginalnej wiadomości)
     * @param {string} messageId
     * @param {string} [userId] - jeśli podany, usuwa tylko jeśli to ta sama osoba co dodała
     * @returns {object|null} usunięty wpis lub null
     */
    async removeEntry(messageId, userId = null) {
        if (this.entries[messageId]) {
            // Sprawdź czy to ta sama osoba co dodała reakcję
            if (userId && this.entries[messageId].reactedById !== userId) {
                return null;
            }
            const entry = { ...this.entries[messageId] };
            delete this.entries[messageId];
            await this.save();
            return entry;
        }
        return null;
    }

    /**
     * Zapisz ID wiadomości na kanale zatwierdzania
     */
    async setApprovalMsgId(messageId, approvalMsgId) {
        if (this.entries[messageId]) {
            this.entries[messageId].approvalMsgId = approvalMsgId;
            await this.save();
        }
    }

    /**
     * ✅ na kanale zatwierdzania → deaktywuj wpis (usuń z wyszukiwania)
     */
    async deactivateByApproval(approvalMsgId) {
        for (const [msgId, entry] of Object.entries(this.entries)) {
            if (entry.approvalMsgId === approvalMsgId) {
                entry.active = false;
                await this.save();
                return { messageId: msgId, entry };
            }
        }
        return null;
    }

    /**
     * Usunięcie ✅ z kanału zatwierdzania → reaktywuj wpis (przywróć do wyszukiwania)
     */
    async reactivateByApproval(approvalMsgId) {
        for (const [msgId, entry] of Object.entries(this.entries)) {
            if (entry.approvalMsgId === approvalMsgId) {
                entry.active = true;
                await this.save();
                return { messageId: msgId, entry };
            }
        }
        return null;
    }

    /**
     * Pobierz aktywne wpisy jako tekst do przeszukiwania przez grep
     */
    getActiveEntriesText() {
        const active = Object.entries(this.entries)
            .filter(([_, e]) => e.active && e.rating > -5);

        if (active.length === 0) return '';

        return active
            .map(([_, e]) => {
                const prefix = e.isCorrection ? '[KOREKTA UŻYTKOWNIKA] ' : '';
                return `${prefix}[${e.date} | ${e.author}] ${e.content}`;
            })
            .join('\n\n');
    }

    getActiveCount() {
        return Object.values(this.entries).filter(e => e.active && e.rating > -5).length;
    }

    /**
     * Oceń wpisy na podstawie dopasowania fragmentów tekstu
     * @param {string[]} fragments - Fragmenty tekstu z wyników wyszukiwania
     * @param {boolean} isPositive - true = 👍, false = 👎
     */
    async rateEntries(fragments, isPositive) {
        const delta = isPositive ? 1 : -1;
        let rated = 0;

        for (const entry of Object.values(this.entries)) {
            if (!entry.active) continue;
            for (const fragment of fragments) {
                // Dopasuj po treści (pomijając nagłówek [data | autor])
                if (fragment.includes(entry.content.substring(0, 80))) {
                    entry.rating = (entry.rating || 0) + delta;
                    rated++;
                    break;
                }
            }
        }

        if (rated > 0) await this.save();
        return rated;
    }

    /**
     * Dodaj korektę jako wpis do bazy wiedzy (z syntetycznym ID)
     * @returns {string|null} ID wpisu lub null przy błędzie
     */
    async addCorrectionEntry(question, correction, authorName) {
        const correctionId = `correction_${Date.now()}`;
        const content = `Pytanie: ${question}\nOdpowiedź: ${correction}`;

        this.entries[correctionId] = {
            content,
            author: authorName,
            date: new Date().toISOString().split('T')[0],
            reactedBy: authorName,
            approvalMsgId: null,
            active: true,
            rating: 0,
            isCorrection: true
        };
        await this.save();
        logger.info(`📝 Korekta od ${authorName}: "${question.substring(0, 50)}..."`);
        return correctionId;
    }
}

module.exports = KnowledgeService;
