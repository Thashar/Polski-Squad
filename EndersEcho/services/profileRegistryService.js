'use strict';

const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const { makePlayerKey, getOwnerId, getProfileIndex } = require('../utils/helpers');

const logger = createBotLogger('EndersEcho');

const DEFAULT_MAX_PROFILES = 3;
const MAX_LABEL_LENGTH = 24;

// Usunięcie profilu jest odroczone — gracz ma tydzień na wycofanie decyzji
const DELETION_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
// Jak często sprawdzamy, czy któryś profil doczekał terminu skasowania
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Rejestr profili graczy — jeden użytkownik Discorda może mieć kilka profili
 * (gra na kilku kontach w grze), każdy z osobnym wpisem w rankingu.
 *
 * Struktura data/profiles.json:
 * {
 *   "123456789012345678": {
 *     "active": 2,
 *     "profiles": [
 *       { "index": 1, "label": null,    "createdAt": "2026-07-25T...", "pendingDeleteAt": "2026-08-02T..." },
 *       { "index": 2, "label": "Smurf", "createdAt": "2026-07-25T..." }
 *     ]
 *   }
 * }
 *
 * Profil slotu 1 istnieje niejawnie dla każdego gracza, DOPÓKI gracz nie ma wpisu
 * w pliku — dzięki temu gracze, którzy nigdy nie tknęli profili, działają jak przed
 * wdrożeniem. Gdy wpis istnieje, lista `profiles` jest jedynym źródłem prawdy (slot 1
 * może zostać usunięty, jeśli mainem jest inny profil).
 *
 * Po usunięciu profilu pozostałe są PRZENUMEROWYWANE w dół (usunięcie 1 → 2 staje się 1,
 * 3 staje się 2), żeby gracz nie oglądał dziur w numeracji. Numer slotu jest częścią
 * `playerKey`, więc `removeProfile` zwraca listę przesunięć, a wywołujący (handler)
 * przenosi wszystkie dane profilu na nowe klucze.
 *
 * MAIN (pole `active`) to profil wskazany pinezką 📌 — jego dane pokazują /ranking,
 * /profile i /achievements, jego wynik jest podpowiadany przy /update. Maina NIE MOŻNA
 * usunąć; najpierw trzeba wskazać mainem inny profil.
 */
class ProfileRegistryService {
    constructor(dataDir, maxProfiles = DEFAULT_MAX_PROFILES) {
        this._filePath = path.join(dataDir, 'profiles.json');
        this._data = {};
        this._maxProfiles = maxProfiles;
        this._queue = Promise.resolve();
        this._timer = null;
        this._onDue = null;
    }

