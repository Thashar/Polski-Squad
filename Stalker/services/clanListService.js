const path = require('path');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const { createBotLogger } = require('../../utils/consoleLogger');
const store = require('../../utils/jsonStore');

const logger = createBotLogger('Stalker');

/**
 * Lista klanów — po jednej wiadomości bota na klan, na kanale z przyciskiem
 * „Chcę dołączyć do klanu".
 *
 * Podział obowiązków:
 * - **ustawiane ręcznie** (przycisk w panelu OCR → modal): poziom klanu, poziom trudności
 *   ekspedycji, tier, tekst wstępny i dodatkowe wiersze,
 * - **wyliczane automatycznie**: punkty z bieżącego tygodnia Fazy 1 LME (suma TOP30) oraz
 *   skład Lider / Vice (z ról na serwerze).
 */

const PLIK_DANYCH = path.join(__dirname, '../data/clan_list.json');

/** Ile najwyżej wierszy „dodatkowych" przyjmujemy z modala — reszta jest ucinana */
const MAKS_DODATKOWYCH_WIERSZY = 10;

/** Discord tnie wiadomość powyżej 2000 znaków — budujemy z zapasem i ostrzegamy w logu */
const LIMIT_WIADOMOSCI = 2000;

store.register(PLIK_DANYCH, { defaultValue: () => ({}), label: 'Stalker/clan_list' });

