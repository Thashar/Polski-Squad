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
- Po wprowadzeniu zmian w funkcjonalności bota ZAWSZE aktualizuj odpowiednią GŁÓWNĄ SEKCJĘ bota w CLAUDE.md
- **EDYTUJ istniejące opisy** funkcji zamiast dodawać nowe wpisy do "Historia Zmian"
- Główne sekcje botów (np. "⚔️ StalkerLME Bot", "⛪ Konklawe Bot") powinny zawierać AKTUALNY stan funkcjonalności
- Używaj Grep + Read z offset/limit + Edit - NIE czytaj całego pliku CLAUDE.md
- "Historia Zmian" służy TYLKO do ostatnich 30 dni - starsze wpisy usuń po przeniesieniu informacji do głównych sekcji
- To oszczędzi tysiące tokenów w przyszłych sesjach - kolejna instancja Claude będzie wiedziała jak działa kod bez czytania źródeł
- **PRZYKŁAD POPRAWNY**: Zmieniłeś system kolejkowania w StalkerLME → zaktualizuj sekcję "⚔️ StalkerLME Bot" punkt 5 "Kolejkowanie OCR"
- **PRZYKŁAD BŁĘDNY**: Dodałeś nowy wpis "StalkerLME Bot - Zmiana Kolejkowania" do "Historia Zmian" (TAK NIE ROBIĆ!)

**INSTRUKCJA AKTUALIZACJI LISTY KOMEND W MUTEUSZU:**
- Po dodaniu NOWEJ komendy lub aktualizacji istniejącej komendy w KTÓRYMKOLWIEK bocie ZAWSZE aktualizuj `Muteusz/config/all_commands.json`
- Ten plik jest używany przez komendę `/komendy` w Muteuszu do wyświetlania wszystkich dostępnych komend ze wszystkich botów
- Dodaj/zaktualizuj wpis w odpowiedniej sekcji bota z: name, description, usage, requiredPermission
- Zachowaj alfabetyczną kolejność komend w ramach danego bota
- Poziomy uprawnień: administrator, moderator, clan_member, achievement_role, special_role, public

**⚠️ INSTRUKCJA PERSISTENCJI DANYCH:**
- **ZAWSZE sprawdzaj czy nowa funkcjonalność przetrwa restart bota**
- Jeśli funkcja opiera się na zmiennych w pamięci RAM (Map, Set, Array, Object) → dane zostaną utracone po restarcie
- **ROZWIĄZANIA:**
  - **Persistencja w pliku JSON:** Zapisuj dane do pliku (np. `data/feature_state.json`) i wczytuj przy starcie
  - **Sprawdzanie historii:** Zamiast śledzenia w RAM, sprawdzaj historię (np. wiadomości w wątku, logi w bazie)
  - **Rekonstrukcja ze stanu Discord:** Pobieraj dane z Discord API przy starcie (np. aktywne wątki, role użytkowników)
- **PRZYKŁADY:**
  - ❌ **ŹLE:** `pingedThreads = new Set()` - po restarcie Set będzie pusty, wątki dostaną ping ponownie
  - ✅ **DOBRZE:** Sprawdzaj historię wiadomości w wątku - jeśli właściciel już pisał, nie pinguj ponownie
  - ✅ **DOBRZE:** `reminderStorage.saveReminders()` - przypomnienia zapisywane w JSON, wczytywane przy starcie
- **TEST:** Po implementacji funkcji zapytaj: "Co się stanie jeśli bot zrestartuje teraz?" → Jeśli funkcja przestanie działać prawidłowo = potrzebna persistencja

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
| └─ Kontroler Bot | 769 | OCR dwukanałowy (CX/Daily), loteria, Oligopoly |
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
6. **Kontroler Bot** - Dwukanałowa weryfikacja OCR + zaawansowana loteria z datami + system Oligopoly
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
**OCR - Dwa tryby:**
1. **Tradycyjny:** `services/ocrService.js` - Tesseract (PL+EN), preprocessing Sharp, ekstrakcja nick+atak
2. **AI OCR (opcjonalny):** `services/aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa analiza przez AI
   - Włączany przez `USE_AI_OCR=true` w .env
   - Używa tego samego modelu co StalkerLME AI Chat (domyślnie: Claude 3 Haiku)
   - Dwuetapowa walidacja (dwa osobne requesty do API):
     - **KROK 1 (pierwszy request):** Sprawdza czy jest "My Equipment" (50 tokenów)
       - Jeśli NIE - natychmiast zwraca błąd, NIE wysyła drugiego requestu
     - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "My Equipment" → wyciąga nick i atak (500 tokenów)
   - Zalety: 100% pewność walidacji, oszczędność tokenów przy złych screenach, niemożliwe fałszywe pozytywy

**Serwisy:**
- `memberNotificationService.js` - Śledzenie boostów, losowe gratulacje
- `roleMonitoringService.js` - Cron 6h, ostrzeżenia po 24h bez ról
- `roleConflictService.js` - Auto-usuwanie ról rekrutacyjnych gdy dostaje klanową

**Komendy:** `/ocr-debug`, `/nick`
**Env:** TOKEN, kanały (RECRUITMENT, CLAN0-2, MAIN_CLAN, WELCOME), role (CLAN0-2, MAIN_CLAN, VERIFIED, NOT_POLISH), USE_AI_OCR (opcjonalne), ANTHROPIC_API_KEY (opcjonalne)

---

### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → 24h przypomnienie → zamknięcie po 7 dniach (automatyczne, niezależnie od reakcji użytkownika)
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), 7-dniowe zamykanie PRZED sprawdzeniem threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
**Uprawnienia:**
- Admin/moderator/specjalne role → mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową → może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)
**Env:** TOKEN, CHANNEL_ID, PING_ROLE_ID, CLAN_ROLE_0, CLAN_ROLE_1, CLAN_ROLE_2, CLAN_ROLE_MAIN

---

### ⚔️ StalkerLME Bot

**7 Systemów:**
1. **Kary OCR** - `ocrService.js`: Tesseract, upscaling 3x, gamma 3.0, Levenshtein matching, wykrywanie 0
2. **Punkty** - `punishmentService.js`: 2pts=kara, 3pts=ban loterii, cron czyszczenie (pn 00:00)
3. **Urlopy** - `vacationService.js`: Przycisk → rola 15min, cooldown 6h
4. **Dekoder** - `decodeService.js`: `/decode` dla Survivor.io (LZMA decompress)
5. **Kolejkowanie OCR** - `queueService.js`: Jeden user/guild, progress bar, 15min timeout, przyciski komend
6. **Fazy Lunar** - `phaseService.js`: `/faza1` (lista), `/faza2` (3 rundy damage), `/wyniki` (TOP30), `/progres`, `/clan-status`, `/img` (dodaj zdjęcie tabeli do Fazy 2)
7. **AI Chat** - `aiChatService.js`: Mention @StalkerLME → pytania o graczy/statystyki/rankingi, Anthropic API (Claude 3 Haiku), cooldown 5min, **pamięć kontekstu 1h**, wykrywanie "mój/moje/mnie", dynamiczny progres z X tygodni, MVP

**Przypomnienia** - `reminderService.js`: DM z przyciskiem potwierdzenia, monitorowanie odpowiedzi DM (losowe polskie odpowiedzi, repost na kanały potwierdzenia), auto-cleanup po deadline
- **Tracking Potwierdzeń:** `reminderStatusTrackingService.js` - embed na kanale WARNING (nie CONFIRMATION) z godziną potwierdzenia obok nicku
- Format: `✅ NickName • 14:27` - pokazuje kiedy użytkownik potwierdził (oba przypomnienia w jednym embedzie)
- Struktura: `tracking.reminders[]` - tablica z obu przypomnieniami (reminderNumber, sentAt, users)
- Aktualizacja przez usunięcie i ponowne wysłanie embeda (świeża pozycja na dole czatu)

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
  - ⚠️ Progres miesięczny < 25 punktów (min 5 tygodni danych)
  - ⚠️ Progres kwartalny < 100 punktów (min 13 tygodni danych)
- Embed z polami: każdy gracz osobno, posortowani według liczby problemów
- Ephemeral (tylko dla wywołującego), max 25 graczy w raporcie

**Obliczanie Progresu** - Logika dla `/progres`, `/player-status`, `/player-raport`:
- **Progres miesięczny:** Najwyższy wynik z ostatnich 4 tygodni vs tydzień 5 (min 5 tygodni)
- **Progres kwartalny:** Najwyższy wynik z ostatnich 12 tygodni vs tydzień 13 (min 13 tygodni)
- **Dostępne dane:** Najwyższy ze wszystkich vs najstarszy wynik > 0
- Zapobiega fałszywym regresom gdy ostatni tydzień = 0

**Optymalizacje Wydajności:**
- **Cache indeksów:** `playerIndexCache` Map w DatabaseService (pierwsze wywołanie ~100ms, kolejne <1ms)
- **Throttling fetch:** `safeFetchMembers()` - 30s cooldown per guild, zapobiega rate limit Gateway (opcode 8)
- **Autocomplete timeout:** 2.5s protection z pustą odpowiedzią jako fallback

**Komenda /img i Przycisk "📷 Dodaj zdjęcie rankingu"** - Dodawanie zdjęć z tabelą wyników:
- Workflow: Wybór tygodnia (z listy wszystkich dostępnych) → Upload zdjęcia (1 min timeout) → Zapis do katalogu
- **Uprawnienia:** Tylko administratorzy i moderatorzy (allowedPunishRoles)
- **Detekcja klanu:** Automatyczna detekcja z roli użytkownika (admin/moderator musi mieć rolę klanową)
- **Dostępność:** Komenda `/img` + przycisk "📷 Dodaj zdjęcie rankingu" na embedzie kolejki OCR (drugi rząd przycisków)
- **NIE używa kolejki OCR:** Komenda nie korzysta z systemu kolejkowania OCR (działa niezależnie)
- **Dostępne tygodnie:** Lista wszystkich tygodni z zapisanymi wynikami (Faza 1 LUB Faza 2) dla wybranego klanu (max 25)
- **Logika agregacji:** Tygodnie z obu faz są łączone i deduplikowane, etykieta pokazuje które fazy są dostępne (F1, F2, F1+F2)
- Katalog: `data/ranking_images/guild_{guildId}/{year}/week-{weekNumber}_{clan}_table.{ext}`
- Nazewnictwo: `week-{weekNumber}_{clan}_table.{png|jpg|jpeg|webp|gif}`
- Obsługiwane formaty: PNG, JPG, JPEG, WEBP, GIF
- **Wyświetlanie:** Zdjęcie pojawia się automatycznie na dole embedu w `/wyniki` dla **wszystkich widoków** (Faza 1, Runda 1, 2, 3, Suma)
- Auto-usuwanie: Wiadomość użytkownika ze zdjęciem jest automatycznie usuwana po zapisie
- Message Collector: 1 minuta na przesłanie zdjęcia, walidacja typu pliku

**Wykresy z Ikonami Klanów** - `/progres` i `/player-status` wyświetlają ikony klanów przy każdym słupku:
- **Ikony klanów:** 🎮 (Clan 0), ⚡ (Clan 1), 💥 (Clan 2), 🔥 (Main)
- **Ikona pustego miejsca:** `<:ZZ_Pusto:1209494954762829866>` (custom emoji) - dla tygodni bez wyniku
- **Format wykresu:** `🎮 ██████░░░░ 51/25 - 547 ▲²⁵`
- **Logika:** Ikona wyciągana z pierwszego znaku `clanName` (np. "🎮PolskiSquad⁰🎮" → "🎮")
- **Implementacja:** `clanEmojiMap` - mapa weekKey → emoji klanu dla szybkiego dostępu

**Sekcja MVP w `/player-status`** - Tygodnie gdzie gracz był w TOP3 progresu:
- **Nazwa sekcji:** `### ⭐ MVP TYGODNIA`
- **Lokalizacja:** Pod sekcją "STATYSTYKI", przed "WSPÓŁCZYNNIKI"
- **Format:** `🥇 **51/25** - 1,547 (+125)` (medal, tydzień/rok, wynik, progres)
- **Medale:** 🥇 (1. miejsce), 🥈 (2. miejsce), 🥉 (3. miejsce)
- **Kolejność:** Od najnowszego do najstarszego tygodnia
- **Logika obliczania TOP3:**
  - Dla każdego tygodnia z ostatnich 12: sprawdza w jakim klanie użytkownik był
  - Buduje TOP3 TYLKO dla tego klanu (identycznie jak `/wyniki` pokazuje TOP3 dla wybranego klanu)
  - Dla każdego gracza z tego klanu: szuka NAJLEPSZEGO wyniku przed tym tygodniem
  - Oblicza progres = aktualny wynik - najlepszy historyczny wynik
  - Sortuje po progresie i wybiera TOP3
  - Sprawdza czy użytkownik jest w TOP3 swojego klanu
