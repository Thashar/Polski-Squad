### 🏆 EndersEcho Bot

**⚠️ ZASADA DWUJĘZYCZNOŚCI KOMEND (KRYTYCZNE):**
- Każda komenda slash MUSI mieć opis angielski (`.setDescription()`) ORAZ polskie tłumaczenie przez helper `pl()`
- Komendy rejestrowane są **osobno per serwer** — serwery `eng` nie dostają `pl` lokalizacji, serwery `pol` dostają
- Helper `pl` tworzony jest wewnątrz pętli po serwerach: `const pl = (text) => isPol ? { pl: text } : {};`
- Wzorzec obowiązkowy dla każdej nowej komendy:
  ```javascript
  // Wewnątrz pętli for (const guildConfig of this.config.guilds):
  // const isPol = guildConfig.lang === 'pol';
  // const pl = (text) => isPol ? { pl: text } : {};
  new SlashCommandBuilder()
      .setName('nazwa')
      .setDescription('English description')
      .setDescriptionLocalizations(pl('Polski opis'))
      .addAttachmentOption(option =>
          option.setName('option_name')
              .setDescription('English option description')
              .setDescriptionLocalizations(pl('Polski opis opcji'))
              .setRequired(true))
  ```

**4 Systemy:**
1. **OCR Wyników** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Google AI API (Gemini Vision), dwuetapowa walidacja
     - Włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
     - Trzyetapowa walidacja (trzy osobne requesty do API):
       - **KROK 1:** Sprawdza czy jest "Victory" (50 tokenów)
       - **KROK 2:** Sprawdza autentyczność zdjęcia (10 tokenów)
       - **KROK 3:** Wyciąga nazwę bossa, wynik (Best) i Total (500 tokenów)
     - **Walidacja score vs Total:** Jeśli odczytany Best > Total → automatyczna korekta
     - Zalety: 100% pewność walidacji, fallback na tradycyjny OCR
   - **Komenda /update (wszyscy, wymaga AI OCR):** Używa `analyzeTestImage()` — weryfikacja wzorcem + ekstrakcja:
     - **KROK 1:** Porównanie z wzorcem `files/Wzór.jpg` — jeden request z dwoma obrazami (10 tokenów)
     - **KROK 2:** Ekstrakcja danych (boss + score) — bez sprawdzania Victory i autentyczności (500 tokenów)
     - Gdy screen niepodobny do wzorca → embed `testNotSimilarTitle/Description` (brak zapisu)
     - Po udanej weryfikacji: pełny flow — zapis do rankingu, aktualizacja ról TOP, powiadomienia Global Top 3, powiadomienia DM
     - Wymaga `USE_ENDERSECHO_AI_OCR=true`; gdy AI wyłączone → ephemeral `testAiOcrRequired`
     - Respektuje blokadę użytkownika (`userBlockService`) i globalny blok OCR (`ocrBlockService.isBlocked('update')`)
     - **Cooldown 5 min** po udanym zapisie wyniku — sprawdzany przez `updateCooldownService`; informuje gracza ile czasu pozostało (w języku serwera); persystowany w `data/update_cooldowns.json` (przeżywa restart)
   - **Komenda /test (tylko admin + użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`, wymaga AI OCR):** Tryb testowy `/update` — współdzieli pełną implementację przez `_runUpdateFlow(interaction, { dryRun: true, commandName: 'test', ocrBlockKey: 'test' })`:
     - Widoczna tylko dla administratorów (`setDefaultMemberPermissions(Administrator)`); wykonać może wyłącznie użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`
     - Identyczny przepływ jak `/update` (te same walidacje, ten sam `analyzeTestImage()` z weryfikacją wzorca, ten sam prompt) **z wyjątkiem** kroków dry-run:
       - Wynik (rekord i brak rekordu) wyświetlany jako **ephemeral** w `editReply` — bez publicznego `followUp`
       - **Brak zapisu do rankingu** (`ranking_{guildId}.json`) — `isNewRecord` obliczany porównaniem z aktualnym stanem bez `updateUserRanking()`
       - **Brak aktualizacji ról TOP** (`roleService.updateTopRoles`)
       - **Brak powiadomień Global Top 3** na inne serwery
       - **Brak powiadomień DM** do subskrybentów
       - **Brak `logScoreUpdate`** (log rekordu do webhooka)
     - Nadal działa: `logCommandUsage('test')`, `usageLimitService` (zlicza dzienny limit), `tokenUsageService` (rejestruje koszty AI), `_sendInvalidScreenReport` dla NOT_SIMILAR/FAKE_PHOTO, Operations Gateway z `hints.command='test'`
     - Respektuje `isAllowedChannel`, blokadę użytkownika (`userBlockService`) oraz globalny blok OCR (`ocrBlockService.isBlocked('test')`)

2. **Rankingi Multi-Server** - `rankingService.js`:
   - **Per-serwer:** Osobny plik `data/ranking_{guildId}.json` dla każdego serwera
   - **Globalny:** `getGlobalRanking()` — najlepszy wynik gracza ze wszystkich serwerów (z adnotacją skąd pochodzi)
   - Eksport do `shared_data/endersecho_ranking.json` (globalny, format: `{updatedAt, players: [{rank, userId, username, score, scoreValue, bossName, timestamp, sourceGuildId}]}`)
   - Eksport przy każdym zapisie i przy starcie bota
   - **Sync do Web API:** Po eksporcie `saveSharedRanking()` wypycha każdego gracza do `/api/bot/endersecho-snapshot` (upsert po `discordId+snapshotDate`). `snapshotDate` jest przycinany do doby UTC (00:00Z) — restart bota i wielokrotne zapisy w ciągu dnia aktualizują ten sam wiersz zamiast tworzyć duplikaty. Gracze bez prawidłowego `scoreValue` (NaN/undefined/ujemne) są pomijani. `scoreNumeric` jest formatowany przez `toFixed(0)` (nie `String()`), żeby wartości >= 1e21 (jednostki Sx, duże Qi) nie lądowały w notacji wykładniczej `"1.65e+21"` odrzucanej przez walidację API (`/^\d+$/`). Cicho no-op gdy brak `APP_API_URL`/`BOT_API_KEY`. Zobacz shared `utils/appSync.js`.
   - **Pomijanie sync na starcie:** `saveSharedRanking({ syncToApi: false })` — wywoływane z `index.js` przy `ready`, żeby restart bota nie spamował API rankingiem, który się nie zmienił. Lokalny eksport `shared_data/endersecho_ranking.json` nadal wykonuje się zawsze. Sync do API uruchamia się dopiero przy nowym wyniku OCR (przez `saveRanking()` → `saveSharedRanking()` bez argumentów, default `syncToApi: true`).
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`

3. **Role TOP (opcjonalne)** - `roleService.js`:
   - 5 poziomów (top1, top2, top3, top4-10, top11-30), auto-update
   - Role są **opcjonalne per serwer** — jeśli serwer nie ma skonfigurowanych ról, bot je pomija
   - `updateTopRoles(guild, _sortedPlayers, guildTopRoles)` — zawsze pobiera świeże dane z rankingu (parametr `sortedPlayers` ignorowany)
   - **Mutex per-guild** (`_locks` Map): jeśli aktualizacja dla danego serwera jest już w toku, kolejna zostaje oznaczona jako `hasPending`; po zakończeniu bieżącej uruchamiana jest automatycznie z najświeższym rankingiem (via `setImmediate`). Wyklucza race condition przy równoczesnych rekordach.
   - **Diff-based update**: zamiast resetować wszystkie role i przyznawać od nowa, oblicza różnicę między aktualnym stanem (z Discord cache `role.members`) a pożądanym (z rankingu). Tylko faktyczne zmiany trafiają do API. Jeśli gracz nie zmienił pozycji, zero API calls.
   - **Równoległe operacje**: usunięcia i dodania wykonywane przez `Promise.allSettled` — szybsze niż sekwencyjne `await`. Batch fetch wszystkich memberów wymagających roli naraz (`guild.members.fetch({ user: [...] })`).
   - **Ogłoszenie rekordu** (`rankingService.createRecordEmbed`):
     - Kolor embeda wg pozycji: 🥇 złoty (TOP1), 🥈 srebrny (TOP2), 🥉 brązowy (TOP3), niebieski (TOP4-10), zielony (TOP11+)
     - Tytuł: `🏆 GRATULACJE!` + opis z headerem markdown
     - Pola: Postęp (`stary ➜ nowy`), Poprawa (`+X`), Data, Pozycja z medalem emoji
     - Author (górny pasek): ikona roli + nazwa roli (jeśli rola ma ikonę/emoji)
     - Thumbnail: avatar gracza | Image: screenshot wyniku
   - **Powiadomienie Global Top 3** (`rankingService.createGlobalTop3Embed`):
     - Wysyłane na kanał każdego serwera gdy gracz wchodzi lub poprawia wynik w globalnym Top 3 (pozycje 1-3)
     - Warunek: `isNewRecord = true` ORAZ wynik gracza w globalnym rankingu faktycznie wzrósł (eliminuje przypadek gdy nowy rekord lokalny jest słabszy od wyniku z innego serwera)
     - Embed zawiera: kto, jaki wynik (z postępem `stary ➜ nowy +X`), na jakim serwerze, kiedy (+ ile temu poprzedni), lokata globalna z medalem i adnotacją (wejście do Top3 / awans z #N)
     - Kolor embeda wg pozycji globalnej (złoty/srebrny/brązowy)
     - Każdy serwer otrzymuje wiadomość **w swoim języku** (pol/eng wg konfiguracji `ENDERSECHO_GUILD_N_LANG`)
     - Powiadomienie idzie do `allowedChannelId` każdego serwera

4. **Paginacja + Wybór Rankingu** - `interactionHandlers.js`:
   - `/ranking` → ephemeral z przyciskami: `[NazwaSerwera1]`, `[NazwaSerwera2]`, `[🌐 Global]`
   - Nazwy serwerów pobierane dynamicznie z `client.guilds.cache`
   - Po kliknięciu serwera → ranking z paginacją (10/strona, 1h timeout) + przyciski rankingów ról (jeśli skonfigurowane)
   - Ranking globalny wyróżniony kolorem niebieskim (0x5865f2), serwer złotym (0xffd700)
   - W rankingu globalnym każda linia zawiera nazwę serwera źródłowego
   - Przycisk Powrót (`ranking_back`) w wierszu paginacji jako 5. przycisk (na końcu)

6. **Rankingi Ról** - `roleRankingConfigService.js` + `interactionHandlers.js`:
   - `/add-role-ranking` (admin) → select menu z rolami serwera → dodaje ranking roli, max **10 ról** per serwer
   - `/remove-role-ranking` (admin) → select menu z aktualnymi rankingami ról → usuwa wybrany
   - Konfiguracja persystowana w `data/role_rankings_{guildId}.json` (`[{ roleId, roleName, addedAt }]`)
   - Po wybraniu serwera w `/ranking` → pod paginacją pojawiają się przyciski `[NazwaRoli]` (max 2 wiersze po 5)
   - Kliknięcie przycisku roli → ranking filtrowany do graczy aktualnie posiadających tę rolę
   - Filtrowanie: batch-fetch tylko graczy z rankingu (nie całego serwera) → `guild.members.fetch({ user: [...ids] })`
   - **Cache RAM** (3 min TTL): wyniki fetch trzymane w `_memberCache` Map → kolejne kliknięcia bez dodatkowych requestów
   - Powrót z rankingu roli (`ranking_back`) → wraca do rankingu serwera (z przyciskami ról)
   - Wymaga `GatewayIntentBits.GuildMembers` (Privileged) włączonego w Discord Developer Portal

5. **System Powiadomień DM** - `notificationService.js` + `interactionHandlers.js`:
   - `/subscribe` → ephemeral z przyciskami: `[🔔 Ustaw powiadomienie]` i `[🔕 Usuń powiadomienie]`
   - **Subskrypcja:** użytkownik wybiera serwer → gracza z rankingu → potwierdza → subskrypcja zapisana w `data/notifications.json`
   - **Wysyłanie DM:** po każdym nowym rekordzie bot szuka subskrybentów danego gracza i wysyła im DM z kopią embeda rekordu + zdjęciem + stopką `notifDmFooter`
   - `createDmNotifEmbed(recordEmbed, messages)` — klonuje embed rekordu i dodaje stopkę w `rankingService.js`
   - Subskrypcje są trwałe (plik JSON) — przeżywają restart bota
   - Limit: max 25 subskrypcji wyświetlanych naraz w select menu (Discord API limit)

6. **Komenda /info** — wysyłanie wiadomości informacyjnej na wszystkie serwery (`interactionHandlers.js`):
   - Widoczna tylko dla administratorów (`setDefaultMemberPermissions(Administrator)`)
   - Wykonać może tylko użytkownik o ID z `ENDERSECHO_INFO_USER_ID` w .env
   - `/info` → modal z 4 polami: Tytuł (opcjonalnie), Opis (wymagany), Ikona URL (opcjonalnie), Obraz URL (opcjonalnie)
   - Po wypełnieniu → ephemeral podgląd z czerwonym embedem + 3 przyciski: **Wyślij**, **Edytuj**, **Anuluj**
   - **Wyślij** → wysyła embed na `allowedChannelId` każdego serwera z `config.guilds`, raportuje wynik
   - **Edytuj** → pokazuje modal ponownie z wypełnionymi danymi z sesji
   - **Anuluj** → czyści sesję
   - Dane między modalem a przyciskami przechowywane w `_infoSessions` Map (RAM, per userId)

**Komendy:** `/update`, `/ranking`, `/remove`, `/subscribe`, `/info`, `/ocr-on-off`, `/limit`, `/test`, `/unblock`, `/add-role-ranking`, `/remove-role-ranking`, `/tokens`, `/configure`

**Komenda /tokens** — statystyki zużycia tokenów AI (admin):
- Wyświetla dzienny i miesięczny koszt w $ per serwer oraz sumy łączne
- Dane zbierane tylko przy `/update` (AI OCR) i zapisywane w `data/token_usage.json`
- Podział na: tokeny wejściowe (In), wyjściowe (Out) i myślenia (Think)
- Cennik: `services/tokenUsageService.js` → stałe `PRICING` (In $0.15, Out $0.60, Think $0.35 / 1M tokenów)

**Komenda /limit** — dzienny limit użyć /update i /test (`usageLimitService.js`):
- Widoczna tylko dla administratorów, wykonać może wyłącznie użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`
- `/limit` → modal z polem „Liczba prób dziennie" (puste = brak limitu)
- Limit globalny per-użytkownik per-dzień (UTC), wspólny dla /update i /test
- Po przekroczeniu → ephemeral z informacją i prośbą o próbę jutro
- Persistencja: `data/usage_limits.json` (`{ limit, dailyUsage: { "userId_YYYY-MM-DD": count } }`)
- Stare wpisy usage automatycznie czyszczone przy każdym zapisie (tylko dzisiaj zostaje)

**Komenda /configure** — wizard konfiguracji serwera (admin, dowolny kanał):
- 6-krokowy dashboard ephemeral z przyciskami szarymi→zielonymi po ukończeniu kroku
- **Krok 1:** Kanał bota (ChannelSelectMenu) — dla /update, /ranking, /subscribe
- **Krok 2:** Tag serwera (1–4 znaki lub emoji, modal) — wyświetlany w globalnym rankingu
- **Krok 3:** Język (pol/eng) — wszystkie komunikaty i opisy komend; tłumaczony na pol gdy `state.lang === 'pol'`
- **Krok 4:** Role TOP (opcjonalne, modal 5 pól ID ról) z wyjaśnieniem systemu
- **Krok 5:** Powiadomienia Global TOP3 (Tak/Nie) — per-guild flaga `globalTop3Notifications`
- **Krok 6:** Kanał raportów odrzuconych screenów (opcjonalny, ChannelSelectMenu)
- Zielony przycisk **✅ Zaakceptuj konfigurację!** (ButtonStyle.Success) pojawia się gdy wszystkie kroki ukończone
- Szary przycisk **Anuluj** widoczny od początku — czyści `_configWizard` i zamyka dashboard
- Po zapisaniu: OCR domyślnie zablokowane (`['update', 'test']`), komendy re-rejestrowane dla nowego języka
- Konfiguracja persystowana w `data/guild_configs.json` przez `GuildConfigService`
- Stan wizarda trzymany w RAM (`_configWizard` Map, per userId_guildId)
- Bot po raz pierwszy dodany do serwera (`guildCreate`): automatyczna rejestracja komend + domyślny wpis (unconfigured, OCR zablokowane) + welcome message

**Komenda /ocr-on-off** — per-guild włącz/wyłącz komendy OCR (head admin tylko, dowolny kanał):
- Parametry: `action` (enable/disable), `target` (update/test/both), `guild` (autocomplete)
- Autocomplete `guild`: pobiera `getAllConfiguredGuildIds()` z `GuildConfigService`, filtruje po nazwie/ID
- Stan per-guild w `guild_configs.json` poprzez `OcrBlockService` (`ocrBlockService.block/unblock(guildId, commands[])`)
- Po odblokowanie → ogłoszenie do `allowedChannelId` serwera
- Migracja: stary globalny `ocr_blocked.json` → per-guild przy pierwszym starcie

**System raportów odrzuconych screenów** (per-guild + global):
- Raport w języku serwera źródłowego (`config.getMessages(guildId)`) — klucze `reportTitle`, `reportField*`, `reportReason*`
- Raport wysyłany do GLOBAL channel (`ENDERSECHO_INVALID_REPORT_CHANNEL_ID`) oraz opcjonalnie do per-guild kanału
- Footer globalnego raportu: `uid:{userId}|gid:{guildId}`
- Footer per-guild raportu: `ref:{globalMsgId}|uid:{userId}|gid:{guildId}`
- Gdy admin klika przycisk na per-guild embeddzie → globalny raport aktualizowany (pole akcji + usunięcie przycisków)
- Przycisk **Analizuj** (`ee_analyze_`) dostępny dla raportu `NOT_SIMILAR` — pobiera obraz z `embed.image.url` (CDN URL), nie z `message.attachments`; uruchamia pełny flow OCR i zapisuje wynik dla docelowego użytkownika
- Metody pomocnicze: `_parseReportFooter(text)` i `_updateGlobalReportMsg(client, globalMsgId, guildId, action, admin, extra)`

**System blokowania per-użytkownik** — `userBlockService.js` + `data/user_blocks.json`:
- Raport odrzuconego screena zawiera przyciski **Zatwierdź** i **Zablokuj użytkownika** (widoczne na kanale `ENDERSECHO_INVALID_REPORT_CHANNEL_ID`)
- **Zablokuj** otwiera modal z polem czasu (np. `1h`, `7d`, `30m` — puste = permanentnie)
- Zablokowany użytkownik przy próbie `/update` widzi komunikat o blokadzie i konieczności kontaktu z adminem
- `/unblock` (admin) — lista zablokowanych posortowana od najkrótszej kary do permanentnych, select menu do odblokowania
- Persistencja przeżywa restart bota

**GuildConfigService** — `services/guildConfigService.js`:
- Przechowuje konfigurację per-guild w `data/guild_configs.json`
- `load(envGuilds)`: importuje serwery z `.env` (configured, importedFromEnv), migruje `ocr_blocked.json`
- `saveConfig(guildId, data)`: merge z istniejącą konfiguracją, serialized write queue
- `getOcrBlocked/setOcrBlocked`: per-guild stan blokady OCR
- `getAllConfiguredGuilds()`: format kompatybilny z `config.guilds` (id, allowedChannelId, lang, tag, topRoles, globalTop3Notifications)

**Uprawnienia komend** (po nowym routingu):
- Bez konfiguracji (zawsze): `/configure`, `/info`, `/ocr-on-off`, `/limit`, `/tokens`, `/unblock`
- Wymaga konfiguracji, dowolny kanał: `/test`, `/remove`, `/add-role-ranking`, `/remove-role-ranking`
- Wymaga konfiguracji + bot channel: `/update`, `/ranking`, `/subscribe`

**Struktura danych:**
```
EndersEcho/data/
├── ranking_{guildId1}.json   # Ranking serwera 1
├── ranking_{guildId2}.json   # Ranking serwera 2
├── notifications.json        # Subskrypcje powiadomień DM
├── guild_configs.json        # Per-guild konfiguracja
├── update_cooldowns.json     # Cooldowny /update (userId → expiresAt timestamp ms)
└── ...
```

**Rejestracja komend:** Komendy slash rejestrowane per-serwer przez `registerSlashCommands()` (start) i `registerCommandsForGuild()` (guildCreate / po /configure).

**Sync identity → Polski Squad admin API** — wpięcie `guildCreate`, `guildDelete`, `guildMemberAdd`, `guildMemberUpdate` w [index.js](index.js), po jednym listenerze na event, każdy fire-and-forget przez `appSync.guildJoined/guildLeft/memberSeen`. Uniwersalny kontrakt (projekcja, endpointy, intenty, polityka błędów) opisany w głównym [CLAUDE.md § 6](../CLAUDE.md). EndersEcho-specyfika: `guildCreate` ma **dwa** listenery — onboarding (default guild config, rejestracja komend, welcome message) i osobno appSync push. Wymaga `GatewayIntentBits.GuildMembers` (już włączony w [index.js:42](index.js#L42)).

---

## Zmienne Środowiskowe

```env
ENDERSECHO_TOKEN=bot_token_here
ENDERSECHO_CLIENT_ID=client_id

# Serwer 1
ENDERSECHO_GUILD_1_ID=guild_id
ENDERSECHO_GUILD_1_CHANNEL=channel_id
ENDERSECHO_GUILD_1_LANG=pol          # pol lub eng (domyślnie pol)
ENDERSECHO_GUILD_1_TAG=🔥 PS         # Tag w globalnym rankingu i w logu Discord (opcjonalny)
ENDERSECHO_GUILD_1_ICON=https://...  # URL ikony serwera — avatar w dedykowanym logu (opcjonalny)

# Role TOP serwera 1 (opcjonalne — jeśli brak, bot nie zarządza rolami)
ENDERSECHO_GUILD_1_TOP1_ROLE=role_id
ENDERSECHO_GUILD_1_TOP2_ROLE=role_id
ENDERSECHO_GUILD_1_TOP3_ROLE=role_id
ENDERSECHO_GUILD_1_TOP4TO10_ROLE=role_id
ENDERSECHO_GUILD_1_TOP11TO30_ROLE=role_id

# Serwer 2
ENDERSECHO_GUILD_2_ID=guild_id
ENDERSECHO_GUILD_2_CHANNEL=channel_id
ENDERSECHO_GUILD_2_LANG=eng          # pol lub eng (domyślnie pol)
ENDERSECHO_GUILD_2_TAG=⚔️ CS         # Tag w globalnym rankingu i w logu Discord (opcjonalny)
ENDERSECHO_GUILD_2_ICON=https://...  # URL ikony serwera (opcjonalny)
# Role TOP serwera 2 (opcjonalne)
ENDERSECHO_GUILD_2_TOP1_ROLE=role_id
# ... itd.

# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_GOOGLE_AI_API_KEY=AIzaSy-xxxxxxxxxxxxx
ENDERSECHO_GOOGLE_AI_MODEL=gemini-2.5-flash-preview-05-20

# Komenda /info (wymagane do działania /info)
ENDERSECHO_INFO_USER_ID=discord_user_id

# Dedykowany kanał logów EndersEcho (opcjonalne — jeśli ustawiony, logi NIE trafiają do głównego webhooka)
# Każdy serwer pojawia się z własnym avatarem (ENDERSECHO_GUILD_N_ICON) i nazwą (TAG)
# Separator kreską pojawia się przy każdej zmianie serwera
ENDERSECHO_LOG_WEBHOOK_URL=webhook_url

# Kanał raportów odrzuconych screenów (opcjonalne)
# Wysyła embed gdy screen jest odrzucony (podrobione zdjęcie, brak Victory, brak Best/Total)
# Embed zawiera: nick na serwerze, Discord username, serwer, czas, powód, zdjęcie
ENDERSECHO_INVALID_REPORT_CHANNEL_ID=channel_id

# Użytkownicy uprawnieni do /ocr-on-off (ID rozdzielone przecinkami)
# Komenda włącza/wyłącza /update i/lub /test per-guild (parametry: action, target, guild z autocomplete)
# Stan per-guild persystowany w data/guild_configs.json (ocrBlocked[])
ENDERSECHO_BLOCK_OCR_USER_IDS=discord_user_id_1,discord_user_id_2

# Sync do Polski Squad web API (opcjonalne, wspólne bot-wide)
APP_API_URL=https://api.polski-squad.example
BOT_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Per-bot override (opcjonalne) — wygrywa nad BOT_API_KEY dla EndersEcho.
# Używane przez rankingService (createAppSync({ botSlug: 'endersecho' })) oraz
# handlery OCR (createBotOperations({ botSlug: 'endersecho' })). Brak wpisu →
# EndersEcho spada na BOT_API_KEY. Szczegóły: główny CLAUDE.md → sekcja 6.
ENDERSECHO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Operations Metering Gateway — używa tej samej pary APP_API_URL + klucz co sync
# (ENDERSECHO_API_KEY z fallbackiem na BOT_API_KEY).
# Operation type: ocr.analyze (szczegóły w głównym CLAUDE.md → sekcja 7)

# Langfuse — LLM tracing (opcjonalne, niezależne od gateway-a)
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # opcjonalne (default: cloud)
```

## Operations Gateway + LLM Telemetry

Wspólny wzorzec opisany w głównym [CLAUDE.md § 7](../CLAUDE.md). Tutaj tylko to co specyficzne dla EndersEcho.

**Operation type:** `ocr.analyze` — jeden typ dla `/test` i `/update`, różnicowane przez `hints.command`. Unikalny w ramach `BotOperation` per bot (nie musi nieść prefiksu `endersecho` — bot jest identyfikowany przez Bearer token).

### Punkty wpięcia w kodzie

| Plik | Rola |
|---|---|
| [index.js](index.js) | `telemetry.init('endersecho-bot')` jest pierwszym requirem w pliku (przed Discord.js i Gemini SDK) |
| [index.js](index.js) | `createLlmAdapter`, `createAppSync({ apiKey: config.appApiKey }).sync`, `createBotOperations({ botSlug: 'endersecho', apiKey: config.appApiKey })` budowane w launcherze i wstrzykiwane przez konstruktory (DI) do `AIOCRService`, `RankingService`, `InteractionHandler` |
| [services/aiOcrService.js](services/aiOcrService.js) | `llmAdapter` wymagany w konstruktorze — bez niego `enabled=false` |
| [services/rankingService.js](services/rankingService.js) | `appSync` wstrzykiwany przez konstruktor, używany jako `this.appSync.endersEchoSnapshot(...)` |
| [handlers/interactionHandlers.js](handlers/interactionHandlers.js) | `botOps` wstrzykiwany przez konstruktor (ostatni arg); wspólne ciało `/update` i `/test` to `_runUpdateFlow(interaction, { dryRun, commandName, ocrBlockKey })` — `dryRun:true` wyłącza zapis do rankingu, role TOP, powiadomienia Global Top 3 i DM |

### Specyfika bota

- **`/test` jako dry-run `/update`.** Oba handlery delegują do `_runUpdateFlow`; różnice wyłącznie w `dryRun` (ephemeral output, brak zapisu/ról/powiadomień), `commandName` (→ `hints.command`, logi, klucz blokady OCR) i uprawnieniach wejściowych (`/test` wymaga wpisu w `ENDERSECHO_BLOCK_OCR_USER_IDS`). Ten sam prompt wzorca (`compare-template`), ten sam `analyzeTestImage()`, ten sam Operations Gateway, ten sam `tokenUsageService` i `usageLimitService`. Padnięcie Gemini w obu komendach = błąd dla usera (brak fallbacku na Tesseract).
- **`usageLimitService`** — lokalny dzienny limit per user (`data/usage_limits.json`), działa równolegle do quota w API.
- **`PROMPT_VERSIONS`** w [services/aiOcrService.js:15-24](services/aiOcrService.js#L15-L24) — 6 wpisów: `victory-check-eng`, `victory-check-jpn`, `authenticity-check`, `extract-data-eng`, `extract-data-jpn`, `compare-template`. Po zmianie treści promptu bump wersji (`'v1'` → `'v2'`) — stare trace zostają w Langfuse do porównania.
- **Model Gemini** dla wszystkich promptów ten sam: z `ENDERSECHO_GOOGLE_AI_MODEL` (default: `gemini-2.5-flash-preview-05-20`).

### A/B testing

Atrybuty na spanach generation: `llm.model.name`, `llm.prompt.name`, `llm.prompt.version`, `llm.step`, plus `user.id`, `guild.id`, `operation.type` na root spanie.

Przykłady zapytań:
- Porównanie modeli dla ekstrakcji: filter `llm.prompt.name="extract-data-eng"`, group by `llm.model.name`
- Porównanie wersji promptu anty-fake: filter `llm.prompt.name="authenticity-check"`, group by `llm.prompt.version`, metryka `% status='REJECTED'`
- Historia konkretnego usera: filter `user.id=<discordId>` → failed generations → prompt + response

Rzetelne porównania: [Langfuse Datasets](https://langfuse.com/docs/datasets/get-started) — zestaw referencyjnych screenów puszczany przez różne warianty.

## Najlepsze Praktyki

- **Logger (ogólny):** `createBotLogger('EndersEcho')` — tylko konsola + plik; jeśli ustawiony `ENDERSECHO_LOG_WEBHOOK_URL`, EndersEcho jest **pomijany** w głównym webhooku botów
- **Logger (per-serwer):** `logService._gl(guildId).info(msg)` lub przez metody `logService.logCommandUsage/logScoreUpdate/logOCRError/logRankingError(... , guildId)` — trafia do dedykowanego webhooka z avatarem serwera i separatorem
- **GuildLogger:** `services/guildLogger.js` — zarządza kolejką webhooka, avatarem (ICON) i separatorem przy zmianie serwera
- **OCR Debug:** Brak komendy — logowanie OCR jest wyłączone
- **Ranking per-serwer:** `rankingService.loadRanking(guildId)` / `saveRanking(guildId, ranking)`
- **Ranking globalny:** `rankingService.getGlobalRanking()` (merge wszystkich serwerów, best per player)
- **Role opcjonalne:** Zawsze przekazuj `guildConfig?.topRoles || null` do `roleService.updateTopRoles()`
- **Migracja:** Automatyczna przy starcie — stary `ranking.json` → `ranking_{guild1Id}.json`
