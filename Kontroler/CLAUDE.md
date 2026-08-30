### 🎯 Kontroler Bot

> ### ⚠️ SILNIK OCR: WYŁĄCZNIE AI — TESSERACT USUNIĘTY
>
> **Kontroler nie ma nawet kodu Tesseract** — dawny `services/ocrService.js` został skasowany,
> `require('tesseract.js')` nie występuje. Jedyny silnik to Google Gemini Vision
> (`services/aiOcrService.js`), bez żadnego fallbacku: brak `KONTROLER_GOOGLE_AI_API_KEY`
> oznacza, że OCR po prostu nie działa.
>
> Ścieżka realna: pobranie screena → binaryzacja `sharp` → base64 → zapytanie do AI.


**6 Systemów:**
1. **AI OCR (kanał Daily)** - `aiOcrService.js` (Google Gemini Vision) + `analysisService.js`: jedyny silnik OCR, **bez fallbacku na Tesseract** (stary `ocrService.js` usunięty). **Kanał CX został usunięty** — bot nie analizuje już screenów CX ani nie nadaje ról CX (zastąpione loterią Glory, system 6)
   - **Silnik:** `aiOcrService.analyzeResultsImage(imagePath)` wysyła zbinaryzowany obraz do Gemini Vision przez wspólny `utils/llmAdapter.js` (DI z `index.js`, `createLlmAdapter({ botSlug: 'kontroler' })`). Prompt prosi o listę `<nick> - <wynik>` całego rankingu. Parsowanie jak w Stalkerze (`parseAIResponse`), wykrywanie niepoprawnego screena po słowach kluczowych ("nie wykryto", "brak wyników" itd.)
   - **Binaryzacja przed AI (`_binarizeWhiteOnBlack`):** przed wysłaniem do AI obraz jest przerabiany — białe piksele zostają białe, cała reszta na czarno (biały tekst na czarnym tle). Piksel uznawany za biały gdy WSZYSTKIE kanały R/G/B ≥ `config.ocr.whiteThreshold` (domyślnie 200). Raw-pixel przez `sharp`
   - **Retry 503 (przeciążone API):** 10× exponential backoff → po wyczerpaniu rzuca `isAPIOverloaded=true`. Inne retryable (429/500/sieciowe): 3×
   - **Dopasowanie gracza (`analysisService.findMatchingPlayer`):** wśród odczytanych graczy szuka nicku serwera — FAZA 1 dokładne dopasowanie (normalizacja: lowercase, tylko litery/cyfry + polskie znaki, dwukierunkowe `includes`), FAZA 2 podobieństwo Levenshtein (`isSimilarNick`, próg `similarity.threshold` 0.4 → `lowThreshold` 0.3). Brak konceptu "drugie wystąpienie nicku" (AI zwraca jeden wpis per gracz)
   - **Walidacja wyniku (`validateScore`):** liczba z AI sprawdzana wobec konfiguracji kanału Daily (910min, zakres 0-1050, krok 10). Poza krokiem → zaokrąglenie do najbliższej wielokrotności. Poza zakresem → odrzucenie
   - **Env:** `KONTROLER_GOOGLE_AI_API_KEY` (fallback `ENDERSECHO_GOOGLE_AI_API_KEY`/`GOOGLE_AI_API_KEY`), `KONTROLER_GOOGLE_AI_MODEL` (domyślnie `gemini-2.5-flash-lite`). Bez klucza OCR nie zadziała (brak fallbacku)
