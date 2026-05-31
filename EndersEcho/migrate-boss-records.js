'use strict';

/**
 * Jednorazowy skrypt migracji — wypełnia boss_records.json z historii wyników.
 *
 * Źródło: data/guilds/{guildId}/wyniki/{userId}.json
 *   Każdy wpis: { score, scoreValue, timestamp, bossName }
 *
 * Wynik: data/guilds/{guildId}/boss_records.json
 *   Format: { userId: { bossName: { score, scoreValue, timestamp, username } } }
 *
 * Logika:
 *   - Dla każdego gracza per guild → per bossName zachowuje wpis z największym scoreValue
 *   - Normalizuje bossName przez bossAliasService (alias → angielska nazwa)
 *   - Jeśli boss_records.json już istnieje — zachowuje lepszy wynik (nie nadpisuje gorszym)
 *   - Dodaje username z ranking.json (jeśli brakuje w historii)
 *
 * Użycie: node EndersEcho/migrate-boss-records.js [--dry-run]
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DRY_RUN = process.argv.includes('--dry-run');

async function loadJson(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function getAllGuildIds() {
    const guildsDir = path.join(DATA_DIR, 'guilds');
    try {
        const entries = await fs.readdir(guildsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return [];
    }
}

// Ładuje bossAliasService żeby normalizować nazwy bossów
function loadBossAliasService() {
    try {
        const { BossAliasService } = require('./services/bossAliasService');
        return new BossAliasService();
    } catch (e) {
        console.warn(`⚠️  Nie można załadować BossAliasService: ${e.message} — normalizacja pominięta`);
        return null;
    }
}

function resolveBossName(rawName, bossAliasService) {
    if (!bossAliasService || !rawName) return rawName;
    const resolved = bossAliasService.resolveAlias(rawName);
    return resolved || rawName;
}

async function processGuild(guildId, bossAliasService) {
    const guildDir = path.join(DATA_DIR, 'guilds', guildId);
    const wynikDir = path.join(guildDir, 'wyniki');
    const rankingFile = path.join(guildDir, 'ranking.json');
    const bossRecordsFile = path.join(guildDir, 'boss_records.json');

    // Wczytaj ranking dla uzupełnienia username
    const ranking = await loadJson(rankingFile) || {};
    const usernameMap = {};
    for (const [userId, entry] of Object.entries(ranking)) {
        usernameMap[userId] = entry.username || entry.name || userId;
    }

    // Wczytaj istniejące boss_records żeby nie nadpisać lepszego wyniku
    const existingRecords = await loadJson(bossRecordsFile) || {};

    // Zbierz pliki historii
    let historyFiles = [];
    try {
        historyFiles = await fs.readdir(wynikDir);
    } catch {
        // Brak katalogu wyniki — pomiń guild
        return { guildId, players: 0, bosses: 0, skipped: true };
    }

    const newRecords = JSON.parse(JSON.stringify(existingRecords)); // kopia

    let totalPlayers = 0;
    let totalBossEntries = 0;

    for (const file of historyFiles) {
        if (!file.endsWith('.json')) continue;
        const userId = file.replace('.json', '');
        const history = await loadJson(path.join(wynikDir, file));
        if (!Array.isArray(history) || !history.length) continue;

        const username = usernameMap[userId] || userId;

        // Grupuj per bossName → najlepszy scoreValue
        const bestPerBoss = {};
        for (const entry of history) {
            if (!entry.bossName) continue;
            const normalized = resolveBossName(entry.bossName, bossAliasService);
            const scoreValue = typeof entry.scoreValue === 'number' ? entry.scoreValue : -Infinity;
            if (!bestPerBoss[normalized] || scoreValue > bestPerBoss[normalized].scoreValue) {
                bestPerBoss[normalized] = {
                    score: entry.score,
                    scoreValue,
                    timestamp: entry.timestamp,
                    username,
                };
            }
        }

        if (!Object.keys(bestPerBoss).length) continue;
        totalPlayers++;

        if (!newRecords[userId]) newRecords[userId] = {};
        for (const [bossName, record] of Object.entries(bestPerBoss)) {
            const existing = newRecords[userId][bossName];
            const existingValue = existing?.scoreValue ?? -Infinity;
            if (record.scoreValue > existingValue) {
                newRecords[userId][bossName] = record;
                totalBossEntries++;
            }
        }
    }

    if (!DRY_RUN && totalBossEntries > 0) {
        await fs.mkdir(guildDir, { recursive: true });
        await fs.writeFile(bossRecordsFile, JSON.stringify(newRecords, null, 2), 'utf8');
    }

    return { guildId, players: totalPlayers, bosses: totalBossEntries };
}

async function main() {
    console.log(`🎯 Migracja boss_records${DRY_RUN ? ' [DRY RUN]' : ''}`);
    console.log(`📁 Katalog danych: ${DATA_DIR}\n`);

    const bossAliasService = loadBossAliasService();
    const guildIds = await getAllGuildIds();

    if (!guildIds.length) {
        console.log('⚠️  Brak serwerów w data/guilds/ — nic do migracji.');
        return;
    }

    console.log(`📋 Znaleziono ${guildIds.length} serwer(ów): ${guildIds.join(', ')}\n`);

    let totalPlayers = 0;
    let totalBosses = 0;

    for (const guildId of guildIds) {
        const result = await processGuild(guildId, bossAliasService);
        if (result.skipped) {
            console.log(`  ⏭️  Guild ${guildId} — brak katalogu wyniki/, pominięto`);
            continue;
        }
        const action = DRY_RUN ? '[dry]' : '✅';
        console.log(`  ${action} Guild ${guildId}: ${result.players} graczy, ${result.bosses} nowych wpisów boss_records`);
        totalPlayers += result.players;
        totalBosses += result.bosses;
    }

    console.log(`\n📊 Łącznie: ${totalPlayers} graczy, ${totalBosses} wpisów boss_records`);
    if (DRY_RUN) {
        console.log('\n💡 Uruchom bez --dry-run żeby zapisać dane.');
    } else {
        console.log('\n✅ Migracja zakończona.');
    }
}

// Eksportowana wersja do wywołania z initializeBot()
// Uruchamia się tylko raz — jeśli plik marker .boss_records_migrated nie istnieje
async function runIfNeeded(dataDir, bossAliasService, log) {
    const marker = path.join(dataDir, '.boss_records_migrated');
    try {
        await fs.access(marker);
        return; // już przeprowadzono
    } catch { /* marker nie istnieje → migruj */ }

    const guildsDir = path.join(dataDir, 'guilds');
    let guildIds = [];
    try {
        const entries = await fs.readdir(guildsDir, { withFileTypes: true });
        guildIds = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { return; }

    if (!guildIds.length) {
        await fs.writeFile(marker, new Date().toISOString(), 'utf8');
        return;
    }

    log && log(`Migracja boss_records — ${guildIds.length} serwer(ów)`);
    let total = 0;
    for (const guildId of guildIds) {
        // Podmień globalny DATA_DIR dla processGuild
        const origDataDir = DATA_DIR;
        // processGuild używa modułowego DATA_DIR — wywołujemy lokalizowaną wersję
        const result = await _processGuild(dataDir, guildId, bossAliasService);
        if (!result.skipped) {
            log && log(`  Guild ${guildId}: ${result.players} graczy, ${result.bosses} wpisów boss_records`);
            total += result.bosses;
        }
    }
    log && log(`Migracja boss_records zakończona: ${total} wpisów łącznie`);
    await fs.writeFile(marker, new Date().toISOString(), 'utf8');
}

