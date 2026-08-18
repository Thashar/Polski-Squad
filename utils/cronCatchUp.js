const path = require('path');
const cron = require('node-cron');

const store = require('./jsonStore');
const { createBotLogger } = require('./consoleLogger');

const domyslnyLogger = createBotLogger('Cron');

// Znacznik ostatniego wykonania każdego zadania — wspólny plik dla wszystkich botów
const PLIK_STANU = path.join(__dirname, '../shared_data/cron_last_run.json');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ZADANIA CYKLICZNE Z NADRABIANIEM PO PRZESTOJU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `node-cron` odpala zadanie WYŁĄCZNIE wtedy, gdy proces akurat działa. Gdy bot był
 * wyłączony o zaplanowanej godzinie (restart hostingu, deploy, pętla crashy), zadanie
 * po prostu nie wykonuje się w tym cyklu — bez wyjątku, bez wpisu w logu, bez żadnego
 * śladu. W praktyce znikały przez to m.in. poniedziałkowe czyszczenie punktów karnych
 * i codzienne wyłączanie przycisków potwierdzeń.
 *
 * Ten moduł zapamiętuje moment ostatniego wykonania każdego zadania i przy starcie
 * porównuje go z POPRZEDNIM zaplanowanym terminem. Jeśli termin wypadł w czasie
 * przestoju — zadanie leci od razu po uruchomieniu bota.
 *
 * ─── OBSŁUGIWANY KSZTAŁT WYRAŻENIA ────────────────────────────────────────
 * `<minuta> <godzina> * * <dzień tygodnia>`, gdzie minuta i godzina są liczbami,
 * a dzień tygodnia liczbą 0–6 albo `*`. Tyle wystarcza na wszystkie zadania w projekcie.
 * Inny kształt rzuca wyjątek przy rejestracji — lepiej głośny błąd przy starcie niż
 * ciche liczenie złych terminów.
 */

/** Komponenty daty w danej strefie czasowej. */
function czesciWStrefie(strefa, data) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: strefa,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        weekday: 'short'
    });

    const m = {};
    for (const p of dtf.formatToParts(data)) {
        if (p.type === 'weekday') m.weekday = p.value;
        else if (p.type !== 'literal') m[p.type] = parseInt(p.value, 10);
    }

    const dni = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { rok: m.year, miesiac: m.month, dzien: m.day, godzina: m.hour, minuta: m.minute, dzienTygodnia: dni[m.weekday] };
}

/**
 * Zegar ścienny w danej strefie → poprawny moment UTC.
 * Dwa przebiegi korekty załatwiają przejścia czasu letniego/zimowego.
 */
function zegarScienny(strefa, rok, miesiac, dzien, godzina, minuta) {
    const przyblizenie = Date.UTC(rok, miesiac - 1, dzien, godzina, minuta, 0);

    let utc = przyblizenie;
    for (let i = 0; i < 2; i++) {
        const cz = czesciWStrefie(strefa, new Date(utc));
        const jakoUTC = Date.UTC(cz.rok, cz.miesiac - 1, cz.dzien, cz.godzina, cz.minuta, 0);
        utc = przyblizenie - (jakoUTC - utc);
    }
    return new Date(utc);
}

/** Rozbiera wyrażenie crona na minutę, godzinę i dzień tygodnia. */
function rozbierzWyrazenie(wyrazenie) {
    const pola = String(wyrazenie).trim().split(/\s+/);
    if (pola.length !== 5) {
        throw new Error(`Nieobsługiwane wyrażenie cron "${wyrazenie}" — oczekiwano 5 pól`);
    }

    const [minuta, godzina, dzienMiesiaca, miesiac, dzienTygodnia] = pola;
    if (dzienMiesiaca !== '*' || miesiac !== '*') {
        throw new Error(`Nieobsługiwane wyrażenie cron "${wyrazenie}" — dzień miesiąca i miesiąc muszą być "*"`);
    }
    if (!/^\d+$/.test(minuta) || !/^\d+$/.test(godzina)) {
        throw new Error(`Nieobsługiwane wyrażenie cron "${wyrazenie}" — minuta i godzina muszą być liczbami`);
    }
    if (dzienTygodnia !== '*' && !/^[0-6]$/.test(dzienTygodnia)) {
        throw new Error(`Nieobsługiwane wyrażenie cron "${wyrazenie}" — dzień tygodnia musi być liczbą 0-6 albo "*"`);
    }

    return {
        minuta: parseInt(minuta, 10),
        godzina: parseInt(godzina, 10),
        dzienTygodnia: dzienTygodnia === '*' ? null : parseInt(dzienTygodnia, 10)
    };
}

/**
 * Ostatni termin, który już minął (włącznie z „dokładnie teraz").
 * @returns {Date}
 */
