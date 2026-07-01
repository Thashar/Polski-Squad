### 🎮 Gary Bot

**12 Systemów:**
1. **Lunar Mine** - `apiService.js`: Fetch garrytools.com/lunar, cheerio parse, 4 gildie, członkowie sorted by attack
2. **Wyszukiwanie** - `guildSearchService.js`: Fuzzy matching (exact/startsWith/contains/levenshtein), tryby TOP500/GLOBAL
3. **Cache** - `dataService.js`: Persistent JSON (clans, rank, members), refresh 24h/manual/start
4. **Proxy** - `proxyService.js`: Źródło listy = lokalny plik `proxy.txt` w głównym folderze projektu (`loadProxyListFromFile()`, `parseProxyLine()` — formaty: `user:pass@ip:port`, `http://...`, `ip:port`, `ip:port:user:pass`); Webshare API tylko jako fallback gdy plik niedostępny. Round-robin/random, health monitoring, failover. Ścieżka pliku konfigurowalna przez `GARY_PROXY_FILE` (domyślnie `../../proxy.txt`). `/proxy-refresh` przeładowuje z pliku
5. **Paginacja** - 20/strona, 1h timeout, publiczna nawigacja
6. **Cron** - Środa 18:45 `/lunarmine` auto-exec; 18:46 snapshot historii klanów + snapshot graczy LME
7. **Historia klanów** - `clanHistoryService.js`: tygodniowe snapshoty TOP500, `data/clan_history.json`, max 25 tygodni; wykres SVG+sharp dla `/analyse`, `/lunarmine` (multi-klan), `/search` (top match); wymagane ≥2 tygodnie danych
7b. **Snapshot graczy LME** - `clanHistoryService.savePlayerSnapshot()`: RC+TC i atak per gracz zapisywane do `shared_data/lme_weekly/week_YYYY_WW.json` (jeden plik per tydzień, klucz = lowercase nick gry); odczytywane przez Stalker bot
8. **Wątki** - Obsługa `parentId`, whitelist check
9. **Emoji** - Server emoji w embedach
10. **Rivals** - `garrytoolsService.getRivalsData()`: Fetch garrytools.com/lunar/rivals z Guild ID, POST formularz, parse 2 tabele (likely/unlikely matches), zwraca rank, Guild ID, name, members, leader, grade, score; wyświetlane w 2 embedach Discord; po embedach generowane wykresy: historia punktów (dla klanów w TOP500 ≥2 tygodnie), siła ataku i RC+TC (dla klanów w guildSnapshots — PS gildie). `parseRivalsTable` mapuje kolumny po nagłówkach `thead` (odporne na dodawanie/usuwanie kolumn przez stronę), z fallbackiem pozycyjnym. Warianty kolumn: 7 (Rank, Guild ID, Name, Members, Leader, Grade, Score), 6 (bez Members), 5 (bez Members i Score — wtedy `score=null`, w embedzie Grade bez nawiasu)
11. **Wykresy historii** - `generateMultiClanHistoryChart` i `generateGuildMetricChart` zawierają delta wartości (zmiana względem poprzedniego tygodnia) nad każdym punktem: zielony dla wzrostu (+N), czerwony dla spadku (-N)
12. **Paginacja członków LME** - `/lunarmine` wyświetla wszystkich członków w jednym embed z paginacją publiczną (każda strona = jeden klan); przyciski `lme_prev::ID`, `lme_next::ID` dostępne dla wszystkich bez sprawdzania uprawnień
13. **Headless browser fallback** - `browserFetchService.js`: gdy `clanAjaxService.fetchClanData()` nie znajdzie wierszy tabeli przez zwykłe zapytanie HTTP/proxy (strona `rank/clans` renderowana przez JS, blokowana przez Cloudflare 403 na wszystkich proxy i połączeniu bezpośrednim), bot uruchamia headless Chromium przez `puppeteerLauncher.launchBrowser()`, realnie renderuje stronę i dopiero z tak uzyskanego HTML parsuje tabelę (`parseClansFromHtml`, współdzielone z zapytaniem HTTP). Dopiero gdy fallback też nie znajdzie danych, rzucany jest `isJavaScriptError` obsługiwany w `interactionHandlers.js`
14. **Captcha relay (Lunar Details)** - `captchaSolverService.js`: formularz "Lunar Details" na garrytools.com (używany przez `getGroupId()` dla `/lunarmine`, `/analyse`, `/lme-snapshot`, przycisk szczegółów w `/rivals`) jest chroniony Google reCAPTCHA v2 (checkbox + wyzwanie obrazkowe 3×3 lub 4×4, escaluje natychmiast po kliknięciu checkboxa). `openLunarDetailsPage()` łączy się przez losowe proxy z `proxy.txt` (ten sam singleton `ProxyService` co reszta bota - IP serwera jest blokowane przez Cloudflare bez proxy, przez co formularz w ogóle się nie renderuje), przez `--proxy-server` w Puppeteer + `page.authenticate()` dla danych logowania; do 3 prób z różnymi proxy, zanim strona zostanie uznana za nieosiągalną. Po wypełnieniu 4 Guild ID i kliknięciu checkboxa reCAPTCHA, wyzwanie obrazkowe przekazywane jest do rozwiązania: zrzut ekranu widgetu (`iframe[src*="bframe"]`) numerowany przez sharp+SVG na podstawie prawdziwych bounding boxów kafelków (`.rc-imageselect-tile`, odporne na wysokość nagłówka/stopki), przyciski 1-N + ✅ Zatwierdź/❌ Anuluj (max 5 rows/25 przycisków - limit Discorda). Widoczność zależy od `context` przekazanego do `getGroupId(guildIds, context)`: `{ interaction }` → wyzwanie wysyłane jako **ephemeral followUp** (widoczne tylko dla wywołującego, używane przez `/lunarmine`, `/analyse`, przycisk `/rivals`, ręczny `/lme-snapshot`); `{ channel, invokerId }` → zwykła wiadomość na kanale (używane tylko przez cotygodniowy cron, który nie ma interakcji Discorda) - cron wysyła prośbę na dedykowany kanał admina `adminCaptchaChannelId` (env `GARY_ADMIN_CAPTCHA_CHANNEL_ID`, domyślnie `1263240344871370804`), pobierany przez `client.channels.fetch()` w `index.js`, oddzielny od wątku wyników; jeśli fetch się nie powiedzie, spada z powrotem na wątek wyników. Do 6 rund, deadline 100s (token reCAPTCHA ważny ~2 min od kliknięcia checkboxa), 90s na rundę. Po rozwiązaniu klika "Show Details" i wyciąga prawdziwe Group ID z URL przekierowania (`extractGroupIdFromUrl`) - dalsza część (`fetchGroupDetails`) działa jak wcześniej przez axios+proxy, bo strony `/detail/{id}` nie mają captchy. Cron nie gwarantuje, że ktoś zdąży rozwiązać captchę w porę - w takim wypadku tylko snapshot TOP500 (osobny endpoint bez captchy) i tak się zapisze
15. **Puppeteer launcher (self-contained Chromium)** - `puppeteerLauncher.js`: współdzielony przez `captchaSolverService.js` i `browserFetchService.js`. Serwer produkcyjny (Pterodactyl, Linux) nie ma zainstalowanych bibliotek systemowych (`libatk-1.0.so.0` i pokrewnych) wymaganych przez zwykłe headless Chrome pobrane przez `puppeteer` (`error while loading shared libraries`), więc na Linuksie (`process.platform === 'linux'`) używany jest samodzielny, statycznie zlinkowany build Chromium z pakietu `@sparticuz/chromium` (wersja `143.0.4`, dobrana pod kątem kompatybilności z Node >=20.11.0 i bliskości do wersji Chrome bundlowanej przez puppeteer 25.x) - `puppeteer.launch({ args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }), executablePath: await chromium.executablePath(), headless: 'shell' })`. Lokalnie (Windows/macOS, development) pakiet nie dostarcza binarki, więc używana jest zwykła przeglądarka pobrana przez `puppeteer`. `@sparticuz/chromium` zawsze rozpakowuje ~150MB do `os.tmpdir()` (domyślnie `/tmp`) - na tym serwerze `/tmp` jest osobną, małą partycją niezależną od głównego dysku `/home/container` (setki GB wolnego miejsca), więc ekstrakcja kończyła się `ENOSPC`. `TMPDIR` jest tymczasowo (try/finally) przekierowywany na `Gary/temp/chromium` tylko na czas `chromium.executablePath()` + `puppeteer.launch()`, potem przywracana jest poprzednia wartość - inne miejsca w projekcie (`utils/backupManager.js` przy przywracaniu backupów) też korzystają z `os.tmpdir()` i nie powinny być trwale przekierowane, bo wszystkie 9 botów działa w jednym współdzielonym procesie Node (`index.js` w głównym folderze uruchamia je przez `require()` w pętli)

