const fs = require('fs');
const path = require('path');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MONITOR RUCHU DYSKOWEGO — CAŁY PROCES, NIE TYLKO JSON
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `utils/jsonStore` cachuje pliki JSON i zlicza WYŁĄCZNIE swój własny ruch.
 * Tymczasem najcięższe operacje botów to zupełnie co innego:
 *   - screeny OCR (1–5 MB każdy: pobranie, przetworzenie przez sharp, zapis do processed_ocr)
 *   - cache mediów Muteusza (pliki do 100 MB — pobranie i odczyt przy reposcie)
 *   - `pol.traineddata` + `eng.traineddata` (po ~5 MB, ładowane przez Tesseract)
 *   - wykresy generowane przez sharp, ikony bossów, archiwa ZIP backupu
 *   - logi dopisywane przy każdej linii
 *
 * Ten moduł podmienia metody modułu `fs`, żeby policzyć KAŻDĄ operację odczytu
 * i zapisu w procesie — także tę wykonywaną wewnątrz bibliotek (sharp, tesseract.js,
 * archiver, discord.js przy wysyłce załącznika).
 *
 * ⚠️ MUSI być załadowany JAKO PIERWSZY w głównym `index.js`, zanim boty zdążą
 * zrobić `const { readFile } = require('fs').promises`. Taka destrukturyzacja
 * kopiuje referencję do funkcji — wykonana przed patchem ominęłaby licznik.
 *
 * Narzut: jedna inkrementacja licznika na operację. Nie buforujemy treści.
 */

const KATEGORIE = [
    { nazwa: 'obrazy OCR',     test: (p) => /processed_ocr|[\\/]temp[\\/].*\.(png|jpe?g|webp|bmp)$/i.test(p) },
    { nazwa: 'cache mediów',   test: (p) => /media_cache/i.test(p) },
    { nazwa: 'OCR traineddata', test: (p) => /\.traineddata$/i.test(p) },
    { nazwa: 'obrazy',         test: (p) => /\.(png|jpe?g|gif|webp|bmp|svg|mp4|mkv|webm|mov)$/i.test(p) },
    { nazwa: 'archiwa',        test: (p) => /\.(zip|gz|tar)$/i.test(p) },
    { nazwa: 'logi',           test: (p) => /\.log$/i.test(p) || /[\\/]logs[\\/]/i.test(p) },
    { nazwa: 'dane JSON',      test: (p) => /\.json$/i.test(p) },
    { nazwa: 'node_modules',   test: (p) => /node_modules/.test(p) },
    { nazwa: 'inne',           test: () => true }
];

// Limit mapy per-plik — patrz `_przytnij()`
const MAX_PLIKOW = 5000;
const ZOSTAW_PLIKOW = 2000;
const ETYKIETA_ZBIORCZA = '(pozostałe pliki — zwinięte)';

class DiskMonitor {
    constructor() {
        this._root = path.resolve(__dirname, '..');
        this._startedAt = Date.now();
        this._patched = false;

        // etykieta pliku -> { reads, readBytes, writes, writeBytes, kategoria, owner }
        this._perFile = new Map();
        this._totals = { reads: 0, readBytes: 0, writes: 0, writeBytes: 0, other: 0 };

        // okno dla raportu cyklicznego
        this._window = { reads: 0, readBytes: 0, writes: 0, writeBytes: 0, since: Date.now() };
    }

    _label(p) {
        try {
            const abs = path.resolve(String(p));
            return abs.startsWith(this._root)
                ? abs.slice(this._root.length + 1).replace(/\\/g, '/')
                : abs.replace(/\\/g, '/');
        } catch {
            return String(p);
        }
    }

    _kategoria(label) {
        return KATEGORIE.find(k => k.test(label)).nazwa;
    }

    /**
     * Właściciel = pierwszy segment ścieżki (nazwa bota, shared_data, logs…).
     * Dla plików spoza projektu: '(poza projektem)'.
     */
    _owner(label) {
        if (label.startsWith('/') || /^[A-Za-z]:/.test(label)) return '(poza projektem)';
        const seg = label.split('/')[0];
        return seg.endsWith('.json') || seg.includes('.') ? '(katalog główny)' : seg;
    }

