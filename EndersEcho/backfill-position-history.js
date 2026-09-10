'use strict';

/**
 * Odtworzenie historii pozycji w rankingu globalnym — JEDNORAZOWO, automatycznie przy starcie.
 *
 * PO CO TO JEST
 * -------------
 * `globalPositionHistoryService` zapisuje pozycje dopiero od chwili swojego wdrożenia —
 * wcześniej nikt ich nie zapisywał. Przy pierwszym `sync()` każdy gracz dostaje więc
 * `since = teraz`, przez co raport TOP 10 pokazuje wszystkim „na tej pozycji" czas liczony
 * od restartu bota, a nie od faktycznej zmiany pozycji. Ten moduł liczy te wartości WSTECZ,
 * z danych, które bot ma na dysku od dawna: historii wyników (`wyniki/*.json`).
 *
 * ⚠️ URUCHAMIA SIĘ DOKŁADNIE RAZ — I TO JEST KLUCZOWE
 * ---------------------------------------------------
 * Po zapisie w pliku ląduje znacznik `backfilledAt` i każdy kolejny start bota widzi go
 * i odpuszcza. Bez tego bezpiecznika każdy restart nadpisywałby PRAWDZIWE, narastające
 * `since` wartościami odtworzonymi — czyli kasowałby dokładnie te dane, dla których cały
 * ten mechanizm powstał. Nie usuwaj tego warunku i nie „odświeżaj" backfillu cyklicznie.
 *
 * Ponowne wymuszenie (świadome, po wyczyszczeniu danych) = skasowanie `backfilledAt`
 * z `data/global_position_history.json` albo uruchomienie z konsoli z `--fix`.
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
 * GDZIE JEST WOŁANY
 * -----------------
 * `EndersEcho/index.js` → `initializeBot()`, PRZED `globalPositionHistoryService.load()`.
 * Kolejność jest istotna: serwis musi wczytać już odtworzony plik, inaczej jego `sync()`
 * zapisałby `since = teraz` i backfill nie miałby czego poprawiać.
 *
 * Zapis idzie przez `utils/jsonStore`, więc plik i pamięć podręczna są zgodne od razu —
 * zapis „na boku" przez `fs` zostałby nadpisany przy pierwszym zapisie serwisu.
 *
 * URUCHOMIENIE RĘCZNE (opcjonalne, przy ZATRZYMANYM bocie)
 * -------------------------------------------------------
 *   node EndersEcho/backfill-position-history.js          → PODGLĄD, nic nie zapisuje
 *   node EndersEcho/backfill-position-history.js --fix    → zapis, także gdy backfill już był
 */

const fs   = require('fs');
const path = require('path');
const { compareByScoreThenTimestamp, getProfileIndex } = require('./utils/helpers');
const GlobalPositionHistoryService = require('./services/globalPositionHistoryService');
const store = require('../utils/jsonStore');

// Data graniczna licznika czasu na #1 — JEDNO źródło prawdy, wspólne z serwisem.
// Gdyby backfill miał własną kopię tej daty, odtworzone wartości rozjechałyby się
// z tym, co serwis dolicza na bieżąco.
const { policzOdcinekTop1 } = GlobalPositionHistoryService;

/**
 * Wersja algorytmu odtwarzania. Podniesienie tej liczby sprawia, że backfill wykona się
 * PONOWNIE (raz) na instalacjach, które przeszły już starszą wersję — inaczej zostałyby
 * z wartościami policzonymi według nieaktualnych reguł.
 *   1 → pierwsze wdrożenie
 *   2 → czas na #1 liczony dopiero od `TOP1_COUNT_FROM` (1 maja 2026)
 */
const BACKFILL_VERSION = 2;

const DATA_DIR   = path.join(__dirname, 'data');
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');
const OUT_FILE   = path.join(DATA_DIR, 'global_position_history.json');

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
 * `{ position, from }`; koniec ostatniego odcinka to `now`.
 */
