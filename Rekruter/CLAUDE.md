### 🎯 Rekruter Bot

> ### ⚠️ SILNIK OCR NA PRODUKCJI: WYŁĄCZNIE AI — NIE TESSERACT
>
> **Na serwerze produkcyjnym cały OCR obsługuje AI (`Anthropic Claude Vision`). Tesseract NIE jest używany.**
>
> Skąd bierze się pomyłka: kod Tesseract nadal istnieje w `services/ocrService.js` (jest tam
> `require('tesseract.js')`) jako ścieżka zapasowa, a przełącznik `USE_AI_OCR` domyślnie jest
> **wyłączony** (`process.env.USE_AI_OCR === 'true'`). Lokalny `.env` go nie ustawia, więc lokalnie
> kod schodzi na Tesseract — na produkcji zmienna jest ustawiona na `true` i ta gałąź nigdy
> nie jest wykonywana.
>
> **Konsekwencje przy diagnozie i optymalizacji:**
> - Nie licz plików `pol.traineddata` / `eng.traineddata` (~5 MB każdy) jako obciążenia — nikt ich nie ładuje
> - Nie analizuj wydajności workerów Tesseract ani preprocessingu pod jego kątem
> - Ścieżka realna to: pobranie screena → `sharp` → base64 → zapytanie do AI
> - Zmieniając cokolwiek w OCR, patrz na `services/aiOcrService.js`, nie na `ocrService.js`


**Funkcjonalność:** Wieloetapowa rekrutacja z OCR → Kwalifikacja klanów dynamiczna: próg = minimalny maxScore najsłabszego gracza w danym klanie (z danych Stalkera). Dane w `shared_data/clan_thresholds.json`, aktualizowane przez Stalkera po każdym `/faza1` i przy starcie. Brak danych → Clan0.
**Flow rekrutacji (ścieżka "Szukam klanu"):**
1. Klik "Szukam klanu" → `step: waiting_core_stock` → prośba o zdjęcie Core Stock
2. Skan Core Stock przez AI → `coreStock = {item: qty}` → `step: waiting_lunar_level`
3. Wpisanie poziomu LME → `step: waiting_lunar_points`
4. Wpisanie punktów I fazy (0–9999) → `step: waiting_image`
5. Zdjęcie postaci (OCR) → `lunarPoints` porównane z progami klanów → kwalifikacja → embed powitalny

**Flow rekrutacji (ścieżka "Przyszedłem w innym celu"):**
1. Klik "Przyszedłem w innym celu" → `step: waiting_image`
2. Zdjęcie postaci (OCR) → propozycja zmiany nicku → rola `VERIFIED` → powitanie na kanale WELCOME

---

## 🎮 Przycisk „Chcę dołączyć do klanu"

Drugie wejście do rekrutacji — dla osób, które **są już na serwerze** (weszły kiedyś bez klanu,
wracają po przerwie). Kanał: `REKRUTER_JOIN_CLAN_CHANNEL` (domyślnie `1209283124765265970`).

- Przy starcie bota `zadbajOPrzyciskDolaczenia()` pilnuje, żeby na kanale wisiała **dokładnie jedna**
  wiadomość z przyciskiem (sama wiadomość jest pusta — tylko przycisk). Istniejąca jest zostawiana,
  a nie kasowana i wysyłana od nowa — dzięki temu link do niej przeżywa restarty i kanał nie zapełnia
  się kopiami. Etykieta różna od aktualnej → wiadomość jest edytowana w miejscu
- Kliknięcie ustawia `purpose = 'Szukam klanu'` i startuje rekrutację **z pominięciem pytania o cel** —
  ten wynika z samego przycisku. Z aktywnym trybem AI rusza rozmowa (model dostaje w otwarciu
  informację, że cel jest już zapisany i nie ma o niego pytać); bez trybu AI lecą klasyczne kroki
  od razu od `waiting_core_stock`
