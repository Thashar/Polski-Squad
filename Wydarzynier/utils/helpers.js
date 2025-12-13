/**
 * Funkcje pomocnicze dla bota Wydarzynier.
 * -------------------------------------------------
 * • formatowanie wiadomości
 * • operacje na czasie
 * • walidacje
 */

/**
 * Formatuje wiadomość z parametrami (podobnie jak w pozostałych botach)
 * @param {string} template - Szablon wiadomości
 * @param {Object} params - Parametry do podstawienia
 * @returns {string} - Sformatowana wiadomość
 */
function formatMessage(template, params) {
    let formatted = template;
    
    for (const [key, value] of Object.entries(params)) {
        const placeholder = `{${key}}`;
        formatted = formatted.replace(new RegExp(placeholder, 'g'), value);
    }
    
    return formatted;
}

/**
 * Opóźnienie (podobnie jak w innych botach)
 * @param {number} ms - Milisekundy
 * @returns {Promise} - Promise resolve po określonym czasie
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sprawdza czy użytkownik może używać komend
 * @param {string} channelId - ID kanału
 * @param {string} allowedChannelId - ID dozwolonego kanału
 * @returns {boolean} - Czy kanał jest dozwolony
 */
function isAllowedChannel(channelId, allowedChannelId) {
    return channelId === allowedChannelId;
}

module.exports = {
    formatMessage,
    delay,
    isAllowedChannel
};