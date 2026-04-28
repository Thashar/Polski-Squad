### 🏆 EndersEcho Bot

**⚠️ ZASADA DWUJĘZYCZNOŚCI (KRYTYCZNE) — DOTYCZY WSZYSTKICH ELEMENTÓW UI:**
- Bot obsługuje dwa języki: `pol` i `eng` — konfigurowane per serwer przez `/configure`
- **KAŻDY nowy element UI** (komendy slash, embedy, przyciski, select menu, modale, komunikaty) MUSI mieć obie wersje językowe
- Brak którejkolwiek wersji językowej to **błąd implementacyjny**

**Komendy slash:**
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

**Panel Admina i dynamiczne UI (przyciski, embedy, select menu):**
- Używaj helpera `_panelT(guildId)` zwracającego funkcję `t(pol, eng)` na podstawie języka serwera
- Każda widoczna dla użytkownika wartość tekstowa MUSI używać `t('PL', 'EN')`
- Wzorzec obowiązkowy dla każdej nowej operacji w panelu:
  ```javascript
  async _handlePanelNowaOperacja(interaction) {
      const t = this._panelT(interaction.guildId);
      await interaction.update({
          embeds: [new EmbedBuilder().setTitle(t('Tytuł PL', 'Title EN')).setDescription(t('Opis PL', 'Description EN'))],
          components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setLabel(t('Etykieta PL', 'Label EN'))
          )]
      });
  }
  ```

**Komunikaty systemowe** (`messages.js`):
- Nowe klucze MUSZĄ być dodane do obu sekcji: `pol` i `eng`

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
   - Zarządzanie przez `/configure` krok 7 (admin) → przyciski: "Dodaj ranking roli" (RoleSelectMenu), "Usuń ranking roli" (StringSelectMenu), "Gotowe / Pomiń"
   - Max **10 ról** per serwer; konfiguracja persystowana w `data/role_rankings_{guildId}.json` (`[{ roleId, roleName, addedAt }]`)
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

6. **Panel Admina** — dostępny przez `/configure` → `⚙️ Panel Admina`:
   - **Usuń gracza z rankingu (admin):** modal wyszukiwania nicku → przefiltrowana lista → potwierdzenie → usunięcie + aktualizacja ról TOP. Head Admin może usunąć gracza z **dowolnego serwera** (cross-server).
   - **Odblokuj gracza (admin):** modal wyszukiwania nicku → przefiltrowana lista → odblokowanie. Persistencja: `data/user_blocks.json`. Jeśli blokada pochodzi od Head Admina (`blockedByHeadAdmin: true`) — zwykły Admin nie może odblokować.
   - **Zablokuj gracza (head admin):** modal wyszukiwania nicku cross-server → lista graczy → potwierdzenie → modal czasu blokady. Blokada zapisywana z flagą `blockedByHeadAdmin: true`.
   - **Zużycie tokenów (admin/head admin):** embed ze statystykami AI per serwer. Admin = swój serwer, Head Admin = wszystkie + breakdown
   - **AI OCR on/off (head admin):** modal wyszukiwania nazwy serwera → jeśli 1 wynik: bezpośrednio toggle, jeśli wiele: lista → toggle per komenda. Stan w `guild_configs.json` przez `OcrBlockService`
   - **Ustaw limity (head admin):** modal z 2 polami — cooldown (np. `5m`, `1h`) i limit dzienny (liczba). Persistencja: `data/usage_limits.json`, `data/update_cooldowns.json`
   - **Wyślij Info (head admin):** modal → podgląd PL+ENG → wyślij na wszystkie serwery. `_infoSessions` Map (RAM)

**Komendy slash:** `/configure`, `/ranking`, `/subscribe`, `/test`, `/update`

**Panel Admina** — dostępny przez `/configure` → przycisk `⚙️ Panel Admina` (ostatni rząd):
- Dostęp: każdy admin Discord (Administrator) który może otworzyć `/configure`
- **Układ rzędów (Tryb Admin):**
  - Rząd 1: `🗑️ Usuń gracza z rankingu`, `🔓 Odblokuj gracza`
  - Rząd 2: `📊 Zużycie tokenów`
  - Rząd 3: `◀️ Wróć do konfiguracji`
