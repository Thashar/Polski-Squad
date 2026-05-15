'use strict';

/**
 * Korekcja nazw bossów w istniejących danych EndersEcho.
 * Wywoływany automatycznie przy starcie bota (z index.js).
 *
 * Skanuje:
 *   data/ranking.json
 *   data/guilds/{guildId}/ranking.json
 *   data/wyniki/{userId}.json
 *   data/guilds/{guildId}/wyniki/{userId}.json
 *   shared_data/endersecho_ranking.json
 *
 * Można też uruchomić ręcznie:
 *   node EndersEcho/fix-boss-names.js          -- DRY RUN (podgląd)
 *   node EndersEcho/fix-boss-names.js --fix    -- zapis
 */

const fs   = require('fs');
const path = require('path');
const { correctBossNameFull, KNOWN_BOSS_NAMES } = require('./config/bossNames');
const { BossAliasService } = require('./services/bossAliasService');
const { createBotLogger } = require('../utils/consoleLogger');

// ── helpers ───────────────────────────────────────────────────────────────────

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(full, callback);
        else if (entry.isFile()) callback(full);
    }
}

// ── fixery per typ pliku ──────────────────────────────────────────────────────

function fixRankingFlat(filePath, dryRun, log, stats, bossAliasService) {
    const data = readJson(filePath);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    let dirty = false;
    for (const [userId, entry] of Object.entries(data)) {
        if (!entry?.bossName) continue;
        const { corrected, wasUnknown } = correctBossNameFull(entry.bossName, bossAliasService);
        if (corrected !== entry.bossName) {
            log.info(`[FixBossNames] "${entry.bossName}" → "${corrected}" (userId=${userId})`);
            if (!dryRun) entry.bossName = corrected;
            dirty = true;
            stats.fixes++;
        } else if (wasUnknown) {
            stats.unrecognized.add(entry.bossName);
        }
    }
    if (dirty) {
        stats.changedFiles++;
        if (!dryRun) writeJson(filePath, data);
    }
    stats.files++;
}

function fixSharedRanking(filePath, dryRun, log, stats, bossAliasService) {
    const data = readJson(filePath);
    if (!data || !Array.isArray(data.players)) return;
    let dirty = false;
    for (const player of data.players) {
        if (!player.bossName) continue;
        const { corrected, wasUnknown } = correctBossNameFull(player.bossName, bossAliasService);
        if (corrected !== player.bossName) {
            log.info(`[FixBossNames] "${player.bossName}" → "${corrected}" (userId=${player.userId || player.discordId})`);
            if (!dryRun) player.bossName = corrected;
            dirty = true;
            stats.fixes++;
        } else if (wasUnknown) {
            stats.unrecognized.add(player.bossName);
        }
    }
    if (dirty) {
        stats.changedFiles++;
        if (!dryRun) writeJson(filePath, data);
    }
    stats.files++;
}

function fixHistoryFile(filePath, dryRun, log, stats, bossAliasService) {
    const data = readJson(filePath);
    if (!Array.isArray(data)) return;
    let dirty = false;
    for (const entry of data) {
        if (!entry.bossName) continue;
        const { corrected, wasUnknown } = correctBossNameFull(entry.bossName, bossAliasService);
        if (corrected !== entry.bossName) {
            log.info(`[FixBossNames] "${entry.bossName}" → "${corrected}" (ts=${entry.timestamp})`);
            if (!dryRun) entry.bossName = corrected;
            dirty = true;
            stats.fixes++;
        } else if (wasUnknown) {
            stats.unrecognized.add(entry.bossName);
        }
    }
    if (dirty) {
        stats.changedFiles++;
        if (!dryRun) writeJson(filePath, data);
    }
    stats.files++;
}

// ── główna funkcja (eksport) ──────────────────────────────────────────────────

/**
 * @param {string} dataDir              ścieżka do EndersEcho/data/
 * @param {string} sharedDataDir        ścieżka do shared_data/
 * @param {boolean} dryRun              true = tylko podgląd, false = zapis
 * @param {object} log                  logger (createBotLogger) lub console
 * @param {BossAliasService|null} bossAliasService  opcjonalnie — uwzględnia aliasy przy korekcji
 */
async function fixBossNamesInData(dataDir, sharedDataDir, dryRun = false, log = console, bossAliasService = null) {
    const stats = { files: 0, changedFiles: 0, fixes: 0, unrecognized: new Set() };

    // stary płaski ranking
    const oldRanking = path.join(dataDir, 'ranking.json');
    if (fs.existsSync(oldRanking)) fixRankingFlat(oldRanking, dryRun, log, stats, bossAliasService);

    // nowe rankingi per-guild
    const guildsDir = path.join(dataDir, 'guilds');
    walkDir(guildsDir, (fp) => {
        if (path.basename(fp) === 'ranking.json') fixRankingFlat(fp, dryRun, log, stats, bossAliasService);
    });

    // historia wyników — stara lokalizacja
    walkDir(path.join(dataDir, 'wyniki'), (fp) => {
        if (fp.endsWith('.json')) fixHistoryFile(fp, dryRun, log, stats, bossAliasService);
    });

    // historia wyników — nowa lokalizacja data/guilds/{id}/wyniki/
    walkDir(guildsDir, (fp) => {
        if (path.basename(path.dirname(fp)) === 'wyniki' && fp.endsWith('.json'))
            fixHistoryFile(fp, dryRun, log, stats, bossAliasService);
    });

    // globalny shared ranking
    const sharedFile = path.join(sharedDataDir, 'endersecho_ranking.json');
    if (fs.existsSync(sharedFile)) fixSharedRanking(sharedFile, dryRun, log, stats, bossAliasService);

    if (stats.fixes > 0) {
        log.info(`[FixBossNames] ${dryRun ? 'DRY RUN — ' : ''}Naprawiono ${stats.fixes} nazw w ${stats.changedFiles} plik(ach)`);
    }
    if (stats.unrecognized.size > 0) {
        log.info(`[FixBossNames] Nierozpoznane nazwy (niezmienione): ${[...stats.unrecognized].sort().join(', ')}`);
    }

    return stats;
}

module.exports = { fixBossNamesInData };

// ── tryb CLI ──────────────────────────────────────────────────────────────────

if (require.main === module) {
    const dryRun  = !process.argv.includes('--fix');
    const dataDir = path.join(__dirname, 'data');
    const sharedDataDir = path.join(__dirname, '..', 'shared_data');
    const log = createBotLogger('EndersEcho');

    const bossAliasService = new BossAliasService();

    console.log(`\n🔍 fix-boss-names — tryb: ${dryRun ? 'DRY RUN' : '⚠️  FIX'}\n`);

    bossAliasService.initFromBaseNames(KNOWN_BOSS_NAMES).then(() =>
    fixBossNamesInData(dataDir, sharedDataDir, dryRun, log, bossAliasService)).then(stats => {
        console.log(`\nPliki: ${stats.files} | Zmiany: ${stats.changedFiles} | Korekty: ${stats.fixes}`);
        if (stats.unrecognized.size > 0) {
            console.log(`Nierozpoznane: ${[...stats.unrecognized].sort().join(', ')}`);
        }
        if (dryRun && stats.fixes > 0) {
            console.log(`\nUruchom z --fix aby zapisać:\n  node EndersEcho/fix-boss-names.js --fix`);
        }
        console.log('');
    });
}
