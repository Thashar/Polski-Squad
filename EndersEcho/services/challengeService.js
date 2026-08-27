'use strict';

const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getOwnerId, getProfileIndex, formatProfileDisplayName } = require('../utils/helpers');
const store = require('../../utils/jsonStore');

const logger = createBotLogger('EndersEcho');

/** Ile wyników składa się na wyzwanie (per uczestnik) */
const SCORES_PER_SIDE = 3;
/** Zaproszenie bez odpowiedzi wygasa po 48 h */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
/** Przyjęte wyzwanie trwa maksymalnie 72 h — potem kończy się jako nierozstrzygnięte */
const CHALLENGE_TTL_MS = 72 * 60 * 60 * 1000;
/**
 * Wynik czekający na zatwierdzenie nazwy bossa przez admina. Po 72 h wyzwanie i tak
 * jest już zamknięte, więc trzymanie zaparkowanego wyniku dłużej nie ma sensu.
 */
const PENDING_SCORE_TTL_MS = 72 * 60 * 60 * 1000;
/**
 * Ile wyzwań naraz może prowadzić jeden profil. Komunikaty `challengeErrLimit`
 * i `challengeErrAcceptLimit` są napisane pod wartość 1 — zmiana tej stałej
 * wymaga przepisania ich w obu językach.
 */
const MAX_ACTIVE_PER_PLAYER = 1;
/** Zamknięte wyzwania bez rezultatu (odrzucone, wygasłe zaproszenia) kasujemy po 90 dniach */
const CLOSED_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const SIDES = ['challenger', 'opponent'];
/** Statusy, po których wyzwanie już się nie toczy — historia w Centrum Dowodzenia */
const CLOSED_STATUSES = new Set(['finished', 'unresolved', 'declined', 'expired', 'cancelled']);

/**
 * System wyzwań 1 vs 1 (`/challenge`).
 *
 * Uczestnikiem jest PROFIL (`playerKey`), nie osoba — wyniki w rankingu też są per profil,
 * więc gracz z kilkoma kontami wyzywa i jest wyzywany konkretnym z nich.
 *
 * Plik `data/challenges.json` jest GLOBALNY (nie per-serwer), bo wyzwanie może przebiegać
 * między graczami z dwóch różnych serwerów:
 * {
 *   "challenges": {
 *     "<id>": {
 *       id, status, boss,
 *       createdAt, respondedAt, finishedAt, inviteExpiresAt, expiresAt,
 *       challenger: { playerKey, userId, guildId, username, profileIndex, profileDeleted, scores[], sum },
 *       opponent:   { ...to samo... },
 *       invite: { channelId, messageId },          // DM z zaproszeniem (do wygaszenia przycisków)
 *       result: {
 *         dm: { challenger: {channelId,messageId}, opponent: {...} },
 *         shared: { challenger: bool, opponent: bool },
 *         sharedGuildIds: []
 *       },
 *       winner: "challenger" | "opponent" | null
 *     }
 *   },
 *   "pendingScores": {
 *     "<pid>": { playerKey, userId, guildId, rawBoss, score, scoreValue, timestamp, createdAt }
 *   }
 * }
 *
 * `pendingScores` obsługuje przypadek nierozpoznanej nazwy bossa: wynik nie jest zaliczany
 * od razu, tylko czeka na zmapowanie aliasu przez admina (`resolvePendingBoss`). Wynik
 * oczekujący NIE blokuje rozstrzygnięcia wyzwania — gdy dojdzie po czasie, jest porzucany
 * z komunikatem dla gracza.
 *
 * ⚠️ Uczestnika NIGDY nie zapisujemy jako gotowego napisu „Profil usunięty" — to złamałoby
 * dwujęzyczność na serwerach `eng`. Zapisujemy flagę `profileDeleted`, a etykietę składa
 * `participantName(participant, msgs)` w języku odbiorcy.
 */
class ChallengeService {
    constructor(dataDir, { bossAliasService = null } = {}) {
        this._filePath = path.join(dataDir, 'challenges.json');
        this.bossAliasService = bossAliasService;
        this._timer = null;
        this._onSweep = null;
        store.register(this._filePath, {
            defaultValue: () => ({ challenges: {}, pendingScores: {} }),
            label: 'EndersEcho/challenges',
        });
    }

