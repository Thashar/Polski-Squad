### 🎉 Wydarzynier Bot

**7 Systemów:**

**Lobby Party (oryginalne):**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback

**System Przypomnień i Eventów (skopiowane z STAR bota):**
5. **Przypomnienia** - `przypomnieniaMenedzer.js`: Szablony (text/embed) + Zaplanowane przypomnienia z interwałami (1s-28d lub "ee")
6. **Eventy** - `eventMenedzer.js`: Dodawanie eventów z nazwą, czasem rozpoczęcia i interwałem powtarzania
7. **Panel Kontrolny** - `tablicaMenedzer.js`: Interaktywna tablica z embeddami przypomnień, auto-update co 1min, przyciski zarządzania

**Funkcjonalność Przypomnień:**
- **Szablony:** Tworzenie szablonów wiadomości (tekst lub embed) z nazwą, treścią, kolorem
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

**Komendy:** `/party`, `/party-add`, `/party-kick`, `/party-close`
**Env:** TOKEN, NOTIFICATIONS_BOARD_CHANNEL

---

## Zmienne Środowiskowe

```env
WYDARZYNIER_TOKEN=bot_token_here
WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL=channel_id  # Kanał z panelem kontrolnym przypomnień
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
│   ├── timerService.js                # Timery lobby (oryginalne)
│   ├── bazarService.js                # Bazar (oryginalne)
│   ├── przypomnieniaMenedzer.js       # CRUD szablonów i przypomnień (z STAR)
│   ├── harmonogram.js                 # Scheduler 30s (z STAR)
│   ├── tablicaMenedzer.js             # Tablica z embeddami (z STAR)
│   ├── eventMenedzer.js               # CRUD eventów (z STAR)
│   ├── listaEventowMenedzer.js        # Lista eventów na kanale (z STAR)
│   └── strefaCzasowaManager.js        # Zarządzanie strefą czasową (z STAR)
└── data/
    ├── lobbies.json                   # Aktywne lobby (oryginalne)
    ├── timers.json                    # Timery lobby (oryginalne)
    ├── przypomnienia.json             # Szablony i zaplanowane (z STAR)
    ├── eventy.json                    # Eventy i kanał listy (z STAR)
    └── strefy_czasowe.json            # Strefa czasowa bota (z STAR)
```