- **Układ rzędów (Tryb Head Admin):**
  - Rząd 1: `🗑️ Usuń gracza z rankingu`, `🔓 Odblokuj gracza`
  - Rząd 2: `📊 Zużycie tokenów`, `🔄 AI OCR on/off`, `⚙️ Ustaw limity`
  - Rząd 3: `🔒 Zablokuj gracza`, `📢 Wyślij Info`
  - Rząd 4: `◀️ Wróć do konfiguracji`
- Po kliknięciu "Usuń/Odblokuj/OCR" → modal wyszukiwania (nowa wiadomość ephemeral z wynikami). Po akcji `panel_back` → panel pojawia się w tej samej wiadomości

**Operacje w Panelu Admina:**

**🗑️ Usuń gracza z rankingu** (Admin):
- Modal wyszukiwania → fragment nicku → przefiltrowana lista (StringSelectMenu, max 25)
- Krok potwierdzenia przed usunięciem → aktualizacja ról TOP
- "Szukaj ponownie" → otwiera nowy modal wyszukiwania

**🔓 Odblokuj gracza** (Admin):
- Jeśli brak zablokowanych → informacja od razu (update panelu)
- Jeśli są zablokowani → modal wyszukiwania → fragment nicku → przefiltrowana lista
- `panel_unblock_select` — StringSelectMenu z wynikami
- Jeśli gracz zablokowany przez Head Admina (`blockedByHeadAdmin: true`) → zwykły Admin widzi błąd ⛔, nie może odblokować

**🔒 Zablokuj gracza** (Head Admin):
- Modal wyszukiwania nicku cross-server (wszystkie skonfigurowane serwery)
- Lista `panel_block_select` → potwierdzenie z opcją ustawienia czasu → modal czasu → blokada z flagą `blockedByHeadAdmin: true`
- Zablokowanego przez Head Admina nie może odblokować zwykły Admin (ani przez panel, ani przez `/unblock`)

**📊 Zużycie tokenów** (Admin/Head Admin):
- Embed ze statystykami dzienny/miesięczny koszt AI per serwer
- Admin widzi tylko swój serwer; Head Admin widzi wszystkie + breakdown
- Nawigacja `tk_*` zachowuje przycisk `◀️ Powrót do panelu`
- Dane z `data/token_usage.json`, cennik: In $0.15, Out $0.60, Think $0.35 / 1M tokenów

**📢 Wyślij Info** (Head Admin):
- Otwiera modal z 4 polami: Tytuł, Opis PL, Opis ENG, Ikona URL, Obraz URL
- Podgląd embeda + przyciski Wyślij / Edytuj / Anuluj
- Wysyła na `allowedChannelId` każdego serwera w odpowiednim języku
- Dostęp: `ENDERSECHO_BLOCK_OCR_USER_IDS` (ta sama zmienna co Head Admin)

**🔄 AI OCR on/off** (Head Admin):
- Modal wyszukiwania nazwy serwera → jeśli 1 trafienie: od razu toggle screen; jeśli wiele: lista StringSelectMenu
- Po wyborze serwera: przyciski włącz/wyłącz dla `/update`, `/test`, obu
- Ogłoszenie na kanał bota serwera po odblokowaniu

**⚙️ Ustaw limity** (Head Admin):
- Modal z **2 polami**:
  1. Limit dzienny (liczba, puste = brak limitu) — `data/usage_limits.json`
  2. Cooldown po użyciu (format: `5m`, `1h`, `1h30m`, puste = brak cooldownu) — `data/update_cooldowns.json`
- Cooldown parsowany przez `_parseCooldownDuration(raw)` → `XhXm` → ms
- Domyślny cooldown (przed pierwszym ustawieniem): 5m
- `formatCooldownDuration(ms)` — wyświetla bieżący cooldown jako `Xh Xm` w polu modal

