const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Serwis "calc-boost" — użycza moc obliczeniową serwera puli obliczeniowej kalkulatora
 * sio-tools (https://sio-tools.exp0.dev).
 *
 * Jak to działa po stronie strony:
 * - klucz localStorage `computePool` (JSON string) = nazwa puli, do której dołącza przeglądarka,
 * - klucz localStorage `multithread` (JSON number) = liczba wątków (suwak w ustawieniach;
 *   maksimum suwaka to `navigator.hardwareConcurrency`, czyli liczba rdzeni maszyny),
 * - po ustawieniu puli strona łączy się po socket.io z https://sio-api.exp0.dev, wysyła
 *   `compute:worker:register` z `appetite` = liczba wątków i odbiera zadania `compute:do_job`.
 *
 * Klucze ustawiamy przez `evaluateOnNewDocument`, czyli ZANIM wystartują skrypty strony —
 * dzięki temu wystarczy jedno wejście na stronę, bez przeładowania.
 *
 * ⚠️ Sesja żyje wyłącznie w pamięci — restart bota ubija przeglądarkę razem z procesem.
 * To jest zamierzone: boost trwa minutę i nie ma czego odtwarzać po restarcie.
 */
class ComputeBoostService {
    constructor(config, logger) {
        this.config = config.computeBoost;
        this.logger = logger;
        this.session = null;
    }

    /**
     * Czy boost jest aktualnie uruchomiony
     */
    isActive() {
        return this.session !== null;
    }

    /**
     * Ile milisekund zostało do końca aktywnej sesji (0 gdy brak sesji)
     */
    getRemainingMs() {
        if (!this.session) return 0;
        return Math.max(0, this.session.endsAt - Date.now());
    }

    /**
     * Szuka binarki pobranej przez `scripts/install-chromium.js` (postinstall) w cache
     * puppeteera. Katalog wygląda tak:
     *   ~/.cache/puppeteer/chrome-headless-shell/linux-140.0.0/chrome-headless-shell-linux64/chrome-headless-shell
     * Wersja w nazwie zmienia się z każdą aktualizacją, więc katalog trzeba przejrzeć,
     * a nie zaszywać ścieżkę na sztywno.
     */
    _znajdzWCache() {
        const cacheDir = process.env.PUPPETEER_CACHE_DIR
            || path.join(process.env.HOME || os.homedir(), '.cache', 'puppeteer');

        // Pełny Chrome ma pierwszeństwo - `chrome-headless-shell` to wariant okrojony
        // i służy tylko za zapas, gdy Chrome nie dał się pobrać
        const warianty = [
            ['chrome', 'chrome-linux64', 'chrome'],
            ['chrome-headless-shell', 'chrome-headless-shell-linux64', 'chrome-headless-shell']
        ];

        for (const [katalog, podkatalog, binarka] of warianty) {
            const bazowy = path.join(cacheDir, katalog);
            let wersje;
            try {
                wersje = fs.readdirSync(bazowy).sort().reverse();
            } catch {
                continue;
            }

            for (const wersja of wersje) {
                const kandydat = path.join(bazowy, wersja, podkatalog, binarka);
                if (fs.existsSync(kandydat)) return kandydat;
            }
        }

        return null;
    }

    /**
     * Znajduje binarkę Chromium/Chrome. Kolejność: konfiguracja (.env) → cache puppeteera
     * (binarka pobrana przez postinstall) → typowe ścieżki systemowe Linuksa (serwer) →
     * przeglądarki z Windowsa (praca lokalna).
     */
    resolveChromiumPath() {
        const candidates = [
            this.config.chromiumPath,
            this._znajdzWCache(),
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/snap/bin/chromium',
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate)) return candidate;
            } catch (error) {
                // Ścieżka niedostępna (brak uprawnień) - próbujemy kolejną
            }
        }

        return null;
    }

    /**
     * Odpytuje backend puli prosto z Node, PRZED startem przeglądarki. Rozdziela dwie
     * sytuacje, które w logu przeglądarki wyglądają identycznie (403/400 bez adresu):
     * kontener w ogóle nie dociera do API, albo dociera, ale odbija się na Cloudflare.
     *
     * Handshake socket.io na transporcie `polling` odpowiada `0{"sid":...}` z kodem 200.
     * Wynik trafia tylko do logu - błąd tutaj NIE przerywa boosta.
     */
    async _sprawdzApi() {
        const axios = require('axios');
        const dns = require('dns').promises;
        const apiHost = new URL(this.config.apiUrl).hostname;

        // DNS: adres wyłącznie w IPv6 przy kontenerze bez trasy IPv6 daje dokładnie ten
        // objaw, który widzieliśmy - ERR_ADDRESS_UNREACHABLE na hoście wyzwania Cloudflare
        for (const host of [apiHost, 'challenges.cloudflare.com']) {
            const v4 = await dns.resolve4(host).catch(e => [e.code]);
            const v6 = await dns.resolve6(host).catch(e => [e.code]);
            this.logger.info(`[CALC-BOOST] 🌐 DNS ${host}: A=${v4.join(',')} | AAAA=${v6.join(',')}`);
        }

        const naglowkiPrzegladarki = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
            'Origin': this.config.url.replace(/\/$/, ''),
            'Referer': this.config.url
        };

        const probki = [
            ['API puli (gołe żądanie)', `${this.config.apiUrl.replace(/\/$/, '')}/socket.io/?EIO=4&transport=polling`, {}],
            ['API puli (nagłówki przeglądarki)', `${this.config.apiUrl.replace(/\/$/, '')}/socket.io/?EIO=4&transport=polling`, naglowkiPrzegladarki],
            ['skrypt wyzwania Cloudflare', 'https://challenges.cloudflare.com/turnstile/v0/api.js', naglowkiPrzegladarki]
        ];

        let wyzwanie = false;

        for (const [nazwa, url, headers] of probki) {
            try {
                const odpowiedz = await axios.get(url, { timeout: 10000, headers, validateStatus: () => true });
                const tresc = typeof odpowiedz.data === 'string'
                    ? odpowiedz.data.replace(/\s+/g, ' ').slice(0, 90)
                    : JSON.stringify(odpowiedz.data).slice(0, 90);
                this.logger.info(`[CALC-BOOST] 🌐 Test — ${nazwa}: HTTP ${odpowiedz.status}, treść: ${tresc}`);

                // "Just a moment..." to strona wyzwania Cloudflare - wiadomo wtedy z góry,
                // że przeglądarka będzie musiała je rozwiązać, i czemu może nie dać rady
                if (url.includes(apiHost) && odpowiedz.status === 403 && /Just a moment/i.test(String(odpowiedz.data))) {
                    wyzwanie = true;
                }
            } catch (error) {
                this.logger.warn(`[CALC-BOOST] ⚠️ Test — ${nazwa}: ${error.code || ''} ${error.message}`);
            }
        }

        return { wyzwanieCloudflare: wyzwanie };
    }

    /**
     * Buduje regułę DNS dla Chromium omijającą brak IPv6 w kontenerze.
     *
     * `brunhild.challenges.cloudflare.com` (krok wyzwania Cloudflare przed API puli) NIE MA
     * rekordu A - istnieje wyłącznie po IPv6. Hosting bez trasy IPv6 dostaje na nim
     * ERR_ADDRESS_UNREACHABLE, wyzwanie się nie domyka i handshake socket.io kończy się 403.
     *
     * Kierujemy więc wszystkie hosty `*.challenges.cloudflare.com` na adres IPv4 tej samej
     * infrastruktury. TLS dogaduje się po SNI, więc brzeg Cloudflare i tak trafia do
     * właściwej usługi. Gdy adresu nie da się ustalić - zwracamy null i lecimy bez reguły.
     */
    async _regulaDnsCloudflare() {
        try {
            const dns = require('dns').promises;
            const [ip] = await dns.resolve4('challenges.cloudflare.com');
            if (!ip) return null;
            this.logger.info(`[CALC-BOOST] 🌐 Hosty wyzwania Cloudflare kieruję na IPv4 ${ip} (kontener bez IPv6)`);
            return `--host-resolver-rules=MAP *.challenges.cloudflare.com ${ip}`;
        } catch (error) {
            this.logger.warn(`[CALC-BOOST] ⚠️ Nie udało się ustalić IPv4 dla wyzwania Cloudflare: ${error.message}`);
            return null;
        }
    }

    /**
     * Uruchamia przeglądarkę, dołącza do puli i trzyma ją przez zadany czas.
     * Zwraca statystyki sesji. `onConnected` dostaje informację o połączeniu, gdy tylko
     * strona zamelduje się w puli (albo gdy minie limit oczekiwania).
     */
    async runBoost({ durationMs, requestedBy = 'nieznany', onConnected = null } = {}) {
        if (this.session) {
            throw new Error('Boost jest już uruchomiony');
        }

        const czas = Math.min(durationMs || this.config.durationMs, this.config.maxDurationMs);
        const executablePath = this.resolveChromiumPath();

        if (!executablePath) {
            throw new Error(
                'Nie znaleziono Chromium ani Chrome na serwerze. Ustaw ścieżkę do binarki ' +
                'w zmiennej STALKER_LME_CHROMIUM_PATH (albo PUPPETEER_EXECUTABLE_PATH).'
            );
        }

        // Puppeteer ładujemy dopiero tutaj - wszystkie dziewięć botów dzieli jeden proces,
        // nie ma po co trzymać go w pamięci, gdy nikt nie używa boosta.
        const puppeteer = require('puppeteer-core');

        const stats = {
            poolId: this.config.poolId,
            threads: 0,
            connected: false,
            jobsReceived: 0,
            jobsDone: 0,
            registered: false,
            poolUpdates: 0,
            blockedRequests: 0,
            cloudflareChallenge: false,
            peakWorkers: 0,
            peakHosts: 0,
            peakAppetite: 0,
            durationMs: czas,
            executablePath
        };

        let browser = null;

        const diagnoza = await this._sprawdzApi();
        stats.cloudflareChallenge = diagnoza.wyzwanieCloudflare;
        const regulaDns = await this._regulaDnsCloudflare();

        try {
            // `chrome-headless-shell` to stara binarka headless - puppeteer obsługuje ją
            // wyłącznie w trybie 'shell'. Pełny Chrome/Chromium idzie zwykłym `true`.
            const trybHeadless = executablePath.includes('headless-shell') ? 'shell' : true;

            // Stały profil zamiast świeżego katalogu przy każdym uruchomieniu - ciasteczka
            // i stan sesji przeżywają kolejne boosty, tak jak w normalnej przeglądarce.
            // Leży w `temp/`, a nie w `data/`, więc nie wchodzi do codziennych backupów.
            const userDataDir = path.join(__dirname, '..', 'temp', 'calc_boost_profile');
            fs.mkdirSync(userDataDir, { recursive: true });

            this.logger.info(
                `[CALC-BOOST] 🧭 Przeglądarka: ${path.basename(executablePath)} ` +
                `(tryb headless: ${trybHeadless === 'shell' ? 'shell — wariant okrojony' : 'pełny'})`
            );

            browser = await puppeteer.launch({
                executablePath,
                headless: trybHeadless,
                userDataDir,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--mute-audio',
                    '--hide-scrollbars',
                    // Bez tych trzech Chromium dławi timery i workery w "tle" - a headless
                    // zawsze jest w tle, więc pula dostawałaby ułamek deklarowanej mocy.
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    // Domyślnie Chromium ogłasza się jako sterowany automatycznie, przez co
                    // Cloudflare przed stroną potrafi odrzucić handshake socket.io (403)
                    '--disable-blink-features=AutomationControlled',
                    // Mniej procesów i pamięci - kontener hostingu ma limit jednego i drugiego
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--disable-software-rasterizer',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--metrics-recording-only',
                    ...(regulaDns ? [regulaDns] : [])
                ]
            });

            const page = await browser.newPage();
            const maxThreads = this.config.maxThreads;

            // To samo co wyżej: UA "HeadlessChrome/152..." bywa odrzucany, a bez handshake'u
            // nie ma WebSocketa ani rejestracji w puli. Podmieniamy wyłącznie ten fragment,
            // reszta UA (wersja, platforma) zostaje prawdziwa.
            const userAgent = (await browser.userAgent()).replace(/HeadlessChrome/g, 'Chrome');
            await page.setUserAgent(userAgent);
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8' });

            // Strona ciągnie kilkadziesiąt ikon (wsrv.nl), analitykę i monitoring. W kontenerze
            // z limitem pamięci i procesów kończy się to `ERR_INSUFFICIENT_RESOURCES`, a przy
            // tym ścisku pada TAKŻE handshake socket.io do API puli - czyli to, po co tu jesteśmy.
            // Nikt tego widoku nie ogląda, więc wszystko poza kodem i danymi jest odcinane.
            const BLOKOWANE_TYPY = new Set(['image', 'media', 'font']);
            const BLOKOWANE_HOSTY = /wsrv\.nl|google-analytics|googletagmanager|monitoring\.exp0\.dev/;
            // ⚠️ Cloudflare NIGDY nie jest odcinany. Przed API puli stoi wyzwanie bota
            // ("Just a moment...") i bez skryptów z challenges.cloudflare.com przeglądarka
            // nie ma jak go przejść - handshake socket.io kończy się wtedy kodem 403.
            const ZAWSZE_PRZEPUSZCZAJ = /cloudflare\.com/;

            await page.setRequestInterception(true);
            page.on('request', request => {
                const url = request.url();
                const blokuj = !ZAWSZE_PRZEPUSZCZAJ.test(url)
                    && (BLOKOWANE_TYPY.has(request.resourceType()) || BLOKOWANE_HOSTY.test(url));

                if (blokuj) {
                    stats.blockedRequests++;
                    // 'aborted' zamiast domyślnego 'failed' - inaczej nasze własne blokady
                    // raportują się jako net::ERR_FAILED i wyglądają w logu jak awarie sieci
                    request.abort('aborted').catch(() => {});
                    return;
                }
                request.continue().catch(() => {});
            });

            await page.evaluateOnNewDocument((poolId, limit) => {
                const rdzenie = navigator.hardwareConcurrency || 4;
                const watki = limit ? Math.min(limit, rdzenie) : rdzenie;
                localStorage.setItem('computePool', JSON.stringify(poolId));
                localStorage.setItem('multithread', JSON.stringify(watki));
            }, this.config.poolId, maxThreads);

            // Diagnostyka: gdy strona wywali się na tej konkretnej binarce (stary headless
            // shell, brak jakiegoś API), pula po prostu milczy i bez tych logów nie widać
            // dlaczego. Błędy strony trafiają do zwykłego logu bota.
            page.on('pageerror', error => this.logger.warn(`[CALC-BOOST] ⚠️ Błąd strony: ${error.message}`));
            page.on('console', msg => {
                if (msg.type() === 'error') this.logger.warn(`[CALC-BOOST] ⚠️ Konsola strony: ${msg.text().slice(0, 300)}`);
            });
            page.on('requestfailed', req => {
                // Odcięte przez nas żądania też lądują tutaj - logowanie ich zalałoby konsolę
                const blad = req.failure()?.errorText || '';
                if (blad === 'net::ERR_ABORTED' || blad === 'net::ERR_BLOCKED_BY_CLIENT') return;
                this.logger.warn(`[CALC-BOOST] ⚠️ Nieudane żądanie: ${req.url().slice(0, 120)} (${blad})`);
            });
            // Sama konsola pokazuje "Failed to load resource: 403" bez adresu - bezużyteczne,
            // gdy trzeba ustalić, czy odbiło się żądanie do API puli, czy jakiś pyłek z CDN
            page.on('response', res => {
                if (res.status() >= 400) {
                    this.logger.warn(`[CALC-BOOST] ⚠️ HTTP ${res.status()}: ${res.url().slice(0, 140)}`);
                }
            });

            // Ruch z pulą leci po WebSockecie, więc podglądamy go przez CDP - stąd wiemy,
            // czy przeglądarka faktycznie dołączyła i ile zadań przeliczyła.
            const cdp = await page.createCDPSession();
            await cdp.send('Network.enable');

            cdp.on('Network.webSocketCreated', event => {
                this.logger.info(`[CALC-BOOST] 🔌 WebSocket: ${event.url.split('?')[0]}`);
            });
            cdp.on('Network.webSocketFrameError', event => {
                this.logger.warn(`[CALC-BOOST] ⚠️ Błąd ramki WebSocket: ${event.errorMessage}`);
            });
            cdp.on('Network.webSocketClosed', () => {
                this.logger.warn('[CALC-BOOST] ⚠️ WebSocket zamknięty');
            });

            let onPoolJoin = null;
            const poolJoined = new Promise(resolve => { onPoolJoin = resolve; });

            const parseFrame = payload => {
                if (typeof payload !== 'string' || !payload.startsWith('42[')) return null;
                try {
                    return JSON.parse(payload.slice(2));
                } catch {
                    return null;
                }
            };

            cdp.on('Network.webSocketFrameReceived', event => {
                const frame = parseFrame(event.response && event.response.payloadData);
                if (!frame) return;
                const [nazwa, dane] = frame;

                if (nazwa === 'compute:pool_update' && dane) {
                    stats.connected = true;
                    stats.peakWorkers = Math.max(stats.peakWorkers, dane.workers || 0);
                    stats.peakHosts = Math.max(stats.peakHosts, dane.hosts || 0);
                    stats.peakAppetite = Math.max(stats.peakAppetite, dane.poolAppetite || 0);
                    // Pierwsze trzy aktualizacje do logu - widać, czy serwer w ogóle
                    // policzył się jako robotnik i ilu jeszcze jest w puli
                    if (stats.poolUpdates++ < 3) {
                        this.logger.info(`[CALC-BOOST] 📊 pool_update: ${JSON.stringify(dane)}`);
                    }
                    if (onPoolJoin) { onPoolJoin(); onPoolJoin = null; }
                } else if (nazwa === 'compute:do_job') {
                    stats.jobsReceived++;
                }
            });

            cdp.on('Network.webSocketFrameSent', event => {
                const frame = parseFrame(event.request && event.request.payloadData);
                if (!frame) return;
                if (frame[0] === 'compute:done') stats.jobsDone++;
                if (frame[0] === 'compute:worker:register') {
                    stats.registered = true;
                    this.logger.info(`[CALC-BOOST] 📝 worker:register → ${JSON.stringify(frame[1])}`);
                }
            });

            await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Odczyt PO załadowaniu strony - potwierdza, że klucze przeżyły start skryptów
            // (a nie zostały nadpisane) i że strona widzi dokładnie tę pulę, o którą chodzi.
            const ustawienia = await page.evaluate(() => ({
                multithread: localStorage.getItem('multithread'),
                computePool: localStorage.getItem('computePool'),
                rdzenie: navigator.hardwareConcurrency,
                ukryta: document.hidden,
                agent: navigator.userAgent
            }));

            stats.threads = parseInt(ustawienia.multithread, 10) || 0;
            this.logger.info(
                `[CALC-BOOST] 🔍 localStorage: computePool=${ustawienia.computePool}, ` +
                `multithread=${ustawienia.multithread}, rdzenie=${ustawienia.rdzenie}, ` +
                `document.hidden=${ustawienia.ukryta}`
            );
            this.logger.info(`[CALC-BOOST] 🔍 UA: ${ustawienia.agent}`);

            const startedAt = Date.now();
            this.session = { browser, startedAt, endsAt: startedAt + czas, stats, requestedBy };

            this.logger.info(
                `[CALC-BOOST] 🚀 Start (${requestedBy}) - pula "${this.config.poolId}", ` +
                `${stats.threads} wątków, ${Math.round(czas / 1000)} s`
            );

            // Czekamy na meldunek w puli, ale nie dłużej niż 20 s - przeglądarkę i tak
            // trzymamy do końca zadeklarowanego czasu.
            await Promise.race([poolJoined, new Promise(resolve => setTimeout(resolve, 20000))]);

            // Socket.io próbuje połączyć się pięć razy i po nieudanej serii milczy już do końca
            // (`reconnectionAttempts: 5`). Skoro i tak mamy stać kwadrans, jedno przeładowanie
            // strony daje drugie podejście - inaczej chwilowy zator w kontenerze kosztuje
            // całą sesję.
            if (!stats.connected) {
                this.logger.warn('[CALC-BOOST] ⚠️ Brak meldunku w puli - przeładowuję stronę i próbuję jeszcze raz');
                try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                    await Promise.race([poolJoined, new Promise(resolve => setTimeout(resolve, 20000))]);
                } catch (error) {
                    this.logger.warn(`[CALC-BOOST] ⚠️ Przeładowanie nieudane: ${error.message}`);
                }
            }

            if (onConnected) {
                try {
                    await onConnected({ ...stats });
                } catch (error) {
                    this.logger.warn(`[CALC-BOOST] ⚠️ Błąd powiadomienia o połączeniu: ${error.message}`);
                }
            }

            // Sen do końca sesji da się przerwać z zewnątrz (`stop()` przy zamykaniu bota),
            // inaczej `runBoost` czekałby do końca minuty na zamkniętej już przeglądarce.
            const pozostalo = this.session ? Math.max(0, this.session.endsAt - Date.now()) : 0;
            let timeoutId = null;
            await new Promise(resolve => {
                timeoutId = setTimeout(resolve, pozostalo);
                if (this.session) this.session.finishEarly = resolve;
            });
            clearTimeout(timeoutId);

            this.logger.info(
                `[CALC-BOOST] ✅ Koniec - zarejestrowany: ${stats.registered ? 'tak' : 'NIE'}, ` +
                `pool_update: ${stats.poolUpdates}, odciętych żądań: ${stats.blockedRequests}, ` +
                `szczyt puli: ${stats.peakWorkers} robotników / ` +
                `${stats.peakHosts} hostów, odebrano ${stats.jobsReceived} zadań, ` +
                `odesłano ${stats.jobsDone} wyników`
            );

            return { ...stats };
        } finally {
            this.session = null;
            if (browser) await this._closeBrowser(browser);
        }
    }

    /**
     * Przerywa aktywną sesję (używane przy zamykaniu bota)
     */
    async stop() {
        if (!this.session) return;
        const { browser, finishEarly } = this.session;
        this.session = null;
        this.logger.info('[CALC-BOOST] ⏹️ Przerywam boost');
        if (finishEarly) finishEarly();
        await this._closeBrowser(browser);
    }

    /**
     * Zamyka przeglądarkę, a gdy ta się zawiesi - ubija proces.
     */
    async _closeBrowser(browser) {
        try {
            await Promise.race([
                browser.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout zamykania')), 10000))
            ]);
        } catch (error) {
            this.logger.warn(`[CALC-BOOST] ⚠️ Wymuszam zamknięcie przeglądarki: ${error.message}`);
            try {
                const proces = browser.process();
                if (proces) proces.kill('SIGKILL');
            } catch (killError) {
                this.logger.error(`[CALC-BOOST] ❌ Nie udało się ubić przeglądarki: ${killError.message}`);
            }
        }
    }
}

module.exports = ComputeBoostService;
