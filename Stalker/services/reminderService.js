const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const messages = require('../config/messages');
const fs = require('fs').promises;
const path = require('path');
const { downloadDiscordImage } = require('../utils/helpers');
const { assignNicksToClan } = require('../utils/nickMatcher');

const { createBotLogger } = require('../../utils/consoleLogger');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const logger = createBotLogger('Stalker');
class ReminderService {
    constructor(config) {
        this.config = config;
        this.activeSessions = new Map(); // sessionId → session
        this.activeReminderDMs = new Map(); // userId → { roleId, guildId, confirmationChannelId, sentAt }
        this.tempDir = './Stalker/temp';
        this.ocrService = null; // Będzie ustawione przez setOCRService

        // Załaduj aktywne sesje DM z pliku
        this.loadActiveReminderDMs();
    }

    /**
     * Ustawia referencję do OCR Service (wywoływane z index.js)
     */
    setOCRService(ocrService) {
        this.ocrService = ocrService;
        logger.info('[REMIND] ✅ OCR Service przypisany do ReminderService');
    }

    async sendReminders(guild, foundUsers) {
        try {

            const timeUntilDeadline = this.calculateTimeUntilDeadline();
            const roleGroups = new Map();
            let sentMessages = 0;

            // Listy dostarczalności DM (do podsumowania dla moderatora)
            const dmDelivered = []; // displayName osób, do których DM dotarł
            const dmFailed = [];    // displayName osób, do których DM NIE dotarł (zablokowany bot / wyłączone DM)

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

                        // Wyślij wiadomości prywatne do każdego użytkownika
                        let dmsSent = 0;
                        let dmsFailed = 0;

                        for (const member of members) {
                            try {
                                // W wiadomościach prywatnych nie dodajemy pingu użytkownika
                                const dmMessage = messages.reminderMessage(timeMessage, '');

                                // Utwórz przycisk "Potwierdź odbiór" z guildId (dla obsługi DM)
                                const confirmButton = new ButtonBuilder()
                                    .setCustomId(`confirm_reminder_${member.id}_${roleId}_${guild.id}`)
                                    .setLabel('Potwierdź odbiór')
                                    .setStyle(ButtonStyle.Danger)
                                    .setEmoji('✅');

                                const row = new ActionRowBuilder()
                                    .addComponents(confirmButton);

                                await member.send({
                                    content: dmMessage,
                                    components: [row]
                                });

                                // Dodaj użytkownika do aktywnych sesji DM (do śledzenia wiadomości)
                                const confirmationChannelId = this.config.confirmationChannels[roleId];
                                const sentAt = Date.now();
                                this.activeReminderDMs.set(member.id, {
                                    roleId: roleId,
                                    guildId: guild.id,
                                    confirmationChannelId: confirmationChannelId,
                                    sentAt,
                                    repliedToMessage: false // Czy bot już odpowiedział na wiadomość użytkownika
                                });
                                // Zapisz do pliku
                                await this.saveActiveReminderDMs();

                                dmsSent++;
                                dmDelivered.push(member.displayName);
                                logger.info(`📨 Wysłano DM do ${member.user.tag}`);
                            } catch (dmError) {
                                dmsFailed++;
                                dmFailed.push(member.displayName);
                                logger.warn(`⚠️ Nie udało się wysłać DM do ${member.user.tag}: ${dmError.message}`);
                            }
                        }

                        logger.info(`📬 Podsumowanie DM: ${dmsSent} wysłane, ${dmsFailed} niepowodzeń`);
                    }
                }
            }

            logger.info(`✅ Wysłano ${sentMessages} przypomnień dla ${foundUsers.length} użytkowników`);

            return {
                sentMessages: sentMessages,
                roleGroups: roleGroups.size,
                totalUsers: foundUsers.length,
                dmDelivered: dmDelivered,
                dmFailed: dmFailed
            };
        } catch (error) {
            logger.error('Błąd przypomnień');
            logger.error('❌ Błąd wysyłania przypomnień:', error.message);
            logger.error('❌ Stack trace:', error.stack);
            throw error;
        }
    }

    /**
     * Wysyła powiadomienia RemindCX (boss CX) - jak sendReminders, ale:
     * - DM BEZ przycisku potwierdzenia odbioru (i bez rejestracji w activeReminderDMs)
     * - komunikat dotyczy bossa CX i utraty wszystkich nagród
     */
    async sendCxReminders(guild, foundUsers) {
        try {
            const timeUntilDeadline = this.calculateTimeUntilCxDeadline();
            const roleGroups = new Map();
            let sentMessages = 0;

            const dmDelivered = [];
            const dmFailed = [];

            // Grupuj użytkowników według ról klanowych
            for (const userData of foundUsers) {
                const member = userData.user.member;

                if (!member) {
                    logger.warn(`[REMINDCX] ⚠️ Brak member dla użytkownika: ${userData.detectedNick}`);
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

            for (const [roleKey, members] of roleGroups) {
                const roleId = this.config.targetRoles[roleKey];
                const warningChannelId = this.config.warningChannels[roleId];

                if (!warningChannelId) continue;

                const warningChannel = guild.channels.cache.get(warningChannelId);
                if (!warningChannel) continue;

                const userMentions = members.map(member => member.toString()).join(' ');
                const timeMessage = messages.formatCxTimeMessage(timeUntilDeadline);

                await warningChannel.send(messages.cxReminderMessage(timeMessage, userMentions));
                sentMessages++;

                logger.info(`[REMINDCX] ✅ Wysłano powiadomienie CX do kanału ${warningChannel.name} dla ${members.length} użytkowników`);

                // DM bez przycisku potwierdzenia i bez trackingu odbioru
                for (const member of members) {
                    try {
                        const dmMessage = messages.cxReminderMessage(timeMessage, '');
                        await member.send({ content: dmMessage });
                        dmDelivered.push(member.displayName);
                        logger.info(`[REMINDCX] 📨 Wysłano DM do ${member.user.tag}`);
                    } catch (dmError) {
                        dmFailed.push(member.displayName);
                        logger.warn(`[REMINDCX] ⚠️ Nie udało się wysłać DM do ${member.user.tag}: ${dmError.message}`);
                    }
                }
            }

            logger.info(`[REMINDCX] ✅ Wysłano ${sentMessages} powiadomień CX dla ${foundUsers.length} użytkowników`);

            return {
                sentMessages,
                roleGroups: roleGroups.size,
                totalUsers: foundUsers.length,
                dmDelivered,
                dmFailed
            };
        } catch (error) {
            logger.error('[REMINDCX] ❌ Błąd wysyłania powiadomień CX:', error.message);
            throw error;
        }
    }

    /**
     * Czas pozostały do deadline bossa CX (17:45 czasu polskiego)
     */
    calculateTimeUntilCxDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));

        const deadline = new Date(polandTime);
        deadline.setHours(this.config.cxBoss.deadline.hour, this.config.cxBoss.deadline.minute, 0, 0);

        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }

        const timeDiff = deadline - polandTime;
        const totalMinutes = Math.floor(timeDiff / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        return {
            totalMinutes,
            hours,
            minutes
        };
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
     * Tworzy nową sesję dla /remind (lub RemindCX gdy cxMode=true)
     * W trybie CX uniqueNicks przechowuje graczy WYKRYTYCH na zdjęciach,
     * a powiadomienia trafiają do tych, których BRAKUJE (getCxMissingUsers).
     */
    createSession(userId, guildId, channelId, userClanRoleId, ocrExpiresAt = null, cxMode = false) {
        // Usuń ewentualną porzuconą sesję tego użytkownika (np. po przeciążeniu API)
        this.discardStaleUserSession(userId);

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
            publicInteraction: null,
            isProcessing: false, // flaga czy aktualnie przetwarza zdjęcia
            cancelled: false, // flaga czy sesja została anulowana
            ocrExpiresAt, // timestamp wygaśnięcia sesji OCR
            cxMode, // tryb RemindCX (boss CX - szukamy brakujących graczy, nie zer)
            cxRoleNicks: [] // pełna lista członków roli klanowej (do wyliczenia brakujących)
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
     * Tryb CX: zwraca członków roli klanowej, których NIE wykryto na zdjęciach
     * (posiadają rolę klanową, ale brakuje ich na screenach z bossa CX)
     */
    getCxMissingUsers(session) {
        const roleNicks = session.cxRoleNicks || [];
        return roleNicks
            .filter(rn => rn.member && !session.uniqueNicks.has(rn.displayName))
            .map(rn => ({
                detectedNick: rn.displayName,
                user: rn,
                confirmed: true,
                line: '',
                endValue: '',
                uncertain: false
            }));
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
     * Usuwa z pamięci porzuconą sesję użytkownika (bez kończenia sesji OCR w ocrService -
     * wywoływane przy tworzeniu NOWEJ sesji, gdy nowa sesja OCR użytkownika już wystartowała
     * i endOCRSession zabiłby ją zamiast starej).
     */
    discardStaleUserSession(userId) {
        const stale = this.getSessionByUserId(userId);
        if (!stale) return;

        logger.warn(`[REMIND] ⚠️ Znaleziono porzuconą sesję ${stale.sessionId} - usuwam przed utworzeniem nowej`);

        if (stale.timeout) {
            clearTimeout(stale.timeout);
            stale.timeout = null;
        }
        if (stale.blinkTimer) {
            clearInterval(stale.blinkTimer);
            stale.blinkTimer = null;
        }
        stale.cancelled = true;
        this.activeSessions.delete(stale.sessionId);
        this.cleanupSessionFiles(stale.sessionId).catch(() => {});
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

        // Jeśli sesja jest w trakcie przetwarzania, tylko ustaw flagę cancelled
        if (session.isProcessing) {
            logger.warn('[REMIND] ⚠️ Sesja jest w trakcie przetwarzania - ustawiam flagę cancelled');
            session.cancelled = true;
            return; // Pętla przetwarzania sama się zatrzyma i wyczyści
        }

        if (session.timeout) {
            clearTimeout(session.timeout);
            session.timeout = null;
        }

        // Zatrzymaj timer migania jeśli istnieje
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info('[REMIND] ⏹️ Zatrzymano timer migania podczas czyszczenia sesji');
        }

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

        // KRYTYCZNE: Zakończ sesję OCR w kolejce (zapobiega deadlockowi)
        if (this.ocrService && session.guildId && session.userId) {
            await this.ocrService.endOCRSession(session.guildId, session.userId, true);
            logger.info(`[REMIND] 🔓 Zakończono sesję OCR dla użytkownika ${session.userId}`);
        }

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
    createAwaitingImagesEmbed(cxMode = false) {
        const embed = new EmbedBuilder()
            .setTitle(cxMode ? '📸 Wyślij zdjęcia do analizy (Boss CX)' : '📸 Wyślij zdjęcia do analizy')
            .setDescription(
                '**Instrukcja:**\n' +
                '1. Wyślij zdjęcia jako załączniki na tym kanale (możesz wysłać wiele zdjęć jednocześnie)\n' +
                (cxMode
                    ? '2. Bot znajdzie nicki na zdjęciach i ustali, których członków klanu BRAKUJE\n' +
                      '3. Po przeanalizowaniu wszystkich zdjęć potwierdź wysłanie powiadomień CX\n\n'
                    : '2. Bot automatycznie je przeanalizuje\n' +
                      '3. Po przeanalizowaniu wszystkich zdjęć potwierdź wysłanie przypomnienia\n\n') +
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
     * Tworzy embed z końcowym potwierdzeniem i listą graczy.
     * Tryb CX: lista graczy, których BRAKUJE na zdjęciach (posiadają rolę klanową).
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
        let actionableCount; // liczba osób do powiadomienia (decyduje o przyciskach)

        if (session.cxMode) {
            const missingUsers = this.getCxMissingUsers(session);
            actionableCount = missingUsers.length;

            description += `**Wykryto na zdjęciach:** ${uniqueNicks.length} z ${(session.cxRoleNicks || []).length} członków klanu\n`;
            description += `**Brakuje:** ${missingUsers.length} ${missingUsers.length === 1 ? 'gracz' : 'graczy'}\n\n`;

            if (missingUsers.length > 0) {
                description += `**📋 Lista graczy, których brakuje (boss CX):**\n`;
                const displayMissing = missingUsers.slice(0, 20);
                description += displayMissing.map(u => `• ${u.detectedNick}`).join('\n');

                if (missingUsers.length > 20) {
                    description += `\n... i ${missingUsers.length - 20} więcej`;
                }
            } else {
                description += `✅ Wszyscy członkowie klanu są na zdjęciach - nie ma komu wysłać powiadomienia`;
            }
        } else {
            actionableCount = uniqueNicks.length;
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
        }

        const embed = new EmbedBuilder()
            .setTitle(session.cxMode ? '✅ Analiza CX zakończona' : '✅ Analiza zakończona')
            .setDescription(description)
            .setColor('#FFA500')
            .setTimestamp();

        // Przygotuj zdjęcia jako osobne załączniki (poza embedem)
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

        // Zdjęcia są teraz poza embedem - jako osobne załączniki w wiadomości

        let row;
        if (actionableCount === 0) {
            // Nikogo nie trzeba powiadamiać - tylko przycisk Zakończ
            const endButton = new ButtonBuilder()
                .setCustomId('remind_cancel_session')
                .setLabel('✅ Zakończ')
                .setStyle(ButtonStyle.Danger);

            row = new ActionRowBuilder()
                .addComponents(endButton);
        } else {
            // Są gracze do powiadomienia - standardowe przyciski
            const confirmButton = new ButtonBuilder()
                .setCustomId('remind_complete_yes')
                .setLabel(session.cxMode ? '✅ Wyślij powiadomienia CX' : '✅ Wyślij przypomnienia')
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
        await downloadDiscordImage(url, filepath);
        logger.info(`[REMIND] 💾 Zapisano zdjęcie: ${filename}`);
        return filepath;
    }

    /**
     * Przetwarza zdjęcia z dysku dla /remind - dyspozytor.
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

        logger.info('[REMIND] ℹ️ AI OCR wyłączony - klasyczne przetwarzanie zdjęcie-po-zdjęciu');
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

        // Ustaw flagę przetwarzania
        session.isProcessing = true;

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

                    const cancelRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('remind_cancel_session')
                                .setLabel('❌ Anuluj')
                                .setStyle(ButtonStyle.Danger)
                        );

                    await session.publicInteraction.editReply({
                        embeds: [processingEmbed],
                        components: [cancelRow]
                    });
                } catch (error) {
                    logger.error('[REMIND] ❌ Błąd aktualizacji migania:', error.message);
                } finally {
                    session.isUpdatingProgress = false;
                }
            }
        }, 1000);

        logger.info(`[REMIND] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        // Odśwież cache członków przed przetwarzaniem
        await safeFetchMembers(guild, logger);

        if (session.cxMode) {
            // Zapamiętaj pełną listę klanu - potrzebna do wyliczenia brakujących graczy
            session.cxRoleNicks = await ocrService.getRoleNicks(guild, member);
        }

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
            // Sprawdź czy sesja została anulowana
            if (session.cancelled) {
                logger.warn('[REMIND] ⚠️ Sesja została anulowana podczas przetwarzania - przerywam pętlę');
                break;
            }

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
                            components: [cancelRow]
                        });
                    } catch (error) {
                        logger.error('[REMIND] ❌ Błąd aktualizacji embeda przed przetworzeniem:', error);
                    }
                }

                // Przetwórz zdjęcie przez OCR
                const text = await ocrService.processImageFromFile(file.filepath);

                // Wyodrębnij graczy: tryb CX = wszystkie wykryte nicki, klasyczny = gracze z wynikiem 0
                const foundPlayers = await ocrService.extractPlayersFromText(text, guild, member, session.cxMode);

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
                            components: [cancelRow]
                        });
                    } catch (error) {
                        logger.error('[REMIND] ❌ Błąd aktualizacji embeda po przetworzeniu:', error);
                    }
                }

                // Małe opóźnienie między zdjęciami (żeby widać było progress)
                if (i < totalImages - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

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

        // Zatrzymaj timer migania
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info('[REMIND] ⏹️ Zatrzymano timer migania');
        }

        // Poczekaj na zakończenie ostatniego wywołania updateProgress (race condition fix)
        let waitCount = 0;
        while (session.isUpdatingProgress && waitCount < 50) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms
            waitCount++;
        }
        if (waitCount > 0) {
            logger.info(`[REMIND] ✅ Zakończono oczekiwanie na ostatnią aktualizację progress (${waitCount * 100}ms)`);
        }

        // Wyczyść aktualnie przetwarzane dane
        session.currentProcessingData = null;

        // Wyłącz flagę przetwarzania
        session.isProcessing = false;

        // Jeśli sesja została anulowana podczas przetwarzania, zaktualizuj embed i wyczyść
        if (session.cancelled) {
            logger.info('[REMIND] 🧹 Sesja została anulowana - czyszczę po zakończeniu przetwarzania');
            const cancelledInteraction = session.publicInteraction;
            if (cancelledInteraction) {
                try {
                    const cancelledEmbed = new EmbedBuilder()
                        .setTitle('❌ Sesja anulowana')
                        .setDescription('Sesja /remind została anulowana. Wszystkie pliki zostały usunięte.')
                        .setColor('#FF0000')
                        .setTimestamp();
                    await cancelledInteraction.editReply({ embeds: [cancelledEmbed], components: [] });
                } catch (err) {
                    logger.warn(`[REMIND] ⚠️ Nie udało się zaktualizować embeda po anulowaniu: ${err.message}`);
                }
            }
            await this.cleanupSession(sessionId);
        }

        return results;
    }

    /**
     * Analiza zbiorcza (batch) dla /remind: wszystkie zdjęcia tej partii wysyłane są do AI
     * w jednym zapytaniu razem z listą nicków roli klanowej. AI deduplikuje i dopasowuje
     * nicki, zwracając wyniki graczy; wybieramy graczy z wynikiem 0 (do przypomnień).
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
            { key: 'analyzing',   icon: '📊', label: session.cxMode ? 'Analiza wyników (wykryci gracze)' : 'Analiza wyników (gracze z zerem)' }
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
                    logger.error('[REMIND] ❌ Błąd aktualizacji migania (batch):', e.message);
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

        logger.info(`[REMIND] 🔄 Analiza batch ${totalImages} zdjęć dla sesji ${sessionId}`);

        try {
            const aiOcrService = ocrService.aiOcrService;
            await safeFetchMembers(guild, logger);

            session.currentStepKey = 'downloading';
            await this.updateBatchProgress(session);
            await new Promise(r => setTimeout(r, 400));

            // Lista członków roli klanowej (z obiektami member do rozwiązania userId)
            const roleNicks = await ocrService.getRoleNicks(guild, member); // [{userId, member, displayName}]
            const clanNicks = roleNicks.map(r => r.displayName);
            const nickToMember = new Map();
            for (const rn of roleNicks) {
                if (!nickToMember.has(rn.displayName)) nickToMember.set(rn.displayName, rn);
            }
            if (session.cxMode) {
                // Zapamiętaj pełną listę klanu - potrzebna do wyliczenia brakujących graczy
                session.cxRoleNicks = roleNicks;
            }
            logger.info(`[REMIND] 👥 Nicki klanu do promptu AI: ${clanNicks.length}`);

            session.currentStepKey = 'sending';
            await this.updateBatchProgress(session);
            await new Promise(r => setTimeout(r, 400));

            session.currentStepKey = 'processing';
            const filepaths = downloadedFiles.map(f => f.filepath);
            // Tryb CX: dedykowany prompt zwracający SAME NICKI (bez wyników)
            const aiResult = session.cxMode
                ? await aiOcrService.analyzeNicksImagesBatch(filepaths, clanNicks)
                : await aiOcrService.analyzeResultsImagesBatch(filepaths, clanNicks);

            if (!session.cancelled) {
                session.currentStepKey = 'analyzing';
                await this.updateBatchProgress(session);

                const rawPlayers = (aiResult && aiResult.isValid && Array.isArray(aiResult.players)) ? aiResult.players : [];
                // Przydział 1:1 nicków AI → klanowych
                const assigned = assignNicksToClan(rawPlayers, clanNicks, logger);
                // Tryb CX: WSZYSCY wykryci gracze (szukamy brakujących); klasyczny: tylko z wynikiem 0
                const relevantPlayers = session.cxMode
                    ? assigned
                    : assigned.filter(p => Number(p.score) === 0);

                const players = [];
                const uniqueBefore = session.uniqueNicks.size;
                for (const zp of relevantPlayers) {
                    const roleNick = nickToMember.get(zp.playerName);
                    if (!roleNick || !roleNick.member) {
                        logger.warn(`[REMIND] ⚠️ Brak membera dla "${zp.playerName}" - pomijam`);
                        continue;
                    }
                    players.push({
                        detectedNick: roleNick.displayName,
                        user: roleNick,
                        confirmed: true,
                        line: '',
                        endValue: session.cxMode ? String(zp.score ?? '') : '0',
                        uncertain: false
                    });
                    session.uniqueNicks.add(roleNick.displayName);
                }
                const newUniques = session.uniqueNicks.size - uniqueBefore;

                // Jeden wpis processedImages na każdy plik (dla załączników i licznika);
                // gracze z zerem trafiają do pierwszego wpisu tej partii
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

                logger.info(`[REMIND] ✅ Batch: ${players.length} ${session.cxMode ? 'wykrytych graczy' : 'graczy z zerem'} (unikalnych łącznie: ${session.uniqueNicks.size})`);
                session.currentStepKey = 'done';
                await this.updateBatchProgress(session);
            } else {
                logger.warn('[REMIND] ⚠️ Sesja anulowana podczas analizy batch - pomijam wynik');
            }
        } catch (error) {
            if (error.isAPIOverloaded) {
                logger.warn('[REMIND] ⚠️ API Gemini przeciążone po 10 próbach - kończę procedurę OCR');
                const ci = session.publicInteraction;
                if (ci) {
                    try {
                        const overloadEmbed = new EmbedBuilder()
                            .setTitle('🔴 API Gemini jest przeciążone')
                            .setDescription('API jest aktualnie przeciążone i nie odpowiedziało po 10 próbach.\nSpróbuj ponownie za kilka minut.')
                            .setColor('#FF0000')
                            .setTimestamp();
                        if (ci.editReply) await ci.editReply({ embeds: [overloadEmbed], components: [] });
                        else await ci.edit({ embeds: [overloadEmbed], components: [] });
                    } catch (e) {
                        logger.warn(`[REMIND] ⚠️ Nie udało się zaktualizować embeda o przeciążeniu: ${e.message}`);
                    }
                }
                try {
                    await ocrService.endOCRSession(guild.id, member.id);
                } catch (e) {
                    logger.warn(`[REMIND] ⚠️ Nie udało się zakończyć sesji OCR: ${e.message}`);
                }
                session.apiOverloaded = true;
            } else {
                logger.error('[REMIND] ❌ Błąd analizy batch:', error);
                // Wpisy plików bez graczy, by załączniki/licznik były spójne
                downloadedFiles.forEach(file => {
                    session.processedImages.push({
                        filepath: file.filepath,
                        result: { imageIndex: session.processedImages.length + 1, foundPlayers: 0, newUniques: 0, players: [], error: error.message }
                    });
                });
            }
        } finally {
            await stopBlinkTimer();
            session.currentProcessingData = null;
            session.isProcessing = false;
        }

        if (session.apiOverloaded) {
            // KRYTYCZNE: usuń sesję z pamięci - martwa sesja przechwytywałaby zdjęcia
            // kolejnej sesji użytkownika (getSessionByUserId zwraca pierwszą znalezioną),
            // a jej timeout zabiłby nową sesję OCR
            await this.cleanupSession(sessionId);
            return null;
        }

        if (session.cancelled) {
            logger.info('[REMIND] 🧹 Sesja anulowana - czyszczę po zakończeniu przetwarzania');
            const ci = session.publicInteraction;
            if (ci) {
                try {
                    const e = new EmbedBuilder()
                        .setTitle('❌ Sesja anulowana')
                        .setDescription('Sesja /remind została anulowana. Wszystkie pliki zostały usunięte.')
                        .setColor('#FF0000')
                        .setTimestamp();
                    if (ci.editReply) await ci.editReply({ embeds: [e], components: [] });
                    else await ci.edit({ embeds: [e], components: [] });
                } catch (err) {
                    logger.warn(`[REMIND] ⚠️ Nie udało się zaktualizować embeda po anulowaniu: ${err.message}`);
                }
            }
            await this.cleanupSession(sessionId);
        }

        return session.processedImages;
    }

    /**
     * Pasek postępu batch (stepper) dla /remind - pokazuje etapy procesu.
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
                .addFields({ name: session.cxMode ? '👥 Wykrytych graczy' : '👥 Suma graczy z zerem', value: `${session.uniqueNicks.size}`, inline: true })
                .setTimestamp();

            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('remind_cancel_session').setLabel('❌ Anuluj').setStyle(ButtonStyle.Danger)
            );

            try {
                if (session.publicInteraction.editReply) {
                    await session.publicInteraction.editReply({ embeds: [embed], components: [cancelRow] });
                } else {
                    await session.publicInteraction.edit({ embeds: [embed], components: [cancelRow] });
                }
            } catch (e) {
                if (e.code === 10008 || e.message?.includes('Unknown Message')) {
                    logger.warn('[REMIND] ⚠️ Wiadomość postępu usunięta - kontynuuję bez aktualizacji');
                } else if (e.code === 10015 || e.message?.includes('Unknown Webhook') || e.message?.includes('Invalid Webhook Token')) {
                    logger.warn('[REMIND] ⏰ Interakcja wygasła podczas batch');
                } else {
                    throw e;
                }
            }
        } catch (error) {
            logger.error('[REMIND] ❌ Błąd aktualizacji postępu (batch):', error.message);
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

    // ============ ZARZĄDZANIE AKTYWNYMI SESJAMI DM ============

    /**
     * Ładuje aktywne sesje DM z pliku i usuwa wygasłe
     */
    async loadActiveReminderDMs() {
        try {
            const data = await fs.readFile(this.config.database.activeReminderDMs, 'utf8');
            const sessions = JSON.parse(data || '{}');

            // Sprawdź czy deadline nie minął - jeśli tak, wyczyść wszystkie sesje
            if (this.isDeadlinePassed()) {
                logger.info('[REMINDER-DM] ⏰ Deadline minął - czyszczenie wszystkich aktywnych sesji DM');
                this.activeReminderDMs.clear();
                await this.saveActiveReminderDMs();
                return;
            }

            // Załaduj sesje do Map
            let loadedCount = 0;
            for (const [userId, sessionData] of Object.entries(sessions)) {
                this.activeReminderDMs.set(userId, sessionData);
                loadedCount++;
            }

            logger.info(`[REMINDER-DM] 📂 Załadowano ${loadedCount} aktywnych sesji DM z pliku`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - utwórz pusty
                logger.info('[REMINDER-DM] 📝 Brak pliku aktywnych sesji DM - utworzono nowy');
                await this.saveActiveReminderDMs();
            } else {
                logger.error('[REMINDER-DM] ❌ Błąd ładowania aktywnych sesji DM:', error);
            }
        }
    }

    /**
     * Zapisuje aktywne sesje DM do pliku
     */
    async saveActiveReminderDMs() {
        try {
            const sessions = {};
            for (const [userId, sessionData] of this.activeReminderDMs.entries()) {
                sessions[userId] = sessionData;
            }

            await fs.writeFile(
                this.config.database.activeReminderDMs,
                JSON.stringify(sessions, null, 2),
                'utf8'
            );
        } catch (error) {
            logger.error('[REMINDER-DM] ❌ Błąd zapisywania aktywnych sesji DM:', error);
        }
    }

    /**
     * Usuwa użytkownika z aktywnych sesji DM (gdy potwierdzi przycisk)
     */
    async removeActiveReminderDM(userId) {
        // Snapshot metadanych PRZED usunięciem — potrzebujemy guildId/channelId do eventu.
        const dmData = this.activeReminderDMs.get(userId);
        const removed = this.activeReminderDMs.delete(userId);
        if (removed) {
            logger.info(`[REMINDER-DM] 🗑️ Usunięto aktywną sesję DM dla użytkownika ${userId}`);
            await this.saveActiveReminderDMs();

        }
        return removed;
    }

    /**
     * Sprawdza czy użytkownik ma aktywną sesję DM przypomnienia
     */
    hasActiveReminderDM(userId) {
        return this.activeReminderDMs.has(userId);
    }

    /**
     * Pobiera dane aktywnej sesji DM użytkownika
     */
    getActiveReminderDM(userId) {
        return this.activeReminderDMs.get(userId);
    }

    /**
     * Oznacza że bot już odpowiedział użytkownikowi na DM
     */
    async markReminderDMAsReplied(userId) {
        const sessionData = this.activeReminderDMs.get(userId);
        if (sessionData) {
            sessionData.repliedToMessage = true;
            await this.saveActiveReminderDMs();
            logger.info(`[REMINDER-DM] ✅ Oznaczono że bot odpowiedział użytkownikowi ${userId}`);
            return true;
        }
        return false;
    }

    /**
     * Wyłącza przyciski potwierdzenia po wygaśnięciu deadline
     * Wywołuje się automatycznie przez cron po deadline
     */
    async disableExpiredConfirmationButtons(client) {
        try {
            // Sprawdź czy deadline minął
            if (!this.isDeadlinePassed()) {
                logger.info('[REMINDER-EXPIRE] ⏰ Deadline jeszcze nie minął - pomijam');
                return;
            }

            logger.info('[REMINDER-EXPIRE] 🔄 Rozpoczynam wyłączanie wygasłych przycisków potwierdzenia...');

            let updatedCount = 0;
            let failedCount = 0;

            // Przejdź przez wszystkie aktywne sesje DM
            for (const [userId, sessionData] of this.activeReminderDMs.entries()) {
                try {
                    // Pobierz użytkownika
                    const user = await client.users.fetch(userId);

                    if (!user) {
                        logger.warn(`[REMINDER-EXPIRE] ⚠️ Nie znaleziono użytkownika ${userId}`);
                        failedCount++;
                        continue;
                    }

                    // Pobierz kanał DM
                    const dmChannel = await user.createDM();

                    // Znajdź ostatnią wiadomość z przyciskiem potwierdzenia
                    // Szukamy wiadomości wysłanej około czasu sentAt
                    const messages = await dmChannel.messages.fetch({ limit: 20 });

                    let foundMessage = null;
                    for (const message of messages.values()) {
                        // Sprawdź czy wiadomość jest od bota i ma przyciski
                        if (message.author.id === client.user.id &&
                            message.components.length > 0 &&
                            message.components[0].components.some(c => c.customId?.startsWith('confirm_reminder_'))) {
                            foundMessage = message;
                            break;
                        }
                    }

                    if (foundMessage) {
                        // Zaktualizuj wiadomość - usuń przyciski i dodaj tekst
                        await foundMessage.edit({
                            content: foundMessage.content + '\n\n⏰ **Czas na potwierdzenie minął!**',
                            components: []
                        });

                        logger.info(`[REMINDER-EXPIRE] ✅ Zaktualizowano wiadomość dla użytkownika ${user.tag}`);
                        updatedCount++;
                    } else {
                        logger.warn(`[REMINDER-EXPIRE] ⚠️ Nie znaleziono wiadomości z przyciskiem dla ${user.tag}`);
                        failedCount++;
                    }

                } catch (error) {
                    logger.error(`[REMINDER-EXPIRE] ❌ Błąd aktualizacji dla użytkownika ${userId}: ${error.message}`);
                    failedCount++;
                }
            }

            // Wyczyść wszystkie aktywne sesje DM po deadline
            this.activeReminderDMs.clear();
            await this.saveActiveReminderDMs();

            logger.info(`[REMINDER-EXPIRE] ✅ Zakończono wyłączanie przycisków: ${updatedCount} zaktualizowanych, ${failedCount} błędów`);

        } catch (error) {
            logger.error('[REMINDER-EXPIRE] ❌ Błąd podczas wyłączania przycisków:', error);
        }
    }
}

module.exports = ReminderService;