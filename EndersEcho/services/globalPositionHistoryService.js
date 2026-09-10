'use strict';

const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getProfileIndex } = require('../utils/helpers');
const store = require('../../utils/jsonStore');

const logger = createBotLogger('EndersEcho');

// Siatka bezpieczeństwa — gdyby jakaś ścieżka zmieniająca ranking nie zawołała sync(),
// stan pozycji dogoni ranking bez czekania na restart bota.
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Data, od której liczymy czas spędzony na miejscu #1 (pole „Najdłużej na 1. miejscu"
 * pod raportem TOP 10). Wszystko wcześniejsze jest odcinane — również z odcinków, które
 * tę datę przekraczają: liczy się wyłącznie ich część PO niej.
 *
 * ⚠️ To wartość dziedzinowa, nie techniczna — ustawiona świadomie na 1 maja 2026.
 * Zmiana tej stałej zmienia wynik Hall of Fame wszystkim graczom naraz, więc nie ruszaj jej
 * „przy okazji". Po zmianie trzeba też podnieść `BACKFILL_VERSION` w
 * `backfill-position-history.js`, inaczej wartości odtworzone wstecz zostaną te stare.
 */
const TOP1_COUNT_FROM = Date.UTC(2026, 4, 1); // 1 maja 2026, 00:00 UTC

/**
 * Ile z odcinka na #1 wpada do licznika — czyli jego część po `TOP1_COUNT_FROM`.
 * @param {number} od  początek odcinka (ms)
 * @param {number} do  koniec odcinka (ms)
 * @returns {number}
 */
function policzOdcinekTop1(od, do_) {
    return Math.max(0, do_ - Math.max(od, TOP1_COUNT_FROM));
}

/**
 * Historia pozycji w rankingu GLOBALNYM (plik: data/global_position_history.json).
 *
 * Odpowiada na trzy pytania, na które sam ranking odpowiedzieć nie potrafi, bo zna wyłącznie
 * stan „teraz":
 *   1. od kiedy gracz trzyma swoją obecną pozycję (wiersz pod graczem w raporcie TOP 10),
 *   2. kto najdłużej okupował miejsce #1 (pole „Hall of Fame" pod raportem),
 *   3. jaka była najwyższa pozycja gracza w historii (profil gracza).
 *
 * ⚠️ Czas liczony jest OD MOMENTU WDROŻENIA tego serwisu — wcześniejszych pozycji nikt nie
 * zapisywał, więc nie da się ich odtworzyć. Przy pierwszym sync() każdy gracz dostaje
 * `since` = teraz, a `best` = jego bieżąca pozycja.
 *
 * Kształt wpisu:
 * ```
 * playerKey -> {
 *   position,   // aktualna pozycja globalna (null = wypadł z rankingu)
 *   since,      // ISO — od kiedy trzyma `position`
 *   best,       // najwyższa pozycja w historii (liczbowo NAJMNIEJSZA)
 *   bestAt,     // ISO — kiedy `best` zostało osiągnięte po raz pierwszy
 *   top1Ms,     // ZAMKNIĘTE odcinki czasu na miejscu #1 od TOP1_COUNT_FROM (bieżący dolicza _top1Total)
 *   username,   // ostatni znany nick — gracz może wypaść z rankingu, a zostać w Hall of Fame
 *   guildId     // serwer źródłowy najlepszego wyniku, do pobrania nicku z Discorda
 * }
 * ```
 */
class GlobalPositionHistoryService {
    /**
     * @param {string} dataDir            ścieżka do EndersEcho/data/
     * @param {object} rankingService     RankingService
     */
    constructor(dataDir, rankingService) {
        this.dataDir        = dataDir;
        this.rankingService = rankingService;
        this._file          = path.join(dataDir, 'global_position_history.json');
        this._data          = null;
        this._timer         = null;
        this.client         = null;
        // sync() bywa wołany z kilku miejsc naraz (zapis rankingu + timer) — bez tej blokady
        // dwa przebiegi czytałyby ten sam stan i drugi nadpisywałby wynik pierwszego
        this._syncInFlight  = false;

        store.register(this._file, {
            defaultValue: () => ({ players: {} }),
            label: 'EndersEcho/global_position_history',
        });
    }

