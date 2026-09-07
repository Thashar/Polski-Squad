const sharp = require('sharp');
const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

/**
 * AI OCR - odczyt zdjęć rekrutacyjnych przez Google Gemini.
 *
 * Dwa rodzaje screenów: ekran postaci z ekwipunkiem (nick + ATK) oraz zakładka
 * Core Stock (lista zasobów). Wywołania idą przez wspólny `utils/llmAdapter.js`,
 * więc każde zapytanie trafia do Langfuse jako osobny span - tak samo jak OCR
 * w Stalkerze, EndersEcho i Kontrolerze.
 */

const USTAWIENIA_BEZPIECZENSTWA = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/**
 * Wersje promptów - trafiają na span jako `llm.prompt.name` + `llm.prompt.version`.
 * Po każdej zmianie treści promptu BUMPNIJ wersję, żeby dało się porównać w Langfuse.
 */
const WERSJE_PROMPTOW = {
    'sprawdz-ekwipunek': 'v1',
    'odczytaj-postac':   'v2',
    'sprawdz-corestock': 'v1',
    'odczytaj-corestock': 'v2',
};

/** OCR ma być deterministyczny - bez tego Gemini raz czyta, raz odmawia */
const TEMPERATURA_OCR = 0;

/**
 * Progi rozpoznawania BIELI przy przygotowaniu screena postaci (patrz `_obrazBialyNaCzarnym`).
 *
 * ⚠️ Sama jasność NIE WYSTARCZY. Próg na skali szarości (`sharp().greyscale().threshold()`)
 * przepuściłby też nasycone jasne kolory — żółty (255,255,0) ma jasność ~226, więc zrobiłby się
 * biały razem z tekstem i cały zabieg straciłby sens. Dlatego piksel uznajemy za biały dopiero
 * gdy jest JEDNOCZEŚNIE jasny (najciemniejszy kanał ≥ MIN_JASNOSC) i nienasycony
 * (rozpiętość kanałów ≤ MAX_ROZPIETOSC).
 *
 * ⚠️ Przy strojeniu progów myl się w GÓRĘ, nie w dół. Za niski próg jasności wybiela także
 * jasnoszare tła interfejsu — a biały tekst leżący na takim tle staje się wtedy biały na białym,
 * czyli znika zupełnie. Za wysoki próg gubi najwyżej wygładzone krawędzie liter; rdzeń glifu
 * zostaje i to modelowi wystarcza.
 */
const BIEL_MIN_JASNOSC = 200;
const BIEL_MAX_ROZPIETOSC = 40;

/** Ile razy ponawiamy zapytanie przy błędzie przejściowym (429/5xx) */
const PROBY = 3;
const ODSTEP_PROBY_MS = 3000;

/** Pozycje, które w ogóle uznajemy za Core Stock - reszta odpowiedzi jest odrzucana */
const DOZWOLONE_POZYCJE = new Set([
    'Transmute Core', 'Xeno Pet Core', 'Mount Core',
    'Relic Core', 'Resonance Chip', 'Survivor Awakening Core'
]);

class AIOCRService {
    /**
     * @param {Object} config
     * @param {{ generate: Function }} llmAdapter - wspólny wrapper z utils/llmAdapter.js
     */
    constructor(config, llmAdapter = null) {
        this.config = config;
        this.adapter = llmAdapter;

        this.apiKey = config.ocr?.googleAiApiKey || null;
        this.modelName = config.ocr?.googleAiModel || 'gemini-2.5-flash-lite';
        this.enabled = !!this.apiKey && config.ocr.useAI === true && !!llmAdapter;

        if (this.enabled) {
            logger.success(`✅ AI OCR aktywny - model: ${this.modelName}`);
        } else if (!this.apiKey) {
            logger.warn('⚠️ AI OCR wyłączony - brak REKRUTER_GOOGLE_AI_API_KEY');
        } else if (!llmAdapter) {
            logger.warn('⚠️ AI OCR wyłączony - brak llmAdapter (DI) w konstruktorze');
        } else {
            logger.info('ℹ️ AI OCR wyłączony - USE_AI_OCR=false');
        }
    }

