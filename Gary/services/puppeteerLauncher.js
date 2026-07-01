const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');

// Serwer produkcyjny (Pterodactyl, Linux) nie ma zainstalowanych bibliotek systemowych
// (libatk, libnss3 itd.) wymaganych przez zwykłe headless Chrome pobrane przez puppeteer,
// więc na Linuksie używamy samodzielnego, statycznie zlinkowanego Chromium z @sparticuz/chromium.
// Lokalnie (Windows/macOS, do developmentu) pakiet ten nie dostarcza binarki, więc używamy
// zwykłej przeglądarki pobranej przez puppeteer.
async function launchBrowser() {
    if (process.platform === 'linux') {
        return puppeteer.launch({
            args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
            defaultViewport: { width: 1920, height: 1080 },
            executablePath: await chromium.executablePath(),
            headless: 'shell'
        });
    }

    return puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
}

module.exports = { launchBrowser };
