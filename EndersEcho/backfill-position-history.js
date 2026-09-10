'use strict';

/**
 * JEDNORAZOWE odtworzenie historii pozycji w rankingu globalnym.
 *
 * PO CO TO JEST
 * -------------
 * `globalPositionHistoryService` zapisuje pozycje dopiero od chwili swojego wdrożenia —
 * wcześniej nikt ich nie zapisywał. Przy pierwszym `sync()` każdy gracz dostaje więc
 * `since = teraz`, przez co raport TOP 10 pokazuje wszystkim „na tej pozycji" czas liczony
 * od restartu bota, a nie od faktycznej zmiany pozycji. Ten skrypt liczy te wartości
 * WSTECZ, z danych, które bot ma na dysku od dawna: historii wyników (`wyniki/*.json`).
 *
 * JAK LICZY
 * ---------
 * 1. Buduje aktualny ranking globalny z `ranking.json` wszystkich serwerów (dedup po
 *    playerKey, najlepszy wynik, sortowanie `compareByScoreThenTimestamp` — dokładnie jak
 *    `rankingService.getGlobalRanking`).
 * 2. Zbiera oś czasu wszystkich pobitych rekordów tych graczy z `wyniki/{playerKey}.json`
 *    ze WSZYSTKICH serwerów.
 * 3. Odtwarza ranking po kolei, wpis po wpisie: po każdym rekordzie przelicza kolejność
 *    i zapisuje, kto na jakiej pozycji stał i od kiedy.
 * 4. Z przebiegu wyciąga dla każdego gracza: `since` (od kiedy trzyma OBECNĄ pozycję),
 *    `best` + `bestAt` (najwyższa pozycja i kiedy pierwszy raz osiągnięta) oraz `top1Ms`
 *    (łączny czas na miejscu #1).
 *
 * CZEGO NIE DA SIĘ ODTWORZYĆ — i dlaczego wynik jest przybliżeniem
 * ---------------------------------------------------------------
 *  • Gracze USUNIĘCI z rankingu nie biorą udziału w odtwarzaniu, choć kiedyś zajmowali
 *    pozycje. Historyczne pozycje pozostałych mogą więc być zaniżone (byli „wyżej", niż
 *    naprawdę byli). Włączenie ich zepsułoby coś gorszego: końcowa kolejność nie zgadzałaby
 *    się z realnym rankingiem.
 *  • Wpisy historii z wynikiem WYŻSZYM niż aktualny rekord gracza są pomijane — rekordy
 *    tylko rosną, więc taki wpis to ślad po cofniętym wyniku i nigdy legalnie nie stał.
 *  • Gracz bez ani jednego wpisu historii dostaje jeden zastępczy „rekord" z danych
 *    rankingu (wynik + data), bo tyle o nim wiadomo.
 *  • Dokładność `top1Ms` zależy od gęstości rekordów. Odcinek między dwoma rekordami jest
 *    liczony w całości, więc czas na #1 jest dokładny co do momentu kolejnej zmiany rankingu.
 *
 * URUCHOMIENIE (na serwerze produkcyjnym, przy ZATRZYMANYM bocie)
 * ---------------------------------------------------------------
 *   node EndersEcho/backfill-position-history.js          → PODGLĄD, nic nie zapisuje
 *   node EndersEcho/backfill-position-history.js --fix    → zapis do global_position_history.json
 *
 * ⚠️ Bot musi być ZATRZYMANY. Trzyma plik w pamięci (`utils/jsonStore`) i przy najbliższym
 * zapisie nadpisałby go swoją starszą wersją, kasując efekt tego skryptu.
 *
 * Przed zapisem powstaje kopia `global_position_history.json.bak-{timestamp}`.
 * Skrypt SCALA wynik z istniejącym plikiem: `username` i `guildId` zostają, a wpisy graczy
 * spoza aktualnego rankingu nie są ruszane.
 */

const fs   = require('fs');
const path = require('path');
const { compareByScoreThenTimestamp, getProfileIndex } = require('./utils/helpers');

const DATA_DIR   = path.join(__dirname, 'data');
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');
const OUT_FILE   = path.join(DATA_DIR, 'global_position_history.json');

const APPLY = process.argv.includes('--fix');

// ── odczyt ────────────────────────────────────────────────────────────────────

function readJson(filePath, fallback) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return fallback; }
}

