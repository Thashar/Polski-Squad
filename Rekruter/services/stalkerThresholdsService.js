const path = require('path');
const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
const SHARED_DATA_PATH = path.join(__dirname, '../../shared_data/clan_thresholds.json');
const CACHE_TTL = 5 * 60 * 1000;

let _lastReload = 0;

/**
 * Progi kwalifikacji klanów liczy i zapisuje STALKER — my tylko czytamy.
 *
 * Dopóki Stalker nie przejdzie na `utils/jsonStore`, pisze plik zwykłym `fs`,
 * a nasz cache nie dowiedziałby się o zmianie (store czyta z dysku raz). Dlatego
 * co CACHE_TTL wymuszamy `reload()`. Po migracji Stalkera oba boty będą dzielić
 * ten sam wpis w cache (jeden proces, klucz = ścieżka pliku) i to odświeżanie
 * będzie można usunąć — dane będą aktualne natychmiast po zapisie.
 */
async function getClanThresholds(guildId) {
    const now = Date.now();

    if (now - _lastReload >= CACHE_TTL && store.isLoaded(SHARED_DATA_PATH)) {
        _lastReload = now;
        await store.reload(SHARED_DATA_PATH).catch(() => {});
    }

    try {
        const data = await store.getOrLoad(SHARED_DATA_PATH, () => null);
        if (!data) {
            logger.warn('[THRESHOLDS] Brak pliku clan_thresholds.json — dane ze Stalkera niedostępne');
            return null;
        }
        if (_lastReload === 0) _lastReload = now;
        return data[guildId] || null;
    } catch {
        logger.warn('[THRESHOLDS] Brak pliku clan_thresholds.json — dane ze Stalkera niedostępne');
        return null;
    }
}

module.exports = { getClanThresholds };
