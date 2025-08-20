const https = require('https');
const http = require('http');

class WebFetch {
    /**
     * Pobiera zawartość ze strony internetowej
     * @param {string} url - URL do pobrania
     * @param {string} prompt - Prompt dla AI (opcjonalny)
     * @returns {Promise<string>} - Zawartość strony
     */
    static async fetch(url, prompt = '') {
        return new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https');
            const client = isHttps ? https : http;
            
            const request = client.get(url, (response) => {
                let data = '';
                
                // Obsługa przekierowania
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return WebFetch.fetch(response.headers.location, prompt)
                        .then(resolve)
                        .catch(reject);
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                response.on('data', chunk => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        // Podstawowe parsowanie HTML - wyciągnij tekst
                        const textContent = data
                            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // usuń skrypty
                            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // usuń style
                            .replace(/<[^>]*>/g, ' ') // usuń tagi HTML
                            .replace(/\s+/g, ' ') // znormalizuj białe znaki
                            .trim();
                            
                        resolve(textContent);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            
            request.on('error', reject);
            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
}

module.exports = { WebFetch };