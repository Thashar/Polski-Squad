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
- 🌙 **Analiza Lunar Expedition** - Kompleksowa analiza 4 gildii podczas wydarzeń
- 🔍 **Inteligentne Wyszukiwanie** - Fuzzy matching nazw gildii z konfigurowalnymi progami podobieństwa
- 🌐 **Integracja API** - Dane w czasie rzeczywistym z garrytools.com z automatycznym odświeżaniem
- 🔄 **Cache'owane Rankingi** - Top 500 gildii z 6-godzinnymi cyklami odświeżania
- 🛡️ **Wsparcie Proxy** - Różnorodność sieci z monitorowaniem zdrowia i automatycznym failover
- 📄 **Publiczna Paginacja** - Interaktywne strony które każdy może nawigować (20 członków/strona)

**Komendy:**
- `/lunarmine` - Analizuj 4 gildie podczas ekspedycji Lunar Mine (Admin)
- `/search <nazwa> [tryb]` - Szukaj gildii (TOP500/GLOBAL)
- `/analyse <id_gildii>` - Analiza pojedynczej gildii z zastępowaniem (Admin)
- `/player <nazwa>` - Wyszukiwanie graczy w cache'owanych rankingach
- `/ee <nazwa>` - Wyszukiwanie graczy EndersEcho
- `/refresh` - Ręczne odświeżenie danych rankingu (Admin)
- `/proxy-test` - Test wszystkich skonfigurowanych proxy (Admin)

---

### 🎯 **Rekruter Bot** - *Zaawansowany System Rekrutacji*
> Wieloetapowa weryfikacja z kontrolą kwalifikacji OCR i śledzeniem boostów

**Funkcje:**
- 📝 **Proces Wieloetapowy** - Narodowość → Cel → Weryfikacja statystyk z inteligentnym przewodnikiem
- 🔍 **Analiza Statystyk OCR** - Ekstrakcja mocy postaci ze zrozumieniem 50 regionów obrazu
- 🎉 **Śledzenie Boostów** - 10 unikalnych wiadomości gratulacyjnych + powiadomienia bonusowe na dual-kanały
- ⏰ **Monitorowanie Ról** - 24-godzinne śledzenie niekompletnych profili z automatycznymi ostrzeżeniami
- 🎮 **Szybkie Komendy** - `!clan`, `!clan0`, `!clan1`, `!clan2` dla informacji klanowych
- 🎭 **Zarządzanie Nickami** - Ekstrakcja i walidacja z dopasowywaniem podobieństwa

**System Kwalifikacji Klanów:**
- **Poniżej 100K ataku**: Brak kwalifikacji do klanu
- **100K-599K**: Rekomendacja Clan0
- **600K-799K**: Rekomendacja Clan1
- **800K-999K**: Rekomendacja Clan2
- **1000K+**: Rekomendacja głównego klanu

---

### 🎓 **Szkolenia Bot** - *Zarządzanie Szkoleniami*
> System szkoleń oparty na wątkach z automatycznym cyklem życia i kompleksowymi wytycznymi

**Funkcje:**
- 🧵 **Tworzenie Wątków** - Wyzwalanie reakcji emoji N_SSS z kontrolą uprawnień
- ⏰ **Auto-cykl Życia** - Archiwizacja po 24h nieaktywności, usunięcie po 7 dniach łącznie
- 🔔 **System Przypomnień** - 24-godzinne powiadomienia o nieaktywności z persistent storage
- 🎮 **Interaktywne Zarządzanie** - Przyciski zamknij/zostaw-otwarte dla właścicieli wątków
- 📖 **Kompleksowe Wytyczne** - Sprzęt, części tech, kolekcjonerskie, zwierzęta, postacie, tryby gry

**Szczegółowe Instrukcje:**
- **Wymagania Sprzętu** - Zrzuty ekranu sprzętu postaci
- **Części Tech** - Specyfikacje poziomów Rezonansu
- **Zwierzęta & Xeno** - Poziomy przebudzenia i instrukcje
- **Podsumowania Przedmiotów** - Kalkulacje dla różnych typów i walut

---

