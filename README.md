# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca osiem specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Rekruter Bot
Automatyzuje proces rekrutacji nowych członków. Sprawdza kwalifikacje graczy poprzez analizę przesłanych zdjęć statystyk i pomaga w procesie dołączania do odpowiedniego klanu. Zawiera szybkie komendy do informacji o klanach oraz **system powiadomień o boostach** - automatyczne wiadomości dziękczynne dla osób boostujących serwer z 10 różnymi sentencjami w stylu Survivor.io.

### 🎓 Szkolenia Bot
Zarządza szkoleniami i wątkami treningowymi. Tworzy strukturę szkoleń z automatycznymi przypomnieniami dla uczestników, aby nikt nie zapomniał o ważnych sesjach treningowych.

### ⚔️ Stalker LME Bot
System karania dla graczy w grach boss fightów. Analizuje zdjęcia wyników walk i automatycznie karze punktami tych, którzy mają 0 damage/score. Zawiera system ostrzeżeń, automatyczne resetowanie punktów oraz **system zarządzania urlopami** z automatycznym monitorowaniem kanału i czasowymi ograniczeniami składania wniosków.

### 🤖 Muteusz Bot
Wielofunkcyjny bot moderacyjny. Automatycznie przepisuje media między kanałami, moderuje treść wiadomości, zarządza rolami użytkowników i przywraca je po powrocie. Obsługuje również system wykroczeń i ostrzeżeń. **Losowe odpowiedzi PepeSoldier** - użytkownicy z medalem Virtutti Papajlari mają szansę 1/250 na otrzymanie losowej odpowiedzi z emoji PepeSoldier.

### 🏆 EndersEcho Bot
Bot rankingowy dla graczy. Analizuje wyniki gier z przesłanych zdjęć, tworzy rankingi najlepszych graczy i automatycznie przyznaje role TOP. Obsługuje różne formaty wyników i jednostki liczbowe. **Ulepszona korekcja OCR** - automatycznie poprawia błędy odczytu (TT→1T, 7→T, 0→Q).

### 🎯 Kontroler Bot
Weryfikuje wyniki dla kanałów Daily i CX. Sprawdza czy przesłane zdjęcia wyników są poprawne, czy nick gracza jest widoczny na screenie i czy wyniki spełniają minimalne wymagania. Blokuje użytkowników z karami.

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
├── processed_ocr/             # 🆕 Wspólny folder przetworzonych obrazów OCR (max 100 plików)
├── utils/                     # Wspólne narzędzia
│   ├── consoleLogger.js       # Centralny system logowania z kolorami
│   ├── discordLogger.js       # System logowania na kanały Discord
│   └── ocrFileUtils.js        # 🆕 Narzędzia do zarządzania plikami OCR
├── 
├── EndersEcho/                # Bot rankingowy z analizą OCR
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   └── interactionHandlers.js
│   ├── services/
│   │   ├── logService.js
│   │   ├── ocrService.js
│   │   ├── rankingService.js
│   │   └── roleService.js
│   ├── utils/
│   │   └── helpers.js
│   ├── data/
│   │   └── ranking.json
│   └── temp/
│
├── Konklawe/                  # Bot gry słownej
│   ├── index.js
│   ├── config/
│   │   └── config.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── commandService.js
│   │   ├── dataService.js
│   │   ├── gameService.js
│   │   ├── rankingService.js
│   │   └── timerService.js
│   ├── utils/
│   │   └── helpers.js
│   └── data/
│       ├── attempts.json
│       ├── hints.json
│       ├── scoreboard.json
│       └── trigger.json
│
├── Kontroler/                 # Bot weryfikacji wyników
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── analysisService.js
│   │   ├── messageService.js
│   │   ├── ocrService.js
│   │   └── roleService.js
│   ├── utils/
│   │   └── helpers.js
│   └── temp/
│
├── Muteusz/                   # Bot zarządzania mediami i rolami
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   ├── memberHandlers.js      # Ekskluzywne grupy ról + automatyczne zarządzanie
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── autoModerationService.js
│   │   ├── logService.js
│   │   ├── mediaService.js
│   │   ├── roleManagementService.js
│   │   ├── specialRolesService.js
│   │   └── warningService.js
│   ├── utils/
│   │   ├── helpers.js
│   │   └── migration.js          # Skrypt migracji ról z ENV do JSON
│   ├── data/
│   │   ├── removed_roles.json    # Zapisane role do przywrócenia
│   │   └── special_roles.json
│   └── temp/
│       └── media_cache/
│
├── Rekruter/                  # Bot rekrutacyjny z OCR
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── nicknameService.js
│   │   ├── ocrService.js
│   │   ├── qualificationService.js
│   │   └── roleService.js
│   ├── utils/
│   │   └── helpers.js
│   └── temp/
│
├── StalkerLME/                # Bot systemu kar + urlopy
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   └── interactionHandlers.js
│   ├── services/
│   │   ├── databaseService.js
│   │   ├── ocrService.js
│   │   ├── punishmentService.js
│   │   ├── reminderService.js
│   │   └── vacationService.js     # System zarządzania urlopami
│   ├── utils/
│   │   └── helpers.js
│   ├── data/
│   │   ├── punishments.json
│   │   └── weekly_removal.json
│   └── temp/
│
├── Szkolenia/                 # Bot szkoleń
│   ├── index.js
│   ├── config/
│   │   └── config.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   └── reactionHandlers.js
│   ├── services/
│   │   └── threadService.js
│   └── utils/
│       └── helpers.js
│
└── Wydarzynier/               # Bot eventów i marketplace
    ├── index.js
    ├── config/
    │   └── config.js
    ├── handlers/
    │   ├── interactionHandlers.js
    │   ├── messageHandlers.js
    │   └── reactionHandlers.js
    ├── services/
    │   ├── bazarService.js         # System marketplace z cyklicznymi resetami
    │   ├── lobbyService.js         # System organizacji party
    │   └── timerService.js         # Zarządzanie timerami i przypomnieniami
    ├── utils/
    │   └── helpers.js
    └── data/
        ├── bazar.json              # Stan marketplace i timerów
        ├── lobbies.json            # Aktywne lobby party
        └── timers.json             # Persystentne timery
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
