const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const store = require('../../utils/jsonStore');

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
        store.forget(src);
        return;
    } catch { /* nie istnieje — kontynuuj */ }

    const content = await fs.readFile(src, 'utf8');
    await fs.writeFile(dst, content, 'utf8');
    await fs.unlink(src);
    // ⚠️ Plik został skasowany poza store'em — bez `forget()` cache nadal by go oddał
    // przy odczycie, a pierwszy zapis odtworzyłby go na dysku ze starą zawartością
    store.forget(src);
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
        store.forget(src);
        return;
    }

    const userIds = Object.keys(data);
    if (userIds.length === 0) {
        await fs.unlink(src);
        store.forget(src);
        return;
    }

    let migrated = 0;
    for (const userId of userIds) {
        const dst = path.join(wynikiDir, `${userId}.json`);
        try { await fs.access(dst); continue; } catch { /* nie istnieje — pisz */ }
        const entries = Array.isArray(data[userId]) ? data[userId] : [];
        await store.set(dst, entries);
        migrated++;
    }

    await fs.unlink(src);
    store.forget(src);
    logger.info(`  ↳ score_history_${guildId}.json → guilds/${guildId}/wyniki/ (${migrated} graczy)`);
}

module.exports = { migrate };
