/**
 * Funkcje pomocnicze dla bota Wydarzynier.
 */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
};
