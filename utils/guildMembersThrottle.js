/**
 * Throttling dla guild.members.fetch() - zapobiega rate limitom Discord Gateway (opcode 8)
 *
 * Discord Gateway ma limit dla opcode 8 (REQUEST_GUILD_MEMBERS):
 * - Max 120 requestów na 60 sekund
 * - Przekroczenie powoduje GatewayRateLimitError
 *
 * Ten moduł zapewnia:
 * - 30-sekundowy cooldown między fetch dla tego samego serwera
 * - Automatyczny fallback do cache jeśli fetch w toku
 * - Intelligent logging wszystkich operacji
 */

const { createBotLogger } = require('./consoleLogger');
const defaultLogger = createBotLogger('GuildThrottle');

const membersFetchThrottle = new Map(); // guildId -> { lastFetch: timestamp, isInProgress: boolean }
const MEMBERS_FETCH_COOLDOWN = 30000; // 30 sekund między fetch dla tego samego guild

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
    const guildId = guild.id;
    const now = Date.now();
    const throttleData = membersFetchThrottle.get(guildId);

    // Jeśli fetch już jest w toku, poczekaj i użyj cache
    if (throttleData && throttleData.isInProgress) {
        return guild.members.cache;
    }

    // Jeśli ostatni fetch był niedawno i nie wymuszamy, użyj cache
    if (!force && throttleData && (now - throttleData.lastFetch) < MEMBERS_FETCH_COOLDOWN) {
        return guild.members.cache;
    }

    // Wykonaj fetch
    try {
        log.info(`🔄 Pobieram członków guild ${guild.name}...`);
        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: true });

        const members = await guild.members.fetch();

        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: false });
        log.info(`✅ Pobrano ${members.size} członków dla guild ${guild.name}`);

        return members;
    } catch (error) {
        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: false });
        log.error(`❌ Błąd pobierania członków guild ${guild.name}:`, error);
        // Fallback do cache
        return guild.members.cache;
    }
}

module.exports = {
    safeFetchMembers
};