    async load() {
        try {
            const raw = await fs.readFile(this._filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this._data = (parsed && typeof parsed === 'object') ? parsed : {};
            const withAlts = Object.values(this._data).filter(u => (u.profiles || []).length > 1).length;
            if (withAlts > 0) logger.info(`👥 ProfileRegistry: ${withAlts} graczy z profilami dodatkowymi`);
            const pending = this.getPendingDeletions().length;
            if (pending > 0) logger.info(`👥 ProfileRegistry: ${pending} profil(i) oczekuje na usunięcie`);
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

    getDeletionDelayMs() {
        return DELETION_DELAY_MS;
    }

    /**
     * Surowa lista slotów gracza — bez wyliczania maina (używane wewnętrznie,
     * żeby getMainIndex/getProfiles nie zapętliły się nawzajem).
     */
    _rawProfiles(userId) {
        const stored = Array.isArray(this._data[userId]?.profiles) ? this._data[userId].profiles : [];
        const list = stored.length > 0
            ? stored
            : [{ index: 1, label: null, createdAt: null }];
        return list
            .map(p => ({
                index: Number(p.index),
                label: p.label || null,
                createdAt: p.createdAt || null,
                pendingDeleteAt: p.pendingDeleteAt || null,
            }))
            .sort((a, b) => a.index - b.index);
    }

    /**
     * Lista profili gracza. Dla gracza bez wpisu w pliku = jeden profil w slocie 1.
     * @param {string} userId
     * @returns {Array<{ index: number, label: string|null, createdAt: string|null, pendingDeleteAt: string|null, playerKey: string, isMain: boolean }>}
     */
    getProfiles(userId) {
        const mainIndex = this.getMainIndex(userId);
        return this._rawProfiles(userId).map(p => ({
            ...p,
            playerKey: makePlayerKey(userId, p.index),
            isMain: p.index === mainIndex,
        }));
    }

    /**
     * Czy gracz ma jakikolwiek profil dodatkowy (decyduje o pokazywaniu UI profili).
     */
    hasMultipleProfiles(userId) {
        return this._rawProfiles(userId).length > 1;
    }

    /**
     * Czy dany profil istnieje dla gracza.
     */
    hasProfile(userId, profileIndex) {
        return this._rawProfiles(userId).some(p => p.index === Number(profileIndex));
    }

    /**
     * Numer profilu MAIN (pinezka 📌) — to na niego trafiają wyniki z /update i to jego
     * statystyki pokazują widoki personalne. Gdy zapisany main nie istnieje (dane sprzed
     * usunięcia slotu), fallback na pierwszy istniejący slot.
     */
    getMainIndex(userId) {
        const list = this._rawProfiles(userId);
        const stored = Number(this._data[userId]?.active) || 1;
        return list.some(p => p.index === stored) ? stored : (list[0]?.index || 1);
    }

    /**
     * playerKey profilu MAIN — klucz, pod którym zapisywane są wyniki.
     */
    getMainPlayerKey(userId) {
        return makePlayerKey(userId, this.getMainIndex(userId));
    }

    /**
     * Etykieta profilu (nick w grze) — pokazywana w /profile i embedach, nie w rankingu.
     * @returns {string|null}
     */
    getLabel(userId, profileIndex) {
        const idx = Number(profileIndex) || 1;
        return this._rawProfiles(userId).find(p => p.index === idx)?.label || null;
    }

    /**
     * Etykieta dla playerKey (wygodne przy danych rankingowych).
     */
    getLabelForKey(playerKey) {
        return this.getLabel(getOwnerId(playerKey), getProfileIndex(playerKey));
    }

    /**
     * Materializuje wpis gracza w pliku (dla graczy działających dotąd na domyślnym slocie 1).
     */
    _ensureEntry(userId) {
        if (!this._data[userId]) {
            this._data[userId] = {
                active: 1,
                profiles: this._rawProfiles(userId).map(p => ({
                    index: p.index,
                    label: p.label,
                    createdAt: p.createdAt,
                    ...(p.pendingDeleteAt ? { pendingDeleteAt: p.pendingDeleteAt } : {}),
                })),
            };
        }
        return this._data[userId];
    }

    /**
     * Ustawia profil MAIN (pinezka). Profil zaplanowany do usunięcia automatycznie
     * odzyskuje ważność — main nie może czekać na skasowanie.
     * @returns {Promise<boolean>} false gdy profil nie istnieje
     */
    async setMain(userId, profileIndex) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return false;
        const entry = this._ensureEntry(userId);
        entry.active = idx;
        const target = entry.profiles.find(p => Number(p.index) === idx);
        if (target?.pendingDeleteAt) delete target.pendingDeleteAt;
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
        const existing = this._rawProfiles(userId);
        if (existing.length >= this._maxProfiles) {
            return { ok: false, reason: 'LIMIT', limit: this._maxProfiles };
        }

        const cleanLabel = this._sanitizeLabel(label);
        if (cleanLabel && existing.some(p => (p.label || '').toLowerCase() === cleanLabel.toLowerCase())) {
            return { ok: false, reason: 'DUPLICATE_LABEL' };
        }

        // Pierwszy wolny slot — po przenumerowaniu jest to zwykle koniec listy,
        // ale wyliczamy go uczciwie (dane sprzed wdrożenia mogą mieć dziury)
        const used = new Set(existing.map(p => p.index));
        let index = 1;
        while (used.has(index)) index++;

        const entry = this._ensureEntry(userId);
        entry.profiles.push({
            index,
            label: cleanLabel,
            createdAt: new Date().toISOString(),
        });
        await this._save();
        logger.info(`👥 Nowy profil #${index}${cleanLabel ? ` ("${cleanLabel}")` : ''} — gracz ${this._logName(userId, logName)}`);
        return { ok: true, index, playerKey: makePlayerKey(userId, index) };
    }

    // ─── Odroczone usuwanie (7 dni) ────────────────────────────────────────────

    /**
     * Planuje usunięcie profilu za 7 dni. Dane zostają nietknięte do terminu —
     * gracz może wycofać decyzję (`cancelDeletion`).
     * @returns {Promise<{ ok: boolean, reason?: string, deleteAt?: string }>}
     */
    async scheduleDeletion(userId, profileIndex, logName = null) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return { ok: false, reason: 'NOT_FOUND' };
        if (idx === this.getMainIndex(userId)) return { ok: false, reason: 'IS_MAIN' };

        const entry = this._ensureEntry(userId);
        const target = entry.profiles.find(p => Number(p.index) === idx);
        if (!target) return { ok: false, reason: 'NOT_FOUND' };
        if (target.pendingDeleteAt) return { ok: true, deleteAt: target.pendingDeleteAt, already: true };

        target.pendingDeleteAt = new Date(Date.now() + DELETION_DELAY_MS).toISOString();
        await this._save();
        logger.info(`👥 Zaplanowano usunięcie profilu #${idx} (termin ${target.pendingDeleteAt}) — gracz ${this._logName(userId, logName)}`);
        return { ok: true, deleteAt: target.pendingDeleteAt };
    }

    /** Wycofuje zaplanowane usunięcie profilu. */
    async cancelDeletion(userId, profileIndex, logName = null) {
        const idx = Number(profileIndex) || 1;
        const entry = this._data[userId];
        const target = entry?.profiles?.find(p => Number(p.index) === idx);
        if (!target?.pendingDeleteAt) return { ok: false, reason: 'NOT_PENDING' };
        delete target.pendingDeleteAt;
        await this._save();
        logger.info(`👥 Odwołano usunięcie profilu #${idx} — gracz ${this._logName(userId, logName)}`);
        return { ok: true };
    }

    /** Czy profil czeka na skasowanie. */
    getPendingDeleteAt(userId, profileIndex) {
        const idx = Number(profileIndex) || 1;
        return this._rawProfiles(userId).find(p => p.index === idx)?.pendingDeleteAt || null;
    }

    /**
     * Wszystkie zaplanowane usunięcia (do sweepu i statystyk).
     * @returns {Array<{ userId: string, index: number, playerKey: string, deleteAt: string }>}
     */
    getPendingDeletions() {
        const out = [];
        for (const userId of Object.keys(this._data)) {
            for (const p of this._rawProfiles(userId)) {
                if (p.pendingDeleteAt) {
                    out.push({ userId, index: p.index, playerKey: makePlayerKey(userId, p.index), deleteAt: p.pendingDeleteAt });
                }
            }
        }
        return out;
    }

    /**
     * Uruchamia cykliczne sprawdzanie terminów usunięcia.
     * @param {(pending: { userId: string, index: number, playerKey: string, deleteAt: string }) => Promise<void>} onDue
     *        wywoływane dla każdego profilu po terminie — kasuje dane i wywołuje removeProfile
     */
    start(onDue) {
        this._onDue = onDue;
        const run = () => this.sweep().catch(err => logger.error(`Błąd kontroli usuwania profili: ${err.message}`));
        run();
        this._timer = setInterval(run, SWEEP_INTERVAL_MS);
        if (this._timer.unref) this._timer.unref();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }

    async sweep() {
        if (!this._onDue) return;
        const now = Date.now();
        for (const pending of this.getPendingDeletions()) {
            if (Date.parse(pending.deleteAt) > now) continue;
            try {
                await this._onDue(pending);
            } catch (err) {
                // wpis zostaje — kolejna próba przy następnym przebiegu
                logger.error(`Błąd usuwania profilu #${pending.index} gracza <@${pending.userId}>: ${err.message}`);
            }
        }
    }

    /**
     * Usuwa profil z rejestru i **przenumerowuje** pozostałe: po skasowaniu profilu 1
     * profil 2 staje się 1, a 3 staje się 2 — gracz nie ma dziur w numeracji.
     *
     * Numer slotu jest częścią `playerKey`, więc przesunięcie wymaga przeniesienia
     * WSZYSTKICH danych profilu (ranking, rekordy bossów, historia, osiągnięcia,
     * subskrypcje, sesje). Zwracana lista `renumbered` mówi wywołującemu, co przenieść;
     * jest posortowana rosnąco, więc kolejne przenosiny trafiają zawsze na wolny klucz.
     *
     * Dane rankingowe usuwanego profilu czyści wywołujący (przed wywołaniem tej metody).
     * Profilu MAIN nie można usunąć — najpierw trzeba wskazać mainem inny profil.
     * @returns {Promise<{ ok: boolean, reason?: string, renumbered?: Array<{ fromIndex: number, toIndex: number, fromKey: string, toKey: string }> }>}
     */
    async removeProfile(userId, profileIndex, logName = null) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return { ok: false, reason: 'NOT_FOUND' };
        if (idx === this.getMainIndex(userId)) return { ok: false, reason: 'IS_MAIN' };

        const entry = this._ensureEntry(userId);
        const mainIdx = this.getMainIndex(userId);
        const remaining = (entry.profiles || [])
            .filter(p => Number(p.index) !== idx)
            .sort((a, b) => Number(a.index) - Number(b.index));

        // Przesunięcie w dół: numery >  usuniętego zjeżdżają o jeden
        const renumbered = [];
        remaining.forEach(p => {
            const from = Number(p.index);
            const to = from > idx ? from - 1 : from;
            if (from !== to) {
                renumbered.push({
                    fromIndex: from,
                    toIndex: to,
                    fromKey: makePlayerKey(userId, from),
                    toKey: makePlayerKey(userId, to),
                });
            }
            p.index = to;
        });

        entry.profiles = remaining;
        entry.active = mainIdx > idx ? mainIdx - 1 : mainIdx;

        // Gdy zostaje tylko czysty slot 1 — usuń wpis, wracamy do stanu domyślnego
        const rest = entry.profiles;
        if (rest.length === 1 && Number(rest[0].index) === 1 && !rest[0].label && !rest[0].pendingDeleteAt && Number(entry.active) === 1) {
            delete this._data[userId];
        }
        await this._save();
        const shiftInfo = renumbered.length > 0
            ? ` (przesunięto: ${renumbered.map(r => `${r.fromIndex}→${r.toIndex}`).join(', ')})`
            : '';
        logger.info(`👥 Usunięto profil #${idx}${shiftInfo} — gracz ${this._logName(userId, logName)}`);
        return { ok: true, renumbered };
    }

