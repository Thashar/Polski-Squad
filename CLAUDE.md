# CLAUDE.md - Szczegółowa Dokumentacja Deweloperska

**INSTRUKCJA WAŻNA: ZAWSZE PISZ PO POLSKU. Odpowiadaj na każdą konwersację w języku polskim, niezależnie od języka zapytania użytkownika.**

**WYJĄTEK - Gary Bot:** Kod i komentarze w Gary Bot (`Gary/` folder) są pisane PO ANGIELSKU. To jest zamierzony wyjątek od reguły. Przy edycji Gary Bot używaj języka angielskiego w kodzie i komentarzach.

**INSTRUKCJA COMMITOWANIA ZMIAN:**
- Po zakończeniu wprowadzania zmian w kodzie ZAWSZE commituj i pushuj BEZ PYTANIA
- Jeżeli jakiś hook zaraportuje, że są niezacommitowane zmiany to zacommituj i pushuj
- W commitach używaj krótkiego opisu zmian PO POLSKU
- Format commit message: Krótki opis zmian po polsku (bez dodatkowych linii)
- Przykład: "Dodano system kolejkowania OCR do Stalker"
- NIGDY nie pytaj użytkownika czy zacommitować - po prostu to zrób

**⚠️ INSTRUKCJA AKTUALIZACJI DOKUMENTACJI (KRYTYCZNE!):**
- **Po KAŻDEJ zmianie w kodzie bota → NATYCHMIAST aktualizuj `{Bot}/CLAUDE.md`**
- Nie czekaj do końca sesji - aktualizuj na bieżąco przy każdej zmianie
- Jeśli dodajesz funkcję → dodaj opis do bot/CLAUDE.md
- Jeśli zmieniasz funkcję → zaktualizuj opis w bot/CLAUDE.md
- Jeśli usuwasz funkcję → usuń opis z bot/CLAUDE.md

**INSTRUKCJA AKTUALIZACJI DOKUMENTACJI:**
- Po wprowadzeniu zmian w funkcjonalności bota ZAWSZE aktualizuj `{Bot}/CLAUDE.md` tego bota
- **EDYTUJ istniejące opisy** funkcji w odpowiednim pliku bot-specific
- Każdy bot ma własny plik dokumentacji w swoim folderze (np. `Stalker/CLAUDE.md`, `Rekruter/CLAUDE.md`)
- Używaj Grep + Read z offset/limit + Edit - NIE czytaj całego pliku
- **NIE twórz** "Historii Zmian" - aktualizuj bezpośrednio opisy funkcjonalności
- To oszczędzi tysiące tokenów - dokumentacja zawsze aktualna w jednym miejscu
- **PRZYKŁAD POPRAWNY**: Zmieniłeś system kolejkowania w Stalker → zaktualizuj `Stalker/CLAUDE.md` punkt "Kolejkowanie OCR"
- **PRZYKŁAD BŁĘDNY**: Dodałeś opis zmian do głównego CLAUDE.md zamiast do `Stalker/CLAUDE.md`

**⚠️ INSTRUKCJA AKTUALIZACJI LISTY KOMEND W MUTEUSZU (KRYTYCZNE!):**
- **Po dodaniu NOWEJ komendy slash lub modyfikacji istniejącej w KTÓRYMKOLWIEK bocie → NATYCHMIAST aktualizuj `Muteusz/config/all_commands.json`**
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
| **🔥 OPTYMALIZACJA TOKENÓW** | 112 | Workflow: Grep→Read→Edit, Task Explore |
| **Przegląd Projektu** | 127 | 9 botów, środowisko produkcyjne |
| **Architektura Systemu** | 151 | Struktura projektu, wzorce architektury |
| **Systemy Scentralizowane** | 219 | Logger, Nickname Manager, OCR Utils, Backup |
| **Szczegóły Botów** | 558 | Lista botów z linkami do bot-specific CLAUDE.md |
| **Komendy Deweloperskie** | 573 | npm start/dev/local, bot-config.json |
| **Zmienne Środowiskowe** | 622 | Kompletna lista .env dla wszystkich botów |
| **Najlepsze Praktyki** | 743 | Logowanie, błędy, konfiguracja, persistencja |
| **Rozwiązywanie Problemów** | 756 | OCR, proxy, nicki, pamięć, rate limit |

