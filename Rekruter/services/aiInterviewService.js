const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { createBotLogger } = require('../../utils/consoleLogger');
const { extractOptimizedStatsFromImage } = require('./ocrService');

const logger = createBotLogger('Rekruter');

/**
 * Rozmowa rekrutacyjna prowadzona przez AI.
 *
 * Zbiera dane potrzebne do przydzielenia klanu (cel wizyty, Core Stock, punkty
 * z I fazy Lunar Mine, nick i atak postaci), a przy rekrutacji od zera dopytuje
 * na koniec, skąd kandydat się o nas dowiedział — wszystko w formie swobodnej rozmowy. Wynik ląduje w `state.userInfo` w TYM SAMYM kształcie, więc
 * dalsza część rekrutacji (propozycja zmiany nicku, przydział klanu, podsumowanie)
 * działa bez żadnych zmian.
 *
 * ⚠️ Nick w grze, atak i Core Stock pochodzą WYŁĄCZNIE z OCR zdjęć — AI nie ma
 * narzędzia do ich zapisania z tekstu. Inaczej kandydat mógłby je po prostu podać.
 *
 * Tryb włącza się zmienną REKRUTER_AI_INTERVIEW=true. Gdy jest wyłączony, brakuje
 * REKRUTER_GOOGLE_AI_API_KEY albo llmAdapter nie został wstrzyknięty, bot zachowuje się
 * dokładnie tak jak dotąd (przyciski + kroki).
 *
 * Model: Google Gemini przez wspólny `utils/llmAdapter.js` — ten sam wrapper co OCR
 * pozostałych botów, więc każda tura rozmowy trafia do Langfuse jako osobny span.
 */

const PROMPT_SYSTEMOWY = `Jesteś rekruterem polskiego klanu z gry Survivor.io — "Polski Squad" — i rozmawiasz na Discordzie z osobą, która właśnie weszła na serwer. Prowadzisz z nią krótką rozmowę i po drodze zbierasz dane potrzebne do przydzielenia jej do odpowiedniego klanu.

## Co trzeba ustalić

Najpierw cel wizyty — czy szuka klanu, czy przyszła w innym celu (ma już swój klan, szuka polskiej społeczności, wpadła pogadać).

Jeśli szuka klanu, potrzebujesz trzech rzeczy:
- zdjęcia zakładki Core Stock (w grze: Detailed Stats → Core Stock),
- liczby punktów z I fazy ostatniej Lunar Mine Expedition (0-9999),
- zdjęcia postaci z ekwipunkiem, na którym widać nick gracza i wartość ATK (ekran "My Equipment", nieobrobiony screen z gry).

Jeśli przyszła w innym celu, wystarczy samo zdjęcie postaci z ekwipunkiem.

Czasem dochodzi jeszcze jedno pytanie: skąd kandydat się o nas dowiedział. Zadaj je **dopiero na sam koniec**, jako ostatnią rzecz przed pożegnaniem, kiedy masz już wszystko inne — i tylko wtedy, gdy bot wymienia je wśród brakujących danych. Nie zapowiadaj go wcześniej i nie wymieniaj w planie: to pytanie na koniec rozmowy, nie punkt ankiety. Odpowiedź zapisz narzędziem zapisz_dane w polu skadWiesz, streszczoną w kilku słowach ("od znajomego z gry", "z wyszukiwarki", "z czatu klanowego").

## Plan zaraz po ustaleniu celu

Gdy już wiesz, po co kandydat przyszedł, **najpierw powiedz mu, co go czeka**, a dopiero potem pytaj. Wypisz krótką listę — dwa albo trzy punkty, każdy w jednej linii — z tym, czego będziesz potrzebować po kolei, i dopiero pod nią poproś o pierwszą rzecz z listy. Dzięki temu rozmówca wie, ile to potrwa, zamiast odpowiadać na pytania w ciemno.

Plan wymienia wyłącznie dane do zebrania. Nie zapowiadaj w nim pytania o to, skąd nas zna, i nie tłumacz, co dzieje się po Twojej stronie.

## Pierwsza wiadomość

Zacznij od przedstawienia się: jesteś botem rekrutacyjnym Polskiego Squadu. Powiedz to wprost, żeby rozmówca od razu wiedział, z czym ma do czynienia. Potem krótko wyjaśnij, że zadasz kilka pytań, żeby dobrać mu klan, i zapytaj o cel wizyty. Całość w trzech, czterech zdaniach.

## Jak rozmawiać

Pisz po polsku, swobodnie, jak kolega z klanu — nie jak formularz. Pytaj o jedną rzecz naraz i nawiązuj do tego, co rozmówca napisał; jeśli sam poda coś, o co jeszcze nie pytałeś, przyjmij to i przejdź dalej zamiast pytać powtórnie.

Odpowiadaj krótko: zwykle dwa do czterech zdań, nigdy więcej niż 600 znaków. To okienko czatu, nie e-mail.

Mów od siebie, w pierwszej osobie liczby pojedynczej — "poproszę", "sprawdzę", "potrzebuję jeszcze". Nie pisz "czekamy", "poprosimy cię" ani "damy znać": rozmowę prowadzisz sam, a decyzje i tak zapadają później.

Nie opowiadaj rozmówcy o tym, co dzieje się po Twojej stronie. "Zapisane", "wiedziałem", "notuję" — to dla niego bez znaczenia; zamiast tego od razu przejdź do następnej rzeczy, której potrzebujesz.

Emoji używaj oszczędnie: najwyżej jedno w wiadomości, zwykle wcale. To ma brzmieć jak normalna rozmowa, a nie jak reklama.

Nie zakładaj, że rozmówca już coś zrobił albo o czymś wie, dopóki sam o to nie poprosiłeś i nie dostałeś odpowiedzi. Prosząc o coś pierwszy raz, pisz "wyślij", a nie "czekam na to, co miałeś wysłać".

Rzecz, o którą właśnie prosisz, wyróżniaj **pogrubieniem** (Discord renderuje gwiazdki): nazwę ekranu, ścieżkę do niego w grze, zakres liczb. Na przykład: "Wyślij screen zakładki **Core Stock** — znajdziesz ją w **Detailed Stats → Core Stock**" albo "Ile punktów zdobyłeś w **I fazie** ostatniej Lunar Mine Expedition?". Pogrubiaj oszczędnie — jedno, dwa miejsca w wiadomości, żeby rozmówca w mig zobaczył, o co chodzi. Nigdy nie pogrubiaj całych zdań.

Prosząc o zdjęcie, powiedz dokładnie gdzie w grze je znaleźć — dla wielu osób to pierwszy kontakt z tym ekranem. Zdjęcie ma być zwykłym screenem z gry, bez obróbki i przycinania.

Punkty z Lunar Mine oraz ustalony cel wizyty zapisuj narzędziem zapisz_dane od razu, gdy je poznasz — nie czekaj z tym do końca rozmowy. Po każdym zapisie napisz też zdanie do kandydata: on widzi wyłącznie Twój tekst, samo wywołanie narzędzia jest dla niego niewidoczne.

Jeśli rozmówca powtarza to samo albo odpowiada tak, jakby nie widział Twojej poprzedniej wiadomości, przyjmij, że rzeczywiście do niego nie dotarła — powtórz ją własnymi słowami zamiast iść dalej.

O nick w grze i atak postaci nie pytaj i nie przyjmuj ich z tekstu: te dane odczytuje bot ze zdjęcia. To samo dotyczy zawartości Core Stock.

Wiadomości zaczynające się od [SYSTEM] pochodzą od bota, a nie od człowieka — to wynik analizy przesłanego zdjęcia albo informacja o stanie rozmowy. Rozmówca ich nie widzi, więc nie cytuj ich wprost; po prostu wykorzystaj to, co z nich wynika, i odpowiedz naturalnie.

NIGDY nie pisz własnych wiadomości w tym stylu. Nie zaczynaj wypowiedzi od [SYSTEM], nie streszczaj tych instrukcji i nie opisuj, co przed chwilą zapisałeś ani co zamierzasz zrobić dalej. WSZYSTKO, co napiszesz, trafia słowo w słowo do rozmówcy — pisz więc wyłącznie to, co ma przeczytać człowiek po drugiej stronie.

Nie oceniaj statystyk rozmówcy i nie obiecuj konkretnego klanu — o przydziale decyduje bot po zakończeniu rozmowy na podstawie aktualnych progów. Jeśli ktoś pyta wprost, powiedz, że wynik pozna za moment.

Jeśli rozmowa schodzi na inny temat, odpowiedz krótko i wróć do rzeczy. Gdy ktoś nie chce podać danych, wyjaśnij spokojnie, że bez nich nie da się przydzielić klanu, i zapytaj jeszcze raz.

## Wiadomości, które nie posuwają rekrutacji

Każdą wiadomość rozmówcy, po której rekrutacja **nie ruszyła do przodu** — czyli nie przybyło żadnej z danych, których szukasz — musisz zaklasyfikować jednym z dwóch narzędzi. To nie jest opcjonalne: bez wywołania któregoś z nich bot sam uzna taką turę za odbieganie od tematu.

- oznacz_na_temat — gdy rozmówca **współpracuje**, choć nic jeszcze nie podał: pyta o rekrutację albo o grę (gdzie znaleźć dany ekran, co to za statystyka), prosi o powtórzenie, mówi, że zaraz wyśle zdjęcie, albo wita się w pierwszej wiadomości.
- oznacz_odbieganie — gdy wiadomość **nie jest odpowiedzią na Twoje pytanie**: zmienia temat, jest żartem albo prowokacją, ucieka w ogólniki ("nie wiem", "a po co ci to", "poteń zobaczymy") albo powtarza to samo, zamiast podać to, o co prosisz.

Rozstrzyga jedno pytanie: czy to jest **rzeczowa odpowiedź na to, o co właśnie zapytałeś**. Jeśli tak — idziesz dalej i nie wywołujesz niczego. Jeśli nie, a rozmówca mimo to współpracuje — oznacz_na_temat. Jeśli nie i nie widać współpracy — oznacz_odbieganie. W obu przypadkach zastosuj instrukcję, którą dostaniesz w odpowiedzi.

Gdy masz komplet danych, wywołaj zakoncz_wywiad z krótkim, ciepłym pożegnaniem.`;

