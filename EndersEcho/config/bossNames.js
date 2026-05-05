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
 * Próbuje dopasować odczytaną nazwę bossa do listy znanych nazw.
 * Zwraca poprawną nazwę jeśli znaleziono dopasowanie, lub oryginalną wartość gdy nie.
 */
function correctBossName(raw) {
    if (!raw || typeof raw !== 'string') return raw;

    const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');

    // Szukamy najlepszego trafienia
    let bestName = null;
    let bestDist = Infinity;

    for (const known of KNOWN_BOSS_NAMES) {
        const knownNorm = known.toLowerCase();

        // Dokładne dopasowanie (case-insensitive)
        if (normalized === knownNorm) return known;

        // Zawieranie — OCR mógł dodać/uciąć kilka znaków
        if (knownNorm.includes(normalized) || normalized.includes(knownNorm)) {
            const dist = levenshtein(normalized, knownNorm);
            if (dist < bestDist) { bestDist = dist; bestName = known; }
            continue;
        }

        const dist = levenshtein(normalized, knownNorm);
        if (dist < bestDist) { bestDist = dist; bestName = known; }
    }

    // Próg: max 3 znaki różnicy (wystarczy na 1-2 literówki OCR)
    if (bestName && bestDist <= 3) return bestName;

    // Brak dopasowania — zostawiamy co AI odczytał
    return raw.trim();
}

module.exports = { KNOWN_BOSS_NAMES, correctBossName };
