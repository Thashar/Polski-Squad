'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { formatProfileDisplayName, getProfileIndex } = require('../utils/helpers');

/**
 * Odstęp cyklicznego pełnego snapshotu. Siatka bezpieczeństwa: gdyby kiedyś doszła
 * ścieżka zmieniająca ranking bez wysyłki, strona i tak dogoni stan bota w tym czasie,
 * zamiast czekać na restart. Guard po skrócie SHA-1 sprawia, że przy braku zmian
 * jest to jeden POST, a nie realny ruch.
 */
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h

/**
 * Limit pojedynczego POST-a. Undici samo ogranicza wyłącznie fazę łączenia (~10 s,
 * `UND_ERR_CONNECT_TIMEOUT`) — gdy serwer połączenie PRZYJMIE i zamilknie, oczekiwanie
 * na odpowiedź nie ma żadnego limitu i request wisi w nieskończoność, trzymając otwarty
 * uchwyt. Wysyłka jest fire-and-forget, nikt na nią nie czeka, więc lepiej odpuścić
 * i spróbować przy następnej zmianie rankingu albo najbliższym pełnym snapshocie.
 */
const POST_TIMEOUT_MS = 15 * 1000;

/**
 * Wysyłka rankingów TOP 10 na stronę (endersecho.thashar.dev).
 *
 * Kierunek jest jeden: bot → strona. Strona nigdy nie odpytuje bota, więc serwer
 * produkcyjny zostaje zamknięty na świat, a ranking działa nawet gdy bot leży
 * (Worker oddaje ostatni zapisany snapshot).
 *
 * Co jedzie na stronę: nazwa serwera, tag, pozycja, nick gracza, wynik, boss i data.
 * ŚWIADOMIE NIE wysyłamy ID Discorda ani avatarów — nick w zupełności wystarcza
 * do rankingu, a ID jest identyfikatorem, który dałoby się połączyć z kontem.
 *
 * Kiedy wysyłamy:
 *   • przy starcie bota — pełny snapshot wszystkich serwerów (`syncAll`),
 *   • cyklicznie co `AUTO_SYNC_INTERVAL_MS` — ten sam pełny snapshot (`startAutoSync`),
 *   • po każdej zmianie w rankingu — tylko dotknięte serwery i tylko gdy ich TOP 10
 *     faktycznie się zmienił (`syncGuild`/`syncGuilds`, porównanie po skrócie SHA-1),
 *   • gdy TOP 10 się nie zmienił, ale zmieniły się liczniki (nowy gracz poza czołówką,
 *     nowy serwer) — sam nagłówek, bez rankingów (`_syncTotals`).
 * Dzięki temu zwykłe `/update`, które nie rusza czołówki, nie generuje ruchu.
 *
 * WAŻNE: jedna akcja potrafi zmienić ranking KILKU serwerów naraz — pobicie rekordu
 * kasuje słabszy wpis gracza na pozostałych serwerach (`affectedGuildIds`), a usunięcie
 * profilu czyści go wszędzie. Takie ścieżki MUSZĄ wołać `syncGuilds` z pełną listą,
 * inaczej stary serwer zostaje na stronie ze snapshotem sprzed zmiany i ten sam gracz
 * widnieje w dwóch rankingach aż do restartu bota.
 *
 * Persystencja skrótów: `data/web_sync.json` — po restarcie bot nie wysyła
 * wszystkiego ponownie tylko dlatego, że zapomniał, co już wysłał.
 */
class WebRankingSyncService {
    /**
     * @param {Object} config - config bota (getAllGuilds, ranking.dataDir)
     * @param {Object} logger
     * @param {Object} deps - { rankingService, guildConfigService }
     */
    constructor(config, logger, deps = {}) {
        this.config = config;
        this.logger = logger;
        this.rankingService = deps.rankingService || null;
        this.guildConfigService = deps.guildConfigService || null;

        this.url = process.env.ENDERSECHO_WEB_SYNC_URL || null;
        this.token = process.env.ENDERSECHO_WEB_SYNC_TOKEN || null;
        this.topCount = parseInt(process.env.ENDERSECHO_WEB_SYNC_TOP || '10', 10) || 10;

        this.stateFile = path.join(config.ranking?.dataDir || path.join(__dirname, '../data'), 'web_sync.json');
        this._hashes = {};          // guildId → skrót ostatnio wysłanego TOP 10
        this._totals = null;        // { guilds, users } — ostatnio wysłane liczniki nagłówka
        this._lastSync = null;      // { at, kind: 'full'|'guild'|'remove'|'totals', count, guildName } — do Centrum Dowodzenia
        this._queue = Promise.resolve(); // serializacja zapisów pliku stanu
        this._autoTimer = null;     // cykliczny pełny snapshot (siatka bezpieczeństwa)
    }