### ⚔️ **StalkerLME Bot** - *Egzekwowanie Udziału w Bossach*
> System kar napędzany OCR z zarządzaniem wakacjami i cotygodniowym czyszczeniem

**Funkcje:**
- 🔍 **Wykrywanie OCR** - Automatycznie identyfikuje graczy z 0 obrażeń/punktów w walkach z bossami
- ⚖️ **Inteligentne Kary** - Stopniowany system punktowy (2+ = rola kary, 3+ = ban loterii)
- 🏖️ **System Wakacji** - Interaktywne wnioski z 15-minutowym timeoutem i 6-godzinnym cooldownem
- 📅 **Cotygodniowe Czyszczenie** - Automatyczna redukcja punktów w poniedziałek o północy
- 🎯 **Ostrzeżenia Specyficzne dla Klanu** - Ukierunkowane powiadomienia do odpowiednich kanałów
- 🔧 **Zaawansowane Przetwarzanie** - Upscaling, korekcja gamma, filtrowanie i wyostrzanie obrazów

**Funkcje OCR:**
- **Wykrywanie Niepewności** - Wyświetla obrazy gdy symbol © wskazuje niepewność
- **Zapobieganie Duplikatom** - Blokuje wielokrotne kary dla tego samego gracza w jednym obrazie
- **Enhancement Obrazów** - Zoptymalizowana gamma, kontrast dla dokładności OCR

---

### 🤖 **Muteusz Bot** - *Zaawansowana Moderacja*
> Kompleksowa auto-moderacja z cache'owaniem mediów i zarządzaniem rolami

**Funkcje:**
- 🛡️ **Auto-moderacja** - Wykrywanie spamu, polskie filtrowanie wulgaryzmów, blokowanie zaproszeń Discord
- 💾 **Cache'owanie Mediów** - Wsparcie plików 100MB z inteligentnym cache 2GB i 24h retencją
- 🎭 **Zarządzanie Rolami** - Grupy ekskluzywne z automatycznym rozwiązywaniem konfliktów i 5s walidacją
- 🎲 **Funkcje Specjalne** - Losowe odpowiedzi PepeSoldier (szansa 1/250) dla posiadaczy Virtutti Papajlari
- ⚠️ **Śledzenie Naruszeń** - System ostrzeżeń dla całego serwera z historią
- 🔄 **Koordinacja Cross-Bot** - Integracja z Rekruter bot dla czyszczenia użytkowników

**System Eskalacji:**
- **Progresja**: Ostrzeżenie → Wyciszenie → Timeout → 7-dniowy timeout
- **System Odzyskiwania** - Przywraca multimedia dla usuniętych/edytowanych wiadomości
- **Zarządzanie Komendami** - Możliwość wyrejestrowywania niechcianych komend serwera

---

### 🏆 **EndersEcho Bot** - *System Rankingów Bossów*
> Śledzenie wyników napędzane OCR z automatycznym zarządzaniem rolami TOP

**Funkcje:**
- 🔍 **Analiza Wyników OCR** - Rozpoznawanie polsko/angielskie z automatyczną korekcją błędów (TT→1T, 7→T, 0→Q)
- 📊 **Trwałe Rankingi** - Interaktywne tabele wyników z paginacją i kompletną historią
- 👑 **System Ról TOP** - 4-poziomowe automatyczne zarządzanie (TOP 1, 2-3, 4-10, 11-30)
- 🔧 **Wsparcie Jednostek** - Konwersje numeryczne K, M, B, T, Q, Qi z zaawansowanym parsowaniem
- 📈 **Śledzenie Historyczne** - Kompletna historia wyników z timestampami i nazwami bossów
- 🥇 **System Medali** - Wizualne wskaźniki (🥇🥈🥉) dla najlepszych wykonawców

**Zaawansowane Funkcje:**
- **Ekstrakcja Nazw Bossów** - Inteligentna ekstrakcja z metodami fallback
- **Podświetlanie Użytkowników** - Specjalne formatowanie dla żądającego użytkownika
- **Dynamiczne Aktualizacje** - Role aktualizowane po każdym wysłaniu wyniku

---

### 🎯 **Kontroler Bot** - *Weryfikacja Dwukanałowa + Zaawansowana Loteria*
> Weryfikacja OCR z wyrafinowanym systemem loterii i polską strefą czasową

