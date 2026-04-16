### 🏆 EndersEcho Bot

**4 Systemy:**
1. **OCR Wyników** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa walidacja
     - Włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
     - Trzyetapowa walidacja (trzy osobne requesty do API):
       - **KROK 1:** Sprawdza czy jest "Victory" (50 tokenów)
       - **KROK 2:** Sprawdza autentyczność zdjęcia (10 tokenów)
       - **KROK 3:** Wyciąga nazwę bossa, wynik (Best) i Total (500 tokenów)
     - **Walidacja score vs Total:** Jeśli odczytany Best > Total → automatyczna korekta
     - Zalety: 100% pewność walidacji, fallback na tradycyjny OCR

2. **Rankingi Multi-Server** - `rankingService.js`:
   - **Per-serwer:** Osobny plik `data/ranking_{guildId}.json` dla każdego serwera
   - **Globalny:** `getGlobalRanking()` — najlepszy wynik gracza ze wszystkich serwerów (z adnotacją skąd pochodzi)
   - Eksport do `shared_data/endersecho_ranking.json` (globalny, format: `{updatedAt, players: [{rank, userId, username, score, scoreValue, bossName, timestamp, sourceGuildId}]}`)
   - Eksport przy każdym zapisie i przy starcie bota
   - **Sync do Web API:** Po eksporcie `saveSharedRanking()` wypycha każdego gracza do `/api/bot/endersecho-snapshot` (upsert po `discordId+snapshotDate`). Cicho no-op gdy brak `APP_API_URL`/`BOT_API_KEY`. Zobacz shared `utils/appSync.js`.
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`

3. **Role TOP (opcjonalne)** - `roleService.js`:
   - 5 poziomów (top1, top2, top3, top4-10, top11-30), auto-update
   - Role są **opcjonalne per serwer** — jeśli serwer nie ma skonfigurowanych ról, bot je pomija
   - `updateTopRoles(guild, sortedPlayers, guildTopRoles)` — przyjmuje konfigurację ról danego serwera
   - **Ogłoszenie rekordu** (`rankingService.createRecordEmbed`):
     - Kolor embeda wg pozycji: 🥇 złoty (TOP1), 🥈 srebrny (TOP2), 🥉 brązowy (TOP3), niebieski (TOP4-10), zielony (TOP11+)
     - Tytuł: `🏆 GRATULACJE!` + opis z headerem markdown
     - Pola: Postęp (`stary ➜ nowy`), Poprawa (`+X`), Data, Pozycja z medalem emoji
     - Author (górny pasek): ikona roli + nazwa roli (jeśli rola ma ikonę/emoji)
     - Thumbnail: avatar gracza | Image: screenshot wyniku
   - **Powiadomienie Global Top 3** (`rankingService.createGlobalTop3Embed`):
     - Wysyłane na kanał każdego serwera gdy gracz wchodzi lub poprawia wynik w globalnym Top 3 (pozycje 1-3)
     - Warunek: `isNewRecord = true` ORAZ wynik gracza w globalnym rankingu faktycznie wzrósł (eliminuje przypadek gdy nowy rekord lokalny jest słabszy od wyniku z innego serwera)
     - Embed zawiera: kto, jaki wynik (z postępem `stary ➜ nowy +X`), na jakim serwerze, kiedy (+ ile temu poprzedni), lokata globalna z medalem i adnotacją (wejście do Top3 / awans z #N)
     - Kolor embeda wg pozycji globalnej (złoty/srebrny/brązowy)
     - Każdy serwer otrzymuje wiadomość **w swoim języku** (pol/eng wg konfiguracji `ENDERSECHO_GUILD_N_LANG`)
     - Powiadomienie idzie do `allowedChannelId` każdego serwera

4. **Paginacja + Wybór Rankingu** - `interactionHandlers.js`:
   - `/ranking` → ephemeral z przyciskami: `[NazwaSerwera1]`, `[NazwaSerwera2]`, `[🌐 Global]`
   - Nazwy serwerów pobierane dynamicznie z `client.guilds.cache`
   - Po kliknięciu → ranking z paginacją (10/strona, 1h timeout)
   - Ranking globalny wyróżniony kolorem niebieskim (0x5865f2), serwer złotym (0xffd700)
   - W rankingu globalnym każda linia zawiera nazwę serwera źródłowego

5. **System Powiadomień DM** - `notificationService.js` + `interactionHandlers.js`:
   - `/notifications` → ephemeral z przyciskami: `[🔔 Ustaw powiadomienie]` i `[🔕 Usuń powiadomienie]`
   - **Subskrypcja:** użytkownik wybiera serwer → gracza z rankingu → potwierdza → subskrypcja zapisana w `data/notifications.json`
   - **Wysyłanie DM:** po każdym nowym rekordzie bot szuka subskrybentów danego gracza i wysyła im DM z kopią embeda rekordu + zdjęciem + stopką `notifDmFooter`
   - `createDmNotifEmbed(recordEmbed, messages)` — klonuje embed rekordu i dodaje stopkę w `rankingService.js`
   - Subskrypcje są trwałe (plik JSON) — przeżywają restart bota
   - Limit: max 25 subskrypcji wyświetlanych naraz w select menu (Discord API limit)

**Komendy:** `/update`, `/ranking`, `/remove`, `/ocr-debug`, `/notifications`

**Struktura danych:**
```
EndersEcho/data/
├── ranking_{guildId1}.json   # Ranking serwera 1
├── ranking_{guildId2}.json   # Ranking serwera 2
├── notifications.json        # Subskrypcje powiadomień DM
└── ...
```

**Rejestracja komend:** Komendy slash są rejestrowane dla każdego serwera z `config.guilds`.

---

## Zmienne Środowiskowe

```env
ENDERSECHO_TOKEN=bot_token_here
ENDERSECHO_CLIENT_ID=client_id

