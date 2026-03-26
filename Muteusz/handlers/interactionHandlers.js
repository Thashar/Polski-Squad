const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { formatMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const WarningService = require('../services/warningService');
const ReportStatsService = require('../services/reportStatsService');

const logger = createBotLogger('Muteusz');

class InteractionHandler {
    constructor(config, logService, specialRolesService, messageHandler = null, roleKickingService = null, chaosService = null, primaAprilisService = null) {
        this.config = config;
        this.logService = logService;
        this.specialRolesService = specialRolesService;
        this.messageHandler = messageHandler;
        this.roleKickingService = roleKickingService;
        this.chaosService = chaosService;
        this.primaAprilisService = primaAprilisService;
        this.warningService = new WarningService(config, logger);
        this.reportStatsService = new ReportStatsService();
        this.reportStatsService.initialize().catch(err => logger.error(`❌ Błąd inicjalizacji ReportStatsService: ${err.message}`));
    }

    /**
     * Sprawdza czy użytkownik jest administratorem lub moderatorem
     * @param {GuildMember} member - Członek serwera
     * @returns {boolean} Czy użytkownik ma uprawnienia administratora/moderatora
     */
    isAdminOrModerator(member) {
        if (!member || !member.permissions) return false;
        
        return member.permissions.has('Administrator') || member.permissions.has('ModerateMembers');
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
                .setDescription('Wyświetla wszystkie role specjalne na serwerze w przejrzysty sposób'),
            
            new SlashCommandBuilder()
                .setName('clean')
                .setDescription('Usuwa wiadomości na kanale')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik, którego wiadomości usunąć (opcjonalnie)')
                        .setRequired(false)
                )
                .addIntegerOption(option =>
                    option.setName('ilość')
                        .setDescription('Ilość wiadomości do usunięcia (max 100)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(100)
                )
                .addStringOption(option =>
                    option.setName('czas')
                        .setDescription('Czas wstecz w formacie np. 2h30m (max 16h 40m)')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('mute')
                .setDescription('Ucisza użytkownika na określony czas lub na stałe')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do uciszenia')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('czas')
                        .setDescription('Czas w formacie np. 1d4h30m (d=dni, h=godziny, m=minuty, brak = na stałe)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód uciszenia')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('unmute')
                .setDescription('Odcisza użytkownika usuwając rolę mute')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do odciszenia')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód odciszenia')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('kick')
                .setDescription('Wyrzuca użytkownika z serwera')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do wyrzucenia')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód wyrzucenia')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('ban')
                .setDescription('Banuje użytkownika na serwerze')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do zbanowania')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód bana')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('dni_wiadomości')
                        .setDescription('Ilość dni wiadomości do usunięcia (0-7)')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(7)
                ),
            
            new SlashCommandBuilder()
                .setName('unban')
                .setDescription('Odbanowuje użytkownika na serwerze')
                .addStringOption(option =>
                    option.setName('user_id')
                        .setDescription('ID użytkownika do odbanowania')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód odbanowania')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('warn')
                .setDescription('Nakłada ostrzeżenie na użytkownika')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do ostrzeżenia')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powód')
                        .setDescription('Powód ostrzeżenia')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('violations')
                .setDescription('Wyświetla wszystkie ostrzeżenia użytkownika')
                .addUserOption(option =>
                    option.setName('użytkownik')
                        .setDescription('Użytkownik do sprawdzenia')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('test-kick')
                .setDescription('Testuje system kickowania użytkowników bez ról')
                .addBooleanOption(option =>
                    option.setName('produkcyjny')
                        .setDescription('Czy uruchomić w trybie produkcyjnym (rzeczywiste kickowanie)')
                        .setRequired(false)
                ),
            
            new SlashCommandBuilder()
                .setName('block-ss')
                .setDescription('Blokuje wrzucanie zdjęć na danym kanale na określony czas')
                .addStringOption(option =>
                    option.setName('czas')
                        .setDescription('Format: hh.mm dd.mm.rrrr (np. 23.59 31.12.2024)')
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option.setName('kanał')
                        .setDescription('Kanał do zablokowania')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('block-word')
                .setDescription('Blokuje określone słowo i nakłada karę za jego użycie')
                .addStringOption(option =>
                    option.setName('słowo')
                        .setDescription('Słowo do zablokowania')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('czas')
                        .setDescription('Format: gg:mm dd.mm.rrrr (np. 23:59 31.12.2024)')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option.setName('timeout')
                        .setDescription('Czy nakładać timeout na użytkownika')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option.setName('inside')
                        .setDescription('Czy blokować słowo także jako część innych słów (true) czy tylko samo słowo (false)')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('na_ile')
                        .setDescription('Na ile czasu timeout (np. 1h30m). Wymagane tylko gdy timeout=true')
                        .setRequired(false)
                ),

            new SlashCommandBuilder()
                .setName('add-roles')
                .setDescription('Nadaje rolę wszystkim użytkownikom posiadającym określoną rolę')
                .addRoleOption(option =>
                    option.setName('rola_do_nadania')
                        .setDescription('Rola, którą chcesz nadać')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('rola_komu')
                        .setDescription('Rola, której posiadacze otrzymają nową rolę (opcjonalnie - brak = wszyscy)')
                        .setRequired(false)
                ),

            new SlashCommandBuilder()
                .setName('chaos-mode')
                .setDescription('Włącza/wyłącza Chaos Mode - wybierz role lub zostaw puste aby wyłączyć')
                .addRoleOption(option =>
                    option.setName('rola_1')
                        .setDescription('Pierwsza rola do nadawania (zostaw puste aby wyłączyć chaos mode)')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rola_2')
                        .setDescription('Druga rola do nadawania (opcjonalna)')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rola_3')
                        .setDescription('Trzecia rola do nadawania (opcjonalna)')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rola_4')
                        .setDescription('Czwarta rola do nadawania (opcjonalna)')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('rola_5')
                        .setDescription('Piąta rola do nadawania (opcjonalna)')
                        .setRequired(false)
                ),

            new SlashCommandBuilder()
                .setName('data-archive')
                .setDescription('Tworzy manualną archiwizację wszystkich danych botów do Google Drive (niezależną)'),

            new SlashCommandBuilder()
                .setName('komendy')
                .setDescription('Wyświetla listę wszystkich dostępnych komend ze wszystkich botów'),

            new SlashCommandBuilder()
                .setName('zgłoś')
                .setDescription('Zgłoś wiadomość naruszającą zasady serwera')
                .addStringOption(option =>
                    option.setName('link')
                        .setDescription('Link do wiadomości (Prawy klik → Kopiuj link do wiadomości)')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('powod')
                        .setDescription('Powód zgłoszenia (opcjonalny)')
                        .setRequired(false)
                ),

            // Context menu: prawy klik na wiadomość → Aplikacje
            new ContextMenuCommandBuilder()
                .setName('Zgłoś wiadomość')
                .setType(ApplicationCommandType.Message),

            // Context menu: prawy klik na użytkownika → Aplikacje (moderator-only)
            new ContextMenuCommandBuilder()
                .setName('Wycisz użytkownika')
                .setType(ApplicationCommandType.User),

            new ContextMenuCommandBuilder()
                .setName('Ostrzeż użytkownika')
                .setType(ApplicationCommandType.User),
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
                case 'clean':
                    await this.handleCleanCommand(interaction);
                    break;
                case 'mute':
                    await this.handleMuteCommand(interaction);
                    break;
                case 'unmute':
                    await this.handleUnmuteCommand(interaction);
                    break;
                case 'kick':
                    await this.handleKickCommand(interaction);
                    break;
                case 'ban':
                    await this.handleBanCommand(interaction);
                    break;
                case 'unban':
                    await this.handleUnbanCommand(interaction);
                    break;
                case 'warn':
                    await this.handleWarnCommand(interaction);
                    break;
                case 'violations':
                    await this.handleViolationsCommand(interaction);
                    break;
                case 'test-kick':
                    await this.handleTestKickCommand(interaction);
                    break;
                case 'block-ss':
                    await this.handleBlockSsCommand(interaction);
                    break;
                case 'block-word':
                    await this.handleBlockWordCommand(interaction);
                    break;
                case 'add-roles':
                    await this.handleAddRolesCommand(interaction);
                    break;
                case 'chaos-mode':
                    await this.handleChaosModeCommand(interaction);
                    break;
                case 'data-archive':
                    await this.handleDataArchiveCommand(interaction);
                    break;
                case 'komendy':
                    await this.handleKomendyCommand(interaction);
                    break;
                case 'zgłoś':
                    await this.handleZglosCommand(interaction);
                    break;
            }
        } else if (interaction.isMessageContextMenuCommand()) {
            if (interaction.commandName === 'Zgłoś wiadomość') {
                await this.handleReportMessageContextMenu(interaction);
            }
        } else if (interaction.isUserContextMenuCommand()) {
            if (interaction.commandName === 'Wycisz użytkownika') {
                await this.handleMuteUserContextMenu(interaction);
            } else if (interaction.commandName === 'Ostrzeż użytkownika') {
                await this.handleWarnUserContextMenu(interaction);
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'report_modal_submit') {
                await this.handleReportModalSubmit(interaction);
            } else if (interaction.customId.startsWith('report_mute_modal_')) {
                await this.handleReportMuteDurationModalSubmit(interaction);
            } else if (interaction.customId.startsWith('report_warn_modal_')) {
                await this.handleReportWarnModalSubmit(interaction);
            } else if (interaction.customId.startsWith('report_fu_mute_modal_')) {
                await this.handleReportFollowupMuteModalSubmit(interaction);
            } else if (interaction.customId.startsWith('context_report_modal_')) {
                await this.handleContextReportModalSubmit(interaction);
            } else if (interaction.customId.startsWith('context_mute_modal_')) {
                await this.handleContextMuteModalSubmit(interaction);
            } else if (interaction.customId.startsWith('context_warn_modal_')) {
                await this.handleContextWarnModalSubmit(interaction);
            } else if (interaction.customId.startsWith('automod_warn_modal_')) {
                await this.handleAutoModWarnModalSubmit(interaction);
            }
        }
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     */
    async handleButtonInteraction(interaction) {
        if (this.primaAprilisService && interaction.customId === this.primaAprilisService.getButtonCustomId()) {
            await this.handlePrimaAprilisButton(interaction);
        } else if (interaction.customId.startsWith('special_roles_')) {
            await this.handleSpecialRolesButtonInteraction(interaction);
        } else if (interaction.customId.startsWith('violations_')) {
            await this.handleViolationsButtonInteraction(interaction);
        } else if (interaction.customId === 'report_start_button') {
            await this.handleReportStartButton(interaction);
        } else if (interaction.customId.startsWith('report_fu_mute_')) {
            await this.handleReportFollowupMuteButton(interaction);
        } else if (interaction.customId.startsWith('report_fu_delete_')) {
            await this.handleReportFollowupDeleteButton(interaction);
        } else if (interaction.customId.startsWith('report_warn_') ||
                   interaction.customId.startsWith('report_mute_') ||
                   interaction.customId.startsWith('report_delete_') ||
                   interaction.customId.startsWith('report_nothing_')) {
            await this.handleReportActionButton(interaction);
        } else if (interaction.customId.startsWith('automod_delete_') ||
                   interaction.customId.startsWith('automod_warn_')) {
            await this.handleAutoModButton(interaction);
        }
    }

    /**
     * Obsługuje kliknięcie przycisku Prima Aprilis "NIE KLIKAĆ"
     * @param {ButtonInteraction} interaction
     */
    async handlePrimaAprilisButton(interaction) {
        try {
            const member = interaction.member;
            const prisonRoleId = this.config.primaAprilis.prisonRoleId;

            // Ignoruj kliknięcie jeśli użytkownik już ma rolę więźnia
            if (member.roles.cache.has(prisonRoleId)) {
                await interaction.deferUpdate();
                return;
            }

            await this.primaAprilisService.trapUser(member);
            await interaction.reply({
                content: `A było nie klikać <:z_Trollface:1171154605372084367>\nTeraz jesteś uwięziony(-a). Żeby wyjść, musisz rozwiązać zagadkę.`,
                ephemeral: true
            });
        } catch (error) {
            logger.error('❌ PrimaAprilis: błąd przy łapaniu użytkownika:', error.message);
            try { await interaction.deferUpdate(); } catch {}
        }
    }

    /**
     * Obsługuje interakcje przycisków dla ról specjalnych
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     */
    async handleSpecialRolesButtonInteraction(interaction) {
        
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

    /**
     * Obsługuje komendę czyszczenia wiadomości
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleCleanCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /clean`, interaction);
        
        if (!interaction.member.permissions.has(this.config.clean.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.cleanNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /clean bez uprawnień`, interaction);
            return;
        }

        const user = interaction.options.getUser('użytkownik');
        const amount = interaction.options.getInteger('ilość');
        const timeString = interaction.options.getString('czas');

        // Parse time format for clean command
        let minutes = null;
        if (timeString) {
            const parsedTime = this.parseTimeFormat(timeString);
            if (parsedTime.error) {
                await interaction.reply({
                    content: `❌ Nieprawidłowy format czasu: ${parsedTime.error}\nPrzykład poprawnego formatu: 2h30m (2 godziny, 30 minut)`,
                    ephemeral: true
                });
                return;
            }
            minutes = parsedTime.minutes;
            
            // Sprawdź limit (1000 minut = 16h 40m)
            if (minutes > 1000) {
                await interaction.reply({
                    content: `❌ Maksymalny czas to 16h 40m (1000 minut)`,
                    ephemeral: true
                });
                return;
            }
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            let deletedCount = 0;

            // Określ typ operacji na podstawie podanych parametrów
            if (user && amount) {
                // Nick + ilość = usuń ilość wiadomości dla danego nicku
                deletedCount = await this.cleanUserMessages(interaction, user, amount);
            } else if (user && minutes) {
                // Nick + czas = usuń wiadomości dla danego nicku w określonym czasie
                deletedCount = await this.cleanUserMessagesByTime(interaction, user, minutes);
            } else if (amount) {
                // Sama ilość = usuń wstecz wiadomości na kanale
                deletedCount = await this.cleanLatestMessages(interaction, amount);
            } else if (minutes) {
                // Sam czas = usuń wszystkie wiadomości w określonym czasie
                deletedCount = await this.cleanMessagesByTime(interaction, minutes);
            } else {
                await interaction.editReply({ content: "❌ Musisz podać przynajmniej jeden parametr (ilość lub czas)!" });
                return;
            }

            if (deletedCount > 0) {
                const successMessage = formatMessage(this.config.messages.cleanSuccess, {
                    count: deletedCount
                });
                await interaction.editReply({ content: successMessage });
                
                // Publiczne powiadomienie o sukcesie
                await interaction.followUp({ content: successMessage, ephemeral: false });
                
                const timeInfo = timeString ? ` (${this.parseTimeFormat(timeString).formatted} wstecz)` : '';
                await this.logService.logMessage('success', `Usunięto ${deletedCount} wiadomości na kanale ${interaction.channel.name}${timeInfo}`, interaction);
            } else {
                await interaction.editReply({ content: this.config.messages.cleanNoMessages });
            }

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.cleanError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas czyszczenia wiadomości: ${error.message}`, interaction);
        }
    }

    /**
     * Usuwa ostatnie wiadomości na kanale
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {number} amount - Ilość wiadomości do usunięcia
     * @returns {number} Ilość usuniętych wiadomości
     */
    async cleanLatestMessages(interaction, amount) {
        const messages = await interaction.channel.messages.fetch({ 
            limit: Math.min(amount, this.config.clean.maxMessages) 
        });

        if (messages.size === 0) {
            return 0;
        }

        try {
            await interaction.channel.bulkDelete(messages, true);
            return messages.size;
        } catch (error) {
            if (error.code === 50034) {
                await interaction.editReply({ content: this.config.messages.cleanBulkDeleteFailed });
                return 0;
            }
            throw error;
        }
    }

    /**
     * Usuwa wiadomości konkretnego użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {User} user - Użytkownik, którego wiadomości usunąć
     * @param {number} amount - Ilość wiadomości do usunięcia
     * @returns {number} Ilość usuniętych wiadomości
     */
    async cleanUserMessages(interaction, user, amount) {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const userMessages = messages.filter(msg => msg.author.id === user.id);

        if (userMessages.size === 0) {
            return 0;
        }

        const messagesToDelete = userMessages.first(Math.min(amount, this.config.clean.maxMessages));
        
        try {
            await interaction.channel.bulkDelete(messagesToDelete, true);
            return messagesToDelete.length;
        } catch (error) {
            if (error.code === 50034) {
                await interaction.editReply({ content: this.config.messages.cleanBulkDeleteFailed });
                return 0;
            }
            throw error;
        }
    }

    /**
     * Usuwa wiadomości z określonego czasu
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {number} minutes - Ilość minut wstecz
     * @returns {number} Ilość usuniętych wiadomości
     */
    async cleanMessagesByTime(interaction, minutes) {
        const timeLimit = Math.min(minutes, this.config.clean.maxMinutes);
        const cutoffTime = new Date(Date.now() - (timeLimit * 60 * 1000));
        
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const recentMessages = messages.filter(msg => msg.createdAt >= cutoffTime);

        if (recentMessages.size === 0) {
            return 0;
        }

        try {
            await interaction.channel.bulkDelete(recentMessages, true);
            return recentMessages.size;
        } catch (error) {
            if (error.code === 50034) {
                await interaction.editReply({ content: this.config.messages.cleanBulkDeleteFailed });
                return 0;
            }
            throw error;
        }
    }

    /**
     * Usuwa wiadomości konkretnego użytkownika z określonego czasu
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {User} user - Użytkownik, którego wiadomości usunąć
     * @param {number} minutes - Ilość minut wstecz
     * @returns {number} Ilość usuniętych wiadomości
     */
    async cleanUserMessagesByTime(interaction, user, minutes) {
        const timeLimit = Math.min(minutes, this.config.clean.maxMinutes);
        const cutoffTime = new Date(Date.now() - (timeLimit * 60 * 1000));
        
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const userMessages = messages.filter(msg => 
            msg.author.id === user.id && msg.createdAt >= cutoffTime
        );

        if (userMessages.size === 0) {
            return 0;
        }

        try {
            await interaction.channel.bulkDelete(userMessages, true);
            return userMessages.size;
        } catch (error) {
            if (error.code === 50034) {
                await interaction.editReply({ content: this.config.messages.cleanBulkDeleteFailed });
                return 0;
            }
            throw error;
        }
    }

    /**
     * Obsługuje komendę uciszania użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleMuteCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /mute`, interaction);
        
        if (!interaction.member.permissions.has(this.config.mute.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.muteNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /mute bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');
        const timeString = interaction.options.getString('czas');
        const reason = interaction.options.getString('powód');

        // Parse time format (1d4h30m)
        let timeInMinutes = null;
        if (timeString) {
            const parsedTime = this.parseTimeFormat(timeString);
            if (parsedTime.error) {
                await interaction.reply({
                    content: `❌ Nieprawidłowy format czasu: ${parsedTime.error}\nPrzykład poprawnego formatu: 1d4h30m (1 dzień, 4 godziny, 30 minut)`,
                    ephemeral: true
                });
                return;
            }
            timeInMinutes = parsedTime.minutes;
        }

        if (!targetUser) {
            await interaction.reply({
                content: "❌ Nie podano użytkownika do uciszenia!",
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (!targetMember) {
                await interaction.editReply({ content: "❌ Użytkownik nie jest członkiem tego serwera!" });
                return;
            }

            // Sprawdź czy cel to administrator lub moderator
            if (this.isAdminOrModerator(targetMember)) {
                await interaction.editReply({ content: "❌ Nie można uciszać administratorów ani moderatorów!" });
                return;
            }

            // Sprawdź hierarchię ról
            if (targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
                await interaction.editReply({ content: this.config.messages.muteHierarchyError });
                return;
            }

            // Pobierz rolę mute
            const muteRole = interaction.guild.roles.cache.get(this.config.mute.muteRoleId);
            if (!muteRole) {
                await interaction.editReply({ content: this.config.messages.muteRoleNotFound });
                return;
            }

            // Sprawdź czy użytkownik już ma rolę mute
            if (targetMember.roles.cache.has(this.config.mute.muteRoleId)) {
                const alreadyMutedMessage = formatMessage(this.config.messages.muteAlreadyMuted, {
                    user: targetUser.tag
                });
                await interaction.editReply({ content: alreadyMutedMessage });
                return;
            }

            // Dodaj rolę mute
            await targetMember.roles.add(muteRole);

            // Przygotuj wiadomość sukcesu
            let timeText = "";
            let reasonText = "";
            
            if (timeInMinutes) {
                const parsedTime = this.parseTimeFormat(timeString);
                timeText = ` na ${parsedTime.formatted}`;
                
                // Ustaw automatyczne odciszenie
                setTimeout(async () => {
                    try {
                        const memberToUnmute = await interaction.guild.members.fetch(targetUser.id);
                        if (memberToUnmute && memberToUnmute.roles.cache.has(this.config.mute.muteRoleId)) {
                            await memberToUnmute.roles.remove(muteRole);
                            await this.logService.logMessage('info', `Automatyczne odciszenie użytkownika ${targetUser.tag} po ${parsedTime.formatted}`, interaction);
                        }
                    } catch (error) {
                        await this.logService.logMessage('error', `Błąd podczas automatycznego odciszania ${targetUser.tag}: ${error.message}`, interaction);
                    }
                }, timeInMinutes * 60 * 1000);
            } else {
                timeText = this.config.messages.muteSuccessPermanent;
            }

            if (reason) {
                reasonText = `\n**Powód:** ${reason}`;
            }

            const successMessage = formatMessage(this.config.messages.muteSuccess, {
                user: targetUser.tag,
                time: timeText,
                reason: reasonText
            });

            await interaction.editReply({ content: successMessage });
            
            // Publiczne powiadomienie o sukcesie
            await interaction.followUp({ content: successMessage, ephemeral: false });
            
            // Dodatkowa informacja o automatycznym odciszeniu
            if (timeInMinutes) {
                const parsedTime = this.parseTimeFormat(timeString);
                const unmuteScheduledMessage = `🔄 Automatyczne odciszenie za ${parsedTime.formatted}`;
                await interaction.followUp({ content: unmuteScheduledMessage, ephemeral: true });
            }

            const parsedTime = timeInMinutes ? this.parseTimeFormat(timeString) : null;
            await this.logService.logMessage('success', `Uciszono użytkownika ${targetUser.tag}${timeInMinutes ? ` na ${parsedTime.formatted}` : ' na stałe'}${reason ? ` z powodem: ${reason}` : ''}`, interaction);

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.muteError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas uciszania użytkownika: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę odciszania użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleUnmuteCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /unmute`, interaction);
        
        if (!interaction.member.permissions.has(this.config.mute.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.unmuteNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /unmute bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');
        const reason = interaction.options.getString('powód');

        if (!targetUser) {
            await interaction.reply({
                content: "❌ Nie podano użytkownika do odciszenia!",
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (!targetMember) {
                await interaction.editReply({ content: "❌ Użytkownik nie jest członkiem tego serwera!" });
                return;
            }

            // Sprawdź hierarchię ról
            if (targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
                await interaction.editReply({ content: this.config.messages.unmuteHierarchyError });
                return;
            }

            // Pobierz rolę mute
            const muteRole = interaction.guild.roles.cache.get(this.config.mute.muteRoleId);
            if (!muteRole) {
                await interaction.editReply({ content: this.config.messages.unmuteRoleNotFound });
                return;
            }

            // Sprawdź czy użytkownik ma rolę mute
            if (!targetMember.roles.cache.has(this.config.mute.muteRoleId)) {
                const notMutedMessage = formatMessage(this.config.messages.unmuteNotMuted, {
                    user: targetUser.tag
                });
                await interaction.editReply({ content: notMutedMessage });
                return;
            }

            // Usuń rolę mute
            await targetMember.roles.remove(muteRole);

            // Przygotuj wiadomość sukcesu
            let reasonText = "";
            if (reason) {
                reasonText = `\n**Powód:** ${reason}`;
            }

            const successMessage = formatMessage(this.config.messages.unmuteSuccess, {
                user: targetUser.tag,
                reason: reasonText
            });

            await interaction.editReply({ content: successMessage });
            
            // Publiczne powiadomienie o sukcesie
            await interaction.followUp({ content: successMessage, ephemeral: false });
            
            await this.logService.logMessage('success', `Odciszono użytkownika ${targetUser.tag}${reason ? ` z powodem: ${reason}` : ''}`, interaction);

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.unmuteError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas odciszania użytkownika: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę wyrzucania użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleKickCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /kick`, interaction);
        
        if (!interaction.member.permissions.has(this.config.moderation.kick.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.kickNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /kick bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');
        const reason = interaction.options.getString('powód');

        if (!targetUser) {
            await interaction.reply({
                content: "❌ Nie podano użytkownika do wyrzucenia!",
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (!targetMember) {
                await interaction.editReply({ content: "❌ Użytkownik nie jest członkiem tego serwera!" });
                return;
            }

            // Sprawdź czy cel to administrator lub moderator
            if (this.isAdminOrModerator(targetMember)) {
                await interaction.editReply({ content: "❌ Nie można wyrzucać administratorów ani moderatorów!" });
                return;
            }

            // Sprawdź hierarchię ról
            if (targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
                await interaction.editReply({ content: this.config.messages.kickHierarchyError });
                return;
            }

            // Wyślij DM przed wyrzuceniem
            try {
                const dmTitle = formatMessage(this.config.messages.kickDmTitle, {
                    serverName: interaction.guild.name
                });
                const dmMessage = formatMessage(this.config.messages.kickDmMessage, {
                    reason: reason
                });
                
                await targetUser.send({
                    embeds: [{
                        title: dmTitle,
                        description: dmMessage,
                        color: 0xFF6B35,
                        timestamp: new Date().toISOString()
                    }]
                });
            } catch (dmError) {
                await this.logService.logMessage('warn', `Nie udało się wysłać DM do ${targetUser.tag}: ${dmError.message}`, interaction);
            }

            // Wyrzuć użytkownika
            await targetMember.kick(reason);

            const successMessage = formatMessage(this.config.messages.kickSuccess, {
                user: targetUser.tag,
                reason: reason
            });

            await interaction.editReply({ content: successMessage });
            
            // Publiczne powiadomienie o sukcesie
            await interaction.followUp({ content: successMessage, ephemeral: false });
            
            await this.logService.logMessage('success', `Wyrzucono użytkownika ${targetUser.tag} z powodem: ${reason}`, interaction);

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.kickError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas wyrzucania użytkownika: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę banowania użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleBanCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /ban`, interaction);
        
        if (!interaction.member.permissions.has(this.config.moderation.ban.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.banNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /ban bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');
        const reason = interaction.options.getString('powód');
        const deleteDays = interaction.options.getInteger('dni_wiadomości') || this.config.moderation.ban.defaultDeleteDays;

        if (!targetUser) {
            await interaction.reply({
                content: "❌ Nie podano użytkownika do zbanowania!",
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Sprawdź czy użytkownik jest na serwerze
            let targetMember = null;
            try {
                targetMember = await interaction.guild.members.fetch(targetUser.id);
            } catch (fetchError) {
                // Użytkownik nie jest na serwerze, ale można go zbanować
            }

            // Sprawdź czy cel to administrator lub moderator (jeśli jest na serwerze)
            if (targetMember && this.isAdminOrModerator(targetMember)) {
                await interaction.editReply({ content: "❌ Nie można banować administratorów ani moderatorów!" });
                return;
            }

            // Sprawdź hierarchię ról jeśli użytkownik jest na serwerze
            if (targetMember && targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
                await interaction.editReply({ content: this.config.messages.banHierarchyError });
                return;
            }

            // Wyślij DM przed banem
            try {
                const dmTitle = formatMessage(this.config.messages.banDmTitle, {
                    serverName: interaction.guild.name
                });
                const dmMessage = formatMessage(this.config.messages.banDmMessage, {
                    reason: reason
                });
                
                await targetUser.send({
                    embeds: [{
                        title: dmTitle,
                        description: dmMessage,
                        color: 0xFF0000,
                        timestamp: new Date().toISOString()
                    }]
                });
            } catch (dmError) {
                await this.logService.logMessage('warn', `Nie udało się wysłać DM do ${targetUser.tag}: ${dmError.message}`, interaction);
            }

            // Zbanuj użytkownika
            await interaction.guild.bans.create(targetUser.id, {
                reason: reason,
                deleteMessageDays: deleteDays
            });

            const successMessage = formatMessage(this.config.messages.banSuccess, {
                user: targetUser.tag,
                reason: reason
            });

            await interaction.editReply({ content: successMessage });
            
            // Publiczne powiadomienie o sukcesie
            await interaction.followUp({ content: successMessage, ephemeral: false });
            
            await this.logService.logMessage('success', `Zbanowano użytkownika ${targetUser.tag} z powodem: ${reason}`, interaction);

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.banError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas banowania użytkownika: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę odbanowania użytkownika
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleUnbanCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /unban`, interaction);
        
        if (!interaction.member.permissions.has(this.config.moderation.unban.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.unbanNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /unban bez uprawnień`, interaction);
            return;
        }

        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('powód');

        if (!userId) {
            await interaction.reply({
                content: "❌ Nie podano ID użytkownika do odbanowania!",
                ephemeral: true
            });
            return;
        }

        // Sprawdź czy ID jest prawidłowe
        if (!/^\d{17,19}$/.test(userId)) {
            await interaction.reply({
                content: this.config.messages.unbanInvalidId,
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Sprawdź czy użytkownik jest zbanowany
            const banInfo = await interaction.guild.bans.fetch(userId);
            
            if (!banInfo) {
                await interaction.editReply({ content: this.config.messages.unbanUserNotFound });
                return;
            }

            // Odbanuj użytkownika
            await interaction.guild.bans.remove(userId, reason || 'Brak powodu');

            let reasonText = "";
            if (reason) {
                reasonText = `\n**Powód:** ${reason}`;
            }

            const successMessage = formatMessage(this.config.messages.unbanSuccess, {
                user: banInfo.user.tag,
                reason: reasonText
            });

            await interaction.editReply({ content: successMessage });
            
            // Publiczne powiadomienie o sukcesie
            await interaction.followUp({ content: successMessage, ephemeral: false });
            
            await this.logService.logMessage('success', `Odbanowano użytkownika ${banInfo.user.tag}${reason ? ` z powodem: ${reason}` : ''}`, interaction);

        } catch (error) {
            if (error.code === 10026) {
                await interaction.editReply({ content: this.config.messages.unbanUserNotFound });
            } else {
                const errorMessage = formatMessage(this.config.messages.unbanError, {
                    error: error.message
                });
                await interaction.editReply({ content: errorMessage });
                await this.logService.logMessage('error', `Błąd podczas odbanowywania użytkownika: ${error.message}`, interaction);
            }
        }
    }

    /**
     * Obsługuje komendę nadawania ostrzeżenia
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleWarnCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /warn`, interaction);
        
        if (!interaction.member.permissions.has(this.config.moderation.warn.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.warnNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /warn bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');
        const reason = interaction.options.getString('powód');

        if (!targetUser) {
            await interaction.reply({
                content: "❌ Nie podano użytkownika do ostrzeżenia!",
                ephemeral: false
            });
            return;
        }

        if (targetUser.id === interaction.user.id) {
            await interaction.reply({
                content: this.config.messages.warnSelfError,
                ephemeral: false
            });
            return;
        }

        // Sprawdź czy cel to administrator lub moderator
        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            if (targetMember && this.isAdminOrModerator(targetMember)) {
                await interaction.reply({
                    content: "❌ Nie można ostrzegać administratorów ani moderatorów!",
                    ephemeral: false
                });
                return;
            }
        } catch (error) {
            // Użytkownik nie jest na serwerze, ale można go ostrzec
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const result = this.warningService.addWarning(
                targetUser.id,
                interaction.user.id,
                interaction.user.tag,
                reason,
                interaction.guild.id
            );

            const successMessage = `⚠️ Nadano ostrzeżenie użytkownikowi **${targetUser.tag}**\n**Powód:** ${reason}\n**Łączna liczba ostrzeżeń:** ${result.totalWarnings}`;

            await interaction.editReply({ content: successMessage });
            
            await this.logService.logMessage('success', `Nadano ostrzeżenie użytkownikowi ${targetUser.tag} (${result.totalWarnings} łącznie) z powodem: ${reason}`, interaction);

        } catch (error) {
            const errorMessage = `❌ Wystąpił błąd podczas nadawania ostrzeżenia: ${error.message}`;
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas nadawania ostrzeżenia: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę wyświetlania ostrzeżeń
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleViolationsCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /violations`, interaction);
        
        if (!interaction.member.permissions.has(this.config.moderation.warn.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.warnNoPermission,
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /violations bez uprawnień`, interaction);
            return;
        }

        const targetUser = interaction.options.getUser('użytkownik');

        await interaction.deferReply({ ephemeral: true });

        try {
            if (!targetUser) {
                // Jeśli nie wybrano użytkownika, pokaż ostatnie 10 warnów na serwerze
                await this.displayServerWarnings(interaction);
                return;
            }

            const warnings = this.warningService.getUserWarnings(targetUser.id, interaction.guild.id);
            
            if (warnings.length === 0) {
                const emptyMessage = formatMessage(this.config.messages.violationsEmpty, {
                    user: targetUser.tag
                });
                await interaction.editReply({ content: emptyMessage });
                return;
            }

            const pages = this.warningService.paginateWarnings(warnings, this.config.warnings.maxPerPage);
            await this.displayViolationsPage(interaction, targetUser, pages, 0);

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.violationsError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas pobierania ostrzeżeń: ${error.message}`, interaction);
        }
    }

    /**
     * Wyświetla ostatnie 10 warnów na serwerze
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async displayServerWarnings(interaction) {
        try {
            // Pobierz wszystkie warny na serwerze
            const allWarnings = this.warningService.getAllWarnings(interaction.guild.id);
            
            if (allWarnings.length === 0) {
                await interaction.editReply({ 
                    content: "✅ Brak ostrzeżeń na tym serwerze." 
                });
                return;
            }

            // Sortuj po dacie (najnowsze pierwsze) i weź pierwsze 10
            const recentWarnings = allWarnings
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle('📋 Ostatnie ostrzeżenia na serwerze')
                .setColor('#FF6B35')
                .setTimestamp()
                .setFooter({ text: `Łącznie ostrzeżeń: ${allWarnings.length}` });

            // Dodaj ostrzeżenia do embed
            let description = '';
            for (let i = 0; i < recentWarnings.length; i++) {
                const warning = recentWarnings[i];
                const date = new Date(warning.timestamp).toLocaleString('pl-PL');
                const user = await interaction.client.users.fetch(warning.userId).catch(() => null);
                const userTag = user ? user.tag : `ID: ${warning.userId}`;
                
                description += `**${i + 1}.** ${userTag}\n`;
                description += `📅 ${date} • 👮 ${warning.moderator.tag}\n`;
                description += `📝 ${warning.reason}\n\n`;
            }

            embed.setDescription(description);
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const errorMessage = formatMessage(this.config.messages.violationsError, {
                error: error.message
            });
            await interaction.editReply({ content: errorMessage });
            await this.logService.logMessage('error', `Błąd podczas pobierania ostrzeżeń serwera: ${error.message}`, interaction);
        }
    }

    /**
     * Wyświetla stronę ostrzeżeń z przyciskami nawigacji
     * @param {CommandInteraction} interaction - Interakcja komendy
     * @param {User} targetUser - Użytkownik
     * @param {Array} pages - Podzielone strony ostrzeżeń
     * @param {number} currentPage - Aktualna strona
     */
    async displayViolationsPage(interaction, targetUser, pages, currentPage) {
        const page = pages[currentPage];
        const totalWarnings = pages.reduce((sum, p) => sum + p.length, 0);
        
        const embed = new EmbedBuilder()
            .setTitle(formatMessage(this.config.messages.violationsTitle, {
                user: targetUser.tag
            }))
            .setColor('#FF6B35')
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();

        // Dodaj ostrzeżenia do embed
        let description = '';
        page.forEach((warning, index) => {
            const warningNumber = (currentPage * this.config.warnings.maxPerPage) + index + 1;
            const date = new Date(warning.timestamp).toLocaleString('pl-PL');
            
            description += `**${warningNumber}.** ${warning.reason}\n`;
            description += `📅 ${date} • 👮 ${warning.moderator.tag}\n\n`;
        });

        embed.setDescription(description);

        // Pobierz liczbę niewidocznych ostrzeżeń (wyzwisk) do warna
        let hiddenViolationsCount = 0;
        if (this.messageHandler && this.messageHandler.getAutoModerationService) {
            const autoModerationService = this.messageHandler.getAutoModerationService();
            if (autoModerationService && autoModerationService.violationCounts) {
                const userViolations = autoModerationService.violationCounts.get(targetUser.id);
                if (userViolations) {
                    hiddenViolationsCount = userViolations.count;
                }
            }
        }

        // Dodaj informacje o stronach i niewidocznych ostrzeżeniach
        let pageInfo = formatMessage(this.config.messages.violationsPageInfo, {
            current: currentPage + 1,
            total: pages.length,
            totalWarnings: totalWarnings
        });
        
        if (hiddenViolationsCount > 0) {
            pageInfo += `\n⚠️ Niewidoczne ostrzeżenia do warna: ${hiddenViolationsCount}`;
        }
        
        embed.setFooter({ text: pageInfo });

        // Twórz przyciski nawigacji
        const components = [];
        
        if (pages.length > 1) {
            const row = new ActionRowBuilder();
            
            // Przycisk "Pierwsza"
            const firstButton = new ButtonBuilder()
                .setCustomId(`violations_first_${targetUser.id}_${currentPage}`)
                .setLabel('⏮️ Pierwsza')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Poprzednia"
            const prevButton = new ButtonBuilder()
                .setCustomId(`violations_prev_${targetUser.id}_${currentPage}`)
                .setLabel('◀️ Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Następna"
            const nextButton = new ButtonBuilder()
                .setCustomId(`violations_next_${targetUser.id}_${currentPage}`)
                .setLabel('Następna ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === pages.length - 1);
            
            // Przycisk "Ostatnia"
            const lastButton = new ButtonBuilder()
                .setCustomId(`violations_last_${targetUser.id}_${currentPage}`)
                .setLabel('Ostatnia ⏭️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === pages.length - 1);
            
            row.addComponents(firstButton, prevButton, nextButton, lastButton);
            components.push(row);
        }

        // Dodaj przyciski do zarządzania ostrzeżeniami
        const managementRow = new ActionRowBuilder();
        
        // Przycisk "Usuń ostatnie ostrzeżenie"
        const removeLastButton = new ButtonBuilder()
            .setCustomId(`violations_remove_last_${targetUser.id}`)
            .setLabel('🗑️ Usuń ostatnie')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(totalWarnings === 0);
        
        // Przycisk "Usuń wszystkie ostrzeżenia"
        const removeAllButton = new ButtonBuilder()
            .setCustomId(`violations_remove_all_${targetUser.id}`)
            .setLabel('🗑️ Usuń wszystkie')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(totalWarnings === 0);
        
        managementRow.addComponents(removeLastButton, removeAllButton);
        components.push(managementRow);

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

    /**
     * Aktualizuje stronę ostrzeżeń używając update zamiast reply
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {User} targetUser - Użytkownik
     * @param {Array} pages - Podzielone strony ostrzeżeń
     * @param {number} currentPage - Aktualna strona
     */
    async displayViolationsPageUpdate(interaction, targetUser, pages, currentPage) {
        const page = pages[currentPage];
        const totalWarnings = pages.reduce((sum, p) => sum + p.length, 0);
        
        const embed = new EmbedBuilder()
            .setTitle(formatMessage(this.config.messages.violationsTitle, {
                user: targetUser.tag
            }))
            .setColor('#FF6B35')
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();

        // Dodaj ostrzeżenia do embed
        let description = '';
        page.forEach((warning, index) => {
            const warningNumber = (currentPage * this.config.warnings.maxPerPage) + index + 1;
            const date = new Date(warning.timestamp).toLocaleString('pl-PL');
            
            description += `**${warningNumber}.** ${warning.reason}\n`;
            description += `📅 ${date} • 👮 ${warning.moderator.tag}\n\n`;
        });

        embed.setDescription(description);

        // Pobierz liczbę niewidocznych ostrzeżeń (wyzwisk) do warna
        let hiddenViolationsCount = 0;
        if (this.messageHandler && this.messageHandler.getAutoModerationService) {
            const autoModerationService = this.messageHandler.getAutoModerationService();
            if (autoModerationService && autoModerationService.violationCounts) {
                const userViolations = autoModerationService.violationCounts.get(targetUser.id);
                if (userViolations) {
                    hiddenViolationsCount = userViolations.count;
                }
            }
        }

        // Dodaj informacje o stronach i niewidocznych ostrzeżeniach
        let pageInfo = formatMessage(this.config.messages.violationsPageInfo, {
            current: currentPage + 1,
            total: pages.length,
            totalWarnings: totalWarnings
        });
        
        if (hiddenViolationsCount > 0) {
            pageInfo += `\n⚠️ Niewidoczne ostrzeżenia do warna: ${hiddenViolationsCount}`;
        }
        
        embed.setFooter({ text: pageInfo });

        // Twórz przyciski nawigacji
        const components = [];
        
        if (pages.length > 1) {
            const row = new ActionRowBuilder();
            
            // Przycisk "Pierwsza"
            const firstButton = new ButtonBuilder()
                .setCustomId(`violations_first_${targetUser.id}_${currentPage}`)
                .setLabel('⏮️ Pierwsza')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Poprzednia"
            const prevButton = new ButtonBuilder()
                .setCustomId(`violations_prev_${targetUser.id}_${currentPage}`)
                .setLabel('◀️ Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0);
            
            // Przycisk "Następna"
            const nextButton = new ButtonBuilder()
                .setCustomId(`violations_next_${targetUser.id}_${currentPage}`)
                .setLabel('Następna ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === pages.length - 1);
            
            // Przycisk "Ostatnia"
            const lastButton = new ButtonBuilder()
                .setCustomId(`violations_last_${targetUser.id}_${currentPage}`)
                .setLabel('Ostatnia ⏭️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === pages.length - 1);
            
            row.addComponents(firstButton, prevButton, nextButton, lastButton);
            components.push(row);
        }

        // Dodaj przyciski do zarządzania ostrzeżeniami
        const managementRow = new ActionRowBuilder();
        
        // Przycisk "Usuń ostatnie ostrzeżenie"
        const removeLastButton = new ButtonBuilder()
            .setCustomId(`violations_remove_last_${targetUser.id}`)
            .setLabel('🗑️ Usuń ostatnie')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(totalWarnings === 0);
        
        // Przycisk "Usuń wszystkie ostrzeżenia"
        const removeAllButton = new ButtonBuilder()
            .setCustomId(`violations_remove_all_${targetUser.id}`)
            .setLabel('🗑️ Usuń wszystkie')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(totalWarnings === 0);
        
        managementRow.addComponents(removeLastButton, removeAllButton);
        components.push(managementRow);

        const messagePayload = {
            embeds: [embed],
            components: components
        };

        await interaction.update(messagePayload);
    }

    /**
     * Obsługuje interakcje przycisków dla ostrzeżeń
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     */
    async handleViolationsButtonInteraction(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył przycisku ${interaction.customId}`, interaction);
        
        // Sprawdź uprawnienia do zarządzania ostrzeżeniami
        if (!interaction.member.permissions.has(this.config.moderation.warn.requiredPermission)) {
            await interaction.reply({
                content: this.config.messages.warnNoPermission,
                ephemeral: true
            });
            return;
        }
        
        try {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // first, prev, next, last, remove
            const subAction = parts[2]; // dla remove: last, all
            const targetUserId = action === 'remove' ? parts[3] : parts[2];
            const currentPage = parseInt(parts[4]) || parseInt(parts[3]) || 0;
            
            const targetUser = await interaction.client.users.fetch(targetUserId);
            
            // Obsługa przycisków usuwania
            if (action === 'remove') {
                await this.handleWarningRemoval(interaction, targetUser, subAction);
                return;
            }
            
            // Obsługa przycisków nawigacji
            const warnings = this.warningService.getUserWarnings(targetUserId, interaction.guild.id);
            const pages = this.warningService.paginateWarnings(warnings, this.config.warnings.maxPerPage);
            
            let targetPage = currentPage;
            
            switch (action) {
                case 'first':
                    targetPage = 0;
                    break;
                case 'prev':
                    targetPage = Math.max(0, currentPage - 1);
                    break;
                case 'next':
                    targetPage = Math.min(pages.length - 1, currentPage + 1);
                    break;
                case 'last':
                    targetPage = pages.length - 1;
                    break;
            }
            
            await this.displayViolationsPageUpdate(interaction, targetUser, pages, targetPage);
            
        } catch (error) {
            await interaction.update({ content: `❌ Wystąpił błąd podczas nawigacji: ${error.message}`, embeds: [], components: [] });
            await this.logService.logMessage('error', `Błąd podczas nawigacji przycisków violations: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje usuwanie ostrzeżeń
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     * @param {User} targetUser - Użytkownik
     * @param {string} action - Akcja (last, all)
     */
    async handleWarningRemoval(interaction, targetUser, action) {
        try {
            let result;
            let successMessage;
            
            if (action === 'last') {
                result = this.warningService.removeLastWarning(targetUser.id, interaction.guild.id);
                
                if (result.success) {
                    successMessage = `🗑️ Usunięto ostatnie ostrzeżenie użytkownika **${targetUser.tag}**\n**Powód:** ${result.warning.reason}\n**Pozostałe ostrzeżenia:** ${result.remainingWarnings}`;
                } else {
                    await interaction.update({ content: `❌ ${result.message}`, embeds: [], components: [] });
                    return;
                }
            } else if (action === 'all') {
                result = this.warningService.removeAllWarnings(targetUser.id, interaction.guild.id);
                
                if (result.success) {
                    successMessage = `🗑️ Usunięto wszystkie ostrzeżenia użytkownika **${targetUser.tag}**\n**Usunięto:** ${result.removedCount} ostrzeżeń`;
                    
                    // Zeruj licznik wyzwisk w auto-moderacji
                    if (this.messageHandler && this.messageHandler.getAutoModerationService) {
                        const autoModerationService = this.messageHandler.getAutoModerationService();
                        if (autoModerationService && autoModerationService.clearViolations) {
                            autoModerationService.clearViolations(targetUser.id);
                        }
                    }
                } else {
                    await interaction.update({ content: `❌ ${result.message}`, embeds: [], components: [] });
                    return;
                }
            }
            
            // Odśwież widok ostrzeżeń - zaktualizuj obecną wiadomość
            const warnings = this.warningService.getUserWarnings(targetUser.id, interaction.guild.id);
            
            if (warnings.length > 0) {
                const pages = this.warningService.paginateWarnings(warnings, this.config.warnings.maxPerPage);
                await this.displayViolationsPageUpdate(interaction, targetUser, pages, 0);
            } else {
                const emptyMessage = formatMessage(this.config.messages.violationsEmpty, {
                    user: targetUser.tag
                });
                await interaction.update({ content: emptyMessage, embeds: [], components: [] });
            }
            
            // Nie wysyłaj publicznych powiadomień o usuwaniu ostrzeżeń
            
            await this.logService.logMessage('success', `Usunięto ostrzeżenia użytkownika ${targetUser.tag} (${action})`, interaction);
            
        } catch (error) {
            await interaction.update({ content: `❌ Wystąpił błąd podczas usuwania ostrzeżeń: ${error.message}`, embeds: [], components: [] });
            await this.logService.logMessage('error', `Błąd podczas usuwania ostrzeżeń: ${error.message}`, interaction);
        }
    }

    /**
     * Parsuje format czasu typu "1d4h30m" na minuty
     * @param {string} timeString - String z czasem do sparsowania
     * @returns {Object} - {minutes: number, error: string|null, formatted: string}
     */
    parseTimeFormat(timeString) {
        if (!timeString || typeof timeString !== 'string') {
            return { error: 'Nie podano czasu' };
        }

        const timeString_clean = timeString.toLowerCase().trim();
        
        // Regex do wyciągnięcia dni, godzin i minut
        const dayMatch = timeString_clean.match(/(\d+)d/);
        const hourMatch = timeString_clean.match(/(\d+)h/);
        const minuteMatch = timeString_clean.match(/(\d+)m/);
        
        // Sprawdź czy string zawiera tylko dozwolone znaki
        if (!/^(\d+[dhm]\s*)+$/.test(timeString_clean)) {
            return { error: 'Dozwolone są tylko cyfry i litery d, h, m (np. 1d4h30m)' };
        }
        
        let totalMinutes = 0;
        let days = 0, hours = 0, minutes = 0;
        
        if (dayMatch) {
            days = parseInt(dayMatch[1]);
            totalMinutes += days * 24 * 60; // dni na minuty
        }
        
        if (hourMatch) {
            hours = parseInt(hourMatch[1]);
            totalMinutes += hours * 60; // godziny na minuty
        }
        
        if (minuteMatch) {
            minutes = parseInt(minuteMatch[1]);
            totalMinutes += minutes;
        }
        
        // Sprawdź czy podano jakikolwiek czas
        if (totalMinutes === 0) {
            return { error: 'Nie wykryto żadnego czasu w podanym formacie' };
        }
        
        // Sprawdź limit (7 dni = 10080 minut)
        const maxMinutes = this.config.mute.maxTimeMinutes;
        if (totalMinutes > maxMinutes) {
            return { error: `Maksymalny czas mute to ${this.formatTimeDisplay(maxMinutes)}` };
        }
        
        const formatted = this.formatTimeDisplay(totalMinutes);
        
        return {
            minutes: totalMinutes,
            error: null,
            formatted: formatted,
            days: days,
            hours: hours,
            minutes_only: minutes
        };
    }

    /**
     * Formatuje minuty na czytelny format czasu
     * @param {number} totalMinutes - Łączna liczba minut
     * @returns {string} - Sformatowany czas (np. "1d 4h 30m")
     */
    formatTimeDisplay(totalMinutes) {
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        
        let parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        
        return parts.join(' ');
    }

    /**
     * Obsługuje testową komendę kickowania
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleTestKickCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /test-kick`, interaction);
        
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Tylko administratorzy mogą używać tej komendy testowej.',
                ephemeral: true
            });
            return;
        }

        if (!this.roleKickingService) {
            await interaction.reply({
                content: '❌ Serwis kickowania nie jest dostępny.',
                ephemeral: true
            });
            return;
        }

        const productionMode = interaction.options.getBoolean('produkcyjny') || false;
        const dryRun = !productionMode;

        await interaction.deferReply({ ephemeral: true });

        try {
            const modeText = productionMode ? '⚠️ TRYB PRODUKCYJNY - BĘDZIE RZECZYWISTE KICKOWANIE!' : '🧪 TRYB TESTOWY - TYLKO SYMULACJA';
            await interaction.editReply({ content: `${modeText}\n\nUruchamiam system kickowania...` });
            
            // Wywołaj manualnie sprawdzenie kickowania
            await this.roleKickingService.manualCheck(dryRun);
            
            const resultText = productionMode ? 
                '✅ System kickowania został uruchomiony w trybie produkcyjnym.' : 
                '✅ Test systemu kickowania został ukończony. Sprawdź logi dla szczegółów.';
            
            await interaction.editReply({ content: resultText });
            
            const logText = productionMode ? 
                `System kickowania został uruchomiony w trybie PRODUKCYJNYM przez ${interaction.user.tag}` :
                `Test systemu kickowania został uruchomiony przez ${interaction.user.tag}`;
            
            await this.logService.logMessage('success', logText, interaction);
            
        } catch (error) {
            await interaction.editReply({ content: `❌ Błąd podczas testu kickowania: ${error.message}` });
            await this.logService.logMessage('error', `Błąd podczas testu kickowania: ${error.message}`, interaction);
        }
    }

    /**
     * Obsługuje komendę blokowania zdjęć
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleBlockSsCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /block-ss`, interaction);
        
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Tylko administratorzy mogą używać tej komendy!',
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /block-ss bez uprawnień administratora`, interaction);
            return;
        }

        const timeString = interaction.options.getString('czas');
        const channel = interaction.options.getChannel('kanał');

        if (!channel || !channel.isTextBased()) {
            await interaction.reply({
                content: '❌ Podany kanał musi być kanałem tekstowym!',
                ephemeral: true
            });
            return;
        }

        // Parse time format hh:mm dd.mm.yyyy
        const parsedTime = this.parseBlockTime(timeString);
        if (parsedTime.error) {
            await interaction.reply({
                content: `❌ Nieprawidłowy format czasu: ${parsedTime.error}\nPrzykład poprawnego formatu: 23:59 31.12.2024`,
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Użyj serwisu z messageHandler (współdzielony)
            if (!this.messageHandler.imageBlockService) {
                await this.messageHandler.initializeImageBlockService();
            }

            // Dodaj blokadę
            const result = await this.messageHandler.imageBlockService.addBlock(channel.id, parsedTime.endTime, interaction.user.id);
            
            if (result.success) {
                const successMessage = `✅ Zablokowano wrzucanie zdjęć na kanale **${channel.id}**\n` +
                    `🕒 Blokada będzie aktywna do: **${parsedTime.formatted}**\n` +
                    `👮 Zablokowane przez: **${interaction.user.tag}**`;
                
                await interaction.editReply({ content: successMessage });
                
                await this.logService.logMessage('success', 
                    `Zablokowano wrzucanie zdjęć na kanale ${channel.id} do ${parsedTime.formatted} przez ${interaction.user.tag}`, 
                    interaction
                );
            } else {
                await interaction.editReply({ content: `❌ ${result.message}` });
            }

        } catch (error) {
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas blokowania kanału: ${error.message}` });
            await this.logService.logMessage('error', `Błąd podczas blokowania kanału: ${error.message}`, interaction);
        }
    }

    /**
     * Parsuje format czasu dla blokady zdjęć (hh:mm dd.mm.yyyy)
     * @param {string} timeString - String z czasem do sparsowania
     * @returns {Object} - {endTime: Date, error: string|null, formatted: string}
     */
    parseBlockTime(timeString) {
        if (!timeString || typeof timeString !== 'string') {
            return { error: 'Nie podano czasu' };
        }

        const timeString_clean = timeString.trim();
        
        // Regex dla formatu hh:mm dd.mm.yyyy
        const timeMatch = timeString_clean.match(/^(\d{1,2}):(\d{1,2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        
        if (!timeMatch) {
            return { error: 'Format musi być: hh:mm dd.mm.yyyy (np. 23:59 31.12.2024)' };
        }
        
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const day = parseInt(timeMatch[3]);
        const month = parseInt(timeMatch[4]);
        const year = parseInt(timeMatch[5]);
        
        // Walidacja
        if (hours < 0 || hours > 23) {
            return { error: 'Godziny muszą być między 00 a 23' };
        }
        
        if (minutes < 0 || minutes > 59) {
            return { error: 'Minuty muszą być między 00 a 59' };
        }
        
        if (month < 1 || month > 12) {
            return { error: 'Miesiąc musi być między 01 a 12' };
        }
        
        if (day < 1 || day > 31) {
            return { error: 'Dzień musi być między 01 a 31' };
        }
        
        // Interpretuj czas jako czas polski i zapisz jako UTC
        // Użyj Date.UTC() ale odejmij offset Polski (2 godziny w lecie, 1 w zimie)
        const isDST = this.isDaylightSavingTime(new Date(year, month - 1, day));
        const polandOffset = isDST ? 2 : 1; // UTC+2 w lecie, UTC+1 w zimie
        
        // Utwórz datę UTC ale przesuń o offset Polski w tył, żeby reprezentowała czas polski
        const endTime = new Date(Date.UTC(year, month - 1, day, hours - polandOffset, minutes, 0, 0));
        
        // Sprawdź czy data jest w przyszłości
        if (endTime <= new Date()) {
            return { error: 'Data musi być w przyszłości (czas polski)' };
        }
        
        const formatted = endTime.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
        
        return {
            endTime: endTime,
            error: null,
            formatted: formatted
        };
    }

    /**
     * Sprawdza czy data jest w czasie letnim (DST) w Polsce
     * @param {Date} date - Data do sprawdzenia
     * @returns {boolean} - Czy jest czas letni
     */
    isDaylightSavingTime(date) {
        const year = date.getFullYear();
        // Czas letni w Europie: ostatnia niedziela marca - ostatnia niedziela października
        const march = new Date(year, 2, 31);
        const october = new Date(year, 9, 31);
        
        // Znajdź ostatnią niedzielę marca
        const lastSundayMarch = new Date(march.getTime() - (march.getDay() * 24 * 60 * 60 * 1000));
        
        // Znajdź ostatnią niedzielę października  
        const lastSundayOctober = new Date(october.getTime() - (october.getDay() * 24 * 60 * 60 * 1000));
        
        return date >= lastSundayMarch && date < lastSundayOctober;
    }

    /**
     * Obsługuje komendę blokowania słów
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleBlockWordCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /block-word`, interaction);
        
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Tylko administratorzy mogą używać tej komendy!',
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /block-word bez uprawnień administratora`, interaction);
            return;
        }

        const word = interaction.options.getString('słowo');
        const timeString = interaction.options.getString('czas');
        const shouldTimeout = interaction.options.getBoolean('timeout');
        const timeoutDuration = interaction.options.getString('na_ile');
        const inside = interaction.options.getBoolean('inside');

        // Walidacja: jeśli timeout=true, na_ile musi być podane
        if (shouldTimeout && !timeoutDuration) {
            await interaction.reply({
                content: '❌ Gdy timeout jest ustawione na true, musisz podać parametr "na_ile"!',
                ephemeral: true
            });
            return;
        }

        // Parse time format gg:mm dd:mm:rrrr
        const parsedTime = this.parseWordBlockTime(timeString);
        if (parsedTime.error) {
            await interaction.reply({
                content: `❌ Nieprawidłowy format czasu: ${parsedTime.error}\nPrzykład poprawnego formatu: 23:59 31.12.2024`,
                ephemeral: true
            });
            return;
        }

        // Parse timeout duration if provided
        let parsedTimeoutDuration = null;
        if (shouldTimeout && timeoutDuration) {
            parsedTimeoutDuration = this.parseTimeFormat(timeoutDuration);
            if (parsedTimeoutDuration.error) {
                await interaction.reply({
                    content: `❌ Nieprawidłowy format czasu timeout: ${parsedTimeoutDuration.error}\nPrzykład poprawnego formatu: 1h30m (1 godzina, 30 minut)`,
                    ephemeral: true
                });
                return;
            }
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Użyj serwisu z messageHandler (współdzielony)
            if (!this.messageHandler.wordBlockService) {
                await this.messageHandler.initializeWordBlockService();
            }

            // Dodaj blokadę słowa
            const result = await this.messageHandler.wordBlockService.addWordBlock(
                word,
                parsedTime.endTime,
                shouldTimeout,
                parsedTimeoutDuration ? parsedTimeoutDuration.minutes : null,
                inside,
                interaction.user.id
            );
            
            if (result.success) {
                let successMessage = `✅ Zablokowano słowo **"${word}"**\n` +
                    `🕒 Blokada będzie aktywna do: **${parsedTime.formatted}**\n`;
                
                if (shouldTimeout && parsedTimeoutDuration) {
                    successMessage += `⏰ Timeout za użycie: **${parsedTimeoutDuration.formatted}**\n`;
                } else {
                    successMessage += `⏰ Bez timeout - tylko usuwanie wiadomości\n`;
                }
                
                successMessage += `🔍 Tryb blokady: **${inside ? 'Również jako część innych słów' : 'Tylko jako całe słowo'}**\n`;
                successMessage += `👮 Zablokowane przez: **${interaction.user.tag}**`;
                
                await interaction.editReply({ content: successMessage });
                
                await this.logService.logMessage('success', 
                    `Zablokowano słowo "${word}" do ${parsedTime.formatted} przez ${interaction.user.tag}`, 
                    interaction
                );
            } else {
                await interaction.editReply({ content: `❌ ${result.message}` });
            }

        } catch (error) {
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas blokowania słowa: ${error.message}` });
            await this.logService.logMessage('error', `Błąd podczas blokowania słowa: ${error.message}`, interaction);
        }
    }

    /**
     * Parsuje format czasu dla blokady słów (gg:mm dd:mm:rrrr)
     * @param {string} timeString - String z czasem do sparsowania
     * @returns {Object} - {endTime: Date, error: string|null, formatted: string}
     */
    parseWordBlockTime(timeString) {
        if (!timeString || typeof timeString !== 'string') {
            return { error: 'Nie podano czasu' };
        }

        const timeString_clean = timeString.trim();
        
        // Regex dla formatu gg:mm dd.mm.rrrr
        const timeMatch = timeString_clean.match(/^(\d{1,2}):(\d{1,2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        
        if (!timeMatch) {
            return { error: 'Format musi być: gg:mm dd.mm.rrrr (np. 23:59 31.12.2024)' };
        }
        
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const day = parseInt(timeMatch[3]);
        const month = parseInt(timeMatch[4]);
        const year = parseInt(timeMatch[5]);
        
        // Walidacja
        if (hours < 0 || hours > 23) {
            return { error: 'Godziny muszą być między 00 a 23' };
        }
        
        if (minutes < 0 || minutes > 59) {
            return { error: 'Minuty muszą być między 00 a 59' };
        }
        
        if (month < 1 || month > 12) {
            return { error: 'Miesiąc musi być między 01 a 12' };
        }
        
        if (day < 1 || day > 31) {
            return { error: 'Dzień musi być między 01 a 31' };
        }
        
        // Interpretuj czas jako czas polski i zapisz jako UTC
        // Użyj Date.UTC() ale odejmij offset Polski (2 godziny w lecie, 1 w zimie)
        const isDST = this.isDaylightSavingTime(new Date(year, month - 1, day));
        const polandOffset = isDST ? 2 : 1; // UTC+2 w lecie, UTC+1 w zimie
        
        // Utwórz datę UTC ale przesuń o offset Polski w tył, żeby reprezentowała czas polski
        const endTime = new Date(Date.UTC(year, month - 1, day, hours - polandOffset, minutes, 0, 0));
        
        // Sprawdź czy data jest w przyszłości
        if (endTime <= new Date()) {
            return { error: 'Data musi być w przyszłości (czas polski)' };
        }
        
        const formatted = endTime.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
        
        return {
            endTime: endTime,
            error: null,
            formatted: formatted
        };
    }

    /**
     * Obsługuje komendę dodawania ról
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleAddRolesCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /add-roles`, interaction);

        // Sprawdź uprawnienia administratora
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Tylko administratorzy mogą używać tej komendy!',
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /add-roles bez uprawnień`, interaction);
            return;
        }

        const roleToAdd = interaction.options.getRole('rola_do_nadania');
        const targetRole = interaction.options.getRole('rola_komu');

        if (!roleToAdd) {
            await interaction.reply({
                content: '❌ Nie znaleziono roli do nadania!',
                ephemeral: true
            });
            return;
        }

        // Sprawdź hierarchię ról (bot musi być wyżej niż rola którą nadaje)
        if (roleToAdd.position >= interaction.guild.members.me.roles.highest.position) {
            await interaction.reply({
                content: `❌ Nie mogę nadać roli **${roleToAdd.name}**, ponieważ jest ona wyżej lub na tym samym poziomie co moja najwyższa rola w hierarchii!`,
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Pobierz wszystkich członków serwera
            const members = await interaction.guild.members.fetch();

            // Filtruj członków
            let targetMembers;
            if (targetRole) {
                // Tylko członkowie z określoną rolą
                targetMembers = members.filter(member =>
                    member.roles.cache.has(targetRole.id) && !member.user.bot
                );
            } else {
                // Wszyscy członkowie (bez botów)
                targetMembers = members.filter(member => !member.user.bot);
            }

            if (targetMembers.size === 0) {
                const noUsersMessage = targetRole
                    ? `❌ Nie znaleziono użytkowników z rolą **${targetRole.name}**!`
                    : `❌ Nie znaleziono użytkowników na serwerze!`;

                await interaction.editReply({ content: noUsersMessage });
                return;
            }

            // Filtruj użytkowników, którzy już mają tę rolę
            const membersToUpdate = targetMembers.filter(member =>
                !member.roles.cache.has(roleToAdd.id)
            );

            if (membersToUpdate.size === 0) {
                const alreadyHaveMessage = targetRole
                    ? `✅ Wszyscy użytkownicy z rolą **${targetRole.name}** już posiadają rolę **${roleToAdd.name}**!`
                    : `✅ Wszyscy użytkownicy na serwerze już posiadają rolę **${roleToAdd.name}**!`;

                await interaction.editReply({ content: alreadyHaveMessage });
                return;
            }

            const targetDescription = targetRole
                ? `użytkownikom z rolą **${targetRole.name}**`
                : `**wszystkim** użytkownikom na serwerze`;

            await this.logService.logMessage('info',
                `Rozpoczynanie nadawania roli ${roleToAdd.name} ${membersToUpdate.size} użytkownikom`,
                interaction
            );

            const startMessage = `⏳ Rozpoczynam nadawanie roli **${roleToAdd.name}** ${targetDescription}...\n` +
                `👥 Użytkowników do zaktualizowania: **${membersToUpdate.size}**\n` +
                `⏰ Szacowany czas: **${Math.ceil(membersToUpdate.size / 60)} minut**`;

            await interaction.editReply({ content: startMessage });

            let successCount = 0;
            let errorCount = 0;
            const delayBetweenAdds = 1000; // 1 sekunda opóźnienia między każdym nadaniem

            let delay = 0;

            for (const [memberId, member] of membersToUpdate) {
                setTimeout(async () => {
                    try {
                        await member.roles.add(roleToAdd);
                        successCount++;

                        // Co 10 użytkowników wyślij update
                        if (successCount % 10 === 0) {
                            const progressMessage = `⏳ Postęp: **${successCount}/${membersToUpdate.size}** użytkowników zaktualizowanych...`;
                            await interaction.editReply({ content: progressMessage }).catch(() => {});
                        }

                        // Jeśli to ostatni użytkownik
                        if (successCount + errorCount === membersToUpdate.size) {
                            const completionMessage = `✅ **Zakończono!**\n\n` +
                                `📊 Nadano rolę **${roleToAdd.name}** ${targetDescription}\n` +
                                `✅ Sukces: **${successCount}**\n` +
                                `❌ Błędy: **${errorCount}**`;

                            await interaction.editReply({ content: completionMessage });
                            await this.logService.logMessage('success',
                                `Nadawanie roli ${roleToAdd.name} zakończone. Sukces: ${successCount}, Błędy: ${errorCount}`,
                                interaction
                            );
                        }
                    } catch (error) {
                        errorCount++;
                        await this.logService.logMessage('error',
                            `Błąd podczas nadawania roli użytkownikowi ${member.user.tag}: ${error.message}`,
                            interaction
                        );

                        // Jeśli to ostatni użytkownik (nawet po błędzie)
                        if (successCount + errorCount === membersToUpdate.size) {
                            const completionMessage = `✅ **Zakończono z błędami!**\n\n` +
                                `📊 Nadano rolę **${roleToAdd.name}** ${targetDescription}\n` +
                                `✅ Sukces: **${successCount}**\n` +
                                `❌ Błędy: **${errorCount}**`;

                            await interaction.editReply({ content: completionMessage });
                            await this.logService.logMessage('warn',
                                `Nadawanie roli ${roleToAdd.name} zakończone z błędami. Sukces: ${successCount}, Błędy: ${errorCount}`,
                                interaction
                            );
                        }
                    }
                }, delay);

                delay += delayBetweenAdds;
            }

        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas nadawania ról: ${error.message}`, interaction);
            await interaction.editReply({
                content: `❌ Wystąpił błąd podczas nadawania ról: ${error.message}`
            });
        }
    }

    /**
     * Obsługuje komendę chaos mode
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleChaosModeCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /chaos-mode`, interaction);

        // Sprawdź uprawnienia administratora
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Tylko administratorzy mogą używać tej komendy!',
                ephemeral: true
            });
            await this.logService.logMessage('warn', `Użytkownik ${interaction.user.tag} próbował użyć komendy /chaos-mode bez uprawnień`, interaction);
            return;
        }

        // Sprawdź czy chaosService jest dostępny
        if (!this.chaosService) {
            await interaction.reply({
                content: '❌ Chaos Service nie jest zainicjalizowany!',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Zbierz wszystkie role
            const roles = [];
            for (let i = 1; i <= 5; i++) {
                const role = interaction.options.getRole(`rola_${i}`);
                if (role) {
                    // Sprawdź hierarchię ról
                    if (role.position >= interaction.guild.members.me.roles.highest.position) {
                        await interaction.editReply({
                            content: `❌ Nie mogę nadawać roli **${role.name}**, ponieważ jest ona wyżej lub na tym samym poziomie co moja najwyższa rola w hierarchii!`
                        });
                        return;
                    }
                    roles.push(role.id);
                }
            }

            if (roles.length === 0) {
                // Brak ról - wyłącz Chaos Mode
                const result = await this.chaosService.disableChaosMode(interaction.guild);
                await interaction.editReply({ content: result.message });

                if (result.success) {
                    await this.logService.logMessage('success', `Chaos Mode wyłączony przez ${interaction.user.tag}`, interaction);
                }
            } else {
                // Role wybrane - włącz Chaos Mode
                const result = await this.chaosService.enableChaosMode(roles);
                await interaction.editReply({ content: result.message });

                if (result.success) {
                    await this.logService.logMessage('success', `Chaos Mode włączony przez ${interaction.user.tag}, role: ${roles.join(', ')}`, interaction);
                }
            }

        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas obsługi /chaos-mode: ${error.message}`, interaction);
            await interaction.editReply({
                content: `❌ Wystąpił błąd: ${error.message}`
            });
        }
    }

    /**
     * Obsługuje komendę /komendy - wyświetla listę komend z nawigacją po botach (1 bot = 1 strona)
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleKomendyCommand(interaction) {
        await this.logService.logMessage('info', `Użytkownik ${interaction.user.tag} użył komendy /komendy`, interaction);

        try {
            const fs = require('fs');
            const { MessageFlags } = require('discord.js');
            const commandsDataPath = './Muteusz/config/all_commands.json';

            if (!fs.existsSync(commandsDataPath)) {
                await interaction.reply({
                    content: '❌ Nie znaleziono pliku z danymi komend.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const commandsData = JSON.parse(fs.readFileSync(commandsDataPath, 'utf8'));

            // Sprawdź uprawnienia użytkownika
            const member = interaction.member;
            const isAdmin = member.permissions.has('Administrator');

            const moderatorRoleIds = ['1196911721588199464', '1196586785413795850', '1170332302715396106'];
            const isModerator = moderatorRoleIds.some(roleId => member.roles.cache.has(roleId));

            const clanRoleIds = ['1194249987677229186', '1196805078162616480', '1210265548584132648', '1262793135860355254'];
            const hasClanRole = clanRoleIds.some(roleId => member.roles.cache.has(roleId));

            const virtuttiRoleId = '1387383527653376081';
            const hasVirtuttiRole = member.roles.cache.has(virtuttiRoleId);

            // Kolejność botów - Muteusz na pierwszym miejscu
            const botOrder = ['Muteusz', 'Rekruter', 'Gary', 'Kontroler', 'Stalker', 'Szkolenia', 'Wydarzynier', 'Konklawe', 'EndersEcho'];

            // Filtruj i sortuj boty według uprawnień
            const availableBots = [];
            let totalCommandCount = 0;

            for (const botName of botOrder) {
                const bot = commandsData.bots.find(b => b.name === botName);
                if (!bot || bot.commands.length === 0) continue;

                const availableCommands = bot.commands.filter(cmd => {
                    switch (cmd.requiredPermission) {
                        case 'administrator':
                            return isAdmin;
                        case 'moderator':
                            return isModerator || isAdmin;
                        case 'clan_member':
                            return hasClanRole || isModerator || isAdmin;
                        case 'achievement_role':
                            return hasVirtuttiRole || isAdmin;
                        case 'special_role':
                            return false; // Brak implementacji specjalnych ról
                        case 'public':
                            return true;
                        default:
                            return false;
                    }
                });

                if (availableCommands.length > 0) {
                    // Sortuj komendy alfabetycznie po nazwie
                    availableCommands.sort((a, b) => a.name.localeCompare(b.name));
                    availableBots.push({ ...bot, availableCommands });
                    totalCommandCount += availableCommands.length;
                }
            }

            if (totalCommandCount === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('📋 Lista Komend - Polski Squad Bots')
                    .setColor(0x0099FF)
                    .setDescription('❌ Nie masz dostępu do żadnych komend.\n\nAby uzyskać dostęp do komend, dołącz do jednego z klanów lub zdobądź odpowiednie uprawnienia.')
                    .setFooter({ text: 'Twoje uprawnienia: Użytkownik' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            // ID botów do pobierania awatarów
            const botIds = {
                'Muteusz': '1378427475779915866',
                'Rekruter': '1383838374795935914',
                'Gary': '1414880986872811562',
                'Kontroler': '1378061337548034158',
                'Stalker': '1391011355376488570',
                'Szkolenia': '1377967442805915758',
                'Wydarzynier': '1400198466180743408',
                'Konklawe': '1377388570196836382',
                'EndersEcho': '1378450734919712839'
            };

            // Pobierz awatary botów
            const botIcons = {};
            for (const [botName, botId] of Object.entries(botIds)) {
                try {
                    const bot = await interaction.client.users.fetch(botId);
                    botIcons[botName] = bot.displayAvatarURL({ size: 256, extension: 'png' });
                } catch (error) {
                    // Jeśli nie można pobrać awatara, użyj domyślnego
                    botIcons[botName] = null;
                }
            }

            // Funkcja do tworzenia embeda dla konkretnego bota
            const createBotEmbed = (botIndex) => {
                const bot = availableBots[botIndex];
                const embed = new EmbedBuilder()
                    .setTitle(`📋 ${bot.name} - Komendy`)
                    .setColor(isAdmin ? 0xFF0000 : (isModerator ? 0xFFA500 : (hasClanRole ? 0x00FF00 : 0x0099FF)))
                    .setDescription(`**${bot.description}**\n\n${bot.availableCommands.length} komend dostępnych dla Ciebie.`)
                    .setFooter({ text: `${isAdmin ? 'Administrator' : (isModerator ? 'Moderator' : (hasClanRole ? 'Członek Klanu' : 'Użytkownik'))} • Bot ${botIndex + 1}/${availableBots.length} • Łącznie: ${totalCommandCount} komend` })
                    .setTimestamp();

                // Dodaj thumbnail jeśli bot ma ikonę
                if (botIcons[bot.name]) {
                    embed.setThumbnail(botIcons[bot.name]);
                }

                // Dodaj komendy
                let commandsList = '';
                for (const cmd of bot.availableCommands) {
                    const permIcon = commandsData.permissionLevels[cmd.requiredPermission]?.icon || '📌';
                    commandsList += `${permIcon} \`${cmd.name}\`\n`;
                    commandsList += `└─ ${cmd.description}\n\n`;
                }

                // Discord limit: 1024 znaki na field, 6000 na cały embed
                const maxFieldLength = 1024;
                if (commandsList.length <= maxFieldLength) {
                    embed.addFields({
                        name: '\u200B',
                        value: commandsList.trim(),
                        inline: false
                    });
                } else {
                    // Podziel na części
                    const commands = bot.availableCommands;
                    let currentSection = '';

                    for (const cmd of commands) {
                        const permIcon = commandsData.permissionLevels[cmd.requiredPermission]?.icon || '📌';
                        const cmdText = `${permIcon} \`${cmd.name}\`\n└─ ${cmd.description}\n\n`;

                        if ((currentSection + cmdText).length > maxFieldLength) {
                            embed.addFields({
                                name: '\u200B',
                                value: currentSection.trim(),
                                inline: false
                            });
                            currentSection = cmdText;
                        } else {
                            currentSection += cmdText;
                        }
                    }

                    if (currentSection.trim().length > 0) {
                        embed.addFields({
                            name: '\u200B',
                            value: currentSection.trim(),
                            inline: false
                        });
                    }
                }

                // Dodaj legendę ikon uprawnień na dole
                const permissionsLegend = '\n\n**Legenda uprawnień:**\n' +
                    `${commandsData.permissionLevels.administrator?.icon || '🔧'} Administrator • ` +
                    `${commandsData.permissionLevels.moderator?.icon || '🛡️'} Moderator • ` +
                    `${commandsData.permissionLevels.clan_member?.icon || '⚔️'} Członek Klanu\n` +
                    `${commandsData.permissionLevels.achievement_role?.icon || '🏅'} Osiągnięcie • ` +
                    `${commandsData.permissionLevels.special_role?.icon || '👑'} Specjalna Rola • ` +
                    `${commandsData.permissionLevels.public?.icon || '👤'} Publiczne`;

                embed.addFields({
                    name: '\u200B',
                    value: permissionsLegend,
                    inline: false
                });

                return embed;
            };

            // Funkcja do tworzenia przycisków nawigacji (wszystkie boty, bez prev/next)
            const createButtons = (currentBotIndex) => {
                const totalBots = availableBots.length;

                // Discord pozwala max 5 przycisków w jednym ActionRow
                // Jeśli botów jest więcej niż 5, musimy użyć 2 rzędów
                const buttonRows = [];
                const buttons = [];

                for (let i = 0; i < totalBots; i++) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`komendy_bot_${i}_${interaction.user.id}`)
                            .setLabel(availableBots[i].name)
                            .setStyle(i === currentBotIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
                            .setDisabled(i === currentBotIndex)
                    );
                }

                // Podziel przyciski na rzędy (max 5 na rząd)
                for (let i = 0; i < buttons.length; i += 5) {
                    const rowButtons = buttons.slice(i, i + 5);
                    buttonRows.push(new ActionRowBuilder().addComponents(rowButtons));
                }

                return buttonRows;
            };

            // Wyślij pierwszy bot (Muteusz)
            await interaction.reply({
                embeds: [createBotEmbed(0)],
                components: createButtons(0),
                flags: MessageFlags.Ephemeral
            });

            await this.logService.logMessage('success', `Wysłano listę komend dla ${interaction.user.tag} (${totalCommandCount} komend, ${availableBots.length} botów)`, interaction);

            // Obsługa przycisków
            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId.startsWith('komendy_'),
                time: 600000 // 10 minut
            });

            let currentBotIndex = 0;

            collector.on('collect', async i => {
                const parts = i.customId.split('_');
                const action = parts[1];

                if (action === 'bot') {
                    currentBotIndex = parseInt(parts[2]);
                }

                await i.update({
                    embeds: [createBotEmbed(currentBotIndex)],
                    components: createButtons(currentBotIndex)
                });
            });

            collector.on('end', () => {
                // Timeout - przyciski przestaną działać
            });

        } catch (error) {
            await this.logService.logMessage('error', `Błąd podczas obsługi komendy /komendy: ${error.message}`, interaction);

            const { MessageFlags } = require('discord.js');
            const replyOptions = {
                content: `❌ Wystąpił błąd podczas generowania listy komend: ${error.message}`,
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        }
    }

    /**
     * Obsługuje komendę /data-archive - tworzy manualną archiwizację wszystkich danych botów
     * @param {ChatInputCommandInteraction} interaction - Interakcja Discord
     */
    async handleDataArchiveCommand(interaction) {
        const { MessageFlags } = require('discord.js');

        // Sprawdź uprawnienia administratora
        if (!this.isAdminOrModerator(interaction.member) && !interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Nie masz uprawnień do użycia tej komendy. Wymaga uprawnień Administratora.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await this.logService.logMessage('info', `Administrator ${interaction.user.tag} wywołał komendę /data-archive`, interaction);

        // Defer reply ponieważ backup może trwać długo
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Import BackupManager
            const BackupManager = require('../../utils/backupManager');
            const backupManager = new BackupManager();

            // Czekaj chwilę na inicjalizację Google Drive API
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Wykonaj manualny backup
            const userName = interaction.user.username.replace(/[^a-zA-Z0-9]/g, '_');
            const results = await backupManager.createManualBackup(userName);

            // Przygotuj odpowiedź
            const totalSizeMB = (results.totalSize / 1024 / 1024).toFixed(2);

            let responseMessage = '✅ **Manualny backup zakończony!**\n\n';

            if (results.success.length > 0) {
                responseMessage += `**Pomyślnie zarchiwizowane boty (${results.success.length}):**\n`;
                results.success.forEach(item => {
                    const sizeMB = (item.size / 1024 / 1024).toFixed(2);
                    responseMessage += `✅ ${item.bot} (${sizeMB} MB)\n`;
                });
                responseMessage += `\n**Całkowity rozmiar:** ${totalSizeMB} MB\n`;
            }

            if (results.failed.length > 0) {
                responseMessage += `\n**Błędy (${results.failed.length}):**\n`;
                results.failed.forEach(item => {
                    responseMessage += `❌ ${item.bot}: ${item.reason}\n`;
                });
            }

            responseMessage += '\n📁 **Lokalizacja:** Google Drive → `Polski_Squad_Manual_Backups`';
            responseMessage += '\n⚠️ Te backupy NIE są automatycznie usuwane.';

            await interaction.editReply({
                content: responseMessage,
                flags: MessageFlags.Ephemeral
            });

            await this.logService.logMessage('success',
                `Manualny backup zakończony przez ${interaction.user.tag}. Sukces: ${results.success.length}, Błędy: ${results.failed.length}`,
                interaction
            );

        } catch (error) {
            logger.error('❌ Błąd podczas wykonywania manualnego backupu:', error);

            await interaction.editReply({
                content: `❌ Wystąpił błąd podczas tworzenia backupu:\n\`\`\`${error.message}\`\`\``,
                flags: MessageFlags.Ephemeral
            });

            await this.logService.logMessage('error',
                `Błąd manualnego backupu przez ${interaction.user.tag}: ${error.message}`,
                interaction
            );
        }
    }

    /**
     * Context menu: prawy klik na wiadomość → "Zgłoś wiadomość"
     * Otwiera modal z polem powodu, następnie tworzy raport dla moderatorów.
     */
    async handleReportMessageContextMenu(interaction) {
        const targetMessage = interaction.targetMessage;
        const modal = new ModalBuilder()
            .setCustomId(`context_report_modal_${targetMessage.channelId}_${targetMessage.id}`)
            .setTitle('Zgłoś wiadomość');

        const powodInput = new TextInputBuilder()
            .setCustomId('report_reason')
            .setLabel('Powód zgłoszenia (opcjonalny)')
            .setPlaceholder('Opisz krótko dlaczego zgłaszasz tę wiadomość...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(powodInput));
        await interaction.showModal(modal);
    }

    /**
     * Obsługuje submit modalu po "Zgłoś wiadomość" z context menu
     */
    async handleContextReportModalSubmit(interaction) {
        // customId: context_report_modal_{channelId}_{messageId}
        const parts = interaction.customId.split('_');
        // parts: ['context', 'report', 'modal', channelId, messageId]
        const channelId = parts[3];
        const messageId = parts[4];
        const powod = interaction.fields.getTextInputValue('report_reason') || 'Brak podanego powodu';

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetChannel = await interaction.client.channels.fetch(channelId);
            const targetMessage = await targetChannel.messages.fetch(messageId);
            const guildId = interaction.guildId;
            const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

            await this.processReport(interaction, link, powod, true, targetMessage);
        } catch {
            await interaction.editReply({ content: '❌ Nie znaleziono wiadomości. Mogła zostać usunięta.' });
        }
    }

    /**
     * Context menu: prawy klik na użytkownika → "Wycisz użytkownika" (moderator-only)
     * Otwiera modal z czasem wyciszenia.
     */
    async handleMuteUserContextMenu(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({ content: '❌ Tylko moderatorzy mogą wyciszać użytkowników.', ephemeral: true });
            return;
        }

        const targetUser = interaction.targetUser;
        const muteModal = new ModalBuilder()
            .setCustomId(`context_mute_modal_${targetUser.id}`)
            .setTitle(`Wycisz: ${targetUser.username}`);

        const durationInput = new TextInputBuilder()
            .setCustomId('mute_duration')
            .setLabel('Czas wyciszenia (np. 10m, 2h, 1d)')
            .setPlaceholder('Przykłady: 10m, 30m, 2h, 12h, 1d, 7d')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const reasonInput = new TextInputBuilder()
            .setCustomId('mute_reason')
            .setLabel('Powód (opcjonalny)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        muteModal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );
        await interaction.showModal(muteModal);
    }

    /**
     * Obsługuje submit modalu po "Wycisz użytkownika" z context menu
     */
    async handleContextMuteModalSubmit(interaction) {
        // customId: context_mute_modal_{userId}
        const userId = interaction.customId.split('_')[3];
        const durationRaw = interaction.fields.getTextInputValue('mute_duration');
        const reason = interaction.fields.getTextInputValue('mute_reason') || `Wyciszony przez ${interaction.user.tag}`;

        const parsed = this.parseMuteDuration(durationRaw);
        if (!parsed) {
            await interaction.reply({
                content: '❌ Nieprawidłowy format czasu. Użyj np. `10m`, `2h`, `1d`. Maksymalnie 28 dni.',
                ephemeral: true
            });
            return;
        }

        try {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika na serwerze.', ephemeral: true });
                return;
            }

            await member.timeout(parsed.ms, reason);

            await interaction.reply({
                content: `✅ Użytkownik <@${userId}> został wyciszony na **${parsed.label}**.\n> Powód: ${reason}`,
                ephemeral: true
            });

            await this.logService.logMessage('info',
                `Wyciszono ${member.user.tag} na ${parsed.label} przez ${interaction.user.tag} (context menu). Powód: ${reason}`,
                interaction
            );
        } catch (error) {
            logger.error('❌ Błąd podczas wyciszania użytkownika (context menu):', error);
            await interaction.reply({ content: `❌ Nie udało się wyciszyć: ${error.message}`, ephemeral: true });
        }
    }

    /**
     * Context menu: prawy klik na użytkownika → "Ostrzeż użytkownika" (moderator-only)
     * Otwiera modal z powodem, następnie nakłada ostrzeżenie.
     */
    async handleWarnUserContextMenu(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({ content: '❌ Tylko moderatorzy mogą ostrzegać użytkowników.', ephemeral: true });
            return;
        }

        const targetUser = interaction.targetUser;
        const warnModal = new ModalBuilder()
            .setCustomId(`context_warn_modal_${targetUser.id}`)
            .setTitle(`Ostrzeż: ${targetUser.username}`);

        const reasonInput = new TextInputBuilder()
            .setCustomId('warn_reason')
            .setLabel('Powód ostrzeżenia')
            .setPlaceholder('Opisz powód ostrzeżenia...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        warnModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(warnModal);
    }

    /**
     * Obsługuje submit modalu po "Ostrzeż użytkownika" z context menu
     */
    async handleContextWarnModalSubmit(interaction) {
        // customId: context_warn_modal_{userId}
        const userId = interaction.customId.split('_')[3];
        const reason = interaction.fields.getTextInputValue('warn_reason');

        try {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika na serwerze.', ephemeral: true });
                return;
            }

            const warning = await this.warningService.addWarning(userId, interaction.user.id, interaction.user.tag, reason, interaction.guildId);
            const allWarnings = await this.warningService.getUserWarnings(userId, interaction.guildId);

            await interaction.reply({
                content: `✅ Użytkownik <@${userId}> otrzymał ostrzeżenie.\n> Powód: ${reason}\nŁącznie ostrzeżeń: **${allWarnings.length}**`,
                ephemeral: true
            });

            await this.logService.logMessage('info',
                `Ostrzeżono ${member.user.tag} przez ${interaction.user.tag} (context menu). Powód: ${reason}`,
                interaction
            );
        } catch (error) {
            logger.error('❌ Błąd podczas ostrzegania użytkownika (context menu):', error);
            await interaction.reply({ content: `❌ Nie udało się ostrzec użytkownika: ${error.message}`, ephemeral: true });
        }
    }

    /**
     * Parsuje czas wyciszenia z formatu 1m/1h/1d na milisekundy.
     * Zwraca { ms, label } lub null jeśli format nieprawidłowy.
     */
    parseMuteDuration(input) {
        const match = input.trim().match(/^(\d+)\s*([mhd])$/i);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        if (value <= 0) return null;

        const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
        const ms = value * multipliers[unit];
        const unitNames = { m: value === 1 ? 'minutę' : value < 5 ? 'minuty' : 'minut',
                            h: value === 1 ? 'godzinę' : value < 5 ? 'godziny' : 'godzin',
                            d: value === 1 ? 'dzień' : value < 5 ? 'dni' : 'dni' };
        const label = `${value} ${unitNames[unit]}`;

        // Discord timeout max: 28 dni
        const maxMs = 28 * 24 * 60 * 60 * 1000;
        if (ms > maxMs) return null;

        return { ms, label };
    }

    /**
     * Obsługuje submit modalu czasu wyciszenia
     */
    /**
     * Wyciąga ID reportera z embeda zgłoszenia (pole "👤 Zgłaszający")
     */
    extractReporterIdFromEmbed(embed) {
        const field = embed?.fields?.find(f => f.name === '👤 Zgłaszający');
        if (!field) return null;
        const match = field.value.match(/<@(\d+)>/);
        return match ? match[1] : null;
    }

    /**
     * Wyciąga ID zgłoszonego użytkownika z embeda zgłoszenia (pole "🎯 Zgłoszony użytkownik")
     */
    extractReportedUserIdFromEmbed(embed) {
        const field = embed?.fields?.find(f => f.name === '🎯 Zgłoszony użytkownik');
        if (!field) return null;
        const match = field.value.match(/<@(\d+)>/);
        return match ? match[1] : null;
    }

    /**
     * Buduje wiersz przycisków follow-up (Wycisz + Usuń wiadomość)
     */
    buildFollowupActionRow(channelId, messageId, userId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`report_fu_mute_${channelId}_${messageId}_${userId}`)
                .setLabel('Wycisz')
                .setEmoji('🔇')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_fu_delete_${channelId}_${messageId}`)
                .setLabel('Usuń wiadomość')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    /**
     * Obsługuje submit modala ostrzeżenia z poziomu zgłoszenia
     */
    async handleReportWarnModalSubmit(interaction) {
        // customId: report_warn_modal_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        // parts: ['report', 'warn', 'modal', channelId, messageId, userId]
        const channelId = parts[3];
        const messageId = parts[4];
        const userId = parts[5];

        const reason = interaction.fields.getTextInputValue('warn_reason');

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika na serwerze.', ephemeral: true });
                return;
            }

            const warningResult = this.warningService.addWarning(
                userId,
                interaction.user.id,
                interaction.user.tag,
                reason,
                guild.id
            );
            const allWarnings = this.warningService.getUserWarnings(userId, guild.id);

            // Zaktualizuj embed zgłoszenia
            if (interaction.message) {
                const reporterId = this.extractReporterIdFromEmbed(interaction.message.embeds[0]);

                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xFF8C00)
                    .setTitle('⚠️ Zgłoszenie - Ostrzegano użytkownika')
                    .setFooter({ text: `Akcja: ${interaction.user.tag} • ID: ${messageId}` });

                await interaction.message.edit({ embeds: [embed], components: [] });

                // DM do reportera
                if (reporterId) {
                    try {
                        const reporterUser = await interaction.client.users.fetch(reporterId);
                        await reporterUser.send(`✅ Twoje zgłoszenie zostało rozpatrzone.\n> **Akcja:** Moderator ostrzegł zgłoszonego użytkownika.`);
                    } catch {}
                }
            }

            // DM do ostrzeżonego użytkownika
            try {
                await member.send(
                    `⚠️ Otrzymałeś ostrzeżenie na serwerze **${guild.name}**.\n` +
                    `> **Powód:** ${reason}\n` +
                    `> **Łączna liczba ostrzeżeń:** ${allWarnings.length}`
                );
            } catch {}

            await interaction.reply({
                content: `⚠️ <@${interaction.user.id}> ostrzegł użytkownika <@${userId}> za: „${reason}". Łącznie ostrzeżeń: **${allWarnings.length}**.`,
                components: [this.buildFollowupActionRow(channelId, messageId, userId)]
            });

            // Zarejestruj skuteczne zgłoszenie (zeruje licznik "nie rób nic")
            if (interaction.message) {
                const reporterId = this.extractReporterIdFromEmbed(interaction.message.embeds[0]);
                await this.reportStatsService.recordEffective(reporterId);
            }

        } catch (error) {
            logger.error('❌ Błąd podczas dodawania ostrzeżenia przez zgłoszenie:', error);
            await interaction.reply({ content: '❌ Wystąpił błąd podczas dodawania ostrzeżenia.', ephemeral: true });
        }
    }

    /**
     * Obsługuje przycisk "Wycisz" z follow-up wiadomości po akcji na zgłoszeniu
     */
    async handleReportFollowupMuteButton(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({ content: '❌ Tylko moderatorzy mogą wykonywać akcje na zgłoszeniach.', ephemeral: true });
            return;
        }

        // customId: report_fu_mute_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        const channelId = parts[3];
        const messageId = parts[4];
        const userId = parts[5];

        const muteModal = new ModalBuilder()
            .setCustomId(`report_fu_mute_modal_${channelId}_${messageId}_${userId}`)
            .setTitle('Czas wyciszenia');

        const durationInput = new TextInputBuilder()
            .setCustomId('mute_duration')
            .setLabel('Czas wyciszenia (np. 10m, 2h, 1d)')
            .setPlaceholder('Przykłady: 10m, 30m, 2h, 12h, 1d, 7d')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        muteModal.addComponents(new ActionRowBuilder().addComponents(durationInput));
        await interaction.showModal(muteModal);
    }

    /**
     * Obsługuje submit modala wyciszenia z follow-up wiadomości
     */
    async handleReportFollowupMuteModalSubmit(interaction) {
        // customId: report_fu_mute_modal_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        const channelId = parts[4];
        const messageId = parts[5];
        const userId = parts[6];

        const durationRaw = interaction.fields.getTextInputValue('mute_duration');
        const parsed = this.parseMuteDuration(durationRaw);

        if (!parsed) {
            await interaction.reply({ content: '❌ Nieprawidłowy format czasu. Użyj np. `10m`, `2h`, `1d`. Maksymalnie 28 dni.', ephemeral: true });
            return;
        }

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika na serwerze.', ephemeral: true });
                return;
            }

            await member.timeout(parsed.ms, `Zgłoszenie przez ${interaction.user.tag}`);

            // Usuń przyciski z follow-up wiadomości
            try {
                if (interaction.message) {
                    await interaction.message.edit({ components: [] });
                }
            } catch {}

            await interaction.reply({
                content: `🔇 <@${interaction.user.id}> wyciszył użytkownika <@${userId}> na **${parsed.label}**.`
            });

        } catch (error) {
            logger.error('❌ Błąd podczas wyciszania użytkownika (follow-up):', error);
            await interaction.reply({ content: `❌ Nie udało się wyciszyć użytkownika: ${error.message}`, ephemeral: true });
        }
    }

    /**
     * Obsługuje przycisk "Usuń wiadomość" z follow-up wiadomości po akcji na zgłoszeniu
     */
    async handleReportFollowupDeleteButton(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({ content: '❌ Tylko moderatorzy mogą wykonywać akcje na zgłoszeniach.', ephemeral: true });
            return;
        }

        // customId: report_fu_delete_{channelId}_{messageId}
        const parts = interaction.customId.split('_');
        const channelId = parts[3];
        const messageId = parts[4];

        try {
            const targetChannel = await interaction.client.channels.fetch(channelId);
            const targetMessage = await targetChannel.messages.fetch(messageId);
            await targetMessage.delete();
        } catch {
            await interaction.reply({ content: '❌ Nie można usunąć wiadomości (może już nie istnieje).', ephemeral: true });
            return;
        }

        // Usuń przyciski z follow-up wiadomości
        await interaction.update({ components: [] });

        await interaction.followUp({
            content: `🗑️ <@${interaction.user.id}> usunął zgłoszoną wiadomość.`
        });
    }

    async handleReportMuteDurationModalSubmit(interaction) {
        // customId: report_mute_modal_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        // parts: ['report', 'mute', 'modal', channelId, messageId, userId]
        const channelId = parts[3];
        const messageId = parts[4];
        const userId = parts[5];

        const durationRaw = interaction.fields.getTextInputValue('mute_duration');
        const parsed = this.parseMuteDuration(durationRaw);

        if (!parsed) {
            await interaction.reply({
                content: '❌ Nieprawidłowy format czasu. Użyj np. `10m`, `2h`, `1d`. Maksymalnie 28 dni.',
                ephemeral: true
            });
            return;
        }

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika na serwerze.', ephemeral: true });
                return;
            }

            await member.timeout(parsed.ms, `Zgłoszenie przez ${interaction.user.tag}`);

            // Zaktualizuj oryginalny embed (wiadomość z raportem)
            let reporterId = null;
            try {
                if (interaction.message) {
                    reporterId = this.extractReporterIdFromEmbed(interaction.message.embeds[0]);

                    const embed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setColor(0xFF8C00)
                        .setTitle(`🔇 Zgłoszenie - Wyciszono użytkownika na ${parsed.label}`)
                        .setFooter({ text: `Akcja: ${interaction.user.tag} • ID: ${messageId}` });

                    await interaction.message.edit({ embeds: [embed], components: [] });
                }
            } catch (editErr) {
                logger.warn('⚠️ Nie można zaktualizować embeda raportu:', editErr.message);
            }

            await interaction.reply({
                content: `🔇 <@${interaction.user.id}> wyciszył użytkownika <@${userId}> na **${parsed.label}**.`
            });

            // DM do reportera
            if (reporterId) {
                try {
                    const reporterUser = await interaction.client.users.fetch(reporterId);
                    await reporterUser.send(`✅ Twoje zgłoszenie zostało rozpatrzone.\n> **Akcja:** Moderator wyciszył zgłoszonego użytkownika na **${parsed.label}**.`);
                } catch {}
            }

            await this.logService.logMessage('info',
                `Wyciszono użytkownika ${userId} na ${parsed.label} przez ${interaction.user.tag} (zgłoszenie)`,
                interaction
            );

            // Zarejestruj skuteczne zgłoszenie (zeruje licznik "nie rób nic")
            await this.reportStatsService.recordEffective(reporterId);

        } catch (error) {
            logger.error('❌ Błąd podczas wyciszania użytkownika:', error);
            await interaction.reply({
                content: `❌ Nie udało się wyciszyć użytkownika: ${error.message}`,
                ephemeral: true
            });
        }
    }

    /**
     * Parsuje link do wiadomości Discord i zwraca { guildId, channelId, messageId }
     */
    parseMessageLink(input) {
        // Link format: https://discord.com/channels/GUILD/CHANNEL/MESSAGE
        const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
        if (linkMatch) {
            return { guildId: linkMatch[1], channelId: linkMatch[2], messageId: linkMatch[3] };
        }
        return null;
    }

    /**
     * Obsługuje komendę /zgłoś
     */
    async handleZglosCommand(interaction) {
        const link = interaction.options.getString('link');
        const powod = interaction.options.getString('powod') || 'Brak podanego powodu';
        await this.processReport(interaction, link, powod, false);
    }

    /**
     * Obsługuje kliknięcie przycisku "Zgłoś" na kanale zgłoszeń
     */
    async handleReportStartButton(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('report_modal_submit')
            .setTitle('Zgłoś wiadomość');

        const linkInput = new TextInputBuilder()
            .setCustomId('report_message_link')
            .setLabel('Link do wiadomości')
            .setPlaceholder('https://discord.com/channels/...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const powodInput = new TextInputBuilder()
            .setCustomId('report_reason')
            .setLabel('Powód zgłoszenia (opcjonalny)')
            .setPlaceholder('Opisz krótko dlaczego zgłaszasz tę wiadomość...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(linkInput),
            new ActionRowBuilder().addComponents(powodInput)
        );

        await interaction.showModal(modal);
    }

    /**
     * Obsługuje submit modalu zgłoszenia
     */
    async handleReportModalSubmit(interaction) {
        const link = interaction.fields.getTextInputValue('report_message_link');
        const powod = interaction.fields.getTextInputValue('report_reason') || 'Brak podanego powodu';
        await this.processReport(interaction, link, powod, true);
    }

    /**
     * Przetwarza zgłoszenie wiadomości (wspólna logika dla komendy i modalu)
     */
    async processReport(interaction, messageLink, powod, isModal, prefetchedMessage = null) {
        try {
            // Jeśli wywołano z context menu (po deferReply), nie robimy deferReply ponownie
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }

            let targetChannel;
            let targetMessage;
            let parsed;

            if (prefetchedMessage) {
                // Context menu - wiadomość już pobrana
                targetMessage = prefetchedMessage;
                targetChannel = prefetchedMessage.channel;
                parsed = this.parseMessageLink(messageLink);
                if (!parsed) {
                    // fallback - zbuduj parsed ręcznie
                    parsed = { guildId: interaction.guildId, channelId: targetChannel.id, messageId: targetMessage.id };
                }
            } else {
                parsed = this.parseMessageLink(messageLink);
                if (!parsed) {
                    await interaction.editReply({
                        content: '❌ Nieprawidłowy link do wiadomości. Użyj opcji **Prawy klik → Kopiuj link do wiadomości** w Discordzie.'
                    });
                    return;
                }

                try {
                    targetChannel = await interaction.client.channels.fetch(parsed.channelId);
                    targetMessage = await targetChannel.messages.fetch(parsed.messageId);
                } catch {
                    await interaction.editReply({
                        content: '❌ Nie znaleziono wiadomości. Upewnij się, że link jest prawidłowy i wiadomość nadal istnieje.'
                    });
                    return;
                }
            }

            const { channelId, messageId } = parsed;

            const reportedUser = targetMessage.author;
            const reporter = interaction.user;

            // Sprawdź blokadę zgłoszeń
            const banStatus = this.reportStatsService.checkBan(reporter.id);
            if (banStatus.banned) {
                const bannedUntilDate = new Date(banStatus.bannedUntil);
                const bannedUntilStr = bannedUntilDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
                await interaction.editReply({
                    content: `🚫 Masz blokadę zgłoszeń do **${bannedUntilStr}** z powodu zbyt wielu nieuzasadnionych zgłoszeń.`
                });
                return;
            }

            // Zarejestruj zgłoszenie w statystykach
            await this.reportStatsService.recordReport(reporter.id);

            // Sprawdź czy zgłoszony użytkownik jest moderatorem
            const reportedMember = await interaction.guild.members.fetch(reportedUser.id).catch(() => null);
            const reportedIsMod = reportedMember ? this.isAdminOrModerator(reportedMember) : false;

            // Zbuduj embed raportu
            const embed = new EmbedBuilder()
                .setColor(reportedIsMod ? 0xFF6600 : 0xFF0000)
                .setTitle(reportedIsMod ? '🚨 Zgłoszenie moderatora — tylko administratorzy mogą podjąć akcję' : '🚨 Nowe zgłoszenie wiadomości')
                .addFields(
                    { name: '👤 Zgłaszający', value: `${reporter} (${reporter.tag})`, inline: true },
                    { name: '🎯 Zgłoszony użytkownik', value: `${reportedUser} (${reportedUser.tag})`, inline: true },
                    { name: '📢 Kanał', value: `${targetChannel}`, inline: true },
                    { name: '💬 Treść wiadomości', value: targetMessage.content || '*[brak treści tekstowej]*', inline: false },
                    { name: '📝 Powód zgłoszenia', value: powod, inline: false },
                    { name: '🔗 Link', value: `[Przejdź do wiadomości](https://discord.com/channels/${parsed.guildId}/${channelId}/${messageId})`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: `ID wiadomości: ${messageId}` });

            if (targetMessage.attachments.size > 0) {
                const firstImage = targetMessage.attachments.find(a => a.contentType?.startsWith('image/'));
                if (firstImage) embed.setImage(firstImage.url);
            }

            // Przyciski: jeśli zgłoszony to moderator — "Usuń wiadomość" i "Nie rób nic"
            let row;
            if (reportedIsMod) {
                row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`report_delete_${channelId}_${messageId}_${reportedUser.id}`)
                        .setLabel('Usuń wiadomość')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`report_nothing_${channelId}_${messageId}`)
                        .setLabel('Nie rób nic')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Secondary)
                );
            } else {
                row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`report_warn_${channelId}_${messageId}_${reportedUser.id}`)
                        .setLabel('Ostrzeż użytkownika')
                        .setEmoji('🔨')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`report_mute_${channelId}_${messageId}_${reportedUser.id}`)
                        .setLabel('Wycisz')
                        .setEmoji('🔇')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`report_delete_${channelId}_${messageId}_${reportedUser.id}`)
                        .setLabel('Usuń wiadomość')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`report_nothing_${channelId}_${messageId}`)
                        .setLabel('Nie rób nic')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Secondary)
                );
            }

            // Wyślij na kanał zgłoszeń
            const reportChannelId = this.config.reports?.reportChannelId;
            if (reportChannelId) {
                try {
                    const reportChannel = await interaction.client.channels.fetch(reportChannelId);
                    // Dla zgłoszeń moderatorów — ping adminów w treści wiadomości
                    const content = reportedIsMod ? '⚠️ **Zgłoszenie dotyczy moderatora — wymagana akcja administratora.**' : undefined;
                    await reportChannel.send({ content, embeds: [embed], components: [row] });
                } catch (err) {
                    logger.error('❌ Nie można wysłać zgłoszenia na kanał raportów:', err.message);
                }
            }

            await this.logService.logMessage('info',
                `Zgłoszenie od ${reporter.tag} - zgłoszona wiadomość: ${messageId} (user: ${reportedUser.tag}${reportedIsMod ? ' [MODERATOR]' : ''})`,
                interaction
            );

            await interaction.editReply({
                content: reportedIsMod
                    ? '✅ Twoje zgłoszenie moderatora zostało przesłane do administratorów. Dziękujemy!'
                    : '✅ Twoje zgłoszenie zostało przesłane do moderatorów. Dziękujemy!'
            });

        } catch (error) {
            logger.error('❌ Błąd podczas przetwarzania zgłoszenia:', error);
            try {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas przetwarzania zgłoszenia.'
                });
            } catch {}
        }
    }

    /**
     * Obsługuje przyciski akcji moderatora na zgłoszeniu
     */
    async handleReportActionButton(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({
                content: '❌ Tylko moderatorzy mogą wykonywać akcje na zgłoszeniach.',
                ephemeral: true
            });
            return;
        }

        // Zgłoszenia moderatorów mogą obsługiwać tylko administratorzy
        const embedTitle = interaction.message.embeds[0]?.title ?? '';
        const isModReport = embedTitle.includes('moderatora');
        if (isModReport && !interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Zgłoszenia moderatorów mogą obsługiwać tylko administratorzy.',
                ephemeral: true
            });
            return;
        }

        const parts = interaction.customId.split('_');
        // Format: report_{action}_{channelId}_{messageId}[_{userId}]
        const action = parts[1];
        const channelId = parts[2];
        const messageId = parts[3];
        const userId = parts[4];

        try {
            if (action === 'nothing') {
                const reportEmbed = interaction.message.embeds[0];
                const reporterId = this.extractReporterIdFromEmbed(reportEmbed);

                const embed = EmbedBuilder.from(reportEmbed)
                    .setColor(0x808080)
                    .setTitle('✅ Zgłoszenie zamknięte (bez akcji)')
                    .setFooter({ text: `Zamknięte przez ${interaction.user.tag} • ID: ${messageId}` });

                await interaction.update({ embeds: [embed], components: [] });

                // Zarejestruj "nie rób nic" w statystykach reportera
                if (reporterId) {
                    const nothingResult = await this.reportStatsService.recordNothing(reporterId);
                    if (nothingResult.banned) {
                        // Powiadom reportera o blokadzie
                        try {
                            const reporterUser = await interaction.client.users.fetch(reporterId);
                            const bannedUntilStr = new Date(nothingResult.bannedUntil).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
                            await reporterUser.send(
                                `🚫 Twoje zgłoszenia były 3 razy z rzędu nieuzasadnione w ciągu tygodnia.\n` +
                                `> Komenda zgłaszania została zablokowana do **${bannedUntilStr}**.`
                            );
                        } catch {}
                    } else {
                        // Zwykłe DM o braku akcji
                        try {
                            const reporterUser = await interaction.client.users.fetch(reporterId);
                            await reporterUser.send(`✅ Twoje zgłoszenie zostało rozpatrzone.\n> **Akcja:** Moderacja nie podjęła dodatkowych działań.`);
                        } catch {}
                    }
                }
                return;
            }

            if (action === 'warn') {
                // Pokaż modal do wpisania powodu ostrzeżenia
                const warnModal = new ModalBuilder()
                    .setCustomId(`report_warn_modal_${channelId}_${messageId}_${userId}`)
                    .setTitle('Powód ostrzeżenia');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('warn_reason')
                    .setLabel('Powód ostrzeżenia')
                    .setPlaceholder('Opisz powód ostrzeżenia...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(512);

                warnModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(warnModal);
                return;
            }

            if (action === 'mute') {
                // Pokaż modal do wpisania czasu wyciszenia
                const muteModal = new ModalBuilder()
                    .setCustomId(`report_mute_modal_${channelId}_${messageId}_${userId}`)
                    .setTitle('Czas wyciszenia');

                const durationInput = new TextInputBuilder()
                    .setCustomId('mute_duration')
                    .setLabel('Czas wyciszenia (np. 10m, 2h, 1d)')
                    .setPlaceholder('Przykłady: 10m, 30m, 2h, 12h, 1d, 7d')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                muteModal.addComponents(new ActionRowBuilder().addComponents(durationInput));
                await interaction.showModal(muteModal);
                return;
            }

            if (action === 'delete') {
                const reporterIdDelete = this.extractReporterIdFromEmbed(interaction.message.embeds[0]);

                try {
                    const targetChannel = await interaction.client.channels.fetch(channelId);
                    const targetMessage = await targetChannel.messages.fetch(messageId);
                    await targetMessage.delete();
                } catch {
                    await interaction.reply({ content: '❌ Nie można usunąć wiadomości (może już nie istnieje).', ephemeral: true });
                    return;
                }

                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xFF8C00)
                    .setTitle('🗑️ Zgłoszenie - Usunięto wiadomość')
                    .setFooter({ text: `Akcja: ${interaction.user.tag} • ID: ${messageId}` });

                await interaction.update({ embeds: [embed], components: [] });

                await interaction.followUp({
                    content: `🗑️ <@${interaction.user.id}> usunął zgłoszoną wiadomość.`
                });

                // Zarejestruj skuteczne zgłoszenie (zeruje licznik "nie rób nic")
                await this.reportStatsService.recordEffective(reporterIdDelete);

                // DM do reportera
                if (reporterIdDelete) {
                    try {
                        const reporterUser = await interaction.client.users.fetch(reporterIdDelete);
                        await reporterUser.send(`✅ Twoje zgłoszenie zostało rozpatrzone.\n> **Akcja:** Moderator usunął zgłoszoną wiadomość.`);
                    } catch {}
                }
                return;
            }

        } catch (error) {
            logger.error('❌ Błąd podczas wykonywania akcji na zgłoszeniu:', error);
            try {
                await interaction.reply({ content: '❌ Wystąpił błąd podczas wykonywania akcji.', ephemeral: true });
            } catch {}
        }
    }

    /**
     * Obsługuje przyciski auto-moderacji (usuń wiadomość / upomnij)
     * @param {ButtonInteraction} interaction
     */
    async handleAutoModButton(interaction) {
        if (!this.isAdminOrModerator(interaction.member)) {
            await interaction.reply({ content: '❌ Tylko moderatorzy mogą wykonywać te akcje.', ephemeral: true });
            return;
        }

        // Format: automod_delete_{channelId}_{messageId}
        //         automod_warn_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        const action = parts[1]; // 'delete' lub 'warn'
        const channelId = parts[2];
        const messageId = parts[3];
        const userId = parts[4]; // tylko dla 'warn'

        try {
            if (action === 'delete') {
                try {
                    const targetChannel = await interaction.client.channels.fetch(channelId);
                    const targetMessage = await targetChannel.messages.fetch(messageId);
                    await targetMessage.delete();
                } catch {
                    await interaction.reply({ content: '❌ Nie można usunąć wiadomości (może już nie istnieje).', ephemeral: true });
                    return;
                }

                const embed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xFF0000)
                    .setFooter({ text: `Wiadomość usunięta przez ${interaction.user.tag}` });

                await interaction.update({ embeds: [embed], components: [] });
                await interaction.followUp({ content: `🗑️ <@${interaction.user.id}> usunął wiadomość.`, ephemeral: false });
                return;
            }

            if (action === 'warn') {
                const warnModal = new ModalBuilder()
                    .setCustomId(`automod_warn_modal_${channelId}_${messageId}_${userId}`)
                    .setTitle('Powód upomnienia');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('warn_reason')
                    .setLabel('Powód upomnienia')
                    .setPlaceholder('Opisz powód upomnienia...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(512);

                warnModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(warnModal);
            }
        } catch (error) {
            logger.error('❌ Błąd podczas obsługi przycisku auto-moderacji:', error);
            try {
                await interaction.reply({ content: '❌ Wystąpił błąd podczas wykonywania akcji.', ephemeral: true });
            } catch {}
        }
    }

    /**
     * Obsługuje modal upomnienia z auto-moderacji
     * @param {ModalSubmitInteraction} interaction
     */
    async handleAutoModWarnModalSubmit(interaction) {
        // Format: automod_warn_modal_{channelId}_{messageId}_{userId}
        const parts = interaction.customId.split('_');
        const userId = parts[5];
        const reason = interaction.fields.getTextInputValue('warn_reason');

        try {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member) {
                await interaction.reply({ content: '❌ Nie znaleziono użytkownika.', ephemeral: true });
                return;
            }

            const warningService = this.messageHandler?.warningService;
            if (warningService) {
                warningService.addWarning(userId, interaction.user.id, interaction.user.tag, reason, interaction.guild.id);
            }

            try {
                await member.send(`⚠️ Zostałeś upomniany przez moderację.\n**Powód:** ${reason}`);
            } catch {}

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFFA500)
                .setFooter({ text: `Upomniany przez ${interaction.user.tag}` });

            await interaction.update({ embeds: [embed], components: [] });
            await interaction.followUp({ content: `⚠️ <@${interaction.user.id}> upomniał <@${userId}>.\n**Powód:** ${reason}`, ephemeral: false });
        } catch (error) {
            logger.error('❌ Błąd podczas obsługi modala upomnienia auto-mod:', error);
            try {
                await interaction.reply({ content: '❌ Wystąpił błąd podczas wykonywania akcji.', ephemeral: true });
            } catch {}
        }
    }
}

module.exports = InteractionHandler;