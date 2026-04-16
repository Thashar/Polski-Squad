'use strict';

/**
 * One-time backfill runner dla web API (`polski-squad/app`).
 *
 * Czyta lokalne JSONy bota i wypycha historyczne dane do API przez
 * batchowe endpointy `/api/bot/<resource>/batch`. Używane przez slash
 * `/appsync-backfill` w Muteuszu (i potencjalnie przez przyszłe
 * schedulery).
 *
 * Zasady:
 *   - Idempotentnie — wszystkie endpointy upsertowe lub z
 *     deterministycznym `id`, można bezpiecznie odpalać wielokrotnie.
 *   - Fire-and-forget z punktu widzenia głównej logiki bota — runner
 *     działa w tle, emituje eventy, nie rzuca na hot-path.
 *   - No-op w dev — gdy `appSync.isEnabled() === false`, runner
 *     kończy się natychmiast z `disabled: true`.
 *
 * Architektura:
 *   - `AppBackfillRunner extends EventEmitter`
 *     - emit `start` / `resourceStart` / `batch` / `resourceDone` /
 *       `done` / `pushError` / `abort` (nazwa `pushError` celowo inna
 *       niż `error`, bo EventEmitter rzuca przy `error` bez listenera)
 *     - `runAll(options)` / `runResource(resource, options)` /
 *       `plan()` (liczy rekordy bez pushowania)
 *     - `abort()` ustawia flagę sprawdzaną przed każdym batchem
 */

const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

const { syncBatch, BATCH_MAX, eventId, isoWeekStartUTC, isEnabled } = require('./appSync');
const { safeParse } = require('./safeJSON');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('AppBackfill');

// Wszystkie ścieżki relatywne od katalogu repo (Polski-Squad).
const REPO_ROOT = path.join(__dirname, '..');
const STALKER_DATA = path.join(REPO_ROOT, 'Stalker', 'data');
const SHARED_DATA = path.join(REPO_ROOT, 'shared_data');

/** Pełna lista zasobów w deterministycznej kolejności (player-identity
 *  first → FK-safe dla reszty). */
const RESOURCES = [
    'player-identity',
    'nick-observation',
    'phase-result',
    'punishment-event',
    'combat-weekly',
    'core-stock',
    'cx-entry',
    'endersecho-snapshot',
];

/** Mapowanie bot → subset zasobów. Służy do filtra `--bot=X`. */
const RESOURCES_BY_BOT = {
    stalker: [
        'player-identity',
        'nick-observation',
        'phase-result',
        'punishment-event',
        'combat-weekly',
        'core-stock',
    ],
    kontroler: ['cx-entry'],
    endersecho: ['endersecho-snapshot'],
};

function classifyPunishmentReason(reason, defaultKind = 'MANUAL') {
    if (!reason) return { kind: defaultKind, note: null };
    const r = String(reason).toLowerCase();
    if (r.includes('niepokonanie')) return { kind: 'BOSS_FAIL', note: reason };
    if (r.includes('tygodniowe')) return { kind: 'WEEKLY_RESET', note: reason };
    if (r.includes('ręczne')) return { kind: 'MANUAL_REMOVAL', note: reason };
    return { kind: defaultKind, note: reason };
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readJson(filePath, fallback) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return safeParse(raw, fallback);
    } catch {
        return fallback;
    }
}

// ──────────────────────────────────────────────────────────────────────
//  ZBIERANIE ITEMÓW — po jednej funkcji per zasób. Każda zwraca
//  { items: [...], meta: { source: '<ścieżka>' } }.
// ──────────────────────────────────────────────────────────────────────

async function collectPlayerIdentity({ guildIdFilter } = {}) {
    const items = [];
    const phasesDir = path.join(STALKER_DATA, 'phases');
    if (!(await fileExists(phasesDir))) return items;

    const guildDirs = await fs.readdir(phasesDir);
    for (const gd of guildDirs) {
        if (!gd.startsWith('guild_')) continue;
        const guildId = gd.slice('guild_'.length);
        if (guildIdFilter && guildId !== guildIdFilter) continue;

        const indexPath = path.join(phasesDir, gd, 'player_index.json');
        if (!(await fileExists(indexPath))) continue;

        const index = await readJson(indexPath, {});
        for (const [userId, entry] of Object.entries(index)) {
            if (!entry || typeof entry !== 'object') continue;
            if (!entry.latestNick || !entry.lastSeen) continue;
            items.push({
                discordId: userId,
                guildId,
                currentNick: entry.latestNick,
                lastSeenAt: entry.lastSeen,
            });
        }
    }
    return items;
}