    /** Czy wysyłka jest w ogóle skonfigurowana (brak zmiennych = funkcja wyłączona). */
    isEnabled() {
        return !!(this.url && this.token && this.rankingService);
    }

    async load() {
        try {
            const raw = await fs.readFile(this.stateFile, 'utf8');
            const data = JSON.parse(raw);
            this._hashes = data?.hashes || {};
            this._totals = data?.totals || null;
            this._lastSync = data?.lastSync || null;
        } catch {
            this._hashes = {};
            this._totals = null;
            this._lastSync = null;
        }
    }

    async _saveState() {
        this._queue = this._queue.then(async () => {
            try {
                await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
                await fs.writeFile(this.stateFile, JSON.stringify({ hashes: this._hashes, totals: this._totals, lastSync: this._lastSync }, null, 2), 'utf8');
            } catch (err) {
                this.logger.warn(`⚠️ Nie udało się zapisać stanu wysyłki rankingów: ${err.message}`);
            }
        }).catch(() => {});
        return this._queue;
    }

    /**
     * Buduje TOP N jednego serwera w formacie, który rozumie strona.
     * @returns {Promise<Object|null>} null gdy serwer nie ma jeszcze żadnego wyniku
     */
    async buildGuildPayload(guildId, client) {
        const players = await this.rankingService.getSortedPlayers(guildId);
        if (!players.length) return null;

        const guild = client?.guilds?.cache?.get(guildId) || null;
        const cfg = this.config.getAllGuilds().find(g => g.id === guildId) || null;
        const guildName = guild?.name
            || this.guildConfigService?.getConfig(guildId)?.guildName
            || guildId;

        const top = players.slice(0, this.topCount).map((p, idx) => ({
            rank: idx + 1,
            name: formatProfileDisplayName(p.username || 'Unknown', p.profileIndex || getProfileIndex(p.playerKey)),
            score: p.score || this.rankingService.formatScore(p.scoreValue),
            // Wartość liczbowa — strona rysuje z niej wykres porównania wyników
            // (proporcja paska do lidera), tak jak generatePlayersProgressChart w bocie.
            scoreValue: typeof p.scoreValue === 'number' ? p.scoreValue : null,
            bossName: p.bossName || null,
            date: p.timestamp || null,
        }));

        return {
            id: guildId,
            name: guildName,
            tag: cfg?.tag || null,
            // Moment dołączenia bota do serwera — strona układa po nim kafelki
            // (kolejność dołączania, tak jak dawna statyczna lista w HTML-u).
            joinedAt: guild?.joinedAt ? guild.joinedAt.toISOString() : null,
            totalPlayers: this.rankingService.countPeople(players),
            top,
        };
    }

    /**
     * Liczniki z nagłówka strony: ile serwerów obsługuje bot i ilu stoi za nimi
     * UNIKALNYCH graczy. Gracz obecny na kilku serwerach liczy się raz — to dokładnie
     * ta sama liczba, którą bot pokazuje jako „N unikalnych graczy globalnie"
     * (`getCountedPlayers`, dedup po ID Discorda). Na stronę idzie sama liczba.
     * @param {Object} client
     * @returns {Promise<{ totalGuilds: number, totalUsers: number }>}
     */
    async _computeTotals(client) {
        const ids = (this.guildConfigService?.getAllConfiguredGuildIds() || [])
            .filter(id => client?.guilds?.cache?.has(id));
        if (!ids.length) return { totalGuilds: 0, totalUsers: 0 };
        const counted = await this.rankingService.getCountedPlayers(new Set(ids));
        return { totalGuilds: ids.length, totalUsers: counted.total };
    }

    /** Liczniki dopisywane do każdego POST-a; zera nie wysyłamy (Worker zostawia wtedy stary stan). */
    _totalsFields(totals) {
        return {
            totalGuilds: totals.totalGuilds || undefined,
            totalUsers: totals.totalUsers || undefined,
        };
    }

    /** Zapamiętuje ostatnio wysłane liczniki — po nich poznajemy, że warto wysłać kolejne. */
    _rememberTotals(totals) {
        this._totals = { guilds: totals.totalGuilds, users: totals.totalUsers };
    }