# Serwer 1
ENDERSECHO_GUILD_1_ID=guild_id
ENDERSECHO_GUILD_1_CHANNEL=channel_id
ENDERSECHO_GUILD_1_LANG=pol          # pol lub eng (domyślnie pol)
ENDERSECHO_GUILD_1_TAG=🔥 PS         # Tag w globalnym rankingu (opcjonalny, np. "🔥 PS" lub "⚔️ CS")

# Role TOP serwera 1 (opcjonalne — jeśli brak, bot nie zarządza rolami)
ENDERSECHO_GUILD_1_TOP1_ROLE=role_id
ENDERSECHO_GUILD_1_TOP2_ROLE=role_id
ENDERSECHO_GUILD_1_TOP3_ROLE=role_id
ENDERSECHO_GUILD_1_TOP4TO10_ROLE=role_id
ENDERSECHO_GUILD_1_TOP11TO30_ROLE=role_id

# Serwer 2
ENDERSECHO_GUILD_2_ID=guild_id
ENDERSECHO_GUILD_2_CHANNEL=channel_id
ENDERSECHO_GUILD_2_LANG=eng          # pol lub eng (domyślnie pol)
ENDERSECHO_GUILD_2_TAG=⚔️ CS         # Tag w globalnym rankingu (opcjonalny)
# Role TOP serwera 2 (opcjonalne)
ENDERSECHO_GUILD_2_TOP1_ROLE=role_id
# ... itd.

# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ENDERSECHO_ANTHROPIC_MODEL=claude-3-haiku-20240307

# Sync do Polski Squad web API (opcjonalne, wspólne bot-wide)
APP_API_URL=https://api.polski-squad.example
BOT_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Najlepsze Praktyki

- **Logger:** `createBotLogger('EndersEcho')`
- **OCR Debug:** `/ocr-debug true`
- **Ranking per-serwer:** `rankingService.loadRanking(guildId)` / `saveRanking(guildId, ranking)`
- **Ranking globalny:** `rankingService.getGlobalRanking()` (merge wszystkich serwerów, best per player)
- **Role opcjonalne:** Zawsze przekazuj `guildConfig?.topRoles || null` do `roleService.updateTopRoles()`
- **Migracja:** Automatyczna przy starcie — stary `ranking.json` → `ranking_{guild1Id}.json`
