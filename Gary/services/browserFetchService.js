const { launchBrowser } = require('./puppeteerLauncher');

// Renders pages with a real headless browser for endpoints that are gated behind
// Cloudflare's JS challenge and cannot be reached with plain HTTP requests.
class BrowserFetchService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    async fetchRenderedHtml(url, options = {}) {
        const { waitForSelector, timeout = 30000 } = options;
        let browser;

        try {
            this.logger.info(`🌐 Launching headless browser to render ${url}...`);
            browser = await launchBrowser();

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            await page.goto(url, { waitUntil: 'networkidle2', timeout });

            if (waitForSelector) {
                try {
                    await page.waitForSelector(waitForSelector, { timeout: 15000 });
                } catch (waitError) {
                    this.logger.warn(`⚠️ Selector "${waitForSelector}" did not appear in time, using current page content anyway`);
                }
            }

            const html = await page.content();
            this.logger.info(`✅ Page rendered via headless browser (${html.length} bytes)`);
            return html;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}

module.exports = BrowserFetchService;
