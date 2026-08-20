const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const store = require('../../utils/jsonStore');

/**
 * Pula proxy dla Stalkera — system przepisany z Garego (`Gary/services/proxyService.js`,
 * ten sam, z którego korzysta `/rivals`).
 *
 * Po co: IP hostingu jest zablokowane przez Cloudflare stojące przed API puli obliczeniowej
 * kalkulatora sio-tools, więc `/calc-boost` odbija się od wyzwania „Just a moment…".
 * Wyjście przez cudzy adres omija blokadę — dokładnie tak, jak Gary omija ją na garrytools.
 *
 * Różnica względem Garego: tam proxy wpinane jest w axiosa, tutaj przede wszystkim
 * w przeglądarkę (`--proxy-server` + `page.authenticate`). Reszta — rotacja, czarna lista
 * 403/407, trwałość statusów — działa tak samo.
 *
 * Lista proxy: `proxy.txt` w katalogu głównym (wspólny plik z Garym, poza gitem),
 * a gdy pliku nie ma — Webshare API. Statusy błędów trzymane są OSOBNO od Garego
 * (`Stalker/data/proxy_status.json`): proxy zablokowane przez garrytools potrafi
 * bez problemu obsłużyć sio-tools i odwrotnie.
 */
class ProxyService {
    constructor(config, logger) {
        // Singleton — jeden zestaw statusów na proces, tak samo jak w Garym
        if (ProxyService.instance) {
            return ProxyService.instance;
        }

        this.config = config;
        this.logger = logger;
        this.enabled = config.proxy?.enabled || false;
        this.proxyList = config.proxy?.proxyList || [];
        this.strategy = config.proxy?.strategy || 'random';
        this.retryAttempts = config.proxy?.retryAttempts || 3;

        // Losowy start indeksu — inaczej po każdym restarcie ruch szedłby od tego samego proxy
        this.currentProxyIndex = this.proxyList.length > 0
            ? Math.floor(Math.random() * this.proxyList.length)
            : 0;

        this.proxyStatusFile = path.join(__dirname, '../data/proxy_status.json');
        this.ensureDataDirectory();

        this.disabledProxies = new Set();   // trwale wyłączone (407)
        this.proxyErrors = new Map();       // szczegóły blokad (407 i 403)
        this.usedProxies = new Set();       // proxy zużyte w ramach JEDNEGO boosta

        this.loadProxyStatuses();

        // Plik jest głównym źródłem listy, Webshare tylko zapasem gdy pliku brak
        if (this.enabled && this.config.proxy?.refreshOnStartup) {
            const wczytanoZPliku = this.loadProxyListFromFile();

            if (!wczytanoZPliku && this.config.proxy?.webshareUrl) {
                this.refreshProxyListFromWebshare().catch(error => {
                    this.logger.warn(`[PROXY] ⚠️ Nie udało się pobrać listy z Webshare: ${error.message}`);
                });
            }

            if (this.proxyList.length > 0) {
                this.currentProxyIndex = Math.floor(Math.random() * this.proxyList.length);
            }
        }

        if (this.enabled) {
            this.logger.info(`[PROXY] 🌐 Pula proxy włączona: ${this.proxyList.length} adresów, strategia "${this.strategy}"`);
        }

        ProxyService.instance = this;
    }