async function collectNickObservations({ guildIdFilter } = {}) {
    const items = [];
    const phasesDir = path.join(STALKER_DATA, 'phases');
    if (!(await fileExists(phasesDir))) return items;

    const guildDirs = await fs.readdir(phasesDir);
    for (const gd of guildDirs) {
        if (!gd.startsWith('guild_')) continue;
        const guildId = gd.slice('guild_'.length);
        if (guildIdFilter && guildId !== guildIdFilter) continue;

        const indexPath = path.join(phasesDir, gd, 'player_index.json');
        if (!(await fileExists(indexPath))) continue;

        const index = await readJson(indexPath, {});
        for (const [userId, entry] of Object.entries(index)) {
            if (!entry?.allNicks || !Array.isArray(entry.allNicks)) continue;
            const ts = entry.lastSeen || new Date().toISOString();
            for (const nick of entry.allNicks) {
                if (!nick) continue;
                items.push({
                    discordId: userId,
                    nick,
                    observedAt: ts,
                });
            }
        }
    }
    return items;
}

async function collectPhaseResults({ guildIdFilter } = {}) {
    const items = [];
    const phasesDir = path.join(STALKER_DATA, 'phases');
    if (!(await fileExists(phasesDir))) return items;

    const guildDirs = await fs.readdir(phasesDir);
    for (const gd of guildDirs) {
        if (!gd.startsWith('guild_')) continue;
        const guildId = gd.slice('guild_'.length);
        if (guildIdFilter && guildId !== guildIdFilter) continue;

        for (const phaseNum of [1, 2]) {
            const phaseDir = path.join(phasesDir, gd, `phase${phaseNum}`);
            if (!(await fileExists(phaseDir))) continue;

            const years = await fs.readdir(phaseDir);
            for (const yearDir of years) {
                const yearPath = path.join(phaseDir, yearDir);
                const stat = await fs.stat(yearPath).catch(() => null);
                if (!stat?.isDirectory()) continue;

                const year = parseInt(yearDir);
                if (!Number.isFinite(year)) continue;

                const files = await fs.readdir(yearPath);
                for (const filename of files) {
                    const match = filename.match(/^week-(\d+)_(.+)\.json$/);
                    if (!match) continue;
                    const weekNumber = parseInt(match[1]);
                    const clan = match[2];
                    if (!Number.isFinite(weekNumber)) continue;

                    const weekData = await readJson(path.join(yearPath, filename), null);
                    if (!weekData) continue;

                    const recordedAt = weekData.updatedAt || weekData.createdAt || new Date().toISOString();
                    const recordedBy = weekData.createdBy || null;
                    const weekStartsAt = isoWeekStartUTC(year, weekNumber);

                    // Phase1 ma `players`, phase2 może mieć `summary.players` albo `players`.
                    const players = weekData.summary?.players || weekData.players || [];

                    // Dla Fazy 2: buduj mapę userId → {r1, r2, r3} z danych rund
                    const roundScoresMap = new Map();
                    if (phaseNum === 2 && Array.isArray(weekData.rounds)) {
                        for (const roundData of weekData.rounds) {
                            if (!Array.isArray(roundData?.players)) continue;
                            for (const rp of roundData.players) {
                                if (!rp?.userId) continue;
                                if (!roundScoresMap.has(rp.userId)) roundScoresMap.set(rp.userId, {});
                                roundScoresMap.get(rp.userId)[`r${roundData.round}`] = rp.score;
                            }
                        }
                    }

                    for (const p of players) {
                        if (!p?.userId || !p?.displayName || typeof p.score !== 'number') continue;
                        const rounds = roundScoresMap.get(p.userId) || {};
                        items.push({
                            guildId,
                            discordId: p.userId,
                            phase: phaseNum === 1 ? 'PHASE_1' : 'PHASE_2',
                            year,
                            weekNumber,
                            weekStartsAt,
                            clan,
                            score: p.score,
                            round1Score: rounds.r1 ?? null,
                            round2Score: rounds.r2 ?? null,
                            round3Score: rounds.r3 ?? null,
                            displayNameAtTime: p.displayName,
                            recordedAt,
                            recordedBy,
                        });
                    }
                }
            }
        }
    }
    return items;
}

