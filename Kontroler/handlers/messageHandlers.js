const { downloadFile, cleanupFiles, safeEditMessage } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const { sync: appSync, eventId } = require('../../utils/appSync');
const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const logger = createBotLogger('Kontroler');

class MessageHandler {
    constructor(config, ocrService, analysisService, roleService, messageService, lotteryService = null, votingService = null) {
        this.config = config;
        this.ocrService = ocrService;
        this.analysisService = analysisService;
        this.roleService = roleService;
        this.messageService = messageService;
        this.lotteryService = lotteryService;
        this.votingService = votingService;
        this.lotterySchedules = new Map(); // Mapa zaplanowanych zadań cron dla każdego kanału
        this.lotteryMessageIds = new Map(); // Mapa ID wiadomości o loterii dla każdego kanału
        this.lotteryMessageIdsFile = path.join(__dirname, '../data/lottery_message_ids.json');
        
        // Wczytaj ID wiadomości z pliku przy starcie
        this.loadLotteryMessageIds();
    }

    /**
     * Obsługuje wiadomości z załącznikami
     * @param {Message} message - Wiadomość Discord
     */
    async handleMessage(message) {
        if (message.author.bot) return;

        // Sprawdź system głosowania "Działasz na szkodę klanu" (działa na określonych kanałach)
        if (this.votingService) {
            await this.handleVotingSystem(message);
        }

        // Sprawdź czy wiadomość jest z monitorowanego kanału
        const channelConfig = this.roleService.getChannelConfig(message.channel.id);
        
        if (!channelConfig) {
            // Nie loguj dla niemonitorowanych kanałów - zmniejszy spam w logach
            return;
        }
        
        logger.info(`🔍 Wykryto wiadomość na monitorowanym kanale ${channelConfig.name} (${message.channel.name})`);

        // Pobierz członka do sprawdzeń
        let member;
        try {
            member = await message.guild.members.fetch(message.author.id);
        } catch (error) {
            logger.error(`Błąd pobierania informacji o członku: ${error.message}`);
            
            // Wyślij informację o loterii z opóźnieniem mimo błędu
            this.scheduleLotteryInfo(message, channelConfig);
            return;
        }

        // USUWANIE WIADOMOŚCI BEZ ZDJĘĆ: Sprawdź czy wiadomość ma obrazy
        const imageAttachment = message.attachments.find(attachment =>
            attachment.contentType && attachment.contentType.startsWith('image/')
        );

        if (!imageAttachment) {
            const isAdmin = member.permissions.has('Administrator');
            
            if (!isAdmin) {
                // Usuń wiadomość bez obrazu od zwykłego użytkownika
                try {
                    await message.delete();
                    logger.info(`🗑️ Usunięto wiadomość bez zdjęcia od ${message.author.tag} na kanale ${channelConfig.name}`);
                } catch (error) {
                    logger.error(`❌ Błąd usuwania wiadomości bez zdjęcia: ${error.message}`);
                }
                
                // Wyślij informację o loterii z opóźnieniem mimo usunięcia wiadomości
                this.scheduleLotteryInfo(message, channelConfig);
                return;
            } else {
                logger.info(`👑 Administrator ${member.user.tag} wysłał wiadomość bez zdjęcia na kanale ${channelConfig.name} - pozostawiono`);
                
                // Wyślij informację o loterii z opóźnieniem mimo braku zdjęcia
                this.scheduleLotteryInfo(message, channelConfig);
                return;
            }
        }

        // Sprawdź rozmiar pliku
        if (imageAttachment.size > this.config.files.maxSize) {
            const replyMessage = await message.reply({
                content: this.config.messages.fileTooBig,
                allowedMentions: { repliedUser: false }
            });
            
            // Wyślij informację o loterii z opóźnieniem mimo błędu
            this.scheduleLotteryInfo(replyMessage, channelConfig);
            return;
        }

        // NOWA FUNKCJONALNOŚĆ: Sprawdź czy użytkownik ma rolę blokującą
        if (this.roleService.isUserBlocked(member)) {
            const replyMessage = await message.reply({
                content: this.messageService.getBlockedUserMessage(),
                allowedMentions: { repliedUser: false }
            });
            
            // Wyślij informację o loterii z opóźnieniem mimo odmowy analizy
            this.scheduleLotteryInfo(replyMessage, channelConfig);
            return;
        }

        // SPRAWDZENIE AKTYWNEJ LOTERII: Sprawdź czy dla klanu użytkownika jest aktywna loteria
        logger.info(`🔍 Sprawdzam warunki loterii: lotteryService=${!!this.lotteryService}, channelName=${channelConfig.name}`);
        if (this.lotteryService && (channelConfig.name === 'Daily' || channelConfig.name === 'CX')) {
            logger.info(`🔍 Sprawdzam aktywną loterię dla kanału ${channelConfig.name} (${member.user.tag})`);
            const targetRoleId = channelConfig.requiredRoleId;
            const lotteryCheck = this.lotteryService.checkUserLotteryEligibility(member, targetRoleId);
            logger.info(`📊 Wynik sprawdzenia loterii:`, {
                hasValidClan: lotteryCheck.hasValidClan,
                clanName: lotteryCheck.clanName,
                isLotteryActive: lotteryCheck.isLotteryActive
            });
            
            if (!lotteryCheck.isLotteryActive) {
                const channelTypeName = channelConfig.name === 'Daily' ? 'Daily' : 'CX';
                let noLotteryMessage = `🚫 **Brak aktywnej loterii**\n\n`;
                noLotteryMessage += `Dla Twojego klanu **${lotteryCheck.clanName}** nie ma obecnie aktywnej loterii **${channelTypeName}**.\n\n`;
                noLotteryMessage += `Twoje zdjęcie nie zostanie przeanalizowane.`;
                
                const replyMessage = await message.reply({
                    content: noLotteryMessage,
                    allowedMentions: { repliedUser: false }
                });
                
                logger.info(`🚫 Zablokowano analizę OCR dla ${member.user.tag} - brak aktywnej loterii ${channelTypeName} dla klanu ${lotteryCheck.clanName}`);
                
                // Wyślij informację o loterii z opóźnieniem mimo odmowy analizy
                this.scheduleLotteryInfo(replyMessage, channelConfig);
                return;
            }
            
            // SPRAWDZENIE OKNA CZASOWEGO: Sprawdź czy aktualnie można przesyłać screeny (TESTOWY TRYB - nie ignoruj administratorów)
            const isAdmin = member.permissions.has('Administrator');
            if (!this.lotteryService) {
                logger.warn('⚠️ lotteryService nie jest dostępne dla sprawdzenia okna czasowego');
                
                // Wyślij informację o loterii z opóźnieniem mimo błędu
                this.scheduleLotteryInfo(message, channelConfig);
                return;
            }
            const timeWindowCheck = this.lotteryService.checkSubmissionTimeWindow(targetRoleId, lotteryCheck.clanRoleId);
            logger.info(`🕰️ Wynik sprawdzenia okna czasowego:`, {
                isAllowed: timeWindowCheck.isAllowed,
                reason: timeWindowCheck.reason || 'ALLOWED',
                channelType: timeWindowCheck.channelType,
                hoursUntilDraw: timeWindowCheck.hoursUntilDraw,
                hoursToWait: timeWindowCheck.hoursToWait
            });
            
            if (!timeWindowCheck.isAllowed && !isAdmin) {
                const timeToWait = this.formatHoursToTime(timeWindowCheck.hoursToWait);
                
                let timeWindowMessage = `⏰ **Nie można przeanalizować screena!**\n\n`;
                timeWindowMessage += timeWindowCheck.message;
                timeWindowMessage += `\n\n⏱️ **Będzie można dodać screena za:** ${timeToWait}`;
                
                const replyMessage = await message.reply({
                    content: timeWindowMessage,
                    allowedMentions: { repliedUser: false }
                });
                
                logger.info(`⏰ Zablokowano analizę OCR dla ${member.user.tag} - poza oknem czasowym ${timeWindowCheck.channelType} (${timeWindowCheck.hoursUntilDraw}h do losowania, czekać ${timeToWait})`);
                
                // Wyślij informację o loterii z opóźnieniem mimo odmowy analizy (używamy reply message)
                this.scheduleLotteryInfo(replyMessage, channelConfig);
                return;
            } else {
                const adminInfo = isAdmin ? ' (ADMINISTRATOR)' : '';
                logger.info(`✅ Pozwolono na analizę OCR dla ${member.user.tag}${adminInfo} - w oknie czasowym ${timeWindowCheck.channelType} (${timeWindowCheck.hoursUntilDraw}h do losowania)`);
            }
        } else {
            logger.info(`⚠️ Pominięto sprawdzenie loterii: lotteryService=${!!this.lotteryService}, channelName=${channelConfig.name}`);
            logger.info(`🚨 UWAGA: Kontynuuję analizę OCR bez sprawdzenia loterii/okna czasowego!`);
        }

        logger.info(`🎯 Kontynuuję z analizą OCR dla ${member.user.tag} na kanale ${channelConfig.name}`);
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
            
            // Wyślij informację o loterii z opóźnieniem mimo błędu
            this.scheduleLotteryInfo(message, channelConfig);
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
            // Wyślij informację o loterii Daily lub CX z opóźnieniem zawsze na końcu
            this.scheduleLotteryInfo(analysisMessage, channelConfig);
            
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

        // Sprawdź czy to kanał CX i czy wynik kwalifikuje do roli specjalnej
        let specialRoleResult = null;
        if (channelConfig.name === 'CX' && channelConfig.specialRole &&
            result.score >= channelConfig.specialRole.threshold) {

            logger.info(`👑 Użytkownik ${member.displayName} osiągnął ${result.score} pkt - nadanie roli specjalnej CX`);
            specialRoleResult = await this.roleService.assignRole(member, channelConfig.specialRole.roleId, guild);

            if (specialRoleResult.success) {
                logger.info(`👑 Pomyślnie nadano rolę specjalną CX użytkownikowi ${member.displayName}`);
            } else {
                logger.error(`❌ Błąd nadania roli specjalnej CX: ${specialRoleResult.error}`);
            }
        }

        // Zapisz wynik CX do shared_data dla innych botów (np. Stalker /player-status)
        if (channelConfig.name === 'CX') {
            try {
                const cxHistoryPath = path.join(__dirname, '../../shared_data/cx_history.json');
                let cxHistory = {};
                try {
                    const raw = await fs.readFile(cxHistoryPath, 'utf8');
                    cxHistory = JSON.parse(raw);
                } catch (e) {
                    // Plik nie istnieje jeszcze, tworzymy nowy
                }

                const userId = member.user.id;
                const completedAt = new Date().toISOString();
                if (!cxHistory[userId]) {
                    cxHistory[userId] = { scores: [] };
                }

                cxHistory[userId].displayName = member.displayName;
                cxHistory[userId].lastCxDate = completedAt;
                cxHistory[userId].scores.push({
                    score: result.score,
                    date: completedAt,
                    guildId: guild.id
                });

                // Ogranicz historię do ostatnich 20 wyników
                if (cxHistory[userId].scores.length > 20) {
                    cxHistory[userId].scores = cxHistory[userId].scores.slice(-20);
                }

                await fs.writeFile(cxHistoryPath, JSON.stringify(cxHistory, null, 2), 'utf8');
                logger.info(`💾 Zapisano wynik CX gracza ${member.displayName}: ${result.score} pkt`);

                appSync.cxEntry({
                    id: eventId('cx', guild.id, userId, completedAt, result.score),
                    discordId: userId,
                    score: result.score,
                    completedAt,
                });
            } catch (e) {
                logger.error(`❌ Błąd zapisu CX history: ${e.message}`);
            }
        }

        if (roleResult.success) {
            const message = this.messageService.formatResultMessage(result, roleResult, channelConfig, specialRoleResult);
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
        logger.info(`Analiza nieudana: ${result.error || 'Niewystarczający wynik'}`);
        const message = this.messageService.formatResultMessage(result, null, channelConfig);
        await safeEditMessage(analysisMessage, message);
    }

    /**
     * Formatuje liczbę godzin na format 3d 12h 43m
     * @param {number} hours - Liczba godzin (może mieć część dziesiętną)
     * @returns {string} - Sformatowany czas w formacie 3d 12h 43m
     */
    formatHoursToTime(hours) {
        if (!hours || hours <= 0) {
            return '0h 0m';
        }
        
        const totalMinutes = Math.ceil(hours * 60);
        
        const days = Math.floor(totalMinutes / (24 * 60));
        const remainingMinutesAfterDays = totalMinutes % (24 * 60);
        
        const h = Math.floor(remainingMinutesAfterDays / 60);
        const m = remainingMinutesAfterDays % 60;
        
        let result = '';
        
        if (days > 0) {
            result += `${days}d `;
        }
        
        if (h > 0) {
            result += `${h}h `;
        }
        
        if (m > 0) {
            result += `${m}m`;
        }
        
        // Jeśli wszystko jest 0, zwróć podstawowy format
        if (!result.trim()) {
            result = '0h 0m';
        }
        
        return result.trim();
    }

    /**
     * Planuje wysłanie informacji o loterii z 10-sekundowym opóźnieniem używając node-cron
     * @param {Message} message - Wiadomość analizy lub oryginalna wiadomość użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    scheduleLotteryInfo(message, channelConfig) {
        // Wysyłaj tylko na kanałach Daily i CX
        if (channelConfig.name !== 'Daily' && channelConfig.name !== 'CX') {
            return;
        }

        const channelId = message.channel.id;
        
        // Anuluj poprzedni timeout dla tego kanału jeśli istnieje
        if (this.lotterySchedules.has(channelId)) {
            const existingTimeout = this.lotterySchedules.get(channelId);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
                logger.info(`🔄 Anulowano poprzedni timeout loterii dla kanału ${channelConfig.name}`);
            }
            this.lotterySchedules.delete(channelId);
        }
        
        // Zaplanuj zadanie za 10 sekund używając setTimeout
        const timeoutId = setTimeout(async () => {
            try {
                await this.sendLotteryInfo(message, channelConfig);
                this.lotterySchedules.delete(channelId); // Usuń zadanie po wykonaniu
            } catch (error) {
                logger.error(`❌ Błąd podczas wysyłania zaplanowanej wiadomości o loterii ${channelConfig.name}:`, error);
                this.lotterySchedules.delete(channelId);
            }
        }, 10000);

        this.lotterySchedules.set(channelId, timeoutId);
        logger.info(`⏰ Zaplanowano wysłanie wiadomości o loterii ${channelConfig.name} za 10 sekund`);
    }

    /**
     * Wysyła informację o loterii Daily lub CX w formie embed message
     * @param {Message} message - Wiadomość analizy lub oryginalna wiadomość użytkownika
     * @param {Object} channelConfig - Konfiguracja kanału
     */
    async sendLotteryInfo(message, channelConfig) {
        // Wysyłaj tylko na kanałach Daily i CX
        if (channelConfig.name !== 'Daily' && channelConfig.name !== 'CX') {
            return;
        }

        try {
            const channel = message.channel;
            const client = message.client;
            const isDaily = channelConfig.name === 'Daily';
            const lotteryTitle = isDaily ? '# 🎰 Loteria Glory Member za Daily' : '# 🎰 Loteria Glory Member za CX';
            
            logger.info(`📤 Sprawdzam możliwość wysłania embeda loterii na kanał: ${channel.name} (${channel.id})`);

            // Sprawdź czy już mamy zapisane ID embeda o loterii dla tego kanału
            const existingMessageId = this.lotteryMessageIds.get(channel.id);
            if (existingMessageId) {
                try {
                    // Sprawdź czy embed nadal istnieje
                    const existingMessage = await channel.messages.fetch(existingMessageId);
                    
                    // Sprawdź czy embed jest ostatnią wiadomością na kanale
                    const lastMessages = await channel.messages.fetch({ limit: 1 });
                    const lastMessage = lastMessages.first();
                    
                    if (lastMessage && lastMessage.id === existingMessageId) {
                        logger.info(`ℹ️ Embed o loterii ${channelConfig.name} już istnieje i jest ostatni (ID: ${existingMessageId}) - nie wysyłam nowego`);
                        return;
                    } else {
                        logger.info(`🔄 Embed o loterii ${channelConfig.name} istnieje ale nie jest ostatni - usuwam i wysyłam nowy`);
                        // Usuń stary embed, bo nie jest już ostatni
                        await existingMessage.delete();
                        this.lotteryMessageIds.delete(channel.id);
                        await this.saveLotteryMessageIds();
                    }
                } catch (fetchError) {
                    // Embed nie istnieje (został usunięty), usuń z mapy
                    this.lotteryMessageIds.delete(channel.id);
                    await this.saveLotteryMessageIds();
                    logger.info(`🔄 Stary embed o loterii ${channelConfig.name} nie istnieje - można wysłać nowy`);
                }
            }


            // Wyślij nową wiadomość embed o loterii
            let lotteryEmbed;
            
            if (isDaily) {
                lotteryEmbed = new EmbedBuilder()
                    .setDescription(`# 🎰 Loteria Glory Member za Daily

Żeby wziąć udział w loterii i wygrać rangę Glory Member na tydzień, należy:

🎯 uzyskać w danym tygodniu **910 PKT** daily
📸 przesłać screen z tego osiągnięcia na tym kanale
⏰ czas na przesłanie screena jest do niedzieli do **18:30**
✅ screen musi być zatwierdzony przez bota Kontroler
⚠️ **oszukiwanie bota podrobionymi screenami będzie skutkowało banem na Glory Member, a w szczególnych przypadkach może grozić usunięciem z klanu!**

${this.getLotteryInfoForEmbed(channelConfig.requiredRoleId)}`)
                    .setColor(0x00FF00) // Zielony kolor
                    .setTimestamp();
            } else {
                lotteryEmbed = new EmbedBuilder()
                    .setDescription(`# 🎰 Loteria Glory Member za CX

Żeby wziąć udział w loterii i wygrać rangę Glory Member na tydzień, należy:

🎯 osiągnąć w ciągu całego sezonu CX **1500 PKT**
📸 przesłać screen z tego osiągnięcia na tym kanale
⏰ czas na przesłanie screena jest do **18:30** w dniu, w którym rozpoczął się nowy sezon
✅ screen musi być zatwierdzony przez bota Kontroler
⚠️ **oszukiwanie bota podrobionymi screenami będzie skutkowało banem na Glory Member, a w szczególnych przypadkach może grozić usunięciem z klanu!**

${this.getLotteryInfoForEmbed(channelConfig.requiredRoleId)}`)
                    .setColor(0xFF6600) // Pomarańczowy kolor dla CX
                    .setTimestamp();
            }

            const lotteryMessage = await channel.send({ embeds: [lotteryEmbed] });
            this.lotteryMessageIds.set(channel.id, lotteryMessage.id);
            await this.saveLotteryMessageIds();
            logger.info(`✅ Wysłano nową informację o loterii ${channelConfig.name} na dole czatu (ID: ${lotteryMessage.id})`);
        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania informacji o loterii ${channelConfig.name}:`, error);
        }
    }

    /**
     * Pobiera informację o aktywnych loteriach dla embeda
     * @param {string} targetRoleId - ID roli docelowej
     * @returns {string} - Informacje o loteriach lub pusty string
     */
    getLotteryInfoForEmbed(targetRoleId) {
        if (!this.lotteryService) {
            return '## Brak aktywnych loterii!';
        }

        const lotteryInfo = this.lotteryService.formatActiveLotteriesInfo(targetRoleId);
        if (!lotteryInfo) {
            return '## Brak aktywnych loterii!';
        }

        return `🎰 **Aktywne loterie:**\n${lotteryInfo}`;
    }

    /**
     * Wczytuje ID wiadomości o loterii z pliku
     */
    async loadLotteryMessageIds() {
        try {
            const data = await fs.readFile(this.lotteryMessageIdsFile, 'utf8');
            const idsData = JSON.parse(data);
            
            this.lotteryMessageIds.clear();
            for (const [channelId, messageId] of Object.entries(idsData)) {
                this.lotteryMessageIds.set(channelId, messageId);
            }
            
            logger.info(`📂 Wczytano ${Object.keys(idsData).length} ID wiadomości o loterii z pliku`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('📂 Brak pliku z ID wiadomości o loterii - rozpoczynanie z pustą listą');
            } else {
                logger.error('❌ Błąd podczas wczytywania ID wiadomości o loterii:', error);
            }
        }
    }

    /**
     * Zapisuje ID wiadomości o loterii do pliku
     */
    async saveLotteryMessageIds() {
        try {
            // Upewnij się, że katalog istnieje
            const dataDir = path.dirname(this.lotteryMessageIdsFile);
            await fs.mkdir(dataDir, { recursive: true });
            
            const idsData = {};
            for (const [channelId, messageId] of this.lotteryMessageIds.entries()) {
                idsData[channelId] = messageId;
            }
            
            await fs.writeFile(this.lotteryMessageIdsFile, JSON.stringify(idsData, null, 2));
            logger.info(`💾 Zapisano ${Object.keys(idsData).length} ID wiadomości o loterii do pliku`);
        } catch (error) {
            logger.error('❌ Błąd podczas zapisywania ID wiadomości o loterii:', error);
        }
    }

    /**
     * Obsługuje system głosowania "Działasz na szkodę klanu"
     * @param {Message} message - Wiadomość Discord
     */
    async handleVotingSystem(message) {
        try {
            // Dozwolone kanały dla systemu głosowania
            const allowedChannels = ['1194299628905042040', '1194298890069999756', '1200051393843695699', '1262792174475673610', '1170323972173340744'];

            // Sprawdź czy wiadomość jest z dozwolonego kanału
            if (!allowedChannels.includes(message.channel.id)) {
                return;
            }

            // Sprawdź czy wiadomość jest odpowiedzią na inną wiadomość
            if (!this.votingService.isReplyToUser(message)) {
                return;
            }

            // Sprawdź czy wiadomość zawiera frazę uruchamiającą głosowanie
            if (!this.votingService.checkTriggerPhrase(message.content)) {
                return;
            }

            // Pobierz użytkownika z odpowiedzi
            const targetUser = await this.votingService.getReferencedUser(message);
            if (!targetUser || targetUser.bot) {
                return; // Nie można głosować na boty lub błąd pobierania użytkownika
            }

            // Nie można głosować na siebie
            if (targetUser.id === message.author.id) {
                return;
            }

            // Rozpocznij głosowanie
            await this.votingService.startVoting(message, targetUser);

        } catch (error) {
            logger.error('❌ Błąd podczas obsługi systemu głosowania:', error);
        }
    }

}

module.exports = MessageHandler;