    /**
     * Zapewnia istnienie katalogu data
     */
    ensureDataDirectory() {
        const dataDir = path.dirname(this.proxyStatusFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    /**
     * Wczytuje statusy proxy z pliku (odczyt z dysku tylko raz — dalej z cache jsonStore)
     */
    loadProxyStatuses() {
        try {
            const data = store.getSync(this.proxyStatusFile, () => ({}));
            const now = Date.now();

            Object.entries(data.proxyErrors || {}).forEach(([maska, blad]) => {
                const disabledAt = new Date(blad.disabledAt).getTime();

                // 407 = wygasłe konto proxy, blokada trwała
                if (blad.status === 407) {
                    this.disabledProxies.add(maska);
                    this.proxyErrors.set(maska, blad);
                    this.logger.warn(`[PROXY] 🚫 Wczytano trwale wyłączone proxy: ${maska} (407 — wymień dane dostępowe)`);
                    return;
                }

                // 403 = blokada Cloudflare, wygasa po 24 h
                if (blad.status === 403) {
                    const doba = 24 * 60 * 60 * 1000;
                    if (now - disabledAt < doba) {
                        this.proxyErrors.set(maska, blad);
                    }
                }
            });

            const zablokowane24h = this.proxyErrors.size - this.disabledProxies.size;
            if (zablokowane24h > 0) {
                this.logger.info(`[PROXY] ⏰ ${zablokowane24h} proxy nadal w 24-godzinnej blokadzie Cloudflare`);
            }

            // Lista zapisana w statusach służy tylko gdy plik proxy.txt zniknie.
            // ⚠️ Lista podana wprost w konfiguracji (.env) ma pierwszeństwo — inaczej wpis
            // sprzed tygodni po cichu zastępowałby to, co człowiek świadomie ustawił.
            if (this.proxyList.length === 0 && Array.isArray(data.proxyList) && data.proxyList.length > 0) {
                this.proxyList = data.proxyList;
            }
        } catch (error) {
            this.logger.error(`[PROXY] ❌ Błąd wczytywania statusów proxy: ${error.message}`);
        }
    }

    /**
     * Zapisuje statusy proxy. Fire-and-forget — wołane z miejsc synchronicznych,
     * a blokujący zapis wstrzymałby proces wszystkich dziewięciu botów.
     */
    saveProxyStatuses() {
        const data = {
            proxyList: this.proxyList,
            proxyErrors: Object.fromEntries(this.proxyErrors),
            lastUpdated: new Date().toISOString()
        };

        store.set(this.proxyStatusFile, data).catch(error => {
            this.logger.error(`[PROXY] ❌ Błąd zapisywania statusów proxy: ${error.message}`);
        });
    }

    /**
     * Parsuje linię pliku proxy do formatu http://user:pass@ip:port
     * Obsługiwane formaty: user:pass@ip:port, http(s)://..., ip:port, ip:port:user:pass (Webshare)
     */
    parseProxyLine(line) {
        if (/^https?:\/\//i.test(line)) {
            return line;
        }
        if (line.includes('@')) {
            return `http://${line}`;
        }
        const parts = line.split(':');
        if (parts.length === 2) {
            return `http://${line}`;
        }
        if (parts.length === 4) {
            const [ip, port, username, password] = parts;
            return `http://${username}:${password}@${ip}:${port}`;
        }
        return null;
    }

    /**
     * Wczytuje listę proxy z lokalnego pliku (domyślnie proxy.txt w katalogu głównym)
     * @returns {boolean} true gdy wczytano przynajmniej jedno proxy
     */
    loadProxyListFromFile() {
        try {
            const filePath = this.config.proxy?.proxyFilePath;
            if (!filePath) {
                this.logger.warn('[PROXY] ⚠️ Ścieżka pliku proxy nie jest skonfigurowana (proxyFilePath)');
                return false;
            }

            if (!fs.existsSync(filePath)) {
                this.logger.warn(`[PROXY] ⚠️ Plik proxy nie istnieje: ${filePath}`);
                return false;
            }

            const lines = fs.readFileSync(filePath, 'utf8')
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));

            const nowaLista = [];
            for (const line of lines) {
                const proxyUrl = this.parseProxyLine(line);
                if (proxyUrl) {
                    nowaLista.push(proxyUrl);
                } else {
                    this.logger.warn(`[PROXY] ⚠️ Pominięto nieprawidłową linię proxy: ${line}`);
                }
            }

            if (nowaLista.length === 0) {
                this.logger.warn(`[PROXY] ⚠️ Brak prawidłowych proxy w pliku: ${filePath}`);
                return false;
            }

            this.proxyList = nowaLista;
            this.saveProxyStatuses();
            this.logger.info(`[PROXY] 📄 Wczytano ${nowaLista.length} proxy z pliku ${filePath}`);
            return true;
        } catch (error) {
            this.logger.error(`[PROXY] ❌ Błąd wczytywania listy proxy z pliku: ${error.message}`);
            return false;
        }
    }

