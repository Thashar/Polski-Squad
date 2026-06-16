'use strict';

/**
 * achievementRestoreService — jednorazowe narzędzie naprawcze osiągnięć EndersEcho.
 *
 * Dwa zadania:
 *  1. Przywrócenie osiągnięć utraconych przez race condition (lost writes) — merge brakujących
 *     wpisów `unlocked` z backupu (kategorie inne niż 'score') do aktualnych plików.
 *  2. Naprawa rotacji ID osiągnięć Sp: stare `score_100xx` (Poza Granicami @1e26) zostało
 *     przemianowane na `score_100sp` (Władca Septylionów @1e26), a `score_100xx` to teraz @1e29.
 *     Osiągnięcia kategorii 'score' są przeliczane na nowo z aktualnego rankingu (best scoreValue),
 *     więc gracze ≥1e26 dostają poprawne `score_100sp`, a błędne stare `score_100xx` jest czyszczone.
 *
 * Zasady bezpieczeństwa:
 *  - Osiągnięcia są wyłącznie DODAWANE (nigdy nie usuwane) — jedynym wyjątkiem jest błędne
 *    stare `score_100xx`, usuwane tylko gdy znamy realny wynik gracza i jest < 1e29.
 *  - Pole `progress` jest tylko delikatnie scalane (recordCount=max, bossesEncountered=suma,
 *    liczniki eksploratora=max). Znaczniki czasu (lastRecordAt itd.) NIE są ruszane.
 */

const fs = require('fs');
const path = require('path');
const { ACHIEVEMENTS } = require('../config/achievements');

const ACH_BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
const SCORE_ACHS = ACHIEVEMENTS.filter(a => a.category === 'score');
const ENDERS_GUILDS_DIR = path.join(__dirname, '..', 'data', 'guilds');

const THRESHOLD_100XX = 1e29; // aktualny próg dla score_100xx (Poza Granicami)
const EXPLORER_COUNTERS = ['rankingViews', 'subscriptions', 'nonRecordCount', 'cvApprovedCount', 'aiRescuedCount', 'profileSearches'];

