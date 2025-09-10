# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca dziewięć specjalistycznych botów z centralnym systemem logowania i zarządzania.

## Boty

### 🎯 Gary Bot - **NOWY!**
Analizuje dane z gry Survivor.io przy użyciu API Garrytools. Umożliwia wyszukiwanie gildii, graczy i danych EndersEcho. Obsługuje analizę Lunar Mine Expedition oraz rozpoznawanie gildii z zdjęć OCR. Wspiera wiele serwerów i system proxy dla bardziej zaawansowanych operacji.

### 🎯 Rekruter Bot
Automatyzuje proces rekrutacji nowych członków. Sprawdza kwalifikacje graczy poprzez analizę przesłanych zdjęć statystyk i pomaga w procesie dołączania do odpowiedniego klanu. Zawiera szybkie komendy do informacji o klanach oraz **system powiadomień o boostach** - automatyczne wiadomości dziękczynne dla osób boostujących serwer.

### 🎓 Szkolenia Bot
Zarządza szkoleniami i wątkami treningowymi. Tworzy strukturę szkoleń z automatycznymi przypomnieniami dla uczestników, aby nikt nie zapomniał o ważnych sesjach treningowych.

### ⚔️ Stalker LME Bot
System karania dla graczy w grach boss fightów. Analizuje zdjęcia wyników walk i automatycznie karze punktami tych, którzy mają 0 damage/score. Zawiera system ostrzeżeń, automatyczne resetowanie punktów oraz **system zarządzania urlopami** z automatycznym monitorowaniem kanału i czasowymi ograniczeniami składania wniosków.

### 🤖 Muteusz Bot
Wielofunkcyjny bot moderacyjny. Automatycznie przepisuje media między kanałami, moderuje treść wiadomości, zarządza rolami użytkowników i przywraca je po powrocie. Obsługuje również system wykroczeń i ostrzeżeń. **Losowe odpowiedzi PepeSoldier** - użytkownicy z medalem Virtutti Papajlari mają szansę 1/250 na otrzymanie losowej odpowiedzi z emoji PepeSoldier.

### 🏆 EndersEcho Bot
Bot rankingowy dla graczy. Analizuje wyniki gier z przesłanych zdjęć, tworzy rankingi najlepszych graczy i automatycznie przyznaje role TOP. Obsługuje różne formaty wyników i jednostki liczbowe. **Ulepszona korekcja OCR** - automatycznie poprawia błędy odczytu (TT→1T, 7→T, 0→Q). **Ulepszone logowanie** - wyświetla konkretne wartości znalezione po "Best:" i "Total:" zamiast tylko true/false, zredukowane duplikaty logów dla czystszego outputu.

