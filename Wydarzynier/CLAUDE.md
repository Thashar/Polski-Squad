### 🎉 Wydarzynier Bot

**8 Systemów:**

**Lobby Party (oryginalne):**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
   - **`/party-close` z odliczaniem** (`closeLobbyWithCountdown` → `runCloseCountdown` + `deleteLobby`): na końcu wątku ląduje wiadomość pożegnalna z licznikiem edytowanym co sekundę (`messages.lobbyCloseCountdown`, `lobby.closeCountdownSeconds` = 5). Właściciel dostaje ephemeral z informacją od razu, a potwierdzenie zamknięcia po odliczaniu
   - **`/party-close` gdy pytanie o nagrodę się nie pojawiło** (lobby nie zdążyło się zapełnić): zamiast zamykać od razu, bot wysyła w wątku **pytanie zamykające** (`sendClosingRewardPrompt`, treść `messages.rewardPromptOnClose`) - nagrody + dodatkowy przycisk **„Nikt z obecnych nie otrzymał czerwonej skrzynki"** (`reward_none_<idLobby>`). Lobby zamyka się dopiero po wyborze: zgłoszenie nagrody (Tak) albo kliknięcie „nikt nie otrzymał" → odliczanie 5 s → `deleteLobby`
     - Flaga `rewardPromptClosesLobby` (persistowana w `lobbies.json`) mówi, że po zgłoszeniu nagrody trzeba zamknąć lobby; steruje też treścią i przyciskami przy wyszarzaniu (`closeRewardPrompt`) i **wyłącza przepisywanie** tego pytania
     - **Limit 20 nagród** dla pytania zamykającego (`buildClosingRewardButtons`) - piąty rząd zajmuje przycisk „nikt nie otrzymał"; przy większej liczbie `logger.warn` i obcięcie
   - **Automatyczne zamknięcie po wygaśnięciu czasu** też ma odliczanie (`messages.lobbyExpiredCountdown`) - we wszystkich `deleteCallback` w `interactionHandlers.js` oraz w `timerService.deleteLobby` (timery przywrócone po restarcie). Wspólna mechanika w `utils/helpers.js` → `runThreadCountdown(thread, seconds, messageFactory)`
   - Przycisk „Zamknij lobby" pod ostrzeżeniem (`handleCloseLobbyButton`) kasuje wątek **od razu**, bez odliczania i bez pytania o nagrodę
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
   - Wiadomość powitalna w wątku (`messages.lobbyCreated`) wypisuje komendy właściciela (`/party-add`, `/party-kick`, `/party-close`) **oraz sekcję nagród** (`/rewards`, `/stats`) z krótkim opisem każdej
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback
   - **Zaproszenie do powiadomień** (`messages.lobbyFull` + przycisk `toggle_party_notifications`): wysyłane w wątku **30 sekund po zapełnieniu lobby** (`lobby.notificationInviteDelay`), a nie natychmiast. Planuje je `scheduleNotificationInvite` (z `handleFullLobby`), wysyła `sendNotificationInvite`
   - **Persistencja:** `notificationInviteAt` i `notificationInviteSent` w `lobbies.json`; `restoreNotificationInvites` w `index.js` uzbraja timer po restarcie (timery żyją tylko w RAM, więc bez tego lobby zapełnione tuż przed restartem nie dostałoby wiadomości)
   - **Wyrzucenie gracza przez właściciela** (`/party-kick`, gdy `isFull` spada na `false`) anuluje **niewysłane** zaproszenie (`cancelNotificationInvite`) - po ponownym zapełnieniu jest planowane od nowa. Zaproszenia już wysłanego nie powtarzamy
   - **⚠️ Kroki w `handleFullLobby` są rozdzielone** - wcześniej wszystko siedziało w jednym `try`, zaczynając od `channels.fetch` i wysyłki wiadomości: jeden nieudany request zabierał ze sobą pytanie o nagrodę i 15-minutowy timer. Tak samo w `handleAcceptPlayer` i `/party-add` dodanie gracza do wątku ma własny `try` - wyjątek nie może pominąć sprawdzenia `isFull`, bo lobby zostawałoby pełne, ale bez wiadomości, pytania o nagrodę i timera
8. **Nagrody specjalne (czerwone skrzynki)** - `nagrodyService.js`: Zliczanie nagród zdobytych w party, ranking `/stats`, korekta `/correct`