2. **Loteria** - `lotteryService.js`: Daty (dd.mm.yyyy HH:MM) w **czasie polskim** (Europe/Warsaw, niezależnie od strefy serwera), DST auto, multi-klan (server/main/0/1/2), cykle (0-365dni, max 24d), ostrzeżenia (90/30min), historia+przelosowanie, ban filter
   - **Czas polski (`utils/timezone.js`):** Bot operuje w strefie Europe/Warsaw niezależnie od strefy czasowej serwera (np. UTC). `polandWallClockToUTC(y,m,d,h,min)` przelicza polski zegar ścienny na poprawny moment UTC (DST przez `Intl`), `getPolandParts()` zwraca komponenty czasu polskiego "teraz" (walidacja dat, klucze ostrzeżeń), `formatPolandDateTime/Date/Time()` formatują do wyświetlenia. Tworzenie loterii, obliczanie kolejnych losowań, walidacja daty i wszystkie wyświetlane daty używają czasu polskiego.
3. **Dywersja w klanie** - `votingService.js`:
   - Trigger: Fraza "działasz na szkodę klanu" w odpowiedzi do użytkownika
   - Głosowanie: 15 minut (przyciski Tak/Nie), ping roli klanowej
   - Wynik: >50% TAK → rola Dywersanta 24h, remis → powtórka (max 3 razy)
   - Cooldown: 7 dni per użytkownik
   - **Persistencja:** 3 pliki JSON (active_votes.json, vote_history.json, saboteur_roles.json)
   - **Restart-safe:** Przywracanie timerów głosowań i usuwania ról po restarcie bota
4. **Oligopoly** - `oligopolyService.js`:
   - System zarządzania ID graczy pogrupowanych po klanach
   - Automatyczna detekcja klanu na podstawie roli użytkownika
   - Zabezpieczenie przed duplikatami ID
   - Aktualizacja wpisów (jeden wpis per użytkownik per klan)
   - **Persistencja:** `oligopoly.json` (userId, username, serverNickname, klan, id, timestamp)
   - **Komendy:** `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`
