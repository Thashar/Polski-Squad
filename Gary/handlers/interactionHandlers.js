const { EmbedBuilder, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { hasPermission, formatNumber, generatePaginationId, isAllowedChannel } = require('../utils/helpers');

class InteractionHandler {
    constructor(config, garrytoolsService, clanService, playerService, endersEchoService, logService, logger) {
        this.config = config;
        this.garrytoolsService = garrytoolsService;
        this.clanService = clanService;
        this.playerService = playerService;
        this.endersEchoService = endersEchoService;
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
                        .setMaxLength(50))
                .addStringOption(option =>
                    option.setName('searching')
                        .setDescription('Search mode: TOP500 (cached top 500 guilds) or GLOBAL (live search via garrytools.com)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'TOP500', value: 'top500' },
                            { name: 'GLOBAL', value: 'global' }
                        )),
                        
            new SlashCommandBuilder()
                .setName('player')
                .setDescription('Search for players by name from cached ranking data (public)')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Player name to search for (minimum 3 characters)')
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(50)),
                        
            new SlashCommandBuilder()
                .setName('ee')
                .setDescription('Search for EndersEcho players by name from cached ranking data (public)')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Player name to search for (minimum 3 characters)')
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(50)),
                        
            new SlashCommandBuilder()
                .setName('proxy-test')
                .setDescription('Test all configured proxies (Admin only)'),

            new SlashCommandBuilder()
                .setName('proxy-stats')
                .setDescription('Show proxy configuration and statistics (Admin only)'),

            new SlashCommandBuilder()
                .setName('proxy-refresh')
                .setDescription('Refresh proxy list from Webshare API (Admin only)')
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
        if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isAutocomplete()) return;


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
        const adminOnlyCommands = ['lunarmine', 'refresh', 'proxy-stats', 'proxy-test', 'analyse', 'proxy-refresh'];
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
                    
                case 'player':
                    await this.handlePlayerCommand(interaction);
                    break;
                    
                case 'ee':
                    await this.handleEeCommand(interaction);
                    break;
                    
                case 'proxy-test':
                    await this.handleProxyTestCommand(interaction);
                    break;
                    
                case 'proxy-stats':
                    await this.handleProxyStatsCommand(interaction);
                    break;

                case 'proxy-refresh':
                    await this.handleProxyRefreshCommand(interaction);
                    break;
            }
        } catch (error) {
            await this.logService.logError(error, `command ${commandName}`);

            // Specjalna obsługa błędu JavaScript limitation
            if (error.isJavaScriptError) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ **Brak dostępu do danych**\n\n` +
                                `The garrytools.com search requires JavaScript execution that cannot be simulated by the bot. ` +
                                `This is a technical limitation of web scraping. Try using the command again.\n\n` +
                                `**Alternatywy:**\n` +
                                `• Spróbuj ponownie za kilka minut\n` +
                                `• Użyj \`/search [nazwa] searching:TOP500\` dla wyszukiwania w cache\n` +
                                `• Użyj \`/player [nazwa]\` lub \`/ee [nazwa]\` które działają normalnie`,
                        ephemeral: false
                    });
                } else {
                    await interaction.editReply({
                        content: `❌ **Brak dostępu do danych**\n\n` +
                                `The garrytools.com search requires JavaScript execution that cannot be simulated by the bot. ` +
                                `This is a technical limitation of web scraping. Try using the command again.\n\n` +
                                `**Alternatywy:**\n` +
                                `• Spróbuj ponownie za kilka minut\n` +
                                `• Użyj \`/search [nazwa] searching:TOP500\` dla wyszukiwania w cache\n` +
                                `• Użyj \`/player [nazwa]\` lub \`/ee [nazwa]\` które działają normalnie`
                    });
                }
                return;
            }

            // Standardowa obsługa błędów
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply('❌ An error occurred while executing the command.');
            } else if (interaction.deferred) {
                await interaction.editReply('❌ An error occurred while executing the command.');
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
        
        // Removed user restriction - anyone can use pagination buttons
        // if (pageData.userId !== interaction.user.id) {
        //     await interaction.reply({ 
        //         content: '❌ Only the person who ran the command can change pages!', 
        //         ephemeral: true 
        //     });
        //     return;
        // }
        
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
                .setTitle(`🌙 Lunar Mine Expedition - Guild Overview`)
                .setColor(0x8B4513)
                .setDescription(`📊 ${sortedClans.length} guilds sorted by total attack power`)
                .setTimestamp();
            
            sortedClans.forEach((guild, index) => {
                const powerRankPosition = `${index + 1}.`;
                
                const guildSummary = 
                    `**👥 Members:** ${guild.members.length}\n` +
                    `**⚔️ Total Power:** ${formatNumber(guild.totalPower, 2)}\n` +
                    `**<:II_RC:1385139885924421653> RC:** ${guild.totalRelicCores}+\n` +
                    `**🏆 Rank:** ${guild.rank ? `#${guild.rank}` : 'N/A'}\n` +
                    `**⭐ Level:** ${guild.level || 'N/A'}\n` +
                    `**🔥 Grade Score:** ${guild.gradeScore || '0%'}\n` +
                    `**💥 Grade:** ${guild.grade || 'N/A'}\n` +
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
                `**<:II_RC:1385139885924421653> RC:** ${guild.totalRelicCores}+\n` +
                `**🏆 Rank:** ${guild.rank ? `#${guild.rank}` : 'N/A'}\n` +
                `**⭐ Level:** ${guild.level || 'N/A'}\n` +
                `**🔥 Grade Score:** ${guild.gradeScore || '0%'}\n` +
                `**💥 Grade:** ${guild.grade || 'N/A'}\n` +
                `**🆔 Guild ID:** ${guild.guildId || 'N/A'}`;

            const embed = new EmbedBuilder()
                .setTitle(`🏰 ${guild.title}`)
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
        
        let guildCount = 0;
        let guildError = null;
        
        this.logger.info('📊 Refreshing guild data...');
        try {
            await this.clanService.fetchClanData();
            guildCount = this.clanService.getClanData().length;
        } catch (error) {
            guildError = error.message;
            this.logger.error('Failed to refresh guild data:', error.message);
        }
        
        this.logger.info('👥 Refreshing player data...');
        await interaction.editReply('⏳ Refreshing guild, player, and EndersEcho data...');
        await this.playerService.fetchPlayerData();
        const playerCount = this.playerService.getPlayerData().length;
        
        this.logger.info('🏆 Refreshing EndersEcho data...');
        await this.endersEchoService.fetchEndersEchoData();
        const eePlayerCount = this.endersEchoService.getEndersEchoData().length;
        
        let statusMessage = `✅ Data refresh completed:\n` +
                          `- 📊 Guilds: ${guildCount > 0 ? guildCount : 'Failed'}${guildError ? ' (JavaScript required)' : ''}\n` +
                          `- 👥 Players: ${playerCount}\n` +
                          `- 🏆 EndersEcho: ${eePlayerCount}`;
        
        if (guildError && guildError.includes('JavaScript')) {
            statusMessage += `\n\n⚠️ **Guild data unavailable**: The garrytools.com clan ranking page requires JavaScript execution.\n` +
                           `**Alternative**: Use player search (\`/player\`) or EndersEcho search (\`/ee\`) which work normally.`;
        }
        
        await interaction.editReply(statusMessage);
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
            const proxyList = this.garrytoolsService.proxyService.proxyList;
            const workingProxies = [];
            const failedProxies = [];

            if (proxyList.length === 0) {
                await interaction.editReply('❌ No proxies configured to test.');
                return;
            }

            // Initial progress message
            let embed = new EmbedBuilder()
                .setTitle('🧪 Proxy Testing in Progress...')
                .setColor(0xffaa00)
                .setDescription(`Testing ${proxyList.length} proxies...`)
                .addFields([
                    { name: '⏳ Progress', value: `0/${proxyList.length} (0%)`, inline: true },
                    { name: '✅ Working', value: '0', inline: true },
                    { name: '❌ Failed', value: '0', inline: true }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Test each proxy with progress updates
            for (let i = 0; i < proxyList.length; i++) {
                const proxy = proxyList[i];
                const masked = this.garrytoolsService.proxyService.maskProxy(proxy);

                try {
                    // Test proxy (simplified version)
                    const axiosInstance = this.garrytoolsService.proxyService.createProxyAxios(proxy);
                    const response = await axiosInstance.get('https://httpbin.org/ip', { timeout: 10000 });

                    if (response.status === 200) {
                        workingProxies.push(proxy);
                        this.logger.info(`✅ Proxy working: ${masked}`);
                    } else {
                        failedProxies.push({ proxy, error: `HTTP ${response.status}` });
                        this.logger.warn(`❌ Proxy failed: ${masked} - HTTP ${response.status}`);
                    }
                } catch (error) {
                    failedProxies.push({ proxy, error: error.message });
                    this.logger.warn(`❌ Proxy failed: ${masked} - ${error.message}`);
                }

                // Update progress every 3 proxies or on last proxy
                if ((i + 1) % 3 === 0 || i === proxyList.length - 1) {
                    const progress = Math.round(((i + 1) / proxyList.length) * 100);
                    const currentProxy = i < proxyList.length - 1 ? `\n\n🔍 Current: ${this.garrytoolsService.proxyService.maskProxy(proxyList[i + 1])}` : '';

                    embed = new EmbedBuilder()
                        .setTitle('🧪 Proxy Testing in Progress...')
                        .setColor(0xffaa00)
                        .setDescription(`Testing ${proxyList.length} proxies...${currentProxy}`)
                        .addFields([
                            { name: '⏳ Progress', value: `${i + 1}/${proxyList.length} (${progress}%)`, inline: true },
                            { name: '✅ Working', value: workingProxies.length.toString(), inline: true },
                            { name: '❌ Failed', value: failedProxies.length.toString(), inline: true }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });

                    // Small delay to avoid hitting Discord API rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // Final results
            embed = new EmbedBuilder()
                .setTitle('🧪 Proxy Test Results - Completed')
                .setColor(workingProxies.length > 0 ? 0x00ff00 : 0xff0000)
                .setDescription(`✅ Testing completed: ${workingProxies.length}/${proxyList.length} proxies working`)
                .addFields([
                    { name: '✅ Working Proxies', value: workingProxies.length.toString(), inline: true },
                    { name: '❌ Failed Proxies', value: failedProxies.length.toString(), inline: true },
                    { name: '📊 Success Rate', value: `${Math.round((workingProxies.length / proxyList.length) * 100)}%`, inline: true }
                ])
                .setTimestamp();

            // Add working proxies list (limited to avoid embed size limits)
            if (workingProxies.length > 0) {
                const workingList = workingProxies.slice(0, 10).map((proxy, index) =>
                    `${index + 1}. ${this.garrytoolsService.proxyService.maskProxy(proxy)}`
                ).join('\n');

                embed.addFields([{
                    name: '🌐 Working Proxies List',
                    value: workingList + (workingProxies.length > 10 ? `\n... and ${workingProxies.length - 10} more` : ''),
                    inline: false
                }]);
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
                    value: `**Total Proxies:** ${stats.totalProxies}\n**Available:** ${stats.availableProxies}\n**Disabled:** ${stats.disabledProxies}\n**Current Index:** ${stats.currentIndex}`,
                    inline: true
                }
            ])
            .setTimestamp();

        // Dodaj listę proxy ze statusami
        if (stats.enabled && stats.totalProxies > 0) {
            const proxyList = this.garrytoolsService.proxyService.proxyList;
            const proxyStatuses = [];

            for (let i = 0; i < Math.min(proxyList.length, 10); i++) { // Max 10 proxy w embed
                const proxy = proxyList[i];
                const masked = this.garrytoolsService.proxyService.maskProxy(proxy);
                const isDisabled = this.garrytoolsService.proxyService.isProxyDisabled(proxy);

                let status = '✅ Active';
                let details = '';

                if (this.garrytoolsService.proxyService.proxyErrors.has(masked)) {
                    const error = this.garrytoolsService.proxyService.proxyErrors.get(masked);

                    if (error.status === 407) {
                        status = '🚫 Expired (407)';
                        details = ' - Credentials expired';
                    } else if (error.status === 403) {
                        const now = Date.now();
                        const disabledAt = new Date(error.disabledAt).getTime();
                        const hours24 = 24 * 60 * 60 * 1000;
                        const remainingHours = Math.ceil((hours24 - (now - disabledAt)) / (60 * 60 * 1000));

                        if (remainingHours > 0) {
                            status = `⏰ Blocked (403)`;
                            details = ` - ${remainingHours}h left`;
                        } else {
                            status = '✅ Active';
                        }
                    }
                }

                proxyStatuses.push(`${status} \`${masked}\`${details}`);
            }

            embed.addFields({
                name: '🌐 Proxy Status List',
                value: proxyStatuses.join('\n') || 'No proxy data',
                inline: false
            });

            if (proxyList.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${proxyList.length} proxies` });
            }

            embed.setDescription(`🌐 Proxy system active with ${stats.totalProxies} configured servers (${stats.availableProxies} available, ${stats.disabledProxies} disabled).`);
        } else if (!stats.enabled) {
            embed.setDescription('⚠️ Proxy system is disabled. Set `GARRY_PROXY_ENABLED=true` to enable.');
        } else {
            embed.setDescription('⚠️ No proxies configured. Add proxy URLs to `GARRY_PROXY_LIST` environment variable.');
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleProxyRefreshCommand(interaction) {
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
            const oldCount = this.garrytoolsService.proxyService.proxyList.length;

            await this.garrytoolsService.proxyService.refreshProxyListFromWebshare();

            const newCount = this.garrytoolsService.proxyService.proxyList.length;

            const embed = new EmbedBuilder()
                .setTitle('🔄 Proxy List Refreshed')
                .setColor(0x00ff00)
                .addFields([
                    { name: '📥 Source', value: 'Webshare API', inline: true },
                    { name: '📊 Previous Count', value: oldCount.toString(), inline: true },
                    { name: '📊 New Count', value: newCount.toString(), inline: true }
                ])
                .setDescription(`✅ Successfully refreshed proxy list from Webshare API.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            this.logger.error('Error refreshing proxy list:', error);

            const embed = new EmbedBuilder()
                .setTitle('❌ Proxy Refresh Failed')
                .setColor(0xff0000)
                .addFields([
                    { name: '❌ Error', value: error.message || 'Unknown error', inline: false },
                    { name: '🔄 Fallback', value: 'Using existing proxy list or env fallback', inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    }

    async handleSearchCommand(interaction) {
        const guildName = interaction.options.getString('name');
        const searchMode = interaction.options.getString('searching') || 'top500';
        await interaction.deferReply();

        try {
            this.logger.info(`🔍 Searching for guild: "${guildName}" (mode: ${searchMode.toUpperCase()})`);
            
            if (searchMode === 'global') {
                await this.handleGlobalSearch(interaction, guildName);
                return;
            }
            
            // TOP500 search - existing logic
            const clanData = this.clanService.getClanData();

            if (clanData.length === 0) {
                await interaction.editReply(
                    '❌ **No cached data available**\n\n' +
                    'Guild ranking data has not been loaded yet.\n\n' +
                    '**Solution:**\n' +
                    '• Use `/refresh` command first to load guild data\n' +
                    '• Then retry `/search [name] searching:TOP500`\n\n' +
                    '**Alternative:**\n' +
                    '• Use `/search [name] searching:GLOBAL` for live search (limited)'
                );
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

            // Sort by rank (lowest rank number = highest position)
            matches.sort((a, b) => a.clan.rank - b.clan.rank);

            if (matches.length === 0) {
                await interaction.editReply(`❌ No guilds found matching "${guildName}". Try using different search terms.`);
                return;
            }

            // Limit to top 10 matches
            const topMatches = matches.slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle('🔍 Guild Search Results (TOP500)')
                .setColor(0x3498DB)
                .setDescription(`Found ${matches.length} guild${matches.length === 1 ? '' : 's'} matching "${guildName}" (TOP500 Cached Data)`)
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

    async handlePlayerCommand(interaction) {
        const playerName = interaction.options.getString('name');
        await interaction.deferReply();

        try {
            this.logger.info(`👥 Searching for player: "${playerName}"`);
            
            const playerData = this.playerService.getPlayerData();

            // If no player data in cache, ask user to refresh first
            if (playerData.length === 0) {
                await interaction.editReply(
                    '❌ **No cached data available**\n\n' +
                    'Player ranking data has not been loaded yet.\n\n' +
                    '**Solution:**\n' +
                    '• Use `/refresh` command first to load player data\n' +
                    '• Then retry `/player [name]` search'
                );
                return;
            }

            // Search for players by name using multiple matching strategies
            const matches = this.playerService.findPlayerByName(playerName, 0.8);

            if (matches.length === 0) {
                await interaction.editReply(`❌ No players found matching "${playerName}". Try using different search terms.`);
                return;
            }

            // Sort by rank (lowest rank number = highest position)
            matches.sort((a, b) => a.player.rank - b.player.rank);

            // Limit to top 10 matches
            const topMatches = matches.slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle('👥 Player Search Results')
                .setColor(0x9B59B6)
                .setDescription(`Found ${matches.length} player${matches.length === 1 ? '' : 's'} matching "${playerName}"`)
                .setTimestamp();

            // Add each player as separate field for better formatting
            topMatches.forEach((match, index) => {
                const { player, similarity, matchType } = match;
                const matchPercent = Math.round(similarity * 100);
                const matchIcon = this.getMatchTypeIcon(matchType);
                
                const fieldName = `${index + 1}. ${player.name} (#${player.rank}) ${matchIcon} Match: ${matchPercent}%`;
                const fieldValue = `🆔 ${player.id} 📊 Level ${player.level} 🏰 ${player.guildName || 'No Guild'}\n` +
                                 `⚔️  ${player.attack} ❤️  ${player.health} <:II_RC:1385139885924421653> ${player.relicCores} (AVG)`;
                
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
            this.logger.error('Player search error:', error);
            await interaction.editReply('❌ Error occurred during player search.');
        }
    }

    async handleEeCommand(interaction) {
        const playerName = interaction.options.getString('name');
        await interaction.deferReply();

        try {
            this.logger.info(`🏆 Searching for EndersEcho player: "${playerName}"`);
            
            const endersEchoData = this.endersEchoService.getEndersEchoData();

            // If no data in cache, ask user to refresh first
            if (endersEchoData.length === 0) {
                await interaction.editReply(
                    '❌ **No cached data available**\n\n' +
                    'EndersEcho ranking data has not been loaded yet.\n\n' +
                    '**Solution:**\n' +
                    '• Use `/refresh` command first to load EndersEcho data\n' +
                    '• Then retry `/ee [name]` search'
                );
                return;
            }

            // Search for players by name using multiple matching strategies
            const matches = this.endersEchoService.findPlayerByName(playerName, 0.8);

            if (matches.length === 0) {
                await interaction.editReply(`❌ No EndersEcho players found matching "${playerName}". Try using different search terms.`);
                return;
            }

            // Sort by rank (lowest rank number = highest position)
            matches.sort((a, b) => a.player.rank - b.player.rank);

            // Limit to top 10 matches
            const topMatches = matches.slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle('🏆 EndersEcho Search Results')
                .setColor(0xE74C3C)
                .setDescription(`Found ${matches.length} EndersEcho player${matches.length === 1 ? '' : 's'} matching "${playerName}"`)
                .setTimestamp();

            // Add each player as separate field for better formatting
            topMatches.forEach((match, index) => {
                const { player, similarity, matchType } = match;
                const matchPercent = Math.round(similarity * 100);
                const matchIcon = this.getMatchTypeIcon(matchType);
                
                const fieldName = `${index + 1}. ${player.name} (#${player.rank}) ${matchIcon} Match: ${matchPercent}%`;
                
                // Base information
                let fieldValue = `🆔 ${player.id} 🏰 ${player.guildName || 'No Guild'}\n` +
                               `🏆 Best Score: ${player.bestScore || 'N/A'}`;
                
                // Add date columns as Day 1, Day 2, Day 3, etc.
                const dateColumns = this.endersEchoService.getDateColumns();
                if (player.dateScores && player.dateScores.length > 0) {
                    const dayScores = player.dateScores
                        .slice(0, Math.min(3, player.dateScores.length)) // Max 3 days to avoid too long fields
                        .map((score, dayIndex) => `Day ${dayIndex + 1}: ${score || '-'}`)
                        .join(' • ');
                    
                    if (dayScores) {
                        fieldValue += `\n📅 ${dayScores}`;
                    }
                }
                
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
            this.logger.error('EndersEcho search error:', error);
            await interaction.editReply('❌ Error occurred during EndersEcho search.');
        }
    }

    getMatchTypeIcon(matchType) {
        switch (matchType) {
            case 'exact': return '🔸';
            case 'starts_with': return '🔸';
            case 'contains': return '🔸';
            case 'reverse_contains': return '🔸';
            case 'fuzzy': return '🔸';
            default: return '🔸';
        }
    }

    async handleGlobalSearch(interaction, guildName) {
        try {
            this.logger.info(`🌍 Performing GLOBAL search for: "${guildName}"`);
            
            // Based on the HTML analysis, the search works in these steps:
            // 1. Load main page (establishes session)
            // 2. AJAX call that populates search-guild-output tbody
            // 3. Parse the populated results
            
            const sessionResponse = await this.garrytoolsService.proxyService.makeRequest('https://garrytools.com/lunar', {
                method: 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            // Extract cookies and tokens
            const cookies = sessionResponse.headers?.['set-cookie']?.map(cookie => cookie.split(';')[0]).join('; ') || '';
            const $ = require('cheerio').load(sessionResponse.data);
            const csrfToken = $('meta[name="csrf-token"]').attr('content') || $('input[name="_token"]').val();
            
            // Extract session data for AJAX request
            
            let guilds = [];
            
            try {
                // Dokładnie tak jak przycisk "Search Guild" - AJAX call
                // Exact payload: type=SearchClan&name=Polski
                const ajaxData = new URLSearchParams();
                ajaxData.append('type', 'SearchClan');
                ajaxData.append('name', guildName);
                
                
                const ajaxResponse = await this.garrytoolsService.proxyService.makePostRequest('https://garrytools.com/ajax', ajaxData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html, */*; q=0.01',
                        'Referer': 'https://garrytools.com/lunar',
                        'Cookie': cookies,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                
                
                // Response format: {"IsError": false, "Data": "HTML table rows"}
                if (ajaxResponse.data && typeof ajaxResponse.data === 'object' && 
                    ajaxResponse.data.IsError === false && ajaxResponse.data.Data) {
                    
                    const htmlData = ajaxResponse.data.Data;
                    
                    // Parse HTML using regex since cheerio has issues with table fragments
                    const trRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
                    const tdRegex = /<td[^>]*>(.*?)<\/td>/g;
                    
                    let match;
                    
                    while ((match = trRegex.exec(htmlData)) !== null) {
                        const rowHtml = match[1];
                        const cells = [];
                        let tdMatch;
                        
                        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
                            cells.push(tdMatch[1].trim());
                        }
                        
                        if (cells.length >= 3) {
                            const rank = parseInt(cells[0]) || 0;
                            const guildId = parseInt(cells[1]) || 0;
                            const name = cells[2].trim();
                            
                            if (name && guildId > 0) {
                                guilds.push({ id: guildId, name: name, rank: rank });
                            }
                        }
                        
                        // Reset regex for next iteration
                        tdRegex.lastIndex = 0;
                    }
                    
                } else if (ajaxResponse.data && typeof ajaxResponse.data === 'object' && ajaxResponse.data.error) {
                    this.logger.warn(`❌ AJAX returned error: ${ajaxResponse.data.msg || 'Unknown error'}`);
                }
                
            } catch (ajaxError) {
                this.logger.warn(`AJAX search failed: ${ajaxError.message}`);
            }
            
            // If still no results, inform user that global search is not available
            if (guilds.length === 0) {
                await interaction.editReply({
                    content: `❌ **Global search is not available**\n\n` +
                             `The garrytools.com search requires JavaScript execution that cannot be simulated by the bot. ` +
                             `This is a technical limitation of web scraping.\n\n` +
                             `**Alternative**: Use \`searching: TOP500\` to search through cached guild ranking data (top 500 guilds).`,
                    ephemeral: false
                });
                return;
            }
            
            // Create and send embed with results
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('🌍 Global Guild Search Results')
                .setColor(0x00AE86)
                .setDescription(`Found ${guilds.length} guild${guilds.length === 1 ? '' : 's'} matching "${guildName}"`)
                .setTimestamp();
            
            guilds.slice(0, 10).forEach((guild, index) => {
                embed.addFields({
                    name: `${index + 1}. ${guild.name} (#${guild.rank})`,
                    value: `🆔 ID: ${guild.id} 🏆 Rank: #${guild.rank}`,
                    inline: false
                });
            });
            
            if (guilds.length > 10) {
                embed.setFooter({ text: `Showing first 10 of ${guilds.length} results` });
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            this.logger.error('Error in GLOBAL search:', error);
            this.logger.error('Error stack:', error.stack);
            this.logger.error('Error message:', error.message);
            await interaction.editReply(`❌ Error occurred during global search: ${error.message}`);
        }
    }
}

module.exports = InteractionHandler;
