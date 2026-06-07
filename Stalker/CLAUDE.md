### ⚔️ Stalker Bot

**11 Systemów:**
1. **Kary OCR** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, upscaling 3x, gamma 3.0, Levenshtein matching, wykrywanie 0
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Google Gemini API (Gemini Vision), analiza wyników graczy przez AI
     - Włączany przez `USE_STALKER_AI_OCR=true` w .env + klucz `STALKER_GOOGLE_AI_API_KEY`
     - Domyślny model: `gemini-2.5-flash-preview-05-20` (nadpisywalny przez `STALKER_GOOGLE_AI_MODEL`)
     - Prompt: "Przeanalizuj zdjęcie z wynikami poszczególnych graczy oraz zwróć kompletne nicki oraz wyniki w następującym formacie: <nick> - <wynik>"
     - Automatyczny fallback na tradycyjny OCR gdy AI zawiedzie
     - Dotyczy komend: `/punish`, `/remind`, `/faza1`, `/faza2`, `/test`, Core Stock (skan ekwipunku)
     - **Tryb batch (`/faza1`, `/faza2`, `/test`, `/remind`, `/punish`):** `analyzeResultsImagesBatch(imagePaths, clanNicks)` - wysyła WSZYSTKIE zdjęcia naraz w jednym zapytaniu (oszczędność czasu/tokenów). Do promptu dołącza listę nicków z roli klanowej Discord i prosi AI o dopasowanie odczytanych nicków ze screenów do najbliższego nicku Discord. Zwraca format `<nick Discord> - <wynik>`. Wersja promptu: `extract-results-batch` v1
     - **Wszystkie komendy OCR używają batch gdy AI OCR włączony:** `/faza1`, `/faza2` (`phaseService.js`) oraz `/remind`, `/punish` (`reminderService.js`/`punishmentService.js`) przetwarzają zdjęcia zbiorczo przez `processImagesBatch()` zamiast pojedynczo. `/remind` i `/punish` po analizie filtrują graczy z wynikiem **0** (do przypomnień/kar). Gdy `USE_STALKER_AI_OCR=false` → automatyczny fallback na klasyczne przetwarzanie zdjęcie-po-zdjęciu (`processImagesPerImage()`, Tesseract). Dyspozytorem jest `processImagesFromDisk()`.
     - **Dopasowanie nicków AI → klanowych (`utils/nickMatcher.js`):** wspólny util `assignNicksToClan(players, clanNicks)` - przydział 1:1 (każdy gracz na screenie = jeden klanowicz), zachłannie po globalnym minimum odległości edycyjnej, Levenshtein na grafemach (emoji = 1 znak) po normalizacji (NFKD + usunięcie diakrytyków + lowercase). Bez progu odcięcia - literówki/błędy OCR trafiają do najbliższego wolnego klanowicza. Współdzielony przez phaseService, reminderService i punishmentService.
     - **Pasek postępu batch (stepper):** wszystkie komendy batch pokazują etapy `📥 Pobieranie → 🤖 Wysyłanie do AI → ⚙️ Przetwarzanie → 📊 Analiza wyników` (aktywny etap miga) przez `updateBatchProgress()` zamiast kratek per-zdjęcie.
     - Walidacja wyników: 0–999999 (obsługuje wyniki 5-cyfrowe i wyższe)
     - Retry 3× z exponential backoff (1s/2s/4s) dla błędów 429/503/500/sieciowych
     - Weryfikacja wersji promptów przez `PROMPT_VERSIONS` (Langfuse telemetria)
     - Inicjalizacja przez `llmAdapter` (wspólny wrapper `utils/llmAdapter.js`) + DI z `index.js`