    /**
     * Zapytanie do Gemini z ponowieniem przy błędach przejściowych.
     *
     * ⚠️ Ponawiamy WYŁĄCZNIE błędy techniczne (rate limit, chwilowa niedostępność).
     * Odrzucenie treści przez filtr bezpieczeństwa (`semantic`) i błąd parsowania
     * powtórzą się tak samo, więc nie ma po co czekać trzy sekundy na ten sam wynik.
     */
    async _generuj(parts, maxOutputTokens, meta) {
        let ostatniBlad;

        for (let proba = 0; proba < PROBY; proba++) {
            try {
                const wynik = await this.adapter.generate({
                    provider: 'gemini',
                    model: this.modelName,
                    parts,
                    maxOutputTokens,
                    temperature: TEMPERATURA_OCR,
                    safetySettings: USTAWIENIA_BEZPIECZENSTWA,
                    meta,
                });
                return wynik.content;
            } catch (blad) {
                ostatniBlad = blad;
                const status = blad.status ?? blad.statusCode ?? blad.code;
                const doPonowienia = !blad.semantic
                    && [429, 500, 503, 'ECONNRESET', 'ETIMEDOUT'].includes(status);

                if (!doPonowienia || proba === PROBY - 1) throw blad;

                logger.warn(`[AI OCR] Błąd Gemini (${status}), próba ${proba + 2}/${PROBY} za ${ODSTEP_PROBY_MS}ms`);
                await new Promise(r => setTimeout(r, ODSTEP_PROBY_MS));
            }
        }

        throw ostatniBlad;
    }

    /** Wczytuje obraz i normalizuje do PNG w base64 (Gemini przyjmuje inlineData) */
    async _obrazJakoCzesc(sciezkaObrazu) {
        const png = await sharp(sciezkaObrazu).png().toBuffer();
        return { inlineData: { data: png.toString('base64'), mimeType: 'image/png' } };
    }

    /**
     * Zamienia screen na czysto czarno-biały: BIEL zostaje bielą, KAŻDY inny kolor staje się
     * czernią. Używane wyłącznie do odczytu ekranu postaci.
     *
     * **Po co:** nick i wartość ATK są w grze napisane BIAŁĄ czcionką na jaskrawym, kolorowym
     * tle (pomarańczowy baner, grafika postaci, efekty). Model gubił się w tym tle i zwracał
     * „nic nie odczytano" mimo poprawnego screena. Po tej operacji na obrazie zostaje praktycznie
     * sam biały tekst na czarnym tle.
     *
     * ⚠️ Robione RĘCZNIE na surowych pikselach, nie przez `sharp().greyscale().threshold()` —
     * powód w komentarzu przy `BIEL_MIN_JASNOSC`. Zdjęcie z telefonu to kilkaset kilopikseli,
     * więc jeden przebieg pętli jest nieodczuwalny.
     *
     * @returns {Promise<{czesc: object, udzialBieli: number}>} część dla Gemini + jaki procent
     *   obrazu uznano za biel (do logu — skrajne wartości zdradzają źle dobrane progi)
     */
    async _obrazBialyNaCzarnym(sciezkaObrazu) {
        const { data, info } = await sharp(sciezkaObrazu)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const kanaly = info.channels;
        let bialePiksele = 0;

        for (let i = 0; i < data.length; i += kanaly) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const min = Math.min(r, g, b);
            const max = Math.max(r, g, b);
            const biel = min >= BIEL_MIN_JASNOSC && (max - min) <= BIEL_MAX_ROZPIETOSC;
            const wartosc = biel ? 255 : 0;
            data[i] = wartosc;
            data[i + 1] = wartosc;
            data[i + 2] = wartosc;
            if (biel) bialePiksele++;
        }

