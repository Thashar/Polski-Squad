### 🎉 Wydarzynier Bot

**8 Systemów:**

**Lobby Party (oryginalne):**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
   - **`/party-close` z odliczaniem** (`runCloseCountdown`): na końcu wątku ląduje wiadomość pożegnalna z licznikiem edytowanym co sekundę (`messages.lobbyCloseCountdown`, `lobby.closeCountdownSeconds` = 5). Dopiero po odliczeniu wywoływane jest `deleteLobby` (kasuje wątek + ogłoszenie + timer). Właściciel dostaje ephemeral z informacją od razu, a potwierdzenie zamknięcia po odliczaniu
   - Przycisk „Zamknij lobby" (`handleCloseLobbyButton`) kasuje wątek **od razu**, bez odliczania
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
   - Wiadomość powitalna w wątku (`messages.lobbyCreated`) wypisuje komendy właściciela (`/party-add`, `/party-kick`, `/party-close`) **oraz sekcję nagród** (`/rewards`, `/stats`) z krótkim opisem każdej
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback
8. **Nagrody specjalne (czerwone skrzynki)** - `nagrodyService.js`: Zliczanie nagród zdobytych w party, ranking `/stats`, korekta `/correct`

**Funkcjonalność Nagród Specjalnych:**
- **Pytanie o nagrodę:** 1 minuta po zapełnieniu lobby (`lobby.rewardPromptDelay`) bot wysyła w wątku pytanie z 12 przyciskami (same emoji nagród, bez opisów, 3 rzędy: 5+5+2)
- **Definicje nagród:** `config.rewards` - lista `{ key, name, emoji }` (Pet AW, RC, Chip, AW, Czerwona kolekcja, Mount Core, Chest Core Selector, Pet Crystal, Panda Shard, Transmute Core, Mount Shards Chest, Epic Tech Selector). Kolejność w tablicy = kolejność przycisków i kolumn w rankingu
  - **Klucze nagród nie mogą zawierać `_`** - customId przycisków (`myrw_<klucz>_<delta>`, `corr_<id>_<klucz>_<delta>`) jest parsowany przez `split('_')`
- **Potwierdzenie:** Kliknięcie emoji → ephemeral „Czy na pewno otrzymałeś taką nagrodę…" z przyciskami **Tak** / **Nie**
  - **Tak** → nagroda doliczana na konto użytkownika + ogłoszenie na kanale `/party` (nagłówek `#`): `# <@user> właśnie zgarnął nagrodę specjalną! <emoji>.` + linia zachęty do użycia `/stats`
  - **Nie** → ephemeral z pouczeniem o niezaburzaniu statystyk (nic nie jest zliczane)
- **Blokada GLOBALNA - jedna nagroda na losowanie:** Pierwsze potwierdzone zgłoszenie zamyka pytanie dla **całego party**. Kolejne kliknięcia dostają ephemeral `rewardAlreadyTaken` (albo `rewardAlreadyClaimed`, gdy klika ta sama osoba)
  - **Wspólna wiadomość jest edytowana** (`closeRewardPrompt`): przyciski wyszarzone dla wszystkich (customId `reward_done_<klucz>`, obsługiwany `deferUpdate()`), a do treści dopisywane `rewardPromptClosed` z pingiem zgłaszającego
  - **Samonaprawa:** gdyby edycja wiadomości się nie powiodła (brak uprawnień, wątek zarchiwizowany), blokada i tak działa po stronie bota - przy kolejnym kliknięciu handler ponawia wyszarzenie (`fetchRewardPrompt` + `closeRewardPrompt`)
  - Rezerwacja przez `tryRegisterClaim(promptMessageId, userId)` w `nagrodyService.js` - **synchroniczna**, więc dwa równoczesne potwierdzenia nie doliczą dwóch nagród. `getPromptClaimer(promptMessageId)` zwraca zgłaszającego. Gdy doliczenie rzuci błąd, rezerwacja jest cofana (`releaseClaim`) i losowanie znów jest otwarte
  - Historia zgłoszeń: `claims` w `nagrody.json` (`messageId pytania -> [userId]` - przy blokadzie globalnej tablica ma jeden wpis, format zostawiony dla zgodności ze starymi danymi), limit 200 ostatnich losowań (`maxClaimEntries`), najstarsze usuwane automatycznie
