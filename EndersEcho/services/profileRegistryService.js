'use strict';

const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const { makePlayerKey, getOwnerId, getProfileIndex } = require('../utils/helpers');

const logger = createBotLogger('EndersEcho');

const DEFAULT_MAX_PROFILES = 3;
const MAX_LABEL_LENGTH = 24;

/**
 * Rejestr profili graczy — jeden użytkownik Discorda może mieć kilka profili
 * (gra na kilku kontach w grze), każdy z osobnym wpisem w rankingu.
 *
 * Struktura data/profiles.json:
 * {
 *   "123456789012345678": {
 *     "active": 2,
 *     "profiles": [
 *       { "index": 1, "label": null,      "createdAt": "2026-07-25T..." },
 *       { "index": 2, "label": "Smurf",   "createdAt": "2026-07-25T..." }
 *     ]
 *   }
 * }
 *
 * Profil 1 (główny) istnieje niejawnie dla każdego gracza — nie wymaga wpisu w pliku.
 * Dzięki temu gracze, którzy nigdy nie użyli /profil, działają dokładnie jak przed wdrożeniem.
 *
 * Numery profili to STABILNE SLOTY — po usunięciu profilu numery nie są przenumerowywane
 * (inaczej rozjechałyby się subskrypcje, dane rankingowe i customId komponentów).
 */
class ProfileRegistryService {
    constructor(dataDir, maxProfiles = DEFAULT_MAX_PROFILES) {
        this._filePath = path.join(dataDir, 'profiles.json');
        this._data = {};
        this._maxProfiles = maxProfiles;
        this._queue = Promise.resolve();
    }

    async load() {
        try {
            const raw = await fs.readFile(this._filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this._data = (parsed && typeof parsed === 'object') ? parsed : {};
            const withAlts = Object.values(this._data).filter(u => (u.profiles || []).length > 1).length;
            if (withAlts > 0) logger.info(`👥 ProfileRegistry: ${withAlts} graczy z profilami dodatkowymi`);
        } catch {
            this._data = {};
        }
    }

    async _save() {
        // Kolejka zapisu — eliminuje race condition przy równoczesnych operacjach na profilach
        const run = async () => {
            await fs.mkdir(path.dirname(this._filePath), { recursive: true });
            await fs.writeFile(this._filePath, JSON.stringify(this._data, null, 2), 'utf8');
        };
        this._queue = this._queue.then(run, run);
        return this._queue;
    }

    getMaxProfiles() {
        return this._maxProfiles;
    }

    setMaxProfiles(max) {
        this._maxProfiles = Math.max(1, Number(max) || DEFAULT_MAX_PROFILES);
    }

    /**
     * Lista profili gracza. Zawsze zawiera profil główny (nawet gdy brak wpisu w pliku).
     * @param {string} userId
     * @returns {Array<{ index: number, label: string|null, createdAt: string|null, playerKey: string, isMain: boolean }>}
     */
    getProfiles(userId) {
        const entry = this._data[userId];
        const stored = Array.isArray(entry?.profiles) ? entry.profiles : [];
        const hasMain = stored.some(p => Number(p.index) === 1);
        const list = hasMain ? [...stored] : [{ index: 1, label: null, createdAt: null }, ...stored];
        return list
            .map(p => ({
                index: Number(p.index),
                label: p.label || null,
                createdAt: p.createdAt || null,
                playerKey: makePlayerKey(userId, p.index),
                isMain: Number(p.index) === 1,
            }))
            .sort((a, b) => a.index - b.index);
    }

    /**
     * Czy gracz ma jakikolwiek profil dodatkowy (decyduje o pokazywaniu UI profili).
     */
    hasMultipleProfiles(userId) {
        return this.getProfiles(userId).length > 1;
    }

    /**
     * Czy dany profil istnieje dla gracza.
     */
    hasProfile(userId, profileIndex) {
        return this.getProfiles(userId).some(p => p.index === Number(profileIndex));
    }

    /**
     * Numer aktywnego profilu gracza (na który trafiają wyniki z /update).
     * Gdy aktywny profil został usunięty — fallback na główny.
     */
    getActiveIndex(userId) {
        const active = Number(this._data[userId]?.active) || 1;
        return this.hasProfile(userId, active) ? active : 1;
    }

    /**
     * playerKey aktywnego profilu — klucz, pod którym zapisywane są wyniki.
     */
    getActivePlayerKey(userId) {
        return makePlayerKey(userId, this.getActiveIndex(userId));
    }

    /**
     * Etykieta profilu (nick w grze) — pokazywana w /profile i embedach, nie w rankingu.
     * @returns {string|null}
     */
    getLabel(userId, profileIndex) {
        const idx = Number(profileIndex) || 1;
        return this.getProfiles(userId).find(p => p.index === idx)?.label || null;
    }

    /**
     * Etykieta dla playerKey (wygodne przy danych rankingowych).
     */
    getLabelForKey(playerKey) {
        return this.getLabel(getOwnerId(playerKey), getProfileIndex(playerKey));
    }

    /**
     * Ustawia aktywny profil.
     * @returns {Promise<boolean>} false gdy profil nie istnieje
     */
    async setActive(userId, profileIndex) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return false;
        if (!this._data[userId]) {
            this._data[userId] = { active: idx, profiles: this.getProfiles(userId).map(p => ({ index: p.index, label: p.label, createdAt: p.createdAt })) };
        } else {
            this._data[userId].active = idx;
        }
        await this._save();
        return true;
    }