    zapisz(kind, sciezka, bytes) {
        if (!bytes || bytes < 0) bytes = 0;
        const label = this._label(sciezka);

        if (kind === 'read') {
            this._totals.reads++; this._totals.readBytes += bytes;
            this._window.reads++; this._window.readBytes += bytes;
        } else {
            this._totals.writes++; this._totals.writeBytes += bytes;
            this._window.writes++; this._window.writeBytes += bytes;
        }

        let f = this._perFile.get(label);
        if (!f) {
            f = {
                reads: 0, readBytes: 0, writes: 0, writeBytes: 0,
                kategoria: this._kategoria(label),
                owner: this._owner(label)
            };
            this._perFile.set(label, f);
            if (this._perFile.size > MAX_PLIKOW) this._przytnij();
        }
        if (kind === 'read') { f.reads++; f.readBytes += bytes; }
        else { f.writes++; f.writeBytes += bytes; }
    }

    /**
     * Ogranicza rozmiar mapy per-plik.
     *
     * ⚠️ Każdy screen OCR, plik cache mediów i plik tymczasowy ma UNIKALNĄ nazwę,
     * więc bez przycinania mapa rosłaby przez cały uptime — kolejny cichy wyciek pamięci.
     * Zostawiamy najcięższe pozycje (te są istotne w raporcie), a resztę zwijamy w jeden
     * wpis zbiorczy, żeby sumy per bot i per kategoria dalej się zgadzały z całością.
     */
    _przytnij() {
        const wpisy = [...this._perFile.entries()]
            .sort((a, b) => (b[1].readBytes + b[1].writeBytes) - (a[1].readBytes + a[1].writeBytes));

        const zostaje = wpisy.slice(0, ZOSTAW_PLIKOW);
        const zwijane = wpisy.slice(ZOSTAW_PLIKOW);
        if (zwijane.length === 0) return;

        const zbiorczy = this._perFile.get(ETYKIETA_ZBIORCZA) || {
            reads: 0, readBytes: 0, writes: 0, writeBytes: 0,
            kategoria: 'inne', owner: '(zwinięte)'
        };
        for (const [, f] of zwijane) {
            if (f === zbiorczy) continue;
            zbiorczy.reads += f.reads; zbiorczy.readBytes += f.readBytes;
            zbiorczy.writes += f.writes; zbiorczy.writeBytes += f.writeBytes;
        }

        this._perFile = new Map(zostaje.filter(([label]) => label !== ETYKIETA_ZBIORCZA));
        this._perFile.set(ETYKIETA_ZBIORCZA, zbiorczy);
    }

