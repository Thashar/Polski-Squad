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
        this.correctionsFile = path.join(this.dataDir, 'knowledge_corrections.md');
        this.entries = {};
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
    }

    async save() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.knowledgeFile, JSON.stringify({ entries: this.entries }, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisu bazy wiedzy: ${error.message}`);
        }
    }

    /**
     * Dodaj wpis do bazy wiedzy
     * @returns {boolean} true jeśli dodano nowy wpis, false jeśli już istniał
     */
    async addEntry(messageId, content, author, reactedBy) {
        if (this.entries[messageId]) return false;

        this.entries[messageId] = {
            content,
            author,
            date: new Date().toISOString().split('T')[0],
            reactedBy,
            approvalMsgId: null,
            active: true,
            rating: 0
        };
        await this.save();
        return true;
    }

    /**
     * Usuń wpis z bazy wiedzy (przy usunięciu ✅ z oryginalnej wiadomości)
     */
    async removeEntry(messageId) {
        if (this.entries[messageId]) {
            delete this.entries[messageId];
            await this.save();
            return true;
        }
        return false;
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
            .map(([_, e]) => `[${e.date} | ${e.author}] ${e.content}`)
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
     * Zapisz korektę od użytkownika (👎 + poprawna odpowiedź)
     */
    async saveCorrection(question, correction, authorName) {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            let currentContent = '';
            try {
                currentContent = await fs.readFile(this.correctionsFile, 'utf-8');
            } catch (err) {
                currentContent = '';
            }

            const dateStr = new Date().toISOString().split('T')[0];
            const separator = currentContent.trim() ? '\n\n' : '';
            const entry = `${separator}[${dateStr} | ${authorName}] Pytanie: ${question} Odpowiedź: ${correction}`;

            await fs.writeFile(this.correctionsFile, currentContent + entry, 'utf-8');
            logger.info(`📝 Korekta od ${authorName}: "${question.substring(0, 50)}..."`);
        } catch (error) {
            logger.error(`❌ Błąd zapisu korekty: ${error.message}`);
        }
    }

    /**
     * Wczytaj plik korekt
     */
    async loadCorrections() {
        try {
            return await fs.readFile(this.correctionsFile, 'utf8');
        } catch (error) {
            return '';
        }
    }
}

module.exports = KnowledgeService;
