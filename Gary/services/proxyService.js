const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.proxyList = config.proxy?.proxyList || [];
        // Losowy start proxy index przy każdym uruchomieniu
        this.currentProxyIndex = this.proxyList.length > 0 ? Math.floor(Math.random() * this.proxyList.length) : 0;
        this.enabled = config.proxy?.enabled || false;
        this.retryAttempts = config.proxy?.retryAttempts || 3;
        this.maxProxyAttempts = 10; // Maksymalnie 10 prób zmiany proxy
        this.usedProxies = new Set(); // Śledzenie użytych proxy w jednej próbie

        // Zaawansowane anti-detection: rotacja User-Agents
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        this.currentUserAgentIndex = 0;
    }

    /**
     * Get next proxy from the list (round-robin)
     * @returns {string|null} Proxy URL or null if no proxies available
     */
    getNextProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        const proxy = this.proxyList[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;

        return proxy;
    }

    /**
     * Get random proxy from the list
     * @returns {string|null} Proxy URL or null if no proxies available
     */
    getRandomProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        const randomIndex = Math.floor(Math.random() * this.proxyList.length);
        return this.proxyList[randomIndex];
    }

    /**
     * Get unused random proxy from the list
     * @returns {string|null} Proxy URL or null if no unused proxies available
     */
    getUnusedRandomProxy() {
        if (!this.enabled || this.proxyList.length === 0) {
            return null;
        }

        const availableProxies = this.proxyList.filter(proxy => !this.usedProxies.has(proxy));

        if (availableProxies.length === 0) {
            // Jeśli wszystkie proxy zostały użyte, resetuj listę i użyj losowego
            this.usedProxies.clear();
            // Dodaj shuffle dla większej losowości
            const shuffledProxies = [...this.proxyList].sort(() => Math.random() - 0.5);
            const selectedProxy = shuffledProxies[0];
            this.usedProxies.add(selectedProxy);
            return selectedProxy;
        }

        // Dodatkowo shuffle dostępnych proxy dla większej losowości
        const shuffledAvailable = [...availableProxies].sort(() => Math.random() - 0.5);
        const selectedProxy = shuffledAvailable[0];
        this.usedProxies.add(selectedProxy);
        return selectedProxy;
    }

    /**
     * Reset used proxies list
     */
    resetUsedProxies() {
        this.usedProxies.clear();
    }

    /**
     * Generate random IP address for anti-detection
     * @returns {string} Random IP address
     */
    generateRandomIP() {
        const randomOctet = () => Math.floor(Math.random() * 255) + 1;
        return `${randomOctet()}.${randomOctet()}.${randomOctet()}.${randomOctet()}`;
    }

    /**
     * Add session-based cookies for better Cloudflare bypass
     * @param {Object} headers - Existing headers
     * @returns {Object} Headers with cookies
     */
    addSessionCookies(headers) {
        // Generate realistic session cookies
        const sessionId = Math.random().toString(36).substring(2, 15);
        const timestamp = Date.now();

        headers['Cookie'] = [
            `cf_clearance=${sessionId}_${timestamp}`,
            `__cfduid=${sessionId}${timestamp}`,
            `sessionid=${sessionId}`,
            `csrftoken=${Math.random().toString(36).substring(2, 15)}`
        ].join('; ');

        return headers;
    }

    /**
     * Check if error is 403 Forbidden
     * @param {Error} error - Error object
     * @returns {boolean} True if error is 403
     */
    is403Error(error) {
        return error.response && error.response.status === 403;
    }

    /**
     * Get next User-Agent for rotation
     * @returns {string} User-Agent string
     */
    getNextUserAgent() {
        const userAgent = this.userAgents[this.currentUserAgentIndex];
        this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
        return userAgent;
    }

    /**
     * Generate realistic browser headers for Cloudflare bypass
     * @returns {Object} Headers object
     */
    generateCloudflareHeaders() {
        const userAgent = this.getNextUserAgent();
        const isChrome = userAgent.includes('Chrome');
        const isFirefox = userAgent.includes('Firefox');
        const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');

        const baseHeaders = {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        };

        // Chrome-specific headers
        if (isChrome) {
            baseHeaders['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
            baseHeaders['sec-ch-ua-mobile'] = '?0';
            baseHeaders['sec-ch-ua-platform'] = '"Windows"';
            baseHeaders['Sec-Fetch-Dest'] = 'document';
            baseHeaders['Sec-Fetch-Mode'] = 'navigate';
            baseHeaders['Sec-Fetch-Site'] = 'none';
            baseHeaders['Sec-Fetch-User'] = '?1';
        }

        // Firefox-specific headers
        if (isFirefox) {
            baseHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
            baseHeaders['Accept-Language'] = 'en-US,en;q=0.5';
        }

        // Safari-specific headers
        if (isSafari) {
            baseHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
            baseHeaders['Accept-Language'] = 'en-US,en;q=0.9';
        }

        return baseHeaders;
    }

    /**
     * Create axios instance with proxy configuration and advanced anti-detection
     * @param {string} proxyUrl - Proxy URL
     * @returns {Object} Configured axios instance
     */
    createProxyAxios(proxyUrl = null) {
        const baseConfig = {
            timeout: this.config.lunarMineSettings?.connectionTimeout || 20000,
            headers: this.generateCloudflareHeaders(),
            // Ignore SSL certificate errors for proxy connections
            httpsAgent: new (require('https')).Agent({
                rejectUnauthorized: false
            }),
            // Validate status codes - traktuj 403 jako błąd dla automatycznej zmiany proxy
            validateStatus: function (status) {
                return status >= 200 && status < 400; // Accept only 2xx, 3xx (success/redirect)
            },
            // Anti-detection: follow redirects
            maxRedirects: 5
        };

        if (proxyUrl && this.enabled) {
            try {
                const proxyAgent = new HttpsProxyAgent(proxyUrl, {
                    rejectUnauthorized: false, // Ignore SSL cert issues
                    timeout: 15000, // Longer timeout for stability
                    keepAlive: true, // Keep connections alive
                    keepAliveMsecs: 1000
                });

                baseConfig.httpsAgent = proxyAgent;
                baseConfig.httpAgent = proxyAgent;

                // Anti-detection: add proxy-specific headers
                baseConfig.headers['X-Forwarded-For'] = this.generateRandomIP();
                baseConfig.headers['X-Real-IP'] = this.generateRandomIP();

            } catch (error) {
                this.logger.warn(`⚠️ Invalid proxy URL: ${proxyUrl}, using direct connection`);
            }
        } else {
            // Anti-detection: even for direct connections, vary headers
            baseConfig.headers['X-Forwarded-For'] = this.generateRandomIP();
        }

        return axios.create(baseConfig);
    }

    /**
     * Make request with proxy rotation and retry logic
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Promise} Axios response
     */
    async makeRequest(url, options = {}) {
        let lastError;
        let proxyAttempts = 0;
        this.resetUsedProxies(); // Reset na początku każdego zapytania

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            let proxyUrl = null;

            // Użyj proxy tylko jeśli jest włączone i mamy dostępne proxy
            if (this.enabled && this.proxyList.length > 0) {
                proxyUrl = this.config.proxy?.strategy === 'random'
                    ? this.getUnusedRandomProxy()
                    : this.getNextProxy();
            }

            // Loguj informacje o używanym proxy
            if (proxyUrl) {
                this.logger.info(`🌐 Używam proxy: ${this.maskProxy(proxyUrl)} (próba ${attempt})`);
            } else {
                this.logger.info(`🔗 Bezpośrednie połączenie (próba ${attempt})`);
            }

            const axiosInstance = this.createProxyAxios(proxyUrl);

            try {
                const response = await axiosInstance.get(url, options);

                // Sprawdź czy otrzymaliśmy 403 mimo że nie był to axios error
                if (response.status === 403) {
                    const error403 = new Error(`HTTP 403 Forbidden`);
                    error403.response = response;
                    throw error403;
                }

                // Sukces - wyczyść używane proxy dla następnych zapytań
                if (proxyUrl) {
                    this.logger.info(`✅ Sukces przez proxy: ${this.maskProxy(proxyUrl)}`);
                } else {
                    this.logger.info(`✅ Sukces przez bezpośrednie połączenie`);
                }
                this.resetUsedProxies();
                return response;

            } catch (error) {
                lastError = error;

                if (proxyUrl) {
                    this.logger.warn(`❌ Request failed via proxy ${this.maskProxy(proxyUrl)} on attempt ${attempt}: ${error.message}`);
                } else {
                    this.logger.warn(`❌ Request failed via direct connection on attempt ${attempt}: ${error.message}`);
                }

                // Specjalne traktowanie błędu 403 - próbuj zmienić proxy
                if (this.is403Error(error) && this.enabled && this.proxyList.length > 0 && proxyAttempts < this.maxProxyAttempts) {
                    this.logger.warn(`🔄 Błąd 403 wykryty, próba zmiany proxy (${proxyAttempts + 1}/${this.maxProxyAttempts})`);
                    proxyAttempts++;

                    // Nie zwiększaj głównego licznika próób dla błędów 403
                    attempt--;

                    // Losowa pauza 1-3 sekundy dla uniknięcia rate limiting
                    const delay = Math.floor(Math.random() * 2000) + 1000;
                    this.logger.info(`⏱️ Pauza ${delay}ms przed kolejną próbą z nowym proxy...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // If this is the last attempt or we're not using proxies, don't continue
                if (attempt === this.retryAttempts || !this.enabled) {
                    break;
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        // Jeśli osiągnięto maksymalną liczbę prób proxy dla błędu 403
        if (proxyAttempts >= this.maxProxyAttempts) {
            this.logger.error(`❌ Osiągnięto maksymalną liczbę prób zmiany proxy (${this.maxProxyAttempts}) dla błędu 403`);
            const javascriptError = new Error('The garrytools.com search requires JavaScript execution that cannot be simulated by the bot. This is a technical limitation of web scraping. Try using the command again.');
            javascriptError.isJavaScriptError = true;
            throw javascriptError;
        }

        // If all proxy attempts failed, try direct connection as fallback
        if (this.enabled && this.proxyList.length > 0) {
            this.logger.warn(`⚠️ All proxy attempts failed, trying direct connection as fallback...`);

            try {
                const axiosInstance = this.createProxyAxios(null); // No proxy
                const response = await axiosInstance.get(url, options);

                this.logger.info(`✅ Fallback request successful via direct connection`);
                return response;

            } catch (directError) {
                this.logger.error(`❌ Direct connection fallback also failed: ${directError.message}`);
                throw lastError; // Throw original proxy error, not direct connection error
            }
        }

        // If all attempts failed, throw the last error
        throw lastError;
    }

    /**
     * Make POST request with proxy rotation and retry logic
     * @param {string} url - Request URL
     * @param {Object} data - POST data
     * @param {Object} options - Request options
     * @returns {Promise} Axios response
     */
    async makePostRequest(url, data, options = {}) {
        let lastError;
        let proxyAttempts = 0;
        this.resetUsedProxies(); // Reset na początku każdego zapytania

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            let proxyUrl = null;

            // Użyj proxy tylko jeśli jest włączone i mamy dostępne proxy
            if (this.enabled && this.proxyList.length > 0) {
                proxyUrl = this.config.proxy?.strategy === 'random'
                    ? this.getUnusedRandomProxy()
                    : this.getNextProxy();
            }

            // Loguj informacje o używanym proxy dla POST
            if (proxyUrl) {
                this.logger.info(`🌐 POST używam proxy: ${this.maskProxy(proxyUrl)} (próba ${attempt})`);
            } else {
                this.logger.info(`🔗 POST bezpośrednie połączenie (próba ${attempt})`);
            }

            const axiosInstance = this.createProxyAxios(proxyUrl);

            try {
                const response = await axiosInstance.post(url, data, options);

                // Sprawdź czy otrzymaliśmy 403 mimo że nie był to axios error
                if (response.status === 403) {
                    const error403 = new Error(`HTTP 403 Forbidden`);
                    error403.response = response;
                    throw error403;
                }

                // Sukces - wyczyść używane proxy dla następnych zapytań
                if (proxyUrl) {
                    this.logger.info(`✅ POST sukces przez proxy: ${this.maskProxy(proxyUrl)}`);
                } else {
                    this.logger.info(`✅ POST sukces przez bezpośrednie połączenie`);
                }
                this.resetUsedProxies();
                return response;

            } catch (error) {
                lastError = error;

                if (proxyUrl) {
                    this.logger.warn(`❌ POST request failed via proxy ${this.maskProxy(proxyUrl)} on attempt ${attempt}: ${error.message}`);
                } else {
                    this.logger.warn(`❌ POST request failed via direct connection on attempt ${attempt}: ${error.message}`);
                }

                // Specjalne traktowanie błędu 403 - próbuj zmienić proxy
                if (this.is403Error(error) && this.enabled && this.proxyList.length > 0 && proxyAttempts < this.maxProxyAttempts) {
                    this.logger.warn(`🔄 Błąd 403 wykryty w POST, próba zmiany proxy (${proxyAttempts + 1}/${this.maxProxyAttempts})`);
                    proxyAttempts++;

                    // Nie zwiększaj głównego licznika próób dla błędów 403
                    attempt--;

                    // Losowa pauza 1-3 sekundy dla uniknięcia rate limiting
                    const delay = Math.floor(Math.random() * 2000) + 1000;
                    this.logger.info(`⏱️ POST pauza ${delay}ms przed kolejną próbą z nowym proxy...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (attempt === this.retryAttempts || !this.enabled) {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        // Jeśli osiągnięto maksymalną liczbę prób proxy dla błędu 403
        if (proxyAttempts >= this.maxProxyAttempts) {
            this.logger.error(`❌ Osiągnięto maksymalną liczbę prób zmiany proxy (${this.maxProxyAttempts}) dla błędu 403 w POST`);
            const javascriptError = new Error('The garrytools.com search requires JavaScript execution that cannot be simulated by the bot. This is a technical limitation of web scraping. Try using the command again.');
            javascriptError.isJavaScriptError = true;
            throw javascriptError;
        }

        // If all proxy attempts failed, try direct connection as fallback
        if (this.enabled && this.proxyList.length > 0) {
            this.logger.warn(`⚠️ All proxy POST attempts failed, trying direct connection as fallback...`);

            try {
                const axiosInstance = this.createProxyAxios(null); // No proxy
                const response = await axiosInstance.post(url, data, options);

                this.logger.info(`✅ Fallback POST request successful via direct connection`);
                return response;

            } catch (directError) {
                this.logger.error(`❌ Direct connection POST fallback also failed: ${directError.message}`);
                throw lastError; // Throw original proxy error, not direct connection error
            }
        }

        throw lastError;
    }

    /**
     * Mask proxy URL for logging (hide credentials)
     * @param {string} proxyUrl - Full proxy URL
     * @returns {string} Masked proxy URL
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
     * Test all proxies and return working ones
     * @returns {Promise<Array>} Array of working proxy URLs
     */
    async testProxies() {
        if (!this.enabled || this.proxyList.length === 0) {
            this.logger.info('No proxies configured for testing');
            return [];
        }

        this.logger.info(`🧪 Testing ${this.proxyList.length} proxies...`);
        const workingProxies = [];
        const testUrl = 'http://httpbin.org/ip'; // Use HTTP instead of HTTPS for testing

        for (const proxy of this.proxyList) {
            try {
                const axiosInstance = this.createProxyAxios(proxy);
                const response = await axiosInstance.get(testUrl, { 
                    timeout: 8000,
                    httpsAgent: new (require('https')).Agent({
                        rejectUnauthorized: false
                    })
                });
                
                if (response.status === 200) {
                    workingProxies.push(proxy);
                    this.logger.info(`✅ Proxy working: ${this.maskProxy(proxy)} - IP: ${response.data.origin}`);
                }
            } catch (error) {
                this.logger.warn(`❌ Proxy failed: ${this.maskProxy(proxy)} - ${error.message}`);
            }
        }

        this.logger.info(`🧪 Proxy test completed: ${workingProxies.length}/${this.proxyList.length} working`);
        return workingProxies;
    }

    /**
     * Get proxy statistics
     * @returns {Object} Proxy usage statistics
     */
    getStats() {
        return {
            enabled: this.enabled,
            totalProxies: this.proxyList.length,
            currentIndex: this.currentProxyIndex,
            strategy: this.config.proxy?.strategy || 'round-robin',
            retryAttempts: this.retryAttempts,
            maxProxyAttempts: this.maxProxyAttempts,
            usedProxiesCount: this.usedProxies.size
        };
    }
}

module.exports = ProxyService;