2. **Punkty** - `punishmentService.js`: 2pts=kara, 3pts=ban loterii, cron czyszczenie (pn 00:00). `/points` z ujemną wartością: gdy `points` spada do 0 → `lifetime_points` też zerowane do 0 (czyste konto); przy częściowym usunięciu → `lifetime_points` zmniejszane o tę samą liczbę. Odpowiedź pokazuje nowe `points` i status `lifetime_points`.
3. **Urlopy** - `vacationService.js`: Przycisk → rola 15min, cooldown 6h
4. **Kolejkowanie OCR** - `queueService.js`: Jeden user/guild, progress bar, 15min timeout, przyciski komend. Anulowanie w trakcie przetwarzania: embed aktualizowany do stanu "❌ Sesja anulowana" z usuniętymi przyciskami po zakończeniu bieżącego zdjęcia. **Dwa kanały kolejki** — główny (ID: `1437122516974829679`) z pełnym zestawem przycisków moderatora (row1: 📊 Faza 1, 📈 Faza 2, 🧪 Test [tylko admin], 📢 Remind, 💀 Punish; row4: raport wypalenia + 🚪 Wyjdź z kolejki), dodatkowy (ID: `1491801320602992690`) z przyciskiem "🎒 Skanuj ekwipunek". Oba embedy aktualizowane równolegle. Jeden użytkownik może korzystać z OCR na raz w całym serwerze.
13. **Skan Ekwipunku (Core Stock)** - Przycisk "🎒 Skanuj ekwipunek" na kanale `1491801320602992690`:
   - Dostępny dla wszystkich członków klanu (targetRoles)
   - Wchodzi do wspólnej kolejki OCR (1-minutowy timeout sesji)
   - Po dostaniu dostępu: użytkownik ma 1 minutę na wysłanie zdjęcia zakładki "Core Stock"
   - Analiza przez AI (Google Gemini Vision): wyciąga nazwę przedmiotu + pierwszą liczbę przed "/" (ilość "All")
   - Prompt AI: wyciąga JSON `{"Transmute Core": 29, ...}` z ekranu Core Stock
   - Wyniki wyświetlane w ephemeralu ze zdjęciem + przyciski "💾 Zapisz" / "❌ Anuluj"
   - Po zapisie: dane agregowane per userId w `data/equipment_data.json`
   - Format: `{ userId: { items: {...}, updatedAt: ISO_string } }`
   - Dane widoczne w `/player-status` w sekcji "### 🎒 EKWIPUNEK (Core Stock)"
   - Dane tymczasowe (pending) przechowywane w `client._equipmentPending` Map (wygasają po 5 min)
6. **Fazy Lunar** - `phaseService.js`: `/faza1` (lista), `/faza2` (3 rundy damage), `/wyniki` (TOP30 z paginacją tygodni), `/progres`, `/clan-status`, `/clan-progres` (progres TOP30 klanu z wykresem), `/img` (dodaj zdjęcie tabeli do Fazy 2). Po każdym zatwierdzeniu `/faza1` (i przy starcie bota) wywołuje `clanThresholdsExportService.exportClanThresholds()` → zapisuje `shared_data/clan_thresholds.json` z minimalnym maxScore per klan, używanym przez Rekrutera do dynamicznej kwalifikacji.
   - **Przetwarzanie zdjęć (batch AI):** Gdy AI OCR włączony, `/faza1` i `/faza2` analizują WSZYSTKIE zdjęcia danej partii naraz w jednym zapytaniu do AI (`processImagesBatch()`), dołączając do promptu listę nicków roli klanowej (snapshot sesji `role_nicks_snapshot_<sessionId>.json`, fallback na żywo). AI deduplikuje nakładające się zdjęcia i dopasowuje nicki do Discord, zwracając jeden wynik na gracza. **Każdy przebieg batch tworzy JEDEN wpis w `session.processedImages`** — dzięki temu mechanizm konfliktów działa bez zmian: przycisk **➕ Dodaj więcej** uruchamia kolejny batch (nowy wpis), a jeśli ten sam nick ma w kolejnym przebiegu inny wynik → konflikt do ręcznego rozstrzygnięcia przez moderatora. Fallback bez AI: `processImagesPerImage()` (Tesseract, zdjęcie-po-zdjęciu).
   - **Dopasowanie nicków AI do klanu (`utils/nickMatcher.js` → `assignNicksToClan()`):** Założenie domenowe — KAŻDY gracz na screenie ma rolę klanową, więc każdy odczytany nick odpowiada dokładnie jednemu członkowi klanu. Realizowane jako **problem przydziału 1:1**: każdy klanowicz użyty maks. raz w partii, minimalizacja łącznej odległości edycyjnej, algorytm **zachłanny po globalnym minimum** (najpierw pary o najmniejszej odległości — dokładne trafienia kotwiczą resztę). Dzięki temu literówki/błędy OCR (np. `krępo` → `Krzempo`) trafiają do najbliższego WOLNEGO klanowicza — **bez progu odcięcia**. Odległość: Levenshtein na **grafemach** (emoji = 1 znak, `splitGraphemes()` + `Intl.Segmenter`), po normalizacji `normForMatch()` (NFKD + usunięcie diakrytyków + lowercase). Gwarantuje, że te same osoby dostają identyczny kanoniczny nick we wszystkich rundach → spójny union i poprawne `sumPhase2Results` (sumuje po stringu nicku). Pre-dedup identycznych nicków AI (wyższy wynik). Util współdzielony — używany przez `phaseService` (`normalizePlayersToClanNicks` deleguje do niego), `reminderService` i `punishmentService`.
   - **Pasek postępu (stepper):** W trybie batch pasek pokazuje ETAPY procesu zamiast kratek per-zdjęcie: `📥 Pobieranie zdjęć → 🤖 Wysyłanie do AI → ⚙️ Przetwarzanie przez AI → 📊 Analiza wyników`. Aktywny etap miga (🟧/⬜ co 1s przez `blinkTimer`), ukończone mają ✅. Implementacja: `updateBatchProgress()`. Tryb fallback (per-zdjęcie) używa starego paska `createProgressBar()` z kratkami postępu.
   - **`/test`** (`processTestImages()`): Tryb testowy - mirror `/faza1` (ten sam kanał OCR `1437122516974829679`, ta sama kolejka OCR), ale: (1) **TYLKO Administrator** (komenda i przycisk); (2) przetwarza WSZYSTKIE zdjęcia naraz przez AI batch (`analyzeResultsImagesBatch`) zamiast pojedynczo; (3) do promptu AI dołącza listę nicków z roli klanowej użytkownika (pobrane przez `safeFetchMembers`), AI dopasowuje odczytane nicki do nicków Discord; (4) wynik (posortowana lista z miejscami `█████░░░░░ #1 nick - wynik` + suma TOP30) wyświetlany w **ephemeralu** (`deferReply({ ephemeral: true })`) z przyciskiem **🏁 Zakończ**; (5) **BEZ zapisu do bazy** - czysto diagnostyczny. Zdjęcia przesyłane PO uruchomieniu (jak Faza 1/2), nie w komendzie. Sesja oznaczona flagą `session.isTest = true`. Wymaga aktywnego AI OCR (`USE_STALKER_AI_OCR=true`). Dostępny też jako przycisk **🧪 Test** w panelu kolejki OCR (obok Faza 1/Faza 2) - `queue_cmd_test`.
     - **Sprzątanie po przycisku "Zakończ" (`test_finish_<sessionId>`):** Po wyświetleniu podsumowania sesja **NIE jest sprzątana automatycznie** - kolejka OCR zostaje zwolniona dopiero po kliknięciu **🏁 Zakończ** (`handleTestFinishButton`). Zabezpieczenie: po pokazaniu podsumowania `refreshOCRSession()` odświeża 15-min timeout, więc gdy admin nie kliknie - sesja i tak zwolni kolejkę po wygaśnięciu. Stage zmieniany na `test_completed`, by kolejny upload nie uruchomił testu ponownie. Ścieżki błędu/braku wyników sprzątają sesję od razu (flaga `deferCleanup`).
     - **Niezawodne dostarczanie wyniku (`deliverResult`):** Podsumowanie próbuje `editReply` → `followUp` (ephemeral) → fallback na zwykłą wiadomość na kanale z pingiem użytkownika, gdy token interakcji wygasł. Zapobiega sytuacji "logi OK, ale brak podsumowania na czacie" (wcześniej `editEphemeral` po cichu połykał błędy).
