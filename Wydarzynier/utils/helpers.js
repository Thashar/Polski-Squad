/**
 * Funkcje pomocnicze dla bota Wydarzynier.
 */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    delay,
};
