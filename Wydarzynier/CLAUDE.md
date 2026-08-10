### 🎉 Wydarzynier Bot

**8 Systemów:**

**Lobby Party (oryginalne):**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback
8. **Nagrody specjalne (czerwone skrzynki)** - `nagrodyService.js`: Zliczanie nagród zdobytych w party, ranking `/stats`, korekta `/correct`

**Funkcjonalność Nagród Specjalnych:**
- **Pytanie o nagrodę:** 1 minuta po zapełnieniu lobby (`lobby.rewardPromptDelay`) bot wysyła w wątku pytanie z 9 przyciskami (same emoji nagród, bez opisów, 2 rzędy: 5+4)
- **Definicje nagród:** `config.rewards` - lista `{ key, name, emoji }` (Pet AW, RC, Chip, AW, Czerwona kolekcja, Mount Core, Chest Core Selector, Pet Crystal, Panda Shard). Kolejność w tablicy = kolejność przycisków i kolumn w rankingu
- **Potwierdzenie:** Kliknięcie emoji → ephemeral „Czy na pewno otrzymałeś taką nagrodę…" z przyciskami **Tak** / **Nie**
  - **Tak** → nagroda doliczana na konto użytkownika + ogłoszenie na kanale `/party` (nagłówek `#`): `# <@user> właśnie zgarnął nagrodę specjalną! <emoji>.` + linia zachęty do użycia `/stats`
  - **Nie** → ephemeral z pouczeniem o niezaburzaniu statystyk (nic nie jest zliczane)
- **Blokada per użytkownik (NIE globalna):** Przyciski emoji pozostają aktywne dla wszystkich - zgłoszenie jednej osoby nie blokuje pozostałych uczestników party. Każdy uczestnik może zgłosić **jedną** nagrodę na dane losowanie; przy drugiej próbie dostaje `rewardAlreadyClaimed`
  - Rezerwacja przez `tryRegisterClaim(promptMessageId, userId)` w `nagrodyService.js` - **synchroniczna**, więc dwa równocześnie otwarte ephemerale tego samego gracza nie doliczą nagrody dwa razy. Gdy doliczenie rzuci błąd, rezerwacja jest cofana (`releaseClaim`)
  - Historia zgłoszeń: `claims` w `nagrody.json` (`messageId pytania -> [userId]`), limit 200 ostatnich losowań (`maxClaimEntries`), najstarsze usuwane automatycznie
- **customId:** `reward_pick_<klucz>` (przyciski emoji), `reward_yes_<klucz>_<idKanału>_<idWiadomości>` (Tak), `reward_no` (Nie). Routing przed wyszukiwaniem lobby, więc przyciski działają dla wszystkich uczestników party i przeżywają restart bota
- **Persistencja:** `data/nagrody.json` (`{ users: { userId: { displayName, rewards, total, lastReward } }, claims: {} }`). Zaplanowane pytanie zapisywane w `lobbies.json` (`rewardPromptAt`, `rewardPromptSent`) i odtwarzane przy starcie przez `restoreRewardPrompts` w `index.js`
- **`/stats`:** Ephemeral embed z rankingiem (🥇🥈🥉, potem numeracja) - nick, suma nagród i rozbicie `emoji ×N`; na dole pole z sumą wszystkich nagród wg typu. Opis przycinany do limitu 3800 znaków z informacją o ukrytych graczach
- **`/correct`:** Tylko administrator. Parametry: `użytkownik`, `nagroda` (lista wyboru z `config.rewards`), `ilość` (opcjonalna, domyślnie 1; dodatnia dodaje, ujemna usuwa, zakres -100..100). Licznik nie schodzi poniżej 0 - przy przycięciu zmiany bot informuje ile faktycznie zastosowano

**System Przypomnień i Eventów (skopiowane z STAR bota):**
5. **Przypomnienia** - `przypomnieniaMenedzer.js`: Szablony (text/embed) + Zaplanowane przypomnienia z interwałami (1s-28d lub "ee")
6. **Eventy** - `eventMenedzer.js`: Dodawanie eventów z nazwą, czasem rozpoczęcia i interwałem powtarzania
7. **Panel Kontrolny** - `tablicaMenedzer.js`: Interaktywna tablica z embeddami przypomnień, auto-update co 1min, przyciski zarządzania

**Funkcjonalność Przypomnień:**
- **Szablony:** Tworzenie szablonów wiadomości (tekst lub embed) z nazwą, treścią, ikoną i obrazem
  - **Opis embed jest opcjonalny** - pusty opis jest zamieniany na zero-width space (`safeEmbedDescription` w `przypominienHandlers.js`, analogiczny guard w `harmonogram.js`), bo `EmbedBuilder.setDescription` wymaga 1-4096 znaków i pusty string rzucał błąd walidacji przy podglądzie/wysyłce
- **Zaplanowane:** Ustawianie przypomień na podstawie szablonów z:
  - Pierwszym wyzwoleniem (data + czas)
  - Interwałem powtarzania (1s, 1m, 1h, 1d do max 90d, lub "ee" dla specjalnego wzorca)
  - **Typem powiadomienia:**
    - **0 = Dopasowane** - Pełna personalizacja (wybór kanału + pingi)
    - **1 = Ustandaryzowane** - Kanał automatycznie ustawiony na kanał z Listą Eventów, tylko wybór pingów (ról), **automatyczne usuwanie po 23h 50min**