- **Przepisywanie pytania na koniec wątku:** Co `lobby.rewardPromptRepositionMessages` (domyślnie **10**) wiadomości w wątku bot kasuje pytanie i wysyła je ponownie, żeby nie uciekło w górę rozmowy - analogicznie do repozycjonowania ogłoszenia party
  - Licznik: `handleRewardPromptReposition` (wołane z `Events.MessageCreate` w `index.js` przez `handleThreadMessage`), przepisanie robi `repositionRewardPrompt`
  - **Wiadomości bota NIE są liczone** - inaczej samo przepisane pytanie wyzwalałoby kolejne przepisanie i pytania mnożyłyby się w nieskończoność (liczone są wiadomości graczy)
  - **Blokada równoległych przepisań:** modułowy `Set rewardPromptRepositioning` (id lobby) + wyzerowanie licznika **przed** wysyłką - bez tego wiadomości przychodzące w trakcie kasowania/wysyłania wyzwalały drugie przepisanie i pytanie dublowało się
  - **Stare wiadomości są kasowane** - `findRewardPromptMessages` przegląda 50 ostatnich wiadomości wątku i usuwa **każdą** kopię pytania (rozpoznawaną po przyciskach `reward_pick_`), także osieroconą po wcześniejszych błędach. Zgłoszenia są kluczowane po ID wiadomości z pytaniem, więc dwie żywe kopie oznaczałyby dwie niezależne blokady
  - Zgłoszenie „Tak" zapisuje claim zawsze na **aktualnym** `lobby.rewardPromptMessageId` (a nie na ID z customId), żeby potwierdzenie z ephemerala otwartego przed przepisaniem trafiło na właściwe pytanie
  - Po zgłoszeniu nagrody pytanie **nie jest już przepisywane** (losowanie zamknięte)
  - **Persistencja:** `rewardPromptMessageId` i `rewardPromptMessagesSince` w `lobbies.json` - licznik przeżywa restart bota
- **customId:** `reward_pick_<klucz>` (przyciski emoji), `reward_yes_<klucz>_<idKanału>_<idWiadomości>` (Tak), `reward_no` (Nie), `reward_done_<klucz>` (wyszarzone po zgłoszeniu). Routing przed wyszukiwaniem lobby, więc przyciski działają dla wszystkich uczestników party i przeżywają restart bota
- **Persistencja:** `data/nagrody.json` (`{ users: { userId: { displayName, rewards, total, manualRewards, manualTotal, lastReward } }, claims: {} }`). Zaplanowane pytanie zapisywane w `lobbies.json` (`rewardPromptAt`, `rewardPromptSent`, `rewardPromptMessageId`, `rewardPromptMessagesSince`) i odtwarzane przy starcie przez `restoreRewardPrompts` w `index.js`
**Dwa niezależne liczniki nagród (`nagrodyService.js`):**
- `rewards` / `total` - nagrody z systemu Party (przycisk pod pytaniem w wątku). **Tylko one liczą się do rankingu `/stats`**
- `manualRewards` / `manualTotal` - nagrody dopisane samodzielnie przez `/add_reward`. **Nigdy nie trafiają do `/stats`** - widoczne wyłącznie w `/rewards` właściciela
- `ensureUser()` migruje w locie wpisy sprzed wprowadzenia nagród własnych (dopisuje `manualRewards`/`manualTotal`), `recalculateTotals()` przelicza obie sumy

