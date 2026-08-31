### 🏆 EndersEcho Bot

> ### ⚠️ SILNIK OCR NA PRODUKCJI: WYŁĄCZNIE AI — NIE TESSERACT
>
> **Na serwerze produkcyjnym cały OCR obsługuje AI (`Google Gemini`). Tesseract NIE jest używany.**
>
> Skąd bierze się pomyłka: kod Tesseract nadal istnieje w `services/ocrService.js` (jest tam
> `require('tesseract.js')`) jako ścieżka zapasowa, a przełącznik `USE_ENDERSECHO_AI_OCR` domyślnie jest
> **wyłączony** (`process.env.USE_ENDERSECHO_AI_OCR === 'true'`). Lokalny `.env` go nie ustawia, więc lokalnie
> kod schodzi na Tesseract — na produkcji zmienna jest ustawiona na `true` i ta gałąź nigdy
> nie jest wykonywana.
>
> **Konsekwencje przy diagnozie i optymalizacji:**
> - Nie licz plików `pol.traineddata` / `eng.traineddata` (~5 MB każdy) jako obciążenia — nikt ich nie ładuje
> - Nie analizuj wydajności workerów Tesseract ani preprocessingu pod jego kątem
> - Ścieżka realna to: pobranie screena → `sharp` → base64 → zapytanie do AI
> - Zmieniając cokolwiek w OCR, patrz na `services/aiOcrService.js`, nie na `ocrService.js`


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

**Profile gracza (kilka kont w grze)** — `profileRegistryService.js` + `utils/helpers.js`:
- **Tożsamość wpisu = `playerKey`**, nie `userId`:
  - profil główny: `"123456789"` — **identyczny z dawnym userId**, więc istniejące dane działają bez migracji
  - profil dodatkowy: `"123456789#2"`, `"123456789#3"`
- **Separator `#`** wybrany świadomie: customId komponentów Discorda parsowane są przez `split('_')` i `split(':')`, więc te znaki nie mogą wystąpić w kluczu; `#` jest też bezpieczny w nazwach plików (`wyniki/{playerKey}.json`)
- **Helpery** (`utils/helpers.js`): `makePlayerKey(userId, idx)`, `getOwnerId(playerKey)`, `getProfileIndex(playerKey)`, `isAltProfile`, `formatProfileDisplayName(nick, idx)`, `getProfileMarker(idx)`, `getProfileButtonEmoji(idx)`
- **Dwa zestawy znaczników profilu (NIE mieszać!):**
  - `getProfileMarker(idx)` → **tekst** w embedach i nazwach rankingowych: `②`, `③` (slot 1 → `null`, czyli nick Discord bez zmian — zgodność wstecz)
  - `getProfileButtonEmoji(idx)` → **emoji komponentu** (przycisk, opcja select menu): `1️⃣`, `2️⃣`, `3️⃣` — oznacza SLOT, nie maina (mainem może być dowolny slot, oznacza go pinezka 📌 w etykiecie). Znaki `②`/`③` to zwykły Unicode, a NIE emoji — Discord odrzuca je w polu `emoji` błędem `COMPONENT_INVALID_EMOJI` (Invalid Form Body). Helper zwraca `null` poza zakresem (przy podniesionym `ENDERSECHO_MAX_PROFILES`), a wywołania ustawiają emoji tylko gdy niepuste
- **Rejestr profili** — `data/profiles.json`: `{ [userId]: { active, profiles: [{ index, label, createdAt, pendingDeleteAt? }] } }`
  - Gracz **bez wpisu w pliku** ma niejawnie jeden profil w slocie 1 — działa dokładnie jak przed wdrożeniem profili. Gdy wpis istnieje, lista `profiles` jest **jedynym źródłem prawdy** (slot 1 może w niej nie występować, jeśli został usunięty)
  - **Numery slotów są przesuwane po usunięciu** — skasowanie profilu 1 sprawia, że 2 staje się 1, a 3 staje się 2 (bez dziur w numeracji). Numer slotu jest częścią `playerKey`, więc `removeProfile` zwraca listę przesunięć `renumbered[{ fromIndex, toIndex, fromKey, toKey }]` (rosnąco — kolejny klucz docelowy jest zawsze wolny), a `_migratePlayerKey` przenosi po niej WSZYSTKIE dane profilu
  - **Migracja danych przy przesunięciu** (`_migratePlayerKey(fromKey, toKey, guildIds, gl)`) obejmuje: `ranking.json`, `boss_records.json`, `achievements.json`, `wyniki/{playerKey}.json` (rename pliku, scalanie chronologiczne gdy cel istnieje), subskrypcje (`renameTargetPlayerKey`), sesje cofnięcia (`recordRevertService.renamePlayerKey` — sesje + mapa `latest`) sesje CV (`communityVerificationService.renamePlayerKey`) i wyzwania (`challengeService.renamePlayerKey`). **Dodając nowy magazyn kluczowany `playerKey` trzeba dopisać go do tej listy** — inaczej dane osierocą się przy pierwszym usunięciu profilu
  - `active` = numer profilu **MAIN** (pinezka 📌). Gdy zapisany main już nie istnieje → fallback na pierwszy istniejący slot (`getMainIndex`)
  - Limit: `ENDERSECHO_MAX_PROFILES` (domyślnie 3, `config.profiles.maxPerUser`)
  - Etykiety (nick w grze) sanityzowane: usuwane markdown/wzmianki/`#`, max 24 znaki, unikalne w obrębie gracza
  - **Persystencja:** plik JSON wczytywany przy starcie (`profileRegistryService.load()` w `index.js`) — przeżywa restart
- **Standaryzacja nazw w rankingach:** profil główny = nick Discord bez zmian; profile dodatkowe = nick + znacznik cyfry w kółku (`Thashar ②`, `Thashar ③`). Baza nazwy zawsze pochodzi z Discorda, więc od razu widać, że wyniki należą do tej samej osoby, a gracz nie może wpisać cudzego nicku. Etykieta profilu (nick w grze) pokazywana jest w `/profiles`, `/profile` i embedzie rekordu
- **Panel zarządzania profilami — WEWNĄTRZ `/profile`** (osobnej komendy `/profiles` NIE MA, została usunięta): przycisk `👥 Moje profile` (`profile_manage_prof`) otwiera panel jako **nowy ephemeral** (`handleProfilesPanel`, wzorzec z `profile_manage_subs`) — lista profili z wynikami i pozycjami globalnymi, `➕ Dodaj profil` (modal nazwy), `📌 Ustaw jako main`, `✏️ Zmień nazwę`, `🗑️ Usuń profil` (planuje usunięcie za 7 dni) i `↩️ Odwołaj usuwanie` (przycisk pojawia się TYLKO gdy jakiś profil czeka na skasowanie)
  - Panel jako **osobna wiadomość**, nie edycja widoku profilu — modale nazwy i potwierdzenia nie kolidują ze stanem sesji `_profileStates`
  - Przycisk `👥 Moje profile` pokazuje się **na własnym profilu od DRUGIEGO profilu** i **nigdy na cudzym**
  - **Gracz z jednym profilem widzi zamiast panelu `➕ Dodaj profil`** (`profile_add_intro`, Success) — jedyne wejście do drugiego konta. Panel (zmiana nazwy, usuwanie, main) dochodzi od drugiego profilu, bo przy jednym nie ma czym zarządzać
- **Bramka edukacyjna przed PIERWSZYM dodatkowym profilem** (`handleProfileAddIntro`):
  - `➕ Dodaj profil` → ephemeral embed `profileIntroTitle` + `profileIntroBody` (czym jest profil, nick w grze, znacznik `②` w rankingu, pytanie przy `/update`, sekcja **konto main 📌** wraz z zakazem usuwania maina, sekcja **usuwanie trwa 7 dni** z możliwością odwołania, **wspólny limit/cooldown**, jedna rola TOP wg najlepszego profilu, limit `{max}`) + przyciski `prof_intro_ok` (Success) i `prof_intro_cancel` (Secondary)
  - Dopiero `prof_intro_ok` otwiera okno nazwy w trybie **`addfirst`** (`prof_modal_addfirst_0`); `prof_intro_cancel` zamyka bramkę komunikatem `profileIntroCancelled`
  - **Dlaczego nie okno modalne Discorda:** modal przyjmuje wyłącznie pola tekstowe i listy w `Label` — nie ma w nim miejsca na sformatowane wyjaśnienie ani przycisk „przeczytałem"
  - Tryb `addfirst` po dodaniu robi `interaction.update()` (wyjaśnienie zamienia się w potwierdzenie), więc **nie da się kliknąć potwierdzenia dwa razy** i dodać profilu, o który nikt nie prosił. Tryb `add` z panelu działa jak dotąd (osobny ephemeral, panel zostaje)
  - Limit sprawdzany **dwa razy**: przy otwieraniu bramki i przy potwierdzeniu (gracz mógł w międzyczasie dodać profil w innym oknie)
  - Panel nie odświeża wiadomości `/profile`, dlatego `profileCmdAdded` przypomina o ponownym użyciu `/profile`, żeby zobaczyć rząd przełączania