- **Ponowne kliknięcie zaczyna rekrutację od zera** (czyści kartę kandydata i porzuca poprzednią rozmowę)
- Kanał działa dokładnie jak kanał rekrutacyjny: **wszystko, co nie jest częścią trwającej rekrutacji,
  jest kasowane** (gałąź `default` w `handleMessage`)
- ⚠️ **Rozmowę da się rozpocząć wyłącznie przyciskiem, nigdy wiadomością.** `userStates` trzyma
  `channelId` kanału, na którym kliknięto przycisk, a `handleMessage` podejmuje rozmowę tylko tam —
  napisanie czegokolwiek na drugim kanale rekrutacyjnym kończy się skasowaniem wiadomości.
  Krok zmieniany w trakcie rekrutacji zachowuje `channelId` (`...state.userStates.get(id)`)
- ⚠️ **Edycja starej wiadomości nie może jej skasować** — bot nasłuchuje wyłącznie `MessageCreate`,
  a dodatkowy warunek `if (message.editedTimestamp) return;` pilnuje tego również na wypadek,
  gdyby ktoś kiedyś podpiął `MessageUpdate`

---

## 🤖 Tryb rozmowy z AI (`REKRUTER_AI_INTERVIEW`)

Alternatywa dla ankiety z przyciskami: zamiast sztywnych kroków kandydat prowadzi **swobodną rozmowę
z rekruterem-AI**, który po drodze wyciąga te same dane. Przełącznik jest niezależny — bez
`REKRUTER_AI_INTERVIEW=true` (albo bez `ANTHROPIC_API_KEY`) bot działa dokładnie jak dotąd, cała
klasyczna ścieżka zostaje nietknięta w kodzie.

**Plik:** `services/aiInterviewService.js`

**Co się zmienia:** po kliknięciu „Oczywiście, że tak!" (deklaracja polskości) **nie pojawiają się
przyciski wyboru ścieżki** — startuje rozmowa (`step: 'ai_interview'`). W pierwszej wiadomości AI
przedstawia się jako bot rekrutacyjny Polskiego Squadu, żeby kandydat od razu wiedział, z czym rozmawia. Wszystko poniżej zebrania
danych — propozycja zmiany nicku, przydział klanu, embed podsumowania — jest **wspólne z klasyczną
ścieżką**, bo AI zapisuje dane do `state.userInfo` w tym samym kształcie.

**Zbierane dane** (identyczne jak w ankiecie):

| Dane | Skąd | Kto zapisuje |
|---|---|---|
| Cel wizyty (`purpose`) | rozmowa | AI przez `zapisz_dane` |
| Poziom LME (`lunarLevel`, 1–16) | rozmowa | AI przez `zapisz_dane` |
| Punkty I fazy (`lunarPoints`, 0–9999) | rozmowa | AI przez `zapisz_dane` |
| `coreStock` | zdjęcie | OCR (`analyzeCoreStockImage`) |
| `playerNick`, `characterAttack` | zdjęcie | OCR (`analyzeRecruitmentImage` lub Tesseract) |

⚠️ **Nick, atak i Core Stock są celowo NIEDOSTĘPNE dla modelu jako narzędzie** — schemat `zapisz_dane`
przyjmuje wyłącznie cel i dwie liczby z LME. Gdyby AI mogło zapisać nick albo atak z tekstu, kandydat
podałby dowolne wartości i ominął OCR.

**Narzędzia (tool use):**
- `zapisz_dane` — cel / poziom / punkty; waliduje zakresy po stronie bota i **zwraca modelowi listę
  tego, czego jeszcze brakuje** (dzięki temu model wie, o co pytać dalej, bez dopisywania stanu do promptu)
- `zakoncz_wywiad` — bot **sam sprawdza komplet danych** i odrzuca wywołanie z listą braków, jeśli
  czegoś brakuje. Model nie może zakończyć rekrutacji „na słowo"