function replay(ranking, now) {
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

/**
 * Z odcinków wyciąga to, co trzyma serwis: since / best / bestAt / top1Ms.
 *
 * ⚠️ `top1Ms` obejmuje wyłącznie odcinki ZAMKNIĘTE — dokładnie ta sama umowa co w serwisie.
 * `GlobalPositionHistoryService._top1Total()` dolicza trwający pobyt na #1 dopiero przy
 * odczycie (`position === 1` → plus `teraz - since`), a `sync()` domyka go dopiero przy
 * zejściu ze szczytu. Gdyby backfill zapisał tu również odcinek bieżący, lider miałby czas
 * na #1 policzony DWA RAZY — pole Hall of Fame pokazywałoby mu mniej więcej podwójny wynik.
 */
function summarize(segs) {
    if (!segs || segs.length === 0) return null;

    const last = segs[segs.length - 1];
    let best = Infinity;
    let bestAt = null;
    let top1Ms = 0;

    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const domkniety = i + 1 < segs.length;
        if (seg.position < best) {
            best = seg.position;
            bestAt = seg.from;
        }
        // Odcinek bieżący (ostatni) zostaje otwarty — dolicza go serwis przy odczycie.
        // Liczy się wyłącznie część odcinka PO dacie granicznej (patrz `TOP1_COUNT_FROM`).
        if (seg.position === 1 && domkniety) {
            top1Ms += policzOdcinekTop1(seg.from, segs[i + 1].from);
        }
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

// ── obliczenia + zapis ────────────────────────────────────────────────────────

/**
 * Liczy odtworzone wartości dla wszystkich profili z aktualnego rankingu.
 * Nic nie zapisuje.
 * @returns {{ranking: Array, wynik: Object, eventCount: number, bezHistorii: number, rozjazd: number}|null}
 */
function compute(now = Date.now()) {
    const ranking = buildGlobalRanking();
    if (ranking.length === 0) return null;

    const { segments, seeded, eventCount } = replay(ranking, now);

    let rozjazd = 0;
    const wynik = {};
    ranking.forEach((p, idx) => {
        const realPosition = idx + 1;
        const sum = summarize(segments.get(p.playerKey));
        if (!sum) return;
        if (sum.position !== realPosition) {
            rozjazd++;
            // Ranking jest źródłem prawdy — pozycję nadpisujemy, resztę zostawiamy
            sum.position = realPosition;
        }
        wynik[p.playerKey] = sum;
    });

    const bezHistorii = Array.from(seeded.values()).filter(v => v === false).length;
    return { ranking, wynik, eventCount, bezHistorii, rozjazd };
}

/**
 * Zapisuje odtworzone wartości. SCALA z istniejącym plikiem: `username`/`guildId` zostają,
 * a wpisy graczy spoza aktualnego rankingu nie są ruszane.
 *
 * Zapis idzie przez `jsonStore` (atomowo + aktualizacja pamięci podręcznej), żeby serwis
 * nie nadpisał efektu swoją starszą kopią z pamięci.
 */
async function apply({ ranking, wynik }, now = Date.now()) {
    const existing = await store.getOrLoad(OUT_FILE, () => ({ players: {} }));
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
    merged.updatedAt   = new Date(now).toISOString();
    // Znacznik jednorazowości — od tej chwili kolejne starty bota omijają backfill.
    // `backfillVersion` pozwala wymusić JEDNO ponowne przeliczenie po zmianie reguł.
    merged.backfilledAt    = new Date(now).toISOString();
    merged.backfillVersion = BACKFILL_VERSION;

    // Kopia poprzedniego stanu — gdyby odtworzenie okazało się gorsze niż to, co było
    if (fs.existsSync(OUT_FILE)) {
        try {
            fs.copyFileSync(OUT_FILE, `${OUT_FILE}.bak-${now}`);
        } catch { /* brak kopii nie może zablokować zapisu */ }
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    await store.set(OUT_FILE, merged);
    return Object.keys(wynik).length;
}

// ── wejście automatyczne (start bota) ─────────────────────────────────────────

/**
 * Wołane z `index.js` przy starcie, PRZED `globalPositionHistoryService.load()`.
 * Wykonuje się dokładnie raz w życiu instalacji — decyduje o tym `backfilledAt` w pliku.
 * Żaden błąd nie może zatrzymać startu bota: to poprawka statystyk, nie warunek działania.
 *
 * @param {Object} logger - logger bota (createBotLogger)
 * @returns {Promise<boolean>} czy backfill został wykonany w tym uruchomieniu
 */
async function runOnceAtStartup(logger) {
    try {
        if (!fs.existsSync(DATA_DIR)) return false;

        const existing = await store.getOrLoad(OUT_FILE, () => ({ players: {} }));
        // Pominięcie tylko wtedy, gdy odtworzenie przeszło JUŻ W BIEŻĄCEJ wersji algorytmu.
        // Wpis bez `backfillVersion` pochodzi z wersji 1 i wymaga jednego przeliczenia.
        const zrobionaWersja = existing?.backfilledAt ? (existing.backfillVersion || 1) : 0;
        if (zrobionaWersja >= BACKFILL_VERSION) return false; // cisza — to normalny stan

        const now = Date.now();
        const result = compute(now);

        if (!result) {
            // Pusty ranking (świeża instalacja) — nie ma czego odtwarzać, ale znacznik
            // stawiamy, żeby nie liczyć tego od nowa przy każdym starcie. Gracze, którzy
            // pojawią się później, i tak naliczą swój czas na bieżąco.
            await store.set(OUT_FILE, {
                players: existing?.players || {},
                updatedAt: new Date(now).toISOString(),
                backfilledAt: new Date(now).toISOString(),
                backfillVersion: BACKFILL_VERSION,
            });
            return false;
        }

        const zapisane = await apply(result, now);

        const top1 = result.ranking[0] ? result.wynik[result.ranking[0].playerKey] : null;
        const szczegoly = [
            `${zapisane} profili`,
            `${result.eventCount} rekordów w osi czasu`,
            result.bezHistorii ? `${result.bezHistorii} bez historii` : null,
            result.rozjazd ? `${result.rozjazd} z pozycją z rankingu` : null,
            top1 ? `lider na #1 od ${formatDuration(now - Date.parse(top1.since))}` : null,
        ].filter(Boolean).join(', ');

        const etykieta = zrobionaWersja > 0
            ? `przeliczono ponownie (v${zrobionaWersja} → v${BACKFILL_VERSION})`
            : 'jednorazowo';
        logger.info(`🕓 Odtworzono historię pozycji globalnych (${etykieta}): ${szczegoly}`);
        return true;
    } catch (err) {
        logger.warn(`⚠️ Nie udało się odtworzyć historii pozycji globalnych: ${err.message}`);
        return false;
    }
}

// ── wejście z konsoli ─────────────────────────────────────────────────────────

async function main() {
    const APPLY = process.argv.includes('--fix');

    if (!fs.existsSync(DATA_DIR)) {
        console.error(`❌ Brak katalogu danych: ${DATA_DIR}`);
        console.error('   Uruchom skrypt na serwerze, na którym działa bot.');
        process.exit(1);
    }

    const now = Date.now();
    const result = compute(now);

    if (!result) {
        console.error('❌ Ranking globalny jest pusty — nie ma czego odtwarzać.');
        process.exit(1);
    }

    console.log(`📊 Ranking globalny: ${result.ranking.length} profili z ${guildIds().length} serwerów`);
    console.log(`🕓 Oś czasu: ${result.eventCount} pobitych rekordów`);
    if (result.bezHistorii > 0) {
        console.log(`⚠️  ${result.bezHistorii} profili bez historii wyników — dla nich czas liczony od daty rekordu z rankingu`);
    }
    if (result.rozjazd > 0) {
        console.log(`⚠️  ${result.rozjazd} profili miało inną pozycję w odtworzeniu niż w rankingu — pozycję wzięto z rankingu`);
    }

    console.log('\n── TOP 10 — odtworzone czasy ────────────────────────────────');
    result.ranking.slice(0, 10).forEach((p, idx) => {
        const s = result.wynik[p.playerKey];
        const position = String(idx + 1).padStart(2, '0');
        const marker = getProfileIndex(p.playerKey) > 1 ? ` (profil ${getProfileIndex(p.playerKey)})` : '';
        const nick = (p.username || p.playerKey) + marker;
        if (!s) {
            console.log(`${position}. ${nick} — brak danych`);
            return;
        }
        // `top1Ms` trzyma tylko odcinki ZAMKNIĘTE, więc dla obecnego lidera trzeba doliczyć
        // trwającą passę — dokładnie tak, jak zrobi to serwis przy budowaniu Hall of Fame
        const top1Total = s.top1Ms + (s.position === 1 ? Math.max(0, now - Date.parse(s.since)) : 0);
        const top1 = top1Total > 0 ? `, na #1 łącznie ${formatDuration(top1Total)}` : '';
        console.log(
            `${position}. ${nick.padEnd(28)} na tej pozycji ${formatDuration(now - Date.parse(s.since)).padEnd(9)}` +
            ` (od ${s.since.slice(0, 10)}), najwyżej #${s.best}${top1}`
        );
    });
    console.log('─────────────────────────────────────────────────────────────\n');

    if (!APPLY) {
        console.log('ℹ️  PODGLĄD — nic nie zapisano.');
        console.log('   Backfill i tak wykona się SAM przy najbliższym starcie bota (raz).');
        console.log('   Wymuszenie teraz: node EndersEcho/backfill-position-history.js --fix');
        return;
    }

    const zapisane = await apply(result, now);
    await store.flush();
    console.log(`✅ Zapisano ${zapisane} profili do ${path.basename(OUT_FILE)}`);
    console.log('   Znacznik `backfilledAt` ustawiony — start bota nie powtórzy odtwarzania.');
}

/**
 * Wyjście z konsoli musi być JAWNE. `utils/consoleLogger` (wciągany przez `jsonStore`)
 * trzyma dobowy `setInterval` sprzątający stare logi oraz otwarty strumień pliku, więc
 * proces nigdy nie zakończyłby się sam i operator zostałby z wiszącym terminalem.
 * Kod bota tego nie dotyczy — tam moduł jest tylko importowany (`require.main !== module`).
 */
function zakonczKonsole(code) {
    process.exit(code);
}

module.exports = { runOnceAtStartup, compute, apply, formatDuration };

if (require.main === module) {
    main()
        .then(() => zakonczKonsole(0))
        .catch(err => {
            console.error(`❌ ${err.message}`);
            zakonczKonsole(1);
        });
}
