'use strict';

/**
 * Jednorazowy skrypt naprawczy — koryguje nazwy bossów w istniejących danych EndersEcho.
 *
 * Pliki skanowane:
 *   EndersEcho/data/ranking.json
 *   EndersEcho/data/guilds/{guildId}/ranking.json
 *   EndersEcho/data/wyniki/{userId}.json
 *   EndersEcho/data/guilds/{guildId}/wyniki/{userId}.json
 *   shared_data/endersecho_ranking.json
 *
 * Uruchamianie:
 *   node EndersEcho/fix-boss-names.js          -- tryb podglądu (DRY RUN, nic nie zapisuje)
 *   node EndersEcho/fix-boss-names.js --fix    -- tryb naprawy (nadpisuje pliki)
 */

const fs   = require('fs');
const path = require('path');

const { correctBossName, KNOWN_BOSS_NAMES } = require('./config/bossNames');

const DRY_RUN = !process.argv.includes('--fix');
const ROOT    = path.join(__dirname, '..');

// ── helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function tryCorrect(raw) {
    if (!raw) return { corrected: raw, changed: false };
    const corrected = correctBossName(raw);
    return { corrected, changed: corrected !== raw };
}

const stats = { files: 0, changed: 0, fixes: 0, unrecognized: new Set() };

function logFix(file, context, from, to) {
    stats.fixes++;
    console.log(`  ✏️  ${context}: "${from}" → "${to}"`);
}

function logUnknown(name) {
    if (name && !KNOWN_BOSS_NAMES.includes(name)) stats.unrecognized.add(name);
}

// ── ranking.json (stary format: { userId: { bossName, ... } }) ───────────────

function fixRankingFlat(filePath) {
    const data = readJson(filePath);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    let dirty = false;
    const relPath = path.relative(ROOT, filePath);

    for (const [userId, entry] of Object.entries(data)) {
        if (!entry || !entry.bossName) { continue; }
        const { corrected, changed } = tryCorrect(entry.bossName);
        if (changed) {
            logFix(relPath, `userId=${userId}`, entry.bossName, corrected);
            if (!DRY_RUN) entry.bossName = corrected;
            dirty = true;
        } else {
            logUnknown(entry.bossName);
        }
    }

    if (dirty) {
        stats.changed++;
        if (!DRY_RUN) writeJson(filePath, data);
    }
    stats.files++;
}

// ── shared_data/endersecho_ranking.json (format: { players: [...] }) ─────────

function fixSharedRanking(filePath) {
    const data = readJson(filePath);
    if (!data || !Array.isArray(data.players)) return;

    let dirty = false;
    const relPath = path.relative(ROOT, filePath);

    for (const player of data.players) {
        if (!player.bossName) continue;
        const { corrected, changed } = tryCorrect(player.bossName);
        if (changed) {
            logFix(relPath, `userId=${player.userId || player.discordId}`, player.bossName, corrected);
            if (!DRY_RUN) player.bossName = corrected;
            dirty = true;
        } else {
            logUnknown(player.bossName);
        }
    }

    if (dirty) {
        stats.changed++;
        if (!DRY_RUN) writeJson(filePath, data);
    }
    stats.files++;
}

// ── wyniki/{userId}.json (format: tablica [ { bossName, score, ... } ]) ───────

function fixHistoryFile(filePath) {
    const data = readJson(filePath);
    if (!Array.isArray(data)) return;

    let dirty = false;
    const relPath = path.relative(ROOT, filePath);

    for (const entry of data) {
        if (!entry.bossName) continue;
        const { corrected, changed } = tryCorrect(entry.bossName);
        if (changed) {
            logFix(relPath, `ts=${entry.timestamp}`, entry.bossName, corrected);
            if (!DRY_RUN) entry.bossName = corrected;
            dirty = true;
        } else {
            logUnknown(entry.bossName);
        }
    }

    if (dirty) {
        stats.changed++;
        if (!DRY_RUN) writeJson(filePath, data);
    }
    stats.files++;
}

// ── glob helper ───────────────────────────────────────────────────────────────

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(full, callback);
        else if (entry.isFile()) callback(full);
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log(`\n🔍 EndersEcho fix-boss-names — tryb: ${DRY_RUN ? 'DRY RUN (podgląd, bez zapisu)' : '⚠️  FIX (nadpisuje pliki)'}\n`);

const dataDir = path.join(__dirname, 'data');

// 1. Stary ranking (płaski)
const oldRanking = path.join(dataDir, 'ranking.json');
if (fs.existsSync(oldRanking)) {
    console.log(`📄 ${path.relative(ROOT, oldRanking)}`);
    fixRankingFlat(oldRanking);
}

// 2. Nowe rankingi per-guild
const guildsDir = path.join(dataDir, 'guilds');
walkDir(guildsDir, (filePath) => {
    const base = path.basename(filePath);
    if (base === 'ranking.json') {
        console.log(`📄 ${path.relative(ROOT, filePath)}`);
        fixRankingFlat(filePath);
    }
});

// 3. Historia wyników (stara lokalizacja: data/wyniki/)
walkDir(path.join(dataDir, 'wyniki'), (filePath) => {
    if (filePath.endsWith('.json')) {
        console.log(`📄 ${path.relative(ROOT, filePath)}`);
        fixHistoryFile(filePath);
    }
});

// 4. Historia wyników (nowa lokalizacja: data/guilds/{id}/wyniki/)
walkDir(guildsDir, (filePath) => {
    if (path.basename(path.dirname(filePath)) === 'wyniki' && filePath.endsWith('.json')) {
        console.log(`📄 ${path.relative(ROOT, filePath)}`);
        fixHistoryFile(filePath);
    }
});

// 5. Globalny ranking shared_data
const sharedRanking = path.join(ROOT, 'shared_data', 'endersecho_ranking.json');
if (fs.existsSync(sharedRanking)) {
    console.log(`📄 ${path.relative(ROOT, sharedRanking)}`);
    fixSharedRanking(sharedRanking);
}

// ── podsumowanie ──────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────');
console.log(`📊 Przeskanowane pliki : ${stats.files}`);
console.log(`✏️  Pliki ze zmianami  : ${stats.changed}`);
console.log(`🔧 Korekty ogółem     : ${stats.fixes}`);

if (stats.unrecognized.size > 0) {
    console.log(`\n⚠️  Nierozpoznane nazwy bossów (nie zmienione):`);
    for (const name of [...stats.unrecognized].sort()) {
        console.log(`   • "${name}"`);
    }
}

if (DRY_RUN && stats.fixes > 0) {
    console.log(`\n💡 Uruchom z --fix aby zastosować zmiany:\n   node EndersEcho/fix-boss-names.js --fix`);
} else if (!DRY_RUN && stats.fixes > 0) {
    console.log('\n✅ Zmiany zapisane.');
} else if (stats.fixes === 0) {
    console.log('\n✅ Brak nazw do korekty — dane są aktualne.');
}
console.log('');
