### Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS -> Prywatny wątek z instrukcjami treningowymi + AI Chat + Baza wiedzy
**Lifecycle:** Utworzenie -> pytanie o zamknięcie po 7 dniach nieaktywności -> automatyczne zamknięcie po 14 dniach (7 dni po pytaniu bez odpowiedzi). Kliknięcie "nie zamykaj" resetuje cały cykl od nowa.
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)

**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), dwufazowe zamykanie: pytanie po 7 dniach + auto-close po 14 dniach, sprawdzenie PRZED threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
- `knowledgeService.js` - Zarządzanie bazą wiedzy w JSON (dodawanie/usuwanie/aktywacja/deaktywacja wpisów, korekty, oceny)
- `aiChatService.js` - AI Chat z dwoma providerami: Anthropic (grep_knowledge, tool_use loop) i Grok (prosty chat). Przełączanie przez `SZKOLENIA_AI_PROVIDER`

**Uprawnienia:**
- Admin/moderator/specjalne role -> mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową -> może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)

---

## AI Chat

**Mention @Szkolenia** na kanale `1207041051831832586` (lub admin gdziekolwiek) → odpowiedź AI.
- **Przełączanie providera:** `SZKOLENIA_AI_PROVIDER` w .env → `"anthropic"` (domyślny) lub `"grok"`
- **Cooldown:** 1 min dla zwykłych użytkowników, brak dla adminów

### Provider: Anthropic (domyślny)
- **Model:** Anthropic Claude (configurable via `SZKOLENIA_AI_CHAT_MODEL`)
- **Narzędzie:** `grep_knowledge` - zaawansowane wyszukiwanie (3 strategie: exact regex + dopasowanie per słowo + polski stemming, scoring trafności, priorytet korekt), max 20 wyników, max 15000 znaków
- **Tool-use loop:** Max 15 wywołań grep_knowledge na pytanie
- **Feedback:** 👍/👎 pod odpowiedziami AI. 👍 = pozytywna ocena wpisów. 👎 = modal z korektą + negatywna ocena + korekta trafia do bazy wiedzy i na kanał zatwierdzania

### Provider: Grok (xAI)
- **Model:** Grok (configurable via `SZKOLENIA_GROK_MODEL`, domyślnie `grok-4`)
- **API:** `https://api.x.ai/v1/responses` (Responses API z web_search)
- **Web Search:** Grok przeszukuje internet w czasie rzeczywistym aby znaleźć aktualne informacje o Survivor.io
- **Prompt:** Rozbudowany system prompt - kompendium wiedzy o Survivor.io z instrukcjami wyszukiwania
- **Bez kompendium lokalnego** (brak grep_knowledge), ale **z dostępem do sieci** przez web_search
- **Cooldown:** 5 minut per użytkownik (administratorzy bez limitu)

### Komenda
- `/ranking-pomocy` - ranking osób budujących bazę wiedzy, z nawigacją po miesiącach

## Baza Wiedzy (Reakcje ✅)

**Zbieranie wiedzy:**
- Użytkownik z rolą `1470702781638901834` daje reakcję ✅ na wiadomość → dodaje do bazy wiedzy
- Jeśli wiadomość jest odpowiedzią → zapisuje pytanie + odpowiedź
- Usunięcie ✅ → usuwa z bazy wiedzy

**Kanał zatwierdzania** (`1470703877924978772`):
- Każdy nowy wpis wysyłany jako embed z informacją: autor wiadomości, kto dodał, link do źródła
- ✅ na kanale zatwierdzania → deaktywuje wpis (ukrywa z wyszukiwania, ale nie usuwa)
- Usunięcie ✅ z kanału zatwierdzania → reaktywuje wpis

**Przechowywanie:**
- Baza wiedzy: `data/knowledge_base.json` (JSON, klucz = message ID)
- Korekty użytkowników: zapisywane jako wpisy w `knowledge_base.json` z flagą `isCorrection: true` i prefixem `[KOREKTA UŻYTKOWNIKA]` w wyszukiwaniu
- Wpis: `{ content, author, date, reactedBy, approvalMsgId, active, rating, isCorrection? }`
- Wpisy z `rating < -5` są ukrywane z wyszukiwania
- Punkty pomocy: `data/knowledge_points.json` (miesięczne rankingi, `{ "YYYY-MM": { userId: { displayName, points } } }`)

## System Punktów Pomocy

- **+1 pkt** - dodanie wiedzy do bazy (reakcja ✅)
- **-1 pkt** - usunięcie własnej reakcji ✅ (usunięcie wiedzy)
- **-2 pkt** - odrzucenie wiedzy na kanale zatwierdzania (✅ na approval channel)
- Można mieć ujemną liczbę punktów
- Rankingi miesięczne - co miesiąc nowy ranking
- `/ranking-pomocy` - wyświetla własne punkty + TOP 10, nawigacja ◀/▶ po miesiącach

---

## Zmienne Środowiskowe

```env
# Token bota
SZKOLENIA_DISCORD_TOKEN=bot_token_here

# Kanały i role
SZKOLENIA_CHANNEL_ID=channel_id
SZKOLENIA_PING_ROLE_ID=role_id

# Role klanowe (dla uprawnień i pingów)
SZKOLENIA_CLAN_ROLE_0=role_id
SZKOLENIA_CLAN_ROLE_1=role_id
SZKOLENIA_CLAN_ROLE_2=role_id
SZKOLENIA_CLAN_ROLE_MAIN=role_id

# AI Chat - wybór providera (opcjonalne)
SZKOLENIA_AI_PROVIDER=anthropic          # "anthropic" (domyślny) lub "grok"

# Anthropic (gdy provider=anthropic)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
SZKOLENIA_AI_CHAT_MODEL=claude-3-haiku-20240307

# Grok / xAI (gdy provider=grok)
XAI_API_KEY=xai-xxxxxxxxxxxxx
SZKOLENIA_GROK_MODEL=grok-4
```

## Najlepsze Praktyki

- **Logger:** Używaj createBotLogger('Szkolenia')
- **Scheduling:** Cron sprawdza wątki codziennie o 18:00 (Europe/Warsaw)
- **Wątki:** Pytanie o zamknięcie po 7 dniach nieaktywności, automatyczne zamknięcie po 14 dniach. "Nie zamykaj" resetuje cykl. Reakcja na otwarty wątek -> komunikat "wątek jest wciąż otwarty"
- **Persistencja:** Przypomnienia w JSON, baza wiedzy w JSON, cooldowny AI Chat w JSON
- **AI Chat:** Dwa providery (Anthropic z grep_knowledge / Grok z web_search). Przełączanie przez `SZKOLENIA_AI_PROVIDER` w .env. Anthropic: lokalna baza wiedzy + grep_knowledge, korekty mają priorytet. Grok: Responses API z web_search (przeszukiwanie internetu w czasie rzeczywistym), cooldown 5 min (admini bez limitu).
