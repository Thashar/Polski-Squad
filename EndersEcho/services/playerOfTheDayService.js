'use strict';

const path = require('path');
const crypto = require('crypto');
const { getOwnerId, getProfileIndex, formatProfileDisplayName } = require('../utils/helpers');
const store = require('../../utils/jsonStore');

/**
 * Gracz dnia na stronie (endersecho.thashar.dev).
 *
 * Raz na dobę losujemy jednego gracza i wysyłamy jego kartę na stronę, gdzie
 * pokazuje ją plakietka w lewym górnym rogu. Kierunek jak przy rankingach:
 * bot wysyła, strona nigdy nie odpytuje bota.
 *
 * CO JEDZIE NA STRONĘ: nazwa wyświetlana zapisana przy wyniku (ta sama, która
 * stoi już w rankingach TOP 10), serwer i tag, najlepszy wynik z bossem i datą
 * DZIENNĄ, pozycje, liczniki (rekordy, bossowie, osiągnięcia, obserwatorzy),
 * historia wyników do wykresu, tabela rekordów bossów i BILANS WYZWAŃ 1 vs 1
 * (same liczby: rozstrzygnięte pojedynki, wygrane, przegrane, remisy).
 *
 * CZEGO NIE WYSYŁAMY, ŚWIADOMIE:
 *   • ID Discorda i klucza profilu — nie opuszczają bota w żadnej postaci,
 *   • awatara z Discorda — strona rysuje u siebie jedną złotą sylwetkę, tę samą
 *     dla każdego wyróżnionego, więc nie idzie stąd żaden obrazek ani nic, co
 *     byłoby pochodną konta,
 *   • listy pozostałych profili gracza — nie mówimy publicznie, że kilka kont
 *     w grze należy do jednej osoby,
 *   • nazw ról i pozycji w rankingach ról — to wewnętrzna struktura serwera,
 *   • kto obserwuje gracza — jedzie sama liczba, nigdy lista,
 *   • z kim gracz się pojedynkował – z wyzwań jedzie sam bilans, nigdy nazwy
 *     przeciwników, bossowie pojedynków ani terminy; drugi gracz nie ma jak
 *     wypisać się z CUDZEJ karty, więc nie może się na niej znaleźć,
 *   • godzin — wszędzie same daty dzienne, bo pełne znaczniki czasu układają
 *     się w rytm dnia i strefę czasową konkretnej osoby.
 *
 * Dane wykresu i rekordów bossów bot policzył sam ze zgłoszonych zrzutów
 * ekranu — nie pochodzą z API Discorda. Nazwa wyświetlana pochodzi z rankingu
 * zapisanego przy wyniku, więc losowanie nie woła Discorda ani razu.
 *
 * Wypisanie się: `setOptOut(userId, true)` (przycisk w /profile). Działa na
 * WŁAŚCICIELA, więc obejmuje wszystkie jego profile, a gdy wypisuje się akurat
 * dzisiejszy gracz dnia, wpis na stronie kasujemy od razu i do północy zostaje
 * pusto — plakietka po prostu się nie pokazuje.
 */

/**
 * Okno aktywności: losujemy wyłącznie spośród graczy, którzy w tym czasie coś
 * pobili. Bez tego karta trafiałaby na profile, na których od pół roku nic się
 * nie dzieje – a płaski wykres pod czyimś nickiem na stronie głównej wygląda
 * jak wytknięcie, nie jak wyróżnienie.
 *
 * UWAGA na to, co bot faktycznie potrafi zmierzyć. Nie ma trwałego znacznika
 * „ostatnio wysłał wynik" (cooldowny /update żyją pięć minut i są kasowane), więc
 * aktywnością jest tu NAJNOWSZY POBITY REKORD: albo wynik z rankingu, albo
 * rekord dowolnego bossa. Ktoś, kto gra codziennie i od miesiąca się nie poprawił,
 * do puli nie wejdzie – i tak nie miałby czym się pochwalić.
 */
const ACTIVE_DAYS = 30;

