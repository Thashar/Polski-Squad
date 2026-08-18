const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('JsonStore');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CENTRALNY CACHE PLIKÓW JSON (cache-first)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Powód powstania: hosting zgłosił ~34 MB/s ciągłego odczytu z dysku. Boty
 * czytały te same pliki JSON przy każdym wywołaniu (np. `getGlobalRanking()`
 * w 37 miejscach, każde = readFile + JSON.parse). Ten moduł sprowadza odczyt
 * z dysku do JEDNEGO razu — przy starcie — a całą resztę obsługuje z pamięci.
 *
 * ZASADA NACZELNA:
 *   cache = źródło prawdy w czasie działania, plik = trwałość po restarcie.
 *
 * Odczyt idzie zawsze przez `get()` (zero I/O). Zapis przez `set()`/`mutate()`
 * aktualizuje JEDNOCZEŚNIE plik i cache — nigdy jedno bez drugiego.
 *
 * ─── DLACZEGO JEDEN CACHE NA CAŁY PROCES ──────────────────────────────────
 * Wszystkie 9 botów działa w jednym procesie Node (główny `index.js` ładuje je
 * przez `require()` w pętli), a część plików jest współdzielona między botami:
 *   - `shared_data/endersecho_ranking.json` — pisze EndersEcho, czyta Stalker
 *   - `shared_data/active_nickname_effects.json` — Konklawe + Muteusz
 *   - `shared_data/lme_weekly/` — pisze Gary, czyta Stalker
 * Cache jest kluczowany ABSOLUTNĄ ścieżką pliku, więc dwa boty sięgające po ten
 * sam plik trafiają w ten sam wpis. Osobne cache per bot rozjechałyby te dane.
 *
 * ─── ZASADY BEZPIECZEŃSTWA ────────────────────────────────────────────────
 * 1. `get()` zwraca REFERENCJĘ do obiektu w cache (bez kopiowania — szybciej).
 *    Kto mutuje wynik, ten MUSI wywołać `set()`, albo od razu użyć `mutate()`.
 * 2. Zapis jest atomowy (plik tymczasowy + `rename`), więc przerwany zapis
 *    (np. ENOSPC) nie zostawia pliku 0 B — to realny problem, który wystąpił
 *    na produkcji i doczekał się obejść (`_safeReadJSON`, `findEmptyFilesSync`).
 * 3. Zapisy tego samego pliku są serializowane kolejką — równoległe `set()`
 *    nie przeplotą się w połowie.
 * 4. Cache aktualizowany jest PO udanym zapisie pliku. Gdy zapis padnie, cache
 *    zostaje spójny z dyskiem, a błąd leci do wywołującego.
 * 5. Po podmianie plików spod spodu (przywracanie backupu w Muteuszu:
 *    `/restore-backup`, `backupManager.restoreFilesFromTemp`) trzeba wywołać
 *    `reload()`. Bez tego pierwszy zapis nadpisze świeżo przywrócone dane
 *    starą zawartością pamięci.
 */
class JsonStore {
    constructor() {
        // absolutna ścieżka -> { data, loaded }
        this._cache = new Map();
        // absolutna ścieżka -> { defaultFactory, label }
        this._registry = new Map();
        // absolutna ścieżka -> Promise (kolejka zapisów per plik)
        this._queues = new Map();

        // readBytes/writeBytes rosną od startu procesu — dają obraz łącznego obciążenia dysku
        this._stats = { diskReads: 0, cacheHits: 0, writes: 0, writeErrors: 0, parseErrors: 0, readBytes: 0, writeBytes: 0 };

    }

    /**
     * Liczniki wolumenu — narastające od startu procesu.
     * Szczegółowy podział (per plik, per bot, per kategoria) prowadzi `utils/diskMonitor`,
     * który widzi CAŁY ruch dyskowy, nie tylko pliki JSON.
     */
    _track(kind, key, bytes) {
        if (kind === 'reads') this._stats.readBytes += bytes;
        else this._stats.writeBytes += bytes;
    }

