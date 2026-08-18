const { Options } = require('discord.js');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WSPÓLNA KONFIGURACJA CACHE DISCORD.JS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Domyślnie discord.js trzyma w pamięci bez ograniczeń m.in. użytkowników,
 * presence i reakcje — a w tym projekcie działa DZIEWIĘĆ klientów w jednym
 * procesie, każdy z własnym kompletem cache'u. Przy długim uptime rosło to
 * w nieskończoność i było realnym kandydatem na wyczerpanie pamięci.
 *
 * Ta konfiguracja NIE zmienia działania botów:
 *   - członkowie serwera zostają w cache (potrzebni do ról, nicków, uprawnień),
 *     usuwany jest tylko wpis samego bota po godzinie bezczynności — nie dotyczy
 *     to zwykłych członków
 *   - wiadomości starsze niż godzina są sprzątane, ale boty i tak pobierają
 *     starsze wiadomości przez `fetch()`, a nie z cache
 *   - reakcje i presence nie są nigdzie odczytywane z cache
 *
 * ⚠️ NIE ograniczamy `GuildMemberManager` ani `UserManager` limitem rozmiaru —
 * kod w wielu miejscach polega na `role.members` i `guild.members.cache`,
 * a przycięcie tych kolekcji dałoby ciche, trudne do wykrycia błędy
 * (np. brakujących graczy w rankingach ról).
 */

/** Sprzątacze cache — uruchamiane cyklicznie przez discord.js. */
const sweepers = {
    ...Options.DefaultSweeperSettings,

    // Wiadomości starsze niż godzina; sprawdzanie co 30 minut
    messages: {
        interval: 1800,
        lifetime: 900
    },

    // Reakcje nie są nigdzie czytane z cache — czyścimy je agresywnie
    reactions: {
        interval: 900,
        filter: () => () => true
    },

    // Presence w ogóle nie jest używane
    presences: {
        interval: 900,
        filter: () => () => true
    }
};

/**
 * Zwraca opcje cache do przekazania w `new Client({ ...getCacheOptions(), intents })`.
 */
function getCacheOptions() {
    return {
        sweepers,
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            // Wiadomości: 200 na kanał wystarcza do edycji/usunięć obsługiwanych na żywo
            MessageManager: 200,
            // Te kolekcje nie są w projekcie odczytywane z cache
            PresenceManager: 0,
            GuildInviteManager: 0,
            GuildScheduledEventManager: 0,
            AutoModerationRuleManager: 0
        })
    };
}

module.exports = { getCacheOptions, sweepers };
