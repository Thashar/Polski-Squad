const { downloadFile, cleanupFiles, safeEditMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const { EmbedBuilder } = require('discord.js');

const logger = createBotLogger('Kontroler');

class MessageHandler {
    constructor(config, ocrService, analysisService, roleService, messageService) {
        this.config = config;
        this.ocrService = ocrService;
        this.analysisService = analysisService;
        this.roleService = roleService;
        this.messageService = messageService;
    }

    /**
     * Obsługuje wiadomości z załącznikami
     * @param {Message} message - Wiadomość Discord
     */
    async handleMessage(message) {
        if (message.author.bot) return;

        // Sprawdź czy wiadomość jest z monitorowanego kanału
        const channelConfig = this.roleService.getChannelConfig(message.channel.id);
        if (!channelConfig) return;

        logger.info(`Wykryto wiadomość na monitorowanym kanale ${channelConfig.name}`);

        // Sprawdź czy to obraz
        const imageAttachment = message.attachments.find(attachment =>
            attachment.contentType && attachment.contentType.startsWith('image/')
        );

        if (!imageAttachment) return;

        // Sprawdź rozmiar pliku
        if (imageAttachment.size > this.config.files.maxSize) {
            await message.reply({
                content: this.config.messages.fileTooBig,
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        let member;
        try {
            member = await message.guild.members.fetch(message.author.id);
        } catch (error) {
            logger.error(`Błąd pobierania informacji o członku: ${error.message}`);
            await message.reply({
                content: this.config.messages.userInfoError,
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        // NOWA FUNKCJONALNOŚĆ: Sprawdź czy użytkownik ma rolę blokującą
        if (this.roleService.isUserBlocked(member)) {
            await message.reply({
                content: this.messageService.getBlockedUserMessage(),
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        const displayName = member.displayName;
        const username = message.author.username;

        this.logAnalysisStart(displayName, username, imageAttachment, channelConfig);

        let analysisMessage;
        try {
            analysisMessage = await message.reply({
                content: this.config.messages.analysisStarted,
                allowedMentions: { repliedUser: false }
            });
        } catch (error) {
            logger.error(`Błąd tworzenia wiadomości odpowiedzi: ${error.message}`);
            return;
        }

        await this.processImage(analysisMessage, imageAttachment, displayName, username, channelConfig, member, message.guild);
    }

    /**
     * Loguje rozpoczęcie analizy
     * @param {string} displayName - Nick na serwerze
     * @param {string} username - Nazwa użytkownika
     * @param {Attachment} imageAttachment - Załącznik obrazu
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    logAnalysisStart(displayName, username, imageAttachment, channelConfig) {
        logger.info('\n' + '='.repeat(70));
        logger.info('🚀 NOWA ANALIZA ROZPOCZĘTA');
        logger.info(`👤 Nick serwera: "${displayName}"`);
        logger.info(`👤 Nazwa użytkownika: "${username}"`);
        logger.info(`📷 Obraz: ${imageAttachment.name} (${Math.round(imageAttachment.size / 1024)}KB)`);
        logger.info(`📅 Czas: ${new Date().toLocaleString('pl-PL')}`);
        logger.info(`🔗 URL: ${imageAttachment.url}`);
        logger.info(`⚙️ Kanał ${channelConfig.name}: min=${channelConfig.minimumScore}, zakres=${channelConfig.scoreRange}, krok=${channelConfig.scoreStep}`);
        logger.info(`🎯 Wymagane ${channelConfig.requireSecondOccurrence ? 'DRUGIE' : 'PIERWSZE'} wystąpienie nicku`);
        logger.info(`🔍 Próg podobieństwa nicku: ${this.config.similarity.threshold * 100}%`);
        logger.info(`🖼️ Preprocessing: ${channelConfig.name === 'Daily' ? 'BIAŁY TEKST NA SZARYM TLE' : 'BIAŁO-CZARNY'}`);
        logger.info(`🔤 Normalizacja s/S: 5 lub 8 (testowane oba warianty)`);
        if (channelConfig.name === 'Daily') {
            logger.info('🎯 DAILY: Specjalny wyjątek "sg" -> "9"');
        }
        logger.info(`⚠️ WYKLUCZENIE: Pierwsze ${channelConfig.skipLines} linie tekstu są pomijane`);
        logger.info('='.repeat(70));
    }

    /**
     * Przetwarza obraz i wykonuje analizę
     * @param {Message} analysisMessage - Wiadomość z postępem analizy
     * @param {Attachment} imageAttachment - Załącznik obrazu
     * @param {string} displayName - Nick na serwerze
     * @param {string} username - Nazwa użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     * @param {GuildMember} member - Członek serwera
     * @param {Guild} guild - Serwer Discord
     */
    async processImage(analysisMessage, imageAttachment, displayName, username, channelConfig, member, guild) {
        let originalImagePath = null;
        let processedImagePath = null;

        try {
            // Pobieranie obrazu
            await safeEditMessage(analysisMessage, this.config.messages.downloading);
            originalImagePath = await this.downloadImage(imageAttachment);

            // Preprocessing
            await safeEditMessage(analysisMessage, this.config.messages.preprocessing);
            processedImagePath = await this.ocrService.preprocessImage(originalImagePath, channelConfig);

            // OCR i analiza
            await safeEditMessage(analysisMessage, this.config.messages.ocr);
            const result = await this.analysisService.analyzeImage(processedImagePath, displayName, username, channelConfig);

            logger.info(`Wynik analizy: ${JSON.stringify(result)}`);

            if (result.found && result.isValid && result.score !== null) {
                await this.handleSuccessfulAnalysis(analysisMessage, result, channelConfig, member, guild);
            } else {
                await this.handleFailedAnalysis(analysisMessage, result, channelConfig);
            }

        } catch (error) {
            logger.error(`BŁĄD PODCZAS ANALIZY: ${error.message}`);
            await safeEditMessage(analysisMessage, this.messageService.formatAnalysisErrorMessage(error.message));
        } finally {
            cleanupFiles(originalImagePath, processedImagePath);
            logger.info('Zakończono czyszczenie pamięci');
            logger.info('='.repeat(70) + '\n');
        }
    }

    /**
     * Pobiera obraz z załącznika
     * @param {Attachment} attachment - Załącznik
     * @returns {string} - Ścieżka do pobranego pliku
     */
    async downloadImage(attachment) {
        const fileName = `temp_${Date.now()}_${attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = require('path').join(this.config.ocr.tempDir, fileName);
        
        // Upewnij się, że katalog istnieje
        const fs = require('fs');
        if (!fs.existsSync(this.config.ocr.tempDir)) {
            fs.mkdirSync(this.config.ocr.tempDir, { recursive: true });
        }
        
        return await downloadFile(attachment.url, filePath);
    }

    /**
     * Obsługuje udaną analizę
     * @param {Message} analysisMessage - Wiadomość analizy
     * @param {Object} result - Wynik analizy
     * @param {Object} channelConfig - Konfiguracja kanału
     * @param {GuildMember} member - Członek serwera
     * @param {Guild} guild - Serwer Discord
     */
    async handleSuccessfulAnalysis(analysisMessage, result, channelConfig, member, guild) {
        logger.info('SUKCES! Wynik spełnia wymagania');

        const roleResult = await this.roleService.assignRole(member, channelConfig.requiredRoleId, guild);
        
        if (roleResult.success) {
            const message = this.messageService.formatResultMessage(result, roleResult, channelConfig);
            await safeEditMessage(analysisMessage, message);
        } else {
            const message = this.messageService.formatRoleErrorMessage(result, roleResult.error);
            await safeEditMessage(analysisMessage, message);
        }

        // Wyślij informację o loterii Daily lub CX
        await this.sendLotteryInfo(analysisMessage, channelConfig);
    }

    /**
     * Obsługuje nieudaną analizę
     * @param {Message} analysisMessage - Wiadomość analizy
     * @param {Object} result - Wynik analizy
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    async handleFailedAnalysis(analysisMessage, result, channelConfig) {
        logger.info(`Analiza nieudana: ${result.error || 'Niewystarczający wynik'}`);
        const message = this.messageService.formatResultMessage(result, null, channelConfig);
        await safeEditMessage(analysisMessage, message);
        
        // Wyślij informację o loterii Daily lub CX
        await this.sendLotteryInfo(analysisMessage, channelConfig);
    }

    /**
     * Wysyła informację o loterii Daily lub CX w formie embed message
     * @param {Message} analysisMessage - Wiadomość analizy
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    async sendLotteryInfo(analysisMessage, channelConfig) {
        // Wysyłaj tylko na kanałach Daily i CX
        if (channelConfig.name !== 'Daily' && channelConfig.name !== 'CX') {
            return;
        }

        try {
            const channel = analysisMessage.channel;
            const client = analysisMessage.client;
            const isDaily = channelConfig.name === 'Daily';
            const lotteryTitle = isDaily ? '🎰 Loteria Glory Member za Daily' : '🎰 Loteria Glory Member za CX';

            // Znajdź i usuń poprzednią wiadomość embed o loterii od tego bota
            try {
                const messages = await channel.messages.fetch({ limit: 50 });
                const previousLotteryMessage = messages.find(msg => 
                    msg.author.id === client.user.id && 
                    msg.embeds.length > 0 && 
                    msg.embeds[0].title === lotteryTitle
                );

                if (previousLotteryMessage) {
                    await previousLotteryMessage.delete();
                    logger.info(`🗑️ Usunięto poprzednią wiadomość o loterii ${channelConfig.name}`);
                }
            } catch (deleteError) {
                logger.warn('⚠️ Nie udało się usunąć poprzedniej wiadomości o loterii:', deleteError.message);
            }

            // Wyślij nową wiadomość embed o loterii
            let lotteryEmbed;
            
            if (isDaily) {
                lotteryEmbed = new EmbedBuilder()
                    .setTitle('🎰 Loteria Glory Member za Daily')
                    .setDescription('Żeby wziąć udział w loterii i wygrać rangę Glory Member na tydzień, należy:')
                    .addFields(
                        { name: '📊 Wymagania', value: '• uzyskać w danym tygodniu 910 pkt. daily', inline: false },
                        { name: '📸 Przesłanie screena', value: '• przesłać screen z tego osiągnięcia na tym kanale', inline: false },
                        { name: '⏰ Deadline', value: '• czas na przesłanie screena jest do niedzieli do 18:29', inline: false },
                        { name: '✅ Zatwierdzenie', value: '• screen musi być zatwierdzony przez bota Kontroler', inline: false },
                        { name: '⚠️ Ostrzeżenie', value: '• oszukiwanie bota podrobionymi screenami będzie skutkowało banem na Glory Member, a w szczególnych przypadkach może grozić usunięciem z klanu!', inline: false },
                        { name: '🎲 Losowanie', value: 'Losowania będą odbywać się o godzinie 18:30 w każdą niedzielę. Powodzenia!', inline: false }
                    )
                    .setColor(0x00FF00) // Zielony kolor
                    .setTimestamp();
            } else {
                lotteryEmbed = new EmbedBuilder()
                    .setTitle('🎰 Loteria Glory Member za CX')
                    .setDescription('Żeby wziąć udział w loterii i wygrać rangę Glory Member na tydzień, należy:')
                    .addFields(
                        { name: '📊 Wymagania', value: '• osiągnąć w ciągu całego sezonu CX 2000 PKT', inline: false },
                        { name: '📸 Przesłanie screena', value: '• przesłać screen z tego osiągnięcia na tym kanale', inline: false },
                        { name: '⏰ Deadline', value: '• czas na przesłanie screena jest do 18:29 w dniu, w którym rozpoczął się nowy sezon CX', inline: false },
                        { name: '✅ Zatwierdzenie', value: '• screen musi być zatwierdzony przez bota Kontroler', inline: false },
                        { name: '⚠️ Ostrzeżenie', value: '• oszukiwanie bota podrobionymi screenami będzie skutkowało banem na Glory Member, a w szczególnych przypadkach może grozić usunięciem z klanu!', inline: false },
                        { name: '🎲 Losowanie', value: 'Losowania będą odbywać się o godzinie 18:30 w każdy pierwszy dzień sezonu CX. Powodzenia!', inline: false }
                    )
                    .setColor(0xFF6600) // Pomarańczowy kolor dla CX
                    .setTimestamp();
            }

            await channel.send({ embeds: [lotteryEmbed] });
            logger.info(`✅ Wysłano nową informację o loterii ${channelConfig.name} na dole czatu`);
        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania informacji o loterii ${channelConfig.name}:`, error);
        }
    }
}

module.exports = MessageHandler;