### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → pytanie o zamknięcie po 7 dniach nieaktywności → automatyczne zamknięcie po 14 dniach (7 dni po pytaniu bez odpowiedzi). Kliknięcie "nie zamykaj" resetuje cały cykl od nowa.
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), dwufazowe zamykanie: pytanie po 7 dniach + auto-close po 14 dniach, sprawdzenie PRZED threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
- `aiChatService.js` - AI Chat z bazą wiedzy (mention @Szkolenia, hybrydowe wyszukiwanie)
- `embeddingService.js` - Wyszukiwanie semantyczne (embeddingi, @xenova/transformers)
**Uprawnienia:**
- Admin/moderator/specjalne role → mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową → może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)

**AI Chat - Kompendium Wiedzy:**
- **Trigger:** Mention @Szkolenia + pytanie (max 300 znaków)
- **Kanał dozwolony:** `1207041051831832586` - każdy może używać
- **Administratorzy:** Mogą używać na dowolnym kanale + brak cooldownu
- **Baza wiedzy (hybrydowe wyszukiwanie - semantyczne + keyword):**
  - `knowledge_base.md` - zasady ogólne (w repo, cache'owane w system prompt)
  - `data/knowledge_{channelId}.md` - osobna baza per kanał (gitignore, tylko na serwerze)
  - `data/embeddings_index.json` - indeks embeddingów (generowany automatycznie)
  - **search_knowledge (tool_use):** AI przeszukuje bazę wiedzy HYBRYDOWO:
    - **Semantyczne:** embeddingi (`@xenova/transformers`, model `Xenova/multilingual-e5-small`) - rozumie synonimy, kontekst, polski
    - **Keyword:** regex/tekst (istniejąca logika) - precyzyjne dopasowanie
    - Wyniki merge'owane: korekty > semantyczne + keyword (deduplikacja)
    - Max 15 wywołań na pytanie
  - **EmbeddingService** (`services/embeddingService.js`):
    - Model ładowany przy starcie bota (kwantyzowany, ~130MB)
    - Reindeksacja pełnej bazy przy starcie bota i po `/scan-knowledge`
    - Inkrementalne dodawanie do indeksu przy auto-zbieraniu wiedzy i korektach
    - Indeks persistowany w `data/embeddings_index.json` (embeddingi jako base64 Float32)
    - Cosine similarity z progiem 0.35, top 10 wyników
  - **Prompt caching:** System prompt z `cache_control: ephemeral` - ~90% taniej (cache 5 min)
- **Auto-zbieranie wiedzy z kanałów:**
  - Kanały: `1207041051831832586`, `1194299628905042040`
  - Zbiera WSZYSTKIE wiadomości (nie-botów) - bez filtrowania keywords
  - Odpowiedzi zapisywane jako pary: `Pytanie: ... Odpowiedź: ...`
  - Format wpisu: `[YYYY-MM-DD | NickAutora] Treść`
  - Każdy kanał → osobny plik bazy wiedzy
- **Styl odpowiedzi:**
  - Krótko i zwięźle (max 3-4 zdania)
  - **Ważne informacje** pogrubione
  - Minimalne użycie emoji (⚔️ 🎯 💎 🏆 ⚡)
  - **Rozumowanie i analiza:** AI łączy dane z różnych wpisów, oblicza, porównuje, wyciąga wnioski (nie tylko cytuje)
  - **WZMOCNIONE zabezpieczenia przeciw halucynacjom:**
    - ABSOLUTNY ZAKAZ wymyślania postaci, umiejętności, statystyk, mechanik
    - Przykłady niepoprawnego zachowania w prompcie (np. wymyślanie nazw, statystyk)
    - Niska temperature (0.3) = mniej kreatywności, więcej faktów
    - Obowiązkowe sprawdzanie bazy wiedzy przed odpowiedzią
- **Model:** Claude 3 Haiku (Anthropic API) z prompt caching
- **Cooldown:** 1 minuta (administratorzy bez limitu)
- **Brak pamięci:** Każde pytanie niezależne
- **System feedbacku (👍/👎):**
  - Pod odpowiedzią AI (gdy użyto bazy wiedzy) pojawiają się przyciski 👍 i 👎
  - Tylko osoba która zadała pytanie może ocenić odpowiedź
  - 👍 dodaje `[+]` do fragmentów użytych w odpowiedzi
  - 👎 otwiera modal z pytaniem (pre-filled) i polem na poprawną odpowiedź
  - Korekty zapisywane do `data/knowledge_corrections.md` jako pary pytanie/odpowiedź
  - AI grepuje 3 pliki: 2 kanały wiedzy + plik korekt
  - Fragmenty z wieloma `-` i oceną ≤ -5 pomijane przez search_knowledge
  - Fragmenty z oceną ≤ -5 są automatycznie usuwane z bazy
  - Format w bazie: `[2026-02-09 | Autor] [+++] Treść` lub `[--] Treść`
  - Kontekst feedbacku (feedbackMap) przechowywany 10 min w pamięci, auto-cleanup
- **Optymalizacja tokenów:** System prompt (statyczny) → cache'owany | Baza wiedzy → search_knowledge tool_use hybrydowe (semantic + keyword, mniej iteracji potrzebnych)
- **Komenda scan-knowledge (admin):**
  - Trigger: `/scan-knowledge` (slash command)
  - Skanuje 2 kanały od początku 2024 roku
  - Zapisuje WSZYSTKIE wiadomości (nie-botów) do osobnych plików per kanał
  - Odpowiedzi jako pary Pytanie/Odpowiedź
  - Pomija duplikaty (sprawdza istniejącą bazę)
  - Raportuje postęp na bieżąco + podsumowanie na końcu
  - Po zakończeniu automatycznie reindeksuje embeddingi (wyszukiwanie semantyczne)
- **Przykłady:**
  - `@Szkolenia Jaki build jest najlepszy na bossy?`
  - `@Szkolenia Jak działają Tech Parts?`
  - `/scan-knowledge` (admin, skan historii)

**Env:** TOKEN, CHANNEL_ID, PING_ROLE_ID, CLAN_ROLE_0/1/2/MAIN, ANTHROPIC_API_KEY (opcjonalne), SZKOLENIA_AI_CHAT_MODEL (opcjonalne)

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
- **Wątki:** Pytanie o zamknięcie po 7 dniach nieaktywności, automatyczne zamknięcie po 14 dniach. "Nie zamykaj" resetuje cykl. Reakcja na otwarty wątek → komunikat "wątek jest wciąż otwarty"
- **Persistencja:** Przypomnienia zapisywane w JSON
