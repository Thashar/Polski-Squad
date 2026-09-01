const path = require('path');
const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

const PLIK = path.join(__dirname, '../data/offtopic.json');

/** Po tylu przerwanych rozmowach kandydat wylatuje z serwera */
const PRZERWANIA_DO_KICKA = 3;

/**
 * Licznik rozmów przerwanych z powodu odbiegania od tematu — TRWAŁY, per osoba.
 *
 * Licznik odbiegnięć w obrębie JEDNEJ rozmowy siedzi w `aiInterviewService`
 * (pamięć, ginie razem z rozmową). Tutaj trzymamy to, co musi przeżyć restart bota
 * i kolejne podejścia do rekrutacji: ile razy rozmowa z tą osobą została przerwana.
 *
 * ⚠️ Bez zapisu na dysk cała reguła byłaby fikcją — wystarczyłby restart bota albo
 * kliknięcie przycisku od nowa, żeby zacząć z czystym kontem.
 *
 * Kształt pliku `data/offtopic.json`:
 * { "<userId>": { przerwania, username, ostatnie } }
 */
class OffTopicService {
    constructor() {
        store.register(PLIK, {
            defaultValue: () => ({}),
            label: 'Rekruter/offtopic',
        });
    }

    /**
     * Zapisuje kolejne przerwanie rozmowy i mówi, czy to już próg wyrzucenia.
     *
     * ⚠️ Po osiągnięciu progu licznik jest ZEROWANY. Kick zamyka cykl: osoba, która
     * wróci na serwer, zaczyna od nowa z trzema szansami, zamiast lecieć z serwera
     * po pierwszej nieudanej rozmowie już na zawsze.
     *
     * @returns {Promise<{przerwania: number, kick: boolean}>} `przerwania` to stan
     *          PRZED wyzerowaniem, czyli liczba, która wywołała decyzję
     */
    async zanotujPrzerwanie(userId, username = null) {
        let wynik = { przerwania: 1, kick: false };

        await store.mutate(PLIK, dane => {
            const wpis = dane[userId] || { przerwania: 0, username: null, ostatnie: null };
            wpis.przerwania += 1;
            wpis.username = username || wpis.username;
            wpis.ostatnie = new Date().toISOString();

            wynik = { przerwania: wpis.przerwania, kick: wpis.przerwania >= PRZERWANIA_DO_KICKA };

            if (wynik.kick) {
                delete dane[userId];
            } else {
                dane[userId] = wpis;
            }
        });

        logger.warn(`[OFF_TOPIC] ${username || userId}: przerwana rozmowa ${wynik.przerwania}/${PRZERWANIA_DO_KICKA}${wynik.kick ? ' — próg wyrzucenia' : ''}`);
        return wynik;
    }

    /** Ile razy rozmowa z tą osobą została już przerwana (0 gdy brak wpisu) */
    async liczbaPrzerwan(userId) {
        const dane = await store.getOrLoad(PLIK, () => ({}));
        return dane?.[userId]?.przerwania || 0;
    }

    /** Czyści licznik — np. gdy rekrutacja zakończy się pomyślnie */
    async wyzeruj(userId) {
        const dane = await store.getOrLoad(PLIK, () => ({}));
        if (!dane || !dane[userId]) return;
        await store.mutate(PLIK, d => { delete d[userId]; });
    }

    get przerwaniaDoKicka() {
        return PRZERWANIA_DO_KICKA;
    }
}

module.exports = OffTopicService;