    /**
     * Zmienia etykietę profilu.
     * @returns {Promise<{ ok: boolean, reason?: string, label?: string|null }>}
     */
    async setLabel(userId, profileIndex, label) {
        const idx = Number(profileIndex) || 1;
        if (!this.hasProfile(userId, idx)) return { ok: false, reason: 'NOT_FOUND' };

        const cleanLabel = this._sanitizeLabel(label);
        const others = this._rawProfiles(userId).filter(p => p.index !== idx);
        if (cleanLabel && others.some(p => (p.label || '').toLowerCase() === cleanLabel.toLowerCase())) {
            return { ok: false, reason: 'DUPLICATE_LABEL' };
        }

        const entry = this._ensureEntry(userId);
        const target = entry.profiles.find(p => Number(p.index) === idx);
        if (target) {
            target.label = cleanLabel;
        } else {
            entry.profiles.push({ index: idx, label: cleanLabel, createdAt: new Date().toISOString() });
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
     * @returns {{ usersWithAlts: number, totalAltProfiles: number, pendingDeletions: number }}
     */
    getStats() {
        let usersWithAlts = 0;
        let totalAltProfiles = 0;
        for (const userId of Object.keys(this._data)) {
            const alts = this._rawProfiles(userId).length - 1;
            if (alts > 0) {
                usersWithAlts++;
                totalAltProfiles += alts;
            }
        }
        return { usersWithAlts, totalAltProfiles, pendingDeletions: this.getPendingDeletions().length };
    }

    /**
     * Gracze, którzy założyli profile dodatkowe — do Centrum Dowodzenia.
     * Sortowane malejąco po liczbie profili (przy remisie po ID, żeby kolejność
     * była stabilna między odświeżeniami panelu).
     * @returns {Array<{ userId: string, profileCount: number, altCount: number, pendingCount: number }>}
     */
    getUsersWithAltProfiles() {
        const out = [];
        for (const userId of Object.keys(this._data)) {
            const profiles = this._rawProfiles(userId);
            if (profiles.length <= 1) continue;
            out.push({
                userId,
                profileCount: profiles.length,
                altCount: profiles.length - 1,
                pendingCount: profiles.filter(p => p.pendingDeleteAt).length,
            });
        }
        return out.sort((a, b) => b.profileCount - a.profileCount || a.userId.localeCompare(b.userId));
    }

    /**
     * Wszystkie playerKey profili spoza maina
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
module.exports.DELETION_DELAY_MS = DELETION_DELAY_MS;
