const axios = require('axios');
const cheerio = require('cheerio');

class ClanAjaxService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.clanData = [];
        this.lastFetchTime = null;
        
        // Create axios instance for AJAX requests
        this.axios = axios.create({
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
    }

    async fetchClanData() {
        try {
            this.logger.info('📊 Fetching clan ranking data from AJAX API...');
            
            // First, get the main page to establish session
            const sessionResponse = await this.axios.get('https://garrytools.com/rank/clans', {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
                }
            });
            
            // Extract cookies from the session
            const cookies = sessionResponse.headers?.['set-cookie']?.map(cookie => cookie.split(';')[0]).join('; ') || '';
            
            // Try to get data through AJAX (this might require specific parameters)
            // For now, let's try a different approach - check if there's a direct API
            
            // Alternative: Check if clan data is available in a different format
            const response = await this.axios.get('https://garrytools.com/rank/clans', {
                headers: {
                    'Cookie': cookies,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            if (response.data && typeof response.data === 'string') {
                // Parse HTML response with cheerio
                const $ = cheerio.load(response.data);
                const clans = [];
                
                // Check if data is now loaded in the page (sometimes after session is established)
                $('table tbody tr').each((index, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 6) {
                        const rank = parseInt($(cells[0]).text().trim()) || 0;
                        const guildId = parseInt($(cells[1]).text().trim()) || 0;
                        const name = $(cells[2]).text().trim();
                        const level = parseInt($(cells[3]).text().trim()) || 1;
                        const members = $(cells[4]).text().trim();
                        const leader = $(cells[5]).text().trim();
                        const grade = cells.length > 6 ? $(cells[6]).text().trim() : '';
                        const score = cells.length > 7 ? parseInt($(cells[7]).text().trim()) || 0 : 0;
                        
                        if (name && guildId > 0) {
                            clans.push({
                                id: guildId,
                                name: name,
                                level: level,
                                members: members,
                                leader: leader,
                                grade: grade,
                                score: score,
                                rank: rank,
                                cleanName: this.cleanGuildName(name)
                            });
                        }
                    }
                });
                
                if (clans.length > 0) {
                    this.clanData = clans;
                    this.lastFetchTime = new Date();
                    this.logger.info(`✅ Fetched ${clans.length} clans from ranking page`);
                    return this.clanData;
                } else {
                    this.logger.warn('⚠️ No clan data found in HTML - table may be loaded dynamically');
                    
                    // TEMPORARY SOLUTION: Return fallback message for now
                    // In the future, we need to implement proper AJAX handling or find alternative endpoint
                    throw new Error('Clan ranking data is loaded dynamically and requires JavaScript execution. This feature is temporarily unavailable.');
                }
            } else {
                this.logger.warn('⚠️ Invalid API response format for clan data');
                return [];
            }
        } catch (error) {
            this.logger.error('❌ Error fetching clan ranking data:', error.message);
            this.logger.error('   Error details:', error.stack || 'No stack trace available');
            this.logger.error('   Response status:', error.response ? error.response.status : 'No response');
            
            // Fallback: return cached data if available
            if (this.clanData.length > 0) {
                this.logger.info(`📋 Using cached clan data (${this.clanData.length} clans)`);
                return this.clanData;
            }
            
            return [];
        }
    }

    getClanData() {
        return this.clanData;
    }

    getDataAge() {
        if (!this.lastFetchTime) return null;
        const now = new Date();
        const ageMs = now - this.lastFetchTime;
        const ageMinutes = Math.floor(ageMs / (1000 * 60));
        return ageMinutes;
    }

    findGuildByName(guildName, threshold = 0.6) {
        if (!guildName || this.clanData.length === 0) {
            return null;
        }

        const cleanInput = this.cleanGuildName(guildName);
        this.logger.info(`🔍 Searching for guild: "${guildName}" (cleaned: "${cleanInput}")`);

        // Exact match first
        for (const clan of this.clanData) {
            if (clan.cleanName === cleanInput) {
                return clan;
            }
        }

        // Similarity matching
        let bestMatch = null;
        let bestSimilarity = 0;

        for (const clan of this.clanData) {
            const similarity = this.calculateSimilarity(cleanInput, clan.cleanName);
            
            if (similarity >= threshold && similarity > bestSimilarity) {
                bestMatch = clan;
                bestSimilarity = similarity;
            }
        }

        if (bestMatch) {
            return bestMatch;
        }

        this.logger.info(`❌ No guild found matching "${guildName}" (threshold: ${(threshold * 100)}%)`);
        return null;
    }

    findGuildById(guildId) {
        if (!guildId || this.clanData.length === 0) {
            return null;
        }

        const clan = this.clanData.find(c => c.id === parseInt(guildId));
        if (clan) {
            return clan;
        }

        this.logger.info(`❌ No guild found with ID: ${guildId}`);
        return null;
    }

    getAllGuilds() {
        return this.clanData.map(clan => ({
            id: clan.id,
            name: clan.name,
            level: clan.level,
            members: clan.members,
            score: clan.score,
            rank: clan.rank
        }));
    }

    getTopGuilds(limit = 10) {
        return this.clanData
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, limit)
            .map(clan => ({
                id: clan.id,
                name: clan.name,
                level: clan.level,
                members: clan.members,
                score: clan.score,
                rank: clan.rank
            }));
    }

    cleanGuildName(name) {
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
        if (this.clanData.length === 0) {
            return {
                totalGuilds: 0,
                lastUpdate: null,
                dataAge: null
            };
        }

        const totalMembers = this.clanData.reduce((sum, clan) => sum + (clan.members || 0), 0);
        const totalScore = this.clanData.reduce((sum, clan) => sum + (clan.score || 0), 0);
        const averageLevel = this.clanData.reduce((sum, clan) => sum + (clan.level || 0), 0) / this.clanData.length;

        return {
            totalGuilds: this.clanData.length,
            totalMembers: totalMembers,
            totalScore: totalScore,
            averageLevel: Math.round(averageLevel * 10) / 10,
            lastUpdate: this.lastFetchTime,
            dataAge: this.getDataAge()
        };
    }
}

module.exports = ClanAjaxService;