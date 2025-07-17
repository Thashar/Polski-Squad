const { SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class InteractionHandler {
    constructor(config, roleManagementService, logService, specialRolesService) {
        this.config = config;
        this.roleManagementService = roleManagementService;
        this.logService = logService;
        this.specialRolesService = specialRolesService;
    }

    /**
     * Rejestruje komendy slash
     * @param {Client} client - Klient Discord
     */
    async registerSlashCommands(client) {
        const commands = [
            new SlashCommandBuilder()
                .setName('remove-roles')
                .setDescription('Usuwa wybraną rolę wszystkim użytkownikom na serwerze')
                .addRoleOption(option =>
                    option.setName('rola')
                        .setDescription('Rola do usunięcia')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option.setName('szybkie')
                        .setDescription('Usuń rolę przez skasowanie i ponowne utworzenie (szybsze)')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('add-special-role')
                .setDescription('Dodaje rolę do listy ról specjalnych do automatycznego zarządzania')
                .addRoleOption(option =>
                    option.setName('rola')
                        .setDescription('Rola do dodania do listy specjalnych')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('remove-special-role')
                .setDescription('Usuwa rolę z listy ról specjalnych')
                .addRoleOption(option =>
                    option.setName('rola')
                        .setDescription('Rola do usunięcia z listy specjalnych')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('list-special-roles')
                .setDescription('Wyświetla listę wszystkich ról specjalnych i informacje o nich'),
            
            new SlashCommandBuilder()
                .setName('special-roles')
                .setDescription('Wyświetla wszystkie role specjalne na serwerze w przejrzysty sposób')
        ];
        
        try {
            const rest = new REST({ version: '10' }).setToken(this.config.token);
            
            await this.logService.logMessage('info', 'Rozpoczynam rejestrację komend slash...');
            
            const route = this.config.guildId 
                ? Routes.applicationGuildCommands(this.config.clientId, this.config.guildId)
                : Routes.applicationCommands(this.config.clientId);
            
            await rest.put(route, { body: commands });
            
            await this.logService.logMessage('success', 'Pomyślnie zarejestrowano komendy slash!');
        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas rejestracji komend: ${error.message}`);
        }
    }

    /**
     * Obsługuje interakcje
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleInteraction(interaction) {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'remove-roles':
                    await this.handleRemoveRolesCommand(interaction);
                    break;
                case 'add-special-role':
                    await this.handleAddSpecialRoleCommand(interaction);
                    break;
                case 'remove-special-role':
                    await this.handleRemoveSpecialRoleCommand(interaction);
                    break;
                case 'list-special-roles':
                    await this.handleListSpecialRolesCommand(interaction);
                    break;
                case 'special-roles':
                    await this.handleSpecialRolesCommand(interaction);
                    break;
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        }
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     */
    async handleButtonInteraction(interaction) {
        if (!interaction.customId.startsWith('special_roles_')) return;
        
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył przycisku ${interaction.customId}`, interaction);
        
        try {
            const specialRoles = await this.specialRolesService.readSpecialRoles();
            
            if (specialRoles.length === 0) {
                await interaction.reply({ content: this.config.messages.specialRolesNone, ephemeral: true });
                return;
            }
            
            // Grupuj role w chunki po 10
            const roleChunks = [];
            for (let i = 0; i < specialRoles.length; i += 10) {
                roleChunks.push(specialRoles.slice(i, i + 10));
            }
            
            let targetPage = 0;
            const currentPage = parseInt(interaction.customId.split('_')[3]) || 0;
            
            if (interaction.customId.includes('_prev_')) {
                targetPage = Math.max(0, currentPage - 1);
            } else if (interaction.customId.includes('_next_')) {
                targetPage = Math.min(roleChunks.length - 1, currentPage + 1);
            } else if (interaction.customId.includes('_first_')) {
                targetPage = 0;
            } else if (interaction.customId.includes('_last_')) {
                targetPage = roleChunks.length - 1;
            }
            
            await this.displaySpecialRolesPage(interaction, roleChunks, targetPage);
            
        } catch (error) {
            await interaction.reply({ content: `❌ Wystąpił błąd podczas nawigacji: ${error.message}`, ephemeral: true });
            await this.logService.logMessage('error', `Błąd podczas nawigacji przycisków: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę usuwania ról
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleRemoveRolesCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /remove-roles`, interaction);
        
        if (!interaction.member.permissions.has(this.config.roles.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.noPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy bez uprawnień`, interaction);
            return;
        }
        
        const roleToRemove = interaction.options.getRole('rola');
        const quickMode = interaction.options.getBoolean('szybkie') || false;
        
        if (!roleToRemove) {
            await interaction.reply({
                content: this.config.messages.roleNotFound,
                ephemeral: true
            });
            return;
        }
        
        if (roleToRemove.position >= interaction.guild.members.me.roles.highest.position) {
            await interaction.reply({
                content: this.config.messages.hierarchyError,
                ephemeral: true
            });
            return;
        }
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            if (quickMode && this.config.roles.enableQuickMode) {
                await this.logService.logMessage('info', `Rozpoczynanie szybkiego usuwania roli ${roleToRemove.name}`, interaction);
                
                const roleData = {
                    name: roleToRemove.name,
                    color: roleToRemove.color,
                    permissions: roleToRemove.permissions,
                    mentionable: roleToRemove.mentionable,
                    hoist: roleToRemove.hoist,
                    position: roleToRemove.position
                };
                
                await roleToRemove.delete();
                await interaction.guild.roles.create(roleData);
                
                const successMessage = formatMessage(this.config.messages.quickModeSuccess, {
                    roleName: roleData.name
                });
                
                await interaction.editReply({ content: successMessage });
                await this.logService.logMessage('success', `Szybkie usunięcie roli ${roleData.name} zakończone pomyślnie`, interaction);
                
            } else {
                const members = await interaction.guild.members.fetch();
                const membersWithRole = members.filter(member => 
                    member.roles.cache.has(roleToRemove.id)
                );
                
                if (membersWithRole.size === 0) {
                    const noUsersMessage = formatMessage(this.config.messages.noUsersWithRole, {
                        roleName: roleToRemove.name
                    });
                    
                    await interaction.editReply({ content: noUsersMessage });
                    return;
                }
                
                await this.logService.logMessage('info', `Rozpoczynanie usuwania roli ${roleToRemove.name} od ${membersWithRole.size} użytkowników`, interaction);
                
                let successCount = 0;
                let errorCount = 0;
                
                const startMessage = formatMessage(this.config.messages.startingRemoval, {
                    roleName: roleToRemove.name,
                    userCount: membersWithRole.size
                });
                
                await interaction.editReply({
                    content: `${startMessage}\nSzacowany czas: ${Math.ceil(membersWithRole.size / 60)} minut`
                });
                
                let delay = 0;
                
                for (const [memberId, member] of membersWithRole) {
                    setTimeout(async () => {
                        try {
                            await member.roles.remove(roleToRemove);
                            successCount++;
                            
                            if (successCount % this.config.roles.maxRemovalsPerBatch === 0) {
                                const progressMessage = formatMessage(this.config.messages.progressUpdate, {
                                    current: successCount,
                                    total: membersWithRole.size
                                });
                                
                                await interaction.editReply({ content: progressMessage });
                            }
                            
                            if (successCount + errorCount === membersWithRole.size) {
                                const completionMessage = formatMessage(this.config.messages.completionSuccess, {
                                    roleName: roleToRemove.name,
                                    success: successCount,
                                    errors: errorCount
                                });
                                
                                await interaction.editReply({ content: completionMessage });
                                await this.logService.logMessage('success', `Usuwanie roli ${roleToRemove.name} zakończone. Sukces: ${successCount}, Błędy: ${errorCount}`, interaction);
                            }
                        } catch (error) {
                            errorCount++;
                            await this.logService.logMessage('error', `Błąd podczas usuwania roli od ${member.user.tag}: ${error.message}`, interaction);
                        }
                    }, delay);
                    
                    delay += this.config.roles.delayBetweenRemovals;
                }
            }
            
        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas usuwania ról: ${error.message}`, interaction);
            await interaction.editReply({ content: this.config.messages.generalError });
        }
    }

    /**
     * Obsługuje komendę dodawania roli specjalnej
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleAddSpecialRoleCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /add-special-role`, interaction);
        
        if (!interaction.member.permissions.has(this.config.roles.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.noPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy bez uprawnień`, interaction);
            return;
        }
        
        const roleToAdd = interaction.options.getRole('rola');
        
        if (!roleToAdd) {
            await interaction.reply({
                content: this.config.messages.roleNotFound,
                ephemeral: true
            });
            return;
        }
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const result = await this.specialRolesService.addSpecialRole(roleToAdd.id);
            
            if (result.success) {
                const successMessage = formatMessage(this.config.messages.specialRoleAdded, {
                    roleName: roleToAdd.name,
                    roleId: roleToAdd.id
                });
                
                await interaction.editReply({ content: successMessage });
                await this.logService.logMessage('success', `Dodano rolę specjalną ${roleToAdd.name} (${roleToAdd.id})`, interaction);
                
            } else {
                let errorMessage;
                
                switch (result.reason) {
                    case 'already_exists':
                        errorMessage = formatMessage(this.config.messages.specialRoleAlreadyExists, {
                            roleName: roleToAdd.name,
                            roleId: roleToAdd.id
                        });
                        break;
                    default:
                        errorMessage = formatMessage(this.config.messages.specialRoleAddError, {
                            error: result.message
                        });
                }
                
                await interaction.editReply({ content: errorMessage });
            }
            
        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.specialRoleAddError, {
                error: error.message
            });
            
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas dodawania roli specjalnej: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę usuwania roli specjalnej
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleRemoveSpecialRoleCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /remove-special-role`, interaction);
        
        if (!interaction.member.permissions.has(this.config.roles.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.noPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy bez uprawnień`, interaction);
            return;
        }
        
        const roleToRemove = interaction.options.getRole('rola');
        
        if (!roleToRemove) {
            await interaction.reply({
                content: this.config.messages.roleNotFound,
                ephemeral: true
            });
            return;
        }
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const result = await this.specialRolesService.removeSpecialRole(roleToRemove.id);
            
            if (result.success) {
                const successMessage = formatMessage(this.config.messages.specialRoleRemoved, {
                    roleName: roleToRemove.name,
                    roleId: roleToRemove.id
                });
                
                await interaction.editReply({ content: successMessage });
                await this.logService.logMessage('success', `Usunięto rolę specjalną ${roleToRemove.name} (${roleToRemove.id})`, interaction);
                
            } else {
                let errorMessage;
                
                switch (result.reason) {
                    case 'not_found':
                        errorMessage = formatMessage(this.config.messages.specialRoleNotFound, {
                            roleName: roleToRemove.name,
                            roleId: roleToRemove.id
                        });
                        break;
                    default:
                        errorMessage = formatMessage(this.config.messages.specialRoleRemoveError, {
                            error: result.message
                        });
                }
                
                await interaction.editReply({ content: errorMessage });
            }
            
        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.specialRoleRemoveError, {
                error: error.message
            });
            
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas usuwania roli specjalnej: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę wyświetlania listy ról specjalnych
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleListSpecialRolesCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /list-special-roles`, interaction);
        
        if (!interaction.member.permissions.has(this.config.roles.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.noPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy bez uprawnień`, interaction);
            return;
        }
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const roleInfo = await this.specialRolesService.getSpecialRolesInfo(interaction.guild);
            
            if (!roleInfo.success) {
                await interaction.editReply({ content: `❌ Błąd pobierania informacji o rolach: ${roleInfo.error}` });
                return;
            }
            
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(this.config.messages.specialRolesListTitle)
                .setColor('#0099FF')
                .setTimestamp()
                .setFooter({ text: `Żądanie od ${interaction.user.tag}` });
            
            // Role ENV zostały przeniesione do special_roles.json
            
            // Dodaj informacje o rolach specjalnych
            if (roleInfo.specialRoles.length > 0) {
                const specialRolesList = roleInfo.specialRoles
                    .map(role => `<@&${role.id}> (${role.name})`)
                    .join('\n');
                
                embed.addFields({
                    name: `⭐ Role specjalne (${roleInfo.specialRoles.length})`,
                    value: specialRolesList.length > 1024 ? specialRolesList.substring(0, 1020) + '...' : specialRolesList,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '⭐ Role specjalne (0)',
                    value: 'Brak ról specjalnych',
                    inline: false
                });
            }
            
            // Dodaj informacje o nieważnych rolach
            if (roleInfo.invalidRoles.length > 0) {
                const invalidRolesList = roleInfo.invalidRoles
                    .map(role => `${role.id} (${role.source})`)
                    .join('\n');
                
                embed.addFields({
                    name: `❌ Nieważne role (${roleInfo.invalidRoles.length})`,
                    value: invalidRolesList.length > 1024 ? invalidRolesList.substring(0, 1020) + '...' : invalidRolesList,
                    inline: false
                });
            }
            
            // Dodaj podsumowanie
            embed.addFields({
                name: '📊 Podsumowanie',
                value: formatMessage(this.config.messages.specialRolesCurrentCount + '\n' + 
                      `⭐ Role specjalne: ${roleInfo.specialRoles.length}\n` +
                      `✅ Ważnych ról: ${roleInfo.validCount}\n` +
                      `❌ Nieważnych ról: ${roleInfo.invalidRoles.length}`, {
                    count: roleInfo.totalCount
                }),
                inline: false
            });
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas pobierania listy ról: ${error.message}` });
            await this.logService.logMessage('error', `Błąd podczas wyświetlania listy ról specjalnych: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę wyświetlania ról specjalnych (publiczna)
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleSpecialRolesCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /special-roles`, interaction);
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const specialRoles = await this.specialRolesService.readSpecialRoles();
            
            if (specialRoles.length === 0) {
                await interaction.editReply({ content: this.config.messages.specialRolesNone });
                return;
            }
            
            // Grupuj role w chunki po 10 dla lepszej czytelności
            const roleChunks = [];
            for (let i = 0; i < specialRoles.length; i += 10) {
                roleChunks.push(specialRoles.slice(i, i + 10));
            }
            
            await this.displaySpecialRolesPage(interaction, roleChunks, 0);
            
        } catch (error) {
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas pobierania ról specjalnych: ${error.message}` });
            await this.logService.logMessage('error', `Błąd podczas wyświetlania ról specjalnych: ${error.message}`, interaction);
        }
    }

    /**
     * Wyświetla stronę ról specjalnych z przyciskami nawigacji
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {Array} roleChunks - Podzielone grupy ról
     * @param {number} currentPage - Aktualna strona
     */
    async displaySpecialRolesPage(interaction, roleChunks, currentPage) {
        const chunk = roleChunks[currentPage];
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTimestamp();
        
        if (roleChunks.length === 1) {
            embed.setTitle(this.config.messages.specialRolesDisplay);
        } else {
            embed.setTitle(`${this.config.messages.specialRolesDisplay} (Strona ${currentPage + 1}/${roleChunks.length})`);
        }
        
        embed.setDescription(this.config.messages.specialRolesDescription);
        
        let rolesList = '';
        
        for (let i = 0; i < chunk.length; i++) {
            const roleId = chunk[i];
            const role = interaction.guild.roles.cache.get(roleId);
            const roleNumber = (currentPage * 10) + i + 1;
            
            if (role) {
                rolesList += `${roleNumber}. <@&${roleId}> - **${role.name}**\n`;
            } else {
                rolesList += `${roleNumber}. ❌ **Nieważna rola** (ID: ${roleId})\n`;
            }
        }
        
        embed.addFields({
            name: `⭐ Role ${(currentPage * 10) + 1}-${Math.min((currentPage + 1) * 10, roleChunks.flat().length)}`,
            value: rolesList || 'Brak ról w tej grupie',
            inline: false
        });
        
        // Dodaj podsumowanie tylko do pierwszej strony
        if (currentPage === 0) {
            const allRoles = roleChunks.flat();
            embed.addFields({
                name: '📊 Podsumowanie',
                value: `**Łączna liczba ról:** ${allRoles.length}\n**Ważne role:** ${interaction.guild.roles.cache.filter(r => allRoles.includes(r.id)).size}\n**Nieważne role:** ${allRoles.length - interaction.guild.roles.cache.filter(r => allRoles.includes(r.id)).size}`,
                inline: false
            });
        }
        
        embed.setFooter({ 
            text: `Użyj /add-special-role lub /remove-special-role do zarządzania | ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL()
        });
        
        // Twórz przyciski nawigacji
        const components = [];
        
        if (roleChunks.length > 1) {
            const row = new ActionRowBuilder();
            
            // Przycisk "Poprzednia"
            const prevButton = new ButtonBuilder()
                .setCustomId(`special_roles_prev_${currentPage}`)
                .setLabel('◀️ Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Następna"
            const nextButton = new ButtonBuilder()
                .setCustomId(`special_roles_next_${currentPage}`)
                .setLabel('Następna ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === roleChunks.length - 1);
            
            // Przycisk "Pierwsza"
            const firstButton = new ButtonBuilder()
                .setCustomId(`special_roles_first_${currentPage}`)
                .setLabel('⏮️ Pierwsza')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Ostatnia"
            const lastButton = new ButtonBuilder()
                .setCustomId(`special_roles_last_${currentPage}`)
                .setLabel('Ostatnia ⏭️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === roleChunks.length - 1);
            
            row.addComponents(firstButton, prevButton, nextButton, lastButton);
            components.push(row);
        }
        
        const messagePayload = {
            embeds: [embed],
            components: components
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(messagePayload);
        } else {
            await interaction.reply({ ...messagePayload, ephemeral: true });
        }
    }
}

module.exports = InteractionHandler;