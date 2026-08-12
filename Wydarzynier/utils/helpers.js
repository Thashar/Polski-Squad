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

// Discord liczy 3 s na pierwszą odpowiedź od UTWORZENIA interakcji, nie od jej odebrania
// przez bota. Gdy połączenie gateway się zacina, zdarzenia przychodzą zlepkami po
// kilkunastu sekundach ciszy i token bywa martwy, zanim handler w ogóle wystartuje.
const INTERACTION_RESPONSE_WINDOW = 3000;

// Zapas na round-trip do API. Trzymany nisko celowo: potwierdzenie i tak idzie PRZED
// jakąkolwiek zmianą danych, więc nieudana próba nic nie kosztuje, a zbyt szeroki margines
// odrzucał interakcje, które jeszcze mieściły się w limicie (odmowa przy 2682 ms z 3000 ms).
const INTERACTION_SAFETY_MARGIN = 250;

/**
 * Ile milisekund minęło od utworzenia interakcji przez Discorda
 * @param {Interaction} interaction - Interakcja Discord
 * @returns {number} - Wiek interakcji w ms
 */
function interactionAge(interaction) {
    return Date.now() - interaction.createdTimestamp;
}

/**
 * Czy nie ma już sensu odpowiadać - token wygasł albo wygaśnie w trakcie requestu
 * @param {Interaction} interaction - Interakcja Discord
 * @returns {boolean}
 */
function isInteractionExpired(interaction) {
    return interactionAge(interaction) > INTERACTION_RESPONSE_WINDOW - INTERACTION_SAFETY_MARGIN;
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
    interactionAge,
    isInteractionExpired,
};
