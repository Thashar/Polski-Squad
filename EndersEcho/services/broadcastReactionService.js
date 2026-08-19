'use strict';

const fs = require('fs').promises;
const path = require('path');
const store = require('../../utils/jsonStore');

/**
 * Zbiorcze liczniki reakcji pod embedami rozsyłanymi na WSZYSTKIE serwery
 * (`📢 Wyślij Info`, ogłoszenie nowego serwera i cykliczny raport Global TOP10).
 *
 * Każda kopia embeda dostaje pod spodem rząd przycisków: ikona reakcji + SUMA tej
 * reakcji ze wszystkich serwerów. Dzięki temu gracz na serwerze A widzi, że embed
 * zebrał 40 👍, nawet jeśli u niego kliknęły go 3 osoby.
 *
 * Klik w licznik DZIAŁA JAK REAKCJA: pierwszy dodaje głos (+1), kolejny go cofa (-1), a zmiana
 * natychmiast wchodzi na wszystkie kopie embeda. Bot nie może dodać reakcji „w imieniu" gracza,
 * więc kliknięcia trzymamy jako osobny rejestr głosów (`bc.votes`) i doliczamy do sum.
 *
 * ⚠️ JEDNA OSOBA = JEDEN GŁOS NA EMOTKĘ. Gracz, który zostawił prawdziwą reakcję i kliknął
 * jeszcze przycisk, NIE liczy się dwa razy — sumy dedupikują po ID (`_countUnique`), a klik
 * przy istniejącej własnej reakcji próbuje ją po prostu zdjąć (toggle jak na Discordzie).
 *
 * Klik w przycisk „ostatnia reakcja" (rząd 5) pokazuje ephemeral z pełną listą reagujących,
 * pogrupowaną po serwerze (`collectReactors`). Zbiorczy `➕` zostaje aktywny, ale jest bezczynny
 * — klik i tak MUSI zostać potwierdzony (`deferUpdate`), bo inaczej Discord pokazuje
 * „This interaction failed".
 *
 * Kolejność liczników: malejąco po sumie, a przy remisie STARSZA reakcja wyżej.
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
 * Ile przycisków w rzędzie. Discord pozwala na 5, ale przy czterech etykiety liczników
 * są szersze i cały blok czyta się spokojniej.
 */
const BUTTONS_PER_ROW = 4;
/**
 * Ile reakcji dostaje własny przycisk z ikoną — 15 najczęstszych. Szesnasty slot zostaje
 * dla zbiorczego `➕`, ale ten dokłada się DOPIERO gdy jest co w nim schować (16. emotka
 * w górę). Liczniki wypełniają więc maksymalnie CZTERY rzędy po cztery przyciski (Discord:
 * 5 rzędów na wiadomość), a piąty rząd zostaje dla „ostatniej reakcji".
 */
const TOP_BUTTONS = 15;
/**
 * Po tylu dniach przestajemy pilnować rozgłoszenia (i edytować stare wiadomości).
 * Po wypadnięciu z rejestru przyciski zostają na wiadomości, ale bot nie wie już, do
 * którego rozgłoszenia należą — klik nic nie robi. Stąd 90 dni, nie 30: ogłoszenia
 * wiszą na kanałach miesiącami i mają pozostać klikalne.
 */
const RETENTION_DAYS = 90;

/**
 * Rotacja kolorów przycisku „ostatnia reakcja". Discord NIE animuje przycisków — paleta to
 * cztery style, a kolor da się zmienić wyłącznie przy przebudowie komponentów. Dlatego każda
 * kolejna reakcja przestawia styl na następny w cyklu: zielony → niebieski → czerwony.
 * (Szary jest zarezerwowany dla liczników, żeby oba rzędy dało się odróżnić na pierwszy rzut oka.)
 */
const LAST_REACTION_STYLES = ['Success', 'Primary', 'Danger'];

/** Discord: max 80 znaków etykiety przycisku. */
const MAX_LABEL = 80;
/** Zlepia serię reakcji w jedną przebudowę — inaczej każda reakcja = N edycji wiadomości. */
const DEBOUNCE_MS = 5000;
/**
 * Okno debounce'u rośnie z liczbą kopii: jedna przebudowa to edycja wiadomości na KAŻDYM
 * serwerze, więc przy stu kopiach nie ma sensu robić jej co pięć sekund. Przy 100 serwerach
 * daje to 10 s, przy kilkunastu zostaje przy minimum.
 */
