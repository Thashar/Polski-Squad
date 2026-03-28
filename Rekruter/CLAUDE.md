### 🎯 Rekruter Bot

**Funkcjonalność:** Wieloetapowa rekrutacja z OCR → Kwalifikacja klanów: <100K=brak, 100K-599K=Clan0, 600K-799K=Clan1, 800K-1.19M=Clan2, 1.2M+=Main
**OCR - Dwa tryby:**
1. **Tradycyjny:** `services/ocrService.js` - Tesseract (PL+EN), preprocessing Sharp, ekstrakcja nick+atak
2. **AI OCR (opcjonalny):** `services/aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa analiza przez AI
   - Włączany przez `USE_AI_OCR=true` w .env
   - Używa tego samego modelu co Stalker AI Chat (domyślnie: Claude 3 Haiku)
   - Dwuetapowa walidacja (dwa osobne requesty do API):
     - **KROK 1 (pierwszy request):** Sprawdza czy jest "My Equipment" (50 tokenów)
       - Jeśli NIE - natychmiast zwraca błąd, NIE wysyła drugiego requestu
     - **KROK 2 (drugi request):** Tylko jeśli KROK 1 znalazł "My Equipment" → wyciąga nick i atak (500 tokenów)
   - Zalety: 100% pewność walidacji, oszczędność tokenów przy złych screenach, niemożliwe fałszywe pozytywy

**Serwisy:**
- `memberNotificationService.js` - Śledzenie boostów, losowe gratulacje, powiadomienia o odejściu (link do profilu + nick serwerowy)
- `roleMonitoringService.js` - Cron 6h, ostrzeżenia po 24h bez ról
- `roleConflictService.js` - Auto-usuwanie ról rekrutacyjnych gdy dostaje klanową
- `clanRoleChangeService.js` - Powiadomienia o zmianach klanów/stanowisk; ignoruje administratorów i użytkowników którzy wyłączyli powiadomienia
- `notificationPreferencesService.js` - Persistencja preferencji powiadomień per użytkownik (`data/notification_preferences.json`); `isOptedOut(userId)`, `optOut(userId)`, `optIn(userId)`

**Komendy:** `/ocr-debug`, `/nick`, `/powiadomienia`
**Env:** TOKEN, kanały (RECRUITMENT, CLAN0-2, MAIN_CLAN, WELCOME), role (CLAN0-2, MAIN_CLAN, VERIFIED, NOT_POLISH), USE_AI_OCR (opcjonalne), ANTHROPIC_API_KEY (opcjonalne), ROBOT (opcjonalne, lista user ID rozdzielona przecinkami)

**Przekazywanie wiadomości (Robot2):**
- Użytkownicy z ID w `ROBOT2` mogą pisać priv do bota, a wiadomości są przekazywane 1:1 na kanał `1486848827997818900`
- Obsługuje tekst i załączniki
- Wymaga partial `Channel`
- **Ping roli:** Jeśli wiadomość DM zaczyna się od `@`, zostanie wysłana z pingiem do roli `1486506395057524887`

---

## Zmienne Środowiskowe

```env
# Token bota
DISCORD_TOKEN=bot_token_here

# Kanały
RECRUITMENT_CHANNEL=channel_id
CLAN0_CHANNEL=channel_id
CLAN1_CHANNEL=channel_id
CLAN2_CHANNEL=channel_id
MAIN_CLAN_CHANNEL=channel_id
WELCOME_CHANNEL=channel_id
WAITING_ROOM_CHANNEL=poczekalnia

# Role
NOT_POLISH_ROLE=role_id
VERIFIED_ROLE=role_id
CLAN0_ROLE=role_id
CLAN1_ROLE=role_id
CLAN2_ROLE=role_id
MAIN_CLAN_ROLE=role_id

# AI OCR (opcjonalne)
USE_AI_OCR=false
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-3-haiku-20240307
```

## Najlepsze Praktyki

- **Zawsze używaj createBotLogger('Rekruter')** zamiast console.log
- **OCR debug:** `/ocr-debug true` włącza szczegółowe logowanie
- **Walidacja danych:** Sprawdzaj formaty przed zapisem
- **Persistencja:** Zapisuj dane do JSON po każdej zmianie
