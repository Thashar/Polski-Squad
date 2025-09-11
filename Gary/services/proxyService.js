const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.proxyList = config.proxy?.proxyList || [];
        this.currentProxyIndex = 0;
        this.enabled = config.proxy?.enabled || false;
        this.retryAttempts = config.proxy?.retryAttempts || 3;
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
     * Create axios instance with proxy configuration
     * @param {string} proxyUrl - Proxy URL
     * @returns {Object} Configured axios instance
     */
    createProxyAxios(proxyUrl = null) {
        const baseConfig = {
            timeout: this.config.lunarMineSettings?.connectionTimeout || 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Cache-Control': 'max-age=0'
            },
            // Ignore SSL certificate errors for proxy connections
            httpsAgent: new (require('https')).Agent({
                rejectUnauthorized: false
            }),
            // Validate status codes more permissively
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Accept 2xx, 3xx, 4xx
            }
        };

        if (proxyUrl && this.enabled) {
            try {
                const proxyAgent = new HttpsProxyAgent(proxyUrl, {
                    rejectUnauthorized: false, // Ignore SSL cert issues
                    timeout: 10000 // Shorter timeout for proxy connection
                });
                
                baseConfig.httpsAgent = proxyAgent;
                baseConfig.httpAgent = proxyAgent;
                // Proxy usage logged (reduced verbosity)
            } catch (error) {
                this.logger.warn(`⚠️ Invalid proxy URL: ${proxyUrl}, using direct connection`);
            }
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
        
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            const proxyUrl = this.config.proxy?.strategy === 'random' 
                ? this.getRandomProxy() 
                : this.getNextProxy();
            
            const axiosInstance = this.createProxyAxios(proxyUrl);
            
            try {
                const response = await axiosInstance.get(url, options);
                
                // Success logging reduced for cleaner output
                
                return response;
                
            } catch (error) {
                lastError = error;
                
                if (proxyUrl) {
                    this.logger.warn(`❌ Request failed via proxy ${this.maskProxy(proxyUrl)} on attempt ${attempt}: ${error.message}`);
                } else {
                    this.logger.warn(`❌ Request failed via direct connection on attempt ${attempt}: ${error.message}`);
                }
                
                // If this is the last attempt or we're not using proxies, don't continue
                if (attempt === this.retryAttempts || !this.enabled) {
                    break;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
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
        
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            const proxyUrl = this.config.proxy?.strategy === 'random' 
                ? this.getRandomProxy() 
                : this.getNextProxy();
            
            const axiosInstance = this.createProxyAxios(proxyUrl);
            
            try {
                const response = await axiosInstance.post(url, data, options);
                
                if (proxyUrl) {
                    this.logger.info(`✅ POST request successful via proxy on attempt ${attempt}`);
                } else {
                    this.logger.info(`✅ POST request successful via direct connection on attempt ${attempt}`);
                }
                
                return response;
                
            } catch (error) {
                lastError = error;
                
                if (proxyUrl) {
                    this.logger.warn(`❌ POST request failed via proxy ${this.maskProxy(proxyUrl)} on attempt ${attempt}: ${error.message}`);
                } else {
                    this.logger.warn(`❌ POST request failed via direct connection on attempt ${attempt}: ${error.message}`);
                }
                
                if (attempt === this.retryAttempts || !this.enabled) {
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
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
            retryAttempts: this.retryAttempts
        };
    }
}

module.exports = ProxyService;