        const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: kanaly } })
            .png()
            .toBuffer();

        const wszystkie = info.width * info.height;
        return {
            czesc: { inlineData: { data: png.toString('base64'), mimeType: 'image/png' } },
            udzialBieli: wszystkie > 0 ? bialePiksele / wszystkie : 0,
        };
    }

    /**
     * Analizuje zdjęcie postaci z ekwipunkiem.
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{playerNick: string|null, characterAttack: number|null, confidence: number, isValidEquipment: boolean, error?: string}>}
     */
    async analyzeRecruitmentImage(imagePath) {
        if (!this.enabled) {
            throw new Error('AI OCR nie jest włączony');
        }

        try {
            logger.info(`[AI OCR] Rozpoczynam analizę obrazu: ${imagePath}`);
            const obraz = await this._obrazJakoCzesc(imagePath);

            // === KROK 1: Sprawdź czy jest "My Equipment" ===
            logger.info(`[AI OCR] KROK 1: Sprawdzam obecność "My Equipment"...`);

            const promptSprawdzenia = `Znajdź na screenie napis "My Equipment", jeżeli znajdziesz napisz "Znalezniono", jeżeli nie znajdziesz napisz "Brak frazy".`;

            const odpowiedzSprawdzenia = (await this._generuj(
                [obraz, { text: promptSprawdzenia }],
                200,
                {
                    operationType: 'ocr.analyze',
                    step: 'sprawdz-ekwipunek',
                    promptName: 'sprawdz-ekwipunek',
                    promptVersion: WERSJE_PROMPTOW['sprawdz-ekwipunek'],
                }
            )).trim();

            logger.info(`[AI OCR] KROK 1 - Odpowiedź: "${odpowiedzSprawdzenia}"`);

            if (!odpowiedzSprawdzenia.toLowerCase().includes('znalezniono')) {
                logger.warn(`[AI OCR] KROK 1 - Nie znaleziono "My Equipment", przerywam analizę`);
                return {
                    playerNick: null,
                    characterAttack: null,
                    confidence: 0,
                    isValidEquipment: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }

            logger.info(`[AI OCR] KROK 1 - "My Equipment" znaleznione, przechodzę do KROKU 2`);

            // === KROK 2: Wyciągnij nick i atak ===
            // Czytamy z obrazu PRZEROBIONEGO na czarno-biały (biel zostaje bielą, reszta czernieje).
            // Nick i ATK są w grze białe na jaskrawym, kolorowym tle — na oryginale model regularnie
            // odbijał się od tego tła i zwracał „nic nie odczytano" mimo poprawnego screena.
            logger.info(`[AI OCR] KROK 2: Wyciągam nick i atak (obraz biel-na-czerni)...`);

            let result;
            try {
                const { czesc: obrazBw, udzialBieli } = await this._obrazBialyNaCzarnym(imagePath);
                logger.info(`[AI OCR] KROK 2 - Biel po konwersji: ${(udzialBieli * 100).toFixed(2)}% obrazu`);

                const odpowiedzOdczytu = await this._generuj(
                    [obrazBw, { text: this._promptOdczytuPostaci(true) }],
                    800,
                    {
                        operationType: 'ocr.analyze',
                        step: 'odczytaj-postac',
                        promptName: 'odczytaj-postac',
                        promptVersion: WERSJE_PROMPTOW['odczytaj-postac'],
                    }
                );

                logger.info(`[AI OCR] KROK 2 - Odpowiedź Gemini (biel-na-czerni):`);
                logger.info(odpowiedzOdczytu);

                result = this.parseAIResponse(odpowiedzOdczytu);
                logger.info(`[AI OCR] KROK 2 - Wynik parsowania:`, result);
            } catch (bladKonwersji) {
                logger.warn(`[AI OCR] KROK 2 - Konwersja biel-na-czerni nie powiodła się: ${bladKonwersji.message}`);
                result = null;
            }

            // Ścieżka zapasowa: gdy z przerobionego obrazu nic nie wyszło (źle dobrane progi bieli,
            // nietypowy motyw graficzny), próbujemy jeszcze raz na ORYGINALE — tak działało do tej
            // pory, więc gorzej niż wcześniej być nie może
            if (!result?.isValidEquipment) {
                logger.warn(`[AI OCR] KROK 2 - Brak odczytu z obrazu biel-na-czerni, ponawiam na oryginale`);

                const odpowiedzOryginal = await this._generuj(
                    [obraz, { text: this._promptOdczytuPostaci(false) }],
                    800,
                    {
                        operationType: 'ocr.analyze',
                        step: 'odczytaj-postac-oryginal',
                        promptName: 'odczytaj-postac',
                        promptVersion: WERSJE_PROMPTOW['odczytaj-postac'],
                    }
                );

                logger.info(`[AI OCR] KROK 2 - Odpowiedź Gemini (oryginał):`);
                logger.info(odpowiedzOryginal);

                result = this.parseAIResponse(odpowiedzOryginal);
                logger.info(`[AI OCR] KROK 2 - Wynik parsowania (oryginał):`, result);
            }

            return result;

        } catch (error) {
            logger.error(`[AI OCR] Błąd analizy obrazu:`, error);
            throw error;
        }
    }

    /**
     * Analizuje zdjęcie zakładki Core Stock.
     *
     * ⚠️ Nie sprawdza `USE_AI_OCR` - Core Stock nie ma ścieżki zapasowej na Tesseract,
     * więc albo idzie przez Gemini, albo nie ma go wcale.
     *
     * @param {string} imagePath - Ścieżka do obrazu
     * @returns {Promise<{items: Object, isValid: boolean, error?: string}>}
     */
    async analyzeCoreStockImage(imagePath) {
        if (!this.apiKey || !this.adapter) {
            throw new Error('Brak REKRUTER_GOOGLE_AI_API_KEY lub llmAdapter - nie można przeskanować Core Stock');
        }

        try {
            logger.info(`[AI OCR - CoreStock] Rozpoczynam analizę: ${imagePath}`);
            const obraz = await this._obrazJakoCzesc(imagePath);

            // === KROK 1: Czy na screenie w ogóle jest napis "Core Stock"? ===
            //
            // ⚠️ Bez tej bramki model DOPISYWAŁ SOBIE zawartość Core Stock z zupełnie innego
            // ekranu. Realny przypadek z produkcji: kandydat poproszony o Core Stock wysłał
            // „My Equipment" (siatka przedmiotów z ilościami — z daleka podobna), a bot
            // odpowiedział „Super, dzięki za screen z Core Stock!" i zapisał wymyślone liczby.
            // To nie jest kosmetyka: Core Stock decyduje o kwalifikacji do klanu.
            //
            // Sam prompt ekstrakcji tego nie łapał, bo ZAKŁADAŁ w pierwszym zdaniu, że screen
            // jest właściwy („Analyze this screenshot showing the Core Stock section"), a furtka
            // „if this is not a Core Stock screenshot" jest przy takim otwarciu za słaba.
            logger.info(`[AI OCR - CoreStock] KROK 1: Sprawdzam obecność napisu "Core Stock"...`);

            const promptSprawdzenia = `Znajdź na screenie napis "Core Stock". Jeżeli znajdziesz, napisz "Znaleziono". Jeżeli go nie ma, napisz "Brak frazy". Nie zgaduj i nie sugeruj się tym, że na obrazie są jakieś przedmioty albo liczby — liczy się WYŁĄCZNIE to, czy widnieje tam dokładnie ten napis.`;

            const odpowiedzSprawdzenia = (await this._generuj(
                [obraz, { text: promptSprawdzenia }],
                200,
                {
                    operationType: 'ocr.analyze',
                    step: 'sprawdz-corestock',
                    promptName: 'sprawdz-corestock',
                    promptVersion: WERSJE_PROMPTOW['sprawdz-corestock'],
                }
            )).trim();

            logger.info(`[AI OCR - CoreStock] KROK 1 - Odpowiedź: "${odpowiedzSprawdzenia}"`);

            if (!odpowiedzSprawdzenia.toLowerCase().includes('znaleziono')) {
                logger.warn(`[AI OCR - CoreStock] KROK 1 - Brak napisu "Core Stock" - to nie ten ekran, przerywam`);
                return { items: {}, isValid: false, error: 'NOT_CORE_STOCK' };
            }

            // === KROK 2: Wyciągnij pozycje ===
            logger.info(`[AI OCR - CoreStock] KROK 2: Wyciągam pozycje...`);

            const prompt = `This is a screenshot from the game Survivor.io. It should show the "Core Stock" inventory section.
Extract all items visible in the Core Stock list. For each item, return its name and the first number before the slash (the "All" total quantity, NOT the "Available" quantity after the slash).
Return ONLY a JSON object mapping item names to their total quantities, like this example:
{"Transmute Core": 29, "Xeno Pet Core": 75, "Mount Core": 7, "Relic Core": 155, "Resonance Chip": 68, "Survivor Awakening Core": 131}
Report ONLY items you can actually read in the Core Stock list. Do NOT invent items and do NOT infer them from other parts of the screen (equipment grids, gear icons, currencies).
If this is not a Core Stock screenshot, return: {"error": "not_core_stock"}`;

            const odpowiedz = (await this._generuj(
                [obraz, { text: prompt }],
                800,
                {
                    operationType: 'ocr.analyze',
                    step: 'odczytaj-corestock',
                    promptName: 'odczytaj-corestock',
                    promptVersion: WERSJE_PROMPTOW['odczytaj-corestock'],
                }
            )).trim();

            logger.info(`[AI OCR - CoreStock] Odpowiedź: ${odpowiedz}`);

            // Model lubi opakować JSON w blok ```json - bierzemy pierwszy nawias klamrowy
            const jsonMatch = odpowiedz.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { items: {}, isValid: false, error: 'NO_JSON_IN_RESPONSE' };
            }

            const parsed = JSON.parse(jsonMatch[0]);

            if (parsed.error === 'not_core_stock') {
                return { items: {}, isValid: false, error: 'NOT_CORE_STOCK' };
            }

            const items = {};
            for (const [name, qty] of Object.entries(parsed)) {
                const num = Number(qty);
                if (typeof name === 'string' && name.length > 0 && !isNaN(num) && num >= 0 && DOZWOLONE_POZYCJE.has(name)) {
                    items[name] = num;
                }
            }

            if (Object.keys(items).length === 0) {
                return { items: {}, isValid: false, error: 'NO_ITEMS_FOUND' };
            }

            logger.info(`[AI OCR - CoreStock] Odczytano ${Object.keys(items).length} przedmiotów`);
            return { items, isValid: true };

        } catch (error) {
            logger.error(`[AI OCR - CoreStock] Błąd analizy:`, error);
            throw error;
        }
    }

    /**
     * Parsuje odpowiedź modelu i wyciąga nick + atak
     * @param {string} responseText - Odpowiedź AI
     * @returns {{playerNick: string|null, characterAttack: number|null, confidence: number, isValidEquipment: boolean, error?: string}}
     */
    /**
     * Prompt odczytu ekranu postaci.
     *
     * ⚠️ Gdy `czarnoBialy === true`, model DOSTAJE INFORMACJĘ, że obraz został przerobiony
     * (biel → biel, każdy inny kolor → czerń). Bez tego widzi czarny prostokąt z białymi
     * plamami i nie wie, czemu zniknęły tło, grafika postaci i kolorowe ikony — a to
     * prowadzi go wprost do odpowiedzi „nieczytelny screen".
     *
     * @param {boolean} czarnoBialy czy obraz przeszedł konwersję biel-na-czerni
     */
    _promptOdczytuPostaci(czarnoBialy) {
        const wstep = czarnoBialy
            ? `To jest zrzut ekranu z gry Survivor.io (ekran postaci z ekwipunkiem) PO CELOWEJ OBRÓBCE GRAFICZNEJ: każdy piksel, który był BIAŁY, pozostał biały, a KAŻDY inny kolor został zamieniony na czarny. Obraz jest więc czarno-biały i to jest zamierzone — nie jest uszkodzony ani nieczytelny.

Obróbkę wykonano po to, żeby wydobyć BIAŁY tekst, który w grze jest napisany na jaskrawym, kolorowym tle. Wszystko, co widzisz na biało, to tekst i elementy interfejsu — reszta ekranu (tło, grafika postaci, kolorowe ikony i ramki) jest teraz czarna i możesz ją zignorować.`
            : `Na zdjęciu powinien być ekran z gry Survivor.io na którym przedstawiona jest postać z ekwipunkiem.`;

        return `${wstep}

Po lewej stronie na górze, nad zieloną linią progresu na szarym tle znajduje się nick postaci napisany białą czcionką, natomiast po prawej od ikonki mieczyka z napisem ATK znajduje się atak postaci. Po lewej od nicku jest awatar gracza, nie halucynuj żadnych znaków w tym miejscu.

Twoim zadaniem jest znaleźć kompletny nick postaci łącznie z prefixem jeżeli występuje oraz jej wartość ataku. Przedstaw dane w formacie:
<nick postaci>
<atak>`;
    }

    parseAIResponse(responseText) {
        const lowerResponse = responseText.toLowerCase();

        // Sprawdź czy AI wykrył niepoprawny screen
        const invalidKeywords = [
            'niepoprawny screen',
            'przesłano niepoprawny',
            'trzeba przesłać screen',
            'nie wykryłem',
            'nie wykryto',
            'brak ekwipunku',
            'nie znalazłem',
            'nie można odczytać'
        ];

        for (const keyword of invalidKeywords) {
            if (lowerResponse.includes(keyword)) {
                logger.info(`[AI OCR] AI wykrył niepoprawny screen (keyword: "${keyword}")`);
                return {
                    playerNick: null,
                    characterAttack: null,
                    confidence: 0,
                    isValidEquipment: false,
                    error: 'INVALID_SCREENSHOT'
                };
            }
        }

        // Wyciągnij nick - pierwsza niepusta linia
        const lines = responseText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            logger.warn(`[AI OCR] AI zwrócił za mało linii (${lines.length})`);
            return {
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                isValidEquipment: false,
                error: 'PARSING_ERROR'
            };
        }

        // Pierwsza linia = nick (usuń potencjalne prefix "Nick:" lub podobne)
        let playerNick = lines[0]
            .replace(/^nick[:\s]*/i, '')
            .replace(/^postać[:\s]*/i, '')
            .replace(/^gracz[:\s]*/i, '')
            .trim();

        // Druga linia = atak (usuń potencjalne prefix "Atak:" lub podobne, oraz spacje i separatory)
        let attackStr = lines[1]
            .replace(/^atak[:\s]*/i, '')
            .replace(/^atk[:\s]*/i, '')
            .replace(/[\s,._]/g, '') // Usuń spacje, przecinki, kropki, podkreślniki
            .trim();

        // Parsuj atak
        let characterAttack = null;
        const attackMatch = attackStr.match(/\d+/);
        if (attackMatch) {
            characterAttack = parseInt(attackMatch[0]);
        }

        // Walidacja
        const isValid = playerNick && characterAttack && characterAttack >= 100 && characterAttack <= 10000000;

        if (!isValid) {
            logger.warn(`[AI OCR] Walidacja nie powiodła się - nick: "${playerNick}", atak: ${characterAttack}`);
        }

        // Oblicz confidence (prosta heurystyka)
        let confidence = 0;
        if (playerNick) {
            confidence += 50;
            if (playerNick.length >= 4) confidence += 10;
        }
        if (characterAttack && characterAttack >= 100 && characterAttack <= 10000000) {
            confidence += 40;
        }

        return {
            playerNick: isValid ? playerNick : null,
            characterAttack: isValid ? characterAttack : null,
            confidence: Math.min(confidence, 100),
            isValidEquipment: isValid,
            error: isValid ? undefined : 'VALIDATION_FAILED'
        };
    }
}

module.exports = AIOCRService;
