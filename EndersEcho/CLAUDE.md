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
     - Po udanej weryfikacji: pełny flow — zapis do rankingu, aktualizacja ról TOP, snippet globalnego rankingu (gdy pozycja globalna się zmieniła), powiadomienia DM
     - Wymaga `USE_ENDERSECHO_AI_OCR=true`; gdy AI wyłączone → ephemeral `testAiOcrRequired`
     - Respektuje blokadę użytkownika (`userBlockService`) i globalny blok OCR (`ocrBlockService.isBlocked('update')`)
     - **Cooldown 5 min** po udanym zapisie wyniku — sprawdzany przez `updateCooldownService`; informuje gracza ile czasu pozostało (w języku serwera); persystowany w `data/update_cooldowns.json` (przeżywa restart)
   - **Komenda /test (tylko admin + użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`, wymaga AI OCR):** Tryb testowy `/update` — współdzieli pełną implementację przez `_runUpdateFlow(interaction, { dryRun: true, commandName: 'test', ocrBlockKey: 'test' })`:
     - Widoczna tylko dla administratorów (`setDefaultMemberPermissions(Administrator)`); wykonać może wyłącznie użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`
     - Identyczny przepływ jak `/update` (te same walidacje, ten sam `analyzeTestImage()` z weryfikacją wzorca, ten sam prompt) **z wyjątkiem** kroków dry-run:
       - Wynik (rekord i brak rekordu) wyświetlany jako **ephemeral** w `editReply` — bez publicznego `followUp`
       - **Brak zapisu do rankingu** (`guilds/{guildId}/ranking.json`) — `isNewRecord` obliczany porównaniem z aktualnym stanem bez `updateUserRanking()`
       - **Brak aktualizacji ról TOP** (`roleService.updateTopRoles`)
       - **Brak snippeta globalnego rankingu**
       - **Brak powiadomień DM** do subskrybentów
       - **Brak `logScoreUpdate`** (log rekordu do webhooka)
     - Nadal działa: `logCommandUsage('test')`, `usageLimitService` (zlicza dzienny limit), `tokenUsageService` (rejestruje koszty AI), `_sendInvalidScreenReport` dla NOT_SIMILAR/FAKE_PHOTO, Operations Gateway z `hints.command='test'`
     - Respektuje `isAllowedChannel`, blokadę użytkownika (`userBlockService`) oraz globalny blok OCR (`ocrBlockService.isBlocked('test')`)

2. **Rankingi Multi-Server** - `rankingService.js`:
   - **Per-serwer:** Osobny plik `data/guilds/{guildId}/ranking.json` dla każdego serwera
   - **Globalny:** `getGlobalRanking()` — najlepszy wynik gracza ze wszystkich serwerów (z adnotacją skąd pochodzi)
   - Eksport do `shared_data/endersecho_ranking.json` (globalny, format: `{updatedAt, players: [{rank, userId, username, score, scoreValue, bossName, timestamp, sourceGuildId}]}`)
   - Eksport przy każdym zapisie i przy starcie bota
   - **Sync do Web API:** Po eksporcie `saveSharedRanking()` wypycha każdego gracza do `/api/bot/endersecho-snapshot` (upsert po `discordId+snapshotDate`). `snapshotDate` jest przycinany do doby UTC (00:00Z) — restart bota i wielokrotne zapisy w ciągu dnia aktualizują ten sam wiersz zamiast tworzyć duplikaty. Gracze bez prawidłowego `scoreValue` (NaN/undefined/ujemne) są pomijani. `scoreNumeric` jest formatowany przez `toFixed(0)` (nie `String()`), żeby wartości >= 1e21 (jednostki Sx, duże Qi) nie lądowały w notacji wykładniczej `"1.65e+21"` odrzucanej przez walidację API (`/^\d+$/`). Cicho no-op gdy brak `APP_API_URL`/`BOT_API_KEY`. Zobacz shared `utils/appSync.js`.
   - **Pomijanie sync na starcie:** `saveSharedRanking({ syncToApi: false })` — wywoływane z `index.js` przy `ready`, żeby restart bota nie spamował API rankingiem, który się nie zmienił. Lokalny eksport `shared_data/endersecho_ranking.json` nadal wykonuje się zawsze. Sync do API uruchamia się dopiero przy nowym wyniku OCR (przez `saveRanking()` → `saveSharedRanking()` bez argumentów, default `syncToApi: true`).
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`

3. **Role TOP (opcjonalne)** - `roleService.js`:
   - Do **10 w pełni konfigurowalnych progów** per serwer; każdy próg = zakres pozycji rankingowych + rola Discord
   - **Format danych:** `{ tiers: [{ from, to, roleId }] }` w `guild_configs.json`; backward compat ze starym formatem `{ top1, top2, top3, top4to10, top11to30 }` przez `normalizeTiers()`
   - **Backward compat:** `normalizeTiers(topRoles)` konwertuje stary format na `tiers[]` on-the-fly; istniejące konfiguracje działają bez migracji
   - Role są **opcjonalne per serwer** — jeśli serwer nie ma skonfigurowanych ról, bot je pomija
   - `updateTopRoles(guild, _sortedPlayers, guildTopRoles)` — zawsze pobiera świeże dane z rankingu (parametr `sortedPlayers` ignorowany)
   - **Mutex per-guild** (`_locks` Map): jeśli aktualizacja dla danego serwera jest już w toku, kolejna zostaje oznaczona jako `hasPending`; po zakończeniu bieżącej uruchamiana jest automatycznie z najświeższym rankingiem (via `setImmediate`). Wyklucza race condition przy równoczesnych rekordach.
   - **Diff-based update**: zamiast resetować wszystkie role i przyznawać od nowa, oblicza różnicę między aktualnym stanem (z Discord cache `role.members`) a pożądanym (z rankingu). Tylko faktyczne zmiany trafiają do API. Jeśli gracz nie zmienił pozycji, zero API calls.
   - **Równoległe operacje**: usunięcia i dodania wykonywane przez `Promise.allSettled` — szybsze niż sekwencyjne `await`. Batch fetch wszystkich memberów wymagających roli naraz (`guild.members.fetch({ user: [...] })`).
   - **Logowanie błędów per-guild**: `roleService` przyjmuje `logService` w konstruktorze i loguje błędy (usuwania/przyznawania ról, fetch memberów) przez `logService._gl(guildId)` — trafia do dedykowanego webhooka serwera.
   - **Ogłoszenie rekordu** (`rankingService.createRecordEmbed`):
     - Kolor embeda wg pozycji: 🥇 złoty (TOP1), 🥈 srebrny (TOP2), 🥉 brązowy (TOP3), niebieski (TOP4-10), zielony (TOP11+)
     - Tytuł: `🏆 GRATULACJE!` + opis z headerem markdown
     - Pola: Postęp (`stary ➜ nowy`), Poprawa (`+X`), Data, Pozycja z medalem emoji
     - Author (górny pasek): ikona roli + nazwa roli (jeśli rola ma ikonę/emoji)
     - Thumbnail: avatar gracza | Image: screenshot wyniku
   - **Snippet globalny** (`globalTop10Service.buildSnippetFieldData`):
     - Wbudowany jako pole w głównym embedzie rekordu, **powyżej pola osiągnięć**
     - Warunek: pozycja globalna gracza zmieniła się (dotyczy WSZYSTKICH graczy, nie tylko TOP10 serwera)
     - Zawiera: kierunek zmiany (▲/▼), stara → nowa pozycja, 3 linie rankingu globalnego (gracz powyżej, gracz, gracz poniżej) w formacie identycznym jak `/ranking → 🌐 Global`
   - **Cykliczny raport Global TOP10** (`globalTop10Service`) — `services/globalTop10Service.js`:
     - Interwał: 9 raportów co 3 dni, potem 4 dni przerwy, powtórz (cykl 10)
     - Konfiguracja w `data/global_top10_config.json` (enabled, nextTrigger, triggerCount, lastSnapshot)
     - Snapshot poprzednich pozycji → zmiany ▲/▼/=/🆕 przy każdym graczu
     - Boss okresu: najczęstszy boss z ostatnich 10 wpisów historii wyników (`wyniki/`)
     - Wysyłany na każdy serwer z `globalTopNotifications !== false` do `allowedChannelId`
     - Konfiguracja przez panel admina → **📅 Interwał TOP10** (tylko head admin) → modal z datą i godziną pierwszego raportu (format `DD.MM.RRRR GG:MM`); puste pole = wyłącz harmonogram
     - **Format embeda:** TOP 3 — blok blockquote z paskiem postępu `█░` (% względem lidera) i kolorowym wskaźnikiem zmiany `▲/▼`; pozycje 4–10 — kompaktowa jednolinijkowa z tagiem serwera
     - **Komenda /generate (head admin):** `buildOnDemandEmbed()` — generuje ten sam embed bez aktualizacji snapshootu/harmonogramu i wysyła go na `allowedChannelId` serwera; widoczna tylko dla adminów (`setDefaultMemberPermissions(Administrator)`), wykonać może wyłącznie head admin (`ENDERSECHO_BLOCK_OCR_USER_IDS`)

4. **Paginacja + Wybór Rankingu** - `interactionHandlers.js`:
   - `/ranking` → ephemeral z przyciskami: `[NazwaSerwera1]`, `[NazwaSerwera2]`, `[🌐 Global]`
   - Nazwy serwerów pobierane dynamicznie z `client.guilds.cache`
   - Po kliknięciu serwera → ranking z paginacją (10/strona, 1h timeout) + przyciski rankingów ról (jeśli skonfigurowane)
   - **Wykres historii rekordów** (`scoreHistoryService` + `chartService`): jeśli wywołujący ma ≥ 2 wpisy w ciągu ostatnich 90 dni → PNG dołączony do tej samej wiadomości rankingowej. Oś X: daty rzeczywiste (max 3 miesiące), oś Y: wyniki z jednostkami (K/M/B/T/Q/Qi/Sx), kropki z wynikiem nad każdym. Dane persystowane w `data/guilds/{guildId}/wyniki/{userId}.json` — każde pobicie rekordu to nowy wpis. **Wykres budowany z historii ze WSZYSTKICH serwerów** (`getUserHistoryAllGuilds`) — wyniki z różnych serwerów scalane chronologicznie. Ranking serwera X usuwa gracza gdy ma lepszy wynik na innym serwerze (tylko ranking.json — historia wyników zostaje).
   - **Wykres przyrostu unikalnych graczy** (tryb global): po kliknięciu `🌐 Global` — zamiast wykresu historii gracza generowany jest wykres kumulatywnego przyrostu unikalnych graczy w czasie (`generateGlobalPlayerGrowthChart`). Dane zbierane przez `scoreHistoryService.getAllUsersFirstEntries(allGuildIds)` — dla każdego userId szuka najwcześniejszego wpisu we wszystkich plikach `wyniki/*.json`, grupuje po dniu UTC, buduje serię kumulatywną. Wykres: tło Discord dark, kolor blurple (#5865F2), krzywa Catmull-Rom z gradientem, ostatni punkt (aktualny total) wyróżniony kółkiem + etykietą z liczą graczy. Tytuł: `msgs.globalPlayerGrowthChartTitle` (PL: `📊 Przyrost Unikalnych Graczy`, EN: `📊 Unique Player Growth`). Fallback: jeśli < 2 unikalnych graczy → brak wykresu. Błąd → tylko log warn, ranking wysyłany bez wykresu.
   - Ranking globalny wyróżniony kolorem niebieskim (0x5865f2), serwer złotym (0xffd700)
   - W rankingu globalnym każda linia zawiera nazwę serwera źródłowego
   - **Wyświetlany wynik = oryginalny string `score`** zapisany przy OCR (z fallbackiem na `formatScore(scoreValue)` dla starych wpisów). NIE odtwarzamy wyniku z `scoreValue` przez `formatScore()` w listach rankingowych — `formatScore` zaokrągla do 2 miejsc po przecinku, więc pobicie rekordu o małą wartość (np. wysokie wyniki typu `12345B` → `12.34T`) nie zmieniało wyświetlanej liczby mimo nowego rekordu (boss i data się zmieniały, sam wynik nie). Dotyczy `createRankingEmbed` (lista + statystyka "najwyższy wynik") oraz `globalTop10Service` (raport cykliczny + snippet w embeddzie rekordu). `scoreValue` nadal używany WYŁĄCZNIE do sortowania i porównań. Sumy klanów (`createGuildRankingEmbed` → `totalScore`) nadal przez `formatScore` — brak stringa źródłowego.
   - Przycisk Powrót (`ranking_back`) w wierszu paginacji jako 5. przycisk (na końcu)

6. **Rankingi Ról** - `roleRankingConfigService.js` + `interactionHandlers.js`:
   - Zarządzanie przez `/configure` krok 7 (admin) → przyciski: "Dodaj ranking roli" (RoleSelectMenu), "Usuń ranking roli" (StringSelectMenu), "Gotowe / Pomiń"
   - Max **10 ról** per serwer; konfiguracja persystowana w `data/guilds/{guildId}/role_rankings.json` (`[{ roleId, roleName, addedAt }]`)
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

7. **System Osiągnięć** — `achievementService.js` + `config/achievements.js`:
   - **53 stałe osiągnięcia** w 5 kategoriach + 1 dynamiczny status (`status_top1` — rewokowany gdy wynik usunięty)
   - **Kategorie:** 🏆 Wyniki (8) · 🔁 Rekordy (7) · 🎯 Bossowie (6) · 🕵️ Eksplorator/ukryte (26) · 💎 Prestiż (6)
   - **Rarities:** ⬜ Common · 🟩 Uncommon · 🟦 Rare · 🟪 Epic · 🟧 Legendary · 🔴 Mythic
   - **Odblokowanie:** osiągnięcia score/records/bosses/prestige blokowane przy każdym nowym rekordzie; ukryte (explorer) blokowane natychmiast przy przegladzie rankingu lub subskrypcji
   - **Kasowanie częściowe:** `clearUserAchievements(guildId, userId)` — usuwa WSZYSTKIE osiągnięcia kategorii `score` i `records` oraz resetuje `recordCount`/`lastRecordAt`/`lastRecordBeatAt`; pozostałe kategorie (bosses, explorer, prestige) zostają; wywoływane przy usunięciu gracza z rankingu (panel admina + komenda `/remove` — usunięcie całego gracza)
   - **Kasowanie po timestampie:** `clearAchievementsAfter(guildId, userId, fromTimestamp, { removedRecordCount, previousRecord })` — usuwa osiągnięcia `score`/`records` z `unlockedAt >= fromTimestamp` (zdobyte wcześniej zostają), dekrementuje `recordCount` o `removedRecordCount`, cofa `lastRecordAt`/`lastRecordBeatAt` do `previousRecord.timestamp`; wywoływane przy **cofaniu wyniku** (CV `_cvRemoveRecord`, panel Analizuj → Cofnij) — usuwa tylko osiągnięcia zdobyte cofniętym rekordem i rekordami pobitymi po nim
   - **Reset pełny:** `resetAllAchievements(guildId, userId)` — usuwa cały wpis gracza z pliku (wszystkie kategorie + cały progress); wywoływane ręcznie przez head admina z `/manage` → `🏆 Usuń osiągnięcia` → opcja "Usuń wszystkie"
   - **Usunięcie jednego:** `removeOneAchievement(guildId, userId, achId)` — usuwa tylko jedno odblokowane osiągnięcie; wywoływane przez head admina z `/manage` → `🏆 Usuń osiągnięcia` → wybór konkretnego osiągnięcia
   - **Odczyt odblokowanych:** `getUnlockedAchievements(guildId, userId)` — zwraca tablicę `[{ ...ach, unlockedAt }]` dla osiągnięć gracza; używane przez panel admina do zbudowania listy wyboru
   - **Powiadomienie:** w embeddzie rekordu pojawia się pole `🎉 Nowe osiągnięcia` TYLKO z osiągnięciami zdobytymi od poprzedniego pobicia rekordu (`lastRecordBeatAt`)
   - **Persistencja:** `data/guilds/{guildId}/achievements.json` — per-serwer; przeżywa restart
   - **Komenda /achievements:** ephemeral embed — każda kategoria na osobnej stronie + przycisk podsumowania + przycisk "Sprawdź gracza". Wiersz 1: 5 przycisków kategorii (`🏆 Wyniki`, `🔁 Rekordy`, `🎯 Łowy`, `💎 Prestiż`, `🕵️ Eksplorator`). Wiersz 2: `📊 Podsumowanie` + `🔍 Sprawdź gracza`. Tytuł embeda = etykieta kategorii. Odblokowane: `emoji **nazwa** *(rarity)* \n└ opis — data`. Zablokowane nieukryte: `🔒 ~~nazwa~~`. Zablokowane ukryte: `🔒 **???**`. Stopka: `X/Y odblokowanych` (ukryte: `X/? odblokowanych`). Domyślna strona po `/achievements`: kategoria `score`.
   - **Sprawdź gracza (`ach_check_player`):** otwiera modal z polem nicku → wyszukuje cross-server przez `getGlobalRanking()` → jeśli 1 trafienie: od razu pokazuje osiągnięcia; jeśli wiele: StringSelectMenu (`ach_check_sel`). Wyświetla osiągnięcia z serwera gdzie gracz ma **najlepszy wynik** (`sourceGuildId`). **Bez opisów jak zdobyć** — format: `emoji (rarity_emoji) **nazwa** *(rarity)* — data`. Przyciski nawigacji osadzają userId+guildId w customId (`ach_vc_{cat}_{userId}_{guildId}`, `ach_vo_{userId}_{guildId}`). Powrót do własnych osiągnięć przez `ach_vb`.
   - **Tracking:** `trackRankingView(guildId, userId)` — wołane w `handleRankingCommand`; `trackSubscription(guildId, userId)` — wołane w `_handleNotifConfirm`; `trackNonRecord(guildId, userId)` — wołane w `_runUpdateFlow` gdy `!isNewRecord && !dryRun`; `trackCvApproved(guildId, userId)` — wołane w CV approve handler; `trackAiAnalyzed(guildId, userId)` — wołane w `_handleAnalyzeButton` po zapisaniu wyniku
   - **Progress:** `progress.recordCount`, `progress.bossesEncountered[]`, `progress.rankingViews`, `progress.subscriptions`, `progress.lastRecordAt`, `progress.lastRecordBeatAt`, `progress.todayRecordDate` (YYYY-MM-DD UTC), `progress.todayRecordCount`, `progress.nonRecordCount`, `progress.cvApprovedCount`, `progress.aiRescuedCount`
   - **CustomIDs:** `ach_cat_{categoryKey}` (score/records/bosses/prestige/explorer) | `ach_overview` | `ach_check_player` | `ach_check_modal` | `ach_check_sel` | `ach_vc_{cat}_{userId}_{guildId}` | `ach_vo_{userId}_{guildId}` | `ach_vb`

8. **Ranking Osiągnięć** — przycisk `🏆 Ranking osiągnięć` w `/achievements`:
   - Komenda analogiczna do `/ranking` ale sortuje wg liczby zdobytych osiągnięć
   - Przy wejściu: przyciski wyboru serwera (wszystkie gildie bota) + `🌐 Global`
   - Per-serwer: `achievementService.getAchievementRanking(guildId, rankingService)` — gracze z `ranking.json` posortowani po liczbie osiągnięć (gracze bez osiągnięć = 0)
   - Globalny: `achievementService.getGlobalAchievementRanking(allGuildIds, rankingService)` — najlepszy wynik (max count) per gracz, wszystkie gildie
   - Ranking ról: `achievementService.getAchievementRankingByRole(guildId, roleId, guild, ...)` — jak per-serwer ale filtrowany przez `getMembersWithRole`
   - Embed: `buildAchRankingEmbed(players, page, perPage, mode, guildName, isPol)` — format linii: `🥇 Nick — **N**`; kolor globalny 0x5865f2, serwer 0xf1c40f
   - Przyciski: `createAchRankingButtons(...)` — prev/mypos/next/switch/back analogicznie do `/ranking`
   - State paginacji: `this._achRankings` Map (RAM) w `InteractionHandler`, kluczem messageId
   - `ach_rank_start` → od razu przechodzi do rankingu bieżącego serwera (nie ekranu wyboru); `ach_rank_back` → ekran wyboru serwera
   - W trybie global: przycisk "powrót do serwera" używa `ach_rank_srv_{parentGuildId}` (zapamiętany z poprzedniego widoku lub `interaction.guildId`); gdy brak parentGuildId → `ach_rank_no_srv` (disabled)
   - CustomIDs: `ach_rank_start` | `ach_rank_srv_{guildId}` | `ach_rank_global` | `ach_rank_role_{guildId}_{roleId}` | `ach_rank_prev` | `ach_rank_next` | `ach_rank_mypos` | `ach_rank_back` | `ach_rank_no_srv`

6. **Panel Admina** — dostępny przez `/manage`:
   - **Usuń gracza z rankingu (admin):** modal wyszukiwania nicku → przefiltrowana lista → potwierdzenie → usunięcie + aktualizacja ról TOP + wyczyszczenie wszystkich osiągnięć gracza (`achievementService.clearUserAchievements`). Head Admin może usunąć gracza z **dowolnego serwera** (cross-server).
   - **Odblokuj gracza (admin):** modal wyszukiwania nicku → przefiltrowana lista → odblokowanie. Persistencja: `data/user_blocks.json`. Jeśli blokada pochodzi od Head Admina (`blockedByHeadAdmin: true`) — zwykły Admin nie może odblokować.
   - **Zablokuj gracza (head admin):** modal wyszukiwania nicku cross-server → lista graczy → potwierdzenie → modal czasu blokady. Blokada zapisywana z flagą `blockedByHeadAdmin: true`.
   - **Zużycie tokenów (admin/head admin):** embed ze statystykami AI per serwer. Admin = swój serwer, Head Admin = wszystkie + breakdown
   - **AI OCR on/off (head admin):** modal wyszukiwania nazwy serwera → jeśli 1 wynik: bezpośrednio toggle, jeśli wiele: lista → toggle per komenda. Stan w `guild_configs.json` przez `OcrBlockService`
   - **Ustaw limity (head admin):** modal z 2 polami — cooldown (np. `5m`, `1h`) i limit dzienny (liczba). Persistencja: `data/usage_limits.json`, `data/update_cooldowns.json`
   - **Wyślij Info (head admin):** modal → podgląd PL+ENG → wyślij na wszystkie serwery. `_infoSessions` Map (RAM)
   - **Zbanuj serwer (head admin):** modal wyszukiwania nazwy → lista → potwierdzenie → bot wychodzi z serwera + ID zapisywane w `data/banned_guilds.json`. Odblokowanie przez listę zbanowanych. Check w `guildCreate` — bot natychmiast wychodzi, jeśli serwer jest na liście. `GuildBanService`.
   - **Konfiguracja bossów (head admin):** zarządzaj angielskimi nazwami bossów i ich aliasami w innych językach — patrz sekcja poniżej.

**Komendy slash:** `/achievements`, `/configure`, `/generate`, `/manage`, `/ranking`, `/subscribe`, `/test`, `/update`

**Panel Admina** — dostępny przez `/manage`:
- Dostęp: Administrator Discord
- **Układ rzędów (Tryb Admin):**
  - Rząd 1: `🗑️ Usuń gracza z rankingu`, `🔓 Odblokuj gracza`
  - Rząd 2: `📊 Zużycie tokenów`, `🔁 Przetwórz role`
  - Rząd 3: `◀️ Wróć do konfiguracji`
- **Układ rzędów (Tryb Head Admin):**
  - Rząd 1: `🔒 Zablokuj gracza`, `🔓 Odblokuj gracza`, `🗑️ Usuń gracza z rankingu`, `🏆 Usuń osiągnięcia`
  - Rząd 2: `🔄 AI OCR`, `⚙️ Ustaw limity`, `🧪 Testerzy`, `📅 Interwał TOP10`, `🔁 Przetwórz role`
  - Rząd 3: `📢 Wyślij Info`, `📊 Zużycie tokenów`, `⚠️ Nieskonfigurowane`
  - Rząd 4: `🚫 Zbanuj serwer`, `📈 Przyrost graczy`, `🎯 Konfiguracja bossów`
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
- **Dwujęzyczny:** wszystkie tytuły, pola, przyciski i stopki w embedach tokenów (`_buildTokensEmbed`, `_buildTokensMonthBreakdown`, `_buildTokensTotalBreakdown`, `_buildTokensUsersEmbed`) używają `t = this._panelT(interaction.guildId)` — nazwy miesięcy też mają obie wersje (`MONTH_NAMES_POL` / `MONTH_NAMES_ENG`)

**🔁 Przetwórz role** (Admin/Head Admin):
- Pełny reset ról TOP dla serwera, na którym wywołano komendę
- Etap 1: usuwa wszystkie role TOP od wszystkich memberów serwera (na podstawie `role.members` z cache)
- Etap 2: pobiera posortowany ranking serwera i przyznaje role zgodnie z progami konfiguracji
- Operacje w chunkach po 10 z przerwami 250ms — zapobiega rate limitom Discord
- Przydatne gdy role są niezsynchronizowane z rankingiem (np. po awarii, ręcznych zmianach, lub po usunięciu gracza bez aktualizacji)
- Jeśli serwer nie ma skonfigurowanych ról TOP → komunikat o braku konfiguracji z powrotem do panelu
- Używa `updateTopRoles` (diff-based) — zmienia tylko graczy, których rola jest niezgodna z rankingiem

**📢 Wyślij Info** (Head Admin):
- Otwiera modal z 4 polami: Tytuł, Opis PL, Opis ENG, Ikona URL, Obraz URL
- Podgląd embeda + przyciski Wyślij / Edytuj / Anuluj (przetłumaczone przez `tInfo = this._panelT`)
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

**🧪 Dodaj/usuń testera** (Head Admin):
- Wyświetla listę aktualnych testerów + przyciski `➕ Dodaj` i `➖ Usuń`
- **Dodaj:** modal z polem ID użytkownika Discord (17-20 cyfr) → zapis do `data/testers.json`
- **Usuń:** StringSelectMenu z listą testerów (max 25) → usunięcie z pliku
- Testerzy mogą używać `/test` bez ograniczeń (jak użytkownicy z `ENDERSECHO_BLOCK_OCR_USER_IDS`)
- Persistencja przeżywa restart bota

**CustomIDs Panelu Admina:**
| CustomId | Opis |
|---|---|
| `panel_back` | Wróć do panelu (z dowolnej operacji) |
| `panel_back_configure` | Wróć do wizarda /configure (pokazywany tylko gdy sesja wizarda aktywna) |
| `panel_remove` | Otwórz modal wyszukiwania gracza |
| `panel_remove_search_modal` | Modal wyszukiwania (pole `remove_query`) |
| `panel_remove_select` | StringSelectMenu — wybór gracza z wyników |
| `panel_remove_confirm_{userId}` | Potwierdzenie usunięcia |
| `panel_unblock` | Jeśli brak zablokowanych: info; inaczej modal wyszukiwania |
| `panel_unblock_search_modal` | Modal wyszukiwania (pole `unblock_query`) |
| `panel_unblock_select` | StringSelectMenu — wybór do odblokowania |
| `panel_tokens` | Pokaż statystyki tokenów |
| `panel_process_roles` | Pełny reset ról TOP: usuń wszystkie → przyznaj wg aktualnego rankingu (admin + head admin) |
| `panel_info` | Otwórz modal /info (head admin) |
| `panel_tester` | Pokaż listę testerów + przyciski Dodaj/Usuń (head admin) |
| `panel_tester_add` | Otwórz modal wpisania ID użytkownika |
| `panel_tester_add_modal` | Modal dodawania (pole `tester_user_id`) |
| `panel_tester_remove` | Pokaż StringSelectMenu z testerami |
| `panel_tester_remove_select` | StringSelectMenu — wybór testera do usunięcia |
| `panel_diagnostics` | Raport uprawnień bota: serwer, kanały raportów, hierarchia ról TOP, intenty — dostępny w `/configure` gdy wszystkie kroki ukończone (każdy admin) |
| `panel_player_growth` | Statystyki przyrostu unikalnych graczy globalnie + wykres (head admin, ephemeral) |
| `panel_ban_server` | Panel zbanowania serwera (head admin) |
| `panel_ban_guild` | Otwórz modal wyszukiwania serwera do bana |
| `panel_ban_guild_modal` | Modal wyszukiwania (pole `ban_guild_query`) |
| `panel_ban_guild_sel` | StringSelectMenu — wybór serwera z wyników |
| `panel_ban_guild_ok_{guildId}` | Potwierdź ban serwera |
| `panel_unban_guild` | Lista zbanowanych serwerów |
| `panel_unban_guild_sel` | StringSelectMenu — wybór serwera do odbanowania |
| `panel_ach_del` | Otwórz modal wyszukiwania gracza (head admin) |
| `panel_ach_del_modal` | Modal wyszukiwania (pole `ach_del_query`) |
| `panel_ach_del_ps` | StringSelectMenu — wybór gracza |
| `panel_ach_del_as` | StringSelectMenu — wybór osiągnięcia lub "Usuń wszystkie" |
| `panel_ach_ok_all:{userId}:{guildId}` | Potwierdzenie usunięcia wszystkich osiągnięć |
| `panel_ach_ok_1:{achId}:{userId}:{guildId}` | Potwierdzenie usunięcia jednego osiągnięcia |
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
| `panel_boss_cfg` | Otwórz panel konfiguracji bossów (head admin) |
| `boss_cfg_add_name` | Modal nowej angielskiej nazwy bossa |
| `boss_cfg_add_name_modal` | Modal (pole `boss_en_name`) |
| `boss_cfg_add_alias_start` | StringSelectMenu wyboru bossa do aliasu |
| `boss_cfg_add_alias_sel` | StringSelectMenu — wybrany boss, otwiera modal aliasu |
| `boss_cfg_add_alias_modal` | Modal aliasu (pole `alias_name`) |
| `boss_cfg_add_lang_sel` | StringSelectMenu języka → zapis aliasu |
| `boss_cfg_rm_start` | StringSelectMenu bossów z aliasami (usuwanie aliasu) |
| `boss_cfg_rm_boss_sel` | StringSelectMenu — wybrany boss, pokazuje listę aliasów (usuwanie) |
| `boss_cfg_rm_alias_sel` | StringSelectMenu — wybrany alias → usunięcie |
| `boss_cfg_rm_entry` | StringSelectMenu bossów do usunięcia (usuń bossa) |
| `boss_cfg_rm_entry_sel` | StringSelectMenu — wybrany boss → usunięcie wraz z aliasami |
| `boss_cfg_edit_entry` | StringSelectMenu bossów do edycji nazwy angielskiej |
| `boss_cfg_edit_entry_sel` | StringSelectMenu — wybrany boss, otwiera modal zmiany nazwy |
| `boss_cfg_edit_entry_modal` | Modal zmiany nazwy bossa (pole `boss_new_name`) |
| `boss_cfg_edit_alias` | StringSelectMenu bossów z aliasami (edycja aliasu) |
| `boss_cfg_edit_alias_boss_sel` | StringSelectMenu — wybrany boss, pokazuje listę aliasów (edycja) |
| `boss_cfg_edit_alias_sel` | StringSelectMenu — wybrany alias, otwiera modal edycji |
| `boss_cfg_edit_alias_modal` | Modal edycji aliasu (pole `alias_new_name`) |
| `boss_mapm_{sessionKey}` | Przycisk "Dopasuj do nazwy angielskiej" (w embedzie nieznanego bossa) |
| `boss_map_boss_modal` | Modal z odczytaną nazwą bossa (edytowalną) |
| `boss_map_boss_sel` | StringSelectMenu — wybór angielskiej nazwy bossa |
| `boss_map_lang_sel` | StringSelectMenu języka → zapis aliasu z flow mapowania |

**9. System aliasów bossów** — `services/bossAliasService.js` + `data/boss_aliases.json`:
- **Cel:** Normalizacja nazw bossów z różnych języków → jedna angielska nazwa (np. "Robak" PL → "Shardstone Bug" EN = jeden boss w osiągnięciach).
- **Pliki:** `services/bossAliasService.js`, `data/boss_aliases.json`, `config/bossNames.js` (`correctBossNameFull`)
- **Inicjalizacja:** plik `data/boss_aliases.json` jest jedynym źródłem prawdy — brak hardcodowanych nazw. Przy starcie bot wczytuje dane z pliku; jeśli nie istnieje → pusta lista.
- **Backward compat:** stare pliki JSON przechowujące nazwy jako klucze `aliases{}` (z dawnego `initFromBaseNames`) są rozpoznawane przez `getExtraEnglishNames()` zwracające sumę `englishNames[]` + `Object.keys(aliases{})`.
- **Obsługiwane języki:** pl, de, fr, es, pt, ru, it, tr, ja, zh, vi (select menu w UI)
- **Konfiguracja bossów (head admin):** `/manage` → 🎯 Konfiguracja bossów — dwa rzędy przycisków:
  - **Rząd 1 (boss):** ➕ Dodaj bossa · 🗑️ Usuń bossa · ✏️ Edytuj bossa
  - **Rząd 2 (alias):** ➕ Dodaj alias · 🗑️ Usuń alias · ✏️ Edytuj alias
  - Embed z listą wszystkich bossów (angielskie nazwy) + ich aliasami per język
  - **➕ Nowy boss (EN):** modal → dodaje custom boss poza KNOWN_BOSS_NAMES → `englishNames[]` w JSON
  - **🔤 Dodaj alias:** boss select → modal (alias) → language select → zapis do `aliases`
  - **🗑️ Usuń alias:** boss select → alias select → usunięcie
  - Sesje robocze: `_bossCfgSessions` Map (RAM, per userId)
- **Wykrywanie nieznanej nazwy:** `correctBossNameFull(raw, bossAliasService)` zwraca `{ corrected, wasUnknown }`. Gdy `wasUnknown=true` i wynik OCR jest prawidłowy: `_runUpdateFlow` wywołuje `_sendUnknownBossEmbed` (fire-and-forget).
- **Embed nieznanego bossa (czerwony):** wysyłany na `ENDERSECHO_BOSS_LOG_CHANNEL_ID` lub `ENDERSECHO_INVALID_REPORT_CHANNEL_ID`. Zawiera: nazwę bossa (OCR), gracza (link Discord), komendę, serwer, screenshot. Przycisk: 🔗 Dopasuj do nazwy angielskiej (`boss_mapm_{sessionKey}`).
- **Flow mapowania (po kliknięciu przycisku):**
  1. Modal z oryginalną nazwą (edytowalna) → `boss_map_boss_modal`
  2. Select angielskiej nazwy bossa → `boss_map_boss_sel`
  3. Select języka → `boss_map_lang_sel` → zapis aliasu + potwierdzenie
  - Sesje: `_unknownBossEmbeds` Map (sessionKey → rawBoss, TTL 48h) + `_bossMapSessions` Map (userId → dane robocze)
- **Normalizacja w OCR:** `aiOcrService.parseAIResponse` używa `correctBossNameFull(rawBoss, this.bossAliasService)`. Jeśli alias dopasowany → wraca angielska nazwa. Jeśli nie → wraca surowa nazwa + `wasUnknownBoss: true`.
- **Osiągnięcia:** `bossesEncountered` w achievementService przechowuje znormalizowaną (angielską) nazwę → "Robak PL" i "Shardstone Bug EN" to ten sam boss.
- **Persistencja:** `data/boss_aliases.json`: `{ englishNames: [], aliases: { "BossEN": { "pl": ["Alias PL"] } } }`. Przeżywa restart bota.
- **Env:** `ENDERSECHO_BOSS_LOG_CHANNEL_ID` (opcjonalne — fallback na `ENDERSECHO_INVALID_REPORT_CHANNEL_ID`)

**Komenda /configure** — wizard konfiguracji serwera (admin, dowolny kanał):
- 8-krokowy dashboard ephemeral z przyciskami szarymi→zielonymi po ukończeniu kroku
- **Krok 1:** Język (pol/eng) — wszystkie komunikaty i opisy komend
- **Krok 2:** Kanał bota (ChannelSelectMenu) — dla /update, /ranking, /subscribe
- **Krok 3:** Kanał raportów odrzuconych screenów (opcjonalny, ChannelSelectMenu)
- **Krok 4:** Tag serwera (1–4 znaki lub emoji, modal) — wyświetlany w globalnym rankingu
- **Krok 5:** Role TOP (opcjonalne) — do 20 w pełni konfigurowalnych progów per serwer:
  - Ekran progów: rząd 1-2: 10 przycisków zakresów (zielony=skonfigurowany, niebieski=następny aktywny, szary=nieaktywny); rząd 3-4: przyciski przypisania ról (Primary=rola przypisana, Secondary=brak roli); rząd 5: "Zaakceptuj zmiany", "Usuń konfigurację", "← Wstecz"
  - Kliknięcie przycisku zakresu → modal zakresu (np. `1-3` lub `4`); walidacja: ciągłość (brak luk), format, minimum = previous.to+1
  - Kliknięcie przycisku roli (`cfg_role_btn_N`) → ekran RoleSelectMenu dla tego progu; po wybraniu → powrót do ekranu progów; "Brak roli" czyści przypisanie; "← Wstecz" wraca bez zmian
  - Unieważnienie późniejszych progów po zmianie zakresu
  - "Zaakceptuj zmiany" widoczny gdy jest ≥1 skonfigurowany próg
  - "Usuń konfigurację progów" → czyści wszystkie zakresy i role, reset do pustego ekranu
  - Backward compat: istniejące `{ top1, top2, top3, top4to10, top11to30 }` automatycznie pre-fillowane do nowego UI przy wejściu
  - customIDs: `cfg_roles_start`, `cfg_tier_N` (N=0-9), `cfg_tier_modal_N` (modal), `cfg_role_btn_N`, `cfg_tier_reset`, `cfg_tier_accept`, `cfg_roles_sel_N`, `cfg_roles_skip_N`, `cfg_roles_back_N`, `cfg_roles_skip`
- **Krok 6:** Powiadomienia Global TOP10 (Tak/Nie) — per-guild flaga `globalTopNotifications` (backward compat: odczytuje też stare `globalTop3Notifications`)
- **Krok 7:** Ranking roli (opcjonalne) — przyciski "Dodaj ranking roli" (RoleSelectMenu), "Usuń ranking roli" (StringSelectMenu), "Gotowe / Pomiń"; stan `roleRankingsDone` w RAM; dla istniejącej konfiguracji pre-fill `true`
- **Krok 8:** Weryfikacja społeczności (opcjonalne) — Włącz/Wyłącz/Pomiń + kanał zgłoszeń (ChannelSelectMenu) + próg zgłoszeń (modal, 1–25, domyślnie 5); stan `communityVerifDone` w RAM; konfiguracja zapisywana w `guild_configs.json` jako `communityVerification: { enabled, rejectedChannelId, threshold }`
- **Krok 9:** Moderatorzy gry (opcjonalne) — lista moderatorów z pingami + przyciski "Dodaj" (modal z ID) / "Usuń" (StringSelectMenu) / "Pomiń" (tylko gdy krok jeszcze nieukończony); stan `moderatorsDone` w RAM; lista persystowana w `guild_configs.json` jako `moderators: [{ userId }]`; moderatorzy mają dostęp do `/manage` (bez head admin funkcji)
- Zielony przycisk **✅ Zaakceptuj konfigurację!** pojawia się gdy wszystkie kroki ukończone; obok niego pojawia się wtedy też przycisk **🔍 Diagnostyka** (`panel_diagnostics`) — dostępny dla każdego administratora, sprawdza uprawnienia bota (serwer + kanały + hierarchia ról TOP)
- Opis informuje o istnieniu `/manage` do zarządzania panelem admina
- Po zapisaniu: OCR domyślnie zablokowane (`['update', 'test']`), komendy re-rejestrowane dla nowego języka
- Przy każdym zapisaniu konfiguracji zapisywane jest `configuredBy: { userId, username, configuredAt }` — używane do DM alertów uprawnień
- Konfiguracja persystowana w `data/guild_configs.json` przez `GuildConfigService`
- Stan wizarda trzymany w RAM (`_configWizard` Map, per userId_guildId)

**8. Weryfikacja społeczności** — `communityVerificationService.js` + `data/community_votes.json`:
- **Włączanie:** opcjonalne per-serwer przez `/configure` krok 8 — flaga `communityVerification.enabled` w `guild_configs.json`
- **Przycisk Zgłoś:** Po opublikowaniu nowego rekordu bot edytuje wiadomość dodając przycisk `⚠️ Zgłoś` (`cv_vote_{messageId}`). Przycisk pojawia się wyłącznie gdy `communityVerification.enabled === true`
- **Kto może głosować:** tylko gracze obecni w rankingu serwera (`rankingService.loadRanking()` — sprawdzane przy każdym kliknięciu). Autor zgłoszenia jest wykluczony z głosowania na własny wynik. **Head Admin (`ENDERSECHO_BLOCK_OCR_USER_IDS`) omija check rankingu i może zgłosić własny wynik** (`registerVote(messageId, voterId, { allowSelf })`).
- **Tryb testowy CV (rekord head admina):** gdy właściciel rekordu (`session.userId`) jest head adminem, przycisk `⚠️ Zgłoś` może kliknąć **WYŁĄCZNIE on sam** (inni → `cvVoteHeadAdminOnly`), a próg zgłoszeń wynosi **1** — jedno kliknięcie head admina od razu uruchamia pełny przepływ zgłoszenia (`_triggerCvReport`: blokada 24h na head adminie + raporty na kanały rejected). Pozwala head adminowi przetestować CV end-to-end na własnym wyniku. `_handleCvVote` opakowany w try/catch (`_handleCvVoteInner`) — błąd nie zostawia interakcji bez odpowiedzi.
- **Licznik:** etykieta przycisku aktualizuje się po każdym głosie: `⚠️ Zgłoś (N)` (`setLabel(\`${msgs.cvVoteButton} (${count})\`)` w `_handleCvVote`)
- **Próg zgłoszeń:** konfigurowalne 1–25 (domyślnie 5; dla rekordu head admina zawsze 1). Po osiągnięciu progu: użytkownik blokowany na **24h** (`userBlockService.blockUser(..., '24h', false)`) + przycisk usuwany z oryginalnej wiadomości + raporty wysyłane na kanały rejected
- **Raporty:** wysyłane jednocześnie na **per-guild kanał** (`communityVerification.rejectedChannelId`) i **globalny kanał** (`ENDERSECHO_COMMUNITY_REPORT_CHANNEL_ID`). Jeśli oba kanały mają to samo ID — wysyłana jest tylko jedna wiadomość (brak duplikatu). Embed zawiera: nick, serwer, boss, nowy/poprzedni wynik, liczbę zgłoszeń, link do zgłoszonej wiadomości (w polu embeda, nie w przycisku). Footer: `cv:{messageId}|uid:{userId}|gid:{guildId}`
- **Przyciski admina w raporcie:**
  - `cv_admin_approve_{messageId}` → **Zatwierdź**: odblokuj użytkownika + zaktualizuj embedy raportów (usuń przyciski, dodaj info o akcji)
  - `cv_admin_remove_{messageId}` → **Usuń rekord i osiągnięcia** (`_cvRemoveRecord`): przywróć poprzedni rekord (lub usuń wpis przez `revertUserRecord()`) + usuń wpisy historii wyników (`wyniki/{userId}.json`) od momentu zgłoszonego rekordu w górę (zgłoszony rekord A + wszystkie pobite po nim B, C — `scoreHistoryService.removeEntriesAfter(session.newRecord.timestamp)`, zwraca liczbę usuniętych) + cofnij **tylko** osiągnięcia score/records odblokowane od momentu zgłoszonego rekordu (`achievementService.clearAchievementsAfter(timestamp, { removedRecordCount, previousRecord })` — osiągnięcia zdobyte WCZEŚNIEJ zostają, `recordCount` dekrementowany o liczbę usuniętych wpisów, `lastRecordAt/lastRecordBeatAt` cofnięte do poprzedniego rekordu) + odblokuj użytkownika
  - `cv_admin_block_{messageId}` → **Zablokuj permanentnie + usuń rekord**: permanentna blokada (`blockedByHeadAdmin: true`) + jak "Usuń rekord"
- **Wygasanie sesji:** przy nowym rekordzie gracza wszystkie jego pending sesje są zamykane (`status: 'expired'`) i przyciski usuwane ze starych wiadomości. Logika w `_runUpdateFlow` przed `createSession()`
- **Poprzedni rekord:** zapisywany w sesji jako snapshot przed `updateUserRanking()` — używany przez `revertUserRecord()` przy akcji admina
- **`newRecord.timestamp`:** sesja CV używa timestampu zwróconego przez `updateUserRanking()` (pole `newTimestamp`) — ten sam ISO co wpis rankingu i wpis historii wyników, dzięki czemu `removeEntriesAfter()` i `clearAchievementsAfter()` trafiają dokładnie w zgłoszony rekord. (Wcześniej `createSession` generował osobny `new Date().toISOString()`, który był późniejszy niż wpis historii → `removeEntriesAfter` z filtrem `< cutoff` nic nie usuwało.)
- **Nowe osiągnięcia:** lista ID z `processSubmission()` zapisywana w sesji (pole `newAchievements`) — informacyjnie; cofanie osiągnięć odbywa się po timestampie (`clearAchievementsAfter`), nie po liście ID, bo rekordy pobite PO zgłoszonym też mogły coś odblokować
- **Persistencja:** `data/community_votes.json` (per-bot, nie per-guild); struktura: `{ [messageId]: { guildId, userId, channelId, messageUrl, previousRecord, newRecord, newAchievements, voters[], count, status, rejectedMsgIds[], createdAt } }`
- **Status sesji:** `pending` → `triggered` → `approved|removed|blocked|expired`
- **`rejectedMsgIds`:** format `"guild:{channelId}:{msgId}"` lub `"global:{channelId}:{msgId}"` — używane przez `_updateAllCvReportMsgs()` do aktualizacji obu embedów raportów po decyzji admina
- **Wymagane uprawnienie do akcji admina:** `Administrator` lub Head Admin (`ENDERSECHO_BLOCK_OCR_USER_IDS`)
- **CustomIDs:** `cv_vote_{messageId}` | `cv_admin_approve_{messageId}` | `cv_admin_remove_{messageId}` | `cv_admin_block_{messageId}` | `cfg_cv_enable` | `cfg_cv_disable` | `cfg_cv_threshold` | `cfg_cv_channel_select`

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
- `getAllConfiguredGuilds()`: format kompatybilny z `config.guilds` (id, allowedChannelId, lang, tag, topRoles, globalTopNotifications)

**Uprawnienia komend:**
- `/configure`: Administrator Discord LUB Head Admin (`ENDERSECHO_BLOCK_OCR_USER_IDS`); gdy `ENDERSECHO_CONFIGURE_ADMIN_ONLY=true` → tylko Administrator; błąd: `configureNotAdmin`
- `/manage`: Administrator Discord LUB Head Admin LUB moderator gry (z `guild_configs.json → moderators[]`); błąd: `manageNotAdmin`
- Wymaga konfiguracji, dowolny kanał: `/test` (Administrator + `ENDERSECHO_BLOCK_OCR_USER_IDS`)
- Wymaga konfiguracji + bot channel: `/update`, `/ranking`, `/subscribe`
- Panel Admina (tryb Admin): Administrator Discord lub moderator gry → usuń gracza, odblokuj, tokeny
- Panel Admina (tryb Head Admin): `ENDERSECHO_BLOCK_OCR_USER_IDS` → wszystko + info, OCR toggle, limit

**Struktura danych:**
```
EndersEcho/data/
├── guilds/
│   └── {guildId}/
│       ├── ranking.json           # Ranking serwera (aktualny rekord per gracz)
│       ├── achievements.json      # Osiągnięcia graczy serwera
│       ├── role_rankings.json     # Konfiguracja rankingów ról
│       └── wyniki/
│           └── {userId}.json      # Historia rekordów gracza na tym serwerze
├── notifications.json             # Subskrypcje powiadomień DM
├── guild_configs.json             # Per-guild konfiguracja
├── update_cooldowns.json          # Cooldowny /update (userId → expiresAt timestamp ms)
├── user_blocks.json               # Blokady użytkowników
├── usage_limits.json              # Dzienny limit użytkownika
├── token_usage.json               # Koszty AI (Gemini)
├── testers.json                   # Lista testerów OCR
├── banned_guilds.json             # Zbanowane serwery
└── community_votes.json           # Sesje weryfikacji społeczności
```
Format wpisu historii gracza (`wyniki/{userId}.json`): tablica `[{ score, scoreValue, timestamp, bossName }, ...]`

**Migracja danych:** Przy pierwszym starcie `dataMigration.js` automatycznie przenosi stare pliki (`ranking_{id}.json`, `achievements_{id}.json`, `role_rankings_{id}.json`, `score_history_{id}.json`) do nowej struktury. Operacja jest idempotentna — bezpieczna przy wielokrotnym uruchomieniu.

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

# Osobny webhook dla embedów OCR analiz (opcjonalne)
# Gdy ustawiony, sendOcrAnalysisEmbed wysyła embedy na TEN webhook zamiast ENDERSECHO_LOG_WEBHOOK_URL
# Pozwala trzymać logi tekstowe i embedy OCR w osobnych kanałach
ENDERSECHO_OCR_EMBED_WEBHOOK_URL=webhook_url

# Kanał raportów odrzuconych screenów (opcjonalne)
# Wysyła embed gdy screen jest odrzucony (podrobione zdjęcie, brak Victory, brak Best/Total)
# Embed zawiera: nick na serwerze, Discord username, serwer, czas, powód, zdjęcie
ENDERSECHO_INVALID_REPORT_CHANNEL_ID=channel_id

# Globalny kanał zgłoszeń społeczności (opcjonalne)
# Wysyła embed gdy gracz osiągnie próg zgłoszeń weryfikacji społeczności (CV system)
# Jeśli ten sam ID co per-guild rejectedChannelId → wysyłany tylko jeden raport (bez duplikatu)
ENDERSECHO_COMMUNITY_REPORT_CHANNEL_ID=channel_id

# Użytkownicy uprawnieni do /ocr-on-off (ID rozdzielone przecinkami)
# Komenda włącza/wyłącza /update i/lub /test per-guild (parametry: action, target, guild z autocomplete)
# Stan per-guild persystowany w data/guild_configs.json (ocrBlocked[])
ENDERSECHO_BLOCK_OCR_USER_IDS=discord_user_id_1,discord_user_id_2

# Jeśli true, komenda /configure dostępna WYŁĄCZNIE dla administratora serwera (head admin traci dostęp)
# Domyślnie false (head admin z ENDERSECHO_BLOCK_OCR_USER_IDS ma dostęp do /configure)
ENDERSECHO_CONFIGURE_ADMIN_ONLY=false

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
| [handlers/interactionHandlers.js](handlers/interactionHandlers.js) | `botOps` wstrzykiwany przez konstruktor (przedostatni → ostatni arg to `globalTop10Service`); wspólne ciało `/update` i `/test` to `_runUpdateFlow(interaction, { dryRun, commandName, ocrBlockKey })` — `dryRun:true` wyłącza zapis do rankingu, role TOP, snippet globalny i DM |

### Specyfika bota

- **`/test` jako dry-run `/update`.** Oba handlery delegują do `_runUpdateFlow`; różnice wyłącznie w `dryRun` (ephemeral output, brak zapisu/ról/powiadomień), `commandName` (→ `hints.command`, logi, klucz blokady OCR) i uprawnieniach wejściowych (`/test` wymaga wpisu w `ENDERSECHO_BLOCK_OCR_USER_IDS`). Ten sam prompt wzorca (`compare-template`), ten sam `analyzeTestImage()`, ten sam Operations Gateway, ten sam `tokenUsageService` i `usageLimitService`. Padnięcie Gemini w obu komendach = błąd dla usera (brak fallbacku na Tesseract).
- **`usageLimitService`** — lokalny dzienny limit per user (`data/usage_limits.json`), działa równolegle do quota w API.
- **`PROMPT_VERSIONS`** w [services/aiOcrService.js](services/aiOcrService.js) — 2 wpisy: `extract-data-eng`, `compare-template`. Po zmianie treści promptu bump wersji (`'v1'` → `'v2'`) — stare trace zostają w Langfuse do porównania.
- **Model Gemini** dla wszystkich promptów ten sam: z `ENDERSECHO_GOOGLE_AI_MODEL` (default: `gemini-2.5-flash-preview-05-20`).

### A/B testing

Atrybuty na spanach generation: `llm.model.name`, `llm.prompt.name`, `llm.prompt.version`, `llm.step`, plus `user.id`, `guild.id`, `operation.type` na root spanie.

Przykłady zapytań:
- Porównanie modeli dla ekstrakcji: filter `llm.prompt.name="extract-data-eng"`, group by `llm.model.name`
- Porównanie wersji promptu porównania wzorca: filter `llm.prompt.name="compare-template"`, group by `llm.prompt.version`, metryka `% status='NOT_SIMILAR'`
- Historia konkretnego usera: filter `user.id=<discordId>` → failed generations → prompt + response

Rzetelne porównania: [Langfuse Datasets](https://langfuse.com/docs/datasets/get-started) — zestaw referencyjnych screenów puszczany przez różne warianty.

## Najlepsze Praktyki

- **Alerty uprawnień:** `_dmPermissionAlert(client, guildId, { channelId, missingPerms, context })` — wysyła DM do `configuredBy` + właściciela serwera gdy bot nie może zapisać do kanału (50001/50013). `_sendChannelErrorDm({ guildObj, ... })` — analogicznie dla /info. Oba fire-and-forget, nie przerywają głównego flow.
- **Logger (ogólny):** `createBotLogger('EndersEcho')` — tylko konsola + plik; jeśli ustawiony `ENDERSECHO_LOG_WEBHOOK_URL`, EndersEcho jest **pomijany** w głównym webhooku botów
- **Logger (per-serwer):** `logService._gl(guildId).info(msg)` lub przez metody `logService.logCommandUsage/logScoreUpdate/logOCRError/logRankingError(... , guildId)` — trafia do dedykowanego webhooka z avatarem serwera i separatorem
- **GuildLogger:** `services/guildLogger.js` — zarządza kolejką webhooka, avatarem (ICON) i separatorem przy zmianie serwera. Metoda `sendEmbed(embed)` wysyła embed przez webhook (powiadomienia o dołączeniu serwera, usunięciu, zmianie konfiguracji); zwraca `true` jeśli webhook skonfigurowany
- **Embedy administracyjne przez webhook:** `guildLogger.sendEmbed(embed)` lub `logService.sendEmbed(embed)` — używane dla powiadomień guildCreate/guildDelete (`index.js`) i konfiguracji `/configure` (`interactionHandlers`). Fallback na kanał `ENDERSECHO_INVALID_REPORT_CHANNEL_ID` gdy brak webhooka
- **Embedy OCR analiz (dodatkowe):** `logService.sendOcrAnalysisEmbed(guildId, options, guildObj)` — wysyła embed po każdej analizie OCR (/update, /test, panel Analizuj). Nie zastępuje logowania tekstowego. Typy i kolory: 🏆 `new_record` zielony, ⚠️ `role_error` żółty (rekord OK, błąd ról), 🚫 `rejected` czerwony, 📊 `no_record` niebieski, 🧪 `test_record`/`test_no_record` cyan/blurple, 🔬 `analyze_panel` pomarańczowy, 🔄 `cross_server` szary. Thumbnail = ikona serwera Discord (lub ICON z env). Embed zawiera: gracza, komendę, admina (panel), wynik, boss, poprzedni rekord, powód odrzucenia, szczegóły AI, błąd ról. W `_runUpdateFlow` — parametry zbierane w `_ocrEmbedParams`, embed wysyłany w bloku `finally`. W `_handleAnalyzeConfirmed` — wysyłany bezpośrednio po role update.
- **Nick w logach:** Zawsze używaj `interaction.member?.displayName || interaction.user.displayName || interaction.user.username` — nigdy samego `interaction.user.username`
- **Logi /update (8 linii happy path):** start → `[AI Test] Test wzorca: "OK"` → AI OCR wynik+boss+total → logScoreUpdate → ogłoszenie → Role TOP → Snippet globalny (jeśli zmiana pozycji globalnej)
- **Logi /update (odrzucenie, 3 linie):** start → `[AI Test] Test wzorca: "NOK: reason"` → `❌ Odrzucono: NOT_SIMILAR/FAKE_PHOTO/...`
- **OCR Debug:** Brak komendy — logi pośrednie AI OCR (Total, Boss/score z parseAIResponse) są usunięte; szczegóły widoczne tylko w logach błędów
- **Ranking per-serwer:** `rankingService.loadRanking(guildId)` / `saveRanking(guildId, ranking)`
- **Ranking globalny:** `rankingService.getGlobalRanking()` (merge wszystkich serwerów, best per player)
- **Role opcjonalne:** Zawsze przekazuj `guildConfig?.topRoles || null` do `roleService.updateTopRoles()`
- **Migracja:** Automatyczna przy starcie — stary `ranking.json` → `ranking_{guild1Id}.json`

---

## Zasady Tworzenia Logów i Embedów

### ❌ NIGDY nie używaj surowych ID w logach ani embedach

```javascript
// ŹLE
logger.info(`Serwer ${guild.id}`);
logger.info(`Użytkownik ${userId}`);
logger.info(`Rola ${roleId}`);
logger.info(`Kanał ${channelId}`);
embed.addFields({ name: 'Serwer', value: `${guild.name} (\`${guild.id}\`)` });
```

### ✅ Zawsze używaj nazw

```javascript
// DOBRZE — logger (tekst konsola/webhook)
logger.info(`Serwer "${guild.name}"`);
logger.info(`Użytkownik "${member?.displayName || user.username}"`);
logger.info(`Rola "${guild.roles.cache.get(roleId)?.name || roleId}"`);
logger.info(`Kanał "${channel?.name || client.channels.cache.get(channelId)?.name || channelId}"`);

// DOBRZE — embed (Discord renderuje wzmianki jako nazwy)
embed.addFields({ name: 'Serwer', value: guild.name });
embed.addFields({ name: 'Kanał', value: `<#${channelId}>` });       // renderuje jako #kanał
embed.addFields({ name: 'Rola', value: `<@&${roleId}>` });          // renderuje jako @Rola
embed.addFields({ name: 'Użytkownik', value: `<@${userId}>` });     // renderuje jako @Nick
```

### Wzorce lookup dla samego ID (gdy brak obiektu)

```javascript
// Nazwa serwera — z guildConfigService (przechowuje guildName)
const guildName = this.guildConfigService.getConfig(guildId)?.guildName || guildId;

// Nazwa serwera — z cache Discord (gdy jest klient)
const guildName = client.guilds.cache.get(guildId)?.name || guildId;

// Nazwa kanału — z cache Discord
const channelName = client.channels.cache.get(channelId)?.name || channelId;

// Nick użytkownika — z obiektu GuildMember
const nick = member?.displayName || member?.user?.username || userId;

// Nick użytkownika — z interaction
const nick = interaction.member?.displayName || interaction.user.username;

// Nazwa roli — z cache gildii
const roleName = guild.roles.cache.get(roleId)?.name || roleId;

// Tag serwera — z config.getAllGuilds() (gdy nie ma klienta Discord)
const label = this.config.getAllGuilds().find(g => g.id === guildId)?.tag || guildId;
```

### Embedy administracyjne (cfg_accept, guildCreate, guildDelete)

- **Pierwsza konfiguracja** → pełny embed ze wszystkimi ustawieniami (kolor `0x5865F2`)
- **Rekonfiguracja** → embed tylko ze zmienionymi polami format `stara wartość → nowa wartość` (kolor `0xFEE75C`)
- Jeśli nic się nie zmieniło → pomijamy wysyłanie embeda
- Wysyłaj przez `logService.sendEmbed(embed)` lub `guildLogger.sendEmbed(embed)` — nie przez kanał Discord
- Fallback na `ENDERSECHO_INVALID_REPORT_CHANNEL_ID` gdy brak webhooka
