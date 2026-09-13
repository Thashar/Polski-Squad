'use strict';

// ── Rozpoznawanie „nazwy bossa", która nazwą bossa nie jest ──────────────────────────
// Prawdziwe nazwy to najwyżej kilka słów; dłuższy tekst to prawie zawsze zdanie od modelu.
const BOSS_NAME_MAX_LENGTH = 48;
const BOSS_NAME_MAX_WORDS = 6;

// Wartości, którymi model sygnalizuje brak nazwy na obrazie
const BOSS_NAME_PLACEHOLDERS = ['brak', 'brak nazwy', 'unknown', 'n/a', 'na', 'none', 'null', 'nieznany', '-', '--', '?', '0'];

// Frazy odmowy/niepewności — nigdy nie są nazwą bossa
const BOSS_NAME_REFUSAL_PATTERNS = [
    /nie\s+uda/i,
    /nie\s+zident/i,
    /nie\s+rozpozna/i,
    /nie\s+widz/i,
    /nie\s+mog/i,
    /nie\s+jestem\s+w\s+stanie/i,
    /nie\s+ma\s+nazwy/i,
    /nieczyteln/i,
    /unable\s+to/i,
    /cannot\s/i,
    /can'?t\s/i,
    /not\s+(visible|readable|found|identified|recognized)/i,
    /no\s+boss/i,
    /unreadable/i,
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
 * Czy odczytany tekst NIE JEST nazwą bossa.
 *
 * Model potrafi zamiast nazwy zwrócić całe zdanie ("Nie udało mi się zidentyfikować nazwy
 * bossa na zrzucie ekranu.") — a takie zdanie przechodziło dalej jako zwykła nieznana nazwa:
 * wynik lądował w rankingu z bełkotem w polu bossa, a admin dostawał alert
 * „Wykryto nieznaną nazwę bossa" z propozycją dopisania tego zdania jako aliasu.
 * Zamiast tego screen ma zostać ODRZUCONY.
 *
 * ⚠️ Świadomie odsiewamy też same znaki zastępcze ("brak", "N/A", "0") — to sygnał,
 * że nazwy na obrazie nie ma, a nie nazwa bossa.
 *
 * @param {string} raw surowa pierwsza linia odpowiedzi modelu
 * @returns {boolean}
 */
function isUnreadableBossName(raw) {
    if (!raw || typeof raw !== 'string') return true;

    const trimmed = raw.trim();
    if (!trimmed) return true;

    const bezKropki = trimmed.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (BOSS_NAME_PLACEHOLDERS.includes(bezKropki)) return true;

    // Nazwa bossa to kilka słów, nie zdanie
    if (trimmed.length > BOSS_NAME_MAX_LENGTH) return true;
    if (trimmed.split(/\s+/).length > BOSS_NAME_MAX_WORDS) return true;

    // Kropka/wykrzyknik na końcu wieloczłonowego tekstu = wypowiedź modelu, nie nazwa
    if (/[.!?]$/.test(trimmed) && /\s/.test(trimmed)) return true;

    return BOSS_NAME_REFUSAL_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Uproszczona wersja bez aliasów — zachowana dla kompatybilności wstecznej.
 */
function correctBossName(raw) {
    return correctBossNameFull(raw, null).corrected;
}

module.exports = { correctBossName, correctBossNameFull, isUnreadableBossName };