const DEBOUNCE_PER_COPY_MS = 100;
/** Górna granica okna — nawet ogromne rozgłoszenie ma się odświeżyć w rozsądnym czasie. */
const DEBOUNCE_MAX_MS = 60000;

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
        this._dirtyCopies = new Map();  // broadcastId → Set(messageId) kopii do dosynchronizowania
        this._refreshing = new Map();   // broadcastId → trwająca przebudowa (blokada współbieżności)
        this._refreshQueued = new Set();// broadcastId → zamówiona JEDNA domykająca przebudowa
        this._queue = Promise.resolve(); // serializacja zapisów pliku stanu
    }

    async load() {
        try {
            const data = await store.getOrLoad(this.stateFile, () => ({}));
            this._broadcasts = data?.broadcasts || {};
        } catch {
            this._broadcasts = {};
        }
        // W czasie przestoju bota zdarzenia reakcji NIE przychodziły, więc zapisany stan
        // kopii mógł rozjechać się z prawdą. Oznaczamy je jako nieaktualne — pierwsze
        // przeliczenie danego rozgłoszenia zsynchronizuje je od nowa (raz, nie przy każdym).
        for (const bc of Object.values(this._broadcasts)) {
            for (const copy of Object.values(bc.copies || {})) copy.stale = true;
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
                await store.set(this.stateFile, { broadcasts: this._broadcasts });
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

        // Czyścimy też TUTAJ, nie tylko przy starcie: bot potrafi chodzić tygodniami bez
        // restartu, a wtedy retencja liczona wyłącznie w `load()` nigdy by nie zadziałała
        // i plik rósłby w nieskończoność
        this._pruneOld();
        this._rebuildIndex();

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
     * Zapamiętuje, KTO ostatnio zostawił reakcję — pod licznikami wyświetlamy to w osobnym
     * rzędzie („<nick> z serwera <tag> zostawił reakcję"). Wołane WYŁĄCZNIE przy dodaniu
     * reakcji: usunięcie zmienia liczniki, ale nie unieważnia informacji o ostatnim autorze
     * (poprzedniego i tak nie dałoby się odtworzyć).
     *
     * @param {Object} reaction - MessageReaction (może być partial)
     * @param {Object} user - autor reakcji (może być partial)
     * @param {Object} client
     */
    async recordLastReaction(reaction, user, client) {
        const messageId = reaction?.message?.id;
        const broadcastId = this.findBroadcastId(messageId);
        if (!broadcastId) return;

        const bc = this._broadcasts[broadcastId];
        if (!bc) return;

        // Serwer bierzemy z REJESTRU, nie ze zdarzenia — przy partialu `reaction.message.guild`
        // bywa puste, a rejestr i tak wie, na którym serwerze leży ta kopia
        const entry = (bc.messages || []).find(m => m.messageId === messageId);
        const guildId = entry?.guildId || reaction?.message?.guildId || null;
        const guildCfg = this.config.getAllGuilds().find(g => g.id === guildId) || null;
        // Na przycisku pokazujemy NAZWĘ serwera; tag zostaje jako zapas, gdy bot nie ma
        // serwera w cache'u (np. tuż po restarcie)
        const guildName = client?.guilds?.cache?.get(guildId)?.name || guildCfg?.tag || '?';

        const resolvedUser = user?.partial ? await user.fetch().catch(() => null) : user;
        const userName = await this._resolveMemberName(client, guildId, resolvedUser || user);

        const emoji = reaction.emoji;
        bc.lastReaction = {
            userName,
            guildName,
            guildTag: guildCfg?.tag || null,
            emoji: { id: emoji?.id || null, name: emoji?.name || null, animated: !!emoji?.animated },
            at: new Date().toISOString(),
        };
        // Każda nowa reakcja przestawia kolor na kolejny w cyklu
        bc.styleIndex = ((bc.styleIndex ?? -1) + 1) % LAST_REACTION_STYLES.length;
        await this._saveState();
    }

    /**
     * Przełącza głos oddany PRZYCISKIEM (nie prawdziwą reakcją).
     *
     * Zwraca `state`:
     *   'added'    — głos dodany (+1),
     *   'removed'  — głos cofnięty (-1),
     *   'reaction' — gracz ma pod tą wiadomością własną PRAWDZIWĄ reakcję tą emotką i nie
     *                udało się jej zdjąć (brak uprawnienia „Zarządzanie wiadomościami").
     *                Głosu nie dodajemy — jedna osoba ma liczyć się raz.
     *   'unreacted'— gracz miał prawdziwą reakcję i została zdjęta (efekt: -1, jak toggle).
     *
     * @param {Object} opts.message - wiadomość, pod którą kliknięto (kopia z serwera gracza)
     */
    async toggleVote({ broadcastId, emojiKey, user, userName, guildId, message, client }) {
        const bc = this._broadcasts[broadcastId];
        if (!bc || !user?.id) return { state: 'noop' };

        // Nick zapamiętany przy kliknięciu — lista reagujących nie dociąga potem członków
        bc.people = bc.people || {};
        if (userName) bc.people[user.id] = userName;

        bc.votes = bc.votes || {};
        bc.voteEmojis = bc.voteEmojis || {};
        const voters = bc.votes[emojiKey] || {};

        if (voters[user.id]) {
            delete voters[user.id];
            if (Object.keys(voters).length === 0) delete bc.votes[emojiKey];
            else bc.votes[emojiKey] = voters;
            await this._saveState();
            return { state: 'removed' };
        }

        // Prawdziwa reakcja tego gracza = ten sam głos. Zdejmujemy ją, zamiast dokładać drugi.
        const own = [...(message?.reactions?.cache?.values() || [])]
            .find(r => (r.emoji.id || r.emoji.name) === emojiKey);
        if (own) {
            const users = await own.users.fetch().catch(() => null);
            if (users?.has(user.id)) {
                const removed = await own.users.remove(user.id).then(() => true).catch(() => false);
                if (removed) {
                    // Stan tej kopii aktualizujemy od razu — inaczej trzeba by ją odpytywać
                    // ponownie tylko po to, żeby dowiedzieć się o zmianie, którą sami zrobiliśmy
                    const copy = bc.copies?.[message?.id];
                    const wpis = copy?.emojis?.[emojiKey];
                    if (wpis) {
                        wpis.ids = (wpis.ids || []).filter(id => id !== user.id);
                        if (wpis.ids.length === 0) delete copy.emojis[emojiKey];
                    }
                    await this._saveState();
                }
                return { state: removed ? 'unreacted' : 'reaction' };
            }
        }

        // Emotkę zapamiętujemy przy głosie — gdy wszystkie prawdziwe reakcje znikną,
        // nie mielibyśmy z czego odtworzyć ikony przycisku
        const emojiSrc = own?.emoji || this._findEmojiDescriptor(bc, emojiKey);
        if (emojiSrc) {
            bc.voteEmojis[emojiKey] = {
                id: emojiSrc.id || null,
                name: emojiSrc.name || null,
                animated: !!emojiSrc.animated,
            };
        }
        voters[user.id] = { guildId: guildId || null, at: new Date().toISOString() };
        bc.votes[emojiKey] = voters;
        await this._saveState();
        return { state: 'added' };
    }

    /** Opis emotki znany z wcześniejszych głosów — dla kluczy bez żywej reakcji */
    _findEmojiDescriptor(bc, emojiKey) {
        const stored = bc.voteEmojis?.[emojiKey];
        if (stored) return stored;
        if (bc.lastReaction?.emoji && (bc.lastReaction.emoji.id || bc.lastReaction.emoji.name) === emojiKey) {
            return bc.lastReaction.emoji;
        }
        return null;
    }

    /** Zapamiętuje autora ostatniej reakcji na podstawie KLIKNIĘCIA przycisku */
    async recordLastFromVote({ broadcastId, userName, guildId, emojiKey, client }) {
        const bc = this._broadcasts[broadcastId];
        if (!bc) return;
        const guildCfg = this.config.getAllGuilds().find(g => g.id === guildId) || null;
        const emoji = this._findEmojiDescriptor(bc, emojiKey) || { id: null, name: emojiKey, animated: false };

        bc.lastReaction = {
            userName,
            guildName: client?.guilds?.cache?.get(guildId)?.name || guildCfg?.tag || '?',
            guildTag: guildCfg?.tag || null,
            emoji: { id: emoji.id || null, name: emoji.name || null, animated: !!emoji.animated },
            at: new Date().toISOString(),
        };
        bc.styleIndex = ((bc.styleIndex ?? -1) + 1) % LAST_REACTION_STYLES.length;
        await this._saveState();
    }

    /** Nick serwerowy autora reakcji; przy braku dostępu do membera schodzi do nazwy globalnej. */
    async _resolveMemberName(client, guildId, user) {
        const fallback = user?.displayName || user?.username || 'Unknown';
        try {
            const guild = client?.guilds?.cache?.get(guildId);
            if (!guild || !user?.id) return fallback;
            const member = guild.members.cache.get(user.id)
                || await guild.members.fetch(user.id).catch(() => null);
            return member?.displayName || fallback;
        } catch {
            return fallback;
        }
    }

    /**
     * Zdarzenie reakcji — planuje przebudowę przycisków całego rozgłoszenia.
     * Fire-and-forget; seria reakcji zlewa się w jedną przebudowę.
     */
    onReactionEvent(messageId, client) {
        const broadcastId = this.findBroadcastId(messageId);
        if (!broadcastId) return;

        // Zmieniła się TA kopia — przy przeliczaniu odpytamy tylko ją
        if (!this._dirtyCopies.has(broadcastId)) this._dirtyCopies.set(broadcastId, new Set());
        this._dirtyCopies.get(broadcastId).add(messageId);
        if (this._timers.has(broadcastId)) return;

        // Okno rośnie z liczbą kopii: przebudowa to edycja wiadomości na każdym serwerze,
        // więc przy stu kopiach nie ma sensu robić jej co pięć sekund
        const kopie = (this._broadcasts[broadcastId]?.messages || []).length;
        const okno = Math.min(DEBOUNCE_MAX_MS, Math.max(DEBOUNCE_MS, kopie * DEBOUNCE_PER_COPY_MS));

        this._timers.set(broadcastId, setTimeout(() => {
            this._timers.delete(broadcastId);
            const brudne = this._dirtyCopies.get(broadcastId);
            this._dirtyCopies.delete(broadcastId);
            this.refresh(broadcastId, client, { dirty: brudne }).catch(err =>
                this.logger.warn(`⚠️ Błąd przeliczania reakcji rozgłoszenia: ${err.message}`)
            );
        }, okno));
    }

    /**
     * Przebudowa WSZYSTKICH żyjących rozgłoszeń — przycisk `🔁 Odśwież ogłoszenia`
     * w Centrum Dowodzenia.
     *
     * Po co: układ przycisków siedzi w wiadomości i zmienia go wyłącznie `msg.edit()`.
     * Zmiana zasad w kodzie (np. liczba liczników) wchodzi na starą wiadomość dopiero przy
     * najbliższej reakcji albo kliknięciu, więc bez tego trzeba czekać, aż ktoś kliknie.
     *
     * Rozgłoszenia lecą PO KOLEI, z przerwą między nimi: jedno przeliczenie to odczyt i
     * edycja kopii na każdym serwerze, a kilkanaście rozgłoszeń naraz to prosta droga do
     * rate limitu.
     *
     * @returns {Promise<{total: number, updated: number, skipped: number}>}
     */
    async refreshAll(client, { delayMs = 1500 } = {}) {
        const ids = Object.keys(this._broadcasts);
        let updated = 0;
        let skipped = 0;

        for (const [i, id] of ids.entries()) {
            try {
                const ok = await this.refresh(id, client, { force: true });
                if (ok) updated++; else skipped++;
            } catch (err) {
                skipped++;
                this.logger.warn(`⚠️ Nie udało się odświeżyć rozgłoszenia ${id}: ${err.message}`);
            }
            if (i < ids.length - 1 && delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        return { total: ids.length, updated, skipped };
    }

    /**
     * Przebudowa NATYCHMIAST po kliknięciu przycisku — gracz ma zobaczyć zmianę licznika od
     * razu, a nie po oknie debounce'u przeznaczonym dla serii prawdziwych reakcji.
     * Zaplanowane odświeżenie kasujemy, bo ta przebudowa i tak policzy wszystko od nowa.
     */
    async refreshAfterVote(broadcastId, client) {
        const timer = this._timers.get(broadcastId);
        if (timer) {
            clearTimeout(timer);
            this._timers.delete(broadcastId);
        }
        // Głos z przycisku nie zmienia żadnej kopii na Discordzie — sumy liczymy z zapisanego
        // stanu, więc nie ma czego odpytywać. Zostają same edycje tych kopii, na których
        // licznik faktycznie się zmienił.
        return this.refresh(broadcastId, client, { skipSync: true });
    }

    /**
     * Synchronizuje JEDNĄ kopię rozgłoszenia: odczytuje wiadomość i zapisuje w stanie, KTO
     * zareagował którą emotką (`bc.copies[messageId].emojis[key].ids`).
     *
     * ⚠️ To jest sedno przeliczania przyrostowego. Wcześniej każde zdarzenie reakcji kazało
     * odczytać kopie ze WSZYSTKICH serwerów — przy stu serwerach ponad dwieście zapytań na
     * jedną reakcję. Zmiana dotyczy zawsze jednej kopii, więc tylko ją odpytujemy; sumy
     * powstają z zapisanego stanu (`_totalsFromState`).
     *
     * Zapisujemy ID osób, nie same liczby, bo ten sam stan obsługuje trzy rzeczy naraz:
     * licznik, dedupe z głosami z przycisków i listę reagujących (bez ani jednego zapytania).
     *
     * @returns {Promise<boolean>} czy kopia żyje
     */
    async _syncCopy(bc, ref, client) {
        const msg = await this._fetchMessage(client, ref);
        if (!msg) return false;

        bc.copies = bc.copies || {};
        const wpis = bc.copies[ref.messageId] || {};
        const emojis = {};
        let position = 0;

        for (const reaction of msg.reactions.cache.values()) {
            const emoji = reaction.emoji;
            const key = emoji.id || emoji.name;
            position++;
            if (!key) continue;

            const users = await reaction.users.fetch().catch(() => null);
            const ids = [];
            for (const user of (users?.values() || [])) {
                if (user.bot) continue;
                ids.push(user.id);
                // Nick zapamiętujemy RAZ, przy odczycie — dzięki temu lista reagujących
                // nie musi potem dociągać członków (przy stu serwerach to sto zapytań)
                if (!bc.people?.[user.id]) {
                    bc.people = bc.people || {};
                    const guild = client.guilds?.cache?.get(ref.guildId) || null;
                    bc.people[user.id] = guild?.members?.cache?.get(user.id)?.displayName
                        || user.displayName || user.username || user.id;
                }
            }
            if (ids.length === 0) continue;

            emojis[key] = {
                ids,
                emoji: { id: emoji.id || null, name: emoji.name || null, animated: !!emoji.animated },
                order: position,
            };
        }

        bc.copies[ref.messageId] = { ...wpis, emojis, syncedAt: new Date().toISOString(), stale: false };
        return true;
    }

    /**
     * Dosynchronizowuje kopie przed przeliczeniem.
     *
     * - `dirtyIds` — zdarzenia reakcji: odpytujemy TYLKO kopie, pod którymi coś się zmieniło,
     * - `force` — przycisk „Odśwież ogłoszenia" i pierwsze przeliczenie po restarcie:
     *   pełna synchronizacja, bo w czasie przestoju bota zdarzenia nie przychodziły
     *   i stan mógł się rozjechać z prawdą,
     * - domyślnie — tylko kopie, których nigdy nie widzieliśmy.
     *
     * @returns {Promise<Array>} referencje żyjących kopii
     */
    async _ensureCopies(bc, client, { dirtyIds = null, force = false } = {}) {
        bc.copies = bc.copies || {};
        const brudne = dirtyIds ? new Set(dirtyIds) : null;
        const live = [];
        let dropped = false;

        for (const ref of bc.messages) {
            const wpis = bc.copies[ref.messageId];
            const trzeba = force
                || !wpis
                || wpis.stale
                || (brudne && brudne.has(ref.messageId));

            if (!trzeba) { live.push(ref); continue; }

            const ok = await this._syncCopy(bc, ref, client);
            if (ok) live.push(ref);
            else { delete bc.copies[ref.messageId]; dropped = true; }
        }

        if (dropped) {
            bc.messages = live;
            this._rebuildIndex();
        }
        return live;
    }

    /**
     * Sumy liczników z ZAPISANEGO stanu — zero zapytań do Discorda.
     *
     * Jedna osoba liczy się RAZ na emotkę, niezależnie od tego, czy zostawiła prawdziwą
     * reakcję (na dowolnej kopii), czy kliknęła przycisk: sumujemy zbiór unikalnych ID.
     *
     * @returns {{totals: Map<string, {count: number, emoji: Object, order: number}>}}
     */
    _totalsFromState(bc) {
        const totals = new Map();
        const dodaj = (key, emoji, order, ids) => {
            const prev = totals.get(key);
            const zbior = prev?.users || new Set();
            for (const id of ids) zbior.add(id);
            totals.set(key, {
                users: zbior,
                emoji: prev?.emoji || emoji,
                order: Math.min(prev?.order ?? Number.MAX_SAFE_INTEGER, order ?? Number.MAX_SAFE_INTEGER),
                count: zbior.size,
            });
        };

        for (const copy of Object.values(bc.copies || {})) {
            for (const [key, entry] of Object.entries(copy.emojis || {})) {
                dodaj(key, entry.emoji, entry.order, entry.ids || []);
            }
        }
        for (const [key, voters] of Object.entries(bc.votes || {})) {
            const emoji = this._findEmojiDescriptor(bc, key) || totals.get(key)?.emoji;
            if (!emoji) continue;
            dodaj(key, emoji, totals.get(key)?.order, Object.keys(voters));
        }

        for (const [key, entry] of totals) {
            if (entry.count === 0) totals.delete(key);
        }

        // Kiedy emotka pojawiła się pierwszy raz — Discord nie daje znacznika czasu na
        // reakcji, więc zapisujemy moment pierwszego zaobserwowania. Bez tego „od najstarszej"
        // przy równych licznikach nie miałoby się o co oprzeć i kolejność skakałaby.
        bc.firstSeen = bc.firstSeen || {};
        const now = Date.now();
        for (const key of totals.keys()) {
            if (bc.firstSeen[key] === undefined) bc.firstSeen[key] = now;
        }

        return { totals, firstSeen: bc.firstSeen };
    }

    /**
     * Dzieli reakcje na te z własnym przyciskiem i te wrzucone do zbiorczego `➕`.
     * Używane i przy budowie przycisków, i przy liście osób — dzięki temu klik w zbiorczy
     * pokazuje dokładnie tych ludzi, których on zlicza.
     *
     * @returns {{shown: Array, hidden: Array}} pary [klucz, { count, emoji }]
     */
    _splitShownHidden(totals, client, firstSeen = {}, tryAllEmojis = false) {
        const renderable = [];
        const hidden = [];

        for (const [key, entry] of totals) {
            if (entry.count <= 0) continue;
            // Emotka z serwera bez bota MOŻE nie dać się wstawić na przycisk. `tryAllEmojis`
            // każe spróbować mimo to — jeśli Discord odrzuci komponent, `refresh` wycofa się
            // do wariantu zachowawczego i zapamięta to na przyszłość.
            const risky = entry.emoji.id && !client.emojis.cache.has(entry.emoji.id);
            if (risky && !tryAllEmojis) hidden.push([key, entry]);
            else renderable.push([key, entry]);
        }

        // Kolejność: najpierw najliczniejsze, a przy remisie STARSZA reakcja wyżej.
        // Wiek bierzemy z momentu pierwszego zaobserwowania, a gdy i on jest równy
        // (emotki dodane w tym samym oknie przeliczania) — z pozycji na liście reakcji
        // wiadomości, którą Discord porządkuje wg pierwszego dodania.
        const byCountThenAge = (a, b) =>
            b[1].count - a[1].count
            || (firstSeen[a[0]] ?? 0) - (firstSeen[b[0]] ?? 0)
            || (a[1].order ?? 0) - (b[1].order ?? 0);

        renderable.sort(byCountThenAge);
        hidden.sort(byCountThenAge);

        return {
            shown: renderable.slice(0, TOP_BUTTONS),
            hidden: [...hidden, ...renderable.slice(TOP_BUTTONS)].sort(byCountThenAge),
        };
    }

    /**
     * Przelicza sumy ze wszystkich kopii i przebudowuje przyciski na każdej z nich.
     *
     * ⚠️ JEDNA PRZEBUDOWA NA RAZ per rozgłoszenie. Jedno przeliczenie to odczyt i edycja
     * kopii na KAŻDYM serwerze — kilkadziesiąt zapytań. Bez tej blokady każdy klik i każda
     * reakcja startowały własną przebudowę: przy tłumie pod świeżym ogłoszeniem kilka
     * przebiegów leciało równolegle, mnożąc pracę zamiast się zlewać, i zapychało wspólną
     * kolejkę REST (czyli spowalniało bota także w rzeczach niezwiązanych z reakcjami).
     *
     * Żądanie zgłoszone w trakcie trwającej przebudowy nie startuje drugiej — zamawia
     * JEDNĄ domykającą, która wejdzie po zakończeniu bieżącej i policzy wszystko od nowa.
     * Dzięki temu zmiany z czasu trwania przebiegu nie giną, a liczba przebudów jest
     * ograniczona tempem samego Discorda, nie tempem klikania.
     *
     * @returns {Promise<boolean>} czy cokolwiek zaktualizowano
     */
    async refresh(broadcastId, client, opts = {}) {
        const trwajaca = this._refreshing.get(broadcastId);
        if (trwajaca) {
            // Kopie zgłoszone w trakcie trwającej przebudowy dołączają do domykającej,
            // żeby ich zmiany nie wypadły z przeliczenia
            if (opts.dirty) {
                if (!this._dirtyCopies.has(broadcastId)) this._dirtyCopies.set(broadcastId, new Set());
                for (const id of opts.dirty) this._dirtyCopies.get(broadcastId).add(id);
            }
            this._refreshQueued.add(broadcastId);
            return trwajaca;
        }

        const bieg = (async () => {
            try {
                return await this._refreshOnce(broadcastId, client, this._normalizeRefreshOpts(opts));
            } finally {
                this._refreshing.delete(broadcastId);
                if (this._refreshQueued.delete(broadcastId)) {
                    // domykająca — detached, bo wołający czekał na przebieg, który już się skończył
                    const brudne = this._dirtyCopies.get(broadcastId);
                    this._dirtyCopies.delete(broadcastId);
                    this.refresh(broadcastId, client, { dirty: brudne }).catch(err =>
                        this.logger.warn(`⚠️ Błąd domykającej przebudowy rozgłoszenia: ${err.message}`)
                    );
                }
            }
        })();

        this._refreshing.set(broadcastId, bieg);
        return bieg;
    }

    /**
     * Zamienia `dirty` (zbiór kopii ze zdarzeń) na opcje synchronizacji dla `_refreshOnce`.
     * Jedna zmieniona kopia → odpytujemy tylko ją; kilka → każdą z nich po kolei.
     */
    _normalizeRefreshOpts(opts) {
        if (opts.force || opts.skipSync) return opts;
        const dirty = opts.dirty ? [...opts.dirty] : [];
        if (dirty.length === 0) return opts;
        return { ...opts, dirtyIds: dirty };
    }

    /**
     * Właściwa przebudowa — zawsze przez `refresh()`, nigdy bezpośrednio.
     *
     * @param {{dirtyIds?: string[], force?: boolean, skipSync?: boolean}} opts
     *        `dirtyIds` — zdarzenia reakcji dotyczą konkretnych kopii, tylko je odpytujemy;
     *        `force` — pełna synchronizacja (przycisk „Odśwież ogłoszenia", start bota);
     *        `skipSync` — głos z przycisku nie zmienia żadnej kopii, więc nie ma czego odpytywać.
     */
    async _refreshOnce(broadcastId, client, opts = {}) {
        const bc = this._broadcasts[broadcastId];
        if (!bc) return false;

        const live = opts.skipSync
            ? bc.messages.filter(ref => bc.copies?.[ref.messageId])
            : await this._ensureCopies(bc, client, opts);
        if (!live.length) return false;

        const { totals, firstSeen } = this._totalsFromState(bc);

        // Zbuduj przyciski. Liczniki są wszędzie identyczne, ale rząd „ostatnia reakcja"
        // ma tekst, a bot jest dwujęzyczny — więc budujemy zestaw PER JĘZYK i cache'ujemy,
        // żeby nie renderować go od nowa dla każdego serwera.
        // Domyślnie PRÓBUJEMY wstawić na przyciski także emotki z serwerów bez bota — dopiero
        // odrzucenie komponentu przez Discorda przełącza to rozgłoszenie na wariant zachowawczy
        // (takie emotki lądują wtedy w zbiorczym `➕`). Flaga jest persystowana, żeby nie
        // ponawiać skazanej próby przy każdym przeliczeniu.
        let tryAll = !bc.buttonEmojiFallback;
        const rowsByLang = new Map();
        const rowsFor = (lang) => {
            const cacheKey = `${lang}:${tryAll}`;
            if (!rowsByLang.has(cacheKey)) {
                rowsByLang.set(cacheKey, this._buildRows(broadcastId, totals, client, lang, firstSeen, tryAll));
            }
            return rowsByLang.get(cacheKey);
        };

        // Mapę języków budujemy RAZ — `getAllGuilds()` składa tablicę od nowa przy każdym
        // wywołaniu, więc w pętli po serwerach byłoby to przeliczane bez potrzeby.
        const langByGuild = new Map(
            (this.config.getAllGuilds() || []).map(g => [g.id, g.lang || 'pol'])
        );

        let updated = 0;
        let dropped = false;
        for (const ref of live) {
            const lang = langByGuild.get(ref.guildId) || 'pol';
            const rows = rowsFor(lang);
            const podpis = this._rowsSignature(rows);
            const copy = bc.copies[ref.messageId] || {};

            // Nic się na tej kopii nie zmieniło od ostatniego zapisu — edycja byłaby
            // zapytaniem bez żadnego efektu. Przy stu serwerach to sto zapytań mniej
            // na każdą przebudowę, która niczego nie zmienia (np. domykająca).
            if (copy.sig === podpis) continue;

            try {
                await this._editComponents(client, ref, rows);
                bc.copies[ref.messageId] = { ...copy, sig: podpis };
                updated++;
            } catch (err) {
                // Wiadomości już nie ma — kopia wypada z rejestru
                if (err?.code === 10008 || err?.code === 10003 || err?.code === 50001) {
                    delete bc.copies[ref.messageId];
                    dropped = true;
                    continue;
                }
                // Najbardziej prawdopodobna przyczyna: emotka, której bot nie może użyć,
                // trafiła na przycisk i Discord odrzucił komponent. Wycofujemy się do
                // wariantu zachowawczego (taka emotka idzie do zbiorczego `➕`), zapamiętujemy
                // to dla rozgłoszenia i ponawiamy — inaczej liczniki zamarłyby na tej kopii.
                if (tryAll) {
                    tryAll = false;
                    bc.buttonEmojiFallback = true;
                    this.logger.warn('⚠️ Discord odrzucił emotkę na przycisku — przechodzę na wariant zachowawczy');
                    const zapasowe = rowsFor(lang);
                    try {
                        await this._editComponents(client, ref, zapasowe);
                        bc.copies[ref.messageId] = { ...copy, sig: this._rowsSignature(zapasowe) };
                        updated++;
                        continue;
                    } catch (retryErr) {
                        this.logger.warn(`⚠️ Nie udało się zaktualizować liczników reakcji: ${retryErr.message}`);
                        continue;
                    }
                }
                this.logger.warn(`⚠️ Nie udało się zaktualizować liczników reakcji: ${err.message}`);
            }
        }

        if (dropped) {
            bc.messages = bc.messages.filter(ref => bc.copies[ref.messageId]);
            this._rebuildIndex();
        }
        await this._saveState();
        return updated > 0;
    }

    /**
     * Podmienia komponenty wiadomości BEZ jej pobierania.
     *
     * `msg.edit()` wymaga obiektu wiadomości, a ten kosztuje osobny odczyt z API — przy stu
     * kopiach to sto zapytań, których jedynym celem jest zdobycie uchwytu do edycji.
     * `channel.messages.edit(id, ...)` robi to samo jednym PATCH-em; kanał idzie z cache'u.
     */
    async _editComponents(client, ref, rows) {
        const channel = await client.channels.fetch(ref.channelId).catch(() => null);
        if (!channel?.messages) {
            const err = new Error('Kanał niedostępny');
            err.code = 10003;
            throw err;
        }
        return channel.messages.edit(ref.messageId, { components: rows });
    }

    /**
     * Odcisk wyrenderowanych rzędów — po nim poznajemy, czy edycja wiadomości cokolwiek
     * zmieni. Liczą się dokładnie te pola, które widać: etykieta, emotka, styl, stan.
     */
    _rowsSignature(rows) {
        return JSON.stringify((rows || []).map(row =>
            (row.components || []).map(c => {
                const d = c.data || {};
                return [d.custom_id, d.label, d.style, d.disabled ? 1 : 0, d.emoji?.id || d.emoji?.name || ''];
            })
        ));
    }

    /**
     * Pobiera wiadomość po referencji; null gdy zniknęła albo bot stracił dostęp.
     *
     * `force: true` jest tu OBOWIĄZKOWE, nie optymalizacją do usunięcia. Przy włączonych
     * partialach zdarzenie reakcji pod wiadomością spoza cache'u wstawia do cache'u
     * NIEKOMPLETNY obiekt wiadomości — z jedną reakcją, tą ze zdarzenia. Zwykły `fetch()`
     * oddałby wtedy tę wydmuszkę, a my policzylibyśmy sumy z niej: wszystkie pozostałe
     * emotki zniknęłyby z rzędu liczników. Wymuszony odczyt z API daje pełny, aktualny
     * stan reakcji — a to jest cały fundament „przeliczamy od nowa, z prawdy".
     */
    async _fetchMessage(client, ref) {
        try {
            const channel = await client.channels.fetch(ref.channelId).catch(() => null);
            if (!channel?.messages) return null;
            return await channel.messages.fetch({ message: ref.messageId, force: true }).catch(() => null);
        } catch {
            return null;
        }
    }

    /**
     * Buduje rzędy przycisków z posortowanych sum: 15 najczęstszych reakcji z ikoną,
     * a na 16. slocie zbiorczy `➕ N`.
     *
     * Do zbiorczego wpada wszystko, co nie dostało własnego przycisku:
     *   • reakcje poza pierwszą piętnastką,
     *   • emotki customowe z serwerów, na których NIE MA bota — Discord odrzuciłby
     *     taki komponent, więc nie da się ich pokazać z ikoną.
     * Dzięki temu suma wszystkich przycisków zawsze równa się sumie wszystkich reakcji.
     *
     * Rzędy 1-4 — liczniki (15 emotek + zbiorczy `➕`, po 4 w rzędzie), ZAWSZE szare (Secondary).
     * Rząd 5 — „ostatnia reakcja": kto, z jakiego serwera i jaką emotką; kolor rotuje
     * przy każdej nowej reakcji, żeby odcinał się od szarych liczników. Klik w ten rząd
     * otwiera listę WSZYSTKICH reagujących.
     *
     * @param {Map<string, {count: number, emoji: Object}>} totals
     * @param {string} lang - 'pol' | 'eng' — dotyczy wyłącznie rzędu 2 (liczniki są bez tekstu)
     * @returns {Array} ActionRow[]
     */
    _buildRows(broadcastId, totals, client, lang = 'pol', firstSeen = {}, tryAllEmojis = false) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const { shown, hidden } = this._splitShownHidden(totals, client, firstSeen, tryAllEmojis);
        const hiddenTotal = hidden.reduce((sum, [, entry]) => sum + entry.count, 0);

        const buttons = shown.map(([key, entry]) => {
            // Klucz emotki SIEDZI W customId, a nie pozycja na liście: kolejność przycisków
            // zmienia się wraz z licznikami, więc indeks wskazywałby po chwili inną emotkę,
            // gdyby ktoś kliknął przycisk sprzed odświeżenia
            const btn = new ButtonBuilder()
                .setCustomId(`bcr_${broadcastId}_e_${key}`)
                .setLabel(String(entry.count))
                .setStyle(ButtonStyle.Secondary);
            // Unicode → sam znak; customowa → { id, animated } (Discord odrzuca surowy `<a:x:id>` w tym polu)
            btn.setEmoji(entry.emoji.id
                ? { id: entry.emoji.id, animated: !!entry.emoji.animated }
                : entry.emoji.name);
            return btn;
        });

        // `➕` pojawia się DOPIERO gdy jest co w nim schować — czyli od 16. różnej emotki
        // w górę (albo gdy któraś nie da się wstawić na przycisk). Przycisk z zerem niósłby
        // zero informacji i tylko zjadał slot. Jest aktywny, ale bezczynny — listę
        // reagujących otwiera rząd „ostatnia reakcja".
        if (hiddenTotal > 0) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`bcr_${broadcastId}_other`)
                .setLabel(String(hiddenTotal))
                .setEmoji('➕')
                .setStyle(ButtonStyle.Secondary));
        }

        const rows = [];
        for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
        }

        const lastRow = this._buildLastReactionRow(broadcastId, client, lang, tryAllEmojis);
        if (lastRow) rows.push(lastRow);

        return rows;
    }

    /**
     * Etykieta rzędu 2: „<nick> z <nazwa serwera>" / „<nick> from <server name>".
     *
     * Czasownika NIE ma świadomie: emotka reakcji jest ikoną tego samego przycisku, a rząd
     * stoi pod licznikami reakcji, więc „zostawił reakcję" nic nie wnosiło — za to polska
     * forma męska misgenderowała każdego, kto nie jest mężczyzną.
     *
     * Nazwa serwera na Discordzie sięga 100 znaków, a etykieta przycisku ma limit 80, więc
     * przycinamy — z pierwszeństwem dla nicku, bo to on identyfikuje osobę.
     */
    _composeLastLabel(userName, serverName, lang) {
        const infix = lang === 'eng' ? ' from ' : ' z ';
        let nick = String(userName || 'Unknown');
        const nickCap = MAX_LABEL - infix.length - 3; // zostaw miejsce na skróconą nazwę serwera
        if (nick.length > nickCap) nick = `${nick.slice(0, nickCap - 1)}…`;

        let name = String(serverName || '?');
        const budget = MAX_LABEL - nick.length - infix.length;
        if (name.length > budget) name = `${name.slice(0, Math.max(1, budget - 1))}…`;

        return `${nick}${infix}${name}`;
    }

    /**
     * Rząd 2: „<nick> z <nazwa serwera>" z emotką tej reakcji jako ikoną.
     * @returns {Object|null} ActionRow albo null, gdy nikt jeszcze nie zareagował
     */
    _buildLastReactionRow(broadcastId, client, lang, tryAllEmojis = false) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const bc = this._broadcasts[broadcastId];
        const last = bc?.lastReaction;
        if (!last) return null;

        // Stare wpisy (sprzed przejścia na nazwę serwera) mają tylko tag — nie gubimy ich
        const label = this._composeLastLabel(last.userName, last.guildName || last.guildTag, lang);

        const styleName = LAST_REACTION_STYLES[bc.styleIndex % LAST_REACTION_STYLES.length] || 'Success';
        const btn = new ButtonBuilder()
            .setCustomId(`bcr_${broadcastId}_last`)
            .setLabel(label)
            .setStyle(ButtonStyle[styleName]);

        // Emotkę spoza zasięgu bota wstawiamy OPTYMISTYCZNIE, tak samo jak na licznikach —
        // dopiero odrzucenie komponentu przez Discorda przełącza całe rozgłoszenie na wariant
        // zachowawczy i wtedy tutaj ląduje neutralny 💬 (lepszy niż utrata całej wiadomości).
        if (last.emoji?.id) {
            if (tryAllEmojis || client.emojis.cache.has(last.emoji.id)) {
                btn.setEmoji({ id: last.emoji.id, animated: !!last.emoji.animated });
            } else {
                btn.setEmoji('💬');
            }
        } else if (last.emoji?.name) {
            btn.setEmoji(last.emoji.name);
        }

        return new ActionRowBuilder().addComponents(btn);
    }

    /**
     * Lista osób, które zareagowały — pod przycisk licznika (ephemeral).
     *
     * @param {string} broadcastId
     * @param {{type: 'emoji', key: string}|{type: 'other'}} target
     *        'emoji' — konkretna emotka; 'other' — wszystko, co zlicza zbiorczy `➕`
     * @param {Object} client
     * @returns {Promise<{groups: Array<{guildName: string, entries: Array}>, total: number, label: string|null}|null>}
     */
    async collectReactors(broadcastId, target, client) {
        const bc = this._broadcasts[broadcastId];
        if (!bc) return null;

        // ZERO zapytań do Discorda: kto zareagował i pod jakim nickiem, wiemy z zapisanego
        // stanu (`copies[].emojis[].ids` + `votes` + `people`). Wcześniej ta lista odpytywała
        // każdą kopię i każdą reakcję z osobna — przy stu serwerach ponad dwa tysiące zapytań
        // na jedno kliknięcie.
        const { totals, firstSeen } = this._totalsFromState(bc);

        let keys;
        let label = null;
        if (target.type === 'all') {
            keys = new Set(totals.keys());
        } else if (target.type === 'other') {
            const { hidden } = this._splitShownHidden(totals, client, firstSeen);
            keys = new Set(hidden.map(([key]) => key));
        } else {
            keys = new Set([target.key]);
            const entry = totals.get(target.key);
            label = entry ? this._emojiDisplay(entry.emoji) : null;
        }
        if (!keys.size) return { groups: [], emojis: [], total: 0, label };

        const guildCfg = new Map((this.config.getAllGuilds() || []).map(g => [g.id, g]));
        const nazwaSerwera = (guildId) => client.guilds?.cache?.get(guildId)?.name
            || guildCfg.get(guildId)?.tag
            || guildId
            || '?';
        const nick = (userId) => bc.people?.[userId] || userId;

        // Jedna osoba = jeden wpis na emotkę, nawet gdy ma i reakcję, i głos z przycisku
        const widziani = new Map();   // emojiKey → Set(userId)
        const byEmoji = new Map();
        const perGuild = new Map();   // guildName → Map(userId → emojiKey[])
        let total = 0;

        const dodaj = (key, userId, guildId) => {
            if (!keys.has(key)) return;
            if (!widziani.has(key)) widziani.set(key, new Set());
            if (widziani.get(key).has(userId)) return;
            widziani.get(key).add(userId);

            const src = totals.get(key)?.emoji || this._findEmojiDescriptor(bc, key) || { name: key };
            if (!byEmoji.has(key)) {
                byEmoji.set(key, {
                    key,
                    display: this._emojiDisplay(src),
                    iconUrl: this._emojiImageUrl(src),
                    name: src?.name || key,
                    isCustom: !!src?.id,
                    total: 0,
                    groups: new Map(),
                });
            }
            const bucket = byEmoji.get(key);
            bucket.total++;
            total++;

            const gName = nazwaSerwera(guildId);
            if (!bucket.groups.has(gName)) bucket.groups.set(gName, []);
            bucket.groups.get(gName).push(nick(userId));

            if (!perGuild.has(gName)) perGuild.set(gName, []);
            perGuild.get(gName).push({ userId, name: nick(userId), emojiKey: key, emoji: this._emojiDisplay(src) });
        };

        // Reakcje zostawione pod konkretną kopią — serwer bierzemy z jej rejestru
        const guildByMessage = new Map((bc.messages || []).map(m => [m.messageId, m.guildId]));
        for (const [messageId, copy] of Object.entries(bc.copies || {})) {
            const guildId = guildByMessage.get(messageId);
            for (const [key, entry] of Object.entries(copy.emojis || {})) {
                for (const userId of entry.ids || []) dodaj(key, userId, guildId);
            }
        }
        // Głosy z przycisków — serwer zapamiętany przy kliknięciu
        for (const [key, voters] of Object.entries(bc.votes || {})) {
            for (const [userId, vote] of Object.entries(voters)) dodaj(key, userId, vote.guildId);
        }

        const groups = [...perGuild.entries()].map(([guildName, entries]) => ({ guildName, entries }));

        // Ta sama kolejność co na przyciskach: malejąco po liczbie, remis → starsza wyżej
        const emojis = [...byEmoji.values()]
            .map(e => ({ ...e, groups: [...e.groups.entries()].map(([guildName, names]) => ({ guildName, names })) }))
            .sort((a, b) =>
                b.total - a.total
                || (firstSeen[a.key] ?? 0) - (firstSeen[b.key] ?? 0));

        return { groups, emojis, total, label };
    }

    /**
     * Publiczny obrazek emotki w CDN Discorda — działa dla KAŻDEJ emotki customowej,
     * także tej, do której bot nie ma dostępu.
     *
     * Zawsze `.png`, również dla animowanych: CDN oddaje wtedy statyczną klatkę. Wersja
     * `.gif` wymagałaby pewności co do flagi `animated`, a ta bywa fałszywie ujemna przy
     * zdarzeniach partial — błędne rozszerzenie dałoby zepsuty obrazek zamiast ikony.
     */
    _emojiImageUrl(emoji) {
        return emoji?.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.png?size=44` : null;
    }

    /** Emotka w formie nadającej się do wklejenia w treść embeda. */
    _emojiDisplay(emoji) {
        if (!emoji) return '';
        return emoji.id
            ? `<${emoji.animated ? 'a' : ''}:${emoji.name || 'emoji'}:${emoji.id}>`
            : (emoji.name || '');
    }

    /** Zatrzymuje oczekujące przebudowy (graceful shutdown). */
    stop() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }
}

module.exports = BroadcastReactionService;
