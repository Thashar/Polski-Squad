const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

class GuildBanService {
    constructor(dataDir) {
        this.filePath = path.join(dataDir, 'banned_guilds.json');
        this._banned = {};
    }

    async load() {
        try {
            const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
            this._banned = data || {};
            const count = Object.keys(this._banned).length;
            if (count > 0) logger.info(`🚫 GuildBanService: załadowano ${count} zbanowanych serwer(ów)`);
        } catch {
            this._banned = {};
        }
    }

    async _save() {
        await fs.writeFile(this.filePath, JSON.stringify(this._banned, null, 2), 'utf8');
    }

    isBanned(guildId) {
        return !!this._banned[guildId];
    }

    getBannedGuilds() {
        return Object.entries(this._banned).map(([guildId, info]) => ({
            guildId,
            guildName: info.guildName || guildId,
            bannedAt: info.bannedAt,
            bannedBy: info.bannedBy,
        }));
    }

    async banGuild(guildId, guildName, bannedBy) {
        this._banned[guildId] = {
            guildName,
            bannedAt: new Date().toISOString(),
            bannedBy,
        };
        await this._save();
        logger.warn(`🚫 Zbanowano serwer "${guildName}" (${guildId}) przez ${bannedBy}`);
    }

    async unbanGuild(guildId) {
        const info = this._banned[guildId];
        if (!info) return;
        delete this._banned[guildId];
        await this._save();
        logger.info(`✅ Odbanowano serwer "${info.guildName || guildId}" (${guildId})`);
    }
}

module.exports = GuildBanService;
