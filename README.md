# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca siedem specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Rekruter Bot
Automatyzuje proces rekrutacji nowych członków. Sprawdza kwalifikacje graczy poprzez analizę przesłanych zdjęć statystyk i pomaga w procesie dołączania do odpowiedniego klanu. Zawiera szybkie komendy do informacji o klanach.

### 🎓 Szkolenia Bot
Zarządza szkoleniami i wątkami treningowymi. Tworzy strukturę szkoleń z automatycznymi przypomnieniami dla uczestników, aby nikt nie zapomniał o ważnych sesjach treningowych.

### ⚔️ Stalker LME Bot
System karania dla graczy w grach boss fightów. Analizuje zdjęcia wyników walk i automatycznie karze punktami tych, którzy mają 0 damage/score. Zawiera system ostrzeżeń, automatyczne resetowanie punktów oraz **system zarządzania urlopami** z automatycznym monitorowaniem kanału i czasowymi ograniczeniami składania wniosków.

### 🤖 Muteusz Bot
Wielofunkcyjny bot moderacyjny. Automatycznie przepisuje media między kanałami, moderuje treść wiadomości, zarządza rolami użytkowników i przywraca je po powrocie. Obsługuje również system wykroczeń i ostrzeżeń.

### 🏆 EndersEcho Bot
Bot rankingowy dla graczy. Analizuje wyniki gier z przesłanych zdjęć, tworzy rankingi najlepszych graczy i automatycznie przyznaje role TOP. Obsługuje różne formaty wyników i jednostki liczbowe.

### 🎯 Kontroler Bot
Weryfikuje wyniki dla kanałów Daily i CX. Sprawdza czy przesłane zdjęcia wyników są poprawne, czy nick gracza jest widoczny na screenie i czy wyniki spełniają minimalne wymagania. Blokuje użytkowników z karami.

### ⛪ Konklawe Bot
Obsługuje grę słowną "Konklawe". Gracze próbują odgadnąć hasła, papież dodaje podpowiedzi, bot liczy punkty i przyznaje medale. System automatycznych przypominań zapewnia płynność rozgrywki.

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
├── utils/                     # Wspólne narzędzia
│   ├── consoleLogger.js       # Centralny system logowania z kolorami
│   └── discordLogger.js       # System logowania na kanały Discord
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
└── Szkolenia/                 # Bot szkoleń
    ├── index.js
    ├── config/
    │   └── config.js
    ├── handlers/
    │   ├── interactionHandlers.js
    │   └── reactionHandlers.js
    ├── services/
    │   └── threadService.js
    └── utils/
        └── helpers.js
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
```

### Konfiguracja botów:
Plik `bot-config.json` określa które boty uruchamiać:
```json
{
  "production": ["rekruter", "szkolenia", "stalkerlme", "muteusz", "endersecho", "kontroler", "konklawe"],
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
