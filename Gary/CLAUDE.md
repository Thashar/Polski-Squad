### 🎮 Gary Bot

**12 Systemów:**
1. **Lunar Mine** - `apiService.js`: Fetch garrytools.com/lunar, cheerio parse, 4 gildie, członkowie sorted by attack
2. **Wyszukiwanie** - `guildSearchService.js`: Fuzzy matching (exact/startsWith/contains/levenshtein), tryby TOP500/GLOBAL
3. **Cache** - `dataService.js`: Persistent JSON (clans, rank, members), refresh 24h/manual/start
4. **Proxy** - `proxyService.js`: Źródło listy = lokalny plik `proxy.txt` w głównym folderze projektu (`loadProxyListFromFile()`, `parseProxyLine()` — formaty: `user:pass@ip:port`, `http://...`, `ip:port`, `ip:port:user:pass`); Webshare API tylko jako fallback gdy plik niedostępny. Round-robin/random, health monitoring, failover. Ścieżka pliku konfigurowalna przez `GARY_PROXY_FILE` (domyślnie `../../proxy.txt`). `/proxy-refresh` przeładowuje z pliku
5. **Paginacja** - 20/strona, 1h timeout, publiczna nawigacja
6. **Cron** - Środa 18:45 wysyła prośbę o ręczne ID Lunar Mine (patrz 14b, captcha nie jest już auto-rozwiązywana; snapshot gildii/graczy zapisywany dopiero po podaniu ID); 18:50 niezależny snapshot historii klanów TOP500 (osobny endpoint bez captchy)
7. **Historia klanów** - `clanHistoryService.js`: tygodniowe snapshoty TOP500, `data/clan_history.json`, max 25 tygodni; wykres SVG+sharp dla `/analyse`, `/lunarmine` (multi-klan), `/search` (top match); wymagane ≥2 tygodnie danych
7b. **Snapshot graczy LME** - `clanHistoryService.savePlayerSnapshot()`: RC+TC i atak per gracz zapisywane do `shared_data/lme_weekly/week_YYYY_WW.json` (jeden plik per tydzień, klucz = lowercase nick gry); odczytywane przez Stalker bot
8. **Wątki** - Obsługa `parentId`, whitelist check
9. **Emoji** - Server emoji w embedach
10. **Rivals** - `garrytoolsService.getRivalsData()`: Fetch garrytools.com/lunar/rivals z Guild ID, POST formularz (bez captchy), parse 2 tabele (likely/unlikely matches), zwraca rank, Guild ID, name, members, leader, grade, score; wyświetlane w 2 embedach Discord (bez przycisków pod klanami — usunięte razem z captchą, patrz 14: dawały tylko listę członków/atak, co nie było niezbędne); po embedach generowane wykresy: historia punktów (dla klanów w TOP500 ≥2 tygodnie), siła ataku i RC+TC (dla klanów w guildSnapshots — PS gildie). `parseRivalsTable` mapuje kolumny po nagłówkach `thead` (odporne na dodawanie/usuwanie kolumn przez stronę), z fallbackiem pozycyjnym. Warianty kolumn: 7 (Rank, Guild ID, Name, Members, Leader, Grade, Score), 6 (bez Members), 5 (bez Members i Score — wtedy `score=null`, w embedzie Grade bez nawiasu)
11. **Wykresy historii** - `generateMultiClanHistoryChart` i `generateGuildMetricChart` zawierają delta wartości (zmiana względem poprzedniego tygodnia) nad każdym punktem: zielony dla wzrostu (+N), czerwony dla spadku (-N)
12. **Paginacja członków LME** - `/lunarmine` wyświetla wszystkich członków w jednym embed z paginacją publiczną (każda strona = jeden klan); przyciski `lme_prev::ID`, `lme_next::ID` dostępne dla wszystkich bez sprawdzania uprawnień
13. **Brak headless browsera - Chromium USUNIĘTY z projektu** - `puppeteerLauncher.js`, `browserFetchService.js` i `captchaSolverService.js` zostały skasowane, a pakiety `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth` i `@sparticuz/chromium` wypadły z `package.json`. **Powód: obciążenie dysku hostingu** - `@sparticuz/chromium` rozpakowywał ~150 MB przy KAŻDYM uruchomieniu przeglądarki, a `fetchClanData()` odpalał go jako fallback za każdym razem, gdy Cloudflare zwrócił 403 (czyli regularnie). Konsekwencja: gdy `clanAjaxService.fetchClanData()` nie znajdzie wierszy tabeli przez zwykłe zapytanie HTTP/proxy, **od razu** rzucany jest `isJavaScriptError` obsługiwany w `interactionHandlers.js` (wcześniej dopiero po nieudanej próbie renderowania). Gdy wcześniejszy fetch się powiódł, `fetchClanData()` nadal oddaje dane z cache'a w pamięci (`this.clanData`) - to jedyny ratunek przy zablokowanym HTTP. **Nie przywracaj Puppeteera bez zgody** - to była świadoma decyzja o kosztach I/O, nie przeoczenie
14. **Captcha (Lunar Details) - CAŁKOWICIE ODŁĄCZONA** - automatyczne rozwiązywanie captchy przez Puppeteer (klikanie kafelków reCAPTCHA) zostało najpierw wyłączone (automatyzacja klikania, nawet ze stealth pluginem, prowadziła do blokowania IP serwera przez Cloudflare), a wraz z usunięciem Chromium **cały kod zniknął z repo**: `captchaSolverService.js`, wrapper `garrytoolsService.getGroupId()` oraz gałąź `captcha_*` w `handleButtonInteraction`. Wszystkie miejsca, które potrzebują Group ID z chronionego captchą formularza "Lunar Details", korzystają z ręcznego mechanizmu opisanego w 14b - `/lunarmine` i `/analyse` proszą admina o samodzielne rozwiązanie captchy i podanie ID przez modal, a przycisk "🔍 szczegóły" pod klanami w `/rivals` (jedyne miejsce używające captchy tylko dla listy członków rywala) został **całkowicie usunięty** (patrz 10) - nie był niezbędny, `/rivals` i tak pokazuje kluczowe dane bez niego.
14b. **Ręczne podawanie Group ID (generyczny mechanizm)** - `interactionHandlers.js` ma jeden wspólny wzorzec "przycisk → modal → weryfikacja zestawu Guild ID → publikacja wyniku", używany przez trzy niezależne funkcje:
  - **Cotygodniowy snapshot LME** (`sendLmeManualIdRequest`/`showLmeManualIdModal`/`processLmeManualSnapshot`, customId `lme_manual_id_button`/`lme_manual_id_modal`) - guildIds zawsze te same 4 klany PS (`this.LME_SNAPSHOT_GUILD_IDS`), po weryfikacji czyści i publikuje w stałym wątku `this.LME_SNAPSHOT_THREAD_ID` + zapisuje snapshoty historii. Wywoływane przez cotygodniowy cron (18:45, wysyła przycisk na kanał admina) i przez `/lme-snapshot` (pokazuje modal od razu, bez `deferReply`, bo modal musi być pierwszą odpowiedzią na interakcję).
  - **`/lunarmine` i `/analyse`** (`requestManualGroupId`/`showManualGroupIdModal`/`processManualGroupIdSubmit`, customId `manual_group_button::<kind>::<guildIds join '-'>[::<extra>]` / `manual_group_modal::...`) - guildIds są dynamiczne (podane przez użytkownika w pierwszym modalu `lunarmine_modal`/`analyse_modal`, dla `/analyse` przepuszczone przez `modifyGuildIds()` z `FIXED_GUILDS`), więc są zakodowane wprost w customId zamiast być stałą klasy. `kind` (`'lunarmine'` lub `'analyse'`) determinuje, która funkcja renderująca wynik zostanie wywołana po weryfikacji: `renderLunarMineResults()` (overview + paginacja członków, jak dawniej `processLunarMineCommand`) albo `renderAnalyseResult(details, extra)` (pojedynczy klan wskazany przez `extra` = oryginalne Guild ID podane przez użytkownika, jak dawniej `processAnalyseCommand`). Weryfikacja i status idą jako **ephemeral** (`interaction.deferReply({ephemeral:true})` w `processManualGroupIdSubmit`), ale finalne wyniki (`renderLunarMineResults`/`renderAnalyseResult`) używają `interaction.followUp()` **bez** `ephemeral` (domyślnie publiczne, niezależnie od tego że initial deferReply było ephemeral) - zachowuje to dawne publiczne zachowanie tych komend.

  Wspólna logika weryfikacji (`processManualGroupIdSubmit`, analogicznie `processLmeManualSnapshot`): wyciąga ID przez `extractGroupIdFromInput()` (regex `\d{4,8}`, akceptuje sam numer lub wklejony cały link), woła `garrytoolsService.fetchGroupDetails(groupId)` (endpoint `/detail/{id}` nie ma captchy), **weryfikuje** że zwrócony zestaw Guild ID (`Set`, niezależnie od kolejności) dokładnie odpowiada oczekiwanemu - jeśli nie pasują, zwraca błąd z listą oczekiwanych/otrzymanych ID i nic więcej nie rusza (admin może kliknąć przycisk ponownie i spróbować z poprawnym ID - wiadomość z przyciskiem nie jest usuwana/blokowana po nieudanej próbie).