/** Ile dni historii trafia na wykres. */
const CHART_DAYS = 365;
/** Górny limit punktów wykresu — tyle samo przyjmuje Worker. */
const MAX_CHART_POINTS = 60;
/** Górny limit wierszy tabeli bossów — tyle samo przyjmuje Worker. */
const MAX_BOSS_ROWS = 25;
/** Jak często sprawdzamy, czy zmieniła się doba (Europe/Warsaw). */
const CHECK_INTERVAL_MS = 60 * 1000;
/** Limit pojedynczego POST-a — jak przy rankingach, wysyłka jest fire-and-forget. */
const POST_TIMEOUT_MS = 15 * 1000;

class PlayerOfTheDayService {
    /**
     * @param {Object} config - config bota
     * @param {Object} logger
     * @param {Object} deps - { rankingService, guildConfigService, scoreHistoryService,
     *                          bossRecordService, achievementService, notificationService,
     *                          challengeService }
     */
    constructor(config, logger, deps = {}) {
        this.config = config;
        this.logger = logger;
        this.rankingService = deps.rankingService || null;
        this.guildConfigService = deps.guildConfigService || null;
        this.scoreHistoryService = deps.scoreHistoryService || null;
        this.bossRecordService = deps.bossRecordService || null;
        this.achievementService = deps.achievementService || null;
        this.notificationService = deps.notificationService || null;
        this.challengeService = deps.challengeService || null;

        this.token = process.env.ENDERSECHO_WEB_SYNC_TOKEN || null;
        // Osobny adres jest opcjonalny — domyślnie bierzemy ten od rankingów
        // i podmieniamy końcówkę, żeby nie trzeba było dokładać zmiennej.
        const rankingsUrl = process.env.ENDERSECHO_WEB_SYNC_URL || '';
        const derived = rankingsUrl.replace(/\/api\/ee-rankings\/?$/, '/api/ee-potd');
        // Gdy adres rankingów ma inny kształt, niż zakładamy, podmiana nic nie
        // zmieni — wtedy WOLIMY nie działać wcale, zamiast wysyłać kartę gracza
        // pod endpoint rankingów, gdzie i tak zostałaby odrzucona.
        this.url = process.env.ENDERSECHO_WEB_POTD_URL
            || (derived !== rankingsUrl ? derived : null);

        const dataDir = config.ranking?.dataDir || path.join(__dirname, '../data');
        this.stateFile = path.join(dataDir, 'potd_state.json');
        // Preferencje graczy trzymamy w OSOBNYM pliku niż stan losowania: reset
        // rotacji nie może przypadkiem skasować niczyjego wypisania się.
        this.optOutFile = path.join(dataDir, 'potd_optout.json');

        this._state = { date: null, playerKey: null, nick: null, seen: [] };
        this._optOut = {};
        this._timer = null;
        this._queue = Promise.resolve();
    }

    isEnabled() {
        return !!(this.url && this.token && this.rankingService);
    }

    async load() {
        try {
            const s = await store.getOrLoad(this.stateFile, () => ({}));
            this._state = {
                date: s?.date || null,
                playerKey: s?.playerKey || null,
                nick: s?.nick || null,
                seen: Array.isArray(s?.seen) ? s.seen : [],
            };
        } catch {
            this._state = { date: null, playerKey: null, nick: null, seen: [] };
        }
        try {
            this._optOut = (await store.getOrLoad(this.optOutFile, () => ({}))) || {};
        } catch {
            this._optOut = {};
        }
    }

    _saveState() {
        this._queue = this._queue.then(async () => {
            try {
                await store.set(this.stateFile, this._state);
            } catch (err) {
                this.logger.warn(`⚠️ Nie udało się zapisać stanu gracza dnia: ${err.message}`);
            }
        }).catch(() => {});
        return this._queue;
    }

    async _saveOptOut() {
        try {
            await store.set(this.optOutFile, this._optOut);
        } catch (err) {
            this.logger.warn(`⚠️ Nie udało się zapisać wypisań z gracza dnia: ${err.message}`);
        }
    }

    /* ── preferencje gracza ─────────────────────────────────────────────── */

    /** Czy właściciel konta wypisał się z wyróżnienia na stronie. */
    isOptedOut(userIdOrKey) {
        return this._optOut[getOwnerId(userIdOrKey)] === true;
    }

