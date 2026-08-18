### 🤖 Muteusz Bot

**11 Systemów:**
1. **Auto-Moderacja** - `autoModerationService.js`: Spam (3 duplikaty/30min=7d timeout), wulgaryzmy (progresja kar), zaproszenia Discord
2. **Repost mediów PRZEZ PAMIĘĆ (bez dysku)** - `mediaService.js`: limit 100 MB/plik (filmy z serwerów z Nitro muszą przechodzić)
   - **`downloadFileToBuffer()`** pobiera załącznik prosto do `Buffer` i podaje go do `targetChannel.send({ files: [{ attachment: buffer }] })`. discord.js przyjmuje `Buffer` tak samo jak ścieżkę
   - **Dlaczego zmiana:** dawniej plik lądował w `temp/media_cache`, discord.js czytał go z powrotem przy wysyłce, po czym plik był kasowany — czyli **zapis + odczyt pełnego rozmiaru** (do 100 MB) na każdy załącznik. W statystykach `/io` była to największa pozycja ruchu dyskowego
   - **⚠️ Semafor równoczesnych repostów** (`_zajmijSlot`/`_zwolnijSlot`): `repostMedia` jest wołane wprost z handlera `messageCreate`, więc bez ograniczeń dziesięć osób wrzucających naraz filmy po 100 MB trzymałoby **1 GB w RAM** i przewróciło proces. Limity w configu: `maxConcurrentDownloads` (2 pobrania naraz) i `maxBufferedBytes` (200 MB łącznie w locie). Nadmiar **czeka w kolejce**, nic nie jest gubione
   - **Ochrona pamięci:** pobieranie jest przerywane, gdy strumień przekroczy `maxFileSize` — kłamiący nagłówek `size` nie wciągnie do RAM czegoś ogromnego. Bufor zwalniany w `finally` po każdym załączniku
   - `downloadFileToCache()` (zapis na dysk) **została** w kodzie jako ścieżka historyczna, ale repost jej nie używa. `cleanupCache` co godzinę skanuje więc katalog, który pozostaje pusty
3. **Zarządzanie Rolami** - `roleManagementService.js`: Ekskluzywne grupy (`special_roles.json`), auto-usuwanie konfliktów, 5s delay
4. **Naruszenia** - `warningsService.js`: Persistent JSON z UUID, reason, moderator, timestamp
5. **Koordynacja** - `roleKickingService.js`: Cron 2h, kick bez ról po 24h (integracja Rekruter)
6. **Chaos Mode** - `chaosService.js`: 5% szansa rola (permanent), hymn PL (5 zwrotek), 10% odpowiedź bota, multi-role support
7. **Losowe Odpowiedzi** - Virtutti Papajlari: 1/250 szansa, emoji PepeSoldier
8. **Guard Checky** - `index.js`: Flaga `isFullyInitialized` blokuje eventy podczas startu, zapobiega błędami "Klient Discord nie jest dostępny"
9. **Reaction Roles na wiadomościach** - `reactionRoleService.js`: Nadawanie/usuwanie ról za reakcje na konkretnych wiadomościach (np. ✅ na wiadomości → rola). Konfiguracja w `messageReactionRoles` w serwisie.
10. **System Zgłoszeń** - `interactionHandlers.js`: Trzy tryby zgłaszania:
    - Komenda `/zgłoś` (link + opcjonalny powód)
    - Przycisk `<a:PepeAlarmMan>` na kanale `1170349018900074637` (otwiera modal)
    - **Context menu wiadomości**: Prawy klik → Aplikacje → "Zgłoś wiadomość" (modal z powodem)

    Zgłoszenie trafia jako embed na kanał raportów (`MUTEUSZ_REPORT_CHANNEL_ID` lub fallback `MUTEUSZ_LOG_CHANNEL_ID`) z przyciskami akcji dla moderatorów: 🔨 Ostrzeż, 🔇 Wycisz (otwiera modal z czasem w formacie 10m/2h/1d), 🗑️ Usuń wiadomość, ✅ Nie rób nic. Po akcji embed zmienia kolor i usuwa przyciski. Przy starcie bota automatycznie wysyłana jest wiadomość z przyciskiem (jeśli jeszcze nie istnieje).

    **Zgłoszenia moderatorów**: Jeśli zgłoszony użytkownik ma uprawnienia moderatora (`ModerateMembers` lub `Administrator`), embed ma pomarańczowy kolor i inny tytuł. Dostępne przyciski: 🗑️ Usuń wiadomość, ✅ Nie rób nic. Wiadomość zawiera ping tekstowy `⚠️ Zgłoszenie dotyczy moderatora — wymagana akcja administratora.`

    **Context menu użytkownika** (moderator-only): Prawy klik → Aplikacje → "Wycisz użytkownika" (modal z czasem + powodem) lub "Ostrzeż użytkownika" (modal z powodem).

    **Statystyki zgłoszeń** - `reportStatsService.js` + `data/report_stats.json`: Każdy użytkownik ma liczniki: `totalReports`, `effectiveReports` (warn/mute/delete), `nothingReports`. Zasady:
    - 3x "nie rób nic" w ciągu 7 dni → blokada zgłoszeń na tydzień (DM do użytkownika + komunikat przy próbie zgłoszenia)
    - 1 skuteczne zgłoszenie (warn/mute/delete) → zeruje licznik "nie rób nic" w tygodniu
    - Blokada automatycznie wygasa po tygodniu przy następnej próbie zgłoszenia