**Funkcje:**
- 👀 **Podwójne Monitorowanie** - Kanał CX (2000+ punktów) i Kanał Daily (910+ punktów) z różnymi konfiguracjami
- 🎰 **Zaawansowana Loteria** - Planowanie oparte na datach z automatyczną detekcją DST
- 🏰 **Wsparcie Wielu Klanów** - Server-wide, Main Squad, Squad 0/1/2 z inteligentnym zarządzaniem rolami
- ⚠️ **Inteligentne Ostrzeżenia** - Automatyczne alerty 90-minutowe i 30-minutowe tylko dla Daily/CX
- 📅 **Elastyczne Planowanie** - Cykle loterii od jednorazowych (0 dni) do rocznych (365 dni)
- 🚫 **Blokowanie Kar** - Automatyczne filtrowanie użytkowników z rolami kar

**Funkcje OCR:**
- **Dopasowywanie Podobieństwa** - Konfigurowalne progi (40% i 30%)
- **Normalizacja Znaków** - Zaawansowany system zastępowania (o→0, z→2, sg→9)
- **Wymaganie Drugiego Wystąpienia** - Daily wymaga wielokrotnego wystąpienia nicku

**System Loterii:**
- **Precyzyjne Planowanie** - Format dd.mm.yyyy z polską strefą czasową
- **Bezpieczeństwo Timeout** - Ochrona przed limitami JavaScript (max 24 dni)
- **Śledzenie Historyczne** - Kompletna historia z możliwościami przelosowania

---

### ⛪ **Konklawe Bot** - *Interaktywna Gra Słowna*
> Gra hasłowa o tematyce papieskiej z systemem osiągnięć i timer automation

**Funkcje:**
- 🎮 **Gra Hasłowa** - Domyślne "Konklawe" z opcjami niestandardowych haseł
- 🏅 **System Osiągnięć** - Medale Virtutti Papajlari za 30+ poprawnych odpowiedzi z resetem rankingu
- ⏰ **Inteligentne Timery** - Wielopoziomowe przypomnienia (15min, 30min, 1h) z auto-reset 15min
- 🙏 **Specjalne Komendy** - `/blessing` (12 wariantów) i `/virtue-check` (10 cnót) dla posiadaczy medali
- 💫 **Losowe Odpowiedzi** - Szansa 1/100 na odpowiedzi JP2roll emoji dla użytkowników papieskich
- 📊 **Kompleksowe Statystyki** - Interaktywna nawigacja przyciskami dla rankingów, medali i historii

**Funkcje Timer & Automation:**
- **Przywracanie Timerów** - Automatyczne odzyskiwanie po crashach
- **24h Cleanup** - Automatyczne usuwanie ról papieskich
- **System Podpowiedzi** - Timestamped hints od użytkowników papieskich
- **Persistent State** - Stan gry utrzymywany przez restarty

---

### 🎉 **Wydarzynier Bot** - *Zarządzanie Wydarzeniami i Imprezami*
> System lobby imprez z organizacją opartą na wątkach i usługami bazarowymi

**Funkcje:**
- 🏟️ **Lobby Imprez** - Pojemność 7 graczy (1 właściciel + 6 członków maksymalnie)
- 🧵 **Organizacja Wątków** - Prywatne wątki z automatyczną kontrolą członków i zarządzaniem cyklem życia
- 🛡️ **Ochrona Przed Griefingiem** - Tylko zaakceptowani gracze mogą uczestniczyć, wyjątki dla adminów
- 📢 **Subskrypcje Ról** - Powiadomienia o ogłoszeniach imprez z interaktywnym toggle
- 📌 **Usługi Bazaru** - Przypinanie wiadomości i zarządzanie marketplace z automatycznym wykrywaniem
- ⏰ **15-minutowy Okres Dyskusji** - Po zapełnieniu lobby przed automatycznym czyszczeniem