7. **AI Chat** - `aiChatService.js`: Mention @Stalker → rozmowa na dowolny temat, Anthropic API (Claude 3 Haiku), cooldown 5min, **bez pamięci kontekstu** (każde pytanie niezależne)
8. **Broadcast Messages** - `broadcastMessageService.js`: `/msg` (admin) - wysyłanie wiadomości na wszystkie kanały tekstowe, rate limit protection (1s między kanałami), persistent storage messageId, `/msg` bez tekstu → usuwanie wszystkich poprzednich wiadomości
9. **Kalkulator** - Auto-odpowiedź na słowo "kalkulator" w wiadomości → link do sio-tools.exp0.dev/?migrate=1, cooldown 1h per kanał (persistencja w `data/calculator_cooldowns.json`)
12. **Kalkulator Embed** - `kalkulatorEmbedService.js`: System dzielenia mocą obliczeniową kalkulatora na kanale `1490035500126310460`. Embed tworzony raz przy starcie, potem tylko edytowany. Dwie sekcje: **Prośby o kalkulację** (sortowane wg pozycji w rankingu Stalker — najsilniejsi na górze) i **Pomagający** (pary pomocnik→proszący). Przyciski:
   - 🟢 **Poproś o kalkulację** → modal z polami: link + punkty → wpis na liście
   - 🔵 **Pomóż w przeliczeniu** → przydziela pomocnikowi pierwszą wolną prośbę (najsilniejszy w rankingu), ephemeral z linkiem/punktami + przycisk **Zwróć przeliczone**
   - **Zwróć przeliczone** (w ephemeral) → DM do właściciela linku ze zwrotem, usunięcie z obu list
   - Persistencja: `data/kalkulator_embed.json` (messageId + requests[] + helpers[])
