const config = require('../config/config');

/**
 * Sprawdza czy użytkownik ma wymagane uprawnienia
 */
function hasPermission(member, allowedRoles = config.ALLOWED_PUNISH_ROLES) {
    console.log(`🔍 Sprawdzanie uprawnień dla użytkownika: ${member.displayName}`);
    const hasPermission = member.roles.cache.some(role => allowedRoles.includes(role.id));
    console.log(`${hasPermission ? '✅' : '❌'} Wynik sprawdzania uprawnień: ${hasPermission}`);
    return hasPermission;
}

/**
 * Oblicza odległość Levenshtein między dwoma stringami
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Oblicza podobieństwo między dwoma stringami w procentach
 */
function calculateSimilarity(str1, str2) {
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    
    if (maxLength === 0) return 100;
    
    const similarity = ((maxLength - distance) / maxLength) * 100;
    return Math.round(similarity);
}

module.exports = {
    hasPermission,
    levenshteinDistance,
    calculateSimilarity
};