/** Katalogi serwerów: data/guilds/{guildId}/ */
function guildIds() {
    if (!fs.existsSync(GUILDS_DIR)) return [];
    return fs.readdirSync(GUILDS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
}

/**
 * Aktualny ranking globalny — ta sama logika co `rankingService.getGlobalRanking()`:
 * dedup po playerKey (nie po userId), najlepszy wynik ze wszystkich serwerów.
 * @returns {Array<{playerKey, scoreValue, timestamp, username, sourceGuildId}>}
 */
function buildGlobalRanking() {
    const best = new Map();

    for (const gid of guildIds()) {
        const ranking = readJson(path.join(GUILDS_DIR, gid, 'ranking.json'), null);
        if (!ranking || typeof ranking !== 'object') continue;

        for (const [playerKey, data] of Object.entries(ranking)) {
            const scoreValue = Number(data?.scoreValue);
            if (!Number.isFinite(scoreValue)) continue;
            const existing = best.get(playerKey);
            if (!existing || scoreValue > existing.scoreValue) {
                best.set(playerKey, {
                    playerKey,
                    scoreValue,
                    timestamp: data.timestamp || null,
                    username: data.username || null,
                    sourceGuildId: gid,
                });
            }
        }
    }

    return Array.from(best.values()).sort(compareByScoreThenTimestamp);
}

/**
 * Historia wyników gracza ze WSZYSTKICH serwerów, scalona chronologicznie.
 * Wpisy z wynikiem wyższym niż aktualny rekord są odrzucane (ślad po cofniętym wyniku).
 * @returns {Array<{t: number, v: number}>}
 */
function historyFor(playerKey, currentScoreValue) {
    const out = [];

    for (const gid of guildIds()) {
        const file = path.join(GUILDS_DIR, gid, 'wyniki', `${playerKey}.json`);
        const entries = readJson(file, null);
        if (!Array.isArray(entries)) continue;

        for (const e of entries) {
            const v = Number(e?.scoreValue);
            const t = e?.timestamp ? new Date(e.timestamp).getTime() : NaN;
            if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
            if (v > currentScoreValue) continue; // wynik cofnięty — nigdy legalnie nie stał
            out.push({ t, v });
        }
    }

    return out.sort((a, b) => a.t - b.t);
}

// ── odtwarzanie ───────────────────────────────────────────────────────────────

/**
 * Przechodzi oś czasu rekordów i zwraca dla każdego gracza pełną listę odcinków
 * `{ position, from, to }`, gdzie `to` ostatniego odcinka to `now`.
 */
function replay(ranking, now) {
    // Zdarzenia: każdy pobity rekord to zmiana wartości jednego gracza
    const events = [];
    const seeded = new Map(); // playerKey → czy ma jakąkolwiek historię

    for (const p of ranking) {
        const hist = historyFor(p.playerKey, p.scoreValue);
        if (hist.length === 0) {
            // Brak historii — jeden zastępczy rekord z danych rankingu
            const t = p.timestamp ? new Date(p.timestamp).getTime() : now;
            events.push({ t: Number.isFinite(t) ? t : now, key: p.playerKey, v: p.scoreValue });
            seeded.set(p.playerKey, false);
            continue;
        }
        for (const h of hist) events.push({ t: h.t, key: p.playerKey, v: h.v });
        seeded.set(p.playerKey, true);

        // Rekord z rankingu bywa nowszy niż ostatni wpis historii (zapis admina,
        // migracja cross-server). Domykamy oś czasu, żeby końcowa kolejność
        // odtworzenia zgadzała się z realnym rankingiem.
        const last = hist[hist.length - 1];
        if (last.v < p.scoreValue) {
            const t = p.timestamp ? new Date(p.timestamp).getTime() : now;
            events.push({ t: Number.isFinite(t) ? t : now, key: p.playerKey, v: p.scoreValue });
        }
    }

    events.sort((a, b) => a.t - b.t);

    const state    = new Map(); // playerKey → { scoreValue, timestamp }
    const segments = new Map(); // playerKey → [{ position, from }]
    ranking.forEach(p => segments.set(p.playerKey, []));

    const flush = (atTime) => {
        const live = Array.from(state.entries())
            .map(([playerKey, s]) => ({ playerKey, scoreValue: s.scoreValue, timestamp: s.timestamp }))
            .sort(compareByScoreThenTimestamp);

        live.forEach((entry, idx) => {
            const position = idx + 1;
            const segs = segments.get(entry.playerKey);
            const lastSeg = segs[segs.length - 1];
            if (!lastSeg || lastSeg.position !== position) {
                segs.push({ position, from: atTime });
            }
        });
    };

    // Zdarzenia o identycznym znaczniku czasu przeliczamy RAZ, po ostatnim z nich —
    // inaczej dwa rekordy z tej samej sekundy tworzyłyby odcinek o zerowej długości
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const prev = state.get(ev.key);
        // Rekordy tylko rosną; wpis nie wyższy od dotychczasowego niczego nie zmienia
        if (!prev || ev.v > prev.scoreValue) {
            state.set(ev.key, { scoreValue: ev.v, timestamp: new Date(ev.t).toISOString() });
        }
        if (i + 1 < events.length && events[i + 1].t === ev.t) continue;
        flush(ev.t);
    }

    return { segments, seeded, eventCount: events.length };
}