**Komendy nagród:**
- **`/stats`:** Ephemeral embed z rankingiem (🥇🥈🥉, potem numeracja) - nick, suma nagród z party i rozbicie `emoji ×N`; na dole pole z sumą wszystkich nagród wg typu. Opis przycinany do limitu 3800 znaków z informacją o ukrytych graczach
- **`/rewards`:** Publiczna (każdy użytkownik), bez parametrów, **interaktywny panel** ephemeral, dotyczy **wyłącznie osoby wywołującej**
  - **Embed** (`buildOwnRewardsEmbed`): trzy kolumny inline z ikoną i liczbą - `🎉 Z party` | `📝 Dodane samodzielnie` | `📦 Razem`, poniżej pole `Podsumowanie` z sumami obu źródeł i łączną liczbą, a po korekcie `Ostatnia zmiana`. **Wypisywane są tylko nagrody z niezerowym stanem** (w którymkolwiek liczniku); przy pustym koncie zamiast kolumn pojawia się zachęta do dopisania nagrody przyciskiem
  - **Przyciski** (`buildOwnRewardsButtons` → wspólny `buildSignedRewardRows`): **dwie wiadomości** - pierwsza to embed + zielone `+1`, druga to same czerwone `−1` bez tekstu (customId `myrw_<klucz>_1` oraz `myrw_<klucz>_-1_<idPanelu>`, bez ID użytkownika - zawsze konto klikającego)
  - Zmieniają **wyłącznie licznik `manualRewards`** (dodane samodzielnie). Nagród z party ta komenda nie rusza, więc nie da się nią podbić rankingu `/stats`. Licznik nie schodzi poniżej 0
  - Zastąpiła wcześniejsze osobne komendy `/add_reward` i `/remove_reward` (usunięte)
- **`/correct`:** Tylko administrator, **interaktywny panel**, wszystko ephemeral. Jedyny parametr: `użytkownik`. Działa **wyłącznie na nagrodach z party**, czyli wpływa na ranking `/stats` (źródło na sztywno `party`; nagrodami z `/add_reward` gracze zarządzają sami)
  - **Embed** (`buildCorrectionEmbed`): stan **tylko posiadanych** nagród gracza (zerowe pomijane, przy pustym koncie komunikat zastępczy), suma z party, pole „Ostatnia zmiana" po każdym kliknięciu
  - **Przyciski** (`buildCorrectionButtons` → wspólny `buildSignedRewardRows`): **dwie wiadomości** - pierwsza to embed + zielone `+1`, druga to same czerwone `−1` bez tekstu (customId `corr_<idGracza>_<klucz>_1` oraz `corr_<idGracza>_<klucz>_-1_<idPanelu>`)
  - **Układ dwóch wiadomości** (`buildSignedRewardRows`, `sendMinusPanelMessage`): każdy znak ma własną wiadomość, więc limit 5 rzędów Discorda liczy się osobno dla plusów i minusów. **Mieści się 25 nagród** zamiast 12 przy wspólnej wiadomości; przy większej liczbie `logger.warn` i obcięcie do 5 rzędów
    - Druga wiadomość jest wysyłana przez `followUp` z treścią = spacja zerowej szerokości (Discord nie przyjmuje wiadomości zupełnie bez treści)
    - Kliknięcie **minusa** nie może odświeżyć embeda przez `interaction.update()` (embed jest w innej wiadomości), więc panel jest zapamiętywany w **modułowej** mapie `rewardPanels` (`idPanelu` → webhook interakcji, wpis wygasa po 14 min razem z tokenem). Mapa **nie może być polem instancji** - `handleInteraction` tworzy nowy `InteractionHandler` przy każdej interakcji. Minus robi `deferUpdate()`, a potem `refreshRewardPanel()` edytuje pierwszą wiadomość przez `webhook.editMessage('@original', …)`
    - **Mapa jest w RAM** - po restarcie bota minusy ze starego panelu nadal doliczają nagrodę, ale zamiast odświeżenia embeda użytkownik dostaje ephemeral z wynikiem zmiany i prośbą o ponowne wywołanie komendy
  - Kliknięcie zmienia licznik o ±1 i **odświeża embed w pierwszej wiadomości**, więc admin może poprawiać wiele nagród bez ponownego wywoływania komendy. Uprawnienia sprawdzane ponownie przy każdym kliknięciu
  - Licznik nie schodzi poniżej 0 - przy próbie zejścia z zera embed pokazuje ostrzeżenie o braku zmiany

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

**Komendy:** `/party`, `/party-add`, `/party-kick`, `/party-close`, `/stats`, `/rewards`, `/correct`
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
