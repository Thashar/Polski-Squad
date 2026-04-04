const fs = require('fs').promises;
const path = require('path');
const { safeParse } = require('../../utils/safeJSON');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOTHING_IN_WEEK = 3;

class ReportStatsService {
    constructor() {
        this.dataFile = path.join(__dirname, '../data/report_stats.json');
        this.stats = {};
    }

    async initialize() {
        try {
            await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
            try {
                const data = await fs.readFile(this.dataFile, 'utf8');
                this.stats = safeParse(data, {});
            } catch {
                this.stats = {};
            }
        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji ReportStatsService: ${error.message}`);
        }
    }

    async save() {
        try {
            await fs.writeFile(this.dataFile, JSON.stringify(this.stats, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisu statystyk zgłoszeń: ${error.message}`);
        }
    }

    ensureUser(userId) {
        if (!this.stats[userId]) {
            this.stats[userId] = {
                totalReports: 0,
                effectiveReports: 0,
                nothingReports: 0,
                nothingTimestamps: [],
                bannedUntil: null
            };
        }
    }

    /**
     * Sprawdza czy użytkownik ma blokadę zgłoszeń.
     * @returns {{ banned: true, bannedUntil: number } | { banned: false }}
     */
    checkBan(userId) {
        this.ensureUser(userId);
        const user = this.stats[userId];
        if (!user.bannedUntil) return { banned: false };
        if (Date.now() >= user.bannedUntil) {
            user.bannedUntil = null;
            this.save().catch(() => {});
            return { banned: false };
        }
        return { banned: true, bannedUntil: user.bannedUntil };
    }

    /**
     * Rejestruje nowe zgłoszenie.
     */
    async recordReport(userId) {
        this.ensureUser(userId);
        this.stats[userId].totalReports++;
        await this.save();
    }

    /**
     * Rejestruje skuteczne zgłoszenie (warn/mute/delete) i zeruje licznik "nie rób nic".
     */
    async recordEffective(userId) {
        if (!userId) return;
        this.ensureUser(userId);
        this.stats[userId].effectiveReports++;
        this.stats[userId].nothingTimestamps = [];
        await this.save();
    }

    /**
     * Rejestruje zgłoszenie zakończone "nie rób nic".
     * Jeśli osiągnie MAX_NOTHING_IN_WEEK w tygodniu → blokada na tydzień.
     * @returns {{ banned: boolean, bannedUntil?: number, nothingInWeek?: number }}
     */
    async recordNothing(userId) {
        if (!userId) return { banned: false };
        this.ensureUser(userId);

        const now = Date.now();
        this.stats[userId].nothingReports++;

        // Dodaj timestamp i usuń starsze niż tydzień
        this.stats[userId].nothingTimestamps.push(now);
        this.stats[userId].nothingTimestamps = this.stats[userId].nothingTimestamps.filter(
            t => now - t < WEEK_MS
        );

        if (this.stats[userId].nothingTimestamps.length >= MAX_NOTHING_IN_WEEK) {
            this.stats[userId].bannedUntil = now + WEEK_MS;
            this.stats[userId].nothingTimestamps = [];
            await this.save();
            return { banned: true, bannedUntil: this.stats[userId].bannedUntil };
        }

        await this.save();
        return {
            banned: false,
            nothingInWeek: this.stats[userId].nothingTimestamps.length
        };
    }

    getStats(userId) {
        this.ensureUser(userId);
        return { ...this.stats[userId] };
    }
}

module.exports = ReportStatsService;