- **Spójność:** Używa tej samej metodologii co `/wyniki` - TOP3 per klan, porównanie z najlepszym historycznym wynikiem

**AI Chat** - System konwersacyjny z AI (mention @StalkerLME):
- **Trigger:** Mention @StalkerLME + pytanie (max 300 znaków)
- **Model:** Claude 3 Haiku (Anthropic API) - szybki, tani (~$0.0006 za pytanie)
- **Limity:**
  - Cooldown: 5 minut per użytkownik
  - **Administratorzy/moderatorzy:** Bez cooldownu (role MODERATOR_ROLE_1-4)
  - Persistent storage: `ai_chat_cooldowns.json`
- **Uprawnienia:** Tylko członkowie klanów (rola TARGET_ROLE_0/1/2/MAIN)
- **Kanały:** Wszystkie kanały na serwerze (bez ograniczeń)
- **Przykłady pytań:**
  - `@StalkerLME Porównaj mnie z @gracz`
  - `@StalkerLME Porównaj @gracz1 z @gracz2 i @gracz3` (max 5 graczy)
  - `@StalkerLME Jak wygląda mój progres?`
  - `@StalkerLME Kto jest najlepszy w moim klanie?`
  - `@StalkerLME Jakie mam statystyki?`
  - `@StalkerLME Powiedz coś o thashar` (wykrywa nick w pytaniu)
  - `@StalkerLME Porównaj thashar z @gracz` (nick + mention)
  - `@StalkerLME Jaki był mój progres z ostatnich 3 tygodni?` (dynamiczny okres)
- **Funkcjonalność:**
  - Wykrywanie typu pytania (compare, progress, ranking, stats, clan, general)
  - Wykrywanie nicków w pytaniu (case-insensitive, filtruje stop words)
  - **Rozpoznawanie pytań o siebie** ("mnie", "mój", "moje", "ja", "mojego", "moją") → zawsze używa danych pytającego
  - **Pobieranie WSZYSTKICH dostępnych danych gracza** z phase1/phase2 (bez limitu tygodni)
  - **Porównywanie graczy (max 5 graczy jednocześnie)** - logika inteligentna:
    - "Porównaj mnie z X" → porównuje PYTAJĄCEGO z graczem X
    - Jeśli są @mentions → dodaje WSZYSTKICH wspomnianych graczy
    - Jeśli wykryty nick w pytaniu → użyje tego gracza
    - Jeśli pytanie o siebie ("mnie") → użyje pytającego
    - Bot zawsze pobiera dane WSZYSTKICH wspomnianych graczy (do 5)
  - **Pytania o klany** - rankingi wszystkich 4 klanów (Main + Akademia 2/1/0), kontekst struktury klanów
  - **Dynamiczny progres** - "progres z ostatnich X tygodni" → oblicza progres z dokładnie tego okresu
  - **MVP** - tygodnie z największym osobistym progresem gracza (TOP 5)
  - **Współczynniki w porównaniach** - zaangażowanie (%), trend (🚀↗️⚖️↘️🪦), MVP
  - Odpowiedzi po polsku z emoji, dowcipne komentarze
  - Typing indicator podczas przetwarzania
  - **Zabezpieczenia przed halucynacjami:**
    - Kategoryczna instrukcja: "⛔ ABSOLUTNY ZAKAZ WYMYŚLANIA DANYCH ⛔"
    - Ostrzeżenia o limitach danych po każdej sekcji (np. "Masz TYLKO 5 graczy")
    - AI informuje gdy nie ma danych zamiast wymyślać ("Nie mam tych informacji w bazie")
    - Używa WYŁĄCZNIE faktów z dostarczonych danych phase1/phase2
- **Pamięć kontekstu rozmowy:**
  - AI pamięta poprzednie pytania i odpowiedzi w ramach sesji
  - **Timeout:** 1 godzina nieaktywności → reset kontekstu
  - **Limit historii:** Maksymalnie 5 ostatnich wymian (10 wiadomości)
  - **Przechowywanie:** W pamięci RAM (reset przy restarcie bota)
  - Przykład: `@StalkerLME Porównaj mnie z @gracz` → odpowiedź → `@StalkerLME A kto ma lepszy progres?` → AI pamięta kontekst
- **Graceful degradation:** Bot działa normalnie jeśli `ANTHROPIC_API_KEY` nie jest ustawiony (AI Chat wyłączony)
- **Persistent cooldowns:** Cleanup starych danych (>2 dni) przy starcie
- **ENV:** `ANTHROPIC_API_KEY` (opcjonalne), `STALKER_LME_AI_CHAT_MODEL` (opcjonalne, default: claude-3-haiku-20240307)

**Komendy:** `/punish`, `/remind`, `/punishment`, `/points`, `/decode`, `/faza1`, `/faza2`, `/wyniki`, `/img`, `/progres`, `/player-status`, `/clan-status`, `/clan-progres`, `/player-raport`, `/ocr-debug`
**Env:** TOKEN, MODERATOR_ROLE_1-4, PUNISHMENT_ROLE_ID, LOTTERY_BAN_ROLE_ID, TARGET_ROLE_0/1/2/MAIN, WARNING_CHANNEL_0/1/2/MAIN, CONFIRMATION_CHANNEL_0/1/2/MAIN, VACATION_CHANNEL_ID

---

### 🤖 Muteusz Bot

**8 Systemów:**
1. **Auto-Moderacja** - `autoModerationService.js`: Spam (3 duplikaty/30min=7d timeout), wulgaryzmy (progresja kar), zaproszenia Discord
2. **Cache Mediów** - `mediaService.js`: 100MB/plik, 2GB total, 24h retencja
3. **Zarządzanie Rolami** - `roleManagementService.js`: Ekskluzywne grupy (`special_roles.json`), auto-usuwanie konfliktów, 5s delay
4. **Naruszenia** - `warningsService.js`: Persistent JSON z UUID, reason, moderator, timestamp
5. **Koordynacja** - `roleKickingService.js`: Cron 2h, kick bez ról po 24h (integracja Rekruter)
6. **Chaos Mode** - `chaosService.js`: 5% szansa rola (permanent), hymn PL (5 zwrotek), 10% odpowiedź bota, multi-role support
7. **Losowe Odpowiedzi** - Virtutti Papajlari: 1/250 szansa, emoji PepeSoldier
8. **Guard Checky** - `index.js`: Flaga `isFullyInitialized` blokuje eventy podczas startu, zapobiega błędom "Klient Discord nie jest dostępny"

**Komendy:** `/remove-roles`, `/special-roles`, `/add-special-role`, `/remove-special-role`, `/list-special-roles`, `/violations`, `/unregister-command`, `/chaos-mode`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, TARGET_CHANNEL_ID, LOG_CHANNEL_ID

---

### 🏆 EndersEcho Bot

**4 Systemy:**
1. **OCR Wyników** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa walidacja
     - Włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
     - Używa tego samego modelu co StalkerLME AI Chat (domyślnie: Claude 3 Haiku)
     - Dwuetapowa walidacja (dwa osobne requesty do API):
       - **KROK 1 (pierwszy request):** Sprawdza czy jest "Victory" (50 tokenów)
       - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "Victory" → wyciąga nazwę bossa i wynik (500 tokenów)
     - Zalety: 100% pewność walidacji, oszczędność tokenów przy złych screenach, fallback na tradycyjny OCR
2. **Rankingi** - `rankingService.js`: Persistent JSON (userId_bossName), funkcje: add/update, getTop, remove
3. **Role TOP** - `roleManagementService.js`: 5 poziomów (top1, top2, top3-nieużywane, top4-10, top11-30), auto-update
4. **Paginacja** - `interactionHandlers.js`: 10/strona, przyciski nawigacji, 1h timeout

**Komendy:** `/update`, `/ranking`, `/remove`, `/ocr-debug`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, ALLOWED_CHANNEL_ID, USE_ENDERSECHO_AI_OCR (opcjonalne), ENDERSECHO_ANTHROPIC_API_KEY (opcjonalne), ENDERSECHO_ANTHROPIC_MODEL (opcjonalne)

---

### 🎯 Kontroler Bot

**4 Systemy:**
1. **OCR Dwukanałowy** - `ocrService.js`: CX (1500min, 0-2800/100, skip1, rola 2800+), Daily (910min, 0-1050/10, skip3, 2x nick), normalizacja znaków (o→0, z→2, l→1, sg→9)
2. **Loteria** - `lotteryService.js`: Daty (dd.mm.yyyy HH:MM), DST auto, multi-klan (server/main/0/1/2), cykle (0-365dni, max 24d), ostrzeżenia (90/30min), historia+przelosowanie, ban filter
3. **Dywersja w klanie** - `votingService.js`:
   - Trigger: Fraza "działasz na szkodę klanu" w odpowiedzi do użytkownika
   - Głosowanie: 15 minut (przyciski Tak/Nie), ping roli klanowej
   - Wynik: >50% TAK → rola Dywersanta 24h, remis → powtórka (max 3 razy)
   - Cooldown: 7 dni per użytkownik
   - **Persistencja:** 3 pliki JSON (active_votes.json, vote_history.json, saboteur_roles.json)
   - **Restart-safe:** Przywracanie timerów głosowań i usuwania ról po restarcie bota
4. **Oligopoly** - `oligopolyService.js`:
   - System zarządzania ID graczy pogrupowanych po klanach
   - Automatyczna detekcja klanu na podstawie roli użytkownika
   - Zabezpieczenie przed duplikatami ID
   - Aktualizacja wpisów (jeden wpis per użytkownik per klan)
   - **Persistencja:** `oligopoly.json` (userId, username, serverNickname, klan, id, timestamp)
   - **Komendy:** `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`

**Komendy:** `/lottery`, `/lottery-list`, `/lottery-remove`, `/lottery-history`, `/lottery-reroll`, `/lottery-debug`, `/ocr-debug`, `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`
**Env:** TOKEN, CLIENT_ID, GUILD_ID

---

### ⛪ Konklawe Bot

**7 Systemów:**
1. **Gra Hasłowa** - `gameService.js`: Hasło "Konklawe" (admin może zmienić), poprawna→rola papieska
2. **Osiągnięcia** - Medal Virtutti Papajlari: 30+ odpowiedzi, reset rankingu, specjalne uprawnienia
3. **Timery** - `timerService.js`: 15/30/60min przypomnienia, auto-reset, persistent (`game_state.json`), restore po restarcie
4. **System Many i Frakcji** - `virtuttiService.js`:
   - **Gabriel:** max 150 many, regeneracja 1pkt/10min, start z pełną maną
   - **Lucyfer:** max 100 many, regeneracja 10-30min/pkt (dynamiczna), start z pełną maną
   - Śledzenie ról użytkowników (`userRoles` Map), funkcja `getMaxEnergy(userId)`
5. **Klątwy i Błogosławieństwa** - 10 typów klątw (slow, delete, ping, emoji, caps, timeout, role, scramble, smart, blah):
   - **Gabriel:** `/curse` (10+klątwy×2 many, 85% sukces), `/blessing` (5 many, 50% usunięcie klątwy LUB ochrona 1h)
   - **Lucyfer:** `/curse` (5-15 many, 5min cd, progresywne odbicie +1% za klątwę)
   - **Admin (bez roli Gabriel/Lucyfer):**
     - `/curse` - Ultra potężna klątwa (cicha, 5min + 24h debuff, 10% trigger), 0 many, 0 cd, ephemeral only
     - `/blessing` - Usuwa WSZYSTKIE klątwy i debuffs (100% sukces, cicha), 0 many, 0 cd, ephemeral only
     - Nie może używać na innego admina
     - Tylko szczegółowe logowanie DetailedLogger (brak publicznych wiadomości)
   - **Revenge:** `/revenge` (50 many, 24h cd per cel, pułapka 24h) - Gabriel: odbicie 3x, Lucyfer: "Upadły" 1h
   - **Walidacja:** sprawdzanie przed rzuceniem czy cel już ma aktywną klątwę tego typu
   - **Nickname Manager:** 4 prefixy dla Lucyfera (Osłabiony, Uśpiony, Oszołomiony, Upadły)
