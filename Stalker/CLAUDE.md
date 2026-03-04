### ⚔️ Stalker Bot

**9 Systemów:**
1. **Kary OCR** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, upscaling 3x, gamma 3.0, Levenshtein matching, wykrywanie 0
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Anthropic API (Claude Vision), analiza wyników graczy przez AI
     - Włączany przez `USE_STALKER_AI_OCR=true` w .env
     - Używa tego samego modelu co AI Chat (domyślnie: Claude 3 Haiku)
     - Prompt: "Przeanalizuj zdjęcie z wynikami poszczególnych graczy oraz zwróć kompletne nicki oraz wyniki w następującym formacie: <nick> - <wynik>"
     - Automatyczny fallback na tradycyjny OCR gdy AI zawiedzie
     - Dotyczy komend: `/punish`, `/remind`, `/faza1`, `/faza2`
2. **Punkty** - `punishmentService.js`: 2pts=kara, 3pts=ban loterii, cron czyszczenie (pn 00:00)
3. **Urlopy** - `vacationService.js`: Przycisk → rola 15min, cooldown 6h
4. **Dekoder** - `decodeService.js`: `/decode` dla Survivor.io (LZMA decompress)
5. **Kolejkowanie OCR** - `queueService.js`: Jeden user/guild, progress bar, 15min timeout, przyciski komend
6. **Fazy Lunar** - `phaseService.js`: `/faza1` (lista), `/faza2` (3 rundy damage), `/wyniki` (TOP30 z paginacją tygodni), `/progres`, `/clan-status`, `/clan-progres` (progres TOP30 klanu z wykresem), `/img` (dodaj zdjęcie tabeli do Fazy 2)
7. **AI Chat** - `aiChatService.js`: Mention @Stalker → rozmowa na dowolny temat, Anthropic API (Claude 3 Haiku), cooldown 5min, **bez pamięci kontekstu** (każde pytanie niezależne)
8. **Broadcast Messages** - `broadcastMessageService.js`: `/msg` (admin) - wysyłanie wiadomości na wszystkie kanały tekstowe, rate limit protection (1s między kanałami), persistent storage messageId, `/msg` bez tekstu → usuwanie wszystkich poprzednich wiadomości
9. **Kalkulator** - Auto-odpowiedź na słowo "kalkulator" w wiadomości → link do sio-tools.vercel.app, cooldown 1h per kanał (persistencja w `data/calculator_cooldowns.json`)
10. **Borixoning** - Auto-odpowiedź na reply "zbij bossa" na kanałach WARNING → komunikat "Wykryto zaawansowany Borixoning" z przyciskami Tak/Nie (ephemeral), cooldown raz dziennie per kanał (kasuje się o północy, persistencja w `data/boroxoning_cooldowns.json`)
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
- Aktualizacja przez usunięcie i ponowne wysłanie embeda (świeża pozycja na dole czatu)

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

**Graficzny Trend w `/player-status`** - Osobna sekcja poniżej współczynników:
- **Nagłówek:** `### 💨 TREND` z opisem słownym i ikoną (`**Rosnący** ↗️`)
- **Sparkline:** 12 znaków Unicode blokowych (`▁▂▃▄▅▆▇█`) od najstarszego (lewo) do najnowszego (prawo)
- **Puste tygodnie:** Symbol `·` dla tygodni bez danych
- **Format:** `` `▁▂▃▄▅▆▇█····` *(12 tyg.)* ``
- **Skala:** Dynamiczna - min(nonZero) = `▁`, max(nonZero) = `█`, proporcjonalnie dla reszty
- **Implementacja:** `sparklineData = last12Weeks.map(...).reverse()` - reverse bo last12Weeks jest od najnowszego

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

**Komendy:** `/punish`, `/remind`, `/punishment`, `/points`, `/decode`, `/faza1`, `/faza2`, `/wyniki`, `/img`, `/progres`, `/player-status`, `/player-compare`, `/clan-status`, `/clan-progres`, `/player-raport`, `/msg`, `/ocr-debug`
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

# AI OCR (opcjonalne)
USE_STALKER_AI_OCR=false
STALKER_LME_AI_OCR_MODEL=claude-3-haiku-20240307
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Stalker')
- **OCR Debug:** `/ocr-debug true` dla szczegółowych logów
- **Throttling:** safeFetchMembers() z 30s cooldownem
- **Cache:** playerIndexCache dla szybkiego autocomplete
- **Persistencja:** Fazy zapisywane w data/phases/
