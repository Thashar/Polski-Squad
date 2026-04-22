'use strict';

/**
 * High-level wrapper orkiestrujący pojedynczą operację bota:
 *
 *   authorize  →  root span  →  inner fn (LLM)  →  record (finally)
 *
 * Chowa lifecycle authorize/record, root span OTel, mapowanie błędów providera
 * na status. Handler bota pisze tylko logikę operacji.
 *
 * Użycie: `createBotOperations({botSlug})` w module handlera jako singleton,
 * potem `botOps.run(options, fn)` w każdej komendzie.
 *
 * Kontrakt inner fn (async):
 *   (ctx) => any | envelope
 *
 *   ctx: {
 *     authorizationId:  string|null    — z authorize, null w no-op/degraded
 *     traceId:          string|null    — root span trace id (do korelacji)
 *     rootSpan:         Span           — można dorzucać custom atrybuty
 *     degraded:         boolean        — true gdy gateway no-op/fail-open
 *     telemetryMeta:    {              — przekaż do LLM service-ów
 *       operationType,  actorDiscordId, guildId, authorizationId
 *     }
 *   }
 *
 *   Return value:
 *     - bare value       → traktowane jako {result: value, status: 'COMPLETED'}
 *     - envelope object  → {result, status?, usage?, errorCode?}
 *        status:    'COMPLETED' (default) | 'REJECTED' | 'PROVIDER_ERROR' | 'CLIENT_ERROR'
 *        usage:     { provider, inputTokens, outputTokens, durationMs?, llmTraceId? }
 *                   — durationMs i llmTraceId wypełniane automatycznie gdy pominięte
 *        errorCode: string (wpis do BotOperationEvent.errorCode)
 *
 *   Wyjątek z inner fn:
 *     - Runner zapisuje status='PROVIDER_ERROR', errorCode z err.providerCode/err.code
 *     - Rethrowuje do callera (outer try/catch w handlerze łapie)
 *
 * Return value z runOperation:
 *   {
 *     gatewayError:   {code, message, retryAfter} | null  — truthy gdy authorize 4xx
 *     status:         OperationStatus                      — co zapisane w event
 *     errorCode:      string | null
 *     result:         <whatever inner fn zwróciło jako result>
 *     authorizationId:string | null
 *     traceId:        string | null
 *     degraded:       boolean
 *   }
 */

const defaultAppOperations = require('./appOperations');
const { createAppOperations } = defaultAppOperations;
const { withOperationSpan } = require('./telemetry');

/**
 * Podstawowa funkcja. Zwykle nie wołasz tego bezpośrednio — użyj
 * createBotOperations({botSlug}).run(...) żeby nie powtarzać botSlug.
 *
 * `ops` pozwala wstrzyknąć klient `appOperations` związany z konkretnym botem
 * (per-bot API key). Bez argumentu używa domyślnego klienta z env (BOT_API_KEY).
 */