    // ─── Magazyn ──────────────────────────────────────────────────────────────

    async _data() {
        const parsed = await store.getOrLoad(this._filePath, () => ({ challenges: {}, pendingScores: {} }));
        // O istnieniu danych decyduje ZAWARTOŚĆ — getOrLoad przy braku pliku nie rzuca,
        // tylko zwraca wartość domyślną (patrz pułapki jsonStore w głównym CLAUDE.md)
        if (!parsed || typeof parsed !== 'object') return { challenges: {}, pendingScores: {} };
        if (!parsed.challenges) parsed.challenges = {};
        if (!parsed.pendingScores) parsed.pendingScores = {};
        return parsed;
    }

    async _mutate(fn) {
        await fs.mkdir(path.dirname(this._filePath), { recursive: true });
        return store.mutate(this._filePath, async (draft) => {
            if (!draft.challenges) draft.challenges = {};
            if (!draft.pendingScores) draft.pendingScores = {};
            await fn(draft);
        });
    }

    async load() {
        const data = await this._data();
        const removed = await this._cleanup();
        const active = Object.values(data.challenges).filter(c => c.status === 'active').length;
        const pending = Object.values(data.challenges).filter(c => c.status === 'pending').length;
        logger.info(`⚔️ Wyzwania: ${active} w toku, ${pending} oczekujących na odpowiedź${removed ? ` (usunięto ${removed} przeterminowanych wpisów)` : ''}`);
    }

    /** Kasuje stare wpisy bez rezultatu (odrzucone / wygasłe zaproszenia). Rozstrzygnięte zostają — to historia gracza. */
    async _cleanup() {
        const cutoff = Date.now() - CLOSED_MAX_AGE_MS;
        let removed = 0;
        await this._mutate(draft => {
            for (const [id, ch] of Object.entries(draft.challenges)) {
                if (ch.status !== 'declined' && ch.status !== 'expired') continue;
                const ts = Date.parse(ch.finishedAt || ch.createdAt || 0);
                if (!Number.isFinite(ts) || ts < cutoff) {
                    delete draft.challenges[id];
                    removed++;
                }
            }
        });
        return removed;
    }

    _newId() {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    }

    // ─── Odczyt ───────────────────────────────────────────────────────────────

    async getById(id) {
        const data = await this._data();
        return data.challenges[id] || null;
    }

    // ─── Widok globalny (Centrum Dowodzenia) ──────────────────────────────────

    /** Wszystkie wyzwania, od najnowszych */
    async getAll() {
        const data = await this._data();
        return Object.values(data.challenges)
            .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    }

    /** Wyzwania w toku — od najbliższego terminu, bo to one wymagają uwagi admina */
    async getActive() {
        return (await this.getAll())
            .filter(c => c.status === 'active')
            .sort((a, b) => Date.parse(a.expiresAt || 0) - Date.parse(b.expiresAt || 0));
    }

    /**
     * Zaproszenia czekające na odpowiedź — od NAJNOWSZEGO.
     *
     * Odwrotnie niż `getActive()` (tam decyduje najbliższy termin): zaproszenie samo wygaśnie
     * po 48 h i nie wymaga niczyjej interwencji, a admin patrzy na tę listę pytaniem
     * „kto właśnie kogo wyzwał".
     */
    async getPending() {
        return (await this.getAll()).filter(c => c.status === 'pending');
    }

    /** Wyzwania zamknięte (dowolnym wynikiem), od ostatnio zamkniętego */
    async getClosed() {
        return (await this.getAll())
            .filter(c => CLOSED_STATUSES.has(c.status))
            .sort((a, b) => Date.parse(b.finishedAt || 0) - Date.parse(a.finishedAt || 0));
    }