15. **Komenda /io — monitor ruchu dyskowego** - `interactionHandlers.js` → `handleIOCommand`: statystyki **CAŁEGO** odczytu i zapisu procesu, zbierane przez `utils/diskMonitor`. Tylko administrator, odpowiedź ephemeral.
   - **Raport jest GLOBALNY, nie tylko o Muteuszu** — wszystkie 9 botów działa w jednym procesie i dzieli jeden store, więc widać ruch całego projektu. Liczby narastają od startu procesu (restart = zerowanie)
   - **Widoki** (opcja `widok`):
     - `Podsumowanie` (domyślnie) — liczba operacji i wolumen osobno dla odczytu i zapisu, średnie tempo w B/s, ile odczytów obsłużyła pamięć zamiast dysku (procent trafień), 5 najbardziej obciążających plików, licznik błędów zapisu i parsowania
     - `Boty i obszary` — agregacja per bot (`Stalker`, `EndersEcho`, `shared_data`…), wyliczana z pierwszego segmentu ścieżki pliku
     - `Rodzaje plików` — podział na kategorie: obrazy OCR, cache mediów, traineddata, obrazy, archiwa, logi, dane JSON, node_modules — z udziałem procentowym
     - `Pliki — odczyt` — najczęściej ładowane z dysku oraz najcięższe wolumenowo
     - `Pliki — zapis` — najczęściej zapisywane oraz najcięższe wolumenowo
   - **Do czego służy:** pokazuje realne proporcje obciążenia. Pliki JSON to ułamek procenta — ciężar leży w screenach OCR i cache mediów. Rosnąca liczba odczytów JSON oznaczałaby ścieżkę omijającą cache
   - **Źródło danych: `utils/diskMonitor`** — podmienia metody `fs` (`readFileSync`, `writeFileSync`, `promises.readFile/writeFile/appendFile/copyFile`, `createReadStream`, `createWriteStream`), więc liczy też operacje wykonywane wewnątrz bibliotek: sharp, tesseract.js, archiver, discord.js przy wysyłce załącznika
   - Procent trafień cache pochodzi osobno z `store.getStats()` (dotyczy wyłącznie plików JSON)
   - Ten sam licznik zasila skróconą linię w logu, wypisywaną raz na godzinę przez główny `index.js` (`DISK_REPORT_INTERVAL`)

