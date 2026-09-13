/**
 * Throttling dla guild.members.fetch() - zapobiega rate limitom Discord Gateway (opcode 8)
 *
 * Discord Gateway ma limit dla opcode 8 (REQUEST_GUILD_MEMBERS):
 * - Max 120 requestów na 60 sekund
 * - Limit obowiązuje POŁĄCZENIE gateway, a nie serwer Discord
 *
 * Ten moduł zapewnia:
 * - 30-sekundowy cooldown między fetch dla tej samej pary (bot, serwer)
 * - Doczekanie trwającego fetcha zamiast zwracania cache w trakcie zapełniania
 * - Intelligent logging wszystkich operacji
 */

const { createBotLogger } = require('./consoleLogger');
const defaultLogger = createBotLogger('GuildThrottle');

// `${clientId}:${guildId}` -> { lastFetch: timestamp, promise: Promise|null }
const membersFetchThrottle = new Map();
const MEMBERS_FETCH_COOLDOWN = 30000; // 30 sekund między fetch dla tej samej pary (bot, serwer)

/**
 * ⚠️ Klucz MUSI zawierać ID bota, nie tylko serwer.
 *
 * Wszystkie 9 botów żyje w JEDNYM procesie, więc mapa jest wspólna, ale każdy bot ma
 * własne połączenie gateway i własny `guild.members.cache`. Klucz po samym `guildId`
 * sprawiał, że bot, który trafił w cooldown założony przez INNEGO bota, dostawał swój
 * własny — przy starcie praktycznie pusty — cache. Bez żadnego wyjątku w logu: progi
 * klanowe wychodziły `null`, a rankingi ról gubiły graczy.
 */
function throttleKey(guild) {
    return `${guild.client?.user?.id || 'unknown'}:${guild.id}`;
}

/**
 * Bezpieczne pobranie członków serwera z throttlingiem
 * @param {Guild} guild - Serwer Discord
 * @param {Object} logger - Logger do logowania operacji (opcjonalny)
 * @param {boolean} force - Wymuś fetch nawet jeśli w cooldown
 * @returns {Promise<Collection>} - Kolekcja członków
 */
async function safeFetchMembers(guild, logger = null, force = false) {
    // Jeśli logger nie został przekazany, użyj domyślnego
    const log = logger || defaultLogger;
    const key = throttleKey(guild);
    const now = Date.now();
    const throttleData = membersFetchThrottle.get(key);

    // Fetch tego samego bota już trwa — doczekaj jego wyniku.
    // Zwracany wcześniej `guild.members.cache` był w tym momencie kolekcją W TRAKCIE
    // zapełniania, więc wywołujący dostawał niekompletną listę członków
    if (throttleData?.promise) {
        return throttleData.promise;
    }

    // Jeśli ostatni fetch był niedawno i nie wymuszamy, użyj cache (już kompletnego)
    if (!force && throttleData && (now - throttleData.lastFetch) < MEMBERS_FETCH_COOLDOWN) {
        return guild.members.cache;
    }

    log.info(`🔄 Pobieram członków guild ${guild.name}...`);

    const promise = (async () => {
        try {
            const members = await guild.members.fetch();
            log.info(`✅ Pobrano ${members.size} członków dla guild ${guild.name}`);
            return members;
        } catch (error) {
            log.error(`❌ Błąd pobierania członków guild ${guild.name}:`, error);
            // Fallback do cache
            return guild.members.cache;
        }
    })();

    membersFetchThrottle.set(key, { lastFetch: now, promise });

    try {
        return await promise;
    } finally {
        // Cooldown liczony od ZAKOŃCZENIA pobierania
        membersFetchThrottle.set(key, { lastFetch: Date.now(), promise: null });
    }
}

module.exports = {
    safeFetchMembers
};