    /**
     * Nazwa gracza do logów — nick z Discorda, gdy wywołujący go zna;
     * w ostateczności wzmianka (`<@id>`), żeby w logach nie lądowało samo ID.
     * @param {string} userId
     * @param {string|null} logName
     * @returns {string}
     */
    _logName(userId, logName = null) {
        return logName ? `${logName} (<@${userId}>)` : `<@${userId}>`;
    }

    /**
     * Dodaje nowy profil w pierwszym wolnym slocie.
     * @returns {Promise<{ ok: boolean, reason?: string, index?: number, playerKey?: string }>}
     */
    async addProfile(userId, label = null, logName = null) {
        const existing = this.getProfiles(userId);
        if (existing.length >= this._maxProfiles) {
            return { ok: false, reason: 'LIMIT', limit: this._maxProfiles };
        }

        const cleanLabel = this._sanitizeLabel(label);
        if (cleanLabel && existing.some(p => (p.label || '').toLowerCase() === cleanLabel.toLowerCase())) {
            return { ok: false, reason: 'DUPLICATE_LABEL' };
        }

        // Pierwszy wolny slot (nie maksimum+1 — sloty po usuniętych profilach są odzyskiwane)
        const used = new Set(existing.map(p => p.index));
        let index = 1;
        while (used.has(index)) index++;

        if (!this._data[userId]) {
            this._data[userId] = {
                active: 1,
                profiles: existing.map(p => ({ index: p.index, label: p.label, createdAt: p.createdAt })),
            };
        }
        this._data[userId].profiles.push({
            index,
            label: cleanLabel,
            createdAt: new Date().toISOString(),
        });
        await this._save();
        logger.info(`👥 Nowy profil #${index}${cleanLabel ? ` ("${cleanLabel}")` : ''} — gracz ${this._logName(userId, logName)}`);
        return { ok: true, index, playerKey: makePlayerKey(userId, index) };
    }

    /**
     * Usuwa profil z rejestru (dane rankingowe czyści wywołujący).
     * Profilu głównego nie można usunąć.
     * @returns {Promise<{ ok: boolean, reason?: string }>}
     */
    async removeProfile(userId, profileIndex, logName = null) {
        const idx = Number(profileIndex) || 1;
        if (idx === 1) return { ok: false, reason: 'MAIN_PROFILE' };
        if (!this.hasProfile(userId, idx)) return { ok: false, reason: 'NOT_FOUND' };

        const entry = this._data[userId];
        if (!entry) return { ok: false, reason: 'NOT_FOUND' };
        entry.profiles = (entry.profiles || []).filter(p => Number(p.index) !== idx);
        if (Number(entry.active) === idx) entry.active = 1;
        // Gdy zostaje tylko profil główny bez etykiety — usuń wpis, wracamy do stanu domyślnego
        if (entry.profiles.length === 0 || (entry.profiles.length === 1 && Number(entry.profiles[0].index) === 1 && !entry.profiles[0].label)) {
            delete this._data[userId];
        }
        await this._save();
        logger.info(`👥 Usunięto profil #${idx} — gracz ${this._logName(userId, logName)}`);
        return { ok: true };
    }

    /**
     * Zmienia etykietę profilu.
     * @returns {Promise<{ ok: boolean, reason?: string, label?: string|null }>}
     */
    async setLabel(userId, profileIndex, label) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return { ok: false, reason: 'NOT_FOUND' };

        const cleanLabel = this._sanitizeLabel(label);
        const others = this.getProfiles(userId).filter(p => p.index !== idx);
        if (cleanLabel && others.some(p => (p.label || '').toLowerCase() === cleanLabel.toLowerCase())) {
            return { ok: false, reason: 'DUPLICATE_LABEL' };
        }

        if (!this._data[userId]) {
            this._data[userId] = {
                active: 1,
                profiles: this.getProfiles(userId).map(p => ({ index: p.index, label: p.label, createdAt: p.createdAt })),
            };
        }
        const target = this._data[userId].profiles.find(p => Number(p.index) === idx);
        if (target) {
            target.label = cleanLabel;
        } else {
            this._data[userId].profiles.push({ index: idx, label: cleanLabel, createdAt: new Date().toISOString() });
        }
        await this._save();
        return { ok: true, label: cleanLabel };
    }

    /**
     * Etykieta bez znaków łamiących wyświetlanie (markdown, wzmianki, znaki kontrolne).
     */
    _sanitizeLabel(label) {
        if (!label) return null;
        const clean = String(label)
            .replace(/[`*_~|<>@#:\\]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_LABEL_LENGTH);
        return clean.length > 0 ? clean : null;
    }

    /**
     * Statystyki do Centrum Dowodzenia.
     * @returns {{ usersWithAlts: number, totalAltProfiles: number }}
     */
    getStats() {
        let usersWithAlts = 0;
        let totalAltProfiles = 0;
        for (const userId of Object.keys(this._data)) {
            const alts = this.getProfiles(userId).filter(p => !p.isMain).length;
            if (alts > 0) {
                usersWithAlts++;
                totalAltProfiles += alts;
            }
        }
        return { usersWithAlts, totalAltProfiles };
    }

    /**
     * Wszystkie playerKey wszystkich zarejestrowanych profili dodatkowych
     * (np. do audytu spójności danych rankingowych).
     */
    getAllAltPlayerKeys() {
        const keys = [];
        for (const userId of Object.keys(this._data)) {
            for (const p of this.getProfiles(userId)) {
                if (!p.isMain) keys.push(p.playerKey);
            }
        }
        return keys;
    }
}

module.exports = ProfileRegistryService;
module.exports.DEFAULT_MAX_PROFILES = DEFAULT_MAX_PROFILES;
module.exports.MAX_LABEL_LENGTH = MAX_LABEL_LENGTH;
