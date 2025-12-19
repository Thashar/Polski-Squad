# CLAUDE.md - Szczegółowa Dokumentacja Deweloperska

**INSTRUKCJA WAŻNA: ZAWSZE PISZ PO POLSKU. Odpowiadaj na każdą konwersację w języku polskim, niezależnie od języka zapytania użytkownika.**

**WYJĄTEK - Gary Bot:** Kod i komentarze w Gary Bot (`Gary/` folder) są pisane PO ANGIELSKU. To jest zamierzony wyjątek od reguły. Przy edycji Gary Bot używaj języka angielskiego w kodzie i komentarzach.

**INSTRUKCJA COMMITOWANIA ZMIAN:**
- Po zakończeniu wprowadzania zmian w kodzie ZAWSZE commituj i pushuj BEZ PYTANIA
- Jeżeli jakiś hook zaraportuje, że są niezacommitowane zmiany to zacommituj i pushuj
- W commitach używaj krótkiego opisu zmian PO POLSKU
- Format commit message: Krótki opis zmian po polsku (bez dodatkowych linii)
- Przykład: "Dodano system kolejkowania OCR do StalkerLME"
- NIGDY nie pytaj użytkownika czy zacommitować - po prostu to zrób

**INSTRUKCJA AKTUALIZACJI DOKUMENTACJI:**
- Po wprowadzeniu zmian w funkcjonalności bota ZAWSZE aktualizuj odpowiednią sekcję w CLAUDE.md
- Opisz co się zmieniło, jak teraz działa funkcja, jakie są nowe parametry/komendy/mechanizmy
- Używaj Grep + Read z offset/limit + Edit - NIE czytaj całego pliku CLAUDE.md
- Aktualizuj sekcję "Historia Zmian" na końcu dokumentu z krótkim opisem zmian
- To oszczędzi tysiące tokenów w przyszłych sesjach - kolejna instancja Claude będzie wiedziała jak działa kod bez czytania źródeł
- **PRZYKŁAD**: Zmieniłeś system kolejkowania w StalkerLME → zaktualizuj sekcję "StalkerLME Bot - System Kolejkowania" + dodaj wpis w "Historia Zmian"

**INSTRUKCJA AKTUALIZACJI LISTY KOMEND W MUTEUSZU:**
- Po dodaniu NOWEJ komendy lub aktualizacji istniejącej komendy w KTÓRYMKOLWIEK bocie ZAWSZE aktualizuj `Muteusz/config/all_commands.json`
- Ten plik jest używany przez komendę `/komendy` w Muteuszu do wyświetlania wszystkich dostępnych komend ze wszystkich botów
- Dodaj/zaktualizuj wpis w odpowiedniej sekcji bota z: name, description, usage, requiredPermission
- Zachowaj alfabetyczną kolejność komend w ramach danego bota
- Poziomy uprawnień: administrator, moderator, clan_member, achievement_role, special_role, public

