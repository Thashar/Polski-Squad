const { SlashCommandBuilder, REST, Routes, AttachmentBuilder } = require('discord.js');
const { downloadFile, formatMessage } = require('../utils/helpers');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');
const path = require('path');

class InteractionHandler {
    constructor(config, ocrService, aiOcrService, rankingService, logService, roleService) {
        this.config = config;
        this.ocrService = ocrService;
        this.aiOcrService = aiOcrService;
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
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('ocr-debug')
                .setDescription('Przełącz szczegółowe logowanie OCR')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                        .setRequired(false))
        ];

        const rest = new REST().setToken(this.config.token);
        
        try {
            await rest.put(
                Routes.applicationGuildCommands(this.config.clientId, this.config.guildId),
                { body: commands }
            );
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
                    flags: ['Ephemeral'] 
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
                case 'ocr-debug':
                    await this.handleOcrDebugCommand(interaction);
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
            await interaction.deferReply({ flags: ['Ephemeral'] });
            
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
                    flags: ['Ephemeral'] 
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
                flags: ['Ephemeral'] 
            });
            return;
        }
        
        // Sprawdź rozmiar pliku
        if (attachment.size > this.config.images.maxSize) {
            const maxSizeMB = Math.round(this.config.images.maxSize / (1024 * 1024));
            const fileSizeMB = Math.round(attachment.size / (1024 * 1024) * 100) / 100;
            await interaction.reply({ 
                content: `❌ Plik jest za duży! Maksymalny rozmiar: **${maxSizeMB}MB**, twój plik: **${fileSizeMB}MB**\n💡 **Tip:** Zmniejsz jakość obrazu lub użyj kompresji.`, 
                flags: ['Ephemeral'] 
            });
            return;
        }
        
        // Defer reply przed długimi operacjami OCR - prywatnie podczas przetwarzania
        await interaction.deferReply({ flags: ['Ephemeral'] });
        
        // Informuj użytkownika że rozpoczęto przetwarzanie
        await interaction.editReply({ content: this.config.messages.updateProcessing });
        
        let tempImagePath = null;
        
        try {
            // Tworzenie katalogu tymczasowego
            await fs.mkdir(this.config.ocr.tempDir, { recursive: true });
            
            tempImagePath = path.join(this.config.ocr.tempDir, `temp_${Date.now()}_${attachment.name}`);
            await downloadFile(attachment.url, tempImagePath);

            let bestScore = null;
            let bossName = null;

            // === AI OCR (jeśli włączony) ===
            if (this.aiOcrService.enabled) {
                try {
                    logger.info('🤖 Używam AI OCR do analizy obrazu...');
                    const aiResult = await this.aiOcrService.analyzeVictoryImage(tempImagePath);

                    if (aiResult.isValidVictory) {
                        bestScore = aiResult.score;
                        bossName = aiResult.bossName;
                        logger.success(`✅ AI OCR: wynik="${bestScore}", boss="${bossName}"`);
                    } else {
                        logger.warn(`⚠️ AI OCR nie rozpoznał poprawnego screenu: ${aiResult.error}`);
                        await fs.unlink(tempImagePath);

                        // Specjalna obsługa podrobionego zdjęcia
                        if (aiResult.error === 'FAKE_PHOTO') {
                            await interaction.editReply('🚫 **WYKRYTO PODROBIONE ZDJĘCIE!**\n\nTwoje zdjęcie zostało zidentyfikowane jako sfałszowane lub zmodyfikowane. Wynik nie zostanie przyjęty.\n\n⚠️ Przerabianie screenshotów jest niedozwolone!');
                            return;
                        }

                        await interaction.editReply('❌ Niepoprawny screenshot. Upewnij się, że zdjęcie zawiera ekran po zakończeniu walki Ender\'s Echo!');
                        return;
                    }
                } catch (aiError) {
                    logger.error('❌ AI OCR błąd, przechodzę na tradycyjny OCR:', aiError);
                    await interaction.editReply({ content: '⚠️ AI OCR niedostępny, używam tradycyjnego OCR...' });

                    // Fallback na tradycyjny OCR
                    const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath);

                    if (!hasRequiredWords) {
                        await fs.unlink(tempImagePath);
                        await interaction.editReply(this.config.messages.updateNoRequiredWords);
                        return;
                    }

                    const extractedText = await this.ocrService.extractTextFromImage(tempImagePath);
                    bestScore = this.ocrService.extractScoreAfterBest(extractedText);

                    if (!bestScore || bestScore.trim() === '') {
                        await fs.unlink(tempImagePath);
                        await interaction.editReply(this.config.messages.updateNoScore);
                        return;
                    }

                    bossName = this.ocrService.extractBossName(extractedText);
                }
            } else {
                // === Tradycyjny OCR ===
                logger.info('🔍 Używam tradycyjnego OCR...');

                const hasRequiredWords = await this.ocrService.checkRequiredWords(tempImagePath);

                if (!hasRequiredWords) {
                    await fs.unlink(tempImagePath);
                    await interaction.editReply(this.config.messages.updateNoRequiredWords);
                    return;
                }

                const extractedText = await this.ocrService.extractTextFromImage(tempImagePath);
                bestScore = this.ocrService.extractScoreAfterBest(extractedText);

                if (!bestScore || bestScore.trim() === '') {
                    await fs.unlink(tempImagePath);
                    await interaction.editReply(this.config.messages.updateNoScore);
                    return;
                }

                bossName = this.ocrService.extractBossName(extractedText);
            }
            
            // Aktualizacja rankingu
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            
            const { isNewRecord, currentScore } = await this.rankingService.updateUserRanking(
                userId, userName, bestScore, bossName
            );
            
            await this.logService.logScoreUpdate(userName, bestScore, isNewRecord);
            
            logger.info(`🎯 Przygotowuję odpowiedź dla użytkownika - isNewRecord: ${isNewRecord}`);
            
            if (!isNewRecord) {
                try {
                    // Oczyść nazwę użytkownika z nieprawidłowych znaków dla nazwy pliku
                    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
                    const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';
                    
                    // Sprawdź rozmiar pliku
                    const fsSync = require('fs');
                    const fileStats = fsSync.statSync(tempImagePath);
                    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
                    
                    logger.info(`📁 Plik do załączenia - rozmiar: ${fileSizeMB}MB`);
                    
                    const imageAttachment = new AttachmentBuilder(tempImagePath, { 
                        name: `wynik_${safeUserName}_${Date.now()}.${fileExtension}` 
                    });
                    
                    const resultEmbed = this.rankingService.createResultEmbed(
                        userName, bestScore, currentScore.score, imageAttachment.name, bossName
                    );
                    
                    try {
                        // Wyślij embed bez pliku (rozwiązuje problem z dużymi attachmentami)
                        
                        const editResult = await interaction.editReply({ 
                            embeds: [resultEmbed]
                        });
                        
                        // Następnie wyślij plik jako osobną wiadomość
                        await interaction.followUp({
                            content: `📎 **Oryginalny obraz wyniku:**`,
                            files: [imageAttachment],
                            flags: ['Ephemeral']
                        });
                        
                        logger.info('✅ Wysłano embed z wynikiem (brak rekordu)');
                    } catch (editReplyError) {
                        logger.error('❌ Błąd podczas wysyłania embed (brak rekordu):', editReplyError);
                        
                        // Spróbuj wysłać przynajmniej tekstową odpowiedź
                        try {
                            await interaction.editReply({
                                content: `❌ Nie pobito rekordu\n**Gracz:** ${userName}\n**Wynik:** ${bestScore}\n**Obecny rekord:** ${currentScore.score}\n\n*Błąd wysyłania embed z obrazem*`
                            });
                        } catch (fallbackError) {
                            logger.error('❌ Nie można wysłać nawet fallback odpowiedzi:', fallbackError);
                        }
                    }
                    
                    // Usuń plik tymczasowy po wysłaniu
                    await fs.unlink(tempImagePath).catch(error => logger.error('Błąd usuwania pliku tymczasowego:', error));
                    return;
                } catch (noRecordError) {
                    throw noRecordError;
                }
            }
            
            // Nowy rekord - przygotowanie publicznego ogłoszenia
            // Oczyść nazwę użytkownika z nieprawidłowych znaków dla nazwy pliku
            const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
            const fileExtension = attachment.name ? attachment.name.split('.').pop() : 'png';
            const imageAttachment = new AttachmentBuilder(tempImagePath, { 
                name: `rekord_${safeUserName}_${Date.now()}.${fileExtension}` 
            });
            
            const publicEmbed = await this.rankingService.createRecordEmbed(
                userName, 
                bestScore, 
                interaction.user.displayAvatarURL(),
                imageAttachment.name,
                currentScore ? currentScore.score : null,
                userId
            );
            
            try {
                // Aktualizuj ephemeral message z informacją o sukcesie
                await interaction.editReply({ 
                    content: '✅ **Nowy rekord został pobity i pozytywnie ogłoszony!**\n🏆 Gratulacje! Twój wynik został opublikowany dla wszystkich.' 
                });
                
                logger.info('✅ Wysłano potwierdzenie nowego rekordu (ephemeral)');
                
                // Wyślij publiczne ogłoszenie nowego rekordu jako nową wiadomość
                await interaction.followUp({ 
                    embeds: [publicEmbed], 
                    files: [imageAttachment] 
                });
                
                logger.info('✅ Wysłano publiczne ogłoszenie nowego rekordu');
                
            } catch (newRecordError) {
                logger.error('❌ Błąd podczas wysyłania odpowiedzi o nowym rekordzie:', newRecordError);
                
                // Spróbuj wysłać przynajmniej prostą odpowiedź
                try {
                    await interaction.editReply({
                        content: `🏆 **NOWY REKORD!**\n**Gracz:** ${userName}\n**Nowy rekord:** ${bestScore}\n**Poprzedni:** ${currentScore ? currentScore.score : 'brak'}\n\n*Błąd wysyłania pełnego embed*`
                    });
                } catch (fallbackError) {
                    logger.error('❌ Nie można wysłać fallback odpowiedzi dla nowego rekordu:', fallbackError);
                }
            }
            
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
            
            try {
                await interaction.editReply(this.config.messages.updateError);
            } catch (replyError) {
                logger.error('Błąd podczas wysyłania komunikatu o błędzie:', replyError.message);
            }
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
                flags: ['Ephemeral'] 
            });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        
        await interaction.deferReply({ flags: ['Ephemeral'] });

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
                    flags: ['Ephemeral'] 
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
                    flags: ['Ephemeral'] 
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

    /**
     * Obsługuje komendę debug OCR
     * @param {CommandInteraction} interaction - Interakcja komendy
     */
    async handleOcrDebugCommand(interaction) {
        // Sprawdź uprawnienia administratora
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
                flags: ['Ephemeral']
            });
            return;
        }
        
        const enabled = interaction.options.getBoolean('enabled');
        
        if (enabled === null) {
            // Sprawdź aktualny stan
            const currentState = this.config.ocr.detailedLogging.enabled;
            await interaction.reply({
                content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
                flags: ['Ephemeral']
            });
            return;
        }
        
        // Przełącz stan
        this.config.ocr.detailedLogging.enabled = enabled;
        
        const statusText = enabled ? '✅ Włączone' : '❌ Wyłączone';
        const emoji = enabled ? '🔍' : '🔇';
        
        logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);
        
        await interaction.reply({
            content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
            flags: ['Ephemeral']
        });
    }
}

module.exports = InteractionHandler;