6. **Virtue Check** - 10 cnót + porady (0 many)
7. **Losowe Odpowiedzi** - Użytkownicy papiescy: 1/100 szansa, emoji JP2roll

**Komendy:** `/podpowiedz`, `/podpowiedzi`, `/statystyki`, `/blessing`, `/curse`, `/revenge`, `/virtue-check`
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
# AI OCR (opcjonalne)
USE_AI_OCR=false
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-3-haiku-20240307

# ===== SZKOLENIA BOT =====
SZKOLENIA_DISCORD_TOKEN=bot_token_here
SZKOLENIA_CHANNEL_ID=channel_id
SZKOLENIA_PING_ROLE_ID=role_id
SZKOLENIA_CLAN_ROLE_0=role_id
SZKOLENIA_CLAN_ROLE_1=role_id
SZKOLENIA_CLAN_ROLE_2=role_id
SZKOLENIA_CLAN_ROLE_MAIN=role_id

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
# AI Chat (opcjonalne)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
STALKER_LME_AI_CHAT_MODEL=claude-3-haiku-20240307

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
# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ENDERSECHO_ANTHROPIC_MODEL=claude-3-haiku-20240307

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

# ===== GIT AUTO-FIX (ZALECANE DLA SERWERÓW PRODUKCYJNYCH) =====
# Automatyczna naprawa problemów z git przed startem botów
# UWAGA: Włączenie tej opcji wykona "git reset --hard origin/main" przy starcie
# Nadpisuje TYLKO śledzone pliki - nieśledzone pliki (data/, temp/, .env) pozostają nietknięte
# Rozwiązuje problem: "fatal: Need to specify how to reconcile divergent branches"
# ZALECANE dla serwerów produkcyjnych (Pterodactyl) gdzie nie można ręcznie naprawić git
AUTO_GIT_FIX=false

