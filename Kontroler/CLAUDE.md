### 🎯 Kontroler Bot

**5 Systemów:**
1. **OCR Dwukanałowy** - `ocrService.js`: CX (1500min, 0-2800/100, skip1, rola 2800+), Daily (910min, 0-1050/10, skip3, 2x nick), normalizacja znaków (o→0, z→2, l→1, sg→9)
   - **Zapis CX do shared_data:** Po udanym OCR na kanale CX, wynik jest zapisywany do `shared_data/cx_history.json` (klucz: userId, historia max 20 wyników). Używane przez Stalker Bot w `/player-status` i `/player-compare`
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
   - **Treść ankiety (tekst-centryczna):** Każdy kandydat to TEKST (cytat) + drobna wzmianka `-# ✍️ autor · N× KEKW · #kanał · data · [oryginał]`. Bez rywalizacji osób
   - **Kontekst odpowiedzi:** Jeśli kandydujący tekst był odpowiedzią (reply) na inną wiadomość, pod cytatem dodawana jest linia `-# ↩️ odpowiedź na @autor: „treść oryginału”` (zarówno w ankiecie, jak i w ogłoszeniu zwycięzcy). Treść oryginału pobierana przez `msg.fetchReference()` podczas skanu i zapisywana w polu `replyTo` kandydata (`mvp_state.json`) - odporne na restart i usunięcie oryginału (wtedy kontekst pomijany)
   - **Ankieta reakcyjna:** Bot dodaje 1️⃣2️⃣3️⃣… (po jednej na kandydata, pula `voteEmojis` 1-10). 1 głos/os - kliknięcie innej reakcji kasuje poprzednią. Zliczanie z mapy `state.votes` (userId→opcja, "ostatni klik = ważny głos") - odporne na brak uprawnienia "Zarządzanie wiadomościami" i na restart. Głosy bota nie są liczone w wynikach (`tallyFromState` pomija `client.user.id`). Fizyczne kasowanie poprzedniej reakcji jest kosmetyczne (wymaga Manage Messages), nie wpływa na wynik. Remis w głosach → więcej KEKW → więcej pozostałych reakcji → wcześniejszy
   - **⚠️ Uprawnienia bota:** Do skanu potrzebny dostęp + historia na kanałach; do kasowania starych reakcji (kosmetyka) "Zarządzanie wiadomościami" na kanale ankiety; do roli - uprawnienie zarządzania rolą `1514704005719134389`
   - **Brak kandydatów:** Gdy 0 wiadomości z KEKW → ogłoszenie "brak MVP" z `@everyone` (rola nie jest ruszana). Gdy 1-2 kandydatów → ankieta ma tylu
   - **Persistencja:** `mvp_state.json` (aktywna ankieta: kandydaci, głosy, czas końca), `mvp_winners.json` (liczniki tytułów per user + `currentWinnerId`)
   - **Restart-safe:** Odtwarzanie timera ankiety (lub natychmiastowa finalizacja gdy wygasła) + przeplanowanie kolejnego skanu przy starcie; resync głosów z reakcji
   - **Komenda:** `/mvp` - publiczny ranking zdobywców tytułu MVP (malejąco wg liczby tytułów + aktualny MVP)
   - **Aprobata MVP (reakcja KEKW aktualnego MVP):** Gdy posiadacz roli MVP tygodnia (`roleId`) zostawi reakcję KEKW pod **cudzym** postem, bot odpala LOSOWY „stempel aprobaty". Niezależne od ankiety tygodniowej.
     - **Losowanie efektu:** `textreply` ma priorytet z szansą `textReplyChance` (~30%) → krótka odpowiedź tekstowa ze „znakiem jakości" (losowa z puli, np. „Przyznano znak jakości wypowiedzi! 🏅"). W pozostałych przypadkach: jackpot (`jackpotChance` ~12%), inaczej równo z puli `['stamp', 'crown']`
     - **Efekty:** `stamp` (bot dorzuca pod postem reakcje-pieczęcie 👑✅🔥), `crown` (autor dostaje prefix 👑 w nicku na 1h przez współdzielony `NicknameManager`), `embed` (ozdobny embed gratulacyjny — **wyłącznie** w jackpocie)
     - **Szczęśliwy traf (jackpot):** wszystkie efekty naraz (stamp + crown + specjalny embed)
     - **Zasady:** jeden post = jeden efekt (dedup po `messageId` w `mvp_approvals.json`, trim do `maxApprovedMemory`); pomija kanał ankiety, `excludedChannels`, posty botów i własne posty MVP; `crown` z fallbackiem na `textreply` gdy autor nieedytowalny (wyższa rola/owner) — embed NIE jest używany poza jackpotem
     - **Brak stackowania korony:** jeśli autor ma już aktywną koronę MVP (`getActiveEffectType === 'mvp_crown'`), ponowne nadanie jest pomijane (standalone `crown` → fallback `textreply`), więc prefix 👑 się nie nakłada
     - **Handler:** `handleApprovalReaction` w `mvpService.js`, podpięty obok `handleReactionAdd` na `MessageReactionAdd` w `index.js`. Korona restart-safe przez `NicknameManager.restoreExpiredEffects` przy starcie
   - **Konfiguracja:** `config.mvp` (pollChannelId, roleId, kekwEmojiId, voteEmojis, scanDays, targetAuthors, maxCandidates, votingDurationMs, scheduleWeekday/Hour/Minute, excludedChannels, **approval**: enabled, crownDurationMs, crownPrefix, jackpotChance, textReplyChance, stampEmojis, maxApprovedMemory)

**Komendy:** `/lottery`, `/lottery-list`, `/lottery-remove`, `/lottery-history`, `/lottery-reroll`, `/lottery-debug`, `/ocr-debug`, `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`, `/mvp`
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

# Opcjonalne - z fallbackiem do wartości produkcyjnych
ROBOT1_FORWARD_CHANNEL=channel_id         # Kanał forward dla Robot1
ROBOT1_MENTION_ROLE=role_id               # Rola do pingu (@) dla Robot1
ROBOT1_ACTIVATION_CHANNEL=channel_id      # Kanał z przyciskiem aktywacji Robot1
KONTROLER_BLOCKED_ROLE=role_id            # Rola blokująca udział w loteriach
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Kontroler')
- **OCR:** Dwukanałowy (CX + Daily)
- **Loteria:** DST auto, multi-klan, cykle 0-365 dni
- **Persistencja:** active_votes.json, vote_history.json, saboteur_roles.json, mvp_state.json, mvp_winners.json, mvp_approvals.json