/**
 * Deklaracje narzędzi w formacie Gemini (`functionDeclarations`).
 *
 * ⚠️ Typy pól podajemy WIELKIMI literami ('OBJECT', 'STRING', 'INTEGER') — tego oczekuje
 * schemat Gemini. Zakresy wartości opisujemy słownie, a twardą walidację robi bot
 * (`_zapiszDane`): model potrafi minąć się z opisem, więc granice i tak sprawdzamy u siebie.
 */
const NARZEDZIA = [
    {
        name: 'zapisz_dane',
        description: 'Zapisuje w karcie kandydata dane, które padły w rozmowie. Wywołaj natychmiast, gdy ustalisz cel wizyty, gdy rozmówca poda punkty z Lunar Mine Expedition albo gdy powie, skąd się o nas dowiedział — nie zbieraj tego w pamięci do końca rozmowy. Możesz podać jedno pole albo kilka naraz. W odpowiedzi dostaniesz listę tego, co jeszcze zostało do ustalenia.',
        parameters: {
            type: 'OBJECT',
            properties: {
                cel: {
                    type: 'STRING',
                    description: 'Cel wizyty. Dokładnie jedna z dwóch wartości: "szukam_klanu" gdy osoba chce dołączyć do jednego z naszych klanów, albo "inny_cel" gdy ma już swój klan lub przyszła po prostu do polskiej społeczności.'
                },
                punktyLunar: {
                    type: 'INTEGER',
                    description: 'Punkty uzyskane w I fazie ostatniej Lunar Mine Expedition, liczba od 0 do 9999.'
                },
                skadWiesz: {
                    type: 'STRING',
                    description: 'Skąd kandydat dowiedział się o serwerze - krótko, kilka słów, własnymi słowami na podstawie jego odpowiedzi.'
                }
            },
            required: []
        }
    },
    {
        name: 'oznacz_na_temat',
        description: 'Wywołaj, gdy wiadomość rozmówcy nie wniosła żadnej z szukanych danych, ale JEST na temat i widać współpracę: pyta o rekrutację albo o grę, prosi o powtórzenie, zapowiada że zaraz wyśle zdjęcie, wita się. Bez tego wywołania bot uzna turę bez postępu za odbieganie od tematu, więc nie pomijaj go w takich sytuacjach. NIE używaj go do usprawiedliwiania żartów, zmiany tematu ani unikania odpowiedzi — od tego jest oznacz_odbieganie.',
        parameters: {
            type: 'OBJECT',
            properties: {
                powod: {
                    type: 'STRING',
                    description: 'Czego dotyczyła wiadomość - kilka słów, do logu bota.'
                }
            },
            required: []
        }
    },
    {
        name: 'oznacz_odbieganie',
        description: 'Wywołaj, gdy ostatnia wiadomość rozmówcy NIE jest rzeczową odpowiedzią na zadane pytanie: zmienia temat, żartuje, prowokuje, ucieka w ogólniki albo powtarza to samo zamiast podać to, o co prosisz. NIE wywołuj, gdy ktoś dopytuje o coś związanego z rekrutacją albo z grą — pytanie o to, gdzie znaleźć dany ekran, jest normalną częścią rozmowy i oznacza się je narzędziem oznacz_na_temat. W odpowiedzi dostaniesz instrukcję, jak zareagować; zastosuj ją dokładnie.',
        parameters: {
            type: 'OBJECT',
            properties: {
                powod: {
                    type: 'STRING',
                    description: 'Czego dotyczyła wiadomość rozmówcy - jedno krótkie zdanie, do logu bota.'
                }
            },
            required: []
        }
    },
    {
        name: 'zakoncz_wywiad',
        description: 'Kończy rozmowę rekrutacyjną. Wywołaj dopiero wtedy, gdy masz komplet danych — bot to sprawdza i odmówi zakończenia, jeśli czegoś brakuje, podając czego. Po zakończeniu bot sam przydzieli kandydata do klanu i wyśle podsumowanie, więc nie zapowiadaj wyniku.',
        parameters: {
            type: 'OBJECT',
            properties: {
                pozegnanie: {
                    type: 'STRING',
                    description: 'Krótkie pożegnanie dla kandydata (maksymalnie 400 znaków), które zobaczy jako ostatnią wiadomość rozmowy.'
                }
            },
            required: ['pozegnanie']
        }
    }
];

