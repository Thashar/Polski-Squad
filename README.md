# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca osiem specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Rekruter Bot
Automatyzuje proces rekrutacji nowych członków. Sprawdza kwalifikacje graczy poprzez analizę przesłanych zdjęć statystyk i pomaga w procesie dołączania do odpowiedniego klanu. Zawiera szybkie komendy do informacji o klanach oraz **system powiadomień o boostach** - automatyczne wiadomości dziękczynne dla osób boostujących serwer.

### 🎓 Szkolenia Bot
Zarządza szkoleniami i wątkami treningowymi. Tworzy strukturę szkoleń z automatycznymi przypomnieniami dla uczestników, aby nikt nie zapomniał o ważnych sesjach treningowych.

### ⚔️ Stalker LME Bot
System karania dla graczy w grach boss fightów. Analizuje zdjęcia wyników walk i automatycznie karze punktami tych, którzy mają 0 damage/score. Zawiera system ostrzeżeń, automatyczne resetowanie punktów oraz **system zarządzania urlopami** z automatycznym monitorowaniem kanału i czasowymi ograniczeniami składania wniosków.

### 🤖 Muteusz Bot
Wielofunkcyjny bot moderacyjny. Automatycznie przepisuje media między kanałami, moderuje treść wiadomości, zarządza rolami użytkowników i przywraca je po powrocie. Obsługuje również system wykroczeń i ostrzeżeń. **Losowe odpowiedzi PepeSoldier** - użytkownicy z medalem Virtutti Papajlari mają szansę 1/250 na otrzymanie losowej odpowiedzi z emoji PepeSoldier.

### 🏆 EndersEcho Bot
Bot rankingowy dla graczy. Analizuje wyniki gier z przesłanych zdjęć, tworzy rankingi najlepszych graczy i automatycznie przyznaje role TOP. Obsługuje różne formaty wyników i jednostki liczbowe. **Ulepszona korekcja OCR** - automatycznie poprawia błędy odczytu (TT→1T, 7→T, 0→Q). **Ulepszone logowanie** - wyświetla konkretne wartości znalezione po "Best:" i "Total:" zamiast tylko true/false, zredukowane duplikaty logów dla czystszego outputu.

### 🎯 Kontroler Bot
Weryfikuje wyniki dla kanałów Daily i CX oraz zarządza zaawansowanym systemem loterii. Sprawdza czy przesłane zdjęcia wyników są poprawne, czy nick gracza jest widoczny na screenie i czy wyniki spełniają minimalne wymagania. **Nowy system loterii** z dokładnym planowaniem dat (dd.mm.yyyy), automatyczną obsługą strefy czasowej polskiej z DST, inteligentnym systemem ostrzeżeń i zabezpieczeniami przed limitami JavaScript. Obsługuje loterie jednorazowe i cykliczne (1-365 dni) z automatyczną migracją starych struktur danych.

### ⛪ Konklawe Bot
Obsługuje grę słowną "Konklawe". Gracze próbują odgadnąć hasła, papież dodaje podpowiedzi, bot liczy punkty i przyznaje medale. System automatycznych przypominań zapewnia płynność rozgrywki. **Losowe odpowiedzi JP2** - użytkownicy z medalem Virtutti Papajlari mają szansę 1/100 na otrzymanie losowej odpowiedzi z emoji JP2roll. **Specjalne komendy VIP**: `/blessing` (błogosławieństwa) i `/virtue-check` (sprawdzanie cnót) z cooldownami i limitami dziennymi - dostępne globalnie tylko dla posiadaczy medalu.

### 🎉 Wydarzynier Bot
System zarządzania eventami i organizacji społeczności. **System lobby party** - tworzy prywatne wątki dla organizacji gier z systemem zaproszeń i automatycznym czyszczeniem. **Marketplace (Bazar)** - automatyczny system handlowy z cyklicznymi resetami co 2 godziny, ostrzeżeniami i systemem przypinania wiadomości. **Zarządzanie powiadomieniami** - interaktywny system zapisów na powiadomienia o eventach.

## System Logowania

**WAŻNE: Wszystkie boty używają scentralizowanego systemu logowania.**

### Zasady implementacji logów:

