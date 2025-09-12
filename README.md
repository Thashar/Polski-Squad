# 🏰 Kolekcja Botów Discord Polski Squad

> **Kompleksowy pakiet automatyzacji serwera Discord z 9 wyspecjalizowanymi botami i scentralizowanym zarządzaniem**

[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 🚀 Przegląd

Kolekcja Botów Polski Squad to modularny system zarządzania serwerem Discord zawierający **9 wyspecjalizowanych botów** z **scentralizowanym logowaniem**, **wspólnymi narzędziami** i **zaawansowanymi możliwościami OCR**. Każdy bot obsługuje określone funkcje serwera, zachowując płynną integrację i koordynację między botami.

### ✨ Kluczowe Funkcje

- 🎯 **Architektura Modularna** - 9 wyspecjalizowanych botów do określonych funkcji serwera
- 🔧 **Scentralizowane Zarządzanie** - Zunifikowane logowanie, przetwarzanie OCR i zarządzanie nickami
- 🤖 **Zaawansowane OCR** - Wielojęzyczne rozpoznawanie tekstu z przechowywaniem przetworzonych obrazów
- 🌐 **Wsparcie Wielu Serwerów** - Elastyczne wdrażanie na różnych serwerach Discord
- ⚡ **Gotowe do Produkcji** - Kompleksowa obsługa błędów i bezpieczne wyłączanie
- 📊 **Monitorowanie w Czasie Rzeczywistym** - Logowanie webhook Discord z ograniczeniem częstotliwości

---

## 🤖 Kolekcja Botów

### 🎯 **Gary Bot** - *Analiza Survivor.io*
> **NOWOŚĆ!** Zaawansowana analiza Lunar Mine Expedition z integracją API

**Funkcje:**
- 🌙 **Analiza Lunar Expedition** - Kompleksowa analiza 4 gildii
- 🔍 **Rozpoznawanie Gildii OCR** - Wielojęzyczne wykrywanie nazw gildii (EN/JP/KR)
- 🌐 **Integracja API** - Dane w czasie rzeczywistym z garrytools.com
- 🔄 **Cache'owane Rankingi** - Top 500 gildii z 6-godzinnymi cyklami odświeżania
- 🛡️ **Wsparcie Proxy** - Różnorodność sieci z monitorowaniem zdrowia

**Komendy:**
- `/lunarmine` - Analizuj 4 gildie podczas ekspedycji (Admin)
- `/search` - Szukaj gildii (tryby TOP500/GLOBAL)
- `/analyse` - Analiza pojedynczej gildii (Admin)
- `/player` & `/ee` - Funkcja wyszukiwania graczy

---

### 🎯 **Rekruter Bot** - *Zaawansowany System Rekrutacji*
> Wieloetapowa weryfikacja z kontrolą kwalifikacji OCR

**Funkcje:**
- 📝 **Proces Wieloetapowy** - Narodowość → Cel → Weryfikacja statystyk
- 🔍 **Analiza Statystyk OCR** - Analiza mocy postaci z rekomendacjami klanów
- 🎉 **Śledzenie Boostów** - 10 unikalnych wiadomości gratulacyjnych + powiadomienia bonusowe
- ⏰ **Monitorowanie Ról** - 24-godzinne śledzenie niekompletnych profili
- 🎮 **Szybkie Komendy** - `!clan`, `!clan0`, `!clan1`, `!clan2`

**System Klanowy:**
- Poniżej 100K ataku: Brak kwalifikacji
- 100K-599K: Rekomendacja Clan0  
- 600K-799K: Rekomendacja Clan1
- 800K-999K: Rekomendacja Clan2
- 1000K+: Rekomendacja głównego klanu

---

### 🎓 **Szkolenia Bot** - *Zarządzanie Szkoleniami*
> System szkoleń oparty na wątkach z automatycznym cyklem życia

**Funkcje:**
- 🧵 **Tworzenie Wątków** - Wyzwalanie reakcji emoji N_SSS
- ⏰ **Auto-cykl życia** - Archiwizacja po 24h nieaktywności, usunięcie po 7 dniach
- 🔔 **System Przypomnień** - 24-godzinne powiadomienia o nieaktywności
- 📖 **Kompleksowe Wytyczne** - Sprzęt, części tech, zwierzaki, postacie

---

### ⚔️ **StalkerLME Bot** - *Egzekwowanie Udziału w Bossach*
> System kar napędzany OCR z zarządzaniem wakacjami

**Funkcje:**
- 🔍 **Wykrywanie OCR** - Automatycznie identyfikuje graczy z 0 obrażeń/punktów
- ⚖️ **Inteligentne Kary** - Stopniowany system kar (2+ punkty = rola, 3+ = ban loterii)
- 🏖️ **System Wakacji** - Interaktywne wnioski z cooldownami i automatycznym czyszczeniem
- 📅 **Cotygodniowe Czyszczenie** - Redukcja punktów w poniedziałek o północy
- 🎯 **Ostrzeżenia Specyficzne dla Klanu** - Ukierunkowane powiadomienia

---

### 🤖 **Muteusz Bot** - *Zaawansowana Moderacja*
> Kompleksowa auto-moderacja z cache'owaniem mediów

**Funkcje:**
- 🛡️ **Auto-moderacja** - Wykrywanie spamu, filtrowanie wulgaryzmów, blokowanie zaproszeń
- 💾 **Cache'owanie Mediów** - Wsparcie plików 100MB z inteligentnym cache 2GB
- 🎭 **Zarządzanie Rolami** - Grupy ekskluzywne z automatycznym rozwiązywaniem konfliktów
- 🎲 **Funkcje Specjalne** - Losowe odpowiedzi PepeSoldier (szansa 1/250)
- ⚠️ **Śledzenie Naruszeń** - System ostrzeżeń dla całego serwera

---

### 🏆 **EndersEcho Bot** - *System Rankingów Bossów*
> Śledzenie wyników napędzane OCR z automatycznym zarządzaniem rolami

**Funkcje:**
- 🔍 **Analiza Wyników OCR** - Rozpoznawanie polsko/angielskie z korekcją błędów
- 📊 **Trwałe Rankingi** - Interaktywne tabele wyników z paginacją
- 👑 **System Ról TOP** - 4-poziomowe automatyczne zarządzanie (TOP 1, 2-3, 4-10, 11-30)
- 🔧 **Wsparcie Jednostek** - Konwersje numeryczne K, M, B, T, Q
- 📈 **Śledzenie Historyczne** - Kompletna historia wyników z znacznikami czasu

---

### 🎯 **Kontroler Bot** - *Weryfikacja Dwukanałowa + Zaawansowana Loteria*
> Weryfikacja OCR z wyrafinowanym systemem loterii

**Funkcje:**
- 👀 **Podwójne Monitorowanie** - Kanał CX (2000+ punktów) i Kanał Daily (910+ punktów)
- 🎰 **Zaawansowana Loteria** - Planowanie oparte na datach z polską strefą czasową DST
- 🏰 **Wsparcie Wielu Klanów** - Kategorie: cały serwer, Main Squad, Squad 0/1/2
- ⚠️ **Inteligentne Ostrzeżenia** - Automatyczne alerty 90-minutowe i 30-minutowe
- 📅 **Elastyczne Planowanie** - Cykle loterii od jednorazowych do rocznych

---

### ⛪ **Konklawe Bot** - *Interaktywna Gra Słowna*
> Gra hasłowa o tematyce papieskiej z systemem osiągnięć

**Funkcje:**
- 🎮 **Gra Hasłowa** - Domyślne "Konklawe" z opcjami niestandardowymi
- 🏅 **System Osiągnięć** - Medale Virtutti Papajlari za 30+ poprawnych odpowiedzi
- ⏰ **Inteligentne Timery** - Wielopoziomowe przypomnienia (15min, 30min, 1godz)
- 🙏 **Specjalne Komendy** - `/blessing` i `/virtue-check` dla posiadaczy medali
- 💫 **Losowe Odpowiedzi** - Szansa 1/100 na odpowiedzi JP2 dla użytkowników papieskich

---

### 🎉 **Wydarzynier Bot** - *Zarządzanie Wydarzeniami i Imprezami*
> System lobby imprez z organizacją opartą na wątkach

**Funkcje:**
- 🏟️ **Lobby Imprez** - Pojemność 7 graczy (1 właściciel + 6 członków)
- 🧵 **Organizacja Wątków** - Prywatne wątki z automatyczną kontrolą członków
- 🛡️ **Ochrona Przed Griefingiem** - Tylko zaakceptowani gracze mogą uczestniczyć
- 📢 **Subskrypcje Ról** - Powiadomienia o ogłoszeniach imprez
- 📌 **Usługi Bazaru** - Przypinanie wiadomości i zarządzanie marketplace

---

## 🏗️ Architektura

### Systemy Scentralizowane

#### 🔧 **Zunifikowany System Logowania**
```javascript
const { createBotLogger } = require('./utils/consoleLogger');
const logger = createBotLogger('BotName');

logger.info('Wiadomość informacyjna');
logger.error('Wiadomość błędu');
logger.warn('Ostrzeżenie');
```

**Funkcje:**
- 🎨 **Kolorowe wyjście** według botów z inteligentnymi separatorami
- 📝 **Wiele miejsc docelowych** - Konsola, plik (`logs/bots.log`), webhook Discord
- ⚡ **Ograniczone częstotliwością** logowanie Discord z zarządzaniem kolejką
- 🚀 **Zoptymalizowany start** - Jednoliniowe komunikaty statusu botów

#### 🏷️ **Centralized Nickname Manager**
```javascript
const nicknameManager = require('./utils/nicknameManagerService');

await nicknameManager.applyEffect(userId, 'CURSE', duration, metadata);
await nicknameManager.removeEffect(userId, effectId);
```

**Features:**
- 🔄 **Cross-bot coordination** - Prevents conflicts between Konklawe and Muteusz
- 💾 **Original preservation** - Always restores true server nicknames
- 📚 **Effect layering** - Supports overlapping effects
- 🧹 **Automatic cleanup** - Removes expired effects

#### 👁️ **OCR Processing System**
```javascript
const { saveProcessedImage, enhanceImage } = require('./utils/ocrFileUtils');

const processedImage = await enhanceImage(imageBuffer);
await saveProcessedImage(processedImage, 'BOTNAME', metadata);
```

**Features:**
- 📁 **Shared storage** - `processed_ocr/` directory for all bots
- 🏷️ **Standardized naming** - `[BOTNAME][ hh:mm:ss rrrr-mm-dd ][]`
- 🔄 **Automatic rotation** - Max 400 files with cleanup
- 🐛 **Admin debug mode** - Toggle via `/ocr-debug` command

### Bot Architecture Pattern
```
BotName/
├── index.js           # Main bot with Discord client setup
├── config/
│   ├── config.js      # Bot configuration and constants
│   └── messages.js    # Message templates (some bots)
├── handlers/
│   ├── interactionHandlers.js  # Button/interaction events
│   ├── messageHandlers.js      # Message events
│   └── reactionHandlers.js     # Reaction events
├── services/
│   └── [various].js   # Business logic services
├── utils/
│   └── helpers.js     # Utility functions
└── data/              # Persistent JSON storage
```

---

## 🚀 Szybki Start

### Wymagania Wstępne
- **Node.js** 16.0.0 lub wyższy
- Menedżer pakietów **npm** lub **yarn**
- **Tokeny Botów Discord** dla każdego bota, który chcesz uruchomić

### Instalacja

```bash
# Klonuj repozytorium
git clone <repository-url>
cd "Polski Squad"

# Zainstaluj zależności
npm install

# Skopiuj konfigurację środowiska
cp .env.example .env

# Skonfiguruj tokeny botów i ID kanałów w .env
```

### Konfiguracja Środowiska

Stwórz plik `.env` z następującymi tokenami:
```env
# Bot Tokens
REKRUTER_TOKEN=your_bot_token_here
SZKOLENIA_TOKEN=your_bot_token_here
STALKER_LME_TOKEN=your_bot_token_here
MUTEUSZ_TOKEN=your_bot_token_here
ENDERSECHO_TOKEN=your_bot_token_here
KONTROLER_TOKEN=your_bot_token_here
KONKLAWE_TOKEN=your_bot_token_here
WYDARZYNIER_TOKEN=your_bot_token_here

# Gary Bot Configuration
GARY_TOKEN=your_bot_token_here
GARY_CLIENT_ID=your_client_id_here
GARY_ALLOWED_CHANNEL_ID=1234567890123456789
GARY_ADMIN_ROLES=1234567890123456789

# Optional: Proxy Configuration (Gary Bot)
GARY_PROXY_ENABLED=true
GARY_PROXY_STRATEGY=round-robin
GARY_PROXY_LIST=http://proxy1:port,http://proxy2:port
```

### Uruchamianie Botów

```bash
# Uruchom wszystkie boty razem
npm start
# lub
npm run dev

# Uruchom pojedyncze boty
npm run rekruter     # Tylko Rekruter bot
npm run szkolenia    # Tylko Szkolenia bot
npm run stalker      # Tylko Stalker LME bot
npm run muteusz      # Tylko Muteusz bot
npm run endersecho   # Tylko EndersEcho bot
npm run kontroler    # Tylko Kontroler bot
npm run konklawe     # Tylko Konklawe bot
npm run wydarzynier  # Tylko Wydarzynier bot
npm run gary         # Tylko Gary bot
```

---

## 📊 Technology Stack

### Core Technologies
- **[Discord.js v14](https://discord.js.org/)** - Primary Discord API library
- **[Tesseract.js](https://tesseract.projectnaptha.com/)** - OCR text recognition (5 bots)
- **[Sharp](https://sharp.pixelplumbing.com/)** - High-performance image processing
- **[node-cron](https://www.npmjs.com/package/node-cron)** - Task scheduling
- **[Canvas](https://www.npmjs.com/package/canvas)** - Image manipulation for OCR

### Additional Dependencies
- **[axios](https://axios-http.com/)** - HTTP client (Gary bot API integration)
- **[cheerio](https://cheerio.js.org/)** - Server-side HTML parsing
- **[https-proxy-agent](https://www.npmjs.com/package/https-proxy-agent)** - Proxy support
- **[dotenv](https://www.npmjs.com/package/dotenv)** - Environment configuration

---

## 🔧 Development

### Production Configuration
The `bot-config.json` file controls which bots run in different environments:

```json
{
  "production": [
    "rekruter", "endersecho", "szkolenia", "stalkerlme", 
    "kontroler", "konklawe", "muteusz", "wydarzynier", "gary"
  ],
  "development": ["gary"]
}
```

### Debug Features

#### OCR Debug Mode
All OCR bots support detailed logging via admin commands:
```bash
/ocr-debug true   # Enable detailed OCR logging
/ocr-debug false  # Disable detailed OCR logging
/ocr-debug        # Check current status
```

#### Logging System
Access logs at:
- **Console**: Real-time color-coded output
- **File**: `logs/bots.log`
- **Discord**: Webhook notifications (rate-limited)

#### Processed Images
OCR-processed images are automatically saved in:
- **Directory**: `processed_ocr/`
- **Naming**: `[BOTNAME][ hh:mm:ss rrrr-mm-dd ][]`
- **Auto-rotation**: Max 400 files

---

## 🛠️ Configuration

### Bot-specific Settings

Each bot maintains its own configuration in `BotName/config/config.js`:

```javascript
module.exports = {
    // Discord settings
    token: process.env.BOTNAME_TOKEN,
    clientId: process.env.BOTNAME_CLIENT_ID,
    
    // Channel configurations
    allowedChannelIds: ['1234567890123456789'],
    
    // OCR settings (if applicable)
    ocr: {
        saveProcessedImages: true,
        detailedLogging: { enabled: false },
        maxProcessedFiles: 400
    },
    
    // Bot-specific features...
};
```

### Shared Data Storage

- **`shared_data/`** - Cross-bot data storage
- **`processed_ocr/`** - OCR processed images (all bots)
- **`logs/`** - Centralized log files

---

## 🤝 Contributing

### Code Style
- **Consistent Architecture** - Follow the established bot pattern
- **Centralized Logging** - Always use `createBotLogger(botName)`
- **Error Handling** - Implement comprehensive try-catch blocks
- **Environment Variables** - All sensitive data in `.env`

### Adding New Features
1. **Use Existing Patterns** - Follow the modular architecture
2. **Integrate with Utilities** - Leverage centralized systems
3. **Document Changes** - Update both README and CLAUDE.md
4. **Test Thoroughly** - Verify cross-bot compatibility

### Development Workflow
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Test specific bot
npm run botname

# Check logs
tail -f logs/bots.log
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support

### Documentation
- **[CLAUDE.md](CLAUDE.md)** - Detailed developer documentation
- **Bot Configs** - Individual `BotName/config/` directories
- **Logs** - `logs/bots.log` for troubleshooting

### Common Issues
- **Missing Permissions** - Ensure bots have required Discord permissions
- **OCR Not Working** - Check image quality and format
- **Memory Issues** - Monitor processed image storage rotation
- **API Limits** - Review rate limiting in logs

---

<div align="center">

**Polski Squad Discord Bot Collection**  
*Comprehensive server automation with 9 specialized bots*

Made with ❤️ by the Polski Squad Development Team

</div>