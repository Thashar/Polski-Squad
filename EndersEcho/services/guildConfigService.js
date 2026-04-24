const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class GuildConfigService {
    /**
     * @param {string} dataDir - ścieżka do folderu data/ bota
     */
    constructor(dataDir) {
        this._dataDir = dataDir;
        this._filePath = path.join(dataDir, 'guild_configs.json');
        this._legacyOcrBlockPath = path.join(dataDir, 'ocr_blocked.json');
        this._guilds = new Map(); // guildId -> config object
        this._writeQueue = Promise.resolve();
    }

    /**
     * Wczytuje guild_configs.json, importuje serwery z .env (jeśli ich brak),
     * migruje stary ocr_blocked.json.
     * @param {Array} envGuilds - tablica serwerów z config.guilds (.env)
     */
    async load(envGuilds = []) {
        await fsAsync.mkdir(this._dataDir, { recursive: true });

        // Wczytaj istniejący plik
        let raw = { guilds: {} };
        try {
            const data = await fsAsync.readFile(this._filePath, 'utf8');
            raw = JSON.parse(data);
            if (!raw.guilds) raw.guilds = {};
        } catch {
            // plik nie istnieje — zaczniemy od zera
        }

        // Załaduj do Map
        for (const [guildId, cfg] of Object.entries(raw.guilds)) {
            this._guilds.set(guildId, cfg);
        }

        // Migracja globalnego ocr_blocked.json
        let legacyBlockedCommands = [];
        try {
            const legacyData = fs.readFileSync(this._legacyOcrBlockPath, 'utf8');
            const legacyParsed = JSON.parse(legacyData);
            if ('blocked' in legacyParsed && !('blockedCommands' in legacyParsed)) {
                legacyBlockedCommands = legacyParsed.blocked ? ['update', 'test'] : [];
            } else {
                legacyBlockedCommands = legacyParsed.blockedCommands || [];
            }
            if (legacyBlockedCommands.length > 0) {
                logger.info(`🔄 Migruję ocr_blocked.json: [${legacyBlockedCommands.join(', ')}]`);
            }
        } catch {
            // brak pliku lub błąd — OK
        }

        // Import serwerów z .env
        let didImport = false;
        for (const envGuild of envGuilds) {
            if (!this._guilds.has(envGuild.id)) {
                const entry = {
                    configured: true,
                    allowedChannelId: envGuild.allowedChannelId,
                    invalidReportChannelId: null,
                    lang: envGuild.lang || 'pol',
                    tag: envGuild.tag || null,
                    icon: envGuild.icon || null,
                    topRoles: envGuild.topRoles || null,
                    globalTop3Notifications: true,
                    ocrBlocked: legacyBlockedCommands.length > 0 ? [...legacyBlockedCommands] : [],
                    importedFromEnv: true,
                };
                this._guilds.set(envGuild.id, entry);
                logger.info(`📥 Zaimportowano serwer ${envGuild.id} z .env do guild_configs.json`);
                didImport = true;
            }
        }

        if (didImport) {
            await this._persist();
        }

        const configuredCount = [...this._guilds.values()].filter(g => g.configured).length;
        logger.info(`📋 GuildConfigService: ${this._guilds.size} serwer(ów) w JSON (${configuredCount} skonfigurowanych)`);
    }

    /**
     * Czy serwer jest skonfigurowany (przeszedł /configure)
     * @param {string} guildId
     * @returns {boolean}
     */
    isConfigured(guildId) {
        return this._guilds.get(guildId)?.configured === true;
    }

    /**
     * Pobiera konfigurację serwera z JSON lub null
     * @param {string} guildId
     * @returns {Object|null}
     */
    getConfig(guildId) {
        return this._guilds.get(guildId) || null;
    }

    /**
     * Zwraca listę ID wszystkich skonfigurowanych serwerów
     * @returns {string[]}
     */
    getAllConfiguredGuildIds() {
        return [...this._guilds.entries()]
            .filter(([, cfg]) => cfg.configured)
            .map(([id]) => id);
    }

    /**
     * Zwraca pełną listę skonfigurowanych serwerów jako obiekty
     * (format kompatybilny z config.guilds)
     * @returns {Array}
     */
    getAllConfiguredGuilds() {
        return [...this._guilds.entries()]
            .filter(([, cfg]) => cfg.configured)
            .map(([id, cfg]) => ({
                id,
                allowedChannelId: cfg.allowedChannelId,
                invalidReportChannelId: cfg.invalidReportChannelId || null,
                lang: cfg.lang || 'eng',
                tag: cfg.tag || null,
                icon: cfg.icon || null,
                topRoles: cfg.topRoles || null,
                globalTop3Notifications: cfg.globalTop3Notifications !== false,
            }));
    }

    /**
     * Zapisuje konfigurację serwera (merge z istniejącą)
     * @param {string} guildId
     * @param {Object} data
     */
    async saveConfig(guildId, data) {
        const existing = this._guilds.get(guildId) || {};
        this._guilds.set(guildId, { ...existing, ...data });
        await this._persist();
    }

    /**
     * Zwraca listę zablokowanych komend OCR dla serwera
     * @param {string} guildId
     * @returns {string[]}
     */
    getOcrBlocked(guildId) {
        return [...(this._guilds.get(guildId)?.ocrBlocked || [])];
    }

    /**
     * Ustawia zablokowane komendy OCR dla serwera
     * @param {string} guildId
     * @param {string[]} commands
     */
    async setOcrBlocked(guildId, commands) {
        const existing = this._guilds.get(guildId) || {};
        this._guilds.set(guildId, { ...existing, ocrBlocked: commands });
        await this._persist();
    }

    /**
     * Persystuje stan do pliku JSON (serialized writes)
     */
    async _persist() {
        this._writeQueue = this._writeQueue.then(async () => {
            try {
                const out = { guilds: {} };
                for (const [id, cfg] of this._guilds) {
                    out.guilds[id] = cfg;
                }
                await fsAsync.writeFile(this._filePath, JSON.stringify(out, null, 2), 'utf8');
            } catch (err) {
                logger.error('Błąd zapisu guild_configs.json:', err.message);
            }
        });
        return this._writeQueue;
    }
}

module.exports = GuildConfigService;