```javascript
// ✅ POPRAWNIE - zawsze używaj createBotLogger
const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('BotName');

logger.info('Wiadomość informacyjna');
logger.error('Błąd');
logger.warn('Ostrzeżenie');

// ❌ BŁĘDNIE - nigdy nie używaj
console.log('wiadomość');
console.error('błąd');
logWithTimestamp('wiadomość', 'info');
```

**Wszystkie logi muszą być prefixowane nazwą bota dla poprawnej identyfikacji w środowisku multi-bot.**

## Architektura Projektu

```
Polski-Squad-Bot-Collection/
├── index.js                    # Główny launcher wszystkich botów
├── package.json               # Zależności i skrypty NPM
├── bot-config.json            # Konfiguracja które boty uruchamiać
├── CLAUDE.md                  # Instrukcje dla Claude Code
├── processed_ocr/             # Wspólny folder przetworzonych obrazów OCR (max 100 plików)
├── utils/                     # Wspólne narzędzia
│   ├── consoleLogger.js       # Centralny system logowania z kolorami
│   ├── discordLogger.js       # System logowania na kanały Discord
│   ├── nicknameManagerService.js # Centralny system zarządzania nickami
│   └── ocrFileUtils.js        # Narzędzia do zarządzania plikami OCR
├── shared_data/               # Wspólne dane między botami
│   ├── nickname_manager_config.json    # Konfiguracja systemu nicków
│   └── active_nickname_effects.json    # Aktywne efekty nicków
├── 
├── Rekruter/                  # Bot rekrutacyjny z OCR i boost tracking
│   ├── index.js
│   ├── config/
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── nicknameService.js
│   │   ├── ocrService.js
│   │   ├── qualificationService.js
│   │   └── roleService.js
│   └── temp/
│
├── Szkolenia/                 # Bot szkoleń z wątkami
│   ├── index.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── reactionHandlers.js
│   ├── services/
│   │   ├── reminderStorageService.js
│   │   └── threadService.js
│   └── data/
│       └── reminders.json
│
├── StalkerLME/                # Bot kar z systemem urlopów
│   ├── index.js
│   ├── handlers/
│   │   └── interactionHandlers.js
│   ├── services/
│   │   ├── databaseService.js
│   │   ├── ocrService.js
│   │   ├── punishmentService.js
│   │   ├── reminderService.js
│   │   └── vacationService.js
│   ├── data/
│   │   ├── punishments.json
│   │   └── weekly_removal.json
│   └── temp/
│
├── Muteusz/                   # Bot moderacji z cache mediów
│   ├── index.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   ├── memberHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── autoModerationService.js
│   │   ├── logService.js
│   │   ├── mediaService.js
│   │   ├── roleManagementService.js
│   │   ├── specialRolesService.js
│   │   └── warningService.js
│   ├── data/
│   │   ├── removed_roles.json
│   │   └── special_roles.json
│   └── temp/media_cache/
│
├── EndersEcho/                # Bot rankingowy z OCR
│   ├── index.js
│   ├── handlers/
│   │   └── interactionHandlers.js
│   ├── services/
│   │   ├── logService.js
│   │   ├── ocrService.js
│   │   ├── rankingService.js
│   │   └── roleService.js
│   ├── data/
│   │   └── ranking.json
│   └── temp/
│
├── Kontroler/                 # Bot weryfikacji + zaawansowana loteria
│   ├── index.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── analysisService.js
│   │   ├── lotteryService.js
│   │   ├── messageService.js
│   │   ├── ocrService.js
│   │   └── roleService.js
│   ├── data/
│   │   └── lottery_history.json
│   └── temp/
│
├── Konklawe/                  # Bot gry słownej z medalami
│   ├── index.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── commandService.js
│   │   ├── dataService.js
│   │   ├── gameService.js
│   │   ├── rankingService.js
│   │   └── timerService.js
│   └── data/
│       ├── attempts.json
│       ├── hints.json
│       ├── scoreboard.json
│       └── trigger.json
│
└── Wydarzynier/               # Bot eventów z lobby system
    ├── index.js
    ├── handlers/
    │   ├── interactionHandlers.js
    │   ├── messageHandlers.js
    │   └── reactionHandlers.js
    ├── services/
    │   ├── bazarService.js
    │   ├── lobbyService.js
    │   └── timerService.js
    └── data/
        ├── bazar.json
        ├── lobbies.json
        └── timers.json
```

## Uruchamianie

### Główne komendy:
```bash
# Wszystkie boty produkcyjne (na serwerze)
npm start

# Boty rozwojowe (lokalnie)
npm run local
```