    _key(filePath) {
        return path.resolve(filePath);
    }

    /**
     * Tworzy świeżą wartość domyślną. Fabryka (a nie goła wartość) jest tu
     * konieczna — inaczej wszystkie pliki z domyślnym `{}` współdzieliłyby
     * JEDEN obiekt i zapis do jednego zmieniałby pozostałe.
     */
    _makeDefault(defaultValue) {
        if (typeof defaultValue === 'function') return defaultValue();
        if (defaultValue === undefined) return {};
        return structuredClone(defaultValue);
    }

    /**
     * Zgłasza plik do wczytania przy starcie. Wywoływać w konstruktorze serwisu.
     * @param {string} filePath - ścieżka do pliku JSON
     * @param {Object} [options]
     * @param {*|Function} [options.defaultValue] - wartość gdy pliku brak/jest uszkodzony
     * @param {string} [options.label] - czytelna nazwa do logów (np. 'Gary/clan_history')
     */
    register(filePath, { defaultValue = () => ({}), label = null } = {}) {
        const key = this._key(filePath);
        this._registry.set(key, {
            defaultFactory: () => this._makeDefault(defaultValue),
            label: label || path.basename(key)
        });
        return key;
    }

    /**
     * Wczytuje z dysku WSZYSTKIE zarejestrowane pliki. Wołane raz, przy starcie
     * bota — od tego momentu odczyty idą wyłącznie z pamięci.
     */
    async loadAll() {
        // Filtrujemy po `loaded`, nie po samej obecności w cache: `get()` wywołane przed
        // `loadAll()` zostawia wpis z `loaded: false` (wartość domyślna). Pominięcie takiego
        // pliku oznaczałoby, że nigdy nie trafi na niego odczyt z dysku.
        const keys = [...this._registry.keys()].filter(k => !this._cache.get(k)?.loaded);
        await Promise.all(keys.map(key => this._loadFromDisk(key)));
        return keys.length;
    }

