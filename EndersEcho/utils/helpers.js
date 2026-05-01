const https = require('https');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

const ALLOWED_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net',
    'attachments.discord-activities.com',
]);

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25 MB

function validateUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Nieprawidłowy URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Dozwolony wyłącznie protokół HTTPS`);
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(`Host "${parsed.hostname}" nie jest dozwolony`);
    }
    return parsed;
}

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
 * Pobiera plik z URL (tylko z dozwolonych hostów Discord CDN)
 * @param {string} url - URL do pobrania
 * @param {string} filepath - Ścieżka do zapisu pliku
 * @returns {Promise<void>}
 */
async function downloadFile(url, filepath) {
    validateUrl(url);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        let totalSize = 0;

        https.get(url, (response) => {
            response.on('data', chunk => {
                totalSize += chunk.length;
                if (totalSize > MAX_DOWNLOAD_SIZE) {
                    response.destroy();
                    file.close();
                    reject(new Error(`Plik przekracza limit ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB`));
                    return;
                }
                file.write(chunk);
            });
            response.on('end', () => { file.close(); resolve(); });
            response.on('error', err => { file.close(); reject(err); });
        }).on('error', reject);
    });
}

/**
 * Pobiera plik z URL do bufora w pamięci (tylko z dozwolonych hostów Discord CDN)
 * @param {string} url - URL do pobrania
 * @returns {Promise<Buffer>}
 */
async function downloadBuffer(url) {
    validateUrl(url);
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalSize = 0;

        https.get(url, (response) => {
            response.on('data', chunk => {
                totalSize += chunk.length;
                if (totalSize > MAX_DOWNLOAD_SIZE) {
                    response.destroy();
                    reject(new Error(`Plik przekracza limit ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB`));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

module.exports = {
    formatMessage,
    downloadFile,
    downloadBuffer
};