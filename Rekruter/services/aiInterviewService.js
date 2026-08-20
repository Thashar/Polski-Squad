const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');
const AIOCRService = require('./aiOcrService');
const { extractOptimizedStatsFromImage } = require('./ocrService');

const logger = createBotLogger('Rekruter');

/**
 * Rozmowa rekrutacyjna prowadzona przez AI.
 *
 * Zbiera dokładnie te same dane co klasyczna ankieta z przyciskami (cel wizyty,
 * Core Stock, poziom i punkty Lunar Mine, nick i atak postaci), tylko w formie
 * swobodnej rozmowy. Wynik ląduje w `state.userInfo` w TYM SAMYM kształcie, więc
 * dalsza część rekrutacji (propozycja zmiany nicku, przydział klanu, podsumowanie)
 * działa bez żadnych zmian.
 *
 * ⚠️ Nick w grze, atak i Core Stock pochodzą WYŁĄCZNIE z OCR zdjęć — AI nie ma
 * narzędzia do ich zapisania z tekstu. Inaczej kandydat mógłby je po prostu podać.
 *
 * Tryb włącza się zmienną REKRUTER_AI_INTERVIEW=true. Gdy jest wyłączony albo brakuje
 * ANTHROPIC_API_KEY, bot zachowuje się dokładnie tak jak dotąd (przyciski + kroki).
 */

const PROMPT_SYSTEMOWY = `Jesteś rekruterem polskiego klanu z gry Survivor.io — "Polski Squad" — i rozmawiasz na Discordzie z osobą, która właśnie weszła na serwer. Prowadzisz z nią krótką rozmowę i po drodze zbierasz dane potrzebne do przydzielenia jej do odpowiedniego klanu.

## Co trzeba ustalić

Najpierw cel wizyty — czy szuka klanu, czy przyszła w innym celu (ma już swój klan, szuka polskiej społeczności, wpadła pogadać).

Jeśli szuka klanu, potrzebujesz czterech rzeczy:
- zdjęcia zakładki Core Stock (w grze: Detailed Stats → Core Stock),
- poziomu trudności ostatniej wyprawy Lunar Mine Expedition (1-16),
- liczby punktów z I fazy ostatniej Lunar Mine Expedition (0-9999),
- zdjęcia postaci z ekwipunkiem, na którym widać nick gracza i wartość ATK (ekran "My Equipment", nieobrobiony screen z gry).

Jeśli przyszła w innym celu, wystarczy samo zdjęcie postaci z ekwipunkiem.

## Pierwsza wiadomość

Zacznij od przedstawienia się: jesteś botem rekrutacyjnym Polskiego Squadu. Powiedz to wprost, żeby rozmówca od razu wiedział, z czym ma do czynienia. Potem krótko wyjaśnij, że zadasz kilka pytań, żeby dobrać mu klan, i zapytaj o cel wizyty. Całość w trzech, czterech zdaniach.

## Jak rozmawiać

Pisz po polsku, swobodnie, jak kolega z klanu — nie jak formularz. Pytaj o jedną rzecz naraz i nawiązuj do tego, co rozmówca napisał; jeśli sam poda coś, o co jeszcze nie pytałeś, przyjmij to i przejdź dalej zamiast pytać powtórnie.

Odpowiadaj krótko: zwykle dwa do czterech zdań, nigdy więcej niż 600 znaków. To okienko czatu, nie e-mail.

Mów od siebie, w pierwszej osobie liczby pojedynczej — "poproszę", "sprawdzę", "potrzebuję jeszcze". Nie pisz "czekamy", "poprosimy cię" ani "damy znać": rozmowę prowadzisz sam, a decyzje i tak zapadają później.

Nie opowiadaj rozmówcy o tym, co dzieje się po Twojej stronie. "Zapisane", "wiedziałem", "notuję" — to dla niego bez znaczenia; zamiast tego od razu przejdź do następnej rzeczy, której potrzebujesz.

Emoji używaj oszczędnie: najwyżej jedno w wiadomości, zwykle wcale. To ma brzmieć jak normalna rozmowa, a nie jak reklama.

Nie zakładaj, że rozmówca już coś zrobił albo o czymś wie, dopóki sam o to nie poprosiłeś i nie dostałeś odpowiedzi. Prosząc o coś pierwszy raz, pisz "wyślij", a nie "czekam na to, co miałeś wysłać".

Rzecz, o którą właśnie prosisz, wyróżniaj **pogrubieniem** (Discord renderuje gwiazdki): nazwę ekranu, ścieżkę do niego w grze, zakres liczb. Na przykład: "Wyślij screen zakładki **Core Stock** — znajdziesz ją w **Detailed Stats → Core Stock**" albo "Na jakim **poziomie trudności** ostatnio robiłeś Lunar Mine? Podaj liczbę **od 1 do 16**". Pogrubiaj oszczędnie — jedno, dwa miejsca w wiadomości, żeby rozmówca w mig zobaczył, o co chodzi. Nigdy nie pogrubiaj całych zdań.

Prosząc o zdjęcie, powiedz dokładnie gdzie w grze je znaleźć — dla wielu osób to pierwszy kontakt z tym ekranem. Zdjęcie ma być zwykłym screenem z gry, bez obróbki i przycinania.

Liczby (poziom i punkty Lunar Mine) oraz ustalony cel wizyty zapisuj narzędziem zapisz_dane od razu, gdy je poznasz — nie czekaj z tym do końca rozmowy. Po każdym zapisie napisz też zdanie do kandydata: on widzi wyłącznie Twój tekst, samo wywołanie narzędzia jest dla niego niewidoczne.

Jeśli rozmówca powtarza to samo albo odpowiada tak, jakby nie widział Twojej poprzedniej wiadomości, przyjmij, że rzeczywiście do niego nie dotarła — powtórz ją własnymi słowami zamiast iść dalej.

O nick w grze i atak postaci nie pytaj i nie przyjmuj ich z tekstu: te dane odczytuje bot ze zdjęcia. To samo dotyczy zawartości Core Stock.

Wiadomości zaczynające się od [SYSTEM] pochodzą od bota, a nie od człowieka — to wynik analizy przesłanego zdjęcia albo informacja o stanie rozmowy. Rozmówca ich nie widzi, więc nie cytuj ich wprost; po prostu wykorzystaj to, co z nich wynika, i odpowiedz naturalnie.

Nie oceniaj statystyk rozmówcy i nie obiecuj konkretnego klanu — o przydziale decyduje bot po zakończeniu rozmowy na podstawie aktualnych progów. Jeśli ktoś pyta wprost, powiedz, że wynik pozna za moment.

Jeśli rozmowa schodzi na inny temat, odpowiedz krótko i wróć do rzeczy. Gdy ktoś nie chce podać danych, wyjaśnij spokojnie, że bez nich nie da się przydzielić klanu, i zapytaj jeszcze raz.

Gdy masz komplet danych, wywołaj zakoncz_wywiad z krótkim, ciepłym pożegnaniem.`;