### Poszczególne boty (legacy):
```bash
npm run rekruter
npm run szkolenia  
npm run stalker
npm run muteusz
npm run endersecho
npm run kontroler
npm run konklawe
npm run wydarzynier
```

### Konfiguracja botów:
Plik `bot-config.json` określa które boty uruchamiać:
```json
{
  "production": ["rekruter", "szkolenia", "stalkerlme", "muteusz", "endersecho", "kontroler", "konklawe", "wydarzynier"],
  "development": ["stalkerlme"]
}
```

- **production** - boty uruchamiane przez `npm start`
- **development** - boty uruchamiane przez `npm run local`

## Funkcje Systemowe

### 🎨 Centralny System Logowania
- **Kolorowe grupowanie komunikatów** według botów
- **Inteligentne separatory** - pojawiają się tylko przy przejściu między różnymi botami
- **Różne poziomy logowania**: informacje (•), sukces (✅), ostrzeżenia (⚠️), błędy (❌)
- **Jednolite formatowanie** z timestampami i emoji identyfikatorami

### 📡 Discord Logging
- Opcjonalne logowanie komunikatów na kanały Discord (ID: 1393028610910326844)
- Kolejkowanie wiadomości z obsługą rate limitów
- Fallback na konsolę w przypadku problemów z Discord API

### 🔧 Zarządzanie Procesami
- **Graceful shutdown** - obsługa sygnałów SIGINT/SIGTERM
- **Selektywne uruchamianie** - różne zestawy botów dla production/development
- **Lazy loading** - boty ładowane dynamicznie tylko gdy potrzebne
- **Timeout handling** - odporna obsługa Discord API timeouts
- **Error recovery** - graceful error handling dla wszystkich interakcji

### 🏷️ Centralny System Zarządzania Nickami

**Problem**: Boty Konklawe (klątwy) i Muteusz (flagi) zmieniały nicki użytkowników, ale przywracały do głównego nicku zamiast oryginalnego serwerowego nicku, i mogły się konfliktować między sobą.

**Rozwiązanie**: Scentralizowany system zarządzania nickami w `utils/nicknameManagerService.js`

#### Kluczowe funkcjonalności:
- **🚫 Zapobieganie konfliktom**: Koordynacja między botami - blokuje nakładanie tego samego typu efektu
- **🔄 Nakładanie efektów**: Pozwala na nakładanie różnych typów (klątwa + flaga) z zachowaniem oryginalnego nicku
- **💾 Zachowanie oryginalnych nicków**: Przywraca dokładnie to co użytkownik miał (nick serwerowy vs nick główny)
- **⏰ Automatyczne czyszczenie**: Usuwa wygasłe efekty i utrzymuje spójność danych
- **📊 Monitorowanie**: Śledzenie aktywnych efektów i statystyki systemu

#### Typy efektów:
- **CURSE** (Konklawe): Dodaje prefiks "Przeklęty " do nicków z konfigurowalnymi czasami
- **FLAG** (Muteusz): Zmienia nick na flagi krajów (🇺🇦, 🇵🇱, 🇮🇱, 🇺🇸, 🇩🇪, 🇷🇺) na 5 minut

#### Przykład działania:
```
1. Użytkownik "Janusz" (nick serwerowy) dostaje klątwę
   → Nick: "Przeklęty Janusz" (zapisany oryginalny: "Janusz")

2. Janusz dostaje flagę ukraińską  
   → Nick: "Slava Ukrainu!" (oryginalny nadal: "Janusz")

3. Efekt zostaje usunięty
   → Nick: "Janusz" (przywrócony oryginalny, nie "Przeklęty Janusz")
```

#### Pliki konfiguracyjne:
- **Konfiguracja**: `shared_data/nickname_manager_config.json`  
- **Aktywne efekty**: `shared_data/active_nickname_effects.json`
- **Automatyczna inicjalizacja**: Zintegrowane z sekwencjami startowymi botów
- **Logowanie debug**: Szczegółowe logi aplikacji i przywracania efektów

## System OCR i Debugowanie