**Funkcjonalność Nagród Specjalnych:**
- **Pytanie o nagrodę:** 1 minuta po zapełnieniu lobby (`lobby.rewardPromptDelay`) bot wysyła w wątku pytanie z 16 przyciskami (same emoji nagród, bez opisów, 4 rzędy: 5+5+5+1)
- **Definicje nagród:** `config.rewards` - lista `{ key, name, emoji }` (Pet AW, RC, Chip, AW, Czerwona kolekcja, Mount Core, Chest Core Selector, Pet Crystal, Panda Shard, Transmute Core, Mount Shards Chest, Epic Tech Selector, Chest S Selector, Pet Chest Selector, Żółta kolekcja, Chest Selector Resonance Red Coll). Kolejność w tablicy = kolejność przycisków i kolumn w rankingu
  - **Klucze nagród nie mogą zawierać `_`** - customId przycisków (`myrw_<klucz>_<delta>`, `corr_<id>_<klucz>_<delta>`) jest parsowany przez `split('_')`
- **Potwierdzenie:** Kliknięcie emoji → ephemeral „Czy na pewno otrzymałeś taką nagrodę…" z przyciskami **Tak** / **Nie**
  - **Tak** → nagroda doliczana na konto użytkownika + ogłoszenie na kanale `/party` (nagłówek `#`): `# <@user> właśnie zgarnął nagrodę specjalną! <emoji>.` + linia zachęty do użycia `/stats`
  - **Nie** → ephemeral z pouczeniem o niezaburzaniu statystyk (nic nie jest zliczane)
- **Blokada GLOBALNA - jedna nagroda na losowanie:** Pierwsze potwierdzone zgłoszenie zamyka pytanie dla **całego party**. Kolejne kliknięcia dostają ephemeral `rewardAlreadyTaken` (albo `rewardAlreadyClaimed`, gdy klika ta sama osoba)
  - **Wspólna wiadomość jest edytowana** (`closeRewardPrompt`): przyciski wyszarzone dla wszystkich (customId `reward_done_<klucz>`, obsługiwany `deferUpdate()`), a do treści dopisywane `rewardPromptClosed` z pingiem zgłaszającego
  - **Samonaprawa:** gdyby edycja wiadomości się nie powiodła (brak uprawnień, wątek zarchiwizowany), blokada i tak działa po stronie bota - przy kolejnym kliknięciu handler ponawia wyszarzenie (`fetchRewardPrompt` + `closeRewardPrompt`)
  - Rezerwacja przez `tryRegisterClaim(promptMessageId, userId)` w `nagrodyService.js` - **synchroniczna**, więc dwa równoczesne potwierdzenia nie doliczą dwóch nagród. `getPromptClaimer(promptMessageId)` zwraca zgłaszającego. Gdy doliczenie rzuci błąd, rezerwacja jest cofana (`releaseClaim`) i losowanie znów jest otwarte
  - Historia zgłoszeń: `claims` w `nagrody.json` (`messageId pytania -> [userId]` - przy blokadzie globalnej tablica ma jeden wpis, format zostawiony dla zgodności ze starymi danymi), limit 200 ostatnich losowań (`maxClaimEntries`), najstarsze usuwane automatycznie
- **Wyrzucenie gracza przez właściciela → pytanie znika** (`cancelRewardPrompt`): tylko `/party-kick` (gdy `isFull` spada na `false`) kasuje wiadomość z nagrodami i zeruje stan (`rewardPromptSent`, `rewardPromptAt`, `rewardPromptMessageId`, `rewardPromptMessagesSince`) - przepisywanie się zatrzymuje
  - **Samodzielne wyjście gracza z lobby pytania NIE kasuje** - `ThreadMembersUpdate` w `index.js` tylko zwalnia miejsce; wiadomość zostaje i dalej jest przepisywana
  - **Po ponownym zapełnieniu pytanie wraca** - `handleFullLobby` → `scheduleRewardPrompt` planuje je od nowa (znowu 1 minuta od zapełnienia). To **nowe losowanie**: nowa wiadomość = nowe ID = nowa blokada, więc nagrodę znów może zgłosić jedna osoba
  - `sendRewardPrompt` sprawdza przed wysłaniem obecność `rewardPromptAt` oraz czy zaplanowany termin już minął - dzięki temu `setTimeout` sprzed anulowania nie wystrzeli pytania przedwcześnie (stanu `isFull` nie sprawdza, bo pytanie ma przetrwać samodzielne wyjście gracza)
