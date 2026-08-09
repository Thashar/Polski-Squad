'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Zbiorcze liczniki reakcji pod embedami rozsyłanymi na WSZYSTKIE serwery
 * (`📢 Wyślij Info`, ogłoszenie nowego serwera i cykliczny raport Global TOP10).
 *
 * Każda kopia embeda dostaje pod spodem rząd przycisków: ikona reakcji + SUMA tej
 * reakcji ze wszystkich serwerów. Dzięki temu gracz na serwerze A widzi, że embed
 * zebrał 40 👍, nawet jeśli u niego kliknęły go 3 osoby.
 *
 * Klik w licznik pokazuje ephemeral z listą osób, które zareagowały, pogrupowaną po
 * serwerze (`collectReactors`). Przycisk „ostatnia reakcja" pozostaje bezczynny — jego
 * treść jest już w etykiecie — ale klik i tak MUSI zostać potwierdzony (`deferUpdate`),
 * bo inaczej Discord pokazuje „This interaction failed".
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
 * Ile reakcji dostaje własny przycisk z ikoną — 4 najczęstsze. Piąty slot zostaje dla
 * zbiorczego `➕`, więc całość mieści się w JEDNYM rzędzie (Discord: 5 przycisków/rząd)
 * i embed nie puchnie niezależnie od tego, ile różnych emotek się pojawi.
 */
