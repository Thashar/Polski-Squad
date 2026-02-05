### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → 24h przypomnienie → zamknięcie po 7 dniach (automatyczne, niezależnie od reakcji użytkownika)
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), 7-dniowe zamykanie PRZED sprawdzeniem threadOwner (FIX zmiany nicku)
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
- **Baza wiedzy:** `knowledge_base.md` - łatwo edytowalny plik markdown
  - Wystarczy edytować plik, nie trzeba restartować bota
  - Dodawaj nowe sekcje, aktualizuj informacje
  - Bot automatycznie wczyta całą zawartość przy każdym pytaniu
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
- **Wątki:** Automatyczne zamykanie po 7 dniach nieaktywności
- **Persistencja:** Przypomnienia zapisywane w JSON