- **Przepisywanie pytania na koniec wątku:** Co `lobby.rewardPromptRepositionMessages` (domyślnie **10**) wiadomości w wątku bot kasuje pytanie i wysyła je ponownie, żeby nie uciekło w górę rozmowy - analogicznie do repozycjonowania ogłoszenia party
  - Licznik: `handleRewardPromptReposition` (wołane z `Events.MessageCreate` w `index.js` przez `handleThreadMessage`), przepisanie robi `repositionRewardPrompt`
  - **Wiadomości bota NIE są liczone** - inaczej samo przepisane pytanie wyzwalałoby kolejne przepisanie i pytania mnożyłyby się w nieskończoność (liczone są wiadomości graczy)
  - **Blokada równoległych przepisań:** modułowy `Set rewardPromptRepositioning` (id lobby) + wyzerowanie licznika **przed** wysyłką - bez tego wiadomości przychodzące w trakcie kasowania/wysyłania wyzwalały drugie przepisanie i pytanie dublowało się
  - **Stare wiadomości są kasowane** - `findRewardPromptMessages` przegląda 50 ostatnich wiadomości wątku i usuwa **każdą** kopię pytania (rozpoznawaną po przyciskach `reward_pick_`), także osieroconą po wcześniejszych błędach. Zgłoszenia są kluczowane po ID wiadomości z pytaniem, więc dwie żywe kopie oznaczałyby dwie niezależne blokady
  - Zgłoszenie „Tak" zapisuje claim zawsze na **aktualnym** `lobby.rewardPromptMessageId` (a nie na ID z customId), żeby potwierdzenie z ephemerala otwartego przed przepisaniem trafiło na właściwe pytanie
  - Po zgłoszeniu nagrody pytanie **nie jest już przepisywane** (losowanie zamknięte)
  - **Persistencja:** `rewardPromptMessageId` i `rewardPromptMessagesSince` w `lobbies.json` - licznik przeżywa restart bota