async function collectPunishmentEvents({ guildIdFilter } = {}) {
    const items = [];
    const file = path.join(STALKER_DATA, 'punishments.json');
    if (!(await fileExists(file))) return items;

    const data = await readJson(file, {});
    for (const [guildId, users] of Object.entries(data)) {
        if (guildIdFilter && guildId !== guildIdFilter) continue;
        if (!users || typeof users !== 'object') continue;

        for (const [userId, record] of Object.entries(users)) {
            if (!record?.history || !Array.isArray(record.history)) continue;
            for (const entry of record.history) {
                if (typeof entry?.points !== 'number' || !entry.date) continue;
                const { kind, note } = classifyPunishmentReason(
                    entry.reason,
                    entry.points > 0 ? 'BOSS_FAIL' : 'MANUAL_REMOVAL',
                );
                // Prefiks eventId musi odpowiadać hot-path (databaseService.js),
                // żeby replay był idempotentny dla już pushniętych wpisów.
                let idPrefix;
                if (kind === 'WEEKLY_RESET') idPrefix = 'weekly_reset';
                else if (kind === 'MANUAL_REMOVAL' || entry.points < 0) idPrefix = 'unpunish';
                else idPrefix = 'punish';

                items.push({
                    id: eventId(idPrefix, guildId, userId, entry.date, entry.points, entry.reason || ''),
                    guildId,
                    discordId: userId,
                    delta: entry.points,
                    reasonKind: kind,
                    reasonNote: note,
                    occurredAt: entry.date,
                });
            }
        }
    }
    return items;
}

async function collectCombatWeekly() {
    const items = [];
    const file = path.join(STALKER_DATA, 'player_combat_discord.json');
    if (!(await fileExists(file))) return items;

    const data = await readJson(file, { players: {} });
    for (const [userId, info] of Object.entries(data.players || {})) {
        if (!info?.weeks || !Array.isArray(info.weeks)) continue;
        for (const w of info.weeks) {
            if (!w?.weekNumber || !w?.year) continue;
            items.push({
                discordId: userId,
                year: w.year,
                weekNumber: w.weekNumber,
                weekStartsAt: isoWeekStartUTC(w.year, w.weekNumber),
                rc: w.relicCores || 0,
                tc: w.transmuteCores || 0,
                attack: String(w.attack || 0),
            });
        }
    }
    return items;
}

async function collectCoreStock() {
    const items = [];
    const file = path.join(STALKER_DATA, 'equipment_data.json');
    if (!(await fileExists(file))) return items;

    const data = await readJson(file, {});
    for (const [userId, record] of Object.entries(data)) {
        if (!record?.items || typeof record.items !== 'object') continue;
        items.push({
            discordId: userId,
            // Brak guildId w pliku equipment_data — "unknown" dopełnia API.
            guildId: record.guildId || 'unknown',
            takenAt: record.updatedAt || new Date().toISOString(),
            items: record.items,
        });
    }
    return items;
}

async function collectCxEntries() {
    const items = [];
    const file = path.join(SHARED_DATA, 'cx_history.json');
    if (!(await fileExists(file))) return items;

    const data = await readJson(file, {});
    for (const [userId, record] of Object.entries(data)) {
        if (!record?.scores || !Array.isArray(record.scores)) continue;
        for (const s of record.scores) {
            if (typeof s?.score !== 'number' || !s.date) continue;
            items.push({
                id: eventId('cx', s.guildId || 'unknown', userId, s.date, s.score),
                discordId: userId,
                score: s.score,
                completedAt: s.date,
            });
        }
    }
    return items;
}

async function collectEndersEchoSnapshot() {
    const items = [];
    const file = path.join(SHARED_DATA, 'endersecho_ranking.json');
    if (!(await fileExists(file))) return items;

    const data = await readJson(file, null);
    if (!data?.players || !Array.isArray(data.players)) return items;

    const snapshotDate = data.updatedAt || new Date().toISOString();
    const total = data.players.length;
    for (const p of data.players) {
        if (!p?.userId || typeof p.rank !== 'number') continue;
        items.push({
            discordId: p.userId,
            snapshotDate,
            rank: p.rank,
            scoreNumeric: String(Math.floor(p.scoreValue || 0)),
            totalPlayers: total,
        });
    }
    return items;
}

const COLLECTORS = {
    'player-identity':     collectPlayerIdentity,
    'nick-observation':    collectNickObservations,
    'phase-result':        collectPhaseResults,
    'punishment-event':    collectPunishmentEvents,
    'combat-weekly':       collectCombatWeekly,
    'core-stock':          collectCoreStock,
    'cx-entry':            collectCxEntries,
    'endersecho-snapshot': collectEndersEchoSnapshot,
};

const BATCH_SENDERS = {
    'player-identity':     (items) => syncBatch.playerIdentity(items),
    'nick-observation':    (items) => syncBatch.nickObservation(items),
    'phase-result':        (items) => syncBatch.phaseResult(items),
    'punishment-event':    (items) => syncBatch.punishmentEvent(items),
    'combat-weekly':       (items) => syncBatch.combatWeekly(items),
    'core-stock':          (items) => syncBatch.coreStock(items),
    'cx-entry':            (items) => syncBatch.cxEntry(items),
    'endersecho-snapshot': (items) => syncBatch.endersEchoSnapshot(items),
};

