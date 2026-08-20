/**
 * Pobiera przenośnego Chromium (`chrome-headless-shell`) do katalogu cache kontenera.
 * Uruchamiany automatycznie przez `postinstall`, czyli przy każdym `npm install` —
 * a panel hostingu odpala `npm install` przy każdym starcie serwera. Dzięki temu
 * binarka pojawia się sama, bez roota i bez grzebania w komendzie startowej.
 *
 * Potrzebuje jej komenda /calc-boost w Stalkerze (`Stalker/services/computeBoostService.js`).
 *
 * Pomija się sam, gdy:
 * - system to nie Linux (na Windowsie do pracy lokalnej wystarczy zainstalowany Chrome/Edge),
 * - ustawiono `SKIP_CHROMIUM_INSTALL=1`,
 * - binarka już jest w cache (kolejne starty nie pobierają jej ponownie),
 * - w systemie jest już Chromium/Chrome (`/usr/bin/chromium` itd.).
 *
 * ⚠️ Skrypt NIGDY nie kończy się błędem — `npm install` nie może wywrócić się przez to,
 * że hosting nie ma internetu albo miejsca na dysku. W najgorszym razie /calc-boost
 * zwróci czytelny komunikat, a reszta botów działa normalnie.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCIEZKI_SYSTEMOWE = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
];

function log(wiadomosc) {
    console.log(`[chromium] ${wiadomosc}`);
}

async function main() {
    if (process.env.SKIP_CHROMIUM_INSTALL === '1') {
        log('SKIP_CHROMIUM_INSTALL=1 - pomijam pobieranie');
        return;
    }

    if (os.platform() !== 'linux') {
        log(`system ${os.platform()} - pomijam (lokalnie wystarczy zainstalowany Chrome/Edge)`);
        return;
    }

    const systemowy = SCIEZKI_SYSTEMOWE.find(p => fs.existsSync(p));
    if (systemowy) {
        log(`Chromium jest już w systemie: ${systemowy}`);
        return;
    }

    const { Browser, detectBrowserPlatform, resolveBuildId, computeExecutablePath, install } = require('@puppeteer/browsers');

    const cacheDir = process.env.PUPPETEER_CACHE_DIR
        || path.join(process.env.HOME || os.homedir(), '.cache', 'puppeteer');
    const browser = Browser.CHROMEHEADLESSSHELL;
    const platform = detectBrowserPlatform();

    if (!platform) {
        log('nie rozpoznano platformy - pomijam pobieranie');
        return;
    }

    const buildId = await resolveBuildId(browser, platform, 'stable');
    const executablePath = computeExecutablePath({ browser, buildId, cacheDir });

    if (fs.existsSync(executablePath)) {
        log(`już pobrany: ${executablePath}`);
        return;
    }

    log(`pobieram ${browser} ${buildId} do ${cacheDir} (~150 MB, tylko raz)...`);
    const zainstalowany = await install({ browser, buildId, cacheDir });
    log(`gotowe: ${zainstalowany.executablePath}`);
}

main().catch(error => {
    log(`⚠️ nie udało się pobrać Chromium: ${error.message}`);
    log('   /calc-boost będzie niedostępny, reszta botów działa normalnie');
    log('   ręcznie: npm run chromium:install');
});
