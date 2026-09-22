/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TREND GRACZA — JEDNO ŹRÓDŁO PRAWDY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trend odpowiada na pytanie: czy gracz zdobywa punkty SZYBCIEJ czy WOLNIEJ
 * niż przez ostatni kwartał. Mierzymy to TEMPEM (punkty na tydzień) w dwóch
 * oknach i porównujemy je miarą symetryczną.
 *
 * ─── DLACZEGO NIE ILORAZ DWÓCH PRZYROSTÓW ─────────────────────────────────
 * Wcześniej każde z pięciu miejsc liczyło trend po swojemu, a `/player-status`
 * i `/player-raport` używały ODWRÓCONYCH względem siebie ułamków — ten sam
 * gracz bywał „Gwałtownie rosnący" w jednej komendzie i „Gwałtownie malejący"
 * w drugiej. Poza samym odwróceniem iloraz `progress4`/`progress12` miał cztery
 * wady, których nie dało się naprawić kierunkiem dzielenia:
 *
 *   1. Dzielenie przez progres ostatnich 4 tygodni — gdy wynosił 1 punkt,
 *      wynik eksplodował i trzeba go było obcinać do 2.0. Wartość mówiła
 *      wtedy więcej o clampie niż o graczu.
 *   2. `progress4 <= 0` dawało ratio 0, czyli „stoję od pół roku" i „zwolniłem
 *      po świetnym kwartale" trafiały do jednej kategorii.
 *   3. Liczone z DWÓCH skrajnych punktów okna — jeden słabszy tydzień na brzegu
 *      przewracał cały wynik.
 *   4. Indeks wpisu traktowany jak tydzień kalendarzowy: `score[i-4]` to „4 wpisy
 *      wstecz", więc gracz z dwutygodniową przerwą porównywał się z wynikiem
 *      sprzed 6 tygodni.
 *
 * ─── JAK LICZYMY TERAZ ────────────────────────────────────────────────────
 *   tempo = nachylenie regresji liniowej po WSZYSTKICH punktach w oknie [pkt/tydz.]
 *   trendScore = (tempoOstatnie - tempoBazowe) / (|tempoOstatnie| + |tempoBazowe|)
 *
 * `trendScore` mieści się zawsze w -1…+1, nie wymaga clampu i jest symetryczny:
 * przyspieszenie dwukrotne daje +0.33, zwolnienie dwukrotne -0.33. Mianownik
 * zeruje się wyłącznie przy obu tempach równych zero, co obsługuje osobna
 * kategoria STAGNACJA.
 *
 * Okna są KALENDARZOWE (tygodnie ISO), nie „ostatnie N wpisów", więc przerwa
 * w grze nie udaje ciągłej historii.
 */

const OKNO_KROTKIE_TYGODNI = 4;
const OKNO_DLUGIE_TYGODNI = 12;
const MIN_PUNKTOW_KROTKIE = 3;
const MIN_PUNKTOW_DLUGIE = 6;

/** Czwartek tygodnia ISO — jednoznaczny punkt na osi czasu dla pary (rok, tydzień). */
function czwartekTygodniaISO(rok, tydzien) {
    // 4 stycznia zawsze należy do 1. tygodnia ISO
    const d = new Date(Date.UTC(rok, 0, 4));
    const dzienTygodnia = (d.getUTCDay() + 6) % 7; // 0 = poniedziałek
    d.setUTCDate(d.getUTCDate() - dzienTygodnia + 3 + (tydzien - 1) * 7);
    return d;
}

/**
 * Nachylenie prostej regresji (metoda najmniejszych kwadratów).
 * @param {{x: number, y: number}[]} punkty x = numer tygodnia, y = wynik
 * @returns {number|null} punkty na tydzień albo null, gdy nie da się policzyć
 */
function nachylenieRegresji(punkty) {
    const n = punkty.length;
    if (n < 2) return null;

    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of punkty) {
        sx += p.x;
        sy += p.y;
        sxy += p.x * p.y;
        sxx += p.x * p.x;
    }

    const mianownik = n * sxx - sx * sx;
    // Zero oznacza, że wszystkie punkty są z tego samego tygodnia — brak osi czasu
    if (mianownik === 0) return null;

    return (n * sxy - sx * sy) / mianownik;
}

/**
 * Przygotowuje punkty do regresji: filtruje puste wyniki, sortuje chronologicznie
 * i nadaje każdemu wpisowi numer tygodnia liczony od NAJSTARSZEGO punktu.
 *
 * @param {{weekNumber: number, year: number, score: number}[]} dane w dowolnej kolejności
 */
function przygotujPunkty(dane) {
    if (!Array.isArray(dane)) return [];

    return dane
        .filter(d => d && typeof d.score === 'number' && d.score > 0 && d.weekNumber && d.year)
        .map(d => ({ ...d, _czas: czwartekTygodniaISO(d.year, d.weekNumber).getTime() }))
        .sort((a, b) => a._czas - b._czas)
        .map((d, _i, tablica) => ({
            x: Math.round((d._czas - tablica[0]._czas) / (7 * 24 * 60 * 60 * 1000)),
            y: d.score,
            weekNumber: d.weekNumber,
            year: d.year
        }));
}

