'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Zbiorcze liczniki reakcji pod embedami rozsyłanymi na WSZYSTKIE serwery
 * (`📢 Wyślij Info` i ogłoszenie nowego serwera).
 *
 * Każda kopia embeda dostaje pod spodem rząd przycisków: ikona reakcji + SUMA tej
 * reakcji ze wszystkich serwerów. Dzięki temu gracz na serwerze A widzi, że embed
 * zebrał 40 👍, nawet jeśli u niego kliknęły go 3 osoby.
 *
 * Przyciski są klikalne, ale świadomie nic nie robią — to wyłącznie licznik.
 * Klik i tak MUSI zostać potwierdzony (`deferUpdate`), bo inaczej Discord pokazuje
 * „This interaction failed"; przycisk wyłączony odpada, bo nie byłby klikalny.
 *
 * Skąd biorą się liczby: po każdym zdarzeniu reakcji przeliczamy stan OD NOWA —
 * pobieramy wszystkie kopie wiadomości i sumujemy `reaction.count`. Licznik trzymany
 * w pliku dryfowałby przy usunięciach reakcji, `RemoveAll` i restartach bota.
 *
 * WYMAGANIA GATEWAY (bez nich funkcja jest martwa):
 *   • intent `GuildMessageReactions` (nieuprzywilejowany),
 *   • partials `Message`, `Reaction`, `Channel` — ogłoszenia żyją tygodniami, a po
 *     restarcie cache jest pusty; bez partiali reakcja pod wiadomością spoza cache'u
 *     NIE wywołuje zdarzenia w ogóle.
 */

/**
 * Ile reakcji dostaje własny przycisk z ikoną — 4 najczęstsze. Piąty slot zostaje dla
 * zbiorczego `➕`, więc całość mieści się w JEDNYM rzędzie (Discord: 5 przycisków/rząd)
 * i embed nie puchnie niezależnie od tego, ile różnych emotek się pojawi.
 */
const TOP_BUTTONS = 4;
/** Po tylu dniach przestajemy pilnować rozgłoszenia (i edytować stare wiadomości). */
const RETENTION_DAYS = 30;
/** Zlepia serię reakcji w jedną przebudowę — inaczej każda reakcja = N edycji wiadomości. */
const DEBOUNCE_MS = 5000;

