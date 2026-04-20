'use strict';

/**
 * OpenTelemetry bootstrap dla botów Polski-Squad, natywnie spięty z Langfuse.
 *
 * Eksportuje:
 *   - init(serviceName)          — idempotentna inicjalizacja SDK (no-op gdy brak LANGFUSE_* env)
 *   - shutdown()                 — flush + close (wywoływane w SIGINT handlerach)
 *   - getTracer(name)            — wrapper wokół trace.getTracer
 *   - withOperationSpan(...)     — helper do owijania całej operacji w root span
 *   - isEnabled()                — czy tracing jest aktywny
 *   - SpanStatusCode             — reexport dla wygody
 *
 * Backend: Langfuse (przez `@langfuse/otel` — oficjalny SpanProcessor).
 * Graceful degradation: gdy brak kluczy → no-op, zero błędów, zero ruchu.
 *
 * Konfiguracja przez env:
 *   LANGFUSE_PUBLIC_KEY   — klucz publiczny projektu
 *   LANGFUSE_SECRET_KEY   — klucz sekretny projektu
 *   LANGFUSE_BASE_URL     — opcjonalny (default: https://cloud.langfuse.com)
 *
 * Nazwa serwisu: wyłącznie z argumentu init('<bot>-bot').
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { LangfuseSpanProcessor } = require('@langfuse/otel');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('Telemetry');

let sdk = null;
let initialized = false;
let enabled = false;

/**
 * Idempotentna inicjalizacja OTel SDK + Langfuse. Bezpieczne do wielokrotnego
 * wywołania (np. gdy kilka botów startuje w jednym procesie przez launcher).
 *
 * @param {string} serviceName — etykieta w telemetrii (np. 'endersecho-bot')
 */
function init(serviceName = 'polski-squad-bots') {
    if (initialized) return;
    initialized = true;

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const baseUrl   = process.env.LANGFUSE_BASE_URL;   // opcjonalne

    if (!publicKey || !secretKey) {
        logger.info('ℹ️ Langfuse tracing wyłączony (brak LANGFUSE_PUBLIC_KEY/SECRET_KEY) — no-op mode');
        return;
    }

    const langfuseProcessor = new LangfuseSpanProcessor({
        publicKey,
        secretKey,
        ...(baseUrl ? { baseUrl } : {}),
    });

    sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
        }),
        spanProcessors: [langfuseProcessor],
    });

    try {
        sdk.start();
        enabled = true;
        logger.success(`✅ Langfuse tracing aktywny (service=${serviceName}${baseUrl ? `, baseUrl=${baseUrl}` : ''})`);
    } catch (err) {
        enabled = false;
        logger.error(`❌ Langfuse init failed: ${err.message || err}`);
    }
}

/**
 * Flush + close. Wywoływane z SIGINT/SIGTERM handlerów bota.
 */
async function shutdown() {
    if (!sdk || !enabled) return;
    try {
        await sdk.shutdown();
        logger.info('Langfuse/OTel SDK zatrzymany');
    } catch (err) {
        logger.error(`Langfuse shutdown error: ${err.message || err}`);
    }
}

/**
 * Zwraca tracer po nazwie (np. 'endersecho-bot'). Tracer jest lekki — można
 * bezpiecznie pobierać za każdym razem; cache trzyma sam OTel API.
 */
function getTracer(name = 'polski-squad-bots') {
    return trace.getTracer(name);
}

/**
 * Owija całą operację w root span. Używaj w handlerach botów — wszystkie
 * wewnętrzne spany (HTTP, LLM) automatycznie staną się dziećmi dzięki
 * OTel Context API (startActiveSpan propaguje kontekst przez async stack).
 *
 * Przy no-op (tracing wyłączony) span jest bezoperacyjny, ale `fn` nadal
 * zostaje wywołana — bot działa tak jak bez telemetrii.
 *
 * Zwraca wartość zwróconą przez fn, albo rethrowuje błąd (zapisując go na
 * spanie jako exception + ERROR status).
 *
 * @param {string} tracerName — nazwa tracera (np. 'endersecho-bot')
 * @param {string} spanName   — nazwa spana (np. 'endersecho.ocr.analyze')
 * @param {Object} attrs      — atrybuty root spana (user.id, guild.id, operation.type, ...)
 * @param {(span) => Promise<T>} fn — callback z dostępem do root spana
 * @returns {Promise<T>}
 */
async function withOperationSpan(tracerName, spanName, attrs, fn) {
    const tracer = getTracer(tracerName);
    return await tracer.startActiveSpan(spanName, async (span) => {
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v !== undefined && v !== null) span.setAttribute(k, v);
            }
        }
        try {
            const result = await fn(span);
            // Nie nadpisuj statusu ERROR jeśli fn sam go ustawił.
            const status = span.status;
            if (!status || status.code === SpanStatusCode.UNSET) {
                span.setStatus({ code: SpanStatusCode.OK });
            }
            return result;
        } catch (err) {
            span.recordException(err);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message || String(err),
            });
            throw err;
        } finally {
            span.end();
        }
    });
}

function isEnabled() {
    return enabled;
}

module.exports = {
    init,
    shutdown,
    getTracer,
    withOperationSpan,
    isEnabled,
    SpanStatusCode,
};