const TOP_BUTTONS = 4;
/** Po tylu dniach przestajemy pilnować rozgłoszenia (i edytować stare wiadomości). */
const RETENTION_DAYS = 30;

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
        if (this._timers.has(broadcastId)) return;

        this._timers.set(broadcastId, setTimeout(() => {
            this._timers.delete(broadcastId);
            this.refresh(broadcastId, client).catch(err =>
                this.logger.warn(`⚠️ Błąd przeliczania reakcji rozgłoszenia: ${err.message}`)
            );
        }, DEBOUNCE_MS));
    }

    /**
     * Pobiera wszystkie żyjące kopie rozgłoszenia i sumuje reakcje. Jedno źródło prawdy
     * dla liczników i dla listy osób — inaczej klik w przycisk mógłby pokazać co innego,
     * niż mówi liczba na nim.
     *
     * Kopie, których już nie ma (skasowana wiadomość/kanał), wypadają z rejestru — inaczej
     * próbowalibyśmy ich w nieskończoność.
     *
     * @returns {Promise<{live: Array, totals: Map}>}
     */
    async _collect(bc, client) {
        const live = [];
        const totals = new Map(); // klucz emoji → { count, emoji, order }
        let dropped = false;

        for (const ref of bc.messages) {
            const msg = await this._fetchMessage(client, ref);
            if (!msg) { dropped = true; continue; }
            live.push({ ref, msg });

            // Discord zwraca reakcje wiadomości w kolejności PIERWSZEGO dodania, więc pozycja
            // na tej liście jest wskazówką o wieku emotki. Bierzemy najmniejszą pozycję ze
            // wszystkich serwerów — to rozstrzyga remisy wewnątrz jednej rundy przeliczania.
            let position = 0;
            for (const reaction of msg.reactions.cache.values()) {
                const emoji = reaction.emoji;
                const key = emoji.id || emoji.name;
                position++;
                if (!key) continue;
                const prev = totals.get(key);
                totals.set(key, {
                    count: (prev?.count || 0) + (reaction.count || 0),
                    emoji,
                    order: Math.min(prev?.order ?? Number.MAX_SAFE_INTEGER, position),
                });
            }
        }

        // Kiedy emotka pojawiła się pierwszy raz — Discord nie daje znacznika czasu na
        // reakcji, więc zapisujemy moment pierwszego zaobserwowania. Bez tego „od najstarszej"
        // przy równych licznikach nie miałoby się o co oprzeć i kolejność skakałaby.
        bc.firstSeen = bc.firstSeen || {};
        let firstSeenChanged = false;
        const now = Date.now();
        for (const key of totals.keys()) {
            if (bc.firstSeen[key] === undefined) {
                bc.firstSeen[key] = now;
                firstSeenChanged = true;
            }
        }

        if (dropped) {
            bc.messages = live.map(l => l.ref);
            this._rebuildIndex();
        }
        if (dropped || firstSeenChanged) await this._saveState();

        return { live, totals, firstSeen: bc.firstSeen };
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
     * @returns {Promise<boolean>} czy cokolwiek zaktualizowano
     */
    async refresh(broadcastId, client) {
        const bc = this._broadcasts[broadcastId];
        if (!bc) return false;

        const { live, totals, firstSeen } = await this._collect(bc, client);
        if (!live.length) return false;

        // 2. Zbuduj przyciski. Liczniki są wszędzie identyczne, ale rząd „ostatnia reakcja"
        //    ma tekst, a bot jest dwujęzyczny — więc budujemy zestaw PER JĘZYK i cache'ujemy,
        //    żeby nie renderować go od nowa dla każdego serwera.
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

        // 3. Nanieś na wszystkie kopie. Mapę języków budujemy RAZ — `getAllGuilds()` składa
        //    tablicę od nowa przy każdym wywołaniu, więc w pętli po serwerach byłoby to
        //    przeliczane bez potrzeby.
        const langByGuild = new Map(
            (this.config.getAllGuilds() || []).map(g => [g.id, g.lang || 'pol'])
        );

        let updated = 0;
        for (const { ref, msg } of live) {
            const lang = langByGuild.get(ref.guildId) || 'pol';
            try {
                await msg.edit({ components: rowsFor(lang) });
                updated++;
            } catch (err) {
                // Najbardziej prawdopodobna przyczyna: emotka, której bot nie może użyć,
                // trafiła na przycisk i Discord odrzucił komponent. Wycofujemy się do
                // wariantu zachowawczego (taka emotka idzie do zbiorczego `➕`), zapamiętujemy
                // to dla rozgłoszenia i ponawiamy — inaczej liczniki zamarłyby na tej kopii.
                if (tryAll) {
                    tryAll = false;
                    bc.buttonEmojiFallback = true;
                    await this._saveState();
                    this.logger.warn('⚠️ Discord odrzucił emotkę na przycisku — przechodzę na wariant zachowawczy');
                    try {
                        await msg.edit({ components: rowsFor(lang) });
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
        return updated > 0;
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
     * Buduje rząd przycisków z posortowanych sum: 4 najczęstsze reakcje z ikoną,
     * a na końcu zbiorczy `➕ N`.
     *
     * Do zbiorczego wpada wszystko, co nie dostało własnego przycisku:
     *   • reakcje poza pierwszą czwórką,
     *   • emotki customowe z serwerów, na których NIE MA bota — Discord odrzuciłby
     *     taki komponent, więc nie da się ich pokazać z ikoną.
     * Dzięki temu suma wszystkich przycisków zawsze równa się sumie wszystkich reakcji.
     *
     * Rząd 1 — liczniki, ZAWSZE szare (Secondary).
     * Rząd 2 — „ostatnia reakcja": kto, z jakiego serwera i jaką emotką; kolor rotuje
     * przy każdej nowej reakcji, żeby odcinał się od szarych liczników.
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

        const { live, totals, firstSeen } = await this._collect(bc, client);
        if (!live.length) return null;

        // Zbiorczy przycisk musi pokazać DOKŁADNIE tych, których zlicza — dlatego zestaw
        // kluczy bierzemy z tego samego podziału, którego użyto do zbudowania przycisków
        let keys;
        let label = null;
        if (target.type === 'other') {
            const { hidden } = this._splitShownHidden(totals, client, firstSeen);
            keys = new Set(hidden.map(([key]) => key));
        } else {
            keys = new Set([target.key]);
            const entry = totals.get(target.key);
            label = entry ? this._emojiDisplay(entry.emoji) : null;
        }
        if (!keys.size) return { groups: [], total: 0, label };

        const langByGuild = new Map((this.config.getAllGuilds() || []).map(g => [g.id, g]));
        const groups = [];
        let total = 0;

        for (const { ref, msg } of live) {
            const matching = [...msg.reactions.cache.values()]
                .filter(r => keys.has(r.emoji.id || r.emoji.name));
            if (!matching.length) continue;

            const guild = client.guilds?.cache?.get(ref.guildId) || null;
            const guildName = guild?.name || langByGuild.get(ref.guildId)?.tag || ref.guildId;

            // Najpierw zbieramy użytkowników wszystkich pasujących reakcji, dopiero potem
            // jednym zapytaniem dociągamy członków — nick serwerowy wymaga membera, a
            // pobieranie ich pojedynczo to prosta droga do rate limitu
            const collected = [];
            for (const reaction of matching) {
                const users = await reaction.users.fetch().catch(() => null);
                if (!users) continue;
                for (const user of users.values()) {
                    if (user.bot) continue;
                    collected.push({ user, emoji: reaction.emoji });
                }
            }
            if (!collected.length) continue;

            let members = null;
            if (guild) {
                const ids = [...new Set(collected.map(c => c.user.id))];
                members = await guild.members.fetch({ user: ids }).catch(() => null);
            }

            const entries = collected.map(({ user, emoji }) => ({
                name: members?.get(user.id)?.displayName || user.displayName || user.username,
                emojiKey: emoji.id || emoji.name,
                emoji: this._emojiDisplay(emoji),
            }));

            total += entries.length;
            groups.push({ guildName, entries });
        }

        // Grupowanie PER EMOTKA — potrzebne, żeby każda dostała własną ikonę.
        // Emotki customowej z serwera bez bota Discord NIE wyrenderuje w treści (pokaże
        // goły `:nazwa:`), ale jej obrazek w CDN jest publiczny i można go wstawić jako
        // ikonę embeda — i to jedyny sposób, żeby taka emotka była widoczna jako ikona.
        const byEmoji = new Map();
        for (const group of groups) {
            for (const entry of group.entries) {
                if (!byEmoji.has(entry.emojiKey)) {
                    const src = totals.get(entry.emojiKey)?.emoji || null;
                    byEmoji.set(entry.emojiKey, {
                        key: entry.emojiKey,
                        display: entry.emoji,
                        iconUrl: this._emojiImageUrl(src),
                        name: src?.name || entry.emojiKey,
                        isCustom: !!src?.id,
                        total: 0,
                        groups: new Map(),
                    });
                }
                const bucket = byEmoji.get(entry.emojiKey);
                bucket.total++;
                if (!bucket.groups.has(group.guildName)) bucket.groups.set(group.guildName, []);
                bucket.groups.get(group.guildName).push(entry.name);
            }
        }

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