### 🔍 Zaawansowane funkcje OCR
- **Cztery boty z OCR**: Rekruter, StalkerLME, EndersEcho, Kontroler
- **Wspólny folder przetworzonych obrazów**: `processed_ocr/` w katalogu głównym  
- **Format nazw plików**: `[BOTNAME][ hh:mm:ss rrrr-mm-dd ][]` lub `[KONTROLER][ hh:mm:ss rrrr-mm-dd ][daily/cx]`
- **Automatyczna rotacja**: maksymalnie 100 plików dla wszystkich botów razem
- **Szczegółowe logowanie**: przełączalne tryb debug za pomocą `/ocr-debug`

### 🛠️ Komendy debugowania OCR
**Dostępne tylko dla administratorów:**
```
/ocr-debug true          # Włącz szczegółowe logowanie OCR
/ocr-debug false         # Wyłącz szczegółowe logowanie OCR
/ocr-debug               # Sprawdź aktualny stan logowania
```

### 📁 Przykłady nazw przetworzonych plików
```
[KONTROLER][ 14:23:45 2025-08-02 ][daily].png  # Analiza kanału Daily
[KONTROLER][ 14:23:47 2025-08-02 ][cx].png     # Analiza kanału CX
[STALKER][ 14:24:12 2025-08-02 ][].png         # System kar Stalker
[ENDERSECHO][ 14:25:30 2025-08-02 ][].png      # Analiza wyników rankingu
[REKRUTER][ 14:26:15 2025-08-02 ][].png        # Weryfikacja kwalifikacji
```

### 🔧 Konfiguracja OCR (jednolita dla wszystkich botów)
```javascript
ocr: {
    saveProcessedImages: true,
    processedDir: path.join(__dirname, '../../processed_ocr'),
    maxProcessedFiles: 100,
    detailedLogging: {
        enabled: false,  // Przełączane przez /ocr-debug
        logImageProcessing: true,
        logTextExtraction: true,
        logScoreAnalysis: true,
        // Specyficzne opcje dla każdego bota...
    }
}
```

## Technologie

- **Node.js** + **Discord.js v14**
- **Tesseract.js** - OCR do analizy obrazów
- **Sharp** - przetwarzanie obrazów
- **node-cron** - zadania zaplanowane
- **Canvas** - manipulacja obrazami

## Konfiguracja

Każdy bot wymaga własnego pliku `.env` z konfiguracją:

```bash
# Przykład - Rekruter/.env
REKRUTER_TOKEN=your_discord_bot_token
REKRUTER_CHANNEL_ID=channel_id
REKRUTER_ROLE_ID=role_id
```

### Wymagane zmienne środowiskowe:
- `REKRUTER_TOKEN` - Token Discord dla bota Rekruter
- `SZKOLENIA_TOKEN` - Token Discord dla bota Szkolenia  
- `STALKER_LME_TOKEN` - Token Discord dla bota Stalker LME
- `MUTEUSZ_TOKEN` - Token Discord dla bota Muteusz
- `ENDERSECHO_TOKEN` - Token Discord dla bota EndersEcho
- `KONTROLER_TOKEN` - Token Discord dla bota Kontroler
- `KONKLAWE_TOKEN` - Token Discord dla bota Konklawe
- `WYDARZYNIER_TOKEN` - Token Discord dla bota Wydarzynier

## Development

### Dla Claude Code:
Projekt zawiera plik `CLAUDE.md` z szczegółowymi instrukcjami dla Claude Code, w tym:
- Reguły implementacji logowania
- Wzorce architektoniczne
- Przykłady kodu
- Zasady bezpieczeństwa

### Debugowanie:
- Wszystkie logi są prefixowane nazwą bota
- Używaj `npm run local` do testowania pojedynczych botów
- Edytuj `bot-config.json` aby zmienić które boty uruchamiać

### Debugowanie OCR:
- Użyj `/ocr-debug true` aby włączyć szczegółowe logowanie OCR (tylko administratorzy)
- Przetworzone obrazy są automatycznie zapisywane w `processed_ocr/` z timestampami
- Format nazw: `[BOTNAME][ hh:mm:ss rrrr-mm-dd ][]` lub `[KONTROLER][ hh:mm:ss rrrr-mm-dd ][daily/cx]` ułatwia identyfikację problemów
- Maksymalnie 100 plików - najstarsze automatycznie usuwane

## Historia Zmian