function readJsonSafe(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function listGuildDirs(guildsRoot) {
    try {
        return fs.readdirSync(guildsRoot, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
    } catch {
        return [];
    }
}

/**
 * Buduje plan przywracania (dry-run, bez zapisu).
 * @param {string} backupGuildsRoot - ścieżka do folderu "guilds" w rozpakowanym backupie
 * @returns {{ guilds: Array, totals: { guilds, usersTouched, restored, scoreGranted, scoreRemoved } }}
 */
function buildRestorePlan(backupGuildsRoot) {
    const nowIso = new Date().toISOString();
    const guilds = [];
    const totals = { guilds: 0, usersTouched: 0, restored: 0, scoreGranted: 0, scoreRemoved: 0 };

    for (const guildId of listGuildDirs(backupGuildsRoot)) {
        const backupAch = readJsonSafe(path.join(backupGuildsRoot, guildId, 'achievements.json')) || {};
        const curDir = path.join(ENDERS_GUILDS_DIR, guildId);
        const curPath = path.join(curDir, 'achievements.json');
        const currentAch = readJsonSafe(curPath) || {};
        const ranking = readJsonSafe(path.join(curDir, 'ranking.json')) || {};

        const merged = JSON.parse(JSON.stringify(currentAch));
        const userChanges = [];

        const userIds = new Set([
            ...Object.keys(backupAch),
            ...Object.keys(currentAch),
            ...Object.keys(ranking),
        ]);

        for (const userId of userIds) {
            if (!merged[userId]) merged[userId] = { unlocked: {}, progress: {} };
            if (!merged[userId].unlocked) merged[userId].unlocked = {};
            if (!merged[userId].progress) merged[userId].progress = {};
            const unlocked = merged[userId].unlocked;
            const progress = merged[userId].progress;
            const ch = { userId, restored: [], scoreGranted: [], scoreRemoved: [] };

            const bu = backupAch[userId];

            // 1) Przywróć brakujące osiągnięcia (kategorie != 'score') z backupu
            if (bu && bu.unlocked) {
                for (const [id, info] of Object.entries(bu.unlocked)) {
                    const def = ACH_BY_ID.get(id);
                    if (!def || def.category === 'score') continue; // score przeliczane niżej; nieznane ID pomijane
                    if (!unlocked[id]) {
                        unlocked[id] = { unlockedAt: (info && info.unlockedAt) || nowIso };
                        ch.restored.push(id);
                    }
                }
            }

            // 1b) Delikatny merge progress z backupu (wsparcie dla przywróconych osiągnięć)
            if (bu && bu.progress) {
                if (typeof bu.progress.recordCount === 'number') {
                    progress.recordCount = Math.max(progress.recordCount || 0, bu.progress.recordCount);
                }
                if (Array.isArray(bu.progress.bossesEncountered)) {
                    progress.bossesEncountered = progress.bossesEncountered || [];
                    const seen = new Set(progress.bossesEncountered.map(b => String(b).toLowerCase()));
                    for (const b of bu.progress.bossesEncountered) {
                        const lc = String(b).toLowerCase();
                        if (!seen.has(lc)) { progress.bossesEncountered.push(b); seen.add(lc); }
                    }
                }
                for (const f of EXPLORER_COUNTERS) {
                    if (typeof bu.progress[f] === 'number') {
                        progress[f] = Math.max(progress[f] || 0, bu.progress[f]);
                    }
                }
            }

            // 2) Osiągnięcia 'score' — przelicz z aktualnego rankingu + napraw score_100sp
            const rEntry = ranking[userId];
            const sv = rEntry && typeof rEntry.scoreValue === 'number' ? rEntry.scoreValue : 0;
            const rTs = (rEntry && rEntry.timestamp) || nowIso;

            // Stare score_100xx (= Poza Granicami @1e26) → teraz score_100sp (Władca Septylionów @1e26)
            if (unlocked['score_100xx']) {
                const oldInfo = unlocked['score_100xx'];
                if (!unlocked['score_100sp']) {
                    unlocked['score_100sp'] = { unlockedAt: (oldInfo && oldInfo.unlockedAt) || rTs };
                    ch.scoreGranted.push('score_100sp');
                }
                // Usuń błędne score_100xx tylko gdy mamy realny wynik i jest < 1e29
                if (sv > 0 && sv < THRESHOLD_100XX) {
                    delete unlocked['score_100xx'];
                    ch.scoreRemoved.push('score_100xx');
                }
            }

            // Przyznaj każde osiągnięcie score, na które gracz zasługuje wg aktualnego wyniku (tylko DODAWANIE)
            if (sv > 0) {
                for (const def of SCORE_ACHS) {
                    if (unlocked[def.id]) continue;
                    let qualifies = false;
                    try { qualifies = def.check({}, { scoreValue: sv }); } catch {}
                    if (qualifies) {
                        unlocked[def.id] = { unlockedAt: rTs };
                        ch.scoreGranted.push(def.id);
                    }
                }
            }

            if (ch.restored.length || ch.scoreGranted.length || ch.scoreRemoved.length) {
                userChanges.push(ch);
                totals.usersTouched++;
                totals.restored += ch.restored.length;
                totals.scoreGranted += ch.scoreGranted.length;
                totals.scoreRemoved += ch.scoreRemoved.length;
            }
        }

        guilds.push({ guildId, mergedPath: curPath, merged, userChanges });
        totals.guilds++;
    }

    return { guilds, totals };
}

/**
 * Zapisuje plan przywracania. Przed nadpisaniem tworzy kopię bezpieczeństwa
 * (achievements.before_restore_<timestamp>.json) i zapisuje atomowo (tmp + rename).
 * @param {ReturnType<typeof buildRestorePlan>} plan
 * @returns {{ written: Array<{guildId, users}>, failed: Array<{guildId, reason}> }}
 */
function applyRestorePlan(plan) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const written = [];
    const failed = [];

    for (const g of plan.guilds) {
        if (!g.userChanges.length) continue;
        try {
            const dir = path.dirname(g.mergedPath);
            fs.mkdirSync(dir, { recursive: true });

            if (fs.existsSync(g.mergedPath)) {
                try {
                    fs.copyFileSync(g.mergedPath, path.join(dir, `achievements.before_restore_${stamp}.json`));
                } catch {}
            }

            const tmp = `${g.mergedPath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(g.merged, null, 2), 'utf8');
            fs.renameSync(tmp, g.mergedPath);
            written.push({ guildId: g.guildId, users: g.userChanges.length });
        } catch (err) {
            failed.push({ guildId: g.guildId, reason: err.message });
        }
    }

    return { written, failed };
}

module.exports = { buildRestorePlan, applyRestorePlan };