    /**
     * Faktyczny odczyt z dysku. Jedyne miejsce w module, które czyta plik.
     */
    async _loadFromDisk(key) {
        const entry = this._registry.get(key);
        const defaultFactory = entry ? entry.defaultFactory : () => ({});
        const label = entry ? entry.label : path.basename(key);

        try {
            const raw = await fs.readFile(key, 'utf8');
            this._stats.diskReads++;
            this._track('reads', key, Buffer.byteLength(raw));

            if (!raw.trim()) {
                // Pusty plik = ślad po przerwanym zapisie sprzed wprowadzenia
                // zapisu atomowego. Traktujemy jak brak danych, nie jak błąd.
                logger.warn(`⚠️ Pusty plik JSON: ${label} — używam wartości domyślnej`);
                this._cache.set(key, { data: defaultFactory(), loaded: true });
                return this._cache.get(key).data;
            }

            this._cache.set(key, { data: JSON.parse(raw), loaded: true });
            return this._cache.get(key).data;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Brak pliku to normalny stan przy pierwszym uruchomieniu funkcji
                this._cache.set(key, { data: defaultFactory(), loaded: true });
                return this._cache.get(key).data;
            }

            this._stats.parseErrors++;
            logger.error(`❌ Nie udało się wczytać ${label}: ${error.message} — używam wartości domyślnej`);
            this._cache.set(key, { data: defaultFactory(), loaded: true });
            return this._cache.get(key).data;
        }
    }

    /**
     * Odczyt z pamięci — ZERO I/O. Podstawowa metoda odczytu w całym projekcie.
     *
     * ⚠️ Zwraca referencję do obiektu w cache. Mutujesz wynik → wołasz `set()`.
     * @returns {*} dane albo wartość domyślna, gdy plik nie był jeszcze wczytany
     */
    get(filePath) {
        const key = this._key(filePath);
        const cached = this._cache.get(key);

        if (cached) {
            this._stats.cacheHits++;
            return cached.data;
        }

        // Plik nie przeszedł przez loadAll() — oddajemy wartość domyślną zamiast
        // sięgać po dysk, bo `get()` jest synchroniczne i ma NIGDY nie robić I/O.
        const entry = this._registry.get(key);
        const fallback = entry ? entry.defaultFactory() : {};
        this._cache.set(key, { data: fallback, loaded: false });
        logger.warn(`⚠️ Odczyt niezaładowanego pliku: ${path.basename(key)} — czy brakuje register() + loadAll()?`);
        return fallback;
    }

    /**
     * Synchroniczny odczyt-i-zapamiętanie — dla KONSTRUKTORÓW serwisów, które nie
     * mogą być async, oraz dla synchronicznych ścieżek kodu.
     *
     * Pierwsze wywołanie czyta plik (blokująco), każde kolejne idzie z pamięci.
     * Blokada dotyczy więc wyłącznie startu bota, gdy proces i tak nie obsługuje
     * jeszcze ruchu — a nie, jak dotąd, każdego odczytu w trakcie działania.
     */
    getSync(filePath, defaultValue = () => ({})) {
        const key = this._key(filePath);
        const cached = this._cache.get(key);

        if (cached && cached.loaded) {
            this._stats.cacheHits++;
            return cached.data;
        }

        if (!this._registry.has(key)) {
            this.register(key, { defaultValue });
        }
        const entry = this._registry.get(key);

        try {
            const raw = fsSync.readFileSync(key, 'utf8');
            this._stats.diskReads++;
            this._track('reads', key, Buffer.byteLength(raw));

            if (!raw.trim()) {
                logger.warn(`⚠️ Pusty plik JSON: ${entry.label} — używam wartości domyślnej`);
                this._cache.set(key, { data: entry.defaultFactory(), loaded: true });
            } else {
                this._cache.set(key, { data: JSON.parse(raw), loaded: true });
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this._stats.parseErrors++;
                logger.error(`❌ Nie udało się wczytać ${entry.label}: ${error.message} — używam wartości domyślnej`);
            }
            this._cache.set(key, { data: entry.defaultFactory(), loaded: true });
        }

        return this._cache.get(key).data;
    }

    /**
     * Odczyt dla ścieżek DYNAMICZNYCH, których nie da się zarejestrować z góry
     * (pliki per serwer/per gracz, np. `guilds/{id}/ranking.json`). Pierwszy raz
     * czyta z dysku, każdy kolejny — z pamięci.
     */
    async getOrLoad(filePath, defaultValue = () => ({})) {
        const key = this._key(filePath);
        const cached = this._cache.get(key);

        if (cached && cached.loaded) {
            this._stats.cacheHits++;
            return cached.data;
        }

        if (!this._registry.has(key)) {
            this.register(key, { defaultValue });
        }
        return this._loadFromDisk(key);
    }

    /**
     * Czy plik jest już w pamięci (niezależnie od tego, czy istnieje na dysku).
     */
    isLoaded(filePath) {
        const cached = this._cache.get(this._key(filePath));
        return Boolean(cached && cached.loaded);
    }

    /**
     * Ustawia kolejne zadanie w kolejce danego pliku. Zapisy tego samego pliku
     * nigdy nie biegną równolegle — wzorzec przeniesiony z `rankingService._enqueue`
     * i `achievementService._enqueue`, gdzie bronił przed nadpisaniem świeżego
     * zapisu starszym snapshotem.
     */
    _enqueue(key, task) {
        const previous = this._queues.get(key) || Promise.resolve();
        const next = previous.then(task, task);

        // Kolejka nie może umrzeć na odrzuconej obietnicy poprzednika
        this._queues.set(key, next.catch(() => {}));
        return next;
    }

    /**
     * Zapis atomowy: plik tymczasowy w TYM SAMYM katalogu (rename działa tylko
     * w obrębie jednego systemu plików), potem podmiana. Czytelnik zobaczy albo
     * starą, albo nową zawartość — nigdy uciętej w połowie ani pustej.
     */
    async _writeAtomic(key, data) {
        const dir = path.dirname(key);
        await fs.mkdir(dir, { recursive: true });

        const tmpPath = path.join(dir, `.${path.basename(key)}.tmp-${process.pid}-${Date.now()}`);
        const payload = JSON.stringify(data, null, 2);

        try {
            await fs.writeFile(tmpPath, payload, 'utf8');
            await fs.rename(tmpPath, key);
            this._track('writes', key, Buffer.byteLength(payload));
        } catch (error) {
            await fs.unlink(tmpPath).catch(() => {});
            throw error;
        }
    }

    /**
     * Zapisuje dane do pliku ORAZ do cache. Jedyna droga zmiany danych.
     * Cache podmieniany jest dopiero po udanym zapisie, żeby pamięć nie
     * rozjechała się z dyskiem, gdy zapis padnie.
     */
    async set(filePath, data) {
        const key = this._key(filePath);

        return this._enqueue(key, async () => {
            try {
                await this._writeAtomic(key, data);
                this._cache.set(key, { data, loaded: true });
                this._stats.writes++;
                return data;
            } catch (error) {
                this._stats.writeErrors++;
                logger.error(`❌ Błąd zapisu ${path.basename(key)}: ${error.message}`);
                throw error;
            }
        });
    }

    /**
     * Zapis dla SYNCHRONICZNYCH API serwisów (np. `dataService.saveScoreboard()`
     * w Konklawe), których wywołujący nie mogą czekać na obietnicę.
     *
     * Różnica wobec `set()`: cache jest aktualizowany NATYCHMIAST, a plik zapisywany
     * w tle. To celowe — inaczej kod robiący `save(x)` i zaraz potem `load()`
     * (bardzo częsty wzorzec w Konklawe) odczytałby z cache jeszcze starą wartość,
     * dopóki zapis by się nie dokończył.
     *
     * Kosztem jest to, że przy nieudanym zapisie pamięć wyprzedza plik — błąd
     * trafia do logu, a rozjazd znika przy restarcie. Alternatywą był blokujący
     * `writeFileSync`, który zatrzymywał cały proces (czyli wszystkie 9 botów).
     *
     * @returns {Promise} obietnica zapisu — można ją zignorować albo poczekać
     */
    setSync(filePath, data) {
        const key = this._key(filePath);
        this._cache.set(key, { data, loaded: true });

        return this._enqueue(key, async () => {
            try {
                await this._writeAtomic(key, data);
                this._stats.writes++;
            } catch (error) {
                this._stats.writeErrors++;
                logger.error(`❌ Błąd zapisu ${path.basename(key)}: ${error.message}`);
            }
        });
    }

    /**
     * Odczyt-modyfikacja-zapis pod jednym zamkiem. Bezpieczniejsze niż para
     * `get()` + `set()`, bo między nimi nie wejdzie inny zapis tego pliku.
     *
     * Funkcja `fn` dostaje KOPIĘ danych — gdyby zapis padł, cache zostaje
     * nietknięty. `fn` może zmodyfikować kopię w miejscu albo zwrócić nową
     * wartość.
     */
    async mutate(filePath, fn) {
        const key = this._key(filePath);

        return this._enqueue(key, async () => {
            const cached = this._cache.get(key);
            // ⚠️ Gdy pliku nie ma jeszcze w pamięci, MUSIMY go wczytać z dysku. Start od
            // wartości domyślnej skasowałby istniejącą zawartość pliku przy pierwszym zapisie
            // po restarcie — `mutate()` bywa pierwszym sięgnięciem po dany plik.
            const current = (cached && cached.loaded)
                ? cached.data
                : await this._loadFromDisk(key);
            const draft = structuredClone(current);

            const result = await fn(draft);
            const next = result === undefined ? draft : result;

            try {
                await this._writeAtomic(key, next);
                this._cache.set(key, { data: next, loaded: true });
                this._stats.writes++;
                return next;
            } catch (error) {
                this._stats.writeErrors++;
                logger.error(`❌ Błąd zapisu ${path.basename(key)}: ${error.message}`);
                throw error;
            }
        });
    }

    /**
     * Wymusza ponowny odczyt z dysku — po podmianie plików spod spodu.
     *
     * ⚠️ OBOWIĄZKOWE po przywróceniu backupu (`/restore-backup` w Muteuszu,
     * `backupManager.restoreFilesFromTemp`). Bez tego pierwszy zapis po
     * przywróceniu nadpisze odzyskane dane starą zawartością pamięci.
     *
     * @param {string} [target] - konkretny plik albo katalog (przeładuje
     *                            wszystkie wczytane pliki w jego drzewie).
     *                            Bez argumentu przeładowuje wszystko.
     */
    async reload(target = null) {
        let keys;

        if (!target) {
            keys = [...this._cache.keys()];
        } else {
            const resolved = this._key(target);
            const isDirectory = fsSync.existsSync(resolved) && fsSync.statSync(resolved).isDirectory();

            keys = isDirectory
                ? [...this._cache.keys()].filter(k => k.startsWith(resolved + path.sep))
                : [resolved];
        }

        // Przeładowanie idzie przez kolejkę, żeby nie wywłaszczyć trwającego zapisu
        await Promise.all(keys.map(key => this._enqueue(key, () => this._loadFromDisk(key))));
        logger.info(`🔄 Przeładowano ${keys.length} plików z dysku`);
        return keys.length;
    }

    /**
     * Usuwa wpisy z PAMIĘCI, nie dotykając dysku — dla przypadków, gdy plik (albo
     * całe drzewo katalogów) został już skasowany inną drogą, np. `fs.rm(dir, {recursive})`.
     *
     * ⚠️ Bez tego skasowane dane wracają: cache nadal je oddaje przy odczycie, a pierwszy
     * zapis odtwarza plik ze starą zawartością pamięci. Dotyczy m.in. usuwania danych
     * serwera i przenumerowania profili w EndersEcho.
     *
     * @param {string} target - plik albo katalog (czyści całe drzewo pod nim)
     * @returns {number} liczba zapomnianych wpisów
     */
    forget(target) {
        const resolved = this._key(target);
        const prefix = resolved + path.sep;
        let removed = 0;

        for (const key of [...this._cache.keys()]) {
            if (key === resolved || key.startsWith(prefix)) {
                this._cache.delete(key);
                this._registry.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /**
     * Usuwa plik z dysku i z cache (np. kasowanie danych serwera lub profilu).
     */
    async remove(filePath) {
        const key = this._key(filePath);

        return this._enqueue(key, async () => {
            await fs.unlink(key).catch(error => {
                if (error.code !== 'ENOENT') throw error;
            });
            this._cache.delete(key);
        });
    }

    /**
     * Zapewnia, że wszystkie zapisy w toku dobiegły końca — do wywołania przy
     * wyłączaniu bota (SIGINT/SIGTERM), zanim proces zniknie.
     */
    async flush() {
        await Promise.all([...this._queues.values()]);
    }

    /**
     * Statystyki do diagnostyki: ile odczytów faktycznie poszło na dysk, a ile
     * obsłużyła pamięć. Zasilają pole „obsłużone z pamięci" w komendzie /io.
     */
    getStats() {
        const total = this._stats.cacheHits + this._stats.diskReads;
        const hitRate = total > 0 ? ((this._stats.cacheHits / total) * 100).toFixed(1) : '0.0';

        return {
            ...this._stats,
            cachedFiles: this._cache.size,
            registeredFiles: this._registry.size,
            hitRate: `${hitRate}%`
        };
    }
}

// Singleton — jeden cache dla całego procesu, czyli dla wszystkich 9 botów
module.exports = new JsonStore();
module.exports.JsonStore = JsonStore;
