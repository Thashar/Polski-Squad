### 🏆 EndersEcho Bot

**4 Systemy:**
1. **OCR Wyników** - Dwa tryby:
   - **Tradycyjny:** `ocrService.js` - Tesseract, preprocessing Sharp, ekstrakcja "Best" (K/M/B/T/Q/Qi), korekcja błędów (TT→1T)
   - **AI OCR (opcjonalny):** `aiOcrService.js` - Anthropic API (Claude Vision), dwuetapowa walidacja
     - Włączany przez `USE_ENDERSECHO_AI_OCR=true` w .env
     - Używa tego samego modelu co StalkerLME AI Chat (domyślnie: Claude 3 Haiku)
     - Trzyetapowa walidacja (trzy osobne requesty do API):
       - **KROK 1 (pierwszy request):** Sprawdza czy jest "Victory" (50 tokenów)
       - **KROK 2 (drugi request):** Sprawdza autentyczność zdjęcia (10 tokenów)
       - **KROK 3 (trzeci request):** Wyciąga nazwę bossa, wynik (Best) i Total (500 tokenów)
     - **Walidacja score vs Total:** Jeśli odczytany Best > Total → automatyczna korekta (usunięcie dodatkowej cyfry przed jednostką, np. "18540Q" → "1854Q")
     - Zalety: 100% pewność walidacji, oszczędność tokenów przy złych screenach, fallback na tradycyjny OCR
2. **Rankingi** - `rankingService.js`: Persistent JSON (userId_bossName), funkcje: add/update, getTop, remove
3. **Role TOP** - `roleManagementService.js`: 5 poziomów (top1, top2, top3-nieużywane, top4-10, top11-30), auto-update
4. **Paginacja** - `interactionHandlers.js`: 10/strona, przyciski nawigacji, 1h timeout

**Komendy:** `/update`, `/ranking`, `/remove`, `/ocr-debug`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, ALLOWED_CHANNEL_ID, USE_ENDERSECHO_AI_OCR (opcjonalne), ENDERSECHO_ANTHROPIC_API_KEY (opcjonalne), ENDERSECHO_ANTHROPIC_MODEL (opcjonalne)

---


## Zmienne Środowiskowe

```env
ENDERSECHO_TOKEN=bot_token_here
ENDERSECHO_CLIENT_ID=client_id
ENDERSECHO_GUILD_ID=guild_id
ENDERSECHO_ALLOWED_CHANNEL_ID=channel_id

# AI OCR (opcjonalne)
USE_ENDERSECHO_AI_OCR=false
ENDERSECHO_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx
ENDERSECHO_ANTHROPIC_MODEL=claude-3-haiku-20240307
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('EndersEcho')
- **OCR Debug:** /ocr-debug true
- **Ranking:** Persistent JSON (userId_bossName)
- **Role TOP:** 5 poziomów auto-update