### 🎯 Kontroler Bot
Weryfikuje wyniki dla kanałów Daily i CX oraz zarządza zaawansowanym systemem loterii. Sprawdza czy przesłane zdjęcia wyników są poprawne, czy nick gracza jest widoczny na screenie i czy wyniki spełniają minimalne wymagania. **Nowy system loterii** z dokładnym planowaniem dat (dd.mm.yyyy), automatyczną obsługą strefy czasowej polskiej z DST, inteligentnym systemem ostrzeżeń i zabezpieczeniami przed limitami JavaScript. Obsługuje loterie jednorazowe i cykliczne (1-365 dni) z automatyczną migracją starych struktur danych.

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
npm run gary        # Nowy bot Gary
```

### Konfiguracja botów:
Plik `bot-config.json` określa które boty uruchamiać:
```json
{
  "production": ["rekruter", "szkolenia", "stalkerlme", "muteusz", "endersecho", "kontroler", "konklawe", "wydarzynier", "gary"],
  "development": ["gary"]
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

### 🏷️ Centralny System Zarządzania Nickami

**Problem**: Boty Konklawe (klątwy) i Muteusz (flagi) zmieniały nicki użytkowników, ale przywracały do głównego nicku zamiast oryginalnego serwerowego nicku, i mogły się konfliktować między sobą.

**Rozwiązanie**: Scentralizowany system zarządzania nickami w `utils/nicknameManagerService.js`

#### Kluczowe funkcjonalności:
- **🚫 Zapobieganie konfliktom**: Koordynacja między botami - blokuje nakładanie tego samego typu efektu
- **🔄 Nakładanie efektów**: Pozwala na nakładanie różnych typów (klątwa + flaga) z zachowaniem oryginalnego nicku
- **💾 Zachowanie oryginalnych nicków**: Przywraca dokładnie to co użytkownik miał (nick serwerowy vs nick główny)
- **⏰ Automatyczne czyszczenie**: Usuwa wygasłe efekty i utrzymuje spójność danych
- **📊 Monitorowanie**: Śledzenie aktywnych efektów i statystyki systemu

#### Typy efektów:
- **CURSE** (Konklawe): Dodaje prefiks "Przeklęty " do nicków z konfigurowalnymi czasami
- **FLAG** (Muteusz): Zmienia nick na flagi krajów (🇺🇦, 🇵🇱, 🇮🇱, 🇺🇸, 🇩🇪, 🇷🇺) na 5 minut

#### Przykład działania:
```
1. Użytkownik "Janusz" (nick serwerowy) dostaje klątwę
   → Nick: "Przeklęty Janusz" (zapisany oryginalny: "Janusz")

2. Janusz dostaje flagę ukraińską  
   → Nick: "Slava Ukrainu!" (oryginalny nadal: "Janusz")

3. Efekt zostaje usunięty
   → Nick: "Janusz" (przywrócony oryginalny, nie "Przeklęty Janusz")
```

#### Pliki konfiguracyjne:
- **Konfiguracja**: `shared_data/nickname_manager_config.json`  
- **Aktywne efekty**: `shared_data/active_nickname_effects.json`
- **Automatyczna inicjalizacja**: Zintegrowane z sekwencjami startowymi botów
- **Logowanie debug**: Szczegółowe logi aplikacji i przywracania efektów

## System OCR i Debugowanie

### 🔍 Zaawansowane funkcje OCR
- **Pięć botów z OCR**: Rekruter, StalkerLME, EndersEcho, Kontroler, **Gary** (nowy!)
- **Wspólny folder przetworzonych obrazów**: `processed_ocr/` w katalogu głównym  
- **Format nazw plików**: `[BOTNAME][ hh:mm:ss rrrr-mm-dd ][]` lub `[KONTROLER][ hh:mm:ss rrrr-mm-dd ][daily/cx]`
- **Automatyczna rotacja**: maksymalnie 400 plików dla wszystkich botów razem
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
[GARY][ 14:27:30 2025-08-02 ][].png            # Rozpoznawanie gildii
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

# Przykład - Gary/.env
GARY_TOKEN=your_discord_bot_token
GARY_CLIENT_ID=your_client_id
GARY_ALLOWED_CHANNEL_ID=channel_id_1,channel_id_2
GARY_ADMIN_ROLES=role_id_1,role_id_2
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
- `GARY_TOKEN` - Token Discord dla bota Gary (**nowy!**)
- `GARY_CLIENT_ID` - Client ID dla bota Gary
- `GARY_ALLOWED_CHANNEL_ID` - Kanały gdzie Gary może działać (obsługuje wiele serwerów)
- `GARY_ADMIN_ROLES` - Role z dostępem do komend administracyjnych (opcjonalne)

## Porównanie Funkcji Botów

| Bot | OCR | Slash Commands | Multi-Server | Proxy Support | Auto-Tasks |
|-----|-----|----------------|--------------|---------------|------------|
| **Gary** | ❌ | ✅ | ✅ | ✅ | ✅ |
| Rekruter | ✅ | ✅ | ❌ | ❌ | ✅ |
| Szkolenia | ❌ | ✅ | ❌ | ❌ | ✅ |
| StalkerLME | ✅ | ✅ | ❌ | ❌ | ✅ |
| Muteusz | ❌ | ✅ | ❌ | ❌ | ✅ |
| EndersEcho | ✅ | ✅ | ❌ | ❌ | ❌ |
| Kontroler | ✅ | ✅ | ❌ | ❌ | ✅ |
| Konklawe | ❌ | ✅ | ❌ | ❌ | ✅ |
| Wydarzynier | ❌ | ✅ | ❌ | ❌ | ✅ |

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
- Maksymalnie 400 plików - najstarsze automatycznie usuwane