/** Punkty z ostatnich `tygodni` tygodni KALENDARZOWYCH (licząc od najnowszego wpisu). */
function oknoKalendarzowe(punkty, tygodni) {
    if (punkty.length === 0) return [];
    const najnowszy = punkty[punkty.length - 1].x;
    return punkty.filter(p => p.x >= najnowszy - tygodni);
}

/** Opis słowny i ikona dla policzonego `trendScore`. */
function opiszTrend(trendScore, tempoOstatnie, tempoBazowe) {
    // Brak progresu w OBU oknach — to nie jest „stabilność", tylko stanie w miejscu
    // (albo cofanie się). Iloraz nie potrafił tego odróżnić od równego tempa
    if (tempoOstatnie <= 0 && tempoBazowe <= 0) {
        return { opis: 'Stagnacja', ikona: '💤', stagnacja: true };
    }

    if (trendScore >= 0.33)  return { opis: 'Gwałtownie rosnący',  ikona: '🚀', stagnacja: false };
    if (trendScore >= 0.10)  return { opis: 'Rosnący',             ikona: '↗️', stagnacja: false };
    if (trendScore > -0.10)  return { opis: 'Stabilny',            ikona: '⚖️', stagnacja: false };
    if (trendScore > -0.33)  return { opis: 'Malejący',            ikona: '↘️', stagnacja: false };
    return { opis: 'Gwałtownie malejący', ikona: '🪦', stagnacja: false };
}

/**
 * Liczy trend gracza.
 *
 * @param {{weekNumber: number, year: number, score: number}[]} dane historia gracza
 *        (kolejność dowolna — funkcja sortuje sama)
 * @returns {null|{
 *   trendScore: number, tempoOstatnie: number, tempoBazowe: number,
 *   procentZmiany: number|null, opis: string, ikona: string, stagnacja: boolean
 * }} null, gdy danych jest za mało na rzetelny wynik
 */
function obliczTrend(dane) {
    const punkty = przygotujPunkty(dane);
    if (punkty.length < MIN_PUNKTOW_DLUGIE) return null;

    const oknoKrotkie = oknoKalendarzowe(punkty, OKNO_KROTKIE_TYGODNI);
    const oknoDlugie = oknoKalendarzowe(punkty, OKNO_DLUGIE_TYGODNI);

    if (oknoKrotkie.length < MIN_PUNKTOW_KROTKIE) return null;
    if (oknoDlugie.length < MIN_PUNKTOW_DLUGIE) return null;

    const tempoOstatnie = nachylenieRegresji(oknoKrotkie);
    const tempoBazowe = nachylenieRegresji(oknoDlugie);
    if (tempoOstatnie === null || tempoBazowe === null) return null;

    const mianownik = Math.abs(tempoOstatnie) + Math.abs(tempoBazowe);
    const trendScore = mianownik === 0 ? 0 : (tempoOstatnie - tempoBazowe) / mianownik;

    // Procent pokazujemy tylko wtedy, gdy jest od czego liczyć — przy zerowym
    // lub ujemnym tempie bazowym „+300%" byłoby mylące
    const procentZmiany = tempoBazowe > 0
        ? (tempoOstatnie / tempoBazowe - 1) * 100
        : null;

    const { opis, ikona, stagnacja } = opiszTrend(trendScore, tempoOstatnie, tempoBazowe);

    return { trendScore, tempoOstatnie, tempoBazowe, procentZmiany, opis, ikona, stagnacja };
}

/**
 * Rolling trend dla wykresu: `trendScore` policzony na każdy tydzień, w którym
 * historia sięgała wystarczająco wstecz. Zwraca punkty od najstarszego.
 *
 * @returns {{trendScore: number, weekNumber: number, year: number}[]}
 */
function obliczTrendRolling(dane) {
    const punkty = przygotujPunkty(dane);
    if (punkty.length < MIN_PUNKTOW_DLUGIE) return [];

    const wynik = [];
    for (let i = 0; i < punkty.length; i++) {
        // Historia do i-tego punktu włącznie — tak, jakby to był „dziś"
        const historia = punkty.slice(0, i + 1).map(p => ({
            weekNumber: p.weekNumber,
            year: p.year,
            score: p.y
        }));

        const trend = obliczTrend(historia);
        if (trend) {
            wynik.push({
                trendScore: trend.trendScore,
                weekNumber: punkty[i].weekNumber,
                year: punkty[i].year
            });
        }
    }
    return wynik;
}

/** Jednolity opis tempa do embedów, np. „**+38 pkt/tydz.** · kwartał: **+25 pkt/tydz.** (+52%)". */
function formatujTempo(trend) {
    if (!trend) return null;

    const fmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} pkt/tydz.`;
    let tekst = `Ostatnie ${OKNO_KROTKIE_TYGODNI} tyg.: **${fmt(trend.tempoOstatnie)}** · kwartał: **${fmt(trend.tempoBazowe)}**`;

    if (trend.procentZmiany !== null) {
        const p = trend.procentZmiany;
        tekst += ` (${p >= 0 ? '+' : ''}${p.toFixed(0)}%)`;
    }
    return tekst;
}

module.exports = {
    obliczTrend,
    obliczTrendRolling,
    formatujTempo,
    OKNO_KROTKIE_TYGODNI,
    OKNO_DLUGIE_TYGODNI
};
