'use strict';

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker:AppEventPush');

const APP_API_URL = process.env.APP_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;

/**
 * Push a single event from the Discord bot to the web app API.
 *
 * Call this function after any tracked bot action to make the data
 * available on the website in real time. New event types can be added
 * freely — just choose a unique `type` string and put whatever data
 * you need in `payload`.
 *
 * @param {string} type
 *   Event type identifier, e.g. "phase1", "phase2", "core_stock",
 *   "punishment". Keep it short, lowercase, with underscores.
 *
 * @param {string|null} discordId
 *   Discord user ID of the player this event relates to.
 *   Pass null for server-wide events that aren't tied to one player.
 *
 * @param {Record<string, unknown>} [payload={}]
 *   Arbitrary data to attach to the event. Structure is up to you —
 *   whatever the website needs to display the information.
 *
 * @returns {Promise<void>}
 *
 * @example
 * // In phaseService.js after completing phase 1:
 * await pushEvent('phase1', member.id, {
 *   nickname: member.displayName,
 *   score: playerScore,
 *   completedAt: new Date().toISOString(),
 * });
 *
 * @example
 * // In survivorService.js after a Core Stock scan:
 * await pushEvent('core_stock', null, {
 *   scannedAt: new Date().toISOString(),
 *   items: stockSnapshot,
 * });
 */
async function pushEvent(type, discordId, payload = {}) {
    if (!APP_API_URL || !BOT_API_KEY) {
        logger.warn('APP_API_URL lub BOT_API_KEY nie są skonfigurowane — pomijanie pushEvent');
        return;
    }

    try {
        const body = {
            type,
            payload,
            ...(discordId ? { discordId } : {}),
        };

        const res = await fetch(`${APP_API_URL}/api/bot/event`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BOT_API_KEY}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            logger.error(`pushEvent(${type}) — błąd HTTP ${res.status}: ${text}`);
        } else {
            logger.info(`pushEvent(${type}) — OK`);
        }
    } catch (err) {
        // Nie rzucamy błędu dalej — nieudany push nie powinien blokować komendy bota.
        logger.error(`pushEvent(${type}) — błąd sieci:`, err?.message ?? err);
    }
}

module.exports = { pushEvent };