# ===== DISCORD WEBHOOK (OPCJONALNE) =====
DISCORD_LOG_WEBHOOK_URL=webhook_url_here
```

---

## Najlepsze Praktyki

1. **Optymalizacja** - Zobacz [🔥 OPTYMALIZACJA TOKENÓW](#optymalizacja-tokenów)
2. **Logowanie** - `utils/consoleLogger.js` - createBotLogger('NazwaBota'), NIGDY console.log
   - Dostępne metody: `logger.info()`, `logger.error()`, `logger.warn()`, `logger.success()`
   - **NIE MA:** `logger.debug()` - używaj `logger.info()` zamiast tego
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

### Styczeń 2026

**System Git Auto-Fix - Automatyczna Naprawa Divergent Branches:**
- **NOWA FUNKCJA:** Dodano automatyczny system naprawy problemów z git przed startem botów
- **Problem:** Serwer Pterodactyl wykonuje `git pull` ale nie może gdy są divergent branches (lokalne vs remote)
- **Rozwiązanie:**
  - Nowy moduł: `utils/gitAutoFix.js` - klasa GitAutoFix z metodami:
    - `isGitRepo()` - sprawdza czy folder to repozytorium git
    - `getStatus()` - pobiera status zmian lokalnych
    - `hasDivergentBranches()` - wykrywa rozbieżności między local i remote
    - `hardReset()` - wykonuje `git reset --hard origin/main` (BEZ `git clean`)
  - Integracja z `index.js` - auto-fix uruchamia się PRZED startem botów
  - Zmienna ENV: `AUTO_GIT_FIX=true/false` - włącza/wyłącza naprawę
- **Działanie:**
  1. Sprawdza czy folder to repo git
  2. Pobiera najnowsze zmiany z `origin` (`git fetch`)
  3. Wykrywa divergent branches (commits ahead/behind)
  4. Wykonuje hard reset do `origin/main` (nadpisuje TYLKO śledzone pliki)
  5. **Nieśledzone pliki pozostają nietknięte** (data/, temp/, .env)
- **Bezpieczeństwo:**
  - **NIE używa `git clean -fd`** - nie usuwa niesledzonych plików
  - Pliki danych botów (data/, temp/) są bezpieczne
  - Lokalne zmiany w .env są bezpieczne
  - Nadpisuje tylko pliki śledzone przez git (kod źródłowy)
- **Logowanie:**
  - Wszystkie operacje logowane przez `consoleLogger`
  - Informacje o liczbie commitów ahead/behind
  - Potwierdzenie że nieśledzone pliki są bezpieczne
- **Zalecane dla:**
  - Serwerów produkcyjnych (Pterodactyl, Docker, VPS)
  - Środowisk gdzie nie ma dostępu do konsoli
  - Automatycznych deploymentów CI/CD
- Lokalizacja zmian:
  - `utils/gitAutoFix.js` (nowy moduł)
  - `index.js:7,170-175` (import + integracja)
  - `.env:10-16` (zmienna AUTO_GIT_FIX)
  - `CLAUDE.md:1072-1078` (dokumentacja ENV)

**EndersEcho Bot - System AI OCR (Opcjonalny):**
- **NOWA FUNKCJA:** Dodano opcjonalny system analizy zdjęć wyników przez Anthropic API (Claude Vision)
- **Tryby OCR:**
  - **Tradycyjny:** Tesseract + preprocessing Sharp (domyślny)
  - **AI OCR:** Claude Vision API - włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
- **Implementacja:**
  - Nowy serwis: `EndersEcho/services/aiOcrService.js`
  - Używa tego samego modelu co StalkerLME AI Chat (domyślnie: Claude 3 Haiku)
  - Dwuetapowa walidacja (dwa osobne requesty do API):
    - **KROK 1 (pierwszy request):** Sprawdza czy jest "Victory" (50 tokenów)
      - Jeśli NIE znaleziono → NATYCHMIAST zwróć błąd, NIE wysyłaj drugiego requestu
    - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "Victory" → wyciąga nazwę bossa i wynik (500 tokenów)
  - Prompt KROK 1: `Znajdź na screenie frazę "Victory", jeżeli jej nie znajdziesz odpisz "Nie znaleziono frazy", jeżeli znajdziesz to "Znaleziono".`
  - Prompt KROK 2: `Odczytaj zawartość zdjęcia. Poniżej napisu "Victory" znajduje się nazwa Bossa. Poniżej nazwy bossa znajduje się wynik. Odczytaj nazwę bossa oraz dokładny wynik wraz z jednostką i napisz go w następującym formacie: <nazwa bossa> <wynik>`
- **Konfiguracja:**
  - `EndersEcho/config/config.js` - dodano `ocr.useAI` flag
  - `EndersEcho/handlers/interactionHandlers.js` - wybór metody OCR na podstawie flagi + fallback na tradycyjny OCR
  - Zmienne ENV: `USE_ENDERSECHO_AI_OCR` (true/false), `ENDERSECHO_ANTHROPIC_API_KEY`, `ENDERSECHO_ANTHROPIC_MODEL` (opcjonalny)
- **Workflow:**
  - Jeśli `USE_ENDERSECHO_AI_OCR=true` → zdjęcie wysyłane do Claude Vision
  - Jeśli AI OCR zawiedzie → automatyczny fallback na tradycyjny OCR (Tesseract)
  - Jeśli `USE_ENDERSECHO_AI_OCR=false` → tradycyjny OCR (Tesseract)
- **Zalety AI OCR:**
  - Lepsze rozpoznawanie nazw bossów i wyników z nietypowymi czcionkami
  - Inteligentne wykrywanie "Victory"
  - Nie wymaga preprocessingu obrazu
  - 100% pewność walidacji, oszczędność tokenów przy złych screenach
- Lokalizacja zmian:
  - `EndersEcho/services/aiOcrService.js` (nowy plik)
  - `EndersEcho/config/config.js:47` (useAI flag)
  - `EndersEcho/index.js:4,22,26` (import + inicjalizacja)
  - `EndersEcho/handlers/interactionHandlers.js:10,13,219-281` (konstruktor + logika wyboru OCR)
  - `CLAUDE.md:820-828,1044-1047` (dokumentacja)

**Rekruter Bot - FIX KRYTYCZNY: AI OCR - Dwuetapowa Walidacja "My Equipment":**
- **PROBLEM:** AI OCR wykrywało nick i atak nawet gdy zdjęcie nie zawierało tekstu "My Equipment"
- **Przykład błędu:** Użytkownik wrzucił złe zdjęcie → AI zwróciło "racza" / "1158788" mimo braku "My Equipment"
- **Przyczyna:** Jeden prompt nie wymuszał sprawdzenia "My Equipment" przed ekstrakcją danych
- **ROZWIĄZANIE:** Przepisano na dwuetapowy system z dwoma osobnymi requestami do API:
  - **KROK 1 (pierwszy request):** Prompt: `Znajdź na screenie napis "My Equipment", jeżeli znajdziesz napisz "Znalezniono", jeżeli nie znajdziesz napisz "Brak frazy".`
    - Jeśli odpowiedź NIE zawiera "znalezniono" → NATYCHMIAST zwróć błąd `INVALID_SCREENSHOT`, NIE wysyłaj drugiego requestu
  - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "My Equipment" → wysyła drugi prompt z pełną instrukcją ekstrakcji nicku i ataku
- **Zalety:**
  - 100% pewność że "My Equipment" jest sprawdzane NAJPIERW
  - Oszczędność tokenów API gdy screenshot jest niepoprawny (tylko 50 tokenów zamiast 500)
  - Niemożliwe jest wyciągnięcie danych z niepoprawnego screena
- Lokalizacja zmian:
  - `Rekruter/services/aiOcrService.js:37-144` (dwuetapowa analiza z dwoma requestami API)

**Rekruter Bot - Rozszerzenie Maksymalnych Punktów Lunar Mine Expedition:**
- **ZMIANA:** Maksymalna liczba punktów z I fazy Lunar Mine Expedition rozszerzona z 1500 na **5000**
- **Powód:** W grze możliwe jest uzyskanie wyższych punktów w Lunar Mine
- **Zmiany:**
  - Komunikat walidacji: "Podaj poprawną ilość punktów z I fazy Lunar Mine Expedition (0-5000)!"
  - Walidacja w `handleLunarPointsInput`: `pts > 1500` → `pts > 5000`
- Lokalizacja zmian:
  - `Rekruter/config/messages.js:12` (komunikat)
  - `Rekruter/handlers/messageHandlers.js:185` (walidacja)

**Rekruter Bot - FIX: AI OCR - Błąd "Image does not match media type":**
- **FIX KRYTYCZNY:** Naprawiono błąd 400 "Image does not match the provided media type image/png"
- **Problem:** Obrazy z Discord mogą być w formacie JPEG/WEBP, ale były wysyłane do API jako PNG tylko na podstawie rozszerzenia pliku
- **Rozwiązanie:**
  - Dodano konwersję obrazu na PNG przez `sharp` przed wysłaniem do Anthropic API
  - Dodano fallback na tradycyjny OCR gdy AI OCR zawiedzie (try-catch)
  - Użytkownik dostaje komunikat "⚠️ AI OCR niedostępny, używam tradycyjnego OCR..."
- **Implementacja:**
  - `sharp(imagePath).png().toBuffer()` - normalizacja formatu obrazu
  - Zawsze wysyłamy `mediaType: 'image/png'` z prawdziwym PNG buforem
- Lokalizacja zmian:
  - `Rekruter/services/aiOcrService.js:4,45-51` (import sharp + konwersja)
  - `Rekruter/handlers/messageHandlers.js:259-275` (try-catch + fallback)

**Rekruter Bot - Rozszerzenie Poziomów Lunar Mine Expedition:**
- **ZMIANA:** Zakres akceptowanych poziomów Lunar Mine Expedition rozszerzony z 1-12 na **1-16**
- **Powód:** W grze pojawiło się więcej poziomów trudności ekspedycji
- **Zmiany:**
  - Komunikat walidacji: "Podaj poprawny poziom Lunar Mine Expedition (1-16)!"
  - Walidacja w `handleLunarLevelInput`: `lvl > 12` → `lvl > 16`
- Lokalizacja zmian:
  - `Rekruter/config/messages.js:11` (komunikat)
  - `Rekruter/handlers/messageHandlers.js:156` (walidacja)

**Rekruter Bot - System AI OCR (Opcjonalny):**
- **NOWA FUNKCJA:** Dodano opcjonalny system analizy zdjęć rekrutacyjnych przez Anthropic API (Claude Vision)
- **Tryby OCR:**
  - **Tradycyjny:** Tesseract + preprocessing Sharp (domyślny)
  - **AI OCR:** Claude Vision API - włączany przez `USE_AI_OCR=true` w .env
- **Implementacja:**
  - Nowy serwis: `Rekruter/services/aiOcrService.js`
  - Używa tego samego modelu co StalkerLME AI Chat (domyślnie: Claude 3 Haiku)
  - Prompt: Wykrywa nick postaci (z prefixem), atak, oraz "My Equipment"
  - Zwraca błąd gdy brak "My Equipment" lub niepoprawny screen
- **Konfiguracja:**
  - `Rekruter/config/config.js` - dodano `ocr.useAI` flag
  - `Rekruter/handlers/messageHandlers.js` - wybór metody OCR na podstawie flagi
  - Zmienne ENV: `USE_AI_OCR` (true/false), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (opcjonalny)
- **Workflow:**
  - Jeśli `USE_AI_OCR=true` → zdjęcie wysyłane do Claude Vision
  - Jeśli `USE_AI_OCR=false` → tradycyjny OCR (Tesseract)
- **Zalety AI OCR:**
  - Lepsze rozpoznawanie nicków z nietypowymi czcionkami/prefixami
  - Inteligentne wykrywanie "My Equipment"
  - Nie wymaga preprocessingu obrazu
- Lokalizacja zmian:
  - `Rekruter/services/aiOcrService.js` (nowy plik)
  - `Rekruter/config/config.js:93` (useAI flag)
  - `Rekruter/handlers/messageHandlers.js:20,250-267` (import + wybór metody)
  - `CLAUDE.md:617-623,976-978` (dokumentacja)

**StalkerLME Bot - AI Chat: Porównywanie do 5 Graczy:**
- **ZMIANA:** Zwiększono limit porównywanych graczy z 2 do maksymalnie 5 jednocześnie
- **Problem:** Poprzednio AI pobierał dane tylko pierwszego wspominanego użytkownika (@mention), co uniemożliwiało porównanie więcej osób
- **Rozwiązanie:**
  - `context.mentionedUser` → `context.mentionedUsers` (tablica max 5 graczy)
  - Logika porównania iteruje przez wszystkich wspomnianych użytkowników (linie 597-641)
  - Dynamiczne ostrzeżenie w prompcie informuje AI o liczbie dostępnych graczy
- **Nowa funkcjonalność:**
  - Użytkownik może wspomnieć (@mention) do 5 graczy w pytaniu
  - AI otrzymuje dane wszystkich wspomnianych graczy
  - Przykład: `@StalkerLME Porównaj @gracz1 z @gracz2 i @gracz3`
- **Dodano do promptu systemowego:**
  - Sekcja "LIMITY PORÓWNAŃ" z informacją o maksymalnie 5 graczach
  - Zaktualizowano ostrzeżenia aby dynamicznie pokazywać liczbę dostępnych graczy
- **Zaktualizowano dokumentację:** CLAUDE.md - sekcja AI Chat, przykłady pytań
- Lokalizacja zmian:
  - `StalkerLME/services/aiChatService.js:231-263,596-641,553-566` (wykrywanie użytkowników, porównanie, prompt)
  - `CLAUDE.md:746,757` (dokumentacja i przykłady)

**StalkerLME Bot - AI Chat: Wzmocnione Zabezpieczenia Przed Halucynacjami:**
- **FIX KRYTYCZNY:** Naprawiono problem gdzie AI wymyślał statystyki graczy zamiast używać prawdziwych danych
- **Problem:** Użytkownik pytał o "więcej graczy" → AI wymyślał nazwiska (Piotrek, Ania, Kuba) i fałszywe wyniki
- **Rozwiązanie 1:** Kategoryczna instrukcja w prompcie "⛔ ABSOLUTNY ZAKAZ WYMYŚLANIA DANYCH ⛔"
- **Rozwiązanie 2:** Dodano ostrzeżenia o limitach danych po każdej sekcji:
  - Stats/Progress: "⚠️ LIMIT DANYCH: Masz dane TYLKO tego jednego gracza. NIE MA danych innych graczy - NIE wymyślaj!"
  - Compare: "⚠️ LIMIT DANYCH: Masz dane TYLKO tych X graczy do porównania (max 5). NIE MA więcej danych - NIE wymyślaj innych graczy!"
  - Ranking: "⚠️ LIMIT DANYCH: Masz TYLKO X graczy powyżej. NIE MA więcej danych - NIE wymyślaj innych graczy!"
- **Rozwiązanie 3:** Wzmocniona sekcja ZADANIE z jasnymi instrukcjami:
  - "Jeśli pytanie dotyczy danych których NIE MASZ - powiedz 'Nie mam tych informacji w bazie danych'"
  - "Jeśli użytkownik pyta o 'więcej graczy' a podałeś już wszystkich - powiedz 'To wszystkie dane które mam'"
  - "NIE wymyślaj nazwisk, wyników ani statystyk - używaj TYLKO faktów z sekcji 'DANE' powyżej"
- **Skutek:** AI teraz informuje gdy nie ma danych zamiast wymyślać fałszywe statystyki
- Lokalizacja zmian: `StalkerLME/services/aiChatService.js:527-547,575-576,623-624,633-636,639-644` (wzmocniony prompt)

**StalkerLME Bot - AI Chat: Rozszerzenie Funkcjonalności:**
- **ZMIANA:** Usunięto limit 12 tygodni - AI teraz pobiera **WSZYSTKIE dostępne dane gracza** z phase1/phase2
- **NOWA FUNKCJA:** Pytania o klany - AI ma dostęp do rankingów wszystkich 4 klanów jednocześnie:
  - Main Klan (🔥 główny klan) - najsilniejsi gracze
  - Akademia 2 (💥) - drugi poziom zaawansowania
  - Akademia 1 (⚡) - trzeci poziom zaawansowania
  - Akademia 0 (🎮) - klan dla początkujących
- **ZMIANA:** AI NIE porównuje z pytającym gdy pytanie dotyczy innego gracza
  - Wykrycie targetPlayer → instrukcja: "Pytanie dotyczy gracza X. NIE porównuj z użytkownikiem Y!"
  - Użytkownik pyta o INNEGO gracza → odpowiedź TYLKO o tego gracza, bez porównań
- **Przykłady nowych pytań:**
  - `@StalkerLME Który klan jest najlepszy?`
  - `@StalkerLME Porównaj Main z Akademią 2`
  - `@StalkerLME Ile punktów ma najlepszy gracz w każdym klanie?`
- Lokalizacja zmian: `StalkerLME/services/aiChatService.js:363,527-546,575-583,639-660` (wszystkie dane + klany + bez porównań)

**Kontroler Bot - Nowa Komenda /oligopoly-list:**
- **NOWA FUNKCJA:** Dodano komendę `/oligopoly-list` do generowania listy wszystkich członków klanu użytkownika
- **Funkcjonalność:**
  - Automatyczna detekcja klanu użytkownika na podstawie roli Discord
  - Pobiera WSZYSTKICH członków serwera z daną rolą klanową (nie tylko tych w systemie oligopoly)
  - Sortuje alfabetycznie po nicku serwera (`displayName`)
  - Wyświetla w formacie: `<@userId> PLㅣserverNickname` (prefix "PLㅣ" przed nickiem, używa `displayName`)
  - Dzieli listę po 10 osób na wiadomość (pierwsza wiadomość = nagłówek, kolejne = listy po 10)
- **Uprawnienia:** Wymaga roli klanowej (`clan_member`)
- **Workflow:**
  1. Użytkownik wpisuje `/oligopoly-list`
  2. Bot wykrywa rolę klanową użytkownika
  3. Bot pobiera wszystkich członków z tą rolą
  4. Bot sortuje alfabetycznie i dzieli po 10 osób
  5. Wysyła pierwszą wiadomość (editReply) z samym nagłówkiem
  6. Wysyła kolejne wiadomości (followUp, ephemeral) z listami po 10 osób każda
- **Format wiadomości:**
  - Pierwsza: `📋 **Lista członków klanu {nazwa}** ({liczba} osób)` (tylko nagłówek)
  - Kolejne: `<@userId> PLㅣNickname` (lista 10 osób, każda z prefixem "PLㅣ")
- **Zaktualizowano:**
  - `Kontroler/handlers/interactionHandlers.js` - dodano `handleOligopolyListCommand()`, case w switch, rejestrację komendy
  - `Muteusz/config/all_commands.json` - dodano komendę `/oligopoly-list`
  - `CLAUDE.md` - zaktualizowano sekcję Kontroler Bot (4 systemy zamiast 3, dodano system Oligopoly)
- Lokalizacja zmian:
  - `Kontroler/handlers/interactionHandlers.js:44-46,1319-1321,1841-1932` (handler, case, rejestracja)
  - `Muteusz/config/all_commands.json:259-263` (wpis komendy)
  - `CLAUDE.md:771,782,787-794` (dokumentacja)

**Kontroler Bot - System "Dywersja w klanie" - Persistencja i Wydłużenie Czasu Głosowania:**
- **ZMIANA:** Czas głosowania wydłużony z 5 minut na **15 minut**
- **NOWA FUNKCJA:** Pełna persistencja aktywnych głosowań - restart bota nie przerywa głosowań
- **Implementacja:**
  - Nowy plik `Kontroler/data/active_votes.json` - zapisuje wszystkie aktywne głosowania
  - Funkcje `loadActiveVotes()` i `saveActiveVotes()` - zarządzanie stanem głosowań
  - Automatyczne zapisywanie po: rozpoczęciu głosowania, oddaniu głosu, zakończeniu głosowania
  - Przywracanie timerów głosowań w `restoreTimers()` przy starcie bota
  - Konwersja Set → Array przy zapisie, Array → Set przy odczycie
- **Działanie po restarcie:**
  - Bot wczytuje aktywne głosowania z pliku przy starcie
  - Oblicza pozostały czas dla każdego głosowania
  - Jeśli głosowanie się już zakończyło → natychmiast kończy i liczy wyniki
  - Jeśli głosowanie wciąż trwa → przywraca timer na pozostały czas
  - Głosy oddane przed restartem są zachowane
- **Pliki JSON:** `active_votes.json`, `vote_history.json`, `saboteur_roles.json` (wszystkie persistent)
- Lokalizacja zmian: `Kontroler/services/votingService.js` (linie 30, 75, 115-134, 161-176, 265, 322, 422, 490-509)

**StalkerLME Bot - Embed Kolejki OCR: Nowe Przyciski + System Auto-Usuwania Raportów:**
- **ZMIANA NAZW PRZYCISKÓW:**
  - "Dodaj brakujące dane" → "Dodaj brakujący wynik"
  - "Modyfikuj dane" → "Modyfikuj wynik"
- **NOWY RZĄD PRZYCISKÓW (Row 3, niebieski):**
  - 📊 "Status klanów" → wywołuje `/clan-status`
  - 📈 "Progres klanów" → wywołuje `/clan-progres`
  - 🏆 "Wyniki klanów" → wywołuje `/wyniki`
- **NOWY RZĄD PRZYCISKÓW (Row 4, czerwony):**
  - 🔍 "Gracze o potencjalnie wysokim poziomie wypalenia" → wywołuje `/player-raport`
- **KOMENDA /player-raport - ZMIANY:**
  - Usunięto sprawdzanie "Responsywności" (responsivenessFactor) - nie jest już wyświetlane w raporcie
  - Embed NIE jest ephemeral - widoczny dla wszystkich
  - Auto-usuwanie embeda po 5 minutach (timer w pliku JSON)
  - Nagłówek: "🔍 Gracze o potencjalnie wysokim poziomie wypalenia"
- **NOWY SERWIS: RaportCleanupService:**
  - Zarządza automatycznym usuwaniem raportów po 5 minutach
  - Persistent timery w `StalkerLME/data/player_raport_deletions.json`
  - Sprawdzanie przy starcie bota - usuwa wygasłe raporty
  - Przywracanie timerów po restarcie bota
  - Podobny do MessageCleanupService z Konklawe
- **FIX KRYTYCZNY - Błąd inicjalizacji RaportCleanupService:**
  - **PROBLEM:** Bot nie startował - `The "path" argument must be of type string. Received undefined`
  - **Przyczyna:** `new RaportCleanupService(client, config.database.dataDir)` - dataDir był undefined
  - **ROZWIĄZANIE:** Zmieniono na `new RaportCleanupService(client, logger)` + `path.join(__dirname, '../data/...')`
  - **WAŻNA LEKCJA:** ZAWSZE używaj relatywnej ścieżki `path.join(__dirname, '../data/...')` zamiast `config.database.dataDir`
  - **Pattern do naśladowania:** Zobacz `MessageCleanupService` - używa tej samej metody
  - **Zapobieganie:** Przy tworzeniu nowego serwisu sprawdź jak inicjalizują się istniejące serwisy w tym samym bocie
- Lokalizacja zmian:
  - `StalkerLME/services/ocrService.js:1369-1398` (nowe przyciski)
  - `StalkerLME/handlers/interactionHandlers.js:1323-1340,10037-10201` (handlery, publiczny embed)
  - `StalkerLME/services/raportCleanupService.js` (nowy serwis)
  - `StalkerLME/index.js:17,41,71,83` (inicjalizacja)

**StalkerLME Bot - Zmiana Kolejności Klanów w Select Menu:**
- **ZMIANA:** Odwrócono kolejność klanów w menu wyboru - z (Clan 0, Clan 1, Clan 2, Main) na (Main, Clan 2, Clan 1, Clan 0)
- **Powód:** Lepsze UX - główny klan na górze listy
- **Dotyczy komend:**
  - `/clan-status` - Status obecności graczy w klanie
  - `/clan-progres` - Progres TOP30 dla klanu
  - `/player-raport` - Raport problematycznych graczy
- **Implementacja:** Dodano `.reverse()` do `Object.entries(config.targetRoles)`
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:8988,9401,10222` (reverse() w select menu)

