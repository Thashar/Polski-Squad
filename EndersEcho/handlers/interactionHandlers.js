const { SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { downloadFile, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const path = require('path');

class InteractionHandler {
    constructor(config, ocrService, rankingService, logService, roleService) {
        this.config = config;
        this.ocrService = ocrService;
        this.rankingService = rankingService;
        this.logService = logService;
        this.roleService = roleService;
    }

    /**
     * Sprawdza czy kanał jest dozwolony
     * @param {string} channelId - ID kanału
     * @returns {boolean} - Czy kanał jest dozwolony
     */
    isAllowedChannel(channelId) {
        return channelId === this.config.allowedChannelId;
    }

    /**
     * Rejestruje komendy slash
     * @param {Client} client - Klient Discord
     */
    async registerSlashCommands(client) {
        const commands = [
            new SlashCommandBuilder()
                .setName('ranking')
                .setDescription('Wyświetla prywatny ranking graczy z paginacją'),
            
            new SlashCommandBuilder()
                .setName('update')
                .setDescription('Aktualizuje wynik na podstawie załączonego obrazu')
                .addAttachmentOption(option =>
                    option.setName('obraz')
                        .setDescription('Obraz z wynikiem zawierający "Best:" i "Total:"')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('remove')
                .setDescription('Usuwa gracza z rankingu (tylko dla administratorów)')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('Użytkownik do usunięcia z rankingu')
                        .setRequired(true))
        ];

        const rest = new REST().setToken(this.config.token);
        
        try {
            logger.info('Rozpoczynam rejestrację slash commands...');
            
            await rest.put(
                Routes.applicationGuildCommands(this.config.clientId, this.config.guildId),
                { body: commands }
            );
            
            logger.info('Slash commands zostały pomyślnie zarejestrowane!');
        } catch (error) {
            logger.error('Błąd podczas rejestracji slash commands:', error);
        }
    }

    /**
     * Obsługuje interakcje
     * @param {Interaction} interaction - Interakcja Discord
     */
    async handleInteraction(interaction) {
        if (interaction.isChatInputCommand()) {
            if (!this.isAllowedChannel(interaction.channel.id)) {
                await interaction.reply({ 
                    content: this.config.messages.channelNotAllowed, 
                    ephemeral: true 
                });
                return;
            }

            switch (interaction.commandName) {
                case 'ranking':
                    await this.handleRankingCommand(interaction);
                    break;
                case 'update':
                    await this.handleUpdateCommand(interaction);
                    break;
                case 'remove':
                    await this.handleRemoveCommand(interaction);
                    break;
            }
        } else if (interaction.isButton()) {
            await this.handleButtonInteraction(interaction);
        }
    }

    /**
     * Obsługuje komendę rankingu
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleRankingCommand(interaction) {
        await this.logService.logCommandUsage('ranking', interaction);

        try {
            // Defer reply aby uniknąć timeoutu przy długich operacjach
            await interaction.deferReply({ ephemeral: true });
            
            const players = await this.rankingService.getSortedPlayers();
            
            if (players.length === 0) {
                await interaction.editReply({ 
                    content: this.config.messages.rankingEmpty
                });
                return;
            }
            
            const totalPages = Math.ceil(players.length / this.config.ranking.playersPerPage);
            const currentPage = 0;
            
            const embed = await this.rankingService.createRankingEmbed(players, currentPage, totalPages, interaction.user.id, interaction.guild);
            const buttons = this.rankingService.createRankingButtons(currentPage, totalPages, false);
            
            const reply = await interaction.editReply({
                embeds: [embed],
                components: [buttons]
            });
            
            // Przechowywanie informacji o aktywnej paginacji
            this.rankingService.addActiveRanking(reply.id, {
                players: players,
                currentPage: currentPage,
                totalPages: totalPages,
                userId: interaction.user.id,
                messageId: reply.id
            });
            
        } catch (error) {
            await this.logService.logRankingError(error, 'handleRankingCommand');
            
            // Sprawdź czy interakcja już została odpowiedziana
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: this.config.messages.rankingError, 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: this.config.messages.rankingError 
                });
            }
        }
    }

    /**
     * Obsługuje komendę aktualizacji wyniku
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleUpdateCommand(interaction) {
        await this.logService.logCommandUsage('update', interaction);

        const attachment = interaction.options.getAttachment('obraz');
        
        const isImage = this.config.images.supportedExtensions.some(ext => 
            attachment.name.toLowerCase().endsWith(ext)
        );
        
        if (!isImage) {
            await interaction.reply({ 
                content: this.config.messages.updateNotImage, 
                ephemeral: true 
            });
            return;
        }
        
        // Defer reply przed długimi operacjami OCR - prywatnie podczas przetwarzania
        await interaction.deferReply({ ephemeral: true });
        
        // Informuj użytkownika że rozpoczęto przetwarzanie
        await interaction.editReply({ content: this.config.messages.updateProcessing });
        
        let tempImagePath = null;
        
        try {
            // Tworzenie katalogu tymczasowego
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });
            
            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);
            
            // Sprawdzenie wymaganych słów
            const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath);
            
            if (!hasRequiredWords) {
                await fs.unlink(tempImagePath);
                await interaction.editReply(this.config.messages.updateNoRequiredWords);
                return;
            }
            
            // Ekstrakcja tekstu i wyniku
            const extractedText = await this.ocrService.extractTextFromImage(tempImagePath);
            logger.info('Pełny tekst z OCR:', extractedText);
            
            let bestScore = this.ocrService.extractScoreAfterBest(extractedText);
            
            if (!bestScore) {
                await fs.unlink(tempImagePath);
                await interaction.editReply(this.config.messages.updateNoScore);
                return;
            }
            
            // Ekstrakcja nazwy bossa
            const bossName = this.ocrService.extractBossName(extractedText);
            logger.info('Nazwa bossa:', bossName);
            
            // Debug - sprawdź czy mamy wszystkie dane
            logger.info('DEBUG - extractedText długość:', extractedText ? extractedText.length : 'null');
            logger.info('DEBUG - bestScore:', bestScore);
            logger.info('DEBUG - bossName:', bossName);
            
            // Aktualizacja rankingu
            const userId = interaction.user.id;
            const userName = interaction.user.displayName || interaction.user.username;
            
            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                userId, userName, bestScore, bossName
            );
            
            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord);
            
            if (!isNewRecord) {
                await fs.unlink(tempImagePath);
                
                const resultEmbed = this.rankingService.createResultEmbed(
                    userName, bestScore, currentScore.score
                );
                
                // Aktualizuj ephemeral message z informacją o braku pobicia rekordu
                await interaction.editReply({ embeds: [resultEmbed] });
                return;
            }
            
            // Nowy rekord - przygotowanie publicznego ogłoszenia
            const imageAttachment = new AttachmentBuilder(tempImagePath, { 
                name: `rekord_${userName}_${Date.now()}.${attachment.name.split('.').pop()}` 
            });
            
            const publicEmbed = this.rankingService.createRecordEmbed(
                userName, 
                bestScore, 
                interaction.user.displayAvatarURL(),
                imageAttachment.name,
                currentScore ? currentScore.score : null
            );
            
            // Aktualizuj ephemeral message z informacją o sukcesie
            await interaction.editReply({ 
                content: '✅ **Nowy rekord został pobity i pozytywnie ogłoszony!**\n🏆 Gratulacje! Twój wynik został opublikowany dla wszystkich.' 
            });
            
            // Wyślij publiczne ogłoszenie nowego rekordu jako nową wiadomość
            await interaction.followUp({ 
                embeds: [publicEmbed], 
                files: [imageAttachment] 
            });
            
            // Aktualizacja ról TOP po nowym rekordzie
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers();
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers);
                await this.logService.logMessage('success', 'Role TOP zostały zaktualizowane po nowym rekordzie', interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP: ${roleError.message}`, interaction);
            }
            
            // Usunięcie pliku tymczasowego
            await fs.unlink(tempImagePath).catch(error => logger.error('Błąd usuwania pliku tymczasowego:', error));
            
        } catch (error) {
            await this.logService.logOCRError(error, 'handleUpdateCommand');
            
            // Usunięcie pliku tymczasowego w przypadku błędu
            if (tempImagePath) {
                await fs.unlink(tempImagePath).catch(error => logger.error('Błąd usuwania pliku tymczasowego:', error));
            }
            
            await interaction.editReply(this.config.messages.updateError);
        }
    }

    /**
     * Obsługuje komendę usuwania gracza z rankingu
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleRemoveCommand(interaction) {
        await this.logService.logCommandUsage('remove', interaction);

        // Sprawdź uprawnienia - tylko administratorzy mogą usuwać graczy
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ 
                content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**', 
                ephemeral: true 
            });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // Usuń gracza z rankingu
            const wasRemoved = await this.rankingService.removePlayerFromRanking(targetUser.id);
            
            if (!wasRemoved) {
                await interaction.editReply(`❌ Gracz ${targetUser.tag} nie był w rankingu.`);
                return;
            }

            // Aktualizuj role TOP po usunięciu gracza
            try {
                const updatedPlayers = await this.rankingService.getSortedPlayers();
                await this.roleService.updateTopRoles(interaction.guild, updatedPlayers);
                await this.logService.logMessage('success', `Gracz ${targetUser.tag} został usunięty z rankingu i zaktualizowano role TOP`, interaction);
            } catch (roleError) {
                await this.logService.logMessage('error', `Błąd aktualizacji ról TOP po usunięciu gracza: ${roleError.message}`, interaction);
            }

            await interaction.editReply(`✅ Gracz ${targetUser.tag} został pomyślnie usunięty z rankingu. Role TOP zostały zaktualizowane.`);
            
        } catch (error) {
            await this.logService.logMessage('error', `Błąd usuwania gracza ${targetUser.tag} z rankingu: ${error.message}`, interaction);
            await interaction.editReply(`❌ Wystąpił błąd podczas usuwania gracza z rankingu.`);
        }
    }

    /**
     * Obsługuje interakcje przycisków
     * @param {ButtonInteraction} interaction - Interakcja przycisku
     */
    async handleButtonInteraction(interaction) {
        try {
            // Defer update aby uniknąć timeoutu
            await interaction.deferUpdate();
            
            const rankingData = this.rankingService.getActiveRanking(interaction.message.id);
            
            if (!rankingData) {
                await interaction.editReply({ 
                    content: this.config.messages.rankingExpired,
                    embeds: [],
                    components: []
                });
                return;
            }
            
            // Sprawdzenie właściciela
            if (interaction.user.id !== rankingData.userId) {
                await interaction.followUp({ 
                    content: this.config.messages.rankingWrongUser, 
                    ephemeral: true 
                });
                return;
            }
            
            let newPage = rankingData.currentPage;
            
            switch (interaction.customId) {
                case 'ranking_first':
                    newPage = 0;
                    break;
                case 'ranking_prev':
                    newPage = Math.max(0, rankingData.currentPage - 1);
                    break;
                case 'ranking_next':
                    newPage = Math.min(rankingData.totalPages - 1, rankingData.currentPage + 1);
                    break;
                case 'ranking_last':
                    newPage = rankingData.totalPages - 1;
                    break;
            }
            
            // Aktualizacja danych
            rankingData.currentPage = newPage;
            this.rankingService.updateActiveRanking(interaction.message.id, rankingData);
            
            const embed = await this.rankingService.createRankingEmbed(
                rankingData.players, newPage, rankingData.totalPages, rankingData.userId, interaction.guild
            );
            const buttons = this.rankingService.createRankingButtons(newPage, rankingData.totalPages, false);
            
            await interaction.editReply({
                embeds: [embed],
                components: [buttons]
            });
            
        } catch (error) {
            logger.error('Błąd w handleButtonInteraction:', error);
            
            // Sprawdź czy można jeszcze odpowiedzieć
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: this.config.messages.rankingError, 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: this.config.messages.rankingError,
                    embeds: [],
                    components: []
                });
            }
        }
    }
}

module.exports = InteractionHandler;