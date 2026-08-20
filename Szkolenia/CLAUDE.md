### Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS -> Prywatny wątek z instrukcjami treningowymi + AI Chat
**Lifecycle:** Utworzenie -> pytanie o zamknięcie po 7 dniach nieaktywności -> automatyczne zamknięcie po 14 dniach (7 dni po pytaniu bez odpowiedzi). Kliknięcie "nie zamykaj" resetuje cały cykl od nowa.
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)

**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), dwufazowe zamykanie: pytanie po 7 dniach + auto-close po 14 dniach. Wątki już zablokowane (`thread.locked`) są pomijane na samym początku `processThread` (PRZED pobraniem wiadomości i PRZED threadOwner) — zapobiega odarchiwizowaniu i ponownemu wysyłaniu komunikatu o zamknięciu do dawno zamkniętych wątków przy restarcie. `lockThread` dodatkowo zabezpieczone przed ponownym zamykaniem zablokowanego wątku. Eksportuje też `znajdzWatekUzytkownika`, `otworzWatek` i `pobierzArchiwalneWatki` — używane przez `reactionHandlers` (opis niżej).
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
- `aiChatService.js` - AI Chat z trzema providerami: Anthropic (prosty prompt), Grok (web_search) i Perplexity (web search). Przełączanie przez `SZKOLENIA_AI_PROVIDER`

**Odnajdywanie wątku przy reakcji (`reactionHandlers.js`):** Zanim bot założy nowy wątek, szuka istniejącego w czterech krokach — od źródeł pewnych i tanich do kosztownych:
1. **Wątek wyrastający z tej samej wiadomości** — wątek utworzony z wiadomości ma **to samo ID co ta wiadomość**, więc przy `message.hasThread` wystarczy `threads.fetch(message.id)`. Jedno żądanie, niezależne od nazwy.
2. **Zapisany `ownerId`** z `data/reminders.json` — wiąże wątek z użytkownikiem, nie z nickiem.
3. **Aktywne wątki z API** (`fetchActive()`) — a NIE `channel.threads.cache`, bo discord.js sam sprząta cache wątków (sweeper `threads`, domyślnie co godzinę usuwa archiwalne starsze niż 4 h).
4. **Archiwum ze stronicowaniem** (`pobierzArchiwalneWatki`, po 100 wątków na stronę, do 10 stron przy reakcji / 20 przy codziennym sprawdzaniu) — dopasowanie po nazwie.

⚠️ **Dlaczego nie samo dopasowanie po nazwie:** nazwa wątku to nick z chwili jego założenia. Po zmianie nicku kroki 3-4 nie mają czego dopasować — ratują wyłącznie kroki 1-2. Dlatego **`ownerId` musi przetrwać zamknięcie wątku**: zamknięcie wywołuje `markThreadClosed` (flaga `closed: true`, zachowany `ownerId`), a nie `removeReminder`, który kasował cały wpis. Po odnalezieniu wątku ze starą nazwą bot wyrównuje ją do aktualnego nicku (`setName`).

⚠️ **`fetchArchived()` zwraca JEDNĄ stronę wyników.** Bez stronicowania starszy wątek jest niewidoczny i bot zakłada DRUGI wątek o tej samej nazwie — a gdy reakcja pada pod tą samą wiadomością co stary wątek, Discord odrzuca tworzenie (wątek dla tej wiadomości już istnieje) i użytkownik nie dostaje nic. Z tego samego powodu `checkThreads` czyści osierocone przypomnienia **tylko gdy przejrzało całe archiwum** (`kompletna`); przy niepełnej liście skasowałoby stan (w tym `ownerId`) wątków, które nadal istnieją.

**Otwieranie zamkniętego wątku:** `otworzWatek` zdejmuje archiwizację i blokadę **jednym** `edit({ archived: false, locked: false })`, z krokowym zapasem. Osobne `setArchived` + `setLocked` potrafią się wykluczać (zarchiwizowanego wątku nie da się edytować inaczej niż polem `archived`), a wcześniej oba błędy były tylko logowane i kod leciał dalej do `send()` — który wywracał się na zamkniętym wątku, przez co **regułka nie docierała**. Teraz nieudane otwarcie przerywa obsługę z jednoznacznym logiem, a wysyłka regułki ma własny log błędu.

**Uprawnienia:**
- Admin/moderator/specjalne role -> mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową -> może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych (prośba o pomoc):** Gdy właściciel wątku napisze wiadomość zawierającą dowolną odmianę słowa "pomóc" (pomocy, pomoże, pomożesz, pomogę, pomógł, pomagać itd. — detekcja z normalizacją polskich znaków i regexem `pomo[czg]|pomag`), bot pinguje wszystkie 4 role klanowe. Ping wysyłany jest **tylko raz na cykl otwarcia** wątku (flaga `helpPingSent` w `data/reminders.json`); przy ponownym otwarciu wątku flaga jest resetowana. Właściciel wątku ustalany jest kolejno: 1) z zapisanego `ownerId` (targetUser z reakcji), 2) z autora wiadomości startowej wątku (`fetchStarterMessage()` — najpewniejsze, bo wątek zakładany jest z reakcji pod postem właściciela; niezależne od zmiany nicku i cache), 3) po nazwie wątku, 4) z `channel.ownerId` (który dla wątków tworzonych przez bota wskazuje bota — pomijany). Ustalony właściciel jest zapisywany do `reminders.json`, więc dla wątków sprzed zmiany ownerId uzupełnia się przy pierwszej wiadomości (koniec ostrzeżeń „Nie ustalono właściciela wątku").
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w Stalker)