// ──────────────────────────────────────────────────────────────────────
//  Runner
// ──────────────────────────────────────────────────────────────────────

class AppBackfillRunner extends EventEmitter {
    constructor(options = {}) {
        super();
        this.dryRun = Boolean(options.dryRun);
        this.filters = {
            bot: options.bot || null,
            resource: options.resource || null,
            guildId: options.guildId || null,
        };
        this.batchSize = Math.min(Math.max(1, options.batchSize || BATCH_MAX), BATCH_MAX);
        this._aborted = false;
    }

    abort() {
        this._aborted = true;
        this.emit('abort', {});
    }

    /** Zwraca listę zasobów do przetworzenia po zastosowaniu filtrów. */
    _selectedResources() {
        let selected = [...RESOURCES];
        if (this.filters.bot) {
            const bot = this.filters.bot.toLowerCase();
            selected = RESOURCES_BY_BOT[bot] || [];
        }
        if (this.filters.resource) {
            selected = selected.filter((r) => r === this.filters.resource);
        }
        return selected;
    }

    /** Tylko zlicza ile rekordów jest do pushnięcia — bez fetcha. */
    async plan() {
        const resources = this._selectedResources();
        const plan = {};
        for (const resource of resources) {
            const items = await COLLECTORS[resource]({ guildIdFilter: this.filters.guildId });
            plan[resource] = items.length;
        }
        return plan;
    }

    async runAll() {
        if (!isEnabled()) {
            const err = 'APP_API_URL / BOT_API_KEY nie ustawione — backfill nie ma dokąd pisać.';
            logger.error(err);
            this.emit('pushError', { resource: null, error: err });
            return { disabled: true };
        }

        const resources = this._selectedResources();
        if (resources.length === 0) {
            this.emit('pushError', { resource: null, error: 'Filtry nie wybrały żadnego zasobu.' });
            return { resources: {} };
        }

        // Plan na start — klient może pokazać łączny progress.
        const plan = {};
        for (const r of resources) {
            plan[r] = (await COLLECTORS[r]({ guildIdFilter: this.filters.guildId })).length;
        }
        this.emit('start', { plan, dryRun: this.dryRun });

        const totals = {};
        const startWall = Date.now();

        for (const resource of resources) {
            if (this._aborted) break;
            const res = await this._runResource(resource);
            totals[resource] = res;
        }

        const summary = {
            totals,
            durationMs: Date.now() - startWall,
            aborted: this._aborted,
        };
        this.emit('done', summary);
        return summary;
    }

    async _runResource(resource) {
        const items = await COLLECTORS[resource]({ guildIdFilter: this.filters.guildId });
        const total = items.length;
        this.emit('resourceStart', { resource, total });

        const summary = { applied: 0, skipped: 0, failed: 0, total };
        const startRes = Date.now();

        if (total === 0 || this.dryRun) {
            summary.durationMs = Date.now() - startRes;
            this.emit('resourceDone', { resource, ...summary });
            return summary;
        }

        // Pętla batch po batch — jeden request jednocześnie na zasób. API
        // robi ciężką robotę na Postgres, nie ma sensu go zalewać.
        for (let offset = 0; offset < total; offset += this.batchSize) {
            if (this._aborted) break;
            const chunk = items.slice(offset, offset + this.batchSize);
            let response;
            try {
                response = await BATCH_SENDERS[resource](chunk);
            } catch (err) {
                summary.failed += chunk.length;
                this.emit('pushError', {
                    resource,
                    error: err?.message || String(err),
                });
                continue;
            }

            if (response && typeof response === 'object') {
                summary.applied += response.applied || 0;
                summary.skipped += response.skipped || 0;
                summary.failed += response.failed || 0;
                if (Array.isArray(response.errors) && response.errors.length > 0) {
                    for (const e of response.errors.slice(0, 5)) {
                        this.emit('pushError', { resource, error: `[row ${offset + e.index}] ${e.error}` });
                    }
                }
            } else {
                // Disabled mode lub twardy failure — pushSync zwróciło undefined.
                summary.failed += chunk.length;
            }

            this.emit('batch', {
                resource,
                processed: Math.min(offset + chunk.length, total),
                total,
                applied: summary.applied,
                skipped: summary.skipped,
                failed: summary.failed,
            });
        }

        summary.durationMs = Date.now() - startRes;
        this.emit('resourceDone', { resource, ...summary });
        return summary;
    }
}

module.exports = {
    AppBackfillRunner,
    RESOURCES,
    RESOURCES_BY_BOT,
};
