const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const { createBotLogger } = require('../../utils/consoleLogger');
const { downloadDiscordImageBuffer, delay } = require('../utils/helpers');

const logger = createBotLogger('Stalker');

const MAX_IMAGES = 10;              // Discord: max 10 załączników / wiadomość
const EMBED_DESC_LIMIT = 4096;      // limit opisu embeda
const EMBED_TITLE_LIMIT = 256;      // limit tytułu embeda
const CHANNEL_SEND_DELAY_MS = 1000; // odstęp między kanałami (rate limit)

/**
 * News Relay Service - monitoruje kanał, na który przychodzą posty z innego serwera
 * (po angielsku, ze screenami). Odczytuje treść + obrazy przez Google Gemini Vision,
 * tworzy szczegółowe streszczenie PO POLSKU i rozsyła je (embed + oryginalne screeny)
 * na kanały WARNING wszystkich klanów.
 *
 * AI: Gemini przez wspólny llmAdapter (obsługuje multimodal). Włączony gdy jest klucz
 * Google AI (config.ocr.googleAiApiKey) oraz ustawiony kanał źródłowy.
 */
class NewsRelayService {
    /**
     * @param {Object} config
     * @param {{ generate: Function }} llmAdapter — wspólny wrapper z utils/llmAdapter.js
     * @param {Object} clanLogger
     */
    constructor(config, llmAdapter, clanLogger = logger) {
        this.config = config;
        this.adapter = llmAdapter;
        this.logger = clanLogger;

        this.sourceChannelId = config.newsRelay?.sourceChannelId || null;
        this.modelName = config.ocr.googleAiModel || 'gemini-2.5-flash-lite';

        this.enabled = !!config.ocr.googleAiApiKey && !!this.sourceChannelId && !!llmAdapter;

        if (this.enabled) {
            this.logger.success(`✅ News Relay aktywny - kanał źródłowy: ${this.sourceChannelId}, model: ${this.modelName}`);
        } else if (!this.sourceChannelId) {
            this.logger.info('ℹ️ News Relay wyłączony - brak STALKER_LME_NEWS_CHANNEL_ID');
        } else if (!config.ocr.googleAiApiKey) {
            this.logger.warn('⚠️ News Relay wyłączony - brak STALKER_GOOGLE_AI_API_KEY');
        } else {
            this.logger.warn('⚠️ News Relay wyłączony - brak llmAdapter');
        }
    }

    /**
     * Główny handler wiadomości z monitorowanego kanału.
     * Fire-and-forget - łapie własne błędy, nie rzuca.
     * @param {import('discord.js').Message} message
     */
    async handleMessage(message) {
        if (!this.enabled) return;

        try {
            // Nie przetwarzaj własnych wiadomości (ochrona przed pętlą)
            if (message.author?.id === message.client.user.id) return;

            const textContent = this.extractText(message);
            const imageRefs = this.extractImageRefs(message);

            if (!textContent && imageRefs.length === 0) {
                this.logger.info('[NEWS-RELAY] Pominięto wiadomość - brak tekstu i obrazów');
                return;
            }

            this.logger.info(`[NEWS-RELAY] Nowy post (tekst: ${textContent.length} zn., obrazów: ${imageRefs.length}) - przetwarzam...`);

            // Pobierz obrazy do pamięci
            const images = await this.downloadImages(imageRefs);

            // Wyślij do AI po polskie streszczenie
            const summary = await this.summarize(textContent, images);
            if (!summary) {
                this.logger.warn('[NEWS-RELAY] AI nie zwróciło streszczenia - pomijam');
                return;
            }

            // Zbuduj i rozeslij embed na kanały WARNING klanów
            await this.broadcast(message, summary, images);

        } catch (error) {
            this.logger.error(`[NEWS-RELAY] Błąd przetwarzania posta: ${error.message}`);
        }
    }

    /**
     * Zbiera tekst z treści wiadomości oraz ze wszystkich embedów.
     */
    extractText(message) {
        const parts = [];
        if (message.content?.trim()) parts.push(message.content.trim());

        for (const emb of message.embeds || []) {
            if (emb.author?.name) parts.push(emb.author.name);
            if (emb.title) parts.push(emb.title);
            if (emb.description) parts.push(emb.description);
            for (const field of emb.fields || []) {
                parts.push(`${field.name}: ${field.value}`);
            }
            if (emb.footer?.text) parts.push(emb.footer.text);
        }

        return parts.join('\n').trim();
    }