10. **Borixoning** - Auto-odpowiedź na reply "zbij bossa" na kanałach WARNING → komunikat "Wykryto zaawansowany Borixoning" z przyciskami Tak/Nie (ephemeral), cooldown raz dziennie per kanał (kasuje się o północy, persistencja w `data/boroxoning_cooldowns.json`)
11. **Reakcja Stalker** - Gdy ktoś napisze słowo "stalker" (case-insensitive) w wiadomości na serwerze → bot dodaje reakcję `<a:PepeEvil2:1280068960787632130>` (bez cooldownu)
14. **Kody Podarunkowe Habby** - `giftcodeService.js`: System zbierania ID graczy i masowej aktywacji kodów podarunkowych przez Habby API (bez captcha).
   - **Zbieranie ID przez przycisk:** Na kanale `1191791557607690442` zawsze na samym dole widnieje zielony przycisk "🎮 Dodaj swoje ID". Po kliknięciu otwiera modal z polem tekstowym. Każdy użytkownik może zapisać tylko jedno ID. Wymagana rola klanowa (targetRoles). Po zapisaniu ID → automatyczna aktywacja kodów z ostatnich 30 dni.
   - **Aktualizacja przycisku:** Przy każdej nowej wiadomości na kanale bot sprawdza czy ostatnia wiadomość to jego przycisk — jeśli nie, usuwa stary i postuje nowy na dole. MessageId zapisywany w `data/giftcode_button.json`.
   - `/remove-id` — administrator usuwa własne lub cudze ID (opcjonalny parametr `user`). Tylko administrator.
   - `/list-ids` — administrator widzi listę wszystkich zapisanych ID (ephemeral). Tylko administrator.
   - `/giftcode [kod]` — administrator uruchamia masową aktywację. Bez parametru → aktywuje wszystkie kody z ostatniego miesiąca (z `giftcode_claimed.json`). Z parametrem → aktywuje podany kod. Tylko administrator.
   - **Mechanizm API:** Habby Store API (`prod-mail.habbyservice.com/Survivor/api/v1`): `POST /giftcode/redeem` z `{ userId, giftCode }` — bez captchy. 500ms opóźnienie między UIDs.
   - **Klasyfikacja błędów:** Permanent errors (kody 20402–20407) → bez retry. Kody 20402/20407 = już odebrano (claimed). Pozostałe → `retryable: true`.
   - **Auto-wykrywanie kodów:** Bot nasłuchuje na kanale giftcode na wiadomości z linkiem zawierającym `giftcode=KOD` — wykrywa kody z wiadomości użytkowników i webhooków. Uruchamia masową aktywację z logowaniem na ten sam kanał.
   - **Śledzenie per kod:** `data/giftcode_claimed.json` — format `{ "KOD": { "firstUsed": ISO_date, "claimed": ["discordId1", ...] } }`. Kod pomijany dla graczy już sklasyfikowanych jako claimed. `firstUsed` ustawiany przy pierwszym użyciu kodu.
   - **Abort:** Przycisk "⏹️ Przerwij" podczas aktywacji. Stan w `client._giftcodeAbort` Map (per sesja).
   - Persistencja: `data/habby_uids.json` i `data/giftcode_claimed.json` — dane przeżywają restart bota.
11. **Historia Walk Gary** - `garyCombatIngestionService.js`: Co środę o 18:55 (9 min po snapshocie Gary) agreguje pliki z `shared_data/lme_weekly/week_YYYY_WW.json` (jeden plik per tydzień), dopasowuje fuzzy nicki graczy do Discord userId (threshold 0.82, ALL 4 role klanowe), zapisuje do `data/player_combat_discord.json`. Przy starcie bota: automatyczna próba ingestion (po 15s). Komendy `/player-status` i `/player-compare` czytają historię RC+TC i ataku po userId (2 dodatkowe wykresy + dane tekstowe ostatniego tygodnia w sekcji STATYSTYKI i Best — atak wyświetlany jako dokładna liczba z separatorem polskim, nie K/M). Ręcznie: `/lme-snapshot` (admin) — uruchamia ingestion natychmiast i wyświetla **szczegółowy raport**:
    - ✅ Dopasowanych / 📊 Łącznie w Gary / ⚠️ Nieprzypisane (Gary)
    - 🔍 Wpisy Gary z za niskim podobieństwem nicku (< 0.82) → pokazuje najbliższy Discord nick z procentem
    - 📭 Wpisy Gary bez danych tygodniowych (brak wpisów week)
    - 🚫 Wpisy Gary bez ról klanowych w gildii
    - 👥 Klanowcy bez przypisanych danych → odwrotne wyszukiwanie: najbliższy wpis Gary z procentem

**Przypomnienia** - `reminderService.js`: DM z przyciskiem potwierdzenia, monitorowanie odpowiedzi DM (losowe polskie odpowiedzi, repost na kanały potwierdzenia), auto-cleanup po deadline
- **Tracking Potwierdzeń:** `reminderStatusTrackingService.js` - embed na kanale WARNING (nie CONFIRMATION) z godziną potwierdzenia obok nicku
- Format: `✅ NickName • 14:27` - pokazuje kiedy użytkownik potwierdził (oba przypomnienia w jednym embedzie)
- Struktura: `tracking.reminders[]` - tablica z obu przypomnieniami (reminderNumber, sentAt, users)
- Klucz trackingu: `{roleId}_YYYY-MM-DD` gdzie roleId = rola klanu moderatora (session.userClanRoleId)
- Aktualizacja przez usunięcie i ponowne wysłanie embeda (świeża pozycja na dole czatu)
- **`updateUserStatus` fallback**: Jeśli tracking nie jest znajdowany po roleId użytkownika (moderator z innego klanu), przeszukuje wszystkie trackings z dzisiaj szukając userId. Szuka userId w WSZYSTKICH reminderach (nie tylko najnowszym).
- **`handleConfirmReminderButton` używa `deferUpdate()` natychmiast** - przed wszystkimi operacjami sieciowymi/I/O, potem `editReply()` / `followUp()`. Zapobiega wygasaniu interakcji Discord (limit 3s) gdy fetch guild lub I/O pliku trwa dłużej.