    /**
     * Pobiera listę proxy z Webshare API (zapas, gdy pliku proxy.txt nie ma)
     */
    async refreshProxyListFromWebshare() {
        const webshareUrl = this.config.proxy?.webshareUrl;
        if (!webshareUrl) {
            throw new Error('Webshare URL nie jest skonfigurowany');
        }

        const response = await axios.get(webshareUrl, {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const nowaLista = [];
        for (const line of String(response.data).trim().split('\n')) {
            const proxyUrl = this.parseProxyLine(line.trim());
            if (proxyUrl) nowaLista.push(proxyUrl);
        }

        if (nowaLista.length === 0) {
            throw new Error('Webshare nie zwrócił żadnego prawidłowego proxy');
        }

        this.proxyList = nowaLista;
        this.saveProxyStatuses();
        this.logger.info(`[PROXY] ✅ Pobrano ${nowaLista.length} proxy z Webshare`);
    }

    /**
     * Czy proxy jest wyłączone (407 na stałe, 403 na dobę)
     */
    isProxyDisabled(proxyUrl) {
        const maska = this.maskProxy(proxyUrl);

        if (this.disabledProxies.has(maska)) {
            return true;
        }

        const blad = this.proxyErrors.get(maska);
        if (blad && blad.status === 403) {
            const doba = 24 * 60 * 60 * 1000;
            const minelo = Date.now() - new Date(blad.disabledAt).getTime();

            if (minelo < doba) {
                return true;
            }

            this.proxyErrors.delete(maska);
            this.saveProxyStatuses();
            this.logger.info(`[PROXY] ✅ Proxy odblokowane po 24 h: ${maska}`);
        }

        return false;
    }

    /**
     * Wyłącza proxy: 407 trwale (wygasłe konto), 403 na dobę (blokada Cloudflare)
     */
    disableProxy(proxyUrl, statusCode, errorMessage) {
        const maska = this.maskProxy(proxyUrl);

        if (statusCode === 407) {
            this.disabledProxies.add(maska);
            this.proxyErrors.set(maska, {
                status: 407,
                error: errorMessage,
                disabledAt: new Date().toISOString(),
                type: 'PERMANENT'
            });
            this.logger.warn(`[PROXY] 🚫 Proxy trwale wyłączone: ${maska} | 407 — konto wygasło, wymień dane dostępowe`);
            this.saveProxyStatuses();
            return;
        }

        if (statusCode === 403) {
            this.proxyErrors.set(maska, {
                status: 403,
                error: errorMessage,
                disabledAt: new Date().toISOString(),
                type: 'TEMPORARY_24H'
            });
            this.logger.warn(`[PROXY] ⏰ Proxy zablokowane na 24 h: ${maska} | 403 — blokada Cloudflare`);
            this.saveProxyStatuses();
        }
    }

    /**
     * Kolejne proxy z listy (round-robin) z pominięciem wyłączonych
     */
    getNextProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        for (let proba = 0; proba < this.proxyList.length; proba++) {
            const proxy = this.proxyList[this.currentProxyIndex];
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;

            if (!this.isProxyDisabled(proxy)) {
                return proxy;
            }
        }

        this.logger.warn('[PROXY] ⚠️ Wszystkie proxy są wyłączone!');
        return null;
    }

    /**
     * Losowe proxy z pominięciem wyłączonych
     */
    getRandomProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        const dostepne = this.proxyList.filter(proxy => !this.isProxyDisabled(proxy));
        if (dostepne.length === 0) {
            this.logger.warn('[PROXY] ⚠️ Wszystkie proxy są wyłączone!');
            return null;
        }

        return dostepne[Math.floor(Math.random() * dostepne.length)];
    }

    /**
     * Losowe proxy jeszcze NIEUŻYTE w tym boostcie — żeby kolejne podejście szło
     * naprawdę innym adresem, a nie tym samym co przed chwilą
     */
    getUnusedRandomProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        const dostepne = this.proxyList.filter(proxy =>
            !this.usedProxies.has(proxy) && !this.isProxyDisabled(proxy)
        );

        if (dostepne.length === 0) {
            // Pula wyczerpana — zaczynamy od nowa, ale nadal omijamy zablokowane
            this.usedProxies.clear();
            const niezablokowane = this.proxyList.filter(proxy => !this.isProxyDisabled(proxy));

            if (niezablokowane.length === 0) {
                this.logger.warn('[PROXY] ⚠️ Wszystkie proxy są zablokowane!');
                return null;
            }

            const wybrane = niezablokowane[Math.floor(Math.random() * niezablokowane.length)];
            this.usedProxies.add(wybrane);
            return wybrane;
        }

