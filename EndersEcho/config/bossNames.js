'use strict';

const KNOWN_BOSS_NAMES = [
    'Gigabrute Chief',
    'Raging Steel Fang',
    'Tech Tyrant',
    'Osidian Mecha',
    'Zapstinger',
    'Bouncy Bear',
    'Gigabrute',
    'Ancient Megalodon',
    'Shardrock Bug',
    'Killer Shaun',
    'Ratatoxic',
    'Shardstone Bug',
    'Leviathan',
];

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) {
        dp[i] = [i];
        for (let j = 1; j <= n; j++) dp[i][j] = i === 0 ? j : 0;
    }
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

/**
 * Pełna korekcja nazwy bossa z obsługą aliasów.
 * Zwraca { corrected, wasUnknown }.
 * wasUnknown=true gdy nie znaleziono dopasowania (ani dokładnego, ani przez Levenshtein, ani przez alias).
 *
 * @param {string} raw
 * @param {import('../services/bossAliasService').BossAliasService|null} bossAliasService
 * @returns {{ corrected: string, wasUnknown: boolean }}
 */
function correctBossNameFull(raw, bossAliasService = null) {
    if (!raw || typeof raw !== 'string') return { corrected: raw, wasUnknown: false };

    // 1. Sprawdź aliasy (dokładne dopasowanie case-insensitive)
    if (bossAliasService) {
        const resolved = bossAliasService.resolveAlias(raw);
        if (resolved) return { corrected: resolved, wasUnknown: false };
    }

    const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');

    // 2. Zbuduj rozszerzoną listę angielskich nazw
    const allKnown = bossAliasService
        ? [...KNOWN_BOSS_NAMES, ...bossAliasService.getExtraEnglishNames()]
        : KNOWN_BOSS_NAMES;

    let bestName = null;
    let bestDist = Infinity;

    for (const known of allKnown) {
        const knownNorm = known.toLowerCase();

        // Dokładne dopasowanie (case-insensitive)
        if (normalized === knownNorm) return { corrected: known, wasUnknown: false };

        // Zawieranie
        if (knownNorm.includes(normalized) || normalized.includes(knownNorm)) {
            const dist = levenshtein(normalized, knownNorm);
            if (dist < bestDist) { bestDist = dist; bestName = known; }
            continue;
        }

        const dist = levenshtein(normalized, knownNorm);
        if (dist < bestDist) { bestDist = dist; bestName = known; }
    }

    // Próg: max 3 znaki różnicy
    if (bestName && bestDist <= 3) return { corrected: bestName, wasUnknown: false };

    return { corrected: raw.trim(), wasUnknown: true };
}

/**
 * Próbuje dopasować odczytaną nazwę bossa do listy znanych nazw.
 * Zwraca poprawną nazwę jeśli znaleziono dopasowanie, lub oryginalną wartość gdy nie.
 * Wersja bez aliasów — zachowana dla kompatybilności wstecznej.
 */
function correctBossName(raw) {
    return correctBossNameFull(raw, null).corrected;
}

module.exports = { KNOWN_BOSS_NAMES, correctBossName, correctBossNameFull };