**CustomIDs Panelu Admina:**
| CustomId | Opis |
|---|---|
| `cfg_admin_panel` | Otwórz panel (z configure dashboard) |
| `panel_back` | Wróć do panelu (z dowolnej operacji) |
| `panel_back_configure` | Wróć do wizarda /configure |
| `panel_remove` | Otwórz modal wyszukiwania gracza |
| `panel_remove_search_modal` | Modal wyszukiwania (pole `remove_query`) |
| `panel_remove_select` | StringSelectMenu — wybór gracza z wyników |
| `panel_remove_confirm_{userId}` | Potwierdzenie usunięcia |
| `panel_unblock` | Jeśli brak zablokowanych: info; inaczej modal wyszukiwania |
| `panel_unblock_search_modal` | Modal wyszukiwania (pole `unblock_query`) |
| `panel_unblock_select` | StringSelectMenu — wybór do odblokowania |
| `panel_tokens` | Pokaż statystyki tokenów |
| `panel_info` | Otwórz modal /info (head admin) |
| `panel_ocr` | Otwórz modal wyszukiwania serwera OCR (head admin) |
| `panel_ocr_search_modal` | Modal wyszukiwania (pole `ocr_query`) |
| `panel_ocr_guild_select` | StringSelectMenu — wybór serwera (wiele wyników) |
| `panel_ocr_{en\|dis}_{update\|test\|both}_{guildId}` | Wykonaj OCR toggle |
| `panel_limit` | Otwórz modal limitów — 2 pola (head admin) |
| `panel_block` | Otwórz modal wyszukiwania gracza do zablokowania (head admin) |
| `panel_block_search_modal` | Modal wyszukiwania cross-server (pole `block_query`) |
| `panel_block_select` | StringSelectMenu — wybór gracza do zablokowania |
| `panel_block_time_{userId}_{guildId}` | Otwórz modal czasu blokady |
| `panel_block_modal_{userId}_{guildId}` | Modal czasu blokady (pole `block_duration`) |

**Komenda /configure** — wizard konfiguracji serwera + Panel Admina (admin, dowolny kanał):
- 7-krokowy dashboard ephemeral z przyciskami szarymi→zielonymi po ukończeniu kroku
- **Krok 1:** Język (pol/eng) — wszystkie komunikaty i opisy komend
- **Krok 2:** Kanał bota (ChannelSelectMenu) — dla /update, /ranking, /subscribe
- **Krok 3:** Kanał raportów odrzuconych screenów (opcjonalny, ChannelSelectMenu)
- **Krok 4:** Tag serwera (1–4 znaki lub emoji, modal) — wyświetlany w globalnym rankingu
- **Krok 5:** Role TOP (opcjonalne, modal 5 pól ID ról) z wyjaśnieniem systemu
- **Krok 6:** Powiadomienia Global TOP3 (Tak/Nie) — per-guild flaga `globalTop3Notifications`
- **Krok 7:** Ranking roli (opcjonalne) — przyciski "Dodaj ranking roli" (RoleSelectMenu), "Usuń ranking roli" (StringSelectMenu), "Gotowe / Pomiń"; stan `roleRankingsDone` w RAM; dla istniejącej konfiguracji pre-fill `true`
- Zielony przycisk **✅ Zaakceptuj konfigurację!** pojawia się gdy wszystkie kroki ukończone
- **Ostatni rząd:** `⚙️ Panel Admina` — dostęp do operacji administracyjnych (patrz sekcja Panel Admina)
- Po zapisaniu: OCR domyślnie zablokowane (`['update', 'test']`), komendy re-rejestrowane dla nowego języka
- Konfiguracja persystowana w `data/guild_configs.json` przez `GuildConfigService`
- Stan wizarda trzymany w RAM (`_configWizard` Map, per userId_guildId)

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
- **Zablokuj** otwiera modal z polem czasu (np. `1h`, `7d`, `30m` — puste = permanentnie); jeśli klikający jest Head Adminem, blokada zapisywana z flagą `blockedByHeadAdmin: true`
- Zablokowany użytkownik przy próbie `/update` widzi komunikat o blokadzie i konieczności kontaktu z adminem
- `/unblock` (admin) — lista zablokowanych posortowana od najkrótszej kary do permanentnych, select menu do odblokowania; jeśli `blockedByHeadAdmin: true` — zwykły Admin nie może odblokować
- Panel Admina → **🔒 Zablokuj gracza** (Head Admin) — cross-server wyszukiwanie + blokada z `blockedByHeadAdmin: true`
- Persistencja przeżywa restart bota

