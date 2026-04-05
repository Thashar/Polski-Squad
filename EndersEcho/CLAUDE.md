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
   - **Migracja:** Przy pierwszym starcie stary `ranking.json` jest automatycznie migrowany do `ranking_{guild1Id}.json`

3. **Role TOP (opcjonalne)** - `roleService.js`:
   - 5 poziomów (top1, top2, top3, top4-10, top11-30), auto-update
   - Role są **opcjonalne per serwer** — jeśli serwer nie ma skonfigurowanych ról, bot je pomija
   - `updateTopRoles(guild, sortedPlayers, guildTopRoles)` — przyjmuje konfigurację ról danego serwera

4. **Paginacja + Wybór Rankingu** - `interactionHandlers.js`:
   - `/ranking` → ephemeral z przyciskami: `[NazwaSerwera1]`, `[NazwaSerwera2]`, `[🌐 Global]`
   - Nazwy serwerów pobierane dynamicznie z `client.guilds.cache`
   - Po kliknięciu → ranking z paginacją (10/strona, 1h timeout)
   - Ranking globalny wyróżniony kolorem niebieskim (0x5865f2), serwer złotym (0xffd700)
   - W rankingu globalnym każda linia zawiera nazwę serwera źródłowego

**Komendy:** `/update`, `/ranking`, `/remove`, `/ocr-debug`

**Struktura danych:**
```
EndersEcho/data/
├── ranking_{guildId1}.json   # Ranking serwera 1
├── ranking_{guildId2}.json   # Ranking serwera 2
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

# Role TOP serwera 1 (opcjonalne — jeśli brak, bot nie zarządza rolami)
ENDERSECHO_GUILD_1_TOP1_ROLE=role_id
ENDERSECHO_GUILD_1_TOP2_ROLE=role_id
ENDERSECHO_GUILD_1_TOP3_ROLE=role_id
ENDERSECHO_GUILD_1_TOP4TO10_ROLE=role_id
ENDERSECHO_GUILD_1_TOP11TO30_ROLE=role_id

# Serwer 2
ENDERSECHO_GUILD_2_ID=guild_id
ENDERSECHO_GUILD_2_CHANNEL=channel_id
# Role TOP serwera 2 (opcjonalne)
ENDERSECHO_GUILD_2_TOP1_ROLE=role_id
# ... itd.

# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ENDERSECHO_ANTHROPIC_MODEL=claude-3-haiku-20240307
```

## Najlepsze Praktyki

- **Logger:** `createBotLogger('EndersEcho')`
- **OCR Debug:** `/ocr-debug true`
- **Ranking per-serwer:** `rankingService.loadRanking(guildId)` / `saveRanking(guildId, ranking)`
- **Ranking globalny:** `rankingService.getGlobalRanking()` (merge wszystkich serwerów, best per player)
- **Role opcjonalne:** Zawsze przekazuj `guildConfig?.topRoles || null` do `roleService.updateTopRoles()`
- **Migracja:** Automatyczna przy starcie — stary `ranking.json` → `ranking_{guild1Id}.json`
