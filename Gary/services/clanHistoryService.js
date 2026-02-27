const fs = require('fs');
const path = require('path');

// Service for storing weekly snapshots of TOP500 clan rankings.
// Data is persisted in Gary/data/clan_history.json and survives bot restarts.
class ClanHistoryService {
    constructor(logger) {
        this.logger = logger;
        this.dataFile = path.join(__dirname, '../data/clan_history.json');
        this.MAX_SNAPSHOTS = 25; // Keep ~25 weeks of history (max 20 displayed)
        this.history = { snapshots: [] };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const raw = fs.readFileSync(this.dataFile, 'utf8');
                this.history = JSON.parse(raw);
                this.logger.info(`📊 ClanHistory: załadowano ${this.history.snapshots.length} snapshotów`);
            }
        } catch (err) {
            this.logger.error('ClanHistory: błąd wczytywania:', err.message);
            this.history = { snapshots: [] };
        }
    }

    _save() {
        try {
            const dir = path.dirname(this.dataFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.dataFile, JSON.stringify(this.history, null, 2), 'utf8');
        } catch (err) {
            this.logger.error('ClanHistory: błąd zapisu:', err.message);
        }
    }

    // ISO 8601 week number
    _getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    }

    /**
     * Save a snapshot of TOP500 clans.
     * @param {Array} clans - array of clan objects from clanAjaxService
     */
    saveSnapshot(clans) {
        const now = new Date();
        const weekNumber = this._getWeekNumber(now);
        const year = now.getFullYear();

        // Replace existing snapshot for the same week (idempotent)
        const existingIdx = this.history.snapshots.findIndex(
            s => s.weekNumber === weekNumber && s.year === year
        );

        const snapshot = {
            weekNumber,
            year,
            timestamp: now.toISOString(),
            clans: clans.map(c => ({
                id: c.id,
                name: c.name,
                rank: c.rank,
                score: c.score,
                level: c.level,
                grade: c.grade || ''
            }))
        };

        if (existingIdx >= 0) {
            this.history.snapshots[existingIdx] = snapshot;
            this.logger.info(`📊 ClanHistory: zaktualizowano snapshot tydz. ${weekNumber}/${year} (${clans.length} klanów)`);
        } else {
            this.history.snapshots.push(snapshot);
            this.logger.info(`📊 ClanHistory: zapisano snapshot tydz. ${weekNumber}/${year} (${clans.length} klanów)`);
        }

        // Sort chronologically and trim to MAX_SNAPSHOTS
        this.history.snapshots.sort((a, b) =>
            a.year !== b.year ? a.year - b.year : a.weekNumber - b.weekNumber
        );
        if (this.history.snapshots.length > this.MAX_SNAPSHOTS) {
            this.history.snapshots = this.history.snapshots.slice(-this.MAX_SNAPSHOTS);
        }

        this._save();
    }

    /**
     * Return weekly history for a clan by its numeric ID.
     * Returns at most 20 entries (last 20 weeks).
     * @param {number} clanId
     * @returns {Array<{weekNumber, year, score, rank, level, grade, name}>}
     */
    getClanHistory(clanId) {
        const result = [];
        for (const snapshot of this.history.snapshots) {
            const clan = snapshot.clans.find(c => c.id === clanId);
            if (clan) {
                result.push({
                    weekNumber: snapshot.weekNumber,
                    year: snapshot.year,
                    timestamp: snapshot.timestamp,
                    score: clan.score,
                    rank: clan.rank,
                    level: clan.level,
                    grade: clan.grade,
                    name: clan.name
                });
            }
        }
        return result.slice(-20);
    }

    /** Number of stored snapshots */
    getSnapshotCount() {
        return this.history.snapshots.length;
    }

    /** Latest snapshot timestamp or null */
    getLatestTimestamp() {
        if (this.history.snapshots.length === 0) return null;
        return this.history.snapshots[this.history.snapshots.length - 1].timestamp;
    }
}

module.exports = ClanHistoryService;