**GuildConfigService** — `services/guildConfigService.js`:
- Przechowuje konfigurację per-guild w `data/guild_configs.json`
- `load(envGuilds)`: importuje serwery z `.env` (configured, importedFromEnv), migruje `ocr_blocked.json`
- `saveConfig(guildId, data)`: merge z istniejącą konfiguracją, serialized write queue
- `getOcrBlocked/setOcrBlocked`: per-guild stan blokady OCR
- `getAllConfiguredGuilds()`: format kompatybilny z `config.guilds` (id, allowedChannelId, lang, tag, topRoles, globalTop3Notifications)

**Uprawnienia komend:**
- Bez konfiguracji (zawsze): `/configure` (+ Panel Admina)
- Wymaga konfiguracji, dowolny kanał: `/test` (Administrator + `ENDERSECHO_BLOCK_OCR_USER_IDS`)
- Wymaga konfiguracji + bot channel: `/update`, `/ranking`, `/subscribe`
- Panel Admina (tryb Admin): Administrator Discord → usuń gracza, odblokuj, tokeny
- Panel Admina (tryb Head Admin): `ENDERSECHO_BLOCK_OCR_USER_IDS` → wszystko + info, OCR toggle, limit

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

**Sync identity → Polski Squad admin API** — wpięcie `guildCreate`, `guildDelete`, `guildMemberAdd`, `guildMemberUpdate` w [index.js](index.js), każdy fire-and-forget przez `appSync.guildJoined/guildLeft/memberSeen/membersBulkSeen`. Uniwersalny kontrakt (projekcja, endpointy, intenty, polityka błędów) opisany w głównym [CLAUDE.md § 6](../CLAUDE.md). EndersEcho-specyfika:

- `guildCreate` ma **dwa** listenery — onboarding (default guild config, rejestracja komend, welcome message) i osobno appSync.
- Listener appSync woła `bootstrapGuildSync(guild)` → `guildJoined` + `guild.members.fetch()` + `membersBulkSeen` chunkami po 1000. Pal-uje przy realnym dołączeniu **i** każdym reconnect gatewaya — replay-safe, idempotentne po stronie API. Bez tego cold start (restart bota / reconnect po awarii) zostawiałby roster w API niezsynchronizowany, bo `guildMemberAdd` nie pal-uje retroaktywnie dla istniejących członków.
- `guildMemberAdd` / `guildMemberUpdate` zostają na single-row `appSync.memberSeen` — bulk obsługuje cold start, single-row obsługuje delty.
- **Wymaga włączonego "Server Members Intent" w Discord Developer Portal** dla aplikacji EndersEcho — sam `GatewayIntentBits.GuildMembers` w kodzie ([index.js:42](index.js#L42)) nie wystarczy, `members.fetch()` zwróciłoby pustą kolekcję milcząco.

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
- **Nick w logach:** Zawsze używaj `interaction.member?.displayName || interaction.user.displayName || interaction.user.username` — nigdy samego `interaction.user.username`
- **Logi /update (8 linii happy path):** start → `[AI Test] Test wzorca: "OK"` → AI OCR wynik+boss+total → logScoreUpdate → ogłoszenie → Role TOP → Global Top 3
- **Logi /update (odrzucenie, 3 linie):** start → `[AI Test] Test wzorca: "NOK: reason"` → `❌ Odrzucono: NOT_SIMILAR/FAKE_PHOTO/...`
- **OCR Debug:** Brak komendy — logi pośrednie AI OCR (Total, Boss/score z parseAIResponse) są usunięte; szczegóły widoczne tylko w logach błędów
- **Ranking per-serwer:** `rankingService.loadRanking(guildId)` / `saveRanking(guildId, ranking)`
- **Ranking globalny:** `rankingService.getGlobalRanking()` (merge wszystkich serwerów, best per player)
- **Role opcjonalne:** Zawsze przekazuj `guildConfig?.topRoles || null` do `roleService.updateTopRoles()`
- **Migracja:** Automatyczna przy starcie — stary `ranking.json` → `ranking_{guild1Id}.json`