**Mapowanie Nicków** - System automatycznego mapowania użytkowników po zmianie nicku Discord:
- `databaseService.js`: Indeks graczy `player_index.json` (userId → latestNick + allNicks)
- `findUserIdByNick()`: Wyszukuje userId na podstawie nicku (stary lub nowy)
- Komendy `/progres`, `/player-status`, `/clan-status` używają spójnego mechanizmu:
  1. Discord ID użytkownika → aktualny klan (z roli Discord)
  2. Szukanie w indeksie po nicku → userId + latestNick
  3. Wyszukiwanie danych OCR po userId (nie po nicku!)
  4. Wyświetlanie gracza w aktualnym klanie z ostatnim nickiem z danych
- Funkcja `createGlobalPlayerRanking()`: Używa `userId` jako klucza w mapie zamiast `displayName`
- Struktura rankingu: `{ userId, playerName, maxScore, clanName, clanKey }`
- Gracze są widoczni w rankingach niezależnie od zmiany nicku Discord

**Raport Problematycznych Graczy** - `/player-raport` (tylko admini i moderatorzy):
- Wybór klanu → analiza wszystkich członków klanu
- Kryteria problemu (przynajmniej jedno musi być spełnione):
  - 🔴 Rzetelność < 90%
  - 🔴 Punktualność < 70%
  - 🔴 Zaangażowanie < 70%
  - 🔴 Responsywność < 25%
  - 🪦 Trend gwałtownie malejący (trendRatio ≤ 0.5)
  - ⚠️ Progres miesięczny < 25 punktów (min 5 tygodni danych)
  - ⚠️ Progres kwartalny < 100 punktów (min 13 tygodni danych)
- Embed z polami: każdy gracz osobno, posortowani według liczby problemów
- Ephemeral (tylko dla wywołującego), max 25 graczy w raporcie

**Progres Klanu** - `/clan-progres` (członkowie klanu i administratorzy):
- Wybór klanu przez select menu (Main, Clan 2, Clan 1, Clan 0)
- Wyświetla progres TOP30 klanu (suma wyników 30 najlepszych graczy) przez ostatnie 54 tygodnie
- **4 Wykresy (podobne do `/player-status`, ale dla klanu):**
  1. **TOP30 Progres (Faza 1):** Zielona linia pokazująca sumy TOP30 przez tygodnie - `generateClanProgressChart()`
  2. **Ranking Klanu:** Złota linia pokazująca pozycję klanu w globalnym rankingu (oś Y odwrócona) - `generateClanRankChart()`
  3. **RC+TC:** Zielona linia pokazująca łączne Relic Cores + Transmute Cores - `generateCombatChart()`
  4. **Atak:** Czerwona linia pokazująca łączną siłę ataku klanu - `generateCombatChart()`
  - Wszystkie wykresy: Catmull-Rom spline, automatyczne ukrywanie co drugiej etykiety gdy >20 tygodni
  - Każdy wykres w osobnym embedzie (4 embedy razem)
- **Historia Gary:** Wczytywana przez `loadClanGuildHistory()` z `shared_data/lme_guilds/week_YYYY_WW.json`
  - Mapowanie klanu przez `config.garyGuildIds[clanKey]`
  - Ostatnie 20 tygodni snapshots
- **Skumulowany progres/regres (tylko TOP30 Faza 1):**
  - 🔹 Miesiąc (4 tyg) / 🔷 Kwartał (13 tyg) / 🔶 Pół roku (26 tyg)
  - Format: ▲ wzrost, ▼ spadek z separatorem polskim
- **Progress bary:** Historia wyników TOP30 z superskryptami pokazującymi zmiany tydzień-do-tygodnia
- **Snapshot Gary:** Opcjonalne pole z danymi klanu (rank, grade score, RC+TC, siła ataku) - najnowszy tydzień
- **Auto-usuwanie:** Embed usuwany po 5 minutach przez `raportCleanupService`
- Dostępna na kanałach WARNING + kanał specjalny + administratorzy/moderatorzy

**Obliczanie Progresu** - Logika dla `/progres`, `/player-status`, `/player-raport`, `/clan-progres`:
- **Progres miesięczny:** Najwyższy wynik z ostatnich 4 tygodni vs tydzień 5 (min 5 tygodni)
- **Progres kwartalny:** Najwyższy wynik z ostatnich 12 tygodni vs tydzień 13 (min 13 tygodni)
- **Dostępne dane:** Najwyższy ze wszystkich vs najstarszy wynik > 0
- Zapobiega fałszywym regresom gdy ostatni tydzień = 0