/** Z odcinków wyciąga to, co trzyma serwis: since / best / bestAt / top1Ms. */
function summarize(segs, now) {
    if (!segs || segs.length === 0) return null;

    const last = segs[segs.length - 1];
    let best = Infinity;
    let bestAt = null;
    let top1Ms = 0;

    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const to  = i + 1 < segs.length ? segs[i + 1].from : now;
        if (seg.position < best) {
            best = seg.position;
            bestAt = seg.from;
        }
        if (seg.position === 1) top1Ms += Math.max(0, to - seg.from);
    }

    return {
        position: last.position,
        since:    new Date(last.from).toISOString(),
        best:     Number.isFinite(best) ? best : last.position,
        bestAt:   new Date(bestAt ?? last.from).toISOString(),
        top1Ms,
    };
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 60000) return '<1m';
    const totalMinutes = Math.floor(ms / 60000);
    const days    = Math.floor(totalMinutes / 1440);
    const hours   = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`❌ Brak katalogu danych: ${DATA_DIR}`);
        console.error('   Uruchom skrypt na serwerze, na którym działa bot.');
        process.exit(1);
    }

    const now = Date.now();
    const ranking = buildGlobalRanking();

    if (ranking.length === 0) {
        console.error('❌ Ranking globalny jest pusty — nie ma czego odtwarzać.');
        process.exit(1);
    }

    console.log(`📊 Ranking globalny: ${ranking.length} profili z ${guildIds().length} serwerów`);

    const { segments, seeded, eventCount } = replay(ranking, now);
    console.log(`🕓 Oś czasu: ${eventCount} pobitych rekordów`);

    const bezHistorii = Array.from(seeded.values()).filter(v => v === false).length;
    if (bezHistorii > 0) {
        console.log(`⚠️  ${bezHistorii} profili bez historii wyników — dla nich czas liczony od daty rekordu z rankingu`);
    }

    // Kontrola spójności: końcowa kolejność odtworzenia MUSI zgadzać się z rankingiem
    let rozjazd = 0;
    const wynik = {};
    ranking.forEach((p, idx) => {
        const realPosition = idx + 1;
        const sum = summarize(segments.get(p.playerKey), now);
        if (!sum) return;
        if (sum.position !== realPosition) {
            rozjazd++;
            // Ranking jest źródłem prawdy — pozycję nadpisujemy, resztę zostawiamy
            sum.position = realPosition;
        }
        wynik[p.playerKey] = sum;
    });

    if (rozjazd > 0) {
        console.log(`⚠️  ${rozjazd} profili miało inną pozycję w odtworzeniu niż w rankingu — pozycję wzięto z rankingu`);
    }

    // Podgląd: TOP 10, czyli to, co widać w raporcie
    console.log('\n── TOP 10 — odtworzone czasy ────────────────────────────────');
    ranking.slice(0, 10).forEach((p, idx) => {
        const s = wynik[p.playerKey];
        const position = String(idx + 1).padStart(2, '0');
        const marker = getProfileIndex(p.playerKey) > 1 ? ` (profil ${getProfileIndex(p.playerKey)})` : '';
        const nick = (p.username || p.playerKey) + marker;
        if (!s) {
            console.log(`${position}. ${nick} — brak danych`);
            return;
        }
        const top1 = s.top1Ms > 0 ? `, na #1 łącznie ${formatDuration(s.top1Ms)}` : '';
        console.log(
            `${position}. ${nick.padEnd(28)} na tej pozycji ${formatDuration(now - Date.parse(s.since)).padEnd(9)}` +
            ` (od ${s.since.slice(0, 10)}), najwyżej #${s.best}${top1}`
        );
    });
    console.log('─────────────────────────────────────────────────────────────\n');

    if (!APPLY) {
        console.log('ℹ️  PODGLĄD — nic nie zapisano. Uruchom z --fix, żeby zapisać:');
        console.log('   node EndersEcho/backfill-position-history.js --fix');
        return;
    }

    // Scalenie z istniejącym plikiem: username/guildId zostają, gracze spoza rankingu nietknięci
    const existing = readJson(OUT_FILE, null);
    const merged = (existing && typeof existing === 'object' && existing.players)
        ? existing
        : { players: {} };

    for (const p of ranking) {
        const s = wynik[p.playerKey];
        if (!s) continue;
        const prev = merged.players[p.playerKey] || {};
        merged.players[p.playerKey] = {
            ...prev,
            position: s.position,
            since:    s.since,
            best:     s.best,
            bestAt:   s.bestAt,
            top1Ms:   s.top1Ms,
            username: p.username || prev.username || null,
            guildId:  p.sourceGuildId || prev.guildId || null,
        };
    }
    merged.updatedAt = new Date(now).toISOString();

    if (fs.existsSync(OUT_FILE)) {
        const backup = `${OUT_FILE}.bak-${now}`;
        fs.copyFileSync(OUT_FILE, backup);
        console.log(`💾 Kopia poprzedniego stanu: ${path.basename(backup)}`);
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`✅ Zapisano ${Object.keys(wynik).length} profili do ${path.basename(OUT_FILE)}`);
    console.log('   Uruchom bota — raport TOP 10 pokaże teraz odtworzone czasy.');
}

main();
