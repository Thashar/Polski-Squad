'use strict';

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
    const allKnown = bossAliasService ? bossAliasService.getExtraEnglishNames() : [];

    if (!allKnown.length) return { corrected: raw.trim(), wasUnknown: true };

    let bestName = null;
    let bestDist = Infinity;

    for (const known of allKnown) {
        const knownNorm = known.toLowerCase();

        if (normalized === knownNorm) return { corrected: known, wasUnknown: false };

        if (knownNorm.includes(normalized) || normalized.includes(knownNorm)) {
            const dist = levenshtein(normalized, knownNorm);
            if (dist < bestDist) { bestDist = dist; bestName = known; }
            continue;
        }

        const dist = levenshtein(normalized, knownNorm);
        if (dist < bestDist) { bestDist = dist; bestName = known; }
    }

    if (bestName && bestDist <= 3) return { corrected: bestName, wasUnknown: false };

    return { corrected: raw.trim(), wasUnknown: true };
}

/**
 * Uproszczona wersja bez aliasów — zachowana dla kompatybilności wstecznej.
 */
function correctBossName(raw) {
    return correctBossNameFull(raw, null).corrected;
}

module.exports = { correctBossName, correctBossNameFull };