    /**
     * Przycisk w /profile. Wypisanie działa NATYCHMIAST: gdy wypisuje się
     * dzisiejszy gracz dnia, kasujemy wpis na stronie, zamiast czekać na północ.
     * @param {string} userId
     * @param {boolean} optedOut
     */
    async setOptOut(userId, optedOut) {
        const id = getOwnerId(userId);
        if (optedOut) this._optOut[id] = true;
        else delete this._optOut[id];
        await this._saveOptOut();

        if (optedOut && this._state.playerKey && getOwnerId(this._state.playerKey) === id) {
            this._state.playerKey = null;
            this._state.nick = null;
            await this._saveState();
            await this._push(null).catch(() => {});
            this.logger.info('🌐 Gracz dnia wypisał się ze strony — wpis skasowany');
        }
    }

    /* ── losowanie ──────────────────────────────────────────────────────── */

    /** Dzisiejsza data w strefie bota, w formacie YYYY-MM-DD. */
    _today() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
    }

    /**
     * Ziarno z daty — restart bota w środku dnia nie zmienia wylosowanej osoby
     * nawet wtedy, gdy plik stanu przepadnie.
     */
    _seed(dateStr) {
        const h = crypto.createHash('sha1').update(`ee-potd:${dateStr}`).digest();
        return h.readUInt32BE(0);
    }

    /**
     * Czy gracz nadaje się do pokazania.
     * @param {Object} entry - wpis z rankingu globalnego
     * @param {Object} bossTs - { playerKey: ms } z getLastBossRecordTimestamps
     * @param {number} cutoff - najstarszy akceptowany znacznik aktywności (ms)
     */
    _eligible(entry, bossTs, cutoff) {
        if (!entry || !entry.playerKey) return false;
        // Bez zapisanej nazwy nie ma czego pokazać, a NIE wolno nam podstawić
        // w to miejsce ID — to jedyna rzecz, której na stronie być nie może.
        if (!entry.username) return false;
        if (this.isOptedOut(entry.playerKey)) return false;

        // Aktywność = najnowszy pobity rekord, czy to wynik z rankingu, czy
        // rekord pojedynczego bossa. Bierzemy późniejszy z dwóch, bo można
        // poprawić bossa, nie ruszając swojego najlepszego wyniku w ogóle.
        const scoreTs = Date.parse(entry.timestamp);
        const last = Math.max(
            Number.isFinite(scoreTs) ? scoreTs : 0,
            bossTs?.[entry.playerKey] || 0
        );
        return last >= cutoff;
    }

    /**
     * Losuje gracza na dziś, jeżeli jeszcze go nie ma, i wysyła kartę na stronę.
     * @param {import('discord.js').Client} client
     * @param {boolean} force - przelosuj nawet gdy dzisiejszy wpis już istnieje
     */
    async drawIfNeeded(client, force = false) {
        if (!this.isEnabled()) return;
        const today = this._today();
        if (!force && this._state.date === today && this._state.playerKey) return;

        try {
            const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [];
            const [global, bossTs] = await Promise.all([
                this.rankingService.getGlobalRanking(),
                this.bossRecordService
                    ? this.bossRecordService.getLastBossRecordTimestamps(allGuildIds).catch(() => ({}))
                    : Promise.resolve({}),
            ]);

            const cutoff = Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000;
            const pool = global.filter(e => this._eligible(e, bossTs, cutoff));
            // Pusta pula to normalny stan przy cichym miesiącu — wtedy kasujemy
            // wpis i plakietki po prostu nie ma, zamiast wracać do nieaktywnych.
            if (!pool.length) {
                this._state = { date: today, playerKey: null, nick: null, seen: this._state.seen };
                await this._saveState();
                await this._push(null);
                return;
            }

            // Bez powtórek: dopóki nie przejdzie cała pula, nikt nie wraca.
            const seen = new Set(this._state.seen);
            let candidates = pool.filter(e => !seen.has(e.playerKey));
            let nextSeen = this._state.seen;
            if (!candidates.length) {
                candidates = pool;
                nextSeen = [];
            }

            const picked = candidates[this._seed(today) % candidates.length];
            const payload = await this.buildPayload(client, picked, today);
            if (!payload) return;

            await this._push(payload);
            this._state = {
                date: today,
                playerKey: picked.playerKey,
                nick: payload.nick,
                // Lista „już byli" nie może rosnąć w nieskończoność — trzymamy
                // ją w rozmiarze puli, bo tyle wystarcza do pełnej rotacji.
                seen: [...nextSeen, picked.playerKey].slice(-Math.max(pool.length, 1)),
            };
            await this._saveState();
            this.logger.info(`🌐 Gracz dnia (${today}): ${payload.nick}`);
        } catch (err) {
            this.logger.warn(`⚠️ Błąd losowania gracza dnia: ${this._errText(err)}`);
        }
    }

    /**
     * Ręczne nadanie wyróżnienia z Centrum Dowodzenia — wchodzi natychmiast
     * i zastępuje dzisiejsze losowanie. Jutrzejsze odbywa się normalnie.
     *
     * Filtr aktywności celowo NIE obowiązuje: skoro ktoś wskazuje gracza
     * palcem, to wie, kogo chce pokazać. Wypisanie się gracza obowiązuje
     * jednak zawsze — tego nie wolno obejść z panelu.
     *
     * @param {import('discord.js').Client} client
     * @param {string} playerKey
     * @returns {Promise<{ok: boolean, reason?: string, nick?: string}>}
     */
    async setManual(client, playerKey) {
        if (!this.isEnabled()) return { ok: false, reason: 'disabled' };
        if (this.isOptedOut(playerKey)) return { ok: false, reason: 'opted_out' };

        try {
            const global = await this.rankingService.getGlobalRanking();
            const entry = global.find(e => e.playerKey === playerKey);
            if (!entry) return { ok: false, reason: 'not_found' };
            if (!entry.username) return { ok: false, reason: 'no_name' };

            const today = this._today();
            const payload = await this.buildPayload(client, entry, today);
            if (!payload) return { ok: false, reason: 'build_failed' };

            await this._push(payload);
            // Dopisujemy do „już byli", żeby losowanie nie wyciągnęło tej samej
            // osoby ponownie za kilka dni.
            const seen = this._state.seen.filter(k => k !== playerKey);
            this._state = { date: today, playerKey: playerKey, nick: payload.nick, seen: [...seen, playerKey] };
            await this._saveState();
            this.logger.info(`🌐 Gracz dnia nadany ręcznie (${today}): ${payload.nick}`);
            return { ok: true, nick: payload.nick };
        } catch (err) {
            this.logger.warn(`⚠️ Błąd ręcznego nadania gracza dnia: ${this._errText(err)}`);
            return { ok: false, reason: 'error' };
        }
    }

    /** Kto stoi dziś na stronie — do podglądu w Centrum Dowodzenia. */
    getStatus() {
        return {
            enabled: this.isEnabled(),
            date: this._state.date,
            playerKey: this._state.playerKey,
            nick: this._state.nick,
            optedOut: Object.keys(this._optOut).length,
            rotated: this._state.seen.length,
        };
    }

    /* ── budowa karty ───────────────────────────────────────────────────── */

    /**
     * Składa dokładnie to, co ma się pokazać na stronie. Nic ponad to nie jest
     * tu budowane — pole, którego nie ma w zwracanym obiekcie, nie ma szans
     * trafić do przeglądarki.
     */
    async buildPayload(client, entry, today) {
        const playerKey = entry.playerKey;
        const sourceGuildId = entry.sourceGuildId;
        const allGuildIds = this.guildConfigService?.getAllConfiguredGuildIds() || [sourceGuildId];

        const [sortedPlayers, globalRanking, history, bossRecords, bossPositions, achievements, watchers, challenges] =
            await Promise.all([
                this.rankingService.getSortedPlayers(sourceGuildId).catch(() => []),
                this.rankingService.getGlobalRanking().catch(() => []),
                this.scoreHistoryService
                    ? this.scoreHistoryService.getUserHistoryAllGuilds(allGuildIds, playerKey, 36500).catch(() => [])
                    : Promise.resolve([]),
                this.bossRecordService
                    ? this.bossRecordService.getUserBossRecordsAllGuilds(allGuildIds, playerKey).catch(() => ({}))
                    : Promise.resolve({}),
                this.bossRecordService
                    ? this.bossRecordService.getPlayerBossPositions(allGuildIds, playerKey).catch(() => ({}))
                    : Promise.resolve({}),
                this.achievementService
                    ? this.achievementService.getUnlockedAchievements(sourceGuildId, playerKey).catch(() => [])
                    : Promise.resolve([]),
                this.notificationService
                    ? this.notificationService.getSubscribersForTarget(playerKey, sourceGuildId).catch(() => [])
                    : Promise.resolve([]),
                this.challengeService
                    ? this.challengeService.getForPlayer(playerKey).catch(() => [])
                    : Promise.resolve([]),
            ]);

        const serverIdx = sortedPlayers.findIndex(p => (p.playerKey || p.userId) === playerKey);
        const globalIdx = globalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);

        // Nazwa z rankingu, nie z API — losowanie nie odpytuje Discorda.
        const nick = formatProfileDisplayName(entry.username, getProfileIndex(playerKey));

        const guild = client?.guilds?.cache?.get(sourceGuildId) || null;
        const guildCfg = this.guildConfigService?.getConfig(sourceGuildId) || null;
        const guildName = guild?.name || guildCfg?.guildName || null;
        const tag = this.config.getAllGuilds().find(g => g.id === sourceGuildId)?.tag || guildCfg?.tag || null;

        const cutoff = Date.now() - CHART_DAYS * 24 * 60 * 60 * 1000;
        const chart = history
            .filter(h => Number.isFinite(h?.scoreValue) && new Date(h.timestamp).getTime() >= cutoff)
            .slice(-MAX_CHART_POINTS)
            .map(h => ({ d: h.timestamp, v: h.scoreValue, s: h.score }));

        // Wyzwania: z całej historii pojedynków bierzemy SAME LICZBY. Nazwa
        // przeciwnika byłaby tu cudzą daną na karcie, z której ten drugi nie ma
        // jak się wypisać – jego zgoda dotyczy jego własnej karty, nie tej.
        // Gdy gracz nie stoczył ani jednego pojedynku, pole jedzie jako null
        // i strona nie rysuje bloku – pusty bilans 0:0 wyglądałby jak zarzut.
        const chal = this.challengeService && challenges.length
            ? this.challengeService.summarize(challenges, playerKey)
            : null;
        const settled = chal ? chal.won + chal.lost + chal.draw : 0;
        const challengeStats = settled > 0
            ? { settled, won: chal.won, lost: chal.lost, draw: chal.draw }
            : null;

        const bosses = Object.entries(bossRecords)
            .sort((a, b) => (b[1].scoreValue || 0) - (a[1].scoreValue || 0))
            .slice(0, MAX_BOSS_ROWS)
            .map(([boss, rec]) => ({
                boss,
                score: rec.score || null,
                date: rec.timestamp || null,
                globalRank: bossPositions?.[boss] ?? null,
            }));

        return {
            date: today,
            nick,
            guildName,
            tag,
            guildPlayers: sortedPlayers.length || null,
            score: entry.score || null,
            bossName: entry.bossName || null,
            scoreDate: entry.timestamp || null,
            serverRank: serverIdx !== -1 ? serverIdx + 1 : null,
            globalRank: globalIdx !== -1 ? globalIdx + 1 : null,
            globalTotal: globalRanking.length || null,
            records: history.length || 0,
            bosses: Object.keys(bossRecords).length || 0,
            achievements: achievements.length || 0,
            watchers: watchers.length || 0,
            history: chart,
            bossRecords: bosses,
            challenges: challengeStats,
        };
    }

    /* ── wysyłka ────────────────────────────────────────────────────────── */

    _errText(err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
            return `przekroczono limit ${POST_TIMEOUT_MS / 1000}s`;
        }
        const detail = err?.cause?.code || err?.cause?.message;
        return detail ? `${err.message} (${detail})` : (err?.message || String(err));
    }

    /** @param {Object|null} player - null kasuje wpis na stronie */
    async _push(player) {
        if (!this.isEnabled()) return;
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify({ player }),
            signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
        }
    }

    /* ── harmonogram ────────────────────────────────────────────────────── */

    /**
     * Sprawdzanie co minutę zamiast timera do północy: przeżywa zmianę czasu,
     * uśpienie procesu i restart, a przy braku zmiany doby nie robi nic.
     */
    start(client) {
        if (!this.isEnabled() || this._timer) return;
        this.drawIfNeeded(client).catch(() => {});
        this._timer = setInterval(() => {
            this.drawIfNeeded(client).catch(() => {});
        }, CHECK_INTERVAL_MS);
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }
}

module.exports = PlayerOfTheDayService;
