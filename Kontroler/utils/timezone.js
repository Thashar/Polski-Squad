/**
 * Obsługa czasu polskiego (Europe/Warsaw) NIEZALEŻNIE od strefy czasowej serwera.
 *
 * Serwer produkcyjny może działać w UTC lub innej strefie - te funkcje zawsze liczą
 * względem Europe/Warsaw, z poprawną obsługą czasu letniego/zimowego (DST) przez Intl.
 *
 * - polandWallClockToUTC(): zegar ścienny w Polsce → poprawny moment UTC (Date)
 * - getPolandParts(): komponenty (rok/miesiąc/dzień/godzina/minuta) "teraz" w Polsce
 * - formatPoland*(): formatowanie do wyświetlenia w polskim czasie
 */

const POLAND_TZ = 'Europe/Warsaw';

/**
 * Zwraca przesunięcie strefy Europe/Warsaw względem UTC (w ms) dla danego momentu.
 * Dodatnie = Polska jest przed UTC (UTC+1 zimą = 3600000, UTC+2 latem = 7200000).
 */
function getWarsawOffsetMs(date) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: POLAND_TZ,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const m = {};
    for (const p of dtf.formatToParts(date)) {
        if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
    }
    // Zegar ścienny w Warszawie potraktowany jakby był UTC, minus rzeczywisty moment UTC
    const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
    return asUTC - date.getTime();
}

/**
 * Konwertuje polski zegar ścienny (rok, miesiąc 1-12, dzień, godzina, minuta) na
 * poprawny moment w UTC (obiekt Date). Poprawnie obsługuje DST na dowolnym serwerze.
 */
function polandWallClockToUTC(year, month, day, hour = 0, minute = 0, second = 0) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    // Pierwsze przybliżenie offsetu
    let offset = getWarsawOffsetMs(new Date(guess));
    let utc = guess - offset;
    // Korekta (poprawne przejścia DST)
    offset = getWarsawOffsetMs(new Date(utc));
    utc = guess - offset;
    return new Date(utc);
}

/**
 * Zwraca komponenty czasu polskiego dla danego momentu (domyślnie "teraz").
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number}}
 */
function getPolandParts(date = new Date()) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: POLAND_TZ,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const m = {};
    for (const p of dtf.formatToParts(date)) {
        if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
    }
    return { year: m.year, month: m.month, day: m.day, hour: m.hour, minute: m.minute, second: m.second };
}

/** Pełna data i czas w polskim formacie (np. "15.01.2025, 20:00:00"). */
function formatPolandDateTime(date) {
    return new Date(date).toLocaleString('pl-PL', { timeZone: POLAND_TZ });
}

/** Sama data w polskim formacie (np. "15.01.2025"). */
function formatPolandDate(date) {
    return new Date(date).toLocaleDateString('pl-PL', { timeZone: POLAND_TZ });
}

/** Sama godzina w polskim formacie (np. "20:00"). */
function formatPolandTime(date) {
    return new Date(date).toLocaleTimeString('pl-PL', { timeZone: POLAND_TZ, hour: '2-digit', minute: '2-digit' });
}

module.exports = {
    POLAND_TZ,
    getWarsawOffsetMs,
    polandWallClockToUTC,
    getPolandParts,
    formatPolandDateTime,
    formatPolandDate,
    formatPolandTime
};