**StalkerLME Bot - Auto-usuwanie Embeda /clan-progres:**
- **ZMIANA:** Embed z komendy `/clan-progres` jest teraz automatycznie usuwany po 5 minutach
- **Powód:** Zapobieganie zaśmiecaniu kanałów starymi raportami progresów
- **Integracja z RaportCleanupService:** Używa tego samego serwisu co `/player-raport`
- **Persistent timery:** Zaplanowane usunięcia przetrwają restart bota
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:9619-9627` (scheduleRaportDeletion po followUp)

**StalkerLME Bot - Dodano ikony klanów do wykresów i sekcję MVP w /player-status:**
- **NOWA FUNKCJA:** Wykresy w `/progres` i `/player-status` pokazują ikony klanów przed każdym słupkiem
- **Ikony klanów:** 🎮 (Clan 0), ⚡ (Clan 1), 💥 (Clan 2), 🔥 (Main)
- **Ikona pustego miejsca:** `<:ZZ_Pusto:1209494954762829866>` (custom emoji z serwera)
- **Format:** `🎮 ██████░░░░ 51/25 - 547 ▲²⁵` - ikona klanu pokazuje gdzie gracz osiągnął wynik
- **NOWA SEKCJA MVP:** `/player-status` wyświetla sekcję "⭐ MVP TYGODNIA" z tygodniami gdzie gracz był w TOP3 progresu
- **Format MVP:** `🥇 **51/25** - 1,547 (+125)` - medal (🥇🥈🥉), tydzień/rok, wynik, progres
- **FIX KRYTYCZNY 1:** Naprawa obliczania progresu - teraz porównuje z NAJLEPSZYM historycznym wynikiem (identyczna logika jak `/wyniki`)
- **Problem 1:** MVP porównywało z ostatnim chronologicznym wynikiem zamiast z najlepszym
- **Przykład błędu:** Gracz 564 → 0 → brak → brak → 476 = MVP +476 (vs 0), `/wyniki` -88 (vs 564)
- **FIX KRYTYCZNY 2:** Naprawa nadpisywania wyników w indeksie - teraz zapisuje NAJLEPSZY wynik z tygodnia
- **Problem 2:** Gdy gracz zmienił klan w tym samym tygodniu, ostatni wynik nadpisywał poprzednie (500→100)
- **FIX KRYTYCZNY 3:** TOP3 obliczany TYLKO dla klanu użytkownika - identycznie jak `/wyniki`
- **Problem 3:** MVP pokazywało TOP3 globalnie (wszystkie klany), `/wyniki` pokazywało TOP3 per klan
- **Rozwiązanie:** MVP teraz szuka klanu użytkownika w danym tygodniu i oblicza TOP3 tylko dla tego klanu
- Lokalizacja zmian: `StalkerLME/handlers/interactionHandlers.js:7690-7747,8502-8596,8767-8777` (ikony + MVP)

**Szkolenia Bot - FIX: Błąd logger.debug is not a function:**
- **PROBLEM:** Bot crashował przy każdej wiadomości w wątku z błędem `TypeError: logger.debug is not a function`
- **Przyczyna:** Użycie nieistniejącej metody `logger.debug()` (linie 125, 150)
- **Rozwiązanie:** Usunięto wywołania `logger.debug()` - logger ma tylko: `info()`, `error()`, `warn()`, `success()`
- **Instrukcja:** Dodano do "Najlepsze Praktyki" punkt 2 z listą dostępnych metod loggera
- **Zapobieganie:** ZAWSZE sprawdzaj dostępne metody przed użyciem - `utils/consoleLogger.js:344-365`
- Lokalizacja zmian: `Szkolenia/index.js:125,150` (usunięto logger.debug), `CLAUDE.md:966-967` (dokumentacja)

**Szkolenia Bot - FIX KRYTYCZNY: Naprawa Rate Limit Gateway (opcode 8):**
- **PROBLEM:** Bot przekraczał limit Discord Gateway przy każdej wiadomości w wątku
- **Przyczyna:** `guild.members.fetch()` pobierał WSZYSTKICH członków serwera przy KAŻDEJ wiadomości w wątku
- **Błąd:** `GatewayRateLimitError: Request with opcode 8 was rate limited. Retry after 25.754 seconds`
- **ROZWIĄZANIE:** Użycie `thread.ownerId` zamiast fetchowania i szukania po nazwie
- **Optymalizacja:** Właściciel wątku jest teraz pobierany z `message.channel.ownerId` (natywna właściwość Discord)
- **Skutek:** Eliminacja zbędnych wywołań API, brak rate limit, znacznie szybsze przetwarzanie wiadomości
- Lokalizacja zmian: `Szkolenia/index.js:99-109` (thread.ownerId zamiast guild.members.fetch)

**Szkolenia Bot - Nowy System Uprawnień i Automatyczny Ping Ról Klanowych:**
- **ZMIANA UPRAWNIEŃ:** Dodano dwupoziomowy system uprawnień do otwierania wątków
  - **Admin/moderator/specjalne role:** Mogą otworzyć wątek każdemu (reakcja N_SSS pod czyimkolwiek postem)
  - **Użytkownik z rolą klanową:** Może otworzyć wątek tylko sobie (reakcja N_SSS pod własnym postem)
- **NOWA FUNKCJA:** Automatyczny ping ról klanowych po pierwszej wiadomości właściciela wątku
  - Bot nasłuchuje pierwszą wiadomość od właściciela wątku (messageCreate event)
  - Wysyła wiadomość: "@właściciel prosi o pomoc! @rola1 @rola2 @rola3 @rola4"
  - Bot sprawdza historię wiadomości w wątku (ostatnie 100) i pinguje tylko przy pierwszej wiadomości właściciela
  - **Działa również po ponownym otwarciu wątku** - przy pierwszej wiadomości po odarchiwizowaniu znowu będzie ping
- **NOWA KONFIGURACJA:** Dodano 4 zmienne ENV dla ról klanowych
  - `SZKOLENIA_CLAN_ROLE_0`, `SZKOLENIA_CLAN_ROLE_1`, `SZKOLENIA_CLAN_ROLE_2`, `SZKOLENIA_CLAN_ROLE_MAIN`
  - Role używane zarówno do autoryzacji jak i do pingowania
- **Logika:** `reactionHandlers.js` sprawdza uprawnienia przed utworzeniem wątku
- **Handler:** `index.js` obsługuje messageCreate dla wykrywania pierwszej wiadomości właściciela (sprawdzanie historii zamiast Set)
- Lokalizacja zmian:
  - `Szkolenia/config/config.js:12-15,38-53,74-75` (nowe zmienne ENV, role clan, wiadomość ping)
  - `Szkolenia/handlers/reactionHandlers.js:34-46` (logika uprawnień)
  - `Szkolenia/index.js:90-139` (messageCreate handler ze sprawdzaniem historii)
  - `CLAUDE.md:623-628,880-883` (dokumentacja)

**EndersEcho Bot - FIX KRYTYCZNY: Naprawa Parsowania Jednostki Quintillion (Qi) + Ekstrakcja Nazwy Bossa:**
- **PROBLEM 1:** Bot błędnie rozpoznawał wyniki z jednostką Quintillion (Qi), pokazując "Nie pobito rekordu" mimo że wynik był wyższy
- **Przykład:** Wynik 102.8Qi (102,800Q) był porównywany jako mniejszy niż 73,449.6Q
- **Trzy błędy znalezione i naprawione:**
  1. **OCR charWhitelist** - Brak litery "i" w `charWhitelist` → OCR nie mógł rozpoznać "Qi"
  2. **Regex kolejność** - `([KMBTQ]|QI)?` dopasowywało tylko "Q" z "QI" → zmieniono na `(QI|[KMBTQ])?`
  3. **Klucz jednostki** - Klucz w `config.scoring.units` był `'Qi'` ale kod używał `toUpperCase()` i szukał `'QI'`
- **Rozwiązanie:**
  - Dodano "i" do `charWhitelist`: `'0123456789KMBTQi7.Best:Total '`
  - Zmieniono regex na `(QI|[KMBTQ])?` w `parseScoreValue()` i `getScoreUnit()`
  - Zmieniono klucz jednostki z `'Qi'` na `'QI'` w `config.scoring.units`
- **Skutek:** Teraz jednostki są poprawnie rozpoznawane: K→M→B→T→Q→QI

- **PROBLEM 2:** Nazwa bossa była pobierana nieprecyzyjnie (druga linia lub pierwsza jeśli druga ma cyfry)
- **NOWA LOGIKA:** `extractBossName()` szuka linii zawierającej "Victory" i bierze następną linię jako nazwę bossa
- **Fallback:** Jeśli nie znaleziono "Victory", używa starej logiki jako backup
- **Przykład:** "Bb Victory" (linia 1) → "Withervine Lord" (linia 2) = nazwa bossa

- **PROBLEM 3:** Progres wyświetlał "QI" (wielkie) zamiast "Qi" (małe i)
- **ROZWIĄZANIE:** `formatProgressInUnit()` konwertuje "QI" → "Qi" przed wyświetleniem
- **Przykład:** "(progres +29.35Qi)" zamiast "(progres +29.35QI)"

- **ULEPSZENIE:** Dodano nazwę bossa do embeda wyniku (bez pobicia rekordu)
- Pole "👹 Boss" wyświetlane między wynikiem a statusem
- Wyświetlane tylko gdy nazwa bossa została rozpoznana przez OCR
- **Przykład:** Gracz • 102.8Qi → 👹 Boss: Withervine Lord → ❌ Nie pobito rekordu

- Lokalizacja zmian:
  - `EndersEcho/config/config.js:42,77` (charWhitelist + units)
  - `EndersEcho/services/rankingService.js:52,95,105-124,268,339-368` (regex + formatProgressInUnit + createResultEmbed)
  - `EndersEcho/services/ocrService.js:383-460` (extractBossName - logika Victory)
  - `EndersEcho/handlers/interactionHandlers.js:267` (przekazanie bossName)

**StalkerLME Bot - Komenda /img - Osobny Katalog dla Zdjęć Rankingów:**
- **ZMIANA:** Zdjęcia rankingów są teraz zapisywane w dedykowanym katalogu `data/ranking_images/` zamiast w `data/phases/phase2/`
- **Powód:** Logiczne oddzielenie załączników od danych faz, łatwiejsze zarządzanie i backup
- **Nowa struktura:** `data/ranking_images/guild_{guildId}/{year}/week-{weekNumber}_{clan}_table.{ext}`
- **Stara struktura:** `data/phases/guild_{guildId}/phase2/{year}/week-{weekNumber}_{clan}_table.{ext}`
- **Zmienione miejsca:**
  - Zapisywanie zdjęć w `/img` (handleImgWeekSelect)
  - Odczytywanie zdjęć w `/wyniki` (showPhase2Results i showCombinedResults)
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:5090-5102,6815-6827,7182-7193` (imageDir zamiast phaseDir)
  - `CLAUDE.md:689` (dokumentacja katalogu)

