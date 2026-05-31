'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/boss_aliases.json');

// Obsługiwane języki (kod → etykieta)
const SUPPORTED_LANGUAGES = [
    { code: 'pl', label: '🇵🇱 Polski' },
    { code: 'de', label: '🇩🇪 Deutsch' },
    { code: 'fr', label: '🇫🇷 Français' },
    { code: 'es', label: '🇪🇸 Español' },
    { code: 'pt', label: '🇵🇹 Português' },
    { code: 'ru', label: '🇷🇺 Русский' },
    { code: 'it', label: '🇮🇹 Italiano' },
    { code: 'tr', label: '🇹🇷 Türkçe' },
    { code: 'ja', label: '🇯🇵 日本語' },
    { code: 'zh', label: '🇨🇳 中文' },
    { code: 'vi', label: '🇻🇳 Tiếng Việt' },
    { code: 'ko', label: '🇰🇷 한국어' },
];

class BossAliasService {
    constructor() {
        this._data = { englishNames: [], aliases: {}, images: {} };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DATA_PATH)) {
                const raw = fs.readFileSync(DATA_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                this._data.englishNames = Array.isArray(parsed.englishNames) ? parsed.englishNames : [];
                this._data.aliases = parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};
                this._data.images = parsed.images && typeof parsed.images === 'object' ? parsed.images : {};
            }
        } catch { /* zostaw domyślne */ }
    }

    async _save() {
        await fs.promises.writeFile(DATA_PATH, JSON.stringify(this._data, null, 2), 'utf8');
    }

    getData() { return this._data; }

    /**
     * Zwraca listę wszystkich angielskich nazw bossów.
     * Łączy englishNames[] z kluczami aliases{} (backward-compat z initFromBaseNames).
     */
    getExtraEnglishNames() {
        const fromList = this._data.englishNames || [];
        const fromKeys = Object.keys(this._data.aliases || {});
        return [...new Set([...fromList, ...fromKeys])];
    }

    getAllAliases() { return this._data.aliases || {}; }

    getSupportedLanguages() { return SUPPORTED_LANGUAGES; }

    /**
     * Dodaje nową angielską nazwę bossa.
     * @param {string} name
     * @returns {string} znormalizowana nazwa
     */
    async addEnglishName(name) {
        const trimmed = name.trim();
        if (!this._data.englishNames.includes(trimmed)) {
            this._data.englishNames.push(trimmed);
            await this._save();
        }
        return trimmed;
    }

    /**
     * Sprawdza czy alias (case-insensitive) już istnieje gdziekolwiek w danych.
     * Zwraca { englishName, language } jeśli znaleziono, null jeśli nie.
     */
    findExistingAlias(aliasName) {
        const needle = aliasName.trim().toLowerCase().replace(/\s+/g, ' ');
        for (const [boss, langMap] of Object.entries(this._data.aliases || {})) {
            for (const [lang, arr] of Object.entries(langMap)) {
                for (const a of arr) {
                    if (a.trim().toLowerCase().replace(/\s+/g, ' ') === needle)
                        return { englishName: boss, language: lang };
                }
            }
        }
        return null;
    }

    /**
     * Dodaje alias w danym języku dla angielskiej nazwy bossa.
     * Zwraca { added: true } lub { added: false, conflict: { englishName, language } }.
     * @param {string} englishName  angielska nazwa bossa
     * @param {string} aliasName    alias w innym języku
     * @param {string} language     kod języka (pl, de, fr, ...)
     */
    async addAlias(englishName, aliasName, language) {
        const trimmed = aliasName.trim();
        const existing = this.findExistingAlias(trimmed);
        if (existing) return { added: false, conflict: existing };
        const aliases = this._data.aliases;
        if (!aliases[englishName]) aliases[englishName] = {};
        if (!aliases[englishName][language]) aliases[englishName][language] = [];
        aliases[englishName][language].push(trimmed);
        await this._save();
        return { added: true };
    }

    /**
     * Usuwa alias z danego języka dla angielskiej nazwy bossa.
     * @param {string} englishName
     * @param {string} language
     * @param {string} aliasName
     */
    async removeAlias(englishName, language, aliasName) {
        const langArr = this._data.aliases?.[englishName]?.[language];
        if (!langArr) return;
        this._data.aliases[englishName][language] = langArr.filter(a => a !== aliasName);
        if (this._data.aliases[englishName][language].length === 0)
            delete this._data.aliases[englishName][language];
        if (Object.keys(this._data.aliases[englishName] || {}).length === 0)
            delete this._data.aliases[englishName];
        await this._save();
    }

    /**
     * Zmienia treść aliasu (zachowuje bossa i język).
     * @param {string} englishName
     * @param {string} language
     * @param {string} oldAlias
     * @param {string} newAlias
     */
    async renameAlias(englishName, language, oldAlias, newAlias) {
        const trimmed = newAlias.trim();
        if (!trimmed || trimmed === oldAlias) return;
        const langArr = this._data.aliases?.[englishName]?.[language];
        if (!langArr) return;
        const idx = langArr.indexOf(oldAlias);
        if (idx === -1) return;
        if (langArr.includes(trimmed)) {
            // nowa nazwa już istnieje — usuń tylko starą
            langArr.splice(idx, 1);
        } else {
            langArr[idx] = trimmed;
        }
        await this._save();
    }

    /**
     * Próbuje dopasować surową nazwę (z OCR) do angielskiej nazwy przez aliasy.
     * Zwraca angielską nazwę lub null jeśli nie znaleziono.
     * @param {string} raw
     * @returns {string|null}
     */
    resolveAlias(raw) {
        if (!raw) return null;
        const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');
        for (const [englishName, langMap] of Object.entries(this._data.aliases || {})) {
            for (const aliasNames of Object.values(langMap)) {
                for (const alias of aliasNames) {
                    if (alias.trim().toLowerCase().replace(/\s+/g, ' ') === normalized)
                        return englishName;
                }
            }
        }
        return null;
    }

    /**
     * Zwraca listę wszystkich aliasów jako płaską tablicę { englishName, language, alias }
     * Przydatne do budowania select menu usuwania.
     */
    getFlatAliases() {
        const result = [];
        for (const [englishName, langMap] of Object.entries(this._data.aliases || {})) {
            for (const [lang, aliases] of Object.entries(langMap)) {
                for (const alias of aliases) {
                    result.push({ englishName, language: lang, alias });
                }
            }
        }
        return result;
    }

    /**
     * Sprawdza czy dana angielska nazwa bossa ma jakiekolwiek aliasy.
     */
    hasAliases(englishName) {
        const langMap = this._data.aliases?.[englishName];
        if (!langMap) return false;
        return Object.values(langMap).some(arr => arr.length > 0);
    }

    /**
     * Usuwa angielską nazwę bossa wraz ze wszystkimi jej aliasami i zdjęciem.
     * @param {string} name
     */
    async removeEnglishName(name) {
        this._data.englishNames = (this._data.englishNames || []).filter(n => n !== name);
        if (this._data.aliases) delete this._data.aliases[name];
        if (this._data.images) delete this._data.images[name];
        await this._save();
    }

    /**
     * Zwraca ścieżkę do pliku zdjęcia bossa (względem katalogu data/) lub null.
     * @param {string} bossName - angielska nazwa bossa
     * @returns {string|null}
     */
    getBossImagePath(bossName) {
        return this._data.images?.[bossName] || null;
    }

    /**
     * Zapisuje ścieżkę do zdjęcia bossa.
     * @param {string} bossName
     * @param {string} relativePath - względna ścieżka od katalogu data/
     */
    async setBossImage(bossName, relativePath) {
        if (!this._data.images) this._data.images = {};
        this._data.images[bossName] = relativePath;
        await this._save();
    }

    /**
     * Usuwa zdjęcie bossa z danych (nie usuwa pliku z dysku).
     * @param {string} bossName
     */
    async removeBossImage(bossName) {
        if (this._data.images) delete this._data.images[bossName];
        await this._save();
    }

    /**
     * Zmienia nazwę angielską bossa (klucz w aliases + wpis w englishNames).
     * @param {string} oldName
     * @param {string} newName
     * @returns {string} nowa nazwa (po trimie)
     */
    async renameEnglishName(oldName, newName) {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return oldName;

        const idx = (this._data.englishNames || []).indexOf(oldName);
        if (idx !== -1) this._data.englishNames[idx] = trimmed;

        if (this._data.aliases && oldName in this._data.aliases) {
            this._data.aliases[trimmed] = this._data.aliases[oldName];
            delete this._data.aliases[oldName];
        }

        if (this._data.images && oldName in this._data.images) {
            this._data.images[trimmed] = this._data.images[oldName];
            delete this._data.images[oldName];
        }

        await this._save();
        return trimmed;
    }
}

module.exports = { BossAliasService, SUPPORTED_LANGUAGES };