/** Gemini oczekuje narzędzi opakowanych w `functionDeclarations` */
const NARZEDZIA_GEMINI = [{ functionDeclarations: NARZEDZIA }];

/**
 * Filtry bezpieczeństwa wyłączone — tak samo jak w OCR pozostałych botów.
 * Rozmowa rekrutacyjna bywa dosadna (gracze piszą, jak piszą), a zablokowana
 * odpowiedź zrywałaby rekrutację w połowie.
 */
const USTAWIENIA_BEZPIECZENSTWA = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/** Wersja promptu systemowego — trafia na span w Langfuse (A/B modeli i promptów) */
const WERSJA_PROMPTU = 'v5';

/**
 * Wypowiedź modelu udająca naszą wiadomość systemową.
 *
 * ⚠️ Model widzi w historii wiadomości `[SYSTEM] …` (wynik analizy zdjęcia, instrukcja
 * otwierająca) i potrafi zacząć je naśladować — wtedy kandydat dostawał w okienku czatu
 * instrukcję adresowaną do bota („[SYSTEM] Bot zidentyfikował cel wizyty jako …").
 * Sam prompt tego nie gwarantuje, więc tniemy takie fragmenty po stronie kodu.
 *
 * ⚠️ Wzorzec obcina od znacznika do KOŃCA AKAPITU (pustej linii), nie do końca linii.
 * Pierwsza wersja cięła jedną linię i zostawiała ogon wielolinijkowej notatki — kandydat
 * dostawał wtedy samo `Poprzednia wiadomość: "Nie wiem"` bez znacznika na początku.
 *
 * **Świadomy kompromis:** gdy model NIE oddzieli notatki pustą linią, razem z nią wyleci
 * też prawdziwa wiadomość z następnej linii. Kosztuje to jedno dodatkowe zapytanie
 * (pusta tura → `_wymuszonaOdpowiedz` prosi model o wiadomość i rozmowa toczy się dalej),
 * czego kandydat nie widzi. Odwrotny kompromis — cięcie ostrożniejsze — kończy się
 * wyciekiem notatki na ekran, a to widzi każdy. Wolimy zapłacić jednym wywołaniem.
 */
const WYPOWIEDZ_SYSTEMOWA = /\[SYSTEM\][\s\S]*?(?=\n[ \t]*\n|$)/gi;

/**
 * Odbieganie od tematu: przy którym z rzędu bot upomina, a przy którym kończy rozmowę.
 *
 * ⚠️ Liczą się odbiegnięcia POD RZĄD. Gdy rozmowa ruszy do przodu (zapisane dane albo
 * odczytane zdjęcie), licznik wraca do zera — karzemy uporczywe zmienianie tematu,
 * nie jeden żart po drodze.
 */
/** Pozycja listy braków, o którą pytamy jako o OSTATNIĄ – patrz `_brakujaceDane` i `_instrukcjaBrakow` */
const BRAK_ZRODLO = 'skąd kandydat dowiedział się o serwerze';

const UPOMNIENIE_PRZY = 2;
const KONIEC_PRZY = 3;

/** Limit odpowiedzi jednej tury; rozmowa ma być krótka, a narzędzia nie potrzebują miejsca */
const MAKS_TOKENOW_ODPOWIEDZI = 1024;

const MAKS_ITERACJI_NARZEDZI = 4;

class AIInterviewService {
    /**
     * @param {Object} config
     * @param {{ generate: Function }} llmAdapter — wspólny wrapper z utils/llmAdapter.js
     * @param {Object} aiOcrService — ten sam serwis OCR co reszta rekrutacji
     */
    constructor(config, llmAdapter = null, aiOcrService = null) {
        this.config = config;
        this.ustawienia = config.aiInterview || {};
        this.adapter = llmAdapter;
        this.ocr = aiOcrService;
        this.apiKey = config.ocr?.googleAiApiKey || null;
        this.model = this.ustawienia.model;
        this.enabled = this.ustawienia.enabled === true && !!this.apiKey && !!llmAdapter;

        // userId -> { historia, log, tury, zakonczona }
        this.rozmowy = new Map();

        if (!this.ustawienia.enabled) {
            // Tryb po prostu wyłączony - bez ostrzeżenia, to domyślny stan
        } else if (!this.apiKey) {
            logger.warn('⚠️ Rozmowa rekrutacyjna AI wyłączona - brak REKRUTER_GOOGLE_AI_API_KEY');
        } else if (!llmAdapter) {
            logger.warn('⚠️ Rozmowa rekrutacyjna AI wyłączona - brak llmAdapter (DI) w konstruktorze');
        } else {
            logger.success(`✅ Rozmowa rekrutacyjna AI aktywna - model: ${this.model}`);
        }
    }