    /**
     * Wysyła SAME liczniki nagłówka, bez rankingów. Potrzebne, bo nowy gracz ląduje
     * zwykle POZA TOP 10 — skrót czołówki się wtedy nie zmienia, więc bez tego licznik
     * unikalnych graczy stałby na stronie aż do najbliższego pełnego snapshotu.
     * @returns {Promise<boolean>} czy poszła wysyłka
     */
    async _syncTotals(client, precomputed = null) {
        const totals = precomputed || await this._computeTotals(client);
        if (!totals.totalGuilds) return false; // bot bez serwerów — nie ma czego liczyć
        if (this._totals && this._totals.guilds === totals.totalGuilds && this._totals.users === totals.totalUsers) {
            return false; // liczniki bez zmian — POST byłby czystym hałasem
        }

        await this._post({ guilds: [], ...this._totalsFields(totals) });
        this._rememberTotals(totals);
        this._lastSync = { at: new Date().toISOString(), kind: 'totals', count: 0, guildName: null };
        await this._saveState();
        this.logger.info(`🌐 Zaktualizowano liczniki na stronie: ${totals.totalGuilds} serwer(ów), ${totals.totalUsers} unikalnych graczy`);
        return true;
    }

    /**
     * Informacja o ostatniej wysyłce — pokazywana w Centrum Dowodzenia.
     * @returns {{ enabled: boolean, lastSync: Object|null, guildsTracked: number, totals: Object|null }}
     */
    getStatus() {
        return {
            enabled: this.isEnabled(),
            lastSync: this._lastSync,
            guildsTracked: Object.keys(this._hashes).length,
            totals: this._totals,
        };
    }

    /** Skrót TOP 10 — porównanie decyduje, czy w ogóle wysyłać. */
    _hashTop(payload) {
        const material = JSON.stringify(payload.top.map(p => [p.rank, p.name, p.score, p.bossName]));
        return crypto.createHash('sha1').update(material).digest('hex');
    }