    /**
     * @param {import('discord.js').Client} client
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Ranking globalny zawężony do serwerów, na których bot FAKTYCZNIE jest — dokładnie tak,
     * jak liczy go raport TOP 10 i profil gracza. Bez tego zawężenia serwis widziałby inną
     * kolejność niż raport (wpisy serwerów, z których bota usunięto), więc przy każdej wysyłce
     * pozycje „rozjeżdżałyby się" i licznik czasu startowałby od zera.
     * @returns {Promise<Array>}
     */
    async _currentRanking() {
        const activeGuildIds = this.client?.isReady()
            ? new Set(this.client.guilds.cache.keys())
            : null;
        return this.rankingService.getGlobalRanking(activeGuildIds);
    }

    // ── persistence ────────────────────────────────────────────────────────────

    async load() {
        try {
            const raw = await store.getOrLoad(this._file, () => ({ players: {} }));
            this._data = (raw && typeof raw === 'object') ? raw : { players: {} };
        } catch (err) {
            logger.error(`[PozycjeGlobalne] Błąd wczytywania historii pozycji: ${err.message}`);
            this._data = { players: {} };
        }
        if (!this._data.players || typeof this._data.players !== 'object') this._data.players = {};
        return this._data;
    }

    async _save() {
        this._data.updatedAt = new Date().toISOString();
        await store.set(this._file, this._data);
    }