class ClanListService {
    /**
     * @param {Object} config konfiguracja Stalkera (`config.clanList`, `config.targetRoles`,
     *        `config.leadershipRoles`)
     * @param {Object} databaseService serwis bazy — źródło `getPhase1Summary`
     * @param {Object} phaseService serwis faz — źródło `getCurrentWeekInfo`
     */
    constructor(config, databaseService, phaseService) {
        this.config = config;
        this.databaseService = databaseService;
        this.phaseService = phaseService;

        this.ustawienia = config.clanList || {};
        this.enabled = !!this.ustawienia.channelId;

        // Łańcuch przebiegów odświeżania — patrz `odswiezWszystkie`
        this._wTrakcie = null;

        if (!this.enabled) {
            logger.info('ℹ️ [CLAN_LIST] Wyłączona - brak STALKER_LME_CLAN_LIST_CHANNEL');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  DANE USTAWIANE RĘCZNIE                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Ustawienia jednego klanu.
     *
     * ⚠️ Wartością domyślną jest `{}`, a nie `null` — wywołujący od razu czytają z niej pola
     * (`dane.clanLevel`), więc `null` wywróciłby budowanie wiadomości dla klanu, którego jeszcze
     * nie skonfigurowano. Brak konfiguracji poznajemy po pustych polach, nie po braku obiektu.
     */
    async pobierzDane(clanKey) {
        const wszystkie = await store.getOrLoad(PLIK_DANYCH, () => ({}));
        return wszystkie[clanKey] || {};
    }

    /** Wszystkie klany naraz — do panelu konfiguracyjnego */
    async pobierzWszystkie() {
        return store.getOrLoad(PLIK_DANYCH, () => ({}));
    }

    /**
     * Zapisuje ustawienia klanu, zachowując pola, których modal nie dotyka (`messageId`).
     */
    async zapiszDane(clanKey, dane) {
        await store.mutate(PLIK_DANYCH, wszystkie => {
            wszystkie[clanKey] = { ...(wszystkie[clanKey] || {}), ...dane };
        });
    }

    /* ------------------------------------------------------------------ */
    /*  DANE WYLICZANE                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Punkty TOP30 z BIEŻĄCEGO tygodnia Fazy 1.
     *
     * Brak danych za ten tydzień (nikt jeszcze nie wrzucił wyników) daje `null`, a wiersz
     * z punktami znika z wiadomości — lepsze niż pokazywanie zera, które czytałoby się
     * jak realny, fatalny wynik klanu.
     */
    async pobierzTop30(guildId, clanKey) {
        try {
            const { weekNumber, year } = this.phaseService.getCurrentWeekInfo();
            const podsumowanie = await this.databaseService.getPhase1Summary(
                guildId, weekNumber, year, clanKey
            );
            if (!podsumowanie || !podsumowanie.playerCount) return null;
            return podsumowanie.top30Sum ?? null;
        } catch (error) {
            logger.error(`[CLAN_LIST] Błąd odczytu TOP30 dla klanu ${clanKey}: ${error.message}`);
            return null;
        }
    }

    /**
     * Skład kierowniczy klanu: `{ lider: [id], vice: [id] }`.
     *
     * ⚠️ **Każdy Vice wymaga roli funkcyjnej ORAZ roli klanowej.** W akademiach rola Vice
     * Lidera jest WSPÓLNA dla klanów 0/1/2, więc bez przecięcia z rolą klanową vice wszystkich
     * trzech akademii wylądowaliby w każdej z trzech wiadomości. W klanie głównym przecięcie
     * ma inny sens: odsiewa osobę, której została rola Vice Lidera Main, choć klan już
     * opuściła — a taki wpis wisiałby w publicznej wiadomości rekrutacyjnej.
     *
     * ⚠️ **Lider klanu głównego jest wyjątkiem** — bierzemy samą rolę administratora serwera,
     * bez wymagania roli klanowej. Administracja nie zawsze siedzi na roli klanowej, a rola
     * admina i tak należy wyłącznie do klanu głównego.
     *
     * @param {Collection} members pobrani członkowie serwera (jedno pobranie na przebieg)
     */
    wyliczKierownictwo(members, clanKey) {
        const role = this.config.leadershipRoles || {};
        const rolaKlanowa = this.config.targetRoles?.[clanKey];

        const maRole = (member, roleId) => !!roleId && member.roles.cache.has(roleId);

        const zbierz = (rolaFunkcyjna, wymagajRoliKlanowej) => {
            if (!rolaFunkcyjna) return [];
            const wynik = [];
            for (const [memberId, member] of members) {
                if (!maRole(member, rolaFunkcyjna)) continue;
                if (wymagajRoliKlanowej && !maRole(member, rolaKlanowa)) continue;
                wynik.push(memberId);
            }
            return wynik;
        };

        if (clanKey === 'main') {
            return {
                lider: zbierz(role.adminMain, false),
                vice: zbierz(role.viceMain, true)
            };
        }

        return {
            lider: zbierz(role.leaderAcademy, true),
            vice: zbierz(role.viceAcademy, true)
        };
    }

    /* ------------------------------------------------------------------ */
    /*  BUDOWANIE TREŚCI                                                   */
    /* ------------------------------------------------------------------ */

    /**
     * Wcięcie bloku Lider/Vice.
     *
     * Discord zjada zwykłe spacje na początku linii, więc wcięcie robimy emoji serwera —
     * dokładnie tak, jak w ręcznie pisanych postach, które ta funkcja zastępuje.
     */
    _wciecie() {
        const emoji = this.ustawienia.indentEmoji || '';
        return emoji ? `${emoji} ${emoji}  ` : '';
    }

    /**
     * Buduje treść wiadomości dla jednego klanu.
     *
     * @param {string} clanKey klucz klanu ('main' | '2' | '1' | '0')
     * @param {Object} dane ustawienia z modala
     * @param {number|null} top30 punkty TOP30 albo null
     * @param {{lider: string[], vice: string[]}} kierownictwo
     */
    zbudujTresc(clanKey, dane, top30, kierownictwo) {
        const klan = this.ustawienia.clans?.[clanKey];
        if (!klan) return null;

        const linie = [];

        linie.push(`# ${klan.emoji}**${klan.name}**${klan.emoji} 🆔 ${klan.gameId}`);

        // Tekst wstępny (np. „(Klan for fun…)" przy PolskiSquad⁰) - opcjonalny, nad nagłówkiem sekcji
        if (dane.intro) linie.push(`**${dane.intro}**`);

        linie.push('## Informacje i wymagania:');
        linie.push('');
        linie.push('');

        if (dane.clanLevel)       linie.push(`▶ __Poziom Klanu__: **${dane.clanLevel}**`);
        if (dane.expeditionLevel) linie.push(`▶ __Poziom Trudności Ekspedycji__: **${dane.expeditionLevel}**`);
        if (dane.tier)            linie.push(`▶ __Tier Klanu__: **${dane.tier}**`);

        // ⚠️ Wartość to suma TOP30 z bazy (`top30Sum`), ale w wiadomości dla graczy
        // nazywa się „Punkty 1 Fazy LME" — nazwa techniczna nie wyciekła do interfejsu
        if (top30 !== null && top30 !== undefined) {
            linie.push(`▶ __Punkty 1 Fazy LME__: **${top30.toLocaleString('pl-PL')}**`);
        }

        const wciecie = this._wciecie();

        // Dodatkowe wiersze (progi, uwagi o awansie) - wcięte tak samo jak blok Lider/Vice
        for (const wiersz of this._rozbijDodatkowe(dane.extraLines)) {
            linie.push(`${wciecie}╰┈➤ ${wiersz}`);
        }

        for (const userId of kierownictwo.lider) linie.push(`${wciecie}╰┈➤Lider: <@${userId}>`);
        for (const userId of kierownictwo.vice)  linie.push(`${wciecie}╰┈➤Vice: <@${userId}>`);

        // Kreska zamykająca — Discord skleja kolejne wiadomości tego samego autora w jeden
        // blok, więc bez niej cztery posty czytają się jak jedna ściana tekstu
        if (this.ustawienia.separator) {
            linie.push('');
            linie.push(this.ustawienia.separator);
        }

        const tresc = linie.join('\n');

        if (tresc.length > LIMIT_WIADOMOSCI) {
            logger.warn(`[CLAN_LIST] Treść dla klanu ${clanKey} ma ${tresc.length} znaków (limit ${LIMIT_WIADOMOSCI}) - Discord ją odrzuci`);
        }

        return tresc;
    }

    /** Wielolinijkowe pole z modala → tablica wierszy bez pustych */
    _rozbijDodatkowe(tekst) {
        if (!tekst) return [];
        return String(tekst)
            .split('\n')
            .map(w => w.trim())
            .filter(w => w.length > 0)
            .slice(0, MAKS_DODATKOWYCH_WIERSZY);
    }

    /* ------------------------------------------------------------------ */
    /*  WYSYŁKA I ODŚWIEŻANIE                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Przebudowuje wiadomości wszystkich klanów.
     *
     * ⚠️ **Wiadomość jest EDYTOWANA, nigdy wysyłana od nowa**, dopóki istnieje. Na tym kanale
     * stoi też przycisk Rekrutera „Chcę dołączyć do klanu" i ma być POD listą klanów — a każda
     * nowa wiadomość ląduje na końcu kanału. Kasowanie i wysyłanie od nowa przy każdym starcie
     * bota przestawiałoby więc kolejność. `messageId` siedzi w JSON-ie, więc przeżywa restart;
     * wysyłka rusza tylko wtedy, gdy ID nie ma albo wiadomość zniknęła z kanału.
     *
     * ⚠️ **Przebiegi są SERIALIZOWANE.** Odświeżenie wołają trzy niezależne wyzwalacze (start
     * bota, zapis w modalu, `guildMemberUpdate`), a przy pierwszym uruchomieniu — gdy `messageId`
     * jeszcze nie ma — dwa równoległe przebiegi zobaczyłyby pusty identyfikator i **każdy wysłałby
     * własną wiadomość**, zostawiając na kanale duplikaty. Kolejne wywołanie czeka więc na
     * poprzednie i widzi już zapisane ID.
     *
     * @param {Guild} guild serwer
     * @returns {Promise<{ok: boolean, zaktualizowane: number, powod?: string}>}
     */
    async odswiezWszystkie(guild) {
        // Błąd poprzedniego przebiegu nie może zablokować kolejnych, stąd `.catch`
        const biezace = (this._wTrakcie ?? Promise.resolve())
            .catch(() => {})
            .then(() => this._odswiezWszystkieBezKolejki(guild));

        this._wTrakcie = biezace;
        return biezace;
    }

    /** Właściwy przebieg odświeżania — wołany wyłącznie przez `odswiezWszystkie` */
    async _odswiezWszystkieBezKolejki(guild) {
        if (!this.enabled) return { ok: false, zaktualizowane: 0, powod: 'disabled' };

        let kanal;
        try {
            kanal = await guild.client.channels.fetch(this.ustawienia.channelId);
        } catch (error) {
            logger.error(`[CLAN_LIST] Nie znaleziono kanału ${this.ustawienia.channelId}: ${error.message}`);
            return { ok: false, zaktualizowane: 0, powod: 'no_channel' };
        }
        if (!kanal) return { ok: false, zaktualizowane: 0, powod: 'no_channel' };

        // Jedno pobranie członków na cały przebieg - `wyliczKierownictwo` dostaje gotową kolekcję
        const members = await safeFetchMembers(guild, logger);

        let zaktualizowane = 0;
        for (const clanKey of (this.ustawienia.order || [])) {
            try {
                const zrobione = await this._odswiezKlan(guild, kanal, members, clanKey);
                if (zrobione) zaktualizowane++;
            } catch (error) {
                logger.error(`[CLAN_LIST] Błąd odświeżania klanu ${clanKey}: ${error.message}`);
            }
        }

        logger.info(`[CLAN_LIST] Odświeżono ${zaktualizowane}/${(this.ustawienia.order || []).length} wiadomości`);
        return { ok: true, zaktualizowane };
    }

    /** Odświeża (albo zakłada) wiadomość jednego klanu. @returns {Promise<boolean>} */
    async _odswiezKlan(guild, kanal, members, clanKey) {
        const dane = await this.pobierzDane(clanKey);
        const top30 = await this.pobierzTop30(guild.id, clanKey);
        const kierownictwo = this.wyliczKierownictwo(members, clanKey);

        const tresc = this.zbudujTresc(clanKey, dane, top30, kierownictwo);
        if (!tresc) {
            logger.warn(`[CLAN_LIST] Klan ${clanKey} nie ma wpisu w config.clanList.clans - pomijam`);
            return false;
        }

        if (dane.messageId) {
            try {
                const wiadomosc = await kanal.messages.fetch(dane.messageId);
                await wiadomosc.edit({ content: tresc, allowedMentions: { parse: [] } });
                return true;
            } catch (error) {
                // Wiadomość skasowana ręcznie - ID jest bezwartościowe, wysyłamy nową niżej
                logger.warn(`[CLAN_LIST] Wiadomość ${dane.messageId} klanu ${clanKey} zniknęła - wysyłam nową`);
            }
        }

        const nowa = await kanal.send({ content: tresc, allowedMentions: { parse: [] } });
        await this.zapiszDane(clanKey, { messageId: nowa.id });
        logger.info(`[CLAN_LIST] Wysłano nową wiadomość dla klanu ${clanKey} (ID: ${nowa.id})`);
        return true;
    }

    /**
     * Czy zmiana ról tego członka może wpłynąć na skład w liście klanów.
     *
     * Filtr stoi przed odświeżeniem, bo `guildMemberUpdate` leci przy KAŻDEJ zmianie nicku,
     * awatara czy dowolnej roli — przebudowa czterech wiadomości za każdym razem to
     * niepotrzebny ruch po API Discorda.
     */
    czyZmianaDotyczyKierownictwa(staryCzlonek, nowyCzlonek) {
        if (!this.enabled) return false;

        const role = this.config.leadershipRoles || {};
        const doSprawdzenia = [
            role.adminMain, role.viceMain, role.leaderAcademy, role.viceAcademy,
            ...Object.values(this.config.targetRoles || {})
        ].filter(Boolean);

        return doSprawdzenia.some(roleId =>
            staryCzlonek.roles.cache.has(roleId) !== nowyCzlonek.roles.cache.has(roleId)
        );
    }
}

module.exports = ClanListService;