function poprzedniTermin(wyrazenie, strefa, teraz = new Date()) {
    const { minuta, godzina, dzienTygodnia } = rozbierzWyrazenie(wyrazenie);
    const dzis = czesciWStrefie(strefa, teraz);

    // Cofamy się dzień po dniu — 8 kroków wystarcza na dowolny harmonogram tygodniowy
    for (let wstecz = 0; wstecz <= 8; wstecz++) {
        const doba = new Date(Date.UTC(dzis.rok, dzis.miesiac - 1, dzis.dzien) - wstecz * 86400000);
        const rok = doba.getUTCFullYear();
        const mies = doba.getUTCMonth() + 1;
        const dz = doba.getUTCDate();

        if (dzienTygodnia !== null && doba.getUTCDay() !== dzienTygodnia) continue;

        const kandydat = zegarScienny(strefa, rok, mies, dz, godzina, minuta);
        if (kandydat.getTime() <= teraz.getTime()) return kandydat;
    }

    // Nie powinno się zdarzyć przy poprawnym wyrażeniu
    throw new Error(`Nie udało się wyznaczyć poprzedniego terminu dla "${wyrazenie}"`);
}

async function odczytajStan() {
    return store.getOrLoad(PLIK_STANU, () => ({}));
}

async function zapiszWykonanie(id) {
    await store.mutate(PLIK_STANU, stan => {
        stan[id] = new Date().toISOString();
    });
}

/**
 * Rejestruje zadanie cykliczne i nadrabia je, jeśli termin wypadł podczas przestoju.
 *
 * @param {Object} opcje
 * @param {string} opcje.id            unikalny klucz zadania (np. 'stalker:czyszczenie-punktow')
 * @param {string} opcje.wyrazenie     wyrażenie cron
 * @param {string} opcje.strefa        strefa czasowa (np. 'Europe/Warsaw')
 * @param {Function} opcje.zadanie     funkcja do wykonania (może być async)
 * @param {Object} [opcje.logger]      logger bota
 * @param {string} [opcje.opis]        czytelna nazwa do logów
 * @returns {Promise<Object>} uchwyt zadania z node-cron
 */
async function zarejestruj({ id, wyrazenie, strefa, zadanie, logger = domyslnyLogger, opis = null }) {
    const nazwa = opis || id;

    // Walidacja wyrażenia następuje TU, przy starcie — nie w środku nocy przy pierwszym odpaleniu
    rozbierzWyrazenie(wyrazenie);

    const wykonaj = async (powod) => {
        try {
            await zadanie();
        } catch (error) {
            logger.error(`❌ Zadanie "${nazwa}" (${powod}) zakończone błędem: ${error.message}`);
        } finally {
            // Znacznik zapisujemy TAKŻE po błędzie — inaczej nieudane zadanie
            // nadrabiałoby się w kółko przy każdym starcie bota
            await zapiszWykonanie(id).catch(err =>
                logger.error(`❌ Nie udało się zapisać znacznika zadania "${nazwa}": ${err.message}`)
            );
        }
    };

    const uchwyt = cron.schedule(wyrazenie, () => wykonaj('termin'), { timezone: strefa });

    // ─── nadrabianie ──────────────────────────────────────────────────────
    const stan = await odczytajStan();
    const ostatnie = stan[id] ? Date.parse(stan[id]) : null;
    const poprzedni = poprzedniTermin(wyrazenie, strefa);

    if (ostatnie === null) {
        // Pierwsze uruchomienie z tym mechanizmem — nie odpalamy wstecz, tylko
        // zapisujemy punkt odniesienia, żeby nadrabianie działało od następnego terminu
        await zapiszWykonanie(id);
        logger.info(`⏰ Zadanie "${nazwa}" zarejestrowane (${wyrazenie}) — pierwszy raz, bez nadrabiania`);
        return uchwyt;
    }

    if (ostatnie < poprzedni.getTime()) {
        const kiedy = poprzedni.toLocaleString('pl-PL', { timeZone: strefa });
        logger.warn(`⚠️ Zadanie "${nazwa}" nie wykonało się o czasie (${kiedy}) — bot był wyłączony. Nadrabiam teraz`);
        await wykonaj('nadrabianie');
    } else {
        logger.info(`⏰ Zadanie "${nazwa}" zarejestrowane (${wyrazenie}) — ostatnie wykonanie na czasie`);
    }

    return uchwyt;
}

/**
 * Znacznik ostatniego wykonania — dla zadań, które NIE chodzą na cronie, tylko na
 * własnym `setTimeout` (np. cotygodniowy skan MVP w Kontrolerze). Dzięki temu
 * korzystają z tego samego pliku stanu i tej samej logiki wykrywania przestoju.
 *
 * @returns {Promise<number|null>} znacznik czasu ostatniego wykonania albo null
 */
async function ostatnieWykonanie(id) {
    const stan = await odczytajStan();
    return stan[id] ? Date.parse(stan[id]) : null;
}

/** Zapisuje znacznik wykonania zadania spoza crona. */
async function oznaczWykonanie(id) {
    await zapiszWykonanie(id);
}

module.exports = {
    zarejestruj,
    poprzedniTermin,
    ostatnieWykonanie,
    oznaczWykonanie,
    // eksportowane do testów
    czesciWStrefie,
    zegarScienny
};
