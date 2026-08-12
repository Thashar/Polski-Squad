/**
 * Funkcje pomocnicze dla bota Wydarzynier.
 */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Kody Discorda oznaczające, że zasób po drugiej stronie już nie istnieje.
// Ponawianie nie ma sensu - zamiast tego trzeba posprzątać własny stan.
const GONE_ERROR_CODES = new Set([
    10003, // Unknown Channel - wątek lobby został skasowany
    10008, // Unknown Message - ogłoszenie albo prośba o dołączenie zniknęła
    10015, // Unknown Webhook - token panelu ±1 wygasł
    10062, // Unknown interaction - minęły 3 s na pierwszą odpowiedź
]);

/**
 * Czy błąd oznacza, że zasób Discorda przepadł i nie ma czego naprawiać
 * @param {Error} error - Błąd z discord.js
 * @returns {boolean}
 */
function isGoneError(error) {
    return GONE_ERROR_CODES.has(error?.code);
}

// Zanik sieci/DNS na hostingu - przerywa operację w losowym miejscu, więc bot
// musi założyć, że część pracy się nie wykonała i mimo to zostawić spójny stan.
const NETWORK_ERROR_CODES = new Set([
    'EAI_AGAIN',    // DNS nie odpowiedział - typowe dla kontenerów z lokalnym resolverem
    'ENOTFOUND',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
]);

/**
 * Czy błąd to zanik łączności z Discordem (a nie odpowiedź API)
 * @param {Error} error - Złapany błąd
 * @returns {boolean}
 */
function isNetworkError(error) {
    return NETWORK_ERROR_CODES.has(error?.code) || NETWORK_ERROR_CODES.has(error?.cause?.code);
}

/**
 * Wyświetla w wątku odliczanie i czeka, aż dobiegnie końca (wiadomość edytowana co sekundę).
 * Używane przed usunięciem wątku lobby - zarówno przy zamknięciu przez właściciela,
 * jak i przy wygaśnięciu czasu lobby.
 * @param {ThreadChannel} thread - Wątek lobby
 * @param {number} seconds - Ile sekund odliczać
 * @param {Function} messageFactory - (pozostałeSekundy) => treść wiadomości
 */
async function runThreadCountdown(thread, seconds, messageFactory) {
    const message = await thread.send(messageFactory(seconds));

    for (let remaining = seconds - 1; remaining >= 1; remaining--) {
        await delay(1000);
        await message.edit(messageFactory(remaining)).catch(() => {});
    }

    await delay(1000);
}

module.exports = {
    delay,
    runThreadCountdown,
    isGoneError,
    isNetworkError,
};