---

## AI Chat

**Mention @Szkolenia** na kanale `1207041051831832586` (lub admin gdziekolwiek) → odpowiedź AI.
- **Przełączanie providera:** `SZKOLENIA_AI_PROVIDER` w .env → `"anthropic"` (domyślny), `"grok"` lub `"perplexity"`
- **Cooldown:** Anthropic 1 min, Grok/Perplexity 1440 min (24h) (admini bez limitu)

### Provider: Anthropic (domyślny)
- **Model:** Anthropic Claude (configurable via `SZKOLENIA_AI_CHAT_MODEL`)
- **Prompt:** Prosty system prompt - asystent wiedzy o Survivor.io, odpowiada z wiedzy modelu
- **Brak narzędzi:** Nie używa grep_knowledge ani bazy lokalnej

### Provider: Grok (xAI)
- **Model:** Grok (configurable via `SZKOLENIA_GROK_MODEL`, domyślnie `grok-4`)
- **API:** `https://api.x.ai/v1/responses` (Responses API z web_search)
- **Web Search:** Ograniczony TYLKO do Reddit (`allowed_domains: ['reddit.com']`), wyniki z ostatniego roku, max 10 stron
- **Limity:** `max_output_tokens: 10000` na zapytanie
- **Prompt:** Kompendium wiedzy o Survivor.io - wyszukiwanie wyłącznie na Reddit

### Provider: Perplexity
- **Model:** Perplexity (configurable via `SZKOLENIA_PERPLEXITY_MODEL`, domyślnie `sonar-pro`)
- **API:** `https://api.perplexity.ai/chat/completions` (Chat Completions z wbudowanym web search)
- **Web Search:** Perplexity ma wbudowane przeszukiwanie internetu, filtr `search_recency_filter: 'month'`
- **Prompt:** Identyczny jak Grok - kompendium wiedzy o Survivor.io z instrukcjami wyszukiwania
- **Cooldown:** 1440 min (24h) per użytkownik (administratorzy bez limitu)

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
SZKOLENIA_AI_PROVIDER=anthropic          # "anthropic" (domyślny), "grok" lub "perplexity"

# Anthropic (gdy provider=anthropic)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
SZKOLENIA_AI_CHAT_MODEL=claude-3-haiku-20240307

# Grok / xAI (gdy provider=grok)
XAI_API_KEY=xai-xxxxxxxxxxxxx
SZKOLENIA_GROK_MODEL=grok-4

# Perplexity (gdy provider=perplexity)
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxx
SZKOLENIA_PERPLEXITY_MODEL=sonar-pro
```

## Najlepsze Praktyki

- **Logger:** Używaj createBotLogger('Szkolenia')
- **Scheduling:** Cron sprawdza wątki codziennie o 18:00 (Europe/Warsaw)
- **Wątki:** Pytanie o zamknięcie po 7 dniach nieaktywności, automatyczne zamknięcie po 14 dniach. "Nie zamykaj" resetuje cykl. Reakcja na otwarty wątek -> komunikat "wątek jest wciąż otwarty"
- **Wpis w `reminders.json`:** `{ lastReminder, threadCreated, reminderSent, ownerId, helpPingSent, closed }`. Wpis **przeżywa zamknięcie wątku** — trzyma `ownerId`, jedyne powiązanie wątku z użytkownikiem niezależne od nicku. Kasuje go dopiero `cleanupOrphanedReminders`, gdy wątek zniknie z Discorda (i tylko przy kompletnej liście archiwum). `setReminder` zdejmuje `closed` przy (ponownym) otwarciu.
- **Persistencja:** Przypomnienia w JSON, cooldowny AI Chat w JSON — oba przez `utils/jsonStore` (cache-first): `data/reminders.json` i `data/ai_chat_cooldowns.json` czytane z dysku raz, przy pierwszym sięgnięciu, zapis idzie jednocześnie do pliku i pamięci, atomowo (plik tymczasowy + rename). Obsługa `ENOENT` zniknęła z serwisów — store sam oddaje wartość domyślną przy braku pliku. Zapisywanie promptów AI do `data/prompts/` zostało na zwykłym `fs` (pliki tekstowe, nie JSON)
- **Odpowiedzi ephemeralne:** `flags: MessageFlags.Ephemeral`, **nie** `ephemeral: true` (przestarzałe w discord.js v14, przestanie działać w v15). Tylko przy pierwszej odpowiedzi — `reply()`, `deferReply()`, `followUp()`; `editReply()` flagi nie przyjmuje. Import `MessageFlags` jest w `index.js` i `handlers/interactionHandlers.js`
- **AI Chat:** Trzy providery (Anthropic prosty prompt / Grok z web_search / Perplexity z web search). Przełączanie przez `SZKOLENIA_AI_PROVIDER` w .env. Grok/Perplexity: web search, cooldown 1440 min (24h) (admini bez limitu).