**Komendy:** `/lunarmine`, `/search`, `/analyse`, `/player`, `/ee`, `/refresh`, `/proxy-test`, `/proxy-stats`, `/proxy-refresh`, `/lme-snapshot` (admin — ręczny snapshot + zapis historii, podmieniona `/test`), `/rivals` (wyszukiwanie rywali na podstawie Guild ID)
**Env:** TOKEN, CLIENT_ID, ALLOWED_CHANNEL_ID, ADMIN_CAPTCHA_CHANNEL_ID, ADMIN_ROLES, PROXY_ENABLED, PROXY_STRATEGY, PROXY_FILE, PROXY_LIST, WEBSHARE_URL

---


## Zmienne Środowiskowe

```env
GARY_TOKEN=bot_token_here
GARY_CLIENT_ID=client_id
GARY_ALLOWED_CHANNEL_ID=channel1,channel2
GARY_ADMIN_ROLES=role1,role2
# Kanał admina na który trafia prośba o rozwiązanie captchy przy cotygodniowym cronie (brak interakcji = brak ephemeral)
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
- **Cache:** Persistent JSON, refresh 24h
- **Proxy:** Webshare API, health monitoring
- **Cron:** Środa 18:45 auto /lunarmine; 18:46 zapisuje snapshot TOP500 do `data/clan_history.json`
- **Historia klanów:** `ClanHistoryService` — snapshot zapisuje rank+score+level+grade dla każdego klanu; przetrwa restart; max 25 snapshotów (starsze odcinane)
