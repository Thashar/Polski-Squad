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
];

class BossAliasService {
    constructor() {
        this._data = { englishNames: [], aliases: {} };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DATA_PATH)) {
                const raw = fs.readFileSync(DATA_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                this._data.englishNames = Array.isArray(parsed.englishNames) ? parsed.englishNames : [];
                this._data.aliases = parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};
            }
        } catch { /* zostaw domyślne */ }
    }

    async _save() {
        await fs.promises.writeFile(DATA_PATH, JSON.stringify(this._data, null, 2), 'utf8');
    }

    getData() { return this._data; }

    getExtraEnglishNames() { return this._data.englishNames || []; }

    getAllAliases() { return this._data.aliases || {}; }

    getSupportedLanguages() { return SUPPORTED_LANGUAGES; }

    /**
     * Dodaje nową angielską nazwę bossa do listy customowej (poza KNOWN_BOSS_NAMES).
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
     * Dodaje alias w danym języku dla angielskiej nazwy bossa.
     * @param {string} englishName  angielska nazwa bossa
     * @param {string} aliasName    alias w innym języku
     * @param {string} language     kod języka (pl, de, fr, ...)
     */
    async addAlias(englishName, aliasName, language) {
        const aliases = this._data.aliases;
        if (!aliases[englishName]) aliases[englishName] = {};
        if (!aliases[englishName][language]) aliases[englishName][language] = [];
        const trimmed = aliasName.trim();
        if (!aliases[englishName][language].includes(trimmed)) {
            aliases[englishName][language].push(trimmed);
            await this._save();
        }
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
     * Inicjalizuje aliases dla hardcodowanych nazw bossów jeśli jeszcze ich nie ma.
     * Wywoływane raz przy starcie bota — idempotentne.
     * @param {string[]} baseNames  KNOWN_BOSS_NAMES z bossNames.js
     */
    async initFromBaseNames(baseNames) {
        let changed = false;
        for (const name of baseNames) {
            if (!(name in this._data.aliases)) {
                this._data.aliases[name] = {};
                changed = true;
            }
        }
        if (changed) await this._save();
    }
}

module.exports = { BossAliasService, SUPPORTED_LANGUAGES };
