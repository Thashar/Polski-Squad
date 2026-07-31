'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { formatProfileDisplayName, getProfileIndex } = require('../utils/helpers');

/**
 * Wysyłka rankingów TOP 10 na stronę (endersecho.thashar.dev).
 *
 * Kierunek jest jeden: bot → strona. Strona nigdy nie odpytuje bota, więc serwer
 * produkcyjny zostaje zamknięty na świat, a ranking działa nawet gdy bot leży
 * (Worker oddaje ostatni zapisany snapshot).
 *
 * Co jedzie na stronę: nazwa serwera, tag, pozycja, nick gracza, wynik, boss i data.
 * ŚWIADOMIE NIE wysyłamy ID Discorda ani avatarów — nick w zupełności wystarcza
 * do rankingu, a ID jest identyfikatorem, który dałoby się połączyć z kontem.
 *
 * Kiedy wysyłamy:
 *   • przy starcie bota — pełny snapshot wszystkich serwerów (`syncAll`),
 *   • po każdym zapisanym wyniku — tylko ten serwer i tylko gdy TOP 10 faktycznie
 *     się zmienił (`syncGuild`, porównanie po skrócie SHA-1 listy).
 * Dzięki temu zwykłe `/update`, które nie rusza czołówki, nie generuje ruchu.
 *
 * Persystencja skrótów: `data/web_sync.json` — po restarcie bot nie wysyła
 * wszystkiego ponownie tylko dlatego, że zapomniał, co już wysłał.
 */
class WebRankingSyncService {
    /**
     * @param {Object} config - config bota (getAllGuilds, ranking.dataDir)
     * @param {Object} logger
     * @param {Object} deps - { rankingService, guildConfigService }
     */
    constructor(config, logger, deps = {}) {
        this.config = config;
        this.logger = logger;
        this.rankingService = deps.rankingService || null;
        this.guildConfigService = deps.guildConfigService || null;

        this.url = process.env.ENDERSECHO_WEB_SYNC_URL || null;
        this.token = process.env.ENDERSECHO_WEB_SYNC_TOKEN || null;
        this.topCount = parseInt(process.env.ENDERSECHO_WEB_SYNC_TOP || '10', 10) || 10;

        this.stateFile = path.join(config.ranking?.dataDir || path.join(__dirname, '../data'), 'web_sync.json');
        this._hashes = {};          // guildId → skrót ostatnio wysłanego TOP 10
        this._lastSync = null;      // { at, kind: 'full'|'guild', count, guildName } — do Centrum Dowodzenia
        this._queue = Promise.resolve(); // serializacja zapisów pliku stanu
    }

    /** Czy wysyłka jest w ogóle skonfigurowana (brak zmiennych = funkcja wyłączona). */
    isEnabled() {
        return !!(this.url && this.token && this.rankingService);
    }

    async load() {
        try {
            const raw = await fs.readFile(this.stateFile, 'utf8');
            const data = JSON.parse(raw);
            this._hashes = data?.hashes || {};
            this._lastSync = data?.lastSync || null;
        } catch {
            this._hashes = {};
            this._lastSync = null;
        }
    }

    async _saveState() {
        this._queue = this._queue.then(async () => {
            try {
                await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
                await fs.writeFile(this.stateFile, JSON.stringify({ hashes: this._hashes, lastSync: this._lastSync }, null, 2), 'utf8');
            } catch (err) {
                this.logger.warn(`⚠️ Nie udało się zapisać stanu wysyłki rankingów: ${err.message}`);
            }
        }).catch(() => {});
        return this._queue;
    }

