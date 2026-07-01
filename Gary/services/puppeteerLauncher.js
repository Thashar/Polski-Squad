const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');

// Serwer produkcyjny (Pterodactyl, Linux) nie ma zainstalowanych bibliotek systemowych
// (libatk, libnss3 itd.) wymaganych przez zwykłe headless Chrome pobrane przez puppeteer,
// więc na Linuksie używamy samodzielnego, statycznie zlinkowanego Chromium z @sparticuz/chromium.
// Lokalnie (Windows/macOS, do developmentu) pakiet ten nie dostarcza binarki, więc używamy
// zwykłej przeglądarki pobranej przez puppeteer.
//
// @sparticuz/chromium zawsze rozpakowuje ~150MB do os.tmpdir() (domyślnie /tmp). Na tym serwerze
// /tmp jest osobną, małą partycją niezależną od głównego dysku /home/container (gdzie jest mnóstwo
// wolnego miejsca), więc ekstrakcja kończy się ENOSPC. TMPDIR jest tymczasowo przekierowywany na
// katalog w obrębie Gary/temp (na dużym dysku) tylko na czas ekstrakcji/uruchomienia przeglądarki,
// a zaraz potem przywracana jest poprzednia wartość - inne miejsca w projekcie (np. backupManager.js)
// też korzystają z os.tmpdir() i nie powinny być trwale przekierowane.
const CHROMIUM_TMP_DIR = path.join(__dirname, '../temp/chromium');

// proxyServerArg: opcjonalny "host:port" (bez danych logowania) do przekazania jako --proxy-server.
// Uwierzytelnianie proxy trzeba ustawić osobno przez page.authenticate() po utworzeniu strony,
// bo Chrome nie przyjmuje danych logowania bezpośrednio w tym argumencie.
async function launchBrowser(proxyServerArg = null) {
    const proxyArgs = proxyServerArg ? [`--proxy-server=${proxyServerArg}`] : [];

    if (process.platform === 'linux') {
        fs.mkdirSync(CHROMIUM_TMP_DIR, { recursive: true });
        const previousTmpDir = process.env.TMPDIR;
        process.env.TMPDIR = CHROMIUM_TMP_DIR;

        try {
            return await puppeteer.launch({
                args: await puppeteer.defaultArgs({ args: [...chromium.args, ...proxyArgs], headless: 'shell' }),
                defaultViewport: { width: 1920, height: 1080 },
                executablePath: await chromium.executablePath(),
                headless: 'shell'
            });
        } finally {
            if (previousTmpDir === undefined) {
                delete process.env.TMPDIR;
            } else {
                process.env.TMPDIR = previousTmpDir;
            }
        }
    }

    return puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', ...proxyArgs]
    });
}

module.exports = { launchBrowser };
