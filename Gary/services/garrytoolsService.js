const axios = require('axios');
const cheerio = require('cheerio');
// const ProxyService = require('./proxyService'); // Temporarily disabled

class GarrytoolsService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.baseUrl = 'https://garrytools.com/lunar/';
        // this.proxyService = new ProxyService(config, logger); // Temporarily disabled
        
        // Create default axios instance (fallback)
        this.axiosInstance = axios.create({
            timeout: config.lunarMineSettings?.connectionTimeout || 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Cache-Control': 'max-age=0'
            }
        });
    }

    modifyGuildIds(userGuildId, fixedGuilds) {
        this.logger.info(`🔧 Modifying Guild ID: user=${userGuildId}, fixed=${fixedGuilds.join(', ')}`);
        
        // Check if userGuildId is in fixedGuilds
        if (fixedGuilds.includes(userGuildId)) {
            // Find index of userGuildId in fixedGuilds
            const idx = fixedGuilds.indexOf(userGuildId);
            
            // Create new list: [userGuildId, ...rest from fixedGuilds but with 54134 in place of userGuildId]
            const newGuilds = [userGuildId];
            
            for (let i = 0; i < fixedGuilds.length; i++) {
                if (i === idx) {
                    newGuilds.push(54134); // Replace position where userGuildId was
                } else {
                    newGuilds.push(fixedGuilds[i]);
                }
            }
            
            this.logger.info(`✅ Modified Guild ID: ${newGuilds.join(', ')}`);
            return newGuilds;
        } else {
            // If userGuildId is not in fixedGuilds, use standard logic
            const result = [userGuildId, ...fixedGuilds];
            this.logger.info(`✅ Standard Guild ID logic: ${result.join(', ')}`);
            return result;
        }
    }

    async getGroupId(guildIds) {
        if (!Array.isArray(guildIds) || guildIds.length !== 4) {
            throw new Error('Exactly 4 Guild IDs are required');
        }
        
        this.logger.info(`🔍 Processing Guild IDs: ${guildIds.join(', ')}`);
        
        try {
            // Use proxy service for requests
            const mainPageResponse = await this.axiosInstance.get(this.baseUrl);
            const $ = cheerio.load(mainPageResponse.data);
            
            const forms = $('form');
            if (forms.length === 0) {
                throw new Error('No form found on Lunar Details page');
            }
            
            const inputs = $('input[type!="hidden"]');
            const fieldNames = [];
            inputs.each((i, input) => {
                const name = $(input).attr('name');
                if (name) {
                    fieldNames.push(name);
                }
            });
            
            if (fieldNames.length < 4) {
                throw new Error(`Found only ${fieldNames.length} form fields, required 4`);
            }
            
            const formData = new URLSearchParams();
            for (let i = 0; i < 4 && i < fieldNames.length; i++) {
                formData.append(fieldNames[i], guildIds[i].toString());
            }
            
            $('input[type="hidden"]').each((i, element) => {
                const name = $(element).attr('name');
                const value = $(element).attr('value');
                if (name && value) {
                    formData.append(name, value);
                }
            });
            
            const csrfToken = $('meta[name="csrf-token"]').attr('content');
            if (csrfToken) {
                formData.append('_token', csrfToken);
            }
            
            const response = await this.axiosInstance.post(this.baseUrl, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': this.baseUrl,
                    'Origin': 'https://garrytools.com'
                },
                maxRedirects: 10,
                validateStatus: (status) => status < 500
            });

            const finalUrl = response.request.res.responseUrl || response.config.url;
            let groupId = this.extractGroupIdFromUrl(finalUrl);
            if (groupId) {
                return groupId;
            }
            
            if (response.headers.location) {
                groupId = this.extractGroupIdFromUrl(response.headers.location);
                if (groupId) {
                    return groupId;
                }
            }
            
            const responseHtml = cheerio.load(response.data);
            const detailLink = responseHtml('a[href*="/detail/"]').first().attr('href');
            if (detailLink) {
                groupId = this.extractGroupIdFromUrl(detailLink);
                if (groupId) {
                    return groupId;
                }
            }
            
            const tempId = this.generateTempGroupId(guildIds);
            return tempId;
            
        } catch (error) {
            throw new Error(`Error retrieving Group ID: ${error.message}`);
        }
    }

    extractGroupIdFromUrl(text) {
        if (!text) return null;
        const match = text.match(/detail\/(\d{6})/);
        return match ? match[1] : null;
    }

    generateTempGroupId(guildIds) {
        const combined = guildIds.join('');
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            hash = ((hash << 5) - hash + combined.charCodeAt(i)) & 0xffffff;
        }
        return String(Math.abs(hash) % 900000 + 100000);
    }

    async fetchGroupDetails(groupId) {
        const baseUrl = `${this.baseUrl}detail/${groupId}`;
        const coreUrl = `${baseUrl}?type=core`;
        
        try {
            const [baseData, coreData] = await Promise.all([
                this.getBaseData(baseUrl),
                this.getCoreData(coreUrl)
            ]);
            
            if (baseData.length === 0) {
                throw new Error('No data found in main table');
            }
            
            const mergedData = this.mergeData(baseData, coreData);
            return { guilds: mergedData };
            
        } catch (error) {
            throw new Error(`Error fetching details: ${error.message}`);
        }
    }

    async getBaseData(url) {
        try {
            const response = await this.axiosInstance.get(url);
            const $ = cheerio.load(response.data);
            const tables = $('table');
            const clansData = [];
            
            if (tables.length === 0) {
                return [];
            }
            
            const mainTable = $(tables[0]);
            const clanOverview = [];
            
            mainTable.find('tr').each((index, row) => {
                if (index === 0) return;
                
                const cells = $(row).find('td');
                if (cells.length < 8) return;
                
                const clanInfo = {
                    rank: $(cells[0]).text().trim(),
                    guildId: parseInt($(cells[1]).text().trim()) || 0,
                    name: $(cells[2]).text().trim(),
                    level: $(cells[3]).text().trim(),
                    grade: $(cells[4]).text().trim(),
                    gradeScore: $(cells[5]).text().trim(),
                    extraBossDamage: $(cells[6]).text().trim() || '0%',
                    totalRelicCores: this.parseRelicCores($(cells[7]).text().trim()),
                    totalAttack: this.parseAttackValue($(cells[8]).text().trim())
                };
                
                clanOverview.push(clanInfo);
            });
            
            for (let i = 1; i < tables.length; i++) {
                const table = $(tables[i]);
                const members = [];
                
                table.find('tr').each((rowIndex, row) => {
                    if (rowIndex === 0) return;
                    
                    const cells = $(row).find('td');
                    if (cells.length >= 3) {
                        const rank = $(cells[0]).text().trim();
                        const name = $(cells[1]).text().trim();
                        const attack = this.parseAttackValue($(cells[2]).text().trim());
                        
                        members.push({
                            rank: rank,
                            name: name,
                            attack: attack,
                            relicCores: 0
                        });
                    }
                });
                
                if (members.length > 0) {
                    const clanInfo = clanOverview[i-1] || {};
                    
                    clansData.push({
                        title: clanInfo.name || `Guild ${i}`,
                        members: members,
                        totalPower: clanInfo.totalAttack || 0,
                        totalRelicCores: clanInfo.totalRelicCores || 0,
                        rank: clanInfo.rank || '',
                        level: clanInfo.level || '',
                        grade: clanInfo.grade || '',
                        guildId: clanInfo.guildId || 0,
                        extraBossDamage: clanInfo.extraBossDamage || '0%',
                        phase: 'Lunar Mine Expedition',
                        points: parseInt(clanInfo.gradeScore) || 0,
                        status: 'Active'
                    });
                }
            }
            
            return clansData;
        } catch (error) {
            this.logger.error('Error fetching base data:', error.message);
            return [];
        }
    }

    async getCoreData(url) {
        try {
            const response = await this.axiosInstance.get(url);
            const $ = cheerio.load(response.data);
            const tables = $('table');
            const clansData = [];
            
            for (let i = 1; i < tables.length; i++) {
                const table = $(tables[i]);
                const members = [];
                
                table.find('tr').each((rowIndex, row) => {
                    if (rowIndex === 0) return;
                    
                    const cells = $(row).find('td');
                    if (cells.length >= 3) {
                        const rank = $(cells[0]).text().trim();
                        const name = $(cells[1]).text().trim();
                        const relicCores = this.parseRelicCores($(cells[2]).text().trim());
                        
                        members.push({
                            rank: rank,
                            name: name,
                            relicCores: relicCores
                        });
                    }
                });
                
                if (members.length > 0) {
                    clansData.push({
                        members: members
                    });
                }
            }
            
            return clansData;
        } catch (error) {
            this.logger.error('Error fetching Relic Cores data:', error.message);
            return [];
        }
    }

    mergeData(baseData, coreData) {
        const mergedData = [];
        
        for (let i = 0; i < baseData.length; i++) {
            const baseClan = baseData[i];
            const coreClan = coreData[i] || { members: [] };
            
            const mergedMembers = this.mergeClansMembers(baseClan.members, coreClan.members);
            
            mergedData.push({
                ...baseClan,
                members: mergedMembers
            });
        }
        
        return mergedData;
    }

    mergeClansMembers(baseMembers, coreMembers) {
        const mergedMembers = [];
        
        for (const baseMember of baseMembers) {
            const matchingCoreMember = this.findPlayerByName(baseMember.name, coreMembers);
            
            if (matchingCoreMember) {
                mergedMembers.push({
                    rank: baseMember.rank,
                    name: baseMember.name,
                    attack: baseMember.attack,
                    relicCores: matchingCoreMember.relicCores
                });
            } else {
                mergedMembers.push({
                    rank: baseMember.rank,
                    name: baseMember.name,
                    attack: baseMember.attack,
                    relicCores: 0
                });
            }
        }
        
        return mergedMembers;
    }

    findPlayerByName(searchName, coreMembers) {
        if (!searchName || !coreMembers || coreMembers.length === 0) {
            return null;
        }
        
        const cleanSearchName = this.cleanPlayerName(searchName);
        
        for (const coreMember of coreMembers) {
            const cleanCoreName = this.cleanPlayerName(coreMember.name);
            if (cleanSearchName === cleanCoreName) {
                return coreMember;
            }
        }
        
        for (const coreMember of coreMembers) {
            const similarity = this.calculateNameSimilarity(searchName, coreMember.name);
            if (similarity >= 0.9) {
                return coreMember;
            }
        }
        
        for (const coreMember of coreMembers) {
            const cleanCoreName = this.cleanPlayerName(coreMember.name);
            if (cleanSearchName.includes(cleanCoreName) || cleanCoreName.includes(cleanSearchName)) {
                const minLen = Math.min(cleanSearchName.length, cleanCoreName.length);
                const maxLen = Math.max(cleanSearchName.length, cleanCoreName.length);
                if (minLen / maxLen >= 0.7) {
                    return coreMember;
                }
            }
        }
        
        return null;
    }

    cleanPlayerName(name) {
        if (!name) return '';
        
        return name
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[ㅣ|]/g, '')
            .replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uAC00-\uD7AF\u0100-\u017F\u0180-\u024F]/g, '')
            .toLowerCase();
    }

    calculateNameSimilarity(name1, name2) {
        if (!name1 || !name2) return 0;
        
        const clean1 = this.cleanPlayerName(name1);
        const clean2 = this.cleanPlayerName(name2);
        
        if (clean1 === clean2) return 1.0;
        if (clean1.length === 0 || clean2.length === 0) return 0;
        
        const distance = this.levenshteinDistance(clean1, clean2);
        const maxLen = Math.max(clean1.length, clean2.length);
        
        return Math.max(0, 1 - (distance / maxLen));
    }

    levenshteinDistance(str1, str2) {
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

    parseAttackValue(value) {
        if (!value || value === '-') return 0;
        
        const stringValue = value.toString().trim();
        const cleanValue = stringValue.replace(/[^\d.,MKmk]/g, '');
        
        if (!cleanValue) return 0;
        
        const hasM = /[Mm]/.test(cleanValue);
        const hasK = /[Kk]/.test(cleanValue);
        
        let numericPart = cleanValue.replace(/[MKmk]/g, '');
        
        if (numericPart.includes('.')) {
            const parts = numericPart.split('.');
            
            if (parts.length === 2) {
                if (parts[1].length === 3 && !numericPart.includes(',')) {
                    numericPart = parts.join('');
                } else if (parts[1].length <= 2) {
                    numericPart = numericPart;
                } else {
                    numericPart = parts.join('');
                }
            } else if (parts.length > 2) {
                numericPart = parts.join('');
            }
        }
        
        if (numericPart.includes(',')) {
            numericPart = numericPart.replace(',', '.');
        }
        
        const parsedNumber = parseFloat(numericPart);
        if (isNaN(parsedNumber)) return 0;
        
        let result = parsedNumber;
        if (hasM) {
            result = Math.round(parsedNumber * 1000000);
        } else if (hasK) {
            result = Math.round(parsedNumber * 1000);
        } else {
            result = Math.round(parsedNumber);
        }
        
        return result;
    }

    parseRelicCores(value) {
        if (!value || value === '-') return 0;
        const cleanValue = value.toString().replace(/[^\d]/g, '');
        return parseInt(cleanValue) || 0;
    }

    async processMultipleGuilds(guildIds) {
        try {
            this.logger.info(`🔍 Processing Guild IDs: ${guildIds.join(', ')}`);
            
            const groupId = await this.getGroupId(guildIds);
            this.logger.info(`✅ Group ID generated: ${groupId}`);
            
            const result = await this.fetchGroupDetails(groupId);
            this.logger.info(`📊 Found ${result.guilds.length} guilds`);
            
            return result.guilds;
            
        } catch (error) {
            this.logger.error('Error processing guilds:', error.message);
            throw new Error(`Multiple guilds processing failed: ${error.message}`);
        }
    }

    async analyzeSingleGuild(userGuildId) {
        this.logger.info(`🔍 Analyzing Guild ID: ${userGuildId} with substitution logic`);
        
        try {
            const fixedGuilds = [42576, 42566, 42575, 42560];
            const modifiedGuilds = this.modifyGuildIds(userGuildId, fixedGuilds);
            
            const groupId = await this.getGroupId(modifiedGuilds);
            this.logger.info(`✅ Group ID generated: ${groupId}`);
            
            const result = await this.fetchGroupDetails(groupId);
            this.logger.info(`📊 Found ${result.guilds.length} guilds`);
            
            return result;
        } catch (error) {
            this.logger.error(`❌ Error during Guild ID ${userGuildId} analysis:`, error.message);
            throw new Error(`Guild ID ${userGuildId} analysis failed: ${error.message}`);
        }
    }
}

module.exports = GarrytoolsService;