    /**
     * Buduje TOP N jednego serwera w formacie, który rozumie strona.
     * @returns {Promise<Object|null>} null gdy serwer nie ma jeszcze żadnego wyniku
     */
    async buildGuildPayload(guildId, client) {
        const players = await this.rankingService.getSortedPlayers(guildId);
        if (!players.length) return null;

        const guild = client?.guilds?.cache?.get(guildId) || null;
        const cfg = this.config.getAllGuilds().find(g => g.id === guildId) || null;
        const guildName = guild?.name
            || this.guildConfigService?.getConfig(guildId)?.guildName
            || guildId;

        const top = players.slice(0, this.topCount).map((p, idx) => ({
            rank: idx + 1,
            name: formatProfileDisplayName(p.username || 'Unknown', p.profileIndex || getProfileIndex(p.playerKey)),
            score: p.score || this.rankingService.formatScore(p.scoreValue),
            // Wartość liczbowa — strona rysuje z niej wykres porównania wyników
            // (proporcja paska do lidera), tak jak generatePlayersProgressChart w bocie.
            scoreValue: typeof p.scoreValue === 'number' ? p.scoreValue : null,
            bossName: p.bossName || null,
            date: p.timestamp || null,
        }));

        return {
            id: guildId,
            name: guildName,
            tag: cfg?.tag || null,
            // Moment dołączenia bota do serwera — strona układa po nim kafelki
            // (kolejność dołączania, tak jak dawna statyczna lista w HTML-u).
            joinedAt: guild?.joinedAt ? guild.joinedAt.toISOString() : null,
            totalPlayers: this.rankingService.countPeople(players),
            top,
        };
    }

    /**
     * Informacja o ostatniej wysyłce — pokazywana w Centrum Dowodzenia.
     * @returns {{ enabled: boolean, lastSync: Object|null, guildsTracked: number }}
     */
    getStatus() {
        return {
            enabled: this.isEnabled(),
            lastSync: this._lastSync,
            guildsTracked: Object.keys(this._hashes).length,
        };
    }

    /** Skrót TOP 10 — porównanie decyduje, czy w ogóle wysyłać. */
    _hashTop(payload) {
        const material = JSON.stringify(payload.top.map(p => [p.rank, p.name, p.score, p.bossName]));
        return crypto.createHash('sha1').update(material).digest('hex');
    }

    async _post(body) {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
        }
        return res;
    }

    /**
     * Pełny snapshot wszystkich skonfigurowanych serwerów, na których bot jest obecny.
     * Wołane przy starcie bota — strona dostaje komplet, nawet jeśli coś umknęło
     * przy poprzednim uruchomieniu.
     */
    async syncAll(client) {
        if (!this.isEnabled()) return;
        try {
            const ids = (this.guildConfigService?.getAllConfiguredGuildIds() || [])
                .filter(id => client.guilds.cache.has(id));
            const guilds = [];
            for (const id of ids) {
                const payload = await this.buildGuildPayload(id, client);
                if (payload) guilds.push(payload);
            }
            if (!guilds.length) return;

            await this._post({ guilds, replaceAll: true });
            for (const g of guilds) this._hashes[g.id] = this._hashTop(g);
            this._lastSync = { at: new Date().toISOString(), kind: 'full', count: guilds.length, guildName: null };
            await this._saveState();
            this.logger.info(`🌐 Wysłano rankingi na stronę: ${guilds.length} serwer(ów)`);
        } catch (err) {
            this.logger.warn(`⚠️ Błąd wysyłki rankingów na stronę: ${err.message}`);
        }
    }

    /**
     * Wysyła TOP 10 jednego serwera, ale tylko gdy czołówka faktycznie się zmieniła.
     * Wołane po każdym zapisanym wyniku (fire-and-forget).
     * @returns {Promise<boolean>} czy wysłano
     */
    async syncGuild(guildId, client) {
        if (!this.isEnabled() || !guildId) return false;
        try {
            const payload = await this.buildGuildPayload(guildId, client);
            if (!payload) return false;

            const hash = this._hashTop(payload);
            if (this._hashes[guildId] === hash) return false; // TOP 10 bez zmian — nic nie wysyłamy

            await this._post({ guilds: [payload] });
            this._hashes[guildId] = hash;
            this._lastSync = { at: new Date().toISOString(), kind: 'guild', count: 1, guildName: payload.name };
            await this._saveState();
            this.logger.info(`🌐 Zaktualizowano ranking serwera "${payload.name}" na stronie`);
            return true;
        } catch (err) {
            this.logger.warn(`⚠️ Błąd wysyłki rankingu serwera na stronę: ${err.message}`);
            return false;
        }
    }
}

module.exports = WebRankingSyncService;