11. **Komenda /msg** - `interactionHandlers.js`: Wysyłanie wiadomości botem na dowolny kanał tekstowy. Tylko dla administratorów. Parametry: `kanał` (wymagany), `wiadomość` (wymagana), `ping` (opcjonalne - ID ról oddzielone przecinkami, "everyone" lub "here"). Pingi doklejane są przed treścią wiadomości.

13. **Zmiana nazwy kanału prefix** - `index.js`: Gdy administrator (lub osoba z rolą uprawnioną) wyśle wiadomość zawierającą WYŁĄCZNIE emoji statusu (🛑/🟢/🔥) lub wartość liczbową z wymaganym `k` na końcu (np. `23k`, `34,8k`; sama liczba bez `k` nie zadziała), bot usuwa dotychczasowy prefix z początku nazwy kanału i wstawia nowy. Wiadomość jest automatycznie usuwana. Obsługuje myślnik po prefixie (np. `🟢-general` → `🛑-general`, `23k-sklep` → `34,8k-sklep`). Uprawnienia (zahardkodowane w `index.js`): **administratorzy** oraz **role admin-równoważne** (`CHANNEL_RENAME_ADMIN_ROLE_IDS`: `1170332302715396106`) mogą używać na dowolnym kanale; **role kanałowe** (`CHANNEL_RENAME_ROLE_IDS`: `1196586785413795850`, `1196911721588199464`) tylko na kanałach z `CHANNEL_RENAME_ALLOWED_CHANNELS`: `1194298890069999756`, `1200051393843695699`, `1262792174475673610`.

12. **Prima Aprilis** - `primaAprilisService.js`: Moduł prima aprilis. Przy starcie bota wysyła (lub aktualizuje istniejącą) wiadomość z czerwonym przyciskiem 🛑 "NIE KLIKAĆ POD ŻADNYM POZOREM" na kanale `1486500418358870074`. Po kliknięciu: zapisuje wszystkie role użytkownika do `data/prima_aprilis_roles.json`, odbiera je i nadaje rolę więźnia `1486506395057524887`. Użytkownik wychodzi pisząc `exit` gdziekolwiek - role są przywracane. Persistencja przeżywa restart bota.