- **Profil MAIN** (`active` w `profiles.json`, `getMainIndex` / `getMainPlayerKey`) — konto główne gracza, wskazywane **pinezką 📌**:
  - Ustawiany przyciskiem `📌 Ustaw jako main` w `/profile` (rząd profili, `profile_track`) oraz z panelu `👥 Moje profile` (`prof_switch`). Przycisk **pojawia się dopiero gdy gracz ma więcej niż jeden profil**, a na aktualnym mainie jest wyłączony (zielony `📌 Main`)
  - **Co za nim idzie:** `/ranking` — pole `👤 Twoje statystyki`, przycisk `Moja pozycja` (serwer, globalny, rankingi ról), wykres historii rekordów; zakładka `🏆 Osiągnięcia` w `/profile`; domyślnie otwierany profil w `/profile`; podpowiedź przy `/update`; rankingi osiągnięć i bossów (`Moja pozycja`)
  - **Maina NIE MOŻNA usunąć** — `scheduleDeletion`/`removeProfile` zwracają `IS_MAIN`, a lista wyboru w `🗑️ Usuń profil` w ogóle go nie pokazuje. Żeby skasować akurat to konto, trzeba najpierw wskazać mainem inny profil. Dzięki temu gracz zawsze ma dokładnie jeden profil odporny na usunięcie, a **slot 1 nie jest już uprzywilejowany** — przy mainie na slocie 2 slot 1 można usunąć (po skasowaniu numery zjeżdżają w dół, więc main 2 staje się 1)
  - **`setMain` odwołuje zaplanowane usunięcie** wskazanego profilu — main nie może czekać na skasowanie
  - **Helper `_findCallerIndex(players, userId)`** (`interactionHandlers.js`) — jedno miejsce liczące pozycję gracza: szuka **wyłącznie** `playerKey` maina (`_mainPlayerKey`). Gdy main nie ma wyniku → `-1`, czyli brak pozycji i brak przycisku `Moja pozycja`. **Świadomie NIE ma fallbacku** na najlepszy/inny profil gracza — pokazywanie cudzego (innego) profilu jako „swojego" myliło graczy (wynik w `👤 Twoje statystyki` nie zgadzał się z podkreślonym wierszem ani z wykresem)
  - **Brak wyniku na mainie** (gdy gracz ma kilka profili) → pole `👤 Twoje statystyki` pokazuje `rankingMainNoScore` („Twój profil **main** (**1️⃣ Profil 1**) nie ma jeszcze wyniku" + podpowiedź `/profile` → 📌) zamiast ogólnego `rankingNotInRanking`. Notkę buduje `_mainProfileNoScoreNote(userId, msgs)`; przy jednym profilu zwraca `null`
  - **Nie miesza się z pojęciem „najlepszy profil"** — *najlepszy profil* jest wyliczany automatycznie (progi ról TOP, eksport do `shared_data`). Main zmienia WYŁĄCZNIE to, co gracz widzi i gdzie domyślnie zapisuje wynik — nie wpływa na role ani eksport
  - **Podświetlenie wiersza w rankingu idzie za mainem** — podkreślany (`**__nick__**`) jest WYŁĄCZNIE wiersz `playerKey` maina; pozostałe profile tej samej osoby są zwykłymi wpisami. Dotyczy `createRankingEmbed` (opcja `callerPlayerKey`), `createBossRankingEmbed` i `buildAchRankingEmbed` (parametr `callerUserId`/`callerId` przyjmuje **playerKey**, nie ID właściciela)
- **Usuwanie profilu = 7 dni karencji** (`scheduleDeletion` → sweep → `_purgeProfileData`):
  - `🗑️ Usuń profil` → wybór profilu → **potwierdzenie z aktualnym rekordem tego konta** (`profileCmdDeleteRecord`: wynik, boss i data z rankingu globalnego, `_profileRecordSummary`) i informacją o 7-dniowym terminie → `prof_delete_confirm_{idx}` **tylko planuje** usunięcie (`pendingDeleteAt` w `profiles.json`)
  - Przez te 7 dni **nic nie znika** — profil działa normalnie (wynik w rankingu, `/update`, wykresy). Panel i `/profile` pokazują przy nim `⏳` z terminem (`<t:…:R>`)
  - **Odwołanie:** `↩️ Odwołaj usuwanie` (`prof_delete_cancel` → `prof_delete_cancel_do_{idx}`) albo ustawienie tego profilu mainem
  - **Sweep** (`profileRegistryService.start(onDue)`, uruchamiany w `index.js` przez `interactionHandler.startProfileDeletionSweep(client)`): przy starcie bota i **co godzinę**; dla profili po terminie woła `_purgeProfileData`, które kasuje wpis rankingowy, rekordy bossów, historię, osiągnięcia i subskrypcje na WSZYSTKICH serwerach, aktualizuje role TOP, unieważnia przyciski cofnięcia (`by: 'profile_deleted'` → `🗑️ Profil usunięty`), usuwa profil z rejestru i **przenosi dane pozostałych profili na nowe numery** (`_migratePlayerKey`)
  - Sweep **ponawia próbę** przy następnym przebiegu, gdy kasowanie padnie (wpis zostaje w pliku). Jeśli w międzyczasie profil stał się mainem, `_purgeProfileData` przerywa (`isMain`)
  - **CustomIDs:** `prof_add` | `prof_switch` | `prof_switch_do_{idx}` | `prof_rename` | `prof_rename_do_{idx}` | `prof_delete` | `prof_delete_do_{idx}` | `prof_delete_confirm_{idx}` | `prof_delete_cancel` | `prof_delete_cancel_do_{idx}` | `prof_intro_ok` | `prof_intro_cancel` | `prof_modal_{add|addfirst|rename}_{idx}`
- **Wybór profilu przy `/update` i `/test`** — `_runUpdateFlow` → `_handleUpdateProfileModal` → `_runUpdateAnalysis`:
  - Gracz z **jednym** profilem: flow bez zmian (żadnego dodatkowego kroku)
  - Gracz z **kilkoma** profilami: **modal (okno pop-up) z select menu** — `1️⃣ Profil 1`, `2️⃣ Profil 2`, … (kolejność = numery slotów, main wstępnie zaznaczony przez `setDefault` i oznaczony pinezką 📌 w etykiecie, nick w grze jako opis opcji). Modal buduje `_buildProfileModal()`, customId `upd_prof_modal_{interactionId}`, sesja w `_updateProfileSessions` (TTL 10 min)
  - **Przyciski w modalu są niemożliwe** — Discord dopuszcza w modalach wyłącznie pola tekstowe i select menu owinięte w komponent `Label` (`LabelBuilder`, type 18). Stąd lista rozwijana zamiast przycisków
  - **`showModal()` musi być PIERWSZĄ odpowiedzią na interakcję** — wszystkie walidacje w `_runUpdateFlow` (blokada gracza, AI OCR, typ/rozmiar pliku, blokady OCR, cooldown) kończą się `return` i w happy path nie odpowiadają na interakcję. Zmieniając cokolwiek w tym miejscu trzeba to utrzymać (i zmieścić się w 3 s od wywołania komendy)
  - **Dalszy flow korzysta z interakcji MODALA, nie komendy** — po odpowiedzi typu „modal" pierwotna interakcja nie ma wiadomości, którą dałoby się edytować. `_runUpdateAnalysis` dostaje `ModalSubmitInteraction` i przez nią leci `deferReply`/`editReply` (postęp analizy) oraz `followUp` (publiczne ogłoszenie)
  - **Załącznik przekazywany parametrem** (`opts.attachment`) — `ModalSubmitInteraction` nie ma opcji komendy, więc screen zapamiętywany jest w sesji przy otwieraniu modala
  - Wybór odczytywany przez `interaction.fields.getStringSelectValues('upd_prof_sel')`
  - **Limit dzienny i cooldown naliczane są dopiero po wyborze** — porzucony modal nie kosztuje gracza próby
  - **`deferReply` jest PIERWSZĄ operacją `_runUpdateAnalysis`** — wcześniej sprawdzenie dziennego limitu (`usageLimitService.checkAndRecord()` = odczyt + zapis `usage_limits.json`) szło przed potwierdzeniem interakcji i przy obciążonym serwerze wypychało `deferReply` poza 3-sekundowy limit Discorda → `DiscordAPIError[10062] Unknown interaction` i brak jakiejkolwiek odpowiedzi dla gracza. Teraz interakcja jest potwierdzana od razu, a komunikat o przekroczonym limicie idzie przez `editReply`. Kod 10062 przy samym `deferReply` kończy się krótkim ostrzeżeniem w logu (analiza pomijana), a globalny handler w `index.js` nie wypisuje dla niego stack trace'a. Wszystkie walidacje w `_runUpdateFlow` (przed modalem) muszą pozostać operacjami w pamięci — bez odczytów z dysku
- **Zakres per OSOBA (bez zmian, klucz `userId`):** blokady (`user_blocks.json`), dzienny limit `/update` (`usage_limits.json`), cooldown (`update_cooldowns.json`), koszty tokenów, statystyki odrzuceń, osiągnięcia „Eksplorator" (rankingViews, profileSearches, subscriptions). Profile **nie mnożą** limitu ani nie pozwalają obejść cooldownu
- **Zakres per PROFIL (klucz `playerKey`):** `ranking.json`, `boss_records.json`, `achievements.json`, `wyniki/{playerKey}.json`, subskrypcje (`targetPlayerKey`), sesje CV, cofnięcia wyniku i wyzwania (`challenges.json`)
- **Progi ról TOP liczone na liście zdeduplikowanej** (`getSortedPlayersByUser`) — jeden member Discorda ma jedną rolę, a profile dodatkowe nie mogą zajmować progów i odbierać ról innym graczom. Ranking pokazuje wszystkie profile, ale role przydzielane są wg pozycji OSOBY. Nagłówek embeda rekordu (author = rola TOP) używa pozycji osoby, nie profilu
- **Liczniki graczy pokazują OSOBY — bez wyjątków.** Profil dodatkowy to ten sam człowiek, więc **żaden** widoczny licznik nie może liczyć wpisów rankingu. Miejsca i sposób dedupu:
  - `rankingService.getCountedPlayers()` — dedup po `userId` (`{ total, playerIds, profileCount }`); używane przez kamienie milowe, stopkę logu OCR i CC
  - `rankingService.countPeople(players)` — **helper dla każdego licznika liczonego z listy wpisów**; użyty w `createRankingEmbed` (pole `👥 Liczba graczy`, ranking serwera/globalny/ról), `createBossRankingEmbed` i `getGuildScores().playerCount` (ranking serwerów; liczba profili została jako osobne `profileCount`)
  - Gdy profili jest więcej niż osób, embed dokleja `rankingProfilesSuffix` → `👥 Liczba graczy: 12  *(14 profili)*`, żeby liczba nie kłóciła się z liczbą wierszy listy
  - Stopka embeda analizy OCR dla admina (`logService.sendOcrAnalysisEmbed` → `👥 N unikalnych graczy globalnie`) — `globalPlayerCount` liczony przez `countPeople(newGlobalRanking)` (ścieżka `/update`) albo `getCountedPlayers().total` (`/test`, żeby symulowany wpis nie dawał N+1)
  - `achievementService.buildAchRankingEmbed` — stopka `N graczy` po dedupie; `adminPanelService` — lista serwerów w CC dedupuje klucze `ranking.json` przez `getOwnerId`
  - Statystyki historii (`getActivePlayersStats`, `getAllUsersFirstEntries`, `getGuildPlayerCounts`) agregują po właścicielu (`getOwnerId(nazwaPliku)`); Centrum Dowodzenia pokazuje `N (M profili)` gdy profile istnieją
  - **Dodając nowy licznik graczy** przepuść listę przez `countPeople()` / `getOwnerId` — inaczej gracz z drugim kontem podbija statystyki
- **Ręczna analiza admina:** raport odrzuconego screena niesie profil w stopce (`pk:{playerKey}`, tylko dla profili dodatkowych); `_handleAnalyzeConfirmed` czyta go i zapisuje wynik na właściwym profilu (stare raporty bez `pk:` → profil główny)
- **Eksport `shared_data/endersecho_ranking.json`:** `players[]` zawiera **jeden wpis na osobę** (najlepszy profil) — Stalker czyta `find(p => p.userId === …)` i `players.length`, więc widzi osoby i nie zawyża liczby graczy; pełna lista profili w nowym polu `profiles[]` (z `playerKey`, `profileIndex`)

**Cofanie rekordu (przycisk gracza + przycisk admina)** — `recordRevertService.js`:
- **Pod KAŻDYM ogłoszeniem rekordu** (`/update` — nowy rekord, sam rekord bossa, rekord bossa cross-server, oraz ogłoszenie z panelu „Analizuj") pojawia się `↩️ Cofnij wynik` obok `⚠️ Zgłoś` (ten drugi tylko gdy CV włączone). `/test` (dryRun) nie tworzy sesji ani przycisków
- **Kliknąć może właściciel wyniku ALBO administrator serwera** — właściciel po `getOwnerId(playerKey)` (dowolny profil gracza cofa własny wynik), admin przez `_canAdminUndoRecord()`: uprawnienie `Administrator` **na serwerze, którego dotyczy rekord** (`interaction.guildId === session.guildId`) albo head admin (ten może zawsze). Admin z innego serwera i zwykły gracz dostają `recordUndoNotOwner`. Uprawnienia sprawdzane **dwa razy** — przy kliknięciu przycisku i ponownie przy potwierdzeniu (customId nie jest źródłem prawdy)
- **Właściciel vs admin — różnice w UI:** admin widzi inny tekst potwierdzenia (`recordUndoAdminConfirmTitle` — „cofnąć ten rekord gracza?") i inne podsumowanie (`recordUndoAdminDone`). Po cofnięciu przez admina ogłoszenie dostaje notkę `recordUndoAdminNote` („Administrator **{adminName}** cofnął ten rekord wraz z osiągnięciami…") i **nieaktywny czerwony przycisk `↩️ Cofnął admin`** (`rec_undone_admin`), zamiast `↩️ Cofnął właściciel`. Status sesji to wtedy `admin`, a akcja trafia do dziennika Centrum Dowodzenia (`_ccAudit`)
- **Tylko OSTATNI rekord jest cofalny.** Rejestracja nowego ogłoszenia ustawia poprzedniemu status `superseded` i **dezaktywuje jego przycisk** (`_disablePreviousUndoButton` — wyłącza sam przycisk cofnięcia, zostawiając „Zgłoś"). Kliknięcie starego przycisku → `recordUndoNotLatest`
- **Potwierdzenie przed cofnięciem:** ephemeral z listą konsekwencji (`recordUndoConfirmTitle` — wynik, rekord bossa, wpis historii i osiągnięcia wrócą do stanu sprzed rekordu, operacji nie da się odwrócić) + `↩️ Tak, cofnij wynik` / `❌ Anuluj`
- **Efekt cofnięcia = ten sam co u admina** (`_cvRemoveRecord`): revert rankingu, historii wyników, osiągnięć od momentu rekordu i rekordu bossa; dodatkowo aktualizacja ról TOP, wygaszenie sesji CV, `ocrStats.recordReverted()`, refresh Centrum Dowodzenia
- **Synchronizacja obu stron** (`_applyRevertVisuals`):
  - gracz cofnął → embed w kanale logów OCR dostaje **nieaktywny czerwony** przycisk `↩️ Cofnął właściciel` + pole „↩️ Cofnięto"
  - admin cofnął → ogłoszenie publiczne dostaje **nieaktywny czerwony** przycisk `↩️ Cofnął admin` + notkę w treści
  - **profil usunięty przez właściciela** → przycisk `🗑️ Profil usunięty` (`recordUndoProfileDeleted`, status sesji `profile_deleted`) zamiast „Cofnął admin" — żaden admin nie interweniował, wynik zniknął razem z profilem; embed w logach OCR dostaje pole `🗑️ Profil usunięty` z nazwą skasowanego profilu. Powód przekazuje `_invalidateUndoForPlayer(..., { by: 'profile_deleted' })` z `_deleteProfileData`
  - referencja do embeda admina zapamiętywana przez `logService.sendOcrAnalysisEmbed({ onSent })` → `recordRevertService.attachAdminMessage()`
- **Klucz sesji = ID publicznego ogłoszenia.** Przycisk admina używa `ocr_revert_{publicMsgId}` (stary format `ocr_revert_{playerKey}_{guildId}` nadal obsługiwany → cofa ostatni rekord profilu), dzięki czemu oba przyciski dotyczą DOKŁADNIE tego samego rekordu
- **Ochrona przed podwójnym cofnięciem:** status (`active` → `owner`/`admin`/`profile_deleted`/`superseded`, sprawdzany helperem `_isSessionReverted`) ustawiany PRZED modyfikacją danych. Każda inna ścieżka usuwająca rekord unieważnia przycisk gracza: `_cvRemoveRecord` (CV: usuń rekord / zablokuj, cofnięcie z „Analizuj"), panel `🗑️ Usuń gracza`, panel `🧹 Usuń wynik`, usunięcie profilu w `/profiles`
- **Przycisk przeżywa przebudowę komponentów:** zgłoszenie CV (aktualizacja licznika `⚠️ Zgłoś (N)`) i zatwierdzenie zgłoszenia (`cvBtnStatusApproved` — rekord zostaje) dokładają go z powrotem przez `_undoButtonFor()`
- **Persystencja:** `data/record_reverts.json` (`{ sessions: { [publicMsgId]: {...} }, latest: { "playerKey_guildId": publicMsgId } }`) wczytywany przy starcie — bez tego restart bota unieważniałby przyciski pod opublikowanymi ogłoszeniami. Sesje starsze niż 30 dni czyszczone przy starcie
- **CustomIDs:** `rec_undo_{publicMsgId}` | `rec_undo_ok_{publicMsgId}` | `rec_undo_no` | `rec_undone_{owner|admin|profile_deleted}` (nieaktywny znacznik)

**4 Systemy:**
1. **OCR Wyników** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Google AI API (Gemini Vision), dwuetapowa walidacja
     - Włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
     - Trzyetapowa walidacja (trzy osobne requesty do API):
       - **KROK 1:** Sprawdza czy jest "Victory" (50 tokenów)
       - **KROK 2:** Sprawdza autentyczność zdjęcia (10 tokenów)
       - **KROK 3:** Wyciąga nazwę bossa, wynik (Best), Total i **wynik pojedynczej walki** — liczbę nad linią „Best" (500 tokenów). Best zasila ranking i rekordy bossów, wynik walki wyłącznie wyzwania (`/challenge`) — patrz „System Wyzwań 1 vs 1"
     - **Walidacja score vs Total:** Jeśli odczytany Best > Total → automatyczna korekta
     - **Walidacja długości cyfr** (`normalizeScore` w `aiOcrService.js`): jeśli wynik z jednostką (K/M/B/T/Q/Qi/Sx/Sp) ma więcej niż 5 cyfr przed jednostką LUB za dużo miejsc po przecinku → wynik **odrzucany jako podróbka** (`error: 'FAKE_PHOTO'`, `score: null`), NIE obcinany. Wcześniej funkcja obcinała nadmiarowe cyfry (`substring(0, 5)`), co potrafiło zaniżyć poprawnie odczytany wynik (np. AI poprawnie odczytało `213769Q`, obcięcie zamieniało go w błędny `21376Q` i wynik fałszywie nie bił rekordu)
       - **Wyjątek halucynacji `S→5` przed `Sx`** (dotyczy Best i Total): wzorzec `<int>.<cyfra>5Sx` (2 cyfry po przecinku, druga = `5`, jednostka `Sx`, gdy część całkowita ma ≥2 cyfry) NIE jest odrzucany — to klasyczna halucynacja AI, gdzie litera `S` została odczytana jako `5`, a jednostkę `Sx` model i tak dokleił (np. real `169.8Sx` → AI `169.85Sx`). W tym przypadku zdublowana `5` jest usuwana i wynik korygowany do `<int>.<cyfra>Sx` (`169.85Sx` → `169.8Sx`) zamiast `FAKE_PHOTO`. Bezpieczne: legalny wynik z 2 cyframi po przecinku jest możliwy tylko przy 1 cyfrze całkowitej (`maxDec=2`), więc taki przypadek nigdy nie wchodzi w ten blok. Wzorce z inną drugą cyfrą (`169.83Sx`) lub inną jednostką (`169.85Qi`) nadal odrzucane
     - Zalety: 100% pewność walidacji, fallback na tradycyjny OCR
   - **Komenda /update (wszyscy, wymaga AI OCR):** Używa `analyzeTestImage()` — weryfikacja wzorcem + ekstrakcja:
     - **KROK 1:** Porównanie z wzorcem `files/Wzór.jpg` — jeden request z dwoma obrazami (10 tokenów) — **10 retry** przy błędzie API (429/500/503), delay cappowany na 10s
       - **Podwójna weryfikacja negatywnego wyniku:** gdy AI odpowie NOK (screen niepodobny do wzorca), porównanie jest wykonywane **jeszcze raz** (drugi, niezależny request); screen odrzucany (`NOT_SIMILAR`) dopiero po DWÓCH negatywnych wynikach — chroni przed pojedynczą pomyłką modelu. Druga próba pozytywna → analiza kontynuowana normalnie. Powód odrzucenia = z drugiej próby (fallback: z pierwszej). Koszt tokenów obu prób sumowany w `tokenUsage`. Dotyczy `/update` i `/test` (wspólna implementacja `analyzeTestImage`)
     - **KROK 2:** Ekstrakcja danych (boss + score) — bez sprawdzania Victory i autentyczności (500 tokenów) — **10 retry** przy błędzie API, delay cappowany na 10s
     - Gdy screen niepodobny do wzorca → embed `testNotSimilarTitle/Description` (brak zapisu)
     - Po udanej weryfikacji: pełny flow — zapis do rankingu, aktualizacja ról TOP, snippet globalnego rankingu (gdy pozycja globalna się zmieniła), powiadomienia DM
     - Wymaga `USE_ENDERSECHO_AI_OCR=true`; gdy AI wyłączone → ephemeral `testAiOcrRequired`
     - Respektuje blokadę użytkownika (`userBlockService`) i globalny blok OCR (`ocrBlockService.isBlocked('update')`)
     - **Cooldown 5 min** po udanym zapisie wyniku — sprawdzany przez `updateCooldownService`; informuje gracza ile czasu pozostało (w języku serwera); persystowany w `data/update_cooldowns.json` (przeżywa restart)
     - **Brak cooldownu przy błędzie API:** cooldown jest ustawiany z góry (anty-spam), ale gdy analiza padnie na błędzie API (503/429/500/ECONNRESET/ETIMEDOUT — wykrywane po `error.status` i treści komunikatu w catch `_runUpdateFlow`) → `clearCooldown()` i komunikat `updateAiOverloaded`. Użytkownik nie płaci cooldownem za przeciążenie API (wcześniej czyszczone tylko przy 503)
     - **Globalne liczniki API (`ocr_stats.json → apiStats`, NIE resetowane przyciskiem resetu):** `requests` (każda próba zapytania do Gemini), `rejected` (próba odrzucona przez API — 429/500/503/sieć), `fullFailures` (wszystkie retry wyczerpane → screen niezaakceptowany z winy API, np. 10× 503 pod rząd). Rejestrowane w `aiOcrService._generateContent` przez `setStatsService(ocrStatsService)` (wiring w index.js). Wyświetlane w Centrum Dowodzenia → embed Statystyki → pole `🌩️ Zdrowie API`
   - **Komenda /test (tylko admin + użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`, wymaga AI OCR):** Tryb testowy `/update` — współdzieli pełną implementację przez `_runUpdateFlow(interaction, { dryRun: true, commandName: 'test', ocrBlockKey: 'test' })`:
     - Widoczna tylko dla administratorów (`setDefaultMemberPermissions(Administrator)`); wykonać może wyłącznie użytkownik z `ENDERSECHO_BLOCK_OCR_USER_IDS`
     - **Podgląd IDENTYCZNY z `/update`** (od czerwca 2026): `/test` renderuje dokładnie ten sam stos embedów co `/update` dla danego serwera — z global snippetem, snippetem bossa, **wykresem progresu**, nowymi osiągnięciami, licznikiem subskrypcji i pozycjami (klan/global/boss). Realizowane przez **symulację read-only** stanu „po zapisie" (bez modyfikacji danych):
       - Global ranking: `rankingService.simulateGlobalRanking(...)`; pozycja w klanie: `rankingService.simulateSortedPlayers(...)` → przekazana do `createRecordEmbeds({ sortedPlayersOverride })`
       - Ranking bossa: `bossRecordService.simulateGlobalBossRanking(...)` → przekazany do `_buildBossSnippetData(..., bossRankingOverride)` i do Case B
       - Osiągnięcia: `achievementService.processSubmission(..., { preview: true })` — liczy odblokowane bez zapisu (mutacje w pamięci odrzucane, `loadData` czyta świeżo z dysku)
       - Wykres: do historii doklejany **symulowany punkt** nowego wyniku (by wykres był identyczny jak po zapisie)
       - `previousBossRecord` czytany read-only (`getUserBossRecords`); subskrybenci liczeni read-only (DM **nie** wychodzi)
       - **Cross-server**: `/test` symuluje też przypadek duplikatu globalnego z pobiciem rekordu bossa (preview, ephemeral)
     - Pozostałe różnice dry-run (jak dotąd):
       - Wynik wyświetlany jako **ephemeral** w `editReply` — bez publicznego `followUp`
       - **Brak zapisu** do rankingu/boss_records/achievements/historii (wszystko symulowane)
       - **Brak aktualizacji ról TOP**, **brak powiadomień DM**, **brak sesji CV/revert**, **brak `logScoreUpdate`**
     - Nadal działa: `logCommandUsage('test')`, `usageLimitService` (zlicza dzienny limit), `tokenUsageService` (rejestruje koszty AI), `_sendInvalidScreenReport` dla NOT_SIMILAR/FAKE_PHOTO
     - Respektuje `isAllowedChannel`, blokadę użytkownika (`userBlockService`) oraz globalny blok OCR (`ocrBlockService.isBlocked('test')`)

2. **Rankingi Multi-Server** - `rankingService.js`:
   - **Per-serwer:** Osobny plik `data/guilds/{guildId}/ranking.json` dla każdego serwera; **klucz wpisu = `playerKey`** (profil), wartość niesie `userId` (właściciel), `playerKey`, `profileIndex`, `profileLabel`
   - **Normalizacja przy odczycie:** `loadRanking()` rozkłada klucz mapy i dopisuje `playerKey`/`userId`/`profileIndex` do każdego wpisu — dzięki temu KAŻDA ścieżka odczytu ma te pola bez zmian w miejscach wywołania
   - **Globalny:** `getGlobalRanking()` — najlepszy wynik **profilu** ze wszystkich serwerów (dedup po `playerKey`, nie po `userId`); `getGlobalRankingByUser()` — jeden (najlepszy) profil na osobę, do progów ról i eksportu
   - **Dedup cross-server** (`_removeWeakerScoresFromOtherGuilds`) operuje na `playerKey` — bez tego rekord jednego profilu wykasowałby wpisy pozostałych profili tej samej osoby
   - Eksport do `shared_data/endersecho_ranking.json` (`players[]` = jeden wpis na osobę — najlepszy profil, format: `{rank, userId, playerKey, profileIndex, username, score, scoreValue, bossName, timestamp, sourceGuildId, serverRank, serverTotalPlayers}`; `profiles[]` = wszystkie profile w tym samym formacie)
   - Eksport przy każdym zapisie i przy starcie bota
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`
   - **Tie-break przy remisie (identyczny `scoreValue`):** `compareByScoreThenTimestamp` (`utils/helpers.js`) — gracz który zdobył dany wynik **wcześniej** (starszy `timestamp`) jest wyżej; ten kto powtórzył identyczny wynik jako drugi ląduje niżej. Używane we wszystkich sortowaniach po wyniku: ranking serwera (`getSortedPlayers`), ranking globalny (`getGlobalRanking`, `saveSharedRanking`), symulacje `/test` (`simulateSortedPlayers`, `simulateGlobalRanking`), ranking per-boss (`bossRecordService.getGlobalBossRanking`, `simulateGlobalBossRanking`) oraz pomocnicze wyliczenia „poprzednia pozycja" (delta ▲/▼ w ogłoszeniach rekordu)

3. **Role TOP (opcjonalne)** - `roleService.js`:
   - Do **10 w pełni konfigurowalnych progów** per serwer; każdy próg = zakres pozycji rankingowych + rola Discord
   - **Progi liczone na liście z jednym profilem na osobę** (`rankingService.getSortedPlayersByUser`) — gracz z kilkoma profilami nie zablokuje dwóch progów i nie odbierze roli innym
   - **Format danych:** `{ tiers: [{ from, to, roleId }] }` w `guild_configs.json`; backward compat ze starym formatem `{ top1, top2, top3, top4to10, top11to30 }` przez `normalizeTiers()`
   - **Backward compat:** `normalizeTiers(topRoles)` konwertuje stary format na `tiers[]` on-the-fly; istniejące konfiguracje działają bez migracji
   - Role są **opcjonalne per serwer** — jeśli serwer nie ma skonfigurowanych ról, bot je pomija
   - `updateTopRoles(guild, _sortedPlayers, guildTopRoles)` — zawsze pobiera świeże dane z rankingu (parametr `sortedPlayers` ignorowany)
   - **Mutex per-guild** (`_locks` Map): jeśli aktualizacja dla danego serwera jest już w toku, kolejna zostaje oznaczona jako `hasPending`; po zakończeniu bieżącej uruchamiana jest automatycznie z najświeższym rankingiem (via `setImmediate`). Wyklucza race condition przy równoczesnych rekordach.
   - **Diff-based update**: zamiast resetować wszystkie role i przyznawać od nowa, oblicza różnicę między aktualnym stanem (z Discord cache `role.members`) a pożądanym (z rankingu). Tylko faktyczne zmiany trafiają do API. Jeśli gracz nie zmienił pozycji, zero API calls.
   - **Równoległe operacje**: usunięcia i dodania wykonywane przez `Promise.allSettled` — szybsze niż sekwencyjne `await`. Batch fetch wszystkich memberów wymagających roli naraz (`guild.members.fetch({ user: [...] })`).
   - **Logowanie błędów per-guild**: `roleService` przyjmuje `logService` w konstruktorze i loguje błędy (usuwania/przyznawania ról, fetch memberów) przez `logService._gl(guildId)` — trafia do dedykowanego webhooka serwera.
   - **Ogłoszenie rekordu — STOS 4 EMBEDÓW** (`rankingService.createRecordEmbeds` → zwraca `EmbedBuilder[]`):
     - Wszystkie embedy wysyłane w **jednej wiadomości** (`followUp({ embeds, files })`) — pojawiają się jednocześnie, atomowo (jeden `message.id`). Komponenty (przycisk CV „Zgłoś") renderują się pod całą wiadomością, czyli pod ostatnim (4.) embedem.
     - **Kolor jednolity** dla wszystkich 4 embedów wg pozycji gracza (`getPositionColor`): 🥇 złoty (TOP1), 🥈 srebrny (TOP2), 🥉 brązowy (TOP3), niebieski (TOP4-10), zielony (TOP11+ / brak pozycji)
     - **Embed 1 — 🏆 Gratulacje (BEZ bossa):** tytuł `🏆 GRATULACJE!`, author = ikona+nazwa roli TOP, thumbnail = avatar gracza, opis = postęp (`stary ➜ nowy (+X)`) + **pozycja w klanie** (`medal #N (+awans)`) + **pozycja na serwerze w rankingu tego bossa** + **pozycje w rankingach ról** (🎖️) + czas od ostatniego rekordu; pola: `🎉 Nowe osiągnięcia`, `🔔 SUBSKRYPCJE: N`
       - **Linijka pozycji bossa na serwerze** (`bossServerPosition` w `createRecordEmbeds`, klucz `recordBossServerPosition`): `👾 **Pozycja (Boss):** #3 / 17` — pozycja i liczba graczy w rankingu tego bossa **wyłącznie na tym serwerze** (nie globalnie). Etykieta **bez słowa „na serwerze" i bez nazwy bossa** — cały blok pozycji w Embedzie 1 (`🏅 Pozycja`, rankingi ról) dotyczy serwera, a nazwa bossa i tak jest w Embedzie 3, więc oba dopiski były redundantne. Klucz `recordBossRanking` o tej samej treści to osobna, **martwa** etykieta: `bossRankingOverride.label` / `bossGlobalRankingOverride.label` nigdzie nie trafiają do embeda (są tylko przypisywane i logowane), więc duplikat treści niczego nie psuje. Liczona helperem `_buildBossServerPosition(guildId, bossName, playerKey, opts)` przez `bossRecordService.getGlobalBossRanking([guildId], boss)` (`/test` → `simulateGlobalBossRanking`, żeby podgląd był identyczny jak po zapisie). Pokazywana **zawsze gdy boss jest znany** — także gdy rekord bossa nie został pobity (to aktualna pozycja, nie zmiana). Pomijana dla nieznanej nazwy bossa (`wasUnknownBoss`). W ścieżce cross-server (rekord bossa zostaje na poprzednim serwerze) liczona dla `sourceGuildId`, czyli serwera, na którym wynik faktycznie leży. Dotyczy wszystkich ogłoszeń rekordu: `/update`, `/test`, ścieżki „tylko rekord bossa", cross-server i panelu „Analizuj"
     - **Embed 2 — 🌍 Ranking globalny:** tytuł `globalRankingEmbedTitle`, opis = snippet globalny, **thumbnail = generowana grafika z numerem NOWEJ pozycji globalnej** (`services/positionIconService.js`, SVG→PNG przez sharp, plik `global_position.png` via `attachment://`; tiery: #1 złoty medal z koroną+laurem+czerwoną wstęgą, #2 srebrny medal z niebieską wstęgą, #3 brązowy medal z zieloną wstęgą, #4–10 blurple tarcza z gwiazdą, #11–30 fioletowy heksagon, #31–100 stalowy okrągły badge, #101+ grafitowy okrąg; fallback przy błędzie generowania = statyczna ikona CDN), `image` = wykres progresu (`score_history.png`, ten sam co w `/ranking`, gdy ≥2 wpisy historii), footer z ikoną globalną. Pozycja liczbowa pochodzi z `globalSnippetData.newGlobalPosition` (zwracana przez `globalTop10Service.buildSnippetFieldData`). Grafika generowana i dołączana w `/update`, `/test` (dryRun) i panelu „Analizuj"; DM subskrybentów odtwarza załącznik pod tą samą nazwą. **Pokazywany WYŁĄCZNIE gdy zmieniła się pozycja globalna** (`globalSnippetData != null`) — gdy brak zmiany, embed jest pomijany (a wykres nie jest generowany).
     - **Embed 3 — 👾 Ranking bossa:** tytuł `bossRankingEmbedTitle` z `{bossName}`, thumbnail = **ikona bossa** (`bossAliasService.getBossImagePath` → `data/boss_images/`, fallback ikona bota), opis = `👾 Rekord na bossie` (`stary ➜ nowy` / „pierwszy wynik") + snippet rankingu bossa. Pokazywany gdy pobito rekord bossa (`isNewBossRecord && bossName && !wasUnknownBoss`).
     - **Embed 4 — ℹ️ Informacje systemowe:** tytuł `systemInfoEmbedTitle`, `image` = **screenshot przesłany do analizy**, footer z timestampem. Opis (description) i pola (fields) zależą od sytuacji:
       - **Opis domyślny** (brak jakichkolwiek uwag): `systemInfoAllGood` („Zdjęcie zweryfikowane poprawnie.\nWynik zapisany w rankingu.")
       - **Opis nadpisany** (`specialDescription`, pierwsze dopasowanie wygrywa): `manualVerificationNote` (panel „Analizuj") > `crossServerScoreRemovedNote` (nowy wynik ściśle lepszy niż na innym serwerze — treść = `systemInfoAllGood` + notka `crossServerScoreRemovedNotice` z nazwą starego i nowego serwera) > `crossServerMigratedNote` (dokładne wyrównanie wyniku z innego serwera — notka `crossServerMigratedNotice`, BEZ prefiksu `systemInfoAllGood`)
       - **Pola dodatkowe** (`systemNotices`, mogą wystąpić RAZEM z opisem nadpisanym): `unknownBossRankingField`/`unknownBossRankingNotice` (nowy nierozpoznany boss), `crossServerBossKeptField`/`crossServerBossKeptValue` (rekord bossa pobity mimo duplikatu globalnego — rekord globalny zostaje na poprzednim serwerze)
       - **Ikona** (author iconURL + thumbnail, 3 stany): `manualVerificationNote` obecna → `.../emojis/1297532628395622440.webp` (zweryfikowano manualnie); jakiekolwiek inne uwagi/komunikaty → `.../emojis/1522939660278435993.webp` (nowa, statyczna); brak uwag → `.../emojis/1297531523477540894.webp` (domyślna, animowana)
     - **Embed wyzwania (opcjonalny) — PRZEDOSTATNI w stosie:** dokładany POZA `createRecordEmbeds`, przez `_appendChallengeEmbed(embeds, files, icon)` w `interactionHandlers.js`. Pojawia się tylko wtedy, gdy wynik ruszył jakieś wyzwanie. **Wchodzi PRZED ostatni embed stosu** (`splice(length - 1, 0, …)`), czyli tuż przed „Informacjami systemowymi" — tamten domyka ogłoszenie zrzutem ekranu i ma zostać na końcu. Author (lewy górny róg) = **zdjęcie bossa**, nazwa autora = `challengeNoticeField` — **samo `Wyzwanie` / `Challenge`, BEZ ikony mieczy** (miecze stały wcześniej w tekście, mając tuż obok obrazek bossa; ikona i emoji w tym samym miejscu dublowały się). Thumbnail = **generowany pierścień postępu** `1/3` / `2/3` / `3/3` (`challenge_progress.png`), opis = informacja o zaliczeniu wyniku. Kolor: pomarańczowy w trakcie, zielony przy komplecie, żółty gdy wynik czeka na zatwierdzenie bossa. Szczegóły w sekcji „System Wyzwań 1 vs 1"
     - **Załączniki** (`files`): `[screenshot, score_history.png?, bossImage?, challenge_progress.png?]`
     - **Guard 6000 znaków** (`_enforceEmbedCharLimit`) — przycina opisy/pola od końca, by zmieścić się w limicie wiadomości
     - **Ścieżka tylko-rekord-bossa** (globalny ranking niezmieniony): stos bez Embedu 2 (1 + 3 + 4)
     - **DM subskrybentów** (`createDmNotifEmbeds`): **cały stos embedów**; Embed 1 przekształcony (tytuł → author „pobił rekord", pola porównania z wynikiem subskrybenta), pozostałe embedy klonowane; załączniki odtwarzane z tymi samymi nazwami
     - **Ścieżka admina „Analizuj" (panel raportów odrzuconych):** używa tego samego stosu 4 embedów (`createRecordEmbeds`) co `/update`/`/test` — snippet globalny, snippet/ikona bossa, wykres progresu, osiągnięcia, licznik subskrypcji, DM do subskrybentów. **Embed 4** zamiast `systemInfoAllGood` pokazuje notkę `analyzeManualAnnouncement` („Twój wynik został zweryfikowany manualnie przez administratora **{adminName}**.") — przekazywaną przez opcję `manualVerificationNote` w `createRecordEmbeds`. Ta sama treść jest też `content` wiadomości ogłoszenia (ping do gracza). Rekord bossa bez globalnego → cały stos w kolorze teal (`0x1ABC9C`).
   - **Snippet globalny** (`globalTop10Service.buildSnippetFieldData`):
     - Wbudowany jako opis Embedu 2 (ranking globalny)
     - Warunek: pozycja globalna gracza zmieniła się (dotyczy WSZYSTKICH graczy, nie tylko TOP10 serwera)
     - Zawiera: kierunek zmiany (▲/▼), stara → nowa pozycja, 3 linie rankingu globalnego (gracz powyżej, gracz, gracz poniżej) w formacie identycznym jak `/ranking → 🌐 Global`
   - **Cykliczny raport Global TOP10** (`globalTop10Service`) — `services/globalTop10Service.js`:
     - Interwał: 9 raportów (bossów sezonu) co 3 dni, potem 4 dni przerwy (dzień odpoczynku + boss1 nowego sezonu), powtórz — dopasowane do sezonu 28-dniowego (9 bossów × 3 dni + 1 dzień odpoczynku)
     - **`CYCLE_LEN = 9`** (liczba raportów w sezonie, NIE liczba wszystkich pozycji cyklu) — poprzednio błędnie ustawione na 10, co wstawiało dodatkowy, 10. raport przed każdą kolejną przerwą; efekt: **każdy sezon po pierwszym miał w rzeczywistości 10 raportów zamiast 9**, a harmonogram trwale przesuwał się o 3 dni w przód przy każdej kolejnej granicy sezonu. Zweryfikowane symulacją względem realnego kalendarza (27 raportów / 3 sezony) — po poprawce wszystkie daty zgadzają się co do dnia.
     - Stopka embeda „Next report in X days” liczy interwał na podstawie `triggerCount + 1` (ten sam wzór, którego użyje późniejszy `_stepOnce()`) — bez tego przesunięcia stopka pokazywała błędną liczbę dni dokładnie na granicy sezonu
     - Konfiguracja w `data/global_top10_config.json` (enabled, nextTrigger, triggerCount, lastSnapshot)
     - Snapshot poprzednich pozycji → zmiany ▲/▼/=/🆕 przy każdym graczu
     - Boss okresu: najczęstszy boss z ostatnich 10 wpisów historii wyników (`wyniki/`)
     - Wysyłany na każdy serwer z `globalTopNotifications !== false` do `allowedChannelId`
     - **Blokada ponownego wejścia (`_wysylkaWToku`):** `_tick()` chodzi w `setInterval` co minutę i nie czeka na zakończenie poprzedniego przebiegu, a `_sendReports()` wysyła embed na KAŻDY skonfigurowany serwer — przy większej liczbie serwerów i rate limicie Discorda potrafi przekroczyć minutę. Bez blokady kolejny tick widział wciąż nieprzesunięty `nextTrigger` (przesuwa go dopiero `_advanceTrigger()` PO wysyłce) i rozsyłał cały raport TOP10 po raz drugi. `_advanceTrigger()` siedzi teraz w `finally`, więc termin przesuwa się także po błędzie
     - Konfiguracja przez panel admina → **📅 Interwał TOP10** (tylko head admin) → modal z jednym polem: data/godzina **początku cyklu** (format `DD.MM.RRRR GG:MM`), zawsze traktowana jako pierwszy boss sezonu (`triggerCount=0`); puste pole = wyłącz harmonogram
     - **Wpisywana data/godzina to czas Europe/Warsaw** (`_warsawToUtc()` w `interactionHandlers.js`) — konwertowana na poprawny instant UTC z uwzględnieniem CET/CEST (trik: sformatuj instant-potraktowany-jako-UTC w strefie Warsaw, porównaj z oczekiwanym zegarem, skoryguj o różnicę). Wcześniej kod naiwnie doklejał `Z` (traktując wpisaną godzinę jako UTC) i wyświetlał wynik przez lokalne gettery `Date` (`getHours()` itp.) zależne od strefy czasowej procesu bota — dawało to błędny, przesunięty czas w potwierdzeniu panelu (np. wpisane 18:00 pokazywało się jako 14:00 przy serwerze w innej strefie). Wyświetlanie („Początek cyklu”, „Najbliższy kolejny raport”, prefill przy ponownym otwarciu modala) idzie teraz przez `_fmtWarsaw()`, spójnie z `fmtTs()` używanym w Centrum Dowodzenia.
     - **`setSchedule()` nie resetuje pozycji w cyklu, gdy data się nie zmienia** — samo otwarcie i zatwierdzenie modala z tą samą (prefilled) datą nie zeruje już `triggerCount`. Wcześniej każde zatwierdzenie modala (nawet bez zmiany daty, np. tylko żeby podejrzeć harmonogram) bezwarunkowo zerowało `triggerCount`, co po cichu przesuwało pozycję 4-dniowej przerwy względem realnego końca sezonu.
     - **Podana data może być w przeszłości** — traktowana jest jako punkt odniesienia (np. faktyczny, znany początek cyklu), a harmonogram (`setSchedule()`) sam przewija się wg wzorca 9×3 dni + 4 dni przerwy do najbliższego przyszłego terminu (`_stepOnce()` w pętli), **bez wysyłania** pominiętych po drodze raportów — pozwala to poprawnie zrekalibrować cykl po wykryciu rozjazdu, wpisując realną, znaną datę zamiast liczyć ręcznie następny przyszły termin. Potwierdzenie w panelu pokazuje realnie wyliczony najbliższy termin po przewinięciu.
     - **Format embeda:** TOP 3 — blok blockquote z paskiem postępu `█░` (% względem lidera) i kolorowym wskaźnikiem zmiany `▲/▼`; pozycje 4–10 — kompaktowa jednolinijkowa z tagiem serwera
     - **Komenda /generate (head admin):** `buildOnDemandEmbed()` — generuje ten sam embed bez aktualizacji snapshootu/harmonogramu i wysyła go na `allowedChannelId` serwera; widoczna tylko dla adminów (`setDefaultMemberPermissions(Administrator)`), wykonać może wyłącznie head admin (`ENDERSECHO_BLOCK_OCR_USER_IDS`)

4. **Paginacja + Wybór Rankingu** - `interactionHandlers.js`:
   - `/ranking` → ephemeral z przyciskami: `[NazwaSerwera1]`, `[NazwaSerwera2]`, `[🌐 Global]`
   - Nazwy serwerów pobierane dynamicznie z `client.guilds.cache`
   - Po kliknięciu serwera → ranking z paginacją (10/strona, 1h timeout) + przyciski rankingów ról (jeśli skonfigurowane)
   - **Wykres historii rekordów** (`scoreHistoryService` + `chartService`): jeśli wywołujący ma ≥ 2 wpisy → PNG dołączony do tej samej wiadomości rankingowej. **Okno czasowe: max ostatni rok** (starsze wpisy odcinane wewnątrz `generateScoreHistoryChart` względem najnowszego wpisu). **Dwie strefy:** ostatnie 3 miesiące = wszystkie wpisy (dedup per dzień, najwyższy wynik dnia, kropki); starsze niż 3 miesiące = **1 punkt per miesiąc (najwyższy wynik miesiąca, romby)** — strefa archiwum z ciemniejszym tłem, przerywaną granicą i podpisami stref. Oś X: daty rzeczywiste z etykietami miesięcy, oś Y: wyniki z jednostkami (K/M/B/T/Q/Qi/Sx/Sp). **Teksty wypalone w bitmapę są dwujęzyczne** — ostatni parametr `lang` (`'pol'`/`'eng'`, domyślnie `'pol'`) steruje skróconymi nazwami miesięcy na osi X (`sty/lut/…` vs `Jan/Feb/…`) i podpisami stref („max / mies." + „ostatnie 3 mies." vs „max / month" + „last 3 months"). Wołający przekazuje język serwera helperem `_chartLang(guildId)` (`interactionHandlers.js`) — dotyczy `/ranking`, ogłoszenia rekordu po `/update` i `/test`, oraz ogłoszenia z panelu „Analizuj". Ta sama zasada w pozostałych wykresach: `generateGlobalPlayerGrowthChart`, `generatePerServerGrowthChart` (oś miesięcy) i `generateGuildComparisonChart` (podpis „graczy" / „players"); `milestoneService` renderuje wykres osobno per język, więc przekazuje `lang` z cache'a. **Etykiety wyników z decluttering:** zawsze punkty miesięczne, pierwszy punkt i globalne maksimum; punkty dzienne tylko gdy odstęp ≥ 42px; ostatni punkt = **kolorowy badge (pill) z aktualnym rekordem**. Nagłówek zawiera linię statystyki wzrostu `pierwszy → aktualny (+X%)`; tytuł przechodzi przez `stripEmoji` (librsvg nie renderuje emoji). Dane persystowane w `data/guilds/{guildId}/wyniki/{userId}.json` — każde pobicie rekordu to nowy wpis. **Wykres budowany z historii ze WSZYSTKICH serwerów** (`getUserHistoryAllGuilds`) — wyniki z różnych serwerów scalane chronologicznie. Ranking serwera X usuwa gracza gdy ma lepszy wynik na innym serwerze (tylko ranking.json — historia wyników zostaje).
   - **Wykres przyrostu unikalnych graczy** (tryb global): po kliknięciu `🌐 Global` — zamiast wykresu historii gracza generowany jest wykres kumulatywnego przyrostu unikalnych graczy w czasie (`generateGlobalPlayerGrowthChart`). Dane zbierane przez `scoreHistoryService.getAllUsersFirstEntries(allGuildIds)` — dla każdego userId szuka najwcześniejszego wpisu we wszystkich plikach `wyniki/*.json`, grupuje po dniu UTC, buduje serię kumulatywną. Wykres: tło Discord dark, kolor blurple (#5865F2), krzywa Catmull-Rom z gradientem, ostatni punkt (aktualny total) wyróżniony kółkiem + etykietą z liczą graczy. Tytuł: `msgs.globalPlayerGrowthChartTitle` (PL: `📊 Przyrost Unikalnych Graczy`, EN: `📊 Unique Player Growth`). Fallback: jeśli < 2 unikalnych graczy → brak wykresu. Błąd → tylko log warn, ranking wysyłany bez wykresu.
   - Ranking globalny wyróżniony kolorem niebieskim (0x5865f2), serwer złotym (0xffd700)
   - W rankingu globalnym każda linia zawiera nazwę serwera źródłowego
   - **Wyświetlany wynik = oryginalny string `score`** zapisany przy OCR (z fallbackiem na `formatScore(scoreValue)` dla starych wpisów). NIE odtwarzamy wyniku z `scoreValue` przez `formatScore()` w listach rankingowych — `formatScore` zaokrągla do 2 miejsc po przecinku, więc pobicie rekordu o małą wartość (np. wysokie wyniki typu `12345B` → `12.34T`) nie zmieniało wyświetlanej liczby mimo nowego rekordu (boss i data się zmieniały, sam wynik nie). Dotyczy `createRankingEmbed` (lista + statystyka "najwyższy wynik") oraz `globalTop10Service` (raport cykliczny + snippet w embeddzie rekordu). `scoreValue` nadal używany WYŁĄCZNIE do sortowania i porównań. Sumy klanów (`createGuildRankingEmbed` → `totalScore`) nadal przez `formatScore` — brak stringa źródłowego.
   - **Układ przycisków w widoku rankingu SERWERA** (`createRankingButtons`, `mode: 'server'`):
     - Rząd 1: `◀️ ranking_prev` · `🎯 Moja pozycja` · `▶️ ranking_next`
     - Rząd 2: `🌐 Global` · `👾 Ranking bossów {nazwa serwera}` (`ranking_boss_srv_{guildId}`) · `↩️ Rankingi serwerów` (`ranking_back`, powrót do ekranu wyboru serwera)
     - Rząd 3+: rankingi ról (`createRoleRankingButtons`)
   - Tryby `global` / `guild_ranking` / `role` mają układ jak dotychczas (Powrót jako ostatni przycisk wiersza paginacji, w trybie global w osobnym rzędzie)

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
   - **101 stałych osiągnięć** w 5 kategoriach + 1 dynamiczny status (`status_top1` — rewokowany gdy wynik usunięty)
   - **Kategorie:** 🏆 Wyniki (9) · 🔁 Rekordy (8) · 🎯 Bossowie (8: 1/3/5/7/10/13/16/20 różnych bossów, dwa najwyższe: ☄️ Nieśmiertelny Łowca i 👑 Bóg Łowów, oba mythic) · 🕵️ Eksplorator/ukryte (64 — w tym 23 sekretne za wyzwania `/challenge`) · 💎 Prestiż (13)
   - **Rarities:** ⬜ Common · 🟩 Uncommon · 🟦 Rare · 🟪 Epic · 🟧 Legendary · 🔴 Mythic
   - **Odblokowanie:** osiągnięcia score/records/bosses/prestige blokowane przy każdym nowym rekordzie; ukryte (explorer) blokowane natychmiast przy przegladzie rankingu lub subskrypcji
   - **Kasowanie częściowe:** `clearUserAchievements(guildId, userId)` — usuwa WSZYSTKIE osiągnięcia kategorii `score` i `records` oraz resetuje `recordCount`/`lastRecordAt`/`lastRecordBeatAt`; pozostałe kategorie (bosses, explorer, prestige) zostają; wywoływane przy usunięciu gracza z rankingu (panel admina + komenda `/remove` — usunięcie całego gracza)
   - **Kasowanie po timestampie:** `clearAchievementsAfter(guildId, userId, fromTimestamp, { removedRecordCount, previousRecord })` — usuwa **WSZYSTKIE** osiągnięcia (wszystkie kategorie) z `unlockedAt >= fromTimestamp` (zdobyte wcześniej zostają), dekrementuje `recordCount` o `removedRecordCount`, cofa `lastRecordAt`/`lastRecordBeatAt` do `previousRecord.timestamp`; wywoływane przy **cofaniu wyniku** (CV `_cvRemoveRecord`, panel Analizuj → Cofnij) — usuwa osiągnięcia zdobyte od momentu cofniętego rekordu; `bossesEncountered` nie jest modyfikowane (brak timestampów per boss — boss osiągnięcia będą re-przyznane przy następnym legalnym zgłoszeniu)
   - **Reset pełny:** `resetAllAchievements(guildId, userId)` — usuwa cały wpis gracza z pliku (wszystkie kategorie + cały progress); wywoływane ręcznie przez head admina z `/manage` → `🏆 Usuń osiągnięcia` → opcja "Usuń wszystkie"
   - **Usunięcie jednego:** `removeOneAchievement(guildId, userId, achId)` — usuwa tylko jedno odblokowane osiągnięcie (stara ścieżka `panel_ach_ok_1:`, nadal obsługiwana)
   - **Usunięcie wielu naraz:** `removeAchievements(guildId, playerKey, achIds)` — jeden zapis zamiast N, zwraca faktycznie usunięte ID (pomija te, których gracz nie miał). Używane przez panel `/manage` → `🏆 Usuń osiągnięcia`
   - **Cofnięcie osiągnięć konkretnego rekordu:** `clearRecordAchievementsAfter(guildId, playerKey, fromTimestamp, { removedRecordCount, previousRecord })` — kasuje osiągnięcia z `unlockedAt >= fromTimestamp` **z pominięciem kategorii `explorer`** i zwraca ich ID. Używane przez `🧹 Usuń wynik`, gdy kasowany wpis jest ostatnim w historii gracza. Różnica wobec `clearAchievementsAfter` (CV/Analizuj): tamta tnie **wszystkie** kategorie, bo cofa cały łańcuch rekordów po zgłoszonym; ta dotyczy jednego wyniku, więc aktywność eksploratora zostaje
   - **Panel `🏆 Usuń osiągnięcia` (head admin):** modal nicku → wybór gracza → lista jego osiągnięć jako **select wielokrotnego wyboru** + przycisk `🔎 Szukaj osiągnięcia` (modal filtra) i `🗑️ Usuń wszystkie`. **Filtr działa na nazwie polskiej ORAZ angielskiej i na ID** — niezależnie od języka serwera, bo admin może znać osiągnięcie pod dowolną z nazw; etykieta opcji jest w języku serwera, a druga wersja nazwy trafia do opisu opcji
   - **Paginacja listy osiągnięć (25/stronę):** select menu Discorda mieści maks. 25 opcji, a gracz może mieć kilkadziesiąt osiągnięć — dlatego pod listą jest rząd `◀️ | X/Y | ▶️` (`panel_ach_del_pg_prev` / `panel_ach_del_pg_info` (disabled, wskaźnik) / `panel_ach_del_pg_next`), a embed pokazuje numer strony i zakres pozycji. Numer strony trzymany w sesji i **przycinany do zakresu przy każdym renderze** — liczba pozycji zmienia się po filtrze i po usunięciu osiągnięć (np. z 4 stron zostają 2 → admin ląduje na ostatniej istniejącej). Zmiana filtra i `🧹 Wyczyść filtr` wracają na stronę 1; zmiana strony czyści zaznaczenie (select pokazuje już inne pozycje)
   - Stan (gracz, filtr, strona, zaznaczenie) w `_achDelSessions` Map (RAM, TTL 15 min) — lista ID nie zmieściłaby się w customId (limit 100 znaków); to sesja czysto UI, więc restart bota tylko ją zeruje
   - **`getAchievementDefs(achIds)`** — definicje po ID, do etykiet (`icon`, `namePol`/`nameEng`) w potwierdzeniach panelu i w komunikacie po usunięciu wyniku
   - **Odczyt odblokowanych:** `getUnlockedAchievements(guildId, userId)` — zwraca tablicę `[{ ...ach, unlockedAt }]` dla osiągnięć gracza; używane przez panel admina do zbudowania listy wyboru
   - **Powiadomienie:** w embeddzie rekordu pojawia się pole `🎉 Nowe osiągnięcia` WYŁĄCZNIE z osiągnięciami faktycznie odblokowanymi w danym zgłoszeniu (`processSubmission` zwraca tylko ID dodane w tym wywołaniu — `newlyUnlocked`). **NIE** filtrujemy już po `lastRecordBeatAt`: poprzedni filtr `!prevLastBeat || unlockedAt > prevLastBeat` przy `lastRecordBeatAt === null` lub niespójnych `unlockedAt` (dane legacy/odtworzone z backupu) ogłaszał ponownie WSZYSTKIE posiadane osiągnięcia ("ponowne przyznawanie"). Pole `lastRecordBeatAt` jest nadal aktualizowane (używane przez `clearAchievementsAfter`/revert), ale nie decyduje o tym, co pokazać.
   - **Persistencja:** `data/guilds/{guildId}/achievements.json` — per-serwer; przeżywa restart
   - **Serializacja zapisu (anti-race):** wszystkie operacje mutujące (`processSubmission`, `_trackExplorer` używane przez metody `track*`, `revert*`, `clear*`, `reset*`, `removeOneAchievement`) przechodzą przez kolejkę per-serwer `_enqueue(guildId, fn)` (wzorzec z `rankingService`, timeout 30s). Zapobiega to race condition: bez kolejki częste metody `track*` (wołane przy każdym podejrzeniu rankingu/subskrypcji/wyszukaniu profilu) mogły nadpisać świeży zapis `processSubmission` swoim starym snapshotem, cofając `lastRecordBeatAt` — co powodowało **ponowne ogłaszanie już posiadanych osiągnięć** w embedzie rekordu. Wszystkie metody `track*` współdzielą helper `_trackExplorer(guildId, userId, incrementFn)`.
   - **Widok osiągnięć** (zakładka `🏆 Osiągnięcia` w `/profile` — osobnej komendy `/achievements` NIE MA): ephemeral embed — każda kategoria na osobnej stronie + przycisk podsumowania + przycisk "Sprawdź gracza". Wiersz 1: 5 przycisków kategorii (`🏆 Wyniki`, `🔁 Rekordy`, `🎯 Łowy`, `💎 Prestiż`, `🕵️ Eksplorator`). Wiersz 2: `📊 Podsumowanie` + `🔍 Sprawdź gracza`. Tytuł embeda = etykieta kategorii. Odblokowane: `emoji **nazwa** *(rarity)* \n└ opis — data`. Zablokowane nieukryte: `🔒 ~~nazwa~~`. Zablokowane ukryte: `🔒 **???**`. Stopka: `X/Y odblokowanych` (ukryte: `X/? odblokowanych`). Domyślna strona po wejściu w zakładkę: kategoria `score`. **Osiągnięcia cross-server:** `buildAchievementsViewGlobal(allGuildIds, userId, ...)` merguje dane ze WSZYSTKICH serwerów (`_mergeAchievements`); to samo dla `/profile` i "Sprawdź gracza".
   - **Sprawdź gracza (`ach_check_player`):** otwiera modal z polem nicku → wyszukuje cross-server przez `getGlobalRanking()` → jeśli 1 trafienie: od razu pokazuje osiągnięcia; jeśli wiele: StringSelectMenu (`ach_check_sel`). Wyświetla osiągnięcia ze **wszystkich serwerów** (`buildAchievementsViewForUserGlobal`). **Bez opisów jak zdobyć** — format: `emoji (rarity_emoji) **nazwa** *(rarity)* — data`. Przyciski nawigacji osadzają userId+guildId w customId (`ach_vc_{cat}_{userId}_{guildId}`, `ach_vo_{userId}_{guildId}`). Powrót do własnych osiągnięć przez `ach_vb`.
   - **Tracking:** `trackRankingView(guildId, userId)` — wołane w `handleRankingCommand`; `trackSubscription(guildId, userId)` — wołane w `_handleNotifConfirm`; `trackNonRecord(guildId, userId)` — wołane w `_runUpdateFlow` gdy `!isNewRecord && !dryRun`; `trackCvApproved(guildId, userId)` — wołane w CV approve handler; `trackAiAnalyzed(guildId, userId)` — wołane w `_handleAnalyzeButton` po zapisaniu wyniku; `trackProfileSearch(guildId, userId)` — wołane w `_handleProfileSearchModal` gdy znaleziono ≥1 wynik; `trackChallengeSent/Accepted/Won/Lost(guildId, playerKey)` — wyzwania `/challenge`
   - **Progress:** `progress.recordCount`, `progress.bossesEncountered[]`, `progress.rankingViews`, `progress.subscriptions`, `progress.lastRecordAt`, `progress.lastRecordBeatAt`, `progress.todayRecordDate` (YYYY-MM-DD UTC), `progress.todayRecordCount`, `progress.nonRecordCount`, `progress.cvApprovedCount`, `progress.aiRescuedCount`, `progress.profileSearches`, `progress.challengesSent`, `progress.challengesAccepted`, `progress.challengesWon`, `progress.challengesLost`, `progress.challengesDraws`
   - **Context w processSubmission:** `ctx.scoreValue`, `ctx.isNewRecord`, `ctx.prevScoreValue`, `ctx.currentPosition` (pozycja na serwerze), `ctx.bossName`, `ctx.globalPosition` (pozycja w rankingu globalnym — 0 jeśli brak)
   - **CustomIDs:** `ach_cat_{categoryKey}` (score/records/bosses/prestige/explorer) | `ach_overview` | `ach_check_player` | `ach_check_modal` | `ach_check_sel` | `ach_vc_{cat}_{userId}_{guildId}` | `ach_vo_{userId}_{guildId}` | `ach_vb`

8. **Ranking Osiągnięć** — przycisk `🏆 Ranking osiągnięć` w widoku osiągnięć (`/profile` → `🏆 Osiągnięcia`):
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

9. **Kamienie Milowe Unikalnych Graczy** — `milestoneService.js`:
   - Po każdym nowym rekordzie (`/update`, panel „Analizuj") sprawdza, czy globalna liczba unikatowych graczy przekroczyła kolejną pełną setkę (100, 200, 300…)
   - **Licznik graczy = `rankingService.getCountedPlayers()`** (patrz „Kanoniczny licznik graczy" niżej) — ten sam zbiór, który pokazuje stopka embeda admina po `/update`. Wcześniej milestone liczył **pliki** `wyniki/{userId}.json` (`getUniqueUserCount`, usunięte), przez co ogłaszał próg wcześniej niż inne miejsca: pliki historii zostają po graczach usuniętych z rankingu, a plik z pustą tablicą (po `removeEntriesAfter`) też był liczony
   - **Tanie sprawdzenie w typowym przypadku:** odczyt `ranking.json` per serwer; pełna historia (kto był tym graczem, na jakim serwerze) parsowana wyłącznie gdy próg faktycznie przekroczono (`getAllUsersFirstEntries` + `getUserEarliestGuildEntry`)
   - **Kolejkowanie sekwencyjne** (`_queue` — Promise chain) zapobiega podwójnemu ogłoszeniu tego samego progu przy dwóch niemal równoczesnych nowych rekordach
   - **3 poziomy uroczystości** wg reszty z dzielenia: pełne tysiące (`grand`, fioletowy, korona 👑) > pełne pięćsetki (`major`, pomarańczowy, 🎊) > zwykłe setki (`standard`, złoty, 🎉)
   - **Wykres przyrostu graczy** — identyczny co do treści z wykresem generowanym przez przycisk „Wykres przyrostu” w Centrum Dowodzenia (`_handlePanelPlayerGrowth`): jedna zbiorcza krzywa `generateGlobalPlayerGrowthChart` ze znacznikami serwerów (badge z tagiem/nazwą w miejscu, gdzie dany serwer dołączył), tytułem i podtytułem „X graczy · Y pobitych wyników". **Podtytuł i etykieta ostatniego punktu pokazują AKTUALNY licznik graczy, nie zaokrąglony próg** — wcześniej `displayTotal` = próg (np. „300"), więc wykres kłamał przy realnych 312 graczach na krzywej. Historia zasilająca krzywą jest zawężona do graczy z rankingu globalnego (`getAllUsersFirstEntries(allGuildIds, playerIds)`), żeby krzywa kończyła się na tej samej liczbie co licznik. **NIE** używa wariantu z podziałem krzywej na klany (`generatePerServerGrowthChart`/`generateGuildComparisonChart`). Dołączany do embeda przy KAŻDYM ogłoszeniu (co każde 100 graczy), niezależnie od poziomu progu. Renderowany raz na język (pol/eng) i buforowany w pamięci na czas wysyłki — treść tytułu/podtytułu jest wypalona w bitmapę, więc nie da się jej zlokalizować per-serwer bez ponownego renderu
   - Embed zawiera: tytuł zależny od poziomu, opis z liczbą pobitych rekordów, imieniem i serwerem gracza który jako pierwszy przekroczył próg (jeśli możliwy do ustalenia — `client.users.fetch`) oraz zaproszeniem do zapraszania zaprzyjaźnionych serwerów, avatar gracza jako thumbnail, stopkę. **Bez pól** (usunięte „Łącznie graczy" / „Następny próg" — te dane są już widoczne na wykresie)
   - Wysyłany na **wszystkie skonfigurowane serwery** (`guildConfigService.getAllConfiguredGuilds()`) na ich `allowedChannelId`, w pełni dwujęzyczny (`messages.js` — klucze `milestone*`)
   - **Persystencja:** `data/milestones.json` (`{ lastAnnounced }`) — przeżywa restart, zapobiega ponownemu ogłoszeniu już zaanonsowanego progu
   - **Bezpieczny start przy braku pliku stanu** (`_seedBaseline()`): gdy `data/milestones.json` nie istnieje (pierwsze uruchomienie funkcji lub reset pliku), `_lastAnnounced` NIE zaczyna od 0 — zamiast tego cicho ustawiany jest na aktualny pełny próg (bez wysyłki ogłoszenia). Bez tego pierwsze sprawdzenie po nowym rekordzie ogłaszałoby najwyższy pełny próg ≤ aktualnej liczby graczy jako "właśnie przekroczony", nawet gdy społeczność dawno go minęła (np. wysyłka "200 graczy" przy realnych 280 — dokładnie to się stało przy pierwszym wdrożeniu tej funkcji). Pierwsze realne ogłoszenie po starcie padnie dopiero przy faktycznym przekroczeniu kolejnego progu

6. **Panel Admina** — dostępny przez `/manage`:
   - **Usuń gracza z rankingu (admin):** modal wyszukiwania nicku → przefiltrowana lista → potwierdzenie → usunięcie z `ranking.json` + aktualizacja ról TOP + wyczyszczenie osiągnięć (`achievementService.clearUserAchievements` — kategorie `score`/`records`; `resetAllAchievements` gdy wybrano „Usuń z osiągnięciami”) + usunięcie wpisów historii wyników od aktualnego rekordu wzwyż (`scoreHistoryService.removeEntriesAfter`) + **usunięcie WSZYSTKICH rekordów bossów gracza na danym serwerze** (`bossRecordService.removeAllUserBossRecords`). Dotyczy tylko wybranego serwera (dane na innych serwerach bota nietknięte). Head Admin może usunąć gracza z **dowolnego serwera** (cross-server). Ta sama logika (włącznie z czyszczeniem rekordów bossów) w komendzie `/remove`.
   - **Usuń wynik (admin) — `🧹 Usuń wynik`:** usuwa POJEDYNCZY wpis z historii wyników gracza (`data/guilds/{guildId}/wyniki/{userId}.json`). Flow: modal wyszukiwania nicku → wybór gracza (StringSelectMenu) → lista **WSZYSTKICH** jego wyników z historii (najnowsze najpierw, 25/stronę z **paginacją** ◀️/▶️ gdy >25; etykieta = wynik, opis = data + boss) → potwierdzenie → usunięcie wpisu (`scoreHistoryService.removeEntryByTimestamp`). **Przeliczenie rankingu:** jeśli usuwany wpis był aktualnym rekordem gracza (`scoreValue >= ranking[userId].scoreValue`) → ranking ustawiany na najlepszy z POZOSTAŁYCH wpisów historii (`revertUserRecord`), a gdy brak innych — gracz usunięty z rankingu; w obu przypadkach aktualizacja ról TOP. **Cofa też rekord bossa:** jeśli usuwany wpis był rekordem swojego bossa (`scoreValue === boss_record.scoreValue`) → rekord bossa ustawiany na najlepszy POZOSTAŁY wpis historii z tym samym `bossName` (`bossRecordService.revertBossRecord`), a gdy brak — rekord bossa usuwany. **Cofa osiągnięcia zdobyte TYM wynikiem** — ale wyłącznie gdy usuwany wpis jest **ostatnim (najnowszym) w historii gracza** (`remaining.every(e => e.timestamp <= removed.timestamp)`): wtedy `achievementService.clearRecordAchievementsAfter()` kasuje osiągnięcia z `unlockedAt >= timestamp wpisu`, **z pominięciem kategorii `explorer`** (te biorą się z przeglądania rankingu, subskrypcji i wyszukiwania profili, więc nie mają związku z wynikiem), dekrementuje `recordCount` o 1 i cofa `lastRecordAt` do poprzedniego rekordu. Przy usuwaniu **starszego** wpisu osiągnięcia zostają nietknięte — cięcie po czasie zabrałoby wtedy osiągnięcia za późniejsze, legalne wyniki. Lista cofniętych osiągnięć trafia do potwierdzenia i do logu. Head Admin szuka cross-server, Admin tylko swój serwer. Dostępne też w Centrum Dowodzenia (`_buildUsersRow`).
   - **Odblokuj gracza (admin):** modal wyszukiwania nicku → przefiltrowana lista → odblokowanie. Persistencja: `data/user_blocks.json`. Jeśli blokada pochodzi od Head Admina (`blockedByHeadAdmin: true`) — zwykły Admin nie może odblokować.
   - **Zablokuj gracza (head admin):** modal wyszukiwania nicku cross-server → lista graczy → potwierdzenie → modal czasu blokady. Blokada zapisywana z flagą `blockedByHeadAdmin: true`.
   - **Zużycie tokenów (admin/head admin):** embed ze statystykami AI per serwer. Admin = swój serwer, Head Admin = wszystkie + breakdown
   - **AI OCR on/off (head admin):** modal wyszukiwania nazwy serwera → jeśli 1 wynik: bezpośrednio toggle, jeśli wiele: lista → toggle per komenda. Stan w `guild_configs.json` przez `OcrBlockService`
   - **Ustaw limity (head admin):** modal z 2 polami — cooldown (np. `5m`, `1h`) i limit dzienny (liczba). Persistencja: `data/usage_limits.json`, `data/update_cooldowns.json`
   - **Wyślij Info (head admin):** modal → podgląd PL+ENG → wyślij na wszystkie serwery. `_infoSessions` Map (RAM)
   - **Zbanuj serwer (head admin):** **lista wszystkich serwerów bota** (25/stronę, przyciski zakresów liter `panel_ban_page_` + `◀️/▶️`) → potwierdzenie → bot wychodzi z serwera + ID zapisywane w `data/banned_guilds.json`. Odblokowanie przez listę zbanowanych. Check w `guildCreate` — bot natychmiast wychodzi, jeśli serwer jest na liście. `GuildBanService`.
     - **⚠️ Wcześniej był tu modal z wyszukiwarką po fragmencie nazwy** — trzeba było znać nazwę, a wyniki i tak lądowały w `slice(0, 25)`. Lista pokazuje komplet i przewija się alfabetycznie tą samą normalizacją co `/challenge` (`_buildRangeButtons`, `_compareSortNames`)
     - Źródłem jest `client.guilds.cache`, **nie** `config.getAllGuilds()` — zbanować da się także serwer, którego nikt nie skonfigurował (a zwykle właśnie takie się banuje). Serwery już zbanowane są odfiltrowane
   - **Pokaż serwery (head admin, `panel_guild_list`):** lista **wszystkich** serwerów bota — 10/stronę (`◀️/▶️`), nazwa + ID + liczba członków, znacznik `⚙️` skonfigurowany / `⚪` nieskonfigurowany, w nagłówku sumy. Też z `client.guilds.cache`, bo `config.getAllGuilds()` zna wyłącznie serwery z zapisaną konfiguracją i nie odpowiada na pytanie „gdzie właściwie siedzi bot".
   - **Usuń dane serwera (head admin):** lista skonfigurowanych serwerów, na których bota już nie ma (`configured=true` ale `!guilds.cache.has(guildId)`) → potwierdzenie → usuwa `data/guilds/{guildId}/` + wpis z `guild_configs.json`. Operacja nieodwracalna.
   - **Automatyczna retencja konfiguracji (30 dni)** — `guildDataRetentionService.js`: `guildDelete` zapisuje serwer do `data/pending_guild_deletions.json` (z nazwą, językiem i timestampem); sweep przy starcie + co 12 h usuwa po 30 dniach **WYŁĄCZNIE konfigurację serwera**: wpis w `guild_configs.json` + `data/guilds/{guildId}/role_rankings.json`. **Dane graczy zostają** (`ranking.json`, `wyniki/`, `achievements.json`, rekordy bossów) — należą do użytkowników i tylko oni decydują o ich usunięciu (autonomia; zasilają też profil/wykresy cross-server). **`data/token_usage.json` również nietykane** — statystyki tokenów AI do celów rozliczeniowych/statystycznych (sekcja 7 polityki prywatności). `guildCreate` anuluje oczekujące usunięcie (bot wrócił); sweep też anuluje wpisy serwerów obecnych w cache (osierocone przy downtime). Po faktycznym usunięciu — powiadomienie na kanał logów serwerowych (`sendAdminNotification`, ping do head admina) z listą co usunięto/zachowano, w języku zapamiętanym przy `guildDelete`. Błąd usuwania nie kasuje wpisu — retry przy kolejnym przebiegu. UWAGA: zakres CELOWO węższy niż panelowy przycisk „Usuń dane serwera" (który kasuje cały `data/guilds/{guildId}/`). Zgodne z deklaracją w polityce prywatności (endersecho.thashar.dev/privacy).
   - **Konfiguracja bossów (head admin):** zarządzaj angielskimi nazwami bossów i ich aliasami w innych językach — patrz sekcja poniżej.
   - **Centrum Dowodzenia (head admin):** panel 8 embedów na dedykowanym kanale z 4 rzędami przycisków akcji, aktualizowany automatycznie po każdej analizie OCR i akcji admina — patrz sekcja poniżej.

**Komendy slash (KOMPLETNA lista rejestrowana w `getSlashCommands()`):** `/challenge`, `/configure`, `/help`, `/manage`, `/profile`, `/ranking`, `/test`, `/update`

**⚠️ Wszystko dla gracza siedzi w `/profile`** — osobnych komend `/achievements`, `/subscribe` ani `/profiles` **NIE MA** (osiągnięcia = zakładka `🏆 Osiągnięcia`, subskrypcje = przycisk `🔔 Subskrypcje`, profile = `➕ Dodaj profil` / `👥 Moje profile`). W `handleCommand` zostały martwe `case 'achievements'` i `case 'subscribe'` — nigdy nie zostaną wywołane, bo te komendy nie są rejestrowane. **Nie odwołuj się do nich w komunikatach dla graczy.**

**`/help`** — publiczna komenda (ephemeral), działa też na serwerach bez konfiguracji. Embed z linkiem do strony `https://endersecho.thashar.dev/`, sekcją "Dokumenty" (polityka prywatności `/privacy`, regulamin `/terms` — wymóg Sekcji 5(a) Warunków Discorda) i linkiem do serwera pomocy.

**Panel Admina** — dostępny przez `/manage`:
- Dostęp: Administrator Discord
- **Układ rzędów — Główny panel (Admin i Head Admin):**
  - Rząd 1: `👥 Zarządzaj użytkownikami`, `🖥️ Zarządzaj serwerem`, `📊 Statystyki` (szare)
  - Rząd 2 (tylko Head Admin): `📢 Wyślij Info`, `📡 Centrum Dowodzenia`
- **Sub-panel "Zarządzaj użytkownikami" (Admin):**
  - Rząd 1: `🗑️ Usuń gracza z rankingu`, `🧹 Usuń wynik`, `🔓 Odblokuj gracza`, `◀️ Wróć`
- **Sub-panel "Zarządzaj użytkownikami" (Head Admin):**
  - Rząd 1: `🔒 Zablokuj gracza`, `🔓 Odblokuj gracza`, `🗑️ Usuń gracza z rankingu`, `🧹 Usuń wynik`
  - Rząd 2: `🏆 Usuń osiągnięcia`, `◀️ Wróć`
- **Sub-panel "Zarządzaj serwerem" (Admin):**
  - Rząd 1: `🔁 Przetwórz role`, `◀️ Wróć`
- **Sub-panel "Zarządzaj serwerem" (Head Admin):**
  - Rząd 1: `🔄 AI OCR`, `⚙️ Ustaw limity`, `🧪 Testerzy`, `📅 Interwał TOP10`, `🔁 Przetwórz role`
  - Rząd 2: `🎯 Konfiguracja bossów`, `📋 Pokaż serwery`, `🚫 Zbanuj serwer`, `🗑️ Usuń dane serwera`, `◀️ Wróć`
- **Sub-panel "Statystyki" (Admin):**
  - Rząd 1: `📊 Zużycie tokenów`, `🔢 Użycia komend`, `◀️ Wróć`
- **Sub-panel "Statystyki" (Head Admin):**
  - Rząd 1: `📊 Zużycie tokenów`, `⚠️ Nieskonfigurowane`, `📈 Przyrost graczy`, `🎯 Success Rate`, `◀️ Wróć`
  - Rząd 2: `🔢 Użycia komend`
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
| `panel_back` | Wróć do głównego panelu (z dowolnej operacji) |
| `panel_back_configure` | Wróć do wizarda /configure (pokazywany tylko gdy sesja wizarda aktywna) |
| `panel_cat_users` | Otwórz sub-panel "Zarządzaj użytkownikami" |
| `panel_cat_server` | Otwórz sub-panel "Zarządzaj serwerem" |
| `panel_cat_stats` | Otwórz sub-panel "Statystyki" |
| `panel_ocr_stats` | Wyświetl globalny Success Rate + licznik interwencji admina (Fail) |
| `panel_ocr_stats_reset` | Potwierdź reset resetowalnych liczników (success + fail) |
| `panel_ocr_stats_reset_ok` | Wykonaj reset resetowalnych liczników |
| `panel_remove` | Otwórz modal wyszukiwania gracza |
| `panel_remove_search_modal` | Modal wyszukiwania (pole `remove_query`) |
| `panel_remove_select` | StringSelectMenu — wybór gracza z wyników |
| `panel_remove_score` | Otwórz modal wyszukiwania gracza (Usuń wynik z historii) |
| `panel_remove_score_search_modal` | Modal wyszukiwania (pole `remove_score_query`) |
| `panel_remove_score_player` | StringSelectMenu — wybór gracza (value `userId:guildId`) |
| `panel_remove_score_entry` | StringSelectMenu — wybór wyniku z historii (value `userId:guildId:tsMs`) |
| `panel_remove_score_page_{userId}:{guildId}:{page}` | Paginacja listy wyników (◀️/▶️) |
| `panel_remove_score_confirm_{userId}:{guildId}:{tsMs}` | Potwierdzenie usunięcia wyniku + przeliczenie rankingu + cofnięcie rekordu bossa |
| `panel_remove_confirm_{userId}` | Potwierdzenie usunięcia |
| `panel_unblock` | Jeśli brak zablokowanych: info; inaczej modal wyszukiwania |
| `panel_unblock_search_modal` | Modal wyszukiwania (pole `unblock_query`) |
| `panel_unblock_select` | StringSelectMenu — wybór do odblokowania |
| `panel_tokens` | Pokaż statystyki tokenów |
| `panel_process_roles` | Pełny reset ról TOP: usuń wszystkie → przyznaj wg aktualnego rankingu (admin + head admin) |
| `panel_cmd_center` | Otwórz widok Centrum Dowodzenia — info o kanale + przycisk Odśwież (head admin) |
| `panel_cmd_center_refresh` | Wymuś natychmiastowy refresh panelu Centrum Dowodzenia (head admin) |
| `cc_refresh` | Odśwież wiadomość panelu (panel message → ephemeral) |
| `cc_action_unblock` | Odblokuj gracza — modal wyszukiwania lub info "brak zablokowanych" (ephemeral) |
| `cc_action_roles` | Przetwórz role TOP — **wybór serwera** (`cc_roles_sel`, paginacja `cc_roles_pg_{n}`), potem `_handlePanelProcessRoles(interaction, guildId)` na WYBRANYM serwerze. Head admin widzi wszystkie skonfigurowane serwery, zwykły admin tylko swój |
| `cc_unconf_kick` | Kicknij bota z serwera — select nieskonfigurowanych (`cc_kick_sel`, paginacja `cc_kick_pg_{n}`) → potwierdzenie `cc_kick_ok_{guildId}` / `cc_kick_no` → `guild.leave()`. Dane serwera zostają nietknięte |
| `cfg_ocr_en_{guildId}` | „🔓 Włącz OCR /update" pod powiadomieniem o konfiguracji serwera na kanale logów head admina — `ocrBlockService.unblock(guildId, ['update'])`, info na kanał bota tego serwera, przycisk zamienia się na wyszarzone potwierdzenie z nickiem klikającego. **Wyzwala też ogłoszenie nowego serwera** (`_maybeAnnounceNewServer`), o ile jeszcze nie poszło |
| `cc_action_tester` | Zarządzaj testerami — lista + przyciski Dodaj/Usuń (ephemeral) |
| `cc_bcr_refresh` | Odśwież przyciski pod wszystkimi ogłoszeniami globalnymi (head admin, ephemeral) — patrz sekcja „Zbiorcze liczniki reakcji" |
| `cc_action_tokens` | Zużycie tokenów globalnie (ephemeral, head admin) |
| `cc_action_cmd_usage` | Użycia komend globalnie (ephemeral, head admin) |
| `cc_action_ocr_stats` | Success Rate z licznikami (w tym „🔁 Wzorzec OK za 2. razem" — % podwójnych weryfikacji wzorca zaliczonych za drugim razem) + przycisk reset (ephemeral, head admin) |
| `panel_info` | Otwórz modal /info (head admin) |
| `panel_tester` | Pokaż listę testerów + przyciski Dodaj/Usuń (head admin) |
| `panel_tester_add` | Otwórz modal wpisania ID użytkownika |
| `panel_tester_add_modal` | Modal dodawania (pole `tester_user_id`) |
| `panel_tester_remove` | Pokaż StringSelectMenu z testerami |
| `panel_tester_remove_select` | StringSelectMenu — wybór testera do usunięcia |
| `panel_diagnostics` | Raport uprawnień bota: serwer, kanał bota, realny test dostarczenia `/info` (embed próbny wysyłany i kasowany), kanały raportów, hierarchia ról TOP, intenty — dostępny w `/configure` gdy wszystkie kroki ukończone (każdy admin) |
| `panel_player_growth` | Statystyki przyrostu unikalnych graczy globalnie + wykres (head admin, ephemeral) |
| `panel_cmd_usage` | Użycia komend — admin widzi swój serwer, head admin globalnie; dane w `data/command_usage.json` |
| `panel_ban_server` | Panel zbanowania serwera (head admin) |
| `panel_ban_guild` | Lista serwerów do zbanowania (25/stronę) |
| `panel_ban_page_{offset}` | Strona listy serwerów do zbanowania (zakresy liter + `◀️/▶️`) |
| `panel_guild_list` / `panel_guild_list_{page}` | Lista wszystkich serwerów bota (10/stronę) |
| `panel_ban_guild_sel` | StringSelectMenu — wybór serwera z listy |
| `panel_ban_guild_ok_{guildId}` | Potwierdź ban serwera |
| `panel_unban_guild` | Lista zbanowanych serwerów |
| `panel_unban_guild_sel` | StringSelectMenu — wybór serwera do odbanowania |
| `panel_delete_server_data` | Panel usuwania danych serwera (head admin) — lista skonfigurowanych serwerów bez bota |
| `panel_delete_server_sel` | StringSelectMenu — wybór serwera do usunięcia danych |
| `panel_delete_server_ok_{guildId}` | Potwierdź usunięcie danych serwera |
| `panel_ach_del` | Otwórz modal wyszukiwania gracza (head admin) |
| `panel_ach_del_modal` | Modal wyszukiwania (pole `ach_del_query`) |
| `panel_ach_del_ps` | StringSelectMenu — wybór gracza (zakłada sesję `_achDelSessions`) |
| `panel_ach_del_as` | StringSelectMenu **wielokrotnego wyboru** — zaznacz jedno lub kilka osiągnięć do usunięcia |
| `panel_ach_del_q` | Otwórz modal filtra osiągnięć (szuka po nazwie **polskiej i angielskiej** oraz po ID) |
| `panel_ach_del_q_modal` | Modal filtra (pole `ach_del_name`) |
| `panel_ach_del_clear` | Wyczyść filtr i pokaż pełną listę (wraca na stronę 1) |
| `panel_ach_del_pg_prev` / `panel_ach_del_pg_next` | Paginacja listy osiągnięć (25/stronę) |
| `panel_ach_del_pg_info` | Wskaźnik strony `X/Y` (disabled) |
| `panel_ach_del_back` | Powrót do listy osiągnięć (z potwierdzenia lub po usunięciu) |
| `panel_ach_ok_n` | Potwierdzenie usunięcia **zaznaczonych** osiągnięć (lista ID w sesji, nie w customId) |
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
| `boss_cfg_set_img` | Przycisk "🖼️ Przypisz zdjęcie" — otwiera select bossów |
| `boss_cfg_img_boss_sel` | StringSelectMenu — wybrany boss → otwiera modal z polem na link do zdjęcia |
| `boss_cfg_img_modal` | Modal z linkiem do zdjęcia (Discord CDN) → pobranie i zapis pliku |
| `ranking_boss_list` | Przycisk "👾 Ranking Bossów" w widoku global ranking |
| `ranking_boss_sel` | StringSelectMenu — wybrany boss → pokazuje per-boss ranking globalny |
| `ranking_boss_srv_{guildId}` | Przycisk "👾 Ranking bossów {nazwa serwera}" w widoku rankingu serwera → lista bossów tego serwera |
| `ranking_boss_ssel_{guildId}` | StringSelectMenu — wybrany boss → per-boss ranking zawężony do tego serwera |

**9. System aliasów bossów** — `services/bossAliasService.js` + `data/boss_aliases.json`:
- **Cel:** Normalizacja nazw bossów z różnych języków → jedna angielska nazwa (np. "Robak" PL → "Shardstone Bug" EN = jeden boss w osiągnięciach).
- **Pliki:** `services/bossAliasService.js`, `data/boss_aliases.json`, `config/bossNames.js` (`correctBossNameFull`)
- **Inicjalizacja:** plik `data/boss_aliases.json` jest jedynym źródłem prawdy — brak hardcodowanych nazw. Przy starcie bot wczytuje dane z pliku; jeśli nie istnieje → pusta lista.
- **Backward compat:** stare pliki JSON przechowujące nazwy jako klucze `aliases{}` (z dawnego `initFromBaseNames`) są rozpoznawane przez `getExtraEnglishNames()` zwracające sumę `englishNames[]` + `Object.keys(aliases{})`.
- **Obsługiwane języki:** pl, de, fr, es, pt, ru, it, tr, ja, zh, vi, ko (select menu w UI)
- **Konfiguracja bossów (head admin):** `/manage` → 🎯 Konfiguracja bossów — dwa rzędy przycisków:
  - **Rząd 1 (boss):** ➕ Dodaj bossa · 🗑️ Usuń bossa · ✏️ Edytuj bossa · 🖼️ Przypisz zdjęcie
  - **Rząd 2 (alias):** ➕ Dodaj alias · 🗑️ Usuń alias · ✏️ Edytuj alias
  - Embed z listą wszystkich bossów (angielskie nazwy) + ich aliasami per język
  - **➕ Nowy boss (EN):** modal → dodaje custom boss poza KNOWN_BOSS_NAMES → `englishNames[]` w JSON
  - **🔤 Dodaj alias:** boss select → modal (alias) → language select → zapis do `aliases` + **automatyczna migracja boss_records** (surowa nazwa → angielska, zachowując lepszy wynik)
  - **🗑️ Usuń alias:** boss select → alias select → usunięcie
  - **🖼️ Przypisz zdjęcie:** boss select → modal z linkiem do zdjęcia (wrzuconego wcześniej na Discorda) → walidacja rozszerzenia z URL (jpg/jpeg/png/gif/webp) → `downloadBuffer` (HTTPS, host Discord CDN, limit 25 MB) → zapis do `data/boss_images/{bossName}.{ext}` → ścieżka w `boss_aliases.json` jako `images["BossEN"]`
  - Sesje robocze: `_bossCfgSessions` Map (RAM, per userId) — przechowuje `pendingBoss` między selectem a modalem (nazwa bossa nie mieści się w customId, limit 100 znaków)
- **Wykrywanie nieznanej nazwy:** `correctBossNameFull(raw, bossAliasService)` zwraca `{ corrected, wasUnknown }`. Gdy `wasUnknown=true` i wynik OCR jest prawidłowy: `_runUpdateFlow` wywołuje `_sendUnknownBossEmbed` (await, zwraca `sessionKey`).
- **Embed nieznanego bossa (czerwony):** wysyłany na `ENDERSECHO_SERVER_LOG_CHANNEL_ID`. Zawiera: nazwę bossa (OCR), gracza (link Discord), komendę, serwer, screenshot. Przycisk: 🔗 Dopasuj do nazwy angielskiej (`boss_mapm_{sessionKey}`). Po dodaniu aliasu przycisk staje się **nieaktywny** (disabled), a w ogłoszeniu rekordu pojawia się notka z imieniem admina.
- **Flow mapowania (po kliknięciu przycisku):**
  1. Modal z oryginalną nazwą (edytowalna, fallback z pola embeda gdy sesja wygasła po restarcie) → `boss_map_boss_modal`
  2. Select angielskiej nazwy bossa → `boss_map_boss_sel`
  3. Select języka → `boss_map_lang_sel` → zapis aliasu + dezaktywacja przycisku w embedzie + notka w ogłoszeniu + **automatyczna migracja boss_records** + potwierdzenie
  - Sesje: `_unknownBossEmbeds` Map (sessionKey → `{ rawBoss, guildId, userId, messageId, channelId, publicMsgId?, publicChannelId? }`, TTL 48h) + `_bossMapSessions` Map (userId → dane robocze)
- **Normalizacja w OCR:** `aiOcrService.parseAIResponse` używa `correctBossNameFull(rawBoss, this.bossAliasService)`. Jeśli alias dopasowany → wraca angielska nazwa. Jeśli nie → wraca surowa nazwa + `wasUnknownBoss: true`.
- **Osiągnięcia:** `bossesEncountered` w achievementService przechowuje znormalizowaną (angielską) nazwę → "Robak PL" i "Shardstone Bug EN" to ten sam boss.
- **Persistencja:** `data/boss_aliases.json`: `{ englishNames: [], aliases: { "BossEN": { "pl": ["Alias PL"] } }, images: { "BossEN": "filename.png" } }`. Przeżywa restart bota.
- **Env:** `ENDERSECHO_SERVER_LOG_CHANNEL_ID`

**10. Per-boss rekordy + Ranking Bossów** — `services/bossRecordService.js` + `data/guilds/{guildId}/boss_records.json`:
- **Cel:** Śledzenie najlepszego wyniku każdego gracza per boss (niezależnie od ogólnego rekordu).
- **Zapis:** Przy każdym udanym OCR (`_runUpdateFlow`, bez `dryRun`) → `bossRecordService.updateBossRecord(guildId, userId, bossName, ...)`. Jeśli boss nieznany → zapisuje pod surową nazwą OCR.
- **Migracja:** Gdy admin doda alias przez `boss_cfg_add_lang_sel` lub `boss_map_lang_sel` → automatyczna `migrateBossName(rawName, englishName, allGuildIds)` (fire-and-forget). Zachowuje lepszy wynik jeśli gracz ma rekordy pod obiema nazwami.
- **Cofanie:** `_cvRemoveRecord` cofa per-boss rekord (`revertBossRecord`) po cofnięciu rekordu ogólnego + osiągnięć. Sesje CV i `_ocrRevertSessions` przechowują `bossName` + `previousBossRecord`.
- **Duplikat cross-server, ale pobity rekord bossa:** gdy gracz wrzuca wynik na innym serwerze niż ten z jego najlepszym wynikiem globalnym i wynik jest ŚCIŚLE gorszy niż globalny best (duplikat cross-server, `_prevGlobalUser.scoreValue > _newScoreValue`), ale **pobija jego rekord bossa** (sprawdzane globalnie przez `getUserBossRecordsAllGuilds`) → rekord bossa jest zapisywany na **POPRZEDNIM serwerze gracza** (`_prevGlobalUser.sourceGuildId`, dane NIE przenoszą się na nowy serwer) i publikowane jest ogłoszenie (stos embedów bez Embedu 2). Embed 4 zawiera pole `crossServerBossKeptField/Value` (najlepszy wynik pozostaje na poprzednim serwerze). Sesja `_ocrRevertSessions` keyed na poprzedni serwer (`skipGlobalRevert: true`, `previousBossRecord` = stan serwera A z `updateBossRecord`). Gdy rekord bossa NIE pobity → standardowy komunikat duplikatu cross-server (bez zapisu, `resultNotBeatenCrossServer`).
- **Dokładne wyrównanie wyniku cross-server (migracja wpisu):** gdy nowy wynik jest RÓWNY (nie gorszy, nie lepszy) dotychczasowemu globalnemu bestowi gracza na innym serwerze — NIE wchodzi do bloku duplikatu (ten sprawdza tylko `>`) i leci normalną ścieżką `updateUserRanking`. Ponieważ nowy serwer nie ma jeszcze wpisu gracza, zapis traktowany jest jak zwykły nowy rekord (pełny stos 4 embedów, osiągnięcia, role TOP). Dodatkowo `isCrossServerTieMigration` wymusza `rankingService.removePlayerFromRanking(userId, poprzedniServerId)` — bez tego `_removeWeakerScoresFromOtherGuilds` (porównanie `<`) NIE usunąłby wpisu przy dokładnej remisie, zostawiając gracza zdublowanego na obu serwerach. Embed 4 pokazuje `crossServerMigratedNote` (opis: „Wynik został zmigrowany" + stary/nowy serwer, BEZ prefiksu `systemInfoAllGood`). Stary serwer trafia też do `affectedGuildIds` → jego role TOP są przeliczane. Historia wyników (`wyniki/{userId}.json`) zostaje osobno na obu serwerach — wykres pokazuje oba wpisy, otagowane nazwą/tagiem odpowiedniego serwera.
- **Logika akceptacji OCR (3 przypadki):**
  - **Boss rozpoznany + pobito rekord bossa** (bez globalnego) → zielony embed `0x00b894` z polem `bossRecordUpdated`; rekord per-boss zapisany
  - **Boss nierozpoznany + brak globalnego** → `rankingService.createNoRecordEmbeds` (kolor `0xFEE75C`) z komunikatem `unknownBossAccepted` w Embedzie 2; wynik zapamiętany pod surową nazwą do weryfikacji admina
  - **Boss rozpoznany + brak globalnego + brak rekordu bossa** → standardowy odrzut (`rankingService.createNoRecordEmbeds`, kolor orange) — w Szczegółach wyniku, obok `resultNotBeaten` (to rekord **globalny**, często z zupełnie innego bossa), leci też linia o rekordzie **tego** bossa z `previousBossRecord`: `resultBossRecordSame` gdy wrzucony wynik jest identyczny z zapisanym rekordem bossa, w przeciwnym razie `resultBossRecordCurrent` (wynik + data). Bez tego wrzucenie po raz drugi tego samego wyniku z bossa wyglądało, jakby nic dla tego bossa nie było zapisane. Linia pomijana, gdy `previousBossRecord` jest puste (błąd `bossRecordService`)
  - Warunek odrzucenia: `!isNewRecord && !wasUnknownBoss && !isNewBossRecord`
- **Embed rekordu:** Pole `🎯 Rekord na bossie` (msgs.bossRecordField) pokazywane gdy `isNewBossRecord = true`, PRZED polem osiągnięć. Dla pobitego rekordu bossa bez globalnego — pole `🎯 Nowy rekord na bossie` (msgs.bossRecordUpdated) w zielonym embedzie.
- **Struktura danych:** `data/guilds/{guildId}/boss_records.json` = `{ userId: { bossName: { score, scoreValue, timestamp, username } } }`. Write queue per-guild (`_enqueue`).
- **Ranking Bossów (globalny):**
  - Przycisk `👾 Ranking Bossów` w widoku Global rankingu → `_handleRankingBossList(interaction)` → StringSelectMenu `ranking_boss_sel` z bossami mającymi ≥1 rekord (filtruje do znanych angielskich nazw)
  - Wybór bossa → `_handleRankingBossShow(interaction)` → globalny ranking per-boss embed (`createBossRankingEmbed`, kolor blurple `0x5865F2`) z thumbnail zdjęcia bossa (jeśli ustawione)
  - Paginacja: `ranking_prev/next/mypos` (te same przyciski co standardowy ranking; routing przez `_bossRankings.has(messageId)`)
  - Stan paginacji: `_bossRankings` Map (RAM, per messageId). **Wpis kasowany przy wyjściu z rankingu bossa** (`_handleRankingSelect`, `_handleRoleRankingSelect`, `_handleGuildRankingSelect`, `_handleRankingBack`) — bez tego routing paginacji (`_bossRankings.has(messageId)` sprawdzane PRZED `getActiveRanking`) po powrocie do rankingu serwera/global dalej przerysowywałby ranking bossa
  - Powrót: przyciski `📋 Lista bossów` i `🌐 Global` w `createBossRankingButtons`
- **Ranking Bossów per SERWER:**
  - Przycisk `👾 Ranking bossów {nazwa serwera}` (`ranking_boss_srv_{guildId}`) w rzędzie 2 widoku rankingu serwera → ta sama metoda `_handleRankingBossList(interaction, guildId)`, ale lista bossów liczona z **jednego** serwera (`getBossesWithRecords([guildId], …)`)
  - Wybór bossa → StringSelectMenu `ranking_boss_ssel_{guildId}` → `_handleRankingBossShow(interaction, guildId)` → ranking zawężony do serwera (`getGlobalBossRanking([guildId], boss)`); embed **złoty** (`0xF1C40F`, jak ranking serwera), tytuł `👾 Ranking — {boss}` (**bez nazwy serwera** — zakres widać po kolorze, przycisku powrotu i nagłówku statystyk), bez tagu serwera przy wpisach (wszystkie z tego samego serwera), nagłówek statystyk `📊 Statystyki` zamiast `📊 Statystyki globalne`
  - Wykres progresu graczy budowany wyłącznie z historii tego serwera (`_buildBossRankingChartAttachment` dostaje `[guildId]`)
  - Nawigacja: `📋 Lista bossów` wraca do listy tego samego zakresu (serwerowej albo globalnej), ostatni przycisk to `↩️ {nazwa serwera}` (powrót do rankingu serwera) zamiast `🌐 Global`
  - Zakres (`srvGuildId`, `guildName`, `allGuildIds`) trzymany w `_bossRankings` — paginacja nie gubi kontekstu serwera
  - Wspólna implementacja z rankingiem globalnym: jedyna różnica to lista ID serwerów przekazana do `bossRecordService`
- **Zdjęcia bossów:** Plik zapisywany w `data/boss_images/{safeName}.{ext}`. Ścieżka (tylko `{safeName}.{ext}`) przechowywana w `boss_aliases.json` jako `images["BossEN"]`. Używane jako thumbnail w `createBossRankingEmbed` (AttachmentBuilder + `attachment://filename`).
- **Filtrowanie rankingów:** `getBossesWithRecords(allGuildIds, knownEnglishNames)` — pokazuje TYLKO bossów z angielską nazwą (admin musi zmapować alias). Nieznane surowe nazwy niewidoczne w UI dopóki nie zostają zmapowane.

**Komenda /profile** — profil gracza (kanał bota):
- Wyświetla pełny profil gracza w 3 zakładkach (1 wiadomość ephemeral z przyciskami nawigacji)
- Opcjonalny parametr `gracz` — fragment nicku do wyszukania; puste = własny profil
- **Zakładka 👤 Profil (main):** rekord serwera (#pozycja / total), pozycja globalna, rola TOP, najlepszy wynik (score + boss + data), wycinek globalnego rankingu (gracz ±1), rankingi ról; na cudzym profilu dołącza pole 🔔 Obserwatorzy (liczba subskrybentów)
- **Zakładka 🎯 Bossowie:** lista WSZYSTKICH znanych bossów (z `bossAliasService.getExtraEnglishNames()`), posortowana alfabetycznie, 15/stronę; ✅ z rekordem (score + data), — bez rekordu; paginacja gdy >15
- **Zakładka 🏆 Osiągnięcia:** używa `achievementService.buildAchievementsViewGlobal/ForUserGlobal` — dane mergowane ze WSZYSTKICH serwerów; własny profil — z opisami osiągnięć; cudzy — bez opisów
- **Szukaj gracza (🔍):** otwiera modal → wyszukiwanie cross-server w globalRanking → 1 trafienie: od razu profil; wiele: StringSelectMenu
- **Zakładka ⚔️ Wyzwania:** bilans, wyzwania w toku i historia pojedynków — patrz sekcja „System Wyzwań 1 vs 1 (`/challenge`)" niżej
- **Własny profil — Rząd 1:** Profil | Bossowie | Osiągnięcia | ⚔️ Wyzwania | 🔔 Subskrypcje (**`🔍 Szukaj gracza` zeszło do rzędu narzędzi** — rząd 1 mieści 5 przycisków)
- **Własny profil — Rząd profili (zawsze):** przyciski profili `🏠 Main` | `② …` | `③ …` (`profile_view_{index}`, aktualnie oglądany Primary + disabled) **tylko gdy gracz ma >1 profil**, dalej `📌 Śledź ten profil` / `📌 Śledzony` (`profile_track`, Success + disabled gdy już śledzony — też tylko przy >1 profilu), a na końcu `👥 Moje profile` (`profile_manage_prof`). **Gracz z jednym profilem widzi w tym rzędzie wyłącznie `➕ Dodaj profil`** (`profile_add_intro`, Success) — panel dochodzi od drugiego profilu
  - **Układ rzędu:** narzędzia (`profile_track`, `profile_manage_prof`) zawsze na końcu **ostatniego** rzędu; przy podniesionym `ENDERSECHO_MAX_PROFILES` nadmiar przycisków profili przechodzi do rzędu wyżej (chunkowanie po 5), więc żaden rząd nie przekracza limitu Discorda
  - Kliknięcie `profile_track` zapisuje wybór w `profiles.json` (`setActive`), wysyła ephemeral potwierdzenie i przerysowuje przyciski. Na cudzym profilu rzędu profili nie ma wcale
- **Pole 👥 Profile tego gracza** w zakładce Profil — lista profili z wynikami, `📌` przy śledzonym
- **Cudzy profil — Rząd 1:** Profil | Bossowie | Osiągnięcia | ⚔️ Wyzwania | Szukaj gracza. **Rząd 2:** ◀️ Wróć do siebie (Danger, pierwszy) | 🔔 Subskrybuj / 🔕 Odsubskrybuj (ostatni, zmienia się po kliknięciu)
- **Stan sesji:** `_profileStates` Map (messageId → state), TTL 15 min; pola: `viewerId, targetPlayerKey, targetGuildId, lang, view, category, bossPage, bossMaxPage, chalPage, chalMaxPage, cachedData, isSubscribed, subscriberCount` (**`targetPlayerKey`, nie `targetUserId`** — widok dotyczy konkretnego profilu)
- **Dane per-boss:** `bossRecordService.getUserBossRecordsAllGuilds(allGuildIds, userId)` — merge najlepszych wyników ze wszystkich serwerów
- **CustomIDs:** `profile_main` | `profile_bosses` | `profile_bosses_prev` | `profile_bosses_next` | `profile_ach_overview` | `profile_ach_cat_{key}` | `profile_search` | `profile_search_modal` | `profile_search_sel` | `profile_back` | `profile_manage_subs` | `profile_manage_prof` | `profile_add_intro` | `profile_subscribe` | `profile_unsubscribe` | `profile_view_{index}` | `profile_track` | `profile_challenges` | `profile_chal_prev` | `profile_chal_next` (wszystkie routowane przez whitelistę w `handleButtonInteraction` — nowy customId `profile_*` MUSI tam trafić, inaczej przycisk nie zadziała)
- **Serwis:** `services/profileService.js` — `collectData`, `buildMainEmbed(data, isPol, subscriberCount?)`, `buildBossesEmbed`, `buildProfileComponents`

**Komenda /configure** — wizard konfiguracji serwera (admin, dowolny kanał):
- 10-krokowy dashboard ephemeral z przyciskami szarymi→zielonymi po ukończeniu kroku
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
- **Krok 10:** Auto-reakcja (opcjonalne) — bot automatycznie dodaje wybrane emoji jako reakcję pod każdym publicznym ogłoszeniem pobitego rekordu po `/update` (stos 4 embedów, turkusowe ogłoszenie rekordu bossa bez globalnego, ogłoszenie cross-server rekordu bossa; NIE dotyczy `/test` dryRun ani panelu Analizuj):
  - Przy pierwszej konfiguracji krok można pominąć ("Pomiń") — pominięcie zalicza krok (auto-reakcja wyłączona)
  - Gdy wyłączona: przycisk "Włącz" (✅) → modal z polem emoji; gdy włączona: przyciski "Zmień emotkę" (✏️, ten sam modal z prefill) i "Wyłącz" (❌)
  - Modal (`cfg_autoreact_modal`, pole `cfg_autoreact_emoji_input`, max 64 znaki) akceptuje dokładnie jedno emoji — dwa typy:
    - **Systemowe emoji Discord** (standardowy Unicode) — walidacja `_isSingleStandardEmoji()`: piktogramy (VS16 + odcienie skóry), flagi (pary regional indicators), keycapy (0️⃣ #️⃣), flagi tag-sequence (🏴󠁧󠁢󠁥󠁮󠁧󠁿), sekwencje ZWJ (👨‍👩‍👧)
    - **Emotki customowe** — pełny format `<:nazwa:id>`/`<a:nazwa:id>` (walidacja dostępu: `client.emojis.cache.has(id)` — emotka musi pochodzić z serwera, na którym jest bot) LUB sama nazwa `:nazwa:`/`nazwa` (lookup po nazwie: najpierw emotki bieżącego serwera, potem wszystkich serwerów bota; po znalezieniu zapisywana jako pełny format `found.toString()`)
    - Tekst, gołe cyfry, wiele emoji naraz i emotki niedostępne dla bota odrzucane z komunikatem ephemeral (PL/EN)
  - Stan wizarda: `autoReactionEmoji` (string|null) + `autoReactionDone` (bool) w RAM; persystencja w `guild_configs.json` jako `autoReactionEmoji` (null = wyłączona)
  - Dodawanie reakcji: `_addRecordAutoReaction(publicMsg, guildId)` — fire-and-forget po każdym `followUp` ogłoszenia rekordu w `_runUpdateFlow`; błąd reakcji tylko logowany (warn per-guild), nie przerywa flow
  - **Wymagane uprawnienia bota:** `AddReactions` (dodanie reakcji pod ogłoszeniem) + `UseExternalEmojis` (gdy emotka customowa pochodzi z innego serwera niż ten, na którym publikowane jest ogłoszenie); oba sprawdzane w Diagnostyce uprawnień (`panel_diagnostics`) — na poziomie serwera i kanału bota
  - customIDs: `cfg_step_10`, `cfg_autoreact_enable`, `cfg_autoreact_disable` (wyłącz/pomiń), `cfg_autoreact_modal`
- Zielony przycisk **✅ Zaakceptuj konfigurację!** pojawia się gdy wszystkie kroki ukończone; obok niego pojawia się wtedy też przycisk **🔍 Diagnostyka** (`panel_diagnostics`) — dostępny dla każdego administratora, sprawdza uprawnienia bota (serwer + kanał bota + rozgłoszenia `/info` + kanały raportów + hierarchia ról TOP + intenty). **Stan czytany jest z API, nie z cache**: `_buildDiagnosticsEmbed` jest `async` i pobiera membera bota (`guild.members.fetchMe({force:true})`), role (`guild.roles.fetch()`) oraz każdy kanał (`client.channels.fetch(id,{force:true})`). Powód: nakładki uprawnień odświeżają się zdarzeniem `channelUpdate`, które przychodzi tylko dla kanałów widocznych dla bota — po odebraniu **ViewChannel** zdarzenia milkną, w cache zostaje stara zielona wersja i diagnostyka pokazywała komplet ✅, podczas gdy realna wysyłka leciała na `Missing Access`.
  - **Wspólny resolver kanału `_pobierzKanalSerwera(client, guild, chId)`** — jedno źródło prawdy dla diagnostyki, `_handleInfoSend` i `_broadcastNewServerAnnouncement`. Dopóki każda z tych ścieżek liczyła kanał po swojemu, diagnostyka sprawdzała co innego, niż robiła wysyłka. Zwraca `{ch, powod}`, gdzie `powod` to `brak` / `niewidoczny` (50001) / `usuniety` (10003) / `obcy` (kanał o innym `guildId` — `channels.fetch` szuka GLOBALNIE po wszystkich serwerach bota, a `permissionsIn` na cudzym kanale daje wynik bez znaczenia, potrafiący wyjść zielony) / `nietekstowy` (kategoria, kanał głosowy, forum — przechodzą KAŻDY test uprawnień na zielono, a `.send()` na nich nie istnieje) / `blad`. `_opisProblemuKanalu(wynik)` tłumaczy `powod` na komunikat w formacie `_mapSendError` (`{pol, eng, fix_pol, fix_eng}`), więc raport `/info` i DM do właściciela podają realną przyczynę zamiast domyślnego „nadaj **Wyświetl kanał**".
  - **🧪 Realny test dostarczenia (`📨 Rozgłoszenia /info`)** — diagnostyka wysyła na kanał bota embed próbny i od razu go kasuje, czyli wykonuje DOKŁADNIE operację `/info`. Rachunek uprawnień liczony z nakładek to nie to samo, co zgoda Discorda (typ kanału, stan wątku, dostęp aplikacji do zasobu), więc ptaszek postawiony wyłącznie na jego podstawie potrafił kłamać — ten test nie ma jak. Błąd raportowany jest z kodem i treścią z API. W tej samej sekcji: czy serwer w ogóle jest na liście odbiorców (`config.getAllGuilds()`) — serwer bez ukończonego `/configure` był wcześniej pomijany przez `/info` po cichu.
  - **Uprawnienia zależne od funkcji nie są już zgłaszane jako błędy**, gdy funkcja jest wyłączona: `ManageRoles` (brak skonfigurowanych ról TOP), `AddReactions` (auto-reakcja wyłączona), `UseExternalEmojis` (auto-reakcja bez emotki customowej) → ℹ️ „brak, ale nieużywane" zamiast ❌. Wcześniej zapalały nagłówek „Wykryto problemy" przy komplecie sprawnych funkcji i przykrywały to, co naprawdę nie działa.
  - **Wątki:** dla wątku sprawdzane jest `SendMessagesInThreads` zamiast `SendMessages` (Discord sprawdza osobną flagę, a uprawnienia wątku liczy się z kanału-rodzica — `SendMessages` potrafi być zielone przy wysyłce lecącej na `Missing Access`) oraz stan `locked` (❌) i `archived` (ℹ️ — wysyłka odarchiwizuje).
  - **Obie ścieżki wywołania (`panel_diagnostics`, `cc_diag_sel`) robią `deferUpdate()` przed budowaniem embeda** — komplet odpytań API plus wiadomość próbna nie mieści się w 3-sekundowym oknie na odpowiedź (błąd `10062`).
  - W `_handleInfoSend` nieudana wysyłka loguje dodatkowo twarde fakty (`[/info] Diagnoza …`): `guildId` kanału kontra id serwera, typ kanału, czy da się na niego wysłać i pełną listę uprawnień bota. Serwer, z którego bota usunięto, nie znika już z raportu po cichu — trafia do niego jako błąd „Bota nie ma na tym serwerze".
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
- **Raporty:** wysyłane jednocześnie na **per-guild kanał** (`communityVerification.rejectedChannelId`) i **globalny kanał** (`ENDERSECHO_COMMUNITY_CHANNEL_ID`). Jeśli oba kanały mają to samo ID — wysyłana jest tylko jedna wiadomość (brak duplikatu). Embed zawiera: nick, serwer, boss, nowy/poprzedni wynik, liczbę zgłoszeń, link do zgłoszonej wiadomości (w polu embeda, nie w przycisku). Footer: `cv:{messageId}|uid:{userId}|gid:{guildId}`
- **Przyciski admina w raporcie:**
  - `cv_admin_approve_{messageId}` → **Zatwierdź**: odblokuj użytkownika + zaktualizuj embedy raportów (usuń przyciski, dodaj info o akcji)
  - `cv_admin_remove_{messageId}` → **Usuń rekord i osiągnięcia** (`_cvRemoveRecord`): przywróć poprzedni rekord (lub usuń wpis przez `revertUserRecord()`) + usuń wpisy historii wyników (`wyniki/{userId}.json`) od momentu zgłoszonego rekordu w górę (zgłoszony rekord A + wszystkie pobite po nim B, C — `scoreHistoryService.removeEntriesAfter(session.newRecord.timestamp)`, zwraca liczbę usuniętych) + cofnij **WSZYSTKIE** osiągnięcia odblokowane od momentu zgłoszonego rekordu (`achievementService.clearAchievementsAfter(timestamp, { removedRecordCount, previousRecord })` — osiągnięcia zdobyte WCZEŚNIEJ zostają, `recordCount` dekrementowany o liczbę usuniętych wpisów, `lastRecordAt/lastRecordBeatAt` cofnięte do poprzedniego rekordu) + odblokuj użytkownika
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
- Raport wysyłany do GLOBAL channel (`ENDERSECHO_REJECTED_CHANNEL_ID`) oraz opcjonalnie do per-guild kanału
- Footer globalnego raportu: `uid:{userId}|gid:{guildId}`
- Footer per-guild raportu: `ref:{globalMsgId}|uid:{userId}|gid:{guildId}`
- Gdy admin klika przycisk na per-guild embeddzie → globalny raport aktualizowany (pole akcji + usunięcie przycisków)
- Przycisk **Analizuj** (`ee_analyze_`) dostępny dla raportu `NOT_SIMILAR` — pobiera obraz z `embed.image.url` (CDN URL), nie z `message.attachments`; uruchamia pełny flow OCR i zapisuje wynik dla docelowego użytkownika. Obsługuje wszystkie 3 przypadki: nowy rekord globalny (złoty embed), nowy rekord bossa bez globalnego (teal embed 0x1ABC9C + publiczne ogłoszenie), brak rekordu (info). Aktualizuje też `bossRecordService` i osiągnięcia per-boss.
  - **Gdy analiza AI zawiedzie** (`!aiResult.isValidVictory || !aiResult.score`) — ephemeral z potwierdzeniem dla admina używa `rankingService.createNoRecordEmbeds` (patrz niżej). Wiadomość raportu (`origMsg`) nadal aktualizowana starym sposobem (`_buildActionEmbeds` + `analyzeResultFail` jako tekst pola akcji) — zmiana dotyczy WYŁĄCZNIE ephemerala admina.
- Przycisk **🚫 Zablokuj analizę admina** (`ee_analyze_block_{userId}_{guildId}` → `_handleAnalyzeBlock`) — head admin odbiera adminowi serwera możliwość ręcznego uratowania konkretnego screena:
  - **Tylko na kopii GLOBALNEJ** raportu (`buildButtons(isGlobal)`) i **tylko przy `NOT_SIMILAR`** — na kopii serwerowej byłby wyłącznikiem samego siebie, a przy pozostałych powodach nie ma przycisku „Analizuj", więc nie ma czego blokować
  - Kliknięcie **wyłącza** przycisk `ee_analyze_*` na kopii serwerowej — **etykieta zostaje bez zmian** („Analizuj"), zmienia się wyłącznie aktywność. Kopia globalna dostaje pole `🔒 Analiza zablokowana` z nazwą head admina i wygaszony przycisk blokady; **przycisk „Analizuj" head admina zostaje aktywny** — blokada dotyczy admina serwera, nie jego
  - **Bez osobnego magazynu stanu** — stan trzyma sama wiadomość Discorda (wyłączony komponent), więc przeżywa restart bota bez pliku i bez wpisu w RAM
  - Adres kopii serwerowej bierzemy z footera globalnego embeda (`pgc:`/`pgm:`, dokładane po wysłaniu obu kopii). Gdy serwer nie ma własnego kanału raportów, footer ich nie ma → ephemeral `reportAnalyzeBlockedNoTarget` i nic się nie dzieje
  - ⚠️ **Routing:** `ee_analyze_block_` MUSI być sprawdzany PRZED ogólnym `ee_analyze_` — dzielą prefiks, więc odwrotna kolejność wysyłałaby blokadę do handlera samej analizy
  - Klucze: `reportBtnBlockAnalyze`, `reportAnalyzeBlockedDone`, `reportAnalyzeBlockedNoTarget`, `reportAnalyzeBlockedField`, `reportAnalyzeBlockedBy` (pol + eng)
- **Helper `_disableButtonsByPrefix(msg, prefixes)`** — przebudowuje rzędy, wyłączając wyłącznie przyciski o podanym prefiksie customId; **etykiety i style pozostałych zostają nietknięte**, bo raport dzieli kilka niezależnych akcji (Zatwierdź / Zablokuj / Analizuj / Cofnij). Zwraca `false` i **nie edytuje wiadomości**, gdy nie ma czego wyłączać (przycisk już nieaktywny) albo gdy w rzędzie jest select menu (`ButtonBuilder.from()` by na nim wybuchł)
- Metody pomocnicze: `_parseReportFooter(text)` i `_updateGlobalReportMsg(client, globalMsgId, guildId, action, admin, extra)`
- **Mapowanie powodu odrzucenia:** `_mapRejectionReason(reason, msgs)` — zwraca `{ text, color }` na podstawie kodu (`FAKE_PHOTO`, `INVALID_SCREENSHOT`, `NO_REQUIRED_WORDS`, `NOT_SIMILAR`, `INVALID_SCORE_FORMAT`, `BEST_EXCEEDS_TOTAL`); kolor: czerwony (`0xFF0000`) dla `FAKE_PHOTO`, pomarańczowy (`0xFF8C00`) dla reszty. Współdzielone przez raport admina (`_sendInvalidScreenReport`) i ephemeral gracza (`createNoRecordEmbeds`).

**`rankingService.createNoRecordEmbeds` — standard 2-embedowy dla „brak rekordu" (odrzucenie LUB zaakceptowany, nierekordowy wynik):**
- **Embed 1** — konwencja identyczna z Embedem 1 stosu ogłoszenia rekordu: `author` = nick gracza + jego avatar w `iconURL`, `thumbnail` = ten sam avatar, opis = `analyzeFailNoRecordMessage` („❌ **{userName}** nie pobił rekordu"). BRAK Embedów 2/3 ze stosu rekordu (global/boss) — nic nie zostało pobite.
- **Embed 2** — `author`/`thumbnail` = dedykowana ikona statusu `https://cdn.discordapp.com/emojis/1522935902295556127.webp?size=128`, `author.name` = etykieta (`reasonLabel`), opis = szczegóły/powód (`reasonText`), `image` = zrzut ekranu (`screenshotName`, opcjonalnie)
- Parametry: `{ userName, userAvatarUrl, screenshotName, reasonLabel, reasonText, messages, color1 = 0xff9900, color2 = color1 }` — `color1`/`color2` pozwalają zróżnicować kolor obu embedów (np. odrzucenia: `color1` pomarańczowy neutralny, `color2` czerwony/pomarańczowy wg `_mapRejectionReason`; legalne „brak rekordu": oba embedy tym samym kolorem)
- **Miejsca użycia** (wszystkie w `_runUpdateFlow`, więc dotyczą zarówno `/update` jak i `/test`, oraz panelu Analizuj):
  - Odrzucenie `NOT_SIMILAR` — `reasonLabel: analyzeFailReasonField`, `reasonText` = `aiResult.rejectionReason` lub zmapowany tekst
  - Odrzucenie inne (`FAKE_PHOTO`, `INVALID_SCREENSHOT` itd.) — `reasonLabel: analyzeFailReasonField`, `reasonText`/`color2` z `_mapRejectionReason`
  - Brak rekordu na tym samym serwerze — `reasonLabel: resultDetailsField` („Szczegóły wyniku"), `reasonText` = boss (jeśli jest) + `resultNotBeaten` + `resultDifference`
  - Duplikat cross-server bez poprawy — `reasonLabel: resultDetailsField`, `reasonText` = boss + `resultNotBeatenCrossServer`
  - Boss nierozpoznany zaakceptowany bez poprawy (żółty, `color1: 0xFEE75C`) — `reasonLabel: resultDetailsField`, `reasonText` = boss + wynik + `unknownBossAccepted`
  - Panel Analizuj — nieudana analiza AI — `reasonLabel: analyzeFailReasonField`, `reasonText` = `aiResult.error`, `color2: 0xFF0000`
- **Embed wyzwania (opcjonalny) — PRZEDOSTATNI:** gdy wynik został zaliczony do wyzwania, `_appendChallengeEmbed` wstawia embed ze **zdjęciem bossa** w miejscu ikony URL (author) i **pierścieniem postępu** (`1/3`, `2/3`, `3/3`) jako miniaturą — **przed** embedem z powodem i zrzutem ekranu, nie za nim. Patrz sekcja „System Wyzwań 1 vs 1"
- **Nie dotyczy:** stosu 4 embedów nowego rekordu (`createRecordEmbeds`) ani turkusowego ogłoszenia „pobito rekord bossa bez globalnego" — to prawdziwe ogłoszenia rekordu, używają pełnego stosu jak dotychczas. Raport na kanale odrzuconych screenów dla admina (`_sendInvalidScreenReport`) też ma inny, niezmieniony layout (author = tag/ikona serwera, nie status).

**System blokowania per-użytkownik** — `userBlockService.js` + `data/user_blocks.json`:
- Raport odrzuconego screena zawiera przyciski **Zatwierdź** i **Zablokuj użytkownika** (widoczne na kanale `ENDERSECHO_REJECTED_CHANNEL_ID`)
- **Zablokuj** otwiera modal z polem czasu (np. `1h`, `7d`, `30m` — puste = permanentnie); jeśli klikający jest Head Adminem, blokada zapisywana z flagą `blockedByHeadAdmin: true`
- Zablokowany użytkownik przy próbie `/update` widzi komunikat o blokadzie i konieczności kontaktu z adminem
- `/unblock` (admin) — lista zablokowanych posortowana od najkrótszej kary do permanentnych, select menu do odblokowania; jeśli `blockedByHeadAdmin: true` — zwykły Admin nie może odblokować
- Panel Admina → **🔒 Zablokuj gracza** (Head Admin) — cross-server wyszukiwanie + blokada z `blockedByHeadAdmin: true`
- **Ogłoszenie czasowej blokady** (`_announceUserBlock(client, targetUserId, blockedUntil, adminName)`): gdy admin nakłada blokadę CZASOWĄ (podany czas trwania), bot wysyła systemową wiadomość (czerwony embed, klucze `userBlockAnnouncementTitle`/`userBlockAnnouncement`) na kanał bota (`allowedChannelId`) serwera, na którym gracz ma swój najlepszy globalny wynik (`getGlobalRanking()` → `sourceGuildId`), w języku tego serwera: „Użytkownik @wzmianka został zablokowany na okres **X** przez administratora **nick**". Wywoływane fire-and-forget z obu ścieżek blokady adminem: panel admina (`_handlePanelBlockModal`) i raport odrzuconego screena (modal czasu blokady). NIE ogłaszane: blokady permanentne (puste pole czasu), automatyczna blokada 24h z weryfikacji społeczności oraz permanentna blokada z akcji CV `cv_admin_block`. Gdy gracz nie ma wyniku w żadnym rankingu — brak ogłoszenia.
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
- Wymaga konfiguracji + bot channel: `/update`, `/ranking`, `/profile`, `/challenge`
- Panel Admina (tryb Admin): Administrator Discord lub moderator gry → usuń gracza, odblokuj, tokeny
- Panel Admina (tryb Head Admin): `ENDERSECHO_BLOCK_OCR_USER_IDS` → wszystko + info, OCR toggle, limit

## Rankingi TOP 10 na stronie (endersecho.thashar.dev)

**Plik:** `services/webRankingSyncService.js` · **Stan:** `data/web_sync.json` · **Odbiornik:** `POST /api/ee-rankings` w workerze repo `thashar.dev`

- **Kierunek jest jeden: bot → strona.** Strona NIGDY nie odpytuje bota, więc serwer produkcyjny zostaje zamknięty na świat, a ranking na stronie działa nawet gdy bot jest zrestartowany (Worker oddaje ostatni snapshot z Durable Object)
- **Co jedzie:** nazwa serwera, tag, **data dołączenia bota do serwera** (`guild.joinedAt` — strona układa po niej kafelki, w kolejności dołączania), liczba graczy (osób, `countPeople`) i TOP 10 — pozycja, nick (`formatProfileDisplayName`, więc profile dodatkowe mają `②`), wynik jako string, **`scoreValue`** (strona rysuje z niego wykres porównania wyników — odpowiednik `generatePlayersProgressChart`), boss i data. **ŚWIADOMIE bez ID Discorda i avatarów** — nick wystarcza do rankingu, a ID dałoby się połączyć z kontem
- **Kiedy:**
  - przy starcie bota → `syncAll(client)`: pełny snapshot wszystkich skonfigurowanych serwerów, na których bot jest obecny, z flagą `replaceAll` (Worker kasuje wtedy serwery, których bot już nie obsługuje — inaczej wisiałyby na stronie z zamrożonym rankingiem). **`syncAll` przebudowuje mapę skrótów od zera** — gdyby zostały skróty serwerów skasowanych przez `replaceAll`, późniejszy `syncGuild` uznałby ich niezmieniony TOP 10 za „już wysłany" i serwer nigdy nie wróciłby na stronę
  - **cyklicznie co 6 h** → `startAutoSync(client)` (`AUTO_SYNC_INTERVAL_MS` w serwisie, zatrzymywany w `stopBot()`): ten sam pełny snapshot jako **siatka bezpieczeństwa**. Gdyby doszła ścieżka zmieniająca ranking bez wysyłki, strona dogoni bota w ciągu 6 h zamiast czekać na restart. Przy braku zmian to jeden POST, nie realny ruch
  - po każdej zmianie rankingu → `syncGuild(guildId, client)` **tylko gdy TOP 10 faktycznie się zmienił** (porównanie skrótu SHA-1 listy: pozycja + nick + wynik + boss). Zwykłe `/update`, które nie rusza czołówki, nie generuje żadnego ruchu
  - gdy TOP 10 się nie zmienił, ale **zmieniły się liczniki** → `_syncTotals(client)`: POST `{ guilds: [], totalGuilds, totalUsers }`, czyli sam nagłówek bez rankingów. Bez tego nowy gracz, który wszedł poza czołówkę, nie podbiłby licznika unikalnych graczy aż do najbliższego pełnego snapshotu. Guard po `_totals` (ostatnio wysłane liczniki, w tym samym pliku stanu) sprawia, że przy braku zmian nie leci nic
- **⚠️ Jedna akcja potrafi zmienić ranking KILKU serwerów — wtedy `syncGuilds(guildIds, client)`, nie `syncGuild`.** Pobicie rekordu kasuje słabszy wpis gracza na pozostałych serwerach (`affectedGuildIds` z `updateUserRanking`), a usunięcie profilu czyści go wszędzie. Wysłanie tylko bieżącego serwera zostawia na stronie stary snapshot poprzedniego — **ten sam gracz widnieje wtedy w dwóch rankingach** aż do restartu bota. `syncGuilds` odsiewa duplikaty, a guard po skrócie i tak wycina serwery bez realnej zmiany. Ścieżki wołające wysyłkę:

  | Ścieżka | Co wysyła |
  |---|---|
  | `/update` (`_runUpdateFlow`) | `syncGuilds([guildId, ...affectedGuildIds])` |
  | Panel „Analizuj" (zapis manualny admina) | `syncGuilds([targetGuildId, ...analyzeAffectedGuilds])` |
  | Kasowanie profilu (`_purgeProfileData`) | `syncGuilds` — serwery, z których usunięto wpis; przy przenumerowaniu profili (2→1, 3→2) **komplet serwerów**, bo zmienia się znacznik `②` w nicku |
  | Cofnięcie rekordu — przycisk gracza/admina, CV „usuń rekord"/„zablokuj" | `syncGuild(session.guildId)` **wewnątrz `_cvRemoveRecord`**, żeby objąć wszystkie cztery wywołania naraz. Każde z nich MUSI przekazać `opts.client` — bez klienta payload nie zna `joinedAt`, a to ono ustawia kolejność kafelków, więc wysyłka jest wtedy pomijana z ostrzeżeniem |
  | Panel `🗑️ Usuń gracza z rankingu`, komenda `/remove`, panel `🧹 Usuń wynik` | `syncGuild(targetGuildId)` |

- **Pusty ranking = kafelek znika ze strony:** gdy `buildGuildPayload` zwróci `null` (ostatni gracz usunięty), `syncGuild` woła `_removeGuild` → POST `{ guilds: [], removeGuildIds: [guildId] }`. Worker kasuje wtedy klucz `guild:{id}` w Durable Object. Bez tego kafelek wisiałby z zamrożoną listą do najbliższego `replaceAll`. Serwery, których nigdy nie wysłano (brak skrótu), są pomijane — nie ma tam czego kasować
- **Podgląd w Centrum Dowodzenia:** embed `⚙️ Narzędzia` ma pole `📤 Rankingi na stronie` — czas ostatniej wysyłki, jej rodzaj (pełny snapshot / pojedynczy serwer / usunięcie serwera / same liczniki), liczba śledzonych serwerów i ostatnio wysłane liczniki (serwery · unikalni gracze). Dane z `webRankingSyncService.getStatus()`; stan `lastSync` leży w tym samym pliku co skróty, więc przeżywa restart
- **Persistencja skrótów:** `data/web_sync.json` (`hashes` + `totals` + `lastSync`) — po restarcie bot nie wysyła wszystkiego ponownie tylko dlatego, że zapomniał, co już wysłał (pełny `syncAll` przy starcie i tak odświeża stronę)
- **Wyłączone bez konfiguracji:** brak `ENDERSECHO_WEB_SYNC_URL` lub `ENDERSECHO_WEB_SYNC_TOKEN` → `isEnabled()` zwraca `false` i serwis nic nie robi (żadnych błędów w logach)
- **Błędy nie przerywają flow** — wysyłka jest fire-and-forget, a niepowodzenie ląduje jako `warn` w logu. Nieudany POST **nie zapisuje skrótu** (`_hashes[guildId] = hash` stoi PO `_post`), więc następna zmiana rankingu spróbuje ponownie; niezależnie od tego stronę i tak dogoni cykliczny snapshot co 6 h
- **Limit POST-a: 15 s** (`POST_TIMEOUT_MS`, `AbortSignal.timeout`) — undici samo ogranicza wyłącznie fazę łączenia (~10 s, `UND_ERR_CONNECT_TIMEOUT`); gdy serwer połączenie przyjmie i zamilknie, oczekiwanie na odpowiedź nie ma limitu i request wisi w nieskończoność, trzymając otwarty uchwyt
- **Komunikat błędu przechodzi przez `_errText(err)`** — wbudowany `fetch` rzuca `TypeError: fetch failed` dla KAŻDEGO problemu z połączeniem (DNS, TCP, TLS, zerwana sesja), a realną przyczynę chowa w `err.cause`. Helper ją rozpakowuje (`fetch failed (ENOTFOUND)`, `fetch failed (ECONNRESET)`) i osobno nazywa przekroczony limit (`przekroczono limit 15s`, `err.name === 'TimeoutError'`). Bez tego w logu zostawał goły `fetch failed`, po którym nie dało się odróżnić padniętego DNS-u od zerwanego połączenia. Błąd HTTP (non-2xx) to inna ścieżka — `_post` formatuje go jako `HTTP {status} — {treść}`
- **Liczniki nagłówka (`_computeTotals`):** payload niesie też `totalGuilds` — liczbę WSZYSTKICH serwerów z botem (także tych bez wyników) — oraz `totalUsers`, czyli liczbę **unikalnych graczy** (`getCountedPlayers` z zawężeniem do aktywnych serwerów: dedup po ID Discorda, gracz z kilku serwerów i z kilku profili liczy się raz — ta sama liczba co „N unikalnych graczy globalnie” w stopce `/update`). Strona składa z nich napis „X unikalnych użytkowników z N społeczności…” nad listą kafelków. **Na stronę idzie sama liczba, żadnych ID.** Kafelek dostają tylko serwery z rankingiem, więc `totalGuilds` i liczba kafelków mogą się różnić. Zera nie wysyłamy — Worker zostawia wtedy ostatnią znaną wartość, a strona bez `totalUsers` pokazuje krótszy wariant zdania (bez liczby graczy)
- **Po stronie strony:** kafelki klanów w sekcji „COMMUNITIES USING THE BOT" renderowane są z tych danych i dopiero wtedy stają się klikalne; klik otwiera nakładkę z embedem TOP 10 w stylu bota. Gdy API nie odpowie, zostaje statyczna, nieklikalna lista z HTML-a

## Changelog na stronie (endersecho.thashar.dev)

**Plik:** `enders-echo/static/changelog.js` w repo `thashar.dev` (tablica `window.EE_CHANGELOG`) · **Gdzie widać:** pływające okno obok przełącznika języka, oś czasu grupowana datami

**Każdą zmianę w bocie, która nadaje się do changeloga, dopisz tam OD RAZU, w tym samym przebiegu pracy – bez pytania o zgodę.** W podsumowaniu napisz wprost, jaki wpis został dodany (albo dlaczego żaden). Gdy repo `thashar.dev` nie jest dostępne w sesji, powiedz to w podsumowaniu i podaj gotową treść wpisu do wklejenia.

- **Co się kwalifikuje:** zmiany widoczne dla gracza albo dla admina serwera – nowe komendy i panele, zmiany w ogłoszeniach, rankingach, osiągnięciach, OCR, konfiguracji
- **Co NIE trafia do changeloga:** refaktory, dokumentacja, logi diagnostyczne, zmiany w innych botach repo `Polski Squad`
- **⚠️ Chronimy know-how – changelog czyta cała społeczność.** Zmiany dotyczące wyłącznie head admina **pomijamy w całości**: Centrum Dowodzenia, `/tokens` i koszty AI, panel testerów OCR, `/info`, Success Rate, liczniki analiz manualnych i użycia komend, globalny wyłącznik OCR, alerty kosztowe, dziennik akcji. Nie zdradzamy też szczegółów technicznych: nazw dostawców AI i modeli, cache'y, kolejek, mutexów, mechanizmów zapisu, retry, limitów i progów. Zmianę czysto techniczną zwijamy w ogólnik – `Poprawki wydajnościowe` (`impr`) albo `Poprawki stabilności` (`fix`) – z jednym neutralnym zdaniem. **Test:** jeżeli wpis mówi coś, czego konkurencyjny bot mógłby użyć albo czego gracz i tak nie zobaczy w Discordzie, to albo ogólnik, albo nic
- **Format wpisu:** `[data ISO, kategoria, { pl: [tytuł, zdanie], en: [tytuł, zdanie] }, "identyfikator"]`, zawsze na górze tablicy. Kategorie: `feat` (nowość), `impr` (ulepszenie), `fix` (poprawka – wyłącznie realny błąd, który psuł dane, wynik gracza albo blokował działanie). Identyfikator to stały slug z angielskiego tytułu – po nim podpinają się tłumaczenia z plików `static/changelog/{kod}.js`
- **Jeden wpis to jedna zmiana widoczna dla gracza, nie jeden commit** – serię poprawek wokół tej samej rzeczy zwiń w jeden wpis, tytuł krótki, opis jednym zdaniem, bez żargonu z kodu
- **⚠️ Kolejność jest CHRONOLOGICZNA i pilnuje jej plik, nie widok** – najnowsza zmiana dnia stoi najwyżej. Dopisując wpis do dnia, który już istnieje, wstaw go NAD wcześniejszymi zmianami z tego dnia; nie grupuj po kategoriach

**Struktura danych:**
```
EndersEcho/data/
├── guilds/
│   └── {guildId}/
│       ├── ranking.json           # Ranking serwera (aktualny rekord per gracz)
│       ├── achievements.json      # Osiągnięcia graczy serwera
│       ├── role_rankings.json     # Konfiguracja rankingów ról
│       ├── boss_records.json      # Per-boss rekordy graczy {userId: {bossName: {score, scoreValue, timestamp, username}}}
│       └── wyniki/
│           └── {userId}.json      # Historia rekordów gracza na tym serwerze
├── boss_images/                   # Zdjęcia bossów ({bossName}.{ext})
├── notifications.json             # Subskrypcje powiadomień DM
├── guild_configs.json             # Per-guild konfiguracja
├── update_cooldowns.json          # Cooldowny /update (userId → expiresAt timestamp ms)
├── user_blocks.json               # Blokady użytkowników
├── usage_limits.json              # Dzienny limit użytkownika
├── token_usage.json               # Koszty AI (Gemini)
├── testers.json                   # Lista testerów OCR
├── banned_guilds.json             # Zbanowane serwery
├── community_votes.json           # Sesje weryfikacji społeczności
├── profiles.json                  # Profile graczy (kilka kont w grze)
├── record_reverts.json            # Sesje cofnięcia rekordu (przycisk gracza + admina)
└── challenges.json             # Wyzwania 1 vs 1 (/challenge) + wyniki czekające na zatwierdzenie bossa
```
Format wpisu historii gracza (`wyniki/{userId}.json`): tablica `[{ score, scoreValue, timestamp, bossName }, ...]`

**Migracja danych:** Przy pierwszym starcie `dataMigration.js` automatycznie przenosi stare pliki (`ranking_{id}.json`, `achievements_{id}.json`, `role_rankings_{id}.json`, `score_history_{id}.json`) do nowej struktury. Operacja jest idempotentna — bezpieczna przy wielokrotnym uruchomieniu.

**Rejestracja komend:** Komendy slash rejestrowane per-serwer przez `registerSlashCommands()` (start) i `registerCommandsForGuild()` (guildCreate / po /configure).

---

## King BUM AI Chat

**Mention @EndersEcho** na serwerze z listy `ENDERSECHO_AI_CHAT_GUILD_IDS` → bot odpowiada jako King BUM.

- **Dostępność per-serwer:** lista guild ID rozdzielona przecinkami w `ENDERSECHO_AI_CHAT_GUILD_IDS`. Pusty env = chat wyłączony wszędzie.
- **Przełączanie providera:** `ENDERSECHO_AI_CHAT_PROVIDER` → `anthropic` (domyślny) lub `grok`
- **Cooldown:** 1 min per użytkownik; administratorzy bez limitu
- **Persistencja:** cooldowny w `data/king_bum_cooldowns.json` (auto-czyszczenie po 48h)
- **Max długość pytania:** 500 znaków
- **Persona:** leniwy, ironiczny, zadziorny bot rankingowy — Discord markdown, krótkie odpowiedzi. Wątek „byłem King BUM-em, władcą serwera" **usunięty z promptu**; został sam charakter (nazwa sekcji w panelu i pliku serwisu jest historyczna)
- **Instalacja bota** — sekcja `Installing you on another server` w `SYSTEM_PROMPT`: bota może dodać każdy, a bot odsyła po szczegóły na swoją stronę (link w opisie profilu na Discordzie). Odpowiada **tylko zapytany** o instalację, dodanie na serwer albo stronę bota
- **Kontekst dopinany do KAŻDEJ wiadomości** (`_buildRankingContext`): ranking serwera (numerowana lista `nick - wynik`) + wynik pytającego. To materiał referencyjny, nie temat rozmowy
- **Zakaz niepytanego podawania pozycji** — sekcja `Ranking data attached to your prompt` w `SYSTEM_PROMPT`. Bez niej model dorzucał „Ty na 3." do wypowiedzi, w których nikt o ranking nie pytał (ranking siedzi w prompcie zawsze, więc traktował go jak materiał do wykorzystania). Dodając nowe dane do kontekstu, dopisz analogiczną regułę, kiedy wolno ich użyć
- **Lore serwera** (`Server lore` w `SYSTEM_PROMPT`): tylko **Thashar** — twórca bota; wspominany **wyłącznie** na pytanie o niego, nigdy z własnej inicjatywy. Wpis o Incognito został usunięty

### Provider: Anthropic (domyślny)
- **Model:** `ENDERSECHO_AI_CHAT_MODEL` (domyślnie `claude-3-haiku-20240307`)
- **Klucz:** wspólny `ANTHROPIC_API_KEY`

### Provider: Grok (xAI)
- **Model:** `ENDERSECHO_GROK_CHAT_MODEL` (domyślnie `grok-3-mini`)
- **API:** `https://api.x.ai/v1/chat/completions` (Chat Completions)
- **Klucz:** `XAI_API_KEY`

**Serwis:** `services/kingBumChatService.js`

---

## Zmienne Środowiskowe

```env
ENDERSECHO_TOKEN=bot_token_here
ENDERSECHO_CLIENT_ID=client_id

# Profile gracza — maksymalna liczba profili na użytkownika (łącznie z głównym; domyślnie 3)
ENDERSECHO_MAX_PROFILES=3

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

# King BUM AI Chat (opcjonalne)
# Lista guild ID (przecinkami) gdzie @EndersEcho odpowiada jako King BUM
ENDERSECHO_AI_CHAT_GUILD_IDS=guild_id_1,guild_id_2
ENDERSECHO_AI_CHAT_PROVIDER=anthropic          # "anthropic" (domyślny) lub "grok"
# Anthropic (gdy provider=anthropic) — wspólny klucz ANTHROPIC_API_KEY
ENDERSECHO_AI_CHAT_MODEL=claude-3-haiku-20240307
# Grok (gdy provider=grok) — wspólny klucz XAI_API_KEY
ENDERSECHO_GROK_CHAT_MODEL=grok-3-mini

# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_GOOGLE_AI_API_KEY=AIzaSy-xxxxxxxxxxxxx
ENDERSECHO_GOOGLE_AI_MODEL=gemini-2.5-flash-lite

# Serwer administracyjny (opcjonalne)
# Bot jest na tym serwerze ale go ignoruje: brak zapisu do guild_configs, brak przypomnień o /configure,
# brak w liście nieskonfigurowanych serwerów, komendy działają normalnie dla head admina
ENDERSECHO_ADMIN_GUILD_ID=guild_id

# 1. Tekstowe logi bota — webhook (opcjonalne)
# Format: [timestamp] ✅/⚠️/❌ message, każdy serwer z własnym avatarem i tagiem
# Separator kreską pojawia się przy zmianie serwera
ENDERSECHO_LOGS_WEBHOOK_URL=webhook_url

# 2. Logi zdarzeń serwerowych — kanał Discord (opcjonalne)
# Wysyła embedy: bot dodany do serwera, bot usunięty z serwera,
# pierwsza konfiguracja serwera, rekonfiguracja, wykrycie nieznanej nazwy bossa
ENDERSECHO_SERVER_LOG_CHANNEL_ID=channel_id

# 3. Logi analiz OCR — kanał Discord (opcjonalne)
# Wysyła embedy po każdym /update i /test: nowy rekord, brak rekordu, odrzucenie,
# duplikat cross-server, błąd ról, analiza z panelu admina
ENDERSECHO_OCR_LOG_CHANNEL_ID=channel_id

# 4. Odrzucone screeny z przyciskami — kanał Discord (opcjonalne)
# Wysyła embed gdy screen jest odrzucony (NOT_SIMILAR, FAKE_PHOTO, błędy walidacji)
# Embed zawiera: gracza, serwer, czas, powód, zdjęcie — przyciski Zatwierdź/Zablokuj
ENDERSECHO_REJECTED_CHANNEL_ID=channel_id

# 5. Raporty weryfikacji społeczności — kanał Discord (opcjonalne)
# Wysyła embed gdy gracz osiągnie próg zgłoszeń CV (community verification)
# Jeśli ten sam ID co per-guild rejectedChannelId → jeden raport (bez duplikatu)
ENDERSECHO_COMMUNITY_CHANNEL_ID=channel_id

# Użytkownicy uprawnieni do /ocr-on-off (ID rozdzielone przecinkami)
# Komenda włącza/wyłącza /update i/lub /test per-guild (parametry: action, target, guild z autocomplete)
# Stan per-guild persystowany w data/guild_configs.json (ocrBlocked[], newServerAnnounced)
ENDERSECHO_BLOCK_OCR_USER_IDS=discord_user_id_1,discord_user_id_2

# Jeśli true, komenda /configure dostępna WYŁĄCZNIE dla administratora serwera (head admin traci dostęp)
# Domyślnie false (head admin z ENDERSECHO_BLOCK_OCR_USER_IDS ma dostęp do /configure)
ENDERSECHO_CONFIGURE_ADMIN_ONLY=false

# Langfuse — LLM tracing (opcjonalne, niezależne od gateway-a)
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # opcjonalne (default: cloud)
```

## Najlepsze Praktyki

- **Persistencja przez `utils/jsonStore` (cache-first) — WSZYSTKIE pliki JSON bota:** `ranking.json`, `achievements.json`, `boss_records.json`, `role_rankings.json` i `wyniki/{playerKey}.json` per serwer, oraz `guild_configs.json`, `profiles.json`, `notifications.json`, `record_reverts.json`, `user_blocks.json`, `usage_limits.json`, `update_cooldowns.json`, `token_usage.json`, `testers.json`, `banned_guilds.json`, `community_votes.json`, `boss_aliases.json`, `admin_panel.json`, `command_usage.json`, `ocr_stats.json`, `web_sync.json`, `milestones.json`, `broadcast_reactions.json` i eksport `shared_data/endersecho_ranking.json`
  - Z dysku czytane **raz, przy pierwszym sięgnięciu** — `getGlobalRanking()` (37 wywołań), `getSortedPlayers()` (35) i `loadRanking()` (22) nie schodzą już na dysk przy każdym użyciu. Zapis atomowy (plik tymczasowy + rename) idzie jednocześnie do pliku i pamięci
  - **Własne cache serwisów zostają nietknięte** (`_rankingCache`, `_sortedCache`, `_globalCache` w `rankingService`, `playerIndexCache`) — to warstwa wyżej, trzymająca dane już znormalizowane i posortowane. Store zastępuje wyłącznie warstwę dostępu do pliku
    - **⚠️ Przy kasowaniu danych serwera sam `store.forget()` NIE wystarcza.** `loadRanking()` sprawdza najpierw `_rankingCache` i zwraca z niego dane, w ogóle nie sięgając do store'a — skasowany ranking dalej był więc oddawany z pamięci, a pierwszy `saveRanking()` zapisywał go z powrotem na dysk, wskrzeszając dane, które użytkownik kazał usunąć. Panel admina („Usuń dane serwera”) woła teraz `rankingService.invalidateGuildCache(guildId)` obok `store.forget(guildDataDir)`
  - **Kolejki zapisu per serwer** (`_enqueue` w `rankingService`, `achievementService`, `bossRecordService`) zostają — obejmują cały cykl odczyt-modyfikacja-zapis, a kolejka store'a chroni tylko sam zapis
  - **⚠️ Kształt wartości domyślnej musi pasować do użycia.** `wyniki/{playerKey}.json`, `role_rankings.json` i `testers.json` trzymają TABLICE (`() => ([])`), reszta obiekty (`() => ({})`). Zły kształt nie wybucha od razu — ujawnia się dopiero przy **braku pliku** (nowy serwer, pierwszy wynik gracza), gdy kod wywoła `.length`, `.push()` czy `.map()` na pustym obiekcie. Przy dodawaniu nowego magazynu sprawdź, co zwraca `catch` obok
  - `shared_data/endersecho_ranking.json` (czyta Stalker) i pliki Gary'ego trafiają do **tego samego cache** — wszystkie 9 botów dzieli jeden proces i jeden store kluczowany ścieżką pliku, więc dane są widoczne natychmiast po zapisie
- **Odpowiedzi ephemeralne — notacja tablicowa:** ten bot używa `flags: ['Ephemeral']` (BitFieldResolvable po nazwie flagi), a nie `MessageFlags.Ephemeral` jak pozostałe boty. **Obie formy są poprawne i żadna nie jest przestarzała** — dlatego przy migracji z `ephemeral: true` EndersEcho nie wymagał zmian. Nie mieszaj notacji w obrębie pliku i **nigdy nie wprowadzaj `ephemeral: true`** (przestarzałe w discord.js v14, przestanie działać w v15)
  - Flaga dotyczy tylko pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` jej nie przyjmuje, bo widoczność ustala się przy potwierdzeniu interakcji
  - `flags: 4` w `services/guildLogger.js` to co innego — `SuppressEmbeds` w surowym payloadzie webhooka (obok `avatar_url`), nie ma związku z ephemeralnością
- **Alerty uprawnień:** `_dmPermissionAlert(client, guildId, { channelId, missingPerms, context })` — wysyła DM do `configuredBy` + właściciela serwera gdy bot nie może zapisać do kanału (50001/50013). `_sendChannelErrorDm({ guildObj, ... })` — analogicznie dla /info. Oba fire-and-forget, nie przerywają głównego flow.
- **Logger (ogólny):** `createBotLogger('EndersEcho')` — tylko konsola + plik; jeśli ustawiony `ENDERSECHO_LOGS_WEBHOOK_URL`, EndersEcho jest **pomijany** w głównym webhooku botów
- **Logger (per-serwer):** `logService._gl(guildId).info(msg)` lub przez metody `logService.logCommandUsage/logScoreUpdate/logOCRError/logRankingError(... , guildId)` — trafia do dedykowanego webhooka z avatarem serwera i separatorem
- **GuildLogger:** `services/guildLogger.js` — zarządza kolejką webhooka, avatarem (ICON) i separatorem przy zmianie serwera. Metoda `sendEmbed(embed)` wysyła embed przez webhook (powiadomienia o dołączeniu serwera, usunięciu, zmianie konfiguracji); zwraca `true` jeśli webhook skonfigurowany
- **Embedy administracyjne (guildCreate/guildDelete/cfg_accept):** Wysyłane na dwa miejsca równolegle:
  1. Webhook przez `guildLogger.sendEmbed(embed)` / `logService.sendEmbed(embed)` (`ENDERSECHO_LOGS_WEBHOOK_URL` — opcjonalne)
  2. Kanał Discord: `ENDERSECHO_SERVER_LOG_CHANNEL_ID`
- **Embedy OCR analiz:** `logService.sendOcrAnalysisEmbed(guildId, options, guildObj, components)` — wysyła embed po każdej analizie OCR (/update, /test, panel Analizuj) na `ENDERSECHO_OCR_LOG_CHANNEL_ID`. Typy i kolory: 🏆 `new_record` zielony, 🆕 `new_player` **fuksja** (`0xEB459E` — pierwszy wynik gracza ma się wyróżniać; wcześniej dzielił zieleń z `new_record` i oba typy były nie do odróżnienia), 🔀 `server_change` **niebieski** (`0x3498DB`), 🪪 `new_account` **ametystowy** (`0x9B59B6`), 👾 `boss_record` turkusowy, ⚠️ `role_error` żółty, 🚫 `rejected` czerwony, 📊 `no_record` niebieski, ⚔️ `challenge` **sjena** (`0xA0522D`), 🧪 `test_record`/`test_no_record` cyan/blurple, 🔬 `analyze_panel` pomarańczowy, 🔄 `cross_server` szary. Kolor dzielą świadomie tylko warianty tej samej sytuacji (`role_error`/`role_error_new_player`/`analyze_panel_role_error` — żółty; `boss_record`/`test_boss_record` — turkus), rozróżniane emoji i etykietą. Embed zawiera: gracza, komendę, admina (panel), wynik, boss, poprzedni rekord, powód odrzucenia, szczegóły AI, błąd ról.
  - **⚔️ `challenge` zamiast `no_record`, gdy wynik wszedł do wyzwania.** Rekord nie padł, ale to NIE jest „nic się nie stało" — licznik wyzwania drgnął, więc embed dostaje własny nagłówek (`WYNIK DO WYZWANIA`) i własny kolor. Typ wybierany po `_challengeResult.notices.length > 0`, czyli po wynikach **faktycznie zaliczonych**: powtórka (`duplicates`) i wynik czekający na zmapowanie bossa (`pending`) niczego jeszcze nie dołożyły, więc zostaje `no_record`. W `/test` (dryRun) `notices` jest z definicji puste, więc etykieta testowa nie zmienia się nigdy
  - **Sjena `0xA0522D` to jedyny brązowy odcień w palecie** — pomarańcz `analyze_panel` (`0xE67E22`) jest wyraźnie jaśniejszy i bardziej nasycony, więc oba typy da się rozróżnić po samym pasku koloru
  - **Brak wpisu profilu na serwerze ≠ nowy gracz** — typ rozstrzyga `_resolveUpdateLogType(currentScore, _prevGlobalUser, guildId, profileIndex, roleError)` (`interactionHandlers.js`): profil miał wynik na **innym** serwerze → 🔀 `server_change` (przeprowadzka; embed dostaje pole `🔀 Zmiana serwera` z linijkami **Z:** / **Na:**, a `📈 Poprzedni rekord` bierze wynik ze starego serwera); **dodatkowy profil** tej samej osoby (slot > 1) bez wyniku gdziekolwiek → 🪪 `new_account` (nowe konto w grze); dopiero pierwszy wynik pierwszego profilu → 🆕 `new_player`. Warianty z błędem ról (`role_error_server_change`, `role_error_new_account`) są żółte jak reszta `role_error_*`.
  - Nazwę serwera do pola buduje `logService._guildLabel(guildId, client)` — tag (bez składni emoji, jak w autorze embeda) + nazwa z konfiguracji, fallback na cache klienta i samo ID. `cross_server` (szary) to **inna** sytuacja: gracz ma lepszy wynik na innym serwerze, więc nic się nie przenosi. Komponenty (np. przycisk ↩️ Cofnij) dołączane przez `components` array.
- **Przycisk ↩️ Cofnij wynik** (`ocr_revert_{publicMsgId}`; stary format `ocr_revert_{userId}_{guildId}` nadal obsługiwany) — dołączany do embedów `new_record`, `role_error` i `boss_record` (nie dotyczy `dryRun`/`/test`). Sesja trzymana w **persystentnym** `recordRevertService` (`data/record_reverts.json`), nie w RAM; po cofnięciu ogłoszenie publiczne dostaje nieaktywny czerwony przycisk `↩️ Cofnął admin`. Dostępny tylko dla head admina. Po kliknięciu: cofa wynik przez `_cvRemoveRecord` (revert rankingu + historia + osiągnięcia), aktualizuje role TOP, edytuje embed dodając pole "↩️ Cofnięto przez X" i **dezaktywuje przycisk** (zamiast usuwać). Jeśli w sesji jest `publicMsgId` — w ogłoszeniu rekordu dodawana jest notka "↩️ Administrator X cofnął wynik oraz wszystkie osiągnięcia". Sesja rewertu przechowywana w `_ocrRevertSessions` Map (RAM, TTL 24h, klucz `userId_guildId`; zawiera `publicMsgId`/`publicChannelId` — referencja do ogłoszenia publicznego). Wymaga webhooka aplikacyjnego (bot-owned) żeby interakcje były routowane.
- **Przycisk ↩️ Cofnij wynik pod embedem `🔬 ANALIZA Z PANELU`** — analiza z panelu dokłada do swojego embeda w kanale logów OCR ten sam przycisk `ocr_revert_{publicMsgId}` co zwykły `/update` (`_buildAdminRevertRow`), bo `_registerRecordAnnouncement` zakłada dla niej normalną sesję w `recordRevertService`. Dlatego embed wysyłany jest **PO** ogłoszeniu publicznym — bez jego ID nie ma czym zaadresować przycisku. **Przycisk powstaje wyłącznie gdy ogłoszenie faktycznie poszło** (`analyzePublicMsg?.id`): bez ID `_buildAdminRevertRow` schodzi na starą postać `{playerKey}_{guildId}`, która cofa OSTATNI rekord profilu — niekoniecznie ten z analizy. Gdy analiza niczego nie pobiła (`analyzeChangedData === false`), ogłoszenia nie ma i nie ma też czego cofać. `onSent: _adminMsgTracker(publicMsgId)` podpina embed do sesji, więc cofnięcie przez właściciela wygasza przycisk również po stronie admina. Jest to przycisk **niezależny** od `ee_analyze_revert_{globalMsgId}` pod raportem odrzuconego screena (opis niżej) — oba dotyczą tej samej analizy, ale różnych wiadomości i różnych mechanizmów sesji
- **Przycisk ↩️ Cofnij wynik (panel Analizuj)** (`ee_analyze_revert_{globalMsgId}`) — dołączany do embeda raportu odrzuconego screena po manualnej analizie admina. Po kliknięciu: cofnięcie rankingu i/lub rekordu bossa, **dezaktywacja przycisku** w raporcie i notka w ogłoszeniu publicznym. Sesja `_analyzeRevertSessions` zawiera `publicMsgId`/`publicChannelId`, `isNewRecord`, `isNewBossRecord`, `bossName`, `previousBossRecord` i `appliedScore`.
  - **⚠️ Przycisk powstaje TYLKO gdy analiza coś zmieniła** (`isNewRecord || isNewBossRecord`). Gdy wynik niczego nie pobił, nie ma czego cofać. Wcześniej przycisk istniał zawsze i jego kliknięcie unieważniało — przez `getLatest()` — **cofnięcie zupełnie innego, poprawnego rekordu gracza**. Realny incydent: analiza „No record broken" ostemplowała legalny rekord bossa sprzed kilku godzin jako „cofnięty przez admina" i trwale zabiła jego przycisk cofnięcia
  - **Rekord bossa też jest cofany** (`revertBossRecord` z `previousBossRecord`). Wcześniej ta ścieżka go nie ruszała, więc rekord bossa ustawiony przez analizę zostawał w bazie mimo cofnięcia
  - **Ochrona przed cofnięciem cudzego, nowszego wyniku:** `previousRecord` to snapshot z chwili analizy i bywa stary o godziny. Przed przywróceniem sprawdzamy, czy ranking nadal zawiera `appliedScore`; gdy gracz zdążył ustawić nowszy rekord — cofnięcie jest **przerywane** z komunikatem, zamiast wymazać tamten wynik
  - **Cofnięcie inną drogą wygasza ten przycisk** (`_applyRevertVisuals` krok 3 → `_disableAnalyzeRevertFor(client, publicMsgId, skipMessageId)`). Jeden rekord z analizy ma DWA niezależne przyciski cofnięcia oparte na osobnych mechanizmach sesji: `ocr_revert_*`/`rec_undo_*` (persystentny `recordRevertService`) i `ee_analyze_revert_*` (`_analyzeRevertSessions`, RAM). Bez tego kroku cofnięcie przez właściciela lub head admina zostawiało przycisk pod raportem aktywnym, a jego kliknięcie próbowało cofnąć już cofnięty wynik. Sesje analizy kluczowane są ID raportu, więc szukamy po `publicMsgId`; sesja jest kasowana niezależnie od tego, czy uda się odświeżyć wiadomość
  - **`_invalidateUndoForPlayer` przyjmuje `expectPublicMsgId`** — unieważnia sesję tylko wtedy, gdy ostatni rekord profilu to dokładnie ten cofany. Ścieżki kasujące dane hurtem (usunięcie gracza/wyniku/profilu) celowo go NIE podają, bo tam chodzi właśnie o ostatni rekord
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
- Kanał Discord: `ENDERSECHO_SERVER_LOG_CHANNEL_ID`

### Ogłoszenie nowego serwera (AUTOMATYCZNE — po odblokowaniu OCR `/update`)

Ogłoszenie leci **przy pierwszym odblokowaniu OCR `/update`** na danym serwerze, a **NIE** po zakończeniu konfiguracji. Powód: nowy serwer startuje z zablokowanym `/update` i `/test`, więc do momentu odblokowania nikt na nim nie zgłasza wyników i serwer faktycznie nie bierze udziału w rywalizacji — nie ma czego ogłaszać. Momentem realnego dołączenia jest decyzja head admina o odblokowaniu OCR.

**Flow:**
- `cfg_accept` (pierwsza konfiguracja) → zapis `ocrBlocked: ['update','test']` + `newServerAnnounced: false`. **Żadnego ogłoszenia.**
- Head admin odblokowuje `/update` → `_maybeAnnounceNewServer(client, guildId, unlockedCommands)` → `_broadcastNewServerAnnouncement(client, guild)`
- Broadcast na `allowedChannelId` wszystkich serwerów, embed w języku serwera (`pol`/`eng`)

**Ścieżki odblokowania wyzwalające ogłoszenie** (wszystkie trzy wołają ten sam helper):
- `cfg_ocr_en_{guildId}` — przycisk „🔓 Włącz OCR /update" pod powiadomieniem o konfiguracji (`_handleCfgOcrEnable`)
- `panel_ocr_en_{update|both}_{guildId}` — Centrum Dowodzenia, OCR on/off (`_handlePanelOcrAction`)
- `/block-ocr action:enable` — komenda head admina (`handleBlockOcrCommand`)

Odblokowanie samego `/test` ogłoszenia **nie** wyzwala — liczy się wyłącznie `/update`.

**Ochrona przed dublem — flaga `newServerAnnounced` w `data/guild_configs.json`:**
- Ogłoszenie leci dokładnie raz na serwer; flaga jest **trwała**, więc przeżywa restart bota oraz ponowne wyłączenie i włączenie OCR
- Flaga stawiana **PRZED** wysyłką broadcastu — częściowo nieudany broadcast jest mniejszym złem niż ogłoszenie tego samego serwera dwa razy
- **Migracja przy starcie** (`GuildConfigService.load()`): serwerom skonfigurowanym przed tą zmianą, którym brakuje flagi, ustawiane jest `newServerAnnounced = !ocrBlocked.includes('update')`. Serwer z odblokowanym `/update` = już działa i już był ogłoszony; serwer wciąż zablokowany = ogłoszenie poleci przy odblokowaniu. Serwery importowane z `.env` dostają `newServerAnnounced: true` od razu

**Zawartość embeda** (kolor `0xFFD700` — złoty, uroczysty):
- Nazwa serwera, liczba członków, numer kolejny skonfigurowanego serwera w rywalizacji (liczony w momencie odblokowania OCR)
- PL: "N. skonfigurowany serwer" · EN: "Nth configured server" (sufiks ordinalny przez `_enOrdinal()`)
- Thumbnail: ikona serwera Discord

**Metody:** `_maybeAnnounceNewServer(client, guildId, unlockedCommands)`, `_buildNewServerAnnouncementEmbeds(guild, serverNumber)`, `_enOrdinal(n)`, `_broadcastNewServerAnnouncement(client, guild)` · `GuildConfigService.isNewServerAnnounced(guildId)` / `setNewServerAnnounced(guildId, value)`

---

## Zbiorcze liczniki reakcji pod rozgłoszeniami

**Plik:** `services/broadcastReactionService.js` · **Stan:** `data/broadcast_reactions.json`

Dotyczy TRZECH rozgłoszeń idących na wszystkie serwery: **`📢 Wyślij Info`** (`_handleInfoSend`), **ogłoszenia nowego serwera** (`_broadcastNewServerAnnouncement`) i **cyklicznego raportu Global TOP10** (`globalTop10Service._sendReports`, typ `global_top10`). **Dokładając kolejne rozgłoszenie na wszystkie serwery, zarejestruj jego kopie przez `register()`** — inaczej reakcje pod nim nie będą się sumować. Pod każdą kopią embeda bot dokleja rząd przycisków: ikona reakcji + **suma tej reakcji ze WSZYSTKICH serwerów**. Gracz na serwerze A widzi więc, że embed zebrał 40 👍, choć u niego kliknęły go 3 osoby.

- **Rzędy 1-4 — liczniki, ZAWSZE szare (`Secondary`), po 4 przyciski w rzędzie (`BUTTONS_PER_ROW`): 15 najczęstszych reakcji z ikoną + zbiorczy `➕` na 16. slocie** (`TOP_BUTTONS = 15`). Discord pozwala na 5 w rzędzie, ale przy czterech etykiety liczników są szersze i blok czyta się spokojniej; pojemność to 4 rzędy × 4 przyciski, bo piąty rząd zostaje dla „ostatniej reakcji”. Do zbiorczego wpadają reakcje poza czołową piętnastką. **`➕` pojawia się DOPIERO gdy jest co w nim schować** — czyli od 16. różnej emotki w górę (albo gdy któraś nie da się wstawić na przycisk); przycisk z zerem niósłby zero informacji i tylko zjadał slot. Suma przycisków zawsze równa się sumie reakcji
  - **Emotki z serwerów bez bota trafiają na przyciski OPTYMISTYCZNIE** (`tryAllEmojis`): próbujemy wstawić prawdziwe ID, bo gate po `client.emojis.cache.has()` bywa zbyt surowy i niepotrzebnie zabierał ikonę. Dopiero **odrzucenie komponentu przez Discorda** przełącza dane rozgłoszenie na wariant zachowawczy (taka emotka idzie do `➕`), ustawia `buttonEmojiFallback` w stanie i **ponawia edycję** — bez tego liczniki zamarłyby na tej kopii. Flaga jest persystowana, żeby nie ponawiać skazanej próby przy każdym przeliczeniu
  - **Obrazka na przycisk wstawić się NIE DA** — pole `emoji` komponentu przyjmuje wyłącznie `{name, id, animated}`; URL jest parsowany jako nazwa emotki unicode (`"name": "https"`) i odrzucany przez API. Ikona z CDN działa tylko w embedzie (patrz lista osób niżej)
- **Rząd 5 — ostatnia reakcja:** `<nick> z <nazwa serwera>` / `<nick> from <server name>`, z **emotką tej reakcji jako ikoną**. Nick to **nick serwerowy** (`member.displayName`) z serwera, na którym kliknięto reakcję; nazwa serwera z cache'u Discorda (zapas: tag z konfiguracji)
  - **Bez czasownika, świadomie.** Emotka reakcji jest ikoną tego samego przycisku, a rząd stoi pod licznikami reakcji, więc „zostawił reakcję" nic nie wnosiło — za to polska forma męska **misgenderowała każdego, kto nie jest mężczyzną**. Dodając cokolwiek do tej etykiety, nie wprowadzaj z powrotem form rodzajowych
  - **Przycinanie z pierwszeństwem dla nicku** (`_composeLastLabel`): nazwa serwera sięga na Discordzie 100 znaków, a etykieta przycisku ma limit 80 (`MAX_LABEL`). Najpierw ustępuje nazwa serwera (z `…`), nick skracany dopiero, gdy sam się nie mieści
  - **Wsteczna zgodność:** wpisy zapisane przed przejściem na nazwę serwera mają tylko `guildTag` — `guildName || guildTag` nie gubi ich po aktualizacji
  - **Zapisywane TYLKO przy dodaniu reakcji** (`recordLastReaction` z `messageReactionAdd`). Usunięcie zmienia liczniki, ale nie rusza informacji o ostatnim autorze — poprzedniego i tak nie dałoby się odtworzyć
  - **Serwer brany z REJESTRU, nie ze zdarzenia** — przy zdarzeniu partial `reaction.message.guild` bywa puste, a rejestr wie, gdzie leży dana kopia
  - **Kolor rotuje: zielony → niebieski → czerwony** (`LAST_REACTION_STYLES`), przestawiany przy każdej nowej reakcji. **Discord NIE animuje przycisków** — kolor da się zmienić wyłącznie przy przebudowie komponentów, więc „zmienianie kolorów" = inny kolor po każdej kolejnej reakcji. Szary jest zarezerwowany dla liczników, żeby oba rzędy dało się odróżnić
  - Emotka spoza zasięgu bota wstawiana **optymistycznie**, tak samo jak na licznikach (`tryAllEmojis`). Ikona zastępcza `💬` pojawia się dopiero, gdy Discord odrzuci komponent i całe rozgłoszenie przejdzie na wariant zachowawczy — **nie** z góry
- **Rzędy budowane PER JĘZYK** — liczniki nie mają tekstu, ale rząd 2 już tak, a bot jest dwujęzyczny. Zestaw jest cache'owany per język w obrębie jednego przeliczenia, więc przy 18 serwerach renderuje się maksymalnie dwa razy
- **Kolejność liczników: malejąco po sumie, przy remisie STARSZA reakcja wyżej.** Discord nie daje znacznika czasu na reakcji, więc moment pierwszego zaobserwowania emotki zapisujemy sami (`firstSeen` w stanie rozgłoszenia). Gdy i on jest równy (emotki dodane w tym samym oknie debounce'u), rozstrzyga pozycja na liście reakcji wiadomości — Discord porządkuje ją wg pierwszego dodania (`order` z `_collect`)
- **Lista osób (ephemeral)** (`collectReactors` + `_handleBroadcastReactionButton`): kto zareagował, pogrupowany po serwerze, z liczbą przy nazwie serwera. Boty pomijane
  - **Nagłówek embeda bez NAZWY emotki customowej** — obrazek jest już ikoną autora, a nazwa bywa nieczytelna (zalgo, znaki spoza alfabetu). Zostaje sam licznik: `– N`. Emotka unicode nie ma ikony z CDN, więc jej glif zostaje w tekście: `👍 – N`. Myślnik krótki (półpauza)
  - **JEDEN EMBED NA EMOTKĘ, jej obrazek jako ikona autora** (`_emojiImageUrl` → `cdn.discordapp.com/emojis/{id}.png`). Powód: **Discord renderuje w treści tylko te emotki customowe, do których BOT ma dostęp** — pozostałe pokazuje jako goły `:nazwa:`. A do zbiorczego `➕` trafiają z definicji właśnie emotki niedostępne, więc wypisywanie ich w tekście ZAWSZE dawało goły tekst zamiast ikony. Ikona z CDN nie podlega temu ograniczeniu
  - **Zawsze `.png`, również dla animowanych** — CDN oddaje wtedy statyczną klatkę. `.gif` wymagałby pewności co do flagi `animated`, a ta bywa fałszywie ujemna przy zdarzeniach partial; złe rozszerzenie = zepsuty obrazek zamiast ikony
  - Limit 10 embedów na wiadomość → przy większej liczbie emotek nadmiar ucinany z dopiskiem w stopce. Kolejność embedów ta sama co przycisków (malejąco, remis → starsza wyżej)
  - **Klucz emotki siedzi w customId** (`bcr_{id}_e_{klucz}`), a NIE jej pozycja: kolejność przycisków zmienia się wraz z licznikami, więc indeks wskazywałby po chwili inną emotkę, gdyby ktoś kliknął przycisk sprzed odświeżenia
  - **`deferReply` jest konieczne** — odczyt N wiadomości + użytkownicy reakcji grubo przekracza 3 s, które Discord daje na pierwszą odpowiedź
  - Nicki serwerowe dociągane **jednym** `guild.members.fetch({ user: ids })` na serwer, nie pojedynczo (rate limit)
  - Limity Discorda: max 25 pól (serwerów) na embed, ~980 znaków na pole → nadmiar ucinany z dopiskiem „i N więcej"
- **Klik w licznik = REAKCJA (toggle jak na Discordzie):** pierwszy klik +1, kolejny -1, zmiana od razu na kopiach embeda na wszystkich serwerach (`refreshAfterVote` kasuje zaplanowany debounce i przelicza natychmiast — gracz ma zobaczyć efekt od razu). Bot nie może dodać reakcji „w imieniu" gracza, więc kliknięcia leżą w osobnym rejestrze `bc.votes = { emojiKey: { userId: {guildId, at} } }` w stanie rozgłoszenia; `bc.voteEmojis` trzyma opis emotki, bo przy zerowej liczbie prawdziwych reakcji nie byłoby z czego odtworzyć ikony przycisku
  - **⚠️ JEDNA OSOBA = JEDEN GŁOS NA EMOTKĘ.** Sumy liczą UNIKALNE ID (`_collect`: zbiór głosujących ∪ zbiór reagujących) — i tylko dla emotek, które ktoś kliknął, dociągane są listy reagujących; reszta zostaje przy tanim `reaction.count`. Klik przy WŁASNEJ prawdziwej reakcji **zdejmuje tę reakcję** (`users.remove`) zamiast dokładać drugi głos; gdy bot nie ma uprawnienia „Zarządzanie wiadomościami", zwraca `state: 'reaction'` i ephemeral z prośbą o ręczne zdjęcie emotki. Ten sam dedupe działa w liście osób (`seenByKey`) — inaczej lista pokazywałaby więcej ludzi niż licznik, gdy ktoś kliknął przycisk, a potem dorzucił emotkę ręcznie
  - **Klik aktualizuje też rząd 5** (`recordLastFromVote`) — tak samo jak zostawienie emotki. Cofnięcie głosu go nie rusza
- **Klik w rząd 5 („ostatnia reakcja") → lista WSZYSTKICH reagujących** (`target.type === 'all'`, dawne zachowanie zbiorczego `➕`)
- **Zbiorczy `➕` jest aktywny, ale bezczynny** — klik i tak MUSI zostać potwierdzony (`deferUpdate`), **bez tego Discord pokazuje „This interaction failed"**; przycisk `disabled` odpada, bo nie byłby klikalny
- **Przeliczanie PRZYROSTOWE (`bc.copies`)** — stan trzyma, KTO zareagował którą emotką na każdej kopii: `copies[messageId].emojis[key] = { ids: [userId], emoji, order }` + `bc.people[userId] = nick`. Zdarzenie reakcji dotyczy jednej kopii, więc `_syncCopy()` odpytuje TYLKO ją (`dirtyIds`), a sumy powstają z zapisanego stanu (`_totalsFromState`: zbiór unikalnych ID z kopii ∪ głosy). Wcześniej każde zdarzenie czytało kopie ze WSZYSTKICH serwerów — przy 100 serwerach ~500 zapytań na jedną reakcję, teraz ~104 (1 odczyt + edycje). ID (a nie same liczby) obsługują trzy rzeczy naraz: licznik, dedupe z głosami i listę reagujących
  - **Po restarcie kopie są oznaczane `stale`** (`load()`) — w czasie przestoju zdarzenia nie przychodziły, więc pierwsze przeliczenie danego rozgłoszenia synchronizuje wszystkie kopie raz, a potem wraca do trybu przyrostowego. `🔁 Odśwież ogłoszenia` wymusza pełną synchronizację (`force: true`)
- **Edycja tylko zmienionych kopii** — `_rowsSignature(rows)` (customId, etykieta, styl, emotka, stan) porównywany z `copies[msgId].sig`; identyczny podpis = `msg.edit` pomijane. Przebudowa, która niczego nie zmienia (np. domykająca), kosztuje wtedy 0 edycji zamiast N
- **Edycja bez pobierania wiadomości** — `_editComponents()` woła `channel.messages.edit(id, …)` (kanał z cache'u) zamiast `fetch` + `msg.edit()`. Sam odczyt uchwytu do edycji kosztował wcześniej dodatkowe N zapytań na przebudowę
- **Debounce skalowany liczbą kopii** — `max(DEBOUNCE_MS, kopie × DEBOUNCE_PER_COPY_MS)`, sufit `DEBOUNCE_MAX_MS` (5 s → 10 s przy 100 serwerach, max 60 s)
- **Lista reagujących bez ANI JEDNEGO zapytania** — `collectReactors()` składa ją z `copies[].emojis[].ids`, `votes` i `people` (nicki zapamiętane przy odczycie/kliknięciu). Wcześniej odpytywała każdą kopię i każdą reakcję: przy 100 serwerach i 20 emotkach ponad 2000 zapytań na jedno kliknięcie. Dlatego zniknął cache tej listy — nie ma już czego cache'ować
- **Jedna przebudowa na raz per rozgłoszenie** (`refresh()` → `_refreshOnce()`): żądanie zgłoszone w trakcie trwającej przebudowy nie startuje drugiej, tylko zamawia JEDNĄ domykającą po jej zakończeniu (`_refreshing` + `_refreshQueued`). Jedno przeliczenie to odczyt i edycja kopii na KAŻDYM serwerze — kilkadziesiąt zapytań; bez blokady tłum pod świeżym ogłoszeniem uruchamiał kilka przebiegów równolegle, mnożąc pracę i zapychając wspólną kolejkę REST (czyli spowalniając bota także w rzeczach niezwiązanych z reakcjami). Test: 10 kliknięć naraz → 2 przebudowy, nigdy dwie równolegle
- **Limit klikania liczników: 5 kliknięć w 5 s → 15 minut przerwy** (`BCR_WINDOW_MS`, `BCR_MAX_CLICKS`, `BCR_PENALTY_MS` w `interactionHandlers.js`, stan per użytkownik w `_bcrClicks`, sprzątany po przekroczeniu 500 wpisów). Blokada współbieżności chroni przed tłumem, a to przed jedną osobą walącą w przycisk. Wyjaśnienie (`broadcastVoteCooldown`, pol/eng, z relatywnym czasem końca) leci **dokładnie raz — przy nałożeniu przerwy**; każde kolejne kliknięcie do końca kary kończy się natychmiastowym `return`, **bez ani jednego zapytania do API** (nawet bez `deferUpdate`). Inaczej spam nadal generowałby ruch, tylko tańszy: 1 zapytanie na klik zamiast ~55. Kosztem jest komunikat Discorda o nieudanej interakcji u klikającego, co w trakcie kary jest raczej cechą niż wadą. Kara NIE przedłuża się przy kolejnych kliknięciach — kończy się o stałej godzinie
- **Debounce 5 s per rozgłoszenie** (`DEBOUNCE_MS`) — bez tego seria reakcji = seria edycji × liczba serwerów i wpadamy w rate limit
- **Retencja rejestru: 90 dni** (`RETENTION_DAYS`). Po wypadnięciu z rejestru przyciski zostają na wiadomości, ale bot nie wie już, do którego rozgłoszenia należą — klik nic nie robi (`toggleVote` → `noop`, `refresh` → `false`, bez błędu). Ogłoszenia wiszą na kanałach miesiącami, stąd 90 zamiast dawnych 30 dni. **Wpisy skasowane wcześniejszym prune'em nie wracają** — nowa retencja działa od teraz w przód
- **`🔁 Odśwież ogłoszenia` (Centrum Dowodzenia → ⚙️ Narzędzia, `cc_bcr_refresh`, head admin):** wymusza przebudowę przycisków pod WSZYSTKIMI żyjącymi rozgłoszeniami (`refreshAll(client, {delayMs: 1500})`). Potrzebne po zmianie zasad w kodzie: układ przycisków siedzi w wiadomości i zmienia go wyłącznie `msg.edit()`, więc bez tego stare ogłoszenie czeka na pierwszą reakcję albo kliknięcie. **Rozgłoszenia lecą po kolei, z przerwą 1,5 s** — jedno przeliczenie to odczyt i edycja kopii na każdym serwerze, a kilkanaście naraz to prosta droga do rate limitu. Odpowiedź podaje `odświeżono X z Y` + ile pominięto (skasowane wiadomości/brak dostępu); wpis trafia do dziennika akcji. **Zachowanie kliknięć zmienia się bez tego przycisku** — o nim decyduje handler, nie wiadomość; odświeżenie dotyczy wyłącznie UKŁADU przycisków
- **Rejestr kopii** (`register(type, messages)`) zapisywany PO rozesłaniu embeda: `broadcastId → [{ guildId, channelId, messageId }]`. Bez niego kopie nie mają jak się odnaleźć — **to fundament całej funkcji**. Kopie skasowane na Discordzie wypadają z rejestru przy pierwszym nieudanym pobraniu
- **Retencja 30 dni** (`RETENTION_DAYS`) liczona od wysłania. Po tym czasie rozgłoszenie wypada z rejestru — przyciski zostają na wiadomości, ale zamarzają (nowe reakcje ich nie aktualizują). Czyszczenie odpala się przy starcie (`load()`) **oraz przy każdej nowej rejestracji** (`register()`) — bot potrafi chodzić tygodniami bez restartu, a retencja liczona wyłącznie w `load()` wtedy by nie zadziałała i plik rósłby w nieskończoność
- **⚠️ WYMAGANIA GATEWAY (`index.js`)** — bez nich funkcja jest martwa:
  - intent **`GuildMessageReactions`** — nieuprzywilejowany, nie wymaga zmian w Developer Portalu
  - partials **`Message`, `Reaction`, `Channel`** — ogłoszenia żyją tygodniami, a po restarcie cache wiadomości jest pusty; bez partiali reakcja pod wiadomością spoza cache'u **NIE wywołuje zdarzenia w ogóle**, więc licznik działałby tylko do pierwszego restartu
- **Zdarzenia:** `messageReactionAdd`, `messageReactionRemove`, `messageReactionRemoveAll`, `messageReactionRemoveEmoji` — usuwanie obsłużone tak samo jak dodawanie: liczniki schodzą w dół, a emotka bez reakcji znika z rzędu. Reakcje botów pomijane (nic by nie zmieniły, a wywołałyby zbędny przelicz)
- **⚠️ `_fetchMessage` MUSI używać `fetch({ message, force: true })`.** Przy włączonych partialach zdarzenie reakcji pod wiadomością spoza cache'u wstawia do cache'u **niekompletny** obiekt wiadomości — z jedną reakcją, tą ze zdarzenia. Zwykły `fetch()` oddałby tę wydmuszkę i sumy policzyłyby się z niej: **wszystkie pozostałe emotki zniknęłyby z rzędu liczników**. Najłatwiej wywołać to usunięciem reakcji pod starszym ogłoszeniem. Nie zamieniaj tego na zwykły `fetch()` „dla oszczędności" — wymuszony odczyt jest fundamentem zasady „przeliczamy od nowa, z prawdy"
- **Wstrzykiwanie:** `interactionHandler.setBroadcastReactionService(service)` — setterem, nie kolejnym parametrem pozycyjnym (konstruktor `InteractionHandler` ma ich już 31)

---

## Centrum Dowodzenia Head Admina (Admin Panel Live Dashboard)

**Plik serwisu:** `services/adminPanelService.js`

**Konfiguracja (zmienna env):**
```env
ENDERSECHO_ADMIN_PANEL_CHANNEL_ID=id_kanalu_head_admina

# Rankingi TOP 10 na stronie (opcjonalne) — bez tych zmiennych wysyłka jest wyłączona
# URL endpointu workera + sekret ustawiony po stronie Cloudflare (wrangler secret put EE_RANKING_TOKEN)
ENDERSECHO_WEB_SYNC_URL=https://endersecho.thashar.dev/api/ee-rankings
ENDERSECHO_WEB_SYNC_TOKEN=ten_sam_sekret_co_w_cloudflare
ENDERSECHO_WEB_SYNC_TOP=10
```

**Działanie:** Panel to **8 osobnych wiadomości** (każda: 1 embed + własne rzędy przycisków) na kanale head admina. Edytowane automatycznie po każdym zdarzeniu. Kolejność sekcji = `SECTION_KEYS` w `adminPanelService.js`: `system, users, servers, bosses, challenges, stats, costs, tools`. Przy zmianie układu sekcji stare wiadomości są usuwane (iteracja po `Object.values(_messageIds)` — także osierocone klucze starych układów) i wysyłane od nowa. Wszystkie dynamiczne pola przycinane helperem `capField()` (limit 1024/pole, 4096/opis) — zabezpieczenie przed crashem.

**⚠️ KAŻDY przycisk panelu odpowiada EFEMERYCZNIE** (nowa wiadomość widoczna tylko dla klikającego) albo otwiera modal. Sekcje panelu to **stałe, publiczne wiadomości współdzielone przez wszystkich head adminów** — `interaction.update()` nadpisałby taką sekcję prywatnym widokiem jednej osoby aż do najbliższego `refresh()`, więc reszta zamiast statystyk oglądałaby cudzy ekran.

Rozstrzyga to `_panelRespond(interaction, payload)` w `interactionHandlers.js`: w Centrum Dowodzenia robi `reply({ flags: ['Ephemeral'] })`, w efemerycznym panelu `/manage` — `interaction.update()`. Rozpoznanie idzie przez `adminPanelService.isPanelMessage(interaction.message?.id)` (porównanie z `_messageIds`), **nie** przez customId — te same handlery obsługują oba wejścia. Dotyczy `panel_ocr`, `panel_ban_guild`, `panel_guild_list` i `panel_delete_server_data`; pozostałe przyciski panelu już wcześniej odpowiadały przez `reply`/`deferReply` z flagą `Ephemeral` albo modalem.

**Jedyny wyjątek: `cc_srv_pg_prev` / `cc_srv_pg_next`** — paginacja sekcji Serwery działa NA panelu (`deferUpdate()` + `changeServersPage()` + `refresh()`), bo jej sensem jest przewinięcie wspólnej wiadomości, a nie pokazanie czegoś jednej osobie.

Dalsze kroki flow (select menu, potwierdzenia, przyciski stron) klikane są już w wiadomości efemerycznej, więc `interaction.update()` jest w nich poprawne i zostaje.

**8 embedów panelu (każdy z własnymi przyciskami POD embedem):**

| # | Embed | Kolor | Zawartość | Przyciski |
|---|---|---|---|---|
| 1 | 📡 Przegląd Systemu | `0xFF6B35` | Uptime, ping, RAM, liczba serwerów, AI OCR (aktywnych/zablokowanych), następny Global TOP10, **🏆 Ostatnie rekordy** (feed 5, persystowany), **📜 Ostatnie akcje admina** (dziennik 10 wpisów — tyle samo w embedzie i w pliku) | `🔄 cc_refresh`, `📢 cc_top10_preview`, `📢 panel_info` |
| 2 | 👥 Użytkownicy | `0x57F287` | Łącznie graczy, aktywne cooldowny, oczekujące CV, **👑 Lider globalny**, **🕐 Ostatni rekord** (relative timestamp), **🏆 TOP10 pobijających rekordy** (liczba wpisów historii wyników per gracz, cross-server — `getActivePlayersStats().topRecordSetters`), **👥 Dodatkowe profile** (ilu graczy ma kilka kont i po ile — `profileRegistryService.getUsersWithAltProfiles()`, max 10 + "i N więcej", `⏳ N` przy profilach czekających na usunięcie), lista zablokowanych (max 3 + "i N więcej") | Rząd 1: `🔒 panel_block`, `🔓 cc_action_unblock`, `🗑️ panel_remove`, `🧹 panel_remove_score`, `🏆 panel_ach_del` · Rząd 2: `🔍 cc_player_lookup`, `🧊 cc_clear_cooldown`, `🗳️ cc_pending_cv` |
| 3 | 🖥️ Serwery | `0xEB459E` | Per serwer: OCR on/off, liczba graczy, język, tag + globalny limit/cooldown w nagłówku; **paginacja 25 serwerów/stronę** (`_serversPage` w RAM, footer `Strona X/Y`); sekcje nieskonfigurowane/brak bota (max 10 + licznik) | Rząd 1 (paginacja): `◀️ cc_srv_pg_prev`, `cc_srv_pg_info` (disabled, wskaźnik strony), `▶️ cc_srv_pg_next` · Rząd 2: `🔄 panel_ocr`, `🔁 cc_action_roles`, `📋 panel_guild_list`, `🚫 panel_ban_guild`, `🗑️ panel_delete_server_data` · Rząd 3: `⚠️ cc_unconfigured`, `🔍 cc_diag_server` |
| 4 | 👾 Bossowie | `0x1ABC9C` | Bossy w bazie, z rekordami, boss okresu, **🎯 Najczęstszy boss rekordów** (z aktualnych rekordów globalnego rankingu), **nieznane nazwy do zmapowania** (`bossRecordService.getUnknownBossNames()`, lista `• \`nazwa\`` max 5 + licznik), **bossy bez zdjęcia** (ten sam format, ale PEŁNA lista bez ucinania — chroni tylko twardy limit 1024 znaków przez `capField()`) | `👾 cc_action_boss_cfg` (pełny panel konfiguracji bossów jako ephemeral) |
| 5 | ⚔️ Wyzwania | `0xE67E22` | **🏆 TOP 5 zwycięzców** i **💔 TOP 5 przegranych** bieżącego miesiąca (`monthlyStandings()` — miesiąc liczony po czasie **warszawskim**, remisy i nierozstrzygnięte nie liczą się nikomu), **⚔️ W toku** (wszystkie, `2/3 : 1/3` + termin `<t:…:R>`), **⏳ Oczekujące na odpowiedź** (licznik w nazwie pola + **5 ostatnich**, `wyzywający → przeciwnik` i termin wygaśnięcia), **📜 Ostatnie rozstrzygnięte** (10) | `📜 cc_chal_history`, `⏳ cc_chal_pending`, `🏁 cc_chal_finish` |
| 6 | 📊 Statystyki | `0x5865F2` | Analizy łącznie/od resetu, Success Rate z paskami `[████░░]`, **Wzorzec OK za 2. razem**, odrzucone, interwencje admina, **🌩️ Zdrowie API** (globalne, nieresetowalne: odrzucone/wszystkie zapytania + %, pełne odrzuty po 10 retry), top odrzucani, aktywni/nowi gracze, przyrost miesięczny, **🔢 Użycia komend** (top 10 + suma, dawny przycisk scalony do embeda) | `📈 panel_player_growth` (przyciski Success Rate i Użycia komend usunięte — dane w embedzie; szczegóły/reset liczników nadal w `/manage → Statystyki`) |
| 7 | 💰 Koszty & Limity | `0xFEE75C` | Dziś (requesty, tokeny IN/OUT, koszt), miesiąc + projekcja, **⚙️ Limity i alert** (limit dzienny, cooldown, próg alertu), top 3 serwery, top 5 użytkowników | `📊 cc_action_tokens`, `⚙️ panel_limit`, `🔔 cc_cost_alert` (modal progu USD/dzień) |
| 8 | ⚙️ Narzędzia | `0x95A5A6` | **🧪 Testerzy z nickami** (nick serwerowy z serwera kanału panelu + username Discord z linkiem do profilu, `_resolveTestersDetailed()`), liczba serwerów z zablokowanym OCR per-guild, następny Global TOP10, **stan globalnego OCR**, **📤 Rankingi na stronie** (kiedy poszła ostatnia wysyłka TOP 10, czy był to pełny snapshot czy pojedynczy serwer, ile serwerów śledzonych; `⚪ Wyłączona` gdy brak `ENDERSECHO_WEB_SYNC_*`) | `🧪 cc_action_tester`, `📅 panel_top10_interval`, `🔁 cc_bcr_refresh`, `🛑/▶️ cc_global_ocr` (kill-switch z potwierdzeniem `cc_global_ocr_ok_{block\|unblock}`) |

**Nowe akcje CC (wszystkie tylko head admin, ephemeral):**
- `🔍 cc_player_lookup` → modal (`cc_player_lookup_modal`) → wyszukiwanie w globalnym rankingu → przy wielu trafieniach select `cc_player_lookup_sel` → embed szczegółów gracza: pozycja globalna, rekord+boss, serwer, blokada, aktywny cooldown, odrzucenia w bieżącym miesiącu, liczba osiągnięć
- `🧊 cc_clear_cooldown` → select aktywnych cooldownów (`cc_clear_cd_sel`) → czyszczenie cooldownu gracza (np. po spalonej próbie z winy API)
- `🗳️ cc_pending_cv` → lista oczekujących sesji CV z licznikami zgłoszeń i linkami do wiadomości raportów
- `⚠️ cc_unconfigured` → lista serwerów z botem bez konfiguracji (wersja ephemeral — nie rusza wiadomości panelu, w przeciwieństwie do `panel_unconfigured` które używa `update()`) Pod listą przycisk **`👢 Kicknij bota z serwera`** (`cc_unconf_kick`): select nieskonfigurowanych → potwierdzenie **Tak/Nie** → `guild.leave()`. Wpis w dzienniku akcji, refresh panelu; dane serwera NIE są kasowane (od tego jest `panel_delete_server_data`)
- `🔍 cc_diag_server` → select skonfigurowanych serwerów (`cc_diag_sel`) → embed diagnostyki uprawnień dla wybranego serwera. Refaktor: logika diagnostyki wydzielona do `async _buildDiagnosticsEmbed(guild, t, client)` — używana też przez `panel_diagnostics` (/configure); oba wywołania są `await`owane. **Paginacja**: select Discorda mieści max 25 opcji, więc wybór serwera idzie przez wspólny helper `_buildServerPickerRows({servers, page, selectId, pagePrefix, placeholder})` — strona zaszyta w customId przycisków (`cc_diag_pg_{n}`), bez stanu sesji. Ten sam helper obsługuje wybór serwera dla `cc_action_roles` i kickowania
- `👾 cc_action_boss_cfg` → panel konfiguracji bossów jako **ephemeral reply** (wrapper — `panel_boss_cfg` używa `update()` i zniszczyłby wiadomość panelu)
- `📢 cc_top10_preview` → `globalTop10Service.buildOnDemandEmbed()` jako ephemeral (bez zapisu snapshotu/harmonogramu)
- `🔔 cc_cost_alert` → modal (`cc_cost_alert_modal`) progu dziennego kosztu AI w USD (puste = wyłącz). Po przekroczeniu progu `_maybeCostAlert()` wysyła na kanał panelu ping do head adminów (raz dziennie, `lastAlertDate` w persist)
- `🛑 cc_global_ocr` → globalny kill-switch OCR (tryb serwisowy): `adminPanelService.setGlobalOcrBlocked()` persystowany w `admin_panel.json`; `_runUpdateFlow` sprawdza `isGlobalOcrBlocked()` po per-guild blocku (head admin pomija). Stan i przycisk (Wyłącz/Włącz) widoczne w embedzie Narzędzia

### Sekcja ⚔️ Wyzwania — historia i ręczne zamykanie

**`📜 cc_chal_history` — pełna historia z podziałem na serwery** (dwa kroki, oba efemeryczne):
1. lista serwerów, na których cokolwiek się rozegrało, z licznikiem wyzwań (25/stronę + przyciski zakresów liter `cc_chal_hsp_{offset}`, ta sama normalizacja co `/challenge`)
2. `cc_chal_hsrv` → historia jednego serwera, 8/stronę (`cc_chal_hpg_{guildId}_{page}`): pary graczy, boss, wynik (`3/3 : 2/3`), werdykt, data i — przy pojedynku międzyserwerowym — `🔀 nazwa drugiego serwera`

⚠️ **Pojedynek dwóch serwerów liczy się do OBU list** (`_ccChalGuildIds`). Head admin patrzy na historię pytaniem „co się działo u nich", a taki pojedynek działł się u jednych i u drugich — przypisanie go tylko jednej stronie ukrywałoby go przed drugą.

⚠️ **`cc_chal_hpg_{guildId}_{page}` parsowany od OSTATNIEGO `_`** — guildId to same cyfry, więc `split('_')` rozjechałby się na pierwszym separatorze.

**`⏳ cc_chal_pending` — WSZYSTKIE zaproszenia czekające na odpowiedź** (8/stronę, `cc_chal_ppg_{page}`): `wyzywający → przeciwnik`, boss, kiedy wysłane i kiedy wygasa, a przy pojedynku międzyserwerowym linia `🔀 serwer wyzywającego → serwer przeciwnika` (przy jednym serwerze pomijana, bo niczego nie wnosi). Embed panelu pokazuje tylko 5 ostatnich — ten przycisk daje komplet.

`getPending()` sortuje **od NAJNOWSZEGO**, odwrotnie niż `getActive()` (tam decyduje najbliższy termin). Zaproszenie samo wygaśnie po 24 h i nie wymaga niczyjej interwencji, a admin patrzy na tę listę pytaniem „kto właśnie kogo wyzwał".

**`🏁 cc_chal_finish` — ręczne zamknięcie wyzwania** (trzy kroki): lista wyzwań w toku (25/stronę, `cc_chal_fpg_{offset}`, kolejność **wg terminu**, nie alfabetycznie — stąd zwykłe `◀️/▶️` zamiast zakresów liter) → `cc_chal_fsel` → potwierdzenie → `cc_chal_fok_{id}`.

`challengeService.forceFinish(id, adminName)` rozstrzyga po **aktualnych sumach**, tak samo jak komplet wyników: wyższa wygrywa, równe = remis, `finishedBy` zapamiętuje admina. **Wyjątek: gdy ŻADNA ze stron nie wrzuciła wyniku** → status `unresolved`, nie `finished` — „remis 0:0" byłby kłamstwem i przyznawałby osiągnięcia za pojedynek, którego nie było.

Powiadomienia idą **tą samą drogą co przy naturalnym końcu**, bez własnej ścieżki: `finished` → `_finishChallenges` (osiągnięcia + DM z przyciskiem „pochwal się"), `unresolved` → `_handleChallengeSweep({ unresolved: [ch] })` (komunikat jak po 72 h). Akcja trafia do dziennika (`_ccAudit`) i odświeża panel.

**`✖️ cc_chal_close`** zamyka widok efemeryczny (podmienia go krótkim potwierdzeniem, bez komponentów).

**Metody serwisu:** `getAll()` · `getActive()` (wg terminu) · `getPending()` (od najnowszego) · `getClosed()` (wg `finishedAt`) · `monthlyStandings(refDate)` · `ChallengeService.warsawMonth(date)` · `forceFinish(id, adminName)`. Stała `CLOSED_STATUSES` = `finished, unresolved, declined, expired, cancelled`.

**Helper `capLines(lines, max, more)`** w `adminPanelService.js` — jak `capField`, ale tnie CAŁYMI liniami i dopisuje, ilu pozycji nie widać. `capField` ucina w połowie wiersza, co przy listach wyzwań dawało urwany nick bez wyniku.

**Dziennik akcji admina (`logAdminAction`):** wpisy dodawane helperem `_ccAudit(interaction, action)` przy: blokadzie/odblokowaniu gracza, usunięciu gracza/wyniku, akcjach CV (approve/remove/block), analizie manualnej, cofnięciach wyniku (ocr_revert + analyze revert), zmianie limitów, toggle AI OCR per-guild, banie/odbanowaniu serwera, usunięciu danych serwera, czyszczeniu cooldownu, alercie kosztowym, global OCR. Max 10 wpisów (wszystkie widoczne w embedzie System), persystowane w `admin_panel.json`. **We wpisach są NICKI, nie ID i nie pingi** — `_ccName(interaction, idOrKey)` rozwiązuje `userId`/`playerKey` (znacznik profilu zostaje) przez: member serwera → nick z rankingu globalnego → `users.cache` → fallback na samo ID. Ping `<@id>` renderowałby się w embedzie panelu jako klikalna wzmianka, a surowe ID jest nieczytelne. Wpisy zapisane przed tą zmianą są odpingowywane przy renderowaniu (`adminPanelService._auditNoPings()`).

**Persistencja panelu (`data/admin_panel.json`):** `{ messageIds, channelId, lastRecords[], auditLog[], costAlert: {threshold, lastAlertDate}, globalOcrBlocked }`.

**Widok `/manage → 📡 Centrum Dowodzenia`:**
Prosta informacja o kanale panelu + przycisk `🔄 Odśwież Panel`.

**⚠️ ZASADA: panel ma być ZAWSZE aktualny.** Każda zmiana danych, które któraś z ośmiu sekcji
wyświetla, MUSI kończyć się wywołaniem `this.adminPanelService?.refresh()`. Nie ma tu „drobnych"
zmian — admin patrzy na panel zamiast na pliki, więc nieodświeżona sekcja po prostu kłamie.
Dokładając nową funkcję, sprawdź, czy dotyka którejkolwiek sekcji, i dopisz `refresh()`.
Metoda jest **debounce'owana i tania** (patrz niżej), więc nadmiarowe wywołanie nic nie kosztuje —
brakujące kosztuje wiarygodność panelu.

**Triggery automatycznego refresh:**

| Sekcja | Kiedy |
|---|---|
| 👥 Użytkownicy | zapis wyniku (`/update`, `!dryRun`) · analiza admina (`Analizuj`) · usunięcie gracza (`panel_remove_confirm_*`) · usunięcie wyniku (`panel_remove_score_*`) · blokada (`panel_block_time_*`) i odblokowanie (`panel_unblock_select`) · akcje CV (approve/remove/block) · cofnięcie wyniku · czyszczenie cooldownu · **dodanie profilu, zaplanowanie i odwołanie usunięcia profilu**, przepalenie profilu (`_purgeProfileData`) |
| 🖥️ Serwery | **`cfg_accept`** (serwer skonfigurowany) · **`guildCreate` / `guildDelete`** (`index.js`) · toggle AI OCR · ban/unban serwera · usunięcie danych serwera · kick z nieskonfigurowanego |
| 👾 Bossowie | **dodanie / usunięcie / zmiana nazwy bossa, dodanie i usunięcie aliasu, przypisanie zdjęcia** · **zmapowanie nieznanej nazwy** z alertu (`boss_map_lang_sel`) |
| ⚔️ Wyzwania | **wysłanie zaproszenia** (`chal_ok`) · **przyjęcie / odrzucenie** (`chal_acc_*` / `chal_rej_*`) · **zaliczenie wyniku** (`_registerChallengeScore`, gdy `notices` niepuste) · **rozstrzygnięcie** (`_finishChallenges` — jedno miejsce dla kompletu wyników, upływu czasu, ręcznego zamknięcia i doliczenia zaparkowanego wyniku) · **sweep** (wygasłe zaproszenia, nierozstrzygnięte) · **doliczenie zaparkowanych wyników** po zmapowaniu bossa · **anulowanie wyzwań usuniętego profilu** · cofnięcie wyniku otwierające wyzwanie |
| 💰 Koszty | alert kosztowy · zmiana limitów |
| ⚙️ Narzędzia | **dodanie / usunięcie testera** · globalny kill-switch OCR |
| wszystkie | `🔄 cc_refresh` na wiadomości panelu · `/manage → Centrum Dowodzenia → Odśwież` · start bota (gdy kanał skonfigurowany) |

⚠️ **`_finishChallenges` jest JEDYNYM miejscem odświeżania po rozstrzygnięciu wyzwania** — schodzą
się w nim wszystkie cztery drogi (komplet wyników, upływ 72 h, `forceFinish` z panelu, doliczenie
zaparkowanego wyniku). Dokładając piątą, nie dopisuj `refresh()` u siebie, tylko przepuść ją tędy.

**Debouncing:** Maksymalnie 1 refresh naraz + 1 oczekujący (dodatkowe wywołania w trakcie odrzucane).
`_doRefresh` dodatkowo wychodzi od razu bez klienta albo bez kanału, więc `refresh()` jest bezpieczne
do wołania z dowolnego miejsca, także zanim panel zostanie skonfigurowany.

**Persistencja:** `data/admin_panel.json` — `{ messageId, channelId }`. Jeśli wiadomość usunięta, serwis tworzy nową.

**Aktywność graczy:** `scoreHistoryService.getActivePlayersStats(countedGuildIds, countedPlayerIds)` — dane o aktywnych/nowych graczach z historii wyników. Opcjonalne — jeśli serwis niedostępny, embed pokazuje "Brak danych". Wszystkie liczniki są **deduplikowane globalnie po `userId`** (historia najpierw scalana ze wszystkich serwerów, dopiero potem klasyfikowana) — wcześniej `firstTs` liczony był per plik, więc gracz obecny na kilku serwerach wchodził do `monthBuckets` wielokrotnie, a weteran, który po raz pierwszy wrzucił wynik na nowym serwerze, trafiał do „Nowi gracze / Tydzień".

---

## Kanoniczny licznik graczy (jedno źródło prawdy)

**`rankingService.getCountedPlayers(activeGuildIds)` → `{ total, playerIds }`** — ranking globalny (dedup po `userId`), czyli dokładnie ten zbiór, który trafia do stopki embeda admina po `/update` („👥 N unikalnych graczy globalnie"). **Każde miejsce pokazujące całkowitą liczbę graczy MUSI używać tej metody** — nie licz plików `wyniki/*.json` (zostają po graczach usuniętych z rankingu i po wyczyszczeniu historii zostaje pusty plik).

**Zakres serwerów: skonfigurowane ∩ bot faktycznie obecny** (`getAllConfiguredGuildIds().filter(cache.has)`). W Centrum Dowodzenia służy do tego `adminPanelService._getCountedGuildIds()` — sekcja „Serwery" nadal używa pełnej listy (`_getActiveGuildIds()`), bo pokazuje serwery bez bota jako osobną kategorię.

**Miejsca korzystające z licznika:**
| Miejsce | Kod |
|---|---|
| Stopka embeda admina po `/update` (wzorzec) | `interactionHandlers._runUpdateFlow` → `logService.sendOcrAnalysisEmbed({ globalPlayerCount })` |
| Kamienie milowe (próg + podtytuł wykresu) | `milestoneService._check` / `_announce` |
| CC → 👥 Użytkownicy → „Łącznie graczy" | `adminPanelService._buildSections` |
| CC → 📊 Statystyki → „Nowi gracze" / „Przyrost miesięczny" | `getActivePlayersStats(countedGuildIds, countedPlayerIds)` |
| CC → 📈 Przyrost graczy (embed + oba wykresy) | `interactionHandlers._handlePanelPlayerGrowth` |

**`/test` (dryRun) nie zawyża licznika** — `simulateGlobalRanking` dokłada symulowanego gracza, więc stopka bierze `total` z realnego rankingu (`getCountedPlayers`), a symulacja służy tylko do snippetu pozycji.

**Klucz API serwisu:**
```javascript
adminPanelService.setLastRecord(userName, score, bossName, guildId); // przed refresh po OCR
adminPanelService.refresh();   // fire-and-forget, debounced
adminPanelService.setupChannel(channelId); // zmień kanał i wyślij nową wiadomość
adminPanelService.isConfigured(); // czy ENDERSECHO_ADMIN_PANEL_CHANNEL_ID ustawione
adminPanelService.getChannelId(); // ID aktualnego kanału
adminPanelService.getMessageId(); // ID wiadomości panelu (null = jeszcze nie wysłana)
```

**Dostęp przez `/manage`:** Rząd 2 (tylko Head Admin) → `📡 Centrum Dowodzenia` → info o kanale + `🔄 Odśwież Panel`.

---

## System Wyzwań 1 vs 1 (`/challenge`)

**Pliki:** `services/challengeService.js` · **Stan:** `data/challenges.json` (GLOBALNY, nie per-serwer — wyzwanie łączy dwa serwery)

Pojedynek dwóch graczy na wybranym bossie: liczą się **3 kolejne wyniki** każdej ze stron, zrobione po przyjęciu wyzwania. Wyniki sumują się, wygrywa wyższa suma.

**⚠️ Uczestnikiem jest PROFIL (`playerKey`), nie osoba** — wyzywający startuje ze swojego **maina** (`_mainPlayerKey`), przeciwnika wybiera z rankingu wskazanego serwera (lista pokazuje profile ze znacznikami `②`/`③`).

**Bilans pojedynków jedzie też na stronę** – karta Gracza Dnia (`playerOfTheDayService.buildPayload`) dostaje pole `challenges` z `summarize()`: `settled` / `won` / `lost` / `draw`, i tylko wtedy, gdy cokolwiek się już rozstrzygnęło. **Same liczby** – nazwa przeciwnika, boss i daty pojedynków NIE opuszczają bota: drugi gracz nie ma jak wypisać się z cudzej karty, więc nie może się na niej znaleźć (opisane w sekcji 5a polityki prywatności na stronie).

**Komenda `/challenge` jest dostępna dla KAŻDEGO gracza** — bez `setDefaultMemberPermissions` i bez bramki head admina. Routing zwykły, jak `/update` i `/ranking`: wymaga skonfigurowanego serwera **i kanału bota** (`isAllowedChannel`).

⚠️ **Wcześniej komenda była zamknięta dla head admina i szła własną ścieżką routingu**, przed sprawdzeniem kanału. Otwierając ją dla graczy przeniesiono ją do zwykłego `switch`, żeby podlegała tej samej zasadzie „komendy gracza tylko na kanale bota" co reszta. Select menu `chal_*` nadal routowane są przed `isAllowedChannel` — wizard jest efemeryczny i tak czy owak żyje w wiadomości, która powstała już na dozwolonym kanale.

### Terminy i limity

| Parametr | Wartość | Stała |
|---|---|---|
| Wyniki na uczestnika | 3 | `SCORES_PER_SIDE` |
| Zaproszenie bez odpowiedzi | **24 h** → `expired` | `INVITE_TTL_MS` |
| Przyjęte wyzwanie | **72 h** → rozstrzygnięcie po sumach albo `unresolved` (patrz niżej) | `CHALLENGE_TTL_MS` |
| Wynik czekający na zatwierdzenie bossa | 72 h → porzucony | `PENDING_SCORE_TTL_MS` |
| Otwarte wyzwania na profil | **2** — tyle pojedynków naraz może prowadzić jeden profil | `MAX_ACTIVE_PER_PLAYER` |
| Otwarte wyzwania na profil NA JEDNYM BOSSIE | **1** — niezależnie od tego, z kim | `MAX_ACTIVE_PER_BOSS` |
| Różnica rekordów wyzywający ↔ przeciwnik | **±20%** — poza przedziałem gracza nie da się wybrać | `MAX_RECORD_DIFF_RATIO` |
| Zamknięte bez rezultatu (`declined`/`expired`) | kasowane po 90 dniach | `CLOSED_MAX_AGE_MS` |

**Dwa limity naraz: 2 wyzwania na profil, ale tylko 1 na tym samym bossie**

- **Slot zajmują:** wyzwania w toku (obojętnie po której stronie) oraz **wysłane** zaproszenia czekające na odpowiedź. **OTRZYMANE zaproszenia slotu NIE zajmują** — inaczej gracz, do którego przyszło więcej zaproszeń niż wynosi limit, nie mógłby przyjąć żadnego. Predykat slotu jest jeden (`_occupiesSlot`), wspólny dla `countOpenForPlayer` i `busyBossesFor`
- ⚠️ **Skąd limit per boss:** `registerScore` dopisuje wynik do KAŻDEGO aktywnego wyzwania gracza na danym bossie. Bez tego limitu jeden screen z walki zaliczałby się do dwóch pojedynków jednocześnie — gracz zbierałby dwa wyzwania za jedno podejście. Limit 1 na bossa usuwa ten scenariusz u źródła, zamiast komplikować `registerScore`
- **Kreator UKRYWA zajęte bossy** zamiast odbijać wybór przy potwierdzeniu: `_challengeBusyBosses` sumuje `busyBossesFor` obu stron (wyzywającego i wybranego przeciwnika), a lista pokazuje tylko resztę. Gdy nie zostanie żaden — `challengeNoBossesFree`
- **Sprawdzane też PÓŹNIEJ**, bo stan może się zmienić po zbudowaniu listy: przy `chal_ok` (sesja żyje 15 min) → `challengeErrBossBusy` / `challengeErrOpponentBossBusy`, oraz przy przyjęciu zaproszenia (czeka do 24 h) → `challengeErrBossBusy`
- **Komunikaty o wyczerpanym limicie ogólnym podstawiają liczbę przez `{limit}`** (`challengeErrLimit`, `challengeErrOpponentBusy`, `challengeErrAcceptLimit`) i są sformułowane bezosobowo („maksymalną liczbę otwartych wyzwań ({limit})"), więc zmiana stałej nie wymaga poprawiania odmiany w obu językach
- **`hasOpenBetween` zostaje** mimo limitu per boss — łapie przypadek, którego ten nie obejmuje: OTRZYMANE (a więc niezajmujące slotu) zaproszenie od tej samej osoby na tego samego bossa. Daje też konkretniejszy komunikat (`challengeErrDuplicate`). Z tym samym przeciwnikiem na INNYM bossie wyzwanie jest dozwolone

Statusy: `pending` (czeka na odpowiedź) · `active` (trwa) · `finished` (rozstrzygnięte, zwycięzca albo remis) · `declined` · `expired` (zaproszenie) · `unresolved` (72 h i kompletu nie zebrał NIKT) · `cancelled` (uczestnik usunął profil).

### Wizard (ephemeral, wzorzec `/subscribe`)

1. `chal_pl` — wybór gracza **ze wszystkich skonfigurowanych serwerów naraz** (25/stronę + przyciski zakresów liter `chal_page_{offset}`); **wszystkie własne profile odfiltrowane** (`getOwnerId` ≠ wywołujący) oraz **gracze z rekordem poza przedziałem ±20%** (patrz „Limit ±20%" niżej)
2. `chal_boss` — wybór bossa (`_getAllEnglishBossNames()`, 25/stronę, `chal_bpage_{n}`)

**Kroki 1–2 to EMBEDY**, nie goły `content` (wspólny tytuł `challengeWizardTitle`, kolor `0x5865F2`):
- krok 1: opis + **pola** `🏆 Twój rekord` i `⚖️ Dozwolony przedział (±20%)` (obok siebie, `inline`) + stopka `challengeRangeFooter`. ⚠️ Rekord i widełki **muszą zostać polami** — jako doklejone zdanie w jednym akapicie z instrukcją wyboru ginęły w ścianie tekstu (to była realna skarga)
- krok 2: opis + pole `🎯 Przeciwnik` z etykietą wybranego gracza (`session.playerLabel`) — po przejściu dalej inaczej nie widać, komu rzuca się wyzwanie
- ⚠️ **Każde wyjście z kreatora musi wyczyścić embed** — stąd `_challengeWizardError(interaction, content)` zamiast gołego `editReply({ content })`. Bez `embeds: []` komunikat o wygasłej sesji zostawiłby pod sobą embed z nieaktualnymi widełkami
3. Potwierdzenie z **miniaturą bossa** + zasady + przypomnienie o limicie ±20% (`challengeRecordRule`) → `chal_ok` / `chal_no`

**⚠️ Kroku „wybierz serwer" (`chal_srv` / `chal_spage_*`) NIE MA** — został usunięty razem z komunikatami `challengeIntro`, `challengeSelectServerPlaceholder` i `challengeNoPlayers`. Przy limicie ±20% wchodziło się w serwer po serwerze tylko po to, żeby sprawdzić, czy ktokolwiek się łapie; teraz komplet kandydatów jest od razu.

### Lista kandydatów (`_getChallengeCandidates`)

- **Zbiera graczy ze WSZYSTKICH serwerów** z `config.getAllGuilds()` (`Promise.all` po serwerach, każdy przez `rankingService.getSortedPlayers`), odsiewa własne profile wyzywającego i wyniki spoza ±20%, sortuje po nicku (`_compareSortNames`; przy równych nickach rozstrzyga nazwa serwera)
- ⚠️ **NAJPIERW filtr, POTEM nicki — kolejność jest wydajnościowo krytyczna.** Pierwsza wersja szła przez `_getNotifSortedPlayers`, czyli dociągała z Discorda nicki KAŻDEGO gracza KAŻDEGO serwera (setki członków przez `guild.members.fetch`), żeby zaraz wyrzucić prawie wszystkich filtrem ±20% — stąd kilkusekundowe czekanie po `/challenge`. Filtr działa na samych danych rankingowych (`scoreValue`, `userId`), więc nick dociągany jest wyłącznie dla tych kilku, którzy zostaną: **serwer bez ani jednego kandydata nie kosztuje żadnego żądania do Discorda**. Dokładając kolejną listę filtrowaną po danych rankingu, powtórz ten układ zamiast sięgać po `_getNotifSortedPlayers`
- **Etykieta pozycji: `nick (serwer)`** (`_challengeCandidateLabel`). Nazwa serwera jest obowiązkowa — lista łączy wszystkie serwery, więc dwie osoby o tym samym nicku (albo jedna, grająca w dwóch miejscach) byłyby bez niej nie do rozróżnienia. Limit etykiety to 100 znaków: najpierw przycinana jest nazwa serwera (do 30 znaków), potem nick
- **Wartość opcji to `guildId:playerKey`**, nie sam `playerKey` — ten sam profil może siedzieć w rankingu kilku serwerów, a wyzwanie musi wiedzieć, którego dotyczy (`challenge.opponent.guildId`). `playerKey` (`userId` albo `userId#N`) dwukropka nie zawiera, więc handler rozcina wartość na pierwszym
- **Lista trafia do sesji wizarda** (`session.candidates`) — przewijanie stron nie przechodzi rankingów wszystkich serwerów po raz drugi. Wybór gracza jest weryfikowany względem tej listy; sesja bez listy (TTL, restart bota) kończy się `challengeSessionExpired`
- ⚠️ **`handleChallengeCommand` robi `deferReply` OD RAZU**, przed liczeniem czegokolwiek. Zbieranie kandydatów przechodzi rankingi wszystkich serwerów i potrafi dociągać nicki z Discorda, czyli spokojnie przekracza 3 sekundy, które Discord daje na pierwszą odpowiedź. Dopóki pierwszym ekranem był wybór serwera (odpowiedź natychmiastowa), defer nie był potrzebny — stąd `_renderChallengePlayerPicker` odpowiada dziś wyłącznie przez `editReply`
- ⚠️ **`_buildRangeButtons` daje maksymalnie 4 rzędy × 5 przycisków = 20 stron po 25 pozycji**, czyli 500 kandydatów. Filtr ±20% schodzi realnie znacznie niżej, ale przy bardzo dużej liczbie serwerów warto o tym limicie pamiętać — nadmiar jest ucinany bez śladu w UI

### Limit ±20% — wyzwanie musi być wyrównane

Wyzwać można **wyłącznie gracza, którego rekord mieści się w przedziale ±20%** rekordu wyzywającego. Bez tego dowolny gracz mógł wyzwać lidera rankingu (albo odwrotnie), a wynik pojedynku był znany z góry.

- **Porównywany jest rekord z rankingu** (`scoreValue`), nie wyniki oddawane w trakcie wyzwania
- **Po stronie wyzywającego liczy się profil GŁÓWNY** na serwerze, z którego poszła komenda (`_challengeChallengerRecord` → `_mainPlayerKey`) — to ten profil staje się uczestnikiem, więc porównanie idzie po jego wyniku, nie po najlepszym z kont gracza
- **Brak rekordu = brak wyzwania.** `handleChallengeCommand` kończy się komunikatem `challengeErrNoRecord`, kreator nawet się nie otwiera
- **Reguła w serwisie, nie w handlerze:** `challengeService.isRecordInRange(a, b)` / `recordRange(score)` / `maxRecordDiffPercent`, stała `MAX_RECORD_DIFF_RATIO = 0.2`. Porównanie z granicą ma margines `RECORD_RANGE_EPSILON` (1e-9) — rekord dokładnie o 20% wyższy MA się mieścić, a `score * 1.2` potrafi wyjść o ułamek za duże
- **Sprawdzane DWA razy:** przy budowaniu listy graczy (filtr) i ponownie przy `chal_ok` na świeżo policzonych rekordach — sesja żyje 15 minut, a w tym czasie obie strony mogą poprawić wynik (`challengeErrRecordRange`)
- **Gdzie widać restrykcję:** embed listy graczy pokazuje konkretny przedział w polach (`challengeFieldYourRecord` + `challengeFieldAllowedRange`), embed potwierdzenia — samą zasadę (`challengeRecordRule`), a gdy na ŻADNYM serwerze nikt się nie łapie — `challengeNoPlayersInRange`

Stan wizarda: `_challengeSessions` Map (RAM, TTL 15 min) — `guildId + playerKey + nazwa bossa` nie zmieszczą się w customId (limit 100 znaków), a od czasu listy zbiorczej sesja trzyma też rekord wyzywającego (`challengerScore`) i gotową listę kandydatów (`candidates`). To sesja czysto UI, restart bota tylko ją zeruje.

**⚠️ Kolejność alfabetyczna liczona z klucza ZNORMALIZOWANEGO** (`_normalizeSortName` / `_sortBucketLetter` / `_compareSortNames` w `interactionHandlers.js`) — wspólne dla list graczy i serwerów:
- zdejmowane jest wszystko przed pierwszym znakiem **pisanym** (literą albo cyfrą), więc `🔥 Polski Squad` trafia pod `P`, a `❰ Zenith ❱` pod `Z`. Nicki i nazwy serwerów zaczynają się od emoji i ramek częściej niż od litery, a bez tego lista „alfabetyczna" alfabetyczna nie była: takie nazwy lądowały w koszu „nie-litera", a przycisk zakresu pokazywał `🔥 - ⭐` zamiast `A - K`
- diakrytyki sprowadzane do liter bazowych (`Ą→A`, `Ż→Z`, `Ł→L`)
- **`ł`/`Ł` NIE rozkłada się w NFD** (osobny punkt kodowy z kreską, nie litera ze znakiem łączącym) — dlatego jest mapa dla niego i garści podobnych liter z innych alfabetów (`ø đ ð þ æ œ ß ı`), których sam NFD też nie rozbije
- kolejność: litery → cyfry → `#` (nazwy złożone wyłącznie ze znaków ozdobnych) na końcu
- **przyciski zakresów buduje `_buildRangeButtons(items, activeOffset, prefix, maxRows)`** — wspólne dla graczy w `/challenge` (`chal_page_`) i listy serwerów do zbanowania (`panel_ban_page_`); etykiety liczone z klucza znormalizowanego, nie z surowej nazwy. W `/challenge` zakresy liczone są z samego **nicku**, bez dopisku serwera — sortowanie idzie po nicku
- ta sama normalizacja obowiązuje sortowanie w `_getNotifSortedPlayers`, więc dotyczy również listy graczy w `/subscribe`

⚠️ **Lista graczy to WYŁĄCZNIE osoby z wynikiem w rankingu** (`getSortedPlayers` czyta `ranking.json` danego serwera), nigdy wszyscy członkowie Discorda. Nicki serwerowe dociąga `_resolveGuildDisplayNames(guildId, client, userIds)`:

- najpierw cache Discorda (`guild.members.cache`), resztę **batchami po 100 ID, równolegle** (`guild.members.fetch({ user: chunk })` w `Promise.allSettled`)
- **dedup po `userId` przed pobraniem** — gracz z kilkoma profilami ma jeden nick, więc nie ma powodu pobierać go raz na profil
- wynik cache'owany per serwer na **3 minuty**, żeby przewijanie stron (`chal_page_*`, `notif_page_*`) nie powtarzało całej operacji przy każdym kliknięciu
- ⚠️ **Cache jest PER ID, nie „cała mapa albo nic".** Wpis to `{ at, names, tried }`: brakujące ID są dobierane do istniejącego wpisu, a `tried` pamięta, o kogo już pytaliśmy — dzięki temu osoby, których nie udało się pobrać (opuściły serwer), nadal nie są odpytywane w kółko w obrębie TTL. Wcześniej cache'owana była CAŁA mapa i **pierwszy wywołujący ustalał jej zawartość na całe TTL**: odkąd `/challenge` pyta o nicki garstki kandydatów, taki wpis przez trzy minuty podawałby `/subscribe` te kilka osób zamiast pełnej listy, a reszta lądowałaby na `username` z rankingu zamiast nicku serwerowego. Zwracana mapa może zawierać ID spoza zapytania (dołożone wcześniej) — wywołujący i tak czytają ją po `get(userId)`

⚠️ **Wcześniej była tu pętla z `await targetGuild.members.fetch(player.userId)` na KAŻDY wpis rankingu** — tyle żądań do Discorda, ile wpisów, jedno po drugim. Przy kilkuset graczach lista otwierała się kilkanaście sekund i dłużej, a przy rate limicie jeszcze gorzej. Dokładając nowe miejsce, które potrzebuje nicków całej listy, użyj tego helpera zamiast pojedynczych `members.fetch(id)` w pętli.

**⚠️ Jednocześnie można prowadzić NAJWYŻEJ DWA wyzwania** (`MAX_ACTIVE_PER_PLAYER = 2`), przy czym **na jednym bossie tylko jedno** (`MAX_ACTIVE_PER_BOSS = 1` — patrz „Terminy i limity" wyżej). Slot zajmuje wyzwanie w toku (obojętnie po której stronie) **oraz WYSŁANE zaproszenie** czekające na odpowiedź. **OTRZYMANE zaproszenia slotu NIE zajmują** — inaczej gracz z dwoma zaproszeniami od różnych osób nie mógłby przyjąć żadnego, bo samo ich posiadanie wypełniałoby limit. Sprawdzane w dwóch miejscach: przy `chal_ok` (rzucający → `challengeErrLimit`, przeciwnik → `challengeErrOpponentBusy`) i przy `chal_acc_{id}` (przyjmujący → `challengeErrAcceptLimit`). **Zajętość przeciwnika sprawdzana PRZED wysłaniem DM** — bez tego dostawałby zaproszenie, którego i tak nie mógłby przyjąć, a rzucający czekałby do jego wygaśnięcia.

**Rekord powstaje dopiero po UDANEJ wysyłce DM.** Gdy przeciwnik ma zamknięte wiadomości prywatne, wpis jest kasowany (`discard`), a wyzywający dostaje `challengeErrDmClosed`.

### DM z zaproszeniem

Embed z **ikoną bossa jako thumbnail** (`_challengeBossImage` → `data/boss_images/`), zasadami i terminem odpowiedzi. Przyciski `chal_acc_{id}` / `chal_rej_{id}` → po kliknięciu zamieniane na **nieaktywny znacznik** `chal_done_{id}`.

Wyzywający dostaje o decyzji **embed** (zielony przy przyjęciu, czerwony przy odrzuceniu) z **avatarem przeciwnika jako miniaturą** — nie zwykłą wiadomość tekstową.

**Uprawnienie sprawdzane po `challenge.opponent.userId`, nie po customId** — customId nie jest źródłem prawdy.

### Zaliczanie wyników w `/update`

Wpięcie w `_runUpdateFlow` **tuż po ustaleniu `bestScore`/`bossName`/`userName`, PRZED rozgałęzieniem** na ścieżki (duplikat cross-server / brak rekordu / nowy rekord) — dzięki temu liczy się każdy pozytywnie zweryfikowany screen, niezależnie od tego, czy padł rekord. `/test` (dryRun) **nie zalicza niczego**.

⚠️ **DO WYZWANIA LICZY SIĘ WYNIK POJEDYNCZEJ WALKI (`aiResult.runScore`), NIE `Best`.**

Ekran wyników ma trzy liczby: **wynik tej walki** (nad linią „Best"), **Best** (rekord gracza) i **Total**. Ranking, rekordy bossów i historia biorą **Best** — i tak zostaje. Wyzwania biorą **wynik walki**, bo Best jest **identyczny na każdym kolejnym screenie po ustanowieniu rekordu**: gdyby najlepszy wynik padł jako pierwszy z trzech, pozostałe dwa zdjęcia niosłyby tę samą liczbę i pojedynek policzyłby jeden rezultat trzy razy (a blokada powtórek odrzuciłaby dwa z trzech).

- Wartość czyta `aiOcrService._extractData` jako **CZWARTĄ, OSTATNIĄ linię** odpowiedzi AI (`PROMPT_VERSIONS['extract-data-eng'] = 'v3'`). ⚠️ **Stoi na końcu, choć na ekranie jest nad „Best", i to jest ZAMIERZONE** — gdyby weszła w środek, model gubiący jedną linię przesunąłby indeksy i `score` (Best) dostałby cudzą wartość, czyli ranking zapisałby zły rekord po cichu. Na końcu brak linii oznacza tylko brak wyniku walki; boss, Best i Total zostają nietknięte
- **Walidacja:** ta sama `normalizeScore` i ten sam wzorzec jednostki co dla Besta, plus `runScore <= Best` i `runScore <= Total` — jedna walka nie może przebić rekordu ani sumy, więc przekroczenie oznacza pomyłkę modelu i wartość jest odrzucana (`runScore: null`), a nie zapisywana
- **Brak `runScore` NIE odrzuca screena** — ranking dostaje Besta jak zawsze, a wyzwanie po prostu nic nie zalicza. `_registerChallengeScore` zwraca wtedy `noRunScore: true` i gracz widzi żółty embed `challengeNoticeNoRunScore` z prośbą o ponowne wrzucenie. **Komunikat leci tylko wtedy, gdy gracz faktycznie ma pojedynek na tym bossie** (przy nierozpoznanym bossie — jakikolwiek pojedynek w toku, bo nie ma po czym dopasować nazwy); inaczej byłby to szum dla kogoś, kogo wyzwania nie dotyczą
- ⚠️ **Nigdy nie podstawiaj `bestScore` jako zapasu, gdy `runScore` jest puste** — to dokładnie ten błąd, dla którego czytamy tę czwartą wartość

- Liczą się wyłącznie wyniki z timestampem **po `respondedAt`** (akceptacji)
- Uczestnik z kompletem 3 wyników nie przyjmuje kolejnych
- Jeden wynik zalicza się do WSZYSTKICH aktywnych wyzwań tego profilu na tym bossie
- **⚠️ TEN SAM WYNIK NIE LICZY SIĘ DWA RAZY.** Bez tej blokady wystarczyło wrzucić ten sam screen trzy razy, żeby wypełnić wszystkie sloty jednym rezultatem — wynik nierekordowy też jest zaliczany do wyzwania, więc powtórka nie odbijała się o żadną inną blokadę (cooldown `/update` tylko ją opóźnia). Porównujemy **`scoreValue`, nie napis** — `1000B` i `1T` to ten sam wynik. Zakres celowo **per UCZESTNIK**: przeciwnik może legalnie trafić tę samą wartość. Odrzucona powtórka wraca w `registerScore().duplicates` i gracz dostaje o niej komunikat (`challengeNoticeDuplicate`) — inaczej nie wiedziałby, czemu licznik nie drgnął. Po cofnięciu wyniku ta sama wartość może wejść ponownie (wypada z tablicy, więc blokada jej nie widzi)

**Gdzie widać informację — OSOBNY EMBED z ikoną postępu:**

`_buildChallengeEmbed(result, msgs)` składa embed z opisu `_challengeNoticeValue(notices, pending, msgs, duplicates)` (zaliczone wyniki i odrzucone powtórki w jednej treści), a `_appendChallengeEmbed(embeds, files, icon)` wstawia go jako **PRZEDOSTATNI embed KAŻDEJ ścieżki odpowiedzi** `_runUpdateFlow`: nowy rekord, „tylko rekord bossa", duplikat cross-server, „brak rekordu" i nierozpoznany boss bez poprawy. Gdy wynik nie ruszył żadnego wyzwania, embed w ogóle nie powstaje (`null`) — tak samo w `/test` (dryRun).

⚠️ **Wstawiany przez `splice(length - 1, 0, …)`, nie `push`.** Ostatni embed każdego stosu (Informacje systemowe przy rekordzie, powód przy „brak rekordu") niesie zrzut ekranu i domyka ogłoszenie — wyzwanie idzie tuż przed nim. Przy stosie jednoelementowym `Math.max(0, …)` sprowadza to do wstawienia na początek.

- **Nazwa autora BEZ ikony mieczy** — `challengeNoticeField` to samo `Wyzwanie` / `Challenge`. Emoji ⚔️ stało w tekście dokładnie tam, gdzie obok wyświetla się obrazek bossa, więc dublowało ikonę
- **Dwie ikony, dwa różne pytania:** `author.iconURL` (lewy górny róg) = **zdjęcie bossa** (`_challengeBossImage` → `data/boss_images/`), `thumbnail` (prawy górny róg) = **generowany pierścień postępu** (`generateChallengeProgressIcon(count, total)` w `positionIconService.js`) — `1/3`, `2/3`, `3/3`, a dla wyniku czekającego na zatwierdzenie bossa `?`. Pełny okrąg rysowany jest elementem `<circle>`, nie łukiem — łuk o kącie 360° degeneruje się do punktu
- **Gdy bossa nie ma w bazie zdjęć**, `author` bierze pierścień — pusty lewy róg wyglądałby na błąd. Wszystkie wpisy dotyczą tego samego bossa (wynik ma jedną nazwę), więc nazwa brana jest z pierwszego
- ⚠️ **Załączniki doklejane z pominięciem duplikatów nazwy** (`_pushUniqueFiles`) — Embed 3 stosu ogłoszenia (ranking bossa) używa **dokładnie tego samego pliku**, a dwa załączniki o tej samej nazwie w jednej wiadomości to nieprzewidywalne rozwiązanie `attachment://`. `setAuthor` i tak wskazuje po nazwie, więc wystarczy jeden
- **Kolor:** pomarańczowy `0xE67E22` w trakcie · zielony `0x57F287` przy komplecie · żółty `0xFEE75C` gdy wynik czeka na admina
- **Licznik z PIERWSZEGO wpisu** (`notices`, w razie braku `duplicates`) — przy limicie 1 wyzwania na bossa jeden wynik trafia do jednego wpisu, więc ikona pokazuje najwyżej zaawansowane wyzwanie, a treść wylicza wszystkie
- **Błąd generowania ikony nie gubi informacji** — embed leci wtedy bez obrazka, z samym tytułem tekstowym
- ⚠️ **Limit 6000 znaków przeliczany PO doklejeniu** (`_appendChallengeEmbed` woła `rankingService._enforceEmbedCharLimit`). `createRecordEmbeds` przycina stos do 5800, czyli z buforem 200 — a sam opis o zaliczeniu wyniku potrafi go zjeść w całości
- ⚠️ **Obie ikony zwracane jako BUFORY**, `AttachmentBuilder` budowany osobno na każdą wysyłkę (`_challengeIconFiles`) — ten sam komplet leci w ogłoszeniu i w DM subskrybentów, a jednego `AttachmentBuilder` nie da się wysłać dwa razy
- **Brak rekordu ogólnego i brak rekordu bossa** (nic nie idzie publicznie) → ten sam embed doklejany do `createNoRecordEmbeds` **oraz DM** do gracza (`_sendChallengeScoreDm`)

**⚠️ Zastąpiło to dwa dawne miejsca:** pole `⚔️ Wyzwanie` w Embedzie 4 (`systemNotices`) i dopisek w `reasonText` embeda „brak rekordu". Metoda `_challengeSystemNotice` została usunięta — informacja jest w jednym miejscu, nie w trzech.

**Avatar przeciwnika w embedach wyzwania** (`_challengeOpponentAvatar(client, entries)`) — miniatura DM-ów o zaliczeniu wyniku, doliczeniu po zatwierdzeniu bossa i o przyjęciu/odrzuceniu wyzwania. Embed ma **jeden** slot na miniaturę, a wynik może zaliczyć się do kilku wyzwań na tym samym bossie naraz — przy więcej niż jednym przeciwniku avatar jest **pomijany**, zamiast arbitralnie wybierać pierwszego z brzegu. Usunięty profil też go nie dostaje (w treści widnieje „Profil usunięty", więc czyjaś twarz obok byłaby myląca), a błąd `users.fetch` kończy się `null`, nie wywrotką.

### Nierozpoznana nazwa bossa → wynik oczekujący

Gdy `aiResult.wasUnknownBoss === true`, wynik **nie jest zaliczany od razu** — trafia do `pendingScores` (`addPendingScore`), ale **tylko gdy gracz ma jakiekolwiek wyzwanie w toku**. Embed pokazuje `challengeNoticePending` („czeka na zatwierdzenie przez administratora"), **żaden DM na tym etapie nie wychodzi**.

Doliczenie następuje dopiero, gdy admin zmapuje alias — `_resolveChallengePendingBoss(client, rawBoss, englishBoss)` wołane z **OBU** ścieżek mapowania, obok istniejącej `migrateBossName`:
- `_handleBossMapLangSel` — alert o nieznanym bossie (`boss_mapm_*`)
- `_handleBossCfgAddLangSel` — panel `🎯 Konfiguracja bossów`

Dopiero wtedy gracz dostaje DM (`challengeDmVerifiedTitle`). Wynik, który nie trafił do żadnego wyzwania, jest porzucany z DM-em wyjaśniającym **jednym z trzech powodów**:
- `duplicate` — ten sam `scoreValue` jest już zaliczony do tego wyzwania
- `too_late` — wyzwanie na tym bossie **było**, ale zdążyło się rozstrzygnąć (albo komplet wyników był już zebrany)
- `no_challenge` — gracz nie ma i nie miał wyzwania na tym bossie

⚠️ **Powód rozstrzyga się po WSZYSTKICH statusach wyzwań** (`getForPlayer`), nie po aktywnych. Po rozstrzygnięciu wyzwanie nie jest już `active`, więc sprawdzanie samych aktywnych dawałoby zawsze `no_challenge` — spóźniony gracz dostawałby komunikat „nie masz takiego wyzwania" zamiast „wyzwanie już się rozstrzygnęło".

**Wynik oczekujący NIE blokuje rozstrzygnięcia** — decyzja świadoma. Wyzwanie może zamknąć się bez niego, a spóźniony wynik jest wtedy porzucany z powyższym komunikatem.

### Rozstrzygnięcie i „pochwal się wynikami"

Pojedynek rozstrzyga się **po sumach `scoreValue`** — wyższa wygrywa, równe = **remis**. Dzieje się to w dwóch momentach:

1. **Obaj uczestnicy mają po 3 wyniki** — `registerScore` domyka wyzwanie od razu
2. **Minęły 72 h, a komplet zebrała PRZYNAJMNIEJ JEDNA strona** — `sweep()` rozstrzyga po aktualnych sumach

⚠️ **Sam komplet nie przesądza o wygranej — decyduje suma.** Gracz z trzema słabszymi wynikami przegra z kimś, kto wrzucił jeden lepszy: komplet jest warunkiem *rozstrzygnięcia*, nie *zwycięstwa*. `unresolved` zostaje wyłącznie na sytuację, w której po 72 h kompletu nie ma **nikt** — wtedy nie ma czego porównywać i nikt nie dostaje osiągnięć.

Wyniku **NIE ogłaszamy automatycznie** — zamiast tego:

- **DM do OBU graczy**, każdy w języku swojego serwera: embed z ikoną bossa, wynikami i sumami obu stron, osobistym werdyktem (`challengeResultWin`/`Loss`/`Draw`) i linią zwycięzcy
- **Nazwa serwera przy każdym graczu, gdy pojedynek łączy DWA serwery** (`⚔️ Ala — Polski Squad`) — sama para nicków nie mówi wtedy, kto skąd jest. Przy obu graczach z jednego serwera nazwa niczego nie wnosi, więc jej nie ma. Wymaga przekazania `client` do `_buildChallengeResultEmbed` (robią to wszystkie cztery wywołania: DM rezultatu, ogłoszenie po „pochwal się", DM o nierozstrzygnięciu). Etykieta pola przycinana do 256 znaków — limit Discorda
- Pod DM **jednorazowy przycisk** `📢 Pochwal się wynikami na swoim serwerze` (`chal_share_{id}_{c|o}`):
  - publikuje ten sam embed na kanale bota (`allowedChannelId`) serwera **tego** gracza, zbudowany **w języku serwera docelowego**, nie odbiorcy DM
  - potem przycisk zmienia się w **nieaktywny** `✅ Pochwalono się`
  - stan `result.shared.{challenger|opponent}` siedzi w pliku, więc przycisk działa raz **także po restarcie bota**
  - **adres opublikowanej wiadomości ląduje w `result.announcements[]`** (`attachSharedMessage`) — cofnięcie wyniku kasuje po niej ogłoszenie
  - **⚠️ Ten sam serwer = JEDNO ogłoszenie, oba przyciski gasną naraz.** Gdy obaj gracze siedzą na tym samym serwerze, publikacja przez jednego zamyka sprawę także drugiemu: `markShared` zwraca `alsoClosed` z drugą stroną, a handler od razu wygasza jej przycisk w DM (`_disableChallengeShareButton`). Wcześniej przycisk zostawał aktywny i dopiero kliknięcie kończyło się komunikatem „już opublikowano". Kliknięcie mimo wszystko (wyścig dwóch kliknięć) nadal jest bezpieczne — `sharedGuildIds` nie dopuści duplikatu ogłoszenia
  - **Różne serwery = każdy publikuje osobno, u siebie** — wtedy `alsoClosed` jest `null` i przycisk drugiego gracza zostaje aktywny

Osiągnięcia: zwycięzca `+1 wygrana`, przegrany `+1 przegrana`. **Remis, `unresolved` i `cancelled` nie naliczają niczego.**

### Sweep (co godzinę + przy starcie)

`challengeService.start(onEvents)` uruchamiany z `index.js` przez `interactionHandler.startChallengeSweep(client)`:

| Warunek | Efekt |
|---|---|
| `pending` starsze niż 24 h | → `expired`, DM do wyzywającego, wygaszenie przycisków w DM zaproszenia |
| `active` starsze niż 72 h, **komplet po którejś ze stron** | → `finished` po sumach, dalej normalną drogą `_finishChallenges` (osiągnięcia + DM z werdyktem + „pochwal się") |
| `active` starsze niż 72 h, **kompletu nie ma nikt** | → `unresolved`, DM do obu z aktualnymi wynikami, bez zwycięzcy i bez osiągnięć |
| `pendingScore` starszy niż 72 h | porzucony, DM do gracza |

### Spójność z profilami

- **`renamePlayerKey(from, to)` dopisany do `_migratePlayerKey`** — plik jest kluczowany `playerKey`, a numery slotów zjeżdżają po usunięciu profilu (2→1, 3→2). Bez tego dane osierocieją
- **`_cancelChallengesForProfile(client, playerKey)` wołane z `_purgeProfileData`:** wyzwania `pending`/`active` → `cancelled` z DM do przeciwnika; wpisy **rozstrzygnięte ZOSTAJĄ** (to również historia przeciwnika), a uczestnik dostaje flagę `profileDeleted: true`
- **⚠️ W pliku trzymamy FLAGĘ, nie napis „Profil usunięty".** Etykietę składa `participantName(participant, msgs)` w języku odbiorcy (`challengeDeletedProfile` → PL `🗑️ Profil usunięty`, EN `🗑️ Deleted profile`). Zapisanie polskiego stringa do pliku złamałoby dwujęzyczność na serwerach `eng`
### Cofnięcie wyniku otwiera wyzwanie z powrotem

`removeScore(playerKey, timestamp, { andAfter })` → `{ removed, reopened }`. Wołane z dwóch miejsc: `_cvRemoveRecord` (przycisk cofnięcia gracza/admina, CV, panel „Analizuj" — z `andAfter: true`, bo tamta ścieżka tnie historię OD cofniętego rekordu w górę) oraz panelu `🧹 Usuń wynik` (pojedynczy wpis, bez `andAfter`).

- **Wynik wypisywany jest z wyzwań o statusie `active`, `finished` i `unresolved`** (`REVERTABLE_STATUSES`). Wyzwanie zamknięte KOMPLETEM WYNIKÓW albo BRAKIEM CZASU traci wraz z cofniętym wynikiem podstawę rozstrzygnięcia, więc wraca do `active` (`winner`, `finishedAt`, `finishedBy` i `result` czyszczone). `declined`, `expired` i `cancelled` zamknęła decyzja człowieka, nie wynik — **tych nie wskrzeszamy**
- ⚠️ **`expiresAt` NIE jest przedłużane.** Gdy 72 h zdążyło minąć, najbliższy przebieg sweepa zamknie wyzwanie jako `unresolved` ze standardowym powiadomieniem. Dorysowanie czasu, którego nikt nie przyznał, byłoby gorsze niż uczciwe „skończyło się"
- **`reopened` niesie stan sprzed otwarcia** — adresy DM-ów i ogłoszeń oraz strony do cofnięcia osiągnięć. Sprząta po nim `_undoChallengeResolution(client, reopened)` w `interactionHandlers.js`:
  1. **kasuje DM z rezultatem** u obu graczy (`result.dm[side]`)
  2. **kasuje ogłoszenia** opublikowane przyciskiem „pochwal się" (`result.announcements[]`)
  3. **cofa osiągnięcia** — `achievementService.revertChallengeOutcome(guildId, playerKey, 'challengesWon'|'challengesLost')` dekrementuje licznik (podłoga 0) i odbiera osiągnięcia o ID `chal_*`, których warunek przestał być spełniony. Bez tego ponowne rozstrzygnięcie naliczyłoby wygraną drugi raz
  4. **odświeża Centrum Dowodzenia** (`adminPanelService.refresh()`) — sekcja ⚔️ Wyzwania pokazuje wyzwanie znów w toku
- **Nowego powiadomienia „wynik cofnięty" NIE wysyłamy** — komunikat o cofnięciu rekordu idzie osobno, ze ścieżki cofania wyniku. Werdykt po prostu znika
- ⚠️ **Adresy wiadomości muszą być ZAPISANE, żeby dało się je skasować.** `attachResultDm(id, side, channelId, messageId)` (DM rezultatu — także tego po 72 h bez kompletu po obu stronach, `_handleChallengeSweep`) i `attachSharedMessage(id, guildId, channelId, messageId)` (ogłoszenie z „pochwal się"). `sharedGuildIds` mówi tylko, ŻE ogłoszenie poszło, nie GDZIE ono jest — dokładając kolejne miejsce publikacji rezultatu, zapisz jego adres tak samo
- **Po ponownym otwarciu ta sama wartość wyniku może wejść jeszcze raz** — wypadła z tablicy, więc blokada powtórek jej nie widzi

**Przycisk „↩️ Cofnij wynik wyzwania" (`ocr_chal_undo_{playerKey}_{tsMs}`, head admin)** — pod embedem OCR typu `challenge`, czyli tam, gdzie rekord NIE padł, a wynik i tak wszedł do wyzwania.

- **To NIE jest `ocr_revert_*`.** Tamten cofa REKORD i stoi na sesji `recordRevertService`, której w tej sytuacji w ogóle nie ma — jedyne, co ten wynik zmienił, to licznik w wyzwaniu. Na ścieżkach z rekordem (`new_record`, `boss_record`, …) osobny przycisk jest zbędny: `_cvRemoveRecord` i tak woła `removeScore` z `andAfter`
- **Adres wpisu siedzi w całości w customId** (profil + znacznik czasu), więc przycisk działa też po restarcie bota, bez sesji w pamięci. Znacznik jako **ms epoch** — ISO ma dwukropki, a te rozbijają parsowanie customId w innych miejscach kodu; `playerKey` może zawierać `#`, więc odczyt idzie od **ostatniego** `_`, nie przez `split`
- Po kliknięciu: `removeScore` → `_undoChallengeResolution` (kasuje DM-y, ogłoszenie i osiągnięcia, gdy wyzwanie było zamknięte) → notka `↩️ Cofnięto z wyzwania` w embedzie, wygaszony przycisk, wpis w dzienniku akcji i odświeżenie Centrum Dowodzenia
- **`removed === 0` gasi przycisk bez błędu** — wpis mógł zniknąć wcześniej (cofnięcie rekordu, usunięcie profilu, sweep); admin dostaje ephemeral z wyjaśnieniem zamiast wyglądającej na awarię ciszy

### Zakładka `⚔️ Wyzwania` w `/profile`

Rząd 1 mieści 5 przycisków, więc układ się przesunął:
- **Własny profil, rząd 1:** `👤 Profil` · `🎯 Bossowie` · `🏆 Osiągnięcia` · `⚔️ Wyzwania` · `🔔 Subskrypcje`; **`🔍 Szukaj gracza` zeszło do rzędu narzędzi** (to narzędzie, nie zakładka)
- **Cudzy profil, rząd 1:** `👤` · `🎯` · `🏆` · `⚔️` · `🔍 Szukaj gracza`

Widok składa się z czterech części:

1. **Bilans** (opis embeda) — `🏆 wygrane · 💔 przegrane · 🤝 remisy · ❓ nierozstrzygnięte · ⚔️ rzucone · 🛡️ przyjęte`
2. **📨 Rzucone — czekają na odpowiedź** — zaproszenia WYSŁANE przez tego gracza, z czasem, jaki został przeciwnikowi (`inviteExpiresAt` jako `<t:…:R>`). Otrzymanych zaproszeń tu nie ma: obsługuje je przycisk w DM i tak czy owak nie zajmują slotu, więc nie są stanem gry tego gracza
3. **⚔️ W toku** — przeciwnik i boss, a pod spodem **licznik screenów ORAZ aktualna suma obu stron**: `**2/3** (12.5Sx) : **1/3** (8.1Sx)`, w trzeciej linii termin `⏳ <t:…:R>`. Kolejność jak w historii — najpierw moja strona, potem przeciwnik. **Sam licznik nie mówi, kto prowadzi**, dlatego suma stoi obok niego. Wyniki oczekujące na zmapowanie bossa idą jedną notką pod listą, bo nie są jeszcze przypisane do konkretnego wyzwania
4. **📜 Historia** — 8/stronę, paginacja `profile_chal_prev`/`profile_chal_next`

⚠️ **Punkty 2 i 3 pokazujemy WYŁĄCZNIE na własnym profilu.** To stan gry w toku, a nie dorobek — na cudzym profilu byłby podglądaniem cudzej kartki (widać by było, ile przeciwnik zdążył wrzucić i z jakim wynikiem). Bilans i historia są jawne dla każdego.

Stan `chalPage`/`chalMaxPage` w `_profileStates`; komunikaty przez **`_msgsByLang(state.lang)`**, nie `this.msgs(guildId)` — widok profilu trzyma własny język (`_getProfileLang`), który nie musi pokrywać się z językiem serwera wywołania.

**CustomIDs `/profile`:** `profile_challenges` | `profile_chal_prev` | `profile_chal_next` — jak każdy nowy `profile_*` **MUSZĄ być na whiteliście** w `handleButtonInteraction`, inaczej przycisk nie zadziała.

### Osiągnięcia (23, sekretne)

Kategoria **`explorer`** (`hidden: true`) — bez zmian w UI kategorii (rząd ma już komplet 5 przycisków), a `_trackExplorer` odblokowuje wyłącznie tę kategorię. Dodatkowa zaleta: `clearUserAchievements` i `clearRecordAchievementsAfter` **pomijają `explorer`**, więc cofnięcie wyniku nie odbiera osiągnięć za wyzwania.

Liczniki w `progress`: `challengesSent`, `challengesAccepted`, `challengesWon`, `challengesLost`, `challengesDraws`.
Metody: `trackChallengeSent/Accepted/Won/Lost/Draw(guildId, playerKey)` — naliczane na serwerze danego uczestnika.

**Remis nalicza osiągnięcie OBU stronom** (`_applyChallengeAchievements`: `finished` bez zwycięzcy → `trackChallengeDraw` dla obu). **`unresolved` nadal nie nalicza niczego** — pojedynek się nie odbył. Cofnięcie wyniku, które otwiera zremisowane wyzwanie, zdejmuje je obu stronom: `removeScore` oddaje w `reopened` flagę `wasDraw` (remis to `finished` z `winner === null`, więc same `winnerSide`/`loserSide` by go nie wykryły), a `_undoChallengeResolution` woła `revertChallengeOutcome(..., 'challengesDraws')`.

Progi **1/3/5/10/20/50/100** dla rzuconych (`chal_sent_*`), przyjętych (`chal_acc_*`) i wygranych (`chal_win_*`) + jedno za przegraną (`chal_lost_1`):

| Grupa | Nazwy PL / EN (od najniższego progu) |
|---|---|
| Rzucone | Rękawica/The Gauntlet ⬜ · Zadziora/Scrapper 🟩 · Prowokator/Provocateur 🟩 · Podżegacz/Instigator 🟦 · Pogromca Spokoju/Peacebreaker 🟪 · Wojewoda/Warlord 🟧 · Zwiastun Wojny/Herald of War 🔴 |
| Przyjęte | Podjęte Wyzwanie/Challenge Accepted ⬜ · Honorowy/Honorable 🟩 · Nieustępliwy/Unyielding 🟩 · Gladiator/Gladiator 🟦 · Mur Nie Do Przejścia/Immovable Wall 🟪 · Lew Areny/Lion of the Arena 🟧 · Zawsze Gotowy/Ever Ready 🔴 |
| Wygrane | Pierwsza Krew/First Blood 🟩 · Triumfator/Triumphant 🟩 · Pogromca/Vanquisher 🟦 · Dziesięciu Pokonanych/Ten Fallen 🟦 · Mistrz Areny/Arena Master 🟪 · Kolekcjoner Czaszek/Skull Collector 🟧 · Legenda Pojedynków/Duel Legend 🔴 |
| Przegrana | Gorzka Lekcja/Bitter Lesson ⬜ |
| Remis | Godny Przeciwnik/Worthy Opponent 🟦 |

### Pułapki magazynu (`jsonStore`)

- `register(plik, { defaultValue: () => ({ challenges: {}, pendingScores: {} }) })` — kształt **obiektu**; `_data()` dodatkowo domyka brakujące klucze
- O istnieniu danych decyduje **ZAWARTOŚĆ**, nie wyjątek — `getOrLoad` przy braku pliku nie rzuca
- Każdy zapis przez `store.mutate()` (kolejka pod jednym zamkiem) — wyniki z dwóch serwerów mogą wpaść równocześnie
- `id` = 8–11 znaków base36, żeby `chal_share_{id}_{c}` zmieścił się w limicie 100 znaków customId
- **Ikona bossa zwracana jako BUFOR** (`_challengeBossImage` → `{buffer, name, thumb}`), a `AttachmentBuilder` budowany osobno dla każdej wysyłki (`_challengeBossFiles`) — ten sam obrazek leci w DM do obu graczy i w ogłoszeniu na serwerze
- **Embed wyzwania tak samo** (`_buildChallengeEmbed` → `{embed, buffer, name, boss}`, `_challengeIconFiles`) — pierścień postępu ORAZ zdjęcie bossa lecą w ogłoszeniu i w DM subskrybentów, a `_pushUniqueFiles` pilnuje, żeby zdjęcie bossa nie trafiło tam dwa razy

### CustomIDs

`cc_chal_history` | `cc_chal_hsp_{offset}` | `cc_chal_hsrv` | `cc_chal_hpg_{guildId}_{page}` | `cc_chal_pending` | `cc_chal_ppg_{page}` | `cc_chal_finish` | `cc_chal_fpg_{offset}` | `cc_chal_fsel` | `cc_chal_fok_{id}` | `cc_chal_close` (Centrum Dowodzenia)

`chal_pl` | `chal_page_{offset}` | `chal_boss` | `chal_bpage_{n}` | `chal_bpage_info` | `chal_ok` | `chal_no` | `chal_acc_{id}` | `chal_rej_{id}` | `chal_share_{id}_{c|o}` | `chal_done_{id}` (nieaktywny znacznik)

`ocr_chal_undo_{playerKey}_{tsMs}` — przycisk „↩️ Cofnij wynik wyzwania" pod embedem head admina typu `challenge` (kanał logów OCR)

⚠️ **Nazwa zaczyna się od `ocr_`, nie `chal_`, i to jest zamierzone** — wszystkie `chal_*` routowane są przed głównym `try`, w ścieżce dla przycisków z DM (bez `interaction.guild` i `interaction.member`). Ten przycisk stoi na kanale serwera i wymaga sprawdzenia head admina, więc idzie zwykłą ścieżką, obok `ocr_revert_*`.

**⚠️ Formy bezrodzajowe w komunikatach PL** — polska forma męska („przyjął", „Wygrałeś") misgenderuje każdego, kto nie jest mężczyzną. Dlatego: `podejmuje`/`odrzuca` zamiast `przyjął`/`odrzucił`, `Zwycięstwo!`/`Porażka.` zamiast `Wygrałeś!`/`Przegrałeś.`, `została zatwierdzona przez administrację` zamiast `Administrator zatwierdził`. Dokładając komunikat, nie wprowadzaj z powrotem form rodzajowych (ta sama zasada co w rzędzie „ostatnia reakcja" pod rozgłoszeniami).

**⚠️ Wszystkie `chal_*` routowane są PRZED głównym `try` w `handleButtonInteraction`** — przyciski w DM nie mają `interaction.guild` ani `interaction.member`, więc nie mogą przejść przez kod zakładający kontekst serwera. Select menu `chal_*` routowane są przed sprawdzeniem `isAllowedChannel` (komenda head admina działa na dowolnym kanale).
