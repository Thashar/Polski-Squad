const axios = require('axios');
const cheerio = require('cheerio');
const ProxyService = require('./proxyService');

class EndersEchoService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.endersEchoData = [];
        this.lastFetchTime = null;
        // EndersEchoService uses proxy as fallback when receiving 403 errors
        this.proxyService = new ProxyService(config, logger);
        this.dateColumns = []; // Store dynamic date column names
        
        // Create direct axios instance for basic operations (no proxy)
        this.axios = axios.create({
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
    }

    async fetchEndersEchoData() {
        try {
            this.logger.info('🏆 Fetching EndersEcho ranking data from API...');

            // Anti-Cloudflare: najpierw spróbuj uzyskać session przez stronę główną
            try {
                this.logger.info('🔑 Uzyskiwanie sesji przez stronę główną...');
                await this.proxyService.makeRequest('https://garrytools.com/');
                // Krótka pauza po uzyskaniu sesji
                await new Promise(resolve => setTimeout(resolve, 1200));
            } catch (sessionError) {
                this.logger.warn('⚠️ Nie udało się uzyskać sesji, próbuję bezpośrednio...');
            }

            let response;
            // Użyj ulepszonego ProxyService z automatyczną obsługą 403 i losowym wyborem proxy
            response = await this.proxyService.makeRequest('https://garrytools.com/rank/enderecho');
            
            if (response.data && typeof response.data === 'string' && response.data.length > 0) {
                // Parse HTML response with cheerio
                const $ = cheerio.load(response.data);
                const players = [];
                this.dateColumns = []; // Reset date columns

                // Debug: sprawdź co faktycznie otrzymujemy
                this.logger.info(`🔍 DEBUG EE: Response size: ${response.data.length} characters`);
                this.logger.info(`🔍 DEBUG EE: Found ${$('table').length} tables`);
                this.logger.info(`🔍 DEBUG EE: Found ${$('table tr').length} table rows`);
                this.logger.info(`🔍 DEBUG EE: First 500 chars: ${response.data.substring(0, 500)}`);

                // Find the ranking table and extract headers first
                const headerRow = $('table tr').first();
                const headers = [];
                headerRow.find('th, td').each((index, cell) => {
                    const headerText = $(cell).text().trim();
                    headers.push(headerText);
                    
                    // Check if this looks like a date column (contains dots, numbers)
                    if (headerText.match(/\d{2}\.\d{2}\.\d{4}/)) {
                        this.dateColumns.push(headerText);
                    }
                });
                
                // Keep date columns in the order they appear in the table
                // No sorting - first column = Day 1, second = Day 2, etc.
                
                this.logger.info(`📅 Found ${this.dateColumns.length} date columns: ${this.dateColumns.join(', ')}`);
                
                // Extract data from each row (skip header)
                $('table tr').each((index, row) => {
                    if (index === 0) return; // Skip header row
                    
                    const cells = $(row).find('td');
                    if (cells.length >= 5) { // At least rank, id, name, guild, best score
                        const rank = parseInt($(cells[0]).text().trim()) || 0;
                        const playerId = parseInt($(cells[1]).text().trim()) || 0;
                        const name = $(cells[2]).text().trim();
                        const guildName = $(cells[3]).text().trim();
                        
                        // Extract all scores (from index 4 onwards)
                        const allScores = [];
                        for (let i = 4; i < cells.length; i++) {
                            const score = $(cells[i]).text().trim();
                            allScores.push(score || '-');
                        }
                        
                        // Last column is Best Score (All Time)
                        const bestScore = allScores[allScores.length - 1] || '-';
                        
                        // Middle columns are date scores (in order: Day 1, Day 2, Day 3...)
                        const dateScores = allScores.slice(0, -1); // All except last
                        // Don't reverse - keep natural order: first date column = Day 1
                        
                        // Ensure we have the right number of date scores
                        while (dateScores.length < this.dateColumns.length) {
                            dateScores.push('-');
                        }
                        
                        if (name && playerId > 0) {
                            players.push({
                                id: playerId,
                                name: name,
                                guildName: guildName,
                                bestScore: bestScore,
                                dateScores: dateScores, // Array of scores for each date
                                rank: rank,
                                cleanName: this.cleanPlayerName(name)
                            });
                        }
                    }
                });
                
                this.endersEchoData = players;
                this.lastFetchTime = new Date();
                return this.endersEchoData;
            } else {
                this.logger.warn('⚠️ Invalid API response format for EndersEcho data');
                this.logger.warn(`🔍 DEBUG EE: Response type: ${typeof response.data}`);
                this.logger.warn(`🔍 DEBUG EE: Response length: ${response.data ? response.data.length : 'null'}`);
                this.logger.warn(`🔍 DEBUG EE: Response status: ${response.status}`);
                this.logger.warn(`🔍 DEBUG EE: Response headers: ${JSON.stringify(response.headers)}`);
                this.logger.warn(`🔍 DEBUG EE: Response data preview: ${JSON.stringify(response.data).substring(0, 200)}`);
                return [];
            }
        } catch (error) {
            this.logger.error(`❌ Error fetching EndersEcho ranking data: ${error.message || 'Unknown error'}`);
            this.logger.error(`   Error type: ${error.constructor?.name || 'Unknown constructor'}`);
            this.logger.error(`   Error code: ${error.code || 'No error code'}`);
            this.logger.error(`   Error details: ${error.stack || 'No stack trace available'}`);
            this.logger.error(`   Response status: ${error.response ? error.response.status : 'No response'}`);
            this.logger.error(`   Response data: ${error.response ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : JSON.stringify(error.response.data)) : 'No response data'}`);
            
            // Check if this is actually not an error but some other issue
            if (!error.message && !error.code && !error.response) {
                this.logger.error('   ⚠️ Empty error object - this may be a logic error in the code');
                this.logger.error(`   Full error object: ${JSON.stringify(error, null, 2)}`);
            }
            
            // Fallback: return cached data if available
            if (this.endersEchoData.length > 0) {
                this.logger.info(`📋 Using cached EndersEcho data (${this.endersEchoData.length} players)`);
                return this.endersEchoData;
            }
            
            return [];
        }
    }

    getEndersEchoData() {
        return this.endersEchoData;
    }

    getDateColumns() {
        return this.dateColumns;
    }

    getDataAge() {
        if (!this.lastFetchTime) return null;
        const now = new Date();
        const ageMs = now - this.lastFetchTime;
        const ageMinutes = Math.floor(ageMs / (1000 * 60));
        return ageMinutes;
    }

    findPlayerByName(playerName, threshold = 0.6) {
        if (!playerName || this.endersEchoData.length === 0) {
            return [];
        }

        // Use original name with minimal cleaning (only trim and lowercase)
        const searchInput = playerName.trim().toLowerCase();
        this.logger.info(`🔍 Searching for EndersEcho player: "${playerName}"`);

        // Search for players by name using multiple matching strategies
        const matches = [];
        
        for (const player of this.endersEchoData) {
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
        if (!playerId || this.endersEchoData.length === 0) {
            return null;
        }

        const player = this.endersEchoData.find(p => p.id === parseInt(playerId));
        if (player) {
            return player;
        }

        this.logger.info(`❌ No EndersEcho player found with ID: ${playerId}`);
        return null;
    }

    getAllPlayers() {
        return this.endersEchoData.map(player => ({
            id: player.id,
            name: player.name,
            guildName: player.guildName,
            bestScore: player.bestScore,
            dateScores: player.dateScores,
            rank: player.rank
        }));
    }

    getTopPlayers(limit = 10) {
        return this.endersEchoData
            .sort((a, b) => a.rank - b.rank) // Sort by rank (lower number = higher rank)
            .slice(0, limit)
            .map(player => ({
                id: player.id,
                name: player.name,
                guildName: player.guildName,
                bestScore: player.bestScore,
                dateScores: player.dateScores,
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
        if (this.endersEchoData.length === 0) {
            return {
                totalPlayers: 0,
                totalDateColumns: 0,
                lastUpdate: null,
                dataAge: null
            };
        }

        return {
            totalPlayers: this.endersEchoData.length,
            totalDateColumns: this.dateColumns.length,
            dateColumns: this.dateColumns,
            lastUpdate: this.lastFetchTime,
            dataAge: this.getDataAge()
        };
    }
}

module.exports = EndersEchoService;