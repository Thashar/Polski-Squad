const fs = require('fs').promises;
const path = require('path');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');
const SHARED_DATA_PATH = path.join(__dirname, '../../shared_data/clan_thresholds.json');

async function exportClanThresholds(guild, databaseService, config) {
    try {
        const allWeeks = await databaseService.getAvailableWeeks(guild.id);
        if (allWeeks.length === 0) {
            logger.info('[THRESHOLDS] Brak tygodni z danymi — pomijam eksport');
            return;
        }

        const last54Weeks = allWeeks.slice(0, 54);

        // Zbierz najwyższy wynik każdego gracza (taka sama logika jak createGlobalPlayerRanking)
        const playerMaxScores = new Map();
        for (const week of last54Weeks) {
            for (const clan of week.clans) {
                const weekData = await databaseService.getPhase1Results(
                    guild.id, week.weekNumber, week.year, clan
                );
                if (weekData?.players) {
                    for (const player of weekData.players) {
                        if (player.userId && player.score > 0) {
                            const current = playerMaxScores.get(player.userId) || 0;
                            if (player.score > current) {
                                playerMaxScores.set(player.userId, player.score);
                            }
                        }
                    }
                }
            }
        }

        // Dla każdego klanu: minimum maxScore wśród aktywnych członków
        const members = await safeFetchMembers(guild, logger);
        const thresholds = {};

        for (const [clanKey, roleId] of Object.entries(config.targetRoles)) {
            const scores = [];
            for (const [memberId, member] of members) {
                if (member.roles.cache.has(roleId)) {
                    const score = playerMaxScores.get(memberId);
                    if (score && score > 0) scores.push(score);
                }
            }
            // null gdy klan nie ma żadnych graczy z wynikami
            thresholds[clanKey] = scores.length > 0 ? Math.min(...scores) : null;
        }

        // Zachowaj dane innych gildii (jeśli plik istnieje)
        let existing = {};
        try {
            const raw = await fs.readFile(SHARED_DATA_PATH, 'utf8');
            existing = JSON.parse(raw);
        } catch { /* plik nie istnieje — zaczynamy od zera */ }

        existing[guild.id] = { ...thresholds, updatedAt: new Date().toISOString() };

        await fs.writeFile(SHARED_DATA_PATH, JSON.stringify(existing, null, 2), 'utf8');
        logger.info(`[THRESHOLDS] ✅ Progi klanowe zaktualizowane: ${JSON.stringify(thresholds)}`);

    } catch (err) {
        logger.error('[THRESHOLDS] ❌ Błąd eksportu progów:', err.message);
    }
}

module.exports = { exportClanThresholds };