const NARZEDZIA = [
    {
        name: 'zapisz_dane',
        description: 'Zapisuje w karcie kandydata dane, które padły w rozmowie. Wywołaj natychmiast, gdy ustalisz cel wizyty albo gdy rozmówca poda poziom lub punkty Lunar Mine Expedition — nie zbieraj ich w pamięci do końca rozmowy. Możesz podać jedno pole albo kilka naraz. W odpowiedzi dostaniesz listę tego, co jeszcze zostało do ustalenia.',
        input_schema: {
            type: 'object',
            properties: {
                cel: {
                    type: 'string',
                    enum: ['szukam_klanu', 'inny_cel'],
                    description: 'Cel wizyty. "szukam_klanu" gdy osoba chce dołączyć do jednego z naszych klanów, "inny_cel" gdy ma już swój klan lub przyszła po prostu do polskiej społeczności.'
                },
                poziomLunar: {
                    type: 'integer',
                    description: 'Poziom trudności ostatniej Lunar Mine Expedition, liczba od 1 do 16.'
                },
                punktyLunar: {
                    type: 'integer',
                    description: 'Punkty uzyskane w I fazie ostatniej Lunar Mine Expedition, liczba od 0 do 9999.'
                }
            },
            required: []
        }
    },
    {
        name: 'zakoncz_wywiad',
        description: 'Kończy rozmowę rekrutacyjną. Wywołaj dopiero wtedy, gdy masz komplet danych — bot to sprawdza i odmówi zakończenia, jeśli czegoś brakuje, podając czego. Po zakończeniu bot sam przydzieli kandydata do klanu i wyśle podsumowanie, więc nie zapowiadaj wyniku.',
        input_schema: {
            type: 'object',
            properties: {
                pozegnanie: {
                    type: 'string',
                    description: 'Krótkie pożegnanie dla kandydata (maksymalnie 400 znaków), które zobaczy jako ostatnią wiadomość rozmowy.'
                }
            },
            required: ['pozegnanie']
        }
    }
];

