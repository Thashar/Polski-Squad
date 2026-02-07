### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → pytanie o zamknięcie po 7 dniach nieaktywności → automatyczne zamknięcie po 14 dniach (7 dni po pytaniu bez odpowiedzi). Kliknięcie "nie zamykaj" resetuje cały cykl od nowa.
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), dwufazowe zamykanie: pytanie po 7 dniach + auto-close po 14 dniach, sprawdzenie PRZED threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
- `aiChatService.js` - AI Chat z bazą wiedzy (mention @Szkolenia)
**Uprawnienia:**
- Admin/moderator/specjalne role → mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową → może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)

**AI Chat - Kompendium Wiedzy:**
- **Trigger:** Mention @Szkolenia + pytanie (max 300 znaków)
- **Kanał dozwolony:** `1207041051831832586` - każdy może używać
- **Administratorzy:** Mogą używać na dowolnym kanale + brak cooldownu
- **Baza wiedzy (modularny system):**
  - `knowledge_base.md` - zasady ogólne (w repo)
  - `data/knowledge_data.md` - faktyczna baza wiedzy (gitignore, tylko na serwerze)
  - Bot automatycznie wczyta oba pliki przy każdym pytaniu
  - Nie trzeba restartować bota
- **System zgłaszania wiedzy:**
  - Keyword-based trigger: gdy AI użyje słów "dodać", "zaktualizować", "chcesz dodać" → przycisk "Dodaj nowe informacje"
  - **KAŻDY może dodawać wiedzę** - bez ograniczenia ról
  - Modal (okienko) z polem tekstowym (10-1000 znaków)
  - Zgłoszenie trafia na kanał `1263240344871370804` z przyciskami: Edytuj ✏️, Zatwierdź ✅, Odrzuć ❌
  - Administratorzy mogą najpierw edytować propozycję (modal z obecną treścią), potem zatwierdzić
  - Po zatwierdzeniu:
    - Automatyczne dodanie do `data/knowledge_data.md` (czysta wiedza, bez timestampów)
    - Publikacja na kanale głównym `1207041051831832586` z informacją kto zgłosił i kto zatwierdził
- **Styl odpowiedzi:**
  - Krótko i zwięźle (max 3-4 zdania)
  - **Ważne informacje** pogrubione
  - Minimalne użycie emoji (⚔️ 🎯 💎 🏆 ⚡)
  - **WZMOCNIONE zabezpieczenia przeciw halucynacjom:**
    - ABSOLUTNY ZAKAZ wymyślania postaci, umiejętności, statystyk, mechanik
    - Przykłady niepoprawnego zachowania w prompcie (np. wymyślanie nazw, statystyk)
    - Niska temperature (0.3) = mniej kreatywności, więcej faktów
    - Obowiązkowe sprawdzanie bazy wiedzy przed odpowiedzią
- **Model:** Claude 3 Haiku (Anthropic API)
- **Cooldown:** 5 minut (administratorzy bez limitu)
- **Brak pamięci:** Każde pytanie niezależne
- **Przykłady:**
  - `@Szkolenia Jaki build jest najlepszy na bossy?`
  - `@Szkolenia Jak działają Tech Parts?`
  - `@Szkolenia Co to jest Lunar Mine Expedition?`

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