    /**
     * Bilans wygranych i przegranych w danym miesiącu.
     *
     * Miesiąc liczony po **czasie warszawskim**, nie UTC — panel pokazuje daty w tej strefie,
     * więc wyzwanie zamknięte 1. dnia miesiąca o 00:30 czasu lokalnego musi trafić do nowego
     * miesiąca, a nie do poprzedniego. `sv-SE` daje format `RRRR-MM-DD`, z którego bierzemy
     * pierwsze 7 znaków — bez własnej arytmetyki na przesunięciach CET/CEST.
     *
     * Remisy i wyzwania nierozstrzygnięte nie liczą się żadnej ze stron.
     */
    async monthlyStandings(refDate = new Date()) {
        const monthKey = ChallengeService.warsawMonth(refDate);
        const stats = new Map();

        const bump = (participant, field) => {
            if (!participant?.playerKey) return;
            const entry = stats.get(participant.playerKey) || {
                playerKey: participant.playerKey,
                username: participant.username,
                guildId: participant.guildId,
                profileDeleted: participant.profileDeleted === true,
                profileIndex: participant.profileIndex,
                wins: 0,
                losses: 0,
            };
            entry[field] += 1;
            // Nazwa z najnowszego wyzwania wygrywa — `getAll` daje je od najnowszych
            stats.set(participant.playerKey, entry);
        };

        for (const ch of await this.getAll()) {
            if (ch.status !== 'finished' || !ch.winner) continue;
            if (ChallengeService.warsawMonth(ch.finishedAt) !== monthKey) continue;
            bump(ch[ch.winner], 'wins');
            bump(ch[this.otherSide(ch.winner)], 'losses');
        }

        const all = [...stats.values()];
        const rank = (field) => all
            .filter(e => e[field] > 0)
            .sort((a, b) => b[field] - a[field] || String(a.username || '').localeCompare(String(b.username || ''), 'pl'));

        return { monthKey, winners: rank('wins'), losers: rank('losses') };
    }