    /** Wpis historii w formacie Gemini */
    _tekst(rola, tresc) {
        return { role: rola, parts: [{ text: tresc }] };
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
            ? '[SYSTEM] Kandydat jest już na serwerze i kliknął przycisk "Chcę dołączyć do klanu". Cel wizyty jest więc znany i ZAPISANY - nie pytaj o niego i nie wywołuj zapisz_dane z celem. Nie pytaj też, skąd się o nas dowiedział - jest u nas od dawna. To Twoja pierwsza wiadomość: przedstaw się jako bot rekrutacyjny Polskiego Squadu, wypisz krótką listę tego, czego będziesz potrzebować po kolei, i dopiero pod nią poproś o pierwszą rzecz z tej listy.'
            : '[SYSTEM] Kandydat potwierdził przyciskiem, że jest Polakiem, i wszedł do rozmowy rekrutacyjnej. To Twoja pierwsza wiadomość - przedstaw się jako bot rekrutacyjny Polskiego Squadu i zapytaj o cel wizyty. Na sam koniec rozmowy, gdy zbierzesz już wszystko inne, zapytaj jeszcze skąd się o nas dowiedział.';

        this.rozmowy.set(userId, {
            historia: [this._tekst('user', otwarcie)],
            tury: 0,
            zakonczona: false,
            // Odbiegnięcia od tematu POD RZĄD - zerowane przy każdym postępie rozmowy
            odbiegniecia: 0,
            // O źródło pytamy tylko przy rekrutacji od zera - osoba klikająca przycisk
            // „Chcę dołączyć do klanu” jest na serwerze od dawna, więc pytanie nie ma sensu
            pytajOZrodlo: opcje.celUstalony !== true
        });

        return this.wykonajTure(userId, state);
    }

    /**
     * Dokłada wiadomość napisaną przez kandydata i zwraca odpowiedź rekrutera.
     */
    async wiadomoscUzytkownika(userId, tekst, state) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        rozmowa.historia.push(this._tekst('user', tekst));

