### 🎮 Gary Bot

**9 Systemów:**
1. **Lunar Mine** - `apiService.js`: Fetch garrytools.com/lunar, cheerio parse, 4 gildie, członkowie sorted by attack
2. **Wyszukiwanie** - `guildSearchService.js`: Fuzzy matching (exact/startsWith/contains/levenshtein), tryby TOP500/GLOBAL
3. **Cache** - `dataService.js`: Persistent JSON (clans, rank, members), refresh 24h/manual/start
4. **Proxy** - `proxyService.js`: Webshare API, round-robin/random, health monitoring, failover
5. **Paginacja** - 20/strona, 1h timeout, publiczna nawigacja
6. **Cron** - Środa 18:45 `/lunarmine` auto-exec; 18:46 snapshot historii klanów
7. **Historia klanów** - `clanHistoryService.js`: tygodniowe snapshoty TOP500, `data/clan_history.json`, max 25 tygodni; wykres SVG+sharp dla `/analyse`, `/lunarmine` (multi-klan), `/search` (top match); wymagane ≥2 tygodnie danych
8. **Wątki** - Obsługa `parentId`, whitelist check
9. **Emoji** - Server emoji w embedach

**Komendy:** `/lunarmine`, `/search`, `/analyse`, `/player`, `/ee`, `/refresh`, `/proxy-test`, `/proxy-stats`, `/proxy-refresh`, `/lme-snapshot` (admin — ręczny snapshot + zapis historii, podmieniona `/test`)
**Env:** TOKEN, CLIENT_ID, ALLOWED_CHANNEL_ID, ADMIN_ROLES, PROXY_ENABLED, PROXY_STRATEGY, PROXY_LIST, WEBSHARE_URL

---


## Zmienne Środowiskowe

```env
GARY_TOKEN=bot_token_here
GARY_CLIENT_ID=client_id
GARY_ALLOWED_CHANNEL_ID=channel1,channel2
GARY_ADMIN_ROLES=role1,role2

# Proxy (opcjonalne)
GARY_PROXY_ENABLED=true
GARY_PROXY_STRATEGY=round-robin
GARY_PROXY_LIST=http://proxy1:port,http://proxy2:port
GARY_WEBSHARE_URL=https://proxy.webshare.io/api/v2/proxy/list/
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Gary') 
- **Cache:** Persistent JSON, refresh 24h
- **Proxy:** Webshare API, health monitoring
- **Cron:** Środa 18:45 auto /lunarmine; 18:46 zapisuje snapshot TOP500 do `data/clan_history.json`
- **Historia klanów:** `ClanHistoryService` — snapshot zapisuje rank+score+level+grade dla każdego klanu; przetrwa restart; max 25 snapshotów (starsze odcinane)
