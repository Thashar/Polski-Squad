# Polski Squad Discord Bot Collection

Kolekcja botów Discord dla serwera Polish Squad, zawierająca sześć specjalistycznych botów:

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

## Konfiguracja

Każdy bot ma własny plik `.env` z konfiguracją. Sprawdź odpowiednie katalogi botów.