15. **~~Puppeteer launcher~~ - USUNIĘTY** (patrz 13). Historia dla kontekstu: na Linuksie używany był statycznie zlinkowany Chromium z `@sparticuz/chromium` (Pterodactyl nie ma `libatk-1.0.so.0` i pokrewnych wymaganych przez zwykłe headless Chrome), z `TMPDIR` przekierowywanym na `Gary/temp/chromium`, bo `/tmp` na tym serwerze to mała, osobna partycja i ekstrakcja kończyła się `ENOSPC`. Ta sama ekstrakcja ~150 MB przy każdym uruchomieniu okazała się później jednym ze źródeł ciężkiego I/O zgłoszonego przez hosting, dlatego cały mechanizm wypadł z projektu

**Komendy:** `/lunarmine`, `/search`, `/analyse`, `/player`, `/ee`, `/refresh`, `/proxy-test`, `/proxy-stats`, `/proxy-refresh`, `/lme-snapshot` (admin — ręczny snapshot + zapis historii, podmieniona `/test`), `/rivals` (wyszukiwanie rywali na podstawie Guild ID)
**Env:** TOKEN, CLIENT_ID, ALLOWED_CHANNEL_ID, ADMIN_CAPTCHA_CHANNEL_ID, ADMIN_ROLES, PROXY_ENABLED, PROXY_STRATEGY, PROXY_FILE, PROXY_LIST, WEBSHARE_URL