class BroadcastReactionService {
    /**
     * @param {Object} config - config bota (ranking.dataDir)
     * @param {Object} logger
     */
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.stateFile = path.join(
            config.ranking?.dataDir || path.join(__dirname, '../data'),
            'broadcast_reactions.json'
        );
        this._broadcasts = {};       // broadcastId → { createdAt, type, messages: [...] }
        this._messageIndex = new Map(); // messageId → broadcastId (szybkie trafienie w zdarzeniu)
        this._timers = new Map();    // broadcastId → timeout debounce'u
        this._queue = Promise.resolve(); // serializacja zapisów pliku stanu
    }

    async load() {
        try {
            const raw = await fs.readFile(this.stateFile, 'utf8');
            const data = JSON.parse(raw);
            this._broadcasts = data?.broadcasts || {};
        } catch {
            this._broadcasts = {};
        }
        this._pruneOld();
        this._rebuildIndex();
    }

    /** Odsiewa rozgłoszenia starsze niż RETENTION_DAYS — nie edytujemy wiadomości sprzed miesięcy. */
    _pruneOld() {
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const [id, bc] of Object.entries(this._broadcasts)) {
            const ts = Date.parse(bc?.createdAt || '');
            if (!Number.isFinite(ts) || ts < cutoff) delete this._broadcasts[id];
        }
    }

    _rebuildIndex() {
        this._messageIndex.clear();
        for (const [id, bc] of Object.entries(this._broadcasts)) {
            for (const m of bc.messages || []) this._messageIndex.set(m.messageId, id);
        }
    }

    async _saveState() {
        this._queue = this._queue.then(async () => {
            try {
                await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
                await fs.writeFile(this.stateFile, JSON.stringify({ broadcasts: this._broadcasts }, null, 2), 'utf8');
            } catch (err) {
                this.logger.warn(`⚠️ Nie udało się zapisać stanu reakcji rozgłoszeń: ${err.message}`);
            }
        }).catch(() => {});
        return this._queue;
    }

    /**
     * Zapamiętuje komplet kopii jednego rozgłoszenia. Wołane PO rozesłaniu embeda.
     * @param {string} type - 'info' | 'new_server' (tylko do diagnostyki)
     * @param {Array<{guildId: string, channelId: string, messageId: string}>} messages
     * @returns {Promise<string|null>} broadcastId albo null gdy nie ma czego śledzić
     */
    async register(type, messages) {
        const clean = (messages || []).filter(m => m?.messageId && m?.channelId);
        if (!clean.length) return null;

        const broadcastId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        this._broadcasts[broadcastId] = { createdAt: new Date().toISOString(), type, messages: clean };
        for (const m of clean) this._messageIndex.set(m.messageId, broadcastId);
        await this._saveState();
        return broadcastId;
    }

    /** @returns {string|null} do którego rozgłoszenia należy ta wiadomość */
    findBroadcastId(messageId) {
        return this._messageIndex.get(messageId) || null;
    }

    /**
     * Zdarzenie reakcji — planuje przebudowę przycisków całego rozgłoszenia.
     * Fire-and-forget; seria reakcji zlewa się w jedną przebudowę.
     */
    onReactionEvent(messageId, client) {
        const broadcastId = this.findBroadcastId(messageId);
        if (!broadcastId) return;
        if (this._timers.has(broadcastId)) return;

        this._timers.set(broadcastId, setTimeout(() => {
            this._timers.delete(broadcastId);
            this.refresh(broadcastId, client).catch(err =>
                this.logger.warn(`⚠️ Błąd przeliczania reakcji rozgłoszenia: ${err.message}`)
            );
        }, DEBOUNCE_MS));
    }

    /**
     * Przelicza sumy ze wszystkich kopii i przebudowuje przyciski na każdej z nich.
     * @returns {Promise<boolean>} czy cokolwiek zaktualizowano
     */
    async refresh(broadcastId, client) {
        const bc = this._broadcasts[broadcastId];
        if (!bc) return false;

        // 1. Zbierz kopie wiadomości. Te, których już nie ma (skasowany kanał/wiadomość),
        //    wypadają z rejestru — inaczej próbowalibyśmy ich w nieskończoność.
        const live = [];
        const totals = new Map(); // klucz emoji → { count, emoji }
        let dropped = false;

        for (const ref of bc.messages) {
            const msg = await this._fetchMessage(client, ref);
            if (!msg) { dropped = true; continue; }
            live.push({ ref, msg });

            for (const reaction of msg.reactions.cache.values()) {
                const emoji = reaction.emoji;
                const key = emoji.id || emoji.name;
                if (!key) continue;
                const prev = totals.get(key);
                totals.set(key, { count: (prev?.count || 0) + (reaction.count || 0), emoji });
            }
        }

        if (dropped) {
            bc.messages = live.map(l => l.ref);
            this._rebuildIndex();
            await this._saveState();
        }
        if (!live.length) return false;

        // 2. Zbuduj wspólny zestaw przycisków — identyczny na każdym serwerze
        const rows = this._buildRows(broadcastId, totals, client);

        // 3. Nanieś go na wszystkie kopie
        let updated = 0;
        for (const { msg } of live) {
            try {
                await msg.edit({ components: rows });
                updated++;
            } catch (err) {
                this.logger.warn(`⚠️ Nie udało się zaktualizować liczników reakcji: ${err.message}`);
            }
        }
        return updated > 0;
    }

    /** Pobiera wiadomość po referencji; null gdy zniknęła albo bot stracił dostęp. */
    async _fetchMessage(client, ref) {
        try {
            const channel = await client.channels.fetch(ref.channelId).catch(() => null);
            if (!channel?.messages) return null;
            return await channel.messages.fetch(ref.messageId).catch(() => null);
        } catch {
            return null;
        }
    }

    /**
     * Buduje rząd przycisków z posortowanych sum: 4 najczęstsze reakcje z ikoną,
     * a na końcu zbiorczy `➕ N`.
     *
     * Do zbiorczego wpada wszystko, co nie dostało własnego przycisku:
     *   • reakcje poza pierwszą czwórką,
     *   • emotki customowe z serwerów, na których NIE MA bota — Discord odrzuciłby
     *     taki komponent, więc nie da się ich pokazać z ikoną.
     * Dzięki temu suma wszystkich przycisków zawsze równa się sumie wszystkich reakcji.
     *
     * @param {Map<string, {count: number, emoji: Object}>} totals
     * @returns {Array} ActionRow[] — w praktyce zawsze jeden rząd
     */
    _buildRows(broadcastId, totals, client) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const renderable = [];
        let hiddenTotal = 0;

        for (const { count, emoji } of totals.values()) {
            if (count <= 0) continue;
            if (emoji.id && !client.emojis.cache.has(emoji.id)) {
                hiddenTotal += count; // emotka z obcego serwera — nie da się wstawić na przycisk
                continue;
            }
            renderable.push({ count, emoji });
        }
        renderable.sort((a, b) => b.count - a.count);

        const shown = renderable.slice(0, TOP_BUTTONS);

        // Wszystko poza czołową czwórką trafia do zbiorczego — suma ma się zgadzać
        for (const extra of renderable.slice(TOP_BUTTONS)) hiddenTotal += extra.count;

        const buttons = shown.map((entry, idx) => {
            const btn = new ButtonBuilder()
                .setCustomId(`bcr_${broadcastId}_${idx}`)
                .setLabel(String(entry.count))
                .setStyle(ButtonStyle.Secondary);
            // Unicode → sam znak; customowa → { id, animated } (Discord odrzuca surowy `<a:x:id>` w tym polu)
            btn.setEmoji(entry.emoji.id
                ? { id: entry.emoji.id, animated: !!entry.emoji.animated }
                : entry.emoji.name);
            return btn;
        });

        if (hiddenTotal > 0) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`bcr_${broadcastId}_other`)
                .setLabel(String(hiddenTotal))
                .setEmoji('➕')
                .setStyle(ButtonStyle.Secondary));
        }

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        return rows;
    }

    /** Zatrzymuje oczekujące przebudowy (graceful shutdown). */
    stop() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }
}

module.exports = BroadcastReactionService;
