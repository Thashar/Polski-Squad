const https = require('https');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

const SEPARATOR = '────────────────────────────────────────────────────────────────────────────────';

function getTimestamp() {
    return new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
}

const LEVEL_EMOJI = { error: '❌', warn: '⚠️', success: '✅', info: '•' };

class GuildLogger {
    constructor(config) {
        this.config = config;
        this.webhookUrl = config.logWebhookUrl;
        this._lastGuildId = null;
        this._queue = [];
        this._processing = false;
    }

    /**
     * Zwraca logger z kontekstem konkretnego serwera.
     * Logi mają avatar i nazwę serwera; separator pojawia się przy zmianie serwera.
     * @param {string} guildId
     */
    forGuild(guildId) {
        return {
            info:    (msg) => this._log(guildId, msg, 'info'),
            error:   (msg) => this._log(guildId, msg, 'error'),
            warn:    (msg) => this._log(guildId, msg, 'warn'),
            success: (msg) => this._log(guildId, msg, 'success'),
        };
    }

    _log(guildId, message, level) {
        logger[level](message);
        if (!this.webhookUrl) return;

        const guildConfig = this.config.getGuildConfig(guildId);
        const guildName = guildConfig?.tag || guildId;
        const guildIcon = guildConfig?.icon || null;
        const isNewGuild = this._lastGuildId !== guildId;
        this._lastGuildId = guildId;

        const levelEmoji = LEVEL_EMOJI[level] || '•';
        const timestamp = getTimestamp();
        const content = isNewGuild
            ? `${SEPARATOR}\n[${timestamp}] ${levelEmoji} ${message}`
            : `[${timestamp}] ${levelEmoji} ${message}`;

        const payload = { content, username: guildName };
        if (guildIcon) payload.avatar_url = guildIcon;

        this._enqueue(payload);
    }

    _enqueue(payload) {
        this._queue.push(payload);
        setImmediate(() => this._processQueue());
    }

    async _processQueue() {
        if (this._processing || this._queue.length === 0) return;
        this._processing = true;
        while (this._queue.length > 0) {
            const payload = this._queue.shift();
            try {
                await this._sendWebhook(payload);
                await new Promise(r => setTimeout(r, 1000));
            } catch { /* nie przerywaj przy błędach sieciowych */ }
        }
        this._processing = false;
    }

    _sendWebhook(payload) {
        return new Promise((resolve) => {
            const body = JSON.stringify(payload);
            const url = new URL(this.webhookUrl);
            const req = https.request(
                {
                    hostname: url.hostname,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                res => {
                    if (res.statusCode === 429) {
                        setTimeout(() => this._sendWebhook(payload).then(resolve), 5000);
                    } else {
                        resolve();
                    }
                    res.resume();
                }
            );
            req.on('error', resolve);
            req.write(body);
            req.end();
        });
    }
}

module.exports = GuildLogger;