    /**
     * Podmienia metody `fs`. Idempotentne — drugi raz nic nie robi.
     */
    patch() {
        if (this._patched) return;
        this._patched = true;
        const self = this;

        const dlugosc = (dane) => {
            if (dane == null) return 0;
            if (Buffer.isBuffer(dane)) return dane.length;
            if (typeof dane === 'string') return Buffer.byteLength(dane);
            try { return Buffer.byteLength(String(dane)); } catch { return 0; }
        };

        // ─── warianty synchroniczne ───────────────────────────────────────
        const readFileSync = fs.readFileSync;
        fs.readFileSync = function (p, ...reszta) {
            const wynik = readFileSync.call(this, p, ...reszta);
            self.zapisz('read', p, dlugosc(wynik));
            return wynik;
        };

        // ⚠️ Patchujemy TYLKO writeFileSync — `fs.appendFileSync` woła je wewnętrznie
        // (z flagą 'a'), więc opakowanie obu liczyłoby każdy dopisany log DWA razy.
        // Wariant asynchroniczny zachowuje się odwrotnie: `promises.appendFile` NIE
        // przechodzi przez `promises.writeFile`, dlatego niżej jest patchowany osobno.
        const writeFileSync = fs.writeFileSync;
        fs.writeFileSync = function (p, dane, ...reszta) {
            const wynik = writeFileSync.call(this, p, dane, ...reszta);
            self.zapisz('write', p, dlugosc(dane));
            return wynik;
        };

        // ─── warianty obietnicowe (fs.promises) ───────────────────────────
        const promises = fs.promises;

        const readFile = promises.readFile;
        promises.readFile = async function (p, ...reszta) {
            const wynik = await readFile.call(this, p, ...reszta);
            self.zapisz('read', p, dlugosc(wynik));
            return wynik;
        };

        for (const nazwa of ['writeFile', 'appendFile']) {
            const oryg = promises[nazwa];
            promises[nazwa] = async function (p, dane, ...reszta) {
                const wynik = await oryg.call(this, p, dane, ...reszta);
                self.zapisz('write', p, dlugosc(dane));
                return wynik;
            };
        }

        // copyFile liczy się podwójnie: odczyt źródła + zapis celu
        const copyFile = promises.copyFile;
        promises.copyFile = async function (src, dst, ...reszta) {
            const wynik = await copyFile.call(this, src, dst, ...reszta);
            try {
                const st = await promises.stat(dst);
                self.zapisz('read', src, st.size);
                self.zapisz('write', dst, st.size);
            } catch { /* rozmiar nieistotny przy błędzie */ }
            return wynik;
        };

        // ─── strumienie (pobieranie mediów, pakowanie ZIP, upload na Drive) ──
        const createReadStream = fs.createReadStream;
        fs.createReadStream = function (p, ...reszta) {
            const strumien = createReadStream.call(this, p, ...reszta);
            let suma = 0;
            strumien.on('data', (chunk) => { suma += chunk.length; });
            strumien.on('close', () => self.zapisz('read', p, suma));
            return strumien;
        };

        // Zapis strumieniowy liczymy PRZYROSTOWO, przy każdym chunku — nie na `close`.
        // Strumień pliku logu żyje przez cały czas pracy bota, więc zliczanie na zamknięciu
        // oznaczałoby, że logi nigdy nie pojawią się w statystykach.
        const createWriteStream = fs.createWriteStream;
        fs.createWriteStream = function (p, ...reszta) {
            const strumien = createWriteStream.call(this, p, ...reszta);
            const write = strumien.write.bind(strumien);
            strumien.write = function (chunk, ...rest) {
                if (chunk) {
                    self.zapisz('write', p, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk)));
                }
                return write(chunk, ...rest);
            };
            return strumien;
        };
    }

    formatBytes(bytes) {
        if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
        if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
    }

    /** Zbiera i zeruje okno raportowania. `null`, gdy nie było ruchu. */
    collectWindow() {
        const w = this._window;
        this._window = { reads: 0, readBytes: 0, writes: 0, writeBytes: 0, since: Date.now() };
        if (w.reads === 0 && w.writes === 0) return null;
        return { ...w, seconds: Math.round((Date.now() - w.since) / 1000) };
    }

    /**
     * Pełny raport dla komendy `/io`.
     */
    getReport(limit = 10) {
        const pliki = [...this._perFile.entries()].map(([label, f]) => ({
            label, ...f,
            ops: f.reads + f.writes,
            bytes: f.readBytes + f.writeBytes
        }));

        const grupuj = (keyFn) => {
            const m = new Map();
            for (const p of pliki) {
                const k = keyFn(p);
                const a = m.get(k) || { klucz: k, reads: 0, readBytes: 0, writes: 0, writeBytes: 0, files: 0 };
                a.reads += p.reads; a.readBytes += p.readBytes;
                a.writes += p.writes; a.writeBytes += p.writeBytes;
                a.files++;
                m.set(k, a);
            }
            return [...m.values()]
                .map(a => ({ ...a, bytes: a.readBytes + a.writeBytes, ops: a.reads + a.writes }))
                .sort((a, b) => b.bytes - a.bytes);
        };

        const sort = (arr, key) => [...arr].sort((a, b) => b[key] - a[key]).slice(0, limit);
        const czytane = pliki.filter(p => p.reads > 0);
        const zapisywane = pliki.filter(p => p.writes > 0);
        const sekundy = Math.max(1, (Date.now() - this._startedAt) / 1000);

        return {
            uptimeMs: Date.now() - this._startedAt,
            ...this._totals,
            bajtyNaSekunde: (this._totals.readBytes + this._totals.writeBytes) / sekundy,
            plikow: pliki.length,

            topWaga: sort(pliki, 'bytes'),
            topOdczytIlosc: sort(czytane, 'reads'),
            topOdczytWaga: sort(czytane, 'readBytes'),
            topZapisIlosc: sort(zapisywane, 'writes'),
            topZapisWaga: sort(zapisywane, 'writeBytes'),
            wgBota: grupuj(p => p.owner),
            wgKategorii: grupuj(p => p.kategoria)
        };
    }
}

module.exports = new DiskMonitor();
module.exports.DiskMonitor = DiskMonitor;
