const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

const HABBY_GAME_ID = 3;
const HABBY_BASE_URL = 'https://store.habby.com';
const DELAY_BETWEEN_UIDS_MS = 3000;

class GiftcodeService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.uidsFile = path.join(__dirname, '../data/habby_uids.json');
    }

    async loadData() {
        try {
            const raw = await fs.readFile(this.uidsFile, 'utf8');
            return JSON.parse(raw);
        } catch {
            return { uids: {} };
        }
    }

    async saveData(data) {
        await fs.mkdir(path.dirname(this.uidsFile), { recursive: true });
        await fs.writeFile(this.uidsFile, JSON.stringify(data, null, 2));
    }

    async addUid(discordId, uid, displayName) {
        const data = await this.loadData();
        const existed = !!data.uids[discordId];
        data.uids[discordId] = {
            uid: uid.trim(),
            nick: displayName,
            addedAt: new Date().toISOString()
        };
        await this.saveData(data);
        return existed;
    }

    async removeUid(discordId) {
        const data = await this.loadData();
        if (!data.uids[discordId]) return null;
        const removed = data.uids[discordId];
        delete data.uids[discordId];
        await this.saveData(data);
        return removed;
    }

    async listUids() {
        const data = await this.loadData();
        return data.uids;
    }

    async getUserUid(discordId) {
        const data = await this.loadData();
        return data.uids[discordId] || null;
    }

    async redeemAll(giftcode, progressCallback) {
        const data = await this.loadData();
        const entries = Object.entries(data.uids);
        if (entries.length === 0) return [];

        const results = [];
        let browser;

        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote'
                ]
            });

            for (let i = 0; i < entries.length; i++) {
                const [discordId, userData] = entries[i];
                this.logger.info(`[GIFTCODE] Aktywuję kod dla ${userData.nick} (UID: ${userData.uid}) [${i + 1}/${entries.length}]`);

                const result = await this._redeemForUid(browser, userData.uid, giftcode, userData.nick);
                results.push({
                    discordId,
                    uid: userData.uid,
                    nick: userData.nick,
                    ...result
                });

                if (progressCallback) {
                    await progressCallback(i + 1, entries.length, results[results.length - 1]);
                }

                if (i < entries.length - 1) {
                    await new Promise(r => setTimeout(r, DELAY_BETWEEN_UIDS_MS));
                }
            }
        } finally {
            if (browser) {
                try { await browser.close(); } catch { /* ignore */ }
            }
        }

        return results;
    }

    async _redeemForUid(browser, uid, giftcode, nick) {
        const url = `${HABBY_BASE_URL}/game/${HABBY_GAME_ID}?page=giftcode&giftcode=${encodeURIComponent(giftcode)}`;
        const page = await browser.newPage();

        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 720 });

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Czekaj na pole tekstowe (UID input)
            await page.waitForSelector('input[type="text"], input[type="number"]', { timeout: 15000 });
            await new Promise(r => setTimeout(r, 1000));

            // Wypełnij pole UID
            const inputSelector = await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input'));
                const uidInput = inputs.find(i =>
                    i.type === 'text' || i.type === 'number' ||
                    (i.placeholder && (
                        i.placeholder.toLowerCase().includes('uid') ||
                        i.placeholder.toLowerCase().includes('player') ||
                        i.placeholder.toLowerCase().includes('id')
                    ))
                );
                if (!uidInput) return null;
                // Nadaj tymczasowy id żeby móc go potem targetować
                uidInput.setAttribute('data-giftcode-target', 'true');
                return '[data-giftcode-target="true"]';
            });

            if (!inputSelector) {
                return { success: false, message: 'Nie znaleziono pola UID na stronie' };
            }

            await page.click(inputSelector, { clickCount: 3 });
            await page.type(inputSelector, uid, { delay: 50 });

            // Kliknij submit
            const clicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find(b =>
                    b.type === 'submit' ||
                    /submit|redeem|confirm|exchange|兑换|領取|get|claim/i.test(b.textContent)
                ) || buttons[buttons.length - 1];

                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                return { success: false, message: 'Nie znaleziono przycisku submit' };
            }

            // Czekaj na odpowiedź strony
            const responseText = await this._waitForResponse(page);

            const isSuccess = this._isSuccessMessage(responseText);
            return { success: isSuccess, message: responseText };

        } catch (error) {
            this.logger.error(`[GIFTCODE] ❌ Błąd dla ${nick} (${uid}): ${error.message}`);
            return { success: false, message: `Błąd połączenia: ${error.message.split('\n')[0]}` };
        } finally {
            try { await page.close(); } catch { /* ignore */ }
        }
    }

    async _waitForResponse(page) {
        // Czekaj na pojawienie się komunikatu odpowiedzi
        try {
            await page.waitForFunction(() => {
                const candidates = [
                    ...document.querySelectorAll('[class*="result"]'),
                    ...document.querySelectorAll('[class*="message"]'),
                    ...document.querySelectorAll('[class*="success"]'),
                    ...document.querySelectorAll('[class*="error"]'),
                    ...document.querySelectorAll('[class*="dialog"]'),
                    ...document.querySelectorAll('[class*="toast"]'),
                    ...document.querySelectorAll('[class*="tip"]'),
                    ...document.querySelectorAll('[class*="modal"]'),
                    ...document.querySelectorAll('.el-message'),
                    ...document.querySelectorAll('.el-dialog__body')
                ];
                return candidates.some(el => {
                    const text = el.textContent.trim();
                    return text.length > 5 && !el.hidden && el.offsetHeight > 0;
                });
            }, { timeout: 10000 });
        } catch {
            // Timeout - spróbuj odczytać cokolwiek
        }

        await new Promise(r => setTimeout(r, 500));

        return page.evaluate(() => {
            const prioritySelectors = [
                '.el-dialog__body p',
                '.el-dialog__body',
                '.el-message span',
                '[class*="result"] p',
                '[class*="result"]',
                '[class*="success"]',
                '[class*="error"]',
                '[class*="tip"]',
                '[class*="toast"]',
                '[class*="dialog"] p',
                '[class*="modal"] p'
            ];

            for (const sel of prioritySelectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = el.textContent.trim();
                    if (text.length > 3) return text.substring(0, 200);
                }
            }

            return 'Brak odpowiedzi od serwera';
        });
    }

    _isSuccessMessage(msg) {
        if (!msg) return false;
        const lower = msg.toLowerCase();
        return (
            lower.includes('success') ||
            lower.includes('claimed') ||
            lower.includes('received') ||
            lower.includes('congratu') ||
            lower.includes('reward') ||
            lower.includes('redeemed') ||
            lower.includes('ok') && lower.length < 10
        );
    }
}

module.exports = GiftcodeService;
