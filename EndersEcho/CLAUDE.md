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
     - **Walidacja długości cyfr** (`normalizeScore` w `aiOcrService.js`): jeśli wynik z jednostką (K/M/B/T/Q/Qi/Sx/Sp) ma więcej niż 5 cyfr przed jednostką LUB za dużo miejsc po przecinku → wynik **odrzucany jako podróbka** (`error: 'FAKE_PHOTO'`, `score: null`), NIE obcinany. Wcześniej funkcja obcinała nadmiarowe cyfry (`substring(0, 5)`), co potrafiło zaniżyć poprawnie odczytany wynik (np. AI poprawnie odczytało `213769Q`, obcięcie zamieniało go w błędny `21376Q` i wynik fałszywie nie bił rekordu)
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
   - **Per-serwer:** Osobny plik `data/guilds/{guildId}/ranking.json` dla każdego serwera
   - **Globalny:** `getGlobalRanking()` — najlepszy wynik gracza ze wszystkich serwerów (z adnotacją skąd pochodzi)
   - Eksport do `shared_data/endersecho_ranking.json` (globalny, format: `{updatedAt, players: [{rank, userId, username, score, scoreValue, bossName, timestamp, sourceGuildId}]}`)
   - Eksport przy każdym zapisie i przy starcie bota
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`
   - **Tie-break przy remisie (identyczny `scoreValue`):** `compareByScoreThenTimestamp` (`utils/helpers.js`) — gracz który zdobył dany wynik **wcześniej** (starszy `timestamp`) jest wyżej; ten kto powtórzył identyczny wynik jako drugi ląduje niżej. Używane we wszystkich sortowaniach po wyniku: ranking serwera (`getSortedPlayers`), ranking globalny (`getGlobalRanking`, `saveSharedRanking`), symulacje `/test` (`simulateSortedPlayers`, `simulateGlobalRanking`), ranking per-boss (`bossRecordService.getGlobalBossRanking`, `simulateGlobalBossRanking`) oraz pomocnicze wyliczenia „poprzednia pozycja" (delta ▲/▼ w ogłoszeniach rekordu)

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
   - **Ogłoszenie rekordu — STOS 4 EMBEDÓW** (`rankingService.createRecordEmbeds` → zwraca `EmbedBuilder[]`):
     - Wszystkie embedy wysyłane w **jednej wiadomości** (`followUp({ embeds, files })`) — pojawiają się jednocześnie, atomowo (jeden `message.id`). Komponenty (przycisk CV „Zgłoś") renderują się pod całą wiadomością, czyli pod ostatnim (4.) embedem.
     - **Kolor jednolity** dla wszystkich 4 embedów wg pozycji gracza (`getPositionColor`): 🥇 złoty (TOP1), 🥈 srebrny (TOP2), 🥉 brązowy (TOP3), niebieski (TOP4-10), zielony (TOP11+ / brak pozycji)
     - **Embed 1 — 🏆 Gratulacje (BEZ bossa):** tytuł `🏆 GRATULACJE!`, author = ikona+nazwa roli TOP, thumbnail = avatar gracza, opis = postęp (`stary ➜ nowy (+X)`) + **pozycja w klanie** (`medal #N (+awans)`) + **pozycje w rankingach ról** (🎖️) + czas od ostatniego rekordu; pola: `🎉 Nowe osiągnięcia`, `🔔 SUBSKRYPCJE: N`
     - **Embed 2 — 🌍 Ranking globalny:** tytuł `globalRankingEmbedTitle`, opis = snippet globalny, **thumbnail = generowana grafika z numerem NOWEJ pozycji globalnej** (`services/positionIconService.js`, SVG→PNG przez sharp, plik `global_position.png` via `attachment://`; tiery: #1 złoty medal z koroną+laurem+czerwoną wstęgą, #2 srebrny medal z niebieską wstęgą, #3 brązowy medal z zieloną wstęgą, #4–10 blurple tarcza z gwiazdą, #11–30 fioletowy heksagon, #31–100 stalowy okrągły badge, #101+ grafitowy okrąg; fallback przy błędzie generowania = statyczna ikona CDN), `image` = wykres progresu (`score_history.png`, ten sam co w `/ranking`, gdy ≥2 wpisy historii), footer z ikoną globalną. Pozycja liczbowa pochodzi z `globalSnippetData.newGlobalPosition` (zwracana przez `globalTop10Service.buildSnippetFieldData`). Grafika generowana i dołączana w `/update`, `/test` (dryRun) i panelu „Analizuj"; DM subskrybentów odtwarza załącznik pod tą samą nazwą. **Pokazywany WYŁĄCZNIE gdy zmieniła się pozycja globalna** (`globalSnippetData != null`) — gdy brak zmiany, embed jest pomijany (a wykres nie jest generowany).
     - **Embed 3 — 👾 Ranking bossa:** tytuł `bossRankingEmbedTitle` z `{bossName}`, thumbnail = **ikona bossa** (`bossAliasService.getBossImagePath` → `data/boss_images/`, fallback ikona bota), opis = `👾 Rekord na bossie` (`stary ➜ nowy` / „pierwszy wynik") + snippet rankingu bossa. Pokazywany gdy pobito rekord bossa (`isNewBossRecord && bossName && !wasUnknownBoss`).
     - **Embed 4 — ℹ️ Informacje systemowe:** tytuł `systemInfoEmbedTitle`, `image` = **screenshot przesłany do analizy**, footer z timestampem. Opis (description) i pola (fields) zależą od sytuacji:
       - **Opis domyślny** (brak jakichkolwiek uwag): `systemInfoAllGood` („Zdjęcie zweryfikowane poprawnie.\nWynik zapisany w rankingu.")
       - **Opis nadpisany** (`specialDescription`, pierwsze dopasowanie wygrywa): `manualVerificationNote` (panel „Analizuj") > `crossServerScoreRemovedNote` (nowy wynik ściśle lepszy niż na innym serwerze — treść = `systemInfoAllGood` + notka `crossServerScoreRemovedNotice` z nazwą starego i nowego serwera) > `crossServerMigratedNote` (dokładne wyrównanie wyniku z innego serwera — notka `crossServerMigratedNotice`, BEZ prefiksu `systemInfoAllGood`)
       - **Pola dodatkowe** (`systemNotices`, mogą wystąpić RAZEM z opisem nadpisanym): `unknownBossRankingField`/`unknownBossRankingNotice` (nowy nierozpoznany boss), `crossServerBossKeptField`/`crossServerBossKeptValue` (rekord bossa pobity mimo duplikatu globalnego — rekord globalny zostaje na poprzednim serwerze)
       - **Ikona** (author iconURL + thumbnail, 3 stany): `manualVerificationNote` obecna → `.../emojis/1297532628395622440.webp` (zweryfikowano manualnie); jakiekolwiek inne uwagi/komunikaty → `.../emojis/1522939660278435993.webp` (nowa, statyczna); brak uwag → `.../emojis/1297531523477540894.webp` (domyślna, animowana)
     - **Załączniki** (`files`): `[screenshot, score_history.png?, bossImage?]`
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
   - **Wykres historii rekordów** (`scoreHistoryService` + `chartService`): jeśli wywołujący ma ≥ 2 wpisy → PNG dołączony do tej samej wiadomości rankingowej. **Okno czasowe: max ostatni rok** (starsze wpisy odcinane wewnątrz `generateScoreHistoryChart` względem najnowszego wpisu). **Dwie strefy:** ostatnie 3 miesiące = wszystkie wpisy (dedup per dzień, najwyższy wynik dnia, kropki); starsze niż 3 miesiące = **1 punkt per miesiąc (najwyższy wynik miesiąca, romby)** — strefa archiwum z ciemniejszym tłem, przerywaną granicą i podpisami „max / mies." / „ostatnie 3 mies.". Oś X: daty rzeczywiste z etykietami miesięcy, oś Y: wyniki z jednostkami (K/M/B/T/Q/Qi/Sx/Sp). **Etykiety wyników z decluttering:** zawsze punkty miesięczne, pierwszy punkt i globalne maksimum; punkty dzienne tylko gdy odstęp ≥ 42px; ostatni punkt = **kolorowy badge (pill) z aktualnym rekordem**. Nagłówek zawiera linię statystyki wzrostu `pierwszy → aktualny (+X%)`; tytuł przechodzi przez `stripEmoji` (librsvg nie renderuje emoji). Dane persystowane w `data/guilds/{guildId}/wyniki/{userId}.json` — każde pobicie rekordu to nowy wpis. **Wykres budowany z historii ze WSZYSTKICH serwerów** (`getUserHistoryAllGuilds`) — wyniki z różnych serwerów scalane chronologicznie. Ranking serwera X usuwa gracza gdy ma lepszy wynik na innym serwerze (tylko ranking.json — historia wyników zostaje).
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
   - **78 stałych osiągnięć** w 5 kategoriach + 1 dynamiczny status (`status_top1` — rewokowany gdy wynik usunięty)
   - **Kategorie:** 🏆 Wyniki (9) · 🔁 Rekordy (8) · 🎯 Bossowie (6) · 🕵️ Eksplorator/ukryte (43) · 💎 Prestiż (13)
   - **Rarities:** ⬜ Common · 🟩 Uncommon · 🟦 Rare · 🟪 Epic · 🟧 Legendary · 🔴 Mythic
   - **Odblokowanie:** osiągnięcia score/records/bosses/prestige blokowane przy każdym nowym rekordzie; ukryte (explorer) blokowane natychmiast przy przegladzie rankingu lub subskrypcji
   - **Kasowanie częściowe:** `clearUserAchievements(guildId, userId)` — usuwa WSZYSTKIE osiągnięcia kategorii `score` i `records` oraz resetuje `recordCount`/`lastRecordAt`/`lastRecordBeatAt`; pozostałe kategorie (bosses, explorer, prestige) zostają; wywoływane przy usunięciu gracza z rankingu (panel admina + komenda `/remove` — usunięcie całego gracza)
   - **Kasowanie po timestampie:** `clearAchievementsAfter(guildId, userId, fromTimestamp, { removedRecordCount, previousRecord })` — usuwa **WSZYSTKIE** osiągnięcia (wszystkie kategorie) z `unlockedAt >= fromTimestamp` (zdobyte wcześniej zostają), dekrementuje `recordCount` o `removedRecordCount`, cofa `lastRecordAt`/`lastRecordBeatAt` do `previousRecord.timestamp`; wywoływane przy **cofaniu wyniku** (CV `_cvRemoveRecord`, panel Analizuj → Cofnij) — usuwa osiągnięcia zdobyte od momentu cofniętego rekordu; `bossesEncountered` nie jest modyfikowane (brak timestampów per boss — boss osiągnięcia będą re-przyznane przy następnym legalnym zgłoszeniu)
   - **Reset pełny:** `resetAllAchievements(guildId, userId)` — usuwa cały wpis gracza z pliku (wszystkie kategorie + cały progress); wywoływane ręcznie przez head admina z `/manage` → `🏆 Usuń osiągnięcia` → opcja "Usuń wszystkie"
   - **Usunięcie jednego:** `removeOneAchievement(guildId, userId, achId)` — usuwa tylko jedno odblokowane osiągnięcie; wywoływane przez head admina z `/manage` → `🏆 Usuń osiągnięcia` → wybór konkretnego osiągnięcia
   - **Odczyt odblokowanych:** `getUnlockedAchievements(guildId, userId)` — zwraca tablicę `[{ ...ach, unlockedAt }]` dla osiągnięć gracza; używane przez panel admina do zbudowania listy wyboru
   - **Powiadomienie:** w embeddzie rekordu pojawia się pole `🎉 Nowe osiągnięcia` WYŁĄCZNIE z osiągnięciami faktycznie odblokowanymi w danym zgłoszeniu (`processSubmission` zwraca tylko ID dodane w tym wywołaniu — `newlyUnlocked`). **NIE** filtrujemy już po `lastRecordBeatAt`: poprzedni filtr `!prevLastBeat || unlockedAt > prevLastBeat` przy `lastRecordBeatAt === null` lub niespójnych `unlockedAt` (dane legacy/odtworzone z backupu) ogłaszał ponownie WSZYSTKIE posiadane osiągnięcia ("ponowne przyznawanie"). Pole `lastRecordBeatAt` jest nadal aktualizowane (używane przez `clearAchievementsAfter`/revert), ale nie decyduje o tym, co pokazać.
   - **Persistencja:** `data/guilds/{guildId}/achievements.json` — per-serwer; przeżywa restart
   - **Serializacja zapisu (anti-race):** wszystkie operacje mutujące (`processSubmission`, `_trackExplorer` używane przez metody `track*`, `revert*`, `clear*`, `reset*`, `removeOneAchievement`) przechodzą przez kolejkę per-serwer `_enqueue(guildId, fn)` (wzorzec z `rankingService`, timeout 30s). Zapobiega to race condition: bez kolejki częste metody `track*` (wołane przy każdym podejrzeniu rankingu/subskrypcji/wyszukaniu profilu) mogły nadpisać świeży zapis `processSubmission` swoim starym snapshotem, cofając `lastRecordBeatAt` — co powodowało **ponowne ogłaszanie już posiadanych osiągnięć** w embedzie rekordu. Wszystkie metody `track*` współdzielą helper `_trackExplorer(guildId, userId, incrementFn)`.
   - **Komenda /achievements:** ephemeral embed — każda kategoria na osobnej stronie + przycisk podsumowania + przycisk "Sprawdź gracza". Wiersz 1: 5 przycisków kategorii (`🏆 Wyniki`, `🔁 Rekordy`, `🎯 Łowy`, `💎 Prestiż`, `🕵️ Eksplorator`). Wiersz 2: `📊 Podsumowanie` + `🔍 Sprawdź gracza`. Tytuł embeda = etykieta kategorii. Odblokowane: `emoji **nazwa** *(rarity)* \n└ opis — data`. Zablokowane nieukryte: `🔒 ~~nazwa~~`. Zablokowane ukryte: `🔒 **???**`. Stopka: `X/Y odblokowanych` (ukryte: `X/? odblokowanych`). Domyślna strona po `/achievements`: kategoria `score`. **Osiągnięcia cross-server:** `buildAchievementsViewGlobal(allGuildIds, userId, ...)` merguje dane ze WSZYSTKICH serwerów (`_mergeAchievements`); to samo dla `/profile` i "Sprawdź gracza".
   - **Sprawdź gracza (`ach_check_player`):** otwiera modal z polem nicku → wyszukuje cross-server przez `getGlobalRanking()` → jeśli 1 trafienie: od razu pokazuje osiągnięcia; jeśli wiele: StringSelectMenu (`ach_check_sel`). Wyświetla osiągnięcia ze **wszystkich serwerów** (`buildAchievementsViewForUserGlobal`). **Bez opisów jak zdobyć** — format: `emoji (rarity_emoji) **nazwa** *(rarity)* — data`. Przyciski nawigacji osadzają userId+guildId w customId (`ach_vc_{cat}_{userId}_{guildId}`, `ach_vo_{userId}_{guildId}`). Powrót do własnych osiągnięć przez `ach_vb`.
   - **Tracking:** `trackRankingView(guildId, userId)` — wołane w `handleRankingCommand`; `trackSubscription(guildId, userId)` — wołane w `_handleNotifConfirm`; `trackNonRecord(guildId, userId)` — wołane w `_runUpdateFlow` gdy `!isNewRecord && !dryRun`; `trackCvApproved(guildId, userId)` — wołane w CV approve handler; `trackAiAnalyzed(guildId, userId)` — wołane w `_handleAnalyzeButton` po zapisaniu wyniku; `trackProfileSearch(guildId, userId)` — wołane w `_handleProfileSearchModal` gdy znaleziono ≥1 wynik
   - **Progress:** `progress.recordCount`, `progress.bossesEncountered[]`, `progress.rankingViews`, `progress.subscriptions`, `progress.lastRecordAt`, `progress.lastRecordBeatAt`, `progress.todayRecordDate` (YYYY-MM-DD UTC), `progress.todayRecordCount`, `progress.nonRecordCount`, `progress.cvApprovedCount`, `progress.aiRescuedCount`, `progress.profileSearches`
   - **Context w processSubmission:** `ctx.scoreValue`, `ctx.isNewRecord`, `ctx.prevScoreValue`, `ctx.currentPosition` (pozycja na serwerze), `ctx.bossName`, `ctx.globalPosition` (pozycja w rankingu globalnym — 0 jeśli brak)
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

9. **Kamienie Milowe Unikalnych Graczy** — `milestoneService.js`:
   - Po każdym nowym rekordzie (`/update`, panel „Analizuj") sprawdza, czy globalna liczba unikatowych graczy (dedup po `userId` z nazw plików `wyniki/{userId}.json` na wszystkich skonfigurowanych serwerach) przekroczyła kolejną pełną setkę (100, 200, 300…)
   - **Tanie sprawdzenie w typowym przypadku:** `scoreHistoryService.getUniqueUserCount()` — tylko listing katalogów (bez parsowania JSON); pełne dane (kto był tym graczem, na jakim serwerze) pobierane wyłącznie gdy próg faktycznie przekroczono (`getAllUsersFirstEntries` + `getUserEarliestGuildEntry`)
   - **Kolejkowanie sekwencyjne** (`_queue` — Promise chain) zapobiega podwójnemu ogłoszeniu tego samego progu przy dwóch niemal równoczesnych nowych rekordach
   - **3 poziomy uroczystości** wg reszty z dzielenia: pełne tysiące (`grand`, fioletowy, korona 👑) > pełne pięćsetki (`major`, pomarańczowy, 🎊) > zwykłe setki (`standard`, złoty, 🎉)
   - **Wykres przyrostu graczy** — identyczny co do treści z wykresem generowanym przez przycisk „Wykres przyrostu” w Centrum Dowodzenia (`_handlePanelPlayerGrowth`): jedna zbiorcza krzywa `generateGlobalPlayerGrowthChart` ze znacznikami serwerów (badge z tagiem/nazwą w miejscu, gdzie dany serwer dołączył), tytułem i podtytułem „X graczy · Y pobitych wyników". **NIE** używa wariantu z podziałem krzywej na klany (`generatePerServerGrowthChart`/`generateGuildComparisonChart`). Dołączany do embeda przy KAŻDYM ogłoszeniu (co każde 100 graczy), niezależnie od poziomu progu. Renderowany raz na język (pol/eng) i buforowany w pamięci na czas wysyłki — treść tytułu/podtytułu jest wypalona w bitmapę, więc nie da się jej zlokalizować per-serwer bez ponownego renderu
   - Embed zawiera: tytuł zależny od poziomu, opis z liczbą pobitych rekordów, imieniem i serwerem gracza który jako pierwszy przekroczył próg (jeśli możliwy do ustalenia — `client.users.fetch`) oraz zaproszeniem do zapraszania zaprzyjaźnionych serwerów, avatar gracza jako thumbnail, stopkę. **Bez pól** (usunięte „Łącznie graczy" / „Następny próg" — te dane są już widoczne na wykresie)
   - Wysyłany na **wszystkie skonfigurowane serwery** (`guildConfigService.getAllConfiguredGuilds()`) na ich `allowedChannelId`, w pełni dwujęzyczny (`messages.js` — klucze `milestone*`)
   - **Persystencja:** `data/milestones.json` (`{ lastAnnounced }`) — przeżywa restart, zapobiega ponownemu ogłoszeniu już zaanonsowanego progu
   - **Bezpieczny start przy braku pliku stanu** (`_seedBaseline()`): gdy `data/milestones.json` nie istnieje (pierwsze uruchomienie funkcji lub reset pliku), `_lastAnnounced` NIE zaczyna od 0 — zamiast tego cicho ustawiany jest na aktualny pełny próg (bez wysyłki ogłoszenia). Bez tego pierwsze sprawdzenie po nowym rekordzie ogłaszałoby najwyższy pełny próg ≤ aktualnej liczby graczy jako "właśnie przekroczony", nawet gdy społeczność dawno go minęła (np. wysyłka "200 graczy" przy realnych 280 — dokładnie to się stało przy pierwszym wdrożeniu tej funkcji). Pierwsze realne ogłoszenie po starcie padnie dopiero przy faktycznym przekroczeniu kolejnego progu

6. **Panel Admina** — dostępny przez `/manage`:
   - **Usuń gracza z rankingu (admin):** modal wyszukiwania nicku → przefiltrowana lista → potwierdzenie → usunięcie z `ranking.json` + aktualizacja ról TOP + wyczyszczenie osiągnięć (`achievementService.clearUserAchievements` — kategorie `score`/`records`; `resetAllAchievements` gdy wybrano „Usuń z osiągnięciami”) + usunięcie wpisów historii wyników od aktualnego rekordu wzwyż (`scoreHistoryService.removeEntriesAfter`) + **usunięcie WSZYSTKICH rekordów bossów gracza na danym serwerze** (`bossRecordService.removeAllUserBossRecords`). Dotyczy tylko wybranego serwera (dane na innych serwerach bota nietknięte). Head Admin może usunąć gracza z **dowolnego serwera** (cross-server). Ta sama logika (włącznie z czyszczeniem rekordów bossów) w komendzie `/remove`.
   - **Usuń wynik (admin) — `🧹 Usuń wynik`:** usuwa POJEDYNCZY wpis z historii wyników gracza (`data/guilds/{guildId}/wyniki/{userId}.json`). Flow: modal wyszukiwania nicku → wybór gracza (StringSelectMenu) → lista **WSZYSTKICH** jego wyników z historii (najnowsze najpierw, 25/stronę z **paginacją** ◀️/▶️ gdy >25; etykieta = wynik, opis = data + boss) → potwierdzenie → usunięcie wpisu (`scoreHistoryService.removeEntryByTimestamp`). **Przeliczenie rankingu:** jeśli usuwany wpis był aktualnym rekordem gracza (`scoreValue >= ranking[userId].scoreValue`) → ranking ustawiany na najlepszy z POZOSTAŁYCH wpisów historii (`revertUserRecord`), a gdy brak innych — gracz usunięty z rankingu; w obu przypadkach aktualizacja ról TOP. **Cofa też rekord bossa:** jeśli usuwany wpis był rekordem swojego bossa (`scoreValue === boss_record.scoreValue`) → rekord bossa ustawiany na najlepszy POZOSTAŁY wpis historii z tym samym `bossName` (`bossRecordService.revertBossRecord`), a gdy brak — rekord bossa usuwany. **NIE rusza** osiągnięć. Head Admin szuka cross-server, Admin tylko swój serwer. Dostępne też w Centrum Dowodzenia (`_buildUsersRow`).
   - **Odblokuj gracza (admin):** modal wyszukiwania nicku → przefiltrowana lista → odblokowanie. Persistencja: `data/user_blocks.json`. Jeśli blokada pochodzi od Head Admina (`blockedByHeadAdmin: true`) — zwykły Admin nie może odblokować.
   - **Zablokuj gracza (head admin):** modal wyszukiwania nicku cross-server → lista graczy → potwierdzenie → modal czasu blokady. Blokada zapisywana z flagą `blockedByHeadAdmin: true`.
   - **Zużycie tokenów (admin/head admin):** embed ze statystykami AI per serwer. Admin = swój serwer, Head Admin = wszystkie + breakdown
   - **AI OCR on/off (head admin):** modal wyszukiwania nazwy serwera → jeśli 1 wynik: bezpośrednio toggle, jeśli wiele: lista → toggle per komenda. Stan w `guild_configs.json` przez `OcrBlockService`
   - **Ustaw limity (head admin):** modal z 2 polami — cooldown (np. `5m`, `1h`) i limit dzienny (liczba). Persistencja: `data/usage_limits.json`, `data/update_cooldowns.json`
   - **Wyślij Info (head admin):** modal → podgląd PL+ENG → wyślij na wszystkie serwery. `_infoSessions` Map (RAM)
   - **Zbanuj serwer (head admin):** modal wyszukiwania nazwy → lista → potwierdzenie → bot wychodzi z serwera + ID zapisywane w `data/banned_guilds.json`. Odblokowanie przez listę zbanowanych. Check w `guildCreate` — bot natychmiast wychodzi, jeśli serwer jest na liście. `GuildBanService`.
   - **Usuń dane serwera (head admin):** lista skonfigurowanych serwerów, na których bota już nie ma (`configured=true` ale `!guilds.cache.has(guildId)`) → potwierdzenie → usuwa `data/guilds/{guildId}/` + wpis z `guild_configs.json`. Operacja nieodwracalna.
   - **Automatyczna retencja konfiguracji (30 dni)** — `guildDataRetentionService.js`: `guildDelete` zapisuje serwer do `data/pending_guild_deletions.json` (z nazwą, językiem i timestampem); sweep przy starcie + co 12 h usuwa po 30 dniach **WYŁĄCZNIE konfigurację serwera**: wpis w `guild_configs.json` + `data/guilds/{guildId}/role_rankings.json`. **Dane graczy zostają** (`ranking.json`, `wyniki/`, `achievements.json`, rekordy bossów) — należą do użytkowników i tylko oni decydują o ich usunięciu (autonomia; zasilają też profil/wykresy cross-server). **`data/token_usage.json` również nietykane** — statystyki tokenów AI do celów rozliczeniowych/statystycznych (sekcja 7 polityki prywatności). `guildCreate` anuluje oczekujące usunięcie (bot wrócił); sweep też anuluje wpisy serwerów obecnych w cache (osierocone przy downtime). Po faktycznym usunięciu — powiadomienie na kanał logów serwerowych (`sendAdminNotification`, ping do head admina) z listą co usunięto/zachowano, w języku zapamiętanym przy `guildDelete`. Błąd usuwania nie kasuje wpisu — retry przy kolejnym przebiegu. UWAGA: zakres CELOWO węższy niż panelowy przycisk „Usuń dane serwera" (który kasuje cały `data/guilds/{guildId}/`). Zgodne z deklaracją w polityce prywatności (endersecho.thashar.dev/privacy).
   - **Konfiguracja bossów (head admin):** zarządzaj angielskimi nazwami bossów i ich aliasami w innych językach — patrz sekcja poniżej.
   - **Centrum Dowodzenia (head admin):** panel 6 embedów na dedykowanym kanale z 4 rzędami przycisków akcji, aktualizowany automatycznie po każdej analizie OCR i akcji admina — patrz sekcja poniżej.

**Komendy slash:** `/configure`, `/help`, `/manage`, `/profile`, `/ranking`, `/test`, `/update`

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
  - Rząd 2: `🎯 Konfiguracja bossów`, `🚫 Zbanuj serwer`, `🗑️ Usuń dane serwera`, `◀️ Wróć`
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
| `cc_action_roles` | Przetwórz role TOP — ephemeral z potwierdzeniem (używa `panel_process_roles`) |
| `cc_action_tester` | Zarządzaj testerami — lista + przyciski Dodaj/Usuń (ephemeral) |
| `cc_action_tokens` | Zużycie tokenów globalnie (ephemeral, head admin) |
| `cc_action_cmd_usage` | Użycia komend globalnie (ephemeral, head admin) |
| `cc_action_ocr_stats` | Success Rate z licznikami (w tym „🔁 Wzorzec OK za 2. razem" — % podwójnych weryfikacji wzorca zaliczonych za drugim razem) + przycisk reset (ephemeral, head admin) |
| `panel_info` | Otwórz modal /info (head admin) |
| `panel_tester` | Pokaż listę testerów + przyciski Dodaj/Usuń (head admin) |
| `panel_tester_add` | Otwórz modal wpisania ID użytkownika |
| `panel_tester_add_modal` | Modal dodawania (pole `tester_user_id`) |
| `panel_tester_remove` | Pokaż StringSelectMenu z testerami |
| `panel_tester_remove_select` | StringSelectMenu — wybór testera do usunięcia |
| `panel_diagnostics` | Raport uprawnień bota: serwer, kanały raportów, hierarchia ról TOP, intenty — dostępny w `/configure` gdy wszystkie kroki ukończone (każdy admin) |
| `panel_player_growth` | Statystyki przyrostu unikalnych graczy globalnie + wykres (head admin, ephemeral) |
| `panel_cmd_usage` | Użycia komend — admin widzi swój serwer, head admin globalnie; dane w `data/command_usage.json` |
| `panel_ban_server` | Panel zbanowania serwera (head admin) |
| `panel_ban_guild` | Otwórz modal wyszukiwania serwera do bana |
| `panel_ban_guild_modal` | Modal wyszukiwania (pole `ban_guild_query`) |
| `panel_ban_guild_sel` | StringSelectMenu — wybór serwera z wyników |
| `panel_ban_guild_ok_{guildId}` | Potwierdź ban serwera |
| `panel_unban_guild` | Lista zbanowanych serwerów |
| `panel_unban_guild_sel` | StringSelectMenu — wybór serwera do odbanowania |
| `panel_delete_server_data` | Panel usuwania danych serwera (head admin) — lista skonfigurowanych serwerów bez bota |
| `panel_delete_server_sel` | StringSelectMenu — wybór serwera do usunięcia danych |
| `panel_delete_server_ok_{guildId}` | Potwierdź usunięcie danych serwera |
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
| `boss_cfg_set_img` | Przycisk "🖼️ Przypisz zdjęcie" — otwiera select bossów |
| `boss_cfg_img_boss_sel` | StringSelectMenu — wybrany boss → otwiera modal z polem na link do zdjęcia |
| `boss_cfg_img_modal` | Modal z linkiem do zdjęcia (Discord CDN) → pobranie i zapis pliku |
| `ranking_boss_list` | Przycisk "🎯 Ranking Bossów" w widoku global ranking |
| `ranking_boss_sel` | StringSelectMenu — wybrany boss → pokazuje per-boss ranking globalny |

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
  - **Boss rozpoznany + brak globalnego + brak rekordu bossa** → standardowy odrzut (`rankingService.createNoRecordEmbeds`, kolor orange)
  - Warunek odrzucenia: `!isNewRecord && !wasUnknownBoss && !isNewBossRecord`
- **Embed rekordu:** Pole `🎯 Rekord na bossie` (msgs.bossRecordField) pokazywane gdy `isNewBossRecord = true`, PRZED polem osiągnięć. Dla pobitego rekordu bossa bez globalnego — pole `🎯 Nowy rekord na bossie` (msgs.bossRecordUpdated) w zielonym embedzie.
- **Struktura danych:** `data/guilds/{guildId}/boss_records.json` = `{ userId: { bossName: { score, scoreValue, timestamp, username } } }`. Write queue per-guild (`_enqueue`).
- **Ranking Bossów (globalny):**
  - Przycisk `🎯 Ranking Bossów` w widoku Global rankingu → `_handleRankingBossList` → StringSelectMenu z bossami mającymi ≥1 rekord (filtruje do znanych angielskich nazw)
  - Wybór bossa → `_handleRankingBossShow` → globalny ranking per-boss embed (`createBossRankingEmbed`) z thumbnail zdjęcia bossa (jeśli ustawione)
  - Paginacja: `ranking_prev/next/mypos` (te same przyciski co standardowy ranking; routing przez `_bossRankings.has(messageId)`)
  - Stan paginacji: `_bossRankings` Map (RAM, per messageId)
  - Powrót: przyciski `📋 Lista bossów` i `🌐 Global` w `createBossRankingButtons`
- **Zdjęcia bossów:** Plik zapisywany w `data/boss_images/{safeName}.{ext}`. Ścieżka (tylko `{safeName}.{ext}`) przechowywana w `boss_aliases.json` jako `images["BossEN"]`. Używane jako thumbnail w `createBossRankingEmbed` (AttachmentBuilder + `attachment://filename`).
- **Filtrowanie rankingów:** `getBossesWithRecords(allGuildIds, knownEnglishNames)` — pokazuje TYLKO bossów z angielską nazwą (admin musi zmapować alias). Nieznane surowe nazwy niewidoczne w UI dopóki nie zostają zmapowane.

**Komenda /profile** — profil gracza (kanał bota):
- Wyświetla pełny profil gracza w 3 zakładkach (1 wiadomość ephemeral z przyciskami nawigacji)
- Opcjonalny parametr `gracz` — fragment nicku do wyszukania; puste = własny profil
- **Zakładka 👤 Profil (main):** rekord serwera (#pozycja / total), pozycja globalna, rola TOP, najlepszy wynik (score + boss + data), wycinek globalnego rankingu (gracz ±1), rankingi ról; na cudzym profilu dołącza pole 🔔 Obserwatorzy (liczba subskrybentów)
- **Zakładka 🎯 Bossowie:** lista WSZYSTKICH znanych bossów (z `bossAliasService.getExtraEnglishNames()`), posortowana alfabetycznie, 15/stronę; ✅ z rekordem (score + data), — bez rekordu; paginacja gdy >15
- **Zakładka 🏆 Osiągnięcia:** używa `achievementService.buildAchievementsViewGlobal/ForUserGlobal` — dane mergowane ze WSZYSTKICH serwerów; własny profil — z opisami jak /achievements; cudzy — bez opisów
- **Szukaj gracza (🔍):** otwiera modal → wyszukiwanie cross-server w globalRanking → 1 trafienie: od razu profil; wiele: StringSelectMenu
- **Własny profil — Rząd 1:** Profil | Bossowie | Osiągnięcia | Szukaj gracza | 🔔 Subskrypcje (otwiera panel zarządzania subskrypcjami jako nowy ephemeral)
- **Cudzy profil — Rząd 1:** Profil | Bossowie | Osiągnięcia | Szukaj gracza. **Rząd 2:** ◀️ Wróć do siebie (Danger, pierwszy) | 🔔 Subskrybuj / 🔕 Odsubskrybuj (ostatni, zmienia się po kliknięciu)
- **Stan sesji:** `_profileStates` Map (messageId → state), TTL 15 min; pola: `viewerId, targetUserId, targetGuildId, view, category, bossPage, bossMaxPage, cachedData, isSubscribed, subscriberCount`
- **Dane per-boss:** `bossRecordService.getUserBossRecordsAllGuilds(allGuildIds, userId)` — merge najlepszych wyników ze wszystkich serwerów
- **CustomIDs:** `profile_main` | `profile_bosses` | `profile_bosses_prev` | `profile_bosses_next` | `profile_ach_overview` | `profile_ach_cat_{key}` | `profile_search` | `profile_search_modal` | `profile_search_sel` | `profile_back` | `profile_manage_subs` | `profile_subscribe` | `profile_unsubscribe`
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
- Wymaga konfiguracji + bot channel: `/update`, `/ranking`, `/subscribe`, `/profile`, `/achievements`
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
└── community_votes.json           # Sesje weryfikacji społeczności
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
- **Persona:** King BUM — leniwy, ironiczny władca serwera, Discord markdown, krótkie odpowiedzi

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
# Stan per-guild persystowany w data/guild_configs.json (ocrBlocked[])
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

- **Alerty uprawnień:** `_dmPermissionAlert(client, guildId, { channelId, missingPerms, context })` — wysyła DM do `configuredBy` + właściciela serwera gdy bot nie może zapisać do kanału (50001/50013). `_sendChannelErrorDm({ guildObj, ... })` — analogicznie dla /info. Oba fire-and-forget, nie przerywają głównego flow.
- **Logger (ogólny):** `createBotLogger('EndersEcho')` — tylko konsola + plik; jeśli ustawiony `ENDERSECHO_LOGS_WEBHOOK_URL`, EndersEcho jest **pomijany** w głównym webhooku botów
- **Logger (per-serwer):** `logService._gl(guildId).info(msg)` lub przez metody `logService.logCommandUsage/logScoreUpdate/logOCRError/logRankingError(... , guildId)` — trafia do dedykowanego webhooka z avatarem serwera i separatorem
- **GuildLogger:** `services/guildLogger.js` — zarządza kolejką webhooka, avatarem (ICON) i separatorem przy zmianie serwera. Metoda `sendEmbed(embed)` wysyła embed przez webhook (powiadomienia o dołączeniu serwera, usunięciu, zmianie konfiguracji); zwraca `true` jeśli webhook skonfigurowany
- **Embedy administracyjne (guildCreate/guildDelete/cfg_accept):** Wysyłane na dwa miejsca równolegle:
  1. Webhook przez `guildLogger.sendEmbed(embed)` / `logService.sendEmbed(embed)` (`ENDERSECHO_LOGS_WEBHOOK_URL` — opcjonalne)
  2. Kanał Discord: `ENDERSECHO_SERVER_LOG_CHANNEL_ID`
- **Embedy OCR analiz:** `logService.sendOcrAnalysisEmbed(guildId, options, guildObj, components)` — wysyła embed po każdej analizie OCR (/update, /test, panel Analizuj) na `ENDERSECHO_OCR_LOG_CHANNEL_ID`. Typy i kolory: 🏆 `new_record` zielony, ⚠️ `role_error` żółty, 🚫 `rejected` czerwony, 📊 `no_record` niebieski, 🧪 `test_record`/`test_no_record` cyan/blurple, 🔬 `analyze_panel` pomarańczowy, 🔄 `cross_server` szary. Embed zawiera: gracza, komendę, admina (panel), wynik, boss, poprzedni rekord, powód odrzucenia, szczegóły AI, błąd ról. Komponenty (np. przycisk ↩️ Cofnij) dołączane przez `components` array.
- **Przycisk ↩️ Cofnij wynik** (`ocr_revert_{userId}_{guildId}`) — dołączany do embedów `new_record` i `role_error` (nie dotyczy `dryRun`/`/test`). Dostępny tylko dla head admina. Po kliknięciu: cofa wynik przez `_cvRemoveRecord` (revert rankingu + historia + osiągnięcia), aktualizuje role TOP, edytuje embed dodając pole "↩️ Cofnięto przez X" i **dezaktywuje przycisk** (zamiast usuwać). Jeśli w sesji jest `publicMsgId` — w ogłoszeniu rekordu dodawana jest notka "↩️ Administrator X cofnął wynik oraz wszystkie osiągnięcia". Sesja rewertu przechowywana w `_ocrRevertSessions` Map (RAM, TTL 24h, klucz `userId_guildId`; zawiera `publicMsgId`/`publicChannelId` — referencja do ogłoszenia publicznego). Wymaga webhooka aplikacyjnego (bot-owned) żeby interakcje były routowane.
- **Przycisk ↩️ Cofnij wynik (panel Analizuj)** (`ee_analyze_revert_{globalMsgId}`) — dołączany do embeda raportu odrzuconego screena po manualnej analizie admina. Po kliknięciu: identyczne cofnięcie co `ocr_revert`, **dezaktywacja przycisku** w raporcie i notka w ogłoszeniu publicznym. Sesja `_analyzeRevertSessions` zawiera `publicMsgId`/`publicChannelId`.
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

### Ogłoszenie nowego serwera (AUTOMATYCZNE)

Po **pierwszej** konfiguracji serwera (`!wasAlreadyConfigured`) bot **automatycznie** wysyła ogłoszenie na `allowedChannelId` każdego skonfigurowanego serwera — bez żadnego przycisku ani potwierdzenia ze strony admina.

**Flow:**
- `cfg_accept` → `_broadcastNewServerAnnouncement(client, guild)` (fire-and-forget, nie blokuje odpowiedzi)
- Broadcast na `allowedChannelId` wszystkich serwerów, embed w języku serwera (`pol`/`eng`)

**Zawartość embeda** (kolor `0xFFD700` — złoty, uroczysty):
- Nazwa serwera, liczba członków, numer kolejny skonfigurowanego serwera w rywalizacji
- PL: "N. skonfigurowany serwer" · EN: "Nth configured server" (sufiks ordinalny przez `_enOrdinal()`)
- Thumbnail: ikona serwera Discord

**Metody:** `_buildNewServerAnnouncementEmbeds(guild, serverNumber)`, `_enOrdinal(n)`, `_broadcastNewServerAnnouncement(client, guild)`

---

## Centrum Dowodzenia Head Admina (Admin Panel Live Dashboard)

**Plik serwisu:** `services/adminPanelService.js`

**Konfiguracja (zmienna env):**
```env
ENDERSECHO_ADMIN_PANEL_CHANNEL_ID=id_kanalu_head_admina
```

**Działanie:** Panel to **7 osobnych wiadomości** (każda: 1 embed + własne rzędy przycisków) na kanale head admina. Edytowane automatycznie po każdym zdarzeniu. Kolejność sekcji = `SECTION_KEYS` w `adminPanelService.js`: `system, users, servers, bosses, stats, costs, tools`. Przy zmianie układu sekcji stare wiadomości są usuwane (iteracja po `Object.values(_messageIds)` — także osierocone klucze starych układów) i wysyłane od nowa. Wszystkie dynamiczne pola przycinane helperem `capField()` (limit 1024/pole, 4096/opis) — zabezpieczenie przed crashem.

**7 embedów panelu (każdy z własnymi przyciskami POD embedem):**

| # | Embed | Kolor | Zawartość | Przyciski |
|---|---|---|---|---|
| 1 | 📡 Przegląd Systemu | `0xFF6B35` | Uptime, ping, RAM, liczba serwerów, AI OCR (aktywnych/zablokowanych), następny Global TOP10, **🏆 Ostatnie rekordy** (feed 5, persystowany), **📜 Ostatnie akcje admina** (dziennik 5 z 10 persystowanych) | `🔄 cc_refresh`, `📢 cc_top10_preview`, `📢 panel_info` |
| 2 | 👥 Użytkownicy | `0x57F287` | Łącznie graczy, aktywne cooldowny, oczekujące CV, **👑 Lider globalny**, **🕐 Ostatni rekord** (relative timestamp), **🏆 TOP10 pobijających rekordy** (liczba wpisów historii wyników per gracz, cross-server — `getActivePlayersStats().topRecordSetters`), lista zablokowanych (max 3 + "i N więcej") | Rząd 1: `🔒 panel_block`, `🔓 cc_action_unblock`, `🗑️ panel_remove`, `🧹 panel_remove_score`, `🏆 panel_ach_del` · Rząd 2: `🔍 cc_player_lookup`, `🧊 cc_clear_cooldown`, `🗳️ cc_pending_cv` |
| 3 | 🖥️ Serwery | `0xEB459E` | Per serwer: OCR on/off, liczba graczy, język, tag + globalny limit/cooldown w nagłówku; **paginacja 25 serwerów/stronę** (`_serversPage` w RAM, footer `Strona X/Y`); sekcje nieskonfigurowane/brak bota (max 10 + licznik) | Rząd 1 (paginacja): `◀️ cc_srv_pg_prev`, `cc_srv_pg_info` (disabled, wskaźnik strony), `▶️ cc_srv_pg_next` · Rząd 2: `🔄 panel_ocr`, `🔁 cc_action_roles`, `🚫 panel_ban_guild`, `🗑️ panel_delete_server_data` · Rząd 3: `⚠️ cc_unconfigured`, `🔍 cc_diag_server` |
| 4 | 👾 Bossowie | `0x1ABC9C` | Bossy w bazie, z rekordami, boss okresu, **🎯 Najczęstszy boss rekordów** (z aktualnych rekordów globalnego rankingu), **nieznane nazwy do zmapowania** (`bossRecordService.getUnknownBossNames()`, lista `• \`nazwa\`` max 5 + licznik), **bossy bez zdjęcia** (ten sam format listy) | `👾 cc_action_boss_cfg` (pełny panel konfiguracji bossów jako ephemeral) |
| 5 | 📊 Statystyki | `0x5865F2` | Analizy łącznie/od resetu, Success Rate z paskami `[████░░]`, **Wzorzec OK za 2. razem**, odrzucone, interwencje admina, **🌩️ Zdrowie API** (globalne, nieresetowalne: odrzucone/wszystkie zapytania + %, pełne odrzuty po 10 retry), top odrzucani, aktywni/nowi gracze, przyrost miesięczny, **🔢 Użycia komend** (top 10 + suma, dawny przycisk scalony do embeda) | `📈 panel_player_growth` (przyciski Success Rate i Użycia komend usunięte — dane w embedzie; szczegóły/reset liczników nadal w `/manage → Statystyki`) |
| 6 | 💰 Koszty & Limity | `0xFEE75C` | Dziś (requesty, tokeny IN/OUT, koszt), miesiąc + projekcja, **⚙️ Limity i alert** (limit dzienny, cooldown, próg alertu), top 3 serwery, top 5 użytkowników | `📊 cc_action_tokens`, `⚙️ panel_limit`, `🔔 cc_cost_alert` (modal progu USD/dzień) |
| 7 | ⚙️ Narzędzia | `0x95A5A6` | **🧪 Testerzy z nickami** (nick serwerowy z serwera kanału panelu + username Discord z linkiem do profilu, `_resolveTestersDetailed()`), liczba serwerów z zablokowanym OCR per-guild, następny Global TOP10, **stan globalnego OCR** | `🧪 cc_action_tester`, `📅 panel_top10_interval`, `🛑/▶️ cc_global_ocr` (kill-switch z potwierdzeniem `cc_global_ocr_ok_{block\|unblock}`) |

**Nowe akcje CC (wszystkie tylko head admin, ephemeral):**
- `🔍 cc_player_lookup` → modal (`cc_player_lookup_modal`) → wyszukiwanie w globalnym rankingu → przy wielu trafieniach select `cc_player_lookup_sel` → embed szczegółów gracza: pozycja globalna, rekord+boss, serwer, blokada, aktywny cooldown, odrzucenia w bieżącym miesiącu, liczba osiągnięć
- `🧊 cc_clear_cooldown` → select aktywnych cooldownów (`cc_clear_cd_sel`) → czyszczenie cooldownu gracza (np. po spalonej próbie z winy API)
- `🗳️ cc_pending_cv` → lista oczekujących sesji CV z licznikami zgłoszeń i linkami do wiadomości raportów
- `⚠️ cc_unconfigured` → lista serwerów z botem bez konfiguracji (wersja ephemeral — nie rusza wiadomości panelu, w przeciwieństwie do `panel_unconfigured` które używa `update()`)
- `🔍 cc_diag_server` → select skonfigurowanych serwerów (`cc_diag_sel`) → embed diagnostyki uprawnień dla wybranego serwera. Refaktor: logika diagnostyki wydzielona do `_buildDiagnosticsEmbed(guild, t, client)` — używana też przez `panel_diagnostics` (/configure)
- `👾 cc_action_boss_cfg` → panel konfiguracji bossów jako **ephemeral reply** (wrapper — `panel_boss_cfg` używa `update()` i zniszczyłby wiadomość panelu)
- `📢 cc_top10_preview` → `globalTop10Service.buildOnDemandEmbed()` jako ephemeral (bez zapisu snapshotu/harmonogramu)
- `🔔 cc_cost_alert` → modal (`cc_cost_alert_modal`) progu dziennego kosztu AI w USD (puste = wyłącz). Po przekroczeniu progu `_maybeCostAlert()` wysyła na kanał panelu ping do head adminów (raz dziennie, `lastAlertDate` w persist)
- `🛑 cc_global_ocr` → globalny kill-switch OCR (tryb serwisowy): `adminPanelService.setGlobalOcrBlocked()` persystowany w `admin_panel.json`; `_runUpdateFlow` sprawdza `isGlobalOcrBlocked()` po per-guild blocku (head admin pomija). Stan i przycisk (Wyłącz/Włącz) widoczne w embedzie Narzędzia

**Dziennik akcji admina (`logAdminAction`):** wpisy dodawane helperem `_ccAudit(interaction, action)` przy: blokadzie/odblokowaniu gracza, usunięciu gracza/wyniku, akcjach CV (approve/remove/block), analizie manualnej, cofnięciach wyniku (ocr_revert + analyze revert), zmianie limitów, toggle AI OCR per-guild, banie/odbanowaniu serwera, usunięciu danych serwera, czyszczeniu cooldownu, alercie kosztowym, global OCR. Max 10 wpisów, 5 widocznych w embedzie System, persystowane w `admin_panel.json`.

**Persistencja panelu (`data/admin_panel.json`):** `{ messageIds, channelId, lastRecords[], auditLog[], costAlert: {threshold, lastAlertDate}, globalOcrBlocked }`.

**Widok `/manage → 📡 Centrum Dowodzenia`:**
Prosta informacja o kanale panelu + przycisk `🔄 Odśwież Panel`.

**Triggery automatycznego refresh:**
- ✅ Po każdym zapisie wyniku (`/update` — zarówno nowy rekord jak i brak rekordu, `!dryRun`)
- ✅ Po analizie admina (`Analizuj` panel)
- ✅ Po usunięciu gracza z rankingu (`panel_remove_confirm_*`)
- ✅ Po zablokowaniu gracza (`panel_block_time_*`)
- ✅ Po odblokowaniu gracza (`panel_unblock_select`)
- ✅ Po akcji Community Verification (approve/remove/block)
- ✅ Na żądanie: `🔄 cc_refresh` na wiadomości panelu lub `/manage → Centrum Dowodzenia → Odśwież`
- ✅ Przy starcie bota (jeśli kanał skonfigurowany)

**Debouncing:** Maksymalnie 1 refresh naraz + 1 oczekujący (dodatkowe wywołania w trakcie odrzucane).

**Persistencja:** `data/admin_panel.json` — `{ messageId, channelId }`. Jeśli wiadomość usunięta, serwis tworzy nową.

**Aktywność graczy:** `scoreHistoryService.getActivePlayersStats(allGuildIds)` — dane o aktywnych/nowych graczach z historii wyników. Opcjonalne — jeśli serwis niedostępny, embed pokazuje "Brak danych".

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
