# CLAUDE.md - Szczegółowa Dokumentacja Deweloperska

**INSTRUKCJA WAŻNA: ZAWSZE PISZ PO POLSKU. Odpowiadaj na każdą konwersację w języku polskim, niezależnie od języka zapytania użytkownika.**

**INSTRUKCJA RAPORTOWANIA TOKENÓW: Na końcu KAŻDEJ odpowiedzi podawaj:**
- Ilość pozostałych tokenów w formacie: `Pozostałe tokeny: X/200000`
- Procentowy progress bar wykorzystania tokenów
- Przykład formatu:
  ```
  ---
  Pozostałe tokeny: 180000/200000 (90%)
  [██████████████████░░] 90%
  ```

**INSTRUKCJA COMMITOWANIA ZMIAN:**
- Po zakończeniu wprowadzania zmian w kodzie ZAWSZE pytaj użytkownika czy zacommitować te zmiany
- W commitach używaj krótkiego opisu zmian PO POLSKU
- **Po utworzeniu commita ZAWSZE od razu wykonaj `git push` bez pytania**
- Format commit message: Krótki opis zmian po polsku (bez dodatkowych linii)
- Przykład: "Dodano system kolejkowania OCR do StalkerLME"

**Ostatnia aktualizacja:** Listopad 2025

Ten plik zawiera szczegółową dokumentację techniczną dla Claude Code podczas pracy z kodem w tym repozytorium.

---

## 📋 Spis Treści

