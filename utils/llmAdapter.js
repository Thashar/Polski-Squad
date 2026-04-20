'use strict';

/**
 * Wspólny wrapper dla wywołań LLM we wszystkich botach Polski-Squad.
 *
 * Ujednolica inicjalizację providerów (Anthropic / Gemini / Grok / Perplexity),
 * normalizuje payload usage (tokens) i produkuje OpenTelemetry spany z konwencją
 * OpenInference — Langfuse rozpoznaje je jako LLM generations. Spany stają się
 * dziećmi root spana operacji dzięki OTel Context API (nic nie trzeba wiring-ować
 * ręcznie — wystarczy że caller opakował handler przez `withOperationSpan` albo
 * `botOps.run`).
 *
 * Drivers: `gemini` pełna implementacja; `anthropic`, `grok`, `perplexity` —
 * szkielety z `NOT_IMPLEMENTED`, do wypełnienia kiedy bot ich użyje.
 *
 * API:
 *   const adapter = createLlmAdapter({ botSlug: 'endersecho' });
 *   const result = await adapter.generate({
 *       provider:        'gemini',
 *       model:           'gemini-2.5-flash-preview-05-20',
 *       parts:           [ { inlineData: { data, mimeType } }, { text: prompt } ],
 *       maxOutputTokens: 500,
 *       safetySettings:  [...],     // opcjonalne, provider-specific passthrough
 *       meta: {
 *           operationType:  'ocr.analyze',
 *           actorDiscordId: '123',
 *           guildId:        '456',
 *           step:           'victory-check'   // nazwa podspanu
 *       }
 *   });
 *   // result = { content, usage: {inputTokens, outputTokens, thoughtTokens},
 *   //           provider, model, durationMs, traceId }
 */

const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { createBotLogger } = require('./consoleLogger');

const DEFAULT_TRACER_NAME = 'polski-squad-bots';

/**
 * Custom błąd opakowujący problemy providerów LLM — zachowuje providerKind +
 * oryginalny kod błędu. Handler bota może po tym rozróżnić błąd „semantyczny"
 * (odrzucenie z powodów treści) od „technicznego" (rate limit, network).
 */
class LlmAdapterError extends Error {
    constructor(message, { provider, providerCode, cause, semantic = false } = {}) {
        super(message);
        this.name = 'LlmAdapterError';
        this.provider = provider;
        this.providerCode = providerCode;
        this.cause = cause;
        this.semantic = semantic;
    }
}

