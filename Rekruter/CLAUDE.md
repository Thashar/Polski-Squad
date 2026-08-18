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

**Kwalifikacja klanów (dynamiczna):**
- `services/stalkerThresholdsService.js` - czyta `shared_data/clan_thresholds.json`, cache 5 min
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

# Opcjonalne - z fallbackiem do wartości produkcyjnych
REKRUTER_MAIN_CHANNEL=channel_id          # Kanał główny (notyfikacje dołączeń/boostów)
REKRUTER_BOOST_BONUS_CHANNEL=channel_id   # Kanał bonusowy dla boosterów
ROBOT2_FORWARD_CHANNEL=channel_id         # Kanał forward dla Robot2
ROBOT2_MENTION_ROLE=role_id               # Rola do pingu (@) dla Robot2
ROBOT2_ACTIVATION_CHANNEL=channel_id      # Kanał z przyciskiem aktywacji Robot2
```

## Najlepsze Praktyki

- **Zawsze używaj createBotLogger('Rekruter')** zamiast console.log
- **OCR debug:** `/ocr-debug true` włącza szczegółowe logowanie
- **Walidacja danych:** Sprawdzaj formaty przed zapisem
- **Persistencja przez `utils/jsonStore` (cache-first):** `data/notification_preferences.json`, dane monitorowania ról, cache boostów (`memberCacheService`) oraz plik relay Robot2 i ID wiadomości aktywacji. Odczyt z dysku raz, przy pierwszym sięgnięciu; zapis atomowy (plik tymczasowy + rename) jednocześnie do pliku i pamięci
  - `memberCacheService` miał własny zapis atomowy (`.tmp` + `rename`) — teraz robi to store, więc kod serwisu jest krótszy o tę obsługę
  - `saveRelay2()` używa `store.mutate()` zamiast pary odczyt-zapis — wcześniej czytał plik przy KAŻDEJ przekazanej wiadomości DM
  - **`stalkerThresholdsService` nadal odświeża się co 5 min** (`store.reload`), bo plik `shared_data/clan_thresholds.json` pisze Stalker, który jeszcze nie przeszedł na store. Po migracji Stalkera oba boty będą dzielić ten sam wpis w cache (jeden proces, klucz = ścieżka pliku) i to wymuszone odświeżanie będzie można usunąć — progi będą aktualne natychmiast po zapisie
- **Persistencja:** Zapisuj dane do JSON po każdej zmianie
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje, bo widoczność ustala się przy pierwszej odpowiedzi. Dotyczy to `updateUserEphemeralReply()` w `utils/helpers.js`, które edytuje zapamiętaną interakcję z `state.userEphemeralReplies` — ephemeralność pochodzi z pierwotnego `reply()`. Import `MessageFlags` jest w `index.js` i `handlers/interactionHandlers.js`
