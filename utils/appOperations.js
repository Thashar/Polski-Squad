'use strict';

/**
 * Klient Operations Metering Gateway (polski-squad web API).
 *
 * Dwa endpointy:
 *   POST /api/bot/operations/{type}/authorize  — preflight: czy bot może
 *     wykonać operację dla danego usera/serwera? Zwraca authorizationId
 *     i rezerwuje slot w quota counters.
 *
 *   POST /api/bot/operations/record             — postflight: „wykonałem,
 *     oto tokens/koszt". Idempotentny po authorizationId.
 *
 * Autoryzacja: ten sam Bearer BOT_API_KEY co w utils/appSync.js. Jeśli brak
 * APP_API_URL / BOT_API_KEY — cichy no-op mode (dev/test bez gatewaya).
 *
 * Zachowanie błędów (FAIL_OPEN domyślnie):
 *   - authorize: network/5xx → zwraca { ok: true, degraded: true,
 *     authorizationId: null } — bot kontynuuje lokalnie, record pomijany.
 *     4xx → zwraca { ok: false, code, message, retryAfter } — bot pokazuje
 *     użytkownikowi komunikat z mapowania.
 *   - record: fire-and-forget; retry 3× z backoff. Nigdy nie rzuca do callera.
 *
 * Env:
 *   APP_API_URL, BOT_API_KEY — wspólne z utils/appSync.js
 *
 * Stałe (w kodzie, niekonfigurowalne):
 *   FAIL_MODE = 'open'
 *   AUTHORIZE_TIMEOUT_MS = 10_000
 *   RECORD_TIMEOUT_MS    = 30_000
 */

const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('AppOperations');