**Rozpoznawanie zdjęć bez pytania modelu:** typ screena wynika z tego, czego brakuje —
najpierw próba Core Stock (jeśli kandydat szuka klanu i jeszcze go nie ma), potem ekran postaci.
Wynik wraca do rozmowy jako wiadomość `[SYSTEM] …`, której kandydat nie widzi. Screen postaci
zostaje w `temp/` (`ai_<timestamp>_<userId>.png`, trafia do embeda podsumowania), zdjęcie Core Stock
jest kasowane od razu po odczycie.

**Ustawienia zapytania do API:**
- Model domyślnie `claude-opus-5`, nadpisywalny przez `REKRUTER_AI_INTERVIEW_MODEL`
- `output_config.effort` (domyślnie `low`) wysyłany **tylko dla modeli, które go obsługują** — starsze
  (np. `claude-3-haiku`) odrzuciłyby to błędem 400
- **Myślenie zostaje włączone.** Przy wyłączonym modele potrafią wypisać wywołanie narzędzia jako
  zwykły tekst — tura kończy się „sukcesem", a dane nigdy się nie zapisują. Kosztem sterujemy
  poziomem `effort`, nie wyłączaniem myślenia
- Brak `temperature` — nowsze modele odrzucają ten parametr
- **Prompt caching:** prompt systemowy i definicje narzędzi są niezmienne i oznaczone
  `cache_control: ephemeral`, więc prefiks cache'uje się między turami i między kandydatami

