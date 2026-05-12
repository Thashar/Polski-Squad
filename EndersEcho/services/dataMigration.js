const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

async function migrate(dataDir) {
    try {
        const files = await fs.readdir(dataDir).catch(() => []);

        const guildIds = new Set();
        for (const file of files) {
            const m = file.match(/^(?:ranking|achievements|role_rankings|score_history)_(\d+)\.json$/);
            if (m) guildIds.add(m[1]);
        }

        if (guildIds.size === 0) return;

        logger.info(`🔄 Migracja struktury danych: ${guildIds.size} serwer(ów) do przeniesienia...`);

        for (const guildId of guildIds) {
            const guildDir = path.join(dataDir, 'guilds', guildId);
            const wynikiDir = path.join(guildDir, 'wyniki');
            await fs.mkdir(wynikiDir, { recursive: true });

            await _migrateFile(
                path.join(dataDir, `ranking_${guildId}.json`),
                path.join(guildDir, 'ranking.json'),
                guildId
            );
            await _migrateFile(
                path.join(dataDir, `achievements_${guildId}.json`),
                path.join(guildDir, 'achievements.json'),
                guildId
            );
            await _migrateFile(
                path.join(dataDir, `role_rankings_${guildId}.json`),
                path.join(guildDir, 'role_rankings.json'),
                guildId
            );
            await _migrateScoreHistory(
                path.join(dataDir, `score_history_${guildId}.json`),
                wynikiDir,
                guildId
            );
        }

        logger.info('✅ Migracja struktury danych zakończona');
    } catch (err) {
        logger.error(`❌ Błąd podczas migracji danych: ${err.message}`);
    }
}

async function _migrateFile(src, dst, guildId) {
    try { await fs.access(src); } catch { return; }

    try {
        await fs.access(dst);
        // Plik docelowy już istnieje — usuń źródło (idempotentność)
        await fs.unlink(src);
        return;
    } catch { /* nie istnieje — kontynuuj */ }

    const content = await fs.readFile(src, 'utf8');
    await fs.writeFile(dst, content, 'utf8');
    await fs.unlink(src);
    logger.info(`  ↳ ${path.basename(src)} → guilds/${guildId}/${path.basename(dst)}`);
}

async function _migrateScoreHistory(src, wynikiDir, guildId) {
    try { await fs.access(src); } catch { return; }

    let data;
    try {
        const raw = await fs.readFile(src, 'utf8');
        data = JSON.parse(raw);
    } catch {
        await fs.unlink(src).catch(() => {});
        return;
    }

    const userIds = Object.keys(data);
    if (userIds.length === 0) {
        await fs.unlink(src);
        return;
    }

    let migrated = 0;
    for (const userId of userIds) {
        const dst = path.join(wynikiDir, `${userId}.json`);
        try { await fs.access(dst); continue; } catch { /* nie istnieje — pisz */ }
        const entries = Array.isArray(data[userId]) ? data[userId] : [];
        await fs.writeFile(dst, JSON.stringify(entries, null, 2), 'utf8');
        migrated++;
    }

    await fs.unlink(src);
    logger.info(`  ↳ score_history_${guildId}.json → guilds/${guildId}/wyniki/ (${migrated} graczy)`);
}

/**
 * Tworzy pliki historii wyników (wyniki/{userId}.json) dla graczy,
 * którzy istnieją w ranking.json ale nie mają jeszcze pliku historii.
 * Idempotentne — bezpieczne przy wielokrotnym uruchomieniu.
 * @param {string} dataDir  np. EndersEcho/data
 */
async function backfillScoreHistory(dataDir) {
    const guildsDir = path.join(dataDir, 'guilds');
    let guildDirs;
    try {
        guildDirs = await fs.readdir(guildsDir);
    } catch {
        return; // brak folderu guilds — nic do robienia
    }

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const guildId of guildDirs) {
        const rankingFile = path.join(guildsDir, guildId, 'ranking.json');
        let ranking;
        try {
            const raw = await fs.readFile(rankingFile, 'utf8');
            ranking = JSON.parse(raw);
        } catch {
            continue; // brak pliku rankingu — pomiń
        }

        const wynikiDir = path.join(guildsDir, guildId, 'wyniki');
        await fs.mkdir(wynikiDir, { recursive: true });

        for (const [userId, entry] of Object.entries(ranking)) {
            if (!entry || !entry.score) continue;

            const historyFile = path.join(wynikiDir, `${userId}.json`);
            try {
                await fs.access(historyFile);
                totalSkipped++;
                continue; // plik już istnieje — pomiń
            } catch { /* nie istnieje — utwórz */ }

            const scoreValue = typeof entry.scoreValue === 'number' && !isNaN(entry.scoreValue)
                ? entry.scoreValue
                : (() => {
                    // oblicz z tekstu jeśli brak pola
                    const upper = entry.score.toUpperCase().trim();
                    const m = upper.match(/^(\d+(?:\.\d+)?)(QI|SX|[KMBTQ])?$/);
                    if (!m) return 0;
                    const units = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, Q: 1e15, QI: 1e18, SX: 1e21 };
                    return parseFloat(m[1]) * (units[m[2]] || 1);
                })();

            const historyEntry = {
                score:      entry.score,
                scoreValue,
                timestamp:  entry.timestamp || new Date().toISOString(),
                bossName:   entry.bossName || null,
            };

            await fs.writeFile(historyFile, JSON.stringify([historyEntry], null, 2), 'utf8');
            totalCreated++;
        }
    }

    if (totalCreated > 0) {
        logger.info(`📊 Historia wyników: utworzono ${totalCreated} brakujących pliku (${totalSkipped} już istniało)`);
    }
}

module.exports = { migrate, backfillScoreHistory };
