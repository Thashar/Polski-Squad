### ⛪ Konklawe Bot

**8 Systemów:**
1. **Gra Hasłowa** - `gameService.js`: Hasło "Konklawe" (admin może zmienić), poprawna→rola papieska. Za odgadnięcie hasła domyślnego "Konklawe" NIE przyznawane są punkty (tylko rola papieska) - dotyczy każdego użycia, nie tylko pierwszego
2. **Osiągnięcia** - Medal Virtutti Papajlari: 30+ odpowiedzi, reset rankingu, specjalne uprawnienia
3. **Timery** - `timerService.js`: 15/30/60min przypomnienia, auto-reset, persistent (`game_state.json`), restore po restarcie
   - **Papież szukany przez `findPapalMember()`** (wspólny `safeFetchMembers` z throttlem na opcode 8), NIE przez `guild.members.cache`. Cache członków po restarcie bywa prawie pusty, a przypomnienia szukały w nim wprost — gdy nikogo nie znalazły, cały dalszy łańcuch był pomijany, bo `setSecondHintReminder()`, `setPapalRoleRemovalForNoHints()`, `setHintReminderTimer()` i `setHintTimeoutTimer()` stały WEWNĄTRZ `if (membersWithRole.size > 0)`. Efekt: brak drugiego przypomnienia, brak zdjęcia roli po 30 min i brak resetu hasła po 24 h — papież trzymał rolę bez końca
   - **Kolejne ogniwa łańcucha uzbrajane są ZAWSZE**, także gdy nie ma kogo pingnąć (wyjątek: drugie przypomnienie, które potrzebuje konkretnego `userId` do timera zdjęcia roli). Miejsca ZDEJMUJĄCE rolę od zawsze robiły `guild.members.fetch()` — teraz jest to spójne w całym pliku
4. **AI Wspomaganie** - `aiService.js`: Generowanie haseł i podpowiedzi przez Anthropic lub Grok API
   - **Provider:** Przełączany przez `KONKLAWE_AI_PROVIDER` w .env (`anthropic` domyślny lub `grok`)
   - **Generowanie hasła:** Przycisk "Wygeneruj hasło przy pomocy AI" (🤖, czerwony) - pojawia się przy braku hasła lub hasło domyślne
   - **Generowanie podpowiedzi:** Przycisk "Wygeneruj podpowiedź przy pomocy AI" (🤖, czerwony) - pojawia się gdy hasło jest aktywne
   - **Anthropic:** domyślnie Claude 3 Haiku, wymaga `KONKLAWE_ANTHROPIC_API_KEY`
   - **Grok:** domyślnie grok-3-mini, wymaga `XAI_API_KEY`, używa xAI Responses API
   - Prompt generowania hasła: "Gramy w grę w zgadywanie haseł, hasło musi być jednym słowem. Hasło może być wyszukane, ale nie musi. Wymyśl hasło."
   - Prompt generowania podpowiedzi: Uwzględnia aktualne hasło i poprzednie podpowiedzi, generuje nową podpowiedź która nie jest podobna do poprzednich
   - Opcjonalne (wyłączone gdy brak odpowiedniego klucza API dla wybranego providera)
5. **System Many i Frakcji** - `virtuttiService.js`:
   - **Gabriel:** max 150 many, regeneracja 1pkt/10min, start z pełną maną
   - **Lucyfer:** max 100 many, regeneracja 10-30min/pkt (dynamiczna), start z pełną maną
   - Śledzenie ról użytkowników (`userRoles` Map), funkcja `getMaxEnergy(userId)`
6. **Klątwy i Błogosławieństwa** - 10 typów klątw (slow, delete, ping, emoji, caps, timeout, role, scramble, smart, blah):
   - **Gabriel:** `/curse` (10+klątwy×2 many, 85% sukces), `/blessing` (5 many, 50% usunięcie klątwy LUB ochrona 1h)
   - **Lucyfer:** `/curse` (5-15 many, 5min cd, progresywne odbicie +1% za klątwę)
   - **Admin (bez roli Gabriel/Lucyfer):**
     - `/curse` - Ultra potężna klątwa (cicha, 5min + 24h debuff, 10% trigger), 0 many, 0 cd, ephemeral only
     - `/blessing` - Usuwa WSZYSTKIE klątwy i debuffs (100% sukces, cicha), 0 many, 0 cd, ephemeral only
     - Nie może używać na innego admina
     - Tylko szczegółowe logowanie DetailedLogger (brak publicznych wiadomości)
   - **Revenge:** `/revenge` (50 many, 24h cd per cel, pułapka 24h) - Gabriel: odbicie 3x, Lucyfer: "Upadły" 1h
   - **Walidacja:** sprawdzanie przed rzuceniem czy cel już ma aktywną klątwę tego typu
   - **Nickname Manager:** 4 prefixy dla Lucyfera (Osłabiony, Uśpiony, Oszołomiony, Upadły)
