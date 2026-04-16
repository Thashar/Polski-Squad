'use strict';

/**
 * HTTP client helpers for pushing bot data to the Polski Squad web API.
 *
 * Each function wraps a specific POST /api/bot/<resource> endpoint from the
 * API (polski-squad/app). Calls are fire-and-forget from the caller's
 * perspective: errors are logged but never thrown — pushing data to the web
 * must never block or break a bot command.
 *
 * Idempotency:
 *   - Upsert endpoints (phase-result, combat-weekly, endersecho-snapshot,
 *     player-identity, nick-observation, core-stock) use natural unique
 *     keys on the API side. Replaying the same push is a no-op.
 *   - Event logs (punishment-event, reminder-event, cx-entry) require
 *     callers to pass a deterministic `id`. Use eventId() to generate one.
 *
 * Config:
 *   APP_API_URL — base URL of the web API (no trailing slash).
 *   BOT_API_KEY — shared secret; must match the API's env var.
 *   When either is missing, all calls silently no-op (keeps dev/test easy).
 */

const crypto = require('crypto');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('AppSync');

const APP_API_URL = process.env.APP_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;

const DEFAULT_RETRIES = 3;
const BACKOFF_MS = 2000;

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal fetch wrapper. Logs + retries on 5xx/network, does not throw.
 */
async function pushSync(path, body, { retries = DEFAULT_RETRIES } = {}) {
    if (!APP_API_URL || !BOT_API_KEY) {
        // Cicho pomijamy — brak konfiguracji oznacza dev/test bez web API.
        return;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${APP_API_URL}/api/bot${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BOT_API_KEY}`,
                },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                return;
            }

            // 4xx = bad payload, retries won't help — log and give up.
            if (res.status >= 400 && res.status < 500) {
                const text = await res.text().catch(() => '');
                logger.error(`appSync ${path} — 4xx ${res.status}: ${text}`);
                return;
            }

            // 5xx = server error, fall through to retry branch.
            throw new Error(`server ${res.status}`);
        } catch (err) {
            if (attempt === retries) {
                logger.error(`appSync ${path} — failed after ${retries} attempts: ${err.message || err}`);
                return;
            }
            await sleep(BACKOFF_MS * attempt);
        }
    }
}

/**
 * Deterministic event ID for event-log endpoints (punishment-event,
 * reminder-event, cx-entry). Same inputs => same ID => safe to retry.
 */
function eventId(...parts) {
    return crypto
        .createHash('sha1')
        .update(parts.map((p) => String(p)).join('|'))
        .digest('hex')
        .slice(0, 20);
}

/**
 * Compute the Monday-00:00 UTC of an ISO-8601 week. Good enough for the
 * weekly range queries on the API side (they just need monotonic ordering).
 */
function isoWeekStartUTC(year, weekNumber) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // 1..7 with Monday = 1
    const week1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
    const ms = week1Monday.getTime() + (weekNumber - 1) * 7 * 86400000;
    return new Date(ms).toISOString();
}

// ── Typed wrappers (1:1 with API endpoints) ─────────────────────────────────

const sync = {
    playerIdentity: (data) => pushSync('/player-identity', data),
    nickObservation: (data) => pushSync('/nick-observation', data),
    phaseResult: (data) => pushSync('/phase-result', data),
    punishmentEvent: (data) => pushSync('/punishment-event', data),
    coreStock: (data) => pushSync('/core-stock', data),
    reminderEvent: (data) => pushSync('/reminder-event', data),
    combatWeekly: (data) => pushSync('/combat-weekly', data),
    cxEntry: (data) => pushSync('/cx-entry', data),
    endersEchoSnapshot: (data) => pushSync('/endersecho-snapshot', data),
};

function isEnabled() {
    return Boolean(APP_API_URL && BOT_API_KEY);
}

module.exports = {
    sync,
    eventId,
    isoWeekStartUTC,
    pushSync,
    isEnabled,
};