**Bezpieczniki:**
- **Teksty z całej tury są kumulowane, nie nadpisywane.** Model zwykle pisze wiadomość do kandydata
  RAZEM z wywołaniem narzędzia („Wrzuć screena Core Stock" + `zapisz_dane`), a po `tool_result`
  kończy turę już bez tekstu. Nadpisywanie gubiło tę wiadomość: kandydat widział komunikat o błędzie,
  a tekst zostawał w historii — więc model był przekonany, że już o screena poprosił, i nie powtarzał prośby
- **Pusta tura → dopytanie modelu.** Gdy w całej turze nie padł żaden tekst, bot dosyła
  `[SYSTEM] napisz wiadomość do kandydata` i dopiero gdy to też nie pomoże, pokazuje komunikat o błędzie
- `maxTurns` (domyślnie 40) — po przekroczeniu rozmowa jest zamykana z prośbą o kontakt z moderatorem
- `historyLimit` (domyślnie 30 wiadomości) — przycinanie historii **nigdy nie rozrywa pary
  `tool_use`/`tool_result`** (API odrzuca niesparowany ogon), więc odcina zawsze do zwykłej wiadomości użytkownika
- Maks. 4 iteracje narzędzi na turę — zabezpieczenie przed zapętleniem modelu
- Błąd API nie zrywa rozmowy: kandydat dostaje komunikat i może napisać ponownie, historia zostaje

**Styl wypowiedzi:** pierwsza osoba liczby pojedynczej, bez komentowania własnych zapisów danych,
maksymalnie jedno emoji na wiadomość, **pogrubienie** na kluczowej rzeczy w danej wiadomości
(nazwa ekranu, ścieżka w grze, zakres liczb) — jedno, dwa miejsca, nigdy całe zdania.

**Prezentacja w Discordzie:** rozmowa toczy się w jednej efemerycznej odpowiedzi, edytowanej po każdej
turze i pokazującej **transkrypcję ostatnich 6 wypowiedzi** (bot: `<:PepeBizensik:1278014731113857037>`,
kandydat: `<:G_SSJCommon:1268828660509573203>` — stałe `EMOJI_BOTA` / `EMOJI_UZYTKOWNIKA` w serwisie) (wiadomości kandydata są kasowane z kanału,
więc bez transkrypcji widziałby tylko ostatnie zdanie bota). Token interakcji Discorda żyje 15 minut —
gdy edycja przestaje działać, bot pisze na kanale z pingiem i kasuje tę wiadomość po 2 minutach,
żeby rozmowa nie urwała się w ciszy.

**Persistencja:** historie rozmów żyją wyłącznie w pamięci (`aiInterviewService.rozmowy`, klucz = userId),
tak samo jak pozostałe mapy stanu rekrutacji — restart bota przerywa rozmowy w toku i kandydat zaczyna
od nowa przyciskiem na kanale. Mapa jest podpięta pod `uruchomSprzatanieRekrutacji()` w `index.js`
(retencja 30 dni), a `sprzatajOsieroconeObrazy()` kasuje też pliki `ai_*` z `temp/`.

---

**Kwalifikacja klanów (dynamiczna):**
- `services/stalkerThresholdsService.js` - czyta `shared_data/clan_thresholds.json` z cache store'a (wspólnego ze Stalkerem, bez wymuszanego odświeżania)
- Porównanie: `lunarPoints >= thresholds[clanKey]` od Main w dół → najwyższy pasujący klan
- Progi: `thresholds['main']`, `thresholds['2']`, `thresholds['1']` (klucze jak w Stalker targetRoles)
- Brak pliku lub brak wpisu dla guildId → Clan0 z ostrzeżeniem w logu

**OCR - Dwa tryby (zdjęcie postaci):**
1. **Tradycyjny:** `services/ocrService.js` - Tesseract (PL+EN), preprocessing Sharp, ekstrakcja nick+atak
2. **AI OCR (opcjonalny):** `services/aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa analiza przez AI
   - Włączany przez `USE_AI_OCR=true` w .env
   - Używa tego samego modelu co Stalker AI Chat (domyślnie: Claude 3 Haiku)
   - Dwuetapowa walidacja (dwa osobne requesty do API):
     - **KROK 1 (pierwszy request):** Sprawdza czy jest "My Equipment" (50 tokenów)
       - Jeśli NIE - natychmiast zwraca błąd, NIE wysyła drugiego requestu
     - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "My Equipment" → wyciąga nick i atak (500 tokenów)
   - Zalety: 100% pewność walidacji, oszczędność tokenów przy złych screenach, niemożliwe fałszywe pozytywy

**Skanowanie Core Stock:** `services/aiOcrService.js` → `analyzeCoreStockImage(imagePath)`
   - Wymagany `ANTHROPIC_API_KEY` (niezależnie od `USE_AI_OCR`)
   - Prompt AI wyciąga JSON `{"Relic Core": N, "Transmute Core": N, ...}` (6 typów)
   - Walidacja: tylko dozwolone nazwy przedmiotów, wartości >= 0
   - Błędy: `NOT_CORE_STOCK` (złe zdjęcie), `NO_ITEMS_FOUND`, `NO_JSON_IN_RESPONSE`
   - Wyniki zapisywane w `state.userInfo.coreStock` (obiekt item→qty)
   - W embedzie powitalnym: pole **🎒 Core Stock** z ikonami każdego przedmiotu

**Serwisy:**
- `memberNotificationService.js` - Śledzenie boostów, losowe gratulacje, powiadomienia o odejściu (link do profilu + nick serwerowy)
- `roleMonitoringService.js` - Cron 6h, ostrzeżenia po 24h bez ról
- `roleConflictService.js` - Auto-usuwanie ról rekrutacyjnych gdy dostaje klanową
- `clanRoleChangeService.js` - Powiadomienia o zmianach klanów/stanowisk; sprawdza globalny flag + per-user opt-out; ignoruje administratorów; `buildInitialCache()` pobiera wszystkich członków (bez limitu)
- `notificationPreferencesService.js` - Persistencja preferencji w `data/notification_preferences.json`; globalny flag `globalEnabled` + per-user `optedOut[]`; metody: `isGlobalEnabled()`, `toggleGlobal()`, `isOptedOut(userId)`, `optOut(userId)`, `optIn(userId)`

**Komendy:** `/ocr-debug`, `/nick`, `/powiadomienia [uzytkownik]`
- `/powiadomienia` - tylko admin, globalny toggle (włącza/wyłącza dla WSZYSTKICH)
- `/powiadomienia uzytkownik:@user` - tylko admin, toggle dla konkretnego użytkownika
**Env:** TOKEN, kanały (RECRUITMENT, CLAN0-2, MAIN_CLAN, WELCOME), role (CLAN0-2, MAIN_CLAN, VERIFIED, NOT_POLISH), USE_AI_OCR (opcjonalne), ANTHROPIC_API_KEY (opcjonalne), ROBOT (opcjonalne, lista user ID rozdzielona przecinkami)

**Przekazywanie wiadomości (Robot2):**
- Użytkownicy z ID w `ROBOT` mogą pisać priv do bota, a wiadomości są przekazywane 1:1 na kanał z env `ROBOT2_FORWARD_CHANNEL`
- Obsługuje tekst i załączniki
- Wymaga partial `Channel`
- **Ping roli:** Jeśli wiadomość DM zaczyna się od `@`, zostanie wysłana z pingiem do roli z env `ROBOT2_MENTION_ROLE`

---

## Zmienne Środowiskowe

```env
# Token bota
DISCORD_TOKEN=bot_token_here

# Kanały
RECRUITMENT_CHANNEL=channel_id
CLAN0_CHANNEL=channel_id
CLAN1_CHANNEL=channel_id
CLAN2_CHANNEL=channel_id
MAIN_CLAN_CHANNEL=channel_id
WELCOME_CHANNEL=channel_id
WAITING_ROOM_CHANNEL=poczekalnia

# Role
NOT_POLISH_ROLE=role_id
VERIFIED_ROLE=role_id
CLAN0_ROLE=role_id
CLAN1_ROLE=role_id
CLAN2_ROLE=role_id
MAIN_CLAN_ROLE=role_id

# AI OCR (opcjonalne)
USE_AI_OCR=false
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-3-haiku-20240307

# Rozmowa rekrutacyjna z AI (opcjonalne, niezależne od USE_AI_OCR)
# true = po kliknięciu "Oczywiście, że tak!" startuje swobodna rozmowa zamiast ankiety z przyciskami
# Wymaga ANTHROPIC_API_KEY - bez niego tryb sam się wyłącza z ostrzeżeniem w logu
REKRUTER_AI_INTERVIEW=false
REKRUTER_AI_INTERVIEW_MODEL=claude-opus-5   # domyślnie claude-opus-5
REKRUTER_AI_INTERVIEW_EFFORT=low            # low | medium | high (tylko modele 4.5+)
REKRUTER_AI_INTERVIEW_MAX_TURNS=40          # limit wiadomości kandydata w jednej rozmowie
REKRUTER_AI_INTERVIEW_HISTORY=30            # ile wiadomości trafia do kontekstu modelu

# Opcjonalne - z fallbackiem do wartości produkcyjnych
REKRUTER_JOIN_CLAN_CHANNEL=channel_id     # Kanał z przyciskiem „Chcę dołączyć do klanu" (domyślnie 1209283124765265970)
REKRUTER_MAIN_CHANNEL=channel_id          # Kanał główny (notyfikacje dołączeń/boostów)
REKRUTER_BOOST_BONUS_CHANNEL=channel_id   # Kanał bonusowy dla boosterów
ROBOT2_FORWARD_CHANNEL=channel_id         # Kanał forward dla Robot2
ROBOT2_MENTION_ROLE=role_id               # Rola do pingu (@) dla Robot2
ROBOT2_ACTIVATION_CHANNEL=channel_id      # Kanał z przyciskiem aktywacji Robot2
```

## Najlepsze Praktyki

- **Zawsze używaj createBotLogger('Rekruter')** zamiast console.log
- **Kasowanie wiadomości i „duchy" w kliencie:** `safeDeleteMessage(message, opoznienieMs)` przyjmuje
  opcjonalną zwłokę. Wiadomości spoza rekrutacji (gałąź `default` w `handleMessage`) kasujemy dopiero
  po sekundzie — natychmiastowe usunięcie zostawia autorowi wiadomość-ducha: na serwerze jej już nie ma,
  ale jego klient wciąż ją pokazuje i nie da się jej usunąć, dopóki aplikacja się nie odświeży.
  Kroki rekrutacji zwłoki nie potrzebują, bo tam między wysłaniem a skasowaniem i tak mija chwila na obsługę.
  Nieudane usunięcie loguje `error.message` i kod Discorda (**50013** = brak uprawnień, **10008** = wiadomości już nie ma)
- **OCR debug:** `/ocr-debug true` włącza szczegółowe logowanie
- **Walidacja danych:** Sprawdzaj formaty przed zapisem
- **Persistencja przez `utils/jsonStore` (cache-first):** `data/notification_preferences.json`, dane monitorowania ról, cache boostów (`memberCacheService`) oraz plik relay Robot2 i ID wiadomości aktywacji. Odczyt z dysku raz, przy pierwszym sięgnięciu; zapis atomowy (plik tymczasowy + rename) jednocześnie do pliku i pamięci
  - `memberCacheService` miał własny zapis atomowy (`.tmp` + `rename`) — teraz robi to store, więc kod serwisu jest krótszy o tę obsługę
  - `saveRelay2()` używa `store.mutate()` zamiast pary odczyt-zapis — wcześniej czytał plik przy KAŻDEJ przekazanej wiadomości DM
  - **`stalkerThresholdsService` czyta progi wprost z cache** — Stalker zapisuje `shared_data/clan_thresholds.json` przez store, więc oba boty dzielą ten sam wpis w cache jednego procesu i progi są aktualne natychmiast po zapisie. Wymuszane wcześniej co 5 min `store.reload()` zostało usunięte jako zbędny ruch dyskowy
  - **`memberCacheService`**: kolejka zapisu z debounce — gdy zapis już trwa, kolejne zgłoszenie planuje następne podejście zamiast przepadać (wcześniej gołe `return` zostawiało nierozwiązane obietnice, na które czeka `buildInitialCache()` przy starcie)
- **Sprzątanie porzuconych rekrutacji (30 dni):** siedem map stanu w `index.js` (`userStates`, `userInfo`, `userImages`, `userEphemeralReplies`, `nicknameRequests`, `pendingQualifications`, `pendingOtherPurposeFinish`) jest kluczowanych po userId i NIC ich nie czyściło poza pomyślnym zakończeniem rekrutacji — kto zaczął i nie dokończył, zostawał w pamięci na zawsze, a jego zdjęcie w `temp/` nigdy nie było kasowane. `uruchomSprzatanieRekrutacji()` (co 6 h, pierwszy przebieg przy starcie) usuwa wpisy starsze niż 30 dni wraz z plikiem obrazu
  - Znacznik czasu bierze się z **pierwszego przebiegu sprzątacza, który zobaczył danego użytkownika** — dzięki temu nie trzeba dotykać sześciu miejsc ustawiających `userStates`. Konsekwencja: licznik startuje od nowa po restarcie bota, ale mapy i tak żyją wyłącznie w pamięci, więc restart czyści je w całości
  - **Pliki w `temp/` przetrwają restart**, dlatego `sprzatajOsieroconeObrazy()` kasuje osobno pliki `img_*` starsze niż 30 dni — po restarcie `userImages` już o nich nie wie
- **Persistencja:** Zapisuj dane do JSON po każdej zmianie
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje, bo widoczność ustala się przy pierwszej odpowiedzi. Dotyczy to `updateUserEphemeralReply()` w `utils/helpers.js`, które edytuje zapamiętaną interakcję z `state.userEphemeralReplies` — ephemeralność pochodzi z pierwotnego `reply()`. Import `MessageFlags` jest w `index.js` i `handlers/interactionHandlers.js`