// Wersja processGuild przyjmująca zewnętrzny dataDir (używana przez runIfNeeded)
async function _processGuild(dataDir, guildId, bossAliasService) {
    const guildDir = path.join(dataDir, 'guilds', guildId);
    const wynikDir = path.join(guildDir, 'wyniki');
    const rankingFile = path.join(guildDir, 'ranking.json');
    const bossRecordsFile = path.join(guildDir, 'boss_records.json');

    const ranking = await loadJson(rankingFile) || {};
    const usernameMap = {};
    for (const [userId, entry] of Object.entries(ranking)) {
        usernameMap[userId] = entry.username || entry.name || userId;
    }

    const existingRecords = await loadJson(bossRecordsFile) || {};
    let historyFiles = [];
    try {
        historyFiles = await fs.readdir(wynikDir);
    } catch {
        return { guildId, players: 0, bosses: 0, skipped: true };
    }

    const newRecords = JSON.parse(JSON.stringify(existingRecords));
    let totalPlayers = 0;
    let totalBossEntries = 0;

    for (const file of historyFiles) {
        if (!file.endsWith('.json')) continue;
        const userId = file.replace('.json', '');
        const history = await loadJson(path.join(wynikDir, file));
        if (!Array.isArray(history) || !history.length) continue;

        const username = usernameMap[userId] || userId;
        const bestPerBoss = {};
        for (const entry of history) {
            if (!entry.bossName) continue;
            const normalized = resolveBossName(entry.bossName, bossAliasService);
            const scoreValue = typeof entry.scoreValue === 'number' ? entry.scoreValue : -Infinity;
            if (!bestPerBoss[normalized] || scoreValue > bestPerBoss[normalized].scoreValue) {
                bestPerBoss[normalized] = { score: entry.score, scoreValue, timestamp: entry.timestamp, username };
            }
        }

        if (!Object.keys(bestPerBoss).length) continue;
        totalPlayers++;
        if (!newRecords[userId]) newRecords[userId] = {};
        for (const [bossName, record] of Object.entries(bestPerBoss)) {
            const existing = newRecords[userId][bossName];
            if (record.scoreValue > (existing?.scoreValue ?? -Infinity)) {
                newRecords[userId][bossName] = record;
                totalBossEntries++;
            }
        }
    }

    if (totalBossEntries > 0) {
        await fs.mkdir(guildDir, { recursive: true });
        await fs.writeFile(bossRecordsFile, JSON.stringify(newRecords, null, 2), 'utf8');
    }
    return { guildId, players: totalPlayers, bosses: totalBossEntries };
}

if (require.main === module) {
    main().catch(e => {
        console.error('❌ Błąd migracji:', e);
        process.exit(1);
    });
}

module.exports = { runIfNeeded };
