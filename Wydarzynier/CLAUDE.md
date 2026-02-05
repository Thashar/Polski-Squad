### 🎉 Wydarzynier Bot

**4 Systemy:**
1. **Lobby Party** - `lobbyService.js`: Max 7 (1+6), 15min dyskusja/czas trwania, 5min ostrzeżenie, prywatny wątek
2. **Zaproszenia** - Join button → Accept/Reject workflow, tylko zaakceptowani (wyjątek admin), auto-usuwanie
3. **Repozytorium** - `repositionService.js`: 5min interval, repost ogłoszenia na górę, update licznika
4. **Subskrypcje** - Toggle role notifications po zapełnieniu, ephemeral feedback

**Komendy:** `/party`, `/party-add`, `/party-kick`, `/party-close`
**Env:** TOKEN

---


## Zmienne Środowiskowe

```env
WYDARZYNIER_TOKEN=bot_token_here
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Wydarzynier')
- **Lobby:** Max 7 osób (1+6), 15min dyskusja
- **Wątki:** Prywatne, auto-usuwanie po zamknięciu
- **Repozytorium:** 5min interval repost
