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
    }

    /**
     * Wczytuje dane nagród z pliku
     */
    async loadRewards() {
        try {
            const data = await fs.readFile(this.dataPath, 'utf8');

            if (!data || data.trim() === '') {
                this.users = {};
                return;
            }

            const parsed = JSON.parse(data);
            this.users = parsed.users || {};

            logger.info(`🎁 Wczytano statystyki nagród dla ${Object.keys(this.users).length} użytkowników`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.users = {};
            } else {
                logger.error('❌ Błąd podczas wczytywania nagród:', error);
                this.users = {};
            }
        }
    }

    /**
     * Zapisuje dane nagród do pliku
     */
    async saveRewards() {
        try {
            await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
            await fs.writeFile(this.dataPath, JSON.stringify({ users: this.users }, null, 2));
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
     * Dolicza nagrodę na konto użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @param {string} rewardKey - Klucz nagrody
     * @returns {Object|null} - Zaktualizowane statystyki użytkownika lub null gdy nagroda nieznana
     */
    async addReward(userId, displayName, rewardKey) {
        const reward = this.getRewardDefinition(rewardKey);
        if (!reward) return null;

        if (!this.users[userId]) {
            this.users[userId] = {
                displayName: displayName,
                rewards: {},
                total: 0,
                lastReward: null
            };
        }

        const userStats = this.users[userId];
        userStats.displayName = displayName;
        userStats.rewards[rewardKey] = (userStats.rewards[rewardKey] || 0) + 1;
        userStats.total = Object.values(userStats.rewards).reduce((sum, count) => sum + count, 0);
        userStats.lastReward = Date.now();

        await this.saveRewards();

        return userStats;
    }

    /**
     * Koryguje liczbę nagród użytkownika (komenda /correct dla administratorów)
     * @param {string} userId - ID użytkownika
     * @param {string} displayName - Nazwa użytkownika na serwerze
     * @param {string} rewardKey - Klucz nagrody
     * @param {number} delta - Zmiana liczby nagród (dodatnia = dodaj, ujemna = usuń)
     * @returns {Object|null} - { reward, previous, current, applied } lub null gdy nagroda nieznana
     */
    async correctReward(userId, displayName, rewardKey, delta) {
        const reward = this.getRewardDefinition(rewardKey);
        if (!reward) return null;

        if (!this.users[userId]) {
            this.users[userId] = {
                displayName: displayName,
                rewards: {},
                total: 0,
                lastReward: null
            };
        }

        const userStats = this.users[userId];
        userStats.displayName = displayName;

        const previous = userStats.rewards[rewardKey] || 0;
        const current = Math.max(0, previous + delta);

        if (current === 0) {
            delete userStats.rewards[rewardKey];
        } else {
            userStats.rewards[rewardKey] = current;
        }

        userStats.total = Object.values(userStats.rewards).reduce((sum, count) => sum + count, 0);

        await this.saveRewards();

        return {
            reward,
            previous,
            current,
            applied: current - previous // Ile faktycznie zmieniono (może być mniej niż delta przy odejmowaniu)
        };
    }

    /**
     * Pobiera statystyki pojedynczego użytkownika
     * @param {string} userId - ID użytkownika
     * @returns {Object|null} - Statystyki lub null
     */
    getUserStats(userId) {
        return this.users[userId] || null;
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