**GLOBALNA NAPRAWA - Parsowanie Uszkodzonych Plików JSON:**
- **FIX KRYTYCZNY:** Naprawiono błędy parsowania JSON po incydencie ENOSPC (brak miejsca na dysku)
- **Problem:** Gdy serwer zabrakło miejsca, pliki JSON były zapisywane jako puste lub częściowo → błąd "Unexpected end of JSON input"
- **Rozwiązanie:** Dodano globalny helper `utils/safeJSON.js` z funkcjami:
  - `safeParse(data, defaultValue)` - bezpieczne parsowanie z walidacją pustych stringów i try-catch dla uszkodzonych danych
  - `safeReadJSON(filePath, defaultValue)` - bezpieczne wczytanie i parsowanie pliku
- **Naprawione boty i serwisy:**
  - **Wydarzynier:** lobbyService.js, timerService.js
  - **Rekruter:** roleMonitoringService.js
  - **Kontroler:** lotteryService.js
  - **Konklawe:** virtuttiService.js (16 plików JSON!)
  - **StalkerLME:** databaseService.js (wszystkie pliki faz)
  - **Muteusz:** wszystkie 10 serwisów (autoModeration, chaos, imageBlock, memberCache, reactionRole, roleConflict, roleKicking, roleManagement, specialRoles, warning, wordBlock)
- **Zachowanie:** Zamiast crashować, bot zwraca wartość domyślną (zwykle `{}`) i kontynuuje działanie
- Lokalizacja zmian:
  - `utils/safeJSON.js` (nowy helper)
  - Wszystkie serwisy wymienionych botów - zamieniono `JSON.parse()` na `safeParse()`

**StalkerLME Bot - Komenda /img - Skrócenie Timeout do 1 Minuty:**
- **ZMIANA:** Timeout na wrzucenie zdjęcia skrócony z 15 minut do 1 minuty (60000 ms)
- **Powód:** 15 minut było zbyt długim czasem oczekiwania, 1 minuta jest wystarczająca
- **Zmiany:**
  - Krok 2/2: "(1 minuta)" zamiast "(15 minut)"
  - Message collector: time 60000 ms zamiast 900000 ms
  - Komunikat timeout: "w ciągu 1 minuty" zamiast "w ciągu 15 minut"
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:5051,5060,5062,5145` (timeout + komunikaty)
  - `CLAUDE.md:682,694` (dokumentacja)

**StalkerLME Bot - Naprawa /img: Auto-Detekcja Klanu + Zmiana Nazwy Przycisku:**
- **FIX:** Przywrócono automatyczną detekcję klanu z roli użytkownika - **usunięto krok wyboru klanu** (workflow: 2 kroki zamiast 3)
- **Problem:** Poprzednia zmiana dodała manualny wybór klanu (Krok 1/3), co było niepotrzebne i nieergonomiczne
- **Rozwiązanie:** Bot automatycznie wykrywa klan użytkownika na podstawie jego roli klanowej (tak jak było pierwotnie)
- **Wymóg:** Admin/moderator **musi mieć** rolę klanową aby dodać zdjęcie (poprzednio: nie musiał)
- **Zmiana nazwy przycisku:** "📷 Dodaj zdjęcie" → "📷 Dodaj zdjęcie rankingu" (bardziej opisowa nazwa)
- **Workflow:** Wybór tygodnia (Krok 1/2) → Upload zdjęcia (Krok 2/2)
- **Usunięto funkcję:** `handleImgClanSelect()` - nie jest już potrzebna
- Lokalizacja zmian:
  - `StalkerLME/services/ocrService.js:1370,1565` (zmiana label przycisku)
  - `StalkerLME/handlers/interactionHandlers.js:4926-4943` (auto-detekcja klanu)
  - `StalkerLME/handlers/interactionHandlers.js:5022` (zaktualizowany tytuł embeda)
  - `CLAUDE.md:681-685` (dokumentacja workflow i detekcji klanu)

**StalkerLME Bot - Komenda /img - Przycisk na Embedzie Kolejki OCR + Rozszerzenie Uprawnień:**
- **NOWA FUNKCJA:** Dodano przycisk "📷 Dodaj zdjęcie" do embeda kolejki OCR (drugi rząd przycisków, emoji 📷, kolor zielony)
- **ZMIANA UPRAWNIEŃ:** Komenda `/img` teraz dostępna **tylko dla administratorów i moderatorów** (poprzednio: każdy z rolą klanową)
- **WYDŁUŻENIE TIMEOUT:** Czas na wrzucenie zdjęcia wydłużony z 30s do 15 minut (900000 ms) → później zmieniono na 1 minutę (60000 ms)
- **NIE używa kolejki OCR:** Komenda działa niezależnie od systemu kolejkowania OCR (nie blokuje innych komend)
- **Usunięto debug logging:** Usunięto verbose logowanie w handleImgCommand
- **Obsługa przycisku:** Nowy handler `queue_cmd_img` wywołuje `handleImgCommand()`
- Lokalizacja zmian:
  - `StalkerLME/services/ocrService.js:1369-1379,1563-1573` (przycisk w embedzie kolejki)
  - `StalkerLME/handlers/interactionHandlers.js:1304-1307` (obsługa przycisku)
  - `StalkerLME/handlers/interactionHandlers.js:5057,5077,5140` (timeout 1 min)
  - `CLAUDE.md:681-694` (dokumentacja)

**StalkerLME Bot - Komenda /wyniki - Wyświetlanie Zdjęć w Fazie 1:**
- **FIX:** Zdjęcie z tabelą wyników teraz wyświetla się wewnątrz embeda na dole dla **wszystkich widoków** (Faza 1, Runda 1, 2, 3, Suma)
- **Problem:** Poprzednio zdjęcie było wyświetlane tylko dla widoków Fazy 2 (Runda 1, 2, 3, Suma), w Fazie 1 nie było zdjęcia w embedzie
- **Rozwiązanie:** Usunięto warunek `isPhase2View` który ograniczał wyświetlanie zdjęcia tylko do Fazy 2
- **Mechanika:** Zdjęcie jest ładowane z katalogu `phase2/{year}/week-{weekNumber}_{clan}_table.{ext}` i dodawane jako attachment + `embed.setImage()`
- **Obsługiwane formaty:** PNG, JPG, JPEG, WEBP, GIF
- **Dokumentacja:** Zaktualizowano sekcję "Komenda /img" w CLAUDE.md (linia 690)
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:7180-7209` (usunięto warunek isPhase2View)
  - `CLAUDE.md:690` (dokumentacja wyświetlania)