14. **Kompleksowe przywracanie danych** - `handlers/restoreBackupHandler.js` (`/restore-backup`): Kreator przywracania danych z Google Drive (tylko administrator). Stan sesji per-użytkownik w `RestoreBackupHandler.sessions` Map (TTL 15 min, auto-cleanup usuwa pobrane foldery tymczasowe). Patrz sekcja **[Komenda /restore-backup](#komenda-restore-backup)** poniżej.

**Komendy:** `/io`, `/remove-roles`, `/special-roles`, `/add-special-role`, `/remove-special-role`, `/list-special-roles`, `/violations`, `/unregister-command`, `/chaos-mode`, `/msg`, `/data-archive`, `/restore-backup`, `/zgłoś`, context: `Zgłoś wiadomość`, `Wycisz użytkownika`, `Ostrzeż użytkownika`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, TARGET_CHANNEL_ID, LOG_CHANNEL_ID, REPORT_CHANNEL_ID (opcjonalne, fallback na LOG_CHANNEL_ID)

---

## Komenda /restore-backup

Kreator przywracania danych z backupów Google Drive — `handlers/restoreBackupHandler.js` (klasa `RestoreBackupHandler`, instancjonowana w `interactionHandlers.js`). Tylko **Administrator**. Wszystkie wiadomości ephemeral.

**Architektura:**
- Routing w `interactionHandlers.js`: komenda `restore-backup` → `restoreBackupHandler.handleCommand`; przyciski/selecty/modale z prefiksem `rb_` → `handleButton` / `handleSelect` / `handleModal`.
- Stan sesji per-użytkownik w `this.sessions` Map (TTL 15 min). Pola: `mode`, `botName`, `date`, `pickedFileId/pickedFileName`, `backupList`, `applyType`, `tempDirs{botName→katalog}`, `prepared`, `browsePath`, `page`, `selected:Set`, `nameCache`, `guildConfigMap`. Auto-cleanup po TTL usuwa pobrane foldery tymczasowe.
- Logika pobierania/rozpakowania/kopiowania w `BackupManager`: `downloadAndExtractLatest`, `downloadAndExtractBackupByDate`, `downloadAndExtractById`, `listAvailableBackups`, `restoreFilesFromTemp` (z kopią bezpieczeństwa), `prepareRestore(dateStr)` / `executeRestore` (tryb uszkodzone). Rozpakowanie przez systemowy `unzip` (Linux).

**Przepływ kreatora:**
1. **Tryb** (`rb_mode_*`): 🗂️ Cały backup · 🤖 Konkretny bot · 🩹 Tylko uszkodzone (0B/brakujące — skanuje foldery `data/` przez `prepareRestore` i przywraca tylko puste/brakujące pliki; zastąpiło dawną komendę `/przywroc-backup`).
2. **(tryb bot)** wybór bota — `rb_bot_select`.
3. **Wersja backupu** (`rb_time_*`): 📅 Najnowszy · 🗓️ Konkretny dzień (modal `rb_date_modal`, format `RRRR-MM-DD`) · 📜 **Wybierz z listy** (tylko tryb bot) — `listAvailableBackups` scala backupy z obu folderów Drive: **automatyczne** (`Polski_Squad_Backups`, oznaczone 🅰) **i manualne** (`Polski_Squad_Manual_Backups`, oznaczone 🅼), posortowane wg **daty i godziny utworzenia** (`createdTime`), dzięki czemu rozróżnia kilka backupów z tego samego dnia; pobieranie po ID pliku (`rb_backup_select` → `downloadAndExtractById`). Tryby 📅 Najnowszy / 🗓️ Konkretny dzień korzystają wyłącznie z folderu automatycznego; manualne dostępne są przez 📜 Wybierz z listy.
4. **Pobranie** danych z wybranej wersji (cały backup = wszystkie boty; bot = jeden bot).
5. **Zakres:**
   - Cały backup → podgląd liczby plików per bot → `rb_apply`.
   - Bot → 📦 Przywróć całego bota (`rb_bot_all`) lub 🗂️ Wybierz pliki (`rb_browse`).
   - Uszkodzone → podsumowanie odzyskiwalnych plików → `rb_apply`.
6. **Przeglądarka plików** (tryb wybór plików): nawigacja po drzewie rozpakowanego backupu — select `rb_browse_select` (📁 folder = wejdź, 📄 plik = zaznacz/odznacz), przyciski `rb_nav_up`/`rb_nav_root`, paginacja `rb_page_prev/next` (25/stronę), `rb_sel_folder`/`rb_unsel_folder` (zaznacz/odznacz cały podfolder rekurencyjnie), `rb_browse_done` → podgląd → `rb_apply`.
7. **Wykonanie** (`rb_apply`): kopiuje pliki z `tempDir` do żywego `data/`; przed nadpisaniem tworzy kopię bezpieczeństwa w `_restore_safety/<timestamp>/` (katalog główny projektu — poza folderami `data/`, więc nie trafia do kolejnych backupów). Podsumowanie + webhook (`sendRestoreSummaryToWebhook`) + log.

**Rozwiązywanie ID→nazwa w przeglądarce i podglądzie:** nazwy plików/folderów będące snowflake'em (17–20 cyfr) są zamieniane na czytelne — ID serwera → nazwa serwera (`client.guilds.cache` lub `EndersEcho/data/guild_configs.json`), ID gracza w `wyniki/{userId}.json` → nick (`client.users.fetch`). Podpowiedź typu (`childHint`): dzieci folderu `guilds/` = serwery, dzieci `wyniki/` = gracze; w innych miejscach próba serwer→gracz. Wyniki cache'owane per sesja.

**customIDs:** `rb_mode_all|bot|broken`, `rb_back_mode`, `rb_bot_select`, `rb_time_latest|date|list`, `rb_date_modal` (pole `rb_date`), `rb_backup_select`, `rb_bot_all`, `rb_browse`, `rb_browse_select`, `rb_nav_up|root`, `rb_page_prev|next`, `rb_sel_folder`, `rb_unsel_folder`, `rb_browse_done`, `rb_apply`, `rb_cancel`.

**Uwaga (godziny na liście backupów):** czas w „Wybierz z listy" pochodzi z `createdTime` Google Drive i jest formatowany w strefie czasowej procesu bota. Aby kilka backupów dziennie było rozróżnialnych, wystarczy zwiększyć częstotliwość w `backup-scheduler.js` — pliki tego samego dnia mają różne `createdTime`, więc każdy jest osobno wybieralny (nazwa pliku może się powtarzać, pobieranie odbywa się po unikalnym ID).

---


## Zmienne Środowiskowe

```env
MUTEUSZ_TOKEN=bot_token_here
MUTEUSZ_CLIENT_ID=client_id
MUTEUSZ_GUILD_ID=guild_id
MUTEUSZ_TARGET_CHANNEL_ID=channel_id
MUTEUSZ_LOG_CHANNEL_ID=channel_id
MUTEUSZ_REPORT_CHANNEL_ID=channel_id  # opcjonalne - kanał dla zgłoszeń (fallback na LOG_CHANNEL_ID)
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Muteusz')
- **Persistencja przez `utils/jsonStore` (cache-first):** wszystkie pliki `data/` — ostrzeżenia, wyzwiska, aktywne wyciszenia, liczniki naruszeń, blokady słów i obrazów, chaos mode, role specjalne, konflikty ról, cache członków, statystyki zgłoszeń, timery reakcji-ról oraz dane Rekrutera czytane przez `roleKickingService`. Odczyt z dysku raz, przy pierwszym sięgnięciu; zapis atomowy (plik tymczasowy + rename)
  - **Zniknęło 12 blokujących `writeFileSync`** — zatrzymywały cały proces, czyli wszystkie 9 botów naraz. Serwisy z synchronicznym API (`warningService`, `autoModerationService`) używają `store.setSync()`: cache aktualizuje się natychmiast, plik zapisywany jest w tle
  - **⚠️ `/restore-backup` MUSI kończyć się `store.reload()`** (`restoreBackupHandler._applyRestore`) — przywracanie podmienia pliki **pod** cachem, więc bez przeładowania pierwszy zapis dowolnego serwisu nadpisałby odzyskane dane starą zawartością pamięci i po cichu cofnął całe przywracanie. Liczba przeładowanych plików trafia do podsumowania operacji. To samo dotyczy każdej nowej ścieżki podmieniającej pliki spod spodu (`backupManager.restoreFilesFromTemp`)
  - `safeParse` zostało wyparte przez store — obsługę uszkodzonego i pustego pliku (wartość domyślna zamiast wyjątku) zapewnia teraz `getSync`/`getOrLoad`
- **Cache mediów:** 100MB/plik, 2GB total, 24h retencja
- **Role:** Ekskluzywne grupy w special_roles.json
- **Guard Checky:** isFullyInitialized flag chroni przed błędami startu
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15 — ephemeralne panele moderacyjne stałyby się publiczne). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje, bo widoczność ustala się przy potwierdzeniu interakcji
  - **Publiczne odpowiedzi nie mają flagi** — dawne `ephemeral: false` (ogłoszenia o ostrzeżeniu, usunięciu wiadomości, wyniku moderacji) zostało usunięte, bo brak flagi to domyślnie wiadomość widoczna dla wszystkich
  - Import `MessageFlags` jest modułowy w `index.js`, `handlers/interactionHandlers.js` i `handlers/restoreBackupHandler.js` — nie dodawaj lokalnych `require` w ciele funkcji