    /** Klucz miesiąca (`RRRR-MM`) w strefie Europe/Warsaw */
    static warsawMonth(date) {
        const d = date instanceof Date ? date : new Date(date || 0);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 7);
    }

    /**
     * Ręczne zamknięcie wyzwania przez admina.
     *
     * Rozstrzygamy po AKTUALNYCH sumach, tak samo jak przy komplecie wyników — kto ma więcej,
     * ten wygrywa, równo = remis. Wyjątkiem jest wyzwanie, w którym **nikt** nie wrzucił jeszcze
     * wyniku: „remis 0:0" byłby kłamstwem i przyznawał osiągnięcia za coś, czego nie było,
     * więc takie zamykamy jako `unresolved` — tym samym statusem, co wygaśnięcie po 72 h.
     *
     * @returns {Promise<{challenge: object, outcome: 'finished'|'unresolved'}|null>} null gdy nie ma czego zamykać
     */
    async forceFinish(id, adminName) {
        let result = null;
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (!ch || ch.status !== 'active') return;

            const anyScore = SIDES.some(side => (ch[side]?.scores?.length || 0) > 0);
            if (anyScore) {
                this._finalize(ch);
            } else {
                ch.status = 'unresolved';
                ch.finishedAt = new Date().toISOString();
                ch.winner = null;
            }
            ch.finishedBy = adminName || null;
            result = { challenge: ch, outcome: ch.status };
        });
        return result;
    }

    /** Wszystkie wyzwania profilu (dowolny status), od najnowszych */
    async getForPlayer(playerKey) {
        const data = await this._data();
        return Object.values(data.challenges)
            .filter(c => SIDES.some(s => c[s]?.playerKey === playerKey))
            .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    }

    /** Wyzwania w toku (przyjęte, jeszcze nierozstrzygnięte) */
    async getActiveForPlayer(playerKey) {
        return (await this.getForPlayer(playerKey)).filter(c => c.status === 'active');
    }

    /**
     * Zajęte sloty gracza: wyzwania w toku (obojętnie po której stronie) oraz
     * WYSŁANE zaproszenia czekające na odpowiedź.
     *
     * ⚠️ OTRZYMANE zaproszenia slotu NIE zajmują — dopóki gracz ich nie przyjmie,
     * niczego nie prowadzi. Przy limicie 1 liczenie ich blokowałoby gracza, który
     * dostał dwa zaproszenia od różnych osób: nie mógłby przyjąć ŻADNEGO, bo już
     * samo posiadanie drugiego zaproszenia wypełniałoby limit.
     */
    async countOpenForPlayer(playerKey) {
        return (await this.getForPlayer(playerKey)).filter(c =>
            c.status === 'active' ||
            (c.status === 'pending' && c.challenger?.playerKey === playerKey)
        ).length;
    }

    /** Czy między tymi profilami toczy się już wyzwanie na tym bossie */
    async hasOpenBetween(keyA, keyB, boss) {
        const bossLc = String(boss || '').toLowerCase();
        return (await this.getForPlayer(keyA)).some(c =>
            (c.status === 'active' || c.status === 'pending') &&
            String(c.boss || '').toLowerCase() === bossLc &&
            SIDES.some(s => c[s]?.playerKey === keyB)
        );
    }

    /** Wyniki gracza czekające na zatwierdzenie nazwy bossa */
    async getPendingScoresForPlayer(playerKey) {
        const data = await this._data();
        return Object.values(data.pendingScores).filter(p => p.playerKey === playerKey);
    }

    get maxActivePerPlayer() { return MAX_ACTIVE_PER_PLAYER; }
    get scoresPerSide() { return SCORES_PER_SIDE; }

    // ─── Cykl życia ───────────────────────────────────────────────────────────

    /**
     * Tworzy zaproszenie. Rekord powstaje dopiero po udanej wysyłce DM — wołający
     * najpierw wysyła wiadomość, potem woła `attachInvite()`.
     */
    async create({ challenger, opponent, boss }) {
        const id = this._newId();
        const now = new Date().toISOString();
        const mkSide = (p) => ({
            playerKey: p.playerKey,
            userId: getOwnerId(p.playerKey),
            guildId: p.guildId,
            username: p.username,
            profileIndex: getProfileIndex(p.playerKey),
            profileDeleted: false,
            scores: [],
            sum: 0,
        });
        const challenge = {
            id,
            status: 'pending',
            boss,
            createdAt: now,
            respondedAt: null,
            finishedAt: null,
            inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
            expiresAt: null,
            challenger: mkSide(challenger),
            opponent: mkSide(opponent),
            invite: null,
            result: { dm: {}, shared: { challenger: false, opponent: false }, sharedGuildIds: [] },
            winner: null,
        };
        await this._mutate(draft => { draft.challenges[id] = challenge; });
        return challenge;
    }

    /** Zapamiętuje DM z zaproszeniem (do późniejszego wygaszenia przycisków) */
    async attachInvite(id, channelId, messageId) {
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (ch) ch.invite = { channelId, messageId };
        });
    }

    /** Kasuje wyzwanie — używane, gdy DM do przeciwnika nie doszedł */
    async discard(id) {
        await this._mutate(draft => { delete draft.challenges[id]; });
    }

    async accept(id) {
        let result = null;
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (!ch || ch.status !== 'pending') return;
            ch.status = 'active';
            ch.respondedAt = new Date().toISOString();
            ch.expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
            result = ch;
        });
        return result;
    }

    async decline(id) {
        let result = null;
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (!ch || ch.status !== 'pending') return;
            ch.status = 'declined';
            ch.finishedAt = new Date().toISOString();
            result = ch;
        });
        return result;
    }

    // ─── Zaliczanie wyników ───────────────────────────────────────────────────

    _sideOf(challenge, playerKey) {
        return SIDES.find(s => challenge[s]?.playerKey === playerKey) || null;
    }

    _recalcSum(side) {
        side.sum = side.scores.reduce((acc, s) => acc + (Number(s.scoreValue) || 0), 0);
    }

    /** Czy uczestnik skompletował swoje wyniki */
    _isComplete(side) {
        return (side?.scores?.length || 0) >= SCORES_PER_SIDE;
    }

    /**
     * Dopisuje wynik do wszystkich pasujących wyzwań gracza.
     *
     * @returns {Promise<{ notices: Array, finished: Array }>} notices = dane do embeda/DM,
     *   finished = wyzwania rozstrzygnięte tym wynikiem (do rozesłania powiadomień)
     */
    async registerScore({ playerKey, bossName, score, scoreValue, guildId, timestamp }) {
        if (!playerKey || !bossName) return { notices: [], duplicates: [], finished: [] };
        const bossLc = String(bossName).toLowerCase();
        const ts = timestamp || new Date().toISOString();
        const value = Number(scoreValue) || 0;
        const notices = [];
        const duplicates = [];
        const finished = [];

        await this._mutate(draft => {
            for (const ch of Object.values(draft.challenges)) {
                if (ch.status !== 'active') continue;
                if (String(ch.boss || '').toLowerCase() !== bossLc) continue;
                const side = this._sideOf(ch, playerKey);
                if (!side) continue;
                const me = ch[side];
                if (this._isComplete(me)) continue;
                // Liczą się WYŁĄCZNIE wyniki złożone po akceptacji wyzwania
                if (ch.respondedAt && Date.parse(ts) < Date.parse(ch.respondedAt)) continue;

                const other = ch[side === 'challenger' ? 'opponent' : 'challenger'];

                // TEN SAM WYNIK NIE LICZY SIĘ DWA RAZY.
                // Bez tego wystarczyło wrzucić ten sam screen trzy razy, żeby wypełnić
                // wszystkie sloty jednym rezultatem — wynik nierekordowy też jest zaliczany
                // do wyzwania, więc powtórka nie odbijała się od żadnej innej blokady.
                // Porównujemy `scoreValue` (liczbę), nie napis: „1000B" i „1T" to ten sam wynik.
                // Zakres celowo per UCZESTNIK — przeciwnik może legalnie trafić tę samą wartość.
                if (me.scores.some(s => (Number(s.scoreValue) || 0) === value)) {
                    duplicates.push({
                        id: ch.id,
                        boss: ch.boss,
                        side,
                        count: me.scores.length,
                        total: SCORES_PER_SIDE,
                        sum: me.sum,
                        score,
                        opponent: { ...other },
                    });
                    continue;
                }

                me.scores.push({ score, scoreValue: value, timestamp: ts, guildId });
                this._recalcSum(me);

                notices.push({
                    id: ch.id,
                    boss: ch.boss,
                    side,
                    count: me.scores.length,
                    total: SCORES_PER_SIDE,
                    sum: me.sum,
                    opponent: { ...other },
                });

                if (this._isComplete(me) && this._isComplete(other)) {
                    this._finalize(ch);
                    finished.push(ch);
                }
            }
        });

        return { notices, duplicates, finished };
    }

    /** Rozstrzyga wyzwanie (wołane wewnątrz `_mutate`) */
    _finalize(ch) {
        ch.status = 'finished';
        ch.finishedAt = new Date().toISOString();
        const a = ch.challenger.sum;
        const b = ch.opponent.sum;
        ch.winner = a === b ? null : (a > b ? 'challenger' : 'opponent');
    }

    /**
     * Wynik na nierozpoznanym bossie — czeka na zmapowanie aliasu przez admina.
     * Zapisujemy tylko wtedy, gdy gracz ma jakiekolwiek wyzwanie w toku.
     * @returns {Promise<boolean>} czy wynik został zaparkowany
     */
    async addPendingScore({ playerKey, guildId, rawBoss, score, scoreValue, timestamp }) {
        if (!playerKey || !rawBoss) return false;
        const active = await this.getActiveForPlayer(playerKey);
        if (active.length === 0) return false;

        const pid = this._newId();
        await this._mutate(draft => {
            draft.pendingScores[pid] = {
                playerKey,
                userId: getOwnerId(playerKey),
                guildId,
                rawBoss,
                score,
                scoreValue: Number(scoreValue) || 0,
                timestamp: timestamp || new Date().toISOString(),
                createdAt: new Date().toISOString(),
            };
        });
        return true;
    }

    /**
     * Admin zmapował surową nazwę bossa na angielską — dopisujemy zaparkowane wyniki.
     *
     * @returns {Promise<{ credited: Array, dropped: Array, finished: Array }>}
     *   credited = { userId, guildId, playerKey, score, notices }
     *   dropped  = { userId, guildId, playerKey, score, reason: 'no_challenge'|'too_late' }
     */
    async resolvePendingBoss(rawBoss, englishBoss) {
        if (!rawBoss || !englishBoss) return { credited: [], dropped: [], finished: [] };
        const rawLc = String(rawBoss).toLowerCase().trim();
        const data = await this._data();
        const matching = Object.entries(data.pendingScores)
            .filter(([, p]) => String(p.rawBoss || '').toLowerCase().trim() === rawLc)
            .sort((a, b) => Date.parse(a[1].timestamp || 0) - Date.parse(b[1].timestamp || 0));

        const credited = [];
        const dropped = [];
        const finished = [];

        for (const [pid, pending] of matching) {
            const { notices, duplicates, finished: justFinished } = await this.registerScore({
                playerKey: pending.playerKey,
                bossName: englishBoss,
                score: pending.score,
                scoreValue: pending.scoreValue,
                guildId: pending.guildId,
                timestamp: pending.timestamp,
            });
            await this._mutate(draft => { delete draft.pendingScores[pid]; });

            if (notices.length > 0) {
                credited.push({ ...pending, boss: englishBoss, notices });
                finished.push(...justFinished);
            } else if (duplicates.length > 0) {
                // Ten sam wynik jest już w wyzwaniu — zatwierdzenie nazwy bossa niczego nie zmienia
                dropped.push({ ...pending, boss: englishBoss, reason: 'duplicate' });
            } else {
                // Wynik nie wszedł do żadnego wyzwania. Rozróżniamy dwa powody, bo gracz
                // dostaje o tym DM: „spóźniony" (wyzwanie na tym bossie było, ale zdążyło
                // się rozstrzygnąć albo komplet wyników był już zebrany) kontra „nie ma
                // takiego wyzwania". Szukamy po WSZYSTKICH statusach — po rozstrzygnięciu
                // wyzwanie nie jest już aktywne, więc sprawdzanie samych aktywnych dawałoby
                // zawsze „nie ma wyzwania".
                const bossLcEn = String(englishBoss).toLowerCase();
                const onBoss = (await this.getForPlayer(pending.playerKey))
                    .some(c => String(c.boss || '').toLowerCase() === bossLcEn);
                dropped.push({ ...pending, boss: englishBoss, reason: onBoss ? 'too_late' : 'no_challenge' });
            }
        }

        return { credited, dropped, finished };
    }

    // ─── Publikacja wyniku („pochwal się") ────────────────────────────────────

    async attachResultDm(id, side, channelId, messageId) {
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (!ch) return;
            if (!ch.result) ch.result = { dm: {}, shared: { challenger: false, opponent: false }, sharedGuildIds: [] };
            if (!ch.result.dm) ch.result.dm = {};
            ch.result.dm[side] = { channelId, messageId };
        });
    }

    /**
     * Oznacza publikację wyniku przez jednego z uczestników. Przycisk działa RAZ —
     * stan siedzi w pliku, więc restart bota go nie resetuje.
     * @returns {Promise<{ ok: boolean, reason?: 'already_shared'|'guild_shared'|'not_found', guildId?: string }>}
     */
    async markShared(id, side) {
        let outcome = { ok: false, reason: 'not_found' };
        await this._mutate(draft => {
            const ch = draft.challenges[id];
            if (!ch || !SIDES.includes(side)) return;
            if (!ch.result) ch.result = { dm: {}, shared: { challenger: false, opponent: false }, sharedGuildIds: [] };
            if (!ch.result.shared) ch.result.shared = { challenger: false, opponent: false };
            if (!Array.isArray(ch.result.sharedGuildIds)) ch.result.sharedGuildIds = [];

            if (ch.result.shared[side]) { outcome = { ok: false, reason: 'already_shared' }; return; }
            const guildId = ch[side]?.guildId;
            ch.result.shared[side] = true;
            if (ch.result.sharedGuildIds.includes(guildId)) {
                // Wyścig dwóch kliknięć z tego samego serwera — ogłoszenie już poszło
                outcome = { ok: false, reason: 'guild_shared', guildId };
                return;
            }
            ch.result.sharedGuildIds.push(guildId);

            // Gracze z TEGO SAMEGO serwera dzielą jedno ogłoszenie, więc publikacja przez
            // jednego zamyka sprawę także drugiemu — jego przycisk gaśnie od razu, zamiast
            // czekać na kliknięcie zakończone komunikatem „już opublikowano".
            // Przy RÓŻNYCH serwerach każdy publikuje osobno, u siebie — drugiego nie ruszamy.
            const other = side === 'challenger' ? 'opponent' : 'challenger';
            const alsoClosed = (ch[other]?.guildId === guildId && !ch.result.shared[other]) ? other : null;
            if (alsoClosed) ch.result.shared[alsoClosed] = true;

            outcome = { ok: true, guildId, alsoClosed };
        });
        return outcome;
    }

    // ─── Sweep ────────────────────────────────────────────────────────────────

    /**
     * @param {Function} onEvents - callback z listami do rozesłania powiadomień:
     *   { expiredInvites, unresolved, stalePending }
     */
    start(onEvents) {
        this._onSweep = onEvents;
        const run = () => this.sweep().catch(err => logger.error(`Błąd kontroli wyzwań: ${err.message}`));
        run();
        this._timer = setInterval(run, 60 * 60 * 1000);
        if (this._timer.unref) this._timer.unref();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }

    async sweep() {
        const now = Date.now();
        const expiredInvites = [];
        const unresolved = [];
        const stalePending = [];

        await this._mutate(draft => {
            for (const ch of Object.values(draft.challenges)) {
                if (ch.status === 'pending') {
                    const due = Date.parse(ch.inviteExpiresAt || 0);
                    if (Number.isFinite(due) && due <= now) {
                        ch.status = 'expired';
                        ch.finishedAt = new Date().toISOString();
                        expiredInvites.push(ch);
                    }
                } else if (ch.status === 'active') {
                    const due = Date.parse(ch.expiresAt || 0);
                    if (Number.isFinite(due) && due <= now) {
                        ch.status = 'unresolved';
                        ch.finishedAt = new Date().toISOString();
                        ch.winner = null;
                        unresolved.push(ch);
                    }
                }
            }
            for (const [pid, pending] of Object.entries(draft.pendingScores)) {
                const born = Date.parse(pending.createdAt || 0);
                if (!Number.isFinite(born) || born + PENDING_SCORE_TTL_MS <= now) {
                    stalePending.push(pending);
                    delete draft.pendingScores[pid];
                }
            }
        });

        if (this._onSweep && (expiredInvites.length || unresolved.length || stalePending.length)) {
            try {
                await this._onSweep({ expiredInvites, unresolved, stalePending });
            } catch (err) {
                logger.error(`Błąd powiadomień o wyzwaniach: ${err.message}`);
            }
        }
        return { expiredInvites, unresolved, stalePending };
    }

    // ─── Spójność z profilami ─────────────────────────────────────────────────

    /**
     * Przenosi dane pod nowy klucz profilu — numery slotów zjeżdżają po usunięciu
     * profilu (2→1, 3→2), a numer slotu jest częścią `playerKey`.
     * ⚠️ Wołane z `_migratePlayerKey` w interactionHandlers.
     */
    async renamePlayerKey(fromKey, toKey) {
        if (!fromKey || !toKey || fromKey === toKey) return;
        await this._mutate(draft => {
            for (const ch of Object.values(draft.challenges)) {
                for (const side of SIDES) {
                    if (ch[side]?.playerKey === fromKey) {
                        ch[side].playerKey = toKey;
                        ch[side].userId = getOwnerId(toKey);
                        ch[side].profileIndex = getProfileIndex(toKey);
                    }
                }
            }
            for (const pending of Object.values(draft.pendingScores)) {
                if (pending.playerKey === fromKey) {
                    pending.playerKey = toKey;
                    pending.userId = getOwnerId(toKey);
                }
            }
        });
    }

    /**
     * Gracz skasował profil. Wyzwania w toku i zaproszenia są anulowane, a wpisy
     * rozstrzygnięte ZOSTAJĄ — to również historia przeciwnika. Uczestnik dostaje
     * flagę `profileDeleted`, którą warstwa wyświetlania tłumaczy na „Profil usunięty".
     * @returns {Promise<{ cancelled: Array }>}
     */
    async onProfilePurged(playerKey) {
        const cancelled = [];
        await this._mutate(draft => {
            for (const ch of Object.values(draft.challenges)) {
                const side = this._sideOf(ch, playerKey);
                if (!side) continue;
                if (ch.status === 'pending' || ch.status === 'active') {
                    ch.status = 'cancelled';
                    ch.finishedAt = new Date().toISOString();
                    ch.winner = null;
                    cancelled.push({ ...ch, cancelledSide: side });
                }
                ch[side].profileDeleted = true;
            }
            for (const [pid, pending] of Object.entries(draft.pendingScores)) {
                if (pending.playerKey === playerKey) delete draft.pendingScores[pid];
            }
        });
        return { cancelled };
    }

    /**
     * Cofnięcie wyniku (przycisk gracza / panel admina) — wypisuje wynik z wyzwań
     * BĘDĄCYCH W TOKU. Wyzwania rozstrzygnięte zostają nietknięte: rezultat już padł
     * i obie strony dostały powiadomienie.
     * @returns {Promise<number>} liczba wypisanych wyników
     */
    async removeScore(playerKey, timestamp) {
        if (!playerKey || !timestamp) return 0;
        const target = Date.parse(timestamp);
        if (!Number.isFinite(target)) return 0;
        let removed = 0;
        await this._mutate(draft => {
            for (const ch of Object.values(draft.challenges)) {
                if (ch.status !== 'active') continue;
                const side = this._sideOf(ch, playerKey);
                if (!side) continue;
                const me = ch[side];
                const idx = me.scores.findIndex(s => Date.parse(s.timestamp) === target);
                if (idx === -1) continue;
                me.scores.splice(idx, 1);
                this._recalcSum(me);
                removed++;
            }
        });
        return removed;
    }

    // ─── Prezentacja ──────────────────────────────────────────────────────────

    /**
     * Nazwa uczestnika w języku odbiorcy. Usunięty profil NIE ma nicku — pokazujemy
     * przetłumaczoną etykietę zamiast napisu zapisanego w pliku.
     */
    participantName(participant, msgs) {
        if (!participant) return '—';
        if (participant.profileDeleted) return msgs.challengeDeletedProfile;
        return formatProfileDisplayName(participant.username || participant.userId, participant.profileIndex || 1);
    }

    /** Etykieta statusu wyzwania z punktu widzenia danego profilu */
    statusLabel(challenge, playerKey, msgs) {
        const side = this._sideOf(challenge, playerKey);
        switch (challenge.status) {
            case 'finished':
                if (!challenge.winner) return msgs.challengeStatusDraw;
                return challenge.winner === side ? msgs.challengeStatusWon : msgs.challengeStatusLost;
            case 'unresolved': return msgs.challengeStatusUnresolved;
            case 'cancelled':  return msgs.challengeStatusCancelled;
            case 'declined':   return msgs.challengeStatusDeclined;
            case 'expired':    return msgs.challengeStatusExpired;
            case 'pending':    return msgs.challengeStatusPending;
            default:           return msgs.challengeStatusActive;
        }
    }

    /** Bilans profilu do nagłówka zakładki `/profile` */
    summarize(challenges, playerKey) {
        const out = { won: 0, lost: 0, draw: 0, unresolved: 0, sent: 0, accepted: 0, active: 0 };
        for (const ch of challenges) {
            const side = this._sideOf(ch, playerKey);
            if (!side) continue;
            if (side === 'challenger' && ch.status !== 'expired') out.sent++;
            if (side === 'opponent' && ['active', 'finished', 'unresolved', 'cancelled'].includes(ch.status)) out.accepted++;
            if (ch.status === 'active') out.active++;
            if (ch.status === 'finished') {
                if (!ch.winner) out.draw++;
                else if (ch.winner === side) out.won++;
                else out.lost++;
            }
            if (ch.status === 'unresolved') out.unresolved++;
        }
        return out;
    }

    /** Ścieżka do ikony bossa (thumbnail embeda); null gdy brak grafiki */
    bossImagePath(boss) {
        try {
            return this.bossAliasService?.getBossImagePath?.(boss) || null;
        } catch {
            return null;
        }
    }

    sideOf(challenge, playerKey) {
        return this._sideOf(challenge, playerKey);
    }

    otherSide(side) {
        return side === 'challenger' ? 'opponent' : 'challenger';
    }
}

module.exports = ChallengeService;
module.exports.SCORES_PER_SIDE = SCORES_PER_SIDE;
module.exports.MAX_ACTIVE_PER_PLAYER = MAX_ACTIVE_PER_PLAYER;
