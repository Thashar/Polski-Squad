/**
 * Wspólny matcher nicków: dopasowanie nicków odczytanych przez AI do nicków roli klanowej.
 *
 * Założenie domenowe: każdy gracz na screenie ma rolę klanową, więc każdy odczytany nick
 * odpowiada dokładnie jednemu członkowi klanu. Rozwiązywane jako problem przydziału 1:1
 * (każdy klanowicz użyty maks. raz w obrębie partii), minimalizacja łącznej odległości
 * edycyjnej, algorytm zachłanny po globalnym minimum (dokładne trafienia kotwiczą resztę).
 *
 * Odległość liczona na GRAFEMACH (emoji = 1 znak) po normalizacji
 * (NFKD + usunięcie diakrytyków + lowercase).
 *
 * Używane przez phaseService (faza1/faza2) oraz reminderService/punishmentService.
 */

/**
 * Dzieli string na grafemy (emoji liczone jako 1 znak).
 * Używa Intl.Segmenter gdy dostępny, w przeciwnym razie fallback po punktach kodowych.
 */
function splitGraphemes(str) {
    const s = str || '';
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try {
            const seg = new Intl.Segmenter('pl', { granularity: 'grapheme' });
            return Array.from(seg.segment(s), x => x.segment);
        } catch (_) { /* fallback poniżej */ }
    }
    return Array.from(s);
}

/**
 * Normalizacja do porównań: NFKD + usunięcie znaków diakrytycznych (ę→e, ó→o, ...) +
 * lowercase, podzielona na grafemy (emoji = 1 znak).
 */
function normForMatch(str) {
    const norm = (str || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return splitGraphemes(norm);
}

/**
 * Odległość Levenshteina na tablicach grafemów (emoji = 1 znak).
 */
function graphemeLevenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[n];
}

/**
 * Przydział 1:1 nicków odczytanych przez AI do nicków klanu.
 * Zwraca nową listę graczy z podmienionym `playerName` na kanoniczny nick Discord
 * (gdy znaleziono wolnego klanowicza). Zachowuje pozostałe pola (np. score).
 * Pre-dedup identycznych nicków AI (zostaje wpis z wyższym wynikiem).
 *
 * @param {Array<{playerName: string, score?: number}>} players
 * @param {string[]} clanNicks
 * @returns {Array<{playerName: string, score?: number}>}
 * @param {object} [logger] - opcjonalny logger do logowania dopasowań
 */
function assignNicksToClan(players, clanNicks, logger = null) {
    if (!Array.isArray(players) || players.length === 0) return players || [];
    if (!Array.isArray(clanNicks) || clanNicks.length === 0) return players;

    // Pre-dedup identycznych nicków AI w obrębie partii (zostaw wyższy wynik)
    const uniq = new Map();
    for (const p of players) {
        const key = p.playerName || '';
        const ex = uniq.get(key);
        if (!ex || (p.score || 0) > (ex.score || 0)) uniq.set(key, p);
    }
    const detected = Array.from(uniq.values());

    const detG = detected.map(p => normForMatch(p.playerName));
    const clanG = clanNicks.map(n => normForMatch(n));

    // Zbuduj wszystkie pary (detected i, clan j) z odległością edycyjną
    const pairs = [];
    for (let i = 0; i < detected.length; i++) {
        for (let j = 0; j < clanNicks.length; j++) {
            pairs.push({ i, j, dist: graphemeLevenshtein(detG[i], clanG[j]) });
        }
    }
    // Najpierw najmniejsze odległości - dokładne trafienia (dist 0) blokują swoich klanowiczów
    pairs.sort((a, b) => a.dist - b.dist);

    const assignedClan = new Array(detected.length).fill(-1);
    const usedDet = new Set();
    const usedClan = new Set();
    for (const { i, j } of pairs) {
        if (usedDet.has(i) || usedClan.has(j)) continue;
        assignedClan[i] = j;
        usedDet.add(i);
        usedClan.add(j);
        if (usedDet.size === detected.length) break;
    }

    return detected.map((p, i) => {
        const j = assignedClan[i];
        if (j === -1) return p; // więcej odczytów niż klanowiczów - zostaw nick AI
        const canonical = clanNicks[j];
        if (logger && canonical !== p.playerName) {
            logger.info(`[NICK-MATCH] 🔗 Nick AI "${p.playerName}" → Discord "${canonical}"`);
        }
        return { ...p, playerName: canonical };
    });
}

module.exports = {
    splitGraphemes,
    normForMatch,
    graphemeLevenshtein,
    assignNicksToClan
};
