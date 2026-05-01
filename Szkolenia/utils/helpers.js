/**
 * Funkcje pomocnicze dla bota Szkolenia.
 */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function daysToMilliseconds(days) {
    return days * 24 * 60 * 60 * 1000;
}

module.exports = {
    delay,
    daysToMilliseconds,
};
