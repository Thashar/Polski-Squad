const https = require('https');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

const SEPARATOR = '────────────────────────────────────────';
const BOT_EMOJI = '🏆';
const BOT_NAME = 'ENDERSECHO';

function getTimestamp() {
    return new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        month: '2-digit', day: '2-digit',
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
        this._client = null;
        this._channelId = null;

        if (this.webhookUrl) {
            logger.info(`📋 GuildLogger: dedykowany webhook skonfigurowany`);
            this._sendTestMessage();
        } else {
            logger.warn(`⚠️ GuildLogger: brak ENDERSECHO_LOG_WEBHOOK_URL — logi tylko w konsoli`);
        }
    }

    async setClient(discordClient) {
        this._client = discordClient;
        if (!this.webhookUrl) return;
        try {
            const info = await this._fetchWebhookInfo();
            if (info?.channel_id) {
                this._channelId = info.channel_id;
                logger.info(`📋 GuildLogger: kanał webhooka pobrano (ID: ${this._channelId})`);
            } else {
                logger.warn(`⚠️ GuildLogger: nie udało się pobrać channel_id z webhooka`);
            }
        } catch (err) {
            logger.warn(`⚠️ GuildLogger: błąd pobierania info webhooka: ${err.message}`);
        }
    }

    _fetchWebhookInfo() {
        return new Promise((resolve, reject) => {
            const url = new URL(this.webhookUrl);
            const req = https.request(
                { hostname: url.hostname, path: url.pathname, method: 'GET',
                  headers: { 'Content-Type': 'application/json' } },
                res => {
                    let body = '';
                    res.on('data', d => body += d);
                    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
                }
            );
            req.on('error', reject);
            req.end();
        });
    }

    /**
     * Zwraca logger z kontekstem konkretnego serwera.
     * Logi mają tag serwera jako prefix i separator przy zmianie serwera.
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

    /**
     * Wysyła embed przez webhook (np. powiadomienia o serwerze).
     * Zwraca true jeśli webhook jest skonfigurowany, false gdy nie ma gdzie wysłać.
     * @param {Object|import('discord.js').EmbedBuilder} embed
     * @returns {boolean}
     */
    sendEmbed(embed) {
        if (!this.webhookUrl) return false;
        const embedData = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
        if (this._client && this._channelId) {
            this._client.channels.fetch(this._channelId)
                .then(ch => ch?.send({ embeds: [embedData] }))
                .catch(err => logger.warn(`GuildLogger sendEmbed błąd: ${err.message}`));
        } else {
            this._enqueue({ embeds: [embedData] });
        }
        return true;
    }

    _sendTestMessage() {
        const ts = getTimestamp();
        const content = `${SEPARATOR}\n${BOT_EMOJI} **${BOT_NAME}** [${ts}] ✅ GuildLogger online`;
        this._enqueue({ content });
    }

    _log(guildId, message, level) {
        logger[level](message);
        if (!this.webhookUrl) return;

        const guildConfig = this.config.getGuildConfig(guildId);
        const guildTag = guildConfig?.tag || null;
        const guildIcon = guildConfig?.icon || null;
        const isNewGuild = this._lastGuildId !== guildId;
        this._lastGuildId = guildId;

        const levelEmoji = LEVEL_EMOJI[level] || '•';
        const timestamp = getTimestamp();
        // Format jak w konsoli: 🏆 ENDERSECHO [timestamp] • message
        // plus opcjonalny prefix tagu serwera
        const tagPrefix = guildTag ? `${guildTag} ` : '';
        const line = `${tagPrefix}[${timestamp}] ${levelEmoji} ${message}`;
        const content = isNewGuild ? `${SEPARATOR}\n${line}` : line;

        const payload = { content, flags: 4 };
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
            } catch (err) {
                logger.warn(`GuildLogger webhook error: ${err.message}`);
            }
        }
        this._processing = false;
    }

    _sendWebhook(payload) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const url = new URL(this.webhookUrl);
            const req = https.request(
                {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                res => {
                    res.resume();
                    if (res.statusCode === 429) {
                        setTimeout(() => this._sendWebhook(payload).then(resolve).catch(reject), 5000);
                    } else if (res.statusCode >= 400) {
                        logger.warn(`GuildLogger webhook HTTP ${res.statusCode}`);
                        resolve();
                    } else {
                        resolve();
                    }
                }
            );
            req.on('error', (err) => {
                logger.warn(`GuildLogger webhook request error: ${err.message}`);
                reject(err);
            });
            req.write(body);
            req.end();
        });
    }
}

module.exports = GuildLogger;
