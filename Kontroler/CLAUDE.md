### 🎯 Kontroler Bot

**4 Systemy:**
1. **OCR Dwukanałowy** - `ocrService.js`: CX (1500min, 0-2800/100, skip1, rola 2800+), Daily (910min, 0-1050/10, skip3, 2x nick), normalizacja znaków (o→0, z→2, l→1, sg→9)
   - **Zapis CX do shared_data:** Po udanym OCR na kanale CX, wynik jest zapisywany do `shared_data/cx_history.json` (klucz: userId, historia max 20 wyników). Używane przez Stalker Bot w `/player-status` i `/player-compare`
2. **Loteria** - `lotteryService.js`: Daty (dd.mm.yyyy HH:MM), DST auto, multi-klan (server/main/0/1/2), cykle (0-365dni, max 24d), ostrzeżenia (90/30min), historia+przelosowanie, ban filter
3. **Dywersja w klanie** - `votingService.js`:
   - Trigger: Fraza "działasz na szkodę klanu" w odpowiedzi do użytkownika
   - Głosowanie: 15 minut (przyciski Tak/Nie), ping roli klanowej
   - Wynik: >50% TAK → rola Dywersanta 24h, remis → powtórka (max 3 razy)
   - Cooldown: 7 dni per użytkownik
   - **Persistencja:** 3 pliki JSON (active_votes.json, vote_history.json, saboteur_roles.json)
   - **Restart-safe:** Przywracanie timerów głosowań i usuwania ról po restarcie bota
4. **Oligopoly** - `oligopolyService.js`:
   - System zarządzania ID graczy pogrupowanych po klanach
   - Automatyczna detekcja klanu na podstawie roli użytkownika
   - Zabezpieczenie przed duplikatami ID
   - Aktualizacja wpisów (jeden wpis per użytkownik per klan)
   - **Persistencja:** `oligopoly.json` (userId, username, serverNickname, klan, id, timestamp)
   - **Komendy:** `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`

**Komendy:** `/lottery`, `/lottery-list`, `/lottery-remove`, `/lottery-history`, `/lottery-reroll`, `/lottery-debug`, `/ocr-debug`, `/oligopoly`, `/oligopoly-review`, `/oligopoly-list`, `/oligopoly-clear`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, ROBOT (opcjonalne, lista user ID rozdzielona przecinkami)

**Przekazywanie wiadomości (Robot1):**
- Użytkownicy z ID w `ROBOT1` mogą pisać priv do bota, a wiadomości są przekazywane 1:1 na kanał `1486848827997818900`
- Obsługuje tekst i załączniki
- Wymaga intencji `DirectMessages` + partial `Channel`
- **Ping roli:** Jeśli wiadomość DM zaczyna się od `@`, zostanie wysłana z pingiem do roli `1486506395057524887`

---


## Zmienne Środowiskowe

```env
KONTROLER_TOKEN=bot_token_here
KONTROLER_CLIENT_ID=client_id
KONTROLER_GUILD_ID=guild_id
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Kontroler')
- **OCR:** Dwukanałowy (CX + Daily)
- **Loteria:** DST auto, multi-klan, cykle 0-365 dni
- **Persistencja:** active_votes.json, vote_history.json, saboteur_roles.json
