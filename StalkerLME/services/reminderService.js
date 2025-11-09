const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const messages = require('../config/messages');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
class ReminderService {
    constructor(config) {
        this.config = config;
        this.activeSessions = new Map(); // sessionId → session
        this.tempDir = './StalkerLME/temp';
    }

    async sendReminders(guild, foundUsers) {
        try {

            const timeUntilDeadline = this.calculateTimeUntilDeadline();
            const roleGroups = new Map();
            let sentMessages = 0;

            // Grupuj użytkowników według ról
            for (const userData of foundUsers) {
                // POPRAWKA: userData.user zawiera {userId, member, displayName}
                const member = userData.user.member;

                if (!member) {
                    logger.warn(`⚠️ Brak member dla użytkownika: ${userData.detectedNick}`);
                    continue;
                }

                for (const [roleKey, roleId] of Object.entries(this.config.targetRoles)) {
                    if (member.roles.cache.has(roleId)) {
                        if (!roleGroups.has(roleKey)) {
                            roleGroups.set(roleKey, []);
                        }
                        roleGroups.get(roleKey).push(member);
                        break;
                    }
                }
            }

            // Wyślij przypomnienia dla każdej grupy ról
            for (const [roleKey, members] of roleGroups) {
                const roleId = this.config.targetRoles[roleKey];
                const warningChannelId = this.config.warningChannels[roleId];

                if (warningChannelId) {
                    const warningChannel = guild.channels.cache.get(warningChannelId);

                    if (warningChannel) {
                        const userMentions = members.map(member => member.toString()).join(' ');
                        const timeMessage = messages.formatTimeMessage(timeUntilDeadline);
                        const reminderMessage = messages.reminderMessage(timeMessage, userMentions);

                        await warningChannel.send(reminderMessage);
                        sentMessages++;

                        logger.info(`✅ Wysłano przypomnienie do kanału ${warningChannel.name} dla ${members.length} użytkowników`);
                    }
                }
            }

            logger.info(`✅ Wysłano ${sentMessages} przypomnień dla ${foundUsers.length} użytkowników`);

            return {
                sentMessages: sentMessages,
                roleGroups: roleGroups.size,
                totalUsers: foundUsers.length
            };
        } catch (error) {
            logger.error('Błąd przypomnień');
            logger.error('❌ Błąd wysyłania przypomnień:', error.message);
            logger.error('❌ Stack trace:', error.stack);
            throw error;
        }
    }

    calculateTimeUntilDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }
        
        const timeDiff = deadline - polandTime;
        const totalMinutes = Math.floor(timeDiff / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        return {
            totalMinutes: totalMinutes,
            hours: hours,
            minutes: minutes
        };
    }

    async sendRoleReminders(guild, roleId) {
        try {
            logger.info('Przypomnienia dla roli');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`🎭 Rola: ${roleId}`);
            
            const role = guild.roles.cache.get(roleId);
            
            if (!role) {
                throw new Error('Nie znaleziono roli');
            }
            
            const members = role.members;
            const remindersSent = [];
            
            for (const [userId, member] of members) {
                try {
                    const timeLeft = this.calculateTimeUntilDeadline();
                    const timeMessage = messages.formatTimeMessage(timeLeft);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('⏰ PRZYPOMNIENIE O BOSSIE')
                        .setDescription(`${timeMessage}\n\nPamiętaj o pokonaniu bossa, aby uniknąć punktów karnych!`)
                        .setColor('#FFA500')
                        .setTimestamp()
                        .setFooter({ text: 'System automatycznych przypomnień' });
                    
                    await member.send({ embeds: [embed] });
                    remindersSent.push(member);
                    
                    logger.info(`✅ Wysłano przypomnienie do ${member.displayName} (${member.id})`);
                } catch (error) {
                    logger.info(`⚠️ Nie udało się wysłać przypomnienia do ${member.displayName}: ${error.message}`);
                }
            }
            
            logger.info('Podsumowanie przypomnień roli:');
            logger.info(`📤 Wysłanych przypomnień: ${remindersSent.length}`);
            logger.info(`👥 Członków roli: ${members.size}`);
            logger.info('✅ Przypomnienia dla roli zostały zakończone');
            
            return remindersSent;
        } catch (error) {
            logger.error('Błąd przypomnień roli');
            logger.error('❌ Błąd wysyłania przypomnień do roli:', error);
            throw error;
        }
    }

    async sendBulkReminder(guild, roleId, customMessage = null) {
        try {
            logger.info('Masowe przypomnienie');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`🎭 Rola: ${roleId}`);
            
            const role = guild.roles.cache.get(roleId);
            
            if (!role) {
                throw new Error('Nie znaleziono roli');
            }
            
            const timeLeft = this.calculateTimeUntilDeadline();
            const timeMessage = messages.formatTimeMessage(timeLeft);
            
            const embed = new EmbedBuilder()
                .setTitle('⏰ PRZYPOMNIENIE O BOSSIE')
                .setDescription(customMessage || `${timeMessage}\n\nPamiętaj o pokonaniu bossa, aby uniknąć punktów karnych!`)
                .setColor('#FFA500')
                .setTimestamp()
                .setFooter({ text: 'System automatycznych przypomnień' });
            
            const warningChannelId = this.config.warningChannels[roleId];
            
            if (warningChannelId) {
                const warningChannel = guild.channels.cache.get(warningChannelId);
                
                if (warningChannel) {
                    await warningChannel.send({ 
                        content: `${role}`,
                        embeds: [embed] 
                    });
                    
                    logger.info(`✅ Wysłano masowe przypomnienie do kanału ${warningChannel.name} (${warningChannel.id})`);
                    logger.info(`💬 Treść: ${customMessage ? 'Niestandardowa wiadomość' : 'Standardowe przypomnienie'}`);
                    return true;
                }
            }
            
            throw new Error('Nie znaleziono kanału ostrzeżeń dla tej roli');
        } catch (error) {
            logger.error('Błąd masowego przypomnienia');
            logger.error('❌ Błąd wysyłania masowego przypomnienia:', error);
            throw error;
        }
    }

    isDeadlinePassed() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        return polandTime >= deadline;
    }

    getNextDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }
        
        return deadline;
    }

    formatTimeLeft(timeLeft) {
        if (timeLeft <= 0) {
            return 'Deadline minął!';
        }

        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    // ============ ZARZĄDZANIE SESJAMI ============

    /**
     * Tworzy nową sesję dla /remind
     */
    createSession(userId, guildId, channelId, userClanRoleId) {
        const sessionId = `remind_${userId}_${Date.now()}`;

        const session = {
            sessionId,
            userId,
            guildId,
            channelId,
            userClanRoleId,
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

        logger.info(`[REMIND] 📝 Utworzono sesję: ${sessionId}`);
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

        logger.info(`[REMIND] 🧹 Rozpoczynam czyszczenie sesji: ${sessionId}`);

        if (session.timeout) {
            clearTimeout(session.timeout);
            session.timeout = null;
        }

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

        this.activeSessions.delete(sessionId);
        logger.info(`[REMIND] ✅ Sesja usunięta: ${sessionId}`);
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
                logger.info(`[REMIND] 🗑️ Usunięto plik: ${file}`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('[REMIND] ❌ Błąd czyszczenia plików sesji:', error);
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
                '3. Po przeanalizowaniu wszystkich zdjęć potwierdź wysłanie przypomnienia\n\n' +
                '**Uwaga:** Wiadomość ze zdjęciami zostanie automatycznie usunięta po przetworzeniu.'
            )
            .setColor('#FFA500')
            .setTimestamp()
            .setFooter({ text: 'Sesja wygaśnie po 15 minutach nieaktywności' });

        const cancelButton = new ButtonBuilder()
            .setCustomId('remind_cancel_session')
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
            description += `**📋 Lista graczy z zerem:**\n`;
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
                logger.error(`[REMIND] ❌ Błąd dodawania załącznika ${imagePath}:`, error);
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
                .setCustomId('remind_cancel_session')
                .setLabel('✅ Zakończ')
                .setStyle(ButtonStyle.Danger);

            row = new ActionRowBuilder()
                .addComponents(endButton);
        } else {
            // Są gracze z zerem - standardowe przyciski
            const confirmButton = new ButtonBuilder()
                .setCustomId('remind_complete_yes')
                .setLabel('✅ Wyślij przypomnienia')
                .setStyle(ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
                .setCustomId('remind_cancel_session')
                .setLabel('❌ Anuluj')
                .setStyle(ButtonStyle.Danger);

            row = new ActionRowBuilder()
                .addComponents(confirmButton, cancelButton);
        }

        return { embed, row, files };
    }

    /**
     * Tworzy embed z potwierdzeniem przetworzonych zdjęć (stara metoda - nie używana już dla /remind)
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
            .setCustomId('remind_add_more')
            .setLabel('➕ Dodaj więcej zdjęć')
            .setStyle(ButtonStyle.Primary);

        const confirmButton = new ButtonBuilder()
            .setCustomId('remind_complete_yes')
            .setLabel('✅ Przejdź do potwierdzenia')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('remind_cancel_session')
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
            logger.error('[REMIND] ❌ Błąd tworzenia katalogu temp:', error);
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
                    logger.info(`[REMIND] 💾 Zapisano zdjęcie: ${filename}`);
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
     * Przetwarza zdjęcia z dysku dla /remind
     */
    async processImagesFromDisk(sessionId, downloadedFiles, guild, member, publicInteraction, ocrService) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        session.publicInteraction = publicInteraction;

        logger.info(`[REMIND] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        // Odśwież cache członków przed przetwarzaniem
        logger.info('[REMIND] 🔄 Odświeżanie cache członków...');
        await guild.members.fetch();
        logger.info('[REMIND] ✅ Cache członków odświeżony');

        const results = [];

        // Progress bar - aktualizacja na żywo
        const totalImages = downloadedFiles.length;

        const cancelRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('remind_cancel_session')
                    .setLabel('❌ Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

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
                            components: [cancelRow]
                        });
                    } catch (error) {
                        logger.error('[REMIND] ❌ Błąd aktualizacji embeda przed przetworzeniem:', error);
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

                logger.info(`[REMIND] ✅ Zdjęcie ${imageIndex}/${totalImages} przetworzone: ${foundPlayers.length} graczy znalezionych (${newUniquesFromThisImage} nowych unikalnych)`);

            } catch (error) {
                logger.error(`[REMIND] ❌ Błąd przetwarzania zdjęcia ${imageIndex}:`, error);
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

        logger.info(`[REMIND] ✅ Zakończono przetwarzanie ${totalImages} zdjęć, znaleziono ${session.uniqueNicks.size} unikalnych nicków`);

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

module.exports = ReminderService;