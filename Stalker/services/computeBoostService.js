const fs = require('fs');
const os = require('os');
const path = require('path');

const ProxyService = require('./proxyService');

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
 *
 * 🌐 Proxy: IP hostingu jest zablokowane przez Cloudflare stojące przed API puli, więc
 * przeglądarka wychodzi przez pulę proxy przepisaną z Garego (`services/proxyService.js`,
 * ten sam mechanizm co w `/rivals`). Nieudane podejście rotuje na kolejny adres, a adres
 * odprawiony przez Cloudflare ląduje na dobę na czarnej liście. Gdy proxy nie ma albo
 * wszystkie odpadły — zostaje połączenie bezpośrednie, czyli zachowanie sprzed zmiany.
 */
class ComputeBoostService {
    constructor(config, logger, proxyService = null) {
        this.config = config.computeBoost;
        this.logger = logger;
        this.session = null;
        this.proxyService = proxyService || new ProxyService(config, logger);
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
     * Wynik trafia tylko do logu - błąd tutaj NIE przerywa boosta, z jednym wyjątkiem:
     * kod 407 od samego proxy oznacza wygasłe konto i nie ma sensu odpalać przeglądarki.
     *
     * @param {Object|null} proxy - opis proxy z `describeProxy()`; null = połączenie bezpośrednie
     */
    async _sprawdzApi(proxy = null) {
        const dns = require('dns').promises;
        const apiHost = new URL(this.config.apiUrl).hostname;

        // Przez proxy DNS rozwiązuje serwer pośredniczący, więc lokalne rekordy nic nie mówią
        if (!proxy) {
            // DNS: adres wyłącznie w IPv6 przy kontenerze bez trasy IPv6 daje dokładnie ten
            // objaw, który widzieliśmy - ERR_ADDRESS_UNREACHABLE na hoście wyzwania Cloudflare
            for (const host of [apiHost, 'challenges.cloudflare.com']) {
                const v4 = await dns.resolve4(host).catch(e => [e.code]);
                const v6 = await dns.resolve6(host).catch(e => [e.code]);
                this.logger.info(`[CALC-BOOST] 🌐 DNS ${host}: A=${v4.join(',')} | AAAA=${v6.join(',')}`);
            }
        }

        // Ten sam tunel, którym pójdzie przeglądarka - inaczej diagnoza opisywałaby
        // łączność hostingu, a nie tę, na której faktycznie stanie boost
        const klient = this.proxyService.createProxyAxios(proxy?.url || null, { timeout: 10000 });

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
        let statusProxy = null;

        for (const [nazwa, url, headers] of probki) {
            try {
                const odpowiedz = await klient.get(url, { headers });
                const tresc = typeof odpowiedz.data === 'string'
                    ? odpowiedz.data.replace(/\s+/g, ' ').slice(0, 90)
                    : JSON.stringify(odpowiedz.data).slice(0, 90);
                this.logger.info(`[CALC-BOOST] 🌐 Test — ${nazwa}: HTTP ${odpowiedz.status}, treść: ${tresc}`);

                // 407 nie pochodzi od strony, tylko od proxy - konto wygasło
                if (proxy && odpowiedz.status === 407) {
                    statusProxy = 407;
                }

                // "Just a moment..." to strona wyzwania Cloudflare - wiadomo wtedy z góry,
                // że przeglądarka będzie musiała je rozwiązać, i czemu może nie dać rady
                if (url.includes(apiHost) && odpowiedz.status === 403 && /Just a moment/i.test(String(odpowiedz.data))) {
                    wyzwanie = true;
                }
            } catch (error) {
                this.logger.warn(`[CALC-BOOST] ⚠️ Test — ${nazwa}: ${error.code || ''} ${error.message}`);

                // Odrzucenie na tunelu CONNECT nie ma odpowiedzi HTTP - kod siedzi w komunikacie
                if (proxy) {
                    const kod = this.proxyService.rozpoznajBladProxy(error);
                    if (kod === 407) statusProxy = 407;
                }
            }
        }

        return { wyzwanieCloudflare: wyzwanie, statusProxy };
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
     * Wchodzi na domenę API puli jako zwykła strona i czeka, aż Cloudflare wystawi
     * ciasteczko `cf_clearance`.
     *
     * ⚠️ To jest krok, bez którego całość nie ma prawa zadziałać. Wyzwanie „Just a moment…"
     * rozwiązuje się WYŁĄCZNIE przy nawigacji najwyższego poziomu. Socket.io odpytuje API
     * XHR-em, więc przy zablokowanym adresie JavaScript dostaje gołe 403 i nie ma jak
     * wyzwania przejść - dokładnie tak, jak dzieje się to u człowieka, który wkleiłby adres
     * API do konsoli zamiast otworzyć go w karcie.
     *
     * Ciasteczko zapisuje się w stałym profilu, więc kolejne boosty zaczynają już z górki.
     */
    async _przejdzWyzwanie(page) {
        const apiHost = new URL(this.config.apiUrl).hostname;

        try {
            await page.goto(this.config.apiUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (error) {
            this.logger.warn(`[CALC-BOOST] ⚠️ Nie udało się otworzyć domeny API: ${error.message}`);
            return false;
        }

        // Wyzwanie liczy się kilka sekund i samo przeładowuje stronę - dajemy mu 45 s
        const koniec = Date.now() + 45000;

        while (Date.now() < koniec) {
            const ciasteczka = await page.cookies().catch(() => []);
            if (ciasteczka.some(c => c.name === 'cf_clearance')) {
                this.logger.info(`[CALC-BOOST] 🔓 Cloudflare wpuścił - mam cf_clearance dla ${apiHost}`);
                return true;
            }

            const tytul = await page.title().catch(() => '');
            if (tytul && !/just a moment|attention required|please wait/i.test(tytul)) {
                this.logger.info(`[CALC-BOOST] 🔓 Domena API otwarta bez wyzwania (tytuł: "${tytul}")`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        this.logger.warn('[CALC-BOOST] ⚠️ Wyzwanie Cloudflare nie zostało rozwiązane w 45 s');
        return false;
    }

    /**
     * Buduje kolejkę podejść: najpierw proxy (tyle sztuk, ile mówi `retryAttempts`),
     * a na końcu ZAWSZE połączenie bezpośrednie.
     *
     * Bezpośrednie na końcu, a nie na początku, bo to właśnie IP hostingu jest zablokowane —
     * ale gdy proxy padnie albo pula się wyczerpie, lepiej spróbować niż nie zrobić nic.
     * Przy wyłączonej puli zostaje samo podejście bezpośrednie, czyli stan sprzed zmiany.
     */
    _zbudujListePodejsc() {
        const podejscia = [];

        if (this.proxyService?.enabled) {
            // Czyścimy ślad po poprzednim boostcie - inaczej "nieużyte proxy" szybko by się skończyły
            this.proxyService.resetUsedProxies();

            const ile = Math.max(1, this.proxyService.retryAttempts);
            const wziete = new Set();

            for (let i = 0; i < ile; i++) {
                const proxyUrl = this.proxyService.pickProxy();
                if (!proxyUrl) break;

                // Pula mniejsza niż limit prób - wybór zaczyna się powtarzać. Drugie
                // podejście tym samym adresem skończy się tak samo, a kosztuje półtorej minuty
                if (wziete.has(proxyUrl)) break;
                wziete.add(proxyUrl);

                const opis = this.proxyService.describeProxy(proxyUrl);
                if (opis) podejscia.push(opis);
            }

            if (podejscia.length === 0) {
                this.logger.warn('[CALC-BOOST] ⚠️ Brak dostępnych proxy - lecę bezpośrednio z IP hostingu');
            }
        }

        podejscia.push(null);
        return podejscia;
    }

    /**
     * Uruchamia boost: kolejno próbuje podejść z puli proxy, aż któreś zamelduje się
     * w puli obliczeniowej. Zwraca statystyki udanej sesji, a gdy żadne podejście nie
     * wypaliło - statystyki ostatniego.
     *
     * `onConnected` dostaje informację o połączeniu, gdy tylko strona zamelduje się w puli.
     * Przy nieudanym podejściu powiadomienie NIE leci - poszłoby ono do Discorda tyle razy,
     * ile było proxy. Wyjątek to podejście ostatnie: tam trzeba powiedzieć, że nie wyszło.
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

        const podejscia = this._zbudujListePodejsc();

        // Sesję rezerwujemy PRZED pierwszym podejściem - rotacja proxy potrafi potrwać kilka
        // minut, a bez tej blokady druga osoba odpaliłaby w tym czasie równoległą przeglądarkę
        const teraz = Date.now();
        this.session = { browser: null, startedAt: teraz, endsAt: teraz + czas, requestedBy };

        let ostatnieStats = null;

        try {
            for (let i = 0; i < podejscia.length; i++) {
                const proxy = podejscia[i];
                const ostatnie = i === podejscia.length - 1;

                this.logger.info(
                    `[CALC-BOOST] 🌐 Podejście ${i + 1}/${podejscia.length} — ` +
                    (proxy ? `proxy ${proxy.masked}` : 'połączenie bezpośrednie (IP hostingu)')
                );

                const stats = await this._sesja({
                    proxy,
                    czas,
                    requestedBy,
                    executablePath,
                    powiadom: async info => {
                        if (!onConnected) return;
                        if (!info.connected && !ostatnie) return;
                        await onConnected(info);
                    }
                });

                ostatnieStats = stats;

                if (stats.connected) return stats;

                // stop() w trakcie podejścia (zamykanie bota) - nie ma czego rotować
                if (!this.session) return stats;

                this._ukarzProxy(proxy, stats);
            }

            // Gdy każde podejście wywróciło się na wyjątku (np. Chrome w ogóle nie wstaje),
            // komenda ma pokazać powód awarii, a nie podsumowanie sesji z samymi zerami
            if (ostatnieStats?.error) {
                throw new Error(ostatnieStats.error);
            }

            return ostatnieStats;
        } finally {
            this.session = null;
        }
    }

    /**
     * Odkłada nieudane proxy na czarną listę - dokładnie na tych samych zasadach co w Garym.
     *
     * Karane są WYŁĄCZNIE dwie sytuacje: wygasłe konto proxy (407, blokada trwała) oraz
     * odprawienie przez Cloudflare (403, doba). Zwykła awaria - padnięta przeglądarka,
     * zerwane połączenie, zatkany kontener - powoduje samą rotację, bo proxy nie zawiniło
     * i szkoda byłoby wyłączać sprawny adres na 24 godziny.
     */
    _ukarzProxy(proxy, stats) {
        if (!proxy) return;

        if (stats.proxyStatus === 407) {
            this.proxyService.disableProxy(proxy.url, 407, 'Proxy odrzuciło uwierzytelnienie');
            return;
        }

        if (stats.cloudflareChallenge && !stats.clearance) {
            this.proxyService.disableProxy(proxy.url, 403, 'Cloudflare nie wpuścił tego adresu do API puli');
        }
    }

    /**
     * Pojedyncze podejście: uruchamia przeglądarkę (opcjonalnie przez proxy), dołącza do puli
     * i przy powodzeniu trzyma ją przez zadany czas. Nieudane podejście kończy się od razu,
     * żeby `runBoost` mógł spróbować kolejnego adresu.
     */
    async _sesja({ proxy, czas, requestedBy, executablePath, powiadom }) {
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
            clearance: false,
            peakWorkers: 0,
            peakHosts: 0,
            peakAppetite: 0,
            durationMs: czas,
            executablePath,
            // Adres wyjściowy bez danych logowania - trafia do embeda na Discordzie
            exitLabel: proxy ? proxy.server.replace(/^https?:\/\//, '') : 'bezpośrednie (IP hostingu)',
            proxyStatus: null
        };

        let browser = null;

        const diagnoza = await this._sprawdzApi(proxy);
        stats.cloudflareChallenge = diagnoza.wyzwanieCloudflare;
        stats.proxyStatus = diagnoza.statusProxy;

        // 407 = konto proxy wygasło. Przeglądarka i tak nie przejdzie przez ten tunel,
        // a start Chrome'a kosztuje kilkanaście sekund i sporo pamięci kontenera
        if (stats.proxyStatus === 407) {
            this.logger.warn(`[CALC-BOOST] 🚫 Proxy ${proxy.masked} odrzuca uwierzytelnienie (407) - pomijam bez startu przeglądarki`);
            return { ...stats };
        }

        // Przez proxy nazwy rozwiązuje serwer pośredniczący, więc podmiana adresów wyzwania
        // Cloudflare na IPv4 nic by nie dała - Chromium i tak nie robi tu lokalnego DNS-u
        const regulaDns = proxy ? null : await this._regulaDnsCloudflare();

        try {
            // `chrome-headless-shell` to stara binarka headless - puppeteer obsługuje ją
            // wyłącznie w trybie 'shell'. Pełny Chrome/Chromium idzie zwykłym `true`.
            const trybHeadless = executablePath.includes('headless-shell') ? 'shell' : true;

            // Stały profil zamiast świeżego katalogu przy każdym uruchomieniu - ciasteczka
            // i stan sesji przeżywają kolejne boosty, tak jak w normalnej przeglądarce.
            // Leży w `temp/`, a nie w `data/`, więc nie wchodzi do codziennych backupów.
            //
            // ⚠️ Osobny profil na każdy adres wyjściowy. `cf_clearance` Cloudflare wiąże
            // z adresem IP - ciasteczko wyrobione przez jedno proxy podane z drugiego jest
            // nieważne i sprowadza wyzwanie z powrotem, mimo że wyglądałoby na załatwione.
            const nazwaProfilu = proxy ? `calc_boost_profile_${proxy.profileKey}` : 'calc_boost_profile';
            const userDataDir = path.join(__dirname, '..', 'temp', nazwaProfilu);
            fs.mkdirSync(userDataDir, { recursive: true });

            this.logger.info(
                `[CALC-BOOST] 🧭 Przeglądarka: ${path.basename(executablePath)} ` +
                `(tryb headless: ${trybHeadless === 'shell' ? 'shell — wariant okrojony' : 'pełny'}, ` +
                `wyjście: ${stats.exitLabel})`
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
                    ...(regulaDns ? [regulaDns] : []),
                    // Cały ruch przeglądarki (także WebSocket puli) idzie przez proxy.
                    // ⚠️ Chromium nie przyjmuje tu użytkownika ani hasła - te lecą niżej,
                    // przez `page.authenticate()`
                    ...(proxy ? [`--proxy-server=${proxy.server}`] : [])
                ],
                // Puppeteer domyślnie dokłada --enable-automation (pasek "sterowana przez
                // oprogramowanie testujące"). Zwykła przeglądarka tej flagi nie ma, a my nie
                // uruchamiamy testów - po prostu odwiedzamy stronę.
                ignoreDefaultArgs: ['--enable-automation']
            });

            // Przeglądarka wpisana do sesji od razu po starcie - inaczej `stop()` przy
            // zamykaniu bota nie miałaby czego ubić i proces Chrome'a zostałby sierotą
            if (this.session) this.session.browser = browser;

            const page = await browser.newPage();
            const maxThreads = this.config.maxThreads;

            // Dane logowania do proxy. Chromium prosi o nie dopiero przy pierwszym żądaniu
            // (odpowiedź 407), więc wystarczy ustawić je przed nawigacją.
            if (proxy?.username) {
                await page.authenticate({ username: proxy.username, password: proxy.password || '' });
            }

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
            // Nic z domeny API ani ze ścieżek /cdn-cgi/ nie może być odcięte - to zasoby
            // strony wyzwania, a okaleczone wyzwanie nigdy się nie domyka
            const hostApi = new URL(this.config.apiUrl).hostname.replace(/\./g, '\\.');
            const ZAWSZE_PRZEPUSZCZAJ = new RegExp(`cloudflare\\.com|/cdn-cgi/|${hostApi}`);

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

            // Najpierw domena API - tam mieszka wyzwanie. Dopiero z ciasteczkiem w profilu
            // przechodzimy na kalkulator, żeby socket.io miał czym się wylegitymować.
            stats.clearance = await this._przejdzWyzwanie(page);

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

            // Odliczanie czasu boosta rusza dopiero teraz - rotacja proxy potrafi zjeść
            // kilka minut, a użytkownik ma dostać pełny zadeklarowany czas liczenia
            const startedAt = Date.now();
            if (this.session) {
                this.session.browser = browser;
                this.session.startedAt = startedAt;
                this.session.endsAt = startedAt + czas;
                this.session.stats = stats;
            }

            this.logger.info(
                `[CALC-BOOST] 🚀 Start (${requestedBy}) - pula "${this.config.poolId}", ` +
                `${stats.threads} wątków, ${Math.round(czas / 1000)} s, wyjście: ${stats.exitLabel}`
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

            if (powiadom) {
                try {
                    await powiadom({ ...stats });
                } catch (error) {
                    this.logger.warn(`[CALC-BOOST] ⚠️ Błąd powiadomienia o połączeniu: ${error.message}`);
                }
            }

            // Po dwóch nieudanych podejściach pula już się nie odezwie - klient socket.io
            // wyczerpał swoje pięć ponowień i milczy. Trzymanie Chrome'a przez pozostałe
            // kilkanaście minut to czysta strata pamięci i rdzeni serwera - a przy proxy
            // jest jeszcze co robić: `runBoost` weźmie kolejny adres wyjściowy.
            if (!stats.connected) {
                this.logger.warn(
                    `[CALC-BOOST] ⏹️ Wyjście ${stats.exitLabel} nie dołączyło do puli - ` +
                    'kończę podejście zamiast czekać do końca czasu'
                );
                return { ...stats };
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
        } catch (error) {
            // Awaria podejścia nie kończy boosta - `runBoost` sięgnie po kolejne proxy.
            // Wyjątek leci dalej tylko wtedy, gdy nie ma już czego próbować.
            this.logger.warn(`[CALC-BOOST] ⚠️ Podejście przez ${stats.exitLabel} nie wypaliło: ${error.message}`);
            stats.error = error.message;
            return { ...stats };
        } finally {
            // Sesję zeruje `runBoost` - tutaj tylko domykamy przeglądarkę tego podejścia
            if (this.session) this.session.browser = null;
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
        // Przy przerwaniu w trakcie rotacji proxy przeglądarki jeszcze nie ma
        if (browser) await this._closeBrowser(browser);
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
