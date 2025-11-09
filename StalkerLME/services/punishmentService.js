const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
class PunishmentService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
        this.activeSessions = new Map(); // sessionId → session
        this.tempDir = './StalkerLME/temp';
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
    createSession(userId, guildId, channelId) {
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
            publicInteraction: null
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

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

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

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                const fileStream = require('fs').createWriteStream(filepath);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    logger.info(`[PUNISH] 💾 Zapisano zdjęcie: ${filename}`);
                    resolve(filepath);
                });

                fileStream.on('error', (err) => {
                    reject(err);
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Przetwarza zdjęcia z dysku dla /punish
     */
    async processImagesFromDisk(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        session.publicInteraction = publicInteraction;

        logger.info(`[PUNISH] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        // Odśwież cache członków przed przetwarzaniem
        logger.info('[PUNISH] 🔄 Odświeżanie cache członków...');
        await guild.members.fetch();
        logger.info('[PUNISH] ✅ Cache członków odświeżony');

        const results = [];

        // Progress bar - aktualizacja na żywo
        const totalImages = downloadedFiles.length;

        for (let i = 0; i < downloadedFiles.length; i++) {
            const file = downloadedFiles[i];
            const imageIndex = i + 1;

            try {
                // Zaktualizuj progress bar przed przetworzeniem zdjęcia
                const progressBar = this.createProgressBar(imageIndex, totalImages);
                const processingEmbed = new EmbedBuilder()
                    .setTitle('⏳ Przetwarzanie zdjęć...')
                    .setDescription(
                        `${progressBar}\n\n` +
                        `📸 Przetwarzanie **${imageIndex}** z **${totalImages}**`
                    )
                    .setColor('#FFA500')
                    .setTimestamp();

                // Dodaj wyniki z poprzednich przetworzonych zdjęć
                const resultsText = session.processedImages.map((img, idx) => {
                    const playersText = `${img.result.foundPlayers} ${img.result.foundPlayers === 1 ? 'gracz' : 'graczy'}`;
                    const uniquesText = `${img.result.newUniques} ${img.result.newUniques === 1 ? 'nowy unikalny' : 'nowych unikalnych'}`;
                    return `📸 Zdjęcie ${idx + 1}: ${playersText} (${uniquesText})`;
                }).join('\n');

                processingEmbed.addFields(
                    { name: '✅ Przetworzone zdjęcia', value: resultsText || 'Brak', inline: false },
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

        return results;
    }

    /**
     * Tworzy progress bar dla przetwarzania zdjęć (stałe 10 kratek + procent)
     */
    createProgressBar(current, total) {
        const percentage = Math.floor((current / total) * 100);
        const totalBars = 10;

        let bar = '';

        if (current === 0) {
            // Początek - wszystkie białe kratki
            bar = '⬜'.repeat(totalBars);
        } else if (current === total) {
            // Wszystko ukończone - 10 zielonych kratek
            bar = '🟩'.repeat(totalBars);
        } else {
            // W trakcie przetwarzania
            // Zielone kratki = postęp ukończonych zdjęć (current - 1)
            // Żółte kratki = postęp obecnego zdjęcia (od ukończonych do current)
            const completedBars = Math.ceil((current / total) * totalBars);
            const greenBars = Math.floor(((current - 1) / total) * totalBars);
            const yellowBars = completedBars - greenBars;
            const whiteBars = totalBars - completedBars;

            bar = '🟩'.repeat(greenBars) + '🟨'.repeat(yellowBars) + '⬜'.repeat(whiteBars);
        }

        return `${bar} ${percentage}%`;
    }
}

module.exports = PunishmentService;