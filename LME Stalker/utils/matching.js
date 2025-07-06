const { calculateSimilarity } = require('./helpers');

/**
 * Funkcja do znajdowania pasujących członków
 */
function findMatchingMembers(zeroScorePlayers, targetMembers) {
    const matches = [];
    const SIMILARITY_THRESHOLD = 70;
    
    for (const player of zeroScorePlayers) {
        let bestMatch = null;
        let bestSimilarity = 0;
        let bestMethod = '';
        let bestMemberData = null;
        
        for (const memberData of targetMembers) {
            const member = memberData.member;
            const displayName = member.displayName;
            const username = member.user.username;
            
            const matchTests = [
                { 
                    name: 'DisplayName - dokładne dopasowanie', 
                    similarity: displayName.toLowerCase() === player.toLowerCase() ? 100 : 0
                },
                { 
                    name: 'Username - dokładne dopasowanie', 
                    similarity: username.toLowerCase() === player.toLowerCase() ? 100 : 0
                },
                { 
                    name: 'DisplayName - podobieństwo Levenshtein', 
                    similarity: calculateSimilarity(player, displayName)
                },
                { 
                    name: 'Username - podobieństwo Levenshtein', 
                    similarity: calculateSimilarity(player, username)
                },
                { 
                    name: 'DisplayName zawiera nick z OCR', 
                    similarity: displayName.toLowerCase().includes(player.toLowerCase()) ? 85 : 0
                },
                { 
                    name: 'Username zawiera nick z OCR', 
                    similarity: username.toLowerCase().includes(player.toLowerCase()) ? 85 : 0
                },
                { 
                    name: 'Nick z OCR zawiera displayName', 
                    similarity: player.toLowerCase().includes(displayName.toLowerCase()) && displayName.length >= 3 ? 80 : 0
                },
                { 
                    name: 'Nick z OCR zawiera username', 
                    similarity: player.toLowerCase().includes(username.toLowerCase()) && username.length >= 3 ? 80 : 0
                }
            ];
            
            for (const test of matchTests) {
                if (test.similarity > bestSimilarity && test.similarity >= SIMILARITY_THRESHOLD) {
                    bestMatch = member;
                    bestSimilarity = test.similarity;
                    bestMethod = test.name;
                    bestMemberData = memberData;
                }
            }
        }
        
        if (bestMatch && bestMemberData) {
            matches.push({
                discordMember: bestMatch,
                foundName: player,
                matchMethod: bestMethod,
                similarity: bestSimilarity,
                memberRole: bestMemberData.roleId,
                memberRoleKey: bestMemberData.roleKey,
                memberRoleName: bestMemberData.roleName
            });
        }
    }
    
    return matches;
}

module.exports = {
    findMatchingMembers
};
