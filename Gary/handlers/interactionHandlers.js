const { EmbedBuilder, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { hasPermission, formatNumber, generatePaginationId, isAllowedChannel } = require('../utils/helpers');

class InteractionHandler {
    constructor(config, garrytoolsService, clanService, logService, logger) {
        this.config = config;
        this.garrytoolsService = garrytoolsService;
        this.clanService = clanService;
        this.logService = logService;
        this.logger = logger;
        
        this.paginationData = new Map();
        this.CORES_ICON = 'RC';
        this.FIXED_GUILDS = [10256, 12554, 20145];
        
        // Define slash commands
        this.commands = [
            new SlashCommandBuilder()
                .setName('lunarmine')
                .setDescription('Analyzes 4 guilds during Lunar Mine Expedition in Survivor.io')
                .addIntegerOption(option =>
                    option.setName('guild1')
                        .setDescription('First guild ID')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(999999))
                .addIntegerOption(option =>
                    option.setName('guild2')
                        .setDescription('Second guild ID')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(999999))
                .addIntegerOption(option =>
                    option.setName('guild3')
                        .setDescription('Third guild ID')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(999999))
                .addIntegerOption(option =>
                    option.setName('guild4')
                        .setDescription('Fourth guild ID')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(999999)),
                
            new SlashCommandBuilder()
                .setName('refresh')
                .setDescription('Refreshes guild data from ranking table'),
                
            new SlashCommandBuilder()
                .setName('analyse')
                .setDescription('Analyzes a single guild during Lunar Expedition (+ 3 fixed guilds)')
                .addIntegerOption(option =>
                    option.setName('guildid')
                        .setDescription('Guild ID to analyze')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(999999)),
                        
            new SlashCommandBuilder()
                .setName('search')
                .setDescription('Search for guilds by name from cached ranking data')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Guild name to search for (minimum 3 characters)')
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(50)),
                        
            new SlashCommandBuilder()
                .setName('proxy-test')
                .setDescription('Test all configured proxies (Admin only)'),
                
            new SlashCommandBuilder()
                .setName('proxy-stats')
                .setDescription('Show proxy configuration and statistics (Admin only)')
        ];
    }

    async registerSlashCommands(client) {
        const rest = new REST({ version: '10' }).setToken(this.config.token);
        
        try {
            this.logger.info('🔄 Registering slash commands...');
            
            const data = await rest.put(
                Routes.applicationCommands(this.config.clientId),
                { body: this.commands.map(command => command.toJSON()) }
            );
            
            this.logger.info(`✅ Registered ${data.length} slash commands!`);
        } catch (error) {
            this.logger.error('❌ Error registering commands:', error);
        }
    }

    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

        // Handle pagination buttons
        if (interaction.isButton()) {
            return await this.handleButtonInteraction(interaction);
        }

        // Check allowed channel
        if (!isAllowedChannel(interaction, this.config.allowedChannelIds)) {
            await interaction.reply({ 
                content: '❌ This command can only be used in the designated channel!', 
                ephemeral: true 
            });
            return;
        }

        const { commandName } = interaction;
        
        // Check permissions for admin-only commands
        const adminOnlyCommands = ['lunarmine', 'refresh', 'proxy-stats', 'proxy-test', 'analyse'];
        if (adminOnlyCommands.includes(commandName) && !hasPermission(interaction, this.config.authorizedRoles)) {
            await interaction.reply({ 
                content: '❌ You do not have permission to use this command!', 
                ephemeral: true 
            });
            return;
        }
        
        try {
            await this.logService.logCommand(interaction, commandName);

            switch (commandName) {
                case 'lunarmine':
                    await this.handleLunarMineCommand(interaction);
                    break;
                    
                case 'refresh':
                    await this.handleRefreshCommand(interaction);
                    break;
                    
                case 'analyse':
                    await this.handleAnalyseCommand(interaction);
                    break;
                    
                case 'search':
                    await this.handleSearchCommand(interaction);
                    break;
                    
                case 'proxy-test':
                    await this.handleProxyTestCommand(interaction);
                    break;
                    
                case 'proxy-stats':
                    await this.handleProxyStatsCommand(interaction);
                    break;
            }
        } catch (error) {
            await this.logService.logError(error, `command ${commandName}`);
            if (!interaction.replied) {
                await interaction.reply('❌ An error occurred while executing the command.');
            }
        }
    }

    async handleButtonInteraction(interaction) {
        if (!hasPermission(interaction, this.config.authorizedRoles)) {
            await interaction.reply({ 
                content: '❌ You do not have permission to use buttons!', 
                ephemeral: true 
            });
            return;
        }
        
        const buttonId = interaction.customId;
        if (!buttonId.includes('::')) {
            await interaction.reply({ 
                content: '❌ Unknown button!', 
                ephemeral: true 
            });
            return;
        }
        
        const [action, paginationId] = buttonId.split('::', 2);
        
        if (!paginationId || !this.paginationData.has(paginationId)) {
            await interaction.reply({ 
                content: '❌ Pagination data expired or invalid. Please use the command again.', 
                ephemeral: true 
            });
            return;
        }
        
        const pageData = this.paginationData.get(paginationId);
        
        if (pageData.userId !== interaction.user.id) {
            await interaction.reply({ 
                content: '❌ Only the person who ran the command can change pages!', 
                ephemeral: true 
            });
            return;
        }
        
        let newPage = pageData.currentPage;
        
        if (action === 'prev' && newPage > 0) {
            newPage--;
        } else if (action === 'next' && newPage < pageData.totalPages - 1) {
            newPage++;
        } else if (action === 'page') {
            await interaction.deferUpdate();
            return;
        } else {
            await interaction.reply({ 
                content: '❌ Invalid pagination operation!', 
                ephemeral: true 
            });
            return;
        }
        
        pageData.currentPage = newPage;
        this.paginationData.set(paginationId, pageData);
        
        const newEmbed = this.createPaginatedMemberEmbed(
            pageData.guild, 
            pageData.members, 
            newPage, 
            pageData.totalPages, 
            paginationId
        );
        const newButtons = this.createNavigationButtons(newPage, pageData.totalPages, paginationId);
        
        await interaction.update({ 
            embeds: [newEmbed], 
            components: [newButtons] 
        });
    }

    async handleLunarMineCommand(interaction) {
        const guild1 = interaction.options.getInteger('guild1');
        const guild2 = interaction.options.getInteger('guild2');
        const guild3 = interaction.options.getInteger('guild3');
        const guild4 = interaction.options.getInteger('guild4');
        
        const guildIds = [guild1, guild2, guild3, guild4];
        
        await interaction.deferReply();
        
        try {
            this.logger.info(`Starting Lunar Mine Expedition analysis for Guild IDs: ${guildIds.join(', ')}`);
            
            const groupId = await this.garrytoolsService.getGroupId(guildIds);
            this.logger.info(`📊 Retrieved Group ID: ${groupId}`);
            
            const details = await this.garrytoolsService.fetchGroupDetails(groupId);
            
            if (!details.guilds || details.guilds.length === 0) {
                await interaction.editReply('❌ No Lunar Mine Expedition data found for the provided Guild IDs.');
                return;
            }
            
            const sortedClans = details.guilds.sort((a, b) => b.totalPower - a.totalPower);
            
            const overviewEmbed = new EmbedBuilder()
                .setTitle(`⛏️ Lunar Mine Expedition - Guild Overview`)
                .setColor(0x8B4513)
                .setDescription(`📊 ${sortedClans.length} guilds sorted by total attack power`)
                .setTimestamp();
            
            sortedClans.forEach((guild, index) => {
                const powerRankPosition = `${index + 1}.`;
                
                const guildSummary = 
                    `**👥 Members:** ${guild.members.length}\n` +
                    `**⚔️ Total Power:** ${formatNumber(guild.totalPower, 2)}\n` +
                    `**💥 Extra Boss Damage:** ${guild.extraBossDamage || '0%'}\n` +
                    `**💎 Relic ${this.CORES_ICON}:** ${guild.totalRelicCores}+\n` +
                    `**🏆 Rank:** ${guild.rank ? `#${guild.rank}` : 'N/A'}\n` +
                    `**⭐ Level:** ${guild.level || 'N/A'}\n` +
                    `**📊 Grade:** ${guild.grade || 'N/A'}\n` +
                    `**🆔 Guild ID:** ${guild.guildId || 'N/A'}`;
                
                overviewEmbed.addFields({
                    name: `${powerRankPosition} ${guild.title}`,
                    value: guildSummary,
                    inline: true
                });
            });
            
            await interaction.editReply({ embeds: [overviewEmbed] });
            
            for (const guild of sortedClans) {
                await this.sendGuildMembersList(interaction, guild);
                await new Promise(resolve => setTimeout(resolve, this.config.botSettings?.delayBetweenClans || 1500));
            }
            
            this.logger.info('Lunar Mine Expedition analysis completed successfully!');
            
        } catch (error) {
            this.logger.error('Error during Lunar Mine Expedition analysis:', error);
            await interaction.editReply('❌ An error occurred during expedition analysis. Check if the provided Guild IDs are correct and if the expedition is active.');
        }
    }

    async handleAnalyseCommand(interaction) {
        const userGuildId = interaction.options.getInteger('guildid');
        await interaction.deferReply();

        try {
            this.logger.info(`🔍 Analyzing Guild ID: ${userGuildId} with substitution logic`);
            
            const modifiedGuildIds = this.garrytoolsService.modifyGuildIds(userGuildId, this.FIXED_GUILDS);
            
            const groupId = await this.garrytoolsService.getGroupId(modifiedGuildIds);
            this.logger.info(`📊 Retrieved Group ID: ${groupId}`);
            
            const details = await this.garrytoolsService.fetchGroupDetails(groupId);

            const guild = details.guilds.find(g => g.guildId === userGuildId);
            if (!guild) {
                await interaction.editReply(`❌ Guild with ID ${userGuildId} not found in results. Available guilds: ${details.guilds.map(g => g.guildId).join(', ')}`);
                return;
            }

            const guildSummary = 
                `**👥 Members:** ${guild.members.length}\n` +
                `**⚔️ Total Power:** ${formatNumber(guild.totalPower, 2)}\n` +
                `**💥 Extra Boss Damage:** ${guild.extraBossDamage || '0%'}\n` +
                `**💎 Relic ${this.CORES_ICON}:** ${guild.totalRelicCores}+\n` +
                `**🏆 Rank:** ${guild.rank ? `#${guild.rank}` : 'N/A'}\n` +
                `**⭐ Level:** ${guild.level || 'N/A'}\n` +
                `**📊 Grade:** ${guild.grade || 'N/A'}\n` +
                `**🆔 Guild ID:** ${guild.guildId || 'N/A'}`;

            const embed = new EmbedBuilder()
                .setTitle(`⛏️ ${guild.title}`)
                .setColor(0x8B4513)
                .setDescription(guildSummary)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            await this.sendGuildMembersList(interaction, guild);
            
            this.logger.info(`✅ Analysis of ${userGuildId} sent to ${interaction.user.tag}`);
            
        } catch (error) {
            this.logger.error(`❌ Error during Guild ID ${userGuildId} analysis:`, error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Analysis Error')
                .setDescription(`Failed to analyze Guild ID: ${userGuildId}`)
                .addFields({ name: 'Error Details', value: error.message })
                .setColor(0xff0000)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async handleRefreshCommand(interaction) {
        await interaction.deferReply();
        await this.clanService.fetchClanData();
        await interaction.editReply(`✅ Data refreshed. Database contains: ${this.clanService.getClanData().length} guilds.`);
    }


    async sendGuildMembersList(interaction, guild) {
        if (!guild.members || guild.members.length === 0) return;

        const sortedMembers = guild.members.sort((a, b) => b.attack - a.attack);
        const totalPages = Math.ceil(sortedMembers.length / (this.config.botSettings?.membersPerPage || 20));
        
        if (totalPages <= 1) {
            const memberText = sortedMembers.map(member => 
                `${member.rank}. **${member.name}** - ${formatNumber(member.attack, 2)} (${member.relicCores}+ ${this.CORES_ICON})`
            ).join('\n');
            
            const memberEmbed = new EmbedBuilder()
                .setTitle(`👥 Members - ${guild.title}`)
                .setColor(0x3498DB)
                .setDescription(`All ${sortedMembers.length} guild members sorted by attack power`)
                .addFields({
                    name: `📋 Member List`,
                    value: memberText || 'No data',
                    inline: false
                })
                .setTimestamp();
            
            await interaction.followUp({ embeds: [memberEmbed] });
        } else {
            const paginationId = generatePaginationId();
            
            const pageData = {
                guild: guild,
                members: sortedMembers,
                totalPages: totalPages,
                currentPage: 0,
                userId: interaction.user.id,
                createdAt: Date.now()
            };
            
            this.paginationData.set(paginationId, pageData);
            
            const initialEmbed = this.createPaginatedMemberEmbed(guild, sortedMembers, 0, totalPages, paginationId);
            const buttons = this.createNavigationButtons(0, totalPages, paginationId);
            
            await interaction.followUp({ 
                embeds: [initialEmbed], 
                components: [buttons] 
            });
            
            setTimeout(() => {
                if (this.paginationData.has(paginationId)) {
                    this.paginationData.delete(paginationId);
                }
            }, this.config.botSettings?.paginationTimeout || 600000);
        }
    }

    createPaginatedMemberEmbed(guild, members, currentPage, totalPages, paginationId) {
        const startIndex = currentPage * (this.config.botSettings?.membersPerPage || 20);
        const endIndex = Math.min(startIndex + (this.config.botSettings?.membersPerPage || 20), members.length);
        const pageMembers = members.slice(startIndex, endIndex);
        
        const memberText = pageMembers.map(member => 
            `${member.rank}. **${member.name}** - ${formatNumber(member.attack, 2)} (${member.relicCores}+ ${this.CORES_ICON})`
        ).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle(`👥 Members - ${guild.title}`)
            .setColor(0x3498DB)
            .setDescription(`Page ${currentPage + 1}/${totalPages} • Players ${startIndex + 1}-${endIndex} of ${members.length}`)
            .addFields({
                name: `📋 Member List`,
                value: memberText || 'No data',
                inline: false
            })
            .setFooter({ 
                text: `ID: ${guild.guildId}`
            })
            .setTimestamp();
        
        return embed;
    }

    createNavigationButtons(currentPage, totalPages, paginationId) {
        const previousButton = new ButtonBuilder()
            .setCustomId(`prev::${paginationId}`)
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0);
        
        const pageButton = new ButtonBuilder()
            .setCustomId(`page::${paginationId}`)
            .setLabel(`${currentPage + 1}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
        
        const nextButton = new ButtonBuilder()
            .setCustomId(`next::${paginationId}`)
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1);
        
        return new ActionRowBuilder().addComponents(previousButton, pageButton, nextButton);
    }

    cleanup() {
        // Clean up pagination data
        const now = Date.now();
        let cleaned = 0;
        
        for (const [id, data] of this.paginationData.entries()) {
            if (now - data.createdAt > (this.config.botSettings?.paginationTimeout || 600000)) {
                this.paginationData.delete(id);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.logger.info(`🗑️ Cleaned up ${cleaned} old pagination data`);
        }
    }

    async handleProxyTestCommand(interaction) {
        // Check if user is administrator
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
                content: '❌ This command requires administrator permissions!', 
                ephemeral: true 
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const workingProxies = await this.garrytoolsService.proxyService.testProxies();
            
            const embed = new EmbedBuilder()
                .setTitle('🧪 Proxy Test Results')
                .setColor(workingProxies.length > 0 ? 0x00ff00 : 0xff0000)
                .addFields([
                    { 
                        name: '📊 Summary', 
                        value: `**Working:** ${workingProxies.length}\n**Total:** ${this.garrytoolsService.proxyService.proxyList.length}`, 
                        inline: true 
                    },
                    { 
                        name: '⚙️ Status', 
                        value: this.garrytoolsService.proxyService.enabled ? '✅ Enabled' : '❌ Disabled', 
                        inline: true 
                    }
                ])
                .setTimestamp();

            if (workingProxies.length === 0) {
                embed.setDescription('❌ No working proxies found. Check your proxy configuration.');
            } else {
                const proxyList = workingProxies.map((proxy, index) => 
                    `${index + 1}. ${this.garrytoolsService.proxyService.maskProxy(proxy)}`
                ).join('\n');
                
                embed.addFields([
                    { 
                        name: '✅ Working Proxies', 
                        value: proxyList.length > 1024 ? proxyList.substring(0, 1021) + '...' : proxyList, 
                        inline: false 
                    }
                ]);
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error testing proxies:', error);
            await interaction.editReply('❌ Error occurred while testing proxies.');
        }
    }

    async handleProxyStatsCommand(interaction) {
        // Check if user is administrator
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
                content: '❌ This command requires administrator permissions!', 
                ephemeral: true 
            });
            return;
        }

        const stats = this.garrytoolsService.proxyService.getStats();
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Proxy Configuration & Statistics')
            .setColor(stats.enabled ? 0x00ff00 : 0x999999)
            .addFields([
                { 
                    name: '🔧 Configuration', 
                    value: `**Status:** ${stats.enabled ? '✅ Enabled' : '❌ Disabled'}\n**Strategy:** ${stats.strategy}\n**Retry Attempts:** ${stats.retryAttempts}`, 
                    inline: true 
                },
                { 
                    name: '📈 Statistics', 
                    value: `**Total Proxies:** ${stats.totalProxies}\n**Current Index:** ${stats.currentIndex}\n**Next Proxy:** ${stats.totalProxies > 0 ? (stats.currentIndex + 1) % stats.totalProxies : 'N/A'}`, 
                    inline: true 
                }
            ])
            .setTimestamp();

        if (!stats.enabled) {
            embed.setDescription('⚠️ Proxy system is disabled. Set `GARRY_PROXY_ENABLED=true` to enable.');
        } else if (stats.totalProxies === 0) {
            embed.setDescription('⚠️ No proxies configured. Add proxy URLs to `GARRY_PROXY_LIST` environment variable.');
        } else {
            embed.setDescription(`🌐 Proxy system active with ${stats.totalProxies} configured proxy servers.`);
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleSearchCommand(interaction) {
        const guildName = interaction.options.getString('name');
        await interaction.deferReply();

        try {
            this.logger.info(`🔍 Searching for guild: "${guildName}"`);
            
            const clanData = this.clanService.getClanData();
            
            if (clanData.length === 0) {
                await interaction.editReply('❌ No guild data available. Please use `/refresh` to load guild data first.');
                return;
            }

            // Search for guilds by name using multiple matching strategies
            const matches = [];
            const cleanSearch = this.clanService.cleanGuildName(guildName).toLowerCase();
            
            for (const clan of clanData) {
                const cleanClanName = clan.cleanName.toLowerCase();
                let similarity = 0;
                let matchType = '';
                
                // 1. Exact match (highest priority)
                if (cleanClanName === cleanSearch) {
                    similarity = 1.0;
                    matchType = 'exact';
                } 
                // 2. Starts with search term
                else if (cleanClanName.startsWith(cleanSearch)) {
                    similarity = 0.9;
                    matchType = 'starts_with';
                }
                // 3. Contains search term
                else if (cleanClanName.includes(cleanSearch)) {
                    similarity = 0.8;
                    matchType = 'contains';
                }
                // 4. Search term contains clan name (for short clan names)
                else if (cleanSearch.includes(cleanClanName) && cleanClanName.length >= 3) {
                    similarity = 0.7;
                    matchType = 'reverse_contains';
                }
                // 5. Levenshtein similarity (for typos)
                else {
                    const levenshteinSim = this.clanService.calculateSimilarity(cleanSearch, cleanClanName);
                    if (levenshteinSim >= 0.6) { // Higher threshold for fuzzy matching
                        similarity = levenshteinSim * 0.6; // Reduce weight
                        matchType = 'fuzzy';
                    }
                }
                
                if (similarity > 0) {
                    matches.push({
                        clan: clan,
                        similarity: similarity,
                        matchType: matchType
                    });
                }
            }

            // Sort by similarity (highest first)
            matches.sort((a, b) => b.similarity - a.similarity);

            if (matches.length === 0) {
                await interaction.editReply(`❌ No guilds found matching "${guildName}". Try using different search terms.`);
                return;
            }

            // Limit to top 10 matches
            const topMatches = matches.slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle('🔍 Guild Search Results')
                .setColor(0x3498DB)
                .setDescription(`Found ${matches.length} guild${matches.length === 1 ? '' : 's'} matching "${guildName}"`)
                .setTimestamp();

            // Add each guild as separate field for better formatting
            topMatches.forEach((match, index) => {
                const { clan, similarity, matchType } = match;
                const matchPercent = Math.round(similarity * 100);
                const matchIcon = this.getMatchTypeIcon(matchType);
                
                const fieldName = `${index + 1}. ${clan.name} (#${clan.rank}) ${matchIcon} Match: ${matchPercent}%`;
                const fieldValue = `  👑 ${clan.leader || 'Unknown'} 👥 ${clan.members || '0'}  🆔 ${clan.id}\n` +
                                 `  📊 Level ${clan.level} 🏆 ${clan.grade || 'N/A'} 🎯 ${clan.score || 0} pts`;
                
                embed.addFields({
                    name: fieldName,
                    value: fieldValue,
                    inline: false
                });
            });

            if (matches.length > 10) {
                embed.setFooter({ text: `Showing top 10 of ${matches.length} total matches` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Guild search error:', error);
            await interaction.editReply('❌ Error occurred during guild search.');
        }
    }

    getMatchTypeIcon(matchType) {
        switch (matchType) {
            case 'exact': return '🎯';
            case 'starts_with': return '🔸';
            case 'contains': return '🔍';
            case 'reverse_contains': return '🔄';
            case 'fuzzy': return '📝';
            default: return '🎯';
        }
    }
}

module.exports = InteractionHandler;