**Optymalizacje Wydajności:**
- **Cache indeksów:** `playerIndexCache` Map w DatabaseService (pierwsze wywołanie ~100ms, kolejne <1ms)
- **Throttling fetch:** `safeFetchMembers()` - 30s cooldown per guild, zapobiega rate limit Gateway (opcode 8)
- **Autocomplete timeout:** 2.5s protection z pustą odpowiedzią jako fallback

**Komenda /img i Przycisk "📷 Dodaj zdjęcie rankingu"** - Dodawanie zdjęć z tabelą wyników:
- Workflow: Wybór tygodnia (z listy wszystkich dostępnych) → Upload zdjęcia (1 min timeout) → Repost na kanał archiwum Discord
- **Przechowywanie:** Zdjęcia są repostowane na kanał archiwum (ID: `1470000330556309546`) z embedem zawierającym nazwę klanu i tydzień. URL obrazu zapisywany w `data/ranking_image_urls.json`
- **Format klucza JSON:** `{guildId}_{year}_{weekNumber}_{clan}` → `{ url, messageId, channelId, addedBy, addedAt }`
- **Auto-naprawa przy starcie:** `imageUrlFixer.js` - wykrywa wpisy bez `url` (np. z transferu), pobiera wiadomość po `messageId` z kanału archiwum i uzupełnia brakujący URL. Uruchamia się przy każdym starcie bota.
- **Uprawnienia:** Tylko administratorzy i moderatorzy (allowedPunishRoles)
- **Detekcja klanu:** Automatyczna detekcja z roli użytkownika (admin/moderator musi mieć rolę klanową)
- **Dostępność:** Komenda `/img` + przycisk "📷 Dodaj zdjęcie rankingu" na embedzie kolejki OCR (drugi rząd przycisków)
- **NIE używa kolejki OCR:** Komenda nie korzysta z systemu kolejkowania OCR (działa niezależnie)
- **Dostępne tygodnie:** Lista wszystkich tygodni z zapisanymi wynikami (Faza 1 LUB Faza 2) dla wybranego klanu (max 25)
- **Logika agregacji:** Tygodnie z obu faz są łączone i deduplikowane, etykieta pokazuje które fazy są dostępne (F1, F2, F1+F2)
- Obsługiwane formaty: PNG, JPG, JPEG, WEBP, GIF
- **Wyświetlanie:** Zdjęcie pojawia się automatycznie na dole embedu w `/wyniki` dla **wszystkich widoków** (Faza 1, Runda 1, 2, 3, Suma) - używa URL z Discord zamiast pliku lokalnego
- Auto-usuwanie: Wiadomość użytkownika ze zdjęciem jest automatycznie usuwana po zapisie
- Message Collector: 1 minuta na przesłanie zdjęcia, walidacja typu pliku

**Wykresy z Ikonami Klanów** - `/progres` i `/player-status` wyświetlają ikony klanów przy każdym słupku:
- **Ikony klanów:** 🎮 (Clan 0), ⚡ (Clan 1), 💥 (Clan 2), 🔥 (Main)
- **Ikona pustego miejsca:** `<:ZZ_Pusto:1209494954762829866>` (custom emoji) - dla tygodni bez wyniku
- **Format wykresu:** `🎮 ██████░░░░ 51/25 - 547 ▲²⁵`
- **Logika:** Ikona wyciągana z pierwszego znaku `clanName` (np. "🎮PolskiSquad⁰🎮" → "🎮")
- **Implementacja:** `clanEmojiMap` - mapa weekKey → emoji klanu dla szybkiego dostępu

**Integracja CX w `/player-status`** - Dane z Kontroler Bot (shared_data/cx_history.json):
- **Wczytywanie:** Po posortowaniu `playerProgressData`, bot odczytuje `shared_data/cx_history.json` szukając `userId` gracza
- **Zaangażowanie bonus:** Jeśli gracz ma dane CX → +5% do `engagementFactor` (max 100%) - CX nie karze za brak
- **Złota gwiazdka ⭐:** Przy kółku Zaangażowania jeśli gracz wykonuje CX (`💪 **Zaangażowanie:** 🟢 ⭐`)
- **Kary i status:** `🏆 **Wykonuje CX:** Tak ✅` lub `Nie` na końcu sekcji
- **Źródło danych:** Kontroler Bot zapisuje wyniki przy udanym OCR na kanale CX do `shared_data/cx_history.json` (userId jako klucz, historia do 20 wyników)