- **customId:** `reward_pick_<klucz>` (przyciski emoji), `reward_yes_<klucz>_<idKanału>_<idWiadomości>` (Tak), `reward_no` (Nie), `reward_done_<klucz>` (wyszarzone po zgłoszeniu), `reward_none_<idLobby>` („nikt nie otrzymał" w pytaniu zamykającym). Routing przed wyszukiwaniem lobby, więc przyciski działają dla wszystkich uczestników party i przeżywają restart bota
- **Persistencja:** `data/nagrody.json` (`{ users: { userId: { displayName, rewards, total, manualRewards, manualTotal, lastReward } }, claims: {} }`). Zaplanowane pytanie zapisywane w `lobbies.json` (`rewardPromptAt`, `rewardPromptSent`, `rewardPromptMessageId`, `rewardPromptMessagesSince`) i odtwarzane przy starcie przez `restoreRewardPrompts` w `index.js`
**Dwa niezależne liczniki nagród (`nagrodyService.js`):**
- `rewards` / `total` - nagrody z systemu Party (przycisk pod pytaniem w wątku). **Tylko one budują kolejność w rankingu `/stats`**
- `manualRewards` / `manualTotal` - nagrody dopisane samodzielnie przez `/rewards`. **Nigdy nie wpływają na kolejność w rankingu `/stats`** - są tam tylko pokazywane (ikona 📝) obok nagród z party
- `ensureUser()` migruje w locie wpisy sprzed wprowadzenia nagród własnych (dopisuje `manualRewards`/`manualTotal`), `recalculateTotals()` przelicza obie sumy

**Komendy nagród:**
- **`/stats`:** Ephemeral embed z rankingiem (`buildStatsView`), układ wzorowany na rankingu **EndersEcho**
  - **Wpis gracza** - nagłówek `` `01`  **nick** `` (numer w inline code + pogrubiony nick, bez liczb), pod nim linie cytatu: `> ikony×N` (nagrody z party), `> Zdobyte na randomach:  ikony×N` (dodane samodzielnie, tylko gdy są) i na końcu `> Suma na serwerze: **N** | Suma z randomami: **M**` (`N` to licznik z party ustawiający miejsce w rankingu, `M` to `N` + nagrody z randomów). Gracze rozdzieleni **pustą linią**
  - **Bez systemowych emoji** - żadnych medali, 🎁/📝 ani ozdobnych separatorów; w rankingu pojawiają się wyłącznie emotki nagród, żeby nicki były czytelne
  - **Nagrody dodane samodzielnie są widoczne, ale nie liczą się do rankingu** - sortowanie idzie po liczniku z party (`manualTotal` tylko rozstrzyga remisy). Gracze mający **wyłącznie** nagrody własne też są na liście (z sumą `0`, na końcu)
  - **Stronicowanie (zmienna liczba graczy na stronę):** `config.stats.usersPerPage` = 10 to **maksimum**, nie stała liczba. Strony składa `buildStatsPages` – dokłada graczy dopóki opis mieści się w `STATS_DESCRIPTION_LIMIT` (3800 znaków, zapas wobec limitu 4096 embeda). Przy kontach z wieloma rodzajami nagród (emotka niestandardowa to ~35 znaków) na stronie ląduje mniej graczy, dzięki czemu **ikony nagród są zawsze widoczne** – wcześniej po przekroczeniu limitu cała strona traciła rozbicie na ikony. Rezygnacja z ikon została wyłącznie jako awaryjna ścieżka dla jednego skrajnie długiego wpisu. Numeracja jest ciągła (`start` strony), przyciski `Poprzednia` / `Następna` (customId `stats_page_<numer>`, `handleStatsPageButton` → `interaction.update`). Przy jednej stronie przycisków nie ma. Dane są pobierane na nowo przy każdej zmianie strony
  - **Pola podsumowania:** `Łącznie z party   suma` z rozbiciem wg typu, a gdy ktokolwiek ma nagrody własne, także `Dodane samodzielnie   suma`. Stopka: `Strona X/Y`, liczba graczy i informacja, że ranking liczy tylko nagrody z party
  - **Limit opisu:** przy bardzo rozbudowanych kontach (opis > 3800 znaków) linie cytatu z ikonami są pomijane i zostają same nagłówki graczy
- **`/rewards`:** Publiczna (każdy użytkownik), bez parametrów, **interaktywny panel** ephemeral, dotyczy **wyłącznie osoby wywołującej**
  - **Embed** (`buildOwnRewardsEmbed`): trzy kolumny inline z ikoną i liczbą - `🎉 Z party` | `📝 Dodane samodzielnie` | `📦 Razem`, poniżej pole `Podsumowanie` z sumami obu źródeł i łączną liczbą, a po korekcie `Ostatnia zmiana`. **Wypisywane są tylko nagrody z niezerowym stanem** (w którymkolwiek liczniku); przy pustym koncie zamiast kolumn pojawia się zachęta do dopisania nagrody przyciskiem
  - **Przyciski** (`buildOwnRewardsButtons` → wspólny `buildSignedRewardRows`): **dwie wiadomości** - pierwsza to embed + zielone `+1`, druga to same czerwone `−1` bez tekstu (customId `myrw_<klucz>_1` oraz `myrw_<klucz>_-1_<idPanelu>`, bez ID użytkownika - zawsze konto klikającego)
  - Zmieniają **wyłącznie licznik `manualRewards`** (dodane samodzielnie). Nagród z party ta komenda nie rusza, więc nie da się nią podbić rankingu `/stats`. Licznik nie schodzi poniżej 0
  - Zastąpiła wcześniejsze osobne komendy `/add_reward` i `/remove_reward` (usunięte)
- **`/correct`:** **interaktywny panel**, wszystko ephemeral. Jedyny parametr: `użytkownik`. Działa **wyłącznie na nagrodach z party**, czyli wpływa na ranking `/stats` (źródło na sztywno `party`; nagrodami dodanymi samodzielnie gracze zarządzają sami przez `/rewards`)
  - **Dostęp:** administratorzy **oraz role z `WYDARZYNIER_CORRECT_ROLES`** (lista ID po przecinku). Sprawdza `canCorrectRewards(interaction)` - przy wywołaniu komendy i ponownie przy **każdym** kliknięciu przycisku korekty
  - **Widoczność komendy:** gdy `WYDARZYNIER_CORRECT_ROLES` jest puste, komenda rejestruje się z `setDefaultMemberPermissions(Administrator)` (widzą ją tylko admini). Gdy role są ustawione, rejestruje się **bez** tego ograniczenia (inaczej Discord ukryłby ją przed nie-adminami), a dostępu pilnuje sprawdzenie w kodzie - osoby bez uprawnień dostają `❌ Nie masz uprawnień do korygowania nagród.`
  - **Embed** (`buildCorrectionEmbed`): stan **tylko posiadanych** nagród gracza (zerowe pomijane, przy pustym koncie komunikat zastępczy), suma z party, pole „Ostatnia zmiana" po każdym kliknięciu
  - **Przyciski** (`buildCorrectionButtons` → wspólny `buildSignedRewardRows`): **dwie wiadomości** - pierwsza to embed + zielone `+1`, druga to same czerwone `−1` bez tekstu (customId `corr_<idGracza>_<klucz>_1` oraz `corr_<idGracza>_<klucz>_-1_<idPanelu>`)
  - **Układ dwóch wiadomości** (`buildSignedRewardRows`, `sendMinusPanelMessage`): każdy znak ma własną wiadomość, więc limit 5 rzędów Discorda liczy się osobno dla plusów i minusów. **Mieści się 25 nagród** zamiast 12 przy wspólnej wiadomości; przy większej liczbie `logger.warn` i obcięcie do 5 rzędów
    - Druga wiadomość jest wysyłana przez `followUp` z treścią = spacja zerowej szerokości (Discord nie przyjmuje wiadomości zupełnie bez treści)
    - Kliknięcie **minusa** nie może odświeżyć embeda przez `interaction.update()` (embed jest w innej wiadomości), więc panel jest zapamiętywany w **modułowej** mapie `rewardPanels` (`idPanelu` → webhook interakcji, wpis wygasa po 14 min razem z tokenem). Mapa **nie może być polem instancji** - `handleInteraction` tworzy nowy `InteractionHandler` przy każdej interakcji. Po `deferUpdate()` minus odświeża pierwszą wiadomość przez `refreshRewardPanel()` → `webhook.editMessage('@original', …)`
    - **Mapa jest w RAM** - po restarcie bota minusy ze starego panelu nadal doliczają nagrodę, ale zamiast odświeżenia embeda użytkownik dostaje ephemeral z wynikiem zmiany i prośbą o ponowne wywołanie komendy
    - **⚠️ `deferUpdate()` idzie PIERWSZE, dla OBU znaków** (`handleCorrectionButton`, `handleOwnRewardButton`) - Discord daje 3 s na pierwszą odpowiedź, a niżej leci `guild.members.fetch()` (request do API) i zapis `nagrody.json`. Wcześniej plus odpowiadał dopiero na końcu przez `interaction.update()` i przy wolniejszym fetchu trafiał w martwy token (`DiscordAPIError[10062]`) **już PO doliczeniu nagrody**: dane zmienione, `respondEphemeral` z catcha też nie miał na czym odpowiedzieć (błąd połykany przez `.catch(() => {})`), a log potwierdzenia był przeskakiwany przez wyjątek. Admin widział „interakcja nie powiodła się", klikał ponownie i **licznik rósł dwa razy**. Teraz: `deferUpdate()` → praca → `editReply()` (plus) / `refreshRewardPanel()` (minus). Kod 10062 przy samym `deferUpdate` kończy się `logger.warn` i `return` **przed** zmianą danych, a log korekty leci zaraz po zapisie, jeszcze przed odrysowaniem panelu
  - Kliknięcie zmienia licznik o ±1 i **odświeża embed w pierwszej wiadomości**, więc admin może poprawiać wiele nagród bez ponownego wywoływania komendy. Uprawnienia sprawdzane ponownie przy każdym kliknięciu
  - Licznik nie schodzi poniżej 0 - przy próbie zejścia z zera embed pokazuje ostrzeżenie o braku zmiany

**System Przypomnień i Eventów (skopiowane z STAR bota):**
5. **Przypomnienia** - `przypomnieniaMenedzer.js`: Szablony (text/embed) + Zaplanowane przypomnienia z interwałami (1s-28d lub "ee")
6. **Eventy** - `eventMenedzer.js`: Dodawanie eventów z nazwą, czasem rozpoczęcia i interwałem powtarzania
7. **Panel Kontrolny** - `tablicaMenedzer.js`: Interaktywna tablica z embeddami przypomnień, auto-update co 1min, przyciski zarządzania

**Funkcjonalność Przypomnień:**
- **Szablony:** Tworzenie szablonów wiadomości (tekst lub embed) z nazwą, treścią, ikoną i obrazem
  - **Opis embed jest opcjonalny** - pusty opis jest zamieniany na zero-width space (`safeEmbedDescription` w `przypominienHandlers.js`, analogiczny guard w `harmonogram.js`), bo `EmbedBuilder.setDescription` wymaga 1-4096 znaków i pusty string rzucał błąd walidacji przy podglądzie/wysyłce
  - **Nazwa szablonu jest opcjonalna, ale nigdy nie bywa pusta** - pole `Nazwa szablonu` w modalu to `setRequired(false)`, a pusta nazwa łamała walidację select menu (`addOptions` → `Received one or more errors`, bo Discord wymaga etykiety 1-100 znaków). Pusta nazwa jest zamieniana na `Szablon <id>`:
    - `sanitizeTemplateName()` w `przypomnieniaMenedzer.js` - przy `createTemplate` i `updateTemplate`
    - Migracja przy starcie w `loadData()` - naprawia stare szablony bez nazwy zapisane w `przypomnienia.json`
    - `safeSelectLabel()` w `przypominienHandlers.js` - zabezpieczenie przy budowaniu opcji select menu (szablony, zaplanowane przypomnienia, eventy); dodatkowo opis opcji jest przycinany do 100 znaków, a `value` rzutowane na string
  - **Analogiczny guard dla eventów** - `sanitizeEventName()` w `eventMenedzer.js` (`createEvent`, `updateEvent` + migracja w `loadData()`) zamienia pustą nazwę na `Event <id>`
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
- **Przypomnienia jednorazowe NIE kasują szablonu** - po wyzwoleniu (lub wygaśnięciu wstrzymanego/wznowionego) usuwany jest tylko wpis `scheduled` i embed z tablicy, a szablon zostaje do ponownego użycia (`harmonogram.js` → `checkScheduled`, `przypomnieniaMenedzer.js` → `resumeScheduled`). Szablon kasuje wyłącznie ręczne potwierdzenie usunięcia (`handleConfirmDeleteTemplate`)
- **Harmonogram:** Sprawdzanie co 30s i auto-wysyłanie przypomnień + czyszczenie starych wiadomości typu 1 (po 23h 50min)
  - **Blokada ponownego wejścia (`sprawdzanieWToku`):** `setInterval` nie czeka na zakończenie poprzedniego przebiegu, a jeden przebieg robi sporo I/O i przy rate limicie Discorda potrafi przekroczyć 30 s. Bez blokady kolejny tick wchodził na niedokończony poprzedni — oba widziały `now >= nextTrigger` tego samego wpisu, zanim `updateNextTrigger()` zdążył go przesunąć, i przypomnienie (często z pingiem @everyone) szło DWA razy
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
WYDARZYNIER_CORRECT_ROLES=role_id1,role_id2        # Role, które oprócz adminów mogą używać /correct
ROBOT3_FORWARD_CHANNEL=channel_id                  # Kanał forward dla Robot3
ROBOT3_MENTION_ROLE=role_id                        # Rola do pingu (@) dla Robot3
ROBOT3_ACTIVATION_CHANNEL=channel_id               # Kanał z przyciskiem aktywacji Robot3
```

## Najlepsze Praktyki

**Przyciski - potwierdzanie interakcji (KRYTYCZNE):**
- **Handler przycisku, który przed odpowiedzią robi COKOLWIEK sięgającego poza pamięć** (request do API Discorda: `members.fetch`, `channels.fetch`, `roles.add/remove`, `thread.send`; albo zapis pliku) **MUSI zacząć od `deferReply()`/`deferUpdate()`.** Discord daje na pierwszą odpowiedź 3 s; po przekroczeniu token jest martwy i `reply`/`update` kończy się `DiscordAPIError[10062] Unknown interaction`
- **Dlaczego to groźniejsze niż wygląda:** akcja zdążyła się WYKONAĆ (rola nadana, nagroda doliczona, prośba wysłana do wątku), a użytkownik dostaje „interakcja nie powiodła się" i klika ponownie - przy przełącznikach efekt jest wtedy odwrotny do zamierzonego (rola zdjęta), przy licznikach wartość rośnie dwa razy
- **Wzorzec:** `if (!await this.acknowledgeInteraction(interaction, { update, label })) return;` → praca → `editReply()` (po obu rodzajach deferu) albo `refreshRewardPanel()` dla minusów w panelach ±1
  - **`acknowledgeInteraction(interaction, { update = false, label })`** (`interactionHandlers.js`) - jedno miejsce na potwierdzanie interakcji w całym bocie. `update: true` = `deferUpdate()` (przyciski edytujące istniejącą wiadomość), domyślnie `deferReply({ ephemeral: true })`. Zwraca `false`, gdy token jest martwy → **handler musi wtedy `return` PRZED zmianą danych**
  - Rozróżnia przyczyny w logu: wygasły token (`isGoneError`) → `logger.warn`, zanik sieci (`isNetworkError`) → `logger.error` z kodem, reszta → pełny stack
  - `label` trafia do logu, więc opisuje **skutek przerwania**, np. `'Korekta nagród (nick) - nagroda NIE została zmieniona'`
  - Interakcję już potwierdzoną przepuszcza bez zmian (`deferred || replied` → `true`), więc wywołanie jest idempotentne
- **`respondEphemeral()` sam dobiera sposób odpowiedzi** na podstawie znacznika `ACK_MODE` ustawianego przez `acknowledgeInteraction`: po `deferReply` edytuje pierwotną odpowiedź (`editReply`, inaczej zostałoby wiszące „Bot myśli…"), po `deferUpdate` wysyła `followUp`
- **Potwierdzenie stosują WSZYSTKIE handlery lobby i nagród**, także te odpowiadające z pamięci (`/rewards`, `/stats`, stronicowanie, przyciski wyboru/odrzucenia nagrody). Powód: pod obciążoną siecią token bywa martwy, zanim handler wystartuje, a `acknowledgeInteraction` wyłapie to jako czytelny `warn` zamiast surowego stack trace `DiscordAPIError[10062]`
  - Lista: `createPartyLobby`, `handleAcceptPlayer` + `handleRejectPlayer` (wspólny ack w `handleButtonInteraction`, **przed** debouncem `delay(500)`), `handleRewardPickButton`, `handleRewardConfirmButton`, `handleRewardRejectButton`, `handleRewardNoneButton`, `handleOwnRewardButton`, `handleCorrectionButton`, `handleRewardsCommand`, `handleStatsCommand`, `handleStatsPageButton`, `handleCorrectCommand`, `handleBazarCommand`, `handleBazarOffCommand`, `handleJoinLobbyButton`, `handleToggleNotifications`, `handleEventNotificationsSubscribe`, `handlePartyKickCommand`, `handlePartyCloseCommand`, `handlePartyAddCommand`, `handlePartyAccessCommand` (z `ephemeral: false` - wiadomość jest publiczna), `handleExtendLobbyButton`, `handleCloseLobbyButton`
  - Wyjątek: odmowy sprawdzane w pamięci (zły kanał, brak uprawnień) zostają na zwykłym `reply` - nic nie zmieniają, więc nieudana odpowiedź nic nie psuje
  - **⚠️ NIE potwierdzaj interakcji, po której ma polecieć `showModal()`** - Discord nie przyjmie modala po deferze. Dotyczy `przypominienHandlers.js`
- **Strażnik martwego tokenu** - `acknowledgeInteraction` liczy `interactionAge()` (czas od **utworzenia** interakcji, nie od jej odebrania) i przy wieku > 2750 ms (limit 3000 ms minus 250 ms zapasu na round-trip) **nie wysyła requestu w ogóle**, tylko loguje wiek i ping gatewaya. Przy wieku > 1000 ms potwierdza normalnie, ale zostawia `warn` - to wczesny sygnał zacinającego się połączenia
  - Zapas jest celowo wąski: potwierdzenie idzie przed jakąkolwiek zmianą danych, więc nieudana próba nic nie kosztuje, a szerszy margines odrzucał interakcje mieszczące się jeszcze w limicie
- **Usuwanie starego lobby przy `/party` idzie PO potwierdzeniu** - kasowanie wątku i ogłoszenia to kilka requestów, które same przekraczały limit 3 s, zanim komenda zdążyła odpowiedzieć

**Odpowiedzi ephemeralne - flaga zamiast pola:**
- Używaj `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` - to drugie jest w discord.js v14 przestarzałe (ostrzeżenie przy starcie) i przestanie działać w v15, zamieniając prywatne odpowiedzi `/correct` i `/rewards` w publiczne
- Dotyczy wyłącznie **pierwszej odpowiedzi**: `reply()`, `deferReply()`, `followUp()`. `update()` i `editReply()` flagi nie przyjmują - widoczność jest ustalana w momencie potwierdzenia interakcji i później się jej nie zmienia
- W `acknowledgeInteraction` steruje tym opcja `ephemeral` (domyślnie `true`); przy `false` `deferReply()` dostaje pusty obiekt, a nie `flags: 0`
- `MessageFlags` musi być w imporcie z `discord.js` - obecnie w `index.js`, `handlers/interactionHandlers.js`, `handlers/przypominienHandlers.js`

**Odporność na zanik sieci (KRYTYCZNE):**
- **Objaw:** `getaddrinfo EAI_AGAIN discord.com` w logach - DNS kontenera nie odpowiada, więc request nie wychodzi. **To NIE jest limit zapytań** (ten zwraca `429` z `retry_after`); przyczyna jest infrastrukturalna, po stronie hostingu
- **Zlepki interakcji = zacinający się gateway, NIE limit zapytań.** Gdy w logu kilka zdarzeń ma identyczną sekundę, a wcześniej była cisza, znaczy to, że połączenie WebSocket zamarło i wypuściło zbuforowane zdarzenia naraz - docierają wtedy z tokenem bliskim wygaśnięcia
  - **Kolejkowanie/opóźnianie odpowiedzi pogarsza sprawę** - limit 3 s liczy się od utworzenia interakcji, więc każde sztuczne opóźnienie zabija kolejne tokeny. Przy zlepku jedyną szansą jest odpowiedzieć jak najszybciej
  - Limit zapytań Discorda objawia się kodem `429` z `retry_after`, a discord.js kolejkuje requesty samodzielnie (`BurstHandler`/`SequentialHandler`) - własna kolejka tylko dokłada opóźnienie
- **Klasyfikacja błędów** w `utils/helpers.js`:
  - `isGoneError(error)` - zasób przepadł i nie ma czego ponawiać: `10003` Unknown Channel, `10008` Unknown Message, `10015` Unknown Webhook, `10062` Unknown interaction
  - `isNetworkError(error)` - zanik łączności (`EAI_AGAIN`, `ENOTFOUND`, `ECONNRESET`, `ETIMEDOUT`, …, także w `error.cause.code`)
- **Przywracanie timerów po restarcie (`timerService.restoreLobbyTimer`)** uzbraja je na ZAPISANYCH terminach (`warningTime`/`deleteTime`) zamiast liczyć od nowa z `createdAt + config.lobby.maxDuration`. Skrócony timer pełnego lobby (`createFullLobbyTimer`, także po kliknięciu „Przedłuż o 15 min”) ma własną długość `fullLobbyDuration` i flagę `isFullLobby` — flaga była zapisywana i wczytywana, ale przy przywracaniu ignorowana. Dziś obie stałe to 15 minut, więc wynik wychodził przypadkiem taki sam; zmiana `maxDuration` cicho wydłużyłaby po restarcie każde pełne lobby
- **Sprzątanie stanu lokalnego ZAWSZE w `finally`** - `deleteLobby` (w `interactionHandlers.js` **i** `timerService.js`) wykonuje `removeLobby()` + `removeTimer()` niezależnie od tego, czy kasowanie po stronie Discorda się powiodło. Bez tego przerwane w połowie usuwanie zostawiało lobby w pamięci i **żywy timer**, który kilka minut później strzelał ostrzeżeniem w nieistniejący wątek (`10003 Unknown Channel`)
- **Callbacki timerów pobierają wątek na świeżo** - `sendLobbyWarning(lobbyId, sharedState)` (wspólne dla `/party`, pełnego lobby i timerów przywróconych po restarcie) czyta `threadId` z aktualnego stanu lobby zamiast trzymać obiekt wątku w domknięciu sprzed kilkunastu minut
- **Osierocone lobby domykają się same** - gdy ostrzeżenie trafi na `isGoneError`, callback usuwa lobby i timer zamiast logować błąd w kółko
- Globalny handler w `index.js` nazywa zanik sieci wprost, żeby nie mylił się z limitem zapytań

**Lobby Party:**
- **Logger:** createBotLogger('Wydarzynier')
- **Lobby:** Max 7 osób (1+6), 15min dyskusja
- **Wątki:** Prywatne, auto-usuwanie po zamknięciu
- **Repozytorium:** 5min interval repost

**Persistencja przez `utils/jsonStore` (cache-first):**
- Wszystkie pliki JSON bota — `lobbies.json`, `timers.json`, `nagrody.json`, `przypomnienia.json`, `eventy.json`, `bazar.json`, `message_relay.json` oraz plik ID wiadomości aktywacji Robot3 — idą przez centralny store: odczyt z dysku raz (przy pierwszym sięgnięciu), zapis atomowy (plik tymczasowy + rename) jednocześnie do pliku i pamięci
- **Obsługa `ENOENT` zniknęła z serwisów** — store sam oddaje strukturę domyślną przy braku pliku. `eventMenedzer` i `przypomnieniaMenedzer` podają ją teraz jako `defaultValue` w `getOrLoad`, zamiast budować w `catch`
- **`saveRelay3()` używa `store.mutate()`** — wcześniej robiło `loadRelay3()` (odczyt pliku) przy KAŻDEJ przekazanej wiadomości DM, a potem zapis; teraz odczyt i zapis idą pod jednym zamkiem, więc dwie wiadomości przychodzące równocześnie nie nadpiszą sobie wpisów
- **`tryRegisterClaim()` pozostaje synchroniczne** — to ono chroni przed doliczeniem dwóch nagród z jednego losowania; store obsługuje wyłącznie utrwalanie, nie rezerwację

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