**Szczegóły poszczególnych botów:**
- `Rekruter/CLAUDE.md` - OCR rekrutacja, kwalifikacja klanów
- `Szkolenia/CLAUDE.md` - Wątki treningowe, przypomnienia
- `Stalker/CLAUDE.md` - 8 systemów (kary, punkty, urlopy, dekoder, fazy, AI Chat, broadcast, tracking)
- `Muteusz/CLAUDE.md` - Auto-moderacja, cache mediów, chaos mode
- `EndersEcho/CLAUDE.md` - OCR wyników, rankingi, role TOP
- `Kontroler/CLAUDE.md` - OCR dwukanałowy, loteria, dywersja, Oligopoly
- `Konklawe/CLAUDE.md` - Gra hasłowa, klątwy, błogosławieństwa, AI wspomaganie
- `Wydarzynier/CLAUDE.md` - Lobby party, zaproszenia, repozytorium
- `Gary/CLAUDE.md` - Lunar Mine API, proxy, cache, wyszukiwanie

**Przykład użycia:**
```bash
# Chcę sprawdzić ogólną architekturę
Read CLAUDE.md offset:151 limit:30

# Chcę sprawdzić szczegóły Stalker
Read Stalker/CLAUDE.md

# Chcę sprawdzić tylko system AI Chat w Stalker
Grep -n "AI Chat" Stalker/CLAUDE.md
Read Stalker/CLAUDE.md offset:{wynik_grep} limit:20
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
3. **Stalker Bot** - System kar za uczestnictwo w bossach z OCR + dekoder buildów + system faz
4. **Muteusz Bot** - Kompleksowa moderacja z cache'owaniem mediów i zarządzaniem rolami
5. **EndersEcho Bot** - System rankingów bossów z OCR i automatycznymi rolami TOP
6. **Kontroler Bot** - Dwukanałowa weryfikacja OCR + zaawansowana loteria z datami + system Oligopoly
7. **Konklawe Bot** - Interaktywna gra słowna z osiągnięciami i systemem klątw
8. **Wydarzynier Bot** - Zarządzanie lobby party + System przypomnień i eventów (skopiowany z STAR bota)
9. **Gary Bot** - Analiza Lunar Mine Expedition z API garrytools.com i proxy

---

## Architektura Systemu

### Struktura Projektu

**Główne pliki:**
- `index.js` - Główny launcher orchestrujący wszystkie boty
- `bot-config.json` - Konfiguracja środowisk (production/development)
- `.env` - Zmienne środowiskowe (NIE commitować!)

**Współdzielone zasoby:**
- `utils/` - consoleLogger, nicknameManager, ocrFileUtils, discordLogger
- `shared_data/` - Dane cross-bot (nickname effects, configs)
- `processed_ocr/` - Przetworzone obrazy OCR (wszystkie boty)
- `logs/bots-YYYY-MM-DD.log` - Scentralizowane logi (dzienna rotacja, auto-usuwanie po 30 dniach)

**Boty (każdy z podobną strukturą):**
- `{Bot}/index.js` - Główny plik bota
- `{Bot}/config/` - config.js, messages.js
- `{Bot}/handlers/` - interactionHandlers, messageHandlers, reactionHandlers
- `{Bot}/services/` - Serwisy specyficzne dla bota
- `{Bot}/data/` - Persistent storage (JSON)
- `{Bot}/temp/` - Tymczasowe pliki

**Szczegóły każdego bota:** Zobacz `{Bot}/CLAUDE.md`

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
  - Plik `logs/bots-YYYY-MM-DD.log` z timestampami (dzienna rotacja, auto-usuwanie po 30 dniach)
  - Discord webhook (opcjonalne, rate-limited 1s delay)
- 🚀 **Zoptymalizowany start** - Jednoliniowe komunikaty statusu: `✅ [NazwaBota] gotowy - [funkcje]`
- 🔍 **Inteligentne separatory** - Wizualne separatory tylko przy przełączaniu między różnymi botami

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

### 4. Automatyczna Naprawa NPM (NpmAuditFix)

**Plik:** `utils/npmAuditFix.js`

#### Funkcjonalność

Narzędzie uruchamiane automatycznie przy starcie botów (jeśli `AUTO_NPM_FIX=true` w `.env`).

- 🔍 **Skanowanie vulnerabilities** - `npm audit --json` z parsowaniem wyników
- 🔧 **Automatyczna naprawa** - `npm audit fix` (bezpieczne aktualizacje)
- 💪 **Tryb force** - `npm audit fix --force` jeśli `AUTO_NPM_FIX_FORCE=true`
- 💾 **Backup przed naprawą** - Automatyczny backup `package.json` i `package-lock.json`
- 🛡️ **Weryfikacja krytycznych pakietów** - Po naprawie sprawdza czy `discord.js` (GatewayIntentBits, Client) nadal działa
- 🔄 **Automatyczny rollback** - Jeśli naprawa złamała pakiety → przywraca backup i reinstaluje
- 📊 **Raportowanie** - Przed/po porównanie z kategoryzacją (krytyczne, wysokie, średnie, niskie)

#### Zmienne Środowiskowe

```env
AUTO_NPM_FIX=false          # true = włącz automatyczną naprawę przy starcie
AUTO_NPM_FIX_FORCE=false    # true = eskaluj do --force gdy zwykły fix nie pomoże (z rollbackiem!)
```

#### Przepływ działania

1. Skanuj vulnerabilities (`npm audit --json`)
2. Backup `package.json` + `package-lock.json`
3. Uruchom `npm audit fix` (bezpieczny)
4. Weryfikuj `discord.js` → jeśli złamany → rollback
5. Jeśli `AUTO_NPM_FIX_FORCE=true` i nadal są vulnerabilities → `npm audit fix --force`
6. Weryfikuj ponownie → jeśli złamany → rollback do stanu sprzed --force
7. Cleanup backupu

#### Przykład Wyjścia

```
🔧 AUTO_NPM_FIX włączony - sprawdzam vulnerabilities npm...
🔍 Sprawdzam vulnerabilities npm (v10.2.0)...
⚠️ Wykryto 6 vulnerabilities: 3 wysokich, 2 średnich, 1 niskich
💾 Backup package.json i package-lock.json utworzony
🔧 Uruchamiam npm audit fix...
✅ Bezpieczny fix naprawił 4/6 vulnerabilities
⚠️ Pozostało 2 vulnerabilities - próbuję --force...
❌ --force złamał krytyczne pakiety: discord.js (GatewayIntentBits.Guilds nie istnieje)
🔄 Automatyczny rollback...
✅ Rollback udany - pakiety przywrócone do stanu sprzed --force
```

---

### 5. System Backup do Google Drive

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

**Każdy bot ma własną szczegółową dokumentację:**

1. **[Rekruter Bot](Rekruter/CLAUDE.md)** - System rekrutacji z OCR (Tesseract + AI), kwalifikacja klanów
2. **[Szkolenia Bot](Szkolenia/CLAUDE.md)** - Wątki treningowe z przypomnieniami, auto-zamykanie po 7 dniach
3. **[Stalker Bot](Stalker/CLAUDE.md)** - 8 systemów (kary OCR, punkty, urlopy, dekoder, fazy, AI Chat, broadcast, tracking)
4. **[Muteusz Bot](Muteusz/CLAUDE.md)** - Auto-moderacja, cache mediów, zarządzanie rolami, chaos mode
5. **[EndersEcho Bot](EndersEcho/CLAUDE.md)** - Rankingi bossów z OCR (Tesseract + AI), role TOP
6. **[Kontroler Bot](Kontroler/CLAUDE.md)** - OCR dwukanałowy, loteria z datami, dywersja, Oligopoly
7. **[Konklawe Bot](Konklawe/CLAUDE.md)** - Gra hasłowa, osiągnięcia, system klątw i błogosławieństw, AI wspomaganie
8. **[Wydarzynier Bot](Wydarzynier/CLAUDE.md)** - Lobby party, zaproszenia, repozytorium
9. **[Gary Bot](Gary/CLAUDE.md)** - Lunar Mine API, proxy, cache, wyszukiwanie gildii

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
    "stalker",
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
# Przekazywanie wiadomości (robot2) - lista user ID rozdzielona przecinkami
ROBOT=user_id_1,user_id_2
ROBOT_PING_ROLE=role_id

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
# AI OCR (opcjonalne)
USE_STALKER_AI_OCR=false
STALKER_LME_AI_OCR_MODEL=claude-3-haiku-20240307

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
# Przekazywanie wiadomości (robot1) - lista user ID rozdzielona przecinkami
ROBOT=user_id_1,user_id_2
ROBOT_PING_ROLE=role_id

# ===== KONKLAWE BOT =====
KONKLAWE_TOKEN=bot_token_here
KONKLAWE_CLIENT_ID=client_id
KONKLAWE_GUILD_ID=guild_id
# AI Wspomaganie - wybór providera (opcjonalne)
KONKLAWE_AI_PROVIDER=anthropic          # "anthropic" (domyślny) lub "grok"
# Anthropic (gdy provider=anthropic)
KONKLAWE_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
KONKLAWE_AI_MODEL=claude-3-haiku-20240307
# Grok / xAI (gdy provider=grok)
XAI_API_KEY=xai-xxxxxxxxxxxxx
KONKLAWE_GROK_MODEL=grok-3-mini

# ===== WYDARZYNIER BOT =====
WYDARZYNIER_TOKEN=bot_token_here
WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL=channel_id
# Przekazywanie wiadomości (robot3) - lista user ID rozdzielona przecinkami
ROBOT=user_id_1,user_id_2
ROBOT_PING_ROLE=role_id

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

# ===== NPM AUTO-FIX (ZALECANE DLA SERWERÓW PRODUKCYJNYCH) =====
# Automatyczna naprawa vulnerabilities npm przed startem botów
# Wykonuje npm audit fix przy starcie - bezpieczne aktualizacje pakietów
# AUTO_NPM_FIX_FORCE=true wymusza aktualizacje (npm audit fix --force) - może złamać kompatybilność!
AUTO_NPM_FIX=false
AUTO_NPM_FIX_FORCE=false

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
**Proxy:** `/proxy-test`, `/proxy-refresh`, logi `logs/bots-YYYY-MM-DD.log`
**Nicki:** `shared_data/active_nickname_effects.json`, logi managera
**Pamięć:** OCR max 400, cache 2GB, `rm -rf */temp/*`
**Rate Limit:** Kolejka webhook, delay między requestami
**Start:** `logs/bots-YYYY-MM-DD.log`, env vars, uprawnienia Discord, `npm run botname`
**Backup:** Token wygasł → auto-refresh (event 'tokens'), `node authorize-google.js`, limit 50 tokenów/user


---

## Podsumowanie Struktury Dokumentacji

**Główny CLAUDE.md** (~765 linii):
- Instrukcje deweloperskie
- Przegląd projektu (9 botów)
- Architektura i systemy scentralizowane
- Najlepsze praktyki

**Bot-specific CLAUDE.md** (9 plików):
- Szczegółowa funkcjonalność każdego bota
- Zmienne środowiskowe
- Najlepsze praktyki specyficzne dla bota

**Korzyści modularnej struktury:**
- ✅ 80% oszczędności tokenów przy pracy nad pojedynczym botem
- ✅ Lepsza organizacja - dokumentacja przy kodzie
- ✅ Łatwiejsze utrzymanie i aktualizacje
- ✅ Szybsze wyszukiwanie i nawigacja