**Integracja Enders Echo w `/player-status` i `/player-compare`** - Dane z EndersEcho Bot (shared_data/endersecho_ranking.json):
- **Wczytywanie:** Po wczytaniu CX, bot odczytuje `shared_data/endersecho_ranking.json` szukając `userId` gracza
- **Wyświetlanie w `/player-status`:** Linia `🏹 **Enders Echo:** #X / Y — rekord: **score**` w sekcji STATYSTYKI, tuż pod linią `⚔️ Atak`
- **Wyświetlanie w `/player-compare`:** Linia `🏹 **EE:** #X/Y — score` w polu gracza (`fmtPlayerField`)
- **Brak danych:** Sekcja/linia jest pomijana gdy gracz nie ma wpisu w rankingu EE
- **Źródło danych:** EndersEcho Bot eksportuje po każdym `/update` i przy starcie do `shared_data/endersecho_ranking.json` (posortowana lista z rank, userId, username, score, scoreValue)

**Graficzny Trend w `/player-status`** - Osobna sekcja poniżej współczynników:
- **Nagłówek:** `### 💨 TREND` z opisem słownym i ikoną (`**Rosnący** ↗️`)
- **Sparkline:** 12 znaków Unicode blokowych (`▁▂▃▄▅▆▇█`) od najstarszego (lewo) do najnowszego (prawo)
- **Puste tygodnie:** Symbol `·` dla tygodni bez danych
- **Format:** `` `▁▂▃▄▅▆▇█····` *(12 tyg.)* ``
- **Skala:** Dynamiczna - min(nonZero) = `▁`, max(nonZero) = `█`, proporcjonalnie dla reszty
- **Implementacja:** `sparklineData = last12Weeks.map(...).reverse()` - reverse bo last12Weeks jest od najnowszego
- **Algorytm trendRatio (wykres + tekst):** Wymaga min. 13 tygodni z wynikiem > 0
  - `progress4 = score_newest - score_4_weeks_ago`
  - `progress12 = score_newest - score_12_weeks_ago`
  - `trendRatio = (progress12 / 3) / progress4` (clamp 0–2.0; 0 gdy progress4 ≤ 0)
  - Wysoki ratio → kwartalna średnia silniejsza niż ostatni miesiąc (dobra długoterminowa trajektoria)
  - Niski ratio → ostatni miesiąc wyprzedza kwartalną średnią
  - Wykres rolling: liczony dla każdego tygodnia od indeksu 12 wzwyż (nie cała historia)