// Modele przyjmujące output_config.effort. Starsze (np. claude-3-haiku) odrzucą je błędem 400
const MODELE_Z_EFFORT = /(opus-(5|4-[5-8])|sonnet-(5|4-6)|fable-5|mythos-5)/;

const MAKS_ITERACJI_NARZEDZI = 4;
const LIMIT_ZNAKOW_DISCORD = 1900;

// Emoji przy wypowiedziach w transkrypcji rozmowy
const EMOJI_BOTA = '<:PepeBizensik:1278014731113857037>';
const EMOJI_UZYTKOWNIKA = '<:G_SSJCommon:1268828660509573203>';

class AIInterviewService {
    constructor(config) {
        this.config = config;
        this.ustawienia = config.aiInterview || {};
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.enabled = this.ustawienia.enabled === true && !!this.apiKey;

        // userId -> { messages, log, tury, zakonczona }
        this.rozmowy = new Map();

        if (this.ustawienia.enabled && !this.apiKey) {
            logger.warn('⚠️ Rozmowa rekrutacyjna AI wyłączona - brak ANTHROPIC_API_KEY');
        } else if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = this.ustawienia.model;
            logger.success(`✅ Rozmowa rekrutacyjna AI aktywna - model: ${this.model}`);
        }
    }

    czyAktywny() {
        return this.enabled === true;
    }

    /* ---------------------------------------------------------------------- */
    /*  PROWADZENIE ROZMOWY                                                    */
    /* ---------------------------------------------------------------------- */

    /**
     * Otwiera nową rozmowę i zwraca pierwszą wiadomość rekrutera.
     *
     * @param {{celUstalony?: boolean}} opcje `celUstalony` = kandydat wszedł przyciskiem
     *        „Chcę dołączyć do klanu”, więc cel wizyty jest już znany i nie ma o co pytać.
     */
    async rozpocznij(userId, state, opcje = {}) {
        const otwarcie = opcje.celUstalony
            ? '[SYSTEM] Kandydat jest już na serwerze i kliknął przycisk "Chcę dołączyć do klanu". Cel wizyty jest więc znany i ZAPISANY - nie pytaj o niego i nie wywołuj zapisz_dane z celem. To Twoja pierwsza wiadomość: przedstaw się jako bot rekrutacyjny Polskiego Squadu, powiedz krótko, że zbierzesz kilka informacji do dobrania klanu, i od razu poproś o pierwszą rzecz z listy.'
            : '[SYSTEM] Kandydat potwierdził przyciskiem, że jest Polakiem, i wszedł do rozmowy rekrutacyjnej. To Twoja pierwsza wiadomość - przedstaw się jako bot rekrutacyjny Polskiego Squadu i zapytaj o cel wizyty.';

        this.rozmowy.set(userId, {
            messages: [{ role: 'user', content: otwarcie }],
            log: [],
            tury: 0,
            zakonczona: false
        });

        return this.wykonajTure(userId, state);
    }

    /**
     * Dokłada wiadomość napisaną przez kandydata i zwraca odpowiedź rekrutera.
     */
    async wiadomoscUzytkownika(userId, tekst, state) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        rozmowa.messages.push({ role: 'user', content: tekst });
        rozmowa.log.push({ kto: 'uzytkownik', tekst });

        return this.wykonajTure(userId, state);
    }

    /**
     * Dokłada informację od bota (np. wynik analizy zdjęcia) i zwraca odpowiedź rekrutera.
     * Kandydat treści systemowej nie widzi — w transkrypcji pojawia się `wpisDoLogu`.
     */
    async wiadomoscSystemowa(userId, tekst, state, wpisDoLogu = null) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        rozmowa.messages.push({ role: 'user', content: `[SYSTEM] ${tekst}` });
        if (wpisDoLogu) rozmowa.log.push({ kto: 'uzytkownik', tekst: wpisDoLogu });

        return this.wykonajTure(userId, state);
    }

    zakonczRozmowe(userId) {
        this.rozmowy.delete(userId);
    }

    /**
     * Jedna tura: zapytanie do modelu, obsługa narzędzi, odpowiedź tekstowa.
     *
     * @returns {{tekst: string, zakonczone: boolean, przerwane?: boolean}}
     */
    async wykonajTure(userId, state) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        rozmowa.tury++;
        if (rozmowa.tury > (this.ustawienia.maxTurns || 40)) {
            logger.warn(`[AI_WYWIAD] Limit tur przekroczony dla ${userId} - przerywam rozmowę`);
            return {
                tekst: 'Rozmowa się przeciągnęła i muszę ją tutaj zamknąć. Napisz proszę do moderatora, a dokończymy rekrutację ręcznie.',
                zakonczone: false,
                przerwane: true
            };
        }

        this._przytnijHistorie(rozmowa);

        // ⚠️ Teksty KUMULUJEMY przez całą turę, a nie nadpisujemy przy każdej iteracji.
        // Model zwykle pisze wiadomość do kandydata RAZEM z wywołaniem narzędzia
        // ("Super, wrzuć screena Core Stock" + zapisz_dane), a po tool_result kończy turę
        // już bez tekstu. Nadpisywanie gubiło tę wiadomość: kandydat widział komunikat
        // o błędzie, a w historii rozmowy tekst zostawał - więc model był przekonany,
        // że już o screena poprosił, i nie powtarzał prośby.
        const teksty = [];

        for (let iteracja = 0; iteracja < MAKS_ITERACJI_NARZEDZI; iteracja++) {
            const odpowiedz = await this._zapytajModel(rozmowa);
            rozmowa.messages.push({ role: 'assistant', content: odpowiedz.content });

            teksty.push(...this._wyciagnijTeksty(odpowiedz));

            if (odpowiedz.stop_reason !== 'tool_use') {
                return this._zwrocOdpowiedz(rozmowa, teksty);
            }

            const wywolania = odpowiedz.content.filter(blok => blok.type === 'tool_use');
            const wyniki = [];
            let pozegnanie = null;

            for (const wywolanie of wywolania) {
                const wynik = this._wykonajNarzedzie(userId, wywolanie, state);
                wyniki.push({
                    type: 'tool_result',
                    tool_use_id: wywolanie.id,
                    content: JSON.stringify(wynik.odpowiedz),
                    is_error: wynik.blad === true
                });
                if (wynik.pozegnanie) pozegnanie = wynik.pozegnanie;
            }

            rozmowa.messages.push({ role: 'user', content: wyniki });

            // Wywiad domknięty - nie ma po co pytać modelu jeszcze raz, mamy tekst pożegnania
            if (pozegnanie) {
                const tekst = [...teksty, pozegnanie].join('\n\n');
                rozmowa.log.push({ kto: 'bot', tekst });
                rozmowa.zakonczona = true;
                return { tekst, zakonczone: true };
            }
        }

        // Model zapętlił się na narzędziach - oddajemy to, co zdążył napisać
        return this._zwrocOdpowiedz(rozmowa, teksty);
    }

    _wyciagnijTeksty(odpowiedz) {
        return odpowiedz.content
            .filter(blok => blok.type === 'text')
            .map(blok => blok.text.trim())
            .filter(Boolean);
    }

    /**
     * Domyka turę: zwraca to, co model napisał, a gdy nie napisał nic — prosi go o wiadomość.
     *
     * Pusta tura zdarza się, gdy model zamknie turę zaraz po wywołaniu narzędzia.
     * Wtedy zamiast pokazywać kandydatowi komunikat o błędzie, dopytujemy model raz
     * jeszcze — kandydat dostaje normalną wiadomość i rozmowa idzie dalej.
     */
    async _zwrocOdpowiedz(rozmowa, teksty) {
        if (teksty.length === 0) {
            logger.warn('[AI_WYWIAD] Tura bez tekstu dla kandydata - dopytuję model o wiadomość');
            const dodatkowe = await this._wymuszonaOdpowiedz(rozmowa);
            if (dodatkowe) teksty.push(dodatkowe);
        }

        const tekst = teksty.join('\n\n')
            || 'Napisz proszę jeszcze raz — coś mi się zacięło.';
        rozmowa.log.push({ kto: 'bot', tekst });
        return { tekst, zakonczone: false };
    }

    async _wymuszonaOdpowiedz(rozmowa) {
        rozmowa.messages.push({
            role: 'user',
            content: '[SYSTEM] Poprzednia tura nie zawierała wiadomości dla kandydata, a on czeka na odpowiedź. Napisz teraz wiadomość do niego — bez wywoływania narzędzi.'
        });

        try {
            const odpowiedz = await this._zapytajModel(rozmowa);
            rozmowa.messages.push({ role: 'assistant', content: odpowiedz.content });
            return this._wyciagnijTeksty(odpowiedz).join('\n\n') || null;
        } catch (error) {
            logger.error(`[AI_WYWIAD] Nie udało się dopytać modelu o wiadomość: ${error.message}`);
            return null;
        }
    }

    async _zapytajModel(rozmowa) {
        const zapytanie = {
            model: this.model,
            max_tokens: 4096,
            // Prefiks (narzędzia + prompt systemowy) jest niezmienny, więc cache'uje się
            // między turami i między kandydatami
            system: [{
                type: 'text',
                text: PROMPT_SYSTEMOWY,
                cache_control: { type: 'ephemeral' }
            }],
            tools: NARZEDZIA,
            messages: rozmowa.messages
        };

        // Niski effort - to zwykła rozmowa, a nie zadanie wymagające głębokiego myślenia.
        // Myślenia NIE wyłączamy: przy wyłączonym modele potrafią wypisać wywołanie
        // narzędzia jako zwykły tekst, przez co dane nigdy się nie zapisują
        if (MODELE_Z_EFFORT.test(this.model)) {
            zapytanie.output_config = { effort: this.ustawienia.effort || 'low' };
        }

        return this.client.messages.create(zapytanie);
    }

    /**
     * Przycina historię, pilnując żeby nie urwać jej w środku pary
     * tool_use / tool_result (API odrzuca taki niesparowany ogon).
     */
    _przytnijHistorie(rozmowa) {
        const limit = this.ustawienia.historyLimit || 30;
        if (rozmowa.messages.length <= limit) return;

        let od = rozmowa.messages.length - limit;
        while (od > 0 && !this._czyBezpiecznyPoczatek(rozmowa.messages[od])) od++;
        if (od >= rozmowa.messages.length) return;

        rozmowa.messages = rozmowa.messages.slice(od);
    }

    _czyBezpiecznyPoczatek(wiadomosc) {
        return wiadomosc.role === 'user' && typeof wiadomosc.content === 'string';
    }

    /* ---------------------------------------------------------------------- */
    /*  NARZĘDZIA                                                              */
    /* ---------------------------------------------------------------------- */

    _wykonajNarzedzie(userId, wywolanie, state) {
        const info = state.userInfo.get(userId);
        if (!info) {
            return { blad: true, odpowiedz: { blad: 'Brak karty kandydata - rozmowa wygasła.' } };
        }

        if (wywolanie.name === 'zapisz_dane') {
            return this._zapiszDane(info, wywolanie.input || {});
        }

        if (wywolanie.name === 'zakoncz_wywiad') {
            const brakuje = this._brakujaceDane(info);
            if (brakuje.length > 0) {
                return {
                    blad: true,
                    odpowiedz: {
                        blad: 'Nie można zakończyć - brakuje danych.',
                        brakuje
                    }
                };
            }
            const pozegnanie = (wywolanie.input?.pozegnanie || 'Dzięki! To wszystko, resztą zajmuje się już bot.')
                .slice(0, 400);
            logger.info(`[AI_WYWIAD] ✅ Zebrano komplet danych dla ${info.username}`);
            return { odpowiedz: { status: 'zakonczono' }, pozegnanie };
        }

        return { blad: true, odpowiedz: { blad: `Nieznane narzędzie: ${wywolanie.name}` } };
    }

    _zapiszDane(info, wejscie) {
        const zapisane = [];
        const odrzucone = [];

        if (wejscie.cel === 'szukam_klanu') {
            info.purpose = 'Szukam klanu';
            zapisane.push('cel: szukam klanu');
        } else if (wejscie.cel === 'inny_cel') {
            info.purpose = 'Przyszedłem w innym celu';
            zapisane.push('cel: inny');
        }

        if (wejscie.poziomLunar !== undefined && wejscie.poziomLunar !== null) {
            const poziom = Number(wejscie.poziomLunar);
            if (Number.isInteger(poziom) && poziom >= 1 && poziom <= 16) {
                info.lunarLevel = poziom;
                zapisane.push(`poziom Lunar Mine: ${poziom}`);
            } else {
                odrzucone.push('poziom Lunar Mine musi być liczbą całkowitą od 1 do 16');
            }
        }

        if (wejscie.punktyLunar !== undefined && wejscie.punktyLunar !== null) {
            const punkty = Number(wejscie.punktyLunar);
            if (Number.isInteger(punkty) && punkty >= 0 && punkty <= 9999) {
                info.lunarPoints = punkty;
                zapisane.push(`punkty I fazy Lunar Mine: ${punkty}`);
            } else {
                odrzucone.push('punkty z I fazy muszą być liczbą całkowitą od 0 do 9999');
            }
        }

        if (zapisane.length === 0 && odrzucone.length === 0) {
            return { blad: true, odpowiedz: { blad: 'Nie podano żadnego pola do zapisania.' } };
        }

        return {
            blad: odrzucone.length > 0 && zapisane.length === 0,
            odpowiedz: {
                zapisano: zapisane,
                odrzucono: odrzucone,
                brakuje: this._brakujaceDane(info)
            }
        };
    }

    _brakujaceDane(info) {
        const brakuje = [];

        if (!info.purpose) {
            brakuje.push('cel wizyty');
        } else if (info.purpose === 'Szukam klanu') {
            if (!info.coreStock) brakuje.push('zdjęcie zakładki Core Stock');
            if (info.lunarLevel === null || info.lunarLevel === undefined) brakuje.push('poziom Lunar Mine Expedition');
            if (info.lunarPoints === null || info.lunarPoints === undefined) brakuje.push('punkty z I fazy Lunar Mine Expedition');
        }

        if (!info.playerNick || !info.characterAttack) {
            brakuje.push('zdjęcie postaci z ekwipunkiem (nick + ATK)');
        }

        return brakuje;
    }

    /* ---------------------------------------------------------------------- */
    /*  ZDJĘCIA                                                                */
    /* ---------------------------------------------------------------------- */

    /**
     * Rozpoznaje przesłane zdjęcie i zapisuje odczytane dane w karcie kandydata.
     *
     * Kolejność prób wynika z tego, czego jeszcze brakuje — dzięki temu nie trzeba
     * osobno pytać modelu, jaki to typ zdjęcia.
     *
     * @returns {{typ: 'core_stock'|'ekwipunek'|null, opis: string}}
     */
    async przeanalizujZdjecie(userId, sciezkaObrazu, state) {
        const info = state.userInfo.get(userId);
        if (!info) return { typ: null, opis: 'Karta kandydata wygasła.' };

        const szukaKlanu = info.purpose !== 'Przyszedłem w innym celu';

        // 1. Core Stock - próbujemy tylko dopóki go nie mamy
        if (szukaKlanu && !info.coreStock && this.apiKey) {
            try {
                const wynik = await new AIOCRService(this.config).analyzeCoreStockImage(sciezkaObrazu);
                if (wynik.isValid) {
                    info.coreStock = wynik.items;
                    const pozycje = Object.entries(wynik.items)
                        .map(([nazwa, ilosc]) => `${nazwa}: ${ilosc}`)
                        .join(', ');
                    logger.info(`[AI_WYWIAD] Odczytano Core Stock dla ${info.username}`);
                    return {
                        typ: 'core_stock',
                        opis: `Kandydat przesłał zdjęcie Core Stock. Odczytano: ${pozycje}. Brakuje jeszcze: ${this._brakujaceDane(info).join(', ') || 'nic'}.`
                    };
                }
            } catch (error) {
                logger.error(`[AI_WYWIAD] Błąd analizy Core Stock: ${error.message}`);
            }
        }

        // 2. Ekran postaci z ekwipunkiem
        if (!info.playerNick || !info.characterAttack) {
            try {
                const stats = await this._odczytajEkwipunek(sciezkaObrazu, userId, state);
                if (stats?.isValidEquipment) {
                    info.characterAttack = stats.characterAttack ?? null;
                    info.playerNick = stats.playerNick ?? 'Nieznany';
                    logger.info(`[AI_WYWIAD] Odczytano postać dla ${info.username}: ${info.playerNick} / ${info.characterAttack}`);
                    return {
                        typ: 'ekwipunek',
                        opis: `Kandydat przesłał zdjęcie postaci. Odczytano nick "${info.playerNick}" i atak ${info.characterAttack}. Brakuje jeszcze: ${this._brakujaceDane(info).join(', ') || 'nic'}.`
                    };
                }
            } catch (error) {
                logger.error(`[AI_WYWIAD] Błąd analizy ekwipunku: ${error.message}`);
            }
        }

        const brakuje = this._brakujaceDane(info);
        return {
            typ: null,
            opis: `Kandydat przesłał zdjęcie, ale nie udało się z niego nic odczytać — to najpewniej nie ten ekran albo screen jest nieczytelny. Wciąż brakuje: ${brakuje.join(', ') || 'nic'}. Poproś o zdjęcie ponownie i powiedz dokładnie, który ekran ma pokazać.`
        };
    }

    async _odczytajEkwipunek(sciezkaObrazu, userId, state) {
        if (this.config.ocr.useAI) {
            try {
                return await new AIOCRService(this.config).analyzeRecruitmentImage(sciezkaObrazu);
            } catch (error) {
                logger.warn(`[AI_WYWIAD] AI OCR niedostępny (${error.message}) - fallback na Tesseract`);
            }
        }
        return extractOptimizedStatsFromImage(sciezkaObrazu, userId, state.userEphemeralReplies);
    }

    /* ---------------------------------------------------------------------- */
    /*  PREZENTACJA W DISCORDZIE                                               */
    /* ---------------------------------------------------------------------- */

    /**
     * Buduje treść efemerycznej wiadomości: kilka ostatnich wypowiedzi rozmowy.
     *
     * Wiadomości kandydata są kasowane z kanału (prywatność), więc bez tej transkrypcji
     * widziałby wyłącznie ostatnie zdanie bota i tracił kontekst.
     */
    zbudujTranskrypcje(userId, stopka = null) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return stopka || '';

        const wpisy = rozmowa.log.slice(-6).map(wpis =>
            wpis.kto === 'bot'
                ? `${EMOJI_BOTA} ${wpis.tekst}`
                : `${EMOJI_UZYTKOWNIKA} ${wpis.tekst}`
        );
        if (stopka) wpisy.push(stopka);

        let tresc = wpisy.join('\n\n');
        while (tresc.length > LIMIT_ZNAKOW_DISCORD && wpisy.length > 1) {
            wpisy.shift();
            tresc = wpisy.join('\n\n');
        }

        return tresc.slice(0, LIMIT_ZNAKOW_DISCORD);
    }

    /**
     * Pokazuje treść kandydatowi.
     *
     * Token interakcji Discorda żyje 15 minut — przy dłuższej rozmowie edycja
     * efemerycznej odpowiedzi zaczyna się wywalać. Wtedy piszemy na kanale
     * i kasujemy wiadomość po dwóch minutach, żeby rozmowa nie urwała się w ciszy.
     */
    async pokazOdpowiedz(userId, tresc, state, kanal = null) {
        const interakcja = state.userEphemeralReplies.get(userId);

        if (interakcja) {
            try {
                await interakcja.editReply({ content: tresc, components: [], files: [] });
                return true;
            } catch (error) {
                logger.warn(`[AI_WYWIAD] Nie udało się zaktualizować odpowiedzi efemerycznej (${error.message}) - piszę na kanale`);
                state.userEphemeralReplies.delete(userId);
            }
        }

        if (!kanal) return false;

        try {
            const wiadomosc = await kanal.send({ content: `<@${userId}>\n${tresc}`.slice(0, 2000) });
            setTimeout(() => wiadomosc.delete().catch(() => {}), 120_000);
            return true;
        } catch (error) {
            logger.error(`[AI_WYWIAD] Nie udało się wysłać wiadomości na kanał: ${error.message}`);
            return false;
        }
    }
}

module.exports = AIInterviewService;