7. **Virtue Check** - 10 cnót + porady (0 many)
8. **Losowe Odpowiedzi** - Użytkownicy papiescy: 1/100 szansa, emoji JP2roll
10. **Chaos Bomby** - `bombChaosService.js`: Komenda `/bomba` (admin) aktywuje 1h chaos — każda wiadomość ma 30% szansę na ghost ping `💥 @user 💥` (usuwany po 2s). Persystencja w `shared_data/bomb_chaos_state.json`. Pomija użytkowników z rolą gracza (`EXEMPT_ROLE_ID`).
9. **Herezja Full HP** - `messageHandlers.js`: Automatyczna cicha losowa klątwa (5min) za napisanie "Full HP najlepsze" (lub wariantów z leet speak, separatorami, próbami obejścia cenzury). Wykrywa: małe/wielkie litery, leet speak (0→o, 1→i, 3→e, 4→a...), separatory (spacje, kropki, myślniki między literami). Klątwa nakładana bez żadnego publicznego powiadomienia.
11. **Cenzura Zakazanej Frazy** - `messageHandlers.js`: Automatyczna cicha klątwa admina na **1 godzinę** za napisanie zakazanej frazy (konfigurowana przez `KONKLAWE_FORBIDDEN_PHRASE` w .env; **brak zmiennej = cenzura wyłączona**) lub jej prób obejścia. Metoda `detectForbiddenPhrase(text, phrase)` generyczna - działa dla dowolnej frazy. Algorytm: leet speak (0→o, 1→i, 3→e, 7→t...), homoglify unicode, separatory (f.o.r.t.n.i.t.e), podwojone litery (forrtniite→fortnite), spacja wewnątrz frazy, fonetyczne zamienniki (ph→f, y→i, kn→n). Wywołuje `applyRandomCurseToUser` z czasem 60min. Brak publicznego powiadomienia. Wykluczone kanały: `channels.fortniteCensorExcluded`.

**Komendy:** `/podpowiedz`, `/podpowiedzi`, `/statystyki`, `/blessing`, `/curse`, `/revenge`, `/virtue-check`, `/bomba` (admin)
**Env:** TOKEN, CLIENT_ID, GUILD_ID, KONKLAWE_AI_PROVIDER (opcjonalne), KONKLAWE_ANTHROPIC_API_KEY (opcjonalne), KONKLAWE_AI_MODEL (opcjonalne), KONKLAWE_GROK_MODEL (opcjonalne), XAI_API_KEY (opcjonalne)

---


## Zmienne Środowiskowe

```env
KONKLAWE_TOKEN=bot_token_here
KONKLAWE_CLIENT_ID=client_id
KONKLAWE_GUILD_ID=guild_id

# AI Wspomaganie - wybór providera (opcjonalne)
KONKLAWE_AI_PROVIDER=anthropic          # "anthropic" (domyślny) lub "grok"

# Anthropic (gdy provider=anthropic)
KONKLAWE_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
KONKLAWE_AI_MODEL=claude-3-haiku-20240307

# Grok / xAI (gdy provider=grok)
XAI_API_KEY=xai-xxxxxxxxxxxxx
KONKLAWE_GROK_MODEL=grok-3-mini
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Konklawe')
- **Mana:** Gabriel max 150, Lucyfer max 100
- **Regeneracja:** Gabriel 1pkt/10min, Lucyfer 10-30min/pkt
- **Persistencja przez `utils/jsonStore` (cache-first):** wszystkie pliki w `data/` — scoreboard, trigger, hints, attempts, gameHistory, medale Virtutti, 17 plików stanu Lucyfera/Gabriela (`virtuttiService`), aktywne klątwy, chaos bomby, zaplanowane podpowiedzi i usunięcia wiadomości. Z dysku czytane raz, przy pierwszym sięgnięciu; zapis atomowy (plik tymczasowy + rename)
  - **`dataService` zachował synchroniczne API** (`loadX()`/`saveX()` bez `await` u wywołujących), więc zapisy idą przez **`store.setSync()`**: cache aktualizuje się NATYCHMIAST, a plik zapisywany jest w tle. To celowe — wzorzec `saveScoreboard(s)` → zaraz potem `loadScoreboard()` jest w tym bocie wszechobecny i musi zobaczyć świeżą wartość. Zwykłe `set()` (cache dopiero po zapisie) zwróciłoby jeszcze starą
  - **Zniknęło 14 blokujących `writeFileSync`** — każdy z nich zatrzymywał cały proces Node, czyli wszystkie 9 botów naraz
  - `_safeReadJSON()` jest teraz cienką nakładką na `store.getSync()`; zachowanie przy uszkodzonym/pustym pliku (wartość domyślna zamiast wyjątku) pozostało bez zmian
  - **Guardy `fs.existsSync()` usunięte z metod `loadX()`** — przy zapisie trwającym jeszcze w tle plik mógł nie istnieć, mimo że cache miał już aktualne dane, i metoda zwracała wartość domyślną zamiast prawdziwej
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15) i **nie** `flags: 64` (magiczna liczba — ta sama wartość, ale nieczytelna). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje
  - **Publiczne odpowiedzi nie mają flagi** — dawne `ephemeral: false` (klątwy, błogosławieństwa, virtue check) zostało usunięte, bo brak flagi to domyślnie wiadomość widoczna dla wszystkich
  - Import `MessageFlags` jest modułowy w `index.js`, `handlers/interactionHandlers.js` i `services/judgmentService.js`
- **⚠️ Do zrobienia osobno:** trzy wywołania używają `fetchReply: true` (`interactionHandlers.js` — blessing, virtue-check, odbicie klątwy). Ta opcja też jest w v14 przestarzała, ale jej następca zwraca inny typ obiektu, więc podmiana wymaga przejrzenia kodu korzystającego z wyniku — nie jest to zamiana jeden do jednego jak przy `ephemeral`