**Zaawansowane Funkcje:**
- **System Zaproszeń** - Przyciski akceptuj/odrzuć dla właścicieli lobby
- **System Repozytorium** - Przenosi ogłoszenia party na górę co 5 minut
- **Ostrzeżenia 5-minutowe** - Przed automatycznym zamknięciem lobby
- **Integracja Wydarzeń** - Koordynacja z wydarzeniami i aktywnościami serwera

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
- ⚡ **Ograniczone częstotliwością** logowanie Discord z zarządzaniem kolejką (1s delay)
- 🚀 **Zoptymalizowany start** - Jednoliniowe komunikaty statusu botów (✅ [BotName] gotowy)

#### 🏷️ **Centralny Manager Nicków**
```javascript
const nicknameManager = require('./utils/nicknameManagerService');

await nicknameManager.applyEffect(userId, 'CURSE', duration, metadata);
await nicknameManager.removeEffect(userId, effectId);
```

**Funkcje:**
- 🔄 **Koordynacja Cross-bot** - Zapobiega konfliktom między Konklawe (klątwa) i Muteusz (flaga)
- 💾 **Zachowanie Oryginalnego** - Zawsze przywraca prawdziwe serwer nicknames, nie pośrednie efekty
- 📚 **Nakładanie Efektów** - Obsługuje nakładające się efekty (curse + flag) z inteligentnym przywracaniem
- 🧹 **Automatyczne Czyszczenie** - Usuwa wygasłe efekty i utrzymuje spójność danych
- 📊 **Śledzenie Statystyk** - Liczby aktywnych efektów według typu

**Typy Efektów:**
- **CURSE** (Konklawe): "Przeklęty " prefix z konfigurowalnym czasem trwania
- **FLAG** (Muteusz): Flagi krajowe (ukraińska, polska, izraelska, itp.) na 5 minut

#### 👁️ **System Przetwarzania OCR**
```javascript
const { saveProcessedImage, enhanceImage } = require('./utils/ocrFileUtils');

const processedImage = await enhanceImage(imageBuffer);
await saveProcessedImage(processedImage, 'BOTNAME', metadata);
```

**Funkcje:**
- 📁 **Współdzielone przechowywanie** - Katalog `processed_ocr/` dla wszystkich botów
- 🏷️ **Standaryzowane nazewnictwo** - `[BOTNAME][ rrrr-mm-dd hh:mm:ss ][]` / `[KONTROLER][ rrrr-mm-dd hh:mm:ss ][daily/cx]`
- 🔄 **Automatyczna rotacja** - Max 400 plików z czyszczeniem (100 per bot type)
- 🐛 **Tryb debug administratora** - Przełączanie przez `/ocr-debug` command
- 🔧 **Wielojęzyczne wsparcie** - Polski/angielski dla Tesseract

