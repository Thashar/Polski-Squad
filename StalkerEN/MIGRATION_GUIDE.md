# Przewodnik Migracji - Nowa Struktura Plików

## 📋 Wprowadzenie

Bot został zaktualizowany aby używać nowej, wydajniejszej struktury przechowywania danych. Zamiast dwóch dużych plików JSON, dane są teraz przechowywane w osobnych plikach dla każdego tygodnia i klanu.

### Korzyści:
✅ **Szybsze odczytywanie** - ładuje tylko potrzebny tydzień zamiast wszystkich danych
✅ **Lepsza skalowalność** - może obsłużyć setki tygodni bez spowolnienia
✅ **Łatwiejsze zarządzanie** - możesz łatwo znaleźć i edytować konkretny tydzień
✅ **Mniejsze ryzyko uszkodzenia** - jeśli jeden plik się uszkodzi, pozostałe są bezpieczne

---

## 🔄 Jak przeprowadzić migrację

### Krok 1: Backup danych (zalecane)

Przed migracją zrób backup całego folderu `data/`:

```bash
# Windows
xcopy data data_backup /E /I

# Linux/Mac
cp -r data data_backup
```

### Krok 2: Uruchom skrypt migracji

```bash
cd "C:\Users\Thash\Desktop\Bots\Polski Squad\StalkerLME"
node migrate.js
```

### Krok 3: Sprawdź logi

Skrypt wyświetli szczegółowe informacje o migracji:
- Ile plików zostało zmigrowanych dla Phase 1
- Ile plików zostało zmigrowanych dla Phase 2
- Czy wystąpiły błędy

### Krok 4: Uruchom bota

Po zakończeniu migracji możesz normalnie uruchomić bota:

```bash
npm start
```

Bot automatycznie będzie używał nowej struktury!

---

## 📁 Struktura przed migracją

```
data/
├── punishments.json
├── weekly_removal.json
├── phase1_results.json          ← STARA STRUKTURA (wszystkie dane w jednym pliku)
└── phase2_results.json          ← STARA STRUKTURA (wszystkie dane w jednym pliku)
```

## 📁 Struktura po migracji

```
data/
├── punishments.json
├── weekly_removal.json
├── phase1_results.json.backup   ← Backup starego pliku
├── phase2_results.json.backup   ← Backup starego pliku
└── phases/
    └── guild_1234567890/
        ├── phase1/
        │   ├── 2024/
        │   │   ├── week-50_clan1.json
        │   │   ├── week-50_clan2.json
        │   │   └── week-51_clan1.json
        │   └── 2025/
        │       ├── week-1_clan1.json
        │       ├── week-2_clan1.json
        │       └── week-2_clan2.json
        └── phase2/
            └── 2025/
                ├── week-1_clan1.json
                └── week-2_clan1.json
```

---

## ⚠️ Co się stanie ze starymi plikami?

Stare pliki (`phase1_results.json` i `phase2_results.json`) **NIE SĄ USUWANE**.
Zostaną zachowane jako `.backup`:
- `phase1_results.json.backup`
- `phase2_results.json.backup`

Możesz je usunąć **po upewnieniu się**, że wszystko działa poprawnie.

---

## 🧪 Testowanie po migracji

Po migracji przetestuj wszystkie komendy:

1. `/faza1` - Dodaj nowe wyniki dla Fazy 1
2. `/faza2` - Dodaj nowe wyniki dla Fazy 2 (3 rundy)
3. `/wyniki` - Sprawdź czy wyniki wyświetlają się poprawnie
4. `/modyfikuj` - Zmodyfikuj wynik gracza
5. `/dodaj` - Dodaj nowego gracza do istniejących danych

---

## 🔧 Rozwiązywanie problemów

### Problem: "Cannot find module './config/config.json'"
**Rozwiązanie**: Upewnij się że uruchamiasz skrypt z katalogu `StalkerLME/`

### Problem: "Błąd odczytu dostępnych tygodni"
**Rozwiązanie**:
1. Sprawdź czy migracja się zakończyła pomyślnie
2. Sprawdź czy folder `data/phases/` został utworzony
3. Sprawdź logi pod kątem błędów

### Problem: Bot nie widzi starych danych po migracji
**Rozwiązanie**:
1. Sprawdź czy pliki `.backup` istnieją
2. Sprawdź czy w `data/phases/guild_<id>/` są pliki JSON
3. Uruchom ponownie migrację

---

## 📞 Pomoc

Jeśli napotkasz problemy:
1. Sprawdź logi migracji
2. Upewnij się że backupy istnieją
3. Możesz przywrócić stare pliki z backupu

---

## ✅ Checklist po migracji

- [ ] Uruchomiłem `node migrate.js`
- [ ] Migracja zakończyła się bez błędów
- [ ] Folder `data/phases/` został utworzony
- [ ] Pliki `.backup` istnieją
- [ ] Przetestowałem `/faza1`
- [ ] Przetestowałem `/faza2`
- [ ] Przetestowałem `/wyniki`
- [ ] Przetestowałem `/modyfikuj`
- [ ] Przetestowałem `/dodaj`
- [ ] Usunąłem stare pliki `.backup` (opcjonalne)
