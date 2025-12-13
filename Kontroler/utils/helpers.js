const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

/**
 * Formatuje wiadomość zamieniając placeholdery
 * @param {string} template - Szablon wiadomości
 * @param {Object} params - Parametry do podstawienia
 * @returns {string} - Sformatowana wiadomość
 */
function formatMessage(template, params = {}) {
    let formatted = template;
    
    Object.entries(params).forEach(([key, value]) => {
        const placeholder = `{${key}}`;
        formatted = formatted.replace(new RegExp(placeholder, 'g'), value);
    });
    
    return formatted;
}

/**
 * Pobiera plik z URL i zapisuje lokalnie
 * @param {string} url - URL pliku
 * @param {string} filePath - Ścieżka docelowa
 */
async function downloadFile(url, filePath) {
    logger.info(`Pobieranie pliku z: ${url}`);
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        
        logger.info(`Plik zapisany: ${path.basename(filePath)}`);
        return filePath;
    } catch (error) {
        logger.error(`Błąd pobierania pliku: ${error.message}`);
        throw error;
    }
}

/**
 * Czyści pliki tymczasowe
 * @param {...string} filePaths - Ścieżki plików do usunięcia
 */
function cleanupFiles(...filePaths) {
    filePaths.forEach(filePath => {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                logger.info(`Usunięto plik tymczasowy: ${path.basename(filePath)}`);
            } catch (error) {
                logger.error(`Błąd usuwania pliku ${filePath}: ${error.message}`);
            }
        }
    });
}

/**
 * Bezpieczna edycja wiadomości Discord
 * @param {Message} message - Wiadomość do edycji
 * @param {string} content - Nowa treść
 * @returns {boolean} - Czy edycja się powiodła
 */
async function safeEditMessage(message, content) {
    try {
        await message.fetch();
        await message.edit({ content });
        return true;
    } catch (error) {
        if (error.code === 10008) {
            logger.warn('Wiadomość została usunięta przez użytkownika - pomijam edycję');
        } else {
            logger.error(`Błąd edycji wiadomości: ${error.message}`);
        }
        return false;
    }
}

/**
 * Sprawdza podobieństwo stringów używając algorytmu Levenshtein
 * @param {string} str1 - Pierwszy string
 * @param {string} str2 - Drugi string
 * @returns {number} - Podobieństwo od 0 do 1
 */
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    const len1 = str1.length;
    const len2 = str2.length;
    if (len1 === 0 || len2 === 0) return 0.0;

    const matrix = [];
    for (let i = 0; i <= len2; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len1; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len2; i++) {
        for (let j = 1; j <= len1; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    const distance = matrix[len2][len1];
    const maxLen = Math.max(len1, len2);
    return (maxLen - distance) / maxLen;
}

/**
 * Sprawdza czy nick jest podobny z danym progiem
 * @param {string} nick1 - Pierwszy nick
 * @param {string} nick2 - Drugi nick
 * @param {number} threshold - Próg podobieństwa (0-1)
 * @returns {boolean} - Czy nicki są podobne
 */
function isSimilarNick(nick1, nick2, threshold = 0.4) {
    const normalized1 = nick1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalized2 = nick2.toLowerCase().replace(/[^a-z0-9]/g, '');
    const similarity = calculateSimilarity(normalized1, normalized2);
    
    logger.info(`Podobieństwo "${normalized1}" vs "${normalized2}": ${(similarity * 100).toFixed(1)}%`);
    return similarity >= threshold;
}

module.exports = {
    formatMessage,
    downloadFile,
    cleanupFiles,
    safeEditMessage,
    calculateSimilarity,
    isSimilarNick
};