const FAIL_MODE              = 'open';
const AUTHORIZE_TIMEOUT_MS   = 10_000;
const RECORD_TIMEOUT_MS      = 30_000;
const DEFAULT_RECORD_RETRIES = 3;
const BACKOFF_MS             = 2000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAppOperations(overrides = {}) {
    const rawUrl = overrides.apiUrl ?? process.env.APP_API_URL;
    const apiUrl = rawUrl
        ? rawUrl.replace(/\/+$/, '').replace(/\/api$/, '') || null
        : null;
    const apiKey = overrides.apiKey ?? process.env.BOT_API_KEY ?? null;

    const enabled = !!(apiUrl && apiKey);

    async function postJson(path, body, { timeoutMs, tracerName }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const tracer = trace.getTracer(tracerName || 'polski-squad-bots');

        return await tracer.startActiveSpan(`appOperations.${path.slice(1)}`, async (span) => {
            span.setAttribute('http.method', 'POST');
            span.setAttribute('http.route', `/api/bot/operations${path}`);
            try {
                const res = await fetch(`${apiUrl}/api/bot/operations${path}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                span.setAttribute('http.status_code', res.status);
                const text = await res.text();
                let parsed = null;
                try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

                if (!res.ok) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` });
                }
                return { ok: res.ok, status: res.status, body: parsed, raw: text };
            } catch (err) {
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message || String(err) });
                throw err;
            } finally {
                clearTimeout(timer);
                span.end();
            }
        });
    }

    /**
     * Preflight: sprawdź czy wolno wykonać operację.
     *
     * @param {Object} args
     * @param {string} args.type                     np. 'ocr.analyze' (unikalny per bot)
     * @param {{discordId: string}} args.actor
     * @param {{guildId: string, channelId?: string}} args.scope
     * @param {Object} [args.hints]                  dowolne metadane (command, …)
     * @param {string} [args.tracerName]             do spana HTTP
     * @returns {Promise<
     *   { ok: true,  authorizationId: string|null, expiresAt?: string, quota?: Object, degraded?: boolean } |
     *   { ok: false, code: string, message: string, retryAfter?: number }
     * >}
     */
    async function authorize({ type, actor, scope, hints, tracerName }) {
        if (!enabled) {
            // No-op mode: traktujemy jak degraded — bot kontynuuje lokalnie.
            return { ok: true, authorizationId: null, degraded: true, reason: 'disabled' };
        }

        try {
            const res = await postJson(`/${encodeURIComponent(type)}/authorize`,
                { actor, scope, hints },
                { timeoutMs: AUTHORIZE_TIMEOUT_MS, tracerName }
            );

            if (res.ok && res.body?.authorizationId) {
                return {
                    ok: true,
                    authorizationId: res.body.authorizationId,
                    expiresAt:       res.body.expiresAt,
                    quota:           res.body.quota,
                };
            }

            // 4xx — twardy odrzut. Błąd z API.
            if (res.status >= 400 && res.status < 500) {
                const code    = res.body?.error?.code || res.body?.code || `HTTP_${res.status}`;
                const message = res.body?.error?.message || res.body?.message || res.raw || '';
                const retryAfter = res.body?.error?.retryAfter || res.body?.retryAfter;
                return { ok: false, code, message, retryAfter };
            }

            // 5xx bez wyjątku — potraktuj jak degraded.
            logger.warn(`authorize ${type} — ${res.status}: ${res.raw || ''}`);
            return failOpen('SERVER_ERROR');
        } catch (err) {
            logger.warn(`authorize ${type} — network/timeout: ${err.message || err}`);
            return failOpen('NETWORK_ERROR');
        }
    }

    function failOpen(reason) {
        if (FAIL_MODE === 'closed') {
            return {
                ok: false,
                code: 'GATEWAY_UNAVAILABLE',
                message: `Gateway niedostępny (${reason})`,
            };
        }
        return { ok: true, authorizationId: null, degraded: true, reason };
    }

    /**
     * Postflight: zaraportuj wynik wykonania. Fire-and-forget z retry.
     * Nigdy nie rzuca do callera — błędy są logowane.
     *
     * @param {Object} args
     * @param {string} args.authorizationId  z authorize; null = pominięte
     * @param {'COMPLETED'|'REJECTED'|'PROVIDER_ERROR'|'CLIENT_ERROR'} args.status
     * @param {Object} [args.usage]  { provider, inputTokens, outputTokens, durationMs, llmTraceId }
     * @param {string} [args.errorCode]
     * @param {string} [args.tracerName]
     */
    function record({ authorizationId, status, usage, errorCode, tracerName }) {
        if (!enabled) return;
        if (!authorizationId) return; // degraded authorize lub brak — nic nie robimy

        const body = {
            authorizationId,
            status,
            usage: usage || null,
            errorCode: errorCode || null,
        };

        // Fire-and-forget — nie blokujemy callera.
        (async () => {
            for (let attempt = 1; attempt <= DEFAULT_RECORD_RETRIES; attempt++) {
                try {
                    const res = await postJson('/record', body, {
                        timeoutMs: RECORD_TIMEOUT_MS,
                        tracerName,
                    });
                    if (res.ok) return;
                    if (res.status >= 400 && res.status < 500) {
                        logger.error(`record ${authorizationId} — 4xx ${res.status}: ${res.raw || ''}`);
                        return;
                    }
                    throw new Error(`server ${res.status}`);
                } catch (err) {
                    if (attempt === DEFAULT_RECORD_RETRIES) {
                        logger.error(`record ${authorizationId} — failed after ${attempt} attempts: ${err.message || err}`);
                        return;
                    }
                    await sleep(BACKOFF_MS * attempt);
                }
            }
        })().catch((err) => {
            // Nie powinno się zdarzyć, ale łapiemy żeby nie stworzyć unhandled rejection.
            logger.error(`record fatal: ${err.message || err}`);
        });
    }

    function isEnabled() {
        return enabled;
    }

    return { authorize, record, isEnabled, createAppOperations };
}

// Domyślny klient z env — produkcyjny default.
const defaultClient = createAppOperations();

module.exports = {
    authorize:  defaultClient.authorize,
    record:     defaultClient.record,
    isEnabled:  defaultClient.isEnabled,
    createAppOperations,
};