    // ── scheduler ──────────────────────────────────────────────────────────────

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this.sync().catch(() => {}), SYNC_INTERVAL_MS);
        logger.info('[PozycjeGlobalne] Śledzenie pozycji w rankingu globalnym uruchomione');
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    // ── sync ───────────────────────────────────────────────────────────────────

    /**
     * Przepisuje bieżący ranking na historię pozycji. Zapis na dysk TYLKO gdy coś się zmieniło —
     * ranking bywa zapisywany często, a większość zapisów nie rusza kolejności.
     * @param {Array|null} ranking  gotowy ranking globalny (oszczędza ponownego liczenia)
     * @returns {Promise<boolean>} czy stan uległ zmianie
     */
    async sync(ranking = null) {
        if (this._syncInFlight) return false;
        this._syncInFlight = true;
        try {
            if (!this._data) await this.load();

            const list = ranking || await this._currentRanking();
            if (!Array.isArray(list)) return false;

            const now    = Date.now();
            const nowIso = new Date(now).toISOString();
            const players = this._data.players;
            const seen    = new Set();
            let changed   = false;

            for (let i = 0; i < list.length; i++) {
                const entry = list[i];
                const key   = entry.playerKey || entry.userId;
                if (!key) continue;
                const position = i + 1;
                seen.add(key);

                let rec = players[key];
                if (!rec) {
                    rec = players[key] = { position: null, since: null, best: null, bestAt: null, top1Ms: 0 };
                    changed = true;
                }

                if (entry.username && rec.username !== entry.username) {
                    rec.username = entry.username;
                    changed = true;
                }
                if (entry.sourceGuildId && rec.guildId !== entry.sourceGuildId) {
                    rec.guildId = entry.sourceGuildId;
                    changed = true;
                }

                if (rec.position !== position) {
                    // Domknij odcinek na miejscu #1, zanim gracz z niego zejdzie
                    if (rec.position === 1 && rec.since) {
                        rec.top1Ms = (rec.top1Ms || 0) + policzOdcinekTop1(Date.parse(rec.since), now);
                    }
                    rec.position = position;
                    rec.since    = nowIso;
                    changed = true;
                }

                if (rec.best === null || rec.best === undefined || position < rec.best) {
                    rec.best   = position;
                    rec.bestAt = nowIso;
                    changed = true;
                }
            }

            // Gracze, którzy wypadli z rankingu — czas na pozycji przestaje płynąć,
            // ale rekord życiowy i dorobek na #1 zostają
            for (const [key, rec] of Object.entries(players)) {
                if (seen.has(key)) continue;
                if (rec.position === null) continue;
                if (rec.position === 1 && rec.since) {
                    rec.top1Ms = (rec.top1Ms || 0) + policzOdcinekTop1(Date.parse(rec.since), now);
                }
                rec.position = null;
                rec.since    = null;
                changed = true;
            }

            if (changed) await this._save();
            return changed;
        } catch (err) {
            logger.error(`[PozycjeGlobalne] Błąd synchronizacji pozycji: ${err.message}`);
            return false;
        } finally {
            this._syncInFlight = false;
        }
    }

    // ── odczyt ─────────────────────────────────────────────────────────────────

    /**
     * @param {Object} rec
     * @returns {number} łączny czas na miejscu #1 — zamknięte odcinki + trwający
     */
    _top1Total(rec) {
        let ms = rec?.top1Ms || 0;
        if (rec?.position === 1 && rec.since) ms += policzOdcinekTop1(Date.parse(rec.since), Date.now());
        return ms;
    }

    /**
     * @param {string} playerKey
     * @returns {{position: number|null, since: string|null, holdMs: number|null, best: number|null, bestAt: string|null, top1Ms: number}|null}
     */
    getPlayerStats(playerKey) {
        const rec = this._data?.players?.[playerKey];
        if (!rec) return null;
        return {
            position: rec.position ?? null,
            since:    rec.since ?? null,
            holdMs:   rec.since ? Math.max(0, Date.now() - Date.parse(rec.since)) : null,
            best:     rec.best ?? null,
            bestAt:   rec.bestAt ?? null,
            top1Ms:   this._top1Total(rec),
        };
    }

    /**
     * Najdłużej okupujący miejsce #1 — również gracze, którzy dawno z niego zeszli.
     * @param {number} limit
     * @returns {Array<{playerKey, username, guildId, profileIndex, totalMs, isCurrent}>}
     */
    getTop1Leaderboard(limit = 3) {
        return Object.entries(this._data?.players || {})
            .map(([playerKey, rec]) => ({
                playerKey,
                username:     rec.username || null,
                guildId:      rec.guildId || null,
                profileIndex: getProfileIndex(playerKey),
                totalMs:      this._top1Total(rec),
                isCurrent:    rec.position === 1,
            }))
            .filter(p => p.totalMs > 0)
            .sort((a, b) => b.totalMs - a.totalMs)
            .slice(0, limit);
    }

    // ── utrzymanie danych ──────────────────────────────────────────────────────

    /**
     * Przenumerowanie slotów profili (2→1, 3→2) po usunięciu profilu.
     * @returns {Promise<boolean>} czy było co przenosić
     */
    async renamePlayerKey(oldKey, newKey) {
        if (oldKey === newKey) return false;
        if (!this._data) await this.load();
        const rec = this._data.players[oldKey];
        if (!rec) return false;
        this._data.players[newKey] = rec;
        delete this._data.players[oldKey];
        await this._save();
        return true;
    }

    /** Kasuje historię pozycji profilu (usunięcie profilu przez gracza). */
    async removePlayer(playerKey) {
        if (!this._data) await this.load();
        if (!this._data.players[playerKey]) return false;
        delete this._data.players[playerKey];
        await this._save();
        return true;
    }

    // ── formatowanie ───────────────────────────────────────────────────────────

    /**
     * Zwięzły czas trwania: `12d 3h`, `5h 12m`, `44m`, `<1m`.
     * Jednostki celowo skrótowe i wspólne dla PL/EN — ten sam format co
     * rankingService.formatTimeSince, żeby embedy nie mieszały dwóch konwencji.
     * @param {number|null} ms
     * @returns {string|null}
     */
    static formatDuration(ms) {
        if (ms === null || ms === undefined || Number.isNaN(ms)) return null;
        if (ms < 60_000) return '<1m';
        const totalMinutes = Math.floor(ms / 60_000);
        const days    = Math.floor(totalMinutes / 1440);
        const hours   = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0)  return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
}

GlobalPositionHistoryService.TOP1_COUNT_FROM = TOP1_COUNT_FROM;
GlobalPositionHistoryService.policzOdcinekTop1 = policzOdcinekTop1;

module.exports = GlobalPositionHistoryService;
