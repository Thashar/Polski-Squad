const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

/**
 * Zarządza sesjami weryfikacji społeczności.
 *
 * Sesja tworzona jest po opublikowaniu nowego rekordu (gdy funkcja włączona w konfiguracji serwera).
 * Pod embedem rekordu pojawia się przycisk "⚠️ Zgłoś". Głosować mogą wyłącznie gracze obecni w rankingu.
 * Po osiągnięciu progu zgłoszeń: użytkownik blokowany na 24h + raport na kanał(y) rejected.
 * Sesja wygasa gdy gracz pobije rekord ponownie — stary przycisk jest wtedy usuwany.
 */
class CommunityVerificationService {
    constructor(dataDir) {
        this._filePath = path.join(dataDir, 'community_votes.json');
        this._sessions = {};
        this._loadPromise = this._load();
    }

    async _load() {
        try {
            const raw = await fsAsync.readFile(this._filePath, 'utf8');
            this._sessions = JSON.parse(raw);
            const count = Object.keys(this._sessions).length;
            if (count > 0) logger.info(`🗳️ CommunityVerification: załadowano ${count} sesji`);
        } catch {
            this._sessions = {};
        }
    }

    async _save() {
        await fsAsync.writeFile(this._filePath, JSON.stringify(this._sessions, null, 2), 'utf8');
    }

    /**
     * Tworzy nową sesję głosowania po opublikowaniu rekordu.
     * @param {Object} opts
     * @param {string} opts.guildId
     * @param {string} opts.userId
     * @param {string} opts.messageId - ID publicznej wiadomości z rekordem
     * @param {string} opts.channelId
     * @param {string} opts.messageUrl
     * @param {Object|null} opts.previousRecord - poprzedni rekord gracza (null = brak)
     * @param {Object} opts.newRecord - { score, bossName, timestamp }
     * @param {string[]} opts.newAchievements - ID osiągnięć zdobytych tym rekordem
     */
    async createSession({ guildId, userId, messageId, channelId, messageUrl, previousRecord, newRecord, newAchievements }) {
        await this._loadPromise;
        this._sessions[messageId] = {
            guildId,
            userId,
            channelId,
            messageUrl,
            previousRecord: previousRecord || null,
            newRecord,
            newAchievements: newAchievements || [],
            voters: [],
            count: 0,
            status: 'pending',
            rejectedMsgIds: [],
            createdAt: new Date().toISOString(),
        };
        await this._save();
    }

    /**
     * Zwraca wszystkie aktywne (pending) sesje dla danego userId+guildId.
     */
    getPendingSessionsForUser(userId, guildId) {
        return Object.entries(this._sessions)
            .filter(([, s]) => s.userId === userId && s.guildId === guildId && s.status === 'pending')
            .map(([msgId, s]) => ({ messageId: msgId, ...s }));
    }

    /**
     * Pobiera sesję po messageId.
     */
    getSession(messageId) {
        const s = this._sessions[messageId];
        return s ? { messageId, ...s } : null;
    }

    /**
     * Rejestruje głos (zgłoszenie) od voterId.
     * @param {string} messageId
     * @param {string} voterId
     * @param {{ allowSelf?: boolean }} [opts] allowSelf — pozwala właścicielowi rekordu zgłosić własny wynik (head admin, tryb testowy CV)
     * @returns {{ invalid?: boolean, alreadyVoted?: boolean, isSelf?: boolean, count?: number, triggered?: boolean }}
     */
    async registerVote(messageId, voterId, { allowSelf = false } = {}) {
        await this._loadPromise;
        const session = this._sessions[messageId];
        if (!session || session.status !== 'pending') return { invalid: true };
        if (session.userId === voterId && !allowSelf) return { isSelf: true };
        if (session.voters.includes(voterId)) return { alreadyVoted: true };

        session.voters.push(voterId);
        session.count += 1;
        await this._save();

        return { count: session.count, triggered: false };
    }

    /**
     * Oznacza sesję jako triggered (próg osiągnięty) i zapisuje ID wiadomości raportów.
     */
    async markTriggered(messageId, rejectedMsgIds) {
        await this._loadPromise;
        const session = this._sessions[messageId];
        if (!session) return;
        session.status = 'triggered';
        session.rejectedMsgIds = rejectedMsgIds || [];
        session.triggeredAt = new Date().toISOString();
        await this._save();
    }

    /**
     * Zamyka sesję z podanym statusem (approved / removed / blocked).
     */
    async closeSession(messageId, status) {
        await this._loadPromise;
        const session = this._sessions[messageId];
        if (!session) return;
        session.status = status;
        session.closedAt = new Date().toISOString();
        await this._save();
    }

    /**
     * Zamyka wszystkie pending sesje gracza na danym serwerze (gdy pobił nowy rekord).
     * Zwraca listę zamkniętych sessionId (messageId).
     */
    async expireUserSessions(userId, guildId) {
        await this._loadPromise;
        const expired = [];
        for (const [msgId, session] of Object.entries(this._sessions)) {
            if (session.userId === userId && session.guildId === guildId && session.status === 'pending') {
                session.status = 'expired';
                session.closedAt = new Date().toISOString();
                expired.push(msgId);
            }
        }
        if (expired.length > 0) await this._save();
        return expired;
    }

    /**
     * Sprawdza czy głosujący jest w rankingu serwera (sesji).
     * @param {Object} rankingService
     * @param {string} guildId
     * @param {string} voterId
     */
    async isVoterInRanking(rankingService, guildId, voterId) {
        try {
            const ranking = await rankingService.loadRanking(guildId);
            return !!ranking[voterId];
        } catch {
            return false;
        }
    }
}

module.exports = CommunityVerificationService;