    /**
     * Czytelny opis błędu wysyłki. Wbudowany `fetch` rzuca `TypeError: fetch failed`
     * dla KAŻDEGO problemu z połączeniem (DNS, TCP, TLS, zerwana sesja), a realną
     * przyczynę chowa w `err.cause` — bez rozpakowania log nie mówi nic ponad
     * „fetch failed" i nie da się odróżnić padniętego DNS-u od zerwanego połączenia.
     */
    _errText(err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
            return `przekroczono limit ${POST_TIMEOUT_MS / 1000}s`;
        }
        const detail = err?.cause?.code || err?.cause?.message;
        return detail ? `${err.message} (${detail})` : (err?.message || String(err));
    }

    async _post(body) {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
        }
        return res;
    }

    /**
     * Pełny snapshot wszystkich skonfigurowanych serwerów, na których bot jest obecny.
     * Wołane przy starcie bota — strona dostaje komplet, nawet jeśli coś umknęło
     * przy poprzednim uruchomieniu.
     */
    async syncAll(client) {
        if (!this.isEnabled()) return;
        try {
            const ids = (this.guildConfigService?.getAllConfiguredGuildIds() || [])
                .filter(id => client.guilds.cache.has(id));
            const guilds = [];
            for (const id of ids) {
                const payload = await this.buildGuildPayload(id, client);
                if (payload) guilds.push(payload);
            }
            if (!guilds.length) return;

            const totals = await this._computeTotals(client);
            await this._post({ guilds, replaceAll: true, ...this._totalsFields(totals) });
            this._rememberTotals(totals);
            // Skróty budujemy OD ZERA: `replaceAll` skasował po stronie strony serwery,
            // których tu nie ma. Gdyby ich skróty zostały, późniejszy `syncGuild` uznałby
            // niezmieniony TOP 10 za „już wysłany" i serwer nigdy nie wróciłby na stronę.
            const nextHashes = {};
            for (const g of guilds) nextHashes[g.id] = this._hashTop(g);
            this._hashes = nextHashes;
            this._lastSync = { at: new Date().toISOString(), kind: 'full', count: guilds.length, guildName: null };
            await this._saveState();
            this.logger.info(`🌐 Wysłano rankingi na stronę: ${guilds.length} serwer(ów)`);
        } catch (err) {
            this.logger.warn(`⚠️ Błąd wysyłki rankingów na stronę: ${this._errText(err)}`);
        }
    }

    /**
     * Wysyła TOP 10 jednego serwera, ale tylko gdy czołówka faktycznie się zmieniła.
     * Wołane po każdym zapisanym wyniku (fire-and-forget).
     * @returns {Promise<boolean>} czy wysłano
     */
    async syncGuild(guildId, client) {
        if (!this.isEnabled() || !guildId) return false;
        try {
            const payload = await this.buildGuildPayload(guildId, client);
            // Ranking serwera zrobił się pusty (ostatni gracz usunięty / profil skasowany) —
            // kafelek musi zniknąć ze strony, inaczej wisiałby z zamrożoną listą do restartu.
            if (!payload) {
                const removed = await this._removeGuild(guildId, client);
                // Serwera nigdy nie wysłaliśmy (nie ma czego kasować), ale gracz i tak
                // zniknął z rankingu — licznik unikalnych graczy trzeba odświeżyć.
                if (!removed) await this._syncTotals(client);
                return removed;
            }

            // Liczniki liczymy też tutaj — nowy serwer i nowy gracz mają być widoczni
            // na stronie, zanim padnie kolejny restart bota z pełnym snapshotem.
            const totals = await this._computeTotals(client);

            const hash = this._hashTop(payload);
            if (this._hashes[guildId] === hash) {
                // TOP 10 bez zmian — rankingu nie wysyłamy, ale nowy gracz spoza czołówki
                // podbija licznik unikalnych graczy, więc sam nagłówek może wymagać wysyłki.
                await this._syncTotals(client, totals);
                return false;
            }

            await this._post({ guilds: [payload], ...this._totalsFields(totals) });
            this._rememberTotals(totals);
            this._hashes[guildId] = hash;
            this._lastSync = { at: new Date().toISOString(), kind: 'guild', count: 1, guildName: payload.name };
            await this._saveState();
            this.logger.info(`🌐 Zaktualizowano ranking serwera "${payload.name}" na stronie`);
            return true;
        } catch (err) {
            this.logger.warn(`⚠️ Błąd wysyłki rankingu serwera na stronę: ${this._errText(err)}`);
            return false;
        }
    }

    /**
     * Wysyła TOP 10 kilku serwerów naraz — po jednej akcji, która mogła zmienić rankingi
     * na więcej niż jednym serwerze (dedup cross-server, migracja wpisu, usunięcie profilu).
     * Duplikaty i puste wartości są odsiewane; każdy serwer i tak przechodzi przez guard
     * po skrócie, więc te bez realnej zmiany nie generują ruchu.
     *
     * @param {Array<string>} guildIds
     * @param {Object} client
     * @returns {Promise<number>} ile serwerów faktycznie wysłano
     */
    async syncGuilds(guildIds, client) {
        if (!this.isEnabled()) return 0;
        const unique = [...new Set((guildIds || []).filter(Boolean))];
        let sent = 0;
        for (const id of unique) {
            if (await this.syncGuild(id, client)) sent++;
        }
        return sent;
    }

    /**
     * Kasuje serwer ze strony (ranking zszedł do zera). Nie ruszamy serwerów, których
     * nigdy nie wysłaliśmy — nie ma tam czego kasować, a POST byłby czystym hałasem.
     * @returns {Promise<boolean>} czy poszła wysyłka
     */
    async _removeGuild(guildId, client) {
        if (!(guildId in this._hashes)) return false;
        const guildName = client?.guilds?.cache?.get(guildId)?.name
            || this.guildConfigService?.getConfig(guildId)?.guildName
            || guildId;
        const totals = await this._computeTotals(client);

        await this._post({ guilds: [], removeGuildIds: [guildId], ...this._totalsFields(totals) });
        this._rememberTotals(totals);
        delete this._hashes[guildId];
        this._lastSync = { at: new Date().toISOString(), kind: 'remove', count: 1, guildName };
        await this._saveState();
        this.logger.info(`🌐 Usunięto ranking serwera "${guildName}" ze strony (brak graczy)`);
        return true;
    }

    /**
     * Uruchamia cykliczny pełny snapshot. Wołane raz, przy starcie bota, PO `syncAll`.
     * @param {Object} client
     */
    startAutoSync(client) {
        if (!this.isEnabled() || this._autoTimer) return;
        this._autoTimer = setInterval(() => {
            this.syncAll(client).catch(() => {});
        }, AUTO_SYNC_INTERVAL_MS);
    }

    /** Zatrzymuje cykliczny snapshot (graceful shutdown / testy). */
    stopAutoSync() {
        if (this._autoTimer) {
            clearInterval(this._autoTimer);
            this._autoTimer = null;
        }
    }
}

module.exports = WebRankingSyncService;
