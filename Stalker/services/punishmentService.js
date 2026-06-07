const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { downloadDiscordImage } = require('../utils/helpers');
const { assignNicksToClan } = require('../utils/nickMatcher');

const { createBotLogger } = require('../../utils/consoleLogger');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');

const logger = createBotLogger('Stalker');
class PunishmentService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
        this.activeSessions = new Map(); // sessionId → session
        this.tempDir = './Stalker/temp';
        this.ocrService = null; // Będzie ustawione przez setOCRService
    }

    /**
     * Ustawia referencję do OCR Service (wywoływane z index.js)
     */
    setOCRService(ocrService) {
        this.ocrService = ocrService;
        logger.info('[PUNISH] ✅ OCR Service przypisany do PunishmentService');
    }

    async processPunishments(guild, foundUsers) {
        try {
            logger.info('Dodawanie punktów');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`👥 Liczba użytkowników: ${foundUsers.length}`);
            
            const results = [];
            
            for (const userData of foundUsers) {
                // POPRAWKA: userData.user zawiera {userId, member, displayName}
                const member = userData.user.member;
                const userId = userData.user.userId;
                const matchedName = userData.detectedNick;

                logger.info(`\n👤 Przetwarzanie: ${member.displayName} (${userId})`);
                const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, 1, 'Niepokonanie bossa');
                
                logger.info(`📊 Nowa liczba punktów: ${userPunishment.points}`);
                
                const roleResult = await this.updateUserRoles(member, userPunishment.points);
                logger.info(`🎭 ${roleResult}`);
                
                const warningResult = await this.sendWarningIfNeeded(guild, member, userPunishment.points);
                if (warningResult) {
                    logger.info(`📢 ${warningResult}`);
                }
                
                results.push({
                    user: member,
                    points: userPunishment.points,
                    matchedName: matchedName
                });
                
                logger.info(`✅ Pomyślnie zaktualizowano punkty dla ${member.displayName}`);
            }
            
            logger.info(`\n✅ Zakończono dodawanie punktów dla ${results.length} użytkowników`);
            return results;
        } catch (error) {
            logger.error('Błąd dodawania punktów');
            logger.error('❌ Błąd przetwarzania kar:', error);
            throw error;
        }
    }

    async updateUserRoles(member, points) {
        try {
            logger.info('Aktualizacja ról');
            logger.info(`👤 Użytkownik: ${member.displayName} (${member.id})`);
            logger.info(`📊 Punkty: ${points}`);
            
            const punishmentRole = member.guild.roles.cache.get(this.config.punishmentRoleId);
            const lotteryBanRole = member.guild.roles.cache.get(this.config.lotteryBanRoleId);
            
            if (!punishmentRole) {
                return '❌ Nie znaleziono roli karania';
            }
            
            if (!lotteryBanRole) {
                return '❌ Nie znaleziono roli zakazu loterii';
            }
            
            const hasPunishmentRole = member.roles.cache.has(this.config.punishmentRoleId);
            const hasLotteryBanRole = member.roles.cache.has(this.config.lotteryBanRoleId);
            
            let messages = [];
            
            // Logika dla 3+ punktów (zakaz loterii)
            if (points >= this.config.pointLimits.lotteryBan) {
                logger.info('🚫 Użytkownik ma 3+ punktów - stosowanie zakazu loterii');
                
                // Usuń rolę karania (2+ punktów) jeśli ma
                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Usunięto rolę karania`);
                    logger.info('➖ Usunięto rolę karania (2+ punktów)');
                }
                
                // Dodaj rolę zakazu loterii (3+ punktów) jeśli nie ma
                if (!hasLotteryBanRole) {
                    await member.roles.add(lotteryBanRole);
                    messages.push(`🚨 Nadano rolę zakazu loterii`);
                    logger.info('🚨 Nadano rolę zakazu loterii (3+ punktów)');
                } else {
                    logger.info('Użytkownik już ma rolę zakazu loterii');
                }
                
            // Logika dla 2 punktów (tylko rola karania)
            } else if (points >= this.config.pointLimits.punishmentRole) {
                logger.info('⚠️ Użytkownik ma 2 punkty - stosowanie roli karania');
                
                // Usuń rolę zakazu loterii jeśli ma
                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Usunięto rolę zakazu loterii`);
                    logger.info('➖ Usunięto rolę zakazu loterii');
                }
                
                // Dodaj rolę karania jeśli nie ma
                if (!hasPunishmentRole) {
                    await member.roles.add(punishmentRole);
                    messages.push(`🎭 Nadano rolę karania`);
                    logger.info('🎭 Nadano rolę karania (2+ punktów)');
                } else {
                    logger.info('Użytkownik już ma rolę karania');
                }
                
            // Logika dla 0-1 punktów (brak ról karnych)
            } else {
                logger.info('✅ Użytkownik ma mniej niż 2 punkty - usuwanie wszystkich ról karnych');
                
                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Usunięto rolę zakazu loterii`);
                    logger.info('➖ Usunięto rolę zakazu loterii');
                }
                
                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Usunięto rolę karania`);
                    logger.info('➖ Usunięto rolę karania');
                }
                
                if (!hasLotteryBanRole && !hasPunishmentRole) {
                    logger.info('Użytkownik nie ma ról karnych');
                }
            }
            
            const result = messages.length > 0 ? messages.join(', ') : 'Brak zmian w rolach';
            logger.info(`✅ Zakończono aktualizację ról: ${result}`);
            
            return `${member.displayName}: ${result}`;
        } catch (error) {
            logger.error(`❌ Błąd aktualizacji ról: ${error.message}`);
            return `❌ Błąd aktualizacji ról: ${error.message}`;
        }
    }

    async sendWarningIfNeeded(guild, member, points) {
        try {
            if (points !== 2 && points !== 3 && points !== 5) {
                return `Nie wysyłam ostrzeżenia dla ${points} punktów (tylko dla 2, 3 i 5)`;
            }
            
            const userRoleId = this.getUserRoleId(member);
            if (!userRoleId) {
                return '❌ Nie znaleziono roli użytkownika';
            }
            
            const warningChannelId = this.config.warningChannels[userRoleId];
            if (!warningChannelId) {
                return `❌ Brak kanału ostrzeżeń dla roli ${userRoleId}`;
            }
            
            const warningChannel = guild.channels.cache.get(warningChannelId);
            if (!warningChannel) {
                return `❌ Nie znaleziono kanału ostrzeżeń ${warningChannelId}`;
            }
            
            let message = '';
            if (points === 2) {
                message = `⚠️ **OSTRZEŻENIE** ⚠️\n\n${member} otrzymał rolę karną za zebrane punkty karne!\n\n**Aktualne punkty kary:** ${points}\n**Przyczyna:** Niewystarczająca ilość walk z bossem`;
            } else if (points === 3) {
                message = `🚨 **ZAKAZ LOTERII** 🚨\n\n${member} został wykluczony z loterii Glory!\n\n**Aktualne punkty kary:** ${points}\n**Przyczyna:** Przekroczenie limitu 3 punktów kary`;
            } else if (points === 5) {
                message = `🔴 **WYDALENIE Z KLANU** 🔴\n\n${member} osiągnął maksymalną ilość punktów karnych i zostaje wydalony z klanu!\n\n**Aktualne punkty kary:** ${points}\n**Przyczyna:** Osiągnięcie maksymalnego limitu punktów kary`;
            }
            
            if (message) {
                await warningChannel.send(message);
                return `✅ Pomyślnie wysłano ostrzeżenie dla ${points} punktów na kanał ${warningChannel.name} (${warningChannel.id})`;
            }
            
            return '❌ Brak wiadomości do wysłania';
        } catch (error) {
            return `❌ Błąd wysyłania ostrzeżenia: ${error.message}`;
        }
    }

    getUserRoleId(member) {
        for (const roleId of Object.values(this.config.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                return roleId;
            }
        }
        return null;
    }

    getUserWarningChannel(member) {
        for (const [roleId, channelId] of Object.entries(this.config.warningChannels)) {
            if (member.roles.cache.has(roleId)) {
                return channelId;
            }
        }
        return null;
    }

    async addPointsManually(guild, userId, points) {
        try {
            const member = await guild.members.fetch(userId);
            
            if (!member) {
                throw new Error('Nie znaleziono użytkownika');
            }
            
            const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, points, 'Ręczne dodanie punktów');
            
            await this.updateUserRoles(member, userPunishment.points);
            await this.sendWarningIfNeeded(guild, member, userPunishment.points);
            
            return userPunishment;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Błąd ręcznego dodawania punktów:', error);
            throw error;
        }
    }

    async removePointsManually(guild, userId, points) {
        try {
            const member = await guild.members.fetch(userId);
            
            if (!member) {
                throw new Error('Nie znaleziono użytkownika');
            }
            
            const userPunishment = await this.db.removePunishmentPoints(guild.id, userId, points);
            
            if (userPunishment) {
                await this.updateUserRoles(member, userPunishment.points);
            } else {
                await this.updateUserRoles(member, 0);
            }
            
            return userPunishment;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Błąd ręcznego usuwania punktów:', error);
            throw error;
        }
    }

    async getRankingForRole(guild, roleId) {
        try {
            const guildPunishments = await this.db.getGuildPunishments(guild.id);
            const ranking = [];
            
            for (const [userId, userData] of Object.entries(guildPunishments)) {
                if (userData.points > 0) {
                    try {
                        const member = await guild.members.fetch(userId);
                        
                        if (member && member.roles.cache.has(roleId)) {
                            ranking.push({
                                member: member,
                                points: userData.points,
                                history: userData.history
                            });
                        }
                    } catch (error) {
                        logger.info(`[PUNISHMENT] ⚠️ Nie można znaleźć użytkownika ${userId}`);
                    }
                }
            }
            
            ranking.sort((a, b) => b.points - a.points);
            
            return ranking;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Błąd pobierania rankingu:', error);
            throw error;
        }
    }

    async cleanupAllUsers(guild) {
        try {
            logger.info('Tygodniowe czyszczenie');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            
            const guildPunishments = await this.db.getGuildPunishments(guild.id);
            
            let usersProcessed = 0;
            let rolesUpdated = 0;
            
            for (const [userId, userData] of Object.entries(guildPunishments)) {
                try {
                    const member = await guild.members.fetch(userId);
                    
                    if (member) {
                        logger.info(`👤 Czyszczenie ról dla: ${member.displayName}`);
                        const result = await this.updateUserRoles(member, 0);
                        
                        if (!result.includes('Brak zmian')) {
                            rolesUpdated++;
                        }
                        
                        usersProcessed++;
                    }
                } catch (error) {
                    logger.info(`⚠️ Nie można zaktualizować ról dla użytkownika ${userId}: ${error.message}`);
                }
            }
            
            await this.db.cleanupWeeklyPoints();
            
            logger.info('Podsumowanie tygodniowego czyszczenia:');
            logger.info(`👥 Użytkowników przetworzonych: ${usersProcessed}`);
            logger.info(`🎭 Role zaktualizowane: ${rolesUpdated}`);
            logger.info('✅ Zakończono tygodniowe czyszczenie kar');
        } catch (error) {
            logger.error('Błąd czyszczenia');
            logger.error('❌ Błąd czyszczenia kar:', error);
        }
    }

    // ============ ZARZĄDZANIE SESJAMI ============

    /**
     * Tworzy nową sesję dla /punish
     */
    createSession(userId, guildId, channelId, ocrExpiresAt = null) {
        const sessionId = `punish_${userId}_${Date.now()}`;

        const session = {
            sessionId,
            userId,
            guildId,
            channelId,
            stage: 'awaiting_images', // 'awaiting_images' | 'confirming_complete'
            downloadedFiles: [], // ścieżki do pobranych plików
            processedImages: [], // wyniki OCR
            uniqueNicks: new Set(), // unikalne nicki znalezione
            createdAt: Date.now(),
            timeout: null,
            publicInteraction: null,
            ocrExpiresAt // timestamp wygaśnięcia sesji OCR (z kolejki OCR)
        };

        this.activeSessions.set(sessionId, session);

        // Auto-cleanup po 15 minutach
        session.timeout = setTimeout(() => {
            this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);

        logger.info(`[PUNISH] 📝 Utworzono sesję: ${sessionId}`);
        return sessionId;
    }

    /**
     * Pobiera sesję po ID
     */
    getSession(sessionId) {
        return this.activeSessions.get(sessionId);
    }

    /**
     * Pobiera sesję użytkownika po userId
     */
    getSessionByUserId(userId) {
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (session.userId === userId) {
                return session;
            }
        }
        return null;
    }

    /**
     * Odnawia timeout sesji
     */
    refreshSessionTimeout(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        if (session.timeout) {
            clearTimeout(session.timeout);
        }

        session.timeout = setTimeout(() => {
            this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);
    }

    /**
     * Usuwa sesję i pliki tymczasowe
     */
    async cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        logger.info(`[PUNISH] 🧹 Rozpoczynam czyszczenie sesji: ${sessionId}`);

        if (session.timeout) {
            clearTimeout(session.timeout);
            session.timeout = null;
        }

        // Zatrzymaj timer migania jeśli istnieje
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info('[PUNISH] ⏹️ Zatrzymano timer migania podczas czyszczenia sesji');
        }

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

        // KRYTYCZNE: Zakończ sesję OCR w kolejce (zapobiega deadlockowi)
        if (this.ocrService && session.guildId && session.userId) {
            await this.ocrService.endOCRSession(session.guildId, session.userId, true);
            logger.info(`[PUNISH] 🔓 Zwolniono kolejkę OCR dla użytkownika ${session.userId}`);
        }

        this.activeSessions.delete(sessionId);
        logger.info(`[PUNISH] ✅ Sesja usunięta: ${sessionId}`);
    }

    /**
     * Usuwa pliki sesji z temp
     */
    async cleanupSessionFiles(sessionId) {
        try {
            const files = await fs.readdir(this.tempDir);
            const sessionFiles = files.filter(f => f.startsWith(sessionId));

            for (const file of sessionFiles) {
                const filepath = path.join(this.tempDir, file);
                await fs.unlink(filepath);
                logger.info(`[PUNISH] 🗑️ Usunięto plik: ${file}`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('[PUNISH] ❌ Błąd czyszczenia plików sesji:', error);
            }
        }
    }

    /**
     * Tworzy embed z prośbą o zdjęcia
     */
    createAwaitingImagesEmbed() {
        const embed = new EmbedBuilder()
            .setTitle('📸 Wyślij zdjęcia do analizy')
            .setDescription(
                '**Instrukcja:**\n' +
                '1. Wyślij zdjęcia jako załączniki na tym kanale (możesz wysłać wiele zdjęć jednocześnie)\n' +
                '2. Bot automatycznie je przeanalizuje\n' +
                '3. Po przeanalizowaniu wszystkich zdjęć potwierdź dodanie punktów karnych\n\n' +
                '**Uwaga:** Wiadomość ze zdjęciami zostanie automatycznie usunięta po przetworzeniu.'
            )
            .setColor('#FFA500')
            .setTimestamp()
            .setFooter({ text: 'Sesja wygaśnie po 15 minutach nieaktywności' });

        const cancelButton = new ButtonBuilder()
            .setCustomId('punish_cancel_session')
            .setLabel('❌ Anuluj')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder()
            .addComponents(cancelButton);

        return { embed, row };
    }

    /**
     * Tworzy embed z końcowym potwierdzeniem i listą graczy
     */
    createFinalConfirmationEmbed(session) {
        const foundUsers = [];
        for (const imageResult of session.processedImages) {
            for (const player of imageResult.result.players) {
                foundUsers.push(player);
            }
        }

        const uniqueNicks = Array.from(session.uniqueNicks);

        let description = `**Przeanalizowano:** ${session.processedImages.length} ${session.processedImages.length === 1 ? 'zdjęcie' : 'zdjęć'}\n`;
        description += `**Znaleziono:** ${uniqueNicks.length} ${uniqueNicks.length === 1 ? 'unikalny nick' : 'unikalnych nicków'} z wynikiem 0\n\n`;

        if (uniqueNicks.length > 0) {
            description += `**📋 Lista graczy do ukarania:**\n`;
            // Pokaż maksymalnie 20 nicków w embedzie (limit Discord)
            const displayNicks = uniqueNicks.slice(0, 20);
            description += displayNicks.map(nick => `• ${nick}`).join('\n');

            if (uniqueNicks.length > 20) {
                description += `\n... i ${uniqueNicks.length - 20} więcej`;
            }
        } else {
            description += `❌ Nie znaleziono żadnych graczy z wynikiem 0`;
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Analiza zakończona')
            .setDescription(description)
            .setColor('#FFA500')
            .setTimestamp();

        // Dodaj zdjęcia jako załączniki do embeda
        const files = [];
        for (let i = 0; i < session.processedImages.length; i++) {
            const imagePath = session.processedImages[i].filepath;
            try {
                const attachment = new AttachmentBuilder(imagePath, {
                    name: `screenshot_${i + 1}.png`
                });
                files.push(attachment);
            } catch (error) {
                logger.error(`[PUNISH] ❌ Błąd dodawania załącznika ${imagePath}:`, error);
            }
        }

        // Dodaj obrazy do embeda (tylko jeśli są jakieś zdjęcia)
        if (files.length > 0) {
            embed.setImage(`attachment://screenshot_1.png`);
        }

        let row;
        if (uniqueNicks.length === 0) {
            // Brak graczy z zerem - tylko przycisk Zakończ
            const endButton = new ButtonBuilder()
                .setCustomId('punish_cancel_session')
                .setLabel('✅ Zakończ')
                .setStyle(ButtonStyle.Danger);

            row = new ActionRowBuilder()
                .addComponents(endButton);
        } else {
            // Są gracze z zerem - standardowe przyciski
            const confirmButton = new ButtonBuilder()
                .setCustomId('punish_complete_yes')
                .setLabel('✅ Dodaj punkty karne')
                .setStyle(ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
                .setCustomId('punish_cancel_session')
                .setLabel('❌ Anuluj')
                .setStyle(ButtonStyle.Danger);

            row = new ActionRowBuilder()
                .addComponents(confirmButton, cancelButton);
        }

        return { embed, row, files };
    }

    /**
     * Tworzy embed z potwierdzeniem przetworzonych zdjęć (stara metoda - nie używana już dla /punish)
     */
    createProcessedImagesEmbed(processedCount, totalImages) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Zdjęcia przetworzone')
            .setDescription(
                `Przeanalizowano **${processedCount}** ${processedCount === 1 ? 'zdjęcie' : 'zdjęcia'}.\n\n` +
                `Czy chcesz dodać więcej zdjęć, czy przejść do potwierdzenia?`
            )
            .setColor('#00FF00')
            .setTimestamp();

        const addMoreButton = new ButtonBuilder()
            .setCustomId('punish_add_more')
            .setLabel('➕ Dodaj więcej zdjęć')
            .setStyle(ButtonStyle.Primary);

        const confirmButton = new ButtonBuilder()
            .setCustomId('punish_complete_yes')
            .setLabel('✅ Przejdź do potwierdzenia')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('punish_cancel_session')
            .setLabel('❌ Anuluj')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder()
            .addComponents(addMoreButton, confirmButton, cancelButton);

        return { embed, row };
    }

    // ============ POBIERANIE I PRZETWARZANIE ZDJĘĆ ============

    /**
     * Upewnia się że katalog temp istnieje
     */
    async initTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error('[PUNISH] ❌ Błąd tworzenia katalogu temp:', error);
        }
    }

    /**
     * Pobiera zdjęcie z URL i zapisuje lokalnie
     */
    async downloadImage(url, sessionId, index) {
        await this.initTempDir();
        const filename = `${sessionId}_${index}_${Date.now()}.png`;
        const filepath = path.join(this.tempDir, filename);
        await downloadDiscordImage(url, filepath);
        logger.info(`[PUNISH] 💾 Zapisano zdjęcie: ${filename}`);
        return filepath;
    }

    /**
     * Przetwarza zdjęcia z dysku dla /punish - dyspozytor.
     * AI OCR włączony → analiza batch wszystkich zdjęć naraz (jak faza1/faza2);
     * wyłączony → fallback na klasyczne przetwarzanie zdjęcie-po-zdjęciu.
     */
    async processImagesFromDisk(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        const aiOcrService = ocrService && ocrService.aiOcrService;
        if (aiOcrService && aiOcrService.enabled) {
            return this.processImagesBatch(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService);
        }

        logger.info('[PUNISH] ℹ️ AI OCR wyłączony - klasyczne przetwarzanie zdjęcie-po-zdjęciu');
        return this.processImagesPerImage(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService);
    }

    /**
     * Klasyczne przetwarzanie zdjęcie-po-zdjęciu (Tesseract) - fallback gdy AI OCR wyłączony.
     */
    async processImagesPerImage(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        session.publicInteraction = publicInteraction;

        // Inicjalizuj stan migania
        session.blinkState = false;
        session.isUpdatingProgress = false; // Flaga zapobiegająca nakładaniu się wywołań

        // Uruchom timer migania (co 1 sekundę)
        session.blinkTimer = setInterval(async () => {
            // Pomiń jeśli poprzednie wywołanie się jeszcze nie zakończyło
            if (session.isUpdatingProgress) {
                return;
            }

            session.blinkState = !session.blinkState;

            // Aktualizuj embed jeśli jest w trakcie przetwarzania
            if (session.publicInteraction && session.currentProcessingData) {
                try {
                    session.isUpdatingProgress = true;
                    const { imageIndex, totalImages } = session.currentProcessingData;
                    const progressBar = this.createProgressBar(imageIndex, totalImages, 'processing', session.blinkState);

                    const processingEmbed = new EmbedBuilder()
                        .setTitle('⏳ Przetwarzanie zdjęć...')
                        .setDescription(
                            `${progressBar}\n\n` +
                            `📸 Przetwarzanie **${imageIndex}** z **${totalImages}**`
                        )
                        .setColor('#FFA500')
                        .setTimestamp();

                    // Dodaj wyniki z poprzednich przetworzonych zdjęć
                    const previousResultsText = session.processedImages.map((img, idx) => {
                        const playersText = `${img.result.foundPlayers} ${img.result.foundPlayers === 1 ? 'gracz' : 'graczy'}`;
                        const uniquesText = `${img.result.newUniques} ${img.result.newUniques === 1 ? 'nowy unikalny' : 'nowych unikalnych'}`;
                        return `📸 Zdjęcie ${idx + 1}: ${playersText} (${uniquesText})`;
                    }).join('\n');

                    processingEmbed.addFields(
                        { name: '✅ Przetworzone zdjęcia', value: previousResultsText || 'Brak', inline: false },
                        { name: '👥 Suma unikalnych graczy', value: `${session.uniqueNicks.size}`, inline: true }
                    );

                    await session.publicInteraction.editReply({
                        embeds: [processingEmbed],
                        components: []
                    });
                } catch (error) {
                    logger.error('[PUNISH] ❌ Błąd aktualizacji migania:', error.message);
                } finally {
                    session.isUpdatingProgress = false;
                }
            }
        }, 1000);

        logger.info(`[PUNISH] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        // Odśwież cache członków przed przetwarzaniem
        await safeFetchMembers(guild, logger);

        const results = [];

        // Progress bar - aktualizacja na żywo
        const totalImages = downloadedFiles.length;

        for (let i = 0; i < downloadedFiles.length; i++) {
            const file = downloadedFiles[i];
            const imageIndex = i + 1;

            try {
                // Zapisz aktualnie przetwarzane dane (dla migania)
                session.currentProcessingData = { imageIndex, totalImages };

                // Zaktualizuj progress bar przed przetworzeniem zdjęcia
                const progressBar = this.createProgressBar(imageIndex, totalImages, 'processing', session.blinkState);
                const processingEmbed = new EmbedBuilder()
                    .setTitle('⏳ Przetwarzanie zdjęć...')
                    .setDescription(
                        `${progressBar}\n\n` +
                        `📸 Przetwarzanie **${imageIndex}** z **${totalImages}**`
                    )
                    .setColor('#FFA500')
                    .setTimestamp();

                // Dodaj wyniki z poprzednich przetworzonych zdjęć
                const previousResultsText = session.processedImages.map((img, idx) => {
                    const playersText = `${img.result.foundPlayers} ${img.result.foundPlayers === 1 ? 'gracz' : 'graczy'}`;
                    const uniquesText = `${img.result.newUniques} ${img.result.newUniques === 1 ? 'nowy unikalny' : 'nowych unikalnych'}`;
                    return `📸 Zdjęcie ${idx + 1}: ${playersText} (${uniquesText})`;
                }).join('\n');

                processingEmbed.addFields(
                    { name: '✅ Przetworzone zdjęcia', value: previousResultsText || 'Brak', inline: false },
                    { name: '👥 Suma unikalnych graczy', value: `${session.uniqueNicks.size}`, inline: true }
                );

                if (session.publicInteraction) {
                    try {
                        await session.publicInteraction.editReply({
                            embeds: [processingEmbed],
                            components: []
                        });
                    } catch (error) {
                        logger.error('[PUNISH] ❌ Błąd aktualizacji embeda przed przetworzeniem:', error);
                    }
                }

                // Przetwórz zdjęcie przez OCR
                const text = await ocrService.processImageFromFile(file.filepath);

                // Wyodrębnij graczy z wynikiem 0
                const foundPlayers = await ocrService.extractPlayersFromText(text, guild, member);

                // Zapisz aktualny rozmiar przed dodaniem nowych nicków
                const uniqueBeforeThisImage = session.uniqueNicks.size;

                // Dodaj unikalne nicki do sesji (automatyczne usuwanie duplikatów)
                for (const player of foundPlayers) {
                    session.uniqueNicks.add(player.detectedNick);
                }

                // Oblicz ile nowych unikalnych nicków dodano z tego zdjęcia
                const newUniquesFromThisImage = session.uniqueNicks.size - uniqueBeforeThisImage;

                results.push({
                    imageIndex,
                    foundPlayers: foundPlayers.length,
                    newUniques: newUniquesFromThisImage,
                    players: foundPlayers
                });

                session.processedImages.push({
                    filepath: file.filepath,
                    result: {
                        imageIndex,
                        foundPlayers: foundPlayers.length,
                        newUniques: newUniquesFromThisImage,
                        players: foundPlayers
                    }
                });

                logger.info(`[PUNISH] ✅ Zdjęcie ${imageIndex}/${totalImages} przetworzone: ${foundPlayers.length} graczy znalezionych (${newUniquesFromThisImage} nowych unikalnych)`);

                // Zaktualizuj progress bar PO przetworzeniu zdjęcia (pomarańczowe → zielone)
                const completedBar = this.createProgressBar(imageIndex, totalImages, 'completed', session.blinkState);
                const completedEmbed = new EmbedBuilder()
                    .setTitle('⏳ Przetwarzanie zdjęć...')
                    .setDescription(
                        `${completedBar}\n\n` +
                        `📸 Przetwarzanie **${imageIndex}** z **${totalImages}**`
                    )
                    .setColor('#FFA500')
                    .setTimestamp();

                // Dodaj wyniki z przetworzonych zdjęć
                const resultsText = session.processedImages.map((img, idx) => {
                    const playersText = `${img.result.foundPlayers} ${img.result.foundPlayers === 1 ? 'gracz' : 'graczy'}`;
                    const uniquesText = `${img.result.newUniques} ${img.result.newUniques === 1 ? 'nowy unikalny' : 'nowych unikalnych'}`;
                    return `📸 Zdjęcie ${idx + 1}: ${playersText} (${uniquesText})`;
                }).join('\n');

                completedEmbed.addFields(
                    { name: '✅ Przetworzone zdjęcia', value: resultsText || 'Brak', inline: false },
                    { name: '👥 Suma unikalnych graczy', value: `${session.uniqueNicks.size}`, inline: true }
                );

                if (session.publicInteraction) {
                    try {
                        await session.publicInteraction.editReply({
                            embeds: [completedEmbed],
                            components: []
                        });
                    } catch (error) {
                        logger.error('[PUNISH] ❌ Błąd aktualizacji embeda po przetworzeniu:', error);
                    }
                }

                // Małe opóźnienie między zdjęciami (żeby widać było progress)
                if (i < totalImages - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (error) {
                logger.error(`[PUNISH] ❌ Błąd przetwarzania zdjęcia ${imageIndex}:`, error);
                results.push({
                    imageIndex,
                    error: error.message
                });

                session.processedImages.push({
                    filepath: file.filepath,
                    result: {
                        imageIndex,
                        foundPlayers: 0,
                        players: [],
                        error: error.message
                    }
                });
            }
        }

        logger.info(`[PUNISH] ✅ Zakończono przetwarzanie ${totalImages} zdjęć, znaleziono ${session.uniqueNicks.size} unikalnych nicków`);

        // Zatrzymaj timer migania
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info('[PUNISH] ⏹️ Zatrzymano timer migania');
        }

        // Poczekaj na zakończenie ostatniego wywołania updateProgress (race condition fix)
        let waitCount = 0;
        while (session.isUpdatingProgress && waitCount < 50) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms
            waitCount++;
        }
        if (waitCount > 0) {
            logger.info(`[PUNISH] ✅ Zakończono oczekiwanie na ostatnią aktualizację progress (${waitCount * 100}ms)`);
        }

        // Wyczyść aktualnie przetwarzane dane
        session.currentProcessingData = null;

        return results;
    }

    /**
     * Analiza zbiorcza (batch) dla /punish: wszystkie zdjęcia tej partii wysyłane są do AI
     * w jednym zapytaniu razem z listą nicków roli klanowej. AI deduplikuje i dopasowuje
     * nicki, zwracając wyniki graczy; wybieramy graczy z wynikiem 0 (do kar).
     * Dopasowanie nicków AI → klanowych przez przydział 1:1 (`assignNicksToClan`).
     */
    async processImagesBatch(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        session.publicInteraction = publicInteraction;
        session.isProcessing = true;
        session.blinkState = false;
        session.isUpdatingProgress = false;

        const totalImages = downloadedFiles.length;
        session.batchSteps = [
            { key: 'downloading', icon: '📥', label: 'Pobieranie zdjęć' },
            { key: 'sending',     icon: '🤖', label: 'Wysyłanie do AI' },
            { key: 'processing',  icon: '⚙️', label: 'Przetwarzanie przez AI' },
            { key: 'analyzing',   icon: '📊', label: 'Analiza wyników (gracze z zerem)' }
        ];
        session.batchTotalImages = totalImages;
        session.currentStepKey = 'downloading';

        session.blinkTimer = setInterval(async () => {
            if (session.isUpdatingProgress) return;
            session.blinkState = !session.blinkState;
            if (session.publicInteraction && session.currentStepKey && session.currentStepKey !== 'done') {
                try {
                    session.isUpdatingProgress = true;
                    await this.updateBatchProgress(session);
                } catch (e) {
                    logger.error('[PUNISH] ❌ Błąd aktualizacji migania (batch):', e.message);
                } finally {
                    session.isUpdatingProgress = false;
                }
            }
        }, 1000);

        const stopBlinkTimer = async () => {
            if (session.blinkTimer) { clearInterval(session.blinkTimer); session.blinkTimer = null; }
            let w = 0;
            while (session.isUpdatingProgress && w < 50) { await new Promise(r => setTimeout(r, 100)); w++; }
        };

        logger.info(`[PUNISH] 🔄 Analiza batch ${totalImages} zdjęć dla sesji ${sessionId}`);

        try {
            const aiOcrService = ocrService.aiOcrService;
            await safeFetchMembers(guild, logger);

            session.currentStepKey = 'downloading';
            await this.updateBatchProgress(session);
            await new Promise(r => setTimeout(r, 400));

            const roleNicks = await ocrService.getRoleNicks(guild, member); // [{userId, member, displayName}]
            const clanNicks = roleNicks.map(r => r.displayName);
            const nickToMember = new Map();
            for (const rn of roleNicks) {
                if (!nickToMember.has(rn.displayName)) nickToMember.set(rn.displayName, rn);
            }
            logger.info(`[PUNISH] 👥 Nicki klanu do promptu AI: ${clanNicks.length}`);

            session.currentStepKey = 'sending';
            await this.updateBatchProgress(session);
            await new Promise(r => setTimeout(r, 400));

            session.currentStepKey = 'processing';
            const filepaths = downloadedFiles.map(f => f.filepath);
            const aiResult = await aiOcrService.analyzeResultsImagesBatch(filepaths, clanNicks);

            if (!session.cancelled) {
                session.currentStepKey = 'analyzing';
                await this.updateBatchProgress(session);

                const rawPlayers = (aiResult && aiResult.isValid && Array.isArray(aiResult.players)) ? aiResult.players : [];
                const assigned = assignNicksToClan(rawPlayers, clanNicks, logger);
                const zeroPlayers = assigned.filter(p => Number(p.score) === 0);

                const players = [];
                const uniqueBefore = session.uniqueNicks.size;
                for (const zp of zeroPlayers) {
                    const roleNick = nickToMember.get(zp.playerName);
                    if (!roleNick || !roleNick.member) {
                        logger.warn(`[PUNISH] ⚠️ Brak membera dla "${zp.playerName}" - pomijam`);
                        continue;
                    }
                    players.push({
                        detectedNick: roleNick.displayName,
                        user: roleNick,
                        confirmed: true,
                        line: '',
                        endValue: '0',
                        uncertain: false
                    });
                    session.uniqueNicks.add(roleNick.displayName);
                }
                const newUniques = session.uniqueNicks.size - uniqueBefore;

                downloadedFiles.forEach((file, idx) => {
                    session.processedImages.push({
                        filepath: file.filepath,
                        result: {
                            imageIndex: session.processedImages.length + 1,
                            foundPlayers: idx === 0 ? players.length : 0,
                            newUniques: idx === 0 ? newUniques : 0,
                            players: idx === 0 ? players : []
                        }
                    });
                });

                logger.info(`[PUNISH] ✅ Batch: ${players.length} graczy z zerem (unikalnych łącznie: ${session.uniqueNicks.size})`);
                session.currentStepKey = 'done';
                await this.updateBatchProgress(session);
            } else {
                logger.warn('[PUNISH] ⚠️ Sesja anulowana podczas analizy batch - pomijam wynik');
            }
        } catch (error) {
            logger.error('[PUNISH] ❌ Błąd analizy batch:', error);
            downloadedFiles.forEach(file => {
                session.processedImages.push({
                    filepath: file.filepath,
                    result: { imageIndex: session.processedImages.length + 1, foundPlayers: 0, newUniques: 0, players: [], error: error.message }
                });
            });
        } finally {
            await stopBlinkTimer();
            session.currentProcessingData = null;
            session.isProcessing = false;
        }

        if (session.cancelled) {
            logger.info('[PUNISH] 🧹 Sesja anulowana - czyszczę po zakończeniu przetwarzania');
            const ci = session.publicInteraction;
            if (ci) {
                try {
                    const e = new EmbedBuilder()
                        .setTitle('❌ Sesja anulowana')
                        .setDescription('Sesja /punish została anulowana. Wszystkie pliki zostały usunięte.')
                        .setColor('#FF0000')
                        .setTimestamp();
                    if (ci.editReply) await ci.editReply({ embeds: [e], components: [] });
                    else await ci.edit({ embeds: [e], components: [] });
                } catch (err) {
                    logger.warn(`[PUNISH] ⚠️ Nie udało się zaktualizować embeda po anulowaniu: ${err.message}`);
                }
            }
            await this.cleanupSession(sessionId);
        }

        return session.processedImages;
    }

    /**
     * Pasek postępu batch (stepper) dla /punish - pokazuje etapy procesu.
     */
    async updateBatchProgress(session) {
        if (!session.publicInteraction) return;
        try {
            const steps = session.batchSteps || [];
            const order = steps.map(s => s.key);
            const isDone = session.currentStepKey === 'done';
            const currentIdx = isDone ? steps.length : order.indexOf(session.currentStepKey);

            const stepLines = steps.map((s, i) => {
                let marker;
                if (isDone || i < currentIdx) marker = '✅';
                else if (i === currentIdx) marker = session.blinkState ? '🟧' : '⬜';
                else marker = '⬜';
                let suffix = '';
                if (s.key === 'downloading') suffix = ` (${session.batchTotalImages} szt.)`;
                else if (i === currentIdx && !isDone) suffix = '...';
                return `${marker} ${s.icon} ${s.label}${suffix}`;
            }).join('\n');

            const imgWord = session.batchTotalImages === 1 ? 'zdjęcie' : 'zdjęć';
            const embed = new EmbedBuilder()
                .setTitle(isDone ? '✅ Analiza zakończona' : '⏳ Przetwarzanie zdjęć...')
                .setDescription(`${stepLines}\n\n🤖 Analiza AI: **${session.batchTotalImages}** ${imgWord} w jednym zapytaniu`)
                .setColor(isDone ? '#00FF00' : '#FFA500')
                .addFields({ name: '👥 Suma graczy z zerem', value: `${session.uniqueNicks.size}`, inline: true })
                .setTimestamp();

            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('punish_cancel_session').setLabel('❌ Anuluj').setStyle(ButtonStyle.Danger)
            );

            try {
                if (session.publicInteraction.editReply) {
                    await session.publicInteraction.editReply({ embeds: [embed], components: [cancelRow] });
                } else {
                    await session.publicInteraction.edit({ embeds: [embed], components: [cancelRow] });
                }
            } catch (e) {
                if (e.code === 10008 || e.message?.includes('Unknown Message')) {
                    logger.warn('[PUNISH] ⚠️ Wiadomość postępu usunięta - kontynuuję bez aktualizacji');
                } else if (e.code === 10015 || e.message?.includes('Unknown Webhook') || e.message?.includes('Invalid Webhook Token')) {
                    logger.warn('[PUNISH] ⏰ Interakcja wygasła podczas batch');
                } else {
                    throw e;
                }
            }
        } catch (error) {
            logger.error('[PUNISH] ❌ Błąd aktualizacji postępu (batch):', error.message);
        }
    }

    /**
     * Tworzy progress bar dla przetwarzania zdjęć (stałe 10 kratek + procent)
     * @param {number} current - Numer aktualnego zdjęcia
     * @param {number} total - Całkowita liczba zdjęć
     * @param {string} stage - 'processing' (pomarańczowe dla aktualnego) lub 'completed' (zielone dla aktualnego)
     * @param {boolean} blinkState - Stan migania (true/false)
     */
    createProgressBar(current, total, stage = 'processing', blinkState = false) {
        // Oblicz procenty: dla 'processing' używamy (current-1), dla 'completed' używamy current
        const percentage = stage === 'completed'
            ? Math.floor((current / total) * 100)
            : Math.floor(((current - 1) / total) * 100);
        const totalBars = 10;

        let bar = '';

        if (current === 0) {
            // Początek - wszystkie białe kratki
            bar = '⬜'.repeat(totalBars);
        } else {
            // Oblicz ile kratek reprezentuje ukończone zdjęcia
            const greenBars = Math.floor(((current - 1) / total) * totalBars);
            // Oblicz ile kratek reprezentuje aktualnie przetwarzane zdjęcie
            const completedBars = Math.ceil((current / total) * totalBars);
            const orangeBars = completedBars - greenBars;
            const whiteBars = totalBars - completedBars;

            if (stage === 'completed') {
                // Po przetworzeniu - wszystkie kratki (zielone + pomarańczowe) stają się zielone
                // Zapewnia że: jeśli migały X kratek → X kratek staje się zielonych
                bar = '🟩'.repeat(greenBars + orangeBars) + '⬜'.repeat(whiteBars);
            } else {
                // Podczas przetwarzania
                // Zielone kratki = postęp ukończonych zdjęć (current - 1)
                // Pomarańczowe/białe kratki = postęp obecnego zdjęcia (migają co sekundę)
                const currentBar = blinkState ? '🟧' : '⬜';
                bar = '🟩'.repeat(greenBars) + currentBar.repeat(orangeBars) + '⬜'.repeat(whiteBars);
            }
        }

        return `${bar} ${percentage}%`;
    }
}

module.exports = PunishmentService;