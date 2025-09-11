const axios = require('axios');
const cheerio = require('cheerio');
const ProxyService = require('./proxyService');

class PlayerService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.playerData = [];
        this.lastFetchTime = null;
        // PlayerService uses proxy as fallback when receiving 403 errors
        this.proxyService = new ProxyService(config, logger);
        
        // Axios debugging (can be removed in production)
        this.logger.info(`🔧 PlayerService constructor - axios available: ${typeof axios}`);
        this.logger.info(`🔧 PlayerService constructor - axios.create available: ${typeof axios?.create}`);
        
        // Create direct axios instance for basic operations (no proxy)
        try {
            this.axios = axios.create({
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            this.logger.info('✅ PlayerService axios instance created successfully');
            this.logger.info(`   Timeout: ${this.axios.defaults.timeout}`);
        } catch (error) {
            this.logger.error('❌ Failed to create axios instance:', error.message);
            throw error;
        }
    }

    async fetchPlayerData() {
        try {
            this.logger.info('👥 Fetching player ranking data from API...');
            this.logger.info(`   🔧 Using axios timeout: ${this.axios.defaults.timeout}`);
            this.logger.info(`   🔧 User-Agent: ${this.axios.defaults.headers['User-Agent']}`);
            
            this.logger.info('   🌐 Making request to garrytools.com/rank/players...');
            let response;
            
            try {
                // Try direct request first
                response = await this.axios.get('https://garrytools.com/rank/players');
            } catch (directError) {
                // If we get 403 Forbidden, try with proxy
                if (directError.response?.status === 403) {
                    this.logger.info('   🔄 Direct request blocked (403), trying with proxy...');
                    response = await this.proxyService.makeRequest('https://garrytools.com/rank/players');
                } else {
                    throw directError; // Re-throw other errors
                }
            }
            this.logger.info(`   ✅ Response received: ${response.status} ${response.data ? response.data.length + ' chars' : 'no data'}`);
            
            if (response.data && typeof response.data === 'string') {
                // Parse HTML response with cheerio
                const $ = cheerio.load(response.data);
                const players = [];
                
                // Find the ranking table and extract data
                $('table tr').each((index, row) => {
                    if (index === 0) return; // Skip header row
                    
                    const cells = $(row).find('td');
                    if (cells.length >= 7) {
                        const rank = parseInt($(cells[0]).text().trim()) || 0;
                        const playerId = parseInt($(cells[1]).text().trim()) || 0;
                        const name = $(cells[2]).text().trim();
                        const guildName = $(cells[3]).text().trim();
                        const relicCores = $(cells[4]).text().trim(); // Keep as string (e.g., "123.45")
                        const attack = $(cells[5]).text().trim();
                        const health = $(cells[6]).text().trim();
                        const level = cells.length > 7 ? parseInt($(cells[7]).text().trim()) || 1 : 1;
                        
                        if (name && playerId > 0) {
                            players.push({
                                id: playerId,
                                name: name,
                                guildName: guildName,
                                relicCores: relicCores,
                                attack: attack,
                                health: health,
                                level: level,
                                rank: rank,
                                cleanName: this.cleanPlayerName(name)
                            });
                        }
                    }
                });
                
                this.playerData = players;
                this.lastFetchTime = new Date();
                return this.playerData;
            } else {
                this.logger.warn('⚠️ Invalid API response format for player data');
                return [];
            }
        } catch (error) {
            this.logger.error(`❌ Error fetching player ranking data: ${error.message || 'Unknown error'}`);
            this.logger.error(`   Error type: ${error.constructor?.name || 'Unknown constructor'}`);
            this.logger.error(`   Error code: ${error.code || 'No error code'}`);
            this.logger.error(`   Error details: ${error.stack || 'No stack trace available'}`);
            this.logger.error(`   Response status: ${error.response ? error.response.status : 'No response'}`);
            this.logger.error(`   Response data: ${error.response ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : JSON.stringify(error.response.data)) : 'No response data'}`);
            
            // Advanced debugging for empty errors
            this.logger.error(`   🔍 Raw error typeof: ${typeof error}`);
            this.logger.error(`   🔍 Error is instance of Error: ${error instanceof Error}`);
            this.logger.error(`   🔍 Error object keys: ${Object.keys(error).join(', ')}`);
            this.logger.error(`   🔍 Error toString(): ${error.toString()}`);
            
            // Check if this is actually not an error but some other issue
            if (!error.message && !error.code && !error.response) {
                this.logger.error('   ⚠️ Empty error object - this may be a logic error in the code');
                this.logger.error(`   Full error object: ${JSON.stringify(error, null, 2)}`);
                this.logger.error(`   Full error with getOwnPropertyNames: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`);
            }
            
            // Fallback: return cached data if available
            if (this.playerData.length > 0) {
                this.logger.info(`📋 Using cached player data (${this.playerData.length} players)`);
                return this.playerData;
            }
            
            return [];
        }
    }

    getPlayerData() {
        return this.playerData;
    }

    getDataAge() {
        if (!this.lastFetchTime) return null;
        const now = new Date();
        const ageMs = now - this.lastFetchTime;
        const ageMinutes = Math.floor(ageMs / (1000 * 60));
        return ageMinutes;
    }

    findPlayerByName(playerName, threshold = 0.6) {
        if (!playerName || this.playerData.length === 0) {
            return null;
        }

        // Use original name with minimal cleaning (only trim and lowercase)
        const searchInput = playerName.trim().toLowerCase();
        this.logger.info(`🔍 Searching for player: "${playerName}"`);

        // Search for players by name using multiple matching strategies
        const matches = [];
        
        for (const player of this.playerData) {
            // Compare with original player name (minimal cleaning)
            const playerNameLower = player.name.toLowerCase();
            let similarity = 0;
            let matchType = '';
            
            // 1. Exact match (highest priority)
            if (playerNameLower === searchInput) {
                similarity = 1.0;
                matchType = 'exact';
            } 
            // 2. Starts with search term
            else if (playerNameLower.startsWith(searchInput)) {
                similarity = 0.9;
                matchType = 'starts_with';
            }
            // 3. Contains search term
            else if (playerNameLower.includes(searchInput)) {
                similarity = 0.8;
                matchType = 'contains';
            }
            // 4. Search term contains player name (for short player names)
            else if (searchInput.includes(playerNameLower) && playerNameLower.length >= 3) {
                similarity = 0.7;
                matchType = 'reverse_contains';
            }
            // 5. Levenshtein similarity (for typos) - use cleaned names for fuzzy matching only
            else {
                const cleanInput = this.cleanPlayerName(playerName);
                const cleanPlayerName = player.cleanName.toLowerCase();
                const levenshteinSim = this.calculateSimilarity(cleanInput, cleanPlayerName);
                if (levenshteinSim >= threshold) {
                    similarity = levenshteinSim * 0.6; // Reduce weight
                    matchType = 'fuzzy';
                }
            }
            
            if (similarity >= 0.8) { // Only show matches 80% and above
                matches.push({
                    player: player,
                    similarity: similarity,
                    matchType: matchType
                });
            }
        }

        return matches;
    }

    findPlayerById(playerId) {
        if (!playerId || this.playerData.length === 0) {
            return null;
        }

        const player = this.playerData.find(p => p.id === parseInt(playerId));
        if (player) {
            return player;
        }

        this.logger.info(`❌ No player found with ID: ${playerId}`);
        return null;
    }

    getAllPlayers() {
        return this.playerData.map(player => ({
            id: player.id,
            name: player.name,
            guildName: player.guildName,
            relicCores: player.relicCores,
            attack: player.attack,
            health: player.health,
            level: player.level,
            rank: player.rank
        }));
    }

    getTopPlayers(limit = 10) {
        return this.playerData
            .sort((a, b) => a.rank - b.rank) // Sort by rank (lower number = higher rank)
            .slice(0, limit)
            .map(player => ({
                id: player.id,
                name: player.name,
                guildName: player.guildName,
                relicCores: player.relicCores,
                attack: player.attack,
                health: player.health,
                level: player.level,
                rank: player.rank
            }));
    }

    cleanPlayerName(name) {
        if (!name) return '';
        
        return name
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uAC00-\uD7AF\u0100-\u017F\u0180-\u024F]/g, '')
            .toLowerCase();
    }

    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        if (str1 === str2) return 1.0;
        
        // Długość podobieństwa
        const distance = this.levenshteinDistance(str1, str2);
        const maxLen = Math.max(str1.length, str2.length);
        
        if (maxLen === 0) return 1.0;
        
        const similarity = Math.max(0, 1 - (distance / maxLen));
        
        // Bonus za zawieranie podciągu
        if (str1.includes(str2) || str2.includes(str1)) {
            const minLen = Math.min(str1.length, str2.length);
            const lengthBonus = minLen / maxLen * 0.2; // max 20% bonus
            return Math.min(1.0, similarity + lengthBonus);
        }
        
        return similarity;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        // Initialize matrix
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        // Calculate distances
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    getStats() {
        if (this.playerData.length === 0) {
            return {
                totalPlayers: 0,
                lastUpdate: null,
                dataAge: null
            };
        }

        const totalLevels = this.playerData.reduce((sum, player) => sum + (player.level || 0), 0);
        const averageLevel = totalLevels / this.playerData.length;

        return {
            totalPlayers: this.playerData.length,
            averageLevel: Math.round(averageLevel * 10) / 10,
            lastUpdate: this.lastFetchTime,
            dataAge: this.getDataAge()
        };
    }
}

module.exports = PlayerService;