- **Tablica:** Automatyczna tablica z embeddami wszystkich aktywnych przypomnień:
  - Live Discord timestamps (<t:timestamp:R>)
  - Przyciski: Wstrzymaj/Wznów, Edytuj, Usuń
  - Auto-update co minutę
  - Panel kontrolny na dole z przyciskami zarządzania
- **Harmonogram:** Sprawdzanie co 30s i auto-wysyłanie przypomnień + czyszczenie starych wiadomości typu 1 (po 23h 50min)
- **Strefa Czasowa:** Hardcoded `Europe/Warsaw` (brak możliwości zmiany przez UI)

**Funkcjonalność Eventów:**
- **Lista Eventów:** Osobna lista eventów wyświetlana na wybranym kanale
- **Auto-sortowanie:** Eventy sortowane po dacie (najwcześniejsze pierwsze)
- **Wskaźniki czasu:** ⏳ (>24h) | <a:PepeAlarmMan:1341086085089857619> (<24h)
- **Zarządzanie:** Dodawanie, edycja, usuwanie eventów przez panel kontrolny
- **Subskrypcja:** Zielony przycisk 🔔 pod listą - toggle roli powiadomień o eventach (1297587256101699776)

**Komendy:** `/party`, `/party-add`, `/party-kick`, `/party-close`, `/stats`, `/correct`
**Env:** TOKEN, NOTIFICATIONS_BOARD_CHANNEL, ROBOT (opcjonalne, lista user ID rozdzielona przecinkami)

**Przekazywanie wiadomości (Robot3):**
- Użytkownicy z ID w `ROBOT` mogą pisać priv do bota, a wiadomości są przekazywane 1:1 na kanał z env `ROBOT3_FORWARD_CHANNEL`
- Obsługuje tekst i załączniki
- Wymaga intencji `DirectMessages` + partial `Channel`
- **Ping roli:** Jeśli wiadomość DM zaczyna się od `@`, zostanie wysłana z pingiem do roli z env `ROBOT3_MENTION_ROLE`

---

## Zmienne Środowiskowe

```env
WYDARZYNIER_TOKEN=bot_token_here
WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL=channel_id  # Kanał z panelem kontrolnym przypomnień

# Opcjonalne - z fallbackiem do wartości produkcyjnych
WYDARZYNIER_PARTY_CHANNEL=channel_id               # Kanał /party
WYDARZYNIER_PARTY_NOTIFICATIONS_ROLE=role_id       # Rola powiadomień o party
ROBOT3_FORWARD_CHANNEL=channel_id                  # Kanał forward dla Robot3
ROBOT3_MENTION_ROLE=role_id                        # Rola do pingu (@) dla Robot3
ROBOT3_ACTIVATION_CHANNEL=channel_id               # Kanał z przyciskiem aktywacji Robot3
```

## Najlepsze Praktyki

**Lobby Party:**
- **Logger:** createBotLogger('Wydarzynier')
- **Lobby:** Max 7 osób (1+6), 15min dyskusja
- **Wątki:** Prywatne, auto-usuwanie po zamknięciu
- **Repozytorium:** 5min interval repost

**System Przypomnień:**
- **Persistencja:** Wszystkie dane w JSON (przypomnienia.json z messagesToDelete[], eventy.json, strefy_czasowe.json)
- **Harmonogram:** Sprawdzanie co 30s, wyzwalanie zaplanowanych przypomnień
- **Tablica:** Auto-update co 1min, Discord timestamps, przyciski interaktywne
- **Limity:** Max 50 przypomnień/użytkownik, max 200 aktywnych przypomnień całkowicie
- **Interwały:** 1s-90d lub "ee" (specjalny wzorzec: 3d x8, potem 4d, repeat)

## Struktura Plików

```
Wydarzynier/
├── index.js
├── config/
│   └── config.js
├── handlers/
│   ├── interactionHandlers.js         # Główny handler + redirect do przypomnień
│   ├── przypominienHandlers.js        # Handler przypomnień/eventów (skopiowany z STAR)
│   ├── messageHandlers.js
│   └── reactionHandlers.js
├── services/
│   ├── lobbyService.js                # Lobby party (oryginalne)
│   ├── nagrodyService.js              # Nagrody specjalne - zliczanie i ranking
│   ├── timerService.js                # Timery lobby (oryginalne)
│   ├── bazarService.js                # Bazar (oryginalne)
│   ├── przypomnieniaMenedzer.js       # CRUD szablonów i przypomnień (z STAR)
│   ├── harmonogram.js                 # Scheduler 30s (z STAR)
│   ├── tablicaMenedzer.js             # Tablica z embeddami (z STAR)
│   ├── eventMenedzer.js               # CRUD eventów (z STAR)
│   ├── listaEventowMenedzer.js        # Lista eventów na kanale (z STAR)
│   └── strefaCzasowaManager.js        # Zarządzanie strefą czasową (z STAR)
└── data/
    ├── lobbies.json                   # Aktywne lobby (oryginalne, + rewardPromptAt/rewardPromptSent)
    ├── nagrody.json                   # Statystyki nagród specjalnych
    ├── timers.json                    # Timery lobby (oryginalne)
    ├── przypomnienia.json             # Szablony i zaplanowane (z STAR)
    ├── eventy.json                    # Eventy i kanał listy (z STAR)
    └── strefy_czasowe.json            # Strefa czasowa bota (z STAR)
```
