'use strict';

const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

// Sesje starsze niż 30 dni są czyszczone przy starcie — ogłoszenie sprzed miesiąca
// i tak jest już nieaktualne, a plik nie może rosnąć w nieskończoność.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sesje cofania rekordu — jedno źródło prawdy dla WSZYSTKICH ścieżek cofnięcia:
 * przycisk gracza pod ogłoszeniem, przycisk admina w logu OCR, weryfikacja społeczności
 * i ręczna analiza admina.
 *
 * Struktura data/record_reverts.json:
 * {
 *   "sessions": {
 *     "<publicMsgId>": {
 *       guildId, playerKey, userId,
 *       previousRecord, newRecord: { timestamp, score, bossName },
 *       previousBossRecord, bossName, skipGlobalRevert,
 *       publicMsgId, publicChannelId,
 *       adminMsgId, adminChannelId,          // embed w kanale logów OCR (przycisk admina)
 *       status: "active" | "owner" | "admin" | "superseded",
 *       createdAt
 *     }
 *   },
 *   "latest": { "<playerKey>_<guildId>": "<publicMsgId>" }
 * }
 *
 * Klucz = ID publicznego ogłoszenia, bo to ono niesie przycisk gracza. Indeks `latest`
 * pilnuje reguły „cofnąć można wyłącznie OSTATNI rekord": starsze ogłoszenia dostają
 * status `superseded`, a ich przyciski są dezaktywowane.
 *
 * Persystencja jest konieczna — bez niej restart bota unieważniałby wszystkie przyciski
 * pod już opublikowanymi ogłoszeniami.
 */
class RecordRevertService {
    constructor(dataDir) {
        this._filePath = path.join(dataDir, 'record_reverts.json');
        this._sessions = {};
        this._latest = {};
        this._queue = Promise.resolve();
    }