function createLlmAdapter({ botSlug, tracerName, logger } = {}) {
    const log = logger || createBotLogger('LlmAdapter');
    const effectiveTracerName = tracerName || botSlug || DEFAULT_TRACER_NAME;

    // Lazy-init SDK per provider — nie inicjujemy Anthropic jeśli nikt nie używa
    let geminiClient = null;
    function getGemini() {
        if (geminiClient) return geminiClient;
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const key = process.env.ENDERSECHO_GOOGLE_AI_API_KEY
                 || process.env.GOOGLE_AI_API_KEY;
        if (!key) {
            throw new LlmAdapterError('Brak klucza Google Generative AI w env', {
                provider: 'gemini',
                providerCode: 'NO_API_KEY'
            });
        }
        geminiClient = new GoogleGenerativeAI(key);
        return geminiClient;
    }

    /**
     * Wywołanie Gemini (multimodal). Zwraca znormalizowany payload.
     */
    async function callGemini({ model, parts, maxOutputTokens, safetySettings, meta }) {
        const client = getGemini();
        const generative = client.getGenerativeModel({
            model,
            generationConfig: { maxOutputTokens },
            safetySettings,
        });

        const result = await generative.generateContent({
            contents: [{ role: 'user', parts }],
        });

        const feedback = result.response?.promptFeedback;
        if (feedback?.blockReason) {
            throw new LlmAdapterError(`Safety filter: ${feedback.blockReason}`, {
                provider: 'gemini',
                providerCode: `SAFETY_${feedback.blockReason}`,
                semantic: true,
            });
        }

        const candidate = result.response?.candidates?.[0];
        if (!candidate) {
            throw new LlmAdapterError('Brak kandydatów w odpowiedzi Gemini', {
                provider: 'gemini',
                providerCode: 'NO_CANDIDATES',
            });
        }

        const finish = candidate.finishReason;
        if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
            throw new LlmAdapterError(`Odpowiedź zakończona: ${finish}`, {
                provider: 'gemini',
                providerCode: `FINISH_${finish}`,
            });
        }

        const usage = result.response.usageMetadata || {};
        return {
            content: result.response.text(),
            inputTokens:  usage.promptTokenCount     || 0,
            outputTokens: usage.candidatesTokenCount || 0,
            thoughtTokens: usage.thoughtsTokenCount  || 0,
        };
    }

    // Szkielety pozostałych driverów — do implementacji w kolejnych iteracjach.
    async function callAnthropic(_opts) {
        throw new LlmAdapterError('Anthropic driver niezaimplementowany w v1', {
            provider: 'anthropic', providerCode: 'NOT_IMPLEMENTED'
        });
    }
    async function callGrok(_opts) {
        throw new LlmAdapterError('Grok driver niezaimplementowany w v1', {
            provider: 'grok', providerCode: 'NOT_IMPLEMENTED'
        });
    }
    async function callPerplexity(_opts) {
        throw new LlmAdapterError('Perplexity driver niezaimplementowany w v1', {
            provider: 'perplexity', providerCode: 'NOT_IMPLEMENTED'
        });
    }

    const drivers = {
        gemini:     callGemini,
        anthropic:  callAnthropic,
        grok:       callGrok,
        perplexity: callPerplexity,
    };

    /**
     * Główny punkt wejścia. Owija wywołanie providera w OTel span z konwencją
     * OpenInference (rozpoznawaną przez Langfuse jako LLM generation).
     *
     * Span automatycznie staje się dzieckiem aktywnego kontekstu (root spana
     * operacji z withOperationSpan). Jeśli tracing jest wyłączony, span jest
     * bezoperacyjny, ale wywołanie providera działa normalnie.
     */
    async function generate({
        provider,
        model,
        parts,
        messages,        // alternatywa dla parts (chat completions)
        maxOutputTokens,
        safetySettings,
        meta = {},
    }) {
        const driver = drivers[provider];
        if (!driver) {
            throw new LlmAdapterError(`Nieznany provider: ${provider}`, {
                provider, providerCode: 'UNKNOWN_PROVIDER'
            });
        }

        const tracer = trace.getTracer(effectiveTracerName);
        const spanName = meta.step
            ? `${provider}.${meta.step}`
            : `${provider}.generate`;

        return await tracer.startActiveSpan(spanName, async (span) => {
            const startedAt = Date.now();

            // Atrybuty OpenInference — Langfuse rozpoznaje te spany jako
            // `generation` (LLM call), nie zwykły span.
            span.setAttribute('openinference.span.kind', 'LLM');
            span.setAttribute('llm.system', provider);
            span.setAttribute('llm.model.name', model);
            if (botSlug) span.setAttribute('bot.slug', botSlug);
            if (meta.operationType)  span.setAttribute('operation.type', meta.operationType);
            if (meta.actorDiscordId) span.setAttribute('user.id',        meta.actorDiscordId);
            if (meta.guildId)        span.setAttribute('guild.id',       meta.guildId);
            if (meta.step)           span.setAttribute('llm.step',       meta.step);
            // Prompt metadata — kluczowe dla A/B testów w Langfuse.
            // Filtr (llm.model.name, llm.prompt.name, llm.prompt.version) pozwala
            // porównywać koszty/tokens/durację dla różnych kombinacji.
            if (meta.promptName)     span.setAttribute('llm.prompt.name',    meta.promptName);
            if (meta.promptVersion)  span.setAttribute('llm.prompt.version', meta.promptVersion);

            // input.value — serializujemy messages/parts. Dla obrazów w inlineData
            // zastępujemy base64 placeholderem, żeby nie wrzucać MB-ów do Langfuse.
            try {
                const inputSerializable = (messages || parts || []).map(redactInlineData);
                span.setAttribute('input.value', JSON.stringify(inputSerializable));
            } catch (_) { /* cicho — atrybut jest pomocniczy */ }

            try {
                const raw = await driver({ model, parts, messages, maxOutputTokens, safetySettings, meta });
                const durationMs = Date.now() - startedAt;

                span.setAttribute('llm.usage.prompt_tokens',     raw.inputTokens);
                span.setAttribute('llm.usage.completion_tokens', raw.outputTokens);
                span.setAttribute('llm.token_count.total',
                    (raw.inputTokens || 0) + (raw.outputTokens || 0));
                if (raw.thoughtTokens) {
                    span.setAttribute('llm.usage.thought_tokens', raw.thoughtTokens);
                }
                span.setAttribute('duration.ms', durationMs);

                try {
                    span.setAttribute('output.value', String(raw.content || ''));
                } catch (_) { /* jak wyżej */ }

                span.setStatus({ code: SpanStatusCode.OK });

                const traceId = span.spanContext()?.traceId || null;
                return {
                    content:      raw.content,
                    usage: {
                        inputTokens:   raw.inputTokens,
                        outputTokens:  raw.outputTokens,
                        thoughtTokens: raw.thoughtTokens || 0,
                    },
                    provider,
                    model,
                    durationMs,
                    traceId,
                };
            } catch (err) {
                span.recordException(err);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err.message || String(err),
                });
                if (err.providerCode) span.setAttribute('error.code', err.providerCode);
                throw err;
            } finally {
                span.end();
            }
        });
    }

    return { generate, LlmAdapterError };
}

/**
 * Zamienia base64 obrazów na placeholder, żeby atrybut input.value w span
 * nie wrzucał megabajtów do exportera.
 */
function redactInlineData(part) {
    if (!part || typeof part !== 'object') return part;
    if (part.inlineData && typeof part.inlineData.data === 'string') {
        const { mimeType, data } = part.inlineData;
        return {
            inlineData: {
                mimeType,
                data: `<${Buffer.byteLength(data, 'base64')} bytes, base64 redacted>`,
            },
        };
    }
    return part;
}

module.exports = {
    createLlmAdapter,
    LlmAdapterError,
};
