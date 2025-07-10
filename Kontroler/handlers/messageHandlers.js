const { logWithTimestamp, downloadFile, cleanupFiles, safeEditMessage } = require('../utils/helpers');

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

        logWithTimestamp(`Wykryto wiadomość na monitorowanym kanale ${channelConfig.name}`, 'info');

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
            logWithTimestamp(`Błąd pobierania informacji o członku: ${error.message}`, 'error');
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
            logWithTimestamp(`Błąd tworzenia wiadomości odpowiedzi: ${error.message}`, 'error');
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
        console.log('\n' + '='.repeat(70));
        console.log('🚀 NOWA ANALIZA ROZPOCZĘTA');
        console.log(`👤 Nick serwera: "${displayName}"`);
        console.log(`👤 Nazwa użytkownika: "${username}"`);
        console.log(`📷 Obraz: ${imageAttachment.name} (${Math.round(imageAttachment.size / 1024)}KB)`);
        console.log(`📅 Czas: ${new Date().toLocaleString('pl-PL')}`);
        console.log(`🔗 URL: ${imageAttachment.url}`);
        console.log(`⚙️ Kanał ${channelConfig.name}: min=${channelConfig.minimumScore}, zakres=${channelConfig.scoreRange}, krok=${channelConfig.scoreStep}`);
        console.log(`🎯 Wymagane ${channelConfig.requireSecondOccurrence ? 'DRUGIE' : 'PIERWSZE'} wystąpienie nicku`);
        console.log(`🔍 Próg podobieństwa nicku: ${this.config.similarity.threshold * 100}%`);
        console.log(`🖼️ Preprocessing: ${channelConfig.name === 'Daily' ? 'BIAŁY TEKST NA SZARYM TLE' : 'BIAŁO-CZARNY'}`);
        console.log(`🔤 Normalizacja s/S: 5 lub 8 (testowane oba warianty)`);
        if (channelConfig.name === 'Daily') {
            console.log('🎯 DAILY: Specjalny wyjątek "sg" -> "9"');
        }
        console.log(`⚠️ WYKLUCZENIE: Pierwsze ${channelConfig.skipLines} linie tekstu są pomijane`);
        console.log('='.repeat(70));
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

            logWithTimestamp(`Wynik analizy: ${JSON.stringify(result)}`, 'info');

            if (result.found && result.isValid && result.score !== null) {
                await this.handleSuccessfulAnalysis(analysisMessage, result, channelConfig, member, guild);
            } else {
                await this.handleFailedAnalysis(analysisMessage, result, channelConfig);
            }

        } catch (error) {
            logWithTimestamp(`BŁĄD PODCZAS ANALIZY: ${error.message}`, 'error');
            await safeEditMessage(analysisMessage, this.messageService.formatAnalysisErrorMessage(error.message));
        } finally {
            cleanupFiles(originalImagePath, processedImagePath);
            logWithTimestamp('Zakończono czyszczenie pamięci', 'info');
            console.log('='.repeat(70) + '\n');
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
        logWithTimestamp('SUKCES! Wynik spełnia wymagania', 'success');

        const roleResult = await this.roleService.assignRole(member, channelConfig.requiredRoleId, guild);
        
        if (roleResult.success) {
            const message = this.messageService.formatResultMessage(result, roleResult, channelConfig);
            await safeEditMessage(analysisMessage, message);
        } else {
            const message = this.messageService.formatRoleErrorMessage(result, roleResult.error);
            await safeEditMessage(analysisMessage, message);
        }
    }

    /**
     * Obsługuje nieudaną analizę
     * @param {Message} analysisMessage - Wiadomość analizy
     * @param {Object} result - Wynik analizy
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    async handleFailedAnalysis(analysisMessage, result, channelConfig) {
        logWithTimestamp(`Analiza nieudana: ${result.error || 'Niewystarczający wynik'}`, 'warn');
        const message = this.messageService.formatResultMessage(result, null, channelConfig);
        await safeEditMessage(analysisMessage, message);
    }
}

module.exports = MessageHandler;