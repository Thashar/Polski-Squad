const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
const SHARED_DATA_PATH = path.join(__dirname, '../../shared_data/clan_thresholds.json');
const CACHE_TTL = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;

async function getClanThresholds(guildId) {
    if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
        return _cache[guildId] || null;
    }

    try {
        const raw = await fs.readFile(SHARED_DATA_PATH, 'utf8');
        _cache = JSON.parse(raw);
        _cacheTime = Date.now();
        return _cache[guildId] || null;
    } catch {
        logger.warn('[THRESHOLDS] Brak pliku clan_thresholds.json — dane ze Stalkera niedostępne');
        return null;
    }
}

module.exports = { getClanThresholds };
