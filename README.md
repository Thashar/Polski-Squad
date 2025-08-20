# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca osiem specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Rekruter Bot
Zaawansowany system rekrutacji z weryfikacją kwalifikacji przez OCR. Analizuje statystyki postaci, przypisuje do odpowiednich klanów na podstawie siły ataku (100K-800K+ progów), zarządza pseudonimami oraz śledzi boosty serwera z automatycznymi podziękowaniami w stylu Survivor.io.

### 🎓 Szkolenia Bot
Zarządza wątkami treningowymi z reakcją na emoji N_SSS. Automatyczne archiwizowanie po 24h, usuwanie po 7 dniach, przypomnienia co 24h dla nieaktywnych wątków. Zawiera szczegółowe instrukcje dla: ekwipunku, Tech Partów, collectibles, petów, xeno petów, postaci, trybów gry i sum itemów.

### ⚔️ Stalker LME Bot
System kar za brak uczestnictwa w boss fightach. OCR analizuje zdjęcia wyników i automatycznie karze graczy z 0 damage punktami karnymi (2+ pkt = kara, 3+ pkt = ban loterii). **System urlopów** z interaktywnym przyciskiem, 15-min timeout wniosku, 6h cooldown. Tygodniowe czyszczenie w poniedziałki.

### 🤖 Muteusz Bot
Kompleksowa moderacja z zaawansowaną detekcją spamu i polskich wulgaryzmów. **Cache mediów** do 100MB z 24h retencją, **zarządzanie rolami** z ekskluzyjnymi grupami i przywracaniem. **Auto-moderacja** z eskalacją ostrzeżeń. **Losowe PepeSoldier** (1/250) dla Virtutti Papajlari.

### 🏆 EndersEcho Bot
System rankingowy z OCR analizą wyników boss fightów. Automatyczne przypisywanie ról TOP (1, 2-3, 4-10, 11-30) na podstawie wyników. **Ulepszone logowanie** - wyświetla konkretne wartości po "Best:" i "Total:" zamiast true/false. Paginacja rankingów, korekcja błędów OCR (TT→1T, 7→T, 0→Q).

### 🎯 Kontroler Bot
Weryfikacja wyników dla kanałów Daily (910+ pkt) i CX (2000+ pkt) z różnym przetwarzaniem OCR. **System loterii** z podziałem na klany, cron-owe losowania, wykluczanie ukaranych użytkowników. Zaawansowane dopasowywanie nicków z progami podobieństwa 40%/30%.

### ⛪ Konklawe Bot
Interaktywna gra słowna z hasłem "Konklawe". **System osiągnięć** - 30+ poprawnych odpowiedzi = medal Virtutti Papajlari. **Specjalne komendy VIP**: `/blessing` (12 wariantów) i `/virtue-check` (10 cnót) z cooldownami. **Losowe JP2roll** (1/100). Automatyczne przypomnienia papieżom co 15/30/60 minut.

### 🎉 Wydarzynier Bot
Zarządzanie eventami z **systemem lobby party** (7 graczy max, prywatne wątki, 15-min dyskusja). **Automatyczne zarządzanie członkami** z ochroną przed griefer'ami. **Powiadomienia o eventach** z interaktywnym zapisem na role. Repository system - przesuwa ogłoszenia party na górę co 5 minut.

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
│   └── ocrFileUtils.js        # Narzędzia do zarządzania plikami OCR
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
├── Kontroler/                 # Bot weryfikacji + loteria
│   ├── index.js
│   ├── handlers/
│   │   └── messageHandlers.js
│   ├── services/
│   │   ├── analysisService.js
│   │   ├── messageService.js
│   │   ├── ocrService.js
│   │   └── roleService.js
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

### [2025-08-20] - Kompletna aktualizacja dokumentacji
#### Poprawione 🔧
- **Kompletna analiza wszystkich 8 botów**: Szczegółowe przeanalizowanie funkcjonalności każdego bota
- **Zaktualizowane opisy funkcji**: Precyzyjne opisy wszystkich zaawansowanych funkcji każdego bota
- **Ulepszone logowanie EndersEcho**: Wyświetlanie konkretnych wartości po "Best:" i "Total:" zamiast boolean
- **Udokumentowane systemy OCR**: Szczegółowe informacje o 4 botach z OCR i ich specjalizacjach
- **Zaktualizowane komendy slash**: Kompletna lista wszystkich dostępnych komend dla każdego bota

#### Nowe funkcje udokumentowane:
- **Rekruter**: System 50-sekcyjnej analizy obrazów, progi kwalifikacji klanów, boost tracking
- **StalkerLME**: System urlopów z interaktywnym przyciskiem, punkty karne 2+/3+, tygodniowe czyszczenie
- **Muteusz**: Cache mediów 100MB, ekskluzywne grupy ról, zaawansowana auto-moderacja
- **Kontroler**: Dual-channel OCR (Daily/CX), system loterii wieloklanowej, character normalization
- **Konklawe**: Medale Virtutti Papajlari, specjalne komendy VIP, wielopoziomowe timery
- **Wydarzynier**: 7-osobowe lobby, repository system, automated member control