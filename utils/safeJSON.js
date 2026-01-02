const fs = require('fs').promises;

/**
 * Bezpieczne parsowanie JSON z obsługą pustych plików i błędów parsowania
 * @param {string} data - Dane do sparsowania
 * @param {*} defaultValue - Wartość domyślna jeśli dane są puste lub uszkodzone (domyślnie {})
 * @returns {*} Sparsowane dane lub wartość domyślna
 */
function safeParse(data, defaultValue = {}) {
    if (!data || data.trim() === '') {
        return defaultValue;
    }
    try {
        return JSON.parse(data);
    } catch (error) {
        // Jeśli parsowanie się nie powiedzie (uszkodzony JSON), zwróć wartość domyślną
        console.warn(`⚠️ Nie udało się sparsować JSON: ${error.message}`);
        return defaultValue;
    }
}

/**
 * Bezpieczne wczytanie i parsowanie pliku JSON
 * @param {string} filePath - Ścieżka do pliku
 * @param {*} defaultValue - Wartość domyślna jeśli plik pusty/nie istnieje (domyślnie {})
 * @returns {Promise<*>} Sparsowane dane lub wartość domyślna
 */
async function safeReadJSON(filePath, defaultValue = {}) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return safeParse(data, defaultValue);
    } catch (error) {
        // Plik nie istnieje - zwróć wartość domyślną
        if (error.code === 'ENOENT') {
            return defaultValue;
        }
        // Inny błąd - rzuć dalej
        throw error;
    }
}

module.exports = {
    safeParse,
    safeReadJSON
};
