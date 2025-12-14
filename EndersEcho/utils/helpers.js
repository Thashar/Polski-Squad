const https = require('https');
const http = require('http');
const fs = require('fs');

/**
 * Formatuje wiadomość z parametrami
 * @param {string} template - Szablon wiadomości
 * @param {Object} params - Parametry do zastąpienia
 * @returns {string} - Sformatowana wiadomość
 */
function formatMessage(template, params) {
    let formatted = template;
    for (const [key, value] of Object.entries(params)) {
        formatted = formatted.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return formatted;
}

/**
 * Pobiera plik z URL
 * @param {string} url - URL do pobrania
 * @param {string} filepath - Ścieżka do zapisu pliku
 * @returns {Promise<void>}
 */
async function downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const file = fs.createWriteStream(filepath);
        
        protocol.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = {
    formatMessage,
    downloadFile
};