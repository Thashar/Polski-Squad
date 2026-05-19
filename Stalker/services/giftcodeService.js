const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const { delay } = require('../utils/helpers');

const HABBY_API_BASE = 'https://prod-mail.habbyservice.com/Survivor/api/v1';
const DELAY_BETWEEN_UIDS_MS = 2000;
const MAX_CAPTCHA_ATTEMPTS = 3;

// Set dla O(1) — kody błędów które nie znikną po ponownej próbie z inną captchą
const PERMANENT_ERROR_CODES = new Set([
    20402, // Kod już wykorzystany / limit osiągnięty
    20403, // Kod wygasł
    20404, // Nieprawidłowy kod
    20405, // Gracz nie kwalifikuje się
    20406, // Gracz nie znaleziony
    20407, // Rate limit / zbyt wiele prób
]);

class GiftcodeService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.uidsFile = path.join(__dirname, '../data/habby_uids.json');
        this._debugDirReady = false;
        this.captchaTokens = { input: 0, output: 0, calls: 0 };

        if (config.ocr?.googleAiApiKey) {
            const genAI = new GoogleGenerativeAI(config.ocr.googleAiApiKey);
            this.geminiModel = genAI.getGenerativeModel({
                model: config.ocr.captchaAiModel || 'gemini-2.5-flash-preview-05-20'
            });
        } else {
            this.geminiModel = null;
        }
    }

    // ===== STORAGE =====

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

    // Usuwa pliki debug starsze niż 24h
    async cleanupDebugImages() {
        try {
            const debugDir = path.join(__dirname, '../temp/captcha_debug');
            const files = await fs.readdir(debugDir).catch(() => []);
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const file of files) {
                const fp = path.join(debugDir, file);
                const stat = await fs.stat(fp).catch(() => null);
                if (stat && stat.mtimeMs < cutoff) await fs.unlink(fp).catch(() => {});
            }
        } catch { /* ignoruj */ }
    }

    // ===== HABBY API =====

    async _generateCaptcha() {
        const res = await axios.post(
            `${HABBY_API_BASE}/captcha/generate`,
            {},
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        // API może zwrócić captchaId w res.data.data.captchaId lub res.data.captchaId
        const captchaId = res.data?.data?.captchaId ?? res.data?.captchaId;
        if (!captchaId) throw new Error(`Brak captchaId w odpowiedzi: ${JSON.stringify(res.data)}`);
        return captchaId;
    }

    async _getCaptchaImageBuffer(captchaId) {
        const res = await axios.get(
            `${HABBY_API_BASE}/captcha/image/${captchaId}`,
            { responseType: 'arraybuffer', timeout: 10000 }
        );
        return Buffer.from(res.data);
    }

    async _preprocessCaptcha(imageBuffer) {
        return sharp(imageBuffer)
            .greyscale()
            .normalize()
            .threshold(140)
            .sharpen()
            .resize({ width: 300, kernel: sharp.kernel.nearest })
            .png()
            .toBuffer();
    }

    async _saveCaptchaDebug(original, processed, attempt) {
        try {
            const debugDir = path.join(__dirname, '../temp/captcha_debug');
            if (!this._debugDirReady) {
                await fs.mkdir(debugDir, { recursive: true });
                this._debugDirReady = true;
            }
            const ts = Date.now();
            await Promise.all([
                fs.writeFile(path.join(debugDir, `captcha_${ts}_${attempt}_original.png`), original),
                fs.writeFile(path.join(debugDir, `captcha_${ts}_${attempt}_processed.png`), processed),
            ]);
        } catch { /* nie przerywaj jeśli zapis się nie uda */ }
    }

    async _solveCaptchaWithAI(imageBuffer, attempt) {
        if (!this.geminiModel) {
            throw new Error('Brak klucza Google AI (STALKER_GOOGLE_AI_API_KEY) — captcha nie może być rozwiązana automatycznie');
        }

        const processed = await this._preprocessCaptcha(imageBuffer);
        await this._saveCaptchaDebug(imageBuffer, processed, attempt);

        const result = await this.geminiModel.generateContent([
            { inlineData: { data: processed.toString('base64'), mimeType: 'image/png' } },
            'This image contains a CAPTCHA with exactly 4 digits. Look carefully and read all 4 digits. Reply with ONLY those 4 digits — no letters, no spaces, no punctuation, nothing else.'
        ]);

        const text = result.response.text().trim().replace(/\D/g, '');
        const usage = result.response.usageMetadata;
        if (usage) {
            this.captchaTokens.input += usage.promptTokenCount ?? 0;
            this.captchaTokens.output += usage.candidatesTokenCount ?? 0;
            this.captchaTokens.calls += 1;
        }
        this.logger.info(`[GIFTCODE] Captcha rozwiązana przez AI (próba ${attempt}): "${text}"`);
        return text;
    }

    async _claimCode(userId, giftCode, captchaId, captcha) {
        const res = await axios.post(
            `${HABBY_API_BASE}/giftcode/claim`,
            { userId, giftCode, captchaId, captcha },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        if (res.data?.code !== 0) {
            this.logger.info(`[GIFTCODE] Odpowiedź API: ${JSON.stringify(res.data)}`);
        }
        return res.data;
    }

    _extractMsg(result) {
        return result.msg ?? result.message ?? result.data?.msg ?? result.data?.message ?? null;
    }

    // ===== REDEMPTION =====

    async redeemAll(giftcode, progressCallback) {
        const data = await this.loadData();
        return this.redeemEntries(Object.entries(data.uids), giftcode, progressCallback);
    }

    async redeemEntries(entries, giftcode, progressCallback) {
        if (entries.length === 0) return [];
        this.captchaTokens = { input: 0, output: 0, calls: 0 };
        const results = [];

        for (let i = 0; i < entries.length; i++) {
            const [discordId, userData] = entries[i];
            this.logger.info(`[GIFTCODE] Aktywuję dla ${userData.nick} (UID: ${userData.uid}) [${i + 1}/${entries.length}]`);

            const result = await this._redeemForUid(userData.uid, giftcode, userData.nick);
            results.push({ discordId, uid: userData.uid, nick: userData.nick, ...result });

            if (progressCallback) {
                try { await progressCallback(i + 1, entries.length, results[results.length - 1]); } catch { /* nie blokuj */ }
            }

            if (i < entries.length - 1) await delay(DELAY_BETWEEN_UIDS_MS);
        }

        return results;
    }

    async _redeemForUid(uid, giftCode, nick) {
        for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt++) {
            try {
                const captchaId = await this._generateCaptcha();
                const imageBuffer = await this._getCaptchaImageBuffer(captchaId);
                const captchaSolution = await this._solveCaptchaWithAI(imageBuffer, attempt);

                if (!captchaSolution || captchaSolution.length !== 4) {
                    this.logger.warn(`[GIFTCODE] Próba ${attempt}/${MAX_CAPTCHA_ATTEMPTS}: AI zwróciła "${captchaSolution}" (oczekiwano 4 cyfr) dla ${nick}`);
                    if (attempt < MAX_CAPTCHA_ATTEMPTS) await delay(1000);
                    continue;
                }

                const result = await this._claimCode(uid, giftCode, captchaId, captchaSolution);
                const apiMsg = this._extractMsg(result);

                if (result.code === 0) {
                    return { success: true, retryable: false, message: 'Kod aktywowany pomyślnie' };
                } else if (PERMANENT_ERROR_CODES.has(result.code)) {
                    return { success: false, retryable: false, message: apiMsg ?? `Błąd API (kod: ${result.code})` };
                } else {
                    this.logger.warn(`[GIFTCODE] Próba ${attempt}/${MAX_CAPTCHA_ATTEMPTS}: API zwróciło ${result.code} (${apiMsg}) dla ${nick}`);
                }

            } catch (error) {
                this.logger.error(`[GIFTCODE] Próba ${attempt}/${MAX_CAPTCHA_ATTEMPTS} dla ${nick}: ${error.message}`);
                if (attempt === MAX_CAPTCHA_ATTEMPTS) {
                    return { success: false, retryable: true, message: `Błąd: ${error.message.split('\n')[0]}` };
                }
            }

            if (attempt < MAX_CAPTCHA_ATTEMPTS) await delay(1000);
        }

        return { success: false, retryable: true, message: `Nieudana aktywacja po ${MAX_CAPTCHA_ATTEMPTS} próbach (captcha)` };
    }
}

module.exports = GiftcodeService;