### [2025-09-03] - Kontroler Bot: Rewolucja Systemu Loterii 🎰
#### Nowe funkcje ✨
- **System planowania oparty na datach**: Kompletna przepisanie z dni tygodnia na dokładne daty (dd.mm.yyyy)
- **Polska strefa czasowa z DST**: Automatyczna detekcja czasu letniego/zimowego i konwersja UTC ↔ Polski czas
- **Zabezpieczenie setTimeout**: Ochrona przed limitami JavaScript (max 24 dni) z walidacją i error handling
- **Elastyczna częstotliwość**: Rozszerzenie z 30 do 365 dni dla loterii cyklicznych
- **Inteligentny system ostrzeżeń**: Ostrzeżenia tylko dla Daily/CX, brak spamu dla innych loterii
- **Migracja legacy**: Automatyczne czyszczenie starych struktur danych przy starcie bota

#### Poprawione 🔧  
- **Problem czasów**: Naprawiono błędną konwersję stref czasowych (loterie wykonywały się w złych godzinach)
- **Podwójne pingi**: Rozwiązano problem dublowania pingów z różnych loterii tego samego typu
- **Ostrzeżenia dla testów**: Loterie testowe (inne role) nie wysyłają już niepotrzebnych ostrzeżeń
- **Wyświetlanie dat**: Wszystkie daty w UI pokazują prawidłowy polski czas lokalny

#### Techniczne szczegóły 🛠️
- **Nowe parametry komendy `/lottery`**: Data zamiast dzień, walidacja formatu dd.mm.yyyy
- **Funkcje pomocnicze**: `isWinterTime()`, `convertUTCToPolishTime()` dla obsługi stref czasowych  
- **Timeout management**: Bezpieczne planowanie z limitami i error recovery
- **Legacy cleanup**: Automatyczne usuwanie niekompatybilnych starych loterii

### [2025-08-31] - Centralny System Zarządzania Nickami  
#### Nowe funkcje ✨
- **Scentralizowany system nicków**: Nowy `NicknameManagerService` zapobiega konfliktom między botami Konklawe i Muteusz
- **Inteligentne nakładanie efektów**: Pozwala na kombinacje klątwa+flaga z zachowaniem oryginalnego nicku
- **Prawidłowe przywracanie nicków**: System rozróżnia nicki serwerowe vs główne i przywraca właściwe
- **Automatyczne czyszczenie**: Wygasłe efekty są automatycznie usuwane z systemu
- **Kompleksowa walidacja**: Zapobiega duplikacji tego samego typu efektu, pozwala na różne typy

#### Poprawione 🔧
- **Problem konfliktów nicków**: Rozwiązano sytuacje gdzie boty przywracały nick główny zamiast serwerowego
- **Nakładające się efekty**: Efekty różnych typów mogą się teraz nakładać bez utraty oryginalnego nicku
- **Czyszczenie starych funkcji**: Usunięto zduplikowane systemy zarządzania nickami z poszczególnych botów
- **Centralizacja logiki**: Wszystkie operacje na nickach przeszły przez jeden wspólny system

### [2025-08-20] - Kompletna aktualizacja dokumentacji
#### Poprawione 🔧
- **Kompletna analiza wszystkich 8 botów**: Szczegółowe przeanalizowanie funkcjonalności każdego bota
- **Zaktualizowane opisy funkcji**: Precyzyjne opisy wszystkich zaawansowanych funkcji każdego bota
- **Ulepszone logowanie EndersEcho**: Wyświetlanie konkretnych wartości po "Best:" i "Total:" zamiast boolean
- **Udokumentowane systemy OCR**: Szczegółowe informacje o 4 botach z OCR i ich specjalizacjach
- **Zaktualizowane komendy slash**: Kompletna lista wszystkich dostępnych komend dla każdego bota

#### Nowe funkcje udokumentowane:
- **Rekruter**: System 50-sekcyjnej analizy obrazów, progi kwalifikacji klanów (1000K+ główny, 800K+ klan2, 600K+ klan1), boost tracking
- **StalkerLME**: System urlopów z interaktywnym przyciskiem, punkty karne 2+/3+, tygodniowe czyszczenie
- **Muteusz**: Cache mediów 100MB, ekskluzywne grupy ról, zaawansowana auto-moderacja
- **Kontroler**: Dual-channel OCR (Daily/CX), system loterii wieloklanowej, character normalization
- **Konklawe**: Medale Virtutti Papajlari, specjalne komendy VIP, wielopoziomowe timery
- **Wydarzynier**: 7-osobowe lobby, repository system, automated member control