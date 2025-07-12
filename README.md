# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca siedem specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Rekruter Bot
Bot do zarządzania procesem rekrutacji z weryfikacją kwalifikacji poprzez OCR.

### 🎓 Szkolenia Bot
Bot do zarządzania wątkami szkoleniowymi z automatycznymi przypomnieniami.

### ⚔️ Stalker LME Bot
System kar dla graczy z analizą OCR obrazów do śledzenia pokonanych bossów.

### 🤖 Muteusz Bot
Bot do zarządzania mediami i automatycznego zarządzania rolami z funkcjami przywracania.

### 🏆 EndersEcho Bot
Bot rankingowy z analizą OCR obrazów wyników gier. Automatycznie przyznaje role TOP 1-30 najlepszym graczom.

### 🎯 Kontroler Bot
Bot weryfikacji wyników dla kanałów Daily i CX z zaawansowaną analizą OCR i systemem blokowania użytkowników z rolą karną.

### ⛪ Konklawe Bot
Bot do gry słownej "Konklawe" z systemem haseł, podpowiedzi, timerów przypominających i medali Virtutti Papajlari.

## Architektura Projektu

```
Polski-Squad-Bot-Collection/
├── index.js                    # Główny launcher wszystkich botów
├── package.json               # Zależności i skrypty NPM
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
│   │   ├── memberHandlers.js
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── logService.js
│   │   ├── mediaService.js
│   │   ├── roleManagementService.js
│   │   └── specialRolesService.js
│   ├── utils/
│   │   ├── helpers.js
│   │   └── migration.js
│   ├── data/
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
├── StalkerLME/                # Bot systemu kar
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
│   │   └── reminderService.js
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

```bash
# Wszystkie boty razem
npm start

# Poszczególne boty
npm run rekruter
npm run szkolenia  
npm run stalker
npm run muteusz
npm run endersecho
npm run kontroler
npm run konklawe
```

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
- **Automatyczny restart** botów po błędach
- **Parallel startup** - wydajne uruchamianie wielu botów jednocześnie

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