        const wybrane = dostepne[Math.floor(Math.random() * dostepne.length)];
        this.usedProxies.add(wybrane);
        return wybrane;
    }

    /**
     * Wybiera proxy zgodnie ze skonfigurowaną strategią
     */
    pickProxy() {
        if (this.strategy === 'round-robin') {
            const proxy = this.getNextProxy();
            if (proxy) this.usedProxies.add(proxy);
            return proxy;
        }
        return this.getUnusedRandomProxy();
    }

    /**
     * Czyści listę proxy zużytych w bieżącym boostcie
     */
    resetUsedProxies() {
        this.usedProxies.clear();
    }

    /**
     * Rozbija URL proxy na kawałki, których potrzebuje przeglądarka.
     *
     * ⚠️ Chromium NIE przyjmuje danych logowania w `--proxy-server` — trafiają one
     * osobno do `page.authenticate()`. Stąd `server` bez użytkownika i hasła.
     */
    describeProxy(proxyUrl) {
        if (!proxyUrl) return null;

        try {
            const url = new URL(proxyUrl);
            const protokol = url.protocol === 'https:' ? 'https' : 'http';

            return {
                url: proxyUrl,
                server: `${protokol}://${url.hostname}:${url.port}`,
                username: url.username ? decodeURIComponent(url.username) : null,
                password: url.password ? decodeURIComponent(url.password) : null,
                masked: this.maskProxy(proxyUrl),
                // Klucz profilu przeglądarki — ciasteczko cf_clearance jest przypisane
                // do adresu wyjściowego, więc każdy adres dostaje własny profil
                profileKey: `${url.hostname}_${url.port}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
            };
        } catch {
            this.logger.warn('[PROXY] ⚠️ Nieprawidłowy URL proxy — pomijam');
            return null;
        }
    }

    /**
     * Instancja axiosa idąca przez proxy (diagnostyka łączności przed startem przeglądarki)
     */
    createProxyAxios(proxyUrl = null, options = {}) {
        const baseConfig = {
            timeout: options.timeout || 15000,
            validateStatus: () => true,
            maxRedirects: 5,
            httpsAgent: new (require('https')).Agent({ rejectUnauthorized: false })
        };

        if (proxyUrl && this.enabled) {
            const agent = new HttpsProxyAgent(proxyUrl, {
                rejectUnauthorized: false,
                timeout: 15000,
                keepAlive: true,
                keepAliveMsecs: 1000
            });
            baseConfig.httpsAgent = agent;
            baseConfig.httpAgent = agent;
        }

        return axios.create(baseConfig);
    }

    /**
     * Wyciąga kod błędu proxy z wyjątku axiosa.
     *
     * Odrzucenie na etapie tunelu CONNECT nie ma `response` — kod siedzi wtedy
     * wyłącznie w treści komunikatu ("407 Proxy Authentication Required").
     */
    rozpoznajBladProxy(error) {
        const status = error?.response?.status;
        if (status === 407 || status === 403) return status;

        const tresc = String(error?.message || '');
        if (/\b407\b/.test(tresc)) return 407;
        if (/\b403\b/.test(tresc)) return 403;
        return null;
    }

    /**
     * Maskuje dane logowania w URL proxy (do logów)
     */
    maskProxy(proxyUrl) {
        try {
            const url = new URL(proxyUrl);
            if (url.username) {
                return `${url.protocol}//${url.username}:***@${url.hostname}:${url.port}`;
            }
            return `${url.protocol}//${url.hostname}:${url.port}`;
        } catch {
            return 'invalid-proxy';
        }
    }

    /**
     * Statystyki puli proxy
     */
    getStats() {
        const dostepne = this.proxyList.filter(proxy => !this.isProxyDisabled(proxy));

        return {
            enabled: this.enabled,
            totalProxies: this.proxyList.length,
            availableProxies: dostepne.length,
            disabledProxies: this.disabledProxies.size,
            strategy: this.strategy,
            retryAttempts: this.retryAttempts,
            proxyErrors: Array.from(this.proxyErrors.entries()).map(([proxy, blad]) => ({
                proxy,
                status: blad.status,
                type: blad.type,
                disabledAt: blad.disabledAt
            }))
        };
    }

    /**
     * Resetuje singleton (do testów / restartu modułu)
     */
    static resetInstance() {
        ProxyService.instance = null;
    }
}

ProxyService.instance = null;

module.exports = ProxyService;
