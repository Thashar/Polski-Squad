### 🤖 Muteusz Bot

**11 Systemów:**
1. **Auto-Moderacja** - `autoModerationService.js`: Spam (3 duplikaty/30min=7d timeout), wulgaryzmy (progresja kar), zaproszenia Discord
2. **Cache Mediów** - `mediaService.js`: 100MB/plik, 2GB total, 24h retencja
3. **Zarządzanie Rolami** - `roleManagementService.js`: Ekskluzywne grupy (`special_roles.json`), auto-usuwanie konfliktów, 5s delay
4. **Naruszenia** - `warningsService.js`: Persistent JSON z UUID, reason, moderator, timestamp
5. **Koordynacja** - `roleKickingService.js`: Cron 2h, kick bez ról po 24h (integracja Rekruter)
6. **Chaos Mode** - `chaosService.js`: 5% szansa rola (permanent), hymn PL (5 zwrotek), 10% odpowiedź bota, multi-role support
7. **Losowe Odpowiedzi** - Virtutti Papajlari: 1/250 szansa, emoji PepeSoldier
8. **Guard Checky** - `index.js`: Flaga `isFullyInitialized` blokuje eventy podczas startu, zapobiega błędami "Klient Discord nie jest dostępny"
9. **Reaction Roles na wiadomościach** - `reactionRoleService.js`: Nadawanie/usuwanie ról za reakcje na konkretnych wiadomościach (np. ✅ na wiadomości → rola). Konfiguracja w `messageReactionRoles` w serwisie.
10. **System Zgłoszeń** - `interactionHandlers.js`: Trzy tryby zgłaszania:
    - Komenda `/zgłoś` (link + opcjonalny powód)
    - Przycisk `<a:PepeAlarmMan>` na kanale `1170349018900074637` (otwiera modal)
    - **Context menu wiadomości**: Prawy klik → Aplikacje → "Zgłoś wiadomość" (modal z powodem)

    Zgłoszenie trafia jako embed na kanał raportów (`MUTEUSZ_REPORT_CHANNEL_ID` lub fallback `MUTEUSZ_LOG_CHANNEL_ID`) z przyciskami akcji dla moderatorów: 🔨 Ostrzeż, 🔇 Wycisz (otwiera modal z czasem w formacie 10m/2h/1d), 🗑️ Usuń wiadomość, ✅ Nie rób nic. Po akcji embed zmienia kolor i usuwa przyciski. Przy starcie bota automatycznie wysyłana jest wiadomość z przyciskiem (jeśli jeszcze nie istnieje).

    **Zgłoszenia moderatorów**: Jeśli zgłoszony użytkownik ma uprawnienia moderatora (`ModerateMembers` lub `Administrator`), embed ma pomarańczowy kolor i inny tytuł. Dostępne przyciski: 🗑️ Usuń wiadomość, ✅ Nie rób nic. Wiadomość zawiera ping tekstowy `⚠️ Zgłoszenie dotyczy moderatora — wymagana akcja administratora.`

    **Context menu użytkownika** (moderator-only): Prawy klik → Aplikacje → "Wycisz użytkownika" (modal z czasem + powodem) lub "Ostrzeż użytkownika" (modal z powodem).

    **Statystyki zgłoszeń** - `reportStatsService.js` + `data/report_stats.json`: Każdy użytkownik ma liczniki: `totalReports`, `effectiveReports` (warn/mute/delete), `nothingReports`. Zasady:
    - 3x "nie rób nic" w ciągu 7 dni → blokada zgłoszeń na tydzień (DM do użytkownika + komunikat przy próbie zgłoszenia)
    - 1 skuteczne zgłoszenie (warn/mute/delete) → zeruje licznik "nie rób nic" w tygodniu
    - Blokada automatycznie wygasa po tygodniu przy następnej próbie zgłoszenia

11. **Komenda /msg** - `interactionHandlers.js`: Wysyłanie wiadomości botem na dowolny kanał tekstowy. Tylko dla administratorów. Parametry: `kanał` (wymagany), `wiadomość` (wymagana), `ping` (opcjonalne - ID ról oddzielone przecinkami, "everyone" lub "here"). Pingi doklejane są przed treścią wiadomości.

13. **Zmiana nazwy kanału emoji** - `index.js`: Gdy administrator (lub osoba z rolą `1196586785413795850`) wyśle wiadomość zawierającą WYŁĄCZNIE 🛑 lub 🟢, bot usuwa ikonę z początku nazwy kanału i wstawia wysłane emoji. Wiadomość jest automatycznie usuwana. Obsługuje myślnik po emoji (np. `🟢-general` → `🛑-general`). Admini mogą używać na dowolnym kanale; rola `1196586785413795850` tylko na kanałach: `1194298890069999756`, `1200051393843695699`, `1262792174475673610`.

12. **Prima Aprilis** - `primaAprilisService.js`: Moduł prima aprilis. Przy starcie bota wysyła (lub aktualizuje istniejącą) wiadomość z czerwonym przyciskiem 🛑 "NIE KLIKAĆ POD ŻADNYM POZOREM" na kanale `1486500418358870074`. Po kliknięciu: zapisuje wszystkie role użytkownika do `data/prima_aprilis_roles.json`, odbiera je i nadaje rolę więźnia `1486506395057524887`. Użytkownik wychodzi pisząc `exit` gdziekolwiek - role są przywracane. Persistencja przeżywa restart bota.

**Komendy:** `/remove-roles`, `/special-roles`, `/add-special-role`, `/remove-special-role`, `/list-special-roles`, `/violations`, `/unregister-command`, `/chaos-mode`, `/msg`, `/zgłoś`, context: `Zgłoś wiadomość`, `Wycisz użytkownika`, `Ostrzeż użytkownika`
**Env:** TOKEN, CLIENT_ID, GUILD_ID, TARGET_CHANNEL_ID, LOG_CHANNEL_ID, REPORT_CHANNEL_ID (opcjonalne, fallback na LOG_CHANNEL_ID)

---


## Zmienne Środowiskowe

```env
MUTEUSZ_TOKEN=bot_token_here
MUTEUSZ_CLIENT_ID=client_id
MUTEUSZ_GUILD_ID=guild_id
MUTEUSZ_TARGET_CHANNEL_ID=channel_id
MUTEUSZ_LOG_CHANNEL_ID=channel_id
MUTEUSZ_REPORT_CHANNEL_ID=channel_id  # opcjonalne - kanał dla zgłoszeń (fallback na LOG_CHANNEL_ID)
```

## Najlepsze Praktyki

- **Logger:** createBotLogger('Muteusz')
- **Cache mediów:** 100MB/plik, 2GB total, 24h retencja
- **Role:** Ekskluzywne grupy w special_roles.json
- **Guard Checky:** isFullyInitialized flag chroni przed błędami startu
