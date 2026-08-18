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
async function downloadFile(url, filePath, maxBytes = 5 * 1024 * 1024) {
    logger.info(`Pobieranie pliku z: ${url}`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // ⚠️ Twardy limit NA POBRANIU, niezależny od deklarowanego rozmiaru załącznika.
        // Wywołujący sprawdza `attachment.size` z metadanych Discorda, ale to tylko
        // deklaracja — cała treść i tak ląduje w pamięci przez `arrayBuffer()`.
        // Ten strażnik odcina zarówno kłamiący nagłówek, jak i każdą inną ścieżkę
        // wywołania, która zapomniałaby sprawdzić rozmiar przed pobraniem.
        const deklarowany = Number(response.headers.get('content-length'));
        if (Number.isFinite(deklarowany) && deklarowany > maxBytes) {
            throw new Error(`Plik za duży: ${(deklarowany / 1024 / 1024).toFixed(2)} MB (limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
            throw new Error(`Plik za duży: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB (limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
        }

        await fs.promises.writeFile(filePath, Buffer.from(buffer));

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
/**
 * Normalizacja nicku do porównań — IDENTYCZNA jak `analysisService.normalizeNick()`.
 *
 * ⚠️ Wcześniej było tu `[^a-z0-9]`, czyli polskie znaki wypadały CAŁKOWICIE:
 * „Żółw" zwijało się do „w", a „Ćma" do „ma". Przy progu podobieństwa 0.4 groziło
 * to dopasowaniem wyniku do niewłaściwego gracza. Faza 1 dopasowania
 * (`analysisService`) od zawsze zachowywała `ąćęłńóśźż` — te dwie ścieżki po prostu
 * się rozjeżdżały.
 *
 * To NIE ma związku z Tesseractem: normalizacja działa na tekście JUŻ odczytanym
 * przez OCR (dziś AI), a nie na rozpoznawaniu znaków z obrazu.
 */
function normalizeNick(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
}

function isSimilarNick(nick1, nick2, threshold = 0.4) {
    const normalized1 = normalizeNick(nick1);
    const normalized2 = normalizeNick(nick2);
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
    normalizeNick,
    isSimilarNick
};