    /**
     * Zbiera referencje obrazów (URL + nazwa) z załączników i embedów.
     * Dla obrazów z embedów używa proxyURL (host Discord CDN objęty whitelistą downloadera).
     */
    extractImageRefs(message) {
        const refs = [];
        const seen = new Set();

        const push = (url, name) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            refs.push({ url, name: name || 'obraz.png' });
        };

        for (const att of message.attachments?.values() || []) {
            const isImage = att.contentType?.startsWith('image/')
                || /\.(png|jpe?g|webp|gif)$/i.test(att.name || att.url || '');
            if (isImage) push(att.url, att.name);
        }

        for (const emb of message.embeds || []) {
            if (emb.image?.proxyURL || emb.image?.url) push(emb.image.proxyURL || emb.image.url, 'embed-image.png');
            if (emb.thumbnail?.proxyURL || emb.thumbnail?.url) push(emb.thumbnail.proxyURL || emb.thumbnail.url, 'embed-thumb.png');
        }

        return refs.slice(0, MAX_IMAGES);
    }

    /**
     * Pobiera obrazy do pamięci. Zwraca listę { name, original: Buffer, png: Buffer }.
     * original - oryginalny bufor (do ponownego załączenia na Discord).
     * png - wersja PNG (przez sharp) dla Gemini Vision.
     * Obrazy, których nie da się pobrać/przetworzyć, są pomijane.
     */
    async downloadImages(imageRefs) {
        const images = [];

        for (const ref of imageRefs) {
            try {
                const original = await downloadDiscordImageBuffer(ref.url);
                let png;
                try {
                    png = await sharp(original).png().toBuffer();
                } catch {
                    png = original; // fallback - użyj oryginału jako danych dla AI
                }
                images.push({ name: this.safeImageName(ref.name), original, png });
            } catch (err) {
                this.logger.warn(`[NEWS-RELAY] Nie udało się pobrać obrazu (${ref.url}): ${err.message}`);
            }
        }

        return images;
    }

    /**
     * Normalizuje nazwę pliku obrazu do bezpiecznej postaci .png/.jpg itd.
     */
    safeImageName(name) {
        const cleaned = (name || 'obraz').replace(/[^\w.\-]/g, '_');
        return /\.(png|jpe?g|webp|gif)$/i.test(cleaned) ? cleaned : `${cleaned}.png`;
    }

    /**
     * Wysyła treść + obrazy do Gemini i zwraca { title, summary } po polsku (lub null).
     */
    async summarize(textContent, images) {
        const parts = [];
        for (const img of images) {
            parts.push({ inlineData: { data: img.png.toString('base64'), mimeType: 'image/png' } });
        }

        const prompt = `Jesteś tłumaczem i redaktorem newsów gildii z gry Survivor.io / Lunar Mine.
Otrzymujesz post z zewnętrznego serwera Discord (najczęściej po angielsku)${images.length > 0 ? ' wraz z załączonymi obrazami/screenami' : ''}.

Twoje zadanie: przygotuj SZCZEGÓŁOWE streszczenie PO POLSKU tego, co przekazuje post${images.length > 0 ? ' ORAZ co widać na obrazach' : ''}.
Zasady:
- Pisz naturalną, poprawną polszczyzną.
- Zachowaj WSZYSTKIE konkretne informacje: liczby, daty, godziny, nazwy, zmiany, instrukcje, nagrody, wymagania, statystyki widoczne na screenach.
- Nie dodawaj informacji, których nie ma w poście ani na obrazach. Nie zgaduj.
- Jeśli post to ogłoszenie/aktualizacja - wypunktuj najważniejsze zmiany.
- Streszczenie ma być kompletne, ale zwięzłe (bez lania wody).

Treść posta (tekst):
"""
${textContent || '(brak tekstu — informacje wyłącznie na obrazach)'}
"""

Zwróć wynik WYŁĄCZNIE jako obiekt JSON (bez bloków kodu, bez komentarzy) w formacie:
{"title": "<krótki tytuł po polsku, max 100 znaków>", "summary": "<szczegółowe streszczenie po polsku>"}`;

        parts.push({ text: prompt });

        let raw;
        try {
            raw = await this.generateWithRetry(parts, 2000);
        } catch (err) {
            this.logger.error(`[NEWS-RELAY] Błąd zapytania do AI: ${err.message}`);
            return null;
        }

        return this.parseSummary(raw);
    }

    /**
     * Wywołanie Gemini przez adapter z prostym retry na przeciążenie (503) i błędy przejściowe.
     */
    async generateWithRetry(parts, maxOutputTokens, maxAttempts = 5) {
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await this.adapter.generate({
                    provider: 'gemini',
                    model: this.modelName,
                    parts,
                    maxOutputTokens,
                    meta: {
                        operationType: 'news.relay',
                        step: 'summarize-news',
                        promptName: 'news-relay-summary',
                        promptVersion: 'v1',
                    },
                });
                return result.content;
            } catch (err) {
                lastError = err;
                const status = err.status ?? err.statusCode ?? err.code;
                const msgStr = typeof err.message === 'string' ? err.message : '';
                const isRetryable = status === 503 || status === 429 || status === 500
                    || status === 'ECONNRESET' || status === 'ETIMEDOUT'
                    || msgStr.includes('503') || msgStr.includes('Service Unavailable') || msgStr.includes('high demand');

                if (!isRetryable || attempt >= maxAttempts) throw err;

                const wait = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
                this.logger.warn(`[NEWS-RELAY] AI błąd ${status ?? 'unknown'}, retry ${attempt}/${maxAttempts - 1} za ${wait}ms`);
                await delay(wait);
            }
        }
        throw lastError;
    }

    /**
     * Parsuje odpowiedź AI (JSON, ewentualnie w bloku kodu). Fallback: cały tekst jako summary.
     */
    parseSummary(text) {
        if (!text || !text.trim()) return null;

        let cleaned = text.trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        // Wytnij pierwszy obiekt JSON z tekstu, jeśli AI dodało coś dookoła
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const candidate = cleaned.slice(firstBrace, lastBrace + 1);
            try {
                const parsed = JSON.parse(candidate);
                const title = (parsed.title || '').toString().trim();
                const summary = (parsed.summary || '').toString().trim();
                if (summary) {
                    return {
                        title: title || '📢 Nowość z serwera',
                        summary,
                    };
                }
            } catch {
                // spadamy do fallbacku
            }
        }

        // Fallback - użyj całości jako streszczenia
        return { title: '📢 Nowość z serwera', summary: cleaned };
    }

    /**
     * Buduje embed ze streszczeniem i rozsyła go (z oryginalnymi screenami) na kanały WARNING klanów.
     */
    async broadcast(message, summary, images) {
        const channelIds = [...new Set(Object.values(this.config.warningChannels).filter(Boolean))];
        if (channelIds.length === 0) {
            this.logger.warn('[NEWS-RELAY] Brak skonfigurowanych kanałów WARNING - nie ma gdzie wysłać');
            return;
        }

        const sourceName = message.author?.username || 'inny serwer';
        const title = this.clamp(summary.title, EMBED_TITLE_LIMIT);
        const description = this.clamp(summary.summary, EMBED_DESC_LIMIT);
        const jumpUrl = message.url;

        let sent = 0;
        for (const channelId of channelIds) {
            try {
                const channel = await message.client.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    this.logger.warn(`[NEWS-RELAY] Nie znaleziono kanału ${channelId}`);
                    continue;
                }

                // Świeże załączniki dla każdego kanału (buforów nie można reużywać między wysyłkami)
                const files = images.map((img, i) => new AttachmentBuilder(img.original, { name: `screen_${i}_${img.name}` }));

                const embed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(title.startsWith('📢') ? title : `📢 ${title}`)
                    .setDescription(description)
                    .setFooter({ text: `Przekazano z: ${sourceName}` })
                    .setTimestamp();

                if (files.length > 0) {
                    embed.setImage(`attachment://${files[0].name}`);
                }
                if (jumpUrl) {
                    embed.addFields({ name: '​', value: `[🔗 Oryginalny post](${jumpUrl})` });
                }

                await channel.send({ embeds: [embed], files });
                sent++;

                if (sent < channelIds.length) await delay(CHANNEL_SEND_DELAY_MS);
            } catch (err) {
                this.logger.error(`[NEWS-RELAY] Błąd wysyłki na kanał ${channelId}: ${err.message}`);
            }
        }

        this.logger.success(`[NEWS-RELAY] Rozesłano streszczenie na ${sent}/${channelIds.length} kanałów WARNING`);
    }

    /**
     * Przycina tekst do limitu (z wielokropkiem).
     */
    clamp(text, limit) {
        if (!text) return '';
        return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
    }
}

module.exports = NewsRelayService;
