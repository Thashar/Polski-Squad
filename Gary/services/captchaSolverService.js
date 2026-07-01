const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

const LUNAR_DETAILS_URL = 'https://garrytools.com/lunar/';
const CHALLENGE_ROUND_TIMEOUT = 90000; // czas na jedną rundę (klikanie kafelków) w Discordzie
const CHALLENGE_TOTAL_DEADLINE = 100000; // token reCAPTCHA jest ważny ok. 2 minuty od kliknięcia checkboxa
const MAX_ROUNDS = 6;

// Rozwiązuje formularz "Lunar Details" (chroniony przez Google reCAPTCHA) przekazując
// wyzwanie obrazkowe do rozwiązania administratorowi na Discordzie, zamiast próbować je ominąć automatycznie.
class CaptchaSolverService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    // context: { interaction, channel, invokerId }
    // - interaction obecny -> wyzwanie wysyłane jako ephemeral followUp (widoczne tylko dla invokera)
    // - tylko channel (np. cotygodniowy cron bez interakcji) -> zwykła wiadomość na kanale, widoczna dla wszystkich
    async solveLunarDetailsGroupId(guildIds, context) {
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            await page.goto(LUNAR_DETAILS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.dismissCookieConsent(page);

            await page.type('input[name="clan_1"]', guildIds[0].toString());
            await page.type('input[name="clan_2"]', guildIds[1].toString());
            await page.type('input[name="clan_3"]', guildIds[2].toString());
            await page.type('input[name="clan_4"]', guildIds[3].toString());

            await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 15000 });
            const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor'));
            if (!anchorFrame) {
                throw new Error('Nie znaleziono widgetu reCAPTCHA na stronie');
            }
            const checkbox = await anchorFrame.$('#recaptcha-anchor');
            await checkbox.click();
            await this.sleep(2500);

            const solved = await this.resolveChallengeLoop(page, context);
            if (!solved) {
                throw new Error('Captcha nie została rozwiązana (anulowano, przekroczono liczbę prób lub upłynął czas)');
            }

            const submitBtn = await page.$('form button[type="submit"]');
            if (!submitBtn) {
                throw new Error('Nie znaleziono przycisku "Show Details" po rozwiązaniu captchy');
            }
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
                submitBtn.click()
            ]);
            await this.sleep(1000);

            let groupId = this.extractGroupIdFromUrl(page.url());
            if (!groupId) {
                const html = await page.content();
                groupId = this.extractGroupIdFromUrl(html);
            }

            if (!groupId) {
                throw new Error('Captcha rozwiązana, ale strona nie przekierowała do wyników (brak Group ID)');
            }

            this.logger.info(`🧩 Captcha rozwiązana pomyślnie, Group ID: ${groupId}`);
            return groupId;

        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    extractGroupIdFromUrl(text) {
        if (!text) return null;
        const match = text.match(/detail\/(\d{6})/);
        return match ? match[1] : null;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async dismissCookieConsent(page) {
        try {
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await btn.evaluate(el => el.textContent.trim());
                if (text.includes('Zgadzam się') || /^(accept|agree)/i.test(text)) {
                    await btn.click();
                    await this.sleep(800);
                    return;
                }
            }
        } catch (error) {
            this.logger.warn(`⚠️ Nie udało się zamknąć okna zgody na cookies: ${error.message}`);
        }
    }

    // Wysyła wiadomość jako ephemeral followUp gdy dostępna jest interaction, w przeciwnym razie zwykłą wiadomość na kanale
    async sendMessage(context, payload) {
        if (context.interaction) {
            return context.interaction.followUp({ ...payload, ephemeral: true });
        }
        return context.channel.send(payload);
    }

    resolveInvokerId(context) {
        return context.interaction ? context.interaction.user.id : (context.invokerId || null);
    }

    async resolveChallengeLoop(page, context) {
        const deadline = Date.now() + CHALLENGE_TOTAL_DEADLINE;

        for (let round = 1; round <= MAX_ROUNDS; round++) {
            if (Date.now() > deadline) {
                await this.sendMessage(context, { content: '⏱️ Upłynął czas na rozwiązanie captchy (token reCAPTCHA wygasł).' });
                return false;
            }

            const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor'));
            const alreadyChecked = await anchorFrame?.$eval('#recaptcha-anchor', el => el.getAttribute('aria-checked')).catch(() => null);
            if (alreadyChecked === 'true') {
                return true;
            }

            const bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
            if (!bframe) {
                await this.sleep(1500);
                continue;
            }

            const tiles = await bframe.$$('.rc-imageselect-tile').catch(() => []);
            if (tiles.length === 0) {
                await this.sleep(1500);
                continue;
            }

            const instruction = await bframe.$eval(
                '.rc-imageselect-desc-wrapper, .rc-imageselect-desc-no-canonical',
                el => el.textContent.trim()
            ).catch(() => 'Rozwiąż wyzwanie reCAPTCHA');

            const widgetHandle = await this.findChallengeIframeElement(page);
            if (!widgetHandle) {
                await this.sleep(1500);
                continue;
            }

            const screenshotBuffer = await widgetHandle.screenshot();
            const tilePositions = await this.getTileRelativePositions(tiles, widgetHandle);
            const numberedBuffer = await this.overlayTileNumbers(screenshotBuffer, tilePositions);

            const selection = await this.askForSelection(context, numberedBuffer, instruction, tiles.length, round);
            if (selection === null) {
                return false; // anulowano lub upłynął czas rundy
            }

            for (const idx of selection) {
                if (tiles[idx]) {
                    await tiles[idx].click().catch(() => {});
                    await this.sleep(250 + Math.random() * 250);
                }
            }

            const verifyBtn = await bframe.$('#recaptcha-verify-button');
            if (verifyBtn) {
                await verifyBtn.click().catch(() => {});
            }
            await this.sleep(2000);
        }

        await this.sendMessage(context, { content: '❌ Przekroczono maksymalną liczbę prób rozwiązania captchy.' });
        return false;
    }

    async findChallengeIframeElement(page) {
        const iframeElements = await page.$$('iframe[src*="recaptcha"]');
        for (const handle of iframeElements) {
            const src = await handle.evaluate(el => el.src).catch(() => '');
            if (src.includes('bframe')) {
                return handle;
            }
        }
        return null;
    }

    // Zwraca pozycje kafelków (x/y/width/height) względem lewego górnego rogu widgetu,
    // wyliczone z prawdziwych bounding boxów w DOM - odporne na nagłówek/stopkę o dowolnej wysokości.
    async getTileRelativePositions(tiles, widgetHandle) {
        const widgetBox = await widgetHandle.boundingBox();
        const positions = [];
        for (const tile of tiles) {
            const box = await tile.boundingBox();
            positions.push({
                x: box.x - widgetBox.x,
                y: box.y - widgetBox.y,
                width: box.width,
                height: box.height
            });
        }
        return positions;
    }

    async overlayTileNumbers(screenshotBuffer, tilePositions) {
        const meta = await sharp(screenshotBuffer).metadata();

        let svgLabels = '';
        tilePositions.forEach((pos, i) => {
            const x = pos.x + 6;
            const y = pos.y + 20;
            svgLabels += `
                <rect x="${x - 3}" y="${y - 16}" width="24" height="20" fill="black" opacity="0.6" rx="3"/>
                <text x="${x}" y="${y}" font-size="16" font-weight="bold" fill="yellow">${i + 1}</text>
            `;
        });
        const svg = `<svg width="${meta.width}" height="${meta.height}">${svgLabels}</svg>`;

        return sharp(screenshotBuffer)
            .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
            .png()
            .toBuffer();
    }

    async askForSelection(context, imageBuffer, instruction, tileCount, round) {
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });
        const embed = new EmbedBuilder()
            .setTitle(`🧩 Wymagane rozwiązanie captchy (runda ${round}/${MAX_ROUNDS})`)
            .setDescription(
                `**${instruction}**\n\n` +
                `Kliknij numery pasujących kafelków, a na końcu **✅ Zatwierdź**.\n` +
                `Jeśli żaden nie pasuje, od razu kliknij **✅ Zatwierdź**.`
            )
            .setColor(0x3498db)
            .setImage('attachment://captcha.png')
            .setFooter({ text: 'Masz 90 sekund na tę rundę.' });

        const invokerId = this.resolveInvokerId(context);
        const selected = new Set();
        const message = await this.sendMessage(context, {
            embeds: [embed],
            components: this.buildTileButtons(tileCount, selected),
            files: [attachment]
        });

        return new Promise((resolve) => {
            const collector = message.createMessageComponentCollector({
                filter: i => !invokerId || i.user.id === invokerId,
                time: CHALLENGE_ROUND_TIMEOUT
            });

            collector.on('collect', async (i) => {
                if (i.customId === 'captcha_submit') {
                    collector.stop('submit');
                    await i.update({ components: this.buildTileButtons(tileCount, selected, true) }).catch(() => {});
                    resolve(Array.from(selected));
                    return;
                }
                if (i.customId === 'captcha_cancel') {
                    collector.stop('cancel');
                    await i.update({ content: '❌ Anulowano rozwiązywanie captchy.', embeds: [], components: [] }).catch(() => {});
                    resolve(null);
                    return;
                }
                const idx = parseInt(i.customId.replace('captcha_tile_', ''), 10);
                if (selected.has(idx)) {
                    selected.delete(idx);
                } else {
                    selected.add(idx);
                }
                await i.update({ components: this.buildTileButtons(tileCount, selected) }).catch(() => {});
            });

            collector.on('end', (_collected, reason) => {
                if (reason !== 'submit' && reason !== 'cancel') {
                    message.edit({ content: '⏱️ Czas na tę rundę minął.', embeds: [], components: [] }).catch(() => {});
                    resolve(null);
                }
            });
        });
    }

    buildTileButtons(tileCount, selectedSet, disabled = false) {
        const rows = [];
        let currentRow = new ActionRowBuilder();
        for (let i = 0; i < tileCount; i++) {
            if (i > 0 && i % 5 === 0) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
            }
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`captcha_tile_${i}`)
                    .setLabel(`${i + 1}`)
                    .setStyle(selectedSet.has(i) ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(disabled)
            );
        }
        rows.push(currentRow);

        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('captcha_submit').setLabel('✅ Zatwierdź').setStyle(ButtonStyle.Success).setDisabled(disabled),
            new ButtonBuilder().setCustomId('captcha_cancel').setLabel('❌ Anuluj').setStyle(ButtonStyle.Danger).setDisabled(disabled)
        ));

        return rows;
    }
}

module.exports = CaptchaSolverService;
