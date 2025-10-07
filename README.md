# 🏰 Polski Squad - Kolekcja Botów Discord

> **Zaawansowany system automatyzacji serwera Discord z 9 wyspecjalizowanymi botami**

[![Discord.js](https://img.shields.io/badge/discord.js-v14.21.0-blue.svg)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](LICENSE)

**Ostatnia aktualizacja:** Styczeń 2025

---

## 🚀 Przegląd

Polski Squad to modularny system zarządzania serwerem Discord zawierający **9 wyspecjalizowanych botów** działających w jednym ekosystemie. Każdy bot obsługuje określone funkcje serwera, zachowując płynną integrację poprzez wspólne narzędzia i scentralizowane logowanie.

### ✨ Kluczowe Cechy

- 🎯 **Architektura Modularna** - 9 autonomicznych botów ze wspólnymi narzędziami
- 📊 **Scentralizowane Logowanie** - Ujednolicony system logów z kolorowaniem
- 🤖 **Zaawansowane OCR** - Automatyczna analiza obrazów (5 botów z Tesseract.js)
- 🔄 **System Zarządzania Nickami** - Centralne zarządzanie efektami nicków
- ⚡ **Produkcyjnie Gotowy** - Kompleksowa obsługa błędów
- 🌐 **Multi-Server Support** - Elastyczne wdrożenie

---

## 🤖 Kolekcja Botów

### 🎯 Rekruter Bot - *System Rekrutacji*
Wieloetapowy proces rekrutacji z analizą OCR statystyk postaci i automatycznym przypisywaniem do klanów (100K-599K: Clan0, 600K-799K: Clan1, 800K-1.19M: Clan2, 1.2M+: Main). Śledzenie boostów serwera i monitorowanie użytkowników bez ról.

**Główne Komendy:** `/nick`

---

### 🎓 Szkolenia Bot - *Zarządzanie Szkoleniami*
System wątków treningowych tworzonych przez reakcję emoji. Automatyczna archiwizacja po 24h, zamknięcie po 7 dniach. Przypomnienia o nieaktywności i kompleksowe wytyczne dotyczące sprzętu, tech partów, collectibles i postaci.

**Główne Komendy:** Automatyczny system bez komend

---

### ⚔️ StalkerLME Bot - *System Kar*
Zbiera wyniki z rozgrywek klanowych (Lunar Expedition) przez OCR - Faza 1 (screeny całej listy uczestników) i Faza 2 (3 rundy walki z bossem). Wykrywa graczy z 0 obrażeń. System punktowy (2+: kara, 3+: ban loterii). Zarządzanie urlopami, cotygodniowe czyszczenie punktów. Dekoder buildów Survivor.io.

**Główne Komendy:** `/decode`, `/faza1`, `/faza2`, `/wyniki`

---

### 🤖 Muteusz Bot - *Kompleksowa Moderacja*
Auto-moderacja (spam, wulgaryzmy, zaproszenia). Cache mediów do 100MB. Zarządzanie rolami ekskluzywnymi. Śledzenie naruszeń. Koordynacja z Rekruterem do czyszczenia użytkowników.

**Główne Komendy:** `/special-roles`, `/violations`

---

### 🏆 EndersEcho Bot - *Rankingi Bossów*
System rankingów z analizą OCR wyników walk. 5-poziomowe role TOP (1, 2-3, 4-10, 11-30). Wsparcie jednostek K/M/B/T/Q/Qi. Historia z timestampami i nazwami bossów.

**Główne Komendy:** `/update`, `/ranking`

---

### 🎯 Kontroler Bot - *Weryfikacja + Loteria*
Dwukanałowe monitorowanie OCR (CX: 1500+, Daily: 910+). Zaawansowana loteria z planowaniem datowym, wsparciem multi-klan, ostrzeżeniami i historią. Automatyczne filtrowanie zablokowanych użytkowników. System oligopoly dla zapisów na wojny klanowe.

**Główne Komendy:** `/lottery-list`, `/lottery-history`, `/oligopoly`

---

### ⛪ Konklawe Bot - *Gra Słowna*
Interaktywna gra hasłowa z domyślnym "Konklawe". System osiągnięć (medal Virtutti Papajlari za 30+). Timery przypomień z auto-resetem. Specjalne komendy błogosławieństw i cnót. System klątw.

**Główne Komendy:** `/podpowiedz`, `/podpowiedzi`, `/statystyki`, `/blessing`, `/virtue-check`

---

### 🎉 Wydarzynier Bot - *Zarządzanie Wydarzeniami*
System lobby party (7 graczy max). Organizacja przez wątki z kontrolą członków. Subskrypcje ról do powiadomień. Usługi bazaru z przypinaniem. System repozycjonowania ogłoszeń.

**Główne Komendy:** `/party`

---

### 🎮 Gary Bot - *Analiza Survivor.io*
Analiza Lunar Mine Expedition (4 gildie). Inteligentne wyszukiwanie z fuzzy matching. Integracja API garrytools.com. Cache top 500 gildii. Wsparcie proxy z Webshare API. Publiczna paginacja.

**Główne Komendy:** `/search`, `/player`, `/ee`

---

## 🏗️ Architektura

### Wzorzec Botów
```
NazwaBota/
├── index.js           # Główny plik
├── config/            # Konfiguracja
├── handlers/          # Obsługa zdarzeń
├── services/          # Logika biznesowa
├── utils/             # Narzędzia
└── data/              # Bazy danych JSON
```

### Systemy Współdzielone
- **Logowanie** - Scentralizowane z kolorami (`utils/consoleLogger.js`)
- **Manager Nicków** - Zarządzanie efektami cross-bot (`utils/nicknameManagerService.js`)
- **Przetwarzanie OCR** - Wspólne narzędzia (`utils/ocrFileUtils.js`)

### Katalogi Projektu
- `shared_data/` - Dane cross-bot
- `processed_ocr/` - Przetworzone obrazy OCR (max 400)
- `logs/` - Logi scentralizowane
- `temp/` - Pliki tymczasowe
- `data/` - Persistencja JSON

---

## 📦 Instalacja

```bash
# Klonowanie
git clone <repository-url>
cd "Polski Squad"

# Instalacja
npm install

# Konfiguracja
cp .env.example .env
# Edytuj .env z tokenami
```

---

## 🚀 Uruchomienie

### Wszystkie Boty
```bash
npm start          # Produkcja (wszystkie)
npm run local      # Development (wybrane)
```

### Pojedyncze Boty
```bash
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

---

## ⚙️ Konfiguracja

### bot-config.json
```json
{
  "production": ["rekruter", "endersecho", "szkolenia", "stalkerlme", "kontroler", "konklawe", "muteusz", "wydarzynier", "gary"],
  "development": ["gary"]
}
```

### Zmienne Środowiskowe
Każdy bot wymaga własnych zmiennych w pliku `.env`. Zobacz szczegóły w [CLAUDE.md](CLAUDE.md) lub w `NazwaBota/config/config.js`.

---

## 📊 Technologie

**Główne:**
- Discord.js v14.21.0
- Tesseract.js (OCR)
- Sharp (obrazy)
- node-cron (planowanie)

**Dodatkowe:**
- axios (HTTP)
- cheerio (HTML parsing)
- https-proxy-agent (proxy)
- dotenv (env)
- lz-string, lzma, pako (kompresja)

---

## 🔧 Rozwój

### Debug OCR
```bash
/ocr-debug true   # Włącz szczegółowe logi
/ocr-debug false  # Wyłącz
```

### Logi
- **Konsola**: Kolorowe real-time
- **Plik**: `logs/bots.log`
- **Discord**: Webhook (rate-limited)

### Obrazy OCR
- Katalog: `processed_ocr/`
- Format: `[BOTNAME][ rrrr-mm-dd hh:mm:ss ][]`
- Limit: 400 plików (100/typ)

---

## 🆘 Wsparcie

### Dokumentacja
- **[CLAUDE.md](CLAUDE.md)** - Szczegółowa dokumentacja deweloperska
- **Config Files** - `NazwaBota/config/config.js`

### Typowe Problemy
- **Uprawnienia** - Sprawdź uprawnienia botów Discord
- **OCR** - Sprawdź jakość obrazu
- **Proxy (Gary)** - Testuj `/proxy-test`
- **Logger** - Używaj `createBotLogger()` zamiast `console.log()`

---

<div align="center">

**Polski Squad Discord Bot Collection**

Stworzony z ❤️ przez Thashar

[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue.svg)](https://github.com/Thashar/Test)

</div>
