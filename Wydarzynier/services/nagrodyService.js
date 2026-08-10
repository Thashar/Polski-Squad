const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

/**
 * Serwis zliczania nagród specjalnych (czerwonych skrzynek) zdobytych w party
 */
class NagrodyService {
    constructor(config) {
        this.config = config;
        this.dataPath = path.join(__dirname, '../data/nagrody.json');
        this.users = {}; // userId -> { displayName, rewards: { key: count }, total, lastReward }
        this.claims = {}; // messageId pytania -> [userId] - kto już zgłosił nagrodę w danym losowaniu
        this.maxClaimEntries = 200; // Limit zapamiętanych losowań
    }

    /**
     * Wczytuje dane nagród z pliku
     */
    async loadRewards() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');

            if (!data || data.trim() === '') {
                this.users = {};
                this.claims = {};
                return;
            }

            const parsed = JSON.parse(data);
            this.users = parsed.users || {};
            this.claims = parsed.claims || {};

            logger.info(`🎁 Wczytano statystyki nagród dla ${Object.keys(this.users).length} użytkowników`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.users = {};
                this.claims = {};
            } else {
                logger.error('❌ Błąd podczas wczytywania nagród:', error);
                this.users = {};
                this.claims = {};
            }
        }
    }

    /**
     * Zapisuje dane nagród do pliku
     */
    async saveRewards() {
        try {
            await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
            await fs.writeFile(this.dataPath, JSON.stringify({ users: this.users, claims: this.claims }, null, 2));
        } catch (error) {
            logger.error('❌ Błąd podczas zapisywania nagród:', error);
        }
    }

    /**
     * Pobiera definicję nagrody po kluczu
     * @param {string} rewardKey - Klucz nagrody
     * @returns {Object|null} - Definicja nagrody lub null
     */
    getRewardDefinition(rewardKey) {
        return this.config.rewards.find(reward => reward.key === rewardKey) || null;
    }

    /**
     * Sprawdza czy użytkownik zgłosił już nagrodę w danym losowaniu
     * @param {string} promptMessageId - ID wiadomości z pytaniem o nagrodę
     * @param {string} userId - ID użytkownika
     * @returns {boolean} - Czy użytkownik już zgłosił nagrodę
     */
    hasClaimed(promptMessageId, userId) {
        return (this.claims[promptMessageId] || []).includes(userId);
    }

    /**
     * Rezerwuje zgłoszenie nagrody dla użytkownika w danym losowaniu.
     * Synchroniczne - zapobiega podwójnemu zgłoszeniu z dwóch otwartych ephemerali.
     * @param {string} promptMessageId - ID wiadomości z pytaniem o nagrodę
     * @param {string} userId - ID użytkownika
     * @returns {boolean} - false gdy użytkownik już zgłosił nagrodę w tym losowaniu
     */
    tryRegisterClaim(promptMessageId, userId) {
        if (this.hasClaimed(promptMessageId, userId)) return false;

        if (!this.claims[promptMessageId]) {
            this.claims[promptMessageId] = [];

            // Usuń najstarsze losowania gdy przekroczono limit
            const messageIds = Object.keys(this.claims);
            if (messageIds.length > this.maxClaimEntries) {
                messageIds
                    .slice(0, messageIds.length - this.maxClaimEntries)
                    .forEach(oldId => delete this.claims[oldId]);
            }
        }

        this.claims[promptMessageId].push(userId);
        return true;
    }

    /**
     * Cofa rezerwację zgłoszenia (gdy doliczenie nagrody się nie powiodło)
     * @param {string} promptMessageId - ID wiadomości z pytaniem o nagrodę
     * @param {string} userId - ID użytkownika
     */
    releaseClaim(promptMessageId, userId) {
        const claimedUsers = this.claims[promptMessageId];
        if (!claimedUsers) return;

        const index = claimedUsers.indexOf(userId);
        if (index > -1) claimedUsers.splice(index, 1);

        if (claimedUsers.length === 0) delete this.claims[promptMessageId];
    }

    /**
     * Zapewnia istnienie wpisu użytkownika i aktualizuje jego nick
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @returns {Object} - Wpis użytkownika
     */
    ensureUser(userId, displayName) {
        if (!this.users[userId]) {
            this.users[userId] = {
                displayName: displayName,
                rewards: {},        // Nagrody z systemu Party (liczone do rankingu /stats)
                total: 0,
                manualRewards: {},  // Nagrody dodane samodzielnie przez /add_reward (poza rankingiem)
                manualTotal: 0,
                lastReward: null
            };
        }

        const userStats = this.users[userId];
        userStats.displayName = displayName;

        // Uzupełnij pola dla wpisów sprzed wprowadzenia nagród własnych
        if (!userStats.rewards) userStats.rewards = {};
        if (!userStats.manualRewards) userStats.manualRewards = {};
        if (typeof userStats.manualTotal !== 'number') userStats.manualTotal = 0;

        return userStats;
    }

    /**
     * Przelicza sumy nagród użytkownika
     * @param {Object} userStats - Wpis użytkownika
     */
    recalculateTotals(userStats) {
        userStats.total = Object.values(userStats.rewards).reduce((sum, count) => sum + count, 0);
        userStats.manualTotal = Object.values(userStats.manualRewards).reduce((sum, count) => sum + count, 0);
    }

    /**
     * Dolicza nagrodę z systemu Party na konto użytkownika (liczy się do rankingu)
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @param {string} rewardKey - Klucz nagrody
     * @returns {Object|null} - Zaktualizowane statystyki użytkownika lub null gdy nagroda nieznana
     */
    async addReward(userId, displayName, rewardKey) {
        const reward = this.getRewardDefinition(rewardKey);
        if (!reward) return null;

        const userStats = this.ensureUser(userId, displayName);
        userStats.rewards[rewardKey] = (userStats.rewards[rewardKey] || 0) + 1;
        userStats.lastReward = Date.now();
        this.recalculateTotals(userStats);

        await this.saveRewards();

        return userStats;
    }

    /**
     * Koryguje liczbę nagród użytkownika.
     * Używane przez /correct (administrator, dowolny gracz) oraz /add_reward
     * (użytkownik, wyłącznie własne nagrody spoza rankingu).
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @param {string} rewardKey - Klucz nagrody
     * @param {number} delta - Zmiana liczby nagród (dodatnia = dodaj, ujemna = usuń)
     * @param {string} source - 'party' (domyślnie, liczy się do rankingu) lub 'manual' (nagrody własne)
     * @returns {Object|null} - { reward, previous, current, applied, source } lub null gdy nagroda nieznana
     */
    async correctReward(userId, displayName, rewardKey, delta, source = 'party') {
        const reward = this.getRewardDefinition(rewardKey);
        if (!reward) return null;

        const userStats = this.ensureUser(userId, displayName);
        const bucket = source === 'manual' ? userStats.manualRewards : userStats.rewards;

        const previous = bucket[rewardKey] || 0;
        const current = Math.max(0, previous + delta);

        if (current === 0) {
            delete bucket[rewardKey];
        } else {
            bucket[rewardKey] = current;
        }

        this.recalculateTotals(userStats);

        await this.saveRewards();

        return {
            reward,
            previous,
            current,
            applied: current - previous, // Ile faktycznie zmieniono (może być mniej niż delta przy odejmowaniu)
            source
        };
    }

    /**
     * Pobiera statystyki pojedynczego użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - Statystyki lub null
     */
    getUserStats(userId) {
        const userStats = this.users[userId];
        if (!userStats) return null;

        return {
            displayName: userStats.displayName || 'Nieznany',
            rewards: userStats.rewards || {},
            total: userStats.total || 0,
            manualRewards: userStats.manualRewards || {},
            manualTotal: userStats.manualTotal || 0
        };
    }

    /**
     * Pobiera ranking wszystkich użytkowników posortowany po liczbie nagród
     * @returns {Array} - Lista { userId, displayName, rewards, total }
     */
    getRanking() {
        return Object.entries(this.users)
            .map(([userId, stats]) => ({
                userId,
                displayName: stats.displayName || 'Nieznany',
                rewards: stats.rewards || {},
                total: stats.total || 0
            }))
            .filter(entry => entry.total > 0)
            .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));
    }

    /**
     * Zlicza wszystkie przyznane nagrody wg typu
     * @returns {Object} - { rewardKey: count }
     */
    getTotalsByReward() {
        const totals = {};

        for (const stats of Object.values(this.users)) {
            for (const [rewardKey, count] of Object.entries(stats.rewards || {})) {
                totals[rewardKey] = (totals[rewardKey] || 0) + count;
            }
        }

        return totals;
    }
}

module.exports = NagrodyService;