---


## Zmienne Środowiskowe

```env
GARY_TOKEN=bot_token_here
GARY_CLIENT_ID=client_id
GARY_ALLOWED_CHANNEL_ID=channel1,channel2
GARY_ADMIN_ROLES=role1,role2
# Kanał admina, na który cotygodniowy cron (18:45) wysyła przycisk do ręcznego podania ID Lunar Mine (patrz 14b)
GARY_ADMIN_CAPTCHA_CHANNEL_ID=channel_id

# Proxy (opcjonalne)
GARY_PROXY_ENABLED=true
GARY_PROXY_STRATEGY=round-robin
# Główne źródło listy proxy - plik w głównym folderze (domyślnie ../../proxy.txt)
# Formaty linii: user:pass@ip:port | http://user:pass@ip:port | ip:port | ip:port:user:pass
GARY_PROXY_FILE=proxy.txt
GARY_PROXY_LIST=http://proxy1:port,http://proxy2:port
# Webshare API - fallback gdy plik proxy niedostępny
GARY_WEBSHARE_URL=https://proxy.webshare.io/api/v2/proxy/list/
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Gary')
- **Pliki JSON przez `utils/jsonStore`** (cache-first) — Gary był pilotem tej migracji. Objęte: `data/clan_history.json`, `data/proxy_status.json`, `data/lme_pagination.json` oraz pliki tygodniowe w `shared_data/lme_top500`, `lme_guilds`, `lme_weekly`. Z dysku czytane raz (`getSync` przy pierwszym sięgnięciu), zapis idzie jednocześnie do pliku i pamięci, atomowo
  - `clanHistoryService.history` to **getter** czytający z cache — mutujesz go (`push`, `sort`) i wołasz `_save()`; nie przypisuj do niego (nie ma settera)
  - `saveSnapshot`, `saveGuildSnapshot`, `savePlayerSnapshot` są teraz **async** — wołający muszą używać `await`
  - `saveProxyStatuses()` zostało synchroniczne w sygnaturze, ale zapisuje fire-and-forget (jest wołane z obsługi błędów proxy 403/407, gdzie blokujący zapis wstrzymywał cały proces)
  - Wyjątek: `proxy.txt` czytany jest nadal zwykłym `fs` — to plik tekstowy, nie JSON, wczytywany przy starcie i przy `/proxy-refresh`
- **Cache danych klanów:** Persistent JSON, refresh 24h
- **Proxy:** Webshare API, health monitoring
- **Cron:** Środa 18:45 auto /lunarmine; 18:46 zapisuje snapshot TOP500 do `data/clan_history.json`
- **Historia klanów:** `ClanHistoryService` — snapshot zapisuje rank+score+level+grade dla każdego klanu; przetrwa restart; max 25 snapshotów (starsze odcinane)
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje, bo widoczność ustala się przy potwierdzeniu interakcji. Import `MessageFlags` jest w `index.js` i `handlers/interactionHandlers.js`
