const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

/* 30 dni od usunięcia bota z serwera — po tym czasie kasowana jest KONFIGURACJA
   serwera (deklaracja w polityce prywatności: https://endersecho.thashar.dev/privacy,
   sekcja "Data retention"). Dane graczy (ranking, historia wyników, osiągnięcia,
   rekordy bossów) NIE są usuwane — należą do użytkowników i tylko oni decydują
   o ich usunięciu (autonomia użytkownika; dane zasilają też profil cross-server). */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000; // kontrola 2x na dobę

class GuildDataRetentionService {
    constructor(dataDir, guildConfigService) {
        this.dataDir = dataDir;
        this.filePath = path.join(dataDir, 'pending_guild_deletions.json');
        this.guildConfigService = guildConfigService;
        this._pending = {};
        this._client = null;
        this._onDeleted = null;
        this._timer = null;
    }

    async load() {
        try {
            this._pending = JSON.parse(await fs.readFile(this.filePath, 'utf8')) || {};
            const count = Object.keys(this._pending).length;
            if (count > 0) logger.info(`🗓️ GuildDataRetention: ${count} serwer(ów) oczekuje na usunięcie danych`);
        } catch {
            this._pending = {};
        }
    }

    async _save() {
        await fs.writeFile(this.filePath, JSON.stringify(this._pending, null, 2), 'utf8');
    }

    /** Wołane z guildDelete — startuje 30-dniowy zegar dla danych serwera. */
    async schedule(guildId, guildName) {
        if (this._pending[guildId]) return;
        /* język zapamiętany teraz, bo przy faktycznym usuwaniu config już nie istnieje */
        const lang = this.guildConfigService.getConfig(guildId)?.lang || 'pol';
        this._pending[guildId] = { guildName, lang, removedAt: new Date().toISOString() };
        await this._save();
        logger.info(`🗓️ Retencja: dane serwera "${guildName}" (${guildId}) zostaną usunięte po 30 dniach`);
    }

    /** Wołane z guildCreate — bot wrócił przed upływem 30 dni, dane zostają. */
    async cancel(guildId) {
        const info = this._pending[guildId];
        if (!info) return false;
        delete this._pending[guildId];
        await this._save();
        logger.info(`🗓️ Retencja: anulowano usunięcie danych serwera "${info.guildName}" (${guildId}) — bot wrócił`);
        return true;
    }

    /**
     * Uruchamia cykliczną kontrolę. onDeleted(guildId, info) — powiadomienie
     * na kanał logów (wysyłane PO udanym usunięciu danych).
     */
    start(client, onDeleted) {
        this._client = client;
        this._onDeleted = onDeleted;
        const run = () => this.sweep().catch(err => logger.error(`Błąd kontroli retencji danych: ${err.message}`));
        run();
        this._timer = setInterval(run, SWEEP_INTERVAL_MS);
        if (this._timer.unref) this._timer.unref();
    }

    async sweep() {
        const now = Date.now();
        for (const [guildId, info] of Object.entries(this._pending)) {
            /* bot znów jest na serwerze (np. wpis osierocony przy downtime) → anuluj */
            if (this._client?.guilds.cache.has(guildId)) {
                await this.cancel(guildId);
                continue;
            }
            if (now - Date.parse(info.removedAt) < RETENTION_MS) continue;
            try {
                await this._deleteGuildData(guildId, info);
            } catch (err) {
                /* wpis zostaje — kolejna próba przy następnym przebiegu */
                logger.error(`Błąd usuwania danych serwera "${info.guildName}" (${guildId}): ${err.message}`);
            }
        }
    }

    /* Usuwana jest WYŁĄCZNIE konfiguracja serwera: wpis w guild_configs.json
       + role_rankings.json (konfiguracja rankingów ról ustawiana przez adminów).
       Dane graczy w data/guilds/{guildId}/ (ranking.json, wyniki/, achievements.json,
       rekordy bossów) zostają — należą do użytkowników. Globalne data/token_usage.json
       również nietykane — statystyki tokenów AI do celów rozliczeniowych
       i statystycznych (sekcja 7 polityki prywatności). */
    async _deleteGuildData(guildId, info) {
        const roleRankingsFile = path.join(this.dataDir, 'guilds', guildId, 'role_rankings.json');
        await fs.rm(roleRankingsFile, { force: true }).catch(err => {
            if (err.code !== 'ENOENT') throw err;
        });
        await this.guildConfigService.deleteConfig(guildId);
        delete this._pending[guildId];
        await this._save();
        logger.warn(`🗑️ Retencja: usunięto konfigurację serwera "${info.guildName}" (${guildId}) — 30 dni od usunięcia bota (dane graczy zostają)`);
        if (this._onDeleted) await this._onDeleted(guildId, info);
    }
}

module.exports = GuildDataRetentionService;