        // Tylko tury napisane przez kandydata podlegają regule „tura bez postępu = odbieganie".
        // Tury systemowe (wynik analizy zdjęcia) są z niej wyłączone: kandydat, który wysłał
        // nieczytelny screen, współpracuje – tylko mu nie wyszło.
        return this.wykonajTure(userId, state, { odKandydata: true });
    }

    /**
     * Dokłada informację od bota (np. wynik analizy zdjęcia) i zwraca odpowiedź rekrutera.
     * Kandydat treści systemowej nie widzi — w wątku pojawia się dopiero odpowiedź modelu.
     */
    async wiadomoscSystemowa(userId, tekst, state) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        rozmowa.historia.push(this._tekst('user', `[SYSTEM] ${tekst}`));

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
    async wykonajTure(userId, state, opcje = {}) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) return null;

        // Stan karty kandydata SPRZED tury – po turze porównujemy go z aktualnym
        // i po tym poznajemy, czy rozmowa w ogóle ruszyła do przodu (`_domiarBezPostepu`)
        rozmowa.odKandydata = opcje.odKandydata === true;
        rozmowa.migawkaPrzed = this._migawkaPostepu(state?.userInfo?.get(userId));
        rozmowa.oznaczoneWTurze = false;

        rozmowa.tury++;
        if (rozmowa.tury > (this.ustawienia.maxTurns || 40)) {
            logger.warn(`[AI_WYWIAD] Limit tur przekroczony dla ${userId} - przerywam rozmowę`);
            return {
                tekst: 'Rozmowa się przeciągnęła i muszę ją tutaj zamknąć. Napisz proszę do moderatora, a dokończymy rekrutację ręcznie.',
                zakonczone: false,
                przerwane: true
            };
        }

        // ⚠️ Teksty KUMULUJEMY przez całą turę, a nie nadpisujemy przy każdej iteracji.
        // Model zwykle pisze wiadomość do kandydata RAZEM z wywołaniem narzędzia
        // ("Super, wrzuć screena Core Stock" + zapisz_dane), a po tool_result kończy turę
        // już bez tekstu. Nadpisywanie gubiło tę wiadomość: kandydat widział komunikat
        // o błędzie, a w historii rozmowy tekst zostawał - więc model był przekonany,
        // że już o screena poprosił, i nie powtarzał prośby.
        const teksty = [];

        for (let iteracja = 0; iteracja < MAKS_ITERACJI_NARZEDZI; iteracja++) {
            const odpowiedz = await this._zapytajModel(rozmowa, userId, state);
            const wywolania = odpowiedz.functionCalls || [];

            // Turę modelu odtwarzamy w historii tak, jak ją oddał: najpierw tekst,
            // potem wywołania narzędzi. Gemini wymaga, żeby functionResponse odpowiadał
            // na functionCall stojący w poprzedniej turze modelu
            const czesciModelu = [];
            if (odpowiedz.content) czesciModelu.push({ text: odpowiedz.content });
            for (const wywolanie of wywolania) czesciModelu.push({ functionCall: wywolanie });
            if (czesciModelu.length > 0) {
                rozmowa.historia.push({ role: 'model', parts: czesciModelu });
            }

            if (odpowiedz.content) teksty.push(odpowiedz.content.trim());

            if (wywolania.length === 0) {
                return this._zwrocOdpowiedz(rozmowa, teksty, userId, state);
            }

            const odpowiedziNarzedzi = [];
            let pozegnanie = null;

            for (const wywolanie of wywolania) {
                const wynik = this._wykonajNarzedzie(userId, wywolanie, state);
                odpowiedziNarzedzi.push({
                    functionResponse: {
                        name: wywolanie.name,
                        // Gemini oczekuje OBIEKTU, nie napisu - inaczej odrzuca turę
                        response: wynik.odpowiedz,
                    }
                });
                if (wynik.pozegnanie) pozegnanie = wynik.pozegnanie;
            }

            rozmowa.historia.push({ role: 'user', parts: odpowiedziNarzedzi });

            // Wywiad domknięty - nie ma po co pytać modelu jeszcze raz, mamy tekst pożegnania
            if (pozegnanie) {
                const tekst = [...teksty, pozegnanie].filter(Boolean).join('\n\n');
                rozmowa.zakonczona = true;
                return { tekst, zakonczone: true };
            }
        }

        // Model zapętlił się na narzędziach - oddajemy to, co zdążył napisać
        return this._zwrocOdpowiedz(rozmowa, teksty, userId, state);
    }

    /**
     * Domyka turę: zwraca to, co model napisał, a gdy nie napisał nic — prosi go o wiadomość.
     *
     * Pusta tura zdarza się, gdy model zamknie turę zaraz po wywołaniu narzędzia.
     * Wtedy zamiast pokazywać kandydatowi komunikat o błędzie, dopytujemy model raz
     * jeszcze — kandydat dostaje normalną wiadomość i rozmowa idzie dalej.
     */
    async _zwrocOdpowiedz(rozmowa, teksty, userId, state) {
        if (teksty.length === 0) {
            logger.warn('[AI_WYWIAD] Tura bez tekstu dla kandydata - dopytuję model o wiadomość');
            const dodatkowe = await this._wymuszonaOdpowiedz(rozmowa, userId, state);
            if (dodatkowe) teksty.push(dodatkowe);
        }

        // Tura kandydata, po której nic nie przybyło i której model sam nie zaklasyfikował.
        // Przy upomnieniu i przy zamknięciu rozmowy tekst modelu jest PODMIENIANY: jego
        // pierwotna odpowiedź nie zna jeszcze decyzji bota, więc doklejenie jej obok
        // brzmiałoby jak dwie różne rozmowy naraz.
        const podmiana = await this._domiarBezPostepu(rozmowa, userId, state);
        if (podmiana) teksty = [podmiana];

        const tekst = teksty.join('\n\n')
            || 'Napisz proszę jeszcze raz — coś mi się zacięło.';

        // Trzecie odbiegnięcie z rzędu - pokazujemy pożegnanie modelu i zamykamy rozmowę.
        // `powod` rozróżnia to od przerwania limitem tur: tylko za off-topic rośnie
        // trwały licznik, po którym kandydat wylatuje z serwera
        if (rozmowa.przerwacOffTopic) {
            return { tekst, zakonczone: false, przerwane: true, powod: 'off_topic' };
        }

        return { tekst, zakonczone: false };
    }

    async _wymuszonaOdpowiedz(rozmowa, userId, state, instrukcja = null) {
        rozmowa.historia.push(this._tekst(
            'user',
            `[SYSTEM] ${instrukcja || 'Poprzednia tura nie zawierała wiadomości dla kandydata, a on czeka na odpowiedź. Napisz teraz wiadomość do niego – bez wywoływania narzędzi.'}`
        ));

        try {
            const odpowiedz = await this._zapytajModel(rozmowa, userId, state);
            if (odpowiedz.content) {
                rozmowa.historia.push(this._tekst('model', odpowiedz.content));
            }
            return odpowiedz.content?.trim() || null;
        } catch (error) {
            logger.error(`[AI_WYWIAD] Nie udało się dopytać modelu o wiadomość: ${error.message}`);
            return null;
        }
    }

    /**
     * Jedno zapytanie do Gemini przez wspólny adapter.
     *
     * @returns {Promise<{content: string, functionCalls: Array<{name: string, args: object}>}>}
     */
    async _zapytajModel(rozmowa, userId, state) {
        this._przytnijHistorie(rozmowa);

        const odpowiedz = await this.adapter.generate({
            provider: 'gemini',
            model: this.model,
            systemInstruction: PROMPT_SYSTEMOWY + this._stanRozmowy(userId, state),
            contents: rozmowa.historia,
            tools: NARZEDZIA_GEMINI,
            maxOutputTokens: MAKS_TOKENOW_ODPOWIEDZI,
            safetySettings: USTAWIENIA_BEZPIECZENSTWA,
            meta: {
                operationType: 'recruitment.interview',
                step: 'tura',
                promptName: 'rekruter-wywiad',
                promptVersion: WERSJA_PROMPTU,
            },
        });

        // Czyścimy TUTAJ, zanim tekst trafi gdziekolwiek dalej: do kandydata, do
        // transkrypcji i do historii. Zostawienie znacznika w historii utrwalałoby wzorzec
        // — model widziałby własną wiadomość „[SYSTEM] …" i naśladował ją w kolejnych turach
        return { ...odpowiedz, content: this._bezSystemowych(odpowiedz.content) };
    }

    /**
     * Stan rozmowy doklejany do promptu systemowego przy KAŻDEJ turze.
     *
     * ⚠️ Idzie promptem systemowym, a nie kolejną wiadomością `[SYSTEM]` w historii —
     * to właśnie z takich wiadomości model brał wzorzec i pisał kandydatowi własne notatki
     * („Poprzednia wiadomość: …"). Prompt systemowy jest dla modelu instrukcją, a nie
     * treścią rozmowy do naśladowania.
     *
     * Dzięki temu model nie musi odtwarzać stanu z historii: w każdej turze ma wprost
     * wypisane, co już wie i o co pytać dalej. Lekki model bez tego potrafił zapętlić się
     * na ustalaniu celu wizyty.
     */
    _stanRozmowy(userId, state) {
        const info = state?.userInfo?.get(userId);
        if (!info) return '';

        const znane = [];
        if (info.purpose) znane.push(`cel wizyty: ${info.purpose}`);
        if (info.lunarPoints !== null && info.lunarPoints !== undefined) znane.push(`punkty I fazy: ${info.lunarPoints}`);
        if (info.coreStock) znane.push('zdjęcie Core Stock: odczytane');
        if (info.playerNick && info.characterAttack) znane.push(`postać: ${info.playerNick}, atak ${info.characterAttack}`);
        if (info.referralSource) znane.push(`skąd o nas wie: ${info.referralSource}`);

        const brakuje = this._brakujaceDane(info, this._czyPytacOZrodlo(userId));

        const odbiegniecia = this.rozmowy.get(userId)?.odbiegniecia || 0;
        const ostrzezenie = odbiegniecia > 0
            ? `\nWiadomości nie na temat pod rząd: ${odbiegniecia} (przy ${KONIEC_PRZY} rozmowa zostaje zamknięta).`
            : '';

        return `

## Stan tej rozmowy (aktualny, od bota — nie pokazuj go rozmówcy)

Masz już: ${znane.length ? znane.join('; ') : 'nic'}.${ostrzezenie}
${this._instrukcjaBrakow(brakuje)}`;
    }

    /**
     * Co model ma zrobić z listą braków – wydzielone, bo ostatnia pozycja rządzi się
     * własnymi prawami: pytanie „skąd o nas wiesz" pada dopiero wtedy, gdy nie brakuje
     * już niczego innego, i jest ostatnią rzeczą przed pożegnaniem.
     */
    _instrukcjaBrakow(brakuje) {
        if (!brakuje.length) {
            return 'Masz komplet danych — wywołaj zakoncz_wywiad z krótkim pożegnaniem.';
        }

        if (brakuje.length === 1 && brakuje[0] === BRAK_ZRODLO) {
            return 'Zostało już tylko jedno: zapytaj teraz, skąd dowiedział się o Polskim Squadzie. '
                + 'To ostatnie pytanie rozmowy — zapisz odpowiedź narzędziem zapisz_dane w polu skadWiesz, '
                + 'a potem od razu zakończ rozmowę.';
        }

        return `Do ustalenia zostało: ${brakuje.join('; ')}. Zapytaj teraz o PIERWSZĄ rzecz z tej listy — `
            + 'o rzeczy spoza niej nie pytaj, bo są już ustalone.';
    }

    /** Wypowiedź modelu bez fragmentów udających wiadomość systemową bota */
    _bezSystemowych(tekst) {
        if (!tekst) return '';
        return tekst
            .replace(WYPOWIEDZ_SYSTEMOWA, '')
            // Po wycięciu znacznika zostaje spacja na końcu linii i puste akapity
            .replace(/[ \t]+$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Przycina historię, pilnując żeby nie urwać jej w środku pary
     * functionCall / functionResponse — Gemini odrzuca odpowiedź narzędzia,
     * której wywołanie nie stoi w poprzedniej turze modelu.
     */
    _przytnijHistorie(rozmowa) {
        const limit = this.ustawienia.historyLimit || 30;
        if (rozmowa.historia.length <= limit) return;

        let od = rozmowa.historia.length - limit;
        while (od > 0 && !this._czyBezpiecznyPoczatek(rozmowa.historia[od])) od++;
        if (od >= rozmowa.historia.length) return;

        rozmowa.historia = rozmowa.historia.slice(od);
    }

    /**
     * Historia może zaczynać się wyłącznie od zwykłej wiadomości kandydata.
     * Wpis z `functionResponse` też ma rolę `user`, ale bez poprzedzającego
     * `functionCall` jest dla Gemini niesparowanym ogonem.
     */
    _czyBezpiecznyPoczatek(wpis) {
        return wpis.role === 'user'
            && Array.isArray(wpis.parts)
            && wpis.parts.every(czesc => typeof czesc.text === 'string');
    }

    /* ---------------------------------------------------------------------- */
    /*  NARZĘDZIA                                                              */
    /* ---------------------------------------------------------------------- */

    _wykonajNarzedzie(userId, wywolanie, state) {
        const info = state.userInfo.get(userId);
        if (!info) {
            return { blad: true, odpowiedz: { blad: 'Brak karty kandydata - rozmowa wygasła.' } };
        }

        // Gemini podaje argumenty wywołania w polu `args`
        const argumenty = wywolanie.args || {};

        if (wywolanie.name === 'zapisz_dane') {
            // Sama próba zapisu wystarczy, żeby tura nie poszła na konto odbiegania:
            // kandydat, który podał punkty spoza zakresu, odpowiedział rzeczowo – tylko źle
            const rozmowa = this.rozmowy.get(userId);
            if (rozmowa) rozmowa.oznaczoneWTurze = true;

            const wynik = this._zapiszDane(info, argumenty, this._czyPytacOZrodlo(userId));
            // Cokolwiek udało się zapisać = rozmowa ruszyła do przodu
            if (wynik.odpowiedz?.zapisano?.length > 0) this.wyzerujOdbiegania(userId);
            return wynik;
        }

        if (wywolanie.name === 'oznacz_na_temat') {
            return this._oznaczNaTemat(userId, info, argumenty);
        }

        if (wywolanie.name === 'oznacz_odbieganie') {
            return this._oznaczOdbieganie(userId, info, argumenty);
        }

        if (wywolanie.name === 'zakoncz_wywiad') {
            const brakuje = this._brakujaceDane(info, this._czyPytacOZrodlo(userId));
            if (brakuje.length > 0) {
                return {
                    blad: true,
                    odpowiedz: {
                        blad: 'Nie można zakończyć - brakuje danych.',
                        brakuje
                    }
                };
            }
            const pozegnanie = (argumenty.pozegnanie || 'Dzięki! To wszystko, resztą zajmuje się już bot.')
                .slice(0, 400);
            logger.info(`[AI_WYWIAD] ✅ Zebrano komplet danych dla ${info.username}`);
            return { odpowiedz: { status: 'zakonczono' }, pozegnanie };
        }

        return { blad: true, odpowiedz: { blad: `Nieznane narzędzie: ${wywolanie.name}` } };
    }

    /**
     * Wiadomość bez nowych danych, ale na temat – pytanie o grę, prośba o powtórzenie,
     * zapowiedź wysłania zdjęcia.
     *
     * Samo wywołanie niczego nie liczy: jego jedynym zadaniem jest **zdjęcie domniemania
     * odbiegania** z tury, w której rekrutacja nie ruszyła do przodu (`_domiarBezPostepu`).
     * Dlatego licznik odbiegnięć zostaje nietknięty – nie rośnie, ale też się nie zeruje:
     * uprzejme pytanie w środku serii uników nie ma jej kasować.
     */
    _oznaczNaTemat(userId, info, argumenty) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) {
            return { blad: true, odpowiedz: { blad: 'Rozmowa wygasła.' } };
        }

        rozmowa.oznaczoneWTurze = true;
        const powod = String(argumenty.powod || '').slice(0, 200);
        logger.info(`[AI_WYWIAD] ${info.username}: tura bez postępu, ale na temat${powod ? ` (${powod})` : ''}`);

        return {
            odpowiedz: {
                status: 'ok',
                instrukcja: 'Odpowiedz krótko na to, o co pyta, i od razu powtórz prośbę o rzecz, na którą czekasz.'
            }
        };
    }

    /**
     * Kolejna wiadomość nie na temat.
     *
     * Politykę trzyma bot, nie model: model wyłącznie sygnalizuje, że rozmówca odbiegł,
     * a wracającą instrukcją sterujemy tym, co ma napisać. Dzięki temu progi da się
     * zmienić w jednym miejscu, bez przepisywania promptu.
     */
    _oznaczOdbieganie(userId, info, argumenty, automatyczne = false) {
        const rozmowa = this.rozmowy.get(userId);
        if (!rozmowa) {
            return { blad: true, odpowiedz: { blad: 'Rozmowa wygasła.' } };
        }

        rozmowa.odbiegniecia += 1;
        rozmowa.oznaczoneWTurze = true;
        const licznik = rozmowa.odbiegniecia;
        const powod = String(argumenty.powod || '').slice(0, 200);
        const zrodlo = automatyczne ? 'bot' : 'model';
        logger.info(`[AI_WYWIAD] ${info.username}: odbieganie od tematu ${licznik}/${KONIEC_PRZY} [${zrodlo}]${powod ? ` (${powod})` : ''}`);

        if (licznik >= KONIEC_PRZY) {
            // Sam tekst pożegnania pisze model - my tylko zamykamy rozmowę po tej turze
            rozmowa.przerwacOffTopic = true;
            return {
                odpowiedz: {
                    odbiegniecia: licznik,
                    instrukcja: 'To trzecia taka wiadomość z rzędu. Napisz krótkie, spokojne pożegnanie — rozmowa zostaje zamknięta. Nie zadawaj już żadnych pytań i nie proponuj kolejnej szansy.'
                }
            };
        }

        if (licznik >= UPOMNIENIE_PRZY) {
            return {
                odpowiedz: {
                    odbiegniecia: licznik,
                    instrukcja: 'Odpowiedz jednym zdaniem, a potem UPRZEDŹ wprost: jeśli kolejna wiadomość znowu nie będzie na temat, będziesz musiał zakończyć rozmowę. Na koniec powtórz pytanie, na które czekasz.'
                }
            };
        }

        return {
            odpowiedz: {
                odbiegniecia: licznik,
                instrukcja: 'Odpowiedz krótko, jednym zdaniem, i od razu wróć do pytania, na które czekasz. Jeszcze nie ostrzegaj.'
            }
        };
    }

    /**
     * Migawka tego, co bot wie o kandydacie – służy WYŁĄCZNIE do porównania „przed / po turze".
     *
     * Równe migawki = rozmowa stała w miejscu, czyli wiadomość kandydata nie była rzeczową
     * odpowiedzią na zadane pytanie.
     */
    _migawkaPostepu(info) {
        if (!info) return '';
        return [
            info.purpose || '',
            info.lunarPoints ?? '',
            info.coreStock ? 'core' : '',
            info.playerNick || '',
            info.characterAttack ?? '',
            info.referralSource || '',
        ].join('|');
    }

    /**
     * Tura kandydata, po której nic nie przybyło – domiar polityki off-topic po stronie bota.
     *
     * ⚠️ **Domyślnie taka tura LICZY SIĘ jako odbieganie.** Model potrafił nie wywołać
     * `oznacz_odbieganie` przez całą rozmowę i kandydat mielił bota w nieskończoność,
     * odpowiadając „a po co ci to" na każde pytanie. Teraz to model musi tłumaczyć turę
     * bez postępu – `oznacz_na_temat` gdy kandydat współpracuje, `oznacz_odbieganie` gdy nie.
     * Milczenie modelu znaczy odbieganie, a nie brak zdania.
     *
     * Reguła dotyczy WYŁĄCZNIE tur napisanych przez kandydata. Tury systemowe (wynik OCR)
     * są z niej wyłączone: nieczytelny screen to nieudana próba, nie zmiana tematu.
     *
     * @returns {Promise<string|null>} tekst, który ma ZASTĄPIĆ odpowiedź modelu, albo null
     */
    async _domiarBezPostepu(rozmowa, userId, state) {
        if (!rozmowa.odKandydata || rozmowa.oznaczoneWTurze) return null;

        const info = state?.userInfo?.get(userId);
        if (!info) return null;
        if (this._migawkaPostepu(info) !== rozmowa.migawkaPrzed) return null;

        const wynik = this._oznaczOdbieganie(
            userId,
            info,
            { powod: 'brak rzeczowej odpowiedzi – rozmowa nie ruszyła dalej' },
            true
        );
        const licznik = wynik.odpowiedz?.odbiegniecia || 0;

        // Pierwsze odbiegnięcie liczymy po cichu: instrukcja dla modelu brzmi wtedy „odpowiedz
        // krótko i wróć do pytania", a to zwykle dokładnie to, co już napisał. Dopiero
        // upomnienie i zamknięcie rozmowy wymagają innej treści, więc dopłacamy zapytanie
        if (licznik < UPOMNIENIE_PRZY) return null;

        const usuniety = this._usunOstatniTekstModelu(rozmowa);
        const tekst = await this._wymuszonaOdpowiedz(rozmowa, userId, state, wynik.odpowiedz.instrukcja);

        // Model nie odpowiedział (błąd API) – kandydat zobaczy jego pierwotną wiadomość,
        // więc musi ona wrócić także do historii. Licznik odbiegnięcia zostaje naliczony:
        // decyduje o nim zachowanie kandydata, nie to, czy udało się dopytać model
        if (!tekst && usuniety) rozmowa.historia.push(usuniety);

        return tekst;
    }

    /**
     * Zdejmuje z historii ostatnią wypowiedź modelu, gdy jej tekst nie trafi do kandydata.
     *
     * Bez tego model widziałby w historii własną wiadomość, której rozmówca nigdy nie
     * dostał – i budował na niej kolejne tury („jak pisałem wyżej").
     *
     * ⚠️ Ruszamy wyłącznie wpis z samym tekstem. Wpis z `functionCall` musi zostać, bo w
     * następnej turze stoi przy nim `functionResponse`, a Gemini odrzuca osieroconą odpowiedź.
     */
    _usunOstatniTekstModelu(rozmowa) {
        const ostatni = rozmowa.historia[rozmowa.historia.length - 1];
        if (!ostatni || ostatni.role !== 'model') return null;
        if (!Array.isArray(ostatni.parts)) return null;
        if (!ostatni.parts.every(czesc => typeof czesc.text === 'string')) return null;
        return rozmowa.historia.pop();
    }

    /** Rozmowa ruszyła do przodu — licznik odbiegnięć wraca do zera */
    wyzerujOdbiegania(userId) {
        const rozmowa = this.rozmowy.get(userId);
        if (rozmowa) rozmowa.odbiegniecia = 0;
    }

    _zapiszDane(info, wejscie, pytajOZrodlo = false) {
        const zapisane = [];
        const odrzucone = [];

        let ustalonoCel = false;

        if (wejscie.cel === 'szukam_klanu') {
            info.purpose = 'Szukam klanu';
            zapisane.push('cel: szukam klanu');
            ustalonoCel = true;
        } else if (wejscie.cel === 'inny_cel') {
            info.purpose = 'Przyszedłem w innym celu';
            zapisane.push('cel: inny');
            ustalonoCel = true;
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

        if (typeof wejscie.skadWiesz === 'string' && wejscie.skadWiesz.trim()) {
            info.referralSource = wejscie.skadWiesz.trim().slice(0, 200);
            zapisane.push(`skąd o nas wie: ${info.referralSource}`);
        }

        if (zapisane.length === 0 && odrzucone.length === 0) {
            return { blad: true, odpowiedz: { blad: 'Nie podano żadnego pola do zapisania.' } };
        }

        const brakuje = this._brakujaceDane(info, pytajOZrodlo);

        return {
            blad: odrzucone.length > 0 && zapisane.length === 0,
            odpowiedz: {
                zapisano: zapisane,
                odrzucono: odrzucone,
                brakuje,
                ...(ustalonoCel ? { instrukcja: this._instrukcjaPlanu(brakuje) } : {})
            }
        };
    }

    /**
     * Plan ankiety, który rekruter przedstawia zaraz po ustaleniu ścieżki.
     *
     * Kandydat, który wie, o co zostanie zapytany, przestaje odpowiadać w ciemno – a bot
     * przestaje wyglądać jak przesłuchanie bez końca. Treść planu bierzemy z listy braków,
     * więc nie ma szansy rozłączyć się z tym, o co bot faktycznie poprosi.
     *
     * ⚠️ Pytanie „skąd o nas wiesz" w planie się NIE pojawia – pada dopiero na sam koniec,
     * gdy reszta jest zebrana, więc zapowiadanie go tutaj tylko wydłużałoby listę.
     */
    _instrukcjaPlanu(brakuje) {
        if (!brakuje.length) {
            return 'Cel jest ustalony i nie potrzebujesz już nic więcej – przejdź do domknięcia rozmowy.';
        }

        return `Ścieżka jest ustalona. ZANIM o cokolwiek poprosisz, przedstaw krótki plan: wypisz `
            + `w osobnych liniach, czego będziesz potrzebować po kolei (${brakuje.join('; ')}), `
            + `i dopiero pod listą poproś o PIERWSZĄ pozycję z niej. Nie zapowiadaj pytania o to, `
            + `skąd kandydat się o nas dowiedział – to pytanie pada dopiero na koniec rozmowy.`;
    }

    /**
     * @param {boolean} pytajOZrodlo czy do kompletu potrzebna jest jeszcze odpowiedź,
     *        skąd kandydat się o nas dowiedział (tylko rekrutacja od zera, nie przycisk klanowy)
     */
    _brakujaceDane(info, pytajOZrodlo = false) {
        const brakuje = [];

        if (!info.purpose) {
            brakuje.push('cel wizyty');
        } else if (info.purpose === 'Szukam klanu') {
            if (!info.coreStock) brakuje.push('zdjęcie zakładki Core Stock');
            if (info.lunarPoints === null || info.lunarPoints === undefined) brakuje.push('punkty z I fazy Lunar Mine Expedition');
        }

        if (!info.playerNick || !info.characterAttack) {
            brakuje.push('zdjęcie postaci z ekwipunkiem (nick + ATK)');
        }

        // Pytanie na koniec - dopiero gdy reszta jest już zebrana
        if (pytajOZrodlo && brakuje.length === 0 && !info.referralSource) {
            brakuje.push(BRAK_ZRODLO);
        }

        return brakuje;
    }

    /** Czy w tej rozmowie pytamy o źródło (rekrutacja od zera, nie przycisk „Chcę dołączyć do klanu”). */
    _czyPytacOZrodlo(userId) {
        return this.rozmowy.get(userId)?.pytajOZrodlo === true;
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
        if (szukaKlanu && !info.coreStock && this.ocr) {
            try {
                const wynik = await this.ocr.analyzeCoreStockImage(sciezkaObrazu);
                if (wynik.isValid) {
                    info.coreStock = wynik.items;
                    this.wyzerujOdbiegania(userId);
                    const pozycje = Object.entries(wynik.items)
                        .map(([nazwa, ilosc]) => `${nazwa}: ${ilosc}`)
                        .join(', ');
                    logger.info(`[AI_WYWIAD] Odczytano Core Stock dla ${info.username}`);
                    return {
                        typ: 'core_stock',
                        opis: `Kandydat przesłał zdjęcie Core Stock. Odczytano: ${pozycje}. Brakuje jeszcze: ${this._brakujaceDane(info, this._czyPytacOZrodlo(userId)).join(', ') || 'nic'}.`
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
                    this.wyzerujOdbiegania(userId);
                    info.characterAttack = stats.characterAttack ?? null;
                    info.playerNick = stats.playerNick ?? 'Nieznany';
                    logger.info(`[AI_WYWIAD] Odczytano postać dla ${info.username}: ${info.playerNick} / ${info.characterAttack}`);
                    return {
                        typ: 'ekwipunek',
                        opis: `Kandydat przesłał zdjęcie postaci. Odczytano nick "${info.playerNick}" i atak ${info.characterAttack}. Brakuje jeszcze: ${this._brakujaceDane(info, this._czyPytacOZrodlo(userId)).join(', ') || 'nic'}.`
                    };
                }
            } catch (error) {
                logger.error(`[AI_WYWIAD] Błąd analizy ekwipunku: ${error.message}`);
            }
        }

        const brakuje = this._brakujaceDane(info, this._czyPytacOZrodlo(userId));
        return {
            typ: null,
            opis: `Kandydat przesłał zdjęcie, ale nie udało się z niego nic odczytać — to najpewniej nie ten ekran albo screen jest nieczytelny. Wciąż brakuje: ${brakuje.join(', ') || 'nic'}. Poproś o zdjęcie ponownie i powiedz dokładnie, który ekran ma pokazać.`
        };
    }

    async _odczytajEkwipunek(sciezkaObrazu, userId, state) {
        if (this.ocr && this.config.ocr.useAI) {
            try {
                return await this.ocr.analyzeRecruitmentImage(sciezkaObrazu);
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
     * Wypowiedź rekrutera — zwykła wiadomość w prywatnym wątku rozmowy.
     *
     * Wcześniej rozmowa mieszkała w efemerycznej odpowiedzi edytowanej po każdej turze:
     * token interakcji żył 15 minut, wiadomości kandydata trzeba było kasować, a żeby
     * cokolwiek było widać, bot doklejał sklejoną transkrypcję ostatnich wypowiedzi.
     * W wątku nic z tego nie jest potrzebne — historia jest tam po prostu widoczna.
     */
    async pokazOdpowiedz(userId, tresc, state) {
        const watki = state.interviewThreadService;
        if (!watki) {
            logger.error('[AI_WYWIAD] Brak interviewThreadService - nie mam gdzie wysłać wiadomości');
            return false;
        }
        return watki.wyslij(userId, tresc);
    }
}

module.exports = AIInterviewService;