### Wzorzec Architektury Botów
```
NazwaBota/
├── index.js           # Główny bot z konfiguracją klienta Discord
├── config/
│   ├── config.js      # Konfiguracja bota i stałe
│   └── messages.js    # Szablony wiadomości (niektóre boty)
├── handlers/
│   ├── interactionHandlers.js  # Obsługa zdarzeń przycisków/interakcji
│   ├── messageHandlers.js      # Obsługa zdarzeń wiadomości
│   └── reactionHandlers.js     # Obsługa zdarzeń reakcji
├── services/
│   └── [różne].js     # Logika biznesowa serwisów
├── utils/
│   └── helpers.js     # Funkcje narzędziowe
└── data/              # Trwałe przechowywanie JSON
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
# Tokeny Botów
REKRUTER_TOKEN=your_bot_token_here
SZKOLENIA_TOKEN=your_bot_token_here
STALKER_LME_TOKEN=your_bot_token_here
MUTEUSZ_TOKEN=your_bot_token_here
ENDERSECHO_TOKEN=your_bot_token_here
KONTROLER_TOKEN=your_bot_token_here
KONKLAWE_TOKEN=your_bot_token_here
WYDARZYNIER_TOKEN=your_bot_token_here

# Konfiguracja Gary Bot
GARY_TOKEN=your_bot_token_here
GARY_CLIENT_ID=your_client_id_here
GARY_ALLOWED_CHANNEL_ID=1234567890123456789,9876543210987654321
GARY_ADMIN_ROLES=1234567890123456789,9876543210987654321

# Opcjonalne: Konfiguracja Proxy (Gary Bot)
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

## 📊 Stos Technologii

### Główne Technologie
- **[Discord.js v14](https://discord.js.org/)** - Główna biblioteka API Discord
- **[Tesseract.js](https://tesseract.projectnaptha.com/)** - Rozpoznawanie tekstu OCR (5 botów)
- **[Sharp](https://sharp.pixelplumbing.com/)** - Wysokowydajne przetwarzanie obrazów
- **[node-cron](https://www.npmjs.com/package/node-cron)** - Planowanie zadań i automatyzacja
- **[Canvas](https://www.npmjs.com/package/canvas)** - Manipulacja obrazami dla OCR enhancement

### Dodatkowe Zależności
- **[axios](https://axios-http.com/)** - Klient HTTP (integracja API Gary bot)
- **[cheerio](https://cheerio.js.org/)** - Parsowanie HTML po stronie serwera
- **[https-proxy-agent](https://www.npmjs.com/package/https-proxy-agent)** - Wsparcie proxy z failover
- **[dotenv](https://www.npmjs.com/package/dotenv)** - Konfiguracja środowiska
- **[lz-string, lzma, pako](https://www.npmjs.com/)** - Kompresja danych dla różnych botów

---

## 🔧 Rozwój

### Konfiguracja Produkcji
Plik `bot-config.json` kontroluje które boty działają w różnych środowiskach:

```json
{
  "production": [
    "rekruter", "endersecho", "szkolenia", "stalkerlme",
    "kontroler", "konklawe", "muteusz", "wydarzynier", "gary"
  ],
  "development": ["gary"]
}
```

### Funkcje Debug

#### Tryb Debug OCR
Wszystkie boty OCR obsługują szczegółowe logowanie przez komendy administratora:
```bash
/ocr-debug true   # Włącz szczegółowe logowanie OCR
/ocr-debug false  # Wyłącz szczegółowe logowanie OCR
/ocr-debug        # Sprawdź aktualny status
```

#### System Logowania
Dostęp do logów w:
- **Konsola**: Wyjście kolorowe w czasie rzeczywistym z inteligentnymi separatorami
- **Plik**: `logs/bots.log` z timestampami
- **Discord**: Powiadomienia webhook (rate-limited, ID: 1393028610910326844)

#### Przetworzone Obrazy
Obrazy przetworzone OCR są automatycznie zapisywane w:
- **Katalog**: `processed_ocr/` (współdzielony przez wszystkie boty)
- **Nazewnictwo**: `[NAZWA_BOTA][ rrrr-mm-dd hh:mm:ss ][]`
- **Auto-rotacja**: Max 400 plików z inteligentnym czyszczeniem

---

## 🛠️ Konfiguracja

### Ustawienia Specyficzne dla Botów

Każdy bot utrzymuje własną konfigurację w `NazwaBota/config/config.js`:

```javascript
module.exports = {
    // Ustawienia Discord
    token: process.env.BOTNAME_TOKEN,
    clientId: process.env.BOTNAME_CLIENT_ID,

    // Konfiguracje kanałów
    allowedChannelIds: ['1234567890123456789'],

    // Ustawienia OCR (jeśli dotyczy)
    ocr: {
        saveProcessedImages: true,
        detailedLogging: { enabled: false },
        maxProcessedFiles: 400,
        processedDir: path.join(__dirname, '../../processed_ocr')
    },

    // Funkcje specyficzne dla bota...
};
```

### Współdzielone Przechowywanie Danych

- **`shared_data/`** - Przechowywanie danych cross-bot (nickname manager)
- **`processed_ocr/`** - Przetworzone obrazy OCR (wszystkie boty)
- **`logs/`** - Scentralizowane pliki logów
- **`temp/`** - Pliki tymczasowe w katalogach każdego bota
- **`data/`** - Pliki bazy danych dla persistencji (JSON)

---

## 🎮 Główne Komendy Slash

### Komendy Administracyjne (wymagają uprawnień administratora)
- **`/ocr-debug [true/false]`** - Przełącz szczegółowe logowanie OCR (wszystkie boty OCR)
- **`/lottery`** - Utwórz loterię z 7 parametrami (Kontroler)
- **`/lottery-debug`** - Debug statusu systemu loterii (Kontroler)
- **`/punish`** - Ręczne przypisanie kary (StalkerLME)
- **`/remove`** - Usuń graczy z rankingów (EndersEcho)
- **`/lunarmine`** - Analizuj 4 gildie podczas ekspedycji (Gary)
- **`/analyse <id>`** - Analiza pojedynczej gildii (Gary)

### Komendy Publiczne
- **`/update`** - Wyślij wyniki walk z bossami (EndersEcho)
- **`/ranking`** - Zobacz prywatny ranking (EndersEcho)
- **`/search <nazwa>`** - Szukaj gildii (Gary)
- **`/player <nazwa>`** - Szukaj graczy (Gary)
- **`/statystyki`** - Interaktywne statystyki gry (Konklawe)
- **`/party`** - Utwórz lobby imprezy (Wydarzynier)

### Komendy Specjalne (wymagają ról)
- **`/blessing`** - Błogosław innych (medal Virtutti Papajlari - Konklawe)
- **`/virtue-check`** - Sprawdź cnoty (medal Virtutti Papajlari - Konklawe)
- **`/podpowiedz`** - Dodaj podpowiedź do gry (rola papieska - Konklawe)

---

## 🤝 Współpraca

### Styl Kodu
- **Spójna Architektura** - Podążaj za ustalonym wzorcem botów
- **Scentralizowane Logowanie** - Zawsze używaj `createBotLogger(botName)`
- **Obsługa Błędów** - Implementuj kompleksowe bloki try-catch
- **Zmienne Środowiskowe** - Wszystkie wrażliwe dane w `.env`

### Dodawanie Nowych Funkcji
1. **Używaj Istniejących Wzorców** - Podążaj za modularną architekturą
2. **Integruj z Narzędziami** - Wykorzystuj scentralizowane systemy
3. **Dokumentuj Zmiany** - Aktualizuj zarówno README jak i CLAUDE.md
4. **Testuj Dokładnie** - Weryfikuj kompatybilność cross-bot

### Przepływ Pracy Rozwoju
```bash
# Zainstaluj zależności
npm install

