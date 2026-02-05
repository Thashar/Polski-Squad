### 🎓 Szkolenia Bot

**Funkcjonalność:** Reakcja emoji N_SSS → Prywatny wątek z instrukcjami treningowymi
**Lifecycle:** Utworzenie → 24h przypomnienie → zamknięcie po 7 dniach (automatyczne, niezależnie od reakcji użytkownika)
**Scheduling:** Sprawdzanie wątków codziennie o 18:00 (node-cron, strefa Europe/Warsaw)
**Serwisy:**
- `threadService.js` - Automatyzacja wątków (cron daily 18:00), 7-dniowe zamykanie PRZED sprawdzeniem threadOwner (FIX zmiany nicku)
- `reminderStorageService.js` - Persistent JSON z danymi przypomień
**Uprawnienia:**
- Admin/moderator/specjalne role → mogą otworzyć wątek każdemu (reakcja pod czyimkolwiek postem)
- Użytkownik z rolą klanową → może otworzyć wątek tylko sobie (reakcja pod własnym postem)
**Ping ról klanowych:** Po pierwszej wiadomości właściciela wątku bot automatycznie pinguje wszystkie 4 role klanowe (działa również po ponownym otwarciu wątku)
**Komendy:** `/decode` (integracja sio-tools, tylko informacja w wiadomości - komenda w StalkerLME)
**Env:** TOKEN, CHANNEL_ID, PING_ROLE_ID, CLAN_ROLE_0, CLAN_ROLE_1, CLAN_ROLE_2, CLAN_ROLE_MAIN

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
```

## Najlepsze Praktyki

- **Logger:** Używaj createBotLogger('Szkolenia')
- **Scheduling:** Cron sprawdza wątki codziennie o 18:00 (Europe/Warsaw)
- **Wątki:** Automatyczne zamykanie po 7 dniach nieaktywności
- **Persistencja:** Przypomnienia zapisywane w JSON