1. [Przegląd Projektu](#przegląd-projektu)
2. [Architektura Systemu](#architektura-systemu)
3. [Systemy Scentralizowane](#systemy-scentralizowane)
4. [Szczegóły Botów](#szczegóły-botów)
5. [Komendy Deweloperskie](#komendy-deweloperskie)
6. [Zmienne Środowiskowe](#zmienne-środowiskowe)
7. [Najlepsze Praktyki](#najlepsze-praktyki)
8. [Rozwiązywanie Problemów](#rozwiązywanie-problemów)

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

**Główny Plik:** `Rekruter/index.js`

#### Funkcjonalność

**Wieloetapowy Proces Rekrutacji:**
1. Pytanie o narodowość (Polski/Nie polski)
2. Pytanie o cel (Zostać w klanie/Inne cele)
3. Weryfikacja statystyk (dla chcących zostać) - OCR
4. Przypisanie do klanu na podstawie siły ataku

**System Kwalifikacji Klanów:**
```javascript
// Logika w services/roleService.js
if (attack < 100000) {
    return 'not_qualified'; // Brak kwalifikacji
} else if (attack >= 100000 && attack <= 599999) {
    return 'clan0'; // 100K-599K
} else if (attack >= 600000 && attack <= 799999) {
    return 'clan1'; // 600K-799K
} else if (attack >= 800000 && attack <= 1199999) {
    return 'clan2'; // 800K-1.19M
} else if (attack >= 1200000) {
    return 'main_clan'; // 1.2M+
}
```

#### Pipeline OCR

**Plik:** `Rekruter/services/ocrService.js`

1. **Preprocessing obrazu:**
   - Konwersja do grayscale
   - Threshold (białe tło)
   - Zwiększenie kontrastu

2. **Analiza regionów:**
   - Dzieli obraz na 50 sekcji
   - Każda sekcja: 20% wysokości, różne offsety X

3. **Ekstrakcja tekstu:**
   - Tesseract.js z polskim + angielskim
   - Filtrowanie znaków (tylko alfanumeryczne + polskie znaki)

4. **Walidacja nicka:**
   - Długość 3-32 znaki
   - Dopasowywanie podobieństwa z nickiem Discord
   - Wielokrotne próby dla dokładności

5. **Ekstrakcja mocy ataku:**
   - Szukanie wzorców: "XXX.XXK", "X.XXM" itp.
   - Konwersja na wartość numeryczną
   - Walidacja zakresu (10K - 10M)

#### Śledzenie Boostów Serwera

**Plik:** `Rekruter/services/memberNotificationService.js`

- Monitoruje zdarzenia `guildMemberUpdate`
- Wykrywa zmiany statusu boosta
- Wysyła 1 z 10 losowych wiadomości gratulacyjnych
- Loguje wejścia/wyjścia użytkowników z custom emoji

#### Monitorowanie Ról

**Plik:** `Rekruter/services/roleMonitoringService.js`

- Cron job co 6 godzin (`0 */6 * * *`)
- Sprawdza użytkowników bez wymaganych ról
- Zapisuje timestamp pierwszego wykrycia
- Wysyła ostrzeżenia po 24h
- Integracja z Muteusz Bot do kickowania

#### Automatyczne Rozwiązywanie Konfliktów Ról

**Plik:** `Rekruter/services/roleConflictService.js`

- Automatyczne usuwanie ról rekrutacyjnych gdy użytkownik dostaje rolę klanową
- Monitoruje zdarzenia `guildMemberUpdate`
- Wykrywa przypisanie ról klanowych: Clan0, Clan1, Clan2, Main Clan
- Automatycznie usuwa konfliktujące role rekrutacyjne
- Zapobiega posiadaniu jednocześnie roli rekruta i roli klanowej
- Loguje wszystkie zmiany z informacją o użytkowniku

**Przykład:**
```javascript
// Użytkownik dostaje rolę Main Clan
// System automatycznie usuwa:
// - Rolę "Poczekalnia" (jeśli posiada)
// - Rolę "Rekrut" (jeśli posiada)
```

#### Komendy Slash

```javascript
// /ocr-debug [enabled]
// Przełącza szczegółowe logowanie OCR
await interaction.reply({
    content: `Szczegółowe logowanie OCR: ${enabled ? 'włączone' : 'wyłączone'}`,
    ephemeral: true
});

// /nick <user> <nick>
// Zmienia nick użytkownika (tylko admin)
await member.setNickname(newNick);
```

#### Zmienne Środowiskowe

```env
DISCORD_TOKEN=bot_token
RECRUITMENT_CHANNEL=1234567890
CLAN0_CHANNEL=1234567890
CLAN1_CHANNEL=1234567890
CLAN2_CHANNEL=1234567890
MAIN_CLAN_CHANNEL=1234567890
WELCOME_CHANNEL=1234567890
NOT_POLISH_ROLE=1234567890
VERIFIED_ROLE=1234567890
CLAN0_ROLE=1234567890
CLAN1_ROLE=1234567890
CLAN2_ROLE=1234567890
MAIN_CLAN_ROLE=1234567890
WAITING_ROOM_CHANNEL=poczekalnia
```

---

### 🎓 Szkolenia Bot

**Główny Plik:** `Szkolenia/index.js`

#### Funkcjonalność

**Tworzenie Wątków przez Reakcje:**
- Emoji: N_SSS
- Tworzy prywatny wątek dla użytkownika
- Wysyła szczegółowe instrukcje treningowe
- Dodaje przyciski zarządzania

**Cykl Życia Wątków:**
1. **Utworzenie** - Wątek prywatny z instrukcjami
2. **24h nieaktywności** - Przypomnienie z przyciskami
3. **Archiwizacja po 24h** - Auto-archiwizacja
4. **Zamknięcie po 7 dniach** - Całkowite zamknięcie (nie usuwanie!)

**Plik:** `Szkolenia/services/threadService.js`

```javascript
// Sprawdzanie wątków co 60 minut
setInterval(async () => {
    await threadService.checkThreadsForReminders();
    await threadService.checkThreadsForArchive();
    await threadService.checkThreadsForLocking();
}, config.timing.checkIntervalMinutes * 60 * 1000);
```

#### Kompleksowe Wytyczne

Wiadomość zawiera szczegółowe instrukcje dla:
- **Itemy** - Plecak, EQ, tech party, resonans
- **Collectibles** - Czerwone, żółte, collection sets
- **Zwierzęta** - Pety, xeno pety, poziomy awaken
- **Postacie** - Kolekcja, awaken, synergie
- **Tryby gry** - Path of Trials, Main Challenge
- **Sumy itemów** - AW, Chip, Pet AW, RC

Alternatywnie: Integracja z https://sio-tools.vercel.app/ i komendą `/decode`

#### Persistent Storage

**Plik:** `Szkolenia/services/reminderStorageService.js`

```javascript
// Przechowywanie przypomnień w JSON
{
    "threadId": {
        "channelId": "1234567890",
        "ownerId": "9876543210",
        "createdAt": 1704067200000,
        "lastActivity": 1704153600000,
        "reminderSent": false,
        "archived": false
    }
}
```

#### Zmienne Środowiskowe

```env
SZKOLENIA_DISCORD_TOKEN=bot_token
SZKOLENIA_CHANNEL_ID=1234567890
SZKOLENIA_PING_ROLE_ID=1234567890
```

---

### ⚔️ StalkerLME Bot

**Główny Plik:** `StalkerLME/index.js`

#### Funkcjonalność

**1. System Kar OCR**

**Plik:** `StalkerLME/services/ocrService.js`

Pipeline przetwarzania:
1. **Upscaling** - 3x wielkość dla lepszej dokładności
2. **Gamma correction** - γ=3.0 dla kontrastu
3. **Median filter** - Redukcja szumu
4. **Blur** - Delikatne rozmycie (0.8)
5. **Thresholding** - Białe tło (200)

Wykrywanie graczy z 0:
```javascript
// Wykrywanie wzorca: "nick ...0" lub "nick ...o" (błąd OCR)
const zeroPattern = /^(.+?)\s+.*?[o0Oo]$/;

// Obsługa wyjątków - znaki "o" w końcówkach
const exceptions = ['echo', 'ko', 'wo', 'zo', 'no', 'po'];
```

**Dopasowywanie Nicków:**
- Levenshtein distance dla podobieństwa
- Próg 30% dla dopasowania
- Normalizacja: lowercase, usunięcie spacji
- Obsługa polskich znaków

**2. System Punktowy**

**Plik:** `StalkerLME/services/punishmentService.js`

```javascript
// Logika przypisywania ról
if (points >= 3) {
    // Usuń rolę kary, dodaj rolę ban loterii
    await member.roles.remove(config.punishmentRoleId);
    await member.roles.add(config.lotteryBanRoleId);
} else if (points >= 2) {
    // Dodaj tylko rolę kary
    await member.roles.add(config.punishmentRoleId);
}
```

**Cotygodniowe Czyszczenie:**
```javascript
// Cron job: Każdy poniedziałek o północy
cron.schedule('0 0 * * 1', async () => {
    await punishmentService.weeklyPointsReduction();
});
```

**3. System Urlopów**

**Plik:** `StalkerLME/services/vacationService.js`

- Stała wiadomość z przyciskiem "Złóż wniosek urlopowy"
- Kliknięcie nadaje rolę urlopową na 15 minut
- Cooldown 6 godzin między wnioskami
- Automatyczne usuwanie roli po timeout

**4. Dekoder Buildów Survivor.io**

**Plik:** `StalkerLME/services/decodeService.js`

- Komenda `/decode` w whitelistowanych kanałach
- Dekompresja LZMA
- Parsowanie JSON z buildem
- Wyświetlanie jako embed z formatowaniem

**5. System Kolejkowania OCR**

**Plik:** `StalkerLME/services/queueService.js`

Globalny system kolejkowania zapewniający, że tylko jeden użytkownik na raz może używać komend OCR per guild:

- **Jeden użytkownik na raz** - Zapobiega konfliktom podczas przetwarzania OCR
- **Progress bary z animacją** - Migające kratki pokazują postęp
- **Przyciski komend w embedzie** - Faza1 💀, Faza2 🎯, Punish 💀, Remind ⚠️
- **Dynamiczne timeouty** - Session auto-refresh przy kliknięciu przycisku
- **15-minutowy timeout** - Automatyczne wygaśnięcie sesji po bezczynności
- **Kolejka oczekujących** - Powiadomienia ghost ping dla kolejnych użytkowników
- **Instant feedback** - Natychmiastowe potwierdzenia akcji

**Embed Kolejki:**
```
🔒 KOLEJKA OCR - Ktoś już przetwarza obrazy

👤 Aktualnie przetwarza: @User
⏱️ Rozpoczęto: <t:timestamp:R>

🎯 W kolejce (1):
1️⃣ @QueuedUser

[Faza1 💀] [Faza2 🎯] [Punish 💀] [Remind ⚠️]
```

**6. System Faz Lunar Expedition - Zbieranie Wyników z Rozgrywek Klanowych**

**Pliki:**
- `StalkerLME/services/phaseService.js` - Główny serwis obsługi faz
- `StalkerLME/services/ocrService.js` - OCR z obsługą Phase 1 i 2
- `StalkerLME/services/databaseService.js` - Baza danych wyników
- `StalkerLME/services/survivorService.js` - Zarządzanie wynikami graczy
- `StalkerLME/services/queueService.js` - Globalny system kolejkowania

**Faza 1 - Zbieranie Listy Uczestników:**
- Komenda `/faza1` - Zbiera screeny całej listy uczestników z ich wynikami
- Użytkownik przesyła 1-10 screenów z listą uczestników i wynikami
- OCR rozpoznaje nicki i wyniki (0 lub liczby dodatnie)
- Agregacja wyników ze wszystkich screenów
- Rozstrzyganie konfliktów (gdy różne screeny pokazują różne wyniki dla tego samego gracza)
- Zapis do bazy danych na podstawie aktualnego tygodnia ISO
- Dane zapisywane z informacją o klanie i twórcy

**Faza 2 - Zbieranie Wyników z 3 Rund Bossów:**
- Komenda `/faza2` - Zbiera wyniki z 3 rund walk z bossami
- 3 rundy: użytkownik przesyła screeny dla każdej rundy osobno
- OCR rozpoznaje nicki i wyniki damage z każdej rundy
- Suma wyników z wszystkich 3 rund dla każdego gracza
- Wykrywanie graczy z 0 obrażeń
- Zapis do bazy danych dla tygodnia

**Wyświetlanie Wyników:**
- Komenda `/wyniki` - Wyświetla wyniki faz w formie embed
- Pokazuje Top 30 graczy z największymi wynikami
- Suma punktów TOP30
- Informacje o tygodniu i klanie
- Dane wyciągane z `data/lunar_phases.json`

**Funkcjonalność Techniczna:**
- **Sesje z timeout 15 minut** - Automatyczne wygasanie po bezczynności
- **Dynamiczne timeouty** - Auto-refresh timestamp przy interakcji
- **Progress bar z animacją** - Migające kratki podczas przetwarzania OCR
- **Globalny system kolejkowania** - Jeden użytkownik na raz per guild
- **Kolejka oczekujących** - Ghost ping powiadomienia (usuwane po 3s)
- **Przyciski komend** - Bezpośredni dostęp z embeda kolejki
- **Garbage collection** - Automatyczna optymalizacja pamięci (usunięto scheduled cleanup)
- **Instant feedback** - Natychmiastowe potwierdzenia akcji

**Kontrola Dostępu:**
- `/progres` i `/wyniki` - Tylko dla członków klanów (role: Clan0, Clan1, Clan2, Main Clan)
- Automatyczna weryfikacja roli przed wykonaniem komendy

**Powiadomienia Warning:**
- Automatyczne powiadomienia na kanały warning po zakończeniu fazy
- Pełny embed z statystykami TOP30
- Osobne kanały dla każdego klanu

**Manualny Input:**
- Przycisk "Wprowadź ręcznie" przy konfliktach OCR
- Możliwość ręcznego wprowadzenia danych gdy OCR się myli

#### Komendy Slash

```javascript
// /punish <image>
// Analizuj obraz OCR i przypisz kary
await ocrService.analyzeImage(attachment.url);
await punishmentService.addPoints(userId, 1);

// /remind <image>
// Wyślij przypomnienia zamiast kar
await punishmentService.sendReminders(foundPlayers);

// /punishment [category]
// Ranking punktów (all/main/0/1/2)
const rankings = await punishmentService.getRankings(category);

// /points <user> [amount]
// Zarządzanie punktami
await punishmentService.setPoints(userId, amount);

// /decode
// Dekoduj build Survivor.io
const buildData = await decodeService.decode(code);

// /faza1
// Zbierz wyniki Fazy 1
await phaseCollectionService.collectPhase1();

// /wyniki
// Wyświetl wyniki wszystkich faz (tylko członkowie klanu)
await phaseResultsService.displayResults();

// /progres
// Wyświetl postęp zbierania danych (tylko członkowie klanu)
await phaseService.showProgress();

// /clan-status
// Porównanie wyników między klanami
// Pokazuje najlepsze wyniki każdego użytkownika w każdym klanie
// Obecny klan użytkownika zaznaczony ikoną
await survivorService.getClanComparison();
```

#### Zmienne Środowiskowe

```env
STALKER_LME_DISCORD_TOKEN=bot_token
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
STALKER_LME_VACATION_CHANNEL_ID=channel_id
```

---

### 🤖 Muteusz Bot

**Główny Plik:** `Muteusz/index.js`

#### Funkcjonalność

**1. Auto-Moderacja**

**Plik:** `Muteusz/services/autoModerationService.js`

**Wykrywanie Spamu:**
```javascript
// Monitoruje duplikaty wiadomości z linkami
// Okno czasowe: 30 minut
// Max duplikaty: 3
// Kara: 7-dniowy timeout
```

**Filtrowanie Wulgaryzmów:**
- Obszerna baza polskich wulgaryzmów
- Wykrywanie kontekstowe
- Progresja kar (warn → mute → timeout)

**Blokowanie Zaproszeń Discord:**
- Wzorce: discord.gg/, discord.com/invite/
- Automatyczne usuwanie
- Ostrzeżenie użytkownika

**2. Cache Mediów**

**Plik:** `Muteusz/services/mediaService.js`

Funkcjonalność:
- Pliki do 100MB
- Cache 2GB maksymalnie
- 24h retencja
- Automatyczne czyszczenie najstarszych

```javascript
// Zapisywanie mediów
await mediaService.cacheMedia(message);

// Odzyskiwanie przy usunięciu
const cached = await mediaService.getCachedMedia(messageId);
if (cached) {
    await logChannel.send({
        files: [cached.path]
    });
}
```

**3. Zarządzanie Rolami**

**Plik:** `Muteusz/services/roleManagementService.js`

Grupy Ekskluzywne:
```javascript
// Plik: data/special_roles.json
{
    "roles": [
        {
            "id": "role_id_1",
            "conflictsWith": ["role_id_2", "role_id_3"]
        }
    ]
}
```

Logika:
- Wykrywa przypisanie roli
- Sprawdza konflikty
- Automatycznie usuwa konfliktujące role
- 5s delay dla walidacji

**4. Śledzenie Naruszeń**

**Plik:** `Muteusz/services/warningsService.js`

```javascript
// Struktura ostrzeżenia
{
    "userId": "123456789",
    "warnings": [
        {
            "id": "uuid",
            "reason": "Spam",
            "moderator": "987654321",
            "timestamp": 1704067200000
        }
    ]
}
```

**5. Koordynacja z Rekruterem**

**Plik:** `Muteusz/services/roleKickingService.js`

- Cron job co 2 godziny
- Czyta `Rekruter/data/user_monitoring.json`
- Kickuje użytkowników bez ról po 24h
- Loguje działania

**6. Chaos Mode - Polski Hymn Narodowy**

**Plik:** `Muteusz/services/chaosService.js`

System Chaos Mode z polskim hymnem narodowym i losowym nadawaniem ról:

**Mechanizm:**
- 5% szansa na otrzymanie roli chaos przy każdej wiadomości (dla użytkowników bez roli)
- Role przyznawane **na stałe do wyłączenia chaos mode**
- Wsparcie dla wielu różnych ról chaos jednocześnie
- 10% szansa na odpowiedź bota dla użytkowników z rolą (1/10 wiadomości)
- 20% szansa na wysłanie zwrotki hymnu (1/5 odpowiedzi), 80% na emoji

**Hymn Polski:**
- 5 zwrotek hymnu + refren
- Każda zwrotka formatowana z emoji flagi Polski
- Losowy wybór zwrotki przy każdej odpowiedzi

**Przykład Zwrotki:**
```
Jeszcze Polska nie zginęła,
Kiedy my żyjemy.
Co nam obca przemoc wzięła,
Szablą odbierzemy. 🇵🇱
```

**Persistent Storage:**
```json
{
  "enabled": true,
  "chaosRoleIds": ["role_id_1", "role_id_2"],
  "activeUsers": [
    {
      "userId": "123456789",
      "guildId": "987654321",
      "roleId": "role_id_1"
    }
  ]
}
```

**Weryfikacja po Restarcie:**
- Sprawdza czy użytkownicy nadal mają swoje role
- Usuwa z listy tych, którzy utracili rolę
- Automatyczne czyszczenie nieaktualnych danych

**Komenda Włączania:**
```javascript
// Włącz chaos mode z wieloma rolami
/chaos-mode enable role1:@Role1 role2:@Role2

// Wyłącz chaos mode (usuwa wszystkie role od użytkowników)
/chaos-mode disable
```

**7. Losowe Odpowiedzi**

Dla posiadaczy roli Virtutti Papajlari:
- Szansa 1/250 (0.4%)
- Emoji: PepeSoldier
- Tylko na wiadomości tekstowe

#### Komendy Slash

```javascript
// /remove-roles
// Masowe usuwanie ról

// /special-roles
// Interfejs zarządzania rolami ekskluzyw nymi

// /add-special-role <role>
// Dodaj rolę do zarządzania

// /remove-special-role <role>
// Usuń rolę z zarządzania

// /list-special-roles
// Lista zarządzanych ról

// /violations [user]
// Historia naruszeń

// /unregister-command <id>
// Usuń komendę serwera
```

#### Zmienne Środowiskowe

```env
MUTEUSZ_TOKEN=bot_token
MUTEUSZ_CLIENT_ID=client_id
MUTEUSZ_GUILD_ID=guild_id
MUTEUSZ_TARGET_CHANNEL_ID=channel_id
MUTEUSZ_LOG_CHANNEL_ID=channel_id
```

---

### 🏆 EndersEcho Bot

**Główny Plik:** `EndersEcho/index.js`

#### Funkcjonalność

**1. Analiza OCR Wyników**

**Plik:** `EndersEcho/services/ocrService.js`

Pipeline:
1. **Preprocessing** - Sharp z białym tekstem
2. **OCR** - Tesseract polski + angielski
3. **Ekstrakcja "Best"** - Wzorce: "123.45M Best", "1.23B Total Best"
4. **Korekcja błędów** - TT→1T, 7→T, 0→Q
5. **Konwersja jednostek** - K/M/B/T/Q/Qi → wartość numeryczna

Przykład:
```javascript
// "1.23TT Best" → "1.23T" → 1,230,000,000,000
const score = parseScoreValue("1.23TT");
// Wynik: 1230000000000
```

**2. System Rankingów**

**Plik:** `EndersEcho/services/rankingService.js`

Struktura danych:
```json
{
    "userId_bossName": {
        "userId": "123456789",
        "username": "Player",
        "score": 1230000000000,
        "scoreFormatted": "1.23T",
        "bossName": "Ender Dragon",
        "timestamp": 1704067200000,
        "imageUrl": "https://..."
    }
}
```

Funkcje:
- `addOrUpdateScore()` - Dodaj/zaktualizuj wynik
- `getTopScores()` - Top N wyników
- `getRankingForUser()` - Ranking konkretnego użytkownika
- `removePlayer()` - Usuń gracza z rankingów

**3. System Ról TOP**

**Plik:** `EndersEcho/services/roleManagementService.js`

5 poziomów ról:
```javascript
const topRoles = {
    top1: '1392875142383931462',      // Pozycja 1
    top2: '1392877265284763740',      // Pozycje 2-3
    top3: '1392877372486713434',      // (nieużywane)
    top4to10: '1392916393615294534',  // Pozycje 4-10
    top11to30: '1392917115614527599'  // Pozycje 11-30
};
```

Logika przypisywania:
1. Pobierz top 30 wyników
2. Usuń wszystkie stare role TOP
3. Przypisz nowe role według pozycji
4. Loguj zmiany

**4. Paginacja Rankingów**

**Plik:** `EndersEcho/handlers/interactionHandlers.js`

- 10 graczy na stronę
- Przyciski nawigacji (◀️ Previous | Next ▶️)
- Timeout 1 godzina
- Podświetlanie użytkownika żądającego

```javascript
// Format wyświetlania
🥇 **Player1** - 1.23T
🥈 **Player2** - 987.65B
🥉 **Player3** - 654.32B
4. Player4 - 543.21B
...
```

#### Komendy Slash

```javascript
// /update <image>
// Wyślij wyniki walk z bossami
await ocrService.extractScore(image);
await rankingService.addOrUpdateScore(userId, score, bossName);
await roleManagementService.updateTopRoles();

// /ranking
// Zobacz prywatny ranking (ephemeral)
const rankings = await rankingService.getTopScores(limit);

// /remove <players...>
// Usuń graczy z rankingów (admin)
await rankingService.removePlayer(playerId);

// /ocr-debug [enabled]
// Przełącz logowanie OCR
```

#### Zmienne Środowiskowe

```env
ENDERSECHO_TOKEN=bot_token
ENDERSECHO_CLIENT_ID=client_id
ENDERSECHO_GUILD_ID=guild_id
ENDERSECHO_ALLOWED_CHANNEL_ID=channel_id
```

---

### 🎯 Kontroler Bot

**Główny Plik:** `Kontroler/index.js`

#### Funkcjonalność

**1. Dwukanałowe Monitorowanie OCR**

**Kanał CX:**
- Minimum: 1500 punktów
- Range: 0-2800 (step 100)
- Próg roli specjalnej: 2800+
- skipLines: 1
- Nie wymaga drugiego wystąpienia nicku

**Kanał Daily:**
- Minimum: 910 punktów
- Range: 0-1050 (step 10)
- skipLines: 3
- **Wymaga drugiego wystąpienia nicku**

**Plik:** `Kontroler/services/ocrService.js`

Pipeline:
1. **Preprocessing specyficzny dla kanału**:
   - CX: Standard thresholding
   - Daily: "Biały tekst na szarym"
2. **OCR** - Polski + angielski
3. **Normalizacja znaków**:
   ```javascript
   'o' → '0', 'O' → '0'
   'z' → '2', 'Z' → '2'
   'l' → '1', 'I' → '1', 'i' → '1'
   'B' → '8'
   'g' → '9', 'G' → '6'
   'sg' → '9' // Specjalne dla Daily
   ```
4. **Wykrywanie nicków** - Dopasowywanie podobieństwa (40% i 30%)
5. **Walidacja wyników** - Sprawdzanie range i step

**2. Zaawansowana Loteria**

**Plik:** `Kontroler/services/lotteryService.js`

**Planowanie Oparte na Datach:**
```javascript
// Format: dd.mm.yyyy HH:MM
// Przykład: 15.01.2025 18:00
const lotteryDate = parseLotteryDate(dateString, timeString);
```

**Obsługa DST (Daylight Saving Time):**
- Automatyczna detekcja
- Konwersja na UTC
- Polska strefa czasowa (Europe/Warsaw)

**Wsparcie Multi-Klan:**
```javascript
const clans = {
    'server': { roleId: null, name: 'Cały Serwer' },
    'main': { roleId: '1170351983092383814', name: 'Polski Squad' },
    '0': { roleId: '1170351932735193179', name: 'PolskiSquad⁰' },
    '1': { roleId: '1170351955560927262', name: 'PolskiSquad¹' },
    '2': { roleId: '1170351976075210752', name: 'PolskiSquad²' }
};
```

**Cykle Losowań:**
- 0 dni = jednorazowa
- 1-365 dni = powtarzająca się
- Max 24 dni do przodu (limit JavaScript setTimeout)

**System Ostrzeżeń:**
- 90 minut wcześniej: "Ostatnia godzina na wrzucenie zdjęcia"
- 30 minut wcześniej: "Zamykam zbieranie zgłoszeń"
- **Tylko dla loterii Daily/CX**

**Historia i Przelosowanie:**
```json
{
    "lotteryId": {
        "draws": [
            {
                "timestamp": 1704067200000,
                "winners": ["user1", "user2"],
                "participants": ["user1", "user2", "user3", "user4"]
            }
        ]
    }
}
```

**Filtrowanie Zablokowanych:**
- Automatycznie pomija użytkowników z rolą `1392812250263195718` (Lottery Ban)

#### Komendy Slash

```javascript
// /lottery <role> <clan> <frequency> <date> <time> <winners> <channel>
// Utwórz nową loterię
// role: ID roli docelowej
// clan: server/main/0/1/2
// frequency: 0-365 (dni)
// date: dd.mm.yyyy (max 24 dni do przodu)
// time: HH:MM (strefa polska)
// winners: 1-20
// channel: ID kanału wyników

// /lottery-list
// Wszystkie aktywne loterie

// /lottery-remove <id>
// Usuń loterię

// /lottery-history <id>
// Historia losowań

// /lottery-reroll <draw_id>
// Przelosuj wyniki

// /lottery-debug
// Debug statusu systemu

// /ocr-debug [enabled]
// Przełącz logowanie OCR
```

#### Zmienne Środowiskowe

```env
KONTROLER_TOKEN=bot_token
KONTROLER_CLIENT_ID=client_id
KONTROLER_GUILD_ID=guild_id
```

---

### ⛪ Konklawe Bot

**Główny Plik:** `Konklawe/index.js`

#### Funkcjonalność

**1. Gra Hasłowa**

**Plik:** `Konklawe/services/gameService.js`

Mechanika:
- Domyślne hasło: "Konklawe"
- Admin może ustawić niestandardowe hasło
- Poprawna odpowiedź → Rola papieska
- Niepoprawna → Brak reakcji

**2. System Osiągnięć**

Medal Virtutti Papajlari:
- Wymóg: 30+ poprawnych odpowiedzi
- Reset rankingu po otrzymaniu medalu
- Specjalne uprawnienia (blessing, virtue-check)

**3. Inteligentne Timery**

**Plik:** `Konklawe/services/timerService.js`

Typy timerów:
- **15 minut** - Przypomnienie
- **30 minut** - Drugie przypomnienie
- **1 godzina** - Ostatnie przypomnienie
- **15 minut** - Auto-reset hasła na "Konklawe"

Funkcje:
- Persistent state w `data/game_state.json`
- **Automatyczne przywracanie po restartach** - Timery wznawiane z zachowanym czasem
- **Inteligentny reset** - Reset timerów gdy:
  - Brak hasła w grze
  - Brak podpowiedzi
  - Bot właśnie wystartował i gra nie jest aktywna
- Anulowanie przy aktywności (nowa poprawna odpowiedź)
- Walidacja czasu pozostałego przed ustawieniem timera

**Ulepszenia Restoracji:**
```javascript
// Po restarcie bota:
// 1. Sprawdź czy gra jest aktywna
// 2. Jeśli hasło jest puste ORAZ brak podpowiedzi → usuń timery
// 3. Jeśli gra aktywna → wznów timery z zachowanym czasem
// 4. Loguj wszystkie operacje dla debugowania
```

**4. System Klątw**

7 rodzajów klątw nakładanych losowo przez Vatican Council:

```javascript
const curses = [
    "Slow mode personal (30s między wiadomościami, 5 min)",
    "Auto-delete (30% szansy usunięcia wiadomości, 5 min)",
    "Random ping (losowe pingi, 5 min)",
    "Emoji spam (30% szansy reakcji emoji, 5 min)",
    "Forced caps (przepisywanie CAPSEM, 100% szansy, 5 min)",
    "Random timeout (30% czasu na timeout, 5 min)",
    "Special role (specjalna rola, 5 min)"
];
```

Mechanizm:
- Losowy wybór klątwy
- Nakładanie przez nickname manager (jeśli nick)
- Czas trwania: 5 minut
- Automatyczne usunięcie po wygaśnięciu

**5. Specjalne Komendy**

**Blessing (dla posiadaczy medalu):**
```javascript
// 22 warianty błogosławieństw
const blessings = [
    "🍫 Niech Ci dropi same toblerony! 🎁",
    "💎 Niech Ci gemy tylko przybywają! 📈",
    // ... więcej
];

// Cooldown: 10 minut
// Daily limit: 5 użyć
```

**Virtue Check (dla posiadaczy medalu):**
```javascript
// 10 cnót z poradami papieskimi
const virtues = [
    "Memiczność",
    "Cierpliwość na Loading",
    "Mądrość Googlowania",
    // ... więcej
];

const advice = [
    "Żebyś więcej gemów odkładał na bok, synu.",
    "Potrzebujesz więcej tobleronów w swoim życiu.",
    // ... więcej
];
```

**6. Losowe Odpowiedzi**

Dla użytkowników papieskich:
- Szansa 1/100 (1%)
- Emoji JP2roll
- Tylko na wiadomości w kanale gry

#### Komendy Slash

```javascript
// /podpowiedz <hint>
// Dodaj podpowiedź (wymaga roli papieskiej)

// /podpowiedzi
// Zobacz wszystkie podpowiedzi

// /statystyki
// Interaktywne statystyki z przyciskami:
// - Ranking (top 10)
// - Medale (posiadacze Virtutti Papajlari)
// - Historia (ostatnie 10 gier)

// /blessing <user>
// Błogosław innego użytkownika
// (wymaga medalu Virtutti Papajlari)

// /virtue-check <user>
// Sprawdź cnoty użytkownika
// (wymaga medalu Virtutti Papajlari)
```

#### Zmienne Środowiskowe

```env
KONKLAWE_TOKEN=bot_token
KONKLAWE_CLIENT_ID=client_id
KONKLAWE_GUILD_ID=guild_id
```

---

### 🎉 Wydarzynier Bot

**Główny Plik:** `Wydarzynier/index.js`

#### Funkcjonalność

**1. System Lobby Party**

**Plik:** `Wydarzynier/services/lobbyService.js`

Parametry:
- Max graczy: 7 (1 właściciel + 6 członków)
- Okres dyskusji: 15 minut po zapełnieniu
- Max czas trwania: 15 minut od utworzenia
- Ostrzeżenie: 5 minut przed zamknięciem

Mechanizm:
```javascript
// Utworzenie lobby
const lobby = await lobbyService.createLobby(ownerId, channel);

// Utworzenie wątku
const thread = await channel.threads.create({
    name: `🎉 ${displayName} - Party Lobby`,
    autoArchiveDuration: 60,
    type: ChannelType.PrivateThread
});

// Dodanie właściciela do wątku
await thread.members.add(ownerId);
```

**2. System Zaproszeń**

Workflow:
1. Użytkownik klika "Join Party" na ogłoszeniu
2. Wiadomość z przyciskami wysyłana do wątku właściciela
3. Właściciel klika "Accept" lub "Reject"
4. Accept → Użytkownik dodany do wątku
5. Reject → Wiadomość odrzucenia

Ochrona:
- Tylko zaakceptowani gracze mogą pozostać w wątku
- Wyjątek dla administratorów
- Automatyczne usuwanie nieautoryzowanych

**3. System Repozytorium**

**Plik:** `Wydarzynier/services/repositionService.js`

- Interval: 5 minut
- Usuwa stare ogłoszenie
- Tworzy nowe na górze kanału
- Aktualizuje licznik graczy
- Bez pingu roli (tylko przy pierwszym utworzeniu)

**4. Subskrypcje Ról**

Po zapełnieniu lobby:
- Wyświetlany przycisk "Zapisz się na powiadomienia"
- Toggle: Dodaj/usuń rolę party notifications
- Feedback: Ephemeral wiadomości potwierdzające

#### Komendy Slash

```javascript
// /party
// Utwórz nowe lobby party (publiczne)
await lobbyService.createLobby(userId, channel);

// /party-add <user>
// Dodaj gracza bezpośrednio (tylko właściciel)
await lobbyService.addPlayer(lobbyId, userId);

// /party-kick <user>
// Usuń gracza z lobby (tylko właściciel)
await lobbyService.removePlayer(lobbyId, userId);

// /party-close
// Zamknij lobby ręcznie (tylko właściciel)
await lobbyService.closeLobby(lobbyId);
```

#### Zmienne Środowiskowe

```env
WYDARZYNIER_TOKEN=bot_token
```

---

### 🎮 Gary Bot

**Główny Plik:** `Gary/index.js`

#### Funkcjonalność

**1. Analiza Lunar Mine Expedition**

**Plik:** `Gary/services/apiService.js`

Workflow:
1. Fetch dane z `garrytools.com/lunar`
2. Parse HTML używając cheerio
3. Ekstrakcja 4 gildii z tabeli
4. Dla każdej gildii:
   - Fetch szczegóły członków
   - Sortowanie według mocy ataku
   - Cache wyników

```javascript
// Fetch guild data
const guildData = await apiService.fetchGuildData(guildId);

// Struktura danych:
{
    id: 12345,
    name: "Guild Name",
    level: 16,
    grade: "Legend 2",
    gradeScore: "1025 +30",
    totalAttack: 38760000,
    totalRelicCores: 3415,
    members: [
        {
            name: "Player1",
            attack: 2850000,
            relicCores: 45
        },
        // ...
    ]
}
```

**2. Inteligentne Wyszukiwanie Gildii**

**Plik:** `Gary/services/guildSearchService.js`

Algorytm fuzzy matching:
```javascript
// Strategie dopasowywania z wagami
const strategies = {
    exactMatch: 1.0,        // Dokładne dopasowanie
    startsWith: 0.9,        // Zaczyna się od
    contains: 0.8,          // Zawiera
    reverseContains: 0.7,   // Odwrócone zawiera
    levenshtein: 0.6        // Odległość Levenshteina
};

// Obliczanie podobieństwa
const similarity = calculateSimilarity(query, guildName);
```

Tryby wyszukiwania:
- **TOP500**: Cache'owane dane (szybkie)
- **GLOBAL**: Live search na garrytools.com (dokładne)

**3. Cache Rankingów**

**Plik:** `Gary/services/dataService.js`

Struktura:
```json
{
    "clans": [
        {
            "rank": 1,
            "id": 12345,
            "name": "Top Guild",
            "level": 20,
            "grade": "Legend 3",
            "gradeScore": 1500,
            "relicCores": 5000,
            "totalAttack": 50000000,
            "members": []
        }
    ],
    "lastRefresh": 1704067200000
}
```

Odświeżanie:
- Automatyczne co 24h
- Ręczne przez `/refresh`
- Podczas startu bota

**4. System Proxy**

**Plik:** `Gary/services/proxyService.js`

**Webshare API Integration:**
```javascript
// Automatyczne pobieranie listy proxy
const proxies = await proxyService.refreshFromWebshare();

// Format: http://username:password@proxy:port
```

**Strategie Rotacji:**
- **round-robin**: Sekwencyjne przełączanie
- **random**: Losowy wybór

**Health Monitoring:**
- Test każdego proxy przed użyciem
- Automatyczne wyłączanie niedziałających
- Failover na działające proxy

**Komendy zarządzania:**
- `/proxy-test` - Test wszystkich proxy
- `/proxy-stats` - Statystyki i konfiguracja
- `/proxy-refresh` - Odśwież z Webshare API

**5. Publiczna Paginacja**

Funkcjonalność:
- 20 członków na stronę
- Timeout 1 godzina
- **Każdy może nawigować** (nie tylko autor komendy)
- Przyciski: ◀️ Previous | Next ▶️

**6. Cotygodniowa Analiza Lunar Mine**

**Plik:** `Gary/index.js`

Automatyczna zaplanowana analiza Lunar Mine:
- Cron job: Każda środa o 18:45 (`45 18 * * 3`)
- Automatyczne wykonanie komendy `/lunarmine`
- Analiza 4 gildii podczas ekspedycji
- Wysłanie wyników na whitelistowany kanał
- Logowanie wykonania i ewentualnych błędów

**7. Obsługa Wątków**

Gary Bot obsługuje komendy również w wątkach kanałów whitelistowanych:
- Wykrywanie wątków przez sprawdzenie `parentId`
- Jeśli wątek należy do whitelistowanego kanału, komenda jest wykonywana
- Umożliwia organizację dyskusji w osobnych wątkach
- Kompatybilne ze wszystkimi komendami bota

**8. Niestandardowe Emoji**

Wsparcie emoji serwerowych w embedach:
```javascript
const rcEmoji = '<:II_RC:1385139885924421653>'; // Relic Cores
```

#### Komendy Slash

```javascript
// /lunarmine
// Analizuj 4 gildie podczas ekspedycji (Admin)
const guilds = await apiService.fetchLunarMineGuilds();

// /search <name> [mode]
// Szukaj gildii (Publiczne)
// mode: TOP500 (cache) lub GLOBAL (live)
const results = await guildSearchService.search(name, mode);

// /analyse <id>
// Analiza pojedynczej gildii + 3 stałe (Admin)
const guild = await apiService.fetchGuildData(id);

// /player <name>
// Wyszukiwanie graczy w cache (Publiczne)
const players = await dataService.searchPlayers(name);

// /ee <name>
// Wyszukiwanie EndersEcho (Publiczne)
const players = await dataService.searchEndersEcho(name);

// /refresh
// Odśwież rankingi (Admin)
await dataService.refreshRankings();

// /proxy-test
// Test wszystkich proxy (Admin)
const results = await proxyService.testAllProxies();

// /proxy-stats
// Statystyki proxy (Admin)
const stats = proxyService.getStats();

// /proxy-refresh
// Odśwież z Webshare API (Admin)
await proxyService.refreshFromWebshare();
```

#### Zmienne Środowiskowe

```env
GARY_TOKEN=bot_token
GARY_CLIENT_ID=client_id
GARY_ALLOWED_CHANNEL_ID=channel1,channel2
GARY_ADMIN_ROLES=role1,role2
GARY_PROXY_ENABLED=true
GARY_PROXY_STRATEGY=round-robin
GARY_PROXY_LIST=http://proxy1:port,http://proxy2:port
GARY_WEBSHARE_URL=https://proxy.webshare.io/api/v2/proxy/list/
```

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

### 1. Zasady Logowania

**ZAWSZE:**
```javascript
const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('NazwaBota');
logger.info('Informacja');
```

**NIGDY:**
```javascript
console.log('Informacja'); // ❌ BŁĄD
console.error('Błąd');      // ❌ BŁĄD
```

### 2. Obsługa Błędów

```javascript
try {
    await riskyOperation();
} catch (error) {
    logger.error(`Błąd podczas operacji: ${error.message}`);
    // Opcjonalnie: powiadom użytkownika
    await interaction.reply({
        content: 'Wystąpił błąd. Spróbuj ponownie.',
        ephemeral: true
    });
}
```

### 3. Konfiguracja

- Wszystkie wrażliwe dane w `.env`
- Konfiguracja bota w `config/config.js`
- Walidacja zmiennych środowiskowych przy starcie

```javascript
const requiredEnvVars = ['BOT_TOKEN', 'CHANNEL_ID'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne:', missingVars.join(', '));
    process.exit(1);
}
```

### 4. Persistencja Danych

```javascript
const fs = require('fs').promises;
const path = require('path');

// Zapis
async function saveData(data) {
    const filePath = path.join(__dirname, '../data/file.json');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Odczyt
async function loadData() {
    const filePath = path.join(__dirname, '../data/file.json');
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
}
```

### 5. Graceful Shutdown

```javascript
process.on('SIGINT', async () => {
    logger.warn('🛑 Zamykanie bota...');
    // Zapisz dane
    await saveAllData();
    // Wyloguj klienta
    client.destroy();
    process.exit(0);
});
```

---

## Rozwiązywanie Problemów

### OCR Nie Działa

1. Sprawdź jakość obrazu (min 800x600px)
2. Włącz debug: `/ocr-debug true`
3. Sprawdź przetworzone obrazy w `processed_ocr/`
4. Zweryfikuj języki Tesseract: polski + angielski

### Błędy Proxy (Gary Bot)

1. Test proxy: `/proxy-test`
2. Sprawdź konfigurację w `.env`
3. Odśwież z Webshare: `/proxy-refresh`
4. Sprawdź logi: `tail -f logs/bots.log`

### Konflikty Nicków

1. Sprawdź `shared_data/active_nickname_effects.json`
2. Sprawdź logi nickname managera
3. Usuń ręcznie wygasłe efekty jeśli potrzeba

### Problemy z Pamięcią

1. Monitoruj rotację obrazów OCR (max 400)
2. Sprawdź cache mediów Muteusz (max 2GB)
3. Wyczyść tymczasowe pliki: `rm -rf */temp/*`

### Rate Limiting Discord

1. Sprawdź kolejkę webhook w loggerze
2. Ogranicz liczbę równoczesnych requestów
3. Użyj delay między operacjami

### Bot Nie Startuje

1. Sprawdź logi: `logs/bots.log`
2. Weryfikuj zmienne środowiskowe
3. Sprawdź uprawnienia Discorda
4. Testuj pojedynczo: `npm run botname`

### Backup Google Drive Nie Działa

**Problem: "Backup działał pierwszy dzień, potem przestał"**
- **Przyczyna:** Token OAuth wygasł i nie został automatycznie odświeżony
- **Rozwiązanie:** BackupManager ma teraz automatyczne odświeżanie tokenów (event listener na 'tokens')
- **Weryfikacja:** Sprawdź logi czy widzisz `🔄 Odświeżono access_token - zapisuję do pliku`

**Problem: "Invalid credentials" lub "401 Unauthorized"**
1. Wygeneruj nowy token: `node authorize-google.js`
2. Skopiuj nowy `token.json` na serwer
3. Restart aplikacji
4. Sprawdź czy `GOOGLE_CREDENTIALS_PATH` wskazuje na poprawny plik

**Problem: "403 Forbidden"**
1. Sprawdź uprawnienia w Google Cloud Console
2. Upewnij się że Google Drive API jest włączone
3. Sprawdź czy nie przekroczono limitu API (quota)
4. Sprawdź czy aplikacja ma dostęp do Google Drive w ustawieniach konta

**Problem: "Token ma więcej niż 50 refresh tokenów"**
- Google ma limit 50 refresh tokenów per użytkownik/aplikacja
- Stare tokeny są automatycznie unieważniane
- **Rozwiązanie:** Użyj tylko jednego tokenu na produkcji, nie generuj nowych co dzień

---

## Historia Zmian

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
- Rola specjalna dla CX 2800+
- Ulepszone ostrzeżenia loterii (tylko Daily/CX)
- Automatyczna detekcja DST

---

**KONIEC DOKUMENTACJI**

Dla dalszych pytań lub aktualizacji, edytuj ten plik zgodnie ze zmianami w kodzie.