**⚡ KRYTYCZNE - OPTYMALIZACJA TOKENÓW:**
- **ZAWSZE używaj Grep PRZED Read** - Znajdź lokalizację, POTEM czytaj tylko potrzebne linie
- **ZAWSZE używaj offset + limit przy czytaniu dużych plików** - Nie czytaj całości!
- **Dla eksploracji kodu: Task tool z Explore agent** - Nie czytaj wielu plików ręcznie
- **Zobacz sekcję [🔥 OPTYMALIZACJA TOKENÓW](#optymalizacja-tokenów) poniżej dla szczegółów**

**Ostatnia aktualizacja:** Grudzień 2025

Ten plik zawiera szczegółową dokumentację techniczną dla Claude Code podczas pracy z kodem w tym repozytorium.

---

## 📋 Spis Treści

### Nawigacja dla Ludzi (klikalne linki)

1. [🔥 OPTYMALIZACJA TOKENÓW](#optymalizacja-tokenów)
2. [Przegląd Projektu](#przegląd-projektu)
3. [Architektura Systemu](#architektura-systemu)
4. [Systemy Scentralizowane](#systemy-scentralizowane)
5. [Szczegóły Botów](#szczegóły-botów)
6. [Komendy Deweloperskie](#komendy-deweloperskie)
7. [Zmienne Środowiskowe](#zmienne-środowiskowe)
8. [Najlepsze Praktyki](#najlepsze-praktyki)
9. [Rozwiązywanie Problemów](#rozwiązywanie-problemów)

---

### Nawigacja dla Claude (numery linii + offset/limit)

| Sekcja | Linia | Opis |
|--------|-------|------|
| **🔥 OPTYMALIZACJA TOKENÓW** | 84 | Workflow: Grep→Read→Edit, Task Explore |
| **Przegląd Projektu** | 103 | 9 botów, środowisko produkcyjne |
| **Architektura Systemu** | 127 | Struktura projektu, wzorce architektury |
| **Systemy Scentralizowane** | 233 | Logger, Nickname Manager, OCR Utils, Backup |
| **Szczegóły Botów** | 588 | Dokumentacja wszystkich 9 botów |
| └─ Rekruter Bot | 590 | OCR rekrutacja, kwalifikacja klanów |
| └─ Szkolenia Bot | 604 | Wątki treningowe, przypomnienia |
| └─ StalkerLME Bot | 614 | Kary OCR, punkty, urlopy, dekoder, fazy |
| └─ Muteusz Bot | 629 | Auto-moderacja, cache mediów, chaos mode |
| └─ EndersEcho Bot | 645 | OCR wyników, rankingi, role TOP |
| └─ Kontroler Bot | 658 | OCR dwukanałowy (CX/Daily), loteria |
| └─ Konklawe Bot | 669 | Gra hasłowa, osiągnięcia, klątwy, blessingi |
| └─ Wydarzynier Bot | 684 | Lobby party, zaproszenia, repozytorium |
| └─ Gary Bot | 697 | Lunar Mine API, proxy, cache, wyszukiwanie |
| **Komendy Deweloperskie** | 714 | npm start/dev/local, bot-config.json |
| **Zmienne Środowiskowe** | 763 | Kompletna lista .env dla wszystkich botów |
| **Najlepsze Praktyki** | 851 | Logowanie, błędy, konfiguracja, persistencja |
| **Rozwiązywanie Problemów** | 862 | OCR, proxy, nicki, pamięć, rate limit |
| **Historia Zmian** | 874 | Changelog: Listopad 2025, Styczeń 2025 |

**Przykład użycia:**
```bash
# Chcę sprawdzić system OCR w StalkerLME
Read /home/user/Polski-Squad/CLAUDE.md offset:614 limit:15

# Chcę zobaczyć zmienne środowiskowe dla Gary
Read /home/user/Polski-Squad/CLAUDE.md offset:798 limit:12
```

---

## 🔥 OPTYMALIZACJA TOKENÓW

**7 ZASAD - minimalizuj zużycie tokenów:**

1. **Grep PRZED Read** - Znajdź lokalizację → Read tylko potrzebne linie (offset+limit)
2. **Task Explore dla eksploracji** - Ogólne pytania o kod/architekturę → agent eksploruje za Ciebie
3. **offset + limit ZAWSZE** - Nigdy nie czytaj całych dużych plików
4. **Workflow: Grep → Read → Edit** - Przy modyfikacji kodu zawsze w tej kolejności
5. **Grep output_mode** - Używaj "files_with_matches" gdy nie potrzebujesz treści
6. **NIE czytaj gdy** - Można użyć Task Explore, Grep, Glob
7. **Glob zamiast Bash** - Do wyszukiwania plików

**Workflow:**
- Eksploracja: `Task Explore`
- Edycja: `Grep → Read (offset+limit) → Edit`
- Zrozumienie: `Task Explore`

---

## Przegląd Projektu

To jest kolekcja botów Discord dla Polski Squad, zawierająca **9 oddzielnych botów** z zaawansowanym systemem logowania i zarządzania:

### ⚠️ WAŻNE - Środowisko Produkcyjne

**KRYTYCZNE:** Boty działają na SERWERZE PRODUKCYJNYM, NIE lokalnie.
- Logi w folderze `logs/` to logi LOKALNE z testów - NIE używaj ich do diagnostyki produkcji
- Problemy z backupami, crashami lub działaniem botów muszą być diagnozowane na podstawie logów serwera
- Jeśli użytkownik zgłasza problem "wczoraj działało, dziś nie" - to problem produkcyjny, nie lokalny

### Lista Botów
1. **Rekruter Bot** - Zaawansowany system rekrutacji z OCR i kwalifikacjami klanowymi
2. **Szkolenia Bot** - Zarządzanie wątkami treningowymi z automatycznymi przypomnieniami
3. **StalkerLME Bot** - System kar za uczestnictwo w bossach z OCR + dekoder buildów + system faz
4. **Muteusz Bot** - Kompleksowa moderacja z cache'owaniem mediów i zarządzaniem rolami
5. **EndersEcho Bot** - System rankingów bossów z OCR i automatycznymi rolami TOP
6. **Kontroler Bot** - Dwukanałowa weryfikacja OCR + zaawansowana loteria z datami
7. **Konklawe Bot** - Interaktywna gra słowna z osiągnięciami i systemem klątw
8. **Wydarzynier Bot** - Zarządzanie lobby party z organizacją wątkową
9. **Gary Bot** - Analiza Lunar Mine Expedition z API garrytools.com i proxy

---

## Architektura Systemu

### Struktura Projektu

```
Polski Squad/
├── index.js                    # Główny launcher orchestrujący wszystkie boty
├── bot-config.json             # Konfiguracja środowisk (production/development)
├── package.json                # Zależności i skrypty npm
├── .env                        # Zmienne środowiskowe (NIE commitować!)
│
├── utils/                      # Współdzielone narzędzia
│   ├── consoleLogger.js        # Centralny system logowania z kolorami
│   ├── discordLogger.js        # Logowanie do Discord webhook
│   ├── nicknameManagerService.js  # Zarządzanie nickami cross-bot
│   └── ocrFileUtils.js         # Współdzielone narzędzia OCR
│
├── shared_data/                # Dane współdzielone między botami
│   ├── nickname_manager_config.json
│   └── active_nickname_effects.json
│
├── processed_ocr/              # Przetworzone obrazy OCR (wszystkie boty)
├── logs/                       # Scentralizowane logi
│   └── bots.log
│
├── Rekruter/                   # Bot Rekruter
│   ├── index.js
│   ├── config/
│   │   ├── config.js
│   │   └── messages.js
│   ├── handlers/
│   │   ├── interactionHandlers.js
│   │   ├── messageHandlers.js
│   │   └── reactionHandlers.js
│   ├── services/
│   │   ├── ocrService.js
│   │   ├── roleMonitoringService.js
│   │   ├── memberNotificationService.js
│   │   └── memberCacheService.js
│   ├── utils/
│   │   └── helpers.js
│   ├── data/
│   │   └── user_monitoring.json
│   └── temp/
│
├── [Podobna struktura dla pozostałych botów]
│
└── Gary/                       # Bot Gary (samodzielny)
    ├── index.js
    ├── config/
    │   └── config.js
    ├── handlers/
    │   └── interactionHandlers.js
    ├── services/
    │   ├── apiService.js
    │   ├── dataService.js
    │   ├── guildSearchService.js
    │   └── proxyService.js
    └── data/
        ├── clan_rankings.json
        └── endersecho_rankings.json
```

### Wzorzec Architektury Botów

Każdy bot stosuje spójną modularną architekturę:

```javascript
// index.js - Główny plik bota
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('NazwaBota');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // ... inne intenty
    ]
});

// Globalne mapy stanu
const sharedState = {
    userStates: new Map(),
    // ... inne stany
    client,
    config
};

client.once('ready', async () => {
    logger.success('✅ NazwaBota gotowy - [kluczowe funkcje]');
    // Inicjalizacja serwisów
});

client.on('interactionCreate', async interaction => {
    await handleInteraction(interaction, sharedState);
});

client.login(config.token);
```

---

## Systemy Scentralizowane

### 1. Centralny System Logowania

**Plik:** `utils/consoleLogger.js`

#### **KRYTYCZNE: Zasady Implementacji Logowania**

**ZAWSZE używaj centralnego systemu logowania. NIGDY nie używaj `console.log()`, `console.error()` lub `logWithTimestamp()` bezpośrednio.**

#### Poprawna Implementacja

```javascript
// Na górze każdego pliku który potrzebuje logowania
const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('NazwaBota'); // Użyj rzeczywistej nazwy bota

// Następnie używaj metod loggera
logger.info('Wiadomość informacyjna');
logger.error('Wiadomość błędu');
logger.warn('Ostrzeżenie');
logger.success('Sukces');
```

#### Dla Serwisów

```javascript
// Przekaż logger przez konstruktor
class JakiśSerwis {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    jakasMetoda() {
        this.logger.info('Wiadomość serwisu');
    }
}

// Zainicjalizuj serwis z loggerem
const logger = createBotLogger('NazwaBota');
const serwis = new JakiśSerwis(config, logger);
```

#### Funkcje Systemu Logowania

- 🎨 **Kolorowe wyjście** według botów (każdy bot ma własny kolor)
- 📝 **Wiele miejsc docelowych**:
  - Konsola z kolorowaniem
  - Plik `logs/bots.log` z timestampami
  - Discord webhook (opcjonalne, rate-limited 1s delay)
- 🚀 **Zoptymalizowany start** - Jednoliniowe komunikaty statusu: `✅ [NazwaBota] gotowy - [funkcje]`
- 🔍 **Inteligentne separatory** - Wizualne separatory tylko przy przełączaniu między różnymi botami

#### Kolory Botów

```javascript
const botColors = {
    'Rekruter': colors.cyan,
    'Szkolenia': colors.green,
    'StalkerLME': colors.red,
    'Muteusz': colors.magenta,
    'EndersEcho': colors.yellow,
    'Kontroler': colors.blue,
    'Konklawe': colors.white,
    'Wydarzynier': colors.gray,
    'Gary': colors.bright + colors.cyan,
    'Launcher': colors.bright + colors.green
};
```

---

### 2. Centralny Manager Nicków

**Plik:** `utils/nicknameManagerService.js`

#### Główne Funkcje

- 🔄 **Koordynacja cross-bot** - Zapobiega konfliktom między Konklawe (klątwa) i Muteusz (flaga)
- 💾 **Zachowanie oryginalnych nicków** - Zawsze przywraca prawdziwy nick, nie pośrednie efekty
- 📚 **Nakładanie efektów** - Obsługuje overlapping effects (curse + flag)
- 🧹 **Automatyczne czyszczenie** - Usuwa wygasłe efekty
- 📊 **Śledzenie statystyk** według typu efektu

#### Typy Efektów

**CURSE (Konklawe Bot):**
```javascript
await nicknameManager.applyEffect(
    userId,
    'CURSE',
    5 * 60 * 1000, // 5 minut
    {
        guildId: guild.id,
        appliedBy: 'Vatican Council'
    }
);
// Dodaje prefix "Przeklęty " do nicku
```

**FLAG (Muteusz Bot):**
```javascript
await nicknameManager.applyEffect(
    userId,
    'FLAG',
    5 * 60 * 1000, // 5 minut
    {
        guildId: guild.id,
        flagEmoji: '🇺🇦', // Ukraińska flaga
        appliedBy: 'Auto-moderation'
    }
);
// Zmienia nick na flagę
```

#### Przykład Nakładania Efektów

```javascript
// Użytkownik "Janusz" dostaje klątwę
await nicknameManager.applyEffect(userId, 'CURSE', duration);
// Nick: "Przeklęty Janusz" (oryginał: "Janusz" zapisany)

// Potem dostaje flagę
await nicknameManager.applyEffect(userId, 'FLAG', duration, { flagEmoji: '🇺🇦' });
// Nick: "🇺🇦" (oryginał: "Janusz" nadal zachowany)

// Flaga wygasa
await nicknameManager.removeEffect(userId, flagEffectId);
// Nick: "Janusz" (przywrócony oryginał, NIE "Przeklęty Janusz")
```

#### API Nickname Manager

```javascript
// Zastosuj efekt
await nicknameManager.applyEffect(userId, effectType, duration, metadata);

// Usuń efekt
await nicknameManager.removeEffect(userId, effectId);

// Usuń wszystkie efekty użytkownika
await nicknameManager.removeAllUserEffects(userId);

// Pobierz aktywne efekty
const effects = nicknameManager.getActiveEffects(userId);

// Pobierz statystyki
const stats = nicknameManager.getStats();
```

---

### 3. System Przetwarzania OCR

**Plik:** `utils/ocrFileUtils.js`

#### Funkcje

- 📁 **Współdzielone przechowywanie** - Katalog `processed_ocr/` dla wszystkich botów OCR
- 🏷️ **Standaryzowane nazewnictwo**:
  - Format ogólny: `[BOTNAME][ rrrr-mm-dd hh:mm:ss ][]`
  - Format Kontrolera: `[KONTROLER][ rrrr-mm-dd hh:mm:ss ][daily/cx]`
- 🔄 **Automatyczna rotacja** - Max 400 plików z czyszczeniem (100 per typ bota)
- 🐛 **Tryb debug** - Przełączanie przez komendę `/ocr-debug`
- 🔧 **Wielojęzyczne wsparcie** - Polski + angielski dla Tesseract

#### API OCR Utils

```javascript
const { saveProcessedImage, enhanceImage } = require('./utils/ocrFileUtils');

// Przetwórz obraz
const processedBuffer = await enhanceImage(
    originalBuffer,
    {
        whiteThreshold: 200,
        gamma: 2.0,
        contrast: 1.5
    }
);

// Zapisz przetworzony obraz
await saveProcessedImage(
    processedBuffer,
    'BOTNAME',
    {
        originalFilename: 'screenshot.png',
        userId: '123456789',
        channelType: 'daily' // opcjonalne, dla Kontrolera
    }
);
```

#### Konfiguracja OCR w Botach

Każdy bot OCR ma szczegółową konfigurację w `config/config.js`:

```javascript
ocr: {
    tempDir: path.join(__dirname, '../temp'),

    // Zapisywanie przetworzonych obrazów
    saveProcessedImages: true,
    processedDir: path.join(__dirname, '../../processed_ocr'),
    maxProcessedFiles: 400,

    // Szczegółowe logowanie OCR
    detailedLogging: {
        enabled: false,  // Domyślnie wyłączone, włączaj przez /ocr-debug
        logImageProcessing: true,
        logTextExtraction: true,
        logScoreAnalysis: true,
        // ... inne opcje specyficzne dla bota
    }
}
```

---

### 4. System Backup do Google Drive

**Pliki:**
- `utils/backupManager.js` - Główny manager backupów
- `backup-scheduler.js` - Scheduler automatycznych backupów
- `manual-backup.js` - Skrypt dla manualnych backupów
- `authorize-google.js` - Autoryzacja Google Drive API

#### Funkcjonalność

**Automatyczne Backupy:**
- Scheduler cron: Każdego dnia o 2:00 w nocy (`0 2 * * *`)
- Backup wszystkich 9 botów (foldery `data/`)
- Kompresja ZIP z poziomem 9
- Upload do Google Drive folder: `Polski_Squad_Backups`
- Retencja: 7 dni (starsze backupy automatycznie usuwane)
- Podsumowanie wysyłane na webhook Discord

**Manualne Backupy:**
- Komenda `/backup` (tylko dla adminów)
- Upload do osobnego folderu: `Polski_Squad_Manual_Backups`
- Permanentne (nie są automatycznie usuwane)
- Nazwa pliku zawiera triggera: `BotName_MANUAL_timestamp_by_UserName.zip`
- Podsumowanie wysyłane na webhook Discord

**Struktura Google Drive:**
```
My Drive/
├── Polski_Squad_Backups/          # Automatyczne (7 dni)
│   ├── EndersEcho/
│   │   ├── EndersEcho_2025-11-20.zip
│   │   └── EndersEcho_2025-11-21.zip
│   ├── Gary/
│   ├── Konklawe/
│   └── ...
└── Polski_Squad_Manual_Backups/   # Manualne (permanentne)
    ├── EndersEcho/
    │   └── EndersEcho_MANUAL_2025-11-21_by_Admin.zip
    └── ...
```

#### API Backup Manager

```javascript
const BackupManager = require('./utils/backupManager');
const backupManager = new BackupManager();

// Automatyczny backup wszystkich botów
await backupManager.backupAll();

// Manualny backup (z informacją kto wywołał)
const results = await backupManager.createManualBackup('AdminName');

// Pojedynczy bot
const archivePath = await backupManager.createBotArchive('BotName');
const uploadResult = await backupManager.uploadToGoogleDrive(archivePath, 'BotName');
```

#### Szczegółowe Logowanie Błędów

System klasyfikuje błędy dla łatwiejszej diagnostyki:

```javascript
// Przykładowe kategorie błędów:
- ENOSPC → Brak miejsca na dysku
- EACCES/EPERM → Brak uprawnień do pliku/folderu
- ENOENT → Plik/folder nie istnieje
- ECONNRESET/ETIMEDOUT → Problem sieciowy
- 403 → Brak uprawnień API lub limit przekroczony
- 404 → Folder docelowy nie istnieje
- 507 → Brak miejsca na Google Drive
```

#### Konfiguracja

**Zmienne Środowiskowe:**
```env
# Google Drive
GOOGLE_CREDENTIALS_PATH=path/to/credentials.json

# Webhook dla backupów (opcjonalne)
DISCORD_LOG_WEBHOOK_URL_BACKUP=webhook_url
DISCORD_LOG_WEBHOOK_URL=webhook_url_fallback
```

**Autoryzacja Google Drive:**
1. Pobierz `credentials.json` z Google Cloud Console
2. Uruchom: `node authorize-google.js`
3. Kliknij w link i autoryzuj aplikację
4. Token zostanie zapisany w `token.json`
5. **WAŻNE:** Token jest automatycznie odświeżany i zapisywany przy każdym użyciu (event listener na 'tokens')

**Automatyczne Odświeżanie Tokenów:**
- BackupManager nasłuchuje na zdarzenie `tokens` z oAuth2Client
- Gdy Google API odświeża `access_token`, nowy token jest automatycznie zapisywany do `token.json`
- Zapobiega to problemom z wygasłymi tokenami przy codziennych backupach
- Logi: `🔄 Odświeżono access_token - zapisuję do pliku`

#### Podsumowanie na Webhook

Format wiadomości:
```
💾 **AUTOMATYCZNY BACKUP** / 📦 **MANUALNY BACKUP** (AdminName)

**9/9 botów zarchiwizowanych** | **45.23 MB**

✅ **EndersEcho** - 5.12 MB
✅ **Gary** - 8.34 MB
✅ **Konklawe** - 2.45 MB
... więcej

📭 **SomeBot** - Pusty folder data

🕐 21.11.2025, 02:00:15
```

#### Uruchamianie

**Automatyczny scheduler:**
```bash
# Uruchamia się wraz z launcherem
npm start
```

**Manualny backup:**
```bash
# Przez Discord
/backup

# Lub bezpośrednio przez skrypt
node manual-backup.js
```

---

## Szczegóły Botów

### 🎯 Rekruter Bot

**Funkcjonalność:** Wieloetapowa rekrutacja z OCR → Kwalifikacja klanów: <100K=brak, 100K-599K=Clan0, 600K-799K=Clan1, 800K-1.19M=Clan2, 1.2M+=Main
**OCR:** `services/ocrService.js` - Tesseract (PL+EN), preprocessing, ekstrakcja nick+atak
**Serwisy:**
- `memberNotificationService.js` - Śledzenie boostów, losowe gratulacje
- `roleMonitoringService.js` - Cron 6h, ostrzeżenia po 24h bez ról
- `roleConflictService.js` - Auto-usuwanie ról rekrutacyjnych gdy dostaje klanową

**Komendy:** `/ocr-debug`, `/nick`
**Env:** TOKEN, kanały (RECRUITMENT, CLAN0-2, MAIN_CLAN, WELCOME), role (CLAN0-2, MAIN_CLAN, VERIFIED, NOT_POLISH)

---

### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → 24h przypomnienie → archiwizacja → zamknięcie po 7 dniach
**Serwisy:** `threadService.js` (60min interval), `reminderStorageService.js` (persistent JSON)
**Komendy:** `/decode` (integracja sio-tools)
**Env:** TOKEN, CHANNEL_ID, PING_ROLE_ID

---

### ⚔️ StalkerLME Bot

**6 Systemów:**
1. **Kary OCR** - `ocrService.js`: Tesseract, upscaling 3x, gamma 3.0, Levenshtein matching, wykrywanie 0
2. **Punkty** - `punishmentService.js`: 2pts=kara, 3pts=ban loterii, cron czyszczenie (pn 00:00)
3. **Urlopy** - `vacationService.js`: Przycisk → rola 15min, cooldown 6h
4. **Dekoder** - `decodeService.js`: `/decode` dla Survivor.io (LZMA decompress)
5. **Kolejkowanie OCR** - `queueService.js`: Jeden user/guild, progress bar, 15min timeout, przyciski komend
6. **Fazy Lunar** - `phaseService.js`: `/faza1` (lista), `/faza2` (3 rundy damage), `/wyniki` (TOP30), `/progres`, `/clan-status`

**Przypomnienia** - `reminderService.js`: DM z przyciskiem potwierdzenia, monitorowanie odpowiedzi DM (losowe polskie odpowiedzi, repost na kanały potwierdzenia), auto-cleanup po deadline

**Mapowanie Nicków** - System automatycznego mapowania użytkowników po zmianie nicku Discord:
- `databaseService.js`: Indeks graczy `player_index.json` (userId → latestNick + allNicks)
- `findUserIdByNick()`: Wyszukuje userId na podstawie nicku (stary lub nowy)
- Komendy `/progres`, `/player-status`, `/clan-status` używają spójnego mechanizmu:
  1. Discord ID użytkownika → aktualny klan (z roli Discord)
  2. Szukanie w indeksie po nicku → userId + latestNick
  3. Wyszukiwanie danych OCR po userId (nie po nicku!)
  4. Wyświetlanie gracza w aktualnym klanie z ostatnim nickiem z danych
- Funkcja `createGlobalPlayerRanking()`: Używa `userId` jako klucza w mapie zamiast `displayName`
- Struktura rankingu: `{ userId, playerName, maxScore, clanName, clanKey }`
- Gracze są widoczni w rankingach niezależnie od zmiany nicku Discord

**Raport Problematycznych Graczy** - `/player-raport` (tylko admini i moderatorzy):
- Wybór klanu → analiza wszystkich członków klanu
- Kryteria problemu (przynajmniej jedno musi być spełnione):
  - 🔴 Rzetelność < 90%
  - 🔴 Punktualność < 70%
  - 🔴 Zaangażowanie < 70%
  - 🔴 Responsywność < 25%
  - 🪦 Trend gwałtownie malejący (trendRatio ≤ 0.5)
  - ⚠️ Progres miesięczny < 25 punktów
  - ⚠️ Progres kwartalny < 100 punktów
- Embed z polami: każdy gracz osobno, posortowani według liczby problemów
- Ephemeral (tylko dla wywołującego), max 25 graczy w raporcie

**Komendy:** `/punish`, `/remind`, `/punishment`, `/points`, `/decode`, `/faza1`, `/faza2`, `/wyniki`, `/progres`, `/player-status`, `/clan-status`, `/clan-progres`, `/player-raport`, `/ocr-debug`
**Env:** TOKEN, MODERATOR_ROLE_1-4, PUNISHMENT_ROLE_ID, LOTTERY_BAN_ROLE_ID, TARGET_ROLE_0/1/2/MAIN, WARNING_CHANNEL_0/1/2/MAIN, CONFIRMATION_CHANNEL_0/1/2/MAIN, VACATION_CHANNEL_ID

---

### 🤖 Muteusz Bot

**7 Systemów:**
1. **Auto-Moderacja** - `autoModerationService.js`: Spam (3 duplikaty/30min=7d timeout), wulgaryzmy (progresja kar), zaproszenia Discord
2. **Cache Mediów** - `mediaService.js`: 100MB/plik, 2GB total, 24h retencja
3. **Zarządzanie Rolami** - `roleManagementService.js`: Ekskluzywne grupy (`special_roles.json`), auto-usuwanie konfliktów, 5s delay
4. **Naruszenia** - `warningsService.js`: Persistent JSON z UUID, reason, moderator, timestamp
5. **Koordynacja** - `roleKickingService.js`: Cron 2h, kick bez ról po 24h (integracja Rekruter)
6. **Chaos Mode** - `chaosService.js`: 5% szansa rola (permanent), hymn PL (5 zwrotek), 10% odpowiedź bota, multi-role support
7. **Losowe Odpowiedzi** - Virtutti Papajlari: 1/250 szansa, emoji PepeSoldier

**Komendy:** `/remove-roles`, `/special-roles`, `/add-special-role`, `/remove-special-role`, `/list-special-roles`, `/violations`, `/unregister-command`, `/chaos-mode`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, TARGET_CHANNEL_ID, LOG_CHANNEL_ID

---

### 🏆 EndersEcho Bot

**4 Systemy:**
1. **OCR Wyników** - `ocrService.js`: Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
2. **Rankingi** - `rankingService.js`: Persistent JSON (userId_bossName), funkcje: add/update, getTop, remove
3. **Role TOP** - `roleManagementService.js`: 5 poziomów (top1, top2, top3-nieużywane, top4-10, top11-30), auto-update
4. **Paginacja** - `interactionHandlers.js`: 10/strona, przyciski nawigacji, 1h timeout

**Komendy:** `/update`, `/ranking`, `/remove`, `/ocr-debug`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, ALLOWED_CHANNEL_ID

---

### 🎯 Kontroler Bot

**2 Systemy:**
1. **OCR Dwukanałowy** - `ocrService.js`: CX (1500min, 0-2800/100, skip1, rola 2800+), Daily (910min, 0-1050/10, skip3, 2x nick), normalizacja znaków (o→0, z→2, l→1, sg→9)
2. **Loteria** - `lotteryService.js`: Daty (dd.mm.yyyy HH:MM), DST auto, multi-klan (server/main/0/1/2), cykle (0-365dni, max 24d), ostrzeżenia (90/30min), historia+przelosowanie, ban filter

**Komendy:** `/lottery`, `/lottery-list`, `/lottery-remove`, `/lottery-history`, `/lottery-reroll`, `/lottery-debug`, `/ocr-debug`
**Env:** TOKEN, CLIENT_ID, GUILD_ID

---

### ⛪ Konklawe Bot

**6 Systemów:**
1. **Gra Hasłowa** - `gameService.js`: Hasło "Konklawe" (admin może zmienić), poprawna→rola papieska
2. **Osiągnięcia** - Medal Virtutti Papajlari: 30+ odpowiedzi, reset rankingu, specjalne uprawnienia
3. **Timery** - `timerService.js`: 15/30/60min przypomnienia, auto-reset, persistent (`game_state.json`), restore po restarcie
4. **Klątwy** - 7 rodzajów (slow mode, auto-delete, ping, emoji, caps, timeout, role), 5min, nickname manager, walidacja przed rzuceniem (zapobiega duplikowaniu)
5. **Komendy Specjalne** - Blessing (22 warianty, 10min cooldown, 5 daily), Virtue Check (10 cnót + porady)
6. **Losowe Odpowiedzi** - Użytkownicy papiescy: 1/100 szansa, emoji JP2roll

**Komendy:** `/podpowiedz`, `/podpowiedzi`, `/statystyki`, `/blessing`, `/virtue-check`
**Env:** TOKEN, CLIENT_ID, GUILD_ID

---

### 🎉 Wydarzynier Bot

**4 Systemy:**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback

**Komendy:** `/party`, `/party-add`, `/party-kick`, `/party-close`
**Env:** TOKEN

---

### 🎮 Gary Bot

**8 Systemów:**
1. **Lunar Mine** - `apiService.js`: Fetch garrytools.com/lunar, cheerio parse, 4 gildie, członkowie sorted by attack
2. **Wyszukiwanie** - `guildSearchService.js`: Fuzzy matching (exact/startsWith/contains/levenshtein), tryby TOP500/GLOBAL
3. **Cache** - `dataService.js`: Persistent JSON (clans, rank, members), refresh 24h/manual/start
4. **Proxy** - `proxyService.js`: Webshare API, round-robin/random, health monitoring, failover
5. **Paginacja** - 20/strona, 1h timeout, publiczna nawigacja
6. **Cron** - Środa 18:45 `/lunarmine` auto-exec
7. **Wątki** - Obsługa `parentId`, whitelist check
8. **Emoji** - Server emoji w embedach

**Komendy:** `/lunarmine`, `/search`, `/analyse`, `/player`, `/ee`, `/refresh`, `/proxy-test`, `/proxy-stats`, `/proxy-refresh`
**Env:** TOKEN, CLIENT_ID, ALLOWED_CHANNEL_ID, ADMIN_ROLES, PROXY_ENABLED, PROXY_STRATEGY, PROXY_LIST, WEBSHARE_URL

---

## Komendy Deweloperskie

### Uruchamianie Botów

```bash
# Produkcja - wszystkie boty z bot-config.json["production"]
npm start
npm run dev

# Development - boty z bot-config.json["development"]
npm run local

# Pojedyncze boty
npm run rekruter
npm run szkolenia
npm run stalker
npm run muteusz
npm run endersecho
npm run kontroler
npm run konklawe
npm run wydarzynier
npm run gary
```

### Konfiguracja Środowisk

**Plik:** `bot-config.json`

```json
{
  "production": [
    "rekruter",
    "endersecho",
    "szkolenia",
    "stalkerlme",
    "kontroler",
    "konklawe",
    "muteusz",
    "wydarzynier",
    "gary"
  ],
  "development": [
    "gary"
  ]
}
```

---

## Zmienne Środowiskowe

### Plik .env

Każdy bot wymaga własnych zmiennych środowiskowych. Poniżej kompletna lista:

```env
# ===== REKRUTER BOT =====
DISCORD_TOKEN=bot_token_here
RECRUITMENT_CHANNEL=channel_id
CLAN0_CHANNEL=channel_id
CLAN1_CHANNEL=channel_id
CLAN2_CHANNEL=channel_id
MAIN_CLAN_CHANNEL=channel_id
WELCOME_CHANNEL=channel_id
NOT_POLISH_ROLE=role_id
VERIFIED_ROLE=role_id
CLAN0_ROLE=role_id
CLAN1_ROLE=role_id
CLAN2_ROLE=role_id
MAIN_CLAN_ROLE=role_id
WAITING_ROOM_CHANNEL=poczekalnia

# ===== SZKOLENIA BOT =====
SZKOLENIA_DISCORD_TOKEN=bot_token_here
SZKOLENIA_CHANNEL_ID=channel_id
SZKOLENIA_PING_ROLE_ID=role_id

# ===== STALKERLME BOT =====
STALKER_LME_DISCORD_TOKEN=bot_token_here
STALKER_LME_MODERATOR_ROLE_1=role_id
STALKER_LME_MODERATOR_ROLE_2=role_id
STALKER_LME_MODERATOR_ROLE_3=role_id
STALKER_LME_MODERATOR_ROLE_4=role_id
STALKER_LME_PUNISHMENT_ROLE_ID=role_id
STALKER_LME_LOTTERY_BAN_ROLE_ID=role_id
STALKER_LME_TARGET_ROLE_0=role_id
STALKER_LME_TARGET_ROLE_1=role_id
STALKER_LME_TARGET_ROLE_2=role_id
STALKER_LME_TARGET_ROLE_MAIN=role_id
STALKER_LME_WARNING_CHANNEL_0=channel_id
STALKER_LME_WARNING_CHANNEL_1=channel_id
STALKER_LME_WARNING_CHANNEL_2=channel_id
STALKER_LME_WARNING_CHANNEL_MAIN=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_0=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_1=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_2=channel_id
STALKER_LME_CONFIRMATION_CHANNEL_MAIN=channel_id
STALKER_LME_VACATION_CHANNEL_ID=channel_id

# ===== MUTEUSZ BOT =====
MUTEUSZ_TOKEN=bot_token_here
MUTEUSZ_CLIENT_ID=client_id
MUTEUSZ_GUILD_ID=guild_id
MUTEUSZ_TARGET_CHANNEL_ID=channel_id
MUTEUSZ_LOG_CHANNEL_ID=channel_id

# ===== ENDERSECHO BOT =====
ENDERSECHO_TOKEN=bot_token_here
ENDERSECHO_CLIENT_ID=client_id
ENDERSECHO_GUILD_ID=guild_id
ENDERSECHO_ALLOWED_CHANNEL_ID=channel_id

# ===== KONTROLER BOT =====
KONTROLER_TOKEN=bot_token_here
KONTROLER_CLIENT_ID=client_id
KONTROLER_GUILD_ID=guild_id

# ===== KONKLAWE BOT =====
KONKLAWE_TOKEN=bot_token_here
KONKLAWE_CLIENT_ID=client_id
KONKLAWE_GUILD_ID=guild_id

# ===== WYDARZYNIER BOT =====
WYDARZYNIER_TOKEN=bot_token_here

# ===== GARY BOT =====
GARY_TOKEN=bot_token_here
GARY_CLIENT_ID=client_id
GARY_ALLOWED_CHANNEL_ID=channel1,channel2
GARY_ADMIN_ROLES=role1,role2
GARY_PROXY_ENABLED=true
GARY_PROXY_STRATEGY=round-robin
GARY_PROXY_LIST=http://proxy1:port,http://proxy2:port
GARY_WEBSHARE_URL=https://proxy.webshare.io/api/v2/proxy/list/

# ===== DISCORD WEBHOOK (OPCJONALNE) =====
DISCORD_LOG_WEBHOOK_URL=webhook_url_here
```

---

## Najlepsze Praktyki

1. **Optymalizacja** - Zobacz [🔥 OPTYMALIZACJA TOKENÓW](#optymalizacja-tokenów)
2. **Logowanie** - `utils/consoleLogger.js` - createBotLogger('NazwaBota'), NIGDY console.log
3. **Błędy** - try/catch z logger.error, ephemeral feedback do użytkownika
4. **Konfiguracja** - Wrażliwe w `.env`, walidacja przy starcie, `config/config.js`
5. **Persistencja** - `fs.promises`, `JSON.stringify(data, null, 2)` dla czytelności
6. **Graceful Shutdown** - SIGINT handler, saveAllData(), client.destroy()

---

## Rozwiązywanie Problemów

**OCR:** `/ocr-debug true`, min 800x600px, `processed_ocr/`, języki PL+EN
**Proxy:** `/proxy-test`, `/proxy-refresh`, logi `logs/bots.log`
**Nicki:** `shared_data/active_nickname_effects.json`, logi managera
**Pamięć:** OCR max 400, cache 2GB, `rm -rf */temp/*`
**Rate Limit:** Kolejka webhook, delay między requestami
**Start:** `logs/bots.log`, env vars, uprawnienia Discord, `npm run botname`
**Backup:** Token wygasł → auto-refresh (event 'tokens'), `node authorize-google.js`, limit 50 tokenów/user

---

## Historia Zmian

### Grudzień 2025

**Konklawe Bot - Walidacja Klątw Przed Rzuceniem:**
- Dodano funkcję `hasActiveCurse(userId, curseType)` sprawdzającą czy użytkownik ma już aktywną klątwę danego typu
- System teraz sprawdza przed rzuceniem klątwy czy cel już ją ma:
  - Gabriel → Lucyfer: Wyświetla komunikat "już ma aktywną klątwę tego typu"
  - Gabriel debuff (10% przy wiadomości): Losuje inną klątwę lub pomija
  - MEGA SILNA KLĄTWA (progresywna zmiana): Losuje inną klątwę lub pomija rundę
- Funkcja sprawdza również czy klątwa nie wygasła (porównuje z `Date.now()`)
- Przy losowaniu nowej klątwy system próbuje max 10 razy znaleźć unikalną klątwę
- Zapobiega duplikowaniu efektów i nadpisywaniu aktywnych klątw
- Lokalizacja zmian:
  - `Konklawe/handlers/interactionHandlers.js` (funkcja `hasActiveCurse`, linie 2751-2765)
  - `Konklawe/handlers/interactionHandlers.js` (walidacja przed applyCurse, linie 1186-1192, 1663-1682, 1696-1712)
  - `Konklawe/handlers/messageHandlers.js` (walidacja Gabriel debuff, linie 52-78)

**Muteusz Bot - Aktualizacja Listy Komend:**
- Dodano brakujące komendy StalkerLME do pliku `Muteusz/config/all_commands.json`:
  - `/clan-progres` - Wyświetla progres TOP30 dla wybranego klanu (clan_member)
  - `/player-raport` - Raport problematycznych graczy w klanie (moderator)
- Te komendy teraz widnieją w systemie `/komendy` w Muteuszu
- Dodano nową instrukcję w górnej części CLAUDE.md: "INSTRUKCJA AKTUALIZACJI LISTY KOMEND W MUTEUSZU"
- Po dodaniu/aktualizacji dowolnej komendy w którymkolwiek bocie należy zaktualizować `all_commands.json`

**StalkerLME Bot - Optymalizacja /player-raport - Progi Progresów:**
- Zmieniono logikę wyświetlania progresów w `/player-raport` dla ściślejszych wymagań
- **Progres miesięczny:** Wyświetlany TYLKO gdy jest co najmniej 5 tygodni danych (4 ostatnie + 1 porównawczy)
- **Progres kwartalny:** Wyświetlany TYLKO gdy jest pełny kwartał (13 tygodni)
- **Usunięto "dostępne dane":** Bot nie pokazuje już progresów obliczanych z niepełnych danych
- **Trend:** Obliczany tylko gdy są oba progresy (miesięczny i kwartalny), czyli minimum 13 tygodni
- Cel: Zapobieganie fałszywym alarmom dla nowych graczy z małą ilością danych
- Lokalizacja zmian: `StalkerLME/handlers/interactionHandlers.js` (funkcja `analyzePlayerForRaport`, linie 9866-9942)

**Rekruter Bot - Przywrócono Usuwanie Wiadomości:**
- **FIX KRYTYCZNY:** Przywrócono funkcję `safeDeleteMessage` w `utils/helpers.js`
- Problem: Commit 4bac8e5 (13 grudnia) przypadkowo usunął funkcję podczas "czyszczenia zbędnego kodu"
- Skutek: Wiadomości użytkowników na kanale rekrutacyjnym NIE były usuwane, zaśmiecając kanał
- Funkcja była używana w 13 miejscach w `messageHandlers.js` do usuwania:
  - Wprowadzonych danych (RC, Lunar Level, Lunar Points, zdjęcia)
  - Komend (!nick, !clan, !clan0, !clan1, !clan2)
  - Niepotrzebnych wiadomości (gdy użytkownik nie jest w procesie rekrutacji)
- Przywrócono oryginalną implementację z logowaniem i obsługą błędów

**StalkerLME Bot - Naprawa Systemu Monitorowania DM:**
- **FIX KRYTYCZNY:** Dodano brakujący intent Discord dla wiadomości prywatnych
- Dodano `GatewayIntentBits.DirectMessages` do index.js (MessageContent już był i działa dla DM)
- Problem: Bot nie odbierał wiadomości prywatnych od użytkowników mimo zaimplementowanego handlera
- Skutek: Użytkownicy pisali do bota zamiast klikać przycisk potwierdzenia, ale bot nie reagował
- Handler messageCreate (linia 177-235) był poprawnie zaimplementowany ale nigdy nie był wywoływany
- Teraz bot odpowiada losowymi polskimi wiadomościami i repostuje wiadomości użytkowników na istniejące kanały potwierdzenia
- Udokumentowano istniejące zmienne środowiskowe: `STALKER_LME_CONFIRMATION_CHANNEL_0/1/2/MAIN` (używane przez system potwierdzeń)

**StalkerLME Bot - Naprawa Błędów Zliczania Przypomnień:**
- **FIX KRYTYCZNY:** Naprawiono błędne wywołanie nieistniejącej metody `ocrService.recordPingedUsers()` w obsłudze decyzji urlopowych (linia 9043)
- Problem powodował że przypomnienia wysłane przez ścieżkę urlopową NIE były zliczane w statystykach (`totalPings`)
- Skutek: użytkownicy mogli mieć więcej potwierdzeń niż przypomnień (np. Przypomnienia: 1, Potwierdzenia: 2)
- Poprawiono wywołanie na `reminderUsageService.recordPingedUsers(pingData)` z odpowiednim formatem danych
- Usunięto martwy kod `ocrService.recordPunishedUsers()` w ścieżce `/punish` który powodował crashe
- Teraz wszystkie przypomnienia (zarówno przez normalną ścieżkę jak i urlopową) są poprawnie zliczane

**StalkerLME Bot - Fix: Autocomplete Timeout (Unknown interaction):**
- **FIX KRYTYCZNY:** Naprawiono błąd `DiscordAPIError[10062]: Unknown interaction` w autocomplete `/progres` i `/player-status`
- Problem: Discord wymaga odpowiedzi na autocomplete w ciągu 3 sekund, `loadPlayerIndex()` czasami przekraczało limit
- Przyczyna: Przy pierwszym wywołaniu funkcja skanowała wszystkie pliki phase1 (mogło zająć 5-10+ sekund)
- Rozwiązanie 1: **Cache indeksów graczy w pamięci** (`playerIndexCache` Map w `DatabaseService`)
  - Pierwsze wywołanie: ~100-200ms (odczyt z dysku + cache)
  - Kolejne wywołania: <1ms (z cache)
  - Automatyczna aktualizacja cache przy zapisie przez `savePlayerIndex()`
- Rozwiązanie 2: **Timeout protection w handleAutocomplete** (2.5s z pustą odpowiedzią jako fallback)
- Rozwiązanie 3: **Nowa metoda `clearPlayerIndexCache()`** do czyszczenia cache (przydatne w testach)
- Lokalizacja zmian:
  - `StalkerLME/services/databaseService.js` (linie 21, 113-149, 154-169, 171-181)
  - `StalkerLME/handlers/interactionHandlers.js` (funkcja `handleAutocomplete`, linie 6876-6939)

**StalkerLME Bot - Fix: Rate Limit Gateway (opcode 8):**
- **FIX KRYTYCZNY:** Naprawiono błąd `GatewayRateLimitError: Request with opcode 8 was rate limited` w `/player-raport`
- Problem: Discord Gateway limit dla opcode 8 (REQUEST_GUILD_MEMBERS) przekraczany przez częste `guild.members.fetch()`
- Przyczyny:
  - `/player-raport` fetchowało wszystkich członków serwera (niepotrzebnie)
  - `/punishment` i `/debug-roles` często odświeżały cache
  - `refreshMemberCache()` pobierał członków bez opóźnień między serwerami
- Rozwiązanie 1: **Global throttling dla guild.members.fetch()** - funkcja `safeFetchMembers()`
  - 30-sekundowy cooldown między fetch dla tego samego serwera
  - Automatyczny fallback do cache jeśli fetch w toku
  - Intelligent logging wszystkich operacji
- Rozwiązanie 2: **Użycie cache w /player-raport** zamiast fetch
  - Bot ma cache odświeżany co 30 min przez `refreshMemberCache()`
  - Eliminuje niepotrzebne fetch podczas analizy graczy
  - **UPDATE:** Zmieniono na `safeFetchMembers()` z throttlingiem, aby zapewnić kompletne dane
- Rozwiązanie 3: **5-sekundowe opóźnienia w refreshMemberCache()** między serwerami
  - Zapobiega burst requestom do Gateway
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js` (linie 11-59, 417, 515, 9644-9646)
  - `StalkerLME/index.js` (linia 589)

**StalkerLME Bot - Fix: Missing getReminderUsage Method:**
- **FIX:** Naprawiono błąd `reminderUsageService.getReminderUsage is not a function`
- Problem: `ReminderStatusTrackingService` wywoływało nieistniejącą metodę `getReminderUsage()`
- Przyczyna: Metoda nie została zaimplementowana w `ReminderUsageService`
- Rozwiązanie: Dodano metodę `getReminderUsage(roleId)` która zwraca:
  - `todayCount` - liczba remind wysłanych dzisiaj dla klanu (0-2)
  - `todayUsage` - tablica z detalami użyć (timestamp, minutesToDeadline, sentBy)
- Używane przez: `ReminderStatusTrackingService.createOrUpdateTracking()` do określenia czy to pierwszy czy drugi remind dnia
- Lokalizacja: `StalkerLME/services/reminderUsageService.js` (linie 288-316)

**StalkerLME Bot - Naprawa Mapowania Użytkowników po Zmianie Nicku:**
- **FIX KRYTYCZNY:** Naprawiono `/clan-status` i `/player-status` - gracze po zmianie nicku Discord nie byli widoczni w rankingach
- Problem: Funkcja `createGlobalPlayerRanking()` używała `displayName` jako klucza zamiast `userId`
- Skutek: Gracz z rolą klanową, który zmienił nick Discord, nie pojawiał się w `/clan-status` mimo że miał dane OCR
- Rozwiązanie: Zmieniono klucz w mapie `playerMaxScores` z `displayName.toLowerCase()` na `userId`
- Dodano pole `userId` do struktury rankingu dla jednoznacznego wyszukiwania graczy
- `/player-status` - naprawiono wyszukiwanie pozycji w rankingu (używa `userId` zamiast porównywania nicków)
- Mechanizm teraz spójny z `/progres` - wszystkie trzy komendy mapują Discord ID → ostatni nick z danych OCR → aktualny klan
- Lokalizacja zmian: `StalkerLME/handlers/interactionHandlers.js` (funkcja `createGlobalPlayerRanking`, linie 8276-8352, 7512-7525)

**StalkerLME Bot - Naprawa Obliczania Progresu w /player-status:**
- **FIX:** Naprawiono brak wyświetlania linii "🔷 Dostępne dane (X tyg)" gdy najstarszy wynik gracza wynosił 0
- Problem: Kod porównywał najnowszy wynik z najstarszym (tydzień 40/25 = 0), więc warunek `comparisonScore > 0` nie był spełniony
- Skutek: Sekcja "📊 STATYSTYKI" nie pokazywała progresu kwartalnego mimo dostępnych danych (np. 9/12 tygodni)
- Rozwiązanie: Kod teraz szuka najstarszego wyniku **> 0** i porównuje z nim
- Przykład: Gracz z wynikami 51/25=547, 50/25=552, ..., 42/25=418, 40/25=0 → porówna 547 z 418 (pominie 0)
- Wyświetli: "🔷 Dostępne dane (9 tyg): ▲ 129 (30.9%)" zamiast braku tej linii
- Lokalizacja zmian: `StalkerLME/handlers/interactionHandlers.js` (linie 7765-7798)

**StalkerLME Bot - Nowa Komenda /player-raport:**
- **NOWA FUNKCJA:** Dodano komendę `/player-raport` dla administratorów i moderatorów
- Funkcjonalność: Generuje raport problematycznych graczy w wybranym klanie
- Workflow: Wybór klanu → analiza wszystkich członków → raport z graczy wymagających uwagi
- Kryteria problemu (wystarczy jedno):
  - 🔴 Rzetelność < 90% (wyjebanieFactor)
  - 🔴 Punktualność < 70% (timingFactor)
  - 🔴 Zaangażowanie < 70% (engagementFactor)
  - 🔴 Responsywność < 25% (responsivenessFactor)
  - 🪦 Trend gwałtownie malejący (trendRatio ≤ 0.5)
  - ⚠️ Progres miesięczny < 25 punktów
  - ⚠️ Progres kwartalny < 100 punktów
- Raport: Embed ephemeral z polami (każdy gracz osobno), sortowanie według liczby problemów
- Max 25 graczy w raporcie (limit Discord embed fields)
- Logika analizy używa tej samej matematyki co `/player-status`
- Lokalizacja: `StalkerLME/handlers/interactionHandlers.js` (funkcje: `handlePlayerRaportCommand`, `handlePlayerRaportSelectClan`, `analyzePlayerForRaport`, linie 9472-9957)

**StalkerLME Bot - Naprawa Obliczania Progresu - Najwyższy Wynik:**
- **FIX KRYTYCZNY:** Zmieniono logikę obliczania progresu miesięcznego, kwartalnego i z dostępnych danych
- Problem: Jeśli ostatni tydzień gracz dostał 0, pokazywało ogromny regres mimo dobrych wyników w poprzednich tygodniach
- Stara logika: Porównywała wynik z ostatniego tygodnia (może być 0) z wcześniejszym okresem
- Nowa logika: Porównuje **najwyższy wynik z okresu** z początkiem okresu
- Zmienione miejsca:
  - **Progres miesięczny:** Najwyższy z ostatnich 4 tygodni vs tydzień 5
  - **Progres kwartalny:** Najwyższy z ostatnich 12 tygodni vs tydzień 13
  - **Dostępne dane:** Najwyższy ze wszystkich dostępnych vs najstarszy wynik > 0
- Przykład: Gracz miał 51/25=547, 50/25=552, 49/25=0 → progres miesięczny: 552 (najwyższy) - 546 = +6 (zamiast 0 - 546 = -546)
- Dotyczy komend: `/progres`, `/player-status`, `/player-raport`
- Lokalizacja zmian:
  - `/player-status`: linie 7702-7816 (funkcja `handlePlayerStatusCommand`)
  - `/progres`: linie 7117-7168 (funkcja `showPlayerProgress`)
  - `/player-raport`: linie 9866-9943 (funkcja `analyzePlayerForRaport`)

**CLAUDE.md - Spis Treści z Numerami Linii:**
- Dodano szczegółowy spis treści z numerami linii dla każdej sekcji
- Tabela z kolumnami: Sekcja, Linia, Opis
- Hierarchiczny spis wszystkich 9 botów (linie 553-663)
- Przykłady użycia `Read` z `offset`/`limit` dla szybkiej nawigacji
- Oszczędność tokenów - Claude może czytać tylko potrzebne sekcje zamiast całego pliku

### Listopad 2025

**System Backup do Google Drive:**
- Dodano automatyczne backupy codzienne o 3:00 w nocy
- Dodano manualne backupy przez komendę `/backup`
- Integracja z Google Drive API
- Dwa foldery: `Polski_Squad_Backups` (automatyczne, 7 dni retencji) i `Polski_Squad_Manual_Backups` (permanentne)
- Szczegółowe logowanie błędów z klasyfikacją
- Automatyczne podsumowania na webhook po zakończeniu backupu
- Kompresja ZIP z poziomem 9 dla wszystkich folderów `data/` botów
- **FIX:** Automatyczne zapisywanie odświeżonych tokenów OAuth - zapobiega wygasaniu tokenów przy codziennych backupach

**StalkerLME Bot - System Kolejkowania i Faz:**
- Globalny system kolejkowania OCR - jeden użytkownik na raz per guild
- Komenda `/clan-status` - porównanie wyników między klanami
- Przyciski komend (Faza1, Faza2, Punish, Remind) w embedzie kolejki
- Progress bary z migającymi kratkami podczas przetwarzania OCR
- Dynamiczne timeouty sesji z auto-refresh przy kliknięciu przycisków
- Automatyczne wygasanie sesji po 15 minutach bezczynności
- Powiadomienia na kanały warning po zakończeniu fazy
- Restrykcje dostępu: `/progres` i `/wyniki` tylko dla członków klanu
- Przycisk manualnego wprowadzania danych przy konfliktach
- Optymalizacja: usunięcie schedulowanego czyszczenia plików temp (garbage collection automatyczny)
- Naprawa błędów Unknown Message przy anulowaniu sesji
- Naprawa interakcji timeout i deprecated API

**Muteusz Bot - Chaos Mode:**
- System Chaos Mode z polskim hymnem narodowym
- 5% szansa na otrzymanie roli chaos (przyznawana na stałe do wyłączenia mode)
- 10% szansa na odpowiedź bota dla użytkowników z rolą
- 20% szansa na wysłanie zwrotki hymnu (5 zwrotek + refren)
- Wsparcie dla wielu ról chaos jednocześnie
- Automatyczne usuwanie ról przy wyłączeniu chaos mode
- Persistent storage stanu w `data/chaos_mode.json`
- Weryfikacja użytkowników po restarcie bota

**Gary Bot:**
- Cotygodniowa zaplanowana analiza Lunar Mine (środa 18:45)
- Obsługa komend w wątkach kanałów whitelistowanych
- Wykrywanie wątków przez `parentId`

**Rekruter Bot:**
- RoleConflictService - automatyczne usuwanie ról rekrutacyjnych przy nadaniu roli klanowej
- Ulepszenia w logowaniu błędów (template strings zamiast multiple args)

**Konklawe Bot:**
- Gabriel blessing cooldown: 5 minut per cel (nieograniczone cele, ale nie może błogosławić tej samej osoby częściej niż co 5 min)
- Persistent storage blessing cooldowns w `data/gabriel_blessing_cooldowns.json`
- Naprawa restoracji timerów po restarcie bota
- Reset timerów gdy brak hasła lub brak podpowiedzi
- Ulepszenia w zarządzaniu stanem gry

**Ogólne Ulepszenia:**
- Ulepszenia w logowaniu błędów we wszystkich botach
- Obsługa Unknown Message errors przy usuwaniu wiadomości
- Naprawa timeoutów i deprecated Discord API
- Optymalizacja wydajności z garbage collection

---

### Styczeń 2025

**Gary Bot:**
- Dodano `/proxy-stats` do sprawdzania konfiguracji proxy
- Ulepszone formatowanie embedów z niestandardowymi emoji serwerowymi
- Naprawiono parsowanie kolumn dla poprawnego mapowania danych
- Publiczna paginacja - każdy może używać przycisków nawigacji
- Integracja Webshare API dla automatycznego odświeżania proxy

**Wszystkie Boty OCR:**
- Ulepszono system szczegółowego logowania z komendą `/ocr-debug`
- Dodano automatyczną rotację przetworzonych obrazów (max 400, 100/typ)
- Standaryzowane nazewnictwo plików dla łatwiejszego debugowania

**Centralny System Logowania:**
- Dodano inteligentne separatory między botami
- Zoptymalizowane logi startowe (jednoliniowe)
- Rate-limited logowanie Discord z kolejkowaniem

**Nickname Manager:**
- Ulepszone rozwiązywanie konfliktów dla nakładających się efektów
- Persistent storage w `shared_data/`
- Automatyczne czyszczenie wygasłych efektów

**StalkerLME Bot:**
- Dodano system faz Lunar Expedition
- Komendy `/faza1`, `/wyniki`, `/modyfikuj`
- Dekoder buildów Survivor.io z `/decode`

**Kontroler Bot:**
- Rola specjalna dla CX 2700+
- Ulepszone ostrzeżenia loterii (tylko Daily/CX)
- Automatyczna detekcja DST

---

**KONIEC DOKUMENTACJI**

Dla dalszych pytań lub aktualizacji, edytuj ten plik zgodnie ze zmianami w kodzie.
