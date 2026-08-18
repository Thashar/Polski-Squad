const path = require('path');
const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');
const SHARED_DATA_PATH = path.join(__dirname, '../../shared_data/clan_thresholds.json');

/**
 * Progi kwalifikacji klanów liczy i zapisuje STALKER — my tylko czytamy.
 *
 * Wcześniej co 5 minut wymuszaliśmy tu `store.reload()`, bo Stalker pisał ten plik
 * zwykłym `fs` i nasz cache nie wiedziałby o zmianie. Po migracji Stalkera na store
 * (`clanThresholdsExportService` woła `store.set`) oba boty dzielą TEN SAM wpis
 * w cache — jeden proces, klucz to ścieżka pliku. Progi są więc aktualne od razu
 * po zapisie, a wymuszony odczyt z dysku był już tylko zbędnym ruchem dyskowym.
 */
async function getClanThresholds(guildId) {
    try {
        const data = await store.getOrLoad(SHARED_DATA_PATH, () => null);
        if (!data) {
            logger.warn('[THRESHOLDS] Brak pliku clan_thresholds.json — dane ze Stalkera niedostępne');
            return null;
        }
        return data[guildId] || null;
    } catch {
        logger.warn('[THRESHOLDS] Brak pliku clan_thresholds.json — dane ze Stalkera niedostępne');
        return null;
    }
}

module.exports = { getClanThresholds };