async function runOperation(options, fn, ops = defaultAppOperations) {
    const {
        type,
        botSlug,
        actor,
        scope,
        hints = {},
        spanName,
        attributes = {},
    } = options;

    if (!type || !botSlug || !actor?.discordId || !scope?.guildId) {
        throw new Error('runOperation: wymagane type, botSlug, actor.discordId, scope.guildId');
    }

    const tracerName = `${botSlug}-bot`;
    const effectiveSpanName = spanName || `${botSlug}.${type.split('.').pop()}`;

    // ── 1. AUTHORIZE (preflight gate) ────────────────────────────────────
    const auth = await ops.authorize({
        type, actor, scope, hints, tracerName,
    });

    if (!auth.ok) {
        // Gateway odrzucił — caller dostaje { gatewayError } do wyświetlenia userowi.
        return {
            gatewayError:    { code: auth.code, message: auth.message, retryAfter: auth.retryAfter },
            status:          'DENIED',
            errorCode:       auth.code,
            result:          null,
            authorizationId: null,
            traceId:         null,
            degraded:        false,
        };
    }

    // ── 2. RUN INNER FN POD ROOT SPAN + RECORD W FINALLY ─────────────────
    let userResult   = null;
    let recordStatus = 'COMPLETED';
    let errorCode    = null;
    let usage        = null;
    let rootTraceId  = null;
    const startedAt  = Date.now();

    try {
        await withOperationSpan(
            tracerName,
            effectiveSpanName,
            {
                'user.id':                  actor.discordId,
                'guild.id':                 scope.guildId,
                'operation.type':           type,
                'bot.slug':                 botSlug,
                'openinference.span.kind':  'CHAIN',
                ...(auth.authorizationId ? { 'session.id':       auth.authorizationId } : {}),
                ...(auth.degraded        ? { 'gateway.degraded': true } : {}),
                ...hints,          // np. command: 'test' → attr `command`
                ...attributes,     // caller może dorzucić dowolne attrs na root span
            },
            async (rootSpan) => {
                rootTraceId = rootSpan.spanContext()?.traceId || null;

                const ctx = {
                    authorizationId: auth.authorizationId,
                    traceId:         rootTraceId,
                    rootSpan,
                    degraded:        !!auth.degraded,
                    telemetryMeta: {
                        operationType:   type,
                        actorDiscordId:  actor.discordId,
                        guildId:         scope.guildId,
                        authorizationId: auth.authorizationId,
                    },
                };

                try {
                    const outcome = await fn(ctx);

                    // Rozpoznaj envelope vs bare value.
                    if (isEnvelope(outcome)) {
                        userResult   = outcome.result;
                        recordStatus = outcome.status   || 'COMPLETED';
                        errorCode    = outcome.errorCode || null;
                        usage        = outcome.usage     || null;
                    } else {
                        userResult = outcome;
                        // recordStatus pozostaje 'COMPLETED' (default)
                    }

                    rootSpan.setAttribute('status', recordStatus);
                    if (errorCode) rootSpan.setAttribute('error.code', errorCode);
                } catch (err) {
                    recordStatus = 'PROVIDER_ERROR';
                    errorCode    = err.providerCode || err.code || 'UNKNOWN';
                    rootSpan.setAttribute('status',     recordStatus);
                    rootSpan.setAttribute('error.code', errorCode);
                    throw err;
                }
            }
        );
    } finally {
        // RECORD zawsze — nawet gdy inner fn rzucił. Fire-and-forget w środku.
        if (auth.authorizationId) {
            ops.record({
                authorizationId: auth.authorizationId,
                status:          recordStatus,
                usage:           usage ? {
                    ...usage,
                    durationMs: usage.durationMs ?? (Date.now() - startedAt),
                    llmTraceId: usage.llmTraceId ?? rootTraceId,
                } : null,
                errorCode,
                tracerName,
            });
        }
    }

    return {
        gatewayError:    null,
        status:          recordStatus,
        errorCode,
        result:          userResult,
        authorizationId: auth.authorizationId,
        traceId:         rootTraceId,
        degraded:        !!auth.degraded,
    };
}

function isEnvelope(v) {
    return v && typeof v === 'object' && !Array.isArray(v) &&
        ('result' in v || 'status' in v || 'usage' in v || 'errorCode' in v);
}

/**
 * Tworzy bot-scoped wrapper. Każdy bot robi to raz (w konstruktorze handler-a
 * albo w index.js) i trzyma jako singleton. Potem wywołania są krótkie.
 *
 *   const botOps = createBotOperations({ botSlug: 'endersecho' });
 *   await botOps.run({type, actor, scope, hints}, async (ctx) => {...});
 *
 * @param {{ botSlug: string, apiKey?: string, apiUrl?: string }} opts
 */
function createBotOperations({ botSlug, apiKey, apiUrl }) {
    if (!botSlug) throw new Error('createBotOperations: wymagane botSlug');
    const ops = createAppOperations({ apiKey, apiUrl });
    return {
        botSlug,
        run(options, fn) {
            return runOperation({ botSlug, ...options }, fn, ops);
        },
    };
}

module.exports = {
    runOperation,
    createBotOperations,
};