    async load() {
        try {
            const raw = await fs.readFile(this._filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this._sessions = parsed.sessions || {};
            this._latest = parsed.latest || {};
            const removed = this._cleanup();
            const active = Object.values(this._sessions).filter(s => s.status === 'active').length;
            logger.info(`↩️ RecordRevert: ${active} aktywnych sesji cofnięcia${removed ? ` (usunięto ${removed} przeterminowanych)` : ''}`);
            if (removed) await this._save();
        } catch {
            this._sessions = {};
            this._latest = {};
        }
    }

    /** Usuwa sesje starsze niż MAX_AGE_MS. @returns {number} liczba usuniętych */
    _cleanup() {
        const cutoff = Date.now() - MAX_AGE_MS;
        let removed = 0;
        for (const [msgId, session] of Object.entries(this._sessions)) {
            const ts = new Date(session.createdAt || 0).getTime();
            if (!Number.isFinite(ts) || ts < cutoff) {
                delete this._sessions[msgId];
                removed++;
            }
        }
        for (const [key, msgId] of Object.entries(this._latest)) {
            if (!this._sessions[msgId]) delete this._latest[key];
        }
        return removed;
    }

    async _save() {
        const run = async () => {
            await fs.mkdir(path.dirname(this._filePath), { recursive: true });
            await fs.writeFile(
                this._filePath,
                JSON.stringify({ sessions: this._sessions, latest: this._latest }, null, 2),
                'utf8'
            );
        };
        this._queue = this._queue.then(run, run);
        return this._queue;
    }

    _latestKey(playerKey, guildId) {
        return `${playerKey}_${guildId}`;
    }

    /**
     * Rejestruje nowe ogłoszenie rekordu.
     * @returns {Promise<{ session: Object, previous: Object|null }>} previous = poprzednie
     *   ogłoszenie tego profilu (do dezaktywacji przycisku), już oznaczone jako `superseded`
     */
    async register({
        publicMsgId, publicChannelId, guildId, playerKey, userId,
        previousRecord = null, newRecord = null, previousBossRecord = null,
        bossName = null, skipGlobalRevert = false,
    }) {
        if (!publicMsgId) return { session: null, previous: null };

        const key = this._latestKey(playerKey, guildId);
        const prevMsgId = this._latest[key];
        let previous = null;
        if (prevMsgId && prevMsgId !== publicMsgId && this._sessions[prevMsgId]) {
            // Poprzedni rekord przestaje być cofalny — liczy się wyłącznie najnowszy
            if (this._sessions[prevMsgId].status === 'active') {
                this._sessions[prevMsgId].status = 'superseded';
                previous = this._sessions[prevMsgId];
            }
        }

        const session = {
            guildId,
            playerKey,
            userId,
            previousRecord,
            newRecord,
            previousBossRecord,
            bossName,
            skipGlobalRevert: skipGlobalRevert === true,
            publicMsgId,
            publicChannelId,
            adminMsgId: null,
            adminChannelId: null,
            status: 'active',
            createdAt: new Date().toISOString(),
        };
        this._sessions[publicMsgId] = session;
        this._latest[key] = publicMsgId;
        await this._save();
        return { session, previous };
    }

    /** Dopina referencję do embeda w kanale logów OCR (przycisk admina). */
    async attachAdminMessage(publicMsgId, adminMsgId, adminChannelId) {
        const session = this._sessions[publicMsgId];
        if (!session) return false;
        session.adminMsgId = adminMsgId;
        session.adminChannelId = adminChannelId;
        await this._save();
        return true;
    }

    get(publicMsgId) {
        return this._sessions[publicMsgId] || null;
    }

    /** Sesja ostatniego (jedynego cofalnego) rekordu danego profilu. */
    getLatest(playerKey, guildId) {
        const msgId = this._latest[this._latestKey(playerKey, guildId)];
        return msgId ? (this._sessions[msgId] || null) : null;
    }

    isLatest(publicMsgId) {
        const session = this._sessions[publicMsgId];
        if (!session) return false;
        return this._latest[this._latestKey(session.playerKey, session.guildId)] === publicMsgId;
    }

    /**
     * Oznacza rekord jako cofnięty.
     * @param {string} publicMsgId
     * @param {'owner'|'admin'|'profile_deleted'} by
     * @param {string|null} actorName
     * @returns {Promise<Object|null>} sesja albo null gdy nie istnieje
     */
    async markReverted(publicMsgId, by, actorName = null) {
        const session = this._sessions[publicMsgId];
        if (!session) return null;
        session.status = by;
        session.revertedBy = actorName;
        session.revertedAt = new Date().toISOString();
        await this._save();
        return session;
    }

    /**
     * Przepina sesje cofnięcia na nowy klucz profilu (przenumerowanie slotów) —
     * bez tego przycisk „Cofnij wynik" pod ogłoszeniem przestałby rozpoznawać właściciela.
     * @returns {Promise<number>} liczba przepiętych sesji
     */
    async renamePlayerKey(oldKey, newKey) {
        if (oldKey === newKey) return 0;
        let moved = 0;
        for (const session of Object.values(this._sessions)) {
            if (session.playerKey === oldKey) {
                session.playerKey = newKey;
                moved++;
            }
        }
        for (const key of Object.keys(this._latest)) {
            const sep = key.lastIndexOf('_');
            if (sep === -1) continue;
            if (key.slice(0, sep) !== oldKey) continue;
            this._latest[`${newKey}${key.slice(sep)}`] = this._latest[key];
            delete this._latest[key];
        }
        if (moved > 0) await this._save();
        return moved;
    }

    /** Oznacza jako cofniętą sesję ostatniego rekordu profilu (ścieżki bez ID ogłoszenia). */
    async markLatestReverted(playerKey, guildId, by, actorName = null) {
        const msgId = this._latest[this._latestKey(playerKey, guildId)];
        if (!msgId) return null;
        return this.markReverted(msgId, by, actorName);
    }

    /** Statystyka do Centrum Dowodzenia. */
    getActiveCount() {
        return Object.values(this._sessions).filter(s => s.status === 'active').length;
    }
}

module.exports = RecordRevertService;
