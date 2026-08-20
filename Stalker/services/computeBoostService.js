const fs = require('fs');

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
     * Znajduje binarkę Chromium/Chrome. Kolejność: konfiguracja (.env) → typowe ścieżki
     * systemowe Linuksa (serwer) → przeglądarki z Windowsa (praca lokalna).
     */
    resolveChromiumPath() {
        const candidates = [
            this.config.chromiumPath,
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
            peakWorkers: 0,
            peakHosts: 0,
            peakAppetite: 0,
            durationMs: czas,
            executablePath
        };

        let browser = null;

        try {
            browser = await puppeteer.launch({
                executablePath,
                headless: true,
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
                    '--disable-backgrounding-occluded-windows'
                ]
            });

            const page = await browser.newPage();
            const maxThreads = this.config.maxThreads;

            await page.evaluateOnNewDocument((poolId, limit) => {
                const rdzenie = navigator.hardwareConcurrency || 4;
                const watki = limit ? Math.min(limit, rdzenie) : rdzenie;
                localStorage.setItem('computePool', JSON.stringify(poolId));
                localStorage.setItem('multithread', JSON.stringify(watki));
            }, this.config.poolId, maxThreads);

            // Ruch z pulą leci po WebSockecie, więc podglądamy go przez CDP - stąd wiemy,
            // czy przeglądarka faktycznie dołączyła i ile zadań przeliczyła.
            const cdp = await page.createCDPSession();
            await cdp.send('Network.enable');

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
                    if (onPoolJoin) { onPoolJoin(); onPoolJoin = null; }
                } else if (nazwa === 'compute:do_job') {
                    stats.jobsReceived++;
                }
            });

            cdp.on('Network.webSocketFrameSent', event => {
                const frame = parseFrame(event.request && event.request.payloadData);
                if (frame && frame[0] === 'compute:done') stats.jobsDone++;
            });

            await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            stats.threads = await page.evaluate(() => JSON.parse(localStorage.getItem('multithread') || '0'));

            const startedAt = Date.now();
            this.session = { browser, startedAt, endsAt: startedAt + czas, stats, requestedBy };

            this.logger.info(
                `[CALC-BOOST] 🚀 Start (${requestedBy}) - pula "${this.config.poolId}", ` +
                `${stats.threads} wątków, ${Math.round(czas / 1000)} s`
            );

            // Czekamy na meldunek w puli, ale nie dłużej niż 20 s - przeglądarkę i tak
            // trzymamy do końca zadeklarowanego czasu.
            await Promise.race([poolJoined, new Promise(resolve => setTimeout(resolve, 20000))]);

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
                `[CALC-BOOST] ✅ Koniec - odebrano ${stats.jobsReceived} zadań, ` +
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