**StalkerLME Bot - Komenda /img - Rozszerzenie Dostępnych Tygodni:**
- **ZMIANA:** Komenda `/img` teraz pokazuje **wszystkie tygodnie** z zapisanymi wynikami (Faza 1 LUB Faza 2) dla klanu użytkownika
- **Problem:** Poprzednio komenda wymagała aby tydzień miał zapisane wyniki Fazy 2, co uniemożliwiało dodanie zdjęcia dla tygodnia który ma tylko Fazę 1
- **Rozwiązanie:** Agregacja tygodni z obu faz (`getAvailableWeeks` + `getAvailableWeeksPhase2`), deduplikacja i sortowanie
- **Workflow:** Użytkownik widzi listę wszystkich dostępnych tygodni z etykietą pokazującą które fazy są zapisane (F1, F2, lub F1+F2)
- **Komunikat błędu:** Zmieniono z "Brak zapisanych wyników dla Fazy 2..." na "Brak zapisanych wyników... Użyj `/faza1` lub `/faza2`"
- **Dokumentacja:** Zaktualizowano sekcję "Komenda /img" w CLAUDE.md z nową logiką agregacji
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js:4941-5005` (agregacja tygodni z obu faz)
  - `CLAUDE.md:685-686` (dokumentacja dostępnych tygodni)

**Szkolenia Bot - Zmiana Schedulingu na Codziennie 18:00 + Naprawa Krytycznego Bugu:**
- **ZMIANA:** Sprawdzanie wątków zmieniono z co 60 minut → codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
- **ZMIANA:** Usunięto ograniczenie ról autoryzowanych - każdy może utworzyć wątek używając emoji N_SSS
- **FIX KRYTYCZNY:** Naprawiono bug gdzie wątki NIE były zamykane po 7 dniach gdy użytkownik zmienił nick Discord
  - **Problem:** Sprawdzenie threadOwner było PRZED sprawdzeniem 7 dni → gdy użytkownik zmienił nick, threadOwner=null → return (pominięcie wątku)
  - **Rozwiązanie:** Przeniesiono sprawdzenie 7 dni PRZED sprawdzenie threadOwner w `processThread()`
  - Wątki są teraz ZAWSZE zamykane po 7 dniach nieaktywności, niezależnie od zmiany nicku
- **Konfiguracja:** Dodano `checkHour` i `checkMinute` zamiast `checkIntervalMinutes`
- Lokalizacja zmian:
  - `Szkolenia/index.js:2,51-59` (node-cron import + scheduling)
  - `Szkolenia/config/config.js:53-54` (checkHour, checkMinute)
  - `Szkolenia/handlers/reactionHandlers.js:34` (usunięto sprawdzanie ról)
  - `Szkolenia/services/threadService.js:99-111` (zamknięcie 7 dni PRZED threadOwner check)

### Grudzień 2025

**Konklawe Bot - System Admin Curse i Admin Blessing:**
- **NOWA FUNKCJA:** Dodano moce dla administratorów bez roli Gabriel/Lucyfer
- **Admin Ultra Curse:**
  - Administrator używa `/curse` bez roli Gabriel/Lucyfer → ultra potężna klątwa (cicha operacja)
  - Mechanika: 5min początkowa klątwa + 24h debuff (10% szansa co wiadomość na nową klątwę)
  - Taka sama jak Gabriel → Lucyfer, ale cicha (tylko ephemeral confirmation)
  - 0 koszt many, 0 cooldown
  - Nie można użyć na innego admina
  - Szczegółowe logowanie przez `detailedLogger.logAdminCurse()`
- **Admin Blessing:**
  - Administrator używa `/blessing` bez roli Gabriel/Lucyfer → usuwa WSZYSTKIE klątwy i debuffs
  - Usuwa: aktywne klątwy, debuffs (Gabriel/admin), przywraca oryginalny nick
  - 100% skuteczność (nie ma 50% szansy jak Gabriel)
  - Cicha operacja (tylko ephemeral confirmation)
  - 0 koszt many, 0 cooldown
  - Nie można użyć na innego admina
  - Szczegółowe logowanie przez `detailedLogger.logAdminBlessing()` z listą usuniętych efektów
- **Wykrywanie roli admin:** `handleVirtuttiPapajlariCommand` sprawdza uprawnienia i ustawia `roleType='admin'`
- Lokalizacja zmian:
  - `Konklawe/handlers/interactionHandlers.js:711-728` (wykrywanie admina)
  - `Konklawe/handlers/interactionHandlers.js:1374-1429` (admin curse)
  - `Konklawe/handlers/interactionHandlers.js:761-821` (admin blessing)
  - `Konklawe/services/detailedLogger.js:344-382` (logAdminCurse, logAdminBlessing)
  - `CLAUDE.md:736-740` (dokumentacja admin mocy)

**Konklawe Bot - Zmiana Czasu Trwania Efektu /revenge:**
- **ZMIANA BALANSU:** Czas trwania efektu revenge (pułapki) wydłużony z 1h na 24h
- **Co się zmieniło:**
  - Efekt revenge na celu (pułapka) trwa teraz **24 godziny** (było 1h)
  - Cooldown pozostaje bez zmian: **24h** na tego samego gracza
  - Liczba użyć pozostaje bez zmian: Gabriel 3x odbicia, Lucyfer 1x "Upadły"
- **Przykład:** Gabriel użył `/revenge` na neutralnego użytkownika → pułapka aktywna przez 24h → jeśli Lucyfer przeklnie tego użytkownika w ciągu 24h, klątwa odbije się 3 razy
- Lokalizacja zmian:
  - `Konklawe/services/virtuttiService.js:1427,1448` (czas efektu: 24h)
  - `Konklawe/handlers/interactionHandlers.js:1886-1893` (usuwanie wiadomości: 24h)
  - `Konklawe/services/detailedLogger.js:337` (log: "24 godziny")

**Konklawe Bot - Dodano Szczegółowe Logowanie dla /revenge:**
- **NOWA FUNKCJA:** Dodano logowanie do DetailedLogger dla komendy `/revenge`
- **Nowa metoda:** `logRevenge(caster, roleType, cost, energyData)` w `detailedLogger.js`
- **Informacje w logu:**
  - Rzucający (Gabriel lub Lucyfer) z tagiem Discord
  - Koszt (50 many)
  - Pozostała mana po użyciu
  - Typ efektu (gabriel lub lucyfer)
  - Czas trwania (24h)
  - Cooldown (24h na tego samego gracza)
  - Cel: *Ukryty (efekt pułapkowy)* - nie ujawnia kto jest celem
- **Wywołanie:** W `handleRevengeCommand` po zaplanowaniu usunięcia wiadomości (linia 1897-1906)
- Lokalizacja zmian:
  - `Konklawe/services/detailedLogger.js:319-342` (nowa metoda)
  - `Konklawe/handlers/interactionHandlers.js:1897-1906` (wywołanie)

**Konklawe Bot - Kompleksowa Naprawa Systemu Regeneracji Many:**
- **FIX KRYTYCZNY:** Naprawiono wielokrotne problemy z regeneracją many:
  1. **Przekroczenie limitu (119/100)** - `loadData()` wczytywała dane bez walidacji
  2. **Podwójna regeneracja** - `getEnergy()` wywoływała zawsze `regenerateEnergy()` (Gabriel) nawet dla Lucyfera
  3. **Stary timestamp regeneracji** - przy naprawie energii nie aktualizowano `lastRegeneration`
  4. **Manualne wywołanie w handlerze** - `regenerateLucyferMana()` było wywołane 2x (handler + getEnergy)
  5. **Problem "cały czas 100/100"** - kombinacja problemów 2+3+4 powodowała natychmiastową regenerację do pełna

- **Rozwiązania:**
  - **Walidacja w loadData():** Sprawdza limity, naprawia przekroczenia, aktualizuje `lastRegeneration` i `lucyferData.lastRegeneration`
  - **Walidacja w saveData():** Dodatkowa warstwa bezpieczeństwa przed zapisem
  - **Inteligentny getEnergy():** Rozpoznaje rolę użytkownika i wywołuje odpowiednią funkcję regeneracji:
    - Lucyfer → `regenerateLucyferMana()` (dynamiczna 10-30min)
    - Gabriel/Virtutti → `regenerateEnergy()` (1 pkt/10min)
  - **Usunięto manualną regenerację:** Z `interactionHandlers.js` linia 1161 (duplikat wywołania)

- **Systemy regeneracji (rozdzielone):**
  - Gabriel: `userData.lastRegeneration`, `regenerateEnergy()`, 1 pkt/10min
  - Lucyfer: `lucyferData.lastRegeneration`, `regenerateLucyferMana()`, 1 pkt/10-30min (dynamiczne)

- Lokalizacja zmian:
  - `Konklawe/services/virtuttiService.js:156-167,1055-1083,1189-1196`
  - `Konklawe/handlers/interactionHandlers.js:1157-1164`

**Konklawe Bot - Naprawa Błędu Inicjalizacji MessageCleanupService:**
- **FIX KRYTYCZNY:** Naprawiono błąd `ERR_INVALID_ARG_TYPE: The "path" argument must be of type string. Received undefined`
- **Problem:** `config.dataDir` nie istniał w konfiguracji Konklawe, powodując crash przy starcie
- **Rozwiązanie:** Dodano `const path = require('path')` i przekazanie bezpośredniej ścieżki `path.join(__dirname, 'data')`
- Lokalizacja zmian: `Konklawe/index.js:2,84-85`

**Konklawe Bot - Naprawa Ghost Pingów w Klątwie Random Ping:**
- **FIX:** Klątwa Random ping teraz poprawnie usuwa wysłane pingi
- **Problem:** Stary system próbował usunąć "ostatnią wiadomość" co powodowało błędy gdy ktoś napisał coś w międzyczasie
- **Rozwiązanie:** Bot zapisuje messageId po wysłaniu i usuwa konkretnie tę wiadomość po 2 sekundach
- Dodano lepsze logowanie i obsługę błędów (ignoruje Unknown Message)
- Lokalizacja zmian: `Konklawe/handlers/interactionHandlers.js:2252-2265`

**Konklawe Bot - System Automatycznego Usuwania Wiadomości:**
- **NOWA FUNKCJA:** MessageCleanupService - automatyczne usuwanie wiadomości z klątwami/blessingami/revenge po zakończeniu efektu
- **Persistent storage** - system przetrwa restart bota i przywraca timery
- **Wiadomości klątw** - usuwane po zakończeniu klątwy (5/15/30min lub 1h zależnie od poziomu)
  - Zwykła klątwa: 5 min
  - Silna klątwa (Lucyfer): 15 min
  - Potężna klątwa (Lucyfer): 30 min
  - Mega silna klątwa (Gabriel→Lucyfer): 1h zmiana co 5min
  - Odbicie Lucyfera (progresywne): 1h blokada
  - Odbicie Gabriela: czas klątwy (5 min)
- **Wiadomości blessing** - usuwane po 10 minutach
- **Wiadomości virtue-check** - usuwane po 10 minutach
- **Wiadomości revenge** - usuwane po 1 godzinie (czas trwania efektu)
- **Auto-cleanup przy starcie** - usuwa wiadomości które już wygasły podczas offline bota
- **Struktura danych:** `Konklawe/data/scheduled_message_deletions.json`
- Lokalizacja zmian:
  - `Konklawe/services/messageCleanupService.js` (nowy serwis)
  - `Konklawe/index.js:14,33,83,114-119` (inicjalizacja)
  - `Konklawe/handlers/interactionHandlers.js:11,21` (konstruktor)
  - `Konklawe/handlers/interactionHandlers.js:937-951,1063-1074,1227-1241,1300-1314,1416-1432,1617-1631,1882-1895` (integracja)

**Konklawe Bot - Naprawa Mechaniki Błogosławieństwa:**
- **FIX KRYTYCZNY:** Blessing jest teraz jednorazowy - jeśli użyty do próby usunięcia klątwy, NIE daje ochrony
- **Nowa logika:**
  - Cel MA klątwę → 50% szansa usunięcia → Blessing ZUŻYTY (bez ochrony na przyszłość)
  - Cel NIE MA klątwy → Ochrona 1h (50% szansa blokowania następnej klątwy)
- **Problem:** Stary system dawał ochronę zawsze, niezależnie od tego czy blessing był użyty do usunięcia klątwy
- **Skutek:** Gracze dostawali podwójną korzyść - próba usunięcia klątwy + ochrona na przyszłość
- Dodano komunikat "Próba usunięcia klątwy nie powiodła się..." gdy 50% się nie uda
- Zaktualizowano embedy Sądu Bożego z nowym opisem blessingu
- Lokalizacja zmian:
  - `Konklawe/handlers/interactionHandlers.js:875,879,899-903,942-948` (logika blessing)
  - `Konklawe/services/judgmentService.js:101,355` (embedy z opisami)

**Konklawe Bot - Wydłużenie Regeneracji Many:**
- **Gabriel:** Regeneracja wydłużona dwukrotnie - 1 pkt/10min (było 1 pkt/5min)
- **Lucyfer:** Dynamiczna regeneracja wydłużona dwukrotnie - 10-30 min/pkt (było 5-15 min/pkt)
  - Bazowy czas: 10 min (było 5 min)
  - Maksymalny czas (ten sam cel): 30 min (było 15 min)
  - Minimalny czas (różne cele): 10 min (było 5 min)
- Zaktualizowano embedy Sądu Bożego (oba warianty) z nowymi wartościami regeneracji
- Lokalizacja zmian:
  - `Konklawe/services/virtuttiService.js:119,129,134,644,695,699` (logika regeneracji)
  - `Konklawe/services/judgmentService.js:99,119,353,364` (embedy z opisami)

**Wydarzynier Bot - Naprawa Obsługi Błędu Unknown Message:**
- **FIX:** Dodano obsługę błędu `DiscordAPIError[10008]: Unknown Message` w komendzie `/party-close`
- Problem: Gdy interakcja wygasała (użytkownik czekał za długo), bot wyrzucał błędy mimo że lobby zostało pomyślnie zamknięte
- Rozwiązanie: Trójpoziomowa obsługa błędu Unknown Message (kod 10008)
  - Try-catch wokół `editReply` po zamknięciu lobby
  - Sprawdzanie kodu błędu i informacyjne logowanie zamiast błędów
  - Komunikat: `ℹ️ Lobby zamknięte pomyślnie (interakcja wygasła)`
- Teraz lobby jest zawsze prawidłowo zamykane, a użytkownik nie widzi strasznych błędów w logach
- Lokalizacja zmian: `Wydarzynier/handlers/interactionHandlers.js:1003-1039`

**Konklawe Bot - System Revenge i Ochrony Błogosławieństw:**
- **Dodano komendę `/revenge`** (Gabriel/Lucyfer, koszt 50 many, cooldown 24h per cel)
  - Gabriel: Cel dostaje efekt - Lucyfer rzucając `/curse` = odbicie 3x
  - Lucyfer: Cel dostaje efekt - Gabriel używając `/blessing` = "Upadły" 1h + blokada
  - Komunikat ephemeral (cel ukryty) + publiczny hint ("Gabriel/Lucyfer przygotowuje zemstę...")
  - Nie można użyć na siebie, na przeciwną frakcję (G→L, L→G), ani gdy cel już ma ten sam typ revenge
- **System ochrony błogosławieństw** - każdy użytkownik `/blessing` dostaje ochronę (1h, 50% szansa)
  - Przy rzuceniu klątwy przez Lucyfera: 50% szansa na zablokowanie klątwy
  - Komunikat: "✨🛡️ BŁOGOSŁAWIEŃSTWO OCHRONIŁO! 🛡️✨"
- **Nowy typ FALLEN w NicknameManager** - prefix "Upadły " (Gabriel po revenge Lucyfera)
  - Dodano do `isEffectNickname()` i `getCleanNickname()`
- **Revenge_gabriel:** Lucyfer rzuca `/curse` → klątwa odbija się na Lucyfera (3 użycia, 1h)
- **Revenge_lucyfer:** Gabriel używa `/blessing` → Gabriel dostaje "Upadły" + blokada 1h (1 użycie)
- **Struktury danych** (VirtuttiService):
  - `revengeEffects` - Map(targetId → [{type, remainingUses, expiresAt, appliedBy}])
  - `revengeCooldowns` - Map(userId → Map(targetId → timestamp))
  - `blessingProtection` - Map(userId → {expiresAt, used})
  - `gabrielBlessingBlocked` - Map(userId → {expiresAt})
- **Zaktualizowano embed Sądu Bożego** - dodano informacje o revenge i ochronie błogosławieństw
- **Zaktualizowano `/komendy` w Muteuszu** - dodano `/revenge` do all_commands.json
- Lokalizacja zmian:
  - `Konklawe/services/virtuttiService.js` (nowe funkcje: 1266-1534, loadData/saveData)
  - `Konklawe/handlers/interactionHandlers.js` (handleRevengeCommand: 1689-1803, triggers: 816-850, 1502-1541)
  - `Konklawe/services/commandService.js` (rejestracja /revenge: 46-52)
  - `Konklawe/services/judgmentService.js` (embedy: 97-146, 362-407)
  - `utils/nicknameManagerService.js` (FALLEN: 183, 210)
  - `Muteusz/config/all_commands.json` (468-473)

**Konklawe Bot & Nickname Manager - Nicki Lucyfera i Naprawa Nakładania Efektów:**
- **Dodano czwarty nick dla Lucyfera: "Oszołomiony"** - gdy rzuca klątwę na administratora
- **Możliwe nicki Lucyfera:**
  - "Osłabiony [nick]" - normalna klątwa (5/15/30 min)
  - "Uśpiony [nick]" - progresywne odbicie (blokada 1h)
  - "Oszołomiony [nick]" - odbicie od admina
- **Naprawiono problem nakładania efektów** - gdy użytkownik dostaje drugi efekt podczas aktywnego pierwszego:
  - `getCurrentServerNickname()` teraz czyści prefixy PRZED zapisaniem jako oryginalny nick
  - Zapobiega problemowi gdzie po zakończeniu drugiego efektu nick wracał do pierwszego zmienionego zamiast do oryginału
- **Rozszerzono `applyNicknameCurse()`** - dodano parametr `customPrefix` do wyboru niestandardowego prefixu
- Dodano "Oszołomiony" do `getCleanNickname()` i `isEffectNickname()` w NicknameManager
- Lokalizacja zmian:
  - `utils/nicknameManagerService.js:161-170,182,192,208` (getCurrentServerNickname, isEffectNickname, getCleanNickname)
  - `Konklawe/handlers/interactionHandlers.js:2469,2490-2503,1457-1466` (applyNicknameCurse, logika "Oszołomiony")

**Konklawe Bot - Balans Systemu Many:**
- **Gabriel: max 150 many** (było 300) - Start z pełną maną, regeneracja 1 pkt/10min (było 1 pkt/5min)
- **Lucyfer: max 100 many** (było 300) - Start z pełną maną, dynamiczna regeneracja 10-30 min/pkt (było 5-15 min/pkt)
- **Bonus po blokadzie odbicia: 25 many** (było 50) dla Lucyfera
- Dodano system śledzenia ról użytkowników (`userRoles` Map)
- Nowa funkcja `getMaxEnergy(userId)` która zwraca odpowiedni limit (150/100)
- Zaktualizowano wszystkie funkcje energetyczne aby używały dynamicznego maxEnergy
- Zaktualizowano wywołania `getEnergy()` aby przekazywały roleType
- Zaktualizowano dokumentację w embedach Sądu Bożego (oba embedy)
- Lokalizacja zmian:
  - `Konklawe/services/virtuttiService.js:14-15,58-101,104-123,135-161,181-199,206-215,510-522,645-663,704-723`
  - `Konklawe/handlers/interactionHandlers.js:793,886,1076,1330,1406,1506`
  - `Konklawe/services/judgmentService.js:100,123,131,360,379,387`

**Konklawe Bot - Skrócenie Komunikatu Odbicia od Admina:**
- **Usunięto fragment "Siły ciemności nie zagrażają serwerowi!"** z komunikatu odbicia klątwy Lucyfera przez admina
- Komunikat zmieniono z: `🔥 **O nie! Klątwa została odbita i wzmocniona przez co Lucyfer mocno osłabł! Siły ciemności nie zagrażają serwerowi!**`
- Na: `🔥 **O nie! Klątwa została odbita i wzmocniona przez co Lucyfer mocno osłabł!**`
- Lokalizacja zmian: `Konklawe/handlers/interactionHandlers.js:1488`

**Konklawe Bot - Optymalizacja Aktualizacji Embeda Sądu Bożego:**
- **Inteligentne aktualizacje embeda** - bot sprawdza zawartość przed aktualizacją przy starcie
- Jeśli embed nie zmienił się - pozostawia istniejący (nie usuwa i nie wysyła ponownie)
- Jeśli embed się zmienił - usuwa stary i wysyła nowy
- Porównuje: title, description, wszystkie fields (name, value, inline)
- Nowa funkcja `compareEmbeds()` w `JudgmentService`
- Logi: `ℹ️ Embed bez zmian` lub `✅ Utworzono nowy embed`
- Lokalizacja zmian: `Konklawe/services/judgmentService.js:32-57,146-189`

**Konklawe Bot - Balans Progresywnego Odbicia:**
- **Zmniejszono bonus many po odbiciu klątwy** - z 100 na 50 many
- Dotyczy tylko Lucyfera przy progresywnym odbiciu klątwy (blokada 1h + nick "Uśpiony")
- Komunikat przy bezpośrednim rzuceniu Gabriela na Lucyfera pozostał "osłabiony"
- Komunikat przy odbiciu klątwy Lucyfera pozostał "uśpiony"
- Zaktualizowano:
  - `virtuttiService.js` - funkcja `grantLucyferBlockEndBonus()` (linia 483)
  - `interactionHandlers.js` - komentarz bonusu (linia 1330)
  - `judgmentService.js` - dwa miejsca w opisie roli Lucyfera (linie 107, 340)
- Lokalizacja zmian: `Konklawe/services/virtuttiService.js:472-486`, `Konklawe/handlers/interactionHandlers.js:1330`, `Konklawe/services/judgmentService.js:107,340`

**StalkerLME Bot - Ulepszenia Systemu Trackingu Potwierdzeń:**
- **Usunięto osobne wiadomości potwierdzenia** - zamiast wysyłać `✅ @user potwierdził odbiór...`, tylko aktualizowany jest embed
- **Godzina potwierdzenia obok nicku** - format: `✅ NickName • 14:27` (pokazuje kiedy użytkownik potwierdził)
- **Nowa struktura danych** - tracking przechowuje tablicę `reminders[]` zamiast pojedynczego obiektu
- **Jeden embed dla obu przypomnień** - format embeda:
  ```
  📊 Status potwierdzeń przypomnienia

  Przypomnienie 1/2 • Wysłano 3 godziny temu
  ✅ User1 • 14:27
  ❌ User2
  ✅ User3 • 14:30
  📈 2/3 potwierdzonych

  Przypomnienie 2/2 • Wysłano 2 godziny temu
  ✅ User1 • 16:15
  ❌ User2
  ✅ User3 • 16:20
  📈 2/3 potwierdzonych
  ```
- **Drugi remind NIE usuwa pierwszego embeda** - tylko edytuje go i dodaje nową sekcję
- **Struktura tracking:**
  ```javascript
  {
    messageId: "...",
    channelId: "...",
    reminders: [
      {
        reminderNumber: 1,
        sentAt: timestamp,
        users: {
          userId: { displayName, confirmed, confirmedAt }
        }
      }
    ]
  }
  ```
- **Kanał wysyłania zmieniony** - embed trafia na kanał ostrzeżeń (WARNING_CHANNEL) zamiast CONFIRMATION_CHANNEL
  - Teraz embed jest widoczny tam gdzie lądują przypomnienia o bossie
- **Aktualizacja embeda przez usunięcie i ponowne wysłanie** - zamiast edytować istniejący embed, bot usuwa stary i wysyła nowy
  - Embed zawsze jest na dole czatu (świeża pozycja)
  - Nowy messageId zapisywany po każdej aktualizacji
- Lokalizacja zmian:
  - `StalkerLME/handlers/interactionHandlers.js` (linia 9534-9543: usunięto wysyłanie wiadomości, dodano timestamp)
  - `StalkerLME/services/reminderStatusTrackingService.js` (przepisano całą strukturę trackingu, zmiana kanału, logika delete+send)

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

**Konklawe Bot - Rozwinięcie Sądu Bożego dla Nowych Graczy:**
- **Rozbudowano opisy obu frakcji** - szczegółowe wyjaśnienia mechanik z wyraźnymi sekcjami
- **Struktura z nagłówkami:** ⚡ SYSTEM MANY | ✨/🔥 MOCE | ⚠️ SŁABOŚCI | 💀 POZIOMY KLĄTW
- **Gabriel (✨ MOCE):**
  - 🙏 `/blessing` (5 many): 50% usunięcie klątwy + ochrona celu (1h, 50% block następnej)
  - 💀 `/curse` (10+(klątwy×2) many): Zwykła klątwa (5min), 85% sukces, koszt rośnie
  - ⚔️ `/revenge` (50 many, 24h cd): Pułapka na neutralnych - gdy Lucyfer przeklnie → odbicie 3x
  - 🔍 `/virtue-check` (0 many): Sprawdź cnotę
- **Gabriel (⚠️ SŁABOŚCI):**
  - 15% fail rate przy curse
  - Blessing nie działa na Lucyfera
  - Revenge Lucyfera → "Upadły" (blessing block 1h)
- **Gabriel (💀 POZIOMY KLĄTW):**
  - **Zwykła (100%):** 5 min, 1 efekt losowy z 10 typów
  - **Mega silna (33% na Lucyfera):** Blessing → 1h, zmiana efektu co 5 min
  - **Ultra potężna (1% na Lucyfera):** Curse → 5 min + debuff 24h (10% co 5 min nowy efekt)
- **Lucifer (🔥 MOCE):**
  - 💀 `/curse` (5-15 many, 5min cd): Koszt dynamiczny
  - ⚔️ `/revenge` (50 many, 24h cd): Pułapka na neutralnych - gdy Gabriel błogosławi → "Upadły" (blessing block 1h)
  - 🔍 `/virtue-check` (0 many): Sprawdź cnotę
- **Lucifer (⚠️ SŁABOŚCI):**
  - 📈 Progresywne odbicie: +1% za klątwę, przy odbiciu reset + blokada 1h + "Uśpiony"
  - 100% odbicie klątwy od Gabriela
  - ⛔ Brak blessingu
- **Lucifer (💀 POZIOMY KLĄTW):**
  - **Zwykła (96%):** 5 min, 1 efekt losowy z 10 typów
  - **Silna (3%):** 15 min, 1 efekt losowy z 10 typów
  - **Potężna (1%):** 30 min, 1 efekt losowy z 10 typów
- **10 typów efektów klątw:**
  1. ⏰ Slow (30s cd między wiadomościami)
  2. 🗑️ Delete (30% szansa usunięcia)
  3. 📢 Ping spam (bot pinguje losowo)
  4. 😀 Emoji spam (30% szansa reakcji emoji)
  5. 📝 CAPS (bot przepisuje CAPSEM)
  6. 💤 Timeout (30% czasu na timeoucie)
  7. 🎭 Special role (specjalna rola na czas klątwy)
  8. 🔤 Scramble (30% mieszanie liter w słowach)
  9. 🤫 Smart (30% usuwa wiadomość + "nie mądruj się")
  10. 💬 Blah (30% odpowiedź losowym GIFem "blah blah")
- **FIX:** Skrócono opisy aby zmieścić się w limicie Discord (Gabriel: ~650 znaków, Lucifer: ~650 znaków)
  - Usunięto zbędne słowa ("Rzuca klątwę", "Sprawdź cnotę użytkownika")
  - Skrócono nazwy (SYSTEM MANY → MANA, "efekt losowy z 7 typów" → "1 z 7 efektów")
  - Zastosowano skróty (sukces ↓, fail ↑)
- Lokalizacja zmian: `Konklawe/services/judgmentService.js:98-114,117-134`

---

**KONIEC DOKUMENTACJI**

Dla dalszych pytań lub aktualizacji, edytuj ten plik zgodnie ze zmianami w kodzie.