5. **MVP tygodnia** - `mvpService.js`:
   - **Cel:** Głosowanie na najlepszy **tekst** (nie osobę) z minionego tygodnia; nagradza jego autora. Kwalifikacja po reakcji `<:z_Kekw:1219657372713226382>` (dopasowanie po ID emoji)
   - **Harmonogram (czas polski Europe/Warsaw, DST auto przez `utils/timezone.js`):**
     - **Czwartek 22:05** → skan wszystkich kanałów tekstowych/ogłoszeń (poza `excludedChannels` + kanał ankiety) 7 dni wstecz; pomija wiadomości botów; post ankiety z `@everyone` na kanale `1514700582609358974`
     - **Piątek 22:05** (24h później) → zamknięcie ankiety, ogłoszenie zwycięzcy z `@everyone`, zdjęcie roli `1514704005719134389` WSZYSTKIM i nadanie jej zwycięzcy na kolejny tydzień
   - **Dobór kandydatów (`selectCandidates`):** 1 (najlepszy) tekst na osobę; ranking osób wg liczby KEKW; bazowo `targetAuthors`=3 różnych autorów, ale przy **remisie na granicy** wchodzą wszyscy remisujący (np. KEKW 5/4/3/3 → 4 teksty). Najlepszy tekst danej osoby: najwięcej KEKW → remis: najwięcej **pozostałych** reakcji (poza KEKW) → remis: wcześniejszy. Twardy limit = liczba emoji (10)
   - **Treść ankiety — jedna wypowiedź = jeden embed (`buildCandidateEmbed`):** Nagłówek (`content`) z `@everyone` + zaproszeniem do głosowania, następnie **osobny embed dla każdej wypowiedzi** i na końcu embed-stopka z zasadami i deadlinem (`<t:X:R>`). Wszystko w JEDNEJ wiadomości — reakcje do głosowania muszą siedzieć na jednym poście. Stopka dokładana tylko gdy kandydatów ≤ 9 (twardy limit Discorda: 10 embedów/wiadomość)
     - **Budowa embeda kandydata:** `author` = `{numer głosowania}  {nick}` z linkiem do oryginału; `description` = cytat w bloku cytatu (`buildQuoteBlock`, zachowuje łamanie linii, max 400 znaków, domyka „…"); `thumbnail` = **awatar autora wypowiedzi**; `image` = załącznik graficzny; pola inline: `😹 Zebrane KEKW`, `📍 Kanał`, `🔗 Źródło`; `footer` = „Zagłosuj reakcją N" + `timestamp` wypowiedzi
     - **Kolory (`candidateColor`):** każda wypowiedź ma własny kolor z 10-elementowej palety (numer pozycji), **dzika karta zawsze fioletowa** `0x9B59B6` + tytuł `🃏 Dzika karta od MVP`
     - **Nicki tekstem, nie wzmianką:** w embedach nicki są zwykłym tekstem (`authorDisplay`), bo Discord renderuje `<@id>` w embedzie jako nick tylko gdy user jest w cache klienta. Wzmianki (i ping) wyłącznie w `content` wiadomości
   - **Riposta (kontekst odpowiedzi, `buildReplyContext` + `buildReplyField`):** Jeśli kandydująca wypowiedź jest odpowiedzią (reply), embed dostaje pole `↩️ Riposta na wypowiedź` z nickiem autora oryginału, linkiem `[↗ oryginał]` i cytatem treści (do 160 znaków; puste → `[obrazek]`/`[załącznik]`). Kontekst pobierany przez `msg.fetchReference()` podczas skanu i zapisywany w polu `replyTo` kandydata (`mvp_state.json`: authorId, authorDisplay, authorAvatar, content, hasAttachment, imageUrl, url) — odporne na restart i usunięcie oryginału (wtedy kontekst pomijany)
   - **Załączniki graficzne (`extractImageUrl`):** Obrazek wypowiedzi trafia do **pola `image` embeda**. Wykrywanie: załącznik z `contentType: image/*` lub rozszerzeniem png/jpg/gif/webp, a w drugiej kolejności obrazek z auto-embeda (np. link tenor/imgur). Gdy sama wypowiedź nie ma obrazka, ale ma go **ripostowana** wiadomość — pokazywany jest tamten, z adnotacją „obrazek poniżej pochodzi z tej wypowiedzi"
     - **Odświeżanie wygasających linków (`hydrateCandidate`):** podpisane linki CDN Discorda wygasają (~24h), więc przed ogłoszeniem zwycięzcy bot ponownie pobiera wiadomość (i jej referencję) i podmienia URL obrazka; przy okazji dociąga brakujący awatar (stan zapisany przed tą wersją). Awatary z `displayAvatarURL()` nie wygasają
   - **Ogłoszenie zwycięzcy (`buildWinnerPayload`, async):** `content` z `@everyone` + wzmianką zwycięzcy, potem **embed zwycięskiej wypowiedzi** (złoty `0xFFD700`, tytuł `🏆 Zwycięska wypowiedź tygodnia`, cytat, pole riposty, awatar w `thumbnail`, obrazek w `image`, pola: `🗳️ Głosy` N z M, `😹 Zebrane KEKW`, `📍 Kanał`, `🔗 Źródło`, stopka z numerem tytułu MVP) oraz **embed `📊 Wyniki głosowania`** z paskami postępu (`buildVoteBar`, `▰▱` ×10), liczbą głosów, procentami i nickami; zwycięzca oznaczony 👑, dzika karta 🃏
   - **Brak kandydatów (`buildNoCandidatesPayload`):** osobny, stonowany embed `😴 MVP TYGODNIA — brak kandydatów` z `@everyone` w `content`
   - **Ankieta reakcyjna:** Bot dodaje 1️⃣2️⃣3️⃣… (po jednej na kandydata, pula `voteEmojis` 1-10). 1 głos/os - kliknięcie innej reakcji kasuje poprzednią. Zliczanie z mapy `state.votes` (userId→opcja, "ostatni klik = ważny głos") - odporne na brak uprawnienia "Zarządzanie wiadomościami" i na restart. Głosy bota nie są liczone w wynikach (`tallyFromState` pomija `client.user.id`). Fizyczne kasowanie poprzedniej reakcji jest kosmetyczne (wymaga Manage Messages), nie wpływa na wynik. Remis w głosach → więcej KEKW → więcej pozostałych reakcji → wcześniejszy
   - **⚠️ Uprawnienia bota:** Do skanu potrzebny dostęp + historia na kanałach; do kasowania starych reakcji (kosmetyka) "Zarządzanie wiadomościami" na kanale ankiety; do roli - uprawnienie zarządzania rolą `1514704005719134389`
   - **Gdy mało kandydatów:** 0 wiadomości z KEKW → ogłoszenie "brak MVP" z `@everyone` (rola nie jest ruszana). 1-2 kandydatów → ankieta ma tylu
   - **Persistencja:** `mvp_state.json` (aktywna ankieta: kandydaci wraz z `authorAvatar`, `imageUrl` i `replyTo`, głosy, czas końca), `mvp_winners.json` (liczniki tytułów per user + `currentWinnerId`)
   - **Restart-safe:** Odtwarzanie timera ankiety (lub natychmiastowa finalizacja gdy wygasła) + przeplanowanie kolejnego skanu przy starcie; resync głosów z reakcji
   - **Komenda:** `/mvp` - publiczny ranking zdobywców tytułu MVP (malejąco wg liczby tytułów + aktualny MVP)
   - **Aprobata MVP (reakcja KEKW aktualnego MVP):** Gdy posiadacz roli MVP tygodnia (`roleId`) zostawi reakcję KEKW pod **cudzym** postem, bot odpala LOSOWY „stempel aprobaty". Niezależne od ankiety tygodniowej.
     - **Losowanie efektu:** pojedynczy los z progami skumulowanymi wg stałych szans: jackpot (`jackpotChance` ~1%) → `textreply` (`textReplyChance` ~9%, „znak jakości", losowy tekst z puli) → `crown` (`crownChance` ~60%) → `stamp` (~30%, reszta — zawsze domyka do 100%)
     - **Efekty:** `stamp` (bot dorzuca pod postem reakcje-pieczęcie — customowe emoji serwerowe KEKW z `stampEmojis`, format `<a:nazwa:id>`/`<:nazwa:id>`, każda w try/catch), `crown` (autor dostaje prefix 👑 w nicku na 1h przez współdzielony `NicknameManager`), `embed` (ozdobny embed gratulacyjny — **wyłącznie** w jackpocie)
     - **Szczęśliwy traf (jackpot, ~1%):** wszystkie efekty naraz (stamp + crown + specjalny embed) **+ dzika karta** 🃏
     - **Dzika karta (`wildcardOnJackpot`):** jackpot nadaje wypowiedzi gwarantowany, dodatkowy wpis do **najbliższej** ankiety MVP tygodnia. Zapisywana w `mvp_approvals.json` (`wildcards[]`, kandydat-kształtny obiekt z `addedAt`), scalana w `scanForCandidates` przez `mergeWildcards` (gwarantowane sloty, dedup po `messageId`, twardy limit = liczba emoji), oznaczona w ankiecie `🃏 dzika karta od MVP`, czyszczona po wystawieniu ankiety (`consumeWildcards`); poza oknem `scanDays` wygasa
     - **Zasady:** jeden post = jeden efekt (dedup po `messageId` w `mvp_approvals.json`, trim do `maxApprovedMemory`); pomija kanał ankiety, `excludedChannels`, posty botów i własne posty MVP; `crown` z fallbackiem na `textreply` gdy autor nieedytowalny (wyższa rola/owner) — embed NIE jest używany poza jackpotem
     - **Brak stackowania korony:** jeśli autor ma już aktywną koronę MVP (`getActiveEffectType === 'mvp_crown'`), ponowne nadanie jest pomijane (standalone `crown` → fallback `textreply`), więc prefix 👑 się nie nakłada
     - **Handler:** `handleApprovalReaction` w `mvpService.js`, podpięty obok `handleReactionAdd` na `MessageReactionAdd` w `index.js`. Korona restart-safe przez `NicknameManager.restoreExpiredEffects` przy starcie
   - **Konfiguracja:** `config.mvp` (pollChannelId, roleId, kekwEmojiId, voteEmojis, scanDays, targetAuthors, maxCandidates, votingDurationMs, scheduleWeekday/Hour/Minute, excludedChannels, **approval**: enabled, crownDurationMs, crownPrefix, jackpotChance, wildcardOnJackpot, textReplyChance, crownChance, stampEmojis, maxApprovedMemory)
6. **Loteria Glory** - `gloryLotteryService.js`: cotygodniowe losowanie rangi Glory Member na podstawie progresu Fazy 1 (dane od Stalkera), **niezależne od `lotteryService`**
   - **Źródło danych:** `shared_data/glory_progress.json` — eksportowane przez Stalkera (`gloryProgressExportService.js`, po każdym `/faza1` + przy starcie). Per klan (0/1/2/main) lista uczestników z liczbą losów. Progres liczony jak w `/progres` (wynik ostatniego tygodnia − rekord z wcześniejszych tygodni; liczy się tylko przy istniejącym wcześniejszym rekordzie > 0)
   - **Losy (skala w nieskończoność):** progres ≥ 5 → 1 los (**wyjątek: przy rekordzie gracza < 620 pkt próg na 1 los to tylko progres ≥ 1**); następnie **N losów gdy progres ≥ (N-1) × średnia** progresu progresujących z wcześniejszego tygodnia (≥ 1× średnia → 2 losy, ≥ 2× → 3, ≥ 3× → 4, ≥ 4× → 5, …). Wzór: `tickets = floor(progres / średnia) + 1`. Brak danych wcześniejszego tygodnia → wszyscy kwalifikujący dostają 1 los. Kontroler nie nakłada górnego limitu losów w puli
   - **Losowanie:** cron **piątek 22:00** czasu polskiego (`utils/timezone.js`, setTimeout jak MVP), osobne dla każdego klanu; pula ważona, **6 zwycięzców/klan** (`config.glory.winnersCount`), bez powtórzeń. Ogłoszenie **jednym embedem** na kanale klanu (env `KONTROLER_GLORY_CHANNEL_*`) z **pingiem roli klanowej**. Embed (`buildResultEmbed`) zawiera: zwycięzców, **standard tygodnia** (średni progres) + progi losów oraz **pełną listę uczestników** z liczbą losów (wykluczeni oznaczeni 🚫). Lista przycinana do limitu 4096 znaków opisu embeda. Ten sam embed używany w `/glory-test` (z banerem testowym)
   - **Nicki w embedach (zwycięzcy/uczestnicy/reroll):** wyświetlane jako **zwykły tekst nicku serwerowego**, NIE jako wzmianki `<@id>`. Powód: Discord renderuje wzmiankę w opisie embeda jako nick tylko gdy użytkownik jest w cache klienta — inaczej pokazuje surowe ID. Nick pobierany na żywo przez `resolveDisplayNames()` (`guild.members.fetch` → `member.displayName`), z fallbackiem na zapisany `displayName`, a ostatecznie `Gracz <id>`. Pinguje się wyłącznie rolę klanową (`content: <@&roleId>`), pojedynczy zwycięzcy nie są pingowani (wzmianki w embedzie i tak nie tworzą powiadomień)
   - **Role wykluczone z wygrywania (`config.glory.excludedRoles`, env `KONTROLER_GLORY_EXCLUDED_ROLES`):** osoby z którąkolwiek z tych ról są usuwane z puli losowania (`getExcludedUserIds()` sprawdza role członków przez `guild.members.fetch`), ale **nadal liczą się do średniej progresu („oczekiwany standard")** — średnia jest liczona po stronie Stalkera po wszystkich progresujących, więc wykluczenie ról jej nie zmienia. Dotyczy losowania cyklicznego, `/glory-reroll` i `/glory-test` (w teście oznaczeni 🚫 na liście)
     - **Wyjątek od wyjątku (`config.glory.excludedRolesExceptions`, env `KONTROLER_GLORY_EXCLUDED_ROLES_EXCEPTIONS`):** lista ID osób, które MIMO posiadania roli wykluczającej NADAL biorą udział w losowaniu (nie są wykluczane)
   - **Licznik zwycięstw:** każde wygrane Glory zapisywane do `shared_data/glory_winners.json` (`{userId: {count, displayName, history}}`) — Stalker pokazuje to jako gwiazdki ⭐ w `/player-status` i `/player-compare` (zastąpiło dawne „Wykonuje CX")
   - **Persistencja:** `data/glory_history.json` (ostatnie losowanie per klan: uczestnicy + zwycięzcy) — do rerolla, restart-safe
   - **Nadrabianie pominiętego losowania (`catchUpMissedDraw`):** losowanie odpalał wyłącznie `setTimeout` ustawiany przy starcie, więc restart hostingu albo pętla crashów o piątkowej 22:00 oznaczały, że `scheduleNextDraw()` planowało dopiero KOLEJNY piątek — tydzień przepadał po cichu. Przy starcie bot porównuje `drawnAt` z historii z poprzednim terminem (najbliższy minus 7 dni) i gdy losowanie wypadło, odpala je od razu. Przy pierwszym w życiu uruchomieniu (pusta historia) nie losuje wstecz
   - **`/glory-reroll <klan>`** (admin, ukryta dla nie-adminów przez `setDefaultMemberPermissions`): dobiera dodatkowego zwycięzcę spośród uczestników ostatniego losowania, którzy nie wygrali (system awaryjny)
   - **`/glory-test`** (admin, ukryta dla nie-adminów): **testowe losowanie dla WSZYSTKICH klanów naraz**, publikowane na docelowych kanałach klanów tak jak realne cykliczne losowanie (ping roli klanowej + embed zwycięzców), z banerem `🧪 LOSOWANIE TESTOWE` na górze oraz **pełną listą uczestników** (bez ucinania, dzieloną na kilka embedów gdy długa). **Nie zapisuje** zwycięstw do `glory_winners.json` ani historii (`data/glory_history.json`), więc nie wpływa na gwiazdki ani `/glory-reroll`. Metoda `runTestDraw()` w serwisie
   - **Konfiguracja:** `config.glory` (dataFile, scheduleWeekday=5/Hour=22/Minute=0, winnersCount=6, clans: klucz→{roleId, channelId, displayName})

**Komendy:** `/lottery`, `/lottery-list`, `/lottery-remove`, `/lottery-history`, `/lottery-reroll`, `/lottery-debug`, `/glory-reroll`, `/glory-test`, `/ocr-debug`, `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`, `/mvp`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, ROBOT (opcjonalne, lista user ID rozdzielona przecinkami)

**Przekazywanie wiadomości (Robot1):**
- Użytkownicy z ID w `ROBOT` mogą pisać priv do bota, a wiadomości są przekazywane 1:1 na kanał z env `ROBOT1_FORWARD_CHANNEL`
- Obsługuje tekst i załączniki
- Wymaga intencji `DirectMessages` + partial `Channel`
- **Ping roli:** Jeśli wiadomość DM zaczyna się od `@`, zostanie wysłana z pingiem do roli z env `ROBOT1_MENTION_ROLE`

---


## Zmienne Środowiskowe

```env
KONTROLER_TOKEN=bot_token_here
KONTROLER_CLIENT_ID=client_id
KONTROLER_GUILD_ID=guild_id

# AI OCR Google Gemini (WYMAGANE - jedyny silnik OCR, bez fallbacku)
KONTROLER_GOOGLE_AI_API_KEY=AIzaSy-xxxxxxxxxxxxx   # fallback: ENDERSECHO_GOOGLE_AI_API_KEY / GOOGLE_AI_API_KEY
KONTROLER_GOOGLE_AI_MODEL=gemini-2.5-flash-lite

# Opcjonalne - z fallbackiem do wartości produkcyjnych
ROBOT1_FORWARD_CHANNEL=channel_id         # Kanał forward dla Robot1
ROBOT1_MENTION_ROLE=role_id               # Rola do pingu (@) dla Robot1
ROBOT1_ACTIVATION_CHANNEL=channel_id      # Kanał z przyciskiem aktywacji Robot1
KONTROLER_BLOCKED_ROLE=role_id            # Rola blokująca udział w loteriach

# Loteria Glory - kanały ogłoszeń per klan (WERYFIKUJ mapowanie klanów!)
KONTROLER_GLORY_CHANNEL_MAIN=channel_id   # Kanał ogłoszeń Glory dla klanu main
KONTROLER_GLORY_CHANNEL_0=channel_id      # Kanał ogłoszeń Glory dla PolskiSquad⁰
KONTROLER_GLORY_CHANNEL_1=channel_id      # Kanał ogłoszeń Glory dla PolskiSquad¹
KONTROLER_GLORY_CHANNEL_2=channel_id      # Kanał ogłoszeń Glory dla PolskiSquad²
# Role wykluczone z WYGRYWANIA Glory (lista ID rozdzielona przecinkami; wykluczeni nadal liczą się do średniej)
KONTROLER_GLORY_EXCLUDED_ROLES=role_id1,role_id2
# Wyjątek od wyjątku: ID osób, które mimo roli wykluczającej NADAL biorą udział w losowaniu
KONTROLER_GLORY_EXCLUDED_ROLES_EXCEPTIONS=user_id1,user_id2
# Role klanowe (współdzielone ze Stalkerem): STALKER_LME_TARGET_ROLE_MAIN/0/1/2
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Kontroler')
- **OCR:** AI (Google Gemini Vision), tylko kanał Daily, bez fallbacku na Tesseract
- **Loteria:** DST auto, multi-klan, cykle 0-365 dni
- **Loteria Glory:** piątek 22:00 (czas polski), progres Fazy 1 ze Stalkera, 6 zwycięzców/klan, licznik gwiazdek w `glory_winners.json`
- **Persistencja przez `utils/jsonStore` (cache-first):** active_votes.json, vote_history.json, saboteur_roles.json, mvp_state.json, mvp_winners.json, mvp_approvals.json, glory_history.json, lottery (dataFile + message_ids), oligopoly.json oraz relay Robot1. Odczyt z dysku raz, przy pierwszym sięgnięciu; zapis atomowy (plik tymczasowy + rename) jednocześnie do pliku i pamięci
  - **`shared_data/glory_winners.json` czyta i pisze Kontroler, a czyta go też Stalker** (gwiazdki ⭐ w `/player-status`). Wszystkie boty dzielą jeden proces i jeden store, więc po zapisie zwycięzców Stalker widzi je natychmiast — bez czekania na ponowny odczyt pliku
  - **Uwaga na kształt wartości domyślnej:** `oligopoly.json` i `active_votes.json` trzymają TABLICE (`() => []`), reszta obiekty (`() => ({})`). Podanie złego kształtu wywala się dopiero przy iteracji, gdy plik nie istnieje
  - `saveRelay1()` używa `store.mutate()` zamiast pary odczyt-zapis przy każdej przekazanej wiadomości DM
- **Persistencja (pliki):** active_votes.json, vote_history.json, saboteur_roles.json, mvp_state.json, mvp_winners.json, mvp_approvals.json, glory_history.json
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15 — ephemeralne panele `/lottery`, `/oligopoly` i `/glory-*` stałyby się publiczne). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje, bo widoczność ustala się przy potwierdzeniu interakcji. Import `MessageFlags` jest w `index.js`, `handlers/interactionHandlers.js` i `services/votingService.js`