**Komenda `/player-compare`** - Porównanie dwóch graczy:
- **Parametry:** `gracz1` (autocomplete), `gracz2` (autocomplete) - obydwa z listy graczy
- **Dostęp:** Publiczny (publicCommands) - dostępny dla wszystkich członków klanu
- **Sekcje embeda (kolor #9B59B6):**
  - Nagłówek: `⚔️ PORÓWNANIE GRACZY` + ostatni wynik każdego
  - `📊 STATYSTYKI`: Miesięczny progres i najlepszy wynik side-by-side
  - `🌡️ WSPÓŁCZYNNIKI`: Zaangażowanie (z ⭐ jeśli CX) + Wykonuje CX po obu stronach
  - `💨 TREND`: Opis trendu + sparkline dla każdego gracza
- **Autocomplete:** Wspólny handler z `/progres` i `/player-status`
- **Logika:** `loadPlayerData()`, `calcMetrics()`, `genSparkline()` - lokalne funkcje pomocnicze wewnątrz komendy
- **CX boost:** Identyczny jak w `/player-status` - +5% do zaangażowania

**Sekcja MVP w `/player-status`** - Tygodnie gdzie gracz był w TOP3 progresu:
- **Nazwa sekcji:** `### ⭐ MVP TYGODNIA`
- **Lokalizacja:** Pod sekcją "STATYSTYKI", przed "WSPÓŁCZYNNIKI"
- **Format:** `🥇 **51/25** - 1,547 (+125)` (medal, tydzień/rok, wynik, progres)
- **Medale:** 🥇 (1. miejsce), 🥈 (2. miejsce), 🥉 (3. miejsce)
- **Kolejność:** Od najnowszego do najstarszego tygodnia
- **Logika obliczania TOP3:**
  - Dla każdego tygodnia z ostatnich 12: sprawdza w jakim klanie użytkownik był
  - Buduje TOP3 TYLKO dla tego klanu (identycznie jak `/wyniki` pokazuje TOP3 dla wybranego klanu)
  - Dla każdego gracza z tego klanu: szuka NAJLEPSZEGO wyniku przed tym tygodniem
  - Oblicza progres = aktualny wynik - najlepszy historyczny wynik
  - **Warunek:** Gracz musi mieć wcześniejszy wynik > 0 (tak samo jak w `/wyniki`) - zapobiega liczeniu pełnego wyniku jako progresu dla nowych graczy
  - Sortuje po progresie i wybiera TOP3
  - Sprawdza czy użytkownik jest w TOP3 swojego klanu
- **Spójność:** Używa tej samej metodologii co `/wyniki` - TOP3 per klan, porównanie z najlepszym historycznym wynikiem, wymóg previousBestScore > 0

**AI Chat** - Prosty system rozmowy z AI (mention @Stalker):
- **Trigger:** Bezpośrednie oznaczenie @Stalker + wiadomość (max 300 znaków)
  - Ignoruje: wzmianki przez role bota, @everyone/@here, odpowiedzi na wiadomości bota
- **Model:** Claude 3 Haiku (Anthropic API) - szybki, tani (~$0.0006 za pytanie)
- **Limity:**
  - Cooldown: 5 minut per użytkownik
  - **Administratorzy/moderatorzy:** Bez cooldownu (role MODERATOR_ROLE_1-4)
  - Persistent storage: `ai_chat_cooldowns.json`
- **Uprawnienia:** Tylko członkowie klanów (rola TARGET_ROLE_0/1/2/MAIN)
- **Kanały:** Wszystkie kanały na serwerze
- **Funkcjonalność:**
  - Rozmowa na dowolny temat
  - **Brak pamięci kontekstu** - każde pytanie jest niezależne
  - Odpowiedzi po polsku
  - **Typing indicator** podczas przetwarzania
- **Przykłady użycia:**
  - `@Stalker Hej, jak się masz?`
  - `@Stalker Opowiedz mi dowcip`
  - `@Stalker Co sądzisz o pogodzie?`
- **Graceful degradation:** Bot działa normalnie jeśli `ANTHROPIC_API_KEY` nie jest ustawiony (AI Chat wyłączony)
- **Persistent cooldowns:** Cleanup starych danych (>2 dni) przy starcie
- **ENV:** `ANTHROPIC_API_KEY` (opcjonalne), `STALKER_LME_AI_CHAT_MODEL` (opcjonalne, default: claude-3-haiku-20240307)

**Komendy:** `/punish`, `/remind`, `/punishment`, `/points`, `/faza1`, `/faza2`, `/test`, `/wyniki`, `/img`, `/progres`, `/player-status`, `/player-compare`, `/clan-status`, `/clan-progres`, `/player-raport`, `/core-ranking`, `/msg`, `/ocr-debug`

**Core Ranking** - `/core-ranking` (publiczna dla członków klanu):
- Ephemeral z 6 przyciskami (jeden per typ cora, każdy z ikoną custom emoji)
- Po kliknięciu: ranking graczy według ilości wybranego cora (malejąco)
- Format linii: `#1 Nick **ilość** 🔥` (pozycja, nick, pogrubiona ilość, ikona klanu)
- Brak klanu → ikona 💀
- Dane z `data/equipment_data.json` (zapisywane przez "Skanuj ekwipunek")
- Max 30 pozycji w rankingu (z informacją o liczbie pozostałych)

**Env:** TOKEN, MODERATOR_ROLE_1-4, PUNISHMENT_ROLE_ID, LOTTERY_BAN_ROLE_ID, TARGET_ROLE_0/1/2/MAIN, WARNING_CHANNEL_0/1/2/MAIN, CONFIRMATION_CHANNEL_0/1/2/MAIN, VACATION_CHANNEL_ID

---


## Zmienne Środowiskowe

```env
# Token bota
STALKER_LME_DISCORD_TOKEN=bot_token_here

# Role moderatorów
STALKER_LME_MODERATOR_ROLE_1=role_id
STALKER_LME_MODERATOR_ROLE_2=role_id
STALKER_LME_MODERATOR_ROLE_3=role_id
STALKER_LME_MODERATOR_ROLE_4=role_id

# Role systemowe
STALKER_LME_PUNISHMENT_ROLE_ID=role_id
STALKER_LME_LOTTERY_BAN_ROLE_ID=role_id

# Role klanowe
STALKER_LME_TARGET_ROLE_0=role_id
STALKER_LME_TARGET_ROLE_1=role_id
STALKER_LME_TARGET_ROLE_2=role_id
STALKER_LME_TARGET_ROLE_MAIN=role_id

# Kanały ostrzeżeń
STALKER_LME_WARNING_CHANNEL_0=channel_id
STALKER_LME_WARNING_CHANNEL_1=channel_id
STALKER_LME_WARNING_CHANNEL_2=channel_id
STALKER_LME_WARNING_CHANNEL_MAIN=channel_id

# Kanały potwierdzeń
STALKER_LME_CONFIRMATION_CHANNEL_0=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_1=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_2=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_MAIN=channel_id

# Inne
STALKER_LME_VACATION_CHANNEL_ID=channel_id

# AI Chat (opcjonalne)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
STALKER_LME_AI_CHAT_MODEL=claude-3-haiku-20240307

# AI OCR Google Gemini (opcjonalne)
USE_STALKER_AI_OCR=false
STALKER_GOOGLE_AI_API_KEY=AIzaSy-xxxxxxxxxxxxx
STALKER_GOOGLE_AI_MODEL=gemini-2.5-flash-preview-05-20

```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Stalker')
- **OCR Debug:** `/ocr-debug true` dla szczegółowych logów
- **Throttling:** safeFetchMembers() z 30s cooldownem
- **Cache:** playerIndexCache dla szybkiego autocomplete
- **Persistencja:** Fazy zapisywane w data/phases/
