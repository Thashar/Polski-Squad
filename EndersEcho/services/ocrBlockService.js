const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

/**
 * Per-guild OCR block service.
 * Stan blokady przechowywany w guild_configs.json przez GuildConfigService.
 * Ten serwis jest cienką warstwą delegującą do GuildConfigService.
 */
class OcrBlockService {
    /**
     * @param {import('./guildConfigService')} guildConfigService
     */
    constructor(guildConfigService) {
        this._guildConfigService = guildConfigService;
    }

    /**
     * Czy komenda jest zablokowana dla danego serwera
     * @param {string} guildId
     * @param {string} command - 'update' | 'test'
     * @returns {boolean}
     */
    isBlocked(guildId, command) {
        return this._guildConfigService.getOcrBlocked(guildId).includes(command);
    }

    /**
     * Zwraca listę zablokowanych komend dla serwera
     * @param {string} guildId
     * @returns {string[]}
     */
    getBlockedCommands(guildId) {
        return this._guildConfigService.getOcrBlocked(guildId);
    }

    /**
     * Blokuje komendy na danym serwerze
     * @param {string} guildId
     * @param {string[]} commands
     */
    async block(guildId, commands) {
        const existing = new Set(this._guildConfigService.getOcrBlocked(guildId));
        for (const cmd of commands) existing.add(cmd);
        await this._guildConfigService.setOcrBlocked(guildId, [...existing]);
        logger.info(`🔒 OCR zablokowano [${commands.join(', ')}] na serwerze ${guildId}`);
    }

    /**
     * Odblokowuje komendy na danym serwerze
     * @param {string} guildId
     * @param {string[]} commands
     */
    async unblock(guildId, commands) {
        const existing = new Set(this._guildConfigService.getOcrBlocked(guildId));
        for (const cmd of commands) existing.delete(cmd);
        await this._guildConfigService.setOcrBlocked(guildId, [...existing]);
        logger.info(`🔓 OCR odblokowano [${commands.join(', ')}] na serwerze ${guildId}`);
    }
}

module.exports = OcrBlockService;
