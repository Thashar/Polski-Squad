### Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS -> Prywatny wątek z instrukcjami treningowymi + AI Chat + Baza wiedzy
**Lifecycle:** Utworzenie -> pytanie o zamknięcie po 7 dniach nieaktywności -> automatyczne zamknięcie po 14 dniach (7 dni po pytaniu bez odpowiedzi). Kliknięcie "nie zamykaj" resetuje cały cykl od nowa.
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)

**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), dwufazowe zamykanie: pytanie po 7 dniach + auto-close po 14 dniach, sprawdzenie PRZED threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
- `knowledgeService.js` - Zarządzanie bazą wiedzy w JSON (dodawanie/usuwanie/aktywacja/deaktywacja wpisów, korekty, oceny)
- `aiChatService.js` - AI Chat z narzędziem grep_knowledge (Anthropic API, tool_use loop, max 15 wywołań)

**Uprawnienia:**
- Admin/moderator/specjalne role -> mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową -> może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)

---

## AI Chat

**Mention @Szkolenia** na kanale `1207041051831832586` (lub admin gdziekolwiek) → wyszukiwanie grep w bazie wiedzy → odpowiedź AI.
- **Model:** Anthropic Claude (configurable via `SZKOLENIA_AI_CHAT_MODEL`)
- **Narzędzie:** `grep_knowledge` - przeszukuje bazę wiedzy regex/tekstem, max 20 wyników, max 15000 znaków
- **Tool-use loop:** Max 15 wywołań grep_knowledge na pytanie
- **Cooldown:** 1 min dla zwykłych użytkowników, brak dla adminów
- **Feedback:** 👍/👎 pod odpowiedziami AI. 👍 = pozytywna ocena wpisów. 👎 = modal z korektą + negatywna ocena

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
- Korekty użytkowników: `data/knowledge_corrections.md` (Markdown)
- Wpis: `{ content, author, date, reactedBy, approvalMsgId, active, rating }`
- Wpisy z `rating < -5` są ukrywane z wyszukiwania

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

# AI Chat (opcjonalne)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
SZKOLENIA_AI_CHAT_MODEL=claude-3-haiku-20240307
```

## Najlepsze Praktyki

- **Logger:** Używaj createBotLogger('Szkolenia')
- **Scheduling:** Cron sprawdza wątki codziennie o 18:00 (Europe/Warsaw)
- **Wątki:** Pytanie o zamknięcie po 7 dniach nieaktywności, automatyczne zamknięcie po 14 dniach. "Nie zamykaj" resetuje cykl. Reakcja na otwarty wątek -> komunikat "wątek jest wciąż otwarty"
- **Persistencja:** Przypomnienia w JSON, baza wiedzy w JSON, cooldowny AI Chat w JSON
- **AI Chat:** Wyszukiwanie tylko Grep (regex), bez semantic search. Korekty od użytkowników mają najwyższy priorytet.