# Uruchom w trybie deweloperskim
npm run dev

# Testuj konkretny bot
npm run nazwa_bota

# Sprawdź logi
tail -f logs/bots.log
```

---

## 📄 Licencja

Ten projekt jest licencjonowany na licencji MIT - zobacz plik [LICENSE](LICENSE) dla szczegółów.

---

## 🆘 Wsparcie

### Dokumentacja
- **[CLAUDE.md](CLAUDE.md)** - Szczegółowa dokumentacja deweloperska w języku polskim
- **Konfiguracje Botów** - Poszczególne katalogi `NazwaBota/config/`
- **Logi** - `logs/bots.log` do rozwiązywania problemów

### Typowe Problemy
- **Brakujące Uprawnienia** - Upewnij się, że boty mają wymagane uprawnienia Discord
- **OCR Nie Działa** - Sprawdź jakość i format obrazu
- **Problemy z Pamięcią** - Monitoruj rotację przechowywania przetworzonych obrazów
- **Limity API** - Przejrzyj ograniczenie częstotliwości w logach
- **Konflikt Nicków** - Sprawdź system nickname manager w shared_data/
- **Błędy Proxy** - Testuj konfigurację proxy Gary bot z `/proxy-test`

### Funkcje Specificzne dla Botów
- **Rekruter**: Sprawdź walidację kwalifikacji klanów w OCR pipeline
- **Kontroler**: Weryfikuj konfigurację loterii i timeouty DST
- **Gary**: Testuj połączenia API Garrytools i cache'owanie danych
- **Muteusz**: Monitoruj usage cache mediów i rozwiązywanie konfliktów ról
- **EndersEcho**: Sprawdź historię rankingów i system ról TOP

---

<div align="center">

**Polski Squad Discord Bot Collection**
*Kompleksowa automatyzacja serwera z 9 wyspecjalizowanymi botami*

Stworzony z ❤️ przez Zespół Deweloperski Polski Squad

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-7289da.svg)](https://discord.gg/your-server)
[![GitHub Issues](https://img.shields.io/github/issues/your-repo.svg)](https://github.com/your-repo/issues)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>